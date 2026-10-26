// Vue Statistiques : KPIs, croissance, meilleurs créneaux, top posts, revue IA.

import { send, busy, $ } from '../ui.js';
import { computeStats, localInsights, statsForAi, erBenchmark } from '../../lib/stats.js';
import { complete } from '../../lib/ai.js';
import { barChart, lineChart } from '../charts.js';
import { escapeHtml, fmtNum, fmtPct, fmtDate, miniMarkdown } from '../../lib/util.js';
import { icon } from '../../lib/icons.js';
import { openPostInsight } from '../postInsight.js';

let el;
let current = null; // { profile, posts, stats, self }
let mine = null; // dernières stats de ton compte, pour la comparaison
const RECENT_KEY = 'recentAnalyses';

const TYPE_LABEL = { photo: 'Photo', video: 'Vidéo', carousel: 'Carrousel', reel: 'Reel' };

function delta(v) {
  if (v == null) return '<span class="muted">historique en cours</span>';
  return `<span class="${v >= 0 ? 'up' : 'down'}">${icon(v >= 0 ? 'arrowUp' : 'arrowDown', 12)} ${fmtNum(Math.abs(v))}</span>`;
}

function render() {
  const { profile: p, stats: s } = current;
  const bench = erBenchmark(s.followers);
  const erClass = s.engagementRate >= bench.good ? 'up' : s.engagementRate < bench.low ? 'down' : '';
  const growthPts = s.snapshots.map((x) => ({ label: x.date.slice(5).split('-').reverse().join('/'), value: x.followers }));

  $('#dash-body', el).innerHTML = `
    ${current.self ? '' : `<div class="other-banner">
      <span class="h-ico">${icon('search', 18)} Statistiques de <strong>@${escapeHtml(p.username)}</strong>, calculées sur ses publications publiques.</span>
      <span class="spacer"></span>
      <button class="sm" id="dash-compare">${icon('chart', 14)} Comparer avec mon compte</button>
      <button class="sm" id="dash-lead">${icon('userPlus', 14)} Ajouter aux leads</button>
      <button class="sm primary" id="dash-me">Revenir à mon compte</button>
    </div>
    <div id="dash-compare-out"></div>`}
    <div class="card row" style="margin-bottom:16px">
      <div class="avatar" style="width:64px;height:64px;background-image:url('${escapeHtml(p.pic)}')"></div>
      <div style="flex:1;min-width:200px">
        <h2 style="margin:0">@${escapeHtml(p.username)} ${p.isVerified ? icon('verified', 18, 'verified') : ''}</h2>
        <div class="muted">${escapeHtml(p.fullName || '')}${p.category ? ` · ${escapeHtml(p.category)}` : ''}</div>
        <div style="white-space:pre-wrap;margin-top:4px;font-size:13px">${escapeHtml(p.bio || '')}</div>
      </div>
      <a class="btn" href="https://www.instagram.com/${encodeURIComponent(p.username)}/" target="_blank">Voir le profil ${icon('external', 16)}</a>
    </div>

    <div class="grid g4" style="margin-bottom:16px">
      <div class="card kpi"><span class="label">Abonnés</span><span class="value">${fmtNum(s.followers)}</span><span class="delta">7 j : ${delta(s.growth7)} · 30 j : ${delta(s.growth30)}</span></div>
      <div class="card kpi"><span class="label">Taux d’engagement</span><span class="value ${erClass}">${fmtPct(s.engagementRate)}</span><span class="delta muted">repère : ${bench.low}–${bench.good} %</span></div>
      <div class="card kpi"><span class="label">Likes / commentaires moyens</span><span class="value">${fmtNum(s.avgLikes)} <small style="font-size:16px">/ ${fmtNum(s.avgComments)}</small></span><span class="delta muted">sur ${s.analyzed} posts</span></div>
      <div class="card kpi"><span class="label">Rythme</span><span class="value">${s.postsPerWeek.toFixed(1).replace('.', ',')}<small style="font-size:14px"> posts/sem.</small></span><span class="delta muted">dernier post il y a ${s.daysSinceLast != null ? Math.round(s.daysSinceLast) + ' j' : '—'}</span></div>
    </div>

    <div class="card" style="margin-bottom:16px">
      <div class="row between" style="margin-bottom:6px">
        <h2 style="margin:0">Publications récentes</h2>
        <div class="row">
          <div class="tabs" id="posts-sort"><button data-sort="recent" class="active">Récentes</button><button data-sort="eng">Top</button><button data-sort="flop">Flops</button></div>
          <div class="tabs" id="posts-view"><button data-view="table" class="active">Tableau</button><button data-view="grid">Grille</button></div>
        </div>
      </div>
      <p class="muted">${current.posts.length} publications · clique sur une publication pour son analyse IA détaillée.${current.postsSource === 'capture'
        ? ' Données récupérées depuis les pages Instagram (l’API limitait les requêtes).' : ''}</p>
      <div id="posts-list"></div>
    </div>

    <div class="grid g2" style="margin-bottom:16px">
      <div class="card"><h2>Croissance des abonnés</h2>${current.self ? lineChart(growthPts, { format: fmtNum })
        : '<div class="empty">L’historique d’abonnés n’est enregistré que pour ton compte (un relevé par jour).</div>'}</div>
      <div class="card">
        <h2>Diagnostic express</h2>
        ${localInsights(s).map((i) => `<div class="insight"><span class="dot ${i.level}"></span><div>${escapeHtml(i.text)}</div></div>`).join('')}
      </div>
    </div>

    <div class="grid g2" style="margin-bottom:16px">
      <div class="card"><h2>Engagement par jour</h2>${barChart(s.byWeekday, { format: (v) => fmtPct(v) })}</div>
      <div class="card"><h2>Engagement par heure de publication</h2>${barChart(s.byHour.filter((_, i) => i >= 6), { format: (v) => fmtPct(v) })}</div>
    </div>

    <div class="grid g3" style="margin-bottom:16px">
      <div class="card">
        <h2>Par format</h2>
        <table><thead><tr><th>Format</th><th>Posts</th><th>ER moyen</th><th>Vues moy.</th></tr></thead><tbody>
        ${Object.entries(s.byType).map(([t, v]) => `<tr><td>${TYPE_LABEL[t] || t}</td><td>${v.count}</td><td>${fmtPct(v.avgEr)}</td><td>${v.avgViews ? fmtNum(v.avgViews) : '—'}</td></tr>`).join('')}
        </tbody></table>
      </div>
      <div class="card">
        <h2>Longueur de légende</h2>
        ${barChart(s.captionLength.map((c) => ({ ...c, label: c.label.split(' ')[0] })), { height: 150, format: (v) => fmtPct(v) })}
      </div>
      <div class="card">
        <h2>Hashtags utilisés</h2>
        <div class="chips">${s.hashtags.slice(0, 16).map((h) => `<span class="chip" title="ER moyen ${fmtPct(h.avgEr)}">${escapeHtml(h.tag)} · ${h.uses}</span>`).join('') || '<span class="muted">Aucun hashtag détecté</span>'}</div>
      </div>
    </div>

    <div class="card">
      <div class="row between"><h2 class="h-ico" style="margin:0"><i data-i="sparkle"></i> Revue IA de ton compte</h2>
        <button class="primary" id="ai-review">Générer la revue IA</button></div>
      <p class="muted" style="margin-top:6px">L’IA analyse tes chiffres, tes meilleurs et pires posts, et te propose un plan d’action concret sur 30 jours.</p>
      <div id="ai-review-out"></div>
    </div>`;

  $('#ai-review', el).onclick = (e) => busy(e.currentTarget, aiReview);
  if (!current.self) {
    $('#dash-me', el).onclick = () => { $('#dash-user', el).value = ''; load(''); };
    $('#dash-compare', el).onclick = (e) => busy(e.currentTarget, renderCompare);
    $('#dash-lead', el).onclick = (e) => busy(e.currentTarget, async () => {
      await send('leads:addByUsername', { username: current.profile.username });
      e.currentTarget.textContent = 'Ajouté aux leads';
    });
  }
  $('#posts-list', el).onclick = (e) => {
    if (e.target.closest('a')) return;
    const t = e.target.closest('[data-code]');
    if (t) openPostInsight(t.dataset.code);
  };
  const tabs = (id, key, fn) => { $(id, el).onclick = (e) => {
    const v = e.target.closest(`[data-${key}]`)?.dataset[key];
    if (!v) return;
    for (const b of $(id, el).children) b.classList.toggle('active', b.dataset[key] === v);
    fn(v);
  }; };
  tabs('#posts-sort', 'sort', (v) => { postsSort = v; renderPosts(); });
  tabs('#posts-view', 'view', (v) => { postsView = v; renderPosts(); });
  renderPosts();
}

