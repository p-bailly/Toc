// Plateau de Toc en SVG : tapis vert dans un cadre bleu nuit (comme le plateau de l'appli Scrabble), circuit de
// 64 cases, allées d'arrivée, bases, étiquettes des joueurs, défausse au centre, pions animés.
// Le plateau n'applique aucune règle : il affiche ce qu'on lui donne et signale les touchers (pions, cibles).

import { s } from './dom.js';
import { BASE, NB_CASES, caseDepart } from '../moteur/plateau.js';
import { estProtege } from '../moteur/regles.js';
import {
  CELLULE,
  caseCircuit,
  caseAllee,
  emplacementBase,
  centreBase,
  coteDe,
  positionPion,
  versSvg,
  boiteEtiquette,
  chemin,
  positionFlecheSens,
} from './geometrie.js';
import { PIONS, couleurSiege } from './couleurs.js';
import { emojiIcone, EMOJI_IA } from './icones.js';
import { rangAffiche, symbole, estRouge, carteCourte } from './libelles.js';

const MARGE = 3;
const COTE = 17 * CELLULE;
/** Rayon d'un trou crème (case du circuit, de l'allée, emplacement de base) et d'un pion. */
const RAYON_TROU = 3.75;
const RAYON_PION = 3.35;

/**
 * Dessin d'un pion (sans position) : disque à la couleur du joueur, contour foncé (lisible même posé sur un fond
 * de sa couleur), reflet, et une petite forme claire propre à chaque couleur (lisible sans les couleurs).
 */
export function dessinPion(siege, { fantome = false } = {}) {
  const couleur = couleurSiege(siege);
  return s(
    'g',
    { class: 'dessin-pion' + (fantome ? ' fantome' : '') },
    s('ellipse', { class: 'ombre-pion', cx: 0, cy: 1.3, rx: RAYON_PION, ry: 1.6 }),
    s('circle', { class: 'corps-pion', r: RAYON_PION, fill: couleur }),
    s('circle', { class: 'reflet-pion', cx: -1.1, cy: -1.2, r: 0.85 }),
    forme(PIONS[siege].forme),
  );
}

function forme(nom) {
  const attrs = { class: 'forme-pion' };
  switch (nom) {
    case 'carre':
      return s('rect', { ...attrs, x: -1.05, y: -0.75, width: 2.1, height: 2.1, rx: 0.25 });
    case 'triangle':
      return s('path', { ...attrs, d: 'M0.2 -1.05 L1.6 1.45 L-1.2 1.45 Z' });
    case 'losange':
      return s('path', { ...attrs, d: 'M0.2 -1.3 L1.5 0.3 L0.2 1.9 L-1.1 0.3 Z' });
    default:
      return s('circle', { ...attrs, cx: 0.2, cy: 0.35, r: 1.05 });
  }
}

/** Petit bouclier blanc posé sur un pion protégé (sur sa case de sortie). */
function bouclier() {
  return s('path', { class: 'bouclier', d: 'M0 -2.1 l1.75 0.7 v1.3 c0 1.15 -0.75 1.85 -1.75 2.2 c-1 -0.35 -1.75 -1.05 -1.75 -2.2 v-1.3 z' });
}

const translate = (p) => {
  const { x, y } = versSvg(p);
  return `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px)`;
};

