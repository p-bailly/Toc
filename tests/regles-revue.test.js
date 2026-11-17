import './plateau-16.js';
// Relecture indépendante du moteur de règles (public/js/moteur) contre docs/cahier-des-charges.md.
//
// Géométrie testée (décision du propriétaire) : l'allée d'arrivée s'ouvre sur la « case
// d'entrée », 3 cases AVANT la case de départ (siège 0 : case 61) ; la k-ième case de
// l'allée est à k + 1 pas de la case d'entrée. Plus de notion de pion « frais ».
//
// Organisation :
//   1. Scénarios règle par règle, joués pour CHAQUE siège (rotation du plateau), ce qui
//      vérifie au passage le bouclage 63 → 0 et la géométrie de l'allée pour les 4 couleurs.
//   2. Comparaison différentielle avec un oracle écrit indépendamment (positions aléatoires,
//      énumération exhaustive des coups candidats, de toutes les décompositions du 7).
//   3. Entrées mal formées, non-mutation de l'état, cycle de distribution et ordre des tours.
//
// Un test marqué « BUG : … » révèle un défaut réel du moteur : il échoue tant que le moteur
// n'est pas corrigé. Un test marqué « AMBIGUÏTÉ : … » documente le choix fait par le moteur
// là où le cahier des charges est muet ou ambigu (il passe).

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BASE, ALLEE, etatInitial, coupsLegaux, coupsLegauxMain, appliquerCoup, validerCoup, mainJouable,
  etapesSeptPossibles, apercuCoup, marquerEchange, estProtege, couleurActive,
  nouvellePartie, donnerCarte, jouerCoup, generateurAleatoire,
} from '../public/js/moteur/index.js';

// ---------------------------------------------------------------------------
// Outils
// ---------------------------------------------------------------------------

const a = (n) => ALLEE + n;
const ENTREE = 61; // case d'entrée du siège 0 (relative)

/**
 * État en phase de jeu, décrit du point de vue du siège 0 puis tourné de `s` sièges :
 * le pion g devient (g + 4s) mod 16, la case c devient (c + 16s) mod 64 ; base et allée
 * (relatives au propriétaire) sont inchangées.
 */
function etatTourne(s, positions = {}, extra = {}) {
  const e = etatInitial(extra.reglages);
  e.phase = 'jeu';
  e.echanges = [true, true, true, true];
  for (const [g, pos] of Object.entries(positions)) e.pions[P(s, +g)] = C(s, pos);
  e.tour = ((extra.tour ?? 0) + s) % 4;
  return e;
}
const P = (s, g) => (g + 4 * s) % 16; // pion tourné
const C = (s, pos) => (pos >= 0 && pos < 64 ? (pos + 16 * s) % 64 : pos); // case tournée
const S = (s, siege) => (siege + s) % 4; // siège tourné
const SIEGES = [0, 1, 2, 3];

/** Coup exprimé pour le siège 0, tourné de s. */
function coupTourne(s, coup) {
  const c = { ...coup };
  if (c.pion !== undefined) c.pion = P(s, c.pion);
  if (c.cible !== undefined) c.cible = P(s, c.cible);
  if (c.etapes) c.etapes = c.etapes.map((e) => ({ ...e, pion: P(s, e.pion) }));
  return c;
}
const legalT = (s, e, siege, coup) => validerCoup(e, S(s, siege), coupTourne(s, coup)) === null;
const jouerT = (s, e, siege, coup) => appliquerCoup(e, S(s, siege), coupTourne(s, coup));
const posT = (s, etat, g) => etat.pions[P(s, g)];
const cle = (pions) => pions.join(',');
const avecAllee = (coups) => coups.filter((c) => c.allee);

function geler(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) geler(v);
  }
  return o;
}

// ---------------------------------------------------------------------------
// Oracle indépendant (réécrit à partir du cahier des charges et des choix d'interprétation
// annoncés dans l'en-tête de regles.js). Il avance case par case.
// ---------------------------------------------------------------------------

