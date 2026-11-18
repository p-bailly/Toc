// Parties en ligne : création, invitations, salle d'attente, lancement, échange de cartes et coups.
//
// Pas de Cloud Functions (offre gratuite Spark) : chaque action est une transaction Firestore côté
// client (lecture, validation par le moteur, écriture). Les règles (firestore.rules) vérifient ce
// qu'elles peuvent sans exécuter le moteur ; c'est un modèle de confiance « entre amis ».
//
//   parties/{code} = {
//     nom, code, hote (créateur), statut: 'attente'|'encours'|'finie'|'abandonnee', reglages: { cinqAdverse } (modifiable en salle d'attente),
//     joueurs: [{ uid, pseudo, ia, couleur? } | null] × 4 (par siège ; couleur choisie par le joueur, voir
//     ../palette.js), uids: [uid…] (humains membres),
//     invites: [uid…], pseudosInvites: { uid: pseudo }, refus: [uid…],
//     etat (état public du moteur, dès le lancement), historique: [{ n, siege, coup, captures }],
//     enAttente: [uid…] (humains dont une action est attendue), creeLe, majLe }
//   parties/{code}/donnes/{donne}_{siege} = { donne, siege, cartes }   immuable
//   parties/{code}/dons/{donne}_{siege}   = { donne, de, pour, carte } immuable
//
// L'identifiant de la partie est son code d'invitation (comme dans l'appli Scrabble).

import {
  appliquerCoup,
  destinataireDon,
  distribuerCycle,
  distribuerPremierCycle,
  donneurDon,
  etatInitial,
  longueurCycle,
  mainEffective,
  marquerEchange,
  nombreJoueurs,
} from '../moteur/index.js';
import {
  ConflitIA,
  ErreurToc,
  calculerEnAttente,
  couleurChoisie,
  nbJoueursDe,
  reglagesPartie,
  verifierNiveau,
  chemins,
  codeValide,
  nouveauCode,
  normaliserCode,
  siegeDe,
} from './commun.js';
import { transaction } from './outils.js';
import { couleurValide, couleursIndisponibles } from '../palette.js';

export const NOM_MAX = 40;
export const MAX_INVITES = 8;
export const NOMS_IA = ['IA Sud', 'IA Est', 'IA Nord', 'IA Ouest'];
export const NOMS_IA_3 = ['IA 1', 'IA 2', 'IA 3'];

const copie = (x) => JSON.parse(JSON.stringify(x));

async function lirePseudo(tx, uid) {
  const fiche = await tx.lire(chemins.joueur(uid));
  if (!fiche) throw new ErreurToc('Fiche du joueur introuvable : reconnecte-toi.');
  return fiche.pseudo;
}

async function lirePartie(tx, id) {
  const p = await tx.lire(chemins.partie(id));
  if (!p) throw new ErreurToc("Cette partie n'existe plus.", 'not-found');
  return p;
}

function exigerAttente(p) {
  if (p.statut !== 'attente') throw new ErreurToc('La partie a déjà commencé.');
}

function exigerSiege(siege, p) {
  if (!Number.isInteger(siege) || siege < 0 || siege >= (p ? p.joueurs.length : 4)) throw new ErreurToc('Siège invalide.');
}

/**
 * Écrit les mains d'un cycle, dans la transaction : 12 documents dans les deux modes
 * (3 donnes × 4 sièges à 4 joueurs, 4 donnes × 3 sièges à 3). Le premier cycle de la partie (donne 0) est un peu
 * lissé, comme dans une partie locale (voir distribuerPremierCycle).
 */
function ecrireCycle(ctx, tx, id, donne, n) {
  const cycle = (donne === 0 ? distribuerPremierCycle : distribuerCycle)(ctx.rng || Math.random, n);
  for (let k = 0; k < longueurCycle(n); k++) {
    for (let s = 0; s < n; s++) {
      tx.creer(chemins.donne(id, donne + k, s), { donne: donne + k, siege: s, cartes: cycle[k][s] });
    }
  }
}

// ─── Création, invitations, salle d'attente ────────────────────────────────

