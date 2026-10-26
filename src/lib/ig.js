// Client de l'API web d'Instagram (celle qu'utilise instagram.com).
// API NON OFFICIELLE : les endpoints peuvent changer sans préavis. Tout est
// isolé ici pour faciliter la maintenance. À utiliser depuis le service worker.
//
// Les requêtes ne partent PAS du service worker (Instagram les rejette en 429) :
// elles sont exécutées par le content script d'un onglet instagram.com
// (même origine, mêmes cookies et en-têtes que le site), voir content/ig-ui.js.

import { LIMITS } from './limits.js';
import { sleep, rand } from './util.js';

const BASE = 'https://www.instagram.com';

export class IgError extends Error {
  constructor(message, { status = 0, kind = 'unknown', body = null } = {}) {
    super(message);
    this.status = status;
    this.kind = kind; // auth | rate | feedback | checkpoint | notfound | notab | unknown
    this.body = body;
  }
}

// --- Throttle des lectures --------------------------------------------------
let lastCall = 0;
let readWindow = [];
async function throttle() {
  const now = Date.now();
  readWindow = readWindow.filter((t) => now - t < 3600_000);
  if (readWindow.length >= LIMITS.hard.readsPerHour) {
    throw new IgError('Quota de lecture horaire atteint (protection du compte). Réessaie plus tard.', { kind: 'rate' });
  }
  const wait = lastCall + LIMITS.hard.readGapMs + rand(0, 900) - now;
  if (wait > 0) await sleep(wait);
  lastCall = Date.now();
  readWindow.push(lastCall);
}

async function cookie(name) {
  const c = await chrome.cookies.get({ url: BASE, name });
  return c?.value || '';
}

export async function session() {
  const [userId, sessionid] = await Promise.all([cookie('ds_user_id'), cookie('sessionid')]);
  return { userId, loggedIn: Boolean(sessionid && userId) };
}

function classify(status, body) {
  const msg = (body && (body.message || body.error_type || body.feedback_title)) || '';
  const text = typeof body === 'string' ? body : JSON.stringify(body || {});
  if (status === 401 || /login_required/.test(text)) return 'auth';
  if (/checkpoint|challenge_required/.test(text)) return 'checkpoint';
  if (/feedback_required|spam|action.?blocked|try again later/i.test(text + msg)) return 'feedback';
  if (status === 429) return 'rate';
  if (status === 404) return 'notfound';
  return 'unknown';
}

// --- Pont vers un onglet instagram.com ---------------------------------------

let bridgeTabId = null;
let likeTabId = null;

async function ping(tabId) {
  try {
    const r = await chrome.tabs.sendMessage(tabId, { type: 'igg:ping' }, { frameId: 0 });
    return r === 'pong';
  } catch {
    return false;
  }
}

async function ready(tab) {
  if (!tab || tab.discarded || tab.status === 'unloaded') return false;
  if (await ping(tab.id)) return true;
  // Onglet ouvert avant l'installation de l'extension : on injecte le script.
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [0] }, files: ['src/content/ig-ui.js'] });
    return ping(tab.id);
  } catch {
    return false;
  }
}

