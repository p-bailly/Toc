// Moteur de règles du Toc — pur JavaScript, sans dépendance, testable hors ligne.
//
// L'« état » manipulé ici est l'état PUBLIC d'une partie (plateau, tour, donne…).
// Les mains sont privées et gérées à part (voir partie.js en local, la couche réseau en ligne).
//
// Format d'un coup :
//   { t: 'sortie',   carte, pion }                 as ou roi : sortir un pion de la base
//   { t: 'avance',   carte, pion, pas, allee }     avancer de `pas` cases ; allee = true pour entrer
//                                                  (ou avancer) dans l'allée d'arrivée
//   { t: 'recul',    carte, pion }                 4 : reculer de 4
//   { t: 'echange',  carte, pion, cible }          valet : échanger `pion` (le sien) et `cible`
//   { t: 'sept',     carte, etapes: [{ pion, pas, allee }, …] }   7 fractionné (total = 7)
//   { t: 'defausse', carte }                       aucune carte jouable : défausse
//
// Choix d'interprétation (cahier des charges) :
//  - L'allée d'arrivée s'ouvre sur la case de départ du joueur. Un pion qui vient de sortir
//    (« frais ») ne peut pas y entrer directement : il doit d'abord avoir bougé.
//  - Un pion sur la case de départ de sa propre couleur est protégé : aucun déplacement ne
//    peut le dépasser ni s'y arrêter (7 et 4 compris), il ne peut être ni échangé ni déplacé
//    par un adversaire (option « 5 adverse »). Seule la sortie d'un pion de la même couleur
//    le renvoie à la base.
//  - 7 : tous les points doivent être utilisés. Le reste ne peut servir aux pions du
//    partenaire qu'une fois ses propres pions tous rentrés.

import { rang } from './cartes.js';
import { tailleDonne } from './cartes.js';
import { BASE, ALLEE, NB_CASES, NB_PIONS, LONGUEUR_ALLEE, caseDepart, partenaire, equipe } from './plateau.js';

const PAS_PAR_RANG = {
  A: [1, 11],
  R: [13],
  D: [12],
  2: [2],
  3: [3],
  5: [5],
  6: [6],
  8: [8],
  9: [9],
  10: [10],
};

/** État initial d'une partie (phase d'échange de la première donne). */
export function etatInitial(reglages = {}) {
  return {
    v: 1,
    reglages: { cinqAdverse: !!reglages.cinqAdverse },
    pions: Array(NB_PIONS).fill(BASE), // position des 16 pions
    frais: Array(NB_PIONS).fill(false), // pion tout juste sorti, qui n'a pas encore bougé
    phase: 'echange', // 'echange' | 'jeu' | 'fini'
    donne: 0, // numéro de donne depuis le début de la partie
    tour: 0, // siège dont c'est le tour (premier à jouer pendant la phase d'échange)
    echanges: [false, false, false, false], // qui a déjà donné sa carte au partenaire
    cartesRestantes: [5, 5, 5, 5],
    pile: [], // cartes jouées ou défaussées depuis le dernier mélange
    numCoup: 0, // compteur d'actions (échanges compris)
    gagnant: null, // 0 ou 1 : équipe gagnante
    dernierCoup: null, // { siege, coup, captures, deplacements }
  };
}

export function clonerEtat(etat) {
  return {
    ...etat,
    pions: etat.pions.slice(),
    frais: etat.frais.slice(),
    echanges: etat.echanges.slice(),
    cartesRestantes: etat.cartesRestantes.slice(),
    pile: etat.pile.slice(),
  };
}

// ---------------------------------------------------------------------------
// Lecture du plateau
// ---------------------------------------------------------------------------

function fini(pions, siege) {
  const b = siege * 4;
  return pions[b] >= ALLEE && pions[b + 1] >= ALLEE && pions[b + 2] >= ALLEE && pions[b + 3] >= ALLEE;
}

/** Le joueur a-t-il rentré ses 4 pions ? */
export function aFini(etat, siege) {
  return fini(etat.pions, siege);
}

/** Couleur que le joueur déplace : la sienne, ou celle du partenaire s'il a fini. */
export function couleurActive(etat, siege) {
  return fini(etat.pions, siege) ? partenaire(siege) : siege;
}

