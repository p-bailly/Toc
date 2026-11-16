import test from 'node:test';
import assert from 'node:assert/strict';
import { NIVEAUX, NIVEAU_DEFAUT, nomNiveau, forceNiveau, niveauEnLettres, niveauValide, nomAvecNiveau } from '../public/js/ui/niveaux.js';

test('niveaux : liste de l’IA, affichage en étoiles, niveau par défaut pour une IA sans niveau', () => {
  assert.ok(NIVEAUX.length >= 1);
  assert.equal(niveauValide(undefined), NIVEAU_DEFAUT);
  assert.equal(niveauValide('inconnu'), NIVEAU_DEFAUT);
  // Les niveaux s'affichent en étoiles, de 1 (le plus faible) à 5 (le plus fort).
  assert.deepEqual(NIVEAUX.map((n) => forceNiveau(n.id)), [1, 2, 3, 4, 5]);
  assert.equal(nomNiveau(NIVEAUX[0].id), '★');
  assert.equal(nomNiveau(NIVEAUX[4].id), '★★★★★');
  assert.equal(nomNiveau(undefined), nomNiveau(NIVEAU_DEFAUT));
  assert.equal(niveauEnLettres(NIVEAUX[0].id), '1 étoile sur 5');
  assert.equal(niveauEnLettres(NIVEAUX[2].id), '3 étoiles sur 5');
  assert.equal(nomAvecNiveau({ pseudo: 'IA Est', ia: true, niveau: 'expert' }), 'IA Est · ★★★★');
  assert.equal(nomAvecNiveau({ pseudo: 'Léa', ia: false }), 'Léa');
});
