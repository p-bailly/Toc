// Session de jeu en ligne : même interface que SessionLocale (voir js/session-locale.js).
//
// - Écoute le document de la partie ; à chaque changement, relit (avec cache, ce sont des documents
//   immuables) les cartes distribuées et les dons utiles, puis publie la vue.
// - Fait jouer les IA de la partie : tout client connecté qui voit qu'une IA doit agir le fait par la
//   même transaction qu'un humain, en précisant le numéro de coup attendu ; si un autre client a été
//   plus rapide, la transaction est abandonnée sans bruit (ConflitIA). Le client qui vient d'agir
//   passe en premier, les autres attendent un délai aléatoire, ce qui limite les courses.
// - Compte la partie dans les statistiques du joueur quand elle se termine.
// - Spectateur : un joueur connecté qui n'est pas assis à la table regarde la partie. Sa vue n'a aucune carte
//   (les règles ne lui montrent ni main ni don), il ne joue pas, ne fait pas jouer les IA et rien n'est compté.

import { donneurDon, nombreJoueurs, coteDeEtat } from '../moteur/index.js';
import { ConflitIA, ErreurToc, chemins, couleurChoisie, enErreurToc, nbJoueursDe, niveauDe, reglagesPartie, siegeDe } from './commun.js';

/** Joueur tel que la vue le montre : { pseudo, ia }, la couleur choisie pour ses pions et, pour une IA, son niveau. */
const vueJoueur = (j) => (j?.ia ? { pseudo: j.pseudo ?? '?', ia: true, niveau: niveauDe(j), ...couleurChoisie(j) } : { pseudo: j?.pseudo ?? '?', ia: false, ...couleurChoisie(j) });
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
    // Rythme des IA (voir planifierIA) : 0,7 s de pause avant chaque action d'une IA pour le client qui
    // vient d'agir, plus son calcul (budget 0,5 s, le plus souvent bien moins) et la transaction.
    this.delaiIA = options.delaiIA ?? 700;
    this.attenteAutres = options.attenteAutres ?? [1500, 4000]; // délai supplémentaire (min, max) des autres clients
    this.budgetIA = options.budgetIA ?? 500;
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
    this.spectateur = false; // pas assis à la table : on regarde (voir recevoir)
    this.ferme = false;
    this.attentes = []; // { n, fin } : actions en attente de la vue correspondante
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
    if (p.statut === 'attente') throw new ErreurToc("La partie n'a pas encore commencé.");
    if (p.statut === 'abandonnee' && siegeDe(p, this.ctx.uid) < 0) throw new ErreurToc('Cette partie a été abandonnée.');
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
    // Pas assis à la table : on regarde. Aucune carte n'est lue (les règles n'en montrent aucune à un spectateur).
    this.spectateur = siege < 0;
    let prive = { main: [], don: null, recu: null };
    if (!this.spectateur) {
      try {
        prive = await chargerMain(this.lire, this.id, p.etat, siege);
      } catch (e) {
        console.warn('Lecture des cartes impossible', e);
        if (version === this.version) setTimeout(() => this.version === version && this.recevoir(p), 5000);
        return;
      }
      if (this.ferme || version !== this.version) return; // un état plus récent est arrivé entre-temps
    }
    this.partie = p;
    this.vueCourante = {
      id: this.id,
      enLigne: true,
      nom: p.nom,
      siege,
      joueurs: p.joueurs.map(vueJoueur),
      etat: p.etat,
      main: prive.main,
      don: prive.don,
      recu: prive.recu,
      historique: p.historique || [],
      statut: p.statut,
      ...(this.spectateur ? { spectateur: true } : {}),
    };
    for (const cb of this.abonnes) cb(this.vueCourante);
    this.libererAttentes();
    if (this.spectateur) return; // ni IA à faire jouer, ni partie à compter
    // Une action d'IA prévue pour un état dépassé n'a plus lieu d'être : on replanifie sur l'état reçu
    // (sinon la minuterie périmée se déclenchait pour rien et ajoutait un second délai complet).
    if (this.minuterie && this.prevu !== p.etat.numCoup) {
      clearTimeout(this.minuterie);
      this.minuterie = null;
    }
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

  // donner() et jouer() ne se résolvent qu'une fois la vue mise à jour (l'instantané de la partie arrive
  // un peu après la fin de la transaction) : sinon l'écran proposerait encore, un instant, de donner ou
  // de jouer, et un second toucher serait refusé.
  async donner(carte) {
    this.exigerJoueur();
    const n = await donnerCarte(this.ctx, this.id, this.vueCourante.siege, carte, { lire: this.lire });
    this.apresAction(n);
    await this.attendreVue(n);
  }

  async jouer(coup) {
    this.exigerJoueur();
    const n = await jouerCoup(this.ctx, this.id, this.vueCourante.siege, coup, { lire: this.lire });
    this.apresAction(n);
    await this.attendreVue(n);
  }

  /** Un spectateur regarde : il ne donne pas de carte et ne joue pas. */
  exigerJoueur() {
    if (this.spectateur) throw new ErreurToc('Tu regardes cette partie : tu n’y joues pas.');
  }

  /** Résout quand la vue publiée en est au coup n (10 s au plus). */
  attendreVue(n, delai = 10000) {
    if (this.ferme || (this.partie && this.partie.etat.numCoup >= n)) return Promise.resolve();
    return new Promise((fin) => {
      const a = { n, fin };
      a.minuterie = setTimeout(() => {
        this.attentes = this.attentes.filter((x) => x !== a);
        fin();
      }, delai);
      this.attentes.push(a);
    });
  }

  libererAttentes() {
    const numCoup = this.partie?.etat.numCoup ?? -1;
    for (const a of this.attentes.filter((x) => this.ferme || x.n <= numCoup)) {
      clearTimeout(a.minuterie);
      a.fin();
    }
    this.attentes = this.attentes.filter((x) => !this.ferme && x.n > numCoup);
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
      for (let s = 0; s < p.joueurs.length; s++) if (p.joueurs[s]?.ia && !etat.echanges[s]) return s;
    } else if (etat.phase === 'jeu' && p.joueurs[etat.tour]?.ia) {
      return etat.tour;
    }
    return -1;
  }

  planifierIA() {
    if (this.ferme || this.spectateur || this.iaEnCours || this.minuterie || !this.ia) return;
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
      // IA à 3 joueurs : celle du mode à 3 (l'IA forte ne joue qu'à 4).
      const a3 = nombreJoueurs(etat) === 3;
      const choisirDon = a3 ? this.ia.choisirDon3 : this.ia.choisirDon;
      const choisirCoup = a3 ? this.ia.choisirCoup3 : this.ia.choisirCoup;
      const niveau = niveauDe(this.partie.joueurs[s]); // place sans niveau (partie d'avant) : champion
      if (etat.phase === 'echange') {
        const carte = choisirDon(etat, s, prive.main, { rng: this.rng, niveau });
        n = await donnerCarte(this.ctx, this.id, s, carte, { lire: this.lire, numCoupAttendu: numCoup });
      } else {
        const coup = choisirCoup(etat, s, prive.main, {
          rng: this.rng,
          budgetMs: this.budgetIA,
          niveau,
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

  /**
   * Données de l'analyse de fin de partie (lectures simples, en parallèle, sans écoute) :
   * { reglages, joueurs, siege, historique, donnes } ; donnes[d] = { distribuees, donnee, recue }
   * pour le siège local, de la donne 0 à la dernière commencée (null si pas encore disponible).
   */
  async donneesAnalyse() {
    try {
      const p = await this.ctx.magasin.lire(chemins.partie(this.id));
      if (!p || !p.etat) throw new ErreurToc("Cette partie n'existe plus.", 'not-found');
      const siege = siegeDe(p, this.ctx.uid);
      // L'analyse part des cartes qu'on a eues en main : un spectateur n'en a aucune.
      if (siege < 0) throw new ErreurToc('L’analyse est réservée aux joueurs de la partie.');
      const { etat } = p;
      const lectures = [];
      for (let d = 0; d <= etat.donne; d++) {
        const courante = d === etat.donne;
        const aDonne = !courante || etat.echanges[siege];
        const echangeFini = !courante || etat.phase !== 'echange';
        lectures.push(
          Promise.all([
            this.lire(chemins.donne(this.id, d, siege)),
            aDonne ? this.lire(chemins.don(this.id, d, siege)) : null,
            echangeFini ? this.lire(chemins.don(this.id, d, donneurDon(d, siege, nombreJoueurs(etat)))) : null,
          ]).then(([dist, don, recu]) => ({
            distribuees: dist ? dist.cartes.slice() : [],
            donnee: don?.carte ?? null,
            recue: recu?.carte ?? null,
          })),
        );
      }
      return {
        // Le plateau se lit dans l'état de la partie (voir moteur/plateau.js) : il faut le même pour la rejouer.
        reglages: { ...reglagesPartie(p.reglages?.cinqAdverse, nbJoueursDe(p.reglages)), plateau: coteDeEtat(p.etat) },
        joueurs: p.joueurs.map(vueJoueur),
        siege,
        historique: p.historique || [],
        donnes: await Promise.all(lectures),
      };
    } catch (e) {
      throw enErreurToc(e);
    }
  }

  fermer() {
    this.ferme = true;
    this.libererAttentes();
    if (this.minuterie) clearTimeout(this.minuterie);
    this.minuterie = null;
    if (this.desabonner) this.desabonner();
    this.desabonner = null;
    this.abonnes.clear();
  }
}

