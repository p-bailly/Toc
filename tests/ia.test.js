import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BASE, ALLEE, etatInitial, appliquerCoup, coupsLegaux, apercuCoup, validerCoup, nouvellePartie, donnerCarte, jouerCoup,
  generateurAleatoire, partenaire, coupsLegauxMain,
} from '../public/js/moteur/index.js';
import { choisirCoup, choisirDon, conseillerCoup, conseillerDon } from '../public/js/ia/ia.js';
import { coupsCarte } from '../public/js/ia/simulation.js';
import { aleatoire } from '../outils/joueurs.js';
import { jouerPartie } from '../outils/tournoi.js';

/** État en phase de jeu avec des pions placés : { numéroDePion: position }. */
function etat(positions = {}, extra = {}) {
  const e = etatInitial(extra.reglages);
  e.phase = 'jeu';
  e.echanges = [true, true, true, true];
  for (const [g, pos] of Object.entries(positions)) e.pions[g] = pos;
  if (extra.tour !== undefined) e.tour = extra.tour;
  if (extra.restes) e.cartesRestantes = extra.restes;
  if (extra.pile) e.pile = extra.pile;
  return e;
}
const a = (k) => ALLEE + k;
const RANGS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'V', 'D', 'R'];

test('moteur rapide de l’IA : mêmes coups (mêmes plateaux) que le moteur de règles', () => {
  let n = 0;
  for (let graine = 1; graine <= 3; graine++) {
    const rng = generateurAleatoire(graine);
    let p = nouvellePartie({ cinqAdverse: graine % 2 === 1 }, rng);
    while (p.etat.phase !== 'fini' && n < 6000) {
      if (p.etat.phase === 'echange') {
        for (let s = 0; s < 4; s++) p = donnerCarte(p, s, p.mains[s][0]);
        continue;
      }
      const s = p.etat.tour;
      for (const r of RANGS) {
        const carte = r + 'P';
        const cle = (pions, coup) => pions.join(',') + JSON.stringify(coup);
        const ref = coupsLegaux(p.etat, s, carte).map((c) => cle(apercuCoup(p.etat, s, c).pions, c)).sort();
        const ia = coupsCarte(p.etat.pions, s, carte, p.etat.reglages.cinqAdverse).map((c) => cle(c.pions, c.coup)).sort();
        assert.deepEqual(ia, ref);
        n++;
      }
      const coups = coupsLegauxMain(p.etat, s, p.mains[s]);
      p = jouerCoup(p, s, coups[Math.floor(rng() * coups.length)], rng);
    }
  }
  assert.ok(n > 3000);
});

test('parties complètes IA contre IA : toujours des coups légaux (avec et sans 5 adverse)', () => {
  const ia = {
    don: (e, s, m, o) => choisirDon(e, s, m, o),
    coup: (e, s, m, o) => {
      const c = choisirCoup(e, s, m, { ...o, budgetMs: 2 });
      assert.equal(validerCoup(e, s, c, m), null);
      return c;
    },
  };
  for (const cinq of [false, true]) {
    const r = jouerPartie([ia, ia, ia, ia], cinq ? 11 : 12, { cinqAdverse: cinq }, 2);
    assert.ok(r.gagnant === 0 || r.gagnant === 1, 'la partie doit se terminer');
  }
});

test('respect du budget de temps (5 ms et 60 ms)', () => {
  const rng = generateurAleatoire(3);
  let p = nouvellePartie({}, rng);
  let mesures = 0;
  while (p.etat.phase !== 'fini' && mesures < 120) {
    if (p.etat.phase === 'echange') {
      for (let s = 0; s < 4; s++) p = donnerCarte(p, s, choisirDon(p.etat, s, p.mains[s], { rng }));
      continue;
    }
    const s = p.etat.tour;
    const budget = mesures % 4 === 0 ? 60 : 5;
    const t0 = performance.now();
    const coup = choisirCoup(p.etat, s, p.mains[s], { rng, budgetMs: budget, carteDonnee: p.dons[s], carteRecue: p.dons[partenaire(s)] });
    const duree = performance.now() - t0;
    assert.ok(duree < budget + 15, `coup en ${duree.toFixed(1)} ms pour un budget de ${budget} ms`);
    p = jouerCoup(p, s, coup, rng);
    mesures++;
  }
});

