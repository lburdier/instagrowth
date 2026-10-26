// Helpers d'interface partagés par toutes les vues.

/** Appel au service worker. */
export async function send(type, payload = {}) {
  const res = await chrome.runtime.sendMessage({ type, ...payload });
  if (!res) throw new Error('Pas de réponse du service worker');
  if (!res.ok) {
    const e = new Error(res.error);
    e.kind = res.kind;
    throw e;
  }
  return res.data;
}

export function toast(text, type = '') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = text;
  document.getElementById('toasts').append(el);
  setTimeout(() => el.remove(), type === 'err' ? 6000 : 3500);
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Exécute une action async avec spinner sur le bouton et toast d'erreur. */
export async function busy(button, fn) {
  const html = button?.innerHTML;
  if (button) { button.disabled = true; button.innerHTML = `<span class="spinner"></span> ${button.textContent.trim()}`; }
  try {
    return await fn();
  } catch (e) {
    toast(e.message, 'err');
    // Avertissement (et non erreur) : ces messages sont destinés à l'utilisateur, pas des bugs.
    console.warn(e);
  } finally {
    if (button) { button.disabled = false; button.innerHTML = html; }
  }
}

export function navigate(hash) { location.hash = hash; }
