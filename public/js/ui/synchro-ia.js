// Historique des parties contre l'IA rattaché au compte : les parties se jouent hors ligne, sur l'appareil, mais leur
// résultat suit le compte d'un appareil à l'autre. À chaque synchronisation, l'appareil verse ses parties au compte
// et range celles des autres appareils (voir parties-finies.js). Sans compte ou sans réseau, rien ne bouge : tout
// reste sur l'appareil, et partira à la prochaine occasion.

import { historiqueAEnvoyer, integrerHistoriqueCompte } from './parties-finies.js';

let enCours = null;

/**
 * Synchronise l'historique de l'appareil avec celui du compte connecté. Jamais d'erreur vers l'appelant (réseau
 * absent, règles Firestore pas encore à jour… : on réessaiera).
 * @returns {Promise<boolean>} true si l'historique de l'appareil a changé (à réafficher)
 */
export function synchroniserPartiesIA(app) {
  const faire = async () => {
    const uid = app.joueur?.uid;
    if (!uid || !app.enLigne() || typeof app.api.synchroniserPartiesIA !== 'function') return false;
    try {
      const compte = await app.api.synchroniserPartiesIA(historiqueAEnvoyer(uid));
      // Le compte a pu changer pendant l'attente (déconnexion) : on ne range que pour celui qui a demandé.
      return app.joueur?.uid === uid ? integrerHistoriqueCompte(compte, uid) : false;
    } catch (e) {
      console.warn('Historique contre l’IA non synchronisé', e);
      return false;
    }
  };
  // Une synchronisation à la fois ; une demande faite pendant qu'une autre tourne passe juste après.
  const suite = (enCours || Promise.resolve()).then(faire);
  enCours = suite;
  void suite.finally(() => {
    if (enCours === suite) enCours = null;
  });
  return suite;
}
