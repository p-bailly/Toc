import './plateau-16.js';
// Règles du jeu à 3 joueurs (chacun pour soi), décidées par le propriétaire :
//  - circuit de 48 cases (3 côtés de 16), géométrie de chaque siège identique au jeu à 4 ;
//  - pas d'équipe ni de partenaire (valet, 7, 5 adverse, joueur qui a fini) ;
//  - le premier joueur qui rentre ses 4 pions gagne ;
//  - 54 cartes (deux jokers), cycle 5-4-4-5, premier joueur tournant (donne % 3) ;
//  - échange avec le voisin de gauche (donnes paires) ou de droite (donnes impaires) ;
//  - joker : copie une carte posée (jouée ou défaussée) pendant la donne en cours.
//
// Les scénarios sont écrits pour le siège 0 puis tournés pour chaque siège : le pion g devient
// (g + 4s) mod 12, la case c devient (c + 16s) mod 48 ; base et allée sont inchangées.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BASE, ALLEE, NB_PIONS, NB_SIEGES, etatInitial, coupsLegaux, coupsLegauxMain, appliquerCoup,
  validerCoup, mainJouable, apercuCoup, marquerEchange, estProtege, couleurActive, aFini, normaliserCoup,
  nouvellePartie, donnerCarte, jouerCoup, distribuerCycle, generateurAleatoire, tailleDonne, taillesDonne,
  longueurCycle, paquetNeuf, partenaire, equipe, caseDepart, caseEntree, nbCases, nbPions, destinataireDon,
  donneurDon, siegeSuivant, estCircuit, rangsCopiables, cartesDeLaDonne, nombreJoueurs, siegesGagnants,
  debutDeCycle, etapesSeptPossibles, estJoker, estCarteDuJeu, JOKERS, mainEffective,
} from '../public/js/moteur/index.js';

// ---------------------------------------------------------------------------
// Outils
// ---------------------------------------------------------------------------

const a = (n) => ALLEE + n;
const SIEGES = [0, 1, 2];
const P = (s, g) => (g + 4 * s) % 12; // pion tourné
const C = (s, pos) => (pos >= 0 && pos < 48 ? (pos + 16 * s) % 48 : pos); // case tournée
const S = (s, siege) => (siege + s) % 3; // siège tourné

/** État de jeu à 3, décrit pour le siège 0 puis tourné de s sièges. */
function etat3(s, positions = {}, extra = {}) {
  const e = etatInitial({ nbJoueurs: 3, ...(extra.reglages || {}) });
  e.phase = 'jeu';
  e.echanges = [true, true, true];
  for (const [g, pos] of Object.entries(positions)) e.pions[P(s, +g)] = C(s, pos);
  e.tour = ((extra.tour ?? 0) + s) % 3;
  if (extra.posees) poser(e, extra.posees);
  if (extra.jokers) e.jokers = { ...extra.jokers };
  return e;
}

/** Ajoute des cartes posées pendant la donne en cours (pile + cartes restantes cohérentes). */
function poser(e, cartes) {
  for (let i = 0; i < cartes.length; i++) {
    e.pile.push(cartes[i]);
    e.cartesRestantes[(e.tour + 1 + i) % 3] -= 1;
  }
  return e;
}

function coupTourne(s, coup) {
  const c = { ...coup };
  if (c.pion !== undefined) c.pion = P(s, c.pion);
  if (c.cible !== undefined) c.cible = P(s, c.cible);
  if (c.etapes) c.etapes = c.etapes.map((x) => ({ ...x, pion: P(s, x.pion) }));
  return c;
}
const legalT = (s, e, siege, coup) => validerCoup(e, S(s, siege), coupTourne(s, coup)) === null;
const jouerT = (s, e, siege, coup) => appliquerCoup(e, S(s, siege), coupTourne(s, coup));
const posT = (s, etat, g) => etat.pions[P(s, g)];
const avecAllee = (coups) => coups.filter((c) => c.allee);
const cle = (pions) => pions.join(',');
const plateaux = (e, siege, coups) => new Set(coups.map((c) => cle(apercuCoup(e, siege, c).pions)));

/** Vérifie la compatibilité Firestore : ni undefined, ni tableau directement dans un tableau. */
function compatibleFirestore(v, chemin = 'etat') {
  assert.notEqual(v, undefined, `${chemin} : undefined`);
  if (Array.isArray(v)) {
    v.forEach((x, i) => {
      assert.ok(!Array.isArray(x), `${chemin}[${i}] : tableau imbriqué`);
      compatibleFirestore(x, `${chemin}[${i}]`);
    });
  } else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) compatibleFirestore(x, `${chemin}.${k}`);
  }
}

// ---------------------------------------------------------------------------
// Plateau, état initial, compatibilité du jeu à 4
// ---------------------------------------------------------------------------

test('3 joueurs : géométrie (48 cases, sorties 16·s, entrées 3 cases avant)', () => {
  assert.equal(nbCases(3), 48);
  assert.equal(nbPions(3), 12);
  assert.deepEqual(SIEGES.map(caseDepart), [0, 16, 32]);
  assert.deepEqual(SIEGES.map((s) => caseEntree(s, 3)), [45, 13, 29]);
  assert.deepEqual(SIEGES.map((s) => partenaire(s, 3)), [null, null, null]);
  assert.deepEqual(SIEGES.map((s) => equipe(s, 3)), [0, 1, 2]);
  assert.deepEqual(SIEGES.map((s) => siegeSuivant(s, 3)), [1, 2, 0]);
  assert.equal(estCircuit(47, 3), true);
  assert.equal(estCircuit(48, 3), false);
  // le jeu à 4 est inchangé
  assert.equal(nbCases(4), 64);
  assert.equal(NB_PIONS, 16);
  assert.equal(NB_SIEGES, 4);
  assert.equal(nbCases(), 64);
  assert.equal(caseEntree(0), 61);
  assert.equal(partenaire(1), 3);
  assert.equal(equipe(3), 1);
  assert.equal(estCircuit(60), true);
});

