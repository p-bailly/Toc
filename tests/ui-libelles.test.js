import test from 'node:test';
import assert from 'node:assert/strict';
import { nomCarte, carteCourte, ligneJournal, trierMain, libelleChoix, enumerer } from '../public/js/ui/libelles.js';

const joueurs = [{ pseudo: 'Léa' }, { pseudo: 'Max' }, { pseudo: 'Zoé' }, { pseudo: 'Tom' }];

test('libellés : noms de cartes', () => {
  assert.equal(nomCarte('AP'), 'As de pique');
  assert.equal(nomCarte('10C'), '10 de cœur');
  assert.equal(nomCarte('VK'), 'Valet de carreau');
  assert.equal(carteCourte('DT'), 'Dame ♣');
  assert.deepEqual(trierMain(['RP', '2C', 'AT', '10K', 'VP']), ['AT', '2C', '10K', 'VP', 'RP']);
});

test('libellés : journal des coups', () => {
  assert.equal(ligneJournal({ siege: 0, coup: { t: 'sortie', carte: 'RP', pion: 0 }, captures: [] }, joueurs), 'Léa joue le Roi ♠ : sort un pion.');
  assert.equal(
    ligneJournal({ siege: 1, coup: { t: 'avance', carte: '8C', pion: 4, pas: 8, allee: false }, captures: [0] }, joueurs),
    'Max joue le 8 ♥ : avance de 8 et renvoie un pion de Léa à la base.',
  );
  assert.equal(
    ligneJournal({ siege: 2, coup: { t: 'sept', carte: '7K', etapes: [{ pion: 8, pas: 3 }, { pion: 9, pas: 4 }] }, captures: [] }, joueurs),
    'Zoé joue le 7 ♦ : fractionne le 7 (3 + 4).',
  );
  assert.equal(ligneJournal({ siege: 3, coup: { t: 'defausse', carte: '9P' }, captures: [] }, joueurs), 'Tom défausse le 9 ♠ (aucune carte jouable).');
  assert.equal(ligneJournal({ siege: 0, coup: { t: 'echange', carte: 'VT', pion: 1, cible: 6 }, captures: [] }, joueurs), 'Léa joue le Valet ♣ : échange un pion avec un pion de Max.');
  assert.equal(ligneJournal({ siege: 0, coup: { t: 'recul', carte: '4T', pion: 1 }, captures: [] }, joueurs), 'Léa joue le 4 ♣ : recule de 4.');
});

test('libellés : choix proposés', () => {
  assert.equal(libelleChoix({ t: 'avance', carte: 'AP', pion: 0, pas: 11, allee: false }, 0, joueurs), 'Avancer de 11');
  assert.equal(libelleChoix({ t: 'avance', carte: '5P', pion: 0, pas: 5, allee: true }, 0, joueurs), 'Entrer dans l’allée (5)');
  assert.equal(libelleChoix({ t: 'avance', carte: '5P', pion: 4, pas: 5, allee: false }, 0, joueurs), 'Pousser le pion de Max de 5');
  assert.equal(enumerer(['A', 'B', 'C']), 'A, B et C');
});

test('libellés : joker (jeu à 3)', () => {
  const trois = joueurs.slice(0, 3);
  assert.equal(nomCarte('J1'), 'Joker');
  assert.deepEqual(trierMain(['J2', 'RP', 'AT']), ['AT', 'RP', 'J2']);
  assert.equal(
    ligneJournal({ siege: 1, coup: { t: 'avance', carte: 'J1', comme: '9', pion: 4, pas: 9, allee: false }, captures: [] }, trois),
    'Max joue un joker comme un 9 : avance de 9.',
  );
  assert.equal(ligneJournal({ siege: 0, coup: { t: 'defausse', carte: 'J2' }, captures: [] }, trois), 'Léa défausse un joker (aucune carte jouable).');
  assert.equal(
    ligneJournal({ siege: 0, coup: { t: 'avance', carte: '5C', pion: 8, pas: 5, allee: false }, captures: [] }, trois),
    'Léa joue le 5 ♥ : fait avancer un pion de Zoé de 5.',
  );
});
