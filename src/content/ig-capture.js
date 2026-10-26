// Monde MAIN, document_start, onglet principal d'instagram.com.
// Récupère les publications que la page Instagram charge ELLE-MÊME (profil,
// fil, reels…) en lisant les réponses de ses propres requêtes. Aucune requête
// supplémentaire n'est envoyée à Instagram : c'est la source la plus fiable et
// elle ne consomme aucun quota. Seuls quelques champs utiles sont transmis au
// content script (monde isolé) via postMessage.
(() => {
  if (window.top !== window || window.__iggCapture) return;
  window.__iggCapture = true;

  const URL_RE = /\/graphql|\/api\/v1\/(feed|media|users|clips|discover)/;

  // --- Mode fantôme stories -----------------------------------------------------
  // Quand il est actif (attribut posé sur <html> par le content script), les
  // requêtes qui signalent « story vue » ne partent pas : Instagram reçoit une
  // réponse factice et la story ne te compte pas dans ses vues.
  // Endpoints REST historiques de l'accusé « story vue ».
  const SEEN_URL = /\/api\/v1\/stories\/reel\/seen|\/stories\/reel\/mark_seen|\/api\/v2\/media\/seen/i;
  // GraphQL : uniquement le NOM de l'opération (jamais le contenu des variables, qui peut contenir des
  // paramètres internes ressemblant à « StoriesSeen » dans des requêtes de lecture du profil).
  // Il faut une mutation qui concerne une story/reel et le fait de l'avoir vue. Les « vu » des DM et notifications ne sont pas touchés.
  const isSeenMutation = (name) => /Mutation$/i.test(name) && /(Stor(y|ies)|Reel)/i.test(name) && /Seen/i.test(name) && !/Thread|Direct|Notification|Inbox/i.test(name);
  const FAKE = '{"status":"ok","data":{}}';
  const ghostOn = () => document.documentElement.getAttribute('data-igg-ghost') === '1';

  function bodyText(b) {
    try {
      if (!b) return '';
      if (typeof b === 'string') return b;
      if (b instanceof URLSearchParams) return b.toString();
      if (b instanceof FormData) return [...b.entries()].map(([k, v]) => `${k}=${typeof v === 'string' ? v : ''}`).join('&');
    } catch { /* corps illisible */ }
    return '';
  }

  function headerValue(h, name) {
    try {
      if (!h) return '';
      if (h instanceof Headers) return h.get(name) || '';
      if (Array.isArray(h)) return (h.find(([k]) => k.toLowerCase() === name) || [])[1] || '';
      const k = Object.keys(h).find((x) => x.toLowerCase() === name);
      return k ? String(h[k]) : '';
    } catch { return ''; }
  }

  function friendlyFromBody(body) {
    const text = bodyText(body);
    if (!text || !text.includes('fb_api_req_friendly_name')) return '';
    try { return new URLSearchParams(text).get('fb_api_req_friendly_name') || ''; } catch { return ''; }
  }

  function isStorySeen(url, body, friendlyName) {
    if (!ghostOn()) return false;
    if (SEEN_URL.test(url)) return true;
    if (!/\/graphql|\/api\/graphql/.test(url)) return false;
    return isSeenMutation(friendlyName || '') || isSeenMutation(friendlyFromBody(body));
  }

  function notifyBlocked() {
    window.postMessage({ source: 'igg-ghost-blocked' }, location.origin);
  }

  function slim(m) {
    const user = m.user || m.owner || {};
    return {
      pk: m.pk ?? m.id, code: m.code ?? m.shortcode, media_type: m.media_type, product_type: m.product_type, __typename: m.__typename,
      taken_at: m.taken_at ?? m.taken_at_timestamp, like_count: m.like_count ?? m.edge_liked_by?.count ?? m.edge_media_preview_like?.count,
      comment_count: m.comment_count ?? m.edge_media_to_comment?.count, play_count: m.play_count, view_count: m.view_count,
      ig_play_count: m.ig_play_count, video_view_count: m.video_view_count, has_liked: m.has_liked,
      caption: { text: m.caption?.text ?? m.edge_media_to_caption?.edges?.[0]?.node?.text ?? '' },
      image_versions2: m.image_versions2 ? { candidates: (m.image_versions2.candidates || []).slice(0, 4) } : undefined,
      carousel_media: m.carousel_media?.[0]?.image_versions2 ? [{ image_versions2: { candidates: m.carousel_media[0].image_versions2.candidates.slice(0, 4) } }] : undefined,
      carousel_media_count: m.carousel_media_count, display_url: m.display_url, thumbnail_src: m.thumbnail_src,
      user: { pk: user.pk ?? user.id, id: user.id, username: user.username, full_name: user.full_name, profile_pic_url: user.profile_pic_url },
    };
  }

  /** Parcourt une réponse JSON et collecte les objets « publication » qui portent des statistiques. */
  function collect(node, out, depth = 0) {
    if (!node || typeof node !== 'object' || depth > 40) return;
    if (Array.isArray(node)) { for (const n of node) collect(n, out, depth + 1); return; }
    const hasStats = node.like_count != null || node.edge_liked_by || node.edge_media_preview_like;
    if ((node.code || node.shortcode) && (node.pk || node.id) && hasStats && (node.user?.username || node.owner?.username)) {
      out.push(slim(node));
      return;
    }
    for (const k in node) if (node[k] && typeof node[k] === 'object') collect(node[k], out, depth + 1);
  }

  const buffer = [];
  window.addEventListener('message', (e) => {
    if (e.source === window && e.data?.source === 'igg-capture-request' && buffer.length) {
      window.postMessage({ source: 'igg-capture', url: 'buffer', items: buffer.slice(-400) }, location.origin);
    }
  });

  function handle(url, text) {
    if (typeof text !== 'string' || text.length > 4e6 || !text.includes('code') || !/like_count|edge_liked_by/.test(text)) return;
    const chunks = text.replace(/^for \(;;\);/, '').split('\n').filter(Boolean);
    const items = [];
    for (const chunk of chunks) {
      try { collect(JSON.parse(chunk), items); } catch { /* réponse non JSON */ }
    }
    if (!items.length) return;
    buffer.push(...items);
    if (buffer.length > 600) buffer.splice(0, buffer.length - 600);
    window.postMessage({ source: 'igg-capture', url: String(url).slice(0, 160), items }, location.origin);
  }

  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    try {
      const url = typeof input === 'string' ? input : input?.url || '';
      if (isStorySeen(url, init?.body, headerValue(init?.headers, 'x-fb-friendly-name'))) {
        notifyBlocked();
        return Promise.resolve(new Response(FAKE, { status: 200, headers: { 'content-type': 'application/json' } }));
      }
    } catch { /* ne jamais casser la page */ }
    const p = origFetch.apply(this, arguments);
    try {
      const url = typeof input === 'string' ? input : input?.url || '';
      if (URL_RE.test(url)) p.then((res) => res.clone().text()).then((t) => handle(url, t)).catch(() => {});
    } catch { /* ne jamais casser la page */ }
    return p;
  };

  const open = XMLHttpRequest.prototype.open;
  const send = XMLHttpRequest.prototype.send;
  const setHeader = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__iggUrl = String(url || '');
    this.__iggName = '';
    return open.apply(this, arguments);
  };
  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    if (String(name).toLowerCase() === 'x-fb-friendly-name') this.__iggName = String(value);
    return setHeader.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (body) {
    if (isStorySeen(this.__iggUrl || '', body, this.__iggName)) {
      notifyBlocked();
      const xhr = this;
      setTimeout(() => {
        const values = { readyState: 4, status: 200, statusText: 'OK', responseText: FAKE, responseURL: xhr.__iggUrl,
          response: xhr.responseType === 'json' ? JSON.parse(FAKE) : FAKE };
        for (const [k, v] of Object.entries(values)) Object.defineProperty(xhr, k, { configurable: true, get: () => v });
        for (const type of ['readystatechange', 'load', 'loadend']) xhr.dispatchEvent(new Event(type));
      }, 30);
      return undefined;
    }
    if (URL_RE.test(this.__iggUrl || '')) {
      this.addEventListener('load', () => {
        try {
          const body = this.responseType === '' || this.responseType === 'text' ? this.responseText
            : this.responseType === 'json' ? JSON.stringify(this.response) : null;
          handle(this.__iggUrl, body);
        } catch { /* ignore */ }
      });
    }
    return send.apply(this, arguments);
  };
})();
