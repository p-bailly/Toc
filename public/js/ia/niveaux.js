// Niveaux de force de l'IA : Débutant, Amateur, Confirmé, Expert, Champion.
//
// Tous les niveaux choisissent parmi les mêmes coups légaux (moteur rapide, revalidés par le
// vrai moteur dans ia.js) ; seul le choix change :
//  - débutant : regarde seulement l'avancement de ses pions, les sorties, les rentrées et les
//    captures « sous son nez » ; ne voit aucun danger, ne pense pas à ses cartes ni au
//    remplissage de l'allée ; hésite beaucoup (bruit sur les notes) ;
//  - amateur : voit les captures et les menaces immédiates (en partie), garde un peu ses as,
//    mais remplit mal l'allée et se trompe souvent ;
//  - confirmé : évaluation statique complète de l'IA, avec un peu d'imprécision ;
//  - expert : évaluation complète plus une courte recherche par simulations ;
//  - champion : l'IA complète (recherche par simulations sur tout le budget).
// Le bruit est tiré avec options.rng : à rng fixé, le choix est reproductible.
// Les conseils et l'analyse utilisent toujours le niveau maximal (ils n'appellent pas ce fichier).

import { POIDS_DEFAUT } from './evaluation.js';

export const NIVEAUX = [
  { id: 'debutant', nom: 'Débutant', description: 'Il avance ses pions et capture ce qui passe à sa portée, sans voir le danger ni préparer la suite.' },
  { id: 'amateur', nom: 'Amateur', description: 'Il voit les captures et les menaces immédiates, mais gère mal ses cartes et son allée.' },
  { id: 'confirme', nom: 'Confirmé', description: 'Il pèse bien chaque coup (risques, cartes gardées, allée), avec quelques imprécisions.' },
  { id: 'expert', nom: 'Expert', description: 'Il évalue tout et anticipe un peu la suite de la donne.' },
  { id: 'champion', nom: 'Champion', description: 'Il simule de nombreuses fins de donne avant chaque coup : sa meilleure force.' },
];

export const NIVEAU_DEFAUT = 'champion';

/**
 * Profils de jeu. `poids` : réglages de l'évaluation (sur la base de POIDS_DEFAUT) ;
 * `bruit` : écart type (en cases) ajouté à la note de chaque coup ; `recherche` : null (choix
 * statique) ou { iterations, budgetMax, candidatsMax, ecartStatique } (seuls les coups à moins de
 * ecartStatique cases du meilleur selon l'évaluation statique sont départagés) ; `don` : 'simple' ou 'complet'.
 */
export const PROFILS = {
  debutant: {
    poids: {
      ...POIDS_DEFAUT,
      risque: 0, menaceValet: 0, bloque: 0, trou: 0, approche: 0,
      sortieUtile: 0, sortieSup: 0, asInutile: 0, roiInutile: 0, sept: 0, quatreManoeuvre: 0,
      quatre: 0, valet: 0, petiteAllee: 0, joker: 0, offreJoker: 0,
    },
    bruit: 10,
    recherche: null,
    don: 'simple',
  },
  amateur: {
    poids: {
      ...POIDS_DEFAUT,
      risque: 0.5, beta: 0, menaceValet: 0, bloque: 0, trou: 1.5,
      sortieUtile: 6, sortieSup: 2, asInutile: 1, roiInutile: 0, sept: 1, quatreManoeuvre: 3,
      quatre: 0, valet: 1, petiteAllee: 0, joker: 4, offreJoker: 0,
    },
    bruit: 4,
    recherche: null,
    don: 'simple',
  },
  confirme: { poids: POIDS_DEFAUT, bruit: 6, recherche: null, don: 'complet' },
  expert: { poids: POIDS_DEFAUT, bruit: 0, recherche: { iterations: 4, budgetMax: 60, candidatsMax: 3, ecartStatique: 12 }, don: 'complet' },
  champion: null,
};

/** Profil d'un niveau (null pour le champion, niveau absent ou inconnu). */
export function profilNiveau(niveau) {
  return (niveau && PROFILS[niveau]) || null;
}

/** Tirage gaussien (Box-Muller) avec le générateur fourni. */
export function gaussien(rng) {
  let u = rng();
  if (u < 1e-12) u = 1e-12;
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

/** Don « simple » des niveaux faibles : garde as, rois, jokers et 7 ; donne la plus petite carte. */
const ORDRE_DON_SIMPLE = ['2', '3', '5', '6', '8', '9', '10', 'D', '4', 'V', '7', 'R', 'A', 'J'];
export function donSimple(main) {
  return main.slice().sort((a, b) => ORDRE_DON_SIMPLE.indexOf(a.slice(0, -1)) - ORDRE_DON_SIMPLE.indexOf(b.slice(0, -1)))[0];
}
