import test from 'node:test';
import assert from 'node:assert/strict';
import { PIONS, COULEURS_PIONS, couleurSiege, couleurFonceeSiege, nomCouleur } from '../public/js/ui/couleurs.js';

test('couleurs : bleu, rouge, jaune et vert (bois verni), forme gardée pour les puces', () => {
  assert.deepEqual(COULEURS_PIONS, ['#2f6fb5', '#c8372d', '#e6a91b', '#3f8f4f']);
  assert.deepEqual(PIONS.map((p) => p.nom), ['bleu', 'rouge', 'jaune', 'vert']);
  assert.equal(nomCouleur(3), 'vert');
  assert.equal(couleurSiege(2), 'var(--pion-2)');
  assert.equal(couleurFonceeSiege(1), 'var(--pion-1-fonce)');
  assert.equal(new Set(PIONS.map((p) => p.forme)).size, 4);
});

test('couleurs : la feuille de style définit les mêmes valeurs', async () => {
  const { readFile } = await import('node:fs/promises');
  const css = await readFile(new URL('../public/css/app.css', import.meta.url), 'utf8');
  COULEURS_PIONS.forEach((c, i) => assert.ok(css.includes(`--pion-${i}: ${c};`), `--pion-${i}`));
});