function occupant(pions, cellule) {
  for (let q = 0; q < NB_PIONS; q++) if (pions[q] === cellule) return q;
  return -1;
}

/** Pion présent sur une case du circuit, ou -1. */
export function pionSur(etat, cellule) {
  return occupant(etat.pions, cellule);
}

function protege(pions, q) {
  return pions[q] === (q >> 2) * 16;
}

/** Pion sur la case de départ de sa propre couleur : inviolable. */
export function estProtege(etat, pion) {
  return protege(etat.pions, pion);
}

function alleeOccupee(pions, siege, k) {
  const b = siege * 4;
  const pos = ALLEE + k;
  return pions[b] === pos || pions[b + 1] === pos || pions[b + 2] === pos || pions[b + 3] === pos;
}

// ---------------------------------------------------------------------------
// Déplacements élémentaires (aucune modification : renvoient le résultat ou null)
// ---------------------------------------------------------------------------

/**
 * Avance du pion g de `pas` cases.
 * @param versAllee  true : le pion entre (ou avance) dans son allée d'arrivée
 * @param sept       true : déplacement de 7, tous les pions dépassés sont capturés
 * @returns {{pos:number, captures:number[]}|null}
 */
function resoudreAvance(pions, frais, g, pas, versAllee, sept) {
  const p = pions[g];
  if (p === BASE || !Number.isInteger(pas) || pas < 1) return null;
  const o = g >> 2;

  if (p >= ALLEE) {
    // Déjà dans l'allée : compte exact, sans dépasser un autre pion.
    const k = p - ALLEE;
    const dest = k + pas;
    if (dest >= LONGUEUR_ALLEE) return null;
    for (let i = k + 1; i <= dest; i++) if (alleeOccupee(pions, o, i)) return null;
    return { pos: ALLEE + dest, captures: [] };
  }

  const captures = [];
  if (versAllee) {
    const d = (o * 16 - p + NB_CASES) % NB_CASES; // distance jusqu'à sa case de départ
    if (d === 0 && frais[g]) return null; // un pion qui vient de sortir ne rentre pas directement
    const r = pas - d; // nombre de cases parcourues dans l'allée
    if (r < 1 || r > LONGUEUR_ALLEE) return null;
    for (let i = 1; i <= d; i++) {
      const q = occupant(pions, (p + i) % NB_CASES);
      if (q >= 0) {
        if (protege(pions, q)) return null;
        if (sept) captures.push(q);
      }
    }
    for (let k = 0; k < r; k++) if (alleeOccupee(pions, o, k)) return null;
    return { pos: ALLEE + r - 1, captures };
  }

  for (let i = 1; i <= pas; i++) {
    const q = occupant(pions, (p + i) % NB_CASES);
    if (q >= 0) {
      if (protege(pions, q)) return null; // ni dépassement ni arrivée sur un pion protégé
      if (sept || i === pas) captures.push(q);
    }
  }
  return { pos: (p + pas) % NB_CASES, captures };
}

/** Recul de 4 : passe par-dessus les pions non protégés, capture sur la case d'arrivée. */
function resoudreRecul(pions, g) {
  const p = pions[g];
  if (p < 0 || p >= NB_CASES) return null; // interdit depuis la base ou l'allée
  const captures = [];
  for (let i = 1; i <= 4; i++) {
    const q = occupant(pions, (p - i + NB_CASES) % NB_CASES);
    if (q >= 0) {
      if (protege(pions, q)) return null;
      if (i === 4) captures.push(q);
    }
  }
  return { pos: (p - 4 + NB_CASES) % NB_CASES, captures };
}

function echangeable(pions, q) {
  return pions[q] >= 0 && pions[q] < NB_CASES && !protege(pions, q);
}

// ---------------------------------------------------------------------------
// Exécution d'un coup sur le plateau
// ---------------------------------------------------------------------------

function estPion(g) {
  return Number.isInteger(g) && g >= 0 && g < NB_PIONS;
}

