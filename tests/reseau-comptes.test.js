// Couche réseau : outils communs, comptes, fiches et annuaire (faux serveur en mémoire).
import test from 'node:test';
import assert from 'node:assert/strict';
import { FauxServeur, attendre } from './outils-reseau/faux-magasin.js';
import { nouveauClient } from './outils-reseau/clients.js';
import {
  identifiant,
  nouveauCode,
  normaliserCode,
  codeValide,
  calculerEnAttente,
  resumePartie,
  messageErreur,
  PSEUDO_VERROUILLE,
} from '../public/js/reseau/commun.js';
import { etatInitial, marquerEchange, generateurAleatoire } from '../public/js/moteur/index.js';

test('identifiant : sans accents, casse ni ponctuation (comme Scrabble)', () => {
  assert.equal(identifiant('Jean Luc'), 'jean-luc');
  assert.equal(identifiant('jean-luc'), 'jean-luc');
  assert.equal(identifiant('  Élodie '), 'elodie');
  assert.equal(identifiant('???'), '');
});

test("codes d'invitation : 6 caractères sans ambiguïté", () => {
  const rng = generateurAleatoire(3);
  for (let i = 0; i < 200; i++) {
    const c = nouveauCode(rng);
    assert.ok(codeValide(c), c);
    assert.doesNotMatch(c, /[01IOL]/);
  }
  assert.equal(normaliserCode(' abc-def '), 'ABCDEF');
  assert.equal(codeValide('ABC0EF'), false);
});

test('enAttente et ResumePartie', () => {
  const joueurs = [
    { uid: 'a', pseudo: 'A', ia: false },
    { uid: null, pseudo: 'IA Est', ia: true },
    { uid: 'c', pseudo: 'C', ia: false },
    { uid: 'd', pseudo: 'D', ia: false },
  ];
  let etat = etatInitial({});
  assert.deepEqual(calculerEnAttente(etat, joueurs), ['a', 'c', 'd']);
  etat = marquerEchange(etat, 0);
  assert.deepEqual(calculerEnAttente(etat, joueurs), ['c', 'd']);
  for (const s of [1, 2, 3]) etat = marquerEchange(etat, s);
  assert.equal(etat.phase, 'jeu');
  assert.deepEqual(calculerEnAttente(etat, joueurs), ['a']);
  const r = resumePartie('ABCDEF', { nom: 'N', code: 'ABCDEF', statut: 'encours', hote: 'a', reglages: {}, joueurs, uids: ['a', 'c', 'd'], etat, invites: [] }, 'a');
  assert.equal(r.monSiege, 0);
  assert.equal(r.aMoiDeJouer, true);
  assert.equal(resumePartie('X', { ...r, joueurs, etat, uids: [] }, 'c').aMoiDeJouer, false);
  assert.equal(messageErreur({ code: 'unavailable' }).includes('connexion'), true);
});

test('connecter : crée le compte et la fiche la première fois, puis rouvre le même', async () => {
  const serveur = new FauxServeur();
  const { client } = nouveauClient(serveur);
  const vus = [];
  const arret = client.surAuth((j) => vus.push(j));
  await attendre(() => vus.length > 0);
  assert.equal(vus[0], null);

  const j = await client.connecter('Jean Luc');
  assert.equal(j.pseudo, 'Jean Luc');
  assert.deepEqual(j.stats, { jouees: 0, gagnees: 0 });
  assert.equal(j.visible, true);
  assert.equal(j.verrouille, false);
  assert.equal(j.icone, null);
  const fiche = serveur.get(`joueurs/${j.uid}`);
  assert.equal(fiche.recherche, 'jean-luc');
  assert.ok(fiche.creeLe instanceof Date);
  assert.ok(serveur.comptes.has('jean-luc@joueurs.toc.pbailly.fr'));
  await attendre(() => vus.at(-1)?.uid === j.uid);
  assert.equal(vus.at(-1).pseudo, 'Jean Luc');

  // Même nom (autre graphie), autre appareil : même compte, fiche inchangée.
  const autre = nouveauClient(serveur);
  const j2 = await autre.client.connecter('jean-luc');
  assert.equal(j2.uid, j.uid);
  assert.equal(j2.pseudo, 'Jean Luc');

  await client.deconnecter();
  await attendre(() => vus.at(-1) === null);
  arret();

  await assert.rejects(client.connecter('?'), /lettres ou chiffres/);
  await assert.rejects(client.connecter('x'.repeat(21)), /20 caractères/);
});

