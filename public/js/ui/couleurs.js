// Couleurs et formes des pions par siège (identiques pour tous les joueurs d'une partie).
// La forme blanche dessinée sur chaque pion permet de les distinguer sans les couleurs (daltonisme).
// Les partenaires (0-2 et 1-3) ont des formes « sœurs » : rond / triangle, carré / losange.

export const PIONS = [
  { nom: 'rouge', variable: '--pion-0', forme: 'rond' },
  { nom: 'bleu', variable: '--pion-1', forme: 'carre' },
  { nom: 'jaune', variable: '--pion-2', forme: 'triangle' },
  { nom: 'violet', variable: '--pion-3', forme: 'losange' },
];

export const couleurSiege = (siege) => `var(${PIONS[siege].variable})`;
export const nomCouleur = (siege) => PIONS[siege].nom;
