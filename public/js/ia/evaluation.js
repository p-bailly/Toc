// Fonction d'évaluation d'une position de Toc, du point de vue d'une équipe.
//
// Unité : le « pas » (une case de progression). Composantes :
//  - progression de chaque pion (distance restante jusqu'à l'allée), bonus de sortie ;
//  - pions rentrés, avec pénalité pour les « trous » laissés au-dessus d'eux dans l'allée
//    (un pion rentré trop bas bloque l'entrée des suivants) ;
//  - exposition aux captures : pour chaque pion du circuit, probabilité qu'un adversaire qui
//    joue avant que le propriétaire puisse réagir possède une carte qui le capture (distance
//    exacte, 7 qui dépasse, 4 en arrière, sortie sur une case de départ), calculée à partir des
//    cartes non vues (loi hypergéométrique) ; symétriquement, les menaces de notre équipe ;
//  - blocages par un pion protégé sur sa case de départ ;
//  - valeur des cartes gardées en main par le joueur (as/roi pour sortir, 4 pour la manœuvre
//    arrière, 7, valet, petites cartes pour avancer dans l'allée).

import { BASE, ALLEE, R_A, R_4, R_7, R_V, R_R, finiPions, occupation, entree } from './simulation.js';

export const POIDS_DEFAUT = {
  sorti: 16, // valeur d'un pion sorti (hors progression)
  pas: 1, // valeur d'une case de progression
  rentre: 98, // valeur d'un pion dans l'allée (avant pénalité de trous)
  trou: 5, // pénalité par case vide au-dessus d'un pion de l'allée
  approche: 0.25, // bonus par case de proximité de l'allée, dans les 12 dernières cases
  alpha: 0.75, // poids d'une menace d'un joueur qui joue avant que la victime puisse réagir
  beta: 0.3, // poids d'une menace dont la victime peut se protéger avant
  risque: 1, // multiplicateur global du risque
  bloque: 2.5,
  menaceValet: 0.5, // part de la menace du valet prise en compte // pénalité maximale d'un pion bloqué par un pion protégé juste devant
  victoire: 100000,
  // Valeur des cartes gardées en main
  sortieUtile: 11, // as ou roi quand un pion attend en base (première carte de sortie)
  sortieSup: 5, // cartes de sortie supplémentaires utiles
  asInutile: 2.5,
  roiInutile: 1,
  sept: 4,
  quatreManoeuvre: 9, // 4 avec un pion juste sorti (recul vers l'allée)
  quatre: 1.5,
  valet: 2.5,
  petiteAllee: 2, // A, 2, 3 quand un pion de l'allée doit encore monter
};

// Masques de rangs capturant à une distance x vers l'avant (1..13).
const MASQUE_DIST = new Int32Array(14);
{
  const ajoute = (x, r) => (MASQUE_DIST[x] |= 1 << r);
  ajoute(1, R_A);
  ajoute(11, R_A);
  for (const [x, r] of [[2, 1], [3, 2], [5, 4], [6, 5], [8, 7], [9, 8], [10, 9], [12, 11], [13, 12]]) ajoute(x, r);
  for (let x = 1; x <= 7; x++) ajoute(x, R_7);
}
const MASQUE_RECUL = 1 << R_4;
const MASQUE_SORTIE = (1 << R_A) | (1 << R_R);

/**
 * Contexte probabiliste : cartes non vues (du point de vue du joueur qui réfléchit).
 * @param {number[]} nonVues  nombre de cartes non vues par rang (13)
 */
export function creerContexte(nonVues, poids = POIDS_DEFAUT) {
  const U = nonVues.reduce((a, b) => a + b, 0);
  // sommeMasque[m] = nombre de cartes non vues dont le rang est dans m
  const sommeMasque = new Int16Array(1 << 13);
  for (let m = 1; m < 1 << 13; m++) {
    const r = 31 - Math.clz32(m);
    sommeMasque[m] = sommeMasque[m & ~(1 << r)] + nonVues[r];
  }
  // pAucune[n][k] = probabilité qu'une main de n cartes inconnues ne contienne aucune des k cartes
  const pAucune = [];
  for (let n = 0; n <= 6; n++) {
    const ligne = new Float64Array(U + 1);
    for (let k = 0; k <= U; k++) {
      let p = 1;
      for (let i = 0; i < n; i++) p *= U - i > 0 ? Math.max(0, U - k - i) / (U - i) : 0;
      ligne[k] = n === 0 ? 1 : p;
    }
    pAucune.push(ligne);
  }
  return { nonVues, U, sommeMasque, pAucune, poids };
}

/**
 * Probabilité que le joueur possède au moins une carte d'un rang du masque.
 * info = { n: cartes en main par joueur, connu: masque de rangs connus par joueur,
 *          nConnu: nombre de cartes connues par joueur }
 */
