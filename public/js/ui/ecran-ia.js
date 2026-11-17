// Contre l'IA (route #/ia) : reprendre une partie d'entraînement sauvegardée sur l'appareil, ou en commencer une
// nouvelle, en « 2 contre 2 » (toi et une IA contre deux IA) ou à « 3 joueurs » (chacun pour soi, toi contre deux
// IA). C'est l'écran d'ouverture de qui joue sans compte ou sans réseau. Avec un compte, la partie en cours suit
// d'un appareil à l'autre : celle que le compte garde remplace ici celle de l'appareil si elle est plus récente.

import { h, remplacer, ecrire, lire } from './dom.js';
import { entete, interrupteur, rangee, segments } from './composants.js';
import { nouvellePartieLocale, sauvegardeLocale, MODES_LOCAUX } from './ecran-jeu.js';
import { conseilInstallation } from './installation.js';
import { piPlus } from './pictos.js';
import { lirePartiesFinies } from './parties-finies.js';
import { rattraperPartiesFinies } from './ecran-bilan.js';
import { recupererPartiesEnCours } from './synchro-ia.js';
import { choixNiveau, niveauxLocaux, ecrireNiveauxLocaux, nomNiveau } from './niveaux.js';

const CLE_MODE = 'toc.modeLocal';

export function afficher(racine, app) {
  let cinqAdverse = false;
  let nbJoueurs = lire(CLE_MODE, 4) === 3 ? 3 : 4;
  // Force des IA : la dernière choisie est retenue sur l'appareil ; partenaire null = comme les adversaires.
  let niveaux = niveauxLocaux();
  let ouvert = null; // 'adversaires' | 'partenaire' : liste des niveaux dépliée

  const ligneEnCours = (sauvegarde, n) => {
    const etat = sauvegarde.partie.etat;
    const aMoi = (etat.phase === 'echange' && !sauvegarde.partie.dons?.[0]) || (etat.phase === 'jeu' && etat.tour === 0);
    const ias = sauvegarde.joueurs.filter((j) => j.ia).map((j) => nomNiveau(j.niveau));
    const niveauxTexte = [...new Set(ias)].join(', ');
    const avec = (n === 3 ? `contre ${sauvegarde.joueurs.slice(1).map((j) => j.pseudo).join(' et ')}` : `avec ${sauvegarde.joueurs[2]?.pseudo || 'IA'}`) + ` · IA ${niveauxTexte}`;
    return h(
      'a',
      { class: 'ligne' + (aMoi ? ' choisie' : ''), href: MODES_LOCAUX[n].route, 'data-action': n === 3 ? 'reprendre-3' : 'reprendre' },
      h('div', { class: 'avatar', style: { background: aMoi ? 'var(--accent)' : 'var(--muted)' } }, '🤖'),
      h(
        'div',
        { class: 'principal' },
        h('div', { class: 'mot' }, (n === 3 ? '3 joueurs · ' : '2 contre 2 · ') + (aMoi ? 'à toi de jouer' : 'en cours')),
        h('div', { class: 'note' }, `Donne ${etat.donne + 1}${etat.reglages.cinqAdverse ? ' · 5 adverse' : ''} · ${avec}`),
      ),
      h('span', { class: 'bouton' }, 'Reprendre'),
    );
  };

  rattraperPartiesFinies(app.joueur?.uid);

  const dessiner = () => {
    const blocs = [entete('Contre l’IA')];
    const conseil = conseilInstallation(app);
    if (conseil) blocs.push(conseil);

    const enCours = [4, 3]
      .map((n) => [n, sauvegardeLocale(n)])
      .filter(([, sv]) => sv && sv.partie.etat.phase !== 'fini');
    if (enCours.length) blocs.push(h('h2', {}, enCours.length > 1 ? 'Parties en cours' : 'Partie en cours'), h('div', { class: 'liste' }, enCours.map(([n, sv]) => ligneEnCours(sv, n))));

    // Dernières parties terminées : analyse avec l'IA.
    const finies = [4, 3].map((n) => [n, sauvegardeLocale(n)]).filter(([, sv]) => sv && sv.partie.etat.phase === 'fini');
    if (finies.length) {
      blocs.push(
        h('h2', {}, 'Dernières parties terminées'),
        h(
          'div',
          { class: 'liste' },
          finies.map(([n, sv]) => {
            const e = sv.partie.etat;
            const gagne = e.gagnant === 0;
            const titre = n === 3 ? (gagne ? '3 joueurs · tu as gagné' : `3 joueurs · ${sv.joueurs[e.gagnant]?.pseudo || 'un adversaire'} a gagné`) : gagne ? '2 contre 2 · victoire de ton équipe' : '2 contre 2 · victoire de l’équipe adverse';
            return h(
              'a',
              { class: 'ligne', href: MODES_LOCAUX[n].analyse, 'data-action': n === 3 ? 'analyser-3' : 'analyser' },
              h('div', { class: 'avatar', style: { background: gagne ? 'var(--ok)' : 'var(--muted)' } }, gagne ? '🏆' : '🎲'),
              h('div', { class: 'principal' }, h('div', { class: 'mot' }, titre), h('div', { class: 'note' }, `${e.donne + 1} donnes`)),
              h('span', { class: 'bouton' }, 'Analyser'),
            );
          }),
        ),
      );
    }

    if (lirePartiesFinies().length) blocs.push(h('a', { class: 'bouton discret', href: '#/stats', 'data-action': 'voir-stats' }, 'Toutes mes parties terminées et mes statistiques'));

    const enCoursMode = enCours.find(([n]) => n === nbJoueurs);
    blocs.push(
      h('h2', {}, 'Nouvelle partie'),
      h(
        'div',
        { class: 'carte' },
        h(
          'div',
          { class: 'champ', style: { marginBottom: '10px' } },
          'Mode de jeu',
          segments(
            [
              { valeur: 4, nom: '2 contre 2' },
              { valeur: 3, nom: '3 joueurs' },
            ],
            nbJoueurs,
            (v) => {
              nbJoueurs = v;
              ecrire(CLE_MODE, v);
              dessiner();
            },
          ),
        ),
        rangee({
          titre: nbJoueurs === 3 ? 'Toi contre deux IA, chacun pour soi' : 'Toi et une IA contre deux IA',
        }),
        interrupteur({
          titre: 'Option « 5 adverse »',
          texte: 'Le 5 peut aussi faire avancer un pion adverse de 5 cases.',
          actif: cinqAdverse,
          surChange: (v) => (cinqAdverse = v),
        }),
        choixNiveau({
          cle: 'adversaires',
          titre: nbJoueurs === 3 ? 'Niveau des deux IA' : 'Niveau des adversaires',
          actuel: niveaux.adversaires,
          ouvert: ouvert === 'adversaires',
          surOuvrir: (o) => ((ouvert = o ? 'adversaires' : null), dessiner()),
          surChoix: (id) => {
            niveaux = { ...niveaux, adversaires: id };
            ecrireNiveauxLocaux(niveaux);
            ouvert = null;
            dessiner();
          },
        }),
        nbJoueurs === 4
          ? choixNiveau({
              cle: 'partenaire',
              titre: 'Niveau de ton partenaire',
              actuel: niveaux.partenaire || niveaux.adversaires,
              note: niveaux.partenaire ? '' : 'Le même que les adversaires.',
              ouvert: ouvert === 'partenaire',
              surOuvrir: (o) => ((ouvert = o ? 'partenaire' : null), dessiner()),
              surChoix: (id) => {
                niveaux = { ...niveaux, partenaire: id === niveaux.adversaires ? null : id };
                ecrireNiveauxLocaux(niveaux);
                ouvert = null;
                dessiner();
              },
            })
          : null,
        h(
          'div',
          { class: 'reglage' },
          h(
            'button',
            {
              type: 'button',
              class: 'bouton principal large',
              'data-action': 'nouvelle-locale',
              onclick: () => {
                if (enCoursMode && !confirm('Abandonner la partie en cours de ce mode et en commencer une nouvelle ?')) return;
                const adv = niveaux.adversaires;
                // Un niveau par siège : partenaire en face (siège 2) à 4 joueurs ; le siège 0 est le tien.
                const parSiege = nbJoueurs === 3 ? [null, adv, adv] : [null, adv, niveaux.partenaire || adv, adv];
                nouvellePartieLocale({ cinqAdverse }, nbJoueurs, parSiege, app.joueur);
                app.naviguer(MODES_LOCAUX[nbJoueurs].route);
              },
            },
            piPlus(),
            'Commencer',
          ),
        ),
      ),
    );

    if (app.enLigne() && !app.joueur) {
      blocs.push(
        h(
          'div',
          { class: 'carte carte-info' },
          h('b', {}, 'Jouer avec tes proches ?'),
          h('span', { class: 'note' }, 'Indique ton prénom dans « Mes parties » pour créer une partie et inviter tes proches.'),
          h('a', { class: 'bouton', href: '#/parties', onclick: () => ecrire('toc.sansCompte', false) }, 'Créer mon compte'),
        ),
      );
    } else if (!app.enLigne()) {
      blocs.push(h('p', { class: 'note centre' }, 'Mode hors ligne : le jeu en ligne n’est pas disponible sur cet appareil pour le moment.'));
    }
    remplacer(racine, h('div', { class: 'contenu' }, blocs));
  };

  dessiner();
  app.surInstallation = dessiner;
  // Partie jouée sur un autre appareil depuis : on la reprend ici (maintenant, puis dès que la fiche du joueur
  // annonce du neuf), et la liste « en cours » se met à jour.
  let affiche = true;
  const recuperer = () =>
    void recupererPartiesEnCours(app).then((change) => {
      if (!change || !affiche) return;
      rattraperPartiesFinies(app.joueur?.uid);
      dessiner();
    });
  recuperer();
  app.surJoueur = recuperer;
  return () => {
    affiche = false;
    app.surInstallation = null;
    app.surJoueur = null;
  };
}
