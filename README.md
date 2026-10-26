# InstaGrowth — extension Chrome Instagram Pro (inspirée d'Inssist)

Instagram sur desktop : DM, publication avancée et programmation, statistiques avec revue IA,
génération de leads, auto-like quotidien prudent. L'IA passe par Claude, OpenRouter (modèles gratuits) ou n'importe quel endpoint compatible OpenAI.

## Installation

### Depuis une release (le plus simple)

1. Télécharge `instagrowth-vX.Y.Z.zip` dans la [dernière release](../../releases/latest) et décompresse-le dans un dossier.
2. Ouvre `chrome://extensions` (ou `edge://extensions`), active le **Mode développeur**.
3. Clique sur **Charger l'extension non empaquetée** et sélectionne le dossier décompressé.

### Depuis les sources (mode développeur)

1. Ouvre `chrome://extensions` (ou `edge://extensions`).
2. Active le **Mode développeur**.
3. Clique sur **Charger l'extension non empaquetée** et sélectionne ce dossier (`INSTAGROWTH`).
4. Connecte-toi à Instagram sur https://www.instagram.com dans le même navigateur.
5. La page **Réglages & IA** s'ouvre : choisis ton fournisseur d'IA et remplis ton profil de marque.

Il n'y a aucune étape de build : JavaScript natif (modules ES) et aucune dépendance.

## Fonctionnalités

| Onglet | Ce qu'il fait |
|---|---|
| 📊 **Statistiques** | Taux d'engagement comparé à des repères par taille de compte, likes/commentaires moyens, rythme de publication, croissance (un snapshot par jour), engagement par jour, heure, format et longueur de légende, hashtags, top posts. **Revue IA** : note, forces, faiblesses, plan sur 30 jours, idées de posts. Fonctionne aussi sur un compte concurrent public. |
| 🗓️ **Publication** | Photos, carrousels (10 max) et vidéos ; recadrage 1:1, 4:5, 1.91:1 ou original ; réordonnancement par glisser-déposer ; compteurs (2200 caractères, 30 hashtags) ; aperçu fidèle ; 1er commentaire ; brouillons ; **calendrier éditorial** ; suggestion du meilleur créneau d'après tes stats. IA : 3 légendes selon un brief, réécritures (améliorer, raccourcir, CTA, emojis, traduction), hashtags sur 3 niveaux avec leur volume réel, sets de hashtags enregistrés. |
| 💬 **Messages** | Tes DM Instagram dans un cadre mobile, réponses rapides (modèles), assistant IA qui propose 3 réponses et les insère dans la conversation. |
| 🎯 **Leads** | Recherche par hashtag, abonnés d'un concurrent, likers d'un post ou import d'une liste ; filtres (abonnés, mots-clés dans la bio, exclusions, comptes pro, email ou téléphone) ; extraction des contacts ; mini-CRM (Nouveau → Liké → Chaud 🔥 → Contacté → A répondu → Gagné/Perdu) ; scoring IA ; message d'approche IA personnalisé ; notes ; export CSV ; bouton **＋ Lead** directement sur les profils instagram.com. |
| ❤️ **Auto-like** | Like quotidien des posts de ton audience cible (hashtags et abonnés de concurrents). Chaque compte liké devient un lead, puis on vérifie chaque jour s'il t'a suivi en retour (il passe alors en lead **chaud** et tu reçois une notification). |
| 📱 **Insta mobile** | L'interface mobile d'Instagram dans le navigateur, comme Inssist, pour publier stories et reels depuis le PC. |

## Intégration native dans instagram.com

InstaGrowth s'intègre directement dans l'interface d'Instagram, en clonant les éléments natifs pour en reprendre le style exact (thème clair ou sombre, sans bordures) :

- **Navigation latérale** : une entrée « InstaGrowth » sous « Découvrir », qui ouvre un menu (Statistiques, Programmer un post, Leads, Auto-like, Réglages).
- **Ton profil** : un bouton bleu « InstaGrowth » à côté de « Modifier le profil », avec le même menu.
- **Les autres profils** : les boutons « Analyser » (stats et revue IA du compte) et « Lead » à côté de « Suivre » et « Message ».
- **Publications** : une icône IA dans la barre J'aime / Commenter / Partager, qui propose 3 commentaires et les insère dans le champ de commentaire.
- **Messages privés** : une icône IA dans la zone de saisie, qui lit les derniers messages et propose 3 réponses.

