// Parties d'entraînement contre l'IA (hors ligne, sauvegardées sur l'appareil) :
//   #/jeu/locale    2 contre 2 (toi et une IA contre deux IA)
//   #/jeu/locale3   3 joueurs, chacun pour soi (toi contre deux IA)
// Chaque mode a sa propre sauvegarde : on peut avoir une partie en cours dans chacun.

import { SessionLocale } from '../session-locale.js';
import { monterJeu } from './vue-jeu.js';
import { lire, ecrire } from './dom.js';

/** Clé de sauvegarde et d'options de chaque mode. */
export const MODES_LOCAUX = {
  4: { cle: 'toc.partieLocale', options: 'toc.optionsLocales', route: '#/jeu/locale', analyse: '#/analyse/locale' },
  3: { cle: 'toc.partieLocale3', options: 'toc.optionsLocales3', route: '#/jeu/locale3', analyse: '#/analyse/locale3' },
};

/** Partie sauvegardée d'un mode ({ nom, joueurs, partie }) ou null. */
export function sauvegardeLocale(nbJoueurs = 4) {
  return SessionLocale.lireSauvegarde(localStorage, MODES_LOCAUX[nbJoueurs].cle);
}

/** Prépare une nouvelle partie d'entraînement (la suivante ouverte en sera une neuve). */
export function nouvellePartieLocale(reglages, nbJoueurs = 4) {
  const mode = MODES_LOCAUX[nbJoueurs];
  SessionLocale.effacerSauvegarde(localStorage, mode.cle);
  ecrire(mode.options, { cinqAdverse: !!reglages.cinqAdverse });
}

export function afficher(racine, app, { reste }) {
  const nbJoueurs = reste[0] === 'locale3' ? 3 : 4;
  const mode = MODES_LOCAUX[nbJoueurs];
  let session = null;
  let demonter = null;

  const ouvrir = () => {
    const options = lire(mode.options, {}) || {};
    session = new SessionLocale({
      stockage: localStorage,
      cle: mode.cle,
      reprendre: true,
      nbJoueurs,
      reglages: { cinqAdverse: !!options.cinqAdverse },
      pseudo: app.joueur?.pseudo || 'Toi',
      delaiIA: app.rapide ? 40 : 900,
      budgetIA: app.rapide ? 15 : 600,
    });
    // Le joueur connecté voit son icône à sa place sur le plateau.
    const icone = app.joueur?.icone;
    const vraie = session;
    const enveloppe = {
      abonner: (cb) => vraie.abonner((v) => cb({ ...v, joueurs: v.joueurs.map((j, i) => (i === v.siege ? { ...j, icone } : j)) })),
      donner: (c) => vraie.donner(c),
      jouer: (c) => vraie.jouer(c),
      fermer: () => vraie.fermer(),
    };
    demonter = monterJeu(racine, {
      session: enveloppe,
      retour: '#/ia',
      conseils: true,
      analyse: mode.analyse,
      libelleRetour: 'Retour au menu Contre l’IA',
      rejouer: () => {
        const reglages = vraie.partie?.etat?.reglages || {};
        fermer();
        nouvellePartieLocale(reglages, nbJoueurs);
        ouvrir();
      },
    });
  };

  const fermer = () => {
    demonter?.();
    session?.fermer();
    demonter = null;
    session = null;
  };

  ouvrir();
  return fermer;
}
