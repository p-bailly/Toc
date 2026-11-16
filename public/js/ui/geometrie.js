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
// La base (4 emplacements) est de l'autre côté de la case de départ, à sa gauche.
// Les autres côtés s'obtiennent par rotation d'un quart de tour (sens horaire à l'écran) autour du centre.

import { BASE, ALLEE, NB_CASES, caseDepart, caseEntree } from '../moteur/plateau.js';

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
/** Emplacements de base du joueur du bas (2 × 2, à gauche de la case de départ). */
const BASE_BAS = [
  { u: 5.5, v: 13.5 },
  { u: 6.5, v: 13.5 },
  { u: 5.5, v: 14.5 },
  { u: 6.5, v: 14.5 },
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
  return tourner({ u: 6, v: 14 }, coteDe(siege, siegeVue));
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
 * dans le coin intérieur à gauche de sa base, vu de lui (même place pour les quatre, par rotation).
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
export function chemin(pion, de, vers, sens = 'avant') {
  if (sens === 'direct' || de === BASE || vers === BASE || de === vers) return [de, vers];
  const o = pion >> 2;
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
  const cible = vers >= ALLEE ? caseEntree(o) : vers;
  let p = de;
  for (let n = 0; n < NB_CASES && p !== cible; n++) {
    p = (p + 1) % NB_CASES;
    etapes.push(p);
  }
  if (vers >= ALLEE) for (let k = 0; k <= vers - ALLEE; k++) etapes.push(ALLEE + k);
  return etapes;
}