/**
 * Joue le coup sur une copie du plateau.
 * @returns {{pions:number[], frais:boolean[], captures:number[], deplacements:object[]}|null}
 *          null si le coup est illégal (hors question de main, de tour et de défausse)
 */
function jouerSurPlateau(etat, siege, coup) {
  if (!coup || typeof coup.carte !== 'string') return null;
  const r = rang(coup.carte);
  const pions = etat.pions.slice();
  const frais = etat.frais.slice();
  const captures = [];
  const deplacements = [];
  const c = fini(pions, siege) ? partenaire(siege) : siege;

  const renvoyer = (q) => {
    deplacements.push({ pion: q, de: pions[q], vers: BASE, capture: true });
    pions[q] = BASE;
    frais[q] = false;
    captures.push(q);
  };
  const poser = (g, pos, res) => {
    for (const q of res.captures) renvoyer(q);
    deplacements.push({ pion: g, de: pions[g], vers: pos });
    pions[g] = pos;
    frais[g] = false;
  };

  switch (coup.t) {
    case 'sortie': {
      const g = coup.pion;
      if (r !== 'A' && r !== 'R') return null;
      if (!estPion(g) || g >> 2 !== c || pions[g] !== BASE) return null;
      const depart = caseDepart(c);
      const q = occupant(pions, depart);
      if (q >= 0) renvoyer(q); // pion adverse, allié ou le sien : retour à la base
      deplacements.push({ pion: g, de: BASE, vers: depart });
      pions[g] = depart;
      frais[g] = true;
      break;
    }
    case 'avance': {
      const g = coup.pion;
      const pas = coup.pas;
      if (!estPion(g) || !PAS_PAR_RANG[r] || !PAS_PAR_RANG[r].includes(pas)) return null;
      const o = g >> 2;
      let res = null;
      if (o === c) {
        res = resoudreAvance(pions, frais, g, pas, !!coup.allee, false);
      } else if (
        r === '5' &&
        etat.reglages.cinqAdverse &&
        equipe(o) !== equipe(siege) &&
        !coup.allee &&
        echangeable(pions, g) // sur le circuit et non protégé
      ) {
        res = resoudreAvance(pions, frais, g, pas, false, false);
      }
      if (!res) return null;
      poser(g, res.pos, res);
      break;
    }
    case 'recul': {
      const g = coup.pion;
      if (r !== '4' || !estPion(g) || g >> 2 !== c) return null;
      const res = resoudreRecul(pions, g);
      if (!res) return null;
      poser(g, res.pos, res);
      break;
    }
    case 'echange': {
      const a = coup.pion;
      const b = coup.cible;
      if (r !== 'V' || !estPion(a) || !estPion(b)) return null;
      if (a >> 2 !== c || b >> 2 === c) return null; // un des siens, jamais deux des siens
      if (!echangeable(pions, a) || !echangeable(pions, b)) return null;
      const pa = pions[a];
      const pb = pions[b];
      deplacements.push({ pion: a, de: pa, vers: pb }, { pion: b, de: pb, vers: pa });
      pions[a] = pb;
      pions[b] = pa;
      break;
    }
    case 'sept': {
      if (r !== '7' || !Array.isArray(coup.etapes) || coup.etapes.length === 0) return null;
      let reste = 7;
      for (const e of coup.etapes) {
        if (!e || !estPion(e.pion) || !Number.isInteger(e.pas) || e.pas < 1 || e.pas > reste) return null;
        const actif = fini(pions, siege) ? partenaire(siege) : siege;
        if (e.pion >> 2 !== actif) return null;
        const res = resoudreAvance(pions, frais, e.pion, e.pas, !!e.allee, true);
        if (!res) return null;
        poser(e.pion, res.pos, res);
        reste -= e.pas;
      }
      if (reste !== 0) return null;
      break;
    }
    default:
      return null;
  }
  return { pions, frais, captures, deplacements };
}

// ---------------------------------------------------------------------------
// Génération des coups légaux
// ---------------------------------------------------------------------------

