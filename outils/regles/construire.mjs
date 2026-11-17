// Génère la page Règles de l'appli (« Le Toc en une page ») et, à la demande, les pages de relecture.
// Les schémas reprennent la géométrie du plateau de l'appli (public/js/ui/geometrie.js) : chaque tronçon est un
// recadrage du vrai plateau. Les positions des exemples sont vérifiées par le moteur (exemples.mjs).
//
//   SORTIE_APPLI=public node outils/regles/construire.mjs      écrit public/js/ui/regles-page.js et public/css/regles.css
//   SORTIE_PAGES=/un/dossier node outils/regles/construire.mjs écrit aussi regles-toc.html et infographies-toc.html

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { geometrie, chemin } from '../../public/js/ui/geometrie.js';
import { COTE_ACTUEL, nbCases } from '../../public/js/moteur/plateau.js';
import { exemples, verifier, BASE, ALLEE, a, CASES } from './exemples.mjs';

if (verifier({ silencieux: true })) {
  console.error('Des contrôles du moteur échouent : lance « node outils/regles/exemples.mjs ».');
  process.exit(1);
}
const EX = Object.fromEntries(exemples().map((e) => [e.id, e]));
// Cases des exemples : E0 = case d'entrée de Bleu, D1 = case de sortie de Rouge, DERNIERE = dernière case du circuit.
const { E0, D1, DERNIERE } = CASES;

// ─── Dessin du plateau ──────────────────────────────────────────────────────

const n2 = (v) => String(+v.toFixed(2));
const RAYON_TROU = 3.4;
const RAYON_PION = 3.15;

function rectTourne(classe, { x, y }, l, h, angle, rx) {
  const t = angle ? ` transform="rotate(${n2(angle)} ${n2(x)} ${n2(y)})"` : '';
  return `<rect class="${classe}" x="${n2(x - l / 2)}" y="${n2(y - h / 2)}" width="${n2(l)}" height="${n2(h)}" rx="${rx}"${t}/>`;
}

/** Le point est-il dans la fenêtre [x, y, l, h] (avec une marge) ? Sans fenêtre : toujours. */
const dans = (fenetre, p, marge) => !fenetre || (p.x > fenetre[0] - marge && p.x < fenetre[0] + fenetre[2] + marge && p.y > fenetre[1] - marge && p.y < fenetre[1] + fenetre[3] + marge);

function fond(nb, vue, fenetre = null) {
  const geo = geometrie(nb, COTE_ACTUEL);
  let s = '';
  if (geo.forme === 'triangle') {
    const { A, B, C } = geo.triangle;
    const points = [A, B, C].map((p) => `${n2(p.x)},${n2(p.y)}`).join(' ');
    s += `<polygon class="cadre-t" points="${points}"/><polygon class="tapis-t" points="${points}"/><polygon class="grain-t" points="${points}"/>`;
  } else {
    const L = geo.cote;
    s += `<rect class="cadre" x="-4.5" y="-4.5" width="${n2(L + 9)}" height="${n2(L + 9)}" rx="7"/>`;
    s += `<rect class="tapis" x="-0.75" y="-0.75" width="${n2(L + 1.5)}" height="${n2(L + 1.5)}" rx="3.5"/>`;
    s += `<rect class="grain" x="-0.75" y="-0.75" width="${n2(L + 1.5)}" height="${n2(L + 1.5)}" rx="3.5"/>`;
    s += `<rect class="filet" x="12.4" y="12.4" width="${n2(L - 24.8)}" height="${n2(L - 24.8)}" rx="2.5"/>`;
  }
  for (let o = 0; o < nb; o++) {
    const cote = geo.coteDe(o, vue);
    const angle = geo.angleCote(cote);
    if (dans(fenetre, geo.centreBase(o, vue), 20)) {
      s += rectTourne(`zone c${o}`, geo.centreBase(o, vue), geo.TAILLE_BASE, geo.TAILLE_BASE, angle, 3);
      for (let k = 0; k < 4; k++) {
        const b = geo.emplacementBase(o, k, vue);
        s += `<circle class="trou" cx="${n2(b.x)}" cy="${n2(b.y)}" r="${RAYON_TROU + 0.4}"/>`;
      }
    }
    const a0 = geo.caseAllee(o, 0, vue);
    const a3 = geo.caseAllee(o, 3, vue);
    const milieu = { x: (a0.x + a3.x) / 2, y: (a0.y + a3.y) / 2 };
    if (dans(fenetre, milieu, 26)) {
      s += rectTourne(`zone c${o}`, milieu, 9.8, 39.8, angle, 2.6);
      for (let k = 0; k < 4; k++) {
        const p = geo.caseAllee(o, k, vue);
        s += `<circle class="trou" cx="${n2(p.x)}" cy="${n2(p.y)}" r="${RAYON_TROU}"/>`;
      }
    }
    const sortie = geo.caseCircuit(o * geo.casesParCote, vue);
    if (dans(fenetre, sortie, 8)) s += rectTourne(`zone c${o}`, sortie, 9.8, 9.8, angle, 2);
  }
  for (let i = 0; i < geo.nbCases; i++) {
    const p = geo.caseCircuit(i, vue);
    if (!dans(fenetre, p, 6)) continue;
    if (i % geo.casesParCote === 6 || i % geo.casesParCote === 12) s += `<circle class="repere" cx="${n2(p.x)}" cy="${n2(p.y)}" r="4.55"/>`;
    s += `<circle class="trou" cx="${n2(p.x)}" cy="${n2(p.y)}" r="${RAYON_TROU}"/>`;
  }
  return s;
}

function bille(couleur, { x, y }, classe = '') {
  return (
    `<g class="pion ${classe}" transform="translate(${n2(x)} ${n2(y)})">` +
    `<circle class="ombre" cy="0.65" r="${RAYON_PION}"/><circle class="bille b${couleur}" r="${RAYON_PION}"/>` +
    '<circle class="reflet" cx="-1" cy="-1.12" r="1.05"/></g>'
  );
}

/** Outils de dessin pour un plateau (4 ou 3 joueurs) vu du siège `vue`. */
function outils(nb, vue) {
  const geo = geometrie(nb, COTE_ACTUEL);
  const pos = (pion, p) => geo.positionPion(pion, p, vue);
  const o = {
    geo,
    pos,
    cas: (i) => geo.caseCircuit(i, vue),
    allee: (s, k) => geo.caseAllee(s, k, vue),
    /** Tous les pions d'une position du moteur. */
    pions: (positions, fenetre = null) =>
      positions
        .map((p, g) => (dans(fenetre, pos(g, p), 5) ? bille(g >> 2, pos(g, p)) : ''))
        .join(''),
    /** Chiffres 1, 2, 3… sur les cases parcourues par `pion` de `de` à `vers` (positions du moteur). */
    chiffres(pion, de, vers, { sens = 'avant', debut = 1, max = Infinity } = {}) {
      const etapes = chemin(pion, de, vers, sens, nb).slice(1);
      return etapes
        .slice(0, max)
        .map((p, i) => {
          const c = pos(pion, p);
          return `<text class="pas" x="${n2(c.x)}" y="${n2(c.y)}">${debut + i}</text>`;
        })
        .join('');
    },
    anneau(pion, p, type = 'arrivee') {
      const c = pos(pion, p);
      return `<circle class="anneau ${type}" cx="${n2(c.x)}" cy="${n2(c.y)}" r="4.9"/>`;
    },
    /** Pastille « pris » accrochée au pion qui va retourner à sa base. */
    prise(pion, p) {
      const c = pos(pion, p);
      return `<g class="prise" transform="translate(${n2(c.x + 3.1)} ${n2(c.y - 3.3)})"><circle r="2.25"/><path d="M-1 -1 L1 1 M1 -1 L-1 1"/></g>`;
    },
  };
  return o;
}

/** Texte posé sur le bois, avec un trait de rappel facultatif vers un point. */
function note(x, y, texte, { ancre = 'start', vers = null, de = null, classe = '' } = {}) {
  const lignes = Array.isArray(texte) ? texte : [texte];
  let s = '';
  if (vers) {
    const d = de || { x, y: y - 1.5 };
    s += `<line class="rappel" x1="${n2(d.x)}" y1="${n2(d.y)}" x2="${n2(vers.x)}" y2="${n2(vers.y)}"/>`;
  }
  s += `<text class="lib ${classe}" x="${n2(x)}" y="${n2(y)}" text-anchor="${ancre}">`;
  s += lignes.map((l, i) => `<tspan x="${n2(x)}" dy="${i ? 5.2 : 0}">${l}</tspan>`).join('');
  return s + '</text>';
}

function fleche(x1, y1, x2, y2, { classe = '', courbe = 0 } = {}) {
  if (!courbe) return `<line class="fleche ${classe}" x1="${n2(x1)}" y1="${n2(y1)}" x2="${n2(x2)}" y2="${n2(y2)}"/>`;
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const l = Math.hypot(dx, dy) || 1;
  const cx = mx + (-dy / l) * courbe;
  const cy = my + (dx / l) * courbe;
  return `<path class="fleche ${classe}" d="M${n2(x1)} ${n2(y1)} Q${n2(cx)} ${n2(cy)} ${n2(x2)} ${n2(y2)}"/>`;
}

const sensInterdit = (x, y) =>
  `<g class="stop" transform="translate(${n2(x)} ${n2(y)})"><circle r="3.1"/><rect x="-1.9" y="-0.65" width="3.8" height="1.3" rx="0.3"/></g>`;

/** Un schéma : le plateau recadré sur `fenetre` = [x, y, largeur, hauteur]. */
function schema({ nb = 4, vue = 0, fenetre, dessous = '', pions, dessus = '', alt }) {
  const o = outils(nb, vue);
  const [x, y, l, h] = fenetre;
  return (
    `<svg class="pl" viewBox="${x} ${y} ${l} ${h}" role="img" aria-label="${alt}">` +
    fond(nb, vue, fenetre) +
    dessous +
    (pions ? o.pions(pions, fenetre) : '') +
    dessus +
    '</svg>'
  );
}

// ─── Cartes ─────────────────────────────────────────────────────────────────

const SYMBOLES = { P: '♠', C: '♥', K: '♦', T: '♣' };
const NOMS_COULEUR = { P: 'pique', C: 'cœur', K: 'carreau', T: 'trèfle' };
const NOMS_RANG = { A: 'as', R: 'roi', D: 'dame', V: 'valet' };
const decoupe = (c) => ({ r: c.slice(0, -1), k: c.slice(-1) });
const nomCarte = (c) => {
  if (c === 'J') return 'joker';
  const { r, k } = decoupe(c);
  return `${NOMS_RANG[r] || r} de ${NOMS_COULEUR[k]}`;
};
const estRouge = (c) => c.endsWith('C') || c.endsWith('K');

