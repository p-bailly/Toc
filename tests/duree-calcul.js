// Durée d'un calcul synchrone, mesurée de façon à ne pas dépendre de la charge de la machine.
//
// Le temps d'horloge compte les moments où le processus attend son tour : sur une machine chargée (plusieurs
// npm test à la fois), un calcul de 4 ms en paraît 10 ou 15. Le temps processeur du processus ne compte pas ces
// attentes, mais il compte en plus les fils auxiliaires de V8 (compilation, ramasse-miettes), qui travaillent
// en parallèle : il dépasse parfois le temps d'horloge. Aucun des deux ne sous-estime la durée d'un calcul
// qui ne fait que calculer ; on retient le plus petit. Sur une machine au repos, c'est le temps d'horloge.

/**
 * Exécute `calcul` (synchrone, sans attente d'entrée-sortie) et renvoie { resultat, duree } ; duree en ms.
 */
export function chronometrer(calcul) {
  const processeur0 = process.cpuUsage();
  const horloge0 = performance.now();
  const resultat = calcul();
  const horloge = performance.now() - horloge0;
  const processeur = process.cpuUsage(processeur0);
  return { resultat, duree: Math.min(horloge, (processeur.user + processeur.system) / 1000) };
}
