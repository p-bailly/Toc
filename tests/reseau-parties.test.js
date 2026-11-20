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

test("salle d'attente : chacun choisit la couleur de ses pions", async () => {
  const serveur = new FauxServeur();
  const [a, b, c] = await quatre(serveur);
  const { id } = await a.client.creerPartie({ nom: 'Couleurs' });
  // La création n'écrit pas de couleur : elle se choisit ensuite (et la partie se crée même si le serveur l'ignore).
  assert.deepEqual(serveur.get(`parties/${id}`).joueurs[0], { uid: a.joueur.uid, pseudo: 'Alice', ia: false });
  await a.client.choisirCouleur(id, 'violet');
  await a.client.choisirCouleur(id, 'violet'); // sans effet
  assert.deepEqual(serveur.get(`parties/${id}`).joueurs[0], { uid: a.joueur.uid, pseudo: 'Alice', ia: false, couleur: 'violet' });
  await assert.rejects(a.client.choisirCouleur(id, 'fuchsia'), /Couleur inconnue/);
  await assert.rejects(b.client.choisirCouleur(id, 'rose'), /Assieds-toi/);
  await b.client.rejoindrePartie(id);
  await assert.rejects(b.client.choisirCouleur(id, 'violet'), /déjà prise/);
  await b.client.choisirCouleur(id, 'orange');
  // Changer de siège garde sa couleur ; une IA n'en choisit pas, elle reçoit une couleur libre.
  await b.client.choisirSiege(id, 3);
  await a.client.ajouterIA(id, 1);
  let p = serveur.get(`parties/${id}`);
  assert.deepEqual(p.joueurs[3], { uid: b.joueur.uid, pseudo: 'Bruno', ia: false, couleur: 'orange' });
  assert.equal(p.joueurs[1].couleur, undefined);
  // Le résumé montré aux écrans porte les couleurs choisies.
  let vue = null;
  const arret = a.client.surPartie(id, (r) => (vue = r));
  await attendre(() => vue?.joueurs?.[3]?.couleur === 'orange', 2000, 'résumé');
  arret();
  assert.equal(vue.joueurs[0].couleur, 'violet');
  assert.equal(vue.joueurs[1].couleur, undefined);
  // Une fois la partie lancée, les couleurs ne bougent plus.
  await c.client.choisirSiege(id, 2);
  await a.client.lancerPartie(id);
  await assert.rejects(b.client.choisirCouleur(id, 'gris'), /commencé/);
  p = serveur.get(`parties/${id}`);
  assert.deepEqual(p.joueurs.map((j) => j.couleur || null), ['violet', null, null, 'orange']);
});

