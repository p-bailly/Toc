// Recherche du meilleur coup : évaluation statique + simulations déterminisées (jeu à 4 ou à 3).
//
// 1. Tous les coups légaux de la main sont générés (moteur rapide) et évalués statiquement
//    (évaluation de la position + valeur des cartes gardées) : c'est déjà un bon joueur,
//    utilisé tel quel quand le budget est minuscule.
// 2. Les meilleurs candidats sont ensuite départagés par des simulations (voir etude.js) :
//    à chaque itération, on tire au hasard les mains cachées parmi les cartes non vues (en
//    tenant compte de la carte donnée : au partenaire à 4, au voisin à 3), puis on joue le reste
//    de la donne pour chaque candidat avec la même distribution (variables aléatoires communes),
//    chaque joueur choisissant le coup qui maximise l'évaluation statique pour son camp. Les
//    rangs copiables par les jokers évoluent au fil de la donne simulée. La position de fin de
//    donne est évaluée.
//
// Ce fichier fournit les briques : préparation, évaluation d'un candidat, tirage des mains,
// simulation d'une donne.

import { paquetNeuf, tailleDonne } from '../moteur/cartes.js';
import { destinataireDon } from '../moteur/plateau.js';
import { rangsCopiables } from '../moteur/regles.js';
import {
  coupsMain, indexRang, equipeGagnantePions, entree, masqueCopiables, rangEffectif, BASE, ALLEE,
  R_A, R_R, R_7, R_4, R_V, R_J,
} from './simulation.js';
import { creerContexte, evaluerPlateau, valeurMain, POIDS_DEFAUT } from './evaluation.js';

const maintenant =
  typeof globalThis.performance !== 'undefined' && globalThis.performance.now
    ? () => globalThis.performance.now()
    : () => Date.now();

const PAQUETS = { 3: paquetNeuf(3), 4: paquetNeuf(4) };

/** Nombre de joueurs d'un état (3 ou 4). */
export const nbJoueurs = (etat) => (etat.reglages && etat.reglages.nbJoueurs === 3 ? 3 : 4);

/** Cartes non vues par le siège : ni jouées (pile), ni en main, ni données. */
export function cartesNonVues(etat, main, carteDonnee) {
  const vues = new Set(etat.pile);
  for (const c of main) vues.add(c);
  if (carteDonnee) vues.add(carteDonnee);
  return PAQUETS[nbJoueurs(etat)].filter((c) => !vues.has(c));
}

