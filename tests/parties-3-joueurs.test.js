// Parties complètes à 3 joueurs : invariants du moteur, IA provisoire, session locale et rejeu.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BASE, ALLEE, coupsLegauxMain, validerCoup, nouvellePartie, donnerCarte, jouerCoup, generateurAleatoire,
  rejouerPartie, mainAvantCoup, tailleDonne, longueurCycle, siegesGagnants, aFini, estJoker, nbCases, reglagesRejeu,
} from '../public/js/moteur/index.js';
import { choisirCoup3, choisirDon3 } from '../public/js/ia/ia3.js';
import { SessionLocale } from '../public/js/session-locale.js';

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

function verifierPlateau(pions) {
  assert.equal(pions.length, 12);
  const circuit = new Set();
  for (let g = 0; g < 12; g++) {
    const p = pions[g];
    if (p === BASE) continue;
    if (p >= ALLEE) {
      assert.ok(p < ALLEE + 4);
      continue;
    }
    assert.ok(Number.isInteger(p) && p >= 0 && p < nbCases(3), `pion ${g} en ${p}`);
    assert.ok(!circuit.has(p), `deux pions sur la case ${p}`);
    circuit.add(p);
  }
  for (let s = 0; s < 3; s++) {
    const allee = pions.slice(4 * s, 4 * s + 4).filter((p) => p >= ALLEE);
    assert.equal(new Set(allee).size, allee.length, 'deux pions sur une case de l’allée');
  }
}

/** Joue une partie complète à 3 ; `strategie(partie, siege)` → coup. */
function jouerPartie(graine, strategie, don, reglages = {}) {
  const rng = generateurAleatoire(graine);
  let p = nouvellePartie({ ...reglages, nbJoueurs: 3 }, rng);
  let garde = 0;
  let jokersJoues = 0;
  while (p.etat.phase !== 'fini') {
    assert.ok(garde++ < 20000, 'la partie ne se termine pas');
    compatibleFirestore(p.etat);
    verifierPlateau(p.etat.pions);
    const L = longueurCycle(3);
    // toutes les cartes du cycle : pile + mains + dons en attente + donnes à venir = 54 distinctes
    const cartes = [...p.etat.pile, ...p.mains.flat(), ...p.dons.filter((c) => c && p.etat.phase === 'echange')];
    for (let d = (p.etat.donne % L) + 1; d < L; d++) cartes.push(...p.cycle[d].flat());
    assert.equal(cartes.length, 54);
    assert.equal(new Set(cartes).size, 54);
    if (p.etat.phase === 'echange') {
      for (let s = 0; s < 3; s++) if (!p.dons[s]) p = donnerCarte(p, s, don(p, s, rng));
      continue;
    }
    assert.deepEqual(p.mains.map((m) => m.length), p.etat.cartesRestantes, 'mains cohérentes avec cartesRestantes');
    const s = p.etat.tour;
    const coups = coupsLegauxMain(p.etat, s, p.mains[s]);
    for (const c of coups) assert.equal(validerCoup(p.etat, s, c, p.mains[s]), null, JSON.stringify(c));
    const coup = strategie(p, s, coups, rng);
    if (estJoker(coup.carte) && coup.t !== 'defausse') jokersJoues++;
    p = jouerCoup(p, s, coup, rng);
  }
  compatibleFirestore(p.etat);
  verifierPlateau(p.etat.pions);
  assert.ok([0, 1, 2].includes(p.etat.gagnant));
  assert.equal(aFini(p.etat, p.etat.gagnant), true);
  assert.deepEqual(siegesGagnants(p.etat), [p.etat.gagnant]);
  for (let s = 0; s < 3; s++) if (s !== p.etat.gagnant) assert.equal(aFini(p.etat, s), false);
  // le rejeu de l'historique redonne exactement la partie
  const rejeu = rejouerPartie(reglagesRejeu(p.etat), p.historique);
  assert.deepEqual(rejeu.etat.pions, p.etat.pions);
  assert.equal(rejeu.etat.gagnant, p.etat.gagnant);
  assert.deepEqual(rejeu.etat.jokers, p.etat.jokers);
  assert.deepEqual(rejeu.etat.pile, p.etat.pile);
  assert.equal(rejeu.echanges.length, p.etat.donne + 1);
  return { p, jokersJoues };
}

const auHasard = (p, s, coups, rng) => coups[Math.floor(rng() * coups.length)];
const donHasard = (p, s, rng) => p.mains[s][Math.floor(rng() * p.mains[s].length)];
const ia = (p, s, coups, rng) => choisirCoup3(p.etat, s, p.mains[s], { rng });
const donIA = (p, s, rng) => choisirDon3(p.etat, s, p.mains[s], { rng });

