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
} from '../moteur/index.js';
import { Plateau, dessinPion } from './plateau.js';
import { dessinCarte } from './carte.js';
import { ouvrirFeuille, toast } from './composants.js';
import { piRetour, piHistorique, piOk, piAnnuler, piConseil } from './pictos.js';
import * as IA from '../ia/ia.js';
import { trierMain, carteCourte, libelleChoix, ligneJournal, enumerer, nomCarte, decrireAction } from './libelles.js';
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
export function monterJeu(racine, { session, retour, libelleRetour = 'Retour', rejouer = null, conseils = false }) {
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
  const main = h('div', { class: 'chevalet main-joueur', role: 'group', 'aria-label': 'Vos cartes' });
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

  const reinitialiser = () => {
    carte = null;
    pion = null;
    coupPret = null;
    sept = null;
  };

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
    const p = vue.joueurs[partenaire(vue.siege)]?.pseudo || 'Votre partenaire';
    toast(`${p} vous a donné : ${nomCarte(vue.recu)}`);
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
    return si === vue.siege ? 'Vous' : vue.joueurs[si]?.pseudo || `Joueur ${si + 1}`;
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
      coupPret = { t: 'defausse', carte: c };
      rendre();
      return;
    }
    const coups = coupsLegaux(etat, vue.siege, c);
    if (!coups.length) {
      carte = null;
      toast(`Le ${carteCourte(c)} n’est pas jouable maintenant.`);
      rendre();
      return;
    }
    if (rang(c) === '7') {
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
      coupPret = { t: 'sept', carte, etapes: sept.etapes.slice() };
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
        const opts = coupsLegaux(vue.etat, vue.siege, carte).filter((k) => k.pion === g);
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
    if (!lireReglages().confirmerCoup && coup.t !== 'defausse') {
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
      toast(messageErreur(e), { erreur: true });
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
      toast(messageErreur(e), { erreur: true });
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
    zonePlateau.classList.toggle('a-moi', aMoi());

    // Main.
    const recue = jeu && vue.recu && vue.main.includes(vue.recu) ? vue.recu : null;
    const cartes = trierMain(vue.main).map((c) => {
      const injouable = monTour && jouable && !(coups.get(c) || []).length;
      const inactive = (!monTour && !(etat.phase === 'echange' && !vue.don)) || envoi;
      return dessinCarte(c, {
        bouton: true,
        choisie: carte === c,
        injouable,
        inactive,
        marque: c === recue ? 'reçue' : c === vue.don ? 'donnée' : null,
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
    for (let si = 0; si < 4; si++) {
      if (aFini(etat, si)) t[si] = 'a fini ✓';
      else if (etat.phase === 'echange') t[si] = etat.echanges[si] ? 'a donné ✓' : 'choisit…';
      else if (etat.phase === 'jeu' && etat.tour === si) t[si] = si === vue.siege ? 'à vous !' : 'joue…';
    }
    return t;
  }

  function calculerChoix(monTour) {
    ciblesCourantes = [];
    if (!monTour || !carte) return null;
    const { etat, siege, joueurs } = vue;
    if (coupPret?.t === 'defausse') return null;
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
    const coups = coupsLegaux(etat, siege, carte);
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
    let t = o.allee ? (depuisAllee ? `Avancer de ${o.pas} dans l’allée` : `Entrer dans l’allée (${o.pas})`) : `Avancer de ${o.pas}`;
    if (o.captures.length) t += ` · renvoie ${pluriel(o.captures.length, 'pion')}`;
    return t;
  }

  function puceCouleur(si) {
    return h('span', { class: 'puce-pion', style: { '--c': couleurSiege(si) }, 'aria-hidden': 'true' }, NOMS_FORMES[PIONS[si].forme]);
  }

  function rendreConsigne(monTour, jouable, actifCouleur) {
    const { etat, siege, joueurs } = vue;
    const p = partenaire(siege);
    const nomP = joueurs[p]?.pseudo || 'votre partenaire';
    const lignes = [];
    const boutons = [];

    if (etat.phase === 'fini') {
      const gagne = etat.gagnant === siege % 2;
      lignes.push(h('b', {}, gagne ? 'Victoire de votre équipe !' : 'Victoire de l’équipe adverse.'));
      boutons.push(h('button', { type: 'button', class: 'bouton principal large', onclick: montrerFin }, 'Voir le résultat'));
    } else if (etat.phase === 'echange') {
      if (!vue.don) {
        lignes.push(h('span', {}, h('b', {}, 'Échange : '), `choisissez une carte à donner à ${nomP}.`));
        boutons.push(
          h(
            'button',
            { type: 'button', class: 'bouton principal large', disabled: !carte || envoi, onclick: donner, 'data-action': 'donner' },
            carte ? `Donner le ${carteCourte(carte)} à ${nomP}` : 'Choisissez une carte',
          ),
        );
      } else {
        const attendus = [0, 1, 2, 3].filter((si) => !etat.echanges[si]).map(nomSiege);
        lignes.push(h('span', {}, `Vous avez donné le ${carteCourte(vue.don)} à ${nomP}. `, attendus.length ? `En attente de ${enumerer(attendus)}.` : ''));
      }
    } else if (!monTour) {
      lignes.push(h('span', {}, 'En attente de ', h('b', {}, nomSiege(etat.tour)), '…'));
    } else if (!jouable) {
      lignes.push(h('b', { class: 'ecart-neg' }, 'Aucune carte jouable : défaussez une carte.'));
      boutons.push(
        h(
          'button',
          { type: 'button', class: 'bouton principal large', disabled: !coupPret || envoi, onclick: envoyer, 'data-action': 'jouer' },
          coupPret ? `Défausser le ${carteCourte(coupPret.carte)}` : 'Touchez la carte à défausser',
        ),
      );
    } else if (sept) {
      const r = etatSept();
      const reste = r ? r.reste : 0;
      const actif = sept.etapes.length ? `${sept.etapes.map((e) => e.pas).join(' + ')} · ` : '';
      lignes.push(h('span', {}, h('b', {}, `7 : reste ${pluriel(reste, 'point')}`), ` ${actif ? '(' + actif.slice(0, -3) + ')' : ''}`));
      if (sept.captures.length) lignes.push(h('span', { class: 'note ecart-neg' }, `Renvoyés à la base : ${decrireCaptures(sept.captures)}`));
      const options = r ? r.options : [];
      if (options.some((o) => o.pion >> 2 !== siege)) lignes.push(h('span', { class: 'note' }, `Le reste va aux pions de ${nomP}.`));
      if (!coupPret) {
        if (pion === null) lignes.push(h('span', { class: 'note' }, 'Touchez un pion à avancer.'));
        else
          for (const [i, c] of ciblesCourantes.entries()) {
            boutons.push(h('button', { type: 'button', class: 'bouton', onclick: () => toucherCible(i), 'data-choix': i }, c.libelle));
          }
      }
      if (sept.etapes.length) {
        boutons.push(h('button', { type: 'button', class: 'bouton', onclick: annulerEtape, 'data-action': 'annuler-etape' }, piAnnuler(), 'Étape'));
      }
      boutons.push(h('button', { type: 'button', class: 'bouton discret', onclick: () => (reinitialiser(), rendre()), 'data-action': 'annuler' }, 'Tout annuler'));
      if (coupPret) boutons.push(h('button', { type: 'button', class: 'bouton principal large', disabled: envoi, onclick: envoyer, 'data-action': 'jouer' }, piOk(), 'Valider le 7'));
    } else if (!carte) {
      lignes.push(h('b', {}, 'À vous de jouer : '), h('span', {}, 'touchez une carte.'));
    } else if (coupPret) {
      lignes.push(
        h(
          'span',
          {},
          h('b', {}, `${carteCourte(carte)} : `),
          coupPret.t === 'sept' ? decrireAction(coupPret, siege, joueurs) : libelleChoix(coupPret, siege, joueurs, { depuisAllee: vue.etat.pions[coupPret.pion] >= ALLEE }),
        ),
      );
      const d = destination(coupPret);
      if (d.captures.length) lignes.push(h('span', { class: 'note ecart-neg' }, `Renvoie à la base : ${decrireCaptures(d.captures)}`));
      boutons.push(h('button', { type: 'button', class: 'bouton', onclick: () => ((coupPret = null), rendre()), 'data-action': 'annuler' }, 'Annuler'));
      boutons.push(h('button', { type: 'button', class: 'bouton principal large', disabled: envoi, onclick: envoyer, 'data-action': 'jouer' }, piOk(), 'Jouer'));
    } else {
      const coups = coupsLegaux(etat, siege, carte);
      if (rang(carte) === 'V') {
        lignes.push(h('span', {}, h('b', {}, 'Valet : '), pion === null ? 'touchez un de vos pions, puis le pion à échanger.' : 'touchez le pion à échanger.'));
      } else {
        lignes.push(h('span', {}, h('b', {}, `${carteCourte(carte)} : `), pion === null ? 'touchez un pion.' : 'choisissez la destination.'));
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
      lignes.push(h('span', { class: 'note joue-pour' }, puceCouleur(actifCouleur), ` Vos pions sont rentrés : vous jouez les pions ${nomCouleur(actifCouleur)}s de ${nomP}.`));
    }
    remplacer(consigne, h('div', { class: 'mots' }, lignes));
    remplacer(actions, boutons);
    actions.hidden = !boutons.length;
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
    return [...par].map(([o, n]) => `${pluriel(n, 'pion')} ${o === vue.siege ? 'à vous' : 'de ' + nomSiege(o)}`).join(', ');
  }

  function rendreStatut(actifCouleur) {
    const { etat, siege } = vue;
    const rentres = (si) => etat.pions.slice(si * 4, si * 4 + 4).filter((p) => p >= ALLEE).length;
    const nous = rentres(siege) + rentres(partenaire(siege));
    const eux = rentres((siege + 1) % 4) + rentres((siege + 3) % 4);
    const p = partenaire(siege);
    remplacer(
      statut,
      h(
        'div',
        { class: 'pastille-couleur', title: 'Vos pions' },
        s('svg', { viewBox: '-5 -5 10 10', width: 30, height: 30, 'aria-hidden': 'true' }, dessinPionMini(actifCouleur)),
      ),
      h(
        'div',
        { class: 'milieu' },
        h('div', { class: 'texte' }, h('b', {}, `Vous et ${vue.joueurs[p]?.pseudo || 'partenaire'}`), ` · ${nous}/8 rentrés`),
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
    if (coup.t === 'defausse') return `Défausser le ${carteCourte(coup.carte)}`;
    const texte = decrireAction(coup, vue.siege, vue.joueurs);
    return `${carteCourte(coup.carte)} : ${texte}`;
  }

  const formatEcart = (x) => (typeof x === 'number' ? x.toLocaleString('fr-FR', { maximumFractionDigits: 1 }) : '');

  /** Après un coup du joueur : l'IA aurait-elle joué pareil ? (réglage « Commenter mes coups »). */
  function commenter(avant, coup) {
    if (!conseilsDispo || vue?.enLigne || !lireReglages().commenterCoups || avant.etat.phase !== 'jeu') return;
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
          toast('Bien joué : c’est aussi le choix de l’IA.', { duree: 3500 });
        } else {
          const raison = meilleur.raisons?.[0] ? ` — ${meilleur.raisons[0]}` : '';
          const ecart = joue && typeof joue.ecart === 'number' ? ` (écart ${formatEcart(joue.ecart)})` : '';
          toast(`L’IA aurait préféré ${descriptionCoup(meilleur.coup)}${raison}${ecart}.`, { duree: 7000 });
        }
      } catch (e) {
        console.warn('Commentaire du coup impossible', e);
      }
    }, 60);
  }

  function ouvrirConseil() {
    if (!conseilsDispo || !vue || !aMoi() || vue.enLigne) return;
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
          const titre = echange ? `Donner le ${carteCourte(a.carte)}` : descriptionCoup(a.coup);
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
          h('span', {}, ligneJournal(e, vue.joueurs)),
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
    const gagne = etat.gagnant === siege % 2;
    const equipe = (e) => [e, e + 2].map((si) => nomSiege(si));
    const boutons = [];
    if (rejouer) boutons.push(h('button', { type: 'button', class: 'bouton principal large', onclick: () => (feuilleFin?.fermer(), rejouer()) }, 'Rejouer'));
    boutons.push(
      h('a', { class: 'bouton large' + (rejouer ? '' : ' principal'), href: retour, onclick: () => feuilleFin?.fermer() }, vue.enLigne ? 'Mes parties' : 'Retour'),
    );
    feuilleFin = ouvrirFeuille(
      [
        h('div', { class: 'fin-titre' + (gagne ? ' gagne' : '') }, h('span', { class: 'fin-embleme', 'aria-hidden': 'true' }, gagne ? '🏆' : '🎲'), h('h3', {}, gagne ? 'Victoire !' : 'Défaite')),
        h(
          'p',
          {},
          `L’équipe de `,
          h('b', {}, enumerer(equipe(etat.gagnant))),
          ` a rentré ses 8 pions.`,
        ),
        h(
          'div',
          { class: 'liste' },
          [0, 1].map((e) =>
            h(
              'div',
              { class: 'ligne' + (e === etat.gagnant ? ' choisie' : '') },
              h('div', { class: 'principal' }, h('div', { class: 'mot' }, enumerer(equipe(e))), h('div', { class: 'note' }, e === siege % 2 ? 'Votre équipe' : 'Équipe adverse')),
              h('span', { class: 'pts' }, e === etat.gagnant ? 'Gagnant' : ''),
            ),
          ),
        ),
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
    majMonTour(false);
  };
}

