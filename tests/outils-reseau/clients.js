// Fabrique des clients réseau branchés sur le faux serveur.

import { creerClient } from '../../public/js/reseau/client.js';
import { choisirCoup, choisirDon } from './ia-simple.js';
import { generateurAleatoire } from '../../public/js/moteur/index.js';

export function nouveauClient(serveur, { graine = 1, session = {}, ...autres } = {}) {
  const magasin = serveur.client(null);
  const auth = serveur.auth(magasin);
  const rng = generateurAleatoire(graine);
  const client = creerClient({
    services: async () => ({ magasin, auth }),
    ia: { choisirDon, choisirCoup },
    rng,
    delaiReseau: 5000,
    pauseRelance: 2,
    session: { delaiIA: 0, attenteAutres: [0, 3], budgetIA: 5, ...session },
    ...autres,
  });
  return { client, magasin, auth, rng };
}

/** Contexte bas niveau (fonctions de parties.js) pour un uid déjà connu. */
export function contexte(serveur, uid, graine = 1) {
  return { magasin: serveur.client(uid), uid, rng: generateurAleatoire(graine), delaiReseau: 5000, pauseRelance: 2 };
}
