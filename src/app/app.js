// Point d'entrée du dashboard : routage par hash, helpers partagés.

import dashboard from './views/dashboard.js';
import publisher from './views/publisher.js';
import messages from './views/messages.js';
import leads from './views/leads.js';
import autolike from './views/autolike.js';
import mobile from './views/mobile.js';
import settings from './views/settings.js';
import { escapeHtml, fmtNum } from '../lib/util.js';
import { send } from './ui.js';
import { autoHydrate } from '../lib/icons.js';
import { renderUpdateBanner } from '../lib/update.js';

// Mode « embed » : affiché dans la fenêtre InstaGrowth intégrée à instagram.com,
// avec le thème réel d'Instagram (clair/sombre) transmis en paramètre.
const params = new URLSearchParams(location.search);
if (params.get('embed')) document.body.classList.add('embed');
if (params.get('theme')) document.documentElement.dataset.theme = params.get('theme');
autoHydrate(document.body);

const views = { dashboard, publisher, messages, leads, autolike, mobile, settings };
const mounted = new Set();

async function route() {
  const [name, ...rest] = (location.hash.slice(1) || 'dashboard').split('/');
  const key = views[name] ? name : 'dashboard';
  for (const a of document.querySelectorAll('#nav a')) a.classList.toggle('active', a.dataset.view === key);
  for (const v of document.querySelectorAll('.view')) v.classList.toggle('active', v.id === `view-${key}`);
  const el = document.getElementById(`view-${key}`);
  if (!mounted.has(key)) { mounted.add(key); await views[key].mount(el); }
  views[key].show?.(rest);
}

async function loadAccount() {
  const box = document.getElementById('account');
  try {
    const s = await send('ig:session');
    if (!s.loggedIn) throw new Error('offline');
    const cached = (await chrome.storage.local.get('me')).me;
    const me = cached?.pk === s.userId ? cached : await send('ig:me');
    box.innerHTML = `
      <div class="account-pic" style="background-image:url('${escapeHtml(me.pic)}')"></div>
      <div class="account-meta"><strong>@${escapeHtml(me.username)}</strong><small>${fmtNum(me.followers)} abonnés</small></div>`;
  } catch {
    box.innerHTML = `
      <div class="account-pic"></div>
      <div class="account-meta"><strong>Non connecté</strong><small><a href="https://www.instagram.com/accounts/login/" target="_blank">Se connecter à Instagram</a></small></div>`;
  }
}

const banner = document.getElementById('update-banner');
renderUpdateBanner(banner);
chrome.storage.onChanged.addListener((c) => { if (c.updateAvailable) renderUpdateBanner(banner); });

window.addEventListener('hashchange', route);
route();
loadAccount();