function coupsAvance(etat, siege, carte, pas, coups) {
  const { pions, frais } = etat;
  const c = couleurActive(etat, siege);
  for (let g = c * 4; g < c * 4 + 4; g++) {
    const p = pions[g];
    if (p === BASE) continue;
    if (p >= ALLEE) {
      if (resoudreAvance(pions, frais, g, pas, true, false)) coups.push({ t: 'avance', carte, pion: g, pas, allee: true });
      continue;
    }
    if (resoudreAvance(pions, frais, g, pas, false, false)) coups.push({ t: 'avance', carte, pion: g, pas, allee: false });
    if (resoudreAvance(pions, frais, g, pas, true, false)) coups.push({ t: 'avance', carte, pion: g, pas, allee: true });
  }
}

function coupsSortie(etat, siege, carte, coups) {
  const c = couleurActive(etat, siege);
  for (let g = c * 4; g < c * 4 + 4; g++) {
    if (etat.pions[g] === BASE) {
      coups.push({ t: 'sortie', carte, pion: g }); // les pions en base sont interchangeables
      return;
    }
  }
}

function clePlateau(pions) {
  return pions.join(',');
}

/** Options d'étape (pion, pas, allee) possibles pour un 7, sans vérifier que le reste est jouable. */
function etapesBrutes(pions, frais, siege, reste) {
  const options = [];
  const c = fini(pions, siege) ? partenaire(siege) : siege;
  for (let g = c * 4; g < c * 4 + 4; g++) {
    const p = pions[g];
    if (p === BASE) continue;
    for (let pas = 1; pas <= reste; pas++) {
      if (p >= ALLEE) {
        const res = resoudreAvance(pions, frais, g, pas, true, true);
        if (res) options.push({ pion: g, pas, allee: true, res });
        continue;
      }
      const tout = resoudreAvance(pions, frais, g, pas, false, true);
      if (tout) options.push({ pion: g, pas, allee: false, res: tout });
      const entree = resoudreAvance(pions, frais, g, pas, true, true);
      if (entree) options.push({ pion: g, pas, allee: true, res: entree });
    }
  }
  return options;
}

function appliquerEtape(pions, frais, option) {
  const np = pions.slice();
  const nf = frais.slice();
  for (const q of option.res.captures) {
    np[q] = BASE;
    nf[q] = false;
  }
  np[option.pion] = option.res.pos;
  nf[option.pion] = false;
  return [np, nf];
}

/** Toutes les façons distinctes (par plateau final) de jouer un 7 en entier. */
function coupsSept(etat, siege, carte, coups) {
  const finals = new Set();
  const vus = new Set();
  const etapes = [];
  const explorer = (pions, frais, reste) => {
    const cle = clePlateau(pions);
    if (reste === 0) {
      if (!finals.has(cle)) {
        finals.add(cle);
        coups.push({ t: 'sept', carte, etapes: etapes.map((e) => ({ ...e })) });
      }
      return;
    }
    const cleReste = cle + '|' + reste;
    if (vus.has(cleReste)) return;
    vus.add(cleReste);
    for (const option of etapesBrutes(pions, frais, siege, reste)) {
      const [np, nf] = appliquerEtape(pions, frais, option);
      etapes.push({ pion: option.pion, pas: option.pas, allee: option.allee });
      explorer(np, nf, reste - option.pas);
      etapes.pop();
    }
  };
  explorer(etat.pions, etat.frais, 7);
}

function septCompletable(pions, frais, siege, reste, memo) {
  if (reste === 0) return true;
  const cle = clePlateau(pions) + '|' + reste;
  if (memo.has(cle)) return memo.get(cle);
  let ok = false;
  for (const option of etapesBrutes(pions, frais, siege, reste)) {
    const [np, nf] = appliquerEtape(pions, frais, option);
    if (septCompletable(np, nf, siege, reste - option.pas, memo)) {
      ok = true;
      break;
    }
  }
  memo.set(cle, ok);
  return ok;
}

/**
 * Aide à la saisie d'un 7 étape par étape (interface).
 * @param etapes  étapes déjà choisies : [{ pion, pas, allee }, …]
 * @returns {{reste:number, options:{pion:number, pas:number, allee:boolean, vers:number, captures:number[]}[]}|null}
 *          options : étapes suivantes permettant encore d'utiliser les 7 points en entier ;
 *          null si les étapes déjà choisies sont illégales.
 */
