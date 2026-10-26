// Le bot : actions réelles dans l'app Instagram du téléphone, chacune vérifiée
// en relisant l'écran. Aucun succès n'est compté sans preuve à l'écran.

import { parseUiXml, findAll, findOne, center, label, fullyVisible, nearest, area } from './uitree.js';
import { SEL, LIKE_ON, LIKE_OFF, BLOCK_PATTERNS, LINKS, IG_PACKAGE, cleanUsername, cleanTag } from './selectors.js';
import { sleep, humanPause, jitterPoint, rand, StoppedError } from './control.js';

/** « 12,8 k », « 1,2 M », « 3 456 », « 12.8K » → nombre */
export function parseCount(s) {
  const m = /([\d\s.,  ]+)\s*([kKmM]|millions?|mille)?/.exec(String(s || ''));
  if (!m) return null;
  let num = m[1].replace(/[\s  ]/g, '');
  const unit = (m[2] || '').toLowerCase();
  if (unit) num = num.replace(',', '.');
  else num = num.replace(/[.,]/g, '');
  const v = parseFloat(num);
  if (Number.isNaN(v)) return null;
  const mult = unit.startsWith('m') && unit !== 'mille' ? 1e6 : unit === 'k' || unit === 'mille' ? 1e3 : 1;
  return Math.round(v * mult);
}

/** État du bouton J'aime : true (déjà liké), false (pas liké) ou null (impossible à dire). */
export function likeState(n) {
  if (!n) return null;
  if (LIKE_ON.test(n.desc)) return true;
  if (LIKE_OFF.test(n.desc)) return n.selected;
  return n.selected ? true : null;
}

export class Bot {
  /**
   * @param {object} ctx
   * @param {() => any} ctx.getDevice
   * @param {import('./limits.js').LimitGuard} ctx.guard
   * @param {(level:string, msg:string, data?:object) => void} ctx.log
   * @param {() => AbortSignal} ctx.signal
   * @param {() => void} ctx.frame demande une nouvelle capture pour l'aperçu
   * @param {(info:object) => void} ctx.event
   */
  constructor(ctx) {
    this.ctx = ctx;
    this.pendingDm = null;
  }

  get device() {
    const d = this.ctx.getDevice();
    if (!d) throw new Error('Aucun appareil connecté. Branche le téléphone ou active la simulation.');
    return d;
  }

  get signal() {
    return this.ctx.signal();
  }

  // Le simulateur accélère les attentes ; jamais le vrai téléphone.
  get speed() {
    return this.device.kind === 'sim' ? this.ctx.simSpeed ?? 0.02 : 1;
  }

  wait(ms) {
    return sleep(ms * this.speed, this.signal);
  }

  pause(min, max) {
    return humanPause(this.signal, min * this.speed, max * this.speed);
  }

  log(level, msg, data) {
    this.ctx.log(level, msg, data);
  }

  // --- Lecture de l'écran ---------------------------------------------------

  async screen() {
    const xml = await this.device.dumpUi({ signal: this.signal });
    const nodes = parseUiXml(xml);
    const size = await this.device.screenSize();
    return { nodes, size, block: this.detectBlock(nodes) };
  }

  detectBlock(nodes) {
    const text = nodes.map(label).join(' \n ');
    if (BLOCK_PATTERNS.checkpoint.test(text)) return 'checkpoint';
    if (BLOCK_PATTERNS.feedback.test(text)) return 'feedback';
    return null;
  }

  /** Relit l'écran jusqu'à ce que `test(screen)` soit vrai (ou délai dépassé). */
  async waitFor(test, { timeout = 9000, every = 900 } = {}) {
    const end = Date.now() + timeout * Math.max(this.speed, 0.2);
    let last;
    while (Date.now() < end) {
      last = await this.screen();
      if (last.block || test(last)) return last;
      await this.wait(every);
    }
    return null;
  }

  async handleBlock(kind) {
    const why = kind === 'checkpoint' ? 'Instagram demande une vérification du compte' : 'Instagram affiche « Réessayez plus tard » (action limitée)';
    this.ctx.guard.pause(kind, why);
    this.log('error', `${why}. Pause de sécurité activée, rien ne sera tenté avant sa fin.`);
    this.ctx.event({ type: 'blocked', kind, reason: why });
  }

