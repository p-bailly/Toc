// Joueurs de référence pour les tournois et les tests, et fabrique de joueurs par nom.
//
//   aleatoire      l'IA d'origine : coup légal tiré au hasard, don au hasard
//   glouton        heuristique à un coup : maximise (progression + sorties + rentrées
//                  + captures) de son équipe, sans notion de risque ni de main
//   ia             l'IA du projet (public/js/ia/ia.js), budget de temps du tournoi
//   ia-statique    l'IA sans simulations (évaluation statique seule)
//
// Un nom peut être suivi d'options JSON : ia:{"candidatsMax":4,"profondeur":6}

import { coupsLegauxMain, apercuCoup, BASE, ALLEE, caseEntree } from '../public/js/moteur/index.js';
import { choisirCoup, choisirDon } from '../public/js/ia/ia.js';
import { POIDS_DEFAUT } from '../public/js/ia/evaluation.js';

export const aleatoire = {
  nom: 'aleatoire',
  don: (etat, s, main, o) => main[Math.floor(o.rng() * main.length)],
  coup: (etat, s, main, o) => {
    const coups = coupsLegauxMain(etat, s, main);
    return coups[Math.floor(o.rng() * coups.length)];
  },
};

function potentiel(pions, equipe) {
  let v = 0;
  for (let g = 0; g < 16; g++) {
    const p = pions[g];
    let x = 0;
    if (p === BASE) x = 0;
    else if (p >= ALLEE) x = 95;
    else x = 15 + (63 - ((caseEntree(g >> 2) - p + 64) % 64));
    v += ((g >> 2) & 1) === equipe ? x : -x;
  }
  return v;
}

export const glouton = {
  nom: 'glouton',
  don: (etat, s, main, o) => {
    // garde ses as et rois, donne la plus petite carte « ordinaire »
    const ordre = ['2', '3', '5', '6', '8', '9', '10', 'D', '4', 'V', '7', 'R', 'A'];
    return main.slice().sort((a, b) => ordre.indexOf(a.slice(0, -1)) - ordre.indexOf(b.slice(0, -1)))[0];
  },
  coup: (etat, s, main, o) => {
    const coups = coupsLegauxMain(etat, s, main);
    let best = -Infinity;
    let choix = coups[0];
    for (const c of coups) {
      const v = c.t === 'defausse' ? 0 : potentiel(apercuCoup(etat, s, c).pions, s & 1) + o.rng() * 1e-3;
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
  const extra = i < 0 ? {} : JSON.parse(spec.slice(i + 1));
  if (extra.poids) extra.poids = { ...POIDS_DEFAUT, ...extra.poids };
  if (nom === 'aleatoire') return aleatoire;
  if (nom === 'glouton') return glouton;
  if (nom === 'ia' || nom === 'ia-statique') {
    const fixe = nom === 'ia-statique' ? { iterations: 0, ...extra } : extra;
    return {
      nom: spec,
      don: (etat, s, main, o) => choisirDon(etat, s, main, { ...o, ...fixe }),
      coup: (etat, s, main, o) => choisirCoup(etat, s, main, { ...o, ...fixe }),
    };
  }
  throw new Error('Joueur inconnu : ' + spec);
}
