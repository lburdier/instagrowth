// Chef d'orchestre : appareil (USB ou simulé), limites, bot, agent Claude,
// aperçu de l'écran et arrêt immédiat. Utilisé par Electron et par les tests.

import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { AdbClient, findAdb, findScrcpy } from './adb.js';
import { SimDevice } from './sim.js';
import { LimitGuard, LIMITS } from './limits.js';
import { Bot } from './bot.js';
import { Agent } from './agent.js';
import { StoppedError } from './control.js';

export class Engine extends EventEmitter {
  /**
   * @param {object} o
   * @param {import('./store.js').Store} o.store
   * @param {(svg:string,w:number,h:number)=>Promise<Buffer>} [o.rasterize] rendu du simulateur
   * @param {(png:Buffer, width:number, quality?:number)=>Promise<{data:Buffer, mediaType:string, width:number}>} [o.resize]
   */
  constructor({ store, rasterize = null, resize = null }) {
    super();
    this.store = store;
    this.rasterize = rasterize;
    this.resize = resize || (async (png) => ({ data: png, mediaType: 'image/png', width: pngWidth(png) }));
    this.controller = new AbortController();
    this.task = null;
    this.devices = [];
    this.device = null;
    this.info = null;
    this.adb = null;
    this.adbError = '';
    this.live = false;
    this.lastFrame = null;
    this.stream = null;
    this.streamFailed = '';
    this.guards = {
      usb: new LimitGuard(() => this.store.settings.limits, store.openState('state')),
      sim: new LimitGuard(() => this.store.settings.limits, store.openState('state-sim')),
    };
    // Contexte partagé ; `guard` suit l'appareil courant (compteurs séparés pour le simulateur).
    const makeCtx = (extra = {}) => Object.defineProperty({
      getDevice: () => this.device,
      log: (l, m, d) => this.log(l, m, d),
      signal: () => this.controller.signal,
      frame: () => this.requestFrame(),
      event: (e) => this.emit('event', e),
      adbKeyboard: () => !!this.info?.adbKeyboard,
      simSpeed: 0.02,
      ...extra,
    }, 'guard', { get: () => this.guard });
    this.bot = new Bot(makeCtx());
    this.agent = new Agent(makeCtx({
      bot: this.bot,
      settings: () => this.store.settings.ai,
      prepareImage: (png) => this.resize(png, 720, 80),
    }));
  }

  get guard() {
    return this.device?.kind === 'sim' ? this.guards.sim : this.guards.usb;
  }

  log(level, msg, data) {
    this.emit('event', { type: 'log', level, msg, data, t: Date.now() });
  }

  // --- Appareils ------------------------------------------------------------

  async refresh() {
    const s = this.store.settings;
    const path = findAdb(s.adbPath);
    this.adb = path ? new AdbClient(path) : null;
    this.adbError = path ? '' : 'adb.exe introuvable';
    this.adbVersion = '';
    this.devices = [];
    if (this.adb) {
      try {
        this.adbVersion = await this.adb.version();
        this.devices = await this.adb.devices();
      } catch (e) {
        this.adbError = `adb ne répond pas : ${e.message}`;
      }
    }
    if (s.sim.enabled) {
      if (this.device?.kind !== 'sim') {
        this.device = new SimDevice({ blockAfter: Number(s.sim.blockAfter) || 0, missRate: Number(s.sim.missRate) || 0 });
        this.device.rasterize = this.rasterize;
      }
    } else {
      const ready = this.devices.filter((d) => d.state === 'device');
      const pick = ready.find((d) => d.serial === s.serial) || ready[0];
      if (!pick) this.device = null;
      else if (this.device?.serial !== pick.serial || this.device.kind !== 'usb') this.device = this.adb.device(pick.serial);
    }
    if (this._lastDevice && this._lastDevice !== this.device) this._lastDevice.closeFast?.();
    const changed = this._lastDevice !== this.device;
    this._lastDevice = this.device;
    this.info = null;
    if (this.device) {
      try {
        this.info = await this.device.info();
      } catch (e) {
        this.log('warn', `Infos de l’appareil indisponibles : ${e.message}`);
      }
    }
    this.emitState();
    if (changed && this.live) this.setLive(true);
    else this.requestFrame();
    return this.snapshot();
  }

  /** Suivi instantané des branchements (adb track-devices), en plus d'une vérification lente. */
  watchDevices() {
    if (!this.adb || this._watched === this.adb.path) return;
    this.unwatch?.();
    this._watched = this.adb.path;
    this.unwatch = this.adb.trackDevices(() => {
      clearTimeout(this._trackT);
      this._trackT = setTimeout(() => this.pollDevices().catch(() => {}), 200);
    });
  }

