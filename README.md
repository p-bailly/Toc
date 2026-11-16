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
  push sur la branche par défaut ; chaque pull request est vérifiée (tests, puis émulateur Firebase).

## Organisation

| Dossier | Rôle |
|---|---|
| `public/js/moteur/` | Règles du jeu en JavaScript pur (plateau, cartes, coups légaux, partie locale, rejeu). Aucune dépendance, testé hors ligne. |
| `public/js/ia/` | IA : moteur rapide, évaluation, recherche par simulations, conseils, analyse qui s'affine. |
| `public/js/reseau/` | Firebase : comptes, parties, invitations, mains privées, session de jeu. `api.js` est le seul point d'entrée de l'interface. |
| `public/js/ui/` | Écrans, plateau en SVG, saisie des coups, réglages, analyse de fin de partie. |
| `public/js/dev/` | API factice du mode `?demo`. |
| `public/js/session-locale.js` | Partie hors ligne contre l'IA ; définit l'interface « Session » que la session réseau reprend. |
| `firestore.rules` | Règles de sécurité Firestore. |
| `tests/` | Tests `node:test` : règles (dont deux oracles indépendants), IA, réseau (faux magasin en mémoire, et émulateur s'il est disponible), interface (géométrie, libellés, analyse). |
| `outils/` | Tournois entre IA et calibrage (`node outils/tournoi.js --a=ia --b=glouton --parties=100 --budget=600`). |

## Règles : décisions

Communes aux deux modes :

- **Plateau** : 16 cases par côté. La case de sortie (as ou roi) est au milieu du côté. L'allée d'arrivée
  (4 cases) s'ouvre sur la case située **3 cases avant la sortie**, à droite vu du joueur : un pion sur sa
  sortie qui recule de 4 puis joue un 5 arrive au fond de l'allée. La base est derrière la case de sortie.
  Repères de comptage sur la 6e et la 12e case après chaque sortie.
- **Pion protégé** sur sa case de sortie : ni dépassé, ni capturé, ni échangé par un autre joueur, ni poussé par
  un « 5 adverse ». Son propriétaire peut l'échanger avec son valet, et la sortie d'un pion de la même couleur
  le renvoie.
- **7** : fractionnable, toujours dépensé en entier (sinon injouable), capture tout pion dépassé, y compris
  les siens.
- **Allée** : compte exact, pas de dépassement, entrée jamais obligatoire.
- **Obligation de jouer** ; défausse au choix si aucune carte n'est jouable.

2 contre 2 (64 cases, 52 cartes, donnes de 5-4-4) :

- Échange d'une carte avec le partenaire à chaque donne.
- Un joueur qui a rentré ses 4 pions joue pour son partenaire. Le reste d'un 7 ne va aux pions du
  partenaire qu'après avoir rentré son propre 4e pion pendant ce 7.
- N'importe quelle répartition humains / IA sur les 4 sièges.

3 joueurs, chacun pour soi (triangle de 48 cases, 54 cartes dont 2 jokers, donnes de 5-4-4-5) :

- Le premier qui rentre ses 4 pions gagne.
- À chaque donne, une carte au voisin de gauche (donnes paires) ou de droite (donnes impaires).
- **Joker** : copie une carte posée depuis le début de la donne (jouée ou défaussée, y compris un joker
  qui a copié) ; injouable s'il n'y a rien à copier.

## Limites connues

- Pas de Cloud Functions (offre gratuite) : les coups sont validés par l'appli de chaque joueur, les règles
  Firestore contrôlent le reste (tour, forme de l'état, mains privées). Détail dans `docs/firebase.md`.
- Notifications locales seulement (appli ouverte ou revenue au premier plan) ; pas de push.
- Le nom d'utilisateur tient lieu de compte, sans mot de passe, comme dans l'appli Scrabble.
- L'IA ne regarde pas plus loin que la fin de la donne en cours.