const O = {
  depart: (s) => 16 * s,
  entree: (s) => (16 * s + 61) % 64,
  protege: (pions, q) => pions[q] === 16 * (q >> 2),
  occupant(pions, cell, sauf) {
    for (let q = 0; q < 16; q++) if (q !== sauf && pions[q] === cell) return q;
    return -1;
  },
  fini: (pions, s) => [0, 1, 2, 3].every((i) => pions[4 * s + i] >= ALLEE),
  actif: (pions, s) => (O.fini(pions, s) ? (s + 2) % 4 : s),
  alleePrise: (pions, o, k) => [0, 1, 2, 3].some((i) => pions[4 * o + i] === ALLEE + k),

  /** Avance pas à pas. Renvoie le nouveau tableau des pions ou null. */
  avance(pions, g, pas, allee, sept) {
    const p = pions[g];
    const o = g >> 2;
    if (p === BASE || !(p >= 0)) return null;
    const np = pions.slice();
    if (p >= ALLEE) {
      let k = p - ALLEE;
      for (let i = 0; i < pas; i++) {
        k++;
        if (k > 3 || O.alleePrise(pions, o, k)) return null;
      }
      np[g] = ALLEE + k;
      return np;
    }
    let pos = p;
    let k = -1; // indice dans l'allée une fois entré
    const captures = [];
    for (let i = 1; i <= pas; i++) {
      if (k >= 0) {
        k++;
        if (k > 3 || O.alleePrise(pions, o, k)) return null;
        continue;
      }
      if (allee && pos === O.entree(o)) {
        k = 0;
        if (O.alleePrise(pions, o, 0)) return null;
        continue;
      }
      pos = (pos + 1) % 64;
      const q = O.occupant(pions, pos, g);
      if (q >= 0) {
        if (O.protege(pions, q)) return null;
        if (sept || i === pas) captures.push(q);
      }
    }
    if (allee && k < 0) return null;
    for (const q of captures) np[q] = BASE;
    np[g] = k >= 0 ? ALLEE + k : pos;
    return np;
  },

  recul(pions, g) {
    const p = pions[g];
    if (!(p >= 0 && p < 64)) return null;
    let pos = p;
    let capture = -1;
    for (let i = 1; i <= 4; i++) {
      pos = (pos + 63) % 64;
      const q = O.occupant(pions, pos, g);
      if (q >= 0) {
        if (O.protege(pions, q)) return null;
        if (i === 4) capture = q;
      }
    }
    const np = pions.slice();
    if (capture >= 0) np[capture] = BASE;
    np[g] = pos;
    return np;
  },

  pasCarte: { A: [1, 11], R: [13], D: [12], 2: [2], 3: [3], 5: [5], 6: [6], 8: [8], 9: [9], 10: [10] },

  /** Coup hors 7 et hors défausse → pions ou null. */
  jouer(etat, siege, coup) {
    const { pions } = etat;
    const r = coup.carte.slice(0, -1);
    const c = O.actif(pions, siege);
    const estPion = (g) => Number.isInteger(g) && g >= 0 && g < 16;
    const circuitLibre = (q) => pions[q] >= 0 && pions[q] < 64 && !O.protege(pions, q);
    switch (coup.t) {
      case 'sortie': {
        if (!['A', 'R'].includes(r) || !estPion(coup.pion) || coup.pion >> 2 !== c || pions[coup.pion] !== BASE) return null;
        const np = pions.slice();
        const q = O.occupant(pions, O.depart(c), -1);
        if (q >= 0) np[q] = BASE;
        np[coup.pion] = O.depart(c);
        return np;
      }
      case 'avance': {
        const g = coup.pion;
        if (!estPion(g) || !O.pasCarte[r] || !O.pasCarte[r].includes(coup.pas)) return null;
        if (g >> 2 === c) return O.avance(pions, g, coup.pas, !!coup.allee, false);
        if (r === '5' && etat.reglages.cinqAdverse && (g >> 2) % 2 !== siege % 2 && !coup.allee && circuitLibre(g)) {
          return O.avance(pions, g, 5, false, false);
        }
        return null;
      }
      case 'recul':
        if (r !== '4' || !estPion(coup.pion) || coup.pion >> 2 !== c) return null;
        return O.recul(pions, coup.pion);
      case 'echange': {
        const { pion: x, cible: y } = coup;
        if (r !== 'V' || !estPion(x) || !estPion(y) || x >> 2 !== c || y >> 2 === c) return null;
        // Le sien peut partir de sa case de départ (protégé) ; la cible ne doit pas être protégée.
        if (!(pions[x] >= 0 && pions[x] < 64) || !circuitLibre(y)) return null;
        const np = pions.slice();
        [np[x], np[y]] = [pions[y], pions[x]];
        return np;
      }
      default:
        return null;
    }
  },

  /** Étapes d'un 7 (contrôle complet) → pions ou null. */
  sept(etat, siege, etapes) {
    let pions = etat.pions;
    let reste = 7;
    for (const e of etapes) {
      if (!Number.isInteger(e.pas) || e.pas < 1 || e.pas > reste) return null;
      if (e.pion >> 2 !== O.actif(pions, siege)) return null;
      pions = O.avance(pions, e.pion, e.pas, !!e.allee, true);
      if (!pions) return null;
      reste -= e.pas;
    }
    return reste === 0 ? pions : null;
  },

  /** Plateaux finaux atteignables par un 7, et étapes initiales complétables. */
  explorerSept(pions, siege) {
    const finals = new Set();
    const memo = new Map();
    const rec = (pi, reste) => {
      if (reste === 0) {
        finals.add(cle(pi));
        return true;
      }
      const k = cle(pi) + '/' + reste;
      if (memo.has(k)) return memo.get(k);
      let ok = false;
      const c = O.actif(pi, siege);
      for (let g = 4 * c; g < 4 * c + 4; g++) {
        for (let pas = 1; pas <= reste; pas++) {
          for (const al of [false, true]) {
            const res = O.avance(pi, g, pas, al, true);
            if (res && rec(res, reste - pas)) ok = true;
          }
        }
      }
      memo.set(k, ok);
      return ok;
    };
    rec(pions, 7);
    const premieres = new Set();
    const c = O.actif(pions, siege);
    for (let g = 4 * c; g < 4 * c + 4; g++) {
      for (let pas = 1; pas <= 7; pas++) {
        for (const al of [false, true]) {
          const res = O.avance(pions, g, pas, al, true);
          // dans l'allée, le drapeau allee n'a pas de sens : on normalise à true
          if (res && rec(res, 7 - pas)) premieres.add(`${g}:${pas}:${pions[g] >= ALLEE ? true : al}`);
        }
      }
    }
    return { finals, premieres };
  },
};

/** Position aléatoire cohérente (jamais deux pions sur une même case). */
function positionAleatoire(rng) {
  const e = etatInitial({ cinqAdverse: rng() < 0.5 });
  e.phase = 'jeu';
  e.echanges = [true, true, true, true];
  const prises = new Set();
  // cases « intéressantes » : cases de départ, cases d'entrée et leurs abords
  const chaudes = [];
  for (let s = 0; s < 4; s++) for (let d = -9; d <= 4; d++) chaudes.push((16 * s + d + 64) % 64);
  for (let g = 0; g < 16; g++) {
    const o = g >> 2;
    const t = rng();
    if (t < 0.25) continue; // base
    if (t < 0.45) {
      const k = Math.floor(rng() * 4);
      if (!e.pions.some((x, q) => q >> 2 === o && x === ALLEE + k)) e.pions[g] = ALLEE + k;
      continue;
    }
    const cell = rng() < 0.6 ? chaudes[Math.floor(rng() * chaudes.length)] : Math.floor(rng() * 64);
    if (prises.has(cell)) continue;
    prises.add(cell);
    e.pions[g] = cell;
  }
  return e;
}

const RANGS = ['A', '2', '3', '4', '5', '6', '8', '9', '10', 'V', 'D', 'R'];

/** Tous les coups candidats (légaux ou non) pour une carte hors 7. */
function candidats(carte) {
  const res = [];
  for (let g = 0; g < 16; g++) {
    res.push({ t: 'sortie', carte, pion: g }, { t: 'recul', carte, pion: g });
    for (let pas = 1; pas <= 13; pas++) {
      res.push({ t: 'avance', carte, pion: g, pas, allee: false }, { t: 'avance', carte, pion: g, pas, allee: true });
    }
    for (let h = 0; h < 16; h++) res.push({ t: 'echange', carte, pion: g, cible: h });
  }
  return res;
}
const CANDIDATS = Object.fromEntries(RANGS.map((r) => [r, candidats(r + 'C')]));

/** Clé d'un plateau où les pions d'une même couleur sont interchangeables. */
function cleCanonique(pions) {
  const parts = [];
  for (let s = 0; s < 4; s++) parts.push([0, 1, 2, 3].map((i) => pions[4 * s + i]).sort().join('.'));
  return parts.join('|');
}

// ===========================================================================
// 1. Scénarios règle par règle, pour chaque siège
// ===========================================================================

test('bouclage 63 → 0 et capture, pour chaque siège', () => {
  for (const s of SIEGES) {
    // pion 0 en 60 : avance de 6 → 2 en passant devant l'entrée sans y entrer
    const e = etatTourne(s, { 0: 60, 5: 63, 6: 2 });
    const n = jouerT(s, e, 0, { t: 'avance', carte: '6C', pion: 0, pas: 6 });
    assert.equal(posT(s, n, 0), C(s, 2), `siège ${s}`);
    assert.equal(posT(s, n, 5), C(s, 63), `siège ${s} : pas de capture par-dessus`);
    assert.equal(posT(s, n, 6), BASE, `siège ${s} : capture à l'arrivée`);
    // 6 pas depuis 60 avec entrée : 1 jusqu'à l'entrée + 5 dans l'allée → trop grand
    assert.equal(legalT(s, e, 0, { t: 'avance', carte: '6C', pion: 0, pas: 6, allee: true }), false);
    // recul de 4 depuis 1 → 61
    const r = jouerT(s, etatTourne(s, { 0: 1 }), 0, { t: 'recul', carte: '4C', pion: 0 });
    assert.equal(posT(s, r, 0), C(s, 61));
  }
});