  async tapNode(n) {
    const [x, y] = jitterPoint(center(n), n.bounds);
    await this.device.tap(x, y, { signal: this.signal });
    this.ctx.frame();
    return [x, y];
  }

  // --- Navigation ---------------------------------------------------------

  async ensureInstagram() {
    const app = await this.device.currentApp();
    if (app === IG_PACKAGE) return;
    this.log('info', 'Ouverture de l’app Instagram sur le téléphone.');
    await this.device.launchApp({ signal: this.signal });
    await this.wait(3500);
  }

  async openProfile(username) {
    const u = cleanUsername(username);
    if (!u) throw new Error('Nom de compte vide.');
    await this.ensureInstagram();
    await this.device.openUrl(LINKS.profile(u), { signal: this.signal });
    this.ctx.frame();
    const s = await this.waitFor(({ nodes }) => !!findOne(nodes, SEL.followersCount) || !!findOne(nodes, SEL.profileBio) || findAll(nodes, SEL.profileUsername).some((n) => label(n).toLowerCase() === u));
    if (!s) throw new Error(`Le profil @${u} ne s’est pas affiché (compte inexistant, réseau lent ou écran verrouillé ?).`);
    if (s.block) { await this.handleBlock(s.block); throw new Error('Action bloquée par Instagram.'); }
    const title = findAll(s.nodes, SEL.profileUsername).map(label).find(Boolean) || '';
    if (title && title.toLowerCase() !== u) this.log('warn', `Titre affiché « ${title} » au lieu de @${u}.`);
    this.log('ok', `Profil @${u} ouvert.`);
    return s;
  }

  async readProfile(username) {
    const s = username ? await this.openProfile(username) : await this.screen();
    const get = (sel) => label(findOne(s.nodes, sel) || { text: '', desc: '' });
    const profile = {
      username: (get(SEL.profileUsername) || cleanUsername(username || '')).replace(/^@/, ''),
      fullName: get(SEL.profileFullName),
      category: get(SEL.profileCategory),
      bio: get(SEL.profileBio),
      link: get(SEL.profileLink),
      posts: parseCount(get(SEL.postsCount)),
      followers: parseCount(get(SEL.followersCount)),
      following: parseCount(get(SEL.followingCount)),
      private: !!findOne(s.nodes, SEL.privateNotice),
    };
    if (!profile.bio && profile.followers === null) throw new Error('Cet écran n’est pas un profil Instagram lisible.');
    this.log('ok', `Bio lue pour @${profile.username}.`, { profile });
    return profile;
  }

  async openHashtag(tag) {
    const t = cleanTag(tag);
    if (!t) throw new Error('Hashtag vide.');
    await this.ensureInstagram();
    await this.device.openUrl(LINKS.hashtag(t), { signal: this.signal });
    this.ctx.frame();
    const s = await this.waitFor(({ nodes }) => findAll(nodes, SEL.gridItem).length > 0);
    if (!s) throw new Error(`Le hashtag #${t} ne s’est pas affiché.`);
    if (s.block) { await this.handleBlock(s.block); throw new Error('Action bloquée par Instagram.'); }
    this.log('ok', `Hashtag #${t} ouvert.`);
    return s;
  }

  /** Ouvre la n-ième vignette de la grille affichée (0 = en haut à gauche). */
  async openGridPost(s, index = 0) {
    const items = findAll(s.nodes, SEL.gridItem)
      .filter((n) => fullyVisible(n, 0, s.size.height))
      .sort((a, b) => a.bounds[1] - b.bounds[1] || a.bounds[0] - b.bounds[0]);
    const item = items[Math.min(index, items.length - 1)];
    if (!item) throw new Error('Aucune publication dans la grille (compte privé ou sans publication ?).');
    await this.pause(800, 2000);
    await this.tapNode(item);
    const post = await this.waitFor(({ nodes }) => findAll(nodes, SEL.likeButton).length > 0);
    if (!post) throw new Error('La publication ne s’est pas ouverte.');
    return post;
  }

  // --- Likes vérifiés -------------------------------------------------------

