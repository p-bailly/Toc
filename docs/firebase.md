# Mettre le Toc en ligne avec Firebase

Sans configuration Firebase, l'application marche hors ligne (entraînement contre l'IA) et ne fait
aucun appel réseau. Pour jouer à plusieurs, il faut un projet Firebase (offre gratuite **Spark**,
sans carte bancaire : pas de Cloud Functions).

## 1. Créer le projet

1. <https://console.firebase.google.com> → **Ajouter un projet** (Google Analytics inutile).
2. **Authentication** → Commencer → onglet *Sign-in method* → activer **Adresse e-mail/Mot de passe**
   (laisser « Lien par e-mail » désactivé).
3. **Firestore Database** → Créer une base de données → mode **production**, emplacement `eur3`
   (Europe).
4. **Paramètres du projet** (roue dentée) → *Vos applications* → icône Web `</>` → nom « Toc » →
   copier l'objet `firebaseConfig` affiché.

## 2. Configurer l'application

Coller les valeurs dans `public/js/firebase-config.js` (`apiKey`, `authDomain`, `projectId`,
`storageBucket`, `messagingSenderId`, `appId`). Ces valeurs ne sont **pas secrètes** : la sécurité
repose sur les règles Firestore. Dès que `apiKey` est rempli, l'appli propose le jeu en ligne ; le
SDK Firebase (version épinglée dans `public/js/reseau/firebase.js`, `VERSION_SDK`) est alors chargé
depuis `https://www.gstatic.com/firebasejs/…`.

## 3. Publier les règles et le site

**Les règles de sécurité** : console Firebase → Firestore Database → onglet **Règles** → coller le
contenu de `firestore.rules` → **Publier**. (Ou, depuis un ordinateur où l'on est connecté :
`npx firebase-tools deploy --only firestore:rules --project <projet>`.)

**Le site**, comme l'appli Scrabble, est publié par **GitHub Pages** à chaque push sur la branche par
défaut (`.github/workflows/deploy.yml`, dossier `public/` publié tel quel) :

