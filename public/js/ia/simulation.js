// Moteur de règles « rapide » à l'usage exclusif de l'IA.
//
// Il reproduit fidèlement les règles de moteur/regles.js (mêmes coups, même format), mais
// travaille sur des tableaux nus (pions : 16 entiers) et renvoie directement, pour chaque
// coup, le plateau obtenu. Cela évite de cloner l'état complet (pile, etc.) des milliers de
// fois par seconde pendant la recherche.
//
// Le coup finalement joué par l'IA est toujours revalidé avec validerCoup du vrai moteur ;
// tests/ia.test.js vérifie en outre que ce générateur produit exactement les mêmes coups
// (mêmes plateaux obtenus) que coupsLegaux sur des milliers de positions.

export const BASE = -1;
export const ALLEE = 100;
export const DISTANCE_ENTREE = 3;

/** Case d'entrée de l'allée de la couleur o (3 cases avant sa case de départ). */
export const entree = (o) => (o * 16 - DISTANCE_ENTREE + 64) & 63;

/** Rangs indexés : 0 = A, 1..9 = 2..10, 10 = V, 11 = D, 12 = R. */
export const RANGS_IA = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'V', 'D', 'R'];
export const R_A = 0;
export const R_4 = 3;
export const R_5 = 4;
export const R_7 = 6;
export const R_V = 10;
export const R_D = 11;
export const R_R = 12;

const INDEX_RANG = new Map(RANGS_IA.map((r, i) => [r, i]));

/** Index de rang (0..12) d'une carte « rang + couleur ». */
export function indexRang(carte) {
  return INDEX_RANG.get(carte.slice(0, -1));
}

/** Pas possibles (avance simple) par index de rang. */
export const PAS_RANG = [[1, 11], [2], [3], [], [5], [6], [], [8], [9], [10], [], [12], [13]];

export function finiPions(pions, s) {
  const b = s * 4;
  return pions[b] >= ALLEE && pions[b + 1] >= ALLEE && pions[b + 2] >= ALLEE && pions[b + 3] >= ALLEE;
}

export function couleurActivePions(pions, s) {
  return finiPions(pions, s) ? (s + 2) & 3 : s;
}

/** Tableau d'occupation du circuit : occ[case] = pion ou -1. */
export function occupation(pions, occ = new Int8Array(64)) {
  occ.fill(-1);
  for (let q = 0; q < 16; q++) {
    const p = pions[q];
    if (p >= 0 && p < 64) occ[p] = q;
  }
  return occ;
}

function alleeOccupee(pions, o, k) {
  const b = o * 4;
  const pos = ALLEE + k;
  return pions[b] === pos || pions[b + 1] === pos || pions[b + 2] === pos || pions[b + 3] === pos;
}

const NUL = -1000;

/**
 * Avance du pion g (miroir de resoudreAvance du moteur).
 * @param capt tableau où sont ajoutées les captures
 * @returns nouvelle position ou NUL
 */
function resoudre(pions, occ, g, pas, versAllee, sept, capt) {
  const p = pions[g];
  if (p === BASE) return NUL;
  const o = g >> 2;
  if (p >= ALLEE) {
    const k = p - ALLEE;
    const dest = k + pas;
    if (dest >= 4) return NUL;
    for (let i = k + 1; i <= dest; i++) if (alleeOccupee(pions, o, i)) return NUL;
    return ALLEE + dest;
  }
  const n0 = capt.length;
  if (versAllee) {
    const d = (entree(o) - p + 64) & 63;
    const r = pas - d;
    if (r < 1 || r > 4) return NUL;
    for (let i = 1; i <= d; i++) {
      const q = occ[(p + i) & 63];
      if (q >= 0) {
        if (pions[q] === (q >> 2) * 16) {
          capt.length = n0;
          return NUL;
        }
        if (sept) capt.push(q);
      }
    }
    for (let k = 0; k < r; k++) {
      if (alleeOccupee(pions, o, k)) {
        capt.length = n0;
        return NUL;
      }
    }
    return ALLEE + r - 1;
  }
  for (let i = 1; i <= pas; i++) {
    const q = occ[(p + i) & 63];
    if (q >= 0) {
      if (pions[q] === (q >> 2) * 16) {
        capt.length = n0;
        return NUL;
      }
      if (sept || i === pas) capt.push(q);
    }
  }
  return (p + pas) & 63;
}

