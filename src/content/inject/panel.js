// Fenêtre modale au style d'Instagram qui affiche les outils InstaGrowth
// (le dashboard en mode « embed ») directement par-dessus instagram.com.

import { syncTheme } from './dom.js';

let overlay = null;

const TITLES = {
  dashboard: 'Statistiques', publisher: 'Publication', leads: 'Leads', autolike: 'Auto-like', settings: 'Réglages & IA',
};

export function openPanel(view = 'dashboard') {
  const theme = syncTheme();
  const name = view.split('/')[0];
  const src = chrome.runtime.getURL(`src/app/app.html?embed=1&theme=${theme}#${view}`);
  if (overlay) {
    overlay.querySelector('iframe').src = src;
    overlay.querySelector('.igg-modal-title').textContent = TITLES[name] || 'InstaGrowth';
    return;
  }
  overlay = document.createElement('div');
  overlay.className = 'igg-overlay';
  overlay.innerHTML = `
    <div class="igg-modal" role="dialog" aria-label="InstaGrowth">
      <div class="igg-modal-head">
        <span class="igg-modal-brand"><img src="${chrome.runtime.getURL('icons/icon32.png')}" alt=""> InstaGrowth</span>
        <span class="igg-modal-title">${TITLES[name] || ''}</span>
        <button class="igg-modal-close" aria-label="Fermer">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M5 5l14 14M19 5L5 19"/></svg>
        </button>
      </div>
      <iframe src="${src}" allow="clipboard-read; clipboard-write"></iframe>
    </div>`;
  document.body.append(overlay);
  document.documentElement.style.overflow = 'hidden';
  overlay.querySelector('.igg-modal-close').onclick = closePanel;
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) closePanel(); });
  document.addEventListener('keydown', onKey);
}

function onKey(e) { if (e.key === 'Escape') closePanel(); }

export function closePanel() {
  overlay?.remove();
  overlay = null;
  document.documentElement.style.overflow = '';
  document.removeEventListener('keydown', onKey);
}
