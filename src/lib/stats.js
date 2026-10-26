// Calcul des statistiques d'un compte à partir de son profil et de ses posts.

import { extractHashtags } from './util.js';

const DAYS = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);

export function computeStats(profile, posts, snapshots = []) {
  const followers = profile.followers || 0;
  const eng = (p) => p.likes + p.comments;
  const er = (p) => (followers ? (eng(p) / followers) * 100 : 0);

  const sorted = [...posts].sort((a, b) => b.takenAt - a.takenAt);
  const avgLikes = avg(sorted.map((p) => p.likes));
  const avgComments = avg(sorted.map((p) => p.comments));
  const engagementRate = followers ? ((avgLikes + avgComments) / followers) * 100 : 0;

  // Fréquence de publication
  let postsPerWeek = 0;
  if (sorted.length >= 2) {
    const spanDays = (sorted[0].takenAt - sorted[sorted.length - 1].takenAt) / 86400000;
    postsPerWeek = spanDays > 0 ? (sorted.length / spanDays) * 7 : sorted.length;
  }
  const daysSinceLast = sorted[0] ? (Date.now() - sorted[0].takenAt) / 86400000 : null;

  // Par type de contenu
  const byType = {};
  for (const p of sorted) {
    (byType[p.type] ||= { count: 0, er: [], views: [] }).count++;
    byType[p.type].er.push(er(p));
    if (p.views) byType[p.type].views.push(p.views);
  }
  for (const t of Object.values(byType)) {
    t.avgEr = avg(t.er);
    t.avgViews = avg(t.views);
    delete t.er; delete t.views;
  }

  // Par jour / heure
  const wd = Array.from({ length: 7 }, () => []);
  const hr = Array.from({ length: 24 }, () => []);
  for (const p of sorted) {
    const d = new Date(p.takenAt);
    wd[d.getDay()].push(er(p));
    hr[d.getHours()].push(er(p));
  }
  const byWeekday = wd.map((a, i) => ({ label: DAYS[i], value: avg(a), n: a.length }));
  const byHour = hr.map((a, i) => ({ label: `${i}h`, value: avg(a), n: a.length }));
  const bestDay = [...byWeekday].filter((d) => d.n).sort((a, b) => b.value - a.value)[0];
  const bestHour = [...byHour].filter((d) => d.n).sort((a, b) => b.value - a.value)[0];

  // Hashtags
  const tagMap = {};
  for (const p of sorted) for (const t of extractHashtags(p.caption)) (tagMap[t] ||= []).push(er(p));
  const hashtags = Object.entries(tagMap)
    .map(([tag, a]) => ({ tag, uses: a.length, avgEr: avg(a) }))
    .sort((a, b) => b.uses - a.uses || b.avgEr - a.avgEr)
    .slice(0, 20);
  const avgTagsPerPost = avg(sorted.map((p) => extractHashtags(p.caption).length));

  // Longueur de légende
  const buckets = { 'Courte (<150)': [], 'Moyenne (150-600)': [], 'Longue (>600)': [] };
  for (const p of sorted) {
    const l = p.caption.length;
    buckets[l < 150 ? 'Courte (<150)' : l <= 600 ? 'Moyenne (150-600)' : 'Longue (>600)'].push(er(p));
  }
  const captionLength = Object.entries(buckets).map(([label, a]) => ({ label, value: avg(a), n: a.length }));

  const ranked = [...sorted].sort((a, b) => eng(b) - eng(a));

  // Croissance (snapshots quotidiens)
  const snaps = [...snapshots].sort((a, b) => a.date.localeCompare(b.date));
  const growth = (days) => {
    if (snaps.length < 2) return null;
    const last = snaps[snaps.length - 1];
    const target = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    const ref = snaps.find((s) => s.date >= target) || snaps[0];
    return last.followers - ref.followers;
  };

  return {
    followers,
    following: profile.following,
    postsCount: profile.posts,
    analyzed: sorted.length,
    avgLikes,
    avgComments,
    engagementRate,
    postsPerWeek,
    daysSinceLast,
    byType,
    byWeekday,
    byHour,
    bestDay,
    bestHour,
    hashtags,
    avgTagsPerPost,
    captionLength,
    topPosts: ranked.slice(0, 6),
    worstPosts: ranked.slice(-3).reverse(),
    growth7: growth(7),
    growth30: growth(30),
    snapshots: snaps,
  };
}