export function etapesSeptPossibles(etat, siege, etapes = []) {
  let pions = etat.pions;
  let frais = etat.frais;
  let reste = 7;
  for (const e of etapes) {
    if (!e || !estPion(e.pion) || !Number.isInteger(e.pas) || e.pas < 1 || e.pas > reste) return null;
    const actif = fini(pions, siege) ? partenaire(siege) : siege;
    if (e.pion >> 2 !== actif) return null;
    const res = resoudreAvance(pions, frais, e.pion, e.pas, !!e.allee, true);
    if (!res) return null;
    [pions, frais] = appliquerEtape(pions, frais, { pion: e.pion, res });
    reste -= e.pas;
  }
  const memo = new Map();
  const options = [];
  for (const option of etapesBrutes(pions, frais, siege, reste)) {
    const [np, nf] = appliquerEtape(pions, frais, option);
    if (septCompletable(np, nf, siege, reste - option.pas, memo)) {
      options.push({
        pion: option.pion,
        pas: option.pas,
        allee: option.allee,
        vers: option.res.pos,
        captures: option.res.captures.slice(),
      });
    }
  }
  return { reste, options };
}

/**
 * Coups légaux du joueur `siege` avec la carte `carte` (hors défausse).
 * Ne vérifie ni le tour ni la possession de la carte.
 */
export function coupsLegaux(etat, siege, carte) {
  const coups = [];
  const r = rang(carte);
  switch (r) {
    case 'A':
    case 'R':
      coupsSortie(etat, siege, carte, coups);
      for (const pas of PAS_PAR_RANG[r]) coupsAvance(etat, siege, carte, pas, coups);
      break;
    case 'V': {
      const c = couleurActive(etat, siege);
      for (let a = c * 4; a < c * 4 + 4; a++) {
        if (!echangeable(etat.pions, a)) continue;
        for (let b = 0; b < NB_PIONS; b++) {
          if (b >> 2 !== c && echangeable(etat.pions, b)) coups.push({ t: 'echange', carte, pion: a, cible: b });
        }
      }
      break;
    }
    case '7':
      coupsSept(etat, siege, carte, coups);
      break;
    case '4': {
      const c = couleurActive(etat, siege);
      for (let g = c * 4; g < c * 4 + 4; g++) {
        if (resoudreRecul(etat.pions, g)) coups.push({ t: 'recul', carte, pion: g });
      }
      break;
    }
    default:
      if (!PAS_PAR_RANG[r]) break;
      for (const pas of PAS_PAR_RANG[r]) coupsAvance(etat, siege, carte, pas, coups);
      if (r === '5' && etat.reglages.cinqAdverse) {
        for (let g = 0; g < NB_PIONS; g++) {
          if (equipe(g >> 2) === equipe(siege) || !echangeable(etat.pions, g)) continue;
          if (resoudreAvance(etat.pions, etat.frais, g, 5, false, false)) {
            coups.push({ t: 'avance', carte, pion: g, pas: 5, allee: false });
          }
        }
      }
  }
  return coups;
}

/** La carte offre-t-elle au moins un coup légal ? */
export function carteJouable(etat, siege, carte) {
  return coupsLegaux(etat, siege, carte).length > 0;
}

/** Le joueur peut-il jouer au moins une carte de sa main ? (sinon il doit défausser) */
export function mainJouable(etat, siege, main) {
  const vus = new Set();
  for (const carte of main) {
    const r = rang(carte);
    if (vus.has(r)) continue;
    vus.add(r);
    if (carteJouable(etat, siege, carte)) return true;
  }
  return false;
}

/**
 * Tous les coups possibles avec une main : coups légaux de chaque carte ou, si aucune
 * carte n'est jouable, une défausse par carte. Les cartes de même rang sont équivalentes :
 * seule la première de chaque rang est développée.
 */
export function coupsLegauxMain(etat, siege, main) {
  const coups = [];
  const vus = new Set();
  for (const carte of main) {
    const r = rang(carte);
    if (vus.has(r)) continue;
    vus.add(r);
    for (const coup of coupsLegaux(etat, siege, carte)) coups.push(coup);
  }
  if (coups.length > 0) return coups;
  vus.clear();
  for (const carte of main) {
    const r = rang(carte);
    if (vus.has(r)) continue;
    vus.add(r);
    coups.push({ t: 'defausse', carte });
  }
  return coups;
}

