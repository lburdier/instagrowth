// Service worker : règles réseau, routeur de messages, moteur d'auto-like,
// recherche de leads, suivi des follow-backs, snapshots et programmation.

import * as ig from './lib/ig.js';
import { IgError } from './lib/ig.js';
import { db } from './lib/db.js';
import { getSettings, saveSettings, getState, setState, patchState } from './lib/store.js';
import { LIMITS, clampAutolike, effectiveDailyLimit } from './lib/limits.js';
import { dayKey, hourKey, rand, extractContacts } from './lib/util.js';
import { complete } from './lib/ai.js';

const APP_URL = chrome.runtime.getURL('src/app/app.html');
const ICON = chrome.runtime.getURL('icons/icon128.png');
const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';

// ---------------------------------------------------------------------------
// Règles declarativeNetRequest
// ---------------------------------------------------------------------------

const RULE_SW_ORIGIN = 1; // ancienne règle (v0.1), retirée au démarrage
const RULE_CDN_CORP = 2;
const frameRuleIds = (tabId) => [10_000 + (tabId % 1_000_000) * 2, 10_001 + (tabId % 1_000_000) * 2];

async function ensureBaseRules() {
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [RULE_SW_ORIGIN, RULE_CDN_CORP],
    addRules: [
      {
        // Autorise l'affichage des miniatures du CDN dans les pages de l'extension.
        id: RULE_CDN_CORP,
        priority: 1,
        action: { type: 'modifyHeaders', responseHeaders: [{ header: 'cross-origin-resource-policy', operation: 'remove' }] },
        condition: { initiatorDomains: [chrome.runtime.id], requestDomains: ['cdninstagram.com', 'fbcdn.net'], resourceTypes: ['image'] },
      },
    ],
  });
}

/** Instagram mobile intégré dans un onglet du dashboard (style Inssist). */
async function registerFrameTab(tabId) {
  const [a, b] = frameRuleIds(tabId);
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [a, b],
    addRules: [
      {
        id: a,
        priority: 2,
        action: {
          type: 'modifyHeaders',
          responseHeaders: [
            { header: 'x-frame-options', operation: 'remove' },
            { header: 'content-security-policy', operation: 'remove' },
            { header: 'content-security-policy-report-only', operation: 'remove' },
          ],
        },
        condition: { tabIds: [tabId], requestDomains: ['instagram.com', 'ig.me'], resourceTypes: ['sub_frame'] },
      },
      {
        id: b,
        priority: 2,
        action: {
          type: 'modifyHeaders',
          requestHeaders: [
            { header: 'user-agent', operation: 'set', value: MOBILE_UA },
            { header: 'sec-ch-ua-mobile', operation: 'set', value: '?1' },
            { header: 'sec-ch-ua-platform', operation: 'set', value: '"iOS"' },
          ],
        },
        condition: { tabIds: [tabId], requestDomains: ['instagram.com', 'cdninstagram.com', 'fbcdn.net'] },
      },
    ],
  });
}

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: frameRuleIds(tabId) }).catch(() => {});
});

// ---------------------------------------------------------------------------
// Installation / démarrage
// ---------------------------------------------------------------------------

async function ensureAlarms() {
  if (!(await chrome.alarms.get('autolike-tick'))) chrome.alarms.create('autolike-tick', { periodInMinutes: 1 });
  if (!(await chrome.alarms.get('daily'))) chrome.alarms.create('daily', { delayInMinutes: 1, periodInMinutes: 60 });
}

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  await ensureBaseRules();
  await ensureAlarms();
  if (reason === 'install') openApp('settings');
});
chrome.runtime.onStartup.addListener(async () => { await ensureBaseRules(); await ensureAlarms(); });
ensureBaseRules().catch(console.error);

async function openApp(hash = '') {
  const tabs = await chrome.tabs.query({ url: APP_URL + '*' });
  const url = APP_URL + (hash ? `#${hash}` : '');
  if (tabs[0]) {
    await chrome.tabs.update(tabs[0].id, { active: true, url });
    await chrome.windows.update(tabs[0].windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url });
  }
}

function notify(id, title, message) {
  chrome.notifications.create(id, { type: 'basic', iconUrl: ICON, title, message, priority: 1 });
}