/** Crée une partie ; le créateur prend le siège 0. → { id, code } */
export async function creerPartie(ctx, { nom, cinqAdverse, nbJoueurs } = {}) {
  if (nbJoueurs !== undefined && nbJoueurs !== null && nbJoueurs !== 3 && nbJoueurs !== 4) {
    throw new ErreurToc('Une partie se joue à 3 ou à 4.');
  }
  const nb = nbJoueurs === 3 ? 3 : 4;
  for (let essai = 0; essai < 5; essai++) {
    const code = nouveauCode(ctx.rng || Math.random);
    try {
      await transaction(ctx, async (tx) => {
        if (await tx.lire(chemins.partie(code))) throw new ErreurToc('Code déjà pris.', 'toc/code-pris');
        const pseudo = await lirePseudo(tx, ctx.uid);
        const n = String(nom ?? '').trim().slice(0, NOM_MAX) || `Partie de ${pseudo}`;
        const t = ctx.magasin.horodatage();
        tx.creer(chemins.partie(code), {
          nom: n,
          code,
          hote: ctx.uid,
          statut: 'attente',
          reglages: reglagesPartie(cinqAdverse, nb),
          joueurs: [{ uid: ctx.uid, pseudo, ia: false }].concat(Array(nb - 1).fill(null)),
          uids: [ctx.uid],
          invites: [],
          pseudosInvites: {},
          refus: [],
          historique: [],
          enAttente: [],
          creeLe: t,
          majLe: t,
        });
      });
      return { id: code, code };
    } catch (e) {
      // Code déjà utilisé (lisible ou non) : on en tire un autre.
      if (e.code === 'toc/code-pris' || e.cause?.code === 'permission-denied') continue;
      throw e;
    }
  }
  throw new ErreurToc('Impossible de créer la partie, réessaie.');
}

/** Entre dans une partie en attente (premier siège libre). Déjà membre : rien à faire. */
async function entrer(ctx, id) {
  try {
    await entrerTransaction(ctx, id);
  } catch (e) {
    // Partie en cours dont on n'est pas membre : les règles en refusent la lecture.
    if (e.cause?.code === 'permission-denied') throw new ErreurToc('La partie a déjà commencé.');
    throw e;
  }
  return { id };
}

async function entrerTransaction(ctx, id) {
  await transaction(ctx, async (tx) => {
    const p = await lirePartie(tx, id);
    if (siegeDe(p, ctx.uid) >= 0) return;
    exigerAttente(p);
    const libre = p.joueurs.findIndex((x) => x === null);
    if (libre < 0) throw new ErreurToc(`La partie est complète (${p.joueurs.length} joueurs).`);
    const pseudo = await lirePseudo(tx, ctx.uid);
    const joueurs = p.joueurs.slice();
    joueurs[libre] = { uid: ctx.uid, pseudo, ia: false };
    const champs = { joueurs, uids: p.uids.concat([ctx.uid]), majLe: ctx.magasin.horodatage() };
    if ((p.invites || []).includes(ctx.uid)) champs.invites = p.invites.filter((u) => u !== ctx.uid);
    tx.maj(chemins.partie(id), champs);
  });
}

/** Rejoint une partie en attente avec son code d'invitation. → { id } */
export async function rejoindrePartie(ctx, code) {
  const id = normaliserCode(code);
  if (!codeValide(id)) throw new ErreurToc("Code d'invitation invalide.");
  try {
    return await entrer(ctx, id);
  } catch (e) {
    if (e.code === 'not-found') throw new ErreurToc('Aucune partie avec ce code.', 'not-found');
    throw e;
  }
}

/** Accepte une invitation reçue (premier siège libre). */
export async function accepterInvitation(ctx, id) {
  await entrer(ctx, id);
}

/**
 * Transaction sur une salle d'attente ouverte à tous : `fn(tx, partie | null)`. Si la lecture même est
 * refusée, c'est que la partie a commencé sans nous (les règles ne la montrent plus qu'à ses membres) ;
 * un refus de l'écriture, lui, reste un refus (règles Firestore pas à jour, par exemple).
 */
async function transactionSalle(ctx, id, fn) {
  let lue = false;
  try {
    return await transaction(ctx, async (tx) => {
      lue = false;
      const p = await tx.lire(chemins.partie(id));
      lue = true;
      return fn(tx, p);
    });
  } catch (e) {
    if (!lue && e.cause?.code === 'permission-denied') throw new ErreurToc('La partie a déjà commencé.');
    throw e;
  }
}

