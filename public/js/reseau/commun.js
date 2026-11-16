// Outils communs de la couche réseau : chemins Firestore, codes d'invitation, noms de joueurs,
// traduction des erreurs. Aucun appel à Firebase ici (module pur, testé dans Node).

// ─── Noms de joueurs ────────────────────────────────────────────────────────

/**
 * Forme normalisée d'un nom (même fonction que l'appli Scrabble) : sans accents, majuscules ni
 * ponctuation. « Jean Luc » et « jean-luc » désignent le même compte. Sert aussi de clé de recherche.
 */
export const identifiant = (nom) =>
  String(nom ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** Le compte est simulé par une adresse et un mot de passe dérivés du nom (aucun e-mail n'est envoyé). */
export const DOMAINE_JOUEURS = 'joueurs.toc.pbailly.fr';
export const emailDe = (id) => `${id}@${DOMAINE_JOUEURS}`;
export const motDePasseDe = (id) => `toc-${id}`;

export const PSEUDO_MAX = 20;
export const ICONE_MAX = 12;
/** Au moins deux caractères : Firebase exige un mot de passe de 6 caractères (« toc-xx »). */
export const IDENTIFIANT_MIN = 2;

export const PSEUDO_VERROUILLE = "Ce pseudo a été choisi par l'administrateur de l'appli : tu ne peux plus le changer.";

/** Vérifie un pseudo saisi ; renvoie le pseudo nettoyé ou lève une Error en français. */
export function verifierPseudo(pseudo) {
  const p = String(pseudo ?? '').trim().replace(/\s+/g, ' ');
  if (!p) throw new Error('Choisis un nom.');
  if (p.length > PSEUDO_MAX) throw new Error(`Ton nom ne doit pas dépasser ${PSEUDO_MAX} caractères.`);
  if (identifiant(p).length < IDENTIFIANT_MIN) throw new Error('Utilise au moins deux lettres ou chiffres dans ton nom.');
  return p;
}

// ─── Niveaux de force des IA ────────────────────────────────────────────────
// Mêmes identifiants que NIVEAUX dans js/ia/ia.js (liste recopiée ici pour que la couche réseau ne
// dépende pas du module de l'IA). Une place d'IA sans niveau (parties d'avant) vaut 'champion'.

export const NIVEAUX_IA = ['debutant', 'amateur', 'confirme', 'expert', 'champion'];
export const NIVEAU_IA_DEFAUT = 'champion';

/** Niveau d'une place d'IA (champ absent : champion). */
export const niveauDe = (place) => (place && NIVEAUX_IA.includes(place.niveau) ? place.niveau : NIVEAU_IA_DEFAUT);

/** Vérifie un niveau demandé (absent : champion) ; lève une Error en français s'il est inconnu. */
export function verifierNiveau(niveau) {
  if (niveau === undefined || niveau === null) return NIVEAU_IA_DEFAUT;
  if (!NIVEAUX_IA.includes(niveau)) throw new ErreurToc(`Niveau d’IA inconnu : ${niveau}.`);
  return niveau;
}

// ─── Codes d'invitation ─────────────────────────────────────────────────────

/** Sans 0/O, 1/I/L : aucun caractère ambigu. 31^6 ≈ 887 millions de codes. */
export const ALPHABET_CODE = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const LONGUEUR_CODE = 6;

export function nouveauCode(rng = Math.random) {
  let s = '';
  for (let i = 0; i < LONGUEUR_CODE; i++) s += ALPHABET_CODE[Math.floor(rng() * ALPHABET_CODE.length)];
  return s;
}

export const normaliserCode = (c) => String(c ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

export const codeValide = (c) => c.length === LONGUEUR_CODE && [...c].every((x) => ALPHABET_CODE.includes(x));

// ─── Chemins Firestore ──────────────────────────────────────────────────────
// La partie a pour identifiant son code d'invitation (comme dans l'appli Scrabble).

export const chemins = {
  joueur: (uid) => `joueurs/${uid}`,
  partie: (id) => `parties/${id}`,
  donne: (id, donne, siege) => `parties/${id}/donnes/${donne}_${siege}`,
  don: (id, donne, siege) => `parties/${id}/dons/${donne}_${siege}`,
};

// ─── Erreurs ────────────────────────────────────────────────────────────────

export const HORS_LIGNE = "Pas de connexion à Internet : réessaie quand tu seras en ligne.";

/** Erreur « métier » déjà formulée pour l'utilisateur. */
export class ErreurToc extends Error {
  constructor(message, code = 'toc') {
    super(message);
    this.code = code;
  }
}

/** L'état a changé pendant qu'une IA réfléchissait : l'action n'a plus lieu d'être (pas une vraie erreur). */
export class ConflitIA extends ErreurToc {
  constructor() {
    super('La partie a avancé entre-temps.', 'toc/conflit');
  }
}

/** Message lisible pour une erreur Firebase (ou déjà en français). */
export function messageErreur(e) {
  const code = e && typeof e.code === 'string' ? e.code : '';
  if (e instanceof ErreurToc) return e.message;
  switch (code) {
    case 'permission-denied':
    case 'firestore/permission-denied':
      return "Refusé par le serveur. Si cela dure, les règles Firestore du projet ne sont peut-être pas à jour (voir docs/firebase.md).";
    case 'unavailable':
    case 'firestore/unavailable':
    case 'deadline-exceeded':
    case 'auth/network-request-failed':
      return HORS_LIGNE;
    case 'aborted':
    case 'firestore/aborted':
    case 'failed-precondition':
      return "Trop d'actions en même temps sur cette partie : réessaie.";
    case 'not-found':
      return "Cette partie n'existe plus.";
    case 'resource-exhausted':
      return 'Quota du serveur dépassé pour aujourd’hui : réessaie plus tard.';
    case 'unauthenticated':
      return 'Connecte-toi d’abord.';
    case 'auth/too-many-requests':
      return 'Trop de tentatives de connexion : patiente quelques minutes.';
    case 'auth/user-disabled':
      return 'Ce compte a été désactivé.';
    case 'auth/operation-not-allowed':
      return 'La connexion par nom n’est pas activée sur le projet Firebase (Authentication → Adresse e-mail/Mot de passe).';
    case 'auth/invalid-api-key':
    case 'auth/api-key-not-valid.-please-pass-a-valid-api-key.':
      return 'Configuration Firebase invalide (public/js/firebase-config.js).';
    default:
      break;
  }
  if (e instanceof Error && e.message && !code) return e.message; // erreurs du moteur, déjà en français
  return 'Erreur inattendue' + (code ? ` (${code})` : '') + '.';
}

/** Convertit n'importe quelle erreur en Error au message français. */
export function enErreurToc(e) {
  if (e instanceof ErreurToc) return e;
  const err = new ErreurToc(messageErreur(e), e?.code || 'toc');
  err.cause = e;
  return err;
}

// ─── Lecture des documents de partie ───────────────────────────────────────

const date = (v) => (v instanceof Date ? v : null);

/** Humains dont une action est attendue (badge « à toi de jouer »). */
export function calculerEnAttente(etat, joueurs) {
  if (!etat || etat.phase === 'fini') return [];
  const humain = (s) => joueurs[s] && !joueurs[s].ia && joueurs[s].uid;
  if (etat.phase === 'echange') {
    const r = [];
    for (let s = 0; s < etat.echanges.length; s++) if (!etat.echanges[s] && humain(s)) r.push(joueurs[s].uid);
    return r;
  }
  return humain(etat.tour) ? [joueurs[etat.tour].uid] : [];
}

/** Siège de `uid` dans la partie, ou -1. */
export function siegeDe(partie, uid) {
  return (partie.joueurs || []).findIndex((p) => p && !p.ia && p.uid === uid);
}

/** Le siège `s` attend-il une action ? */
export function siegeDoitAgir(etat, s) {
  if (!etat) return false;
  if (etat.phase === 'echange') return !etat.echanges[s];
  if (etat.phase === 'jeu') return etat.tour === s;
  return false;
}

/** Nombre de joueurs d'une partie d'après ses réglages : 3, ou 4 (champ absent). */
export const nbJoueursDe = (reglages) => (reglages && reglages.nbJoueurs === 3 ? 3 : 4);

/** Réglages au format du moteur : { cinqAdverse } à 4, { cinqAdverse, nbJoueurs: 3 } à 3. */
export function reglagesPartie(cinqAdverse, nbJoueurs) {
  return nbJoueurs === 3 ? { cinqAdverse: !!cinqAdverse, nbJoueurs: 3 } : { cinqAdverse: !!cinqAdverse };
}

/** Sièges gagnants d'une partie terminée (les deux de l'équipe à 4, un seul à 3). */
export function siegesVainqueurs(etat, nbJoueurs) {
  if (!etat || etat.phase !== 'fini' || etat.gagnant === null || etat.gagnant === undefined) return [];
  return nbJoueurs === 3 ? [etat.gagnant] : [etat.gagnant, etat.gagnant + 2];
}

/** ResumePartie (voir api.js) à partir du document `parties/{id}`. */
export function resumePartie(id, d, uid) {
  const monSiege = siegeDe(d, uid);
  const etat = d.etat || null;
  const pseudos = d.pseudosInvites || {};
  const nbJoueurs = nbJoueursDe(d.reglages);
  return {
    id,
    nom: d.nom,
    code: d.code,
    statut: d.statut,
    hote: d.hote,
    reglages: reglagesPartie(d.reglages?.cinqAdverse, nbJoueurs),
    nbJoueurs,
    joueurs: (d.joueurs || Array(nbJoueurs).fill(null)).map((p) =>
      p ? (p.ia ? { uid: null, pseudo: p.pseudo, ia: true, niveau: niveauDe(p) } : { uid: p.uid ?? null, pseudo: p.pseudo, ia: false }) : null,
    ),
    monSiege,
    aMoiDeJouer: d.statut === 'encours' && monSiege >= 0 && siegeDoitAgir(etat, monSiege),
    gagnant: etat && etat.gagnant !== undefined ? etat.gagnant : null,
    gagnants: siegesVainqueurs(etat, nbJoueurs),
    majLe: date(d.majLe) || date(d.creeLe) || new Date(0),
    invites: (d.invites || []).map((u) => ({ uid: u, pseudo: pseudos[u] ?? '?' })),
    refus: (d.refus || []).map((u) => ({ uid: u, pseudo: pseudos[u] ?? '?' })),
  };
}

