// Couche réseau (Firebase Authentication + Firestore).
//
// CE FICHIER EST LE CONTRAT entre l'interface (js/ui) et le réseau : l'interface n'importe
// que ce module et n'appelle jamais Firebase directement. Les signatures ci-dessous sont
// figées ; l'implémentation est répartie dans les autres fichiers de ce dossier
// (client.js, comptes.js, parties.js, session-reseau.js, firebase.js).
//
// Toutes les fonctions asynchrones rejettent avec une Error dont le `message` est en
// français et affichable tel quel à l'utilisateur.
//
// Comptes : un simple nom d'utilisateur, sans mot de passe (même modèle que l'appli Scrabble).
// Le nom n'est pas secret : qui le connaît ouvre le compte (voir docs/firebase.md).
//
// Types :
//   Joueur      = { uid, pseudo, icone, visible, verrouille, stats: { jouees, gagnees }, enCoursIA: { 3, 4 } }
//                 enCoursIA[nb] : date (ms) de la partie contre l'IA en cours que le compte garde pour ce
//                 mode (0 : aucune), voir ecrirePartieIAEnCours ;
//                 icone : identifiant court d'un emoji du catalogue de l'interface, ou null ;
//                 visible : accepte d'être trouvé par les autres joueurs ;
//                 verrouille : pseudo imposé par l'administrateur (non modifiable)
//   Place       = { uid, pseudo, ia } | null          (ia = true : place tenue par une IA, uid = null)
//                 une IA a aussi `niveau` : 'debutant' | 'amateur' | 'confirme' | 'expert' | 'champion'
//                 (NIVEAUX de js/ia/ia.js ; place d'une partie ancienne sans niveau : 'champion')
//   ResumePartie = {
//     id, nom, code,     id === code (le code d'invitation identifie la partie)
//     statut,            'attente' | 'encours' | 'finie' | 'abandonnee' (abandonnée d'un commun accord : elle
//                        n'est plus listée et ne compte pas dans les statistiques)
//     hote,              uid du créateur (il n'a aucun droit de plus que les autres joueurs)
//     reglages,          { cinqAdverse } à 4 joueurs, { cinqAdverse, nbJoueurs: 3 } à 3
//                        (cinqAdverse se change en salle d'attente, voir reglerCinqAdverse)
//     nbJoueurs,         3 ou 4
//     joueurs,           Place[nbJoueurs], indexé par siège (à 4 : 0 et 2 contre 1 et 3 ;
//                        à 3 : chacun pour soi)
//     monSiege,          siège de l'utilisateur connecté (ou -1 : salle où il n'est pas assis, partie qu'il regarde)
//     aMoiDeJouer,       true si la partie attend une action de l'utilisateur
//                        (carte à donner pendant l'échange, ou coup à jouer)
//     gagnant,           null | équipe 0 ou 1 à 4 joueurs | siège 0, 1 ou 2 à 3 joueurs (etat.gagnant)
//     gagnants,          sièges gagnants ([] tant que la partie n'est pas finie)
//     majLe,             Date de la dernière action
//     invites,           [{ uid, pseudo }] joueurs invités directement (partie en attente)
//     refus,             [{ uid, pseudo }] invités qui ont refusé
//     abandon,           null, ou la proposition d'abandon d'une partie en cours :
//                        { pour: [{ uid, pseudo }], attendus: [{ uid, pseudo }], jAiAccepte } (voir voterAbandon)
//   }

import { firebaseConfig } from '../firebase-config.js';
import { choisirCoup, choisirDon } from '../ia/ia.js';
import { choisirCoup3, choisirDon3 } from '../ia/ia3.js';
import { creerClient } from './client.js';

/** Firebase est-il configuré (js/firebase-config.js rempli) ? Sinon : mode hors ligne seulement. */
export function reseauDisponible() {
  return !!(firebaseConfig && firebaseConfig.apiKey);
}

// Le SDK n'est téléchargé qu'au premier appel, et seulement si Firebase est configuré.
const client = creerClient({
  services: async () => {
    if (!reseauDisponible()) throw new Error('Réseau non configuré.');
    const { demarrer } = await import('./firebase.js');
    return demarrer(firebaseConfig);
  },
  ia: { choisirDon, choisirCoup, choisirDon3, choisirCoup3 },
});

