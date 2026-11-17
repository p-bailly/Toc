// Plateau de Toc en SVG, habillage « Bois verni » : bois clair verni (dégradé et veinage), cadre brun, cases
// percées dans le bois, blocs de couleur peints (base, sortie, allée), anneaux clairs incrustés pour les repères de
// comptage, pions en billes. Noms des joueurs autour du plateau carré (dans les coins libres pour le triangle),
// défausse au centre, pions animés.
// Le plateau n'applique aucune règle : il affiche ce qu'on lui donne et signale les touchers (pions, cibles).

import { s } from './dom.js';
import { BASE, viser, viserPlateau } from '../moteur/plateau.js';
import { CELLULE, geometrie, chemin } from './geometrie.js';
import { PIONS, couleurSiege, couleurFonceeSiege } from './couleurs.js';
import { emojiIcone, EMOJI_IA } from './icones.js';
import { rangAffiche, symbole, estRouge, carteCourte } from './libelles.js';
import { estJoker } from '../moteur/cartes.js';
import { nomNiveau, niveauEnLettres } from './niveaux.js';
import { estHabille, contenuFigure, CADRE_FIGURE } from './figures.js';

/** Rayon d'un trou percé (case du circuit, de l'allée, emplacement de base) et d'une bille. */
const RAYON_TROU = 3.4;
const RAYON_PION = 3.15;

/**
 * Dessin d'un pion (sans position) : une bille brillante à la couleur du joueur, au contour plus sombre (lisible
 * même posée sur un bloc de sa couleur), avec son reflet et une petite ombre portée.
 */
export function dessinPion(siege, { fantome = false } = {}) {
  return s(
    'g',
    { class: 'dessin-pion' + (fantome ? ' fantome' : '') },
    s('circle', { class: 'ombre-pion', cx: 0, cy: 0.65, r: RAYON_PION }),
    s('circle', { class: 'corps-pion', r: RAYON_PION, fill: couleurSiege(siege), stroke: couleurFonceeSiege(siege) }),
    s('circle', { class: 'reflet-pion', cx: -1, cy: -1.12, r: 1.05 }),
  );
}

// ─── Veinage du bois ────────────────────────────────────────────────────────
// Le veinage (bruit de Perlin étiré) est calculé UNE fois, rendu dans une image partagée par tous les plateaux,
// puis posé en motif : aucun filtre SVG n'est recalculé pendant les animations des billes.

const ZONE_VEINAGE = { x: -12, y: -12, l: 196, h: 196 };
let promesseVeinage = null;

function veinage() {
  if (promesseVeinage) return promesseVeinage;
  promesseVeinage = new Promise((resoudre) => {
    try {
      // Même procédé que la maquette validée, à son échelle (40 unités par case, ici 10) : 4 pixels par unité.
      const L = ZONE_VEINAGE.l * 4;
      const H = ZONE_VEINAGE.h * 4;
      const source =
        `<svg xmlns="http://www.w3.org/2000/svg" width="${L}" height="${H}" viewBox="0 0 ${L} ${H}">` +
        '<filter id="b" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.009 0.32" numOctaves="3" seed="7"/>' +
        '<feColorMatrix type="matrix" values="0 0 0 0 0.38  0 0 0 0 0.2  0 0 0 0 0.06  0 0 0 0.9 -0.18"/><feComposite operator="in" in2="SourceGraphic"/></filter>' +
        `<rect width="${L}" height="${H}" fill="#000" filter="url(#b)"/></svg>`;
      const image = new Image();
      image.onload = () => {
        try {
          const toile = document.createElement('canvas');
          toile.width = L;
          toile.height = H;
          toile.getContext('2d').drawImage(image, 0, 0);
          resoudre(toile.toDataURL('image/png'));
        } catch {
          resoudre(null);
        }
      };
      image.onerror = () => resoudre(null);
      image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(source);
    } catch {
      resoudre(null);
    }
  });
  return promesseVeinage;
}

let compteurPlateaux = 0;

