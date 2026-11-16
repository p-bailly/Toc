// Couleurs des pions par siège (identiques pour tous les joueurs d'une partie), peintes comme sur le plateau en bois :
// bleu et jaune (partenaires) contre rouge et vert. Le vert remplace le violet depuis que le plateau est en bois.
// Les pions sont des billes sans symbole ; la forme reste utilisée sur les petites puces de l'interface (journal,
// consigne, écran de fin) pour distinguer les joueurs sans se fier aux couleurs.

export const PIONS = [
  { nom: 'bleu', variable: '--pion-0', fonce: '--pion-0-fonce', forme: 'rond' },
  { nom: 'rouge', variable: '--pion-1', fonce: '--pion-1-fonce', forme: 'carre' },
  { nom: 'jaune', variable: '--pion-2', fonce: '--pion-2-fonce', forme: 'triangle' },
  { nom: 'vert', variable: '--pion-3', fonce: '--pion-3-fonce', forme: 'losange' },
];

export const couleurSiege = (siege) => `var(${PIONS[siege].variable})`;
/** Couleur foncée du siège (contour des billes, pastilles). */
export const couleurFonceeSiege = (siege) => `var(${PIONS[siege].fonce})`;
export const nomCouleur = (siege) => PIONS[siege].nom;

/** Valeurs de référence (thème clair), pour les tests et ce qui ne lit pas le CSS. */
export const COULEURS_PIONS = ['#2f6fb5', '#c8372d', '#e6a91b', '#3f8f4f'];
