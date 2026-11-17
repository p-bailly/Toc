// Comptes et fiches des joueurs (même modèle que l'appli Scrabble).
//
// Un compte = un simple nom d'utilisateur, sans mot de passe : Firebase n'offre pas ce mode, on le
// simule avec une connexion « adresse + mot de passe » dont les deux dérivent du nom
// (`<identifiant>@joueurs.toc.pbailly.fr`, `toc-<identifiant>` ; l'adresse n'existe pas, aucun e-mail
// n'est envoyé). Saisir le même nom sur un autre appareil ouvre le même compte. Revers assumé :
// quiconque connaît le nom peut s'y connecter (voir docs/firebase.md).
//
//   joueurs/{uid} = { pseudo, recherche?, visible, icone?, verrouille?, stats: { jouees, gagnees },
//                     comptees: [id de partie…], creeLe }
//   - recherche : pseudo normalisé, écrit seulement si le joueur accepte d'être trouvé (visible) ;
//   - verrouille : pseudo imposé par l'administrateur (console), que le joueur ne peut ni changer ni déverrouiller ;
//   - comptees : parties déjà comptées dans stats (mise à jour idempotente, vérifiée par les règles).
//
//   - enCoursIA : { '3'?: date, '4'?: date }, date (ms) de la partie contre l'IA en cours gardée par le compte
//     dans chaque mode ; lue avec la fiche, elle dit sans autre lecture si un autre appareil a joué depuis.
//
// Les parties contre l'IA se jouent hors ligne, sur chaque appareil ; le compte les garde pour qu'elles suivent
// d'un appareil à l'autre, dans des documents que le joueur est seul à lire :
//   joueurs/{uid}/prive/partiesIA  = { parties: [résumé…], retirees: [id…], completes: [id…], majLe }
//   - l'historique : chaque appareil y verse ses parties et y prend celles des autres (synchroniserPartiesIA) ;
//   - retirees : parties retirées de l'historique (pour qu'un autre appareil ne les y remette pas) ;
//   - completes : parties gardées en entier (les plus récentes), analysables depuis n'importe quel appareil.
//   joueurs/{uid}/prive/finie_{id} = { json, date, majLe }   une partie terminée entière (sauvegarde en JSON)
//   joueurs/{uid}/prive/encours{3|4} = { json, date, majLe } la partie en cours de chaque mode
//   (json : la sauvegarde de SessionLocale en texte, Firestore refusant les tableaux de tableaux.)

import {
  ErreurToc,
  ICONE_MAX,
  PSEUDO_MAX,
  PSEUDO_VERROUILLE,
  chemins,
  emailDe,
  identifiant,
  motDePasseDe,
  nbJoueursDe,
  siegesVainqueurs,
  verifierPseudo,
  siegeDe,
} from './commun.js';
import { avecReseau, transaction } from './outils.js';

/** Joueur (contrat api.js) à partir de la fiche. */
export function ficheVersJoueur(uid, d) {
  return {
    uid,
    pseudo: d?.pseudo ?? '?',
    icone: typeof d?.icone === 'string' ? d.icone : null,
    visible: d?.visible !== false,
    verrouille: d?.verrouille === true,
    stats: { jouees: d?.stats?.jouees ?? 0, gagnees: d?.stats?.gagnees ?? 0 },
    enCoursIA: { 3: dateDe(d?.enCoursIA?.['3']), 4: dateDe(d?.enCoursIA?.['4']) },
  };
}

const dateDe = (v) => (Number.isFinite(v) && v > 0 ? v : 0);

const CODES_COMPTE_INCONNU = ['auth/invalid-credential', 'auth/user-not-found', 'auth/invalid-login-credentials'];

/**
 * Se connecte avec ce nom ; le compte est créé la première fois.
 * @param auth  adaptateur { connecter(email, mdp) → { uid }, creer(email, mdp) → { uid } }
 * @returns {Promise<{uid:string, pseudo:string}>} pseudo saisi (nettoyé)
 */