test('reproductible avec un rng et un nombre d’itérations fixés', () => {
  const e = etat({ 0: 30, 1: 5, 4: 25, 5: 40, 8: 50, 12: 10 }, { restes: [5, 5, 5, 5] });
  const main = ['7P', '4C', 'AK', '9T', 'VP'];
  const opts = (g) => ({ rng: generateurAleatoire(g), budgetMs: 10000, iterations: 30 });
  const c1 = choisirCoup(e, 0, main, opts(9));
  const c2 = choisirCoup(e, 0, main, opts(9));
  assert.deepEqual(c1, c2);
});

// Nombre d'itérations fixé (et budget large) : résultats indépendants de la vitesse de la machine.
const OPTS = { budgetMs: 5000, iterations: 60, rng: generateurAleatoire(1) };

test('tactique : capturer un pion adverse quand c’est gratuit', () => {
  // Pion 0 en 20, pion adverse 4 en 25 ; un 5 le capture.
  const e = etat({ 0: 20, 4: 25 }, { restes: [3, 3, 3, 3] });
  const c = choisirCoup(e, 0, ['5P', '8C', '9T'], { ...OPTS });
  assert.equal(c.t, 'avance');
  assert.equal(c.carte, '5P');
  assert.equal(c.pion, 0);
});

test('tactique : rentrer un pion dans l’allée quand c’est possible', () => {
  // Siège 0 : case d'entrée 61. Pion en 58 (3 cases avant), un 6 l'amène au fond de l'allée.
  const e = etat({ 0: 58, 1: 30, 5: 50 }, { restes: [3, 3, 3, 3] });
  const c = choisirCoup(e, 0, ['6P', '8C', '9T'], { ...OPTS });
  assert.equal(c.carte, '6P');
  assert.equal(c.pion, 0);
  assert.equal(c.allee, true);
});

test('tactique : sortir avec un as quand aucun pion n’est sorti', () => {
  const e = etat({}, { restes: [3, 3, 3, 3] });
  const c = choisirCoup(e, 0, ['AP', '8C', '9T'], { ...OPTS });
  assert.equal(c.t, 'sortie');
});

test('tactique : manœuvre du 4 (pion sur sa case de départ, recul vers l’allée)', () => {
  const e = etat({ 0: 0 }, { restes: [3, 3, 3, 3] });
  const c = choisirCoup(e, 0, ['4P', '9C', '10T'], { ...OPTS });
  assert.equal(c.t, 'recul');
  assert.equal(c.pion, 0);
});

test('tactique : le 7 capture par dépassement et rentre un pion', () => {
  // Pion 0 en 57 (4 cases avant l'entrée 61), pion adverse 4 en 58 : 7 = 4 + 3 rentre
  // en passant sur l'adversaire, qui est renvoyé à la base (le 2 et le 3 ne le capturent pas).
  const e = etat({ 0: 57, 1: 20, 4: 58 }, { restes: [3, 3, 3, 3] });
  const c = choisirCoup(e, 0, ['7P', '2C', '3T'], { ...OPTS });
  assert.equal(c.t, 'sept');
  const ap = apercuCoup(e, 0, c);
  assert.equal(ap.pions[4], BASE);
  assert.ok(ap.pions[0] >= ALLEE);
});

test('tactique : le 7 qui fait gagner la partie est joué, même avec des points restants', () => {
  // Partenaire (siège 2) rentré ; siège 0 : trois pions rentrés, le dernier 2 cases avant
  // l'entrée (61) : 2 + 1 le rentre et gagne, il reste 4 points.
  const e = etat({ 0: a(3), 1: a(2), 2: a(1), 3: 59, 8: a(0), 9: a(1), 10: a(2), 11: a(3), 4: 40 }, { restes: [3, 3, 3, 3] });
  const main = ['7P', '9C', '2T'];
  const c = choisirCoup(e, 0, main, { ...OPTS });
  const n = appliquerCoup(e, 0, c, main);
  assert.equal(n.phase, 'fini');
  assert.equal(n.gagnant, 0);
});