let postsSort = 'recent';
let postsView = 'table';

function renderPosts() {
  const list = sortPosts(postsSort);
  $('#posts-list', el).innerHTML = postsView === 'grid'
    ? `<div class="posts-grid">${list.map(tile).join('')}</div>`
    : postsTable(list);
}

function postsTable(list) {
  const { followers, avgLikes, avgComments } = current.stats;
  const avgEng = avgLikes + avgComments;
  const views = list.filter((p) => p.views);
  const avgViews = views.length ? views.reduce((a, p) => a + p.views, 0) / views.length : 0;
  const delta = (v, a) => {
    if (!a) return '<span class="muted">—</span>';
    const d = Math.round((v / a - 1) * 100);
    return `<span class="${d >= 10 ? 'up' : d <= -10 ? 'down' : 'muted'}">${d > 0 ? '+' : ''}${d} %</span>`;
  };
  return `<div class="table-wrap"><table class="posts-table">
    <thead><tr><th>Publication</th><th>Publiée</th><th>J’aime</th><th>Comm.</th><th>Vues</th><th>Engagement</th><th>vs moyenne</th><th></th></tr></thead>
    <tbody>${list.map((p) => {
      const eng = p.likes + p.comments;
      return `<tr data-code="${p.code}" title="Analyser cette publication">
        <td><div class="row" style="flex-wrap:nowrap;gap:10px">
          <span class="pt-thumb" style="background-image:url('${escapeHtml(p.thumb)}')"></span>
          <div style="min-width:0"><span class="badge">${TYPE_LABEL[p.type] || ''}</span>
            <div class="pt-caption">${escapeHtml(p.caption.split('\n')[0].slice(0, 80)) || '<span class="muted">Sans légende</span>'}</div></div></div></td>
        <td style="white-space:nowrap">${fmtDate(p.takenAt)}</td>
        <td><strong>${fmtNum(p.likes)}</strong></td>
        <td>${fmtNum(p.comments)}</td>
        <td>${p.views ? `${fmtNum(p.views)} ${delta(p.views, avgViews)}` : '<span class="muted">—</span>'}</td>
        <td>${followers ? fmtPct((eng / followers) * 100) : '—'}</td>
        <td>${delta(eng, avgEng)}</td>
        <td><div class="row" style="flex-wrap:nowrap;gap:4px">
          <button class="sm">${icon('sparkle', 14)} Analyser</button>
          <a class="btn sm icon-btn" href="https://www.instagram.com/p/${p.code}/" target="_blank" title="Voir sur Instagram">${icon('external', 15)}</a></div></td>
      </tr>`;
    }).join('')}</tbody></table></div>`;
}

