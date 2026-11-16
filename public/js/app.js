// Point d'entrée de l'appli Toc : choix de la couche réseau (réelle, ou factice avec ?demo), routage par hash,
// barre d'onglets, veille des parties, service worker.
//
// Routes :
//   #/parties            Mes parties (écran d'ouverture ; connexion si besoin)
//   #/ia                 Contre l'IA (reprendre / nouvelle partie d'entraînement)
//   #/jeu/locale         partie d'entraînement en cours
//   #/partie/ID          partie en ligne : salle d'attente, puis plateau
//   #/rejoindre/CODE     rejoindre une partie par son code (après connexion si besoin)
//   #/regles, #/reglages

import { h } from './ui/dom.js';
import { lire } from './ui/dom.js';
import { demarrerReglages } from './ui/reglages.js';
import { piParties, piIA, piRegles, piReglages } from './ui/pictos.js';
import { definirLecteurJoueurs, retenirIcone } from './ui/composants.js';
import { surEnAttente, nbEnAttente, surOuvertureNotification } from './ui/notifications.js';
import { demarrerVeille, arreterVeille } from './ui/veille.js';

const parametres = new URLSearchParams(location.search);
const demo = parametres.has('demo');
const rapide = parametres.has('rapide');

demarrerReglages();

const api = demo ? await import('./dev/api-factice.js') : await import('./reseau/api.js');
if (demo && rapide) api.reglerVitesse?.(0.08);

/** Contexte partagé par les écrans. */
export const app = {
  api,
  demo,
  rapide,
  joueur: undefined, // undefined : on ne sait pas encore ; null : pas connecté
  enLigne: () => {
    try {
      return api.reseauDisponible();
    } catch {
      return false;
    }
  },
  naviguer(hash, remplacer = false) {
    if (remplacer) location.replace(hash);
    else location.hash = hash;
  },
};

definirLecteurJoueurs((uid) => (typeof api.lireJoueur === 'function' ? api.lireJoueur(uid) : Promise.resolve(null)));

const racine = document.getElementById('appli');
const principal = h('main', { id: 'principal', class: 'principal' });
const onglets = h('nav', { class: 'onglets', 'aria-label': 'Navigation' });
racine.replaceChildren(principal, onglets);

const ONGLETS = [
  { route: 'parties', texte: 'Mes parties', picto: piParties, pastille: true },
  { route: 'ia', texte: 'Contre l’IA', picto: piIA },
  { route: 'regles', texte: 'Règles', picto: piRegles },
  { route: 'reglages', texte: 'Réglages', picto: piReglages },
];

function dessinerOnglets(actif) {
  onglets.replaceChildren(
    ...ONGLETS.map((o) => {
      const n = o.pastille ? nbEnAttente() : 0;
      return h(
        'a',
        { href: '#/' + o.route, class: o.route === actif ? 'actif' : '', 'aria-current': o.route === actif ? 'page' : null },
        o.picto(),
        n > 0 ? h('span', { class: 'pastille', 'aria-label': `${n} en attente` }, String(n)) : null,
        o.texte,
      );
    }),
  );
}
surEnAttente(() => dessinerOnglets(ongletActif));

let detruireEcran = null;
let ongletActif = 'parties';
let routeActuelle = null;

/** Route par défaut : Mes parties, sauf pour qui a choisi de jouer sans compte (ou sans réseau). */
function routeParDefaut() {
  if (!app.enLigne()) return '#/ia';
  if (!app.joueur && lire('toc.sansCompte', false)) return '#/ia';
  return '#/parties';
}

async function router() {
  const brut = location.hash.replace(/^#\/?/, '');
  if (!brut) {
    app.naviguer(routeParDefaut(), true);
    return;
  }
  const [page, ...reste] = brut.split('/').map(decodeURIComponent);
  const cle = brut;
  if (cle === routeActuelle) return;
  routeActuelle = cle;
  if (detruireEcran) {
    try {
      detruireEcran();
    } catch (e) {
      console.error(e);
    }
    detruireEcran = null;
  }
  principal.replaceChildren();
  window.scrollTo(0, 0);

  let module;
  let jeu = false;
  switch (page) {
    case 'ia':
      module = await import('./ui/ecran-ia.js');
      ongletActif = 'ia';
      break;
    case 'jeu':
      module = await import('./ui/ecran-jeu.js');
      ongletActif = 'ia';
      jeu = true;
      break;
    case 'analyse':
      module = await import('./ui/ecran-analyse.js');
      ongletActif = reste[0] === 'locale' ? 'ia' : 'parties';
      break;
    case 'partie':
      module = await import('./ui/ecran-partie.js');
      ongletActif = 'parties';
      jeu = true;
      break;
    case 'rejoindre':
      module = await import('./ui/ecran-parties.js');
      ongletActif = 'parties';
      break;
    case 'regles':
      module = await import('./ui/ecran-regles.js');
      ongletActif = 'regles';
      break;
    case 'reglages':
      module = await import('./ui/ecran-reglages.js');
      ongletActif = 'reglages';
      break;
    case 'parties':
    default:
      module = await import('./ui/ecran-parties.js');
      ongletActif = 'parties';
  }
  if (routeActuelle !== cle) return; // une autre navigation est passée pendant le chargement
  onglets.hidden = jeu;
  racine.classList.toggle('en-jeu', jeu);
  dessinerOnglets(ongletActif);
  detruireEcran = module.afficher(principal, app, { page, reste }) || null;
}

/** Force le réaffichage de l'écran courant (après connexion, déconnexion…). */
app.rafraichir = () => {
  routeActuelle = null;
  router();
};

window.addEventListener('hashchange', router);

// Connexion : on attend le premier avis avant d'afficher quoi que ce soit.
let premierAvis = true;
api.surAuth((joueur) => {
  const avant = app.joueur;
  app.joueur = joueur || null;
  if (joueur) retenirIcone(joueur.uid, joueur.icone);
  if (joueur && (!avant || avant.uid !== joueur.uid)) demarrerVeille(api);
  if (!joueur && avant) arreterVeille();
  if (premierAvis) {
    premierAvis = false;
    router();
  } else if (!!avant !== !!joueur || (avant && joueur && avant.uid !== joueur.uid)) {
    app.rafraichir();
  } else {
    app.surJoueur?.(app.joueur);
  }
});

surOuvertureNotification((hash) => app.naviguer(hash));

// Service worker : coquille de l'appli disponible hors ligne. Une nouvelle version prend la main au lancement suivant.
if ('serviceWorker' in navigator && !parametres.has('sanssw')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

// Installation sur Android / ordinateur : on garde l'invitation du navigateur pour un bouton « Installer ».
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  app.invitationInstallation = e;
  app.surInstallation?.();
});
