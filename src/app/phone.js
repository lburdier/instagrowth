// Cadre « téléphone » affichant instagram.com en version mobile (à la Inssist).
// Le service worker retire X-Frame-Options/CSP et force un User-Agent iPhone
// uniquement pour l'onglet du dashboard.

import { send } from './ui.js';
import { icon } from '../lib/icons.js';

const IG = 'https://www.instagram.com';
let registered = null;

function ensureRegistered() {
  registered ||= send('frame:register');
  return registered;
}

export function createPhone(container, startPath = '/', shortcuts = []) {
  container.innerHTML = `
    <div class="phone">
      <div class="phone-bar">
        <button data-nav="back" title="Retour">${icon('chevronLeft', 16)}</button>
        ${shortcuts.map(([label, path]) => `<button data-path="${path}">${label}</button>`).join('')}
        <button data-nav="reload" title="Recharger">${icon('refresh', 16)}</button>
      </div>
      <iframe name="igg-mobile" allow="clipboard-read; clipboard-write; camera; microphone; autoplay; fullscreen"></iframe>
    </div>`;
  const iframe = container.querySelector('iframe');

  const go = async (path) => {
    await ensureRegistered();
    iframe.src = path.startsWith('http') ? path : IG + path;
  };
  container.querySelector('.phone-bar').onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.path) go(b.dataset.path);
    else if (b.dataset.nav === 'back') iframe.contentWindow.postMessage({ type: 'igg:back' }, IG);
    else if (b.dataset.nav === 'reload') iframe.src = iframe.src;
  };
  go(startPath);

  return {
    go,
    /** Insère du texte dans le champ de saisie actif (DM, commentaire, légende). */
    insert(text) { iframe.contentWindow.postMessage({ type: 'igg:insert', text }, IG); },
  };
}
