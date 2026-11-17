// Parties d'entraînement contre l'IA (hors ligne, sauvegardées sur l'appareil) :
//   #/jeu/locale    2 contre 2 (toi et une IA contre deux IA)
//   #/jeu/locale3   3 joueurs, chacun pour soi (toi contre deux IA)
// Chaque mode a sa propre sauvegarde : on peut avoir une partie en cours dans chacun.
// Avec un compte, la partie suit d'un appareil à l'autre (synchro-ia.js) : elle est envoyée au compte pendant qu'on
// joue, et reprise ici si un autre appareil a joué depuis. Terminée, elle entre dans l'historique de l'appareil et
// dans celui du compte.

import { SessionLocale } from '../session-locale.js';
import { enregistrerPartieFinie } from './parties-finies.js';
import {
  CLES_PARTIE_IA, synchroniserPartiesIA, stockageSuivi, noterModification, compteEnAvance, recupererPartieEnCours, envoyerPartieEnCours, marquerPartieOuverte,
} from './synchro-ia.js';
import { monterJeu } from './vue-jeu.js';
import { h, remplacer, lire, ecrire } from './dom.js';
import { lireReglages, rythme } from './reglages.js';

/** Clé de sauvegarde et d'options de chaque mode. */
export const MODES_LOCAUX = {
  4: { cle: CLES_PARTIE_IA[4], options: 'toc.optionsLocales', route: '#/jeu/locale', analyse: '#/analyse/locale' },
  3: { cle: CLES_PARTIE_IA[3], options: 'toc.optionsLocales3', route: '#/jeu/locale3', analyse: '#/analyse/locale3' },
};

/** Partie sauvegardée d'un mode ({ nom, joueurs, partie }) ou null. */
export function sauvegardeLocale(nbJoueurs = 4) {
  return SessionLocale.lireSauvegarde(localStorage, MODES_LOCAUX[nbJoueurs].cle);
}

/**
 * Prépare une nouvelle partie d'entraînement (la suivante ouverte en sera une neuve). C'est désormais la plus
 * récente du mode : celle que le compte du `joueur` connecté garde encore (jouée sur un autre appareil) ne revient
 * pas à sa place.
 */
export function nouvellePartieLocale(reglages, nbJoueurs = 4, niveaux = null, joueur = null, couleur = null) {
  const mode = MODES_LOCAUX[nbJoueurs];
  SessionLocale.effacerSauvegarde(localStorage, mode.cle);
  noterModification(nbJoueurs, joueur?.uid, localStorage, Date.now, joueur?.enCoursIA?.[nbJoueurs]);
  ecrire(mode.options, { cinqAdverse: !!reglages.cinqAdverse, niveaux: niveaux || null, couleur: couleur || null });
}

/** Attente maximale de la partie gardée par le compte avant d'ouvrir celle de l'appareil. */
const ATTENTE_COMPTE = 6000;

export function afficher(racine, app, { reste }) {
  const nbJoueurs = reste[0] === 'locale3' ? 3 : 4;
  const mode = MODES_LOCAUX[nbJoueurs];
  let session = null;
  let demonter = null;
  let quitte = false;

  const ouvrir = () => {
    // Tant que la partie est ouverte ici, celle du compte ne la remplace pas ; chaque sauvegarde lui est envoyée.
    marquerPartieOuverte(nbJoueurs, true);
    const options = lire(mode.options, {}) || {};
    session = new SessionLocale({
      stockage: stockageSuivi(app, nbJoueurs),
      cle: mode.cle,
      reprendre: true,
      nbJoueurs,
      reglages: { cinqAdverse: !!options.cinqAdverse },
      // Force des IA (un niveau par siège) ; une partie reprise garde ceux de sa sauvegarde.
      niveaux: options.niveaux || undefined,
      // Couleur de ses pions, choisie en créant la partie.
      couleur: options.couleur || undefined,
      pseudo: app.joueur?.pseudo || 'Toi',
      // Délai des IA accordé à la « Vitesse du jeu » (la file de présentation donne le rythme à l'écran).
      delaiIA: app.rapide ? 40 : rythme(lireReglages().vitesse).delaiIA,
      budgetIA: app.rapide ? 15 : 600,
    });
    // Le joueur connecté voit son icône à sa place sur le plateau.
    const icone = app.joueur?.icone;
    const vraie = session;
    let versee = false;
    const enveloppe = {
      abonner: (cb) =>
        vraie.abonner((v) => {
          // Partie terminée : elle entre dans l'historique de l'appareil (statistiques, analyse), puis dans celui
          // du compte connecté, pour se retrouver sur ses autres appareils.
          if (v.etat.phase === 'fini') {
            enregistrerPartieFinie({ nom: vraie.nom, joueurs: vraie.joueurs, partie: vraie.partie }, nbJoueurs, { uid: app.joueur?.uid });
            if (!versee) {
              versee = true;
              void synchroniserPartiesIA(app);
            }
          }
          cb({ ...v, joueurs: v.joueurs.map((j, i) => (i === v.siege ? { ...j, icone } : j)) });
        }),
      donner: (c) => vraie.donner(c),
      jouer: (c) => vraie.jouer(c),
      fermer: () => vraie.fermer(),
    };
    demonter = monterJeu(racine, {
      session: enveloppe,
      retour: '#/ia',
      conseils: true,
      essais: !!app.rapide,
      analyse: mode.analyse,
      libelleRetour: 'Retour au menu Contre l’IA',
      rejouer: () => {
        const reglages = vraie.partie?.etat?.reglages || {};
        fermer();
        // Rejouer garde la force des IA et la couleur du joueur de la partie terminée.
        const niveaux = (vraie.joueurs || []).map((j) => (j.ia ? j.niveau || null : null));
        nouvellePartieLocale(reglages, nbJoueurs, niveaux, app.joueur, vraie.joueurs?.[0]?.couleur);
        ouvrir();
      },
    });
  };

  const fermer = () => {
    demonter?.();
    session?.fermer();
    demonter = null;
    session = null;
    marquerPartieOuverte(nbJoueurs, false);
    // Ce qui n'est pas encore parti vers le compte part maintenant.
    void envoyerPartieEnCours(app, nbJoueurs);
  };

  /** Ouvre la partie ; si un autre appareil a joué depuis, on reprend d'abord là où il s'est arrêté. */
  const demarrer = async () => {
    if (compteEnAvance(app, nbJoueurs)) {
      remplacer(racine, h('div', { class: 'vide-etat' }, 'Récupération de ta partie…'));
      await Promise.race([recupererPartieEnCours(app, nbJoueurs), new Promise((r) => setTimeout(r, ATTENTE_COMPTE))]);
    }
    if (!quitte && !session) ouvrir();
  };
  void demarrer();

  // La fiche du joueur change quand un autre appareil joue cette partie : on la reprend à jour, plutôt que de
  // continuer ici une version dépassée.
  app.surJoueur = () => {
    if (quitte || !session || !compteEnAvance(app, nbJoueurs)) return;
    fermer();
    void demarrer();
  };

  return () => {
    quitte = true;
    app.surJoueur = null;
    fermer();
  };
}