export function waitComplete(tabId, timeout = 20000) {
  return new Promise((resolve) => {
    const done = () => { chrome.tabs.onUpdated.removeListener(listener); clearTimeout(t); resolve(); };
    const listener = (id, info) => { if (id === tabId && info.status === 'complete') done(); };
    const t = setTimeout(done, timeout);
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function bridgeTab() {
  if (bridgeTabId != null) {
    const t = await chrome.tabs.get(bridgeTabId).catch(() => null);
    if (t?.url?.startsWith(BASE) && (await ready(t))) return t.id;
    bridgeTabId = null;
  }
  const tabs = (await chrome.tabs.query({ url: `${BASE}/*` })).sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
  // L'onglet « likes » (navigation de post en post) n'est jamais utilisé comme pont réseau.
  for (const t of tabs) if (t.id !== likeTabId && (await ready(t))) return (bridgeTabId = t.id);
  // Aucun onglet Instagram exploitable : on en ouvre un épinglé en arrière-plan.
  const t = await chrome.tabs.create({ url: `${BASE}/`, active: false, pinned: true });
  await waitComplete(t.id);
  await sleep(1500);
  if (await ready(await chrome.tabs.get(t.id))) return (bridgeTabId = t.id);
  throw new IgError('Impossible de joindre un onglet instagram.com. Ouvre instagram.com puis réessaie.', { kind: 'notab' });
}

function blobToBase64(blob) {
  return blob.arrayBuffer().then((buf) => {
    const bytes = new Uint8Array(buf);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  });
}

async function serializeBody(body) {
  if (body == null) return null;
  if (body instanceof URLSearchParams) return { kind: 'form', data: body.toString() };
  if (body instanceof Blob) return { kind: 'blob', type: body.type, data: await blobToBase64(body) };
  return { kind: 'text', data: String(body) };
}

// --- Pauses après 429 (par endpoint, persistées) ------------------------------

const COOLDOWN_KEY = 'igCooldowns';
const COOLDOWN_MS = 15 * 60 * 1000;
const endpointKey = (path) => path.split('?')[0].replace(/\/\d+(?=\/)/g, '/:id').replace(/^\/[^/]+\/$/, '/:profil/');

async function cooldownUntil(key) {
  const all = (await chrome.storage.local.get(COOLDOWN_KEY))[COOLDOWN_KEY] || {};
  return all[key] || 0;
}

async function setCooldown(key, ms = COOLDOWN_MS) {
  const all = (await chrome.storage.local.get(COOLDOWN_KEY))[COOLDOWN_KEY] || {};
  for (const [k, t] of Object.entries(all)) if (t < Date.now()) delete all[k];
  all[key] = Date.now() + ms;
  await chrome.storage.local.set({ [COOLDOWN_KEY]: all });
}

const hhmm = (t) => new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

async function request(path, { method = 'GET', body, headers = {}, skipThrottle = false, raw = false } = {}) {
  const key = endpointKey(path);
  const until = await cooldownUntil(key);
  if (until > Date.now()) {
    throw new IgError(`Instagram limite cette requête : nouvel essai possible vers ${hhmm(until)}. [${key}]`, { status: 429, kind: 'rate' });
  }
  if (!skipThrottle) await throttle();
  const { loggedIn } = await session();
  if (!loggedIn) throw new IgError('Non connecté à Instagram. Connecte-toi sur instagram.com dans ce navigateur.', { kind: 'auth', status: 401 });

  const tabId = await bridgeTab();
  const res = await chrome.tabs.sendMessage(tabId, {
    type: 'igg:fetch',
    path,
    method,
    headers,
    raw,
    body: await serializeBody(body),
  }, { frameId: 0 });
  if (!res) throw new IgError('Pas de réponse de l’onglet Instagram.', { kind: 'notab' });
  if (res.error) throw new IgError(res.error, { kind: 'unknown' });

  let data = null;
  try { data = JSON.parse(res.text); } catch { data = res.text; }

  if (!raw && typeof data === 'string' && res.status >= 200 && res.status < 300) {
    // Instagram renvoie parfois une page HTML en 200 sur une route d'API disparue : ce n'est pas un succès.
    const err = new IgError(`Réponse inattendue d’Instagram (page au lieu de données) [${key}]`, { status: res.status, kind: 'unknown' });
    err.nonJson = true;
    throw err;
  }

  if (res.status < 200 || res.status >= 300 || (data && data.status === 'fail')) {
    const kind = classify(res.status, data);
    if (res.status === 429) await setCooldown(key);
    const message = res.status === 429
      ? `Instagram limite temporairement cette requête (429), pause jusqu’à ${hhmm(Date.now() + COOLDOWN_MS)}.`
      : (data && typeof data === 'object' && (data.feedback_message || data.message)) || `Instagram a répondu ${res.status}`;
    throw new IgError(`${message} [${key}]`, { status: res.status, kind, body: data });
  }
  return data;
}

// --- Normalisation ----------------------------------------------------------

function bestImage(m) {
  const c = m?.image_versions2?.candidates || m?.carousel_media?.[0]?.image_versions2?.candidates || [];
  // Plus petite image ≥ 320 px pour les miniatures.
  const sorted = [...c].sort((a, b) => a.width - b.width);
  return (sorted.find((x) => x.width >= 320) || sorted[sorted.length - 1] || {}).url || m?.display_url || m?.thumbnail_src || '';
}

export function normalizeMedia(m) {
  const typeMap = { 1: 'photo', 2: 'video', 8: 'carousel' };
  let type = typeMap[m.media_type] || 'photo';
  if (m.product_type === 'clips') type = 'reel';
  return {
    pk: String(m.pk ?? m.id ?? '').split('_')[0],
    code: m.code || m.shortcode,
    type,
    takenAt: (m.taken_at || m.taken_at_timestamp || 0) * 1000,
    likes: m.like_count ?? m.edge_liked_by?.count ?? m.edge_media_preview_like?.count ?? 0,
    comments: m.comment_count ?? m.edge_media_to_comment?.count ?? 0,
    views: m.play_count ?? m.view_count ?? m.ig_play_count ?? m.video_view_count ?? 0,
    caption: m.caption?.text ?? m.edge_media_to_caption?.edges?.[0]?.node?.text ?? '',
    thumb: bestImage(m),
    likedByViewer: Boolean(m.has_liked),
    user: m.user ? normalizeUser(m.user) : (m.owner ? normalizeUser(m.owner) : null),
  };
}

export function normalizeUser(u) {
  return {
    pk: String(u.pk ?? u.id ?? u.pk_id ?? ''),
    username: u.username,
    fullName: u.full_name || '',
    pic: u.profile_pic_url || '',
    isPrivate: Boolean(u.is_private),
    isVerified: Boolean(u.is_verified),
    bio: u.biography ?? undefined,
    followers: u.follower_count ?? u.edge_followed_by?.count,
    following: u.following_count ?? u.edge_follow?.count,
    posts: u.media_count ?? u.edge_owner_to_timeline_media?.count,
    isBusiness: Boolean(u.is_business ?? u.is_business_account ?? u.is_professional_account),
    category: u.category || u.category_name || u.business_category_name || '',
    publicEmail: u.public_email || u.business_email || '',
    publicPhone: u.public_phone_number || u.contact_phone_number || u.business_phone_number || '',
    externalUrl: u.external_url || '',
  };
}

/** Parcourt n'importe quelle réponse et récupère les objets « media ». */
function collectMedia(node, out = new Map()) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) { node.forEach((n) => collectMedia(n, out)); return out; }
  if ((node.code || node.shortcode) && (node.pk || node.id) && (node.user || node.owner) && (node.media_type || node.__typename)) {
    const m = normalizeMedia(node);
    if (m.pk && !out.has(m.pk)) out.set(m.pk, m);
    return out;
  }
  for (const v of Object.values(node)) collectMedia(v, out);
  return out;
}

// --- Endpoints --------------------------------------------------------------

export async function userInfo(userId) {
  const d = await request(`/api/v1/users/${userId}/info/`);
  return normalizeUser(d.user);
}

async function profileFromApi(username) {
  const d = await request(`/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`);
  if (!d?.data?.user) throw new IgError(`Profil @${username} introuvable`, { kind: 'notfound', status: 404 });
  const u = d.data.user;
  const user = normalizeUser(u);
  user.recent = (u.edge_owner_to_timeline_media?.edges || []).map((e) => normalizeMedia({ ...e.node, owner: { id: u.id, username: u.username } }));
  user.followedByViewer = Boolean(u.followed_by_viewer);
  user.followsViewer = Boolean(u.follows_viewer);
  return user;
}

const decodeEntities = (s) => s
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** "1 234", "1,234", "12,5 k", "1.2M" → nombre. */
export function parseCount(num, suffix = '') {
  const n = num.replace(/[\s  ]/g, '');
  const mult = /^k/i.test(suffix) ? 1e3 : /^m/i.test(suffix) ? 1e6 : 1;
  if (mult > 1) return Math.round(parseFloat(n.replace(',', '.')) * mult);
  return parseInt(n.replace(/[.,]/g, ''), 10);
}

/** Extrait abonnés / abonnements / publications d'une description og:description. */
export function countsFromDescription(desc) {
  const head = desc.split(/\s[-–—]\s/)[0];
  return [...head.matchAll(/(\d[\d.,   ]*?)\s?([kKmM](?:io)?)?(?=\s*[^\d\s.,  ])/g)].map((m) => parseCount(m[1], m[2] || ''));
}

/**
 * Repli quand web_profile_info est limité : lit la page publique du profil
 * (balises meta + JSON embarqué), comme une navigation ordinaire.
 */
async function profileFromPage(username) {
  const html = await request(`/${encodeURIComponent(username)}/`, { raw: true });
  if (typeof html !== 'string') throw new IgError('Page de profil illisible', { kind: 'unknown' });
  const meta = (prop) => decodeEntities((html.match(new RegExp(`<meta[^>]+(?:property|name)="${prop}"[^>]*content="([^"]*)"`, 'i')) ||
    html.match(new RegExp(`<meta[^>]+content="([^"]*)"[^>]*(?:property|name)="${prop}"`, 'i')) || [])[1] || '');
  const counts = countsFromDescription(meta('og:description') || meta('description'));
  if (counts.length < 3) throw new IgError(`Profil @${username} introuvable`, { kind: 'notfound', status: 404 });
  // La page embarque aussi d'autres comptes (toi, suggestions…) : les indicateurs (privé,
  // certifié, bio…) ne sont lus qu'autour de l'objet JSON du profil visé.
  const nameRe = username.replace(/[.]/g, '\\.');
  const at = html.search(new RegExp(`"username":"${nameRe}"`, 'i'));
  const around = at >= 0 ? html.slice(Math.max(0, at - 2000), at + 2000) : '';
  const json = (re) => { const m = around.match(re); try { return m ? JSON.parse(`"${m[1]}"`) : ''; } catch { return ''; } };
  const pk = (html.match(new RegExp(`"id":"(\\d+)","username":"${nameRe}"`, 'i')) || html.match(/"profile_id":"(\d+)"/) ||
    html.match(/profilePage_(\d+)/) || [])[1] || '';
  const title = meta('og:title');
  return {
    pk,
    username,
    fullName: title.includes('(@') ? title.split('(@')[0].trim() : '',
    pic: meta('og:image'),
    isPrivate: /"is_private":true/.test(around),
    isVerified: /"is_verified":true/.test(around),
    bio: json(/"biography":"((?:[^"\\]|\\.)*)"/),
    followers: counts[0],
    following: counts[1],
    posts: counts[2],
    isBusiness: /"is_business_account":true|"is_professional_account":true/.test(around),
    category: json(/"category_name":"((?:[^"\\]|\\.)*)"/),
    publicEmail: json(/"business_email":"((?:[^"\\]|\\.)*)"/),
    publicPhone: '',
    externalUrl: json(/"external_url":"((?:[^"\\]|\\.)*)"/),
    source: 'page',
  };
}

