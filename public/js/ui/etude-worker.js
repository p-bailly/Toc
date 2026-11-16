// Web Worker (module) de l'analyse de fin de partie : les calculs de l'IA tournent ici, l'interface reste fluide.
// Voir etude-boucle.js pour les messages échangés.

import * as IA from '../ia/ia.js';
import { creerBoucle } from './etude-boucle.js';

const boucle = creerBoucle(IA, (m) => self.postMessage(m), { tranche: 40, premiere: 60, pause: 0 });
self.onmessage = (e) => boucle.recevoir(e.data);
