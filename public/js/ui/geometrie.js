// Géométrie du plateau affiché (logique pure, testée dans tests/ui-geometrie.test.js).
//
// Le plateau est une grille 17 × 17 : le circuit de 64 cases en fait le pourtour (16 cases par côté).
// Coordonnées « de grille » (u, v) : colonne et rangée de 0 à 16, le centre de la case centrale est (8, 8) ;
// des valeurs fractionnaires sont permises (emplacements des bases).
//
// Vue : le joueur local est toujours en bas. Pour lui, la case de départ est au milieu de la rangée du bas
// (8, 16) et les indices croissants partent vers la gauche : le parcours tourne dans le sens horaire à l'écran
// (bas → gauche → haut → droite). Son partenaire est en haut, l'adversaire suivant (siège + 1) à gauche,
// le précédent à droite. La case d'entrée de l'allée est 3 cases avant la case de départ, donc à sa droite
// (11, 16) ; l'allée monte de là vers le centre : (11, 15), (11, 14), (11, 13), (11, 12).
// La base (4 emplacements en carré 2 × 2) est juste derrière la case de départ, vers l'intérieur, centrée sur elle.
// Les autres côtés s'obtiennent par rotation d'un quart de tour (sens horaire à l'écran) autour du centre.
//
// Jeu à 3 : plateau triangulaire (triangle équilatéral de 3 côtés de 16 cases, 48 cases). Chaque joueur garde la
// disposition du jeu à 4 (sortie au milieu de son côté, entrée 3 cases à droite, allée de 4 cases vers
// l'intérieur), sauf la base, accolée à la case de sortie À L'EXTÉRIEUR du circuit. Les autres côtés
// s'obtiennent par rotation de 120° (sens horaire à l'écran) autour du centre de gravité.
//
// Le plateau dessiné (plateau.js) ne parle qu'à l'objet renvoyé par geometrie(nbJoueurs), en unités SVG.

import { BASE, ALLEE, NB_CASES, caseDepart, caseEntree, nbCases } from '../moteur/plateau.js';

export const TAILLE = 17;
/** Taille d'une case en unités SVG. */
export const CELLULE = 10;
export const CENTRE = 8;

/** Coordonnées de grille de la j-ième case du circuit en partant de la case de départ du joueur du bas. */
export function caseCircuitRelative(j) {
  j = ((j % NB_CASES) + NB_CASES) % NB_CASES;
  if (j <= 8) return { u: 8 - j, v: 16 };
  if (j <= 24) return { u: 0, v: 16 - (j - 8) };
  if (j <= 40) return { u: j - 24, v: 0 };
  if (j <= 56) return { u: 16, v: j - 40 };
  return { u: 16 - (j - 56), v: 16 };
}

/** Rotation de q quarts de tour dans le sens horaire de l'écran autour du centre du plateau. */
export function tourner(p, q) {
  let dx = p.u - CENTRE;
  let dy = p.v - CENTRE;
  for (let i = 0; i < ((q % 4) + 4) % 4; i++) [dx, dy] = [-dy, dx];
  return { u: CENTRE + dx, v: CENTRE + dy };
}

/** Côté où est affiché un siège : 0 bas (joueur local), 1 gauche, 2 haut (partenaire), 3 droite. */
export const coteDe = (siege, siegeVue) => (((siege - siegeVue) % 4) + 4) % 4;
export const NOMS_COTES = ['bas', 'gauche', 'haut', 'droite'];

/** Allée du joueur du bas : k-ième case. */
const alleeBas = (k) => ({ u: 11, v: 15 - k });
/** Emplacements de base du joueur du bas (2 × 2, derrière la case de départ, sans toucher circuit ni allée). */
const BASE_BAS = [
  { u: 7.4, v: 13.3 },
  { u: 8.6, v: 13.3 },
  { u: 7.4, v: 14.5 },
  { u: 8.6, v: 14.5 },
];

/** Case du circuit `i` (0..63) vue par `siegeVue`. */
export function caseCircuit(i, siegeVue) {
  return caseCircuitRelative(i - caseDepart(siegeVue));
}

/** k-ième case de l'allée du siège `siege`. */
export function caseAllee(siege, k, siegeVue) {
  return tourner(alleeBas(k), coteDe(siege, siegeVue));
}

/** Emplacement `n` (0..3) de la base du siège `siege`. */
export function emplacementBase(siege, n, siegeVue) {
  return tourner(BASE_BAS[n & 3], coteDe(siege, siegeVue));
}

/** Centre de la zone de base d'un siège (pour son fond). */
export function centreBase(siege, siegeVue) {
  return tourner({ u: 8, v: 13.9 }, coteDe(siege, siegeVue));
}

