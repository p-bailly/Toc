// À importer en premier par les tests écrits pour le plateau de 16 cases entre deux cases de départ (64 cases à
// 4 joueurs, 48 à 3), celui des premières parties : leurs positions sont écrites en dur. Les nouvelles parties se
// jouent sur 18 cases (voir public/js/moteur/plateau.js) ; les tests de ce plateau-là sont dans les fichiers
// « *-18.test.js » et dans ceux qui n'importent pas ce fichier.
import { plateauParDefaut } from '../public/js/moteur/plateau.js';

plateauParDefaut(16);
