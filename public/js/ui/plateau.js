// Plateau de Toc en SVG : tapis vert dans un cadre bleu nuit (comme le plateau de l'appli Scrabble), circuit de
// 64 cases, allées d'arrivée, bases, étiquettes des joueurs, défausse au centre, pions animés.
// Le plateau n'applique aucune règle : il affiche ce qu'on lui donne et signale les touchers (pions, cibles).

import { s } from './dom.js';
import { BASE, caseDepart } from '../moteur/plateau.js';
import { estProtege } from '../moteur/regles.js';
import { CELLULE, geometrie, chemin, TRIANGLE } from './geometrie.js';
import { PIONS, couleurSiege } from './couleurs.js';
import { emojiIcone, EMOJI_IA } from './icones.js';
import { rangAffiche, symbole, estRouge, carteCourte } from './libelles.js';
import { estJoker } from '../moteur/cartes.js';
import { nomNiveau } from './niveaux.js';
import { estHabille, contenuFigure, CADRE_FIGURE } from './figures.js';

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

const translate = ({ x, y }) => `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px)`;

/** Rectangle centré en (x, y), tourné de `angle` degrés autour de son centre. */
function rectTourne(classe, { x, y }, l, h, angle, attrs = {}) {
  return s('rect', { class: classe, x: x - l / 2, y: y - h / 2, width: l, height: h, transform: angle ? `rotate(${angle.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)})` : null, ...attrs });
}

