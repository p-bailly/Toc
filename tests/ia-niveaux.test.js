import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ALLEE, etatInitial, validerCoup, appliquerCoup, nouvellePartie, donnerCarte, jouerCoup, generateurAleatoire,
} from '../public/js/moteur/index.js';
import { choisirCoup, choisirDon, NIVEAUX, NIVEAU_DEFAUT } from '../public/js/ia/ia.js';
import { choisirCoup3, choisirDon3 } from '../public/js/ia/ia3.js';
import { jouerPartie } from '../outils/tournoi.js';

const IDS = ['debutant', 'amateur', 'confirme', 'expert', 'champion'];
const a = (k) => ALLEE + k;

/**
 * Joueur de tournoi au niveau donné (budget court pour le champion). Avec `iterations`, la recherche
 * est bornée par ce nombre de simulations : à budget large, le coup ne dépend plus de la vitesse de la machine.
 */
const joueur = (niveau, budget = 3, iterations) => ({
  don: (e, s, m, o) => choisirDon(e, s, m, { ...o, niveau }),
  coup: (e, s, m, o) => {
    const c = choisirCoup(e, s, m, { ...o, budgetMs: budget, iterations, niveau });
    assert.equal(validerCoup(e, s, c, m), null, `coup illégal au niveau ${niveau}`);
    return c;
  },
});

function etat(positions, extra = {}) {
  const e = etatInitial(extra.reglages);
  e.phase = 'jeu';
  e.echanges = e.echanges.map(() => true);
  for (const [g, pos] of Object.entries(positions)) e.pions[g] = pos;
  e.cartesRestantes = e.cartesRestantes.map(() => 3);
  return e;
}

test('niveaux : contrat (cinq niveaux ordonnés, champion par défaut)', () => {
  assert.deepEqual(NIVEAUX.map((n) => n.id), IDS);
  assert.deepEqual(NIVEAUX.map((n) => n.nom), ['Débutant', 'Amateur', 'Confirmé', 'Expert', 'Champion']);
  for (const n of NIVEAUX) assert.ok(typeof n.description === 'string' && n.description.length > 20);
  assert.equal(NIVEAU_DEFAUT, 'champion');
});

test('niveaux : chaque niveau joue des coups légaux sur des parties complètes, à 4 et à 3', () => {
  for (const niveau of IDS) {
    const r4 = jouerPartie([0, 1, 2, 3].map(() => joueur(niveau)), 40 + IDS.indexOf(niveau), { cinqAdverse: true }, 3);
    assert.ok(r4.gagnant === 0 || r4.gagnant === 1);
    const j = joueur(niveau);
    const j3 = {
      don: (e, s, m, o) => choisirDon3(e, s, m, { ...o, niveau }),
      coup: (e, s, m, o) => {
        const c = choisirCoup3(e, s, m, { ...o, budgetMs: 3, niveau });
        assert.equal(validerCoup(e, s, c, m), null);
        return c;
      },
    };
    const r3 = jouerPartie([j, j3, j], 50 + IDS.indexOf(niveau), { cinqAdverse: false }, 3);
    assert.ok([0, 1, 2].includes(r3.gagnant));
  }
});

test('niveaux : niveau absent ou inconnu = champion, à l’identique', () => {
  const rng = generateurAleatoire(7);
  let p = nouvellePartie({}, rng);
  let k = 0;
  while (k < 40) {
    if (p.etat.phase === 'echange') {
      for (let s = 0; s < 4; s++) {
        const d = choisirDon(p.etat, s, p.mains[s]);
        assert.equal(choisirDon(p.etat, s, p.mains[s], { niveau: 'champion' }), d);
        p = donnerCarte(p, s, d);
      }
      continue;
    }
    const s = p.etat.tour;
    const o = (niveau) => ({ rng: generateurAleatoire(k), budgetMs: 100000, iterations: 6, carteDonnee: p.dons[s], ...(niveau ? { niveau } : {}) });
    const c = choisirCoup(p.etat, s, p.mains[s], o());
    assert.deepEqual(choisirCoup(p.etat, s, p.mains[s], o('champion')), c);
    assert.deepEqual(choisirCoup(p.etat, s, p.mains[s], o('inconnu')), c);
    p = jouerCoup(p, s, c, rng);
    k++;
  }
});

