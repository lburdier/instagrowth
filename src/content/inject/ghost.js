// Mode fantôme stories : synchronise le réglage avec la page (attribut lu par
// ig-capture.js dans le monde MAIN) et affiche un badge pendant les stories.

import { MARK, iconEl, toast, extensionAlive } from './dom.js';

let ghost = false;
let blockedThisPage = 0;

function apply() {
  document.documentElement.setAttribute('data-igg-ghost', ghost ? '1' : '0');
}

export const isGhost = () => ghost;

export async function setGhost(on) {
  ghost = on;
  apply();
  const { settings = {} } = await chrome.storage.local.get('settings');
  await chrome.storage.local.set({ settings: { ...settings, ghost: { ...(settings.ghost || {}), stories: on } } });
  toast(on ? 'Mode fantôme activé : tes vues de stories restent invisibles' : 'Mode fantôme désactivé');
}

export async function initGhost() {
  const { settings } = await chrome.storage.local.get('settings');
  ghost = Boolean(settings?.ghost?.stories);
  apply();
  chrome.storage.onChanged.addListener((c) => {
    if (!c.settings || !extensionAlive()) return;
    ghost = Boolean(c.settings.newValue?.ghost?.stories);
    apply();
  });
  window.addEventListener('message', (e) => {
    if (e.source !== window || e.data?.source !== 'igg-ghost-blocked') return;
    blockedThisPage++;
    const badge = document.querySelector(`[${MARK}="ghost-badge"] .igg-ghost-count`);
    if (badge) badge.textContent = `${blockedThisPage} vue${blockedThisPage > 1 ? 's' : ''} masquée${blockedThisPage > 1 ? 's' : ''}`;
  });
}

/** Badge « Mode fantôme » en haut de l'écran pendant la lecture des stories. */
export function injectGhostBadge() {
  const onStories = location.pathname.startsWith('/stories/');
  const badge = document.querySelector(`[${MARK}="ghost-badge"]`);
  if (!onStories || !ghost) { badge?.remove(); return; }
  if (badge) return;
  const el = document.createElement('div');
  el.setAttribute(MARK, 'ghost-badge');
  el.className = 'igg-ghost-badge';
  el.title = 'InstaGrowth : tes vues ne sont pas envoyées à Instagram. Clique pour désactiver.';
  el.append(iconEl('ghost', 16));
  const label = document.createElement('span');
  label.textContent = 'Mode fantôme';
  const count = document.createElement('span');
  count.className = 'igg-ghost-count';
  count.textContent = blockedThisPage ? `${blockedThisPage} vue${blockedThisPage > 1 ? 's' : ''} masquée${blockedThisPage > 1 ? 's' : ''}` : 'actif';
  el.append(label, count);
  el.addEventListener('click', () => setGhost(false));
  document.body.append(el);
}