/** Petite carte dans le texte. */
function c(carte) {
  if (carte === 'J') return '<span class="c j" role="img" aria-label="joker"><b>Joker</b><i aria-hidden="true">★</i></span>';
  const { r, k } = decoupe(carte);
  return `<span class="c ${estRouge(carte) ? 'r' : 'n'}" role="img" aria-label="${nomCarte(carte)}"><b>${r}</b><i aria-hidden="true">${SYMBOLES[k]}︎</i></span>`;
}

/** Carte du tableau. */
function cj(carte) {
  if (carte === 'J') return '<span class="cj j" aria-hidden="true"><b>JOKER</b><i>★</i></span>';
  const { r, k } = decoupe(carte);
  return `<span class="cj ${estRouge(carte) ? 'r' : 'n'}" aria-hidden="true"><b>${r}</b><i>${SYMBOLES[k]}︎</i></span>`;
}

// ─── Fenêtres de recadrage (unités du plateau : 10 par case) ────────────────
// Les cotes écrites en dur valent pour le plateau de 18 cases par côté : côté du bas à y = 185, case de sortie de
// Bleu à x = 95.

const HAUT = 134; // au-dessus du fond de l'allée
const BAS = 194.5; // bord du cadre
const F = (x1, x2, y1 = HAUT) => [x1, y1, x2 - x1, BAS - y1];

// ─── Schémas ────────────────────────────────────────────────────────────────

const figures = {};

// Vue d'ensemble du plateau carré.
{
  const o = outils(4, 0);
  const pastille = (n, x, y, vers = []) =>
    vers.map((v) => `<line class="rappel fort" x1="${x}" y1="${y}" x2="${n2(v.x)}" y2="${n2(v.y)}"/>`).join('') +
    `<g class="pastille" transform="translate(${x} ${y})"><circle r="5.4"/><text y="0.2">${n}</text></g>`;
  const nom = (x, y, texte, couleur, angle = 0) =>
    `<g transform="translate(${x} ${y}) rotate(${angle})"><circle class="bille b${couleur}" cx="${n2(-texte.length * 1.95 - 4.2)}" cy="0" r="2.8"/><text class="nom" x="${n2(-texte.length * 1.95 + 1)}" y="0">${texte}</text></g>`;
  const geo = o.geo;
  const L = geo.cote;
  const cx = L / 2;
  const cy = L / 2;
  const R = 17;
  // Flèche circulaire dans le sens des aiguilles d'une montre.
  const pt = (deg) => ({ x: cx + R * Math.cos((deg * Math.PI) / 180), y: cy + R * Math.sin((deg * Math.PI) / 180) });
  const p1 = pt(155);
  const p2 = pt(25);
  const vers = (p, dx, dy) => ({ x: p.x + dx, y: p.y + dy });
  figures.plateau =
    `<svg class="pl ensemble" viewBox="-17 -17 ${n2(L + 34)} ${n2(L + 34)}" role="img" aria-label="Le plateau carré vu d'en haut : un circuit de ${nbCases()} cases, et pour chaque joueur une base, une case de sortie et une allée de 4 cases.">` +
    fond(4, 0) +
    o.pions(Array(16).fill(BASE)) +
    `<path class="fleche sens" d="M${n2(p1.x)} ${n2(p1.y)} A${R} ${R} 0 1 1 ${n2(p2.x)} ${n2(p2.y)}"/>` +
    `<text class="lib centre" x="${cx}" y="${cy + 1.2}" text-anchor="middle">sens</text><text class="lib centre" x="${cx}" y="${cy + 7.4}" text-anchor="middle">du jeu</text>` +
    pastille(1, cx, L - 51, [vers(geo.centreBase(0, 0), 0, -13.5)]) +
    pastille(2, cx - 26, L - 20, [vers(o.cas(0), -4.7, -2.8)]) +
    pastille(3, cx + 52, L - 18, [vers(o.cas(E0), 4.2, -2.6)]) +
    pastille(4, cx + 52, L - 39, [vers(o.allee(0, 2), 5, 0)]) +
    pastille(5, cx - 56, L - 27, [vers(o.cas(6), 0.6, -4.8), vers(o.cas(12), 3.2, 3)]) +
    nom(cx, L + 11, 'Toi', 0) +
    nom(cx, -10.5, 'Ton partenaire', 2) +
    nom(-10.5, cy, 'Adversaire', 1, -90) +
    nom(L + 10.5, cy, 'Adversaire', 3, 90) +
    '</svg>';
}

// Vue d'ensemble du plateau triangulaire.
{
  const o = outils(3, 0);
  const T = o.geo.triangle;
  figures.triangle =
    `<svg class="pl ensemble" viewBox="-13 -13 ${n2(T.cote + 26)} ${n2(T.haut + 58.4)}" role="img" aria-label="Le plateau triangulaire à 3 joueurs : un circuit de ${nbCases(3)} cases, les bases à l'extérieur du triangle.">` +
    fond(3, 0) +
    o.pions(Array(12).fill(BASE)) +
    '</svg>';
}

/** Libellé sur deux lignes à gauche de la base, relié à la case de sortie. */
const libelleSortie = (l1, l2) => note(79.4, 171.6, [l1, l2], { ancre: 'end', vers: { x: 90, y: 182 }, de: { x: 80.2, y: 176 } });

// 1. Sortir un pion.
{
  const { avant, apres } = EX.sortie;
  const o = outils(4, 0);
  const f = F(60.5, 154.5);
  figures.sortieAvant = schema({
    fenetre: f,
    pions: avant.pions,
    dessus: note(79.4, 160, 'ta base', { ancre: 'end' }) + libelleSortie('case de', 'sortie') + note(132.6, 160, 'ton allée'),
    alt: 'Avant : les 4 pions bleus sont à la base, la case de sortie est vide.',
  });
  figures.sortieApres = schema({
    fenetre: f,
    dessous: o.anneau(0, 0),
    pions: apres.pions,
    dessus: libelleSortie('pion', 'protégé'),
    alt: 'Après : un pion bleu est posé sur la case de sortie, les 3 autres restent à la base.',
  });
}

// 2. Recule de 4 puis joue un 5.
{
  const { avant, milieu, apres } = EX['quatre-cinq'];
  const o = outils(4, 0);
  const f = F(66, 160);
  figures.qc1 = schema({
    fenetre: f,
    dessous: o.anneau(0, E0 - 1),
    pions: avant.pions,
    dessus: o.chiffres(0, 0, E0 - 1, { sens: 'arriere' }),
    alt: "Le pion bleu, sur sa case de sortie, recule de 4 cases : il passe sa case d'entrée et s'arrête une case plus loin.",
  });
  figures.qc2 = schema({
    fenetre: f,
    dessous: o.anneau(0, 0, 'depart') + o.anneau(0, a(3)),
    pions: milieu.pions,
    dessus: o.chiffres(0, E0 - 1, a(3)),
    alt: "Le pion avance de 5 : une case sur le circuit jusqu'à la case d'entrée, puis les 4 cases de l'allée.",
  });
  figures.qc3 = schema({
    fenetre: f,
    dessous: o.anneau(0, E0 - 1, 'depart') + o.anneau(0, a(3)),
    pions: apres.pions,
    alt: 'Le pion bleu est au fond de son allée.',
  });
}

// 3. Capture en arrivant (le long du côté du bas, à gauche de la case de sortie).
{
  const { avant, apres } = EX.capture;
  const o = outils(4, 0);
  const f = [8.8, 166, 72, BAS - 166];
  figures.captureAvant = schema({
    fenetre: f,
    dessous: o.anneau(0, 8),
    pions: avant.pions,
    dessus: o.chiffres(0, 2, 8) + o.prise(4, 8),
    alt: 'Avant : le pion bleu est 6 cases derrière un pion rouge ; un pion vert se trouve entre les deux.',
  });
  figures.captureApres = schema({
    fenetre: f,
    dessous: o.anneau(0, 2, 'depart') + o.anneau(0, 8),
    pions: apres.pions,
    dessus: note(21.5, 173, 'Rouge retourne à sa base') + note(45, 178.7, "Vert n'a pas bougé", { ancre: 'middle' }),
    alt: "Après : le pion bleu a pris la place du pion rouge, qui est retourné à sa base. Le pion vert n'a pas bougé.",
  });
}

// 4. Pion protégé (vu du côté de Rouge).
{
  const { avant } = EX.protege;
  const o = outils(4, 1);
  const f = F(60.5, 154.5);
  const libelle = libelleSortie('pion', 'protégé');
  const c15 = o.cas(D1 - 1);
  const c16 = o.cas(D1);
  figures.protegeNon = schema({
    vue: 1,
    fenetre: f,
    pions: avant.pions,
    dessus: o.chiffres(0, D1 - 4, D1 + 2, { max: 3 }) + sensInterdit((c15.x + c16.x) / 2 + 0.4, c15.y - 6.6) + libelle,
    alt: 'Interdit : avec un 6, le pion bleu devrait dépasser le pion rouge posé sur sa case de sortie.',
  });
  figures.protegeOui = schema({
    vue: 1,
    fenetre: f,
    dessous: o.anneau(0, D1 - 1),
    pions: avant.pions,
    dessus: o.chiffres(0, D1 - 4, D1 - 1) + libelle,
    alt: "Permis : avec un 3, le pion bleu s'arrête juste derrière le pion rouge.",
  });
}

// 5a. Valet.
{
  const { avant, apres } = EX.valet;
  const o = outils(4, 0);
  const f = F(64, 158);
  figures.valetAvant = schema({
    fenetre: f,
    dessous: o.anneau(0, 2) + o.anneau(4, E0 - 2),
    pions: avant.pions,
    dessus: note(156.5, 177.4, 'pion rouge', { ancre: 'end' }),
    alt: "Avant : ton pion bleu est 2 cases après ta case de sortie ; un pion rouge est 2 cases avant ta case d'entrée.",
  });
  figures.valetApres = schema({
    fenetre: f,
    dessous: o.anneau(0, E0 - 2) + o.anneau(4, 2),
    pions: apres.pions,
    dessus: note(156.5, 177.4, 'ton pion', { ancre: 'end' }),
    alt: "Après : les deux pions ont échangé leurs cases. Ton pion bleu est 2 cases avant ta case d'entrée.",
  });
}

