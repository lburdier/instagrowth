// Lecture de l'arbre d'interface renvoyé par `uiautomator dump`.
// Le XML est simple et toujours au même format : un petit analyseur suffit,
// sans dépendance.

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&#10;': '\n', '&#13;': '' };
const decode = (s) => s.replace(/&(amp|lt|gt|quot|apos|#10|#13);|&#(\d+);/g, (m, _n, code) => (code ? String.fromCodePoint(Number(code)) : ENTITIES[m] ?? m));

function parseBounds(s) {
  const m = /\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/.exec(s || '');
  return m ? m.slice(1).map(Number) : [0, 0, 0, 0];
}

/**
 * @typedef {{ idx:number, text:string, desc:string, id:string, cls:string, pkg:string,
 *   clickable:boolean, scrollable:boolean, selected:boolean, checked:boolean, focused:boolean,
 *   enabled:boolean, bounds:number[], depth:number, parent:number }} UiNode
 */

/** @returns {UiNode[]} liste à plat, dans l'ordre du document */
export function parseUiXml(xml) {
  const nodes = [];
  const stack = [];
  const re = /<node\b([^>]*?)(\/?)>|<\/node>/g;
  let m;
  while ((m = re.exec(xml))) {
    if (m[0] === '</node>') {
      stack.pop();
      continue;
    }
    const attrs = {};
    for (const a of m[1].matchAll(/([\w:-]+)="([^"]*)"/g)) attrs[a[1]] = decode(a[2]);
    const node = {
      idx: nodes.length,
      text: attrs.text || '',
      desc: attrs['content-desc'] || '',
      id: attrs['resource-id'] || '',
      cls: attrs.class || '',
      pkg: attrs.package || '',
      clickable: attrs.clickable === 'true',
      scrollable: attrs.scrollable === 'true',
      selected: attrs.selected === 'true',
      checked: attrs.checked === 'true',
      focused: attrs.focused === 'true',
      enabled: attrs.enabled !== 'false',
      bounds: parseBounds(attrs.bounds),
      depth: stack.length,
      parent: stack.length ? stack[stack.length - 1] : -1,
    };
    nodes.push(node);
    if (m[2] !== '/') stack.push(node.idx);
  }
  return nodes;
}

export const center = (n) => [Math.round((n.bounds[0] + n.bounds[2]) / 2), Math.round((n.bounds[1] + n.bounds[3]) / 2)];
export const area = (n) => Math.max(0, n.bounds[2] - n.bounds[0]) * Math.max(0, n.bounds[3] - n.bounds[1]);
export const shortId = (id) => id.replace(/^.*:id\//, '');
export const label = (n) => (n.text || n.desc || '').trim();

/** Le nœud est-il entièrement visible dans la zone [top, bottom] ? */
export function fullyVisible(n, top, bottom) {
  return area(n) > 0 && n.bounds[1] >= top && n.bounds[3] <= bottom;
}

/**
 * Sélecteur : { id?: string|string[], desc?: RegExp, text?: RegExp, cls?: RegExp, clickable?: boolean }
 * - id : suffixe de resource-id (sans le préfixe « paquet:id/ »)
 * Toutes les conditions présentes doivent être vraies.
 */
export function matches(n, sel) {
  if (sel.id) {
    const ids = Array.isArray(sel.id) ? sel.id : [sel.id];
    if (!ids.includes(shortId(n.id))) return false;
  }
  if (sel.desc && !sel.desc.test(n.desc)) return false;
  if (sel.text && !sel.text.test(n.text)) return false;
  if (sel.label && !sel.label.test(label(n))) return false;
  if (sel.cls && !sel.cls.test(n.cls)) return false;
  if (sel.clickable !== undefined && n.clickable !== sel.clickable) return false;
  return area(n) > 0;
}

/** Plusieurs sélecteurs = plusieurs façons de trouver le même élément (de la plus sûre à la plus large). */
export function findAll(nodes, sels) {
  const list = Array.isArray(sels) ? sels : [sels];
  for (const sel of list) {
    const found = nodes.filter((n) => matches(n, sel));
    if (found.length) return found;
  }
  return [];
}

export const findOne = (nodes, sels) => findAll(nodes, sels)[0] || null;

/** Le plus petit nœud qui contient le point (x, y) ; à surface égale, le plus profond. */
export function nodeAt(nodes, x, y) {
  let best = null;
  for (const n of nodes) {
    const [x1, y1, x2, y2] = n.bounds;
    if (x >= x1 && x <= x2 && y >= y1 && y <= y2 && area(n) > 0) {
      if (!best || area(n) < area(best) || (area(n) === area(best) && n.depth > best.depth)) best = n;
    }
  }
  return best;
}

/** Remonte vers le premier ancêtre cliquable (c'est lui qui reçoit le tap). */
export function clickableAncestor(nodes, n) {
  let cur = n;
  while (cur && !cur.clickable && cur.parent >= 0) cur = nodes[cur.parent];
  return cur?.clickable ? cur : n;
}

export function nearest(list, [x, y]) {
  let best = null;
  let bd = Infinity;
  for (const n of list) {
    const [cx, cy] = center(n);
    const d = Math.hypot(cx - x, cy - y);
    if (d < bd) { bd = d; best = n; }
  }
  return best ? { node: best, distance: bd } : null;
}

/**
 * Version compacte de l'arbre pour l'IA : uniquement les éléments utiles
 * (cliquables, avec texte, champs, zones défilantes), coordonnées ramenées à
 * l'échelle de la capture envoyée.
 */
export function compactTree(nodes, scale = 1, max = 160) {
  const lines = [];
  for (const n of nodes) {
    if (area(n) === 0) continue;
    const useful = n.clickable || n.scrollable || label(n) || /EditText/.test(n.cls);
    if (!useful) continue;
    const [x1, y1, x2, y2] = n.bounds.map((v) => Math.round(v * scale));
    const flags = [n.clickable && 'cliquable', n.scrollable && 'défilant', n.selected && 'sélectionné', n.checked && 'coché', n.focused && 'focus', !n.enabled && 'désactivé'].filter(Boolean);
    const cls = n.cls.split('.').pop();
    const parts = [`[${n.idx}] ${cls}`];
    if (n.text) parts.push(`texte="${n.text.slice(0, 120).replace(/\s+/g, ' ')}"`);
    if (n.desc) parts.push(`desc="${n.desc.slice(0, 120).replace(/\s+/g, ' ')}"`);
    if (n.id) parts.push(`id=${shortId(n.id)}`);
    parts.push(`(${x1},${y1},${x2},${y2})`);
    if (flags.length) parts.push(flags.join(' '));
    lines.push(parts.join(' '));
    if (lines.length >= max) {
      lines.push(`… (${nodes.length - n.idx} éléments de plus non listés)`);
      break;
    }
  }
  return lines.join('\n');
}
