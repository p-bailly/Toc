// Lance l'analyse de fin de partie dans un Web Worker module, avec repli sur le fil principal (tranches courtes,
// espacées) si le navigateur ne sait pas créer de Worker module.

import { creerBoucle } from './etude-boucle.js';

/**
 * @param {Object[]} taches   voir etude-boucle.js
 * @param {(msg:Object)=>void} surMessage
 * @returns {{ cibler(id), charger(taches), arreter(), mode: () => 'worker'|'principal'|'' }}
 *   charger(taches) remplace la liste des tours à analyser (autre joueur) ; les analyses déjà faites sont gardées.
 */
export function lancerAnalyse(taches, surMessage) {
  let mode = '';
  let arrete = false;
  let envoyer = () => {};
  let cibleEnAttente = null;

  const repli = async () => {
    if (arrete) return;
    mode = 'principal';
    const IA = await import('../ia/ia.js');
    if (arrete) return;
    const boucle = creerBoucle(IA, surMessage, { tranche: 20, premiere: 30, pause: 25 });
    envoyer = (m) => boucle.recevoir(m);
    envoyer({ type: 'taches', taches });
    if (cibleEnAttente !== null) envoyer({ type: 'cible', id: cibleEnAttente });
  };

  let worker = null;
  try {
    worker = new Worker(new URL('./etude-worker.js', import.meta.url), { type: 'module' });
  } catch {
    worker = null;
  }
  if (worker) {
    mode = 'worker';
    let pret = false;
    worker.onmessage = (e) => {
      if (e.data?.type === 'pret') pret = true;
      surMessage(e.data);
    };
    worker.onerror = (e) => {
      // Worker module refusé ou en échec au chargement : on calcule sur le fil principal.
      e.preventDefault?.();
      if (!pret) {
        worker.terminate();
        worker = null;
        repli();
      }
    };
    envoyer = (m) => worker?.postMessage(m);
    envoyer({ type: 'taches', taches });
  } else {
    repli();
  }

  return {
    charger(nouvelles) {
      taches = nouvelles;
      envoyer({ type: 'taches', taches });
    },
    cibler(id) {
      cibleEnAttente = id;
      envoyer({ type: 'cible', id });
    },
    arreter() {
      arrete = true;
      envoyer({ type: 'arreter' });
      worker?.terminate();
    },
    mode: () => mode,
  };
}