async function renderCompare() {
  if (!mine) {
    const r = await send('ig:stats', { username: '' });
    mine = { profile: r.profile, stats: computeStats(r.profile, r.posts, r.snapshots) };
  }
  const a = mine.stats;
  const b = current.stats;
  const rows = [
    ['Abonnés', a.followers, b.followers, fmtNum],
    ['Taux d’engagement', a.engagementRate, b.engagementRate, (v) => fmtPct(v)],
    ['J’aime moyens', a.avgLikes, b.avgLikes, fmtNum],
    ['Commentaires moyens', a.avgComments, b.avgComments, fmtNum],
    ['Publications / semaine', a.postsPerWeek, b.postsPerWeek, (v) => v.toFixed(1).replace('.', ',')],
    ['Hashtags / publication', a.avgTagsPerPost, b.avgTagsPerPost, (v) => v.toFixed(1).replace('.', ',')],
  ];
  const best = (x, y) => (x === y ? '' : x > y ? 'me' : 'them');
  const fmtType = (st) => Object.entries(st.byType).sort((x, y) => y[1].avgEr - x[1].avgEr)[0]?.[0];
  $('#dash-compare-out', el).innerHTML = `<div class="card" style="margin-bottom:16px">
    <h2>Toi vs @${escapeHtml(current.profile.username)}</h2>
    <div class="table-wrap"><table class="compare-table">
      <thead><tr><th></th><th>@${escapeHtml(mine.profile.username)} (toi)</th><th>@${escapeHtml(current.profile.username)}</th></tr></thead>
      <tbody>${rows.map(([label, x, y, f]) => `<tr><td>${label}</td>
        <td class="${best(x, y) === 'me' ? 'win' : ''}">${f(x || 0)}</td>
        <td class="${best(x, y) === 'them' ? 'win' : ''}">${f(y || 0)}</td></tr>`).join('')}
        <tr><td>Meilleur format</td><td>${TYPE_LABEL[fmtType(a)] || '—'}</td><td>${TYPE_LABEL[fmtType(b)] || '—'}</td></tr>
        <tr><td>Meilleur créneau</td><td>${a.bestDay ? `${a.bestDay.label} ${a.bestHour?.label || ''}` : '—'}</td><td>${b.bestDay ? `${b.bestDay.label} ${b.bestHour?.label || ''}` : '—'}</td></tr>
      </tbody></table></div>
    <p class="muted" style="margin-top:10px">En vert : la meilleure valeur. L’engagement compte davantage que le nombre d’abonnés.</p>
  </div>`;
}

