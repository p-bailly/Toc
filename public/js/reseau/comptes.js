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

import {
  ErreurToc,
  ICONE_MAX,
  PSEUDO_VERROUILLE,
  chemins,
  emailDe,
  identifiant,
  motDePasseDe,
  verifierPseudo,
  siegeDe,
} from './commun.js';
import { transaction } from './outils.js';

/** Joueur (contrat api.js) à partir de la fiche. */
export function ficheVersJoueur(uid, d) {
  return {
    uid,
    pseudo: d?.pseudo ?? '?',
    icone: typeof d?.icone === 'string' ? d.icone : null,
    visible: d?.visible !== false,
    verrouille: d?.verrouille === true,
    stats: { jouees: d?.stats?.jouees ?? 0, gagnees: d?.stats?.gagnees ?? 0 },
  };
}

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
  const chemin = chemins.joueur(ctx.uid);
  return transaction(ctx, async (tx) => {
    const d = await tx.lire(chemin);
    if (!d) return false;
    const comptees = Array.isArray(d.comptees) ? d.comptees : [];
    if (comptees.includes(id)) return false;
    const stats = d.stats || { jouees: 0, gagnees: 0 };
    tx.maj(chemin, {
      stats: { jouees: stats.jouees + 1, gagnees: stats.gagnees + (partie.etat.gagnant === s % 2 ? 1 : 0) },
      comptees: comptees.concat([id]),
    });
    return true;
  });
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
