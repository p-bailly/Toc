// Libellés en français : noms de cartes, journal des coups, description des choix (logique pure, testée dans
// tests/ui-libelles.test.js).

import { rang, couleurCarte, SYMBOLES, estJoker } from '../moteur/cartes.js';

const NOMS_RANGS = { A: 'As', V: 'Valet', D: 'Dame', R: 'Roi' };
const NOMS_COULEURS = { P: 'pique', C: 'cœur', K: 'carreau', T: 'trèfle' };

/** Rang affiché sur la carte : « A », « 7 », « V »… */
export const rangAffiche = (carte) => (estJoker(carte) ? 'JOKER' : rang(carte));
export const symbole = (carte) => (estJoker(carte) ? '★' : SYMBOLES[couleurCarte(carte)]);
export const estRouge = (carte) => !estJoker(carte) && ['C', 'K'].includes(couleurCarte(carte));

/** Nom d'un rang avec son article indéfini : « un as », « un 9 », « une dame ». */
export function rangAvecArticle(r) {
  if (r === 'D') return 'une dame';
  return 'un ' + ({ A: 'as', V: 'valet', R: 'roi' }[r] ?? r);
}
/** Nom court d'un rang : « As », « 9 », « Valet ». */
export const nomRang = (r) => NOMS_RANGS[r] ?? r;

/** « As de pique », « 7 de cœur », « Valet de trèfle ». */
export function nomCarte(carte) {
  if (estJoker(carte)) return 'Joker';
  const r = rang(carte);
  return `${NOMS_RANGS[r] ?? r} de ${NOMS_COULEURS[couleurCarte(carte)]}`;
}

/** « As ♠ », « 7 ♥ ». */
export function carteCourte(carte) {
  if (estJoker(carte)) return 'Joker';
  const r = rang(carte);
  return `${NOMS_RANGS[r] ?? r} ${symbole(carte)}`;
}

/** Carte avec son article : « l’As ♠ », « le 7 ♥ », « le joker » (majuscule initiale si `debut`). */
export function leCarte(carte, debut = false) {
  const t = estJoker(carte) ? 'le joker' : rang(carte) === 'A' ? `l’${carteCourte(carte)}` : `le ${carteCourte(carte)}`;
  return debut ? t[0].toUpperCase() + t.slice(1) : t;
}

/** Ordre d'affichage d'une main : par valeur (As, 2 … 10, Valet, Dame, Roi), puis par couleur. */
const ORDRE_RANGS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'V', 'D', 'R'];
export function trierMain(main) {
  const ordre = (c) => (estJoker(c) ? 99 : ORDRE_RANGS.indexOf(rang(c)));
  return main.slice().sort((a, b) => ordre(a) - ordre(b) || couleurCarte(a).localeCompare(couleurCarte(b)));
}

const nomDe = (joueurs, siege) => joueurs?.[siege]?.pseudo || `Joueur ${siege + 1}`;

/** « 2 pions de Léa », « le pion de Léa », pour une liste de pions capturés. */
function decrireCaptures(captures, joueurs, siege) {
  const parSiege = new Map();
  for (const q of captures) parSiege.set(q >> 2, (parSiege.get(q >> 2) || 0) + 1);
  const morceaux = [];
  for (const [o, n] of parSiege) {
    const qui = o === siege ? 'son propre pion' : `un pion de ${nomDe(joueurs, o)}`;
    if (n === 1) morceaux.push(qui);
    else morceaux.push(o === siege ? `${n} de ses propres pions` : `${n} pions de ${nomDe(joueurs, o)}`);
  }
  return morceaux.join(' et ');
}

/** Complément « d'un pion de X » quand le pion déplacé n'est pas à soi (partenaire, ou adversaire au 5). */
function duPion(pion, siege, joueurs) {
  const o = pion >> 2;
  return o === siege ? '' : ` un pion de ${nomDe(joueurs, o)}`;
}

