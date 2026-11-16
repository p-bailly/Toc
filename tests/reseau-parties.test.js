// Couche réseau : salle d'attente, invitations, lancement, échange, coups, remélange, droits de lecture.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FauxServeur, attendre } from './outils-reseau/faux-magasin.js';
import { nouveauClient, contexte } from './outils-reseau/clients.js';
import * as P from '../public/js/reseau/parties.js';
import { chemins } from '../public/js/reseau/commun.js';
import { comptabiliserPartie } from '../public/js/reseau/comptes.js';
import { coupsLegauxMain, etatInitial } from '../public/js/moteur/index.js';

async function quatre(serveur) {
  const c = [];
  for (const nom of ['Alice', 'Bruno', 'Chloé', 'David']) {
    const x = nouveauClient(serveur, { graine: c.length + 1 });
    x.joueur = await x.client.connecter(nom);
    c.push(x);
  }
  return c;
}

test("salle d'attente : créer, rejoindre, sièges, IA, quitter", async () => {
  const serveur = new FauxServeur();
  const [a, b, c, d] = await quatre(serveur);
  const { id, code } = await a.client.creerPartie({ nom: '  Mardi soir ', cinqAdverse: true });
  assert.equal(id, code);
  let p = serveur.get(`parties/${id}`);
  assert.equal(p.nom, 'Mardi soir');
  assert.deepEqual(p.reglages, { cinqAdverse: true });
  assert.deepEqual(p.joueurs, [{ uid: a.joueur.uid, pseudo: 'Alice', ia: false }, null, null, null]);
  assert.deepEqual(p.uids, [a.joueur.uid]);
  assert.equal(p.statut, 'attente');

  await assert.rejects(b.client.rejoindrePartie('ABC'), /invalide/);
  await assert.rejects(b.client.rejoindrePartie('ZZZZZZ'), /Aucune partie/);
  assert.deepEqual(await b.client.rejoindrePartie(code.toLowerCase()), { id });
  await b.client.rejoindrePartie(code); // déjà membre : sans effet
  p = serveur.get(`parties/${id}`);
  assert.equal(p.joueurs[1].uid, b.joueur.uid);
  assert.deepEqual(p.uids, [a.joueur.uid, b.joueur.uid]);

  await b.client.choisirSiege(id, 2);
  await assert.rejects(b.client.choisirSiege(id, 0), /déjà pris/);
  await assert.rejects(b.client.ajouterIA(id, 1), /créateur/);
  await a.client.ajouterIA(id, 1);
  await assert.rejects(a.client.ajouterIA(id, 1), /déjà pris/);
  p = serveur.get(`parties/${id}`);
  assert.deepEqual(p.joueurs[1], { uid: null, pseudo: 'IA Est', ia: true });
  assert.equal(p.joueurs[2].uid, b.joueur.uid);

  await c.client.rejoindrePartie(code);
  await assert.rejects(d.client.rejoindrePartie(code), /complète/);
  await a.client.retirerIA(id, 1);
  await d.client.rejoindrePartie(code);
  assert.equal(serveur.get(`parties/${id}`).joueurs[1].uid, d.joueur.uid);

  // Un invité quitte ; l'hôte lance (sièges incomplets refusés) ; l'hôte qui quitte supprime la partie.
  await d.client.quitterPartie(id);
  p = serveur.get(`parties/${id}`);
  assert.equal(p.joueurs[1], null);
  assert.ok(!p.uids.includes(d.joueur.uid));
  await assert.rejects(a.client.lancerPartie(id), /quatre joueurs/);
  await a.client.quitterPartie(id);
  assert.equal(serveur.get(`parties/${id}`), null);
});