export async function connecterNom(auth, nom) {
  const pseudo = verifierPseudo(nom);
  const id = identifiant(pseudo);
  const email = emailDe(id);
  const mdp = motDePasseDe(id);
  try {
    return { uid: (await auth.connecter(email, mdp)).uid, pseudo };
  } catch (e) {
    // Firebase ne distingue pas « compte inconnu » de « mauvais mot de passe » : on tente la création.
    if (!CODES_COMPTE_INCONNU.includes(e?.code)) throw e;
  }
  try {
    return { uid: (await auth.creer(email, mdp)).uid, pseudo };
  } catch (e) {
    // Créé entre-temps depuis un autre appareil : on s'y connecte.
    if (e?.code === 'auth/email-already-in-use') return { uid: (await auth.connecter(email, mdp)).uid, pseudo };
    throw e;
  }
}

/**
 * Crée la fiche si elle manque (première connexion) ; sinon remet la clé de recherche d'accord avec
 * le pseudo (l'administrateur a pu changer le pseudo sans la clé). → Joueur
 */
export async function assurerFiche(ctx, uid, pseudo) {
  const chemin = chemins.joueur(uid);
  return transaction(ctx, async (tx) => {
    const d = await tx.lire(chemin);
    if (!d) {
      const fiche = {
        pseudo,
        visible: true,
        recherche: identifiant(pseudo),
        stats: { jouees: 0, gagnees: 0 },
        comptees: [],
        creeLe: ctx.magasin.horodatage(),
      };
      tx.creer(chemin, fiche);
      return ficheVersJoueur(uid, fiche);
    }
    if (d.visible !== false && d.recherche !== identifiant(d.pseudo)) {
      tx.maj(chemin, { recherche: identifiant(d.pseudo) });
    }
    return ficheVersJoueur(uid, d);
  });
}

/**
 * Modifie la fiche : { pseudo, icone, visible } (champs facultatifs ; icone null ou '' l'efface).
 * Le pseudo affiché change, pas le nom de connexion. → Joueur
 */
export async function modifierProfil(ctx, changements = {}) {
  const uid = ctx.uid;
  const chemin = chemins.joueur(uid);
  const pseudo = changements.pseudo !== undefined ? verifierPseudo(changements.pseudo) : undefined;
  const { icone, visible } = changements;
  if (icone !== undefined && icone !== null && (typeof icone !== 'string' || icone.length > ICONE_MAX)) {
    throw new ErreurToc('Icône invalide.');
  }
  if (visible !== undefined && typeof visible !== 'boolean') throw new ErreurToc('Réglage « visible » invalide.');
  return transaction(ctx, async (tx) => {
    const d = await tx.lire(chemin);
    if (!d) throw new ErreurToc('Fiche du joueur introuvable : reconnecte-toi.');
    if (pseudo !== undefined && pseudo !== d.pseudo && d.verrouille === true) throw new ErreurToc(PSEUDO_VERROUILLE);
    const apres = { ...d };
    const champs = {};
    if (pseudo !== undefined) champs.pseudo = apres.pseudo = pseudo;
    if (visible !== undefined) champs.visible = apres.visible = visible;
    if (icone !== undefined) {
      if (icone) champs.icone = apres.icone = icone;
      else if ('icone' in d) {
        champs.icone = ctx.magasin.supprimerChamp();
        delete apres.icone;
      }
    }
    // La clé de recherche n'existe que pour un joueur visible.
    if (apres.visible !== false) {
      if (d.recherche !== identifiant(apres.pseudo)) champs.recherche = apres.recherche = identifiant(apres.pseudo);
    } else if ('recherche' in d) {
      champs.recherche = ctx.magasin.supprimerChamp();
      delete apres.recherche;
    }
    if (Object.keys(champs).length) tx.maj(chemin, champs);
    return ficheVersJoueur(uid, apres);
  });
}

/**
 * Compte une partie terminée dans les statistiques du joueur, une seule fois (la liste `comptees`
 * rend l'opération idempotente ; les règles vérifient la partie et le résultat).
 * @returns {Promise<boolean>} true si les statistiques ont changé
 */
export async function comptabiliserPartie(ctx, id, partie) {
  const s = siegeDe(partie, ctx.uid);
  if (partie.statut !== 'finie' || s < 0 || !partie.etat) return false;
  const gagne = siegesVainqueurs(partie.etat, nbJoueursDe(partie.reglages)).includes(s);
  const chemin = chemins.joueur(ctx.uid);
  return transaction(ctx, async (tx) => {
    const d = await tx.lire(chemin);
    if (!d) return false;
    const comptees = Array.isArray(d.comptees) ? d.comptees : [];
    if (comptees.includes(id)) return false;
    const stats = d.stats || { jouees: 0, gagnees: 0 };
    tx.maj(chemin, {
      stats: { jouees: stats.jouees + 1, gagnees: stats.gagnees + (gagne ? 1 : 0) },
      comptees: comptees.concat([id]),
    });
    return true;
  });
}

