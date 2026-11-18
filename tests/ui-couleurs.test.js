import test from 'node:test';
import assert from 'node:assert/strict';
import { PIONS, COULEURS_PIONS, couleurSiege, couleurFonceeSiege, nomCouleur, couleursPartie, appliquerCouleurs, nomCouleurPartie } from '../public/js/ui/couleurs.js';
import { PALETTE, IDS_COULEURS, couleurDe, couleurValide, couleursDesSieges, couleursIndisponibles } from '../public/js/palette.js';

test('couleurs : bleu, rouge, jaune et vert d’origine (bois verni), forme gardée pour les puces', () => {
  assert.deepEqual(COULEURS_PIONS, ['#2f6fb5', '#c8372d', '#e6a91b', '#3f8f4f']);
  assert.deepEqual(PIONS.map((p) => p.nom), ['bleu', 'rouge', 'jaune', 'vert']);
  assert.equal(nomCouleur(3), 'vert');
  assert.equal(couleurSiege(2), 'var(--pion-2)');
  assert.equal(couleurFonceeSiege(1), 'var(--pion-1-fonce)');
  assert.equal(new Set(PIONS.map((p) => p.forme)).size, 4);
});

test('couleurs : la feuille de style définit les mêmes valeurs', async () => {
  const { readFile } = await import('node:fs/promises');
  const css = await readFile(new URL('../public/css/app.css', import.meta.url), 'utf8');
  COULEURS_PIONS.forEach((c, i) => assert.ok(css.includes(`--pion-${i}: ${c};`), `--pion-${i}`));
});

test('palette : dix couleurs distinctes, les quatre d’origine en tête', () => {
  assert.equal(PALETTE.length, 10);
  assert.deepEqual(IDS_COULEURS.slice(0, 4), ['bleu', 'rouge', 'jaune', 'vert']);
  for (const cle of ['id', 'nom', 'valeur', 'fonce']) assert.equal(new Set(PALETTE.map((c) => c[cle])).size, 10, cle);
  for (const c of PALETTE) {
    assert.match(c.id, /^[a-z]{3,12}$/);
    assert.match(c.valeur, /^#[0-9a-f]{6}$/);
    assert.match(c.fonce, /^#[0-9a-f]{6}$/);
    assert.ok(c.pluriel.startsWith(c.nom));
  }
  assert.ok(couleurValide('turquoise') && !couleurValide('fuchsia') && !couleurValide(null) && !couleurValide(3));
  assert.equal(couleurDe('inconnue').id, 'bleu');
});

test('palette : sans choix, les couleurs d’origine ; un choix est gardé, les autres places s’en distinguent', () => {
  const h = (couleur) => ({ pseudo: 'x', ia: false, ...(couleur ? { couleur } : {}) });
  const ia = { pseudo: 'IA', ia: true };
  assert.deepEqual(couleursDesSieges(null), ['bleu', 'rouge', 'jaune', 'vert']);
  assert.deepEqual(couleursDesSieges([h(), ia, ia, ia]), ['bleu', 'rouge', 'jaune', 'vert']);
  assert.deepEqual(couleursDesSieges([h(), ia, ia]), ['bleu', 'rouge', 'jaune']);
  assert.deepEqual(couleursDesSieges([h(), null, null], 3), ['bleu', 'rouge', 'jaune']);
  // Le joueur prend la couleur d'origine d'une IA : elle en change, les autres gardent la leur.
  assert.deepEqual(couleursDesSieges([h('rouge'), ia, ia, ia]), ['rouge', 'bleu', 'jaune', 'vert']);
  // Une couleur voisine (orange près du rouge et du jaune) écarte les couleurs d'origine qui prêteraient à confusion.
  assert.deepEqual(couleursDesSieges([h('orange'), ia, ia, ia]), ['orange', 'bleu', 'vert', 'rose']);
  assert.deepEqual(couleursDesSieges([h('rose'), h('gris'), ia, h('marron')]), ['rose', 'gris', 'jaune', 'marron']);
  // Même couleur choisie deux fois : la première place la garde ; choix inconnu : couleur d'office.
  assert.deepEqual(couleursDesSieges([h('vert'), h('vert'), h('fuchsia'), null]), ['vert', 'rouge', 'jaune', 'bleu']);
  // Toujours des couleurs toutes différentes, quels que soient les choix.
  for (const a of IDS_COULEURS) {
    for (const b of IDS_COULEURS) {
      const c = couleursDesSieges([h(a), ia, h(b), ia]);
      assert.equal(new Set(c).size, 4, `${a} ${b}`);
      assert.equal(c[0], a);
      if (b !== a) assert.equal(c[2], b);
      assert.ok(c.every(couleurValide));
    }
  }
  // Seules les couleurs choisies par les AUTRES joueurs sont prises (pas celles données d'office, ni la sienne).
  // Les places occupées sont servies avant les places libres : la couleur d'office d'une IA ne dépend pas d'elles.
  assert.deepEqual(couleursDesSieges([null, ia, h('rose'), h('turquoise')]), ['gris', 'jaune', 'rose', 'turquoise']);
  assert.equal(couleursDesSieges([null, ia, h('rose'), h('turquoise')])[1], couleursDesSieges([h('marron'), ia, h('rose'), h('turquoise')])[1]);
  // Une IA à qui l'on a choisi une couleur la garde, comme un joueur.
  assert.deepEqual(couleursDesSieges([h(), { ...ia, couleur: 'gris' }, ia, ia]), ['bleu', 'gris', 'jaune', 'vert']);
  assert.deepEqual(couleursIndisponibles([h('rose'), { ...ia, couleur: 'gris' }, h(), null], 2), ['rose', 'gris']);
  assert.deepEqual(couleursIndisponibles([h('rose'), ia, h('gris'), null], 0), ['gris']);
  assert.deepEqual(couleursIndisponibles([h('rose'), ia, h(), null], 2), ['rose']);
});

test('couleurs d’une partie : posées en variables CSS sur l’écran, nommées et accordées', () => {
  const pose = new Map();
  const el = { style: { setProperty: (nom, valeur) => pose.set(nom, valeur) } };
  const couleurs = couleursPartie([{ couleur: 'orange' }, { ia: true }, { couleur: 'turquoise' }, { ia: true }]);
  assert.deepEqual(couleurs, ['orange', 'violet', 'turquoise', 'gris']); // ni rouge ni jaune près de l'orange, ni bleu ni vert près du turquoise
  assert.equal(appliquerCouleurs(el, couleurs), couleurs);
  assert.equal(pose.get('--pion-0'), couleurDe('orange').valeur);
  assert.equal(pose.get('--pion-0-fonce'), couleurDe('orange').fonce);
  assert.equal(pose.get('--pion-2'), couleurDe('turquoise').valeur);
  assert.equal(pose.size, 8);
  assert.equal(nomCouleurPartie(couleurs, 1), 'violet');
  assert.equal(nomCouleurPartie(couleurs, 1, true), 'violets');
  assert.equal(nomCouleurPartie(couleurs, 0, true), 'orange'); // invariable
  assert.equal(nomCouleurPartie(undefined, 3), 'vert');
});