test('3 joueurs : état initial ; état du jeu à 4 strictement inchangé (règles Firestore)', () => {
  const e = etatInitial({ nbJoueurs: 3, cinqAdverse: true });
  assert.deepEqual(e, {
    v: 1,
    reglages: { cinqAdverse: true, nbJoueurs: 3 },
    pions: Array(12).fill(BASE),
    phase: 'echange',
    donne: 0,
    tour: 0,
    echanges: [false, false, false],
    cartesRestantes: [5, 5, 5],
    pile: [],
    numCoup: 0,
    gagnant: null,
    dernierCoup: null,
    jokers: {},
  });
  assert.equal(nombreJoueurs(e), 3);
  compatibleFirestore(e);
  // À 4 : aucun champ de plus (firestore.rules : e.keys().hasOnly([...]) et reglages == { cinqAdverse })
  for (const r of [undefined, {}, { cinqAdverse: true }, { nbJoueurs: 4 }]) {
    const q = etatInitial(r);
    assert.deepEqual(Object.keys(q).sort(), ['cartesRestantes', 'dernierCoup', 'donne', 'echanges', 'gagnant', 'numCoup', 'phase', 'pile', 'pions', 'reglages', 'tour', 'v']);
    assert.deepEqual(Object.keys(q.reglages), ['cinqAdverse']);
    assert.equal(q.pions.length, 16);
    assert.equal(nombreJoueurs(q), 4);
  }
});

// ---------------------------------------------------------------------------
// Géométrie par siège
// ---------------------------------------------------------------------------

test('3 joueurs : bouclage 47 → 0, capture à l’arrivée, recul de 4 de 1 → 45 (chaque siège)', () => {
  for (const s of SIEGES) {
    const e = etat3(s, { 0: 44, 5: 47, 6: 2 });
    const n = jouerT(s, e, 0, { t: 'avance', carte: '6C', pion: 0, pas: 6 });
    assert.equal(posT(s, n, 0), C(s, 2), `siège ${s}`);
    assert.equal(posT(s, n, 5), C(s, 47), 'pas de capture par-dessus');
    assert.equal(posT(s, n, 6), BASE, 'capture à l’arrivée');
    assert.equal(legalT(s, e, 0, { t: 'avance', carte: '6C', pion: 0, pas: 6, allee: true }), false);
    const r = jouerT(s, etat3(s, { 0: 1 }), 0, { t: 'recul', carte: '4C', pion: 0 });
    assert.equal(posT(s, r, 0), C(s, 45));
    // un pion d'un autre siège boucle aussi : pion 4 (siège +1) de 46 avec un 5 → 3
    const f = etat3(s, { 4: 46 }, { tour: 1 });
    assert.equal(posT(s, jouerT(s, f, 1, { t: 'avance', carte: '5C', pion: 4, pas: 5 }), 4), C(s, 3));
  }
});

test('3 joueurs : entrée dans l’allée depuis la case d’entrée ou en la passant, compte exact', () => {
  for (const s of SIEGES) {
    const e = etat3(s, { 0: 45 });
    for (const pas of [1, 2, 3]) {
      const carte = (pas === 1 ? 'A' : pas) + 'C';
      assert.equal(posT(s, jouerT(s, e, 0, { t: 'avance', carte, pion: 0, pas, allee: true }), 0), a(pas - 1));
    }
    assert.equal(legalT(s, e, 0, { t: 'avance', carte: '5C', pion: 0, pas: 5, allee: true }), false);
    assert.equal(posT(s, jouerT(s, e, 0, { t: 'avance', carte: '5C', pion: 0, pas: 5 }), 0), C(s, 2));
    const f = etat3(s, { 0: 43 });
    for (const pas of [3, 5, 6]) {
      assert.equal(posT(s, jouerT(s, f, 0, { t: 'avance', carte: pas + 'C', pion: 0, pas, allee: true }), 0), a(pas - 3));
      assert.equal(posT(s, jouerT(s, f, 0, { t: 'avance', carte: pas + 'C', pion: 0, pas }), 0), C(s, (43 + pas) % 48));
    }
    for (const [carte, pas] of [['8C', 8], ['DC', 12], ['RC', 13]]) {
      assert.equal(legalT(s, f, 0, { t: 'avance', carte, pion: 0, pas, allee: true }), false);
      assert.equal(legalT(s, f, 0, { t: 'avance', carte, pion: 0, pas }), true);
    }
    assert.equal(posT(s, jouerT(s, etat3(s, { 0: 34 }), 0, { t: 'avance', carte: 'RC', pion: 0, pas: 13, allee: true }), 0), a(1));
    // entre l'entrée (exclue) et la case de départ (incluse) : il faut refaire un tour
    for (const p of [46, 47, 0]) {
      const g = etat3(s, { 0: p });
      for (const r of ['A', '2', '3', '5', '6', '8', '9', '10', 'D', 'R']) assert.deepEqual(avecAllee(coupsLegaux(g, S(s, 0), r + 'C')), []);
      assert.equal(coupsLegaux(g, S(s, 0), '7C').some((c) => c.etapes.some((x) => x.allee)), false);
    }
    // l'allée d'un autre siège ne le concerne pas (entrée du siège +1 : 13)
    assert.deepEqual(coupsLegaux(etat3(s, { 0: 10 }), S(s, 0), '5C').map((c) => c.allee), [false]);
  }
});

