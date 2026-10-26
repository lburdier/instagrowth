// Vue Auto-like : statut en direct, liste détaillée des comptes likés,
// réglages (cibles, limites) et journal d'activité.

import { send, busy, toast, $, $$, navigate } from '../ui.js';
import { getSettings, saveSettings } from '../../lib/store.js';
import { LIMITS, clampAutolike, effectiveDailyLimit } from '../../lib/limits.js';
import { db } from '../../lib/db.js';
import { ring, barChart } from '../charts.js';
import { icon } from '../../lib/icons.js';
import { escapeHtml, fmtNum, fmtDate, dayKey, toCsv, downloadText } from '../../lib/util.js';
import { STATUSES } from './leads.js';

let el;
let cfg;
let timer;
let tab = 'overview';
let st = {};
let leadsByPk = new Map();
const expanded = new Set();

const list = (v) => v.split(/[,\n]/).map((s) => s.trim().replace(/^[#@]/, '')).filter(Boolean);

const STATE_DOT = { active: 'on', waiting: 'on', outside: 'wait', limit: 'wait', paused: 'bad', nosource: 'off', off: 'off' };

// --- Réglages -----------------------------------------------------------------

function fillForm() {
  $('#al-enabled', el).checked = cfg.enabled;
  $('#al-hashtags', el).value = cfg.hashtags.map((h) => '#' + h).join(', ');
  $('#al-competitors', el).value = cfg.competitors.map((c) => '@' + c).join(', ');
  for (const k of ['dailyLimit', 'hourlyLimit', 'minDelaySec', 'maxDelaySec', 'activeStart', 'activeEnd', 'minFollowers', 'maxFollowers']) $(`#al-${k}`, el).value = cfg[k];
  for (const k of ['warmup', 'skipPrivate', 'skipVerified', 'addToLeads']) $(`#al-${k}`, el).checked = cfg[k];
  $('#al-blacklist', el).value = cfg.blacklist.join(', ');
  $$('#al-presets button', el).forEach((b) => b.classList.toggle('active', b.dataset.preset === cfg.preset));
  const days = cfg.activeDays?.length ? cfg.activeDays : [0, 1, 2, 3, 4, 5, 6];
  $$('#al-days button', el).forEach((b) => b.classList.toggle('active', days.includes(Number(b.dataset.day))));
}

function readForm() {
  const num = (k) => Number($(`#al-${k}`, el).value);
  return clampAutolike({
    ...cfg,
    enabled: $('#al-enabled', el).checked,
    hashtags: list($('#al-hashtags', el).value),
    competitors: list($('#al-competitors', el).value),
    dailyLimit: num('dailyLimit'), hourlyLimit: num('hourlyLimit'),
    minDelaySec: num('minDelaySec'), maxDelaySec: num('maxDelaySec'),
    activeStart: num('activeStart'), activeEnd: num('activeEnd'),
    minFollowers: num('minFollowers'), maxFollowers: num('maxFollowers'),
    warmup: $('#al-warmup', el).checked, skipPrivate: $('#al-skipPrivate', el).checked,
    skipVerified: $('#al-skipVerified', el).checked, addToLeads: $('#al-addToLeads', el).checked,
    blacklist: $('#al-blacklist', el).value.split(',').map((s) => s.trim()).filter(Boolean),
    activeDays: $$('#al-days button.active', el).map((b) => Number(b.dataset.day)),
  });
}

const anyAutomation = () => Object.values(cfg.automations || {}).some((a) => a.enabled);

async function save(silent = false) {
  const next = readForm();
  if (next.enabled && !next.hashtags.length && !next.competitors.length && !anyAutomation()) {
    $('#al-enabled', el).checked = false;
    next.enabled = false;
    toast('Ajoute des hashtags ou des concurrents (onglet Réglages), ou active une automatisation.', 'err');
  }
  if (!next.activeDays.length) next.activeDays = [0, 1, 2, 3, 4, 5, 6];
  cfg = next;
  await saveSettings({ autolike: cfg });
  fillForm();
  if (!silent) toast('Réglages auto-like enregistrés');
  refresh();
}

// --- Vue d'ensemble -------------------------------------------------------------

function renderOverview() {
  const today = dayKey();
  const likes = st.day === today ? st.likesToday || 0 : 0;
  const limit = effectiveDailyLimit(cfg, st.firstRunDay || today, today);
  const paused = st.pausedUntil > Date.now();
  const state = !cfg.enabled ? 'off' : paused ? 'paused' : st.state || 'waiting';
  const nextIn = st.nextActionAt > Date.now() ? Math.round((st.nextActionAt - Date.now()) / 1000) : 0;
  const statusText = !cfg.enabled ? 'Désactivé' : escapeHtml(st.status || 'Démarrage au prochain passage (≤ 1 min)');

  $('#al-ring', el).innerHTML = `${ring(likes, limit)}<div class="center"><strong>${likes}</strong><small>/ ${limit} aujourd’hui</small></div>`;
  $('#al-status', el).innerHTML = `
    <div class="row between">
      <div class="kpi"><span class="label">Statut</span><span style="font-weight:600"><span class="status-dot ${STATE_DOT[state] || 'off'}"></span>${statusText}</span></div>
      <button class="primary sm" id="al-now" title="Lance un like tout de suite (plage horaire ignorée, plafonds respectés)">${icon('bolt', 14)} Liker maintenant</button>
    </div>
    ${paused ? `<div class="alert err" style="margin:10px 0 0">${escapeHtml(st.pauseReason)}<br><small>Reprise auto : ${new Date(st.pausedUntil).toLocaleString('fr-FR')}</small>
      <div style="margin-top:6px"><button class="sm" id="al-resume">Reprendre maintenant (déconseillé)</button></div></div>` : ''}
    ${state === 'outside' && st.resumeAt ? `<p class="muted" style="margin-top:8px">Les likes reprendront automatiquement ${fmtDate(st.resumeAt)}. Change la plage horaire dans l’onglet Réglages.</p>` : ''}
    <div class="row" style="margin-top:12px;gap:22px">
      <div class="kpi"><span class="label">Cette heure</span><span>${st.hour?.startsWith(today) ? st.likesThisHour || 0 : 0} / ${cfg.hourlyLimit}</span></div>
      <div class="kpi"><span class="label">Prochain like</span><span>${cfg.enabled && !paused && nextIn ? `dans ${nextIn > 90 ? Math.round(nextIn / 60) + ' min' : nextIn + ' s'}` : '—'}</span></div>
      <div class="kpi"><span class="label">File d’attente</span><span>${(st.queue || []).length} cibles</span></div>
      <div class="kpi"><span class="label">Total</span><span>${fmtNum(st.total || 0)} likes</span></div>
    </div>
    ${st.lastResult ? `<p class="muted" style="margin-top:10px">Dernier passage : ${escapeHtml(st.lastResult)}</p>` : ''}
    ${cfg.warmup && limit < cfg.dailyLimit ? `<p class="muted h-ico" style="margin-top:6px"><i data-i="sprout" data-s="16"></i> Warm-up actif : limite progressive (${limit}/${cfg.dailyLimit}) pendant les 7 premiers jours.</p>` : ''}`;
  $('#al-resume', el)?.addEventListener('click', async () => { await send('autolike:resume'); refresh(); });
  $('#al-now', el).onclick = (e) => busy(e.currentTarget, async () => {
    if (!cfg.hashtags.length && !cfg.competitors.length && !(st.queue || []).length) throw new Error('Ajoute d’abord des hashtags ou des concurrents (onglet Réglages), ou lance une automatisation.');
    toast(await send('autolike:runNow') || 'Passage terminé');
    refresh();
  });

  const hist = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(Date.now() - (13 - i) * 86400000);
    return { label: `${d.getDate()}/${d.getMonth() + 1}`, value: (st.history || {})[dayKey(d)] || 0 };
  });
  $('#al-history', el).innerHTML = barChart(hist, { height: 150, format: (v) => `${v} likes` });

  const q = (st.queue || []).slice(0, 12);
  $('#al-queue', el).innerHTML = q.length
    ? `<div class="chips">${q.map((x) => `<a class="chip" href="https://www.instagram.com/${encodeURIComponent(x.username)}/" target="_blank" title="${escapeHtml(x.source)}">@${escapeHtml(x.username)}</a>`).join('')}</div>`
    : '<p class="muted">La file se remplit au prochain passage à partir de tes hashtags et concurrents.</p>';

  const recent = (st.likedList || []).slice(0, 6);
  $('#al-recent', el).innerHTML = recent.length
    ? recent.map((l) => `<div class="log-item">
        <div class="avatar" style="width:32px;height:32px;background-image:url('${escapeHtml(l.pic)}')"></div>
        <div style="flex:1;min-width:0"><strong>@${escapeHtml(l.username)}</strong> <small>${fmtNum(l.followers)} abonnés · ${escapeHtml(l.source)}</small></div>
        ${l.thumb ? `<a class="thumb" href="https://www.instagram.com/p/${l.code}/" target="_blank" style="background-image:url('${escapeHtml(l.thumb)}')"></a>` : ''}
        <time style="width:auto">${fmtDate(l.ts)}</time></div>`).join('') + `<button class="sm" id="al-see-all" style="margin-top:8px">Voir tous les comptes likés</button>`
    : '<div class="empty">Aucun compte liké pour le moment.</div>';
  $('#al-see-all', el)?.addEventListener('click', () => setTab('liked'));
}

// --- Comptes likés -----------------------------------------------------------------

function followBackBadge(l) {
  const lead = leadsByPk.get(l.userPk);
  if (lead?.followBack === true || lead?.status === 'warm') return '<span class="badge won">T’a suivi</span>';
  if (lead?.followBack === false) return '<span class="badge">Pas encore</span>';
  return Date.now() - l.ts < 86400000 ? '<span class="badge new">Vérif. dans 24 h</span>' : '<span class="badge">À vérifier</span>';
}

function likedFiltered() {
  const qtxt = $('#lk-q', el).value.toLowerCase();
  const period = $('#lk-period', el).value;
  const source = $('#lk-source', el).value;
  const fb = $('#lk-fb', el).value;
  const since = { today: new Date(new Date().setHours(0, 0, 0, 0)).getTime(), d7: Date.now() - 7 * 86400000, d30: Date.now() - 30 * 86400000, all: 0 }[period];
  return (st.likedList || []).filter((l) => {
    if (l.ts < since) return false;
    if (source && l.source !== source) return false;
    if (qtxt && !`${l.username} ${l.fullName} ${l.bio} ${l.category}`.toLowerCase().includes(qtxt)) return false;
    const lead = leadsByPk.get(l.userPk);
    const followed = lead?.followBack === true || lead?.status === 'warm';
    if (fb === 'yes' && !followed) return false;
    if (fb === 'no' && (followed || lead?.followBack == null)) return false;
    if (fb === 'unknown' && lead?.followBack != null) return false;
    return true;
  });
}

function renderLiked() {
  const all = st.likedList || [];
  const sources = [...new Set(all.map((l) => l.source))];
  const sel = $('#lk-source', el);
  const keep = sel.value;
  sel.innerHTML = '<option value="">Toutes les sources</option>' + sources.map((s) => `<option ${s === keep ? 'selected' : ''}>${escapeHtml(s)}</option>`).join('');

  const rows = likedFiltered();
  const unique = new Set(rows.map((l) => l.userPk)).size;
  const checked = rows.filter((l) => leadsByPk.get(l.userPk)?.followBack != null);
  const followed = rows.filter((l) => leadsByPk.get(l.userPk)?.followBack === true || leadsByPk.get(l.userPk)?.status === 'warm');
  $('#lk-kpis', el).innerHTML = `
    <div class="card kpi"><span class="label">Posts likés</span><span class="value">${fmtNum(rows.length)}</span></div>
    <div class="card kpi"><span class="label">Comptes touchés</span><span class="value">${fmtNum(unique)}</span></div>
    <div class="card kpi"><span class="label">T’ont suivi</span><span class="value">${fmtNum(followed.length)}</span><span class="delta muted">sur ${checked.length} vérifiés</span></div>
    <div class="card kpi"><span class="label">Taux de follow-back</span><span class="value">${checked.length ? ((followed.length / checked.length) * 100).toFixed(1).replace('.', ',') + ' %' : '—'}</span></div>`;

  $('#lk-tbody', el).innerHTML = rows.length ? rows.slice(0, 400).map((l) => {
    const lead = leadsByPk.get(l.userPk);
    const open = expanded.has(l.ts);
    return `
      <tr class="lk-row ${open ? 'open' : ''}" data-ts="${l.ts}">
        <td><div class="user-cell"><div class="avatar" style="background-image:url('${escapeHtml(l.pic)}')"></div>
          <div><strong>@${escapeHtml(l.username)}</strong>${l.isVerified ? ' ' + icon('verified', 14, 'verified') : ''}${l.isBusiness ? ' <span class="badge">Pro</span>' : ''}
          <br><small>${escapeHtml(l.fullName || '')}</small></div></div></td>
        <td>${fmtNum(l.followers)}</td>
        <td>${l.thumb ? `<a class="lk-thumb" href="https://www.instagram.com/p/${l.code}/" target="_blank" title="Voir le post liké" style="background-image:url('${escapeHtml(l.thumb)}')"></a>` : '—'}</td>
        <td style="font-size:12px">${escapeHtml(l.source)}${l.forced ? '<br><small>manuel</small>' : ''}
          ${l.verified ? `<br><span class="verified-like" title="Instagram a confirmé le like${l.via === 'page' ? ' (clic sur la page)' : ''}">${icon('check', 12)} vérifié</span>` : '<br><small class="muted">non vérifié</small>'}</td>
        <td style="font-size:12px;white-space:nowrap">${fmtDate(l.ts)}</td>
        <td>${followBackBadge(l)}</td>
        <td>${lead ? `<span class="badge ${lead.status}">${STATUSES[lead.status] || lead.status}</span>` : '<span class="muted">—</span>'}</td>
        <td><div class="row" style="flex-wrap:nowrap;gap:4px">
          <a class="btn sm icon-btn" href="https://www.instagram.com/${encodeURIComponent(l.username)}/" target="_blank" title="Ouvrir le profil">${icon('external', 15)}</a>
          <button class="sm icon-btn" data-act="analyse" title="Analyser ce compte">${icon('chart', 15)}</button>
        </div></td>
      </tr>
      ${open ? `<tr class="lk-detail"><td colspan="8">
        <div class="lk-detail-box">
          <div><span class="label">Bio</span><p>${escapeHtml(l.bio || 'Pas de bio')}</p></div>
          <div class="row" style="gap:22px">
            <div class="kpi"><span class="label">Abonnés</span><span>${fmtNum(l.followers)}</span></div>
            <div class="kpi"><span class="label">Abonnements</span><span>${fmtNum(l.following)}</span></div>
            <div class="kpi"><span class="label">Publications</span><span>${fmtNum(l.posts)}</span></div>
            ${l.category ? `<div class="kpi"><span class="label">Catégorie</span><span>${escapeHtml(l.category)}</span></div>` : ''}
            ${lead?.lastChecked ? `<div class="kpi"><span class="label">Follow-back vérifié</span><span>${fmtDate(lead.lastChecked)}</span></div>` : ''}
          </div>
        </div></td></tr>` : ''}`;
  }).join('') : '<tr><td colspan="8" class="empty">Aucun compte liké sur cette période.</td></tr>';
}

// --- Automatisations ----------------------------------------------------------------

const AUTOS = {
  newFollowers: {
    icon: 'userPlus', title: 'Liker mes nouveaux abonnés',
    desc: 'Like la dernière publication de chaque nouvel abonné : un merci discret qui crée le lien.',
    fields: [['everyHours', 'Vérifier toutes les (heures)', 1, 48], ['max', 'Abonnés max par passage', 1, 30]],
  },
  likeBack: {
    icon: 'heart', title: 'Rendre les likes',
    desc: 'Like une publication des personnes qui ont liké ta dernière publication.',
    fields: [['everyHours', 'Vérifier toutes les (heures)', 1, 48], ['max', 'Comptes max par passage', 1, 30]],
  },
  vip: {
    icon: 'star', title: 'Comptes VIP',
    desc: 'Like automatiquement chaque nouvelle publication (moins de 3 jours) des comptes de ta liste : partenaires, clients, influenceurs.',
    fields: [['everyHours', 'Vérifier toutes les (heures)', 1, 24]],
    accounts: true,
  },
  nurture: {
    icon: 'flame', title: 'Entretenir mes leads',
    desc: 'Like régulièrement les publications de tes leads chauds et contactés pour rester dans leur esprit.',
    fields: [['everyDays', 'Tous les (jours)', 1, 14], ['max', 'Leads max par passage', 1, 30]],
    statuses: true,
  },
};

function renderAutomations() {
  const a = cfg.automations || {};
  const stats = st.autoStats || {};
  $('#auto-list', el).innerHTML = Object.entries(AUTOS).map(([k, def]) => {
    const c = a[k] || {};
    const last = stats[k];
    return `<div class="card auto-card ${c.enabled ? 'on' : ''}" data-auto="${k}">
      <div class="row between" style="flex-wrap:nowrap;align-items:flex-start">
        <div class="row" style="flex-wrap:nowrap;align-items:flex-start;gap:12px">
          <span class="auto-ico">${icon(def.icon, 20)}</span>
          <div><h3 style="margin:0 0 4px">${def.title}</h3><p class="muted" style="margin:0">${def.desc}</p></div>
        </div>
        <label class="switch"><input type="checkbox" data-k="enabled" ${c.enabled ? 'checked' : ''}><span></span></label>
      </div>
      <div class="row" style="margin-top:14px;gap:12px;align-items:flex-end">
        ${def.fields.map(([f, label, min, max]) => `<div class="field" style="margin:0;width:180px"><label>${label}</label>
          <input type="number" data-k="${f}" min="${min}" max="${max}" value="${c[f] ?? min}"></div>`).join('')}
        ${def.accounts ? `<div class="field" style="margin:0;flex:1;min-width:240px"><label>Comptes (séparés par des virgules)</label>
          <input type="text" data-k="accounts" placeholder="@partenaire, @client" value="${escapeHtml((c.accounts || []).map((x) => '@' + x).join(', '))}"></div>` : ''}
        ${def.statuses ? `<div class="field" style="margin:0"><label>Statuts concernés</label><div class="tabs" data-k="statuses">
          ${['warm', 'contacted', 'replied', 'won'].map((s) => `<button data-status="${s}" class="${(c.statuses || []).includes(s) ? 'active' : ''}">${STATUSES[s]}</button>`).join('')}</div></div>` : ''}
        <span class="spacer"></span>
        <button class="sm" data-run="${k}">${icon('bolt', 14)} Lancer maintenant</button>
      </div>
      <p class="muted" style="margin:10px 0 0;font-size:12px">${last ? `Dernier passage ${fmtDate(last.at)} : ${last.added} cible(s) ajoutée(s)${last.note ? ` · ${escapeHtml(last.note)}` : ''}` : 'Jamais lancée.'}</p>
    </div>`;
  }).join('');
}

async function saveAutomation(card) {
  const k = card.dataset.auto;
  const cur = { ...(cfg.automations?.[k] || {}) };
  for (const input of card.querySelectorAll('input[data-k]')) {
    const f = input.dataset.k;
    if (f === 'enabled') cur.enabled = input.checked;
    else if (f === 'accounts') cur.accounts = input.value.split(/[,\s]+/).map((x) => x.trim().replace(/^@/, '')).filter(Boolean);
    else cur[f] = Math.max(Number(input.min) || 1, Math.min(Number(input.max) || 99, Number(input.value) || Number(input.min) || 1));
  }
  const st2 = card.querySelector('[data-k="statuses"]');
  if (st2) cur.statuses = [...st2.querySelectorAll('button.active')].map((b) => b.dataset.status);
  if (k === 'vip' && cur.enabled && !cur.accounts?.length) { cur.enabled = false; toast('Ajoute au moins un compte VIP.', 'err'); }
  cfg.automations = { ...cfg.automations, [k]: cur };
  await saveSettings({ autolike: { automations: { [k]: cur } } });
  renderAutomations();
}

// --- Journal -----------------------------------------------------------------------

function renderLog() {
  $('#al-log', el).innerHTML = (st.log || []).slice(0, 200).map((l) => `
    <div class="log-item ${l.kind}">
      <time>${new Date(l.ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</time>
      ${l.thumb ? `<a class="thumb" href="https://www.instagram.com/p/${l.code}/" target="_blank" style="background-image:url('${escapeHtml(l.thumb)}')"></a>` : ''}
      <span>${escapeHtml(l.text)}</span></div>`).join('') || '<div class="empty">Aucune activité pour le moment.</div>';
}

// --- Rafraîchissement & onglets ----------------------------------------------------

async function refresh() {
  st = (await chrome.storage.local.get('autolike')).autolike || {};
  if (tab === 'liked') leadsByPk = new Map((await db.all('leads')).map((l) => [l.pk, l]));
  $('#al-tab-liked-count', el).textContent = (st.likedList || []).length ? ` (${(st.likedList || []).length})` : '';
  if (tab === 'overview') renderOverview();
  if (tab === 'liked') renderLiked();
  if (tab === 'log') renderLog();
  if (tab === 'auto') renderAutomations();
}

function setTab(t) {
  tab = t;
  $$('#al-tabs button', el).forEach((b) => b.classList.toggle('active', b.dataset.tab === t));
  $$('.al-section', el).forEach((s) => { s.hidden = s.dataset.section !== t; });
  refresh();
}

export default {
  async mount(root) {
    el = root;
    cfg = clampAutolike((await getSettings()).autolike);
    el.innerHTML = `
      <div class="view-head">
        <div><h1>Auto-like</h1><p class="muted">Like quotidien et ciblé des posts de ton audience idéale pour attirer des abonnés et générer des leads chauds.</p></div>
        <div class="row"><span style="font-weight:600">Activer</span><label class="switch"><input type="checkbox" id="al-enabled"><span></span></label></div>
      </div>

      <div class="tabs" id="al-tabs" style="margin-bottom:18px">
        <button data-tab="overview" class="active">Vue d’ensemble</button>
        <button data-tab="liked">Comptes likés<span id="al-tab-liked-count"></span></button>
        <button data-tab="auto">Automatisations</button>
        <button data-tab="settings">Réglages</button>
        <button data-tab="log">Journal</button>
      </div>

      <section class="al-section" data-section="overview">
        <div class="grid g3" style="margin-bottom:16px">
          <div class="card row" style="justify-content:center"><div class="ring" id="al-ring"></div></div>
          <div class="card" id="al-status" style="grid-column: span 2"></div>
        </div>
        <div class="grid g2" style="margin-bottom:16px">
          <div class="card"><h2>Derniers comptes likés</h2><div class="log" id="al-recent" style="max-height:none"></div></div>
          <div class="stack">
            <div class="card"><h2>Likes des 14 derniers jours</h2><div id="al-history"></div></div>
            <div class="card"><h2>Prochaines cibles</h2><div id="al-queue"></div></div>
          </div>
        </div>
      </section>

      <section class="al-section" data-section="liked" hidden>
        <div class="grid g4" id="lk-kpis" style="margin-bottom:16px"></div>
        <div class="card">
          <div class="row" style="margin-bottom:12px">
            <input type="search" id="lk-q" placeholder="Rechercher un compte, une bio…" style="max-width:260px">
            <select id="lk-period" style="width:auto"><option value="today">Aujourd’hui</option><option value="d7" selected>7 derniers jours</option><option value="d30">30 jours</option><option value="all">Tout</option></select>
            <select id="lk-source" style="width:auto"></select>
            <select id="lk-fb" style="width:auto"><option value="">Tous</option><option value="yes">T’ont suivi</option><option value="no">Pas encore</option><option value="unknown">Non vérifiés</option></select>
            <span class="spacer"></span>
            <button id="lk-check">${icon('refresh', 15)} Vérifier les follow-backs</button>
            <button id="lk-export">${icon('download', 15)} CSV</button>
          </div>
          <small class="muted">Clique sur une ligne pour voir le détail du compte.</small>
          <div class="table-wrap" style="margin-top:8px;max-height:640px">
            <table>
              <thead><tr><th>Compte</th><th>Abonnés</th><th>Post liké</th><th>Source</th><th>Liké le</th><th>Follow-back</th><th>Lead</th><th></th></tr></thead>
              <tbody id="lk-tbody"></tbody>
            </table>
          </div>
        </div>
      </section>

      <section class="al-section" data-section="auto" hidden>
        <div class="alert info">Les automatisations ajoutent des cibles <strong>prioritaires</strong> dans la file d’auto-like. Elles respectent les mêmes plafonds, délais, plage horaire et jours actifs, et l’auto-like doit être activé (interrupteur en haut à droite). Elles tournent toutes les 30 minutes.</div>
        <div class="stack" id="auto-list"></div>
      </section>

      <section class="al-section" data-section="settings" hidden>
        <div class="alert warn">
          <strong class="h-ico" style="display:inline-flex"><i data-i="alert" data-s="16"></i> À lire avant d’activer.</strong> Instagram n’offre <u>aucune API officielle</u> pour liker : InstaGrowth utilise l’API web (la même que instagram.com) avec ta session.
          L’automatisation est contraire aux conditions d’utilisation d’Instagram et peut entraîner un blocage temporaire d’action, voire une suspension.
          Garde-fous : plafonds stricts (max ${LIMITS.hard.likesPerDay}/jour, ${LIMITS.hard.likesPerHour}/h, non modifiables), délais aléatoires, pauses naturelles,
          warm-up progressif, plage horaire, et <strong>arrêt automatique</strong> au moindre signal d’Instagram. Le navigateur doit rester ouvert.
        </div>
        <div class="grid g2">
          <div class="card">
            <h2 class="h-ico"><i data-i="target"></i> Cibles</h2>
            <div class="field"><label>Hashtags de ta niche</label><textarea id="al-hashtags" rows="2" placeholder="#coachsportif, #fitnessfrance, #nutritionsaine"></textarea>
              <small>Les auteurs des posts récents et populaires de ces hashtags seront likés. Un hashtag ne contient pas d’espace.</small></div>
            <div class="field"><label>Comptes concurrents</label><textarea id="al-competitors" rows="2" placeholder="@concurrent1, @concurrent2"></textarea>
              <small>Le dernier post de leurs abonnés sera liké (1 like par personne).</small></div>
            <h3 style="margin-top:14px">Filtres</h3>
            <div class="row">
              <div class="field" style="flex:1"><label>Abonnés min</label><input type="number" id="al-minFollowers"></div>
              <div class="field" style="flex:1"><label>Abonnés max (0 = illimité)</label><input type="number" id="al-maxFollowers"></div>
            </div>
            <div class="field"><label>Ne jamais liker si la bio contient</label><input type="text" id="al-blacklist" placeholder="onlyfans, crypto, giveaway"></div>
            <label class="check"><input type="checkbox" id="al-skipPrivate"> Ignorer les comptes privés</label>
            <label class="check"><input type="checkbox" id="al-skipVerified"> Ignorer les comptes certifiés</label>
            <label class="check"><input type="checkbox" id="al-addToLeads"> Ajouter chaque compte liké aux Leads (suivi du follow-back)</label>
          </div>
          <div class="card">
            <h2 class="h-ico"><i data-i="shield"></i> Limites & rythme</h2>
            <div class="tabs" id="al-presets" style="margin-bottom:12px">${Object.entries(LIMITS.presets).map(([k, p]) => `<button data-preset="${k}">${p.label} · ${p.daily}/j</button>`).join('')}</div>
            <div class="row">
              <div class="field" style="flex:1"><label>Likes / jour (max ${LIMITS.hard.likesPerDay})</label><input type="number" id="al-dailyLimit" min="1" max="${LIMITS.hard.likesPerDay}"></div>
              <div class="field" style="flex:1"><label>Likes / heure (max ${LIMITS.hard.likesPerHour})</label><input type="number" id="al-hourlyLimit" min="1" max="${LIMITS.hard.likesPerHour}"></div>
            </div>
            <div class="row">
              <div class="field" style="flex:1"><label>Délai min (s, ≥ ${LIMITS.hard.minDelaySec})</label><input type="number" id="al-minDelaySec"></div>
              <div class="field" style="flex:1"><label>Délai max (s)</label><input type="number" id="al-maxDelaySec"></div>
            </div>
            <div class="row">
              <div class="field" style="flex:1"><label>Début (heure)</label><input type="number" id="al-activeStart" min="0" max="23"></div>
              <div class="field" style="flex:1"><label>Fin (heure)</label><input type="number" id="al-activeEnd" min="1" max="24"></div>
            </div>
            <div class="field"><label>Jours actifs</label>
              <div class="tabs" id="al-days">${[1, 2, 3, 4, 5, 6, 0].map((d) => `<button data-day="${d}">${['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'][d]}</button>`).join('')}</div></div>
            <label class="check"><input type="checkbox" id="al-warmup"> Warm-up : montée progressive sur 7 jours (${LIMITS.warmup.join(' → ')})</label>
            <div class="row" style="margin-top:12px">
              <button class="primary" id="al-save">Enregistrer</button>
              <button id="al-reset" title="Vide la file d’attente de cibles">Vider la file</button>
            </div>
          </div>
        </div>
      </section>

      <section class="al-section" data-section="log" hidden>
        <div class="card"><h2>Journal d’activité</h2><div class="log" id="al-log" style="max-height:none"></div></div>
      </section>`;

    fillForm();
    $('#al-tabs', el).onclick = (e) => { const t = e.target.closest('[data-tab]')?.dataset.tab; if (t) setTab(t); };
    $('#al-save', el).onclick = (e) => busy(e.currentTarget, () => save());
    $('#al-enabled', el).onchange = () => save(true).then(() => toast(cfg.enabled ? 'Auto-like activé : premier passage dans la minute' : 'Auto-like désactivé'));
    $('#al-reset', el).onclick = async () => { await send('autolike:resetQueue'); toast('File vidée'); refresh(); };
    $('#al-days', el).onclick = (e) => { const b = e.target.closest('[data-day]'); if (b) b.classList.toggle('active'); };
    const autoList = $('#auto-list', el);
    autoList.addEventListener('change', (e) => { const card = e.target.closest('[data-auto]'); if (card) saveAutomation(card); });
    autoList.addEventListener('click', (e) => {
      const card = e.target.closest('[data-auto]');
      const statusBtn = e.target.closest('[data-status]');
      if (statusBtn && card) { statusBtn.classList.toggle('active'); return saveAutomation(card); }
      const run = e.target.closest('[data-run]');
      if (run) busy(run, async () => {
        if (!cfg.automations?.[run.dataset.run]?.enabled) throw new Error('Active d’abord cette automatisation.');
        toast(await send('autolike:runAutomations', { only: run.dataset.run }));
        await refresh();
      });
    });
    $('#al-presets', el).onclick = (e) => {
      const p = LIMITS.presets[e.target.dataset.preset];
      if (!p) return;
      cfg.preset = e.target.dataset.preset;
      Object.assign(cfg, { dailyLimit: p.daily, hourlyLimit: p.hourly, minDelaySec: p.minDelaySec, maxDelaySec: p.maxDelaySec });
      fillForm();
    };
    for (const id of ['#lk-q', '#lk-period', '#lk-source', '#lk-fb']) $(id, el).addEventListener(id === '#lk-q' ? 'input' : 'change', renderLiked);
    $('#lk-check', el).onclick = (e) => busy(e.currentTarget, async () => { await send('leads:checkFollowBacks'); await refresh(); toast('Follow-backs vérifiés (comptes likés il y a plus de 24 h)'); });
    $('#lk-export', el).onclick = () => downloadText(`comptes-likes-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(likedFiltered(), [
      { label: 'date', get: (r) => new Date(r.ts).toLocaleString('fr-FR') }, { label: 'username', key: 'username' }, { label: 'nom', key: 'fullName' },
      { label: 'abonnés', key: 'followers' }, { label: 'source', key: 'source' }, { label: 'post', get: (r) => `https://www.instagram.com/p/${r.code}/` },
      { label: 'follow-back', get: (r) => { const l = leadsByPk.get(r.userPk); return l?.followBack === true ? 'oui' : l?.followBack === false ? 'non' : ''; } },
      { label: 'bio', key: 'bio' },
    ]));
    $('#lk-tbody', el).onclick = (e) => {
      if (e.target.closest('a')) return;
      const row = e.target.closest('tr.lk-row');
      if (!row) return;
      const ts = Number(row.dataset.ts);
      if (e.target.closest('[data-act="analyse"]')) {
        const l = (st.likedList || []).find((x) => x.ts === ts);
        return navigate(`dashboard/${l.username}`);
      }
      expanded.has(ts) ? expanded.delete(ts) : expanded.add(ts);
      renderLiked();
    };
    chrome.storage.onChanged.addListener((c) => { if (c.autolike && el.classList.contains('active')) refresh(); });
  },
  show() {
    refresh();
    clearInterval(timer);
    timer = setInterval(() => el.classList.contains('active') && refresh(), 15000);
  },
};
