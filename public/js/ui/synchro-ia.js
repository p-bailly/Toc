// Parties contre l'IA rattachées au compte : elles se jouent hors ligne, sur l'appareil, mais suivent le compte d'un
// appareil à l'autre. Trois choses suivent :
//   1. l'historique des parties terminées (résultats, statistiques) : l'appareil verse ses parties au compte et
//      range celles des autres appareils (voir parties-finies.js) ;
//   2. les parties terminées les plus récentes, en entier, pour les analyser depuis n'importe quel appareil ;
//   3. la partie en cours de chaque mode : envoyée au compte pendant qu'on joue, reprise sur un autre appareil.
//      Le compte n'en garde qu'une par mode : la plus récemment jouée l'emporte.
// Sans compte ou sans réseau, rien ne bouge : tout reste sur l'appareil, et partira à la prochaine occasion.
//
// Suivi de la partie en cours d'un mode (clé « <clé de la sauvegarde>.suivi ») : { uid, date, envoyee }
//   uid : compte auquel la partie est rattachée (null : jouée sans compte, le premier compte connecté la prend) ;
//   date : dernière modification sur l'appareil (ms) ; envoyee : date de la version déjà confiée au compte.

import { historiqueAEnvoyer, integrerHistoriqueCompte, partiesAVerser, marquerAuCompte, partieFinie } from './parties-finies.js';

/** Clé de la sauvegarde de chaque mode (les mêmes que dans ecran-jeu.js). */
export const CLES_PARTIE_IA = { 4: 'toc.partieLocale', 3: 'toc.partieLocale3' };
/** Au-delà, la sauvegarde ne tient plus dans un document du compte : elle reste sur l'appareil. */
const TAILLE_MAX = 900000;
/** Délai entre la dernière modification et l'envoi au compte : on n'envoie pas à chaque coup. */
export const DELAI_ENVOI = 5000;

const stockageParDefaut = () => (typeof localStorage === 'undefined' ? null : localStorage);
const cleSuivi = (nb) => CLES_PARTIE_IA[nb] + '.suivi';
const connecte = (app, fonction) => !!app.joueur?.uid && app.enLigne() && typeof app.api?.[fonction] === 'function';

// ─── 1 et 2. Parties terminées ──────────────────────────────────────────────

let enCours = null;

/**
 * Synchronise l'historique de l'appareil avec celui du compte connecté, puis confie au compte, en entier, les
 * parties récentes qu'il n'a pas encore. Jamais d'erreur vers l'appelant (réseau absent, règles Firestore pas
 * encore à jour… : on réessaiera).
 * @returns {Promise<boolean>} true si l'historique de l'appareil a changé (à réafficher)
 */
export function synchroniserPartiesIA(app, stockage = stockageParDefaut()) {
  const faire = async () => {
    const uid = app.joueur?.uid;
    if (!connecte(app, 'synchroniserPartiesIA')) return false;
    try {
      const compte = await app.api.synchroniserPartiesIA(historiqueAEnvoyer(uid, stockage));
      // Le compte a pu changer pendant l'attente (déconnexion) : on ne range que pour celui qui a demandé.
      if (app.joueur?.uid !== uid) return false;
      const change = integrerHistoriqueCompte(compte, uid, stockage);
      await verserPartiesEntieres(app, compte, uid, stockage);
      return change;
    } catch (e) {
      console.warn('Historique contre l’IA non synchronisé', e);
      return false;
    }
  };
  // Une synchronisation à la fois ; une demande faite pendant qu'une autre tourne passe juste après.
  const suite = (enCours || Promise.resolve()).then(faire);
  enCours = suite;
  void suite.finally(() => {
    if (enCours === suite) enCours = null;
  });
  return suite;
}

async function verserPartiesEntieres(app, compte, uid, stockage) {
  if (typeof app.api.ecrirePartieIAFinie !== 'function') return;
  for (const p of partiesAVerser(compte, uid, stockage)) {
    const json = JSON.stringify(p.sauvegarde);
    if (json.length > TAILLE_MAX) continue;
    const r = await app.api.ecrirePartieIAFinie(p.id, json);
    if (app.joueur?.uid !== uid) return;
    if (r?.completes?.includes(p.id)) marquerAuCompte([p.id], stockage);
  }
}

/**
 * Sauvegarde d'une partie terminée, pour l'analyse : celle de l'appareil, sinon celle que le compte garde.
 * @returns {Promise<{ entree: Object|null, sauvegarde: Object|null }>}
 */
