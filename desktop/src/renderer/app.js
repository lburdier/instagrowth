// Interface InstaGrowth Desktop : affiche l'état du moteur et lui transmet les
// actions. Toute la logique (ADB, limites, vérifications) vit dans le processus
// principal ; ici on ne fait qu'afficher et demander.

import { icon, autoHydrate } from './icons.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const time = (t) => new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const fmt = (n) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('fr-FR'));

let S = null; // dernier état reçu du moteur
const MODELS = [
  ['claude-opus-5-5', 'Claude Opus 5.5 (recommandé)'],
  ['claude-sonnet-5-5', 'Claude Sonnet 5.5 (rapide)'],
  ['claude-haiku-5-5', 'Claude Haiku 5.5 (économique)'],
  ['claude-fable-5-1', 'Claude Fable 5.1 (le plus puissant)'],
];
const PRESETS = {
  prudent: { dailyLimit: 60, hourlyLimit: 15, minDelaySec: 60, maxDelaySec: 180 },
  normal: { dailyLimit: 100, hourlyLimit: 22, minDelaySec: 45, maxDelaySec: 140 },
  actif: { dailyLimit: 150, hourlyLimit: 30, minDelaySec: 35, maxDelaySec: 110 },
};

// --- Appels au moteur ---------------------------------------------------------

async function call(method, ...args) {
  try {
    return await window.igg.call(method, ...args);
  } catch (e) {
    const msg = String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
    toast(msg, 'error');
    throw new Error(msg);
  }
}
const quiet = (p) => p.catch(() => null);