const PARTIE_ABSENTE = "Cette partie n'existe plus.";

/**
 * Salle d'attente : s'assoit sur un siège libre. Qui n'est pas encore dans la partie y entre (invité ou
 * non : une salle d'attente est ouverte à tous) ; qui y est déjà change de siège.
 */
export async function choisirSiege(ctx, id, siege) {
  exigerSiege(siege);
  await transactionSalle(ctx, id, async (tx, p) => {
    if (!p) throw new ErreurToc(PARTIE_ABSENTE, 'not-found');
    exigerSiege(siege, p);
    exigerAttente(p);
    const actuel = siegeDe(p, ctx.uid);
    if (actuel === siege) return;
    if (p.joueurs[siege] !== null) throw new ErreurToc('Ce siège est déjà pris.');
    const pseudo = await lirePseudo(tx, ctx.uid);
    const joueurs = p.joueurs.slice();
    const champs = { joueurs, majLe: ctx.magasin.horodatage() };
    if (actuel >= 0) joueurs[actuel] = null;
    else {
      champs.uids = p.uids.concat([ctx.uid]);
      if ((p.invites || []).includes(ctx.uid)) champs.invites = p.invites.filter((u) => u !== ctx.uid);
    }
    // Qui change de siège garde la couleur qu'il avait choisie.
    joueurs[siege] = { uid: ctx.uid, pseudo, ia: false, ...(actuel >= 0 ? couleurChoisie(p.joueurs[actuel]) : {}) };
    tx.maj(chemins.partie(id), champs);
  });
}

/**
 * Salle d'attente : choisit la couleur des pions d'une place dans la palette. Sans `siege` : la sienne (il faut
 * être assis). Avec `siege` : celle de cette place, tenue par une IA ou par un autre joueur ; comme le reste de la
 * salle, c'est ouvert à tout joueur connecté. Une couleur choisie pour une autre place est prise ; celle qu'une
 * place a reçue d'office (une IA sans choix, par exemple) se choisit : cette place en recevra une autre.
 */
export async function choisirCouleur(ctx, id, couleur, siege) {
  if (!couleurValide(couleur)) throw new ErreurToc('Couleur inconnue.');
  if (siege !== undefined && siege !== null) exigerSiege(siege);
  await transactionSalle(ctx, id, async (tx, p) => {
    if (!p) throw new ErreurToc(PARTIE_ABSENTE, 'not-found');
    exigerAttente(p);
    const mien = siegeDe(p, ctx.uid);
    const cible = siege ?? mien;
    if (cible < 0) throw new ErreurToc('Assieds-toi d’abord à une place.');
    exigerSiege(cible, p);
    const place = p.joueurs[cible];
    if (!place) throw new ErreurToc('Il n’y a personne à cette place.');
    if (place.couleur === couleur) return;
    if (couleursIndisponibles(p.joueurs, cible).includes(couleur)) throw new ErreurToc('Cette couleur est déjà prise.');
    const joueurs = p.joueurs.slice();
    // Sa propre place se réécrit avec le pseudo de sa fiche ; celle d'un autre garde tout, sauf la couleur.
    joueurs[cible] = cible === mien ? { uid: ctx.uid, pseudo: await lirePseudo(tx, ctx.uid), ia: false, couleur } : { ...place, couleur };
    tx.maj(chemins.partie(id), { joueurs, majLe: ctx.magasin.horodatage() });
  });
}

/** Salle d'attente : active ou désactive la règle du « 5 adverse » (voir modifierSalle). */
export async function reglerCinqAdverse(ctx, id, actif) {
  return modifierSalle(ctx, id, { cinqAdverse: !!actif });
}

/** Supprime une salle d'attente. Ouvert à tout joueur connecté ; une partie lancée ne se supprime plus. */
export async function supprimerPartie(ctx, id) {
  await transactionSalle(ctx, id, async (tx, p) => {
    if (!p) return;
    if (p.statut !== 'attente') throw new ErreurToc('La partie a commencé : on ne peut plus la supprimer.');
    tx.supprimer(chemins.partie(id));
  });
}

/** Nom d'une IA d'après son siège (il change si elle change de siège quand le mode change). */
const nomIA = (siege, nb) => (nb === 3 ? NOMS_IA_3 : NOMS_IA)[siege];

