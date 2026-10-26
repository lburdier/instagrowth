// Monde isolé sur instagram.com :
//  - pont réseau : exécute les requêtes API pour le service worker, depuis
//    l'origine instagram.com (cookies + en-têtes identiques au site) ;
//  - dans le cadre « téléphone » du dashboard : insertion de texte / retour ;
//  - dans l'onglet normal : charge l'intégration native (inject/main.js).
(() => {
  if (window.__iggLoaded) return;
  window.__iggLoaded = true;

  const EXT_ORIGIN = `chrome-extension://${chrome.runtime.id}`;
  const inPhone = window.top !== window && window.name === 'igg-mobile';

  function insertText(text) {
    let target = document.activeElement;
    const isEditable = (n) => n && (n.isContentEditable || n.tagName === 'TEXTAREA' || n.tagName === 'INPUT');
    if (!isEditable(target)) {
      target = document.querySelector('div[contenteditable="true"][role="textbox"], textarea, div[contenteditable="true"]');
    }
    if (!target) return;
    target.focus();
    // execCommand déclenche les événements attendus par React.
    if (!document.execCommand('insertText', false, text) && 'value' in target) {
      target.value += text;
      target.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  if (inPhone) {
    window.addEventListener('message', (e) => {
      if (e.origin !== EXT_ORIGIN || !e.data?.type) return;
      if (e.data.type === 'igg:back') history.back();
      if (e.data.type === 'igg:insert') insertText(e.data.text || '');
    });
    return;
  }
  if (window.top !== window) return;

  // --- Pont réseau --------------------------------------------------------------
  // Instagram vérifie la cohérence User-Agent / App-ID : le site mobile (ou
  // l'émulation mobile des DevTools) utilise un autre identifiant que le desktop.
  const appId = () => (/Mobi|iPhone|iPad|Android/i.test(navigator.userAgent) ? '1217981644879628' : '936619743392459');
  const cookie = (name) => (document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`)) || [])[1] || '';

  function decodeBody(body) {
    if (!body) return undefined;
    if (body.kind === 'form' || body.kind === 'text') return body.data;
    if (body.kind === 'blob') {
      const bin = atob(body.data);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new Blob([bytes], { type: body.type });
    }
    return undefined;
  }

  async function igFetch({ path, method, headers, body, raw }) {
    const h = raw ? { accept: 'text/html,application/xhtml+xml', ...headers } : {
      'x-ig-app-id': appId(),
      'x-csrftoken': cookie('csrftoken'),
      'x-requested-with': 'XMLHttpRequest',
      'x-asbd-id': '129477',
      'x-ig-www-claim': sessionStorage.getItem('www-claim-v2') || '0',
      ...(body?.kind === 'form' ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
      ...headers,
    };
    const res = await fetch(path, { method, headers: h, body: decodeBody(body), credentials: 'include' });
    const claim = res.headers.get('x-ig-set-www-claim');
    if (claim) sessionStorage.setItem('www-claim-v2', claim);
    return { status: res.status, text: await res.text() };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'igg:ping') { sendResponse('pong'); return false; }
    if (msg?.type === 'igg:fetch') {
      igFetch(msg).then(sendResponse).catch((e) => sendResponse({ error: e.message }));
      return true;
    }
    return false;
  });

  // --- Publications captées par ig-capture.js (monde MAIN) --------------------------
  let pending = [];
  let flushTimer = null;
  window.addEventListener('message', (e) => {
    if (e.source !== window || e.data?.source !== 'igg-capture' || !Array.isArray(e.data.items)) return;
    pending.push(...e.data.items);
    flushTimer ||= setTimeout(() => {
      flushTimer = null;
      const items = pending.splice(0);
      if (chrome.runtime?.id) chrome.runtime.sendMessage({ type: 'capture:media', items }).catch(() => {});
    }, 800);
  });
  window.postMessage({ source: 'igg-capture-request' }, location.origin);

  // --- Intégration native dans l'interface d'Instagram ---------------------------
  import(chrome.runtime.getURL('src/content/inject/main.js'))
    .then((m) => m.start())
    .catch((e) => console.warn('[InstaGrowth] intégration UI indisponible', e));
})();