  /** Relance refresh() seulement si la liste des téléphones a changé. */
  async pollDevices() {
    if (!this.adb) return this.refresh();
    let list;
    try { list = await this.adb.devices(); } catch { return null; }
    const now = Date.now();
    // Câble qui a sauté, veille USB : un téléphone « hors ligne » se répare souvent tout seul.
    if (list.some((d) => d.state === 'offline') && now - (this._reconnectAt || 0) > 10000) {
      this._reconnectAt = now;
      this.adb.reconnectOffline();
    }
    // Autorisation acceptée sur le téléphone mais restée « non autorisé » côté PC :
    // une nouvelle poignée de main suffit (vu sur un Samsung A16).
    this._unauthSince ||= {};
    for (const d of list) {
      if (d.state !== 'unauthorized') { delete this._unauthSince[d.serial]; continue; }
      const since = (this._unauthSince[d.serial] ||= { at: now, retry: 0 });
      if (now - since.at > 8000 && now - since.retry > 20000) {
        since.retry = now;
        this.adb.reconnectDevice(d.serial);
      }
    }
    // Wi-Fi mémorisé : reconnexion silencieuse quand le téléphone revient sur le réseau.
    const wifi = this.store.settings.wifi || {};
    if (wifi.auto && wifi.host && !list.some((d) => d.serial === wifi.host && d.state === 'device') && now - (this._wifiAt || 0) > 15000) {
      this._wifiAt = now;
      this.adb.connect(wifi.host).catch(() => {});
    }
    const sig = (l) => l.map((d) => `${d.serial}:${d.state}`).sort().join('|');
    if (sig(list) === sig(this.devices)) return null;
    if (this.task) {
      // Pendant une tâche on ne change pas d'appareil, mais on s'arrête net si le téléphone disparaît.
      const serial = this.device?.kind === 'usb' ? this.device.serial : '';
      if (serial && !list.some((d) => d.serial === serial && d.state === 'device')) {
        this.log('error', 'Téléphone déconnecté pendant la tâche : arrêt. Rebranche-le, puis relance.');
        this.stop();
      }
      return null;
    }
    const before = this.devices.filter((d) => d.state === 'device').length;
    await this.refresh();
    const after = this.devices.filter((d) => d.state === 'device').length;
    if (after > before) this.log('ok', 'Téléphone connecté.');
    if (after < before) this.log('warn', 'Téléphone déconnecté.');
    return null;
  }

  // --- Wi-Fi (débogage par le réseau local) ------------------------------------

  /** Le téléphone branché en USB passe aussi en Wi-Fi : le câble devient facultatif. */
  async enableWifi() {
    const d = this.device;
    if (!d || d.kind !== 'usb' || d.serial.includes(':')) throw new Error('Branche d’abord le téléphone en USB.');
    const ip = await d.wifiIp();
    if (!ip) throw new Error('Le téléphone n’est connecté à aucun réseau Wi-Fi.');
    await d.tcpip(5555);
    const host = `${ip}:5555`;
    let last = null;
    for (let i = 0; i < 6; i++) {
      await new Promise((r) => setTimeout(r, 1200));
      try { await this.adb.connect(host); last = null; break; } catch (e) { last = e; }
    }
    if (last) throw new Error(`Connexion Wi-Fi impossible (${last.message}). Le PC et le téléphone doivent être sur le même réseau.`);
    this.store.saveSettings({ wifi: { host, auto: true } });
    this.log('ok', `Wi-Fi activé (${host}) : tu peux débrancher le câble.`);
    await this.refresh();
    return { host };
  }

  async connectWifi(host) {
    const h = String(host || '').trim();
    if (!/^[\w.-]+(:\d+)?$/.test(h)) throw new Error('Adresse invalide (exemple : 192.168.1.20:5555).');
    if (!this.adb) throw new Error('adb.exe introuvable.');
    const full = h.includes(':') ? h : `${h}:5555`;
    await this.adb.connect(full);
    this.store.saveSettings({ wifi: { host: full, auto: true } });
    this.log('ok', `Connecté en Wi-Fi à ${full}.`);
    await this.refresh();
    return { host: full };
  }

  async forgetWifi() {
    const host = this.store.settings.wifi?.host;
    this.store.saveSettings({ wifi: { host: '', auto: false } });
    if (host) await this.adb?.disconnect(host);
    this.log('info', 'Connexion Wi-Fi oubliée.');
    return this.refresh();
  }

  selectDevice(serial) {
    this.store.saveSettings({ serial, sim: { enabled: false } });
    this.device = null;
    return this.refresh();
  }