  likeButtons(s) {
    const top = s.size.height * 0.08;
    const bottom = s.size.height * 0.93;
    return findAll(s.nodes, SEL.likeButton).filter((n) => fullyVisible(n, top, bottom) && area(n) > 0);
  }

  /** Auteur et légende de la publication à laquelle appartient un bouton J'aime. */
  postMeta(s, btn) {
    const authors = findAll(s.nodes, SEL.postAuthor).filter((n) => n.bounds[3] <= btn.bounds[1]);
    const author = authors.sort((a, b) => b.bounds[1] - a.bounds[1])[0];
    const caption = findAll(s.nodes, SEL.postCaption).filter((n) => n.bounds[1] >= btn.bounds[3]).sort((a, b) => a.bounds[1] - b.bounds[1])[0];
    const captionText = caption ? label(caption) : '';
    const user = author ? label(author) : (captionText.split(/\s/)[0] || '');
    return { author: user.replace(/^@/, ''), caption: captionText.slice(0, 140), key: `${user}|${captionText.slice(0, 60)}` };
  }

  /**
   * Like d'un bouton précis, avec vérification. Passe obligatoirement par les limites.
   * @returns {Promise<{ok:boolean, verified?:boolean, skipped?:string, reason?:string, author?:string}>}
   */
  async likeButton(s, btn, { source = '' } = {}) {
    const guard = this.ctx.guard;
    const allowed = guard.canLike();
    if (!allowed.ok) return { ok: false, reason: allowed.reason, limit: true };
    const before = likeState(btn);
    const meta = this.postMeta(s, btn);
    if (before === true) return { ok: false, skipped: 'déjà liké', ...meta };

    const pos = center(btn);
    await this.tapNode(btn);
    // Vérification : on relit l'écran et on retrouve le même bouton.
    let after = null;
    for (let i = 0; i < 2 && after !== true; i++) {
      await this.wait(i === 0 ? rand(1100, 1600) : 1600);
      const s2 = await this.screen();
      if (s2.block) {
        await this.handleBlock(s2.block);
        return { ok: false, blocked: true, reason: 'Instagram a bloqué l’action.', ...meta };
      }
      const again = nearest(findAll(s2.nodes, SEL.likeButton), pos);
      after = again && again.distance < 220 ? likeState(again.node) : null;
    }
    if (after === true) {
      guard.recordLike({ author: meta.author, source, caption: meta.caption, device: this.device.kind });
      this.log('ok', `Like vérifié sur la publication de @${meta.author || '?'}.`, meta);
      this.ctx.event({ type: 'like', ...meta, source });
      return { ok: true, verified: true, ...meta };
    }
    const paused = guard.recordFail();
    this.log('warn', `Like non confirmé à l’écran (@${meta.author || '?'}) : il n’est pas compté.${paused ? ' Pause de sécurité activée.' : ''}`);
    return { ok: false, verified: false, reason: 'Le cœur n’est pas passé à « aimé » après le tap.', paused, ...meta };
  }

  /** Attend le délai « humain » entre deux likes, en l'annonçant à l'interface. */
  async waitLikeDelay(delayMs) {
    const w = this.ctx.guard.waitBeforeNextLike(delayMs);
    if (w <= 0) return;
    const real = w * this.speed;
    this.ctx.event({ type: 'wait', until: Date.now() + real, ms: real, label: 'Délai avant le prochain like' });
    this.log('info', `Prochain like dans ${Math.round(w / 1000)} s${this.speed < 1 ? ' (accéléré en simulation)' : ''}.`);
    await sleep(real, this.signal);
  }

  async scrollFeed(s) {
    const { width, height } = s.size;
    const x = width * rand(0.42, 0.62);
    const y1 = height * rand(0.72, 0.8);
    const y2 = y1 - height * rand(0.55, 0.68);
    await this.device.swipe(x, y1, x + rand(-30, 30), y2, rand(380, 650), { signal: this.signal });
    this.ctx.frame();
    await this.pause(1200, 3200);
  }

