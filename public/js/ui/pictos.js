// Icônes au trait (SVG), couleur héritée du texte — même dessin que l'appli Scrabble.

import { s } from './dom.js';

function picto(taille, chemins, epaisseur = 2) {
  return s(
    'svg',
    {
      width: taille,
      height: taille,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': epaisseur,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'aria-hidden': 'true',
    },
    chemins.map(([tag, attrs]) => s(tag, attrs)),
  );
}

export const piParties = (t = 22) =>
  picto(t, [
    ['circle', { cx: 9, cy: 8, r: 3.5 }],
    ['path', { d: 'M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6.5 6.5 0 0 1 3.5 6' }],
  ]);
export const piIA = (t = 22) =>
  picto(t, [
    ['rect', { x: 4, y: 8, width: 16, height: 12, rx: 3 }],
    ['path', { d: 'M12 8V4M9 13h.01M15 13h.01M9 17h6M2 13v3M22 13v3' }],
    ['circle', { cx: 12, cy: 3.5, r: 1 }],
  ]);
/** Statistiques : trois barres. */
export const piBilan = (t = 22) => picto(t, [['path', { d: 'M4 20h16M7 20v-6M12 20V5M17 20v-9' }]], 2.2);
export const piRegles = (t = 22) =>
  picto(t, [['path', { d: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5v14ZM20 17v4H6.5A2.5 2.5 0 0 1 4 18.5M8 7h8M8 11h6' }]]);
export const piReglages = (t = 22) =>
  picto(t, [
    ['path', { d: 'M4 6h10M18 6h2M4 12h3M11 12h9M4 18h11M19 18h1' }],
    ['circle', { cx: 16, cy: 6, r: 2 }],
    ['circle', { cx: 9, cy: 12, r: 2 }],
    ['circle', { cx: 17, cy: 18, r: 2 }],
  ]);
export const piRetour = (t = 22) => picto(t, [['path', { d: 'm15 18-6-6 6-6' }]]);
export const piPartager = (t = 18) =>
  picto(t, [
    ['circle', { cx: 18, cy: 5, r: 3 }],
    ['circle', { cx: 6, cy: 12, r: 3 }],
    ['circle', { cx: 18, cy: 19, r: 3 }],
    ['path', { d: 'm8.6 13.5 6.8 4M15.4 6.5l-6.8 4' }],
  ]);
export const piPlus = (t = 18) => picto(t, [['path', { d: 'M12 5v14M5 12h14' }]], 2.4);
export const piHistorique = (t = 22) =>
  picto(t, [
    ['path', { d: 'M3 12a9 9 0 1 0 3-6.7L3 8' }],
    ['path', { d: 'M3 3v5h5M12 7v5l3 3' }],
  ]);
export const piOk = (t = 18) => picto(t, [['path', { d: 'M20 6 9 17l-5-5' }]], 2.6);
export const piCroix = (t = 18) => picto(t, [['path', { d: 'M18 6 6 18M6 6l12 12' }]], 2.4);
export const piAnnuler = (t = 18) =>
  picto(t, [
    ['path', { d: 'M9 14 4 9l5-5' }],
    ['path', { d: 'M4 9h11a5 5 0 0 1 0 10h-3' }],
  ]);
export const piConseil = (t = 22) =>
  picto(t, [
    ['path', { d: 'M9 18h6M10 21h4' }],
    ['path', { d: 'M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1.1 2V16h5v-.2c.1-.8.5-1.5 1.1-2A6 6 0 0 0 12 3Z' }],
  ]);
/** Revoir les coups : une flèche qui remonte le temps. */
export const piRevoir = (t = 22) => picto(t, [['path', { d: 'M11 6 5 12l6 6M19 6l-6 6 6 6' }]], 2.2);
export const piPrecedent = (t = 18) => picto(t, [['path', { d: 'm15 18-6-6 6-6' }]], 2.4);
export const piSuivant = (t = 18) => picto(t, [['path', { d: 'm9 6 6 6-6 6' }]], 2.4);
/** Carte reçue : un cadeau. */
export const piCadeau = (t = 14) =>
  picto(t, [
    ['rect', { x: 3, y: 8, width: 18, height: 4, rx: 1 }],
    ['path', { d: 'M5 12v8h14v-8M12 8v12M12 8c-1.5-4-6-4-5.5-1.2C6.9 8 12 8 12 8Zm0 0c1.5-4 6-4 5.5-1.2C17.1 8 12 8 12 8Z' }],
  ], 2);
/** Agrandir le plateau : une loupe (avec un « + », ou un « − » pour revenir). */
export const piLoupe = (t = 18, moins = false) =>
  picto(t, [
    ['circle', { cx: 10.5, cy: 10.5, r: 6.5 }],
    ['path', { d: moins ? 'm20 20-4.6-4.6M7.8 10.5h5.4' : 'm20 20-4.6-4.6M7.8 10.5h5.4M10.5 7.8v5.4' }],
  ], 2.2);
/** Crayon : renommer. */
export const piCrayon = (t = 18) => picto(t, [['path', { d: 'M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4' }]], 2);
/** Drapeau : abandonner la partie (d'un commun accord). */
export const piDrapeau = (t = 22) => picto(t, [['path', { d: 'M5 21V4M5 4h11l-2 4 2 4H5' }]], 2.2);
