// Couche réseau, mode à 3 joueurs (chacun pour soi, jokers, cycle 5-4-4-5, don au voisin).
import test from 'node:test';
import assert from 'node:assert/strict';
import { FauxServeur, attendre } from './outils-reseau/faux-magasin.js';
import { nouveauClient, contexte } from './outils-reseau/clients.js';
import * as P from '../public/js/reseau/parties.js';
import { chemins } from '../public/js/reseau/commun.js';
import {
  coupsLegauxMain,
  destinataireDon,
  donneurDon,
  estJoker,
  etatInitial,
  rejouerPartie,
  siegesGagnants,
  tailleDonne,
} from '../public/js/moteur/index.js';

async function joueurs(serveur, noms) {
  const c = [];
  for (const nom of noms) {
    const x = nouveauClient(serveur, { graine: 30 + c.length });
    x.joueur = await x.client.connecter(nom);
    c.push(x);
  }
  return c;
}

test('à 3 : salle d’attente à 3 sièges, lancement, 12 mains du cycle 5-4-4-5', async () => {
  const serveur = new FauxServeur();
  const [a, b, c, d] = await joueurs(serveur, ['Alice', 'Bruno', 'Chloé', 'David']);
  await assert.rejects(a.client.creerPartie({ nbJoueurs: 5 }), /3 ou à 4/);
  const { id } = await a.client.creerPartie({ nom: 'Trio', nbJoueurs: 3 });
  let p = serveur.get(`parties/${id}`);
  assert.deepEqual(p.reglages, { cinqAdverse: false, nbJoueurs: 3 });
  assert.equal(p.joueurs.length, 3);
  // À 4, la forme d'origine : pas de nbJoueurs dans les réglages.
  const { id: id4 } = await a.client.creerPartie({ nom: 'Quatuor' });
  assert.deepEqual(serveur.get(`parties/${id4}`).reglages, { cinqAdverse: false });
  assert.equal(serveur.get(`parties/${id4}`).joueurs.length, 4);

  let salle = null;
  const arret = a.client.surPartie(id, (r) => (salle = r));
  await b.client.rejoindrePartie(id);
  await assert.rejects(a.client.ajouterIA(id, 3), /Siège invalide/);
  await assert.rejects(a.client.lancerPartie(id), /trois joueurs/);
  await c.client.rejoindrePartie(id);
  await assert.rejects(d.client.rejoindrePartie(id), /complète \(3 joueurs\)/);
  await c.client.quitterPartie(id);
  await a.client.ajouterIA(id, 2);
  await a.client.lancerPartie(id);
  await attendre(() => salle?.statut === 'encours');
  assert.equal(salle.nbJoueurs, 3);
  assert.deepEqual(salle.reglages, { cinqAdverse: false, nbJoueurs: 3 });
  assert.equal(salle.joueurs.length, 3);
  assert.deepEqual(salle.joueurs[2], { uid: null, pseudo: 'IA 3', ia: true, niveau: 'champion' });
  arret();

  p = serveur.get(`parties/${id}`);
  assert.deepEqual(p.etat, etatInitial({ nbJoueurs: 3 }));
  assert.deepEqual(p.enAttente, [a.joueur.uid, b.joueur.uid]);
  const docs = serveur.chemins(`parties/${id}/donnes/`);
  assert.equal(docs.length, 12);
  for (let dn = 0; dn < 4; dn++) {
    for (let s = 0; s < 3; s++) assert.equal(serveur.get(`parties/${id}/donnes/${dn}_${s}`).cartes.length, tailleDonne(dn, 3));
  }
  const toutes = docs.flatMap((ch) => serveur.get(ch).cartes);
  assert.equal(toutes.length, 54);
  assert.equal(new Set(toutes).size, 54);
  assert.ok(toutes.includes('J1') && toutes.includes('J2'));
});

test('à 3 : le don va au voisin de la donne, la carte reçue reste cachée pendant l’échange', async () => {
  const serveur = new FauxServeur();
  const [a, b, c] = await joueurs(serveur, ['Alice', 'Bruno', 'Chloé']);
  const { id } = await a.client.creerPartie({ nbJoueurs: 3 });
  await b.client.rejoindrePartie(id);
  await c.client.rejoindrePartie(id);
  await a.client.lancerPartie(id);
  const ctx = [a, b, c].map((x) => contexte(serveur, x.joueur.uid));
  const carte0 = serveur.get(`parties/${id}/donnes/0_0`).cartes[0];
  await P.donnerCarte(ctx[0], id, 0, carte0);
  // Donne 0 (paire) : au voisin de gauche, le siège suivant.
  assert.deepEqual(serveur.get(`parties/${id}/dons/0_0`), { donne: 0, de: 0, pour: 1, carte: carte0 });
  await assert.rejects(ctx[1].magasin.lire(chemins.don(id, 0, 0)), { code: 'permission-denied' });
  await P.donnerCarte(ctx[1], id, 1, serveur.get(`parties/${id}/donnes/0_1`).cartes[0]);
  await P.donnerCarte(ctx[2], id, 2, serveur.get(`parties/${id}/donnes/0_2`).cartes[0]);
  const p = serveur.get(`parties/${id}`);
  assert.equal(p.etat.phase, 'jeu');
  // Échange fini : le destinataire lit, le troisième non.
  await ctx[1].magasin.lire(chemins.don(id, 0, 0));
  await assert.rejects(ctx[2].magasin.lire(chemins.don(id, 0, 0)), { code: 'permission-denied' });
  await assert.rejects(ctx[0].magasin.lire(chemins.donne(id, 0, 1)), { code: 'permission-denied' });
  // La carte reçue vient de donneurDon : pour le siège 1, du siège 0.
  const prive = await P.chargerMain(P.creerLecteurMains(ctx[1].magasin, id), id, p.etat, 1);
  assert.equal(prive.recu, carte0);
  assert.equal(prive.main.length, 5);
  assert.ok(prive.main.includes(carte0));
});