export function comptesRangs(cartes) {
  const t = new Array(14).fill(0);
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
 * options : { poids, carteDonnee, carteRecue }
 */
export function preparer(etat, siege, main, options = {}) {
  const poids = options.poids || POIDS_DEFAUT;
  const n = nbJoueurs(etat);
  const donneeEnMain = options.carteDonnee && !etat.pile.includes(options.carteDonnee) ? options.carteDonnee : null;
  const nonVues = cartesNonVues(etat, main, options.carteDonnee);
  const copiables = n === 3 ? masqueCopiables(rangsCopiables(etat)) : 0;
  const ctx = creerContexte(comptesRangs(nonVues), poids, copiables);
  return {
    etat,
    siege,
    main,
    poids,
    ctx,
    nonVues,
    donneeEnMain,
    destinataire: destinataireDon(etat.donne, siege, n),
    cinq: !!etat.reglages.cinqAdverse,
    n,
    copiables,
  };
}

/**
 * Informations sur les mains utilisées par l'évaluation, après un coup de `joueur`.
 * @param n             cartes en main par siège (après le coup)
 * @param joueur        siège dont la main est connue (ou -1)
 * @param mainJ         sa main
 * @param donnee        carte connue dans la main d'un autre joueur (ou null)
 * @param destinataire  siège qui détient cette carte (partenaire à 4, voisin à 3)
 */
export function infoMains(n, joueur, mainJ, donnee, destinataire = (joueur + 2) & 3) {
  const connu = [0, 0, 0, 0];
  const nConnu = [0, 0, 0, 0];
  if (joueur >= 0) {
    connu[joueur] = masqueRangs(mainJ);
    nConnu[joueur] = mainJ.length;
    if (donnee) {
      connu[destinataire] = 1 << indexRang(donnee);
      nConnu[destinataire] = 1;
    }
  }
  return { n, connu, nConnu };
}

/** Intérêt d'un rang pour un adversaire qui le copierait avec un joker (jeu à 3). */
const VALEUR_COPIE = [5, 1, 1, 3, 1.5, 1, 4, 1, 1, 1, 3, 1.5, 5, 0];

/**
 * Évaluation statique d'un coup candidat (résultat de coupsMain) pour le siège qui le joue.
 * @param restes     cartes restantes par siège AVANT le coup
 * @param copiables  rangs copiables AVANT le coup (jeu à 3)
 */
export function evaluerCandidat(prep, siege, cand, mainApres, restes, donnee, donne, copiables = prep.copiables) {
  const nb = restes.length;
  const n = restes.slice();
  n[siege]--;
  let fini = true;
  for (let j = 0; j < nb; j++) if (n[j] !== 0) fini = false;
  if (fini) {
    // Fin de donne : chacun recevra une nouvelle main.
    const t = tailleDonne(donne + 1, nb);
    const info = infoMains([t, t, t, t], -1, null, null);
    return evaluerPlateau(cand.pions, siege, (donne + 1) % nb, info, prep.ctx);
  }
  const info = infoMains(n, siege, mainApres, donnee, prep.destinataire);
  let v = evaluerPlateau(cand.pions, siege, (siege + 1) % nb, info, prep.ctx);
  let cop = copiables;
  if (nb === 3) {
    const r = rangEffectif(cand);
    if (r >= 0 && !(copiables & (1 << r))) {
      cop |= 1 << r;
      // Carte nouvelle à copier : un adversaire qui détient un joker pourra s'en servir.
      const uJ = prep.ctx.nonVues[R_J];
      if (uJ > 0 && VALEUR_COPIE[r] > 1) {
        let pAucun = 1;
        for (let j = 0; j < nb; j++) {
          if (j === siege || n[j] <= 0) continue;
          pAucun *= prep.ctx.pAucune[Math.min(6, n[j])][uJ];
        }
        v -= prep.poids.offreJoker * (1 - pAucun) * VALEUR_COPIE[r];
      }
    }
  }
  return v + valeurMain(comptesRangs(mainApres), cand.pions, siege, prep.poids, cop);
}

/** Coup glouton (évaluation statique) d'un joueur dans une simulation. */
function coupGlouton(prep, pions, joueur, main, restes, donne, copiables) {
  const coups = coupsMain(pions, joueur, main, prep.cinq, 40, copiables);
  if (coups.length === 1) return coups[0];
  let meilleur = null;
  let best = -Infinity;
  for (const c of coups) {
    const v = evaluerCandidat(prep, joueur, c, retirerRang(main, c.ir), restes, null, donne, copiables);
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

/** Tire les mains cachées des autres joueurs. */
export function tirerMains(prep, rng) {
  const { etat, siege, donneeEnMain, n: nb } = prep;
  const pool = melangerAvec(prep.nonVues.slice(), rng);
  const mains = Array(nb).fill(null);
  let k = 0;
  for (let j = 0; j < nb; j++) {
    if (j === siege) continue;
    const n = etat.cartesRestantes[j];
    const m = [];
    if (j === prep.destinataire && donneeEnMain && n > 0) m.push(donneeEnMain);
    while (m.length < n && k < pool.length) m.push(pool[k++]);
    mains[j] = m;
  }
  return mains;
}

/** Somme des distances restantes (jusqu'au fond de l'allée) de tous les pions, base comprise. */
export function travailRestant(pions) {
  const N = pions.length * 4;
  let r = 0;
  for (let g = 0; g < pions.length; g++) {
    const p = pions[g];
    if (p === BASE) r += N + 11;
    else if (p >= ALLEE) r += 3 - (p - ALLEE);
    else r += ((entree(g >> 2, N) - p + N) % N) + 4;
  }
  return r;
}

/**
 * Joue la donne jusqu'au bout (ou `profondeurMax` coups) à partir de `joueur`, chacun jouant
 * son coup glouton, et renvoie l'évaluation finale pour le camp de `persp` (siège dont la main
 * finale est valorisée si la donne n'est pas finie) : { v, pions, gagnant }.
 * `mains` et `restes` sont modifiés. `copiables` : rangs copiables au départ (jeu à 3).
 */
export function jouerDonne(prep, pions, mains, restes, joueur, donne, persp, profondeurMax = Infinity, copiables = prep.copiables) {
  const nb = restes.length;
  let plis = 0;
  const vide = infoMains([0, 0, 0, 0], -1, null, null);
  const fin = (g) => ({ v: evaluerPlateau(pions, persp, joueur, vide, prep.ctx), pions, gagnant: g });
  const total = () => {
    let s = 0;
    for (let j = 0; j < nb; j++) s += restes[j];
    return s;
  };
  while (plis < profondeurMax) {
    const g = equipeGagnantePions(pions);
    if (g >= 0) return fin(g);
    if (total() === 0) break;
    if (restes[joueur] > 0) {
      const c = coupGlouton(prep, pions, joueur, mains[joueur], restes, donne, copiables);
      pions = c.pions;
      mains[joueur] = retirerRang(mains[joueur], c.ir);
      restes[joueur]--;
      if (nb === 3) {
        const r = rangEffectif(c);
        if (r >= 0) copiables |= 1 << r;
      }
      plis++;
    }
    joueur = (joueur + 1) % nb;
  }
  const g = equipeGagnantePions(pions);
  if (g >= 0) return fin(g);
  if (total() === 0) {
    const t = tailleDonne(donne + 1, nb);
    return { v: evaluerPlateau(pions, persp, (donne + 1) % nb, infoMains([t, t, t, t], -1, null, null), prep.ctx), pions, gagnant: -1 };
  }
  const info = infoMains(restes, persp, mains[persp], null);
  const v = evaluerPlateau(pions, persp, joueur, info, prep.ctx) + valeurMain(comptesRangs(mains[persp]), pions, persp, prep.poids, copiables);
  return { v, pions, gagnant: -1 };
}

/**
 * Simule la fin de la donne après le coup candidat du siège de `prep`, avec les mains tirées.
 */
export function simuler(prep, cand, mainApres, mainsAutres, profondeurMax = Infinity) {
  const { etat, siege, n } = prep;
  const mains = mainsAutres.slice();
  mains[siege] = mainApres;
  const restes = etat.cartesRestantes.slice();
  restes[siege]--;
  let copiables = prep.copiables;
  if (n === 3) {
    const r = rangEffectif(cand);
    if (r >= 0) copiables |= 1 << r;
  }
  return jouerDonne(prep, cand.pions, mains, restes, (siege + 1) % n, etat.donne, siege, profondeurMax, copiables);
}

export { maintenant, retirerRang, melangerAvec, R_A, R_R, R_7, R_4, R_V };