export class Plateau {
  /**
   * @param {Object} rappels
   * @param {(pion:number)=>void} rappels.surPion    toucher d'un pion proposé
   * @param {(i:number)=>void}    rappels.surCible   toucher de la i-ième cible proposée
   */
  constructor(rappels = {}) {
    this.rappels = rappels;
    this.siegeVue = null;
    this.geo = null;
    this.svg = s('svg', { class: 'plateau-toc', role: 'img', 'aria-label': 'Plateau de jeu' });
    this.coucheFond = s('g', { class: 'fond' });
    this.coucheDernier = s('g', { class: 'couche-dernier' });
    this.coucheEtiquettes = s('g', { class: 'etiquettes' });
    this.coucheCentre = s('g', { class: 'centre' });
    this.couchePions = s('g', { class: 'pions' });
    this.coucheChoix = s('g', { class: 'couche-choix' });
    this.svg.append(this.coucheFond, this.coucheDernier, this.coucheEtiquettes, this.coucheCentre, this.couchePions, this.coucheChoix);
    this.pions = [];
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

  /** Change de forme (carré à 4, triangle à 3) : cadre, nombre de pions. */
  preparer(nbJoueurs, siegeVue) {
    const geo = geometrie(nbJoueurs);
    if (this.geo === geo && this.siegeVue === siegeVue) return;
    const changeForme = this.geo !== geo;
    this.geo = geo;
    this.siegeVue = siegeVue;
    if (changeForme) {
      const c = geo.cadre;
      this.svg.setAttribute('viewBox', `${c.x} ${c.y} ${c.l} ${c.h}`);
      this.svg.classList.toggle('triangle', geo.forme === 'triangle');
      this.couchePions.replaceChildren();
      this.pions = [];
      for (let g = 0; g < 4 * nbJoueurs; g++) {
        const el = s('g', { class: 'pion', 'data-pion-dessin': g }, dessinPion(g >> 2), bouclier());
        this.pions.push(el);
        this.couchePions.append(el);
      }
    }
    this.dessinerFond(siegeVue);
  }

  /**
   * Fond du plateau (dépend seulement du siège vu en bas), avec le code couleur d'un plateau en bois :
   * base = grand carré plein de la couleur du joueur (4 trous crème), juste derrière sa case de sortie
   * (à 3 joueurs : à l'extérieur du circuit, accolée à la sortie) ; sortie = petit carré plein de sa couleur ;
   * allée = rectangle plein de sa couleur (4 trous) ; entrée = case ordinaire du circuit ;
   * repères pour compter : bord foncé épais sur les 6e et 12e cases après chaque sortie.
   */
  dessinerFond(siegeVue) {
    const geo = this.geo;
    const n = geo.nbJoueurs;
    const f = this.coucheFond;
    f.replaceChildren();
    if (geo.forme === 'triangle') {
      const { A, B, C } = TRIANGLE;
      const points = [A, B, C].map((p) => `${p.x},${p.y}`).join(' ');
      f.append(
        s('polygon', { class: 'cadre cadre-triangle', points }),
        s('polygon', { class: 'tapis tapis-triangle', points }),
      );
      // Filet intérieur : le triangle réduit vers le centre.
      const G = TRIANGLE.G;
      const r = (p) => ({ x: G.x + (p.x - G.x) * 0.8, y: G.y + (p.y - G.y) * 0.8 });
      f.append(s('polygon', { class: 'filet', points: [A, B, C].map(r).map((p) => `${p.x},${p.y}`).join(' ') }));
    } else {
      f.append(
        s('rect', { class: 'cadre', x: -3, y: -3, width: COTE + 6, height: COTE + 6, rx: 3.5 }),
        s('rect', { class: 'tapis', x: 0, y: 0, width: COTE, height: COTE, rx: 2 }),
        s('rect', { class: 'filet', x: CELLULE * 1.05, y: CELLULE * 1.05, width: COTE - CELLULE * 2.1, height: COTE - CELLULE * 2.1, rx: 1.6 }),
      );
    }
    const g = s('g', { class: 'cases' });
    for (let o = 0; o < n; o++) {
      const cote = geo.coteDe(o, siegeVue);
      const angle = geo.angleCote(cote);
      // Base.
      g.append(rectTourne('zone-base', geo.centreBase(o, siegeVue), geo.TAILLE_BASE, geo.TAILLE_BASE, angle, { rx: 3, fill: couleurSiege(o) }));
      for (let k = 0; k < 4; k++) {
        const b = geo.emplacementBase(o, k, siegeVue);
        g.append(s('circle', { class: 'trou trou-fonce', cx: b.x, cy: b.y, r: RAYON_TROU + 0.25 }));
      }
      // Allée : un rectangle de sa couleur qui englobe les 4 trous.
      const a0 = geo.caseAllee(o, 0, siegeVue);
      const a3 = geo.caseAllee(o, 3, siegeVue);
      const milieu = { x: (a0.x + a3.x) / 2, y: (a0.y + a3.y) / 2 };
      g.append(rectTourne('zone-allee', milieu, 9.8, 3 * CELLULE + 9.8, angle, { rx: 2.6, fill: couleurSiege(o) }));
      for (let k = 0; k < 4; k++) {
        const p = geo.caseAllee(o, k, siegeVue);
        g.append(s('circle', { class: 'trou trou-fonce', cx: p.x, cy: p.y, r: RAYON_TROU - 0.35 }));
      }
      // Sortie : petit carré plein de sa couleur.
      g.append(rectTourne('zone-sortie', geo.caseCircuit(caseDepart(o), siegeVue), 9.8, 9.8, angle, { rx: 2, fill: couleurSiege(o) }));
      // Flèche claire du sens de parcours, le long de son côté.
      const fl = geo.flecheSens(cote);
      g.append(s('path', { class: 'fleche-sens', d: 'M-2.2 0 H2.2 M0.7 -1.5 L2.2 0 L0.7 1.5', transform: `translate(${fl.x.toFixed(2)} ${fl.y.toFixed(2)}) rotate(${fl.angle.toFixed(1)})` }));
    }
    const departs = new Set(Array.from({ length: n }, (_, o) => caseDepart(o)));
    for (let i = 0; i < geo.nbCases; i++) {
      const p = geo.caseCircuit(i, siegeVue);
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
    const n = etat.pions.length >> 2;
    this.preparer(n, siegeVue);
    this.etat = etat;
    const positions = pions || etat.pions;
    this.positions = positions;
    for (let g = 0; g < this.pions.length; g++) {
      const el = this.pions[g];
      el.style.transform = translate(this.geo.positionPion(g, positions[g], siegeVue));
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
        if (pos === BASE) continue;
        const { x, y } = this.geo.positionPion(dep.pion, pos, siegeVue);
        c.append(s('circle', { class: classe, cx: x, cy: y, r: 4.9 }));
      }
    }
  }

  dessinerEtiquettes(etat, joueurs, siegeVue, sousTitres, siegeLocal) {
    const c = this.coucheEtiquettes;
    c.replaceChildren();
    const n = this.geo.nbJoueurs;
    for (let siege = 0; siege < n; siege++) {
      const cote = this.geo.coteDe(siege, siegeVue);
      const b = this.geo.boiteEtiquette(cote);
      const j = joueurs?.[siege] || {};
      const actif = etat.phase === 'jeu' && etat.tour === siege;
      const attend = etat.phase === 'echange' && !etat.echanges?.[siege];
      const emoji = j.ia ? EMOJI_IA : emojiIcone(j.icone);
      const nom = siege === siegeLocal ? 'Toi' : j.pseudo || `Joueur ${siege + 1}`;
      const g = s('g', {
        class: 'etiquette' + (actif ? ' actif' : '') + (attend ? ' attend' : ''),
        'data-siege': siege,
        'data-niveau': j.ia ? nomNiveau(j.niveau) : null,
        'aria-label': `${nom}${j.ia ? ', IA ' + nomNiveau(j.niveau) : ''}${actif ? ', à son tour' : ''}`,
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
      const nb = etat.cartesRestantes?.[siege] ?? 0;
      const cx = b.x + 18;
      for (let k = 0; k < Math.min(nb, 3); k++) {
        g.append(s('rect', { class: 'dos-carte', x: cx + k * 2.2, y: b.y + 6.5 + k * 0.4, width: 5.2, height: 7.6, rx: 0.8 }));
      }
      g.append(s('text', { class: 'nb-cartes', x: b.x + b.l - 3, y: b.y + 14 }, String(nb)));
      g.append(s('text', { class: 'pseudo-plateau', x: b.x + 3, y: b.y + 24.5 }, tronquer(nom, 11)));
      // Sous le pseudo : l'état du joueur (joue…, a donné ✓…), sinon le niveau d'une IA.
      const sous = sousTitres[siege] || (actif ? 'joue…' : attend ? 'choisit sa carte' : '') || (j.ia ? nomNiveau(j.niveau) : '');
      if (sous) g.append(s('text', { class: 'sous-plateau', x: b.x + 3, y: b.y + 30.5 }, tronquer(sous, 15)));
      c.append(g);
    }
  }

  dessinerCentre(etat, joueurs) {
    const c = this.coucheCentre;
    c.replaceChildren();
    const { x: cx, y: cy } = this.geo.centre;
    const triangle = this.geo.forme === 'triangle';
    // Dans le triangle, la donne est écrite sous la carte (au-dessus, il n'y a pas la place).
    const yDonne = triangle ? cy + 23 : cy - 21;
    const yQui = triangle ? cy + 28.5 : cy + 24;
    c.append(s('text', { class: 'texte-donne', x: cx, y: yDonne }, `Donne ${etat.donne + 1}`));
    const carte = etat.pile?.[etat.pile.length - 1];
    const x0 = cx - 11;
    const y0 = cy - 15.5 - (triangle ? 2 : 0);
    if (!carte) {
      c.append(s('rect', { class: 'emplacement-carte', x: x0, y: y0, width: 22, height: 31, rx: 2.4 }));
      return;
    }
    const joker = estJoker(carte);
    const rouge = !joker && estRouge(carte);
    const g = s('g', { class: 'carte-plateau' + (rouge ? ' rouge' : '') + (joker ? ' joker' : ''), 'aria-label': `Dernière carte : ${carteCourte(carte)}` });
    g.append(s('rect', { class: 'fond-carte', x: x0, y: y0, width: 22, height: 31, rx: 2.4 }));
    if (joker) {
      g.append(s('text', { class: 'rang-carte joker', x: cx, y: y0 + 7 }, 'JOKER'), s('text', { class: 'symbole-carte', x: cx, y: y0 + 22 }, '★'));
      const copie = etat.jokers?.[carte];
      if (copie) g.append(s('text', { class: 'copie-joker', x: cx, y: y0 + 28.5 }, `= ${copie === 'V' ? 'Valet' : copie === 'D' ? 'Dame' : copie === 'R' ? 'Roi' : copie === 'A' ? 'As' : copie}`));
    } else if (estHabille(rangAffiche(carte))) {
      // Habillé : rang et couleur en coin, personnage à droite.
      const figure = s('svg', { class: 'figure-carte', x: x0 + 8.4, y: y0 + 3.6, width: 11.6, height: 23.8, viewBox: CADRE_FIGURE });
      figure.innerHTML = contenuFigure(rangAffiche(carte));
      g.append(
        s('text', { class: 'rang-carte', x: x0 + 2.2, y: y0 + 7.5 }, rangAffiche(carte)),
        s('text', { class: 'symbole-carte coin', x: x0 + 4.4, y: y0 + 13.4 }, symbole(carte)),
        figure,
      );
    } else {
      g.append(s('text', { class: 'rang-carte', x: x0 + 2.5, y: y0 + 7.5 }, rangAffiche(carte)), s('text', { class: 'symbole-carte', x: cx, y: y0 + 22 }, symbole(carte)));
    }
    c.append(g);
    const d = etat.dernierCoup;
    if (d && !triangle) {
      const qui = joueurs?.[d.siege]?.pseudo || '';
      const texte = d.coup?.t === 'defausse' ? `défaussée` : tronquer(qui, 12);
      c.append(s('text', { class: 'texte-donne petit', x: cx, y: yQui }, texte));
    }
  }

  dessinerChoix(choix, positions, siegeVue) {
    const c = this.coucheChoix;
    c.replaceChildren();
    if (!choix) return;
    const pos = (g, p) => this.geo.positionPion(g, p, siegeVue);
    if (choix.fantome) {
      const p = pos(choix.fantome.pion, choix.fantome.pos);
      c.append(s('g', { class: 'fantome-pion', transform: `translate(${p.x} ${p.y})` }, dessinPion(choix.fantome.pion >> 2, { fantome: true })));
    }
    for (const g of choix.captures || []) {
      const p = pos(g, positions[g]);
      c.append(s('path', { class: 'croix-capture', d: `M${p.x - 3} ${p.y - 3} L${p.x + 3} ${p.y + 3} M${p.x + 3} ${p.y - 3} L${p.x - 3} ${p.y + 3}` }));
    }
    (choix.cibles || []).forEach((cible, i) => {
      const p = pos(cible.pion, cible.pos);
      c.append(
        s('circle', { class: 'marque-cible' + (choix.cibleChoisie === i ? ' choisie' : ''), cx: p.x, cy: p.y, r: RAYON_TROU + 0.7 }),
        s('circle', { class: 'zone-touche', cx: p.x, cy: p.y, r: 7.5, role: 'button', tabindex: 0, 'data-action': 'cible', 'data-valeur': i, 'aria-label': cible.libelle || 'Destination' }),
      );
    });
    for (const g of choix.candidats || []) {
      if ((choix.cibles || []).length && g !== choix.choisi && !choix.garderCandidats) continue;
      const p = pos(g, positions[g]);
      c.append(s('circle', { class: 'zone-touche', cx: p.x, cy: p.y, r: 7.5, role: 'button', tabindex: 0, 'data-action': 'pion', 'data-valeur': g, 'aria-label': `Pion ${PIONS[g >> 2].nom}` }));
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
    if (!dernierCoup?.deplacements?.length || !this.geo) return;
    const t = dernierCoup.coup?.t;
    const sens = t === 'recul' ? 'arriere' : t === 'echange' || t === 'sortie' ? 'direct' : 'avant';
    const lignes = new Map(); // pion → [{ temps, pos }]
    let temps = 0;
    for (const d of dernierCoup.deplacements) {
      const etapes = d.capture ? [d.de, d.vers] : chemin(d.pion, d.de, d.vers, sens, this.geo.nbJoueurs);
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
      if (!this.pions[pion]) continue;
      const fin = l[l.length - 1];
      if (fin.temps < total) l.push({ temps: total, pos: fin.pos });
      const images = l.map(({ temps: tp, pos }) => ({ transform: translate(this.geo.positionPion(pion, pos, siegeVue)), offset: Math.min(1, tp / total) }));
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