test('parties aléatoires complètes à 3 : invariants, cartes, rejeu, fin de partie', () => {
  let jokers = 0;
  const gagnants = new Set();
  for (let graine = 1; graine <= 12; graine++) {
    const { p, jokersJoues } = jouerPartie(graine, auHasard, donHasard, { cinqAdverse: graine % 2 === 0 });
    jokers += jokersJoues;
    gagnants.add(p.etat.gagnant);
  }
  assert.ok(jokers > 10, `jokers joués : ${jokers}`);
  assert.equal(gagnants.size, 3, 'chaque siège gagne au moins une partie');
});

test('IA provisoire à 3 : toujours légale, finit ses parties et bat le hasard', () => {
  const victoires = [0, 0, 0];
  for (let graine = 100; graine < 112; graine++) {
    // siège 0 : IA ; sièges 1 et 2 : hasard
    const { p } = jouerPartie(graine, (q, s, coups, rng) => (s === 0 ? ia(q, s, coups, rng) : auHasard(q, s, coups, rng)),
      (q, s, rng) => (s === 0 ? donIA(q, s, rng) : donHasard(q, s, rng)), { cinqAdverse: graine % 2 === 1 });
    victoires[p.etat.gagnant]++;
  }
  assert.ok(victoires[0] >= 9, `victoires de l’IA : ${victoires}`);
  for (let graine = 200; graine < 204; graine++) jouerPartie(graine, ia, donIA, { cinqAdverse: graine % 2 === 0 });
});

test('session locale à 3 : une partie complète humain (aléatoire) + 2 IA, rejeu et analyse', async () => {
  const memoire = new Map();
  const stockage = { getItem: (k) => memoire.get(k) ?? null, setItem: (k, v) => memoire.set(k, v), removeItem: (k) => memoire.delete(k) };
  const rng = generateurAleatoire(43);
  const session = new SessionLocale({ delaiIA: 0, budgetIA: 5, rng, stockage, nbJoueurs: 3, cle: 'toc.test3' });
  let vue = null;
  const mainsVues = new Map();
  const recus = [];
  session.abonner((v) => (vue = v));
  assert.equal(vue.joueurs.length, 3);
  assert.equal(vue.etat.reglages.nbJoueurs, 3);
  const debut = Date.now();
  while (vue.etat.phase !== 'fini') {
    assert.ok(Date.now() - debut < 100000, 'partie trop longue');
    if (vue.etat.phase === 'echange' && !vue.don) await session.donner(vue.main[0]);
    else if (vue.etat.phase === 'jeu' && vue.etat.tour === vue.siege) {
      if (!recus[vue.etat.donne]) recus[vue.etat.donne] = vue.recu;
      const coups = coupsLegauxMain(vue.etat, vue.siege, vue.main);
      mainsVues.set(vue.etat.numCoup, vue.main.slice().sort());
      await session.jouer(coups[Math.floor(rng() * coups.length)]);
    } else await new Promise((r) => setTimeout(r, 0));
  }
  assert.ok([0, 1, 2].includes(vue.etat.gagnant));
  const donnees = await session.donneesAnalyse();
  assert.equal(donnees.reglages.nbJoueurs, 3);
  const rejeu = rejouerPartie(donnees.reglages, donnees.historique);
  assert.deepEqual(rejeu.etat.pions, vue.etat.pions);
  assert.equal(rejeu.etat.gagnant, vue.etat.gagnant);
  assert.equal(rejeu.tours.length, vue.historique.length);
  assert.equal(rejeu.echanges.length, donnees.donnes.length);
  rejeu.echanges.forEach((e, d) => {
    assert.equal(e.donne, d);
    assert.equal(donnees.donnes[d].distribuees.length, tailleDonne(d, 3));
  });
  // la carte reçue est celle donnée par le bon voisin (droite les donnes paires, gauche les impaires)
  const archives = session.partie.archives;
  recus.forEach((r, d) => {
    if (r === undefined) return;
    const donneur = d % 2 === 0 ? 2 : 1;
    assert.equal(r, archives[d].dons[donneur], `donne ${d}`);
    assert.equal(archives[d].vers[donneur], 0);
    assert.equal(donnees.donnes[d].recue, r);
  });
  let mesTours = 0;
  for (const tour of rejeu.tours) {
    if (tour.siege !== donnees.siege) continue;
    mesTours++;
    const main = mainAvantCoup(donnees.donnes, tour.avant);
    assert.deepEqual(main.slice().sort(), mainsVues.get(tour.avant.numCoup));
    assert.ok(main.includes(tour.coup.carte));
  }
  assert.equal(mesTours, mainsVues.size);

  const reprise = new SessionLocale({ reprendre: true, stockage, cle: 'toc.test3' });
  assert.equal(reprise.vue().joueurs.length, 3);
  assert.equal(reprise.vue().etat.phase, 'fini');
  assert.equal(reprise.vue().historique.length, vue.historique.length);
  session.fermer();
  reprise.fermer();
});