test('3 joueurs : sortie, 4 en arrière (repasse l’entrée), puis 5 = fond de l’allée (chaque siège)', () => {
  for (const s of SIEGES) {
    let e = jouerT(s, etat3(s, {}), 0, { t: 'sortie', carte: 'AC', pion: 0 });
    assert.equal(posT(s, e, 0), C(s, 0));
    assert.equal(estProtege(e, P(s, 0)), true);
    e.tour = S(s, 0);
    e = jouerT(s, e, 0, { t: 'recul', carte: '4C', pion: 0 });
    assert.equal(posT(s, e, 0), C(s, 44));
    e.tour = S(s, 0);
    assert.deepEqual(avecAllee(coupsLegaux(e, S(s, 0), '5C')).map((c) => c.pas), [5]);
    assert.equal(posT(s, jouerT(s, e, 0, { t: 'avance', carte: '5C', pion: 0, pas: 5, allee: true }), 0), a(3));
    assert.equal(posT(s, jouerT(s, e, 0, { t: 'avance', carte: '2C', pion: 0, pas: 2, allee: true }), 0), a(0));
  }
});

test('3 joueurs : protection sur la case de sortie, sortie qui renvoie le pion présent', () => {
  for (const s of SIEGES) {
    const opt = { reglages: { cinqAdverse: true } };
    const e = etat3(s, { 0: 12, 4: 16, 1: 30 }, opt);
    assert.equal(estProtege(e, P(s, 4)), true);
    assert.equal(legalT(s, e, 0, { t: 'avance', carte: '6C', pion: 0, pas: 6 }), false, 'dépassement');
    assert.equal(legalT(s, e, 0, { t: 'avance', carte: '3C', pion: 0, pas: 3 }), true);
    assert.equal(legalT(s, etat3(s, { 0: 14, 4: 16 }), 0, { t: 'avance', carte: '2C', pion: 0, pas: 2 }), false, 'arrivée');
    assert.equal(legalT(s, etat3(s, { 0: 18, 4: 16 }), 0, { t: 'recul', carte: '4C', pion: 0 }), false, '4');
    assert.equal(legalT(s, e, 0, { t: 'echange', carte: 'VC', pion: 0, cible: 4 }), false, 'valet');
    assert.equal(legalT(s, e, 0, { t: 'avance', carte: '5C', pion: 4, pas: 5 }), false, '5 adverse');
    assert.equal(legalT(s, e, 0, { t: 'sept', carte: '7C', etapes: [{ pion: 0, pas: 4 }, { pion: 1, pas: 3 }] }), false, '7');
    // siège +2 protégé sur 32
    const f = etat3(s, { 0: 28, 8: 32 });
    assert.equal(legalT(s, f, 0, { t: 'avance', carte: '5C', pion: 0, pas: 5 }), false);
    // la sortie du propriétaire renvoie son pion ; celle d'un autre siège ne touche pas
    const g = etat3(s, { 0: 0, 4: 16 });
    const n = jouerT(s, g, 0, { t: 'sortie', carte: 'RC', pion: 1 });
    assert.equal(posT(s, n, 0), BASE);
    assert.equal(posT(s, n, 1), C(s, 0));
    assert.equal(posT(s, n, 4), C(s, 16));
    // pion d'un autre siège posé sur ma case de sortie : capturé par ma sortie
    const h = jouerT(s, etat3(s, { 8: 0 }), 0, { t: 'sortie', carte: 'AC', pion: 0 });
    assert.equal(posT(s, h, 8), BASE);
    assert.deepEqual(h.dernierCoup.captures, [P(s, 8)]);
  }
});

test('3 joueurs : capture à l’arrivée d’un pion de chaque autre joueur et du sien', () => {
  for (const s of SIEGES) {
    for (const victime of [4, 8, 1]) {
      const n = jouerT(s, etat3(s, { 0: 5, [victime]: 11 }), 0, { t: 'avance', carte: '6C', pion: 0, pas: 6 });
      assert.equal(posT(s, n, victime), BASE);
      assert.equal(posT(s, n, 0), C(s, 11));
    }
  }
});

// ---------------------------------------------------------------------------
// Chacun pour soi
// ---------------------------------------------------------------------------

test('3 joueurs : valet avec le pion de n’importe quel autre joueur, jamais deux des siens', () => {
  for (const s of SIEGES) {
    const e = etat3(s, { 0: 5, 1: 7, 4: 20, 8: 40, 9: a(0), 5: 16 });
    const vs = coupsLegaux(e, S(s, 0), 'VC').map((c) => [c.pion, c.cible]).sort();
    assert.deepEqual(vs, [[P(s, 0), P(s, 4)], [P(s, 0), P(s, 8)], [P(s, 1), P(s, 4)], [P(s, 1), P(s, 8)]].sort());
    assert.equal(legalT(s, e, 0, { t: 'echange', carte: 'VC', pion: 0, cible: 1 }), false, 'deux des siens');
    assert.equal(legalT(s, e, 0, { t: 'echange', carte: 'VC', pion: 4, cible: 8 }), false, 'aucun des siens');
    const n = jouerT(s, e, 0, { t: 'echange', carte: 'VC', pion: 0, cible: 8 });
    assert.equal(posT(s, n, 0), C(s, 40));
    assert.equal(posT(s, n, 8), C(s, 5));
  }
});

