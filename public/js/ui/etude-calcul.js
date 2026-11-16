// Calculs purs de l'écran d'analyse (testés dans tests/ui-analyse.test.js) : liste des tours d'un joueur à
// analyser, qualificatif d'un coup selon son écart avec le meilleur, bilan, conversion de l'évaluation de l'IA en
// « pions d'avance », graduations du graphique, position montrée après un coup.

import { POIDS_DEFAUT } from '../ia/evaluation.js';

/**
 * L'IA compte en « cases » (voir ia/evaluation.js) : une case de progression vaut 1, un pion rentré vaut
 * POIDS_DEFAUT.rentre cases (98 à 4 joueurs, 16 de moins sur le circuit plus court du jeu à 3), un pion à la base 0.
 * L'écran, lui, compte en « pions d'avance » : 1 pion = la valeur d'un pion rentré, c'est-à-dire l'avantage
 * d'avoir un pion rentré de plus que l'adversaire (un tour complet, de la base à l'arrivée).
 */
export function casesParPion(nbJoueurs = 4) {
  return POIDS_DEFAUT.rentre - (64 - 16 * (nbJoueurs === 3 ? 3 : 4));
}

/** Convertit une valeur de l'IA (en cases) en pions d'avance. */
export function enPions(cases, nbJoueurs = 4) {
  return cases / casesParPion(nbJoueurs);
}

/** Nombre de pions écrit en français : deux décimales sous 1 pion (« 0,06 »), une au-delà (« 1,2 »). */
function ecrirePions(p) {
  const a = Math.abs(p);
  return a.toLocaleString('fr-FR', { maximumFractionDigits: a < 0.995 ? 2 : 1 });
}

/**
 * Une valeur de l'IA (en cases) affichée en pions d'avance : « +0,3 pion », « −1,5 pion », « 2 pions ».
 * @param {number} cases
 * @param {number} [nbJoueurs]  3 ou 4
 * @param {Object} [o]          { signe : écrire « + » devant un avantage, unite : écrire « pion(s) » }
 */
export function formatPions(cases, nbJoueurs = 4, { signe = false, unite = true } = {}) {
  if (typeof cases !== 'number' || Number.isNaN(cases)) return '–';
  const p = enPions(cases, nbJoueurs);
  const texte = ecrirePions(p);
  const nul = texte === '0';
  const prefixe = nul ? '' : p < 0 ? '−' : signe ? '+' : '';
  // En français, le pluriel commence à 2 : « 1,5 pion », « 2 pions ».
  return prefixe + texte + (unite ? (Math.abs(p) >= 2 ? ' pions' : ' pion') : '');
}

/**
 * Seuils du qualificatif, en cases (l'unité de l'IA ; en pions d'avance : 0,005, 0,02 et 0,05 à 4 joueurs).
 * Un écart plus petit que l'incertitude de l'analyse (marge) n'est jamais compté comme une faute.
 */
export const SEUILS = { meilleur: 0.5, bon: 2, imprecision: 5 };

export const QUALIFICATIFS = {
  meilleur: { nom: 'Meilleur coup', classe: 'ok' },
  bon: { nom: 'Bon coup', classe: 'bon' },
  imprecision: { nom: 'Imprécision', classe: 'moyen' },
  erreur: { nom: 'Erreur', classe: 'mauvais' },
};

/** Qualificatif ('meilleur' | 'bon' | 'imprecision' | 'erreur') d'un coup joué, ou null sans analyse. */
export function qualifier(joue, meilleur) {
  if (!joue) return null;
  if (joue === meilleur || !(joue.ecart > SEUILS.meilleur)) return 'meilleur';
  const e = Math.max(0, joue.ecart - (joue.marge || 0));
  if (e <= SEUILS.bon) return 'bon';
  if (e <= SEUILS.imprecision) return 'imprecision';
  return 'erreur';
}

/** Le candidat qui décrit le coup (ou la carte) réellement joué. */
export function candidatJoue(resultat) {
  return resultat?.candidats?.find((c) => c.joue) || null;
}

/**
 * Sièges dont on peut analyser les coups : celui du joueur local d'abord, puis ceux dont les mains sont connues
 * (donnees.donnesParSiege : parties contre l'IA sur cet appareil). En ligne, les mains des autres restent secrètes.
 */
export function siegesAnalysables(donnees) {
  const { siege, donnesParSiege } = donnees;
  const sieges = [siege];
  if (!Array.isArray(donnesParSiege)) return sieges;
  donnesParSiege.forEach((donnes, s) => {
    if (s !== siege && Array.isArray(donnes) && donnes.some((d) => d && Array.isArray(d.distribuees))) sieges.push(s);
  });
  return sieges;
}

/**
 * Tours d'un joueur, dans l'ordre de la partie : pour chaque donne, la carte qu'il a donnée, puis ses coups.
 * @param {Object} donnees    session.donneesAnalyse()
 * @param {Object} rejeu      moteur.rejouerPartie(reglages, historique)
 * @param {Function} mainAvantCoup   moteur.mainAvantCoup
 * @param {number} [siege]    joueur analysé (défaut : le joueur local) ; un autre siège demande ses mains dans
 *                            donnees.donnesParSiege[siege], sinon la liste est vide
 */
