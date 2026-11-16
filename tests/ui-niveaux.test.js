import test from 'node:test';
import assert from 'node:assert/strict';
import { NIVEAUX, NIVEAU_DEFAUT, nomNiveau, niveauValide, nomAvecNiveau } from '../public/js/ui/niveaux.js';

test('niveaux : liste de l’IA, nom par défaut pour une IA sans niveau', () => {
  assert.ok(NIVEAUX.length >= 1);
  assert.equal(niveauValide(undefined), NIVEAU_DEFAUT);
  assert.equal(niveauValide('inconnu'), NIVEAU_DEFAUT);
  assert.equal(nomNiveau(undefined), NIVEAUX.find((n) => n.id === NIVEAU_DEFAUT).nom);
  const expert = NIVEAUX.find((n) => n.id === 'expert');
  if (expert) assert.equal(nomAvecNiveau({ pseudo: 'IA Est', ia: true, niveau: 'expert' }), `IA Est · ${expert.nom}`);
  assert.equal(nomAvecNiveau({ pseudo: 'Léa', ia: false }), 'Léa');
});
