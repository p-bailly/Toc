import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ALLEE, BASE, etatInitial, coupsLegaux, apercuCoup, validerCoup, nouvellePartie, donnerCarte, jouerCoup,
  generateurAleatoire, coupsLegauxMain, rangsCopiables, donneurDon,
} from '../public/js/moteur/index.js';
import { choisirCoup, choisirDon, conseillerCoup, conseillerDon, creerAnalyse, creerAnalyseDon } from '../public/js/ia/ia.js';
import { choisirCoup3, choisirDon3 } from '../public/js/ia/ia3.js';
import { coupsCarte, masqueCopiables } from '../public/js/ia/simulation.js';
import { aleatoire } from '../outils/joueurs.js';
import { jouerPartie } from '../outils/tournoi.js';

/** État à 3 joueurs en phase de jeu avec des pions placés : { numéroDePion: position }. */
function etat3(positions = {}, extra = {}) {
  const e = etatInitial({ nbJoueurs: 3, cinqAdverse: !!extra.cinq });
  e.phase = 'jeu';
  e.echanges = [true, true, true];
  for (const [g, pos] of Object.entries(positions)) e.pions[g] = pos;
  e.cartesRestantes = extra.restes || [3, 3, 3];
  if (extra.pile) e.pile = extra.pile;
  if (extra.tour !== undefined) e.tour = extra.tour;
  return e;
}
const a = (k) => ALLEE + k;
const OPTS = () => ({ budgetMs: 5000, iterations: 40, rng: generateurAleatoire(1) });
const RANGS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'V', 'D', 'R'];

test('à 3 : moteur rapide de l’IA = moteur de règles (coups, joker avec chaque rang copiable, plateaux)', () => {
  let n = 0;
  let jokers = 0;
  for (let graine = 1; graine <= 3; graine++) {
    const rng = generateurAleatoire(graine);
    let p = nouvellePartie({ nbJoueurs: 3, cinqAdverse: graine % 2 === 1 }, rng);
    while (p.etat.phase !== 'fini' && n < 6000) {
      if (p.etat.phase === 'echange') {
        for (let s = 0; s < 3; s++) p = donnerCarte(p, s, p.mains[s][0]);
        continue;
      }
      const s = p.etat.tour;
      const cop = masqueCopiables(rangsCopiables(p.etat));
      for (const carte of RANGS.map((r) => r + 'P').concat(['J1'])) {
        const cle = (pions, coup) => pions.join(',') + JSON.stringify(coup);
        const ref = coupsLegaux(p.etat, s, carte).map((c) => cle(apercuCoup(p.etat, s, c).pions, c)).sort();
        const ia = coupsCarte(p.etat.pions, s, carte, p.etat.reglages.cinqAdverse, [], Infinity, null, cop).map((c) => cle(c.pions, c.coup)).sort();
        assert.deepEqual(ia, ref);
        if (carte === 'J1') jokers += ref.length;
        n++;
      }
      const coups = coupsLegauxMain(p.etat, s, p.mains[s]);
      p = jouerCoup(p, s, coups[Math.floor(rng() * coups.length)], rng);
    }
  }
  assert.ok(n > 2000 && jokers > 500, `${n} comparaisons, ${jokers} coups de joker`);
});

test('à 3 : parties complètes IA contre IA, toujours légales (avec et sans 5 adverse)', () => {
  const ia = {
    don: (e, s, m, o) => choisirDon(e, s, m, o),
    coup: (e, s, m, o) => {
      const c = choisirCoup(e, s, m, { ...o, budgetMs: 2 });
      assert.equal(validerCoup(e, s, c, m), null);
      return c;
    },
  };
  for (const cinq of [false, true]) {
    const r = jouerPartie([ia, ia, ia], cinq ? 21 : 22, { cinqAdverse: cinq }, 2);
    assert.ok([0, 1, 2].includes(r.gagnant), 'la partie doit se terminer');
  }
});

