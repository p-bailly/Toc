import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BASE, ALLEE, etatInitial, coupsLegaux, coupsLegauxMain, appliquerCoup, validerCoup, mainJouable,
  etapesSeptPossibles, estProtege, couleurActive, aFini, marquerEchange, apercuCoup,
  nouvellePartie, donnerCarte, jouerCoup, distribuerCycle, generateurAleatoire, tailleDonne,
  mainEffective, paquetNeuf, partenaire, caseDepart, caseEntree,
} from '../public/js/moteur/index.js';

/** État en phase de jeu avec des pions placés : { numéroDePion: position }. */
function etat(positions = {}, extra = {}) {
  const e = etatInitial(extra.reglages);
  e.phase = 'jeu';
  e.echanges = [true, true, true, true];
  for (const [g, pos] of Object.entries(positions)) e.pions[g] = pos;
  if (extra.tour !== undefined) e.tour = extra.tour;
  return e;
}
const a = (n) => ALLEE + n;
const cles = (coups) => coups.map((c) => `${c.t}:${c.pion}:${c.pas ?? ''}:${c.allee ? 'A' : ''}${c.cible ?? ''}`).sort();
const legal = (e, siege, coup) => validerCoup(e, siege, coup) === null;

test('paquet : 52 cartes uniques, cycle 5-4-4', () => {
  assert.equal(new Set(paquetNeuf()).size, 52);
  const cycle = distribuerCycle(generateurAleatoire(1));
  assert.deepEqual(cycle.map((d) => d.map((m) => m.length)), [[5, 5, 5, 5], [4, 4, 4, 4], [4, 4, 4, 4]]);
  assert.equal(new Set(cycle.flat(2)).size, 52);
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(tailleDonne), [5, 4, 4, 5, 4, 4]);
});

test('sortie : as et roi seulement, pion posé sur la case de départ', () => {
  const e = etat();
  assert.deepEqual(cles(coupsLegaux(e, 0, 'AP')), ['sortie:0::']);
  assert.deepEqual(cles(coupsLegaux(e, 1, 'RC')), ['sortie:4::']);
  assert.equal(coupsLegaux(e, 0, 'DP').length, 0);
  assert.equal(coupsLegaux(e, 0, '7P').length, 0);
  const n = appliquerCoup(e, 0, { t: 'sortie', carte: 'AP', pion: 2 }, ['AP']);
  assert.equal(n.pions[2], 0);
  assert.equal(n.tour, 1);
  assert.deepEqual(n.pile, ['AP']);
  assert.equal(estProtege(n, 2), true);
  const m = appliquerCoup(etat({}, { tour: 3 }), 3, { t: 'sortie', carte: 'RK', pion: 12 });
  assert.equal(m.pions[12], 48);
});

test("sortie : renvoie à la base le pion présent sur sa case de départ, même le sien", () => {
  let n = appliquerCoup(etat({ 0: 0 }), 0, { t: 'sortie', carte: 'AP', pion: 1 });
  assert.equal(n.pions[0], BASE);
  assert.equal(n.pions[1], 0);
  n = appliquerCoup(etat({ 4: 0 }), 0, { t: 'sortie', carte: 'RP', pion: 0 });
  assert.equal(n.pions[4], BASE);
  assert.deepEqual(n.dernierCoup.captures, [4]);
});

test('avance : valeur faciale, as 1 ou 11, roi 13, dame 12', () => {
  const e = etat({ 0: 5 });
  assert.deepEqual(cles(coupsLegaux(e, 0, 'AP')), ['avance:0:11:', 'avance:0:1:', 'sortie:1::'].sort());
  assert.deepEqual(cles(coupsLegaux(e, 0, 'RP')), ['avance:0:13:', 'sortie:1::']);
  assert.deepEqual(cles(coupsLegaux(e, 0, 'DP')), ['avance:0:12:']);
  for (const r of ['2', '3', '5', '6', '8', '9', '10']) {
    assert.deepEqual(cles(coupsLegaux(e, 0, r + 'C')), [`avance:0:${r}:`]);
    assert.equal(appliquerCoup(e, 0, { t: 'avance', carte: r + 'C', pion: 0, pas: +r }).pions[0], 5 + +r);
  }
  assert.equal(legal(e, 0, { t: 'avance', carte: '8C', pion: 0, pas: 9 }), false);
  assert.equal(legal(e, 0, { t: 'avance', carte: 'AP', pion: 0, pas: 13 }), false);
  assert.equal(legal(e, 0, { t: 'avance', carte: '4C', pion: 0, pas: 4 }), false);
  assert.equal(legal(e, 0, { t: 'avance', carte: '7C', pion: 0, pas: 7 }), false);
});

