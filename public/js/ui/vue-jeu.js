// Écran de jeu, commun à la partie d'entraînement et aux parties en ligne : il ne connaît que l'interface
// « Session » (voir session-locale.js) et interroge le moteur pour tout ce qui est règle.
//
// Agencement (comme l'écran de jeu de l'appli Scrabble) : barre du haut, plateau d'un bord à l'autre, main du
// joueur dans le bac bleu, ligne de consigne (ce qu'il faut faire, à qui le tour), puis les boutons. Sur grand écran, le plateau
// passe à gauche et le reste forme une colonne à droite.

import { h, remplacer, messageErreur, pluriel, mouvementReduit, lire, ecrire } from './dom.js';
import {
  coupsLegaux,
  mainJouable,
  etapesSeptPossibles,
  apercuCoup,
  couleurActive,
  aFini,
  partenaire,
  rang,
  BASE,
  ALLEE,
  nombreJoueurs,
  destinataireDon,
  donneurDon,
  siegesGagnants,
  estJoker,
  cartesDeLaDonne,
  coupsLegauxMain,
  rejouerPartie,
  reglagesRejeu,
} from '../moteur/index.js';
import { Plateau } from './plateau.js';
import { dessinCarte } from './carte.js';
import { ouvrirFeuille } from './composants.js';
import { piRetour, piHistorique, piOk, piAnnuler, piConseil, piRevoir, piPrecedent, piSuivant, piLoupe, piDrapeau } from './pictos.js';
import { activerZoom } from './zoom-plateau.js';
import * as IA from '../ia/ia.js';
import { trierMain, ordonnerMain, deplacer, detailJournal, carteCourte, libelleChoix, ligneJournal, enumerer, nomCarte, decrireAction, rangAvecArticle, leCarte } from './libelles.js';
import { couleurSiege, couleurFonceeSiege, couleursPartie, appliquerCouleurs, nomCouleurPartie, PIONS } from './couleurs.js';
import { lireReglages, rythme, VITESSE_ESSAIS } from './reglages.js';
import { nomNiveau } from './niveaux.js';
import { majMonTour, notifier } from './notifications.js';
import { s } from './dom.js';

const NOMS_FORMES = { rond: '●', carre: '■', triangle: '▲', losange: '◆' };

/**
 * Monte l'écran de jeu dans `racine`.
 * @param {Object} o
 * @param {Object} o.session        Session (abonner, donner, jouer, fermer ; annuler si la partie le permet :
 *                                  parties contre l'IA seulement, voir session-locale.js)
 * @param {string} o.retour         hash du bouton retour
 * @param {Function} [o.rejouer]    partie d'entraînement : relancer une partie
 * @param {Object} [o.abandon]      partie en ligne : { bandeau, proposer } = l'élément où l'écran appelant affiche
 *                                  la proposition d'abandon en cours, et ce que fait le bouton « Abandonner »
 * @returns {Function} destruction
 */