function toast(msg, level = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${level}`;
  el.innerHTML = `${icon(level === 'error' ? 'alert' : level === 'ok' ? 'check' : 'info', 18)}<span>${esc(msg)}</span>`;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), level === 'error' ? 7000 : 4000);
}

// --- Navigation -----------------------------------------------------------------

function show(view) {
  $$('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.view === view));
  $$('.view').forEach((v) => v.classList.toggle('active', v.dataset.view === view));
  try { localStorage.setItem('igg-view', view); } catch { /* stockage indisponible */ }
}
$('#nav').addEventListener('click', (e) => { const a = e.target.closest('a[data-view]'); if (a) show(a.dataset.view); });
document.addEventListener('click', (e) => {
  const go = e.target.closest('[data-goto]');
  if (go) { e.preventDefault(); show(go.dataset.goto); }
  const ext = e.target.closest('[data-href]');
  if (ext) { e.preventDefault(); call('openExternal', ext.dataset.href); }
  const act = e.target.closest('[data-action]');
  if (act?.dataset.action === 'stop') call('stop');
  if (act?.dataset.action === 'refresh') call('refresh').then(() => toast('Appareils actualisés.'));
});

// Mini-tutos : repliés une fois, ils le restent.
for (const d of $$('details.tuto')) {
  try { if (localStorage.getItem(`igg-tuto:${d.dataset.tuto}`) === 'closed') d.open = false; } catch { /* rien */ }
  d.addEventListener('toggle', () => { try { localStorage.setItem(`igg-tuto:${d.dataset.tuto}`, d.open ? 'open' : 'closed'); } catch { /* rien */ } });
}

// --- Rendu : appareil ----------------------------------------------------------------

function stateLine(kind, ico, html) {
  return `<div class="state-line ${kind}">${icon(ico, 18)}<div>${html}</div></div>`;
}

function renderDevice() {
  const s = S;
  // ADB
  $('#adbBox').innerHTML = s.adbPath
    ? stateLine(s.adbError ? 'bad' : 'ok', s.adbError ? 'alert' : 'check', `<strong>${s.adbError ? esc(s.adbError) : `ADB ${esc(s.adbVersion)} prêt`}</strong><br><small class="muted">${esc(s.adbPath)}</small>`)
      + stateLine(s.scrcpy ? 'ok' : 'mid', s.scrcpy ? 'check' : 'info', s.scrcpy ? `scrcpy trouvé : miroir en direct disponible.<br><small class="muted">${esc(s.scrcpy)}</small>` : 'scrcpy absent (facultatif) : l’aperçu se fait par captures d’écran.')
    : stateLine('bad', 'alert', `<strong>adb.exe introuvable.</strong><br>Télécharge les <a data-href="https://developer.android.com/tools/releases/platform-tools">Android SDK Platform-Tools</a> (Google), dézippe-les dans <code>C:\\platform-tools</code>, puis clique sur Actualiser. Tu peux aussi indiquer le chemin dans Réglages.`);

  // Liste des téléphones
  const rows = s.devices.map((d) => {
    const ok = d.state === 'device';
    const active = s.device?.kind === 'usb' && s.device.serial === d.serial;
    const hint = d.state === 'unauthorized' ? 'Déverrouille le téléphone et accepte « Autoriser le débogage USB ? ».' : d.state === 'offline' ? 'Débranche et rebranche le câble.' : d.usb ? 'USB' : 'Wi-Fi';
    return `<div class="dev-row"><span class="dot ${ok ? 'ok' : d.state === 'unauthorized' ? 'mid' : 'bad'}"></span><div class="meta"><strong>${esc(d.model || d.serial)}</strong><small class="muted">${esc(d.stateLabel)} · ${esc(hint)}</small></div>${ok ? (active ? '<span class="pill">Actif</span>' : `<button class="btn small" data-select="${esc(d.serial)}">Utiliser</button>`) : ''}</div>`;
  }).join('');
  $('#devicesBox').innerHTML = rows || stateLine('mid', 'usb', '<strong>Aucun appareil.</strong><br>Branche le téléphone en USB avec le débogage activé (voir les étapes ci-dessus). La détection est automatique, toutes les 4 secondes.');

  // Appareil actif
  const i = s.info;
  if (!s.device) $('#infoBox').innerHTML = '<p class="muted">Aucun appareil actif.</p>';
  else {
    $('#infoBox').innerHTML = `<dl class="kv">
      <dt>Appareil</dt><dd>${esc(i?.model || s.device.serial)}${s.device.kind === 'sim' ? ' <span class="pill">simulation</span>' : ''}</dd>
      <dt>Android</dt><dd>${esc(i?.android || '—')}</dd>
      <dt>Écran</dt><dd>${i ? `${i.width} × ${i.height}` : '—'} ${i && !i.awake ? '<span class="muted">(éteint)</span>' : ''}</dd>
      <dt>Instagram</dt><dd>${i ? (i.igInstalled ? `installé ${i.igVersion ? `(v${esc(i.igVersion)})` : ''}` : '<span style="color:var(--bad)">non installé</span>') : '—'}</dd>
      <dt>Clavier ADB</dt><dd>${i?.adbKeyboard ? 'actif : accents et emoji conservés' : 'inactif : les accents sont retirés à la saisie'}</dd>
    </dl>${i && !i.awake ? '<div class="row" style="margin-top:12px"><button class="btn small" data-manual="wake">Allumer l’écran</button></div>' : ''}`;
  }

  $('#simToggle').checked = !!s.sim.enabled;
  $('#simBlock').value = String(s.sim.blockAfter || 0);
  $('#simMiss').value = String(s.sim.missRate || 0);

  // Puce de la barre latérale
  const chip = $('#deviceChip');
  const dot = chip.querySelector('.dot');
  const pending = s.devices.find((d) => d.state === 'unauthorized');
  dot.className = `dot ${s.device ? 'ok' : pending ? 'mid' : 'bad'}`;
  chip.querySelector('.txt').textContent = s.device ? (s.device.kind === 'sim' ? 'Téléphone simulé' : i?.model || s.device.serial) : pending ? 'Autorisation en attente' : s.adbPath ? 'Aucun appareil' : 'ADB introuvable';

  $('#screenEmpty').hidden = !!s.device;
  $('#screenImg').hidden = !s.device;
  $('#phoneTitle').textContent = s.device ? (s.device.kind === 'sim' ? 'Téléphone simulé' : i?.model || 'Téléphone') : 'Écran du téléphone';
  $('#scrcpyBtn').disabled = !(s.scrcpy && s.device?.kind === 'usb');
  $('#dmKbd').textContent = s.device && !i?.adbKeyboard ? 'Sans le clavier « ADB Keyboard », les accents sont retirés.' : '';
}

$('#devicesBox').addEventListener('click', (e) => { const b = e.target.closest('[data-select]'); if (b) call('selectDevice', b.dataset.select); });
$('#simToggle').addEventListener('change', (e) => call('setSim', e.target.checked, {}).then(() => toast(e.target.checked ? 'Téléphone simulé activé.' : 'Simulation désactivée.')));
$('#simBlock').addEventListener('change', (e) => call('setSim', true, { blockAfter: Number(e.target.value) }));
$('#simMiss').addEventListener('change', (e) => call('setSim', true, { missRate: Number(e.target.value) }));

// --- Rendu : tâche, DM en attente, limites ----------------------------------------------

let waitTimer = null;
function renderTask() {
  const busy = !!S.task;
  $('#taskbar').hidden = !busy;
  $('#taskName').textContent = S.task || '';
  if (!busy) { clearInterval(waitTimer); $('#taskWait').textContent = ''; }
  for (const id of ['#profOpen', '#profRead', '#likeStart', '#dmPrepare', '#agentStart']) $(id).disabled = busy || !S.device;
}

function showWait(until, label) {
  clearInterval(waitTimer);
  const tick = () => {
    const s = Math.max(0, Math.round((until - Date.now()) / 1000));
    $('#taskWait').textContent = s ? `· ${label} : ${s >= 60 ? `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')}` : `${s} s`}` : '';
    if (!s) clearInterval(waitTimer);
  };
  tick();
  waitTimer = setInterval(tick, 1000);
}

function renderPending() {
  const dm = S.pendingDm;
  $('#pendingDm').hidden = !dm;
  if (!dm) return;
  $('#pdUser').textContent = `@${dm.username}`;
  $('#pdText').textContent = dm.text;
}
$('#pdSend').addEventListener('click', async () => {
  const r = await quiet(call('sendDm'));
  if (r?.sent) toast(`Message envoyé à @${r.username}${r.verified ? ' (vérifié dans la conversation)' : ''}.`, 'ok');
});
$('#pdCancel').addEventListener('click', () => call('cancelDm').then(() => toast('Message préparé abandonné (il reste tapé dans le téléphone, efface-le si besoin).')));

function meter(id, v, max) {
  const pct = max ? Math.min(100, (v / max) * 100) : 0;
  $(`#${id}`).textContent = `${v} / ${max}`;
  const bar = $(`#${id}Bar`);
  bar.style.width = `${pct}%`;
  bar.className = pct >= 100 ? 'full' : pct >= 80 ? 'warn' : '';
}