Chaque outil s'ouvre dans une fenêtre au style d'Instagram, par-dessus le site (le dashboard en mode intégré). Le dashboard complet reste disponible dans son propre onglet.
Le code se trouve dans `src/content/inject/` (`nav.js`, `profile.js`, `post.js`, `dm.js`, `panel.js`). Les icônes SVG partagées sont dans `src/lib/icons.js`.

## Publications récentes

Dans **Statistiques**, le tableau **Publications récentes** liste tes dernières publications : date, format, j'aime, commentaires, vues, taux d'engagement et écart par rapport à ta moyenne. Tu peux les trier (Récentes / Top / Flops), passer en vue grille, et ouvrir l'analyse IA de chacune.

Pour récupérer ces publications, l'extension essaie d'abord l'API web d'Instagram. Si elle est limitée, elle se rabat sur les publications que les pages Instagram chargent elles-mêmes (`src/content/ig-capture.js`, sans aucune requête en plus). En dernier recours, elle ouvre ton profil dans un onglet d'arrière-plan le temps de les lire.

## Analyse d'un post existant

Tu peux analyser n'importe quel post (le tien ou celui d'un concurrent) :
- dans **Statistiques**, en cliquant sur un post de la grille (tri Top / Récents / Flops) ou sur **Analyser un post** pour coller un lien ;
- sur Instagram, depuis le bouton IA d'une publication (**Analyser ce post**) ou le bouton **Analyser** qui apparaît au survol des miniatures de ton profil.

Tu obtiens les chiffres du post comparés à la moyenne de tes 12 derniers posts, puis un diagnostic IA : note, raisons de la performance, critique de l'accroche, hashtags et horaire, 3 légendes réécrites et des idées pour recycler le post.

## Suivi de l'auto-like

L'onglet **Auto-like** a quatre vues : **Vue d'ensemble** (statut en direct, derniers comptes likés, prochaines cibles), **Comptes likés** (liste détaillée filtrable : abonnés, post liké, source, date, follow-back, statut de lead, export CSV), **Réglages** et **Journal**.
Le bouton **Liker maintenant** lance un passage immédiat, hors plage horaire mais dans le respect des plafonds.

## Automatisations d'auto-like

Dans **Auto-like → Automatisations**, chaque règle s'active séparément et ajoute des cibles **prioritaires** dans la file. Ces cibles passent par les mêmes plafonds, délais, plage horaire et jours actifs que le reste :
- **Liker mes nouveaux abonnés** : like la dernière publication de chaque nouvel abonné.
- **Rendre les likes** : like une publication des personnes qui ont liké ta dernière publication.
- **Comptes VIP** : like chaque nouvelle publication des comptes de ta liste.
- **Entretenir mes leads** : like régulièrement les publications de tes leads chauds ou contactés.

Les règles tournent toutes les 30 minutes ; le bouton **Lancer maintenant** déclenche une règle tout de suite. Les **jours actifs** se règlent dans Auto-like → Réglages.

Si l'adresse de like d'Instagram change (erreur 404), l'extension essaie d'autres routes connues. Si aucune ne marche, elle ouvre la publication dans un onglet épinglé d'arrière-plan et clique sur le vrai bouton « J'aime ».

## IA : connexion

- **Claude (Anthropic)** : bouton **Se connecter avec Claude** dans Réglages. La console Claude (platform.claude.com) s'ouvre ; tu crées une clé, puis tu cliques sur **Connecter à InstaGrowth** dans la carte qui s'affiche. La clé est vérifiée auprès d'Anthropic, l'onglet se ferme et tu reviens à InstaGrowth. Tu peux aussi coller une clé, ou un **jeton OAuth** (Bearer), dans « Options avancées ».
  Anthropic ne propose pas de bouton « Se connecter avec Claude » pour les applications tierces. Le mode OAuth prend donc
  un jeton d'accès court obtenu avec la CLI `ant` (`ant auth login` puis `ant auth print-credentials --access-token`).
  Modèle par défaut : `claude-opus-5-5`. Sonnet 5.5, Haiku 5.5 et Fable 5.1 sont aussi disponibles.
