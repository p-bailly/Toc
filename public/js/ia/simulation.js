// Moteur de règles « rapide » à l'usage exclusif de l'IA (jeu à 4 et jeu à 3).
//
// Il reproduit fidèlement les règles de moteur/regles.js (mêmes coups, même format), mais
// travaille sur des tableaux nus (pions : 16 entiers à 4 joueurs, 12 à 3) et renvoie
// directement, pour chaque coup, le plateau obtenu. Cela évite de cloner l'état complet
// (pile, etc.) des milliers de fois par seconde pendant la recherche.
//
// Le nombre de joueurs se lit sur le plateau : n = pions.length / 4, circuit de 16 × n cases.
// À 3 joueurs : pas de partenaire (on ne joue jamais pour un autre), le valet et le « 5 adverse »
// visent n'importe quel autre joueur, et le joker copie un rang déjà posé dans la donne :
// les rangs copiables sont passés sous forme de masque de bits (bit r = rang d'index r).
//
// Le coup finalement joué par l'IA est toujours revalidé avec validerCoup du vrai moteur ;
// tests/ia.test.js vérifie en outre que ce générateur produit exactement les mêmes coups
// (mêmes plateaux obtenus) que coupsLegaux sur des milliers de positions, dans les deux modes.

export const BASE = -1;
export const ALLEE = 100;
export const DISTANCE_ENTREE = 3;

/** Nombre de cases du circuit pour un plateau donné. */
export const casesPlateau = (pions) => pions.length * 4;

/** Case d'entrée de l'allée de la couleur o (3 cases avant sa case de départ) ; N = nb de cases. */
export const entree = (o, N = 64) => (o * 16 - DISTANCE_ENTREE + N) % N;

/** Rangs indexés : 0 = A, 1..9 = 2..10, 10 = V, 11 = D, 12 = R, 13 = joker (jeu à 3). */
export const RANGS_IA = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'V', 'D', 'R', 'J'];
export const R_A = 0;
export const R_4 = 3;
export const R_5 = 4;
export const R_7 = 6;
export const R_V = 10;
export const R_D = 11;
export const R_R = 12;
export const R_J = 13;

const INDEX_RANG = new Map(RANGS_IA.map((r, i) => [r, i]));

/** Index de rang (0..13) d'une carte « rang + couleur », ou d'un joker ('J1', 'J2'). */
export function indexRang(carte) {
  return INDEX_RANG.get(carte.slice(0, -1));
}

/** Masque de bits des rangs copiables, à partir de la liste de rangs du moteur. */
export function masqueCopiables(rangs) {
  let m = 0;
  for (const r of rangs) m |= 1 << INDEX_RANG.get(r);
  return m;
}

/** Pas possibles (avance simple) par index de rang. */
export const PAS_RANG = [[1, 11], [2], [3], [], [5], [6], [], [8], [9], [10], [], [12], [13], []];

export function finiPions(pions, s) {
  const b = s * 4;
  return pions[b] >= ALLEE && pions[b + 1] >= ALLEE && pions[b + 2] >= ALLEE && pions[b + 3] >= ALLEE;
}

/** Couleur déplacée par s : la sienne, ou celle du partenaire s'il a fini (jeu à 4 seulement). */
export function couleurActivePions(pions, s) {
  return pions.length === 16 && finiPions(pions, s) ? (s + 2) & 3 : s;
}

/** Les sièges a et b sont-ils dans le même camp ? (équipes à 4, chacun pour soi à 3) */
export const memeCamp = (pions, a, b) => (pions.length === 16 ? (a & 1) === (b & 1) : a === b);

