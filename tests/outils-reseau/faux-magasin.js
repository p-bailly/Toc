// Faux serveur Firestore + Authentication en mémoire, pour tester la couche réseau dans Node.
//
// Il imite ce dont la logique dépend :
//  - transactions optimistes (relance si un document lu a changé avant la validation ; toutes les
//    lectures avant les écritures ; échec « aborted » après 5 essais) ;
//  - écoutes de documents et de requêtes array-contains, notifiées de façon asynchrone ;
//  - heure du serveur et suppression de champ (valeurs sentinelles) ;
//  - refus des valeurs `undefined` et des tableaux directement imbriqués (comme Firestore) ;
//  - une partie des règles de sécurité (firestore.rules) : lecture des parties, des mains (donnes)
//    et des dons, immuabilité des donnes et dons, liste des fiches bornée à 10. Cela vérifie que
//    le client ne lit que ce que les vraies règles lui permettent ;
//  - un client hors ligne (transactions et lectures non en cache refusées, code « unavailable »).

const HEURE = Object.freeze({ __faux: 'heure' });
const SUPPRIMER = Object.freeze({ __faux: 'supprimer' });

function erreur(code, message = code) {
  const e = new Error(message);
  e.code = code;
  return e;
}

const pause = () => new Promise((r) => setTimeout(r, 0));

function cloner(v) {
  if (v === null || typeof v !== 'object') return v;
  if (v instanceof Date) return new Date(v.getTime());
  if (Array.isArray(v)) return v.map(cloner);
  const r = {};
  for (const [k, x] of Object.entries(v)) r[k] = cloner(x);
  return r;
}

/** Vérifie qu'une valeur est stockable par Firestore. */
function verifierValeur(v, chemin, dansTableau = false) {
  if (v === undefined) throw erreur('invalid-argument', `valeur undefined dans ${chemin}`);
  if (v === null || typeof v !== 'object' || v instanceof Date || v === HEURE || v === SUPPRIMER) return;
  if (Array.isArray(v)) {
    if (dansTableau) throw erreur('invalid-argument', `tableau imbriqué dans un tableau : ${chemin}`);
    v.forEach((x, i) => verifierValeur(x, `${chemin}[${i}]`, true));
    return;
  }
  for (const [k, x] of Object.entries(v)) verifierValeur(x, `${chemin}.${k}`, false);
}

export class FauxServeur {
  constructor() {
    this.docs = new Map(); // chemin → { donnees, version }
    this.version = 0;
    this.temps = Date.UTC(2026, 0, 1);
    this.ecouteurs = new Set(); // { type: 'doc'|'requete', … }
    this.comptes = new Map(); // email → { uid, mdp }
    this.nbUid = 0;
    this.journal = []; // écritures validées : { uid, chemin, type }
  }

  // ─── Accès direct (préparation et vérification des tests) ───
  get(chemin) {
    return cloner(this.docs.get(chemin)?.donnees ?? null);
  }
  set(chemin, donnees) {
    this.docs.set(chemin, { donnees: cloner(donnees), version: ++this.version });
    this.notifier();
  }
  chemins(prefixe) {
    return [...this.docs.keys()].filter((c) => c.startsWith(prefixe)).sort();
  }

  // ─── Règles imitées ───
  peutLire(uid, chemin, donnees) {
    if (!uid) return false;
    const m = chemin.split('/');
    if (m[0] === 'joueurs' && m.length === 2) return true;
    if (m[0] !== 'parties') return false;
    const p = this.docs.get(`parties/${m[1]}`)?.donnees;
    if (m.length === 2) {
      if (!donnees) return true;
      return donnees.uids.includes(uid) || (donnees.invites || []).includes(uid) || donnees.statut === 'attente';
    }
    if (!p || p.statut === 'attente' || !p.uids.includes(uid)) return false;
    const [d, s] = m[3].split('_').map(Number);
    const e = p.etat;
    if (e.donne < d) return false;
    if (m[2] === 'donnes') return p.joueurs[s].uid === uid || p.joueurs[s].ia === true;
    if (m[2] === 'dons') {
      const pour = (s + 2) % 4;
      const fini = e.donne > d || (e.donne === d && e.phase !== 'echange');
      return p.joueurs[s].uid === uid || (fini && (p.joueurs[pour].uid === uid || p.joueurs[s].ia || p.joueurs[pour].ia));
    }
    return false;
  }

  peutCreerSurExistant(chemin) {
    return !/\/(donnes|dons)\//.test(chemin);
  }

  // ─── Écritures ───
  resoudre(v) {
    if (v === HEURE) return new Date(this.temps);
    if (v === null || typeof v !== 'object' || v instanceof Date) return v;
    if (Array.isArray(v)) return v.map((x) => this.resoudre(x));
    const r = {};
    for (const [k, x] of Object.entries(v)) if (x !== SUPPRIMER) r[k] = this.resoudre(x);
    return r;
  }