export function toursDuJoueur(donnees, rejeu, mainAvantCoup, siege = donnees.siege) {
  // Sans les mains d'un autre siège (partie en ligne), il n'y a rien à analyser pour lui.
  if (siege !== donnees.siege && !Array.isArray(donnees.donnesParSiege?.[siege])) return [];
  const donnes = (siege === donnees.siege ? donnees.donnes : donnees.donnesParSiege[siege]) || [];
  const items = [];
  rejeu.echanges.forEach((ech, d) => {
    const info = donnes[d];
    if (!info || !info.donnee) return;
    items.push({
      type: 'don',
      siege,
      donne: d,
      etat: ech.etat,
      main: info.distribuees.slice(),
      carte: info.donnee,
      options: { carteJouee: info.donnee },
    });
  });
  for (const t of rejeu.tours) {
    if (t.siege !== siege) continue;
    const d = t.avant.donne;
    const info = donnes[d] || {};
    const main = mainAvantCoup(donnes, t.avant);
    items.push({
      type: 'coup',
      siege,
      donne: d,
      n: t.n,
      etat: t.avant,
      apres: t.apres,
      coup: t.coup,
      main,
      options: { coupJoue: t.coup, carteDonnee: info.donnee ?? null, carteRecue: info.recue ?? null, max: 3 },
    });
  }
  // Ordre chronologique : par donne, la carte donnée avant les coups.
  items.sort((a, b) => a.donne - b.donne || (a.type === 'don' ? -1 : b.type === 'don' ? 1 : a.n - b.n));
  return items.map((x, i) => ({ ...x, id: i }));
}

/** Bilan : nombre de coups par qualificatif et les 3 coups qui ont coûté le plus. */
export function bilan(items, resultats) {
  const compte = { meilleur: 0, bon: 0, imprecision: 0, erreur: 0 };
  const couts = [];
  let analyses = 0;
  for (const it of items) {
    const r = resultats.get(it.id);
    if (!r || r.erreur) continue;
    analyses++;
    const joue = candidatJoue(r);
    const q = qualifier(joue, r.candidats?.[0]);
    if (q) compte[q]++;
    if (joue && joue.ecart > SEUILS.meilleur) couts.push({ id: it.id, ecart: joue.ecart });
  }
  couts.sort((a, b) => b.ecart - a.ecart);
  return { compte, analyses, couteux: couts.slice(0, 3) };
}

/**
 * Position à montrer une fois un coup joué : le plateau d'après le coup, mais encore dans la donne et au tour du
 * joueur qui vient de jouer (le moteur, lui, est déjà passé au joueur suivant, voire à la donne suivante avec un
 * tas vidé). Sert à animer le coup depuis la position d'avant.
 * @param {Object} avant   état public avant le coup
 * @param {Object} apres   état public après le coup (appliquerCoup), avec son dernierCoup
 */
export function etatApresCoup(avant, apres) {
  const { siege, coup } = apres.dernierCoup;
  const cartesRestantes = avant.cartesRestantes.slice();
  cartesRestantes[siege] = Math.max(0, cartesRestantes[siege] - 1);
  const etat = {
    ...apres,
    phase: apres.phase === 'fini' ? 'fini' : 'jeu',
    donne: avant.donne,
    tour: siege,
    echanges: avant.echanges,
    cartesRestantes,
    pile: [...avant.pile, coup.carte],
  };
  if (avant.jokers) etat.jokers = coup.t !== 'defausse' && coup.comme ? { ...avant.jokers, [coup.carte]: coup.comme } : avant.jokers;
  return etat;
}

const PAS_PIONS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50];
const PAS_TOURS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];

/**
 * Graduations de l'axe vertical du graphique (en pions) : des valeurs rondes qui encadrent les données, zéro
 * toujours compris, au plus `maxi` intervalles.
 * @returns {{ min:number, max:number, pas:number, valeurs:number[] }}
 */
export function graduations(min, max, maxi = 5) {
  let bas = Math.min(0, Number.isFinite(min) ? min : 0);
  let haut = Math.max(0, Number.isFinite(max) ? max : 0);
  // Une partie serrée ne remplit pas tout le cadre : au moins un demi-pion de part et d'autre de zéro.
  bas = Math.min(bas, -0.5);
  haut = Math.max(haut, 0.5);
  for (const pas of PAS_PIONS) {
    const b = Math.floor(bas / pas + 1e-9);
    const h = Math.ceil(haut / pas - 1e-9);
    if (h - b > maxi && pas !== PAS_PIONS[PAS_PIONS.length - 1]) continue;
    const valeurs = [];
    for (let k = b; k <= h; k++) valeurs.push(Math.round(k * pas * 10) / 10);
    return { min: valeurs[0], max: valeurs[valeurs.length - 1], pas, valeurs };
  }
  return { min: bas, max: haut, pas: haut - bas, valeurs: [bas, 0, haut] };
}

/** Graduations de l'axe horizontal : numéros de tours (à partir de 1) à écrire, au plus `maxi` environ. */
export function graduationsTours(n, maxi = 6) {
  if (n <= 0) return [];
  const pas = PAS_TOURS.find((p) => n / p <= maxi) || PAS_TOURS[PAS_TOURS.length - 1];
  const tours = pas === 1 ? [] : [1];
  for (let t = pas; t <= n; t += pas) tours.push(t);
  return tours;
}