/**
 * Position de grille d'un pion `pion` placé en `pos` (BASE, circuit ou allée de son propriétaire).
 * En base, chaque pion a son emplacement fixe (pion & 3).
 */
export function positionPion(pion, pos, siegeVue) {
  const o = pion >> 2;
  if (pos === BASE) return emplacementBase(o, pion & 3, siegeVue);
  if (pos >= ALLEE) return caseAllee(o, pos - ALLEE, siegeVue);
  return caseCircuit(pos, siegeVue);
}

/** Coordonnées SVG (centre) d'une position de grille. */
export const versSvg = (p) => ({ x: (p.u + 0.5) * CELLULE, y: (p.v + 0.5) * CELLULE });

/**
 * Boîte de l'étiquette d'un joueur (pseudo, icône, cartes), en unités SVG, upright quel que soit le côté :
 * dans le coin intérieur à sa gauche, le long de son côté (même place pour les quatre, par rotation).
 */
export function boiteEtiquette(cote) {
  const L = 38;
  const H = 34;
  const c = { x: 85, y: 85 };
  let dx = -53;
  let dy = 55;
  for (let i = 0; i < cote; i++) [dx, dy] = [-dy, dx];
  return { x: c.x + dx - L / 2, y: c.y + dy - H / 2, l: L, h: H };
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

/** Petite flèche du sens de parcours le long du côté du joueur du bas (entre son étiquette et sa base). */
export function positionFlecheSens(cote) {
  return tourner({ u: 5.75, v: 14.9 }, cote);
}

// ─── Plateau triangulaire (jeu à 3) ─────────────────────────────────────────

/** Pas entre deux cases (unités SVG), comme une case du plateau carré. */
const PAS = CELLULE;
const COTE_T = 16 * PAS;
const HAUT_T = (COTE_T * Math.sqrt(3)) / 2;
/** Sommets : A en bas à gauche, B en bas à droite, C en haut ; G centre de gravité. */
export const TRIANGLE = {
  A: { x: 0, y: HAUT_T },
  B: { x: COTE_T, y: HAUT_T },
  C: { x: COTE_T / 2, y: 0 },
  G: { x: COTE_T / 2, y: (2 * HAUT_T) / 3 },
};
const lerp = (P, Q, t) => ({ x: P.x + (Q.x - P.x) * t, y: P.y + (Q.y - P.y) * t });

/** j-ième case du circuit triangulaire en partant de la sortie du joueur du bas (indices croissants vers la gauche). */
export function caseTriangleRelative(j) {
  j = ((j % 48) + 48) % 48;
  const { A, B, C } = TRIANGLE;
  if (j <= 8) return { x: COTE_T / 2 - PAS * j, y: HAUT_T };
  if (j <= 24) return lerp(A, C, (j - 8) / 16);
  if (j <= 40) return lerp(C, B, (j - 24) / 16);
  return { x: COTE_T - PAS * (j - 40), y: HAUT_T };
}

/** Rotation de k tiers de tour (120°, sens horaire à l'écran) autour du centre de gravité. */
export function tournerTriangle(p, k) {
  const { G } = TRIANGLE;
  let dx = p.x - G.x;
  let dy = p.y - G.y;
  for (let n = 0; n < ((k % 3) + 3) % 3; n++) [dx, dy] = [-0.5 * dx - 0.8660254 * dy, 0.8660254 * dx - 0.5 * dy];
  return { x: G.x + dx, y: G.y + dy };
}

/** Éléments du joueur du bas sur le triangle (unités SVG). */
const T_ALLEE = (k) => ({ x: COTE_T / 2 + 3 * PAS, y: HAUT_T - PAS * (k + 1) });
const T_BASE_CENTRE = { x: COTE_T / 2, y: HAUT_T + 21.5 };
const T_BASE = [
  { x: COTE_T / 2 - 5.75, y: HAUT_T + 21.5 - 5.75 },
  { x: COTE_T / 2 + 5.75, y: HAUT_T + 21.5 - 5.75 },
  { x: COTE_T / 2 - 5.75, y: HAUT_T + 21.5 + 5.75 },
  { x: COTE_T / 2 + 5.75, y: HAUT_T + 21.5 + 5.75 },
];

// ─── Géométries communes (unités SVG) ───────────────────────────────────────

/**
 * Géométrie du plateau à `nbJoueurs` joueurs (4 : carré, 3 : triangle), en coordonnées SVG.
 * Méthodes : coteDe, caseCircuit, caseAllee, emplacementBase, centreBase, positionPion, angleCote,
 * flecheSens, boiteEtiquette, centre (défausse) ; champs : nbJoueurs, nbCases, cadre (viewBox),
 * TAILLE_BASE (côté du carré de base).
 */
export function geometrie(nbJoueurs = 4) {
  return nbJoueurs === 3 ? GEO_TRIANGLE : GEO_CARRE;
}

function positionPionGeo(geo, pion, pos, vue) {
  const o = pion >> 2;
  if (pos === BASE) return geo.emplacementBase(o, pion & 3, vue);
  if (pos >= ALLEE) return geo.caseAllee(o, pos - ALLEE, vue);
  return geo.caseCircuit(pos, vue);
}

const GEO_CARRE = {
  nbJoueurs: 4,
  nbCases: 64,
  forme: 'carre',
  // Cadre : le plateau (bord en bois de -4,5 à 174,5) et, autour, les bandes des noms des joueurs : 11 unités en
  // haut et en bas (texte horizontal), 9,5 sur les côtés (texte vertical) pour garder le plateau aussi grand que
  // possible sur un téléphone.
  cadre: { x: -14, y: -15.5, l: 198, h: 201 },
  /** Bord extérieur du cadre en bois (les noms sont au-delà). */
  bord: { x: -4.5, y: -4.5, l: 179, h: 179 },
  etiquettesAutour: true,
  TAILLE_BASE: 27,
  coteDe: (siege, vue) => coteDe(siege, vue),
  angleCote: (cote) => cote * 90,
  caseCircuit: (i, vue) => versSvg(caseCircuit(i, vue)),
  caseAllee: (s, k, vue) => versSvg(caseAllee(s, k, vue)),
  emplacementBase: (s, n, vue) => versSvg(emplacementBase(s, n, vue)),
  centreBase: (s, vue) => versSvg(centreBase(s, vue)),
  positionPion(pion, pos, vue) {
    return positionPionGeo(this, pion, pos, vue);
  },
  flecheSens: (cote) => ({ ...versSvg(positionFlecheSens(cote)), angle: cote * 90 + 180 }),
  boiteEtiquette: (cote) => boiteEtiquette(cote),
  /**
   * Nom d'un joueur autour du plateau, centré sur son côté : toi en bas, ton partenaire en haut, les adversaires
   * à gauche (texte qui monte) et à droite (texte qui descend).
   */
  placeEtiquette: (cote) => [
    { x: 85, y: 180, angle: 0, longueur: 176 },
    { x: -9.25, y: 85, angle: -90, longueur: 176 },
    { x: 85, y: -10, angle: 0, longueur: 176 },
    { x: 179.25, y: 85, angle: 90, longueur: 176 },
  ][cote],
  centre: { x: 85, y: 85 },
};

const GEO_TRIANGLE = {
  nbJoueurs: 3,
  nbCases: 48,
  forme: 'triangle',
  // Cadre : le triangle et son liseré, les bases extérieures, et les étiquettes dans les coins libres.
  cadre: { x: -12, y: -12, l: COTE_T + 24, h: HAUT_T + 56 },
  TAILLE_BASE: 23,
  coteDe: (siege, vue) => (((siege - vue) % 3) + 3) % 3,
  angleCote: (cote) => cote * 120,
  caseCircuit: (i, vue) => caseTriangleRelative(i - caseDepart(vue)),
  caseAllee(s, k, vue) {
    return tournerTriangle(T_ALLEE(k), this.coteDe(s, vue));
  },
  emplacementBase(s, n, vue) {
    return tournerTriangle(T_BASE[n & 3], this.coteDe(s, vue));
  },
  centreBase(s, vue) {
    return tournerTriangle(T_BASE_CENTRE, this.coteDe(s, vue));
  },
  positionPion(pion, pos, vue) {
    return positionPionGeo(this, pion, pos, vue);
  },
  flecheSens(cote) {
    // Une flèche par côté, à l'intérieur, entre la 5e et la 6e case après la sortie.
    const a = caseTriangleRelative(5);
    const b = caseTriangleRelative(6);
    const { G } = TRIANGLE;
    const p = tournerTriangle({ x: a.x + (G.x - a.x) * 0.2, y: a.y + (G.y - a.y) * 0.2 }, cote);
    return { ...p, angle: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI + cote * 120 };
  },
  /** Étiquettes hors du triangle : la sienne en bas à gauche, les adversaires dans les coins du haut. */
  boiteEtiquette(cote) {
    const L = 40;
    const H = 34;
    if (cote === 0) return { x: -10, y: HAUT_T + 8, l: L, h: H };
    if (cote === 1) return { x: -10, y: -8, l: L, h: H };
    return { x: COTE_T + 10 - L, y: -8, l: L, h: H };
  },
  centre: { x: TRIANGLE.G.x, y: TRIANGLE.G.y },
};