test("salle d'attente : la couleur des pions d'une IA ou d'un autre joueur se choisit aussi", async () => {
  const serveur = new FauxServeur();
  const [a, b, c] = await quatre(serveur);
  const { id } = await a.client.creerPartie({ nom: 'Couleurs des autres' });
  await b.client.rejoindrePartie(id);
  await a.client.ajouterIA(id, 2, 'amateur');
  // Une IA : sa place garde son nom et son niveau, et sa couleur la suit quand son niveau change.
  await a.client.choisirCouleur(id, 'gris', 2);
  assert.deepEqual(serveur.get(`parties/${id}`).joueurs[2], { uid: null, pseudo: 'IA Nord', ia: true, niveau: 'amateur', couleur: 'gris' });
  await b.client.changerNiveauIA(id, 2, 'expert');
  assert.deepEqual(serveur.get(`parties/${id}`).joueurs[2], { uid: null, pseudo: 'IA Nord', ia: true, niveau: 'expert', couleur: 'gris' });
  // Un autre joueur : sa place ne change que de couleur. Même sans être assis (la salle est ouverte à tous).
  await a.client.choisirCouleur(id, 'rose', 1);
  assert.deepEqual(serveur.get(`parties/${id}`).joueurs[1], { uid: b.joueur.uid, pseudo: 'Bruno', ia: false, couleur: 'rose' });
  await c.client.choisirCouleur(id, 'marron', 0);
  assert.deepEqual(serveur.get(`parties/${id}`).joueurs[0], { uid: a.joueur.uid, pseudo: 'Alice', ia: false, couleur: 'marron' });
  // Une couleur choisie pour une autre place est prise, pour tout le monde ; une place libre n'a pas de couleur.
  await assert.rejects(a.client.choisirCouleur(id, 'gris'), /déjà prise/);
  await assert.rejects(a.client.choisirCouleur(id, 'rose', 2), /déjà prise/);
  await assert.rejects(a.client.choisirCouleur(id, 'vert', 3), /personne à cette place/);
  await assert.rejects(a.client.choisirCouleur(id, 'vert', 7), /Siège|siège/);
  await assert.rejects(c.client.choisirCouleur(id, 'vert'), /Assieds-toi/);
  // Les écrans les reçoivent toutes : résumé de la salle, puis joueurs de la partie en cours.
  let vue = null;
  const arret = a.client.surPartie(id, (r) => (vue = r));
  await attendre(() => vue?.joueurs?.[2]?.couleur === 'gris', 2000, 'résumé');
  arret();
  assert.deepEqual(vue.joueurs.map((j) => j?.couleur || null), ['marron', 'rose', 'gris', null]);
  // Passer à 3 joueurs garde la couleur de l'IA, qui change de nom avec son siège.
  await a.client.modifierSalle(id, { nbJoueurs: 3 });
  assert.equal(serveur.get(`parties/${id}`).joueurs[2].couleur, 'gris');
  await a.client.lancerPartie(id);
  const session = await a.client.ouvrirSession(id);
  let jeu = null;
  const fin = session.abonner((v) => (jeu = v));
  await attendre(() => jeu?.joueurs?.length === 3, 2000, 'vue de la partie');
  assert.deepEqual(jeu.joueurs.map((j) => j.couleur || null), ['marron', 'rose', 'gris']);
  fin?.();
  session.fermer();
});

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
  // N'importe qui place une IA (ici Bruno, qui n'a pas créé la salle).
  await b.client.ajouterIA(id, 1);
  await assert.rejects(a.client.ajouterIA(id, 1), /déjà pris/);
  p = serveur.get(`parties/${id}`);
  assert.deepEqual(p.joueurs[1], { uid: null, pseudo: 'IA Est', ia: true, niveau: 'champion' });
  assert.equal(p.joueurs[2].uid, b.joueur.uid);

  await c.client.rejoindrePartie(code);
  await assert.rejects(d.client.rejoindrePartie(code), /complète/);
  await a.client.retirerIA(id, 1);
  await d.client.rejoindrePartie(code);
  assert.equal(serveur.get(`parties/${id}`).joueurs[1].uid, d.joueur.uid);

  // Un joueur quitte ; lancement refusé tant qu'il manque quelqu'un, ou par qui n'est pas assis.
  await d.client.quitterPartie(id);
  p = serveur.get(`parties/${id}`);
  assert.equal(p.joueurs[1], null);
  assert.ok(!p.uids.includes(d.joueur.uid));
  await assert.rejects(a.client.lancerPartie(id), /quatre joueurs/);
  await assert.rejects(d.client.lancerPartie(id), /Assieds-toi/);
  // Le créateur quitte comme les autres : la salle reste à ceux qui y sont, et le dernier à partir l'emporte.
  await a.client.quitterPartie(id);
  p = serveur.get(`parties/${id}`);
  assert.equal(p.joueurs[0], null);
  assert.deepEqual(p.uids, [b.joueur.uid, c.joueur.uid]);
  assert.equal(p.hote, a.joueur.uid);
  await b.client.quitterPartie(id);
  await c.client.quitterPartie(id);
  assert.equal(serveur.get(`parties/${id}`), null);
});