async function rememberAnalysis(profile) {
  const { [RECENT_KEY]: list = [] } = await chrome.storage.local.get(RECENT_KEY);
  const next = [{ username: profile.username, pic: profile.pic, followers: profile.followers, at: Date.now() },
    ...list.filter((x) => x.username.toLowerCase() !== profile.username.toLowerCase())].slice(0, 10);
  await chrome.storage.local.set({ [RECENT_KEY]: next });
  renderRecent();
}

async function renderRecent() {
  const { [RECENT_KEY]: list = [] } = await chrome.storage.local.get(RECENT_KEY);
  $('#dash-recent', el).innerHTML = list.length ? `<span class="muted" style="font-size:12px">Récemment analysés :</span>
    ${list.map((x) => `<span class="chip click" data-user="${escapeHtml(x.username)}" title="${fmtNum(x.followers)} abonnés">
      <span class="avatar" style="width:18px;height:18px;background-image:url('${escapeHtml(x.pic || '')}')"></span>@${escapeHtml(x.username)}
      <button data-forget="${escapeHtml(x.username)}" title="Retirer">${icon('x', 11)}</button></span>`).join('')}` : '';
}

function sortPosts(kind) {
  const eng = (p) => p.likes + p.comments;
  const list = [...current.posts];
  if (kind === 'recent') return list.sort((a, b) => b.takenAt - a.takenAt);
  if (kind === 'flop') return list.sort((a, b) => eng(a) - eng(b));
  return list.sort((a, b) => eng(b) - eng(a));
}

function tile(post) {
  return `<button class="post-tile" data-code="${post.code}" title="Analyser ce post avec l’IA" style="background-image:url('${escapeHtml(post.thumb)}')">
    <span class="type">${TYPE_LABEL[post.type] || ''}</span>
    <span class="meta">${icon('heart', 13)} ${fmtNum(post.likes)} ${icon('message', 13)} ${fmtNum(post.comments)}${post.views ? ` ${icon('play', 12)} ${fmtNum(post.views)}` : ''}
      <small style="color:#ddd">${fmtDate(post.takenAt, false)}</small><span class="tile-cta">${icon('sparkle', 14)} Analyser</span></span></button>`;
}

async function aiReview() {
  const { profile, stats } = current;
  const out = $('#ai-review-out', el);
  out.innerHTML = '<p class="muted"><span class="spinner"></span> Analyse en cours…</p>';
  const text = await complete({
    effort: 'medium',
    maxTokens: 6000,
    prompt: `Voici les statistiques Instagram du compte @${profile.username} (JSON) :
${JSON.stringify(statsForAi(profile, stats))}

Rédige une revue structurée en markdown :
## Note globale (sur 10) et résumé en 2 phrases
## Points forts (3 max, chiffrés)
## Points faibles (3 max, chiffrés)
## Ce qui marche dans les top posts (format, sujet, accroche) vs les flops
## Plan d'action 30 jours (5 actions concrètes, priorisées, avec fréquence et format)
## 5 idées de posts adaptées au compte (titre + format + accroche)
Sois précis, concret, appuie-toi sur les chiffres fournis, n'invente aucune donnée.`,
  });
  out.innerHTML = `<div class="ai-out">${miniMarkdown(text)}</div>`;
}

