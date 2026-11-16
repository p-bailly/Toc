// Boucle d'analyse de fin de partie, commune au Web Worker (etude-worker.js) et au repli sur le fil principal.
// Elle reçoit la liste des tours à analyser et fait avancer, par petites tranches, les analyses de l'IA
// (creerAnalyse / creerAnalyseDon) : d'abord le tour affiché (cible), puis une première passe rapide sur tous les
// tours, puis elle affine ceux qui ne sont pas encore stables, à tour de rôle. Chaque tranche publie le résultat.
//
// Messages reçus :  { type: 'taches', taches: [{ id, type: 'coup'|'don', etat, siege, main, options, fait }] }
//                   (un nouvel envoi remplace la liste à parcourir, par exemple pour analyser un autre joueur ;
//                   les tours déjà connus gardent leur analyse en cours)
//                   { type: 'cible', id }          tour affiché (prioritaire)
//                   { type: 'arreter' }
// Messages publiés : { type: 'pret', dispo }  { type: 'resultat', id, resultat }  { type: 'erreur', id, message }
//                    { type: 'repos' } (plus rien à calculer)

/** Temps de calcul maximal (ms) consacré à un tour hors affichage, et au tour affiché. */
const PLAFOND_FOND = 1500;
const PLAFOND_CIBLE = 30000;

export function creerBoucle(ia, publier, { tranche = 40, premiere = 60, pause = 0 } = {}) {
  const taches = new Map(); // id → { tache, analyse, res, temps }
  let ordre = [];
  let cible = null;
  let minuterie = null;
  let arrete = false;
  const dispo = typeof ia.creerAnalyse === 'function' && typeof ia.creerAnalyseDon === 'function';

  const fini = (t, estCible) => !!t.res && (t.res.stable || t.res.erreur || t.fait || t.temps >= (estCible ? PLAFOND_CIBLE : PLAFOND_FOND));

  function analyseDe(t) {
    if (!t.analyse) {
      const { type, etat, siege, main, options } = t.tache;
      t.analyse = type === 'don' ? ia.creerAnalyseDon(etat, siege, main, options) : ia.creerAnalyse(etat, siege, main, options);
    }
    return t.analyse;
  }

  function choisir() {
    if (cible !== null && taches.has(cible) && !fini(taches.get(cible), true)) return { id: cible, budget: tranche };
    const neuf = ordre.find((id) => !taches.get(id).res);
    if (neuf !== undefined) return { id: neuf, budget: premiere };
    let meilleur = null;
    for (const id of ordre) {
      const t = taches.get(id);
      if (fini(t, false)) continue;
      if (!meilleur || t.temps < taches.get(meilleur).temps) meilleur = id;
    }
    return meilleur === null ? null : { id: meilleur, budget: tranche };
  }

  function etape() {
    minuterie = null;
    if (arrete || !dispo) return;
    const suivant = choisir();
    if (!suivant) {
      publier({ type: 'repos' });
      return;
    }
    const t = taches.get(suivant.id);
    const debut = Date.now();
    try {
      const a = analyseDe(t);
      a.avancer(suivant.budget);
      t.res = a.resultat();
      publier({ type: 'resultat', id: suivant.id, resultat: t.res });
    } catch (e) {
      t.res = { erreur: String(e?.message || e), stable: true };
      publier({ type: 'erreur', id: suivant.id, message: t.res.erreur });
    }
    t.temps += Math.max(1, Date.now() - debut);
    planifier();
  }

  function planifier() {
    if (!minuterie && !arrete) minuterie = setTimeout(etape, pause);
  }

  publier({ type: 'pret', dispo });

  return {
    recevoir(msg) {
      if (!msg) return;
      if (msg.type === 'taches') {
        for (const tache of msg.taches) {
          if (!taches.has(tache.id)) taches.set(tache.id, { tache, analyse: null, res: tache.fait ? { stable: true } : null, temps: 0, fait: !!tache.fait });
        }
        ordre = msg.taches.map((x) => x.id);
        planifier();
      } else if (msg.type === 'cible') {
        cible = msg.id;
        planifier();
      } else if (msg.type === 'arreter') {
        arrete = true;
        clearTimeout(minuterie);
      }
    },
  };
}