// 5b. Valet depuis sa case de sortie.
{
  const { avant, apres } = EX['valet-sortie'];
  const o = outils(4, 0);
  const f = F(66, 160);
  figures.valetSortieAvant = schema({
    fenetre: f,
    dessous: o.anneau(0, 0) + o.anneau(12, E0 - 1),
    pions: avant.pions,
    dessus: note(158.5, 177.4, 'pion vert', { ancre: 'end' }),
    alt: "Avant : ton pion bleu est sur ta case de sortie ; un pion vert est une case avant ta case d'entrée.",
  });
  figures.valetSortieApres = schema({
    fenetre: f,
    dessous: o.anneau(0, E0 - 1) + o.anneau(12, 0),
    pions: apres.pions,
    dessus: note(158.5, 177.4, 'ton pion', { ancre: 'end' }),
    alt: "Après : ton pion bleu est une case avant ta case d'entrée ; le pion vert est sur ta case de sortie.",
  });
}

// 6b. 7 partagé : 3 + 4.
{
  const { avant, apres } = EX['sept-simple'];
  const o = outils(4, 0);
  const f = F(19, 113, 146);
  figures.septSimpleAvant = schema({
    fenetre: f,
    dessous: o.anneau(0, 2) + o.anneau(1, 7),
    pions: avant.pions,
    dessus: o.chiffres(0, DERNIERE, 2) + o.chiffres(1, 3, 7, { debut: 4 }) + o.prise(12, 5),
    alt: 'Avant : deux pions bleus sur le circuit. Le premier va avancer de 3 cases, le second de 4 en dépassant un pion vert.',
  });
  figures.septSimpleApres = schema({
    fenetre: f,
    dessous: o.anneau(0, DERNIERE, 'depart') + o.anneau(1, 3, 'depart') + o.anneau(0, 2) + o.anneau(1, 7),
    pions: apres.pions,
    dessus: note(50, 174.4, ['Vert retourne', 'à sa base'].join(' '), { ancre: 'middle' }),
    alt: 'Après : les deux pions bleus ont avancé de 3 et de 4 cases. Le pion vert dépassé est retourné à sa base.',
  });
}

// 6. 7 partagé : 1 + 1 + 1 + 4.
{
  const { avant, apres } = EX.sept;
  const o = outils(4, 0);
  const f = F(109.5, 179.5);
  const inter = avant.pions.slice();
  inter[0] = a(3);
  inter[1] = a(2);
  inter[2] = a(1);
  const montee = [0, 1, 2]
    .map((k) => {
      const p = o.allee(0, k);
      return fleche(p.x + 7.4, p.y + 0.5, p.x + 7.4, p.y - 7.6, { classe: 'petite' }) + `<text class="lib plus" x="${n2(p.x + 9.8)}" y="${n2(p.y - 2.2)}">+1</text>`;
    })
    .join('');
  figures.sept1 = schema({
    fenetre: f,
    pions: avant.pions,
    dessus: montee,
    alt: "Avant : trois pions bleus sur les trois premières cases de l'allée, le quatrième sur le circuit, 3 cases avant la case d'entrée. Un pion rouge est entre lui et la case d'entrée.",
  });
  figures.sept2 = schema({
    fenetre: f,
    dessous: o.anneau(3, a(0)),
    pions: inter,
    dessus: o.chiffres(3, E0 - 3, a(0)) + o.prise(4, E0 - 1),
    alt: "Après 1 + 1 + 1 : les trois pions de l'allée ont avancé d'une case, la première case est libre. Le dernier pion va avancer de 4 en dépassant le pion rouge.",
  });
  figures.sept3 = schema({
    fenetre: f,
    dessous: o.anneau(3, E0 - 3, 'depart') + o.anneau(3, a(0)),
    pions: apres.pions,
    dessus: note(133, 159, ['Rouge', 'retourne', 'à sa base']),
    alt: "Après : les 4 pions bleus remplissent l'allée. Le pion rouge dépassé est retourné à sa base.",
  });
  // Pour l'infographie : l'allée pleine, sans annotation.
  figures.alleePleine = schema({ fenetre: f, pions: apres.pions, alt: "Les 4 pions bleus sont rentrés : ils remplissent l'allée." });
}

// 7. 7 injouable.
{
  const { avant } = EX['sept-injouable'];
  const o = outils(4, 0);
  const f = F(66, 166);
  const libre = o.allee(0, 1);
  figures.septInjouable = schema({
    fenetre: f,
    pions: avant.pions,
    dessus: fleche(libre.x + 7.4, libre.y + 10, libre.x + 7.4, libre.y + 1.4, { classe: 'petite' }) + note(libre.x + 10.4, libre.y + 3.6, ['1 seule case', 'possible']),
    alt: "Deux pions bleus sont au fond de l'allée, un troisième sur la première case de l'allée, le dernier à la base. Seul le troisième peut bouger, d'une seule case.",
  });
}

// 8. L'allée : le pion s'arrête où la carte le mène (pas forcément au fond), sans jamais dépasser le fond.
{
  const { avant } = EX.allee;
  const o = outils(4, 0);
  const f = F(64, 158);
  figures.allee3 = schema({
    fenetre: f,
    dessous: o.anneau(0, a(1)),
    pions: avant.pions,
    dessus: o.chiffres(0, E0 - 1, a(1)),
    alt: "Avec un 3 : une case sur le circuit jusqu'à la case d'entrée, puis 2 cases d'allée. Le pion s'arrête au milieu de l'allée, sans aller jusqu'au fond.",
  });
  figures.allee5 = schema({
    fenetre: f,
    dessous: o.anneau(0, a(3)),
    pions: avant.pions,
    dessus: o.chiffres(0, E0 - 1, a(3)),
    alt: "Avec un 5 : une case sur le circuit jusqu'à la case d'entrée, puis 4 cases d'allée. Le pion arrive au fond.",
  });
  figures.allee6 = schema({
    fenetre: f,
    dessous: o.anneau(0, 2),
    pions: avant.pions,
    dessus: o.chiffres(0, E0 - 1, 2) + sensInterdit(o.allee(0, 0).x, o.allee(0, 0).y),
    alt: "Avec un 6 : la carte est trop grande d'une case pour l'allée. Le pion continue sur le circuit et dépasse sa case de sortie.",
  });
}

// 9. Joker (3 joueurs).
{
  const { avant, apres } = EX.joker;
  const o = outils(3, 0);
  const f = [44, 128, 92, 63.3];
  figures.jokerAvant = schema({
    nb: 3,
    fenetre: f,
    pions: avant.pions,
    dessus: note(76.5, 178.9, 'ta base', { ancre: 'end', classe: 'hors' }),
    alt: "Avant, sur le plateau triangulaire : les 4 pions bleus sont à la base, à l'extérieur du circuit.",
  });
  figures.jokerApres = schema({
    nb: 3,
    fenetre: f,
    dessous: o.anneau(0, 0),
    pions: apres.pions,
    alt: 'Après : le joker a servi de roi, un pion bleu est sur la case de sortie.',
  });
}

// ─── Page ───────────────────────────────────────────────────────────────────

const volet = (tag, classe, texte, svg) =>
  `<div class="volet"><p class="volet-titre"><span class="tag ${classe}">${tag}</span>${texte ? ` <span>${texte}</span>` : ''}</p>${svg}</div>`;

let numero = 0;
function exemple({ id, titre, situation, volets, classe = 'deux', suite }) {
  numero += 1;
  return `
<figure class="ex" id="${id}">
  <figcaption class="ex-tete">
    <p class="ex-num">Exemple ${numero}</p>
    <h3>${titre}</h3>
    <p>${situation}</p>
  </figcaption>
  <div class="volets ${classe}">${volets.join('')}</div>
  <div class="ex-suite">${suite}</div>
</figure>`;
}

