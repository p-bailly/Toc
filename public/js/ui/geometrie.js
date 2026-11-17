// Géométrie du plateau affiché (logique pure, testée dans tests/ui-geometrie*.test.js).
//
// Le plateau carré est une grille de (c + 1) × (c + 1) cases, où c est le nombre de cases d'un côté (18 ; 16 pour
// les premières parties, voir moteur/plateau.js) : le circuit de 4 × c cases en fait le pourtour.
// Coordonnées « de grille » (u, v) : colonne et rangée de 0 à c, le centre de la case centrale est (c/2, c/2) ;
// des valeurs fractionnaires sont permises (emplacements des bases).
//
// Vue : le joueur local est toujours en bas. Pour lui, la case de départ est au milieu de la rangée du bas
// (c/2, c) et les indices croissants partent vers la gauche : le parcours tourne dans le sens horaire à l'écran
// (bas → gauche → haut → droite). Son partenaire est en haut, l'adversaire suivant (siège + 1) à gauche,
// le précédent à droite. La case d'entrée de l'allée est 3 cases avant la case de départ, donc à sa droite
// (c/2 + 3, c) ; l'allée monte de là vers le centre, sur 4 cases.
// La base (4 emplacements en carré 2 × 2) est juste derrière la case de départ, vers l'intérieur, centrée sur elle.
// Les autres côtés s'obtiennent par rotation d'un quart de tour (sens horaire à l'écran) autour du centre.
//
// Jeu à 3 : plateau triangulaire (triangle équilatéral de 3 côtés de c cases). Chaque joueur garde la
// disposition du jeu à 4 (sortie au milieu de son côté, entrée 3 cases à droite, allée de 4 cases vers
// l'intérieur), sauf la base, accolée à la case de sortie À L'EXTÉRIEUR du circuit. Les autres côtés
// s'obtiennent par rotation de 120° (sens horaire à l'écran) autour du centre de gravité.
//
// Le plateau dessiné (plateau.js) ne parle qu'à l'objet renvoyé par geometrie(nbJoueurs, cote), en unités SVG.
// Les fonctions exportées qui ne reçoivent pas de côté travaillent sur le plateau visé (COTE de moteur/plateau.js).

import { BASE, ALLEE, COTE, caseEntree, nbCases } from '../moteur/plateau.js';

/** Taille d'une case en unités SVG. */
export const CELLULE = 10;

/** Coordonnées de grille de la j-ième case du circuit en partant de la case de départ du joueur du bas. */
export function caseCircuitRelative(j, c = COTE) {
  const n = 4 * c;
  const m = c / 2;
  j = ((j % n) + n) % n;
  if (j <= m) return { u: m - j, v: c };
  if (j <= m + c) return { u: 0, v: c - (j - m) };
  if (j <= m + 2 * c) return { u: j - m - c, v: 0 };
  if (j <= m + 3 * c) return { u: c, v: j - m - 2 * c };
  return { u: c - (j - m - 3 * c), v: c };
}

/** Rotation de q quarts de tour dans le sens horaire de l'écran autour du centre du plateau. */
export function tourner(p, q, c = COTE) {
  const centre = c / 2;
  let dx = p.u - centre;
  let dy = p.v - centre;
  for (let i = 0; i < ((q % 4) + 4) % 4; i++) [dx, dy] = [-dy, dx];
  return { u: centre + dx, v: centre + dy };
}

/** Côté où est affiché un siège : 0 bas (joueur local), 1 gauche, 2 haut (partenaire), 3 droite. */
export const coteDe = (siege, siegeVue) => (((siege - siegeVue) % 4) + 4) % 4;
export const NOMS_COTES = ['bas', 'gauche', 'haut', 'droite'];

/** Allée du joueur du bas : k-ième case. */
const alleeBas = (k, c) => ({ u: c / 2 + 3, v: c - 1 - k });
/** Emplacements de base du joueur du bas (2 × 2, derrière la case de départ, sans toucher circuit ni allée). */
const baseBas = (n, c) => ({ u: c / 2 + (n & 1 ? 0.6 : -0.6), v: c - (n & 2 ? 1.5 : 2.7) });