const nonConfigure = () => Promise.reject(new Error('Réseau non configuré.'));

// ─── Comptes ────────────────────────────────────────────────────────────────

/** Écoute l'état de connexion. cb(Joueur | null), rappelé aussi quand la fiche change. Renvoie le désabonnement. */
export function surAuth(cb) {
  if (!reseauDisponible()) {
    cb(null);
    return () => {};
  }
  return client.surAuth(cb);
}

/** Se connecte avec ce nom ; le compte (et la fiche) sont créés la première fois. → Joueur */
export async function connecter(pseudo) {
  if (!reseauDisponible()) return nonConfigure();
  return client.connecter(pseudo);
}

export async function deconnecter() {
  if (!reseauDisponible()) return;
  return client.deconnecter();
}

/**
 * Modifie sa fiche : { pseudo, icone, visible }, champs facultatifs (icone null l'efface).
 * Refusé si le pseudo est verrouillé. Le pseudo affiché change, le nom de connexion non. → Joueur
 */
export async function modifierProfil(changements) {
  if (!reseauDisponible()) return nonConfigure();
  return client.modifierProfil(changements);
}

/**
 * Parties contre l'IA : elles se jouent hors ligne, sur l'appareil ; le compte en garde l'historique pour qu'il
 * suive d'un appareil à l'autre. Verse celui de cet appareil dans celui du compte et renvoie le tout, fusionné.
 *   local = { parties: [RésuméIA…], retirees: [id…] } → { parties: [RésuméIA…], retirees: [id…] }
 *   RésuméIA = { id, date (ms), nb, gagne, gagnants, joueurs: [{ pseudo, ia, niveau }], donnes, coups, cinqAdverse }
 *   retirees : parties retirées de l'historique (elles ne reviennent sur aucun appareil).
 * Le résultat a aussi `completes: [id…]` : les parties que le compte garde en entier (ecrirePartieIAFinie).
 */
export async function synchroniserPartiesIA(local) {
  if (!reseauDisponible()) return nonConfigure();
  return client.synchroniserPartiesIA(local);
}

/**
 * Garde en entier une partie contre l'IA terminée (json : sa sauvegarde { nom, joueurs, partie } en texte), pour
 * l'analyser depuis un autre appareil. La partie doit être dans l'historique du compte ; seules les 12 plus
 * récentes sont gardées. → { completes: [id…] }
 */
export async function ecrirePartieIAFinie(id, json) {
  if (!reseauDisponible()) return nonConfigure();
  return client.ecrirePartieIAFinie(id, json);
}

/** Sauvegarde (texte JSON) d'une partie terminée gardée en entier par le compte, ou null. */
export async function lirePartieIAFinie(id) {
  if (!reseauDisponible()) return null;
  return client.lirePartieIAFinie(id);
}

/**
 * Garde la partie contre l'IA en cours du mode nb (3 ou 4) : json = sa sauvegarde en texte, date = sa dernière
 * modification sur l'appareil (ms). Une seule par mode, la plus récemment jouée : plus ancienne que celle du
 * compte, elle n'est pas écrite. La date arrive dans Joueur.enCoursIA sur tous les appareils. → { ecrit }
 */
export async function ecrirePartieIAEnCours(nb, json, date) {
  if (!reseauDisponible()) return nonConfigure();
  return client.ecrirePartieIAEnCours(nb, json, date);
}

/** Partie contre l'IA en cours gardée par le compte pour ce mode → { json, date } | null */
export async function lirePartieIAEnCours(nb) {
  if (!reseauDisponible()) return null;
  return client.lirePartieIAEnCours(nb);
}

/** Fiche publique d'un joueur (avec cache) → { uid, pseudo, icone } | null */
export async function lireJoueur(uid) {
  if (!reseauDisponible()) return null;
  return client.lireJoueur(uid);
}

/**
 * Joueurs à qui proposer une invitation → [{ uid, pseudo, icone }] : ceux avec qui j'ai déjà joué
 * en tête, puis les joueurs visibles ; moi exclu ; 100 au plus. Demande une connexion.
 */
export async function listerJoueurs() {
  if (!reseauDisponible()) return [];
  return client.listerJoueurs();
}

// ─── Parties : liste, création, invitation ──────────────────────────────────

