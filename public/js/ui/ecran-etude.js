// Analyse de fin de partie (routes #/analyse/locale et #/analyse/ID), sur le modèle de l'analyse de l'appli
// Scrabble : un plateau que l'on fait défiler tour par tour (les coups et les cartes données d'un joueur), chaque
// coup rejoué avec l'animation du plateau, le coup préféré de l'IA, un qualificatif, et une barre d'évaluation
// « comme aux échecs » qui s'affine tant que le tour reste affiché. Une vue d'ensemble (courbe et bilan) se
// remplit en arrière-plan. Tout se compte en « pions d'avance » (voir etude-calcul.js). On analyse ses propres
// coups, ou ceux d'un autre joueur quand ses mains sont connues (parties contre l'IA sur cet appareil).
// Les calculs tournent dans un Web Worker (voir etude-pilote.js).

import { h, s, remplacer, messageErreur, mouvementReduit } from './dom.js';
import { enteteRetour, interrupteur } from './composants.js';
import { Plateau } from './plateau.js';
import { dessinCarte } from './carte.js';
import { piRetour } from './pictos.js';
import { carteCourte, decrireAction, trierMain, rangAvecArticle, leCarte } from './libelles.js';
import { estJoker } from '../moteur/cartes.js';
import { SessionLocale } from '../session-locale.js';
import { partieFinieEntiere } from './synchro-ia.js';
import { appliquerCoup } from '../moteur/regles.js';
import { lancerAnalyse } from './etude-pilote.js';
import { lireReglages, modifierReglages, rythme } from './reglages.js';
import { PIONS, couleurSiege, couleursPartie, appliquerCouleurs } from './couleurs.js';
import {
  toursDuJoueur, siegesAnalysables, qualifier, candidatJoue, bilan, enPions, formatPions, etatApresCoup, graduations, graduationsTours, QUALIFICATIFS,
} from './etude-calcul.js';

/** Résultats gardés en mémoire (par partie, puis par joueur analysé) pour ne pas recalculer en revenant sur l'écran. */
const memoire = new Map();

export function afficher(racine, app, { reste }) {
  // #/analyse/finie/ID : partie contre l'IA de l'historique (écran Statistiques), gardée par l'appareil ou le compte.
  const archive = reste[0] === 'finie' ? reste[1] || '' : null;
  const id = archive !== null ? 'finie-' + archive : reste[0] || 'locale';
  // #/analyse/locale (2 contre 2) ou #/analyse/locale3 (3 joueurs) : parties d'entraînement.
  const locale = id === 'locale' || id === 'locale3' || archive !== null;
  const retour = archive !== null ? '#/stats' : locale ? '#/ia' : '#/parties';
  const contenu = h('div', { class: 'contenu analyse' }, enteteRetour('Analyse de la partie', retour), h('div', { class: 'vide-etat' }, 'Préparation de l’analyse…'));
  remplacer(racine, contenu);
  let ferme = false;
  let analyse = null;
  let detruireVue = null;

  const message = (texte) => {
    if (ferme) return;
    remplacer(contenu, enteteRetour('Analyse de la partie', retour), h('div', { class: 'carte', style: { lineHeight: 1.5 } }, texte), h('a', { class: 'bouton', href: retour }, 'Retour'));
  };

  (async () => {
    // 1. Les données de la partie (mains distribuées, cartes données, historique).
    let donnees;
    try {
      donnees = archive !== null ? await donneesArchive(app, archive) : locale ? await donneesLocales(id === 'locale3' ? 3 : 4) : await donneesEnLigne(app, id);
    } catch (e) {
      message(messageErreur(e));
      return;
    }
    if (typeof donnees === 'string') {
      message(donnees);
      return;
    }
    if (!donnees || !Array.isArray(donnees.donnes) || !donnees.donnes.length || !Array.isArray(donnees.historique)) {
      message('Cette partie date d’avant l’analyse : les cartes de chaque donne n’ont pas été gardées, on ne peut pas revoir tes coups. Les parties suivantes seront analysables.');
      return;
    }
    // 2. Rejeu de la partie par le moteur.
    const moteur = await import('../moteur/index.js');
    if (typeof moteur.rejouerPartie !== 'function' || typeof moteur.mainAvantCoup !== 'function') {
      message('L’analyse n’est pas encore disponible dans cette version de l’appli.');
      return;
    }
    // Tours de chaque joueur dont les mains sont connues (le joueur local d'abord).
    const tours = new Map();
    try {
      const rejeu = moteur.rejouerPartie(donnees.reglages, donnees.historique);
      for (const sg of siegesAnalysables(donnees)) {
        const items = toursDuJoueur(donnees, rejeu, moteur.mainAvantCoup, sg);
        if (items.length) tours.set(sg, items);
      }
    } catch (e) {
      message('Impossible de rejouer cette partie : ' + messageErreur(e));
      return;
    }
    if (!tours.has(donnees.siege)) {
      message('Aucun coup à analyser dans cette partie.');
      return;
    }
    if (ferme) return;
    const cle = locale ? id + '-' + donnees.historique.length + '-' + JSON.stringify(donnees.historique[0]?.coup || '') : id;
    const parSiege = memoire.get(cle) || new Map();
    memoire.set(cle, parSiege);
    const resultatsDe = (sg) => parSiege.get(sg) || parSiege.set(sg, new Map()).get(sg);
    detruireVue = monterVue(contenu, { donnees, tours, resultatsDe, retour, lancer: (taches, surMsg) => (analyse = lancerAnalyse(taches, surMsg)) });
  })();

  return () => {
    ferme = true;
    analyse?.arreter();
    detruireVue?.();
  };
}

