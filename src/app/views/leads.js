// Vue Leads : recherche (hashtag, abonnés concurrents, likers, import), mini-CRM,
// scoring IA, messages d'approche IA, export CSV.

import { send, busy, toast, $, $$, navigate, activeAccountId } from '../ui.js';
import { TUTOS } from '../tutorial.js';
import { db } from '../../lib/db.js';
import { complete } from '../../lib/ai.js';
import { escapeHtml, fmtNum, fmtDate, toCsv, downloadText } from '../../lib/util.js';
import { icon } from '../../lib/icons.js';

let el;
let leads = [];
let selected = new Set();
let sort = { key: 'addedAt', dir: -1 };
let statusFilter = '';
let source = 'hashtag';

export const STATUSES = {
  new: 'Nouveau', liked: 'Liké', warm: 'Chaud', contacted: 'Contacté', replied: 'A répondu', won: 'Gagné', lost: 'Perdu',
};

const SOURCES = {
  hashtag: { label: 'Hashtag', ph: 'ex. coachsportif, fitnessfrance, nutrition', help: 'Récupère les auteurs des publications récentes et populaires de ces hashtags. Tu peux en mettre plusieurs, séparés par des virgules.' },
  competitor: { label: 'Abonnés concurrent', ph: '@concurrent1, @concurrent2', help: 'Récupère les abonnés de comptes publics de ta niche : ton audience idéale. Plusieurs comptes possibles, séparés par des virgules.' },
  likers: { label: 'Likers d’un post', ph: 'https://www.instagram.com/p/…', help: 'Récupère les personnes qui ont liké un post précis (le tien ou un concurrent).' },
  usernames: { label: 'Import', ph: '@user1, @user2, @user3', help: 'Colle une liste de noms d’utilisateur à enrichir.' },
};

const csvList = (v) => v.split(',').map((s) => s.trim()).filter(Boolean);

async function reload() {
  // Uniquement les leads du compte Instagram actif (les anciens leads sans compte restent visibles).
  const acct = await activeAccountId();
  leads = (await db.all('leads')).filter((l) => !l.owners || l.owners.includes(acct));
  renderCounts();
  renderTable();
}

function renderCounts() {
  const c = Object.fromEntries(Object.keys(STATUSES).map((k) => [k, 0]));
  for (const l of leads) c[l.status] = (c[l.status] || 0) + 1;
  const liked = leads.filter((l) => l.followBack != null);
  const fbRate = liked.length ? (liked.filter((l) => l.followBack).length / liked.length) * 100 : null;
  $('#lead-counts', el).innerHTML = `
    <div class="card kpi"><span class="label">Total leads</span><span class="value">${fmtNum(leads.length)}</span></div>
    <div class="card kpi"><span class="label">Leads chauds</span><span class="value">${fmtNum(c.warm)}</span><span class="delta muted">t’ont suivi après un like</span></div>
    <div class="card kpi"><span class="label">Contactés / réponses</span><span class="value">${fmtNum(c.contacted + c.replied + c.won)} <small style="font-size:16px">/ ${fmtNum(c.replied + c.won)}</small></span></div>
    <div class="card kpi"><span class="label">Taux de follow-back</span><span class="value">${fbRate == null ? '—' : fbRate.toFixed(1).replace('.', ',') + ' %'}</span><span class="delta muted">${liked.length} leads vérifiés</span></div>`;
}

function filtered() {
  const q = $('#lead-q', el).value.toLowerCase();
  const st = statusFilter;
  return leads
    .filter((l) => (!st || l.status === st) && (!q || `${l.username} ${l.fullName} ${l.bio} ${l.category} ${l.source} ${l.notes}`.toLowerCase().includes(q)))
    .sort((a, b) => {
      const va = a[sort.key] ?? -Infinity, vb = b[sort.key] ?? -Infinity;
      return (va > vb ? 1 : va < vb ? -1 : 0) * sort.dir;
    });
}

const scoreClass = (s) => (s >= 75 ? 'high' : s >= 50 ? 'mid' : 'low');