test('3 joueurs : 7 fractionné, tout dépensé, captures de tous les pions dépassés (siens compris)', () => {
  for (const s of SIEGES) {
    // pion 0 en 41 ; sur le chemin : 42 (siège +1), 43 (siège +2), 44 (son pion 1) ; entrée en 45
    const e = etat3(s, { 0: 41, 4: 42, 8: 43, 1: 44, 2: 20 });
    const n = jouerT(s, e, 0, { t: 'sept', carte: '7C', etapes: [{ pion: 0, pas: 6, allee: true }, { pion: 2, pas: 1 }] });
    assert.equal(posT(s, n, 0), a(1));
    for (const q of [4, 8, 1]) assert.equal(posT(s, n, q), BASE, `pion ${q} capturé`);
    assert.equal(legalT(s, e, 0, { t: 'sept', carte: '7C', etapes: [{ pion: 2, pas: 6 }] }), false, '7 partiel');
    // 7 en passant 47 → 0
    const f = jouerT(s, etat3(s, { 0: 46, 5: 1 }), 0, { t: 'sept', carte: '7C', etapes: [{ pion: 0, pas: 7 }] });
    assert.equal(posT(s, f, 0), C(s, 5));
    assert.equal(posT(s, f, 5), BASE);
  }
});

test('3 joueurs : le reste du 7 ne va à personne ; un joueur ne joue jamais les pions d’un autre', () => {
  for (const s of SIEGES) {
    // trois pions rentrés, le dernier à 3 pas de a(0) : le 7 ne peut pas gagner (4 points perdus)
    const e = etat3(s, { 0: a(3), 1: a(2), 2: a(1), 3: 43, 4: 20, 8: 30 });
    assert.equal(legalT(s, e, 0, { t: 'sept', carte: '7C', etapes: [{ pion: 3, pas: 3, allee: true }] }), false);
    assert.equal(legalT(s, e, 0, { t: 'sept', carte: '7C', etapes: [{ pion: 3, pas: 3, allee: true }, { pion: 4, pas: 4 }] }), false);
    const coups = coupsLegaux(e, S(s, 0), '7C');
    assert.equal(coups.length, 1, 'seul coup : continuer le tour');
    assert.equal(apercuCoup(e, S(s, 0), coups[0]).pions[P(s, 3)], C(s, 2));
    // couleur active : toujours la sienne, même avec tous ses pions rentrés
    const f = etat3(s, { 0: a(0), 1: a(1), 2: a(2), 3: a(3), 4: 20, 8: 30 });
    assert.equal(aFini(f, S(s, 0)), true);
    assert.equal(couleurActive(f, S(s, 0)), S(s, 0));
    for (const r of ['A', '3', '4', '7', 'V', 'R']) assert.deepEqual(coupsLegaux(f, S(s, 0), r + 'C'), [], r);
  }
});

test('3 joueurs : 5 adverse sur les pions de chacun des deux autres joueurs', () => {
  for (const s of SIEGES) {
    const opt = { reglages: { cinqAdverse: true } };
    const e = etat3(s, { 0: 5, 4: 20, 8: 35, 9: 32, 10: a(1), 5: 40 }, opt);
    const pions = coupsLegaux(e, S(s, 0), '5C').map((c) => c.pion).sort((x, y) => x - y);
    // 9 protégé (case 32 du siège +2), 10 dans l'allée
    assert.deepEqual(pions, [0, 4, 5, 8].map((g) => P(s, g)).sort((x, y) => x - y));
    const n = jouerT(s, e, 0, { t: 'avance', carte: '5C', pion: 8, pas: 5 });
    assert.equal(posT(s, n, 8), C(s, 40));
    assert.equal(posT(s, n, 5), BASE, 'le pion poussé capture à l’arrivée');
    // sans l'option : seulement ses pions
    const f = etat3(s, { 0: 5, 4: 20, 8: 35 });
    assert.deepEqual(coupsLegaux(f, S(s, 0), '5C').map((c) => c.pion), [P(s, 0)]);
  }
});

test('3 joueurs : le premier qui rentre ses 4 pions gagne, la partie s’arrête', () => {
  for (const s of SIEGES) {
    const e = etat3(s, { 0: a(3), 1: a(2), 2: a(1), 3: 43, 4: a(3), 5: a(2), 6: a(1) });
    const n = jouerT(s, e, 0, { t: 'avance', carte: '3C', pion: 3, pas: 3, allee: true });
    assert.equal(n.phase, 'fini');
    assert.equal(n.gagnant, S(s, 0));
    assert.deepEqual(siegesGagnants(n), [S(s, 0)]);
    assert.equal(n.tour, e.tour, 'le tour ne passe plus');
    assert.match(validerCoup(n, S(s, 1), { t: 'avance', carte: '2C', pion: P(s, 4), pas: 2 }), /phase de jeu/);
    // victoire par un 7 dont les 7 points sont utilisés
    const f = etat3(s, { 0: a(3), 1: a(2), 2: 44, 3: 42 });
    const w = jouerT(s, f, 0, { t: 'sept', carte: '7C', etapes: [{ pion: 2, pas: 3, allee: true }, { pion: 3, pas: 4, allee: true }] });
    assert.equal(w.phase, 'fini');
    assert.equal(w.gagnant, S(s, 0));
    assert.deepEqual(siegesGagnants(etat3(s, {})), []);
  }
  // à 4 : les deux sièges de l'équipe
  assert.deepEqual(siegesGagnants({ ...etatInitial(), phase: 'fini', gagnant: 1 }), [1, 3]);
});

