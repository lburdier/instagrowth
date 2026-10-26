// Limites d'action Instagram.
// Instagram ne publie pas de quotas officiels pour les likes ; ces valeurs sont
// volontairement conservatrices (en dessous des seuils communément observés
// qui déclenchent un « action block »). Les plafonds durs ne sont pas réglables
// depuis l'interface.

export const LIMITS = {
  hard: {
    likesPerDay: 200,
    likesPerHour: 40,
    minDelaySec: 30,
    // Lectures API (profils, feeds, hashtags) : délai mini entre deux requêtes.
    readGapMs: 1500,
    readsPerHour: 180,
  },
  presets: {
    prudent: { label: 'Prudent', daily: 60, hourly: 15, minDelaySec: 60, maxDelaySec: 180 },
    normal: { label: 'Normal', daily: 100, hourly: 22, minDelaySec: 45, maxDelaySec: 140 },
    actif: { label: 'Actif', daily: 150, hourly: 30, minDelaySec: 35, maxDelaySec: 110 },
  },
  // Montée en charge progressive les 7 premiers jours d'utilisation.
  warmup: [20, 30, 40, 55, 70, 85, 100],
  // Pauses automatiques après un signal négatif d'Instagram.
  pause: {
    rateLimited: 2 * 60 * 60 * 1000, // 429
    feedback: 24 * 60 * 60 * 1000, // feedback_required / action bloquée
    checkpoint: 48 * 60 * 60 * 1000, // checkpoint / challenge
  },
  // Chance de faire une « pause café » entre deux likes (comportement humain).
  breakChance: 0.08,
  breakMinutes: [8, 25],
  followBackChecksPerDay: 40,
};

export function clampAutolike(cfg) {
  const h = LIMITS.hard;
  const out = { ...cfg };
  out.dailyLimit = Math.max(1, Math.min(h.likesPerDay, Number(cfg.dailyLimit) || 0));
  out.hourlyLimit = Math.max(1, Math.min(h.likesPerHour, Number(cfg.hourlyLimit) || 0));
  out.minDelaySec = Math.max(h.minDelaySec, Number(cfg.minDelaySec) || h.minDelaySec);
  out.maxDelaySec = Math.max(out.minDelaySec + 10, Number(cfg.maxDelaySec) || out.minDelaySec + 60);
  out.activeStart = Math.min(23, Math.max(0, Number(cfg.activeStart) || 0));
  out.activeEnd = Math.min(24, Math.max(out.activeStart + 1, Number(cfg.activeEnd) || 24));
  return out;
}

/** Limite effective du jour en tenant compte du warm-up. */
export function effectiveDailyLimit(cfg, firstRunDay, today) {
  if (!cfg.warmup || !firstRunDay) return cfg.dailyLimit;
  const days = Math.floor((new Date(today) - new Date(firstRunDay)) / 86400000);
  if (days < 0 || days >= LIMITS.warmup.length) return cfg.dailyLimit;
  return Math.min(cfg.dailyLimit, LIMITS.warmup[days]);
}
