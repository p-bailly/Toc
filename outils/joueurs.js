// Joueurs de référence pour les tournois et les tests, et fabrique de joueurs par nom.
//
//   aleatoire      l'IA d'origine : coup légal tiré au hasard, don au hasard
//   glouton        heuristique à un coup : maximise (progression + sorties + rentrées
//                  + captures) de son équipe, sans notion de risque ni de main
//   ia             l'IA du projet (public/js/ia/ia.js), budget de temps du tournoi
//   ia-statique    l'IA sans simulations (évaluation statique seule)
//   ia3-provisoire l'IA provisoire à un coup du jeu à 3 (copie figée de l'ancien ia3.js)
//   ia-avant       l'IA du jeu à 4 telle qu'avant la généralisation au jeu à 3 (non-régression)
//
// Un nom peut être suivi d'options JSON : ia:{"candidatsMax":4,"profondeur":6}, ou d'un niveau :
// ia:debutant, ia:amateur, ia:confirme, ia:expert, ia:champion

import { coupsLegauxMain, apercuCoup, BASE, ALLEE, caseEntree } from '../public/js/moteur/index.js';
import { choisirCoup, choisirDon } from '../public/js/ia/ia.js';
import { choisirCoup3, choisirDon3 } from './references/ia3-provisoire.js';
import * as iaAvant from './references/ia-4-avant/ia.js';
import { POIDS_DEFAUT } from '../public/js/ia/evaluation.js';

export const aleatoire = {
  nom: 'aleatoire',
  don: (etat, s, main, o) => main[Math.floor(o.rng() * main.length)],
  coup: (etat, s, main, o) => {
    const coups = coupsLegauxMain(etat, s, main);
    return coups[Math.floor(o.rng() * coups.length)];
  },
};

/** Potentiel d'un plateau pour le siège s : son camp moins les adversaires (moyenne à 3). */
function potentiel(pions, s) {
  const nb = pions.length >> 2;
  const N = nb * 16;
  let v = 0;
  for (let g = 0; g < pions.length; g++) {
    const p = pions[g];
    let x = 0;
    if (p === BASE) x = 0;
    else if (p >= ALLEE) x = N + 31;
    else x = 15 + (N - 1 - ((caseEntree(g >> 2, nb) - p + N) % N));
    const o = g >> 2;
    if (nb === 4) v += (o & 1) === (s & 1) ? x : -x;
    else v += o === s ? x : -x / 2;
  }
  return v;
}

export const glouton = {
  nom: 'glouton',
  don: (etat, s, main, o) => {
    // garde ses as et rois, donne la plus petite carte « ordinaire »
    const ordre = ['2', '3', '5', '6', '8', '9', '10', 'D', '4', 'V', '7', 'R', 'A', 'J'];
    return main.slice().sort((a, b) => ordre.indexOf(a.slice(0, -1)) - ordre.indexOf(b.slice(0, -1)))[0];
  },
  coup: (etat, s, main, o) => {
    const coups = coupsLegauxMain(etat, s, main);
    let best = -Infinity;
    let choix = coups[0];
    for (const c of coups) {
      const v = c.t === 'defausse' ? 0 : potentiel(apercuCoup(etat, s, c).pions, s) + o.rng() * 1e-3;
      if (v > best) {
        best = v;
        choix = c;
      }
    }
    return choix;
  },
};

export function fabriquerJoueur(spec) {
  const i = spec.indexOf(':');
  const nom = i < 0 ? spec : spec.slice(0, i);
  // ia:expert = ia:{"niveau":"expert"}
  const suite = i < 0 ? '' : spec.slice(i + 1);
  const extra = !suite ? {} : suite.startsWith('{') ? JSON.parse(suite) : { niveau: suite };
  if (extra.poids) extra.poids = { ...POIDS_DEFAUT, ...extra.poids };
  if (nom === 'aleatoire') return aleatoire;
  if (nom === 'glouton') return glouton;
  if (nom === 'ia3-provisoire') {
    return { nom, don: (e, s, m, o) => choisirDon3(e, s, m, o), coup: (e, s, m, o) => choisirCoup3(e, s, m, o) };
  }
  if (nom === 'ia-avant') {
    return {
      nom: spec,
      don: (e, s, m, o) => iaAvant.choisirDon(e, s, m, { ...o, ...extra }),
      coup: (e, s, m, o) => iaAvant.choisirCoup(e, s, m, { ...o, ...extra }),
    };
  }
  if (nom === 'ia' || nom === 'ia-statique') {
    const fixe = nom === 'ia-statique' ? { iterations: 0, ...extra } : extra;
    // option d'expérience : {"don":"ia3"} remplace le don par celui de l'IA provisoire
    const don = extra.don === 'ia3' ? choisirDon3 : choisirDon;
    return {
      nom: spec,
      don: (etat, s, main, o) => don(etat, s, main, { ...o, ...fixe }),
      coup: (etat, s, main, o) => choisirCoup(etat, s, main, { ...o, ...fixe }),
    };
  }
  throw new Error('Joueur inconnu : ' + spec);
}
