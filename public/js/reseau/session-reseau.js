// Session de jeu en ligne : même interface que SessionLocale (voir js/session-locale.js).
//
// - Écoute le document de la partie ; à chaque changement, relit (avec cache, ce sont des documents
//   immuables) les cartes distribuées et les dons utiles, puis publie la vue.
// - Fait jouer les IA de la partie : tout client connecté qui voit qu'une IA doit agir le fait par la
//   même transaction qu'un humain, en précisant le numéro de coup attendu ; si un autre client a été
//   plus rapide, la transaction est abandonnée sans bruit (ConflitIA). Le client qui vient d'agir
//   passe en premier, les autres attendent un délai aléatoire, ce qui limite les courses.
// - Compte la partie dans les statistiques du joueur quand elle se termine.

import { partenaire } from '../moteur/index.js';
import { ConflitIA, ErreurToc, chemins, enErreurToc, siegeDe } from './commun.js';
import { comptabiliserPartie } from './comptes.js';
import { chargerMain, creerLecteurMains, donnerCarte, jouerCoup } from './parties.js';

export class SessionReseau {
  /**
   * @param {Object} ctx      { magasin, uid, rng, delaiReseau }
   * @param {string} id       identifiant de la partie
   * @param {Object} options  { ia: { choisirDon, choisirCoup }, delaiIA, attenteAutres, budgetIA, rng }
   */
  constructor(ctx, id, options = {}) {
    this.ctx = ctx;
    this.id = id;
    this.ia = options.ia;
    this.delaiIA = options.delaiIA ?? 900;
    this.attenteAutres = options.attenteAutres ?? [1500, 4000]; // délai supplémentaire (min, max) des autres clients
    this.budgetIA = options.budgetIA ?? 600;
    this.rng = options.rng || ctx.rng || Math.random;
    this.lire = creerLecteurMains(ctx.magasin, id);
    this.abonnes = new Set();
    this.vueCourante = null;
    this.partie = null;
    this.version = 0;
    this.minuterie = null;
    this.prevu = -1; // numCoup pour lequel une action d'IA est planifiée
    this.dernierActe = -1; // numCoup obtenu par la dernière action réussie de ce client
    this.echecs = 0;
    this.iaEnCours = false;
    this.comptee = false;
    this.ferme = false;
    this.desabonner = null;
  }

  /** Ouvre la session : vérifie la partie, attend la première vue. */
  static async ouvrir(ctx, id, options) {
    const s = new SessionReseau(ctx, id, options);
    await s.demarrer();
    return s;
  }

  async demarrer() {
    let p;
    try {
      p = await this.ctx.magasin.lire(chemins.partie(this.id));
    } catch (e) {
      throw enErreurToc(e);
    }
    if (!p) throw new ErreurToc("Cette partie n'existe plus.", 'not-found');
    if (siegeDe(p, this.ctx.uid) < 0) throw new ErreurToc('Tu ne participes pas à cette partie.');
    if (p.statut === 'attente') throw new ErreurToc("La partie n'a pas encore commencé.");
    await this.recevoir(p);
    if (!this.vueCourante) throw new ErreurToc('Impossible de lire tes cartes : vérifie ta connexion.');
    this.desabonner = this.ctx.magasin.ecouter(
      chemins.partie(this.id),
      (d) => this.recevoir(d),
      (e) => console.warn('Écoute de la partie interrompue', e),
    );
  }

  /** Nouveau document de partie : relit les mains utiles puis publie la vue. */
  async recevoir(p) {
    if (this.ferme || !p || !p.etat) return;
    // Les écoutes peuvent livrer un état plus ancien que celui déjà connu (cache local) : on l'ignore.
    if (this.partie && p.etat.numCoup < this.partie.etat.numCoup) return;
    const version = ++this.version;
    const siege = siegeDe(p, this.ctx.uid);
    let prive;
    try {
      prive = await chargerMain(this.lire, this.id, p.etat, siege);
    } catch (e) {
      console.warn('Lecture des cartes impossible', e);
      if (version === this.version) setTimeout(() => this.version === version && this.recevoir(p), 5000);
      return;
    }
    if (this.ferme || version !== this.version) return; // un état plus récent est arrivé entre-temps
    this.partie = p;
    this.vueCourante = {
      id: this.id,
      enLigne: true,
      nom: p.nom,
      siege,
      joueurs: p.joueurs.map((j) => ({ pseudo: j?.pseudo ?? '?', ia: !!j?.ia })),
      etat: p.etat,
      main: prive.main,
      don: prive.don,
      recu: prive.recu,
      historique: p.historique || [],
      statut: p.statut,
    };
    for (const cb of this.abonnes) cb(this.vueCourante);
    if (p.statut === 'finie') this.compter();
    this.planifierIA();
  }

