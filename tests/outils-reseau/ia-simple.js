// IA de test (coups légaux au hasard), mêmes signatures que public/js/ia/ia.js : les tests réseau ne
// dépendent pas de l'IA réelle, réécrite à part.
import { coupsLegauxMain } from '../../public/js/moteur/index.js';

export function choisirDon(etat, siege, main, options = {}) {
  const rng = options.rng || Math.random;
  return main[Math.floor(rng() * main.length)];
}

export function choisirCoup(etat, siege, main, options = {}) {
  const rng = options.rng || Math.random;
  const coups = coupsLegauxMain(etat, siege, main);
  return coups[Math.floor(rng() * coups.length)];
}
