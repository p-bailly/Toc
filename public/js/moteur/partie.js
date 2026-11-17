// Partie complète en mémoire (plateau public + mains privées), pour le jeu local,
// les tests et les simulations de l'IA. En ligne, les mains vivent dans Firestore
// et la couche réseau applique les mêmes fonctions du moteur.
//
// Jeu à 3 joueurs : nouvellePartie({ nbJoueurs: 3, … }) ; les tableaux indexés par siège ont
// alors 3 éléments, le cycle compte 4 donnes (5-4-4-5, 54 cartes) et chaque carte donnée va au
// voisin désigné par destinataireDon(donne, siege, 3) (plateau.js).

import { distribuerCycle, distribuerPremierCycle, longueurCycle } from './cartes.js';
import { destinataireDon } from './plateau.js';
import { etatInitial, appliquerCoup, marquerEchange, nombreJoueurs } from './regles.js';

/**
 * @typedef {Object} Partie
 * @property {Object} etat           état public (voir regles.js)
 * @property {string[][]} mains      mains[siege]
 * @property {string[][][]} cycle    mains prédistribuées pour les donnes du cycle courant
 *                                   (3 donnes à 4 joueurs, 4 à 3 joueurs)
 * @property {(string|null)[]} dons  dons[siege] = carte donnée par ce siège pour la donne courante
 *                                   (au partenaire ; au voisin à 3 joueurs)
 * @property {Object[]} historique   [{ n, siege, coup, captures }]
 * @property {Object[]} archives     archives[donne] = { mains, dons, vers } : mains distribuées,
 *                                   cartes données et destinataire de chaque don
 *                                   (vers[siege] = siège qui reçoit dons[siege]) à chaque donne
 *                                   (pour l'analyse de fin de partie)
 */

function destinataires(donne, n) {
  return Array.from({ length: n }, (_, s) => destinataireDon(donne, s, n));
}

export function nouvellePartie(reglages = {}, rng = Math.random) {
  const etat = etatInitial(reglages);
  const n = nombreJoueurs(etat);
  // Première donne de la partie : distribution un peu lissée (voir distribuerPremierCycle).
  const cycle = distribuerPremierCycle(rng, n);
  return {
    etat,
    mains: cycle[0].map((m) => m.slice()),
    cycle,
    dons: Array(n).fill(null),
    historique: [],
    archives: [{ mains: cycle[0].map((m) => m.slice()), dons: Array(n).fill(null), vers: destinataires(0, n) }],
  };
}

function archiverDons(partie, etat, dons) {
  if (!Array.isArray(partie.archives)) return undefined; // partie sauvegardée avant les archives
  const archives = partie.archives.slice();
  if (archives[etat.donne]) archives[etat.donne] = { ...archives[etat.donne], dons: dons.slice() };
  return archives;
}

/**
 * Le joueur donne une carte (à son partenaire ; à 3 joueurs, au voisin de la donne).
 * L'échange est effectif quand tous les joueurs ont donné.
 */
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
    const n = dons.length;
    for (let s = 0; s < n; s++) mains[destinataireDon(etat.donne, s, n)].push(dons[s]);
  }
  return { ...partie, etat, mains, dons, archives: archiverDons(partie, partie.etat, dons) };
}

/** Joue un coup (validé contre la main du joueur). */
export function jouerCoup(partie, siege, coup, rng = Math.random) {
  const etat = appliquerCoup(partie.etat, siege, coup, partie.mains[siege]);
  const n = nombreJoueurs(etat);
  let mains = partie.mains.map((m) => m.slice());
  mains[siege].splice(mains[siege].indexOf(coup.carte), 1);
  let { cycle, dons } = partie;
  const historique = partie.historique.concat([
    { n: etat.numCoup, siege, coup: etat.dernierCoup.coup, captures: etat.dernierCoup.captures },
  ]);
  const L = longueurCycle(n);
  if (etat.phase !== 'fini' && etat.donne !== partie.etat.donne) {
    if (etat.donne % L === 0) cycle = distribuerCycle(rng, n);
    mains = cycle[etat.donne % L].map((m) => m.slice());
    dons = Array(n).fill(null);
  }
  let { archives } = partie;
  if (Array.isArray(archives) && etat.donne !== partie.etat.donne && etat.phase !== 'fini') {
    archives = archives.slice();
    archives[etat.donne] = { mains: mains.map((m) => m.slice()), dons: Array(n).fill(null), vers: destinataires(etat.donne, n) };
  }
  return { ...partie, etat, mains, cycle, dons, historique, archives };
}