export function monterJeu(racine, { session, retour, libelleRetour = 'Retour', rejouer = null, conseils = false, analyse = null, essais = false, abandon = null }) {
  const plateau = new Plateau({ surPion: (g) => toucherPion(g), surCible: (i) => toucherCible(i) });

  const titre = h('span', { class: 'texte' }, 'Toc');
  const sousTitre = h('span', { class: 'sous' });
  // Conseils de l'IA : parties d'entraînement seulement, et si l'IA les propose.
  const conseilsDispo = conseils && typeof IA.conseillerCoup === 'function' && typeof IA.conseillerDon === 'function';
  const boutonConseil = h(
    'button',
    { type: 'button', class: 'bouton-icone', 'aria-label': 'Conseil de l’IA', title: 'Conseil', hidden: !conseilsDispo, 'data-action': 'conseil', onclick: () => ouvrirConseil() },
    piConseil(),
  );
  const boutonConseilPlace = () => boutonConseil;
  const boutonJournal = h('button', { type: 'button', class: 'bouton-icone', 'aria-label': 'Journal des coups', title: 'Journal des coups', onclick: () => ouvrirJournal() }, piHistorique());
  // Revoir les coups précédents un par un, sur le plateau (voir « Revue des coups »).
  const boutonRevoir = h(
    'button',
    { type: 'button', class: 'bouton-icone', 'aria-label': 'Revoir les coups précédents', title: 'Revoir les coups', 'data-action': 'revoir', onclick: () => (revue ? quitterRevue() : ouvrirRevue()) },
    piRevoir(),
  );
  // Partie en ligne : proposer aux autres joueurs d'abandonner la partie (elle l'est si tous acceptent).
  const boutonAbandon = abandon
    ? h('button', { type: 'button', class: 'bouton-icone', 'aria-label': 'Abandonner la partie', title: 'Abandonner la partie', 'data-action': 'abandonner', onclick: () => abandon.proposer() }, piDrapeau())
    : null;
  const barre = h(
    'header',
    { class: 'barre-jeu' },
    h('a', { class: 'bouton-icone', href: retour, 'aria-label': libelleRetour }, piRetour()),
    h('div', { class: 'titre' }, titre, sousTitre),
    boutonConseilPlace(),
    boutonAbandon,
    boutonRevoir,
    boutonJournal,
  );
  // Le plateau s'agrandit pour mieux voir (pincement, double toucher, bouton loupe) : voir zoom-plateau.js.
  const boutonZoom = h('button', { type: 'button', class: 'bouton-zoom', 'aria-label': 'Agrandir le plateau', title: 'Agrandir le plateau', 'aria-pressed': 'false', 'data-action': 'zoom', onclick: () => zoom.basculer() }, piLoupe());
  const zonePlateau = h('div', { class: 'zone-plateau pleine' }, plateau.el, boutonZoom);
  const zoom = activerZoom(zonePlateau, plateau.el, {
    surChange: (k) => {
      const agrandi = k > 1;
      boutonZoom.setAttribute('aria-pressed', String(agrandi));
      boutonZoom.setAttribute('aria-label', agrandi ? 'Revoir le plateau entier' : 'Agrandir le plateau');
      boutonZoom.title = agrandi ? 'Plateau entier' : 'Agrandir le plateau';
      boutonZoom.replaceChildren(piLoupe(18, agrandi));
    },
  });
  const main = h('div', { class: 'chevalet main-joueur', role: 'group', 'aria-label': 'Tes cartes (fais-les glisser de côté pour les ranger, ou vers le plateau pour les jouer)' });
  const consigne = h('div', { class: 'apercu consigne', role: 'status', 'aria-live': 'polite' });
  const actions = h('div', { class: 'actions choix-coup' });
  // Journal visible en permanence sur grand écran (masqué sur téléphone : il reste dans sa feuille).
  const journalPanneau = h('div', { class: 'journal-panneau' });
  const colonne = h('div', { class: 'colonne-jeu' }, abandon?.bandeau || null, main, consigne, h('div', { class: 'panneau-bas' }, actions), journalPanneau);
  const ecran = h('div', { class: 'ecran-jeu' }, barre, zonePlateau, colonne);
  remplacer(racine, ecran);

  // ─── État de la saisie ────────────────────────────────────────────────────
  let vue = null;
  let carte = null; // carte choisie
  let pion = null; // pion choisi
  let coupPret = null; // coup en attente de confirmation
  let sept = null; // { etapes, pions, captures } pendant la saisie d'un 7
  let envoi = false;
  let recuSignale = null;
  let recuArrive = null; // { cle, t } : moment où la carte reçue est apparue dans la main (son entrée animée)
  let finMontree = false;
  // Rangement de la main : l'ordre choisi par le joueur pour la donne en cours ({ cle, cartes }), et la carte qu'il
  // est en train de faire glisser ({ el, id, x0, y0, actif, mode }) : mode 'rangement' (de côté, dans la main) ou
  // 'table' (vers le plateau, pour la jouer).
  let ordreMain = null;
  let glisse = null;
  let sansClicJusqua = 0;
  // Carte tenue au-dessus du plateau : une copie posée sur la page, au-dessus de tout (la carte d'origine, restée
  // dans la main, est masquée le temps du geste).
  let carteFlottante = null;
  // Revue des coups précédents : { tours, histo, index } tant que le joueur les fait défiler sur le plateau.
  let revue = null;
  let minuterieRevue = null;
  // Journal : filtre choisi dans la feuille (un joueur, sans les défausses) ; donne de chaque coup, par longueur d'historique.
  const filtreJournal = { siege: null, sansDefausses: false };
  let donnesJournal = { n: -1, donnes: [] };
  let feuilleFin = null;
  let feuilleJournal = null;
  let monTourAvant = false;
  let ciblesCourantes = [];
  let feuilleConseil = null;
  let comme = null; // joker (jeu à 3) : rang copié choisi
  let avis = null; // message bref affiché dans la consigne : { texte, erreur }
  let minuterieAvis = null;
  // File de présentation : les coups arrivés sont montrés un par un, dans l'ordre, chacun animé avec un temps de
  // lecture ; le joueur n'agit qu'une fois la file vidée (ou passée).
  let vueReelle = null;
  let nHisto = -1; // nombre de coups de l'historique déjà présentés
  let enPresentation = false;
  let restants = 0;
  let passer = false;
  let finAttente = null;
  // Coup unique joué tout seul : un seul déclenchement par position.
  const autoFaits = new Set();
  let resume = null; // résumé des coups passés sans les voir
  let minuterieAuto = null;
  let coupAuto = null;

  const reinitialiser = () => {
    carte = null;
    pion = null;
    coupPret = null;
    sept = null;
    comme = null;
  };

  /** Nombre de joueurs de la partie (3 ou 4). */
  const nb = () => nombreJoueurs(vue.etat);

  /**
   * Message bref de l'écran de jeu (carte reçue, commentaire, erreur) : il s'affiche dans la consigne, sous le
   * plateau, et ne recouvre donc jamais un bouton ni une carte.
   */
  function annoncer(texte, { erreur = false, duree = 4000 } = {}) {
    avis = { texte, erreur };
    clearTimeout(minuterieAvis);
    minuterieAvis = setTimeout(() => {
      avis = null;
      if (vue) rendre();
    }, duree);
    if (vue) rendre();
  }

  // ─── Rangement de la main : le joueur fait glisser ses cartes pour les mettre dans l'ordre qu'il veut ─────────
  // L'ordre vaut pour la donne en cours (il est retenu sur l'appareil) ; la carte reçue et la donne suivante arrivent
  // triées. Au clavier : Maj + flèche gauche ou droite sur une carte.
  const CLE_ORDRE = 'toc.ordreMain';
  const cleOrdre = () => `${vue.id ?? vue.nom}|${vue.etat.donne}`;

  function cartesOrdonnees() {
    if (!ordreMain) {
      const garde = lire(CLE_ORDRE, null);
      ordreMain = garde && typeof garde.cle === 'string' && Array.isArray(garde.cartes) ? garde : { cle: '', cartes: [] };
    }
    return ordreMain.cle === cleOrdre() ? ordonnerMain(vue.main, ordreMain.cartes) : trierMain(vue.main);
  }

  function rangerMain(cartes) {
    ordreMain = { cle: cleOrdre(), cartes };
    ecrire(CLE_ORDRE, ordreMain);
  }

  const cartesAffichees = () => [...main.querySelectorAll('button.carte-jeu')];

  main.addEventListener('pointerdown', (e) => {
    const el = e.target.closest?.('button.carte-jeu');
    if (!el || e.button > 0 || glisse || revue || !vue) return;
    glisse = { el, id: e.pointerId, x0: e.clientX, y0: e.clientY, actif: false, mode: null, ordre: cartesAffichees() };
  });
  main.addEventListener('pointermove', (e) => {
    if (!glisse || e.pointerId !== glisse.id) return;
    const { el } = glisse;
    glisse.dernierX = e.clientX;
    glisse.dernierY = e.clientY;
    if (!glisse.actif) {
      // Un toucher choisit la carte ; elle ne se déplace qu'après un vrai glissement : vers le haut, elle part vers le
      // plateau (pour la jouer) ; de côté, elle change de place dans la main.
      const dx = e.clientX - glisse.x0;
      const dy = e.clientY - glisse.y0;
      if (Math.hypot(dx, dy) < 10) return;
      const versTable = dy < 0 && -dy > Math.abs(dx);
      if (!versTable && cartesAffichees().length < 2) {
        glisse = null;
        return;
      }
      if (!el.isConnected) {
        glisse = null;
        return;
      }
      glisse.actif = true;
      glisse.mode = versTable ? 'table' : 'rangement';
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* pointeur déjà relâché */
      }
      if (versTable) prendreCarte(el);
      else {
        el.classList.add('glisse');
        main.classList.add('rangement');
      }
    }
    e.preventDefault();
    // Rangement qui sort de la main (vers le plateau, qui est à côté sur un grand écran) : la carte part vers la table.
    if (glisse.mode === 'rangement') {
      const r = main.getBoundingClientRect();
      if (e.clientY < r.top - 12 || e.clientY > r.bottom + 12 || e.clientX < r.left - 12 || e.clientX > r.right + 12) {
        glisse.mode = 'table';
        el.classList.remove('glisse');
        main.classList.remove('rangement');
        // La carte quitte la main : celle-ci reprend l'ordre d'avant le geste. On replace les autres cartes autour
        // d'elle sans jamais la déplacer, elle (déplacée, elle perdrait le pointeur qu'elle tient).
        const x = el.getBoundingClientRect().left;
        const i = glisse.ordre.indexOf(el);
        for (const c of glisse.ordre.slice(0, i)) if (c.isConnected) main.insertBefore(c, el);
        let apres = el;
        for (const c of glisse.ordre.slice(i + 1)) {
          if (!c.isConnected) continue;
          main.insertBefore(c, apres.nextSibling);
          apres = c;
        }
        glisse.x0 += el.getBoundingClientRect().left - x;
        prendreCarte(el);
      }
    }
    if (glisse.mode === 'table') {
      // La carte suit le doigt, au-dessus de tout ; le plateau s'éclaire quand elle est au-dessus de lui.
      if (carteFlottante) carteFlottante.style.transform = `translate(${e.clientX - glisse.x0}px, ${e.clientY - glisse.y0}px) scale(0.9)`;
      zonePlateau.classList.toggle('depot-carte', auDessusDuPlateau(e));
      return;
    }
    const dx = e.clientX - glisse.x0;
    el.style.transform = `translateX(${dx}px)`;
    // La carte prend la place de sa voisine dès que son milieu la dépasse. On déplace la voisine, jamais la carte
    // tenue (elle perdrait le pointeur), et la voisine glisse à sa nouvelle place.
    const cadre = el.getBoundingClientRect();
    const centre = cadre.left + cadre.width / 2;
    const milieu = (v) => cadre.left - dx + (v.offsetLeft - el.offsetLeft) + v.offsetWidth / 2;
    const voisine = (v) => (v?.matches?.('button.carte-jeu') ? v : null);
    const suivante = voisine(el.nextElementSibling);
    const precedente = voisine(el.previousElementSibling);
    const echanger = (v, apres) => {
      const gaucheCarte = el.offsetLeft;
      const gaucheVoisine = v.offsetLeft;
      if (apres) main.insertBefore(v, el);
      else main.insertBefore(v, el.nextSibling);
      glisse.x0 += el.offsetLeft - gaucheCarte;
      el.style.transform = `translateX(${e.clientX - glisse.x0}px)`;
      if (!mouvementReduit()) v.animate([{ transform: `translateX(${gaucheVoisine - v.offsetLeft}px)` }, { transform: 'none' }], { duration: 140, easing: 'ease-out' });
    };
    if (suivante && centre > milieu(suivante)) echanger(suivante, true);
    else if (precedente && centre < milieu(precedente)) echanger(precedente, false);
  });
  /**
   * La carte part vers le plateau : une copie flottante, à sa place exacte, la remplace sous le doigt (rien sur la
   * page ne peut la masquer ni la rogner, pas même le plateau, qui a sa propre couche de dessin).
   */
  function prendreCarte(el) {
    el.style.transform = '';
    const r = el.getBoundingClientRect();
    carteFlottante?.remove();
    carteFlottante = el.cloneNode(true);
    carteFlottante.classList.add('carte-flottante');
    carteFlottante.removeAttribute('data-carte');
    carteFlottante.setAttribute('aria-hidden', 'true');
    Object.assign(carteFlottante.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    // Même place qu'à l'instant : le décalage du doigt depuis le début du geste est repris tel quel.
    carteFlottante.style.transform = `translate(${glisse.dernierX - glisse.x0}px, ${glisse.dernierY - glisse.y0}px) scale(0.9)`;
    document.body.append(carteFlottante);
    el.classList.add('tenue');
    main.classList.add('vers-table');
  }

  function lacherCarte(el) {
    carteFlottante?.remove();
    carteFlottante = null;
    el.classList.remove('tenue');
  }

  const finGlisse = (e) => {
    if (!glisse || e.pointerId !== glisse.id) return;
    const g = glisse;
    glisse = null;
    if (!g.actif) return;
    lacherCarte(g.el);
    g.el.classList.remove('glisse');
    g.el.style.transform = '';
    main.classList.remove('rangement', 'vers-table');
    zonePlateau.classList.remove('depot-carte');
    // Le relâchement ne doit pas compter comme un toucher de la carte (le clic suit le relâchement, parfois avec un
    // temps de retard sur un écran tactile).
    sansClicJusqua = Date.now() + 350;
    if (!vue) return;
    if (g.mode === 'table') {
      if (e.type === 'pointerup' && auDessusDuPlateau(e)) poserSurTable(g.el.dataset.carte, e);
      return;
    }
    rangerMain(cartesAffichees().map((b) => b.dataset.carte));
    rendre();
  };

  /** Le pointeur est-il au-dessus du plateau ? */
  function auDessusDuPlateau(e) {
    const r = zonePlateau.getBoundingClientRect();
    return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  }

  /** Pion le plus proche du point (coordonnées de l'écran) parmi `pions`, s'il est assez près pour être visé. */
  function pionVise(pions, x, y) {
    let meilleur = null;
    let distance = Infinity;
    for (const g of pions) {
      const el = zonePlateau.querySelector(`[data-pion-dessin="${g}"]`);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      const d = Math.hypot(x - (r.left + r.width / 2), y - (r.top + r.height / 2));
      if (d < distance && d <= Math.max(22, r.width * 1.3)) {
        distance = d;
        meilleur = g;
      }
    }
    return meilleur;
  }

  /**
   * Carte lâchée sur le plateau : pendant l'échange, elle est donnée ; à son tour, elle est jouée comme si on l'avait
   * touchée, et lâchée sur un de ses pions, c'est ce pion qui la joue. Le coup est montré avant de partir, comme
   * d'habitude (réglage « Voir le coup avant de le valider »).
   */
  function poserSurTable(c, e) {
    if (!c || !vue.main.includes(c) || enPresentation || revue || envoi) return;
    const { etat, siege } = vue;
    if (etat.phase === 'echange') {
      if (vue.don) return;
      carte = c;
      if (lireReglages().confirmerCoup) rendre();
      else donner();
      return;
    }
    if (etat.phase !== 'jeu' || etat.tour !== siege) {
      annoncer('Ce n’est pas encore à toi de jouer.');
      return;
    }
    if (carte !== c) {
      reinitialiser();
      toucherCarte(c);
    }
    // La carte est choisie ; un coup est peut-être déjà prêt (seul coup possible, ou défausse).
    if (carte !== c || coupPret || envoi || (estJoker(c) && !comme)) return;
    const pions = sept ? (etatSept()?.options || []).map((o) => o.pion) : coupsCarte(c).map((k) => k.pion);
    const g = pionVise(new Set(pions), e.clientX, e.clientY);
    if (g === null) return;
    if (sept) {
      pion = g;
      rendre();
    } else toucherPion(g);
  }
  main.addEventListener('pointerup', finGlisse);
  main.addEventListener('pointercancel', finGlisse);
  main.addEventListener(
    'click',
    (e) => {
      if (Date.now() < sansClicJusqua) {
        e.stopPropagation();
        e.preventDefault();
      }
    },
    true,
  );
  main.addEventListener('keydown', (e) => {
    if (!e.shiftKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') || revue || !vue) return;
    const el = e.target.closest?.('button.carte-jeu');
    if (!el) return;
    e.preventDefault();
    const cartes = cartesAffichees();
    const place = cartes.indexOf(el);
    rangerMain(deplacer(cartes.map((b) => b.dataset.carte), place, place + (e.key === 'ArrowLeft' ? -1 : 1)));
    rendre();
    cartesAffichees()[Math.max(0, Math.min(cartes.length - 1, place + (e.key === 'ArrowLeft' ? -1 : 1)))]?.focus();
  });

  // ─── Revue des coups : les coups déjà joués défilent sur le plateau, un par un ────────────────────────────────
  // La partie continue pendant ce temps (les coups reçus attendent) ; rien ne se joue tant que la revue est ouverte.

  /** Ouvre la revue sur le coup `index` de l'historique (par défaut : le dernier joué). */
  function ouvrirRevue(index) {
    if (!vueReelle || revue) return;
    const histo = vueReelle.historique || [];
    if (!histo.length) {
      annoncer('Aucun coup à revoir pour l’instant.');
      return;
    }
    let tours;
    try {
      ({ tours } = rejouerPartie(reglagesRejeu(vueReelle.etat), histo));
    } catch {
      annoncer('Ce journal ne peut pas être rejoué.', { erreur: true });
      return;
    }
    // Les coups en cours de présentation sont passés : la revue les montrera.
    if (enPresentation) passerPresentation();
    clearTimeout(minuterieAuto);
    reinitialiser();
    feuilleJournal?.fermer();
    feuilleConseil?.fermer();
    revue = { tours, histo: histo.slice(), index: 0 };
    ecran.toggleAttribute('data-revue', true);
    boutonRevoir.setAttribute('aria-pressed', 'true');
    allerRevue(index ?? tours.length - 1);
  }

  /** Montre le coup `i` : la position d'avant, puis le coup qui se joue. */
  function allerRevue(i) {
    if (!revue) return;
    revue.index = Math.max(0, Math.min(revue.tours.length - 1, i));
    const tour = revue.tours[revue.index];
    const base = { siegeVue: vueReelle.siege, siegeLocal: vueReelle.siege, joueurs: vueReelle.joueurs };
    clearTimeout(minuterieRevue);
    plateau.arreterAnimations();
    if (animationsActives()) {
      plateau.maj({ ...base, etat: { ...tour.avant, dernierCoup: null } });
      minuterieRevue = setTimeout(() => {
        if (!revue) return;
        plateau.maj({ ...base, etat: tour.apres });
        plateau.animer(tour.apres.dernierCoup, vueReelle.siege, leRythme());
      }, 320);
    } else {
      plateau.maj({ ...base, etat: tour.apres });
    }
    rendreRevue();
  }

  function rendreRevue() {
    const { tours, histo, index } = revue;
    const tour = tours[index];
    const reel = vueReelle;
    titre.textContent = reel.nom || 'Partie de Toc';
    sousTitre.textContent = 'Revue';
    main.classList.add('inactive');
    zonePlateau.classList.remove('a-moi');
    const nouveaux = (reel.historique?.length || 0) - histo.length;
    const aMonTour = (reel.etat.phase === 'jeu' && reel.etat.tour === reel.siege) || (reel.etat.phase === 'echange' && !reel.don);
    remplacer(
      consigne,
      h(
        'div',
        { class: 'mots revue-coups' },
        h('span', { class: 'note position-revue' }, `Donne ${tour.avant.donne + 1} · coup ${index + 1} sur ${tours.length}`),
        ligneCoup(histo[index], index, { bouton: false }),
        nouveaux > 0
          ? h('span', { class: 'note resume-retard' }, `La partie continue : ${pluriel(nouveaux, 'nouveau coup', 'nouveaux coups')} depuis.`)
          : aMonTour && reel.etat.phase !== 'fini'
            ? h('span', { class: 'tour-de' }, h('b', {}, 'C’est à toi de jouer.'))
            : null,
      ),
    );
    remplacer(
      actions,
      h('button', { type: 'button', class: 'bouton', disabled: index === 0, 'data-action': 'revue-precedent', 'aria-label': 'Coup précédent', onclick: () => allerRevue(index - 1) }, piPrecedent(), 'Précédent'),
      h('button', { type: 'button', class: 'bouton', disabled: index === tours.length - 1, 'data-action': 'revue-suivant', 'aria-label': 'Coup suivant', onclick: () => allerRevue(index + 1) }, 'Suivant', piSuivant()),
      h('button', { type: 'button', class: 'bouton principal', 'data-action': 'revue-fin', onclick: quitterRevue }, 'Reprendre la partie'),
    );
    actions.hidden = false;
  }

  /** Ferme la revue : le plateau retrouve la partie, et montre les coups joués entre-temps. */
  function quitterRevue() {
    if (!revue) return;
    revue = null;
    clearTimeout(minuterieRevue);
    plateau.arreterAnimations();
    ecran.toggleAttribute('data-revue', false);
    boutonRevoir.setAttribute('aria-pressed', 'false');
    if (enPresentation) return; // la présentation en cours finit par afficher la partie
    if ((vueReelle.historique?.length || 0) > nHisto) presenter();
    else appliquerVue(vueReelle);
  }

  /** Dans la revue : flèches gauche et droite pour défiler, Échap pour reprendre la partie. */
  const clavierRevue = (e) => {
    if (!revue || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === 'ArrowLeft') allerRevue(revue.index - 1);
    else if (e.key === 'ArrowRight') allerRevue(revue.index + 1);
    else if (e.key === 'Escape') quitterRevue();
    else return;
    e.preventDefault();
  };
  document.addEventListener('keydown', clavierRevue);

  /** Rythme courant (réglage « Vitesse du jeu », ou presque instantané pour les essais automatisés). */
  const leRythme = () => (essais ? VITESSE_ESSAIS : rythme(lireReglages().vitesse));
  const animationsActives = () => lireReglages().animations && !mouvementReduit();
  const cleVu = () => (vueReelle?.enLigne ? `toc.vu.${vueReelle.id}` : null);

  const desabonner = session.abonner((v) => {
    // Retour en arrière (le joueur a annulé son dernier coup) : la partie est revenue à une position plus ancienne.
    const recul = !!vueReelle && v.etat.numCoup < vueReelle.etat.numCoup;
    vueReelle = v;
    if (recul) {
      // On montre la position rendue telle quelle : rien à rejouer, les animations en cours s'arrêtent.
      nHisto = v.historique.length;
      resume = null;
      clearTimeout(minuterieAuto);
      if (enPresentation) {
        passerPresentation(); // la file s'arrête et affiche la position actuelle
        return;
      }
      plateau.arreterAnimations();
      appliquerVue(v);
      return;
    }
    if (nHisto < 0) {
      // Ouverture : en ligne, on reprend là où le joueur s'était arrêté (coups joués en son absence) ;
      // en entraînement, rien n'a bougé pendant son absence.
      const vu = cleVu() ? lire(cleVu(), null) : null;
      nHisto = typeof vu === 'number' && vu >= 0 && vu <= v.historique.length ? vu : v.historique.length;
    }
    if (enPresentation) return; // la file lira les nouveaux coups
    if (revue) {
      // Le joueur revoit des coups : la partie avance sans toucher au plateau, il la retrouvera en sortant.
      rendreRevue();
      return;
    }
    if ((v.historique?.length || 0) > nHisto) {
      presenter();
      return;
    }
    appliquerVue(v);
  });

  /** Affiche une vue (réelle, ou intermédiaire pendant la présentation). */
  function appliquerVue(v, { presentation = false } = {}) {
    const ancienne = vue;
    vue = v;
    // Nouvel état : la saisie en cours n'a plus de sens si la main ou le tour ont changé.
    // (Pendant l'échange, les dons des autres ne touchent pas à la carte choisie.)
    const autreCoup = ancienne && ancienne.etat.numCoup !== v.etat.numCoup && v.etat.phase !== 'echange';
    if (!ancienne || autreCoup || ancienne.etat.phase !== v.etat.phase || ancienne.etat.donne !== v.etat.donne) reinitialiser();
    if (carte && !v.main.includes(carte)) reinitialiser();
    rendre();
    if (presentation) return;
    signalerRecu();
    signalerTour();
    if (v.etat.phase === 'fini' && !finMontree) {
      finMontree = true;
      setTimeout(montrerFin, ancienne ? 900 : 0);
    }
    verifierCoupUnique();
  }

  function attendre(ms) {
    return new Promise((resoudre) => {
      const minuterie = setTimeout(() => {
        finAttente = null;
        resoudre();
      }, ms);
      finAttente = () => {
        clearTimeout(minuterie);
        finAttente = null;
        resoudre();
      };
    });
  }

  /** Passe directement à la position actuelle (file longue, ou impatience). */
  function passerPresentation() {
    passer = true;
    plateau.arreterAnimations();
    finAttente?.();
  }

  /** Présente un par un les coups pas encore montrés, à partir de l'historique (rejoué par le moteur). */
  async function presenter() {
    enPresentation = true;
    passer = false;
    clearTimeout(minuterieAuto);
    const enRetard = vueReelle.historique.length - nHisto;
    let rejeu = null;
    let longueur = -1;
    while (!passer && nHisto < vueReelle.historique.length) {
      const histo = vueReelle.historique;
      const i = nHisto;
      let etatApres;
      if (i === histo.length - 1) {
        // Dernier coup : c'est la position actuelle.
        etatApres = vueReelle.etat;
      } else {
        // Coups intermédiaires : la partie est rejouée par le moteur (une fois par longueur d'historique).
        if (longueur !== histo.length) {
          try {
            rejeu = rejouerPartie(reglagesRejeu(vueReelle.etat), histo);
            longueur = histo.length;
          } catch {
            rejeu = null;
            longueur = histo.length;
          }
        }
        etatApres = rejeu?.tours[i]?.apres;
        // Historique illisible : on saute directement au dernier coup.
        if (!etatApres) {
          nHisto = histo.length - 1;
          continue;
        }
      }
      nHisto = i + 1;
      restants = histo.length - nHisto;
      const tour = { apres: etatApres };
      const intermediaire = { ...vueReelle, etat: etatApres, historique: histo.slice(0, nHisto) };
      appliquerVue(intermediaire, { presentation: true });
      const r = leRythme();
      const mien = histo[i].siege === vueReelle.siege;
      const duree = animationsActives() ? plateau.animer(tour.apres.dernierCoup, vueReelle.siege, r) : 0;
      // Le coup d'un autre joueur reste affiché le temps de le lire ; le sien, juste le temps de l'animation.
      await attendre(duree + (mien ? Math.min(150, r.lecture) : r.lecture));
    }
    // Résumé des coups passés : il reste affiché jusqu'au coup suivant (le message du coup unique ne l'efface pas).
    resume = passer && enRetard > 1 && nHisto < vueReelle.historique.length ? { texte: resumeRetard(nHisto, vueReelle.historique), n: vueReelle.historique.length } : null;
    nHisto = vueReelle.historique.length;
    restants = 0;
    enPresentation = false;
    if (cleVu()) ecrire(cleVu(), nHisto);
    appliquerVue(vueReelle);
  }

  /** Résumé des coups passés sans les voir : combien, et tes pions renvoyés à la base. */
  function resumeRetard(depuis, histo) {
    const passes = histo.slice(depuis);
    const n = passes.length;
    const mesPrises = passes.reduce((k, e) => k + (e.captures || []).filter((q) => q >> 2 === vueReelle.siege && e.siege !== vueReelle.siege).length, 0);
    return `${pluriel(n, 'coup passé', 'coups passés')}${mesPrises ? ` · ${pluriel(mesPrises, 'de tes pions renvoyé', 'de tes pions renvoyés')} à la base` : ''} : le journal les détaille.`;
  }

  /**
   * Seul coup possible : il est montré (carte et pion mis en évidence) puis joué tout seul, avec un message.
   * Jamais pour la carte à donner, ni quand plusieurs cartes différentes peuvent être défaussées.
   */
  function verifierCoupUnique() {
    if (enPresentation || revue || !vue || envoi || carte || !lireReglages().coupUniqueAuto) return;
    const { etat, siege } = vue;
    if (etat.phase !== 'jeu' || etat.tour !== siege) return;
    let coups;
    try {
      coups = coupsLegauxMain(etat, siege, vue.main);
    } catch {
      return;
    }
    if (coups.length !== 1) return;
    const coup = coups[0];
    const cleCoup = `${vue.id}|${etat.donne}|${etat.numCoup}`;
    if (autoFaits.has(cleCoup)) return;
    autoFaits.add(cleCoup);
    carte = coup.carte;
    comme = coup.comme || null;
    if (coup.pion !== undefined) pion = coup.pion;
    coupPret = coup;
    coupAuto = coup;
    annoncer(`Seul coup possible : ${resumeCoup(coup)}. Il va être joué pour toi…`, { duree: 4000 });
    clearTimeout(minuterieAuto);
    minuterieAuto = setTimeout(() => {
      if (!vue || vue.etat.numCoup !== etat.numCoup || envoi || coupPret !== coup || enPresentation || revue) return;
      envoyer().then((ok) => ok && annoncer(`Seul coup possible, joué pour toi : ${resumeCoup(coup)}`, { duree: 6000 }));
    }, leRythme().avantAuto);
  }

  /** « 10 ♠, avance de 10 » ; « défausse du 9 ♠ ». */
  function resumeCoup(coup) {
    if (coup.t === 'defausse') return estJoker(coup.carte) ? 'défausse du joker' : `défausse du ${carteCourte(coup.carte)}`;
    const c = estJoker(coup.carte) ? `joker comme ${rangAvecArticle(coup.comme)}` : carteCourte(coup.carte);
    return `${c}, ${decrireAction(coup, vue.siege, vue.joueurs)}`;
  }

  function signalerRecu() {
    if (vue.etat.phase !== 'jeu' || !vue.recu) return;
    const cle = `${vue.id}-${vue.etat.donne}`;
    if (recuSignale === cle) return;
    recuSignale = cle;
    const p = vue.joueurs[donneurDe()]?.pseudo || (nb() === 3 ? 'Ton voisin' : 'Ton partenaire');
    annoncer(`${p} t’a donné : ${nomCarte(vue.recu)}`);
  }

  function signalerTour() {
    const a = aMoi();
    majMonTour(a);
    if (a && !monTourAvant && document.visibilityState === 'hidden') {
      void notifier('tour-' + vue.id, 'À toi de jouer', `${vue.nom} : c’est à toi de jouer.`, location.hash, 'tour');
    }
    monTourAvant = a;
  }

  function aMoi() {
    if (enPresentation) return false;
    return !!vue && ((vue.etat.phase === 'jeu' && vue.etat.tour === vue.siege) || (vue.etat.phase === 'echange' && !vue.don));
  }

  function nomSiege(si) {
    return si === vue.siege ? 'Toi' : vue.joueurs[si]?.pseudo || `Joueur ${si + 1}`;
  }

  /** Siège qui reçoit la carte donnée par le joueur local (partenaire à 4, voisin à 3). */
  function destinataireDe() {
    return destinataireDon(vue.etat.donne, vue.siege, nb());
  }
  /** Siège qui donne une carte au joueur local. */
  function donneurDe() {
    return donneurDon(vue.etat.donne, vue.siege, nb());
  }

  /** Coups légaux de la carte choisie ; pour un joker, seulement ceux du rang copié choisi. */
  function coupsCarte(c) {
    const coups = coupsLegaux(vue.etat, vue.siege, c);
    return estJoker(c) && comme ? coups.filter((k) => k.comme === comme) : coups;
  }

  /** Rang effectif de la carte choisie (le rang copié pour un joker). */
  function rangEffectif(c) {
    return estJoker(c) ? comme : rang(c);
  }

  // ─── Calculs (moteur) ─────────────────────────────────────────────────────

  /** Coups légaux de chaque carte de la main (une carte injouable a une liste vide). */
  function coupsParCarte() {
    const m = new Map();
    for (const c of vue.main) m.set(c, coupsLegaux(vue.etat, vue.siege, c));
    return m;
  }

  /** Destination (position moteur) du pion déplacé par un coup, et pions capturés. */
  function destination(coup) {
    if (coup.t === 'sept' || coup.t === 'defausse') {
      const a = apercuCoup(vue.etat, vue.siege, coup);
      const dep = a?.deplacements.filter((d) => !d.capture).pop();
      return { pion: dep ? dep.pion : undefined, pos: dep ? dep.vers : undefined, captures: a?.captures || [], pions: a?.pions };
    }
    if (coup.t === 'echange') return { pion: coup.pion, pos: vue.etat.pions[coup.cible], captures: [], cible: coup.cible };
    const a = apercuCoup(vue.etat, vue.siege, coup);
    const dep = a?.deplacements.filter((d) => d.pion === coup.pion && !d.capture).pop();
    return { pion: coup.pion, pos: dep ? dep.vers : vue.etat.pions[coup.pion], captures: a?.captures || [] };
  }

  function etatSept() {
    return etapesSeptPossibles(vue.etat, vue.siege, sept.etapes);
  }

  // ─── Touchers ─────────────────────────────────────────────────────────────

  function toucherCarte(c) {
    if (enPresentation || revue) return;
    if (envoi || !vue) return;
    const { etat } = vue;
    if (etat.phase === 'echange') {
      if (vue.don) return;
      carte = carte === c ? null : c;
      rendre();
      return;
    }
    if (etat.phase !== 'jeu' || etat.tour !== vue.siege) return;
    if (coupAuto && coupPret === coupAuto) {
      // Seul coup possible en attente : toucher sa carte le joue tout de suite ; une autre carte reprend la main.
      const enAttente = coupAuto;
      clearTimeout(minuterieAuto);
      coupAuto = null;
      if (c === enAttente.carte) {
        envoyer().then((ok) => ok && annoncer(`Joué : ${resumeCoup(enAttente)}`));
        return;
      }
      avis = null;
    }
    if (carte === c) {
      reinitialiser();
      rendre();
      return;
    }
    reinitialiser();
    carte = c;
    if (!mainJouable(etat, vue.siege, vue.main)) {
      preparer({ t: 'defausse', carte: c });
      return;
    }
    const coups = coupsLegaux(etat, vue.siege, c);
    if (!coups.length) {
      carte = null;
      annoncer(estJoker(c) ? 'Le joker n’est pas jouable maintenant : rien d’utile à copier.' : `${leCarte(c, true)} n’est pas jouable maintenant.`);
      return;
    }
    if (estJoker(c)) {
      // Joker : on choisit d'abord la carte à copier (sauf s'il n'y a qu'un rang possible).
      const rangs = [...new Set(coups.map((k) => k.comme))];
      if (rangs.length > 1) {
        rendre();
        return;
      }
      comme = rangs[0];
    }
    continuerAvecCarte();
  }

  /** Joker : le joueur a choisi le rang à copier. */
  function choisirComme(r) {
    if (!carte || !estJoker(carte)) return;
    comme = r;
    pion = null;
    coupPret = null;
    sept = null;
    continuerAvecCarte();
  }

  /** Suite du choix d'une carte (rang connu) : 7 pas à pas, coup unique joué, ou pion unique choisi. */
  function continuerAvecCarte() {
    const etat = vue.etat;
    const coups = coupsCarte(carte);
    if (rangEffectif(carte) === '7') {
      sept = { etapes: [], pions: etat.pions.slice(), captures: [] };
      choisirSeulPionSept();
    } else if (coups.length === 1) {
      preparer(coups[0]);
      return;
    } else {
      const pions = new Set(coups.map((k) => k.pion));
      if (pions.size === 1) pion = [...pions][0];
    }
    rendre();
  }

  function choisirSeulPionSept() {
    const r = etatSept();
    if (!r) return;
    if (r.complet) {
      coupPret = estJoker(carte) ? { t: 'sept', carte, comme: '7', etapes: sept.etapes.slice() } : { t: 'sept', carte, etapes: sept.etapes.slice() };
      pion = null;
      return;
    }
    const pions = new Set(r.options.map((o) => o.pion));
    pion = pions.size === 1 ? [...pions][0] : null;
  }

  function toucherPion(g) {
    if (enPresentation || revue) return;
    if (envoi || !carte) return;
    if (pion === g && !sept) {
      // Valet : toucher à nouveau son pion le désélectionne.
      pion = null;
      coupPret = null;
    } else {
      pion = g;
      coupPret = null;
      if (!sept) {
        const opts = coupsCarte(carte).filter((k) => k.pion === g);
        if (opts.length === 1) {
          preparer(opts[0]);
          return;
        }
      }
    }
    rendre();
  }

  function toucherCible(i) {
    if (enPresentation || revue) return;
    const cible = ciblesCourantes[i];
    if (!cible || envoi) return;
    if (sept) {
      ajouterEtape(cible.option);
      return;
    }
    if (coupPret && cle(coupPret) === cle(cible.coup)) {
      envoyer();
      return;
    }
    preparer(cible.coup);
  }

  function cle(coup) {
    return JSON.stringify(coup);
  }

  function ajouterEtape(option) {
    const { pion: g, pas, allee, vers, captures } = option;
    sept.etapes.push({ pion: g, pas, allee });
    const pions = sept.pions.slice();
    for (const q of captures) pions[q] = BASE;
    pions[g] = vers;
    sept.pions = pions;
    sept.captures = sept.captures.concat(captures);
    choisirSeulPionSept();
    if (coupPret && !lireReglages().confirmerCoup) {
      envoyer();
      return;
    }
    rendre();
  }

  function annulerEtape() {
    if (!sept || !sept.etapes.length) return;
    const etapes = sept.etapes.slice(0, -1);
    sept = { etapes: [], pions: vue.etat.pions.slice(), captures: [] };
    coupPret = null;
    // On rejoue les étapes restantes à partir des options du moteur.
    for (const e of etapes) {
      const r = etatSept();
      const o = r?.options.find((x) => x.pion === e.pion && x.pas === e.pas && x.allee === e.allee);
      if (!o) break;
      sept.etapes.push(e);
      const pions = sept.pions.slice();
      for (const q of o.captures) pions[q] = BASE;
      pions[o.pion] = o.vers;
      sept.pions = pions;
      sept.captures = sept.captures.concat(o.captures);
    }
    choisirSeulPionSept();
    rendre();
  }

  function preparer(coup) {
    coupPret = coup;
    if (coup.pion !== undefined) pion = coup.pion;
    if (!lireReglages().confirmerCoup) {
      envoyer();
      return;
    }
    rendre();
  }

  async function envoyer() {
    if (!coupPret || envoi || enPresentation || revue) return false;
    const coup = coupPret;
    const avant = { etat: vue.etat, main: vue.main.slice(), don: vue.don, recu: vue.recu };
    envoi = true;
    rendre();
    let reussi = false;
    try {
      await session.jouer(coup);
      reussi = true;
      commenter(avant, coup);
    } catch (e) {
      annoncer(messageErreur(e), { erreur: true, duree: 6000 });
    } finally {
      envoi = false;
      coupAuto = null;
      reinitialiser();
      if (vue) rendre();
    }
    return reussi;
  }

  /** Peut-on annuler son dernier coup maintenant ? (Parties contre l'IA : la session le dit.) */
  function coupAnnulable() {
    return typeof session.annuler === 'function' && !!vueReelle?.annulable && !envoi && !revue;
  }

  /** Bouton « Annuler mon dernier coup », ou null. Proposé quand aucune saisie n'est en cours. */
  function boutonAnnulerCoup() {
    if (!coupAnnulable()) return null;
    return h('button', { type: 'button', class: 'bouton discret', 'data-action': 'annuler-coup', title: 'Revenir juste avant ton dernier coup', onclick: annulerCoup }, piAnnuler(), 'Annuler mon dernier coup');
  }

  /** Annule le dernier coup du joueur (et ce que les IA ont joué depuis) : c'est de nouveau à lui. */
  async function annulerCoup() {
    if (!coupAnnulable()) return;
    envoi = true;
    try {
      await session.annuler();
      annoncer('Coup annulé : à toi de rejouer.');
    } catch (e) {
      annoncer(messageErreur(e), { erreur: true, duree: 6000 });
    } finally {
      envoi = false;
      if (vue) rendre();
    }
  }

  async function donner() {
    if (!carte || envoi) return;
    const c = carte;
    envoi = true;
    rendre();
    try {
      await session.donner(c);
    } catch (e) {
      annoncer(messageErreur(e), { erreur: true, duree: 6000 });
    } finally {
      envoi = false;
      carte = null;
      if (vue) rendre();
    }
  }

  // ─── Affichage ────────────────────────────────────────────────────────────

  /** Une feuille (journal, conseil, fin de partie) aux couleurs de la partie : elle s'ouvre hors de l'écran de jeu. */
  function ouvrirFeuilleJeu(...args) {
    const feuille = ouvrirFeuille(...args);
    if (vue) appliquerCouleurs(feuille.el, couleursPartie(vue.joueurs, vue.joueurs.length));
    return feuille;
  }

  function rendre() {
    if (!vue) return;
    if (revue) {
      rendreRevue();
      return;
    }
    const { etat, siege, joueurs } = vue;
    // Les couleurs choisies par les joueurs, sur le plateau comme sur les puces du journal et de la consigne.
    appliquerCouleurs(ecran, couleursPartie(joueurs, joueurs.length));
    const jeu = etat.phase === 'jeu';
    const monTour = jeu && etat.tour === siege && !enPresentation;
    ecran.toggleAttribute('data-presentation', enPresentation);
    const coups = monTour ? coupsParCarte() : new Map();
    const jouable = monTour && mainJouable(etat, siege, vue.main);
    const actifCouleur = couleurActive(etat, siege);

    titre.textContent = vue.nom || 'Partie de Toc';
    sousTitre.textContent = `Donne ${etat.donne + 1}`;

    // Plateau : candidats, cibles, aperçu.
    const choix = calculerChoix(monTour);
    const pionsAffiches = sept ? sept.pions : coupPret?.t === 'sept' ? destination(coupPret).pions || null : null;
    plateau.maj({ siegeVue: siege, etat, joueurs, pions: pionsAffiches, choix, sousTitres: sousTitres(), siegeLocal: siege });
    rendreJournalPanneau();
    if (boutonAbandon) boutonAbandon.hidden = etat.phase === 'fini';
    boutonConseil.disabled = !aMoi() || envoi || vue.enLigne;
    boutonConseil.hidden = !conseilsDispo || !lireReglages().conseilsIA;
    zonePlateau.classList.toggle('a-moi', aMoi());

    // Main.
    const recue = jeu && vue.recu && vue.main.includes(vue.recu) ? vue.recu : null;
    // La carte reçue porte la couleur de qui l'a donnée ; elle entre dans la main avec un petit élan, une seule fois.
    const donneur = donneurDe();
    const cleRecue = `${vue.id}-${etat.donne}`;
    if (recue && recuArrive?.cle !== cleRecue) recuArrive = { cle: cleRecue, t: Date.now() };
    const marqueRecue = { couleur: couleurSiege(donneur), fonce: couleurFonceeSiege(donneur), texte: `reçue de ${vue.joueurs[donneur]?.pseudo || (nb() === 3 ? 'ton voisin' : 'ton partenaire')}`, depuis: recue ? Date.now() - recuArrive.t : 0 };
    const cartes = cartesOrdonnees().map((c) => {
      const injouable = monTour && jouable && !(coups.get(c) || []).length;
      const inactive = (!monTour && !(etat.phase === 'echange' && !vue.don && !enPresentation)) || envoi;
      return dessinCarte(c, {
        bouton: true,
        choisie: carte === c,
        injouable,
        inactive,
        recue: c === recue ? marqueRecue : null,
        marque: c === vue.don && c !== recue ? 'donnée' : null,
        surToucher: () => toucherCarte(c),
      });
    });
    if (!cartes.length) cartes.push(h('span', { class: 'main-vide' }, etat.phase === 'fini' ? 'Partie terminée' : 'Plus de cartes pour cette donne'));
    // Une carte en train d'être déplacée garde la main telle quelle : elle sera redessinée quand le joueur la lâche.
    if (!glisse?.actif) remplacer(main, cartes);
    main.classList.toggle('inactive', !aMoi());

    rendreConsigne(monTour, jouable, actifCouleur);
  }

  // ─── Journal des coups ────────────────────────────────────────────────────

  /**
   * Une ligne du journal : la carte jouée en petit, qui l'a jouée, ce que le coup a fait, et les pions renvoyés à la
   * base. En bouton (par défaut), la toucher rejoue ce coup sur le plateau (revue des coups).
   */
  function ligneCoup(entree, index, { bouton = true } = {}) {
    const { joueurs, siege } = vueReelle || vue;
    const d = detailJournal(entree, joueurs, siege);
    const contenu = [
      dessinCarte(entree.coup.carte, { petite: true }),
      h(
        'span',
        { class: 'texte-coup' },
        h('span', { class: 'qui' }, puceCouleur(entree.siege), h('b', {}, d.qui), h('span', { class: 'numero-coup' }, `n° ${index + 1}`)),
        h('span', { class: 'action' }, d.action),
        d.prises ? h('span', { class: 'prises' }, d.prises) : null,
      ),
    ];
    const classes = 'ligne-journal coup' + (d.defausse ? ' defausse' : '') + (d.prises ? ' avec-prise' : '');
    if (!bouton) return h('div', { class: classes, 'data-coup': index }, contenu);
    return h('button', { type: 'button', class: classes, 'data-coup': index, 'aria-label': `Coup ${index + 1}. ${ligneJournal(entree, joueurs, siege)} Le revoir sur le plateau.`, onclick: () => ouvrirRevue(index) }, contenu);
  }

  /** Donne de chaque coup de l'historique (pour les intertitres du journal) ; vide si l'historique ne se rejoue pas. */
  function donnesDesCoups() {
    const histo = vue.historique || [];
    if (donnesJournal.n !== histo.length) {
      let donnes = [];
      try {
        donnes = rejouerPartie(reglagesRejeu(vue.etat), histo).tours.map((t) => t.avant.donne);
      } catch {
        donnes = [];
      }
      donnesJournal = { n: histo.length, donnes };
    }
    return donnesJournal.donnes;
  }

  /** Journal toujours visible sur grand écran (les 40 derniers coups, le plus récent en haut). */
  function rendreJournalPanneau() {
    const histo = vue.historique || [];
    const lignes = [];
    for (let i = histo.length - 1; i >= Math.max(0, histo.length - 40); i--) lignes.push(h('li', {}, ligneCoup(histo[i], i)));
    remplacer(
      journalPanneau,
      h('div', { class: 'titre-journal' }, 'Journal des coups'),
      lignes.length ? h('ol', { class: 'journal compact' }, lignes) : h('p', { class: 'note' }, 'Aucun coup joué pour l’instant.'),
    );
  }

  function sousTitres() {
    const t = [];
    const { etat } = vue;
    for (let si = 0; si < nb(); si++) {
      if (aFini(etat, si)) t[si] = etat.phase === 'fini' && nb() === 3 ? 'a gagné !' : 'a fini ✓';
      else if (etat.phase === 'echange') t[si] = etat.echanges[si] ? 'a donné ✓' : 'choisit…';
      else if (etat.phase === 'jeu' && etat.tour === si) t[si] = si === vue.siege ? 'à toi !' : 'joue…';
    }
    return t;
  }

  function calculerChoix(monTour) {
    ciblesCourantes = [];
    if (!monTour || !carte) return null;
    const { etat, siege, joueurs } = vue;
    if (coupPret?.t === 'defausse') return null;
    if (estJoker(carte) && !comme) return null;
    if (sept) {
      const r = etatSept();
      if (!r) return null;
      const candidats = new Set(r.options.map((o) => o.pion));
      const choix = { candidats, choisi: pion, cibles: [], captures: [], garderCandidats: true };
      if (pion !== null) {
        for (const o of r.options.filter((x) => x.pion === pion)) {
          ciblesCourantes.push({ option: o, pion: o.pion, pos: o.vers, libelle: libelleOptionSept(o) });
        }
        choix.cibles = ciblesCourantes.map((c) => ({ pion: c.pion, pos: c.pos, libelle: c.libelle }));
      }
      return choix;
    }
    const coups = coupsCarte(carte);
    const candidats = new Set(coups.map((k) => k.pion));
    const choix = { candidats, choisi: pion, cibles: [], captures: [] };
    if (pion !== null) {
      for (const k of coups.filter((x) => x.pion === pion)) {
        const d = destination(k);
        const pos = k.t === 'echange' ? etat.pions[k.cible] : d.pos;
        const pionCible = k.t === 'echange' ? k.cible : k.pion;
        ciblesCourantes.push({ coup: k, pion: pionCible, pos, libelle: libelleChoix(k, siege, joueurs, { depuisAllee: etat.pions[k.pion] >= ALLEE }) });
      }
      choix.cibles = ciblesCourantes.map((c) => ({ pion: c.pion, pos: c.pos, libelle: c.libelle }));
    }
    if (coupPret && coupPret.t === 'sept') {
      choix.candidats = new Set();
      choix.choisi = null;
    } else if (coupPret) {
      // Le coup prêt, montré avant d'être validé : le pion à son arrivée, le trajet depuis sa case, les pions
      // qu'il renvoie à la base ; pour un échange, les deux pions à la place l'un de l'autre.
      const d = destination(coupPret);
      choix.fantome = { pion: coupPret.pion, pos: d.pos };
      const sens = coupPret.t === 'avance' ? 'avant' : coupPret.t === 'recul' ? 'arriere' : 'direct';
      choix.trajet = { pion: coupPret.pion, de: etat.pions[coupPret.pion], vers: d.pos, sens };
      if (coupPret.t === 'echange') choix.fantomeEchange = { pion: coupPret.cible, pos: etat.pions[coupPret.pion] };
      choix.captures = d.captures;
      choix.cibleChoisie = ciblesCourantes.findIndex((c) => cle(c.coup) === cle(coupPret));
    }
    return choix;
  }

  function libelleOptionSept(o) {
    const depuisAllee = sept.pions[o.pion] >= ALLEE;
    let t = o.allee ? (depuisAllee ? `Allée +${o.pas}` : `Entrer +${o.pas}`) : `+${o.pas}`;
    if (o.captures.length) t += ` (renvoie ${o.captures.length})`;
    return t;
  }

  function puceCouleur(si) {
    return h('span', { class: 'puce-pion', style: { '--c': couleurSiege(si) }, 'aria-hidden': 'true' }, NOMS_FORMES[PIONS[si].forme]);
  }

  function rendreConsigne(monTour, jouable, actifCouleur) {
    const { etat, siege, joueurs } = vue;
    const a3 = nb() === 3;
    const p = partenaire(siege, nb());
    const nomP = p === null ? '' : joueurs[p]?.pseudo || 'ton partenaire';
    const dest = destinataireDe();
    const nomDest = joueurs[dest]?.pseudo || (a3 ? 'ton voisin' : 'ton partenaire');
    const lignes = [];
    const boutons = [];
    // Dernière action, lisible jusqu'au coup suivant.
    const derniere = (vue.historique || [])[vue.historique?.length - 1];
    if (derniere && etat.phase !== 'fini') {
      lignes.push(
        h(
          'div',
          { class: 'derniere-action', 'data-n': vue.historique.length },
          h('span', { class: 'puce-pion', style: { '--c': couleurSiege(derniere.siege) }, 'aria-hidden': 'true' }, NOMS_FORMES[PIONS[derniere.siege].forme]),
          h('span', {}, ligneJournal(derniere, joueurs, siege)),
        ),
      );
    }
    if (resume && resume.n === vue.historique?.length && !enPresentation) lignes.push(h('span', { class: 'note resume-retard' }, resume.texte));
    if (avis) lignes.push(h('span', { class: 'avis-jeu' + (avis.erreur ? ' erreur' : ''), role: avis.erreur ? 'alert' : null }, avis.texte));
    // À qui le tour, quand ce n'est pas à moi d'agir.
    const ligneTour = () =>
      etat.tour === siege
        ? h('span', { class: 'tour-de' }, h('b', {}, 'C’est à toi de jouer.'))
        : h('span', { class: 'tour-de' }, 'C’est à ', puceCouleur(etat.tour), ' ', h('b', {}, nomSiege(etat.tour)), ' de jouer.');
    if (enPresentation) {
      if (etat.phase === 'jeu') lignes.push(ligneTour());
      if (restants > 0) {
        boutons.push(
          h(
            'button',
            { type: 'button', class: 'bouton' + (restants >= 6 ? ' principal large' : ''), 'data-action': 'passer', onclick: passerPresentation },
            restants >= 6 ? `Passer à la position actuelle (${pluriel(restants, 'coup')})` : `Passer (${pluriel(restants, 'coup')})`,
          ),
        );
        if (restants >= 6) lignes.push(h('span', { class: 'note' }, `${pluriel(restants, 'coup a été joué', 'coups ont été joués')} depuis ta dernière visite : ils te sont montrés un par un.`));
      }
      // Pendant que les IA jouent : on peut encore revenir sur son coup.
      const annulation = boutonAnnulerCoup();
      if (annulation) boutons.push(annulation);
      remplacer(consigne, h('div', { class: 'mots' }, lignes));
      remplacer(actions, boutons);
      actions.hidden = !boutons.length;
      return;
    }

    if (etat.phase === 'fini') {
      const gagnants = siegesGagnants(etat);
      const gagne = gagnants.includes(siege);
      lignes.push(h('b', {}, a3 ? (gagne ? 'Tu as gagné !' : `${nomSiege(gagnants[0])} a gagné.`) : gagne ? 'Victoire de ton équipe !' : 'Victoire de l’équipe adverse.'));
      boutons.push(h('button', { type: 'button', class: 'bouton principal large', onclick: montrerFin }, 'Voir le résultat'));
    } else if (etat.phase === 'echange') {
      if (!vue.don) {
        const voisin = a3 ? `ton voisin de ${etat.donne % 2 === 0 ? 'gauche' : 'droite'}\u00a0: ` : '';
        lignes.push(h('span', {}, h('b', {}, 'Échange : '), `donne une carte à ${voisin}`, h('b', {}, nomDest), '.'));
        boutons.push(
          h(
            'button',
            { type: 'button', class: 'bouton principal large', disabled: !carte || envoi, onclick: donner, 'data-action': 'donner' },
            carte ? `Donner ${leCarte(carte)} à ${nomDest}` : 'Choisis une carte',
          ),
        );
      } else {
        const attendus = Array.from({ length: nb() }, (_, si) => si).filter((si) => !etat.echanges[si]).map(nomSiege);
        lignes.push(h('span', {}, `Tu as donné ${leCarte(vue.don)} à ${nomDest}. `, attendus.length ? `On attend ${enumerer(attendus)}.` : ''));
      }
    } else if (!monTour) {
      lignes.push(ligneTour());
    } else if (!jouable) {
      lignes.push(h('b', { class: 'ecart-neg' }, 'Aucune carte jouable : défausse une carte.'));
      boutons.push(
        h(
          'button',
          { type: 'button', class: 'bouton principal large', disabled: !coupPret || envoi, onclick: envoyer, 'data-action': 'jouer' },
          coupPret ? `Défausser ${leCarte(coupPret.carte)}` : 'Touche la carte à défausser',
        ),
      );
    } else if (sept) {
      const r = etatSept();
      const reste = r ? r.reste : 0;
      const actif = sept.etapes.length ? `${sept.etapes.map((e) => e.pas).join(' + ')} · ` : '';
      lignes.push(h('span', {}, h('b', {}, `${estJoker(carte) ? 'Joker comme un 7' : '7'} : reste ${pluriel(reste, 'point')}`), ` ${actif ? '(' + actif.slice(0, -3) + ')' : ''}`));
      if (sept.captures.length) lignes.push(h('span', { class: 'note ecart-neg' }, `Renvoyés à la base : ${decrireCaptures(sept.captures)}`));
      const options = r ? r.options : [];
      if (!a3 && options.some((o) => o.pion >> 2 !== siege)) lignes.push(h('span', { class: 'note' }, `Le reste va aux pions de ${nomP}.`));
      if (!coupPret) {
        if (pion === null) lignes.push(h('span', { class: 'note' }, 'Touche un pion à avancer.'));
        else
          for (const [i, c] of ciblesCourantes.entries()) {
            boutons.push(h('button', { type: 'button', class: 'bouton choix-sept', onclick: () => toucherCible(i), 'data-choix': i, 'aria-label': c.libelle.replace('+', 'avancer de ') }, c.libelle));
          }
      }
      if (sept.etapes.length) {
        boutons.push(h('button', { type: 'button', class: 'bouton', onclick: annulerEtape, 'data-action': 'annuler-etape' }, piAnnuler(), 'Étape'));
      }
      boutons.push(h('button', { type: 'button', class: 'bouton discret', onclick: () => (reinitialiser(), rendre()), 'data-action': 'annuler' }, 'Tout annuler'));
      if (coupPret) boutons.push(h('button', { type: 'button', class: 'bouton principal large', disabled: envoi, onclick: envoyer, 'data-action': 'jouer' }, piOk(), 'Valider le 7'));
    } else if (!carte) {
      lignes.push(h('span', {}, h('b', {}, 'À toi de jouer : '), 'touche une carte.'));
    } else if (estJoker(carte) && !comme) {
      // Joker : choix de la carte à copier parmi celles posées pendant la donne.
      const posees = cartesDeLaDonne(etat);
      const coupsJoker = coupsLegaux(etat, siege, carte);
      const rangs = [...new Set(posees.map((c) => (estJoker(c) ? etat.jokers?.[c] : rang(c))).filter(Boolean))];
      lignes.push(h('span', {}, h('b', {}, 'Joker : '), 'choisis la carte à copier parmi celles posées pendant cette donne.'));
      if (posees.length) lignes.push(h('div', { class: 'cartes-posees' }, posees.map((c) => dessinCarte(c, { petite: true }))));
      const ordre = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'V', 'D', 'R'];
      for (const r of ordre.filter((x) => rangs.includes(x))) {
        const possible = coupsJoker.some((k) => k.comme === r);
        boutons.push(
          h(
            'button',
            { type: 'button', class: 'bouton choix-comme', disabled: !possible, 'data-comme': r, onclick: () => choisirComme(r), title: possible ? null : 'Aucun coup possible avec cette carte' },
            `Comme ${rangAvecArticle(r)}`,
          ),
        );
      }
      boutons.push(h('button', { type: 'button', class: 'bouton discret', onclick: () => (reinitialiser(), rendre()), 'data-action': 'annuler' }, 'Annuler'));
    } else if (coupPret) {
      lignes.push(
        h(
          'span',
          {},
          h('b', {}, `${titreCarte()} : `),
          coupPret.t === 'sept' ? decrireAction(coupPret, siege, joueurs) : libelleChoix(coupPret, siege, joueurs, { depuisAllee: vue.etat.pions[coupPret.pion] >= ALLEE }),
        ),
      );
      const d = destination(coupPret);
      if (d.captures.length) lignes.push(h('span', { class: 'note ecart-neg' }, `Renvoie à la base : ${decrireCaptures(d.captures)}`));
      boutons.push(h('button', { type: 'button', class: 'bouton', onclick: () => ((coupPret = null), rendre()), 'data-action': 'annuler' }, 'Annuler'));
      boutons.push(h('button', { type: 'button', class: 'bouton principal large', disabled: envoi, onclick: envoyer, 'data-action': 'jouer' }, piOk(), 'Jouer'));
    } else {
      const coups = coupsCarte(carte);
      if (rangEffectif(carte) === 'V') {
        lignes.push(h('span', {}, h('b', {}, `${titreCarte()} : `), pion === null ? 'touche un de tes pions, puis le pion à échanger.' : 'touche le pion à échanger.'));
      } else {
        lignes.push(h('span', {}, h('b', {}, `${titreCarte()} : `), pion === null ? 'touche un pion.' : 'touche la destination.'));
      }
      const proposes = pion === null ? (coups.length <= 4 ? coups : []) : coups.filter((k) => k.pion === pion);
      // Un bouton par coup, sauf quand plusieurs diraient la même chose (« Avancer de 12 » pour deux pions) : rien ne
      // les distinguerait, et c'est le pion touché sur le plateau qui choisit.
      const libelles = proposes.slice(0, 12).map((k) => [k, libelleCoupComplet(k)]);
      const nbLibelles = new Map();
      for (const [, texte] of libelles) nbLibelles.set(texte, (nbLibelles.get(texte) || 0) + 1);
      for (const [k, texte] of libelles) {
        if (nbLibelles.get(texte) > 1) continue;
        boutons.push(h('button', { type: 'button', class: 'bouton', onclick: () => preparer(k), 'data-choix': cle(k) }, texte));
      }
      boutons.push(h('button', { type: 'button', class: 'bouton discret', onclick: () => (reinitialiser(), rendre()), 'data-action': 'annuler' }, 'Annuler'));
    }
    if (monTour && actifCouleur !== siege && etat.phase === 'jeu') {
      lignes.push(h('span', { class: 'note joue-pour' }, puceCouleur(actifCouleur), ` Tes pions sont rentrés : tu joues les pions ${nomCouleurPartie(couleursPartie(vue.joueurs, vue.joueurs.length), actifCouleur, true)} de ${nomP}.`));
    }
    // Rien en cours de saisie : on peut revenir sur son dernier coup (parties contre l'IA).
    if (!carte && !coupPret && !sept) {
      const annulation = boutonAnnulerCoup();
      if (annulation) boutons.push(annulation);
    }
    remplacer(consigne, h('div', { class: 'mots' }, lignes));
    remplacer(actions, boutons);
    actions.hidden = !boutons.length;
  }

  /** « Roi ♠ », ou « Joker comme un 9 ». */
  function titreCarte() {
    return estJoker(carte) ? `Joker comme ${rangAvecArticle(comme)}` : carteCourte(carte);
  }

  function libelleCoupComplet(k) {
    const { siege, joueurs, etat } = vue;
    const base = libelleChoix(k, siege, joueurs, { depuisAllee: etat.pions[k.pion] >= ALLEE });
    const n = destination(k).captures.length;
    return base + (n ? ` · renvoie ${pluriel(n, 'pion')}` : '');
  }

  function decrireCaptures(pions) {
    const par = new Map();
    for (const q of pions) par.set(q >> 2, (par.get(q >> 2) || 0) + 1);
    return [...par].map(([o, n]) => `${pluriel(n, 'pion')} ${o === vue.siege ? 'à toi' : 'de ' + nomSiege(o)}`).join(', ');
  }

  // ─── Conseils de l'IA (entraînement) ──────────────────────────────────────

  /** Phrase décrivant un coup : « Roi ♠ : sort un pion ». */
  function descriptionCoup(coup) {
    if (coup.t === 'defausse') return `Défausser ${leCarte(coup.carte)}`;
    const texte = decrireAction(coup, vue.siege, vue.joueurs);
    return `${estJoker(coup.carte) ? 'Joker comme ' + rangAvecArticle(coup.comme) : carteCourte(coup.carte)} : ${texte}`;
  }

  const formatEcart = (x) => (typeof x === 'number' ? x.toLocaleString('fr-FR', { maximumFractionDigits: 1 }) : '');

  /** Après un coup du joueur : l'IA aurait-elle joué pareil ? (réglage « Commenter mes coups »). */
  function commenter(avant, coup) {
    const r = lireReglages();
    if (!conseilsDispo || vue?.enLigne || !r.conseilsIA || !r.commenterCoups || avant.etat.phase !== 'jeu') return;
    setTimeout(() => {
      try {
        const avis = IA.conseillerCoup(avant.etat, vue.siege, avant.main, {
          max: 3,
          budgetMs: 500,
          coupJoue: coup,
          carteDonnee: avant.don,
          carteRecue: avant.recu,
        });
        if (!avis?.length) return;
        const meilleur = avis[0];
        const joue = avis.find((a) => a.joue);
        if (meilleur.joue || cle(meilleur.coup) === cle(coup) || (joue && !joue.ecart)) {
          annoncer('Bien joué : c’est aussi le choix de l’IA.', { duree: 3500 });
        } else {
          const r = meilleur.raisons?.[0];
          const raison = r ? ` ${r[0].toUpperCase()}${r.slice(1)}.` : '';
          const ecart = joue && typeof joue.ecart === 'number' ? ` (écart ${formatEcart(joue.ecart)})` : '';
          annoncer(`L’IA aurait préféré ${descriptionCoup(meilleur.coup)}${ecart}.${raison}`, { duree: 7000 });
        }
      } catch (e) {
        console.warn('Commentaire du coup impossible', e);
      }
    }, 60);
  }

  function ouvrirConseil() {
    if (!conseilsDispo || !vue || !aMoi() || vue.enLigne || !lireReglages().conseilsIA) return;
    const echange = vue.etat.phase === 'echange';
    const liste = h('div', { class: 'liste' }, h('div', { class: 'vide-etat' }, 'Réflexion…'));
    feuilleConseil = ouvrirFeuilleJeu(
      [
        h('h3', {}, echange ? 'Quelle carte donner ?' : 'Quel coup jouer ?'),
        h('p', { class: 'note' }, 'Les meilleures options selon l’IA, avec ses raisons.'),
        liste,
        h('button', { type: 'button', class: 'bouton large', onclick: () => feuilleConseil?.fermer() }, 'Fermer'),
      ],
      { surFermer: () => (feuilleConseil = null) },
    );
    const vueFigee = vue;
    // Laisse le navigateur afficher « Réflexion… » avant le calcul (≈ 0,5 s).
    setTimeout(() => {
      if (!feuilleConseil || vue !== vueFigee) return;
      let avis;
      try {
        const options = { max: 3, budgetMs: 600, carteDonnee: vue.don, carteRecue: vue.recu };
        avis = echange ? IA.conseillerDon(vue.etat, vue.siege, vue.main, options) : IA.conseillerCoup(vue.etat, vue.siege, vue.main, options);
      } catch (e) {
        remplacer(liste, h('div', { class: 'apercu erreur' }, messageErreur(e)));
        return;
      }
      if (!avis?.length) {
        remplacer(liste, h('div', { class: 'vide-etat' }, 'Pas de conseil pour cette position.'));
        return;
      }
      remplacer(
        liste,
        avis.slice(0, 3).map((a, i) => {
          const titre = echange ? `Donner ${leCarte(a.carte)}` : descriptionCoup(a.coup);
          const jouer = () => {
            feuilleConseil?.fermer();
            if (echange) {
              carte = a.carte;
              donner();
            } else {
              montrerConseil(a.coup);
              envoyer();
            }
          };
          return h(
            'div',
            { class: 'ligne conseil' + (i === 0 ? ' choisie' : ''), 'data-conseil': i },
            h(
              'button',
              {
                type: 'button',
                class: 'principal bouton-conseil',
                onclick: () => {
                  feuilleConseil?.fermer();
                  if (echange) {
                    carte = a.carte;
                    rendre();
                  } else montrerConseil(a.coup);
                },
              },
              h('div', { class: 'mot' }, `${i + 1}. ${titre}`),
              h('div', { class: 'note' }, i === 0 ? 'Le choix de l’IA' : `Écart avec le meilleur : ${formatEcart(a.ecart)}`),
              a.raisons?.length ? h('ul', { class: 'raisons' }, a.raisons.map((r) => h('li', {}, r))) : null,
            ),
            h('button', { type: 'button', class: 'bouton', onclick: jouer, 'data-action': 'jouer-conseil' }, echange ? 'Donner' : 'Jouer'),
          );
        }),
      );
    }, 30);
  }

  /** Met un coup conseillé en surbrillance : carte choisie, pion, destination et captures sur le plateau. */
  function montrerConseil(coup) {
    reinitialiser();
    carte = coup.carte;
    if (coup.comme) comme = coup.comme;
    if (coup.pion !== undefined) pion = coup.pion;
    coupPret = coup;
    rendre();
  }

  // ─── Feuilles : journal, fin de partie ────────────────────────────────────

  /**
   * Feuille du journal : les coups du plus récent au plus ancien, rangés par donne. On peut n'y garder qu'un joueur,
   * masquer les défausses, et toucher un coup pour le revoir sur le plateau.
   */
  function ouvrirJournal() {
    if (!vue) return;
    const zone = h('div', { class: 'zone-journal' });
    const filtre = (contenu, actif, surToucher, attrs = {}) => h('button', { type: 'button', class: 'filtre-journal' + (actif ? ' actif' : ''), 'aria-pressed': String(actif), onclick: surToucher, ...attrs }, contenu);
    const dessiner = () => {
      const histo = vue.historique || [];
      const donnes = donnesDesCoups();
      const items = [];
      let donneCourante = null;
      let montres = 0;
      for (let i = histo.length - 1; i >= 0; i--) {
        const e = histo[i];
        if (filtreJournal.siege !== null && e.siege !== filtreJournal.siege) continue;
        if (filtreJournal.sansDefausses && e.coup.t === 'defausse') continue;
        if (donnes.length && donnes[i] !== donneCourante) {
          donneCourante = donnes[i];
          items.push(h('li', { class: 'entete-donne' }, `Donne ${donneCourante + 1}`));
        }
        items.push(h('li', {}, ligneCoup(e, i)));
        montres++;
      }
      remplacer(
        zone,
        h(
          'div',
          { class: 'filtres-journal', role: 'group', 'aria-label': 'Filtrer le journal' },
          filtre('Tous', filtreJournal.siege === null, () => ((filtreJournal.siege = null), dessiner()), { 'data-filtre': 'tous' }),
          vue.joueurs.map((_, si) => filtre([puceCouleur(si), nomSiege(si)], filtreJournal.siege === si, () => ((filtreJournal.siege = filtreJournal.siege === si ? null : si), dessiner()), { 'data-filtre': si })),
          filtre('Sans les défausses', filtreJournal.sansDefausses, () => ((filtreJournal.sansDefausses = !filtreJournal.sansDefausses), dessiner()), { 'data-filtre': 'defausses' }),
        ),
        montres ? h('ol', { class: 'journal' }, items) : h('p', { class: 'vide-etat' }, histo.length ? 'Aucun coup ne correspond à ce choix.' : 'Aucun coup joué pour l’instant.'),
      );
    };
    dessiner();
    const total = vue.historique?.length || 0;
    feuilleJournal = ouvrirFeuilleJeu(
      [
        h('h3', {}, 'Journal des coups'),
        h('p', { class: 'note' }, total ? `${pluriel(total, 'coup joué', 'coups joués')} · touche un coup pour le revoir sur le plateau.` : `Donne ${vue.etat.donne + 1}`),
        zone,
        h(
          'div',
          { class: 'actions' },
          total ? h('button', { type: 'button', class: 'bouton', 'data-action': 'revoir-tout', onclick: () => ouvrirRevue(0) }, 'Revoir depuis le début') : null,
          h('button', { type: 'button', class: 'bouton principal', onclick: () => feuilleJournal?.fermer() }, 'Fermer'),
        ),
      ],
      { surFermer: () => (feuilleJournal = null) },
    );
  }

  /** « · IA Expert » pour une place tenue par une IA (niveau par défaut si absent). */
  function niveauDe(si) {
    const j = vue.joueurs[si];
    return j?.ia ? ` · ${nomSiege(si)} : ${nomNiveau(j.niveau)}` : '';
  }

  function montrerFin() {
    if (!vue || vue.etat.phase !== 'fini' || feuilleFin) return;
    const { etat, siege } = vue;
    const a3 = nb() === 3;
    const gagnants = siegesGagnants(etat);
    const gagne = gagnants.includes(siege);
    const rentres = (si) => etat.pions.slice(si * 4, si * 4 + 4).filter((p) => p >= ALLEE).length;
    const boutons = [];
    if (rejouer) boutons.push(h('button', { type: 'button', class: 'bouton principal large', onclick: () => (feuilleFin?.fermer(), rejouer()) }, 'Rejouer'));
    if (analyse) boutons.push(h('a', { class: 'bouton large', href: analyse, 'data-action': 'analyser', onclick: () => feuilleFin?.fermer() }, 'Analyser la partie'));
    boutons.push(
      h('a', { class: 'bouton large' + (rejouer ? '' : ' principal'), href: retour, onclick: () => feuilleFin?.fermer() }, vue.enLigne ? 'Mes parties' : 'Retour'),
    );
    let explication;
    let lignes;
    if (a3) {
      explication = h('p', {}, h('b', {}, gagne ? 'Tu as' : `${nomSiege(gagnants[0])} a`), ' rentré ses 4 pions le premier.');
      const ordre = [0, 1, 2].sort((x, y) => (gagnants.includes(y) ? 1 : 0) - (gagnants.includes(x) ? 1 : 0) || rentres(y) - rentres(x));
      lignes = ordre.map((si) =>
        h(
          'div',
          { class: 'ligne' + (gagnants.includes(si) ? ' choisie' : '') },
          h('span', { class: 'puce-pion grande', style: { '--c': couleurSiege(si) }, 'aria-hidden': 'true' }, NOMS_FORMES[PIONS[si].forme]),
          h('div', { class: 'principal' }, h('div', { class: 'mot' }, nomSiege(si)), h('div', { class: 'note' }, `${rentres(si)}/4 pions rentrés${niveauDe(si)}`)),
          h('span', { class: 'pts' }, gagnants.includes(si) ? 'Gagnant' : ''),
        ),
      );
    } else {
      const equipe = (e) => [e, e + 2].map((si) => nomSiege(si));
      explication = h('p', {}, 'L’équipe de ', h('b', {}, enumerer(equipe(etat.gagnant))), ' a rentré ses 8 pions.');
      lignes = [0, 1].map((e) =>
        h(
          'div',
          { class: 'ligne' + (e === etat.gagnant ? ' choisie' : '') },
          h('div', { class: 'principal' }, h('div', { class: 'mot' }, enumerer(equipe(e))), h('div', { class: 'note' }, (e === siege % 2 ? 'Ton équipe' : 'Équipe adverse') + niveauDe(e) + niveauDe(e + 2))),
          h('span', { class: 'pts' }, e === etat.gagnant ? 'Gagnant' : ''),
        ),
      );
    }
    feuilleFin = ouvrirFeuilleJeu(
      [
        h('div', { class: 'fin-titre' + (gagne ? ' gagne' : '') }, h('span', { class: 'fin-embleme', 'aria-hidden': 'true' }, gagne ? '🏆' : '🎲'), h('h3', {}, gagne ? 'Victoire !' : 'Défaite')),
        explication,
        h('div', { class: 'liste' }, lignes),
        h('p', { class: 'note' }, `${pluriel(vue.historique?.length || 0, 'coup joué', 'coups joués')} en ${pluriel(etat.donne + 1, 'donne')}.`),
        h('div', { class: 'actions' }, boutons),
      ],
      { surFermer: () => (feuilleFin = null) },
    );
  }

  return () => {
    desabonner?.();
    plateau.arreterAnimations();
    feuilleFin?.fermer();
    feuilleJournal?.fermer();
    feuilleConseil?.fermer();
    clearTimeout(minuterieAvis);
    clearTimeout(minuterieAuto);
    clearTimeout(minuterieRevue);
    document.removeEventListener('keydown', clavierRevue);
    passer = true;
    finAttente?.();
    majMonTour(false);
  };
}

