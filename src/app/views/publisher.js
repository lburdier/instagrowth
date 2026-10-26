// Vue Publication : éditeur (photos/carrousel, recadrage), légendes & hashtags IA,
// aperçu, brouillons, programmation et calendrier.

import { send, busy, toast, $, $$, navigate, activeAccountId } from '../ui.js';
import { TUTOS } from '../tutorial.js';
import { db } from '../../lib/db.js';
import { complete } from '../../lib/ai.js';
import { getSettings, saveSettings } from '../../lib/store.js';
import { escapeHtml, uid, fmtDate, fmtNum, extractHashtags } from '../../lib/util.js';
import { icon } from '../../lib/icons.js';

let el;
let draft;
let posts = [];
let calMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

const RATIOS = { '1:1': 1, '4:5': 4 / 5, '1.91:1': 1.91, orig: null };
const STATUS_LABEL = { draft: 'Brouillon', scheduled: 'Programmé', due: 'À publier', published: 'Publié', failed: 'Échec' };
const MAX_CAPTION = 2200, MAX_TAGS = 30;

function newDraft() {
  return { id: uid(), media: [], caption: '', firstComment: '', ratio: '4:5', scheduledAt: null, status: 'draft', createdAt: Date.now() };
}

// --- Images -----------------------------------------------------------------

function loadImage(blob) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = URL.createObjectURL(blob);
  });
}

/** Recadre au centre selon le ratio, redimensionne (≤ 1440 px de large), exporte en JPEG. */
async function processImage(orig, ratioKey) {
  const img = await loadImage(orig);
  let r = RATIOS[ratioKey];
  const src = img.naturalWidth / img.naturalHeight;
  if (r == null) r = Math.min(1.91, Math.max(0.8, src)); // Instagram accepte 4:5 → 1.91:1
  let sw = img.naturalWidth, sh = img.naturalHeight, sx = 0, sy = 0;
  if (src > r) { sw = sh * r; sx = (img.naturalWidth - sw) / 2; } else { sh = sw / r; sy = (img.naturalHeight - sh) / 2; }
  const width = Math.min(1440, Math.round(sw));
  const height = Math.round(width / r);
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, width, height);
  URL.revokeObjectURL(img.src);
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
  return { blob, width, height, type: 'image/jpeg', orig };
}

async function addFiles(files) {
  for (const f of files) {
    if (draft.media.length >= 10) { toast('10 médias maximum par carrousel.', 'err'); break; }
    if (f.type.startsWith('image/')) draft.media.push(await processImage(f, draft.ratio));
    else if (f.type.startsWith('video/')) draft.media.push({ blob: f, type: f.type, width: 0, height: 0, orig: f });
  }
  renderEditor();
}

async function applyRatio(key) {
  draft.ratio = key;
  draft.media = await Promise.all(draft.media.map((m) => (m.type.startsWith('image/') ? processImage(m.orig || m.blob, key) : m)));
  renderEditor();
}

// --- Rendu ------------------------------------------------------------------

const urlCache = new WeakMap();
function blobUrl(blob) {
  if (!urlCache.has(blob)) urlCache.set(blob, URL.createObjectURL(blob));
  return urlCache.get(blob);
}

