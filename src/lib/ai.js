// Couche IA multi-fournisseurs : Claude (Anthropic), OpenRouter (OAuth PKCE,
// modèles gratuits) et tout endpoint compatible OpenAI (Ollama, LM Studio, Groq…).

import { getSettings, saveSettings } from './store.js';
import { parseJsonLoose } from './util.js';

export const CLAUDE_MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (recommandé)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (rapide)' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (économique)' },
  { id: 'claude-fable-5-1', label: 'Claude Fable 5.1 (le plus puissant)' },
];

// Modèles qui acceptent le fallback serveur en cas de refus des classifieurs.
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-fable-5-1', 'claude-opus-5']);

export class AiError extends Error {}

// --- Claude -----------------------------------------------------------------

async function callAnthropic(cfg, { system, prompt, effort, maxTokens }) {
  const headers = {
    'content-type': 'application/json',
    'anthropic-version': '2023-06-01',
    // Obligatoire pour appeler l'API depuis un navigateur / une extension.
    'anthropic-dangerous-direct-browser-access': 'true',
  };
  const betas = [];
  if (cfg.authType === 'oauth') {
    if (!cfg.oauthToken) throw new AiError('Jeton OAuth Claude manquant (Réglages → IA).');
    headers.authorization = `Bearer ${cfg.oauthToken}`;
    betas.push('oauth-2025-04-20');
  } else {
    if (!cfg.apiKey) throw new AiError('Clé API Claude manquante (Réglages → IA).');
    headers['x-api-key'] = cfg.apiKey;
  }
  const body = {
    model: cfg.model || 'claude-opus-5-5',
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: prompt }],
    output_config: { effort },
  };
  if (FALLBACK_MODELS.has(body.model)) {
    betas.push('server-side-fallback-2026-07-01');
    body.fallbacks = 'default';
  }
  if (betas.length) headers['anthropic-beta'] = betas.join(',');

  const res = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || `HTTP ${res.status}`;
    if (res.status === 401) throw new AiError(`Claude : authentification refusée (${msg}).`);
    if (res.status === 429) throw new AiError('Claude : limite de débit atteinte, réessaie dans un instant.');
    if (res.status === 529 || res.status >= 500) throw new AiError('Claude est surchargé, réessaie dans un instant.');
    throw new AiError(`Claude : ${msg}`);
  }
  if (data.stop_reason === 'refusal') {
    throw new AiError(`Claude a décliné la requête${data.stop_details?.explanation ? ` : ${data.stop_details.explanation}` : '.'}`);
  }
  const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  if (!text) throw new AiError('Réponse vide de Claude.');
  return text;
}

// --- OpenAI-compatible (OpenRouter + custom) ---------------------------------

async function callOpenAiCompatible({ url, apiKey, model, extraHeaders = {} }, { system, prompt, maxTokens }) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      ...extraHeaders,
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    const msg = data?.error?.message || `HTTP ${res.status}`;
    throw new AiError(`${new URL(url).host} : ${msg}`);
  }
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new AiError('Réponse vide du modèle.');
  return text;
}

// --- OpenRouter OAuth (PKCE) ------------------------------------------------

function b64url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function connectOpenRouter() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const callback = chrome.identity.getRedirectURL('openrouter');
  const authUrl = `https://openrouter.ai/auth?callback_url=${encodeURIComponent(callback)}&code_challenge=${challenge}&code_challenge_method=S256`;
  const redirect = await chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true });
  const code = new URL(redirect).searchParams.get('code');
  if (!code) throw new AiError('Connexion OpenRouter annulée.');
  const res = await fetch('https://openrouter.ai/api/v1/auth/keys', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: 'S256' }),
  });
  const data = await res.json();
  if (!data.key) throw new AiError('OpenRouter n’a pas renvoyé de clé.');
  await saveSettings({ ai: { provider: 'openrouter', openrouter: { apiKey: data.key } } });
  return data.key;
}

export async function listOpenRouterModels({ onlyFree = true } = {}) {
  const res = await fetch('https://openrouter.ai/api/v1/models');
  const { data = [] } = await res.json();
  const isFree = (m) => m.id.endsWith(':free') || (Number(m.pricing?.prompt) === 0 && Number(m.pricing?.completion) === 0);
  return data
    .filter((m) => !onlyFree || isFree(m))
    .map((m) => ({ id: m.id, label: `${m.name}${isFree(m) ? ' — gratuit' : ''}`, context: m.context_length }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

// --- API publique -----------------------------------------------------------

function systemPrompt(brand, extra = '') {
  const lang = { fr: 'français', en: 'anglais', es: 'espagnol', de: 'allemand', it: 'italien', pt: 'portugais' }[brand.language] || brand.language || 'français';
  return [
    'Tu es un expert en croissance Instagram, copywriting et social selling.',
    `Réponds en ${lang}.`,
    brand.niche && `Niche du compte : ${brand.niche}.`,
    brand.audience && `Audience cible : ${brand.audience}.`,
    brand.tone && `Ton de marque : ${brand.tone}.`,
    brand.offer && `Offre / produit : ${brand.offer}.`,
    'Respecte les règles d’Instagram : pas de spam, pas de promesses trompeuses, pas de fausses statistiques.',
    extra,
  ].filter(Boolean).join('\n');
}

/**
 * @param {{prompt: string, system?: string, effort?: 'low'|'medium'|'high', maxTokens?: number, json?: boolean}} opts
 */
export async function complete({ prompt, system = '', effort = 'medium', maxTokens = 4000, json = false }) {
  const s = await getSettings();
  const sys = systemPrompt(s.brand, system + (json ? '\nRéponds UNIQUEMENT avec du JSON valide, sans texte autour.' : ''));
  const req = { system: sys, prompt, effort, maxTokens };
  let text;
  switch (s.ai.provider) {
    case 'anthropic':
      text = await callAnthropic(s.ai.anthropic, req);
      break;
    case 'openrouter': {
      const o = s.ai.openrouter;
      if (!o.apiKey) throw new AiError('Connecte OpenRouter (Réglages → IA).');
      text = await callOpenAiCompatible({
        url: 'https://openrouter.ai/api/v1/chat/completions',
        apiKey: o.apiKey,
        model: o.model || 'openrouter/auto',
        extraHeaders: { 'HTTP-Referer': 'https://github.com/instagrowth-extension', 'X-Title': 'InstaGrowth' },
      }, req);
      break;
    }
    case 'custom': {
      const c = s.ai.custom;
      text = await callOpenAiCompatible({ url: c.baseUrl.replace(/\/$/, '') + '/chat/completions', apiKey: c.apiKey, model: c.model }, req);
      break;
    }
    default:
      throw new AiError('Aucun fournisseur IA configuré.');
  }
  return json ? parseJsonLoose(text) : text;
}

export async function testConnection() {
  const t = await complete({ prompt: 'Réponds simplement « OK » si tu me reçois.', effort: 'low', maxTokens: 300 });
  return t.slice(0, 120);
}
