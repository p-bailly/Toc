// Première donne d'une partie : le hasard est un peu lissé, pour ne pas commencer sans rien pour sortir.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  distribuerCycle, distribuerPremierCycle, estCarteSortie, generateurAleatoire, nouvellePartie, paquetNeuf, taillesDonne,
} from '../public/js/moteur/index.js';

const sansSortie = (cycle) => cycle[0].map((main) => !main.some(estCarteSortie));

test('première donne : as et rois font sortir, pas les jokers', () => {
  assert.deepEqual(paquetNeuf(4).filter(estCarteSortie).length, 8);
  assert.deepEqual(paquetNeuf(3).filter(estCarteSortie).length, 8);
  assert.ok(estCarteSortie('AC') && estCarteSortie('RP') && !estCarteSortie('DC') && !estCarteSortie('10K') && !estCarteSortie('J1'));
});

test('première donne à 4 : aucune équipe sans as ni roi, le paquet reste entier', () => {
  let joueursSans = 0;
  let joueursSansSimple = 0;
  let equipesSansSimple = 0;
  const N = 1500;
  for (let graine = 1; graine <= N; graine++) {
    const cycle = distribuerPremierCycle(generateurAleatoire(graine), 4);
    // Trois donnes de 5, 4 et 4 cartes par joueur : les 52 cartes, une fois chacune.
    assert.deepEqual(cycle.map((d) => d.map((m) => m.length)), taillesDonne(4).map((t) => Array(4).fill(t)));
    assert.deepEqual(cycle.flat(2).sort(), paquetNeuf(4).sort());
    const sans = sansSortie(cycle);
    assert.ok(!(sans[0] && sans[2]) && !(sans[1] && sans[3]), `équipe sans sortie (graine ${graine})`);
    joueursSans += sans.filter(Boolean).length;
    const simple = sansSortie(distribuerCycle(generateurAleatoire(graine), 4));
    joueursSansSimple += simple.filter(Boolean).length;
    equipesSansSimple += (simple[0] && simple[2] ? 1 : 0) + (simple[1] && simple[3] ? 1 : 0);
  }
  // Un mélange simple laisse une équipe sans sortie dans 15 % des cas environ, et un joueur dans 42 %.
  assert.ok(equipesSansSimple / (2 * N) > 0.1);
  // Lissé « un peu » : un joueur seul peut encore en manquer (son partenaire peut lui en donner un), mais moins souvent.
  assert.ok(joueursSans > 0.25 * 4 * N && joueursSans < 0.9 * joueursSansSimple, `${joueursSans} contre ${joueursSansSimple}`);
});

test('première donne à 3 : le meilleur de deux mélanges, le paquet reste entier', () => {
  let sans = 0;
  let sansSimple = 0;
  const N = 1500;
  for (let graine = 1; graine <= N; graine++) {
    const cycle = distribuerPremierCycle(generateurAleatoire(graine), 3);
    assert.deepEqual(cycle.map((d) => d.map((m) => m.length)), taillesDonne(3).map((t) => Array(3).fill(t)));
    assert.deepEqual(cycle.flat(2).sort(), paquetNeuf(3).sort());
    sans += sansSortie(cycle).filter(Boolean).length;
    sansSimple += sansSortie(distribuerCycle(generateurAleatoire(graine), 3)).filter(Boolean).length;
  }
  // Jamais pire que le premier mélange (celui d'un tirage simple à la même graine), et nettement mieux en moyenne.
  assert.ok(sans > 0 && sans < 0.8 * sansSimple, `${sans} contre ${sansSimple}`);
});

test('première donne : une nouvelle partie s’en sert, la même graine redonne la même partie', () => {
  for (let graine = 1; graine <= 300; graine++) {
    const partie = nouvellePartie({}, generateurAleatoire(graine));
    const sans = partie.mains.map((main) => !main.some(estCarteSortie));
    assert.ok(!(sans[0] && sans[2]) && !(sans[1] && sans[3]));
    assert.deepEqual(partie.mains, nouvellePartie({}, generateurAleatoire(graine)).mains);
    assert.deepEqual(partie.cycle, distribuerPremierCycle(generateurAleatoire(graine), 4));
  }
});