test('géométrie : entrée en passant par la case d’entrée ou en partant d’elle, compte exact', () => {
  for (const s of SIEGES) {
    // depuis la case d'entrée elle-même : 1 à 4 pas
    const e = etatTourne(s, { 0: ENTREE });
    for (const pas of [1, 2, 3]) {
      const carte = (pas === 1 ? 'A' : pas) + 'C';
      assert.equal(posT(s, jouerT(s, e, 0, { t: 'avance', carte, pion: 0, pas, allee: true }), 0), a(pas - 1));
    }
    assert.equal(legalT(s, e, 0, { t: 'avance', carte: '5C', pion: 0, pas: 5, allee: true }), false, '5 depuis l’entrée : trop grand');
    assert.equal(posT(s, jouerT(s, e, 0, { t: 'avance', carte: '5C', pion: 0, pas: 5 }), 0), C(s, 2), 'on continue le tour');
    // en passant par la case d'entrée : depuis 59 (2 pas jusqu'à l'entrée) → 3..6
    const f = etatTourne(s, { 0: 59 });
    for (const pas of [3, 5, 6]) {
      assert.equal(posT(s, jouerT(s, f, 0, { t: 'avance', carte: pas + 'C', pion: 0, pas, allee: true }), 0), a(pas - 3));
      assert.equal(posT(s, jouerT(s, f, 0, { t: 'avance', carte: pas + 'C', pion: 0, pas }), 0), C(s, (59 + pas) % 64), 'facultatif');
    }
    assert.deepEqual(avecAllee(coupsLegaux(f, S(s, 0), '2C')), [], '2 : arrive sur l’entrée, pas dans l’allée');
    for (const [carte, pas] of [['8C', 8], ['9C', 9], ['10C', 10], ['DC', 12], ['RC', 13], ['AC', 11]]) {
      assert.equal(legalT(s, f, 0, { t: 'avance', carte, pion: 0, pas, allee: true }), false);
      assert.equal(legalT(s, f, 0, { t: 'avance', carte, pion: 0, pas }), true, `${carte} : continue le tour`);
    }
    // depuis plus loin : 10 depuis 54 (7 jusqu'à l'entrée + 3) → a(2)
    assert.equal(posT(s, jouerT(s, etatTourne(s, { 0: 54 }), 0, { t: 'avance', carte: '10C', pion: 0, pas: 10, allee: true }), 0), a(2));
    // roi depuis 50 : 11 + 2 → a(1)
    assert.equal(posT(s, jouerT(s, etatTourne(s, { 0: 50 }), 0, { t: 'avance', carte: 'RC', pion: 0, pas: 13, allee: true }), 0), a(1));
  }
});

test('géométrie : un pion entre l’entrée et sa case de départ (incluse) doit refaire un tour', () => {
  for (const s of SIEGES) {
    for (const p of [62, 63, 0]) {
      const e = etatTourne(s, { 0: p });
      for (const r of RANGS) {
        assert.deepEqual(avecAllee(coupsLegaux(e, S(s, 0), r + 'C')), [], `case ${p}, carte ${r}`);
      }
      assert.equal(coupsLegaux(e, S(s, 0), '7C').some((c) => c.etapes.some((x) => x.allee)), false);
    }
    // sorti par le jeu, puis directement : pas d'entrée
    const n = jouerT(s, etatTourne(s, {}), 0, { t: 'sortie', carte: 'RC', pion: 0 });
    n.tour = S(s, 0);
    assert.equal(legalT(s, n, 0, { t: 'avance', carte: '2C', pion: 0, pas: 2, allee: true }), false);
  }
});

test('géométrie : sortie, recul de 4 (repasse l’entrée sans entrer), puis 5 → fond de l’allée', () => {
  for (const s of SIEGES) {
    let e = jouerT(s, etatTourne(s, {}), 0, { t: 'sortie', carte: 'AC', pion: 0 });
    e.tour = S(s, 0);
    e = jouerT(s, e, 0, { t: 'recul', carte: '4C', pion: 0 });
    assert.equal(posT(s, e, 0), C(s, 60), 'le 4 repasse l’entrée sans entrer');
    e.tour = S(s, 0);
    assert.deepEqual(avecAllee(coupsLegaux(e, S(s, 0), '5C')).map((c) => c.pas), [5]);
    assert.equal(posT(s, jouerT(s, e, 0, { t: 'avance', carte: '5C', pion: 0, pas: 5, allee: true }), 0), a(3));
    for (const pas of [2, 3]) {
      assert.equal(posT(s, jouerT(s, e, 0, { t: 'avance', carte: pas + 'C', pion: 0, pas, allee: true }), 0), a(pas - 2));
    }
    // un 4 depuis l'entrée ou juste après ne fait jamais entrer
    for (const p of [ENTREE, 62, 63, 1, 2, 3]) {
      const f = jouerT(s, etatTourne(s, { 0: p }), 0, { t: 'recul', carte: '4C', pion: 0 });
      assert.ok(posT(s, f, 0) >= 0 && posT(s, f, 0) < 64);
    }
  }
});

test('géométrie : le pion protégé sur la case de départ ne bloque plus l’entrée de son propriétaire', () => {
  for (const s of SIEGES) {
    const e = etatTourne(s, { 0: 0, 1: 59, 2: 30 });
    assert.equal(estProtege(e, P(s, 0)), true);
    assert.equal(posT(s, jouerT(s, e, 0, { t: 'avance', carte: '5C', pion: 1, pas: 5, allee: true }), 1), a(2));
    // mais il bloque toujours le passage sur le circuit, propriétaire compris
    assert.equal(legalT(s, e, 0, { t: 'avance', carte: '5C', pion: 1, pas: 5 }), false, 'arrivée');
    assert.equal(legalT(s, e, 0, { t: 'avance', carte: '6C', pion: 1, pas: 6 }), false, 'dépassement');
    // 7 : entrée de 59 en a(2) (5 points) + 2 points ailleurs, sans toucher au pion protégé
    const n = jouerT(s, e, 0, { t: 'sept', carte: '7C', etapes: [{ pion: 1, pas: 5, allee: true }, { pion: 2, pas: 2 }] });
    assert.equal(posT(s, n, 0), C(s, 0));
    assert.equal(posT(s, n, 1), a(2));
  }
});

test('géométrie : le pion adverse poussé par le 5 n’entre jamais dans son allée', () => {
  for (const s of SIEGES) {
    const opt = { reglages: { cinqAdverse: true } };
    // pion 4 (siège +1, entrée en 13) en 11 et en 13 : poussé de 5, il reste sur le circuit
    for (const p of [11, 13]) {
      const e = etatTourne(s, { 4: p }, opt);
      const coups = coupsLegaux(e, S(s, 0), '5C');
      assert.deepEqual(coups.map((c) => [c.pion, c.allee]), [[P(s, 4), false]]);
      assert.equal(posT(s, jouerT(s, e, 0, { t: 'avance', carte: '5C', pion: 4, pas: 5 }), 4), C(s, p + 5));
      assert.equal(legalT(s, e, 0, { t: 'avance', carte: '5C', pion: 4, pas: 5, allee: true }), false);
    }
  }
});

