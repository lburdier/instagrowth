// Limites d'action — mêmes valeurs que l'extension (src/lib/limits.js).
//
// Important : passer par le débogage USB ne donne PAS plus de marge.
// Instagram compte les likes, abonnements et DM côté serveur, par compte,
// quel que soit l'appareil. Piloter la vraie app Android a l'air plus naturel
// qu'une API non officielle, mais un rythme trop rapide mène quand même aux
// « Réessayez plus tard », puis à des blocages plus longs. D'où ces plafonds.

export const LIMITS = {
  hard: {
    likesPerDay: 200,
    likesPerHour: 40,
    minDelaySec: 30,
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
    rateLimited: 2 * 60 * 60 * 1000, // likes qui ne « prennent » plus
    feedback: 24 * 60 * 60 * 1000, // « Réessayez plus tard » / action bloquée
    checkpoint: 48 * 60 * 60 * 1000, // « Confirmez que c'est vous »
  },
  // Chance de faire une « pause café » entre deux likes (comportement humain).
  breakChance: 0.08,
  breakMinutes: [8, 25],
  // Likes non confirmés d'affilée avant la pause de sécurité.
  maxConsecutiveFails: 3,
  // DM envoyés (toujours confirmés à la main) : plafond journalier.
  dmPerDay: 30,
};

export function clampLimits(cfg) {
  const h = LIMITS.hard;
  const out = { ...cfg };
  out.dailyLimit = Math.max(1, Math.min(h.likesPerDay, Number(cfg.dailyLimit) || 0));
  out.hourlyLimit = Math.max(1, Math.min(h.likesPerHour, Number(cfg.hourlyLimit) || 0));
  out.minDelaySec = Math.max(h.minDelaySec, Number(cfg.minDelaySec) || h.minDelaySec);
  out.maxDelaySec = Math.max(out.minDelaySec + 10, Number(cfg.maxDelaySec) || out.minDelaySec + 60);
  out.activeStart = Math.min(23, Math.max(0, Number(cfg.activeStart) || 0));
  out.activeEnd = Math.min(24, Math.max(out.activeStart + 1, Number(cfg.activeEnd) || 24));
  out.warmup = cfg.warmup !== false;
  return out;
}

const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Limite effective du jour en tenant compte du warm-up. */
export function effectiveDailyLimit(cfg, firstRunDay, today = dayKey()) {
  if (!cfg.warmup || !firstRunDay) return cfg.dailyLimit;
  const days = Math.floor((new Date(today) - new Date(firstRunDay)) / 86400000);
  if (days < 0 || days >= LIMITS.warmup.length) return cfg.dailyLimit;
  return Math.min(cfg.dailyLimit, LIMITS.warmup[days]);
}

/**
 * Garde-fou partagé par le bot et le mode Claude : rien ne like sans passer par lui.
 * L'état (compteurs, pause) est sauvegardé dans le Store, donc il survit à un redémarrage.
 */
export class LimitGuard {
  /**
   * @param {() => object} getCfg réglages de limites courants
   * @param {{state:object, saveState:(p:object)=>void}} states état persistant (séparé pour le simulateur)
   */
  constructor(getCfg, states, { now = () => Date.now() } = {}) {
    this.getCfg = getCfg;
    this.states = states;
    this.now = now;
  }

  get cfg() {
    return clampLimits(this.getCfg());
  }

  get st() {
    const s = this.states.state;
    return { likes: [], dms: [], pausedUntil: 0, pauseReason: '', consecutiveFails: 0, lastLikeAt: 0, firstRunDay: '', ...s };
  }

  save(patch) {
    this.states.saveState(patch);
  }

  likesSince(ms) {
    const t = this.now() - ms;
    return this.st.likes.filter((l) => l.t >= t).length;
  }

  likesToday() {
    const today = dayKey(new Date(this.now()));
    return this.st.likes.filter((l) => dayKey(new Date(l.t)) === today).length;
  }

  dmsToday() {
    const today = dayKey(new Date(this.now()));
    return this.st.dms.filter((l) => dayKey(new Date(l.t)) === today).length;
  }

