// Historique des parties contre l'IA terminées et bilans de l'écran « Statistiques ».
import test from 'node:test';
import assert from 'node:assert/strict';
import { etatInitial, ALLEE } from '../public/js/moteur/index.js';
import {
  enregistrerPartieFinie, lirePartiesFinies, partieFinie, supprimerPartieFinie, bilanContreIA, bilanEnLigne,
  idPartie, MAX_COMPLETES, CLE_PARTIES_FINIES,
  partiesDuCompte, historiqueAEnvoyer, integrerHistoriqueCompte, lireRetirees,
} from '../public/js/ui/parties-finies.js';
import { fusionnerPartiesIA } from '../public/js/reseau/comptes.js';

/** Stockage en mémoire, avec une taille maximale facultative (pour simuler un stockage plein). */
function memoire(max = Infinity) {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => {
      if (v.length > max) throw new Error('plein');
      m.set(k, v);
    },
    removeItem: (k) => m.delete(k),
  };
}

/** Sauvegarde d'une partie finie : `gagnant` est l'équipe (à 4) ou le siège (à 3) ; `graine` la rend unique. */
function sauvegarde({ nb = 4, gagnant = 0, graine = 1, niveau = 'expert', fini = true } = {}) {
  const etat = etatInitial(nb === 3 ? { nbJoueurs: 3 } : {});
  const sieges = nb === 3 ? [gagnant] : [gagnant, gagnant + 2];
  for (const s of sieges) for (let k = 0; k < 4; k++) etat.pions[s * 4 + k] = ALLEE + k;
  if (fini) {
    etat.phase = 'fini';
    etat.gagnant = gagnant;
  }
  etat.donne = 3;
  const joueurs = [{ pseudo: 'Toi', ia: false }, { pseudo: 'Léo', ia: true, niveau }, { pseudo: 'Camille', ia: true, niveau }, { pseudo: 'Inès', ia: true, niveau }].slice(0, nb);
  const mains = Array.from({ length: nb }, (_, s) => [`${graine}-${s}`]);
  return { nom: 'Essai', joueurs, partie: { etat, historique: Array.from({ length: 40 + graine }, () => ({})), archives: [{ mains, dons: [] }] } };
}

test('une partie finie entre une seule fois dans l’historique, la plus récente en premier', () => {
  const st = memoire();
  assert.equal(enregistrerPartieFinie(sauvegarde({ fini: false }), 4, { stockage: st }), null, 'partie en cours : rien');
  const a = enregistrerPartieFinie(sauvegarde({ graine: 1 }), 4, { stockage: st, date: 1000 });
  assert.equal(enregistrerPartieFinie(sauvegarde({ graine: 1 }), 4, { stockage: st, date: 2000 }), a, 'même partie : même identifiant');
  const b = enregistrerPartieFinie(sauvegarde({ graine: 2, gagnant: 1 }), 4, { stockage: st, date: 3000 });
  const liste = lirePartiesFinies(st);
  assert.deepEqual(liste.map((p) => p.id), [b, a]);
  assert.equal(liste[1].date, 1000);
  assert.equal(liste[1].gagne, true);
  assert.equal(liste[0].gagne, false);
  assert.deepEqual(liste[0].gagnants, [1, 3]);
  assert.equal(liste[1].donnes, 4);
  assert.equal(liste[1].coups, 41);
  assert.ok(partieFinie(a, st).sauvegarde.partie.archives.length, 'gardée en entier pour l’analyse');
  supprimerPartieFinie(a, st);
  assert.deepEqual(lirePartiesFinies(st).map((p) => p.id), [b]);
  assert.equal(partieFinie(a, st), null);
});

test('à 3 joueurs : gagnée seulement si le siège 0 gagne ; identifiant distinct du jeu à 4', () => {
  const st = memoire();
  enregistrerPartieFinie(sauvegarde({ nb: 3, gagnant: 0, graine: 1 }), 3, { stockage: st });
  enregistrerPartieFinie(sauvegarde({ nb: 3, gagnant: 2, graine: 2 }), 3, { stockage: st });
  const [perdue, gagnee] = lirePartiesFinies(st);
  assert.equal(gagnee.gagne, true);
  assert.equal(perdue.gagne, false);
  assert.deepEqual(perdue.gagnants, [2]);
  assert.notEqual(idPartie(sauvegarde({ nb: 3 }), 3), idPartie(sauvegarde({ nb: 4 }), 4));
});