function resoudreRecul(pions, occ, g, capt) {
  const p = pions[g];
  if (p < 0 || p >= 64) return NUL;
  for (let i = 1; i <= 4; i++) {
    const q = occ[(p - i + 64) & 63];
    if (q >= 0) {
      if (pions[q] === (q >> 2) * 16) return NUL;
      if (i === 4) capt.push(q);
    }
  }
  return (p - 4 + 64) & 63;
}

const echangeable = (pions, q) => pions[q] >= 0 && pions[q] < 64 && pions[q] !== (q >> 2) * 16;

function poser(pions, g, pos, capt) {
  const np = pions.slice();
  for (let i = 0; i < capt.length; i++) np[capt[i]] = BASE;
  np[g] = pos;
  return np;
}

const tampon = [];
const occTemp = new Int8Array(64);

function genererAvance(pions, occ, c, carte, pas, sortie) {
  for (let g = c * 4; g < c * 4 + 4; g++) {
    const p = pions[g];
    if (p === BASE) continue;
    if (p >= ALLEE) {
      tampon.length = 0;
      const pos = resoudre(pions, occ, g, pas, true, false, tampon);
      if (pos !== NUL) sortie.push({ coup: { t: 'avance', carte, pion: g, pas, allee: true }, pions: poser(pions, g, pos, tampon), captures: [] });
      continue;
    }
    tampon.length = 0;
    let pos = resoudre(pions, occ, g, pas, false, false, tampon);
    if (pos !== NUL) {
      const capt = tampon.slice();
      sortie.push({ coup: { t: 'avance', carte, pion: g, pas, allee: false }, pions: poser(pions, g, pos, capt), captures: capt });
    }
    tampon.length = 0;
    pos = resoudre(pions, occ, g, pas, true, false, tampon);
    if (pos !== NUL) sortie.push({ coup: { t: 'avance', carte, pion: g, pas, allee: true }, pions: poser(pions, g, pos, tampon), captures: [] });
  }
}

/** Regroupe les étapes consécutives d'un même pion (comme le moteur). */
function fusionnerEtapes(etapes) {
  const fusion = [];
  for (const e of etapes) {
    const d = fusion[fusion.length - 1];
    if (d && d.pion === e.pion) {
      d.pas += e.pas;
      d.allee = e.allee;
    } else fusion.push({ pion: e.pion, pas: e.pas, allee: e.allee });
  }
  return fusion;
}

const gagnePions = (pions, s) => finiPions(pions, s) && finiPions(pions, (s + 2) & 3);

/**
 * Énumère toutes les façons distinctes (par plateau final) de jouer un 7 : en entier, ou
 * jusqu'à la victoire de l'équipe (les points restants sont alors perdus).
 */
function genererSept(pions, s, carte, sortie, limite) {
  const finals = new Set();
  const vus = new Set();
  const etapes = [];
  const captTot = [];
  const explorer = (pi, reste) => {
    if (sortie.length >= limite) return;
    const cle = pi.join(',');
    if (reste === 0 || (reste < 7 && gagnePions(pi, s))) {
      if (!finals.has(cle)) {
        finals.add(cle);
        sortie.push({ coup: { t: 'sept', carte, etapes: fusionnerEtapes(etapes) }, pions: pi, captures: captTot.slice() });
      }
      return;
    }
    const cleReste = cle + '|' + reste;
    if (vus.has(cleReste)) return;
    vus.add(cleReste);
    const occ = occupation(pi, new Int8Array(64));
    const c = finiPions(pi, s) ? (s + 2) & 3 : s;
    for (let g = c * 4; g < c * 4 + 4; g++) {
      const p = pi[g];
      if (p === BASE) continue;
      for (let pas = 1; pas <= reste; pas++) {
        for (let mode = 0; mode < 2; mode++) {
          if (p >= ALLEE && mode === 1) break;
          const versAllee = p >= ALLEE || mode === 1;
          const capt = [];
          const pos = resoudre(pi, occ, g, pas, versAllee, true, capt);
          if (pos === NUL) continue;
          etapes.push({ pion: g, pas, allee: versAllee });
          const n0 = captTot.length;
          for (const q of capt) captTot.push(q);
          explorer(poser(pi, g, pos, capt), reste - pas);
          captTot.length = n0;
          etapes.pop();
        }
      }
    }
  };
  explorer(pions, 7);
}