/** Salle d'attente : place une IA sur un siège libre, avec son niveau de force (absent : champion). Ouvert à tous. */
export async function ajouterIA(ctx, id, siege, niveau) {
  exigerSiege(siege);
  const n = verifierNiveau(niveau);
  await transactionSalle(ctx, id, async (tx, p) => {
    if (!p) throw new ErreurToc(PARTIE_ABSENTE, 'not-found');
    exigerSiege(siege, p);
    exigerAttente(p);
    if (p.joueurs[siege] !== null) throw new ErreurToc('Ce siège est déjà pris.');
    const joueurs = p.joueurs.slice();
    joueurs[siege] = { uid: null, pseudo: nomIA(siege, p.joueurs.length), ia: true, niveau: n };
    tx.maj(chemins.partie(id), { joueurs, majLe: ctx.magasin.horodatage() });
  });
}

/** Salle d'attente : change le niveau d'une IA déjà placée. Ouvert à tous. */
export async function changerNiveauIA(ctx, id, siege, niveau) {
  exigerSiege(siege);
  const n = verifierNiveau(niveau);
  await transactionSalle(ctx, id, async (tx, p) => {
    if (!p) throw new ErreurToc(PARTIE_ABSENTE, 'not-found');
    exigerSiege(siege, p);
    exigerAttente(p);
    const place = p.joueurs[siege];
    if (!place?.ia) throw new ErreurToc("Ce siège n'est pas tenu par une IA.");
    if (place.niveau === n) return;
    const joueurs = p.joueurs.slice();
    joueurs[siege] = { uid: null, pseudo: place.pseudo, ia: true, niveau: n, ...couleurChoisie(place) };
    tx.maj(chemins.partie(id), { joueurs, majLe: ctx.magasin.horodatage() });
  });
}

/** Salle d'attente : retire une IA. Ouvert à tous. */
export async function retirerIA(ctx, id, siege) {
  exigerSiege(siege);
  await transactionSalle(ctx, id, async (tx, p) => {
    if (!p) throw new ErreurToc(PARTIE_ABSENTE, 'not-found');
    exigerSiege(siege, p);
    exigerAttente(p);
    if (!p.joueurs[siege]?.ia) throw new ErreurToc("Ce siège n'est pas tenu par une IA.");
    const joueurs = p.joueurs.slice();
    joueurs[siege] = null;
    tx.maj(chemins.partie(id), { joueurs, majLe: ctx.magasin.horodatage() });
  });
}

/**
 * Salle d'attente : change le nom de la partie, le mode (nbJoueurs : 3 ou 4) ou la règle du « 5 adverse ».
 * Ouvert à tout joueur connecté. Changer de mode garde tout le monde à table : de 4 à 3, les places occupées se
 * resserrent sur trois sièges (il faut donc une place libre) ; de 3 à 4, une place libre s'ajoute.
 */
export async function modifierSalle(ctx, id, { nom, nbJoueurs, cinqAdverse } = {}) {
  if (nbJoueurs !== undefined && nbJoueurs !== 3 && nbJoueurs !== 4) throw new ErreurToc('Une partie se joue à 3 ou à 4.');
  const nomVoulu = nom === undefined ? undefined : String(nom ?? '').trim().slice(0, NOM_MAX);
  if (nomVoulu === '') throw new ErreurToc('Donne un nom à la partie.');
  await transactionSalle(ctx, id, async (tx, p) => {
    if (!p) throw new ErreurToc(PARTIE_ABSENTE, 'not-found');
    exigerAttente(p);
    const avant = nbJoueursDe(p.reglages);
    const nb = nbJoueurs ?? avant;
    const cinq = cinqAdverse === undefined ? !!p.reglages?.cinqAdverse : !!cinqAdverse;
    const champs = {};
    if (nomVoulu !== undefined && nomVoulu !== p.nom) champs.nom = nomVoulu;
    if (nb !== avant || cinq !== !!p.reglages?.cinqAdverse) champs.reglages = reglagesPartie(cinq, nb);
    if (nb !== avant) {
      const occupees = p.joueurs.filter((x) => x !== null);
      if (occupees.length > nb) throw new ErreurToc('La table est pleine : libère une place pour passer à 3 joueurs.');
      // Les places occupées gardent leur ordre ; une IA prend le nom de son nouveau siège.
      champs.joueurs = occupees.concat(Array(nb - occupees.length).fill(null)).map((x, s) => (x?.ia ? { ...x, pseudo: nomIA(s, nb) } : x));
    }
    if (!Object.keys(champs).length) return;
    tx.maj(chemins.partie(id), { ...champs, majLe: ctx.magasin.horodatage() });
  });
}

