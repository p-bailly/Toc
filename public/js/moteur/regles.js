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
//  - L'allée d'arrivée s'ouvre 3 cases avant la case de départ du joueur (case d'entrée,
//    voir plateau.js). Un pion qui passe par sa case d'entrée, ou qui s'y trouve, peut tourner
//    dans l'allée ; ce n'est jamais obligatoire. Tout est affaire de position : un pion sorti
//    puis reculé de 4 est une case avant l'entrée et rentre avec 2 à 5 (5 = fond de l'allée).
//  - Un pion sur la case de départ de sa propre couleur est protégé : aucun déplacement ne
//    peut le dépasser ni s'y arrêter (7 et 4 compris), il ne peut être ni échangé ni déplacé
//    par un adversaire (option « 5 adverse »). Seule la sortie d'un pion de la même couleur
//    le renvoie à la base.
//  - 7 : les 7 points doivent toujours être utilisés en entier, même pour gagner : si le dernier
//    pion est à 4 cases du fond de l'allée, le 7 n'est pas jouable avec lui. Le reste ne peut
//    servir aux pions du partenaire qu'une fois son propre quatrième pion rentré.

import { rang, estCarte, tailleDonne } from './cartes.js';
import { BASE, ALLEE, NB_CASES, NB_PIONS, LONGUEUR_ALLEE, caseDepart, caseEntree, partenaire, equipe } from './plateau.js';

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
function resoudreAvance(pions, g, pas, versAllee, sept) {
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
    const d = (caseEntree(o) - p + NB_CASES) % NB_CASES; // distance jusqu'à sa case d'entrée (0 s'il y est)
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
 * @returns {{pions:number[], captures:number[], deplacements:object[]}|null}
 *          null si le coup est illégal (hors question de main, de tour et de défausse)
 */
function jouerSurPlateau(etat, siege, coup) {
  if (!coup || typeof coup.carte !== 'string') return null;
  const r = rang(coup.carte);
  const pions = etat.pions.slice();
  const captures = [];
  const deplacements = [];
  const c = fini(pions, siege) ? partenaire(siege) : siege;

  const renvoyer = (q) => {
    deplacements.push({ pion: q, de: pions[q], vers: BASE, capture: true });
    pions[q] = BASE;
    captures.push(q);
  };
  const poser = (g, pos, res) => {
    for (const q of res.captures) renvoyer(q);
    deplacements.push({ pion: g, de: pions[g], vers: pos });
    pions[g] = pos;
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
      break;
    }
    case 'avance': {
      const g = coup.pion;
      const pas = coup.pas;
      if (!estPion(g) || !PAS_PAR_RANG[r] || !PAS_PAR_RANG[r].includes(pas)) return null;
      const o = g >> 2;
      let res = null;
      if (o === c) {
        res = resoudreAvance(pions, g, pas, !!coup.allee, false);
      } else if (
        r === '5' &&
        etat.reglages.cinqAdverse &&
        equipe(o) !== equipe(siege) &&
        !coup.allee &&
        echangeable(pions, g) // sur le circuit et non protégé
      ) {
        res = resoudreAvance(pions, g, pas, false, false);
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
        const res = resoudreAvance(pions, e.pion, e.pas, !!e.allee, true);
        if (!res) return null;
        poser(e.pion, res.pos, res);
        reste -= e.pas;
      }
      if (reste !== 0) return null; // les 7 points doivent toujours être utilisés en entier
      break;
    }
    default:
      return null;
  }
  return { pions, captures, deplacements };
}

// ---------------------------------------------------------------------------
// Génération des coups légaux
// ---------------------------------------------------------------------------

