// Partie d'entraînement contre trois IA (hors ligne, sauvegardée sur l'appareil) : route #/jeu/locale.

import { SessionLocale } from '../session-locale.js';
import { monterJeu } from './vue-jeu.js';
import { lire, ecrire } from './dom.js';

const CLE_OPTIONS = 'toc.optionsLocales';

/** Prépare une nouvelle partie d'entraînement (la suivante ouverte en sera une neuve). */
export function nouvellePartieLocale(reglages) {
  SessionLocale.effacerSauvegarde(localStorage);
  ecrire(CLE_OPTIONS, { cinqAdverse: !!reglages.cinqAdverse });
}

export function afficher(racine, app) {
  let session = null;
  let demonter = null;

  const ouvrir = () => {
    const options = lire(CLE_OPTIONS, {}) || {};
    session = new SessionLocale({
      stockage: localStorage,
      reprendre: true,
      reglages: { cinqAdverse: !!options.cinqAdverse },
      pseudo: app.joueur?.pseudo || 'Vous',
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
      analyse: '#/analyse/locale',
      libelleRetour: 'Retour au menu Contre l’IA',
      rejouer: () => {
        const reglages = vraie.partie?.etat?.reglages || {};
        fermer();
        nouvellePartieLocale(reglages);
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
