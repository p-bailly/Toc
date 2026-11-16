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

export const RELANCES_REFUS = 3;
const CODES_RELANCE = ['permission-denied', 'aborted', 'failed-precondition'];

/**
 * Transaction Firestore avec les garanties ci-dessus.
 *
 * Quand deux clients écrivent la même partie en même temps (échange simultané, humain et IA…),
 * Firestore évalue les règles de la transaction périmée contre le document déjà modifié : elle est
 * refusée (permission-denied) au lieu d'être relancée. On la relance donc nous-mêmes, après une
 * courte pause aléatoire : elle relit l'état à jour et recalcule l'action (ou échoue proprement si
 * l'action n'a plus lieu d'être). Un vrai refus reste un refus après ces quelques essais.
 */
export async function transaction(ctx, fn) {
  for (let essai = 0; ; essai++) {
    try {
      return await avecReseau(ctx, () => ctx.magasin.transaction(fn));
    } catch (e) {
      // Refus dû à une écriture concurrente, ou conflit qui a épuisé les essais du SDK : on relance.
      if (!CODES_RELANCE.includes(e.cause?.code) || essai >= RELANCES_REFUS) throw e;
      const rng = ctx.rng || Math.random;
      await new Promise((r) => setTimeout(r, (ctx.pauseRelance ?? 150) * (1 + rng()) * (essai + 1)));
    }
  }
}