test('tactique : défausse forcée, on garde l’as', () => {
  // Trois pions rentrés (cases 1 à 3 de l'allée), le dernier en 15 bloqué par le pion
  // adverse protégé sur sa case de départ (16) : rien n'est jouable.
  const e = etat({ 0: a(3), 1: a(2), 2: a(1), 3: 15, 4: 16 }, { restes: [3, 3, 3, 3] });
  const main = ['AP', '9C', 'DT'];
  assert.equal(coupsLegauxMain(e, 0, main)[0].t, 'defausse');
  const c = choisirCoup(e, 0, main, { ...OPTS });
  assert.equal(c.t, 'defausse');
  assert.notEqual(c.carte, 'AP');
});

test('tactique : un joueur qui a fini joue pour son partenaire', () => {
  const e = etat({ 0: a(0), 1: a(1), 2: a(2), 3: a(3), 8: 45 }, { restes: [3, 3, 3, 3] });
  const c = choisirCoup(e, 0, ['AP', '9C', '10T'], { ...OPTS });
  assert.equal(validerCoup(e, 0, c, ['AP', '9C', '10T']), null);
  assert.ok(c.t === 'sortie' || c.pion >= 8, 'le coup concerne les pions du partenaire');
});

test('don : un as ou un roi au partenaire qui n’a aucun pion sorti, si l’on en a deux', () => {
  const e = etatInitial();
  const don = choisirDon(e, 0, ['AP', 'RC', '5T', '8K', '9P'], { rng: generateurAleatoire(1) });
  assert.ok(['AP', 'RC'].includes(don));
  // avec un seul as et tous ses pions en base, on le garde
  const don2 = choisirDon(e, 0, ['AP', '3C', '5T', '8K', '9P'], { rng: generateurAleatoire(1) });
  assert.notEqual(don2, 'AP');
});

test('petite série contre l’aléatoire : l’IA gagne largement', () => {
  const ia = {
    don: (e, s, m, o) => choisirDon(e, s, m, o),
    coup: (e, s, m, o) => choisirCoup(e, s, m, { ...o, budgetMs: 2 }),
  };
  let victoires = 0;
  const n = 6;
  for (let i = 0; i < n; i++) {
    const iaPair = i % 2 === 0;
    const joueurs = iaPair ? [ia, aleatoire, ia, aleatoire] : [aleatoire, ia, aleatoire, ia];
    const r = jouerPartie(joueurs, 100 + i, { cinqAdverse: i % 4 >= 2 }, 2);
    if (r.gagnant === (iaPair ? 0 : 1)) victoires++;
  }
  assert.ok(victoires >= n - 1, `${victoires}/${n} victoires`);
});

// ---------------------------------------------------------------------------
// Conseils
// ---------------------------------------------------------------------------

const optsFixes = () => ({ rng: generateurAleatoire(4), budgetMs: 5000, iterations: 25 });

