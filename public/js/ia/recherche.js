// Recherche du meilleur coup : évaluation statique + simulations déterminisées.
//
// 1. Tous les coups légaux de la main sont générés (moteur rapide) et évalués statiquement
//    (évaluation de la position + valeur des cartes gardées) : c'est déjà un bon joueur,
//    utilisé tel quel quand le budget est minuscule.
// 2. Les meilleurs candidats sont ensuite départagés par des simulations (voir analyse.js) :
//    à chaque itération, on tire au hasard les mains cachées parmi les cartes non vues (en
//    tenant compte de la carte donnée au partenaire), puis on joue le reste de la donne pour
//    chaque candidat avec la même distribution (variables aléatoires communes), chaque joueur
//    choisissant le coup qui maximise l'évaluation statique pour son équipe. La position de
//    fin de donne est évaluée.
//
// Ce fichier fournit les briques : préparation, évaluation d'un candidat, tirage des mains,
// simulation d'une donne.

import { paquetNeuf, tailleDonne } from '../moteur/cartes.js';
import { coupsMain, indexRang, equipeGagnantePions, entree, BASE, ALLEE } from './simulation.js';
import { creerContexte, evaluerPlateau, valeurMain, POIDS_DEFAUT } from './evaluation.js';

const maintenant =
  typeof globalThis.performance !== 'undefined' && globalThis.performance.now
    ? () => globalThis.performance.now()
    : () => Date.now();

const PAQUET = paquetNeuf();

/** Cartes non vues par le siège : ni jouées (pile), ni en main, ni données au partenaire. */
export function cartesNonVues(etat, main, carteDonnee) {
  const vues = new Set(etat.pile);
  for (const c of main) vues.add(c);
  if (carteDonnee) vues.add(carteDonnee);
  return PAQUET.filter((c) => !vues.has(c));
}

export function comptesRangs(cartes) {
  const t = new Array(13).fill(0);
  for (const c of cartes) t[indexRang(c)]++;
  return t;
}

function masqueRangs(cartes) {
  let m = 0;
  for (const c of cartes) m |= 1 << indexRang(c);
  return m;
}

/** Retire une carte du rang ir d'une main (copie). */
function retirerRang(main, ir) {
  const i = main.findIndex((c) => indexRang(c) === ir);
  const m = main.slice();
  m.splice(i, 1);
  return m;
}

/**
 * Prépare tout ce qui est commun à l'analyse d'une position pour `siege`.
 */
export function preparer(etat, siege, main, options = {}) {
  const poids = options.poids || POIDS_DEFAUT;
  const donneeEnMain = options.carteDonnee && !etat.pile.includes(options.carteDonnee) ? options.carteDonnee : null;
  const nonVues = cartesNonVues(etat, main, options.carteDonnee);
  const ctx = creerContexte(comptesRangs(nonVues), poids);
  return { etat, siege, main, poids, ctx, nonVues, donneeEnMain, cinq: !!etat.reglages.cinqAdverse };
}

/**
 * Informations sur les mains utilisées par l'évaluation, après un coup de `joueur`.
 * @param n         cartes en main par siège (après le coup)
 * @param joueur    siège dont la main est connue (ou -1)
 * @param mainJ     sa main
 * @param donnee    carte connue dans la main du partenaire de `joueur` (ou null)
 */
export function infoMains(n, joueur, mainJ, donnee) {
  const connu = [0, 0, 0, 0];
  const nConnu = [0, 0, 0, 0];
  if (joueur >= 0) {
    connu[joueur] = masqueRangs(mainJ);
    nConnu[joueur] = mainJ.length;
    if (donnee) {
      const p = (joueur + 2) & 3;
      connu[p] = 1 << indexRang(donnee);
      nConnu[p] = 1;
    }
  }
  return { n, connu, nConnu };
}

/**
 * Évaluation statique d'un coup candidat (résultat de coupsMain) pour le siège qui le joue.
 * @param restes  cartes restantes par siège AVANT le coup
 */
export function evaluerCandidat(prep, siege, cand, mainApres, restes, donnee, donne) {
  const n = restes.slice();
  n[siege]--;
  const equipe = siege & 1;
  if (n.every((k) => k === 0)) {
    // Fin de donne : chacun recevra une nouvelle main.
    const t = tailleDonne(donne + 1);
    const info = infoMains([t, t, t, t], -1, null, null);
    return evaluerPlateau(cand.pions, equipe, (donne + 1) & 3, info, prep.ctx);
  }
  const info = infoMains(n, siege, mainApres, donnee);
  return (
    evaluerPlateau(cand.pions, equipe, (siege + 1) & 3, info, prep.ctx) +
    valeurMain(comptesRangs(mainApres), cand.pions, siege, prep.poids)
  );
}