function contactIcons(l) {
  const out = [];
  if (l.email) out.push(`<a class="lead-contact" href="mailto:${escapeHtml(l.email)}" title="${escapeHtml(l.email)}">${icon('mail', 14)}</a>`);
  if (l.phone) out.push(`<span class="lead-contact" title="${escapeHtml(l.phone)}">${icon('phoneCall', 14)}</span>`);
  if (l.externalUrl) out.push(`<a class="lead-contact" href="${escapeHtml(l.externalUrl)}" target="_blank" title="${escapeHtml(l.externalUrl)}">${icon('link', 14)}</a>`);
  return out.join('');
}

function renderStatusChips() {
  const counts = {};
  for (const l of leads) counts[l.status] = (counts[l.status] || 0) + 1;
  $('#lead-status-chips', el).innerHTML = [['', 'Tous', leads.length], ...Object.entries(STATUSES).map(([k, v]) => [k, v, counts[k] || 0])]
    .filter(([k, , n]) => !k || n)
    .map(([k, v, n]) => `<button class="status-chip s-${k || 'all'} ${statusFilter === k ? 'active' : ''}" data-status="${k}">${v}<span>${n}</span></button>`).join('');
}

function renderTable() {
  const rows = filtered();
  const body = $('#lead-tbody', el);
  renderStatusChips();
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="7" class="empty">${leads.length ? 'Aucun lead ne correspond à ces filtres.' : 'Aucun lead. Lance une recherche ci-dessus ou active l’auto-like avec « ajouter aux leads ».'}</td></tr>`;
  } else {
    body.innerHTML = rows.slice(0, 500).map((l) => `
      <tr data-pk="${l.pk}" class="${selected.has(l.pk) ? 'selected' : ''}">
        <td class="col-check"><input type="checkbox" class="sel" ${selected.has(l.pk) ? 'checked' : ''}></td>
        <td><div class="user-cell">
          <a class="avatar" href="https://www.instagram.com/${encodeURIComponent(l.username)}/" target="_blank" style="background-image:url('${escapeHtml(l.pic)}')"></a>
          <div class="lead-id">
            <div class="lead-name"><a href="https://www.instagram.com/${encodeURIComponent(l.username)}/" target="_blank">@${escapeHtml(l.username)}</a>
              ${l.isVerified ? icon('verified', 14, 'verified') : ''}${l.isBusiness ? '<span class="tag">Pro</span>' : ''}</div>
            <div class="lead-meta">${l.fullName ? `${escapeHtml(l.fullName)} · ` : ''}<strong>${fmtNum(l.followers)}</strong> abonnés ${contactIcons(l)}</div>
          </div></div></td>
        <td class="col-bio"><div class="lead-bio" title="${escapeHtml(l.bio)}">${l.category ? `<span class="tag">${escapeHtml(l.category)}</span> ` : ''}${l.bio ? escapeHtml(l.bio) : (l.enrichAttempts || 0) < 3 ? '<span class="muted pending-bio">Bio en cours de récupération…</span>' : '<span class="muted">Pas de bio</span>'}</div></td>
        <td class="col-source"><div class="lead-source">${escapeHtml(l.source)}</div><small class="muted">${fmtDate(l.addedAt, false)}</small></td>
        <td title="${escapeHtml(l.scoreReason || '')}">${l.score != null ? `<span class="score-pill ${scoreClass(l.score)}">${l.score}</span>` : '<span class="muted">—</span>'}</td>
        <td><select class="status status-select s-${l.status}">${Object.entries(STATUSES).map(([k, v]) => `<option value="${k}" ${l.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select></td>
        <td><div class="lead-actions">
          <button class="icon-btn" data-act="dm" title="Message d’approche IA">${icon('sparkle', 16)}</button>
          <button class="icon-btn ${l.notes ? 'has-note' : ''}" data-act="note" title="${l.notes ? escapeHtml(l.notes) : 'Ajouter une note'}">${icon('note', 16)}</button>
          <button class="icon-btn danger" data-act="del" title="Supprimer">${icon('trash', 16)}</button></div></td>
      </tr>`).join('');
  }
  $('#lead-shown', el).textContent = `${rows.length} lead${rows.length > 1 ? 's' : ''}${rows.length > 500 ? ' (500 affichés)' : ''}`;
  const bar = $('#lead-selbar', el);
  bar.hidden = !selected.size;
  $('#lead-selcount', el).textContent = `${selected.size} sélectionné${selected.size > 1 ? 's' : ''}`;
  $('#sel-all', el).checked = rows.length > 0 && rows.every((l) => selected.has(l.pk));
}