/**
 * Écoute les parties de l'utilisateur connecté (en attente, en cours, terminées récentes),
 * triées de la plus récente à la plus ancienne. cb(ResumePartie[]). Renvoie le désabonnement.
 */
export function surMesParties(cb) {
  if (!reseauDisponible()) {
    cb([]);
    return () => {};
  }
  return client.surMesParties(cb);
}

/**
 * Crée une partie (le créateur prend le siège 0). nbJoueurs : 4 (défaut, deux équipes) ou 3
 * (chacun pour soi). → { id, code }
 */
export async function creerPartie({ nom, cinqAdverse, nbJoueurs } = {}) {
  if (!reseauDisponible()) return nonConfigure();
  return client.creerPartie({ nom, cinqAdverse, nbJoueurs });
}

/**
 * Rejoint une partie en attente avec son code d'invitation (premier siège libre). → { id }
 * Partie déjà en cours : on ne s'y assoit plus, mais on peut la regarder → { id, spectateur: true }.
 */
export async function rejoindrePartie(code) {
  if (!reseauDisponible()) return nonConfigure();
  return client.rejoindrePartie(code);
}

/**
 * Écoute une partie (salle d'attente, partie en cours ou terminée ; la sienne ou celle des autres, qu'on regarde).
 * cb(ResumePartie | null). Renvoie le désabonnement.
 */
export function surPartie(id, cb) {
  if (!reseauDisponible()) {
    cb(null);
    return () => {};
  }
  return client.surPartie(id, cb);
}

/**
 * Écoute les salles d'attente ouvertes (toutes les parties pas encore lancées, les miennes comprises ; 50 au
 * plus), de la plus récente à la plus ancienne : une salle d'attente est ouverte à tous, invité ou non.
 * cb(ResumePartie[]). Renvoie le désabonnement.
 */
export function surSallesAttente(cb) {
  if (!reseauDisponible()) {
    cb([]);
    return () => {};
  }
  return client.surSallesAttente(cb);
}

/**
 * Écoute les parties en cours (toutes, les miennes comprises ; 50 au plus), de la plus récemment jouée à la plus
 * ancienne : tout joueur connecté peut regarder une partie en cours sans y jouer (voir ouvrirSession).
 * cb(ResumePartie[]) ; monSiege vaut -1 pour les parties des autres. Renvoie le désabonnement.
 */
export function surPartiesEnCours(cb) {
  if (!reseauDisponible()) {
    cb([]);
    return () => {};
  }
  return client.surPartiesEnCours(cb);
}

/**
 * Salle d'attente : s'assoit sur ce siège (qui doit être libre). Qui n'est pas encore dans la partie y entre,
 * invité ou non ; qui y est déjà change de siège.
 */
export async function choisirSiege(id, siege) {
  if (!reseauDisponible()) return nonConfigure();
  return client.choisirSiege(id, siege);
}

/**
 * Salle d'attente : choisit la couleur des pions (identifiant de la palette, voir js/palette.js) : les siens, ou
 * avec `siege` ceux de cette place (une IA, un autre joueur ; tout joueur connecté). Refusé si la couleur a déjà
 * été choisie pour une autre place.
 */
export async function choisirCouleur(id, couleur, siege) {
  if (!reseauDisponible()) return nonConfigure();
  return client.choisirCouleur(id, couleur, siege);
}

/**
 * Salle d'attente, tout joueur connecté : place une IA sur un siège libre / la retire. niveau : un des id de NIVEAUX (js/ia/ia.js),
 * facultatif (défaut 'champion') ; un niveau inconnu est refusé.
 */
export async function ajouterIA(id, siege, niveau) {
  if (!reseauDisponible()) return nonConfigure();
  return client.ajouterIA(id, siege, niveau);
}

/** Salle d'attente, tout joueur connecté : change le niveau de l'IA placée sur ce siège. */
export async function changerNiveauIA(id, siege, niveau) {
  if (!reseauDisponible()) return nonConfigure();
  return client.changerNiveauIA(id, siege, niveau);
}
export async function retirerIA(id, siege) {
  if (!reseauDisponible()) return nonConfigure();
  return client.retirerIA(id, siege);
}

/** Salle d'attente : active ou désactive la règle du « 5 adverse ». Ouvert à tout joueur connecté. */
export async function reglerCinqAdverse(id, actif) {
  if (!reseauDisponible()) return nonConfigure();
  return client.reglerCinqAdverse(id, actif);
}

