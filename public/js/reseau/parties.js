// Parties en ligne : création, invitations, salle d'attente, lancement, échange de cartes et coups.
//
// Pas de Cloud Functions (offre gratuite Spark) : chaque action est une transaction Firestore côté
// client (lecture, validation par le moteur, écriture). Les règles (firestore.rules) vérifient ce
// qu'elles peuvent sans exécuter le moteur ; c'est un modèle de confiance « entre amis ».
//
//   parties/{code} = {
//     nom, code, hote, statut: 'attente'|'encours'|'finie', reglages: { cinqAdverse },
//     joueurs: [{ uid, pseudo, ia } | null] × 4 (par siège), uids: [uid…] (humains membres),
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
  nbJoueursDe,
  reglagesPartie,
  chemins,
  codeValide,
  nouveauCode,
  normaliserCode,
  siegeDe,
} from './commun.js';
import { transaction } from './outils.js';

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

function exigerHote(ctx, p) {
  if (p.hote !== ctx.uid) throw new ErreurToc("Seul le créateur de la partie peut le faire.");
}

function exigerSiege(siege, p) {
  if (!Number.isInteger(siege) || siege < 0 || siege >= (p ? p.joueurs.length : 4)) throw new ErreurToc('Siège invalide.');
}

/**
 * Écrit les mains d'un cycle, dans la transaction : 12 documents dans les deux modes
 * (3 donnes × 4 sièges à 4 joueurs, 4 donnes × 3 sièges à 3).
 */
function ecrireCycle(ctx, tx, id, donne, n) {
  const cycle = distribuerCycle(ctx.rng || Math.random, n);
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

export async function choisirSiege(ctx, id, siege) {
  exigerSiege(siege);
  await transaction(ctx, async (tx) => {
    const p = await lirePartie(tx, id);
    exigerSiege(siege, p);
    exigerAttente(p);
    const actuel = siegeDe(p, ctx.uid);
    if (actuel < 0) throw new ErreurToc('Tu ne participes pas à cette partie.');
    if (actuel === siege) return;
    if (p.joueurs[siege] !== null) throw new ErreurToc('Ce siège est déjà pris.');
    const pseudo = await lirePseudo(tx, ctx.uid);
    const joueurs = p.joueurs.slice();
    joueurs[actuel] = null;
    joueurs[siege] = { uid: ctx.uid, pseudo, ia: false };
    tx.maj(chemins.partie(id), { joueurs, majLe: ctx.magasin.horodatage() });
  });
}

export async function ajouterIA(ctx, id, siege) {
  exigerSiege(siege);
  await transaction(ctx, async (tx) => {
    const p = await lirePartie(tx, id);
    exigerSiege(siege, p);
    exigerAttente(p);
    exigerHote(ctx, p);
    if (p.joueurs[siege] !== null) throw new ErreurToc('Ce siège est déjà pris.');
    const joueurs = p.joueurs.slice();
    joueurs[siege] = { uid: null, pseudo: (p.joueurs.length === 3 ? NOMS_IA_3 : NOMS_IA)[siege], ia: true };
    tx.maj(chemins.partie(id), { joueurs, majLe: ctx.magasin.horodatage() });
  });
}

export async function retirerIA(ctx, id, siege) {
  exigerSiege(siege);
  await transaction(ctx, async (tx) => {
    const p = await lirePartie(tx, id);
    exigerSiege(siege, p);
    exigerAttente(p);
    exigerHote(ctx, p);
    if (!p.joueurs[siege]?.ia) throw new ErreurToc("Ce siège n'est pas tenu par une IA.");
    const joueurs = p.joueurs.slice();
    joueurs[siege] = null;
    tx.maj(chemins.partie(id), { joueurs, majLe: ctx.magasin.horodatage() });
  });
}

/** Quitte une partie en attente ; si l'hôte quitte, la partie est supprimée. */
export async function quitterPartie(ctx, id) {
  await transaction(ctx, async (tx) => {
    const p = await tx.lire(chemins.partie(id));
    if (!p) return;
    const s = siegeDe(p, ctx.uid);
    if (s < 0) return;
    if (p.statut !== 'attente') throw new ErreurToc('La partie a commencé : on ne peut plus la quitter.');
    if (p.hote === ctx.uid) {
      tx.supprimer(chemins.partie(id));
      return;
    }
    const joueurs = p.joueurs.slice();
    joueurs[s] = null;
    tx.maj(chemins.partie(id), { joueurs, uids: p.uids.filter((u) => u !== ctx.uid), majLe: ctx.magasin.horodatage() });
  });
}

/** Hôte : invite un joueur (il voit l'invitation dans l'appli). */
export async function inviter(ctx, id, uid) {
  if (typeof uid !== 'string' || !uid) throw new ErreurToc('Joueur invalide.');
  await transaction(ctx, async (tx) => {
    const p = await lirePartie(tx, id);
    exigerAttente(p);
    exigerHote(ctx, p);
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

/** Hôte : retire une invitation (ou efface un refus). */
export async function annulerInvitation(ctx, id, uid) {
  await transaction(ctx, async (tx) => {
    const p = await lirePartie(tx, id);
    exigerAttente(p);
    exigerHote(ctx, p);
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

/** Hôte : lance la partie (4 sièges occupés), distribue le premier cycle. */
export async function lancerPartie(ctx, id) {
  await transaction(ctx, async (tx) => {
    const p = await lirePartie(tx, id);
    exigerAttente(p);
    exigerHote(ctx, p);
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
