// Bouton « Analyser » au survol des miniatures de la grille d'un profil Instagram.

import { MARK, iconEl } from './dom.js';
import { openPanel } from './panel.js';
import { profileUsername } from './profile.js';

export function injectGrid() {
  if (!profileUsername() && !/^\/[^/]+\/(reels|tagged)\/?$/.test(location.pathname)) return;
  for (const a of document.querySelectorAll('main a[href*="/p/"], main a[href*="/reel/"]')) {
    if (a.querySelector(`[${MARK}="grid-ai"]`) || !a.querySelector('img')) continue;
    const code = (a.getAttribute('href').match(/\/(?:p|reel)\/([A-Za-z0-9_-]+)/) || [])[1];
    if (!code) continue;
    if (getComputedStyle(a).position === 'static') a.style.position = 'relative';
    const btn = document.createElement('span');
    btn.setAttribute(MARK, 'grid-ai');
    btn.setAttribute('role', 'button');
    btn.className = 'igg-grid-btn';
    btn.title = 'Analyser ce post (InstaGrowth)';
    btn.append(iconEl('sparkle', 14), document.createTextNode('Analyser'));
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openPanel(`dashboard/p/${code}`);
    }, true);
    a.append(btn);
  }
}