test('à 3 : respect du budget de temps (5 ms et 60 ms)', () => {
  const rng = generateurAleatoire(5);
  let p = nouvellePartie({ nbJoueurs: 3 }, rng);
  const petits = [];
  const grands = [];
  let k = 0;
  while (p.etat.phase !== 'fini' && k < 90) {
    if (p.etat.phase === 'echange') {
      for (let s = 0; s < 3; s++) p = donnerCarte(p, s, choisirDon(p.etat, s, p.mains[s], { rng }));
      continue;
    }
    const s = p.etat.tour;
    const budget = k % 4 === 0 ? 60 : 5;
    const t0 = performance.now();
    const coup = choisirCoup(p.etat, s, p.mains[s], {
      rng, budgetMs: budget, carteDonnee: p.dons[s], carteRecue: p.dons[donneurDon(p.etat.donne, s, 3)],
    });
    const duree = performance.now() - t0;
    assert.ok(duree < budget + 50, `coup en ${duree.toFixed(1)} ms pour ${budget} ms`);
    (budget === 5 ? petits : grands).push(duree);
    p = jouerCoup(p, s, coup, rng);
    k++;
  }
  const mediane = (t) => t.sort((x, y) => x - y)[t.length >> 1];
  assert.ok(mediane(petits) <= 7, `médiane ${mediane(petits)} ms pour 5 ms`);
  assert.ok(mediane(grands) <= 65, `médiane ${mediane(grands)} ms pour 60 ms`);
});

test('à 3 : capturer de préférence le joueur en tête', () => {
  // Siège 1 (en tête) : trois pions rentrés, le dernier en 5 ; siège 2 : un seul pion sorti,
  // en 6. Mon pion en 0 : le 5 capture le joueur en tête, le 6 le dernier.
  const e = etat3({ 0: 0, 4: a(3), 5: a(2), 6: a(1), 7: 5, 8: 6 });
  const c = choisirCoup(e, 0, ['5P', '6C', '9T'], OPTS());
  assert.equal(c.carte, '5P');
  const conseils = conseillerCoup(e, 0, ['5P', '6C', '9T'], OPTS());
  assert.ok(conseils[0].raisons.some((r) => r.includes('joueur en tête')));
});

test('à 3 : rentrer un pion, sortir avec un as', () => {
  // Siège 0 : case d'entrée 45. Pion en 42 : un 6 l'amène au fond de l'allée.
  const e = etat3({ 0: 42, 1: 20, 5: 30 });
  const c = choisirCoup(e, 0, ['6P', '8C', '9T'], OPTS());
  assert.equal(c.carte, '6P');
  assert.equal(c.allee, true);
  const s = choisirCoup(etat3({}), 0, ['AP', '8C', '9T'], OPTS());
  assert.equal(s.t, 'sortie');
});

test('à 3 : le joker copie le bon rang', () => {
  // Rangs copiables : 3, 9, A, 2 (quatre cartes posées dans la donne). Dernier pion du joueur en
  // tête (siège 1, trois pions rentrés) en 39 ; mes pions en 30 et 21 (deux autres rentrés) :
  // seul le joker copié en 9 le capture.
  const e = etat3({ 0: 30, 1: 21, 2: a(2), 3: a(3), 4: 39, 5: a(1), 6: a(2), 7: a(3), 8: 2 }, { restes: [3, 4, 4], pile: ['3K', '9P', 'AC', '2T'] });
  assert.deepEqual(rangsCopiables(e), ['A', '2', '3', '9']);
  const c = choisirCoup(e, 0, ['J1', '2C', '3T'], { ...OPTS(), iterations: 300 });
  assert.equal(c.carte, 'J1');
  assert.equal(c.comme, '9');
  assert.equal(apercuCoup(e, 0, c).pions[4], BASE);
});

test('à 3 : le joker est gardé quand rien d’utile n’est copiable', () => {
  const e = etat3({ 0: 10, 8: 40 }, { restes: [3, 5, 5], pile: ['2P'] });
  assert.deepEqual(rangsCopiables(e), ['2']);
  const c = choisirCoup(e, 0, ['J1', '8C', '6T'], OPTS());
  assert.notEqual(c.carte, 'J1');
});

test('à 3 : don d’une carte inutile au voisin, jamais un joker ni un as dont on a besoin', () => {
  // Voisin de gauche (siège 1, donne 0) sans pion sorti : un as lui servirait.
  const e = etatInitial({ nbJoueurs: 3 });
  e.pions[0] = 20;
  e.pions[1] = 30;
  const don = choisirDon(e, 0, ['AP', '2C', '8T', '7K', 'J2']);
  assert.ok(!['AP', 'J2'].includes(don), `don : ${don}`);
  const conseils = conseillerDon(e, 0, ['AP', '2C', '8T', '7K', 'J2']);
  assert.equal(conseils[0].carte, don);
  assert.equal(conseils.length, 5);
  for (const c of conseils) for (const r of c.raisons) assert.ok(!r.includes('partenaire'), r);
  assert.ok(conseils.find((c) => c.carte === 'J2').raisons.some((r) => r.includes('voisin de gauche')));
  // la façade ia3 délègue à la même IA
  assert.equal(choisirDon3(e, 0, ['AP', '2C', '8T', '7K', 'J2']), don);
});

