// Le plateau des nouvelles parties : 18 cases d'une case de sortie à la suivante (72 cases à 4 joueurs, 54 à 3).
// Les parties commencées sur l'ancien plateau (16 cases, etat.v = 1) s'y terminent : les deux plateaux vivent
// côte à côte dans l'appli, et chaque fonction qui reçoit un état travaille sur le sien.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BASE, ALLEE, etatInitial, coupsLegaux, coupsLegauxMain, appliquerCoup, apercuCoup, validerCoup, estProtege,
  nouvellePartie, donnerCarte, jouerCoup, generateurAleatoire, rejouerPartie, reglagesRejeu, rangsCopiables,
  nbCases, caseDepart, caseEntree, coteDeEtat, viser, viserPlateau, COTE_ACTUEL, COTE_ANCIEN,
} from '../public/js/moteur/index.js';
import { coupsCarte, masqueCopiables } from '../public/js/ia/simulation.js';
import { choisirCoup, choisirDon } from '../public/js/ia/ia.js';
import { geometrie, chemin, caseCircuit } from '../public/js/ui/geometrie.js';
import { casesParPion } from '../public/js/ui/etude-calcul.js';

const a = (k) => ALLEE + k;
const legal = (e, siege, coup) => validerCoup(e, siege, coup) === null;

/** État en phase de jeu : { numéroDePion: position } ; reglages.plateau choisit le plateau (défaut : 18). */
function etat(positions = {}, reglages = {}, tour = 0) {
  const e = etatInitial(reglages);
  e.phase = 'jeu';
  e.echanges = e.echanges.map(() => true);
  for (const [g, pos] of Object.entries(positions)) e.pions[g] = pos;
  e.tour = tour;
  return e;
}

test('plateau : 18 cases entre deux cases de sortie, 72 cases à 4 et 54 à 3', () => {
  const e = etatInitial();
  assert.equal(e.v, 2);
  assert.equal(coteDeEtat(e), 18);
  assert.equal(viser(e), COTE_ACTUEL);
  assert.equal(nbCases(), 72);
  assert.equal(nbCases(3), 54);
  assert.deepEqual([0, 1, 2, 3].map(caseDepart), [0, 18, 36, 54]);
  assert.deepEqual([0, 1, 2, 3].map((s) => caseEntree(s)), [69, 15, 33, 51]);
  assert.deepEqual([0, 1, 2].map((s) => caseEntree(s, 3)), [51, 15, 33]);
  // Le plateau n'entre pas dans les réglages de l'état (les règles Firestore n'y acceptent aucun champ de plus).
  assert.deepEqual(e.reglages, { cinqAdverse: false });
  assert.deepEqual(etatInitial({ nbJoueurs: 3, plateau: 18 }).reglages, { cinqAdverse: false, nbJoueurs: 3 });
});

test('sortie sur la case 18 × siège, bouclage de 71 à 0', () => {
  for (const s of [0, 1, 2, 3]) {
    const n = appliquerCoup(etat({}, {}, s), s, { t: 'sortie', carte: 'AP', pion: 4 * s });
    assert.equal(n.pions[4 * s], 18 * s);
    assert.equal(estProtege(n, 4 * s), true);
  }
  const e = etat({ 4: 70 }, {}, 1);
  assert.equal(appliquerCoup(e, 1, { t: 'avance', carte: '5P', pion: 4, pas: 5, allee: false }).pions[4], 3);
  // Roi : 13 cases, sans passer de 63 à 0 comme sur l'ancien plateau.
  assert.equal(appliquerCoup(etat({ 0: 60 }), 0, { t: 'avance', carte: 'RP', pion: 0, pas: 13, allee: false }).pions[0], 1);
  // À 3 : 54 cases.
  const t = etat({ 4: 52 }, { nbJoueurs: 3 }, 1);
  assert.equal(appliquerCoup(t, 1, { t: 'avance', carte: '5P', pion: 4, pas: 5, allee: false }).pions[4], 3);
});