test('3 joueurs : obligation de jouer, défausse si aucune carte jouable, entrées mal formées', () => {
  for (const s of SIEGES) {
    const e = etat3(s, { 0: 30 });
    assert.match(validerCoup(e, S(s, 0), { t: 'defausse', carte: 'VC' }, ['VC', '7C']), /Défausse interdite/);
    const f = etat3(s, {});
    assert.equal(mainJouable(f, S(s, 0), ['VC', '7C', '5P']), false);
    assert.equal(validerCoup(f, S(s, 0), { t: 'defausse', carte: '7C' }, ['VC', '7C', '5P']), null);
  }
  const e = etat3(0, { 0: 5 });
  assert.equal(validerCoup(e, 3, { t: 'avance', carte: '5C', pion: 0, pas: 5 }), "Ce n'est pas à ce joueur de jouer.");
  assert.equal(typeof validerCoup(e, 0, { t: 'avance', carte: '5C', pion: 12, pas: 5 }), 'string');
  assert.equal(typeof validerCoup(e, 0, { t: 'echange', carte: 'VC', pion: 0, cible: 13 }), 'string');
  assert.throws(() => marquerEchange(etatInitial({ nbJoueurs: 3 }), 3), /Siège invalide/);
});

// ---------------------------------------------------------------------------
// Cartes, distribution, échanges, ordre des tours
// ---------------------------------------------------------------------------

test('3 joueurs : 54 cartes (deux jokers), cycle 5-4-4-5 ; jeu à 4 inchangé', () => {
  const paquet = paquetNeuf(3);
  assert.equal(paquet.length, 54);
  assert.equal(new Set(paquet).size, 54);
  assert.ok(paquet.includes('J1') && paquet.includes('J2'));
  assert.deepEqual(JOKERS, ['J1', 'J2']);
  assert.equal(paquetNeuf().length, 52);
  assert.ok(!paquetNeuf().some(estJoker));
  assert.equal(estCarteDuJeu('J1', 3), true);
  assert.equal(estCarteDuJeu('J1'), false);
  assert.deepEqual(taillesDonne(3), [5, 4, 4, 5]);
  assert.equal(longueurCycle(3), 4);
  assert.equal(longueurCycle(), 3);
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7].map((d) => tailleDonne(d, 3)), [5, 4, 4, 5, 5, 4, 4, 5]);
  assert.deepEqual([0, 1, 2, 3].map((d) => tailleDonne(d)), [5, 4, 4, 5]);
  for (let graine = 0; graine < 20; graine++) {
    const cycle = distribuerCycle(generateurAleatoire(graine), 3);
    assert.deepEqual(cycle.map((d) => d.map((m) => m.length)), [[5, 5, 5], [4, 4, 4], [4, 4, 4], [5, 5, 5]]);
    assert.equal(new Set(cycle.flat(2)).size, 54);
  }
  const c4 = distribuerCycle(generateurAleatoire(1));
  assert.deepEqual(c4.map((d) => d.map((m) => m.length)), [[5, 5, 5, 5], [4, 4, 4, 4], [4, 4, 4, 4]]);
});

test('3 joueurs : sens de l’échange selon la donne (gauche les paires, droite les impaires)', () => {
  for (const s of SIEGES) {
    assert.equal(destinataireDon(0, s, 3), (s + 1) % 3);
    assert.equal(destinataireDon(2, s, 3), (s + 1) % 3);
    assert.equal(destinataireDon(1, s, 3), (s + 2) % 3);
    assert.equal(destinataireDon(5, s, 3), (s + 2) % 3);
    for (let d = 0; d < 6; d++) assert.equal(donneurDon(d, destinataireDon(d, s, 3), 3), s);
  }
  for (let s = 0; s < 4; s++) for (let d = 0; d < 3; d++) {
    assert.equal(destinataireDon(d, s), partenaire(s));
    assert.equal(donneurDon(d, s), partenaire(s));
  }
});