export async function profileByUsername(username) {
  try {
    return await profileFromApi(username);
  } catch (e) {
    // Profil réellement inexistant ou session perdue : inutile d'insister.
    if (e.kind === 'auth' || (e.kind === 'notfound' && !String(e.message).includes('['))) throw e;
    return profileFromPage(username);
  }
}

export async function me({ fresh = false } = {}) {
  const { userId } = await session();
  if (!userId) throw new IgError('Non connecté à Instagram.', { kind: 'auth', status: 401 });
  const { me: cached } = await chrome.storage.local.get('me');
  // Profil mis en cache 30 min : évite de solliciter les endpoints limités à chaque ouverture.
  if (!fresh && cached?.pk === userId && Date.now() - (cached.fetchedAt || 0) < 30 * 60 * 1000) return cached;
  let username = cached?.pk === userId ? cached.username : '';
  if (!username) {
    // /users/{id}/info/ est réservé à l'app mobile ; le site utilise web_form_data.
    const d = await request('/api/v1/accounts/edit/web_form_data/');
    username = d?.form_data?.username;
  }
  if (!username) throw new IgError('Profil introuvable', { kind: 'notfound' });
  const user = await profileByUsername(username);
  user.pk = userId;
  user.fetchedAt = Date.now();
  await chrome.storage.local.set({ me: user });
  return user;
}