test('conseils : le premier conseil est le coup de choisirCoup, tous les coups conseillés sont légaux', () => {
  const rng = generateurAleatoire(21);
  let p = nouvellePartie({ cinqAdverse: true }, rng);
  let verifies = 0;
  while (p.etat.phase !== 'fini' && verifies < 25) {
    if (p.etat.phase === 'echange') {
      for (let s = 0; s < 4; s++) p = donnerCarte(p, s, choisirDon(p.etat, s, p.mains[s]));
      continue;
    }
    const s = p.etat.tour;
    const main = p.mains[s];
    if (p.etat.numCoup % 5 === 0) {
      const o = { carteDonnee: p.dons[s], carteRecue: p.dons[partenaire(s)] };
      const conseils = conseillerCoup(p.etat, s, main, { ...optsFixes(), ...o, max: 4 });
      const coup = choisirCoup(p.etat, s, main, { ...optsFixes(), ...o });
      assert.deepEqual(conseils[0].coup, coup);
      assert.equal(conseils[0].ecart, 0);
      const plateaux = new Set();
      for (const c of conseils) {
        assert.equal(validerCoup(p.etat, s, c.coup, main), null);
        assert.ok(c.raisons.length >= 1 && c.raisons.length <= 3);
        assert.ok(c.ecart >= 0);
        if (c.coup.t !== 'defausse') plateaux.add(apercuCoup(p.etat, s, c.coup).pions.join(','));
      }
      assert.equal(plateaux.size, conseils.filter((c) => c.coup.t !== 'defausse').length);
      verifies++;
    }
    p = jouerCoup(p, s, choisirCoup(p.etat, s, main, { rng, budgetMs: 1 }), rng);
  }
});

test('conseils : raisons justes sur des positions évidentes', () => {
  const capture = conseillerCoup(etat({ 0: 20, 4: 25 }, { restes: [3, 3, 3, 3] }), 0, ['5P', '8C', '9T'], optsFixes());
  assert.equal(capture[0].coup.carte, '5P');
  assert.ok(capture[0].raisons.some((r) => r.includes('capture un pion adverse')));
  assert.ok(capture.slice(1).every((c) => !c.raisons.some((r) => r.includes('capture'))));

  const entree = conseillerCoup(etat({ 0: 58, 1: 30, 5: 50 }, { restes: [3, 3, 3, 3] }), 0, ['6P', '8C', '9T'], optsFixes());
  assert.ok(entree[0].raisons.some((r) => r.startsWith("rentre ton pion dans l'allée")));

  const sortie = conseillerCoup(etat({}, { restes: [3, 3, 3, 3] }), 0, ['AP', '8C', '9T'], optsFixes());
  assert.ok(sortie[0].raisons.includes('sort un pion'));

  const recul = conseillerCoup(etat({ 0: 0, 5: 40 }, { restes: [3, 3, 3, 3] }), 0, ['4P', '9C', '10T'], {
    ...optsFixes(),
    coupJoue: { t: 'avance', carte: '10T', pion: 0, pas: 10, allee: false },
  });
  assert.equal(recul[0].coup.t, 'recul');
  assert.ok(recul[0].raisons.some((r) => r.includes("juste avant l'entrée de l'allée")));
  const joue = recul.filter((c) => c.joue);
  assert.equal(joue.length, 1);
  assert.equal(joue[0].coup.carte, '10T');
  assert.ok(joue[0].ecart > 0);

  // coup joué hors des meilleurs : entrée ajoutée en plus
  const e = etat({ 0: 20, 1: 30, 2: 40, 4: 25 }, { restes: [3, 3, 3, 3] });
  const main = ['5P', '8C', '9T'];
  const tous = conseillerCoup(e, 0, main, { ...optsFixes(), max: 20 });
  const pire = tous[tous.length - 1];
  const res = conseillerCoup(e, 0, main, { ...optsFixes(), max: 1, coupJoue: pire.coup });
  assert.equal(res.length, 2);
  assert.equal(res[1].joue, true);
  assert.deepEqual(res[1].coup, pire.coup);
});

test('conseils de don : un rang par entrée, cohérent avec choisirDon', () => {
  const e = etatInitial();
  const main = ['AP', 'AC', '5T', '8K', '9P'];
  const conseils = conseillerDon(e, 0, main);
  assert.equal(conseils.length, 4);
  assert.equal(conseils[0].carte, choisirDon(e, 0, main));
  assert.equal(conseils[0].ecart, 0);
  for (let i = 1; i < conseils.length; i++) assert.ok(conseils[i].ecart >= conseils[i - 1].ecart);
  assert.ok(conseils[0].raisons.some((r) => r.includes("ton partenaire n'a aucun pion sorti")));
  for (const c of conseils) assert.ok(c.raisons.length >= 1 && c.raisons.length <= 3);
});
