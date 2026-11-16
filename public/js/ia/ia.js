// Intelligence artificielle du Toc.
// L'IA ne connaît que l'état public, sa propre main et la carte qu'elle a donnée à son
// partenaire (elle ne triche pas). Elle compte les cartes : celles qu'elle n'a pas vues
// (ni dans la pile, ni dans sa main, ni données) sont dans les mains des autres ou dans
// les donnes suivantes du cycle.
//
// Architecture (voir les fichiers du dossier) :
//   simulation.js  moteur de règles rapide (génération des coups avec le plateau obtenu)
//   evaluation.js  évaluation d'une position (progression, allée, risques, blocages, main)
//   recherche.js   évaluation statique de chaque coup puis simulations déterminisées
//                  de la fin de la donne, dans la limite du budget de temps
//   ia.js          contrat public : choisirDon, choisirCoup (+ garde-fous de légalité)

import { coupsLegauxMain, validerCoup } from '../moteur/index.js';
import { analyser, preparer, evaluerCandidat } from './recherche.js';
import { coupsMain, indexRang, R_A, R_R } from './simulation.js';
import { evaluerPlateau } from './evaluation.js';

/**
 * Choisit la carte à donner au partenaire en début de donne.
 * Pour chaque carte : gain qu'en tirerait le partenaire (meilleur coup avec cette carte sur le
 * plateau actuel, sortie surtout s'il a des pions en base) moins la perte pour soi (gain de la
 * carte pour soi, atténué si l'on en garde une autre du même rang).
 * @param {Object} etat    état public (phase 'echange')
 * @param {number} siege   siège de l'IA
 * @param {string[]} main  main de l'IA
 * @param {Object} [options] { rng }
 * @returns {string} carte à donner
 */
export function choisirDon(etat, siege, main, options = {}) {
  if (main.length <= 1) return main[0];
  try {
    const prep = preparer(etat, siege, main, options);
    const p = (siege + 2) & 3;
    const n = etat.cartesRestantes.slice();
    const info = { n, connu: [0, 0, 0, 0], nConnu: [0, 0, 0, 0] };
    const base = (s) => evaluerPlateau(etat.pions, s & 1, (s + 1) & 3, info, prep.ctx);
    const gain = (s, carte) => {
      const coups = coupsMain(etat.pions, s, [carte], prep.cinq, 60);
      if (coups[0].coup.t === 'defausse') return -3; // carte morte pour l'instant
      const v0 = base(s);
      let best = -Infinity;
      for (const c of coups) best = Math.max(best, evaluerPlateau(c.pions, s & 1, (s + 1) & 3, info, prep.ctx) - v0);
      return best;
    };
    const comptes = new Array(13).fill(0);
    for (const c of main) comptes[indexRang(c)]++;
    let meilleure = main[0];
    let best = -Infinity;
    const vus = new Set();
    for (const carte of main) {
      const ir = indexRang(carte);
      if (vus.has(ir)) continue;
      vus.add(ir);
      let gPart = gain(p, carte);
      let gMoi = gain(siege, carte);
      if (comptes[ir] > 1) gMoi *= 0.35;
      // Cartes de sortie : le partenaire sans pion sorti en a besoin, et l'on garde
      // la sienne si l'on n'en a qu'une et des pions en base.
      if (ir === R_A || ir === R_R) {
        const sorties = comptes[R_A] + comptes[R_R];
        if (sorties > 1) gMoi *= 0.6;
      }
      // Petite préférence pour garder les cartes souples (7, 4, valet) : elles le restent.
      const v = gPart - gMoi;
      if (v > best) {
        best = v;
        meilleure = carte;
      }
    }
    return meilleure;
  } catch (e) {
    return main[0];
  }
}

/**
 * Choisit le coup à jouer.
 * @param {Object} etat    état public (phase 'jeu', etat.tour === siege)
 * @param {number} siege   siège de l'IA
 * @param {string[]} main  main de l'IA
 * @param {Object} [options] { rng, budgetMs, carteDonnee, carteRecue, iterations }
 *   Avec `rng` et `iterations` fixés (et un budget suffisant), le choix est reproductible.
 * @returns {Object} coup légal (voir regles.js)
 */
export function choisirCoup(etat, siege, main, options = {}) {
  let coup = null;
  try {
    coup = analyser(etat, siege, main, options).coup;
  } catch (e) {
    coup = null;
  }
  if (coup && validerCoup(etat, siege, coup, main) === null) return coup;
  // Repli (ne devrait jamais servir) : meilleur coup du vrai moteur selon l'évaluation simple.
  const coups = coupsLegauxMain(etat, siege, main);
  return coups[0];
}

export { evaluerCandidat };