async function donneesLocales(nbJoueurs) {
  const cleSauvegarde = nbJoueurs === 3 ? 'toc.partieLocale3' : 'toc.partieLocale';
  const sauvegarde = SessionLocale.lireSauvegarde(localStorage, cleSauvegarde);
  if (!sauvegarde) return 'Aucune partie contre l’IA n’est gardée sur cet appareil.';
  if (sauvegarde.partie.etat.phase !== 'fini') return 'Termine d’abord la partie en cours : l’analyse s’ouvre à la fin de la partie.';
  const session = new SessionLocale({ stockage: localStorage, cle: cleSauvegarde, reprendre: true, delaiIA: 1e9, nbJoueurs });
  try {
    if (typeof session.donneesAnalyse !== 'function') return 'L’analyse n’est pas encore disponible dans cette version de l’appli.';
    return await session.donneesAnalyse();
  } finally {
    session.fermer();
  }
}

/**
 * Partie contre l'IA de l'historique : même lecture qu'une sauvegarde, depuis un stockage en mémoire. La
 * sauvegarde vient de l'appareil ou, pour une partie jouée ailleurs, du compte (qui garde les plus récentes).
 */
async function donneesArchive(app, idPartie) {
  const { entree, sauvegarde } = await partieFinieEntiere(app, idPartie);
  if (!sauvegarde) {
    if (!entree) return 'Cette partie n’est plus dans l’historique de cet appareil.';
    if (entree.auCompte) return 'Les coups de cette partie sont gardés par ton compte : connecte-toi (avec du réseau) pour l’analyser.';
    return entree.ailleurs
      ? 'Cette partie a été jouée sur un autre appareil, et ton compte n’en garde plus que le résultat : seules les parties les plus récentes restent analysables partout.'
      : 'Seul le résultat de cette partie a été gardé : ses coups ne sont plus disponibles pour l’analyse.';
  }
  const stockage = { getItem: () => JSON.stringify(sauvegarde), setItem() {}, removeItem() {} };
  const nb = sauvegarde.partie.etat.pions?.length === 12 ? 3 : 4;
  const session = new SessionLocale({ stockage, cle: 'partie', reprendre: true, delaiIA: 1e9, nbJoueurs: entree?.nb || nb });
  try {
    return await session.donneesAnalyse();
  } finally {
    session.fermer();
  }
}

async function donneesEnLigne(app, id) {
  if (!app.enLigne() || !app.joueur) return 'Connecte-toi pour analyser cette partie.';
  const session = await app.api.ouvrirSession(id);
  try {
    let vue = null;
    const stop = session.abonner((v) => (vue = v));
    stop?.();
    if (vue && vue.etat.phase !== 'fini') return 'L’analyse d’une partie en ligne s’ouvre une fois la partie terminée.';
    if (typeof session.donneesAnalyse !== 'function') return 'L’analyse n’est pas encore disponible pour les parties en ligne.';
    return await session.donneesAnalyse();
  } finally {
    session.fermer();
  }
}

// ─── Vue ────────────────────────────────────────────────────────────────────