export async function userFeed(userId, { max = 36, username = '' } = {}) {
  const page = (maxId, count) => (userId
    ? `/api/v1/feed/user/${userId}/?count=${count}${maxId ? `&max_id=${maxId}` : ''}`
    : `/api/v1/feed/user/${encodeURIComponent(username)}/username/?count=${count}${maxId ? `&max_id=${maxId}` : ''}`);
  const items = [];
  let maxId = '';
  try {
    while (items.length < max) {
      const d = await request(page(maxId, Math.min(33, max - items.length)));
      if (!d || typeof d !== 'object' || !Array.isArray(d.items)) throw new IgError('Réponse inattendue du fil de posts', { kind: 'unknown' });
      items.push(...d.items.map(normalizeMedia));
      if (!d.more_available || !d.next_max_id) break;
      maxId = d.next_max_id;
    }
  } catch (e) {
    if (items.length) return items;
    if (userId && username && e.kind !== 'auth') return userFeed('', { max, username });
    throw e;
  }
  if (!items.length && userId && username) return userFeed('', { max, username });
  return items.slice(0, max);
}

/** Nettoie un hashtag saisi : « #Artiste 3D » → « artiste3d ». */
export const cleanTag = (tag) => tag.replace(/^#/, '').normalize('NFC').replace(/[^\p{L}\p{N}_]/gu, '').toLowerCase();

export async function hashtagMedia(tag) {
  const clean = cleanTag(tag);
  if (!clean) throw new IgError(`Hashtag invalide : « ${tag} »`, { kind: 'notfound' });
  let d;
  try {
    d = await request(`/api/v1/tags/web_info/?tag_name=${encodeURIComponent(clean)}`);
  } catch (e) {
    if (e.status === 404) throw new IgError(`Le hashtag #${clean} n’existe pas sur Instagram.`, { kind: 'notfound', status: 404 });
    throw e;
  }
  const all = [...collectMedia(d).values()];
  const count = d?.data?.media_count ?? d?.count ?? null;
  return { tag: clean, mediaCount: count, media: all };
}

export async function followers(userId, { max = 50 } = {}) {
  const users = [];
  let maxId = '';
  while (users.length < max) {
    const d = await request(`/api/v1/friendships/${userId}/followers/?count=25${maxId ? `&max_id=${maxId}` : ''}&search_surface=follow_list_page`);
    users.push(...(d.users || []).map(normalizeUser));
    if (!d.next_max_id) break;
    maxId = d.next_max_id;
  }
  return users.slice(0, max);
}

export async function likers(mediaPk) {
  const d = await request(`/api/v1/media/${mediaPk}/likers/`);
  return (d.users || []).map(normalizeUser);
}

const SHORTCODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** « https://www.instagram.com/p/DAbc123xyz_/ », « /reel/… » ou le code seul → code du post. */
export function codeFromRef(ref) {
  const m = String(ref).trim().match(/instagram\.com\/(?:[^/]+\/)?(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/) || String(ref).trim().match(/^([A-Za-z0-9_-]{6,})$/);
  if (!m) throw new IgError('Lien de post Instagram invalide', { kind: 'notfound' });
  return m[1];
}

/** Le shortcode est l'id du média encodé en base 64 (les 11 premiers caractères). */
export function shortcodeToPk(code) {
  let id = 0n;
  for (const c of code.slice(0, 11)) {
    const i = SHORTCODE_ALPHABET.indexOf(c);
    if (i < 0) throw new IgError('Code de post invalide', { kind: 'notfound' });
    id = id * 64n + BigInt(i);
  }
  return id.toString();
}

export async function mediaPkFromUrl(url) {
  return shortcodeToPk(codeFromRef(url));
}

/** URL de la meilleure qualité disponible (vidéo si présente, sinon plus grande image). */
function bestFile(m) {
  const video = [...(m.video_versions || [])].sort((a, b) => (b.width || 0) - (a.width || 0))[0];
  if (video?.url) return { url: video.url, type: 'video' };
  const img = [...(m.image_versions2?.candidates || [])].sort((a, b) => (b.width || 0) - (a.width || 0))[0];
  return img?.url ? { url: img.url, type: 'image' } : null;
}

/** Tous les fichiers d'une publication (chaque slide d'un carrousel). */
export async function mediaFiles(code) {
  const d = await request(`/api/v1/media/${shortcodeToPk(code)}/info/`);
  const item = d?.items?.[0];
  if (!item) throw new IgError('Publication introuvable', { kind: 'notfound', status: 404 });
  const parts = item.carousel_media?.length ? item.carousel_media : [item];
  return { username: item.user?.username || 'instagram', files: parts.map(bestFile).filter(Boolean) };
}

export async function mediaInfo(pk) {
  const d = await request(`/api/v1/media/${pk}/info/`);
  const item = d?.items?.[0];
  if (!item) throw new IgError('Post introuvable', { kind: 'notfound', status: 404 });
  const media = normalizeMedia(item);
  media.carouselCount = item.carousel_media_count || item.carousel_media?.length || 0;
  media.location = item.location?.name || '';
  media.usertags = (item.usertags?.in || []).map((t) => t.user?.username).filter(Boolean);
  media.duration = item.video_duration || 0;
  media.shares = item.share_count ?? item.reshare_count ?? null;
  media.saves = item.save_count ?? null;
  return media;
}

export async function friendship(userId) {
  return request(`/api/v1/friendships/show/${userId}/`);
}

// --- Likes ------------------------------------------------------------------
// Instagram change régulièrement l'adresse utilisée pour liker. On essaie les
// routes connues ; si toutes renvoient 404, on like « comme un humain » : la
// publication est ouverte dans un onglet d'arrière-plan et le content script
// clique sur le vrai bouton J'aime (Instagram envoie alors sa propre requête).

const LIKE_ROUTES = [
  (m) => ({ path: `/api/v1/web/likes/${m.pk}/like/` }),
  (m) => ({ path: `/web/likes/${m.pk}/like/` }),
  (m) => (m.ownerPk ? {
    path: `/api/v1/media/${m.pk}_${m.ownerPk}/like/`,
    body: new URLSearchParams({ media_id: `${m.pk}_${m.ownerPk}`, container_module: 'feed_contextual_hashtag' }),
  } : null),
];
const UI_MODE_MS = 24 * 3600 * 1000;

async function likeViaApi(m) {
  // Clé v2 : l'ancienne mémorisait parfois une route qui répondait 200 sans liker.
  const { likeRouteV2 = 0 } = await chrome.storage.local.get('likeRouteV2');
  const order = [likeRouteV2, ...LIKE_ROUTES.keys()].filter((v, i, a) => a.indexOf(v) === i);
  for (const i of order) {
    const r = LIKE_ROUTES[i]?.(m);
    if (!r) continue;
    try {
      const d = await request(r.path, { method: 'POST', body: r.body || new URLSearchParams() });
      if (d?.status !== 'ok') continue; // pas de confirmation explicite : route suivante
      await chrome.storage.local.set({ likeRouteV2: i });
      return true;
    } catch (e) {
      // Seuls les signaux d'Instagram (429, action bloquée, checkpoint, session) remontent et mettent
      // l'auto-like en pause. Route disparue, refusée (400/403) ou page HTML → route suivante, puis clic.
      if (['rate', 'feedback', 'checkpoint', 'auth'].includes(e.kind)) throw e;
    }
  }
  return false;
}

/** Instagram confirme-t-il que la publication est likée par toi ? (null = impossible à vérifier) */
export async function isLiked(pk) {
  try {
    const d = await request(`/api/v1/media/${pk}/info/`);
    const item = d?.items?.[0];
    return item ? Boolean(item.has_liked) : null;
  } catch {
    return null;
  }
}

/** Like via la page de la publication, dans un onglet épinglé d'arrière-plan réutilisé. */
export async function likeViaPage(code) {
  if (!code) throw new IgError('Code de publication manquant pour liker via la page', { kind: 'unknown' });
  const url = `${BASE}/p/${code}/`;
  if (likeTabId == null) likeTabId = (await chrome.storage.session.get('likeTabId')).likeTabId ?? null;
  let tab = likeTabId != null ? await chrome.tabs.get(likeTabId).catch(() => null) : null;
  if (tab) await chrome.tabs.update(tab.id, { url });
  else tab = await chrome.tabs.create({ url, active: false, pinned: true });
  likeTabId = tab.id;
  await chrome.storage.session.set({ likeTabId });
  await waitComplete(tab.id);
  await sleep(2500 + rand(0, 1500));
  let last = '';
  for (let i = 0; i < 6; i++) {
    let res = null;
    try {
      res = await chrome.tabs.sendMessage(tab.id, { type: 'igg:likeUi' }, { frameId: 0 });
    } catch {
      await chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [0] }, files: ['src/content/ig-ui.js'] }).catch(() => {});
    }
    if (res?.status === 'liked' || res?.status === 'already') return res.status;
    if (res?.status === 'blocked') throw new IgError('Instagram a bloqué l’action J’aime (action bloquée).', { kind: 'feedback' });
    last = res?.status || last;
    await sleep(1500);
  }
  throw new IgError(last === 'notconfirmed'
    ? 'Like non confirmé par Instagram (le cœur n’est pas passé au rouge) : non compté.'
    : 'Bouton J’aime introuvable sur la publication : non compté.', { kind: 'unknown' });
}

