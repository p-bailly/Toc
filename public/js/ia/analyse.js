// Analyse incrémentale (« anytime ») d'une position : quel coup jouer, ou quelle carte donner.
//
// Une analyse commence par l'évaluation statique de tous les candidats (résultat utilisable
// immédiatement), puis chaque appel à avancer(budgetMs) ajoute des simulations :
//   - une itération = un tirage des mains cachées parmi les cartes non vues, puis, pour chaque
//     candidat encore en lice, la simulation du reste de la donne avec ce tirage (variables
//     aléatoires communes : les écarts entre candidats sont mesurés sur les mêmes tirages) ;
//   - les candidats nettement moins bons que le meilleur (écart apparié > 2,5 erreurs types)
//     sont abandonnés ; le coup réellement joué (options.coupJoue) n'est jamais abandonné ;
//   - une itération interrompue par la fin du budget reprend à l'appel suivant : découper le
//     temps en petites tranches donne exactement le même résultat qu'une grande tranche
//     (à nombre d'itérations égal), et le résultat est reproductible avec options.rng.
//
// Probabilité de victoire : chaque simulation se termine sur une position de fin de donne
// (ou sur une victoire). Sa valeur est convertie en probabilité par une courbe logistique
// calibrée sur des parties de l'IA contre elle-même (voir probaDepuisEvaluation), puis
// moyennée sur les simulations du meilleur candidat.

import { apercuCoup } from '../moteur/index.js';
import { evaluerPlateau } from './evaluation.js';
import { coupsMain, indexRang, clePions } from './simulation.js';
import {
  preparer, evaluerCandidat, tirerMains, simuler, jouerDonne, retirerRang, maintenant, travailRestant, melangerAvec,
} from './recherche.js';
import { noterDons, raisonsCoup, raisonsDon } from './conseils.js';

const PLAFOND_ITERATIONS = 3000;
const MARGE_STATIQUE = 25; // incertitude conventionnelle d'une note purement statique (cases)
const CANDIDATS_MAX = 8;
const ECART_STATIQUE_MAX = 40;

/**
 * Probabilité de victoire de l'équipe à partir de l'évaluation `v` (en cases, pour cette équipe)
 * d'une position de fin de donne. Logistique en v / √(travail restant des 16 pions) :
 * le même avantage pèse davantage quand il reste peu à faire. Coefficient ajusté par maximum
 * de vraisemblance sur des positions de parties IA contre IA (outils/calibrage.js).
 */
export const CALIBRAGE = { k: 0.127 };

export function probaDepuisEvaluation(v, pions, victoire) {
  if (v >= victoire) return 1;
  if (v <= -victoire) return 0;
  const z = (CALIBRAGE.k * v) / Math.sqrt(Math.max(40, travailRestant(pions)));
  return 1 / (1 + Math.exp(-z));
}

/** Tableau de flottants extensible (valeurs successives d'un candidat). */
function ajouter(c, x) {
  if (!c.valeurs) c.valeurs = new Float32Array(16);
  if (c.n >= c.valeurs.length) {
    const t = new Float32Array(c.valeurs.length * 2);
    t.set(c.valeurs);
    c.valeurs = t;
  }
  c.valeurs[c.n] = x;
  c.n++;
  c.somme += x;
  c.somme2 += x * x;
}

const moyenne = (c) => c.somme / c.n;
function erreurType(c) {
  if (c.n < 2) return MARGE_STATIQUE;
  const m = c.somme / c.n;
  const varEchantillon = Math.max(0, (c.somme2 - c.n * m * m) / (c.n - 1));
  return Math.sqrt(varEchantillon / c.n);
}

/** Écart apparié (moyenne et erreur type) de b par rapport à a sur leurs k premiers tirages. */
function ecartApparie(a, b, k) {
  let m = 0;
  let m2 = 0;
  for (let i = 0; i < k; i++) {
    const d = a.valeurs[i] - b.valeurs[i];
    m += d;
    m2 += d * d;
  }
  m /= k;
  const se = k > 1 ? Math.sqrt(Math.max(0, (m2 - k * m * m) / (k - 1)) / k) : MARGE_STATIQUE;
  return { m, se };
}

/**
 * Mécanique commune aux deux analyses. Les sous-classes fournissent :
 *   this.candidats (triés par note statique décroissante, chacun avec .statique),
 *   this.actifs (candidats simulés), this.joue (candidat joué ou null),
 *   tirage() → données communes d'une itération ; simulerCandidat(c, tirage) → { v, p }.
 */
