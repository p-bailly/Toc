// Couche réseau : niveau de force des IA (enregistré, exposé, transmis à l'IA, parties anciennes).
import test from 'node:test';
import assert from 'node:assert/strict';
import { FauxServeur, attendre } from './outils-reseau/faux-magasin.js';
import { nouveauClient } from './outils-reseau/clients.js';
import { choisirCoup, choisirDon } from './outils-reseau/ia-simple.js';
import { NIVEAUX_IA } from '../public/js/reseau/commun.js';
import { coupsLegauxMain } from '../public/js/moteur/index.js';

/** IA de test qui note le niveau reçu pour chaque siège et chaque type d'action. */
function iaEspionne() {
  const recus = [];
  const noter = (type, a3, f) => (etat, siege, main, options = {}) => {
    recus.push({ type, a3, siege, niveau: options.niveau });
    return f(etat, siege, main, options);
  };
  return {
    recus,
    ia: {
      choisirDon: noter('don', false, choisirDon),
      choisirCoup: noter('coup', false, choisirCoup),
      choisirDon3: noter('don', true, choisirDon),
      choisirCoup3: noter('coup', true, choisirCoup),
    },
  };
}

test('niveau des IA : enregistré, exposé, modifiable par l’hôte, niveau inconnu refusé', async () => {
  const serveur = new FauxServeur();
  const a = nouveauClient(serveur);
  const b = nouveauClient(serveur, { graine: 2 });
  await a.client.connecter('Alice');
  await b.client.connecter('Bruno');
  const { id } = await a.client.creerPartie({});
  await a.client.ajouterIA(id, 1, 'debutant');
  await a.client.ajouterIA(id, 2); // défaut : champion
  await assert.rejects(a.client.ajouterIA(id, 3, 'invincible'), /Niveau d’IA inconnu/);
  assert.equal(serveur.get(`parties/${id}`).joueurs[3], null);
  let p = serveur.get(`parties/${id}`);
  assert.deepEqual(p.joueurs[1], { uid: null, pseudo: 'IA Est', ia: true, niveau: 'debutant' });
  assert.equal(p.joueurs[2].niveau, 'champion');

  await a.client.changerNiveauIA(id, 2, 'expert');
  assert.equal(serveur.get(`parties/${id}`).joueurs[2].niveau, 'expert');
  await assert.rejects(a.client.changerNiveauIA(id, 2, 'maitre'), /Niveau d’IA inconnu/);
  await assert.rejects(a.client.changerNiveauIA(id, 0, 'expert'), /pas tenu par une IA/);
  await b.client.rejoindrePartie(id);
  await assert.rejects(b.client.changerNiveauIA(id, 1, 'champion'), /créateur/);

  let resume = null;
  const arret = a.client.surPartie(id, (r) => (resume = r));
  await attendre(() => resume?.joueurs[1]?.niveau === 'debutant');
  assert.equal(resume.joueurs[2].niveau, 'expert');
  assert.equal('niveau' in resume.joueurs[0], false);
  arret();

  await a.client.lancerPartie(id);
  await assert.rejects(a.client.changerNiveauIA(id, 1, 'amateur'), /commencé/);
  for (const niveau of NIVEAUX_IA) assert.equal(typeof niveau, 'string');
});

for (const nb of [4, 3]) {
  test(`à ${nb} joueurs : chaque IA reçoit le niveau de sa place, pour les dons comme pour les coups`, { timeout: 120000 }, async () => {
    const serveur = new FauxServeur();
    const espion = iaEspionne();
    const a = nouveauClient(serveur, { ia: espion.ia });
    await a.client.connecter('Alice');
    const { id } = await a.client.creerPartie({ nbJoueurs: nb });
    const niveaux = nb === 4 ? { 1: 'debutant', 2: 'confirme', 3: 'expert' } : { 1: 'amateur', 2: 'champion' };
    for (const [s, n] of Object.entries(niveaux)) await a.client.ajouterIA(id, Number(s), n);
    await a.client.lancerPartie(id);
    const session = await a.client.ouvrirSession(id);
    let vue = session.vue();
    session.abonner((v) => (vue = v));
    for (const [s, n] of Object.entries(niveaux)) assert.equal(vue.joueurs[s].niveau, n);
    assert.equal('niveau' in vue.joueurs[0], false);
    // Jouer jusqu'à ce que chaque IA ait donné et joué au moins une fois.
    const t0 = Date.now();
    const vu = (type, s) => espion.recus.some((r) => r.type === type && r.siege === s);
    while (!Object.keys(niveaux).every((s) => vu('don', Number(s)) && vu('coup', Number(s)))) {
      assert.ok(Date.now() - t0 < 60000, 'les IA ne jouent pas');
      if (vue.etat.phase === 'echange' && !vue.don) await session.donner(vue.main[0]).catch(() => {});
      else if (vue.etat.phase === 'jeu' && vue.etat.tour === 0) await session.jouer(coupsLegauxMain(vue.etat, 0, vue.main)[0]).catch(() => {});
      else await new Promise((r) => setTimeout(r, 2));
    }
    for (const r of espion.recus) {
      assert.equal(r.niveau, niveaux[r.siege], `siège ${r.siege} (${r.type})`);
      assert.equal(r.a3, nb === 3, 'IA du bon mode');
    }
    session.fermer();
  });
}

test('partie d’avant les niveaux (place d’IA sans niveau) : acceptée, jouée en champion', { timeout: 60000 }, async () => {
  const serveur = new FauxServeur();
  const espion = iaEspionne();
  const a = nouveauClient(serveur, { ia: espion.ia });
  await a.client.connecter('Alice');
  const { id } = await a.client.creerPartie({});
  for (const s of [1, 2, 3]) await a.client.ajouterIA(id, s);
  // Ancienne forme : on retire le champ niveau des places d'IA, comme avant ce changement.
  const p = serveur.get(`parties/${id}`);
  serveur.set(`parties/${id}`, { ...p, joueurs: p.joueurs.map((j) => (j?.ia ? { uid: null, pseudo: j.pseudo, ia: true } : j)) });
  let resume = null;
  const arret = a.client.surPartie(id, (r) => (resume = r));
  await attendre(() => resume && !('niveau' in serveur.get(`parties/${id}`).joueurs[1]));
  assert.equal(resume.joueurs[1].niveau, 'champion');
  arret();
  await a.client.lancerPartie(id);
  const session = await a.client.ouvrirSession(id);
  assert.equal(session.vue().joueurs[2].niveau, 'champion');
  await attendre(() => espion.recus.length >= 3, 20000);
  assert.ok(espion.recus.every((r) => r.niveau === 'champion'));
  session.fermer();
});
