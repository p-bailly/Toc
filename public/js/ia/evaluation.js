// Fonction d'évaluation d'une position de Toc (jeu à 4 par équipes, ou jeu à 3 chacun pour soi).
//
// Unité : le « pas » (une case de progression). On calcule d'abord la « force » S[x] de chaque
// joueur x (somme de la valeur de ses pions, risques de capture déduits) :
//  - progression de chaque pion (distance restante jusqu'à l'entrée de l'allée), bonus de sortie ;
//  - pions rentrés, avec pénalité pour les « trous » laissés au-dessus d'eux dans l'allée
//    (un pion rentré trop bas bloque l'entrée des suivants) ;
//  - exposition aux captures : pour chaque pion du circuit, probabilité qu'un adversaire qui
//    joue avant que le propriétaire puisse réagir possède une carte qui le capture (distance
//    exacte, 7 qui dépasse, 4 en arrière, sortie sur une case de départ, joker qui copie l'une
//    de ces cartes), calculée à partir des cartes non vues (loi hypergéométrique) ;
//  - menace du valet, blocages par un pion protégé sur sa case de départ.
// Puis :
//  - à 4 joueurs : score = force de son équipe − force de l'équipe adverse ;
//  - à 3 joueurs : score = S[moi] − (poidsTete × S[meilleur adversaire] + (1 − poidsTete) ×
//    S[autre adversaire]). Faire reculer le joueur en tête rapporte donc plus que faire reculer
//    le dernier, et les deux autres ne sont pas supposés coopérer.
// La valeur des cartes gardées en main est comptée à part (valeurMain).

import { BASE, ALLEE, R_A, R_4, R_7, R_V, R_R, R_J, finiPions, occupation, entree, memeCamp, couleurActivePions } from './simulation.js';

export const POIDS_DEFAUT = {
  sorti: 16, // valeur d'un pion sorti (hors progression)
  pas: 1, // valeur d'une case de progression
  rentre: 98, // valeur d'un pion dans l'allée à 4 joueurs (avant pénalité de trous) ; −16 à 3
  trou: 5, // pénalité par case vide au-dessus d'un pion de l'allée
  approche: 0.25, // bonus par case de proximité de l'allée, dans les 12 dernières cases
  alpha: 0.75, // poids d'une menace d'un joueur qui joue avant que la victime puisse réagir
  beta: 0.3, // poids d'une menace dont la victime peut se protéger avant
  risque: 1, // multiplicateur global du risque
  bloque: 2.5, // pénalité maximale d'un pion bloqué par un pion protégé juste devant
  menaceValet: 0.5, // part de la menace du valet prise en compte
  victoire: 100, // bonus d'une partie gagnée, ajouté à l'évaluation (en cases) du plateau final
  poidsTete: 0.65, // jeu à 3 : poids du meilleur adversaire (le second a 1 − poidsTete)
  adversaires: 1, // jeu à 3 : poids global des adversaires
  primeRentres: 0, // jeu à 3 : bonus × (pions rentrés)² de chaque joueur (course à l'arrivée)
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
  joker: 7, // jeu à 3 : valeur d'un joker gardé (il pourra copier une carte posée plus tard)
  offreJoker: 1, // jeu à 3 : coût d'une carte nouvelle offerte à la copie d'un joker adverse
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
const BIT_JOKER = 1 << R_J;

/**
 * Contexte probabiliste : cartes non vues (du point de vue du joueur qui réfléchit).
 * @param {number[]} nonVues   nombre de cartes non vues par rang (14 : le dernier = jokers)
 * @param {number} copiables   masque des rangs qu'un joker peut copier (jeu à 3)
 */
export function creerContexte(nonVues, poids = POIDS_DEFAUT, copiables = 0) {
  const nv = nonVues.length >= 14 ? nonVues : nonVues.concat([0]);
  const U = nv.reduce((a, b) => a + b, 0);
  // sommeMasque[m] = nombre de cartes non vues dont le rang est dans m
  const sommeMasque = new Int16Array(1 << 14);
  for (let m = 1; m < 1 << 14; m++) {
    const r = 31 - Math.clz32(m);
    sommeMasque[m] = sommeMasque[m & ~(1 << r)] + nv[r];
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
  return { nonVues: nv, U, sommeMasque, pAucune, poids, copiables };
}

/**
 * Probabilité que le joueur possède au moins une carte d'un rang du masque (un joker compte
 * s'il peut copier l'un de ces rangs).
 * info = { n: cartes en main par joueur, connu: masque de rangs connus par joueur,
 *          nConnu: nombre de cartes connues par joueur }
 */
function proba(ctx, info, j, masque) {
  if (masque & ctx.copiables) masque |= BIT_JOKER;
  if (info.connu[j] & masque) return 1;
  let n = info.n[j] - info.nConnu[j];
  if (n <= 0) return 0;
  if (n > 6) n = 6;
  return 1 - ctx.pAucune[n][ctx.sommeMasque[masque]];
}

const occ = new Int8Array(64);
const valeurs = new Float64Array(16);
const masquesAtt = new Int32Array(4);
const forces = new Float64Array(4);

/** Valeur d'un pion g s'il était sur la case p d'un circuit de N cases. */
function valeurCircuit(g, p, P, N) {
  const d = (entree(g >> 2, N) - p + N) % N;
  let v = P.sorti + (N - 1 - d) * P.pas;
  if (d <= 12) v += (13 - d) * P.approche;
  return v;
}

/** Valeur intrinsèque de chaque pion (sans le risque). */
function valeursPions(pions, P) {
  const nb = pions.length >> 2;
  const N = nb * 16;
  const rentre = P.rentre - (64 - N);
  for (let o = 0; o < nb; o++) {
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
        valeurs[g] = rentre - P.trou * trous;
      } else valeurs[g] = valeurCircuit(g, p, P, N);
    }
  }
}

