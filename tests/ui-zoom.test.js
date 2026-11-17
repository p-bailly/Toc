// Zoom du plateau : l'échelle et le décalage restent dans les bornes, le point visé reste sous le doigt.
import test from 'node:test';
import assert from 'node:assert/strict';
import { bornerZoom, zoomerVers, ZOOM_MAX, ZOOM_DOUBLE } from '../public/js/ui/zoom-plateau.js';

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