test("avance : on ne déplace que ses propres pions, le circuit boucle de 63 à 0", () => {
  const e = etat({ 4: 60, 0: 3 }, { tour: 1 });
  assert.equal(legal(e, 1, { t: 'avance', carte: '6C', pion: 0, pas: 6 }), false);
  assert.equal(appliquerCoup(e, 1, { t: 'avance', carte: '6C', pion: 4, pas: 6 }).pions[4], 2);
});

test('capture : arriver sur une case occupée renvoie le pion à la base (adverse, allié ou le sien)', () => {
  for (const victime of [4, 8, 1]) {
    const e = etat({ 0: 5, [victime]: 11 });
    const n = appliquerCoup(e, 0, { t: 'avance', carte: '6C', pion: 0, pas: 6 });
    assert.equal(n.pions[victime], BASE);
    assert.equal(n.pions[0], 11);
    assert.deepEqual(n.dernierCoup.captures, [victime]);
  }
});

test('un déplacement normal passe par-dessus un pion non protégé sans le capturer', () => {
  const n = appliquerCoup(etat({ 0: 5, 4: 8 }), 0, { t: 'avance', carte: '6C', pion: 0, pas: 6 });
  assert.equal(n.pions[4], 8);
  assert.equal(n.pions[0], 11);
});

test('pion protégé sur sa case de départ : ni dépassé, ni capturé, ni échangé', () => {
  // Pion 4 (siège 1) sur sa case de départ 16.
  const e = etat({ 0: 12, 4: 16, 1: 20 });
  assert.equal(estProtege(e, 4), true);
  assert.equal(legal(e, 0, { t: 'avance', carte: '6C', pion: 0, pas: 6 }), false); // dépassement
  assert.equal(legal(e, 0, { t: 'avance', carte: '3C', pion: 0, pas: 3 }), true); // s'arrête avant
  const e4 = etat({ 0: 12, 4: 16, 1: 20 });
  e4.pions[0] = 12;
  assert.equal(legal(etat({ 0: 12, 4: 16 }), 0, { t: 'avance', carte: '2C', pion: 0, pas: 2 }), true);
  assert.equal(legal(etat({ 0: 12, 4: 16 }), 0, { t: 'avance', carte: '6C', pion: 0, pas: 6 }), false);
  // arrivée exacte sur le pion protégé
  const e2 = etat({ 0: 10, 4: 16 });
  assert.equal(legal(e2, 0, { t: 'avance', carte: '6C', pion: 0, pas: 6 }), false);
  // recul de 4 par-dessus ou sur un pion protégé
  assert.equal(legal(etat({ 0: 18, 4: 16 }), 0, { t: 'recul', carte: '4C', pion: 0 }), false);
  assert.equal(legal(etat({ 0: 20, 4: 16 }), 0, { t: 'recul', carte: '4C', pion: 0 }), false);
  // valet
  assert.equal(legal(etat({ 0: 10, 4: 16 }), 0, { t: 'echange', carte: 'VC', pion: 0, cible: 4 }), false);
  // 7
  assert.equal(coupsLegaux(etat({ 0: 12, 4: 16 }), 0, '7C').length, 0);
});