// ---------------------------------------------------------------------------
// Validation et application
// ---------------------------------------------------------------------------

/**
 * Vérifie un coup. `main` est la main du joueur ; si elle est fournie, la possession
 * de la carte et la légalité d'une défausse sont contrôlées.
 * @returns {string|null} message d'erreur, ou null si le coup est légal
 */
export function validerCoup(etat, siege, coup, main) {
  if (etat.phase !== 'jeu') return "La partie n'est pas en phase de jeu.";
  if (etat.tour !== siege) return "Ce n'est pas à ce joueur de jouer.";
  if (!coup || typeof coup.carte !== 'string') return 'Coup mal formé.';
  if (main && !main.includes(coup.carte)) return "Cette carte n'est pas dans la main du joueur.";
  if (coup.t === 'defausse') {
    if (main && mainJouable(etat, siege, main)) return 'Défausse interdite : une carte est jouable.';
    return null;
  }
  return jouerSurPlateau(etat, siege, coup) ? null : 'Coup illégal.';
}

/** Aperçu d'un coup sans l'appliquer : plateau obtenu, captures et déplacements (ou null). */
export function apercuCoup(etat, siege, coup) {
  if (coup && coup.t === 'defausse') {
    return { pions: etat.pions.slice(), frais: etat.frais.slice(), captures: [], deplacements: [] };
  }
  return jouerSurPlateau(etat, siege, coup);
}

function equipeGagnante(pions) {
  if (fini(pions, 0) && fini(pions, 2)) return 0;
  if (fini(pions, 1) && fini(pions, 3)) return 1;
  return null;
}

/**
 * Applique un coup et renvoie le nouvel état (l'état d'origine n'est pas modifié).
 * Lève une erreur si le coup est illégal.
 */
export function appliquerCoup(etat, siege, coup, main) {
  const erreur = validerCoup(etat, siege, coup, main);
  if (erreur) throw new Error(erreur);
  const res =
    coup.t === 'defausse'
      ? { pions: etat.pions.slice(), frais: etat.frais.slice(), captures: [], deplacements: [] }
      : jouerSurPlateau(etat, siege, coup);

  const n = clonerEtat(etat);
  n.pions = res.pions;
  n.frais = res.frais;
  n.pile.push(coup.carte);
  n.cartesRestantes[siege] -= 1;
  n.numCoup += 1;
  n.dernierCoup = { siege, coup, captures: res.captures, deplacements: res.deplacements };

  const gagnant = equipeGagnante(n.pions);
  if (gagnant !== null) {
    n.phase = 'fini';
    n.gagnant = gagnant;
    return n;
  }

  if (n.cartesRestantes.every((k) => k === 0)) {
    // Fin de la donne : nouvelle distribution, nouvel échange de cartes.
    n.donne += 1;
    n.phase = 'echange';
    n.echanges = [false, false, false, false];
    n.cartesRestantes = Array(4).fill(tailleDonne(n.donne));
    n.tour = n.donne % 4;
    if (n.donne % 3 === 0) n.pile = []; // paquet épuisé : on remélange
  } else {
    n.tour = (siege + 1) % 4;
  }
  return n;
}

/**
 * Enregistre que `siege` a donné sa carte à son partenaire (phase d'échange).
 * Quand les quatre joueurs ont donné, la phase de jeu commence.
 */
export function marquerEchange(etat, siege) {
  if (etat.phase !== 'echange') throw new Error("Ce n'est pas la phase d'échange.");
  if (etat.echanges[siege]) throw new Error('Ce joueur a déjà donné sa carte.');
  const n = clonerEtat(etat);
  n.echanges[siege] = true;
  n.numCoup += 1;
  if (n.echanges.every(Boolean)) n.phase = 'jeu';
  return n;
}

/** Une nouvelle distribution (mélange) est-elle nécessaire pour la donne courante ? */
export function debutDeCycle(etat) {
  return etat.donne % 3 === 0;
}
