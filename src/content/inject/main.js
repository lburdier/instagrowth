// Intégration native d'InstaGrowth dans instagram.com.
// Instagram est une SPA React qui re-rend souvent : on observe le DOM et on
// (ré)injecte nos éléments de façon idempotente, avec un débounce.

import { syncTheme, closePopover, extensionAlive, MARK } from './dom.js';
import { injectNav } from './nav.js';
import { injectProfile } from './profile.js';
import { injectPosts } from './post.js';
import { injectDm } from './dm.js';
import { injectGrid } from './grid.js';

const FEATURES = [injectNav, injectProfile, injectPosts, injectGrid, injectDm];
let timer = null;
let observer = null;
let lastPath = location.pathname;

/** Après un rechargement de l'extension, ce script devient orphelin : on s'arrête et on retire nos éléments. */
function shutdown() {
  observer?.disconnect();
  clearTimeout(timer);
  closePopover();
  document.querySelectorAll(`[${MARK}], .igg-overlay`).forEach((n) => n.remove());
}

function run() {
  timer = null;
  if (!extensionAlive()) return shutdown();
  if (location.pathname !== lastPath) { lastPath = location.pathname; closePopover(); }
  syncTheme();
  for (const f of FEATURES) {
    try { f(); } catch (e) { console.debug('[InstaGrowth]', f.name, e); }
  }
}

function schedule() {
  if (!timer) timer = setTimeout(run, 350);
}

export function start() {
  run();
  observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true });
}
