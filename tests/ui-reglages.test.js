// Vitesse du jeu : un curseur de 0 (très lente) à 100 (rapide), d'où sortent toutes les durées des animations.
import test from 'node:test';
import assert from 'node:assert/strict';
import { VITESSE_MIN, VITESSE_MAX, VITESSE_PAS, VITESSE_DEFAUT, vitesseValide, rythme, nomVitesse } from '../public/js/ui/reglages.js';

test('vitesse : une valeur du curseur, quelle que soit la valeur enregistrée', () => {
  assert.equal(vitesseValide(40), 40);
  assert.equal(vitesseValide(37), 35); // au pas près
  assert.equal(vitesseValide(-20), VITESSE_MIN);
  assert.equal(vitesseValide(999), VITESSE_MAX);
  for (const abimee of [undefined, null, NaN, Infinity, '40', {}, 'inconnue']) assert.equal(vitesseValide(abimee), VITESSE_DEFAUT);
  // Les trois vitesses d'avant le curseur : « posée », la plus lente d'alors, prend la nouvelle vitesse par défaut.
  assert.deepEqual(['posee', 'normale', 'rapide'].map(vitesseValide), [VITESSE_DEFAUT, 60, 100]);
  assert.equal(VITESSE_DEFAUT % VITESSE_PAS, 0);
});

test('vitesse : plus le curseur est à gauche, plus tout est lent ; la vitesse par défaut est plus lente qu’avant', () => {
  const cles = ['pas', 'max', 'saut', 'carte', 'lecture', 'delaiIA', 'avantAuto'];
  let precedent = null;
  for (let v = VITESSE_MIN; v <= VITESSE_MAX; v += VITESSE_PAS) {
    const r = rythme(v);
    assert.deepEqual(Object.keys(r), cles);
    for (const cle of cles) {
      assert.ok(Number.isInteger(r[cle]) && r[cle] > 0, `${cle} à ${v}`);
      if (precedent) assert.ok(r[cle] < precedent[cle], `${cle} raccourcit de ${v - VITESSE_PAS} à ${v}`);
    }
    precedent = r;
  }
  // L'ancienne vitesse « posée » : 150 ms par case, 500 ms pour la carte, 750 ms de lecture.
  const defaut = rythme(VITESSE_DEFAUT);
  assert.ok(defaut.pas > 150 && defaut.carte > 500 && defaut.lecture > 750 && defaut.delaiIA > 1300);
  // Le bout rapide du curseur est l'ancienne vitesse « rapide ».
  assert.deepEqual(rythme(100), { pas: 55, max: 550, saut: 220, carte: 230, lecture: 220, delaiIA: 450, avantAuto: 700 });
  assert.deepEqual(rythme('rapide'), rythme(100));
  assert.deepEqual(rythme(undefined), defaut);
});

test('vitesse : chaque position du curseur a un nom', () => {
  assert.deepEqual([0, 25, 40, 60, 100].map(nomVitesse), ['Très lente', 'Lente', 'Posée', 'Normale', 'Rapide']);
});
