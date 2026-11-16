import test from 'node:test';
import assert from 'node:assert/strict';
import { qualifier, toursDuJoueur, bilan, formatCases, SEUILS } from '../public/js/ui/etude-calcul.js';

test('analyse : qualificatif selon l’écart (marge déduite)', () => {
  const meilleur = { ecart: 0 };
  assert.equal(qualifier(meilleur, meilleur), 'meilleur');
  assert.equal(qualifier({ ecart: SEUILS.meilleur }, meilleur), 'meilleur');
  assert.equal(qualifier({ ecart: 1.5 }, meilleur), 'bon');
  assert.equal(qualifier({ ecart: 4 }, meilleur), 'imprecision');
  assert.equal(qualifier({ ecart: 9 }, meilleur), 'erreur');
  assert.equal(qualifier({ ecart: 6, marge: 3 }, meilleur), 'imprecision');
  assert.equal(qualifier(null, meilleur), null);
});

test('analyse : tours du joueur dans l’ordre (carte donnée puis coups, par donne)', () => {
  const etat = (donne) => ({ donne });
  const rejeu = {
    echanges: [{ etat: etat(0) }, { etat: etat(1) }],
    tours: [
      { n: 1, siege: 0, coup: { t: 'sortie' }, avant: etat(0), apres: etat(0) },
      { n: 2, siege: 1, coup: { t: 'sortie' }, avant: etat(0), apres: etat(0) },
      { n: 6, siege: 0, coup: { t: 'avance' }, avant: etat(1), apres: etat(1) },
    ],
  };
  const donnees = { siege: 0, donnes: [{ distribuees: ['AP'], donnee: 'AP', recue: '2C' }, { distribuees: ['3C'], donnee: '3C', recue: null }] };
  const items = toursDuJoueur(donnees, rejeu, () => ['X']);
  assert.deepEqual(items.map((i) => `${i.type}${i.donne}${i.n ?? ''}`), ['don0', 'coup01', 'don1', 'coup16']);
  assert.equal(items[1].options.carteRecue, '2C');
  const res = new Map([
    [0, { candidats: [{ ecart: 0, joue: true }] }],
    [1, { candidats: [{ ecart: 0 }, { ecart: 7, joue: true }] }],
  ]);
  const b = bilan(items, res);
  assert.equal(b.compte.meilleur, 1);
  assert.equal(b.compte.erreur, 1);
  assert.deepEqual(b.couteux, [{ id: 1, ecart: 7 }]);
  assert.equal(formatCases(3.25), '+3,3');
  assert.equal(formatCases(-1), '−1');
});