  /**
   * Session de likes : pour chaque cible (#hashtag ou @compte), ouvre la grille,
   * entre dans le fil et like les publications une par une.
   * @param {{targets:string[], count:number}} opts
   */
  async likeSession({ targets, count }) {
    const guard = this.ctx.guard;
    const goal = Math.max(1, Math.min(Number(count) || 1, 200));
    const result = { liked: 0, failed: 0, skipped: 0, stoppedBy: '' };
    const seen = new Set();
    let delay = guard.nextDelayMs();
    this.log('info', `Session de likes : objectif ${goal}, cibles ${targets.join(', ')}.`);

    for (const raw of targets) {
      if (result.liked >= goal) break;
      const isTag = raw.trim().startsWith('#');
      const source = isTag ? `#${cleanTag(raw)}` : `@${cleanUsername(raw)}`;
      const can = guard.canLike();
      if (!can.ok) { result.stoppedBy = can.reason; break; }
      let s;
      try {
        s = isTag ? await this.openHashtag(raw) : await this.openProfile(raw);
        if (!isTag && findOne(s.nodes, SEL.privateNotice)) { this.log('warn', `@${cleanUsername(raw)} est privé : cible ignorée.`); continue; }
        s = await this.openGridPost(s, Math.floor(rand(0, 3)));
      } catch (e) {
        if (e instanceof StoppedError) throw e;
        if (guard.status().paused) { result.stoppedBy = e.message; break; }
        this.log('warn', `${source} : ${e.message}`);
        continue;
      }

      let idle = 0;
      while (result.liked < goal && idle < 4) {
        const btn = this.likeButtons(s).find((b) => !seen.has(this.postMeta(s, b).key));
        if (!btn) {
          idle++;
          await this.scrollFeed(s);
          s = await this.screen();
          if (s.block) { await this.handleBlock(s.block); result.stoppedBy = 'Action bloquée par Instagram.'; return result; }
          continue;
        }
        idle = 0;
        const meta = this.postMeta(s, btn);
        seen.add(meta.key);
        // Comme un humain : on regarde la publication, et parfois on passe sans liker.
        await this.pause(2000, 6000);
        if (Math.random() < 0.15) {
          result.skipped++;
          this.log('info', `Publication de @${meta.author || '?'} regardée sans like (rythme naturel).`);
        } else if (likeState(btn) === true) {
          result.skipped++;
        } else {
          await this.waitLikeDelay(delay.ms);
          s = await this.screen(); // l'écran a pu bouger pendant l'attente
          const fresh = nearest(this.likeButtons(s), center(btn));
          if (!fresh || fresh.distance > 220) continue;
          const r = await this.likeButton(s, fresh.node, { source });
          if (r.ok) {
            result.liked++;
            this.ctx.event({ type: 'progress', liked: result.liked, goal });
            delay = guard.nextDelayMs();
            if (delay.isBreak) this.log('info', `Pause café prévue après ce like (${Math.round(delay.ms / 60000)} min).`);
          } else if (r.limit || r.blocked || r.paused) {
            result.stoppedBy = r.reason || 'Pause de sécurité.';
            return result;
          } else if (r.skipped) result.skipped++;
          else result.failed++;
        }
        await this.scrollFeed(s);
        s = await this.screen();
        if (s.block) { await this.handleBlock(s.block); result.stoppedBy = 'Action bloquée par Instagram.'; return result; }
      }
      if (idle >= 4) this.log('info', `${source} : plus de nouvelles publications, cible suivante.`);
    }
    if (!result.stoppedBy && result.liked < goal) result.stoppedBy = 'Toutes les cibles ont été parcourues. Ajoute de nouveaux hashtags ou comptes.';
    this.log('ok', `Session terminée : ${result.liked} like(s) vérifié(s), ${result.failed} non confirmé(s), ${result.skipped} passé(s).${result.stoppedBy ? ` ${result.stoppedBy}` : ''}`);
    return result;
  }

  // --- DM : préparés, jamais envoyés sans confirmation ------------------------

  composer(s) {
    return findOne(s.nodes, SEL.dmComposer);
  }

