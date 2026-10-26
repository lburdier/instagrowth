// Boutons InstaGrowth intégrés dans la rangée de boutons des profils,
// à côté de « Modifier le profil » (ton compte) ou « Suivre / Message » (les autres).

import { MARK, findClickables, unitOf, cloneNative, menu, send, toast } from './dom.js';
import { openPanel } from './panel.js';

const RESERVED = new Set(['explore', 'reels', 'direct', 'accounts', 'p', 'reel', 'stories', 'about', 'legal', 'developer', 'create', 'tv', 'web', 'emails', 'challenge', 'session']);
const OWN_RE = /^(Modifier le profil|Edit profile|Editar perfil|Profil bearbeiten|Modifica profilo)$/i;
const OTHER_RE = /^(Suivre|Suivre en retour|Follow|Follow back|Abonné\(e\)|Abonné|Abonnée|Following|Demandé|Requested|Message|Contacter|Envoyer un message|Seguir|Folgen|Segui)$/i;

export function profileUsername() {
  const m = location.pathname.match(/^\/([A-Za-z0-9._]{1,30})\/?$/);
  return m && !RESERVED.has(m[1].toLowerCase()) ? m[1] : null;
}

function primary(clone) {
  const btn = clone.matches('button, a, [role="button"]') ? clone : clone.querySelector('button, a, [role="button"]') || clone;
  btn.classList.add('igg-native-primary');
}

export function injectProfile() {
  const username = profileUsername();
  if (!username) return;
  const header = document.querySelector('main header') || document.querySelector('header');
  if (!header || header.querySelector(`[${MARK}^="profile"]`)) return;

  const own = findClickables(header, OWN_RE)[0];
  const other = own ? null : findClickables(header, OTHER_RE)[0];
  const anchor = own || other;
  if (!anchor) return;

  const unit = unitOf(anchor, header);
  const row = unit.parentElement;
  if (!row || row.querySelector(`[${MARK}]`)) return;

  if (own) {
    const boost = cloneNative(unit, {
      key: 'profile-boost',
      label: 'InstaGrowth',
      title: 'Outils de croissance InstaGrowth',
      onClick: (_e, btn) => menu(btn, [
        { icon: 'chart', label: 'Statistiques & revue IA', run: () => openPanel('dashboard') },
        { icon: 'calendar', label: 'Programmer un post', run: () => openPanel('publisher') },
        { icon: 'target', label: 'Leads', run: () => openPanel('leads') },
        { icon: 'heart', label: 'Auto-like', run: () => openPanel('autolike') },
        { icon: 'settings', label: 'Réglages & IA', run: () => openPanel('settings') },
        { icon: 'monitor', label: 'Ouvrir le dashboard complet', run: () => send('app:open', { hash: 'dashboard' }) },
      ]),
    });
    primary(boost);
    row.insertBefore(boost, row.firstChild);
  } else {
    const analyse = cloneNative(unit, {
      key: 'profile-analyse',
      label: 'Analyser',
      title: 'Statistiques et revue IA de ce compte',
      onClick: () => openPanel(`dashboard/${username}`),
    });
    const lead = cloneNative(unit, {
      key: 'profile-lead',
      label: 'Lead',
      title: 'Ajouter ce profil à tes leads',
      onClick: async (_e, btn) => {
        try {
          await send('leads:addByUsername', { username });
          toast(`@${username} ajouté à tes leads`);
          btn.textContent = 'Lead ajouté';
        } catch (e) {
          toast(e.message, true);
        }
      },
    });
    // Les clones d'un bouton « Suivre » bleu deviennent secondaires (gris) comme « Message ».
    for (const c of [analyse, lead]) {
      const b = c.matches('button, a, [role="button"]') ? c : c.querySelector('button, a, [role="button"]');
      b?.classList.add('igg-native-secondary');
    }
    unit.after(analyse, lead);
  }
}
