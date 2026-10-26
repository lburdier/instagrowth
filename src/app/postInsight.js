// Analyse IA d'un post existant : chiffres du post comparés à la moyenne du
// compte, puis diagnostic et recommandations de l'IA.

import { send, busy } from './ui.js';
import { complete } from '../lib/ai.js';
import { icon } from '../lib/icons.js';
import { escapeHtml, fmtNum, fmtPct, fmtDate, miniMarkdown, extractHashtags } from '../lib/util.js';

const TYPE_LABEL = { photo: 'Photo', video: 'Vidéo', carousel: 'Carrousel', reel: 'Reel' };
let dlg;
let data = null;

const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);

function ensureDialog() {
  if (dlg) return dlg;
  dlg = document.createElement('dialog');
  dlg.className = 'post-dialog';
  dlg.innerHTML = `
    <div class="row between" style="margin-bottom:14px">
      <h2 class="h-ico" style="margin:0">${icon('sparkle')} Analyse d’un post</h2>
      <button class="ghost icon-btn" data-close title="Fermer">${icon('x', 18)}</button>
    </div>
    <form class="row" data-form style="margin-bottom:16px">
      <input type="search" data-ref placeholder="Lien du post (instagram.com/p/… ou /reel/…)" style="flex:1;min-width:220px">
      <button class="primary" type="submit">Analyser</button>
    </form>
    <div data-body></div>`;
  document.body.append(dlg);
  dlg.querySelector('[data-close]').onclick = () => dlg.close();
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  dlg.querySelector('[data-form]').onsubmit = (e) => {
    e.preventDefault();
    const ref = dlg.querySelector('[data-ref]').value.trim();
    if (ref) load(ref);
  };
  return dlg;
}

function metrics({ media, owner, recent }) {
  const followers = owner?.followers || 0;
  const eng = media.likes + media.comments;
  const avgLikes = avg(recent.map((p) => p.likes));
  const avgComments = avg(recent.map((p) => p.comments));
  const avgViews = avg(recent.filter((p) => p.views).map((p) => p.views));
  const ratio = (v, a) => (a ? v / a : null);
  return {
    followers,
    er: followers ? (eng / followers) * 100 : null,
    avgEr: followers && recent.length ? ((avgLikes + avgComments) / followers) * 100 : null,
    likesVs: ratio(media.likes, avgLikes),
    commentsVs: ratio(media.comments, avgComments),
    viewsVs: media.views ? ratio(media.views, avgViews) : null,
    avgLikes, avgComments, avgViews,
    hashtags: extractHashtags(media.caption),
    ageDays: (Date.now() - media.takenAt) / 86400000,
  };
}

function vs(r) {
  if (r == null) return '';
  const cls = r >= 1.1 ? 'up' : r <= 0.9 ? 'down' : 'muted';
  return `<span class="${cls}">${r >= 1 ? '+' : ''}${Math.round((r - 1) * 100)} % vs moyenne</span>`;
}

function render() {
  const { media, owner } = data;
  const m = data.m;
  const body = dlg.querySelector('[data-body]');
  body.innerHTML = `
    <div class="post-insight">
      <a class="pi-thumb" href="https://www.instagram.com/p/${media.code}/" target="_blank" style="background-image:url('${escapeHtml(media.thumb)}')" title="Voir sur Instagram">
        <span class="type">${TYPE_LABEL[media.type] || ''}${media.carouselCount ? ` · ${media.carouselCount}` : ''}</span></a>
      <div class="pi-side">
        <div class="row" style="gap:10px;margin-bottom:12px">
          <strong>@${escapeHtml(media.user?.username || '')}</strong>
          <small>${fmtDate(media.takenAt)}${media.location ? ` · ${escapeHtml(media.location)}` : ''}</small>
          <span class="spacer"></span>
          <a class="btn sm" href="https://www.instagram.com/p/${media.code}/" target="_blank">${icon('external', 14)} Ouvrir</a>
        </div>
        <div class="grid g2" style="gap:10px">
          <div class="card kpi pi-kpi"><span class="label">J’aime</span><span class="value">${fmtNum(media.likes)}</span><span class="delta">${vs(m.likesVs)}</span></div>
          <div class="card kpi pi-kpi"><span class="label">Commentaires</span><span class="value">${fmtNum(media.comments)}</span><span class="delta">${vs(m.commentsVs)}</span></div>
          <div class="card kpi pi-kpi"><span class="label">Taux d’engagement</span><span class="value">${m.er != null ? fmtPct(m.er) : '—'}</span><span class="delta muted">${m.avgEr != null ? `moyenne ${fmtPct(m.avgEr)}` : ''}</span></div>
          <div class="card kpi pi-kpi"><span class="label">${media.views ? 'Vues' : 'Hashtags'}</span><span class="value">${media.views ? fmtNum(media.views) : m.hashtags.length}</span><span class="delta">${media.views ? vs(m.viewsVs) : ''}</span></div>
        </div>
        <div class="pi-caption">${escapeHtml(media.caption || 'Sans légende').slice(0, 600)}${media.caption.length > 600 ? '…' : ''}</div>
      </div>
    </div>
    <div class="row between" style="margin-top:18px">
      <h3 class="h-ico" style="margin:0">${icon('sparkle', 16)} Diagnostic IA</h3>
      <button class="sm" data-regen>${icon('refresh', 14)} Relancer</button>
    </div>
    <div data-ai><p class="muted" style="margin-top:10px"><span class="spinner"></span> L’IA analyse le post…</p></div>`;
  body.querySelector('[data-regen]').onclick = (e) => busy(e.currentTarget, aiAnalysis);
  aiAnalysis().catch((e) => { body.querySelector('[data-ai]').innerHTML = `<div class="alert err" style="margin-top:10px">${escapeHtml(e.message)}</div>`; });
}

