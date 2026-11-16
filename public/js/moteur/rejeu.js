// Rejouer une partie à partir de son historique, pour l'analyse de fin de partie.
// L'historique ne contient que les coups ; les échanges de cartes ne modifient pas le plateau
// et sont donc rejoués d'office au début de chaque donne.

import { mainEffective } from './cartes.js';
import { etatInitial, appliquerCoup, marquerEchange } from './regles.js';

/**
 * @param {Object} reglages    réglages de la partie ({ cinqAdverse, nbJoueurs } ; nbJoueurs absent = 4,
 *                             c'est-à-dire etat.reglages de la partie jouée)
 * @param {Object[]} historique [{ n, siege, coup, captures }] du plus ancien au plus récent
 * @returns {{tours: {n:number, siege:number, coup:Object, avant:Object, apres:Object}[],
 *            echanges: {donne:number, etat:Object}[], etat:Object}}
 *   tours[i].avant / .apres : état public avant et après le i-ème coup ;
 *   echanges[d].etat : état public au début de la donne d (phase 'echange') ;
 *   etat : état final obtenu.
 * Lève une erreur si l'historique contient un coup illégal (historique incohérent).
 */
export function rejouerPartie(reglages, historique) {
  let etat = etatInitial(reglages);
  const tours = [];
  const echanges = [{ donne: 0, etat }];
  for (const entree of historique) {
    if (etat.phase === 'echange') {
      for (let s = 0; s < etat.echanges.length; s++) if (!etat.echanges[s]) etat = marquerEchange(etat, s);
    }
    const avant = etat;
    etat = appliquerCoup(avant, entree.siege, entree.coup);
    tours.push({ n: etat.numCoup, siege: entree.siege, coup: entree.coup, avant, apres: etat });
    if (etat.phase === 'echange' && etat.donne !== avant.donne) echanges.push({ donne: etat.donne, etat });
  }
  return { tours, echanges, etat };
}

/**
 * Main du joueur juste avant un de ses coups.
 * @param {{distribuees:string[], donnee:string|null, recue:string|null}[]} donnes  indexé par donne
 * @param {Object} etatAvant  état public avant le coup (tours[i].avant)
 * @returns {string[]|null} null si les cartes de cette donne ne sont pas connues
 */
export function mainAvantCoup(donnes, etatAvant) {
  const d = donnes && donnes[etatAvant.donne];
  if (!d || !Array.isArray(d.distribuees)) return null;
  return mainEffective(d.distribuees, d.donnee, d.recue, etatAvant.pile);
}
