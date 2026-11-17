// Réglages de l'appli, gardés sur l'appareil (localStorage « toc.reglages »), sur le modèle de l'appli Scrabble.
// Le thème et la taille du texte s'appliquent à la page entière (attributs de <html> que lit app.css) ; les autres
// sont lus au moment où ils servent. Le pseudo, l'icône et « être trouvé » sont dans la fiche du joueur (réseau).

import { lire, ecrire } from './dom.js';
import { android } from './android.js';

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

/**
 * Vitesse du jeu : un curseur de 0 (très lente) à 100 (rapide), par pas de 5. Elle règle le rythme des animations
 * (ms par case, plafond d'un déplacement, saut direct, trajet de la carte), le temps de lecture après le coup d'un
 * autre joueur et le délai des IA de l'entraînement : chaque durée glisse de sa valeur lente à sa valeur rapide,
 * en proportion (échelle géométrique : un cran change toujours la vitesse du même rapport).
 */
export const VITESSE_MIN = 0;
export const VITESSE_MAX = 100;
export const VITESSE_PAS = 5;
/** Par défaut : lente, pour suivre chaque coup des yeux. */
export const VITESSE_DEFAUT = 25;
const RYTHME_LENT = { pas: 300, max: 2300, saut: 920, carte: 1000, lecture: 1500, delaiIA: 2600, avantAuto: 2200 };
const RYTHME_RAPIDE = { pas: 55, max: 550, saut: 220, carte: 230, lecture: 220, delaiIA: 450, avantAuto: 700 };
/** Les trois vitesses d'avant le curseur ; « posée », la plus lente d'alors, devient la nouvelle vitesse par défaut. */
const ANCIENNES_VITESSES = { posee: VITESSE_DEFAUT, normale: 60, rapide: 100 };

/** Une vitesse du curseur (nombre entre 0 et 100, au pas près) d'après une valeur enregistrée, même ancienne ou abîmée. */
export function vitesseValide(v) {
  if (typeof v === 'string' && v in ANCIENNES_VITESSES) return ANCIENNES_VITESSES[v];
  if (typeof v !== 'number' || !Number.isFinite(v)) return VITESSE_DEFAUT;
  return Math.min(VITESSE_MAX, Math.max(VITESSE_MIN, Math.round(v / VITESSE_PAS) * VITESSE_PAS));
}

/** Les durées (ms) d'une vitesse du curseur : { pas, max, saut, carte, lecture, delaiIA, avantAuto }. */
export function rythme(vitesse) {
  const t = (vitesseValide(vitesse) - VITESSE_MIN) / (VITESSE_MAX - VITESSE_MIN);
  return Object.fromEntries(Object.keys(RYTHME_LENT).map((cle) => [cle, Math.round(RYTHME_LENT[cle] * (RYTHME_RAPIDE[cle] / RYTHME_LENT[cle]) ** t)]));
}

/** Nom d'une vitesse du curseur, affiché à côté de lui. */
export function nomVitesse(vitesse) {
  const v = vitesseValide(vitesse);
  return v < 20 ? 'Très lente' : v < 40 ? 'Lente' : v < 60 ? 'Posée' : v < 85 ? 'Normale' : 'Rapide';
}

/** Rythme des essais automatisés (URL avec « rapide ») : presque instantané. */
export const VITESSE_ESSAIS = { pas: 4, max: 40, saut: 15, carte: 15, lecture: 10, delaiIA: 40, avantAuto: 60 };

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
  /** Vitesse du jeu : curseur de 0 (très lente) à 100 (rapide), voir rythme(). */
  vitesse: VITESSE_DEFAUT,
  /** Jouer tout seul le seul coup possible (après l'avoir montré). */
  coupUniqueAuto: true,
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
    vitesse: 'vitesse' in r ? vitesseValide(r.vitesse) : DEFAUT.vitesse,
    coupUniqueAuto: booleen('coupUniqueAuto'),
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
  android?.barres(COULEUR_BARRE[sombre ? 'sombre' : 'clair'], sombre);
}

/** Au lancement : applique les réglages et suit le thème du système tant qu'on est en « automatique ». */
export function demarrerReglages() {
  appliquer(lireReglages());
  matchMedia(SOMBRE).addEventListener?.('change', () => appliquer(lireReglages()));
}