test('le propriétaire ne dépasse pas non plus son pion protégé ; la protection tombe quand il quitte la case', () => {
  const e = etat({ 0: 0, 1: 60 });
  assert.equal(legal(e, 0, { t: 'avance', carte: '6C', pion: 1, pas: 6 }), false);
  assert.equal(legal(e, 0, { t: 'avance', carte: '6C', pion: 1, pas: 6, allee: true }), false);
  // l'entrée de l'allée est avant la case de départ : le pion protégé ne gêne pas la rentrée
  assert.equal(legal(e, 0, { t: 'avance', carte: '3C', pion: 1, pas: 3, allee: true }), true);
  // un pion étranger sur une case de départ qui n'est pas la sienne n'est pas protégé
  const f = etat({ 0: 16, 4: 12 }, { tour: 1 });
  assert.equal(estProtege(f, 0), false);
  const n = appliquerCoup(f, 1, { t: 'avance', carte: '6C', pion: 4, pas: 4 + 2 });
  assert.equal(n.pions[4], 18);
  const g = appliquerCoup(etat({ 0: 16, 4: 12 }, { tour: 1 }), 1, { t: 'avance', carte: '6C', pion: 4, pas: 6 });
  assert.equal(g.pions[0], 16);
  const h = etat({ 0: 16, 4: 13 }, { tour: 1 });
  assert.equal(appliquerCoup(h, 1, { t: 'avance', carte: '3C', pion: 4, pas: 3 }).pions[0], BASE);
});

test("4 : recule de 4, capture à l'arrivée, interdit dans la base ou l'allée", () => {
  const e = etat({ 0: 2, 4: 62, 1: a(0) });
  assert.deepEqual(cles(coupsLegaux(e, 0, '4C')), ['recul:0::']);
  const n = appliquerCoup(e, 0, { t: 'recul', carte: '4C', pion: 0 });
  assert.equal(n.pions[0], 62);
  assert.equal(n.pions[4], BASE);
  assert.equal(legal(e, 0, { t: 'recul', carte: '4C', pion: 1 }), false);
  assert.equal(legal(e, 0, { t: 'recul', carte: '4C', pion: 2 }), false);
  // passe par-dessus sans capturer
  const m = appliquerCoup(etat({ 0: 10, 4: 8 }), 0, { t: 'recul', carte: '4C', pion: 0 });
  assert.equal(m.pions[4], 8);
  assert.equal(m.pions[0], 6);
});

test("l'entrée de l'allée est 3 cases avant la case de départ : sortie, 4 en arrière, puis 5 = fond de l'allée", () => {
  for (let s = 0; s < 4; s++) {
    assert.equal(caseEntree(s), (caseDepart(s) + 61) % 64);
    const g = s * 4;
    let e = etat({ [g]: caseDepart(s) }, { tour: s });
    // depuis la case de départ, on ne rentre pas directement : l'entrée est derrière
    assert.deepEqual(cles(coupsLegaux(e, s, '2C')), [`avance:${g}:2:`]);
    e = appliquerCoup(e, s, { t: 'recul', carte: '4C', pion: g });
    assert.equal(e.pions[g], (caseEntree(s) + 63) % 64); // une case avant l'entrée
    e.tour = s;
    assert.deepEqual(cles(coupsLegaux(e, s, '5C')), [`avance:${g}:5:`, `avance:${g}:5:A`]);
    assert.deepEqual(cles(coupsLegaux(e, s, '2C')), [`avance:${g}:2:`, `avance:${g}:2:A`]);
    assert.deepEqual(cles(coupsLegaux(e, s, '6C')), [`avance:${g}:6:`]); // trop grand : continue le tour
    assert.equal(appliquerCoup(e, s, { t: 'avance', carte: '2C', pion: g, pas: 2, allee: true }).pions[g], a(0));
    const n = appliquerCoup(e, s, { t: 'avance', carte: '5C', pion: g, pas: 5, allee: true });
    assert.equal(n.pions[g], a(3));
    // sans entrer : le 5 l'amène une case après sa case de départ
    assert.equal(appliquerCoup(e, s, { t: 'avance', carte: '5C', pion: g, pas: 5 }).pions[g], (caseDepart(s) + 1) % 64);
  }
});