/** Case du circuit `i` vue par `siegeVue`. */
export function caseCircuit(i, siegeVue, c = COTE) {
  return caseCircuitRelative(i - siegeVue * c, c);
}

/** k-ième case de l'allée du siège `siege`. */
export function caseAllee(siege, k, siegeVue, c = COTE) {
  return tourner(alleeBas(k, c), coteDe(siege, siegeVue), c);
}

/** Emplacement `n` (0..3) de la base du siège `siege`. */
export function emplacementBase(siege, n, siegeVue, c = COTE) {
  return tourner(baseBas(n & 3, c), coteDe(siege, siegeVue), c);
}

/** Centre de la zone de base d'un siège (pour son fond). */
export function centreBase(siege, siegeVue, c = COTE) {
  return tourner({ u: c / 2, v: c - 2.1 }, coteDe(siege, siegeVue), c);
}

/**
 * Position de grille d'un pion `pion` placé en `pos` (BASE, circuit ou allée de son propriétaire).
 * En base, chaque pion a son emplacement fixe (pion & 3).
 */
export function positionPion(pion, pos, siegeVue, c = COTE) {
  const o = pion >> 2;
  if (pos === BASE) return emplacementBase(o, pion & 3, siegeVue, c);
  if (pos >= ALLEE) return caseAllee(o, pos - ALLEE, siegeVue, c);
  return caseCircuit(pos, siegeVue, c);
}

/** Coordonnées SVG (centre) d'une position de grille. */
export const versSvg = (p) => ({ x: (p.u + 0.5) * CELLULE, y: (p.v + 0.5) * CELLULE });

/**
 * Boîte de l'étiquette d'un joueur (pseudo, icône, cartes), en unités SVG, upright quel que soit le côté :
 * dans le coin intérieur à sa gauche, le long de son côté (même place pour les quatre, par rotation).
 */
export function boiteEtiquette(cote, c = COTE) {
  const L = 38;
  const H = 34;
  const milieu = ((c + 1) * CELLULE) / 2;
  let dx = 32 - milieu;
  let dy = milieu - 30;
  for (let i = 0; i < cote; i++) [dx, dy] = [-dy, dx];
  return { x: milieu + dx - L / 2, y: milieu + dy - H / 2, l: L, h: H };
}

/**
 * Suite de positions (moteur) parcourues par un pion, pour animer son déplacement case par case.
 * @param {number} pion
 * @param {number} de     position de départ
 * @param {number} vers   position d'arrivée
 * @param {'avant'|'arriere'|'direct'} sens   direct : saut (sortie, échange, retour à la base)
 * @returns {number[]}    positions, de `de` à `vers` compris
 */
export function chemin(pion, de, vers, sens = 'avant', nbJoueurs = 4) {
  if (sens === 'direct' || de === BASE || vers === BASE || de === vers) return [de, vers];
  const o = pion >> 2;
  const NB_CASES = nbCases(nbJoueurs);
  const etapes = [de];
  if (sens === 'arriere') {
    if (de >= ALLEE || vers >= ALLEE) return [de, vers];
    let p = de;
    for (let n = 0; n < NB_CASES && p !== vers; n++) {
      p = (p - 1 + NB_CASES) % NB_CASES;
      etapes.push(p);
    }
    return etapes;
  }
  if (de >= ALLEE) {
    for (let k = de - ALLEE + 1; k <= vers - ALLEE; k++) etapes.push(ALLEE + k);
    return etapes;
  }
  const cible = vers >= ALLEE ? caseEntree(o, nbJoueurs) : vers;
  let p = de;
  for (let n = 0; n < NB_CASES && p !== cible; n++) {
    p = (p + 1) % NB_CASES;
    etapes.push(p);
  }
  if (vers >= ALLEE) for (let k = 0; k <= vers - ALLEE; k++) etapes.push(ALLEE + k);
  return etapes;
}

