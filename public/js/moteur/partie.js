// Partie complète en mémoire (plateau public + mains privées), pour le jeu local,
// les tests et les simulations de l'IA. En ligne, les mains vivent dans Firestore
// et la couche réseau applique les mêmes fonctions du moteur.

import { distribuerCycle } from './cartes.js';
import { partenaire } from './plateau.js';
import { etatInitial, appliquerCoup, marquerEchange } from './regles.js';

/**
 * @typedef {Object} Partie
 * @property {Object} etat           état public (voir regles.js)
 * @property {string[][]} mains      mains[siege]
 * @property {string[][][]} cycle    mains prédistribuées pour les 3 donnes du cycle courant
 * @property {(string|null)[]} dons  dons[siege] = carte donnée au partenaire pour la donne courante
 * @property {Object[]} historique   [{ n, siege, coup, captures }]
 */

export function nouvellePartie(reglages = {}, rng = Math.random) {
  const cycle = distribuerCycle(rng);
  return {
    etat: etatInitial(reglages),
    mains: cycle[0].map((m) => m.slice()),
    cycle,
    dons: [null, null, null, null],
    historique: [],
  };
}

/** Le joueur donne une carte à son partenaire. L'échange est effectif quand les quatre ont donné. */
export function donnerCarte(partie, siege, carte) {
  if (partie.etat.phase !== 'echange') throw new Error("Ce n'est pas la phase d'échange.");
  if (partie.dons[siege]) throw new Error('Ce joueur a déjà donné sa carte.');
  if (!partie.mains[siege].includes(carte)) throw new Error("Cette carte n'est pas dans la main du joueur.");
  const etat = marquerEchange(partie.etat, siege);
  const mains = partie.mains.map((m) => m.slice());
  mains[siege].splice(mains[siege].indexOf(carte), 1);
  const dons = partie.dons.slice();
  dons[siege] = carte;
  if (etat.phase === 'jeu') {
    for (let s = 0; s < 4; s++) mains[partenaire(s)].push(dons[s]);
  }
  return { ...partie, etat, mains, dons };
}

/** Joue un coup (validé contre la main du joueur). */
export function jouerCoup(partie, siege, coup, rng = Math.random) {
  const etat = appliquerCoup(partie.etat, siege, coup, partie.mains[siege]);
  let mains = partie.mains.map((m) => m.slice());
  mains[siege].splice(mains[siege].indexOf(coup.carte), 1);
  let { cycle, dons } = partie;
  const historique = partie.historique.concat([
    { n: etat.numCoup, siege, coup: etat.dernierCoup.coup, captures: etat.dernierCoup.captures },
  ]);
  if (etat.phase !== 'fini' && etat.donne !== partie.etat.donne) {
    if (etat.donne % 3 === 0) cycle = distribuerCycle(rng);
    mains = cycle[etat.donne % 3].map((m) => m.slice());
    dons = [null, null, null, null];
  }
  return { ...partie, etat, mains, cycle, dons, historique };
}