test("allée : entrée facultative, compte exact, carte trop grande = on continue le tour", () => {
  // siège 0 : case d'entrée 61. Pion en 59 (2 cases avant l'entrée).
  const e = etat({ 0: 59 });
  assert.deepEqual(cles(coupsLegaux(e, 0, '3C')), ['avance:0:3:', 'avance:0:3:A']);
  assert.equal(appliquerCoup(e, 0, { t: 'avance', carte: '3C', pion: 0, pas: 3, allee: true }).pions[0], a(0));
  assert.equal(appliquerCoup(e, 0, { t: 'avance', carte: '3C', pion: 0, pas: 3 }).pions[0], 62);
  assert.equal(appliquerCoup(e, 0, { t: 'avance', carte: '6C', pion: 0, pas: 6, allee: true }).pions[0], a(3));
  // 2 : arrive pile sur la case d'entrée (pas dans l'allée) ; 8 : trop grand, continue sur le circuit
  assert.deepEqual(cles(coupsLegaux(e, 0, '2C')), ['avance:0:2:']);
  assert.deepEqual(cles(coupsLegaux(e, 0, '8C')), ['avance:0:8:']);
  assert.equal(appliquerCoup(e, 0, { t: 'avance', carte: '8C', pion: 0, pas: 8 }).pions[0], 3);
  // un pion posé sur sa case d'entrée peut ensuite entrer (1 à 4) ou continuer
  const r = appliquerCoup(e, 0, { t: 'avance', carte: '2C', pion: 0, pas: 2 });
  assert.equal(r.pions[0], 61);
  r.tour = 0;
  assert.deepEqual(cles(coupsLegaux(r, 0, '3C')), ['avance:0:3:', 'avance:0:3:A']);
  assert.equal(appliquerCoup(r, 0, { t: 'avance', carte: '3C', pion: 0, pas: 3, allee: true }).pions[0], a(2));
  assert.deepEqual(cles(coupsLegaux(r, 0, '5C')), ['avance:0:5:']);
  // un pion qui a dépassé l'entrée (62, 63) doit refaire un tour
  assert.deepEqual(cles(coupsLegaux(etat({ 0: 62 }), 0, '3C')), ['avance:0:3:']);
  assert.deepEqual(cles(coupsLegaux(etat({ 0: 63 }), 0, 'AC')), ['avance:0:11:', 'avance:0:1:', 'sortie:1::']);
  // le 4 repasse par-dessus l'entrée sans entrer dans l'allée
  assert.equal(appliquerCoup(etat({ 0: 63 }), 0, { t: 'recul', carte: '4C', pion: 0 }).pions[0], 59);
  // l'allée d'un autre joueur ne le concerne pas (entrée du siège 1 : case 13)
  assert.deepEqual(cles(coupsLegaux(etat({ 0: 12 }), 0, '3C')), ['avance:0:3:']);
  assert.deepEqual(cles(coupsLegaux(etat({ 4: 12 }, { tour: 1 }), 1, '3C')), ['avance:4:3:', 'avance:4:3:A']);
});

test("allée : on ne dépasse pas, on ne bouscule pas ses pions, compte exact à l'intérieur", () => {
  const e = etat({ 0: a(1), 1: 60, 2: a(3) });
  // pion 1 : entrer en a(0) possible (2 pas), a(1) occupée, au-delà bloqué
  assert.deepEqual(cles(coupsLegaux(e, 0, '2C')), ['avance:1:2:', 'avance:1:2:A']);
  assert.deepEqual(cles(coupsLegaux(e, 0, '3C')), ['avance:1:3:']);
  assert.deepEqual(cles(coupsLegaux(e, 0, '5C')), ['avance:1:5:']);
  // pion 0 en a(1) : 1 pas possible (a(2)), 2 pas interdit (a(3) occupée)
  assert.deepEqual(cles(coupsLegaux(e, 0, 'AC')), ['avance:0:1:A', 'avance:1:11:', 'avance:1:1:', 'sortie:3::'].sort());
  const f = etat({ 0: a(0) });
  assert.deepEqual(cles(coupsLegaux(f, 0, '3C')), ['avance:0:3:A']);
  assert.equal(coupsLegaux(f, 0, '5C').length, 0);
  assert.equal(coupsLegaux(f, 0, '4C').length, 0);
  assert.equal(coupsLegaux(f, 0, 'VC').length, 0);
  assert.equal(coupsLegaux(etat({ 0: a(3) }), 0, '2C').length, 0);
});

