// Vue Réglages : fournisseur IA (Claude, OpenRouter, custom), profil de marque,
// mode de publication, données.

import { busy, toast, send, $, $$ } from '../ui.js';
import { getSettings, saveSettings } from '../../lib/store.js';
import { CLAUDE_MODELS, connectOpenRouter, listOpenRouterModels, testConnection } from '../../lib/ai.js';
import { db } from '../../lib/db.js';
import { downloadText, escapeHtml } from '../../lib/util.js';

let el;
let s;

const PROVIDERS = {
  anthropic: { name: 'Claude (Anthropic)', desc: 'Meilleure qualité de rédaction. Connexion en 2 clics.' },
  openrouter: { name: 'OpenRouter', desc: 'Connexion OAuth en 1 clic, modèles gratuits disponibles.' },
  custom: { name: 'Compatible OpenAI', desc: 'Ollama / LM Studio en local, Groq, Mistral…' },
};

function renderProvider() {
  $$('.provider-card', el).forEach((c) => c.classList.toggle('active', c.dataset.p === s.ai.provider));
  $$('.prov', el).forEach((p) => { p.hidden = p.dataset.p !== s.ai.provider; });
  const a = s.ai.anthropic;
  const connected = a.authType === 'apiKey' ? a.apiKey : a.oauthToken;
  $('#an-state', el).innerHTML = connected
    ? `<div class="claude-state on"><span class="claude-avatar"><i data-i="sparkle" data-s="20"></i></span>
        <div><strong>Claude est connecté</strong><small>${a.authType === 'apiKey' ? `Clé ${escapeHtml(a.apiKey.slice(0, 14))}…${escapeHtml(a.apiKey.slice(-4))}` : 'Jeton OAuth'}</small></div>
        <span class="spacer"></span><button class="sm" id="an-disconnect">Déconnecter</button></div>`
    : `<div class="claude-state"><span class="claude-avatar"><i data-i="sparkle" data-s="20"></i></span>
        <div><strong>Connecte ton compte Claude</strong><small>La console Claude s’ouvre : crée une clé, InstaGrowth la récupère en un clic.</small></div>
        <span class="spacer"></span><button class="primary" id="an-connect">Se connecter avec Claude</button></div>`;
  $('#an-connect', el)?.addEventListener('click', (e) => busy(e.currentTarget, () => send('claude:startConnect')));
  $('#an-disconnect', el)?.addEventListener('click', async () => {
    s = await saveSettings({ ai: { anthropic: { apiKey: '', oauthToken: '' } } });
    renderProvider();
    toast('Claude déconnecté');
  });
  $('#an-auth', el).value = a.authType;
  $('#an-key', el).value = a.apiKey;
  $('#an-token', el).value = a.oauthToken;
  $('#an-model', el).value = a.model;
  $('#an-token-row', el).hidden = a.authType !== 'oauth';
  $('#or-key', el).value = s.ai.openrouter.apiKey;
  $('#or-free', el).checked = s.ai.openrouter.onlyFree;
  $('#or-status', el).innerHTML = s.ai.openrouter.apiKey ? '<span class="ok-text">Connecté</span>' : '<span class="muted">Non connecté</span>';
  $('#cu-url', el).value = s.ai.custom.baseUrl;
  $('#cu-key', el).value = s.ai.custom.apiKey;
  $('#cu-model', el).value = s.ai.custom.model;
}