test('surMesParties, surPartie et invitations directes', async () => {
  const serveur = new FauxServeur();
  const [a, b, c] = await quatre(serveur);
  let mes = null;
  let invit = null;
  let salle = null;
  const arrets = [a.client.surMesParties((l) => (mes = l)), b.client.surInvitations((l) => (invit = l))];
  const { id } = await a.client.creerPartie({ nom: 'Invitations' });
  arrets.push(a.client.surPartie(id, (r) => (salle = r)));
  await attendre(() => mes?.length === 1 && salle);
  assert.equal(mes[0].id, id);
  assert.equal(mes[0].monSiege, 0);
  assert.equal(salle.hote, a.joueur.uid);

  await assert.rejects(b.client.inviter(id, c.joueur.uid), /créateur/);
  await a.client.inviter(id, b.joueur.uid);
  await a.client.inviter(id, c.joueur.uid);
  await attendre(() => invit?.length === 1);
  assert.equal(invit[0].id, id);
  assert.equal(invit[0].monSiege, -1);
  await attendre(() => salle.invites.length === 2);
  assert.deepEqual(salle.invites.map((x) => x.pseudo), ['Bruno', 'Chloé']);

  await c.client.refuserInvitation(id);
  await attendre(() => salle.invites.length === 1 && salle.refus.length === 1);
  assert.equal(salle.refus[0].pseudo, 'Chloé');

  await b.client.accepterInvitation(id);
  await attendre(() => invit.length === 0 && salle.joueurs[1]?.uid === b.joueur.uid);
  assert.equal(salle.invites.length, 0);
  await assert.rejects(a.client.inviter(id, b.joueur.uid), /déjà dans la partie/);

  await a.client.inviter(id, c.joueur.uid);
  await a.client.annulerInvitation(id, c.joueur.uid);
  await attendre(() => salle.invites.length === 0 && salle.refus.length === 0);

  // Une invitation ne sert plus une fois la partie lancée.
  await a.client.inviter(id, c.joueur.uid);
  await a.client.ajouterIA(id, 2);
  await a.client.ajouterIA(id, 3);
  await a.client.lancerPartie(id);
  await attendre(() => salle.statut === 'encours');
  assert.equal(salle.invites.length, 0);
  await assert.rejects(c.client.accepterInvitation(id), /commencé/);
  // Partie en cours dont on n'est pas membre : illisible, donc « déjà commencée ».
  await assert.rejects(c.client.rejoindrePartie(id), /commencé/);
  await attendre(() => mes.find((r) => r.id === id)?.statut === 'encours');
  assert.equal(mes.find((r) => r.id === id).aMoiDeJouer, true);
  arrets.forEach((f) => f());
});

/** Prépare une partie lancée : a, b, c humains aux sièges 0, 1, 2 ; IA au siège 3. */
async function partieLancee(serveur) {
  const [a, b, c] = await quatre(serveur);
  const { id } = await a.client.creerPartie({ nom: 'Test' });
  await b.client.rejoindrePartie(id);
  await c.client.rejoindrePartie(id);
  await a.client.ajouterIA(id, 3);
  await a.client.lancerPartie(id);
  return { id, a, b, c };
}

test('lancement : 12 mains distinctes, état initial, enAttente ; lectures réservées', async () => {
  const serveur = new FauxServeur();
  const { id, a, b, c } = await partieLancee(serveur);
  const p = serveur.get(`parties/${id}`);
  assert.equal(p.statut, 'encours');
  assert.deepEqual(p.etat, etatInitial({}));
  assert.deepEqual(p.enAttente, [a.joueur.uid, b.joueur.uid, c.joueur.uid]);
  const donnes = serveur.chemins(`parties/${id}/donnes/`);
  assert.equal(donnes.length, 12);
  const toutes = donnes.flatMap((ch) => serveur.get(ch).cartes);
  assert.equal(toutes.length, 52);
  assert.equal(new Set(toutes).size, 52);
  assert.equal(serveur.get(`parties/${id}/donnes/0_0`).cartes.length, 5);
  assert.equal(serveur.get(`parties/${id}/donnes/1_0`).cartes.length, 4);

  const ma = a.magasin;
  await ma.lire(chemins.donne(id, 0, 0)); // ma main
  await ma.lire(chemins.donne(id, 0, 3)); // main de l'IA : lisible par les membres
  await assert.rejects(ma.lire(chemins.donne(id, 0, 1)), { code: 'permission-denied' }); // main d'un autre humain
  await assert.rejects(ma.lire(chemins.donne(id, 1, 0)), { code: 'permission-denied' }); // donne future
  // Un non-membre ne lit rien.
  await assert.rejects(serveur.client('intrus').lire(chemins.donne(id, 0, 3)), { code: 'permission-denied' });
  await assert.rejects(serveur.client('intrus').lire(chemins.partie(id)), { code: 'permission-denied' });
});

