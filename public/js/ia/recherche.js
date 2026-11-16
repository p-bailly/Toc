// Recherche du meilleur coup : évaluation statique + simulations déterminisées.
//
// 1. Tous les coups légaux de la main sont générés (moteur rapide) et évalués statiquement
//    (évaluation de la position + valeur des cartes gardées) : c'est déjà un bon joueur,
//    utilisé tel quel quand le budget est minuscule.
// 2. Les meilleurs candidats sont ensuite départagés par des simulations : à chaque itération,
//    on tire au hasard les mains cachées parmi les cartes non vues (en tenant compte de la carte
//    donnée au partenaire), puis on joue le reste de la donne pour chaque candidat avec la
//    même distribution (variables aléatoires communes), chaque joueur choisissant le coup
//    qui maximise l'évaluation statique pour son équipe. La position de fin de donne est
//    évaluée. On s'arrête quand le budget de temps est épuisé (recherche « anytime »).

import { paquetNeuf, tailleDonne } from '../moteur/cartes.js';
import { coupsMain, indexRang, finiPions, equipeGagnantePions } from './simulation.js';
import { creerContexte, evaluerPlateau, valeurMain, POIDS_DEFAUT } from './evaluation.js';

const maintenant =
  typeof globalThis.performance !== 'undefined' && globalThis.performance.now
    ? () => globalThis.performance.now()
    : () => Date.now();

const PAQUET = paquetNeuf();

/** Cartes non vues par le siège : ni jouées (pile), ni en main, ni données au partenaire. */
export function cartesNonVues(etat, main, carteDonnee) {
  const vues = new Set(etat.pile);
  for (const c of main) vues.add(c);
  if (carteDonnee) vues.add(carteDonnee);
  return PAQUET.filter((c) => !vues.has(c));
}

export function comptesRangs(cartes) {
  const t = new Array(13).fill(0);
  for (const c of cartes) t[indexRang(c)]++;
  return t;
}

function masqueRangs(cartes) {
  let m = 0;
  for (const c of cartes) m |= 1 << indexRang(c);
  return m;
}

/** Retire une carte du rang ir d'une main (copie). */
function retirerRang(main, ir) {
  const i = main.findIndex((c) => indexRang(c) === ir);
  const m = main.slice();
  m.splice(i, 1);
  return m;
}

/**
 * Prépare tout ce qui est commun à l'analyse d'une position pour `siege`.
 */
export function preparer(etat, siege, main, options = {}) {
  const poids = options.poids || POIDS_DEFAUT;
  const donneeEnMain = options.carteDonnee && !etat.pile.includes(options.carteDonnee) ? options.carteDonnee : null;
  const nonVues = cartesNonVues(etat, main, options.carteDonnee);
  const ctx = creerContexte(comptesRangs(nonVues), poids);
  return { etat, siege, main, poids, ctx, nonVues, donneeEnMain, cinq: !!etat.reglages.cinqAdverse };
}

/**
 * Informations sur les mains utilisées par l'évaluation, après un coup de `joueur`.
 * @param n         cartes en main par siège (après le coup)
 * @param joueur    siège dont la main est connue (ou -1)
 * @param mainJ     sa main
 * @param donnee    carte connue dans la main du partenaire de `joueur` (ou null)
 */
function infoMains(n, joueur, mainJ, donnee) {
  const connu = [0, 0, 0, 0];
  const nConnu = [0, 0, 0, 0];
  if (joueur >= 0) {
    connu[joueur] = masqueRangs(mainJ);
    nConnu[joueur] = mainJ.length;
    if (donnee) {
      const p = (joueur + 2) & 3;
      connu[p] = 1 << indexRang(donnee);
      nConnu[p] = 1;
    }
  }
  return { n, connu, nConnu };
}

/**
 * Évaluation statique d'un coup candidat (résultat de coupsMain) pour le siège qui le joue.
 * @param restes  cartes restantes par siège AVANT le coup
 */
export function evaluerCandidat(prep, siege, cand, mainApres, restes, donnee, donne) {
  const n = restes.slice();
  n[siege]--;
  const equipe = siege & 1;
  if (n.every((k) => k === 0)) {
    // Fin de donne : chacun recevra une nouvelle main.
    const t = tailleDonne(donne + 1);
    const info = infoMains([t, t, t, t], -1, null, null);
    return evaluerPlateau(cand.pions, equipe, (donne + 1) & 3, info, prep.ctx);
  }
  const info = infoMains(n, siege, mainApres, donnee);
  return (
    evaluerPlateau(cand.pions, equipe, (siege + 1) & 3, info, prep.ctx) +
    valeurMain(comptesRangs(mainApres), cand.pions, siege, prep.poids)
  );
}

/** Coup glouton (évaluation statique) d'un joueur dans une simulation. */
function coupGlouton(prep, pions, joueur, main, restes, donne) {
  const coups = coupsMain(pions, joueur, main, prep.cinq, 40);
  if (coups.length === 1) return coups[0];
  let meilleur = null;
  let best = -Infinity;
  for (const c of coups) {
    const v = evaluerCandidat(prep, joueur, c, retirerRang(main, c.ir), restes, null, donne);
    if (v > best) {
      best = v;
      meilleur = c;
    }
  }
  return meilleur;
}

function melangerAvec(t, rng) {
  for (let i = t.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const x = t[i];
    t[i] = t[j];
    t[j] = x;
  }
  return t;
}

/** Tire les mains cachées des trois autres joueurs. */
function tirerMains(prep, rng) {
  const { etat, siege, donneeEnMain } = prep;
  const pool = melangerAvec(prep.nonVues.slice(), rng);
  const mains = [null, null, null, null];
  let k = 0;
  for (let j = 0; j < 4; j++) {
    if (j === siege) continue;
    const n = etat.cartesRestantes[j];
    const m = [];
    if (j === ((siege + 2) & 3) && donneeEnMain && n > 0) m.push(donneeEnMain);
    while (m.length < n && k < pool.length) m.push(pool[k++]);
    mains[j] = m;
  }
  return mains;
}