class AnalyseBase {
  init(options) {
    this.rng = options.rng || Math.random;
    this.max = options.max ?? 5;
    this.iterMax = Math.min(options.iterations ?? PLAFOND_ITERATIONS, PLAFOND_ITERATIONS);
    this.iterations = 0;
    this.encours = null;
    for (const c of this.candidats) {
      c.n = 0;
      c.somme = 0;
      c.somme2 = 0;
      c.sommeP = 0;
      c.valeurs = null;
      c.elimine = false;
    }
  }

  /** Poursuit la recherche pendant au plus budgetMs (cumulatif) ; renvoie le résultat courant. */
  avancer(budgetMs = 0) {
    this.progresser(budgetMs);
    return this.resultat();
  }

  /** Comme avancer, sans construire le résultat (utilisé par choisirCoup). */
  progresser(budgetMs = 0) {
    const limite = maintenant() + Math.max(0, budgetMs);
    while (this.iterations < this.iterMax && this.actifs.length > 0) {
      if (maintenant() >= limite) break;
      if (!this.encours) this.encours = { tirage: this.tirage(), i: 0, res: [] };
      const e = this.encours;
      let fini = true;
      while (e.i < this.actifs.length) {
        if (e.i > 0 && maintenant() >= limite) {
          fini = false;
          break;
        }
        e.res.push(this.simulerCandidat(this.actifs[e.i], e.tirage));
        e.i++;
      }
      if (!fini) break;
      for (let i = 0; i < this.actifs.length; i++) {
        const c = this.actifs[i];
        ajouter(c, e.res[i].v);
        c.sommeP += e.res[i].p;
      }
      this.iterations++;
      this.encours = null;
      this.elaguer();
    }
    this.cache = null;
  }

  meilleurActif() {
    let b = this.actifs[0];
    for (const c of this.actifs) if (c.somme > b.somme) b = c;
    return b;
  }

  elaguer() {
    const k = this.iterations;
    if (k < 6 || k % 2 || this.actifs.length <= 1) return;
    const b = this.meilleurActif();
    this.actifs = this.actifs.filter((c) => {
      if (c === b || c === this.joue) return true;
      const { m, se } = ecartApparie(b, c, k);
      if (m > 2.5 * se + 0.5) {
        c.elimine = true;
        return false;
      }
      return true;
    });
  }

  /** Candidats classés avec note, écart et marge (sans les raisons). */
  classement() {
    if (this.cache) return this.cache;
    let liste;
    if (this.iterations === 0) {
      liste = this.candidats.map((c) => ({ c, note: c.statique, marge: MARGE_STATIQUE }));
    } else {
      const b = this.meilleurActif();
      const mb = moyenne(b);
      const simules = this.candidats.filter((c) => c.n > 0);
      const notes = simules.map((c) => {
        if (c === b) return { c, note: mb, marge: erreurType(c) };
        const { m, se } = ecartApparie(b, c, c.n);
        return { c, note: mb - m, marge: Math.max(erreurType(c), se) };
      });
      // actifs d'abord (même nombre de tirages), puis les candidats abandonnés
      notes.sort((x, y) => (x.c.elimine - y.c.elimine) || y.note - x.note);
      const plancher = Math.min(...notes.map((x) => x.note));
      const decal = mb - b.statique;
      const autres = this.candidats
        .filter((c) => c.n === 0)
        .map((c) => ({ c, note: Math.min(c.statique + decal, plancher - 0.1), marge: MARGE_STATIQUE }));
      liste = notes.concat(autres);
    }
    if (this.iterations === 0) liste.sort((x, y) => y.note - x.note);
    this.cache = liste;
    return liste;
  }

  /** Le meilleur candidat (celui que l'IA jouerait). */
  meilleur() {
    return this.classement()[0].c;
  }

  /**
   * Poursuivre apporte-t-il encore quelque chose ? Non si le meilleur candidat est séparé de
   * chacun des autres au-delà du bruit (ou en est indiscernable à moins d'une case près),
   * ou si le plafond d'itérations est atteint.
   */
  stable() {
    if (this.candidats.length === 1) return this.iterations >= Math.min(200, this.iterMax);
    if (this.iterations >= this.iterMax) return true;
    if (this.iterations < 12) return false;
    const l = this.classement();
    const b = l[0].c;
    // le meilleur est-il séparé de tous les autres candidats encore en lice ?
    for (const c of this.actifs) {
      if (c === b) continue;
      const { m, se } = ecartApparie(b, c, this.iterations);
      // ni séparé du meilleur, ni départagé à moins d'une case près : on continue
      if (m <= 2.5 * se + 0.5 && se >= 1) return false;
    }
    return true;
  }

