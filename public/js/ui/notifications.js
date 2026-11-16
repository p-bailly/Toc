// Signal « c'est à toi » : notifications locales (appli ouverte ou en arrière-plan, pas de push serveur), pastille
// de l'onglet, titre du document et badge de l'icône (navigator.setAppBadge).
// La permission système n'est demandée qu'au cours d'un geste explicite (connexion, nouvelle partie, réglages…).

import { notificationVoulue } from './reglages.js';

const TITRE_BASE = 'Toc';

export const notificationsProposees = () => typeof window !== 'undefined' && 'Notification' in window;

/** true / false selon l'autorisation du système ; null si cet appareil ne propose pas les notifications. */
export function notificationsAutorisees() {
  if (!notificationsProposees()) return null;
  return Notification.permission === 'granted';
}

/** Demande l'autorisation (à appeler pendant un geste de l'utilisateur). */
export async function demanderPermission() {
  try {
    if (!notificationsProposees()) return false;
    if (Notification.permission === 'default') return (await Notification.requestPermission()) === 'granted';
    return Notification.permission === 'granted';
  } catch {
    return false;
  }
}

/**
 * Affiche une notification qui, touchée, ouvre `hash` (ex. « #/partie/abc »), si les réglages la permettent.
 * `cle` sert d'étiquette : une nouvelle notification de même clé remplace l'ancienne.
 */
export async function notifier(cle, titre, texte, hash, genre) {
  if (!notificationVoulue(genre)) return;
  if (!notificationsProposees() || Notification.permission !== 'granted') return;
  const options = { body: texte, tag: cle, icon: './icons/icon-192.png', badge: './icons/icon-192.png', data: { url: hash } };
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) await reg.showNotification(titre, options);
    else new Notification(titre, options);
  } catch {
    /* certaines plateformes refusent les notifications hors service worker */
  }
}

/** Appelle `ouvrir(hash)` quand on touche une notification (message envoyé par sw.js). */
export function surOuvertureNotification(ouvrir) {
  const surMessage = (e) => {
    if (e.data?.type === 'ouvrir' && typeof e.data.hash === 'string') ouvrir(e.data.hash);
  };
  navigator.serviceWorker?.addEventListener('message', surMessage);
  return () => navigator.serviceWorker?.removeEventListener('message', surMessage);
}

// ─── Compteur « à toi » : pastille, titre, badge ────────────────────────────

let enAttente = 0; // parties en ligne qui attendent l'utilisateur + invitations reçues
let monTourLocal = false; // partie d'entraînement ouverte où c'est à lui
const abonnes = new Set();

/** Nombre d'actions qui attendent l'utilisateur (pour la pastille de l'onglet). */
export const nbEnAttente = () => enAttente;

export function surEnAttente(cb) {
  abonnes.add(cb);
  return () => abonnes.delete(cb);
}

export function majEnAttente(n) {
  if (n === enAttente) return;
  enAttente = n;
  try {
    if (n > 0) navigator.setAppBadge?.(n)?.catch?.(() => {});
    else navigator.clearAppBadge?.()?.catch?.(() => {});
  } catch {
    /* badge indisponible */
  }
  majTitre();
  for (const cb of abonnes) cb(n);
}

/** L'écran de jeu signale si c'est au joueur de jouer (titre « À toi ! »). */
export function majMonTour(oui) {
  monTourLocal = !!oui;
  majTitre();
}

function majTitre() {
  const prefixe = enAttente > 0 ? `(${enAttente}) ` : '';
  document.title = monTourLocal ? `À toi ! · ${TITRE_BASE}` : prefixe + TITRE_BASE;
}
