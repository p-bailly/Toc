// Parties contre l'IA rattachées au compte : la partie en cours et l'analyse suivent d'un appareil à l'autre.
// Deux « appareils » (deux stockages, deux clients du même compte) parlent au faux serveur en mémoire.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FauxServeur, attendre } from './outils-reseau/faux-magasin.js';
import { nouveauClient } from './outils-reseau/clients.js';
import { nouvellePartie, donnerCarte, jouerCoup, coupsLegauxMain, generateurAleatoire } from '../public/js/moteur/index.js';
import { enregistrerPartieFinie, lirePartiesFinies, partieFinie, supprimerPartieFinie, MAX_COMPLETES } from '../public/js/ui/parties-finies.js';
import {
  CLES_PARTIE_IA, synchroniserPartiesIA, partieFinieEntiere, stockageSuivi, lireSuivi, noterModification, compteEnAvance,
  envoyerPartieEnCours, recupererPartieEnCours, marquerPartieOuverte,
} from '../public/js/ui/synchro-ia.js';

function memoire() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => void m.set(k, String(v)), removeItem: (k) => void m.delete(k) };
}

/** Un appareil : son stockage, et l'appli connectée au compte (la fiche du joueur est tenue à jour par surAuth). */
async function appareil(serveur, nom, graine) {
  const { client } = nouveauClient(serveur, { graine });
  const app = { api: client, enLigne: () => true, joueur: null };
  const arret = client.surAuth((j) => (app.joueur = j));
  await client.connecter(nom);
  await attendre(() => app.joueur?.uid);
  return { app, stockage: memoire(), arret };
}

/** Partie jouée au hasard pendant `coups` coups (ou jusqu'au bout) : sauvegarde au format de SessionLocale. */
function sauvegarde(graine, coups = Infinity, nb = 4) {
  const rng = generateurAleatoire(graine);
  let p = nouvellePartie(nb === 3 ? { nbJoueurs: 3 } : {}, rng);
  for (let n = 0; n < coups && p.etat.phase !== 'fini'; ) {
    const e = p.etat;
    if (e.phase === 'echange') {
      for (let s = 0; s < e.echanges.length; s++) if (!p.etat.echanges[s]) p = donnerCarte(p, s, p.mains[s][0]);
    } else {
      const c = coupsLegauxMain(e, e.tour, p.mains[e.tour]);
      p = jouerCoup(p, e.tour, c[Math.floor(rng() * c.length)], rng);
      n++;
    }
  }
  const joueurs = [{ pseudo: 'Toi', ia: false }, { pseudo: 'IA Est', ia: true, niveau: 'expert' }, { pseudo: 'IA Partenaire', ia: true, niveau: 'expert' }, { pseudo: 'IA Ouest', ia: true, niveau: 'expert' }].slice(0, nb);
  return { nom: 'Entraînement', joueurs, partie: p };
}
const coupsDe = (stockage, nb = 4) => JSON.parse(stockage.getItem(CLES_PARTIE_IA[nb])).partie.historique.length;

test('partie en cours : envoyée au compte, reprise sur un autre appareil, la plus récente gagne', async () => {
  const serveur = new FauxServeur();
  const tel = await appareil(serveur, 'Marie', 1);
  const ordi = await appareil(serveur, 'marie', 2);
  assert.equal(ordi.app.joueur.uid, tel.app.joueur.uid);
  const uid = tel.app.joueur.uid;

  // Sur le téléphone : 10 coups joués, sauvegardés par la session (stockage suivi), puis envoyés au compte.
  const session = stockageSuivi(tel.app, 4, tel.stockage);
  session.setItem(CLES_PARTIE_IA[4], JSON.stringify(sauvegarde(5, 10)));
  assert.equal(lireSuivi(4, tel.stockage).uid, uid);
  assert.equal(await envoyerPartieEnCours(tel.app, 4, tel.stockage), true);
  assert.equal(await envoyerPartieEnCours(tel.app, 4, tel.stockage), false, 'rien de neuf : rien à envoyer');
  assert.ok(serveur.get(`joueurs/${uid}/prive/encours4`).json.includes('"historique"'));
  const date1 = lireSuivi(4, tel.stockage).date;

  // L'ordinateur l'apprend par la fiche du joueur, et la reprend (il n'avait rien).
  await attendre(() => ordi.app.joueur.enCoursIA[4] === date1);
  assert.equal(compteEnAvance(ordi.app, 4, ordi.stockage), true);
  assert.equal(await recupererPartieEnCours(ordi.app, 3, ordi.stockage), false, 'rien pour l’autre mode');
  assert.equal(await recupererPartieEnCours(ordi.app, 4, ordi.stockage), true);
  assert.equal(coupsDe(ordi.stockage), 10);
  assert.equal(await recupererPartieEnCours(ordi.app, 4, ordi.stockage), false, 'déjà à jour');
  assert.equal(await envoyerPartieEnCours(ordi.app, 4, ordi.stockage), false, 'reçue du compte : pas à renvoyer');

  // On continue sur l'ordinateur (20 coups) ; le téléphone, resté à 10, la reprend à son tour.
  stockageSuivi(ordi.app, 4, ordi.stockage).setItem(CLES_PARTIE_IA[4], JSON.stringify(sauvegarde(5, 20)));
  assert.equal(await envoyerPartieEnCours(ordi.app, 4, ordi.stockage), true);
  await attendre(() => tel.app.joueur.enCoursIA[4] > date1);
  // Tant que la partie est ouverte à l'écran du téléphone, on ne la remplace pas sous les doigts du joueur.
  marquerPartieOuverte(4, true);
  assert.equal(await recupererPartieEnCours(tel.app, 4, tel.stockage), false);
  marquerPartieOuverte(4, false);
  assert.equal(await recupererPartieEnCours(tel.app, 4, tel.stockage), true);
  assert.equal(coupsDe(tel.stockage), 20);

  // Nouvelle partie sur le téléphone (sauvegarde effacée) : c'est la plus récente, celle du compte ne revient pas.
  tel.stockage.removeItem(CLES_PARTIE_IA[4]);
  noterModification(4, uid, tel.stockage, Date.now, tel.app.joueur.enCoursIA[4]);
  assert.equal(compteEnAvance(tel.app, 4, tel.stockage), false);
  assert.equal(await recupererPartieEnCours(tel.app, 4, tel.stockage), false);
  session.setItem(CLES_PARTIE_IA[4], JSON.stringify(sauvegarde(9, 3)));
  assert.equal(await envoyerPartieEnCours(tel.app, 4, tel.stockage), true);
  await attendre(() => ordi.app.joueur.enCoursIA[4] === lireSuivi(4, tel.stockage).date);
  assert.equal(await recupererPartieEnCours(ordi.app, 4, ordi.stockage), true);
  assert.equal(coupsDe(ordi.stockage), 3);
  tel.arret();
  ordi.arret();
});

