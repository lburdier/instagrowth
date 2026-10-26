// Petits utilitaires partagés (service worker + pages).

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const rand = (min, max) => Math.floor(min + Math.random() * (max - min + 1));

export const uid = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/** Clé de jour locale, ex. "2026-10-25". */
export function dayKey(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function hourKey(d = new Date()) {
  return `${dayKey(d)}T${String(d.getHours()).padStart(2, '0')}`;
}

export const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
export const PHONE_RE = /(\+?\d[\d\s.-]{7,}\d)/;

export function extractContacts(text = '') {
  const email = (text.match(EMAIL_RE) || [])[0] || '';
  const phone = (text.match(PHONE_RE) || [])[0] || '';
  return { email, phone: phone.trim() };
}

export function extractHashtags(text = '') {
  return [...new Set((text.match(/#[\p{L}\p{N}_]+/gu) || []).map((h) => h.toLowerCase()))];
}

export function fmtNum(n) {
  if (n == null || isNaN(n)) return '—';
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace('.0', '') + ' M';
  if (n >= 1e4) return (n / 1e3).toFixed(1).replace('.0', '') + ' k';
  return Math.round(n).toLocaleString('fr-FR');
}

export function fmtPct(n, digits = 2) {
  if (n == null || isNaN(n)) return '—';
  return n.toFixed(digits).replace('.', ',') + ' %';
}

export function fmtDate(ts, withTime = true) {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }) +
    (withTime ? ' ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '');
}

export function escapeHtml(s = '') {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Extrait le premier objet/tableau JSON d'une réponse de LLM. */
export function parseJsonLoose(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const src = fenced ? fenced[1] : text;
  const start = src.search(/[[{]/);
  if (start < 0) throw new Error('Pas de JSON dans la réponse IA');
  const open = src[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close && --depth === 0) return JSON.parse(src.slice(start, i + 1));
  }
  throw new Error('JSON IA incomplet');
}

export function toCsv(rows, columns) {
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.map((c) => esc(c.label)).join(','),
    ...rows.map((r) => columns.map((c) => esc(typeof c.get === 'function' ? c.get(r) : r[c.key])).join(','))].join('\n');
}

export function downloadText(filename, text, type = 'text/csv') {
  const blob = new Blob(['﻿' + text], { type: `${type};charset=utf-8` });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/** Mini-rendu markdown (titres, gras, listes, paragraphes) pour les rapports IA. */
export function miniMarkdown(md = '') {
  const lines = escapeHtml(md).split('\n');
  let html = '', inList = false;
  for (const raw of lines) {
    const line = raw.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`(.+?)`/g, '<code>$1</code>');
    const li = line.match(/^\s*(?:[-*•]|\d+\.)\s+(.*)/);
    if (li) {
      if (!inList) { html += '<ul>'; inList = true; }
      html += `<li>${li[1]}</li>`;
      continue;
    }
    if (inList) { html += '</ul>'; inList = false; }
    const h = line.match(/^(#{1,4})\s+(.*)/);
    if (h) html += `<h${h[1].length + 2}>${h[2]}</h${h[1].length + 2}>`;
    else if (line.trim()) html += `<p>${line}</p>`;
  }
  if (inList) html += '</ul>';
  return html;
}
