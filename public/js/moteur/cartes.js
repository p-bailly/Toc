// Cartes du jeu de Toc : 52 cartes, sans joker.
// Une carte est une chaîne « rang + couleur », par exemple "AP", "10C", "VK".

export const COULEURS = ['P', 'C', 'K', 'T']; // Pique, Cœur, Karreau, Trèfle
export const RANGS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'V', 'D', 'R'];
export const SYMBOLES = { P: '♠', C: '♥', K: '♦', T: '♣' };

/** Rang d'une carte : 'A', '2'…'10', 'V', 'D', 'R'. */
export function rang(carte) {
  return carte.slice(0, -1);
}

/** Couleur d'une carte : 'P', 'C', 'K' ou 'T'. */
export function couleurCarte(carte) {
  return carte.slice(-1);
}

export function estCarte(carte) {
  return typeof carte === 'string' && RANGS.includes(rang(carte)) && COULEURS.includes(couleurCarte(carte));
}

export function paquetNeuf() {
  const paquet = [];
  for (const c of COULEURS) for (const r of RANGS) paquet.push(r + c);
  return paquet;
}

/** Mélange de Fisher-Yates ; renvoie un nouveau tableau. */
export function melanger(cartes, rng = Math.random) {
  const t = cartes.slice();
  for (let i = t.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [t[i], t[j]] = [t[j], t[i]];
  }
  return t;
}

/** Cycle de distribution : 5 cartes, puis 4, puis 4 (52 cartes), puis on remélange. */
export const TAILLES_DONNE = [5, 4, 4];

export function tailleDonne(donne) {
  return TAILLES_DONNE[donne % 3];
}

/**
 * Mélange un paquet neuf et le répartit pour les trois donnes d'un cycle.
 * @returns {string[][][]} cycle[d][siege] = main du siège pour la d-ième donne du cycle
 */
export function distribuerCycle(rng = Math.random) {
  const paquet = melanger(paquetNeuf(), rng);
  let i = 0;
  return TAILLES_DONNE.map((taille) => {
    const mains = [[], [], [], []];
    for (let k = 0; k < taille; k++) for (let s = 0; s < 4; s++) mains[s].push(paquet[i++]);
    return mains;
  });
}

/** Générateur pseudo-aléatoire déterministe (mulberry32), pour les tests et les simulations. */
export function generateurAleatoire(graine) {
  let a = graine >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Main effective d'un joueur à partir de données immuables (utile en réseau) :
 * cartes distribuées, moins la carte donnée au partenaire, plus la carte reçue,
 * moins les cartes déjà jouées (présentes dans la pile).
 */
export function mainEffective(distribuees, donnee, recue, pile) {
  const jouees = new Set(pile);
  const main = distribuees.filter((c) => c !== donnee);
  if (recue) main.push(recue);
  return main.filter((c) => !jouees.has(c));
}