test('niveaux : reproductibles avec options.rng', () => {
  const e = etat({ 0: 20, 1: 30, 4: 25, 8: 50 });
  const main = ['5P', '8C', '9T'];
  for (const niveau of IDS) {
    const o = () => ({ niveau, rng: generateurAleatoire(3), budgetMs: 100000, iterations: 6 });
    assert.deepEqual(choisirCoup(e, 0, main, o()), choisirCoup(e, 0, main, o()));
  }
});

test('niveaux : coups évidents (gagner, rentrer) joués à partir d’amateur', () => {
  // Partenaire rentré ; dernier pion 3 cases avant l'entrée (61) : 3 + 4 = 7 gagne.
  const gagne = etat({ 0: a(0), 1: a(1), 2: a(2), 3: 58, 8: a(0), 9: a(1), 10: a(2), 11: a(3), 4: 40 });
  // Seul pion sorti, 3 cases avant l'entrée : un 6 le met au fond de l'allée, un 8 ou un 9 lui
  // ferait dépasser l'entrée (un tour de plus).
  const rentre = etat({ 0: 58, 5: 50 });
  for (const niveau of IDS.slice(1)) {
    for (let g = 0; g < 10; g++) {
      // le champion dans son régime normal (des dizaines de simulations) ; l'expert plafonne les siennes
      const o = { niveau, rng: generateurAleatoire(g), budgetMs: 100000, iterations: 60 };
      const c = choisirCoup(gagne, 0, ['9C', '7P', '2T'], o);
      assert.equal(appliquerCoup(gagne, 0, c, ['9C', '7P', '2T']).phase, 'fini', `${niveau} ne gagne pas`);
      const r = choisirCoup(rentre, 0, ['6P', '8C', '9T'], o);
      assert.ok(r.carte === '6P' && r.allee, `${niveau} ne rentre pas (${JSON.stringify(r)})`);
    }
  }
});

test('niveaux : les niveaux faibles répondent vite', () => {
  const rng = generateurAleatoire(9);
  let p = nouvellePartie({}, rng);
  const temps = { debutant: [], amateur: [], confirme: [] };
  let k = 0;
  while (p.etat.phase !== 'fini' && k < 120) {
    if (p.etat.phase === 'echange') {
      for (let s = 0; s < 4; s++) p = donnerCarte(p, s, choisirDon(p.etat, s, p.mains[s], { niveau: 'amateur' }));
      continue;
    }
    const s = p.etat.tour;
    let coup = null;
    for (const niveau of Object.keys(temps)) {
      const t0 = performance.now();
      coup = choisirCoup(p.etat, s, p.mains[s], { niveau, rng });
      temps[niveau].push(performance.now() - t0);
    }
    p = jouerCoup(p, s, coup, rng);
    k++;
  }
  for (const [niveau, t] of Object.entries(temps)) {
    t.sort((x, y) => x - y);
    assert.ok(t[t.length >> 1] < 3, `${niveau} : médiane ${t[t.length >> 1].toFixed(2)} ms`);
  }
});

test('niveaux : ordre sur une série courte à graines fixes (champion > amateur, confirmé > débutant)', () => {
  const serie = (fort, faible, n, budget, iterations) => {
    let v = 0;
    for (let i = 0; i < n; i++) {
      const pair = i % 2 === 0;
      const F = joueur(fort, budget, iterations);
      const f = joueur(faible, budget, iterations);
      const r = jouerPartie(pair ? [F, f, F, f] : [f, F, f, F], 700 + i, { cinqAdverse: i % 4 >= 2 }, budget);
      if (r.gagnant === (pair ? 0 : 1)) v++;
    }
    return v;
  };
  const cd = serie('confirme', 'debutant', 10, 0);
  assert.ok(cd >= 8, `confirmé contre débutant : ${cd}/10`);
  // Le champion cherche 16 simulations par coup (ce qu'il fait en une dizaine de millisecondes), sans limite de
  // temps atteignable : un budget en millisecondes donnait un nombre de simulations, donc un score, qui dépendait
  // de la charge de la machine. L'amateur et les deux niveaux de la première série ne simulent pas.
  const ca = serie('champion', 'amateur', 6, 100000, 16);
  assert.ok(ca >= 5, `champion contre amateur : ${ca}/6`);
});
