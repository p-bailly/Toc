// Analyse de fin de partie (routes #/analyse/locale et #/analyse/ID), sur le modèle de l'analyse de l'appli
// Scrabble : un plateau que l'on fait défiler tour par tour (les coups et les cartes données du joueur), le coup
// joué et le coup préféré de l'IA, leurs raisons, un qualificatif, et une barre d'évaluation « comme aux échecs »
// qui s'affine tant que le tour reste affiché. Une vue d'ensemble (courbe et bilan) se remplit en arrière-plan.
// Les calculs tournent dans un Web Worker (voir analyseur.js).

import { h, s, remplacer, messageErreur, pluriel } from './dom.js';
import { enteteRetour } from './composants.js';
import { Plateau } from './plateau.js';
import { dessinCarte } from './carte.js';
import { piRetour } from './pictos.js';
import { carteCourte, decrireAction, trierMain, rangAvecArticle } from './libelles.js';
import { estJoker } from '../moteur/cartes.js';
import { SessionLocale } from '../session-locale.js';
import { apercuCoup } from '../moteur/regles.js';
import { lancerAnalyse } from './analyseur.js';
import { toursDuJoueur, qualifier, candidatJoue, bilan, formatCases, QUALIFICATIFS, SEUILS } from './analyse-calcul.js';

/** Résultats gardés en mémoire (par partie) pour ne pas recalculer en revenant sur l'écran. */
const memoire = new Map();

