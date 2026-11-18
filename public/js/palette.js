// Palette des pions : dix couleurs, dont chaque joueur choisit la sienne en créant ou en rejoignant une partie.
// Logique pure, partagée par l'interface, la partie locale et le réseau (aucune dépendance).
//
// Une place garde la couleur choisie par son joueur (`joueurs[s].couleur`, un identifiant de la palette). Une place
// sans choix (IA, joueur d'une partie d'avant les couleurs) reçoit une couleur libre : celle d'origine de son siège
// si elle ne prête pas à confusion, sinon la première qui se distingue bien des couleurs déjà prises.
// `couleursDesSieges` fait ce calcul, le même chez tous les joueurs : tout le monde voit les mêmes couleurs.

/**
 * Les dix couleurs : { id, nom, pluriel (« les pions … »), valeur, fonce (contour des billes) }.
 * Les quatre premières sont celles d'origine des sièges 0 à 3 (bleu et jaune partenaires, contre rouge et vert).
 */
export const PALETTE = [
  { id: 'bleu', nom: 'bleu', pluriel: 'bleus', valeur: '#2f6fb5', fonce: '#153251' },
  { id: 'rouge', nom: 'rouge', pluriel: 'rouges', valeur: '#c8372d', fonce: '#5a1914' },
  { id: 'jaune', nom: 'jaune', pluriel: 'jaunes', valeur: '#e6a91b', fonce: '#674c0c' },
  { id: 'vert', nom: 'vert', pluriel: 'verts', valeur: '#3f8f4f', fonce: '#1c4024' },
  { id: 'violet', nom: 'violet', pluriel: 'violets', valeur: '#7b52ab', fonce: '#38224f' },
  { id: 'orange', nom: 'orange', pluriel: 'orange', valeur: '#e2731c', fonce: '#6a3208' },
  { id: 'turquoise', nom: 'turquoise', pluriel: 'turquoise', valeur: '#1f9e9e', fonce: '#0c4747' },
  { id: 'rose', nom: 'rose', pluriel: 'roses', valeur: '#dd6f9f', fonce: '#6b2746' },
  { id: 'gris', nom: 'gris', pluriel: 'gris', valeur: '#68737f', fonce: '#2b3138' },
  { id: 'marron', nom: 'marron', pluriel: 'marron', valeur: '#7d5233', fonce: '#36210f' },
];

/** Identifiants de la palette, dans l'ordre où une couleur libre est proposée. */
export const IDS_COULEURS = PALETTE.map((c) => c.id);
/** Couleur d'origine de chaque siège. */
export const COULEURS_ORIGINE = ['bleu', 'rouge', 'jaune', 'vert'];

const parId = new Map(PALETTE.map((c) => [c.id, c]));

export const couleurValide = (id) => typeof id === 'string' && parId.has(id);
/** La couleur d'un identifiant ; un identifiant inconnu redonne le bleu. */
export const couleurDe = (id) => parId.get(id) || PALETTE[0];

/** Couleurs trop voisines pour être données d'office à deux joueurs d'une même partie. */
const VOISINES = [
  ['rouge', 'orange'],
  ['orange', 'jaune'],
  ['rouge', 'rose'],
  ['rose', 'violet'],
  ['bleu', 'violet'],
  ['bleu', 'turquoise'],
  ['vert', 'turquoise'],
  ['orange', 'marron'],
  ['gris', 'marron'],
];
const voisines = (a, b) => VOISINES.some(([x, y]) => (x === a && y === b) || (x === b && y === a));

/**
 * Couleur de chaque siège, toutes différentes. `joueurs` : les places de la partie (null pour un siège libre),
 * `nb` : le nombre de sièges (par défaut celui de la liste). Un choix valable est gardé ; si deux places ont choisi
 * la même couleur, la première dans l'ordre des sièges la garde. Les autres places reçoivent une couleur libre,
 * les places occupées avant les places libres.
 */
export function couleursDesSieges(joueurs, nb = joueurs?.length || 4) {
  const places = Array.from({ length: nb }, (_, s) => joueurs?.[s] || null);
  const resultat = Array(nb).fill(null);
  const prises = new Set();
  places.forEach((p, s) => {
    if (p && couleurValide(p.couleur) && !prises.has(p.couleur)) {
      resultat[s] = p.couleur;
      prises.add(p.couleur);
    }
  });
  // Les places occupées d'abord : la couleur d'une IA ne dépend pas des places encore libres (dans une salle
  // d'attente, elle ne change pas quand quelqu'un s'assoit ailleurs ou change de place).
  const ordre = [...places.keys()].filter((s) => places[s]).concat([...places.keys()].filter((s) => !places[s]));
  for (const s of ordre) {
    if (resultat[s]) continue;
    const candidates = [COULEURS_ORIGINE[s], ...IDS_COULEURS].filter((id) => id && !prises.has(id));
    const nette = candidates.find((id) => ![...prises].some((autre) => voisines(id, autre)));
    resultat[s] = nette || candidates[0];
    prises.add(resultat[s]);
  }
  return resultat;
}

/**
 * Couleurs qu'un joueur ne peut pas choisir : celles que les AUTRES joueurs ont choisies eux-mêmes. Une couleur
 * donnée d'office (à une IA, par exemple) reste disponible : la place qui l'avait en reçoit une autre.
 */
export function couleursIndisponibles(joueurs, siege) {
  return (joueurs || []).filter((p, s) => p && s !== siege && couleurValide(p.couleur)).map((p) => p.couleur);
}
