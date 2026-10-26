// Icônes SVG au trait (2 px, grille 24×24), même famille que l'extension.
//   icon('heart', 18) → chaîne <svg>   |   <i data-i="heart" data-s="18"></i> + hydrateIcons()

const P = {
  phone: '<rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M10.5 18.5h3"/>',
  usb: '<path d="M12 3v13.5"/><path d="M9.5 5.5L12 3l2.5 2.5"/><path d="M12 13.5l-4-2.5V8.5"/><circle cx="8" cy="7.5" r="1.3"/><path d="M12 11l4-2V7"/><rect x="14.8" y="5" width="2.4" height="2.4"/><circle cx="12" cy="18.5" r="2.2"/>',
  heart: '<path d="M12 20s-7.5-4.6-8.9-9.2C2.2 7.6 4.3 4.5 7.6 4.5c1.9 0 3.4 1 4.4 2.6 1-1.6 2.5-2.6 4.4-2.6 3.3 0 5.4 3.1 4.5 6.3C19.5 15.4 12 20 12 20z"/>',
  sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/>',
  shield: '<path d="M12 3l7.5 3v5.5c0 4.6-3.2 8.2-7.5 9.5-4.3-1.3-7.5-4.9-7.5-9.5V6z"/>',
  shieldCheck: '<path d="M12 3l7.5 3v5.5c0 4.6-3.2 8.2-7.5 9.5-4.3-1.3-7.5-4.9-7.5-9.5V6z"/><path d="M8.8 12.2l2.2 2.2 4.2-4.4"/>',
  note: '<path d="M5 4h10l4 4v12H5z"/><path d="M15 4v4h4M8 12h8M8 16h5"/>',
  settings: '<path d="M4 7h9M18 7h2M4 17h3M12 17h8"/><circle cx="15.5" cy="7" r="2.5"/><circle cx="9.5" cy="17" r="2.5"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2.5"/>',
  play: '<path d="M7 4.5v15l12-7.5z"/>',
  refresh: '<path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v4h-4"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  alert: '<path d="M12 3.5l9.5 16.5h-19z"/><path d="M12 10v4.5M12 17.5v.5"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.8v.4"/>',
  user: '<circle cx="12" cy="8.5" r="4"/><path d="M4 20.5c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5"/>',
  hash: '<path d="M9.5 3.5l-2 17M16.5 3.5l-2 17M4 9h16.5M3.5 15H20"/>',
  send: '<path d="M21 3L10 14M21 3l-7 18-4-7-7-4z"/>',
  message: '<path d="M20.5 11.5a8.5 8.5 0 0 1-12.4 7.6L3.5 20.5l1.4-4.4A8.5 8.5 0 1 1 20.5 11.5z"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  home: '<path d="M3.5 10.5L12 3.5l8.5 7V20.5h-6v-6h-5v6h-6z"/>',
  power: '<path d="M12 3v8"/><path d="M6.6 6.6a8 8 0 1 0 10.8 0"/>',
  monitor: '<rect x="3" y="4" width="18" height="12.5" rx="2"/><path d="M8.5 20.5h7M12 16.5v4"/>',
  hand: '<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11M11 10.5V4a1.5 1.5 0 0 1 3 0v6.5M14 10.5V5.5a1.5 1.5 0 0 1 3 0v7.5"/><path d="M17 11.5a1.5 1.5 0 0 1 3 0V15a6.5 6.5 0 0 1-6.5 6.5h-1A6.5 6.5 0 0 1 7 18.4L4.6 14a1.6 1.6 0 0 1 2.7-1.7L8 13.5"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M16.5 6.5l2.5 2.5M14 9l2 2"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  bolt: '<path d="M13 2.5L4.5 13.5H12l-1 8 8.5-11H12z"/>',
  sprout: '<path d="M12 20.5V11M12 11c0-3.6-2.4-6-6.5-6 0 3.6 2.4 6 6.5 6zM12 13c0-3.3 2.2-5.5 6.5-5.5 0 3.3-2.2 5.5-6.5 5.5z"/>',
  coffee: '<path d="M4.5 9h12v5.5a5 5 0 0 1-5 5h-2a5 5 0 0 1-5-5z"/><path d="M16.5 10.5h1.5a2.5 2.5 0 0 1 0 5h-1.8M8 3.5v2.5M12 3.5v2.5"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  folder: '<path d="M3.5 6.5a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
  cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><rect x="9.5" y="9.5" width="5" height="5" rx="1"/><path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3"/>',
  swipe: '<path d="M12 20V5M7 10l5-5 5 5"/>',
  type: '<path d="M5 7V5h14v2M12 5v14M9 19h6"/>',
  link: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3.1-3.1a4.5 4.5 0 0 0-6.4-6.4L11.6 6M14 10a4.5 4.5 0 0 0-6.4 0l-3.1 3.1a4.5 4.5 0 0 0 6.4 6.4l1.5-1.5"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
  flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="currentColor"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12.5A1.5 1.5 0 0 0 8.5 21h7a1.5 1.5 0 0 0 1.5-1.5L18 7M9 7V4.5h6V7"/>',
};

const FILLED = new Set(['play', 'stop']);

export function icon(name, size = 20, cls = '') {
  const f = FILLED.has(name);
  return `<svg class="ico${cls ? ` ${cls}` : ''}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="${f ? 'currentColor' : 'none'}" stroke="${f ? 'none' : 'currentColor'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;
}

export function hydrateIcons(root = document) {
  for (const el of root.querySelectorAll('i[data-i]:not([data-done])')) {
    el.innerHTML = icon(el.dataset.i, Number(el.dataset.s) || 18);
    el.setAttribute('data-done', '');
    el.classList.add('i');
  }
}

export function autoHydrate(root = document.body) {
  hydrateIcons(root);
  new MutationObserver(() => hydrateIcons(root)).observe(root, { childList: true, subtree: true });
}
