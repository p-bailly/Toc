// Dessins à colorier des quatre coins du plateau carré, tracés « au crayon » comme les logos de Nimbus : un trait
// sombre un peu tremblé, repassé une seconde fois plus léger. Chaque dessin dit aussi quelles zones se colorient :
// le plateau les peint de la couleur des pions du joueur (zones hachurées, zones pleines), la neige reste blanche.
//
//   node outils/coloriages/generer.mjs            écrit public/js/ui/coloriages.js
//   SORTIE=/un/dossier node outils/coloriages/generer.mjs   écrit aussi coloriages.html (planche de relecture)
//
// Chaque dessin tient dans un carré de COTE unités (y vers le bas). Il se décrit avec des traits simples (ligne
// brisée, courbe, cercle) ; le tremblé est tiré d'une graine fixe : le fichier produit ne change pas d'une fois à l'autre.

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const COTE = 40;

// ─── Tremblé ────────────────────────────────────────────────────────────────

function hasard(graine) {
  let a = graine >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Points régulièrement espacés (≈ `pas`) le long d'une ligne brisée. */
function echantillonner(points, pas) {
  const sortie = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i - 1];
    const [x2, y2] = points[i];
    const n = Math.max(1, Math.round(Math.hypot(x2 - x1, y2 - y1) / pas));
    for (let k = 1; k <= n; k++) sortie.push([x1 + ((x2 - x1) * k) / n, y1 + ((y2 - y1) * k) / n]);
  }
  return sortie;
}

/**
 * Déplace chaque point d'un petit écart qui varie lentement le long du trait (la main qui tremble), nul aux deux
 * bouts d'un trait fermé pour qu'il se referme.
 */
function trembler(points, rng, amplitude, ferme) {
  const n = points.length;
  const ondes = [0, 1, 2].map((k) => ({ f: (0.5 + rng() * 1.4) * (k + 1), p: rng() * 6.283, a: amplitude / (k + 1) }));
  const ecart = (t, d) => ondes.reduce((s, o) => s + o.a * Math.sin(o.f * t * 6.283 + o.p + d), 0);
  return points.map(([x, y], i) => {
    const t = n > 1 ? i / (n - 1) : 0;
    const bord = ferme ? Math.sin(Math.PI * t) : 1;
    return [x + ecart(t, 0) * bord, y + ecart(t, 1.9) * bord];
  });
}

const n1 = (v) => String(Math.round(v * 10) / 10);
const chemin = (points, ferme) => 'M' + points.map(([x, y]) => `${n1(x)} ${n1(y)}`).join('L') + (ferme ? 'Z' : '');

// ─── Traits ─────────────────────────────────────────────────────────────────

/** Ligne brisée. */
const ligne = (...points) => ({ points, ferme: false });
/** Contour fermé. */
const contour = (...points) => ({ points, ferme: true });
/** Courbe de Bézier quadratique de A à C, tirée vers B. */
function courbe([x1, y1], [xb, yb], [x2, y2], n = 10) {
  const points = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    points.push([(1 - t) ** 2 * x1 + 2 * (1 - t) * t * xb + t ** 2 * x2, (1 - t) ** 2 * y1 + 2 * (1 - t) * t * yb + t ** 2 * y2]);
  }
  return { points, ferme: false };
}
/** Arc de cercle (angles en degrés, 0 à droite, sens des aiguilles d'une montre à l'écran) ; cercle entier par défaut. */
function arc(cx, cy, r, de = 0, a = 360, ry = r) {
  const n = Math.max(6, Math.round((Math.abs(a - de) / 360) * 30));
  const points = [];
  for (let i = 0; i <= n; i++) {
    const t = ((de + ((a - de) * i) / n) * Math.PI) / 180;
    points.push([cx + r * Math.cos(t), cy + ry * Math.sin(t)]);
  }
  const entier = Math.abs(a - de) >= 360;
  if (entier) points.pop();
  return { points, ferme: entier };
}
/** Vague : ligne ondulée de (x1, y) à (x2, y). */
function vague(x1, x2, y, hauteur = 0.9, longueur = 6) {
  const points = [];
  for (let x = x1; x <= x2 + 0.01; x += longueur / 10) points.push([x, y + hauteur * Math.sin(((x - x1) / longueur) * 2 * Math.PI)]);
  return { points, ferme: false };
}
/** Rayons autour d'un cercle. */
const rayons = (cx, cy, r1, r2, nb, decalage = 0) =>
  Array.from({ length: nb }, (_, i) => {
    const t = ((decalage + (360 * i) / nb) * Math.PI) / 180;
    return ligne([cx + r1 * Math.cos(t), cy + r1 * Math.sin(t)], [cx + r2 * Math.cos(t), cy + r2 * Math.sin(t)]);
  });