async function load(username = '') {
  const body = $('#dash-body', el);
  body.innerHTML = '<div class="card empty"><span class="spinner"></span> Chargement des statistiques…</div>';
  try {
    const { profile, posts, snapshots, postsSource, postsError } = await send('ig:stats', { username });
    current = { profile, posts, postsSource, self: !username, stats: computeStats(profile, posts, snapshots) };
    if (current.self) mine = current;
    else rememberAnalysis(profile);
    const { bestDay, bestHour, byWeekday } = current.stats;
    if (!username && bestDay && bestHour) {
      // Réutilisé par la vue Publication pour suggérer un créneau.
      chrome.storage.local.set({ bestSlot: { day: byWeekday.indexOf(bestDay), hour: parseInt(bestHour.label, 10) } });
    }
    if (!posts.length) {
      body.innerHTML = profile.isPrivate || !profile.posts
        ? `<div class="card empty">${profile.isPrivate ? 'Ce compte est privé.' : 'Aucune publication à analyser.'}</div>`
        : `<div class="alert err"><strong>Impossible de récupérer les publications de @${escapeHtml(profile.username)}.</strong>
            ${postsError ? `<br>${escapeHtml(postsError)}` : ''}
            <br>Ouvre <a href="https://www.instagram.com/${encodeURIComponent(profile.username)}/" target="_blank">le profil sur Instagram</a> dans un onglet, attends que les publications s’affichent, puis clique sur <strong>Analyser</strong> : InstaGrowth récupère les publications chargées par la page.</div>`;
      return;
    }
    render();
  } catch (e) {
    body.innerHTML = `<div class="alert err"><strong>Impossible de charger les stats.</strong><br>${escapeHtml(e.message)}
      ${e.kind === 'auth' ? '<br><a href="https://www.instagram.com/accounts/login/" target="_blank">Se connecter à Instagram</a>' : ''}</div>`;
  }
}

export default {
  async mount(root) {
    el = root;
    el.innerHTML = `
      <div class="view-head">
        <div><h1>Statistiques</h1><p class="muted">Analyse de tes 36 derniers posts + historique quotidien des abonnés.</p></div>
        <div class="row">
          <button id="dash-post">${icon('sparkle', 16)} Analyser un post</button>
          <form class="row search-account" id="dash-form">
            <span class="search-ico">${icon('search', 16)}</span>
            <input type="search" id="dash-user" placeholder="Analyser un autre compte : @nom" style="width:260px" />
            <button class="primary" type="submit">Analyser</button>
          </form>
        </div>
      </div>
      <div class="row" id="dash-recent" style="margin:-10px 0 18px;gap:6px"></div>
      <div id="dash-body"></div>`;
    $('#dash-form', el).onsubmit = (e) => { e.preventDefault(); load($('#dash-user', el).value.trim().replace(/^@/, '')); };
    $('#dash-post', el).onclick = () => openPostInsight();
    $('#dash-recent', el).onclick = async (e) => {
      const forget = e.target.closest('[data-forget]');
      if (forget) {
        e.stopPropagation();
        const { [RECENT_KEY]: list = [] } = await chrome.storage.local.get(RECENT_KEY);
        await chrome.storage.local.set({ [RECENT_KEY]: list.filter((x) => x.username !== forget.dataset.forget) });
        return renderRecent();
      }
      const chip = e.target.closest('[data-user]');
      if (chip) { $('#dash-user', el).value = `@${chip.dataset.user}`; load(chip.dataset.user); }
    };
    renderRecent();
  },
  show([username = '', code = '']) {
    // #dashboard/p/<code> : analyse d'un post précis (bouton IA sur une publication Instagram).
    if (username === 'p' && code) {
      openPostInsight(code);
      if (!current) load('');
      return;
    }
    // #dashboard/<username> : analyse directe d'un autre compte (bouton « Analyser » sur Instagram).
    const user = decodeURIComponent(username);
    if (current && ((user && current.profile.username.toLowerCase() === user.toLowerCase()) || (!user && current.self))) return;
    $('#dash-user', el).value = user ? `@${user}` : '';
    load(user);
  },
};
