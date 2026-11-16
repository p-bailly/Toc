// Partie complète en ligne simulée : trois clients humains (coups aléatoires) et une IA jouée par
// les clients, jusqu'à la victoire, sur le faux serveur en mémoire.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FauxServeur, attendre } from './outils-reseau/faux-magasin.js';
import { nouveauClient } from './outils-reseau/clients.js';
import { appliquerCoup, coupsLegauxMain, equipe, etatInitial, marquerEchange } from '../public/js/moteur/index.js';

test('partie complète : 3 humains + 1 IA, remélanges, fin, statistiques', { timeout: 300000 }, async () => {
  const serveur = new FauxServeur();
  const noms = ['Alice', 'Bruno', 'Chloé'];
  const clients = [];
  for (let i = 0; i < 3; i++) {
    const c = nouveauClient(serveur, { graine: 10 + i });
    c.joueur = await c.client.connecter(noms[i]);
    clients.push(c);
  }
  const [a, b, c] = clients;
  const { id, code } = await a.client.creerPartie({ nom: 'Complète', cinqAdverse: true });
  await b.client.rejoindrePartie(code);
  await a.client.ajouterIA(id, 2); // IA partenaire d'Alice
  await c.client.rejoindrePartie(code); // Chloé prend le siège 3
  await a.client.lancerPartie(id);

  const listes = clients.map(() => null);
  const arrets = clients.map((x, i) => x.client.surMesParties((l) => (listes[i] = l)));

  const sessions = [];
  const vues = [];
  const incoherences = [];
  for (let i = 0; i < 3; i++) {
    const s = await clients[i].client.ouvrirSession(id);
    sessions.push(s);
    s.abonner((v) => {
      vues[i] = v;
      assert.equal(v.enLigne, true);
      assert.equal(v.id, id);
      const { etat } = v;
      // La main publiée est cohérente avec l'état public.
      if (etat.phase === 'jeu' && v.main.length !== etat.cartesRestantes[v.siege]) incoherences.push(`main ${v.main.length} ≠ ${etat.cartesRestantes[v.siege]}`);
      if (etat.phase === 'echange' && v.recu !== null) incoherences.push('carte reçue visible pendant l’échange');
    });
  }
  assert.deepEqual(vues.map((v) => v.siege), [0, 1, 3]);
  assert.deepEqual(vues[0].joueurs.map((j) => j.ia), [false, false, true, false]);

  const rng = clients[0].rng;
  const debut = Date.now();
  let actions = 0;
  while (!vues.every((v) => v.etat.phase === 'fini')) {
    assert.ok(Date.now() - debut < 280000, 'partie trop longue');
    let agi = false;
    for (let i = 0; i < 3; i++) {
      const v = vues[i];
      const { etat } = v;
      try {
        if (etat.phase === 'echange' && !etat.echanges[v.siege] && !v.don) {
          await sessions[i].donner(v.main[Math.floor(rng() * v.main.length)]);
          agi = true;
        } else if (etat.phase === 'jeu' && etat.tour === v.siege) {
          const coups = coupsLegauxMain(etat, v.siege, v.main);
          await sessions[i].jouer(coups[Math.floor(rng() * coups.length)]);
          agi = true;
        }
      } catch (e) {
        // Vue en retard d'un état : on réessaie au prochain tour de boucle.
        if (!/pas ton tour|déjà donné|pas le moment/.test(e.message)) throw e;
      }
      if (agi) {
        actions++;
        break;
      }
    }
    if (!agi) await new Promise((r) => setTimeout(r, 1));
  }
  assert.deepEqual(incoherences, []);

  const p = serveur.get(`parties/${id}`);
  assert.equal(p.statut, 'finie');
  assert.ok(p.etat.gagnant === 0 || p.etat.gagnant === 1);
  assert.deepEqual(p.enAttente, []);
  // Historique complet et ordonné ; le numéro de coup compte aussi les échanges.
  for (let k = 1; k < p.historique.length; k++) assert.ok(p.historique[k].n > p.historique[k - 1].n);
  assert.ok(p.historique.length > 40);
  assert.ok(p.historique.some((h) => h.siege === 2), "l'IA a joué");
  // Au moins un remélange (donne 3) : 12 nouvelles mains créées par un client.
  assert.ok(p.etat.donne >= 3, `donne finale ${p.etat.donne}`);
  assert.equal(serveur.chemins(`parties/${id}/donnes/3_`).length, 4);
  const cycle = [3, 4, 5].flatMap((d) => [0, 1, 2, 3].map((s) => serveur.get(`parties/${id}/donnes/${d}_${s}`).cartes)).flat();
  assert.equal(new Set(cycle).size, 52);
  // Les actions de l'IA ont été écrites par les clients connectés.
  const auteursIA = new Set(serveur.journal.filter((w) => /\/dons\/\d+_2$/.test(w.chemin)).map((w) => w.uid));
  assert.ok(auteursIA.size >= 1);
  // Aucun document de main n'a jamais été modifié.
  assert.ok(!serveur.journal.some((w) => /\/(donnes|dons)\//.test(w.chemin) && w.type !== 'creer'));

  // Statistiques : chaque humain compte la partie une fois.
  await attendre(() => clients.every((x) => serveur.get(`joueurs/${x.joueur.uid}`).stats.jouees === 1), 5000, 'stats');
  for (const [i, x] of clients.entries()) {
    const siege = [0, 1, 3][i];
    const attendu = equipe(siege) === p.etat.gagnant ? 1 : 0;
    assert.deepEqual(serveur.get(`joueurs/${x.joueur.uid}`).stats, { jouees: 1, gagnees: attendu });
  }
  await attendre(() => listes.every((l) => l?.[0]?.statut === 'finie'));
  assert.equal(listes[0][0].gagnant, p.etat.gagnant);
  assert.equal(listes[0][0].aMoiDeJouer, false);

  // Analyse de fin de partie : l'historique rejoue la partie à l'identique depuis etatInitial.
  for (const [i, s] of sessions.entries()) {
    const an = await s.donneesAnalyse();
    assert.equal(an.siege, [0, 1, 3][i]);
    assert.deepEqual(an.reglages, { cinqAdverse: true });
    assert.equal(an.joueurs[2].ia, true);
    assert.equal(an.donnes.length, p.etat.donne + 1);
    for (const [d, x] of an.donnes.entries()) {
      assert.deepEqual(x.distribuees, serveur.get(`parties/${id}/donnes/${d}_${an.siege}`).cartes);
      assert.equal(x.donnee, serveur.get(`parties/${id}/dons/${d}_${an.siege}`)?.carte ?? null);
      assert.equal(x.recue, serveur.get(`parties/${id}/dons/${d}_${(an.siege + 2) % 4}`)?.carte ?? null);
    }
    let e = etatInitial(an.reglages);
    for (const h of an.historique) {
      while (e.phase === 'echange') e = marquerEchange(e, e.echanges.indexOf(false));
      e = appliquerCoup(e, h.siege, h.coup);
      assert.equal(e.numCoup, h.n);
      assert.deepEqual(e.dernierCoup.captures, h.captures);
    }
    assert.deepEqual(e.pions, p.etat.pions);
    assert.equal(e.gagnant, p.etat.gagnant);
  }
  // Hors connexion, avec des mains pas encore en cache : message clair.
  const revue = await b.client.ouvrirSession(id);
  assert.equal(revue.vue().etat.phase, 'fini');
  b.magasin.horsLigne = true;
  await assert.rejects(revue.donneesAnalyse(), /Pas de connexion/);
  b.magasin.horsLigne = false;
  revue.fermer();
  sessions.forEach((s) => s.fermer());
  arrets.forEach((f) => f());
  console.log(`# ${actions} actions humaines, ${p.historique.length} coups, donne finale ${p.etat.donne}, relances de transaction ${serveur.relances || 0}`);
});

test("IA en attente à l'ouverture d'une session : le client la débloque", async () => {
  const serveur = new FauxServeur();
  const a = nouveauClient(serveur, { graine: 5 });
  await a.client.connecter('Alice');
  const { id } = await a.client.creerPartie({});
  for (const s of [1, 2, 3]) await a.client.ajouterIA(id, s);
  await a.client.lancerPartie(id);
  // Personne n'a encore fait jouer les IA.
  assert.deepEqual(serveur.get(`parties/${id}`).etat.echanges, [false, false, false, false]);
  const session = await a.client.ouvrirSession(id);
  await attendre(() => {
    const e = serveur.get(`parties/${id}`).etat;
    return e.echanges[1] && e.echanges[2] && e.echanges[3];
  });
  // Après mon don, les IA jouent jusqu'à ce que ce soit de nouveau à moi.
  await session.donner(session.vue().main[0]);
  await attendre(() => session.vue().etat.phase === 'jeu');
  assert.equal(session.vue().etat.tour, 0);
  assert.equal(session.vue().recu !== null, true);
  const coups = coupsLegauxMain(session.vue().etat, 0, session.vue().main);
  await session.jouer(coups[0]);
  await attendre(() => session.vue().etat.tour === 0 && session.vue().etat.numCoup >= 8);
  session.fermer();
});

test('deux clients font jouer la même IA : un seul réussit, sans erreur', async () => {
  const serveur = new FauxServeur();
  const a = nouveauClient(serveur, { graine: 7, session: { attenteAutres: [0, 0] } });
  const b = nouveauClient(serveur, { graine: 8, session: { attenteAutres: [0, 0] } });
  await a.client.connecter('Alice');
  await b.client.connecter('Bruno');
  const { id } = await a.client.creerPartie({});
  await b.client.rejoindrePartie(id);
  await a.client.ajouterIA(id, 2);
  await a.client.ajouterIA(id, 3);
  await a.client.lancerPartie(id);
  const avertissements = [];
  const warn = console.warn;
  console.warn = (...x) => avertissements.push(x);
  try {
    const sa = await a.client.ouvrirSession(id);
    const sb = await b.client.ouvrirSession(id);
    await attendre(() => {
      const e = serveur.get(`parties/${id}`).etat;
      return e.echanges[2] && e.echanges[3];
    });
    await new Promise((r) => setTimeout(r, 50));
    const e = serveur.get(`parties/${id}`).etat;
    assert.equal(e.numCoup, 2); // exactement deux dons d'IA, pas de doublon
    assert.equal(serveur.chemins(`parties/${id}/dons/`).length, 2);
    sa.fermer();
    sb.fermer();
  } finally {
    console.warn = warn;
  }
  assert.deepEqual(avertissements, []);
});
