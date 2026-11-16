// Dessin d'une carte à jouer (HTML) : rang et symbole en coin, grand symbole au centre, rouge ou noir.

import { h } from './dom.js';
import { rangAffiche, symbole, estRouge, nomCarte } from './libelles.js';

/**
 * @param {string} carte   ex. « 7C »
 * @param {Object} [o]     { bouton, choisie, injouable, marque, surToucher, petite }
 */
export function dessinCarte(carte, o = {}) {
  const r = rangAffiche(carte);
  const sy = symbole(carte);
  const contenu = [
    h('span', { class: 'coin haut' }, h('b', {}, r), h('span', {}, sy)),
    h('span', { class: 'symbole-central' + (['V', 'D', 'R'].includes(r) ? ' figure' : '') }, ['V', 'D', 'R'].includes(r) ? r : sy),
    h('span', { class: 'coin bas' }, h('b', {}, r), h('span', {}, sy)),
    o.marque ? h('span', { class: 'marque-carte' }, o.marque) : null,
  ];
  const classes = ['carte-jeu', estRouge(carte) ? 'rouge' : 'noire'];
  if (o.choisie) classes.push('choisie');
  if (o.injouable) classes.push('injouable');
  if (o.petite) classes.push('petite');
  if (!o.bouton) return h('span', { class: classes.join(' '), 'aria-label': nomCarte(carte), role: 'img' }, contenu);
  return h(
    'button',
    {
      type: 'button',
      class: classes.join(' '),
      'data-carte': carte,
      'aria-label': nomCarte(carte) + (o.injouable ? ' (injouable)' : '') + (o.marque ? ` (${o.marque})` : ''),
      'aria-pressed': String(!!o.choisie),
      'aria-disabled': o.inactive ? 'true' : null,
      onclick: o.surToucher,
    },
    contenu,
  );
}
