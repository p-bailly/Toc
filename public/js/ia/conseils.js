// Conseils au joueur : quelle carte donner, quel coup jouer, et pourquoi (jeu à 4 et jeu à 3).
//
// Les notes viennent de la même recherche et de la même évaluation que l'IA (recherche.js,
// evaluation.js) ; les raisons sont tirées de faits vérifiés sur la position : captures
// effectives, entrées dans l'allée, variation mesurée du risque de capture, cartes gardées…
// À 3 joueurs, il n'y a pas de partenaire : on parle de « ton voisin de gauche » (siège suivant),
// « ton voisin de droite » (siège précédent), « le joueur en tête », « un adversaire ».

import { destinataireDon } from '../moteur/plateau.js';
import { preparer, infoMains, comptesRangs } from './recherche.js';
import { evaluerPlateau } from './evaluation.js';
import {
  coupsMain, indexRang, finiPions, entree, memeCamp, couleurActivePions, rangEffectif, BASE, ALLEE,
  R_A, R_4, R_7, R_R, R_J,
} from './simulation.js';

const NOMS_RANG = ['as', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'valet', 'dame', 'roi', 'joker'];
const ton = (ir) => (ir === 11 ? 'ta dame' : 'ton ' + NOMS_RANG[ir]);
const un = (ir) => (ir === 11 ? 'une dame' : 'un ' + NOMS_RANG[ir]);
const pct = (p) => `${Math.round(p * 100)} %`;
const distance = (g, p, N) => (entree(g >> 2, N) - p + N) % N;
const nomVoisin = (siege, autre) => (autre === (siege + 1) % 3 ? 'ton voisin de gauche' : 'ton voisin de droite');
/** Gain conventionnel d'un joker en début de donne (rien n'est encore copiable). */
const GAIN_JOKER = 9;
/** Jeu à 3 : poids du gain du voisin (un adversaire) dans le choix du don. */
const POIDS_ADVERSAIRE = 0.7;

// ---------------------------------------------------------------------------
// Don (au partenaire à 4, au voisin à 3)
// ---------------------------------------------------------------------------

/**
 * Note chaque rang de la main pour le don (utilisé par choisirDon), de la meilleure à la moins
 * bonne carte à donner.
 *  - à 4 : gain qu'en tire le partenaire (pondéré par la probabilité qu'il n'en ait pas déjà
 *    une) moins la perte pour soi ;
 *  - à 3 : le voisin est un adversaire ; on donne ce qui coûte le moins à soi ET rapporte le
 *    moins au voisin (selon son jeu visible : pions en base, proches de l'allée, exposés…).
 * @returns {Object[]} entrées triées : { carte, ir, note, gDest, gMoi, pManque, doubles, ... }
 */
