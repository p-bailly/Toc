import test from 'node:test';
import assert from 'node:assert/strict';
import { caseCircuit, caseAllee, emplacementBase, positionPion, chemin, coteDe, boiteEtiquette, versSvg } from '../public/js/ui/geometrie.js';
import { BASE, ALLEE, caseEntree, caseDepart } from '../public/js/moteur/plateau.js';

const cle = (p) => `${p.u},${p.v}`;

test('géométrie : la case de départ du joueur local est au milieu du bas, parcours horaire', () => {
  for (let vue = 0; vue < 4; vue++) {
    assert.deepEqual(caseCircuit(caseDepart(vue), vue), { u: 8, v: 16 });
    // Indices croissants vers la gauche en bas, puis vers le haut à gauche (sens horaire à l'écran).
    assert.deepEqual(caseCircuit(caseDepart(vue) + 1, vue), { u: 7, v: 16 });
    assert.deepEqual(caseCircuit(caseDepart(vue) + 9, vue), { u: 0, v: 15 });
    // Partenaire en haut, siège suivant à gauche, précédent à droite.
    assert.deepEqual(caseCircuit(caseDepart((vue + 2) % 4), vue), { u: 8, v: 0 });
    assert.deepEqual(caseCircuit(caseDepart((vue + 1) % 4), vue), { u: 0, v: 8 });
    assert.deepEqual(caseCircuit(caseDepart((vue + 3) % 4), vue), { u: 16, v: 8 });
  }
});

test('géométrie : les 64 cases forment le pourtour de la grille 17 × 17', () => {
  const vues = new Set();
  for (let i = 0; i < 64; i++) {
    const p = caseCircuit(i, 0);
    assert.ok(p.u === 0 || p.u === 16 || p.v === 0 || p.v === 16);
    vues.add(cle(p));
    // Deux cases consécutives sont voisines.
    const q = caseCircuit(i + 1, 0);
    assert.equal(Math.abs(p.u - q.u) + Math.abs(p.v - q.v), 1);
  }
  assert.equal(vues.size, 64);
});

test('géométrie : case d’entrée 3 cases à droite de la sortie, allée vers le centre', () => {
  assert.deepEqual(caseCircuit(caseEntree(0), 0), { u: 11, v: 16 });
  for (let k = 0; k < 4; k++) assert.deepEqual(caseAllee(0, k, 0), { u: 11, v: 15 - k });
  for (let vue = 0; vue < 4; vue++) {
    for (let s = 0; s < 4; s++) {
      const e = caseCircuit(caseEntree(s), vue);
      const a0 = caseAllee(s, 0, vue);
      assert.equal(Math.abs(e.u - a0.u) + Math.abs(e.v - a0.v), 1, 'allée collée à la case d’entrée');
      const a3 = caseAllee(s, 3, vue);
      assert.ok(Math.abs(a3.u - 8) + Math.abs(a3.v - 8) < Math.abs(a0.u - 8) + Math.abs(a0.v - 8), 'allée vers le centre');
    }
  }
  // Siège 1 vu du siège 0 : allée horizontale sur la rangée 11, à gauche.
  assert.deepEqual(caseAllee(1, 0, 0), { u: 1, v: 11 });
});

test('géométrie : bases derrière la sortie, sans chevaucher circuit ni allées', () => {
  const occupees = new Set();
  for (let i = 0; i < 64; i++) occupees.add(cle(caseCircuit(i, 0)));
  for (let s = 0; s < 4; s++) for (let k = 0; k < 4; k++) occupees.add(cle(caseAllee(s, k, 0)));
  for (let s = 0; s < 4; s++) {
    for (let n = 0; n < 4; n++) {
      const b = emplacementBase(s, n, 0);
      assert.ok(b.u > 0.5 && b.u < 15.5 && b.v > 0.5 && b.v < 15.5);
      for (const c of occupees) {
        const [u, v] = c.split(',').map(Number);
        assert.ok(Math.abs(u - b.u) >= 1 || Math.abs(v - b.v) >= 1, `base ${s} chevauche ${c}`);
      }
    }
  }
  const b = emplacementBase(0, 0, 0);
  assert.ok(Math.abs(b.u - 8) < 1 && b.v > 12, 'base du bas derrière sa sortie');
});

test('géométrie : positions des pions et chemins d’animation', () => {
  assert.deepEqual(positionPion(0, BASE, 0), emplacementBase(0, 0, 0));
  assert.deepEqual(positionPion(5, ALLEE + 2, 0), caseAllee(1, 2, 0));
  assert.deepEqual(chemin(0, 59, ALLEE + 1), [59, 60, 61, 100, 101]);
  assert.deepEqual(chemin(0, 0, 60, 'arriere'), [0, 63, 62, 61, 60]);
  assert.deepEqual(chemin(0, 62, 3), [62, 63, 0, 1, 2, 3]);
  assert.deepEqual(chemin(0, BASE, 0), [BASE, 0]);
  assert.equal(coteDe(3, 0), 3);
  // Étiquettes dans le plateau.
  for (let c = 0; c < 4; c++) {
    const e = boiteEtiquette(c);
    assert.ok(e.x >= 10 && e.y >= 10 && e.x + e.l <= 160 && e.y + e.h <= 160);
  }
  assert.deepEqual(versSvg({ u: 0, v: 0 }), { x: 5, y: 5 });
});
