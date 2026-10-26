// Sur la console Claude (platform.claude.com) : quand une clé API vient d'être
// créée et s'affiche, propose de la connecter à InstaGrowth en un clic.
// La clé n'est lue qu'au clic de l'utilisateur et n'est envoyée qu'à l'extension.
(() => {
  if (window.__iggClaude) return;
  window.__iggClaude = true;

  const KEY_RE = /sk-ant-api\d{2}-[A-Za-z0-9_-]{20,}/;
  const offered = new Set();
  let host = null;

  const mask = (k) => `${k.slice(0, 14)}…${k.slice(-4)}`;

  function ui() {
    if (host) return host.shadowRoot;
    host = document.createElement('div');
    host.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:2147483647';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>
        .card { width: 340px; background: #262626; color: #f5f5f5; border-radius: 16px; padding: 16px;
          box-shadow: 0 8px 28px rgba(0,0,0,.35); font: 14px/19px -apple-system, "Segoe UI", Roboto, sans-serif; }
        .head { display: flex; align-items: center; gap: 10px; font-weight: 600; margin-bottom: 8px; }
        .head img { width: 26px; height: 26px; border-radius: 7px; }
        .muted { color: #a8a8a8; font-size: 13px; }
        code { background: #121212; padding: 2px 6px; border-radius: 6px; font-size: 12px; }
        .row { display: flex; gap: 8px; margin-top: 12px; }
        button { flex: 1; border: 0; border-radius: 8px; padding: 9px 12px; font: 600 14px/18px inherit; font-family: inherit; cursor: pointer; }
        .primary { background: #0095f6; color: #fff; } .primary:hover { background: #1877f2; }
        .ghost { background: #363636; color: #f5f5f5; } .ghost:hover { background: #404040; }
        .ok { color: #58c322; font-weight: 600; } .err { color: #ff6b78; }
        button:disabled { opacity: .6; cursor: default; }
      </style>
      <div class="card"><div class="head"><img src="${chrome.runtime.getURL('icons/icon48.png')}" alt=""> InstaGrowth</div><div class="body"></div></div>`;
    document.documentElement.append(host);
    return root;
  }

  function close() { host?.remove(); host = null; }

  function showGuide() {
    const body = ui().querySelector('.body');
    body.innerHTML = `
      <div>Connecte Claude en 2 étapes :</div>
      <div class="muted" style="margin-top:6px">1. Clique sur <strong>Create Key</strong> (nomme-la « InstaGrowth »).<br>2. Quand la clé s'affiche, clique sur <strong>Connecter à InstaGrowth</strong> ici.</div>
      <div class="row"><button class="ghost" data-x>Masquer</button></div>`;
    body.querySelector('[data-x]').onclick = close;
  }

  function offer(key) {
    if (offered.has(key)) return;
    offered.add(key);
    const body = ui().querySelector('.body');
    body.innerHTML = `
      <div>Clé Claude détectée : <code>${mask(key)}</code></div>
      <div class="muted" style="margin-top:6px">Elle sera vérifiée puis stockée uniquement dans ton navigateur.</div>
      <div class="row"><button class="ghost" data-x>Ignorer</button><button class="primary" data-go>Connecter à InstaGrowth</button></div>
      <div class="msg" style="margin-top:10px"></div>`;
    body.querySelector('[data-x]').onclick = close;
    body.querySelector('[data-go]').onclick = async (e) => {
      const btn = e.currentTarget;
      const msg = body.querySelector('.msg');
      btn.disabled = true;
      btn.textContent = 'Vérification…';
      const res = await chrome.runtime.sendMessage({ type: 'claude:connect', key }).catch((err) => ({ ok: false, error: err.message }));
      if (res?.ok) {
        msg.innerHTML = '<span class="ok">Claude est connecté à InstaGrowth.</span>';
        btn.textContent = 'Connecté';
        setTimeout(close, 2500);
      } else {
        msg.innerHTML = `<span class="err">${(res?.error || 'Échec').replace(/</g, '&lt;')}</span>`;
        btn.disabled = false;
        btn.textContent = 'Réessayer';
      }
    };
  }

  /** Cherche une clé fraîchement affichée (champ en lecture seule ou texte de la boîte de dialogue). */
  function scan() {
    for (const input of document.querySelectorAll('input, textarea')) {
      const m = (input.value || '').match(KEY_RE);
      if (m) return offer(m[0]);
    }
    const dialog = document.querySelector('[role="dialog"], [role="alertdialog"]') || document.body;
    const m = (dialog.innerText || '').match(KEY_RE);
    if (m) offer(m[0]);
  }

  chrome.storage.local.get('claudeConnect').then(({ claudeConnect }) => {
    // Guide affiché seulement si l'utilisateur vient du bouton « Se connecter avec Claude » (< 30 min).
    if (claudeConnect && Date.now() - claudeConnect.startedAt < 30 * 60 * 1000) showGuide();
  });
  const loop = setInterval(() => {
    // Extension rechargée : ce script est orphelin, on s'arrête sans erreur.
    if (!chrome.runtime?.id) { clearInterval(loop); close(); return; }
    scan();
  }, 1000);
})();
