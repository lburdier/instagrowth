// Couche ADB : trouve adb.exe, liste les téléphones, et pilote un appareil
// (capture d'écran, arbre UI, tap, glissement, saisie, liens).

import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { IG_PACKAGE } from './selectors.js';
import { sleep, StoppedError } from './control.js';
import { ScreenStream } from './stream.js';

const WIN = process.platform === 'win32';
const EXE = WIN ? 'adb.exe' : 'adb';

function run(file, args, { signal, timeout = 20000, binary = false } = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { signal, timeout, maxBuffer: 64 * 1024 * 1024, encoding: binary ? 'buffer' : 'utf8', windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        if (err.name === 'AbortError' || signal?.aborted) return reject(new StoppedError());
        const msg = String(stderr || err.message || '').trim();
        const e = new Error(msg || `Échec de ${path.basename(file)} ${args.join(' ')}`);
        e.code = err.code;
        return reject(e);
      }
      resolve(stdout);
    });
  });
}

function onPath(exe) {
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    const p = path.join(dir.replace(/"/g, ''), exe);
    if (dir && fs.existsSync(p)) return p;
  }
  return null;
}

/** L'écran n'a pas pu être lu (animation continue : uiautomator n'obtient jamais l'état « au repos »). */
export class UnreadableScreenError extends Error {
  constructor(msg = 'Écran illisible pour l’instant (animation en cours).') {
    super(msg);
    this.name = 'UnreadableScreenError';
  }
}

/** Cherche adb : réglage manuel, PATH, puis emplacements habituels sous Windows. */
export function findAdb(custom) {
  const candidates = [
    custom,
    onPath(EXE),
    process.env.ANDROID_HOME && path.join(process.env.ANDROID_HOME, 'platform-tools', EXE),
    process.env.ANDROID_SDK_ROOT && path.join(process.env.ANDROID_SDK_ROOT, 'platform-tools', EXE),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk', 'platform-tools', EXE),
    path.join(os.homedir(), 'platform-tools', EXE),
    path.join(os.homedir(), 'Downloads', 'platform-tools', EXE),
    path.join(os.homedir(), 'Desktop', 'platform-tools', EXE),
    'C:\\platform-tools\\' + EXE,
    'C:\\Android\\platform-tools\\' + EXE,
    'C:\\Windows\\platform-tools\\' + EXE,
  ].filter(Boolean);
  return candidates.find((p) => fs.existsSync(p)) || null;
}

export function findScrcpy(custom) {
  const exe = WIN ? 'scrcpy.exe' : 'scrcpy';
  const candidates = [custom, onPath(exe), path.join(os.homedir(), 'scrcpy', exe), 'C:\\scrcpy\\' + exe].filter(Boolean);
  return candidates.find((p) => fs.existsSync(p)) || null;
}

const STATE_LABELS = {
  device: 'Connecté',
  unauthorized: 'En attente d’autorisation sur le téléphone',
  offline: 'Hors ligne',
  'no permissions': 'Permission refusée',
  authorizing: 'Autorisation en cours',
};

export class AdbClient {
  constructor(adbPath) {
    this.path = adbPath;
  }

  async version() {
    const out = await run(this.path, ['version'], { timeout: 8000 });
    return (/version ([\d.]+)/.exec(out) || [])[1] || out.split('\n')[0];
  }

  /** @returns {Promise<{serial:string,state:string,stateLabel:string,model:string,usb:boolean}[]>} */
  async devices() {
    const out = await run(this.path, ['devices', '-l'], { timeout: 10000 });
    return out.split(/\r?\n/).slice(1).map((l) => l.trim()).filter(Boolean).map((l) => {
      const [serial, state, ...rest] = l.split(/\s+/);
      const props = Object.fromEntries(rest.map((kv) => kv.split(':')).filter((a) => a.length === 2));
      return {
        serial,
        state,
        stateLabel: STATE_LABELS[state] || state,
        model: (props.model || '').replace(/_/g, ' '),
        usb: !!props.usb || !serial.includes(':'),
      };
    });
  }

  device(serial) {
    return new AdbDevice(this, serial);
  }

  /**
   * Suivi instantané des branchements (`adb track-devices`) : `onChange` est appelé
   * dès qu'un téléphone apparaît, disparaît ou change d'état. Relance automatique.
   * @returns {() => void} arrêt du suivi
   */
  trackDevices(onChange) {
    let proc = null;
    let stopped = false;
    let timer = null;
    const startIt = () => {
      if (stopped) return;
      let buf = '';
      proc = spawn(this.path, ['track-devices'], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
      proc.stdout.on('data', (d) => {
        buf += d.toString('utf8');
        // Messages : 4 chiffres hexadécimaux (longueur) puis la liste « série, tabulation, état » par ligne.
        while (buf.length >= 4) {
          const len = parseInt(buf.slice(0, 4), 16);
          if (Number.isNaN(len) || buf.length < 4 + len) break;
          buf = buf.slice(4 + len);
          onChange();
        }
      });
      proc.on('error', () => {});
      proc.on('close', () => {
        proc = null;
        if (!stopped) timer = setTimeout(startIt, 1500);
      });
    };
    startIt();
    return () => {
      stopped = true;
      clearTimeout(timer);
      proc?.kill();
    };
  }

  /** Relance la connexion des téléphones « hors ligne » (câble qui a sauté, veille USB). */
  reconnectOffline() {
    return run(this.path, ['reconnect', 'offline'], { timeout: 8000 }).catch(() => '');
  }

  /**
   * Nouvelle poignée de main USB avec un téléphone. Utile quand l'autorisation a été
   * acceptée sur le téléphone mais que l'état reste « non autorisé » côté PC.
   */
  reconnectDevice(serial) {
    return run(this.path, ['-s', serial, 'reconnect'], { timeout: 8000 }).catch(() => '');
  }

  /** Connexion Wi-Fi (débogage via le réseau local) : « 192.168.1.20:5555 ». */
  async connect(host) {
    const out = await run(this.path, ['connect', host], { timeout: 12000 });
    if (!/connected to|already connected/i.test(out)) throw new Error(out.trim() || `Connexion à ${host} impossible.`);
    return out.trim();
  }

  disconnect(host) {
    return run(this.path, ['disconnect', host], { timeout: 8000 }).catch(() => '');
  }
}

// Caractères que `input text` sait taper (ASCII imprimable).
const ASCII_OK = /^[\x20-\x7e]*$/;

/** Retire accents et caractères que `input text` ne sait pas taper. */
export function toAscii(s) {
  return s
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[’‘]/g, "'").replace(/«[\s  ]*/g, '"').replace(/[\s  ]*»/g, '"').replace(/[“”]/g, '"').replace(/[  ]/g, ' ').replace(/[–—]/g, '-').replace(/…/g, '...')
    .replace(/œ/g, 'oe').replace(/Œ/g, 'OE').replace(/æ/g, 'ae').replace(/ß/g, 'ss')
    .replace(/[^\x20-\x7e]/g, '');
}

const shQuote = (s) => `'${s.replace(/'/g, `'\\''`)}'`;

export class AdbDevice {
  constructor(client, serial) {
    this.client = client;
    this.serial = serial;
    this.kind = 'usb';
    this.size = null;
    this._lock = Promise.resolve();
  }

  _adb(args, opts) {
    return run(this.client.path, ['-s', this.serial, ...args], opts);
  }

  // Une seule commande « lourde » à la fois (capture / arbre UI / saisie), sinon le téléphone rame.
  _serial(fn) {
    const p = this._lock.then(fn, fn);
    this._lock = p.catch(() => {});
    return p;
  }

  shell(cmd, opts) {
    return this._adb(['shell', cmd], opts);
  }

  /**
   * Commande « fire and forget » par un `adb shell` resté ouvert : pas de nouveau
   * processus à chaque geste, donc un contrôle manuel bien plus réactif.
   */
  fast(cmd) {
    if (!this._fast || this._fast.exitCode !== null || this._fast.killed) {
      const p = spawn(this.client.path, ['-s', this.serial, 'shell'], { windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'] });
      p.on('error', () => {});
      p.stdin.on('error', () => {});
      this._fast = p;
    }
    try {
      this._fast.stdin.write(`${cmd}\n`);
    } catch {
      this._fast = null;
      return this.shell(cmd).catch(() => '');
    }
    return Promise.resolve('');
  }

  closeFast() {
    try { this._fast?.stdin.end('exit\n'); } catch { /* déjà fermé */ }
    this._fast?.kill();
    this._fast = null;
  }

  /** Flux vidéo de l'écran (H.264), voir stream.js. */
  async screenStream(opts) {
    return new ScreenStream(this.client.path, this.serial, await this.screenSize(), opts);
  }

  /** Adresse IP Wi-Fi du téléphone (wlan0), ou '' s'il n'est pas sur un réseau. */
  async wifiIp() {
    const out = await this.shell('ip -f inet addr show wlan0').catch(() => '');
    return (/inet (\d+\.\d+\.\d+\.\d+)/.exec(out) || [])[1] || '';
  }

  /** Passe le débogage en mode réseau (port 5555), à faire pendant que le câble est branché. */
  tcpip(port = 5555) {
    return this._adb(['tcpip', String(port)], { timeout: 12000 });
  }

  async getProp(name) {
    return (await this.shell(`getprop ${name}`)).trim();
  }

  async screenSize() {
    if (this.size) return this.size;
    const out = await this.shell('wm size');
    const m = /Override size: (\d+)x(\d+)/.exec(out) || /Physical size: (\d+)x(\d+)/.exec(out);
    this.size = m ? { width: Number(m[1]), height: Number(m[2]) } : { width: 1080, height: 2400 };
    return this.size;
  }

  async info() {
    const [model, brand, android, size, igPath, power] = await Promise.all([
      this.getProp('ro.product.model'),
      this.getProp('ro.product.brand'),
      this.getProp('ro.build.version.release'),
      this.screenSize(),
      this.shell(`pm path ${IG_PACKAGE}`).catch(() => ''),
      this.shell('dumpsys power | grep -E "mWakefulness=|mHoldingDisplaySuspendBlocker"').catch(() => ''),
    ]);
    let igVersion = '';
    if (igPath.trim()) {
      const v = await this.shell(`dumpsys package ${IG_PACKAGE} | grep versionName`).catch(() => '');
      igVersion = (/versionName=(\S+)/.exec(v) || [])[1] || '';
    }
    const ime = await this.shell('settings get secure default_input_method').catch(() => '');
    return {
      model: [brand && brand[0].toUpperCase() + brand.slice(1), model].filter(Boolean).join(' '),
      android,
      ...size,
      igInstalled: !!igPath.trim(),
      igVersion,
      awake: !/mWakefulness=(Asleep|Dozing)/.test(power),
      adbKeyboard: /com\.android\.adbkeyboard/.test(ime),
    };
  }

  screencap({ signal } = {}) {
    return this._serial(() => this._adb(['exec-out', 'screencap', '-p'], { signal, binary: true, timeout: 15000 }));
  }

  /**
   * Arbre UI (XML). Le fichier est effacé avant chaque lecture : un dump raté ne doit
   * jamais renvoyer l'écran précédent. Si l'écran ne se stabilise pas (animation
   * continue), UnreadableScreenError : à l'appelant de passer à autre chose.
   */
  dumpUi({ signal } = {}) {
    return this._serial(async () => {
      let last = '';
      for (let i = 0; i < 2; i++) {
        const out = await this._adb(['exec-out', 'rm -f /sdcard/igg_ui.xml; uiautomator dump /sdcard/igg_ui.xml 2>&1; echo @@IGG@@; cat /sdcard/igg_ui.xml 2>/dev/null'], { signal, timeout: 25000 });
        const [msg, xml = ''] = out.split('@@IGG@@');
        if (xml.includes('<hierarchy')) return xml.slice(xml.indexOf('<?xml') >= 0 ? xml.indexOf('<?xml') : xml.indexOf('<hierarchy'));
        last = msg.trim();
        // Animation continue (« idle state ») : une 2e tentative échoue pareil après ~12 s, on rend la main.
        // Écran verrouillé ou autre problème : inutile d'insister non plus.
        if (!/null root/i.test(last)) break;
        await sleep(500, signal);
      }
      if (/idle/i.test(last)) throw new UnreadableScreenError();
      throw new Error(`Lecture de l’écran impossible : ${last || 'arbre UI vide (écran éteint ou verrouillé ?)'}`);
    });
  }

  tap(x, y, { signal } = {}) {
    return this.shell(`input tap ${Math.round(x)} ${Math.round(y)}`, { signal });
  }

  swipe(x1, y1, x2, y2, ms = 450, { signal } = {}) {
    return this.shell(`input swipe ${[x1, y1, x2, y2].map(Math.round).join(' ')} ${Math.round(ms)}`, { signal });
  }

  key(code, { signal } = {}) {
    return this.shell(`input keyevent ${code}`, { signal });
  }

  /**
   * Tape du texte dans le champ qui a le focus.
   * `input text` ne connaît que l'ASCII : avec le clavier « ADB Keyboard » actif,
   * on envoie le texte exact (accents, emoji) ; sinon on retire les accents.
   * @returns {Promise<{typed:string, exact:boolean}>}
   */
  async typeText(text, { signal, adbKeyboard = false } = {}) {
    const clean = String(text).replace(/\r?\n+/g, ' ');
    if (adbKeyboard) {
      const b64 = Buffer.from(clean, 'utf8').toString('base64');
      await this.shell(`am broadcast -a ADB_INPUT_B64 --es msg ${b64}`, { signal });
      return { typed: clean, exact: true };
    }
    const ascii = ASCII_OK.test(clean) ? clean : toAscii(clean);
    // Par petits morceaux, avec de courtes pauses : plus proche d'une vraie frappe.
    const words = ascii.split(/(?<= )/);
    for (let i = 0; i < words.length; i += 3) {
      const chunk = words.slice(i, i + 3).join('').replace(/ /g, '%s');
      if (chunk) await this.shell(`input text ${shQuote(chunk)}`, { signal });
      await sleep(120 + Math.random() * 380, signal);
    }
    return { typed: ascii, exact: ascii === clean };
  }

  openUrl(url, { signal } = {}) {
    return this.shell(`am start -a android.intent.action.VIEW -d ${shQuote(url)} -p ${IG_PACKAGE}`, { signal });
  }

  launchApp({ signal } = {}) {
    return this.shell(`monkey -p ${IG_PACKAGE} -c android.intent.category.LAUNCHER 1`, { signal });
  }

  async currentApp() {
    const out = await this.shell('dumpsys window | grep -E "mCurrentFocus|mFocusedApp"').catch(() => '');
    return (/([\w.]+)\/[\w.$]+/.exec(out) || [])[1] || '';
  }

  wake({ signal } = {}) {
    return this.key(224, { signal });
  }
}