  setSim(enabled, opts = {}) {
    this.store.saveSettings({ sim: { enabled: !!enabled, ...opts } });
    if (!enabled || opts.blockAfter !== undefined || opts.missRate !== undefined) this.device = null;
    return this.refresh();
  }

  snapshot() {
    return {
      adbPath: this.adb?.path || '',
      adbVersion: this.adbVersion || '',
      adbError: this.adbError,
      scrcpy: findScrcpy(this.store.settings.scrcpyPath) || '',
      devices: this.devices,
      device: this.device ? { serial: this.device.serial, kind: this.device.kind } : null,
      info: this.info,
      sim: this.store.settings.sim,
      task: this.task,
      limits: this.guard.status(),
      hard: LIMITS,
      pendingDm: this.bot.pendingDm,
      recentLikes: this.guard.st.likes.slice(-60).reverse(),
      settings: this.store.publicSettings(),
    };
  }

  emitState() {
    this.emit('event', { type: 'state', state: this.snapshot() });
  }

  // --- Aperçu de l'écran ------------------------------------------------------
  // Vrai téléphone : flux vidéo H.264, fluide. Simulateur, ou si la vidéo échoue :
  // captures d'écran régulières.

  requestFrame() {
    if (this.stream) return; // la vidéo montre déjà chaque changement
    clearTimeout(this._frameT);
    this._frameT = setTimeout(() => this.captureFrame(), 250);
  }

  async captureFrame() {
    if (!this.device || this._capturing) return;
    this._capturing = true;
    try {
      const png = await this.device.screencap();
      const img = await this.resize(png, 432, 72);
      this.lastFrame = { dataUrl: `data:${img.mediaType};base64,${img.data.toString('base64')}`, width: this.info?.width || 1080, height: this.info?.height || 2400, t: Date.now() };
      this.emit('event', { type: 'frame', frame: this.lastFrame });
    } catch (e) {
      this.emit('event', { type: 'frame-error', msg: e.message });
    } finally {
      this._capturing = false;
    }
  }

  setLive(on) {
    this.live = !!on;
    clearInterval(this._liveT);
    this.stopStream();
    if (!this.live || !this.device) return;
    const d = this.device;
    if (d.kind === 'usb' && this.streamFailed !== d.serial) {
      this.startStream(d).catch((e) => this.streamFallback(d, e));
      return;
    }
    this._liveT = setInterval(() => this.captureFrame(), d.kind === 'sim' ? 700 : 1200);
    this.captureFrame();
  }

  async startStream(d) {
    const st = await d.screenStream();
    if (this.device !== d || !this.live || this.stream) return;
    this.stream = st;
    st.on('video', (v) => this.emit('event', { type: 'video', ...v }));
    st.on('error', (e) => this.streamFallback(d, e));
    st.start();
    this.emit('event', { type: 'stream', on: true, width: st.width, height: st.height });
  }

  /** La vidéo ne marche pas sur ce téléphone : on repasse aux captures, sans bloquer le reste. */
  streamFallback(d, e) {
    if (this.device !== d) return;
    this.streamFailed = d.serial;
    this.log('warn', `Vidéo en direct indisponible (${e.message}) : aperçu image par image.`);
    this.setLive(this.live);
  }

  stopStream() {
    if (!this.stream) return;
    this.stream.removeAllListeners();
    this.stream.stop();
    this.stream = null;
    this.emit('event', { type: 'stream', on: false });
  }

  /** Nouvelle image clé : interface rechargée ou décodeur à réinitialiser. */
  restartStream() {
    if (this.stream) this.setLive(true);
  }

  // --- Contrôle manuel (gestes sur l'écran de l'app) --------------------------

