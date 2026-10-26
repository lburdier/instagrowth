# InstaGrowth Desktop

Application Windows qui pilote **l'app Instagram de ton téléphone Android**, branché en USB, grâce au débogage USB (ADB). Elle complète l'extension Chrome InstaGrowth.

- **Bot** : ouvrir un profil ou un hashtag, lire une bio, liker des publications, préparer un message privé.
- **Agent Claude** : tu décris une mission en une phrase. Claude voit l'écran du téléphone (capture + arbre de l'interface) et choisit lui-même les gestes : toucher, faire défiler, taper, revenir.
- **Écran en direct** : l'écran du téléphone s'affiche dans l'app. Il peut aussi servir de télécommande (mode manuel), et un miroir scrcpy est disponible s'il est installé.
- **Sécurité** : limites prudentes (les mêmes que l'extension), likes vérifiés à l'écran, DM jamais envoyés sans ta confirmation, bouton **Arrêt immédiat** et raccourci global <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>X</kbd>.

## À lire d'abord : USB ne veut pas dire « moins de limites »

Le débogage USB ne donne **pas** plus de marge vis-à-vis d'Instagram. Instagram compte les likes, les abonnements et les messages **sur ses serveurs, par compte**, que l'action vienne d'un téléphone, d'un PC ou d'un robot.

Piloter la vraie app Android a l'air plus naturel qu'un robot sur le site web : mêmes écrans, mêmes gestes, pas d'API non officielle. Mais un rythme trop rapide mène quand même à des « Réessayez plus tard », puis à des blocages plus longs, voire à la fermeture du compte. C'est pourquoi l'app garde :

| Garde-fou | Valeur |
|---|---|
| Plafond journalier (préréglage Prudent / Normal / Actif) | 60 / 100 / 150 likes, jamais plus de 200 |
| Plafond horaire | 15 / 22 / 30, jamais plus de 40 |
| Délai entre deux likes | aléatoire, 30 s minimum (60 à 180 s en Prudent) |
| Montée progressive les 7 premiers jours | 20, 30, 40, 55, 70, 85, 100 likes |
| Pauses café aléatoires | 8 % de chances, de 8 à 25 min |
| « Réessayez plus tard » détecté | tout s'arrête 24 h |
| Vérification de compte détectée | tout s'arrête 48 h |
| 3 likes non confirmés d'affilée | pause de 2 h |
| DM envoyés (toujours confirmés à la main) | 30 par jour maximum |

Un like n'est compté que si l'app voit le cœur passer au rouge en relisant l'écran. Aucun succès n'est simulé.

## Installation (Windows 10 / 11)

### 1. Node.js

Installe [Node.js](https://nodejs.org) en version LTS (20 ou plus récente).

### 2. ADB (Android SDK Platform-Tools)

1. Télécharge les [Android SDK Platform-Tools pour Windows](https://developer.android.com/tools/releases/platform-tools), le zip officiel de Google.
2. Dézippe-le dans `C:\platform-tools`. L'app le trouve automatiquement à cet endroit, dans le `PATH`, dans le SDK Android ou dans `Téléchargements\platform-tools`.
3. Sinon, indique le chemin de `adb.exe` dans **Réglages → Outils Android**.

Facultatif : [scrcpy](https://github.com/Genymobile/scrcpy) pour un miroir vidéo fluide du téléphone (bouton dédié sous l'écran).

### 3. Activer le débogage USB sur le téléphone

1. **Paramètres → À propos du téléphone** : touche **7 fois « Numéro de build »**. Le téléphone annonce que tu es développeur.
2. **Paramètres → Système → Options pour les développeurs** : active **Débogage USB**.
   - Xiaomi / Redmi / POCO : active aussi **Débogage USB (paramètres de sécurité)**, sinon les taps sont ignorés.
3. Branche le téléphone avec un **câble de données**. Si le téléphone demande le mode USB, choisis **Transfert de fichiers**.
4. Accepte **« Autoriser le débogage USB ? »** sur le téléphone, et coche **Toujours autoriser depuis cet ordinateur**.
5. Ouvre Instagram, connecte-toi, et laisse l'écran déverrouillé pendant que le bot travaille.

Pour garder les accents et les emoji dans les messages, installe le clavier [ADB Keyboard](https://github.com/senzhk/ADBKeyBoard) et choisis-le comme clavier actif. Sans lui, `adb input text` ne sait taper que des caractères sans accent : l'app retire alors les accents et te le signale.

### 4. Lancer l'app

```bash
cd desktop
npm install
npm start
```

Pour tout essayer sans téléphone, utilise le téléphone simulé : un faux Instagram où rien n'est envoyé, avec des compteurs séparés de ceux du vrai compte.

```bash
npm run sim
```

## Obtenir le .exe (installeur Windows)

```bash
cd desktop
npm install
npm run dist
```

Le fichier `dist/InstaGrowth-Desktop-Setup-<version>.exe` est l'installeur. Double-clique dessus : il installe l'app pour ton compte Windows (dans `%LOCALAPPDATA%\Programs`, sans droits administrateur) et crée les raccourcis Bureau et menu Démarrer. Le dossier `dist/win-unpacked/` contient aussi une version qui se lance sans installation (`InstaGrowth Desktop.exe`), mais elle ne peut pas se mettre à jour toute seule.

L'exe n'est pas signé. Au premier lancement, Windows SmartScreen peut afficher « Windows a protégé votre ordinateur » : clique sur **Informations complémentaires**, puis **Exécuter quand même**. Pour supprimer cet avertissement, il faudrait un certificat de signature de code.

## Mises à jour

L'app installée vérifie les nouvelles versions au démarrage, puis toutes les 6 heures. Tu peux aussi lancer la vérification à la main dans **Réglages → Version et mises à jour**. Quand une version plus récente existe, un bandeau bleu propose :

1. **Mettre à jour** : télécharge l'installeur. Son empreinte SHA-512 est vérifiée avant toute installation.
2. **Redémarrer et installer** : l'app se ferme, installe la nouvelle version et se relance. Tes réglages, clés et compteurs sont conservés.

Rien ne se télécharge ni ne s'installe sans ton clic. « Plus tard » masque le bandeau jusqu'au prochain démarrage.

Les versions de l'app desktop sont publiées dans les releases GitHub du dépôt sous le tag `desktop-vX.Y.Z`. Les releases `vX.Y.Z` sont celles de l'extension, et l'app les ignore. Pour publier une nouvelle version :

1. Monte `"version"` dans `desktop/package.json` (par exemple `0.2.0`), puis commite.
2. Lance `npm run dist`, puis pousse la branche (`git push`) : le tag de la release pointera sur ce commit.
3. Lance `npm run release -- "Nouveautés de la version"`. Il faut le CLI `gh` connecté à GitHub. La commande crée la release `desktop-v0.2.0`, sans la marquer « Latest », avec l'installeur, son `.blockmap` et `latest.yml`.

Les apps déjà installées proposeront la mise à jour à leur prochaine vérification.

## Mode Claude

1. **Réglages → Intelligence artificielle** : colle ta clé `sk-ant-…` (à créer sur [platform.claude.com](https://platform.claude.com/settings/keys)), ou connecte **OpenRouter** (bouton de connexion, ou clé `sk-or-…`).
2. Le modèle par défaut est **Claude Opus 5.5** (`claude-opus-5-5`), avec un effort « moyen » réglable. Sonnet 5.5, Haiku 5.5 et Fable 5.1 sont aussi proposés.
3. Onglet **Agent Claude** : écris la mission, puis **Lancer l'agent**. Chaque étape (réflexion, action, résultat) s'affiche, avec la consommation de jetons.

Ce que Claude a le droit de faire, et ce qui lui est refusé :

- Il touche, fait défiler, tape du texte, revient en arrière, ouvre des profils et des hashtags.
- Pour liker, il doit passer par l'outil `like_post` : mêmes limites et même vérification que le bot. S'il touche directement le cœur, l'action est refusée.
- Pour un message, il doit passer par `prepare_dm`, qui tape le texte **sans l'envoyer**. Toucher « Envoyer » lui est refusé, tout comme « Suivre » et la publication d'un commentaire.
- Si Instagram affiche une alerte, il s'arrête et la décrit.

Côté technique : boucle d'agent avec le SDK officiel `@anthropic-ai/sdk` et des outils stricts. La capture d'écran est envoyée en image, réduite à 720 px de large, avec l'arbre UI compact. L'agent utilise la réflexion adaptative, le repli serveur (`fallbacks: "default"`), le cache de prompt et le nettoyage des anciens résultats d'outils côté serveur. L'historique reste en ajout seul. Avec OpenRouter, le format compatible OpenAI est utilisé : choisis un modèle qui accepte les images **et** les outils (bouton « Lister »).

## Envoyer un message préparé

Quand un DM est prêt, un bandeau vert apparaît en haut de l'app avec le texte exact. **Envoyer…** ouvre une confirmation Windows. Une fois confirmé, l'app vérifie encore que le même texte est toujours dans le champ, touche « Envoyer », puis vérifie que la bulle apparaît dans la conversation.

## Tests

```bash
npm run selftest
```

Le test de bout en bout tourne sans téléphone, avec le simulateur et un faux serveur de l'API Claude (`scripts/mock-claude.mjs`). Il vérifie :

- la lecture de l'arbre UI ;
- les limites ;
- les likes vérifiés, et les likes non confirmés qui ne sont pas comptés ;
- la détection de « Réessayez plus tard » ;
- les DM jamais envoyés sans confirmation ;
- l'arrêt immédiat ;
- l'agent Claude : forme des requêtes, historique en ajout seul, taps interdits refusés ;
- la réponse de l'ADB réel (« aucun appareil » si rien n'est branché).

## Organisation du code

```
desktop/
  src/core/      moteur, sans interface (testable en ligne de commande)
    adb.js        adb.exe : appareils, capture, arbre UI, tap, swipe, saisie, liens
    uitree.js     lecture du XML uiautomator, sélecteurs, arbre compact pour l'IA
    selectors.js  identifiants de l'app Instagram (à ajuster si Instagram change)
    bot.js        actions vérifiées : profil, bio, likes, DM préparés
    agent.js      boucle d'agent Claude / OpenRouter et ses outils
    limits.js     limites prudentes partagées par le bot et l'agent
    sim.js        téléphone simulé (faux Instagram)
    engine.js     orchestration, aperçu, arrêt immédiat
    store.js      réglages (clés chiffrées par Windows) et compteurs
    version.js    choix de la release desktop la plus récente
  src/main/      processus Electron (fenêtre, IPC, raccourci global, updater.js)
  src/renderer/  interface (HTML, CSS, JS, icônes SVG)
  scripts/       test de bout en bout, faux serveur Claude, icône, publication
  build/         icône de l'installeur
```

Les données (réglages, compteurs, historique des likes) sont dans `%APPDATA%\InstaGrowth Desktop`, avec un bouton pour ouvrir ce dossier dans Réglages.

## Pourquoi Electron + Node

- **Un seul prérequis** (Node.js) et **une seule commande** (`npm install`) : pas de Python, pas de compilation.
- **Une vraie fenêtre Windows**, avec icône et barre des tâches, et la même pile web que l'extension (même design, mêmes icônes).
- **Accès natif** à `adb.exe`, au coffre de Windows pour chiffrer les clés API (DPAPI via `safeStorage`) et aux raccourcis globaux pour l'arrêt d'urgence.

## Limites connues

- Instagram modifie parfois les identifiants de son interface. Si une action du bot ne trouve plus un bouton, mets à jour `src/core/selectors.js`. Le mode Claude lit l'écran et s'adapte sans ce fichier.
- `uiautomator dump` peut échouer pendant qu'une vidéo tourne. L'app réessaie trois fois, puis affiche une erreur claire.
- Un écran verrouillé par code ne peut pas être déverrouillé par l'app : c'est volontaire.