function proba(ctx, info, j, masque) {
  if (info.connu[j] & masque) return 1;
  let n = info.n[j] - info.nConnu[j];
  if (n <= 0) return 0;
  if (n > 6) n = 6;
  return 1 - ctx.pAucune[n][ctx.sommeMasque[masque]];
}

const occ = new Int8Array(64);
const valeurs = new Float64Array(16);
const masquesAtt = new Int32Array(4);

/** Valeur d'un pion g s'il était sur la case p du circuit. */
function valeurCircuit(g, p, P) {
  const d = (entree(g >> 2) - p + 64) & 63;
  let v = P.sorti + (63 - d) * P.pas;
  if (d <= 12) v += (13 - d) * P.approche;
  return v;
}

/** Valeur intrinsèque de chaque pion (sans le risque). */
function valeursPions(pions, P) {
  for (let o = 0; o < 4; o++) {
    // trous au-dessus de chaque case de l'allée
    let occupe = 0;
    for (let g = o * 4; g < o * 4 + 4; g++) if (pions[g] >= ALLEE) occupe |= 1 << (pions[g] - ALLEE);
    for (let g = o * 4; g < o * 4 + 4; g++) {
      const p = pions[g];
      if (p === BASE) valeurs[g] = 0;
      else if (p >= ALLEE) {
        const k = p - ALLEE;
        let trous = 0;
        for (let j = k + 1; j < 4; j++) if (!(occupe & (1 << j))) trous++;
        valeurs[g] = P.rentre - P.trou * trous;
      } else {
        const d = (entree(o) - p + 64) & 63; // distance jusqu'à la case d'entrée
        let v = P.sorti + (63 - d) * P.pas;
        if (d <= 12) v += (13 - d) * P.approche;
        valeurs[g] = v;
      }
    }
  }
}

/**
 * Évalue la position pour l'équipe `equipePersp` (0 : sièges 0 et 2 ; 1 : sièges 1 et 3).
 * @param pions       positions des 16 pions
 * @param prochain    siège qui joue le prochain coup
 * @param info        { n, connu, nConnu } (voir proba)
 * @param ctx         contexte (creerContexte)
 */
