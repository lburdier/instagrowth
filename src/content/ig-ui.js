// Monde isolé sur instagram.com :
//  - pont réseau : exécute les requêtes API pour le service worker, depuis
//    l'origine instagram.com (cookies + en-têtes identiques au site) ;
//  - dans le cadre « téléphone » du dashboard : insertion de texte / retour ;
//  - dans l'onglet normal : charge l'intégration native (inject/main.js).
(() => {
  if (window.__iggLoaded) return;
  window.__iggLoaded = true;

  const EXT_ORIGIN = `chrome-extension://${chrome.runtime.id}`;
  const inPhone = window.top !== window && (window.name === 'igg-mobile' || window.name === 'igg-phone');

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
      'x-ig-app-id': document.documentElement.getAttribute('data-igg-appid') || appId(),
      'x-csrftoken': cookie('csrftoken'),
      'x-requested-with': 'XMLHttpRequest',
      ...(document.documentElement.getAttribute('data-igg-asbd') ? { 'x-asbd-id': document.documentElement.getAttribute('data-igg-asbd') } : {}),
      'x-ig-www-claim': sessionStorage.getItem('www-claim-v2') || '0',
      ...(body?.kind === 'form' ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
      ...headers,
    };
    const res = await fetch(path, { method, headers: h, body: decodeBody(body), credentials: 'include' });
    const claim = res.headers.get('x-ig-set-www-claim');
    if (claim) sessionStorage.setItem('www-claim-v2', claim);
    return { status: res.status, text: await res.text() };
  }

  // --- Like par clic sur le vrai bouton (repli quand l'API de like a changé) ------
  const LIKE_RE = /^(J’aime|J'aime|Like|Me gusta|Gefällt mir|Mi piace|Curtir)$/i;
  const UNLIKE_RE = /^(Je n’aime plus|Je n'aime plus|Unlike|Ya no me gusta|Gefällt mir nicht mehr|Non mi piace più|Descurtir)$/i;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  /** Le cœur de la barre d'actions de la publication (24 px), pas ceux des commentaires (12-16 px). */
  function actionHeart(re) {
    const scope = document.querySelector('div[role="dialog"] article, main article, main') || document;
    return [...scope.querySelectorAll('svg[aria-label]')]
      .find((s) => re.test(s.getAttribute('aria-label')) && Number(s.getAttribute('width') || s.getBoundingClientRect().width) >= 20);
  }

  /** Bulle discrète en bas de la page (notifications de like optionnelles). */
  function showToast(text) {
    if (document.hidden) return;
    const t = document.createElement('div');
    t.className = 'igg-toast';
    t.textContent = text;
    document.body.append(t);
    setTimeout(() => t.remove(), 3500);
  }

  /** Ce que l'extension voit sur la page (pour diagnostiquer un like non confirmé). */
  function heartsSeen() {
    const scope = document.querySelector('div[role="dialog"] article, main article, main') || document;
    const labels = [...scope.querySelectorAll('svg[aria-label]')]
      .map((s) => `${s.getAttribute('aria-label')} (${Math.round(Number(s.getAttribute('width')) || s.getBoundingClientRect().width)})`);
    return [...new Set(labels)].slice(0, 8).join(', ') || 'aucune icône';
  }

  /** Séquence souris complète, comme un vrai clic. */
  function realClick(el) {
    const r = el.getBoundingClientRect();
    const opts = { bubbles: true, cancelable: true, composed: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 };
    el.dispatchEvent(new PointerEvent('pointerdown', { ...opts, pointerType: 'mouse', isPrimary: true }));
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new PointerEvent('pointerup', { ...opts, pointerType: 'mouse', isPrimary: true }));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.dispatchEvent(new MouseEvent('click', opts));
  }

  // Un seul clic par publication : recliquer pourrait retirer le like qu'on vient de mettre.
  let clickedPath = '';

  async function likeUi() {
    const clickedHere = clickedPath === location.pathname;
    if (!clickedHere) {
      if (actionHeart(UNLIKE_RE)) return { status: 'already' };
      const heart = actionHeart(LIKE_RE);
      if (!heart) return { status: 'notfound', seen: heartsSeen() };
      clickedPath = location.pathname;
      realClick(heart.closest('[role="button"], button') || heart.parentElement);
    }
    for (let i = 0; i < 20; i++) {
      await wait(300);
      if (actionHeart(UNLIKE_RE)) return { status: 'liked' };
      if (/action bloquée|action blocked|try again later|réessayez plus tard/i.test(document.body.innerText.slice(-3000))) return { status: 'blocked' };
    }
    return { status: 'notconfirmed', seen: heartsSeen() };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'igg:ping') { sendResponse('pong'); return false; }
    if (msg?.type === 'igg:session') { sendResponse({ userId: cookie('ds_user_id') }); return false; }
    if (msg?.type === 'igg:toast') { showToast(msg.text); return false; }
    if (msg?.type === 'igg:likeUi') { likeUi().then(sendResponse); return true; }
    if (msg?.type === 'igg:fetch') {
      igFetch(msg).then(sendResponse).catch((e) => sendResponse({ error: e.message }));
      return true;
    }
    return false;
  });

  // --- Publications captées par ig-capture.js (monde MAIN) --------------------------
  let pending = [];
  let pendingUsers = [];
  let flushTimer = null;
  window.addEventListener('message', (e) => {
    if (e.source !== window || e.data?.source !== 'igg-capture' || !Array.isArray(e.data.items)) return;
    pending.push(...e.data.items);
    pendingUsers.push(...(e.data.users || []));
    flushTimer ||= setTimeout(() => {
      flushTimer = null;
      const items = pending.splice(0);
      const users = pendingUsers.splice(0);
      if (chrome.runtime?.id) chrome.runtime.sendMessage({ type: 'capture:media', items, users }).catch(() => {});
    }, 800);
  });
  window.postMessage({ source: 'igg-capture-request' }, location.origin);

  // --- Intégration native dans l'interface d'Instagram ---------------------------
  import(chrome.runtime.getURL('src/content/inject/main.js'))
    .then((m) => m.start())
    .catch((e) => console.warn('[InstaGrowth] intégration UI indisponible', e));
})();
