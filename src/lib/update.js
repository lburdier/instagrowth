// Bandeau « nouvelle version disponible » partagé par le dashboard et la popup.
// L'état est écrit par le service worker (vérification périodique des releases GitHub).

import { icon } from './icons.js';
import { escapeHtml } from './util.js';

const call = (type) => chrome.runtime.sendMessage({ type }).then((r) => {
  if (!r?.ok) throw new Error(r?.error || 'Action impossible');
  return r.data;
});

/** Affiche (ou retire) le bandeau de mise à jour dans `container`. */
export async function renderUpdateBanner(container, { compact = false } = {}) {
  const { updateAvailable: u } = await chrome.storage.local.get('updateAvailable');
  const current = chrome.runtime.getManifest().version;
  if (!u || u.version === current) { container.innerHTML = ''; container.hidden = true; return; }
  container.hidden = false;
  container.innerHTML = `
    <div class="update-banner">
      <div class="update-head">
        <span class="update-ico">${icon('download', 18)}</span>
        <div style="flex:1;min-width:0"><strong>InstaGrowth ${escapeHtml(u.version)} est disponible</strong>
          <small>Tu utilises la version ${escapeHtml(current)}.</small></div>
      </div>
      <div class="update-actions">
        ${u.zip ? '<button class="sm primary" data-up="download">Télécharger</button>' : ''}
        <button class="sm" data-up="notes">Nouveautés</button>
        ${compact ? '' : '<button class="sm" data-up="howto">Comment mettre à jour</button>'}
        <button class="sm" data-up="reload" title="Après avoir remplacé les fichiers">Recharger l’extension</button>
      </div>
      <ol class="update-steps" hidden>
        <li>Clique sur <strong>Télécharger</strong> : le zip arrive dans <code>Téléchargements/InstaGrowth/</code>.</li>
        <li>Décompresse-le et <strong>remplace le contenu</strong> de ton dossier InstaGrowth (tes données sont conservées).</li>
        <li>Clique sur <strong>Recharger l’extension</strong>, puis recharge tes onglets Instagram.</li>
      </ol>
    </div>`;
  container.onclick = async (e) => {
    const action = e.target.closest('[data-up]')?.dataset.up;
    if (!action) return;
    if (action === 'notes') chrome.tabs.create({ url: u.url });
    if (action === 'howto') container.querySelector('.update-steps').hidden = !container.querySelector('.update-steps').hidden;
    if (action === 'download') {
      await call('update:download');
      e.target.textContent = 'Téléchargé';
      const steps = container.querySelector('.update-steps');
      if (steps) steps.hidden = false;
    }
    if (action === 'reload') call('update:reload');
  };
}