export function evaluerPlateau(pions, equipePersp, prochain, info, ctx) {
  const P = ctx.poids;
  const fin0 = finiPions(pions, 0) && finiPions(pions, 2);
  const fin1 = finiPions(pions, 1) && finiPions(pions, 3);
  if (fin0 || fin1) return (fin0 ? 0 : 1) === equipePersp ? P.victoire : -P.victoire;

  valeursPions(pions, P);
  occupation(pions, occ);
  const fini = [finiPions(pions, 0), finiPions(pions, 1), finiPions(pions, 2), finiPions(pions, 3)];
  // Couleur jouée par chaque joueur, et décalage de son tour par rapport au prochain joueur.
  const couleurDe = [0, 1, 2, 3].map((j) => (fini[j] ? (j + 2) & 3 : j));
  const decal = (j) => (j - prochain + 4) & 3;
  let basePions = [0, 0, 0, 0];
  for (let g = 0; g < 16; g++) if (pions[g] === BASE) basePions[g >> 2]++;

  let score = 0;
  for (let g = 0; g < 16; g++) {
    const o = g >> 2;
    const signe = (o & 1) === equipePersp ? 1 : -1;
    score += signe * valeurs[g];
    const p = pions[g];
    if (p < 0 || p >= 64) continue;
    if (p === o * 16) continue; // protégé
    // Réaction possible des contrôleurs de la couleur o
    let mc = decal(o);
    if (fini[(o + 2) & 3]) mc = Math.min(mc, decal((o + 2) & 3));
    masquesAtt.fill(0);
    // Attaquants vers l'avant (pions derrière, jusqu'à 13 cases)
    for (let x = 1; x <= 13; x++) {
      const q = occ[(p - x + 64) & 63];
      if (q < 0) continue;
      const cq = q >> 2;
      if ((cq & 1) !== (o & 1)) {
        // joueurs qui déplacent la couleur cq
        if (couleurDe[cq] === cq) masquesAtt[cq] |= MASQUE_DIST[x];
        const pc = (cq + 2) & 3;
        if (couleurDe[pc] === cq) masquesAtt[pc] |= MASQUE_DIST[x];
      }
      if (pions[q] === cq * 16) break; // pion protégé : rien ne passe derrière lui
    }
    // Attaquant en arrière (4) : pion 4 cases devant, chemin sans pion protégé
    {
      const q = occ[(p + 4) & 63];
      if (q >= 0 && ((q >> 2) & 1) !== (o & 1)) {
        let libre = true;
        for (let i = 1; i <= 3; i++) {
          const r = occ[(p + i) & 63];
          if (r >= 0 && pions[r] === (r >> 2) * 16) libre = false;
        }
        if (libre) {
          const cq = q >> 2;
          if (couleurDe[cq] === cq) masquesAtt[cq] |= MASQUE_RECUL;
          const pc = (cq + 2) & 3;
          if (couleurDe[pc] === cq) masquesAtt[pc] |= MASQUE_RECUL;
        }
      }
    }
    // Sortie sur une case de départ adverse
    if ((p & 15) === 0) {
      const cs = p >> 4;
      if ((cs & 1) !== (o & 1) && basePions[cs] > 0) {
        if (couleurDe[cs] === cs) masquesAtt[cs] |= MASQUE_SORTIE;
        const pc = (cs + 2) & 3;
        if (couleurDe[pc] === cs) masquesAtt[pc] |= MASQUE_SORTIE;
      }
    }
    let survie = 1;
    for (let j = 0; j < 4; j++) {
      if (!masquesAtt[j]) continue;
      const w = decal(j) < mc ? P.alpha : P.beta;
      survie *= 1 - w * proba(ctx, info, j, masquesAtt[j]);
    }
    if (survie < 1) score -= signe * (1 - survie) * valeurs[g] * P.risque;
  }

  // Menace du valet : chaque joueur qui possède un valet peut échanger un de ses pions avec
  // le pion adverse le plus avancé ; on compte le meilleur échange de chacun.
  if (P.menaceValet) {
    for (let j = 0; j < 4; j++) {
      const c = couleurDe[j];
      if (fini[c]) continue;
      const pj = proba(ctx, info, j, 1 << R_V);
      if (pj <= 0) continue;
      let meilleur = 0;
      for (let a = c * 4; a < c * 4 + 4; a++) {
        const pa = pions[a];
        if (pa < 0 || pa >= 64 || pa === c * 16) continue;
        for (let b = 0; b < 16; b++) {
          if (((b >> 2) & 1) === (c & 1)) continue;
          const pb = pions[b];
          if (pb < 0 || pb >= 64 || pb === (b >> 2) * 16) continue;
          const gainA = valeurCircuit(a, pb, P) - valeurs[a];
          const perteB = valeurs[b] - valeurCircuit(b, pa, P);
          if (gainA + perteB > meilleur) meilleur = gainA + perteB;
        }
      }
      if (meilleur > 0) {
        // la victime peut-elle réagir avant ? approximation : poids selon la place de j
        const w = decal(j) <= 1 ? P.alpha : P.beta;
        score += ((c & 1) === equipePersp ? 1 : -1) * P.menaceValet * w * pj * meilleur;
      }
    }
  }

  // Blocages : pions qui ont un pion protégé juste devant eux
  if (P.bloque) {
    for (let c = 0; c < 4; c++) {
      const q = occ[c * 16];
      if (q < 0 || q >> 2 !== c) continue;
      for (let x = 1; x <= 12; x++) {
        const r = occ[(c * 16 - x + 64) & 63];
        if (r < 0) continue;
        if (((entree(r >> 2) - pions[r] + 64) & 63) < x) continue; // il tournera dans son allée avant
        const signe = ((r >> 2) & 1) === equipePersp ? 1 : -1;
        score -= (signe * P.bloque * (13 - x)) / 12;
      }
    }
  }
  return score;
}

/**
 * Valeur des cartes gardées en main par le siège s (comptes par rang), pour son équipe.
 */
export function valeurMain(compte, pions, s, P) {
  if (!compte) return 0;
  const c = finiPions(pions, s) ? (s + 2) & 3 : s;
  let enBase = 0;
  let manoeuvre = false;
  let monter = false;
  let occupe = 0;
  for (let g = c * 4; g < c * 4 + 4; g++) {
    const p = pions[g];
    if (p === BASE) enBase++;
    else if (p >= ALLEE) occupe |= 1 << (p - ALLEE);
    else {
      // un recul de 4 amènerait le pion juste avant (ou sur) sa case d'entrée
      if (((entree(c) - p + 64) & 63) >= 60) manoeuvre = true;
    }
  }
  // un pion de l'allée a des cases libres au-dessus de lui
  for (let k = 0; k < 3; k++) if (occupe & (1 << k) && !(occupe & (1 << (k + 1)))) monter = true;
  let v = 0;
  let sorties = compte[R_A] + compte[R_R];
  let utiles = Math.min(sorties, enBase);
  if (utiles > 0) v += P.sortieUtile + (utiles - 1) * P.sortieSup;
  // cartes de sortie en surplus
  let surplus = sorties - utiles;
  const asSurplus = Math.min(surplus, compte[R_A]);
  v += asSurplus * P.asInutile + (surplus - asSurplus) * P.roiInutile;
  v += compte[R_7] * P.sept;
  if (compte[R_4]) v += manoeuvre ? P.quatreManoeuvre + (compte[R_4] - 1) * P.quatre : compte[R_4] * P.quatre;
  v += compte[R_V] * P.valet;
  if (monter) v += (compte[R_A] + compte[1] + compte[2]) * P.petiteAllee;
  return v;
}