// ─── Historique des parties contre l'IA, partagé entre les appareils du joueur ─────────────

export const MAX_PARTIES_IA = 300;
export const MAX_RETIREES_IA = 500;
const NIVEAUX = ['debutant', 'amateur', 'confirme', 'expert', 'champion'];

const entier = (v, max) => (Number.isInteger(v) && v >= 0 ? Math.min(v, max) : 0);
/** Identifiant d'une partie contre l'IA : court, sans caractère spécial (il sert aussi de nom de document). */
const idValide = (id) => typeof id === 'string' && /^[A-Za-z0-9]{1,24}$/.test(id);

/** Résumé d'une partie contre l'IA, remis en forme (rien d'inattendu n'entre dans le document) ; null si invalide. */
export function resumePartieIA(p) {
  if (!p || !idValide(p.id) || !Number.isFinite(p.date)) return null;
  const nb = p.nb === 3 ? 3 : 4;
  return {
    id: p.id,
    date: Math.round(p.date),
    nb,
    gagne: !!p.gagne,
    gagnants: (Array.isArray(p.gagnants) ? p.gagnants : []).filter((s) => Number.isInteger(s) && s >= 0 && s < nb).slice(0, 2),
    joueurs: (Array.isArray(p.joueurs) ? p.joueurs : []).slice(0, nb).map((j) => ({
      pseudo: String(j?.pseudo ?? '').slice(0, PSEUDO_MAX),
      ia: !!j?.ia,
      niveau: NIVEAUX.includes(j?.niveau) ? j.niveau : null,
    })),
    donnes: entier(p.donnes, 9999),
    coups: entier(p.coups, 99999),
    cinqAdverse: !!p.cinqAdverse,
  };
}

/**
 * Fusion de deux historiques : toutes les parties (une fois chacune, celle de `base` gagne), sauf les retirées ;
 * de la plus récente à la plus ancienne, MAX_PARTIES_IA au plus. Fonction pure.
 */
export function fusionnerPartiesIA(base, ajout) {
  const retirees = [...new Set([...(base.retirees || []), ...(ajout.retirees || [])].filter(idValide))].slice(-MAX_RETIREES_IA);
  const retire = new Set(retirees);
  const parId = new Map();
  for (const p of [...(base.parties || []), ...(ajout.parties || [])]) {
    const r = resumePartieIA(p);
    if (r && !retire.has(r.id) && !parId.has(r.id)) parId.set(r.id, r);
  }
  const parties = [...parId.values()].sort((a, b) => b.date - a.date || (a.id < b.id ? -1 : 1)).slice(0, MAX_PARTIES_IA);
  return { parties, retirees };
}

/** Parties gardées en entier par le compte (les plus récentes). */
export const MAX_COMPLETES_IA = 12;
/** Taille maximale d'une sauvegarde (un document Firestore tient 1 Mo). */
export const MAX_JSON_IA = 900000;

const completesDe = (d) => (Array.isArray(d?.completes) ? d.completes.filter(idValide) : []);

/**
 * Parties à garder en entier : parmi `ids`, celles qui sont encore dans l'historique, les MAX_COMPLETES_IA plus
 * récentes (même ordre que l'historique). Fonction pure, utilisée des deux côtés pour décider quoi verser.
 */
export function completesAGarder(ids, parties) {
  const rang = new Map(parties.map((p, i) => [p.id, i]));
  return [...new Set(ids)].filter((id) => rang.has(id)).sort((a, b) => rang.get(a) - rang.get(b)).slice(0, MAX_COMPLETES_IA);
}

/**
 * Verse l'historique de cet appareil ({ parties: [résumé…], retirees: [id…] }) dans celui du compte et renvoie
 * l'historique fusionné : c'est ce qui fait suivre les parties contre l'IA d'un appareil à l'autre.
 * `completes` : les parties que le compte garde en entier (voir ecrirePartieIAFinie).
 * @returns {Promise<{ parties: Object[], retirees: string[], completes: string[] }>}
 */