- **OpenRouter** : vraie connexion **OAuth PKCE en un clic** (`chrome.identity`), avec la liste des modèles gratuits (`:free`) chargée en direct.
- **Compatible OpenAI** : Ollama ou LM Studio en local, Groq, Mistral… L'autorisation d'accès à l'hôte est demandée à l'enregistrement.

Les clés restent dans `chrome.storage.local` et ne sont envoyées qu'au fournisseur choisi.

## Limites et sécurité du compte

Instagram **n'a aucune API officielle pour liker** ni pour lire les hashtags ou les abonnés : l'API Graph de Meta ne le permet pas.
L'extension utilise donc l'**API web** d'instagram.com avec ta session, comme le font Inssist et les outils du même type. Garde-fous en place :

- Plafonds durs, non modifiables depuis l'interface : **200 likes/jour, 40/heure, 30 s minimum entre deux likes, 180 lectures/heure** (`src/lib/limits.js`).
- Préréglages : Prudent (60/j), Normal (100/j), Actif (150/j). **Warm-up** sur 7 jours (20 → 100).
- Délais aléatoires, « pauses café » aléatoires, plage horaire active, ordre des cibles mélangé, un seul like par personne sur 30 jours.
- **Arrêt automatique** dès qu'Instagram envoie un signal : 429 (pause de 2 h), `feedback_required` ou action bloquée (24 h), checkpoint (48 h).
- Les DM ne sont **jamais envoyés automatiquement** : l'IA rédige, tu envoies.

> ⚠️ L'automatisation va à l'encontre des conditions d'utilisation d'Instagram et peut entraîner un blocage temporaire, voire une suspension. Utilise-la avec modération ; tu restes responsable de ton compte.

La **publication automatique** des posts programmés (photos et carrousels) passe par l'API web d'upload. Elle est expérimentale et désactivée par défaut :
le mode « rappel » envoie une notification à l'heure prévue. Les vidéos et les reels se publient depuis **Insta mobile**.

## Architecture

```
manifest.json                  MV3
src/background.js              service worker : règles DNR, routeur de messages, moteur d'auto-like,
                               recherche de leads, follow-backs, snapshots quotidiens, alarmes de publication
src/lib/ig.js                  client de l'API web Instagram (tous les endpoints non officiels sont ici)
src/lib/ai.js                  Claude / OpenRouter (OAuth PKCE) / compatible OpenAI
src/lib/stats.js               calcul des statistiques et diagnostics locaux
src/lib/limits.js              quotas et pauses
src/lib/store.js, db.js        chrome.storage (réglages) + IndexedDB (leads, posts et médias)
src/app/                       dashboard (une vue par onglet dans views/)
src/popup/                     popup de l'icône
src/content/ig-mobile.js       (monde MAIN) se fait passer pour un iPhone dans le cadre « téléphone »
src/content/ig-ui.js           pont réseau (requêtes API depuis instagram.com) + chargeur de l'intégration
src/content/inject/            intégration native : navigation, profil, posts, DM, fenêtre modale
src/lib/icons.js               jeu d'icônes SVG
```

Points techniques :
- Les appels à l'API Instagram sont **exécutés par le content script d'un onglet instagram.com**, donc depuis la même origine, avec les mêmes cookies et en-têtes que le site. Le service worker ne fait que les lui transmettre. S'il n'y a aucun onglet Instagram ouvert, un onglet épinglé est ouvert en arrière-plan.
- Le cadre mobile ne retire `X-Frame-Options`/CSP et ne force un User-Agent iPhone **que pour l'onglet du dashboard**, avec des règles de session propres à cet onglet.
- L'auto-like tourne sur `chrome.alarms` (une vérification par minute) : il continue tant que le navigateur est ouvert, même si le dashboard est fermé.

## Maintenance

Instagram modifie régulièrement son API web. Si une fonction ne marche plus (stats, hashtags, like…), les endpoints à mettre à jour se trouvent tous dans `src/lib/ig.js`.