function renderLimits() {
  const l = S.limits;
  meter('mDay', l.today, l.daily);
  meter('mHour', l.hour, l.hourly);
  meter('mDm', l.dmsToday, l.dmPerDay);
  $('#pauseBox').innerHTML = l.paused
    ? `${stateLine('bad', 'coffee', `<strong>Pause de sécurité jusqu’à ${new Date(l.pausedUntil).toLocaleString('fr-FR')}</strong><br>${esc(l.pauseReason)}`)}<div class="row"><span class="spacer"></span><button class="btn small danger-soft" id="resumeBtn">Lever la pause</button></div>`
    : stateLine(l.inHours ? 'ok' : 'mid', l.inHours ? 'shieldCheck' : 'clock', l.inHours ? 'Aucune pause : les likes sont autorisés dans les limites.' : `Hors plage horaire (${l.cfg.activeStart} h – ${l.cfg.activeEnd} h) : le bot attend.`);
  $('#limitNote').textContent = `${l.warmupActive ? `Montée progressive : jour ${l.warmupDay} sur 7, plafond réduit à ${l.daily}. ` : ''}${S.device?.kind === 'sim' ? 'Compteurs du simulateur (séparés du vrai compte).' : ''}`;
  const remaining = Math.max(0, Math.min(l.daily - l.today, l.hourly - l.hour));
  $('#likeHint').textContent = l.paused ? 'Pause de sécurité en cours : aucun like possible.' : `Encore ${remaining} like(s) possible(s) maintenant (${l.daily - l.today} aujourd’hui).`;
}
document.addEventListener('click', async (e) => {
  if (e.target.id !== 'resumeBtn') return;
  if (!window.confirm('Lever la pause de sécurité ?\n\nInstagram a montré un signal de limitation : reprendre trop tôt augmente le risque de blocage plus long.')) return;
  await call('resumeLimits');
});

