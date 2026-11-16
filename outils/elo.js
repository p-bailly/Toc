#!/usr/bin/env node
// Classement Elo par maximum de vraisemblance à partir des résultats de tournois.
//
// Entrée : un journal JSON (une ligne par tournoi), écrit par
//   node outils/tournoi.js … --journal=resultats.jsonl
// chaque ligne : { joueurs: 4|3, a, b, parties, victoiresA }.
//
// Modèles (force s = 10^(Elo/400)) :
//   jeu à 4 (2 contre 2, Bradley-Terry) : P(A gagne) = sA / (sA + sB)
//   jeu à 3 (un A contre deux B)        : P(A gagne) = sA / (sA + 2 sB)
// Les deux modes sont classés séparément. L'ancre (défaut : le joueur le plus faible) vaut
// 1000. Intervalles à 95 % : ± 1,96 erreur type (inverse de l'information de Fisher, ancre fixe).
//
// Usage : node outils/elo.js resultats.jsonl [--ancre=ia:debutant]

import { readFileSync } from 'node:fs';

const fichier = process.argv[2];
const ancreDemandee = (process.argv.find((x) => x.startsWith('--ancre=')) || '').slice(8) || null;
const lignes = readFileSync(fichier, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

/** Résout A x = b (élimination de Gauss avec pivot partiel) ; renvoie aussi l'inverse de A. */
function inverser(A) {
  const n = A.length;
  const M = A.map((ligne, i) => ligne.concat(Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))));
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c];
    for (let k = 0; k < 2 * n; k++) M[c][k] /= d;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c];
      for (let k = 0; k < 2 * n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((l) => l.slice(n));
}

function classer(rencontres, nJ) {
  const noms = [...new Set(rencontres.flatMap((r) => [r.a, r.b]))];
  const k = nJ === 3 ? 2 : 1; // nombre d'adversaires B
  // Log-forces x (en unités naturelles) ; ajustement par Newton-Raphson.
  const idx = new Map(noms.map((n, i) => [n, i]));
  let x = noms.map(() => 0);
  const parties = new Map(noms.map((n) => [n, 0]));
  for (const r of rencontres) {
    parties.set(r.a, parties.get(r.a) + r.parties);
    parties.set(r.b, parties.get(r.b) + r.parties);
  }
  // ancre : demandée, sinon le joueur au plus faible taux de victoire brut
  let ancre = ancreDemandee && idx.has(ancreDemandee) ? ancreDemandee : null;
  if (!ancre) {
    const brut = new Map(noms.map((n) => [n, [0, 0]]));
    for (const r of rencontres) {
      brut.get(r.a)[0] += r.victoiresA; brut.get(r.a)[1] += r.parties;
      brut.get(r.b)[0] += r.parties - r.victoiresA; brut.get(r.b)[1] += r.parties;
    }
    ancre = noms.reduce((m, n) => (brut.get(n)[0] / brut.get(n)[1] < brut.get(m)[0] / brut.get(m)[1] ? n : m));
  }
  const ia = idx.get(ancre);
  const libres = noms.map((_, i) => i).filter((i) => i !== ia);
  let H = null;
  for (let it = 0; it < 100; it++) {
    const g = noms.map(() => 0);
    const h = noms.map(() => noms.map(() => 0));
    for (const r of rencontres) {
      const a = idx.get(r.a);
      const b = idx.get(r.b);
      // P = σ(xa − xb − ln k)
      const p = 1 / (1 + Math.exp(-(x[a] - x[b] - Math.log(k))));
      const resid = r.victoiresA - r.parties * p;
      g[a] += resid;
      g[b] -= resid;
      const w = r.parties * p * (1 - p);
      h[a][a] += w; h[b][b] += w; h[a][b] -= w; h[b][a] -= w;
    }
    const Hl = libres.map((i) => libres.map((j) => h[i][j] + 1e-9 * (i === j)));
    H = inverser(Hl);
    const pas = libres.map((_, u) => libres.reduce((acc, j, v) => acc + H[u][v] * g[j], 0));
    let max = 0;
    libres.forEach((i, u) => {
      x[i] += pas[u];
      max = Math.max(max, Math.abs(pas[u]));
    });
    if (max < 1e-9) break;
  }
  const echelle = 400 / Math.LN10;
  const res = noms.map((n, i) => {
    const u = libres.indexOf(i);
    const se = u < 0 ? 0 : Math.sqrt(Math.max(0, H[u][u])) * echelle;
    return { nom: n, elo: 1000 + (x[i] - x[ia]) * echelle, ic: 1.96 * se, parties: parties.get(n) };
  });
  res.sort((p, q) => q.elo - p.elo);
  return { res, ancre };
}

for (const nJ of [4, 3]) {
  const r = lignes.filter((l) => l.joueurs === nJ && l.parties > 0);
  if (!r.length) continue;
  const { res, ancre } = classer(r, nJ);
  console.log(`\nJeu à ${nJ} joueurs (${r.reduce((a, l) => a + l.parties, 0)} parties, ${r.length} rencontres ; ancre ${ancre} = 1000)`);
  for (const l of r) {
    const p = l.victoiresA / l.parties;
    console.log(`  ${l.a.padEnd(14)} contre ${nJ === 3 ? '2 × ' : ''}${l.b.padEnd(14)} ${l.victoiresA}/${l.parties} = ${(100 * p).toFixed(1)} %`);
  }
  console.log('  Classement :');
  for (const p of res) console.log(`    ${p.nom.padEnd(16)} ${Math.round(p.elo).toString().padStart(5)}  ± ${Math.round(p.ic).toString().padStart(3)}   (${p.parties} parties jouées)`);
}
