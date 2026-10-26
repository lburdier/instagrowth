// Cadre « téléphone » affichant instagram.com en version mobile (à la Inssist).
// Le service worker retire X-Frame-Options/CSP et force un User-Agent iPhone
// uniquement pour l'onglet du dashboard.

import { send } from './ui.js';
import { icon } from '../lib/icons.js';
import { getSettings, saveSettings } from '../lib/store.js';

const IG = 'https://www.instagram.com';
let registered = null;
let mobileUA = false;

async function ensureRegistered() {
  registered ||= getSettings().then((s) => { mobileUA = Boolean(s.phone?.mobileUA); return send('frame:register', { mobileUA }); });
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
      <iframe name="igg-phone" allow="clipboard-read; clipboard-write; camera; microphone; autoplay; fullscreen"></iframe>
    </div>`;
  const iframe = container.querySelector('iframe');

  const go = async (path) => {
    await ensureRegistered();
    // Le nom du cadre active (ou non) l'imitation iPhone côté page (content/ig-mobile.js).
    iframe.name = mobileUA ? 'igg-mobile' : 'igg-phone';
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

export function phoneModeNote() {
  return `<div class="card phone-note">
    <div class="row between" style="flex-wrap:nowrap;gap:14px">
      <div><strong>Imiter un iPhone</strong>
        <p class="muted" style="margin:4px 0 0">Affiche la vraie version mobile d’Instagram, nécessaire pour publier des stories. Instagram voit alors ta session à la fois sur ton PC et sur un « iPhone », ce qui peut <strong>provoquer des déconnexions</strong>. Désactive-la si ça t’arrive.</p></div>
      <label class="switch"><input type="checkbox" data-phone-ua><span></span></label>
    </div></div>`;
}

export async function bindPhoneModeNote(root) {
  const input = root.querySelector('[data-phone-ua]');
  if (!input) return;
  input.checked = Boolean((await getSettings()).phone?.mobileUA);
  input.onchange = async () => {
    await saveSettings({ phone: { mobileUA: input.checked } });
    location.reload();
  };
}
