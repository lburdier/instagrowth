// Test de bout en bout sans téléphone : simulateur + faux serveur de l'API Claude.
//   npm run selftest
// Vérifie : lecture de l'arbre UI, limites, likes vérifiés, échecs non comptés,
// blocage détecté, DM jamais envoyés sans confirmation, agent Claude (requêtes
// conformes, historique en ajout seul, taps interdits refusés), arrêt immédiat, ADB réel.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/core/store.js';
import { Engine } from '../src/core/engine.js';
import { SimDevice } from '../src/core/sim.js';
import { parseUiXml, findAll } from '../src/core/uitree.js';
import { SEL } from '../src/core/selectors.js';
import { LimitGuard, effectiveDailyLimit } from '../src/core/limits.js';
import { AdbClient, findAdb, toAscii } from '../src/core/adb.js';
import { parseCount } from '../src/core/bot.js';
import { startMock } from './mock-claude.mjs';

let pass = 0;
let fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ok   ${name}`); } else { fail++; console.log(`  FAIL ${name} ${extra}`); }
}
const section = (s) => console.log(`\n${s}`);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'igg-selftest-'));
const memState = () => ({ state: {}, saveState(p) { this.state = { ...this.state, ...p }; return this.state; } });
const openLimits = { preset: 'actif', dailyLimit: 150, hourlyLimit: 30, minDelaySec: 35, maxDelaySec: 110, warmup: false, activeStart: 0, activeEnd: 24 };

function newEngine(sim = {}) {
  const dir = fs.mkdtempSync(path.join(tmp, 'e-'));
  const store = new Store(dir);
  store.saveSettings({ sim: { enabled: true, blockAfter: 0, missRate: 0, ...sim }, limits: openLimits });
  const engine = new Engine({ store });
  engine.bot.ctx.simSpeed = 0.0005;
  const logs = [];
  const events = [];
  engine.on('event', (e) => { if (e.type === 'log') logs.push(e); else events.push(e); });
  return { engine, store, logs, events };
}

// ---------------------------------------------------------------------------
section('Arbre UI et utilitaires');
{
  const sim = new SimDevice();
  const nodes = parseUiXml(await sim.dumpUi());
  check('analyse du XML uiautomator', nodes.length > 10 && nodes[0].cls.includes('FrameLayout'));
  check('bouton J’aime trouvé par resource-id', findAll(nodes, SEL.likeButton).length >= 1);
  check('nombres Instagram (« 12,8 k », « 1,2 M », « 3 456 »)', parseCount('12,8 k') === 12800 && parseCount('1,2 M') === 1200000 && parseCount('3 456') === 3456 && parseCount('389') === 389);
  check('saisie ASCII sans accents', toAscii('Ça va, Élise ? « top »…') === 'Ca va, Elise ? "top"...');
  const png = await sim.screencap();
  check('capture PNG du simulateur', png.subarray(1, 4).toString() === 'PNG');
}

section('Limites prudentes');
{
  const st = memState();
  const g = new LimitGuard(() => ({ ...openLimits, hourlyLimit: 3 }), st);
  check('like autorisé au départ', g.canLike().ok);
  for (let i = 0; i < 3; i++) g.recordLike({ author: `a${i}` });
  check('plafond horaire appliqué', !g.canLike().ok && /horaire/.test(g.canLike().reason));
  check('montée progressive : 20 likes le 1er jour', effectiveDailyLimit({ dailyLimit: 100, warmup: true }, '2026-10-26', '2026-10-26') === 20);
  check('montée progressive : 40 le 3e jour', effectiveDailyLimit({ dailyLimit: 100, warmup: true }, '2026-10-24', '2026-10-26') === 40);
  const g2 = new LimitGuard(() => openLimits, memState());
  g2.recordFail(); g2.recordFail();
  check('2 échecs : pas encore de pause', !g2.status().paused);
  g2.recordFail();
  check('3 likes non confirmés : pause de sécurité', g2.status().paused);
  const g3 = new LimitGuard(() => ({ ...openLimits, minDelaySec: 1, maxDelaySec: 2 }), memState());
  const d = g3.nextDelayMs();
  check('délai minimum imposé (30 s même si réglé plus bas)', d.ms >= 30000);
  const g4 = new LimitGuard(() => ({ ...openLimits, activeStart: 3, activeEnd: 4 }), memState(), { now: () => new Date('2026-10-26T12:00:00').getTime() });
  check('plage horaire respectée', !g4.canLike().ok && /plage horaire/.test(g4.canLike().reason));
}

section('Bot : likes vérifiés');
{
  const { engine, logs } = newEngine();
  await engine.refresh();
  check('simulateur connecté', engine.device?.kind === 'sim');
  const p = await engine.readProfile('@yoga.marie');
  check('bio lue', p.bio.startsWith('Prof de vinyasa') && p.followers === 25400 && p.fullName === 'Marie — Yoga');
  const r = await engine.likeSession({ targets: ['#yoga', '@cafe.racine'], count: 4 });
  check('4 likes vérifiés', r.liked === 4, JSON.stringify(r));
  check('compteur = likes réellement présents dans l’app', engine.guard.status().today === engine.device.likesRegistered && engine.device.likesRegistered === 4);
  check('aucun like retiré (cœur déjà rouge jamais touché)', [...engine.device.postsById.values()].filter((x) => x.liked).length === 4);
  check('chaque like annoncé « vérifié »', logs.filter((l) => /Like vérifié/.test(l.msg)).length === 4);
}

section('Bot : likes qui ne « prennent » pas');
{
  const { engine } = newEngine({ missRate: 1 });
  await engine.refresh();
  const r = await engine.likeSession({ targets: ['#cafe'], count: 5 });
  check('aucun like compté sans preuve', r.liked === 0 && engine.guard.status().today === 0);
  check('pause après 3 échecs d’affilée', engine.guard.status().paused && /non enregistrés/.test(engine.guard.status().pauseReason));
  const again = await engine.likeSession({ targets: ['#cafe'], count: 1 });
  check('pendant la pause, rien n’est tenté', again.liked === 0 && /Pause de sécurité/.test(again.stoppedBy));
}

section('Bot : « Réessayez plus tard »');
{
  const { engine, events } = newEngine({ blockAfter: 2 });
  await engine.refresh();
  const r = await engine.likeSession({ targets: ['#trail'], count: 6 });
  check('arrêt au blocage après 2 likes', r.liked === 2 && /bloqu/i.test(r.stoppedBy), JSON.stringify(r));
  check('pause de 24 h enregistrée', engine.guard.status().paused && engine.guard.status().pausedUntil - Date.now() > 23 * 3600e3);
  check('événement « blocked » envoyé à l’interface', events.some((e) => e.type === 'blocked'));
}

section('Bot : DM préparés, jamais envoyés sans confirmation');
{
  const { engine } = newEngine();
  await engine.refresh();
  const dm = await engine.prepareDm('trail.alex', 'Salut Alex, ta prépa UTMB a l’air solide !');
  check('message tapé dans la conversation', dm.text.includes('UTMB') && engine.device.threads.get('trail.alex').draft.includes('UTMB'));
  check('rien d’envoyé après la préparation', engine.device.sent.length === 0);
  let refused = false;
  try { await engine.sendDm(false); } catch { refused = true; }
  check('envoi refusé sans confirmation explicite', refused && engine.device.sent.length === 0);
  const sent = await engine.sendDm(true);
  check('envoi après confirmation, bulle vérifiée', sent.sent && sent.verified && engine.device.sent.length === 1);
}

section('Arrêt immédiat');
{
  const { engine } = newEngine();
  await engine.refresh();
  engine.bot.ctx.simSpeed = 0.05; // délais assez longs pour interrompre
  const t0 = Date.now();
  const p = engine.likeSession({ targets: ['#yoga'], count: 10 });
  setTimeout(() => engine.stop(), 400);
  const r = await p;
  check('la session s’arrête tout de suite', r.stopped === true && Date.now() - t0 < 3000, `${Date.now() - t0} ms`);
  check('plus aucune tâche en cours', engine.task === null);
}

section('Mode Claude (faux serveur API)');
{
  const mock = await startMock();
  const { requests } = mock;
  process.env.IGG_ANTHROPIC_BASE_URL = mock.url;

  const { engine, events } = newEngine();
  engine.store.saveSettings({ ai: { provider: 'anthropic', anthropic: { apiKey: 'sk-ant-test-0000', model: 'claude-opus-5-5', effort: 'medium' } } });
  engine.agent.ctx.simSpeed = 0.0005;
  await engine.refresh();
  const out = await engine.runAgent('Like 2 publications récentes de #yoga puis prépare un message pour @atelier.noa.');
  mock.close();

  check('l’agent termine avec un bilan', /2 likes vérifiés/.test(out.summary), JSON.stringify(out));
  check('2 likes réels dans l’app, comptés dans les limites', engine.device.likesRegistered === 2 && engine.guard.status().today === 2);
  const results = events.filter((e) => e.type === 'agent-result');
  check('tap direct sur J’aime refusé', /like_post/.test(results.find((e) => e.step === 3)?.result.error || ''));
  check('tap sur Envoyer refusé', /réservé à l’utilisateur/.test(results.find((e) => e.step === 8)?.result.error || ''));
  check('DM préparé mais non envoyé', engine.device.sent.length === 0 && engine.bot.pendingDm?.username === 'atelier.noa');

  const b0 = requests[0].body;
  const beta = requests[0].headers['anthropic-beta'] || '';
  check('modèle claude-opus-5-5 par défaut', b0.model === 'claude-opus-5-5');
  check('réflexion adaptative + effort', b0.thinking?.type === 'adaptive' && b0.output_config?.effort === 'medium');
  check('repli serveur activé (fallbacks: default)', b0.fallbacks === 'default' && beta.includes('server-side-fallback-2026-07-01'));
  check('nettoyage de contexte côté serveur', beta.includes('context-management-2025-06-27') && b0.context_management?.edits?.[0]?.type === 'clear_tool_uses_20250919');
  check('outils stricts', b0.tools.every((t) => t.strict === true && t.input_schema.additionalProperties === false));
  check('capture envoyée en image', b0.messages[0].content.some((c) => c.type === 'image' && c.source.type === 'base64'));
  const r2 = requests[1].body.messages;
  check('capture dans le tool_result suivant', r2[2].content.some((b) => b.type === 'tool_result' && Array.isArray(b.content) && b.content.some((c) => c.type === 'image')));
  let appendOnly = true;
  for (let i = 1; i < requests.length; i++) {
    const prev = requests[i - 1].body.messages;
    const cur = requests[i].body.messages;
    if (JSON.stringify(cur.slice(0, prev.length)) !== JSON.stringify(prev)) appendOnly = false;
    if (JSON.stringify(requests[i].body.system) !== JSON.stringify(requests[0].body.system) || JSON.stringify(requests[i].body.tools) !== JSON.stringify(requests[0].body.tools)) appendOnly = false;
  }
  check('historique en ajout seul (system, outils et messages inchangés)', appendOnly);
  check('blocs de réflexion renvoyés tels quels', requests[1].body.messages[1].content[0].signature === 'sig1');
}

section('Mode Claude : clé absente');
{
  const { engine } = newEngine();
  await engine.refresh();
  let msg = '';
  try { await engine.runAgent('test'); } catch (e) { msg = e.message; }
  check('message clair sans clé API', /clé API Claude/.test(msg), msg);
}

section('ADB réel');
{
  const adbPath = findAdb();
  if (!adbPath) console.log('  --   adb introuvable : test ignoré');
  else {
    const client = new AdbClient(adbPath);
    const v = await client.version();
    const list = await client.devices();
    check(`adb répond (version ${v})`, !!v);
    console.log(`  --   ${list.length ? list.map((d) => `${d.serial} : ${d.stateLabel}`).join(', ') : 'aucun appareil branché'}`);
    const store = new Store(fs.mkdtempSync(path.join(tmp, 'adb-')));
    const engine = new Engine({ store });
    const snap = await engine.refresh();
    check('état « aucun appareil » ou appareil détecté', list.some((d) => d.state === 'device') ? !!snap.device : snap.device === null);
  }
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} réussis, ${fail} en échec`);
process.exit(fail ? 1 : 0);
