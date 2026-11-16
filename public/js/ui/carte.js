// Dessin d'une carte à jouer (HTML) : rang et symbole en coin, rouge ou noir ; au centre, le grand
// symbole, ou le personnage pour les habillés (valet, dame, roi).

import { h } from './dom.js';
import { rangAffiche, symbole, estRouge, nomCarte } from './libelles.js';
import { estJoker } from '../moteur/cartes.js';
import { estHabille, svgFigure } from './figures.js';

/** Élément DOM du personnage d'un habillé. */
function figure(rang) {
  const gabarit = document.createElement('template');
  gabarit.innerHTML = svgFigure(rang);
  return gabarit.content.firstChild;
}

/**
 * @param {string} carte   ex. « 7C »
 * @param {Object} [o]     { bouton, choisie, injouable, marque, surToucher, petite }
 */
export function dessinCarte(carte, o = {}) {
  const r = rangAffiche(carte);
  const sy = symbole(carte);
  const joker = estJoker(carte);
  const contenu = joker
    ? [h('span', { class: 'titre-joker' }, 'JOKER'), h('span', { class: 'symbole-central' }, '★'), o.marque ? h('span', { class: 'marque-carte' }, o.marque) : null]
    : [
    h('span', { class: 'coin haut' }, h('b', {}, r), h('span', {}, sy)),
    h('span', { class: 'symbole-central' + (estHabille(r) ? ' figure' : '') }, estHabille(r) ? figure(r) : sy),
    h('span', { class: 'coin bas' }, h('b', {}, r), h('span', {}, sy)),
    o.marque ? h('span', { class: 'marque-carte' }, o.marque) : null,
  ];
  const classes = ['carte-jeu', joker ? 'joker' : estRouge(carte) ? 'rouge' : 'noire'];
  if (!joker && estHabille(r)) classes.push('habille');
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
