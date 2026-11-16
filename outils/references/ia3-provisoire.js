// Copie figée de l’IA provisoire à un coup du jeu à 3 (public/js/ia/ia3.js avant sa
// généralisation), conservée comme adversaire de référence pour outils/tournoi.js.
// IA PROVISOIRE du jeu à 3 joueurs (chacun pour soi).
//
// ⚠ Provisoire : l'IA forte (ia.js) ne sait jouer qu'à 4 ; elle sera généralisée plus tard et
// remplacera ce fichier. Ici, une IA simple « à un coup » : chaque coup légal est appliqué
// (apercuCoup) et le plateau obtenu est noté (avancement de ses pions, sorties, rentrées,
// captures, avancement des adversaires, menaces évidentes sur ses pions), moins le coût de la
// carte utilisée (on ménage les jokers, as, rois et 7). Le joker est développé pour chaque rang
// copiable : le choix du rang copié découle de la même note. Toujours légale : elle ne joue
// que des coups fournis par coupsLegauxMain.
//
// Mêmes paramètres que choisirDon / choisirCoup (ia.js) :
//   choisirDon3(etat, siege, main, options)  → carte à donner au voisin
//   choisirCoup3(etat, siege, main, options) → coup (options.rng : départage des égalités)

import {
  BASE, ALLEE, DISTANCE_ENTREE, rang, estJoker, caseDepart, caseEntree, nbCases, coupsLegauxMain,
  apercuCoup,
} from '../../public/js/moteur/index.js';

/** Avancement d'un pion du siège o (0 en base ; plus grand = plus près de la fin). */
function avancement(pos, o, N) {
  if (pos === BASE) return 0;
  if (pos >= ALLEE) return N + 30 + 3 * (pos - ALLEE);
  let d = (pos - caseDepart(o) + N) % N;
  // entre la case d'entrée (exclue) et la case de départ : il faut refaire un tour
  if (d > N - DISTANCE_ENTREE) d -= N;
  return 12 + d;
}

/** Le pion du siège o en `pos` est-il à portée d'un pion adverse ? (estimation simple) */
function menace(pions, pos, o, N) {
  if (pos < 0 || pos >= ALLEE || pos === caseDepart(o)) return 0;
  let m = 0;
  for (let q = 0; q < pions.length; q++) {
    const s = q >> 2;
    if (s === o) continue;
    const x = pions[q];
    if (x === BASE) {
      if (pos === caseDepart(s)) m = Math.max(m, 0.5); // sortie d'un as ou d'un roi
      continue;
    }
    if (x >= ALLEE) continue;
    const d = (pos - x + N) % N; // distance en avant de l'adversaire jusqu'à ce pion
    if (d >= 1 && d <= 13 && d !== 4) m = Math.max(m, d <= 7 ? 1 : 0.6);
    if ((x - pos + N) % N === 4) m = Math.max(m, 0.8); // recul de 4
  }
  return m;
}

function noterPlateau(pions, siege) {
  const nb = pions.length >> 2;
  const N = nbCases(nb);
  let note = 0;
  for (let q = 0; q < pions.length; q++) {
    const o = q >> 2;
    const v = avancement(pions[q], o, N);
    if (o === siege) {
      note += v;
      if (pions[q] !== BASE && pions[q] < ALLEE) {
        // pion prêt à rentrer : petit bonus s'il est juste avant l'entrée
        const d = (caseEntree(o, nb) - pions[q] + N) % N;
        if (d <= 8) note += 3;
        note -= 0.45 * v * menace(pions, pions[q], o, N);
      }
    } else {
      note -= 0.55 * v;
    }
  }
  const rentres = [0, 1, 2, 3].filter((i) => pions[4 * siege + i] >= ALLEE).length;
  if (rentres === 4) note += 10000;
  for (let s = 0; s < nb; s++) {
    if (s === siege) continue;
    const r = [0, 1, 2, 3].filter((i) => pions[4 * s + i] >= ALLEE).length;
    if (r === 3) note -= 20; // adversaire proche de la victoire
  }
  return note;
}

/** Valeur d'une carte gardée en main (plus grand = plus utile à garder). */
function valeurCarte(carte, etat, siege) {
  const r = estJoker(carte) ? 'J' : rang(carte);
  const pions = etat.pions;
  const enBase = [0, 1, 2, 3].filter((i) => pions[4 * siege + i] === BASE).length;
  switch (r) {
    case 'J':
      return 9;
    case 'A':
    case 'R':
      return enBase > 0 ? 8 : 4;
    case '7':
      return 6;
    case '4':
      return 5;
    case 'V':
      return 4;
    default:
      return 2 + (Number(r) || 0) / 10;
  }
}

/** Carte donnée au voisin (un adversaire à 3) : la moins utile pour soi. */
export function choisirDon3(etat, siege, main, options = {}) {
  const rng = options.rng || Math.random;
  let meilleure = null;
  let min = Infinity;
  for (const carte of main) {
    // on évite d'offrir à l'adversaire de quoi sortir ou un joker
    const nuisance = estJoker(carte) ? 3 : ['A', 'R'].includes(rang(carte)) ? 1.5 : rang(carte) === '7' ? 1 : 0;
    const v = valeurCarte(carte, etat, siege) + nuisance + rng() * 0.01;
    if (v < min) {
      min = v;
      meilleure = carte;
    }
  }
  return meilleure;
}

/** Coup choisi par l'IA provisoire à 3 joueurs (toujours un coup de coupsLegauxMain). */
export function choisirCoup3(etat, siege, main, options = {}) {
  const rng = options.rng || Math.random;
  const coups = coupsLegauxMain(etat, siege, main);
  if (coups.length === 1) return coups[0];
  if (coups[0].t === 'defausse') {
    // défausse : la carte la moins utile (un joker sans copie possible reste précieux)
    let choix = coups[0];
    let min = Infinity;
    for (const c of coups) {
      const v = valeurCarte(c.carte, etat, siege) + rng() * 0.01;
      if (v < min) {
        min = v;
        choix = c;
      }
    }
    return choix;
  }
  // Coût de la carte : on garde les cartes précieuses quand une carte ordinaire fait aussi bien.
  let meilleur = coups[0];
  let max = -Infinity;
  for (const coup of coups) {
    const res = apercuCoup(etat, siege, coup);
    if (!res) continue;
    let note = noterPlateau(res.pions, siege);
    note -= 0.6 * valeurCarte(coup.carte, etat, siege);
    note += rng() * 0.05;
    if (note > max) {
      max = note;
      meilleur = coup;
    }
  }
  return meilleur;
}