  appliquer(uid, ecritures) {
    // Vérifications d'abord (tout ou rien).
    for (const w of ecritures) {
      if (w.type !== 'supprimer') verifierValeur(w.donnees, w.chemin);
      const existe = this.docs.has(w.chemin);
      if (w.type === 'maj' && !existe) throw erreur('not-found', `document absent : ${w.chemin}`);
      if (w.type === 'creer' && existe && !this.peutCreerSurExistant(w.chemin)) {
        throw erreur('permission-denied', `document immuable : ${w.chemin}`);
      }
    }
    this.temps += 1000;
    for (const w of ecritures) {
      if (w.type === 'supprimer') this.docs.delete(w.chemin);
      else if (w.type === 'creer') this.docs.set(w.chemin, { donnees: this.resoudre(w.donnees), version: ++this.version });
      else {
        const avant = this.docs.get(w.chemin).donnees;
        const apres = { ...avant };
        for (const [k, x] of Object.entries(w.donnees)) {
          if (x === SUPPRIMER) delete apres[k];
          else apres[k] = this.resoudre(x);
        }
        this.docs.set(w.chemin, { donnees: apres, version: ++this.version });
      }
      this.journal.push({ uid, chemin: w.chemin, type: w.type });
    }
    this.notifier();
  }

  notifier() {
    setTimeout(() => {
      for (const e of this.ecouteurs) e.rafraichir();
    }, 0);
  }

  // ─── Clients ───
  /** Magasin vu par le client `uid` (interface de magasin-firestore.js). */
  client(uid) {
    const serveur = this;
    const c = {
      uid,
      horsLigne: false,
      cache: new Map(), // dernières valeurs lues (lecture hors ligne)

      async lire(chemin) {
        await pause();
        if (c.horsLigne) {
          if (c.cache.has(chemin)) return cloner(c.cache.get(chemin));
          throw erreur('unavailable');
        }
        const d = serveur.docs.get(chemin)?.donnees ?? null;
        if (!serveur.peutLire(c.uid, chemin, d)) throw erreur('permission-denied', `lecture refusée : ${chemin}`);
        c.cache.set(chemin, cloner(d));
        return cloner(d);
      },

      ecouter(chemin, cb, surErreur) {
        let dernier;
        const e = {
          rafraichir() {
            if (c.horsLigne) return;
            const entree = serveur.docs.get(chemin);
            const v = entree?.version ?? 0;
            if (v === dernier) return;
            dernier = v;
            const d = entree?.donnees ?? null;
            if (!serveur.peutLire(c.uid, chemin, d)) {
              serveur.ecouteurs.delete(e);
              surErreur?.(erreur('permission-denied'));
              return;
            }
            c.cache.set(chemin, cloner(d));
            cb(cloner(d));
          },
        };
        serveur.ecouteurs.add(e);
        setTimeout(() => serveur.ecouteurs.has(e) && e.rafraichir(), 0);
        return () => serveur.ecouteurs.delete(e);
      },

      resultats(collection, champ, valeur) {
        const r = [];
        for (const [chemin, { donnees }] of serveur.docs) {
          const m = chemin.split('/');
          if (m.length === 2 && m[0] === collection && (donnees[champ] || []).includes(valeur)) {
            if (!serveur.peutLire(c.uid, chemin, donnees)) throw erreur('permission-denied');
            r.push({ id: m[1], donnees: cloner(donnees) });
          }
        }
        return r;
      },

      ecouterRequete(collection, champ, valeur, cb, surErreur) {
        let derniere = null;
        const e = {
          rafraichir() {
            if (c.horsLigne) return;
            let r;
            try {
              r = c.resultats(collection, champ, valeur);
            } catch (err) {
              serveur.ecouteurs.delete(e);
              surErreur?.(err);
              return;
            }
            const cle = JSON.stringify(r);
            if (cle === derniere) return;
            derniere = cle;
            cb(r.map((x) => ({ id: x.id, donnees: serveur.resoudre(x.donnees) })));
          },
        };
        serveur.ecouteurs.add(e);
        setTimeout(() => serveur.ecouteurs.has(e) && e.rafraichir(), 0);
        return () => serveur.ecouteurs.delete(e);
      },

      async requete(collection, champ, valeur) {
        await pause();
        if (c.horsLigne) throw erreur('unavailable');
        return c.resultats(collection, champ, valeur);
      },

      async listerFiches(suite) {
        await pause();
        if (c.horsLigne) return { docs: [], suite: null, depuisCache: true };
        const fiches = [...serveur.docs]
          .filter(([ch, { donnees }]) => ch.split('/').length === 2 && ch.startsWith('joueurs/') && typeof donnees.recherche === 'string')
          .map(([ch, { donnees }]) => ({ id: ch.split('/')[1], donnees: cloner(donnees) }))
          .sort((a, b) => (a.donnees.recherche < b.donnees.recherche ? -1 : a.donnees.recherche > b.donnees.recherche ? 1 : a.id < b.id ? -1 : 1));
        const debut = suite ? fiches.findIndex((f) => f.id === suite) + 1 : 0;
        const docs = fiches.slice(debut, debut + 10); // limite imposée par les règles
        return { docs, suite: docs.length ? docs[docs.length - 1].id : null, depuisCache: false };
      },

      async transaction(fn) {
        for (let essai = 0; essai < 5; essai++) {
          await pause();
          if (c.horsLigne) throw erreur('unavailable');
          const lus = new Map();
          const ecritures = [];
          const tx = {
            async lire(chemin) {
              if (ecritures.length) throw new Error('Transaction : toutes les lectures doivent précéder les écritures.');
              await pause();
              const entree = serveur.docs.get(chemin);
              const d = entree?.donnees ?? null;
              if (!serveur.peutLire(c.uid, chemin, d)) throw erreur('permission-denied', `lecture refusée : ${chemin}`);
              lus.set(chemin, entree?.version ?? 0);
              return cloner(d);
            },
            creer: (chemin, donnees) => void ecritures.push({ type: 'creer', chemin, donnees: cloner2(donnees) }),
            maj: (chemin, donnees) => void ecritures.push({ type: 'maj', chemin, donnees: cloner2(donnees) }),
            supprimer: (chemin) => void ecritures.push({ type: 'supprimer', chemin }),
          };
          const resultat = await fn(tx);
          await pause();
          if (c.horsLigne) throw erreur('unavailable');
          const change = [...lus].some(([chemin, v]) => (serveur.docs.get(chemin)?.version ?? 0) !== v);
          if (change) {
            serveur.relances = (serveur.relances || 0) + 1;
            continue;
          }
          serveur.appliquer(c.uid, ecritures);
          return resultat;
        }
        throw erreur('aborted');
      },

      async maj(chemin, donnees) {
        await pause();
        if (c.horsLigne) throw erreur('unavailable');
        serveur.appliquer(c.uid, [{ type: 'maj', chemin, donnees }]);
      },

      horodatage: () => HEURE,
      supprimerChamp: () => SUPPRIMER,
    };
    return c;
  }