function fillLimitsForm() {
  const c = S.settings.limits;
  $('#lDaily').value = c.dailyLimit; $('#lHourly').value = c.hourlyLimit;
  $('#lMin').value = c.minDelaySec; $('#lMax').value = c.maxDelaySec;
  $('#lStart').value = c.activeStart; $('#lEnd').value = c.activeEnd;
  $('#lWarm').checked = c.warmup !== false;
  $$('#presetSeg button').forEach((b) => b.classList.toggle('on', b.dataset.preset === c.preset));
}
$('#presetSeg').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-preset]');
  if (!b) return;
  const p = PRESETS[b.dataset.preset];
  $('#lDaily').value = p.dailyLimit; $('#lHourly').value = p.hourlyLimit; $('#lMin').value = p.minDelaySec; $('#lMax').value = p.maxDelaySec;
  $$('#presetSeg button').forEach((x) => x.classList.toggle('on', x === b));
});
$('#limitsSave').addEventListener('click', async () => {
  const preset = $('#presetSeg button.on')?.dataset.preset || 'perso';
  await call('saveSettings', { limits: { preset, dailyLimit: +$('#lDaily').value, hourlyLimit: +$('#lHourly').value, minDelaySec: +$('#lMin').value, maxDelaySec: +$('#lMax').value, activeStart: +$('#lStart').value, activeEnd: +$('#lEnd').value, warmup: $('#lWarm').checked } });
  const st = await call('state');
  apply(st);
  fillLimitsForm();
  toast('Limites enregistrées (les plafonds durs sont appliqués automatiquement).', 'ok');
});

function renderLikes() {
  const list = S.recentLikes || [];
  $('#likesList').innerHTML = list.length
    ? list.map((l) => `<li>${icon('heart', 16)}<div class="meta"><strong>@${esc(l.author || '?')}</strong><small class="muted">${esc(l.caption || '')}</small></div><small class="muted">${esc(l.source || '')} · ${time(l.t)}</small></li>`).join('')
    : '<li class="muted">Aucun like pour l’instant.</li>';
}

// --- Bot ------------------------------------------------------------------------------

