# Jeu de Toc — Cahier des charges de l'application

## 1. Objectif

Application web progressive (PWA) du jeu de Toc, jouable en ligne à 4 joueurs (deux équipes de deux) sur Android et iOS, construite sur le même modèle que l'application Scrabble existante (Firebase / Firestore).

## 2. Matériel

- Un jeu de 52 cartes, sans joker.
- 4 joueurs, 2 équipes de 2 (les partenaires sont face à face).
- 4 pions par joueur.

## 3. Plateau

- Plateau complètement carré.
- Circuit principal de 64 cases, soit 16 cases par côté.
- La case de sortie (départ) de chaque joueur est au milieu d'un côté.
- Chaque joueur dispose d'une base de 4 emplacements (pions non sortis) et d'une allée d'arrivée de 4 cases qui part du circuit vers le centre.
- Tout pion posé sur la case de départ de sa propre couleur est inviolable, quelle que soit la façon dont il y est arrivé : personne ne peut le dépasser (son propriétaire non plus), l'échanger ni le renvoyer à la base. Seule exception : son propriétaire qui sort un nouveau pion le renvoie à la base. La protection tombe dès que le pion quitte la case.
- Dans l'allée d'arrivée, un pion ne peut pas en dépasser un autre : il faut d'abord avancer celui qui est devant.

## 4. Distribution

- Cycle de distribution : 5 cartes, puis 4, puis 4 (soit 52 cartes), puis on remélange et on recommence 5-4-4.
- En début de partie, chaque joueur donne une carte à son partenaire (échange simultané, face cachée).
- Si un joueur peut jouer, il est obligé de jouer, même si cela le désavantage.
- Si aucune carte n'est jouable, le joueur défausse la carte de son choix.

## 5. Valeur des cartes

- As : avance de 1 ou de 11, ou fait sortir un pion.
- Roi : avance de 13, ou fait sortir un pion.
- Dame : avance de 12.
- Valet : échange la position de deux pions. Interdit : échanger deux de ses propres pions, un pion dans une base ou une allée d'arrivée, un pion protégé sur sa case de départ.
- 7 : fractionnable entre plusieurs pions (par exemple 3 + 4). Le reste des points peut servir à faire avancer un pion du partenaire. Tous les pions dépassés par un déplacement de 7 sont renvoyés à la base, y compris les pions alliés et ses propres pions. Un pion protégé sur sa case de départ bloque le 7 comme tout autre déplacement.
- 4 : recule de 4, passe par-dessus les autres pions et renvoie à la base le pion présent sur la case d'arrivée. Interdit de reculer dans sa base ou son allée d'arrivée.
- 5 : avance de 5. Option de réglage : le 5 fait avancer un pion adverse de 5 cases.
- 2, 3, 6, 8, 9, 10 : valeur faciale.

## 6. Captures et fin

- Arriver sur une case occupée renvoie le pion présent à sa base, qu'il soit adverse, allié ou le sien (sauf pion protégé : le coup est alors interdit).
- Sortir un pion alors que sa propre case de départ est occupée renvoie le pion présent à la base, même le sien.
- La partie est gagnée quand les deux joueurs d'une équipe ont rentré leurs 4 pions dans leur allée d'arrivée.
- Un joueur qui a rentré tous ses pions joue ses cartes pour son partenaire.

### Règles de l'allée d'arrivée et cas particuliers

- Un pion peut passer par-dessus un pion non protégé lors d'un déplacement normal.
- Entrer dans l'allée n'est jamais obligatoire : le joueur peut choisir de refaire un tour.
- Compte exact obligatoire dans l'allée. Une carte trop grande ne fait pas rentrer le pion : s'il est encore sur le circuit, il continue son tour ; s'il est déjà dans l'allée, cette carte n'est pas jouable avec lui (il faut par exemple un 2, des as, ou un 7 fractionné).
- Dans l'allée, on ne peut pas bousculer ses propres pions, ni échanger un pion avec le valet.
- Le 4 est interdit sur un pion dans l'allée, car il en sortirait.
- Un joueur qui a fini peut sortir les pions de son partenaire avec un as ou un roi, et continue à échanger une carte en début de donne.
- Si le 7 est la seule carte jouable et que ses 7 points peuvent être utilisés en entier, il doit être joué ; sinon la carte est défaussée.
- Jeu asynchrone : pas de temps réel. Chaque joueur joue son coup quand il le peut ; la partie attend indéfiniment le joueur dont c'est le tour. Une notification (ou un badge dans l'appli) signale que c'est à soi de jouer.

* Valet : l'échange doit impliquer un de ses propres pions. Un valet sans échange possible n'est pas jouable ; il ne peut être défaussé que si aucune carte de la main n'offre de coup légal. Un joueur dont tous les pions sont rentrés échange un pion de son partenaire avec un pion adverse.

## 7. Réglages de partie

- Option « 5 adverse » : activée ou non.
- Nom de la partie, code d'invitation pour rejoindre.

* Comptes et création de partie : même fonctionnement que l'application Scrabble, en 2 contre 2 uniquement.
* Partie à 3 joueurs : une IA occupe la quatrième place et joue pour le joueur absent. Objectif : une IA très performante (évaluation des coups : sorties, captures, protection, aide au partenaire, planification du 7).

## 8. Architecture technique

- PWA : HTML, CSS, JavaScript, manifeste et service worker pour l'installation sur l'écran d'accueil.
- Firebase : Authentication (connexion simple), Firestore pour l'état en temps réel, Hosting pour le déploiement.
- La logique de validation des coups est exécutée côté client puis vérifiée par les règles Firestore ou une Cloud Function.

## 9. Structure Firestore

- Collection `joueurs` : un document par joueur (pseudo, identifiant, statistiques).
- Collection `parties` : un document par partie contenant : les 4 joueurs et leurs équipes, les réglages, le paquet et la défausse, les mains de chaque joueur (sous-collection privée), la position des 16 pions, le joueur dont c'est le tour, le numéro de donne, l'historique des coups.
- Chaque coup est une transaction Firestore : lecture de l'état, validation, écriture du nouvel état.

## 10. Étapes de développement

1. Modéliser le plateau (indices 0 à 63 du circuit, bases, allées d'arrivée).
2. Implémenter le moteur de règles en pur JavaScript, testable hors ligne.
3. Interface du plateau carré et des mains.
4. Connexion Firebase et synchronisation des parties.
5. Création et invitation de parties, réglages.
6. Manifeste PWA et tests sur iPhone et Android.