/**
 * Quitte une salle d'attente (le créateur comme les autres : la salle reste à ceux qui y sont). Le dernier joueur
 * à partir emporte la salle : elle est supprimée.
 */
export async function quitterPartie(ctx, id) {
  await transaction(ctx, async (tx) => {
    const p = await tx.lire(chemins.partie(id));
    if (!p) return;
    const s = siegeDe(p, ctx.uid);
    if (s < 0) return;
    if (p.statut !== 'attente') throw new ErreurToc('La partie a commencé : on ne peut plus la quitter.');
    const uids = p.uids.filter((u) => u !== ctx.uid);
    if (!uids.length) {
      tx.supprimer(chemins.partie(id));
      return;
    }
    const joueurs = p.joueurs.slice();
    joueurs[s] = null;
    tx.maj(chemins.partie(id), { joueurs, uids, majLe: ctx.magasin.horodatage() });
  });
}

/** Salle d'attente : invite un joueur (il voit l'invitation dans l'appli). Ouvert à tous. */
export async function inviter(ctx, id, uid) {
  if (typeof uid !== 'string' || !uid) throw new ErreurToc('Joueur invalide.');
  await transactionSalle(ctx, id, async (tx, p) => {
    if (!p) throw new ErreurToc(PARTIE_ABSENTE, 'not-found');
    exigerAttente(p);
    if (p.uids.includes(uid)) throw new ErreurToc('Ce joueur est déjà dans la partie.');
    const invites = p.invites || [];
    if (invites.includes(uid)) return;
    if (invites.length >= MAX_INVITES) throw new ErreurToc('Trop d’invitations en cours pour cette partie.');
    const fiche = await tx.lire(chemins.joueur(uid));
    if (!fiche) throw new ErreurToc('Ce joueur n’existe pas.');
    tx.maj(chemins.partie(id), {
      invites: invites.concat([uid]),
      pseudosInvites: { ...(p.pseudosInvites || {}), [uid]: fiche.pseudo },
      refus: (p.refus || []).filter((u) => u !== uid),
      majLe: ctx.magasin.horodatage(),
    });
  });
}

/** Salle d'attente : retire une invitation (ou efface un refus). Ouvert à tous. */
export async function annulerInvitation(ctx, id, uid) {
  await transactionSalle(ctx, id, async (tx, p) => {
    if (!p) throw new ErreurToc(PARTIE_ABSENTE, 'not-found');
    exigerAttente(p);
    const pseudosInvites = { ...(p.pseudosInvites || {}) };
    delete pseudosInvites[uid];
    tx.maj(chemins.partie(id), {
      invites: (p.invites || []).filter((u) => u !== uid),
      pseudosInvites,
      refus: (p.refus || []).filter((u) => u !== uid),
      majLe: ctx.magasin.horodatage(),
    });
  });
}

/** Refuse une invitation reçue : l'hôte le voit (refus), la partie reste ouverte. */
export async function refuserInvitation(ctx, id) {
  await transaction(ctx, async (tx) => {
    const p = await tx.lire(chemins.partie(id));
    if (!p || p.statut !== 'attente' || !(p.invites || []).includes(ctx.uid)) return;
    tx.maj(chemins.partie(id), {
      invites: p.invites.filter((u) => u !== ctx.uid),
      refus: (p.refus || []).filter((u) => u !== ctx.uid).concat([ctx.uid]),
      majLe: ctx.magasin.horodatage(),
    });
  });
}