/** Nuage : trois bosses posées sur un trait. */
const nuage = (x, y, l = 9) => [
  arc(x + l * 0.22, y, l * 0.2, 180, 300),
  arc(x + l * 0.5, y - l * 0.14, l * 0.24, 190, 350),
  arc(x + l * 0.78, y, l * 0.19, 240, 360),
  ligne([x + l * 0.02, y], [x + l * 0.98, y]),
];
/** Sapin : deux étages et un tronc. */
const sapin = (x, y, h = 9) => [
  ligne([x - h * 0.3, y - h * 0.42], [x, y - h], [x + h * 0.3, y - h * 0.42]),
  ligne([x - h * 0.24, y - h * 0.42], [x - h * 0.42, y - h * 0.1], [x + h * 0.42, y - h * 0.1], [x + h * 0.24, y - h * 0.42]),
  ligne([x, y - h * 0.1], [x, y]),
];

// ─── Les quatre dessins ─────────────────────────────────────────────────────

export const DESSINS = [
  {
    nom: 'ski',
    titre: 'Un skieur dans la montagne',
    traits: [
      // Deux sommets et leurs neiges.
      ligne([1.5, 24.5], [12.5, 5.5], [17.5, 13.5], [25.5, 3], [38.5, 25]),
      ligne([9.6, 10.6], [11.6, 12.6], [13.2, 10.6], [14.8, 12.4], [15.6, 10.4]),
      ligne([21.4, 8.4], [23.4, 10.4], [25.2, 8.4], [27.2, 10.6], [29.4, 9.4]),
      // La pente, un sapin, un nuage.
      courbe([1, 26.5], [20, 27.5], [39, 37]),
      ...sapin(34, 33.4, 9),
      ...nuage(1, 6, 10),
      // Le skieur : tête, buste penché, bras et bâton, jambes fléchies, skis.
      arc(21.6, 17.4, 2),
      ligne([21, 19.4], [18.6, 24.2]),
      ligne([20.5, 20.8], [24.2, 23], [22.6, 29.6]),
      ligne([18.6, 24.2], [21.6, 26.4], [19.8, 29.6]),
      ligne([14.4, 28.6], [26.4, 31.8], [27.6, 31.2]),
      ligne([20.6, 18.9], [17.8, 18.2]),
    ],
    // La montagne en couleur, ses neiges en blanc, le sapin en couleur pleine.
    hachures: [contour([1.5, 24.5], [12.5, 5.5], [17.5, 13.5], [25.5, 3], [38.5, 25])],
    blanc: [
      contour([12.5, 5.5], [15.6, 10.4], [14.8, 12.4], [13.2, 10.6], [11.6, 12.6], [9.6, 10.6]),
      contour([25.5, 3], [29.4, 9.4], [27.2, 10.6], [25.2, 8.4], [23.4, 10.4], [21.4, 8.4]),
    ],
    plein: [contour([31.3, 29.6], [34, 24.4], [36.7, 29.6]), contour([31.8, 29.6], [30.2, 32.5], [37.8, 32.5], [36.2, 29.6])],
  },
  {
    nom: 'voilier',
    titre: 'Un voilier au soleil',
    traits: [
      contour([8.5, 27], [31.5, 27], [27.6, 32.6], [12.4, 32.6]),
      ligne([20, 27], [20, 5.6]),
      contour([21.3, 8.4], [31, 24.8], [21.3, 24.8]),
      contour([18.7, 10.4], [10, 24.8], [18.7, 24.8]),
      ligne([20, 5.6], [23.6, 6.8], [20, 8]),
      vague(2, 38, 35.4),
      vague(5, 35, 38.4),
      arc(33.4, 7.6, 3.2),
      ...rayons(33.4, 7.6, 4.6, 6.4, 8, 22),
      // Deux mouettes.
      courbe([3, 9.4], [4.6, 7.2], [6, 9.2], 5),
      courbe([6, 9.2], [7.4, 7.2], [9, 9.4], 5),
      courbe([7.4, 15], [8.6, 13.4], [9.6, 14.8], 4),
      courbe([9.6, 14.8], [10.6, 13.4], [11.8, 15], 4),
    ],
    // Les voiles en couleur, la coque en couleur pleine.
    hachures: [contour([21.3, 8.4], [31, 24.8], [21.3, 24.8]), contour([18.7, 10.4], [10, 24.8], [18.7, 24.8])],
    plein: [contour([8.5, 27], [31.5, 27], [27.6, 32.6], [12.4, 32.6])],
  },
  {
    nom: 'montgolfiere',
    titre: 'Une montgolfière au-dessus des collines',
    traits: [
      // Le ballon, ses fuseaux, les cordes et la nacelle.
      arc(20, 13, 10.4, 128, 412),
      ligne([13.6, 21.2], [17.2, 27.4]),
      ligne([26.4, 21.2], [22.8, 27.4]),
      courbe([20, 2.6], [12.6, 12], [17, 22.8]),
      courbe([20, 2.6], [27.4, 12], [23, 22.8]),
      ligne([20, 2.6], [20, 23.2]),
      contour([17, 27.4], [23, 27.4], [22.4, 32.2], [17.6, 32.2]),
      ligne([17.2, 29.4], [22.8, 29.4]),
      // Les collines, deux nuages.
      courbe([1, 38.6], [11, 31.6], [21, 38]),
      courbe([17, 37.4], [29, 30.6], [39, 38.6]),
      ...nuage(0.8, 11, 9.4),
      ...nuage(29.8, 23, 9.4),
    ],
    // Le ballon en couleur, la nacelle en couleur pleine.
    hachures: [{ points: arc(20, 13, 10.4, 128, 412).points, ferme: true }],
    plein: [contour([17, 27.4], [23, 27.4], [22.4, 32.2], [17.6, 32.2])],
  },
  {
    nom: 'maison',
    titre: 'Une maison et son arbre',
    traits: [
      // La maison : murs, toit, porte, fenêtre, cheminée et fumée.
      ligne([7, 21.4], [7, 35], [23, 35], [23, 21.4]),
      ligne([4.6, 22], [15, 11.6], [25.4, 22]),
      ligne([13.2, 35], [13.2, 28.2], [17.2, 28.2], [17.2, 35]),
      contour([9, 23.6], [12.2, 23.6], [12.2, 26.8], [9, 26.8]),
      ligne([10.6, 23.6], [10.6, 26.8]),
      ligne([9, 25.2], [12.2, 25.2]),
      ligne([19, 15.6], [19, 11.8], [21.6, 11.8], [21.6, 18.2]),
      courbe([20.4, 10], [18.4, 7.6], [20.8, 6], 5),
      courbe([20.8, 6], [22.8, 4.6], [21.2, 2.6], 5),
      // L'arbre, le sol, le soleil.
      arc(33, 21, 5.6),
      ligne([32.1, 26.5], [31.9, 35]),
      ligne([33.9, 26.5], [34.1, 35]),
      ligne([1.5, 35.2], [38.5, 35]),
      arc(5.6, 6.6, 2.8),
      ...rayons(5.6, 6.6, 4.1, 5.7, 8, 10),
    ],
    // Le toit et l'arbre en couleur, la porte en couleur pleine.
    hachures: [contour([4.6, 22], [15, 11.6], [25.4, 22]), arc(33, 21, 5.6)],
    plein: [contour([13.2, 35], [13.2, 28.2], [17.2, 28.2], [17.2, 35])],
  },
];