export async function partieFinieEntiere(app, id, stockage = stockageParDefaut()) {
  const entree = partieFinie(id, stockage);
  if (entree?.sauvegarde) return { entree, sauvegarde: entree.sauvegarde };
  if (!connecte(app, 'lirePartieIAFinie')) return { entree, sauvegarde: null };
  const sauvegarde = lireSauvegarde(await app.api.lirePartieIAFinie(id));
  return { entree, sauvegarde };
}

function lireSauvegarde(json) {
  try {
    const d = typeof json === 'string' ? JSON.parse(json) : null;
    return d && d.partie && d.partie.etat && Array.isArray(d.joueurs) ? d : null;
  } catch {
    return null;
  }
}

// ─── 3. Partie en cours ─────────────────────────────────────────────────────

/** Modes dont la partie est ouverte à l'écran : on ne remplace pas une partie pendant qu'elle se joue. */
const ouvertes = new Set();
const minuteries = new Map();

export function marquerPartieOuverte(nb, ouverte) {
  if (ouverte) ouvertes.add(nb);
  else ouvertes.delete(nb);
}

function lireJson(stockage, cle) {
  try {
    return JSON.parse(stockage?.getItem(cle) || 'null');
  } catch {
    return null;
  }
}

/** Date d'une sauvegarde d'avant le suivi : on ne sait pas quand elle a été jouée, elle passe après toute autre. */
const DATE_INCONNUE = 1;

/**
 * Suivi de la partie en cours du mode, ou null. Une sauvegarde d'avant le suivi (date inconnue) est confiée au
 * compte s'il n'a rien, mais ne remplace jamais une partie qu'il garde déjà : un vieil appareil qu'on rallume
 * n'écrase pas la partie qu'on joue ailleurs.
 */
export function lireSuivi(nb, stockage = stockageParDefaut()) {
  const suivi = lireJson(stockage, cleSuivi(nb));
  if (suivi && Number.isFinite(suivi.date)) return suivi;
  let existe = false;
  try {
    existe = !!stockage?.getItem(CLES_PARTIE_IA[nb]);
  } catch {
    /* stockage indisponible */
  }
  if (!existe) return null;
  return ecrireSuivi(nb, { uid: null, date: DATE_INCONNUE, envoyee: 0 }, stockage);
}

function ecrireSuivi(nb, suivi, stockage) {
  try {
    stockage?.setItem(cleSuivi(nb), JSON.stringify(suivi));
  } catch {
    /* stockage plein : le suivi sera refait */
  }
  return suivi;
}

/**
 * La partie du mode vient de changer sur cet appareil (coup joué, nouvelle partie, partie effacée).
 * @param {number} [plancher]  date de la partie gardée par le compte : ce qu'on fait maintenant est plus récent,
 *                             même si l'horloge d'un autre appareil avance sur celle-ci
 */
export function noterModification(nb, uid, stockage = stockageParDefaut(), maintenant = Date.now, plancher = 0) {
  const avant = lireJson(stockage, cleSuivi(nb));
  // Une date toujours croissante, même si l'horloge recule ou si deux coups tombent dans la même milliseconde.
  const date = Math.max(maintenant(), (avant?.date || 0) + 1, (plancher || 0) + 1);
  return ecrireSuivi(nb, { uid: uid || avant?.uid || null, date, envoyee: avant?.envoyee || 0 }, stockage);
}

/**
 * Stockage à donner à la session de jeu : chaque sauvegarde est notée, et envoyée au compte un peu plus tard.
 * @returns {Storage} même interface que localStorage (getItem, setItem, removeItem)
 */
export function stockageSuivi(app, nb, stockage = stockageParDefaut()) {
  return {
    getItem: (cle) => stockage.getItem(cle),
    setItem: (cle, valeur) => {
      stockage.setItem(cle, valeur);
      if (cle !== CLES_PARTIE_IA[nb]) return;
      noterModification(nb, app.joueur?.uid, stockage, Date.now, app.joueur?.enCoursIA?.[nb]);
      planifierEnvoi(app, nb, stockage);
    },
    removeItem: (cle) => stockage.removeItem(cle),
  };
}

function planifierEnvoi(app, nb, stockage) {
  if (minuteries.has(nb)) return;
  const minuterie = setTimeout(() => {
    minuteries.delete(nb);
    void envoyerPartieEnCours(app, nb, stockage);
  }, DELAI_ENVOI);
  minuterie.unref?.(); // (tests dans Node : la minuterie ne retient pas le processus)
  minuteries.set(nb, minuterie);
}

/**
 * Confie au compte la partie en cours du mode, si elle a changé depuis le dernier envoi et qu'elle est bien à lui.
 * @returns {Promise<boolean>} true si le compte l'a prise
 */