/** Nombre de cartes du tas dessinées au centre (les plus récentes). */
const CARTES_VISIBLES = 8;

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
    // Dégradés et motif propres à ce plateau (identifiants uniques).
    const id = 'plt' + ++compteurPlateaux;
    this.idBois = id + '-bois';
    this.idTrou = id + '-trou';
    this.idVeinage = id + '-veinage';
    const imageVeinage = s('image', { x: ZONE_VEINAGE.x, y: ZONE_VEINAGE.y, width: ZONE_VEINAGE.l, height: ZONE_VEINAGE.h, preserveAspectRatio: 'none' });
    this.svg.append(
      s(
        'defs',
        {},
        s('radialGradient', { id: this.idBois, cx: '50%', cy: '42%', r: '70%' }, s('stop', { offset: 0, class: 'stop-bois' }), s('stop', { offset: 1, class: 'stop-bois-2' })),
        s('radialGradient', { id: this.idTrou, cx: '50%', cy: '35%', r: '65%' }, s('stop', { offset: 0, class: 'stop-trou-centre' }), s('stop', { offset: 1, class: 'stop-trou' })),
        s('pattern', { id: this.idVeinage, patternUnits: 'userSpaceOnUse', x: ZONE_VEINAGE.x, y: ZONE_VEINAGE.y, width: ZONE_VEINAGE.l, height: ZONE_VEINAGE.h }, imageVeinage),
      ),
    );
    veinage().then((url) => {
      if (url) imageVeinage.setAttribute('href', url);
    });
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

  /** Change de forme (carré à 4, triangle à 3) ou de taille (cases par côté) : cadre, nombre de pions. */
  preparer(nbJoueurs, siegeVue, cote) {
    const geo = geometrie(nbJoueurs, cote);
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
        const el = s('g', { class: 'pion', 'data-pion-dessin': g }, dessinPion(g >> 2));
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
    const bois = `url(#${this.idBois})`;
    const motif = `url(#${this.idVeinage})`;
    if (geo.forme === 'triangle') {
      const { A, B, C } = geo.triangle;
      const points = [A, B, C].map((p) => `${p.x},${p.y}`).join(' ');
      f.append(
        s('polygon', { class: 'cadre cadre-triangle', points }),
        s('polygon', { class: 'tapis tapis-triangle', points, style: { fill: bois, stroke: bois } }),
        s('polygon', { class: 'veinage veinage-triangle', points, style: { fill: motif, stroke: motif } }),
      );
    } else {
      const b = geo.bord;
      const COTE = geo.cote;
      f.append(
        s('rect', { class: 'cadre', x: b.x, y: b.y, width: b.l, height: b.h, rx: 7 }),
        s('rect', { class: 'tapis', x: -0.75, y: -0.75, width: COTE + 1.5, height: COTE + 1.5, rx: 3.5, style: { fill: bois } }),
        s('rect', { class: 'veinage', x: -0.75, y: -0.75, width: COTE + 1.5, height: COTE + 1.5, rx: 3.5, style: { fill: motif } }),
        s('rect', { class: 'filet', x: CELLULE * 1.24, y: CELLULE * 1.24, width: COTE - CELLULE * 2.48, height: COTE - CELLULE * 2.48, rx: 2.5 }),
      );
    }
    const g = s('g', { class: 'cases' });
    for (let o = 0; o < n; o++) {
      const cote = geo.coteDe(o, siegeVue);
      const angle = geo.angleCote(cote);
      // Base.
      g.append(rectTourne('zone-base', geo.centreBase(o, siegeVue), geo.TAILLE_BASE, geo.TAILLE_BASE, angle, { rx: 3, fill: couleurSiege(o), 'data-base': o }));
      for (let k = 0; k < 4; k++) {
        const b = geo.emplacementBase(o, k, siegeVue);
        g.append(s('circle', { class: 'trou', cx: b.x, cy: b.y, r: RAYON_TROU + 0.4, style: { fill: `url(#${this.idTrou})` } }));
      }
      // Allée : un rectangle de sa couleur qui englobe les 4 trous.
      const a0 = geo.caseAllee(o, 0, siegeVue);
      const a3 = geo.caseAllee(o, 3, siegeVue);
      const milieu = { x: (a0.x + a3.x) / 2, y: (a0.y + a3.y) / 2 };
      g.append(rectTourne('zone-allee', milieu, 9.8, 3 * CELLULE + 9.8, angle, { rx: 2.6, fill: couleurSiege(o) }));
      for (let k = 0; k < 4; k++) {
        const p = geo.caseAllee(o, k, siegeVue);
        g.append(s('circle', { class: 'trou', cx: p.x, cy: p.y, r: RAYON_TROU, style: { fill: `url(#${this.idTrou})` } }));
      }
      // Sortie : petit carré plein de sa couleur.
      g.append(rectTourne('zone-sortie', geo.caseCircuit(o * geo.casesParCote, siegeVue), 9.8, 9.8, angle, { rx: 2, fill: couleurSiege(o) }));
    }
    const departs = new Set(Array.from({ length: n }, (_, o) => o * geo.casesParCote));
    for (let i = 0; i < geo.nbCases; i++) {
      const p = geo.caseCircuit(i, siegeVue);
      const repere = i % geo.casesParCote === 6 || i % geo.casesParCote === 12;
      const depart = departs.has(i);
      // Repère de comptage : un anneau clair incrusté autour du trou.
      if (repere) g.append(s('circle', { class: 'anneau-repere', cx: p.x, cy: p.y, r: 4.55 }));
      g.append(
        s('circle', {
          class: 'trou' + (repere ? ' repere' : '') + (depart ? ' trou-sortie' : ''),
          cx: p.x,
          cy: p.y,
          r: RAYON_TROU,
          style: { fill: `url(#${this.idTrou})` },
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
    this.preparer(n, siegeVue, viser(etat)); // le plateau de la partie montrée : 18 cases par côté, 16 pour les premières
    this.etat = etat;
    const positions = pions || etat.pions;
    this.positions = positions;
    // Le contour de la base clignote pour le joueur dont c'est le tour (pendant l'échange : celui qui jouera le premier).
    const auTour = etat.phase === 'jeu' || etat.phase === 'echange' ? etat.tour : -1;
    for (const base of this.svg.querySelectorAll('.zone-base')) base.classList.toggle('au-tour', Number(base.dataset.base) === auTour);
    for (let g = 0; g < this.pions.length; g++) {
      const el = this.pions[g];
      el.style.transform = translate(this.geo.positionPion(g, positions[g], siegeVue));
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
    if (this.geo.etiquettesAutour) {
      this.dessinerNomsAutour(etat, joueurs, siegeVue, sousTitres, siegeLocal);
      return;
    }
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
        'aria-label': `${nom}${j.ia ? ', IA ' + niveauEnLettres(j.niveau) : ''}${actif ? ', à son tour' : ''}`,
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

  /**
   * 2 contre 2 : les noms autour du plateau, sur une ligne : pastille (couleur, icône ou initiale), prénom, nombre
   * de cartes, état (à toi, joue…, a donné ✓, a fini ✓) et niveau d'une IA ; celui dont c'est le tour est encadré.
   */
  dessinerNomsAutour(etat, joueurs, siegeVue, sousTitres, siegeLocal) {
    const c = this.coucheEtiquettes;
    for (let siege = 0; siege < 4; siege++) {
      const cote = this.geo.coteDe(siege, siegeVue);
      const place = this.geo.placeEtiquette(cote);
      const j = joueurs?.[siege] || {};
      const actif = etat.phase === 'jeu' && etat.tour === siege;
      const attend = etat.phase === 'echange' && !etat.echanges?.[siege];
      const emoji = j.ia ? EMOJI_IA : emojiIcone(j.icone);
      const nom = siege === siegeLocal ? 'Toi' : j.pseudo || `Joueur ${siege + 1}`;
      const nb = etat.cartesRestantes?.[siege] ?? 0;
      const etatJoueur = sousTitres[siege] || (actif ? 'joue…' : attend ? 'choisit sa carte' : '');
      const morceaux = [String(nb)]; // précédé de l'icône des cartes
      if (j.ia) morceaux.push(nomNiveau(j.niveau));
      if (etatJoueur) morceaux.push(etatJoueur);
      const g = s('g', {
        class: 'etiquette etiquette-autour' + (actif ? ' actif' : '') + (attend ? ' attend' : '') + (siege === siegeLocal ? ' moi' : ''),
        'data-siege': siege,
        'data-niveau': j.ia ? nomNiveau(j.niveau) : null,
        'aria-label': `${nom}${j.ia ? ', IA ' + niveauEnLettres(j.niveau) : ''}, ${nb} carte${nb > 1 ? 's' : ''}${actif ? ', à son tour' : ''}`,
        transform: `translate(${place.x} ${place.y}) rotate(${place.angle})`,
      });
      const fond = s('rect', { class: 'fond-etiquette', x: 0, y: -4.4, width: 0, height: 8.8, rx: 4.4 });
      const pastille = s('circle', { class: 'pastille-plateau', cx: 0, cy: 0, r: 3.5, fill: couleurSiege(siege), stroke: couleurFonceeSiege(siege) });
      const initiale = s('text', { class: 'pastille-texte' + (emoji ? ' emoji' : ''), x: 0, y: emoji ? 1.45 : 1.3 }, emoji || (nom.slice(0, 1).toUpperCase() || '?'));
      // Prénom, petite icône de cartes (deux dos), puis leur nombre et le reste (niveau, état).
      const ICONE = 5.6; // largeur de l'icône
      const prenom = s('tspan', { class: 'prenom' }, tronquer(nom, 14));
      const details = s('tspan', { class: 'details', dx: (ICONE + 3.2).toFixed(2) }, morceaux.join(' · '));
      const texte = s('text', { class: 'nom-autour', x: 0, y: 1.75 }, prenom, details);
      const icone = s(
        'g',
        { class: 'icone-cartes' + (nb ? '' : ' vide'), 'aria-hidden': 'true' },
        s('rect', { class: 'dos-carte', x: 0, y: -2.7, width: 3.3, height: 4.9, rx: 0.6, transform: 'rotate(-9 1.65 0)' }),
        s('rect', { class: 'dos-carte', x: 2.1, y: -2.5, width: 3.3, height: 4.9, rx: 0.6, transform: 'rotate(9 3.75 0)' }),
      );
      g.append(fond, pastille, initiale, texte, icone);
      c.append(g);
      // Centrage : on mesure le texte une fois posé (repli approximatif s'il n'est pas encore affiché).
      const mesurer = (el, repli) => {
        let l = 0;
        try {
          l = el.getComputedTextLength();
        } catch {
          l = 0;
        }
        return l || repli;
      };
      const lPrenom = mesurer(prenom, Math.min(nom.length, 14) * 3.1);
      const lDetails = mesurer(details, morceaux.join(' · ').length * 2.75);
      const largeur = Math.min(lPrenom + ICONE + 3.2 + lDetails, place.longueur - 12);
      const total = 3.5 * 2 + 1.6 + largeur;
      const x0 = -total / 2;
      pastille.setAttribute('cx', (x0 + 3.5).toFixed(2));
      initiale.setAttribute('x', (x0 + 3.5).toFixed(2));
      texte.setAttribute('x', (x0 + 8.6).toFixed(2));
      icone.setAttribute('transform', `translate(${(x0 + 8.6 + lPrenom + 1.8).toFixed(2)} 0)`);
      fond.setAttribute('x', (x0 - 1.6).toFixed(2));
      fond.setAttribute('width', (total + 3.2).toFixed(2));
    }
  }

  dessinerCentre(etat, joueurs) {
    const c = this.coucheCentre;
    c.replaceChildren();
    const { x: cx, y: cy } = this.geo.centre;
    const triangle = this.geo.forme === 'triangle';
    // Dans le triangle, la donne est écrite sous la carte (au-dessus, il n'y a pas la place).
    const yDonne = triangle ? cy + 23 : cy - 24;
    const yQui = triangle ? cy + 28.5 : cy + 28;
    c.append(s('text', { class: 'texte-donne', x: cx, y: yDonne }, `Donne ${etat.donne + 1}`));
    const pile = etat.pile || [];
    const x0 = cx - 11;
    const y0 = cy - 15.5 - (triangle ? 2 : 0);
    // Sur le carré, le centre est dégagé (noms autour) : les cartes y sont un peu plus grandes.
    const echelle = triangle ? 1 : 1.25;
    const zoom = (el) => (echelle === 1 ? el : s('g', { transform: `translate(${cx} ${cy}) scale(${echelle}) translate(${-cx} ${-cy})` }, el));
    if (!pile.length) {
      c.append(zoom(s('rect', { class: 'emplacement-carte', x: x0, y: y0, width: 22, height: 31, rx: 2.4 })));
      return;
    }
    // Les cartes posées s'accumulent : chacune garde sa place dans le tas (léger décalage et rotation, tirés de
    // son rang dans la pile, donc stables d'un affichage à l'autre). On dessine les dernières, la plus récente dessus.
    const yMilieu = y0 + 15.5;
    const poser = (i, el) => {
      const hasard = (i * 2654435761) >>> 0;
      const angle = (((hasard >>> 8) % 19) - 9) * (triangle ? 0.65 : 1);
      const dx = (((hasard >>> 16) % 7) - 3) * (triangle ? 0.5 : 0.8);
      const dy = (((hasard >>> 20) % 5) - 2) * (triangle ? 0.45 : 0.6);
      return s('g', { transform: `translate(${dx.toFixed(2)} ${dy.toFixed(2)}) rotate(${angle} ${cx} ${yMilieu})` }, el);
    };
    const dernier = pile.length - 1;
    for (let i = Math.max(0, dernier - CARTES_VISIBLES + 1); i < dernier; i++) {
      c.append(s('g', { class: 'carte-dessous', 'aria-hidden': 'true' }, zoom(poser(i, this.faceCarte(pile[i], etat, cx, x0, y0)))));
    }
    const g = this.faceCarte(pile[dernier], etat, cx, x0, y0);
    g.setAttribute('aria-label', `Dernière carte : ${carteCourte(pile[dernier])}, ${pile.length} dans le tas`);
    // Groupe extérieur sans transformation : c'est lui que l'animation de la carte jouée déplace.
    this.carteCentre = s('g', { class: 'carte-centre' }, zoom(poser(dernier, g)));
    c.append(this.carteCentre);
    const d = etat.dernierCoup;
    if (d && !triangle) {
      const qui = joueurs?.[d.siege]?.pseudo || '';
      const texte = d.coup?.t === 'defausse' ? `défaussée` : tronquer(qui, 12);
      c.append(s('text', { class: 'texte-donne petit', x: cx, y: yQui }, texte));
    }
  }

  /** Face d'une carte posée au centre (22 × 31, coin haut gauche en x0, y0). */
  faceCarte(carte, etat, cx, x0, y0) {
    const joker = estJoker(carte);
    const rouge = !joker && estRouge(carte);
    const g = s('g', { class: 'carte-plateau' + (rouge ? ' rouge' : '') + (joker ? ' joker' : '') });
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
    return g;
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
  /**
   * @param {Object} [rythme]  { pas: ms par case, max: ms au plus pour un déplacement, saut: ms d'un saut direct,
   *                           carte: ms du trajet de la carte jouée } ; renvoie la durée totale (ms).
   */
  animer(dernierCoup, siegeVue, rythme = {}) {
    this.arreterAnimations();
    if (!dernierCoup || !this.geo) return 0;
    viserPlateau(this.geo.casesParCote);
    const { pas = 110, max = 1100, saut = 380, carte: dureeCarte = 380 } = rythme;
    // La carte jouée part de son joueur vers le centre, puis les pions bougent.
    let depart = 0;
    if (this.carteCentre && dernierCoup.siege !== undefined) {
      const cote = this.geo.coteDe(dernierCoup.siege, siegeVue);
      const origine = this.geo.etiquettesAutour
        ? this.geo.placeEtiquette(cote)
        : (({ x, y, l, h }) => ({ x: x + l / 2, y: y + h / 2 }))(this.geo.boiteEtiquette(cote));
      const dx = origine.x - this.geo.centre.x;
      const dy = origine.y - this.geo.centre.y;
      try {
        this.animations.push(
          this.carteCentre.animate(
            [
              { transform: `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) scale(0.45)`, opacity: 0.4 },
              { transform: 'translate(0px, 0px) scale(1)', opacity: 1 },
            ],
            { duration: dureeCarte, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', fill: 'backwards' },
          ),
        );
        depart = Math.round(dureeCarte * 0.7);
      } catch {
        depart = 0;
      }
    }
    if (!dernierCoup.deplacements?.length) return depart;
    const t = dernierCoup.coup?.t;
    const sens = t === 'recul' ? 'arriere' : t === 'echange' || t === 'sortie' ? 'direct' : 'avant';
    const lignes = new Map(); // pion → [{ temps, pos }]
    const poser = (pion, de, etapes, debut, duree) => {
      if (!lignes.has(pion)) lignes.set(pion, [{ temps: 0, pos: de }]);
      const l = lignes.get(pion);
      l.push({ temps: debut, pos: de });
      etapes.forEach((pos, i) => i > 0 && l.push({ temps: debut + (duree * i) / (etapes.length - 1), pos }));
    };
    let temps = depart;
    let captures = []; // le moteur liste les captures juste avant le déplacement qui les provoque
    for (const d of dernierCoup.deplacements) {
      if (d.capture) {
        captures.push(d);
        continue;
      }
      const etapes = chemin(d.pion, d.de, d.vers, sens, this.geo.nbJoueurs);
      const duree = etapes.length <= 2 ? saut : Math.min(pas * (etapes.length - 1), max);
      // Valet : les deux pions se croisent en même temps.
      const debut = t === 'echange' ? depart : temps;
      poser(d.pion, d.de, etapes, debut, duree);
      let fin = debut + duree;
      // Le pion capturé retourne à sa base une fois le pion qui le prend arrivé.
      for (const c of captures) poser(c.pion, c.de, [c.de, c.vers], fin, saut);
      if (captures.length) fin += saut;
      captures = [];
      temps = Math.max(temps, fin);
    }
    const total = Math.max(temps, saut);
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
    return total;
  }
}

function tronquer(texte, n) {
  return texte.length > n ? texte.slice(0, n - 1) + '…' : texte;
}
