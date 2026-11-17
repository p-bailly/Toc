// Client réseau complet, indépendant de Firebase : api.js l'instancie avec les vrais services
// (SDK chargé depuis le CDN), les tests Node avec un faux magasin et une fausse authentification.

import { ErreurToc, chemins, enErreurToc, resumePartie } from './commun.js';
import {
  assurerFiche,
  comptabiliserPartie,
  connecterNom,
  creerAnnuaire,
  ficheVersJoueur,
  ecrirePartieIAEnCours,
  ecrirePartieIAFinie,
  lirePartieIAEnCours,
  lirePartieIAFinie,
  modifierProfil as modifierFiche,
  synchroniserPartiesIA,
} from './comptes.js';
import * as P from './parties.js';
import { avecReseau } from './outils.js';
import { SessionReseau } from './session-reseau.js';

/** Parties terminées gardées dans « Mes parties » (les plus récentes). */
export const FINIES_GARDEES = 20;
/** Salles d'attente listées au plus (borne exigée par les règles Firestore : request.query.limit <= 50). */
export const SALLES_LISTEES = 50;

/**
 * @param {Object} options
 * @param {() => Promise<{magasin, auth}>} options.services  chargement paresseux des services
 * @param {Object} [options.ia]          { choisirDon, choisirCoup }
 * @param {Object} [options.session]     options de SessionReseau (délais de l'IA…)
 * @param {Function} [options.rng]
 * @param {number} [options.delaiReseau]
 * @param {Function} [options.horsLigne]
 */