/** Coup glouton (évaluation statique) d'un joueur dans une simulation. */
function coupGlouton(prep, pions, joueur, main, restes, donne) {
  const coups = coupsMain(pions, joueur, main, prep.cinq, 40);
  if (coups.length === 1) return coups[0];
  let meilleur = null;
  let best = -Infinity;
  for (const c of coups) {
    const v = evaluerCandidat(prep, joueur, c, retirerRang(main, c.ir), restes, null, donne);
    if (v > best) {
      best = v;
      meilleur = c;
    }
  }
  return meilleur;
}

function melangerAvec(t, rng) {
  for (let i = t.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const x = t[i];
    t[i] = t[j];
    t[j] = x;
  }
  return t;
}

/** Tire les mains cachées des trois autres joueurs. */
export function tirerMains(prep, rng) {
  const { etat, siege, donneeEnMain } = prep;
  const pool = melangerAvec(prep.nonVues.slice(), rng);
  const mains = [null, null, null, null];
  let k = 0;
  for (let j = 0; j < 4; j++) {
    if (j === siege) continue;
    const n = etat.cartesRestantes[j];
    const m = [];
    if (j === ((siege + 2) & 3) && donneeEnMain && n > 0) m.push(donneeEnMain);
    while (m.length < n && k < pool.length) m.push(pool[k++]);
    mains[j] = m;
  }
  return mains;
}

/** Somme des distances restantes (jusqu'au fond de l'allée) des 16 pions, base comprise. */
export function travailRestant(pions) {
  let r = 0;
  for (let g = 0; g < 16; g++) {
    const p = pions[g];
    if (p === BASE) r += 75;
    else if (p >= ALLEE) r += 3 - (p - ALLEE);
    else r += ((entree(g >> 2) - p + 64) & 63) + 4;
  }
  return r;
}

/**
 * Joue la donne jusqu'au bout (ou `profondeurMax` coups) à partir de `joueur`, chacun jouant
 * son coup glouton, et renvoie l'évaluation finale pour l'équipe de `persp` (siège dont la main
 * finale est valorisée si la donne n'est pas finie) : { v, pions, gagnant }.
 * `mains` et `restes` sont modifiés.
 */
export function jouerDonne(prep, pions, mains, restes, joueur, donne, persp, profondeurMax = Infinity) {
  const equipe = persp & 1;
  let plis = 0;
  const V = prep.poids.victoire;
  while (plis < profondeurMax) {
    const g = equipeGagnantePions(pions);
    if (g >= 0) return { v: g === equipe ? V : -V, pions, gagnant: g };
    if (restes[0] + restes[1] + restes[2] + restes[3] === 0) break;
    if (restes[joueur] > 0) {
      const c = coupGlouton(prep, pions, joueur, mains[joueur], restes, donne);
      pions = c.pions;
      mains[joueur] = retirerRang(mains[joueur], c.ir);
      restes[joueur]--;
      plis++;
    }
    joueur = (joueur + 1) & 3;
  }
  const g = equipeGagnantePions(pions);
  if (g >= 0) return { v: g === equipe ? V : -V, pions, gagnant: g };
  if (restes[0] + restes[1] + restes[2] + restes[3] === 0) {
    const t = tailleDonne(donne + 1);
    return { v: evaluerPlateau(pions, equipe, (donne + 1) & 3, infoMains([t, t, t, t], -1, null, null), prep.ctx), pions, gagnant: -1 };
  }
  const info = infoMains(restes, persp, mains[persp], null);
  const v = evaluerPlateau(pions, equipe, joueur, info, prep.ctx) + valeurMain(comptesRangs(mains[persp]), pions, persp, prep.poids);
  return { v, pions, gagnant: -1 };
}

/**
 * Simule la fin de la donne après le coup candidat du siège de `prep`, avec les mains tirées.
 */
export function simuler(prep, cand, mainApres, mainsAutres, profondeurMax = Infinity) {
  const { etat, siege } = prep;
  const mains = mainsAutres.slice();
  mains[siege] = mainApres;
  const restes = etat.cartesRestantes.slice();
  restes[siege]--;
  return jouerDonne(prep, cand.pions, mains, restes, (siege + 1) & 3, etat.donne, siege, profondeurMax);
}

export { maintenant, retirerRang, melangerAvec };