// ─── Plateau triangulaire (jeu à 3) ─────────────────────────────────────────

/** Pas entre deux cases (unités SVG), comme une case du plateau carré. */
const PAS = CELLULE;
const lerp = (P, Q, t) => ({ x: P.x + (Q.x - P.x) * t, y: P.y + (Q.y - P.y) * t });

/** Triangle de côté c cases. Sommets : A en bas à gauche, B en bas à droite, C en haut ; G centre de gravité. */
function triangleDe(c) {
  const cote = c * PAS;
  const haut = (cote * Math.sqrt(3)) / 2;
  return {
    A: { x: 0, y: haut },
    B: { x: cote, y: haut },
    C: { x: cote / 2, y: 0 },
    G: { x: cote / 2, y: (2 * haut) / 3 },
    cote,
    haut,
  };
}
const TRIANGLES = {};
const triangle = (c) => (TRIANGLES[c] ||= triangleDe(c));

/** j-ième case du circuit triangulaire en partant de la sortie du joueur du bas (indices croissants vers la gauche). */
export function caseTriangleRelative(j, c = COTE) {
  const n = 3 * c;
  const m = c / 2;
  j = ((j % n) + n) % n;
  const { A, B, C, cote, haut } = triangle(c);
  if (j <= m) return { x: cote / 2 - PAS * j, y: haut };
  if (j <= m + c) return lerp(A, C, (j - m) / c);
  if (j <= m + 2 * c) return lerp(C, B, (j - m - c) / c);
  return { x: cote - PAS * (j - m - 2 * c), y: haut };
}

/** Rotation de k tiers de tour (120°, sens horaire à l'écran) autour du centre de gravité. */
export function tournerTriangle(p, k, c = COTE) {
  const { G } = triangle(c);
  let dx = p.x - G.x;
  let dy = p.y - G.y;
  for (let n = 0; n < ((k % 3) + 3) % 3; n++) [dx, dy] = [-0.5 * dx - 0.8660254 * dy, 0.8660254 * dx - 0.5 * dy];
  return { x: G.x + dx, y: G.y + dy };
}

// ─── Géométries communes (unités SVG) ───────────────────────────────────────

/**
 * Géométrie du plateau à `nbJoueurs` joueurs (4 : carré, 3 : triangle) de `cote` cases par côté (défaut : le
 * plateau visé), en coordonnées SVG.
 * Méthodes : coteDe, caseCircuit, caseAllee, emplacementBase, centreBase, positionPion, angleCote,
 * boiteEtiquette, centre (défausse) ; champs : nbJoueurs, nbCases, casesParCote, cadre (viewBox),
 * TAILLE_BASE (côté du carré de base), cote (côté du tapis carré), triangle (sommets, à 3 joueurs).
 * Deux appels avec les mêmes arguments renvoient le même objet.
 */
export function geometrie(nbJoueurs = 4, cote = COTE) {
  const cle = (nbJoueurs === 3 ? 't' : 'c') + cote;
  return (GEOMETRIES[cle] ||= nbJoueurs === 3 ? geoTriangle(cote) : geoCarre(cote));
}
const GEOMETRIES = {};

function positionPionGeo(geo, pion, pos, vue) {
  const o = pion >> 2;
  if (pos === BASE) return geo.emplacementBase(o, pion & 3, vue);
  if (pos >= ALLEE) return geo.caseAllee(o, pos - ALLEE, vue);
  return geo.caseCircuit(pos, vue);
}

