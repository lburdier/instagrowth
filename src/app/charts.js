// Graphiques SVG minimalistes (pas de librairie externe : MV3 interdit le code distant).

import { escapeHtml } from '../lib/util.js';

const DEFS = `<defs><linearGradient id="barGrad" x1="0" y1="1" x2="0" y2="0">
  <stop offset="0%" stop-color="#962fbf"/><stop offset="100%" stop-color="#fa7e1e"/></linearGradient></defs>`;

export function barChart(data, { height = 180, format = (v) => v.toFixed(2) } = {}) {
  const w = 600, pad = { t: 16, r: 8, b: 24, l: 8 };
  const max = Math.max(...data.map((d) => d.value), 0.0001);
  const bw = (w - pad.l - pad.r) / data.length;
  const best = data.reduce((bi, d, i) => (d.value > data[bi].value ? i : bi), 0);
  const bars = data.map((d, i) => {
    const h = ((height - pad.t - pad.b) * d.value) / max;
    const x = pad.l + i * bw + bw * 0.15;
    const y = height - pad.b - h;
    return `<g><title>${escapeHtml(d.label)} : ${format(d.value)}${d.n != null ? ` (${d.n} posts)` : ''}</title>
      <rect class="bar ${i === best && d.value > 0 ? 'best' : ''}" x="${x}" y="${y}" width="${bw * 0.7}" height="${Math.max(h, d.value ? 2 : 0)}" rx="4"/>
      <text x="${x + bw * 0.35}" y="${height - 8}" text-anchor="middle">${escapeHtml(d.label)}</text></g>`;
  }).join('');
  return `<svg class="chart" viewBox="0 0 ${w} ${height}" role="img">${DEFS}
    <line class="grid-line" x1="0" x2="${w}" y1="${height - pad.b}" y2="${height - pad.b}"/>${bars}</svg>`;
}

export function lineChart(points, { height = 200, format = (v) => v } = {}) {
  if (points.length < 2) return '<div class="empty">Pas encore assez d’historique. Un snapshot est enregistré chaque jour automatiquement.</div>';
  const w = 600, pad = { t: 16, r: 12, b: 24, l: 44 };
  const vals = points.map((p) => p.value);
  let min = Math.min(...vals), max = Math.max(...vals);
  if (min === max) { min -= 1; max += 1; }
  const x = (i) => pad.l + (i * (w - pad.l - pad.r)) / (points.length - 1);
  const y = (v) => pad.t + (1 - (v - min) / (max - min)) * (height - pad.t - pad.b);
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const area = `${path} L${x(points.length - 1)},${height - pad.b} L${x(0)},${height - pad.b} Z`;
  const ticks = [min, (min + max) / 2, max].map((v) => `<line class="grid-line" x1="${pad.l}" x2="${w - pad.r}" y1="${y(v)}" y2="${y(v)}"/>
    <text x="${pad.l - 6}" y="${y(v) + 3}" text-anchor="end">${escapeHtml(String(format(v)))}</text>`).join('');
  const step = Math.ceil(points.length / 6);
  const labels = points.map((p, i) => (i % step === 0 || i === points.length - 1)
    ? `<text x="${x(i)}" y="${height - 6}" text-anchor="middle">${escapeHtml(p.label)}</text>` : '').join('');
  const dots = points.map((p, i) => `<circle cx="${x(i)}" cy="${y(p.value)}" r="3" fill="var(--accent)"><title>${escapeHtml(p.label)} : ${escapeHtml(String(format(p.value)))}</title></circle>`).join('');
  return `<svg class="chart" viewBox="0 0 ${w} ${height}" role="img">${ticks}<path class="area" d="${area}"/><path class="line" d="${path}"/>${dots}${labels}</svg>`;
}

export function ring(value, max, { size = 150, stroke = 12 } = {}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.min(1, max ? value / max : 0);
  return `<svg width="${size}" height="${size}">
    <defs><linearGradient id="ringGrad"><stop offset="0%" stop-color="#fa7e1e"/><stop offset="100%" stop-color="#962fbf"/></linearGradient></defs>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--line)" stroke-width="${stroke}"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="url(#ringGrad)" stroke-width="${stroke}" stroke-linecap="round"
      stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - pct)}"/></svg>`;
}