test('connecter hors ligne : message clair', async () => {
  const serveur = new FauxServeur();
  const { client } = nouveauClient(serveur, { horsLigne: () => true });
  await assert.rejects(client.connecter('Paul'), /Pas de connexion/);
});

test('modifierProfil : pseudo, icône, visibilité ; pseudo verrouillé', async () => {
  const serveur = new FauxServeur();
  const { client } = nouveauClient(serveur);
  const j = await client.connecter('Marie');
  let m = await client.modifierProfil({ pseudo: 'Marie-Claire', icone: 'chat' });
  assert.equal(m.pseudo, 'Marie-Claire');
  assert.equal(m.icone, 'chat');
  assert.equal(serveur.get(`joueurs/${j.uid}`).recherche, 'marie-claire');
  m = await client.modifierProfil({ visible: false, icone: null });
  assert.equal(m.visible, false);
  assert.equal(m.icone, null);
  const f = serveur.get(`joueurs/${j.uid}`);
  assert.equal('recherche' in f, false);
  assert.equal('icone' in f, false);
  // Le nom de connexion ne change pas.
  const autre = nouveauClient(serveur);
  assert.equal((await autre.client.connecter('Marie')).uid, j.uid);

  serveur.set(`joueurs/${j.uid}`, { ...serveur.get(`joueurs/${j.uid}`), verrouille: true, pseudo: 'Joueuse 7' });
  await assert.rejects(client.modifierProfil({ pseudo: 'Autre' }), (e) => e.message === PSEUDO_VERROUILLE);
  m = await client.modifierProfil({ visible: true });
  assert.equal(m.verrouille, true);
  assert.equal(serveur.get(`joueurs/${j.uid}`).recherche, 'joueuse-7');
  await assert.rejects(client.modifierProfil({ icone: 'x'.repeat(13) }), /Icône/);
});

test('listerJoueurs et lireJoueur : visibles seulement, récents en tête, moi exclu, par pages de 10', async () => {
  const serveur = new FauxServeur();
  const moi = nouveauClient(serveur);
  const jm = await moi.client.connecter('Zoé');
  const uids = [];
  for (let i = 0; i < 23; i++) {
    const c = nouveauClient(serveur);
    const j = await c.client.connecter(`Joueur ${String(i).padStart(2, '0')}`);
    uids.push(j.uid);
    if (i === 5) await c.client.modifierProfil({ visible: false });
    if (i === 7) await c.client.modifierProfil({ icone: 'lapin' });
  }
  // Une partie avec Joueur 20 et Joueur 05 (invisible) : ils passent en tête.
  serveur.set('parties/AAAAAA', {
    statut: 'finie',
    majLe: new Date(),
    joueurs: [
      { uid: jm.uid, pseudo: 'Zoé', ia: false },
      { uid: uids[20], pseudo: 'Joueur 20', ia: false },
      { uid: uids[5], pseudo: 'Joueur 05', ia: false },
      { uid: null, pseudo: 'IA', ia: true },
    ],
    uids: [jm.uid, uids[20], uids[5]],
  });
  const liste = await moi.client.listerJoueurs();
  assert.equal(liste.length, 23); // 22 visibles + Joueur 05 (récent)
  assert.deepEqual(liste.slice(0, 2).map((j) => j.pseudo).sort(), ['Joueur 05', 'Joueur 20']);
  assert.ok(!liste.some((j) => j.uid === jm.uid));
  assert.equal(liste.filter((j) => j.uid === uids[20]).length, 1);
  assert.equal(liste.find((j) => j.uid === uids[7]).icone, 'lapin');

  const f = await moi.client.lireJoueur(uids[7]);
  assert.deepEqual(f, { uid: uids[7], pseudo: 'Joueur 07', icone: 'lapin' });
  assert.equal(await moi.client.lireJoueur('inconnu'), null);
});
