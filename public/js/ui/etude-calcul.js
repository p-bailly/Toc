// Calculs purs de l'écran d'analyse (testés dans tests/ui-analyse.test.js) : liste des tours du joueur à
// analyser, qualificatif d'un coup selon son écart avec le meilleur, bilan.

/**
 * Seuils du qualificatif, en « cases » (unité de l'évaluation de l'IA : l'avantage d'une équipe vaut à peu près
 * le nombre de cases d'avance de ses pions). Un écart plus petit que l'incertitude de l'analyse (marge) n'est
 * jamais compté comme une faute.
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
 * Tours du joueur local, dans l'ordre de la partie : pour chaque donne, la carte donnée au partenaire, puis ses coups.
 * @param {Object} donnees    session.donneesAnalyse()
 * @param {Object} rejeu      moteur.rejouerPartie(reglages, historique)
 * @param {Function} mainAvantCoup   moteur.mainAvantCoup
 */
export function toursDuJoueur(donnees, rejeu, mainAvantCoup) {
  const { siege, donnes = [] } = donnees;
  const items = [];
  rejeu.echanges.forEach((ech, d) => {
    const info = donnes[d];
    if (!info || !info.donnee) return;
    items.push({
      type: 'don',
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

/** « +3,2 » / « −1 » : un nombre de cases avec son signe. */
export function formatCases(x) {
  if (typeof x !== 'number' || Number.isNaN(x)) return '–';
  const t = Math.abs(x).toLocaleString('fr-FR', { maximumFractionDigits: 1 });
  return (x > 0.05 ? '+' : x < -0.05 ? '−' : '') + t;
}