test('valet : un des siens contre un autre, jamais base, allée ni pion protégé', () => {
  const e = etat({ 0: 5, 1: 30, 2: a(0), 4: 20, 5: 16, 8: 40, 9: a(1) });
  assert.deepEqual(cles(coupsLegaux(e, 0, 'VC')), ['echange:0::4', 'echange:0::8', 'echange:1::4', 'echange:1::8']);
  const n = appliquerCoup(e, 0, { t: 'echange', carte: 'VC', pion: 0, cible: 4 });
  assert.equal(n.pions[0], 20);
  assert.equal(n.pions[4], 5);
  assert.equal(legal(e, 0, { t: 'echange', carte: 'VC', pion: 0, cible: 1 }), false); // deux des siens
  assert.equal(legal(e, 0, { t: 'echange', carte: 'VC', pion: 4, cible: 8 }), false); // aucun des siens
  assert.equal(legal(e, 0, { t: 'echange', carte: 'VC', pion: 0, cible: 5 }), false); // protégé
  assert.equal(legal(e, 0, { t: 'echange', carte: 'VC', pion: 2, cible: 4 }), false); // allée
  assert.equal(legal(e, 0, { t: 'echange', carte: 'VC', pion: 0, cible: 9 }), false);
  assert.equal(legal(e, 0, { t: 'echange', carte: 'VC', pion: 3, cible: 4 }), false); // base
  // son propre pion protégé ne peut pas être échangé
  assert.equal(coupsLegaux(etat({ 0: 0, 4: 20 }), 0, 'VC').length, 0);
  // un pion amené par échange sur sa case de départ devient protégé
  const p = appliquerCoup(etat({ 0: 16, 4: 30 }), 0, { t: 'echange', carte: 'VC', pion: 0, cible: 4 });
  assert.equal(estProtege(p, 4), true);
});

test('7 : fractionnable, tous les points utilisés, pions dépassés renvoyés à la base', () => {
  const e = etat({ 0: 5, 1: 20 });
  const coups = coupsLegaux(e, 0, '7C');
  assert.equal(coups.length, 8); // 0..7 pas pour le pion 0, le reste pour le pion 1
  for (const c of coups) assert.equal(c.etapes.reduce((s, x) => s + x.pas, 0), 7);
  const n = appliquerCoup(e, 0, { t: 'sept', carte: '7C', etapes: [{ pion: 0, pas: 3 }, { pion: 1, pas: 4 }] });
  assert.equal(n.pions[0], 8);
  assert.equal(n.pions[1], 24);
  assert.equal(legal(e, 0, { t: 'sept', carte: '7C', etapes: [{ pion: 0, pas: 3 }, { pion: 1, pas: 3 }] }), false);
  assert.equal(legal(e, 0, { t: 'sept', carte: '7C', etapes: [{ pion: 0, pas: 5 }, { pion: 1, pas: 3 }] }), false);
  // dépassement = capture, y compris allié et soi-même
  const f = etat({ 0: 5, 1: 7, 8: 8, 4: 10 });
  const m = appliquerCoup(f, 0, { t: 'sept', carte: '7C', etapes: [{ pion: 0, pas: 7 }] });
  assert.equal(m.pions[0], 12);
  assert.equal(m.pions[1], BASE);
  assert.equal(m.pions[8], BASE);
  assert.equal(m.pions[4], BASE);
  assert.deepEqual(m.dernierCoup.captures.slice().sort(), [1, 4, 8]);
});

test('7 : entrée dans l’allée, blocage dans l’allée, 7 injouable si les 7 points ne passent pas', () => {
  // pion 0 en a(1), pion 1 en a(3) : le pion 0 ne peut avancer que de 1 → 7 injouable
  assert.equal(coupsLegaux(etat({ 0: a(1), 1: a(3) }), 0, '7C').length, 0);
  // pion 0 en a(0) (3 pas max) + pion 1 sur le circuit : 3 + 4, 2 + 5, 1 + 6, 0 + 7
  const e = etat({ 0: a(0), 1: 30 });
  assert.equal(coupsLegaux(e, 0, '7C').length, 4);
  // entrée dans l'allée par un 7 : 59 → a(3) = 6 pas, puis 1 pas avec un autre pion
  const f = etat({ 0: 59, 1: 30 });
  assert.equal(legal(f, 0, { t: 'sept', carte: '7C', etapes: [{ pion: 0, pas: 6, allee: true }, { pion: 1, pas: 1 }] }), true);
  assert.equal(legal(f, 0, { t: 'sept', carte: '7C', etapes: [{ pion: 0, pas: 7, allee: true }] }), false);
  // aucun pion sur le circuit : 7 injouable
  assert.equal(coupsLegaux(etat(), 0, '7C').length, 0);
});