test("allée : l'entrée est 3 cases avant la sortie ; un 4 puis un 5 mènent au fond", () => {
  let e = etat({ 0: 0 });
  e = appliquerCoup(e, 0, { t: 'recul', carte: '4C', pion: 0 });
  assert.equal(e.pions[0], 68); // une case avant la case d'entrée (69)
  e = { ...e, tour: 0 };
  assert.equal(appliquerCoup(e, 0, { t: 'avance', carte: '5K', pion: 0, pas: 5, allee: true }).pions[0], a(3));
  assert.equal(legal(e, 0, { t: 'avance', carte: '6K', pion: 0, pas: 6, allee: true }), false);
  assert.equal(appliquerCoup(e, 0, { t: 'avance', carte: '6K', pion: 0, pas: 6, allee: false }).pions[0], 2);
  // Depuis la case 60 (une case avant l'entrée de l'ancien plateau), l'allée est encore à 9 cases.
  const loin = etat({ 0: 60 });
  assert.equal(legal(loin, 0, { t: 'avance', carte: '5K', pion: 0, pas: 5, allee: true }), false);
  assert.equal(appliquerCoup(loin, 0, { t: 'avance', carte: '10K', pion: 0, pas: 10, allee: true }).pions[0], a(0));
  // Les autres couleurs, et le jeu à 3.
  assert.equal(appliquerCoup(etat({ 4: 14 }, {}, 1), 1, { t: 'avance', carte: '2K', pion: 4, pas: 2, allee: true }).pions[4], a(0));
  assert.equal(appliquerCoup(etat({ 0: 50 }, { nbJoueurs: 3 }), 0, { t: 'avance', carte: '5K', pion: 0, pas: 5, allee: true }).pions[0], a(3));
});

test('pion protégé : sur la case 18 × siège, plus sur la case 16 × siège', () => {
  const e = etat({ 4: 18, 0: 14 });
  assert.equal(estProtege(e, 4), true);
  assert.equal(coupsLegaux(e, 0, '6T').length, 0); // dépasserait le pion protégé
  assert.equal(coupsLegaux(e, 0, 'VT').length, 0);
  assert.deepEqual(coupsLegaux(e, 0, '3T').map((c) => c.pas), [3]);
  // La case 16 n'est plus une case de sortie : le pion rouge s'y prend comme n'importe où.
  const f = etat({ 4: 16, 0: 12 });
  assert.equal(estProtege(f, 4), false);
  assert.equal(appliquerCoup(f, 0, { t: 'avance', carte: '6T', pion: 0, pas: 6, allee: false }).pions[0], 18);
  assert.equal(appliquerCoup(f, 0, { t: 'sept', carte: '7T', etapes: [{ pion: 0, pas: 7, allee: false }] }).pions[4], BASE);
});

test('les deux plateaux côte à côte : chaque état garde le sien, quel que soit le plateau visé', () => {
  const ancien = etat({ 0: 60, 4: 16 }, { plateau: COTE_ANCIEN });
  const neuf = etat({ 0: 60, 4: 16 });
  assert.equal(ancien.v, 1);
  assert.equal(neuf.v, 2);
  const entre5 = { t: 'avance', carte: '5K', pion: 0, pas: 5, allee: true };
  for (let i = 0; i < 3; i++) {
    // Ancien plateau : la case 60 est une case avant l'entrée, la case 16 est la sortie de Rouge.
    assert.equal(legal(ancien, 0, entre5), true);
    assert.equal(estProtege(ancien, 4), true);
    // Nouveau plateau, juste après : ni l'un ni l'autre.
    assert.equal(legal(neuf, 0, entre5), false);
    assert.equal(estProtege(neuf, 4), false);
    viserPlateau(i % 2 ? COTE_ANCIEN : COTE_ACTUEL); // quelqu'un d'autre vise un plateau entre-temps
  }
  // Un coup joué garde le plateau de la partie.
  const suite = appliquerCoup(ancien, 0, entre5);
  assert.equal(suite.v, 1);
  assert.equal(suite.pions[0], a(3));
  // Un état sans version (parties d'avant) est un état de l'ancien plateau.
  const { v, ...sansVersion } = ancien;
  assert.equal(v, 1);
  assert.equal(coteDeEtat(sansVersion), COTE_ANCIEN);
  assert.equal(legal(sansVersion, 0, entre5), true);
});

/** Joue une partie au hasard jusqu'au bout et la renvoie. */
function partieAuHasard(reglages, graine) {
  const rng = generateurAleatoire(graine);
  let p = nouvellePartie(reglages, rng);
  const n = p.etat.pions.length >> 2;
  for (let i = 0; p.etat.phase !== 'fini' && i < 20000; i++) {
    if (p.etat.phase === 'echange') {
      for (let s = 0; s < n; s++) p = donnerCarte(p, s, p.mains[s][0]);
      continue;
    }
    const s = p.etat.tour;
    const coups = coupsLegauxMain(p.etat, s, p.mains[s]);
    p = jouerCoup(p, s, coups[Math.floor(rng() * coups.length)], rng);
  }
  assert.equal(p.etat.phase, 'fini');
  return p;
}