/**
 * Like RÉEL et vérifié : un like n'est compté que si Instagram le confirme.
 *  - API : route qui répond {status:"ok"}, puis contrôle has_liked sur la publication ;
 *  - sinon (ou si le contrôle échoue) : clic sur le vrai bouton J'aime, confirmé quand
 *    le cœur passe à « Je n'aime plus ».
 * @returns {{via: 'api'|'page'|'already', verified: boolean}}
 */
export async function likeMedia({ pk, ownerPk, code }) {
  const { likeUiUntil = 0 } = await chrome.storage.local.get('likeUiUntil');
  let apiSent = false;
  if (likeUiUntil < Date.now()) {
    apiSent = await likeViaApi({ pk, ownerPk });
    if (apiSent) {
      await sleep(1200);
      const liked = await isLiked(pk);
      if (liked === true) return { via: 'api', verified: true };
      // L'API a répondu « ok » sans que le like apparaisse : on ne lui fait plus confiance pendant 24 h.
      if (liked === false) await chrome.storage.local.set({ likeUiUntil: Date.now() + UI_MODE_MS });
    } else {
      // Toutes les routes ont disparu : mode « page » pour 24 h.
      await chrome.storage.local.set({ likeUiUntil: Date.now() + UI_MODE_MS });
    }
  }
  const status = await likeViaPage(code);
  if (status === 'already') return apiSent ? { via: 'api', verified: true } : { via: 'already', verified: true };
  return { via: 'page', verified: true };
}