test('protection : dépassement, arrivée, recul de 4, valet, 7, 5 adverse (chaque siège)', () => {
  for (const s of SIEGES) {
    const opt = { reglages: { cinqAdverse: true } };
    // pion 4 (siège +1) protégé sur sa case 16
    const e = etatTourne(s, { 0: 12, 4: 16, 1: 40 }, opt);
    assert.equal(estProtege(e, P(s, 4)), true);
    assert.equal(legalT(s, e, 0, { t: 'avance', carte: '6C', pion: 0, pas: 6 }), false, 'dépassement');
    assert.equal(legalT(s, e, 0, { t: 'avance', carte: 'AC', pion: 0, pas: 11 }), false, 'dépassement (as 11)');
    assert.equal(legalT(s, e, 0, { t: 'avance', carte: '3C', pion: 0, pas: 3 }), true);
    assert.equal(legalT(s, etatTourne(s, { 0: 14, 4: 16 }), 0, { t: 'avance', carte: '2C', pion: 0, pas: 2 }), false, 'arrivée');
    assert.equal(legalT(s, etatTourne(s, { 0: 18, 4: 16 }), 0, { t: 'recul', carte: '4C', pion: 0 }), false, '4 par-dessus');
    assert.equal(legalT(s, etatTourne(s, { 0: 20, 4: 16 }), 0, { t: 'recul', carte: '4C', pion: 0 }), false, '4 sur');
    assert.equal(legalT(s, e, 0, { t: 'echange', carte: 'VC', pion: 0, cible: 4 }), false, 'valet');
    assert.equal(legalT(s, e, 0, { t: 'avance', carte: '5C', pion: 4, pas: 5 }), false, '5 adverse');
    // 7 : le pion 0 ne peut dépenser que 0 à 3 points, le pion 1 le reste
    const sept = coupsLegaux(e, S(s, 0), '7C');
    const p0 = new Set(sept.map((c) => apercuCoup(e, S(s, 0), c).pions[P(s, 0)]));
    assert.deepEqual([...p0].sort((x, y) => x - y), [12, 13, 14, 15].map((x) => C(s, x)).sort((x, y) => x - y));
    assert.equal(legalT(s, e, 0, { t: 'sept', carte: '7C', etapes: [{ pion: 0, pas: 4 }, { pion: 1, pas: 3 }] }), false);
    const n = jouerT(s, e, 0, { t: 'sept', carte: '7C', etapes: [{ pion: 0, pas: 3 }, { pion: 1, pas: 4 }] });
    assert.equal(posT(s, n, 4), C(s, 16));
  }
});

test('protection : le propriétaire ne dépasse pas son pion ; il peut l’échanger au valet, les autres non', () => {
  for (const s of SIEGES) {
    const e = etatTourne(s, { 0: 0, 1: 60 });
    assert.equal(legalT(s, e, 0, { t: 'avance', carte: '6C', pion: 1, pas: 6 }), false);
    assert.equal(legalT(s, e, 0, { t: 'avance', carte: '4C', pion: 1, pas: 4 }), false);
    assert.equal(legalT(s, etatTourne(s, { 0: 0, 1: 4 }), 0, { t: 'recul', carte: '4C', pion: 1 }), false);
    // Le propriétaire échange son pion protégé ; un autre joueur ne peut pas le prendre pour cible.
    const v = etatTourne(s, { 0: 0, 4: 30 });
    assert.equal(coupsLegaux(v, S(s, 0), 'VC').length, 1);
    const apres = jouerT(s, v, 0, { t: 'echange', carte: 'VC', pion: 0, cible: 4 });
    assert.equal(posT(s, apres, 0), C(s, 30));
    assert.equal(posT(s, apres, 4), C(s, 0));
    assert.equal(legalT(s, { ...v, tour: S(s, 1) }, 1, { t: 'echange', carte: 'VC', pion: 4, cible: 0 }), false);
  }
});

test('protection : la sortie d’un pion du propriétaire le renvoie à la base ; celle d’un autre siège non', () => {
  for (const s of SIEGES) {
    const e = etatTourne(s, { 0: 0, 4: 16 });
    const n = jouerT(s, e, 0, { t: 'sortie', carte: 'AC', pion: 1 });
    assert.equal(posT(s, n, 0), BASE);
    assert.equal(posT(s, n, 1), C(s, 0));
    const m = jouerT(s, { ...e, tour: S(s, 1) }, 1, { t: 'sortie', carte: 'RC', pion: 5 });
    assert.equal(posT(s, m, 4), BASE);
    assert.equal(posT(s, m, 0), C(s, 0));
  }
});

test('pion étranger sur la case de départ d’un autre : non protégé', () => {
  for (const s of SIEGES) {
    // pion 0 (siège 0) posé sur 16, case de départ du siège 1
    const e = etatTourne(s, { 0: 16, 4: 12, 8: 10 }, { tour: 1 });
    assert.equal(estProtege(e, P(s, 0)), false);
    assert.equal(posT(s, jouerT(s, e, 1, { t: 'avance', carte: '6C', pion: 4, pas: 6 }), 0), C(s, 16), 'dépassé');
    assert.equal(posT(s, jouerT(s, { ...e, pions: e.pions.map((x, q) => (q === P(s, 4) ? C(s, 13) : x)) }, 1, { t: 'avance', carte: '3C', pion: 4, pas: 3 }), 0), BASE, 'capturé');
    assert.equal(posT(s, jouerT(s, e, 1, { t: 'sortie', carte: 'AC', pion: 5 }), 0), BASE, 'sortie');
    const n = jouerT(s, { ...e, tour: S(s, 2) }, 2, { t: 'sept', carte: '7C', etapes: [{ pion: 8, pas: 7 }] });
    assert.equal(posT(s, n, 0), BASE, '7');
    assert.equal(legalT(s, e, 1, { t: 'echange', carte: 'VC', pion: 4, cible: 0 }), true, 'valet');
    // la protection tombe dès que le pion quitte sa case
    const g = jouerT(s, etatTourne(s, { 0: 0, 5: 60 }), 0, { t: 'avance', carte: 'AC', pion: 0, pas: 1 });
    g.tour = S(s, 1);
    assert.equal(legalT(s, g, 1, { t: 'avance', carte: '5C', pion: 5, pas: 5 }), true);
  }
});

test('protection quelle que soit la façon d’arriver : par recul, par 5 adverse, par échange', () => {
  for (const s of SIEGES) {
    let e = jouerT(s, etatTourne(s, { 4: 20, 0: 10 }, { tour: 1 }), 1, { t: 'recul', carte: '4C', pion: 4 });
    assert.equal(estProtege(e, P(s, 4)), true);
    e.tour = S(s, 0);
    assert.equal(legalT(s, e, 0, { t: 'avance', carte: '8C', pion: 0, pas: 8 }), false);
    e = jouerT(s, etatTourne(s, { 4: 11, 0: 10 }, { reglages: { cinqAdverse: true } }), 0, { t: 'avance', carte: '5C', pion: 4, pas: 5 });
    assert.equal(estProtege(e, P(s, 4)), true);
    e.tour = S(s, 0);
    assert.equal(legalT(s, e, 0, { t: 'avance', carte: '8C', pion: 0, pas: 8 }), false);
    e = jouerT(s, etatTourne(s, { 0: 16, 4: 30 }), 0, { t: 'echange', carte: 'VC', pion: 0, cible: 4 });
    assert.equal(estProtege(e, P(s, 4)), true);
  }
});

