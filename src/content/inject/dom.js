// Helpers DOM pour l'intégration dans l'interface d'Instagram.
// Principe : on CLONE les éléments natifs (boutons, entrées de menu) pour hériter
// exactement du style d'Instagram, puis on remplace texte/icône et on branche nos actions.

import { icon } from '../../lib/icons.js';

export { icon };
export const MARK = 'data-igg';

/** Faux après un rechargement de l'extension : ce script est alors orphelin. */
export const extensionAlive = () => Boolean(globalThis.chrome?.runtime?.id);

export async function send(type, payload = {}) {
  if (!extensionAlive()) throw new Error('InstaGrowth vient d’être mis à jour : recharge la page Instagram.');
  const res = await chrome.runtime.sendMessage({ type, ...payload });
  if (!res?.ok) throw new Error(res?.error || 'Extension indisponible (recharge la page)');
  return res.data;
}

export const ai = (opts) => send('ai:complete', { opts });

/** Détecte le thème réel d'Instagram (indépendant du thème de l'OS). */
export function syncTheme() {
  const bg = getComputedStyle(document.body).backgroundColor;
  const [r, g, b] = (bg.match(/\d+/g) || [255, 255, 255]).map(Number);
  const dark = (r * 299 + g * 587 + b * 114) / 1000 < 128;
  document.documentElement.setAttribute('data-igg-theme', dark ? 'dark' : 'light');
  return dark ? 'dark' : 'light';
}

export const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();

/** Éléments cliquables dont le texte correspond exactement à l'une des regex. */
export function findClickables(root, regex) {
  return [...root.querySelectorAll('button, a, div[role="button"]')].filter((el) => !el.closest(`[${MARK}]`) && regex.test(clean(el.textContent)));
}

/** Remonte tant que le parent n'a qu'un enfant : renvoie le « bloc » complet d'un bouton. */
export function unitOf(el, stopAt = document.body) {
  let u = el;
  while (u.parentElement && u.parentElement !== stopAt && u.parentElement.childElementCount === 1) u = u.parentElement;
  return u;
}

/** Remplace le texte du nœud texte principal d'un clone. */
export function setLabel(root, label) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (clean(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT) });
  const first = walker.nextNode();
  if (first) {
    first.nodeValue = label;
    let n;
    while ((n = walker.nextNode())) n.nodeValue = '';
  } else {
    root.append(label);
  }
}

/** Clone un bouton natif avec son bloc, sans liens ni gestionnaires React. */
export function cloneNative(unit, { label, icon, onClick, key, title }) {
  const clone = unit.cloneNode(true);
  clone.setAttribute(MARK, key);
  clone.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'));
  clone.querySelectorAll('a').forEach((a) => { a.removeAttribute('href'); a.setAttribute('role', 'button'); });
  if (label != null) setLabel(clone, label);
  if (icon) {
    const svg = clone.querySelector('svg');
    if (svg) svg.replaceWith(iconEl(icon, svg.getAttribute('width') || 24, svg.getAttribute('aria-label') || title || ''));
  }
  const target = clone.matches('button, a, [role="button"]') ? clone : clone.querySelector('button, a, [role="button"]') || clone;
  target.style.cursor = 'pointer';
  if (title) target.setAttribute('title', title);
  target.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); onClick(e, target); }, true);
  return clone;
}

/** Élément <svg> à partir du jeu d'icônes partagé. */
export function iconEl(name, size = 24, label = '') {
  const tpl = document.createElement('template');
  tpl.innerHTML = icon(name, size);
  const svg = tpl.content.firstElementChild;
  if (label) { svg.setAttribute('aria-label', label); svg.removeAttribute('aria-hidden'); }
  return svg;
}

// --- Popover / menu natif -----------------------------------------------------

let openPop = null;
export function closePopover() { openPop?.remove(); openPop = null; }

export function popover(anchor, build, { width = 300 } = {}) {
  closePopover();
  const pop = document.createElement('div');
  pop.className = 'igg-pop';
  pop.style.width = `${width}px`;
  build(pop);
  document.body.append(pop);
  const r = anchor.getBoundingClientRect();
  const top = r.bottom + 8 + pop.offsetHeight > innerHeight ? Math.max(8, r.top - pop.offsetHeight - 8) : r.bottom + 8;
  pop.style.top = `${top}px`;
  pop.style.left = `${Math.min(innerWidth - width - 12, Math.max(12, r.left))}px`;
  openPop = pop;
  setTimeout(() => document.addEventListener('mousedown', function off(e) {
    if (!pop.contains(e.target)) { closePopover(); document.removeEventListener('mousedown', off); }
  }), 0);
  return pop;
}

export function menu(anchor, items) {
  return popover(anchor, (pop) => {
    pop.classList.add('igg-menu');
    for (const it of items) {
      const b = document.createElement('button');
      b.className = 'igg-menu-item';
      b.innerHTML = `<span class="igg-menu-ico">${icon(it.icon, 22)}</span><span>${it.label}</span>`;
      b.onclick = () => { closePopover(); it.run(); };
      pop.append(b);
    }
  }, { width: 260 });
}

export function toast(text, err = false) {
  const t = document.createElement('div');
  t.className = `igg-toast${err ? ' err' : ''}`;
  t.textContent = text;
  document.body.append(t);
  setTimeout(() => t.remove(), err ? 5000 : 2800);
}

export function insertInto(target, text) {
  if (!target) return false;
  target.focus();
  if (!document.execCommand('insertText', false, text) && 'value' in target) {
    const proto = target.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(target, text);
    target.dispatchEvent(new Event('input', { bubbles: true }));
  }
  return true;
}

/** Bloc de suggestions IA cliquables (commentaires, réponses DM). */
export function suggestionsUI(pop, { title, placeholder, generate, onPick }) {
  pop.innerHTML = `
    <div class="igg-pop-title">${icon('sparkle', 16)} ${title}</div>
    <input class="igg-input" placeholder="${placeholder}">
    <button class="igg-primary">Générer</button>
    <div class="igg-sugs"></div>`;
  const input = pop.querySelector('input');
  const btn = pop.querySelector('button');
  const box = pop.querySelector('.igg-sugs');
  const run = async () => {
    btn.disabled = true;
    btn.textContent = 'Génération…';
    box.innerHTML = '';
    try {
      const list = await generate(input.value.trim());
      for (const s of list) {
        const item = document.createElement('button');
        item.className = 'igg-sug';
        item.textContent = s;
        item.onclick = () => { onPick(s); closePopover(); };
        box.append(item);
      }
      if (!list.length) box.textContent = 'Aucune suggestion.';
    } catch (e) {
      box.innerHTML = `<div class="igg-error">${e.message.replace(/</g, '&lt;')}</div>`;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Régénérer';
    }
  };
  btn.onclick = run;
  input.onkeydown = (e) => { if (e.key === 'Enter') run(); };
  run();
}