test('7 : le reste profite au partenaire une fois ses propres pions rentrés', () => {
  const e = etat({ 0: a(3), 1: a(2), 2: a(1), 3: 59, 8: 40 });
  // le pion 3 rentre en a(0) avec 3 pas, les 4 points restants vont au partenaire (pion 8)
  const coup = { t: 'sept', carte: '7C', etapes: [{ pion: 3, pas: 3, allee: true }, { pion: 8, pas: 4 }] };
  assert.equal(legal(e, 0, coup), true);
  const n = appliquerCoup(e, 0, coup);
  assert.equal(n.pions[3], a(0));
  assert.equal(n.pions[8], 44);
  // tant que ses pions ne sont pas tous rentrés, il ne déplace pas ceux du partenaire
  assert.equal(legal(e, 0, { t: 'sept', carte: '7C', etapes: [{ pion: 8, pas: 7 }] }), false);
  assert.equal(legal(e, 0, { t: 'sept', carte: '7C', etapes: [{ pion: 8, pas: 4 }, { pion: 3, pas: 3, allee: true }] }), false);
  const aide = etapesSeptPossibles(e, 0, [{ pion: 3, pas: 3, allee: true }]);
  assert.equal(aide.reste, 4);
  // seul le pion du partenaire peut encore bouger (en une ou plusieurs étapes)
  assert.deepEqual(aide.options.map((o) => o.pion + ':' + o.pas), ['8:1', '8:2', '8:3', '8:4']);
});

test('etapesSeptPossibles ne propose que des étapes qui permettent de finir le 7', () => {
  const e = etat({ 0: a(0), 1: a(3) }); // pion 0 : 2 pas max → 7 impossible
  assert.deepEqual(etapesSeptPossibles(e, 0).options, []);
  const f = etat({ 0: a(0), 1: 30 });
  const aide = etapesSeptPossibles(f, 0);
  assert.equal(aide.reste, 7);
  // le pion 0 peut prendre 1 à 3 pas ; le pion 1 de 1 à 7 (en une ou plusieurs étapes)
  assert.deepEqual(aide.options.filter((o) => o.pion === 0).map((o) => o.pas), [1, 2, 3]);
  assert.deepEqual(aide.options.filter((o) => o.pion === 1).map((o) => o.pas), [1, 2, 3, 4, 5, 6, 7]);
  // après 3 pas dans l'allée, le pion 0 est au fond : le reste revient au pion 1
  const suite = etapesSeptPossibles(f, 0, [{ pion: 0, pas: 3, allee: true }]);
  assert.deepEqual(suite.options.map((o) => o.pion), [1, 1, 1, 1]);
  assert.equal(etapesSeptPossibles(f, 0, [{ pion: 0, pas: 4, allee: true }]), null);
});

test('5 adverse : option de réglage', () => {
  const sans = etat({ 0: 5, 4: 20, 8: 40 });
  assert.deepEqual(cles(coupsLegaux(sans, 0, '5C')), ['avance:0:5:']);
  assert.equal(legal(sans, 0, { t: 'avance', carte: '5C', pion: 4, pas: 5 }), false);
  const avec = etat({ 0: 5, 4: 20, 5: 16, 6: a(0), 8: 40 }, { reglages: { cinqAdverse: true } });
  // pion adverse 4 jouable ; 5 protégé, 6 dans l'allée, 8 = partenaire : non
  assert.deepEqual(cles(coupsLegaux(avec, 0, '5C')), ['avance:0:5:', 'avance:4:5:']);
  assert.equal(appliquerCoup(avec, 0, { t: 'avance', carte: '5C', pion: 4, pas: 5 }).pions[4], 25);
  assert.equal(legal(avec, 0, { t: 'avance', carte: '5C', pion: 5, pas: 5 }), false);
  assert.equal(legal(avec, 0, { t: 'avance', carte: '5C', pion: 8, pas: 5 }), false);
  assert.equal(legal(avec, 0, { t: 'avance', carte: '6C', pion: 4, pas: 6 }), false);
  // un pion adverse poussé ne rentre jamais dans son allée
  const pres = etat({ 4: 11 }, { reglages: { cinqAdverse: true } });
  assert.deepEqual(cles(coupsLegaux(pres, 0, '5C')), ['avance:4:5:']);
  assert.equal(appliquerCoup(pres, 0, { t: 'avance', carte: '5C', pion: 4, pas: 5 }).pions[4], 16);
  assert.equal(legal(pres, 0, { t: 'avance', carte: '5C', pion: 4, pas: 5, allee: true }), false);
});

