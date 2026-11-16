// Règles du Toc (route #/regles) : résumé fidèle du cahier des charges.

import { h, remplacer } from './dom.js';
import { entete } from './composants.js';
import { dessinCarte } from './carte.js';

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
      h('p', { class: 'intro' }, 'Quatre joueurs en deux équipes de deux, partenaires face à face. Chaque joueur a 4 pions ; la première équipe qui rentre ses 8 pions dans ses allées d’arrivée gagne.'),
      section(
        'Le plateau',
        liste(
          'Un circuit carré de 64 cases (16 par côté), parcouru dans le sens des aiguilles d’une montre.',
          'Chaque joueur a une case de sortie au milieu de son côté (petit carré de sa couleur) et, juste derrière, sa base de 4 pions non sortis (grand carré de sa couleur).',
          'Son allée d’arrivée (rectangle de sa couleur, 4 cases) part vers le centre depuis une case d’entrée située 3 cases avant la sortie, à droite de celle-ci. Depuis sa case de sortie, un 4 recule le pion une case avant l’entrée ; un 5 l’amène ensuite au fond de l’allée.',
          'Les cases au bord foncé (6e et 12e après chaque sortie) aident à compter.',
          'Un pion posé sur sa propre case de sortie est protégé (bouclier) : personne ne peut le dépasser (son propriétaire non plus), l’échanger ni le renvoyer à la base. Seule exception : son propriétaire qui sort un nouveau pion le renvoie à la base.',
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
          valeur('7C', '7 : se partage entre plusieurs pions (3 + 4…). Tous les pions dépassés retournent à la base, même alliés. Le reste peut servir aux pions du partenaire une fois les siens rentrés.'),
          valeur('4P', '4 : recule de 4 en sautant les pions et renvoie à la base celui de la case d’arrivée. Jamais dans sa base ni son allée.'),
          valeur('5K', '5 : avance de 5. Option « 5 adverse » : peut aussi faire avancer un pion adverse de 5.'),
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
        'Dans l’appli',
        liste(
          'Touchez une carte : les pions jouables s’entourent. Touchez un pion, puis sa destination ; un bouton « Jouer » confirme (réglable).',
          'Valet : touchez votre pion, puis le pion à échanger. 7 : avancez pas à pas ; le compteur indique les points restants et les pions qui retourneront à la base.',
          'En ligne, la partie attend le joueur dont c’est le tour, sans limite de temps : l’appli prévient quand c’est à vous.',
        ),
      ),
    ),
  );
  return null;
}
