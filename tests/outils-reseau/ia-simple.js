// IA de test (coups légaux au hasard), mêmes signatures que public/js/ia/ia.js : les tests réseau ne
// dépendent pas de l'IA réelle, réécrite à part.
import {
  ALLEE,
  apercuCoup,
  caseDepart,
  coupsLegauxMain,
  couleurActive,
  nbCases,
  nombreJoueurs,
} from '../../public/js/moteur/index.js';

export function choisirDon(etat, siege, main, options = {}) {
  const rng = options.rng || Math.random;
  return main[Math.floor(rng() * main.length)];
}

export function choisirCoup(etat, siege, main, options = {}) {
  const rng = options.rng || Math.random;
  const coups = coupsLegauxMain(etat, siege, main);
  return coups[Math.floor(rng() * coups.length)];
}

// Mode à 3 : même stratégie au hasard.
export const choisirDon3 = choisirDon;
export const choisirCoup3 = choisirCoup;

/**
 * Coup glouton (pour raccourcir les parties simulées sur l'émulateur) : celui qui fait le plus
 * progresser les pions du camp actif, un peu de hasard pour départager.
 */
export function coupGlouton(etat, siege, coups, rng = Math.random) {
  const n = nombreJoueurs(etat);
  const cases = nbCases(n);
  const camp = couleurActive(etat, siege);
  const score = (pions) => {
    let t = 0;
    for (let g = camp * 4; g < camp * 4 + 4; g++) {
      const p = pions[g];
      if (p >= ALLEE) t += 200 + (p - ALLEE);
      else if (p >= 0) t += 10 + ((p - caseDepart(camp) + cases) % cases);
    }
    return t;
  };
  let meilleur = coups[0];
  let max = -Infinity;
  for (const c of coups) {
    const r = apercuCoup(etat, siege, c);
    const v = (r ? score(r.pions) : -1) + rng();
    if (v > max) {
      max = v;
      meilleur = c;
    }
  }
  return meilleur;
}

/** IA de test gloutonne (mêmes signatures que choisirCoup). */
export function choisirCoupGlouton(etat, siege, main, options = {}) {
  return coupGlouton(etat, siege, coupsLegauxMain(etat, siege, main), options.rng || Math.random);
}
