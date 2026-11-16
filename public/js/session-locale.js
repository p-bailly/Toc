// Session de jeu locale : un humain (siège 0) contre trois IA, sans réseau.
// Option nbJoueurs: 3 : un humain (siège 0) contre deux IA, chacun pour soi.
//
// ─── Interface « Session » ────────────────────────────────────────────────────
// SessionLocale (ici) et la session réseau (reseau/api.js → ouvrirSession) exposent
// exactement la même interface, seule chose que l'écran de jeu connaît :
//
//   session.abonner(cb) → fonction de désabonnement
//       cb(vue) est appelé tout de suite puis à chaque changement.
//   session.donner(carte) → Promise    donner une carte au partenaire (phase 'echange')
//   session.jouer(coup)   → Promise    jouer un coup (phase 'jeu', à son tour) ; rejette si illégal
//   session.fermer()                   arrêter les écoutes et les minuteries
//   session.donneesAnalyse() → Promise<{ reglages, joueurs, siege, historique, donnes }>
//       pour l'analyse de fin de partie : donnes[d] = { distribuees, donnee, recue } = les cartes
//       du joueur local à la donne d (distribuées, donnée au partenaire, reçue de lui).
//       La partie se rejoue avec rejouerPartie(reglages, historique) (moteur/rejeu.js).
//       La session locale ajoute donnesParSiege[siege][d] (même forme, pour chaque siège) : hors ligne,
//       les mains de tout le monde sont connues et l'analyse peut porter sur un autre joueur. Une session
//       en ligne ne le fournit pas (les mains des autres restent secrètes).
//
//   vue = {
//     id,            identifiant de la partie ('locale' hors ligne)
//     enLigne,       booléen
//     nom,           nom de la partie
//     siege,         siège du joueur local (0 à 3)
//     joueurs,       [{ pseudo, ia, niveau? }] × 4, indexé par siège (niveau = force d'une IA)
//     etat,          état public du moteur (voir moteur/regles.js)
//     main,          cartes du joueur local (tableau de chaînes, déjà à jour)
//     don,           carte que le joueur local a donnée pour la donne en cours, ou null
//     recu,          carte reçue du partenaire (connue une fois la phase 'jeu' commencée), ou null
//     historique,    [{ n, siege, coup, captures }] du plus ancien au plus récent
//   }
//
// À 3 joueurs (options.nbJoueurs = 3, ou partie sauvegardée à 3) : l'interface est la même,
// mais `joueurs` a 3 éléments (sièges 0 à 2), etat.reglages.nbJoueurs vaut 3, `don` est la
// carte donnée au voisin de la donne (destinataireDon dans moteur/plateau.js) et `recu` la carte
// reçue de l'autre voisin (donneurDon). Dans donneesAnalyse, donnes[d].donnee / .recue sont ces
// mêmes cartes, et reglages contient nbJoueurs: 3 (rejouerPartie le relit).
// Les IA du jeu à 3 sont provisoires (ia/ia3.js).
// ──────────────────────────────────────────────────────────────────────────────

import { nouvellePartie, donnerCarte, jouerCoup, donneurDon, nombreJoueurs } from './moteur/index.js';
import { choisirCoup, choisirDon } from './ia/ia.js';
import { choisirCoup3, choisirDon3 } from './ia/ia3.js';

const CLE_PAR_DEFAUT = 'toc.partieLocale';

export class SessionLocale {
  /**
   * @param {Object} [options]
   * @param {Object} [options.reglages]   { cinqAdverse }
   * @param {number} [options.nbJoueurs]  4 (défaut) ou 3 (1 humain + 2 IA, chacun pour soi)
   * @param {string} [options.pseudo]     pseudo du joueur humain
   * @param {string} [options.nom]        nom de la partie
   * @param {number} [options.delaiIA]    délai (ms) avant chaque action d'une IA
   * @param {number} [options.budgetIA]   temps de réflexion (ms) accordé à l'IA par coup
   * @param {string|string[]} [options.niveaux]  force des IA : un niveau pour toutes (ex. 'expert'),
   *                                      ou un niveau par siège (le siège 0, humain, est ignoré).
   *                                      Voir NIVEAUX dans ia/ia.js ; absent = le plus fort.
   * @param {Storage} [options.stockage]  ex. localStorage, pour sauvegarder la partie
   * @param {string} [options.cle]        clé de stockage
   * @param {boolean} [options.reprendre] reprendre la partie sauvegardée si elle existe
   */
  constructor(options = {}) {
    this.siege = 0;
    this.delaiIA = options.delaiIA ?? 900;
    this.budgetIA = options.budgetIA ?? 600;
    this.rng = options.rng || Math.random;
    this.stockage = options.stockage || null;
    this.cle = options.cle || CLE_PAR_DEFAUT;
    this.abonnes = new Set();
    this.minuterie = null;
    this.ferme = false;

    const sauvegarde = options.reprendre ? SessionLocale.lireSauvegarde(this.stockage, this.cle) : null;
    if (sauvegarde) {
      this.nom = sauvegarde.nom;
      this.joueurs = sauvegarde.joueurs;
      this.partie = sauvegarde.partie;
    } else {
      this.nom = options.nom || "Partie d'entraînement";
      const a3 = options.nbJoueurs === 3;
      this.joueurs = a3
        ? [
            { pseudo: options.pseudo || 'Toi', ia: false },
            { pseudo: 'IA Gauche', ia: true },
            { pseudo: 'IA Droite', ia: true },
          ]
        : [
            { pseudo: options.pseudo || 'Toi', ia: false },
            { pseudo: 'IA Est', ia: true },
            { pseudo: 'IA Partenaire', ia: true },
            { pseudo: 'IA Ouest', ia: true },
          ];
      // Force de chaque IA, gardée avec la partie (joueurs[s].niveau) pour la reprise.
      const { niveaux } = options;
      this.joueurs.forEach((j, s) => {
        const niveau = Array.isArray(niveaux) ? niveaux[s] : niveaux;
        if (j.ia && typeof niveau === 'string') j.niveau = niveau;
      });
      const reglages = a3 ? { ...(options.reglages || {}), nbJoueurs: 3 } : options.reglages || {};
      this.partie = nouvellePartie(reglages, this.rng);
      this.sauvegarder();
    }
    this.planifierIA();
  }

