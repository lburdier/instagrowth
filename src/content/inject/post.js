// Bouton IA dans la barre d'actions des publications (à côté de J'aime / Commenter / Partager) :
// propose des commentaires pertinents et les insère dans le champ de commentaire.

import { MARK, unitOf, cloneNative, popover, menu, suggestionsUI, ai, clean, insertInto, toast } from './dom.js';
import { openPanel } from './panel.js';

const COMMENT_RE = /^(Commenter|Comment|Comentar|Kommentieren|Commenta)$/i;

/** Texte utile d'une publication : auteur, légende, quelques commentaires. */
function postContext(container) {
  const lines = [...container.querySelectorAll('h1, span[dir="auto"], div[dir="auto"]')]
    .map((n) => clean(n.textContent))
    .filter((t) => t.length > 2);
  return [...new Set(lines)].join('\n').slice(0, 1800);
}

/** Code du post (shortcode) : URL de la page, sinon lien vers le post dans le bloc. */
function postCode(container) {
  const fromUrl = location.pathname.match(/^\/(?:[^/]+\/)?(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/);
  if (fromUrl && (container.closest('div[role="dialog"]') || container.tagName === 'MAIN' || !container.closest('article'))) return fromUrl[1];
  const link = container.querySelector('a[href*="/p/"], a[href*="/reel/"]');
  const m = link?.getAttribute('href').match(/\/(?:p|reel)\/([A-Za-z0-9_-]+)/);
  return m?.[1] || fromUrl?.[1] || '';
}

function commentField(container) {
  return container.querySelector('textarea') ||
    document.querySelector('div[role="dialog"] textarea') ||
    document.querySelector('form textarea');
}

export function injectPosts() {
  const icons = [...document.querySelectorAll('svg[aria-label]')].filter((s) => COMMENT_RE.test(s.getAttribute('aria-label')));
  for (const svg of icons) {
    const btn = svg.closest('button, [role="button"]');
    if (!btn || btn.closest(`[${MARK}]`)) continue;
    const unit = unitOf(btn);
    const row = unit.parentElement;
    if (!row || row.querySelector(`[${MARK}="post-ai"]`)) continue;
    const container = row.closest('article') || row.closest('div[role="dialog"]') || row.closest('main') || document.body;

    const aiBtn = cloneNative(unit, {
      key: 'post-ai',
      icon: 'sparkle',
      title: 'IA InstaGrowth : analyser ce post ou suggérer un commentaire',
      onClick: (_e, target) => menu(target, [
        {
          icon: 'chart',
          label: 'Analyser ce post',
          run: () => {
            const code = postCode(container);
            if (code) openPanel(`dashboard/p/${code}`);
            else toast('Impossible de trouver le lien de ce post.', true);
          },
        },
        { icon: 'sparkle', label: 'Suggérer un commentaire', run: () => commentPopover(target) },
      ]),
    });
    row.append(aiBtn);

    function commentPopover(target) {
      popover(target, (pop) => suggestionsUI(pop, {
        title: 'Commentaires IA',
        placeholder: 'Intention (optionnel) : féliciter, poser une question…',
        generate: async (intent) => {
          const res = await ai({
            json: true,
            effort: 'low',
            maxTokens: 1500,
            prompt: `Voici le contenu visible d'une publication Instagram (auteur, légende, commentaires) :
"""${postContext(container)}"""
Propose 3 commentaires courts (1 à 2 phrases), authentiques et spécifiques à ce post, qui donnent envie de répondre.
${intent ? `Intention : ${intent}.` : ''} Pas de « super post ! » générique, pas d'auto-promotion, 1 emoji max.
Format : ["…", "…", "…"]`,
          });
          return Array.isArray(res) ? res.map(String) : [];
        },
        onPick: (text) => {
          const field = commentField(container);
          if (!field) {
            // Ouvre le champ de commentaire natif puis insère.
            btn.click();
            setTimeout(() => insertInto(commentField(container), text), 400);
          } else insertInto(field, text);
        },
      }), { width: 340 });
    }
  }
}
