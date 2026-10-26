// Processus principal Electron : fenêtre, pont IPC vers le moteur, arrêt
// d'urgence global (Ctrl+Alt+X), rendu du simulateur et connexion OpenRouter.

import { app, BrowserWindow, ipcMain, nativeImage, safeStorage, globalShortcut, shell, Menu, dialog } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Store } from '../core/store.js';
import { Engine } from '../core/engine.js';
import { listOpenRouterVisionModels, testAi } from '../core/agent.js';
import { Updater } from './updater.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..');
const argv = process.argv.slice(1);
const flag = (name) => argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
const flagValue = (name) => (flag(name) || '').split('=')[1] || '';

app.setAppUserModelId('fr.instagrowth.desktop');
if (!app.requestSingleInstanceLock()) app.quit();

let win = null;
let engine = null;
let updater = null;

// --- Images -----------------------------------------------------------------

/** Redimensionne une capture (PNG) : JPEG plus léger pour l'aperçu et pour Claude. */
async function resize(png, width, quality = 80) {
  const img = nativeImage.createFromBuffer(png);
  const size = img.getSize();
  if (!size.width) return { data: png, mediaType: 'image/png', width: 1080 };
  const out = size.width > width ? img.resize({ width, quality: 'good' }) : img;
  return { data: out.toJPEG(quality), mediaType: 'image/jpeg', width: out.getSize().width };
}

// Rendu fidèle du téléphone simulé (SVG → PNG) dans une fenêtre invisible.
let rasterWin = null;
let rasterQueue = Promise.resolve();
function rasterize(svg, w, h) {
  const job = async () => {
    // Windows limite la hauteur d'une fenêtre (même invisible) à celle de l'écran : rendu au tiers.
    const width = Math.round(w / 3);
    const height = Math.round(h / 3);
    if (!rasterWin || rasterWin.isDestroyed()) {
      rasterWin = new BrowserWindow({ show: false, width, height, useContentSize: true, frame: false, webPreferences: { offscreen: true, sandbox: true } });
      rasterWin.webContents.setFrameRate(5);
    }
    const html = `<!doctype html><html><body style="margin:0;background:#000;overflow:hidden">${svg.replace('<svg ', `<svg style="display:block;width:${width}px;height:${height}px" `)}</body></html>`;
    // En rendu hors écran, l'image arrive par l'événement « paint » (capturePage renvoie du noir).
    // On écoute seulement une fois la nouvelle page chargée, pour ne pas récupérer l'ancienne.
    const wc = rasterWin.webContents;
    await rasterWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    const img = await new Promise((resolve) => {
      const t = setTimeout(() => { wc.off('paint', onPaint); resolve(null); }, 3000);
      function onPaint(_e, _dirty, image) {
        if (image.isEmpty()) return;
        clearTimeout(t);
        wc.off('paint', onPaint);
        resolve(image);
      }
      wc.on('paint', onPaint);
      wc.invalidate();
    });
    if (!img) throw new Error('Rendu du simulateur indisponible.');
    return img.toPNG();
  };
  const p = rasterQueue.then(job, job);
  rasterQueue = p.catch(() => {});
  return p;
}

// --- Fenêtre ------------------------------------------------------------------

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1180,
    minHeight: 720,
    backgroundColor: '#000000',
    title: 'InstaGrowth Desktop',
    icon: path.join(ROOT, 'assets', 'icon.png'),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(here, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  Menu.setApplicationMenu(null);
  const view = flagValue('view');
  win.loadFile(path.join(ROOT, 'src', 'renderer', 'index.html'), { query: view ? { view } : {} });
  win.once('ready-to-show', () => (flag('shot') ? win.showInactive() : win.show()));
  // Liens externes : navigateur par défaut, jamais dans la fenêtre de l'app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.on('closed', () => { win = null; });
}

function send(ev) {
  if (win && !win.isDestroyed()) win.webContents.send('igg-event', ev);
}