1. Dépôt GitHub → *Settings → Pages* → Source : **GitHub Actions** (à faire une fois).
2. La configuration Firebase vient du fichier versionné `public/js/firebase-config.js` s'il est
   rempli ; sinon de la variable de dépôt `FIREBASE_CONFIG` (*Settings → Secrets and variables →
   Actions → Variables*), qui contient l'objet `firebaseConfig` en JSON strict. Sans l'un ni l'autre,
   le site est publié en mode hors ligne (jeu contre l'IA seulement).
3. Le site est servi à `https://<compte>.github.io/<dépôt>/`. Pour une adresse à soi : un CNAME
   (par ex. `toc`) vers `<compte>.github.io.` chez le fournisseur du domaine, puis *Settings → Pages* →
   domaine personnalisé + *Enforce HTTPS*.

La connexion par nom d'utilisateur ne demande pas de déclarer ce domaine à Firebase.

Chaque pull request est vérifiée par `.github/workflows/verification.yml` : tous les tests, puis la
couche réseau contre l'émulateur Firebase avec les vraies règles.

*Autre possibilité : Firebase Hosting* (`firebase.json` est prêt) —
`cp .firebaserc.exemple .firebaserc`, y mettre l'identifiant du projet, puis
`npx firebase-tools login` et `npx firebase-tools deploy --only firestore:rules,hosting` ; le site est
alors servi à `https://<projet>.web.app`.

**Republier les règles à chaque modification de `firestore.rules`**
(`npx firebase-tools deploy --only firestore:rules`), sinon les actions sont refusées
(« Refusé par le serveur… »). Aucun index composite n'est nécessaire (pas de `firestore.indexes.json`).

## Comptes : un nom, sans mot de passe

Comme dans l'appli Scrabble : le joueur tape seulement son nom. L'appli en dérive une adresse
fictive `<nom simplifié>@joueurs.toc.pbailly.fr` et le mot de passe `toc-<nom simplifié>` (aucun
e-mail n'est envoyé). Le nom ignore accents, casse et ponctuation (« Jean Luc » = « jean-luc ») ;
le même nom sur un autre appareil ouvre le même compte.

**Le nom n'est pas secret** : qui le connaît ouvre le compte (ses parties, ses cartes). C'est un
compromis assumé entre proches. C'est aussi pourquoi seuls les joueurs « visibles » se listent, par
pages de 10.

**Renommer un joueur** (pseudo inapproprié) : console → Firestore → collection `joueurs` → sa fiche :
changer `pseudo` (≤ 20 caractères) et ajouter `verrouille` (booléen) à `true` : il ne pourra plus en
changer (supprimer le champ lève le verrou). L'appli recalcule elle-même la clé `recherche`. Les
pseudos recopiés dans ses parties (`joueurs[i].pseudo`) ne changent pas. Le nom de connexion non plus.

## Données

- `joueurs/{uid}` : `pseudo`, `visible`, `recherche` (pseudo simplifié, présent seulement si
  visible), `icone`, `verrouille`, `stats { jouees, gagnees }`, `comptees` (parties déjà comptées),
  `creeLe`.
- `parties/{code}` : le code d'invitation (6 caractères sans 0/O/1/I/L) est l'identifiant. Nom,
  hôte, statut, réglages (`cinqAdverse` se change en salle d'attente), places (4, ou 3 ; une IA a son `niveau` de force : `debutant`, `amateur`,
  `confirme`, `expert` ou `champion`, absent = champion), `uids`, invitations, état public du moteur, historique
  des coups (rejouable par `rejouerPartie`), `enAttente` (qui doit jouer).
- `parties/{code}/donnes/{donne}_{siège}` et `…/dons/{donne}_{siège}` : cartes distribuées et carte
  donnée (au partenaire ; au voisin à 3), **jamais modifiées** une fois écrites. 12 documents de
  mains par cycle : 3 donnes × 4 sièges, ou 4 donnes × 3 sièges.

Deux modes, choisis à la création et figés ensuite : **4 joueurs** (deux équipes ; réglages
`{ cinqAdverse }`, la forme d'origine) et **3 joueurs** chacun pour soi (réglages
`{ cinqAdverse, nbJoueurs: 3 }`, circuit de 48 cases, 54 cartes avec 2 jokers, cycle 5-4-4-5, don
au voisin de gauche les donnes paires et de droite les impaires).

## Ce que garantissent les règles (et ce qu'elles ne garantissent pas)

Sans serveur de jeu, chaque coup est validé par le moteur **dans le client** qui l'écrit (transaction
Firestore). Les règles vérifient tout ce qui se vérifie sans exécuter le moteur :

- tout accès exige d'être connecté ; une fiche n'est modifiable que par son titulaire, qui ne peut ni
  poser ni lever le verrou de pseudo ; les statistiques ne bougent que d'une partie terminée à la fois,
  avec le bon résultat (son équipe à 4, son siège à 3), une seule fois ;
- une partie en cours n'est lisible que par ses membres (et ses invités) ; seules se listent ses parties,
  ses invitations et les salles d'attente (parties pas encore lancées, 50 au plus par requête) ;
- une **salle d'attente est ouverte à tous** : tout joueur connecté la lit, s'y assoit sur une place libre
  (invité ou non), active ou désactive la règle du « 5 adverse » (rien d'autre dans les réglages : le nombre
  de joueurs reste figé) et peut la supprimer. Chacun ne déplace que sa propre place ; seul l'hôte place
  des IA, choisit leur niveau (un des cinq niveaux), invite et lance. Joueurs (niveaux compris), hôte,
  code et réglages sont figés après le lancement, et une partie lancée ne se supprime plus ;
- un coup n'est écrit que par le joueur dont c'est le tour (ou par un membre pour une IA), avec un
  numéro de coup qui augmente exactement de 1, un historique qui ne fait que s'allonger, et une
  structure d'état cohérente (tour suivant, donne, pile, échange…) ;
- **la main d'un autre humain n'est jamais lisible**, ni une donne future ; un don va au bon
  destinataire (partenaire, ou voisin de la donne à 3), qui ne le lit qu'une fois l'échange terminé
  (à 3, le troisième joueur ne le lit jamais) ; une carte donnée doit être dans la main distribuée ;
  mains et dons ne sont jamais modifiés ni supprimés ;
- le nombre de joueurs est figé à la création, et la forme de l'état suit le mode (à 4, exactement
  celle d'origine ; à 3, tableaux de 3 et 12, jokers J1/J2, gagnant de 0 à 2).

Limites connues (modèle de confiance « entre amis ») :

- la **légalité d'un coup** (déplacement des pions, carte réellement en main, rang copié par un
  joker) n'est pas vérifiée par le serveur : un client modifié pourrait écrire un coup illégal ;
- le client qui lance la partie ou déclenche un remélange **tire les cartes du cycle** (52, ou 54) : un client
  modifié pourrait les connaître ou les choisir ;
- les mains des **IA** sont lisibles par tous les membres (ce sont les clients qui font jouer l'IA),
  donc le partenaire humain d'une IA peut voir le jeu de celle-ci ;
- n'importe quel joueur connecté peut **supprimer une salle d'attente** ou y changer la règle du 5, même sans
  y être assis : c'est voulu (chacun peut faire le ménage), et sans conséquence une fois la partie lancée ;
- quiconque connaît un nom peut ouvrir ce compte (voir plus haut).

## Tester avec les émulateurs (développeurs)

Les tests `tests/reseau-*.test.js` tournent avec `npm test` sur un faux Firestore en mémoire.
`tests/reseau-emulateur.test.js` rejoue en plus une partie complète avec le vrai SDK et les vraies
règles, et des tentatives de triche ; il est ignoré sans émulateur. Paquets à installer **hors du
dépôt** (Java requis) :

```sh
mkdir -p ~/toc-outils && cd ~/toc-outils && npm init -y
npm install firebase@13.1.0 @firebase/rules-unit-testing@6.0.0 firebase-tools@15.36.0
cd /chemin/vers/Toc
TOC_MODULES=~/toc-outils/node_modules ~/toc-outils/node_modules/.bin/firebase \
  emulators:exec --only auth,firestore --project demo-toc "node --test tests/reseau-emulateur.test.js"
```