test('obligation de jouer et défausse', () => {
  const e = etat({ 0: 5 });
  assert.equal(mainJouable(e, 0, ['VC', '7P', '4K']), true);
  assert.match(validerCoup(e, 0, { t: 'defausse', carte: 'VC' }, ['VC', '8P']), /Défausse interdite/);
  const vide = etat();
  assert.equal(mainJouable(vide, 0, ['VC', '7P', '4K', '10T', 'DP']), false);
  assert.deepEqual(coupsLegauxMain(vide, 0, ['VC', '7P', '7K']).map((c) => c.t + c.carte), ['defausseVC', 'defausse7P']);
  const n = appliquerCoup(vide, 0, { t: 'defausse', carte: '7P' }, ['VC', '7P']);
  assert.deepEqual(n.pile, ['7P']);
  assert.equal(n.cartesRestantes[0], 4);
  assert.equal(n.tour, 1);
  assert.match(validerCoup(vide, 0, { t: 'defausse', carte: 'AP' }, ['VC']), /pas dans la main/);
  assert.match(validerCoup(vide, 1, { t: 'defausse', carte: 'VC' }, ['VC']), /pas à ce joueur/);
});

test('un joueur qui a fini joue pour son partenaire (sortie, valet, déplacements)', () => {
  const e = etat({ 0: a(0), 1: a(1), 2: a(2), 3: a(3), 8: 40, 4: 20 });
  assert.equal(aFini(e, 0), true);
  assert.equal(couleurActive(e, 0), 2);
  assert.deepEqual(cles(coupsLegaux(e, 0, 'RC')), ['avance:8:13:', 'sortie:9::']);
  assert.equal(appliquerCoup(e, 0, { t: 'sortie', carte: 'RC', pion: 9 }).pions[9], 32);
  assert.deepEqual(cles(coupsLegaux(e, 0, 'VC')), ['echange:8::4']);
  assert.deepEqual(cles(coupsLegaux(e, 0, '4C')), ['recul:8::']);
  assert.equal(coupsLegaux(e, 0, '7C').length, 1);
  // le partenaire, lui, ne déplace que ses pions
  assert.equal(couleurActive(e, 2), 2);
});

test('fin de partie : les deux joueurs d’une équipe ont rentré leurs 4 pions', () => {
  const e = etat({ 0: a(0), 1: a(1), 2: a(2), 3: a(3), 8: a(3), 9: a(2), 10: a(1), 11: 28 }, { tour: 2 });
  const n = appliquerCoup(e, 2, { t: 'avance', carte: '2C', pion: 11, pas: 2, allee: true });
  assert.equal(n.phase, 'fini');
  assert.equal(n.gagnant, 0);
  assert.equal(validerCoup(n, 3, { t: 'defausse', carte: '2P' }) !== null, true);
});

test('fin de donne : nouvelle donne, échange, premier joueur tournant, pile vidée au remélange', () => {
  let e = etat();
  e.cartesRestantes = [0, 0, 0, 1];
  e.tour = 3;
  e.pile = ['AP'];
  let n = appliquerCoup(e, 3, { t: 'defausse', carte: '2P' });
  assert.equal(n.donne, 1);
  assert.equal(n.phase, 'echange');
  assert.deepEqual(n.cartesRestantes, [4, 4, 4, 4]);
  assert.equal(n.tour, 1);
  assert.deepEqual(n.pile, ['AP', '2P']);
  assert.deepEqual(n.echanges, [false, false, false, false]);
  for (const s of [0, 1, 2]) n = marquerEchange(n, s);
  assert.equal(n.phase, 'echange');
  assert.throws(() => marquerEchange(n, 0));
  n = marquerEchange(n, 3);
  assert.equal(n.phase, 'jeu');
  e = etat();
  e.donne = 2;
  e.cartesRestantes = [1, 0, 0, 0];
  e.pile = ['AP'];
  n = appliquerCoup(e, 0, { t: 'defausse', carte: '2P' });
  assert.equal(n.donne, 3);
  assert.deepEqual(n.pile, []);
  assert.deepEqual(n.cartesRestantes, [5, 5, 5, 5]);
  assert.equal(n.tour, 3);
});