export async function synchroniserPartiesIA(ctx, local = {}) {
  const chemin = chemins.partiesIA(ctx.uid);
  return transaction(ctx, async (tx) => {
    const d = await tx.lire(chemin);
    // (Comparaison sur la forme remise en ordre : Firestore ne garde pas l'ordre des champs.)
    const avant = fusionnerPartiesIA({ parties: d?.parties || [], retirees: d?.retirees || [] }, {});
    const apres = fusionnerPartiesIA(avant, local);
    // Une partie sortie de l'historique (retirée, ou trop ancienne) n'est plus gardée en entier.
    const connues = completesDe(d);
    const completes = completesAGarder(connues, apres.parties);
    for (const id of connues) if (!completes.includes(id)) tx.supprimer(chemins.partieIAFinie(ctx.uid, id));
    if (!d || JSON.stringify(apres) !== JSON.stringify(avant) || completes.length !== connues.length) {
      const donnees = { ...apres, completes, majLe: ctx.magasin.horodatage() };
      if (d) tx.maj(chemin, donnees);
      else tx.creer(chemin, donnees);
    }
    return { ...apres, completes };
  });
}

function verifierJson(json) {
  if (typeof json !== 'string' || !json) throw new ErreurToc('Sauvegarde invalide.');
  if (json.length > MAX_JSON_IA) throw new ErreurToc('Cette partie est trop longue pour être gardée par le compte.');
}

/**
 * Garde en entier une partie contre l'IA terminée (sa sauvegarde, en JSON), pour qu'elle soit analysable depuis
 * les autres appareils. Elle doit déjà être dans l'historique du compte ; seules les MAX_COMPLETES_IA plus
 * récentes sont gardées (les autres sont effacées).
 * @returns {Promise<{ completes: string[] }>} les parties gardées en entier après l'opération
 */
export async function ecrirePartieIAFinie(ctx, id, json) {
  if (!idValide(id)) throw new ErreurToc('Partie invalide.');
  verifierJson(json);
  const chemin = chemins.partiesIA(ctx.uid);
  return transaction(ctx, async (tx) => {
    const d = await tx.lire(chemin);
    const parties = fusionnerPartiesIA({ parties: d?.parties || [], retirees: d?.retirees || [] }, {}).parties;
    const connues = completesDe(d);
    const completes = completesAGarder(connues.concat([id]), parties);
    for (const autre of connues) if (!completes.includes(autre)) tx.supprimer(chemins.partieIAFinie(ctx.uid, autre));
    if (completes.includes(id)) {
      tx.creer(chemins.partieIAFinie(ctx.uid, id), { json, date: parties.find((p) => p.id === id).date, majLe: ctx.magasin.horodatage() });
    }
    if (d && JSON.stringify(completes) !== JSON.stringify(connues)) tx.maj(chemin, { completes, majLe: ctx.magasin.horodatage() });
    return { completes };
  });
}

/** Sauvegarde (JSON) d'une partie terminée gardée en entier par le compte, ou null. */
export async function lirePartieIAFinie(ctx, id) {
  if (!idValide(id)) return null;
  const d = await avecReseau(ctx, () => ctx.magasin.lire(chemins.partieIAFinie(ctx.uid, id)));
  return typeof d?.json === 'string' ? d.json : null;
}

const modeValide = (nb) => nb === 3 || nb === 4;

/**
 * Garde la partie contre l'IA en cours du mode `nb` (sa sauvegarde, en JSON), datée de sa dernière modification
 * sur l'appareil. Le compte n'en garde qu'une par mode, la plus récemment jouée : une sauvegarde plus ancienne
 * que celle du compte n'est pas écrite.
 * @returns {Promise<{ ecrit: boolean }>}
 */
export async function ecrirePartieIAEnCours(ctx, nb, json, date) {
  if (!modeValide(nb) || !Number.isFinite(date) || date <= 0) throw new ErreurToc('Sauvegarde invalide.');
  verifierJson(json);
  const fiche = chemins.joueur(ctx.uid);
  return transaction(ctx, async (tx) => {
    const d = await tx.lire(fiche);
    if (!d) throw new ErreurToc('Fiche du joueur introuvable : reconnecte-toi.');
    const connues = { ...(d.enCoursIA || {}) };
    if (dateDe(connues[String(nb)]) >= date) return { ecrit: false };
    tx.creer(chemins.partieIAEnCours(ctx.uid, nb), { json, date, majLe: ctx.magasin.horodatage() });
    // La date entre dans la fiche : les autres appareils, qui l'écoutent, savent aussitôt qu'il y a du neuf.
    tx.maj(fiche, { enCoursIA: { ...connues, [String(nb)]: date } });
    return { ecrit: true };
  });
}