const css = `
/* Mise en page : une colonne de lecture sur fond bleu ciel, blocs blancs comme dans l'appli ;
   les exemples sont des blocs à bandeau, avec des tronçons du plateau en bois. */
:root {
  --bg: #a9d3f5;
  --surface: #ffffff;
  --surface-2: #e3f0fb;
  --text: #10233c;
  --muted: #40587a;
  --line: #7ba6cd;
  --bord: #2c4768;
  --accent: #1f62c0;
  --accent-text: #ffffff;
  --lien: #143f82;
  --ok: #1c7a43;
  --ok-fond: #dff3e6;
  --err: #b9281f;
  --err-fond: #fbe3e0;
  --dernier: #f0a30a;
  /* Plateau en bois verni */
  --bois: #dcb57f;
  --bois-2: #cfa368;
  --bois-cadre: #7a4c22;
  --bois-filet: #b98a52;
  --bois-texte: #4a2c10;
  --bois-grain: #8a5a2b;
  --trou: #5b3a1b;
  --trou-centre: #321f0f;
  --trou-bord: #3c240e;
  --repere: #fbf1d8;
  --pion-0: #2f6fb5;
  --pion-1: #c8372d;
  --pion-2: #e6a91b;
  --pion-3: #3f8f4f;
  --pion-0-fonce: #153251;
  --pion-1-fonce: #5a1914;
  --pion-2-fonce: #674c0c;
  --pion-3-fonce: #1c4024;
  --chiffre: #ffffff;
  --chiffre-bord: #2a180a;
  --stop: #c8251b;
  --stop-barre: #ffffff;
  --pastille: #ffffff;
  --pastille-texte: #10233c;
  /* Cartes à jouer */
  --carte-fond: #fffdf6;
  --carte-bord: #2c4768;
  --carte-rouge: #cf2f25;
  --carte-noire: #101214;
  --carte-joker: #1f62c0;
  --ombre: 0 1px 3px rgba(15, 34, 56, 0.18);
  --titres: ui-rounded, 'SF Pro Rounded', 'Arial Rounded MT Bold', 'Nunito', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  --texte: system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  --cartes: Georgia, 'Times New Roman', serif;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #0e2238;
    --surface: #16314d;
    --surface-2: #1d3d5e;
    --text: #e8f1fb;
    --muted: #a9c0d8;
    --line: #2f5276;
    --bord: #6e93b9;
    --accent: #4d8fe8;
    --accent-text: #06162b;
    --lien: #b9d4fa;
    --ok: #6fd99b;
    --ok-fond: #17402c;
    --err: #ff9285;
    --err-fond: #4d1f1c;
    --dernier: #ffc233;
    --bois: #a98a63;
    --bois-2: #957652;
    --bois-cadre: #4a2e14;
    --bois-filet: #7d5d3a;
    --bois-texte: #2a180a;
    --bois-grain: #5e3d1c;
    --trou: #4a2f16;
    --trou-centre: #24160a;
    --trou-bord: #2a180a;
    --repere: #ecdcb8;
    --carte-fond: #f7f2e4;
    --carte-bord: #0a1a2b;
    --ombre: 0 1px 4px rgba(0, 0, 0, 0.4);
    color-scheme: dark;
  }
}
:root[data-theme="dark"] {
  --bg: #0e2238;
  --surface: #16314d;
  --surface-2: #1d3d5e;
  --text: #e8f1fb;
  --muted: #a9c0d8;
  --line: #2f5276;
  --bord: #6e93b9;
  --accent: #4d8fe8;
  --accent-text: #06162b;
  --lien: #b9d4fa;
  --ok: #6fd99b;
  --ok-fond: #17402c;
  --err: #ff9285;
  --err-fond: #4d1f1c;
  --dernier: #ffc233;
  --bois: #a98a63;
  --bois-2: #957652;
  --bois-cadre: #4a2e14;
  --bois-filet: #7d5d3a;
  --bois-texte: #2a180a;
  --bois-grain: #5e3d1c;
  --trou: #4a2f16;
  --trou-centre: #24160a;
  --trou-bord: #2a180a;
  --repere: #ecdcb8;
  --carte-fond: #f7f2e4;
  --carte-bord: #0a1a2b;
  --ombre: 0 1px 4px rgba(0, 0, 0, 0.4);
  color-scheme: dark;
}

*, *::before, *::after { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: var(--texte);
  font-size: 16px;
  line-height: 1.55;
  -webkit-text-size-adjust: 100%;
}
.page {
  max-width: 800px;
  margin: 0 auto;
  padding-block: 28px 64px;
  padding-left: max(16px, env(safe-area-inset-left, 0px));
  padding-right: max(16px, env(safe-area-inset-right, 0px));
  display: flex;
  flex-direction: column;
  gap: 40px;
}
h1, h2, h3 { font-family: var(--titres); text-wrap: balance; margin: 0; line-height: 1.15; }
h1 { font-size: clamp(34px, 9vw, 52px); font-weight: 800; letter-spacing: -0.02em; }
h2 { font-size: clamp(23px, 5.6vw, 28px); font-weight: 800; letter-spacing: -0.01em; }
h3 { font-size: 18px; font-weight: 800; }
p { margin: 0; }
a { color: var(--lien); }
a:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; border-radius: 4px; }
strong { font-weight: 700; }

/* En-tête */
.entete { display: flex; flex-direction: column; gap: 12px; }
.surtitre { font-size: 13px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--lien); }
.chapeau { font-size: 18px; line-height: 1.5; max-width: 60ch; }
.sommaire { display: flex; flex-direction: row; flex-wrap: wrap; gap: 8px; padding: 0; margin: 6px 0 0; list-style: none; }
.sommaire a {
  display: block;
  padding: 6px 12px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 8px;
  color: var(--text);
  font-size: 14px;
  font-weight: 600;
  text-decoration: none;
}
.sommaire a:hover { border-color: var(--accent); }

/* Sections et blocs */
section { display: flex; flex-direction: column; gap: 14px; scroll-margin-top: 12px; }
.bloc {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}
.bloc > p, .bloc li, .ex-suite p, .ex-suite li { max-width: 68ch; }
.bloc h3 { margin-top: 4px; }
.bloc h3:first-child { margin-top: 0; }
ul, ol { margin: 0; padding-left: 1.25em; display: flex; flex-direction: column; gap: 6px; }
.note { color: var(--muted); font-size: 15px; }
.bref { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 12px; }
.bref .bloc { gap: 6px; }
.retenir { list-style: none; padding: 0; gap: 8px; }
.retenir li { display: flex; gap: 10px; align-items: baseline; }
.retenir li::before { content: ''; flex: none; width: 9px; height: 9px; border-radius: 50%; background: var(--pion-2); border: 1.5px solid var(--pion-2-fonce); translate: 0 -1px; }
.etapes { counter-reset: e; list-style: none; padding: 0; gap: 10px; }
.etapes > li { counter-increment: e; display: grid; grid-template-columns: 28px 1fr; gap: 10px; align-items: start; }
.etapes > li::before {
  content: counter(e);
  width: 28px; height: 28px; border-radius: 50%;
  display: grid; place-items: center;
  background: var(--accent); color: var(--accent-text);
  font-weight: 800; font-size: 15px; font-variant-numeric: tabular-nums;
}
.etapes > li > div { min-width: 0; display: flex; flex-direction: column; gap: 4px; padding-top: 2px; }

/* Cartes à jouer */
.c {
  display: inline-flex; align-items: baseline; gap: 1px;
  padding: 0 5px; margin: 0 1px;
  background: var(--carte-fond);
  border: 1.5px solid var(--carte-bord);
  border-radius: 5px;
  color: var(--carte-noire);
  font-size: 0.92em; line-height: 1.35; white-space: nowrap;
  vertical-align: baseline;
}
.c b { font-weight: 800; letter-spacing: -0.03em; }
.c i { font-style: normal; font-family: var(--cartes); }
.c.r { color: var(--carte-rouge); }
.c.j b { font-size: 0.82em; letter-spacing: 0.02em; text-transform: uppercase; }
.cj {
  position: relative; flex: none;
  display: block; width: 42px; height: 58px;
  background: var(--carte-fond);
  border: 1.5px solid var(--carte-bord);
  border-radius: 6px;
  box-shadow: var(--ombre);
  color: var(--carte-noire);
}
.cj.r { color: var(--carte-rouge); }
.cj b { position: absolute; top: 3px; left: 5px; font-size: 16px; line-height: 1; font-weight: 800; letter-spacing: -0.04em; }
.cj i { position: absolute; inset: 14px 0 0; display: grid; place-items: center; font-style: normal; font-family: var(--cartes); font-size: 26px; line-height: 1; }
.cj.j b { left: 0; right: 0; top: 5px; text-align: center; font-size: 8.5px; letter-spacing: 0.06em; }
.cj.j i { color: var(--carte-joker); font-size: 24px; }

/* Tableau des cartes */
.tableau { width: 100%; border-collapse: collapse; }
.tableau caption { text-align: left; color: var(--muted); font-size: 15px; padding-bottom: 8px; }
.tableau th, .tableau td { text-align: left; vertical-align: top; padding: 12px 0; border-top: 1px solid var(--line); }
.tableau thead th { border-top: 0; padding: 0 0 8px; font-size: 13px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); font-weight: 700; }
.tableau tbody th { width: 96px; padding-right: 12px; font-weight: 800; font-family: var(--titres); }
.tableau tbody th .nom { display: block; margin-top: 6px; font-size: 15px; line-height: 1.2; }
.tableau td p + p { margin-top: 6px; }
.tableau td .note { display: block; }

/* Légende numérotée du plateau */
.plateau-fig { display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; align-items: center; margin: 0; }
.plateau-fig .pl { max-width: 440px; margin: 0 auto; }
.legende { list-style: none; padding: 0; gap: 10px; }
.legende li { display: grid; grid-template-columns: 26px 1fr; gap: 10px; align-items: start; }
.legende .num {
  width: 26px; height: 26px; border-radius: 50%;
  display: grid; place-items: center;
  background: var(--pastille); color: var(--pastille-texte);
  border: 1.5px solid var(--pastille-texte);
  font-weight: 800; font-size: 14px;
}
.legende b { font-family: var(--titres); }
@media (min-width: 720px) {
  .plateau-fig { grid-template-columns: minmax(0, 11fr) minmax(0, 9fr); }
}

/* Exemples */
.ex {
  margin: 0;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 10px;
  overflow: hidden;
  display: flex; flex-direction: column;
  scroll-margin-top: 12px;
}
.ex-tete { background: var(--surface-2); border-bottom: 1px solid var(--line); padding: 12px 16px 14px; display: flex; flex-direction: column; gap: 4px; }
.ex-num { font-size: 12.5px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--lien); }
.ex-tete p:last-child { margin-top: 2px; max-width: 68ch; }
.volets { display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; padding: 16px 16px 4px; }
.volet { min-width: 0; display: flex; flex-direction: column; gap: 8px; }
.volet-titre { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 8px; font-size: 15px; line-height: 1.35; }
.tag {
  flex: none;
  padding: 1px 9px;
  border-radius: 999px;
  border: 1.5px solid var(--bord);
  font-size: 12.5px; font-weight: 800; letter-spacing: 0.04em; text-transform: uppercase;
  color: var(--text); background: var(--surface);
}
.tag.apres { background: var(--accent); border-color: var(--accent); color: var(--accent-text); }
.tag.non { background: var(--err-fond); border-color: var(--err); color: var(--err); }
.tag.oui { background: var(--ok-fond); border-color: var(--ok); color: var(--ok); }
.ex-suite { padding: 12px 16px 16px; display: flex; flex-direction: column; gap: 8px; }
.volets.un .pl { max-width: 420px; }
@media (min-width: 640px) {
  .volets.deux { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .volets.trois { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
.poses { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; padding: 14px 16px 0; }
.poses .pose { display: flex; align-items: center; gap: 8px; font-size: 14px; line-height: 1.25; }
.poses .egal { font-family: var(--titres); font-weight: 800; font-size: 20px; }

/* Plateau (SVG) */
.pl { display: block; width: 100%; height: auto; border-radius: 8px; font-family: var(--texte); }
.pl.ensemble { border-radius: 0; }
.pl .cadre { fill: var(--bois-cadre); }
.pl .tapis { fill: url(#g-bois); }
.pl .grain { fill: url(#g-grain); }
.pl .cadre-t { fill: var(--bois-cadre); stroke: var(--bois-cadre); stroke-width: 21.5; stroke-linejoin: round; }
.pl .tapis-t { fill: url(#g-bois); stroke: var(--bois); stroke-width: 14.5; stroke-linejoin: round; }
.pl .grain-t { fill: url(#g-grain); stroke: none; }
.pl .filet { fill: none; stroke: var(--bois-filet); stroke-opacity: 0.55; stroke-width: 0.5; }
.pl .trou { fill: url(#g-trou); stroke: var(--trou-bord); stroke-width: 0.38; }
.pl .repere { fill: var(--repere); stroke: var(--trou-bord); stroke-width: 0.45; }
.pl .zone { stroke: var(--trou-bord); stroke-width: 0.62; }
.pl .c0 { fill: var(--pion-0); } .pl .c1 { fill: var(--pion-1); } .pl .c2 { fill: var(--pion-2); } .pl .c3 { fill: var(--pion-3); }
.pl .ombre { fill: #000; opacity: 0.28; }
.pl .bille { stroke-width: 0.55; }
.pl .b0 { fill: var(--pion-0); stroke: var(--pion-0-fonce); }
.pl .b1 { fill: var(--pion-1); stroke: var(--pion-1-fonce); }
.pl .b2 { fill: var(--pion-2); stroke: var(--pion-2-fonce); }
.pl .b3 { fill: var(--pion-3); stroke: var(--pion-3-fonce); }
.pl .reflet { fill: #fff; opacity: 0.6; }
.pl .anneau { fill: none; stroke: var(--dernier); }
.pl .anneau.arrivee { stroke-width: 1.3; }
.pl .anneau.depart { stroke-width: 0.9; stroke-dasharray: 1.6 1.2; }
.pl .pas {
  font-size: 4.7px; font-weight: 800; text-anchor: middle; dominant-baseline: central;
  fill: var(--chiffre); stroke: var(--chiffre-bord); stroke-width: 1.15px; paint-order: stroke; stroke-linejoin: round;
  font-variant-numeric: tabular-nums;
}
.pl .prise circle { fill: var(--stop); stroke: var(--stop-barre); stroke-width: 0.45; }
.pl .prise path { fill: none; stroke: var(--stop-barre); stroke-width: 0.75; stroke-linecap: round; }
.pl .lib { font-size: 4.5px; font-weight: 700; fill: var(--bois-texte); }
.pl .lib.hors { fill: var(--text); }
.pl .lib.plus { font-size: 4.6px; font-weight: 800; }
.pl .lib.centre { font-size: 6.4px; }
.pl .rappel { stroke: var(--bois-texte); stroke-width: 0.45; stroke-linecap: round; }
.pl .rappel.fort { stroke: var(--pastille-texte); stroke-width: 0.7; }
.pl .fleche { fill: none; stroke: var(--bois-texte); stroke-width: 1; stroke-linecap: round; marker-end: url(#m-fleche); }
.pl .fleche.petite { stroke-width: 0.8; }
.pl .fleche.sens { stroke-width: 1.4; opacity: 0.85; }
.pl .stop circle { fill: var(--stop); stroke: var(--stop-barre); stroke-width: 0.5; }
.pl .stop rect { fill: var(--stop-barre); }
.pl .pastille circle { fill: var(--pastille); stroke: var(--pastille-texte); stroke-width: 0.8; }
.pl .pastille text { font-size: 6.6px; font-weight: 800; text-anchor: middle; dominant-baseline: central; fill: var(--pastille-texte); }
.pl .nom { font-size: 6.6px; font-weight: 700; fill: var(--text); dominant-baseline: central; }
.defs { position: absolute; width: 0; height: 0; overflow: hidden; }
.defs .s-bois { stop-color: var(--bois); } .defs .s-bois-2 { stop-color: var(--bois-2); }
.defs .s-trou { stop-color: var(--trou); } .defs .s-trou-centre { stop-color: var(--trou-centre); }
.defs .veine { fill: none; stroke: var(--bois-grain); stroke-width: 0.35; opacity: 0.16; }
.defs .pointe { fill: var(--bois-texte); }

.pied { color: var(--text); font-size: 14px; }
`;