test('3 joueurs : partie locale — échange avec le voisin, premier joueur tournant, cycle de 54 cartes, pile vidée toutes les 4 donnes', () => {
  const rng = generateurAleatoire(9);
  let p = nouvellePartie({ nbJoueurs: 3 }, rng);
  assert.equal(p.cycle.length, 4);
  assert.deepEqual(p.dons, [null, null, null]);
  assert.deepEqual(p.archives[0].vers, [1, 2, 0]);
  let donne = -1;
  let cartesDuCycle = new Set();
  let attendu = null;
  let jokerDonne = false;
  const tailles = [];
  let garde = 0;
  while (p.etat.phase !== 'fini' && p.etat.donne < 13 && garde++ < 5000) {
    if (p.etat.phase === 'echange') {
      if (p.etat.donne !== donne) {
        donne = p.etat.donne;
        assert.equal(p.etat.tour, donne % 3, 'premier joueur tournant');
        assert.deepEqual(p.mains.map((m) => m.length), Array(3).fill([5, 4, 4, 5][donne % 4]));
        assert.deepEqual(p.etat.cartesRestantes, Array(3).fill([5, 4, 4, 5][donne % 4]));
        assert.deepEqual(rangsCopiables(p.etat), []);
        assert.equal(debutDeCycle(p.etat), donne % 4 === 0);
        if (donne % 4 === 0) {
          if (donne > 0) assert.equal(cartesDuCycle.size, 54);
          cartesDuCycle = new Set();
          assert.deepEqual(p.etat.pile, []);
          assert.deepEqual(p.etat.jokers, {});
        }
        for (const m of p.mains) for (const c of m) {
          assert.ok(!cartesDuCycle.has(c), 'carte distribuée deux fois dans un cycle');
          cartesDuCycle.add(c);
        }
        tailles.push(p.mains[0].length);
      }
      // on donne un joker quand on en a un (on peut donner un joker)
      const dons = p.mains.map((m) => m.find(estJoker) || m[m.length - 1]);
      if (dons.some(estJoker)) jokerDonne = true;
      for (const s of [2, 0, 1]) p = donnerCarte(p, s, dons[s]);
      for (let s = 0; s < 3; s++) {
        const vers = donne % 2 === 0 ? (s + 1) % 3 : (s + 2) % 3;
        assert.ok(p.mains[vers].includes(dons[s]), `donne ${donne} : ${s} → ${vers}`);
        assert.ok(!p.mains[s].includes(dons[s]));
        assert.equal(p.archives[donne].vers[s], vers);
      }
      assert.deepEqual(p.archives[donne].dons, dons);
      attendu = p.etat.tour;
      continue;
    }
    assert.equal(p.etat.tour, attendu);
    const s = p.etat.tour;
    const coups = coupsLegauxMain(p.etat, s, p.mains[s]);
    p = jouerCoup(p, s, coups[Math.floor(rng() * coups.length)], rng);
    attendu = (s + 1) % 3;
  }
  assert.deepEqual(tailles.slice(0, 9), [5, 4, 4, 5, 5, 4, 4, 5, 5]);
  assert.ok(jokerDonne, 'aucun joker donné pendant le test');
});

// ---------------------------------------------------------------------------
// Joker
// ---------------------------------------------------------------------------

/** Ajoute `comme` à des coups (pour comparer joker et carte copiée). */
const comme = (coups, carte, r) => coups.map((c) => {
  const { t, carte: _c, ...reste } = c;
  return { t, carte, comme: r, ...reste };
});

test('joker : rien à copier en début de donne → injouable ; on joue une autre carte, sinon défausse', () => {
  for (const s of SIEGES) {
    const e = etat3(s, { 0: 10 });
    assert.deepEqual(rangsCopiables(e), []);
    assert.deepEqual(coupsLegaux(e, S(s, 0), 'J1'), []);
    // une autre carte est jouable : on la joue, on garde le joker
    assert.deepEqual(coupsLegauxMain(e, S(s, 0), ['J1', '5C']).map((c) => c.carte), ['5C']);
    assert.match(validerCoup(e, S(s, 0), { t: 'defausse', carte: 'J1' }, ['J1', '5C']), /Défausse interdite/);
    // joker seule carte : défausse
    assert.equal(mainJouable(e, S(s, 0), ['J1']), false);
    assert.deepEqual(coupsLegauxMain(e, S(s, 0), ['J1']), [{ t: 'defausse', carte: 'J1' }]);
    const n = appliquerCoup(e, S(s, 0), { t: 'defausse', carte: 'J1' }, ['J1']);
    assert.deepEqual(n.jokers, {}, 'un joker défaussé ne copie rien');
    assert.deepEqual(n.dernierCoup.coup, { t: 'defausse', carte: 'J1' });
    // aucune carte jouable : défausse au choix, joker compris
    const f = etat3(s, {});
    assert.deepEqual(coupsLegauxMain(f, S(s, 0), ['J2', '5C', 'VP']).map((c) => c.carte).sort(), ['5C', 'J2', 'VP']);
    // un rang copiable sans coup légal : joker toujours injouable
    const g = etat3(s, {}, { posees: ['5K'] });
    assert.deepEqual(rangsCopiables(g), ['5']);
    assert.deepEqual(coupsLegaux(g, S(s, 0), 'J1'), []);
    assert.equal(validerCoup(g, S(s, 0), { t: 'defausse', carte: 'J1' }, ['J1']), null);
    assert.equal(validerCoup(g, S(s, 0), { t: 'avance', carte: 'J1', comme: '5', pion: P(s, 0), pas: 5 }), 'Coup illégal.');
  }
});

test('joker : copie une carte jouée pendant la donne (n’importe quel joueur, soi compris)', () => {
  for (const s of SIEGES) {
    const e = etat3(s, { 0: 10, 4: 30 }, { posees: ['9C', '3P'] });
    assert.deepEqual(rangsCopiables(e), ['3', '9']);
    assert.deepEqual(cartesDeLaDonne(e), ['9C', '3P']);
    const coups = coupsLegaux(e, S(s, 0), 'J1');
    assert.deepEqual(coups, [...comme(coupsLegaux(e, S(s, 0), '3C'), 'J1', '3'), ...comme(coupsLegaux(e, S(s, 0), '9C'), 'J1', '9')]);
    const coup = { t: 'avance', carte: 'J1', comme: '9', pion: P(s, 0), pas: 9, allee: false };
    assert.deepEqual(coups[1], coup);
    assert.equal(validerCoup(e, S(s, 0), coup, ['J1']), null);
    const n = appliquerCoup(e, S(s, 0), coup, ['J1']);
    assert.equal(posT(s, n, 0), C(s, 19));
    assert.deepEqual(n.jokers, { J1: '9' });
    assert.deepEqual(n.dernierCoup.coup, coup);
    assert.deepEqual(n.pile.slice(-1), ['J1']);
    assert.deepEqual(rangsCopiables(n), ['3', '9']);
    compatibleFirestore(n);
    // rangs non copiables, `comme` absent ou invalide : illégal
    for (const mauvais of [{ ...coup, comme: '8', pas: 8 }, { ...coup, comme: undefined }, { ...coup, comme: 'J' }, { ...coup, comme: 9 }]) {
      assert.equal(validerCoup(e, S(s, 0), mauvais, ['J1']), 'Coup illégal.', JSON.stringify(mauvais));
    }
    // une carte jouée par soi-même plus tôt dans la donne compte aussi
    const f = etat3(s, { 0: 10 });
    const g = appliquerCoup(f, S(s, 0), { t: 'avance', carte: '2C', pion: P(s, 0), pas: 2 });
    g.tour = S(s, 0);
    assert.deepEqual(rangsCopiables(g), ['2']);
    assert.equal(posT(s, appliquerCoup(g, S(s, 0), { t: 'avance', carte: 'J2', comme: '2', pion: P(s, 0), pas: 2 }), 0), C(s, 14));
  }
});

