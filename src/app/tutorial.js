// Mini-tutoriels « Comment ça marche ? » affichés en tête de chaque écran.
// Ouverts la première fois ; une fois repliés, ils le restent (mémorisé dans le navigateur).

const KEY = (id) => `igg-tuto:${id}`;

function isClosed(id) {
  try { return localStorage.getItem(KEY(id)) === 'closed'; } catch { return false; }
}

// L'événement « toggle » ne remonte pas : on l'écoute en capture, une seule fois pour tout le document.
document.addEventListener('toggle', (e) => {
  const d = e.target;
  if (!(d instanceof HTMLDetailsElement) || !d.dataset.tuto) return;
  try { localStorage.setItem(KEY(d.dataset.tuto), d.open ? 'open' : 'closed'); } catch { /* stockage indisponible */ }
}, true);

/**
 * @param {string} id identifiant stable (mémorise l'état replié)
 * @param {string} title phrase d'accroche
 * @param {string[]} steps étapes (HTML court autorisé)
 * @param {string} [tip] astuce finale
 */
export function tutorial(id, title, steps, tip = '') {
  return `<details class="tuto" data-tuto="${id}" ${isClosed(id) ? '' : 'open'}>
    <summary><i data-i="sparkle" data-s="16"></i><span>Comment ça marche ? <span class="muted">${title}</span></span></summary>
    <ol>${steps.map((s) => `<li>${s}</li>`).join('')}</ol>
    ${tip ? `<p class="tuto-tip"><strong>Astuce :</strong> ${tip}</p>` : ''}
  </details>`;
}

export const TUTOS = {
  dashboard: () => tutorial('dashboard', 'tes statistiques en 4 étapes', [
    'Les chiffres de <strong>ton compte</strong> se chargent automatiquement (garde un onglet instagram.com ouvert).',
    'Le tableau <strong>Publications récentes</strong> montre l’écart de chaque publication par rapport à ta moyenne. Clique sur une ligne pour son <strong>analyse IA</strong>.',
    'Pour <strong>un autre compte</strong>, tape <code>@nom</code> dans la recherche en haut, puis clique sur <strong>Comparer avec mon compte</strong>.',
    'En bas de page, <strong>Générer la revue IA</strong> te donne une note et un plan d’action sur 30 jours (une IA doit être connectée dans Réglages &amp; IA).',
  ], 'le bouton « Analyser un post » accepte aussi le lien d’une publication de n’importe quel compte public.'),
  publisher: () => tutorial('publisher', 'créer et programmer un post', [
    'Glisse tes photos ou vidéos (jusqu’à 10 pour un carrousel) et choisis le format : 1:1, 4:5…',
    'Écris un <strong>brief</strong> dans l’assistant IA, puis clique sur <strong>3 légendes</strong>. Les boutons Améliorer, Raccourcir et CTA retouchent la légende.',
    'Clique sur <strong>Hashtags</strong> pour des suggestions : un clic en ajoute un, et tu peux enregistrer un set.',
    'Choisis une date puis <strong>Programmer</strong> : tu reçois une notification à l’heure prévue. <strong>Publier maintenant</strong> marche pour les photos ; les reels passent par Insta mobile.',
  ], 'la pastille « Meilleur créneau » remplit la date avec l’horaire où tes posts marchent le mieux.'),
  messages: () => tutorial('messages', 'répondre plus vite à tes DM', [
    'Tes messages privés s’affichent dans le téléphone de gauche.',
    'Clique dans la zone de saisie d’une conversation, puis sur <strong>Insérer</strong> à côté d’une réponse rapide ou d’une suggestion.',
    'Colle un message reçu dans l’<strong>Assistant de réponse</strong> pour obtenir 3 réponses adaptées.',
  ], 'l’envoi reste toujours manuel : c’est toi qui cliques sur Envoyer.'),
  leads: () => tutorial('leads', 'trouver et suivre des prospects', [
    '<strong>Trouver des leads</strong> : choisis une source, puis mets un ou plusieurs hashtags ou comptes <strong>séparés par des virgules</strong>, et clique sur Lancer la recherche.',
    'Pour un prospect précis, clique sur <strong>Ajouter un lead</strong> et saisis son @compte.',
    'La bio et les contacts se complètent tout seuls, petit à petit. <strong>Compléter les infos</strong> accélère.',
    'Fais avancer le <strong>statut</strong> de chaque lead, lance le <strong>score IA</strong>, utilise l’étincelle pour rédiger un message d’approche, et exporte en CSV.',
  ], 'tes leads peuvent servir de cibles à l’auto-like : bouton « Importer mes leads » dans Auto-like → Réglages.'),
  autolike: () => tutorial('autolike', 'l’auto-like en 4 étapes', [
    'Dans <strong>Réglages</strong>, ajoute tes cibles : hashtags, comptes concurrents et/ou liste de prospects (séparés par des virgules, ou un par ligne).',
    'Garde le préréglage <strong>Prudent</strong> au début, et choisis ta plage horaire et tes jours actifs.',
    'Active l’<strong>interrupteur</strong> en haut à droite et laisse un onglet instagram.com ouvert. Le premier like part dans la minute (ou clique sur Liker maintenant).',
    'Suis les résultats dans <strong>Comptes likés</strong>. Quand tout a été liké, un message te demande d’ajouter de nouveaux comptes.',
  ], 'les Automatisations (nouveaux abonnés, retour de like, VIP) ajoutent des cibles prioritaires sans rien faire de plus.'),
  automations: () => tutorial('automations', 'des règles qui likent pour toi', [
    'Active une règle avec son interrupteur, puis règle sa fréquence et son nombre maximum par passage.',
    'Pour les <strong>Comptes VIP</strong>, liste les comptes à suivre (séparés par des virgules).',
    'Clique sur <strong>Lancer maintenant</strong> pour tester une règle tout de suite. Ensuite, elle tourne toutes les 30 minutes.',
  ], 'l’auto-like doit être activé pour que les règles likent.'),
  mobile: () => tutorial('mobile', 'Instagram version mobile sur ton PC', [
    'Le téléphone affiche Instagram : les boutons du haut mènent à l’accueil, Découvrir, Créer et Reels.',
    'Pour <strong>publier une story ou un reel</strong>, active <strong>Imiter un iPhone</strong> (à droite), puis appuie sur ＋.',
    'Prépare ton média dans Publication → « Publier via Insta mobile » : le fichier est enregistré et la légende copiée.',
  ], 'si Instagram te déconnecte, désactive « Imiter un iPhone ».'),
  settings: () => tutorial('settings', 'configurer InstaGrowth', [
    '<strong>Connecte une IA</strong> : bouton « Se connecter avec Claude », ta clé <code>sk-ant-…</code>, ou OpenRouter pour des modèles gratuits.',
    'Remplis ton <strong>profil de marque</strong> (niche, audience, ton) : l’IA s’en sert pour tout.',
    'Plus bas : mode fantôme, publication programmée, <strong>mises à jour</strong> et journal des déconnexions Instagram.',
  ]),
};
