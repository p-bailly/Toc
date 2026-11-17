import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionLocale } from '../public/js/session-locale.js';
import { coupsLegauxMain, generateurAleatoire, rejouerPartie, mainAvantCoup, tailleDonne } from '../public/js/moteur/index.js';

test('session locale : une partie complète humain (aléatoire) + 3 IA, avec sauvegarde', async () => {
  const memoire = new Map();
  const stockage = { getItem: (k) => memoire.get(k) ?? null, setItem: (k, v) => memoire.set(k, v), removeItem: (k) => memoire.delete(k) };
  const rng = generateurAleatoire(42);
  const session = new SessionLocale({ delaiIA: 0, budgetIA: 5, rng, stockage });
  let vue = null;
  const mainsVues = new Map(); // numCoup avant mon coup → ma main à ce moment
  session.abonner((v) => (vue = v));
  const debut = Date.now();
  while (vue.etat.phase !== 'fini') {
    assert.ok(Date.now() - debut < 100000, 'partie trop longue');
    if (vue.etat.phase === 'echange' && !vue.don) await session.donner(vue.main[0]);
    else if (vue.etat.phase === 'jeu' && vue.etat.tour === vue.siege) {
      const coups = coupsLegauxMain(vue.etat, vue.siege, vue.main);
      mainsVues.set(vue.etat.numCoup, vue.main.slice().sort());
      await session.jouer(coups[Math.floor(rng() * coups.length)]);
    } else await new Promise((r) => setTimeout(r, 0));
  }
  assert.ok(vue.etat.gagnant === 0 || vue.etat.gagnant === 1);
  assert.ok(vue.historique.length > 20);
  // Analyse : la partie se rejoue à l'identique et la main du joueur se retrouve à chaque tour.
  const donnees = await session.donneesAnalyse();
  const rejeu = rejouerPartie(donnees.reglages, donnees.historique);
  assert.deepEqual(rejeu.etat.pions, vue.etat.pions);
  assert.equal(rejeu.etat.gagnant, vue.etat.gagnant);
  assert.equal(rejeu.tours.length, vue.historique.length);
  assert.equal(rejeu.echanges.length, donnees.donnes.length);
  rejeu.echanges.forEach((e, d) => {
    assert.equal(e.donne, d);
    assert.equal(e.etat.phase, 'echange');
    assert.equal(donnees.donnes[d].distribuees.length, tailleDonne(d));
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
  // Hors ligne, les mains de tous les sièges sont fournies : chaque joueur a bien en main la carte qu'il joue.
  assert.equal(donnees.donnesParSiege.length, 4);
  assert.deepEqual(donnees.donnesParSiege[donnees.siege], donnees.donnes);
  for (const tour of rejeu.tours) {
    const donnes = donnees.donnesParSiege[tour.siege];
    assert.equal(donnes.length, donnees.donnes.length);
    const main = mainAvantCoup(donnes, tour.avant);
    assert.equal(main.length, tour.avant.cartesRestantes[tour.siege]);
    assert.ok(main.includes(tour.coup.carte), `siège ${tour.siege} : ${tour.coup.carte} dans ${main}`);
  }

  const reprise = new SessionLocale({ reprendre: true, stockage });
  assert.equal(reprise.vue().etat.phase, 'fini');
  assert.equal(reprise.vue().historique.length, vue.historique.length);
  session.fermer();
  reprise.fermer();
});

test('session locale : la couleur choisie est gardée avec la partie, les IA n’en choisissent pas', () => {
  const stockage = new Map();
  const magasin = { getItem: (k) => (stockage.has(k) ? stockage.get(k) : null), setItem: (k, v) => stockage.set(k, v), removeItem: (k) => stockage.delete(k) };
  const s = new SessionLocale({ stockage: magasin, cle: 'essai', couleur: 'turquoise', delaiIA: 1e9 });
  assert.deepEqual(s.joueurs.map((j) => j.couleur || null), ['turquoise', null, null, null]);
  s.fermer();
  const reprise = new SessionLocale({ stockage: magasin, cle: 'essai', reprendre: true, delaiIA: 1e9 });
  assert.equal(reprise.joueurs[0].couleur, 'turquoise');
  reprise.fermer();
  // Couleur inconnue ou absente : aucune (les couleurs d'origine).
  for (const couleur of ['fuchsia', undefined]) {
    const autre = new SessionLocale({ couleur, delaiIA: 1e9, nbJoueurs: 3 });
    assert.deepEqual(autre.joueurs.map((j) => j.couleur || null), [null, null, null]);
    autre.fermer();
  }
});

test('session locale : annuler son dernier coup ramène la partie juste avant, une fois par coup', async () => {
  const memoire = new Map();
  const stockage = { getItem: (k) => memoire.get(k) ?? null, setItem: (k, v) => memoire.set(k, v), removeItem: (k) => memoire.delete(k) };
  const rng = generateurAleatoire(7);
  const session = new SessionLocale({ delaiIA: 0, budgetIA: 5, rng, stockage });
  let vue = null;
  session.abonner((v) => (vue = v));
  const patienter = async (condition) => {
    const debut = Date.now();
    while (!condition()) {
      assert.ok(Date.now() - debut < 20000, 'attente trop longue');
      await new Promise((r) => setTimeout(r, 0));
    }
  };
  assert.equal(vue.annulable, false, 'rien à annuler avant d’avoir agi');
  await assert.rejects(session.annuler(), /pas de coup à annuler/);

  // Carte donnée, puis reprise : on est de nouveau dans l'échange, la carte en main.
  const mainDepart = vue.main.slice().sort();
  await session.donner(vue.main[0]);
  assert.equal(vue.annulable, true);
  await session.annuler();
  assert.equal(vue.etat.phase, 'echange');
  assert.equal(vue.don, null);
  assert.deepEqual(vue.main.slice().sort(), mainDepart);
  assert.equal(vue.annulable, false, 'une seule annulation par action');
  await session.donner(vue.main[1]);
  await patienter(() => vue.etat.phase === 'jeu' && vue.etat.tour === vue.siege);

  // Coup joué, les IA jouent derrière, puis on annule : tout revient juste avant mon coup.
  const avant = { numCoup: vue.etat.numCoup, pions: vue.etat.pions.slice(), main: vue.main.slice().sort(), histo: vue.historique.length };
  const coups = coupsLegauxMain(vue.etat, vue.siege, vue.main);
  await session.jouer(coups[0]);
  await patienter(() => vue.etat.phase !== 'jeu' || vue.etat.tour === vue.siege || vue.historique.length >= avant.histo + 4);
  assert.ok(vue.historique.length > avant.histo + 1, 'les IA ont joué après moi');
  assert.equal(vue.annulable, true);
  await session.annuler();
  assert.equal(vue.etat.numCoup, avant.numCoup);
  assert.deepEqual(vue.etat.pions, avant.pions);
  assert.deepEqual(vue.main.slice().sort(), avant.main);
  assert.equal(vue.historique.length, avant.histo);
  assert.equal(vue.etat.tour, vue.siege, 'c’est de nouveau à moi');
  assert.equal(vue.annulable, false);
  // La sauvegarde suit : en rouvrant la partie, on la retrouve à l'état annulé (et sans annulation possible).
  const reprise = new SessionLocale({ delaiIA: 1e9, stockage, reprendre: true });
  let vue2 = null;
  reprise.abonner((v) => (vue2 = v));
  assert.equal(vue2.etat.numCoup, avant.numCoup);
  assert.equal(vue2.annulable, false);
  reprise.fermer();
  // Les IA ne rejouent pas tant que je n'ai pas rejoué ; puis la partie reprend normalement.
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(vue.historique.length, avant.histo);
  await session.jouer(coups[coups.length - 1]);
  await patienter(() => vue.historique.length > avant.histo + 1 || vue.etat.phase !== 'jeu');
  assert.equal(vue.annulable, vue.etat.phase !== 'fini');
  session.fermer();
});
