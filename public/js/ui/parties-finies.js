// Parties contre l'IA terminées, gardées sur l'appareil (comme l'historique de l'appli Scrabble) : elles alimentent
// l'écran « Statistiques » et restent analysables. Les plus récentes sont gardées en entier (avec leurs coups et les
// mains de chaque donne) ; les plus anciennes ne gardent que leur résumé, qui suffit au bilan.
//
// Entrée : { id, date, nb, gagne, gagnants, joueurs: [{ pseudo, ia, niveau }], donnes, coups, cinqAdverse,
//            sauvegarde?, uid?, ailleurs?, auCompte? }
//   sauvegarde = { nom, joueurs, partie } (format de SessionLocale), absente des anciennes ;
//   uid : compte auquel la partie est rattachée (absent : pas encore de compte) ;
//   ailleurs : partie jouée sur un autre appareil du même compte (seul son résultat est ici) ;
//   auCompte : le compte garde cette partie en entier (analysable même si la sauvegarde n'est pas ici).
//
// Avec un compte, l'historique suit d'un appareil à l'autre : le compte en garde les résumés (synchro-ia.js verse
// ceux de l'appareil et rapporte ceux des autres), et les plus récentes en entier, pour l'analyse. Les parties
// retirées sont notées (CLE_RETIREES) pour ne revenir sur aucun appareil. Sur un appareil partagé, chacun ne voit
// que les parties de son compte.

import { siegesGagnants } from '../moteur/index.js';

export const CLE_PARTIES_FINIES = 'toc.partiesFinies';
/** Identifiants des parties retirées de l'historique. */
export const CLE_RETIREES = 'toc.partiesFiniesRetirees';
export const MAX_RETIREES = 500;
/** Nombre de parties gardées en entier (analysables). */
export const MAX_COMPLETES = 12;
/** Nombre de parties gardées en tout (résumés). */
export const MAX_PARTIES = 300;

const stockageParDefaut = () => (typeof localStorage === 'undefined' ? null : localStorage);