// ─── Tracé ──────────────────────────────────────────────────────────────────

/**
 * Un dessin prêt à peindre : les zones à colorier (hachures, plein, blanc), puis les deux passages du crayon, le
 * trait et sa reprise, plus légère et un peu décalée.
 */
export function tracer(dessin, graine) {
  const passage = (traits, decalage, amplitude) => {
    const rng = hasard(graine * 1000 + decalage);
    return (traits || []).map((t) => chemin(trembler(echantillonner(t.ferme ? [...t.points, t.points[0]] : t.points, 1.5), rng, amplitude, t.ferme).slice(0, t.ferme ? -1 : undefined), t.ferme)).join('');
  };
  return {
    nom: dessin.nom,
    titre: dessin.titre,
    hachures: passage(dessin.hachures, 3, 0.15),
    plein: passage(dessin.plein, 4, 0.15),
    blanc: passage(dessin.blanc, 5, 0.15),
    trait: passage(dessin.traits, 1, 0.22),
    reprise: passage(dessin.traits, 2, 0.34),
  };
}

export function fichierAppli() {
  const dessins = DESSINS.map((d, i) => tracer(d, i + 1));
  return (
    `// Dessins à colorier des coins du plateau. Fichier généré par outils/coloriages/generer.mjs, ne pas le modifier à la main.\n` +
    `/** Côté du carré dans lequel chaque dessin est tracé. */\n` +
    `export const COTE_COLORIAGE = ${COTE};\n` +
    `/**\n * Un dessin par joueur, en chemins SVG : { nom, titre, hachures, plein, blanc, trait, reprise }. hachures et plein :\n * zones peintes de la couleur du joueur ; blanc : zones laissées blanches ; trait et reprise : les deux passages du crayon.\n */\n` +
    `export const COLORIAGES = ${JSON.stringify(dessins, null, 2)};\n`
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const racine = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const texte = fichierAppli();
  writeFileSync(join(racine, 'public/js/ui/coloriages.js'), texte);
  console.log(`public/js/ui/coloriages.js écrit (${(texte.length / 1024).toFixed(1)} Ko).`);
  if (process.env.SORTIE) {
    const couleurs = ['#2f6fb5', '#c8372d', '#e6a91b', '#3f8f4f'];
    const svg = DESSINS.map((d, i) => tracer(d, i + 1))
      .map(
        (d, i) =>
          `<figure><svg viewBox="-2 -2 ${COTE + 4} ${COTE + 4}" style="--couleur:${couleurs[i]}"><defs><pattern id="h${i}" patternUnits="userSpaceOnUse" width="2.2" height="2.2" patternTransform="rotate(-38)">` +
          `<line x1="0" y1="1.1" x2="2.2" y2="1.1" stroke="${couleurs[i]}" stroke-width="0.85"/></pattern></defs>` +
          `<rect x="-2" y="-2" width="${COTE + 4}" height="${COTE + 4}" fill="#dcb57f"/>` +
          `<path class="aplat" d="${d.hachures}"/><path d="${d.hachures}" fill="url(#h${i})" stroke="none" opacity=".8"/><path class="plein" d="${d.plein}"/><path class="blanc" d="${d.blanc}"/>` +
          `<path class="trait" d="${d.trait}"/><path class="reprise" d="${d.reprise}"/></svg><figcaption>${d.titre}</figcaption></figure>`,
      )
      .join('');
    writeFileSync(
      join(process.env.SORTIE, 'coloriages.html'),
      `<!doctype html><meta charset="utf-8"><style>body{font:14px system-ui;display:flex;gap:16px;flex-wrap:wrap;padding:16px}figure{margin:0}svg{width:320px;height:320px;display:block}` +
        `.trait,.reprise{fill:none;stroke:#2e3644;stroke-linecap:round;stroke-linejoin:round}.trait{stroke-width:.95}.reprise{stroke-width:.62;opacity:.5}` +
        `.aplat{fill:var(--couleur);opacity:.28}.plein{fill:var(--couleur);opacity:.72}.blanc{fill:#fff;opacity:.85}</style>${svg}`,
    );
    console.log('coloriages.html écrit.');
  }
}