/**
 * Salle d'attente : change le nom de la partie, le mode ou la règle du 5. changements = { nom?, nbJoueurs?: 3 | 4,
 * cinqAdverse? }. Ouvert à tout joueur connecté. De 4 à 3 joueurs, il faut une place libre (les places occupées se
 * resserrent) ; de 3 à 4, une place libre s'ajoute.
 */
export async function modifierSalle(id, changements) {
  if (!reseauDisponible()) return nonConfigure();
  return client.modifierSalle(id, changements);
}

/**
 * Partie en cours : vote pour l'abandonner d'un commun accord. accepte = true : proposer l'abandon, ou accepter
 * celui qu'un autre joueur propose ; false : refuser (la proposition tombe). Quand tous les joueurs humains ont
 * accepté, la partie est abandonnée : elle disparaît et ne compte pas dans les statistiques. → { abandonnee }
 */
export async function voterAbandon(id, accepte) {
  if (!reseauDisponible()) return nonConfigure();
  return client.voterAbandon(id, accepte);
}

/** Supprime une salle d'attente (partie pas encore lancée). Ouvert à tout joueur connecté. */
export async function supprimerPartie(id) {
  if (!reseauDisponible()) return nonConfigure();
  return client.supprimerPartie(id);
}

/** Quitte une salle d'attente (le dernier joueur à partir la supprime). */
export async function quitterPartie(id) {
  if (!reseauDisponible()) return nonConfigure();
  return client.quitterPartie(id);
}

/** Tout joueur assis à la table : lance la partie. Tous les sièges (3 ou 4) doivent être occupés (humains ou IA). Distribue les cartes. */
export async function lancerPartie(id) {
  if (!reseauDisponible()) return nonConfigure();
  return client.lancerPartie(id);
}

// ─── Invitations directes (partie en attente) ──────────────────────────────

/** Salle d'attente, tout joueur connecté : invite un joueur (il voit l'invitation dans l'appli). */
export async function inviter(id, uid) {
  if (!reseauDisponible()) return nonConfigure();
  return client.inviter(id, uid);
}

/** Salle d'attente, tout joueur connecté : retire une invitation. */
export async function annulerInvitation(id, uid) {
  if (!reseauDisponible()) return nonConfigure();
  return client.annulerInvitation(id, uid);
}

/** Écoute les parties en attente où je suis invité. cb(ResumePartie[]). Renvoie le désabonnement. */
export function surInvitations(cb) {
  if (!reseauDisponible()) {
    cb([]);
    return () => {};
  }
  return client.surInvitations(cb);
}

/** Accepte une invitation : prend le premier siège libre. */
export async function accepterInvitation(id) {
  if (!reseauDisponible()) return nonConfigure();
  return client.accepterInvitation(id);
}

/** Refuse une invitation (l'hôte le voit dans `refus`). */
export async function refuserInvitation(id) {
  if (!reseauDisponible()) return nonConfigure();
  return client.refuserInvitation(id);
}

// ─── Jeu ────────────────────────────────────────────────────────────────────

/**
 * Ouvre une partie en cours (ou terminée) pour y jouer, ou pour la regarder si l'on n'y joue pas.
 * → Session, même interface que SessionLocale (voir js/session-locale.js) :
 *   abonner(cb), donner(carte), jouer(coup), fermer(), avec vue.enLigne = true
 *   (la vue a en plus `statut`), et donneesAnalyse() (analyse de fin de partie).
 *   vue.joueurs[s] = { pseudo, ia } et, pour une IA, `niveau` (transmis à l'IA qui joue ce siège).
 *   À 3 joueurs, `vue.recu` est la carte reçue du voisin de la donne (donneurDon).
 * La session fait aussi jouer les IA de la partie.
 * Spectateur (tout joueur connecté qui n'est pas assis à la table) : vue.spectateur = true, vue.siege = -1,
 *   aucune carte (main vide, don et recu null) ; donner(), jouer() et donneesAnalyse() sont refusés, et la
 *   session ne fait pas jouer les IA (elle ne lit aucune main).
 */
export async function ouvrirSession(id) {
  if (!reseauDisponible()) return nonConfigure();
  return client.ouvrirSession(id);
}
