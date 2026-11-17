// Règles du Toc (route #/regles) : l'infographie « Le Toc en une page », générée par outils/regles/construire.mjs.

import { h, remplacer } from './dom.js';
import { entete } from './composants.js';
import { HTML_REGLES } from './regles-page.js';

/** « Le Toc en une page » : l'infographie générée (schémas et textes), posée telle quelle. */
function infographie() {
  const page = h('div', { class: 'regles-info' });
  page.innerHTML = HTML_REGLES;
  return page;
}

export function afficher(racine) {
  remplacer(racine, h('div', { class: 'contenu pleine' }, entete('Le Toc en une page'), infographie()));
  return null;
}