function coupsAvance(etat, siege, carte, pas, coups) {
  const { pions } = etat;
  const c = couleurActive(etat, siege);
  for (let g = c * 4; g < c * 4 + 4; g++) {
    const p = pions[g];
    if (p === BASE) continue;
    if (p >= ALLEE) {
      if (resoudreAvance(pions, g, pas, true, false)) coups.push({ t: 'avance', carte, pion: g, pas, allee: true });
      continue;
    }
    if (resoudreAvance(pions, g, pas, false, false)) coups.push({ t: 'avance', carte, pion: g, pas, allee: false });
    if (resoudreAvance(pions, g, pas, true, false)) coups.push({ t: 'avance', carte, pion: g, pas, allee: true });
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
function etapesBrutes(pions, siege, reste) {
  const options = [];
  const c = fini(pions, siege) ? partenaire(siege) : siege;
  for (let g = c * 4; g < c * 4 + 4; g++) {
    const p = pions[g];
    if (p === BASE) continue;
    for (let pas = 1; pas <= reste; pas++) {
      if (p >= ALLEE) {
        const res = resoudreAvance(pions, g, pas, true, true);
        if (res) options.push({ pion: g, pas, allee: true, res });
        continue;
      }
      const tout = resoudreAvance(pions, g, pas, false, true);
      if (tout) options.push({ pion: g, pas, allee: false, res: tout });
      const entree = resoudreAvance(pions, g, pas, true, true);
      if (entree) options.push({ pion: g, pas, allee: true, res: entree });
    }
  }
  return options;
}

function appliquerEtape(pions, option) {
  const np = pions.slice();
  for (const q of option.res.captures) np[q] = BASE;
  np[option.pion] = option.res.pos;
  return np;
}

/**
 * Regroupe les étapes consécutives d'un même pion (3 + 2 du même pion = 5) : dans un 7, tous
 * les pions dépassés sont capturés, donc le plateau obtenu est le même.
 */
function fusionnerEtapes(etapes) {
  const fusion = [];
  for (const e of etapes) {
    const d = fusion[fusion.length - 1];
    if (d && d.pion === e.pion) {
      d.pas += e.pas;
      d.allee = e.allee;
    } else {
      fusion.push({ pion: e.pion, pas: e.pas, allee: e.allee });
    }
  }
  return fusion;
}

/** Toutes les façons distinctes (par plateau final) de jouer un 7 en entier. */
function coupsSept(etat, siege, carte, coups) {
  const finals = new Set();
  const vus = new Set();
  const etapes = [];
  const explorer = (pions, reste) => {
    const cle = clePlateau(pions);
    if (reste === 0) {
      if (!finals.has(cle)) {
        finals.add(cle);
        coups.push({ t: 'sept', carte, etapes: fusionnerEtapes(etapes) });
      }
      return;
    }
    const cleReste = cle + '|' + reste;
    if (vus.has(cleReste)) return;
    vus.add(cleReste);
    for (const option of etapesBrutes(pions, siege, reste)) {
      etapes.push({ pion: option.pion, pas: option.pas, allee: option.allee });
      explorer(appliquerEtape(pions, option), reste - option.pas);
      etapes.pop();
    }
  };
  explorer(etat.pions, 7);
}

function septCompletable(pions, siege, reste, memo) {
  if (reste === 0) return true;
  const cle = clePlateau(pions) + '|' + reste;
  if (memo.has(cle)) return memo.get(cle);
  let ok = false;
  for (const option of etapesBrutes(pions, siege, reste)) {
    if (septCompletable(appliquerEtape(pions, option), siege, reste - option.pas, memo)) {
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
 * @returns {{reste:number, complet:boolean, options:{pion:number, pas:number, allee:boolean, vers:number, captures:number[]}[]}|null}
 *          reste : points non encore utilisés ;
 *          complet : les 7 points sont utilisés, le coup peut être joué (reste = 0) ;
 *          options : étapes suivantes permettant encore de terminer le 7 ;
 *          null si les étapes déjà choisies sont illégales.
 */
export function etapesSeptPossibles(etat, siege, etapes = []) {
  if (!Array.isArray(etapes)) return null;
  let pions = etat.pions;
  let reste = 7;
  for (const e of etapes) {
    if (!e || !estPion(e.pion) || !Number.isInteger(e.pas) || e.pas < 1 || e.pas > reste) return null;
    const actif = fini(pions, siege) ? partenaire(siege) : siege;
    if (e.pion >> 2 !== actif) return null;
    const res = resoudreAvance(pions, e.pion, e.pas, !!e.allee, true);
    if (!res) return null;
    pions = appliquerEtape(pions, { pion: e.pion, res });
    reste -= e.pas;
  }
  const memo = new Map();
  const options = [];
  for (const option of etapesBrutes(pions, siege, reste)) {
    if (septCompletable(appliquerEtape(pions, option), siege, reste - option.pas, memo)) {
      options.push({
        pion: option.pion,
        pas: option.pas,
        allee: option.allee,
        vers: option.res.pos,
        captures: option.res.captures.slice(),
      });
    }
  }
  return { reste, complet: reste === 0, options };
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
          if (resoudreAvance(etat.pions, g, 5, false, false)) {
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
  if (!coup || !estCarte(coup.carte)) return 'Coup mal formé.';
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
    return { pions: etat.pions.slice(), captures: [], deplacements: [] };
  }
  return jouerSurPlateau(etat, siege, coup);
}

/**
 * Copie d'un coup réduite à ses champs utiles (sans valeur indéfinie : enregistrable tel quel).
 * Le coup doit être bien formé (validé).
 */
export function normaliserCoup(coup) {
  switch (coup.t) {
    case 'sortie':
    case 'recul':
      return { t: coup.t, carte: coup.carte, pion: coup.pion };
    case 'avance':
      return { t: 'avance', carte: coup.carte, pion: coup.pion, pas: coup.pas, allee: !!coup.allee };
    case 'echange':
      return { t: 'echange', carte: coup.carte, pion: coup.pion, cible: coup.cible };
    case 'sept':
      return {
        t: 'sept',
        carte: coup.carte,
        etapes: coup.etapes.map((e) => ({ pion: e.pion, pas: e.pas, allee: !!e.allee })),
      };
    default:
      return { t: 'defausse', carte: coup.carte };
  }
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
      ? { pions: etat.pions.slice(), captures: [], deplacements: [] }
      : jouerSurPlateau(etat, siege, coup);

  const n = clonerEtat(etat);
  n.pions = res.pions;
  n.pile.push(coup.carte);
  n.cartesRestantes[siege] -= 1;
  n.numCoup += 1;
  n.dernierCoup = { siege, coup: normaliserCoup(coup), captures: res.captures, deplacements: res.deplacements };

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
  if (!Number.isInteger(siege) || siege < 0 || siege > 3) throw new Error('Siège invalide.');
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