test("échange : don, carte reçue cachée jusqu'à la fin de l'échange, IA jouée par un client", async () => {
  const serveur = new FauxServeur();
  const { id, a, b, c } = await partieLancee(serveur);
  const ctxA = contexte(serveur, a.joueur.uid);
  const ctxC = contexte(serveur, c.joueur.uid);
  const mainA = serveur.get(`parties/${id}/donnes/0_0`).cartes;
  await assert.rejects(P.donnerCarte(ctxA, id, 0, 'XX'), /pas dans ta main/);
  await assert.rejects(P.donnerCarte(ctxA, id, 1, mainA[0]), /ne joues pas/);
  await P.donnerCarte(ctxA, id, 0, mainA[0]);
  await assert.rejects(P.donnerCarte(ctxA, id, 0, mainA[1]), /déjà donné/);
  assert.deepEqual(serveur.get(`parties/${id}/dons/0_0`), { donne: 0, de: 0, pour: 2, carte: mainA[0] });
  // Le partenaire (siège 2) ne voit pas encore le don.
  await assert.rejects(ctxC.magasin.lire(chemins.don(id, 0, 0)), { code: 'permission-denied' });
  await ctxA.magasin.lire(chemins.don(id, 0, 0)); // le donneur, si

  // Don de l'IA (siège 3) par le client C, avec le numéro de coup attendu ; la course perdue est un ConflitIA.
  const lire = P.creerLecteurMains(ctxC.magasin, id);
  const etat = serveur.get(`parties/${id}`).etat;
  const iaMain = (await P.chargerMain(lire, id, etat, 3)).main;
  await P.donnerCarte(ctxC, id, 3, iaMain[0], { lire, numCoupAttendu: etat.numCoup });
  await assert.rejects(P.donnerCarte(ctxA, id, 3, iaMain[1], { numCoupAttendu: etat.numCoup }), (e) => e.code === 'toc/conflit');

  const ctxB = contexte(serveur, b.joueur.uid);
  await P.donnerCarte(ctxB, id, 1, serveur.get(`parties/${id}/donnes/0_1`).cartes[2]);
  let p = serveur.get(`parties/${id}`);
  assert.deepEqual(p.enAttente, [c.joueur.uid]);
  assert.equal(p.etat.phase, 'echange');
  const mainC = serveur.get(`parties/${id}/donnes/0_2`).cartes;
  await P.donnerCarte(ctxC, id, 2, mainC[4]);
  p = serveur.get(`parties/${id}`);
  assert.equal(p.etat.phase, 'jeu');
  assert.deepEqual(p.enAttente, [a.joueur.uid]); // tour du siège 0
  // Échange terminé : C lit le don de A, et sa main effective contient la carte reçue.
  const priveC = await P.chargerMain(P.creerLecteurMains(ctxC.magasin, id), id, p.etat, 2);
  assert.equal(priveC.recu, mainA[0]);
  assert.equal(priveC.don, mainC[4]);
  assert.ok(priveC.main.includes(mainA[0]) && !priveC.main.includes(mainC[4]));
  assert.equal(priveC.main.length, 5);
  // A lit le don que C lui a fait ; B ne lit pas le don de A à C (ni donneur, ni destinataire, pas d'IA) ;
  // le don de B à l'IA (siège 3) est lisible par les membres, qui font jouer l'IA.
  await ctxA.magasin.lire(chemins.don(id, 0, 2));
  await assert.rejects(ctxB.magasin.lire(chemins.don(id, 0, 0)), { code: 'permission-denied' });
  await assert.rejects(ctxB.magasin.lire(chemins.donne(id, 0, 0)), { code: 'permission-denied' });
  await ctxA.magasin.lire(chemins.don(id, 0, 1));
});

