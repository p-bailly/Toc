// Contre l'IA (route #/ia) : reprendre la partie d'entraînement sauvegardée sur l'appareil, ou en commencer une
// nouvelle (option « 5 adverse »). C'est l'écran d'ouverture de qui joue sans compte ou sans réseau.

import { h, remplacer, ecrire } from './dom.js';
import { entete, interrupteur, rangee } from './composants.js';
import { SessionLocale } from '../session-locale.js';
import { nouvellePartieLocale } from './ecran-jeu.js';
import { conseilInstallation } from './installation.js';
import { piPlus } from './pictos.js';

export function afficher(racine, app) {
  let cinqAdverse = false;

  const dessiner = () => {
    const sauvegarde = SessionLocale.lireSauvegarde(localStorage);
    const enCours = sauvegarde && sauvegarde.partie.etat.phase !== 'fini' ? sauvegarde : null;
    const blocs = [entete('Contre l’IA')];
    const conseil = conseilInstallation(app);
    if (conseil) blocs.push(conseil);

    if (enCours) {
      const etat = enCours.partie.etat;
      const aMoi = (etat.phase === 'echange' && !enCours.partie.dons?.[0]) || (etat.phase === 'jeu' && etat.tour === 0);
      blocs.push(
        h('h2', {}, 'Partie en cours'),
        h(
          'a',
          { class: 'ligne' + (aMoi ? ' choisie' : ''), href: '#/jeu/locale', 'data-action': 'reprendre' },
          h('div', { class: 'avatar', style: { background: aMoi ? 'var(--accent)' : 'var(--muted)' } }, '🤖'),
          h(
            'div',
            { class: 'principal' },
            h('div', { class: 'mot' }, aMoi ? 'À toi de jouer' : 'Partie d’entraînement'),
            h('div', { class: 'note' }, `Donne ${etat.donne + 1} · ${etat.reglages.cinqAdverse ? '5 adverse' : '5 normal'} · avec ${enCours.joueurs[2]?.pseudo || 'IA'}`),
          ),
          h('span', { class: 'bouton' }, 'Reprendre'),
        ),
      );
    }

    blocs.push(
      h('h2', {}, enCours ? 'Ou une nouvelle partie' : 'Nouvelle partie'),
      h(
        'div',
        { class: 'carte' },
        rangee({ titre: 'Toi et une IA contre deux IA', texte: 'Ton partenaire est en face. La partie est gardée sur cet appareil : tu peux la reprendre plus tard.' }),
        interrupteur({
          titre: 'Option « 5 adverse »',
          texte: 'Le 5 peut aussi faire avancer un pion adverse de 5 cases.',
          actif: cinqAdverse,
          surChange: (v) => (cinqAdverse = v),
        }),
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
                if (enCours && !confirm('Abandonner la partie en cours et en commencer une nouvelle ?')) return;
                nouvellePartieLocale({ cinqAdverse });
                app.naviguer('#/jeu/locale');
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
          h('span', { class: 'note' }, 'Choisis un nom d’utilisateur dans « Mes parties » pour créer une partie et inviter jusqu’à 3 joueurs.'),
          h(
            'a',
            {
              class: 'bouton',
              href: '#/parties',
              onclick: () => ecrire('toc.sansCompte', false),
            },
            'Créer mon compte',
          ),
        ),
      );
    } else if (!app.enLigne()) {
      blocs.push(h('p', { class: 'note centre' }, 'Mode hors ligne : le jeu en ligne n’est pas disponible sur cet appareil pour le moment.'));
    }
    remplacer(racine, h('div', { class: 'contenu' }, blocs));
  };

  dessiner();
  app.surInstallation = dessiner;
  return () => {
    app.surInstallation = null;
  };
}
