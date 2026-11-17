import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BASE, ALLEE, etatInitial, appliquerCoup, coupsLegaux, apercuCoup, validerCoup, nouvellePartie, donnerCarte, jouerCoup,
  generateurAleatoire, partenaire, coupsLegauxMain,
} from '../public/js/moteur/index.js';
import { choisirCoup, choisirDon, conseillerCoup, conseillerDon, creerAnalyse, creerAnalyseDon } from '../public/js/ia/ia.js';
import { coupsCarte } from '../public/js/ia/simulation.js';
import { aleatoire } from '../outils/joueurs.js';
import { jouerPartie } from '../outils/tournoi.js';
import { chronometrer } from './duree-calcul.js';

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
  const petits = [];
  const grands = [];
  while (p.etat.phase !== 'fini' && mesures < 120) {
    if (p.etat.phase === 'echange') {
      for (let s = 0; s < 4; s++) p = donnerCarte(p, s, choisirDon(p.etat, s, p.mains[s], { rng }));
      continue;
    }
    const s = p.etat.tour;
    const budget = mesures % 4 === 0 ? 60 : 5;
    // durée hors attentes dues à la charge de la machine (voir duree-calcul.js)
    const { resultat: coup, duree } = chronometrer(() =>
      choisirCoup(p.etat, s, p.mains[s], { rng, budgetMs: budget, carteDonnee: p.dons[s], carteRecue: p.dons[partenaire(s)] }));
    // marge large par coup : les premiers coups sont plus lents (code pas encore compilé)
    assert.ok(duree < budget + 50, `coup en ${duree.toFixed(1)} ms pour un budget de ${budget} ms`);
    (budget === 5 ? petits : grands).push(duree);
    p = jouerCoup(p, s, coup, rng);
    mesures++;
  }
  const mediane = (t) => t.sort((x, y) => x - y)[t.length >> 1];
  assert.ok(mediane(petits) <= 5 + 4, `médiane ${mediane(petits)} ms pour 5 ms`);
  assert.ok(mediane(grands) <= 60 + 10, `médiane ${mediane(grands)} ms pour 60 ms`);
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

test('tactique : le 7 capture par dépassement', () => {
  // Pion 0 en 57, pion adverse 4 en 58 : tout 7 qui fait avancer le pion 0 passe sur
  // l'adversaire et le renvoie à la base (le 2 et le 3 ne le capturent pas).
  const e = etat({ 0: 57, 1: 20, 4: 58 }, { restes: [3, 3, 3, 3] });
  const c = choisirCoup(e, 0, ['7P', '2C', '3T'], { ...OPTS });
  assert.equal(c.t, 'sept');
  const ap = apercuCoup(e, 0, c);
  assert.equal(ap.pions[4], BASE);
});

