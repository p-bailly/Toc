// Service worker du Toc : la coquille de l'appli s'ouvre hors ligne.
// Stratégie « réseau d'abord » pour les fichiers de l'appli (HTML, JS, CSS…) : on sert toujours la version en
// ligne quand le réseau répond, et le cache n'est qu'un secours hors ligne (jamais de code périmé servi
// indéfiniment). Seules les requêtes GET de même origine passent ici : Firebase, Firestore, gstatic, googleapis
// et les autres domaines ne sont jamais interceptés.
// Incrémenter VERSION quand la liste de la coquille change.
const VERSION = 'v1';
const COQUE = `toc-coque-${VERSION}`;

const FICHIERS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './js/app.js',
  './js/session-locale.js',
  './js/firebase-config.js',
  './js/reseau/api.js',
  './js/moteur/index.js',
  './js/moteur/cartes.js',
  './js/moteur/plateau.js',
  './js/moteur/regles.js',
  './js/moteur/partie.js',
  './js/ia/ia.js',
  './js/ui/dom.js',
  './js/ui/pictos.js',
  './js/ui/icones.js',
  './js/ui/reglages.js',
  './js/ui/notifications.js',
  './js/ui/veille.js',
  './js/ui/composants.js',
  './js/ui/installation.js',
  './js/ui/geometrie.js',
  './js/ui/couleurs.js',
  './js/ui/libelles.js',
  './js/ui/carte.js',
  './js/ui/plateau.js',
  './js/ui/vue-jeu.js',
  './js/ui/ecran-jeu.js',
  './js/ui/ecran-ia.js',
  './js/ui/ecran-parties.js',
  './js/ui/ecran-partie.js',
  './js/ui/ecran-regles.js',
  './js/ui/ecran-reglages.js',
  './js/ui/ecran-analyse.js',
  './js/ui/analyse-calcul.js',
  './js/ui/analyse-boucle.js',
  './js/ui/analyse-worker.js',
  './js/ui/analyseur.js',
];

self.addEventListener('install', (event) => {
  // Chaque fichier est ajouté séparément : un fichier manquant ne bloque pas l'installation.
  event.waitUntil(caches.open(COQUE).then((c) => Promise.all(FICHIERS.map((f) => c.add(new Request(f, { cache: 'reload' })).catch(() => {})))));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cles) => Promise.all(cles.filter((k) => k.startsWith('toc-') && k !== COQUE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Firebase, Google… : jamais interceptés
  if (url.pathname.startsWith('/__/')) return; // réservé à Firebase Hosting

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok && res.type === 'basic') {
          const copie = res.clone();
          // Une page s'enregistre sous index.html (le hash ne part pas au serveur, la recherche ?demo si).
          const cle = req.mode === 'navigate' ? './index.html' : req;
          caches.open(COQUE).then((c) => c.put(cle, copie));
        }
        return res;
      })
      .catch(async () => {
        const cache = await caches.open(COQUE);
        if (req.mode === 'navigate') return (await cache.match('./index.html')) || (await cache.match('./')) || Response.error();
        return (await cache.match(req, { ignoreSearch: true })) || Response.error();
      }),
  );
});

// Toucher une notification « À toi de jouer » : ramène l'appli au premier plan sur la partie.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const hash = (event.notification.data && event.notification.data.url) || '#/parties';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((fenetres) => {
      const f = fenetres.find((w) => 'focus' in w);
      if (f) {
        f.postMessage({ type: 'ouvrir', hash });
        return f.focus();
      }
      return self.clients.openWindow(self.registration.scope + hash);
    }),
  );
});
