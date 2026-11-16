// Écrit public/js/firebase-config.js à partir de la variable d'environnement FIREBASE_CONFIG
// (l'objet firebaseConfig de la console Firebase, en JSON), si le fichier versionné n'est pas rempli.
// Utilisé par le déploiement GitHub Pages ; ne fait rien si la configuration est déjà dans le dépôt.
import { readFileSync, writeFileSync } from 'node:fs';

const FICHIER = new URL('../public/js/firebase-config.js', import.meta.url);
const CLES = ['apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId'];

const actuel = readFileSync(FICHIER, 'utf8');
if (/["']?apiKey["']?\s*:\s*['"][^'"]+['"]/.test(actuel)) {
  console.log('Configuration Firebase : celle du dépôt est utilisée.');
  process.exit(0);
}
const brut = (process.env.FIREBASE_CONFIG || '').trim();
if (!brut) {
  console.log("Configuration Firebase : aucune. L'appli sera publiée en mode hors ligne (jeu contre l'IA seulement).");
  process.exit(0);
}
let config;
try {
  config = JSON.parse(brut);
} catch {
  console.error("FIREBASE_CONFIG n'est pas du JSON valide (guillemets doubles autour des noms et des valeurs).");
  process.exit(1);
}
const manquantes = CLES.filter((c) => typeof config[c] !== 'string' || !config[c]);
if (manquantes.length) {
  console.error('FIREBASE_CONFIG : valeurs manquantes : ' + manquantes.join(', '));
  process.exit(1);
}
const propre = Object.fromEntries(CLES.map((c) => [c, config[c]]));
writeFileSync(FICHIER, `// Écrit au déploiement à partir de la variable de dépôt FIREBASE_CONFIG.\nexport const firebaseConfig = ${JSON.stringify(propre, null, 2)};\n`);
console.log('Configuration Firebase : écrite pour le projet ' + propre.projectId + '.');
