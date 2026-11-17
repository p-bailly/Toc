// Publication automatique de firestore.rules (outils/publier-regles.mjs) : contre une fausse API Google, on vérifie
// le jeton signé, le jeu de règles envoyé, la publication, et les erreurs rendues lisibles.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createVerify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { lireCompte, assertion, publierRegles, PUBLICATION } from '../outils/publier-regles.mjs';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const compte = {
  type: 'service_account',
  project_id: 'toc-essai',
  client_email: 'regles@toc-essai.iam.gserviceaccount.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
};
const REGLES = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');

/** Fausse API : rejoue les réponses prévues dans l'ordre et garde les requêtes reçues. */
function fausseApi(reponses) {
  const requetes = [];
  const fetch = async (url, options) => {
    requetes.push({ url, ...options });
    const [statut, corps] = reponses.shift();
    return { ok: statut < 300, status: statut, text: async () => (corps === undefined ? '' : JSON.stringify(corps)) };
  };
  return { fetch, requetes };
}

test('clé du compte de service : JSON complet exigé, message clair sinon', () => {
  assert.equal(lireCompte(JSON.stringify(compte)).project_id, 'toc-essai');
  assert.throws(() => lireCompte(''), /pas du JSON valide/);
  assert.throws(() => lireCompte('{"project_id":"x"}'), /client_email, private_key/);
});

test('jeton : assertion RS256 signée par la clé, pour la bonne portée et la bonne durée', () => {
  const jwt = assertion(compte, Date.UTC(2026, 10, 18));
  const [entete, corps, signature] = jwt.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(entete, 'base64url')), { alg: 'RS256', typ: 'JWT' });
  const c = JSON.parse(Buffer.from(corps, 'base64url'));
  assert.equal(c.iss, compte.client_email);
  assert.equal(c.aud, 'https://oauth2.googleapis.com/token');
  assert.equal(c.scope, 'https://www.googleapis.com/auth/firebase');
  assert.equal(c.exp - c.iat, 3600);
  assert.ok(createVerify('RSA-SHA256').update(`${entete}.${corps}`).verify(publicKey, Buffer.from(signature, 'base64url')));
});

test('publication : jeton, jeu de règles (le vrai fichier), puis publication « cloud.firestore »', async () => {
  const api = fausseApi([
    [200, { access_token: 'jeton-1', expires_in: 3600 }],
    [200, { name: 'projects/toc-essai/rulesets/abc' }],
    [200, { name: `projects/toc-essai/releases/${PUBLICATION}` }],
  ]);
  const r = await publierRegles({ compte, source: REGLES, fetch: api.fetch });
  assert.deepEqual(r, { projet: 'toc-essai', jeu: 'projects/toc-essai/rulesets/abc' });
  const [jeton, jeu, pub] = api.requetes;
  assert.equal(jeton.url, 'https://oauth2.googleapis.com/token');
  assert.match(jeton.body, /grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=/);
  assert.equal(jeu.url, 'https://firebaserules.googleapis.com/v1/projects/toc-essai/rulesets');
  assert.equal(jeu.headers.Authorization, 'Bearer jeton-1');
  assert.deepEqual(JSON.parse(jeu.body), { source: { files: [{ name: 'firestore.rules', content: REGLES }] } });
  assert.equal(pub.method, 'PATCH');
  assert.equal(pub.url, 'https://firebaserules.googleapis.com/v1/projects/toc-essai/releases/cloud.firestore');
  assert.deepEqual(JSON.parse(pub.body), { release: { name: 'projects/toc-essai/releases/cloud.firestore', rulesetName: 'projects/toc-essai/rulesets/abc' } });
});

test('publication : créée si le projet n’en avait pas encore', async () => {
  const api = fausseApi([
    [200, { access_token: 'j' }],
    [200, { name: 'projects/toc-essai/rulesets/abc' }],
    [404, { error: { code: 404, message: 'Release not found' } }],
    [200, {}],
  ]);
  await publierRegles({ compte, source: REGLES, fetch: api.fetch });
  assert.equal(api.requetes[3].method, 'POST');
  assert.equal(api.requetes[3].url, 'https://firebaserules.googleapis.com/v1/projects/toc-essai/releases');
  assert.deepEqual(JSON.parse(api.requetes[3].body), { name: 'projects/toc-essai/releases/cloud.firestore', rulesetName: 'projects/toc-essai/rulesets/abc' });
});

test('erreurs : règles invalides (avec la ligne), droits manquants, clé refusée ; rien n’est publié', async () => {
  let api = fausseApi([
    [200, { access_token: 'j' }],
    [400, { error: { code: 400, message: 'Compilation errors in firestore.rules', details: [{ '@type': 'x', issues: [{ sourcePosition: { line: 12 }, description: "Unexpected '}'." }] }] } }],
  ]);
  await assert.rejects(publierRegles({ compte, source: REGLES, fetch: api.fetch }), /Vérification des règles : refusé \(400\)[\s\S]*ligne 12 : Unexpected '}'/);
  assert.equal(api.requetes.length, 2, 'la publication n’est pas tentée');

  api = fausseApi([
    [200, { access_token: 'j' }],
    [403, { error: { code: 403, message: 'The caller does not have permission' } }],
  ]);
  await assert.rejects(publierRegles({ compte, source: REGLES, fetch: api.fetch }), /refusé \(403\)\. The caller does not have permission/);

  api = fausseApi([[400, { error: 'invalid_grant', error_description: 'Invalid JWT Signature.' }]]);
  await assert.rejects(publierRegles({ compte, source: REGLES, fetch: api.fetch }), /Connexion du compte de service : refusé \(400\)\. Invalid JWT Signature/);
  await assert.rejects(publierRegles({ compte, source: '  ', fetch: api.fetch }), /vide/);
});