async function updateLead(pk, patch) {
  const l = leads.find((x) => x.pk === pk);
  Object.assign(l, patch);
  await db.put('leads', l);
}

// --- IA ---------------------------------------------------------------------

async function aiScore() {
  const targets = (selected.size ? leads.filter((l) => selected.has(l.pk)) : filtered().filter((l) => l.score == null)).slice(0, 60);
  if (!targets.length) return toast('Sélectionne des leads (ou il n’y a aucun lead non scoré).');
  for (let i = 0; i < targets.length; i += 20) {
    const chunk = targets.slice(i, i + 20);
    toast(`Scoring IA ${i + 1}–${i + chunk.length} / ${targets.length}…`);
    const res = await complete({
      json: true,
      effort: 'low',
      maxTokens: 4000,
      prompt: `Évalue chaque profil Instagram comme prospect pour mon activité (voir contexte système).
Score de 0 à 100 = probabilité que ce soit un client/partenaire pertinent. Raison en 12 mots max.
Profils : ${JSON.stringify(chunk.map((l) => ({ username: l.username, nom: l.fullName, bio: l.bio, categorie: l.category, abonnes: l.followers, pro: l.isBusiness, contact: Boolean(l.email || l.phone) })))}
Format : [{"username": "...", "score": 0, "reason": "..."}]`,
    });
    for (const r of Array.isArray(res) ? res : []) {
      const l = chunk.find((x) => x.username === r.username);
      if (l) await updateLead(l.pk, { score: Math.max(0, Math.min(100, Math.round(r.score))), scoreReason: r.reason || '' });
    }
    renderTable();
  }
  toast('Scoring terminé');
}

function openDmDialog(lead) {
  const dlg = $('#dm-dialog', el);
  $('#dm-title', dlg).textContent = `Message pour @${lead.username}`;
  $('#dm-text', dlg).value = '';
  $('#dm-goal', dlg).value = $('#dm-goal', dlg).value || 'ouvrir la conversation sans vendre';
  dlg.dataset.pk = lead.pk;
  dlg.showModal();
  generateDm(lead);
}

async function generateDm(lead) {
  const dlg = $('#dm-dialog', el);
  const btn = $('#dm-regen', dlg);
  await busy(btn, async () => {
    const text = await complete({
      effort: 'low',
      maxTokens: 1500,
      prompt: `Écris UN message privé Instagram d’approche pour ce profil.
Objectif : ${$('#dm-goal', dlg).value}.
Profil : @${lead.username} — ${lead.fullName || ''} — bio : "${lead.bio || ''}" — catégorie : ${lead.category || 'n/a'} — ${lead.followers ?? '?'} abonnés.
${lead.status === 'warm' ? 'Cette personne vient de me suivre.' : ''}
Contraintes : 2 à 4 phrases, tutoiement naturel, une référence précise à son profil, une question ouverte à la fin, 1 emoji max, pas de lien, pas de pitch agressif.
Réponds uniquement avec le message.`,
    });
    $('#dm-text', dlg).value = text.replace(/^["«]|["»]$/g, '').trim();
  });
}

// --- Recherche ---------------------------------------------------------------

