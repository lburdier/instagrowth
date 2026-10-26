// Arrêt immédiat et délais « humains ».
// Toute attente du bot passe par sleep(signal) : un clic sur « Arrêt immédiat »
// interrompt l'attente en cours, la commande ADB en cours et l'appel IA en cours.

export class StoppedError extends Error {
  constructor(msg = 'Arrêté par l’utilisateur.') {
    super(msg);
    this.name = 'StoppedError';
  }
}

export function throwIfStopped(signal) {
  if (signal?.aborted) throw new StoppedError();
}

export function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new StoppedError());
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, Math.max(0, ms));
    function onAbort() {
      clearTimeout(t);
      reject(new StoppedError());
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export const rand = (min, max) => min + Math.random() * (max - min);
export const randInt = (min, max) => Math.round(rand(min, max));

/** Petite pause entre deux gestes (lecture de l'écran, hésitation). */
export function humanPause(signal, min = 900, max = 2600) {
  return sleep(rand(min, max), signal);
}

/** Décale légèrement un point de tap pour ne jamais toucher exactement le centre. */
export function jitterPoint([x, y], [x1, y1, x2, y2], ratio = 0.18) {
  const dx = (x2 - x1) * ratio;
  const dy = (y2 - y1) * ratio;
  return [Math.round(x + rand(-dx, dx)), Math.round(y + rand(-dy, dy))];
}