/** Partie contre l'IA en cours gardée par le compte pour ce mode : { json, date } ou null. */
export async function lirePartieIAEnCours(ctx, nb) {
  if (!modeValide(nb)) return null;
  const d = await avecReseau(ctx, () => ctx.magasin.lire(chemins.partieIAEnCours(ctx.uid, nb)));
  return typeof d?.json === 'string' && Number.isFinite(d.date) ? { json: d.json, date: d.date } : null;
}

// ─── Annuaire : fiches des autres joueurs ──────────────────────────────────

const DUREE_CACHE = 5 * 60 * 1000;
export const MAX_JOUEURS = 100;

/** Lecture des fiches avec cache (l'icône se lit dans la fiche, pas dans les parties). */
export function creerAnnuaire(ctx, maintenant = () => Date.now()) {
  const cache = new Map(); // uid → { quand, promesse }

  function lireJoueur(uid) {
    const c = cache.get(uid);
    if (c && maintenant() - c.quand < DUREE_CACHE) return c.promesse;
    const promesse = ctx.magasin
      .lire(chemins.joueur(uid))
      .then((d) => (d ? { uid, pseudo: d.pseudo, icone: typeof d.icone === 'string' ? d.icone : null } : null))
      .catch((e) => {
        cache.delete(uid);
        throw e;
      });
    cache.set(uid, { quand: maintenant(), promesse });
    return promesse;
  }

  function retenir(uid, fiche) {
    cache.set(uid, { quand: maintenant(), promesse: Promise.resolve(fiche) });
  }

  /**
   * Joueurs visibles, ceux avec qui j'ai déjà joué en tête (du plus récent au plus ancien), moi
   * exclu, `max` au plus. Lus par pages de 10, la taille permise par les règles.
   */
  async function listerJoueurs(max = MAX_JOUEURS) {
    const moi = ctx.uid;
    // Partenaires et adversaires récents, d'après mes parties.
    const parties = await ctx.magasin.requete('parties', 'uids', moi).catch(() => []);
    parties.sort((a, b) => (b.donnees.majLe?.getTime?.() ?? 0) - (a.donnees.majLe?.getTime?.() ?? 0));
    const recents = new Map();
    for (const { donnees } of parties) {
      for (const p of donnees.joueurs || []) {
        if (p && !p.ia && p.uid && p.uid !== moi && !recents.has(p.uid)) recents.set(p.uid, { uid: p.uid, pseudo: p.pseudo, icone: null });
      }
    }
    // Les fiches visibles.
    const tous = [];
    let suite = null;
    for (let lus = 0; lus < max; ) {
      const page = await ctx.magasin.listerFiches(suite);
      if (page.depuisCache) throw new ErreurToc('Pas de connexion : la liste des joueurs demande Internet.', 'unavailable');
      for (const { id, donnees } of page.docs) {
        const fiche = { uid: id, pseudo: donnees.pseudo, icone: typeof donnees.icone === 'string' ? donnees.icone : null };
        retenir(id, fiche);
        if (id !== moi) tous.push(fiche);
      }
      lus += page.docs.length;
      if (page.docs.length < 10 || !page.suite) break;
      suite = page.suite;
    }
    const parUid = new Map(tous.map((j) => [j.uid, j]));
    const tete = [];
    for (const r of [...recents.values()].slice(0, 20)) {
      // Pseudo et icône à jour : ceux de la fiche (même invisible : un get est permis).
      const f = parUid.get(r.uid) || (await lireJoueur(r.uid).catch(() => null));
      tete.push(f ? { uid: r.uid, pseudo: f.pseudo, icone: f.icone } : r);
    }
    const vus = new Set(tete.map((j) => j.uid));
    return [...tete, ...tous.filter((j) => !vus.has(j.uid))].slice(0, max);
  }

  return { lireJoueur, listerJoueurs, retenir, vider: () => cache.clear() };
}