/** Lance la partie (tous les sièges occupés) et distribue le premier cycle. Ouvert à tout joueur assis à la table. */
export async function lancerPartie(ctx, id) {
  await transactionSalle(ctx, id, async (tx, p) => {
    if (!p) throw new ErreurToc(PARTIE_ABSENTE, 'not-found');
    exigerAttente(p);
    if (siegeDe(p, ctx.uid) < 0) throw new ErreurToc('Assieds-toi à la table pour lancer la partie.');
    const n = nbJoueursDe(p.reglages);
    if (p.joueurs.some((x) => x === null)) {
      throw new ErreurToc(`Il faut ${n === 3 ? 'trois' : 'quatre'} joueurs (ou IA) pour lancer la partie.`);
    }
    const etat = etatInitial(reglagesPartie(p.reglages?.cinqAdverse, n));
    ecrireCycle(ctx, tx, id, 0, n);
    tx.maj(chemins.partie(id), {
      statut: 'encours',
      etat,
      historique: [],
      enAttente: calculerEnAttente(etat, p.joueurs),
      invites: [],
      majLe: ctx.magasin.horodatage(),
    });
  });
}

// ─── Abandon d'une partie en cours, d'un commun accord ─────────────────────

/**
 * Vote pour abandonner une partie en cours. `accepte` true : je propose l'abandon, ou j'accepte celui qu'un autre
 * a proposé ; false : je refuse (ou je retire ma proposition), et la proposition tombe. Quand tous les joueurs
 * humains de la partie ont accepté, elle est abandonnée : elle disparaît des listes et ne compte pas dans les
 * statistiques (seules les parties terminées comptent).
 * @returns {Promise<{ abandonnee: boolean }>}
 */
export async function voterAbandon(ctx, id, accepte) {
  return transaction(ctx, async (tx) => {
    const p = await lirePartie(tx, id);
    if (siegeDe(p, ctx.uid) < 0) throw new ErreurToc('Tu ne joues pas dans cette partie.');
    if (p.statut === 'abandonnee') return { abandonnee: true };
    if (p.statut !== 'encours') throw new ErreurToc(p.statut === 'finie' ? 'La partie est terminée.' : "La partie n'a pas commencé.");
    const votes = p.abandon || [];
    if (!accepte) {
      if (votes.length) tx.maj(chemins.partie(id), { abandon: [], majLe: ctx.magasin.horodatage() });
      return { abandonnee: false };
    }
    if (votes.includes(ctx.uid)) return { abandonnee: false };
    const abandon = votes.concat([ctx.uid]);
    const abandonnee = p.uids.every((u) => abandon.includes(u));
    tx.maj(chemins.partie(id), { abandon, statut: abandonnee ? 'abandonnee' : 'encours', majLe: ctx.magasin.horodatage() });
    return { abandonnee };
  });
}

// ─── Mains privées ─────────────────────────────────────────────────────────

/**
 * Lecteur des documents immuables (donnes, dons) avec cache : un document existant ne change
 * jamais, on peut donc le garder. Les absents ne sont pas gardés (ils peuvent apparaître).
 */
export function creerLecteurMains(magasin, id) {
  const cache = new Map();
  return async function lire(chemin, tx) {
    if (cache.has(chemin)) return cache.get(chemin);
    const d = tx ? await tx.lire(chemin) : await magasin.lire(chemin);
    if (d) cache.set(chemin, d);
    return d;
  };
}

/**
 * Données privées d'un siège pour l'état donné :
 * { distribuees, don, recu, main } (recu = null tant que l'échange n'est pas fini).
 */
export async function chargerMain(lire, id, etat, siege, tx) {
  const d = etat.donne;
  const n = nombreJoueurs(etat);
  const donne = await lire(chemins.donne(id, d, siege), tx);
  if (!donne) throw new ErreurToc('Cartes introuvables pour cette donne.');
  const don = etat.echanges[siege] ? (await lire(chemins.don(id, d, siege), tx))?.carte ?? null : null;
  // Carte reçue : du partenaire à 4, du voisin de la donne à 3 (donneurDon).
  const recu = etat.phase !== 'echange' ? (await lire(chemins.don(id, d, donneurDon(d, siege, n)), tx))?.carte ?? null : null;
  return { distribuees: donne.cartes, don, recu, main: mainEffective(donne.cartes, don, recu, etat.pile) };
}

// ─── Échange et coups ──────────────────────────────────────────────────────

