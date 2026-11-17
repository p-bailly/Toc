// Publie firestore.rules sur le projet Firebase : ce que fait « Publier » dans l'onglet Règles de la console.
// Lancé par .github/workflows/regles.yml à chaque push sur la branche par défaut qui touche aux règles.
//
//   FIREBASE_SERVICE_ACCOUNT='{…clé JSON d'un compte de service…}' node outils/publier-regles.mjs
//
// Le compte de service n'a besoin que du rôle « Administrateur des règles Firebase » (Firebase Rules Admin) :
// voir docs/firebase.md. Aucune dépendance : l'API Firebase Rules est appelée directement (jeton OAuth signé
// avec la clé du compte de service, puis création d'un jeu de règles et mise à jour de la publication
// « cloud.firestore »). Le serveur vérifie les règles : une erreur de syntaxe fait échouer la publication, et
// les règles en place restent alors celles d'avant.

import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';

const API = 'https://firebaserules.googleapis.com/v1';
const JETON = 'https://oauth2.googleapis.com/token';
const PORTEE = 'https://www.googleapis.com/auth/firebase';
/** Nom de la publication des règles de la base Firestore par défaut. */
export const PUBLICATION = 'cloud.firestore';

const base64url = (x) => Buffer.from(x).toString('base64url');

/** Lit la clé JSON du compte de service ; lève une Error en français si elle est inutilisable. */
export function lireCompte(brut) {
  let compte;
  try {
    compte = JSON.parse(String(brut || '').trim());
  } catch {
    throw new Error("FIREBASE_SERVICE_ACCOUNT n'est pas du JSON valide : colle le fichier de clé tel quel.");
  }
  const manquants = ['project_id', 'client_email', 'private_key'].filter((c) => typeof compte?.[c] !== 'string' || !compte[c]);
  if (manquants.length) throw new Error('FIREBASE_SERVICE_ACCOUNT : champs manquants : ' + manquants.join(', ') + '.');
  return compte;
}

/** Assertion signée (JWT, RS256) qui s'échange contre un jeton d'accès. */
export function assertion(compte, maintenant = Date.now()) {
  const t = Math.floor(maintenant / 1000);
  const entete = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const corps = base64url(JSON.stringify({ iss: compte.client_email, scope: PORTEE, aud: JETON, iat: t, exp: t + 3600 }));
  const signature = createSign('RSA-SHA256').update(`${entete}.${corps}`).sign(compte.private_key).toString('base64url');
  return `${entete}.${corps}.${signature}`;
}

async function appeler(fetch, url, options, quoi) {
  const r = await fetch(url, options);
  const texte = await r.text();
  let donnees = null;
  try {
    donnees = texte ? JSON.parse(texte) : null;
  } catch {
    /* réponse sans JSON */
  }
  if (!r.ok) {
    const detail = donnees?.error?.message || donnees?.error_description || texte.slice(0, 500);
    const e = new Error(`${quoi} : refusé (${r.status}). ${detail}`);
    e.statut = r.status;
    e.details = donnees?.error?.details;
    throw e;
  }
  return donnees;
}

/**
 * Publie `source` (le texte de firestore.rules) sur le projet du compte de service.
 * @param {Object} o  { compte, source, fetch?, maintenant? }
 * @returns {Promise<{ projet, jeu }>} le projet et le nom du jeu de règles publié
 */
export async function publierRegles({ compte, source, fetch = globalThis.fetch, maintenant = Date.now() }) {
  if (!source || !source.trim()) throw new Error('firestore.rules est vide : rien à publier.');
  const projet = compte.project_id;
  const jeton = await appeler(
    fetch,
    JETON,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: assertion(compte, maintenant) }).toString(),
    },
    'Connexion du compte de service',
  );
  const entetes = { Authorization: `Bearer ${jeton.access_token}`, 'Content-Type': 'application/json' };

  // 1. Le jeu de règles : le serveur le compile, et le refuse s'il contient une erreur.
  let jeu;
  try {
    jeu = await appeler(
      fetch,
      `${API}/projects/${projet}/rulesets`,
      { method: 'POST', headers: entetes, body: JSON.stringify({ source: { files: [{ name: 'firestore.rules', content: source }] } }) },
      'Vérification des règles',
    );
  } catch (e) {
    const problemes = (e.details || []).flatMap((d) => d.issues || d.sourceIssues || []);
    if (problemes.length) {
      e.message += '\n' + problemes.map((p) => `  ligne ${p.sourcePosition?.line ?? '?'} : ${p.description}`).join('\n');
    }
    throw e;
  }

  // 2. La publication « cloud.firestore » pointe désormais sur ce jeu (créée si le projet n'en avait pas).
  const nom = `projects/${projet}/releases/${PUBLICATION}`;
  const release = { name: nom, rulesetName: jeu.name };
  try {
    await appeler(fetch, `${API}/${nom}`, { method: 'PATCH', headers: entetes, body: JSON.stringify({ release }) }, 'Publication des règles');
  } catch (e) {
    if (e.statut !== 404) throw e;
    await appeler(fetch, `${API}/projects/${projet}/releases`, { method: 'POST', headers: entetes, body: JSON.stringify(release) }, 'Publication des règles');
  }
  return { projet, jeu: jeu.name };
}

// Lancé directement (pas importé par un test).
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const compte = lireCompte(process.env.FIREBASE_SERVICE_ACCOUNT);
    const source = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
    const { projet, jeu } = await publierRegles({ compte, source });
    console.log(`Règles Firestore publiées sur le projet ${projet} (${jeu}).`);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