test('seules les dernières parties restent entières ; un stockage plein allège au lieu de perdre le bilan', () => {
  const st = memoire();
  for (let g = 1; g <= MAX_COMPLETES + 3; g++) enregistrerPartieFinie(sauvegarde({ graine: g }), 4, { stockage: st, date: g });
  const liste = lirePartiesFinies(st);
  assert.equal(liste.length, MAX_COMPLETES + 3);
  assert.equal(liste.filter((p) => p.sauvegarde).length, MAX_COMPLETES);
  assert.ok(liste.slice(0, MAX_COMPLETES).every((p) => p.sauvegarde), 'les plus récentes');
  // Stockage trop petit pour deux parties entières : la plus récente reste entière, l'autre garde son résumé.
  const une = JSON.stringify(sauvegarde({ graine: 1 })).length;
  const petit = memoire(une * 2 + 300); // deux résumés tiennent, pas deux parties entières
  enregistrerPartieFinie(sauvegarde({ graine: 1 }), 4, { stockage: petit, date: 1 });
  enregistrerPartieFinie(sauvegarde({ graine: 2 }), 4, { stockage: petit, date: 2 });
  const l2 = lirePartiesFinies(petit);
  assert.equal(l2.length, 2);
  assert.ok(l2[0].sauvegarde && !l2[1].sauvegarde);
  // Contenu illisible : liste vide, sans erreur.
  petit.setItem(CLE_PARTIES_FINIES, '{');
  assert.deepEqual(lirePartiesFinies(petit), []);
});

test('bilan contre l’IA : par mode et par niveau des adversaires', () => {
  const st = memoire();
  enregistrerPartieFinie(sauvegarde({ graine: 1, gagnant: 0, niveau: 'expert' }), 4, { stockage: st });
  enregistrerPartieFinie(sauvegarde({ graine: 2, gagnant: 1, niveau: 'expert' }), 4, { stockage: st });
  enregistrerPartieFinie(sauvegarde({ graine: 3, gagnant: 0, niveau: 'debutant' }), 4, { stockage: st });
  enregistrerPartieFinie(sauvegarde({ nb: 3, graine: 4, gagnant: 1, niveau: 'expert' }), 3, { stockage: st });
  const b = bilanContreIA(lirePartiesFinies(st));
  assert.equal(b.parties, 4);
  assert.equal(b.victoires, 2);
  const ligne = (nb, niveau) => b.lignes.find((l) => l.nb === nb && l.niveau === niveau);
  assert.deepEqual([ligne(4, 'expert').parties, ligne(4, 'expert').victoires], [2, 1]);
  assert.deepEqual([ligne(4, 'debutant').parties, ligne(4, 'debutant').victoires], [1, 1]);
  assert.deepEqual([ligne(3, 'expert').parties, ligne(3, 'expert').victoires], [1, 0]);
});

test('bilan en ligne : avec et contre chaque joueur humain, IA et parties en cours ignorées', () => {
  const H = (uid) => ({ uid, pseudo: uid.toUpperCase(), ia: false });
  const IA = { uid: null, pseudo: 'IA', ia: true };
  const parties = [
    // 2 contre 2, moi au siège 0 avec B (siège 2) contre C et une IA : gagnée.
    { statut: 'finie', nbJoueurs: 4, monSiege: 0, gagnant: 0, gagnants: [0, 2], joueurs: [H('a'), H('c'), H('b'), IA] },
    // moi au siège 1 avec C contre B et D : perdue.
    { statut: 'finie', nbJoueurs: 4, monSiege: 1, gagnant: 0, gagnants: [0, 2], joueurs: [H('b'), H('a'), H('d'), H('c')] },
    // 3 joueurs, moi au siège 2 : gagnée contre B et C.
    { statut: 'finie', nbJoueurs: 3, monSiege: 2, gagnant: 2, gagnants: [2], joueurs: [H('b'), H('c'), H('a')] },
    // en cours : ignorée.
    { statut: 'encours', nbJoueurs: 4, monSiege: 0, gagnant: null, gagnants: [], joueurs: [H('a'), H('b'), H('c'), H('d')] },
    // ancienne partie sans `gagnants` : on retombe sur `gagnant`.
    { statut: 'finie', nbJoueurs: 4, monSiege: 3, gagnant: 1, joueurs: [H('b'), IA, IA, H('a')] },
  ];
  const b = bilanEnLigne(parties);
  assert.equal(b.parties, 4);
  assert.equal(b.victoires, 3);
  const j = Object.fromEntries(b.joueurs.map((x) => [x.uid, x]));
  assert.deepEqual([j.b.avec, j.b.avecGagnees, j.b.contre, j.b.contreGagnees], [1, 1, 3, 2]);
  assert.deepEqual([j.c.avec, j.c.avecGagnees, j.c.contre, j.c.contreGagnees], [1, 0, 2, 2]);
  assert.deepEqual([j.d.avec, j.d.contre, j.d.contreGagnees], [0, 1, 0]);
  assert.equal(b.joueurs[0].uid, 'b', 'le joueur le plus souvent croisé en premier');
});

