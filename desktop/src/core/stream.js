// Flux vidéo de l'écran du téléphone : `screenrecord` (intégré à Android, rien à
// installer) en H.264 brut, découpé en images pour WebCodecs dans l'interface.
// screenrecord n'envoie une image que quand l'écran change, et s'arrête au bout
// de 3 minutes : on le relance aussitôt, sans que l'aperçu ne se fige.

import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';

const TIME_LIMIT = 180;
const FLUSH_MS = 12; // sans nouvelles données pendant ce délai, le dernier NAL reçu est complet

/** Découpe un flux Annex B (00 00 01 / 00 00 00 01) en NAL, start code compris. */
export class NalSplitter {
  constructor(onNal) {
    this.onNal = onNal;
    this.buf = Buffer.alloc(0);
  }

  push(chunk) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    let start = findStart(this.buf, 0);
    if (start < 0) return;
    for (;;) {
      const next = findStart(this.buf, start + 3);
      if (next < 0) break;
      this.onNal(this.buf.subarray(start, next));
      start = next;
    }
    this.buf = this.buf.subarray(start);
  }

  /** Le reste du tampon est un NAL complet (screenrecord écrit une image d'un bloc). */
  flush() {
    if (findStart(this.buf, 0) === 0 && this.buf.length > 4) this.onNal(this.buf);
    this.buf = Buffer.alloc(0);
  }
}

function findStart(b, from) {
  for (let i = from; i + 3 <= b.length; i++) {
    if (b[i] === 0 && b[i + 1] === 0) {
      if (b[i + 2] === 1) return i > 0 && b[i - 1] === 0 && i - 1 >= from ? i - 1 : i;
      if (b[i + 2] === 0 && b[i + 3] === 1) return i;
    }
  }
  return -1;
}

const nalType = (nal) => nal[nal[2] === 1 ? 3 : 4] & 0x1f;
const nalBody = (nal) => nal.subarray(nal[2] === 1 ? 3 : 4);

/** Chaîne de codec WebCodecs (« avc1.42c01f ») tirée du SPS. */
export function codecFromSps(sps) {
  const b = nalBody(sps);
  return `avc1.${[b[1], b[2], b[3]].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Événements : 'video' { key, codec, data:Buffer, width, height }, 'error' (Error), 'end'.
 */
export class ScreenStream extends EventEmitter {
  /**
   * @param {string} adbPath
   * @param {string} serial
   * @param {{width:number, height:number}} screen taille réelle de l'écran
   * @param {{maxWidth?:number, bitRate?:number}} [o]
   */
  constructor(adbPath, serial, screen, { maxWidth = 576, bitRate = 4_000_000 } = {}) {
    super();
    this.adbPath = adbPath;
    this.serial = serial;
    this.bitRate = bitRate;
    const scale = Math.min(1, maxWidth / screen.width);
    // Dimensions paires (exigence des encodeurs H.264).
    this.width = Math.round((screen.width * scale) / 2) * 2;
    this.height = Math.round((screen.height * scale) / 2) * 2;
    this.useSize = true;
    this.running = false;
    this.frames = 0;
    this.fails = 0;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._spawn();
  }

  stop() {
    this.running = false;
    clearTimeout(this._flushT);
    clearTimeout(this._restartT);
    this.proc?.kill();
    this.proc = null;
  }

  _spawn() {
    const args = ['-s', this.serial, 'exec-out', 'screenrecord', '--output-format=h264', `--bit-rate=${this.bitRate}`, `--time-limit=${TIME_LIMIT}`];
    if (this.useSize) args.push(`--size=${this.width}x${this.height}`);
    args.push('-');
    const proc = spawn(this.adbPath, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    this.proc = proc;
    const startedAt = Date.now();
    let gotFrame = false;
    let sps = null;
    let pps = null;
    let codec = '';
    let stderr = '';
    const splitter = new NalSplitter((nal) => {
      const t = nalType(nal);
      if (t === 7) { sps = Buffer.from(nal); codec = codecFromSps(sps); return; }
      if (t === 8) { pps = Buffer.from(nal); return; }
      if (t !== 5 && t !== 1) return; // SEI, AUD… inutiles pour l'affichage
      const key = t === 5;
      if (key && !(sps && pps)) return;
      gotFrame = true;
      this.frames++;
      this.fails = 0;
      this.emit('video', { key, codec, width: this.width, height: this.height, data: key ? Buffer.concat([sps, pps, nal]) : Buffer.from(nal) });
    });
    proc.stdout.on('data', (chunk) => {
      splitter.push(chunk);
      clearTimeout(this._flushT);
      this._flushT = setTimeout(() => splitter.flush(), FLUSH_MS);
    });
    proc.stderr.on('data', (d) => { stderr += d; });
    proc.on('error', (e) => this.emit('error', e));
    proc.on('close', () => {
      if (this.proc !== proc) return;
      this.proc = null;
      if (!this.running) return this.emit('end');
      const quick = Date.now() - startedAt < 4000 && !gotFrame;
      if (quick) {
        this.fails++;
        // Certains encodeurs refusent la taille demandée : on réessaie à la taille native.
        if (this.useSize && this.fails === 2) this.useSize = false;
        if (this.fails >= 4) {
          this.running = false;
          this.emit('error', new Error(stderr.trim().split('\n').pop() || 'screenrecord ne démarre pas sur ce téléphone.'));
          return;
        }
      }
      this._restartT = setTimeout(() => this.running && this._spawn(), quick ? 800 : 50);
    });
  }
}
