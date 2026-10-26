// Mises à jour : l'app regarde les releases GitHub du dépôt dont le tag commence
// par « desktop-v » (les releases « vX.Y.Z » sont celles de l'extension), et
// propose la nouvelle version. Rien ne s'installe sans l'accord de l'utilisateur :
// « Mettre à jour » télécharge (vérification SHA-512 par electron-updater), puis
// « Redémarrer et installer » lance l'installeur.

import electronUpdater from 'electron-updater';
import { newer, pickDesktopRelease } from '../core/version.js';

const { autoUpdater } = electronUpdater;

export const REPO = 'lburdier/instagrowth';
const EVERY = 6 * 60 * 60 * 1000;

export class Updater {
  /**
   * @param {{ app: import('electron').App, send: (ev:object) => void, log: (level:string, msg:string) => void }} o
   */
  constructor({ app, send, log }) {
    this.app = app;
    this.send = send;
    this.log = log;
    this.current = app.getVersion();
    this.packaged = app.isPackaged;
    this.state = { status: 'idle', current: this.current, packaged: this.packaged };
    // Base de test locale possible : IGG_UPDATE_API (liste des releases) et IGG_UPDATE_FEED (fichiers).
    this.api = process.env.IGG_UPDATE_API || `https://api.github.com/repos/${REPO}/releases?per_page=40`;

    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.allowDowngrade = false;
    autoUpdater.logger = null;
    autoUpdater.on('download-progress', (p) => this.set({ status: 'downloading', percent: Math.round(p.percent || 0) }));
    autoUpdater.on('update-downloaded', () => {
      this.set({ status: 'ready', percent: 100 });
      this.log('ok', `Mise à jour ${this.state.version} téléchargée : prête à installer.`);
    });
    autoUpdater.on('error', (e) => {
      if (this.state.status === 'downloading' || this.state.status === 'checking-feed') this.fail(e);
    });
  }

  set(patch) {
    this.state = { ...this.state, ...patch };
    this.send({ type: 'update', state: this.state });
  }

  fail(e) {
    const msg = String(e?.message || e).split('\n')[0];
    this.set({ status: 'error', error: msg });
    this.log('warn', `Mise à jour : ${msg}`);
  }

  start() {
    setTimeout(() => this.check({ quiet: true }), 8000);
    this.timer = setInterval(() => this.check({ quiet: true }), EVERY);
  }

  /** Cherche la release desktop la plus récente sur GitHub. */
  async check({ quiet = false } = {}) {
    if (['downloading', 'ready'].includes(this.state.status)) return this.state;
    this.set({ status: 'checking', error: '' });
    try {
      const res = await fetch(this.api, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'InstaGrowth-Desktop' } });
      if (!res.ok) throw new Error(`GitHub a répondu ${res.status}`);
      const releases = await res.json();
      const best = pickDesktopRelease(releases);
      if (best && newer(best.version, this.current)) {
        const wasKnown = this.state.version === best.version;
        this.set({ status: 'available', ...best, checkedAt: Date.now() });
        if (!wasKnown) this.log('info', `InstaGrowth Desktop ${best.version} est disponible (tu as la ${this.current}).`);
      } else {
        this.set({ status: 'uptodate', version: '', checkedAt: Date.now() });
        if (!quiet) this.log('ok', `InstaGrowth Desktop est à jour (${this.current}).`);
      }
    } catch (e) {
      if (quiet) this.set({ status: 'idle' });
      else this.fail(e);
    }
    return this.state;
  }

  /** Télécharge la version proposée (après le clic de l'utilisateur). */
  async download() {
    const s = this.state;
    if (s.status !== 'available' && s.status !== 'error') throw new Error('Aucune mise à jour à télécharger.');
    if (!this.packaged) throw new Error('Mise à jour automatique indisponible en mode développement : fais « git pull » puis « npm install ».');
    if (!s.hasInstaller) throw new Error('Cette release ne contient pas d’installeur Windows (latest.yml manquant).');
    const feed = process.env.IGG_UPDATE_FEED || `https://github.com/${REPO}/releases/download/${s.tag}`;
    autoUpdater.setFeedURL({ provider: 'generic', url: feed });
    this.set({ status: 'checking-feed', percent: 0 });
    const r = await autoUpdater.checkForUpdates();
    if (!r?.updateInfo || !newer(r.updateInfo.version, this.current)) {
      this.fail(new Error('Le fichier de mise à jour ne correspond pas à une version plus récente.'));
      return this.state;
    }
    this.set({ status: 'downloading', percent: 0 });
    autoUpdater.downloadUpdate().catch((e) => this.fail(e));
    return this.state;
  }

  /** Ferme l'app et lance l'installeur téléchargé (après le clic de l'utilisateur). */
  install() {
    if (this.state.status !== 'ready') throw new Error('La mise à jour n’est pas encore téléchargée.');
    setImmediate(() => autoUpdater.quitAndInstall(false, true));
    return true;
  }
}
