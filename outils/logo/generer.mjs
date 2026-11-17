// Icônes de l'appli à partir du logo au crayon (outils/logo/toc-crayon.svg, repris de Nimbus) : le plateau dessiné
// au crayon sur une feuille blanche.
//
//   node outils/logo/generer.mjs
//
// écrit public/icons/icon.svg, puis les PNG (192, 512, masquable 512, Apple 180) avec le Chromium de Playwright s'il est
// installé (`npx playwright install chromium`, ou CHROME_PATH pour un Chrome déjà là) ; sans lui, seul le SVG est écrit.
//
// Trois cadrages :
//  - icône ordinaire : feuille blanche aux coins arrondis, coins transparents ;
//  - icône masquable (et Android, qui la réduit encore : ic_launcher_foreground.xml) : feuille pleine, dessin réduit à
//    62 % pour tenir en entier dans la zone toujours visible, quel que soit le découpage (rond, carré arrondi…) ;
//  - Apple : feuille pleine (iOS arrondit lui-même), dessin un peu plus grand.

import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ici = dirname(fileURLToPath(import.meta.url));
const icones = join(ici, '..', '..', 'public', 'icons');
const source = readFileSync(join(ici, 'toc-crayon.svg'), 'utf8');
const defs = source.match(/<defs>[\s\S]*?<\/defs>/)[0];
const dessin = source.match(/<g>([\s\S]*)<\/g>/)[1].trim();

/** Le dessin occupe le carré 22..86 de son repère (centre 54). */
const CENTRE = 54;
const LARGEUR = 64;
const FEUILLE = '#ffffff';

/**
 * @param {number} part    part du côté de l'icône occupée par le dessin (0 à 1)
 * @param {number} arrondi rayon des coins de la feuille, en centièmes du côté (0 : feuille pleine)
 */
function icone(part, arrondi) {
  const e = (100 * part) / LARGEUR;
  const d = 50 - CENTRE * e;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" role="img" aria-label="Toc">\n` +
    `  <!-- Fichier généré par outils/logo/generer.mjs à partir de outils/logo/toc-crayon.svg, ne pas le modifier à la main. -->\n` +
    `  ${defs}\n` +
    `  <rect width="100" height="100" rx="${arrondi}" fill="${FEUILLE}"/>\n` +
    `  <g transform="translate(${d.toFixed(3)} ${d.toFixed(3)}) scale(${e.toFixed(4)})">\n  ${dessin}\n  </g>\n` +
    `</svg>\n`
  );
}

const ordinaire = icone(0.84, 21);
writeFileSync(join(icones, 'icon.svg'), ordinaire);
console.log('public/icons/icon.svg écrit.');

const PNG = [
  ['icon-192.png', 192, ordinaire, true],
  ['icon-512.png', 512, ordinaire, true],
  ['icon-maskable-512.png', 512, icone(0.62, 0), false],
  ['apple-touch-icon.png', 180, icone(0.8, 0), false],
];

let chromium = null;
try {
  ({ chromium } = createRequire(import.meta.url)('playwright'));
} catch {
  console.log('Playwright absent : les PNG ne sont pas refaits.');
}
if (chromium) {
  const navigateur = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
  for (const [nom, cote, svg, transparent] of PNG) {
    const page = await (await navigateur.newContext({ viewport: { width: cote, height: cote }, deviceScaleFactor: 1 })).newPage();
    await page.setContent(`<body style="margin:0;background:${transparent ? 'transparent' : FEUILLE}">${svg.replace('<svg ', `<svg width="${cote}" height="${cote}" style="display:block" `)}</body>`);
    writeFileSync(join(icones, nom), await page.screenshot({ omitBackground: transparent, clip: { x: 0, y: 0, width: cote, height: cote } }));
    console.log(`public/icons/${nom} écrit (${cote} px).`);
    await page.context().close();
  }
  await navigateur.close();
}