  /** Partie sauvegardée ({ nom, joueurs, partie }) ou null. */
  static lireSauvegarde(stockage, cle = CLE_PAR_DEFAUT) {
    if (!stockage) return null;
    try {
      const brut = stockage.getItem(cle);
      const donnees = brut ? JSON.parse(brut) : null;
      return donnees && donnees.partie && donnees.partie.etat ? donnees : null;
    } catch {
      return null;
    }
  }

  static effacerSauvegarde(stockage, cle = CLE_PAR_DEFAUT) {
    try {
      stockage?.removeItem(cle);
    } catch {
      /* stockage indisponible */
    }
  }

  sauvegarder() {
    if (!this.stockage) return;
    try {
      this.stockage.setItem(this.cle, JSON.stringify({ nom: this.nom, joueurs: this.joueurs, partie: this.partie }));
    } catch {
      /* stockage plein ou indisponible : on joue sans sauvegarde */
    }
  }

  vue() {
    const { etat, mains, dons, historique } = this.partie;
    const s = this.siege;
    return {
      id: 'locale',
      enLigne: false,
      nom: this.nom,
      siege: s,
      joueurs: this.joueurs,
      etat,
      main: mains[s].slice(),
      don: dons[s],
      recu: etat.phase === 'echange' ? null : dons[donneurDon(etat.donne, s, nombreJoueurs(etat))],
      historique,
    };
  }

  abonner(cb) {
    this.abonnes.add(cb);
    cb(this.vue());
    return () => this.abonnes.delete(cb);
  }

  notifier() {
    this.sauvegarder();
    const vue = this.vue();
    for (const cb of this.abonnes) cb(vue);
    this.planifierIA();
  }

  async donner(carte) {
    this.partie = donnerCarte(this.partie, this.siege, carte);
    this.notifier();
  }

  async jouer(coup) {
    this.partie = jouerCoup(this.partie, this.siege, coup, this.rng);
    this.notifier();
  }

  planifierIA() {
    if (this.ferme || this.minuterie) return;
    const { etat } = this.partie;
    let attente = false;
    if (etat.phase === 'echange') attente = this.joueurs.some((j, s) => j.ia && !etat.echanges[s]);
    else if (etat.phase === 'jeu') attente = this.joueurs[etat.tour].ia;
    if (!attente) return;
    this.minuterie = setTimeout(() => {
      this.minuterie = null;
      if (this.ferme) return;
      this.faireJouerIA();
    }, this.delaiIA);
  }

  faireJouerIA() {
    const { etat, mains, dons } = this.partie;
    const a3 = nombreJoueurs(etat) === 3;
    if (etat.phase === 'echange') {
      for (let s = 0; s < etat.echanges.length; s++) {
        if (this.joueurs[s].ia && !this.partie.etat.echanges[s]) {
          const carte = (a3 ? choisirDon3 : choisirDon)(this.partie.etat, s, this.partie.mains[s], {
            rng: this.rng,
            niveau: this.joueurs[s].niveau,
          });
          this.partie = donnerCarte(this.partie, s, carte);
        }
      }
    } else if (etat.phase === 'jeu' && this.joueurs[etat.tour].ia) {
      const s = etat.tour;
      const coup = (a3 ? choisirCoup3 : choisirCoup)(etat, s, mains[s], {
        rng: this.rng,
        budgetMs: this.budgetIA,
        niveau: this.joueurs[s].niveau,
        carteDonnee: dons[s],
        carteRecue: dons[donneurDon(etat.donne, s, nombreJoueurs(etat))],
      });
      this.partie = jouerCoup(this.partie, s, coup, this.rng);
    } else {
      return;
    }
    this.notifier();
  }

  async donneesAnalyse() {
    const { etat, historique, archives } = this.partie;
    const n = nombreJoueurs(etat);
    // Hors ligne, la sauvegarde garde les mains de tous les sièges : l'analyse peut porter sur n'importe quel joueur.
    const donnesDe = (s) =>
      (archives || []).map((a, d) =>
        a
          ? {
              distribuees: a.mains[s].slice(),
              donnee: a.dons[s],
              recue: a.dons.every(Boolean) ? a.dons[donneurDon(d, s, n)] : null,
            }
          : null,
      );
    const donnesParSiege = this.joueurs.map((_, s) => donnesDe(s));
    return { reglages: etat.reglages, joueurs: this.joueurs, siege: this.siege, historique, donnes: donnesParSiege[this.siege], donnesParSiege };
  }

  fermer() {
    this.ferme = true;
    if (this.minuterie) clearTimeout(this.minuterie);
    this.minuterie = null;
    this.abonnes.clear();
  }
}