export async function addComment(mediaPk, text) {
  return request(`/api/v1/web/comments/${mediaPk}/add/`, {
    method: 'POST',
    body: new URLSearchParams({ comment_text: text }),
  });
}

// --- Publication (expérimental) ---------------------------------------------

async function uploadPhoto(blob, { width, height, sidecar = false }) {
  const uploadId = String(Date.now()) + String(rand(100, 999));
  const name = `fb_uploader_${uploadId}`;
  const params = { media_type: 1, upload_id: uploadId, upload_media_height: height, upload_media_width: width };
  if (sidecar) params.is_sidecar = '1';
  await request(`/rupload_igphoto/${name}`, {
    method: 'POST',
    body: blob,
    headers: {
      'content-type': 'image/jpeg',
      'x-entity-type': 'image/jpeg',
      'x-entity-name': name,
      'x-entity-length': String(blob.size),
      offset: '0',
      'x-instagram-rupload-params': JSON.stringify(params),
    },
  });
  return uploadId;
}

/**
 * Publie une photo ou un carrousel de photos.
 * @param {{blob: Blob, width: number, height: number}[]} images
 */
export async function publishPhotos(images, caption) {
  if (!images.length) throw new IgError('Aucune image');
  if (images.length === 1) {
    const uploadId = await uploadPhoto(images[0].blob, images[0]);
    const d = await request('/api/v1/media/configure/', {
      method: 'POST',
      body: new URLSearchParams({
        source_type: 'library',
        caption,
        upload_id: uploadId,
        disable_comments: '0',
        like_and_view_counts_disabled: '0',
        igtv_share_preview_to_feed: '1',
        is_unified_video: '1',
        video_subtitles_enabled: '0',
      }),
    });
    return { pk: String(d.media?.pk || ''), code: d.media?.code || '' };
  }
  const ids = [];
  for (const img of images.slice(0, 10)) ids.push(await uploadPhoto(img.blob, { ...img, sidecar: true }));
  const d = await request('/api/v1/media/configure_sidecar/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      archive_only: false,
      caption,
      children_metadata: ids.map((upload_id) => ({ upload_id })),
      client_sidecar_id: String(Date.now()),
      disable_comments: '0',
      like_and_view_counts_disabled: false,
      source_type: 'library',
    }),
  });
  return { pk: String(d.media?.pk || ''), code: d.media?.code || '' };
}
