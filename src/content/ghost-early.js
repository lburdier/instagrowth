// document_start : applique le mode fantôme le plus tôt possible, pour qu'une
// story ouverte directement par lien ne soit pas comptée avant le chargement
// complet de l'intégration InstaGrowth.
chrome.storage.local.get('settings').then(({ settings }) => {
  document.documentElement.setAttribute('data-igg-ghost', settings?.ghost?.stories ? '1' : '0');
}).catch(() => {});
