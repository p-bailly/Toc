// Couche réseau contre les émulateurs Firebase (Auth + Firestore), avec les vraies règles
// (firestore.rules) et le vrai SDK (paquet npm `firebase`, hors du dépôt).
//
// Ignoré sans émulateur. Pour le lancer (paquets installés hors du projet, dans un dossier OUTILS) :
//   cd OUTILS && npm install firebase@13.1.0 @firebase/rules-unit-testing firebase-tools
//   cd /chemin/du/Toc && TOC_MODULES=OUTILS/node_modules OUTILS/node_modules/.bin/firebase \
//     emulators:exec --only auth,firestore --project demo-toc "node --test tests/reseau-emulateur.test.js"
//
// 1. Une partie complète (3 humains + 1 IA) jouée par le vrai client : chaque opération du client
//    (transactions, lectures dans les transactions, requêtes de liste, écoutes) passe par les règles.
// 2. Des tentatives de triche directes, qui doivent être refusées.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { creerClient } from '../public/js/reseau/client.js';
import { initialiser } from '../public/js/reseau/firebase.js';
import { choisirCoupGlouton, choisirDon, coupGlouton } from './outils-reseau/ia-simple.js';
import { coupsLegauxMain, generateurAleatoire, appliquerCoup, marquerEchange, etatInitial, rejouerPartie } from '../public/js/moteur/index.js';
import { attendre } from './outils-reseau/faux-magasin.js';

const actif = !!(process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST && process.env.TOC_MODULES);
const PROJET = 'demo-toc';

let M = null;
function modules() {
  if (M) return M;
  const req = createRequire(join(process.env.TOC_MODULES, 'x.js'));
  M = {
    appMod: req('firebase/app'),
    authMod: req('firebase/auth'),
    fs: req('firebase/firestore'),
    rut: req('@firebase/rules-unit-testing'),
  };
  return M;
}

let nApp = 0;
function nouveauClient(graine) {
  const { appMod, authMod, fs } = modules();
  const [hote] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
  const services = initialiser(
    { appMod, authMod, fs },
    { apiKey: 'demo-cle', authDomain: 'demo-toc.firebaseapp.com', projectId: PROJET, emulateurs: { hote } },
    { memoire: true, nomApp: `client-${++nApp}` },
  );
  const rng = generateurAleatoire(graine);
  const client = creerClient({
    services: async () => services,
    ia: { choisirDon, choisirCoup: choisirCoupGlouton, choisirDon3: choisirDon, choisirCoup3: choisirCoupGlouton },
    rng,
    session: { delaiIA: 0, attenteAutres: [50, 200], budgetIA: 5 },
  });
  return { client, rng, services };
}

let env = null;
async function environnement() {
  if (env) return env;
  const { rut } = modules();
  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
  env = await rut.initializeTestEnvironment({
    projectId: PROJET,
    firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'), host, port: Number(port) },
  });
  return env;
}

// Sessions ouvertes, fermées après chaque test (même en cas d'échec : leurs IA continueraient).
const ouvertes = [];
test.afterEach(() => {
  while (ouvertes.length) ouvertes.pop().fermer();
});

let partage = null;

