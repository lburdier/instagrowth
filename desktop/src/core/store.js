// Réglages et état persistants (un fichier JSON dans le dossier de l'app).
// Les clés API sont chiffrées avec le coffre de Windows (DPAPI via Electron
// safeStorage) quand il est disponible.

import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_SETTINGS = {
  adbPath: '',
  scrcpyPath: '',
  serial: '',
  sim: { enabled: false, blockAfter: 0, missRate: 0 },
  wifi: { host: '', auto: false },
  limits: { preset: 'prudent', dailyLimit: 60, hourlyLimit: 15, minDelaySec: 60, maxDelaySec: 180, warmup: true, activeStart: 9, activeEnd: 22 },
  ai: {
    provider: 'anthropic',
    anthropic: { apiKey: '', model: 'claude-opus-5-5', effort: 'medium' },
    openrouter: { apiKey: '', model: 'anthropic/claude-opus-5.5' },
    maxSteps: 25,
  },
};

const SECRET_PATHS = [['ai', 'anthropic', 'apiKey'], ['ai', 'openrouter', 'apiKey']];

function deepMerge(base, over) {
  if (over === undefined || over === null) return base;
  if (typeof over !== 'object' || Array.isArray(over)) return over;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = base && typeof base[k] === 'object' && !Array.isArray(base[k]) ? deepMerge(base[k], v) : v;
  return out;
}

const getIn = (o, p) => p.reduce((a, k) => a?.[k], o);
function setIn(o, p, v) {
  let cur = o;
  for (const k of p.slice(0, -1)) cur = cur[k] ??= {};
  cur[p[p.length - 1]] = v;
}

export class Store {
  /**
   * @param {string} dir dossier de données
   * @param {{encrypt:(s:string)=>string, decrypt:(s:string)=>string}|null} vault
   */
  constructor(dir, vault = null) {
    this.dir = dir;
    this.vault = vault;
    fs.mkdirSync(dir, { recursive: true });
    this.settingsFile = path.join(dir, 'settings.json');
    this.settings = deepMerge(structuredClone(DEFAULT_SETTINGS), this.readJson(this.settingsFile));
    for (const p of SECRET_PATHS) {
      const v = getIn(this.settings, p);
      if (typeof v === 'string' && v.startsWith('enc:')) {
        try { setIn(this.settings, p, this.vault ? this.vault.decrypt(v.slice(4)) : ''); } catch { setIn(this.settings, p, ''); }
      }
    }
  }

  /** État séparé par usage : « state » pour le vrai téléphone, « state-sim » pour le simulateur. */
  openState(name) {
    const file = path.join(this.dir, `${name}.json`);
    const self = this;
    return {
      state: this.readJson(file) || {},
      saveState(patch) {
        this.state = { ...this.state, ...patch };
        self.writeJson(file, this.state);
        return this.state;
      },
    };
  }

  readJson(file) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
  }

  writeJson(file, data) {
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, file);
  }

  saveSettings(patch) {
    this.settings = deepMerge(this.settings, patch);
    const copy = JSON.parse(JSON.stringify(this.settings));
    for (const p of SECRET_PATHS) {
      const v = getIn(copy, p);
      if (v && this.vault) setIn(copy, p, `enc:${this.vault.encrypt(v)}`);
    }
    this.writeJson(this.settingsFile, copy);
    return this.settings;
  }

  /** Réglages sans les clés (pour l'interface) : on indique seulement si une clé est enregistrée. */
  publicSettings() {
    const copy = JSON.parse(JSON.stringify(this.settings));
    for (const p of SECRET_PATHS) {
      const v = getIn(copy, p);
      setIn(copy, p, v ? `${v.slice(0, 7)}…${v.slice(-4)}` : '');
    }
    copy.secrets = { anthropic: !!this.settings.ai.anthropic.apiKey, openrouter: !!this.settings.ai.openrouter.apiKey };
    return copy;
  }

}