test('historique rattaché au compte : il suit d’un appareil à l’autre, les parties retirées ne reviennent pas', () => {
  // Le « compte » : ce que garde le serveur, fusionné comme le fait reseau/comptes.js.
  let compte = { parties: [], retirees: [] };
  const synchroniser = (uid, appareil) => {
    compte = fusionnerPartiesIA(compte, historiqueAEnvoyer(uid, appareil));
    return integrerHistoriqueCompte(compte, uid, appareil);
  };
  const telephone = memoire();
  const ordinateur = memoire();
  // Deux parties sur le téléphone (la première avant d'avoir un compte), une sur l'ordinateur.
  const a = enregistrerPartieFinie(sauvegarde({ graine: 1 }), 4, { stockage: telephone, date: 1000 });
  const b = enregistrerPartieFinie(sauvegarde({ graine: 2, gagnant: 1 }), 4, { stockage: telephone, date: 2000, uid: 'marie' });
  const c = enregistrerPartieFinie(sauvegarde({ nb: 3, graine: 3 }), 3, { stockage: ordinateur, date: 3000, uid: 'marie' });

  assert.equal(synchroniser('marie', telephone), true, 'la partie sans compte est rattachée');
  assert.equal(synchroniser('marie', ordinateur), true);
  assert.equal(synchroniser('marie', telephone), true);
  assert.equal(synchroniser('marie', telephone), false, 'rien de neuf : rien ne change');
  for (const appareil of [telephone, ordinateur]) {
    const liste = lirePartiesFinies(appareil);
    assert.deepEqual(liste.map((p) => p.id), [c, b, a], 'les trois parties, la plus récente en premier');
    assert.ok(liste.every((p) => p.uid === 'marie'));
    const bilan = bilanContreIA(liste);
    assert.deepEqual([bilan.parties, bilan.victoires], [3, 2], 'mêmes statistiques sur les deux appareils');
  }
  // L'analyse reste là où la partie a été jouée ; ailleurs, seul le résultat arrive.
  assert.ok(partieFinie(a, telephone).sauvegarde && !partieFinie(a, telephone).ailleurs);
  assert.ok(!partieFinie(a, ordinateur).sauvegarde && partieFinie(a, ordinateur).ailleurs);
  assert.ok(partieFinie(c, ordinateur).sauvegarde);
  // Le compte ne reçoit que des résumés.
  assert.ok(compte.parties.every((p) => !('sauvegarde' in p) && !('uid' in p) && !('ailleurs' in p)));

  // Retirée sur l'ordinateur : elle disparaît aussi du téléphone, et n'y revient pas.
  supprimerPartieFinie(a, ordinateur);
  synchroniser('marie', ordinateur);
  assert.equal(synchroniser('marie', telephone), true);
  assert.deepEqual(lirePartiesFinies(telephone).map((p) => p.id), [c, b]);
  assert.deepEqual(lireRetirees(telephone), [a]);
  assert.equal(enregistrerPartieFinie(sauvegarde({ graine: 1 }), 4, { stockage: telephone, date: 9000 }), a);
  assert.deepEqual(lirePartiesFinies(telephone).map((p) => p.id), [c, b], 'une partie retirée ne se réenregistre pas');
  synchroniser('marie', ordinateur);
  assert.deepEqual(compte.parties.map((p) => p.id), [c, b]);

  // Appareil partagé : Paul ne voit ni ne verse les parties de Marie ; sans compte, on voit tout l'appareil.
  const d = enregistrerPartieFinie(sauvegarde({ graine: 4 }), 4, { stockage: telephone, date: 4000, uid: 'paul' });
  assert.deepEqual(partiesDuCompte(lirePartiesFinies(telephone), 'paul').map((p) => p.id), [d]);
  assert.deepEqual(partiesDuCompte(lirePartiesFinies(telephone), 'marie').map((p) => p.id), [c, b]);
  assert.equal(partiesDuCompte(lirePartiesFinies(telephone), null).length, 3);
  assert.deepEqual(historiqueAEnvoyer('paul', telephone).parties.map((p) => p.id), [d]);
});

test('fusion des historiques : une fois chaque partie, forme contrôlée, retirées écartées', () => {
  const p = (id, date, plus = {}) => ({ id, date, nb: 4, gagne: true, gagnants: [0, 2], joueurs: [{ pseudo: 'Toi', ia: false }, { pseudo: 'Léo', ia: true, niveau: 'expert' }], donnes: 4, coups: 80, cinqAdverse: false, ...plus });
  const f = fusionnerPartiesIA(
    { parties: [p('a', 10), p('b', 30)], retirees: ['z'] },
    { parties: [p('a', 10, { gagne: false }), p('c', 20, { triche: 1, joueurs: [{ pseudo: 'x'.repeat(50), ia: 1, niveau: 'dieu' }] }), p('z', 40), { id: '', date: 5 }, null], retirees: ['y', 7] },
  );
  assert.deepEqual(f.parties.map((x) => x.id), ['b', 'c', 'a']);
  assert.equal(f.parties[2].gagne, true, 'déjà connue : la version du compte reste');
  assert.deepEqual(f.retirees, ['z', 'y']);
  const c = f.parties[1];
  assert.ok(!('triche' in c));
  assert.deepEqual(c.joueurs, [{ pseudo: 'x'.repeat(20), ia: true, niveau: null }]);
  assert.deepEqual(fusionnerPartiesIA(f, {}), f, 'stable');
});