  async openThread(username) {
    const u = cleanUsername(username);
    const s = await this.openProfile(u);
    const btn = findOne(s.nodes, SEL.messageButton);
    if (btn) {
      await this.pause(700, 1600);
      await this.tapNode(btn);
    } else {
      this.log('info', 'Bouton Message introuvable sur le profil : ouverture par lien ig.me.');
      await this.device.openUrl(LINKS.dm(u), { signal: this.signal });
    }
    const t = await this.waitFor((x) => !!this.composer(x), { timeout: 10000 });
    if (!t) throw new Error(`La conversation avec @${u} ne s’est pas ouverte (le compte n’accepte peut-être pas les messages).`);
    if (t.block) { await this.handleBlock(t.block); throw new Error('Action bloquée par Instagram.'); }
    return t;
  }

  /** Ouvre la conversation et tape le message, sans l'envoyer. */
  async prepareDm(username, text) {
    const u = cleanUsername(username);
    const msg = String(text || '').trim();
    if (!u || !msg) throw new Error('Il faut un compte et un message.');
    let s = await this.openThread(u);
    const field = this.composer(s);
    await this.tapNode(field);
    await this.wait(600);
    s = await this.screen();
    const current = this.composer(s);
    if (current && current.text && !/^(message…|message\.\.\.|votre message…|écrire un message…)$/i.test(current.text)) {
      throw new Error('Le champ de message contient déjà un brouillon : vide-le d’abord sur le téléphone.');
    }
    const { typed, exact } = await this.device.typeText(msg, { signal: this.signal, adbKeyboard: this.ctx.adbKeyboard?.() });
    this.ctx.frame();
    await this.wait(800);
    s = await this.screen();
    const after = this.composer(s);
    const ok = after && after.text.replace(/\s+/g, ' ').includes(typed.replace(/\s+/g, ' ').slice(0, 40));
    if (!ok) throw new Error('Le texte n’apparaît pas dans le champ de message après la saisie.');
    this.pendingDm = { username: u, text: typed, exact, at: Date.now() };
    this.log('ok', `Message préparé pour @${u}. Il n’est PAS envoyé : vérifie l’écran puis confirme dans l’app.${exact ? '' : ' Les accents ont été retirés (installe ADB Keyboard pour les garder).'}`);
    this.ctx.event({ type: 'pending-dm', dm: this.pendingDm });
    return this.pendingDm;
  }

  /** Envoi après confirmation explicite de l'utilisateur dans l'app. */
  async sendPendingDm({ confirmed } = {}) {
    const dm = this.pendingDm;
    if (!dm) throw new Error('Aucun message préparé.');
    if (confirmed !== true) throw new Error('L’envoi demande une confirmation explicite.');
    const can = this.ctx.guard.canSendDm();
    if (!can.ok) throw new Error(can.reason);
    let s = await this.screen();
    const field = this.composer(s);
    if (!field || !field.text.replace(/\s+/g, ' ').includes(dm.text.replace(/\s+/g, ' ').slice(0, 40))) {
      this.pendingDm = null;
      this.ctx.event({ type: 'pending-dm', dm: null });
      throw new Error('Le message préparé n’est plus à l’écran : envoi annulé par sécurité.');
    }
    const send = findOne(s.nodes, SEL.dmSend);
    if (!send) throw new Error('Bouton Envoyer introuvable.');
    await this.tapNode(send);
    await this.wait(1500);
    s = await this.screen();
    if (s.block) { await this.handleBlock(s.block); throw new Error('Instagram a bloqué l’envoi.'); }
    const bubble = findAll(s.nodes, SEL.dmMessageText).some((n) => label(n).replace(/\s+/g, ' ').includes(dm.text.replace(/\s+/g, ' ').slice(0, 40)));
    const cleared = !this.composer(s) || !this.composer(s).text.includes(dm.text.slice(0, 20));
    this.pendingDm = null;
    this.ctx.event({ type: 'pending-dm', dm: null });
    if (!bubble && !cleared) throw new Error('Envoi non confirmé : le message est toujours dans le champ.');
    this.ctx.guard.recordDm({ to: dm.username });
    this.log('ok', `Message envoyé à @${dm.username}${bubble ? ' (bulle vérifiée dans la conversation)' : ' (champ vidé, bulle non visible)'}.`);
    return { sent: true, verified: bubble, username: dm.username };
  }

  cancelPendingDm() {
    this.pendingDm = null;
    this.ctx.event({ type: 'pending-dm', dm: null });
  }
}