test('émulateur : partie complète 3 humains + 1 IA avec le vrai SDK et les vraies règles', { skip: !actif && 'émulateur absent', timeout: 600000 }, async () => {
  const e = await environnement();
  await e.clearFirestore();
  const noms = ['Alice', 'Bruno', 'Chloé'];
  const clients = [];
  for (let i = 0; i < 3; i++) {
    const c = nouveauClient(20 + i);
    c.joueur = await c.client.connecter(noms[i]);
    clients.push(c);
  }
  const [a, b, c] = clients;
  // Reconnexion par le nom (autre graphie) : même compte.
  const a2 = nouveauClient(99);
  assert.equal((await a2.client.connecter('alice')).uid, a.joueur.uid);
  await a2.client.modifierProfil({ icone: 'chat' });
  assert.equal((await b.client.lireJoueur(a.joueur.uid)).icone, 'chat');
  const liste = await b.client.listerJoueurs();
  assert.deepEqual(liste.map((j) => j.pseudo).sort(), ['Alice', 'Chloé']);

  const { id, code } = await a.client.creerPartie({ nom: 'Émulateur', cinqAdverse: false });
  let invitations = null;
  const arretInv = c.client.surInvitations((l) => (invitations = l));
  await a.client.inviter(id, c.joueur.uid);
  await attendre(() => invitations?.length === 1, 10000, 'invitation');
  await b.client.rejoindrePartie(code);
  await b.client.choisirSiege(id, 3);
  await a.client.ajouterIA(id, 1);
  await a.client.retirerIA(id, 1);
  await a.client.ajouterIA(id, 2);
  await c.client.accepterInvitation(id); // siège 1
  await attendre(() => invitations.length === 0, 10000, 'invitation acceptée');
  arretInv();
  // Partie annexe : refus d'invitation, départ, suppression par l'hôte.
  const annexe = await b.client.creerPartie({});
  await b.client.inviter(annexe.id, a.joueur.uid);
  await a.client.refuserInvitation(annexe.id);
  await c.client.rejoindrePartie(annexe.code);
  await c.client.quitterPartie(annexe.id);
  await b.client.quitterPartie(annexe.id);

  await a.client.lancerPartie(id);
  const listes = clients.map(() => null);
  const arrets = clients.map((x, i) => x.client.surMesParties((l) => (listes[i] = l)));

  const sessions = [];
  const vues = [];
  for (let i = 0; i < 3; i++) {
    const s = await clients[i].client.ouvrirSession(id);
    sessions.push(s);
    ouvertes.push(s);
    s.abonner((v) => (vues[i] = v));
  }
  assert.deepEqual(vues.map((v) => v.siege), [0, 3, 1]);

  const debut = Date.now();
  while (!vues.every((v) => v.etat.phase === 'fini')) {
    assert.ok(Date.now() - debut < 580000, `partie trop longue (coup ${vues[0].etat.numCoup}, donne ${vues[0].etat.donne})`);
    let agi = false;
    for (let i = 0; i < 3 && !agi; i++) {
      const v = vues[i];
      const { etat } = v;
      try {
        if (etat.phase === 'echange' && !etat.echanges[v.siege] && !v.don) {
          await sessions[i].donner(v.main[0]);
          agi = true;
        } else if (etat.phase === 'jeu' && etat.tour === v.siege) {
          const coups = coupsLegauxMain(etat, v.siege, v.main);
          await sessions[i].jouer(coupGlouton(etat, v.siege, coups, clients[i].rng));
          agi = true;
        }
      } catch (err) {
        if (!/pas ton tour|déjà donné|pas le moment|terminée/.test(err.message)) throw err;
      }
    }
    if (!agi) await new Promise((r) => setTimeout(r, 5));
  }
  const fin = vues[0].etat;
  assert.ok(fin.gagnant === 0 || fin.gagnant === 1);
  assert.ok(fin.donne >= 3, 'au moins un remélange');
  await attendre(() => listes.every((l) => l?.find((r) => r.id === id)?.statut === 'finie'), 20000, 'liste');
  // Statistiques (mise à jour vérifiée par les règles).
  const { fs } = modules();
  // Analyse de fin de partie : toutes les donnes passées se relisent (règles comprises) et
  // l'historique rejoue la partie à l'identique.
  for (const s of sessions) {
    const an = await s.donneesAnalyse();
    assert.equal(an.donnes.length, fin.donne + 1);
    assert.ok(an.donnes.every((x) => x.distribuees.length >= 4 && x.donnee && x.recue));
    let et = etatInitial(an.reglages);
    for (const h of an.historique) {
      while (et.phase === 'echange') et = marquerEchange(et, et.echanges.indexOf(false));
      et = appliquerCoup(et, h.siege, h.coup);
    }
    assert.deepEqual(et.pions, fin.pions);
    assert.equal(et.gagnant, fin.gagnant);
  }
  for (const x of clients) {
    let stats = null;
    const debutStats = Date.now();
    while (Date.now() - debutStats < 20000) {
      const d = await fs.getDoc(fs.doc(x.services.db, 'joueurs', x.joueur.uid));
      stats = d.data().stats;
      if (stats.jouees === 1) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.equal(stats.jouees, 1);
  }
  sessions.forEach((s) => s.fermer());
  arrets.forEach((f) => f());
  partage = { id, uids: clients.map((x) => x.joueur.uid) }; // a : siège 0, c : siège 1, b : siège 3
  console.log(`# émulateur : partie ${id} finie, donne ${fin.donne}, coup ${fin.numCoup}`);
});

test('émulateur : les règles refusent la triche', { skip: !actif && 'émulateur absent', timeout: 120000 }, async () => {
  const e = await environnement();
  const { rut, fs } = modules();
  const { assertFails, assertSucceeds } = rut;
  const { doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection, query, where, limit, orderBy, writeBatch, serverTimestamp } = fs;
  await e.clearFirestore();
  const contextes = new Map();
  const db = (uid) => {
    if (!contextes.has(uid)) contextes.set(uid, e.authenticatedContext(uid).firestore());
    return contextes.get(uid);
  };
  const A = 'alice', B = 'bruno', C = 'chloe', X = 'intrus';

  // Fiches.
  for (const [u, p] of [[A, 'Alice'], [B, 'Bruno'], [C, 'Chloé'], [X, 'Intrus']]) {
    await assertSucceeds(setDoc(doc(db(u), 'joueurs', u), { pseudo: p, visible: true, recherche: p.toLowerCase(), stats: { jouees: 0, gagnees: 0 }, comptees: [], creeLe: serverTimestamp() }));
  }
  await assertFails(setDoc(doc(db(X), 'joueurs', A), { pseudo: 'Pirate', visible: true, stats: { jouees: 0, gagnees: 0 }, comptees: [], creeLe: serverTimestamp() }));
  await assertFails(updateDoc(doc(db(A), 'joueurs', A), { stats: { jouees: 10, gagnees: 10 } }));
  await assertFails(updateDoc(doc(db(A), 'joueurs', A), { verrouille: true }));
  await assertFails(getDocs(query(collection(db(A), 'joueurs'), where('recherche', '>=', ''), orderBy('recherche'))));
  await assertSucceeds(getDocs(query(collection(db(A), 'joueurs'), where('recherche', '>=', ''), orderBy('recherche'), limit(10))));
  await e.withSecurityRulesDisabled((ctx) => updateDoc(doc(ctx.firestore(), 'joueurs', B), { verrouille: true }));
  await assertFails(updateDoc(doc(db(B), 'joueurs', B), { pseudo: 'Autre' }));
  await assertFails(updateDoc(doc(db(B), 'joueurs', B), { verrouille: false }));
  await assertSucceeds(updateDoc(doc(db(B), 'joueurs', B), { visible: true, icone: 'lapin' }));

  // Partie : création valide, puis tentatives.
  const id = 'ABCDEF';
  const base = {
    nom: 'Triche', code: id, hote: A, statut: 'attente', reglages: { cinqAdverse: false },
    joueurs: [{ uid: A, pseudo: 'Alice', ia: false }, null, null, null], uids: [A],
    invites: [], pseudosInvites: {}, refus: [], historique: [], enAttente: [],
    creeLe: serverTimestamp(), majLe: serverTimestamp(),
  };
  await assertFails(setDoc(doc(db(B), 'parties', id), base)); // hôte usurpé
  await assertFails(setDoc(doc(db(A), 'parties', 'ABCDE0'), { ...base, code: 'ABCDE0' })); // code hors alphabet
  await assertFails(setDoc(doc(db(A), 'parties', id), { ...base, joueurs: [{ uid: A, pseudo: 'Faux', ia: false }, null, null, null] }));
  await assertSucceeds(setDoc(doc(db(A), 'parties', id), base));
  const ref = (u) => doc(db(u), 'parties', id);
  const pB = { uid: B, pseudo: 'Bruno', ia: false };
  const pC = { uid: C, pseudo: 'Chloé', ia: false };
  const ia = { uid: null, pseudo: 'IA Ouest', ia: true };
  // Rejoindre en prenant la place de l'hôte, ou sans s'ajouter à uids : refusé.
  await assertFails(updateDoc(ref(B), { joueurs: [pB, null, null, null], uids: [A, B], majLe: serverTimestamp() }));
  await assertFails(updateDoc(ref(B), { joueurs: [base.joueurs[0], pB, null, null], majLe: serverTimestamp() }));
  await assertFails(updateDoc(ref(B), { joueurs: [base.joueurs[0], pB, null, ia], uids: [A, B], majLe: serverTimestamp() })); // IA par un non-hôte
  await assertSucceeds(updateDoc(ref(B), { joueurs: [base.joueurs[0], pB, null, null], uids: [A, B], majLe: serverTimestamp() }));
  await assertSucceeds(updateDoc(ref(C), { joueurs: [base.joueurs[0], pB, pC, null], uids: [A, B, C], majLe: serverTimestamp() }));
  await assertFails(updateDoc(ref(C), { joueurs: [base.joueurs[0], null, pC, null], uids: [A, C], majLe: serverTimestamp() })); // expulser B
  await assertFails(updateDoc(ref(B), { invites: [X], pseudosInvites: { [X]: 'Intrus' }, majLe: serverTimestamp() })); // inviter sans être hôte
  await assertFails(updateDoc(ref(A), { invites: [B], pseudosInvites: { [B]: 'Bruno' }, majLe: serverTimestamp() })); // inviter un membre
  await assertSucceeds(updateDoc(ref(A), { invites: [X], pseudosInvites: { [X]: 'Intrus' }, majLe: serverTimestamp() }));
  await assertSucceeds(getDoc(ref(X))); // l'invité lit la partie
  // Niveau des IA : inconnu refusé ; place sans niveau (parties d'avant) acceptée ; l'hôte seul le change.
  await assertFails(updateDoc(ref(A), { joueurs: [base.joueurs[0], pB, pC, { ...ia, niveau: 'invincible' }], majLe: serverTimestamp() }));
  await assertFails(updateDoc(ref(A), { joueurs: [base.joueurs[0], pB, pC, { ...ia, niveau: 3 }], majLe: serverTimestamp() }));
  await assertSucceeds(updateDoc(ref(A), { joueurs: [base.joueurs[0], pB, pC, ia], majLe: serverTimestamp() }));
  await assertSucceeds(updateDoc(ref(A), { joueurs: [base.joueurs[0], pB, pC, { ...ia, niveau: 'debutant' }], majLe: serverTimestamp() }));
  await assertFails(updateDoc(ref(B), { joueurs: [base.joueurs[0], pB, pC, { ...ia, niveau: 'expert' }], majLe: serverTimestamp() }));
  await assertFails(updateDoc(ref(A), { joueurs: [base.joueurs[0], pB, pC, { ...ia, niveau: 'maitre' }], majLe: serverTimestamp() }));
  await assertSucceeds(updateDoc(ref(A), { joueurs: [base.joueurs[0], pB, pC, ia], majLe: serverTimestamp() }));
  await assertFails(updateDoc(ref(B), { statut: 'encours', majLe: serverTimestamp() })); // lancer sans être hôte
  await assertFails(deleteDoc(ref(B)));

  // Lancement par le vrai client logique serait trop long à rejouer ici : on écrit le lancement à la main.
  const { distribuerCycle } = await import('../public/js/moteur/index.js');
  const etat0 = etatInitial({});
  const cycle = distribuerCycle(generateurAleatoire(4));
  const lancer = writeBatch(db(A));
  for (let d = 0; d < 3; d++) for (let s = 0; s < 4; s++) lancer.set(doc(db(A), 'parties', id, 'donnes', `${d}_${s}`), { donne: d, siege: s, cartes: cycle[d][s] });
  lancer.update(ref(A), { statut: 'encours', etat: etat0, historique: [], enAttente: [A, B, C], invites: [], majLe: serverTimestamp() });
  await assertSucceeds(lancer.commit());
  await assertFails(getDoc(ref(X))); // non-membre : partie en cours illisible
  await assertFails(updateDoc(ref(A), { joueurs: [base.joueurs[0], pB, pC, { ...ia, niveau: 'debutant' }], majLe: serverTimestamp() })); // figé après le lancement
  await assertFails(getDocs(query(collection(db(X), 'parties'), where('uids', 'array-contains', A))));
  await assertSucceeds(getDocs(query(collection(db(A), 'parties'), where('uids', 'array-contains', A))));

  // Mains : la sienne oui ; celle d'un autre humain, d'une donne future : non ; celle de l'IA : oui.
  const main = (u, cle) => doc(db(u), 'parties', id, 'donnes', cle);
  await assertSucceeds(getDoc(main(A, '0_0')));
  await assertFails(getDoc(main(A, '0_1')));
  await assertFails(getDoc(main(A, '1_0')));
  await assertSucceeds(getDoc(main(A, '0_3')));
  await assertFails(getDoc(main(X, '0_3')));
  await assertFails(setDoc(main(A, '0_0'), { donne: 0, siege: 0, cartes: ['AP', 'RP', 'AC', 'RC', 'AK'] }));
  await assertFails(deleteDoc(main(A, '0_0')));
  await assertFails(setDoc(main(A, '3_0'), { donne: 3, siege: 0, cartes: ['AP', 'RP', 'AC', 'RC', 'AK'] })); // hors début de cycle

  // Don : carte hors de la main refusée ; la sienne acceptée ; pas de don pour un autre humain.
  const donner = (u, s, carte) => {
    const lot = writeBatch(db(u));
    lot.set(doc(db(u), 'parties', id, 'dons', `0_${s}`), { donne: 0, de: s, pour: (s + 2) % 4, carte });
    lot.update(ref(u), { etat: marquerEchange(etat0, s), enAttente: [A, B, C], majLe: serverTimestamp() });
    return lot.commit();
  };
  await assertFails(donner(A, 0, cycle[0][1][0]));
  await assertFails(donner(A, 1, cycle[0][1][0]));
  await assertSucceeds(donner(A, 0, cycle[0][0][0]));
  await assertFails(getDoc(doc(db(C), 'parties', id, 'dons', '0_0'))); // destinataire, échange pas fini

  // Coup : pas son tour, numéro de coup sauté, joueurs modifiés : refusés.
  let etat = marquerEchange(etat0, 0);
  const lot2 = writeBatch(db(B));
  lot2.set(doc(db(B), 'parties', id, 'dons', '0_1'), { donne: 0, de: 1, pour: 3, carte: cycle[0][1][0] });
  lot2.update(ref(B), { etat: marquerEchange(etat, 1), enAttente: [C], majLe: serverTimestamp() });
  await assertSucceeds(lot2.commit());
  etat = marquerEchange(etat, 1);
  const lot3 = writeBatch(db(C));
  lot3.set(doc(db(C), 'parties', id, 'dons', '0_2'), { donne: 0, de: 2, pour: 0, carte: cycle[0][2][0] });
  lot3.update(ref(C), { etat: marquerEchange(etat, 2), enAttente: [], majLe: serverTimestamp() });
  await assertSucceeds(lot3.commit());
  etat = marquerEchange(etat, 2);
  const lot4 = writeBatch(db(C)); // C fait donner l'IA (siège 3)
  lot4.set(doc(db(C), 'parties', id, 'dons', '0_3'), { donne: 0, de: 3, pour: 1, carte: cycle[0][3][0] });
  lot4.update(ref(C), { etat: marquerEchange(etat, 3), enAttente: [A], majLe: serverTimestamp() });
  await assertSucceeds(lot4.commit());
  etat = marquerEchange(etat, 3);
  assert.equal(etat.phase, 'jeu');
  await assertSucceeds(getDoc(doc(db(C), 'parties', id, 'dons', '0_0'))); // échange fini : le destinataire lit
  await assertFails(getDoc(doc(db(B), 'parties', id, 'dons', '0_0'))); // ni donneur ni destinataire

  const mainA = cycle[0][0].filter((x) => x !== cycle[0][0][0]).concat([cycle[0][2][0]]);
  const coupA = { t: 'defausse', carte: mainA[0] };
  const etatDef = { ...etat, pile: etat.pile.concat([coupA.carte]), cartesRestantes: [4, 5, 5, 5], numCoup: etat.numCoup + 1, tour: 1, dernierCoup: { siege: 0, coup: coupA, captures: [], deplacements: [] } };
  const hist = [{ n: etatDef.numCoup, siege: 0, coup: coupA, captures: [] }];
  await assertFails(updateDoc(ref(B), { etat: etatDef, historique: hist, enAttente: [B], majLe: serverTimestamp() })); // pas le tour de B
  await assertFails(updateDoc(ref(A), { etat: { ...etatDef, numCoup: etatDef.numCoup + 1 }, historique: hist, enAttente: [B], majLe: serverTimestamp() }));
  await assertFails(updateDoc(ref(A), { etat: etatDef, historique: hist, enAttente: [B], joueurs: [base.joueurs[0], pB, pC, { ...ia, pseudo: 'Autre' }], majLe: serverTimestamp() }));
  await assertFails(updateDoc(ref(A), { etat: etatDef, historique: [], enAttente: [B], majLe: serverTimestamp() })); // historique non tenu
  // NB : la défausse est ici illégale selon le moteur (A a peut-être une carte jouable) ; les règles ne
  // peuvent pas le voir : c'est la limite assumée du modèle sans serveur.
  await assertSucceeds(updateDoc(ref(A), { etat: etatDef, historique: hist, enAttente: [B], majLe: serverTimestamp() }));

  // Statistiques : une partie non terminée ne se compte pas.
  await assertFails(updateDoc(doc(db(A), 'joueurs', A), { stats: { jouees: 1, gagnees: 1 }, comptees: [id] }));
  // Partie finie (forcée sans les règles) : le bon résultat seulement, une seule fois.
  await e.withSecurityRulesDisabled((ctx) => updateDoc(doc(ctx.firestore(), 'parties', id), { statut: 'finie', 'etat.phase': 'fini', 'etat.gagnant': 1 }));
  await assertFails(updateDoc(doc(db(A), 'joueurs', A), { stats: { jouees: 1, gagnees: 1 }, comptees: [id] })); // A (équipe 0) a perdu
  await assertSucceeds(updateDoc(doc(db(A), 'joueurs', A), { stats: { jouees: 1, gagnees: 0 }, comptees: [id] }));
  await assertFails(updateDoc(doc(db(A), 'joueurs', A), { stats: { jouees: 2, gagnees: 0 }, comptees: [id, id] }));
  await assertSucceeds(updateDoc(doc(db(B), 'joueurs', B), { stats: { jouees: 1, gagnees: 1 }, comptees: [id] }));
  await assertFails(updateDoc(ref(A), { statut: 'encours', majLe: serverTimestamp() })); // partie finie : figée
  await assertFails(deleteDoc(ref(A)));
});

test('émulateur : mode à 3 joueurs, partie complète et triche', { skip: !actif && 'émulateur absent', timeout: 600000 }, async () => {
  const e = await environnement();
  await e.clearFirestore();
  const { rut, fs } = modules();
  const { assertFails, assertSucceeds } = rut;
  const { doc, getDoc, updateDoc, setDoc, writeBatch, serverTimestamp } = fs;

  // 1. Partie complète 2 humains + 1 IA avec le vrai client (TOC_SANS_PARTIE=1 : seulement la triche).
  if (!process.env.TOC_SANS_PARTIE) {
  const clients = [];
  for (const nom of ['Alice', 'Bruno']) {
    const c = nouveauClient(40 + clients.length);
    c.joueur = await c.client.connecter(nom);
    clients.push(c);
  }
  const [a, b] = clients;
  const { id } = await a.client.creerPartie({ nom: 'Trio', nbJoueurs: 3 });
  await a.client.ajouterIA(id, 1);
  await b.client.rejoindrePartie(id);
  await a.client.lancerPartie(id);
  const sessions = [];
  const vues = [];
  for (let i = 0; i < 2; i++) {
    const s = await clients[i].client.ouvrirSession(id);
    sessions.push(s);
    ouvertes.push(s);
    s.abonner((v) => (vues[i] = v));
  }
  const debut = Date.now();
  while (!vues.every((v) => v.etat.phase === 'fini')) {
    assert.ok(Date.now() - debut < 580000, `partie trop longue (coup ${vues[0].etat.numCoup}, donne ${vues[0].etat.donne})`);
    let agi = false;
    for (let i = 0; i < 2 && !agi; i++) {
      const v = vues[i];
      const { etat } = v;
      try {
        if (etat.phase === 'echange' && !etat.echanges[v.siege] && !v.don) {
          await sessions[i].donner(v.main[0]);
          agi = true;
        } else if (etat.phase === 'jeu' && etat.tour === v.siege) {
          const coups = coupsLegauxMain(etat, v.siege, v.main);
          const joker = coups.find((c) => /^J[12]$/.test(c.carte) && c.t !== 'defausse');
          await sessions[i].jouer(joker || coupGlouton(etat, v.siege, coups, clients[i].rng));
          agi = true;
        }
      } catch (err) {
        if (!/pas ton tour|déjà donné|pas le moment|terminée/.test(err.message)) throw err;
      }
    }
    if (!agi) await new Promise((r) => setTimeout(r, 5));
  }
  const fin = vues[0].etat;
  assert.ok([0, 1, 2].includes(fin.gagnant));
  assert.ok(fin.donne >= 4, 'au moins un remélange');
  const an = await sessions[0].donneesAnalyse();
  assert.equal(an.donnes.length, fin.donne + 1);
  assert.ok(an.donnes.every((x) => x.donnee && x.recue));
  const rejeu = rejouerPartie(an.reglages, an.historique);
  assert.deepEqual(rejeu.etat.pions, fin.pions);
  for (const x of clients) {
    let stats = null;
    const t0 = Date.now();
    while (Date.now() - t0 < 20000) {
      stats = (await fs.getDoc(fs.doc(x.services.db, 'joueurs', x.joueur.uid))).data().stats;
      if (stats.jouees === 1) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.equal(stats.jouees, 1);
  }
  sessions.forEach((s) => s.fermer());
  console.log(`# émulateur à 3 : partie ${id} finie, donne ${fin.donne}, coup ${fin.numCoup}, gagnant ${fin.gagnant}`);
  }

  // 2. Triche à 3.
  const contextes = new Map();
  const db = (uid) => {
    if (!contextes.has(uid)) contextes.set(uid, e.authenticatedContext(uid).firestore());
    return contextes.get(uid);
  };
  const A = 'alice3', B = 'bruno3', C = 'chloe3';
  for (const [u, p] of [[A, 'Alice'], [B, 'Bruno'], [C, 'Chloé']]) {
    await assertSucceeds(setDoc(doc(db(u), 'joueurs', u), { pseudo: p, visible: true, recherche: p.toLowerCase(), stats: { jouees: 0, gagnees: 0 }, comptees: [], creeLe: serverTimestamp() }));
  }
  const code = 'TRAXYZ';
  const pA = { uid: A, pseudo: 'Alice', ia: false };
  const base = {
    nom: 'Triche à 3', code, hote: A, statut: 'attente', reglages: { cinqAdverse: false, nbJoueurs: 3 },
    joueurs: [pA, null, null], uids: [A], invites: [], pseudosInvites: {}, refus: [], historique: [], enAttente: [],
    creeLe: serverTimestamp(), majLe: serverTimestamp(),
  };
  await assertFails(setDoc(doc(db(A), 'parties', code), { ...base, reglages: { cinqAdverse: false, nbJoueurs: 4 } }));
  await assertFails(setDoc(doc(db(A), 'parties', code), { ...base, reglages: { cinqAdverse: false, nbJoueurs: 5 } }));
  await assertFails(setDoc(doc(db(A), 'parties', code), { ...base, joueurs: [pA, null, null, null] }));
  await assertFails(setDoc(doc(db(A), 'parties', code), { ...base, reglages: { cinqAdverse: false }, joueurs: [pA, null, null] }));
  await assertSucceeds(setDoc(doc(db(A), 'parties', code), base));
  const ref = (u) => doc(db(u), 'parties', code);
  const pB = { uid: B, pseudo: 'Bruno', ia: false };
  const pC = { uid: C, pseudo: 'Chloé', ia: false };
  const ia4 = { uid: null, pseudo: 'IA 4', ia: true };
  await assertFails(updateDoc(ref(A), { joueurs: [pA, null, null, ia4], majLe: serverTimestamp() })); // 4e siège
  await assertSucceeds(updateDoc(ref(B), { joueurs: [pA, pB, null], uids: [A, B], majLe: serverTimestamp() }));
  await assertSucceeds(updateDoc(ref(C), { joueurs: [pA, pB, pC], uids: [A, B, C], majLe: serverTimestamp() }));

  const { distribuerCycle } = await import('../public/js/moteur/index.js');
  const etat0 = etatInitial({ nbJoueurs: 3 });
  const cycle = distribuerCycle(generateurAleatoire(9), 3);
  const lancerAvec = (etat) => {
    const lot = writeBatch(db(A));
    for (let d = 0; d < 4; d++) for (let s = 0; s < 3; s++) lot.set(doc(db(A), 'parties', code, 'donnes', `${d}_${s}`), { donne: d, siege: s, cartes: cycle[d][s] });
    lot.update(ref(A), { statut: 'encours', etat, historique: [], enAttente: [A, B, C], invites: [], majLe: serverTimestamp() });
    return lot.commit();
  };
  await assertFails(lancerAvec(etatInitial({}))); // état à 4 dans une partie à 3
  await assertSucceeds(lancerAvec(etat0));
  await assertFails(updateDoc(ref(A), { 'etat.reglages.nbJoueurs': 4, majLe: serverTimestamp() }));

  // Don : au voisin de gauche à la donne 0 (siège 0 → 1), pas au « partenaire ».
  const donner = (u, s, pour, carte) => {
    const lot = writeBatch(db(u));
    lot.set(doc(db(u), 'parties', code, 'dons', `0_${s}`), { donne: 0, de: s, pour, carte });
    lot.update(ref(u), { etat: marquerEchange(etat0, s), enAttente: [B, C], majLe: serverTimestamp() });
    return lot.commit();
  };
  await assertFails(donner(A, 0, 2, cycle[0][0][0]));
  await assertSucceeds(donner(A, 0, 1, cycle[0][0][0]));
  await assertFails(getDoc(doc(db(B), 'parties', code, 'dons', '0_0'))); // échange pas fini
  let etat = marquerEchange(etat0, 0);
  for (const [u, s, pour] of [[B, 1, 2], [C, 2, 0]]) {
    const lot = writeBatch(db(u));
    lot.set(doc(db(u), 'parties', code, 'dons', `0_${s}`), { donne: 0, de: s, pour, carte: cycle[0][s][0] });
    lot.update(ref(u), { etat: marquerEchange(etat, s), enAttente: [], majLe: serverTimestamp() });
    await assertSucceeds(lot.commit());
    etat = marquerEchange(etat, s);
  }
  assert.equal(etat.phase, 'jeu');
  await assertSucceeds(getDoc(doc(db(B), 'parties', code, 'dons', '0_0'))); // destinataire
  await assertFails(getDoc(doc(db(C), 'parties', code, 'dons', '0_0'))); // le troisième
  await assertFails(getDoc(doc(db(A), 'parties', code, 'donnes', '0_1')));
  await assertFails(getDoc(doc(db(A), 'parties', code, 'donnes', '1_0'))); // donne future
  await assertFails(setDoc(doc(db(A), 'parties', code, 'donnes', '4_0'), { donne: 4, siege: 0, cartes: cycle[0][0] }));

  // Coup du siège 0 (défausse fabriquée) : tour suivant = 1 (modulo 3), jokers conservés.
  const c0 = { t: 'defausse', carte: cycle[0][0][1] };
  const apres = { ...etat, pile: [c0.carte], cartesRestantes: [4, 5, 5], numCoup: etat.numCoup + 1, tour: 1, dernierCoup: { siege: 0, coup: c0, captures: [], deplacements: [] } };
  const hist = [{ n: apres.numCoup, siege: 0, coup: c0, captures: [] }];
  await assertFails(updateDoc(ref(A), { etat: { ...apres, tour: 2 }, historique: hist, enAttente: [B], majLe: serverTimestamp() }));
  await assertFails(updateDoc(ref(A), { etat: { ...apres, jokers: { J3: '9' } }, historique: hist, enAttente: [B], majLe: serverTimestamp() }));
  await assertFails(updateDoc(ref(B), { etat: apres, historique: hist, enAttente: [B], majLe: serverTimestamp() }));
  await assertSucceeds(updateDoc(ref(A), { etat: apres, historique: hist, enAttente: [B], majLe: serverTimestamp() }));

  // Statistiques à 3 : seul le siège gagnant compte une victoire.
  await e.withSecurityRulesDisabled((ctx) => updateDoc(doc(ctx.firestore(), 'parties', code), { statut: 'finie', 'etat.phase': 'fini', 'etat.gagnant': 2 }));
  await assertFails(updateDoc(doc(db(A), 'joueurs', A), { stats: { jouees: 1, gagnees: 1 }, comptees: [code] }));
  await assertSucceeds(updateDoc(doc(db(A), 'joueurs', A), { stats: { jouees: 1, gagnees: 0 }, comptees: [code] }));
  await assertSucceeds(updateDoc(doc(db(C), 'joueurs', C), { stats: { jouees: 1, gagnees: 1 }, comptees: [code] }));
});

test.after(async () => {
  if (env) await env.cleanup();
  if (M) for (const app of M.appMod.getApps()) await M.appMod.deleteApp(app).catch(() => {});
});
