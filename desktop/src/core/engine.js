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
    this.info = null;
    if (this.device) {
      try {
        this.info = await this.device.info();
      } catch (e) {
        this.log('warn', `Infos de l’appareil indisponibles : ${e.message}`);
      }
    }
    this.emitState();
    this.requestFrame();
    return this.snapshot();
  }

  /** Surveillance légère : relance refresh() seulement si la liste des téléphones a changé. */
  async pollDevices() {
    if (this.task || !this.adb) return this.adb ? null : this.refresh();
    let list;
    try { list = await this.adb.devices(); } catch { return null; }
    const sig = (l) => l.map((d) => `${d.serial}:${d.state}`).sort().join('|');
    if (sig(list) !== sig(this.devices)) {
      const before = this.devices.filter((d) => d.state === 'device').length;
      await this.refresh();
      const after = this.devices.filter((d) => d.state === 'device').length;
      if (after > before) this.log('ok', 'Téléphone connecté.');
      if (after < before) this.log('warn', 'Téléphone déconnecté.');
    }
    return null;
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

  requestFrame() {
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
    if (this.live) this._liveT = setInterval(() => this.captureFrame(), this.device?.kind === 'sim' ? 1200 : 1600);
  }

  // --- Contrôle manuel (clics sur l'aperçu) -----------------------------------

  async manual(action, a = {}) {
    if (!this.device) throw new Error('Aucun appareil.');
    const { width, height } = await this.device.screenSize();
    if (action === 'tap') await this.device.tap(a.x * width, a.y * height);
    if (action === 'swipe') await this.device.swipe(a.x1 * width, a.y1 * height, a.x2 * width, a.y2 * height, 400);
    if (action === 'back') await this.device.key(4);
    if (action === 'home') await this.device.key(3);
    if (action === 'wake') await this.device.wake();
    if (action === 'launch') await this.device.launchApp();
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

function pngWidth(buf) {
  return buf.length > 24 && buf[1] === 0x50 ? buf.readUInt32BE(16) : 1080;
}