async function loadOrModels() {
  const sel = $('#or-model', el);
  sel.innerHTML = '<option>Chargement…</option>';
  try {
    const models = await listOpenRouterModels({ onlyFree: $('#or-free', el).checked });
    sel.innerHTML = `<option value="openrouter/auto">Auto (OpenRouter choisit)</option>` +
      models.map((m) => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.label)}</option>`).join('');
    sel.value = s.ai.openrouter.model || (models[0]?.id ?? 'openrouter/auto');
  } catch (e) {
    sel.innerHTML = `<option value="${escapeHtml(s.ai.openrouter.model)}">${escapeHtml(s.ai.openrouter.model || 'openrouter/auto')}</option>`;
    toast('Liste des modèles OpenRouter indisponible : ' + e.message, 'err');
  }
}

function readAi() {
  return {
    provider: s.ai.provider,
    anthropic: { authType: $('#an-auth', el).value, apiKey: $('#an-key', el).value.trim(), oauthToken: $('#an-token', el).value.trim(), model: $('#an-model', el).value },
    openrouter: { apiKey: $('#or-key', el).value.trim(), model: $('#or-model', el).value, onlyFree: $('#or-free', el).checked },
    custom: { baseUrl: $('#cu-url', el).value.trim(), apiKey: $('#cu-key', el).value.trim(), model: $('#cu-model', el).value.trim() },
  };
}

async function saveAi() {
  const ai = readAi();
  if (ai.provider === 'custom' && ai.custom.baseUrl) {
    const origin = new URL(ai.custom.baseUrl).origin + '/*';
    const ok = await chrome.permissions.request({ origins: [origin] });
    if (!ok) throw new Error(`Autorisation refusée pour ${origin}`);
  }
  s = await saveSettings({ ai });
  toast('Réglages IA enregistrés');
}

export default {
  async mount(root) {
    el = root;
    s = await getSettings();
    el.innerHTML = `
      <div class="view-head"><div><h1>Réglages &amp; IA</h1><p class="muted">Connecte ton IA, décris ta marque, choisis ton mode de publication.</p></div></div>

      <div class="card" style="margin-bottom:16px">
        <h2 class="h-ico"><i data-i="sparkle"></i> Fournisseur d’IA</h2>
        <div class="provider-cards">${Object.entries(PROVIDERS).map(([k, p]) => `
          <div class="provider-card" data-p="${k}"><strong>${p.name}</strong><small>${p.desc}</small></div>`).join('')}</div>

        <div class="prov" data-p="anthropic">
          <div id="an-state" style="margin-bottom:16px"></div>
          <div class="grid g2">
            <div class="field" id="an-key-row"><label>…ou colle ta clé Claude (sk-ant-…)</label>
              <div class="row" style="flex-wrap:nowrap">
                <input type="password" id="an-key" placeholder="sk-ant-…" autocomplete="off" spellcheck="false">
                <button class="primary" id="an-key-save">Vérifier et enregistrer</button>
              </div>
              <small>Clé API (sk-ant-api…) ou jeton OAuth : le type est détecté automatiquement. Clés sur <a href="https://platform.claude.com/settings/keys" target="_blank">platform.claude.com/settings/keys</a>. Stockée uniquement dans ton navigateur.</small></div>
            <div class="field"><label>Modèle</label>
              <select id="an-model">${CLAUDE_MODELS.map((m) => `<option value="${m.id}">${m.label}</option>`).join('')}</select></div>
          </div>
          <details class="adv">
            <summary>Options avancées : jeton OAuth</summary>
            <div class="field" style="margin-top:12px;max-width:420px"><label>Authentification</label>
              <select id="an-auth"><option value="apiKey">Clé API</option><option value="oauth">Jeton OAuth (Bearer)</option></select></div>
            <div class="field" id="an-token-row"><label>Jeton OAuth</label><input type="password" id="an-token" placeholder="jeton d’accès OAuth" autocomplete="off">
              <small>Jeton court généré avec la CLI <code>ant</code> : <code>ant auth login</code> puis <code>ant auth print-credentials --access-token</code> (il expire, à renouveler).</small></div>
          </details>
        </div>

        <div class="prov" data-p="openrouter">
          <div class="row" style="margin-bottom:12px">
            <button class="primary" id="or-connect"><i data-i="lock" data-s="16"></i> Se connecter avec OpenRouter (OAuth)</button>
            <span id="or-status"></span>
          </div>
          <div class="grid g2">
            <div class="field"><label>Modèle</label><select id="or-model"></select>
              <label class="check" style="margin-top:6px"><input type="checkbox" id="or-free"> Uniquement les modèles gratuits</label></div>
            <div class="field"><label>…ou colle une clé API</label><input type="password" id="or-key" placeholder="sk-or-…" autocomplete="off">
              <small>Les modèles « :free » d’OpenRouter ont des limites de débit quotidiennes.</small></div>
          </div>
        </div>

        <div class="prov" data-p="custom">
          <div class="grid g3">
            <div class="field"><label>URL de base (OpenAI-compatible)</label><input type="url" id="cu-url" placeholder="http://localhost:11434/v1"></div>
            <div class="field"><label>Clé API (optionnelle)</label><input type="password" id="cu-key" autocomplete="off"></div>
            <div class="field"><label>Modèle</label><input type="text" id="cu-model" placeholder="llama3.1"></div>
          </div>
          <small class="muted">Ollama : lance <code>OLLAMA_ORIGINS=chrome-extension://* ollama serve</code> pour autoriser l’extension.</small>
        </div>

        <div class="row" style="margin-top:14px">
          <button class="primary" id="ai-save">Enregistrer</button>
          <button id="ai-test">Tester la connexion</button>
          <span id="ai-test-out" class="muted"></span>
        </div>
      </div>

      <div class="grid g2" style="margin-bottom:16px">
        <div class="card">
          <h2 class="h-ico"><i data-i="palette"></i> Profil de marque</h2>
          <p class="muted">Utilisé par l’IA pour toutes les légendes, DM, scoring de leads et revues.</p>
          <div class="field"><label>Niche / activité</label><input type="text" id="b-niche" placeholder="Coach sportive pour femmes actives"></div>
          <div class="field"><label>Audience cible</label><input type="text" id="b-audience" placeholder="Femmes 25-40 ans, CSP+, peu de temps"></div>
          <div class="field"><label>Offre / produit</label><input type="text" id="b-offer" placeholder="Programme en ligne 12 semaines"></div>
          <div class="field"><label>Ton</label><input type="text" id="b-tone"></div>
          <div class="field"><label>Langue</label><select id="b-language">
            <option value="fr">Français</option><option value="en">English</option><option value="es">Español</option><option value="de">Deutsch</option><option value="it">Italiano</option><option value="pt">Português</option></select></div>
          <button class="primary" id="b-save">Enregistrer</button>
        </div>

        <div class="stack">
          <div class="card">
            <h2 class="h-ico"><i data-i="calendar"></i> Publication programmée</h2>
            <label class="check"><input type="radio" name="pmode" value="reminder"> <span><strong>Rappel</strong> — notification à l’heure prévue, tu publies en 2 clics (le plus sûr).</span></label>
            <label class="check"><input type="radio" name="pmode" value="auto"> <span><strong>Publication automatique</strong> — photos et carrousels publiés via l’API web d’Instagram (non officielle, expérimental). Le navigateur doit être ouvert.</span></label>
          </div>
          <div class="card">
            <h2 class="h-ico"><i data-i="database"></i> Données</h2>
            <p class="muted">Tout est stocké localement dans ton navigateur. Rien n’est envoyé ailleurs qu’à Instagram et au fournisseur d’IA choisi.</p>
            <div class="row">
              <button id="d-export">Exporter (JSON)</button>
              <button class="danger" id="d-reset">Tout réinitialiser</button>
            </div>
          </div>
        </div>
      </div>`;

    renderProvider();
    loadOrModels();
    // La connexion se termine dans l'onglet de la console Claude : on rafraîchit quand la clé arrive.
    chrome.storage.onChanged.addListener(async (c) => {
      if (!c.settings) return;
      const before = s.ai.anthropic.apiKey;
      s = await getSettings();
      if (s.ai.anthropic.apiKey !== before) { renderProvider(); if (s.ai.anthropic.apiKey) toast('Claude est connecté'); }
    });
    const b = s.brand;
    for (const k of ['niche', 'audience', 'offer', 'tone', 'language']) $(`#b-${k}`, el).value = b[k] || '';
    $$('input[name=pmode]', el).forEach((r) => { r.checked = r.value === s.publish.mode; });

    $$('.provider-card', el).forEach((c) => c.onclick = () => { s.ai = { ...readAi(), provider: c.dataset.p }; renderProvider(); });
    $('#an-auth', el).onchange = () => { s.ai = readAi(); renderProvider(); };
    $('#an-key-save', el).onclick = (e) => busy(e.currentTarget, async () => {
      const key = $('#an-key', el).value.trim();
      if (!key) throw new Error('Colle d’abord ta clé Claude.');
      // Même chemin que la connexion en un clic : vérification auprès d'Anthropic puis enregistrement.
      await send('claude:connect', { key });
      s = await getSettings();
      renderProvider();
      $('#an-key', el).value = '';
      toast('Clé vérifiée : Claude est connecté');
    });
    $('#or-free', el).onchange = loadOrModels;
    $('#or-connect', el).onclick = (e) => busy(e.currentTarget, async () => {
      await connectOpenRouter();
      s = await getSettings();
      renderProvider();
      await loadOrModels();
      toast('OpenRouter connecté');
    });
    $('#ai-save', el).onclick = (e) => busy(e.currentTarget, saveAi);
    $('#ai-test', el).onclick = (e) => busy(e.currentTarget, async () => {
      await saveAi();
      $('#ai-test-out', el).textContent = '…';
      try { $('#ai-test-out', el).textContent = await testConnection(); } catch (err) { $('#ai-test-out', el).textContent = 'Erreur : ' + err.message; }
    });
    $('#b-save', el).onclick = async () => {
      s = await saveSettings({ brand: Object.fromEntries(['niche', 'audience', 'offer', 'tone', 'language'].map((k) => [k, $(`#b-${k}`, el).value.trim()])) });
      toast('Profil de marque enregistré');
    };
    $$('input[name=pmode]', el).forEach((r) => r.onchange = async () => {
      s = await saveSettings({ publish: { mode: r.value } });
      toast(r.value === 'auto' ? 'Publication automatique activée (expérimental)' : 'Mode rappel activé');
    });
    $('#d-export', el).onclick = async () => {
      const all = await chrome.storage.local.get(null);
      const settings = structuredClone(all.settings || {});
      if (settings.ai) { settings.ai.anthropic.apiKey = settings.ai.anthropic.oauthToken = ''; settings.ai.openrouter.apiKey = settings.ai.custom.apiKey = ''; }
      const posts = (await db.all('posts')).map(({ media, ...p }) => ({ ...p, mediaCount: media.length }));
      downloadText(`instagrowth-export-${new Date().toISOString().slice(0, 10)}.json`,
        JSON.stringify({ settings, snapshots: all.snapshots, leads: await db.all('leads'), posts }, null, 2), 'application/json');
    };
    $('#d-reset', el).onclick = async () => {
      if (!confirm('Supprimer TOUTES les données (réglages, leads, posts, historique) ?')) return;
      await chrome.storage.local.clear();
      await db.clear('leads');
      await db.clear('posts');
      await chrome.alarms.clearAll();
      chrome.runtime.reload();
    };
  },
};