test('à 3 : conseils cohérents avec choisirCoup, légaux, sans partenaire', () => {
  const rng = generateurAleatoire(23);
  let p = nouvellePartie({ nbJoueurs: 3, cinqAdverse: true }, rng);
  let verifies = 0;
  while (p.etat.phase !== 'fini' && verifies < 20) {
    if (p.etat.phase === 'echange') {
      for (let s = 0; s < 3; s++) p = donnerCarte(p, s, choisirDon(p.etat, s, p.mains[s]));
      continue;
    }
    const s = p.etat.tour;
    const main = p.mains[s];
    if (p.etat.numCoup % 4 === 0) {
      const o = { carteDonnee: p.dons[s], carteRecue: p.dons[donneurDon(p.etat.donne, s, 3)] };
      const opts = () => ({ ...o, rng: generateurAleatoire(4), budgetMs: 5000, iterations: 20 });
      const conseils = conseillerCoup(p.etat, s, main, { ...opts(), max: 4 });
      assert.deepEqual(conseils[0].coup, choisirCoup(p.etat, s, main, opts()));
      assert.deepEqual(conseils[0].coup, choisirCoup3(p.etat, s, main, opts()));
      for (const c of conseils) {
        assert.equal(validerCoup(p.etat, s, c.coup, main), null);
        for (const r of c.raisons) assert.ok(!r.includes('partenaire'), r);
      }
      verifies++;
    }
    p = jouerCoup(p, s, choisirCoup(p.etat, s, main, { rng, budgetMs: 1 }), rng);
  }
});

test('à 3 : l’analyse converge, garde le coup joué, probabilité de victoire plausible', () => {
  const rng = generateurAleatoire(24);
  let p = nouvellePartie({ nbJoueurs: 3 }, rng);
  let k = 0;
  while (k < 30 || p.etat.phase !== 'jeu') {
    if (p.etat.phase === 'echange') {
      for (let s = 0; s < 3; s++) p = donnerCarte(p, s, choisirDon(p.etat, s, p.mains[s]));
      continue;
    }
    const s = p.etat.tour;
    p = jouerCoup(p, s, choisirCoup(p.etat, s, p.mains[s], { rng, budgetMs: 0 }), rng);
    k++;
  }
  const s = p.etat.tour;
  const coups = coupsLegauxMain(p.etat, s, p.mains[s]);
  const joue = coups[coups.length - 1];
  const an = creerAnalyse(p.etat, s, p.mains[s], { rng: generateurAleatoire(2), coupJoue: joue, carteDonnee: p.dons[s] });
  const r0 = an.avancer(0);
  assert.ok(r0.probaVictoire > 0 && r0.probaVictoire < 1);
  an.avancer(150);
  const r1 = an.resultat();
  while (an.resultat().iterations < 3 * r1.iterations + 30 && an.resultat().iterations < 3000) an.avancer(30);
  const r2 = an.resultat();
  assert.ok(r2.marge < r1.marge, `marges ${r1.marge} → ${r2.marge}`);
  assert.ok(r2.probaVictoire >= 0 && r2.probaVictoire <= 1);
  assert.equal(r2.candidats.filter((c) => c.joue).length, 1);
  for (const c of r2.candidats) assert.equal(validerCoup(p.etat, s, c.coup, p.mains[s]), null);
  // analyse du don à 3
  const e = etatInitial({ nbJoueurs: 3 });
  const ad = creerAnalyseDon(e, 1, ['AP', '2C', '8T', '7K', 'J2'], { rng: generateurAleatoire(3), carteJouee: 'AP', iterations: 20 });
  const rd = ad.avancer(100000);
  assert.equal(rd.iterations, 20);
  assert.ok(rd.candidats.some((c) => c.joue && c.carte === 'AP'));
});

test('à 3 : petite série contre deux joueurs aléatoires', () => {
  const ia = {
    don: (e, s, m, o) => choisirDon(e, s, m, o),
    coup: (e, s, m, o) => choisirCoup(e, s, m, { ...o, budgetMs: 2 }),
  };
  let victoires = 0;
  for (let i = 0; i < 6; i++) {
    const siegeIA = i % 3;
    const joueurs = [0, 1, 2].map((s) => (s === siegeIA ? ia : aleatoire));
    const r = jouerPartie(joueurs, 300 + i, { cinqAdverse: i >= 3 }, 2);
    if (r.gagnant === siegeIA) victoires++;
  }
  assert.ok(victoires >= 5, `${victoires}/6 victoires`);
});
