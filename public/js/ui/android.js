// Pont vers l'appli Android (android/app/src/main/java/fr/perso/toc/MainActivity.java). Dans l'APK, la page tourne
// dans une WebView : pas de notifications web, pas de partage, pas de barre de navigateur à colorer. L'appli Android
// les fournit par l'objet `window.TocAndroid` :
//   version()                          version de l'APK (« 1.0.57 ») ;
//   adresseWeb()                       adresse de la version web, pour les liens d'invitation ;
//   notificationsAutorisees()          true / false ;
//   demanderNotifications()            demande l'autorisation ; réponse : événement « toc-notifications » ;
//   notifier(cle, titre, texte, hash)  notification ; touchée : événement « toc-ouvrir », `detail` = hash ;
//   partager(texte)                    feuille de partage du téléphone ;
//   barres(couleur, sombre)            couleur des barres du système.
// null partout ailleurs : navigateur, appli installée depuis le navigateur, tests.
export const android = (typeof window !== 'undefined' && window.TocAndroid) || null;