test('apercuCoup décrit les déplacements sans modifier l’état', () => {
  const e = etat({ 0: 5, 4: 11 });
  const ap = apercuCoup(e, 0, { t: 'avance', carte: '6C', pion: 0, pas: 6 });
  assert.deepEqual(ap.captures, [4]);
  assert.deepEqual(ap.deplacements, [{ pion: 4, de: 11, vers: BASE, capture: true }, { pion: 0, de: 5, vers: 11 }]);
  assert.equal(e.pions[0], 5);
  assert.equal(apercuCoup(e, 0, { t: 'avance', carte: '6C', pion: 4, pas: 6 }), null);
});

test('mainEffective : distribuées − donnée + reçue − jouées', () => {
  assert.deepEqual(mainEffective(['AP', '2P', '3P', '4P', '5P'], '2P', 'RC', ['AP', 'DK']), ['3P', '4P', '5P', 'RC']);
  assert.deepEqual(mainEffective(['AP', '2P'], null, null, []), ['AP', '2P']);
});

test('partie locale : échange simultané des cartes entre partenaires', () => {
  let p = nouvellePartie({}, generateurAleatoire(7));
  const dons = p.mains.map((m) => m[0]);
  for (let s = 0; s < 4; s++) {
    assert.equal(p.etat.phase, 'echange');
    p = donnerCarte(p, s, dons[s]);
  }
  assert.equal(p.etat.phase, 'jeu');
  for (let s = 0; s < 4; s++) {
    assert.equal(p.mains[s].length, 5);
    assert.ok(p.mains[s].includes(dons[partenaire(s)]));
    assert.ok(!p.mains[s].includes(dons[s]));
  }
  assert.throws(() => donnerCarte(p, 0, p.mains[0][0]));
});

test('parties aléatoires complètes : invariants et fin de partie', () => {
  for (let graine = 1; graine <= 60; graine++) {
    const rng = generateurAleatoire(graine);
    let p = nouvellePartie({ cinqAdverse: graine % 2 === 0 }, rng);
    let garde = 0;
    while (p.etat.phase !== 'fini') {
      assert.ok(++garde < 20000, 'partie interminable');
      if (p.etat.phase === 'echange') {
        assert.deepEqual(p.mains.map((m) => m.length), Array(4).fill(tailleDonne(p.etat.donne)));
        for (let s = 0; s < 4; s++) p = donnerCarte(p, s, p.mains[s][Math.floor(rng() * p.mains[s].length)]);
        continue;
      }
      const s = p.etat.tour;
      const coups = coupsLegauxMain(p.etat, s, p.mains[s]);
      assert.ok(coups.length > 0);
      // préférer les coups qui font avancer la partie pour qu'elle se termine
      const coup = coups[Math.floor(rng() * coups.length)];
      assert.equal(validerCoup(p.etat, s, coup, p.mains[s]), null);
      p = jouerCoup(p, s, coup, rng);
      // invariants
      const occ = p.etat.pions.filter((x) => x >= 0 && x < 64);
      assert.equal(new Set(occ).size, occ.length, 'deux pions sur la même case');
      for (let j = 0; j < 4; j++) {
        const al = p.etat.pions.slice(j * 4, j * 4 + 4).filter((x) => x >= ALLEE);
        assert.equal(new Set(al).size, al.length, "deux pions sur la même case d'allée");
        for (const x of al) assert.ok(x <= ALLEE + 3);
      }
      if (p.etat.phase === 'jeu') assert.deepEqual(p.mains.map((m) => m.length), p.etat.cartesRestantes);
      // tous les coups « sept » générés sont validés par le moteur
      if (garde % 37 === 0) {
        for (const c of coupsLegaux(p.etat, p.etat.tour, '7P')) assert.ok(apercuCoup(p.etat, p.etat.tour, c));
      }
    }
    assert.ok(p.etat.gagnant === 0 || p.etat.gagnant === 1);
  }
});
