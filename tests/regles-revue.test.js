// Relecture indépendante du moteur de règles (public/js/moteur) contre docs/cahier-des-charges.md.
//
// Organisation :
//   1. Scénarios règle par règle, joués pour CHAQUE siège (rotation du plateau), ce qui
//      vérifie au passage le bouclage 63 → 0 pour les quatre couleurs.
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
  nouvellePartie, donnerCarte, jouerCoup, generateurAleatoire, tailleDonne,
} from '../public/js/moteur/index.js';

// ---------------------------------------------------------------------------
// Outils
// ---------------------------------------------------------------------------

const a = (n) => ALLEE + n;

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
  if (extra.frais) for (const g of extra.frais) e.frais[P(s, g)] = true;
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

function geler(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) geler(v);
  }
  return o;
}

// ---------------------------------------------------------------------------
// Oracle indépendant (réécrit à partir du cahier des charges et des trois choix
// d'interprétation annoncés dans l'en-tête de regles.js). Il avance case par case.
// ---------------------------------------------------------------------------

const O = {
  depart: (s) => 16 * s,
  protege: (pions, q) => pions[q] === 16 * (q >> 2),
  occupant(pions, cell, sauf) {
    for (let q = 0; q < 16; q++) if (q !== sauf && pions[q] === cell) return q;
    return -1;
  },
  fini: (pions, s) => [0, 1, 2, 3].every((i) => pions[4 * s + i] >= ALLEE),
  actif: (pions, s) => (O.fini(pions, s) ? (s + 2) % 4 : s),
  alleePrise: (pions, o, k) => [0, 1, 2, 3].some((i) => pions[4 * o + i] === ALLEE + k),

  /** Avance pas à pas. Renvoie { pions, frais } ou null. */
  avance(pions, frais, g, pas, allee, sept) {
    const p = pions[g];
    const o = g >> 2;
    if (p === BASE || !(p >= 0)) return null;
    const np = pions.slice();
    const nf = frais.slice();
    if (p >= ALLEE) {
      let k = p - ALLEE;
      for (let i = 0; i < pas; i++) {
        k++;
        if (k > 3 || O.alleePrise(pions, o, k)) return null;
      }
      np[g] = ALLEE + k;
      nf[g] = false;
      return { pions: np, frais: nf };
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
      if (allee && pos === O.depart(o) && !(pos === p && frais[g])) {
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
    for (const q of captures) {
      np[q] = BASE;
      nf[q] = false;
    }
    np[g] = k >= 0 ? ALLEE + k : pos;
    nf[g] = false;
    return { pions: np, frais: nf };
  },

  recul(pions, frais, g) {
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
    const nf = frais.slice();
    if (capture >= 0) {
      np[capture] = BASE;
      nf[capture] = false;
    }
    np[g] = pos;
    nf[g] = false;
    return { pions: np, frais: nf };
  },

  pasCarte: { A: [1, 11], R: [13], D: [12], 2: [2], 3: [3], 5: [5], 6: [6], 8: [8], 9: [9], 10: [10] },

  /** Coup hors 7 et hors défausse. */
  jouer(etat, siege, coup) {
    const { pions, frais } = etat;
    const r = coup.carte.slice(0, -1);
    const c = O.actif(pions, siege);
    const estPion = (g) => Number.isInteger(g) && g >= 0 && g < 16;
    const circuitLibre = (q) => pions[q] >= 0 && pions[q] < 64 && !O.protege(pions, q);
    switch (coup.t) {
      case 'sortie': {
        if (!['A', 'R'].includes(r) || !estPion(coup.pion) || coup.pion >> 2 !== c || pions[coup.pion] !== BASE) return null;
        const np = pions.slice();
        const nf = frais.slice();
        const q = O.occupant(pions, O.depart(c), -1);
        if (q >= 0) {
          np[q] = BASE;
          nf[q] = false;
        }
        np[coup.pion] = O.depart(c);
        nf[coup.pion] = true;
        return { pions: np, frais: nf };
      }
      case 'avance': {
        const g = coup.pion;
        if (!estPion(g) || !O.pasCarte[r] || !O.pasCarte[r].includes(coup.pas)) return null;
        if (g >> 2 === c) return O.avance(pions, frais, g, coup.pas, !!coup.allee, false);
        if (r === '5' && etat.reglages.cinqAdverse && (g >> 2) % 2 !== siege % 2 && !coup.allee && circuitLibre(g)) {
          return O.avance(pions, frais, g, 5, false, false);
        }
        return null;
      }
      case 'recul':
        if (r !== '4' || !estPion(coup.pion) || coup.pion >> 2 !== c) return null;
        return O.recul(pions, frais, coup.pion);
      case 'echange': {
        const { pion: x, cible: y } = coup;
        if (r !== 'V' || !estPion(x) || !estPion(y) || x >> 2 !== c || y >> 2 === c) return null;
        if (!circuitLibre(x) || !circuitLibre(y)) return null;
        const np = pions.slice();
        [np[x], np[y]] = [pions[y], pions[x]];
        return { pions: np, frais: frais.slice() };
      }
      default:
        return null;
    }
  },

  /** Étapes d'un 7 (contrôle complet). */
  sept(etat, siege, etapes) {
    let pions = etat.pions;
    let frais = etat.frais;
    let reste = 7;
    for (const e of etapes) {
      if (!Number.isInteger(e.pas) || e.pas < 1 || e.pas > reste) return null;
      if (e.pion >> 2 !== O.actif(pions, siege)) return null;
      const res = O.avance(pions, frais, e.pion, e.pas, !!e.allee, true);
      if (!res) return null;
      ({ pions, frais } = res);
      reste -= e.pas;
    }
    return reste === 0 ? { pions, frais } : null;
  },

  /** Plateaux finaux atteignables par un 7, et étapes initiales complétables. */
  explorerSept(pions, frais, siege) {
    const finals = new Set();
    const memo = new Map();
    const rec = (pi, fr, reste) => {
      if (reste === 0) {
        finals.add(cle(pi));
        return true;
      }
      const k = cle(pi) + '/' + cle(fr) + '/' + reste;
      if (memo.has(k)) return memo.get(k);
      let ok = false;
      const c = O.actif(pi, siege);
      for (let g = 4 * c; g < 4 * c + 4; g++) {
        for (let pas = 1; pas <= reste; pas++) {
          for (const al of [false, true]) {
            const res = O.avance(pi, fr, g, pas, al, true);
            if (res && rec(res.pions, res.frais, reste - pas)) ok = true;
          }
        }
      }
      memo.set(k, ok);
      return ok;
    };
    rec(pions, frais, 7);
    const premieres = new Set();
    const c = O.actif(pions, siege);
    for (let g = 4 * c; g < 4 * c + 4; g++) {
      for (let pas = 1; pas <= 7; pas++) {
        for (const al of [false, true]) {
          const res = O.avance(pions, frais, g, pas, al, true);
          // dans l'allée, le drapeau allee n'a pas de sens : on normalise à true
          if (res && rec(res.pions, res.frais, 7 - pas)) premieres.add(`${g}:${pas}:${pions[g] >= ALLEE ? true : al}`);
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
  // cases « intéressantes » : cases de départ et leurs abords
  const chaudes = [];
  for (let s = 0; s < 4; s++) for (let d = -5; d <= 5; d++) chaudes.push((16 * s + d + 64) % 64);
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
    if (cell === 16 * o && rng() < 0.5) e.frais[g] = true;
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
function cleCanonique(pions, frais) {
  const parts = [];
  for (let s = 0; s < 4; s++) {
    parts.push(
      [0, 1, 2, 3]
        .map((i) => `${pions[4 * s + i]}${frais[4 * s + i] ? '*' : ''}`)
        .sort()
        .join('.'),
    );
  }
  return parts.join('|');
}

// ===========================================================================
// 1. Scénarios règle par règle, pour chaque siège
// ===========================================================================

test('bouclage 63 → 0 et capture, pour chaque siège', () => {
  for (const s of SIEGES) {
    // pion 0 en 60 (relatif) : avance de 6 → 2, en passant par-dessus un adversaire en 63
    const e = etatTourne(s, { 0: 60, 5: 63, 6: 2 });
    const n = jouerT(s, e, 0, { t: 'avance', carte: '6C', pion: 0, pas: 6 });
    assert.equal(posT(s, n, 0), C(s, 2), `siège ${s}`);
    assert.equal(posT(s, n, 5), C(s, 63), `siège ${s} : pas de capture par-dessus`);
    assert.equal(posT(s, n, 6), BASE, `siège ${s} : capture à l'arrivée`);
    // recul de 4 depuis 1 → 61
    const r = jouerT(s, etatTourne(s, { 0: 1 }), 0, { t: 'recul', carte: '4C', pion: 0 });
    assert.equal(posT(s, r, 0), C(s, 61));
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
    // 7 : le pion 0 ne peut dépenser que 1 à 3 points, le pion 1 le reste
    const sept = coupsLegaux(e, S(s, 0), '7C');
    const p0 = new Set(sept.map((c) => apercuCoup(e, S(s, 0), c).pions[P(s, 0)]));
    assert.deepEqual([...p0].sort((x, y) => x - y), [12, 13, 14, 15].map((x) => C(s, x)).sort((x, y) => x - y));
    assert.equal(legalT(s, e, 0, { t: 'sept', carte: '7C', etapes: [{ pion: 0, pas: 4 }, { pion: 1, pas: 3 }] }), false);
    // le pion protégé passé par l'adversaire n'est pas capturé par un 7 qui s'arrête avant
    const n = jouerT(s, e, 0, { t: 'sept', carte: '7C', etapes: [{ pion: 0, pas: 3 }, { pion: 1, pas: 4 }] });
    assert.equal(posT(s, n, 4), C(s, 16));
  }
});

test('protection : le propriétaire non plus ne dépasse pas son pion, même pour entrer dans l’allée', () => {
  for (const s of SIEGES) {
    const e = etatTourne(s, { 0: 0, 1: 60 }, { frais: [0] });
    assert.equal(legalT(s, e, 0, { t: 'avance', carte: '6C', pion: 1, pas: 6 }), false);
    assert.equal(legalT(s, e, 0, { t: 'avance', carte: '6C', pion: 1, pas: 6, allee: true }), false);
    assert.equal(legalT(s, e, 0, { t: 'avance', carte: '4C', pion: 1, pas: 4 }), false, "arrivée sur son pion protégé");
    // propriétaire, recul sur son propre pion protégé
    assert.equal(legalT(s, etatTourne(s, { 0: 0, 1: 4 }), 0, { t: 'recul', carte: '4C', pion: 1 }), false);
    // valet : son propre pion protégé ne s'échange pas
    assert.equal(coupsLegaux(etatTourne(s, { 0: 0, 4: 30 }), S(s, 0), 'VC').length, 0);
  }
});

test('protection : la sortie d’un pion du propriétaire le renvoie à la base ; celle d’un autre siège non', () => {
  for (const s of SIEGES) {
    const e = etatTourne(s, { 0: 0, 4: 16 }, { frais: [0] });
    const n = jouerT(s, e, 0, { t: 'sortie', carte: 'AC', pion: 1 });
    assert.equal(posT(s, n, 0), BASE);
    assert.equal(posT(s, n, 1), C(s, 0));
    assert.equal(n.frais[P(s, 1)], true);
    // le siège +1 sort : son pion protégé 4 est renvoyé, le pion 0 n'est pas touché
    const m = jouerT(s, { ...e, tour: S(s, 1) }, 1, { t: 'sortie', carte: 'RC', pion: 5 });
    assert.equal(posT(s, m, 4), BASE);
    assert.equal(posT(s, m, 0), C(s, 0));
  }
});

test('pion étranger sur la case de départ d’un autre : non protégé', () => {
  for (const s of SIEGES) {
    // pion 0 (siège 0) posé sur 16, case de départ du siège 1
    const e = etatTourne(s, { 0: 16, 4: 12, 8: 10, 1: 40 }, { tour: 1 });
    assert.equal(estProtege(e, P(s, 0)), false);
    // dépassé par le siège 1
    assert.equal(posT(s, jouerT(s, e, 1, { t: 'avance', carte: '6C', pion: 4, pas: 6 }), 0), C(s, 16));
    // capturé à l'arrivée
    assert.equal(posT(s, jouerT(s, e, 1, { t: 'avance', carte: '4C', pion: 4, pas: 4 }) ?? e, 0), C(s, 16)); // 4 n'avance pas
    // capturé par la sortie du siège 1
    assert.equal(posT(s, jouerT(s, e, 1, { t: 'sortie', carte: 'AC', pion: 5 }), 0), BASE);
    // dépassé par un 7 : capturé
    const f = { ...e, tour: S(s, 2) };
    const n = jouerT(s, f, 2, { t: 'sept', carte: '7C', etapes: [{ pion: 8, pas: 7 }] });
    assert.equal(posT(s, n, 0), BASE);
    // échangeable au valet
    assert.equal(legalT(s, e, 1, { t: 'echange', carte: 'VC', pion: 4, cible: 0 }), true);
    // le pion qui quitte sa case de départ perd la protection
    const g = jouerT(s, etatTourne(s, { 0: 0, 5: 60 }), 0, { t: 'avance', carte: 'AC', pion: 0, pas: 1 });
    g.tour = S(s, 1);
    assert.equal(legalT(s, g, 1, { t: 'avance', carte: '5C', pion: 5, pas: 5 }), true);
  }
});

test('protection quelle que soit la façon d’arriver : par recul, par 5 adverse, par avance', () => {
  for (const s of SIEGES) {
    // recul de 4 : pion 4 de 20 à 16
    let e = jouerT(s, etatTourne(s, { 4: 20, 0: 10 }, { tour: 1 }), 1, { t: 'recul', carte: '4C', pion: 4 });
    assert.equal(estProtege(e, P(s, 4)), true);
    e.tour = S(s, 0);
    assert.equal(legalT(s, e, 0, { t: 'avance', carte: '8C', pion: 0, pas: 8 }), false);
    // 5 adverse : le siège 0 pousse le pion 4 de 11 à 16
    e = jouerT(s, etatTourne(s, { 4: 11, 0: 10 }, { reglages: { cinqAdverse: true } }), 0, { t: 'avance', carte: '5C', pion: 4, pas: 5 });
    assert.equal(estProtege(e, P(s, 4)), true);
    e.tour = S(s, 0);
    assert.equal(legalT(s, e, 0, { t: 'avance', carte: '8C', pion: 0, pas: 8 }), false);
    // un pion revenu sur sa case de départ n'est pas « frais » : il peut entrer dans l'allée
    e = jouerT(s, etatTourne(s, { 0: 60 }), 0, { t: 'avance', carte: '4C', pion: 0, pas: 4 });
    assert.equal(e, null ?? e); // (4 ne fait pas avancer : voir ci-dessous)
  }
});

test('4 : n’est pas une avance de 4', () => {
  for (const s of SIEGES) assert.equal(legalT(s, etatTourne(s, { 0: 60 }), 0, { t: 'avance', carte: '4C', pion: 0, pas: 4 }), false);
});

test('allée : entrée facultative, compte exact, carte trop grande, sans dépasser (chaque siège)', () => {
  for (const s of SIEGES) {
    const e = etatTourne(s, { 0: 62 });
    for (let pas of [3, 5, 6]) {
      const n = jouerT(s, e, 0, { t: 'avance', carte: pas + 'C', pion: 0, pas, allee: true });
      assert.equal(posT(s, n, 0), a(pas - 3));
      const m = jouerT(s, e, 0, { t: 'avance', carte: pas + 'C', pion: 0, pas });
      assert.equal(posT(s, m, 0), C(s, (62 + pas) % 64), 'entrée facultative');
    }
    // 7 points ou plus : trop grand, le pion continue sur le circuit
    for (const pas of [8, 9, 10, 12, 13]) {
      const carte = { 12: 'D', 13: 'R' }[pas] ?? pas;
      assert.equal(legalT(s, e, 0, { t: 'avance', carte: carte + 'C', pion: 0, pas, allee: true }), false);
      assert.equal(legalT(s, e, 0, { t: 'avance', carte: carte + 'C', pion: 0, pas }), true);
    }
    // pas de dépassement dans l'allée, ni de capture de ses propres pions
    const f = etatTourne(s, { 0: 62, 1: a(1) });
    assert.equal(legalT(s, f, 0, { t: 'avance', carte: '3C', pion: 0, pas: 3, allee: true }), true);
    assert.equal(legalT(s, f, 0, { t: 'avance', carte: '5C', pion: 0, pas: 5, allee: true }), false, 'arrivée sur son pion');
    assert.equal(legalT(s, f, 0, { t: 'avance', carte: '6C', pion: 0, pas: 6, allee: true }), false, 'dépassement');
    // pion déjà dans l'allée : carte trop grande non jouable, as = 1 seulement, 4 et valet interdits
    const g = etatTourne(s, { 0: a(1), 4: 30 });
    assert.deepEqual(coupsLegaux(g, S(s, 0), '3C'), []);
    assert.deepEqual(coupsLegaux(g, S(s, 0), '2C').length, 1);
    assert.deepEqual(coupsLegaux(g, S(s, 0), 'AC').map((c) => c.t + c.pas), ['sortie' + undefined, 'avance1']);
    assert.deepEqual(coupsLegaux(g, S(s, 0), '4C'), []);
    assert.deepEqual(coupsLegaux(g, S(s, 0), 'VC'), []);
    assert.equal(legalT(s, g, 0, { t: 'recul', carte: '4C', pion: 0 }), false);
    assert.equal(legalT(s, g, 0, { t: 'echange', carte: 'VC', pion: 0, cible: 4 }), false);
    // un pion adverse ne peut pas être échangé contre un pion qui est dans son allée
    assert.equal(legalT(s, etatTourne(s, { 0: 30, 4: a(0) }), 0, { t: 'echange', carte: 'VC', pion: 0, cible: 4 }), false);
    // l'allée d'un autre siège ne le concerne pas : passage sur 16 sans entrée possible
    assert.deepEqual(coupsLegaux(etatTourne(s, { 0: 14 }), S(s, 0), '5C').map((c) => c.allee), [false]);
  }
});

test('allée : pion frais (qui vient de sortir) ne rentre pas directement ; après un tour il peut', () => {
  for (const s of SIEGES) {
    const e = etatTourne(s, { 0: 0 }, { frais: [0] });
    for (const pas of [2, 3]) assert.equal(legalT(s, e, 0, { t: 'avance', carte: pas + 'C', pion: 0, pas, allee: true }), false);
    // sorti par le jeu (et non fabriqué à la main)
    let n = jouerT(s, etatTourne(s, {}), 0, { t: 'sortie', carte: 'RC', pion: 0 });
    n.tour = S(s, 0);
    assert.equal(legalT(s, n, 0, { t: 'avance', carte: '2C', pion: 0, pas: 2, allee: true }), false);
    // le même pion, non frais (revenu après un tour), peut rentrer
    const f = etatTourne(s, { 0: 0 });
    assert.equal(posT(s, jouerT(s, f, 0, { t: 'avance', carte: '2C', pion: 0, pas: 2, allee: true }), 0), a(1));
    // le pion frais peut entrer dans l'allée par un 7 ? Non plus.
    assert.equal(legalT(s, e, 0, { t: 'sept', carte: '7C', etapes: [{ pion: 0, pas: 4, allee: true }, { pion: 0, pas: 3 }] }), false);
  }
});

test('7 : tous les points, captures par dépassement (adverse, allié, soi), entrée dans l’allée', () => {
  for (const s of SIEGES) {
    // pion 0 en 60 ; sur le chemin : 61 adversaire, 62 allié, 63 son pion 1 ; puis allée
    const e = etatTourne(s, { 0: 60, 5: 61, 8: 62, 1: 63, 2: 30 });
    const n = jouerT(s, e, 0, { t: 'sept', carte: '7C', etapes: [{ pion: 0, pas: 6, allee: true }, { pion: 2, pas: 1 }] });
    assert.equal(posT(s, n, 0), a(1));
    for (const q of [5, 8, 1]) assert.equal(posT(s, n, q), BASE, `pion ${q} capturé`);
    assert.deepEqual(n.dernierCoup.captures.map((q) => q).sort(), [5, 8, 1].map((q) => P(s, q)).sort());
    // entrer dans l'allée par un 7 ne capture que ce qui est sur le circuit jusqu'à la case de départ
    const m = jouerT(s, etatTourne(s, { 0: 62, 6: 2, 2: 30 }), 0, { t: 'sept', carte: '7C', etapes: [{ pion: 0, pas: 3, allee: true }, { pion: 2, pas: 4 }] });
    assert.equal(posT(s, m, 6), C(s, 2));
    // 7 partiel interdit, 7 dépassant le total interdit
    assert.equal(legalT(s, e, 0, { t: 'sept', carte: '7C', etapes: [{ pion: 2, pas: 6 }] }), false);
    assert.equal(legalT(s, e, 0, { t: 'sept', carte: '7C', etapes: [{ pion: 2, pas: 6 }, { pion: 2, pas: 2 }] }), false);
    // un pion capturé pendant le 7 ne peut plus être déplacé dans la suite du 7
    assert.equal(legalT(s, e, 0, { t: 'sept', carte: '7C', etapes: [{ pion: 0, pas: 4 }, { pion: 1, pas: 3 }] }), false);
  }
});

test('7 : le reste va au partenaire une fois ses pions rentrés (pendant le 7), victoire', () => {
  for (const s of SIEGES) {
    const e = etatTourne(s, { 0: a(3), 1: a(2), 2: a(1), 3: 62, 8: 40, 9: 41 });
    const n = jouerT(s, e, 0, { t: 'sept', carte: '7C', etapes: [{ pion: 3, pas: 3, allee: true }, { pion: 8, pas: 4 }] });
    // le pion 8 qui passe par-dessus le pion 9 (allié de son propre camp) le capture
    assert.equal(posT(s, n, 8), C(s, 44));
    assert.equal(posT(s, n, 9), BASE);
    // victoire pendant le 7 si le reste peut être joué par le partenaire
    const v = etatTourne(s, { 0: a(3), 1: a(2), 2: a(1), 3: 62, 8: a(3), 9: a(2), 10: a(1), 11: 30 });
    const w = jouerT(s, v, 0, { t: 'sept', carte: '7C', etapes: [{ pion: 3, pas: 3, allee: true }, { pion: 11, pas: 2 }, { pion: 11, pas: 2, allee: true }] });
    assert.equal(w.phase, 'fini');
    assert.equal(w.gagnant, S(s, 0) % 2);
  }
});

test('AMBIGUÏTÉ : victoire impossible par un 7 dont le reste ne peut plus servir', () => {
  // Siège 0 : trois pions rentrés, le quatrième en 62 (3 pas pour rentrer en a(0)).
  // Partenaire (siège 2) : déjà fini. Le 7 qui ferait gagner laisse 4 points inutilisables :
  // le moteur l'interdit (et, si le 7 est la seule carte, oblige à faire un tour de plus).
  // Le cahier des charges (« La partie est gagnée quand… ») ne tranche pas ce cas.
  const e = etatTourne(0, { 0: a(3), 1: a(2), 2: a(1), 3: 62, 8: a(0), 9: a(1), 10: a(2), 11: a(3) });
  assert.notEqual(validerCoup(e, 0, { t: 'sept', carte: '7C', etapes: [{ pion: 3, pas: 3, allee: true }] }), null);
  const coups = coupsLegaux(e, 0, '7C');
  assert.equal(coups.length, 1); // seul coup : continuer sur le circuit
  assert.equal(apercuCoup(e, 0, coups[0]).pions[3], 5);
});

test('AMBIGUÏTÉ : le 7 ne peut servir au partenaire tant que ses propres pions ne sont pas rentrés', () => {
  // « Le reste des points peut servir à faire avancer un pion du partenaire. »
  // Ici le siège 0 n'a qu'un pion bloqué en a(2) (1 point utilisable) : 7 injouable,
  // alors qu'une lecture littérale permettrait 1 + 6 au partenaire.
  const e = etatTourne(0, { 0: a(2), 8: 40 });
  assert.equal(coupsLegaux(e, 0, '7C').length, 0);
  assert.notEqual(validerCoup(e, 0, { t: 'sept', carte: '7C', etapes: [{ pion: 0, pas: 1, allee: true }, { pion: 8, pas: 6 }] }), null);
});

test('valet : un de ses pions ; joueur fini : un pion du partenaire contre un adverse', () => {
  for (const s of SIEGES) {
    // un de ses pions contre un pion du partenaire : autorisé par le texte
    const e = etatTourne(s, { 0: 5, 8: 40, 4: 20 });
    assert.equal(legalT(s, e, 0, { t: 'echange', carte: 'VC', pion: 0, cible: 8 }), true);
    assert.equal(legalT(s, e, 0, { t: 'echange', carte: 'VC', pion: 8, cible: 4 }), false, 'aucun des siens');
    // joueur fini
    const f = etatTourne(s, { 0: a(0), 1: a(1), 2: a(2), 3: a(3), 8: 40, 9: 44, 4: 20 });
    const vs = coupsLegaux(f, S(s, 0), 'VC').map((c) => [c.pion, c.cible]);
    assert.deepEqual(vs.sort(), [[P(s, 8), P(s, 4)], [P(s, 9), P(s, 4)]].sort());
    // valet sans échange possible : injouable ; défausse seulement si rien n'est jouable
    const g = etatTourne(s, { 0: 5 });
    assert.equal(coupsLegaux(g, S(s, 0), 'VC').length, 0);
    assert.match(validerCoup(g, S(s, 0), { t: 'defausse', carte: 'VC' }, ['VC', '2C']), /Défausse interdite/);
    assert.equal(validerCoup(g, S(s, 0), { t: 'defausse', carte: 'VC' }, ['VC', '4C'].slice(0, 1).concat(['DC'])) === null, false);
  }
});

test('joueur fini : sort les pions du partenaire (as, roi), joue 4, 7, et ne déplace plus les siens', () => {
  for (const s of SIEGES) {
    const e = etatTourne(s, { 0: a(0), 1: a(1), 2: a(2), 3: a(3), 8: 40 });
    assert.equal(couleurActive(e, S(s, 0)), S(s, 2));
    assert.equal(posT(s, jouerT(s, e, 0, { t: 'sortie', carte: 'AC', pion: 9 }), 9), C(s, 32));
    assert.equal(legalT(s, e, 0, { t: 'sortie', carte: 'AC', pion: 0 }), false);
    assert.equal(posT(s, jouerT(s, e, 0, { t: 'recul', carte: '4C', pion: 8 }), 8), C(s, 36));
    assert.equal(posT(s, jouerT(s, e, 0, { t: 'avance', carte: '3C', pion: 8, pas: 3 }), 8), C(s, 43));
    assert.equal(coupsLegaux(e, S(s, 0), '7C').length, 1);
  }
});

test('AMBIGUÏTÉ : le joueur fini qui sort un pion du partenaire renvoie le pion protégé du partenaire', () => {
  // « Seule exception : son propriétaire qui sort un nouveau pion le renvoie à la base. »
  // Ici ce n'est pas le propriétaire qui sort, mais son partenaire qui a fini. Le moteur l'autorise.
  const e = etatTourne(0, { 0: a(0), 1: a(1), 2: a(2), 3: a(3), 8: 32 }, { frais: [8] });
  const n = appliquerCoup(e, 0, { t: 'sortie', carte: 'RC', pion: 9 });
  assert.equal(n.pions[8], BASE);
});

test('5 adverse : pion adverse seulement, sur le circuit, non protégé, jamais vers l’allée', () => {
  for (const s of SIEGES) {
    const opt = { reglages: { cinqAdverse: true } };
    const e = etatTourne(s, { 0: 5, 4: 12, 5: 16, 6: a(0), 8: 40, 7: 60 }, opt);
    const coups = coupsLegaux(e, S(s, 0), '5C').map((c) => c.pion).sort((x, y) => x - y);
    // pion 4 (12 → 17 : passe par-dessus le 5 protégé ? non : 16 est sur le chemin → interdit)
    assert.deepEqual(coups, [P(s, 0), P(s, 7)].sort((x, y) => x - y));
    // le pion adverse 7 (siège 1) poussé de 60 à 1 passe la case 0 : capture à l'arrivée seulement
    const n = jouerT(s, { ...e, pions: e.pions.map((x, q) => (q === P(s, 1) ? C(s, 1) : x)) }, 0, { t: 'avance', carte: '5C', pion: 7, pas: 5 });
    assert.equal(posT(s, n, 7), C(s, 1));
    assert.equal(posT(s, n, 1), BASE);
    // le joueur fini peut aussi pousser un adverse ; jamais un pion de son équipe
    const f = etatTourne(s, { 0: a(0), 1: a(1), 2: a(2), 3: a(3), 8: 40, 4: 20 }, opt);
    assert.deepEqual(coupsLegaux(f, S(s, 0), '5C').map((c) => c.pion).sort(), [P(s, 8), P(s, 4)].sort());
  }
});

test('obligation de jouer, défausse, 7 seule carte jouable', () => {
  for (const s of SIEGES) {
    const e = etatTourne(s, { 0: 30 });
    // 7 seule carte jouable et utilisable en entier : obligatoire
    assert.match(validerCoup(e, S(s, 0), { t: 'defausse', carte: 'VC' }, ['VC', '7C']), /Défausse interdite/);
    assert.deepEqual(coupsLegauxMain(e, S(s, 0), ['VC', '7C']).map((c) => c.t), ['sept']);
    // 7 non utilisable en entier (pion bloqué derrière un pion protégé) : défausse permise
    const f = etatTourne(s, { 0: 12, 4: 16 });
    assert.equal(mainJouable(f, S(s, 0), ['VC', '7C']), false);
    assert.equal(validerCoup(f, S(s, 0), { t: 'defausse', carte: '7C' }, ['VC', '7C']), null);
    // un 4 jouable même s'il désavantage : obligatoire
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
    geler(e);
    for (const r of RANGS) {
      const generes = coupsLegaux(e, siege, r + 'C');
      const plateauxGeneres = new Set();
      for (const c of generes) {
        const res = apercuCoup(e, siege, c);
        assert.ok(res, `coup généré refusé : ${JSON.stringify(c)} sur ${cle(e.pions)}`);
        assert.equal(validerCoup(e, siege, c), null);
        plateauxGeneres.add(cleCanonique(res.pions, res.frais));
      }
      const plateauxOracle = new Set();
      for (const c of CANDIDATS[r]) {
        const attendu = O.jouer(e, siege, c);
        const obtenu = apercuCoup(e, siege, c);
        compares++;
        if (!attendu || !obtenu) {
          assert.equal(!!obtenu, !!attendu, `verdict ${JSON.stringify(c)} siège ${siege} sur ${cle(e.pions)} frais ${cle(e.frais)} 5adv=${e.reglages.cinqAdverse}`);
          continue;
        }
        assert.deepEqual(obtenu.pions, attendu.pions, JSON.stringify(c));
        assert.deepEqual(obtenu.frais, attendu.frais, JSON.stringify(c));
        plateauxOracle.add(cleCanonique(attendu.pions, attendu.frais));
      }
      // tout plateau atteignable est proposé par coupsLegaux, et réciproquement
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
    // de temps en temps, un joueur fini (pour exercer le passage au partenaire)
    if (rng() < 0.25) for (let i = 0; i < 4; i++) e.pions[4 * siege + i] = ALLEE + i;
    if (rng() < 0.25) {
      // trois pions rentrés, le quatrième près de l'entrée : fin de joueur en cours de 7
      for (let i = 0; i < 3; i++) e.pions[4 * siege + i] = ALLEE + 3 - i;
      const cell = (16 * siege + 60 + Math.floor(rng() * 4)) % 64;
      if (!e.pions.includes(cell)) e.pions[4 * siege + 3] = cell;
      e.frais[4 * siege + 3] = false;
    }
    geler(e);
    const { finals, premieres } = O.explorerSept(e.pions, e.frais, siege);
    const generes = coupsLegaux(e, siege, '7C');
    const plateaux = new Set();
    for (const c of generes) {
      assert.equal(validerCoup(e, siege, c), null, JSON.stringify(c));
      const attendu = O.sept(e, siege, c.etapes);
      assert.ok(attendu, `7 généré refusé par l'oracle : ${JSON.stringify(c)}`);
      assert.deepEqual(apercuCoup(e, siege, c).pions, attendu.pions);
      plateaux.add(cle(attendu.pions));
    }
    assert.equal(plateaux.size, generes.length, 'plateaux finaux en double');
    assert.deepEqual([...plateaux].sort(), [...finals].sort(), `7 sur ${cle(e.pions)} siège ${siege}`);
    const aide = etapesSeptPossibles(e, siege);
    assert.deepEqual(aide.options.map((o) => `${o.pion}:${o.pas}:${o.allee}`).sort(), [...premieres].sort());
    // suivre une décomposition au hasard étape par étape : chaque option reste complétable
    let etapes = [];
    for (;;) {
      const ai = etapesSeptPossibles(e, siege, etapes);
      assert.ok(ai);
      if (ai.reste === 0 || ai.options.length === 0) {
        assert.equal(ai.reste === 0, etapes.length > 0 || finals.size === 0 ? ai.reste === 0 : false);
        break;
      }
      const o = ai.options[Math.floor(rng() * ai.options.length)];
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
      if (obtenu) assert.deepEqual(obtenu.pions, attendu.pions);
    }
  }
});

// ===========================================================================
// 3. Entrées mal formées, non-mutation
// ===========================================================================

test('entrées mal formées : rejet propre, sans exception ni mutation', () => {
  const e = geler(etatTourne(0, { 0: 5, 1: 62, 4: 20 }));
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
  // siège ou phase incorrects
  assert.equal(typeof validerCoup(e, 5, { t: 'avance', carte: '5C', pion: 0, pas: 5 }), 'string');
  assert.equal(typeof validerCoup(e, '0', { t: 'avance', carte: '5C', pion: 0, pas: 5 }), 'string');
  // etapesSeptPossibles : étapes illégales → null
  assert.equal(etapesSeptPossibles(e, 0, [{ pion: 0, pas: 8 }]), null);
  assert.equal(etapesSeptPossibles(e, 0, [{ pion: 4, pas: 1 }]), null);
  assert.equal(etapesSeptPossibles(e, 0, [null]), null);
});

test('BUG : etapesSeptPossibles lève une exception si `etapes` vaut null ou n’est pas un tableau', () => {
  // BUG : `for (const e of etapes)` sur null / un objet → TypeError « etapes is not iterable ».
  // Attendu : null (étapes illégales), comme pour toute autre entrée invalide.
  const e = etatTourne(0, { 0: 5 });
  for (const etapes of [null, {}, 42, 'ab']) {
    let r;
    assert.doesNotThrow(() => (r = etapesSeptPossibles(e, 0, etapes)), JSON.stringify(etapes));
    assert.equal(r, null, JSON.stringify(etapes));
  }
});

test('BUG : coupsLegaux / mainJouable / validerCoup(défausse) lèvent une exception sur une carte non chaîne', () => {
  // BUG : rang(carte) appelle carte.slice ; une main contenant autre chose qu'une chaîne fait
  // planter validerCoup sur une défausse (au lieu de renvoyer un message d'erreur).
  const e = etatTourne(0, { 0: 5 });
  assert.doesNotThrow(() => coupsLegaux(e, 0, null));
  assert.doesNotThrow(() => validerCoup(e, 0, { t: 'defausse', carte: 'AC' }, ['AC', null]));
});

test('BUG (mineur) : une carte qui n’existe pas est acceptée quand la main n’est pas fournie', () => {
  // BUG : seul le rang est lu (carte.slice(0, -1)) ; '5Z' ou '5' + n'importe quoi passe.
  // Sans main, la défausse d'une carte quelconque est aussi acceptée (documenté, mais
  // validerCoup ne vérifie alors même pas que la carte existe).
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

test('échange : un joueur ne peut pas donner deux fois ; siège invalide refusé', () => {
  const e = etatInitial();
  const n = marquerEchange(e, 0);
  assert.throws(() => marquerEchange(n, 0));
  // un siège hors bornes ne doit pas être accepté (sinon `echanges` est corrompu)
  assert.throws(() => marquerEchange(e, 7));
});
