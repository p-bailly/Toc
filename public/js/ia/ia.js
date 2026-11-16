// Intelligence artificielle du Toc, pour le jeu à 4 (deux équipes) comme pour le jeu à 3
// (chacun pour soi, jokers) : le mode est lu dans l'état (nombreJoueurs), les appelants n'ont
// rien à distinguer.
// L'IA ne connaît que l'état public, sa propre main et la carte qu'elle a donnée (à son
// partenaire à 4, à son voisin à 3) : elle ne triche pas. Elle compte les cartes : celles
// qu'elle n'a pas vues (ni dans la pile, ni dans sa main, ni données) sont dans les mains des
// autres ou dans les donnes suivantes du cycle (52 cartes et 3 donnes à 4 ; 54 cartes et
// 4 donnes à 3).
//
// Architecture (voir les fichiers du dossier) :
//   simulation.js  moteur de règles rapide (génération des coups avec le plateau obtenu)
//   evaluation.js  évaluation d'une position (progression, allée, risques, blocages, main)
//   recherche.js   évaluation statique de chaque coup puis simulations déterminisées
//                  de la fin de la donne, dans la limite du budget de temps
//   etude.js     analyse incrémentale (« anytime ») : candidats, évaluation, probabilité
//                  de victoire ; utilisée par choisirCoup et par les conseils
//   conseils.js    notes du don et raisons (phrases) expliquant chaque choix
//   ia.js          contrat public : choisirDon, choisirCoup, conseillerDon, conseillerCoup,
//                  creerAnalyse, creerAnalyseDon

import { coupsLegauxMain, validerCoup } from '../moteur/index.js';
import { maintenant } from './recherche.js';
import { noterDons } from './conseils.js';
import { AnalyseCoup, AnalyseDon } from './etude.js';
import { NIVEAUX, NIVEAU_DEFAUT, profilNiveau, gaussien, donSimple } from './niveaux.js';

// Niveaux de force (voir niveaux.js) : options.niveau = 'debutant' | 'amateur' | 'confirme' |
// 'expert' | 'champion' ; absent ou inconnu = 'champion' (comportement complet).
export { NIVEAUX, NIVEAU_DEFAUT };

/**
 * Choisit la carte à donner en début de donne (voir conseils.js, noterDons).
 * À 4 : gain qu'en tirerait le partenaire (meilleur coup avec cette carte sur le plateau actuel,
 * sortie surtout s'il a des pions en base) moins la perte pour soi (atténuée si l'on garde une
 * autre carte du même rang). À 3 : le voisin est un adversaire ; on donne la carte qui coûte le
 * moins à soi et rapporte le moins au voisin (jamais un joker sauf contrainte).
 * @param {Object} etat    état public (phase 'echange')
 * @param {number} siege   siège de l'IA
 * @param {string[]} main  main de l'IA
 * @param {Object} [options] { rng }
 * @returns {string} carte à donner
 */
export function choisirDon(etat, siege, main, options = {}) {
  if (main.length <= 1) return main[0];
  const profil = profilNiveau(options.niveau);
  if (profil && profil.don === 'simple') return donSimple(main);
  try {
    return noterDons(etat, siege, main, options)[0].carte;
  } catch (e) {
    return main[0];
  }
}

/**
 * Choisit le coup à jouer.
 * @param {Object} etat    état public (phase 'jeu', etat.tour === siege)
 * @param {number} siege   siège de l'IA
 * @param {string[]} main  main de l'IA
 * @param {Object} [options] { rng, budgetMs, carteDonnee, carteRecue, iterations }
 *   Avec `rng` et `iterations` fixés (et un budget suffisant), le choix est reproductible.
 * @returns {Object} coup légal (voir regles.js)
 */
export function choisirCoup(etat, siege, main, options = {}) {
  const profil = profilNiveau(options.niveau);
  if (profil) return choisirCoupNiveau(etat, siege, main, options, profil);
  const debut = maintenant();
  const budget = options.budgetMs ?? 600;
  let coup = null;
  try {
    const analyse = new AnalyseCoup(etat, siege, main, options);
    if (analyse.candidats.length > 1 && analyse.actifs.length > 1) {
      // marge pour la validation finale et les imprévus
      analyse.progresser(debut + budget * 0.92 - 1 - maintenant(), true);
    }
    coup = analyse.meilleurCoup();
  } catch (e) {
    coup = null;
  }
  if (coup && validerCoup(etat, siege, coup, main) === null) return coup;
  // Repli (ne devrait jamais servir) : premier coup légal du vrai moteur.
  return coupsLegauxMain(etat, siege, main)[0];
}