/** Description courte d'une action (sans le nom du joueur ni la carte) : « avance de 8 », « sort un pion »… */
export function decrireAction(coup, siege, joueurs) {
  switch (coup.t) {
    case 'sortie':
      return (coup.pion >> 2) === siege ? 'sort un pion' : `sort un pion de ${nomDe(joueurs, coup.pion >> 2)}`;
    case 'avance': {
      const o = coup.pion >> 2;
      const autre = duPion(coup.pion, siege, joueurs);
      if (coup.allee) return autre ? `fait entrer${autre} dans son allée (${coup.pas})` : `avance de ${coup.pas} dans son allée`;
      if (o !== siege && (joueurs?.length === 3 || o % 2 !== siege % 2)) return `fait avancer${autre} de ${coup.pas}`;
      return autre ? `avance${autre} de ${coup.pas}` : `avance de ${coup.pas}`;
    }
    case 'recul':
      return (coup.pion >> 2) === siege ? 'recule de 4' : `fait reculer${duPion(coup.pion, siege, joueurs)} de 4`;
    case 'echange':
      return `échange un pion avec un pion de ${nomDe(joueurs, coup.cible >> 2)}`;
    case 'sept': {
      const pas = coup.etapes.map((e) => e.pas);
      const partenaire = coup.etapes.some((e) => e.pion >> 2 !== siege);
      if (pas.length === 1) return partenaire ? `avance${duPion(coup.etapes[0].pion, siege, joueurs)} de 7` : 'avance de 7';
      return `fractionne le 7 (${pas.join(' + ')})` + (partenaire ? ' avec les pions de son partenaire' : '');
    }
    case 'defausse':
      return 'défausse (aucune carte jouable)';
    default:
      return 'joue';
  }
}

/**
 * Ligne du journal pour une entrée de vue.historique : { n, siege, coup, captures }.
 * Ex. « Léa joue le Roi ♠ : sort un pion. » — « Max joue le 7 ♥ : fractionne le 7 (3 + 4) et renvoie un pion de Léa à la base. »
 */
export function ligneJournal(entree, joueurs, siegeLocal = -1) {
  const { siege, coup, captures = [] } = entree;
  // Le joueur local est tutoyé : « Tu joues le Roi ♠ : sort un pion. »
  const moi = siege === siegeLocal;
  const qui = moi ? 'Tu' : nomDe(joueurs, siege);
  const [joueV, defausseV] = moi ? ['joues', 'défausses'] : ['joue', 'défausse'];
  const carte = carteCourte(coup.carte);
  if (coup.t === 'defausse') return estJoker(coup.carte) ? `${qui} ${defausseV} un joker (aucune carte jouable).` : `${qui} ${defausseV} le ${carte} (aucune carte jouable).`;
  const joue = estJoker(coup.carte) ? `un joker comme ${rangAvecArticle(coup.comme)}` : `${articleCarte(coup.carte)}${carte}`;
  let texte = `${qui} ${joueV} ${joue} : ${decrireAction(coup, siege, joueurs)}`;
  if (captures.length) texte += ` et renvoie ${decrireCaptures(captures, joueurs, siege)} à la base`;
  return texte + '.';
}

/** « l’As », « le 7 », « la Dame ». */
function articleCarte(carte) {
  const r = rang(carte);
  if (r === 'A') return 'l’';
  if (r === 'D') return 'la ';
  return 'le ';
}

/**
 * Libellé d'un choix proposé au joueur pour un coup (bouton sous le plateau).
 * `depuisAllee` : le pion est déjà dans son allée.
 */
export function libelleChoix(coup, siege, joueurs, { depuisAllee = false } = {}) {
  switch (coup.t) {
    case 'sortie':
      return 'Sortir un pion';
    case 'avance': {
      const o = coup.pion >> 2;
      if (o !== siege && (joueurs?.length === 3 || o % 2 !== siege % 2)) return `Pousser le pion de ${nomDe(joueurs, o)} de ${coup.pas}`;
      if (coup.allee) return depuisAllee ? `Avancer de ${coup.pas} dans l’allée` : `Entrer dans l’allée (${coup.pas})`;
      return `Avancer de ${coup.pas}`;
    }
    case 'recul':
      return 'Reculer de 4';
    case 'echange':
      return `Échanger avec ${nomDe(joueurs, coup.cible >> 2)}`;
    case 'defausse':
      return `Défausser ${leCarte(coup.carte)}`;
    default:
      return 'Jouer';
  }
}

/** « Léa et Max » / « Léa, Max et Zoé ». */
export function enumerer(noms) {
  if (noms.length <= 1) return noms.join('');
  return noms.slice(0, -1).join(', ') + ' et ' + noms[noms.length - 1];
}
