// Adaptateur mince entre la logique réseau et le SDK Cloud Firestore.
//
// Toute la logique (parties.js, comptes.js, session-reseau.js) ne parle qu'à un « magasin » qui
// expose l'interface ci-dessous ; les tests Node en fournissent un faux, en mémoire
// (tests/outils-reseau/faux-magasin.js). Les chemins sont des chaînes « collection/id/… ».
// Les données lues sont des objets JavaScript simples (les Timestamp deviennent des Date).
//
//   lire(chemin)                              → Promise<données | null>
//   ecouter(chemin, cb, erreur)               → désabonnement ; cb(données | null)
//   ecouterRequete(collection, champ, valeur, cb, erreur)
//                                             → désabonnement ; cb([{ id, donnees }]) ; champ array-contains valeur
//   requete(collection, champ, valeur)        → Promise<[{ id, donnees }]> (même requête, une fois)
//   ecouterEgal(collection, champ, valeur, limite, cb, erreur)
//                                             → désabonnement ; cb([{ id, donnees }]) ; champ == valeur, `limite` au plus
//   listerFiches(suite)                       → Promise<{ docs: [{ id, donnees }], suite, depuisCache }>
//                                               fiches `joueurs` visibles (recherche >= ''), par pages de 10
//   transaction(async (tx) => …)              → Promise ; tx.lire(chemin), tx.creer(chemin, données),
//                                               tx.maj(chemin, champs), tx.supprimer(chemin)
//   maj(chemin, champs)                       → Promise (mise à jour hors transaction)
//   horodatage()                              → valeur sentinelle « heure du serveur »
//   supprimerChamp()                          → valeur sentinelle « supprimer ce champ » (pour maj)

export const TAILLE_PAGE_FICHES = 10; // imposée par les règles Firestore (request.query.limit <= 10)

/**
 * @param {Object} fs  module du SDK Firestore (CDN gstatic dans le navigateur, paquet npm dans les tests)
 * @param {Object} db  instance Firestore
 */
export function creerMagasinFirestore(fs, db) {
  const ref = (chemin) => fs.doc(db, chemin);

  const versJS = (v) => {
    if (v === null || typeof v !== 'object') return v;
    if (v instanceof fs.Timestamp) return v.toDate();
    if (Array.isArray(v)) return v.map(versJS);
    const r = {};
    for (const [k, x] of Object.entries(v)) r[k] = versJS(x);
    return r;
  };
  // Écritures locales pas encore confirmées : l'heure du serveur est estimée plutôt que null.
  const donnees = (snap) => (snap.exists() ? versJS(snap.data({ serverTimestamps: 'estimate' })) : null);
  const liste = (s) => s.docs.map((d) => ({ id: d.id, donnees: versJS(d.data({ serverTimestamps: 'estimate' })) }));

  return {
    async lire(chemin) {
      return donnees(await fs.getDoc(ref(chemin)));
    },

    ecouter(chemin, cb, erreur) {
      return fs.onSnapshot(ref(chemin), (s) => cb(donnees(s)), erreur);
    },

    ecouterRequete(collection, champ, valeur, cb, erreur) {
      const q = fs.query(fs.collection(db, collection), fs.where(champ, 'array-contains', valeur));
      return fs.onSnapshot(q, (s) => cb(liste(s)), erreur);
    },

    ecouterEgal(collection, champ, valeur, limite, cb, erreur) {
      const q = fs.query(fs.collection(db, collection), fs.where(champ, '==', valeur), fs.limit(limite));
      return fs.onSnapshot(q, (s) => cb(liste(s)), erreur);
    },

    async requete(collection, champ, valeur) {
      const q = fs.query(fs.collection(db, collection), fs.where(champ, 'array-contains', valeur));
      return liste(await fs.getDocs(q));
    },

    async listerFiches(suite) {
      // La borne sur `recherche` est exigée par les règles : seules les fiches visibles se listent.
      const parametres = [fs.where('recherche', '>=', ''), fs.orderBy('recherche')];
      if (suite) parametres.push(fs.startAfter(suite));
      parametres.push(fs.limit(TAILLE_PAGE_FICHES));
      const s = await fs.getDocs(fs.query(fs.collection(db, 'joueurs'), ...parametres));
      return { docs: liste(s), suite: s.docs.length ? s.docs[s.docs.length - 1] : null, depuisCache: s.metadata.fromCache };
    },

    transaction(fn) {
      return fs.runTransaction(db, (t) =>
        fn({
          lire: async (chemin) => donnees(await t.get(ref(chemin))),
          creer: (chemin, d) => void t.set(ref(chemin), d),
          maj: (chemin, d) => void t.update(ref(chemin), d),
          supprimer: (chemin) => void t.delete(ref(chemin)),
        }),
      );
    },

    maj(chemin, d) {
      return fs.updateDoc(ref(chemin), d);
    },

    horodatage: () => fs.serverTimestamp(),
    supprimerChamp: () => fs.deleteField(),
  };
}
