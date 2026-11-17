# Toc

Jeu de Toc en ligne, en application web progressive (PWA) : 2 contre 2 ou 3 joueurs chacun pour soi,
contre des amis ou contre l'IA, sur téléphone et ordinateur. HTML, CSS et JavaScript sans étape de build ;
Firebase (Authentication + Firestore) pour les parties en ligne. Même famille que l'appli Scrabble :
même direction artistique, comptes par simple nom d'utilisateur, réglages sur l'appareil.

Le cahier des charges d'origine est dans `docs/cahier-des-charges.md`. Les décisions prises depuis
avec le propriétaire sont résumées plus bas (« Règles : décisions »).

## Lancer en local

```
npm run serve        # sert public/ sur http://localhost:5173
npm test             # tous les tests (Node 22, aucune dépendance à installer)
```

- Sans configuration Firebase (`public/js/firebase-config.js` vide), l'appli fonctionne hors ligne :
  onglet « Contre l'IA », en 2 contre 2 ou à 3 joueurs.
- `http://localhost:5173/?demo` remplace le réseau par une API factice en mémoire : tous les écrans
  en ligne (connexion, Mes parties, invitations, salle d'attente, jeu, analyse) se parcourent sans Firebase.
- Mise en place de Firebase et déploiement : `docs/firebase.md`. Le site est publié par GitHub Pages à chaque
  push sur la branche par défaut ; chaque pull request est vérifiée (tests, émulateur Firebase, construction de l'APK).

## Appli Android

`android/` est une coquille Android : l'APK embarque `public/` tel quel et l'affiche dans une WebView (aucune copie,
aucune étape de build pour le web). À chaque push sur la branche par défaut, `.github/workflows/android.yml` publie
`toc.apk` dans la release « apk » du dépôt ; l'appli « Mes applis » (p-bailly/Managing-Apps) l'installe et le met à jour
depuis là. Lien direct : <https://github.com/p-bailly/Toc/releases/latest/download/toc.apk>.

- En local : Android SDK (plateforme 35) + Java 17 ou plus, `cd android && ./gradlew assembleRelease` →
  `android/app/build/outputs/apk/release/app-release.apk`.
- Identifiant `fr.perso.toc`. L'APK est signé par une clé **volontairement versionnée** (`android/app/toc.keystore`, mot
  de passe dans `android/app/build.gradle`) : même signature partout, chaque APK s'installe sur le précédent. Ne pas
  changer l'identifiant, le nom `toc.apk` ni la clé : « Mes applis » les connaît (`TrackedApps.kt`, empreinte du certificat).
- Version : `majeur.mineur` de `package.json`, puis le numéro de build de la CI (`1.0.57`) ; affichée dans les Réglages.
- Ce que la WebView n'a pas (notifications, partage, couleur des barres du système) passe par `window.TocAndroid`
  (`public/js/ui/android.js` côté web, `MainActivity.java` côté Android). Pas de service worker dans l'APK
  (`?sanssw`) : les fichiers sont déjà sur le téléphone, et les mises à jour passent par « Mes applis ».
- Un lien d'invitation envoyé depuis l'appli mène à la version web (`ADRESSE_WEB` dans `android/app/build.gradle`) ;
  il n'ouvre pas l'appli Android, où l'on saisit le code de la partie.

## Organisation

| Dossier | Rôle |
|---|---|
| `public/js/moteur/` | Règles du jeu en JavaScript pur (plateau, cartes, coups légaux, partie locale, rejeu). Aucune dépendance, testé hors ligne. |
| `public/js/ia/` | IA : moteur rapide, évaluation, recherche par simulations, conseils, analyse qui s'affine. |
| `public/js/reseau/` | Firebase : comptes, parties, invitations, mains privées, session de jeu, historique contre l'IA du compte. `api.js` est le seul point d'entrée de l'interface. |
| `public/js/ui/` | Écrans, plateau en SVG, saisie des coups, réglages, analyse de fin de partie. |
| `public/js/dev/` | API factice du mode `?demo`. |
| `public/js/session-locale.js` | Partie hors ligne contre l'IA ; définit l'interface « Session » que la session réseau reprend. |
| `firestore.rules` | Règles de sécurité Firestore. |
| `android/` | Coquille Android (WebView) et sa clé de signature ; voir « Appli Android ». |
| `tests/` | Tests `node:test` : règles (dont deux oracles indépendants), IA, réseau (faux magasin en mémoire, et émulateur s'il est disponible), interface (géométrie, libellés, analyse). |
| `outils/` | Tournois entre IA et calibrage (`node outils/tournoi.js --a=ia --b=glouton --parties=100 --budget=600`). |
| `outils/regles/` | Générateur de la page Règles (« Le Toc en une page ») : `SORTIE_APPLI=public node outils/regles/construire.mjs` réécrit `public/js/ui/regles-page.js` et `public/css/regles.css`. Les exemples illustrés y sont vérifiés par le moteur. |

## Règles : décisions

Communes aux deux modes :

- **Plateau** : 18 cases d'une case de sortie à la suivante (18 par côté). La case de sortie (as ou roi) est au milieu du côté. L'allée d'arrivée
  (4 cases) s'ouvre sur la case située **3 cases avant la sortie**, à droite vu du joueur : un pion sur sa
  sortie qui recule de 4 puis joue un 5 arrive au fond de l'allée. La base est derrière la case de sortie.
  Repères de comptage sur la 6e et la 12e case après chaque sortie.
  Les premières parties se sont jouées avec 16 cases par côté (64 cases à 4, 48 à 3, comme l'écrivait le cahier
  des charges d'origine) : celles qui étaient commencées se terminent, se rejouent et s'analysent sur ce
  plateau-là. Le plateau d'une partie se lit dans son état (`etat.v` : 1 pour 16 cases, 2 pour 18 ; voir
  `public/js/moteur/plateau.js`), et les tests écrits pour l'ancien plateau importent `tests/plateau-16.js`.
- **Pion protégé** sur sa case de sortie : ni dépassé, ni capturé, ni échangé par un autre joueur, ni poussé par
  un « 5 adverse ». Son propriétaire peut l'échanger avec son valet, et la sortie d'un pion de la même couleur
  le renvoie.
- **7** : fractionnable, toujours dépensé en entier (sinon injouable), capture tout pion dépassé, y compris
  les siens.
- **Allée** : un pion s'y arrête sur la case où la carte le mène (pas forcément au fond), sans dépasser le fond
  ni un autre pion ; une carte trop grande le laisse sur le circuit ; entrée jamais obligatoire.
- **Obligation de jouer** ; défausse au choix si aucune carte n'est jouable.

2 contre 2 (72 cases, 52 cartes, donnes de 5-4-4) :

- Échange d'une carte avec le partenaire à chaque donne.
- Un joueur qui a rentré ses 4 pions joue pour son partenaire. Le reste d'un 7 ne va aux pions du
  partenaire qu'après avoir rentré son propre 4e pion pendant ce 7.
- N'importe quelle répartition humains / IA sur les 4 sièges.

3 joueurs, chacun pour soi (triangle de 54 cases, 54 cartes dont 2 jokers, donnes de 5-4-4-5) :

- Le premier qui rentre ses 4 pions gagne.
- À chaque donne, une carte au voisin de gauche (donnes paires) ou de droite (donnes impaires).
- **Joker** : copie une carte posée depuis le début de la donne (jouée ou défaussée, y compris un joker
  qui a copié) ; injouable s'il n'y a rien à copier.

## Salles d'attente (en ligne)

Une salle d'attente est ouverte à tous : elle apparaît dans « Mes parties » de chaque joueur connecté, qui peut s'y
asseoir sans invitation, y activer ou désactiver l'option « 5 adverse », et la supprimer. L'hôte garde les IA, les
invitations et le lancement. Les statistiques du compte (parties en ligne jouées et gagnées) sont dans l'onglet « Stats ».

## Un compte sur plusieurs appareils

Le même prénom ouvre le même compte partout. Les parties en ligne et leurs statistiques sont dans le compte. Les
parties contre l'IA se jouent hors ligne, sur l'appareil, mais rejoignent le compte dès qu'on est connecté
(`public/js/ui/synchro-ia.js`) :

- l'historique et les statistiques contre l'IA sont les mêmes sur tous ses appareils ;
- les 12 parties terminées les plus récentes sont gardées en entier : on les analyse depuis n'importe quel appareil ;
- la partie en cours de chaque mode est envoyée au compte pendant qu'on joue (quelques secondes après chaque coup,
  et en quittant l'écran) et reprise sur un autre appareil. Le compte n'en garde qu'une par mode : la plus récemment
  jouée l'emporte, et une nouvelle partie remplace l'ancienne partout.

Sans compte ou sans réseau, tout reste sur l'appareil et partira à la prochaine connexion. Sur un appareil partagé,
chacun ne voit que les parties de son compte.

## Limites connues

- Pas de Cloud Functions (offre gratuite) : les coups sont validés par l'appli de chaque joueur, les règles
  Firestore contrôlent le reste (tour, forme de l'état, mains privées). Détail dans `docs/firebase.md`.
- Notifications locales seulement (appli ouverte ou revenue au premier plan) ; pas de push.
- Le nom d'utilisateur tient lieu de compte, sans mot de passe, comme dans l'appli Scrabble.
- L'IA ne regarde pas plus loin que la fin de la donne en cours.
