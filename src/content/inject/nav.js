// Entrée « InstaGrowth » dans la barre de navigation latérale d'Instagram,
// clonée depuis l'entrée native « Découvrir » pour en garder exactement le style.

import { MARK, cloneNative, menu, send } from './dom.js';
import { openPanel } from './panel.js';

const SIBLING_LINKS = 'a[href="/reels/"], a[href="/direct/inbox/"]';

export function injectNav() {
  if (document.querySelector(`[${MARK}="nav"]`)) return;
  // Le lien « Découvrir » de la navigation desktop (et pas celui d'un contenu de page).
  const explore = [...document.querySelectorAll('a[href="/explore/"]')].find((a) => a.offsetParent && a.querySelector('svg'));
  if (!explore) return;

  // Remonte jusqu'au bloc « entrée de menu » : l'enfant direct de la liste qui contient aussi Reels / Messages.
  let item = explore;
  while (item.parentElement && !item.parentElement.querySelector(SIBLING_LINKS)) item = item.parentElement;
  if (!item.parentElement || item === document.body) return;

  const entry = cloneNative(item, {
    key: 'nav',
    label: 'InstaGrowth',
    icon: 'growth',
    title: 'InstaGrowth',
    onClick: (_e, target) => menu(target, [
      { icon: 'chart', label: 'Statistiques & revue IA', run: () => openPanel('dashboard') },
      { icon: 'calendar', label: 'Programmer un post', run: () => openPanel('publisher') },
      { icon: 'target', label: 'Leads', run: () => openPanel('leads') },
      { icon: 'heart', label: 'Auto-like', run: () => openPanel('autolike') },
      { icon: 'settings', label: 'Réglages & IA', run: () => openPanel('settings') },
      { icon: 'monitor', label: 'Ouvrir le dashboard complet', run: () => send('app:open', { hash: 'dashboard' }) },
    ]),
  });
  item.after(entry);
}