export async function envoyerPartieEnCours(app, nb, stockage = stockageParDefaut()) {
  clearTimeout(minuteries.get(nb));
  minuteries.delete(nb);
  const uid = app.joueur?.uid;
  if (!connecte(app, 'ecrirePartieIAEnCours')) return false;
  const suivi = lireSuivi(nb, stockage);
  if (!suivi || suivi.envoyee === suivi.date || (suivi.uid && suivi.uid !== uid)) return false;
  let json = null;
  try {
    json = stockage.getItem(CLES_PARTIE_IA[nb]);
  } catch {
    /* stockage indisponible */
  }
  if (!json || json.length > TAILLE_MAX) return false;
  try {
    const r = await app.api.ecrirePartieIAEnCours(nb, json, suivi.date);
    // Envoyée (ou dépassée par une partie plus récente du compte) : inutile de la renvoyer. Si elle a encore
    // changé pendant l'envoi, la nouvelle version repartira à son tour.
    const apres = lireSuivi(nb, stockage);
    if (apres) ecrireSuivi(nb, { ...apres, uid: apres.uid || uid, envoyee: suivi.date }, stockage);
    if (apres && apres.date !== suivi.date) planifierEnvoi(app, nb, stockage);
    return !!r?.ecrit;
  } catch (e) {
    console.warn('Partie contre l’IA en cours non envoyée au compte', e);
    return false;
  }
}

/** Envoie sans attendre ce qui ne l'est pas encore (écran quitté, appli mise en arrière-plan, connexion). */
export function envoyerPartiesEnCours(app, stockage = stockageParDefaut()) {
  return Promise.all([4, 3].map((nb) => envoyerPartieEnCours(app, nb, stockage)));
}

/**
 * Le compte garde-t-il pour ce mode une partie plus récente que celle de l'appareil (un autre appareil a joué
 * depuis), ou celle de l'appareil est-elle à un autre compte ? Se lit dans la fiche du joueur, sans réseau.
 */
export function compteEnAvance(app, nb, stockage = stockageParDefaut()) {
  const uid = app.joueur?.uid;
  const dateCompte = app.joueur?.enCoursIA?.[nb] || 0;
  if (!uid || !dateCompte) return false;
  const suivi = lireSuivi(nb, stockage);
  const aMoi = !suivi || !suivi.uid || suivi.uid === uid;
  return !(aMoi && !!suivi && suivi.date >= dateCompte);
}

/**
 * Reprend sur cet appareil la partie en cours que le compte garde pour ce mode, si elle est plus récente que
 * celle de l'appareil (ou si celle de l'appareil est à un autre compte). Rien pendant que la partie est ouverte.
 * La date gardée par le compte se lit dans la fiche du joueur (app.joueur.enCoursIA) : le plus souvent, on sait
 * sans rien demander au réseau qu'il n'y a rien de neuf.
 * @returns {Promise<boolean>} true si la partie de l'appareil a été remplacée (à réafficher)
 */
export async function recupererPartieEnCours(app, nb, stockage = stockageParDefaut()) {
  const uid = app.joueur?.uid;
  if (ouvertes.has(nb) || !connecte(app, 'lirePartieIAEnCours') || !compteEnAvance(app, nb, stockage)) return false;
  try {
    const d = await app.api.lirePartieIAEnCours(nb);
    // Entre-temps : déconnexion, partie ouverte, ou coup joué ici. On ne touche alors à rien.
    if (!d || app.joueur?.uid !== uid || ouvertes.has(nb)) return false;
    const suivi = lireSuivi(nb, stockage);
    const aMoi = !suivi || !suivi.uid || suivi.uid === uid;
    if (aMoi && suivi && suivi.date >= d.date) return false;
    const sauvegarde = lireSauvegarde(d.json);
    if (!sauvegarde || sauvegarde.partie.etat.pions?.length !== nb * 4) return false;
    stockage.setItem(CLES_PARTIE_IA[nb], d.json);
    ecrireSuivi(nb, { uid, date: d.date, envoyee: d.date }, stockage);
    return true;
  } catch (e) {
    console.warn('Partie contre l’IA en cours non récupérée', e);
    return false;
  }
}

/** Les deux modes. → true si au moins une partie de l'appareil a été remplacée */
export async function recupererPartiesEnCours(app, stockage = stockageParDefaut()) {
  const r = await Promise.all([4, 3].map((nb) => recupererPartieEnCours(app, nb, stockage)));
  return r.some(Boolean);
}

/** L'appli passe en arrière-plan ou se ferme : on envoie ce qui attend (à brancher une fois, voir app.js). */
export function envoyerEnQuittant(app) {
  if (typeof document === 'undefined') return;
  const envoyer = () => void envoyerPartiesEnCours(app);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && envoyer());
  window.addEventListener('pagehide', envoyer);
}