test('partie en cours : sauvegarde d’avant le suivi, appareil partagé, hors connexion', async () => {
  const serveur = new FauxServeur();
  const tel = await appareil(serveur, 'Marie', 1);
  const ordi = await appareil(serveur, 'Marie', 2);
  const paul = await appareil(serveur, 'Paul', 3);
  const uid = tel.app.joueur.uid;

  // Vieille sauvegarde sans suivi sur l'ordinateur : le compte n'a rien, elle lui est confiée.
  ordi.stockage.setItem(CLES_PARTIE_IA[4], JSON.stringify(sauvegarde(1, 6)));
  assert.equal(await envoyerPartieEnCours(ordi.app, 4, ordi.stockage), true);
  assert.equal(lireSuivi(4, ordi.stockage).uid, uid);
  // Le téléphone joue une autre partie, envoyée au compte.
  stockageSuivi(tel.app, 4, tel.stockage).setItem(CLES_PARTIE_IA[4], JSON.stringify(sauvegarde(2, 15)));
  assert.equal(await envoyerPartieEnCours(tel.app, 4, tel.stockage), true);
  // Un troisième appareil, avec une vieille sauvegarde sans suivi : elle n'écrase pas la partie du compte, elle est
  // remplacée par elle.
  const tablette = await appareil(serveur, 'Marie', 4);
  await attendre(() => tablette.app.joueur.enCoursIA[4] > 1);
  tablette.stockage.setItem(CLES_PARTIE_IA[4], JSON.stringify(sauvegarde(3, 4)));
  assert.equal(await envoyerPartieEnCours(tablette.app, 4, tablette.stockage), false);
  assert.equal(JSON.parse(serveur.get(`joueurs/${uid}/prive/encours4`).json).partie.historique.length, 15);
  assert.equal(await recupererPartieEnCours(tablette.app, 4, tablette.stockage), true);
  assert.equal(coupsDe(tablette.stockage), 15);

  // Appareil partagé : la partie de Marie n'est pas envoyée au compte de Paul.
  const partage = tablette.stockage;
  assert.equal(lireSuivi(4, partage).uid, uid);
  assert.equal(await envoyerPartieEnCours(paul.app, 4, partage), false);
  assert.equal(serveur.get(`joueurs/${paul.app.joueur.uid}/prive/encours4`), null);
  assert.equal(await recupererPartieEnCours(paul.app, 4, partage), false, 'Paul n’a pas de partie : celle de l’appareil reste');
  // Paul a une partie à lui (jouée ailleurs) : sur l'appareil partagé, c'est la sienne qu'il retrouve.
  stockageSuivi(paul.app, 4, paul.stockage).setItem(CLES_PARTIE_IA[4], JSON.stringify(sauvegarde(7, 8)));
  await envoyerPartieEnCours(paul.app, 4, paul.stockage);
  await attendre(() => paul.app.joueur.enCoursIA[4] > 0);
  assert.equal(await recupererPartieEnCours(paul.app, 4, partage), true);
  assert.equal(coupsDe(partage), 8);
  assert.equal(lireSuivi(4, partage).uid, paul.app.joueur.uid);

  // Sans compte ou sans réseau : rien ne part, rien n'arrive, et ça partira plus tard.
  const seul = { app: { api: tel.app.api, enLigne: () => true, joueur: null }, stockage: memoire() };
  stockageSuivi(seul.app, 3, seul.stockage).setItem(CLES_PARTIE_IA[3], JSON.stringify(sauvegarde(4, 5, 3)));
  assert.equal(lireSuivi(3, seul.stockage).uid, null);
  assert.equal(await envoyerPartieEnCours(seul.app, 3, seul.stockage), false);
  assert.equal(await envoyerPartieEnCours({ ...tel.app, enLigne: () => false }, 3, seul.stockage), false);
  assert.equal(await envoyerPartieEnCours(tel.app, 3, seul.stockage), true, 'jouée sans compte : le premier compte connecté la prend');
  assert.equal(JSON.parse(serveur.get(`joueurs/${uid}/prive/encours3`).json).partie.etat.pions.length, 12);
  for (const a of [tel, ordi, paul, tablette]) a.arret();
});

