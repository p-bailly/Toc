// Dessins des habillés (valet, dame, roi) : personnages à deux têtes, comme sur les cartes.
// Dessins originaux, en SVG. La couleur de la carte (rouge ou noire) vient de `currentColor`.

const OR = '#e9b63a';
const OR_FONCE = '#b9851c';
const PEAU = '#f6d9bc';
const TRAIT = '#2a1c12';
const BLANC = '#fffdf6';

/** Visage commun : cou, tête, yeux, bouche. */
const visage = `
  <rect x="19" y="22.5" width="6" height="6" fill="${PEAU}" stroke="${TRAIT}" stroke-width=".5"/>
  <ellipse cx="22" cy="17" rx="6.4" ry="7.4" fill="${PEAU}" stroke="${TRAIT}" stroke-width=".7"/>
  <circle cx="19.5" cy="16.4" r=".85" fill="${TRAIT}"/><circle cx="24.5" cy="16.4" r=".85" fill="${TRAIT}"/>
  <path d="M18.3 14.6h2.4M23.3 14.6h2.4" stroke="${TRAIT}" stroke-width=".55" stroke-linecap="round"/>`;

/** Épaules et vêtement, à la couleur de la carte. */
const epaules = `<path d="M1.5 45V37.5Q1.5 31 9 29.2L17.5 27.2Q22 31 26.5 27.2L35 29.2Q42.5 31 42.5 37.5V45Z" fill="currentColor"/>`;

const DEMI = {
  // Roi : grande couronne à cinq pointes, barbe, col d'hermine, sceptre.
  R: `${epaules}
  <path d="M9 29.6L17.5 27.2Q22 31 26.5 27.2L35 29.6L33 34Q22 30.5 11 34Z" fill="${BLANC}" stroke="${TRAIT}" stroke-width=".5"/>
  <path d="M14 31.2v1.5M18 30.4v1.5M26 30.4v1.5M30 31.2v1.5" stroke="${TRAIT}" stroke-width=".9" stroke-linecap="round"/>
  <path d="M19.2 33.5h5.6V45h-5.6z" fill="${OR}" stroke="${OR_FONCE}" stroke-width=".5"/>
  <path d="M36.5 45V26.5" stroke="${OR_FONCE}" stroke-width="1.5" stroke-linecap="round"/><circle cx="36.5" cy="24.6" r="2.3" fill="${OR}" stroke="${OR_FONCE}" stroke-width=".5"/>
  <path d="M15 13Q13.6 22 16.4 25.5L15 12.5ZM29 13Q30.4 22 27.6 25.5L29 12.5Z" fill="#7a5a3a"/>
  ${visage}
  <path d="M15.7 18.5Q16 27.5 22 29Q28 27.5 28.3 18.5Q26.5 21.4 24.3 20.6Q22 19.6 19.7 20.6Q17.5 21.4 15.7 18.5Z" fill="#7a5a3a" stroke="${TRAIT}" stroke-width=".5"/>
  <path d="M20.4 22.3q1.6 1 3.2 0" stroke="${TRAIT}" stroke-width=".6" fill="none" stroke-linecap="round"/>
  <path d="M13.8 11.6V3.4L17.6 7.2L22 2L26.4 7.2L30.2 3.4V11.6Z" fill="${OR}" stroke="${OR_FONCE}" stroke-width=".6" stroke-linejoin="round"/>
  <rect x="13.8" y="9.6" width="16.4" height="2.6" fill="${OR_FONCE}"/>
  <circle cx="22" cy="2.6" r="1.15" fill="#d8342c"/><circle cx="13.9" cy="3.6" r=".9" fill="#d8342c"/><circle cx="30.1" cy="3.6" r=".9" fill="#d8342c"/>
  <circle cx="18" cy="10.9" r=".7" fill="${BLANC}"/><circle cx="22" cy="10.9" r=".7" fill="#d8342c"/><circle cx="26" cy="10.9" r=".7" fill="${BLANC}"/>`,

  // Dame : longs cheveux, petite couronne perlée, collier, fleur.
  D: `<path d="M14.2 17Q12.6 5.6 22 5.6Q31.4 5.6 29.8 17L31.4 30.5Q27.6 33 26.8 27V16.2Q22 11.6 17.2 16.2V27Q16.4 33 12.6 30.5Z" fill="#c98a2b" stroke="${TRAIT}" stroke-width=".6"/>
  ${epaules}
  <path d="M15.5 27.8Q22 37 28.5 27.8L26.5 27.2Q22 31 17.5 27.2Z" fill="${BLANC}" stroke="${TRAIT}" stroke-width=".45"/>
  <path d="M17 31.4Q22 37 27 31.4" stroke="${OR}" stroke-width="1.1" fill="none"/><circle cx="22" cy="35.3" r="1.4" fill="${OR}" stroke="${OR_FONCE}" stroke-width=".4"/>
  <path d="M7 45Q7.5 38 12 36M37 45Q36.5 38 32 36" stroke="${OR}" stroke-width="1" fill="none" stroke-linecap="round"/>
  <g transform="translate(36.2 27.4)"><circle r="1.5" cx="0" cy="-2.1" fill="#ef7d9a" stroke="#a8324f" stroke-width=".3"/><circle r="1.5" cx="2" cy="-.6" fill="#ef7d9a" stroke="#a8324f" stroke-width=".3"/><circle r="1.5" cx="1.2" cy="1.8" fill="#ef7d9a" stroke="#a8324f" stroke-width=".3"/><circle r="1.5" cx="-1.2" cy="1.8" fill="#ef7d9a" stroke="#a8324f" stroke-width=".3"/><circle r="1.5" cx="-2" cy="-.6" fill="#ef7d9a" stroke="#a8324f" stroke-width=".3"/><circle r="1.2" fill="${OR}"/></g>
  <path d="M36.2 30V45" stroke="#3f8f4f" stroke-width="1.1" stroke-linecap="round"/>
  ${visage}
  <path d="M20.2 21.2q1.8 1.5 3.6 0" stroke="#c0392b" stroke-width=".9" fill="none" stroke-linecap="round"/>
  <path d="M15.4 13.6Q17 8.6 22 9.4Q27 8.6 28.6 13.6Q25.4 10.8 22 12Q18.6 10.8 15.4 13.6Z" fill="#c98a2b" stroke="${TRAIT}" stroke-width=".4"/>
  <path d="M15.8 9.2V4.6L18.9 7L22 3.4L25.1 7L28.2 4.6V9.2Z" fill="${OR}" stroke="${OR_FONCE}" stroke-width=".55" stroke-linejoin="round"/>
  <circle cx="15.8" cy="4.2" r=".95" fill="${BLANC}" stroke="${OR_FONCE}" stroke-width=".3"/><circle cx="22" cy="3" r="1.05" fill="${BLANC}" stroke="${OR_FONCE}" stroke-width=".3"/><circle cx="28.2" cy="4.2" r=".95" fill="${BLANC}" stroke="${OR_FONCE}" stroke-width=".3"/>`,

  // Valet : toque à plume, cheveux mi-longs, tunique rayée, hallebarde.
  V: `<path d="M14.6 15Q14 24.5 16.8 26.6L17.4 16ZM29.4 15Q30 24.5 27.2 26.6L26.6 16Z" fill="#8a5a2b" stroke="${TRAIT}" stroke-width=".5"/>
  ${epaules}
  <path d="M10 31.5V45M15 30V45M29 30V45M34 31.5V45" stroke="${OR}" stroke-width="1.5"/>
  <path d="M17.5 27.2Q22 31 26.5 27.2L27.4 31.4Q22 35 16.6 31.4Z" fill="${BLANC}" stroke="${TRAIT}" stroke-width=".45"/>
  <path d="M19.2 34h5.6V45h-5.6z" fill="${OR}" stroke="${OR_FONCE}" stroke-width=".5"/>
  <path d="M6.5 45V22" stroke="#8a5a2b" stroke-width="1.4" stroke-linecap="round"/><path d="M6.5 14.5L9.3 22.6H3.7Z" fill="#c9cfd6" stroke="${TRAIT}" stroke-width=".5" stroke-linejoin="round"/>
  ${visage}
  <path d="M20.3 21.4q1.7 1.2 3.4 0" stroke="${TRAIT}" stroke-width=".65" fill="none" stroke-linecap="round"/>
  <path d="M13.6 12.4Q13.2 4 22 4Q30.8 4 30.4 12.4Q26 9.6 22 10.4Q18 9.6 13.6 12.4Z" fill="currentColor" stroke="${TRAIT}" stroke-width=".5"/>
  <path d="M13 12.9Q22 9.4 31 12.9" stroke="${OR}" stroke-width="1.7" fill="none" stroke-linecap="round"/>
  <path d="M27.5 7.5Q33 -1 39.5 5.6Q35.6 4.6 33.6 7.4Q31.4 10.6 28.4 9.6Z" fill="${BLANC}" stroke="${TRAIT}" stroke-width=".5" stroke-linejoin="round"/>
  <path d="M28.6 8.6Q33 3.6 38 5.2" stroke="${TRAIT}" stroke-width=".4" fill="none"/>`,
};

