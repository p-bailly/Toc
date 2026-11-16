// Écran de jeu, commun à la partie d'entraînement et aux parties en ligne : il ne connaît que l'interface
// « Session » (voir session-locale.js) et interroge le moteur pour tout ce qui est règle.
//
// Agencement (comme l'écran de jeu de l'appli Scrabble) : barre du haut, plateau d'un bord à l'autre, main du
// joueur dans le bac bleu, ligne de consigne, boutons, puis la barre de statut. Sur grand écran, le plateau
// passe à gauche et le reste forme une colonne à droite.

import { h, remplacer, messageErreur, pluriel, mouvementReduit } from './dom.js';
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
} from '../moteur/index.js';
import { Plateau, dessinPion } from './plateau.js';
import { dessinCarte } from './carte.js';
import { ouvrirFeuille } from './composants.js';
import { piRetour, piHistorique, piOk, piAnnuler, piConseil } from './pictos.js';
import * as IA from '../ia/ia.js';
import { trierMain, carteCourte, libelleChoix, ligneJournal, enumerer, nomCarte, decrireAction, rangAvecArticle, leCarte } from './libelles.js';
import { couleurSiege, nomCouleur, PIONS } from './couleurs.js';
import { lireReglages } from './reglages.js';
import { majMonTour, notifier } from './notifications.js';
import { s } from './dom.js';

const NOMS_FORMES = { rond: '●', carre: '■', triangle: '▲', losange: '◆' };

/**
 * Monte l'écran de jeu dans `racine`.
 * @param {Object} o
 * @param {Object} o.session        Session (abonner, donner, jouer, fermer)
 * @param {string} o.retour         hash du bouton retour
 * @param {Function} [o.rejouer]    partie d'entraînement : relancer une partie
 * @returns {Function} destruction
 */
