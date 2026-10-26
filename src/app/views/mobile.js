// Vue Insta mobile : instagram.com en version mobile (stories, reels, posts depuis le PC).

import { $ } from '../ui.js';
import { createPhone } from '../phone.js';

let phone;

const PATHS = { home: '/', explore: '/explore/', create: '/create/select/', reels: '/reels/', profile: '/accounts/edit/' };

export default {
  async mount(el) {
    el.innerHTML = `
      <div class="view-head"><div><h1>Insta mobile</h1><p class="muted">L’app mobile d’Instagram dans ton navigateur : publie stories, reels et posts depuis ton ordinateur.</p></div></div>
      <div class="phone-wrap">
        <div id="m-phone"></div>
        <div class="side-panel stack">
          <div class="card">
            <h2>Publier une story ou un reel</h2>
            <ol style="padding-left:18px;margin:0">
              <li>Prépare ton média (Publication → « Publier via Insta mobile » enregistre tes fichiers et copie la légende).</li>
              <li>Appuie sur <strong><i data-i="plusCircle" data-s="16"></i></strong> (en bas ou en haut du téléphone) puis choisis <em>Post</em>, <em>Story</em> ou <em>Reel</em>.</li>
              <li>Sélectionne le fichier, colle la légende (Ctrl+V), publie.</li>
            </ol>
          </div>
          <div class="card">
            <h2>Astuces</h2>
            <ul style="padding-left:18px;margin:0">
              <li>Tu es connecté avec la même session que instagram.com dans ce navigateur.</li>
              <li>Si une page s’affiche en version desktop, clique sur <i data-i="refresh" data-s="14"></i>.</li>
              <li>Le bouton <i data-i="chevronLeft" data-s="14"></i> revient à la page précédente dans le téléphone.</li>
            </ul>
          </div>
        </div>
      </div>`;
    phone = createPhone($('#m-phone', el), '/', [['Accueil', '/'], ['Explorer', '/explore/'], ['Créer', '/create/select/'], ['Reels', '/reels/']]);
  },
  show([page]) {
    if (page && PATHS[page]) phone.go(PATHS[page]);
  },
};