/** Siège gagnant (jeu à 3), équipe gagnante (jeu à 4), ou -1. */
function gagnantPions(pions) {
  if (pions.length === 12) {
    for (let s = 0; s < 3; s++) if (finiPions(pions, s)) return s;
    return -1;
  }
  if (finiPions(pions, 0) && finiPions(pions, 2)) return 0;
  if (finiPions(pions, 1) && finiPions(pions, 3)) return 1;
  return -1;
}

/**
 * Évalue la position du point de vue de `persp` : à 4 joueurs, son équipe (persp & 1 : un
 * siège ou un numéro d'équipe conviennent) ; à 3 joueurs, le siège persp.
 * @param pions       positions des pions (16 ou 12)
 * @param prochain    siège qui joue le prochain coup
 * @param info        { n, connu, nConnu } (voir proba)
 * @param ctx         contexte (creerContexte)
 * @param detail      (facultatif) objet rempli avec risque[g] (probabilité pondérée de capture),
 *                    valeur[g] (valeur intrinsèque de chaque pion) et force[x] (force de chaque
 *                    joueur), pour les explications
 */
export function evaluerPlateau(pions, persp, prochain, info, ctx, detail = null) {
  const P = ctx.poids;
  const nb = pions.length >> 2;
  const N = nb * 16;
  const a3 = nb === 3;
  const nP = pions.length;

  valeursPions(pions, P);
  occupation(pions, occ);
  if (detail) {
    detail.risque = new Float64Array(nP);
    detail.valeur = Float64Array.from(valeurs.subarray(0, nP));
  }
  const fini = [finiPions(pions, 0), finiPions(pions, 1), finiPions(pions, 2), nb === 4 && finiPions(pions, 3)];
  // Couleur jouée par chaque joueur, et décalage de son tour par rapport au prochain joueur.
  const couleurDe = [0, 1, 2, 3].map((j) => (!a3 && fini[j] ? (j + 2) & 3 : j));
  const decal = (j) => (j - prochain + nb) % nb;
  const basePions = [0, 0, 0, 0];
  for (let g = 0; g < nP; g++) if (pions[g] === BASE) basePions[g >> 2]++;
  forces.fill(0);

  // Les joueurs qui déplacent la couleur cq : cq (s'il ne joue pas pour son partenaire) et, à 4,
  // son partenaire s'il a fini.
  const ajouterAttaque = (cq, masque) => {
    if (couleurDe[cq] === cq) masquesAtt[cq] |= masque;
    if (!a3) {
      const pc = (cq + 2) & 3;
      if (couleurDe[pc] === cq) masquesAtt[pc] |= masque;
    }
  };

  for (let g = 0; g < nP; g++) {
    const o = g >> 2;
    forces[o] += valeurs[g];
    const p = pions[g];
    if (p < 0 || p >= N) continue;
    if (p === o * 16) continue; // protégé
    // Réaction possible des contrôleurs de la couleur o
    let mc = decal(o);
    if (!a3 && fini[(o + 2) & 3]) mc = Math.min(mc, decal((o + 2) & 3));
    masquesAtt.fill(0);
    // Attaquants vers l'avant (pions derrière, jusqu'à 13 cases)
    for (let x = 1; x <= 13; x++) {
      const q = occ[(p - x + N) % N];
      if (q < 0) continue;
      const cq = q >> 2;
      if (!memeCamp(pions, cq, o)) ajouterAttaque(cq, MASQUE_DIST[x]);
      if (pions[q] === cq * 16) break; // pion protégé : rien ne passe derrière lui
    }
    // Attaquant en arrière (4) : pion 4 cases devant, chemin sans pion protégé
    {
      const q = occ[(p + 4) % N];
      if (q >= 0 && !memeCamp(pions, q >> 2, o)) {
        let libre = true;
        for (let i = 1; i <= 3; i++) {
          const r = occ[(p + i) % N];
          if (r >= 0 && pions[r] === (r >> 2) * 16) libre = false;
        }
        if (libre) ajouterAttaque(q >> 2, MASQUE_RECUL);
      }
    }
    // Sortie sur une case de départ adverse
    if ((p & 15) === 0) {
      const cs = p >> 4;
      if (!memeCamp(pions, cs, o) && basePions[cs] > 0) ajouterAttaque(cs, MASQUE_SORTIE);
    }
    let survie = 1;
    for (let j = 0; j < nb; j++) {
      if (!masquesAtt[j]) continue;
      const w = decal(j) < mc ? P.alpha : P.beta;
      survie *= 1 - w * proba(ctx, info, j, masquesAtt[j]);
    }
    if (survie < 1) forces[o] -= (1 - survie) * valeurs[g] * P.risque;
    if (detail) detail.risque[g] = 1 - survie;
  }

  // Menace du valet : chaque joueur qui possède un valet peut échanger un de ses pions avec
  // un pion adverse plus avancé ; on compte le meilleur échange de chacun.
  if (P.menaceValet) {
    for (let j = 0; j < nb; j++) {
      const c = couleurDe[j];
      if (fini[c]) continue;
      const pj = proba(ctx, info, j, 1 << R_V);
      if (pj <= 0) continue;
      let meilleur = 0;
      let gainMeilleur = 0;
      let victime = -1;
      for (let a = c * 4; a < c * 4 + 4; a++) {
        const pa = pions[a];
        if (pa < 0 || pa >= N || pa === c * 16) continue;
        for (let b = 0; b < nP; b++) {
          if (memeCamp(pions, b >> 2, c)) continue;
          const pb = pions[b];
          if (pb < 0 || pb >= N || pb === (b >> 2) * 16) continue;
          const gainA = valeurCircuit(a, pb, P, N) - valeurs[a];
          const perteB = valeurs[b] - valeurCircuit(b, pa, P, N);
          if (gainA + perteB > meilleur) {
            meilleur = gainA + perteB;
            gainMeilleur = gainA;
            victime = b >> 2;
          }
        }
      }
      if (meilleur > 0) {
        // la victime peut-elle réagir avant ? approximation : poids selon la place de j
        const w = (decal(j) <= 1 ? P.alpha : P.beta) * P.menaceValet * pj;
        forces[c] += w * gainMeilleur;
        forces[victime] -= w * (meilleur - gainMeilleur);
      }
    }
  }

  // Blocages : pions qui ont un pion protégé juste devant eux
  if (P.bloque) {
    for (let c = 0; c < nb; c++) {
      const q = occ[c * 16];
      if (q < 0 || q >> 2 !== c) continue;
      for (let x = 1; x <= 12; x++) {
        const r = occ[(c * 16 - x + N) % N];
        if (r < 0) continue;
        if ((entree(r >> 2, N) - pions[r] + N) % N < x) continue; // il tournera dans son allée avant
        forces[r >> 2] -= (P.bloque * (13 - x)) / 12;
      }
    }
  }

  const g = gagnantPions(pions);
  if (detail) detail.force = Float64Array.from(forces.subarray(0, nb));
  if (!a3) {
    const e = persp & 1;
    let score = forces[e] + forces[e + 2] - forces[1 - e] - forces[3 - e];
    if (g >= 0) score += g === e ? P.victoire : -P.victoire;
    return score;
  }
  if (P.primeRentres) {
    for (let x = 0; x < 3; x++) {
      let k = 0;
      for (let g = x * 4; g < x * 4 + 4; g++) if (pions[g] >= ALLEE) k++;
      forces[x] += P.primeRentres * k * k;
    }
  }
  const a = forces[(persp + 1) % 3];
  const b = forces[(persp + 2) % 3];
  const tete = a > b ? a : b;
  const autre = a > b ? b : a;
  let score = forces[persp] - P.adversaires * (P.poidsTete * tete + (1 - P.poidsTete) * autre);
  if (g >= 0) score += g === persp ? P.victoire : -P.victoire;
  return score;
}