function verifierActeur(ctx, p, siege, numCoupAttendu) {
  // IA : si la partie a avancé (ou s'est terminée) entre-temps, un autre client a agi.
  if (numCoupAttendu !== undefined && (p.statut !== 'encours' || p.etat?.numCoup !== numCoupAttendu)) throw new ConflitIA();
  if (p.statut !== 'encours') throw new ErreurToc(p.statut === 'finie' ? 'La partie est terminée.' : "La partie n'a pas commencé.");
  const place = p.joueurs[siege];
  const ia = !!place?.ia;
  if (!ia && place?.uid !== ctx.uid) throw new ErreurToc("Tu ne joues pas à cette place.");
  return ia;
}

/**
 * Donne une carte au partenaire (phase d'échange) pour le siège `siege` (le sien, ou une IA).
 * `choisir(main, etat)` peut remplacer `carte` (IA : choix sur la main lue dans la transaction).
 * @param numCoupAttendu  pour une IA : l'action est abandonnée (ConflitIA) si la partie a avancé
 * @returns {Promise<number>} numCoup après l'action
 */
export async function donnerCarte(ctx, id, siege, carte, { lire, numCoupAttendu } = {}) {
  const lecteur = lire || creerLecteurMains(ctx.magasin, id);
  return transaction(ctx, async (tx) => {
    const p = await lirePartie(tx, id);
    const ia = verifierActeur(ctx, p, siege, numCoupAttendu);
    const etat = p.etat;
    if (etat.phase !== 'echange') throw ia ? new ConflitIA() : new ErreurToc("Ce n'est pas le moment d'échanger une carte.");
    if (etat.echanges[siege]) throw ia ? new ConflitIA() : new ErreurToc('Tu as déjà donné ta carte.');
    const { main } = await chargerMain(lecteur, id, etat, siege, tx);
    const c = typeof carte === 'function' ? carte(main, etat) : carte;
    if (!main.includes(c)) throw new ErreurToc("Cette carte n'est pas dans ta main.");
    const nouvel = marquerEchange(etat, siege);
    const pour = destinataireDon(etat.donne, siege, nombreJoueurs(etat));
    tx.creer(chemins.don(id, etat.donne, siege), { donne: etat.donne, de: siege, pour, carte: c });
    tx.maj(chemins.partie(id), {
      etat: nouvel,
      enAttente: calculerEnAttente(nouvel, p.joueurs),
      majLe: ctx.magasin.horodatage(),
    });
    return nouvel.numCoup;
  });
}

/**
 * Joue un coup pour le siège `siege` (le sien, ou une IA). `coup` peut être une fonction
 * (main, etat, privé) → coup, évaluée dans la transaction.
 * @returns {Promise<number>} numCoup après le coup
 */
export async function jouerCoup(ctx, id, siege, coup, { lire, numCoupAttendu } = {}) {
  const lecteur = lire || creerLecteurMains(ctx.magasin, id);
  return transaction(ctx, async (tx) => {
    const p = await lirePartie(tx, id);
    const ia = verifierActeur(ctx, p, siege, numCoupAttendu);
    const etat = p.etat;
    if (etat.phase !== 'jeu' || etat.tour !== siege) {
      throw ia ? new ConflitIA() : new ErreurToc("Ce n'est pas ton tour.");
    }
    const prive = await chargerMain(lecteur, id, etat, siege, tx);
    const c = copie(typeof coup === 'function' ? coup(prive.main, etat, prive) : coup);
    const nouvel = appliquerCoup(etat, siege, c, prive.main); // lève une Error en français si illégal
    const historique = (p.historique || []).concat([
      // Coup normalisé par le moteur : l'historique permet de rejouer la partie à l'identique.
      { n: nouvel.numCoup, siege, coup: nouvel.dernierCoup.coup, captures: nouvel.dernierCoup.captures },
    ]);
    const n = nombreJoueurs(etat);
    if (nouvel.phase !== 'fini' && nouvel.donne !== etat.donne && nouvel.donne % longueurCycle(n) === 0) {
      ecrireCycle(ctx, tx, id, nouvel.donne, n); // paquet épuisé : on remélange
    }
    tx.maj(chemins.partie(id), {
      etat: nouvel,
      historique,
      enAttente: calculerEnAttente(nouvel, p.joueurs),
      statut: nouvel.phase === 'fini' ? 'finie' : 'encours',
      majLe: ctx.magasin.horodatage(),
    });
    return nouvel.numCoup;
  });
}