// ---------------------------------------------------------------------------
// Connexion Claude : la console Claude ouvre la création de clé, le content
// script claude-connect.js propose « Connecter à InstaGrowth » en un clic.
// ---------------------------------------------------------------------------

const CLAUDE_KEYS_URL = 'https://platform.claude.com/settings/keys';
/** Nettoie une clé collée (espaces, retours à la ligne, guillemets) et détermine son type. */
export function classifyClaudeKey(raw) {
  const key = String(raw || '').replace(/\s+/g, '').replace(/^["'`]+|["'`]+$/g, '');
  if (!/^sk-ant-[A-Za-z0-9_-]{10,}$/.test(key)) {
    throw new Error('Ça ne ressemble pas à une clé Claude : elle doit commencer par « sk-ant- ».');
  }
  if (key.startsWith('sk-ant-admin')) {
    throw new Error('C’est une clé Admin : elle sert à gérer l’organisation et ne peut pas générer de texte. Crée une clé API standard (sk-ant-api…).');
  }
  // sk-ant-api… = clé API (en-tête x-api-key) ; les autres sk-ant-… (ex. sk-ant-oat…) sont des jetons OAuth (Bearer).
  return { key, kind: key.startsWith('sk-ant-api') ? 'apiKey' : 'oauth' };
}

async function verifyClaudeKey(key, kind) {
  const headers = { 'anthropic-version': '2023-06-01' };
  if (kind === 'apiKey') headers['x-api-key'] = key;
  else { headers.authorization = `Bearer ${key}`; headers['anthropic-beta'] = 'oauth-2025-04-20'; }
  const res = await fetch('https://api.anthropic.com/v1/models?limit=1', { headers });
  if (res.ok || res.status === 429) return;
  const detail = (await res.json().catch(() => ({})))?.error?.message || '';
  if (res.status === 401 || res.status === 403) {
    throw new Error(kind === 'apiKey'
      ? `Anthropic refuse cette clé (révoquée ou incomplète). ${detail}`.trim()
      : `L’API Claude refuse ce jeton OAuth${detail ? ` (${detail})` : ''}. Les jetons d’abonnement Claude.ai / Claude Code sont réservés à ces applications : utilise une clé API sk-ant-api… créée sur platform.claude.com.`);
  }
  throw new Error(`Vérification impossible (HTTP ${res.status}). Réessaie.`);
}

chrome.notifications.onClicked.addListener((id) => {
  if (id.startsWith('post:')) openApp(`publisher/${id.slice(5)}`);
  else if (id.startsWith('autolike')) openApp('autolike');
  else if (id.startsWith('leads')) openApp('leads');
  else openApp();
  chrome.notifications.clear(id);
});

// ---------------------------------------------------------------------------
// Leads
// ---------------------------------------------------------------------------

function leadFromUser(u, source, extra = {}) {
  const c = extractContacts(u.bio || '');
  return {
    pk: u.pk,
    username: u.username,
    fullName: u.fullName,
    pic: u.pic,
    bio: u.bio || '',
    followers: u.followers ?? null,
    following: u.following ?? null,
    posts: u.posts ?? null,
    isPrivate: u.isPrivate,
    isVerified: u.isVerified,
    isBusiness: u.isBusiness,
    category: u.category,
    email: u.publicEmail || c.email,
    phone: u.publicPhone || c.phone,
    externalUrl: u.externalUrl,
    source,
    status: 'new',
    score: null,
    scoreReason: '',
    notes: '',
    addedAt: Date.now(),
    ...extra,
  };
}

async function upsertLead(lead) {
  const cur = await db.get('leads', lead.pk);
  if (!cur) return db.put('leads', lead);
  // Ne pas écraser le travail commercial (statut, notes, score).
  const merged = { ...cur };
  for (const [k, v] of Object.entries(lead)) {
    if (['status', 'notes', 'score', 'scoreReason', 'addedAt', 'source'].includes(k)) continue;
    if (v !== undefined && v !== null && v !== '') merged[k] = v;
  }
  if (lead.likedAt) merged.likedAt = lead.likedAt;
  if (cur.status === 'new' && lead.status === 'liked') merged.status = 'liked';
  return db.put('leads', merged);
}

function matchesFilters(u, f) {
  if (f.skipPrivate && u.isPrivate) return 'privé';
  if (f.businessOnly && !u.isBusiness) return 'pas pro';
  if (f.minFollowers && (u.followers ?? 0) < f.minFollowers) return 'trop peu d’abonnés';
  if (f.maxFollowers && (u.followers ?? 0) > f.maxFollowers) return 'trop d’abonnés';
  const bio = `${u.bio || ''} ${u.fullName || ''} ${u.category || ''}`.toLowerCase();
  if (f.keywords?.length && !f.keywords.some((k) => bio.includes(k.toLowerCase()))) return 'mots-clés absents';
  if (f.exclude?.length && f.exclude.some((k) => bio.includes(k.toLowerCase()))) return 'mot exclu';
  if (f.requireContact) {
    const c = extractContacts(u.bio || '');
    if (!u.publicEmail && !u.publicPhone && !c.email && !c.phone) return 'pas de contact';
  }
  return null;
}

let leadJobAbort = false;

async function runLeadSearch({ source, query, max = 30, filters = {} }) {
  leadJobAbort = false;
  const job = { running: true, source, query, scanned: 0, found: 0, total: 0, startedAt: Date.now(), error: '', last: '' };
  const save = (p = {}) => setState('leadJob', Object.assign(job, p));
  await save();
  try {
    let candidates = [];
    let label = source;
    if (source === 'hashtag') {
      const { media } = await ig.hashtagMedia(query);
      const seen = new Set();
      for (const m of media) if (m.user && !seen.has(m.user.pk)) { seen.add(m.user.pk); candidates.push(m.user); }
      label = `#${query.replace(/^#/, '')}`;
    } else if (source === 'competitor') {
      const p = await ig.profileByUsername(query.replace(/^@/, ''));
      if (p.isPrivate && !p.followedByViewer) throw new IgError('Compte privé : impossible de lister ses abonnés.');
      candidates = await ig.followers(p.pk, { max: Math.min(200, max * 4) });
      label = `abonnés @${p.username}`;
    } else if (source === 'likers') {
      const pk = await ig.mediaPkFromUrl(query);
      candidates = await ig.likers(pk);
      label = 'likers post';
    } else if (source === 'usernames') {
      candidates = query.split(/[\s,;]+/).filter(Boolean).map((u) => ({ username: u.replace(/^@/, '') }));
      label = 'import';
    }
    const { userId } = await ig.session();
    candidates = candidates.filter((c) => c.pk !== userId);
    await save({ total: candidates.length });

    for (const c of candidates) {
      if (leadJobAbort || job.found >= max) break;
      job.scanned++;
      if (filters.skipPrivate && c.isPrivate) { await save({ last: `@${c.username} ignoré (privé)` }); continue; }
      if (filters.skipExisting && c.pk && (await db.get('leads', c.pk))) { await save({ last: `@${c.username} déjà en base` }); continue; }
      let full;
      try {
        full = await ig.profileByUsername(c.username);
      } catch (e) {
        if (e.kind === 'notfound') continue;
        throw e;
      }
      const reason = matchesFilters(full, filters);
      if (reason) { await save({ last: `@${full.username} ignoré (${reason})` }); continue; }
      await upsertLead(leadFromUser(full, label));
      job.found++;
      await save({ last: `@${full.username} ajouté` });
    }
    await save({ running: false, finishedAt: Date.now() });
    notify('leads-done', 'Recherche de leads terminée', `${job.found} leads ajoutés (${job.scanned} profils analysés).`);
  } catch (e) {
    await save({ running: false, error: e.message, finishedAt: Date.now() });
  }
}

// ---------------------------------------------------------------------------
// Auto-like
// ---------------------------------------------------------------------------

const AL_DEFAULT = {
  day: '', hour: '', likesToday: 0, likesThisHour: 0, nextActionAt: 0, pausedUntil: 0, pauseReason: '',
  firstRunDay: '', queue: [], liked: [], users: {}, log: [], history: {}, total: 0, sourceIdx: 0, status: '',
  // state : active | waiting | outside | limit | paused | nosource | off ; likedList : détail des comptes likés.
  state: 'off', resumeAt: 0, likedList: [], lastResult: '',
};

async function loadAL() { return { ...AL_DEFAULT, ...(await getState('autolike', {})) }; }

function alLog(st, kind, text, extra = {}) {
  st.log.unshift({ ts: Date.now(), kind, text, ...extra });
  st.log = st.log.slice(0, 200);
}

function pauseFor(st, err) {
  const map = { rate: LIMITS.pause.rateLimited, feedback: LIMITS.pause.feedback, checkpoint: LIMITS.pause.checkpoint, auth: 60 * 60 * 1000 };
  const ms = map[err.kind] ?? 30 * 60 * 1000;
  st.pausedUntil = Date.now() + ms;
  st.pauseReason = err.message;
  alLog(st, 'pause', `Pause ${Math.round(ms / 3600000 * 10) / 10} h : ${err.message}`);
  notify('autolike-pause', 'Auto-like en pause', `${err.message} — reprise automatique dans ${Math.round(ms / 60000)} min.`);
}

async function refillQueue(cfg, st) {
  const sources = [
    ...cfg.hashtags.map((h) => ({ type: 'hashtag', value: h })),
    ...cfg.competitors.map((c) => ({ type: 'competitor', value: c })),
  ];
  if (!sources.length) { st.status = 'Aucune source configurée'; st.state = 'nosource'; return; }
  const src = sources[st.sourceIdx % sources.length];
  st.sourceIdx++;
  const likedSet = new Set(st.liked);
  const { userId } = await ig.session();
  const fresh = [];
  if (src.type === 'hashtag') {
    const { media } = await ig.hashtagMedia(src.value);
    for (const m of media) {
      if (!m.user || m.user.pk === userId || m.likedByViewer || likedSet.has(m.pk) || st.users[m.user.pk]) continue;
      fresh.push({ userPk: m.user.pk, username: m.user.username, mediaPk: m.pk, code: m.code, thumb: m.thumb, source: `#${src.value.replace(/^#/, '')}` });
    }
  } else {
    const p = await ig.profileByUsername(src.value.replace(/^@/, ''));
    const fs = await ig.followers(p.pk, { max: 50 });
    for (const u of fs) {
      if (u.pk === userId || st.users[u.pk] || (cfg.skipPrivate && u.isPrivate)) continue;
      fresh.push({ userPk: u.pk, username: u.username, source: `abonnés @${p.username}` });
    }
  }
  // Mélange pour éviter un motif régulier.
  fresh.sort(() => Math.random() - 0.5);
  st.queue = [...st.queue, ...fresh].slice(0, 150);
  alLog(st, 'info', `${fresh.length} cibles ajoutées depuis ${src.type === 'hashtag' ? '#' + src.value.replace(/^#/, '') : '@' + src.value.replace(/^@/, '')}`);
}

let tickRunning = false;

/** @param {boolean} force « Liker maintenant » : ignore la plage horaire et le délai, garde les plafonds. */
async function autolikeTick(force = false) {
  if (tickRunning) return 'Un like est déjà en cours.';
  tickRunning = true;
  try {
    const s = await getSettings();
    const cfg = clampAutolike(s.autolike);
    const st = await loadAL();
    if (!cfg.enabled && !force) {
      if (st.state !== 'off') { st.state = 'off'; st.status = 'Désactivé'; await setState('autolike', st); }
      return 'Auto-like désactivé.';
    }
    const now = new Date();
    const today = dayKey(now);
    if (st.day !== today) { st.day = today; st.likesToday = 0; }
    if (st.hour !== hourKey(now)) { st.hour = hourKey(now); st.likesThisHour = 0; }
    if (!st.firstRunDay) st.firstRunDay = today;
    const limit = effectiveDailyLimit(cfg, st.firstRunDay, today);
    st.limitToday = limit;

    const stop = async (state, status) => { st.state = state; st.status = status; st.lastResult = status; await setState('autolike', st); return status; };
    const save = () => setState('autolike', st);
    if (st.pausedUntil > Date.now()) return stop('paused', `En pause : ${st.pauseReason}`);
    if (st.pausedUntil) { st.pausedUntil = 0; st.pauseReason = ''; alLog(st, 'info', 'Reprise après pause'); }
    const h = now.getHours();
    if (!force && (h < cfg.activeStart || h >= cfg.activeEnd)) {
      const resume = new Date(now);
      resume.setHours(cfg.activeStart, 0, 0, 0);
      if (h >= cfg.activeEnd) resume.setDate(resume.getDate() + 1);
      st.resumeAt = resume.getTime();
      return stop('outside', `En attente : reprise à ${cfg.activeStart}h (plage ${cfg.activeStart}h–${cfg.activeEnd}h)`);
    }
    if (st.likesToday >= limit) return stop('limit', `Limite du jour atteinte (${limit})`);
    if (st.likesThisHour >= cfg.hourlyLimit) return stop('limit', `Limite horaire atteinte (${cfg.hourlyLimit}/h)`);
    if (!force && Date.now() < st.nextActionAt) { st.state = 'waiting'; st.status = 'Actif : en attente du prochain like'; await save(); return st.status; }
    st.lastResult = 'Aucune cible valide trouvée pour l’instant.';

    try {
      if (st.queue.length < 3) await refillQueue(cfg, st);
      // Quelques tentatives par tick (cibles ignorées par les filtres).
      for (let attempt = 0; attempt < 4 && st.queue.length; attempt++) {
        const item = st.queue.shift();
        if (st.users[item.userPk]) continue;
        const needsProfile = !item.mediaPk || cfg.minFollowers > 0 || cfg.maxFollowers > 0 || cfg.blacklist.length || cfg.addToLeads;
        let profile = null;
        if (needsProfile) {
          try { profile = await ig.profileByUsername(item.username); } catch (e) { if (e.kind === 'notfound') continue; throw e; }
          const bio = `${profile.bio || ''} ${profile.fullName || ''}`.toLowerCase();
          const skip =
            (cfg.skipPrivate && profile.isPrivate && 'privé') ||
            (cfg.skipVerified && profile.isVerified && 'vérifié') ||
            (cfg.minFollowers && (profile.followers ?? 0) < cfg.minFollowers && 'trop peu d’abonnés') ||
            (cfg.maxFollowers && (profile.followers ?? 0) > cfg.maxFollowers && 'trop d’abonnés') ||
            (cfg.blacklist.some((w) => w && bio.includes(w.toLowerCase())) && 'mot blacklisté') ||
            (profile.followedByViewer && 'déjà suivi');
          if (skip) { st.users[item.userPk] = Date.now(); alLog(st, 'skip', `@${item.username} ignoré (${skip})`); continue; }
          if (!item.mediaPk) {
            const pool = profile.recent?.length ? profile.recent : await ig.userFeed(profile.pk, { max: 3, username: profile.username });
            const recent = pool.find((m) => !m.likedByViewer);
            if (!recent) { st.users[item.userPk] = Date.now(); alLog(st, 'skip', `@${item.username} ignoré (aucun post)`); continue; }
            Object.assign(item, { mediaPk: recent.pk, code: recent.code, thumb: recent.thumb });
          }
        }

        await ig.likeMedia(item.mediaPk);
        st.likesToday++; st.likesThisHour++; st.total++;
        st.history[today] = (st.history[today] || 0) + 1;
        st.liked = [item.mediaPk, ...st.liked].slice(0, 3000);
        st.users[item.userPk] = Date.now();
        alLog(st, 'like', `Post liké : @${item.username} (${item.source})`, { username: item.username, code: item.code, thumb: item.thumb });
        st.likedList = [{
          ts: Date.now(), userPk: item.userPk, username: item.username, mediaPk: item.mediaPk, code: item.code, thumb: item.thumb, source: item.source,
          fullName: profile?.fullName || '', pic: profile?.pic || '', followers: profile?.followers ?? null, following: profile?.following ?? null,
          posts: profile?.posts ?? null, bio: (profile?.bio || '').slice(0, 300), isVerified: Boolean(profile?.isVerified), isBusiness: Boolean(profile?.isBusiness),
          category: profile?.category || '', forced: force,
        }, ...st.likedList].slice(0, 1000);
        st.lastResult = `Post de @${item.username} liké (${item.source}).`;
        if (cfg.addToLeads && profile) await upsertLead(leadFromUser(profile, `auto-like ${item.source}`, { status: 'liked', likedAt: Date.now() }));

        let delay = rand(cfg.minDelaySec, cfg.maxDelaySec) * 1000;
        if (Math.random() < LIMITS.breakChance) {
          const mins = rand(...LIMITS.breakMinutes);
          delay += mins * 60_000;
          alLog(st, 'info', `Pause naturelle de ${mins} min`);
        }
        st.nextActionAt = Date.now() + delay;
        st.status = 'Actif';
        st.state = 'active';
        break;
      }
    } catch (e) {
      if (e instanceof IgError && ['rate', 'feedback', 'checkpoint', 'auth'].includes(e.kind)) { pauseFor(st, e); st.state = 'paused'; }
      else { alLog(st, 'error', e.message); st.nextActionAt = Date.now() + 5 * 60_000; }
      st.lastResult = e.message;
    }

    // Nettoyage : on garde 30 jours d'utilisateurs déjà touchés et d'historique.
    const cutoff = Date.now() - 30 * 86400000;
    for (const [k, t] of Object.entries(st.users)) if (t < cutoff) delete st.users[k];
    for (const d of Object.keys(st.history)) if (d < dayKey(new Date(cutoff))) delete st.history[d];
    await save();
    return st.lastResult;
  } finally {
    tickRunning = false;
  }
}

// ---------------------------------------------------------------------------
// Tâches quotidiennes : snapshot des stats + vérification des follow-backs
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Publications captées depuis les pages Instagram (voir content/ig-capture.js)
// ---------------------------------------------------------------------------

let captureWrite = Promise.resolve();

function storeCaptured(rawItems) {
  captureWrite = captureWrite.then(async () => {
    const all = await getState('captured', {});
    let changed = false;
    for (const raw of rawItems) {
      const m = ig.normalizeMedia(raw);
      const uname = m.user?.username?.toLowerCase();
      if (!uname || !m.pk || !m.code) continue;
      const entry = (all[uname] ||= { username: m.user.username, pk: m.user.pk, items: {}, updatedAt: 0 });
      entry.pk ||= m.user.pk;
      entry.items[m.pk] = { ...entry.items[m.pk], ...m, user: undefined };
      entry.updatedAt = Date.now();
      changed = true;
    }
    if (!changed) return;
    for (const e of Object.values(all)) {
      const items = Object.values(e.items).sort((a, b) => b.takenAt - a.takenAt).slice(0, 300);
      e.items = Object.fromEntries(items.map((i) => [i.pk, i]));
    }
    const users = Object.entries(all).sort((a, b) => b[1].updatedAt - a[1].updatedAt).slice(0, 60);
    await setState('captured', Object.fromEntries(users));
  }).catch((e) => console.warn('capture', e));
  return captureWrite;
}

async function capturedPosts(profile, since = 0) {
  const all = await getState('captured', {});
  const e = all[profile.username?.toLowerCase()] || Object.values(all).find((x) => profile.pk && x.pk === profile.pk);
  if (!e || e.updatedAt < since) return [];
  return Object.values(e.items).sort((a, b) => b.takenAt - a.takenAt);
}

/**
 * Dernier recours : ouvre le profil dans un onglet d'arrière-plan. La page
 * Instagram charge elle-même ses publications, ig-capture.js les récupère.
 */
async function capturePostsViaPage(profile) {
  const started = Date.now();
  const tab = await chrome.tabs.create({ url: `https://www.instagram.com/${encodeURIComponent(profile.username)}/`, active: false });
  try {
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const got = await capturedPosts(profile, started);
      if (got.length >= 6 || (got.length && i >= 8)) return got;
    }
    return capturedPosts(profile, started);
  } finally {
    chrome.tabs.remove(tab.id).catch(() => {});
  }
}

async function takeSnapshot(profile) {
  const me = profile || await ig.me();
  const snaps = await getState('snapshots', []);
  const today = dayKey();
  const entry = { date: today, followers: me.followers, following: me.following, posts: me.posts };
  const idx = snaps.findIndex((s) => s.date === today);
  if (idx >= 0) snaps[idx] = entry; else snaps.push(entry);
  await setState('snapshots', snaps.slice(-400));
}

async function checkFollowBacks() {
  const leads = await db.all('leads');
  const due = leads
    .filter((l) => l.status === 'liked' && l.likedAt && Date.now() - l.likedAt > 86400000 && l.followBack == null)
    .sort((a, b) => a.likedAt - b.likedAt)
    .slice(0, LIMITS.followBackChecksPerDay);
  let warm = 0;
  for (const l of due) {
    try {
      const f = await ig.friendship(l.pk);
      l.followBack = Boolean(f.followed_by);
      l.lastChecked = Date.now();
      if (l.followBack) { l.status = 'warm'; warm++; }
      await db.put('leads', l);
    } catch (e) {
      if (e.kind !== 'notfound') break;
    }
  }
  if (warm) notify('leads-warm', 'Nouveaux leads chauds', `${warm} personnes t’ont suivi après un like. Contacte-les depuis l’onglet Leads.`);
}

async function daily() {
  const last = await getState('lastDaily', '');
  const now = new Date();
  if (last === dayKey(now) || now.getHours() < 8) return;
  const { loggedIn } = await ig.session();
  if (!loggedIn) return;
  await setState('lastDaily', dayKey(now));
  try { await takeSnapshot(); } catch (e) { console.warn('snapshot', e); }
  try { await checkFollowBacks(); } catch (e) { console.warn('followback', e); }
}

// ---------------------------------------------------------------------------
// Publication / programmation
// ---------------------------------------------------------------------------

async function publishPost(id) {
  const post = await db.get('posts', id);
  if (!post) throw new Error('Post introuvable');
  if (post.media.some((m) => !m.type.startsWith('image/'))) throw new Error('La publication auto ne gère que les photos. Utilise le mode mobile pour les vidéos/reels.');
  const images = post.media.map((m) => ({ blob: m.blob, width: m.width, height: m.height }));
  try {
    const res = await ig.publishPhotos(images, post.caption || '');
    if (post.firstComment && res.pk) {
      try { await ig.addComment(res.pk, post.firstComment); } catch (e) { console.warn('first comment', e); }
    }
    Object.assign(post, { status: 'published', publishedAt: Date.now(), result: res, error: '' });
    await db.put('posts', post);
    return post;
  } catch (e) {
    Object.assign(post, { status: 'failed', error: e.message });
    await db.put('posts', post);
    throw e;
  }
}

async function onPostAlarm(id) {
  const post = await db.get('posts', id);
  if (!post || post.status !== 'scheduled') return;
  const s = await getSettings();
  const title = (post.caption || 'Sans légende').slice(0, 60);
  if (s.publish.mode === 'auto' && post.media.every((m) => m.type.startsWith('image/'))) {
    try {
      const p = await publishPost(id);
      notify(`post:${id}`, 'Publié sur Instagram', p.result?.code ? `instagram.com/p/${p.result.code}` : title);
    } catch (e) {
      notify(`post:${id}`, 'Échec de publication', `${e.message} — clique pour publier manuellement.`);
    }
  } else {
    post.status = 'due';
    await db.put('posts', post);
    notify(`post:${id}`, 'C’est l’heure de publier', `${title} — clique pour ouvrir le post.`);
  }
}

// ---------------------------------------------------------------------------
// Alarmes + routeur de messages
// ---------------------------------------------------------------------------

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'autolike-tick') autolikeTick();
  else if (alarm.name === 'daily') daily();
  else if (alarm.name.startsWith('post:')) onPostAlarm(alarm.name.slice(5));
});

