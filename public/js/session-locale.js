// Session de jeu locale : un humain (siège 0) contre trois IA, sans réseau.
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
//
//   vue = {
//     id,            identifiant de la partie ('locale' hors ligne)
//     enLigne,       booléen
//     nom,           nom de la partie
//     siege,         siège du joueur local (0 à 3)
//     joueurs,       [{ pseudo, ia }] × 4, indexé par siège
//     etat,          état public du moteur (voir moteur/regles.js)
//     main,          cartes du joueur local (tableau de chaînes, déjà à jour)
//     don,           carte que le joueur local a donnée pour la donne en cours, ou null
//     recu,          carte reçue du partenaire (connue une fois la phase 'jeu' commencée), ou null
//     historique,    [{ n, siege, coup, captures }] du plus ancien au plus récent
//   }
// ──────────────────────────────────────────────────────────────────────────────

import { nouvellePartie, donnerCarte, jouerCoup, partenaire } from './moteur/index.js';
import { choisirCoup, choisirDon } from './ia/ia.js';

const CLE_PAR_DEFAUT = 'toc.partieLocale';

export class SessionLocale {
  /**
   * @param {Object} [options]
   * @param {Object} [options.reglages]   { cinqAdverse }
   * @param {string} [options.pseudo]     pseudo du joueur humain
   * @param {string} [options.nom]        nom de la partie
   * @param {number} [options.delaiIA]    délai (ms) avant chaque action d'une IA
   * @param {number} [options.budgetIA]   temps de réflexion (ms) accordé à l'IA par coup
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
      this.joueurs = [
        { pseudo: options.pseudo || 'Vous', ia: false },
        { pseudo: 'IA Est', ia: true },
        { pseudo: 'IA Partenaire', ia: true },
        { pseudo: 'IA Ouest', ia: true },
      ];
      this.partie = nouvellePartie(options.reglages || {}, this.rng);
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
      recu: etat.phase === 'echange' ? null : dons[partenaire(s)],
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
    if (etat.phase === 'echange') {
      for (let s = 0; s < 4; s++) {
        if (this.joueurs[s].ia && !this.partie.etat.echanges[s]) {
          const carte = choisirDon(this.partie.etat, s, this.partie.mains[s], { rng: this.rng });
          this.partie = donnerCarte(this.partie, s, carte);
        }
      }
    } else if (etat.phase === 'jeu' && this.joueurs[etat.tour].ia) {
      const s = etat.tour;
      const coup = choisirCoup(etat, s, mains[s], {
        rng: this.rng,
        budgetMs: this.budgetIA,
        carteDonnee: dons[s],
        carteRecue: dons[partenaire(s)],
      });
      this.partie = jouerCoup(this.partie, s, coup, this.rng);
    } else {
      return;
    }
    this.notifier();
  }

  async donneesAnalyse() {
    const { etat, historique, archives } = this.partie;
    const s = this.siege;
    const donnes = (archives || []).map((a) =>
      a
        ? {
            distribuees: a.mains[s].slice(),
            donnee: a.dons[s],
            recue: a.dons.every(Boolean) ? a.dons[partenaire(s)] : null,
          }
        : null,
    );
    return { reglages: etat.reglages, joueurs: this.joueurs, siege: s, historique, donnes };
  }

  fermer() {
    this.ferme = true;
    if (this.minuterie) clearTimeout(this.minuterie);
    this.minuterie = null;
    this.abonnes.clear();
  }
}
