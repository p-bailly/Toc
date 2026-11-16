// Cartes du jeu de Toc : 52 cartes, sans joker (jeu à 4).
// Une carte est une chaîne « rang + couleur », par exemple "AP", "10C", "VK".
// Jeu à 3 joueurs : 54 cartes, les 52 plus deux jokers 'J1' et 'J2' (rang 'J'). Un joker
// copie une carte déjà posée pendant la donne en cours (voir regles.js).

export const COULEURS = ['P', 'C', 'K', 'T']; // Pique, Cœur, Karreau, Trèfle
export const RANGS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'V', 'D', 'R'];
export const SYMBOLES = { P: '♠', C: '♥', K: '♦', T: '♣' };

/** Rang d'une carte : 'A', '2'…'10', 'V', 'D', 'R'. */
export function rang(carte) {
  return typeof carte === 'string' ? carte.slice(0, -1) : '';
}

/** Couleur d'une carte : 'P', 'C', 'K' ou 'T'. */
export function couleurCarte(carte) {
  return typeof carte === 'string' ? carte.slice(-1) : '';
}

export function estCarte(carte) {
  return typeof carte === 'string' && RANGS.includes(rang(carte)) && COULEURS.includes(couleurCarte(carte));
}

/** Rang des jokers (jeu à 3). */
export const RANG_JOKER = 'J';
export const JOKERS = ['J1', 'J2'];

export function estJoker(carte) {
  return carte === 'J1' || carte === 'J2';
}

/** La carte fait-elle partie du paquet du jeu à `nbJoueurs` joueurs (jokers à 3) ? */
export function estCarteDuJeu(carte, nbJoueurs = 4) {
  return estCarte(carte) || (nbJoueurs === 3 && estJoker(carte));
}

/** Paquet neuf : 52 cartes à 4 joueurs, 54 (avec 'J1' et 'J2') à 3. */
export function paquetNeuf(nbJoueurs = 4) {
  const paquet = [];
  for (const c of COULEURS) for (const r of RANGS) paquet.push(r + c);
  if (nbJoueurs === 3) paquet.push(...JOKERS);
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
/** Cycle à 3 joueurs : 5, 4, 4, 5 (18 cartes chacun, 54 cartes), puis on remélange. */
export const TAILLES_DONNE_3 = [5, 4, 4, 5];

/** Tailles des donnes d'un cycle. */
export function taillesDonne(nbJoueurs = 4) {
  return nbJoueurs === 3 ? TAILLES_DONNE_3 : TAILLES_DONNE;
}

/** Nombre de donnes d'un cycle (entre deux mélanges) : 3 à 4 joueurs, 4 à 3 joueurs. */
export function longueurCycle(nbJoueurs = 4) {
  return taillesDonne(nbJoueurs).length;
}

export function tailleDonne(donne, nbJoueurs = 4) {
  const tailles = taillesDonne(nbJoueurs);
  return tailles[donne % tailles.length];
}

/**
 * Mélange un paquet neuf et le répartit pour les donnes d'un cycle.
 * @returns {string[][][]} cycle[d][siege] = main du siège pour la d-ième donne du cycle
 */
export function distribuerCycle(rng = Math.random, nbJoueurs = 4) {
  const paquet = melanger(paquetNeuf(nbJoueurs), rng);
  let i = 0;
  return taillesDonne(nbJoueurs).map((taille) => {
    const mains = Array.from({ length: nbJoueurs }, () => []);
    for (let k = 0; k < taille; k++) for (let s = 0; s < nbJoueurs; s++) mains[s].push(paquet[i++]);
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
 * cartes distribuées, moins la carte donnée (au partenaire, ou au voisin à 3), plus la carte reçue,
 * moins les cartes déjà jouées (présentes dans la pile).
 */
export function mainEffective(distribuees, donnee, recue, pile) {
  const jouees = new Set(pile);
  const main = distribuees.filter((c) => c !== donnee);
  if (recue) main.push(recue);
  return main.filter((c) => !jouees.has(c));
}
