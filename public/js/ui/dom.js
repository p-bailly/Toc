// Petits outils DOM : fabrication d'éléments, sans framework.

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Crée un élément HTML.
 *   h('button', { class: 'bouton', onclick: f, 'aria-label': 'Retour' }, 'texte', autreNoeud)
 * Les attributs `on…` posent des écouteurs ; `class`, `style` (chaîne ou objet), `hidden`, `disabled`… sont gérés.
 * Les enfants null, undefined ou false sont ignorés ; les tableaux sont aplatis.
 */
export function h(tag, attrs, ...enfants) {
  const el = document.createElement(tag);
  poser(el, attrs);
  ajouter(el, enfants);
  return el;
}

/** Même chose pour un élément SVG. */
export function s(tag, attrs, ...enfants) {
  const el = document.createElementNS(SVG_NS, tag);
  poser(el, attrs);
  ajouter(el, enfants);
  return el;
}

function poser(el, attrs) {
  if (!attrs) return;
  for (const [cle, valeur] of Object.entries(attrs)) {
    if (valeur === undefined || valeur === null || valeur === false) continue;
    if (cle.startsWith('on') && typeof valeur === 'function') {
      el.addEventListener(cle.slice(2), valeur);
    } else if (cle === 'style' && typeof valeur === 'object') {
      for (const [p, v] of Object.entries(valeur)) {
        if (p.startsWith('--')) el.style.setProperty(p, v);
        else el.style[p] = v;
      }
    } else if (cle === 'dataset') {
      Object.assign(el.dataset, valeur);
    } else if (valeur === true) {
      el.setAttribute(cle, '');
    } else {
      el.setAttribute(cle, String(valeur));
    }
  }
}

function ajouter(el, enfants) {
  for (const e of enfants.flat(Infinity)) {
    if (e === null || e === undefined || e === false) continue;
    el.append(e instanceof Node ? e : document.createTextNode(String(e)));
  }
}

/** Vide un élément et y place de nouveaux enfants. */
export function remplacer(el, ...enfants) {
  el.replaceChildren();
  ajouter(el, enfants);
}

/** Message d'erreur affichable (les erreurs du moteur et du réseau sont déjà en français). */
export function messageErreur(e) {
  if (!e) return 'Erreur inconnue.';
  return e instanceof Error ? e.message : String(e);
}

/** « 3 cartes », « 1 carte ». */
export const pluriel = (n, mot, motPluriel = mot + 's') => `${n} ${n > 1 ? motPluriel : mot}`;

/** « il y a 5 min », « hier »… */
export function ilYa(date) {
  const t = date instanceof Date ? date.getTime() : Number(date) || Date.now();
  const sec = Math.max(0, (Date.now() - t) / 1000);
  if (sec < 60) return 'à l’instant';
  const min = Math.floor(sec / 60);
  if (min < 60) return `il y a ${min} min`;
  const heures = Math.floor(min / 60);
  if (heures < 24) return `il y a ${heures} h`;
  const jours = Math.floor(heures / 24);
  if (jours === 1) return 'hier';
  if (jours < 30) return `il y a ${jours} jours`;
  return 'le ' + new Date(t).toLocaleDateString('fr-FR');
}

/** Lecture / écriture JSON dans localStorage, sans jamais lever d'erreur. */
export function lire(cle, defaut) {
  try {
    const brut = localStorage.getItem(cle);
    return brut === null ? defaut : JSON.parse(brut);
  } catch {
    return defaut;
  }
}
export function ecrire(cle, valeur) {
  try {
    localStorage.setItem(cle, JSON.stringify(valeur));
  } catch {
    /* stockage indisponible */
  }
}

export const mouvementReduit = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
