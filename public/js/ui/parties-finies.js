// Parties contre l'IA terminées, gardées sur l'appareil (comme l'historique de l'appli Scrabble) : elles alimentent
// l'écran « Statistiques » et restent analysables. Les plus récentes sont gardées en entier (avec leurs coups et les
// mains de chaque donne) ; les plus anciennes ne gardent que leur résumé, qui suffit au bilan.
//
// Entrée : { id, date, nb, gagne, gagnants, joueurs: [{ pseudo, ia, niveau }], donnes, coups, cinqAdverse,
//            sauvegarde? }   où sauvegarde = { nom, joueurs, partie } (format de SessionLocale), absente des anciennes.

import { siegesGagnants } from '../moteur/index.js';

export const CLE_PARTIES_FINIES = 'toc.partiesFinies';
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
 * @param {{ nom, joueurs, partie }} sauvegarde  format de SessionLocale ; le joueur humain est au siège 0
 * @returns {string|null} l'identifiant de la partie
 */
export function enregistrerPartieFinie(sauvegarde, nb = 4, { stockage = stockageParDefaut(), date = Date.now() } = {}) {
  const etat = sauvegarde?.partie?.etat;
  if (!etat || etat.phase !== 'fini') return null;
  const id = idPartie(sauvegarde, nb);
  const liste = lirePartiesFinies(stockage);
  if (liste.some((p) => p.id === id)) return id;
  const gagnants = siegesGagnants(etat);
  liste.unshift({
    id,
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

export function supprimerPartieFinie(id, stockage = stockageParDefaut()) {
  ecrire(
    lirePartiesFinies(stockage).filter((p) => p.id !== id),
    stockage,
  );
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
