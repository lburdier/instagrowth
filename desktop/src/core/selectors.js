// Comment retrouver les éléments de l'app Instagram Android dans l'arbre UI.
// Instagram change ses identifiants de temps en temps : chaque élément a donc
// plusieurs sélecteurs, du plus précis (resource-id) au plus large (libellé).
// Si une mise à jour d'Instagram casse une action, c'est ce fichier qu'il faut
// ajuster (le mode Claude, lui, lit l'écran et s'adapte tout seul).

export const IG_PACKAGE = 'com.instagram.android';

// Libellés du bouton « J'aime » avant / après le like (français et anglais).
export const LIKE_OFF = /^(j[’']aime|like)$/i;
export const LIKE_ON = /^(je n[’']aime plus|ne plus aimer|aimé|unlike|liked)$/i;

export const SEL = {
  likeButton: [
    { id: 'row_feed_button_like' },
    { desc: LIKE_OFF, clickable: true },
    { desc: LIKE_ON, clickable: true },
  ],
  postAuthor: [
    { id: ['row_feed_photo_profile_name', 'row_feed_photo_profile_name_container'] },
  ],
  postCaption: [{ id: ['row_feed_comment_textview_layout', 'row_feed_caption'] }],
  // Vignettes de la grille d'un profil ou d'un hashtag.
  gridItem: [
    { id: ['image_button', 'grid_card_layout_container', 'media_set_row_content_identifier'] , clickable: true },
    { desc: /(photo|vid[ée]o|reel|carrousel|carousel|publication|post).*(row|rang[ée]e|ligne|column|colonne)/i, clickable: true },
  ],
  profileUsername: [{ id: ['action_bar_title', 'action_bar_large_title', 'action_bar_username_container'] }],
  profileFullName: [{ id: ['profile_header_full_name', 'profile_header_full_name_above_vanity'] }],
  profileBio: [{ id: ['profile_header_bio_text', 'profile_user_info_compose_view_bio'] }],
  profileLink: [{ id: ['profile_header_website', 'profile_header_links_container'] }],
  profileCategory: [{ id: ['profile_header_business_category'] }],
  postsCount: [{ id: ['row_profile_header_textview_post_count', 'profile_header_post_count'] }],
  followersCount: [{ id: ['row_profile_header_textview_followers_count', 'profile_header_followers_count'] }],
  followingCount: [{ id: ['row_profile_header_textview_following_count', 'profile_header_following_count'] }],
  privateNotice: [{ label: /(ce compte est priv[ée]|this account is private)/i }],
  messageButton: [
    { id: ['button_container_message', 'profile_header_message_button'] },
    { label: /^(message|envoyer un message|écrire)$/i, clickable: true },
    { label: /^(message|envoyer un message|écrire)$/i },
  ],
  dmComposer: [
    { id: ['row_thread_composer_edittext', 'thread_composer_edittext'] },
    { cls: /EditText/, text: /^(|message…|message\.\.\.|votre message…|écrire un message…)$/i },
    { cls: /EditText/ },
  ],
  dmSend: [
    { id: ['row_thread_composer_send_button_container', 'row_thread_composer_button_send', 'composer_send_button'] },
    { label: /^(envoyer|send)$/i, clickable: true },
  ],
  dmThreadTitle: [{ id: ['thread_title', 'header_title', 'action_bar_title'] }],
  dmMessageText: [{ id: ['direct_text_message_text_view', 'message_text'] }],
  // Boutons que le mode agent n'a pas le droit de toucher directement.
  followButton: [{ label: /^(suivre|s[’']abonner|suivre en retour|follow|follow back)$/i }],
  commentPost: [{ id: ['layout_comment_thread_post_button', 'layout_comment_thread_post_button_click_area'] }, { label: /^(publier|post)$/i, clickable: true }],
};

// Signaux de blocage d'Instagram (affichés en boîte de dialogue dans l'app).
export const BLOCK_PATTERNS = {
  feedback: /(r[ée]essayez plus tard|try again later|action bloqu[ée]e|action blocked|nous limitons|we restrict certain activity|limitons la fr[ée]quence)/i,
  checkpoint: /(confirmez que c[’']est (bien )?vous|confirm it[’']s you|activit[ée] inhabituelle|suspicious|unusual activity|compte suspendu|account (has been )?suspended)/i,
};

export const LINKS = {
  profile: (u) => `https://www.instagram.com/${encodeURIComponent(u)}/`,
  hashtag: (t) => `https://www.instagram.com/explore/tags/${encodeURIComponent(t)}/`,
  dm: (u) => `https://ig.me/m/${encodeURIComponent(u)}`,
};

export const cleanUsername = (s) => String(s || '').trim().replace(/^@/, '').replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/[/?#].*$/, '').toLowerCase();
export const cleanTag = (s) => String(s || '').trim().replace(/^#/, '').replace(/\s+/g, '').toLowerCase();