/**
 * Valeur des cartes gardées en main par le siège s (comptes par rang, 14 entrées possibles),
 * pour son camp. `copiables` : masque des rangs qu'un joker peut copier maintenant.
 */
export function valeurMain(compte, pions, s, P, copiables = 0) {
  if (!compte) return 0;
  const N = pions.length * 4;
  const c = couleurActivePions(pions, s);
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
      if ((entree(c, N) - p + N) % N >= N - 4) manoeuvre = true;
    }
  }
  // un pion de l'allée a des cases libres au-dessus de lui
  for (let k = 0; k < 3; k++) if (occupe & (1 << k) && !(occupe & (1 << (k + 1)))) monter = true;
  let v = 0;
  const sorties = compte[R_A] + compte[R_R];
  const utiles = Math.min(sorties, enBase);
  if (utiles > 0) v += P.sortieUtile + (utiles - 1) * P.sortieSup;
  // cartes de sortie en surplus
  const surplus = sorties - utiles;
  const asSurplus = Math.min(surplus, compte[R_A]);
  v += asSurplus * P.asInutile + (surplus - asSurplus) * P.roiInutile;
  v += compte[R_7] * P.sept;
  if (compte[R_4]) v += manoeuvre ? P.quatreManoeuvre + (compte[R_4] - 1) * P.quatre : compte[R_4] * P.quatre;
  v += compte[R_V] * P.valet;
  if (monter) v += (compte[R_A] + compte[1] + compte[2]) * P.petiteAllee;
  const jokers = compte.length > R_J ? compte[R_J] : 0;
  if (jokers) {
    // Un joker vaut au moins sa valeur « d'avenir » (il copiera une carte posée plus tard dans la
    // donne), et davantage s'il peut déjà copier une carte précieuse dans la situation.
    let meilleur = P.joker;
    if (copiables & MASQUE_SORTIE && enBase > utiles) meilleur = Math.max(meilleur, P.sortieUtile + 2);
    if (copiables & (1 << R_7)) meilleur = Math.max(meilleur, P.sept + 3);
    if (copiables & (1 << R_4) && manoeuvre) meilleur = Math.max(meilleur, P.quatreManoeuvre + 2);
    v += jokers * meilleur;
  }
  return v;
}
