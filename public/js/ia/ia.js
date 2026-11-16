// Intelligence artificielle du Toc.
// L'IA ne connaît que l'état public et sa propre main (elle ne triche pas).

import { coupsLegauxMain } from '../moteur/index.js';

/**
 * Choisit la carte à donner au partenaire en début de donne.
 * @param {Object} etat    état public (phase 'echange')
 * @param {number} siege   siège de l'IA
 * @param {string[]} main  main de l'IA
 * @param {Object} [options] { rng }
 * @returns {string} carte à donner
 */
export function choisirDon(etat, siege, main, options = {}) {
  const rng = options.rng || Math.random;
  return main[Math.floor(rng() * main.length)];
}

/**
 * Choisit le coup à jouer.
 * @param {Object} etat    état public (phase 'jeu', etat.tour === siege)
 * @param {number} siege   siège de l'IA
 * @param {string[]} main  main de l'IA
 * @param {Object} [options] { rng, budgetMs, carteDonnee, carteRecue }
 * @returns {Object} coup légal (voir regles.js)
 */
export function choisirCoup(etat, siege, main, options = {}) {
  const rng = options.rng || Math.random;
  const coups = coupsLegauxMain(etat, siege, main);
  return coups[Math.floor(rng() * coups.length)];
}