/**
 * Tous les coups légaux du siège s avec une carte (hors défausse), chacun avec son plateau :
 * { coup, pions, captures }.
 * @param limiteSept nombre maximal de variantes de 7 (Infinity : toutes)
 */
export function coupsCarte(pions, s, carte, cinqAdverse, sortie = [], limiteSept = Infinity, occ = null) {
  const ir = indexRang(carte);
  if (!occ) occ = occupation(pions, occTemp);
  const c = couleurActivePions(pions, s);
  switch (ir) {
    case R_A:
    case R_R: {
      for (let g = c * 4; g < c * 4 + 4; g++) {
        if (pions[g] === BASE) {
          const depart = c * 16;
          const q = occ[depart];
          const capt = q >= 0 ? [q] : [];
          sortie.push({ coup: { t: 'sortie', carte, pion: g }, pions: poser(pions, g, depart, capt), captures: capt });
          break;
        }
      }
      for (const pas of PAS_RANG[ir]) genererAvance(pions, occ, c, carte, pas, sortie);
      break;
    }
    case R_V: {
      for (let a = c * 4; a < c * 4 + 4; a++) {
        if (!echangeable(pions, a)) continue;
        for (let b = 0; b < 16; b++) {
          if (b >> 2 !== c && echangeable(pions, b)) {
            const np = pions.slice();
            np[a] = pions[b];
            np[b] = pions[a];
            sortie.push({ coup: { t: 'echange', carte, pion: a, cible: b }, pions: np, captures: [] });
          }
        }
      }
      break;
    }
    case R_7:
      genererSept(pions, s, carte, sortie, sortie.length + limiteSept);
      break;
    case R_4: {
      for (let g = c * 4; g < c * 4 + 4; g++) {
        tampon.length = 0;
        const pos = resoudreRecul(pions, occ, g, tampon);
        if (pos !== NUL) {
          const capt = tampon.slice();
          sortie.push({ coup: { t: 'recul', carte, pion: g }, pions: poser(pions, g, pos, capt), captures: capt });
        }
      }
      break;
    }
    default: {
      for (const pas of PAS_RANG[ir]) genererAvance(pions, occ, c, carte, pas, sortie);
      if (ir === R_5 && cinqAdverse) {
        for (let g = 0; g < 16; g++) {
          if (((g >> 2) & 1) === (s & 1) || !echangeable(pions, g)) continue;
          tampon.length = 0;
          const pos = resoudre(pions, occ, g, 5, false, false, tampon);
          if (pos !== NUL) {
            const capt = tampon.slice();
            sortie.push({ coup: { t: 'avance', carte, pion: g, pas: 5, allee: false }, pions: poser(pions, g, pos, capt), captures: capt });
          }
        }
      }
    }
  }
  return sortie;
}

/**
 * Coups possibles avec une main (une carte par rang), ou défausses si rien n'est jouable.
 * Chaque résultat porte en plus `ir` (index de rang de la carte jouée).
 */
export function coupsMain(pions, s, main, cinqAdverse, limiteSept = Infinity) {
  const sortie = [];
  let vus = 0;
  const occ = occupation(pions, new Int8Array(64));
  for (const carte of main) {
    const ir = indexRang(carte);
    if (vus & (1 << ir)) continue;
    vus |= 1 << ir;
    const n0 = sortie.length;
    coupsCarte(pions, s, carte, cinqAdverse, sortie, limiteSept, occ);
    for (let i = n0; i < sortie.length; i++) sortie[i].ir = ir;
  }
  if (sortie.length > 0) return sortie;
  vus = 0;
  for (const carte of main) {
    const ir = indexRang(carte);
    if (vus & (1 << ir)) continue;
    vus |= 1 << ir;
    sortie.push({ coup: { t: 'defausse', carte }, pions, captures: [], ir });
  }
  return sortie;
}

export function equipeGagnantePions(pions) {
  if (finiPions(pions, 0) && finiPions(pions, 2)) return 0;
  if (finiPions(pions, 1) && finiPions(pions, 3)) return 1;
  return -1;
}
