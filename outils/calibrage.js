#!/usr/bin/env node
// Calibrage de la probabilité de victoire (analyse.js → probaDepuisEvaluation).
//
// Parties de l'IA contre elle-même (évaluation statique par défaut, rapide). À chaque fin de
// donne, on note l'évaluation de la position pour l'équipe 0, le travail restant (somme des
// distances) et le vainqueur final. On ajuste ensuite par maximum de vraisemblance :
//   modèle A : P = σ(k · v / √travail)      (utilisé par l'IA)
//   modèle B : P = σ(k · v)
// et on affiche la log-perte et un tableau de calibration (prévu / observé par tranche).
//
// Usage : node outils/calibrage.js --parties=600 --budget=0

import { nouvellePartie, donnerCarte, jouerCoup, generateurAleatoire, tailleDonne } from '../public/js/moteur/index.js';
import { choisirCoup, choisirDon } from '../public/js/ia/ia.js';
import { preparer, travailRestant } from '../public/js/ia/recherche.js';
import { evaluerPlateau } from '../public/js/ia/evaluation.js';

const args = Object.fromEntries(process.argv.slice(2).map((x) => x.replace(/^--/, '').split('=')));
const N = Number(args.parties || 600);
const budget = Number(args.budget || 0);
const points = [];
for (let i = 0; i < N; i++) {
  const rng = generateurAleatoire(9000 + i);
  let p = nouvellePartie({ cinqAdverse: i % 2 === 1 }, rng);
  const ici = [];
  let k = 0;
  while (p.etat.phase !== 'fini' && k++ < 6000) {
    const e = p.etat;
    if (e.phase === 'echange') {
      if (e.echanges.every((x) => !x) && e.donne > 0) {
        const prep = preparer(e, 0, [], {});
        const t = tailleDonne(e.donne);
        const info = { n: [t, t, t, t], connu: [0, 0, 0, 0], nConnu: [0, 0, 0, 0] };
        ici.push({ v: evaluerPlateau(e.pions, 0, e.tour, info, prep.ctx), w: travailRestant(e.pions) });
      }
      for (let s = 0; s < 4; s++) p = donnerCarte(p, s, choisirDon(p.etat, s, p.mains[s], { rng }));
      continue;
    }
    const s = e.tour;
    p = jouerCoup(p, s, choisirCoup(e, s, p.mains[s], { rng, budgetMs: budget, carteDonnee: p.dons[s] }), rng);
  }
  if (p.etat.phase !== 'fini') continue;
  for (const x of ici) points.push({ ...x, y: p.etat.gagnant === 0 ? 1 : 0 });
}
const sig = (z) => 1 / (1 + Math.exp(-z));
const perte = (f) => {
  let l = 0;
  for (const x of points) {
    const q = Math.min(1 - 1e-9, Math.max(1e-9, f(x)));
    l -= x.y ? Math.log(q) : Math.log(1 - q);
  }
  return l / points.length;
};
function ajuster(feat) {
  let best = [Infinity, 0];
  for (let k = 0.001; k < 3; k *= 1.03) {
    const l = perte((x) => sig(k * feat(x)));
    if (l < best[0]) best = [l, k];
  }
  return best;
}
const A = ajuster((x) => x.v / Math.sqrt(Math.max(40, x.w)));
const B = ajuster((x) => x.v);
console.log(`${points.length} positions de fin de donne, ${N} parties (budget ${budget} ms)`);
console.log(`modèle A σ(k·v/√travail) : k = ${A[1].toFixed(3)}, log-perte ${A[0].toFixed(4)}`);
console.log(`modèle B σ(k·v)          : k = ${B[1].toFixed(4)}, log-perte ${B[0].toFixed(4)}`);
console.log(`référence (P = 0,5)       : log-perte ${Math.log(2).toFixed(4)}`);
const tranches = Array.from({ length: 10 }, () => ({ n: 0, p: 0, y: 0 }));
for (const x of points) {
  const q = sig((A[1] * x.v) / Math.sqrt(Math.max(40, x.w)));
  const t = tranches[Math.min(9, Math.floor(q * 10))];
  t.n++;
  t.p += q;
  t.y += x.y;
}
console.log('calibration du modèle A (prévu → observé) :');
tranches.forEach((t, i) => t.n && console.log(`  ${(i * 10).toString().padStart(2)}-${i * 10 + 10} % : ${t.n.toString().padStart(5)} positions, prévu ${((100 * t.p) / t.n).toFixed(1)} %, observé ${((100 * t.y) / t.n).toFixed(1)} %`));
