// Dessins au crayon des coins du plateau carré, coloriés de la couleur de chaque joueur : le fichier servi est celui du
// générateur, et les carrés des coins ne touchent ni le circuit, ni une allée, ni une base, sur les deux plateaux.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { COLORIAGES, COTE_COLORIAGE } from '../public/js/ui/coloriages.js';
import { fichierAppli, COTE } from '../outils/coloriages/generer.mjs';
import { geometrie } from '../public/js/ui/geometrie.js';

test('coloriages : le fichier de l’appli est celui que produit le générateur', () => {
  assert.equal(readFileSync(new URL('../public/js/ui/coloriages.js', import.meta.url), 'utf8'), fichierAppli());
  assert.equal(COTE_COLORIAGE, COTE);
});

test('coloriages : un dessin par joueur, des zones à colorier et deux passages de crayon, dans leur carré', () => {
  assert.deepEqual(COLORIAGES.map((d) => d.nom), ['ski', 'voilier', 'montgolfiere', 'maison']);
  for (const d of COLORIAGES) {
    assert.ok(d.titre.length > 5);
    for (const passage of [d.trait, d.reprise]) assert.ok(passage.match(/-?\d+(\.\d+)?/g).length > 200, `${d.nom} : un vrai dessin`);
    assert.notEqual(d.trait, d.reprise);
    // Des zones à peindre de la couleur du joueur, toutes fermées ; le blanc (la neige) est facultatif.
    assert.ok(d.hachures.endsWith('Z') && d.plein.endsWith('Z'), `${d.nom} : zones de couleur`);
    assert.equal(typeof d.blanc, 'string');
    for (const chemin of [d.trait, d.reprise, d.hachures, d.plein, d.blanc].filter(Boolean)) {
      const nombres = chemin.match(/-?\d+(\.\d+)?/g).map(Number);
      assert.ok(Math.min(...nombres) >= -1 && Math.max(...nombres) <= COTE + 1, `${d.nom} déborde de son carré`);
    }
  }
});

test('coloriages : les carrés des coins sont libres (ni circuit, ni allée, ni base)', () => {
  for (const cote of [18, 16]) {
    const G = geometrie(4, cote);
    assert.equal(G.coins.length, 4);
    assert.equal(geometrie(3, cote).coins, undefined, 'pas de coin sur le triangle');
    /** Distance d'un point au carré (0 s'il est dedans). */
    const distance = (coin, p) => Math.hypot(Math.max(coin.x - p.x, 0, p.x - coin.x - coin.cote), Math.max(coin.y - p.y, 0, p.y - coin.y - coin.cote));
    for (const coin of G.coins) {
      assert.ok(coin.cote >= 30, 'assez grand pour un dessin');
      // Dans le tapis, en deçà du filet (12,4 unités du bord).
      assert.ok(coin.x >= 14 && coin.y >= 14 && coin.x + coin.cote <= G.cote - 14 && coin.y + coin.cote <= G.cote - 14);
      for (let i = 0; i < G.nbCases; i++) assert.ok(distance(coin, G.caseCircuit(i, 0)) > 5.5, `coin sur la case ${i}`);
      for (let s = 0; s < 4; s++) {
        for (let k = 0; k < 4; k++) assert.ok(distance(coin, G.caseAllee(s, k, 0)) > 5.5, `coin sur l'allée ${s}`);
        assert.ok(distance(coin, G.centreBase(s, 0)) > G.TAILLE_BASE / 2 + 1, `coin sur la base ${s}`);
      }
    }
  }
});
