// Statistiques (route #/stats), sur le modèle de l'appli Scrabble : « Mes statistiques » en ligne (les totaux du
// compte, les mêmes sur tous les appareils), le bilan avec et contre chaque joueur et les parties en ligne terminées,
// puis le bilan contre l'IA par mode et par niveau et les dernières parties contre l'IA (à rouvrir pour les
// analyser). Les parties contre l'IA viennent de l'appareil (parties-finies.js), celles en ligne de la veille de
// « Mes parties » ; les totaux en ligne viennent de la fiche du joueur (toutes ses parties, pas seulement les récentes).
// (Le fichier ne s'appelle pas « stats » : les bloqueurs de publicité refusent ce nom, voir tests/noms-fichiers.)

import { h, remplacer, pluriel, ilYa } from './dom.js';
import { entete } from './composants.js';
import { nomNiveau, niveauEnLettres, forceNiveau } from './niveaux.js';
import { surVeille } from './veille.js';
import { sauvegardeLocale } from './ecran-jeu.js';
import { piCroix } from './pictos.js';
import { lirePartiesFinies, enregistrerPartieFinie, supprimerPartieFinie, bilanContreIA, bilanEnLigne, niveauAdverse } from './parties-finies.js';

const NOM_MODE = { 4: '2 contre 2', 3: '3 joueurs' };
const pourcent = (n, total) => (total ? Math.round((n / total) * 100) + ' %' : '–');
const defaites = (l) => l.parties - l.victoires;
/** « 2 contre 2 · ★★★★ » : le mode et la force des IA adverses. */
const titreMode = (nb, niveau) => [NOM_MODE[nb], h('span', { class: 'sep' }, ' · '), h('span', { class: 'etoiles', 'aria-label': 'IA ' + niveauEnLettres(niveau) }, nomNiveau(niveau))];

/** Les parties terminées encore posées dans la sauvegarde de chaque mode entrent dans l'historique. */
export function rattraperPartiesFinies() {
  for (const n of [4, 3]) {
    const sv = sauvegardeLocale(n);
    if (sv?.partie?.etat?.phase === 'fini') enregistrerPartieFinie(sv, n);
  }
}

const tuiles = (...paires) => h('div', { class: 'stats' }, paires.map(([etiquette, valeur]) => h('div', { class: 'stat' }, h('div', { class: 'etiquette' }, etiquette), h('div', { class: 'valeur' }, valeur))));