const defs = `
<svg class="defs" aria-hidden="true" focusable="false">
  <defs>
    <radialGradient id="g-bois" cx="50%" cy="42%" r="70%"><stop offset="0" class="s-bois"/><stop offset="1" class="s-bois-2"/></radialGradient>
    <radialGradient id="g-trou" cx="50%" cy="35%" r="65%"><stop offset="0" class="s-trou-centre"/><stop offset="1" class="s-trou"/></radialGradient>
    <pattern id="g-grain" patternUnits="userSpaceOnUse" x="0" y="0" width="64" height="21">
      <path class="veine" d="M0 3 C16 1.4 32 4.8 48 3.2 S60 2.4 64 3"/>
      <path class="veine" d="M0 9.5 C12 11 26 8 40 9.8 S58 10.6 64 9.5"/>
      <path class="veine" d="M0 16.5 C20 15 30 18.2 44 16.4 S60 15.8 64 16.5"/>
    </pattern>
    <marker id="m-fleche" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path class="pointe" d="M0 0.8 L9.5 5 L0 9.2 Z"/></marker>
  </defs>
</svg>`;

const corps = `
<div class="page">

<header class="entete">
  <p class="surtitre">Jeu de pions et de cartes</p>
  <h1>Règles du Toc</h1>
  <p class="chapeau">Les petits chevaux, avec des cartes à la place du dé. À 4 en deux équipes, ou à 3 chacun pour soi.</p>
</header>

<section id="bref" aria-labelledby="t-bref">
  <h2 id="t-bref">En bref</h2>
  <div class="bloc">
    <ul class="retenir">
      <li><span><strong>But :</strong> sortir tes 4 pions de ta base, leur faire faire le tour et les rentrer dans ton allée. À 4, l'équipe qui rentre ses 8 pions gagne.</span></li>
      <li><span><strong>Ton tour :</strong> tu joues une carte et tu déplaces un pion. Puis c'est au joueur à ta gauche.</span></li>
      <li><span>Un pion ne sort de la base qu'avec un <strong>as</strong> ou un <strong>roi</strong>.</span></li>
      <li><span>Un pion qui s'arrête sur une case occupée <strong>renvoie l'autre à sa base</strong>.</span></li>
      <li><span>Si une carte est jouable, tu <strong>dois</strong> jouer. Sinon, tu en défausses une.</span></li>
    </ul>
  </div>
</section>

<section id="plateau" aria-labelledby="t-plateau">
  <h2 id="t-plateau">Le plateau</h2>
  <div class="bloc">
    <figure class="plateau-fig">
      ${figures.plateau}
      <ol class="legende">
        <li><span class="num">1</span><span><b>Ta base :</b> tes pions y attendent, un pion capturé y retourne.</span></li>
        <li><span class="num">2</span><span><b>Ta case de sortie :</b> au milieu de ton côté.</span></li>
        <li><span class="num">3</span><span><b>Ta case d'entrée :</b> 3 cases avant ta case de sortie.</span></li>
        <li><span class="num">4</span><span><b>Ton allée :</b> 4 cases, l'arrivée de tes pions.</span></li>
        <li><span class="num">5</span><span><b>Les repères :</b> un anneau clair sur la 6e et la 12e case après chaque sortie, pour compter.</span></li>
      </ol>
    </figure>
    <p class="note">72 cases, 18 d'une case de sortie à la suivante. On tourne dans le sens des aiguilles d'une montre. Dans les exemples, tu joues les bleus et ton partenaire les jaunes.</p>
  </div>
</section>

<section id="donne" aria-labelledby="t-donne">
  <h2 id="t-donne">Une donne</h2>
  <div class="bloc">
    <ol class="etapes">
      <li><div><strong>Distribution :</strong> 5 cartes chacun, puis 4, puis 4. Ensuite on mélange les 52 cartes et on recommence.</div></li>
      <li><div><strong>Échange :</strong> tu donnes une carte à ton partenaire, face cachée, et il t'en donne une.</div></li>
      <li><div><strong>Tours :</strong> chacun joue une carte à son tour, jusqu'à ce que les mains soient vides. Le premier joueur change à chaque donne.</div></li>
    </ol>
  </div>
</section>

<section id="cartes" aria-labelledby="t-cartes">
  <h2 id="t-cartes">Les cartes</h2>
  <div class="bloc">
    <table class="tableau">
      <thead><tr><th scope="col">Carte</th><th scope="col">Ce qu'elle fait</th></tr></thead>
      <tbody>
        <tr><th scope="row">${cj('AP')}<span class="nom">As</span></th><td><p><strong>Sort un pion</strong>, ou avance de <strong>1</strong> ou de <strong>11</strong>.</p></td></tr>
        <tr><th scope="row">${cj('RC')}<span class="nom">Roi</span></th><td><p><strong>Sort un pion</strong>, ou avance de <strong>13</strong>.</p></td></tr>
        <tr><th scope="row">${cj('DK')}<span class="nom">Dame</span></th><td><p>Avance de <strong>12</strong>.</p></td></tr>
        <tr><th scope="row">${cj('VT')}<span class="nom">Valet</span></th><td><p><strong>Échange</strong> un de tes pions avec un pion d'une autre couleur.</p></td></tr>
        <tr><th scope="row">${cj('9T')}<span class="nom">2, 3, 6, 8, 9, 10</span></th><td><p>Avance de sa valeur.</p></td></tr>
        <tr><th scope="row">${cj('7C')}<span class="nom">7</span></th><td><p><strong>7 points à partager</strong> entre tes pions, tous dépensés. Tout pion dépassé retourne à sa base.</p></td></tr>
        <tr><th scope="row">${cj('5K')}<span class="nom">5</span></th><td><p>Avance de <strong>5</strong>.</p><p class="note">Option « 5 adverse » : peut aussi avancer un pion adverse de 5.</p></td></tr>
        <tr><th scope="row">${cj('4P')}<span class="nom">4</span></th><td><p><strong>Recule</strong> de 4.</p></td></tr>
        <tr><th scope="row">${cj('J')}<span class="nom">Joker</span></th><td><p>À 3 joueurs : <strong>copie</strong> une carte posée pendant la donne.</p></td></tr>
      </tbody>
    </table>
  </div>
</section>

<section id="capturer" aria-labelledby="t-capturer">
  <h2 id="t-capturer">Capturer et protéger</h2>
  <div class="bloc">
    <ul>
      <li><strong>Capturer :</strong> ton pion s'arrête sur une case occupée, l'autre pion retourne à sa base. Même un des tiens ou un de ton partenaire.</li>
      <li><strong>Dépasser :</strong> en chemin, tu passes par-dessus les autres pions sans les capturer (sauf avec le 7).</li>
      <li><strong>Pion protégé :</strong> un pion sur sa propre case de sortie ne peut être ni dépassé, ni capturé, ni échangé par un autre joueur.</li>
      <li>Son propriétaire, lui, peut l'échanger avec son valet. S'il sort un nouveau pion, celui-ci renvoie l'ancien à la base.</li>
    </ul>
  </div>
  ${exemple({
    id: 'ex-capture',
    titre: 'Capturer en arrivant',
    situation: `Tu joues ${c('6T')}. Un pion rouge est 6 cases devant toi, un pion vert entre les deux.`,
    volets: [volet('Avant', '', '', figures.captureAvant), volet('Après', 'apres', '', figures.captureApres)],
    suite: `<p>Tu dépasses Vert sans le toucher et tu captures Rouge.</p>`,
  })}
  ${exemple({
    id: 'ex-protege',
    titre: 'Un pion protégé bloque le passage',
    situation: `Un pion rouge est sur sa case de sortie, 4 cases devant toi.`,
    volets: [
      volet('Interdit', 'non', `Avec ${c('6K')}`, figures.protegeNon),
      volet('Permis', 'oui', `Avec ${c('3T')}`, figures.protegeOui),
    ],
    suite: `<p>Le 6 le dépasserait : interdit. Le 3 s'arrête juste derrière : permis.</p>`,
  })}
</section>