test('à 3 : partie complète 2 humains + 1 IA, remélange après 4 donnes, jokers, rejeu, statistiques', { timeout: 300000 }, async () => {
  const serveur = new FauxServeur();
  const clients = await joueurs(serveur, ['Alice', 'Bruno']);
  const [a, b] = clients;
  const { id } = await a.client.creerPartie({ nom: 'Trio', nbJoueurs: 3, cinqAdverse: true });
  await a.client.ajouterIA(id, 1);
  await b.client.rejoindrePartie(id); // siège 2
  await a.client.lancerPartie(id);

  const sessions = [];
  const vues = [];
  const incoherences = [];
  for (let i = 0; i < 2; i++) {
    const s = await clients[i].client.ouvrirSession(id);
    sessions.push(s);
    s.abonner((v) => {
      vues[i] = v;
      const { etat } = v;
      if (etat.phase === 'jeu' && v.main.length !== etat.cartesRestantes[v.siege]) incoherences.push(`main ${v.main.length}`);
      if (etat.phase === 'echange' && v.recu !== null) incoherences.push('carte reçue visible pendant l’échange');
    });
  }
  assert.deepEqual(vues.map((v) => v.siege), [0, 2]);
  assert.equal(vues[0].joueurs.length, 3);

  const rng = a.rng;
  const debut = Date.now();
  while (!vues.every((v) => v.etat.phase === 'fini')) {
    assert.ok(Date.now() - debut < 280000, 'partie trop longue');
    let agi = false;
    for (let i = 0; i < 2 && !agi; i++) {
      const v = vues[i];
      const { etat } = v;
      try {
        if (etat.phase === 'echange' && !etat.echanges[v.siege] && !v.don) {
          await sessions[i].donner(v.main[Math.floor(rng() * v.main.length)]);
          agi = true;
        } else if (etat.phase === 'jeu' && etat.tour === v.siege) {
          const coups = coupsLegauxMain(etat, v.siege, v.main);
          // Jouer un joker dès que possible, pour l'exercer.
          const joker = coups.find((c) => estJoker(c.carte) && c.t !== 'defausse');
          await sessions[i].jouer(joker || coups[Math.floor(rng() * coups.length)]);
          agi = true;
        }
      } catch (e) {
        if (!/pas ton tour|déjà donné|pas le moment|terminée/.test(e.message)) throw e;
      }
    }
    if (!agi) await new Promise((r) => setTimeout(r, 1));
  }
  assert.deepEqual(incoherences, []);

  const p = serveur.get(`parties/${id}`);
  assert.equal(p.statut, 'finie');
  assert.ok([0, 1, 2].includes(p.etat.gagnant));
  assert.deepEqual(p.enAttente, []);
  assert.ok(p.etat.donne >= 4, `donne finale ${p.etat.donne}`);
  // Remélange au bout de 4 donnes : 12 nouvelles mains (donnes 4 à 7), 54 cartes distinctes.
  const cycle = [4, 5, 6, 7].flatMap((dn) => [0, 1, 2].map((s) => serveur.get(`parties/${id}/donnes/${dn}_${s}`).cartes)).flat();
  assert.equal(cycle.length, 54);
  assert.equal(new Set(cycle).size, 54);
  assert.equal(serveur.chemins(`parties/${id}/donnes/`).length % 12, 0);
  // Les dons vont au voisin de la donne.
  for (const ch of serveur.chemins(`parties/${id}/dons/`)) {
    const don = serveur.get(ch);
    assert.equal(don.pour, destinataireDon(don.donne, don.de, 3));
  }
  // Un joker a été joué (avec le rang copié), et l'historique rejoue la partie à l'identique.
  assert.ok(p.historique.some((h) => estJoker(h.coup.carte) && h.coup.t !== 'defausse' && h.coup.comme));
  assert.ok(p.historique.some((h) => h.siege === 1), "l'IA a joué");
  const rejeu = rejouerPartie(p.etat.reglages, p.historique);
  assert.deepEqual(rejeu.etat.pions, p.etat.pions);
  assert.equal(rejeu.etat.gagnant, p.etat.gagnant);
  assert.equal(rejeu.etat.numCoup, p.etat.numCoup);

  // Analyse : carte reçue du voisin de chaque donne.
  for (const s of sessions) {
    const an = await s.donneesAnalyse();
    assert.deepEqual(an.reglages, { cinqAdverse: true, nbJoueurs: 3 });
    assert.equal(an.joueurs.length, 3);
    assert.equal(an.donnes.length, p.etat.donne + 1);
    for (const [dn, x] of an.donnes.entries()) {
      assert.equal(x.recue, serveur.get(`parties/${id}/dons/${dn}_${donneurDon(dn, an.siege, 3)}`)?.carte ?? null);
      assert.equal(x.donnee, serveur.get(`parties/${id}/dons/${dn}_${an.siege}`)?.carte ?? null);
    }
  }

  // Statistiques : victoire seulement pour le siège gagnant.
  await attendre(() => clients.every((x) => serveur.get(`joueurs/${x.joueur.uid}`).stats.jouees === 1), 5000, 'stats');
  for (const [i, x] of clients.entries()) {
    const siege = [0, 2][i];
    assert.deepEqual(serveur.get(`joueurs/${x.joueur.uid}`).stats, {
      jouees: 1,
      gagnees: siegesGagnants(p.etat).includes(siege) ? 1 : 0,
    });
  }
  sessions.forEach((s) => s.fermer());
});