$('#profOpen').addEventListener('click', () => { const u = $('#profUser').value.trim(); if (u) quiet(call('openProfile', u)); });
$('#profRead').addEventListener('click', async () => {
  const u = $('#profUser').value.trim();
  if (!u) return toast('Indique un @compte.', 'warn');
  const p = await quiet(call('readProfile', u));
  if (!p || p.stopped) return;
  $('#profOut').innerHTML = `<strong>${esc(p.fullName || p.username)}</strong> <span class="muted">@${esc(p.username)}</span>${p.private ? ' <span class="pill">privé</span>' : ''}
    ${p.category ? `<div class="muted">${esc(p.category)}</div>` : ''}
    <div class="bio">${esc(p.bio) || '<span class="muted">Pas de bio.</span>'}</div>
    ${p.link ? `<div>${icon('link', 14)} ${esc(p.link)}</div>` : ''}
    <div class="counts"><span><strong>${fmt(p.posts)}</strong>publications</span><span><strong>${fmt(p.followers)}</strong>abonnés</span><span><strong>${fmt(p.following)}</strong>abonnements</span></div>
    <div class="row" style="margin-top:12px"><button class="btn small" id="profToDm">Préparer un message</button></div>`;
  $('#profToDm').onclick = () => { $('#dmUser').value = `@${p.username}`; $('#dmText').focus(); };
});
$('#likeStart').addEventListener('click', async () => {
  const targets = $('#likeTargets').value.split(/[,\n;]+/).map((t) => t.trim()).filter(Boolean).map((t) => (/^[#@]/.test(t) ? t : `#${t}`));
  if (!targets.length) return toast('Ajoute au moins un #hashtag ou un @compte.', 'warn');
  const count = Math.max(1, Math.min(200, Number($('#likeCount').value) || 1));
  $('#likeProg').hidden = false;
  setProgress(0, count);
  const r = await quiet(call('likeSession', { targets, count }));
  if (r && !r.stopped) toast(`${r.liked} like(s) vérifié(s).${r.stoppedBy ? ` ${r.stoppedBy}` : ''}`, r.liked ? 'ok' : 'warn');
});
function setProgress(n, goal) {
  $('#likeProg .bar span').style.width = `${Math.min(100, (n / goal) * 100)}%`;
  $('#likeProg small').textContent = `${n} / ${goal} likes vérifiés`;
}
$('#dmPrepare').addEventListener('click', async () => {
  const u = $('#dmUser').value.trim();
  const t = $('#dmText').value.trim();
  if (!u || !t) return toast('Il faut un @compte et un message.', 'warn');
  const r = await quiet(call('prepareDm', u, t));
  if (r && !r.stopped) toast('Message tapé dans le téléphone. Vérifie, puis confirme l’envoi en haut de la page.', 'ok');
});

// --- Agent Claude ----------------------------------------------------------------------

$('#agentExamples').addEventListener('click', (e) => { const c = e.target.closest('[data-goal]'); if (c) $('#agentGoal').value = c.dataset.goal; });
let usage = { input: 0, output: 0, cacheRead: 0 };
$('#agentStart').addEventListener('click', async () => {
  const goal = $('#agentGoal').value.trim();
  if (!goal) return toast('Décris la mission.', 'warn');
  const steps = Math.max(3, Math.min(80, Number($('#agentSteps').value) || 25));
  if (steps !== S.settings.ai.maxSteps) await call('saveSettings', { ai: { maxSteps: steps } });
  $('#agentList').innerHTML = '';
  $('#agentEmpty').hidden = true;
  usage = { input: 0, output: 0, cacheRead: 0 };
  $('#agentUsage').textContent = '';
  await quiet(call('runAgent', goal));
});

const TOOL_ICON = { tap_element: 'hand', tap_point: 'hand', swipe: 'swipe', type_text: 'type', press_back: 'back', open_profile: 'user', open_hashtag: 'hash', like_post: 'heart', read_profile: 'user', prepare_dm: 'message', wait: 'clock', finish: 'flag' };
function stepItem(step) {
  let li = $(`#agentList li[data-step="${step}"]`);
  if (!li) {
    li = document.createElement('li');
    li.dataset.step = step;
    li.innerHTML = `<span class="n">${step}</span><div class="body"></div>`;
    $('#agentList').append(li);
    li.scrollIntoView({ block: 'nearest' });
  }
  return li.querySelector('.body');
}
function agentEvent(e) {
  if (e.type === 'agent-thinking') { const b = stepItem(e.step); if (!b.childElementCount) b.innerHTML = '<div class="thought">Claude regarde l’écran…</div>'; }
  if (e.type === 'agent-thought' || e.type === 'agent-text') {
    const b = stepItem(e.step);
    const first = b.querySelector('.thought');
    if (first && first.textContent === 'Claude regarde l’écran…') first.remove();
    b.insertAdjacentHTML('beforeend', `<div class="thought">${esc(e.text.trim())}</div>`);
  }
  if (e.type === 'agent-step') {
    const b = stepItem(e.step);
    const first = b.querySelector('.thought');
    if (first && first.textContent === 'Claude regarde l’écran…') first.remove();
    const args = Object.entries(e.input || {}).map(([k, v]) => `${k}: ${typeof v === 'string' ? `« ${v} »` : v}`).join(', ');
    b.insertAdjacentHTML('beforeend', `<div class="tool">${icon(TOOL_ICON[e.tool] || 'bolt', 15)}${esc(e.tool)} <code>${esc(args)}</code></div>`);
  }
  if (e.type === 'agent-result') {
    const r = e.result;
    stepItem(e.step).insertAdjacentHTML('beforeend', `<div class="res ${r.error ? 'err' : 'ok'}">${esc(r.error || (r.finish !== undefined ? 'Mission terminée.' : r.text))}</div>`);
  }
  if (e.type === 'agent-usage') {
    usage.input += e.usage.input || 0; usage.output += e.usage.output || 0; usage.cacheRead += e.usage.cacheRead || 0;
    $('#agentUsage').textContent = `${e.model} · ${fmt(usage.input + usage.cacheRead)} jetons lus (${fmt(usage.cacheRead)} en cache) · ${fmt(usage.output)} écrits`;
  }
  if (e.type === 'agent-done') {
    const li = document.createElement('li');
    li.className = 'final';
    li.innerHTML = `<span class="n">${icon('flag', 14)}</span><div><strong>Bilan</strong><div>${esc(e.summary)}</div></div>`;
    $('#agentList').append(li);
    li.scrollIntoView({ block: 'nearest' });
  }
}

// --- Réglages -----------------------------------------------------------------------------

$('#antModel').innerHTML = MODELS.map(([id, l]) => `<option value="${id}">${l}</option>`).join('');
function fillSettings() {
  const s = S.settings;
  const prov = s.ai.provider;
  $$('#providerSeg button').forEach((b) => b.classList.toggle('on', b.dataset.provider === prov));
  $('#provAnthropic').hidden = prov !== 'anthropic';
  $('#provOpenrouter').hidden = prov !== 'openrouter';
  $('#antKey').value = '';
  $('#antKey').placeholder = s.secrets.anthropic ? `Clé enregistrée (${s.ai.anthropic.apiKey}) — colle une nouvelle clé pour la remplacer` : 'sk-ant-…';
  $('#antModel').value = s.ai.anthropic.model;
  $('#antEffort').value = s.ai.anthropic.effort || 'medium';
  $('#orKey').value = '';
  $('#orKey').placeholder = s.secrets.openrouter ? `Clé enregistrée (${s.ai.openrouter.apiKey})` : 'sk-or-…';
  $('#orModel').value = s.ai.openrouter.model;
  $('#aiSteps').value = s.ai.maxSteps;
  $('#agentSteps').value = s.ai.maxSteps;
  $('#adbPath').value = s.adbPath || '';
  $('#scrcpyPath').value = s.scrcpyPath || '';
}
function renderAiPill() {
  const s = S.settings;
  const ok = s.ai.provider === 'openrouter' ? s.secrets.openrouter : s.secrets.anthropic;
  const name = s.ai.provider === 'openrouter' ? `OpenRouter · ${s.ai.openrouter.model}` : MODELS.find(([id]) => id === s.ai.anthropic.model)?.[1].replace(/ \(.*\)/, '') || s.ai.anthropic.model;
  $('#aiPill').innerHTML = ok ? `<span class="dot ok"></span>${esc(name)}` : `<span class="dot bad"></span>IA non configurée — <a data-goto="settings">Réglages</a>`;
}
$('#providerSeg').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-provider]');
  if (!b) return;
  $$('#providerSeg button').forEach((x) => x.classList.toggle('on', x === b));
  $('#provAnthropic').hidden = b.dataset.provider !== 'anthropic';
  $('#provOpenrouter').hidden = b.dataset.provider !== 'openrouter';
});
async function saveAi() {
  const provider = $('#providerSeg button.on')?.dataset.provider || 'anthropic';
  const key = $('#antKey').value.trim();
  const orKey = $('#orKey').value.trim();
  if (key && !key.startsWith('sk-ant-')) { toast('Une clé Claude commence par sk-ant-.', 'warn'); return false; }
  const patch = { ai: { provider, maxSteps: Number($('#aiSteps').value) || 25, anthropic: { model: $('#antModel').value, effort: $('#antEffort').value }, openrouter: { model: $('#orModel').value.trim() || 'anthropic/claude-opus-5.5' } } };
  if (key) patch.ai.anthropic.apiKey = key;
  if (orKey) patch.ai.openrouter.apiKey = orKey;
  await call('saveSettings', patch);
  apply(await call('state'));
  fillSettings();
  return true;
}
$('#aiSave').addEventListener('click', async () => { if (await saveAi()) toast('Réglages IA enregistrés.', 'ok'); });
$('#aiTest').addEventListener('click', async () => {
  if (!(await saveAi())) return;
  $('#aiMsg').textContent = 'Test en cours…';
  const r = await quiet(call('testAi'));
  $('#aiMsg').textContent = r ? `Connexion OK : « ${r.slice(0, 60)} »` : 'Échec du test (voir le message).';
});
$('#orConnect').addEventListener('click', async () => {
  $('#aiMsg').textContent = 'Termine la connexion dans ton navigateur…';
  const s = await quiet(call('connectOpenRouter'));
  if (s) { apply(await call('state')); fillSettings(); $('#aiMsg').textContent = 'OpenRouter connecté.'; }
});
$('#orList').addEventListener('click', async () => {
  const list = await quiet(call('openRouterModels'));
  if (!list) return;
  $('#orModels').innerHTML = list.map((m) => `<option value="${esc(m.id)}">${esc(m.label)}</option>`).join('');
  toast(`${list.length} modèles compatibles (images + outils). Commence à taper pour filtrer.`);
});
$('#toolsSave').addEventListener('click', async () => {
  await call('saveSettings', { adbPath: $('#adbPath').value.trim(), scrcpyPath: $('#scrcpyPath').value.trim() });
  await call('refresh');
  toast('Chemins enregistrés.', 'ok');
});
$('#openData').addEventListener('click', () => call('openDataFolder'));