test('analyse : les parties récentes sont gardées en entier par le compte, analysables depuis un autre appareil', async () => {
  const serveur = new FauxServeur();
  const tel = await appareil(serveur, 'Marie', 1);
  const ordi = await appareil(serveur, 'Marie', 2);
  const uid = tel.app.joueur.uid;
  // Trois parties terminées sur le téléphone.
  const ids = [];
  for (let g = 1; g <= 3; g++) ids.push(enregistrerPartieFinie(sauvegarde(40 + g), 4, { stockage: tel.stockage, date: 1000 * g, uid }));
  assert.equal(new Set(ids).size, 3);
  await synchroniserPartiesIA(tel.app, tel.stockage);
  assert.deepEqual(serveur.get(`joueurs/${uid}/prive/partiesIA`).completes, [ids[2], ids[1], ids[0]]);
  assert.ok(lirePartiesFinies(tel.stockage).every((p) => p.auCompte && p.sauvegarde));
  const ecritures = serveur.journal.length;
  await synchroniserPartiesIA(tel.app, tel.stockage);
  assert.equal(serveur.journal.length, ecritures, 'déjà versées : rien de plus à écrire');

  // Sur l'ordinateur : les résultats arrivent, marqués analysables ; la sauvegarde vient du compte à la demande.
  assert.equal(await synchroniserPartiesIA(ordi.app, ordi.stockage), true);
  const vue = partieFinie(ids[0], ordi.stockage);
  assert.ok(vue.ailleurs && vue.auCompte && !vue.sauvegarde);
  const { sauvegarde: recue } = await partieFinieEntiere(ordi.app, ids[0], ordi.stockage);
  assert.deepEqual(recue, partieFinie(ids[0], tel.stockage).sauvegarde);
  assert.equal((await partieFinieEntiere({ ...ordi.app, joueur: null }, ids[0], ordi.stockage)).sauvegarde, null, 'sans compte : rien');

  // Retirée de l'historique : le compte ne la garde plus, ni en résumé ni en entier.
  supprimerPartieFinie(ids[0], ordi.stockage);
  await synchroniserPartiesIA(ordi.app, ordi.stockage);
  assert.equal(serveur.get(`joueurs/${uid}/prive/finie_${ids[0]}`), null);
  assert.deepEqual(serveur.get(`joueurs/${uid}/prive/partiesIA`).completes, [ids[2], ids[1]]);
  assert.equal((await partieFinieEntiere(ordi.app, ids[0], ordi.stockage)).sauvegarde, null);

  // Le compte ne garde en entier que les plus récentes : les anciennes sont effacées, leurs résultats restent.
  for (let g = 4; g <= MAX_COMPLETES + 2; g++) enregistrerPartieFinie(sauvegarde(40 + g, 30), 4, { stockage: ordi.stockage, date: 1000 * g, uid });
  assert.equal(lirePartiesFinies(ordi.stockage).filter((p) => p.sauvegarde).length, 0, 'parties non terminées : pas enregistrées');
  for (let g = 4; g <= MAX_COMPLETES + 2; g++) enregistrerPartieFinie(sauvegarde(40 + g), 4, { stockage: ordi.stockage, date: 1000 * g, uid });
  await synchroniserPartiesIA(ordi.app, ordi.stockage);
  const index = serveur.get(`joueurs/${uid}/prive/partiesIA`);
  assert.equal(index.parties.length, MAX_COMPLETES + 1);
  assert.equal(index.completes.length, MAX_COMPLETES);
  assert.ok(!index.completes.includes(ids[1]), 'la plus ancienne n’est plus gardée en entier');
  assert.equal(serveur.get(`joueurs/${uid}/prive/finie_${ids[1]}`), null);
  assert.equal(serveur.chemins(`joueurs/${uid}/prive/finie_`).length, MAX_COMPLETES);
  // Le téléphone, qui a encore cette vieille partie en entier, ne la reverse pas pour rien.
  const avant = serveur.journal.length;
  await synchroniserPartiesIA(tel.app, tel.stockage);
  assert.equal(serveur.journal.filter((e, i) => i >= avant && e.chemin.includes('finie_')).length, 0);
  assert.ok(partieFinie(ids[1], tel.stockage).sauvegarde && !partieFinie(ids[1], tel.stockage).auCompte);
  tel.arret();
  ordi.arret();
});