function highlightCaption(text) {
  return escapeHtml(text).replace(/(#[\p{L}\p{N}_]+|@[\w.]+)/gu, '<span class="hashtag">$1</span>');
}

function renderEditor() {
  const strip = $('#pub-media', el);
  strip.innerHTML = draft.media.map((m, i) => `
    <div class="media-item" draggable="true" data-i="${i}" style="background-image:url('${m.type.startsWith('image/') ? blobUrl(m.blob) : ''}')">
      <span class="idx">${i + 1}</span>${m.type.startsWith('video/') ? `<span class="vid">${icon('video', 22)}</span>` : ''}<button class="rm" data-rm="${i}" title="Retirer">${icon('x', 12)}</button></div>`).join('');
  $$('#pub-ratio button', el).forEach((b) => b.classList.toggle('active', b.dataset.r === draft.ratio));
  $('#pub-caption', el).value = draft.caption;
  $('#pub-comment', el).value = draft.firstComment;
  $('#pub-when', el).value = draft.scheduledAt ? toLocalInput(draft.scheduledAt) : '';
  $('#pub-edit-label', el).textContent = draft.status === 'draft' && !posts.some((p) => p.id === draft.id) ? 'Nouveau post' : `Édition — ${STATUS_LABEL[draft.status]}`;
  updateCounters();
  renderPreview();
}

function updateCounters() {
  const c = draft.caption;
  const tags = extractHashtags(c + ' ' + draft.firstComment).length;
  const mentions = (c.match(/@[\w.]+/g) || []).length;
  $('#pub-counters', el).innerHTML = `
    <span class="counter ${c.length > MAX_CAPTION ? 'over' : ''}">${c.length} / ${MAX_CAPTION} caractères</span> ·
    <span class="counter ${tags > MAX_TAGS ? 'over' : ''}">${tags} / ${MAX_TAGS} hashtags</span> ·
    <span class="counter">${mentions} mention(s)</span>`;
}

async function renderPreview() {
  const me = (await chrome.storage.local.get('me')).me || { username: 'ton_compte', pic: '' };
  const first = draft.media[0];
  const r = first?.width ? first.height / first.width : 1.25;
  const cap = draft.caption;
  const short = cap.length > 125 ? cap.slice(0, 125) : cap;
  $('#pub-preview', el).innerHTML = `
    <div class="ig-preview">
      <header><div class="avatar" style="width:30px;height:30px;background-image:url('${escapeHtml(me.pic)}')"></div>${escapeHtml(me.username)}</header>
      <div class="img" style="padding-top:${(r * 100).toFixed(2)}%;${first?.type.startsWith('image/') ? `background-image:url('${blobUrl(first.blob)}')` : ''}">
        ${first?.type.startsWith('video/') ? `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#fff">${icon('video', 48)}</div>` : ''}
        ${!first ? '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center" class="muted">Aperçu</div>' : ''}
        ${draft.media.length > 1 ? `<div class="dots">${draft.media.map((_, i) => `<span class="${i ? '' : 'on'}"></span>`).join('')}</div>` : ''}
      </div>
      <div class="actions">${icon('heart', 24)}${icon('message', 24)}${icon('send', 24)}<span class="spacer"></span>${icon('save', 24)}</div>
      <div class="caption"><strong>${escapeHtml(me.username)}</strong> ${highlightCaption(short)}${cap.length > 125 ? '<span class="more">… plus</span>' : ''}</div>
    </div>
    ${draft.firstComment ? `<p class="muted" style="margin-top:8px">1er commentaire : ${highlightCaption(draft.firstComment.slice(0, 120))}</p>` : ''}`;
}

function toLocalInput(ts) {
  const d = new Date(ts);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

async function loadPosts() {
  const acct = await activeAccountId();
  posts = (await db.all('posts'))
    .filter((p) => !p.owner || p.owner === acct)
    .sort((a, b) => (b.scheduledAt || b.createdAt) - (a.scheduledAt || a.createdAt));
  renderCalendar();
  renderList();
}

function renderCalendar() {
  const y = calMonth.getFullYear(), m = calMonth.getMonth();
  $('#cal-title', el).textContent = calMonth.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  const start = new Date(y, m, 1);
  const offset = (start.getDay() + 6) % 7; // lundi en premier
  const days = [];
  for (let i = 0; i < 42; i++) days.push(new Date(y, m, 1 - offset + i));
  const todayStr = new Date().toDateString();
  const byDay = {};
  for (const p of posts) {
    const ts = p.publishedAt || p.scheduledAt;
    if (!ts) continue;
    (byDay[new Date(ts).toDateString()] ||= []).push(p);
  }
  $('#cal', el).innerHTML = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'].map((d) => `<div class="dow">${d}</div>`).join('') +
    days.map((d) => `<div class="day ${d.getMonth() !== m ? 'other' : ''} ${d.toDateString() === todayStr ? 'today' : ''}" data-date="${d.getTime()}">
      <div class="n">${d.getDate()}</div>
      ${(byDay[d.toDateString()] || []).map((p) => `<div class="ev ${p.status}" data-id="${p.id}" title="${escapeHtml(p.caption.slice(0, 120))}">
        <i style="background-image:url('${p.media[0]?.type.startsWith('image/') ? blobUrl(p.media[0].blob) : ''}')"></i>
        ${new Date(p.publishedAt || p.scheduledAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</div>`).join('')}
    </div>`).join('');
}

function renderList() {
  $('#pub-list', el).innerHTML = posts.length ? posts.map((p) => `
    <div class="log-item" data-id="${p.id}">
      <div class="thumb" style="width:44px;height:44px;background-image:url('${p.media[0]?.type.startsWith('image/') ? blobUrl(p.media[0].blob) : ''}')"></div>
      <div style="flex:1;min-width:0">
        <div class="row" style="gap:6px"><span class="badge ${p.status === 'published' ? 'won' : p.status === 'scheduled' ? 'liked' : p.status === 'draft' ? '' : 'warm'}">${STATUS_LABEL[p.status]}</span>
        <small>${p.scheduledAt || p.publishedAt ? fmtDate(p.publishedAt || p.scheduledAt) : 'sans date'} · ${p.media.length} média(s)</small></div>
        <div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(p.caption.slice(0, 140)) || '<span class="muted">Sans légende</span>'}</div>
        ${p.error ? `<small style="color:var(--bad)">${escapeHtml(p.error)}</small>` : ''}
        ${p.result?.code ? `<small><a href="https://www.instagram.com/p/${p.result.code}/" target="_blank">Voir sur Instagram</a></small>` : ''}
      </div>
      <button class="sm" data-act="edit">Ouvrir</button>
      <button class="sm icon-btn" data-act="dup" title="Dupliquer">${icon('copy', 16)}</button>
      <button class="sm ghost icon-btn" data-act="del" title="Supprimer">${icon('trash', 16)}</button>
    </div>`).join('') : '<div class="empty">Aucun post enregistré.</div>';
}

// --- Persistance & actions -----------------------------------------------------

function serializable() {
  return { ...draft, media: draft.media.map(({ blob, width, height, type }) => ({ blob, width, height, type })) };
}

async function persist(status = draft.status) {
  draft.status = status;
  draft.caption = $('#pub-caption', el).value;
  draft.firstComment = $('#pub-comment', el).value;
  draft.owner ||= await activeAccountId();
  await db.put('posts', serializable());
  await loadPosts();
}

function validate() {
  if (!draft.media.length) throw new Error('Ajoute au moins une photo ou vidéo.');
  if (draft.caption.length > MAX_CAPTION) throw new Error('Légende trop longue (2200 caractères max).');
  if (extractHashtags(draft.caption + ' ' + draft.firstComment).length > MAX_TAGS) throw new Error('30 hashtags maximum.');
}

async function schedule() {
  draft.caption = $('#pub-caption', el).value;
  validate();
  const when = $('#pub-when', el).value;
  if (!when) throw new Error('Choisis une date et une heure.');
  const ts = new Date(when).getTime();
  if (ts < Date.now() + 60_000) throw new Error('La date doit être dans le futur.');
  draft.scheduledAt = ts;
  await persist('scheduled');
  await send('post:schedule', { id: draft.id });
  const { publish } = await getSettings();
  toast(publish.mode === 'auto' ? `Programmé : publication auto le ${fmtDate(ts)} (navigateur ouvert)` : `Programmé : rappel le ${fmtDate(ts)}`);
  edit(newDraft());
}

async function publishNow() {
  draft.caption = $('#pub-caption', el).value;
  validate();
  if (draft.media.some((m) => !m.type.startsWith('image/'))) throw new Error('Les vidéos/reels se publient via « Insta mobile » (bouton à côté).');
  if (!confirm('Publier maintenant sur Instagram ?\n\nPublication via l’API web non officielle (expérimental). En cas d’échec, utilise « Insta mobile ».')) return;
  await persist(draft.status);
  const p = await send('post:publishNow', { id: draft.id });
  toast(`Publié ${p.result?.code ? 'instagram.com/p/' + p.result.code : ''}`);
  await loadPosts();
  edit(newDraft());
}

async function openInMobile() {
  draft.caption = $('#pub-caption', el).value;
  await navigator.clipboard.writeText(draft.caption).catch(() => {});
  // Télécharge les médias pour les sélectionner depuis le sélecteur de fichiers d'Instagram.
  draft.media.forEach((m, i) => {
    const a = document.createElement('a');
    a.href = blobUrl(m.blob);
    a.download = `instagrowth-${draft.id}-${i + 1}.${m.type.split('/')[1] || 'jpg'}`;
    a.click();
  });
  toast('Légende copiée et médias enregistrés : appuie sur « + » dans Insta mobile.');
  navigate('mobile/create');
}

function edit(p) {
  draft = { ...p, media: p.media.map((m) => ({ ...m, orig: m.orig || m.blob })) };
  renderEditor();
}

// --- IA ---------------------------------------------------------------------

async function aiCaptions() {
  const brief = $('#ai-brief', el).value.trim();
  if (!brief && !draft.caption) throw new Error('Décris ton post (sujet, message, offre) dans le brief.');
  const res = await complete({
    json: true,
    effort: 'low',
    maxTokens: 3000,
    prompt: `Écris 3 légendes Instagram différentes pour ce post.
Brief : ${brief || draft.caption}
Format du post : ${draft.media.length > 1 ? 'carrousel de ' + draft.media.length + ' slides' : draft.media[0]?.type.startsWith('video/') ? 'reel/vidéo' : 'photo'}.
Style : ${$('#ai-style', el).value}.
Chaque légende : accroche forte en 1re ligne (moins de 125 caractères), corps aéré avec sauts de ligne, appel à l’action clair, emojis avec parcimonie, SANS hashtags.
Format : [{"angle": "nom court de l’angle", "caption": "..."}]`,
  });
  $('#ai-captions', el).innerHTML = (Array.isArray(res) ? res : []).map((c, i) => `
    <div class="card" style="padding:12px;margin-top:8px">
      <div class="row between"><strong>${escapeHtml(c.angle || `Option ${i + 1}`)}</strong><button class="sm" data-use="${i}">Utiliser</button></div>
      <div style="white-space:pre-wrap;font-size:13px;margin-top:6px">${escapeHtml(c.caption)}</div>
    </div>`).join('');
  $$('#ai-captions [data-use]', el).forEach((b) => b.onclick = () => {
    const tags = draft.caption.match(/(\s*#[\p{L}\p{N}_]+)+\s*$/u)?.[0] || '';
    draft.caption = res[b.dataset.use].caption + (tags ? '\n\n' + tags.trim() : '');
    renderEditor();
  });
}

async function aiRewrite(instruction) {
  draft.caption = $('#pub-caption', el).value;
  if (!draft.caption.trim()) throw new Error('La légende est vide.');
  draft.caption = await complete({
    effort: 'low',
    maxTokens: 2500,
    prompt: `${instruction}\nConserve les hashtags existants à la fin. Réponds uniquement avec la nouvelle légende.\n\nLégende :\n${draft.caption}`,
  });
  renderEditor();
}

async function aiHashtags() {
  const topic = $('#ai-brief', el).value.trim() || $('#pub-caption', el).value.slice(0, 600);
  if (!topic) throw new Error('Écris un brief ou une légende d’abord.');
  const res = await complete({
    json: true,
    effort: 'low',
    maxTokens: 2000,
    prompt: `Propose des hashtags Instagram pour ce post : "${topic}".
Mélange 3 niveaux : larges (très populaires), niche (moyens, ciblés), spécifiques (petits, très précis). Langue adaptée à l’audience.
Pas de hashtags bannis ni génériques type #love #instagood.
Format : {"larges": ["#..."], "niche": ["#..."], "specifiques": ["#..."]} — 5 à 8 par niveau.`,
  });
  const group = (name, arr = []) => `<div style="margin-top:8px"><small class="muted">${name}</small><div class="chips">${arr.map((t) => `<span class="chip click" data-tag="${escapeHtml(t.startsWith('#') ? t : '#' + t)}">${escapeHtml(t.startsWith('#') ? t : '#' + t)}</span>`).join('')}</div></div>`;
  $('#ai-tags', el).innerHTML = group('Larges', res.larges) + group('Niche', res.niche) + group('Spécifiques', res.specifiques) +
    '<div class="row" style="margin-top:8px"><button class="sm" id="tags-all">Tout ajouter</button><button class="sm" id="tags-volume">Volume des hashtags</button><button class="sm" id="tags-save">Enregistrer comme set</button></div>';
}

function addTag(tag) {
  draft.caption = $('#pub-caption', el).value;
  if (extractHashtags(draft.caption).includes(tag.toLowerCase())) return;
  draft.caption = draft.caption.replace(/\s*$/, '') + (/#[\p{L}\p{N}_]+\s*$/u.test(draft.caption) ? ' ' : '\n\n') + tag;
  renderEditor();
}

async function tagVolumes() {
  const chips = $$('#ai-tags .chip', el).slice(0, 12);
  for (const c of chips) {
    try {
      const r = await send('ig:hashtag', { tag: c.dataset.tag });
      c.textContent = `${c.dataset.tag} · ${r.mediaCount != null ? fmtNum(r.mediaCount) : '?'} posts`;
    } catch (e) { c.title = e.message; }
  }
}

async function renderSets() {
  const { publish } = await getSettings();
  $('#tag-sets', el).innerHTML = publish.defaultHashtagSets.map((s, i) => `
    <span class="chip click" data-set="${i}" title="${escapeHtml(s.tags.join(' '))}">${icon('tag', 14)} ${escapeHtml(s.name)} (${s.tags.length})<button data-delset="${i}" title="Supprimer le set">${icon('x', 12)}</button></span>`).join('') || '<small class="muted">Aucun set enregistré.</small>';
}

async function bestSlotSuggestion() {
  const { bestSlot } = await chrome.storage.local.get('bestSlot');
  const box = $('#best-slot', el);
  if (!bestSlot) { box.innerHTML = '<small class="muted">Analyse ton compte dans « Statistiques » pour obtenir ton meilleur créneau.</small>'; return; }
  const days = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  const d = new Date();
  d.setHours(bestSlot.hour, 0, 0, 0);
  while (d.getDay() !== bestSlot.day || d < new Date(Date.now() + 10 * 60000)) d.setDate(d.getDate() + 1);
  box.innerHTML = `<span class="chip click" id="use-slot">${icon('star', 14)} Meilleur créneau : ${days[bestSlot.day]} ${bestSlot.hour}h → ${fmtDate(d.getTime())}</span>`;
  $('#use-slot', el).onclick = () => { $('#pub-when', el).value = toLocalInput(d.getTime()); };
}

// --- Montage ----------------------------------------------------------------

export default {
  async mount(root) {
    el = root;
    el.innerHTML = `
      <div class="view-head">
        <div><h1>Publication</h1><p class="muted">Crée, optimise avec l’IA, programme et publie tes posts depuis ton ordinateur.</p></div>
        <button id="pub-new"><i data-i="plus" data-s="16"></i> Nouveau post</button>
      </div>
      ${TUTOS.publisher()}
      <div class="grid g2" style="margin-bottom:16px;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr)">
        <div class="stack">
          <div class="card">
            <div class="row between"><h2 id="pub-edit-label" style="margin:0">Nouveau post</h2>
              <div class="tabs" id="pub-ratio">${Object.keys(RATIOS).map((k) => `<button data-r="${k}">${k === 'orig' ? 'Original' : k}</button>`).join('')}</div></div>
            <div class="dropzone" id="pub-drop" style="margin-top:12px"><div class="drop-ico"><i data-i="image" data-s="32"></i></div>Glisse tes photos/vidéos ici ou <u>clique pour choisir</u><br><small>Jusqu’à 10 médias (carrousel) · réordonne par glisser-déposer</small></div>
            <input type="file" id="pub-file" accept="image/*,video/*" multiple hidden>
            <div class="media-strip" id="pub-media"></div>

            <div class="field"><label>Légende</label><textarea id="pub-caption" rows="9" placeholder="Accroche percutante…"></textarea>
              <div id="pub-counters"></div></div>
            <div class="row" style="margin-bottom:12px">
              <button class="sm" data-rw="Améliore cette légende Instagram : accroche plus forte, meilleure lisibilité, CTA plus clair."><i data-i="sparkle" data-s="14"></i> Améliorer</button>
              <button class="sm" data-rw="Raccourcis cette légende de moitié en gardant l’essentiel et l’accroche."><i data-i="scissors" data-s="14"></i> Raccourcir</button>
              <button class="sm" data-rw="Ajoute un appel à l’action engageant à la fin (question ou incitation à sauvegarder/partager)."><i data-i="megaphone" data-s="14"></i> Ajouter un CTA</button>
              <button class="sm" data-rw="Ajoute quelques emojis pertinents sans en abuser."><i data-i="smile" data-s="14"></i> Emojis</button>
              <button class="sm" data-rw="Traduis cette légende en anglais naturel, ton identique."><i data-i="globe" data-s="14"></i> EN</button>
            </div>
            <div class="field"><label>1er commentaire (hashtags, lien…) — publié automatiquement après le post</label><textarea id="pub-comment" rows="2"></textarea></div>
            <div class="field"><label>Sets de hashtags</label><div class="chips" id="tag-sets"></div></div>

            <div class="row" style="align-items:flex-end">
              <div class="field" style="margin:0;flex:1;min-width:200px"><label>Programmer pour</label><input type="datetime-local" id="pub-when"></div>
              <button class="primary" id="pub-schedule"><i data-i="calendar" data-s="16"></i> Programmer</button>
            </div>
            <div id="best-slot" style="margin:8px 0 12px"></div>
            <div class="row">
              <button id="pub-save"><i data-i="save" data-s="16"></i> Brouillon</button>
              <button id="pub-now"><i data-i="rocket" data-s="16"></i> Publier maintenant</button>
              <button id="pub-mobile"><i data-i="phone" data-s="16"></i> Publier via Insta mobile</button>
            </div>
          </div>

          <div class="card">
            <h2 class="h-ico"><i data-i="sparkle"></i> Assistant IA</h2>
            <div class="field"><label>Brief du post</label><textarea id="ai-brief" rows="3" placeholder="Ex. : carrousel 5 erreurs de débutant en musculation, offre coaching -20 % jusqu’à dimanche"></textarea></div>
            <div class="row">
              <select id="ai-style" style="width:auto">
                <option>storytelling personnel</option><option>éducatif et actionnable</option><option>inspirant</option>
                <option>humoristique</option><option>vendeur sans être agressif</option><option>court et punchy</option>
              </select>
              <button class="primary" id="ai-gen"><i data-i="pen" data-s="16"></i> 3 légendes</button>
              <button id="ai-hash"><i data-i="hash" data-s="16"></i> Hashtags</button>
            </div>
            <div id="ai-captions"></div>
            <div id="ai-tags"></div>
          </div>
        </div>

        <div class="stack">
          <div class="card"><h2>Aperçu</h2><div id="pub-preview"></div></div>
          <div class="card"><h2>Mes posts</h2><div class="log" id="pub-list" style="max-height:520px"></div></div>
        </div>
      </div>

      <div class="card">
        <div class="row between" style="margin-bottom:10px">
          <h2 style="margin:0">Calendrier éditorial</h2>
          <div class="row"><button class="sm icon-btn" id="cal-prev"><i data-i="chevronLeft" data-s="16"></i></button><strong id="cal-title" style="min-width:140px;text-align:center;text-transform:capitalize"></strong><button class="sm icon-btn" id="cal-next"><i data-i="chevronRight" data-s="16"></i></button></div>
        </div>
        <div class="cal" id="cal"></div>
      </div>`;

    const { publish } = await getSettings();
    if (publish.mode !== 'auto') {
      $('#best-slot', el).insertAdjacentHTML('afterend', '<p class="muted" style="font-size:12px">Mode « rappel » : tu reçois une notification à l’heure prévue. Active la publication auto dans Réglages (photos uniquement, expérimental).</p>');
    }

    draft = newDraft();
    const drop = $('#pub-drop', el), file = $('#pub-file', el);
    drop.onclick = () => file.click();
    file.onchange = () => { addFiles([...file.files]); file.value = ''; };
    drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
    drop.ondragleave = () => drop.classList.remove('over');
    drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); addFiles([...e.dataTransfer.files]); };

    const strip = $('#pub-media', el);
    let dragFrom = null;
    strip.ondragstart = (e) => { dragFrom = Number(e.target.dataset.i); };
    strip.ondragover = (e) => e.preventDefault();
    strip.ondrop = (e) => {
      const to = Number(e.target.closest('.media-item')?.dataset.i);
      if (dragFrom == null || isNaN(to)) return;
      const [m] = draft.media.splice(dragFrom, 1);
      draft.media.splice(to, 0, m);
      dragFrom = null;
      renderEditor();
    };
    strip.onclick = (e) => { if (e.target.dataset.rm) { draft.media.splice(Number(e.target.dataset.rm), 1); renderEditor(); } };

    $('#pub-ratio', el).onclick = (e) => e.target.dataset.r && busy(null, () => applyRatio(e.target.dataset.r));
    $('#pub-caption', el).oninput = (e) => { draft.caption = e.target.value; updateCounters(); renderPreview(); };
    $('#pub-comment', el).oninput = (e) => { draft.firstComment = e.target.value; updateCounters(); renderPreview(); };
    $$('[data-rw]', el).forEach((b) => b.onclick = () => busy(b, () => aiRewrite(b.dataset.rw)));

    $('#pub-new', el).onclick = () => edit(newDraft());
    $('#pub-save', el).onclick = (e) => busy(e.currentTarget, async () => { await persist(draft.status === 'scheduled' ? 'scheduled' : 'draft'); toast('Brouillon enregistré'); });
    $('#pub-schedule', el).onclick = (e) => busy(e.currentTarget, schedule);
    $('#pub-now', el).onclick = (e) => busy(e.currentTarget, publishNow);
    $('#pub-mobile', el).onclick = () => openInMobile();
    $('#ai-gen', el).onclick = (e) => busy(e.currentTarget, aiCaptions);
    $('#ai-hash', el).onclick = (e) => busy(e.currentTarget, aiHashtags);

    $('#ai-tags', el).onclick = async (e) => {
      if (e.target.dataset.tag) addTag(e.target.dataset.tag);
      if (e.target.id === 'tags-all') $$('#ai-tags .chip', el).forEach((c) => addTag(c.dataset.tag));
      if (e.target.id === 'tags-volume') busy(e.target, tagVolumes);
      if (e.target.id === 'tags-save') {
        const name = prompt('Nom du set de hashtags ?');
        if (!name) return;
        const s = await getSettings();
        const tags = $$('#ai-tags .chip', el).map((c) => c.dataset.tag);
        await saveSettings({ publish: { defaultHashtagSets: [...s.publish.defaultHashtagSets, { name, tags }] } });
        renderSets();
      }
    };
    $('#tag-sets', el).onclick = async (e) => {
      const s = await getSettings();
      if (e.target.dataset.delset) {
        e.stopPropagation();
        const sets = s.publish.defaultHashtagSets.filter((_, i) => i !== Number(e.target.dataset.delset));
        await chrome.storage.local.set({ settings: { ...s, publish: { ...s.publish, defaultHashtagSets: sets } } });
        return renderSets();
      }
      const set = s.publish.defaultHashtagSets[e.target.closest('[data-set]')?.dataset.set];
      if (set) set.tags.forEach(addTag);
    };

    $('#pub-list', el).onclick = async (e) => {
      const act = e.target.dataset.act;
      const id = e.target.closest('[data-id]')?.dataset.id;
      const p = posts.find((x) => x.id === id);
      if (!act || !p) return;
      if (act === 'edit') edit(p);
      if (act === 'dup') edit({ ...p, id: uid(), status: 'draft', scheduledAt: null, publishedAt: null, result: null, error: '', createdAt: Date.now() });
      if (act === 'del' && confirm('Supprimer ce post ?')) {
        await send('post:unschedule', { id });
        await db.delete('posts', id);
        loadPosts();
      }
    };
    $('#cal', el).onclick = (e) => {
      const ev = e.target.closest('.ev');
      if (ev) return edit(posts.find((p) => p.id === ev.dataset.id));
      const day = e.target.closest('.day');
      if (day) {
        const d = new Date(Number(day.dataset.date));
        d.setHours(18, 0, 0, 0);
        $('#pub-when', el).value = toLocalInput(d.getTime());
        el.scrollTo?.(0, 0);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    };
    $('#cal-prev', el).onclick = () => { calMonth.setMonth(calMonth.getMonth() - 1); renderCalendar(); };
    $('#cal-next', el).onclick = () => { calMonth.setMonth(calMonth.getMonth() + 1); renderCalendar(); };

    renderEditor();
    renderSets();
    bestSlotSuggestion();
    await loadPosts();
  },
  async show([id]) {
    await loadPosts();
    if (id) {
      const p = posts.find((x) => x.id === id);
      if (p) edit(p);
    }
  },
};