function renderJob(job) {
  const box = $('#job', el);
  if (!job || (!job.running && !job.finishedAt)) { box.innerHTML = ''; return; }
  const pct = job.total ? Math.round((job.scanned / job.total) * 100) : 0;
  box.innerHTML = `
    <div class="alert ${job.error ? 'err' : 'info'}" style="margin:12px 0 0">
      <div class="row between"><strong>${job.running ? '<span class="spinner"></span> Recherche en cours' : job.error ? 'Recherche interrompue' : 'Recherche terminée'}</strong>
      <span>${job.found} lead(s) · ${job.scanned}/${job.total || '?'} profils analysés</span></div>
      <div style="height:6px;background:var(--line);border-radius:6px;margin:8px 0;overflow:hidden"><div style="height:100%;width:${pct}%;background:var(--grad)"></div></div>
      <small>${escapeHtml(job.error || job.last || '')}</small>
    </div>`;
  $('#lead-start', el).disabled = Boolean(job.running);
  $('#lead-stop', el).hidden = !job.running;
  if (!job.running) reload();
}

async function startSearch() {
  const query = $('#lead-query', el).value.trim();
  if (!query) return toast('Renseigne une cible.', 'err');
  const filters = {
    minFollowers: Number($('#f-min', el).value) || 0,
    maxFollowers: Number($('#f-max', el).value) || 0,
    keywords: csvList($('#f-kw', el).value),
    exclude: csvList($('#f-ex', el).value),
    businessOnly: $('#f-pro', el).checked,
    requireContact: $('#f-contact', el).checked,
    skipPrivate: $('#f-private', el).checked,
    skipExisting: $('#f-existing', el).checked,
  };
  await send('leads:search', { source, query, max: Number($('#lead-max', el).value) || 30, filters });
  toast('Recherche lancée — elle continue même si tu changes d’onglet.');
}