test('4 : n’est pas une avance de 4 ; interdit dans l’allée', () => {
  for (const s of SIEGES) {
    assert.equal(legalT(s, etatTourne(s, { 0: 58 }), 0, { t: 'avance', carte: '4C', pion: 0, pas: 4, allee: true }), false);
    assert.deepEqual(coupsLegaux(etatTourne(s, { 0: a(1) }), S(s, 0), '4C'), []);
  }
});

test('allée : pas de dépassement, pas de capture de ses pions, carte trop grande, as, valet', () => {
  for (const s of SIEGES) {
    const f = etatTourne(s, { 0: 59, 1: a(1) });
    assert.equal(legalT(s, f, 0, { t: 'avance', carte: '3C', pion: 0, pas: 3, allee: true }), true);
    assert.equal(legalT(s, f, 0, { t: 'avance', carte: '5C', pion: 0, pas: 4 + 0, allee: true }), false, 'arrivée sur son pion');
    assert.equal(legalT(s, f, 0, { t: 'avance', carte: '5C', pion: 0, pas: 5, allee: true }), false, 'dépassement');
    const g = etatTourne(s, { 0: a(1), 4: 30 });
    assert.deepEqual(coupsLegaux(g, S(s, 0), '3C'), []);
    assert.equal(coupsLegaux(g, S(s, 0), '2C').length, 1);
    assert.deepEqual(coupsLegaux(g, S(s, 0), 'AC').map((c) => c.t + (c.pas ?? '')), ['sortie', 'avance1']);
    assert.deepEqual(coupsLegaux(g, S(s, 0), 'VC'), []);
    assert.equal(legalT(s, g, 0, { t: 'echange', carte: 'VC', pion: 0, cible: 4 }), false);
    assert.equal(legalT(s, etatTourne(s, { 0: 30, 4: a(0) }), 0, { t: 'echange', carte: 'VC', pion: 0, cible: 4 }), false);
    // l'allée d'un autre siège ne le concerne pas : passage sur l'entrée du siège +1 (13)
    assert.deepEqual(coupsLegaux(etatTourne(s, { 0: 10 }), S(s, 0), '5C').map((c) => c.allee), [false]);
  }
});

test('7 : tous les points, captures par dépassement (adverse, allié, soi), entrée dans l’allée', () => {
  for (const s of SIEGES) {
    // pion 0 en 57 ; sur le chemin : 58 adversaire, 59 allié, 60 son pion 1 ; entrée en 61
    const e = etatTourne(s, { 0: 57, 5: 58, 8: 59, 1: 60, 2: 30 });
    const n = jouerT(s, e, 0, { t: 'sept', carte: '7C', etapes: [{ pion: 0, pas: 6, allee: true }, { pion: 2, pas: 1 }] });
    assert.equal(posT(s, n, 0), a(1));
    for (const q of [5, 8, 1]) assert.equal(posT(s, n, q), BASE, `pion ${q} capturé`);
    assert.deepEqual(n.dernierCoup.captures.slice().sort(), [5, 8, 1].map((q) => P(s, q)).sort());
    // entrer par un 7 ne capture pas ce qui est au-delà de l'entrée (62, 63, 0…)
    const m = jouerT(s, etatTourne(s, { 0: 59, 6: 62, 7: 63, 2: 30 }), 0, { t: 'sept', carte: '7C', etapes: [{ pion: 0, pas: 3, allee: true }, { pion: 2, pas: 4 }] });
    assert.equal(posT(s, m, 6), C(s, 62));
    assert.equal(posT(s, m, 7), C(s, 63));
    // 7 en plusieurs étapes vers l'allée : 2 jusqu'à l'entrée, puis 1 pour entrer
    assert.equal(legalT(s, etatTourne(s, { 0: 59, 2: 30 }), 0, { t: 'sept', carte: '7C', etapes: [{ pion: 0, pas: 2 }, { pion: 0, pas: 1, allee: true }, { pion: 0, pas: 3 }, { pion: 2, pas: 1 }] }), true);
    assert.equal(legalT(s, e, 0, { t: 'sept', carte: '7C', etapes: [{ pion: 2, pas: 6 }] }), false, '7 partiel');
    assert.equal(legalT(s, e, 0, { t: 'sept', carte: '7C', etapes: [{ pion: 2, pas: 6 }, { pion: 2, pas: 2 }] }), false, '8 points');
    // un pion capturé pendant le 7 ne peut plus être déplacé dans la suite du 7
    assert.equal(legalT(s, e, 0, { t: 'sept', carte: '7C', etapes: [{ pion: 0, pas: 4 }, { pion: 1, pas: 3 }] }), false);
  }
});

test('7 : le reste va au partenaire une fois ses pions rentrés (pendant le 7), victoire', () => {
  for (const s of SIEGES) {
    const e = etatTourne(s, { 0: a(3), 1: a(2), 2: a(1), 3: 59, 8: 40, 9: 41 });
    const n = jouerT(s, e, 0, { t: 'sept', carte: '7C', etapes: [{ pion: 3, pas: 3, allee: true }, { pion: 8, pas: 4 }] });
    assert.equal(posT(s, n, 3), a(0));
    assert.equal(posT(s, n, 8), C(s, 44));
    assert.equal(posT(s, n, 9), BASE, 'le pion du partenaire dépassé est capturé');
    // victoire pendant le 7 quand le reste peut servir au partenaire (entrée du siège +2 : 29)
    const v = etatTourne(s, { 0: a(3), 1: a(2), 2: a(1), 3: 59, 8: a(3), 9: a(2), 10: a(1), 11: 26 });
    const w = jouerT(s, v, 0, { t: 'sept', carte: '7C', etapes: [{ pion: 3, pas: 3, allee: true }, { pion: 11, pas: 4, allee: true }] });
    assert.equal(w.phase, 'fini');
    assert.equal(w.gagnant, S(s, 0) % 2);
  }
});

test('DÉCISION : pas de victoire par un 7 dont le reste ne peut plus servir', () => {
  // Siège 0 : trois pions rentrés, le quatrième en 59 (3 pas pour rentrer en a(0)).
  // Partenaire (siège 2) : déjà fini. Le 7 qui ferait gagner laisse 4 points inutilisables :
  // il est interdit (décision du propriétaire : le 7 doit toujours être dépensé en entier),
  // et s'il est la seule carte jouable, il oblige à repartir pour un tour.
  const e = etatTourne(0, { 0: a(3), 1: a(2), 2: a(1), 3: 59, 8: a(0), 9: a(1), 10: a(2), 11: a(3) });
  assert.notEqual(validerCoup(e, 0, { t: 'sept', carte: '7C', etapes: [{ pion: 3, pas: 3, allee: true }] }), null);
  const coups = coupsLegaux(e, 0, '7C');
  assert.equal(coups.length, 1); // seul coup : passer l'entrée et continuer sur le circuit
  assert.equal(apercuCoup(e, 0, coups[0]).pions[3], 2);
});

