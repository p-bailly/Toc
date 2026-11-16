import test from 'node:test';
import assert from 'node:assert/strict';
import {
  qualifier, toursDuJoueur, siegesAnalysables, bilan, casesParPion, enPions, formatPions, etatApresCoup, graduations, graduationsTours, SEUILS,
} from '../public/js/ui/etude-calcul.js';
import { POIDS_DEFAUT } from '../public/js/ia/evaluation.js';
import { etatInitial, marquerEchange, appliquerCoup, coupsLegaux } from '../public/js/moteur/index.js';

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
});

test('analyse : 1 pion d’avance = la valeur d’un pion rentré dans l’évaluation de l’IA', () => {
  assert.equal(casesParPion(4), POIDS_DEFAUT.rentre);
  assert.equal(casesParPion(4), 98);
  assert.equal(casesParPion(3), 82); // circuit de 48 cases : 16 de moins
  assert.equal(casesParPion(), casesParPion(4));
  assert.equal(enPions(98, 4), 1);
  assert.equal(enPions(-41, 3), -0.5);
});

test('analyse : écarts affichés en pions d’avance, en français', () => {
  assert.equal(formatPions(-121), '−1,2 pion'); // le « −121 » d’avant
  assert.equal(formatPions(147, 4, { signe: true }), '+1,5 pion');
  assert.equal(formatPions(29.4, 4, { signe: true }), '+0,3 pion');
  assert.equal(formatPions(196, 4, { signe: true }), '+2 pions');
  assert.equal(formatPions(-245), '−2,5 pions');
  assert.equal(formatPions(98), '1 pion');
  // Sous 1 pion : deux décimales, pour qu’une petite erreur ne s’écrive pas « 0 ».
  assert.equal(formatPions(6), '0,06 pion');
  assert.equal(formatPions(-19), '−0,19 pion');
  assert.equal(formatPions(0.2, 4, { signe: true }), '0 pion');
  assert.equal(formatPions(-0.2), '0 pion');
  assert.equal(formatPions(41, 3, { signe: true }), '+0,5 pion');
  assert.equal(formatPions(-147, 4, { unite: false }), '−1,5');
  assert.equal(formatPions(undefined), '–');
  assert.equal(formatPions(NaN), '–');
});

test('analyse : un autre joueur n’est proposé que si ses mains sont connues', () => {
  const donne = { distribuees: ['AP'], donnee: 'AP', recue: null };
  // En ligne : seules les mains du joueur local.
  assert.deepEqual(siegesAnalysables({ siege: 2, donnes: [donne] }), [2]);
  // Contre l’IA : tous les sièges, le joueur local d’abord.
  assert.deepEqual(siegesAnalysables({ siege: 0, donnes: [donne], donnesParSiege: [[donne], [donne], [donne], [donne]] }), [0, 1, 2, 3]);
  assert.deepEqual(siegesAnalysables({ siege: 1, donnes: [donne], donnesParSiege: [[donne], [donne], [donne]] }), [1, 0, 2]);
  // Un siège sans main gardée n’est pas proposé.
  assert.deepEqual(siegesAnalysables({ siege: 0, donnes: [donne], donnesParSiege: [[donne], [null], undefined, [donne]] }), [0, 3]);
});

test('analyse : tours d’un autre joueur, avec ses propres cartes', () => {
  const etat = (donne) => ({ donne });
  const rejeu = {
    echanges: [{ etat: etat(0) }],
    tours: [
      { n: 1, siege: 0, coup: { t: 'sortie' }, avant: etat(0), apres: etat(0) },
      { n: 2, siege: 1, coup: { t: 'avance' }, avant: etat(0), apres: etat(0) },
    ],
  };
  const moi = [{ distribuees: ['AP', '2P'], donnee: 'AP', recue: '9C' }];
  const lui = [{ distribuees: ['RK', '5T'], donnee: 'RK', recue: '8T' }];
  const mains = [];
  const mainAvantCoup = (donnes) => (mains.push(donnes), ['X']);
  const donnees = { siege: 0, donnes: moi, donnesParSiege: [moi, lui] };
  const items = toursDuJoueur(donnees, rejeu, mainAvantCoup, 1);
  assert.deepEqual(items.map((i) => `${i.type}${i.siege}${i.n ?? ''}`), ['don1', 'coup12']);
  assert.deepEqual(items[0].main, ['RK', '5T']);
  assert.equal(items[0].carte, 'RK');
  assert.deepEqual(items[1].options, { coupJoue: { t: 'avance' }, carteDonnee: 'RK', carteRecue: '8T', max: 3 });
  assert.equal(mains[0], lui);
  // Par défaut : le joueur local. Sans les mains d’un siège (partie en ligne) : rien à analyser.
  assert.deepEqual(toursDuJoueur(donnees, rejeu, mainAvantCoup).map((i) => i.siege), [0, 0]);
  assert.deepEqual(toursDuJoueur({ siege: 0, donnes: moi }, rejeu, mainAvantCoup, 1), []);
});