test('rejeu : une partie se rejoue sur son plateau ; sans plateau noté, sur celui de 16 cases', () => {
  for (const nbJoueurs of [4, 3]) {
    const reglages = nbJoueurs === 3 ? { nbJoueurs: 3 } : {};
    const neuve = partieAuHasard(reglages, 11);
    assert.equal(neuve.etat.v, 2);
    assert.ok(neuve.etat.pions.every((p) => p === BASE || p >= ALLEE || (p >= 0 && p < 18 * nbJoueurs)));
    assert.equal(reglagesRejeu(neuve.etat).plateau, 18);
    assert.deepEqual(rejouerPartie(reglagesRejeu(neuve.etat), neuve.historique).etat.pions, neuve.etat.pions);

    const ancienne = partieAuHasard({ ...reglages, plateau: COTE_ANCIEN }, 12);
    assert.equal(ancienne.etat.v, 1);
    // Enregistrée avant le plateau de 18 cases : ses réglages ne disent rien du plateau.
    assert.equal('plateau' in ancienne.etat.reglages, false);
    const rejeu = rejouerPartie(ancienne.etat.reglages, ancienne.historique);
    assert.equal(rejeu.etat.v, 1);
    assert.deepEqual(rejeu.etat.pions, ancienne.etat.pions);
    assert.deepEqual(rejouerPartie(reglagesRejeu(ancienne.etat), ancienne.historique).etat.pions, ancienne.etat.pions);
  }
});

const RANGS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'V', 'D', 'R'];

test("moteur rapide de l'IA : mêmes coups que le moteur de règles sur les deux plateaux, mêlés", () => {
  const cle = (pions, coup) => pions.join(',') + JSON.stringify(coup);
  let n = 0;
  for (const nbJoueurs of [4, 3]) {
    // Deux parties avancent en même temps, une par plateau : chaque appel doit viser le bon.
    const rng = generateurAleatoire(7 + nbJoueurs);
    const base = nbJoueurs === 3 ? { nbJoueurs: 3, cinqAdverse: true } : { cinqAdverse: true };
    const parties = [nouvellePartie(base, rng), nouvellePartie({ ...base, plateau: COTE_ANCIEN }, rng)];
    for (let tour = 0; tour < 700; tour++) {
      for (let k = 0; k < 2; k++) {
        let p = parties[k];
        if (p.etat.phase === 'fini') continue;
        if (p.etat.phase === 'echange') {
          for (let s = 0; s < nbJoueurs; s++) p = donnerCarte(p, s, p.mains[s][0]);
          parties[k] = p;
          continue;
        }
        const s = p.etat.tour;
        const cop = masqueCopiables(rangsCopiables(p.etat));
        for (const r of RANGS) {
          const carte = r + 'P';
          const ref = coupsLegaux(p.etat, s, carte).map((c) => cle(apercuCoup(p.etat, s, c).pions, c)).sort();
          viser(p.etat); // le moteur rapide ne reçoit que les pions : il travaille sur le plateau visé
          const ia = coupsCarte(p.etat.pions, s, carte, true, [], Infinity, null, cop).map((c) => cle(c.pions, c.coup)).sort();
          assert.deepEqual(ia, ref, `${nbJoueurs} joueurs, plateau ${coteDeEtat(p.etat)}`);
          n++;
        }
        const coups = coupsLegauxMain(p.etat, s, p.mains[s]);
        parties[k] = jouerCoup(p, s, coups[Math.floor(rng() * coups.length)], rng);
      }
    }
  }
  assert.ok(n > 10000);
});