test("salle d'attente modifiable par tous : IA, invitations, nom, mode, lancement", async () => {
  const serveur = new FauxServeur();
  const [a, b, c, d] = await quatre(serveur);
  const { id } = await a.client.creerPartie({ nom: 'À tous' });
  await b.client.choisirSiege(id, 2);
  // David n'est même pas assis : il place une IA, change son niveau, la retire, invite et annule.
  await d.client.ajouterIA(id, 1, 'amateur');
  await d.client.changerNiveauIA(id, 1, 'expert');
  assert.deepEqual(serveur.get(`parties/${id}`).joueurs[1], { uid: null, pseudo: 'IA Est', ia: true, niveau: 'expert' });
  await b.client.retirerIA(id, 1);
  await b.client.inviter(id, c.joueur.uid);
  assert.deepEqual(serveur.get(`parties/${id}`).invites, [c.joueur.uid]);
  await d.client.annulerInvitation(id, c.joueur.uid);
  assert.deepEqual(serveur.get(`parties/${id}`).invites, []);

  // Nom et règle du 5, par n'importe qui.
  await d.client.modifierSalle(id, { nom: '  Soirée Toc  ', cinqAdverse: true });
  let p = serveur.get(`parties/${id}`);
  assert.equal(p.nom, 'Soirée Toc');
  assert.deepEqual(p.reglages, { cinqAdverse: true });
  await assert.rejects(d.client.modifierSalle(id, { nom: '   ' }), /Donne un nom/);
  await assert.rejects(d.client.modifierSalle(id, { nbJoueurs: 5 }), /3 ou à 4/);

  // Mode : de 4 à 3, les places occupées se resserrent (Alice, IA, Bruno) et l'IA prend le nom de son siège.
  await b.client.ajouterIA(id, 1, 'debutant');
  await b.client.modifierSalle(id, { nbJoueurs: 3 });
  p = serveur.get(`parties/${id}`);
  assert.deepEqual(p.reglages, { cinqAdverse: true, nbJoueurs: 3 });
  assert.deepEqual(p.joueurs.map((x) => x && (x.uid || x.pseudo)), [a.joueur.uid, 'IA 2', b.joueur.uid]);
  assert.deepEqual(p.uids, [a.joueur.uid, b.joueur.uid]);
  // De 3 à 4 : une place libre s'ajoute ; table pleine à 4, on ne repasse pas à 3.
  await d.client.modifierSalle(id, { nbJoueurs: 4 });
  p = serveur.get(`parties/${id}`);
  assert.deepEqual(p.reglages, { cinqAdverse: true });
  assert.deepEqual(p.joueurs.map((x) => x && (x.uid || x.pseudo)), [a.joueur.uid, 'IA Est', b.joueur.uid, null]);
  await c.client.choisirSiege(id, 3);
  await assert.rejects(d.client.modifierSalle(id, { nbJoueurs: 3 }), /libère une place/);
  assert.equal(serveur.get(`parties/${id}`).joueurs.length, 4);

  // Lancement par un joueur assis qui n'a pas créé la salle ; ensuite plus rien ne se modifie.
  await c.client.lancerPartie(id);
  p = serveur.get(`parties/${id}`);
  assert.equal(p.statut, 'encours');
  assert.deepEqual(p.etat.reglages, { cinqAdverse: true });
  await assert.rejects(b.client.modifierSalle(id, { nom: 'Trop tard' }), /commencé/);
  await assert.rejects(d.client.ajouterIA(id, 1), /commencé/);
});