<section id="valet-sept" aria-labelledby="t-valet-sept">
  <h2 id="t-valet-sept">Le valet et le 7</h2>
  <div class="bloc">
    <ul>
      <li><strong>Valet :</strong> un de tes pions contre un pion d'une autre couleur (adversaire ou partenaire), tous deux sur le circuit. Jamais le pion protégé d'un autre.</li>
      <li><strong>7 :</strong> tu partages les 7 points comme tu veux (7, 3 + 4, 1 + 1 + 5…). S'ils ne peuvent pas tous être dépensés, le 7 est injouable, même pour gagner.</li>
      <li>Le 7 renvoie à leur base <strong>tous les pions dépassés</strong>, les tiens compris. Il ne dépasse pas un pion protégé.</li>
    </ul>
  </div>
  ${exemple({
    id: 'ex-valet-sortie',
    titre: 'Le valet depuis ta case de sortie',
    situation: `Tu joues ${c('VP')}. Ton pion est sur ta case de sortie, un pion vert juste avant ta case d'entrée.`,
    volets: [volet('Avant', '', '', figures.valetSortieAvant), volet('Après', 'apres', '', figures.valetSortieApres)],
    suite: `<p>Ton pion est protégé, mais c'est le tien : tu peux l'échanger. Te voilà devant ton allée. Vert, lui, n'aurait pas pu prendre ton pion.</p>`,
  })}
  ${exemple({
    id: 'ex-sept-allee',
    titre: 'Un 7 partagé en 1 + 1 + 1 + 4',
    situation: `Tu joues ${c('7C')}. Trois de tes pions sont dans l'allée, le dernier 3 cases avant ta case d'entrée, derrière un pion rouge.`,
    classe: 'trois',
    volets: [
      volet('Avant', '', "d'abord 1 + 1 + 1", figures.sept1),
      volet('Ensuite', '', 'les 4 points restants', figures.sept2),
      volet('Après', 'apres', '', figures.sept3),
    ],
    suite: `<p>Chaque pion de l'allée monte d'une case, puis le dernier rentre avec les 4 points restants. Rouge, dépassé, retourne à sa base.</p>`,
  })}
  ${exemple({
    id: 'ex-sept-injouable',
    titre: 'Un 7 injouable',
    situation: `Deux pions au fond de l'allée, un troisième à l'entrée de l'allée, le dernier à la base.`,
    classe: 'un',
    volets: [volet('Injouable', 'non', '1 point possible sur 7', figures.septInjouable)],
    suite: `<p>Tu ne peux dépenser qu'un point sur 7 : le 7 est injouable.</p>`,
  })}
</section>

<section id="allee" aria-labelledby="t-allee">
  <h2 id="t-allee">L'allée</h2>
  <div class="bloc">
    <ul>
      <li><strong>Entrer dans l'allée :</strong> ton pion s'arrête sur la case de l'allée où la carte le mène, pas forcément au fond. Il ne dépasse jamais le fond : avec une carte trop grande, il continue sur le circuit.</li>
      <li>Dans l'allée, on ne dépasse pas et on ne recule pas. Un pion y est à l'abri.</li>
      <li>Entrer n'est jamais obligatoire.</li>
    </ul>
  </div>
  ${exemple({
    id: 'ex-quatre-cinq',
    titre: 'Le raccourci : un 4, puis un 5',
    situation: `Ton pion vient de sortir. Tu joues ${c('4C')}, puis ${c('5K')} à un tour suivant.`,
    classe: 'trois',
    volets: [
      volet('Le 4', '', 'ton pion recule de 4', figures.qc1),
      volet('Le 5', '', 'il avance de 5', figures.qc2),
      volet('Après', 'apres', '', figures.qc3),
    ],
    suite: `<p>Le 4 t'amène une case après ta case d'entrée. Le 5 te mène au fond de l'allée, sans faire le tour.</p>`,
  })}
</section>

<section id="fin" aria-labelledby="t-fin">
  <h2 id="t-fin">Fin de partie</h2>
  <div class="bloc">
    <ul>
      <li>L'équipe qui rentre ses <strong>8 pions</strong> gagne.</li>
      <li>Quand tes 4 pions sont rentrés, tes cartes déplacent <strong>les pions de ton partenaire</strong>.</li>
      <li>Si tu rentres ton dernier pion pendant un 7, les points qui restent vont aux pions de ton partenaire.</li>
    </ul>
  </div>
</section>

<section id="trois" aria-labelledby="t-trois">
  <h2 id="t-trois">À 3 joueurs</h2>
  <div class="bloc">
    <figure class="plateau-fig">
      ${figures.triangle}
      <ul class="legende trois">
        <li><span class="num">▲</span><span><b>Chacun pour soi</b> sur un triangle de 54 cases. Le premier qui rentre ses 4 pions gagne.</span></li>
      </ul>
    </figure>
    <ul>
      <li>54 cartes, dont <strong>2 jokers</strong>. Donnes de 5, 4, 4 puis 5 cartes.</li>
      <li>À chaque donne, tu donnes une carte à un voisin : à gauche à la 1re donne, à droite à la 2e, et ainsi de suite.</li>
      <li><strong>Joker :</strong> il copie une carte jouée ou défaussée depuis le début de la donne. Copier un joker, c'est copier ce qu'il avait copié. Rien à copier : il est injouable.</li>
    </ul>
  </div>
  <figure class="ex" id="ex-joker">
    <figcaption class="ex-tete">
      <p class="ex-num">Exemple ${++numero}</p>
      <h3>Le joker copie un roi</h3>
      <p>Rouge a joué ${c('RC')}, Jaune ${c('9T')}. Tes 4 pions sont à la base et tu n'as ni as ni roi.</p>
    </figcaption>
    <div class="poses" aria-label="Cartes posées depuis le début de la donne">
      <span class="pose">${cj('RC')}<span>posé par<br>Rouge</span></span>
      <span class="pose">${cj('9T')}<span>posé par<br>Jaune</span></span>
      <span class="pose"><span class="egal" aria-hidden="true">→</span>${cj('J')}<span>ton joker<br>vaut un roi ou un 9</span></span>
    </div>
    <div class="volets deux">
      ${volet('Avant', '', '', figures.jokerAvant)}
      ${volet('Après', 'apres', 'joker joué comme un roi', figures.jokerApres)}
    </div>
    <div class="ex-suite">
      <p>Ton joker copie le roi : tu sors un pion.</p>
    </div>
  </figure>
</section>

