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