  async manual(action, a = {}) {
    const d = this.device;
    if (!d) throw new Error('Aucun appareil.');
    const gesture = ['tap', 'longpress', 'swipe', 'key', 'text', 'back', 'home', 'recents'].includes(action);
    if (gesture && this.task) throw new Error(`Une tâche est en cours (${this.task}) : arrête-la avant de toucher l’écran.`);
    const { width, height } = await d.screenSize();
    const X = (v) => Math.round(Math.max(0, Math.min(1, Number(v) || 0)) * (width - 1));
    const Y = (v) => Math.round(Math.max(0, Math.min(1, Number(v) || 0)) * (height - 1));
    const ms = (v, min, max, def) => Math.round(Math.max(min, Math.min(max, Number(v) || def)));
    // Vrai téléphone : commandes par le shell resté ouvert (réactif). Simulateur : appels directs.
    const fast = d.kind === 'usb' ? (cmd) => d.fast(cmd) : null;
    const swipe = (x1, y1, x2, y2, dur) => (fast ? fast(`input swipe ${x1} ${y1} ${x2} ${y2} ${dur}`) : d.swipe(x1, y1, x2, y2, dur));
    const key = (code) => (fast ? fast(`input keyevent ${code}`) : d.key(code));
    switch (action) {
      case 'tap': await (fast ? fast(`input tap ${X(a.x)} ${Y(a.y)}`) : d.tap(X(a.x), Y(a.y))); break;
      case 'longpress': await swipe(X(a.x), Y(a.y), X(a.x), Y(a.y), ms(a.ms, 450, 3000, 700)); break;
      case 'swipe': await swipe(X(a.x1), Y(a.y1), X(a.x2), Y(a.y2), ms(a.ms, 60, 2000, 300)); break;
      case 'key': {
        const code = Number(a.code);
        if (!MANUAL_KEYS.has(code)) throw new Error('Touche non autorisée.');
        await key(code);
        break;
      }
      case 'text': await d.typeText(String(a.text || '').slice(0, 500), { adbKeyboard: !!this.info?.adbKeyboard }); break;
      case 'back': await key(4); break;
      case 'home': await key(3); break;
      case 'recents': await key(187); break;
      case 'wake': await d.wake(); break;
      case 'launch': await d.launchApp(); break;
      default: throw new Error(`Action inconnue : ${action}`);
    }
    this.requestFrame();
  }

  openScrcpy() {
    const exe = findScrcpy(this.store.settings.scrcpyPath);
    if (!exe) throw new Error('scrcpy introuvable.');
    if (!this.device || this.device.kind !== 'usb') throw new Error('Branche un vrai téléphone pour le miroir scrcpy.');
    const p = spawn(exe, ['-s', this.device.serial, '--window-title', 'InstaGrowth — miroir du téléphone', '--stay-awake'], { detached: true, stdio: 'ignore', windowsHide: false });
    p.unref();
  }

  // --- Tâches (une à la fois, toutes interruptibles) -------------------------

  async run(name, fn) {
    if (this.task) throw new Error(`Une tâche est déjà en cours : ${this.task}. Arrête-la d’abord.`);
    if (!this.device) throw new Error('Aucun appareil : branche le téléphone (débogage USB) ou active la simulation.');
    if (this.controller.signal.aborted) this.controller = new AbortController();
    this.task = name;
    this.emitState();
    try {
      return await fn();
    } catch (e) {
      if (e instanceof StoppedError) {
        this.log('warn', 'Arrêt immédiat : tâche interrompue.');
        return { stopped: true };
      }
      this.log('error', e.message);
      throw e;
    } finally {
      this.task = null;
      this.emitState();
      this.requestFrame();
    }
  }

  /** Arrêt immédiat : coupe l'attente, la commande ADB et l'appel IA en cours. */
  stop() {
    this.controller.abort();
    this.controller = new AbortController();
    this.emit('event', { type: 'stopped' });
    if (!this.task) this.log('info', 'Arrêt demandé (aucune tâche en cours).');
  }

  readProfile(u) { return this.run(`Lecture de @${u}`, () => this.bot.readProfile(u)); }
  openProfile(u) { return this.run(`Ouverture de @${u}`, () => this.bot.openProfile(u).then(() => ({ ok: true }))); }
  openHashtag(t) { return this.run(`Ouverture de #${t}`, () => this.bot.openHashtag(t).then(() => ({ ok: true }))); }
  likeSession(o) { return this.run('Session de likes', () => this.bot.likeSession(o)); }
  prepareDm(u, text) { return this.run(`Préparation d’un DM pour @${u}`, () => this.bot.prepareDm(u, text)); }
  sendDm(confirmed) { return this.run('Envoi du DM confirmé', () => this.bot.sendPendingDm({ confirmed })); }
  cancelDm() { this.bot.cancelPendingDm(); this.emitState(); }
  runAgent(goal) { return this.run('Agent Claude', () => this.agent.run(goal)); }

  resumeLimits() {
    this.guard.resume();
    this.log('warn', 'Pause de sécurité levée manuellement.');
    this.emitState();
  }

  saveSettings(patch) {
    this.store.saveSettings(patch);
    this.emitState();
    return this.store.publicSettings();
  }
}

// Touches autorisées au clavier : retour, accueil, flèches, tabulation, entrée, effacer, suppr, applis récentes.
const MANUAL_KEYS = new Set([3, 4, 19, 20, 21, 22, 61, 66, 67, 112, 187]);

function pngWidth(buf) {
  return buf.length > 24 && buf[1] === 0x50 ? buf.readUInt32BE(16) : 1080;
}
