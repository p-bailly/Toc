import test from 'node:test';
import assert from 'node:assert/strict';
import { geometrie, TRIANGLE, chemin } from '../public/js/ui/geometrie.js';
import { caseDepart, caseEntree, BASE, ALLEE } from '../public/js/moteur/plateau.js';

const G = geometrie(3);
const proche = (a, b, e = 1e-6) => Math.abs(a.x - b.x) < e && Math.abs(a.y - b.y) < e;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** Le point est-il sur un côté du triangle ? */
function surPourtour(p) {
  const { A, B, C } = TRIANGLE;
  const surSegment = (P, Q) => Math.abs(dist(P, p) + dist(p, Q) - dist(P, Q)) < 1e-6;
  return surSegment(A, B) || surSegment(B, C) || surSegment(C, A);
}
/** Le point est-il strictement à l'intérieur du triangle (orientation des trois côtés) ? */
function dedans(p) {
  const { A, B, C } = TRIANGLE;
  const cote = (P, Q) => (Q.x - P.x) * (p.y - P.y) - (Q.y - P.y) * (p.x - P.x);
  const s = [cote(A, B), cote(B, C), cote(C, A)];
  return s.every((v) => v > 1e-6) || s.every((v) => v < -1e-6);
}

test('géométrie à 3 : les 48 cases sont sur le pourtour du triangle, distinctes et régulièrement espacées', () => {
  const vues = new Set();
  for (let i = 0; i < 48; i++) {
    const p = G.caseCircuit(i, 0);
    assert.ok(surPourtour(p), `case ${i} hors du pourtour`);
    vues.add(`${p.x.toFixed(3)},${p.y.toFixed(3)}`);
    assert.ok(Math.abs(dist(p, G.caseCircuit(i + 1, 0)) - 10) < 1e-6, `pas irrégulier après ${i}`);
  }
  assert.equal(vues.size, 48);
});

test('géométrie à 3 : la sortie du joueur local est au milieu du bas, parcours horaire, pour chaque vue', () => {
  const { A, B } = TRIANGLE;
  const milieuBas = { x: (A.x + B.x) / 2, y: A.y };
  for (let vue = 0; vue < 3; vue++) {
    assert.ok(proche(G.caseCircuit(caseDepart(vue), vue), milieuBas));
    // Indices croissants vers la gauche en bas, puis vers le haut le long du côté gauche.
    assert.ok(G.caseCircuit(caseDepart(vue) + 1, vue).x < milieuBas.x);
    assert.ok(proche(G.caseCircuit(caseDepart(vue) + 8, vue), A));
    // Le siège suivant est sur le côté gauche (milieu), le précédent sur le côté droit.
    const gauche = G.caseCircuit(caseDepart((vue + 1) % 3), vue);
    const droite = G.caseCircuit(caseDepart((vue + 2) % 3), vue);
    assert.ok(gauche.x < milieuBas.x && droite.x > milieuBas.x && gauche.y < A.y && droite.y < A.y);
  }
});

test('géométrie à 3 : entrée 3 cases à droite de la sortie, allée de 4 cases vers l’intérieur', () => {
  for (let vue = 0; vue < 3; vue++) {
    for (let s = 0; s < 3; s++) {
      const e = G.caseCircuit(caseEntree(s, 3), vue);
      assert.ok(Math.abs(dist(e, G.caseCircuit(caseDepart(s), vue)) - 30) < 1e-6, 'entrée à 3 cases de la sortie');
      let precedent = e;
      for (let k = 0; k < 4; k++) {
        const a = G.caseAllee(s, k, vue);
        assert.ok(Math.abs(dist(a, precedent) - 10) < 1e-6, 'allée en ligne droite depuis l’entrée');
        assert.ok(dedans(a), 'allée à l’intérieur du triangle');
        precedent = a;
      }
      assert.ok(dist(G.caseAllee(s, 3, vue), TRIANGLE.G) < dist(e, TRIANGLE.G), 'allée vers le centre');
    }
  }
  // Joueur du bas : entrée à droite de la sortie, allée verticale.
  const e0 = G.caseCircuit(caseEntree(0, 3), 0);
  assert.ok(e0.x > 80);
  assert.ok(Math.abs(G.caseAllee(0, 3, 0).x - e0.x) < 1e-6);
});

test('géométrie à 3 : bases hors du circuit, accolées à la sortie, sans chevauchement', () => {
  const tous = [];
  for (let i = 0; i < 48; i++) tous.push(G.caseCircuit(i, 1));
  for (let s = 0; s < 3; s++) for (let k = 0; k < 4; k++) tous.push(G.caseAllee(s, k, 1));
  for (let s = 0; s < 3; s++) {
    const sortie = G.caseCircuit(caseDepart(s), 1);
    assert.ok(dist(G.centreBase(s, 1), sortie) < 25, 'base accolée à la sortie');
    for (let n = 0; n < 4; n++) {
      const b = G.emplacementBase(s, n, 1);
      assert.ok(!dedans(b) && !surPourtour(b), `base ${s} à l’extérieur du triangle`);
      for (const c of tous) assert.ok(dist(b, c) >= 7.5, `base ${s} trop près d’une case`);
    }
  }
  // Les étiquettes tiennent dans le cadre.
  const c = G.cadre;
  for (let cote = 0; cote < 3; cote++) {
    const e = G.boiteEtiquette(cote);
    assert.ok(e.x >= c.x && e.y >= c.y && e.x + e.l <= c.x + c.l && e.y + e.h <= c.y + c.h);
  }
});

test('géométrie à 3 : positions des pions et chemins d’animation sur 48 cases', () => {
  assert.ok(proche(G.positionPion(4, BASE, 0), G.emplacementBase(1, 0, 0)));
  assert.ok(proche(G.positionPion(9, ALLEE + 2, 0), G.caseAllee(2, 2, 0)));
  // Siège 0 : entrée en 45 ; un pion en 44 qui rentre au fond de l'allée.
  assert.deepEqual(chemin(0, 44, ALLEE + 3, 'avant', 3), [44, 45, 100, 101, 102, 103]);
  assert.deepEqual(chemin(0, 46, 1, 'avant', 3), [46, 47, 0, 1]);
  assert.deepEqual(chemin(0, 1, 45, 'arriere', 3), [1, 0, 47, 46, 45]);
});