test('coups : tour, main, historique, coups illégaux, hors ligne', async () => {
  const serveur = new FauxServeur();
  const { id, a, b, c } = await partieLancee(serveur);
  const ctx = [a, b, c].map((x) => contexte(serveur, x.joueur.uid));
  for (const s of [0, 1, 2]) {
    await P.donnerCarte(ctx[s], id, s, serveur.get(`parties/${id}/donnes/0_${s}`).cartes[0]);
  }
  await P.donnerCarte(ctx[0], id, 3, serveur.get(`parties/${id}/donnes/0_3`).cartes[0]);
  let p = serveur.get(`parties/${id}`);
  assert.equal(p.etat.phase, 'jeu');
  assert.equal(p.etat.tour, 0);
  const prive = await P.chargerMain(P.creerLecteurMains(ctx[0].magasin, id), id, p.etat, 0);
  await assert.rejects(P.jouerCoup(ctx[1], id, 1, { t: 'defausse', carte: prive.main[0] }), /pas ton tour/);
  await assert.rejects(P.jouerCoup(ctx[0], id, 0, { t: 'avance', carte: 'XX', pion: 0, pas: 3 }), /main|mal formé/);
  const coup = coupsLegauxMain(p.etat, 0, prive.main)[0];
  ctx[0].horsLigne = () => true;
  await assert.rejects(P.jouerCoup(ctx[0], id, 0, coup), /Pas de connexion/);
  ctx[0].horsLigne = undefined;
  ctx[0].magasin.horsLigne = true; // le navigateur se croit en ligne, mais le serveur est injoignable
  await assert.rejects(P.jouerCoup(ctx[0], id, 0, coup), /Pas de connexion/);
  ctx[0].magasin.horsLigne = false;
  const n = await P.jouerCoup(ctx[0], id, 0, coup);
  p = serveur.get(`parties/${id}`);
  assert.equal(p.etat.numCoup, n);
  assert.equal(p.etat.tour, 1);
  assert.deepEqual(p.historique, [{ n, siege: 0, coup, captures: p.etat.dernierCoup.captures }]);
  assert.deepEqual(p.enAttente, [b.joueur.uid]);
  assert.ok(p.etat.pile.includes(coup.carte));
});

test('délai réseau dépassé : échec clair plutôt qu’une attente infinie', async () => {
  const serveur = new FauxServeur();
  const ctx = contexte(serveur, 'x');
  ctx.delaiReseau = 20;
  ctx.magasin.transaction = () => new Promise(() => {});
  await assert.rejects(P.creerPartie(ctx, {}), /ne répond pas/);
});

test('statistiques : comptées une seule fois, victoire selon l’équipe', async () => {
  const serveur = new FauxServeur();
  const [a, b] = await quatre(serveur);
  const partie = {
    statut: 'finie',
    joueurs: [
      { uid: a.joueur.uid, pseudo: 'Alice', ia: false },
      { uid: b.joueur.uid, pseudo: 'Bruno', ia: false },
      { uid: null, pseudo: 'IA', ia: true },
      { uid: null, pseudo: 'IA', ia: true },
    ],
    uids: [a.joueur.uid, b.joueur.uid],
    etat: { ...etatInitial({}), phase: 'fini', gagnant: 1 },
  };
  serveur.set('parties/QQQQQQ', partie);
  const ca = contexte(serveur, a.joueur.uid);
  const cb = contexte(serveur, b.joueur.uid);
  assert.equal(await comptabiliserPartie(ca, 'QQQQQQ', partie), true);
  assert.equal(await comptabiliserPartie(ca, 'QQQQQQ', partie), false);
  assert.equal(await comptabiliserPartie(cb, 'QQQQQQ', partie), true);
  assert.deepEqual(serveur.get(`joueurs/${a.joueur.uid}`).stats, { jouees: 1, gagnees: 0 });
  assert.deepEqual(serveur.get(`joueurs/${b.joueur.uid}`).stats, { jouees: 1, gagnees: 1 });
  assert.deepEqual(serveur.get(`joueurs/${b.joueur.uid}`).comptees, ['QQQQQQ']);
});
