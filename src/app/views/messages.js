// Vue Messages : DM Instagram dans un cadre mobile + réponses rapides + assistant IA.

import { toast, busy, $ } from '../ui.js';
import { TUTOS } from '../tutorial.js';
import { createPhone, phoneModeNote, bindPhoneModeNote } from '../phone.js';
import { getSettings, saveSettings } from '../../lib/store.js';
import { complete } from '../../lib/ai.js';
import { escapeHtml, uid } from '../../lib/util.js';

let el;
let phone;

async function renderTemplates() {
  const { dmTemplates } = await getSettings();
  $('#tpl-list', el).innerHTML = dmTemplates.map((t) => `
    <div class="log-item" data-id="${t.id}">
      <div style="flex:1;min-width:0"><strong>${escapeHtml(t.name)}</strong>
        <div class="muted" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(t.text)}</div></div>
      <button class="sm primary" data-act="insert">Insérer</button>
      <button class="sm" data-act="copy">Copier</button>
      <button class="sm ghost icon-btn" data-act="del" title="Supprimer"><i data-i="trash" data-s="16"></i></button>
    </div>`).join('') || '<div class="empty">Aucun modèle.</div>';
}

function suggestionHtml(list) {
  return list.map((s, i) => `
    <div class="card" style="padding:10px;margin-top:8px">
      <div style="white-space:pre-wrap;font-size:13px">${escapeHtml(s)}</div>
      <div class="row" style="margin-top:6px"><button class="sm primary" data-ins="${i}">Insérer</button><button class="sm" data-cp="${i}">Copier</button></div>
    </div>`).join('');
}

async function aiReplies() {
  const incoming = $('#ai-incoming', el).value.trim();
  if (!incoming) throw new Error('Colle le message reçu.');
  const res = await complete({
    json: true,
    effort: 'low',
    maxTokens: 2000,
    prompt: `On m’a envoyé ce message privé sur Instagram :
"""${incoming}"""
Contexte / objectif : ${$('#ai-context', el).value || 'répondre de façon utile et créer une relation'}.
Propose 3 réponses différentes (courte / chaleureuse / orientée action), naturelles, comme un humain sur mobile, 1 emoji max chacune.
Format : ["réponse 1", "réponse 2", "réponse 3"]`,
  });
  const list = Array.isArray(res) ? res.map(String) : [];
  const box = $('#ai-replies', el);
  box.innerHTML = suggestionHtml(list);
  box.onclick = (e) => {
    const i = e.target.dataset.ins ?? e.target.dataset.cp;
    if (i == null) return;
    if (e.target.dataset.ins != null) phone.insert(list[i]);
    else navigator.clipboard.writeText(list[i]).then(() => toast('Copié'));
  };
}

function renderPending() {
  const text = sessionStorage.getItem('pendingDm');
  const box = $('#pending', el);
  if (!text) { box.innerHTML = ''; return; }
  box.innerHTML = `<div class="alert info"><strong>Message prêt à envoyer</strong>
    <div style="white-space:pre-wrap;margin:6px 0">${escapeHtml(text)}</div>
    <div class="row"><button class="sm primary" id="p-ins">Insérer dans la conversation</button><button class="sm" id="p-clear">Effacer</button></div></div>`;
  $('#p-ins', el).onclick = () => phone.insert(text);
  $('#p-clear', el).onclick = () => { sessionStorage.removeItem('pendingDm'); renderPending(); };
}

export default {
  async mount(root) {
    el = root;
    el.innerHTML = `
      <div class="view-head"><div><h1>Messages</h1><p class="muted">Tes DM Instagram sur desktop, avec réponses rapides et assistant IA.</p></div></div>
      ${TUTOS.messages()}
      <div class="phone-wrap">
        <div id="dm-phone"></div>
        <div class="side-panel stack">
          ${phoneModeNote()}
          <div id="pending"></div>
          <div class="card">
            <h2 class="h-ico"><i data-i="sparkle"></i> Assistant de réponse</h2>
            <div class="field"><label>Message reçu</label><textarea id="ai-incoming" rows="3" placeholder="Colle ici le message de ton interlocuteur"></textarea></div>
            <div class="field"><label>Objectif (optionnel)</label><input type="text" id="ai-context" placeholder="ex. proposer un appel, donner le prix, rediriger vers le lien en bio"></div>
            <button class="primary" id="ai-reply">Suggérer 3 réponses</button>
            <div id="ai-replies"></div>
          </div>
          <div class="card">
            <div class="row between"><h2 class="h-ico" style="margin:0"><i data-i="bolt"></i> Réponses rapides</h2><button class="sm" id="tpl-add"><i data-i="plus" data-s="16"></i> Ajouter</button></div>
            <div class="log" id="tpl-list" style="margin-top:8px"></div>
            <form id="tpl-form" hidden style="margin-top:10px">
              <div class="field"><input type="text" id="tpl-name" placeholder="Nom du modèle" required></div>
              <div class="field"><textarea id="tpl-text" rows="3" placeholder="Texte du message" required></textarea></div>
              <div class="row"><button class="primary sm" type="submit">Enregistrer</button><button class="sm" type="button" id="tpl-cancel">Annuler</button></div>
            </form>
          </div>
          <p class="muted" style="font-size:12px">« Insérer » place le texte dans le champ de saisie actif du téléphone : clique d’abord dans la zone de message, puis envoie toi-même.</p>
        </div>
      </div>`;

    bindPhoneModeNote(el);
    phone = createPhone($('#dm-phone', el), '/direct/inbox/', [['Messages', '/direct/inbox/'], ['Demandes', '/direct/requests/'], ['Notifications', '/accounts/activity/']]);

    $('#ai-reply', el).onclick = (e) => busy(e.currentTarget, aiReplies);
    $('#tpl-add', el).onclick = () => { $('#tpl-form', el).hidden = false; };
    $('#tpl-cancel', el).onclick = () => { $('#tpl-form', el).hidden = true; };
    $('#tpl-form', el).onsubmit = async (e) => {
      e.preventDefault();
      const { dmTemplates } = await getSettings();
      await saveSettings({ dmTemplates: [...dmTemplates, { id: uid(), name: $('#tpl-name', el).value, text: $('#tpl-text', el).value }] });
      e.target.reset();
      e.target.hidden = true;
      renderTemplates();
    };
    $('#tpl-list', el).onclick = async (e) => {
      const act = e.target.dataset.act;
      const id = e.target.closest('[data-id]')?.dataset.id;
      if (!act || !id) return;
      const { dmTemplates } = await getSettings();
      const t = dmTemplates.find((x) => x.id === id);
      if (act === 'insert') phone.insert(t.text);
      if (act === 'copy') { await navigator.clipboard.writeText(t.text); toast('Copié'); }
      if (act === 'del') {
        const s = await getSettings();
        await chrome.storage.local.set({ settings: { ...s, dmTemplates: dmTemplates.filter((x) => x.id !== id) } });
        renderTemplates();
      }
    };
    renderTemplates();
  },
  show([username]) {
    renderPending();
    if (username) phone.go(`https://ig.me/m/${encodeURIComponent(username)}`);
  },
};