const handlers = {
  async 'frame:register'(_, sender) { await registerFrameTab(sender.tab.id); return true; },
  async 'app:open'({ hash }) { await openApp(hash); return true; },

  async 'ig:session'() { return ig.session(); },
  async 'capture:media'({ items }) { if (Array.isArray(items) && items.length) await storeCaptured(items.slice(0, 500)); return true; },
  async 'claude:startConnect'(_, sender) {
    const tab = await chrome.tabs.create({ url: CLAUDE_KEYS_URL, openerTabId: sender.tab?.id });
    await setState('claudeConnect', { consoleTabId: tab.id, returnTabId: sender.tab?.id ?? null, startedAt: Date.now() });
    return true;
  },
  async 'claude:connect'({ key }, sender) {
    const { key: clean, kind } = classifyClaudeKey(key);
    await verifyClaudeKey(clean, kind);
    await saveSettings({ ai: { provider: 'anthropic', anthropic: kind === 'apiKey' ? { authType: 'apiKey', apiKey: clean } : { authType: 'oauth', oauthToken: clean } } });
    const flow = await getState('claudeConnect', null);
    await setState('claudeConnect', null);
    if (flow?.returnTabId != null) chrome.tabs.update(flow.returnTabId, { active: true }).catch(() => {});
    if (flow?.consoleTabId === sender.tab?.id) setTimeout(() => chrome.tabs.remove(sender.tab.id).catch(() => {}), 1800);
    notify('claude-ok', 'Claude est connecté', 'InstaGrowth utilise maintenant ta clé Claude pour l’IA.');
    return true;
  },
  async 'ig:postInsight'({ ref }) {
    const media = await ig.mediaInfo(ig.shortcodeToPk(ig.codeFromRef(ref)));
    const { userId } = await ig.session();
    const ownerName = media.user?.username;
    const owner = media.user?.pk === userId ? await ig.me() : ownerName ? await ig.profileByUsername(ownerName).catch(() => null) : null;
    let recent = [];
    try { recent = await ig.userFeed(owner?.pk || media.user?.pk, { max: 12, username: ownerName }); } catch { /* comparaison facultative */ }
    return { media, owner, recent: recent.filter((p) => p.pk !== media.pk) };
  },
  async 'ai:complete'({ opts }) { return complete(opts); },
  async 'ig:me'() { return ig.me(); },
  async 'ig:stats'({ username }) {
    const self = !username;
    const profile = self ? await ig.me({ fresh: true }) : await ig.profileByUsername(username.replace(/^@/, ''));
    let posts = [];
    let postsSource = 'api';
    let postsError = '';
    if (!profile.isPrivate || self || profile.followedByViewer) {
      try {
        posts = await ig.userFeed(profile.pk, { max: 36, username: profile.username });
      } catch (e) {
        if (e.kind === 'auth') throw e;
        postsError = e.message;
      }
      if (!posts.length && profile.posts !== 0) {
        // Secours : publications captées sur les pages Instagram, sinon visite du profil en arrière-plan.
        posts = await capturedPosts(profile);
        if (!posts.length) posts = await capturePostsViaPage(profile).catch(() => []);
        postsSource = posts.length ? 'capture' : 'none';
      }
    }
    if (self) await takeSnapshot(profile).catch(() => {});
    return { profile, posts: posts.slice(0, 60), postsSource, postsError, snapshots: self ? await getState('snapshots', []) : [] };
  },
  async 'ig:hashtag'({ tag }) {
    const r = await ig.hashtagMedia(tag);
    const likes = r.media.map((m) => m.likes);
    return { tag: r.tag, mediaCount: r.mediaCount, sample: r.media.length, avgLikes: likes.length ? likes.reduce((a, b) => a + b, 0) / likes.length : 0 };
  },

  async 'leads:search'(payload) {
    const job = await getState('leadJob', {});
    if (job.running) throw new Error('Une recherche est déjà en cours.');
    runLeadSearch(payload); // en arrière-plan, progression via storage
    return true;
  },
  async 'leads:stop'() { leadJobAbort = true; await patchState('leadJob', { running: false }); return true; },
  async 'leads:addByUsername'({ username }) {
    const p = await ig.profileByUsername(username);
    await upsertLead(leadFromUser(p, 'ajout manuel'));
    return { username: p.username };
  },
  async 'leads:checkFollowBacks'() { await checkFollowBacks(); return true; },

  async 'autolike:tick'() { await autolikeTick(); return loadAL(); },
  async 'autolike:runNow'() { return autolikeTick(true); },
  async 'autolike:resume'() { await patchState('autolike', { pausedUntil: 0, pauseReason: '', nextActionAt: 0 }); return true; },
  async 'autolike:resetQueue'() { await patchState('autolike', { queue: [] }); return true; },

  async 'post:publishNow'({ id }) { return publishPost(id); },
  async 'post:schedule'({ id }) {
    const post = await db.get('posts', id);
    if (!post?.scheduledAt) throw new Error('Date de programmation manquante');
    await chrome.alarms.create(`post:${id}`, { when: Math.max(Date.now() + 5000, post.scheduledAt) });
    return true;
  },
  async 'post:unschedule'({ id }) { await chrome.alarms.clear(`post:${id}`); return true; },
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const fn = handlers[msg?.type];
  if (!fn) return false;
  fn(msg, sender)
    .then((data) => sendResponse({ ok: true, data }))
    .catch((e) => sendResponse({ ok: false, error: e.message, kind: e.kind || '' }));
  return true;
});