  /** Fausse authentification (interface de firebase.js → creerAuth). */
  auth(magasin) {
    const serveur = this;
    let courant = null;
    const abonnes = new Set();
    const changer = (u) => {
      courant = u;
      magasin.uid = u ? u.uid : null;
      for (const cb of abonnes) setTimeout(() => cb(u), 0);
    };
    return {
      async connecter(email, mdp) {
        await pause();
        if (magasin.horsLigne) throw erreur('auth/network-request-failed');
        const c = serveur.comptes.get(email);
        if (!c || c.mdp !== mdp) throw erreur('auth/invalid-credential');
        changer({ uid: c.uid, email });
        return { uid: c.uid };
      },
      async creer(email, mdp) {
        await pause();
        if (magasin.horsLigne) throw erreur('auth/network-request-failed');
        if (serveur.comptes.has(email)) throw erreur('auth/email-already-in-use');
        if (mdp.length < 6) throw erreur('auth/weak-password');
        const uid = `u${++serveur.nbUid}`;
        serveur.comptes.set(email, { uid, mdp });
        changer({ uid, email });
        return { uid };
      },
      async deconnecter() {
        changer(null);
      },
      surChangement(cb) {
        abonnes.add(cb);
        setTimeout(() => abonnes.has(cb) && cb(courant), 0);
        return () => abonnes.delete(cb);
      },
      pret: async () => {},
      utilisateur: () => courant,
    };
  }
}

/** Copie qui garde les valeurs sentinelles telles quelles. */
function cloner2(v) {
  if (v === HEURE || v === SUPPRIMER) return v;
  if (v === null || typeof v !== 'object') return v;
  if (v instanceof Date) return new Date(v.getTime());
  if (Array.isArray(v)) return v.map(cloner2);
  const r = {};
  for (const [k, x] of Object.entries(v)) r[k] = cloner2(x);
  return r;
}

/** Attend qu'une condition soit vraie (en laissant tourner minuteries et écoutes). */
export async function attendre(condition, delaiMax = 20000, message = 'condition jamais remplie') {
  const debut = Date.now();
  while (!condition()) {
    if (Date.now() - debut > delaiMax) throw new Error(message);
    await new Promise((r) => setTimeout(r, 1));
  }
}
