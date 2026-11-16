// Couche réseau (Firebase Authentication + Firestore).
//
// CE FICHIER EST LE CONTRAT entre l'interface (js/ui) et le réseau : l'interface n'importe
// que ce module et n'appelle jamais Firebase directement. Les signatures ci-dessous sont
// figées ; l'implémentation peut être répartie dans d'autres fichiers de ce dossier.
//
// Toutes les fonctions asynchrones rejettent avec une Error dont le `message` est en
// français et affichable tel quel à l'utilisateur.
//
// Types :
//   Joueur      = { uid, pseudo, stats: { jouees, gagnees } }
//   Place       = { uid, pseudo, ia } | null          (ia = true : place tenue par une IA, uid = null)
//   ResumePartie = {
//     id, nom, code,
//     statut,            'attente' | 'encours' | 'finie'
//     hote,              uid du créateur
//     reglages,          { cinqAdverse }
//     joueurs,           Place[4], indexé par siège (0 et 2 contre 1 et 3)
//     monSiege,          siège de l'utilisateur connecté (ou -1)
//     aMoiDeJouer,       true si la partie attend une action de l'utilisateur
//                        (carte à donner pendant l'échange, ou coup à jouer)
//     gagnant,           null | 0 | 1 (équipe)
//     majLe,             Date de la dernière action
//   }

/** Firebase est-il configuré (js/firebase-config.js rempli) ? Sinon : mode hors ligne seulement. */
export function reseauDisponible() {
  return false;
}

// ─── Comptes ────────────────────────────────────────────────────────────────

/** Écoute l'état de connexion. cb(Joueur | null). Renvoie la fonction de désabonnement. */
export function surAuth(cb) {
  cb(null);
  return () => {};
}

/** Crée un compte (pseudo unique + mot de passe) et connecte. → Joueur */
export async function inscrire(pseudo, motDePasse) {
  throw new Error('Réseau non configuré.');
}

/** Connexion avec pseudo + mot de passe. → Joueur */
export async function connecter(pseudo, motDePasse) {
  throw new Error('Réseau non configuré.');
}

export async function deconnecter() {}

// ─── Parties : liste, création, invitation ──────────────────────────────────

/**
 * Écoute les parties de l'utilisateur connecté (en attente, en cours, terminées récentes),
 * triées de la plus récente à la plus ancienne. cb(ResumePartie[]). Renvoie le désabonnement.
 */
export function surMesParties(cb) {
  cb([]);
  return () => {};
}

/** Crée une partie (le créateur prend le siège 0). → { id, code } */
export async function creerPartie({ nom, cinqAdverse }) {
  throw new Error('Réseau non configuré.');
}

/** Rejoint une partie en attente avec son code d'invitation (premier siège libre). → { id } */
export async function rejoindrePartie(code) {
  throw new Error('Réseau non configuré.');
}

/** Écoute une partie (salle d'attente). cb(ResumePartie | null). Renvoie le désabonnement. */
export function surPartie(id, cb) {
  cb(null);
  return () => {};
}

/** Change de siège dans la salle d'attente (le siège doit être libre). */
export async function choisirSiege(id, siege) {
  throw new Error('Réseau non configuré.');
}

/** Hôte : place une IA sur un siège libre / la retire. */
export async function ajouterIA(id, siege) {
  throw new Error('Réseau non configuré.');
}
export async function retirerIA(id, siege) {
  throw new Error('Réseau non configuré.');
}

/** Quitte une partie en attente (si l'hôte quitte, la partie est supprimée). */
export async function quitterPartie(id) {
  throw new Error('Réseau non configuré.');
}

/** Hôte : lance la partie. Les 4 sièges doivent être occupés (humains ou IA). Distribue les cartes. */
export async function lancerPartie(id) {
  throw new Error('Réseau non configuré.');
}

// ─── Jeu ────────────────────────────────────────────────────────────────────

/**
 * Ouvre une partie en cours (ou terminée) pour y jouer.
 * → Session, même interface que SessionLocale (voir js/session-locale.js) :
 *   abonner(cb), donner(carte), jouer(coup), fermer(), avec vue.enLigne = true.
 * La session fait aussi jouer les IA de la partie.
 */
export async function ouvrirSession(id) {
  throw new Error('Réseau non configuré.');
}
