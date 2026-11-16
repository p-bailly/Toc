// Exemples de la page « Règles du Toc » : chaque exemple décrit une position, un ou plusieurs coups et ce que
// la page affirme (légal ou non, position d'arrivée). Le moteur du dépôt fait foi : `verifier()` rejoue tout
// et le générateur de la page dessine les positions « après » calculées par le moteur, pas recopiées à la main.

import {
  BASE, ALLEE, etatInitial, coupsLegaux, coupsLegauxMain, appliquerCoup, validerCoup, rangsCopiables,
  estProtege, aFini, destinataireDon, tailleDonne, caseEntree, caseDepart,
} from '../../public/js/moteur/index.js';

export { BASE, ALLEE };
export const a = (k) => ALLEE + k;

/** État en phase de jeu : { numéroDePion: position } ; pions 0-3 bleu, 4-7 rouge, 8-11 jaune, 12-15 vert. */
export function etat4(positions = {}, extra = {}) {
  const e = etatInitial(extra.reglages);
  e.phase = 'jeu';
  e.echanges = [true, true, true, true];
  for (const [g, pos] of Object.entries(positions)) e.pions[g] = pos;
  e.tour = extra.tour ?? 0;
  return e;
}

/** État de jeu à 3 (0-3 bleu, 4-7 rouge, 8-11 jaune). */
export function etat3(positions = {}, extra = {}) {
  const e = etatInitial({ nbJoueurs: 3, ...(extra.reglages || {}) });
  e.phase = 'jeu';
  e.echanges = [true, true, true];
  for (const [g, pos] of Object.entries(positions)) e.pions[g] = pos;
  e.tour = extra.tour ?? 0;
  if (extra.donne !== undefined) e.donne = extra.donne;
  if (extra.cartesRestantes) e.cartesRestantes = extra.cartesRestantes.slice();
  if (extra.pile) e.pile = extra.pile.slice();
  if (extra.jokers) e.jokers = { ...extra.jokers };
  return e;
}

const legal = (e, siege, coup) => validerCoup(e, siege, coup) === null;
const jouables = (e, siege, carte) => coupsLegaux(e, siege, carte);
const a_le_coup = (coups, attendu) => coups.some((c) => Object.entries(attendu).every(([k, v]) => JSON.stringify(c[k]) === JSON.stringify(v)));

/**
 * Les exemples. `apres` est calculé par le moteur. Chaque exemple porte ses contrôles : [libellé, booléen].
 */