export function noterDons(etat, siege, main, options = {}) {
  const prep = preparer(etat, siege, main, options);
  const nb = prep.n;
  const a3 = nb === 3;
  const dest = destinataireDon(etat.donne, siege, nb);
  const info = { n: etat.cartesRestantes.slice(), connu: [0, 0, 0, 0], nConnu: [0, 0, 0, 0] };
  const base = (s) => evaluerPlateau(etat.pions, s, (s + 1) % nb, info, prep.ctx);
  const gain = (s, carte) => {
    if (indexRang(carte) === R_J) return GAIN_JOKER; // copiera une carte posée pendant la donne
    const coups = coupsMain(etat.pions, s, [carte], prep.cinq, 60);
    if (coups[0].coup.t === 'defausse') return -3; // carte morte pour l'instant
    const v0 = base(s);
    let best = -Infinity;
    for (const c of coups) best = Math.max(best, evaluerPlateau(c.pions, s, (s + 1) % nb, info, prep.ctx) - v0);
    return best;
  };
  const comptes = comptesRangs(main);
  const entrees = [];
  const vus = new Set();
  for (const carte of main) {
    const ir = indexRang(carte);
    if (vus.has(ir)) continue;
    vus.add(ir);
    const sortie = ir === R_A || ir === R_R;
    // Le destinataire en profite d'autant plus qu'il n'a pas déjà une carte équivalente.
    const masque = sortie ? (1 << R_A) | (1 << R_R) : 1 << ir;
    const nDest = Math.min(6, Math.max(0, etat.cartesRestantes[dest] - 1));
    const pManque = prep.ctx.pAucune[nDest][prep.ctx.sommeMasque[masque]];
    const gDestBrut = gain(dest, carte);
    const gDest = gDestBrut > 0 ? gDestBrut * (0.35 + 0.65 * pManque) : gDestBrut;
    const gMoiBrut = gain(siege, carte);
    // On perd peu à donner une carte dont on garde un double (ou une autre carte de sortie).
    const doubles = sortie ? comptes[R_A] + comptes[R_R] : comptes[ir];
    const gMoi = doubles > 1 && gMoiBrut > 0 ? gMoiBrut * 0.3 : gMoiBrut;
    const note = a3 ? -gMoi - POIDS_ADVERSAIRE * Math.max(0, gDest) : gDest - gMoi;
    entrees.push({ carte, ir, note, gDest, gMoi, gDestBrut, gMoiBrut, pManque, doubles, sortie, dest });
  }
  entrees.sort((a, b) => b.note - a.note);
  return entrees;
}

export function raisonsDon(e, etat, siege) {
  const nb = etat.pions.length >> 2;
  const a3 = nb === 3;
  const p = e.dest;
  const lui = a3 ? nomVoisin(siege, p) : 'ton partenaire';
  const enBase = (s) => [0, 1, 2, 3].filter((k) => etat.pions[s * 4 + k] === BASE).length;
  const r = [];
  if (e.ir === R_J) {
    r.push('garde ton joker : il copiera une carte posée pendant la donne');
    if (a3) r.push(`un joker serait un cadeau précieux pour ${lui}`);
    return r;
  }
  if (!a3) {
    const partenaireSansPion = enBase(p) === 4 && !finiPions(etat.pions, p);
    if (e.sortie) {
      if (partenaireSansPion && e.gDestBrut > 0 && e.note > 0) r.push(`ton partenaire n'a aucun pion sorti : ${un(e.ir)} lui sert plus qu'à toi`);
      else if (enBase(p) > 0 && e.gDestBrut > 0) r.push(`ton partenaire a ${enBase(p)} pion${enBase(p) > 1 ? 's' : ''} en base : ${un(e.ir)} lui permet d'en sortir un`);
    }
  } else if (e.sortie && enBase(p) > 0 && e.gDestBrut > 0) {
    r.push(`${lui} a ${enBase(p)} pion${enBase(p) > 1 ? 's' : ''} en base : ${un(e.ir)} lui permettrait d'en sortir un`);
  }
  if (e.sortie) {
    if (e.doubles === 1 && enBase(siege) > 0 && e.gMoiBrut > 0) r.push(`c'est ta seule carte pour sortir un pion : tu en auras besoin`);
    else if (e.doubles > 1) r.push(`tu gardes une autre carte pour sortir tes pions`);
  } else if (e.doubles > 1) r.push(`tu en gardes un autre exemplaire`);
  if (e.gMoiBrut <= -3) r.push(`tu ne peux pas jouer ${ton(e.ir)} pour l'instant`);
  if (e.gDestBrut <= -3) r.push(`${lui} ne pourrait pas la jouer pour l'instant`);
  if (!a3 && r.length < 3 && e.gDestBrut > 0 && e.gDestBrut > e.gMoiBrut + 2) {
    r.push(`sur le plateau actuel, elle rapporterait ≈ ${Math.round(e.gDestBrut)} cases à ton partenaire, contre ${Math.round(Math.max(0, e.gMoiBrut))} à toi`);
  }
  if (a3 && r.length < 3 && e.gDestBrut > 0) {
    r.push(`sur le plateau actuel, elle rapporterait ≈ ${Math.round(e.gDestBrut)} cases à ${lui}${e.gMoiBrut > 0 ? ` et ≈ ${Math.round(e.gMoiBrut)} à toi` : ''}`);
  }
  if (!a3 && e.pManque < 0.5 && e.gDestBrut > 0 && r.length < 3) r.push(`ton partenaire a de bonnes chances d'en avoir déjà ${e.sortie ? 'une carte pour sortir' : 'une'}`);
  if (!r.length) {
    r.push(`sur le plateau actuel, elle rapporterait ≈ ${Math.round(Math.max(0, e.gDestBrut))} cases à ${lui} et ≈ ${Math.round(Math.max(0, e.gMoiBrut))} à toi`);
  }
  return r.slice(0, 3);
}