test('joker : copie une carte défaussée pendant la donne', () => {
  for (const s of SIEGES) {
    // le siège +1 défausse un valet faute de coup ; le joker du siège 0 peut le copier
    let e = etat3(s, { 0: 10, 8: 30 }, { tour: 1 });
    e = appliquerCoup(e, S(s, 1), { t: 'defausse', carte: 'VP' }, ['VP']);
    e.tour = S(s, 0);
    assert.deepEqual(rangsCopiables(e), ['V']);
    const coups = coupsLegaux(e, S(s, 0), 'J2');
    assert.deepEqual(coups, [{ t: 'echange', carte: 'J2', comme: 'V', pion: P(s, 0), cible: P(s, 8) }]);
    const n = appliquerCoup(e, S(s, 0), coups[0], ['J2']);
    assert.equal(posT(s, n, 0), C(s, 30));
    assert.equal(posT(s, n, 8), C(s, 10));
  }
});

test('joker : copier un joker = copier ce qu’il avait copié ; un joker défaussé n’offre rien', () => {
  for (const s of SIEGES) {
    // J1 a copié un 9 (le 9 lui-même a été posé dans une donne précédente du cycle)
    const e = etat3(s, { 0: 10 }, { posees: ['J1'], jokers: { J1: '9' } });
    e.pile.unshift('9C', '2P'); // cartes d'une donne précédente : hors de la donne en cours
    assert.deepEqual(cartesDeLaDonne(e), ['J1']);
    assert.deepEqual(rangsCopiables(e), ['9']);
    const coups = coupsLegaux(e, S(s, 0), 'J2');
    assert.deepEqual(coups, [{ t: 'avance', carte: 'J2', comme: '9', pion: P(s, 0), pas: 9, allee: false }]);
    const n = appliquerCoup(e, S(s, 0), coups[0], ['J2']);
    assert.deepEqual(n.jokers, { J1: '9', J2: '9' });
    assert.equal(validerCoup(e, S(s, 0), { t: 'avance', carte: 'J2', comme: 'J', pion: P(s, 0), pas: 9 }), 'Coup illégal.');
    // joker défaussé : rien à copier
    const f = etat3(s, { 0: 10 }, { posees: ['J1'] });
    assert.deepEqual(rangsCopiables(f), []);
    assert.deepEqual(coupsLegaux(f, S(s, 0), 'J2'), []);
  }
});

test('joker : copie d’un 7 (fractionné, tout dépensé, captures), d’un valet, d’un as (sortie, 1, 11)', () => {
  for (const s of SIEGES) {
    // 7
    const e = etat3(s, { 0: 41, 4: 42, 2: 20 }, { posees: ['7T'] });
    const sept = coupsLegaux(e, S(s, 0), 'J1');
    assert.deepEqual(sept, comme(coupsLegaux(e, S(s, 0), '7C'), 'J1', '7'));
    assert.ok(sept.length > 5);
    const n = appliquerCoup(e, S(s, 0), { t: 'sept', carte: 'J1', comme: '7', etapes: [{ pion: P(s, 0), pas: 6, allee: true }, { pion: P(s, 2), pas: 1 }] });
    assert.equal(posT(s, n, 0), a(1));
    assert.equal(posT(s, n, 4), BASE);
    assert.equal(posT(s, n, 2), C(s, 21));
    assert.deepEqual(n.dernierCoup.coup.comme, '7');
    assert.equal(validerCoup(e, S(s, 0), { t: 'sept', carte: 'J1', comme: '7', etapes: [{ pion: P(s, 2), pas: 6 }] }), 'Coup illégal.');
    // etapesSeptPossibles reste indépendant de la carte
    assert.ok(etapesSeptPossibles(e, S(s, 0)).options.length > 0);
    // valet
    const v = etat3(s, { 0: 5, 4: 20, 8: 40 }, { posees: ['VC'] });
    assert.deepEqual(plateaux(v, S(s, 0), coupsLegaux(v, S(s, 0), 'J1')), plateaux(v, S(s, 0), coupsLegaux(v, S(s, 0), 'VK')));
    assert.equal(coupsLegaux(v, S(s, 0), 'J1').length, 2);
    // as : sortie, avance de 1, avance de 11
    const as = etat3(s, { 0: 5 }, { posees: ['AK'] });
    const coupsAs = coupsLegaux(as, S(s, 0), 'J2');
    assert.deepEqual(coupsAs.map((c) => `${c.t}:${c.pas ?? ''}:${c.comme}`).sort(), ['avance:11:A', 'avance:1:A', 'sortie::A']);
    assert.equal(posT(s, appliquerCoup(as, S(s, 0), { t: 'sortie', carte: 'J2', comme: 'A', pion: P(s, 1) }), 1), C(s, 0));
    assert.equal(posT(s, appliquerCoup(as, S(s, 0), { t: 'avance', carte: 'J2', comme: 'A', pion: P(s, 0), pas: 1 }), 0), C(s, 6));
    assert.equal(posT(s, appliquerCoup(as, S(s, 0), { t: 'avance', carte: 'J2', comme: 'A', pion: P(s, 0), pas: 11 }), 0), C(s, 16));
    // 4 copié : recul
    const q = etat3(s, { 0: 5 }, { posees: ['4P'] });
    assert.deepEqual(coupsLegaux(q, S(s, 0), 'J1'), [{ t: 'recul', carte: 'J1', comme: '4', pion: P(s, 0) }]);
  }
});

