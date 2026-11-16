// Exécution des actions réseau : contrôle de connexion, délai maximal, messages en français.

import { ErreurToc, HORS_LIGNE, enErreurToc } from './commun.js';

export const DELAI_RESEAU = 20000;

/** Hors ligne d'après le navigateur (toujours « en ligne » dans Node). */
export function horsLigne() {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

/**
 * Exécute une action qui a besoin du serveur (transaction) : échoue tout de suite hors ligne, et au
 * bout de `ctx.delaiReseau` ms si le serveur ne répond pas, plutôt que de laisser l'écran en attente.
 */
export async function avecReseau(ctx, action) {
  if ((ctx.horsLigne || horsLigne)()) throw new ErreurToc(HORS_LIGNE, 'unavailable');
  const delai = ctx.delaiReseau ?? DELAI_RESEAU;
  let minuterie = null;
  const limite = new Promise((_, rejeter) => {
    minuterie = setTimeout(
      () => rejeter(new ErreurToc('Le serveur ne répond pas : vérifie ta connexion et réessaie.', 'deadline-exceeded')),
      delai,
    );
  });
  try {
    return await Promise.race([action(), limite]);
  } catch (e) {
    throw enErreurToc(e);
  } finally {
    clearTimeout(minuterie);
  }
}

/** Transaction Firestore avec les garanties ci-dessus. */
export function transaction(ctx, fn) {
  return avecReseau(ctx, () => ctx.magasin.transaction(fn));
}