test('AMBIGUÏTÉ : le 7 ne peut servir au partenaire tant que ses propres pions ne sont pas rentrés', () => {
  // « Le reste des points peut servir à faire avancer un pion du partenaire. »
  const e = etatTourne(0, { 0: a(2), 8: 40 });
  assert.equal(coupsLegaux(e, 0, '7C').length, 0);
  assert.notEqual(validerCoup(e, 0, { t: 'sept', carte: '7C', etapes: [{ pion: 0, pas: 1, allee: true }, { pion: 8, pas: 6 }] }), null);
});

test('valet : un de ses pions ; joueur fini : un pion du partenaire contre un adverse', () => {
  for (const s of SIEGES) {
    const e = etatTourne(s, { 0: 5, 8: 40, 4: 20 });
    assert.equal(legalT(s, e, 0, { t: 'echange', carte: 'VC', pion: 0, cible: 8 }), true, 'avec le partenaire : permis');
    assert.equal(legalT(s, e, 0, { t: 'echange', carte: 'VC', pion: 8, cible: 4 }), false, 'aucun des siens');
    const f = etatTourne(s, { 0: a(0), 1: a(1), 2: a(2), 3: a(3), 8: 40, 9: 44, 4: 20 });
    const vs = coupsLegaux(f, S(s, 0), 'VC').map((c) => [c.pion, c.cible]);
    assert.deepEqual(vs.sort(), [[P(s, 8), P(s, 4)], [P(s, 9), P(s, 4)]].sort());
    const g = etatTourne(s, { 0: 5 });
    assert.equal(coupsLegaux(g, S(s, 0), 'VC').length, 0);
    assert.match(validerCoup(g, S(s, 0), { t: 'defausse', carte: 'VC' }, ['VC', '2C']), /Défausse interdite/);
    assert.equal(validerCoup(etatTourne(s, {}), S(s, 0), { t: 'defausse', carte: 'VC' }, ['VC', 'DC']), null);
  }
});

test('joueur fini : sort les pions du partenaire, joue 4, avance, 7, et ne déplace plus les siens', () => {
  for (const s of SIEGES) {
    const e = etatTourne(s, { 0: a(0), 1: a(1), 2: a(2), 3: a(3), 8: 40 });
    assert.equal(couleurActive(e, S(s, 0)), S(s, 2));
    assert.equal(posT(s, jouerT(s, e, 0, { t: 'sortie', carte: 'AC', pion: 9 }), 9), C(s, 32));
    assert.equal(legalT(s, e, 0, { t: 'sortie', carte: 'AC', pion: 0 }), false);
    assert.equal(posT(s, jouerT(s, e, 0, { t: 'recul', carte: '4C', pion: 8 }), 8), C(s, 36));
    assert.equal(posT(s, jouerT(s, e, 0, { t: 'avance', carte: '3C', pion: 8, pas: 3 }), 8), C(s, 43));
    assert.equal(coupsLegaux(e, S(s, 0), '7C').length, 1);
    // et il fait entrer le pion du partenaire dans l'allée du partenaire (entrée 29)
    const f = etatTourne(s, { 0: a(0), 1: a(1), 2: a(2), 3: a(3), 8: 27 });
    assert.equal(posT(s, jouerT(s, f, 0, { t: 'avance', carte: '6C', pion: 8, pas: 6, allee: true }), 8), a(3));
  }
});

test('AMBIGUÏTÉ : le joueur fini qui sort un pion du partenaire renvoie le pion protégé du partenaire', () => {
  // « Seule exception : son propriétaire qui sort un nouveau pion le renvoie à la base. »
  // Ici ce n'est pas le propriétaire qui sort mais son partenaire qui a fini ; le moteur l'autorise.
  const e = etatTourne(0, { 0: a(0), 1: a(1), 2: a(2), 3: a(3), 8: 32 });
  assert.equal(appliquerCoup(e, 0, { t: 'sortie', carte: 'RC', pion: 9 }).pions[8], BASE);
});

test('5 adverse : pion adverse seulement, sur le circuit, non protégé', () => {
  for (const s of SIEGES) {
    const opt = { reglages: { cinqAdverse: true } };
    const e = etatTourne(s, { 0: 5, 4: 12, 5: 16, 6: a(0), 8: 40, 7: 60, 1: 1 }, opt);
    const coups = coupsLegaux(e, S(s, 0), '5C').map((c) => c.pion).sort((x, y) => x - y);
    // 4 : chemin bloqué par le 5 protégé ; 5 protégé ; 6 dans l'allée ; 8 partenaire
    assert.deepEqual(coups, [P(s, 0), P(s, 1), P(s, 7)].sort((x, y) => x - y));
    const n = jouerT(s, e, 0, { t: 'avance', carte: '5C', pion: 7, pas: 5 });
    assert.equal(posT(s, n, 7), C(s, 1));
    assert.equal(posT(s, n, 1), BASE, 'le pion poussé capture à l’arrivée');
    const f = etatTourne(s, { 0: a(0), 1: a(1), 2: a(2), 3: a(3), 8: 40, 4: 20 }, opt);
    assert.deepEqual(coupsLegaux(f, S(s, 0), '5C').map((c) => c.pion).sort(), [P(s, 8), P(s, 4)].sort());
  }
});

test('obligation de jouer, défausse, 7 seule carte jouable', () => {
  for (const s of SIEGES) {
    const e = etatTourne(s, { 0: 30 });
    assert.match(validerCoup(e, S(s, 0), { t: 'defausse', carte: 'VC' }, ['VC', '7C']), /Défausse interdite/);
    assert.deepEqual(coupsLegauxMain(e, S(s, 0), ['VC', '7C']).map((c) => c.t), ['sept']);
    const f = etatTourne(s, { 0: 12, 4: 16 });
    assert.equal(mainJouable(f, S(s, 0), ['VC', '7C']), false);
    assert.equal(validerCoup(f, S(s, 0), { t: 'defausse', carte: '7C' }, ['VC', '7C']), null);
    assert.match(validerCoup(e, S(s, 0), { t: 'defausse', carte: 'VC' }, ['VC', '4C']), /Défausse interdite/);
  }
});

// ===========================================================================
// 2. Comparaison différentielle avec l'oracle
// ===========================================================================

test('oracle : chaque coup candidat (hors 7) a le même verdict et le même résultat', () => {
  const rng = generateurAleatoire(2026);
  let compares = 0;
  for (let n = 0; n < 160; n++) {
    const e = positionAleatoire(rng);
    const siege = Math.floor(rng() * 4);
    e.tour = siege;
    if (rng() < 0.2) for (let i = 0; i < 4; i++) e.pions[4 * siege + i] = ALLEE + i; // joueur fini
    geler(e);
    for (const r of RANGS) {
      const generes = coupsLegaux(e, siege, r + 'C');
      const plateauxGeneres = new Set();
      for (const c of generes) {
        const res = apercuCoup(e, siege, c);
        assert.ok(res, `coup généré refusé : ${JSON.stringify(c)} sur ${cle(e.pions)}`);
        assert.equal(validerCoup(e, siege, c), null);
        plateauxGeneres.add(cleCanonique(res.pions));
      }
      const plateauxOracle = new Set();
      for (const c of CANDIDATS[r]) {
        const attendu = O.jouer(e, siege, c);
        const obtenu = apercuCoup(e, siege, c);
        compares++;
        if (!attendu || !obtenu) {
          assert.equal(!!obtenu, !!attendu, `verdict ${JSON.stringify(c)} siège ${siege} sur ${cle(e.pions)} 5adv=${e.reglages.cinqAdverse}`);
          continue;
        }
        assert.deepEqual(obtenu.pions, attendu, JSON.stringify(c));
        plateauxOracle.add(cleCanonique(attendu));
      }
      assert.deepEqual([...plateauxGeneres].sort(), [...plateauxOracle].sort(), `carte ${r} sur ${cle(e.pions)}`);
    }
  }
  assert.ok(compares > 100000);
});

