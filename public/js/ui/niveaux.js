// Niveaux de force des IA (liste fournie par l'IA : ia.js → NIVEAUX, NIVEAU_DEFAUT) et petits composants pour
// les choisir et les afficher, sur le modèle de l'appli Scrabble (« Niveau : ★★★★★  [Changer] », puis la liste
// des cinq niveaux avec leur description). Un niveau s'affiche en étoiles, de 1 à 5. Une place d'IA sans niveau (anciennes parties) vaut le niveau par défaut.

import { h, lire, ecrire } from './dom.js';
import { NIVEAUX as LISTE, NIVEAU_DEFAUT as DEFAUT } from '../ia/ia.js';

export const NIVEAUX = Array.isArray(LISTE) && LISTE.length ? LISTE : [{ id: 'champion', nom: 'Champion', description: '' }];
export const NIVEAU_DEFAUT = typeof DEFAUT === 'string' ? DEFAUT : NIVEAUX[NIVEAUX.length - 1].id;

const parId = new Map(NIVEAUX.map((n) => [n.id, n]));

/** Identifiant valide d'un niveau (le niveau par défaut si absent ou inconnu). */
export const niveauValide = (id) => (parId.has(id) ? id : NIVEAU_DEFAUT);
/** Force d'un niveau, de 1 (le plus faible) à 5 (le plus fort). */
export const forceNiveau = (id) => {
  const i = NIVEAUX.findIndex((n) => n.id === niveauValide(id));
  return NIVEAUX.length > 1 ? 1 + Math.round((i * 4) / (NIVEAUX.length - 1)) : 5;
};
/** Niveau affiché : de 1 à 5 étoiles pleines (« ★★★ »), sans étoiles vides. */
export const nomNiveau = (id) => '★'.repeat(forceNiveau(id));
/** Le même, en toutes lettres pour les lecteurs d'écran : « 3 étoiles sur 5 ». */
export const niveauEnLettres = (id) => {
  const n = forceNiveau(id);
  return `${n} étoile${n > 1 ? 's' : ''} sur 5`;
};
/** Nom d'une place d'IA avec son niveau : « IA Est · ★★★★ ». */
export const nomAvecNiveau = (place) => (place?.ia ? `${place.pseudo || 'IA'} · ${nomNiveau(place.niveau)}` : place?.pseudo || '');

// ─── Mémoire des derniers choix ─────────────────────────────────────────────

const CLE_LOCAL = 'toc.niveauxIA';
const CLE_EN_LIGNE = 'toc.niveauIAEnLigne';

/** Derniers niveaux choisis contre l'IA : { adversaires, partenaire } (partenaire null = comme les adversaires). */
export function niveauxLocaux() {
  const v = lire(CLE_LOCAL, null) || {};
  return { adversaires: niveauValide(v.adversaires), partenaire: v.partenaire && parId.has(v.partenaire) ? v.partenaire : null };
}
export function ecrireNiveauxLocaux(v) {
  ecrire(CLE_LOCAL, { adversaires: niveauValide(v.adversaires), partenaire: v.partenaire ? niveauValide(v.partenaire) : null });
}
/** Dernier niveau choisi pour une IA d'une partie en ligne. */
export const niveauEnLigne = () => niveauValide(lire(CLE_EN_LIGNE, null));
export const ecrireNiveauEnLigne = (id) => ecrire(CLE_EN_LIGNE, niveauValide(id));

// ─── Composants ─────────────────────────────────────────────────────────────

/** Liste des cinq niveaux, en étoiles ; toucher un niveau appelle surChoix(id). */
export function listeNiveaux(actuel, surChoix) {
  return h(
    'div',
    { class: 'liste liste-niveaux', role: 'radiogroup' },
    NIVEAUX.map((n) =>
      h(
        'button',
        {
          type: 'button',
          role: 'radio',
          class: 'ligne' + (n.id === actuel ? ' choisie' : ''),
          'aria-checked': String(n.id === actuel),
          'data-niveau': n.id,
          onclick: () => surChoix(n.id),
        },
        h('div', { class: 'principal' }, h('div', { class: 'mot etoiles', 'aria-label': niveauEnLettres(n.id) }, nomNiveau(n.id))),
      ),
    ),
  );
}

/**
 * Ligne « Titre : Niveau  [Changer] » qui déplie la liste des niveaux (comme dans l'appli Scrabble).
 * `ouvert` / `surOuvrir` permettent de garder la liste ouverte d'un rendu à l'autre.
 */
export function choixNiveau({ titre, actuel, note = '', ouvert = false, surOuvrir, surChoix, cle }) {
  const bloc = h('div', { class: 'choix-niveau', 'data-choix-niveau': cle });
  const ligne = h(
    'div',
    { class: 'reglage' },
    h('div', { class: 'texte' }, h('div', { class: 'titre' }, `${titre} : `, h('b', { class: 'etoiles', 'aria-label': niveauEnLettres(actuel) }, nomNiveau(actuel))), note ? h('div', { class: 'note' }, note) : null),
    h('button', { type: 'button', class: 'bouton', 'aria-expanded': String(ouvert), 'data-action': 'changer-niveau', onclick: () => surOuvrir(!ouvert) }, ouvert ? 'Fermer' : 'Changer'),
  );
  bloc.append(ligne);
  if (ouvert) bloc.append(listeNiveaux(actuel, surChoix));
  return bloc;
}
