// Versions et releases GitHub de l'app desktop (tags « desktop-vX.Y.Z »).

export const TAG_PREFIX = 'desktop-v';

/** a est-elle plus récente que b ? (« 1.2.3 », suffixes -beta ignorés) */
export function newer(a, b) {
  const pa = String(a).split('-')[0].split('.').map(Number);
  const pb = String(b).split('-')[0].split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  }
  return false;
}

/** La release desktop publiée la plus récente (les releases de l'extension sont ignorées). */
export function pickDesktopRelease(releases) {
  return releases
    .filter((r) => !r.draft && !r.prerelease && String(r.tag_name).startsWith(TAG_PREFIX))
    .map((r) => ({
      version: r.tag_name.slice(TAG_PREFIX.length),
      tag: r.tag_name,
      notes: (r.body || '').trim(),
      url: r.html_url,
      date: r.published_at,
      hasInstaller: (r.assets || []).some((a) => a.name === 'latest.yml'),
    }))
    .sort((x, y) => (newer(x.version, y.version) ? -1 : newer(y.version, x.version) ? 1 : 0))[0] || null;
}