export function afficher(racine, app, { reste }) {
  const id = reste[0] || 'locale';
  // #/analyse/locale (2 contre 2) ou #/analyse/locale3 (3 joueurs) : parties d'entraînement.
  const locale = id === 'locale' || id === 'locale3';
  const retour = locale ? '#/ia' : '#/parties';
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
      donnees = locale ? await donneesLocales(id === 'locale3' ? 3 : 4) : await donneesEnLigne(app, id);
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
    let items;
    try {
      const rejeu = moteur.rejouerPartie(donnees.reglages, donnees.historique);
      items = toursDuJoueur(donnees, rejeu, moteur.mainAvantCoup);
    } catch (e) {
      message('Impossible de rejouer cette partie : ' + messageErreur(e));
      return;
    }
    if (!items.length) {
      message('Aucun coup à analyser dans cette partie.');
      return;
    }
    if (ferme) return;
    const cle = locale ? id + '-' + donnees.historique.length + '-' + JSON.stringify(donnees.historique[0]?.coup || '') : id;
    const resultats = memoire.get(cle) || new Map();
    memoire.set(cle, resultats);
    detruireVue = monterVue(contenu, { donnees, items, resultats, retour, lancer: (taches, surMsg) => (analyse = lancerAnalyse(taches, surMsg)) });
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

function monterVue(contenu, { donnees, items, resultats, retour, lancer }) {
  const { siege, joueurs } = donnees;
  // À 3, l'évaluation est celle du joueur seul : un joueur neutre a 1 chance sur 3, pas 1 sur 2.
  const a3 = (joueurs?.length || 4) === 3 || donnees.reglages?.nbJoueurs === 3;
  const neutre = a3 ? 1 / 3 : 0.5;
  let actuel = 0;
  let montre = 'joue'; // 'joue' | 'meilleur' | index de candidat
  let dispo = true;
  let mode = '';

  const plateau = new Plateau({});
  const zoneProgres = h('div', { class: 'liste' });
  const zoneBilan = h('div', { class: 'bilan-analyse' });
  const zoneCourbe = h('div', { class: 'courbe-analyse' });
  const titreTour = h('div', { class: 'principal centre' });
  const curseur = h('input', { type: 'range', class: 'curseur-tours', min: 0, max: Math.max(0, items.length - 1), value: 0, 'aria-label': 'Choisir un tour', oninput: (e) => aller(Number(e.target.value)) });
  const precedent = h('button', { type: 'button', class: 'bouton-icone', 'aria-label': 'Tour précédent', onclick: () => aller(actuel - 1) }, piRetour());
  const suivant = h('button', { type: 'button', class: 'bouton-icone suivant', 'aria-label': 'Tour suivant', onclick: () => aller(actuel + 1) }, piRetour());
  const zoneEval = h('div', { class: 'evaluation' });
  const zoneMain = h('div', { class: 'main-analyse', 'aria-label': 'Ta main à ce moment' });
  const zoneCoups = h('div', { class: 'liste' });
  const visionneuse = h(
    'div',
    { class: 'visionneuse' },
    h('div', { class: 'nav-tours' }, precedent, titreTour, suivant),
    curseur,
    zoneEval,
    h('div', { class: 'zone-plateau' }, plateau.el),
    zoneMain,
    zoneCoups,
  );
  remplacer(
    contenu,
    enteteRetour('Analyse de la partie', retour),
    zoneProgres,
    h('h2', {}, 'Vue d’ensemble'),
    zoneCourbe,
    zoneBilan,
    h('h2', {}, 'Tour par tour'),
    visionneuse,
    h(
      'p',
      { class: 'note' },
      `Qualificatif selon l’écart avec le choix préféré de l’IA, en cases d’avance (l’incertitude de l’analyse est déduite) : jusqu’à ${fmt(SEUILS.meilleur)}, meilleur coup ; jusqu’à ${fmt(SEUILS.bon)}, bon coup ; jusqu’à ${fmt(SEUILS.imprecision)}, imprécision ; au-delà, erreur.`,
    ),
  );

  function aller(i, defiler = false) {
    if (i < 0 || i >= items.length) return;
    actuel = i;
    montre = 'joue';
    analyseur.cibler(items[i].id);
    majTour();
    majCourbe();
    if (defiler) visionneuse.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
  const taches = items.map((it) => ({
    id: it.id,
    type: it.type,
    etat: it.etat,
    siege,
    main: it.main,
    options: it.options,
    fait: !!resultats.get(it.id)?.stable,
  }));
  const analyseur = lancer(taches, (msg) => {
    if (msg.type === 'pret') {
      dispo = msg.dispo;
      programmer();
    } else if (msg.type === 'resultat') {
      resultats.set(msg.id, msg.resultat);
      programmer();
    } else if (msg.type === 'erreur') {
      resultats.set(msg.id, { erreur: msg.message, stable: true });
      programmer();
    } else if (msg.type === 'repos') programmer();
  });
  analyseur.cibler(items[0].id);

  const touche = (e) => {
    if (e.target.closest?.('input, textarea')) return;
    if (e.key === 'ArrowLeft') aller(actuel - 1);
    else if (e.key === 'ArrowRight') aller(actuel + 1);
  };
  window.addEventListener('keydown', touche);

  function majTout() {
    mode = analyseur.mode();
    majProgres();
    majBilan();
    majCourbe();
    majTour(true);
  }

  function majProgres() {
    if (!dispo) {
      remplacer(zoneProgres, h('div', { class: 'apercu' }, 'L’IA ne sait pas encore analyser les coups dans cette version : tu peux revoir tes tours, sans évaluation.'));
      return;
    }
    const faits = items.filter((it) => resultats.has(it.id)).length;
    const stables = items.filter((it) => resultats.get(it.id)?.stable).length;
    const texte =
      faits < items.length
        ? `Première passe… ${faits} / ${items.length} tours`
        : stables < items.length
          ? `Analyse affinée : ${stables} / ${items.length} tours stables`
          : 'Analyse terminée';
    remplacer(
      zoneProgres,
      h('div', { class: 'note' }, texte, mode === 'principal' ? ' (calcul sur le fil principal)' : ''),
      faits < items.length || stables < items.length ? h('div', { class: 'jauge', 'aria-hidden': 'true' }, h('div', { style: { width: `${(100 * (faits + stables)) / (2 * items.length)}%` } })) : null,
    );
  }

  function majBilan() {
    if (!dispo) {
      remplacer(zoneBilan);
      return;
    }
    const b = bilan(items, resultats);
    const NOMS = { meilleur: 'Meilleurs', bon: 'Bons', imprecision: 'Imprécisions', erreur: 'Erreurs' };
    const tuile = (q) => h('div', { class: 'stat qualif-' + QUALIFICATIFS[q].classe }, h('div', { class: 'etiquette' }, NOMS[q]), h('div', { class: 'valeur' }, String(b.compte[q])));
    const couteux = b.couteux.map((c) =>
      h(
        'button',
        { type: 'button', class: 'ligne', onclick: () => aller(c.id, true) },
        h('div', { class: 'principal' }, h('div', { class: 'mot' }, titreItem(items[c.id])), h('div', { class: 'note' }, descriptionItem(items[c.id]))),
        h('span', { class: 'pts ecart-neg' }, '−' + fmt(c.ecart)),
      ),
    );
    remplacer(
      zoneBilan,
      h('div', { class: 'stats' }, ['meilleur', 'bon', 'imprecision', 'erreur'].map(tuile)),
      couteux.length ? h('div', { class: 'note', style: { marginTop: '8px' } }, 'Les coups qui ont coûté le plus :') : null,
      couteux.length ? h('div', { class: 'liste' }, couteux) : null,
    );
  }

  function majCourbe() {
    const L = 320;
    const H = 90;
    const n = items.length;
    const x = (i) => (n <= 1 ? L / 2 : 8 + (i * (L - 16)) / (n - 1));
    const y = (p) => H - 8 - p * (H - 16);
    const svg = s('svg', { viewBox: `0 0 ${L} ${H}`, class: 'courbe', role: 'img', 'aria-label': a3 ? 'Tes chances de gagner au fil de la partie' : 'Chances de victoire de ton équipe au fil de la partie' });
    svg.append(
      s('rect', { class: 'fond-courbe', x: 0, y: 0, width: L, height: H, rx: 6 }),
      s('line', { class: 'mi-courbe', x1: 0, x2: L, y1: y(neutre), y2: y(neutre) }),
      s('text', { class: 'legende-courbe', x: L - 4, y: y(neutre) - 3, 'text-anchor': 'end' }, a3 ? 'égalité : 1 chance sur 3' : 'égalité : 50 %'),
      s('text', { class: 'legende-courbe', x: 4, y: 12 }, '100 %'),
      s('text', { class: 'legende-courbe', x: 4, y: H - 3 }, '0 %'),
    );
    const points = [];
    items.forEach((it, i) => {
      const r = resultats.get(it.id);
      const p = probabilite(r);
      if (p !== null) points.push([x(i), y(p), i, r]);
    });
    if (points.length > 1) svg.append(s('polyline', { class: 'ligne-courbe', points: points.map(([a, b]) => `${a.toFixed(1)},${b.toFixed(1)}`).join(' ') }));
    svg.append(s('line', { class: 'curseur-courbe', x1: x(actuel), x2: x(actuel), y1: 2, y2: H - 2 }));
    for (const [a, b, i, r] of points) {
      const q = qualifier(candidatJoue(r), r.candidats?.[0]);
      svg.append(s('circle', { class: 'point-courbe ' + (q ? 'qualif-' + QUALIFICATIFS[q].classe : ''), cx: a, cy: b, r: i === actuel ? 4 : 2.6 }));
    }
    const pas = n <= 1 ? L : (L - 16) / (n - 1);
    items.forEach((it, i) => {
      const zone = s('rect', { class: 'zone-courbe', x: x(i) - pas / 2, y: 0, width: pas, height: H, 'data-tour': i });
      zone.addEventListener('click', () => aller(i));
      svg.append(zone);
    });
    remplacer(zoneCourbe, svg);
  }

  function titreItem(it) {
    if (it.type === 'don') return `Donne ${it.donne + 1} · carte donnée`;
    return `Donne ${it.donne + 1} · coup n° ${it.n}`;
  }

  function descriptionCoup(coup) {
    if (!coup) return '';
    if (coup.t === 'defausse') return estJoker(coup.carte) ? 'Défausser le joker' : `Défausser le ${carteCourte(coup.carte)}`;
    const carte = estJoker(coup.carte) ? `Joker comme ${rangAvecArticle(coup.comme)}` : carteCourte(coup.carte);
    return `${carte} : ${decrireAction(coup, siege, joueurs)}`;
  }
  const nomDon = (c) => `Donner ${estJoker(c) ? 'le joker' : 'le ' + carteCourte(c)}`;
  const descriptionCandidat = (it, c) => (it.type === 'don' ? nomDon(c.carte) : descriptionCoup(c.coup));
  const descriptionItem = (it) => (it.type === 'don' ? nomDon(it.carte) : descriptionCoup(it.coup));

  let derniereCle = '';
  function majTour(depuisResultat = false) {
    const it = items[actuel];
    const r = resultats.get(it.id);
    const cleRendu = `${actuel}|${montre}|${r ? r.iterations + '|' + r.stable : '-'}`;
    if (depuisResultat && cleRendu === derniereCle) return;
    derniereCle = cleRendu;

    curseur.value = String(actuel);
    precedent.disabled = actuel === 0;
    suivant.disabled = actuel === items.length - 1;
    remplacer(titreTour, h('div', {}, h('b', {}, titreItem(it))), h('div', { class: 'note' }, `${actuel + 1} / ${items.length}`));

    // Coup affiché sur le plateau.
    const candidats = r?.candidats || [];
    const meilleur = candidats[0];
    const joueCand = candidatJoue(r);
    let coupMontre = null;
    if (it.type === 'coup') {
      if (montre === 'joue') coupMontre = it.coup;
      else if (montre === 'meilleur') coupMontre = meilleur?.coup || it.coup;
      else coupMontre = candidats[montre]?.coup || it.coup;
    }
    const { pions, choix } = choixPour(coupMontre, it.etat, siege);
    plateau.maj({ siegeVue: siege, etat: it.etat, joueurs, pions, choix, siegeLocal: siege });

    // Main du joueur à ce moment, carte jouée en évidence.
    let carteMontree = it.type === 'don' ? it.carte : coupMontre?.carte;
    if (it.type === 'don' && montre !== 'joue') carteMontree = (montre === 'meilleur' ? meilleur : candidats[montre])?.carte || it.carte;
    remplacer(
      zoneMain,
      h('span', { class: 'note' }, it.type === 'don' ? 'Ta main avant l’échange :' : 'Ta main :'),
      h('div', { class: 'cartes-analyse' }, trierMain(it.main || []).map((c) => dessinCarte(c, { petite: true, choisie: c === carteMontree }))),
    );

    // Barre d'évaluation.
    if (!dispo) remplacer(zoneEval);
    else if (!r) remplacer(zoneEval, h('div', { class: 'note' }, 'Analyse de ce tour…'));
    else if (r.erreur) remplacer(zoneEval, h('div', { class: 'apercu erreur' }, 'Analyse impossible : ' + r.erreur));
    else {
      const p = probabilite(r);
      remplacer(
        zoneEval,
        h(
          'div',
          { class: 'barre-eval', role: 'meter', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': p === null ? null : Math.round(p * 100), 'aria-label': a3 ? 'Tes chances de gagner' : 'Chances de victoire de ton équipe' },
          h('div', { class: 'part-nous', style: { width: `${(p ?? neutre) * 100}%` } }),
          h('div', { class: 'repere-neutre', style: { left: `${neutre * 100}%` }, title: a3 ? 'Égalité entre les trois joueurs' : 'Égalité' }),
          h('span', { class: 'texte-eval' }, p === null ? '' : `${a3 ? 'Tes chances : ' : ''}${Math.round(p * 100)} %`),
        ),
        h(
          'div',
          { class: 'note ligne-eval' },
          h('span', {}, a3 ? 'Ton avance : ' : `Avantage de ton équipe : `, h('b', {}, `${formatCases(r.evaluation)} cases`), typeof r.marge === 'number' ? ` ± ${fmt(r.marge)}` : ''),
          h('span', {}, `${(r.iterations || 0).toLocaleString('fr-FR')} simulations · ${r.stable ? 'stable' : 's’affine…'}`),
        ),
      );
    }

    // Coup joué, coup préféré de l'IA, autres candidats.
    const lignes = [];
    const qualif = dispo && r && !r.erreur ? qualifier(joueCand, meilleur) : null;
    lignes.push(
      h(
        'button',
        { type: 'button', class: 'ligne' + (montre === 'joue' ? ' choisie' : ''), onclick: () => ((montre = 'joue'), majTour()) },
        h(
          'div',
          { class: 'principal' },
          h('div', { class: 'note' }, it.type === 'don' ? 'Carte donnée' : 'Coup joué'),
          h('div', { class: 'mot' }, descriptionItem(it)),
          // Le coût du coup joué (écart avec le choix de l'IA), et ses raisons seulement s'il est bon : une
          // « Erreur » n'apparaît jamais à côté de phrases qui le décrivent comme un bon coup.
          joueCand && qualif && qualif !== 'meilleur' && typeof joueCand.ecart === 'number'
            ? h('div', { class: 'note cout-coup' + (qualif === 'bon' ? '' : ' ecart-neg') }, `Coûte ${fmt(joueCand.ecart)} case${joueCand.ecart >= 2 ? 's' : ''} par rapport au choix de l’IA`)
            : null,
          joueCand?.raisons?.length && (qualif === 'meilleur' || qualif === 'bon') ? h('ul', { class: 'raisons' }, joueCand.raisons.map((x) => h('li', {}, x))) : null,
        ),
        qualif ? h('span', { class: 'badge qualif-' + QUALIFICATIFS[qualif].classe }, QUALIFICATIFS[qualif].nom) : null,
      ),
    );
    if (meilleur && !meilleur.joue && qualif !== 'meilleur') {
      lignes.push(
        h(
          'button',
          { type: 'button', class: 'meilleur-coup' + (montre === 'meilleur' ? ' choisi' : ''), onclick: () => ((montre = 'meilleur'), majTour()) },
          h(
            'div',
            { class: 'principal' },
            h('div', { class: 'etiquette' }, 'Le choix de l’IA'),
            h('div', { class: 'mot' }, descriptionCandidat(it, meilleur)),
            meilleur.raisons?.length ? h('ul', { class: 'raisons' }, meilleur.raisons.map((x) => h('li', {}, x))) : null,
          ),
          null,
        ),
      );
    } else if (meilleur && qualif === 'meilleur') {
      lignes.push(h('div', { class: 'apercu ok' }, 'C’est aussi le choix de l’IA.'));
    }
    const autres = candidats.map((c, i) => [c, i]).filter(([c, i]) => i > 0 && !c.joue).slice(0, 2);
    if (autres.length) {
      lignes.push(h('div', { class: 'note' }, 'Autres possibilités :'));
      for (const [c, i] of autres) {
        lignes.push(
          h(
            'button',
            { type: 'button', class: 'ligne' + (montre === i ? ' choisie' : ''), onclick: () => ((montre = i), majTour()) },
            h('div', { class: 'principal' }, h('div', { class: 'mot' }, descriptionCandidat(it, c)), c.raisons?.length ? h('div', { class: 'note' }, c.raisons[0]) : null),
            typeof c.ecart === 'number' ? h('span', { class: 'pts' }, '−' + fmt(c.ecart)) : null,
          ),
        );
      }
    }
    remplacer(zoneCoups, lignes);
  }

  majTout();
  aller(0);
  return () => window.removeEventListener('keydown', touche);
}

function probabilite(r) {
  if (!r || r.erreur) return null;
  if (typeof r.probaVictoire === 'number') return Math.min(1, Math.max(0, r.probaVictoire));
  if (typeof r.evaluation === 'number') return 1 / (1 + Math.exp(-r.evaluation / 8));
  return null;
}

const fmt = (x) => (typeof x === 'number' ? x.toLocaleString('fr-FR', { maximumFractionDigits: 1 }) : '–');

/** Pions affichés et marques du plateau pour montrer un coup (fantôme à l'arrivée, croix sur les captures). */
function choixPour(coup, etat, siege) {
  if (!coup || coup.t === 'defausse') return { pions: null, choix: null };
  let a = null;
  try {
    a = apercuCoup(etat, siege, coup);
  } catch {
    a = null;
  }
  if (!a) return { pions: null, choix: null };
  if (coup.t === 'sept') {
    const bouges = new Set(a.deplacements.filter((d) => !d.capture).map((d) => d.pion));
    return { pions: a.pions, choix: { candidats: bouges, choisi: null, cibles: [], captures: [] } };
  }
  if (coup.t === 'echange') {
    return { pions: null, choix: { candidats: new Set([coup.pion, coup.cible]), choisi: coup.pion, fantome: { pion: coup.pion, pos: etat.pions[coup.cible] }, cibles: [], captures: [] } };
  }
  const dep = a.deplacements.filter((d) => d.pion === coup.pion && !d.capture).pop();
  return {
    pions: null,
    choix: { candidats: new Set([coup.pion]), choisi: coup.pion, fantome: dep ? { pion: coup.pion, pos: dep.vers } : null, cibles: [], captures: a.captures || [] },
  };
}