/** Tableau d'occupation du circuit : occ[case] = pion ou -1. */
export function occupation(pions, occ = new Int8Array(64)) {
  occ.fill(-1);
  const N = pions.length * 4;
  for (let q = 0; q < pions.length; q++) {
    const p = pions[q];
    if (p >= 0 && p < N) occ[p] = q;
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
  const N = pions.length * 4;
  const n0 = capt.length;
  if (versAllee) {
    const d = (entree(o, N) - p + N) % N;
    const r = pas - d;
    if (r < 1 || r > 4) return NUL;
    for (let i = 1; i <= d; i++) {
      const q = occ[(p + i) % N];
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
    const q = occ[(p + i) % N];
    if (q >= 0) {
      if (pions[q] === (q >> 2) * 16) {
        capt.length = n0;
        return NUL;
      }
      if (sept || i === pas) capt.push(q);
    }
  }
  return (p + pas) % N;
}

function resoudreRecul(pions, occ, g, capt) {
  const N = pions.length * 4;
  const p = pions[g];
  if (p < 0 || p >= N) return NUL;
  for (let i = 1; i <= 4; i++) {
    const q = occ[(p - i + N) % N];
    if (q >= 0) {
      if (pions[q] === (q >> 2) * 16) return NUL;
      if (i === 4) capt.push(q);
    }
  }
  return (p - 4 + N) % N;
}

const echangeable = (pions, q) => pions[q] >= 0 && pions[q] < pions.length * 4 && pions[q] !== (q >> 2) * 16;

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

/** Clé compacte d'un plateau (un caractère par pion). */
export function clePions(p) {
  if (p.length === 12) {
    return String.fromCharCode(
      p[0] + 2, p[1] + 2, p[2] + 2, p[3] + 2, p[4] + 2, p[5] + 2,
      p[6] + 2, p[7] + 2, p[8] + 2, p[9] + 2, p[10] + 2, p[11] + 2,
    );
  }
  return String.fromCharCode(
    p[0] + 2, p[1] + 2, p[2] + 2, p[3] + 2, p[4] + 2, p[5] + 2, p[6] + 2, p[7] + 2,
    p[8] + 2, p[9] + 2, p[10] + 2, p[11] + 2, p[12] + 2, p[13] + 2, p[14] + 2, p[15] + 2,
  );
}

const occParProfondeur = Array.from({ length: 8 }, () => new Int8Array(64));

/** Énumère toutes les façons distinctes (par plateau final) de jouer un 7 en entier. */
function genererSept(pions, s, carte, sortie, limite) {
  const finals = new Set();
  const vus = new Set();
  const etapes = [];
  const captTot = [];
  const explorer = (pi, reste) => {
    if (sortie.length >= limite) return;
    const cle = clePions(pi);
    if (reste === 0) {
      if (!finals.has(cle)) {
        finals.add(cle);
        sortie.push({ coup: { t: 'sept', carte, etapes: fusionnerEtapes(etapes) }, pions: pi, captures: captTot.slice() });
      }
      return;
    }
    const cleReste = cle + reste;
    if (vus.has(cleReste)) return;
    vus.add(cleReste);
    const occ = occupation(pi, occParProfondeur[7 - reste]);
    const c = couleurActivePions(pi, s);
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

/** Coups d'un rang donné (index ir, 0..12) joués avec la carte `carte`. */
function coupsRang(pions, s, carte, ir, cinqAdverse, sortie, limiteSept, occ) {
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
        if (pions[a] < 0 || pions[a] >= pions.length * 4) continue; // le sien : même protégé sur sa case de départ
        for (let b = 0; b < pions.length; b++) {
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
        for (let g = 0; g < pions.length; g++) {
          if (memeCamp(pions, g >> 2, s) || !echangeable(pions, g)) continue;
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
}

/**
 * Tous les coups légaux du siège s avec une carte (hors défausse), chacun avec son plateau :
 * { coup, pions, captures } (+ `comme` : index du rang copié, pour un joker).
 * @param copiables  masque des rangs copiables par un joker (jeu à 3)
 * @param limiteSept nombre maximal de variantes de 7 (Infinity : toutes)
 */
export function coupsCarte(pions, s, carte, cinqAdverse, sortie = [], limiteSept = Infinity, occ = null, copiables = 0) {
  const ir = indexRang(carte);
  if (!occ) occ = occupation(pions, occTemp);
  if (ir !== R_J) {
    coupsRang(pions, s, carte, ir, cinqAdverse, sortie, limiteSept, occ);
    return sortie;
  }
  for (let r = 0; r < 13; r++) {
    if (!(copiables & (1 << r))) continue;
    const n0 = sortie.length;
    coupsRang(pions, s, carte, r, cinqAdverse, sortie, limiteSept, occ);
    for (let i = n0; i < sortie.length; i++) {
      // même forme que le moteur : { t, carte, comme, ...reste }
      const { t, carte: _c, ...reste } = sortie[i].coup;
      sortie[i].coup = { t, carte, comme: RANGS_IA[r], ...reste };
      sortie[i].comme = r;
    }
  }
  return sortie;
}

/**
 * Coups possibles avec une main (une carte par rang), ou défausses si rien n'est jouable.
 * Chaque résultat porte en plus `ir` (index de rang de la carte jouée, 13 pour un joker) et,
 * pour un joker joué, `comme` (index du rang copié).
 */
export function coupsMain(pions, s, main, cinqAdverse, limiteSept = Infinity, copiables = 0) {
  const sortie = [];
  let vus = 0;
  const occ = occupation(pions, new Int8Array(64));
  for (const carte of main) {
    const ir = indexRang(carte);
    if (vus & (1 << ir)) continue;
    vus |= 1 << ir;
    const n0 = sortie.length;
    coupsCarte(pions, s, carte, cinqAdverse, sortie, limiteSept, occ, copiables);
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

/** Rang effectif d'un coup joué (index) : le rang copié pour un joker, -1 pour une défausse de joker. */
export function rangEffectif(res) {
  if (res.ir !== R_J) return res.ir;
  return res.coup.t === 'defausse' ? -1 : res.comme;
}

/**
 * Gagnant : à 4 joueurs, l'équipe (0 ou 1) dont les deux joueurs ont fini ; à 3, le siège qui a
 * fini ; -1 sinon.
 */
export function equipeGagnantePions(pions) {
  if (pions.length === 12) {
    for (let s = 0; s < 3; s++) if (finiPions(pions, s)) return s;
    return -1;
  }
  if (finiPions(pions, 0) && finiPions(pions, 2)) return 0;
  if (finiPions(pions, 1) && finiPions(pions, 3)) return 1;
  return -1;
}
