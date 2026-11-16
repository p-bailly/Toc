#!/usr/bin/env node
// Tournoi entre deux équipes d'IA, graines fixes, sièges alternés, avec et sans « 5 adverse ».
//
// Usage :
//   node outils/tournoi.js --a=ia --b=glouton --parties=200 --budget=600 --cinq=les2 --fils=4
//
//   --a, --b      joueurs (voir outils/joueurs.js), ex. ia, ia-statique, glouton, aleatoire,
//                 ia:{"candidatsMax":4}
//   --parties     nombre de parties (arrondi au nombre pair : chaque graine est jouée deux
//                 fois, l'équipe A aux sièges 0/2 puis aux sièges 1/3)
//   --budget      budget de réflexion par coup (ms) passé aux IA
//   --cinq        oui | non | les2 (alterne l'option « 5 adverse » d'une graine à l'autre)
//   --graine      graine de départ (défaut 1)
//   --fils        nombre de fils d'exécution parallèles (défaut : nombre de cœurs − 1)
//
// Affiche le taux de victoire de A, un intervalle de confiance à 95 %, la durée des parties
// et les temps de réflexion par coup (moyen, 95e centile, maximum) de chaque joueur.

import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { nouvellePartie, donnerCarte, jouerCoup, generateurAleatoire, partenaire } from '../public/js/moteur/index.js';
import { fabriquerJoueur } from './joueurs.js';

const maintenant = () => performance.now();

/**
 * Joue une partie. joueurs[s] = joueur au siège s.
 * @returns {{ gagnant, coups, temps: number[][] }} temps[s] = durées de réflexion du siège s
 */
export function jouerPartie(joueurs, graine, reglages, budget, maxCoups = 6000) {
  const rngDonne = generateurAleatoire(graine * 7919 + 13);
  const rngs = [0, 1, 2, 3].map((s) => generateurAleatoire(graine * 104729 + s * 31 + 7));
  let partie = nouvellePartie(reglages, rngDonne);
  const temps = [[], [], [], []];
  let coups = 0;
  while (partie.etat.phase !== 'fini' && coups < maxCoups) {
    const etat = partie.etat;
    if (etat.phase === 'echange') {
      const dons = [0, 1, 2, 3].map((s) => joueurs[s].don(etat, s, partie.mains[s], { rng: rngs[s] }));
      for (let s = 0; s < 4; s++) partie = donnerCarte(partie, s, dons[s]);
      continue;
    }
    const s = etat.tour;
    const t0 = maintenant();
    const coup = joueurs[s].coup(etat, s, partie.mains[s], {
      rng: rngs[s],
      budgetMs: budget,
      carteDonnee: partie.dons[s],
      carteRecue: partie.dons[partenaire(s)],
    });
    temps[s].push(maintenant() - t0);
    partie = jouerCoup(partie, s, coup, rngDonne); // lève une erreur si le coup est illégal
    coups++;
  }
  return { gagnant: partie.etat.phase === 'fini' ? partie.etat.gagnant : null, coups, temps };
}

function lireArgs(argv) {
  const a = {};
  for (const x of argv) {
    const m = /^--([^=]+)=(.*)$/.exec(x);
    if (m) a[m[1]] = m[2];
  }
  return a;
}

/** Partie numéro i du tournoi : graine i>>1, l'équipe A change de sièges une partie sur deux. */
function partieNumero(cfg, i) {
  const graine = cfg.graine + (i >> 1);
  const aPair = i % 2 === 0; // A aux sièges 0 et 2
  const cinq = cfg.cinq === 'oui' ? true : cfg.cinq === 'non' ? false : (i >> 1) % 2 === 1;
  const A = fabriquerJoueur(cfg.a);
  const B = fabriquerJoueur(cfg.b);
  const joueurs = aPair ? [A, B, A, B] : [B, A, B, A];
  const r = jouerPartie(joueurs, graine, { cinqAdverse: cinq }, cfg.budget);
  const equipeA = aPair ? 0 : 1;
  const tA = [];
  const tB = [];
  for (let s = 0; s < 4; s++) ((s & 1) === equipeA ? tA : tB).push(...r.temps[s]);
  return { i, cinq, victoireA: r.gagnant === null ? null : r.gagnant === equipeA, coups: r.coups, tA, tB };
}

if (!isMainThread) {
  const { cfg, indices } = workerData;
  for (const i of indices) parentPort.postMessage(partieNumero(cfg, i));
} else if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = lireArgs(process.argv.slice(2));
  const cfg = {
    a: args.a || 'ia',
    b: args.b || 'glouton',
    parties: Math.max(2, 2 * Math.round(Number(args.parties || 100) / 2)),
    budget: Number(args.budget ?? 600),
    cinq: args.cinq || 'les2',
    graine: Number(args.graine || 1),
  };
  const fils = Math.max(1, Math.min(cfg.parties, Number(args.fils || Math.max(1, os.cpus().length - 1))));
  console.log(`Tournoi : A = ${cfg.a}  contre  B = ${cfg.b} — ${cfg.parties} parties, budget ${cfg.budget} ms, 5 adverse : ${cfg.cinq}, ${fils} fils`);
  const resultats = [];
  const debut = Date.now();
  await Promise.all(
    Array.from({ length: fils }, (_, f) => {
      const indices = [];
      for (let i = f; i < cfg.parties; i += fils) indices.push(i);
      return new Promise((ok, ko) => {
        const w = new Worker(fileURLToPath(import.meta.url), { workerData: { cfg, indices } });
        w.on('message', (r) => {
          resultats.push(r);
          if (resultats.length % 10 === 0 || resultats.length === cfg.parties) {
            const v = resultats.filter((x) => x.victoireA).length;
            process.stderr.write(`  ${resultats.length}/${cfg.parties} parties, A gagne ${v}\n`);
          }
        });
        w.on('error', ko);
        w.on('exit', ok);
      });
    }),
  );
  const resume = (liste, titre) => {
    const v = liste.filter((r) => r.victoireA === true).length;
    const nuls = liste.filter((r) => r.victoireA === null).length;
    const n = liste.length - nuls;
    const p = n ? v / n : 0;
    const ic = n ? 1.96 * Math.sqrt((p * (1 - p)) / n) : 0;
    console.log(`${titre.padEnd(22)} A gagne ${v}/${n} = ${(100 * p).toFixed(1)} % (± ${(100 * ic).toFixed(1)})${nuls ? `, ${nuls} inachevées` : ''}`);
  };
  resume(resultats, 'Total');
  resume(resultats.filter((r) => !r.cinq), 'Sans 5 adverse');
  resume(resultats.filter((r) => r.cinq), 'Avec 5 adverse');
  const stats = (t) => {
    if (!t.length) return 'n/a';
    const s = t.slice().sort((x, y) => x - y);
    const moy = s.reduce((a, b) => a + b, 0) / s.length;
    return `moy ${moy.toFixed(1)} ms, p95 ${s[Math.floor(s.length * 0.95)].toFixed(1)} ms, max ${s[s.length - 1].toFixed(1)} ms (${s.length} coups)`;
  };
  console.log(`Temps par coup A : ${stats(resultats.flatMap((r) => r.tA))}`);
  console.log(`Temps par coup B : ${stats(resultats.flatMap((r) => r.tB))}`);
  const lg = resultats.map((r) => r.coups);
  console.log(`Coups par partie : moy ${(lg.reduce((a, b) => a + b, 0) / lg.length).toFixed(0)}, durée totale ${((Date.now() - debut) / 1000).toFixed(0)} s`);
}