export default {
  async mount(root) {
    el = root;
    el.innerHTML = `
      <div class="view-head">
        <div><h1>Leads</h1><p class="muted">Trouve des prospects qualifiés, score-les avec l’IA et suis-les jusqu’à la conversion.</p></div>
      </div>
      ${TUTOS.leads()}
      <div class="grid g4" id="lead-counts" style="margin-bottom:16px"></div>

      <div class="card" style="margin-bottom:16px">
        <h2 class="h-ico"><i data-i="search"></i> Trouver des leads</h2>
        <div class="tabs" id="lead-src">${Object.entries(SOURCES).map(([k, v]) => `<button data-src="${k}" class="${k === source ? 'active' : ''}">${v.label}</button>`).join('')}</div>
        <p class="muted" id="lead-help" style="margin:8px 0"></p>
        <div class="grid g2">
          <div>
            <div class="field"><label>Cible</label><input type="text" id="lead-query"></div>
            <div class="row">
              <div class="field" style="flex:1"><label>Leads max</label><input type="number" id="lead-max" value="30" min="1" max="200"></div>
              <div class="field" style="flex:1"><label>Abonnés min</label><input type="number" id="f-min" value="100"></div>
              <div class="field" style="flex:1"><label>Abonnés max</label><input type="number" id="f-max" value="50000"></div>
            </div>
          </div>
          <div>
            <div class="field"><label>Mots-clés dans la bio (au moins un, séparés par des virgules)</label><input type="text" id="f-kw" placeholder="coach, fondatrice, boutique, freelance"></div>
            <div class="field"><label>Exclure si la bio contient</label><input type="text" id="f-ex" placeholder="giveaway, promo, crypto"></div>
          </div>
        </div>
        <div class="row" style="margin-bottom:10px">
          <label class="check"><input type="checkbox" id="f-private" checked> Ignorer les comptes privés</label>
          <label class="check"><input type="checkbox" id="f-existing" checked> Ignorer les leads déjà en base</label>
          <label class="check"><input type="checkbox" id="f-pro"> Comptes pro uniquement</label>
          <label class="check"><input type="checkbox" id="f-contact"> Avec email/téléphone</label>
        </div>
        <div class="row">
          <button class="primary" id="lead-start">Lancer la recherche</button>
          <button class="danger" id="lead-stop" hidden>Arrêter</button>
          <small class="muted">Requêtes espacées (~2 s) pour protéger ton compte : compte ~1 min pour 25 profils.</small>
        </div>
        <div id="job"></div>
      </div>

      <div class="card">
        <div class="lead-toolbar">
          <div class="search-account" style="flex:1;max-width:340px"><span class="search-ico"><i data-i="search" data-s="16"></i></span>
            <input type="search" id="lead-q" placeholder="Rechercher un nom, une bio, une note…"></div>
          <select id="lead-sort" style="width:auto">
            <option value="addedAt:-1">Plus récents</option><option value="score:-1">Meilleur score</option>
            <option value="followers:-1">Plus d’abonnés</option><option value="followers:1">Moins d’abonnés</option><option value="status:1">Statut</option>
          </select>
          <span class="spacer"></span>
          <button class="primary" id="lead-add"><i data-i="userPlus" data-s="16"></i> Ajouter un lead</button>
          <button id="lead-enrich" title="Récupère la bio et les contacts des leads qui n’en ont pas"><i data-i="refresh" data-s="16"></i> Compléter les infos</button>
          <button id="lead-score"><i data-i="sparkle" data-s="16"></i> Scorer avec l’IA</button>
          <button id="lead-fb" title="Vérifie qui t’a suivi après un like"><i data-i="refresh" data-s="16"></i> Follow-backs</button>
          <button id="lead-export"><i data-i="download" data-s="16"></i> CSV</button>
        </div>
        <div class="row" style="justify-content:space-between;margin:12px 0 4px">
          <div class="status-chips" id="lead-status-chips"></div>
          <small class="muted" id="lead-shown"></small>
        </div>
        <div class="lead-selbar" id="lead-selbar" hidden>
          <strong id="lead-selcount"></strong>
          <button class="sm" id="lead-sel-score"><i data-i="sparkle" data-s="14"></i> Scorer</button>
          <button class="sm" id="lead-sel-enrich"><i data-i="refresh" data-s="14"></i> Compléter les infos</button>
          <button class="sm" id="lead-sel-export"><i data-i="download" data-s="14"></i> Exporter</button>
          <button class="sm danger" id="lead-del"><i data-i="trash" data-s="14"></i> Supprimer</button>
          <span class="spacer"></span>
          <button class="sm ghost" id="lead-sel-clear">Désélectionner</button>
        </div>
        <div class="table-wrap lead-table-wrap" style="margin-top:8px;max-height:680px">
          <table class="lead-table">
            <thead><tr>
              <th class="col-check"><input type="checkbox" id="sel-all"></th>
              <th>Profil</th><th class="col-bio">Bio</th>
              <th class="col-source" data-sort="addedAt">Source</th><th data-sort="score">Score</th><th data-sort="status">Statut</th><th></th>
            </tr></thead>
            <tbody id="lead-tbody"></tbody>
          </table>
        </div>
      </div>

      <dialog id="dm-dialog">
        <h2 id="dm-title"></h2>
        <div class="field"><label>Objectif du message</label>
          <input type="text" id="dm-goal" list="dm-goals" value="ouvrir la conversation sans vendre">
          <datalist id="dm-goals"><option value="ouvrir la conversation sans vendre"><option value="proposer une collaboration"><option value="remercier pour le follow et créer du lien"><option value="proposer un appel découverte gratuit"></datalist></div>
        <div class="field"><label>Message</label><textarea id="dm-text" rows="6"></textarea></div>
        <div class="row">
          <button id="dm-regen"><i data-i="refresh" data-s="16"></i> Régénérer</button>
          <button id="dm-copy">Copier</button>
          <span class="spacer"></span>
          <button id="dm-close">Fermer</button>
          <button class="primary" id="dm-open">Ouvrir la conversation</button>
        </div>
        <small class="muted">Envoi manuel volontaire : les DM automatisés sont la 1re cause de blocage de compte.</small>
      </dialog>

      <dialog id="add-dialog">
        <h2>Ajouter un lead</h2>
        <form id="add-form">
          <div class="field"><label>Compte Instagram</label><input type="text" id="add-username" placeholder="@nom_du_compte ou lien du profil" required autocomplete="off">
            <small>InstaGrowth récupère automatiquement la photo, les abonnés, la bio et les contacts publics.</small></div>
          <div class="grid g2" style="gap:12px">
            <div class="field"><label>Nom (optionnel)</label><input type="text" id="add-name"></div>
            <div class="field"><label>Statut</label><select id="add-status">${Object.entries(STATUSES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
            <div class="field"><label>Email (optionnel)</label><input type="text" id="add-email" placeholder="contact@exemple.fr"></div>
            <div class="field"><label>Téléphone (optionnel)</label><input type="text" id="add-phone"></div>
          </div>
          <div class="field"><label>Note (optionnel)</label><textarea id="add-notes" rows="3" placeholder="Contexte, besoin, prochaine étape…"></textarea></div>
          <div class="row"><span class="spacer"></span><button type="button" id="add-cancel">Annuler</button><button class="primary" type="submit" id="add-save">Ajouter</button></div>
        </form>
      </dialog>

      <dialog id="note-dialog">
        <h2>Notes</h2>
        <textarea id="note-text" rows="6"></textarea>
        <div class="row" style="margin-top:10px"><span class="spacer"></span><button id="note-cancel">Annuler</button><button class="primary" id="note-save">Enregistrer</button></div>
      </dialog>`;

    const setSource = (k) => {
      source = k;
      $$('#lead-src button', el).forEach((b) => b.classList.toggle('active', b.dataset.src === k));
      $('#lead-query', el).placeholder = SOURCES[k].ph;
      $('#lead-help', el).textContent = SOURCES[k].help;
    };
    setSource(source);
    $('#lead-src', el).onclick = (e) => e.target.dataset.src && setSource(e.target.dataset.src);
    $('#lead-start', el).onclick = (e) => busy(e.currentTarget, startSearch);
    $('#lead-stop', el).onclick = () => send('leads:stop');
    $('#lead-q', el).oninput = renderTable;
    $('#lead-sort', el).onchange = (e) => {
      const [key, dir] = e.target.value.split(':');
      sort = { key, dir: Number(dir) };
      renderTable();
    };
    $('#lead-status-chips', el).onclick = (e) => {
      const chip = e.target.closest('[data-status]');
      if (!chip) return;
      statusFilter = chip.dataset.status;
      renderTable();
    };
    $('#lead-sel-score', el).onclick = (e) => busy(e.currentTarget, aiScore);
    $('#lead-sel-export', el).onclick = () => $('#lead-export', el).click();
    $('#lead-sel-clear', el).onclick = () => { selected.clear(); renderTable(); };
    const enrich = async (pks) => {
      if (!pks.length) return toast('Tous ces leads ont déjà leur bio.');
      toast(`Récupération des infos de ${Math.min(10, pks.length)} lead(s)…`);
      const n = await send('leads:enrich', { pks: pks.slice(0, 10) });
      await reload();
      toast(n ? `${n} profil(s) complété(s)` : 'Aucune nouvelle info trouvée pour l’instant : nouvel essai automatique plus tard.');
    };
    $('#lead-enrich', el).onclick = (e) => busy(e.currentTarget, () => enrich(filtered().filter((l) => !l.bio).map((l) => l.pk)));
    $('#lead-sel-enrich', el).onclick = (e) => busy(e.currentTarget, () => enrich([...selected]));
    const addDlg = $('#add-dialog', el);
    $('#lead-add', el).onclick = () => { $('#add-form', el).reset(); addDlg.showModal(); $('#add-username', el).focus(); };
    $('#add-cancel', el).onclick = () => addDlg.close();
    $('#add-form', el).onsubmit = (e) => {
      e.preventDefault();
      busy($('#add-save', el), async () => {
        const r = await send('leads:addManual', {
          username: $('#add-username', el).value,
          fields: { fullName: $('#add-name', el).value.trim(), email: $('#add-email', el).value.trim(), phone: $('#add-phone', el).value.trim(),
            notes: $('#add-notes', el).value.trim(), status: $('#add-status', el).value },
        });
        addDlg.close();
        await reload();
        toast(`@${r.username} ajouté à tes leads`);
      });
    };
    $('#lead-score', el).onclick = (e) => busy(e.currentTarget, aiScore);
    $('#lead-fb', el).onclick = (e) => busy(e.currentTarget, async () => { await send('leads:checkFollowBacks'); await reload(); toast('Follow-backs vérifiés'); });
    $('#lead-export', el).onclick = () => {
      const rows = selected.size ? leads.filter((l) => selected.has(l.pk)) : filtered();
      downloadText(`leads-instagram-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(rows, [
        { label: 'username', key: 'username' }, { label: 'nom', key: 'fullName' }, { label: 'abonnés', key: 'followers' },
        { label: 'bio', key: 'bio' }, { label: 'catégorie', key: 'category' }, { label: 'email', key: 'email' }, { label: 'téléphone', key: 'phone' },
        { label: 'site', key: 'externalUrl' }, { label: 'source', key: 'source' }, { label: 'statut', get: (r) => STATUSES[r.status] },
        { label: 'score', key: 'score' }, { label: 'notes', key: 'notes' }, { label: 'profil', get: (r) => `https://www.instagram.com/${r.username}/` },
      ]));
    };
    $('#lead-del', el).onclick = async () => {
      if (!selected.size || !confirm(`Supprimer ${selected.size} lead(s) ?`)) return;
      for (const pk of selected) await db.delete('leads', pk);
      selected.clear();
      reload();
    };
    $('#sel-all', el).onchange = (e) => {
      selected = e.target.checked ? new Set(filtered().map((l) => l.pk)) : new Set();
      renderTable();
    };
    $$('th[data-sort]', el).forEach((th) => th.onclick = () => {
      sort = { key: th.dataset.sort, dir: sort.key === th.dataset.sort ? -sort.dir : -1 };
      renderTable();
    });

    const tbody = $('#lead-tbody', el);
    tbody.onchange = async (e) => {
      const pk = e.target.closest('tr')?.dataset.pk;
      if (!pk) return;
      if (e.target.classList.contains('sel')) { e.target.checked ? selected.add(pk) : selected.delete(pk); renderTable(); }
      if (e.target.classList.contains('status')) {
        e.target.className = `status status-select s-${e.target.value}`;
        await updateLead(pk, { status: e.target.value });
        renderCounts();
        renderStatusChips();
      }
    };
    tbody.onclick = async (e) => {
      const act = e.target.closest('button')?.dataset.act;
      const pk = e.target.closest('tr')?.dataset.pk;
      if (!act || !pk) return;
      const lead = leads.find((l) => l.pk === pk);
      if (act === 'dm') openDmDialog(lead);
      if (act === 'del' && confirm(`Supprimer @${lead.username} ?`)) { await db.delete('leads', pk); reload(); }
      if (act === 'note') {
        const d = $('#note-dialog', el);
        $('#note-text', d).value = lead.notes || '';
        d.dataset.pk = pk;
        d.showModal();
      }
    };

    const dm = $('#dm-dialog', el);
    $('#dm-regen', dm).onclick = () => generateDm(leads.find((l) => l.pk === dm.dataset.pk));
    $('#dm-copy', dm).onclick = async () => { await navigator.clipboard.writeText($('#dm-text', dm).value); toast('Copié'); };
    $('#dm-close', dm).onclick = () => dm.close();
    $('#dm-open', dm).onclick = async () => {
      const lead = leads.find((l) => l.pk === dm.dataset.pk);
      await navigator.clipboard.writeText($('#dm-text', dm).value).catch(() => {});
      if (['new', 'liked', 'warm'].includes(lead.status)) await updateLead(lead.pk, { status: 'contacted', contactedAt: Date.now() });
      dm.close();
      sessionStorage.setItem('pendingDm', $('#dm-text', dm).value);
      navigate(`messages/${lead.username}`);
      toast('Message copié — colle-le (Ctrl+V) ou utilise « Insérer » dans le panneau.');
    };
    const nd = $('#note-dialog', el);
    $('#note-cancel', nd).onclick = () => nd.close();
    $('#note-save', nd).onclick = async () => { await updateLead(nd.dataset.pk, { notes: $('#note-text', nd).value }); nd.close(); renderTable(); };

    chrome.storage.onChanged.addListener((changes) => {
      if (changes.leadJob) renderJob(changes.leadJob.newValue);
    });
    renderJob((await chrome.storage.local.get('leadJob')).leadJob);
    await reload();
  },
  show() { if (el) reload(); },
};