  resultatCommun(fabriquer, distinct) {
    const l = this.classement();
    const tete = l[0];
    const vus = new Set();
    const choisis = [];
    for (const x of l) {
      if (choisis.length >= this.max) break;
      const k = distinct(x.c);
      if (vus.has(k)) continue;
      vus.add(k);
      choisis.push(x);
    }
    if (this.joue) {
      const x = l.find((y) => y.c === this.joue);
      if (x && !choisis.includes(x)) choisis.push(x);
    }
    const b = tete.c;
    const proba = this.iterations > 0 ? b.sommeP / b.n : this.probaStatique(b);
    return {
      iterations: this.iterations,
      evaluation: Math.round(tete.note * 10) / 10,
      probaVictoire: Math.round(proba * 1000) / 1000,
      marge: Math.round(tete.marge * 10) / 10,
      candidats: choisis.map((x) => ({
        ...fabriquer(x.c),
        note: Math.round(x.note * 10) / 10,
        ecart: Math.round(Math.max(0, tete.note - x.note) * 10) / 10,
        marge: Math.round(x.marge * 10) / 10,
        ...(x.c === this.joue ? { joue: true } : {}),
      })),
      stable: this.stable(),
    };
  }
}

// ---------------------------------------------------------------------------
// Analyse d'un coup
// ---------------------------------------------------------------------------

export class AnalyseCoup extends AnalyseBase {
  constructor(etat, siege, main, options = {}) {
    super();
    this.etat = etat;
    this.siege = siege;
    this.main = main.slice();
    this.prep = preparer(etat, siege, main, options);
    const coups = coupsMain(etat.pions, siege, main, this.prep.cinq);
    this.candidats = coups.map((res) => {
      const mainApres = retirerRang(main, res.ir);
      return {
        res,
        mainApres,
        statique: evaluerCandidat(this.prep, siege, res, mainApres, etat.cartesRestantes, this.prep.donneeEnMain, etat.donne),
      };
    });
    this.candidats.sort((a, b) => b.statique - a.statique);
    this.init(options);
    this.profondeur = options.profondeur ?? Infinity;
    // coup joué
    this.joue = null;
    this.coupJoue = options.coupJoue || null;
    if (this.coupJoue) {
      const cj = this.coupJoue;
      const ir = indexRang(cj.carte);
      let cle = null;
      if (cj.t === 'defausse') cle = 'd';
      else {
        const ap = apercuCoup(etat, siege, cj);
        if (ap) cle = clePions(ap.pions);
      }
      this.joue = this.candidats.find((c) => c.res.ir === ir && (c.res.coup.t === 'defausse' ? 'd' : clePions(c.res.pions)) === cle) || null;
    }
    // candidats simulés : les meilleurs selon l'évaluation statique, plus le coup joué
    const s0 = this.candidats[0].statique;
    this.actifs = this.candidats.filter((c, i) => i < (options.candidatsMax ?? CANDIDATS_MAX) && c.statique >= s0 - ECART_STATIQUE_MAX);
    if (this.joue && !this.actifs.includes(this.joue)) this.actifs.push(this.joue);
  }

  tirage() {
    return tirerMains(this.prep, this.rng);
  }

  simulerCandidat(c, mains) {
    const r = simuler(this.prep, c.res, c.mainApres, mains, this.profondeur);
    return { v: r.v, p: probaDepuisEvaluation(r.v, r.pions, this.prep.poids.victoire) };
  }

  probaStatique(c) {
    return probaDepuisEvaluation(c.statique, c.res.pions, this.prep.poids.victoire);
  }

  /** Coup que l'IA jouerait en l'état de l'analyse. */
  meilleurCoup() {
    return this.meilleur().res.coup;
  }

  resultat() {
    const fabriquer = (c) => {
      if (!c.raisons) c.raisons = raisonsCoup(this.prep, this.etat, this.siege, this.main, c);
      return { coup: c === this.joue && this.coupJoue ? this.coupJoue : c.res.coup, raisons: c.raisons };
    };
    const distinct = (c) => (c.res.coup.t === 'defausse' ? 'd' + c.res.ir : clePions(c.res.pions));
    return this.resultatCommun(fabriquer, distinct);
  }
}

