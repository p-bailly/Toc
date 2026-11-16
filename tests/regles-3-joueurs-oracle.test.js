// Oracle indépendant du jeu à 3 joueurs, comparé au moteur sur des milliers de positions
// aléatoires (même esprit que tests/regles-revue.test.js). L'oracle est réécrit à partir des
// règles décidées par le propriétaire : circuit de 48 cases, entrée de l'allée 3 cases avant la
// case de sortie 16·s, chacun pour soi (pas de partenaire), 5 adverse sur n'importe quel autre
// joueur, joker = rang d'une carte posée pendant la donne en cours. Il avance case par case.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BASE, ALLEE, etatInitial, coupsLegaux, coupsLegauxMain, validerCoup, apercuCoup, etapesSeptPossibles,
  mainJouable, generateurAleatoire,
} from '../public/js/moteur/index.js';

const NC = 48; // cases
const NP = 12; // pions
const cle = (pions) => pions.join(',');

const O = {
  depart: (s) => 16 * s,
  entree: (s) => (16 * s + NC - 3) % NC,
  protege: (pions, q) => pions[q] === 16 * Math.floor(q / 4),
  occupant(pions, cell, sauf) {
    for (let q = 0; q < NP; q++) if (q !== sauf && pions[q] === cell) return q;
    return -1;
  },
  alleePrise: (pions, o, k) => [0, 1, 2, 3].some((i) => pions[4 * o + i] === ALLEE + k),

  avance(pions, g, pas, allee, sept) {
    const p = pions[g];
    const o = Math.floor(g / 4);
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
    let k = -1;
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
      pos = (pos + 1) % NC;
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
    if (!(p >= 0 && p < NC)) return null;
    let pos = p;
    let capture = -1;
    for (let i = 1; i <= 4; i++) {
      pos = (pos + NC - 1) % NC;
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

  /** Coup hors 7 et défausse, joué avec le rang r → pions ou null. Le siège joue ses pions. */
  jouer(etat, siege, coup, r) {
    const { pions } = etat;
    const estPion = (g) => Number.isInteger(g) && g >= 0 && g < NP;
    const libre = (q) => pions[q] >= 0 && pions[q] < NC && !O.protege(pions, q);
    const a = (g) => Math.floor(g / 4);
    switch (coup.t) {
      case 'sortie': {
        if (!['A', 'R'].includes(r) || !estPion(coup.pion) || a(coup.pion) !== siege || pions[coup.pion] !== BASE) return null;
        const np = pions.slice();
        const q = O.occupant(pions, O.depart(siege), -1);
        if (q >= 0) np[q] = BASE;
        np[coup.pion] = O.depart(siege);
        return np;
      }
      case 'avance': {
        const g = coup.pion;
        if (!estPion(g) || !O.pasCarte[r] || !O.pasCarte[r].includes(coup.pas)) return null;
        if (a(g) === siege) return O.avance(pions, g, coup.pas, !!coup.allee, false);
        // 5 adverse : n'importe quel autre joueur
        if (r === '5' && etat.reglages.cinqAdverse && !coup.allee && libre(g)) return O.avance(pions, g, 5, false, false);
        return null;
      }
      case 'recul':
        if (r !== '4' || !estPion(coup.pion) || a(coup.pion) !== siege) return null;
        return O.recul(pions, coup.pion);
      case 'echange': {
        const { pion: x, cible: y } = coup;
        if (r !== 'V' || !estPion(x) || !estPion(y) || a(x) !== siege || a(y) === siege) return null;
        if (!libre(x) || !libre(y)) return null;
        const np = pions.slice();
        [np[x], np[y]] = [pions[y], pions[x]];
        return np;
      }
      default:
        return null;
    }
  },

  sept(etat, siege, etapes) {
    let pions = etat.pions;
    let reste = 7;
    for (const e of etapes) {
      if (!Number.isInteger(e.pas) || e.pas < 1 || e.pas > reste) return null;
      if (Math.floor(e.pion / 4) !== siege) return null; // pas de partenaire à 3
      pions = O.avance(pions, e.pion, e.pas, !!e.allee, true);
      if (!pions) return null;
      reste -= e.pas;
    }
    return reste === 0 ? pions : null;
  },

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
      for (let g = 4 * siege; g < 4 * siege + 4; g++) {
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
    return finals;
  },

  /** Rangs copiables par un joker, recalculés naïvement. */
  copiables(etat) {
    const taille = [5, 4, 4, 5][etat.donne % 4];
    const posees = 3 * taille - etat.cartesRestantes.reduce((x, y) => x + y, 0);
    const cartes = posees > 0 ? etat.pile.slice(etat.pile.length - posees) : [];
    const rangs = new Set();
    for (const c of cartes) {
      if (c === 'J1' || c === 'J2') {
        if (etat.jokers[c]) rangs.add(etat.jokers[c]);
      } else rangs.add(c.slice(0, -1));
    }
    return rangs;
  },
};

/** Position aléatoire à 3 joueurs (jamais deux pions sur une même case). */
function positionAleatoire(rng) {
  const e = etatInitial({ nbJoueurs: 3, cinqAdverse: rng() < 0.5 });
  e.phase = 'jeu';
  e.echanges = [true, true, true];
  const prises = new Set();
  const chaudes = [];
  for (let s = 0; s < 3; s++) for (let d = -9; d <= 4; d++) chaudes.push((16 * s + d + NC) % NC);
  for (let g = 0; g < NP; g++) {
    const o = g >> 2;
    const t = rng();
    if (t < 0.25) continue;
    if (t < 0.45) {
      const k = Math.floor(rng() * 4);
      if (!e.pions.some((x, q) => q >> 2 === o && x === ALLEE + k)) e.pions[g] = ALLEE + k;
      continue;
    }
    const cell = rng() < 0.6 ? chaudes[Math.floor(rng() * chaudes.length)] : Math.floor(rng() * NC);
    if (prises.has(cell)) continue;
    prises.add(cell);
    e.pions[g] = cell;
  }
  return e;
}

const RANGS = ['A', '2', '3', '4', '5', '6', '8', '9', '10', 'V', 'D', 'R'];

function candidats(carte, comme) {
  const res = [];
  const avec = (c) => (comme ? { ...c, comme } : c);
  for (let g = 0; g < NP + 1; g++) {
    res.push(avec({ t: 'sortie', carte, pion: g }), avec({ t: 'recul', carte, pion: g }));
    for (let pas = 1; pas <= 13; pas++) {
      res.push(avec({ t: 'avance', carte, pion: g, pas, allee: false }), avec({ t: 'avance', carte, pion: g, pas, allee: true }));
    }
    for (let h = 0; h < NP + 1; h++) res.push(avec({ t: 'echange', carte, pion: g, cible: h }));
  }
  return res;
}
const CANDIDATS = Object.fromEntries(RANGS.map((r) => [r, candidats(r + 'C')]));

function cleCanonique(pions) {
  const parts = [];
  for (let s = 0; s < 3; s++) parts.push([0, 1, 2, 3].map((i) => pions[4 * s + i]).sort().join('.'));
  return parts.join('|');
}

test('oracle à 3 : chaque coup candidat (hors 7) a le même verdict et le même plateau', () => {
  const rng = generateurAleatoire(3003);
  let compares = 0;
  for (let n = 0; n < 200; n++) {
    const e = positionAleatoire(rng);
    const siege = Math.floor(rng() * 3);
    e.tour = siege;
    for (const r of RANGS) {
      const plateauxGeneres = new Set();
      for (const c of coupsLegaux(e, siege, r + 'C')) {
        const res = apercuCoup(e, siege, c);
        assert.ok(res, `coup généré refusé : ${JSON.stringify(c)}`);
        assert.equal(validerCoup(e, siege, c), null);
        plateauxGeneres.add(cleCanonique(res.pions));
      }
      const plateauxOracle = new Set();
      for (const c of CANDIDATS[r]) {
        const attendu = O.jouer(e, siege, c, r);
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

test('oracle à 3 : 7 — plateaux finaux, validation, décompositions aléatoires, etapesSeptPossibles', () => {
  const rng = generateurAleatoire(707);
  for (let n = 0; n < 300; n++) {
    const e = positionAleatoire(rng);
    const siege = Math.floor(rng() * 3);
    e.tour = siege;
    if (rng() < 0.3) {
      // trois pions rentrés, le quatrième près de l'entrée : la fin de joueur pendant un 7
      for (let i = 0; i < 3; i++) e.pions[4 * siege + i] = ALLEE + 3 - i;
      const cell = (16 * siege + 40 + Math.floor(rng() * 6)) % NC;
      e.pions[4 * siege + 3] = e.pions.includes(cell) ? BASE : cell;
    }
    const finals = O.explorerSept(e.pions, siege);
    const generes = coupsLegaux(e, siege, '7C');
    const vus = new Set();
    for (const c of generes) {
      assert.equal(validerCoup(e, siege, c), null, JSON.stringify(c));
      const attendu = O.sept(e, siege, c.etapes);
      assert.ok(attendu, `7 généré refusé par l'oracle : ${JSON.stringify(c)}`);
      assert.deepEqual(apercuCoup(e, siege, c).pions, attendu);
      vus.add(cle(attendu));
    }
    assert.equal(vus.size, generes.length, 'plateaux finaux en double');
    assert.deepEqual([...vus].sort(), [...finals].sort(), `7 sur ${cle(e.pions)} siège ${siege}`);
    // décompositions tirées au hasard, légales ou non
    for (let k = 0; k < 40; k++) {
      const etapes = [];
      let reste = 7;
      while (reste > 0) {
        const pas = 1 + Math.floor(rng() * reste);
        const g = rng() < 0.8 ? 4 * siege + Math.floor(rng() * 4) : Math.floor(rng() * NP);
        etapes.push({ pion: g, pas, allee: rng() < 0.4 });
        reste -= pas;
      }
      const attendu = O.sept(e, siege, etapes);
      const obtenu = apercuCoup(e, siege, { t: 'sept', carte: '7C', etapes });
      assert.equal(!!obtenu, !!attendu, JSON.stringify(etapes) + ' sur ' + cle(e.pions));
      if (obtenu) assert.deepEqual(obtenu.pions, attendu);
    }
    // saisie étape par étape : on peut toujours finir
    let etapes = [];
    for (;;) {
      const ai = etapesSeptPossibles(e, siege, etapes);
      assert.ok(ai);
      if (ai.reste === 0 || ai.options.length === 0) {
        if (finals.size > 0) assert.equal(ai.reste, 0, 'impasse proposée par etapesSeptPossibles');
        break;
      }
      const o = ai.options[Math.floor(rng() * ai.options.length)];
      etapes = etapes.concat([{ pion: o.pion, pas: o.pas, allee: o.allee }]);
    }
    if (finals.size > 0) assert.equal(validerCoup(e, siege, { t: 'sept', carte: '7C', etapes }), null);
  }
});

test('oracle à 3 : joker — coupsLegaux couvre exactement l’union des rangs copiables', () => {
  const rng = generateurAleatoire(54);
  const TOUS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'V', 'D', 'R'];
  let jokersJouables = 0;
  for (let n = 0; n < 150; n++) {
    const e = positionAleatoire(rng);
    const siege = Math.floor(rng() * 3);
    e.tour = siege;
    e.donne = Math.floor(rng() * 8);
    const taille = [5, 4, 4, 5][e.donne % 4];
    e.cartesRestantes = [taille, taille, taille];
    // quelques cartes d'une donne précédente (hors donne en cours), puis les cartes posées
    if (e.donne % 4 !== 0) for (let i = 0; i < 3; i++) e.pile.push(TOUS[Math.floor(rng() * 13)] + 'P');
    const nbPosees = Math.floor(rng() * Math.min(5, 3 * taille - 1));
    const jokers = {};
    for (let i = 0; i < nbPosees; i++) {
      const t = rng();
      let carte;
      if (t < 0.15 && !e.pile.includes('J1')) {
        carte = 'J1';
        if (rng() < 0.7) jokers.J1 = TOUS[Math.floor(rng() * 13)]; // joué (sinon défaussé)
      } else carte = TOUS[Math.floor(rng() * 13)] + 'C';
      e.pile.push(carte);
      e.cartesRestantes[(siege + 1 + i) % 3] -= 1;
    }
    e.jokers = jokers;
    const copiables = O.copiables(e);
    const coups = coupsLegaux(e, siege, 'J2');
    if (coups.length) jokersJouables++;
    // chaque coup généré : rang copiable, légal, même plateau que l'oracle
    const generes = new Set();
    for (const c of coups) {
      assert.ok(copiables.has(c.comme), JSON.stringify(c));
      assert.equal(validerCoup(e, siege, c), null);
      const res = apercuCoup(e, siege, c);
      const attendu = c.t === 'sept' ? O.sept(e, siege, c.etapes) : O.jouer(e, siege, c, c.comme);
      assert.deepEqual(res.pions, attendu);
      generes.add(c.comme + '#' + cleCanonique(res.pions));
    }
    // plateaux atteignables d'après l'oracle, rang par rang
    const attendus = new Set();
    for (const r of TOUS) {
      if (!copiables.has(r)) continue;
      if (r === '7') {
        for (const f of O.explorerSept(e.pions, siege)) attendus.add('7#' + cleCanonique(f.split(',').map(Number)));
        continue;
      }
      for (const c of candidats('J2', r)) {
        const p = O.jouer(e, siege, c, r);
        if (p) attendus.add(r + '#' + cleCanonique(p));
      }
    }
    assert.deepEqual([...generes].sort(), [...attendus].sort(), `joker sur ${cle(e.pions)} pile ${e.pile} jokers ${JSON.stringify(jokers)}`);
    // verdicts de candidats avec un `comme` quelconque
    for (const r of ['A', '5', '9', 'V', 'J', '4']) {
      for (const c of candidats('J2', r).filter(() => rng() < 0.05)) {
        const attendu = copiables.has(r) ? O.jouer(e, siege, c, r) : null;
        assert.equal(validerCoup(e, siege, c) === null, !!attendu, JSON.stringify(c));
      }
    }
    // jouabilité de la main : joker seul
    assert.equal(mainJouable(e, siege, ['J2']), coups.length > 0);
    if (!coups.length) assert.deepEqual(coupsLegauxMain(e, siege, ['J2']), [{ t: 'defausse', carte: 'J2' }]);
  }
  assert.ok(jokersJouables > 30, `trop peu de jokers jouables (${jokersJouables})`);
});