</div>`;

const page = `<title>Règles du Toc</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>${css}</style>
${defs}
${corps}
`;

if (/[—–]/.test(page)) {
  console.error('Tiret long trouvé dans la page.');
  process.exit(1);
}
const PAGES = process.env.SORTIE_PAGES;
if (PAGES) {
  writeFileSync(join(PAGES, 'regles-toc.html'), page);
  console.log(`regles-toc.html écrit (${(page.length / 1024).toFixed(1)} Ko), ${numero} exemples.`);
}

// ─── Infographies d'une page : trois propositions ───────────────────────────

const cssInfo = `
.page.large { max-width: 1060px; gap: 34px; }
.variante { display: flex; flex-direction: column; gap: 12px; }
.variante-titre { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.variante-titre .lettre { font-family: var(--titres); font-weight: 800; font-size: 15px; color: var(--accent-text); background: var(--accent); border-radius: 6px; padding: 1px 9px; }
.variante-titre h2 { font-size: 21px; }
.variante-titre p { color: var(--muted); font-size: 15px; }
.feuille { background: var(--surface); border: 2px solid var(--bord); border-radius: 16px; padding: clamp(14px, 3vw, 24px); display: flex; flex-direction: column; gap: 18px; min-width: 0; }
.f-tete { display: flex; flex-direction: column; gap: 6px; }
.f-tete .f-titre { font-family: var(--titres); font-weight: 800; font-size: clamp(26px, 5vw, 36px); line-height: 1.1; letter-spacing: -0.02em; }
.f-tete .f-but { font-size: 17px; max-width: 70ch; }
.f-tete .f-but b { font-family: var(--titres); }
.a-grille { display: grid; grid-template-columns: minmax(0, 1fr); gap: 20px; align-items: center; }
.a-plateau { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.a-plateau .pl { max-width: 480px; margin: 0 auto; }
.mini-legende { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: row; flex-wrap: wrap; justify-content: center; gap: 6px 14px; font-size: 14.5px; }
.mini-legende li { display: flex; align-items: center; gap: 6px; }
.puce-num { width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; background: var(--pastille); color: var(--pastille-texte); border: 1.5px solid var(--pastille-texte); font-weight: 800; font-size: 12.5px; flex: none; }
.rangees { display: flex; flex-direction: column; gap: 7px; min-width: 0; }
.rangee-carte { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 14px; align-items: center; }
.rangee-carte .cartes { display: flex; gap: 4px; }
.rangee-carte p { font-size: 15.5px; line-height: 1.35; }
.rangee-carte b { font-family: var(--titres); }
.or { display: grid; grid-template-columns: repeat(auto-fit, minmax(165px, 1fr)); gap: 10px; }
.or > div { border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; background: var(--surface-2); display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.or b { font-family: var(--titres); font-size: 15.5px; }
.or span { font-size: 14.5px; line-height: 1.35; color: var(--muted); }
.bandeau-3 { border-top: 1px dashed var(--line); padding-top: 12px; font-size: 15px; }
.bandeau-3 b { font-family: var(--titres); }
.tuiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(255px, 1fr)); gap: 12px; }
.tuile { border: 1px solid var(--line); border-radius: 12px; padding: 12px; display: flex; flex-direction: column; gap: 9px; background: var(--surface-2); min-width: 0; }
.tuile-tete { display: flex; align-items: center; gap: 10px; }
.tuile-tete .cartes { display: flex; gap: 4px; flex: none; }
.tuile-tete h3 { font-size: 19px; }
.tuile p { font-size: 15px; line-height: 1.4; }
.tuile .pl { margin-top: auto; }
.etape-num { width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center; background: var(--accent); color: var(--accent-text); font-family: var(--titres); font-weight: 800; font-size: 16px; flex: none; }
.cartes-mini { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 8px 14px; border-top: 1px dashed var(--line); padding-top: 14px; }
.cartes-mini div { display: flex; align-items: center; gap: 9px; font-size: 14.5px; line-height: 1.25; min-width: 0; }
.feuille .donne > div, .feuille .tuile { background: none; border: 0; border-radius: 0; padding: 0; }
.feuille .donne, .feuille .tuiles { gap: 22px 26px; }
.feuille .f-section { border-top: 1px solid var(--line); padding-top: 14px; }
.f-section { font-family: var(--titres); font-weight: 800; font-size: 13px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--lien); }
.donne { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 10px; }
.donne > div { border: 1px solid var(--line); border-radius: 12px; padding: 12px; background: var(--surface-2); display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.donne .tuile-tete h3 { font-size: 18px; }
.donne p { font-size: 15px; line-height: 1.4; }
.donne p.chiffres { display: flex; align-items: baseline; gap: 10px; font-family: var(--titres); font-weight: 800; font-size: 34px; line-height: 1; color: var(--accent); }
.donne p.chiffres small { font-size: 14px; font-weight: 700; color: var(--muted); }
.ech { display: block; width: 100%; max-width: 210px; height: auto; margin: 0 auto; font-family: var(--texte); }
.ech .siege { stroke-width: 1.4; }
.ech .s0 { fill: var(--pion-0); stroke: var(--pion-0-fonce); }
.ech .s1 { fill: var(--pion-1); stroke: var(--pion-1-fonce); }
.ech .s2 { fill: var(--pion-2); stroke: var(--pion-2-fonce); }
.ech .s3 { fill: var(--pion-3); stroke: var(--pion-3-fonce); }
.ech .trait { fill: none; stroke: var(--text); stroke-width: 2; stroke-linecap: round; }
.ech .pointe { fill: var(--text); }
.ech .dos { fill: var(--accent); stroke: var(--carte-fond); stroke-width: 1; }
.ech text { font-size: 8.5px; font-weight: 700; fill: var(--text); text-anchor: middle; }
.trois { border-top: 1px dashed var(--line); padding-top: 14px; display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; align-items: center; }
.trois p { font-size: 15px; line-height: 1.45; }
.trois b { font-family: var(--titres); }
.trois .paires { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.trois figure { margin: 0; display: flex; flex-direction: column; gap: 4px; align-items: center; }
.trois figcaption { font-size: 13.5px; line-height: 1.3; text-align: center; color: var(--muted); }
.trois figcaption b { color: var(--text); }
@media (min-width: 840px) {
  .a-grille { grid-template-columns: minmax(0, 1.02fr) minmax(0, 1fr); }
  .trois { grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr); }
}
`;

// Schémas des échanges de cartes : qui donne à qui (une flèche = une carte donnée, face cachée).
function flecheEch(x1, y1, x2, y2, retrait = 13, ou = 0.5) {
  const d = Math.hypot(x2 - x1, y2 - y1);
  const ux = (x2 - x1) / d;
  const uy = (y2 - y1) / d;
  const ax = x1 + ux * retrait;
  const ay = y1 + uy * retrait;
  const bx = x2 - ux * (retrait + 4);
  const by = y2 - uy * (retrait + 4);
  const px = x2 - ux * retrait;
  const py = y2 - uy * retrait;
  const nx = -uy;
  const ny = ux;
  const mx = ax + (bx - ax) * ou;
  const my = ay + (by - ay) * ou;
  const angle = (Math.atan2(uy, ux) * 180) / Math.PI;
  return (
    `<path class="trait" d="M${n2(ax)} ${n2(ay)} L${n2(bx)} ${n2(by)}"/>` +
    `<path class="pointe" d="M${n2(px)} ${n2(py)} L${n2(bx + nx * 4)} ${n2(by + ny * 4)} L${n2(bx - nx * 4)} ${n2(by - ny * 4)} Z"/>` +
    `<rect class="dos" x="${n2(mx - 3.4)}" y="${n2(my - 4.8)}" width="6.8" height="9.6" rx="1.3" transform="rotate(${n2(angle + 90)} ${n2(mx)} ${n2(my)})"/>`
  );
}
const siegeEch = (i, x, y, nom, dy = 17) => `<circle class="siege s${i}" cx="${x}" cy="${y}" r="8"/>${nom ? `<text x="${x}" y="${y + dy}">${nom}</text>` : ''}`;
const decaler = (x1, y1, x2, y2, k) => {
  const d = Math.hypot(x2 - x1, y2 - y1);
  const nx = (-(y2 - y1) / d) * k;
  const ny = ((x2 - x1) / d) * k;
  return [x1 + nx, y1 + ny, x2 + nx, y2 + ny];
};
// À 4 : chacun échange avec son partenaire, en face.
const echange4 = (() => {
  const B = [70, 106];
  const J = [70, 24];
  const R = [14, 65];
  const V = [126, 65];
  return (
    `<svg class="ech" viewBox="0 0 140 128" role="img" aria-label="À 4 joueurs, chacun échange une carte avec son partenaire assis en face.">` +
    flecheEch(...decaler(...B, ...J, 5), 13, 0.2) + flecheEch(...decaler(...J, ...B, 5), 13, 0.2) +
    flecheEch(...decaler(...R, ...V, 5), 13, 0.2) + flecheEch(...decaler(...V, ...R, 5), 13, 0.2) +
    siegeEch(0, ...B, 'Toi') + siegeEch(2, ...J, '') + siegeEch(1, ...R, '') + siegeEch(3, ...V, '') +
    `<text x="70" y="11">Ton partenaire</text>` +
    '</svg>'
  );
})();
// À 3 : la carte va au voisin de gauche (donnes 1, 3, 5…) ou de droite (donnes 2, 4, 6…).
const echange3 = (versGauche) => {
  const B = [70, 92];
  const R = [22, 20];
  const J = [118, 20];
  const tour = versGauche ? [[B, R], [R, J], [J, B]] : [[B, J], [J, R], [R, B]];
  return (
    `<svg class="ech" viewBox="0 0 140 112" role="img" aria-label="${versGauche ? 'Donnes 1, 3, 5 : chacun donne une carte à son voisin de gauche.' : 'Donnes 2, 4, 6 : chacun donne une carte à son voisin de droite.'}">` +
    tour.map(([p, q]) => flecheEch(...p, ...q)).join('') +
    siegeEch(0, ...B, 'Toi') + siegeEch(1, ...R, '') + siegeEch(2, ...J, '') +
    '</svg>'
  );
};


const cartes2 = (...liste) => `<span class="cartes">${liste.map(cj).join('')}</span>`;
const rangee = (liste, texte) => `<div class="rangee-carte">${cartes2(...liste)}<p>${texte}</p></div>`;
const tuile = ({ cartes = [], etape = 0, titre, texte, figure = '' }) =>
  `<div class="tuile"><div class="tuile-tete">${etape ? `<span class="etape-num">${etape}</span>` : ''}${cartes.length ? cartes2(...cartes) : ''}<h3>${titre}</h3></div><p>${texte}</p>${figure}</div>`;
const mini = (carte, texte) => `<div>${cj(carte)}<span>${texte}</span></div>`;

const TETE = `<div class="f-tete"><h1 class="f-titre">Le Toc en une page</h1><p class="f-but"><b>But :</b> rentrer tous les pions de ton équipe.</p></div>`;
const TROIS = `<p class="bandeau-3"><b>À 3 joueurs :</b> chacun pour soi sur un plateau en triangle, 54 cartes dont 2 jokers. Le joker copie une carte jouée ou défaussée depuis le début de la donne. La carte échangée va au voisin de gauche, puis de droite à la donne suivante.</p>`;
const OR = `<div class="or">
  <div><b>Jouer est obligatoire</b><span>Aucune carte jouable ? Tu en défausses une.</span></div>
  <div><b>Capturer</b><span>T'arrêter sur un pion le renvoie à sa base.</span></div>
  <div><b>Pion protégé</b><span>Sur sa case de sortie, il ne se dépasse pas et ne se capture pas.</span></div>
  <div><b>Allée</b><span>Ton pion peut s'arrêter avant le fond, jamais le dépasser.</span></div>
  <div><b>Échange</b><span>À chaque donne, une carte à ton partenaire.</span></div>
</div>`;

const infoA = `
<section class="variante" id="a">
  <div class="feuille">
    ${TETE}
    <div class="a-grille">
      <div class="a-plateau">
        ${figures.plateau}
        <ol class="mini-legende">
          <li><span class="puce-num">1</span>Base</li>
          <li><span class="puce-num">2</span>Case de sortie</li>
          <li><span class="puce-num">3</span>Case d'entrée</li>
          <li><span class="puce-num">4</span>Allée</li>
          <li><span class="puce-num">5</span>Repères pour compter</li>
        </ol>
      </div>
      <div class="rangees">
        ${rangee(['AP'], '<b>Sort un pion</b>, ou avance de 1 ou de 11.')}
        ${rangee(['RC'], '<b>Sort un pion</b>, ou avance de 13.')}
        ${rangee(['DK'], 'Avance de <b>12</b>.')}
        ${rangee(['9T'], '2, 3, 6, 8, 9, 10 : avance de <b>sa valeur</b>.')}
        ${rangee(['5K'], 'Avance de <b>5</b>.')}
        ${rangee(['4P'], '<b>Recule</b> de 4.')}
        ${rangee(['VT'], '<b>Échange</b> un de tes pions avec un autre pion.')}
        ${rangee(['7C'], '<b>7 points à partager</b> entre tes pions, tous dépensés. Tout pion dépassé retourne à sa base.')}
      </div>
    </div>

    <p class="f-section">Une donne</p>
    <div class="donne">
      <div>
        <div class="tuile-tete"><span class="etape-num">1</span><h3>Distribution</h3></div>
        <p class="chiffres">5 <small>puis</small> 4 <small>puis</small> 4</p>
        <p>cartes chacun. Ensuite on mélange les 52 cartes et on recommence.</p>
      </div>
      <div>
        <div class="tuile-tete"><span class="etape-num">2</span><h3>Échange de cartes</h3></div>
        ${echange4}
        <p>Avant de jouer, tu donnes une carte à ton partenaire, face cachée, et il t'en donne une.</p>
      </div>
      <div>
        <div class="tuile-tete"><span class="etape-num">3</span><h3>Les tours</h3></div>
        <p>Chacun joue une carte à son tour, jusqu'à ce que les mains soient vides.</p>
        <p><b>Jouer est obligatoire.</b> Si aucune de tes cartes n'est jouable, tu en défausses une.</p>
        <p><b>T'arrêter sur un pion</b> le renvoie à sa base.</p>
      </div>
    </div>

    <p class="f-section">Trois situations à connaître</p>
    <div class="tuiles">
      ${tuile({ titre: 'Échanger', texte: "Le valet échange un de tes pions avec un autre pion du circuit. Ton pion peut partir de ta case de sortie.", figure: figures.valetSortieAvant })}
      ${tuile({ titre: 'Pion protégé', texte: "Sur sa case de sortie, un pion ne se dépasse pas et ne se capture pas. Seul son propriétaire peut l'échanger.", figure: figures.protegeNon })}
      ${tuile({ titre: "Rentrer dans l'allée", texte: "Ton pion s'arrête là où la carte le mène, pas forcément au fond. Carte trop grande : il continue sur le circuit. On n'entre pas avec un 4, qui fait reculer, et on ne dépasse pas un pion dans l'allée. Entrer n'est jamais obligatoire.", figure: figures.allee3 })}
    </div>

    <div class="trois">
      <p><b>À 3 joueurs :</b> chacun pour soi sur un plateau en triangle, avec 54 cartes dont 2 jokers. Le premier qui rentre ses 4 pions gagne. Le <b>joker</b> copie une carte jouée ou défaussée depuis le début de la donne. L'échange de cartes se fait avec un voisin, en alternant à chaque donne.</p>
      <div class="paires">
        <figure>${echange3(true)}<figcaption><b>Donnes 1, 3, 5…</b><br>au voisin de gauche</figcaption></figure>
        <figure>${echange3(false)}<figcaption><b>Donnes 2, 4, 6…</b><br>au voisin de droite</figcaption></figure>
      </div>
    </div>
  </div>
</section>`;

const infoB = `
<section class="variante" id="b">
  <div class="variante-titre"><span class="lettre">B</span><h2>Carte par carte</h2><p>Une vignette par carte, avec un schéma de ce qu'elle fait.</p></div>
  <div class="feuille">
    ${TETE}
    <div class="tuiles">
      ${tuile({ cartes: ['AP', 'RC'], titre: 'Sortir', texte: "Un as ou un roi pose un pion sur ta case de sortie. Sinon : as = 1 ou 11, roi = 13.", figure: figures.sortieApres })}
      ${tuile({ cartes: ['DK', '9T'], titre: 'Avancer', texte: "Dame = 12, les autres leur valeur. T'arrêter sur un pion le renvoie à sa base.", figure: figures.captureAvant })}
      ${tuile({ cartes: ['4P', '5K'], titre: 'Reculer, puis rentrer', texte: 'Le 4 recule de 4. Depuis ta case de sortie, un 4 puis un 5 mènent au fond de ton allée.', figure: figures.qc1 })}
      ${tuile({ cartes: ['VT'], titre: 'Échanger', texte: "Un de tes pions contre un pion d'une autre couleur, tous deux sur le circuit.", figure: figures.valetAvant })}
      ${tuile({ cartes: ['7C'], titre: 'Partager 7 points', texte: 'Entre tes pions, tous dépensés. Les pions dépassés retournent à leur base.', figure: figures.sept2 })}
      ${tuile({ titre: 'Pion protégé', texte: "Sur sa case de sortie, un pion ne se dépasse pas et ne se capture pas. Seul son propriétaire peut l'échanger.", figure: figures.protegeNon })}
    </div>
    <div class="or">
      <div><b>Jouer est obligatoire</b><span>Aucune carte jouable ? Tu en défausses une.</span></div>
      <div><b>Allée</b><span>Ton pion peut s'arrêter avant le fond, jamais le dépasser.</span></div>
      <div><b>Échange</b><span>À chaque donne, une carte à ton partenaire.</span></div>
    </div>
    ${TROIS}
  </div>
</section>`;

const infoC = `
<section class="variante" id="c">
  <div class="variante-titre"><span class="lettre">C</span><h2>Le parcours d'un pion</h2><p>Cinq étapes, de la base au fond de l'allée, puis l'aide-mémoire des cartes.</p></div>
  <div class="feuille">
    ${TETE}
    <div class="tuiles">
      ${tuile({ etape: 1, titre: 'Sortir', texte: 'Un as ou un roi pose un pion sur ta case de sortie. Il y est protégé.', figure: figures.sortieApres })}
      ${tuile({ etape: 2, titre: 'Avancer', texte: "Chaque carte avance un pion de sa valeur. T'arrêter sur un pion le renvoie à sa base.", figure: figures.captureAvant })}
      ${tuile({ etape: 3, titre: 'Se méfier', texte: 'Un pion sur sa case de sortie bloque le passage : on ne le dépasse pas.', figure: figures.protegeNon })}
      ${tuile({ etape: 4, titre: 'Rentrer', texte: "Ton pion s'arrête dans l'allée là où la carte le mène, pas forcément au fond. Entrer n'est jamais obligatoire.", figure: figures.allee5 })}
      ${tuile({ etape: 5, titre: 'Gagner', texte: 'Tes 4 pions rentrés, tu joues pour ton partenaire. À 8 pions rentrés, votre équipe gagne.', figure: figures.alleePleine })}
      ${tuile({ titre: 'À savoir', texte: "Jouer est obligatoire : sans carte jouable, tu en défausses une. À chaque donne, tu donnes une carte à ton partenaire." })}
    </div>
    <div class="cartes-mini">
      ${mini('AP', 'Sort un pion, ou 1 ou 11')}
      ${mini('RC', 'Sort un pion, ou 13')}
      ${mini('DK', 'Avance de 12')}
      ${mini('9T', '2, 3, 6, 8, 9, 10 : sa valeur')}
      ${mini('5K', 'Avance de 5')}
      ${mini('4P', 'Recule de 4')}
      ${mini('VT', 'Échange deux pions')}
      ${mini('7C', '7 points à partager')}
    </div>
    ${TROIS}
  </div>
</section>`;

const pageInfo = `<title>Le Toc en une page</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>${css}${cssInfo}</style>
${defs}
<div class="page large">
${infoA}
</div>
`;
if (/[—–]/.test(pageInfo)) {
  console.error('Tiret long trouvé dans les infographies.');
  process.exit(1);
}
if (PAGES) {
  writeFileSync(join(PAGES, 'infographies-toc.html'), pageInfo);
  console.log(`infographies-toc.html écrit (${(pageInfo.length / 1024).toFixed(1)} Ko).`);
}

// ─── Page Règles de l'appli : la même infographie, en fragment HTML et en feuille de style à portée limitée ───

/** Découpe une feuille de style en blocs de premier niveau : [{ tete, corps }]. */
function blocsCss(texte) {
  const blocs = [];
  let i = 0;
  const sansCommentaires = texte.replace(/\/\*[\s\S]*?\*\//g, '');
  while (i < sansCommentaires.length) {
    const ouvre = sansCommentaires.indexOf('{', i);
    if (ouvre < 0) break;
    let profondeur = 1;
    let j = ouvre + 1;
    while (j < sansCommentaires.length && profondeur) {
      if (sansCommentaires[j] === '{') profondeur++;
      else if (sansCommentaires[j] === '}') profondeur--;
      j++;
    }
    blocs.push({ tete: sansCommentaires.slice(i, ouvre).trim(), corps: sansCommentaires.slice(ouvre + 1, j - 1) });
    i = j;
  }
  return blocs;
}

const PORTEE = '.regles-info';
/** Réécrit un sélecteur pour qu'il ne s'applique qu'à l'intérieur de la page Règles ; null = règle à écarter. */
function sousPortee(selecteur) {
  const s = selecteur.trim();
  if (s === ':root') return PORTEE;
  if (/^:root\[data-theme=["']dark["']\]$/.test(s)) return `:root[data-theme='dark'] ${PORTEE}`;
  if (s.startsWith(':root') || s === 'body' || s === 'html' || s.startsWith('*') || s.startsWith('.page') || s.startsWith('.variante')) return null;
  return `${PORTEE} ${s}`;
}
function porterCss(texte) {
  let sortie = '';
  for (const { tete, corps } of blocsCss(texte)) {
    if (tete.startsWith('@media')) {
      // L'appli pose toujours data-theme sur <html> : le bloc « thème du système » ne sert pas.
      if (tete.includes('prefers-color-scheme')) continue;
      // La page de l'appli n'occupe pas toute la fenêtre : on se règle sur sa largeur à elle.
      const largeur = /min-width:\s*(\d+)px/.exec(tete);
      const dedans = porterCss(corps);
      if (!dedans.trim()) continue;
      sortie += largeur ? `@container regles (min-width: ${Math.round(largeur[1] * 0.86)}px) {\n${dedans}}\n` : `${tete} {\n${dedans}}\n`;
      continue;
    }
    if (tete.startsWith('@')) {
      sortie += `${tete} {${corps}}\n`;
      continue;
    }
    const selecteurs = tete.split(',').map(sousPortee).filter(Boolean);
    if (selecteurs.length) sortie += `${selecteurs.join(',\n')} {${corps}}\n`;
  }
  return sortie;
}

const APPLI = process.env.SORTIE_APPLI;
if (APPLI) {
  const feuille = infoA
    .replace(TETE, `<p class="f-but"><b>But :</b> rentrer tous les pions de ton équipe.</p>`)
    .replace(/^\s*<section class="variante" id="a">/, '')
    .replace(/<\/section>\s*$/, '');
  const html = `${defs}${feuille}`.replace(/\n\s*/g, '\n').trim();
  // « --texte » est déjà la taille du texte dans l'appli : la police des schémas change de nom.
  const style =
    `/* Page Règles : « Le Toc en une page ». Fichier généré par outils/regles/construire.mjs, ne pas le modifier à la main. */\n` +
    `${PORTEE} { container: regles / inline-size; color: var(--text); font-size: 16px; line-height: 1.5; }\n` +
    porterCss(css + cssInfo).replaceAll('--texte', '--police-texte') +
    `${PORTEE} { --titres: inherit; --police-texte: inherit; }\n` +
    `${PORTEE} .feuille { border-width: 1px; border-color: var(--line); border-radius: 12px; }\n`;
  if (/[—–]/.test(html)) {
    console.error('Tiret long trouvé dans la page Règles.');
    process.exit(1);
  }
  // Les classes de la page reçoivent un préfixe : aucune ne peut alors croiser une classe de l'appli
  // (« feuille », « note », « tuile »… existent des deux côtés).
  const prefixer = (nom) => (nom === PORTEE.slice(1) ? nom : 'ri-' + nom);
  const stylePrefixe = style.replace(/\.([A-Za-z][\w-]*)/g, (_, nom) => '.' + prefixer(nom));
  const htmlPrefixe = html.replace(/class="([^"]*)"/g, (_, liste) => `class="${liste.split(/\s+/).filter(Boolean).map(prefixer).join(' ')}"`);
  writeFileSync(
    join(APPLI, 'js/ui/regles-page.js'),
    `// Page Règles : « Le Toc en une page ». Fichier généré par outils/regles/construire.mjs, ne pas le modifier à la main.\n` +
      `export const HTML_REGLES = ${JSON.stringify(htmlPrefixe)};\n`,
  );
  writeFileSync(join(APPLI, 'css/regles.css'), stylePrefixe);
  console.log(`Page Règles de l'appli écrite dans ${APPLI} (HTML ${(html.length / 1024).toFixed(1)} Ko, CSS ${(style.length / 1024).toFixed(1)} Ko).`);
}