test('oracle : 7 — plateaux finaux, validation des coups générés, etapesSeptPossibles', () => {
  const rng = generateurAleatoire(77);
  for (let n = 0; n < 250; n++) {
    const e = positionAleatoire(rng);
    const siege = Math.floor(rng() * 4);
    e.tour = siege;
    if (rng() < 0.25) for (let i = 0; i < 4; i++) e.pions[4 * siege + i] = ALLEE + i;
    else if (rng() < 0.33) {
      // trois pions rentrés, le quatrième près de l'entrée : fin de joueur en cours de 7
      for (let i = 0; i < 3; i++) e.pions[4 * siege + i] = ALLEE + 3 - i;
      const cell = (16 * siege + 56 + Math.floor(rng() * 6)) % 64;
      e.pions[4 * siege + 3] = e.pions.includes(cell) ? BASE : cell;
    }
    geler(e);
    const { finals, premieres } = O.explorerSept(e.pions, siege);
    const generes = coupsLegaux(e, siege, '7C');
    const plateaux = new Set();
    for (const c of generes) {
      assert.equal(validerCoup(e, siege, c), null, JSON.stringify(c));
      const attendu = O.sept(e, siege, c.etapes);
      assert.ok(attendu, `7 généré refusé par l'oracle : ${JSON.stringify(c)}`);
      assert.deepEqual(apercuCoup(e, siege, c).pions, attendu);
      plateaux.add(cle(attendu));
    }
    assert.equal(plateaux.size, generes.length, 'plateaux finaux en double');
    assert.deepEqual([...plateaux].sort(), [...finals].sort(), `7 sur ${cle(e.pions)} siège ${siege}`);
    const aide = etapesSeptPossibles(e, siege);
    assert.deepEqual(aide.options.map((o) => `${o.pion}:${o.pas}:${o.allee}`).sort(), [...premieres].sort());
    // suivre une décomposition au hasard, étape par étape : on doit toujours pouvoir finir
    let etapes = [];
    for (;;) {
      const ai = etapesSeptPossibles(e, siege, etapes);
      assert.ok(ai);
      if (ai.reste === 0 || ai.options.length === 0) {
        if (finals.size > 0) assert.equal(ai.reste, 0, 'impasse proposée par etapesSeptPossibles');
        break;
      }
      const o = ai.options[Math.floor(rng() * ai.options.length)];
      const suite = apercuCoup(e, siege, { t: 'sept', carte: '7C', etapes: etapes.concat([{ pion: o.pion, pas: o.pas, allee: o.allee }]) });
      assert.equal(!!suite, ai.reste === o.pas, '7 complet si et seulement si le reste est épuisé');
      if (suite) assert.equal(suite.pions[o.pion], o.vers);
      etapes = etapes.concat([{ pion: o.pion, pas: o.pas, allee: o.allee }]);
    }
    if (finals.size > 0) assert.equal(validerCoup(e, siege, { t: 'sept', carte: '7C', etapes }), null);
  }
});

test('oracle : décompositions du 7 tirées au hasard (y compris illégales), même verdict', () => {
  const rng = generateurAleatoire(5);
  for (let n = 0; n < 300; n++) {
    const e = positionAleatoire(rng);
    const siege = Math.floor(rng() * 4);
    e.tour = siege;
    geler(e);
    for (let k = 0; k < 60; k++) {
      const etapes = [];
      let reste = 7 + (rng() < 0.1 ? 1 : 0) - (rng() < 0.1 ? 1 : 0);
      while (reste > 0) {
        const pas = 1 + Math.floor(rng() * reste);
        const g = rng() < 0.8 ? 4 * siege + Math.floor(rng() * 4) : Math.floor(rng() * 16);
        etapes.push({ pion: g, pas, allee: rng() < 0.4 });
        reste -= pas;
      }
      const coup = { t: 'sept', carte: '7C', etapes };
      const sommeOk = etapes.reduce((t, x) => t + x.pas, 0) === 7;
      const attendu = sommeOk ? O.sept(e, siege, etapes) : null;
      const obtenu = apercuCoup(e, siege, coup);
      assert.equal(!!obtenu, !!attendu, JSON.stringify(coup) + ' sur ' + cle(e.pions));
      if (obtenu) assert.deepEqual(obtenu.pions, attendu);
    }
  }
});

// ===========================================================================
// 3. Entrées mal formées, non-mutation
// ===========================================================================