export function monterJeu(racine, { session, retour, libelleRetour = 'Retour', rejouer = null, conseils = false, analyse = null }) {
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
  const boutonJournal = h('button', { type: 'button', class: 'bouton-icone', 'aria-label': 'Journal des coups', onclick: () => ouvrirJournal() }, piHistorique());
  const barre = h(
    'header',
    { class: 'barre-jeu' },
    h('a', { class: 'bouton-icone', href: retour, 'aria-label': libelleRetour }, piRetour()),
    h('div', { class: 'titre' }, titre, sousTitre),
    boutonConseilPlace(),
    boutonJournal,
  );
  const zonePlateau = h('div', { class: 'zone-plateau pleine' }, plateau.el);
  const main = h('div', { class: 'chevalet main-joueur', role: 'group', 'aria-label': 'Tes cartes' });
  const consigne = h('div', { class: 'apercu consigne', role: 'status', 'aria-live': 'polite' });
  const actions = h('div', { class: 'actions choix-coup' });
  const statut = h('div', { class: 'statut' });
  const colonne = h('div', { class: 'colonne-jeu' }, main, consigne, h('div', { class: 'panneau-bas' }, actions, statut));
  const ecran = h('div', { class: 'ecran-jeu' }, barre, zonePlateau, colonne);
  remplacer(racine, ecran);

  // ─── État de la saisie ────────────────────────────────────────────────────
  let vue = null;
  let carte = null; // carte choisie
  let pion = null; // pion choisi
  let coupPret = null; // coup en attente de confirmation
  let sept = null; // { etapes, pions, captures } pendant la saisie d'un 7
  let envoi = false;
  let histoVu = -1;
  let recuSignale = null;
  let finMontree = false;
  let feuilleFin = null;
  let feuilleJournal = null;
  let monTourAvant = false;
  let ciblesCourantes = [];
  let feuilleConseil = null;
  let comme = null; // joker (jeu à 3) : rang copié choisi
  let avis = null; // message bref affiché dans la consigne : { texte, erreur }
  let minuterieAvis = null;

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

  const desabonner = session.abonner((v) => {
    const ancienne = vue;
    vue = v;
    // Nouvel état : la saisie en cours n'a plus de sens si la main ou le tour ont changé.
    // (Pendant l'échange, les dons des autres ne touchent pas à la carte choisie.)
    const autreCoup = ancienne && ancienne.etat.numCoup !== v.etat.numCoup && v.etat.phase !== 'echange';
    if (!ancienne || autreCoup || ancienne.etat.phase !== v.etat.phase || ancienne.etat.donne !== v.etat.donne) reinitialiser();
    if (carte && !v.main.includes(carte)) reinitialiser();
    rendre();
    animerSiBesoin(ancienne);
    signalerRecu();
    signalerTour();
    if (v.etat.phase === 'fini' && !finMontree) {
      finMontree = true;
      setTimeout(montrerFin, ancienne ? 900 : 0);
    }
  });

  function animerSiBesoin(ancienne) {
    const n = vue.historique?.length ?? 0;
    const precedent = histoVu;
    histoVu = n;
    if (!ancienne || precedent < 0 || n !== precedent + 1) return;
    if (!lireReglages().animations || mouvementReduit()) return;
    plateau.animer(vue.etat.dernierCoup, vue.siege);
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
    if (envoi || !vue) return;
    const { etat } = vue;
    if (etat.phase === 'echange') {
      if (vue.don) return;
      carte = carte === c ? null : c;
      rendre();
      return;
    }
    if (etat.phase !== 'jeu' || etat.tour !== vue.siege) return;
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
    if (!coupPret || envoi) return;
    const coup = coupPret;
    const avant = { etat: vue.etat, main: vue.main.slice(), don: vue.don, recu: vue.recu };
    envoi = true;
    rendre();
    try {
      await session.jouer(coup);
      commenter(avant, coup);
    } catch (e) {
      annoncer(messageErreur(e), { erreur: true, duree: 6000 });
    } finally {
      envoi = false;
      reinitialiser();
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

  function rendre() {
    if (!vue) return;
    const { etat, siege, joueurs } = vue;
    const jeu = etat.phase === 'jeu';
    const monTour = jeu && etat.tour === siege;
    const coups = monTour ? coupsParCarte() : new Map();
    const jouable = monTour && mainJouable(etat, siege, vue.main);
    const actifCouleur = couleurActive(etat, siege);

    titre.textContent = vue.nom || 'Partie de Toc';
    sousTitre.textContent = `Donne ${etat.donne + 1}`;

    // Plateau : candidats, cibles, aperçu.
    const choix = calculerChoix(monTour);
    const pionsAffiches = sept ? sept.pions : coupPret?.t === 'sept' ? destination(coupPret).pions || null : null;
    plateau.maj({ siegeVue: siege, etat, joueurs, pions: pionsAffiches, choix, sousTitres: sousTitres(), siegeLocal: siege });
    boutonConseil.disabled = !aMoi() || envoi || vue.enLigne;
    boutonConseil.hidden = !conseilsDispo || !lireReglages().conseilsIA;
    zonePlateau.classList.toggle('a-moi', aMoi());

    // Main.
    const recue = jeu && vue.recu && vue.main.includes(vue.recu) ? vue.recu : null;
    const marqueRecue = nb() === 3 ? `reçue de ${(vue.joueurs[donneurDe()]?.pseudo || '').slice(0, 9)}` : 'reçue';
    const cartes = trierMain(vue.main).map((c) => {
      const injouable = monTour && jouable && !(coups.get(c) || []).length;
      const inactive = (!monTour && !(etat.phase === 'echange' && !vue.don)) || envoi;
      return dessinCarte(c, {
        bouton: true,
        choisie: carte === c,
        injouable,
        inactive,
        marque: c === recue ? marqueRecue : c === vue.don ? 'donnée' : null,
        surToucher: () => toucherCarte(c),
      });
    });
    if (!cartes.length) cartes.push(h('span', { class: 'main-vide' }, etat.phase === 'fini' ? 'Partie terminée' : 'Plus de cartes pour cette donne'));
    remplacer(main, cartes);
    main.classList.toggle('inactive', !aMoi());

    rendreConsigne(monTour, jouable, actifCouleur);
    rendreStatut(actifCouleur);
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
      const d = destination(coupPret);
      choix.fantome = { pion: coupPret.pion, pos: d.pos };
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
    if (avis) lignes.push(h('span', { class: 'avis-jeu' + (avis.erreur ? ' erreur' : ''), role: avis.erreur ? 'alert' : null }, avis.texte));

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
        lignes.push(h('span', {}, `Tu as donné ${leCarte(vue.don)} à ${nomDest}. `, attendus.length ? `En attente de ${enumerer(attendus)}.` : ''));
      }
    } else if (!monTour) {
      lignes.push(h('span', {}, 'En attente de ', h('b', {}, nomSiege(etat.tour)), '…'));
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
      for (const k of proposes.slice(0, 12)) {
        boutons.push(
          h('button', { type: 'button', class: 'bouton', onclick: () => preparer(k), 'data-choix': cle(k) }, libelleCoupComplet(k)),
        );
      }
      boutons.push(h('button', { type: 'button', class: 'bouton discret', onclick: () => (reinitialiser(), rendre()), 'data-action': 'annuler' }, 'Annuler'));
    }
    if (monTour && actifCouleur !== siege && etat.phase === 'jeu') {
      lignes.push(h('span', { class: 'note joue-pour' }, puceCouleur(actifCouleur), ` Tes pions sont rentrés : tu joues les pions ${nomCouleur(actifCouleur)}s de ${nomP}.`));
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

  function rendreStatut(actifCouleur) {
    const { etat, siege } = vue;
    const rentres = (si) => etat.pions.slice(si * 4, si * 4 + 4).filter((p) => p >= ALLEE).length;
    if (nb() === 3) {
      // Chacun pour soi : l'avancement de chaque joueur, dans l'ordre de jeu à partir de soi.
      const ordre = [siege, (siege + 1) % 3, (siege + 2) % 3];
      remplacer(
        statut,
        h('div', { class: 'pastille-couleur', title: 'Tes pions' }, s('svg', { viewBox: '-5 -5 10 10', width: 30, height: 30, 'aria-hidden': 'true' }, dessinPionMini(siege))),
        h(
          'div',
          { class: 'milieu avancement-3' },
          ordre.map((si) =>
            h(
              'div',
              { class: 'ligne-avancement' },
              h('span', { class: 'texte' + (si === siege ? '' : ' note') }, puceCouleur(si), ` ${nomSiege(si)} · ${rentres(si)}/4`),
              h('div', { class: 'jauge' }, h('div', { style: { width: `${(rentres(si) / 4) * 100}%`, background: couleurSiege(si) } })),
            ),
          ),
        ),
      );
      return;
    }
    const nous = rentres(siege) + rentres(partenaire(siege));
    const eux = rentres((siege + 1) % 4) + rentres((siege + 3) % 4);
    const p = partenaire(siege);
    remplacer(
      statut,
      h(
        'div',
        { class: 'pastille-couleur', title: 'Tes pions' },
        s('svg', { viewBox: '-5 -5 10 10', width: 30, height: 30, 'aria-hidden': 'true' }, dessinPionMini(actifCouleur)),
      ),
      h(
        'div',
        { class: 'milieu' },
        h('div', { class: 'texte' }, h('b', {}, `Toi et ${vue.joueurs[p]?.pseudo || 'partenaire'}`), ` · ${nous}/8 rentrés`),
        h('div', { class: 'jauge' }, h('div', { style: { width: `${(nous / 8) * 100}%` } })),
        h('div', { class: 'texte note' }, `Adversaires · ${eux}/8 rentrés`),
        h('div', { class: 'jauge adverse' }, h('div', { style: { width: `${(eux / 8) * 100}%` } })),
      ),
    );
  }

  function dessinPionMini(si) {
    return dessinPion(si);
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
          const raison = meilleur.raisons?.[0] ? ` — ${meilleur.raisons[0]}` : '';
          const ecart = joue && typeof joue.ecart === 'number' ? ` (écart ${formatEcart(joue.ecart)})` : '';
          annoncer(`L’IA aurait préféré ${descriptionCoup(meilleur.coup)}${raison}${ecart}.`, { duree: 7000 });
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
    feuilleConseil = ouvrirFeuille(
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

  function ouvrirJournal() {
    if (!vue) return;
    const lignes = (vue.historique || [])
      .slice()
      .reverse()
      .map((e) =>
        h(
          'li',
          { class: 'ligne-journal' },
          h('span', { class: 'puce-pion', style: { '--c': couleurSiege(e.siege) }, 'aria-hidden': 'true' }, NOMS_FORMES[PIONS[e.siege].forme]),
          h('span', {}, ligneJournal(e, vue.joueurs, vue.siege)),
        ),
      );
    feuilleJournal = ouvrirFeuille(
      [
        h('h3', {}, 'Journal des coups'),
        h('p', { class: 'note' }, `Donne ${vue.etat.donne + 1} · ${pluriel(vue.historique?.length || 0, 'coup joué', 'coups joués')}`),
        lignes.length ? h('ol', { class: 'journal' }, lignes) : h('p', { class: 'vide-etat' }, 'Aucun coup joué pour l’instant.'),
        h('button', { type: 'button', class: 'bouton large', onclick: () => feuilleJournal?.fermer() }, 'Fermer'),
      ],
      { surFermer: () => (feuilleJournal = null) },
    );
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
          h('div', { class: 'principal' }, h('div', { class: 'mot' }, nomSiege(si)), h('div', { class: 'note' }, `${rentres(si)}/4 pions rentrés`)),
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
          h('div', { class: 'principal' }, h('div', { class: 'mot' }, enumerer(equipe(e))), h('div', { class: 'note' }, e === siege % 2 ? 'Ton équipe' : 'Équipe adverse')),
          h('span', { class: 'pts' }, e === etat.gagnant ? 'Gagnant' : ''),
        ),
      );
    }
    feuilleFin = ouvrirFeuille(
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
    majMonTour(false);
  };
}