export class Plateau {
  /**
   * @param {Object} rappels
   * @param {(pion:number)=>void} rappels.surPion    toucher d'un pion proposé
   * @param {(i:number)=>void}    rappels.surCible   toucher de la i-ième cible proposée
   */
  constructor(rappels = {}) {
    this.rappels = rappels;
    this.siegeVue = null;
    this.svg = s('svg', {
      class: 'plateau-toc',
      viewBox: `${-MARGE} ${-MARGE} ${COTE + 2 * MARGE} ${COTE + 2 * MARGE}`,
      role: 'img',
      'aria-label': 'Plateau de jeu',
    });
    this.coucheFond = s('g', { class: 'fond' });
    this.coucheDernier = s('g', { class: 'couche-dernier' });
    this.coucheEtiquettes = s('g', { class: 'etiquettes' });
    this.coucheCentre = s('g', { class: 'centre' });
    this.couchePions = s('g', { class: 'pions' });
    this.coucheChoix = s('g', { class: 'couche-choix' });
    this.svg.append(this.coucheFond, this.coucheDernier, this.coucheEtiquettes, this.coucheCentre, this.couchePions, this.coucheChoix);
    this.pions = [];
    for (let g = 0; g < 16; g++) {
      const el = s('g', { class: 'pion', 'data-pion-dessin': g }, dessinPion(g >> 2), bouclier());
      this.pions.push(el);
      this.couchePions.append(el);
    }
    this.el = this.svg;
    this.svg.addEventListener('click', (e) => this.toucher(e));
    this.svg.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.toucher(e);
      }
    });
    this.animations = [];
  }

  toucher(e) {
    const cible = e.target.closest?.('[data-action]');
    if (!cible) return;
    const n = Number(cible.dataset.valeur);
    if (cible.dataset.action === 'pion') this.rappels.surPion?.(n);
    else if (cible.dataset.action === 'cible') this.rappels.surCible?.(n);
  }

  /**
   * Fond du plateau (dépend seulement du siège vu en bas), avec le code couleur d'un plateau en bois :
   * base = grand carré plein de la couleur du joueur (4 trous crème), juste derrière sa case de sortie ;
   * sortie = petit carré plein de sa couleur autour du trou ; allée = rectangle plein de sa couleur (4 trous) ;
   * entrée = case ordinaire du circuit (le rectangle de l'allée, juste derrière, montre où l'on rentre) ;
   * repères pour compter : bord foncé épais sur les 6e et 12e cases après chaque sortie.
   */
  dessinerFond(siegeVue) {
    const f = this.coucheFond;
    f.replaceChildren();
    f.append(
      s('rect', { class: 'cadre', x: -MARGE, y: -MARGE, width: COTE + 2 * MARGE, height: COTE + 2 * MARGE, rx: 3.5 }),
      s('rect', { class: 'tapis', x: 0, y: 0, width: COTE, height: COTE, rx: 2 }),
      s('rect', { class: 'filet', x: CELLULE * 1.05, y: CELLULE * 1.05, width: COTE - CELLULE * 2.1, height: COTE - CELLULE * 2.1, rx: 1.6 }),
    );
    const g = s('g', { class: 'cases' });
    for (let o = 0; o < 4; o++) {
      const cote = coteDe(o, siegeVue);
      // Base.
      const c = versSvg(centreBase(o, siegeVue));
      g.append(s('rect', { class: 'zone-base', x: c.x - 13.5, y: c.y - 13.5, width: 27, height: 27, rx: 3, fill: couleurSiege(o) }));
      for (let n = 0; n < 4; n++) {
        const b = versSvg(emplacementBase(o, n, siegeVue));
        g.append(s('circle', { class: 'trou trou-fonce', cx: b.x, cy: b.y, r: RAYON_TROU + 0.25 }));
      }
      // Allée : un rectangle de sa couleur qui englobe les 4 trous.
      const a0 = versSvg(caseAllee(o, 0, siegeVue));
      const a3 = versSvg(caseAllee(o, 3, siegeVue));
      const demi = 4.9;
      g.append(
        s('rect', {
          class: 'zone-allee',
          x: Math.min(a0.x, a3.x) - demi,
          y: Math.min(a0.y, a3.y) - demi,
          width: Math.abs(a3.x - a0.x) + 2 * demi,
          height: Math.abs(a3.y - a0.y) + 2 * demi,
          rx: 2.6,
          fill: couleurSiege(o),
        }),
      );
      for (let k = 0; k < 4; k++) {
        const p = versSvg(caseAllee(o, k, siegeVue));
        g.append(s('circle', { class: 'trou trou-fonce', cx: p.x, cy: p.y, r: RAYON_TROU - 0.35 }));
      }
      // Sortie : petit carré plein de sa couleur.
      const d = versSvg(caseCircuit(caseDepart(o), siegeVue));
      g.append(s('rect', { class: 'zone-sortie', x: d.x - 4.9, y: d.y - 4.9, width: 9.8, height: 9.8, rx: 2, fill: couleurSiege(o) }));
      // Flèche claire du sens de parcours, le long de son côté.
      const fl = versSvg(positionFlecheSens(cote));
      g.append(s('path', { class: 'fleche-sens', d: 'M2.2 0 H-2.2 M-0.7 -1.5 L-2.2 0 L-0.7 1.5', transform: `translate(${fl.x} ${fl.y}) rotate(${cote * 90})` }));
    }
    const departs = new Set([0, 1, 2, 3].map(caseDepart));
    for (let i = 0; i < NB_CASES; i++) {
      const p = versSvg(caseCircuit(i, siegeVue));
      const repere = i % 16 === 6 || i % 16 === 12;
      const depart = departs.has(i);
      g.append(
        s('circle', {
          class: 'trou' + (repere ? ' repere' : '') + (depart ? ' trou-fonce' : ''),
          cx: p.x,
          cy: p.y,
          r: depart ? RAYON_TROU - 0.35 : RAYON_TROU,
          'data-case': i,
        }),
      );
    }
    f.append(g);
  }

  /**
   * Redessine le plateau.
   * @param {Object} o
   * @param {number} o.siegeVue
   * @param {Object} o.etat            état public du moteur
   * @param {Object[]} o.joueurs       [{ pseudo, ia, icone }]
   * @param {number[]} [o.pions]       positions affichées (aperçu du 7 en cours de saisie) ; défaut etat.pions
   * @param {Object} [o.choix]         { candidats: Set<pion>, choisi, cibles: [{ pion, pos, libelle }], fantome: { pion, pos }, captures: number[] }
   * @param {string[]} [o.sousTitres]  texte sous chaque pseudo (par siège)
   */
  maj({ siegeVue, etat, joueurs, pions, choix = null, sousTitres = [], siegeLocal = siegeVue }) {
    if (this.siegeVue !== siegeVue) {
      this.siegeVue = siegeVue;
      this.dessinerFond(siegeVue);
    }
    this.etat = etat;
    const positions = pions || etat.pions;
    this.positions = positions;
    for (let g = 0; g < 16; g++) {
      const el = this.pions[g];
      el.style.transform = translate(positionPion(g, positions[g], siegeVue));
      el.classList.toggle('protege', estProtege({ pions: positions }, g));
      el.classList.toggle('en-base', positions[g] === BASE);
      el.classList.toggle('candidat', !!choix?.candidats?.has(g));
      el.classList.toggle('choisi', choix?.choisi === g);
      el.classList.toggle('capture-prevue', !!choix?.captures?.includes(g));
      el.setAttribute('aria-label', `Pion ${PIONS[g >> 2].nom}`);
    }
    this.dessinerDernier(etat, siegeVue, !!pions && pions !== etat.pions);
    this.dessinerEtiquettes(etat, joueurs, siegeVue, sousTitres, siegeLocal);
    this.dessinerCentre(etat, joueurs);
    this.dessinerChoix(choix, positions, siegeVue);
  }

  dessinerDernier(etat, siegeVue, masquer) {
    const c = this.coucheDernier;
    c.replaceChildren();
    const d = etat.dernierCoup;
    if (!d || masquer || !d.deplacements?.length) return;
    for (const dep of d.deplacements) {
      if (dep.capture) continue;
      for (const [pos, classe] of [
        [dep.de, 'dernier-depart'],
        [dep.vers, 'dernier-arrivee'],
      ]) {
        const p = positionPion(dep.pion, pos, siegeVue);
        const { x, y } = versSvg(p);
        if (pos === BASE) continue;
        c.append(s('rect', { class: classe, x: x - 4.6, y: y - 4.6, width: 9.2, height: 9.2, rx: 2 }));
      }
    }
  }

  dessinerEtiquettes(etat, joueurs, siegeVue, sousTitres, siegeLocal) {
    const c = this.coucheEtiquettes;
    c.replaceChildren();
    for (let siege = 0; siege < 4; siege++) {
      const cote = coteDe(siege, siegeVue);
      const b = boiteEtiquette(cote);
      const j = joueurs?.[siege] || {};
      const actif = etat.phase === 'jeu' && etat.tour === siege;
      const attend = etat.phase === 'echange' && !etat.echanges?.[siege];
      const emoji = j.ia ? EMOJI_IA : emojiIcone(j.icone);
      const nom = siege === siegeLocal ? 'Vous' : j.pseudo || `Joueur ${siege + 1}`;
      const g = s('g', {
        class: 'etiquette' + (actif ? ' actif' : '') + (attend ? ' attend' : ''),
        'data-siege': siege,
        'aria-label': `${nom}${actif ? ', à son tour' : ''}`,
      });
      g.append(
        s('rect', { class: 'boite', x: b.x, y: b.y, width: b.l, height: b.h, rx: 3 }),
        s('rect', { class: 'liseré', x: b.x, y: b.y, width: b.l, height: 2.4, rx: 1.2, fill: couleurSiege(siege) }),
      );
      const ax = b.x + 8.5;
      const ay = b.y + 11.5;
      g.append(s('circle', { class: 'avatar-plateau', cx: ax, cy: ay, r: 6, fill: couleurSiege(siege) }));
      g.append(
        s('text', { class: 'avatar-texte' + (emoji ? ' emoji' : ''), x: ax, y: ay + (emoji ? 2.3 : 2.1) }, emoji || (nom.slice(0, 1).toUpperCase() || '?')),
      );
      // Nombre de cartes : petit éventail de dos de cartes et le chiffre.
      const n = etat.cartesRestantes?.[siege] ?? 0;
      const cx = b.x + 18;
      for (let k = 0; k < Math.min(n, 3); k++) {
        g.append(s('rect', { class: 'dos-carte', x: cx + k * 2.2, y: b.y + 6.5 + k * 0.4, width: 5.2, height: 7.6, rx: 0.8 }));
      }
      g.append(s('text', { class: 'nb-cartes', x: b.x + b.l - 3, y: b.y + 14 }, String(n)));
      g.append(s('text', { class: 'pseudo-plateau', x: b.x + 3, y: b.y + 24.5 }, tronquer(nom, 11)));
      const sous = sousTitres[siege] || (actif ? 'joue…' : attend ? 'choisit sa carte' : '');
      if (sous) g.append(s('text', { class: 'sous-plateau', x: b.x + 3, y: b.y + 30.5 }, tronquer(sous, 15)));
      c.append(g);
    }
  }

  dessinerCentre(etat, joueurs) {
    const c = this.coucheCentre;
    c.replaceChildren();
    c.append(s('text', { class: 'texte-donne', x: 85, y: 64 }, `Donne ${etat.donne + 1}`));
    const carte = etat.pile?.[etat.pile.length - 1];
    if (!carte) {
      c.append(s('rect', { class: 'emplacement-carte', x: 74, y: 70, width: 22, height: 31, rx: 2.4 }));
      return;
    }
    const rouge = estRouge(carte);
    const g = s('g', { class: 'carte-plateau' + (rouge ? ' rouge' : ''), 'aria-label': `Dernière carte : ${carteCourte(carte)}` });
    g.append(
      s('rect', { class: 'fond-carte', x: 74, y: 70, width: 22, height: 31, rx: 2.4 }),
      s('text', { class: 'rang-carte', x: 76.5, y: 77.5 }, rangAffiche(carte)),
      s('text', { class: 'symbole-carte', x: 85, y: 92 }, symbole(carte)),
    );
    c.append(g);
    const d = etat.dernierCoup;
    if (d) {
      const qui = joueurs?.[d.siege]?.pseudo || '';
      const texte = d.coup?.t === 'defausse' ? `défaussée` : tronquer(qui, 12);
      c.append(s('text', { class: 'texte-donne petit', x: 85, y: 109 }, texte));
    }
  }

  dessinerChoix(choix, positions, siegeVue) {
    const c = this.coucheChoix;
    c.replaceChildren();
    if (!choix) return;
    if (choix.fantome) {
      const { pion, pos } = choix.fantome;
      const p = versSvg(positionPion(pion, pos, siegeVue));
      const g = s('g', { class: 'fantome-pion', transform: `translate(${p.x} ${p.y})` }, dessinPion(pion >> 2, { fantome: true }));
      c.append(g);
    }
    for (const g of choix.captures || []) {
      const p = versSvg(positionPion(g, positions[g], siegeVue));
      c.append(s('path', { class: 'croix-capture', d: `M${p.x - 3} ${p.y - 3} L${p.x + 3} ${p.y + 3} M${p.x + 3} ${p.y - 3} L${p.x - 3} ${p.y + 3}` }));
    }
    (choix.cibles || []).forEach((cible, i) => {
      const p = versSvg(positionPion(cible.pion, cible.pos, siegeVue));
      c.append(
        s('circle', { class: 'marque-cible' + (choix.cibleChoisie === i ? ' choisie' : ''), cx: p.x, cy: p.y, r: RAYON_TROU + 0.7 }),
        s('circle', {
          class: 'zone-touche',
          cx: p.x,
          cy: p.y,
          r: 7.5,
          role: 'button',
          tabindex: 0,
          'data-action': 'cible',
          'data-valeur': i,
          'aria-label': cible.libelle || 'Destination',
        }),
      );
    });
    for (const g of choix.candidats || []) {
      if ((choix.cibles || []).length && g !== choix.choisi && !choix.garderCandidats) continue;
      const p = versSvg(positionPion(g, positions[g], siegeVue));
      c.append(
        s('circle', {
          class: 'zone-touche',
          cx: p.x,
          cy: p.y,
          r: 7.5,
          role: 'button',
          tabindex: 0,
          'data-action': 'pion',
          'data-valeur': g,
          'aria-label': `Pion ${PIONS[g >> 2].nom}`,
        }),
      );
    }
  }

  /** Annule les animations en cours (le plateau montre directement la position finale). */
  arreterAnimations() {
    for (const a of this.animations) a.cancel();
    this.animations = [];
  }

  /**
   * Anime le dernier coup à partir de ses déplacements : chaque pion suit son chemin case par case,
   * les pions renvoyés à la base y retournent d'un trait. Les positions finales sont déjà posées par maj().
   */
  animer(dernierCoup, siegeVue) {
    this.arreterAnimations();
    if (!dernierCoup?.deplacements?.length) return;
    const t = dernierCoup.coup?.t;
    const sens = t === 'recul' ? 'arriere' : t === 'echange' || t === 'sortie' ? 'direct' : 'avant';
    const lignes = new Map(); // pion → [{ temps, pos }]
    let temps = 0;
    for (const d of dernierCoup.deplacements) {
      const etapes = d.capture ? [d.de, d.vers] : chemin(d.pion, d.de, d.vers, sens);
      const direct = etapes.length <= 2;
      const duree = direct ? 320 : Math.min(90 * (etapes.length - 1), 900);
      if (!lignes.has(d.pion)) lignes.set(d.pion, [{ temps: 0, pos: d.de }]);
      const l = lignes.get(d.pion);
      l.push({ temps, pos: d.de });
      etapes.forEach((pos, i) => i > 0 && l.push({ temps: temps + (duree * i) / (etapes.length - 1), pos }));
      // Une capture part avec le déplacement suivant (en même temps que le pion qui la provoque).
      if (!d.capture) temps += duree;
    }
    const total = Math.max(temps, 320);
    for (const [pion, l] of lignes) {
      const fin = l[l.length - 1];
      if (fin.temps < total) l.push({ temps: total, pos: fin.pos });
      const images = l.map(({ temps: tp, pos }) => ({ transform: translate(positionPion(pion, pos, siegeVue)), offset: Math.min(1, tp / total) }));
      try {
        this.animations.push(this.pions[pion].animate(images, { duration: total, easing: 'linear' }));
      } catch {
        /* animations indisponibles : position finale directement */
      }
    }
  }
}

function tronquer(texte, n) {
  return texte.length > n ? texte.slice(0, n - 1) + '…' : texte;
}