test('analyse : position montrée après un coup (même donne, tour du joueur qui vient de jouer)', () => {
  let etat = etatInitial({});
  for (let s = 0; s < 4; s++) etat = marquerEchange(etat, s);
  const siege = etat.tour;
  const coup = coupsLegaux(etat, siege, 'AP').find((c) => c.t === 'sortie');
  const apres = appliquerCoup(etat, siege, coup);
  assert.notEqual(apres.tour, siege);
  const montre = etatApresCoup(etat, apres);
  assert.equal(montre.tour, siege);
  assert.equal(montre.phase, 'jeu');
  assert.equal(montre.donne, etat.donne);
  assert.deepEqual(montre.pions, apres.pions);
  assert.deepEqual(montre.pile, [...etat.pile, 'AP']);
  assert.equal(montre.cartesRestantes[siege], etat.cartesRestantes[siege] - 1);
  assert.equal(montre.dernierCoup, apres.dernierCoup);
  // Dernier coup de la donne : le moteur passe à la donne suivante (échange, tas parfois vidé) ; la position
  // montrée reste celle de la donne jouée, la carte posée sur le tas.
  const finDonne = { ...apres, phase: 'echange', donne: etat.donne + 1, pile: [], cartesRestantes: [5, 5, 5, 5], echanges: [false, false, false, false] };
  const m2 = etatApresCoup(etat, finDonne);
  assert.equal(m2.phase, 'jeu');
  assert.equal(m2.donne, etat.donne);
  assert.deepEqual(m2.pile, ['AP']);
  assert.deepEqual(m2.echanges, etat.echanges);
  assert.equal(m2.cartesRestantes[siege], etat.cartesRestantes[siege] - 1);
  // Coup gagnant : la partie reste « finie ».
  assert.equal(etatApresCoup(etat, { ...apres, phase: 'fini' }).phase, 'fini');
  // Joker (jeu à 3) : le rang copié reste lisible sur la carte posée.
  const avant3 = { ...etat, jokers: { J1: '9' } };
  const apres3 = { ...apres, jokers: {}, dernierCoup: { siege, coup: { t: 'avance', carte: 'J2', comme: '5', pion: 0, pas: 5 } } };
  assert.deepEqual(etatApresCoup(avant3, apres3).jokers, { J1: '9', J2: '5' });
});

test('analyse : graduations du graphique (valeurs rondes, zéro compris)', () => {
  assert.deepEqual(graduations(0, 0).valeurs, [-0.5, 0, 0.5]);
  assert.deepEqual(graduations(-0.2, 0.3).valeurs, [-0.5, 0, 0.5]);
  assert.deepEqual(graduations(-1.2, 2.4).valeurs, [-2, -1, 0, 1, 2, 3]);
  assert.deepEqual(graduations(0.4, 1.3).valeurs, [-0.5, 0, 0.5, 1, 1.5]);
  assert.deepEqual(graduations(-3.6, 4.2).valeurs, [-4, -2, 0, 2, 4, 6]);
  const g = graduations(-0.7, 6.1);
  assert.deepEqual(g.valeurs, [-2, 0, 2, 4, 6, 8]);
  assert.equal(g.min, -2);
  assert.equal(g.max, 8);
  assert.equal(g.pas, 2);
  for (const [a, b] of [[-12, 3], [0.1, 0.2], [-40, 55], [NaN, 2]]) {
    const { valeurs, min, max } = graduations(a, b);
    assert.ok(valeurs.includes(0), `zéro dans ${valeurs}`);
    assert.ok(valeurs.length <= 7 && valeurs.length >= 3);
    if (Number.isFinite(a)) assert.ok(min <= a && max >= b);
  }
});

test('analyse : graduations des tours (à partir de 1)', () => {
  assert.deepEqual(graduationsTours(0), []);
  assert.deepEqual(graduationsTours(4), [1, 2, 3, 4]);
  assert.deepEqual(graduationsTours(12), [1, 2, 4, 6, 8, 10, 12]);
  assert.deepEqual(graduationsTours(47), [1, 10, 20, 30, 40]);
  assert.deepEqual(graduationsTours(81), [1, 20, 40, 60, 80]);
  assert.deepEqual(graduationsTours(325), [1, 100, 200, 300]);
  assert.deepEqual(graduationsTours(81, 10), [1, 10, 20, 30, 40, 50, 60, 70, 80]);
});
