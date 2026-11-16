// Modèle du plateau de Toc.
//
// Circuit principal : 64 cases numérotées de 0 à 63, parcourues dans l'ordre croissant.
// Quatre sièges (0 à 3) ; les partenaires sont face à face : 0 et 2 contre 1 et 3.
// La case de départ du siège s est la case 16 × s (au milieu d'un côté du plateau carré).
// L'allée d'arrivée d'un joueur s'ouvre sur sa case de départ : depuis celle-ci,
// la k-ième case de l'allée (k = 0 à 3) est à k + 1 pas.
//
// Position d'un pion :
//   BASE (-1)        : pion non sorti
//   0 … 63           : case du circuit
//   ALLEE + k (100+k): k-ième case de l'allée d'arrivée de son propriétaire (3 = fond)
//
// Les 16 pions sont numérotés de 0 à 15 : le pion g appartient au siège g >> 2.

export const NB_CASES = 64;
export const NB_SIEGES = 4;
export const PIONS_PAR_JOUEUR = 4;
export const NB_PIONS = 16;
export const BASE = -1;
export const ALLEE = 100;
export const LONGUEUR_ALLEE = 4;

export const caseDepart = (siege) => siege * 16;
export const proprietaire = (pion) => pion >> 2;
export const partenaire = (siege) => (siege + 2) % 4;
export const equipe = (siege) => siege % 2;
export const pionsDe = (siege) => [siege * 4, siege * 4 + 1, siege * 4 + 2, siege * 4 + 3];

export const estBase = (pos) => pos === BASE;
export const estCircuit = (pos) => pos >= 0 && pos < NB_CASES;
export const estAllee = (pos) => pos >= ALLEE;
export const rangAllee = (pos) => pos - ALLEE;