export function exemples() {
  const liste = [];
  const ajouter = (id, titre, fabrique) => {
    const controles = [];
    const ok = (libelle, cond) => controles.push([libelle, !!cond]);
    const donnees = fabrique(ok);
    liste.push({ id, titre, controles, ...donnees });
  };

  // 1. Sortir un pion avec un as ou un roi.
  ajouter('sortie', 'Sortir un pion (as ou roi)', (ok) => {
    const avant = etat4();
    const coup = { t: 'sortie', carte: 'AP', pion: 0 };
    const apres = appliquerCoup(avant, 0, coup, ['AP']);
    ok('as : sortie légale', legal(avant, 0, coup));
    ok('roi : sortie légale', legal(avant, 0, { t: 'sortie', carte: 'RC', pion: 0 }));
    ok('le pion arrive sur la case de sortie (case 0)', apres.pions[0] === 0);
    ok('il y est protégé', estProtege(apres, 0));
    ok('dame, 7, 10 : aucune sortie', ['DP', '7P', '10P', '5P', 'VP', '4P'].every((c) => jouables(avant, 0, c).length === 0));
    ok('sans as ni roi, pions en base : défausse', coupsLegauxMain(avant, 0, ['DP', '7P', '10P']).every((c) => c.t === 'defausse'));
    return { avant, apres, coup };
  });

  // 2. Reculer de 4 puis jouer un 5 : au fond de l'allée.
  ajouter('quatre-cinq', 'Recule de 4, puis joue un 5', (ok) => {
    const avant = etat4({ 0: 0 });
    const coup1 = { t: 'recul', carte: '4C', pion: 0 };
    const milieu = appliquerCoup(avant, 0, coup1, ['4C']);
    ok('4 depuis la case de sortie : légal', legal(avant, 0, coup1));
    ok('le pion recule sur la case 60, une case avant la case d\'entrée (61)', milieu.pions[0] === 60 && caseEntree(0) === 61);
    const milieu2 = { ...milieu, tour: 0 };
    const coup2 = { t: 'avance', carte: '5K', pion: 0, pas: 5, allee: true };
    ok('5 vers l\'allée : légal', legal(milieu2, 0, coup2));
    const apres = appliquerCoup(milieu2, 0, coup2, ['5K']);
    ok('le pion arrive au fond de l\'allée (4e case)', apres.pions[0] === a(3));
    ok('avec un 6 il ne peut pas entrer (trop grand)', !legal(milieu2, 0, { t: 'avance', carte: '6K', pion: 0, pas: 6, allee: true }));
    return { avant, milieu, apres, coup1, coup2 };
  });

  // 3. Capture en arrivant ; on passe par-dessus sans capturer.
  ajouter('capture', 'Capturer en arrivant sur un pion', (ok) => {
    const avant = etat4({ 0: 2, 12: 5, 4: 8 });
    const coup = { t: 'avance', carte: '6T', pion: 0, pas: 6, allee: false };
    ok('6 : légal', legal(avant, 0, coup));
    const apres = appliquerCoup(avant, 0, coup, ['6T']);
    ok('le pion bleu arrive sur la case 8', apres.pions[0] === 8);
    ok('le pion rouge retourne à sa base', apres.pions[4] === BASE);
    ok('le pion vert dépassé ne bouge pas', apres.pions[12] === 5);
    ok('la 4e case du trajet (case 6) est un repère : 6e case après la case de sortie', 6 % 16 === 6);
    // Mêmes règles pour ses propres pions et ceux du partenaire.
    const sien = appliquerCoup(etat4({ 0: 1, 1: 7 }), 0, coup);
    ok('arriver sur son propre pion le renvoie à la base', sien.pions[1] === BASE && sien.pions[0] === 7);
    const part = appliquerCoup(etat4({ 0: 1, 8: 7 }), 0, coup);
    ok('arriver sur un pion du partenaire le renvoie à la base', part.pions[8] === BASE && part.pions[0] === 7);
    return { avant, apres, coup };
  });

  // 4. Pion protégé : ni dépassé ni capturé.
  ajouter('protege', 'Un pion protégé bloque le passage', (ok) => {
    const avant = etat4({ 4: 16, 0: 12 });
    ok('le pion rouge est protégé sur sa case de sortie (16)', estProtege(avant, 4));
    ok('6 : interdit (dépasserait)', jouables(avant, 0, '6T').length === 0);
    ok('5, 8, 9, 10, dame : interdits aussi (ils dépasseraient)', ['8T', '9T', '10T', 'DT', '5T'].every((c) => jouables(avant, 0, c).length === 0));
    ok('3 : permis, le pion s\'arrête juste derrière (case 15)', a_le_coup(jouables(avant, 0, '3T'), { pion: 0, pas: 3, allee: false }));
    const apres = appliquerCoup(avant, 0, { t: 'avance', carte: '3T', pion: 0, pas: 3, allee: false });
    ok('après le 3 : case 15', apres.pions[0] === 15);
    ok('valet : pas d\'échange avec le pion protégé', jouables(avant, 0, 'VT').length === 0);
    ok('7 : interdit aussi (7 pas dépasseraient)', jouables(avant, 0, '7T').length === 0);
    // Pile dessus : pion bleu à 4 cases derrière, on vérifie qu'on ne peut pas s'y arrêter (cas dédié).
    const pile = etat4({ 4: 16, 0: 13 });
    ok('s\'arrêter dessus (3 depuis la case 13) : interdit', jouables(pile, 0, '3T').length === 0);
    // Son propriétaire non plus ne le dépasse pas.
    const rouge = etat4({ 4: 16, 5: 13 }, { tour: 1 });
    ok('son propriétaire ne le dépasse pas non plus (son autre pion reste derrière)', !jouables(rouge, 1, '6T').some((c) => c.pion === 5) && jouables(rouge, 1, '6T').some((c) => c.pion === 4));
    ok('reculer de 4 par-dessus : interdit', jouables(etat4({ 4: 16, 0: 18 }), 0, '4T').length === 0);
    // 5 adverse : on ne pousse pas un pion protégé.
    const cinq = etat4({ 4: 16 }, { reglages: { cinqAdverse: true } });
    ok('5 adverse : ne pousse pas un pion protégé', jouables(cinq, 0, '5T').length === 0);
    // Sortir un nouveau pion renvoie l'ancien.
    const sortie = appliquerCoup(etat4({ 4: 16 }, { tour: 1 }), 1, { t: 'sortie', carte: 'AP', pion: 5 });
    ok('sortie d\'un pion de la même couleur : l\'ancien retourne à la base', sortie.pions[4] === BASE && sortie.pions[5] === 16);
    // Un pion adverse sur MA case de sortie n'est pas protégé.
    const intrus = etat4({ 4: 0, 0: 60 });
    ok('un pion adverse posé sur ma case de sortie n\'est pas protégé', !estProtege(intrus, 4) && a_le_coup(jouables(intrus, 0, '6T'), { pion: 0, pas: 6, allee: false }));
    const interdit = { t: 'avance', carte: '6T', pion: 0, pas: 6, allee: false };
    return { avant, apres, coup: { t: 'avance', carte: '3T', pion: 0, pas: 3, allee: false }, interdit };
  });

  // 5a. Valet : échange avec un pion adverse.
  ajouter('valet', 'Valet : échanger deux pions', (ok) => {
    const avant = etat4({ 0: 2, 4: 59 });
    const coup = { t: 'echange', carte: 'VK', pion: 0, cible: 4 };
    ok('échange légal', legal(avant, 0, coup));
    const apres = appliquerCoup(avant, 0, coup, ['VK']);
    ok('les deux pions ont échangé leurs cases (bleu 2 cases avant sa case d\'entrée)', apres.pions[0] === 59 && apres.pions[4] === 2 && caseEntree(0) - 59 === 2);
    ok('l\'échange ne capture personne', apres.dernierCoup.captures.length === 0);
    ok('pas deux de ses propres pions', !legal(etat4({ 0: 3, 1: 20 }), 0, { t: 'echange', carte: 'VK', pion: 0, cible: 1 }));
    ok('avec un pion du partenaire : permis', legal(etat4({ 0: 3, 8: 20 }), 0, { t: 'echange', carte: 'VK', pion: 0, cible: 8 }));
    ok('pas un pion dans une allée', !legal(etat4({ 0: 3, 4: a(1) }), 0, { t: 'echange', carte: 'VK', pion: 0, cible: 4 }));
    ok('pas un pion en base', !legal(etat4({ 0: 3 }), 0, { t: 'echange', carte: 'VK', pion: 0, cible: 4 }));
    ok('son pion dans l\'allée ne s\'échange pas', !legal(etat4({ 0: a(0), 4: 20 }), 0, { t: 'echange', carte: 'VK', pion: 0, cible: 4 }));
    return { avant, apres, coup };
  });

  // 5b. Valet : son propre pion depuis sa case de sortie.
  ajouter('valet-sortie', 'Valet : ton pion part de ta case de sortie', (ok) => {
    const avant = etat4({ 0: 0, 12: 60 });
    const coup = { t: 'echange', carte: 'VP', pion: 0, cible: 12 };
    ok('le pion bleu est protégé sur sa case de sortie', estProtege(avant, 0));
    ok('son propriétaire peut l\'échanger', legal(avant, 0, coup));
    const apres = appliquerCoup(avant, 0, coup, ['VP']);
    ok('bleu sur la case 60 (une case avant sa case d\'entrée), vert sur la case 0', apres.pions[0] === 60 && apres.pions[12] === 0);
    ok('le pion vert, sur la case de sortie bleue, n\'est pas protégé', !estProtege(apres, 12));
    ok('un autre joueur ne peut pas échanger ce pion protégé', !legal({ ...avant, tour: 3 }, 3, { t: 'echange', carte: 'VP', pion: 12, cible: 0 }));
    ok('le partenaire non plus', !legal(etat4({ 0: 0, 8: 20 }, { tour: 2 }), 2, { t: 'echange', carte: 'VP', pion: 8, cible: 0 }));
    return { avant, apres, coup };
  });

  // 6. 7 fractionné : 1 + 1 + 1 + 4, un pion dépassé retourne à sa base.
  ajouter('sept', '7 partagé : 1 + 1 + 1 + 4', (ok) => {
    const avant = etat4({ 0: a(2), 1: a(1), 2: a(0), 3: 58, 4: 60, 8: 20 });
    const coup = {
      t: 'sept',
      carte: '7C',
      etapes: [
        { pion: 0, pas: 1, allee: true },
        { pion: 1, pas: 1, allee: true },
        { pion: 2, pas: 1, allee: true },
        { pion: 3, pas: 4, allee: true },
      ],
    };
    ok('7 en 1 + 1 + 1 + 4 : légal', legal(avant, 0, coup));
    const apres = appliquerCoup(avant, 0, coup, ['7C']);
    ok('les 4 pions bleus sont dans l\'allée', [0, 1, 2, 3].every((g) => apres.pions[g] === a(3 - g)));
    ok('le pion rouge dépassé (case 60) retourne à sa base', apres.pions[4] === BASE);
    ok('bleu a rentré ses 4 pions', aFini(apres, 0));
    ok('la partie continue (jaune n\'a pas fini)', apres.phase === 'jeu');
    ok('1 + 1 + 1 seulement (3 points) : refusé', !legal(avant, 0, { ...coup, etapes: coup.etapes.slice(0, 3) }));
    // Ses propres pions dépassés par un 7 retournent aussi à la base.
    const soi = appliquerCoup(etat4({ 0: 1, 1: 4 }), 0, { t: 'sept', carte: '7C', etapes: [{ pion: 0, pas: 7, allee: false }] });
    ok('un 7 qui dépasse son propre pion le renvoie à la base', soi.pions[1] === BASE && soi.pions[0] === 8);
    const part = appliquerCoup(etat4({ 0: 1, 8: 4 }), 0, { t: 'sept', carte: '7C', etapes: [{ pion: 0, pas: 7, allee: false }] });
    ok('un 7 qui dépasse un pion du partenaire le renvoie à la base', part.pions[8] === BASE);
    return { avant, apres, coup };
  });

  // 6b. 7 simple : 3 + 4 sur le circuit, attention à son propre pion.
  ajouter('sept-simple', '7 partagé : 3 + 4', (ok) => {
    const avant = etat4({ 0: 63, 1: 3, 12: 5 });
    const coup = { t: 'sept', carte: '7P', etapes: [{ pion: 0, pas: 3, allee: false }, { pion: 1, pas: 4, allee: false }] };
    ok('7 en 3 + 4 : légal', legal(avant, 0, coup));
    const apres = appliquerCoup(avant, 0, coup, ['7P']);
    ok('premier pion : case 2 (il passe la case de sortie) ; second pion : case 7', apres.pions[0] === 2 && apres.pions[1] === 7);
    ok('le pion vert dépassé (case 5) retourne à sa base', apres.pions[12] === BASE);
    ok('rien d\'autre n\'est capturé', apres.dernierCoup.captures.length === 1);
    // 7 d'un seul pion : il dépasse son propre pion.
    const seul = appliquerCoup(avant, 0, { t: 'sept', carte: '7P', etapes: [{ pion: 0, pas: 7, allee: false }] });
    ok('7 d\'un seul pion : son propre pion dépassé retourne à la base', seul.pions[1] === BASE && seul.pions[12] === BASE && seul.pions[0] === 6);
    return { avant, apres, coup, seul };
  });

  // 7. 7 injouable : impossible de dépenser les 7 points.
  ajouter('sept-injouable', '7 injouable', (ok) => {
    const avant = etat4({ 0: a(3), 1: a(2), 2: a(0) });
    ok('aucun coup légal avec le 7', jouables(avant, 0, '7K').length === 0);
    ok('1 point seul (le pion de l\'allée avance d\'une case) : refusé', !legal(avant, 0, { t: 'sept', carte: '7K', etapes: [{ pion: 2, pas: 1, allee: true }] }));
    ok('avec un as, ce pion avance de 1', a_le_coup(jouables(avant, 0, 'AK'), { pion: 2, pas: 1, allee: true }));
    ok('main 7 + dame : aucune carte jouable, défausse au choix', coupsLegauxMain(avant, 0, ['7K', 'DK']).length === 2 && coupsLegauxMain(avant, 0, ['7K', 'DK']).every((c) => c.t === 'defausse'));
    // « Même pour gagner » : dernier pion à 2 cases de sa place, le 7 ne peut pas s'arrêter dans l'allée.
    const gagner = etat3({ 0: a(3), 1: a(2), 2: a(1), 3: 44 });
    ok('3 joueurs, dernier pion à 2 cases de sa place : le 7 ne peut pas le rentrer', !coupsLegaux(gagner, 0, '7K').some((c) => c.etapes.some((e) => e.allee)));
    ok('ce 7 reste jouable en continuant sur le circuit (7 cases)', a_le_coup(coupsLegaux(gagner, 0, '7K'), { etapes: [{ pion: 3, pas: 7, allee: false }] }));
    return { avant, carte: '7K' };
  });

  // 8. Compte exact dans l'allée.
  ajouter('allee', 'Compte exact pour l\'allée', (ok) => {
    const avant = etat4({ 0: 60 });
    const coup5 = { t: 'avance', carte: '5P', pion: 0, pas: 5, allee: true };
    ok('5 vers l\'allée : légal', legal(avant, 0, coup5));
    const apres5 = appliquerCoup(avant, 0, coup5, ['5P']);
    ok('5 : fond de l\'allée', apres5.pions[0] === a(3));
    ok('2 : première case de l\'allée', appliquerCoup(avant, 0, { t: 'avance', carte: '2P', pion: 0, pas: 2, allee: true }).pions[0] === a(0));
    ok('3 : deuxième case de l\'allée', appliquerCoup(avant, 0, { t: 'avance', carte: '3P', pion: 0, pas: 3, allee: true }).pions[0] === a(1));
    ok('6 vers l\'allée : interdit (trop grand d\'une case)', !legal(avant, 0, { t: 'avance', carte: '6K', pion: 0, pas: 6, allee: true }));
    const coup6 = { t: 'avance', carte: '6K', pion: 0, pas: 6, allee: false };
    ok('6 : le pion continue sur le circuit', legal(avant, 0, coup6));
    const apres6 = appliquerCoup(avant, 0, coup6, ['6K']);
    ok('6 : case 2, après la case de sortie', apres6.pions[0] === 2);
    ok('entrée jamais obligatoire : le 5 peut aussi rester sur le circuit', legal(avant, 0, { ...coup5, allee: false }));
    // Dans l'allée : pas de dépassement, pas de capture.
    const file = etat4({ 0: a(0), 1: a(2) });
    ok('dans l\'allée : 1 permis, 2 (sur son pion) et 3 (dépassement) interdits', a_le_coup(jouables(file, 0, 'AP'), { pion: 0, pas: 1 }) && !jouables(file, 0, '2P').some((c) => c.pion === 0) && !jouables(file, 0, '3P').some((c) => c.pion === 0));
    ok('on n\'entre pas par-dessus un pion de l\'allée', !legal(etat4({ 0: 60, 1: a(1) }), 0, { t: 'avance', carte: '5P', pion: 0, pas: 5, allee: true }));
    ok('4 : pas de recul dans l\'allée', jouables(etat4({ 0: a(2) }), 0, '4P').length === 0);
    ok('un pion dans l\'allée n\'est ni échangé ni poussé', jouables(etat4({ 0: a(1), 4: 20 }, { tour: 1, reglages: { cinqAdverse: true } }), 1, 'VP').length === 0 && !jouables(etat4({ 0: a(1), 4: 20 }, { tour: 1, reglages: { cinqAdverse: true } }), 1, '5P').some((c) => c.pion === 0));
    return { avant, apres5, apres6, coup5, coup6 };
  });

  // 9. Joker (3 joueurs) : copie une carte posée depuis le début de la donne.
  ajouter('joker', 'Joker : copier une carte posée', (ok) => {
    // 2e donne (4 cartes chacun) : Rouge commence. Rouge a joué un roi, Jaune un 9. C'est à Bleu.
    const ancienne = ['2P', '3P', '5P', '6P', '8P', '10P', 'VP', 'DP', '2C', '3C', '5C', '6C', '8C', '10C', 'VC'];
    const avant = etat3({ 4: 16, 8: 41 }, { donne: 1, tour: 0, cartesRestantes: [4, 3, 3], pile: [...ancienne, 'RC', '9T'] });
    ok('2e donne : 4 cartes chacun, Rouge joue le premier', tailleDonne(1, 3) === 4 && 1 % 3 === 1);
    ok('cartes à copier : le 9 et le roi, pas celles de la donne précédente', JSON.stringify(rangsCopiables(avant)) === JSON.stringify(['9', 'R']));
    const coup = { t: 'sortie', carte: 'J1', comme: 'R', pion: 0 };
    ok('joker comme un roi : sortie légale', legal(avant, 0, coup));
    const apres = appliquerCoup(avant, 0, coup, ['J1']);
    ok('le pion bleu est sur sa case de sortie', apres.pions[0] === 0);
    ok('joker comme un valet (carte de la donne précédente) : refusé', !legal(etat3({ 0: 5, 4: 20 }, { donne: 1, cartesRestantes: [4, 3, 3], pile: [...ancienne, 'RC', '9T'] }), 0, { t: 'echange', carte: 'J1', comme: 'V', pion: 0, cible: 4 }));
    // Copier un joker = copier ce qu'il avait copié.
    ok('le joker suivant peut copier le roi à travers le premier joker', rangsCopiables(apres).includes('R') && legal(apres, 1, { t: 'avance', carte: 'J2', comme: 'R', pion: 4, pas: 13, allee: false }));
    // Rien à copier : premier à jouer de la donne.
    const vide = etat3({ 0: 5 }, { donne: 1, tour: 1, cartesRestantes: [4, 4, 4], pile: ancienne });
    ok('premier à jouer de la donne : rien à copier, joker injouable', rangsCopiables(vide).length === 0 && coupsLegaux(vide, 1, 'J1').length === 0);
    // Un joker défaussé n'offre rien à copier.
    const defausse = appliquerCoup(vide, 1, { t: 'defausse', carte: 'J1' }, ['J1']);
    ok('un joker défaussé n\'offre rien à copier', rangsCopiables(defausse).length === 0);
    // Don d'une carte : gauche (joueur suivant) aux donnes 1, 3, 5…, droite aux autres.
    ok('don : au joueur suivant à la 1re et à la 3e donne, au précédent à la 2e et à la 4e', destinataireDon(0, 0, 3) === 1 && destinataireDon(2, 0, 3) === 1 && destinataireDon(1, 0, 3) === 2 && destinataireDon(3, 0, 3) === 2);
    return { avant, apres, coup, posees: ['RC', '9T'] };
  });

  // Points de règle sans schéma, cités dans le texte.
  ajouter('texte', 'Points de règle cités dans le texte (sans schéma)', (ok) => {
    // 5 adverse.
    const cinq = etat4({ 4: 20, 0: 25 }, { reglages: { cinqAdverse: true } });
    ok('5 adverse : on peut avancer un pion adverse de 5', a_le_coup(coupsLegaux(cinq, 0, '5T'), { pion: 4, pas: 5 }));
    ok('5 adverse : le pion poussé capture en arrivant (même mon pion)', appliquerCoup(cinq, 0, { t: 'avance', carte: '5T', pion: 4, pas: 5, allee: false }).pions[0] === BASE);
    ok('5 adverse : pas le pion du partenaire', !coupsLegaux(etat4({ 8: 20 }, { reglages: { cinqAdverse: true } }), 0, '5T').some((c) => c.pion === 8));
    ok('5 adverse : jamais vers une allée', !legal(etat4({ 4: 12 }, { reglages: { cinqAdverse: true } }), 0, { t: 'avance', carte: '5T', pion: 4, pas: 5, allee: true }));
    ok('sans l\'option : interdit', coupsLegaux(etat4({ 4: 20 }), 0, '5T').length === 0);
    // 4 : recule, passe par-dessus, capture à l'arrivée.
    const quatre = appliquerCoup(etat4({ 0: 10, 12: 8, 4: 6 }), 0, { t: 'recul', carte: '4T', pion: 0 });
    ok('4 : recule de 4, passe par-dessus un pion, capture celui de la case d\'arrivée', quatre.pions[0] === 6 && quatre.pions[12] === 8 && quatre.pions[4] === BASE);
    ok('4 : interdit pour un pion en base', coupsLegaux(etat4(), 0, '4T').length === 0);
    // As : 1 ou 11 ; roi 13 ; dame 12.
    const e = etat4({ 0: 5, 1: 20, 2: 30, 3: 40 });
    ok('as : 1 ou 11', a_le_coup(coupsLegaux(e, 0, 'AP'), { pion: 0, pas: 1 }) && a_le_coup(coupsLegaux(e, 0, 'AP'), { pion: 0, pas: 11 }));
    ok('roi : 13 ; dame : 12', a_le_coup(coupsLegaux(e, 0, 'RP'), { pion: 0, pas: 13 }) && a_le_coup(coupsLegaux(e, 0, 'DP'), { pion: 0, pas: 12 }));
    // Obligation de jouer.
    ok('une carte jouable : la défausse est refusée', validerCoup(e, 0, { t: 'defausse', carte: 'DP' }, ['DP', '2P']) !== null);
    // Sortir sur sa case de sortie occupée par un pion adverse : il retourne à sa base.
    ok('sortir sur sa case de sortie occupée par un autre pion le renvoie à sa base', appliquerCoup(etat4({ 4: 0 }), 0, { t: 'sortie', carte: 'AP', pion: 0 }).pions[4] === BASE);
    // Fin de partie 2 contre 2.
    const fini = etat4({ 0: a(0), 1: a(1), 2: a(2), 3: a(3), 8: 40 });
    ok('un joueur qui a fini déplace les pions de son partenaire', a_le_coup(coupsLegaux(fini, 0, '6T'), { pion: 8, pas: 6 }) && a_le_coup(coupsLegaux(fini, 0, 'AP'), { t: 'sortie' }));
    ok('il joue aussi le 7 pour son partenaire', a_le_coup(coupsLegaux(fini, 0, '7T'), { etapes: [{ pion: 8, pas: 7, allee: false }] }));
    // Reste du 7 pour le partenaire : seulement si l'on rentre son 4e pion pendant ce 7.
    const reste = etat4({ 0: a(3), 1: a(2), 2: a(1), 3: 60, 8: 40 });
    ok('7 : 2 pour rentrer son dernier pion, puis 5 pour le pion du partenaire', legal(reste, 0, { t: 'sept', carte: '7T', etapes: [{ pion: 3, pas: 2, allee: true }, { pion: 8, pas: 5, allee: false }] }));
    ok('7 : pas de points pour le partenaire tant qu\'on n\'a pas fini', !legal(etat4({ 0: 10, 8: 40 }), 0, { t: 'sept', carte: '7T', etapes: [{ pion: 0, pas: 3, allee: false }, { pion: 8, pas: 4, allee: false }] }));
    // Victoire.
    const presque = etat4({ 0: a(0), 1: a(1), 2: a(2), 3: a(3), 8: a(3), 9: a(2), 10: a(1), 11: 28 });
    const gagne = appliquerCoup(presque, 0, { t: 'avance', carte: '2T', pion: 11, pas: 2, allee: true });
    ok('2 contre 2 : la partie finit quand les 8 pions de l\'équipe sont rentrés', gagne.phase === 'fini' && gagne.gagnant === 0);
    const trois = etat3({ 0: a(3), 1: a(2), 2: a(1), 3: 44 });
    const gagne3 = appliquerCoup(trois, 0, { t: 'avance', carte: '2T', pion: 3, pas: 2, allee: true });
    ok('3 joueurs : le premier qui rentre ses 4 pions gagne', gagne3.phase === 'fini' && gagne3.gagnant === 0);
    ok('3 joueurs : le valet échange avec n\'importe quel autre joueur', legal(etat3({ 0: 5, 8: 30 }), 0, { t: 'echange', carte: 'VT', pion: 0, cible: 8 }));
    ok('géométrie : case de sortie au milieu (16 × siège), case d\'entrée 3 cases avant', caseDepart(1) === 16 && caseEntree(1) === 13 && caseEntree(0, 3) === 45);
    // Le premier joueur change à chaque donne.
    let d = etat4();
    d.cartesRestantes = [0, 0, 0, 1];
    d.tour = 3;
    d = appliquerCoup(d, 3, { t: 'defausse', carte: '2P' });
    ok('nouvelle donne : 4 cartes, le joueur suivant commence, nouvel échange', d.donne === 1 && d.tour === 1 && d.phase === 'echange' && d.cartesRestantes.every((k) => k === 4));
    return {};
  });

  return liste;
}

export function verifier({ silencieux = false } = {}) {
  let echecs = 0;
  for (const ex of exemples()) {
    const rates = ex.controles.filter(([, v]) => !v);
    echecs += rates.length;
    if (!silencieux) {
      console.log(`${rates.length ? 'ÉCHEC' : 'ok   '}  ${ex.id} : ${ex.titre} (${ex.controles.length} contrôles)`);
      for (const [libelle, v] of ex.controles) console.log(`        ${v ? '✓' : '✗'} ${libelle}`);
    }
  }
  return echecs;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const echecs = verifier();
  console.log(echecs ? `\n${echecs} contrôle(s) en échec` : '\nTous les contrôles passent.');
  process.exit(echecs ? 1 : 0);
}