  status() {
    const cfg = this.cfg;
    const st = this.st;
    const daily = effectiveDailyLimit(cfg, st.firstRunDay, dayKey(new Date(this.now())));
    const today = this.likesToday();
    const hour = this.likesSince(3600e3);
    const paused = st.pausedUntil > this.now();
    const h = new Date(this.now()).getHours();
    return {
      cfg,
      daily,
      today,
      hour,
      hourly: cfg.hourlyLimit,
      paused,
      pausedUntil: paused ? st.pausedUntil : 0,
      pauseReason: paused ? st.pauseReason : '',
      inHours: h >= cfg.activeStart && h < cfg.activeEnd,
      warmupDay: st.firstRunDay ? Math.floor((new Date(dayKey(new Date(this.now()))) - new Date(st.firstRunDay)) / 86400000) + 1 : 1,
      warmupActive: cfg.warmup && daily < cfg.dailyLimit,
      dmsToday: this.dmsToday(),
      dmPerDay: LIMITS.dmPerDay,
      lastLikeAt: st.lastLikeAt,
      consecutiveFails: st.consecutiveFails,
    };
  }

  /** @returns {{ok:true}|{ok:false, reason:string, retryAt?:number}} */
  canLike() {
    const s = this.status();
    if (s.paused) return { ok: false, reason: `Pause de sécurité jusqu’à ${new Date(s.pausedUntil).toLocaleString('fr-FR')} : ${s.pauseReason}`, retryAt: s.pausedUntil };
    if (!s.inHours) return { ok: false, reason: `Hors de la plage horaire active (${s.cfg.activeStart} h – ${s.cfg.activeEnd} h).` };
    if (s.today >= s.daily) return { ok: false, reason: `Plafond du jour atteint (${s.today}/${s.daily}${s.warmupActive ? `, montée progressive jour ${s.warmupDay}` : ''}).` };
    if (s.hour >= s.hourly) {
      const oldest = this.st.likes.filter((l) => l.t >= this.now() - 3600e3).map((l) => l.t).sort((a, b) => a - b)[0];
      return { ok: false, reason: `Plafond horaire atteint (${s.hour}/${s.hourly}).`, retryAt: oldest + 3600e3 };
    }
    return { ok: true };
  }

  /** Délai à respecter avant le prochain like (0 si on peut y aller). */
  waitBeforeNextLike(delayMs) {
    const last = this.st.lastLikeAt;
    if (!last) return 0;
    return Math.max(0, last + delayMs - this.now());
  }

  /** Délai aléatoire entre deux likes, avec de temps en temps une vraie pause. */
  nextDelayMs() {
    const c = this.cfg;
    let ms = (c.minDelaySec + Math.random() * (c.maxDelaySec - c.minDelaySec)) * 1000;
    let isBreak = false;
    if (Math.random() < LIMITS.breakChance) {
      const [a, b] = LIMITS.breakMinutes;
      ms += (a + Math.random() * (b - a)) * 60e3;
      isBreak = true;
    }
    return { ms: Math.round(ms), isBreak };
  }

  recordLike(entry) {
    const st = this.st;
    const t = this.now();
    const likes = [...st.likes.filter((l) => l.t > t - 8 * 86400e3), { t, ...entry }];
    this.save({ likes, lastLikeAt: t, consecutiveFails: 0, firstRunDay: st.firstRunDay || dayKey(new Date(t)) });
  }

  /** Un like non confirmé. Trop d'échecs d'affilée = pause (Instagram ne prend probablement plus les likes). */
  recordFail() {
    const n = this.st.consecutiveFails + 1;
    this.save({ consecutiveFails: n });
    if (n >= LIMITS.maxConsecutiveFails) {
      this.pause('rateLimited', `${n} likes d’affilée non enregistrés par Instagram.`);
      return true;
    }
    return false;
  }

  pause(kind, reason) {
    const ms = LIMITS.pause[kind] || LIMITS.pause.feedback;
    this.save({ pausedUntil: this.now() + ms, pauseReason: reason, consecutiveFails: 0 });
  }

  resume() {
    this.save({ pausedUntil: 0, pauseReason: '', consecutiveFails: 0 });
  }

  recordDm(entry) {
    const t = this.now();
    this.save({ dms: [...this.st.dms.filter((d) => d.t > t - 8 * 86400e3), { t, ...entry }] });
  }

  canSendDm() {
    if (this.status().paused) return { ok: false, reason: 'Pause de sécurité en cours.' };
    if (this.dmsToday() >= LIMITS.dmPerDay) return { ok: false, reason: `Plafond de ${LIMITS.dmPerDay} DM par jour atteint.` };
    return { ok: true };
  }
}