test("IA : joue des coups légaux sur le plateau de 18 cases, et rentre un pion quand elle le peut", () => {
  // Case d'entrée de Bleu : 69. Pion en 66 (3 cases avant), un 6 l'amène au fond de l'allée.
  const e = etat({ 0: 66, 1: 30, 5: 56 });
  e.cartesRestantes = [3, 3, 3, 3];
  const main = ['6P', '8C', '9T'];
  const coup = choisirCoup(e, 0, main, { budgetMs: 60, rng: generateurAleatoire(3) });
  assert.equal(validerCoup(e, 0, coup, main), null);
  assert.deepEqual({ carte: coup.carte, pion: coup.pion, allee: coup.allee }, { carte: '6P', pion: 0, allee: true });
  // Une partie entière IA contre IA, sur les deux plateaux à tour de rôle.
  for (const reglages of [{}, { plateau: COTE_ANCIEN }, { nbJoueurs: 3 }]) {
    const rng = generateurAleatoire(5);
    let p = nouvellePartie(reglages, rng);
    const n = p.etat.pions.length >> 2;
    for (let i = 0; p.etat.phase !== 'fini' && i < 4000; i++) {
      if (p.etat.phase === 'echange') {
        for (let s = 0; s < n; s++) p = donnerCarte(p, s, choisirDon(p.etat, s, p.mains[s], { rng }));
        continue;
      }
      const s = p.etat.tour;
      const c = choisirCoup(p.etat, s, p.mains[s], { budgetMs: 1, rng });
      assert.equal(validerCoup(p.etat, s, c, p.mains[s]), null);
      p = jouerCoup(p, s, c, rng);
    }
    assert.equal(p.etat.phase, 'fini');
  }
});

test('dessin : chaque plateau a sa géométrie, sans case en double', () => {
  const cle = (p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`;
  for (const cote of [COTE_ACTUEL, COTE_ANCIEN]) {
    for (const nb of [4, 3]) {
      const G = geometrie(nb, cote);
      assert.equal(G, geometrie(nb, cote), 'même objet pour les mêmes arguments');
      assert.equal(G.nbCases, nb * cote);
      assert.equal(G.casesParCote, cote);
      for (let vue = 0; vue < nb; vue++) {
        const vues = new Set();
        for (let i = 0; i < G.nbCases; i++) vues.add(cle(G.caseCircuit(i, vue)));
        for (let s = 0; s < nb; s++) {
          for (let k = 0; k < 4; k++) {
            vues.add(cle(G.caseAllee(s, k, vue)));
            vues.add(cle(G.emplacementBase(s, k, vue)));
          }
        }
        assert.equal(vues.size, G.nbCases + 8 * nb, `${nb} joueurs, ${cote} cases, vue ${vue}`);
        // La sortie du joueur vu est au milieu du côté du bas, son entrée 3 cases (30 unités) à droite.
        const sortie = G.caseCircuit(vue * cote, vue);
        const entree = G.caseCircuit((vue * cote - 3 + G.nbCases) % G.nbCases, vue);
        assert.ok(Math.abs(entree.x - sortie.x - 30) < 1e-6 && Math.abs(entree.y - sortie.y) < 1e-6);
        const a0 = G.caseAllee(vue, 0, vue);
        assert.ok(Math.abs(a0.x - entree.x) < 1e-6 && Math.abs(entree.y - a0.y - 10) < 1e-6, 'allée au-dessus de la case d’entrée');
      }
    }
  }
  assert.notEqual(geometrie(4, 18), geometrie(4, 16));
  // Carré de 18 : grille de 19 × 19, sortie du joueur du bas en (9, 18).
  viserPlateau(COTE_ACTUEL);
  assert.deepEqual(caseCircuit(0, 0), { u: 9, v: 18 });
  assert.deepEqual(caseCircuit(9, 0), { u: 0, v: 18 });
  assert.deepEqual(caseCircuit(69, 0), { u: 12, v: 18 });
  assert.deepEqual(geometrie(4, 18).cadre, { x: -14, y: -15.5, l: 218, h: 221 });
  assert.deepEqual(geometrie(4, 16).cadre, { x: -14, y: -15.5, l: 198, h: 201 });
  // Trajets animés : entrée dans l'allée et bouclage.
  assert.deepEqual(chemin(0, 67, a(1)), [67, 68, 69, 100, 101]);
  assert.deepEqual(chemin(0, 70, 1), [70, 71, 0, 1]);
  assert.deepEqual(chemin(0, 0, 68, 'arriere'), [0, 71, 70, 69, 68]);
  assert.deepEqual(chemin(0, 52, 1, 'avant', 3), [52, 53, 0, 1]);
});

test('analyse : un pion rentré vaut un tour de circuit de plus sur le plateau de 18 cases', () => {
  viserPlateau(COTE_ACTUEL);
  assert.equal(casesParPion(4), 106);
  assert.equal(casesParPion(3), 88);
  viserPlateau(COTE_ANCIEN);
  assert.equal(casesParPion(4), 98);
  assert.equal(casesParPion(3), 82);
  viserPlateau(COTE_ACTUEL);
});
