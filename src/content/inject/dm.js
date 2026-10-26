// Bouton IA dans la zone de saisie des messages privés (/direct/t/…) :
// lit les derniers messages visibles et propose des réponses à insérer.

import { MARK, iconEl, popover, suggestionsUI, ai, clean, insertInto } from './dom.js';

function composer() {
  if (!location.pathname.startsWith('/direct/')) return null;
  return document.querySelector('div[role="textbox"][contenteditable="true"]');
}

function recentMessages(box) {
  const scope = box.closest('[role="main"], main') || document.body;
  const lines = [...scope.querySelectorAll('div[dir="auto"], span[dir="auto"]')]
    .filter((n) => !box.contains(n) && !n.querySelector('div[dir="auto"], span[dir="auto"]'))
    .map((n) => clean(n.textContent))
    .filter((t) => t && t.length < 600);
  return lines.slice(-14).join('\n');
}

export function injectDm() {
  const box = composer();
  if (!box) return;
  // La rangée de saisie : parent qui contient aussi les icônes natives (emoji, micro, image…).
  let row = box.parentElement;
  while (row && row.querySelectorAll('svg').length === 0) row = row.parentElement;
  if (!row || row.querySelector(`[${MARK}="dm-ai"]`)) return;

  const btn = document.createElement('div');
  btn.setAttribute(MARK, 'dm-ai');
  btn.setAttribute('role', 'button');
  btn.setAttribute('tabindex', '0');
  btn.className = 'igg-icon-btn';
  btn.title = 'Réponse IA (InstaGrowth)';
  btn.append(iconEl('sparkle', 24, 'Réponse IA'));
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    popover(btn, (pop) => suggestionsUI(pop, {
      title: 'Réponses IA',
      placeholder: 'Objectif (optionnel) : proposer un appel, donner un prix…',
      generate: async (goal) => {
        const res = await ai({
          json: true,
          effort: 'low',
          maxTokens: 1500,
          prompt: `Derniers messages visibles d'une conversation privée Instagram (ordre chronologique, l'auteur n'est pas toujours indiqué) :
"""${recentMessages(box)}"""
Rédige 3 réponses possibles au dernier message de mon interlocuteur : une courte, une chaleureuse, une orientée action.
${goal ? `Objectif : ${goal}.` : ''} Ton naturel, comme sur mobile, 1 emoji max.
Format : ["…", "…", "…"]`,
        });
        return Array.isArray(res) ? res.map(String) : [];
      },
      onPick: (text) => insertInto(box, text),
    }), { width: 360 });
  }, true);
  row.insertBefore(btn, row.firstChild);
}