/**
 * Contenu SVG (repère 44 × 90) du personnage d'un habillé, deux têtes en miroir.
 * @param {'V'|'D'|'R'} rang
 * @returns {string} balisage à placer dans un <svg viewBox=CADRE_FIGURE>, ou '' si le rang n'est pas un habillé
 */
export function contenuFigure(rang) {
  const demi = DEMI[rang];
  if (!demi) return '';
  return `<rect x=".8" y=".8" width="42.4" height="88.4" rx="3" fill="${BLANC}" stroke="currentColor" stroke-width="1.3"/>
<g>${demi}</g><g transform="rotate(180 22 45)">${demi}</g>
<path d="M1.5 45H42.5" stroke="${BLANC}" stroke-width=".9"/>
<rect x=".8" y=".8" width="42.4" height="88.4" rx="3" fill="none" stroke="currentColor" stroke-width="1.3"/>`;
}

/** Zone à afficher : le dessin (44 × 90) avec une petite marge, pour que le cadre ne soit jamais rogné. */
export const CADRE_FIGURE = '-1.5 -1.5 47 93';

/** Balisage SVG complet d'un habillé (pour une carte en HTML). */
export function svgFigure(rang) {
  const contenu = contenuFigure(rang);
  return contenu ? `<svg viewBox="${CADRE_FIGURE}" aria-hidden="true" focusable="false">${contenu}</svg>` : '';
}

export const estHabille = (rang) => rang === 'V' || rang === 'D' || rang === 'R';
