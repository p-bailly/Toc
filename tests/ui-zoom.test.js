// Zoom du plateau : l'échelle et le décalage restent dans les bornes, le point visé reste sous le doigt.
import test from 'node:test';
import assert from 'node:assert/strict';
import { bornerZoom, zoomerVers, facteurMolette, pasVersZoom, ZOOM_MAX, ZOOM_DOUBLE } from '../public/js/ui/zoom-plateau.js';

test('zoom : échelle entre 1 et le maximum, le plateau couvre toujours sa zone', () => {
  assert.deepEqual(bornerZoom({ k: 0.4, x: 30, y: -50 }, 400, 400), { k: 1, x: 0, y: 0 });
  assert.deepEqual(bornerZoom({ k: 9, x: 0, y: 0 }, 400, 400), { k: ZOOM_MAX, x: 0, y: 0 });
  // À l'échelle 2 sur 400 px, le décalage va de −400 (bord droit ou bas) à 0 (bord gauche ou haut).
  assert.deepEqual(bornerZoom({ k: 2, x: 50, y: -900 }, 400, 400), { k: 2, x: 0, y: -400 });
  assert.deepEqual(bornerZoom({ k: 2, x: -120, y: -30 }, 400, 300), { k: 2, x: -120, y: -30 });
  assert.deepEqual(bornerZoom({ k: 2, x: -120, y: -390 }, 400, 300), { k: 2, x: -120, y: -300 });
});

test('zoom : le point visé reste à la même place à l’écran', () => {
  const depart = { k: 1, x: 0, y: 0 };
  // Point de la zone (300, 100) : il montre le point (300, 100) du plateau ; après le zoom, toujours lui.
  const vise = zoomerVers(depart, ZOOM_DOUBLE, 300, 100);
  assert.deepEqual(vise, { k: 2, x: -300, y: -100 });
  const pointMontre = (e, px, py) => [(px - e.x) / e.k, (py - e.y) / e.k];
  assert.deepEqual(pointMontre(vise, 300, 100), [300, 100]);
  // En partant d'un plateau déjà agrandi et décalé.
  const avant = { k: 1.5, x: -80, y: -40 };
  const apres = zoomerVers(avant, 2.5, 210, 160);
  const [ax, ay] = pointMontre(avant, 210, 160);
  const [bx, by] = pointMontre(apres, 210, 160);
  assert.ok(Math.abs(ax - bx) < 1e-9 && Math.abs(ay - by) < 1e-9);
  // Revenir à 1 puis borner : le plateau entier, sans décalage.
  assert.deepEqual(bornerZoom(zoomerVers(apres, 1, 210, 160), 400, 400), { k: 1, x: 0, y: 0 });
});

test('zoom à la molette : vers le haut on agrandit, un cran fait un pas mesuré, quelle que soit l’unité', () => {
  const cran = facteurMolette({ deltaY: -100 });
  assert.ok(cran > 1.15 && cran < 1.4, `un cran : × ${cran.toFixed(2)}`);
  assert.ok(Math.abs(facteurMolette({ deltaY: 100 }) * cran - 1) < 1e-9, 'un cran dans l’autre sens ramène à la même échelle');
  // Firefox compte en lignes (3 par cran) : à peu près le même pas.
  assert.ok(Math.abs(facteurMolette({ deltaY: -3, deltaMode: 1 }) - cran) < 0.02);
  // Pincement sur un pavé tactile (Ctrl + molette, petits pas) : plus vif, pour suivre le geste.
  assert.ok(facteurMolette({ deltaY: -10, ctrlKey: true }) > facteurMolette({ deltaY: -10 }));
  assert.equal(facteurMolette({ deltaY: 0 }), 1);
  // De 1 à l'échelle maximale en quelques crans, sans la dépasser une fois bornée.
  let k = 1;
  let crans = 0;
  while (k < ZOOM_MAX && crans < 20) {
    k = bornerZoom({ k: k * cran, x: 0, y: 0 }, 400, 400).k;
    crans++;
  }
  assert.equal(k, ZOOM_MAX);
  assert.ok(crans >= 4 && crans <= 8, `${crans} crans jusqu’au maximum`);
});

test('zoom à la molette : Ctrl + cran de souris garde le même pas qu’un cran seul (pas de bond)', () => {
  assert.ok(Math.abs(facteurMolette({ deltaY: -100, ctrlKey: true }) - facteurMolette({ deltaY: -100 })) < 1e-12);
  assert.ok(facteurMolette({ deltaY: -100 }) < 1.3);
});

test('zoom à la molette : l’animation rejoint l’échelle visée en douceur, le point visé reste immobile', () => {
  let etat = { k: 1, x: 0, y: 0 };
  const point = [280, 120];
  const montre = (e) => [(point[0] - e.x) / e.k, (point[1] - e.y) / e.k];
  const avant = montre(etat);
  const echelles = [];
  for (let image = 0; image < 60 && etat.k !== 2; image++) {
    etat = pasVersZoom(etat, 2, ...point);
    echelles.push(etat.k);
    const [x, y] = montre(etat);
    assert.ok(Math.abs(x - avant[0]) < 1e-9 && Math.abs(y - avant[1]) < 1e-9, 'le point sous le pointeur ne bouge pas');
  }
  assert.equal(etat.k, 2, 'la cible est atteinte');
  assert.ok(echelles.length >= 8 && echelles.length <= 25, `${echelles.length} images`);
  // Chaque image avance un peu (pas de bond) : jamais plus de 25 % d'un coup.
  let precedente = 1;
  for (const k of echelles) {
    assert.ok(k > precedente && k / precedente < 1.25);
    precedente = k;
  }
});