// --- Mises à jour ------------------------------------------------------------------------------

let UP = null;
let upHidden = '';
function renderUpdate(u) {
  UP = u;
  const bar = $('#updateBar');
  $('#verText').textContent = `Version ${u.current}${u.packaged ? '' : ' (mode développement : mise à jour par git pull)'}`;
  $('#upMsg').textContent = u.status === 'checking' ? 'Recherche…' : u.status === 'uptodate' ? 'Tu as la dernière version.' : u.status === 'error' ? u.error : '';
  const show = ['available', 'checking-feed', 'downloading', 'ready'].includes(u.status) || (u.status === 'error' && u.version);
  bar.hidden = !show || (u.status === 'available' && upHidden === u.version);
  if (bar.hidden) return;
  $('#upTitle').textContent = u.status === 'ready' ? `InstaGrowth Desktop ${u.version} est prêt à être installé` : `InstaGrowth Desktop ${u.version} est disponible`;
  $('#upSub').textContent = u.status === 'downloading' || u.status === 'checking-feed' ? `Téléchargement… ${u.percent || 0} %`
    : u.status === 'ready' ? 'L’app va se fermer, installer la mise à jour puis se relancer. Tes réglages et compteurs sont conservés.'
      : u.status === 'error' ? `Échec : ${u.error}` : `Tu utilises la version ${u.current}.`;
  $('#upBar').hidden = !(u.status === 'downloading' || u.status === 'checking-feed');
  $('#upBar span').style.width = `${u.percent || 0}%`;
  const go = $('#upGo');
  go.disabled = u.status === 'downloading' || u.status === 'checking-feed';
  go.textContent = u.status === 'ready' ? 'Redémarrer et installer' : u.status === 'error' ? 'Réessayer' : u.packaged ? 'Mettre à jour' : 'Voir la release';
  $('#upLater').hidden = u.status !== 'available';
}
$('#upGo').addEventListener('click', async () => {
  if (!UP) return;
  if (!UP.packaged && UP.status !== 'ready') return call('openExternal', UP.url);
  if (UP.status === 'ready') {
    if (S?.task && !window.confirm(`Une tâche est en cours (${S.task}). Elle sera arrêtée pour installer la mise à jour. Continuer ?`)) return;
    if (S?.task) await call('stop');
    return call('updateInstall');
  }
  quiet(call('updateDownload'));
});
$('#upNotes').addEventListener('click', () => UP?.url && call('openExternal', UP.url));
$('#upLater').addEventListener('click', () => { upHidden = UP?.version || ''; $('#updateBar').hidden = true; });
$('#upCheck').addEventListener('click', async () => {
  upHidden = '';
  const u = await quiet(call('updateCheck'));
  if (u?.status === 'available') toast(`Version ${u.version} disponible : voir le bandeau en haut.`, 'ok');
});