// --- OpenRouter (connexion OAuth PKCE avec retour sur localhost) ---------------

function connectOpenRouter() {
  return new Promise((resolve, reject) => {
    const verifier = crypto.randomBytes(48).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname !== '/callback') { res.writeHead(404); res.end(); return; }
      const code = url.searchParams.get('code');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<body style="font:16px Segoe UI;background:#000;color:#f5f5f5;display:grid;place-items:center;height:100vh"><p>Connexion OpenRouter terminée. Tu peux revenir dans InstaGrowth Desktop.</p></body>');
      server.close();
      clearTimeout(timer);
      if (!code) return reject(new Error('Connexion OpenRouter annulée.'));
      try {
        const r = await fetch('https://openrouter.ai/api/v1/auth/keys', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: 'S256' }) });
        const data = await r.json();
        if (!data.key) throw new Error('OpenRouter n’a pas renvoyé de clé.');
        resolve(data.key);
      } catch (e) { reject(e); }
    });
    const timer = setTimeout(() => { server.close(); reject(new Error('Délai de connexion OpenRouter dépassé (5 min).')); }, 5 * 60e3);
    server.listen(3000, '127.0.0.1', () => {
      const cb = `http://localhost:${server.address().port}/callback`;
      shell.openExternal(`https://openrouter.ai/auth?callback_url=${encodeURIComponent(cb)}&code_challenge=${challenge}&code_challenge_method=S256`);
    });
    server.on('error', (e) => { clearTimeout(timer); reject(new Error(`Port 3000 occupé : colle plutôt ta clé OpenRouter (${e.code}).`)); });
  });
}

// --- IPC ------------------------------------------------------------------------

