// Monde MAIN, document_start : dans le cadre « téléphone » du dashboard
// uniquement, fait passer la page pour un iPhone afin d'obtenir l'interface
// mobile d'Instagram (création de stories/reels, DM plein écran…).
(() => {
  if (window.top === window || window.name !== 'igg-mobile') return;
  const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
  const define = (obj, prop, value) => {
    try { Object.defineProperty(obj, prop, { get: () => value, configurable: true }); } catch {}
  };
  define(Navigator.prototype, 'userAgent', UA);
  define(Navigator.prototype, 'appVersion', UA.slice(8));
  define(Navigator.prototype, 'platform', 'iPhone');
  define(Navigator.prototype, 'vendor', 'Apple Computer, Inc.');
  define(Navigator.prototype, 'maxTouchPoints', 5);
  define(Navigator.prototype, 'userAgentData', undefined);
  if (!('ontouchstart' in window)) window.ontouchstart = null;
})();