// --- Journal ---------------------------------------------------------------------------------

const LOG_ICON = { ok: 'check', warn: 'alert', error: 'alert', info: 'info' };
function addLog(e) {
  const li = document.createElement('li');
  li.className = e.level;
  li.innerHTML = `${icon(LOG_ICON[e.level] || 'info', 15)}<time>${time(e.t)}</time><span>${esc(e.msg)}</span>`;
  const log = $('#log');
  log.prepend(li);
  while (log.childElementCount > 400) log.lastChild.remove();
}
$('#logClear').addEventListener('click', () => { $('#log').innerHTML = ''; });

// --- Écran du téléphone ----------------------------------------------------------------------

$('#liveToggle').addEventListener('change', (e) => call('setLive', e.target.checked));
$('#manualToggle').addEventListener('change', (e) => $('#screen').classList.toggle('manual', e.target.checked));
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-manual]');
  if (b) quiet(call('manual', b.dataset.manual));
});
$('#scrcpyBtn').addEventListener('click', () => quiet(call('openScrcpy')));

// Position relative dans l'image affichée (object-fit: contain laisse des bandes).
function relPos(ev) {
  const img = $('#screenImg');
  const r = img.getBoundingClientRect();
  const ratio = img.naturalWidth / img.naturalHeight || 9 / 19.5;
  let w = r.width;
  let h = r.width / ratio;
  if (h > r.height) { h = r.height; w = h * ratio; }
  const x0 = r.left + (r.width - w) / 2;
  const y0 = r.top + (r.height - h) / 2;
  const x = (ev.clientX - x0) / w;
  const y = (ev.clientY - y0) / h;
  return x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : null;
}
let down = null;
$('#screen').addEventListener('pointerdown', (e) => { if ($('#manualToggle').checked) down = relPos(e); });
$('#screen').addEventListener('pointerup', (e) => {
  if (!down || !$('#manualToggle').checked) return;
  const up = relPos(e);
  const start = down;
  down = null;
  if (!up) return;
  if (S.task) return toast('Une tâche est en cours : arrête-la avant de toucher l’écran.', 'warn');
  if (Math.hypot(up.x - start.x, up.y - start.y) < 0.02) quiet(call('manual', 'tap', { x: start.x, y: start.y }));
  else quiet(call('manual', 'swipe', { x1: start.x, y1: start.y, x2: up.x, y2: up.y }));
});

