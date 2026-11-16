// Composants partagés des écrans, repris de l'appli Scrabble : en-tête, feuilles (fenêtres en bas d'écran),
// lignes de réglage et interrupteurs, avatar des joueurs, toast.

import { h } from './dom.js';
import { piRetour } from './pictos.js';
import { emojiIcone, EMOJI_IA } from './icones.js';

/** Logo : un pion rouge posé sur le tapis vert, dans le cadre bleu nuit. */
export function logo() {
  return h('div', { class: 'logo', 'aria-hidden': 'true' }, h('span'));
}

export function entete(titre = 'Toc', droite = null) {
  return h('header', { class: 'entete' }, logo(), h('h1', {}, titre), droite);
}

/** En-tête d'une sous-page : flèche de retour vers `vers` (hash), puis le titre. */
export function enteteRetour(titre, vers, droite = null) {
  return h(
    'header',
    { class: 'entete' },
    h('a', { class: 'bouton-icone', href: vers, 'aria-label': 'Retour' }, piRetour()),
    h('h1', {}, titre),
    droite,
  );
}

/** Ligne de réglage : titre, explication, contenu dessous, élément à droite. */
export function rangee({ titre, texte, droite, enfants }) {
  return h(
    'div',
    { class: 'reglage' },
    h('div', { class: 'texte' }, h('div', { class: 'titre' }, titre), texte ? h('div', { class: 'note' }, texte) : null, enfants),
    droite,
  );
}

/** Interrupteur (role switch) dans une ligne de réglage. */
export function interrupteur({ titre, texte, actif, surChange, desactive = false, enfants }) {
  const bouton = h('button', {
    type: 'button',
    role: 'switch',
    class: 'interrupteur',
    'aria-checked': String(!!actif),
    'aria-label': titre,
    disabled: desactive,
    onclick: () => {
      const suite = bouton.getAttribute('aria-checked') !== 'true';
      bouton.setAttribute('aria-checked', String(suite));
      surChange(suite);
    },
  });
  return rangee({ titre, texte, droite: bouton, enfants });
}

/** Boutons à choix unique (taille du texte, thème…). */
export function segments(options, actuel, surChoix) {
  const conteneur = h('div', { class: 'segments' });
  for (const o of options) {
    conteneur.append(
      h(
        'button',
        {
          type: 'button',
          class: o.valeur === actuel ? 'actif' : '',
          'aria-pressed': String(o.valeur === actuel),
          onclick: () => {
            for (const b of conteneur.children) {
              b.classList.remove('actif');
              b.setAttribute('aria-pressed', 'false');
            }
            const b = conteneur.children[options.indexOf(o)];
            b.classList.add('actif');
            b.setAttribute('aria-pressed', 'true');
            surChoix(o.valeur);
          },
        },
        o.nom,
      ),
    );
  }
  return conteneur;
}

/**
 * Feuille : fenêtre posée en bas de l'écran sur un voile (au centre sur grand écran).
 * Renvoie { el, fermer }. `surFermer` est appelé quand on touche le voile ou qu'on ferme.
 */
export function ouvrirFeuille(contenu, { surFermer, fermable = true, classe = '' } = {}) {
  const feuille = h('div', { class: 'feuille ' + classe, role: 'dialog', 'aria-modal': 'true' }, contenu);
  const voile = h('div', { class: 'voile' }, feuille);
  let ferme = false;
  const fermer = () => {
    if (ferme) return;
    ferme = true;
    voile.remove();
    document.removeEventListener('keydown', echap);
    surFermer?.();
  };
  const echap = (e) => {
    if (e.key === 'Escape' && fermable) fermer();
  };
  voile.addEventListener('click', (e) => {
    if (e.target === voile && fermable) fermer();
  });
  document.addEventListener('keydown', echap);
  document.body.append(voile);
  feuille.querySelector('button, [href], input')?.focus({ preventScroll: true });
  return { el: feuille, fermer };
}

// ─── Toast ──────────────────────────────────────────────────────────────────

let minuterieToast = null;

/**
 * Message bref (confirmations, alertes d'autres parties). Il s'insère en haut de l'appli, dans le flux de la page :
 * il décale le contenu le temps de son affichage mais ne recouvre jamais un bouton. (L'écran de jeu, lui,
 * affiche ses messages dans sa consigne.)
 */
export function toast(message, { erreur = false, duree = 3200 } = {}) {
  let el = document.getElementById('toast');
  if (!el) {
    el = h('div', { id: 'toast', class: 'toast', role: 'status', 'aria-live': 'polite' });
  }
  const appli = document.getElementById('appli') || document.body;
  if (el.parentNode !== appli) appli.prepend(el);
  el.textContent = message;
  el.classList.toggle('erreur', erreur);
  el.hidden = false;
  clearTimeout(minuterieToast);
  minuterieToast = setTimeout(() => (el.hidden = true), duree);
}

// ─── Avatar ─────────────────────────────────────────────────────────────────

// Icône de chaque joueur déjà lu (identifiant, ou null s'il n'en a pas), gardée le temps de la session.
const connues = new Map();
const lectures = new Map();
let lecteur = null;

/** La fonction qui lit la fiche d'un joueur (api.lireJoueur), fournie au démarrage. */
export function definirLecteurJoueurs(f) {
  lecteur = f;
}

/** Retient l'icône d'un joueur lue ailleurs (liste des joueurs, sa propre fiche). */
export function retenirIcone(uid, icone) {
  if (uid) connues.set(uid, icone ?? null);
}

export function iconeConnue(uid) {
  return uid ? connues.get(uid) : undefined;
}

/** Lit (une fois) l'icône d'un joueur ; renvoie une promesse de son identifiant ou null. */
export function chargerIcone(uid) {
  if (!uid || !lecteur) return Promise.resolve(null);
  if (connues.has(uid)) return Promise.resolve(connues.get(uid));
  if (!lectures.has(uid)) {
    lectures.set(
      uid,
      Promise.resolve()
        .then(() => lecteur(uid))
        .then((j) => {
          connues.set(uid, j?.icone ?? null);
          return j?.icone ?? null;
        })
        .catch(() => null)
        .finally(() => lectures.delete(uid)),
    );
  }
  return lectures.get(uid);
}

/**
 * Rond d'un joueur : l'icône qu'il a choisie, sinon l'initiale de son pseudo (🤖 pour une IA).
 * `fond` : couleur du rond (état de la partie, couleur des pions…).
 */
export function avatar({ uid = null, nom = '?', ia = false, fond = null, icone = undefined, petit = false } = {}) {
  const el = h('div', { class: 'avatar' + (petit ? ' petit' : ''), 'aria-hidden': 'true', style: fond ? { background: fond } : null });
  const poser = (id) => {
    const emoji = ia ? EMOJI_IA : emojiIcone(id);
    el.classList.toggle('avatar-icone', !!emoji);
    el.textContent = emoji || (nom || '?').slice(0, 1).toUpperCase();
  };
  poser(icone !== undefined ? icone : iconeConnue(uid));
  if (!ia && icone === undefined && uid && !connues.has(uid)) chargerIcone(uid).then(poser);
  return el;
}
