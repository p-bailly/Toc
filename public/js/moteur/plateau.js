// Modèle du plateau de Toc.
//
// Circuit principal : 72 cases numérotées de 0 à 71, parcourues dans l'ordre croissant.
// Quatre sièges (0 à 3) ; les partenaires sont face à face : 0 et 2 contre 1 et 3.
// Il y a 18 cases d'une case de départ à la suivante : la case de départ du siège s est la
// case 18 × s (au milieu d'un côté du plateau carré).
// L'allée d'arrivée d'un joueur s'ouvre 3 cases AVANT sa case de départ (à droite de celle-ci
// vu du joueur, puisque les pions tournent dans le sens horaire) : c'est la « case d'entrée ».
// Depuis la case d'entrée, la k-ième case de l'allée (k = 0 à 3) est à k + 1 pas.
// Ainsi un pion sur sa case de départ qui recule de 4 se trouve une case avant l'entrée,
// et un 5 l'amène au fond de l'allée.
//
// Position d'un pion :
//   BASE (-1)        : pion non sorti
//   0 … 71           : case du circuit
//   ALLEE + k (100+k): k-ième case de l'allée d'arrivée de son propriétaire (3 = fond)
//
// Les 16 pions sont numérotés de 0 à 15 : le pion g appartient au siège g >> 2.
//
// Mode à 3 joueurs (chacun pour soi) : circuit de 54 cases (3 côtés de 18), sièges 0 à 2,
// 12 pions. Chaque joueur garde exactement la géométrie du jeu à 4 : case de départ 18 × s,
// case d'entrée 3 cases avant ((18 × s − 3) mod 54), allée de 4 cases. Pas d'équipe ni de
// partenaire. Les fonctions qui dépendent du nombre de joueurs prennent un paramètre
// `nbJoueurs` facultatif (4 par défaut).
//
// Deux plateaux. Les premières parties se sont jouées avec 16 cases entre deux cases de départ
// (64 cases à 4, 48 à 3) : elles se terminent, se rejouent et s'analysent sur ce plateau-là.
// Le plateau d'une partie se lit dans son état : etat.v = 1 pour 16 cases, 2 pour 18
// (`coteDeEtat`). Les fonctions qui ne reçoivent qu'un tableau de pions (ici, dans regles.js et
// dans l'IA) travaillent sur le « plateau visé » : toute fonction qui reçoit un état commence
// par le viser (`viser(etat)`), et les écrans visent celui de la partie qu'ils montrent.

export const NB_SIEGES = 4;
export const PIONS_PAR_JOUEUR = 4;
export const NB_PIONS = 16;
export const BASE = -1;
export const ALLEE = 100;
export const LONGUEUR_ALLEE = 4;

export const DISTANCE_ENTREE = 3; // l'entrée de l'allée est 3 cases avant la case de départ

/** Cases d'une case de départ à la suivante : le plateau actuel, et celui des premières parties. */
export const COTE_ACTUEL = 18;
export const COTE_ANCIEN = 16;
/** Plus grand circuit possible (pour les tableaux d'occupation). */
export const CASES_MAX = COTE_ACTUEL * NB_SIEGES;
/** Nombres de joueurs possibles : 4 (deux équipes de deux) ou 3 (chacun pour soi). */
export const NOMBRES_JOUEURS = [3, 4];

const coteValide = (c) => (c === COTE_ANCIEN ? COTE_ANCIEN : COTE_ACTUEL);

/** Plateau visé : celui des fonctions qui ne reçoivent pas d'état. Liaison vivante, à lire sans la copier. */
export let COTE = COTE_ACTUEL;
let coteNeuf = COTE_ACTUEL;

/** Vise un plateau (16 ou 18 cases entre deux cases de départ). */
export function viserPlateau(cote) {
  COTE = coteValide(cote);
  return COTE;
}

/** Plateau d'un état : 16 pour une partie d'avant (v = 1, ou sans version), 18 sinon. */
export const coteDeEtat = (etat) => (etat && etat.v >= 2 ? COTE_ACTUEL : COTE_ANCIEN);
/** Version d'état (etat.v) d'un plateau. */
export const versionDuPlateau = (cote) => (cote === COTE_ANCIEN ? 1 : 2);

/** Vise le plateau d'un état, et le renvoie. */
export const viser = (etat) => viserPlateau(coteDeEtat(etat));

/** Plateau des parties créées sans précision (etatInitial). */
export const coteDesNouvellesParties = () => coteNeuf;

/**
 * Change le plateau des nouvelles parties, et le vise. Sert aux tests écrits pour le plateau de 16 cases ;
 * l'appli garde 18.
 */
export function plateauParDefaut(cote) {
  coteNeuf = coteValide(cote);
  return viserPlateau(coteNeuf);
}

/**
 * Réglages à garder avec l'historique d'une partie pour la rejouer (rejouerPartie) : ceux de l'état,
 * et son plateau. Sans `plateau`, une partie enregistrée date d'avant le plateau de 18 cases.
 */
export const reglagesRejeu = (etat) => ({ ...(etat && etat.reglages), plateau: coteDeEtat(etat) });

/** Nombre de cases du circuit du plateau visé : 72 à 4 joueurs, 54 à 3 (64 et 48 sur l'ancien). */
export const nbCases = (nbJoueurs = 4) => COTE * nbJoueurs;
/** Nombre total de pions : 16 à 4 joueurs, 12 à 3. */
export const nbPions = (nbJoueurs = 4) => PIONS_PAR_JOUEUR * nbJoueurs;

export const caseDepart = (siege) => siege * COTE;
export const caseEntree = (siege, nbJoueurs = 4) =>
  (siege * COTE - DISTANCE_ENTREE + nbCases(nbJoueurs)) % nbCases(nbJoueurs);
export const proprietaire = (pion) => pion >> 2;
/** Partenaire du siège (face à face) ; null à 3 joueurs (chacun pour soi). */
export const partenaire = (siege, nbJoueurs = 4) => (nbJoueurs === 3 ? null : (siege + 2) % 4);
/** Camp du siège : équipe 0 ou 1 à 4 joueurs ; à 3, chaque siège est son propre camp. */
export const equipe = (siege, nbJoueurs = 4) => (nbJoueurs === 3 ? siege : siege % 2);
export const pionsDe = (siege) => [siege * 4, siege * 4 + 1, siege * 4 + 2, siege * 4 + 3];
/** Siège qui joue après `siege`. */
export const siegeSuivant = (siege, nbJoueurs = 4) => (siege + 1) % nbJoueurs;

/**
 * Destinataire de la carte donnée par `siege` en début de la donne `donne` :
 * le partenaire à 4 joueurs ; à 3, le voisin de gauche (siège suivant) les donnes paires,
 * le voisin de droite (siège précédent) les donnes impaires.
 */
export function destinataireDon(donne, siege, nbJoueurs = 4) {
  if (nbJoueurs !== 3) return (siege + 2) % 4;
  return donne % 2 === 0 ? (siege + 1) % 3 : (siege + 2) % 3;
}

/** Siège dont `siege` reçoit une carte en début de la donne `donne` (inverse de destinataireDon). */
export function donneurDon(donne, siege, nbJoueurs = 4) {
  if (nbJoueurs !== 3) return (siege + 2) % 4;
  return donne % 2 === 0 ? (siege + 2) % 3 : (siege + 1) % 3;
}

export const estBase = (pos) => pos === BASE;
export const estCircuit = (pos, nbJoueurs = 4) => pos >= 0 && pos < nbCases(nbJoueurs);
export const estAllee = (pos) => pos >= ALLEE;
export const rangAllee = (pos) => pos - ALLEE;
