// IA du jeu à 3 joueurs : simple façade vers l'IA générale (ia.js), qui sait jouer à 3 comme à 4
// (elle lit le nombre de joueurs dans l'état). Conservée pour les appelants existants
// (session locale, couche réseau, API factice) qui importent choisirDon3 / choisirCoup3.
//
// L'ancienne IA provisoire à un coup est conservée comme adversaire de référence dans
// outils/references/ia3-provisoire.js.
//
// Différence unique avec choisirCoup : sans options.budgetMs, le budget par défaut est de
// 10 ms (et non 600), pour rester compatible avec les appelants qui n'en passaient pas.

import { choisirCoup, choisirDon } from './ia.js';

/** Budget par défaut de choisirCoup3 quand l'appelant n'en fournit pas. */
export const BUDGET_DEFAUT_3 = 10;

/** Carte donnée au voisin (jeu à 3) : voir choisirDon. */
export function choisirDon3(etat, siege, main, options = {}) {
  return choisirDon(etat, siege, main, options);
}

/** Coup joué (jeu à 3) : voir choisirCoup. */
export function choisirCoup3(etat, siege, main, options = {}) {
  return choisirCoup(etat, siege, main, { ...options, budgetMs: options.budgetMs ?? BUDGET_DEFAUT_3 });
}