test('joker : plus rien à copier après le début d’une nouvelle donne ; remise à zéro au remélange', () => {
  // dernière carte de la donne 0 : un 9 a été posé pendant la donne
  const e = etat3(0, { 0: 10 }, { tour: 2 });
  e.pile = ['9C', '2P', '3P', '5P', '6P', '8P', '10P', 'DP', 'RP', 'AP', '2K', '3K', '5K', 'J1'];
  e.cartesRestantes = [0, 0, 1];
  e.jokers = { J1: '9' };
  assert.deepEqual(rangsCopiables(e), ['A', '2', '3', '5', '6', '8', '9', '10', 'D', 'R']);
  let n = appliquerCoup(e, 2, { t: 'defausse', carte: '6K' });
  assert.equal(n.donne, 1);
  assert.equal(n.phase, 'echange');
  assert.deepEqual(n.cartesRestantes, [4, 4, 4]);
  assert.equal(n.tour, 1);
  assert.equal(n.pile.length, 15, 'pas de remélange entre deux donnes du cycle');
  assert.deepEqual(n.jokers, { J1: '9' });
  for (const s of SIEGES) n = marquerEchange(n, s);
  assert.equal(n.phase, 'jeu');
  assert.deepEqual(rangsCopiables(n), [], 'nouvelle donne : rien à copier');
  assert.deepEqual(coupsLegaux(n, 1, 'J2'), []);
  n = appliquerCoup(n, 1, { t: 'defausse', carte: '2T' }, ['2T']);
  assert.deepEqual(rangsCopiables(n), ['2'], 'la carte défaussée de la nouvelle donne est copiable');
  // fin de la donne 3 : remélange, pile et jokers remis à zéro
  const f = etat3(0, { 0: 10 }, { tour: 2 });
  f.donne = 3;
  f.cartesRestantes = [0, 0, 1];
  f.pile = Array.from({ length: 50 }, (_, i) => ['2P', '3P'][i % 2]).concat(['J1', 'J2', '9C']);
  f.jokers = { J1: '9', J2: '9' };
  const g = appliquerCoup(f, 2, { t: 'defausse', carte: '5K' });
  assert.equal(g.donne, 4);
  assert.equal(g.tour, 1);
  assert.deepEqual(g.cartesRestantes, [5, 5, 5]);
  assert.deepEqual(g.pile, []);
  assert.deepEqual(g.jokers, {});
  assert.equal(debutDeCycle(g), true);
});

test('joker : normaliserCoup conserve `comme` (sauf défausse) ; joker refusé dans le jeu à 4', () => {
  assert.deepEqual(normaliserCoup({ t: 'avance', carte: 'J1', comme: '9', pion: 4, pas: 9, allee: false, x: 1 }), { t: 'avance', carte: 'J1', comme: '9', pion: 4, pas: 9, allee: false });
  assert.deepEqual(normaliserCoup({ t: 'sept', carte: 'J2', comme: '7', etapes: [{ pion: 0, pas: 7 }] }), { t: 'sept', carte: 'J2', comme: '7', etapes: [{ pion: 0, pas: 7, allee: false }] });
  assert.deepEqual(normaliserCoup({ t: 'defausse', carte: 'J1', comme: '9' }), { t: 'defausse', carte: 'J1' });
  assert.deepEqual(normaliserCoup({ t: 'avance', carte: '9C', comme: '5', pion: 4, pas: 9 }), { t: 'avance', carte: '9C', pion: 4, pas: 9, allee: false });
  // jeu à 4 : pas de joker
  const e = etatInitial();
  e.phase = 'jeu';
  e.echanges = [true, true, true, true];
  e.pions[0] = 10;
  e.pile = ['9C'];
  e.cartesRestantes = [5, 4, 5, 5];
  assert.deepEqual(rangsCopiables(e), []);
  assert.deepEqual(coupsLegaux(e, 0, 'J1'), []);
  assert.equal(validerCoup(e, 0, { t: 'avance', carte: 'J1', comme: '9', pion: 0, pas: 9 }), 'Coup mal formé.');
  assert.equal(validerCoup(e, 0, { t: 'defausse', carte: 'J1' }), 'Coup mal formé.');
});

test('mainEffective à 3 : distribuées − donnée au voisin + reçue de l’autre voisin − posées', () => {
  assert.deepEqual(mainEffective(['AP', 'J1', '3C', '4C', '5C'], '3C', 'J2', ['J1', '9P']).sort(), ['4C', '5C', 'AP', 'J2'].sort());
});
