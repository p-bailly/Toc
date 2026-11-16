// Icônes que chaque joueur choisit dans les Réglages (section du compte) : elles remplacent l'initiale de son
// pseudo, chez tous les joueurs. Le réseau ne garde que l'identifiant, jamais le dessin : un identifiant inconnu
// redonne l'initiale. Même catalogue que l'appli Scrabble (emojis d'Unicode 9 au plus, lisibles sur les vieux
// téléphones).

/** Longueur maximale d'un identifiant d'icône. */
export const LONGUEUR_ICONE = 12;

export const ICONES = [
  { id: 'renard', emoji: '🦊', nom: 'Renard' },
  { id: 'chat', emoji: '🐱', nom: 'Chat' },
  { id: 'chien', emoji: '🐶', nom: 'Chien' },
  { id: 'ours', emoji: '🐻', nom: 'Ours' },
  { id: 'panda', emoji: '🐼', nom: 'Panda' },
  { id: 'lapin', emoji: '🐰', nom: 'Lapin' },
  { id: 'hibou', emoji: '🦉', nom: 'Hibou' },
  { id: 'grenouille', emoji: '🐸', nom: 'Grenouille' },
  { id: 'tortue', emoji: '🐢', nom: 'Tortue' },
  { id: 'manchot', emoji: '🐧', nom: 'Manchot' },
  { id: 'lion', emoji: '🦁', nom: 'Lion' },
  { id: 'koala', emoji: '🐨', nom: 'Koala' },
  { id: 'papillon', emoji: '🦋', nom: 'Papillon' },
  { id: 'coccinelle', emoji: '🐞', nom: 'Coccinelle' },
  { id: 'dauphin', emoji: '🐬', nom: 'Dauphin' },
  { id: 'tournesol', emoji: '🌻', nom: 'Tournesol' },
  { id: 'tulipe', emoji: '🌷', nom: 'Tulipe' },
  { id: 'trefle', emoji: '🍀', nom: 'Trèfle' },
  { id: 'pomme', emoji: '🍎', nom: 'Pomme' },
  { id: 'croissant', emoji: '🥐', nom: 'Croissant' },
  { id: 'cafe', emoji: '☕', nom: 'Café' },
  { id: 'etoile', emoji: '⭐', nom: 'Étoile' },
  { id: 'voilier', emoji: '⛵', nom: 'Voilier' },
  { id: 'livres', emoji: '📚', nom: 'Livres' },
];

/** Emoji des places tenues par une IA. */
export const EMOJI_IA = '🤖';

const parId = new Map(ICONES.map((i) => [i.id, i]));

/** L'emoji d'une icône ; undefined sans icône ou pour un identifiant inconnu (on montre alors l'initiale). */
export const emojiIcone = (id) => (id ? parId.get(id)?.emoji : undefined);