export function creerClient(options) {
  let promesse = null;
  const services = () => (promesse ??= options.services());
  let connexionEnCours = false;
  const comptees = new Set(); // parties déjà comptées (ou en cours) dans cette exécution
  let annuaire = null;
  let annuaireUid = null;

  const base = (s, uid) => ({
    magasin: s.magasin,
    uid,
    rng: options.rng,
    delaiReseau: options.delaiReseau,
    pauseRelance: options.pauseRelance,
    horsLigne: options.horsLigne,
  });

  async function ctx() {
    const s = await services();
    await s.auth.pret();
    const u = s.auth.utilisateur();
    if (!u) throw new ErreurToc('Connecte-toi d’abord.', 'unauthenticated');
    return base(s, u.uid);
  }

  async function annuaireCourant() {
    const c = await ctx();
    if (!annuaire || annuaireUid !== c.uid) {
      annuaire = creerAnnuaire(c);
      annuaireUid = c.uid;
    }
    return annuaire;
  }

  /** Enveloppe : toute erreur ressort en Error au message français. */
  const action =
    (fn) =>
    async (...args) => {
      try {
        return await fn(...args);
      } catch (e) {
        throw enErreurToc(e);
      }
    };

  /** Écoute qui attend le chargement des services et l'état de connexion. */
  function ecoute(demarrer, cbVide) {
    let fini = false;
    let arret = null;
    services()
      .then(async (s) => {
        await s.auth.pret();
        if (fini) return;
        const u = s.auth.utilisateur();
        if (!u) return cbVide();
        arret = demarrer(base(s, u.uid));
      })
      .catch((e) => {
        console.warn('Réseau indisponible', e);
        cbVide();
      });
    return () => {
      fini = true;
      if (arret) arret();
    };
  }

  function compter(c, id, d) {
    if (d.statut !== 'finie' || comptees.has(id)) return;
    comptees.add(id);
    comptabiliserPartie(c, id, d).catch((e) => {
      comptees.delete(id);
      console.warn('Statistiques non mises à jour', e);
    });
  }

  return {
    surAuth(cb) {
      let fini = false;
      let arretAuth = null;
      let arretFiche = null;
      services()
        .then((s) => {
          if (fini) return;
          arretAuth = s.auth.surChangement(
            (u) => {
              if (arretFiche) arretFiche();
              arretFiche = null;
              if (!u) return cb(null);
              const provisoire = () => ficheVersJoueur(u.uid, { pseudo: (u.email || '').split('@')[0] || '?' });
              let reparee = false;
              arretFiche = s.magasin.ecouter(
                chemins.joueur(u.uid),
                (d) => {
                  if (d) return cb(ficheVersJoueur(u.uid, d));
                  if (connexionEnCours) return; // connecter() crée la fiche
                  // Fiche absente (création interrompue, ou cache vide hors ligne) : on la recrée.
                  cb(provisoire());
                  if (!reparee) {
                    reparee = true;
                    assurerFiche(base(s, u.uid), u.uid, provisoire().pseudo).catch(() => {});
                  }
                },
                (e) => {
                  console.warn('Écoute de la fiche interrompue', e);
                  cb(provisoire());
                },
              );
            },
            (e) => {
              console.warn('Authentification indisponible', e);
              cb(null);
            },
          );
        })
        .catch((e) => {
          console.warn('Réseau indisponible', e);
          cb(null);
        });
      return () => {
        fini = true;
        if (arretFiche) arretFiche();
        if (arretAuth) arretAuth();
      };
    },

    connecter: action(async (pseudo) => {
      const s = await services();
      connexionEnCours = true;
      try {
        const c0 = { horsLigne: options.horsLigne, delaiReseau: options.delaiReseau };
        const { uid, pseudo: p } = await avecReseau(c0, () => connecterNom(s.auth, pseudo));
        return await assurerFiche(base(s, uid), uid, p);
      } finally {
        connexionEnCours = false;
      }
    }),

    deconnecter: action(async () => {
      const s = await services();
      annuaire = null;
      comptees.clear();
      await s.auth.deconnecter();
    }),

    modifierProfil: action(async (changements) => {
      const c = await ctx();
      const j = await modifierFiche(c, changements);
      (await annuaireCourant()).retenir(j.uid, { uid: j.uid, pseudo: j.pseudo, icone: j.icone });
      return j;
    }),

    synchroniserPartiesIA: action(async (local) => synchroniserPartiesIA(await ctx(), local)),
    ecrirePartieIAFinie: action(async (id, json) => ecrirePartieIAFinie(await ctx(), id, json)),
    lirePartieIAFinie: action(async (id) => lirePartieIAFinie(await ctx(), id)),
    ecrirePartieIAEnCours: action(async (nb, json, date) => ecrirePartieIAEnCours(await ctx(), nb, json, date)),
    lirePartieIAEnCours: action(async (nb) => lirePartieIAEnCours(await ctx(), nb)),

    lireJoueur: action(async (uid) => (await annuaireCourant()).lireJoueur(uid)),

    listerJoueurs: action(async () => (await annuaireCourant()).listerJoueurs()),

    surMesParties(cb) {
      return ecoute(
        (c) =>
          c.magasin.ecouterRequete(
            'parties',
            'uids',
            c.uid,
            (docs) => {
              const resumes = docs.map(({ id, donnees }) => {
                compter(c, id, donnees);
                return resumePartie(id, donnees, c.uid);
              });
              resumes.sort((a, b) => b.majLe - a.majLe);
              let finies = 0;
              cb(resumes.filter((r) => r.statut !== 'finie' || ++finies <= FINIES_GARDEES));
            },
            (e) => console.warn('Écoute de mes parties interrompue', e),
          ),
        () => cb([]),
      );
    },

    surInvitations(cb) {
      return ecoute(
        (c) =>
          c.magasin.ecouterRequete(
            'parties',
            'invites',
            c.uid,
            (docs) => {
              const r = docs
                .filter(({ donnees }) => donnees.statut === 'attente')
                .map(({ id, donnees }) => resumePartie(id, donnees, c.uid));
              r.sort((a, b) => b.majLe - a.majLe);
              cb(r);
            },
            (e) => console.warn('Écoute des invitations interrompue', e),
          ),
        () => cb([]),
      );
    },

    surSallesAttente(cb) {
      return ecoute(
        (c) =>
          c.magasin.ecouterEgal(
            'parties',
            'statut',
            'attente',
            SALLES_LISTEES,
            (docs) => {
              const r = docs.filter(({ donnees }) => donnees.statut === 'attente').map(({ id, donnees }) => resumePartie(id, donnees, c.uid));
              r.sort((a, b) => b.majLe - a.majLe);
              cb(r);
            },
            (e) => {
              // Règles Firestore pas encore republiées, par exemple : « Mes parties » marche sans cette liste.
              console.warn('Écoute des salles d’attente interrompue', e);
              cb([]);
            },
          ),
        () => cb([]),
      );
    },

    surPartie(id, cb) {
      return ecoute(
        (c) =>
          c.magasin.ecouter(
            chemins.partie(id),
            (d) => cb(d ? resumePartie(id, d, c.uid) : null),
            (e) => {
              console.warn('Écoute de la partie interrompue', e);
              cb(null);
            },
          ),
        () => cb(null),
      );
    },

    creerPartie: action(async (reglages) => P.creerPartie(await ctx(), reglages)),
    rejoindrePartie: action(async (code) => P.rejoindrePartie(await ctx(), code)),
    choisirSiege: action(async (id, siege) => P.choisirSiege(await ctx(), id, siege)),
    choisirCouleur: action(async (id, couleur) => P.choisirCouleur(await ctx(), id, couleur)),
    ajouterIA: action(async (id, siege, niveau) => P.ajouterIA(await ctx(), id, siege, niveau)),
    changerNiveauIA: action(async (id, siege, niveau) => P.changerNiveauIA(await ctx(), id, siege, niveau)),
    retirerIA: action(async (id, siege) => P.retirerIA(await ctx(), id, siege)),
    reglerCinqAdverse: action(async (id, actif) => P.reglerCinqAdverse(await ctx(), id, actif)),
    quitterPartie: action(async (id) => P.quitterPartie(await ctx(), id)),
    supprimerPartie: action(async (id) => P.supprimerPartie(await ctx(), id)),
    lancerPartie: action(async (id) => P.lancerPartie(await ctx(), id)),
    inviter: action(async (id, uid) => P.inviter(await ctx(), id, uid)),
    annulerInvitation: action(async (id, uid) => P.annulerInvitation(await ctx(), id, uid)),
    accepterInvitation: action(async (id) => P.accepterInvitation(await ctx(), id)),
    refuserInvitation: action(async (id) => P.refuserInvitation(await ctx(), id)),

    ouvrirSession: action(async (id) => SessionReseau.ouvrir(await ctx(), id, { ia: options.ia, ...options.session })),
  };
}

