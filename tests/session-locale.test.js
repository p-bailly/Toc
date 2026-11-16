import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionLocale } from '../public/js/session-locale.js';
import { coupsLegauxMain, generateurAleatoire } from '../public/js/moteur/index.js';

test('session locale : une partie complète humain (aléatoire) + 3 IA, avec sauvegarde', async () => {
  const memoire = new Map();
  const stockage = { getItem: (k) => memoire.get(k) ?? null, setItem: (k, v) => memoire.set(k, v), removeItem: (k) => memoire.delete(k) };
  const rng = generateurAleatoire(42);
  const session = new SessionLocale({ delaiIA: 0, budgetIA: 5, rng, stockage });
  let vue = null;
  session.abonner((v) => (vue = v));
  const debut = Date.now();
  while (vue.etat.phase !== 'fini') {
    assert.ok(Date.now() - debut < 100000, 'partie trop longue');
    if (vue.etat.phase === 'echange' && !vue.don) await session.donner(vue.main[0]);
    else if (vue.etat.phase === 'jeu' && vue.etat.tour === vue.siege) {
      const coups = coupsLegauxMain(vue.etat, vue.siege, vue.main);
      await session.jouer(coups[Math.floor(rng() * coups.length)]);
    } else await new Promise((r) => setTimeout(r, 0));
  }
  assert.ok(vue.etat.gagnant === 0 || vue.etat.gagnant === 1);
  assert.ok(vue.historique.length > 20);
  const reprise = new SessionLocale({ reprendre: true, stockage });
  assert.equal(reprise.vue().etat.phase, 'fini');
  assert.equal(reprise.vue().historique.length, vue.historique.length);
  session.fermer();
  reprise.fermer();
});