test('entrées mal formées : rejet propre, sans exception ni mutation', () => {
  const e = geler(etatTourne(0, { 0: 5, 1: 59, 4: 20 }));
  const mauvais = [
    null, undefined, 42, 'sortie', {}, { t: 'avance' }, { carte: '5C' },
    { t: 'avance', carte: 5, pion: 0, pas: 5 },
    { t: 'avance', carte: '5C', pion: '0', pas: 5 },
    { t: 'avance', carte: '5C', pion: 0, pas: '5' },
    { t: 'avance', carte: '5C', pion: 0, pas: 5.5 },
    { t: 'avance', carte: '5C', pion: 0.5, pas: 5 },
    { t: 'avance', carte: '5C', pion: -1, pas: 5 },
    { t: 'avance', carte: '5C', pion: 16, pas: 5 },
    { t: 'avance', carte: '5C', pion: NaN, pas: 5 },
    { t: 'avance', carte: '5C', pion: 0, pas: Infinity },
    { t: 'avance', carte: '5C', pion: 0 },
    { t: 'avance', carte: '5C', pion: 0, pas: 0 },
    { t: 'avance', carte: '5C', pion: 0, pas: -5 },
    { t: 'sortie', carte: 'AC', pion: 99 },
    { t: 'sortie', carte: 'AC' },
    { t: 'recul', carte: '4C', pion: null },
    { t: 'echange', carte: 'VC', pion: 0 },
    { t: 'echange', carte: 'VC', pion: 0, cible: 0 },
    { t: 'echange', carte: 'VC', pion: 0, cible: 100 },
    { t: 'sept', carte: '7C' },
    { t: 'sept', carte: '7C', etapes: [] },
    { t: 'sept', carte: '7C', etapes: 'abc' },
    { t: 'sept', carte: '7C', etapes: { 0: { pion: 0, pas: 7 }, length: 1 } },
    { t: 'sept', carte: '7C', etapes: [null] },
    { t: 'sept', carte: '7C', etapes: [{ pion: 0, pas: 7 }, null] },
    { t: 'sept', carte: '7C', etapes: [{ pion: 0, pas: 0 }, { pion: 0, pas: 7 }] },
    { t: 'sept', carte: '7C', etapes: [{ pion: 0, pas: 3.5 }, { pion: 0, pas: 3.5 }] },
    { t: 'sept', carte: '7C', etapes: [{ pion: 0, pas: 8 }] },
    { t: 'sept', carte: '7C', etapes: [{ pion: 0, pas: 4 }, { pion: 0, pas: -1 }, { pion: 0, pas: 4 }] },
    { t: 'sept', carte: '7C', etapes: [{ pas: 7 }] },
    { t: 'sept', carte: '6C', etapes: [{ pion: 0, pas: 7 }] },
    { t: 'inconnu', carte: '5C', pion: 0, pas: 5 },
    { t: 'avance', carte: '', pion: 0, pas: 5 },
    { t: 'avance', carte: 'C', pion: 0, pas: 5 },
  ];
  for (const coup of mauvais) {
    let r;
    assert.doesNotThrow(() => (r = validerCoup(e, 0, coup)), JSON.stringify(coup));
    assert.equal(typeof r, 'string', `accepté : ${JSON.stringify(coup)}`);
    assert.throws(() => appliquerCoup(e, 0, coup), Error);
    assert.doesNotThrow(() => apercuCoup(e, 0, coup));
  }
  assert.equal(typeof validerCoup(e, 5, { t: 'avance', carte: '5C', pion: 0, pas: 5 }), 'string');
  assert.equal(typeof validerCoup(e, '0', { t: 'avance', carte: '5C', pion: 0, pas: 5 }), 'string');
  assert.equal(etapesSeptPossibles(e, 0, [{ pion: 0, pas: 8 }]), null);
  assert.equal(etapesSeptPossibles(e, 0, [{ pion: 4, pas: 1 }]), null);
  assert.equal(etapesSeptPossibles(e, 0, [null]), null);
});

test('BUG : etapesSeptPossibles lève une exception si `etapes` vaut null ou n’est pas un tableau', () => {
  // BUG : `for (const e of etapes)` sur null / un objet / un nombre → TypeError
  // « etapes is not iterable ». Attendu : null, comme pour toute autre étape invalide.
  const e = etatTourne(0, { 0: 5 });
  for (const etapes of [null, {}, 42]) {
    let r;
    assert.doesNotThrow(() => (r = etapesSeptPossibles(e, 0, etapes)), JSON.stringify(etapes));
    assert.equal(r, null, JSON.stringify(etapes));
  }
});

test('BUG : coupsLegaux / validerCoup(défausse) lèvent une exception sur une carte non chaîne', () => {
  // BUG : rang(carte) appelle carte.slice ; une main contenant autre chose qu'une chaîne fait
  // planter validerCoup sur une défausse (au lieu de renvoyer un message d'erreur).
  const e = etatTourne(0, { 0: 5 });
  assert.doesNotThrow(() => coupsLegaux(e, 0, null));
  assert.doesNotThrow(() => validerCoup(e, 0, { t: 'defausse', carte: 'AC' }, ['AC', null]));
});

test('BUG (mineur) : une carte qui n’existe pas est acceptée quand la main n’est pas fournie', () => {
  // BUG : seul le rang est lu (carte.slice(0, -1)) ; '5Z' passe. Sans main, la défausse d'une
  // carte inexistante est aussi acceptée. (Sans conséquence quand la main est fournie.)
  const e = etatTourne(0, { 0: 5 });
  assert.equal(typeof validerCoup(e, 0, { t: 'avance', carte: '5Z', pion: 0, pas: 5 }), 'string');
  assert.equal(typeof validerCoup(e, 0, { t: 'defausse', carte: 'ZZ' }), 'string');
});

test('l’état d’entrée n’est jamais modifié (états gelés), parties aléatoires', () => {
  const rng = generateurAleatoire(11);
  for (let graine = 0; graine < 6; graine++) {
    let p = nouvellePartie({ cinqAdverse: graine % 2 === 1 }, rng);
    let garde = 0;
    while (p.etat.phase !== 'fini' && garde++ < 3000) {
      geler(p.etat);
      if (p.etat.phase === 'echange') {
        for (let s = 0; s < 4; s++) p = donnerCarte(p, s, p.mains[s][0]);
        continue;
      }
      const s = p.etat.tour;
      const coups = coupsLegauxMain(p.etat, s, p.mains[s]);
      for (const c of coups.slice(0, 5)) if (c.t === 'sept') etapesSeptPossibles(p.etat, s, c.etapes.slice(0, 1));
      p = jouerCoup(p, s, coups[Math.floor(rng() * coups.length)], rng);
    }
  }
});

// ===========================================================================
// 4. Distribution, échanges, ordre des tours
// ===========================================================================

test('cycle 5-4-4 répété, échange à chaque donne, premier joueur tournant, tours dans l’ordre', () => {
  const rng = generateurAleatoire(3);
  let p = nouvellePartie({}, rng);
  const vues = [];
  let cartesDuCycle = new Set();
  let donne = -1;
  let attendu = null;
  let garde = 0;
  while (p.etat.phase !== 'fini' && p.etat.donne < 9 && garde++ < 5000) {
    if (p.etat.phase === 'echange') {
      if (p.etat.donne !== donne) {
        donne = p.etat.donne;
        assert.equal(p.etat.tour, donne % 4);
        assert.deepEqual(p.mains.map((m) => m.length), Array(4).fill([5, 4, 4][donne % 3]));
        if (donne % 3 === 0) {
          if (donne > 0) assert.equal(cartesDuCycle.size, 52);
          cartesDuCycle = new Set();
          assert.deepEqual(p.etat.pile, []);
        }
        for (const m of p.mains) for (const c of m) {
          assert.ok(!cartesDuCycle.has(c), 'carte distribuée deux fois dans un cycle');
          cartesDuCycle.add(c);
        }
        vues.push(p.mains[0].length);
      }
      const dons = p.mains.map((m) => m[m.length - 1]);
      for (let s = 0; s < 4; s++) p = donnerCarte(p, s, dons[s]);
      for (let s = 0; s < 4; s++) assert.ok(p.mains[(s + 2) % 4].includes(dons[s]));
      attendu = p.etat.tour;
      continue;
    }
    assert.equal(p.etat.tour, attendu);
    const s = p.etat.tour;
    const coups = coupsLegauxMain(p.etat, s, p.mains[s]);
    p = jouerCoup(p, s, coups[Math.floor(rng() * coups.length)], rng);
    attendu = (s + 1) % 4;
  }
  assert.deepEqual(vues.slice(0, 7), [5, 4, 4, 5, 4, 4, 5]);
});

test('BUG (mineur) : marquerEchange accepte un siège hors bornes et corrompt `echanges`', () => {
  // BUG : marquerEchange(etat, 7) écrit echanges[7] = true (tableau à trous de longueur 8).
  const e = etatInitial();
  assert.throws(() => marquerEchange(marquerEchange(e, 0), 0));
  assert.throws(() => marquerEchange(e, 7));
});