// ---------------------------------------------------------------------------
// Analyse du don au partenaire
// ---------------------------------------------------------------------------

export class AnalyseDon extends AnalyseBase {
  constructor(etat, siege, main, options = {}) {
    super();
    this.etat = etat;
    this.siege = siege;
    this.main = main.slice();
    this.prep = preparer(etat, siege, main, {});
    this.entrees = noterDons(etat, siege, main, options);
    this.candidats = this.entrees.map((e) => ({ e, statique: e.note }));
    this.init(options);
    this.joue = null;
    if (options.carteJouee) {
      const ir = indexRang(options.carteJouee);
      this.joue = this.candidats.find((c) => c.e.ir === ir) || null;
      if (this.joue) this.carteJouee = options.carteJouee;
    }
    this.actifs = this.candidats.slice();
  }

  /** Tirage commun : mains des trois autres joueurs et dons des autres joueurs. */
  tirage() {
    const { etat, siege } = this;
    const pool = melangerAvec(this.prep.nonVues.slice(), this.rng);
    const mains = [null, null, null, null];
    let k = 0;
    for (let j = 0; j < 4; j++) {
      if (j === siege) continue;
      mains[j] = pool.slice(k, k + etat.cartesRestantes[j]);
      k += etat.cartesRestantes[j];
    }
    // Chaque autre joueur choisit son don comme l'IA le ferait avec la main tirée.
    const dons = [null, null, null, null];
    for (let j = 0; j < 4; j++) {
      if (j === siege || !mains[j].length) continue;
      dons[j] = noterDons(etat, j, mains[j], {})[0].carte;
    }
    return { mains, dons };
  }

  simulerCandidat(c, t) {
    const { etat, siege } = this;
    const mains = [0, 1, 2, 3].map((j) => (j === siege ? this.main.slice() : t.mains[j].slice()));
    const dons = t.dons.slice();
    dons[siege] = c.e.carte;
    for (let j = 0; j < 4; j++) {
      const d = dons[j];
      if (!d) continue;
      mains[j].splice(mains[j].indexOf(d), 1);
    }
    for (let j = 0; j < 4; j++) if (dons[j]) mains[(j + 2) & 3].push(dons[j]);
    const restes = mains.map((m) => m.length);
    const r = jouerDonne(this.prep, etat.pions, mains, restes, etat.tour, etat.donne, siege);
    return { v: r.v, p: probaDepuisEvaluation(r.v, r.pions, this.prep.poids.victoire) };
  }

  probaStatique() {
    const info = { n: this.etat.cartesRestantes, connu: [0, 0, 0, 0], nConnu: [0, 0, 0, 0] };
    // position actuelle, sans avantage de main
    return probaDepuisEvaluation(this.evaluationPosition(info), this.etat.pions, this.prep.poids.victoire);
  }

  evaluationPosition(info) {
    if (this.evalPos === undefined) {
      this.evalPos = evaluerPlateauPublic(this.prep, this.etat, this.siege, info);
    }
    return this.evalPos;
  }

  resultat() {
    const fabriquer = (c) => {
      if (!c.raisons) c.raisons = raisonsDon(c.e, this.etat, this.siege);
      return { carte: c === this.joue && this.carteJouee ? this.carteJouee : c.e.carte, raisons: c.raisons };
    };
    const r = this.resultatCommun(fabriquer, (c) => c.e.ir);
    if (this.iterations === 0) {
      // avant toute simulation, la note d'un don est un gain relatif : l'évaluation affichée
      // est celle de la position actuelle
      const info = { n: this.etat.cartesRestantes, connu: [0, 0, 0, 0], nConnu: [0, 0, 0, 0] };
      r.evaluation = Math.round(this.evaluationPosition(info) * 10) / 10;
    }
    return r;
  }
}

function evaluerPlateauPublic(prep, etat, siege, info) {
  return evaluerPlateau(etat.pions, siege & 1, etat.tour, info, prep.ctx);
}

/** Crée l'analyse d'un coup (phase 'jeu'). */
export function creerAnalyse(etat, siege, main, options = {}) {
  return new AnalyseCoup(etat, siege, main, options);
}

/** Crée l'analyse du don au partenaire (phase 'echange'). */
export function creerAnalyseDon(etat, siege, main, options = {}) {
  return new AnalyseDon(etat, siege, main, options);
}