test('abandon : d’un commun accord seulement ; la partie disparaît et ne compte pas dans les statistiques', async () => {
  const serveur = new FauxServeur();
  const { id, a, b, c } = await partieLancee(serveur);
  const [, , , d] = [a, b, c, nouveauClient(serveur, { graine: 9 })];
  d.joueur = await d.client.connecter('David');
  const listes = { a: null, b: null };
  let salle = null;
  const arrets = [a.client.surMesParties((l) => (listes.a = l)), b.client.surMesParties((l) => (listes.b = l)), b.client.surPartie(id, (r) => (salle = r))];
  await attendre(() => listes.a?.length === 1 && listes.b?.length === 1 && salle);
  assert.equal(salle.abandon, null);
  // Un joueur extérieur ne vote pas.
  await assert.rejects(d.client.voterAbandon(id, true), /commencé|ne joues pas|Refusé/);

  // Alice propose : rien n'est abandonné, les autres voient la proposition.
  assert.deepEqual(await a.client.voterAbandon(id, true), { abandonnee: false });
  assert.deepEqual(await a.client.voterAbandon(id, true), { abandonnee: false }, 'voter deux fois ne change rien');
  await attendre(() => salle.abandon);
  assert.deepEqual(salle.abandon.pour.map((x) => x.pseudo), ['Alice']);
  assert.deepEqual(salle.abandon.attendus.map((x) => x.pseudo), ['Bruno', 'Chloé']);
  assert.equal(salle.abandon.jAiAccepte, false);
  assert.equal(serveur.get(`parties/${id}`).statut, 'encours');
  // Bruno refuse : la proposition tombe, la partie continue.
  assert.deepEqual(await b.client.voterAbandon(id, false), { abandonnee: false });
  await attendre(() => salle.abandon === null);
  assert.deepEqual(serveur.get(`parties/${id}`).abandon, []);

  // Nouvelle proposition : il faut tout le monde (l'IA ne vote pas) ; au dernier accord, la partie est abandonnée.
  await b.client.voterAbandon(id, true);
  await c.client.voterAbandon(id, true);
  assert.equal(serveur.get(`parties/${id}`).statut, 'encours');
  await attendre(() => salle.abandon?.attendus.length === 1);
  assert.deepEqual(await a.client.voterAbandon(id, true), { abandonnee: true });
  const p = serveur.get(`parties/${id}`);
  assert.equal(p.statut, 'abandonnee');
  // Elle disparaît de « Mes parties », on n'y joue plus, et elle n'est comptée pour personne.
  await attendre(() => listes.a.length === 0 && listes.b.length === 0);
  await attendre(() => salle.statut === 'abandonnee' && salle.abandon === null);
  const ctxA = contexte(serveur, a.joueur.uid);
  await assert.rejects(P.donnerCarte(ctxA, id, 0, serveur.get(`parties/${id}/donnes/0_0`).cartes[0]), /n'a pas commencé|terminée|commencé/);
  assert.equal(await comptabiliserPartie(ctxA, id, p), false);
  assert.deepEqual(serveur.get(`joueurs/${a.joueur.uid}`).stats, { jouees: 0, gagnees: 0 });
  assert.deepEqual(await a.client.voterAbandon(id, true), { abandonnee: true });
  // Une salle d'attente ou une partie terminée ne s'abandonne pas.
  const autre = await a.client.creerPartie({});
  await assert.rejects(a.client.voterAbandon(autre.id, true), /pas commencé/);
  arrets.forEach((f) => f());
});

test("salle d'attente ouverte à tous : s'asseoir sans invitation, règle du 5, suppression, liste des salles", async () => {
  const serveur = new FauxServeur();
  const [a, b, c, d] = await quatre(serveur);
  let salles = null;
  const arret = d.client.surSallesAttente((l) => (salles = l));
  const { id } = await a.client.creerPartie({ nom: 'Ouverte' });
  // David n'est ni membre ni invité : il voit pourtant la salle.
  await attendre(() => salles?.length === 1);
  assert.equal(salles[0].id, id);
  assert.equal(salles[0].monSiege, -1);

  // Bruno s'assoit sur le siège de son choix sans code ni invitation ; Chloé, invitée, aussi (son invitation tombe).
  await a.client.inviter(id, c.joueur.uid);
  await b.client.choisirSiege(id, 2);
  await c.client.choisirSiege(id, 3);
  await assert.rejects(d.client.choisirSiege(id, 2), /déjà pris/);
  let p = serveur.get(`parties/${id}`);
  assert.deepEqual(p.joueurs.map((x) => x && x.uid), [a.joueur.uid, null, b.joueur.uid, c.joueur.uid]);
  assert.deepEqual(p.uids, [a.joueur.uid, b.joueur.uid, c.joueur.uid]);
  assert.deepEqual(p.invites, []);
  // Changer de siège ne touche pas à la liste des membres.
  await b.client.choisirSiege(id, 1);
  p = serveur.get(`parties/${id}`);
  assert.deepEqual(p.joueurs.map((x) => x && x.uid), [a.joueur.uid, b.joueur.uid, null, c.joueur.uid]);
  assert.deepEqual(p.uids, [a.joueur.uid, b.joueur.uid, c.joueur.uid]);

  // La règle du 5 : n'importe qui l'active ou la désactive (même sans être assis), le reste des réglages ne bouge pas.
  await d.client.reglerCinqAdverse(id, true);
  assert.deepEqual(serveur.get(`parties/${id}`).reglages, { cinqAdverse: true });
  await attendre(() => salles[0]?.reglages.cinqAdverse === true);
  await b.client.reglerCinqAdverse(id, false);
  await b.client.reglerCinqAdverse(id, false); // déjà désactivée : sans effet
  assert.deepEqual(serveur.get(`parties/${id}`).reglages, { cinqAdverse: false });
  const trio = await a.client.creerPartie({ nom: 'Trio', nbJoueurs: 3 });
  await b.client.reglerCinqAdverse(trio.id, true);
  assert.deepEqual(serveur.get(`parties/${trio.id}`).reglages, { cinqAdverse: true, nbJoueurs: 3 });
  await attendre(() => salles.length === 2);

  // Supprimer : n'importe qui, tant que la partie n'est pas lancée.
  await d.client.supprimerPartie(trio.id);
  assert.equal(serveur.get(`parties/${trio.id}`), null);
  await d.client.supprimerPartie(trio.id); // déjà supprimée : sans effet
  await assert.rejects(d.client.reglerCinqAdverse(trio.id, true), /n'existe plus/);
  await attendre(() => salles.length === 1);

  // Une fois lancée, la partie garde la règle choisie ; elle quitte la liste et ne se touche plus.
  await d.client.reglerCinqAdverse(id, true);
  await a.client.ajouterIA(id, 2);
  await a.client.lancerPartie(id);
  p = serveur.get(`parties/${id}`);
  assert.deepEqual(p.etat.reglages, { cinqAdverse: true });
  await attendre(() => salles.length === 0);
  await assert.rejects(b.client.reglerCinqAdverse(id, false), /commencé/);
  await assert.rejects(b.client.supprimerPartie(id), /commencé/);
  await assert.rejects(d.client.supprimerPartie(id), /commencé/); // non-membre : la partie ne se lit même plus
  await assert.rejects(d.client.choisirSiege(id, 0), /commencé/);
  assert.equal(serveur.get(`parties/${id}`).statut, 'encours');
  arret();
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
  // Partie en cours dont on n'est pas membre : on ne s'y assoit plus, mais on peut la regarder.
  assert.deepEqual(await c.client.rejoindrePartie(id), { id, spectateur: true });
  assert.equal(serveur.get(`parties/${id}`).uids.includes(c.joueur.uid), false);
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
  // Un non-membre lit la partie (il peut la regarder), mais aucune main, pas même celle de l'IA.
  await assert.rejects(serveur.client('intrus').lire(chemins.donne(id, 0, 3)), { code: 'permission-denied' });
  await assert.rejects(serveur.client('intrus').lire(chemins.donne(id, 0, 0)), { code: 'permission-denied' });
  assert.equal((await serveur.client('intrus').lire(chemins.partie(id))).statut, 'encours');
});

test('spectateur : tout joueur connecté liste les parties en cours et les regarde, sans cartes et sans y jouer', async () => {
  const serveur = new FauxServeur();
  const [a, b, c, d] = await quatre(serveur);
  // David ne voit que les parties en cours : pas une salle d'attente.
  let enCours = null;
  const arret = d.client.surPartiesEnCours((l) => (enCours = l));
  const { id } = await a.client.creerPartie({ nom: 'À regarder' });
  await b.client.rejoindrePartie(id);
  await c.client.rejoindrePartie(id);
  await a.client.ajouterIA(id, 3);
  await attendre(() => enCours !== null);
  assert.deepEqual(enCours, []);
  await assert.rejects(d.client.ouvrirSession(id), /pas encore commencé/);
  await a.client.lancerPartie(id);
  await attendre(() => enCours.length === 1, 2000, 'partie en cours listée');
  assert.equal(enCours[0].id, id);
  assert.equal(enCours[0].monSiege, -1);
  assert.equal(enCours[0].aMoiDeJouer, false);
  assert.deepEqual(enCours[0].joueurs.map((j) => j.pseudo), ['Alice', 'Bruno', 'Chloé', 'IA Ouest']);
  // Les joueurs de la partie la voient aussi dans cette liste (l'écran ne montre que celles des autres).
  let pourAlice = null;
  const arretA = a.client.surPartiesEnCours((l) => (pourAlice = l));
  await attendre(() => pourAlice?.length === 1);
  assert.equal(pourAlice[0].monSiege, 0);
  arretA();

  // Session de spectateur : la partie, sans aucune carte.
  const session = await d.client.ouvrirSession(id);
  let vue = null;
  session.abonner((v) => (vue = v));
  assert.equal(vue.spectateur, true);
  assert.equal(vue.siege, -1);
  assert.deepEqual(vue.main, []);
  assert.equal(vue.don, null);
  assert.equal(vue.recu, null);
  assert.equal(vue.etat.phase, 'echange');
  assert.deepEqual(vue.joueurs.map((j) => j.pseudo), ['Alice', 'Bruno', 'Chloé', 'IA Ouest']);
  await assert.rejects(session.donner('AP'), /Tu regardes/);
  await assert.rejects(session.jouer({ t: 'defausse', carte: 'AP' }), /Tu regardes/);
  await assert.rejects(session.donneesAnalyse(), /réservée aux joueurs/);
  // Le spectateur ne fait pas jouer l'IA (il ne lit pas sa main) : rien ne bouge tant qu'aucun joueur n'est là.
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(serveur.get(`parties/${id}`).etat.numCoup, 0);
  assert.deepEqual(serveur.journal.filter((w) => w.uid === d.joueur.uid && w.chemin.startsWith('parties/')), []);

  // Les joueurs jouent : le spectateur suit la partie coup après coup.
  const ctx = [a, b, c].map((x) => contexte(serveur, x.joueur.uid));
  for (let s = 0; s < 3; s++) await P.donnerCarte(ctx[s], id, s, serveur.get(`parties/${id}/donnes/0_${s}`).cartes[0]);
  await P.donnerCarte(ctx[0], id, 3, serveur.get(`parties/${id}/donnes/0_3`).cartes[0]); // l'IA, jouée par Alice
  await attendre(() => vue.etat.phase === 'jeu', 2000, 'le spectateur voit la fin de l’échange');
  assert.deepEqual(vue.main, []);
  assert.equal(vue.recu, null);
  const mainA = (await P.chargerMain(P.creerLecteurMains(ctx[0].magasin, id), id, serveur.get(`parties/${id}`).etat, 0)).main;
  await P.jouerCoup(ctx[0], id, 0, coupsLegauxMain(serveur.get(`parties/${id}`).etat, 0, mainA)[0]);
  await attendre(() => vue.historique.length === 1, 2000, 'le spectateur voit le coup');
  assert.equal(vue.historique[0].siege, 0);
  assert.equal(vue.etat.tour, 1);
  // Il n'a toujours rien écrit, et les cartes restent illisibles pour lui.
  assert.deepEqual(serveur.journal.filter((w) => w.uid === d.joueur.uid && w.chemin.startsWith('parties/')), []);
  await assert.rejects(d.magasin.lire(chemins.donne(id, 0, 3)), { code: 'permission-denied' });
  await assert.rejects(d.magasin.lire(chemins.don(id, 0, 0)), { code: 'permission-denied' });
  // Voter l'abandon reste réservé aux joueurs.
  await assert.rejects(d.client.voterAbandon(id, true), /Tu ne joues pas/);

  // Abandonnée par ses joueurs : elle n'est plus à regarder.
  for (const x of [a, b, c]) await x.client.voterAbandon(id, true);
  await attendre(() => enCours.length === 0, 2000, 'partie abandonnée retirée de la liste');
  await assert.rejects(d.client.ouvrirSession(id), /abandonnée/);
  session.fermer();
  arret();
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