/**
 * Simule la fin de la donne après le coup candidat et renvoie l'évaluation finale
 * pour l'équipe du siège.
 */
function simuler(prep, cand, mainApres, mainsAutres, profondeurMax) {
  const { etat, siege } = prep;
  const equipe = siege & 1;
  let pions = cand.pions;
  const mains = mainsAutres.slice();
  mains[siege] = mainApres;
  const restes = etat.cartesRestantes.slice();
  restes[siege]--;
  let joueur = (siege + 1) & 3;
  let plis = 0;
  while (plis < profondeurMax) {
    const g = equipeGagnantePions(pions);
    if (g >= 0) return g === equipe ? prep.poids.victoire : -prep.poids.victoire;
    if (restes.every((k) => k === 0)) break;
    if (restes[joueur] > 0) {
      const c = coupGlouton(prep, pions, joueur, mains[joueur], restes, etat.donne);
      pions = c.pions;
      mains[joueur] = retirerRang(mains[joueur], c.ir);
      restes[joueur]--;
      plis++;
    }
    joueur = (joueur + 1) & 3;
  }
  const g = equipeGagnantePions(pions);
  if (g >= 0) return g === equipe ? prep.poids.victoire : -prep.poids.victoire;
  if (restes.every((k) => k === 0)) {
    const t = tailleDonne(etat.donne + 1);
    return evaluerPlateau(pions, equipe, (etat.donne + 1) & 3, infoMains([t, t, t, t], -1, null, null), prep.ctx);
  }
  const info = infoMains(restes, siege, mains[siege], null);
  return evaluerPlateau(pions, equipe, joueur, info, prep.ctx) + valeurMain(comptesRangs(mains[siege]), pions, siege, prep.poids);
}

/**
 * Analyse complète : renvoie { coup, candidats, iterations }.
 * options : { rng, budgetMs, carteDonnee, poids, iterations (max), candidatsMax, profondeur }
 */
export function analyser(etat, siege, main, options = {}) {
  const debut = maintenant();
  const budget = options.budgetMs ?? 600;
  // marge pour la validation finale et les imprévus
  const limite = debut + Math.max(0, budget * 0.92 - 1);
  const rng = options.rng || Math.random;
  const prep = preparer(etat, siege, main, options);

  const coups = coupsMain(etat.pions, siege, main, prep.cinq);
  const candidats = coups.map((c) => {
    const mainApres = retirerRang(main, c.ir);
    return {
      res: c,
      mainApres,
      statique: evaluerCandidat(prep, siege, c, mainApres, etat.cartesRestantes, prep.donneeEnMain, etat.donne),
      somme: 0,
      n: 0,
    };
  });
  candidats.sort((a, b) => b.statique - a.statique);
  let iterations = 0;
  const maxIter = options.iterations ?? Infinity;
  if (candidats.length > 1 && maxIter > 0 && maintenant() < limite) {
    // Candidats retenus pour les simulations
    const kMax = options.candidatsMax ?? 8;
    const marge = 40;
    const retenus = candidats.filter((c, i) => i < kMax && c.statique >= candidats[0].statique - marge);
    if (retenus.length > 1) {
      const prof = options.profondeur ?? Infinity;
      const elagage = options.elagage ?? true;
      for (const c of retenus) c.valeurs = [];
      let actifs = retenus.slice();
      while (iterations < maxIter && maintenant() < limite) {
        const mains = tirerMains(prep, rng);
        let complet = true;
        for (const c of actifs) {
          if (maintenant() >= limite) {
            complet = false;
            break;
          }
          c.tmp = simuler(prep, c.res, c.mainApres, mains, prof);
        }
        if (!complet) break; // itération incomplète : on l'ignore (comparaison équitable)
        for (const c of actifs) {
          c.somme += c.tmp;
          c.n++;
          c.valeurs.push(c.tmp);
        }
        iterations++;
        // Élagage : on abandonne les candidats nettement moins bons que le meilleur
        // (différences appariées, mêmes tirages), pour concentrer le temps sur les autres.
        if (elagage && actifs.length > 2 && iterations >= 6 && (iterations & 1) === 0) {
          let meilleur = actifs[0];
          for (const c of actifs) if (c.somme > meilleur.somme) meilleur = c;
          const debutComp = meilleur.valeurs.length - iterations;
          actifs = actifs.filter((c) => {
            if (c === meilleur) return true;
            const k = iterations;
            const o = c.valeurs.length - k;
            let m = 0;
            let m2 = 0;
            for (let i = 0; i < k; i++) {
              const d = meilleur.valeurs[debutComp + i] - c.valeurs[o + i];
              m += d;
              m2 += d * d;
            }
            m /= k;
            const se = Math.sqrt(Math.max(0, m2 / k - m * m) / k);
            return m <= 2.5 * se + 0.5;
          });
          if (actifs.length === 1) break;
        }
      }
      if (iterations > 0) {
        // Score : moyenne sur les tirages communs aux candidats encore en lice
        for (const c of retenus) c.score = c.somme / Math.max(1, c.n);
        const enLice = new Set(actifs);
        retenus.sort((a, b) => (enLice.has(b) - enLice.has(a)) || b.score - a.score);
        return { coup: retenus[0].res.coup, candidats, retenus, iterations, duree: maintenant() - debut };
      }
    }
  }
  return { coup: candidats[0].res.coup, candidats, iterations, duree: maintenant() - debut };
}

export { finiPions };