async function aiAnalysis() {
  const { media, owner, recent, m } = data;
  const box = dlg.querySelector('[data-ai]');
  box.innerHTML = '<p class="muted" style="margin-top:10px"><span class="spinner"></span> L’IA analyse le post…</p>';
  const payload = {
    post: {
      format: TYPE_LABEL[media.type], slides: media.carouselCount || undefined, dureeVideo: media.duration || undefined,
      publieIlYa: `${Math.round(m.ageDays)} jours`, jour: new Date(media.takenAt).toLocaleDateString('fr-FR', { weekday: 'long' }),
      heure: new Date(media.takenAt).getHours() + 'h', likes: media.likes, commentaires: media.comments, vues: media.views || undefined,
      tauxEngagement: m.er != null ? +m.er.toFixed(2) : undefined, legende: media.caption, hashtags: m.hashtags, lieu: media.location || undefined,
      personnesIdentifiees: media.usertags.length || undefined,
    },
    compte: owner ? { username: owner.username, abonnes: owner.followers, bio: owner.bio, categorie: owner.category } : undefined,
    comparaison: recent.length ? {
      postsCompares: recent.length,
      likesMoyens: Math.round(m.avgLikes), commentairesMoyens: Math.round(m.avgComments), vuesMoyennes: m.avgViews ? Math.round(m.avgViews) : undefined,
      tauxEngagementMoyen: m.avgEr != null ? +m.avgEr.toFixed(2) : undefined,
      autresPosts: recent.slice(0, 8).map((p) => ({ format: TYPE_LABEL[p.type], likes: p.likes, commentaires: p.comments, legende: p.caption.slice(0, 120) })),
    } : undefined,
  };
  const text = await complete({
    effort: 'medium',
    maxTokens: 6000,
    prompt: `Analyse ce post Instagram existant (données JSON) :
${JSON.stringify(payload)}

Réponds en markdown, de façon concrète et chiffrée, sans inventer de données (tu ne vois pas le visuel : appuie-toi sur le format, la légende et les chiffres) :
## Verdict (note sur 10) : performance par rapport à la moyenne du compte, en 2 phrases
## Pourquoi il a ${m.likesVs != null && m.likesVs < 0.9 ? 'sous-performé' : 'performé ainsi'} (3 raisons)
## Accroche et légende : ce qui marche, ce qui freine
## Hashtags et timing (jour/heure)
## 3 légendes réécrites (accroche plus forte, CTA clair)
## Comment le recycler (3 idées : autre format, suite, story)
## À tester au prochain post (2 actions)`,
  });
  box.innerHTML = `<div class="ai-out">${miniMarkdown(text)}</div>`;
}

async function load(ref) {
  const body = dlg.querySelector('[data-body]');
  body.innerHTML = '<div class="empty"><span class="spinner"></span> Récupération du post…</div>';
  try {
    const res = await send('ig:postInsight', { ref });
    data = { ...res, m: metrics(res) };
    render();
  } catch (e) {
    body.innerHTML = `<div class="alert err">${escapeHtml(e.message)}</div>`;
  }
}

/** Ouvre la fenêtre d'analyse ; sans référence, affiche seulement le champ de lien. */
export function openPostInsight(ref = '') {
  ensureDialog();
  dlg.querySelector('[data-ref]').value = ref && !ref.startsWith('http') ? `https://www.instagram.com/p/${ref}/` : ref;
  if (!dlg.open) dlg.showModal();
  if (ref) load(ref);
  else { dlg.querySelector('[data-body]').innerHTML = '<p class="muted">Colle le lien d’un de tes posts (ou d’un concurrent) pour savoir pourquoi il a marché ou non.</p>'; dlg.querySelector('[data-ref]').focus(); }
}

