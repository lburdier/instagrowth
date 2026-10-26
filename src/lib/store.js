// Réglages et état léger dans chrome.storage.local.
// Les gros volumes (leads, posts + médias) vivent dans IndexedDB (voir db.js).

import { LIMITS } from './limits.js';

export const DEFAULT_SETTINGS = {
  ai: {
    provider: 'anthropic', // anthropic | openrouter | custom
    anthropic: { authType: 'apiKey', apiKey: '', oauthToken: '', model: 'claude-opus-5-5' },
    openrouter: { apiKey: '', model: '', onlyFree: true },
    custom: { baseUrl: 'http://localhost:11434/v1', apiKey: '', model: 'llama3.1' },
  },
  brand: {
    niche: '',
    audience: '',
    tone: 'chaleureux, authentique, expert',
    language: 'fr',
    offer: '',
  },
  publish: {
    mode: 'reminder', // reminder | auto (API web non officielle, expérimental)
    defaultHashtagSets: [],
  },
  autolike: {
    enabled: false,
    hashtags: [],
    competitors: [],
    preset: 'prudent',
    dailyLimit: LIMITS.presets.prudent.daily,
    hourlyLimit: LIMITS.presets.prudent.hourly,
    minDelaySec: LIMITS.presets.prudent.minDelaySec,
    maxDelaySec: LIMITS.presets.prudent.maxDelaySec,
    activeStart: 9,
    activeEnd: 22,
    warmup: true,
    skipPrivate: true,
    skipVerified: false,
    minFollowers: 50,
    maxFollowers: 20000,
    blacklist: [],
    addToLeads: true,
  },
  dmTemplates: [
    { id: 't1', name: 'Remerciement follow', text: 'Merci pour le follow ! Ravi(e) de te compter parmi nous ! Qu’est-ce qui t’a amené(e) sur le compte ?' },
    { id: 't2', name: 'Collab', text: 'Hello ! J’adore ton contenu, je pense qu’on aurait une super synergie. Partant(e) pour en discuter ?' },
  ],
};

function deepMerge(base, over) {
  if (Array.isArray(base) || typeof base !== 'object' || base === null) return over ?? base;
  const out = { ...base };
  for (const k of Object.keys(over || {})) {
    out[k] = k in base ? deepMerge(base[k], over[k]) : over[k];
  }
  return out;
}

export async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return deepMerge(DEFAULT_SETTINGS, settings || {});
}

export async function saveSettings(patch) {
  const current = await getSettings();
  const next = deepMerge(current, patch);
  await chrome.storage.local.set({ settings: next });
  return next;
}

export async function getState(key, fallback) {
  const res = await chrome.storage.local.get(key);
  return res[key] ?? fallback;
}

export async function setState(key, value) {
  await chrome.storage.local.set({ [key]: value });
  return value;
}

export async function patchState(key, patch, fallback = {}) {
  const cur = await getState(key, fallback);
  return setState(key, { ...cur, ...patch });
}
