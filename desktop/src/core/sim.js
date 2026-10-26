// Téléphone simulé : imite l'app Instagram Android (fil, profil, hashtag, DM)
// avec la même interface qu'un vrai appareil ADB. Il sert à tester le bot et
// le mode Claude sans téléphone branché. Rien n'est envoyé à Instagram.
//
// Comme le vrai Instagram : toucher un cœur déjà rouge retire le like, les
// boutons ont les mêmes resource-id, et on peut simuler un « Réessayez plus tard ».

import { rectsToPng } from './png.js';
import { UnreadableScreenError } from './adb.js';

const W = 1080;
const H = 2400;
const TOP = 222; // sous la barre d'état + la barre de titre
const NAV = 2250; // barre de navigation du bas
const POST_H = 1700;
const PKG = 'com.instagram.android';
const rid = (s) => (s ? `${PKG}:id/${s}` : '');

function seeded(seed) {
  let s = 0;
  for (const c of String(seed)) s = (s * 31 + c.charCodeAt(0)) >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

const USERS = [
  { u: 'studio.lumen', name: 'Studio Lumen', cat: 'Photographe', bio: 'Portraits & mariages à Lyon. Réservations ouvertes pour 2027.\ncontact@studiolumen.fr', link: 'studiolumen.fr', posts: 214, followers: 12800, following: 610 },
  { u: 'yoga.marie', name: 'Marie — Yoga', cat: 'Coach sportif', bio: 'Prof de vinyasa. Cours en ligne chaque matin à 7 h.\nAteliers respiration le dimanche.', link: 'linktr.ee/yogamarie', posts: 389, followers: 25400, following: 412 },
  { u: 'cafe.racine', name: 'Café Racine', cat: 'Café', bio: 'Torréfacteur artisanal — Nantes.\nOuvert 8 h–18 h, fermé le lundi.', link: 'caferacine.com', posts: 156, followers: 4300, following: 280 },
  { u: 'trail.alex', name: 'Alex Trail', cat: 'Athlète', bio: 'Ultra-trail, montagne et café filtre.\nPrépa UTMB 2027.', link: '', posts: 97, followers: 1890, following: 530 },
  { u: 'atelier.noa', name: 'Atelier Noa', cat: 'Céramiste', bio: 'Céramique faite main. Boutique en ligne chaque premier vendredi du mois.', link: 'ateliernoa.fr', posts: 241, followers: 8700, following: 190 },
  { u: 'le.potager.urbain', name: 'Potager Urbain', cat: 'Jardin', bio: 'Cultiver sur 6 m² de balcon. Astuces chaque semaine.', link: '', posts: 320, followers: 15100, following: 98, private: false },
  { u: 'julien.prive', name: 'Julien', cat: '', bio: 'Compte perso.', link: '', posts: 34, followers: 210, following: 240, private: true },
];
const CAPTIONS = [
  'Lumière du matin, rien de plus.', 'Nouvelle série en préparation.', 'Le café du jour : Éthiopie lavé.',
  'Séance de 20 minutes pour bien démarrer.', 'Sortie longue sous la pluie, aucun regret.', 'Pièces uniques, émail bleu nuit.',
  'Les tomates sont enfin là.', 'Coulisses du shooting de samedi.', 'Petit rituel du dimanche.', 'Avant / après, glisse pour voir.',
];

const fmt = (n) => (n >= 10000 ? `${(n / 1000).toFixed(1).replace('.', ',')} k` : n.toLocaleString('fr-FR'));

export class SimDevice {
  constructor({ blockAfter = 0, missRate = 0 } = {}) {
    this.kind = 'sim';
    this.serial = 'simulation';
    this.size = { width: W, height: H };
    this.opts = { blockAfter, missRate };
    this.likesRegistered = 0;
    this.rasterize = null; // fourni par Electron pour un rendu fidèle
    this.users = new Map(USERS.map((x) => [x.u, { ...x, following: false, followingCount: x.following }]));
    this.postsById = new Map();
    this.threads = new Map();
    this.typedLog = [];
    this.sent = [];
    this.home();
  }

  // --- Données -------------------------------------------------------------

  postsOf(user) {
    const r = seeded(user);
    const n = 9;
    return Array.from({ length: n }, (_, i) => this.post(`${user}:${i}`, user, r));
  }

  post(id, user, r = Math.random) {
    if (!this.postsById.has(id)) {
      this.postsById.set(id, { id, user, liked: false, likes: Math.floor(r() * 900) + 12, caption: CAPTIONS[Math.floor(r() * CAPTIONS.length)], hue: Math.floor(r() * 360), ago: `${Math.floor(r() * 20) + 1} h` });
    }
    return this.postsById.get(id);
  }

  tagPosts(tag) {
    const r = seeded(`#${tag}`);
    const all = [...this.users.keys()].filter((u) => !this.users.get(u).private);
    return Array.from({ length: 12 }, (_, i) => this.post(`#${tag}:${i}`, all[Math.floor(r() * all.length)], r));
  }

  // --- Navigation ----------------------------------------------------------

  home() {
    const feed = ['cafe.racine', 'yoga.marie', 'atelier.noa'].flatMap((u) => this.postsOf(u).slice(0, 2));
    this.stack = [{ type: 'feed', title: 'Instagram', posts: feed, scroll: 0, home: true }];
    this.dialog = null;
  }

  get screen() {
    return this.stack[this.stack.length - 1];
  }

  push(s) {
    this.stack.push(s);
  }

  openUrl(url) {
    const m = /instagram\.com\/explore\/tags\/([^/?#]+)/i.exec(url);
    const p = /instagram\.com\/([\w.]+)\/?$/i.exec(url);
    const dm = /ig\.me\/m\/([\w.]+)/i.exec(url);
    if (m) this.push({ type: 'grid', tag: decodeURIComponent(m[1]).toLowerCase(), posts: this.tagPosts(m[1].toLowerCase()) });
    else if (dm) this.openThread(dm[1].toLowerCase());
    else if (p) this.openProfile(p[1].toLowerCase());
    return Promise.resolve(`Starting: Intent { act=android.intent.action.VIEW dat=${url} }`);
  }

  openProfile(u) {
    if (!this.users.has(u)) {
      const r = seeded(u);
      this.users.set(u, { u, name: u.replace(/[._]/g, ' '), cat: '', bio: 'Compte de démonstration généré par le simulateur.', link: '', posts: Math.floor(r() * 300) + 3, followers: Math.floor(r() * 9000) + 20, following: false, followingCount: Math.floor(r() * 800) + 10 });
    }
    this.push({ type: 'profile', user: u, posts: this.users.get(u).private ? [] : this.postsOf(u) });
  }

  openThread(u) {
    if (!this.threads.has(u)) this.threads.set(u, { messages: [{ me: false, text: 'Merci pour ton message de la semaine dernière !' }], draft: '', focused: false });
    this.push({ type: 'thread', user: u });
  }

  // --- Interface ADB --------------------------------------------------------

  async info() {
    return { model: 'Téléphone simulé', android: '15', width: W, height: H, igInstalled: true, igVersion: 'simulation', awake: true, adbKeyboard: true };
  }

  async screenSize() {
    return this.size;
  }

  async currentApp() {
    return PKG;
  }

  async launchApp() {
    this.home();
    return '';
  }

  async wake() {
    return '';
  }

  async key(code) {
    if (Number(code) === 4) this.back();
    if (Number(code) === 3) this.home();
    return '';
  }

  back() {
    if (this.dialog) { this.dialog = null; return; }
    const s = this.screen;
    if (s.type === 'thread' && this.threads.get(s.user).focused) { this.threads.get(s.user).focused = false; return; }
    if (this.stack.length > 1) this.stack.pop();
  }

  async tap(x, y) {
    const nodes = this.layout();
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      const [x1, y1, x2, y2] = n.bounds;
      if (n.onTap && x >= x1 && x <= x2 && y >= y1 && y <= y2) {
        n.onTap();
        return '';
      }
    }
    return '';
  }

  async swipe(x1, y1, x2, y2) {
    const s = this.screen;
    if (this.dialog) return '';
    const dy = y1 - y2;
    if (s.type === 'clips') {
      // Un geste suffisant fait passer à la publication suivante (ou précédente).
      if (Math.abs(dy) > 300) s.index = Math.max(0, Math.min(s.posts.length - 1, s.index + Math.sign(dy)));
      return '';
    }
    if (s.type !== 'feed') return '';
    const max = Math.max(0, (s.posts.length - 1) * POST_H);
    s.scroll = Math.round(Math.max(0, Math.min(max, s.scroll + dy)));
    return '';
  }

  async typeText(text, { adbKeyboard = true } = {}) {
    const s = this.screen;
    const clean = String(text).replace(/\r?\n+/g, ' ');
    if (s.type === 'thread') {
      const t = this.threads.get(s.user);
      if (t.focused) t.draft += clean;
    }
    this.typedLog.push(clean);
    return { typed: clean, exact: adbKeyboard };
  }

  async shell() {
    return '';
  }

  async dumpUi() {
    // Comme sur un vrai téléphone : une publication animée en continu ne se laisse pas lire.
    const s = this.screen;
    if (s.type === 'clips' && s.posts[s.index].animated) throw new UnreadableScreenError();
    return this.toXml(this.layout());
  }

  async screencap() {
    const nodes = this.layout();
    if (this.rasterize) return this.rasterize(this.toSvg(nodes), W, H);
    const scale = 0.25;
    const rects = nodes.filter((n) => n.draw).map((n) => {
      const [x1, y1, x2, y2] = n.bounds;
      const color = n.draw.kind === 'heart' ? (n.selected ? '#ff3040' : '#f5f5f5') : n.draw.kind === 'image' ? hueHex(n.draw.hue) :n.draw.kind === 'button' ? (n.draw.primary ? '#0095f6' : '#363636') : n.draw.kind === 'input' ? '#262626' : n.draw.kind === 'dialog' ? '#262626' : '#a8a8a8';
      const pad = n.draw.kind === 'text' ? 0.35 : 0;
      return { x: x1 * scale, y: (y1 + (y2 - y1) * pad) * scale, w: (x2 - x1) * scale, h: (y2 - y1) * (1 - 2 * pad) * scale, color };
    });
    return rectsToPng(W * scale, H * scale, rects);
  }

  // --- Mise en page -------------------------------------------------------
  // Chaque élément : bounds, attributs « uiautomator », dessin et action au tap.

  layout() {
    const s = this.screen;
    const out = [];
    const add = (n) => { out.push({ text: '', desc: '', id: '', cls: 'android.view.View', clickable: false, selected: false, focused: false, ...n }); return n; };
    // Barre d'état
    add({ bounds: [0, 0, W, 72], draw: { kind: 'status' } });
    if (s.type === 'feed') this.layoutFeed(s, add);
    if (s.type === 'grid') this.layoutGrid(s, add);
    if (s.type === 'clips') this.layoutClips(s, add);
    if (s.type === 'profile') this.layoutProfile(s, add);
    if (s.type === 'thread') this.layoutThread(s, add);
    if (s.type !== 'thread') this.layoutNav(add);
    if (this.dialog) this.layoutDialog(add);
    return out;
  }

  topBar(add, title, { back = true, idTitle = 'action_bar_title' } = {}) {
    add({ bounds: [0, 72, W, TOP], draw: { kind: 'bar' } });
    if (back) add({ bounds: [10, 92, 130, 202], cls: 'android.widget.ImageView', desc: 'Retour', id: rid('action_bar_button_back'), clickable: true, draw: { kind: 'icon', icon: 'back' }, onTap: () => this.back() });
    add({ bounds: [back ? 150 : 40, 100, 900, 195], cls: 'android.widget.TextView', text: title, id: rid(idTitle), draw: { kind: 'text', size: back ? 50 : 62, weight: 700, font: back ? 'sans' : 'logo' } });
  }

  layoutNav(add) {
    add({ bounds: [0, NAV, W, H], draw: { kind: 'bar', top: true } });
    const tabs = [['Accueil', 'home'], ['Rechercher et explorer', 'search'], ['Reels', 'reels'], ['Boutique', 'shop'], ['Profil', 'profile']];
    tabs.forEach(([d, icon], i) => add({ bounds: [i * 216, NAV + 10, (i + 1) * 216, H - 20], cls: 'android.widget.FrameLayout', desc: d, id: rid(`${icon}_tab`), clickable: true, draw: { kind: 'icon', icon }, onTap: () => (icon === 'home' ? this.home() : null) }));
  }

  layoutFeed(s, add) {
    if (s.home) this.topBar(add, 'Instagram', { back: false });
    else this.topBar(add, 'Publications');
    add({ bounds: [0, TOP, W, NAV], cls: 'androidx.recyclerview.widget.RecyclerView', id: rid('list'), scrollable: true });
    s.posts.forEach((p, i) => {
      const y = TOP + i * POST_H - s.scroll;
      if (y > NAV || y + POST_H < TOP) return;
      const clip = (b) => [b[0], Math.max(TOP, b[1]), b[2], Math.min(NAV, b[3])];
      const vis = (b) => b[3] > TOP && b[1] < NAV;
      const put = (n) => { if (vis(n.bounds)) add({ ...n, bounds: clip(n.bounds), raw: n.bounds }); };
      const u = this.users.get(p.user);
      put({ bounds: [30, y + 20, 120, y + 110], cls: 'android.widget.ImageView', desc: `Photo de profil de ${p.user}`, id: rid('row_feed_photo_profile_imageview'), clickable: true, draw: { kind: 'avatar', hue: (p.hue + 40) % 360 }, onTap: () => this.openProfile(p.user) });
      put({ bounds: [140, y + 35, 760, y + 95], cls: 'android.widget.TextView', text: p.user, id: rid('row_feed_photo_profile_name'), clickable: true, draw: { kind: 'text', size: 40, weight: 600 }, onTap: () => this.openProfile(p.user) });
      put({ bounds: [0, y + 130, W, y + 1210], cls: 'android.widget.ImageView', desc: `Photo de ${u?.name || p.user}, ${p.caption}`, id: rid('row_feed_photo_imageview'), draw: { kind: 'image', hue: p.hue, color: `hsl(${p.hue},55%,45%)` }, onTap: null });
      put({ bounds: [20, y + 1220, 150, y + 1340], cls: 'android.widget.ImageView', desc: p.liked ? 'Je n’aime plus' : 'J’aime', id: rid('row_feed_button_like'), clickable: true, selected: p.liked, draw: { kind: 'heart' }, onTap: () => this.tapLike(p) });
      put({ bounds: [160, y + 1220, 290, y + 1340], cls: 'android.widget.ImageView', desc: 'Commenter', id: rid('row_feed_button_comment'), clickable: true, draw: { kind: 'icon', icon: 'comment' } });
      put({ bounds: [300, y + 1220, 430, y + 1340], cls: 'android.widget.ImageView', desc: 'Partager', id: rid('row_feed_button_share'), clickable: true, draw: { kind: 'icon', icon: 'share' } });
      put({ bounds: [930, y + 1220, 1060, y + 1340], cls: 'android.widget.ImageView', desc: 'Enregistrer', id: rid('row_feed_button_save'), clickable: true, draw: { kind: 'icon', icon: 'save' } });
      put({ bounds: [40, y + 1350, 900, y + 1410], cls: 'android.widget.TextView', text: `${p.likes + (p.liked ? 1 : 0)} mentions J’aime`, id: rid('row_feed_textview_likes'), draw: { kind: 'text', size: 38, weight: 600 } });
      put({ bounds: [40, y + 1420, 1040, y + 1560], cls: 'android.widget.TextView', text: `${p.user} ${p.caption}`, id: rid('row_feed_comment_textview_layout'), draw: { kind: 'text', size: 38, bold: p.user } });
      put({ bounds: [40, y + 1570, 600, y + 1620], cls: 'android.widget.TextView', text: `Il y a ${p.ago}`, draw: { kind: 'text', size: 32, muted: true } });
    });
  }

  /** Vue plein écran : boutons à droite, auteur et légende en bas, une publication par écran. */
  layoutClips(s, add) {
    const p = s.posts[s.index];
    const u = this.users.get(p.user);
    add({ bounds: [0, 100, W, 2036], id: rid('clips_media_component'), desc: `Publication de ${p.user}. Appuyez deux fois pour aimer.`, draw: { kind: 'image', hue: p.hue } });
    add({ bounds: [0, 100, 134, 258], cls: 'android.widget.ImageView', desc: 'Retour', clickable: true, draw: { kind: 'icon', icon: 'back' }, onTap: () => this.back() });
    add({ bounds: [179, 100, 923, 258], cls: 'android.widget.TextView', text: `#${s.tag}`, id: rid('clips_viewer_action_bar_title'), clickable: true, draw: { kind: 'text', size: 46, weight: 700 } });
    add({ bounds: [933, 888, 1057, 1012], cls: 'android.widget.ImageView', desc: 'J’aime', id: rid('like_button'), clickable: true, selected: p.liked, draw: { kind: 'heart' }, onTap: () => this.tapLike(p) });
    add({ bounds: [933, 1012, 1057, 1079], cls: 'android.widget.TextView', text: `Nombre de J’aime : ${p.likes + (p.liked ? 1 : 0)}. Voir les J’aime`, desc: `Nombre de J’aime : ${p.likes + (p.liked ? 1 : 0)}. Voir les J’aime`, id: rid('like_count'), clickable: true, draw: { kind: 'text', size: 30 } });
    add({ bounds: [933, 1079, 1057, 1203], cls: 'android.widget.ImageView', desc: 'Commentaire', id: rid('comment_button'), clickable: true, draw: { kind: 'icon', icon: 'comment' } });
    add({ bounds: [933, 1461, 1057, 1585], cls: 'android.widget.ImageView', desc: 'Partager', id: rid('direct_share_button'), clickable: true, draw: { kind: 'icon', icon: 'share' } });
    add({ bounds: [933, 1608, 1057, 1732], cls: 'android.widget.ImageView', desc: 'Enregistrer', id: rid('save_button'), clickable: true, draw: { kind: 'icon', icon: 'save' } });
    add({ bounds: [45, 1665, 146, 1766], cls: 'android.widget.ImageView', desc: `Photo de profil de ${p.user}`, id: rid('clips_author_profile_pic'), clickable: true, draw: { kind: 'avatar', hue: (p.hue + 40) % 360 }, onTap: () => this.openProfile(p.user) });
    add({ bounds: [160, 1667, 600, 1717], cls: 'android.widget.TextView', text: p.user, desc: p.user, id: rid('clips_author_username'), clickable: true, draw: { kind: 'text', size: 40, weight: 600 }, onTap: () => this.openProfile(p.user) });
    add({ bounds: [45, 1766, 933, 1889], id: rid('clips_caption_component') });
    add({ bounds: [45, 1777, 933, 1889], cls: 'android.widget.TextView', desc: `${p.caption}${u?.name ? ` · ${u.name}` : ''}`, clickable: true, draw: { kind: 'text', size: 36, lines: wrap(p.caption, 44) } });
  }

  layoutGrid(s, add) {
    this.topBar(add, `#${s.tag}`);
    add({ bounds: [40, 250, 300, 460], cls: 'android.widget.ImageView', draw: { kind: 'avatar', hue: 200, square: true } });
    add({ bounds: [340, 280, 1040, 350], cls: 'android.widget.TextView', text: `#${s.tag}`, id: rid('hashtag_title'), draw: { kind: 'text', size: 48, weight: 700 } });
    add({ bounds: [340, 360, 1040, 420], cls: 'android.widget.TextView', text: `${fmt(12400 + s.tag.length * 997)} publications`, draw: { kind: 'text', size: 36, muted: true } });
    add({ bounds: [0, 500, 540, 590], cls: 'android.widget.TextView', text: 'Meilleures publications', clickable: true, selected: true, draw: { kind: 'tab', active: true } });
    add({ bounds: [540, 500, W, 590], cls: 'android.widget.TextView', text: 'Récentes', clickable: true, draw: { kind: 'tab' } });
    // Comme Instagram 452 : une publication de hashtag s'ouvre en plein écran (« clips »).
    this.grid(add, s.posts, 600, (i) => this.push({ type: 'clips', tag: s.tag, posts: s.posts, index: i }));
  }

  grid(add, posts, y0, onOpen) {
    const tile = 357;
    posts.forEach((p, i) => {
      const r = Math.floor(i / 3), c = i % 3;
      const y = y0 + r * (tile + 4);
      if (y + tile > NAV) return;
      add({ bounds: [c * (tile + 4), y, c * (tile + 4) + tile, y + tile], cls: 'android.widget.ImageView', desc: `Photo de ${p.user}, rangée ${r + 1}, colonne ${c + 1}`, id: rid('image_button'), clickable: true, draw: { kind: 'image', hue: p.hue, color: `hsl(${p.hue},55%,45%)`, small: true }, onTap: () => onOpen(i) });
    });
  }

  layoutProfile(s, add) {
    const u = this.users.get(s.user);
    this.topBar(add, u.u);
    add({ bounds: [40, 250, 250, 460], cls: 'android.widget.ImageView', desc: `Photo de profil de ${u.u}`, id: rid('row_profile_header_imageview'), draw: { kind: 'avatar', hue: (u.u.length * 47) % 360 } });
    const counts = [[u.posts, 'publications', 'row_profile_header_textview_post_count'], [u.followers + (u.following ? 1 : 0), 'followers', 'row_profile_header_textview_followers_count'], [u.followingCount, 'suivi(e)s', 'row_profile_header_textview_following_count']];
    counts.forEach(([n, l, id], i) => {
      const x = 300 + i * 250;
      add({ bounds: [x, 290, x + 230, 350], cls: 'android.widget.TextView', text: fmt(n), id: rid(id), draw: { kind: 'text', size: 44, weight: 700, align: 'middle' } });
      add({ bounds: [x, 355, x + 230, 405], cls: 'android.widget.TextView', text: l, draw: { kind: 'text', size: 34, align: 'middle' } });
    });
    let y = 490;
    add({ bounds: [40, y, 1040, y + 55], cls: 'android.widget.TextView', text: u.name, id: rid('profile_header_full_name'), draw: { kind: 'text', size: 40, weight: 700 } });
    y += 60;
    if (u.cat) { add({ bounds: [40, y, 1040, y + 50], cls: 'android.widget.TextView', text: u.cat, id: rid('profile_header_business_category'), draw: { kind: 'text', size: 36, muted: true } }); y += 55; }
    const lines = u.bio.split('\n').flatMap((l) => wrap(l, 46));
    add({ bounds: [40, y, 1040, y + lines.length * 50], cls: 'android.widget.TextView', text: u.bio, id: rid('profile_header_bio_text'), draw: { kind: 'text', size: 36, lines } });
    y += lines.length * 50 + 8;
    if (u.link) { add({ bounds: [40, y, 1040, y + 50], cls: 'android.widget.TextView', text: u.link, id: rid('profile_header_website'), clickable: true, draw: { kind: 'text', size: 36, link: true } }); y += 55; }
    y = Math.max(y + 20, 880);
    add({ bounds: [40, y, 525, y + 90], cls: 'android.widget.Button', text: u.following ? 'Suivi(e)' : 'Suivre', id: rid('profile_header_follow_button'), clickable: true, draw: { kind: 'button', primary: !u.following }, onTap: () => { u.following = !u.following; } });
    add({ bounds: [545, y, 1040, y + 90], cls: 'android.widget.Button', text: 'Message', id: rid('button_container_message'), clickable: true, draw: { kind: 'button' }, onTap: () => this.openThread(u.u) });
    y += 120;
    if (u.private) {
      add({ bounds: [40, y + 120, 1040, y + 200], cls: 'android.widget.TextView', text: 'Ce compte est privé', draw: { kind: 'text', size: 44, weight: 700, align: 'middle' } });
      add({ bounds: [40, y + 210, 1040, y + 270], cls: 'android.widget.TextView', text: 'Suivez ce compte pour voir ses photos et vidéos.', draw: { kind: 'text', size: 34, muted: true, align: 'middle' } });
      return;
    }
    add({ bounds: [0, y, W, y + 80], cls: 'android.widget.ImageView', desc: 'Grille', draw: { kind: 'tab', active: true, icon: true } });
    this.grid(add, s.posts, y + 84, (i) => this.push({ type: 'feed', posts: s.posts.slice(i), scroll: 0 }));
  }

  layoutThread(s, add) {
    const t = this.threads.get(s.user);
    this.topBar(add, s.user, { idTitle: 'thread_title' });
    let y = 300;
    for (const m of t.messages.slice(-12)) {
      const lines = wrap(m.text, 30);
      const h = lines.length * 48 + 40;
      const w = Math.min(760, Math.max(...lines.map((l) => l.length)) * 21 + 70);
      const x1 = m.me ? W - 40 - w : 40;
      add({ bounds: [x1, y, x1 + w, y + h], cls: 'android.widget.TextView', text: m.text, id: rid('direct_text_message_text_view'), draw: { kind: 'bubble', me: m.me, lines } });
      y += h + 20;
    }
    add({ bounds: [30, 2120, t.draft ? 860 : 1050, 2240], cls: 'android.widget.EditText', text: t.draft || 'Message…', id: rid('row_thread_composer_edittext'), clickable: true, focused: t.focused, draw: { kind: 'input', placeholder: !t.draft }, onTap: () => { t.focused = true; } });
    if (t.draft) add({ bounds: [880, 2130, 1050, 2230], cls: 'android.widget.TextView', text: 'Envoyer', id: rid('row_thread_composer_send_button_container'), clickable: true, draw: { kind: 'send' }, onTap: () => { t.messages.push({ me: true, text: t.draft }); this.sent.push({ to: s.user, text: t.draft }); t.draft = ''; } });
  }

  layoutDialog(add) {
    add({ bounds: [0, 0, W, H], draw: { kind: 'scrim' } });
    add({ bounds: [90, 860, 990, 1520], draw: { kind: 'dialog' } });
    add({ bounds: [140, 920, 940, 1000], cls: 'android.widget.TextView', text: 'Réessayez plus tard', id: rid('igds_alert_dialog_headline'), draw: { kind: 'text', size: 46, weight: 700, align: 'middle' } });
    add({ bounds: [140, 1010, 940, 1320], cls: 'android.widget.TextView', text: 'Nous limitons la fréquence de certaines actions sur Instagram pour protéger notre communauté.', id: rid('igds_alert_dialog_subtext'), draw: { kind: 'text', size: 34, muted: true, align: 'middle', lines: wrap('Nous limitons la fréquence de certaines actions sur Instagram pour protéger notre communauté.', 40) } });
    add({ bounds: [90, 1400, 990, 1520], cls: 'android.widget.Button', text: 'OK', id: rid('igds_alert_dialog_primary_button'), clickable: true, draw: { kind: 'dialogBtn' }, onTap: () => { this.dialog = null; } });
  }

  tapLike(p) {
    if (this.opts.blockAfter && this.likesRegistered >= this.opts.blockAfter && !p.liked) {
      this.dialog = { kind: 'feedback' };
      return;
    }
    if (!p.liked && Math.random() < this.opts.missRate) return; // le tap « ne prend pas »
    p.liked = !p.liked;
    if (p.liked) this.likesRegistered++;
  }

  // --- Sorties ------------------------------------------------------------

  toXml(nodes) {
    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\n/g, '&#10;');
    const body = nodes.map((n, i) => `<node index="${i}" text="${esc(n.text)}" resource-id="${n.id}" class="${n.cls}" package="${PKG}" content-desc="${esc(n.desc)}" checkable="false" checked="false" clickable="${n.clickable}" enabled="true" focusable="${n.clickable}" focused="${n.focused}" scrollable="${!!n.scrollable}" long-clickable="false" password="false" selected="${n.selected}" bounds="[${n.bounds[0]},${n.bounds[1]}][${n.bounds[2]},${n.bounds[3]}]" />`).join('');
    return `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation="0"><node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="${PKG}" content-desc="" checkable="false" checked="false" clickable="false" enabled="true" focusable="false" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[0,0][${W},${H}]">${body}</node></hierarchy>`;
  }

  toSvg(nodes) {
    return renderSvg(nodes);
  }
}

function hueHex(h, s = 0.55, l = 0.45) {
  const f = (n) => {
    const k = (n + h / 30) % 12;
    const c = l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function wrap(text, n) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > n && cur) { lines.push(cur); cur = w; } else cur = (cur + ' ' + w).trim();
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

// --- Rendu SVG (aperçu fidèle, rasterisé par Electron) -----------------------

const ICONS = {
  back: '<path d="M15 5l-7 7 7 7"/>',
  home: '<path d="M3.5 10.5L12 3.5l8.5 7V20.5h-6v-6h-5v6h-6z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  reels: '<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M3.5 8.5h17M9 3.5l2.5 5M14.5 3.5l2.5 5M10.5 12v5l4-2.5z"/>',
  shop: '<path d="M5 8h14l-1 12.5H6z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/>',
  profile: '<circle cx="12" cy="8.5" r="4"/><path d="M4 20.5c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5"/>',
  comment: '<path d="M20.5 11.5a8.5 8.5 0 0 1-12.4 7.6L3.5 20.5l1.4-4.4A8.5 8.5 0 1 1 20.5 11.5z"/>',
  share: '<path d="M21 3L10 14M21 3l-7 18-4-7-7-4z"/>',
  save: '<path d="M6 3.5h12v17l-6-5-6 5z"/>',
};
const HEART = 'M12 20s-7.5-4.6-8.9-9.2C2.2 7.6 4.3 4.5 7.6 4.5c1.9 0 3.4 1 4.4 2.6 1-1.6 2.5-2.6 4.4-2.6 3.3 0 5.4 3.1 4.5 6.3C19.5 15.4 12 20 12 20z';
const xesc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function icon(paths, [x1, y1, x2, y2], size = 72, extra = '') {
  const s = size / 24;
  const cx = (x1 + x2) / 2 - size / 2;
  const cy = (y1 + y2) / 2 - size / 2;
  return `<g transform="translate(${cx},${cy}) scale(${s})" fill="none" stroke="#f5f5f5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${extra}>${paths}</g>`;
}

function renderSvg(nodes) {
  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Segoe UI, Roboto, Helvetica, Arial, sans-serif"><rect width="${W}" height="${H}" fill="#000"/>`);
  for (const n of nodes) {
    const d = n.draw;
    if (!d) continue;
    const [x1, y1, x2, y2] = n.bounds;
    const raw = n.raw || n.bounds;
    switch (d.kind) {
      case 'status':
        parts.push(`<text x="60" y="52" fill="#f5f5f5" font-size="34" font-weight="600">14:32</text><rect x="930" y="26" width="80" height="34" rx="8" fill="none" stroke="#f5f5f5" stroke-width="3"/><rect x="936" y="32" width="52" height="22" rx="4" fill="#f5f5f5"/>`);
        break;
      case 'bar':
        if (d.top) parts.push(`<rect x="0" y="${y1}" width="${W}" height="2" fill="#262626"/>`);
        break;
      case 'icon':
        parts.push(icon(ICONS[d.icon] || '', n.bounds, d.icon === 'back' ? 64 : 66));
        break;
      case 'heart':
        parts.push(icon(`<path d="${HEART}"/>`, raw, 70, n.selected ? 'fill="#ff3040" stroke="#ff3040"' : ''));
        break;
      case 'avatar': {
        const r = Math.min(x2 - x1, y2 - y1) / 2;
        const cx = (x1 + x2) / 2, cy = (raw[1] + raw[3]) / 2;
        parts.push(d.square
          ? `<rect x="${x1}" y="${y1}" width="${x2 - x1}" height="${y2 - y1}" rx="24" fill="hsl(${d.hue},60%,42%)"/>`
          : `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="url(#g)" stroke-width="5"/><circle cx="${cx}" cy="${cy}" r="${r - 8}" fill="hsl(${d.hue},55%,48%)"/>`);
        break;
      }
      case 'image': {
        const [rx1, ry1, rx2, ry2] = raw;
        const id = `i${n.bounds.join('_')}`;
        parts.push(`<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${d.hue},60%,55%)"/><stop offset="1" stop-color="hsl(${(d.hue + 50) % 360},55%,28%)"/></linearGradient><clipPath id="c${id}"><rect x="${x1}" y="${y1}" width="${x2 - x1}" height="${y2 - y1}"/></clipPath></defs>`);
        parts.push(`<g clip-path="url(#c${id})"><rect x="${rx1}" y="${ry1}" width="${rx2 - rx1}" height="${ry2 - ry1}" fill="url(#${id})"/><circle cx="${rx1 + (rx2 - rx1) * 0.7}" cy="${ry1 + (ry2 - ry1) * 0.3}" r="${(rx2 - rx1) * 0.11}" fill="rgba(255,255,255,.55)"/><path d="M${rx1} ${ry2} L${rx1 + (rx2 - rx1) * 0.38} ${ry1 + (ry2 - ry1) * 0.55} L${rx1 + (rx2 - rx1) * 0.62} ${ry1 + (ry2 - ry1) * 0.78} L${rx1 + (rx2 - rx1) * 0.78} ${ry1 + (ry2 - ry1) * 0.62} L${rx2} ${ry2} Z" fill="rgba(0,0,0,.28)"/></g>`);
        break;
      }
      case 'text': {
        const size = d.size || 36;
        const fill = d.link ? '#e0f1ff' : d.muted ? '#a8a8a8' : '#f5f5f5';
        const anchor = d.align === 'middle' ? 'middle' : 'start';
        const tx = anchor === 'middle' ? (x1 + x2) / 2 : x1;
        const lines = d.lines || wrap(n.text, Math.floor(((x2 - x1) / size) * 1.9));
        const visible = (ly) => ly > y1 && ly < y2 + size * 0.3;
        lines.forEach((l, i) => {
          const ly = (n.raw || n.bounds)[1] + size * 1.05 + i * size * 1.32;
          if (!visible(ly)) return;
          let content = xesc(l);
          if (d.bold && i === 0 && l.startsWith(d.bold)) content = `<tspan font-weight="700">${xesc(d.bold)}</tspan>${xesc(l.slice(d.bold.length))}`;
          parts.push(`<text x="${tx}" y="${ly}" fill="${fill}" font-size="${size}" font-weight="${d.weight || 400}" text-anchor="${anchor}" ${d.font === 'logo' ? 'font-style="italic" font-family="Georgia, serif"' : ''}>${content}</text>`);
        });
        break;
      }
      case 'tab':
        parts.push(`<rect x="${x1}" y="${y2 - 4}" width="${x2 - x1}" height="4" fill="${d.active ? '#f5f5f5' : '#262626'}"/>`);
        if (d.icon) parts.push(icon('<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 9.5h16M4 14.5h16M9.5 4v16M14.5 4v16"/>', n.bounds, 56));
        else parts.push(`<text x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 + 13}" fill="${d.active ? '#f5f5f5' : '#a8a8a8'}" font-size="36" font-weight="600" text-anchor="middle">${xesc(n.text)}</text>`);
        break;
      case 'button':
        parts.push(`<rect x="${x1}" y="${y1}" width="${x2 - x1}" height="${y2 - y1}" rx="20" fill="${d.primary ? '#0095f6' : '#363636'}"/><text x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 + 13}" fill="#fff" font-size="38" font-weight="600" text-anchor="middle">${xesc(n.text)}</text>`);
        break;
      case 'bubble':
        parts.push(`<rect x="${x1}" y="${y1}" width="${x2 - x1}" height="${y2 - y1}" rx="40" fill="${d.me ? '#3797f0' : '#262626'}"/>`);
        d.lines.forEach((l, i) => parts.push(`<text x="${x1 + 35}" y="${y1 + 62 + i * 48}" fill="#fff" font-size="36">${xesc(l)}</text>`));
        break;
      case 'input':
        parts.push(`<rect x="${x1}" y="${y1}" width="${x2 - x1}" height="${y2 - y1}" rx="60" fill="#262626"${n.focused ? ' stroke="#0095f6" stroke-width="3"' : ''}/><text x="${x1 + 50}" y="${(y1 + y2) / 2 + 13}" fill="${d.placeholder ? '#a8a8a8' : '#f5f5f5'}" font-size="38">${xesc(n.text.length > 34 ? '…' + n.text.slice(-33) : n.text)}</text>`);
        break;
      case 'send':
        parts.push(`<text x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 + 13}" fill="#0095f6" font-size="38" font-weight="700" text-anchor="middle">Envoyer</text>`);
        break;
      case 'scrim':
        parts.push(`<rect width="${W}" height="${H}" fill="rgba(0,0,0,.65)"/>`);
        break;
      case 'dialog':
        parts.push(`<rect x="${x1}" y="${y1}" width="${x2 - x1}" height="${y2 - y1}" rx="40" fill="#262626"/>`);
        break;
      case 'dialogBtn':
        parts.push(`<rect x="${x1}" y="${y1}" width="${x2 - x1}" height="2" fill="#363636"/><text x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 + 14}" fill="#0095f6" font-size="40" font-weight="700" text-anchor="middle">OK</text>`);
        break;
      default:
    }
  }
  parts.push('<defs><linearGradient id="g" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#feda75"/><stop offset=".35" stop-color="#fa7e1e"/><stop offset=".6" stop-color="#d62976"/><stop offset=".85" stop-color="#962fbf"/><stop offset="1" stop-color="#4f5bd5"/></linearGradient></defs></svg>');
  return parts.join('');
}
