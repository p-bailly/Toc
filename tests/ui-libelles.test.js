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

test('libellés : le joueur local est tutoyé dans le journal', () => {
  assert.equal(ligneJournal({ siege: 0, coup: { t: 'sortie', carte: 'RP', pion: 0 }, captures: [] }, joueurs, 0), 'Tu joues le Roi ♠ : sort un pion.');
  assert.equal(ligneJournal({ siege: 0, coup: { t: 'defausse', carte: '9P' }, captures: [] }, joueurs, 0), 'Tu défausses le 9 ♠ (aucune carte jouable).');
});

test('main rangée : l’ordre choisi est gardé, les cartes jouées s’en vont, les nouvelles arrivent triées', async () => {
  const { ordonnerMain, deplacer } = await import('../public/js/ui/libelles.js');
  const main = ['RT', '2C', '9P', '5T', '7K'];
  // Sans ordre choisi : la main triée.
  assert.deepEqual(ordonnerMain(main, null), trierMain(main));
  assert.deepEqual(ordonnerMain(main, []), trierMain(main));
  // L'ordre choisi tel quel.
  assert.deepEqual(ordonnerMain(main, ['9P', 'RT', '2C', '7K', '5T']), ['9P', 'RT', '2C', '7K', '5T']);
  // Une carte jouée disparaît ; la carte reçue vient après les cartes rangées.
  assert.deepEqual(ordonnerMain(['RT', '9P', '5T', 'AK'], ['9P', 'RT', '2C', '7K', '5T']), ['9P', 'RT', '5T', 'AK']);
  // Nouvelle donne (plus aucune carte rangée en main) : de nouveau triée.
  assert.deepEqual(ordonnerMain(['3C', 'AK'], ['9P', 'RT']), trierMain(['3C', 'AK']));
  // Deux cartes identiques (jokers à 3 joueurs) : chacune compte une fois, la main n'est jamais abîmée.
  assert.deepEqual(ordonnerMain(['J1', '4C', 'J1'], ['J1', 'J1', '4C']).sort(), ['4C', 'J1', 'J1']);
  assert.deepEqual(ordonnerMain(['J1', '4C'], ['J1', 'J1', '4C']), ['J1', '4C']);
  // Déplacer une carte d'une place à une autre, sans sortir de la main.
  assert.deepEqual(deplacer(['a', 'b', 'c', 'd'], 0, 2), ['b', 'c', 'a', 'd']);
  assert.deepEqual(deplacer(['a', 'b', 'c', 'd'], 3, 0), ['d', 'a', 'b', 'c']);
  assert.deepEqual(deplacer(['a', 'b', 'c'], 0, -1), ['a', 'b', 'c']);
  assert.deepEqual(deplacer(['a', 'b', 'c'], 2, 9), ['a', 'b', 'c']);
  assert.deepEqual(deplacer(['a', 'b'], 5, 0), ['a', 'b']);
});

test('journal : les morceaux d’une ligne (qui, action, pions renvoyés)', async () => {
  const { detailJournal } = await import('../public/js/ui/libelles.js');
  const joueurs = [{ pseudo: 'Léa' }, { pseudo: 'Max' }, { pseudo: 'Zoé' }, { pseudo: 'Tom' }];
  assert.deepEqual(detailJournal({ siege: 1, coup: { t: 'defausse', carte: '9P' } }, joueurs, 0), { qui: 'Max', action: 'Défausse (aucune carte jouable)', prises: '', defausse: true });
  const sortie = detailJournal({ siege: 0, coup: { t: 'sortie', carte: 'RP', pion: 0 } }, joueurs, 0);
  assert.equal(sortie.qui, 'Toi');
  assert.match(sortie.action, /^Sort un pion/);
  assert.equal(sortie.prises, '');
  assert.equal(sortie.defausse, false);
  const prise = detailJournal({ siege: 2, coup: { t: 'avance', carte: '9C', pion: 8, pas: 9, allee: false }, captures: [4] }, joueurs, 0);
  assert.equal(prise.qui, 'Zoé');
  assert.match(prise.action, /^Avance de 9/);
  assert.match(prise.prises, /^Renvoie .*Max.* à la base$/);
});

test('erreurs : deux versions de l’appli mélangées donnent un message clair, pas le texte du navigateur', async () => {
  const { messageErreur, APPLI_A_RECHARGER } = await import('../public/js/ui/dom.js');
  assert.equal(messageErreur(new TypeError('client.choisirCouleur is not a function')), APPLI_A_RECHARGER);
  assert.equal(messageErreur(new ReferenceError('nomNiveau is not defined')), APPLI_A_RECHARGER);
  assert.equal(messageErreur(new SyntaxError("The requested module './client.js' does not provide an export named 'x'")), APPLI_A_RECHARGER);
  // Les autres erreurs gardent leur message (moteur et réseau parlent déjà français).
  assert.equal(messageErreur(new Error('Ce siège est déjà pris.')), 'Ce siège est déjà pris.');
  assert.equal(messageErreur(new TypeError('Failed to fetch')), 'Failed to fetch');
  assert.equal(messageErreur(null), 'Erreur inconnue.');
});
