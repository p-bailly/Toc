// La page Règles de l'appli (« Le Toc en une page ») est générée par outils/regles/construire.mjs : ses schémas
// sortent du moteur. Ce test relance le générateur et vérifie que les fichiers servis sont à jour ; il échoue
// aussi si un exemple illustré n'est plus conforme aux règles (le générateur contrôle chacun avec le moteur).
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const RACINE = new URL('..', import.meta.url).pathname;

test('la page Règles servie est celle que produit le générateur', () => {
  const sortie = mkdtempSync(join(tmpdir(), 'toc-regles-'));
  try {
    mkdirSync(join(sortie, 'js/ui'), { recursive: true });
    mkdirSync(join(sortie, 'css'), { recursive: true });
    execFileSync(process.execPath, [join(RACINE, 'outils/regles/construire.mjs')], { env: { ...process.env, SORTIE_APPLI: sortie }, stdio: 'pipe' });
    for (const fichier of ['js/ui/regles-page.js', 'css/regles.css']) {
      assert.equal(
        readFileSync(join(RACINE, 'public', fichier), 'utf8'),
        readFileSync(join(sortie, fichier), 'utf8'),
        `${fichier} n'est pas à jour : lance « SORTIE_APPLI=public node outils/regles/construire.mjs ».`,
      );
    }
  } finally {
    rmSync(sortie, { recursive: true, force: true });
  }
});

test('la page Règles : pas de tiret long, classes préfixées, but en une phrase', async () => {
  const { HTML_REGLES } = await import('../public/js/ui/regles-page.js');
  assert.ok(!/[—–]/.test(HTML_REGLES));
  assert.ok(HTML_REGLES.includes('rentrer tous les pions de ton équipe'));
  const classes = [...HTML_REGLES.matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/));
  assert.ok(classes.length > 50);
  assert.deepEqual(classes.filter((c) => !c.startsWith('ri-')), []);
});
