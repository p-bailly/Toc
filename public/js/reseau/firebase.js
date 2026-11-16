// Chargement du SDK Firebase (modulaire, depuis le CDN gstatic, version épinglée) et initialisation.
// Ce module n'est importé (dynamiquement) par api.js que si js/firebase-config.js est rempli : en
// mode hors ligne, aucun code Firebase n'est téléchargé.

import { creerMagasinFirestore } from './magasin-firestore.js';

export const VERSION_SDK = '13.1.0';
const CDN = `https://www.gstatic.com/firebasejs/${VERSION_SDK}`;

/** Télécharge le SDK et initialise l'application. → { magasin, auth } */
export async function demarrer(config) {
  const [appMod, authMod, fs] = await Promise.all([
    import(`${CDN}/firebase-app.js`),
    import(`${CDN}/firebase-auth.js`),
    import(`${CDN}/firebase-firestore.js`),
  ]);
  return initialiser({ appMod, authMod, fs }, config);
}

/**
 * Initialise Firebase avec les modules fournis (CDN dans le navigateur, paquet npm dans les tests).
 * config.emulateurs = true (ou { hote }) : utilise les émulateurs locaux (Auth 9099, Firestore 8080).
 * options.memoire : cache Firestore en mémoire (Node, ou navigateur sans IndexedDB).
 */
export function initialiser({ appMod, authMod, fs }, config, options = {}) {
  const { emulateurs, ...reglagesApp } = config;
  const app = appMod.initializeApp(reglagesApp, options.nomApp);
  const auth = authMod.getAuth(app);
  let db;
  if (options.memoire) {
    db = fs.initializeFirestore(app, { ignoreUndefinedProperties: true });
  } else {
    try {
      // Cache persistant : les parties s'affichent hors ligne, les mains déjà lues restent disponibles.
      db = fs.initializeFirestore(app, {
        ignoreUndefinedProperties: true,
        localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }),
      });
    } catch {
      db = fs.initializeFirestore(app, { ignoreUndefinedProperties: true });
    }
  }
  if (emulateurs) {
    const hote = emulateurs.hote || (typeof location !== 'undefined' ? location.hostname : '127.0.0.1');
    authMod.connectAuthEmulator(auth, `http://${hote}:9099`, { disableWarnings: true });
    fs.connectFirestoreEmulator(db, hote, 8080);
  }
  return { magasin: creerMagasinFirestore(fs, db), auth: creerAuth(authMod, auth), app, db };
}

/** Adaptateur mince de Firebase Authentication (voir comptes.js). */
export function creerAuth(authMod, auth) {
  return {
    connecter: async (email, mdp) => (await authMod.signInWithEmailAndPassword(auth, email, mdp)).user,
    creer: async (email, mdp) => (await authMod.createUserWithEmailAndPassword(auth, email, mdp)).user,
    deconnecter: () => authMod.signOut(auth),
    surChangement: (cb, erreur) =>
      authMod.onAuthStateChanged(auth, (u) => cb(u ? { uid: u.uid, email: u.email } : null), erreur),
    pret: () => (auth.authStateReady ? auth.authStateReady() : Promise.resolve()),
    utilisateur: () => (auth.currentUser ? { uid: auth.currentUser.uid, email: auth.currentUser.email } : null),
  };
}