  vue() {
    return this.vueCourante;
  }

  abonner(cb) {
    this.abonnes.add(cb);
    if (this.vueCourante) cb(this.vueCourante);
    return () => this.abonnes.delete(cb);
  }

  async donner(carte) {
    const n = await donnerCarte(this.ctx, this.id, this.vueCourante.siege, carte, { lire: this.lire });
    this.apresAction(n);
  }

  async jouer(coup) {
    const n = await jouerCoup(this.ctx, this.id, this.vueCourante.siege, coup, { lire: this.lire });
    this.apresAction(n);
  }

  /** Ce client vient d'agir : c'est à lui d'enchaîner les IA, sans attendre. */
  apresAction(numCoup) {
    this.dernierActe = numCoup;
    this.echecs = 0;
    if (this.minuterie && this.partie?.etat.numCoup === numCoup) {
      clearTimeout(this.minuterie);
      this.minuterie = null;
    }
    this.planifierIA();
  }

  async compter() {
    if (this.comptee) return;
    this.comptee = true;
    try {
      await comptabiliserPartie(this.ctx, this.id, this.partie);
    } catch (e) {
      this.comptee = false; // nouvel essai à la prochaine ouverture
      console.warn('Statistiques non mises à jour', e);
    }
  }

  /** Siège d'IA qui doit agir maintenant, ou -1. */
  siegeIAEnAttente() {
    const p = this.partie;
    if (!p || p.statut !== 'encours') return -1;
    const { etat } = p;
    if (etat.phase === 'echange') {
      for (let s = 0; s < 4; s++) if (p.joueurs[s]?.ia && !etat.echanges[s]) return s;
    } else if (etat.phase === 'jeu' && p.joueurs[etat.tour]?.ia) {
      return etat.tour;
    }
    return -1;
  }

  planifierIA() {
    if (this.ferme || this.iaEnCours || this.minuterie || !this.ia) return;
    if (this.siegeIAEnAttente() < 0) return;
    const numCoup = this.partie.etat.numCoup;
    let delai = this.delaiIA;
    if (this.dernierActe !== numCoup) {
      const [min, max] = this.attenteAutres;
      delai += min + this.rng() * (max - min);
    }
    if (this.echecs) delai += Math.min(60000, 2000 * 2 ** this.echecs);
    this.prevu = numCoup;
    this.minuterie = setTimeout(() => {
      this.minuterie = null;
      this.faireJouerIA(numCoup);
    }, delai);
  }

  async faireJouerIA(numCoup) {
    if (this.ferme || !this.partie || this.partie.etat.numCoup !== numCoup) return this.planifierIA();
    const s = this.siegeIAEnAttente();
    if (s < 0) return;
    const etat = this.partie.etat;
    this.iaEnCours = true;
    try {
      // Cartes de l'IA (lisibles par tout membre de la partie), lues hors transaction : immuables.
      const prive = await chargerMain(this.lire, this.id, etat, s);
      let n;
      if (etat.phase === 'echange') {
        const carte = this.ia.choisirDon(etat, s, prive.main, { rng: this.rng });
        n = await donnerCarte(this.ctx, this.id, s, carte, { lire: this.lire, numCoupAttendu: numCoup });
      } else {
        const coup = this.ia.choisirCoup(etat, s, prive.main, {
          rng: this.rng,
          budgetMs: this.budgetIA,
          carteDonnee: prive.don,
          carteRecue: prive.recu,
        });
        n = await jouerCoup(this.ctx, this.id, s, coup, { lire: this.lire, numCoupAttendu: numCoup });
      }
      this.dernierActe = n;
      this.echecs = 0;
    } catch (e) {
      if (!(e instanceof ConflitIA)) {
        this.echecs += 1;
        console.warn("Action de l'IA non enregistrée", e);
      }
    } finally {
      this.iaEnCours = false;
    }
    this.planifierIA();
  }

  fermer() {
    this.ferme = true;
    if (this.minuterie) clearTimeout(this.minuterie);
    this.minuterie = null;
    if (this.desabonner) this.desabonner();
    this.desabonner = null;
    this.abonnes.clear();
  }
}

export { partenaire };
