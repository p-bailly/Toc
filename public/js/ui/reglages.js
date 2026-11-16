// Réglages de l'appli, gardés sur l'appareil (localStorage « toc.reglages »), sur le modèle de l'appli Scrabble.
// Le thème et la taille du texte s'appliquent à la page entière (attributs de <html> que lit app.css) ; les autres
// sont lus au moment où ils servent. Le pseudo, l'icône et « être trouvé » sont dans la fiche du joueur (réseau).

import { lire, ecrire } from './dom.js';

export const THEMES = [
  { theme: 'auto', nom: 'Auto' },
  { theme: 'clair', nom: 'Clair' },
  { theme: 'sombre', nom: 'Sombre' },
];

export const TAILLES = [
  { taille: 'normal', nom: 'Normal' },
  { taille: 'grand', nom: 'Grand' },
  { taille: 'tres-grand', nom: 'Très grand' },
];

const CLE = 'toc.reglages';
const DEFAUT = {
  theme: 'clair', // clair par défaut ; « Auto » (suivre le téléphone) et « Sombre » se choisissent dans les Réglages
  texte: 'normal',
  /** Interrupteur général des notifications ; les trois suivants choisissent lesquelles. */
  notifications: true,
  notifTour: true,
  notifInvitations: true,
  notifFin: true,
  /** Demander « Jouer ce coup ? » avant d'envoyer un coup (désactivé par défaut : un seul toucher). */
  confirmerCoup: false,
  /** Animer les déplacements des pions. */
  animations: true,
  /** Conseils de l'IA (entraînement et analyse de fin de partie) : désactivés par défaut. */
  conseilsIA: false,
  /** Entraînement : après chaque coup, dire si l'IA aurait joué pareil (seulement avec conseilsIA). */
  commenterCoups: false,
};

const CLE_GENRE = { tour: 'notifTour', invitation: 'notifInvitations', fin: 'notifFin' };

/** Réglages enregistrés, complétés par les valeurs par défaut (une valeur inconnue ou abîmée est ignorée). */
export function lireReglages() {
  const r = lire(CLE, null) || {};
  const booleen = (cle) => (typeof r[cle] === 'boolean' ? r[cle] : DEFAUT[cle]);
  return {
    theme: THEMES.some((t) => t.theme === r.theme) ? r.theme : DEFAUT.theme,
    texte: TAILLES.some((t) => t.taille === r.texte) ? r.texte : DEFAUT.texte,
    notifications: booleen('notifications'),
    notifTour: booleen('notifTour'),
    notifInvitations: booleen('notifInvitations'),
    notifFin: booleen('notifFin'),
    confirmerCoup: booleen('confirmerCoup'),
    animations: booleen('animations'),
    conseilsIA: booleen('conseilsIA'),
    commenterCoups: booleen('commenterCoups'),
  };
}

/** Faut-il afficher cette notification ? Sans genre : seul l'interrupteur général compte. */
export function notificationVoulue(genre) {
  const r = lireReglages();
  return r.notifications && (!genre || r[CLE_GENRE[genre]]);
}

const abonnes = new Set();

export function surReglages(cb) {
  abonnes.add(cb);
  return () => abonnes.delete(cb);
}

/** Change un ou plusieurs réglages, les enregistre et les applique. Renvoie les réglages à jour. */
export function modifierReglages(modif) {
  const r = { ...lireReglages(), ...modif };
  ecrire(CLE, r);
  appliquer(r);
  for (const cb of abonnes) cb(r);
  return r;
}

const SOMBRE = '(prefers-color-scheme: dark)';
/** Mêmes couleurs que les <meta name="theme-color"> d'index.html. */
const COULEUR_BARRE = { clair: '#a9d3f4', sombre: '#0e2238' };

export const estSombre = (theme, systemeSombre) => theme === 'sombre' || (theme === 'auto' && systemeSombre);

function appliquer(r) {
  const sombre = estSombre(r.theme, matchMedia(SOMBRE).matches);
  const racine = document.documentElement;
  racine.dataset.theme = sombre ? 'dark' : 'light';
  racine.dataset.texte = r.texte;
  for (const m of document.querySelectorAll('meta[name="theme-color"]')) {
    m.removeAttribute('media');
    m.setAttribute('content', COULEUR_BARRE[sombre ? 'sombre' : 'clair']);
  }
}

/** Au lancement : applique les réglages et suit le thème du système tant qu'on est en « automatique ». */
export function demarrerReglages() {
  appliquer(lireReglages());
  matchMedia(SOMBRE).addEventListener?.('change', () => appliquer(lireReglages()));
}