/** Coup d'un niveau inférieur au champion (voir niveaux.js). */
function choisirCoupNiveau(etat, siege, main, options, profil) {
  const debut = maintenant();
  const rng = options.rng || Math.random;
  let coup = null;
  try {
    const r = profil.recherche;
    const analyse = new AnalyseCoup(etat, siege, main, {
      ...options,
      poids: profil.poids,
      ...(r ? { iterations: Math.min(options.iterations ?? Infinity, r.iterations), candidatsMax: r.candidatsMax, ecartStatique: r.ecartStatique } : {}),
    });
    if (r) {
      if (analyse.candidats.length > 1 && analyse.actifs.length > 1) {
        const budget = Math.min(options.budgetMs ?? 600, r.budgetMax);
        analyse.progresser(debut + budget * 0.92 - 1 - maintenant(), true);
      }
      coup = analyse.meilleurCoup();
    } else {
      // Choix statique bruité : note de chaque coup + erreur d'appréciation (en cases).
      let best = -Infinity;
      for (const c of analyse.candidats) {
        const v = c.statique + (profil.bruit ? profil.bruit * gaussien(rng) : 0);
        if (v > best) {
          best = v;
          coup = c.res.coup;
        }
      }
    }
  } catch (e) {
    coup = null;
  }
  if (coup && validerCoup(etat, siege, coup, main) === null) return coup;
  return coupsLegauxMain(etat, siege, main)[0];
}

// ---------------------------------------------------------------------------
// Conseils et analyse (pour le joueur humain)
// ---------------------------------------------------------------------------

/**
 * Conseil de coup : au plus options.max entrées (3 par défaut), plateaux finaux distincts,
 * de la meilleure à la moins bonne : [{ coup, note, ecart, marge, raisons, joue? }].
 * La première est le coup que choisirCoup jouerait avec le même budget et le même rng.
 * Avec options.coupJoue, l'entrée de ce coup est ajoutée (joue: true).
 */
export function conseillerCoup(etat, siege, main, options = {}) {
  const debut = maintenant();
  const budget = options.budgetMs ?? 600;
  const analyse = new AnalyseCoup(etat, siege, main, { ...options, max: options.max ?? 3 });
  if (analyse.candidats.length > 1 && (analyse.actifs.length > 1 || analyse.joue)) {
    analyse.progresser(debut + budget * 0.92 - 1 - maintenant());
  }
  return analyse.resultat().candidats;
}

/**
 * Conseil de don : une entrée par rang distinct de la main, de la meilleure à la moins bonne :
 * [{ carte, note, ecart, marge, raisons, joue? }]. Sans budget (défaut 0), c'est l'évaluation
 * statique, identique au choix de choisirDon ; avec options.budgetMs, des simulations de la
 * donne affinent le classement.
 */
export function conseillerDon(etat, siege, main, options = {}) {
  const analyse = new AnalyseDon(etat, siege, main, { ...options, max: options.max ?? main.length });
  return analyse.avancer(options.budgetMs ?? 0).candidats;
}

/**
 * Analyse incrémentale d'un coup (phase 'jeu') : objet avec avancer(budgetMs) et resultat()
 * → { iterations, evaluation, probaVictoire, marge, candidats, stable }. Voir etude.js.
 * options : { rng, carteDonnee, carteRecue, coupJoue, max = 5 }
 */
export function creerAnalyse(etat, siege, main, options = {}) {
  return new AnalyseCoup(etat, siege, main, options);
}

/**
 * Analyse incrémentale du don au partenaire (phase 'echange') : même objet, candidats
 * [{ carte, note, ecart, marge, raisons, joue? }]. options : { rng, carteJouee, max = 5 }
 */
export function creerAnalyseDon(etat, siege, main, options = {}) {
  return new AnalyseDon(etat, siege, main, options);
}