test('tactique : le 7 qui fait gagner la partie est joué', () => {
  // Partenaire (siège 2) rentré ; siège 0 : trois pions rentrés (cases 0 à 2 de l'allée), le
  // dernier 3 cases avant l'entrée (61) : 3 + 4 = 7 le met au fond de l'allée et gagne.
  const e = etat({ 0: a(0), 1: a(1), 2: a(2), 3: 58, 8: a(0), 9: a(1), 10: a(2), 11: a(3), 4: 40 }, { restes: [3, 3, 3, 3] });
  const main = ['9C', '7P', '2T'];
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
    iterations: 300, // l'écart avec le 10 est faible depuis que le valet peut échanger un pion sur sa case de départ
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

// ---------------------------------------------------------------------------
// Analyse incrémentale
// ---------------------------------------------------------------------------

function positionDePartie(graine, coups) {
  const rng = generateurAleatoire(graine);
  let p = nouvellePartie({}, rng);
  let k = 0;
  while (k < coups || p.etat.phase !== 'jeu') {
    if (p.etat.phase === 'echange') {
      for (let s = 0; s < 4; s++) p = donnerCarte(p, s, choisirDon(p.etat, s, p.mains[s]));
      continue;
    }
    const s = p.etat.tour;
    p = jouerCoup(p, s, choisirCoup(p.etat, s, p.mains[s], { rng, budgetMs: 0 }), rng);
    k++;
  }
  return p;
}

test('analyse : utilisable dès avancer(0), la marge décroît et l’évaluation converge', () => {
  const p = positionDePartie(31, 40);
  const s = p.etat.tour;
  const a = creerAnalyse(p.etat, s, p.mains[s], { rng: generateurAleatoire(2), carteDonnee: p.dons[s] });
  const r0 = a.avancer(0);
  assert.equal(r0.iterations, 0);
  assert.ok(r0.candidats.length >= 1);
  assert.ok(r0.probaVictoire >= 0 && r0.probaVictoire <= 1);
  // Trois analyses de la même position, arrêtées à 10, 80 et 300 simulations : le résultat ne dépend pas de la
  // vitesse de la machine (une seule analyse découpée en tranches de temps sautait des paliers sur une machine rapide).
  const marges = [];
  const evals = [];
  for (const n of [10, 80, 300]) {
    const an = creerAnalyse(p.etat, s, p.mains[s], { rng: generateurAleatoire(2), carteDonnee: p.dons[s], iterations: n });
    let avant = -1;
    while (an.resultat().iterations < n && an.resultat().iterations !== avant) {
      avant = an.resultat().iterations;
      an.avancer(2000);
    }
    const r = an.resultat();
    marges.push(r.marge);
    evals.push(r.evaluation);
    for (const c of r.candidats) assert.equal(validerCoup(p.etat, s, c.coup, p.mains[s]), null);
  }
  assert.ok(marges[2] < marges[0], `marges ${marges}`);
  assert.ok(Math.abs(evals[2] - evals[1]) <= 3 * marges[1] + 1, `évaluations ${evals}, marges ${marges}`);
});

test('analyse : petites tranches = une grande tranche (à itérations égales), reproductible', () => {
  const p = positionDePartie(32, 25);
  const s = p.etat.tour;
  const opts = () => ({ rng: generateurAleatoire(5), carteDonnee: p.dons[s], iterations: 30 });
  const a = creerAnalyse(p.etat, s, p.mains[s], opts());
  let tours = 0;
  while (a.resultat().iterations < 30 && tours++ < 100000) a.avancer(0.3);
  const b = creerAnalyse(p.etat, s, p.mains[s], opts());
  b.avancer(100000);
  assert.deepEqual(a.resultat(), b.resultat());
  assert.equal(b.resultat().stable, true); // plafond d'itérations atteint
});

test('analyse : le coup joué est toujours présent, même mauvais', () => {
  const e = etat({ 0: 20, 1: 30, 2: 40, 4: 25 }, { restes: [3, 3, 3, 3] });
  const main = ['5P', '8C', '9T'];
  const tous = creerAnalyse(e, 0, main, { rng: generateurAleatoire(1), max: 30 }).avancer(0).candidats;
  const pire = tous[tous.length - 1].coup;
  const a = creerAnalyse(e, 0, main, { rng: generateurAleatoire(1), coupJoue: pire, max: 2, iterations: 60 });
  for (const budget of [0, 50, 5000]) {
    const r = a.avancer(budget);
    const j = r.candidats.filter((c) => c.joue);
    assert.equal(j.length, 1);
    assert.deepEqual(j[0].coup, pire);
    assert.ok(j[0].ecart > 0);
  }
  // le coup joué continue d'être simulé
  assert.equal(a.joue.n, a.iterations);
});

test('analyse du don : candidats, carte jouée, convergence', () => {
  const p = positionDePartie(33, 30);
  // on se place au début de la donne suivante (phase d'échange)
  let q = p;
  const rng = generateurAleatoire(8);
  while (q.etat.phase !== 'echange') {
    const s = q.etat.tour;
    q = jouerCoup(q, s, choisirCoup(q.etat, s, q.mains[s], { rng, budgetMs: 0 }), rng);
  }
  const s = 1;
  const main = q.mains[s];
  const derniere = main[main.length - 1];
  const a = creerAnalyseDon(q.etat, s, main, { rng: generateurAleatoire(3), carteJouee: derniere, iterations: 40 });
  const r0 = a.avancer(0);
  assert.equal(r0.candidats[0].carte, choisirDon(q.etat, s, main));
  assert.ok(r0.candidats.some((c) => c.joue && c.carte === derniere));
  const r = a.avancer(100000);
  assert.equal(r.iterations, 40);
  assert.ok(r.marge < 25);
  assert.ok(r.candidats.some((c) => c.joue && c.carte === derniere));
  for (const c of r.candidats) assert.ok(main.includes(c.carte) && c.raisons.length >= 1);
});

test('analyse : evaluation, note, écart et marge en cases (ordres de grandeur bornés)', () => {
  // Pion seul sur le circuit, aucun adversaire à portée : avancer de 8, 9 ou 10 ne diffère que
  // de quelques cases.
  const e = etat({ 0: 20, 8: 40 }, { restes: [3, 3, 3, 3] });
  for (const budget of [0, 200]) {
    const r = creerAnalyse(e, 0, ['8P', '9C', '10T'], { rng: generateurAleatoire(1), iterations: 60 }).avancer(budget);
    assert.equal(r.candidats.length, 3);
    for (const c of r.candidats) assert.ok(c.ecart <= 15, `écart ${c.ecart} (budget ${budget})`);
    assert.ok(Math.abs(r.evaluation) < 300);
  }
  // Sur une partie, avec une victoire possible ou non : valeurs lisibles.
  const p = positionDePartie(34, 120);
  const s = p.etat.tour;
  const r = creerAnalyse(p.etat, s, p.mains[s], { rng: generateurAleatoire(1), max: 30, iterations: 20 }).avancer(10000);
  assert.ok(Math.abs(r.evaluation) < 1200);
  for (const c of r.candidats) assert.ok(c.ecart >= 0 && c.ecart < 600 && c.marge < 200);
  // Victoire immédiate : note bornée (plateau final + bonus), pas ±100000.
  const v = etat({ 0: a(0), 1: a(1), 2: a(2), 3: 58, 8: a(0), 9: a(1), 10: a(2), 11: a(3), 4: 40 }, { restes: [3, 3, 3, 3] });
  const rv = creerAnalyse(v, 0, ['9C', '7P', '2T'], { rng: generateurAleatoire(1), iterations: 10 }).avancer(10000);
  assert.equal(rv.probaVictoire, 1);
  assert.ok(rv.evaluation > 0 && rv.evaluation < 1200);
  for (const c of rv.candidats) assert.ok(c.ecart < 600);
});
