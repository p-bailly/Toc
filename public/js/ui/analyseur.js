// Lance l'analyse de fin de partie dans un Web Worker module, avec repli sur le fil principal (tranches courtes,
// espacées) si le navigateur ne sait pas créer de Worker module.

import { creerBoucle } from './analyse-boucle.js';

/**
 * @param {Object[]} taches   voir analyse-boucle.js
 * @param {(msg:Object)=>void} surMessage
 * @returns {{ cibler(id), arreter(), mode: () => 'worker'|'principal'|'' }}
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
    worker = new Worker(new URL('./analyse-worker.js', import.meta.url), { type: 'module' });
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