/** Identifiant stable d'une partie terminée : la même partie donne toujours le même (pas de doublon). */
export function idPartie(sauvegarde, nb) {
  const p = sauvegarde.partie;
  const texte = JSON.stringify([nb, p.archives?.[0]?.mains ?? null, p.historique?.length ?? 0, p.etat.pions]);
  let h = 5381;
  for (let i = 0; i < texte.length; i++) h = ((h * 33) ^ texte.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

export function lirePartiesFinies(stockage = stockageParDefaut()) {
  try {
    const liste = JSON.parse(stockage?.getItem(CLE_PARTIES_FINIES) || '[]');
    return Array.isArray(liste) ? liste.filter((p) => p && p.id) : [];
  } catch {
    return [];
  }
}

export function lireRetirees(stockage = stockageParDefaut()) {
  try {
    const liste = JSON.parse(stockage?.getItem(CLE_RETIREES) || '[]');
    return Array.isArray(liste) ? liste.filter((id) => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function ecrireRetirees(liste, stockage) {
  try {
    stockage?.setItem(CLE_RETIREES, JSON.stringify([...new Set(liste)].slice(-MAX_RETIREES)));
  } catch {
    /* stockage plein : tant pis */
  }
}

function ecrire(liste, stockage) {
  if (!stockage) return false;
  // Si la place manque, on allège : les parties entières les plus anciennes redeviennent de simples résumés.
  let completes = liste.filter((p) => p.sauvegarde).length;
  for (;;) {
    try {
      stockage.setItem(CLE_PARTIES_FINIES, JSON.stringify(liste));
      return true;
    } catch {
      if (!completes) return false;
      completes--;
      let vues = 0;
      liste = liste.map((p) => (p.sauvegarde && ++vues > completes ? { ...p, sauvegarde: undefined } : p));
    }
  }
}

/**
 * Ajoute une partie terminée à l'historique (sans effet si elle y est déjà, ou si elle n'est pas finie).
 * Une partie retirée de l'historique n'y revient pas.
 * @param {{ nom, joueurs, partie }} sauvegarde  format de SessionLocale ; le joueur humain est au siège 0
 * @param {Object} [o]  { stockage, date, uid } ; uid : compte connecté, auquel la partie est rattachée
 * @returns {string|null} l'identifiant de la partie
 */
export function enregistrerPartieFinie(sauvegarde, nb = 4, { stockage = stockageParDefaut(), date = Date.now(), uid = null } = {}) {
  const etat = sauvegarde?.partie?.etat;
  if (!etat || etat.phase !== 'fini') return null;
  const id = idPartie(sauvegarde, nb);
  const liste = lirePartiesFinies(stockage);
  if (liste.some((p) => p.id === id) || lireRetirees(stockage).includes(id)) return id;
  const gagnants = siegesGagnants(etat);
  liste.unshift({
    id,
    ...(uid ? { uid } : {}),
    date,
    nb,
    gagne: gagnants.includes(0),
    gagnants,
    joueurs: (sauvegarde.joueurs || []).map((j) => ({ pseudo: j.pseudo, ia: !!j.ia, niveau: j.niveau || null })),
    donnes: etat.donne + 1,
    coups: sauvegarde.partie.historique?.length || 0,
    cinqAdverse: !!etat.reglages?.cinqAdverse,
    sauvegarde: { nom: sauvegarde.nom, joueurs: sauvegarde.joueurs, partie: sauvegarde.partie },
  });
  let completes = 0;
  const allegee = liste.slice(0, MAX_PARTIES).map((p) => (p.sauvegarde && ++completes > MAX_COMPLETES ? { ...p, sauvegarde: undefined } : p));
  ecrire(allegee, stockage);
  return id;
}

export function partieFinie(id, stockage = stockageParDefaut()) {
  return lirePartiesFinies(stockage).find((p) => p.id === id) || null;
}

/** Retire une partie de l'historique, pour de bon : elle est notée, et ne reviendra d'aucun appareil. */
export function supprimerPartieFinie(id, stockage = stockageParDefaut()) {
  ecrire(
    lirePartiesFinies(stockage).filter((p) => p.id !== id),
    stockage,
  );
  ecrireRetirees(lireRetirees(stockage).concat([id]), stockage);
}

// ─── Historique rattaché au compte ──────────────────────────────────────────

/** Parties à montrer : sans compte, toutes celles de l'appareil ; connecté, celles du compte et celles sans compte. */
export const partiesDuCompte = (parties, uid) => (uid ? parties.filter((p) => !p.uid || p.uid === uid) : parties);

/** Ce que le compte garde d'une partie : son résumé (ni les coups, ni ce qui ne regarde que l'appareil). */
export function resumePourCompte(p) {
  const { sauvegarde, uid, ailleurs, auCompte, ...resume } = p;
  return resume;
}

/** Ce que cet appareil verse au compte `uid` : ses parties (et celles qui n'ont pas encore de compte), et les retirées. */
export function historiqueAEnvoyer(uid, stockage = stockageParDefaut()) {
  return { parties: partiesDuCompte(lirePartiesFinies(stockage), uid).map(resumePourCompte), retirees: lireRetirees(stockage) };
}

/**
 * Range dans l'appareil l'historique fusionné renvoyé par le compte : les parties des autres appareils arrivent
 * (résultat seul), celles d'ici sont rattachées au compte, les retirées disparaissent.
 * @param {{ parties: Object[], retirees: string[], completes?: string[] }} compte
 * @returns {boolean} true si l'historique de l'appareil a changé
 */
export function integrerHistoriqueCompte(compte, uid, stockage = stockageParDefaut()) {
  const avant = lirePartiesFinies(stockage);
  const retire = new Set(compte.retirees || []);
  const duCompte = new Set((compte.parties || []).map((p) => p.id));
  const entieres = new Set(compte.completes || []);
  const ici = new Set(avant.map((p) => p.id));
  // Rattachée au compte, et marquée si le compte la garde en entier (la marque suit ce que dit le compte).
  const rattacher = (p) => {
    if (!duCompte.has(p.id)) return p;
    const { auCompte, ...reste } = p;
    return { ...reste, uid, ...(entieres.has(p.id) ? { auCompte: true } : {}) };
  };
  const suite = avant.filter((p) => !retire.has(p.id)).map(rattacher);
  for (const p of compte.parties || []) if (p && p.id && !ici.has(p.id) && !retire.has(p.id)) suite.push(rattacher({ ...p, ailleurs: true }));
  suite.sort((a, b) => b.date - a.date);
  let completes = 0;
  const liste = suite.slice(0, MAX_PARTIES).map((p) => (p.sauvegarde && ++completes > MAX_COMPLETES ? { ...p, sauvegarde: undefined } : p));
  ecrireRetirees(lireRetirees(stockage).concat([...retire]), stockage);
  if (JSON.stringify(liste) === JSON.stringify(avant)) return false;
  ecrire(liste, stockage);
  return true;
}

/**
 * Parties de cet appareil à verser en entier au compte : celles qu'il a en entier, que le compte n'a pas encore, et
 * qui font partie des `max` plus récentes parmi celles que le compte garderait (même choix que le compte : pas de
 * versement pour rien).
 * @param {{ parties: Object[], completes?: string[] }} compte  l'historique fusionné renvoyé par le compte
 * @returns {Object[]} entrées de l'appareil (avec leur sauvegarde), de la plus récente à la plus ancienne
 */
export function partiesAVerser(compte, uid, stockage = stockageParDefaut(), max = MAX_COMPLETES) {
  const rang = new Map((compte.parties || []).map((p, i) => [p.id, i]));
  const deja = new Set(compte.completes || []);
  const locales = lirePartiesFinies(stockage).filter((p) => p.sauvegarde && p.uid === uid && rang.has(p.id) && !deja.has(p.id));
  const gardees = new Set([...deja, ...locales.map((p) => p.id)].filter((id) => rang.has(id)).sort((x, y) => rang.get(x) - rang.get(y)).slice(0, max));
  return locales.filter((p) => gardees.has(p.id)).sort((x, y) => rang.get(x.id) - rang.get(y.id));
}

/** Note que le compte garde ces parties en entier. */
export function marquerAuCompte(ids, stockage = stockageParDefaut()) {
  const voulues = new Set(ids);
  const liste = lirePartiesFinies(stockage);
  if (liste.some((p) => voulues.has(p.id) && !p.auCompte)) ecrire(liste.map((p) => (voulues.has(p.id) ? { ...p, auCompte: true } : p)), stockage);
}

/** Niveau des IA adverses d'une partie (siège 1 : toujours un adversaire). */
export function niveauAdverse(p) {
  return p.joueurs?.[1]?.niveau || 'champion';
}

/**
 * Bilan contre l'IA : total, puis une ligne par mode et par niveau des adversaires.
 * @returns {{ parties, victoires, lignes: [{ nb, niveau, parties, victoires }] }}
 */
export function bilanContreIA(parties) {
  const lignes = new Map();
  let victoires = 0;
  for (const p of parties) {
    const cle = p.nb + ':' + niveauAdverse(p);
    const l = lignes.get(cle) || { nb: p.nb, niveau: niveauAdverse(p), parties: 0, victoires: 0 };
    l.parties++;
    if (p.gagne) {
      l.victoires++;
      victoires++;
    }
    lignes.set(cle, l);
  }
  return { parties: parties.length, victoires, lignes: [...lignes.values()] };
}

/**
 * Bilan des parties en ligne terminées (résumés de l'API, voir reseau/api.js) : total, et par autre joueur humain,
 * les parties jouées avec lui (partenaire) et contre lui.
 * @returns {{ parties, victoires, joueurs: [{ uid, pseudo, avec, avecGagnees, contre, contreGagnees }] }}
 */
export function bilanEnLigne(parties) {
  const joueurs = new Map();
  let total = 0;
  let victoires = 0;
  for (const p of parties) {
    const moi = p.monSiege;
    if (p.statut !== 'finie' || !(moi >= 0)) continue;
    const a3 = p.nbJoueurs === 3;
    const gagne = Array.isArray(p.gagnants) && p.gagnants.length ? p.gagnants.includes(moi) : a3 ? p.gagnant === moi : p.gagnant === moi % 2;
    total++;
    if (gagne) victoires++;
    (p.joueurs || []).forEach((place, siege) => {
      if (!place || place.ia || !place.uid || siege === moi) return;
      const j = joueurs.get(place.uid) || { uid: place.uid, pseudo: place.pseudo, avec: 0, avecGagnees: 0, contre: 0, contreGagnees: 0 };
      j.pseudo = place.pseudo || j.pseudo;
      if (!a3 && siege % 2 === moi % 2) {
        j.avec++;
        if (gagne) j.avecGagnees++;
      } else {
        j.contre++;
        if (gagne) j.contreGagnees++;
      }
      joueurs.set(place.uid, j);
    });
  }
  return { parties: total, victoires, joueurs: [...joueurs.values()].sort((a, b) => b.avec + b.contre - (a.avec + a.contre)) };
}
