// Règles du Toc (route #/regles) : résumé fidèle du cahier des charges.

import { h, remplacer } from './dom.js';
import { entete } from './composants.js';
import { dessinCarte } from './carte.js';
import { NIVEAUX } from './niveaux.js';

const section = (titre, ...contenu) => [h('h2', {}, titre), h('div', { class: 'carte regles' }, contenu)];
const liste = (...items) => h('ul', {}, items.map((i) => h('li', {}, i)));
const valeur = (carte, texte) => h('div', { class: 'valeur-carte' }, dessinCarte(carte, { petite: true }), h('div', {}, texte));

export function afficher(racine) {
  remplacer(
    racine,
    h(
      'div',
      { class: 'contenu' },
      entete('Règles du Toc'),
      h('p', { class: 'intro' }, 'Quatre joueurs en deux équipes de deux, partenaires face à face. Chaque joueur a 4 pions ; la première équipe qui rentre ses 8 pions dans ses allées d’arrivée gagne. Il existe aussi un jeu à 3, chacun pour soi (voir plus bas).'),
      section(
        'Le plateau',
        liste(
          'Un circuit carré de 64 cases (16 par côté), parcouru dans le sens des aiguilles d’une montre.',
          'Chaque joueur a une case de sortie au milieu de son côté (petit carré de sa couleur) et, juste derrière, sa base de 4 pions non sortis (grand carré de sa couleur).',
          'Son allée d’arrivée (rectangle de sa couleur, 4 cases) part vers le centre depuis une case d’entrée située 3 cases avant la sortie, à droite de celle-ci. Depuis sa case de sortie, un 4 recule le pion une case avant l’entrée ; un 5 l’amène ensuite au fond de l’allée.',
          'Les cases au bord foncé (6e et 12e après chaque sortie) aident à compter.',
          'Un pion posé sur sa propre case de sortie est protégé : personne ne peut le dépasser (son propriétaire non plus), l’échanger ni le renvoyer à la base. Seule exception : son propriétaire qui sort un nouveau pion le renvoie à la base.',
        ),
      ),
      section(
        'Les cartes',
        liste(
          '52 cartes sans joker. Donnes de 5, puis 4, puis 4 cartes ; on remélange ensuite et on recommence.',
          'Au début de chaque donne, chacun donne une carte à son partenaire, face cachée.',
          'Chacun joue une carte à son tour. Si une carte est jouable, il faut jouer, même à son désavantage ; sinon on défausse la carte de son choix.',
        ),
        h(
          'div',
          { class: 'valeurs' },
          valeur('AP', 'As : avance de 1 ou de 11, ou sort un pion.'),
          valeur('RC', 'Roi : avance de 13, ou sort un pion.'),
          valeur('DK', 'Dame : avance de 12.'),
          valeur('VT', 'Valet : échange un de ses pions avec un autre pion (pas deux des siens ; ni pion en base, en allée ou protégé).'),
          valeur('7C', '7 : se partage entre plusieurs pions (3 + 4…) et doit être utilisé en entier. Tous les pions dépassés retournent à la base, même alliés et les siens. Le reste peut servir aux pions du partenaire seulement si l’on a rentré son 4e pion pendant ce 7 (ou déjà fini). Les 7 points se dépensent toujours en entier, même pour gagner.'),
          valeur('4P', '4 : recule de 4 en sautant les pions et renvoie à la base celui de la case d’arrivée. Jamais dans sa base ni son allée.'),
          valeur('5K', '5 : avance de 5. Option « 5 adverse » : peut aussi faire avancer un pion adverse de 5 (jamais un pion protégé sur sa case de sortie).'),
          valeur('9T', '2, 3, 6, 8, 9, 10 : avancent de leur valeur.'),
        ),
      ),
      section(
        'Prises et allée',
        liste(
          'S’arrêter sur une case occupée renvoie le pion présent à sa base (adverse, allié ou le sien), sauf pion protégé : le coup est alors interdit.',
          'Sortir un pion quand sa case de sortie est occupée renvoie le pion présent à la base, même le sien.',
          'On peut sauter les pions non protégés lors d’un déplacement normal.',
          'Entrer dans l’allée n’est jamais obligatoire : on peut refaire un tour.',
          'Dans l’allée : compte exact, on ne dépasse pas un autre pion, on ne bouscule pas les siens ; ni valet, ni 4 sur un pion de l’allée. Une carte trop grande fait continuer un pion encore sur le circuit.',
          'Si le 7 est la seule carte jouable et que ses 7 points peuvent être utilisés en entier, il doit être joué.',
        ),
      ),
      section(
        'Fin de partie',
        liste(
          'Un joueur qui a rentré ses 4 pions joue ensuite pour son partenaire : il déplace ses pions, peut les sortir avec un as ou un roi, et continue l’échange de cartes.',
          'L’équipe qui a rentré ses 8 pions gagne.',
        ),
      ),
      section(
        'Le jeu à 3 joueurs',
        liste(
          'Chacun pour soi : pas d’équipe, ni de partenaire. Le premier qui rentre ses 4 pions gagne.',
          'Plateau en triangle de 48 cases (3 côtés de 16). Chaque joueur garde la disposition du jeu à 4 : sortie au milieu de son côté, entrée 3 cases avant, allée de 4 cases vers l’intérieur, repères sur la 6e et la 12e case. Seule différence : la base est à l’extérieur du triangle, accolée à la case de sortie.',
          '54 cartes, dont 2 jokers. Donnes de 5, 4, 4 puis 5 cartes ; on remélange ensuite.',
          'Au début de chaque donne, chacun donne une carte à un voisin : à celui de gauche (le joueur suivant) à la 1re donne, à la 3e, et ainsi de suite ; à celui de droite aux autres donnes.',
          'Joker : il copie une carte déjà posée (jouée ou défaussée) pendant la donne en cours et se joue exactement comme elle. Un joker défaussé n’offre rien à copier ; sans carte utile à copier, il n’est pas jouable.',
          'Le valet échange un de tes pions avec celui de n’importe quel autre joueur ; le 7 ne sert qu’à tes propres pions ; avec l’option « 5 adverse », le 5 peut pousser le pion de n’importe quel autre joueur.',
        ),
      ),
      section(
        'Dans l’appli',
        liste(
          'Touche une carte : les pions jouables s’entourent. Touche un pion, puis sa destination : le coup part aussitôt (un réglage permet d’ajouter un bouton « Jouer » pour confirmer). S’il n’y a qu’un coup possible avec la carte, la toucher suffit.',
          'Valet : touche ton pion, puis le pion à échanger. 7 : avance pas à pas ; le compteur indique les points restants et les pions qui retourneront à la base ; le 7 part quand le dernier point est placé.',
          'Joker : choisis d’abord la carte qu’il copie, puis joue comme avec cette carte.',
          'En ligne, la partie attend le joueur dont c’est le tour, sans limite de temps : l’appli te prévient quand c’est à toi.',
          `Force des IA : contre l’IA, tu choisis le niveau des adversaires (et de ton partenaire en 2 contre 2) ; en ligne, l’hôte choisit celui de chaque IA. Du plus faible au plus fort : ${NIVEAUX.map((n) => n.nom).join(', ')}. Les conseils et l’analyse utilisent toujours la meilleure force.`,
          'Conseils de l’IA (désactivés au départ, à activer dans les Réglages) : dans les parties contre l’IA, un bouton « Conseil » propose les meilleurs coups avec leurs raisons ; dans l’analyse de fin de partie, le choix de l’IA et le bilan de tes coups. Jamais pendant une partie en ligne.',
        ),
      ),
    ),
  );
  return null;
}