export function erBenchmark(followers) {
  // Repères grossiers de taux d'engagement (likes+commentaires / abonnés) par taille.
  if (followers < 5000) return { low: 2.5, good: 5 };
  if (followers < 20000) return { low: 1.8, good: 3.5 };
  if (followers < 100000) return { low: 1.2, good: 2.5 };
  if (followers < 1000000) return { low: 0.8, good: 1.8 };
  return { low: 0.5, good: 1.2 };
}

/** Recommandations calculées localement, sans IA. */
export function localInsights(s) {
  const out = [];
  const b = erBenchmark(s.followers);
  if (s.engagementRate >= b.good) out.push({ level: 'good', text: `Excellent taux d'engagement (${s.engagementRate.toFixed(2)} %) pour ta taille de compte.` });
  else if (s.engagementRate < b.low) out.push({ level: 'bad', text: `Taux d'engagement faible (${s.engagementRate.toFixed(2)} %, repère ≥ ${b.low} %). Mise sur plus d'appels à l'action et de contenus de conversation.` });
  else out.push({ level: 'mid', text: `Taux d'engagement dans la moyenne (${s.engagementRate.toFixed(2)} %). Objectif : ${b.good} %.` });

  if (s.postsPerWeek < 3) out.push({ level: 'bad', text: `Seulement ${s.postsPerWeek.toFixed(1)} posts/semaine. Vise 3 à 5 pour nourrir l'algorithme.` });
  if (s.daysSinceLast > 7) out.push({ level: 'bad', text: `Aucun post depuis ${Math.round(s.daysSinceLast)} jours : la portée baisse quand on s'arrête.` });

  const types = Object.entries(s.byType).filter(([, t]) => t.count >= 2).sort((a, b) => b[1].avgEr - a[1].avgEr);
  if (types.length >= 2) {
    const names = { photo: 'photos', video: 'vidéos', carousel: 'carrousels', reel: 'reels' };
    out.push({ level: 'good', text: `Tes ${names[types[0][0]]} performent ${(types[0][1].avgEr / Math.max(types[types.length - 1][1].avgEr, 0.01)).toFixed(1)}× mieux que tes ${names[types[types.length - 1][0]]}.` });
  }
  if (s.bestDay) out.push({ level: 'mid', text: `Meilleur jour observé : ${s.bestDay.label}${s.bestHour ? `, autour de ${s.bestHour.label}` : ''}.` });
  if (s.avgTagsPerPost < 3) out.push({ level: 'mid', text: `Peu de hashtags (${s.avgTagsPerPost.toFixed(1)}/post). 3 à 8 hashtags ciblés aident la découvrabilité.` });
  if (s.avgTagsPerPost > 20) out.push({ level: 'mid', text: `Beaucoup de hashtags (${s.avgTagsPerPost.toFixed(0)}/post). Privilégie 5 à 10 hashtags très ciblés.` });
  const ratio = s.following && s.followers ? s.following / s.followers : 0;
  if (ratio > 1.5) out.push({ level: 'bad', text: `Tu suis ${ratio.toFixed(1)}× plus de comptes que tu n'as d'abonnés : nettoie tes abonnements pour un profil plus crédible.` });
  return out;
}

/** Résumé compact envoyé à l'IA pour la revue. */
export function statsForAi(profile, s) {
  return {
    compte: { username: profile.username, bio: profile.bio, categorie: profile.category, abonnes: s.followers, abonnements: s.following, posts: s.postsCount },
    croissance: { j7: s.growth7, j30: s.growth30 },
    engagement: { taux: +s.engagementRate.toFixed(2), likesMoyens: Math.round(s.avgLikes), commentairesMoyens: Math.round(s.avgComments) },
    rythme: { postsParSemaine: +s.postsPerWeek.toFixed(1), joursDepuisDernierPost: s.daysSinceLast && Math.round(s.daysSinceLast) },
    parType: s.byType,
    meilleurJour: s.bestDay?.label,
    meilleureHeure: s.bestHour?.label,
    longueurLegende: s.captionLength,
    hashtagsTop: s.hashtags.slice(0, 10),
    topPosts: s.topPosts.map((p) => ({ type: p.type, likes: p.likes, commentaires: p.comments, vues: p.views, legende: p.caption.slice(0, 220) })),
    flopPosts: s.worstPosts.map((p) => ({ type: p.type, likes: p.likes, commentaires: p.comments, legende: p.caption.slice(0, 160) })),
  };
}