const API = {
  state: () => engine.snapshot(),
  refresh: () => engine.refresh(),
  selectDevice: (serial) => engine.selectDevice(serial),
  setSim: (on, opts) => engine.setSim(on, opts),
  setLive: (on) => engine.setLive(on),
  frame: () => engine.captureFrame(),
  manual: (action, a) => engine.manual(action, a),
  openScrcpy: () => engine.openScrcpy(),
  stop: () => engine.stop(),
  readProfile: (u) => engine.readProfile(u),
  openProfile: (u) => engine.openProfile(u),
  openHashtag: (t) => engine.openHashtag(t),
  likeSession: (o) => engine.likeSession(o),
  prepareDm: (u, t) => engine.prepareDm(u, t),
  sendDm: async () => {
    // Deuxième confirmation, native, juste avant l'envoi.
    const dm = engine.bot.pendingDm;
    if (!dm) throw new Error('Aucun message préparé.');
    const { response } = await dialog.showMessageBox(win, {
      type: 'question',
      buttons: ['Envoyer le message', 'Annuler'],
      defaultId: 1,
      cancelId: 1,
      title: 'Confirmer l’envoi',
      message: `Envoyer ce message à @${dm.username} ?`,
      detail: dm.text,
    });
    if (response !== 0) return { sent: false, cancelled: true };
    return engine.sendDm(true);
  },
  cancelDm: () => engine.cancelDm(),
  runAgent: (goal) => engine.runAgent(goal),
  resumeLimits: () => engine.resumeLimits(),
  saveSettings: (patch) => engine.saveSettings(patch),
  testAi: () => testAi(engine.store.settings.ai),
  openRouterModels: () => listOpenRouterVisionModels(),
  connectOpenRouter: async () => {
    const key = await connectOpenRouter();
    engine.saveSettings({ ai: { provider: 'openrouter', openrouter: { apiKey: key } } });
    return engine.store.publicSettings();
  },
  openExternal: (url) => (/^https:\/\//.test(url) ? shell.openExternal(url) : null),
  openDataFolder: () => shell.openPath(app.getPath('userData')),
  dataFolder: () => app.getPath('userData'),
  appVersion: () => app.getVersion(),
  updateState: () => updater.state,
  updateCheck: () => updater.check(),
  updateDownload: () => updater.download(),
  updateInstall: () => updater.install(),
};

ipcMain.handle('igg', async (_e, method, args) => {
  if (!Object.hasOwn(API, method)) throw new Error(`Méthode inconnue : ${method}`);
  return API[method](...(args || []));
});

// --- Démarrage --------------------------------------------------------------------

app.whenReady().then(async () => {
  const vault = safeStorage.isEncryptionAvailable()
    ? { encrypt: (s) => safeStorage.encryptString(s).toString('base64'), decrypt: (s) => safeStorage.decryptString(Buffer.from(s, 'base64')) }
    : null;
  const dataDir = flag('shot') ? fs.mkdtempSync(path.join(app.getPath('temp'), 'igg-shot-')) : app.getPath('userData');
  const store = new Store(dataDir, vault);
  if (flag('sim')) store.saveSettings({ sim: { enabled: true } });
  engine = new Engine({ store, rasterize, resize });
  engine.on('event', send);

  createWindow();
  await engine.refresh().catch((e) => console.error(e));
  engine.setLive(true);
  setInterval(() => engine.pollDevices().catch(() => {}), 4000);

  updater = new Updater({ app, send, log: (l, m) => engine.log(l, m) });
  if (!flag('shot')) updater.start();

  globalShortcut.register('CommandOrControl+Alt+X', () => {
    engine.stop();
    send({ type: 'log', level: 'warn', msg: 'Arrêt d’urgence (Ctrl+Alt+X).', t: Date.now() });
  });

  // Capture de la fenêtre pour vérifier l'interface : --shot=fichier.png [--view=bot] [--demo]
  if (flag('shot')) {
    const out = flagValue('shot') || path.join(app.getPath('temp'), 'instagrowth-shot.png');
    await new Promise((r) => setTimeout(r, 2500));
    if (flagValue('demo') === 'update') {
      // Test du circuit de mise à jour contre un serveur local (IGG_UPDATE_API / IGG_UPDATE_FEED).
      await updater.check();
      if (updater.state.status === 'available') {
        await updater.download().catch((e) => console.error('maj :', e.message));
        for (let i = 0; i < 240 && !['ready', 'error'].includes(updater.state.status); i++) await new Promise((r) => setTimeout(r, 500));
      }
      console.log('maj :', JSON.stringify({ status: updater.state.status, version: updater.state.version, error: updater.state.error }));
      await new Promise((r) => setTimeout(r, 800));
    } else if (flagValue('demo') === 'agent') {
      // Démo de l'agent contre un faux serveur (IGG_ANTHROPIC_BASE_URL), jamais avec une vraie clé.
      if (!process.env.IGG_ANTHROPIC_BASE_URL) throw new Error('--demo=agent demande IGG_ANTHROPIC_BASE_URL (scripts/mock-claude.mjs).');
      engine.saveSettings({ ai: { provider: 'anthropic', anthropic: { apiKey: 'sk-ant-demo-local' } } });
      engine.bot.ctx.simSpeed = 0.002;
      send({ type: 'state', state: engine.snapshot() });
      await engine.runAgent('Like 2 publications récentes de #yoga puis prépare un message pour @atelier.noa.').catch((e) => console.error('démo :', e.message));
      await engine.captureFrame();
      await new Promise((r) => setTimeout(r, 1200));
    } else if (flag('demo')) {
      await engine.readProfile('yoga.marie').catch((e) => console.error('démo :', e.message));
      await engine.prepareDm('atelier.noa', 'Bonjour, vos pièces bleu nuit sont superbes.').catch((e) => console.error('démo :', e.message));
      await engine.captureFrame();
      await new Promise((r) => setTimeout(r, 1200));
    }
    try {
      const img = await win.webContents.capturePage();
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, img.toPNG());
      console.log(`capture : ${out}`);
    } finally {
      app.exit(0);
    }
  }
});

app.on('second-instance', () => {
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
});
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => app.quit());
