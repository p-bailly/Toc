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
//   conseils.js    notes et raisons pour conseiller le joueur (don et coup)
//   ia.js          contrat public : choisirDon, choisirCoup, conseillerDon, conseillerCoup

import { coupsLegauxMain, validerCoup } from '../moteur/index.js';
import { analyser } from './recherche.js';
import { noterDons, conseillerDon, conseillerCoup } from './conseils.js';

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
    return noterDons(etat, siege, main, options)[0].carte;
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

// Conseils au joueur humain (voir conseils.js) :
//   conseillerDon(etat, siege, main, options)  → [{ carte, note, ecart, raisons }]
//   conseillerCoup(etat, siege, main, options) → [{ coup, note, ecart, raisons, joue? }]
export { conseillerDon, conseillerCoup };
