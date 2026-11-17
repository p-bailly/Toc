// Couleurs des pions, peintes comme sur le plateau en bois. Chaque joueur choisit la sienne dans la palette de dix
// couleurs (../palette.js) ; une place sans choix reçoit une couleur libre, d'abord celle d'origine de son siège :
// bleu et jaune (partenaires) contre rouge et vert. Les couleurs d'une partie sont les mêmes pour tous ses joueurs.
// Les pions sont des billes sans symbole ; la forme reste utilisée sur les petites puces de l'interface (journal,
// consigne, écran de fin) pour distinguer les joueurs sans se fier aux couleurs.
//
// L'affichage passe par quatre variables CSS, une par siège (--pion-0 … --pion-3, et leur version foncée) : la
// feuille de style leur donne les couleurs d'origine, et l'écran d'une partie y pose les siennes (appliquerCouleurs).

import { COULEURS_ORIGINE, couleurDe, couleurValide, couleursDesSieges } from '../palette.js';
import { lire, ecrire } from './dom.js';

export const PIONS = [
  { nom: 'bleu', variable: '--pion-0', fonce: '--pion-0-fonce', forme: 'rond' },
  { nom: 'rouge', variable: '--pion-1', fonce: '--pion-1-fonce', forme: 'carre' },
  { nom: 'jaune', variable: '--pion-2', fonce: '--pion-2-fonce', forme: 'triangle' },
  { nom: 'vert', variable: '--pion-3', fonce: '--pion-3-fonce', forme: 'losange' },
];

export const couleurSiege = (siege) => `var(${PIONS[siege].variable})`;
/** Couleur foncée du siège (contour des billes, pastilles). */
export const couleurFonceeSiege = (siege) => `var(${PIONS[siege].fonce})`;
/** Nom de la couleur d'origine d'un siège (voir nomCouleurPartie pour celle d'une partie). */
export const nomCouleur = (siege) => PIONS[siege].nom;

/** Valeurs de référence des couleurs d'origine (thème clair), pour les tests et ce qui ne lit pas le CSS. */
export const COULEURS_PIONS = COULEURS_ORIGINE.map((id) => couleurDe(id).valeur);

/** Identifiant de la couleur de chaque siège d'une partie, d'après ses places ({ couleur? } ou null). */
export const couleursPartie = (joueurs, nb) => couleursDesSieges(joueurs, nb);

/** Pose les couleurs d'une partie sur un élément : tout ce qu'il contient (plateau, puces, sièges) les prend. */
export function appliquerCouleurs(el, couleurs) {
  couleurs.forEach((id, siege) => {
    const c = couleurDe(id);
    el.style.setProperty(PIONS[siege].variable, c.valeur);
    el.style.setProperty(PIONS[siege].fonce, c.fonce);
  });
  return couleurs;
}

/** « bleu », « orange »… : la couleur d'un siège dans une partie. `pluriel` : accordée à « les pions … ». */
export const nomCouleurPartie = (couleurs, siege, pluriel = false) => {
  const c = couleurDe(couleurs?.[siege] || COULEURS_ORIGINE[siege]);
  return pluriel ? c.pluriel : c.nom;
};

const CLE_COULEUR = 'toc.couleur';
/** La dernière couleur choisie sur cet appareil (proposée à la partie suivante), ou null. */
export const couleurPreferee = () => {
  const id = lire(CLE_COULEUR, null);
  return couleurValide(id) ? id : null;
};
export const retenirCouleur = (id) => ecrire(CLE_COULEUR, id);