const FORMES = { rond: '●', carre: '■', triangle: '▲', losange: '◆' };
/** Temps (ms) pendant lequel la position d'avant le coup reste affichée avant que le coup se joue. */
const PAUSE_AVANT = 380;
const memeChoix = (a, b) => !!a && !!b && JSON.stringify(a) === JSON.stringify(b);
const animationsActives = () => lireReglages().animations && !mouvementReduit();

function monterVue(contenu, { donnees, tours, resultatsDe, retour, lancer }) {
  const { siege, joueurs } = donnees;
  const nb = (joueurs?.length || 4) === 3 || donnees.reglages?.nbJoueurs === 3 ? 3 : 4;
  const a3 = nb === 3;
  // L'analyse se lit aux couleurs que les joueurs avaient choisies.
  appliquerCouleurs(contenu, couleursPartie(joueurs, nb));
  // À 3, l'évaluation est celle du joueur seul : un joueur neutre a 1 chance sur 3, pas 1 sur 2.
  const neutre = a3 ? 1 / 3 : 0.5;
  const pions = (cases, options) => formatPions(cases, nb, options);
  const sieges = [...tours.keys()];

  /** Joueur analysé (le joueur local au départ), ses tours et leurs résultats. */
  let joueur = siege;
  let items = tours.get(joueur);
  let resultats = resultatsDe(joueur);
  let actuel = 0;
  /** Ce que montre le plateau à la place du coup joué : { coup } ou { carte } d'un candidat de l'IA, ou null. */
  let autre = null;
  // Conseils de l'IA (réglage « conseilsIA », désactivé par défaut) : sans eux, l'analyse montre seulement le
  // déroulé de la partie et l'évaluation, sans choix de l'IA, raisons, qualificatifs ni bilan des erreurs.
  let conseils = lireReglages().conseilsIA;
  let dispo = true;
  let auRepos = false;

  const moi = () => joueur === siege;
  const nomJoueur = (sg) => (sg === siege ? 'Toi' : joueurs?.[sg]?.pseudo || `Joueur ${sg + 1}`);
  const libelleAvantage = () => {
    if (a3) return moi() ? 'Ton avance' : `Avance de ${nomJoueur(joueur)}`;
    return joueur % 2 === siege % 2 ? 'Avantage de ton équipe' : 'Avantage de l’équipe adverse';
  };

  const plateau = new Plateau({});
  const zoneProgres = h('div', { class: 'liste' });
  const zoneJoueur = h('div', { class: 'zone-joueur' });
  const zoneInterrupteur = h('div', { class: 'zone-conseils' });
  const zoneBilan = h('div', { class: 'bilan-analyse' });
  const zoneCourbe = h('div', { class: 'courbe-analyse' });
  const titreTour = h('div', { class: 'principal centre' });
  const curseur = h('input', { type: 'range', class: 'curseur-tours', min: 0, max: Math.max(0, items.length - 1), value: 0, 'aria-label': 'Choisir un tour', oninput: (e) => aller(Number(e.target.value)) });
  const precedent = h('button', { type: 'button', class: 'bouton-icone', 'aria-label': 'Tour précédent', onclick: () => aller(actuel - 1) }, piRetour());
  const suivant = h('button', { type: 'button', class: 'bouton-icone suivant', 'aria-label': 'Tour suivant', onclick: () => aller(actuel + 1) }, piRetour());
  const zoneEval = h('div', { class: 'evaluation' });
  const zoneActions = h('div', { class: 'actions actions-coup' });
  const zoneMain = h('div', { class: 'main-analyse' });
  const zoneCoups = h('div', { class: 'liste' });
  const visionneuse = h(
    'div',
    { class: 'visionneuse' },
    h('div', { class: 'nav-tours' }, precedent, titreTour, suivant),
    curseur,
    zoneEval,
    h('div', { class: 'bloc-plateau' }, h('div', { class: 'zone-plateau' }, plateau.el), zoneActions),
    zoneMain,
    zoneCoups,
  );
  remplacer(
    contenu,
    enteteRetour('Analyse de la partie', retour),
    zoneProgres,
    zoneJoueur,
    h('h2', {}, 'Vue d’ensemble'),
    h(
      'div',
      { class: 'bloc-courbe' },
      zoneCourbe,
      h('p', { class: 'note note-pion' }, '1 pion d’avance : l’équivalent d’un pion rentré de plus que l’adversaire (un tour complet, de la base à l’arrivée).'),
    ),
    zoneInterrupteur,
    zoneBilan,
    h('h2', { class: 'titre-tours' }, 'Tour par tour'),
    visionneuse,
  );

  /** Choix du joueur analysé : proposé seulement quand les mains des autres joueurs sont connues. */
  function majChoixJoueur() {
    if (sieges.length < 2) {
      remplacer(zoneJoueur, h('p', { class: 'note' }, 'Seuls tes coups sont analysés : les mains des autres joueurs restent secrètes.'));
      return;
    }
    remplacer(
      zoneJoueur,
      h('span', { class: 'note' }, 'Joueur analysé'),
      h(
        'div',
        { class: 'choix-joueur a-' + sieges.length, role: 'group', 'aria-label': 'Joueur analysé' },
        sieges.map((sg) =>
          h(
            'button',
            { type: 'button', class: sg === joueur ? 'actif' : '', 'aria-pressed': String(sg === joueur), 'data-joueur': sg, onclick: () => choisirJoueur(sg) },
            h('span', { class: 'puce-pion', style: { '--c': couleurSiege(sg) }, 'aria-hidden': 'true' }, FORMES[PIONS[sg].forme]),
            nomJoueur(sg),
          ),
        ),
      ),
    );
  }

  function choisirJoueur(sg) {
    if (sg === joueur || !tours.has(sg)) return;
    joueur = sg;
    items = tours.get(sg);
    resultats = resultatsDe(sg);
    actuel = 0;
    autre = null;
    auRepos = false;
    curseur.max = String(Math.max(0, items.length - 1));
    analyseur.charger(taches());
    majChoixJoueur();
    majTout();
    aller(0);
  }

  /** Ligne discrète « Afficher les conseils de l'IA » : elle active le réglage sur place. */
  function majInterrupteur() {
    remplacer(
      zoneInterrupteur,
      dispo
        ? h(
            'div',
            { class: 'ligne-conseils' + (conseils ? ' actifs' : '') },
            interrupteur({
              titre: 'Afficher les conseils de l’IA',
              texte: 'Le choix de l’IA à chaque tour et le bilan des coups.',
              actif: conseils,
              surChange: (v) => {
                modifierReglages({ conseilsIA: v });
                conseils = v;
                const revenir = !!autre;
                autre = null;
                derniereCle = '';
                majTout();
                if (revenir) montrerSurPlateau();
              },
            }),
          )
        : null,
    );
  }

  function aller(i, defiler = false) {
    if (i < 0 || i >= items.length) return;
    actuel = i;
    autre = null;
    analyseur.cibler(idTache(items[i]));
    majTour();
    majCourbe();
    montrerSurPlateau();
    if (defiler) visionneuse.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /** Montre un autre choix que le coup joué (candidat de l'IA), ou revient au coup joué (null) : le coup est rejoué. */
  function montrer(choix) {
    autre = choix;
    majTour();
    montrerSurPlateau();
  }

  // ─── Plateau : le coup se joue sous les yeux, depuis la position d'avant ───
  let minuterieCoup = null;
  function montrerSurPlateau() {
    clearTimeout(minuterieCoup);
    minuterieCoup = null;
    plateau.arreterAnimations();
    const it = items[actuel];
    const base = { siegeVue: siege, siegeLocal: siege, joueurs };
    // Position d'avant, sans les marques du coup précédent (celui d'un autre joueur).
    const avant = { ...it.etat, dernierCoup: null };
    if (it.type !== 'coup') {
      plateau.maj({ ...base, etat: avant });
      return;
    }
    let apres = it.apres;
    if (autre?.coup) {
      try {
        apres = appliquerCoup(it.etat, joueur, autre.coup);
      } catch {
        autre = null;
      }
    }
    const fin = etatApresCoup(it.etat, apres);
    // Sans animation (réglage, ou mouvement réduit demandé au système) : la position d'arrivée, directement.
    if (!animationsActives()) {
      plateau.maj({ ...base, etat: fin });
      return;
    }
    plateau.maj({ ...base, etat: avant });
    minuterieCoup = setTimeout(() => {
      minuterieCoup = null;
      plateau.maj({ ...base, etat: fin });
      plateau.animer(fin.dernierCoup, siege, rythme(lireReglages().vitesse));
    }, PAUSE_AVANT);
  }

  // ─── Analyse en arrière-plan ───
  let enAttente = false;
  const programmer = () => {
    if (enAttente) return;
    enAttente = true;
    setTimeout(() => {
      enAttente = false;
      majTout();
    }, 250);
  };
  const idTache = (it) => `${it.siege}:${it.id}`;
  const taches = () =>
    items.map((it) => ({
      id: idTache(it),
      type: it.type,
      etat: it.etat,
      siege: it.siege,
      main: it.main,
      options: it.options,
      fait: !!resultats.get(it.id)?.stable,
    }));
  const ranger = (id, resultat) => {
    const [sg, i] = String(id).split(':').map(Number);
    resultatsDe(sg).set(i, resultat);
  };
  const analyseur = lancer(taches(), (msg) => {
    if (msg.type === 'pret') dispo = msg.dispo;
    else if (msg.type === 'resultat') ranger(msg.id, msg.resultat);
    else if (msg.type === 'erreur') ranger(msg.id, { erreur: msg.message, stable: true });
    else if (msg.type === 'repos') auRepos = true;
    programmer();
  });

  const touche = (e) => {
    if (e.target.closest?.('input, textarea')) return;
    if (e.key === 'ArrowLeft') aller(actuel - 1);
    else if (e.key === 'ArrowRight') aller(actuel + 1);
  };
  window.addEventListener('keydown', touche);
  // La courbe est dessinée à la largeur réelle de l'écran (texte des axes à taille fixe) : on la refait si elle change.
  let largeurCourbe = 0;
  const redimensionner = () => {
    if (zoneCourbe.clientWidth !== largeurCourbe) majCourbe();
  };
  window.addEventListener('resize', redimensionner);

  function majTout() {
    majProgres();
    majInterrupteur();
    majBilan();
    majCourbe();
    majTour(true);
  }

  function majProgres() {
    if (!dispo) {
      remplacer(zoneProgres, h('div', { class: 'apercu' }, 'L’IA ne sait pas encore analyser les coups dans cette version : tu peux revoir les tours, sans évaluation.'));
      return;
    }
    const n = items.length;
    const faits = items.filter((it) => resultats.has(it.id)).length;
    const stables = items.filter((it) => resultats.get(it.id)?.stable).length;
    if (stables >= n || (auRepos && faits >= n)) {
      remplacer(zoneProgres);
      return;
    }
    remplacer(
      zoneProgres,
      h('div', { class: 'note' }, faits < n ? `Analyse en cours : ${faits} tours sur ${n}` : 'L’analyse s’affine…'),
      h('div', { class: 'jauge', 'aria-hidden': 'true' }, h('div', { style: { width: `${(100 * (faits + stables)) / (2 * n)}%` } })),
    );
  }

  const titreItem = (it) => `Tour ${it.id + 1} · donne ${it.donne + 1}`;

  function majBilan() {
    if (!dispo || !conseils) {
      remplacer(zoneBilan);
      return;
    }
    const b = bilan(items, resultats);
    const NOMS = { meilleur: 'Meilleurs', bon: 'Bons', imprecision: 'Imprécisions', erreur: 'Erreurs' };
    const tuile = (q) => h('div', { class: 'stat qualif-' + QUALIFICATIFS[q].classe }, h('div', { class: 'etiquette' }, NOMS[q]), h('div', { class: 'valeur' }, String(b.compte[q])));
    const couteux = b.couteux.map((c) =>
      h(
        'button',
        { type: 'button', class: 'ligne', 'data-couteux': c.id, onclick: () => aller(c.id, true) },
        h('div', { class: 'principal' }, h('div', { class: 'mot' }, descriptionItem(items[c.id])), h('div', { class: 'note' }, titreItem(items[c.id]))),
        h('span', { class: 'pts ecart-neg' }, pions(-c.ecart)),
      ),
    );
    remplacer(
      zoneBilan,
      h('div', { class: 'stats' }, ['meilleur', 'bon', 'imprecision', 'erreur'].map(tuile)),
      couteux.length ? h('div', { class: 'note', style: { marginTop: '8px' } }, 'Les coups qui ont coûté le plus :') : null,
      couteux.length ? h('div', { class: 'liste' }, couteux) : null,
    );
  }

  /**
   * Courbe de l'avantage au fil des tours du joueur analysé. Axe vertical : l'avantage en pions (zéro marqué) ;
   * axe horizontal : le numéro du tour. Toucher la courbe ouvre le tour.
   */
  function majCourbe() {
    largeurCourbe = zoneCourbe.clientWidth;
    const L = Math.max(280, Math.round(largeurCourbe || 340));
    const H = L >= 520 ? 230 : 200;
    const m = { g: 40, d: 12, h: 28, b: 42 };
    const n = items.length;
    const valeurs = items.map((it) => {
      const r = resultats.get(it.id);
      return r && !r.erreur && typeof r.evaluation === 'number' ? enPions(r.evaluation, nb) : null;
    });
    const connues = valeurs.filter((v) => v !== null);
    const axe = graduations(Math.min(0, ...connues), Math.max(0, ...connues));
    const x = (i) => (n <= 1 ? (m.g + L - m.d) / 2 : m.g + (i * (L - m.g - m.d)) / (n - 1));
    const y = (v) => m.h + ((axe.max - v) * (H - m.h - m.b)) / (axe.max - axe.min);
    const bas = H - m.b;
    const signe = (v) => (v === 0 ? '0' : (v > 0 ? '+' : '−') + Math.abs(v).toLocaleString('fr-FR'));
    const titreX = moi() ? 'Tes tours de jeu' : `Tours de jeu de ${nomJoueur(joueur)}`;
    const svg = s('svg', { viewBox: `0 0 ${L} ${H}`, class: 'courbe', role: 'img', 'aria-label': `${libelleAvantage()}, en pions, au fil de la partie` });
    svg.append(s('text', { class: 'titre-axe', x: 2, y: 13 }, 'Avantage (en pions)'));
    for (const v of axe.valeurs) {
      svg.append(
        s('line', { class: v === 0 ? 'zero-courbe' : 'grille-courbe', x1: m.g, x2: L - m.d, y1: y(v), y2: y(v) }),
        s('text', { class: 'graduation' + (v === 0 ? ' zero' : ''), x: m.g - 7, y: y(v) + 4, 'text-anchor': 'end' }, signe(v)),
      );
    }
    for (const t of graduationsTours(n, L >= 520 ? 10 : 6)) {
      svg.append(
        s('line', { class: 'grille-courbe', x1: x(t - 1), x2: x(t - 1), y1: bas, y2: bas + 4 }),
        s('text', { class: 'graduation', x: x(t - 1), y: bas + 17, 'text-anchor': 'middle' }, String(t)),
      );
    }
    svg.append(s('text', { class: 'titre-axe', x: (m.g + L - m.d) / 2, y: H - 5, 'text-anchor': 'middle' }, titreX));
    const points = valeurs.map((v, i) => (v === null ? null : [x(i), y(v)])).filter(Boolean);
    if (points.length > 1) svg.append(s('polyline', { class: 'ligne-courbe', points: points.map(([a, b]) => `${a.toFixed(1)},${b.toFixed(1)}`).join(' ') }));
    svg.append(s('line', { class: 'curseur-courbe', x1: x(actuel), x2: x(actuel), y1: m.h, y2: bas }));
    // Avec les conseils : les imprécisions et les erreurs sont marquées sur la courbe (mêmes couleurs que le bilan).
    const qualifs = items.map((it) => {
      const r = resultats.get(it.id);
      return conseils && r && !r.erreur ? qualifier(candidatJoue(r), r.candidats?.[0]) : null;
    });
    valeurs.forEach((v, i) => {
      const q = qualifs[i];
      if (v !== null && (q === 'imprecision' || q === 'erreur')) svg.append(s('circle', { class: 'point-courbe qualif-' + QUALIFICATIFS[q].classe, cx: x(i), cy: y(v), r: 3.2 }));
    });
    if (valeurs[actuel] !== null) svg.append(s('circle', { class: 'point-courbe actuel', cx: x(actuel), cy: y(valeurs[actuel]), r: 5 }));
    const pas = n <= 1 ? L - m.g - m.d : (L - m.g - m.d) / (n - 1);
    items.forEach((it, i) => {
      const r = resultats.get(it.id);
      const detail = valeurs[i] === null ? '' : ` : ${pions(r.evaluation, { signe: true })}${qualifs[i] ? ' · ' + QUALIFICATIFS[qualifs[i]].nom : ''}`;
      const zone = s('rect', { class: 'zone-courbe', x: x(i) - pas / 2, y: 0, width: pas, height: H, 'data-tour': i }, s('title', {}, `Tour ${i + 1}${detail}`));
      zone.addEventListener('click', () => aller(i));
      svg.append(zone);
    });
    remplacer(zoneCourbe, svg);
  }

  function descriptionCoup(coup) {
    if (!coup) return '';
    if (coup.t === 'defausse') return `Défausser ${leCarte(coup.carte)}`;
    const carte = estJoker(coup.carte) ? `Joker comme ${rangAvecArticle(coup.comme)}` : carteCourte(coup.carte);
    return `${carte} : ${decrireAction(coup, joueur, joueurs)}`;
  }
  const nomDon = (c) => `Donner ${leCarte(c)}`;
  const descriptionCandidat = (it, c) => (it.type === 'don' ? nomDon(c.carte) : descriptionCoup(c.coup));
  const descriptionItem = (it) => (it.type === 'don' ? nomDon(it.carte) : descriptionCoup(it.coup));
  /** Ce qu'un candidat de l'IA donne à montrer : son coup, ou sa carte pour un don. */
  const choixDe = (it, c) => (it.type === 'don' ? { carte: c.carte } : { coup: c.coup });

  /** Joue sur le plateau le coup que l'IA préfère à ce tour (le premier candidat de l'analyse, à l'instant du toucher). */
  function montrerChoixIA() {
    const it = items[actuel];
    const meilleur = resultats.get(it.id)?.candidats?.[0];
    if (meilleur) montrer(choixDe(it, meilleur));
  }

  let derniereCle = '';
  let derniereCleActions = '';
  function majTour(depuisResultat = false) {
    const it = items[actuel];
    const r = resultats.get(it.id);
    const cleRendu = `${joueur}|${actuel}|${JSON.stringify(autre)}|${r ? r.iterations + '|' + r.stable : '-'}`;
    if (depuisResultat && cleRendu === derniereCle) return;
    derniereCle = cleRendu;

    curseur.value = String(actuel);
    precedent.disabled = actuel === 0;
    suivant.disabled = actuel === items.length - 1;
    remplacer(
      titreTour,
      h('div', {}, h('b', {}, `Tour ${actuel + 1} sur ${items.length}`)),
      h('div', { class: 'note' }, `Donne ${it.donne + 1}${it.type === 'don' ? ' · carte donnée' : ''}`),
    );

    const candidats = r?.candidats || [];
    const meilleur = candidats[0];
    const joueCand = candidatJoue(r);
    const qualif = conseils && dispo && r && !r.erreur ? qualifier(joueCand, meilleur) : null;
    const autreChoixIA = conseils && !!meilleur && !meilleur.joue && qualif !== 'meilleur';
    const surIA = autreChoixIA && memeChoix(autre, choixDe(it, meilleur));

    // Barre d'évaluation : remplie selon les chances de gagner, chiffrée en pions d'avance.
    if (!dispo) remplacer(zoneEval);
    else if (!r) remplacer(zoneEval, h('div', { class: 'note' }, 'Analyse de ce tour…'));
    else if (r.erreur) remplacer(zoneEval, h('div', { class: 'apercu erreur' }, 'Analyse impossible : ' + r.erreur));
    else {
      const p = probabilite(r);
      const texte = `${libelleAvantage()} : ${pions(r.evaluation, { signe: true })}`;
      remplacer(
        zoneEval,
        h(
          'div',
          { class: 'barre-eval', role: 'img', 'aria-label': texte },
          h('div', { class: 'part-nous', style: { width: `${(p ?? neutre) * 100}%` } }),
          h('div', { class: 'repere-neutre', style: { left: `${neutre * 100}%` } }),
          h('span', { class: 'texte-eval', 'aria-hidden': 'true' }, texte),
        ),
      );
    }

    // Sous le plateau : rejouer le coup, voir celui de l'IA. Les boutons ne sont refaits que s'ils changent (un
    // résultat d'analyse qui arrive pendant qu'on appuie ne doit pas avaler le toucher).
    const rejouable = it.type === 'coup' && (!!autre || animationsActives());
    const voirIA = it.type === 'coup' && autreChoixIA;
    const cleActions = `${joueur}|${actuel}|${rejouable}|${!!autre}|${voirIA}|${surIA}`;
    if (cleActions !== derniereCleActions) {
      derniereCleActions = cleActions;
      remplacer(
        zoneActions,
        rejouable ? h('button', { type: 'button', class: 'bouton large', 'data-action': 'rejouer-coup', onclick: () => montrer(null) }, autre ? 'Revoir le coup joué' : 'Rejouer le coup') : null,
        voirIA
          ? h('button', { type: 'button', class: 'bouton large' + (surIA ? ' actif' : ''), 'aria-pressed': String(!!surIA), 'data-action': 'coup-ia', onclick: montrerChoixIA }, 'Voir le coup de l’IA')
          : null,
      );
    }

    // Main du joueur à ce moment, en grand, la carte jouée (ou montrée) en évidence.
    const carteMontree = it.type === 'don' ? (autre?.carte ?? it.carte) : (autre?.coup ?? it.coup).carte;
    const titreMain = `${moi() ? 'Ta main' : `Main de ${nomJoueur(joueur)}`}${it.type === 'don' ? ' avant l’échange' : ''}`;
    remplacer(
      zoneMain,
      h('span', { class: 'note' }, titreMain),
      h('div', { class: 'cartes-analyse', role: 'group', 'aria-label': titreMain }, trierMain(it.main || []).map((c) => dessinCarte(c, { choisie: c === carteMontree }))),
    );

    // Coup joué, coup préféré de l'IA, autres candidats. Les raisons de l'IA s'adressent au joueur (« tu… ») :
    // elles ne sont montrées que pour ses propres coups.
    const raisons = (c) => (moi() && c?.raisons?.length ? h('ul', { class: 'raisons' }, c.raisons.map((x) => h('li', {}, x))) : null);
    const lignes = [];
    lignes.push(
      h(
        'button',
        { type: 'button', class: 'ligne' + (conseils && !autre ? ' choisie' : ''), 'data-ligne': 'joue', onclick: () => montrer(null) },
        h(
          'div',
          { class: 'principal' },
          h('div', { class: 'note' }, it.type === 'don' ? 'Carte donnée' : 'Coup joué'),
          h('div', { class: 'mot' }, descriptionItem(it)),
          // Le coût du coup joué (écart avec le choix de l'IA), et ses raisons seulement s'il est bon : une
          // « Erreur » n'apparaît jamais à côté de phrases qui le décrivent comme un bon coup.
          joueCand && qualif && qualif !== 'meilleur' && typeof joueCand.ecart === 'number'
            ? h('div', { class: 'note cout-coup' + (qualif === 'bon' ? '' : ' ecart-neg') }, `Coûte ${pions(joueCand.ecart)} par rapport au choix de l’IA`)
            : null,
          qualif === 'meilleur' || qualif === 'bon' ? raisons(joueCand) : null,
        ),
        qualif ? h('span', { class: 'badge qualif-' + QUALIFICATIFS[qualif].classe }, QUALIFICATIFS[qualif].nom) : null,
      ),
    );
    if (!conseils) {
      remplacer(zoneCoups, lignes);
      return;
    }
    if (autreChoixIA) {
      lignes.push(
        h(
          'button',
          { type: 'button', class: 'meilleur-coup' + (surIA ? ' choisi' : ''), 'data-ligne': 'ia', onclick: () => montrer(choixDe(it, meilleur)) },
          h('div', { class: 'principal' }, h('div', { class: 'etiquette' }, 'Le choix de l’IA'), h('div', { class: 'mot' }, descriptionCandidat(it, meilleur)), raisons(meilleur)),
        ),
      );
    } else if (meilleur && qualif === 'meilleur') {
      lignes.push(h('div', { class: 'apercu ok' }, 'C’est aussi le choix de l’IA.'));
    }
    const autres = candidats.filter((c, i) => i > 0 && !c.joue).slice(0, 2);
    if (autres.length) {
      lignes.push(h('div', { class: 'note' }, 'Autres possibilités :'));
      for (const c of autres) {
        lignes.push(
          h(
            'button',
            { type: 'button', class: 'ligne' + (memeChoix(autre, choixDe(it, c)) ? ' choisie' : ''), onclick: () => montrer(choixDe(it, c)) },
            h('div', { class: 'principal' }, h('div', { class: 'mot' }, descriptionCandidat(it, c))),
            typeof c.ecart === 'number' ? h('span', { class: 'pts' }, pions(-c.ecart)) : null,
          ),
        );
      }
    }
    remplacer(zoneCoups, lignes);
  }

  majChoixJoueur();
  majTout();
  aller(0);
  return () => {
    clearTimeout(minuterieCoup);
    plateau.arreterAnimations();
    window.removeEventListener('keydown', touche);
    window.removeEventListener('resize', redimensionner);
  };
}

function probabilite(r) {
  if (!r || r.erreur) return null;
  if (typeof r.probaVictoire === 'number') return Math.min(1, Math.max(0, r.probaVictoire));
  if (typeof r.evaluation === 'number') return 1 / (1 + Math.exp(-r.evaluation / 8));
  return null;
}