function geoCarre(c) {
  /** Côté du tapis, et son milieu. */
  const L = (c + 1) * CELLULE;
  const M = L / 2;
  return {
    nbJoueurs: 4,
    nbCases: 4 * c,
    casesParCote: c,
    forme: 'carre',
    cote: L,
    // Cadre : le plateau (bord en bois, 4,5 unités autour du tapis) et, autour, les bandes des noms des joueurs :
    // 11 unités en haut et en bas (texte horizontal), 9,5 sur les côtés (texte vertical) pour garder le plateau
    // aussi grand que possible sur un téléphone.
    cadre: { x: -14, y: -15.5, l: L + 28, h: L + 31 },
    /** Bord extérieur du cadre en bois (les noms sont au-delà). */
    bord: { x: -4.5, y: -4.5, l: L + 9, h: L + 9 },
    etiquettesAutour: true,
    TAILLE_BASE: 27,
    coteDe: (siege, vue) => coteDe(siege, vue),
    angleCote: (cote) => cote * 90,
    caseCircuit: (i, vue) => versSvg(caseCircuit(i, vue, c)),
    caseAllee: (s, k, vue) => versSvg(caseAllee(s, k, vue, c)),
    emplacementBase: (s, n, vue) => versSvg(emplacementBase(s, n, vue, c)),
    centreBase: (s, vue) => versSvg(centreBase(s, vue, c)),
    positionPion(pion, pos, vue) {
      return positionPionGeo(this, pion, pos, vue);
    },
    boiteEtiquette: (cote) => boiteEtiquette(cote, c),
    /**
     * Nom d'un joueur autour du plateau, centré sur son côté : toi en bas, ton partenaire en haut, les adversaires
     * à gauche (texte qui monte) et à droite (texte qui descend).
     */
    placeEtiquette: (cote) => [
      { x: M, y: L + 10, angle: 0, longueur: L + 6 },
      { x: -9.25, y: M, angle: -90, longueur: L + 6 },
      { x: M, y: -10, angle: 0, longueur: L + 6 },
      { x: L + 9.25, y: M, angle: 90, longueur: L + 6 },
    ][cote],
    centre: { x: M, y: M },
  };
}

function geoTriangle(c) {
  const T = triangle(c);
  const { cote: COTE_T, haut: HAUT_T } = T;
  /** Éléments du joueur du bas sur le triangle (unités SVG). */
  const allee = (k) => ({ x: COTE_T / 2 + 3 * PAS, y: HAUT_T - PAS * (k + 1) });
  const centreB = { x: COTE_T / 2, y: HAUT_T + 21.5 };
  const base = (n) => ({ x: COTE_T / 2 + (n & 1 ? 5.75 : -5.75), y: HAUT_T + 21.5 + (n & 2 ? 5.75 : -5.75) });
  return {
    nbJoueurs: 3,
    nbCases: 3 * c,
    casesParCote: c,
    forme: 'triangle',
    triangle: T,
    // Cadre : le triangle et son liseré, les bases extérieures, et les étiquettes dans les coins libres.
    cadre: { x: -12, y: -12, l: COTE_T + 24, h: HAUT_T + 56 },
    TAILLE_BASE: 23,
    coteDe: (siege, vue) => (((siege - vue) % 3) + 3) % 3,
    angleCote: (cote) => cote * 120,
    caseCircuit: (i, vue) => caseTriangleRelative(i - vue * c, c),
    caseAllee(s, k, vue) {
      return tournerTriangle(allee(k), this.coteDe(s, vue), c);
    },
    emplacementBase(s, n, vue) {
      return tournerTriangle(base(n & 3), this.coteDe(s, vue), c);
    },
    centreBase(s, vue) {
      return tournerTriangle(centreB, this.coteDe(s, vue), c);
    },
    positionPion(pion, pos, vue) {
      return positionPionGeo(this, pion, pos, vue);
    },
    /** Étiquettes hors du triangle : la sienne en bas à gauche, les adversaires dans les coins du haut. */
    boiteEtiquette(cote) {
      const L = 40;
      const H = 34;
      if (cote === 0) return { x: -10, y: HAUT_T + 8, l: L, h: H };
      if (cote === 1) return { x: -10, y: -8, l: L, h: H };
      return { x: COTE_T + 10 - L, y: -8, l: L, h: H };
    },
    centre: { x: T.G.x, y: T.G.y },
  };
}
