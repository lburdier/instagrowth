import { getSettings, saveSettings } from '../lib/store.js';
import { db } from '../lib/db.js';
import { dayKey, escapeHtml, fmtNum, fmtDate } from '../lib/util.js';
import { effectiveDailyLimit } from '../lib/limits.js';
import { autoHydrate } from '../lib/icons.js';

autoHydrate(document.body);

const $ = (s) => document.querySelector(s);

document.body.addEventListener('click', (e) => {
  const hash = e.target.closest('[data-hash]')?.dataset.hash;
  if (hash) chrome.runtime.sendMessage({ type: 'app:open', hash }).then(() => window.close());
});

async function render() {
  const { me, autolike: st = {} } = await chrome.storage.local.get(['me', 'autolike']);
  const res = await chrome.runtime.sendMessage({ type: 'ig:session' });
  const session = res?.data || {};
  $('#acc').innerHTML = session.loggedIn && me
    ? `<div class="row"><div class="avatar" style="background-image:url('${escapeHtml(me.pic)}')"></div><div><strong>@${escapeHtml(me.username)}</strong><br><small>${fmtNum(me.followers)} abonnés · ${fmtNum(me.posts)} posts</small></div></div>`
    : session.loggedIn ? '<span class="muted">Connecté — ouvre le dashboard pour charger le profil.</span>'
      : '<span>Non connecté. <a href="https://www.instagram.com/accounts/login/" target="_blank">Se connecter à Instagram</a></span>';

  const s = await getSettings();
  $('#al').checked = s.autolike.enabled;
  const today = dayKey();
  const likes = st.day === today ? st.likesToday || 0 : 0;
  const limit = effectiveDailyLimit(s.autolike, st.firstRunDay || today, today);
  $('#al-info').textContent = s.autolike.enabled
    ? `${likes} / ${limit} likes aujourd’hui · ${st.status || 'démarrage…'}`
    : 'Désactivé';

  const posts = (await db.all('posts')).filter((p) => p.status === 'scheduled' || p.status === 'due').sort((a, b) => a.scheduledAt - b.scheduledAt);
  const p = posts[0];
  $('#next-post').innerHTML = p
    ? `<strong class="row" style="gap:6px"><i data-i="clock"></i> Prochain post</strong><br><small>${fmtDate(p.scheduledAt)} — ${escapeHtml(p.caption.slice(0, 70) || 'Sans légende')}</small>`
    : '<strong class="row" style="gap:6px"><i data-i=\"clock\"></i> Aucun post programmé</strong>';
}

$('#al').onchange = async (e) => {
  const s = await getSettings();
  if (e.target.checked && !s.autolike.hashtags.length && !s.autolike.competitors.length) {
    e.target.checked = false;
    chrome.runtime.sendMessage({ type: 'app:open', hash: 'autolike' });
    return;
  }
  await saveSettings({ autolike: { enabled: e.target.checked } });
  render();
};

render();