// ---------------------------------------------------------------------------
// Coup à jouer
// ---------------------------------------------------------------------------

export function raisonsCoup(prep, etat, siege, main, cand) {
  const coup = cand.res.coup;
  const avant = etat.pions;
  const apres = cand.res.pions;
  const nP = avant.length;
  const nb = nP >> 2;
  const N = nb * 16;
  const a3 = nb === 3;
  const ir = indexRang(coup.carte);
  const part = a3 ? -1 : (siege + 2) & 3;
  const pourPartenaire = !a3 && finiPions(avant, siege);
  const actif = couleurActivePions(avant, siege);
  const allie = (g) => memeCamp(avant, g >> 2, siege);
  const R = [];
  const dire = (poids, texte) => R.push({ poids, texte });

  // Risques avant (comme si l'on ne jouait pas) et après le coup, même information.
  const mainApres = cand.mainApres;
  const n = etat.cartesRestantes.slice();
  n[siege]--;
  const info = infoMains(n, siege, mainApres, prep.donneeEnMain, prep.destinataire);
  const dAv = {};
  const dAp = {};
  evaluerPlateau(avant, siege, (siege + 1) % nb, info, prep.ctx, dAv);
  evaluerPlateau(apres, siege, (siege + 1) % nb, info, prep.ctx, dAp);
  const risqueAv = (g) => (dAv.risque ? dAv.risque[g] : 0);
  const risqueAp = (g) => (dAp.risque ? dAp.risque[g] : 0);

  // Jeu à 3 : l'adversaire le plus fort (avant le coup) ; « en tête » s'il est devant soi.
  let tete = -1;
  if (a3 && dAv.force) {
    const a = (siege + 1) % 3;
    const b = (siege + 2) % 3;
    const t = dAv.force[a] >= dAv.force[b] ? a : b;
    if (dAv.force[t] >= dAv.force[siege] && Math.abs(dAv.force[a] - dAv.force[b]) >= 5) tete = t;
  }
  const nomAdverse = (o) => (o === tete ? 'un pion du joueur en tête' : 'un pion adverse');
  const nom = (g) => ((g >> 2) === siege ? 'ton pion' : (g >> 2) === part ? 'le pion de ton partenaire' : nomAdverse(g >> 2));

  if (pourPartenaire) dire(14, 'tu as rentré tous tes pions : tu joues pour ton partenaire');

  if (coup.t === 'defausse') {
    dire(60, 'aucune carte de ta main n\'est jouable : tu dois en défausser une');
    dire(30, `tu te défais de ${ton(ir)}, la carte qui te sert le moins`);
  } else if (ir === R_J) {
    dire(34, `ton joker copie ${un(cand.res.comme)}`);
  }

  // Captures
  const capt = cand.res.captures;
  const adv = capt.filter((q) => !allie(q));
  if (adv.length === 1) {
    if (adv[0] >> 2 === tete) dire(58, 'capture un pion du joueur en tête : il retourne à sa base');
    else dire(55, 'capture un pion adverse : il retourne à sa base');
  }
  if (adv.length > 1) {
    const dontTete = adv.filter((q) => q >> 2 === tete).length;
    dire(60, `capture ${adv.length} pions adverses${dontTete ? ` (dont ${dontTete > 1 ? `${dontTete} du joueur en tête` : 'un du joueur en tête'})` : ''} : ils retournent à leur base`);
  }
  for (const q of capt) {
    if (q >> 2 === siege) dire(50, 'renvoie ton propre pion à la base');
    else if (q >> 2 === part) dire(50, 'renvoie un pion de ton partenaire à la base');
  }

  // Sorties, entrées dans l'allée, mouvements de son camp
  let progression = null;
  for (let g = 0; g < nP; g++) {
    if (avant[g] === apres[g] || apres[g] === BASE) continue;
    if (!allie(g)) continue;
    const quoi = nom(g);
    if (avant[g] === BASE) {
      dire(42, pourPartenaire ? 'sort un pion de ton partenaire' : 'sort un pion');
      if (!pourPartenaire && mainApres.some((c) => indexRang(c) === R_4)) dire(22, 'prépare le 4 en arrière : ton pion sera ensuite juste avant l\'entrée de l\'allée, prêt à rentrer avec un 2 à 5');
      continue;
    }
    if (avant[g] < ALLEE && apres[g] >= ALLEE) {
      const k = apres[g] - ALLEE;
      let trous = 0;
      for (let j = k + 1; j < 4; j++) if (!apres.slice((g >> 2) * 4, (g >> 2) * 4 + 4).includes(ALLEE + j)) trous++;
      dire(48, `rentre ${quoi} dans l'allée${k === 3 ? ' (tout au fond)' : ''}`);
      if (trous > 0) dire(12, `mais il laisse ${trous} case${trous > 1 ? 's' : ''} libre${trous > 1 ? 's' : ''} au-dessus de lui dans l'allée`);
      if (risqueAv(g) >= 0.15) dire(20, `${quoi} était à portée d'un adversaire (risque ≈ ${pct(risqueAv(g))}) : le voilà à l'abri`);
      continue;
    }
    if (avant[g] >= ALLEE) {
      dire(26, `monte ${quoi} dans l'allée et libère de la place pour les suivants`);
      continue;
    }
    // Sur le circuit
    if (apres[g] === (g >> 2) * 16) dire(24, `met ${quoi} à l'abri sur sa case de sortie`);
    const da = distance(g, avant[g], N);
    const dp = distance(g, apres[g], N);
    if (coup.t === 'recul' && dp <= 3) {
      dire(45, `recule ${quoi} juste avant l'entrée de l'allée : ${dp === 0 ? 'un pas de 1 à 4' : `un ${dp + 1} à ${dp + 4}`} le rentrera`);
    } else if (coup.t === 'echange') {
      const gain = da - dp;
      const avec = allie(coup.cible) ? 'un pion de ton partenaire' : nomAdverse(coup.cible >> 2);
      if (gain > 0) dire(36, `échange ${quoi} avec ${avec} : tu gagnes ${gain} cases`);
      else dire(20, `échange ${quoi} avec ${avec} (tu recules de ${-gain} cases)`);
    } else if (dp < da && !progression) {
      progression = { g, n: da - dp, dp, quoi };
    } else if (coup.t === 'recul') {
      dire(6, `recule ${quoi} de 4 cases`);
    }
    if (coup.t === 'sept' && g >> 2 === part && !pourPartenaire) dire(30, 'utilise le reste du 7 pour aider ton partenaire');
    // Risque du pion déplacé
    const ra = risqueAv(g);
    const rp = risqueAp(g);
    if (rp >= 0.15 && rp > ra + 0.05) dire(28 + 20 * rp, `laisse ${quoi} à portée d'un adversaire (risque ≈ ${pct(rp)})`);
    else if (ra >= 0.2 && rp < ra / 2) dire(26, `met ${quoi} hors de portée (risque ${pct(ra)} → ${pct(rp)})`);
  }
  if (progression) {
    const { n: k, dp, quoi } = progression;
    const suite = dp === 0 ? " : il est sur la case d'entrée de l'allée" : dp <= 12 ? ` : il n'est plus qu'à ${dp} case${dp > 1 ? 's' : ''} de l'entrée de l'allée` : '';
    dire(dp <= 12 ? 16 : 8, `avance ${quoi} de ${k} case${k > 1 ? 's' : ''}${suite}`);
  }

  // Pions adverses déplacés (5 adverse)
  if (coup.t === 'avance' && !allie(coup.pion)) dire(30, `fait avancer ${nomAdverse(coup.pion >> 2)} de 5 cases`);

  // Pions de son camp restés en place dont le risque change nettement (menace écartée ou créée)
  for (let g = 0; g < nP; g++) {
    if (avant[g] !== apres[g] || avant[g] < 0 || avant[g] >= N) continue;
    const ra = risqueAv(g);
    const rp = risqueAp(g);
    if (allie(g) && ra >= 0.25 && rp < ra / 2) dire(18, `écarte la menace sur ${nom(g)} (risque ${pct(ra)} → ${pct(rp)})`);
    if (!allie(g) && rp >= 0.3 && ra < 0.1) dire(14, `menace ${nomAdverse(g >> 2)} (≈ ${pct(rp)} de le capturer bientôt)`);
  }

  // Pion protégé qui bloque désormais un adversaire
  const c0 = actif * 16;
  const q0 = apres.indexOf(c0);
  if (q0 >= 0 && q0 >> 2 === actif && avant[q0] !== c0) {
    let bloques = 0;
    for (let x = 1; x <= 12; x++) {
      const r = apres.indexOf((c0 - x + N) % N);
      if (r >= 0 && !allie(r) && distance(r, apres[r], N) >= x) bloques++;
    }
    if (bloques) dire(10, `ton pion protégé sur la case de sortie bloque ${bloques > 1 ? `${bloques} adversaires` : 'un adversaire'}`);
  }

  // Cartes gardées
  if (coup.t !== 'defausse') {
    let enBase = 0;
    for (let g = actif * 4; g < actif * 4 + 4; g++) if (apres[g] === BASE) enBase++;
    const garde = mainApres.map(indexRang);
    const rEff = rangEffectif(cand.res);
    if (rEff !== R_A && rEff !== R_R && enBase > 0) {
      const s = garde.find((r) => r === R_A || r === R_R);
      if (s !== undefined) dire(12, `garde ${ton(s)} pour sortir un pion plus tard`);
    }
    if ((rEff === R_A || rEff === R_R) && coup.t !== 'sortie' && enBase > 0 && avant.slice(actif * 4, actif * 4 + 4).includes(BASE)) {
      dire(12, `utilise ${ir === R_J ? 'ton joker' : ton(ir)} pour avancer alors qu'un pion attend en base`);
    }
    if (ir !== R_7 && garde.includes(R_7)) dire(5, 'garde ton 7, la carte la plus souple');
    if (a3 && ir !== R_J && garde.includes(R_J)) dire(9, 'garde ton joker : il pourra copier une carte posée plus tard dans la donne');
    // Carte nouvelle offerte à la copie d'un joker adverse
    if (a3 && rEff >= 0 && !(prep.copiables & (1 << rEff)) && prep.ctx.nonVues[R_J] > 0 && [R_A, R_R, R_7].includes(rEff)) {
      dire(8, `un adversaire qui a un joker pourra copier ${ir === R_J ? un(rEff) : ton(rEff)}`);
    }
  }

  if (!R.length) dire(1, 'coup sans conséquence notable sur le plateau');
  R.sort((a, b) => b.poids - a.poids);
  const vus = new Set();
  return R.filter((x) => !vus.has(x.texte) && vus.add(x.texte)).slice(0, 3).map((x) => x.texte);
}