// --- Événements du moteur -----------------------------------------------------------------------

let settingsFilled = false;
function apply(state) {
  S = state;
  renderDevice();
  renderTask();
  renderPending();
  renderLimits();
  renderLikes();
  renderAiPill();
  if (!settingsFilled) { fillSettings(); fillLimitsForm(); settingsFilled = true; }
}

window.igg.on((e) => {
  switch (e.type) {
    case 'state': apply(e.state); break;
    case 'frame': $('#screenImg').src = e.frame.dataUrl; $('#screenNote').textContent = `Aperçu ${time(e.frame.t)}${$('#manualToggle').checked ? ' · clic = tap, glisser = défiler' : ''}`; break;
    case 'frame-error': $('#screenNote').textContent = `Aperçu indisponible : ${e.msg}`; break;
    case 'log': addLog(e); if (e.level === 'error') toast(e.msg, 'error'); break;
    case 'wait': showWait(e.until, e.label); break;
    case 'progress': setProgress(e.liked, e.goal); break;
    case 'like': if (S) { S.recentLikes = [{ ...e, t: Date.now() }, ...(S.recentLikes || [])]; renderLikes(); } break;
    case 'pending-dm': if (S) { S.pendingDm = e.dm; renderPending(); } break;
    case 'blocked': toast(`${e.reason}. Pause de sécurité activée.`, 'error'); break;
    case 'stopped': toast('Arrêt immédiat effectué.', 'warn'); break;
    case 'update': renderUpdate(e.state); break;
    default: if (e.type.startsWith('agent-')) agentEvent(e);
  }
});

autoHydrate();
const params = new URLSearchParams(location.search);
let start = params.get('view');
try { start ||= localStorage.getItem('igg-view'); } catch { /* rien */ }
if (start && $(`.view[data-view="${start}"]`)) show(start);
apply(await call('state'));
renderUpdate(await call('updateState'));
call('frame');