export function afficher(racine, app) {
  let veille = { pret: false, parties: [] };
  let toutVoir = false;

  const blocIA = () => {
    const parties = lirePartiesFinies();
    const blocs = [h('h2', {}, 'Contre l’IA')];
    if (!parties.length) {
      blocs.push(h('div', { class: 'vide-etat' }, 'Aucune partie terminée contre l’IA pour l’instant. Elles apparaîtront ici, avec leur analyse.'));
      return blocs;
    }
    const b = bilanContreIA(parties);
    blocs.push(tuiles(['Parties', b.parties], ['Victoires', b.victoires], ['Réussite', pourcent(b.victoires, b.parties)]));
    blocs.push(
      h(
        'div',
        { class: 'liste' },
        [...b.lignes]
          .sort((x, y) => y.nb - x.nb || forceNiveau(x.niveau) - forceNiveau(y.niveau))
          .map((l) =>
          h(
            'div',
            { class: 'ligne', style: { cursor: 'default' }, 'data-bilan': `${l.nb}-${l.niveau}` },
            h('div', { class: 'avatar', style: { background: 'var(--muted)' } }, '🤖'),
            h(
              'div',
              { class: 'principal' },
              h('div', { class: 'mot' }, titreMode(l.nb, l.niveau)),
              h('div', { class: 'note' }, `${pluriel(l.victoires, 'victoire')} · ${pluriel(defaites(l), 'défaite')}`),
            ),
            h('span', { class: 'pts' }, `${l.victoires}/${l.parties}`),
          ),
        ),
      ),
    );
    const visibles = toutVoir ? parties : parties.slice(0, 10);
    blocs.push(
      h('h2', {}, 'Parties terminées contre l’IA'),
      h(
        'div',
        { class: 'liste' },
        visibles.map((p) => {
          const gagnant = p.joueurs?.[p.gagnants?.[0]]?.pseudo;
          // Le badge dit déjà « Gagnée » ou « Perdue » : la note précise avec qui, ou qui a gagné.
          const resultat = p.nb === 3 ? (p.gagne || !gagnant ? '' : `${gagnant} gagne`) : `Avec ${p.joueurs?.[2]?.pseudo || 'ton partenaire'}`;
          const details = `${pluriel(p.donnes, 'donne')}${p.cinqAdverse ? ' · 5 adverse' : ''} · ${ilYa(p.date)}`;
          const contenu = [
            h('div', { class: 'avatar', style: { background: p.gagne ? 'var(--ok)' : 'var(--muted)' } }, p.gagne ? '🏆' : '🎲'),
            h(
              'div',
              { class: 'principal' },
              h('div', { class: 'mot' }, titreMode(p.nb, niveauAdverse(p))),
              h('div', { class: 'note' }, `${resultat ? resultat + ' · ' : ''}${details}${p.sauvegarde ? '' : ' · analyse non gardée'}`),
            ),
            h('span', { class: 'badge ' + (p.gagne ? 'ok' : 'neutre') }, p.gagne ? 'Gagnée' : 'Perdue'),
          ];
          return h(
            'div',
            { class: 'ligne-avec-action', 'data-finie': p.id },
            p.sauvegarde
              ? h('a', { class: 'ligne', href: '#/analyse/finie/' + encodeURIComponent(p.id), 'aria-label': 'Analyser cette partie' }, contenu)
              : h('div', { class: 'ligne', style: { cursor: 'default' } }, contenu),
            h(
              'button',
              {
                type: 'button',
                class: 'bouton',
                'aria-label': 'Retirer cette partie des statistiques',
                'data-action': 'retirer',
                onclick: () => {
                  if (!confirm('Retirer cette partie de l’historique et des statistiques ?')) return;
                  supprimerPartieFinie(p.id);
                  dessiner();
                },
              },
              piCroix(),
            ),
          );
        }),
      ),
    );
    if (parties.length > visibles.length) {
      blocs.push(h('button', { type: 'button', class: 'bouton discret', 'data-action': 'tout-voir', onclick: () => ((toutVoir = true), dessiner()) }, `Voir les ${parties.length} parties`));
    }
    return blocs;
  };

  const blocEnLigne = () => {
    if (!app.enLigne()) return [];
    const blocs = [h('h2', {}, 'Mes statistiques en ligne')];
    if (!app.joueur) {
      blocs.push(h('div', { class: 'vide-etat' }, 'Indique ton prénom dans « Mes parties » pour jouer en ligne : tes statistiques et tes parties terminées apparaîtront ici.'));
      return blocs;
    }
    // Totaux du compte : toutes les parties en ligne terminées, quel que soit l'appareil.
    const st = app.joueur.stats || { jouees: 0, gagnees: 0 };
    blocs.push(h('div', { 'data-stats': 'compte' }, tuiles(['Parties jouées', st.jouees], ['Gagnées', st.gagnees], ['Réussite', pourcent(st.gagnees, st.jouees)])));
    if (!veille.pret) {
      blocs.push(h('div', { class: 'vide-etat' }, 'Chargement…'));
      return blocs;
    }
    const finies = veille.parties.filter((p) => p.statut === 'finie');
    if (!finies.length) {
      blocs.push(h('div', { class: 'vide-etat' }, 'Aucune partie en ligne terminée pour l’instant.'));
      return blocs;
    }
    const b = bilanEnLigne(finies);
    if (b.joueurs.length) {
      blocs.push(
        h('h2', {}, 'Avec et contre chaque joueur'),
        h(
          'div',
          { class: 'liste' },
          b.joueurs.map((j) =>
            h(
              'div',
              { class: 'ligne', style: { cursor: 'default' }, 'data-joueur': j.uid },
              h('div', { class: 'avatar' }, (j.pseudo || '?').slice(0, 1).toUpperCase()),
              h(
                'div',
                { class: 'principal' },
                h('div', { class: 'mot' }, j.pseudo || 'Joueur'),
                h(
                  'div',
                  { class: 'note' },
                  [j.avec ? `Avec : ${j.avecGagnees} gagnée${j.avecGagnees > 1 ? 's' : ''} sur ${j.avec}` : '', j.contre ? `Contre : ${j.contreGagnees} gagnée${j.contreGagnees > 1 ? 's' : ''} sur ${j.contre}` : '']
                    .filter(Boolean)
                    .join(' · '),
                ),
              ),
              h('span', { class: 'pts' }, `${j.avecGagnees + j.contreGagnees}/${j.avec + j.contre}`),
            ),
          ),
        ),
      );
    }
    blocs.push(
      h('h2', {}, 'Parties en ligne terminées'),
      h(
        'div',
        { class: 'liste' },
        finies.slice(0, 30).map((p) => {
          const moi = p.monSiege;
          const a3 = p.nbJoueurs === 3;
          const gagne = Array.isArray(p.gagnants) && p.gagnants.length ? p.gagnants.includes(moi) : a3 ? p.gagnant === moi : p.gagnant === moi % 2;
          const nom = (place) => (place ? (place.ia ? `${place.pseudo || 'IA'} (IA)` : place.pseudo) : '');
          const autres = (p.joueurs || []).map((place, siege) => ({ place, siege })).filter((x) => x.place && x.siege !== moi);
          const avec = a3 ? '' : nom(autres.find((x) => x.siege % 2 === moi % 2)?.place);
          const contre = autres
            .filter((x) => a3 || x.siege % 2 !== moi % 2)
            .map((x) => nom(x.place))
            .join(' et ');
          return h(
            'a',
            { class: 'ligne', href: '#/analyse/' + encodeURIComponent(p.id), 'data-partie': p.id, 'aria-label': `Analyser ${p.nom || 'la partie'}` },
            h('div', { class: 'avatar', style: { background: gagne ? 'var(--ok)' : 'var(--muted)' } }, gagne ? '🏆' : '🎲'),
            h(
              'div',
              { class: 'principal' },
              h('div', { class: 'mot' }, p.nom || 'Partie de Toc'),
              h('div', { class: 'note' }, [a3 ? '3 joueurs' : avec && `Avec ${avec}`, contre && `contre ${contre}`, ilYa(p.majLe)].filter(Boolean).join(' · ')),
            ),
            h('span', { class: 'badge ' + (gagne ? 'ok' : 'neutre') }, gagne ? 'Gagnée' : 'Perdue'),
          );
        }),
      ),
    );
    return blocs;
  };

  function dessiner() {
    // Connecté : ses statistiques en ligne d'abord ; sinon le bilan contre l'IA, seul à avoir quelque chose à montrer.
    const blocs = app.joueur ? [blocEnLigne(), blocIA()] : [blocIA(), blocEnLigne()];
    remplacer(racine, h('div', { class: 'contenu bilan' }, entete('Statistiques'), blocs));
  }

  rattraperPartiesFinies();
  dessiner();
  const arret = surVeille((v) => {
    veille = v;
    dessiner();
  });
  // La fiche du joueur change quand une partie terminée est comptée : les totaux suivent.
  app.surJoueur = () => dessiner();
  return () => {
    arret();
    app.surJoueur = null;
  };
}
