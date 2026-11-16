// Les bloqueurs de publicité et de traqueurs refusent de charger les scripts dont le nom évoque la
// mesure d'audience ou la publicité : l'appli restait alors bloquée sur « Chargement… » (constaté
// avec un fichier analyse.js). Aucun fichier servi ne doit porter un tel nom.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const RACINE = new URL('../public/', import.meta.url).pathname;
const SUSPECT = /analy[sz]|analyt|track|traq|stat(s|istiques?)?[-_.]|metri[cq]|pixel|beacon|telemetr|advert|banner|banniere|sponsor|(^|[-_/.])(ads?|pub|promo|gtm|tag)([-_.]|$)/i;

function lister(dossier, prefixe = '') {
  return readdirSync(dossier, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? lister(join(dossier, e.name), prefixe + e.name + '/') : [prefixe + e.name],
  );
}

test('aucun fichier servi ne porte un nom que bloquerait un bloqueur de publicité', () => {
  const fichiers = lister(RACINE);
  assert.ok(fichiers.length > 30);
  assert.deepEqual(fichiers.filter((f) => SUSPECT.test(f)), []);
});

test('le cache hors ligne ne cite que des fichiers qui existent', () => {
  const fichiers = new Set(lister(RACINE));
  const sw = readFileSync(join(RACINE, 'sw.js'), 'utf8');
  const cites = [...sw.matchAll(/'\.\/([^']+\.(?:js|css|html|png|svg|webmanifest))'/g)].map((m) => m[1]);
  assert.ok(cites.length > 30);
  assert.deepEqual(cites.filter((c) => !fichiers.has(c)), []);
});
