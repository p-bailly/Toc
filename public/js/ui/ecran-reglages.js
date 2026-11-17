// Réglages (route #/reglages), sur le modèle de l'appli Scrabble : tout visible d'un coup, l'essentiel en haut
// (taille du texte, thème, être prévenu, compte), puis plateau et jeu, notifications, données, à propos.

import { h, remplacer, messageErreur, pluriel } from './dom.js';
import { entete, rangee, interrupteur, segments, toast, retenirIcone } from './composants.js';
import { TAILLES, THEMES, VITESSE_MIN, VITESSE_MAX, VITESSE_PAS, nomVitesse, lireReglages, modifierReglages } from './reglages.js';
import { demanderPermission, notificationsAutorisees, notificationsRefusees, notifier } from './notifications.js';
import { android } from './android.js';
import { ICONES } from './icones.js';
import { SessionLocale } from '../session-locale.js';

export const VERSION = '1.0.0';

/**
 * Vitesse du jeu : un curseur, de « très lente » à « rapide ». Elle règle les animations des pions et des cartes, le
 * temps laissé pour lire le coup d'un autre joueur et le délai des IA.
 */
function curseurVitesse(vitesse, surChange) {
  const nom = h('b', { class: 'valeur-curseur' }, nomVitesse(vitesse));
  return h(
    'div',
    { class: 'champ reglage-curseur', style: { padding: '12px 0', borderTop: '1px solid var(--line)' } },
    h('div', { class: 'titre-curseur' }, h('span', {}, 'Vitesse du jeu'), nom),
    h('input', {
      type: 'range',
      min: VITESSE_MIN,
      max: VITESSE_MAX,
      step: VITESSE_PAS,
      value: vitesse,
      'aria-label': 'Vitesse du jeu',
      'aria-valuetext': nomVitesse(vitesse),
      'data-reglage': 'vitesse',
      oninput: (e) => {
        nom.textContent = nomVitesse(Number(e.target.value));
        e.target.setAttribute('aria-valuetext', nom.textContent);
      },
      onchange: (e) => surChange(Number(e.target.value)),
    }),
    h('div', { class: 'bornes-curseur', 'aria-hidden': 'true' }, h('span', {}, 'Lente'), h('span', {}, 'Rapide')),
    h('p', { class: 'note' }, 'Animations des pions et des cartes, temps de lecture après chaque coup, délai des IA.'),
  );
}

export function afficher(racine, app) {
  let message = '';

  const dessiner = () => {
    const r = lireReglages();
    const maj = (modif) => {
      modifierReglages(modif);
    };
    const blocs = [entete('Réglages')];

    // ─── L'essentiel ───
    blocs.push(
      h(
        'div',
        { class: 'carte formulaire' },
        h(
          'div',
          { class: 'champ' },
          'Taille du texte',
          segments(
            TAILLES.map((t) => ({ valeur: t.taille, nom: t.nom })),
            r.texte,
            (texte) => maj({ texte }),
          ),
        ),
        h(
          'div',
          { class: 'champ' },
          'Thème',
          segments(
            THEMES.map((t) => ({ valeur: t.theme, nom: t.nom })),
            r.theme,
            (theme) => maj({ theme }),
          ),
        ),
        etrePrevenu(r),
      ),
    );

    // ─── Compte ───
    blocs.push(h('h2', {}, 'Compte'), h('div', { class: 'carte' }, sectionCompte()));

    // ─── Plateau et jeu ───
    blocs.push(
      h('h2', {}, 'Plateau et jeu'),
      h(
        'div',
        { class: 'carte' },
        interrupteur({
          titre: 'Voir le coup avant de le valider',
          texte: 'Le coup choisi est montré sur le plateau ; il part quand tu touches « Jouer ».',
          actif: r.confirmerCoup,
          surChange: (confirmerCoup) => maj({ confirmerCoup }),
        }),
        curseurVitesse(r.vitesse, (vitesse) => maj({ vitesse })),
        interrupteur({
          titre: 'Jouer tout seul le coup quand il n’y en a qu’un',
          actif: r.coupUniqueAuto,
          surChange: (coupUniqueAuto) => maj({ coupUniqueAuto }),
        }),
        interrupteur({
          titre: 'Animations',
          actif: r.animations,
          surChange: (animations) => maj({ animations }),
        }),
        interrupteur({
          titre: 'Conseils de l’IA',
          texte: 'Contre l’IA et dans l’analyse. Jamais en ligne.',
          actif: r.conseilsIA,
          surChange: (conseilsIA) => {
            maj({ conseilsIA });
            dessiner();
          },
        }),
        r.conseilsIA
          ? h(
              'div',
              { class: 'sous-reglage', 'data-reglage': 'commenter' },
              interrupteur({
                titre: 'Commenter mes coups contre l’IA',
                actif: r.commenterCoups,
                surChange: (commenterCoups) => maj({ commenterCoups }),
              }),
            )
          : null,
      ),
    );

    // ─── Notifications ───
    const notifs = h('div', { class: 'carte' });
    if (!r.notifications) notifs.append(rangee({ titre: 'Alertes coupées', texte: 'Active « Être prévenu quand c’est mon tour » en haut de l’écran.' }));
    else {
      if (notificationsAutorisees())
        notifs.append(
          rangee({
            titre: 'Essai',
            droite: h('button', { type: 'button', class: 'bouton', onclick: () => notifier('essai', 'Toc', 'Les notifications fonctionnent.', '#/reglages') }, 'Envoyer un essai'),
          }),
        );
      notifs.append(
        interrupteur({ titre: 'C’est mon tour', actif: r.notifTour, surChange: (notifTour) => maj({ notifTour }) }),
        interrupteur({ titre: 'Invitations', actif: r.notifInvitations, surChange: (notifInvitations) => maj({ notifInvitations }) }),
        interrupteur({ titre: 'Fin de partie', actif: r.notifFin, surChange: (notifFin) => maj({ notifFin }) }),
      );
    }
    blocs.push(h('h2', {}, 'Notifications'), notifs);

    // ─── Données ───
    const sauvegarde = SessionLocale.lireSauvegarde(localStorage);
    blocs.push(
      h('h2', {}, 'Données de cet appareil'),
      h(
        'div',
        { class: 'carte' },
        rangee({
          titre: 'Partie contre l’IA',
          texte: sauvegarde ? `Une partie gardée (donne ${sauvegarde.partie.etat.donne + 1}${sauvegarde.partie.etat.phase === 'fini' ? ', terminée' : ''}).` : 'Aucune partie gardée.',
          droite: h(
            'button',
            {
              type: 'button',
              class: 'bouton danger',
              disabled: !sauvegarde,
              onclick: () => {
                if (!confirm('Effacer la partie contre l’IA gardée sur cet appareil ?')) return;
                SessionLocale.effacerSauvegarde(localStorage);
                dessiner();
              },
            },
            'Effacer',
          ),
        }),
      ),
    );

    // ─── À propos ───
    const majTexte = h('span', {}, android ? 'Avec l’appli « Mes applis ».' : 'Vérifiée au lancement ; tu peux aussi la demander.');
    blocs.push(
      h('h2', {}, 'À propos'),
      h(
        'div',
        { class: 'carte' },
        rangee({ titre: 'Version', texte: `Toc ${android ? android.version() : VERSION}${app.demo ? ' · mode démonstration' : ''}` }),
        rangee({
          titre: 'Mise à jour',
          texte: majTexte,
          droite: android ? null : h(
            'button',
            {
              type: 'button',
              class: 'bouton',
              onclick: async () => {
                majTexte.textContent = 'Recherche…';
                try {
                  const reg = await navigator.serviceWorker?.getRegistration();
                  if (!reg) return (majTexte.textContent = 'Pas de mise à jour automatique dans ce mode.');
                  await reg.update();
                  majTexte.textContent = reg.installing || reg.waiting ? 'Mise à jour trouvée : elle sera prise au prochain lancement.' : 'Tu as la dernière version.';
                } catch {
                  majTexte.textContent = 'Impossible de vérifier : es-tu connecté à Internet ?';
                }
              },
            },
            'Vérifier',
          ),
        }),
      ),
    );
    remplacer(racine, h('div', { class: 'contenu' }, blocs));
  };

  function etrePrevenu(r) {
    const autorisees = notificationsAutorisees();
    const enfants = [];
    if (r.notifications && autorisees === null) enfants.push(h('span', { class: 'note' }, 'Cet appareil ne propose pas les notifications.'));
    if (r.notifications && autorisees === false)
      enfants.push(
        h('div', {}, h('button', { type: 'button', class: 'bouton', onclick: async () => (await demanderPermission(), dessiner()) }, 'Autoriser les alertes')),
        notificationsRefusees()
          ? h('span', { class: 'note' }, 'Le système les refuse : réglages du téléphone (ou du navigateur), Notifications, Toc.')
          : null,
      );
    return interrupteur({
      titre: 'Être prévenu quand c’est mon tour',
      actif: r.notifications,
      surChange: async (notifications) => {
        modifierReglages({ notifications });
        if (notifications) await demanderPermission();
        dessiner();
      },
      enfants,
    });
  }

  function sectionCompte() {
    const j = app.joueur;
    if (!app.enLigne()) return [rangee({ titre: 'Compte', texte: 'Le jeu en ligne n’est pas disponible sur cet appareil : les parties contre l’IA marchent sans compte.' })];
    if (!j)
      return [
        rangee({
          titre: 'Compte',
          droite: h('a', { class: 'bouton', href: '#/parties' }, 'Se connecter'),
        }),
      ];
    const enregistrer = async (modif) => {
      message = '';
      try {
        const suite = await app.api.modifierProfil(modif);
        if (suite) {
          app.joueur = { ...app.joueur, ...suite };
          retenirIcone(suite.uid, suite.icone);
        }
        toast('Enregistré.');
      } catch (e) {
        message = messageErreur(e);
      }
      dessiner();
    };
    const lignes = [];
    if (j.verrouille) {
      lignes.push(rangee({ titre: 'Prénom', texte: 'Ce prénom a été fixé par l’administrateur : il ne peut pas être changé.', enfants: h('b', {}, j.pseudo) }));
    } else {
      const champ = h('input', { class: 'champ-code libre', value: j.pseudo, maxlength: 20, 'aria-label': 'Prénom', autocapitalize: 'words' });
      const bouton = h('button', { type: 'submit', class: 'bouton', disabled: true }, 'Enregistrer');
      champ.addEventListener('input', () => (bouton.disabled = !champ.value.trim() || champ.value.trim() === j.pseudo));
      lignes.push(
        rangee({
          titre: 'Prénom',
          enfants: h(
            'form',
            {
              class: 'actions',
              onsubmit: (e) => {
                e.preventDefault();
                const pseudo = champ.value.trim().slice(0, 20);
                if (pseudo) enregistrer({ pseudo });
              },
            },
            champ,
            bouton,
          ),
        }),
      );
    }
    const grille = h('div', { class: 'choix-icones', role: 'radiogroup', 'aria-label': 'Icône' });
    grille.append(
      h(
        'button',
        {
          type: 'button',
          role: 'radio',
          'aria-checked': String(!j.icone),
          'aria-label': 'Aucune : l’initiale de ton prénom',
          class: 'choix-icone initiale' + (!j.icone ? ' choisie' : ''),
          onclick: () => j.icone && enregistrer({ icone: null }),
        },
        j.pseudo.slice(0, 1).toUpperCase(),
      ),
    );
    for (const i of ICONES) {
      grille.append(
        h(
          'button',
          {
            type: 'button',
            role: 'radio',
            'aria-checked': String(j.icone === i.id),
            'aria-label': i.nom,
            class: 'choix-icone' + (j.icone === i.id ? ' choisie' : ''),
            onclick: () => j.icone !== i.id && enregistrer({ icone: i.id }),
          },
          i.emoji,
        ),
      );
    }
    lignes.push(rangee({ titre: 'Icône', enfants: grille }));
    lignes.push(
      interrupteur({
        titre: 'Être trouvé par les autres joueurs',
        actif: j.visible !== false,
        surChange: (visible) => enregistrer({ visible }),
      }),
    );
    if (message) lignes.push(h('div', { class: 'apercu erreur' }, message));
    const st = j.stats || { jouees: 0, gagnees: 0 };
    lignes.push(
      rangee({
        titre: 'Compte',
        texte: `${pluriel(st.jouees, 'partie jouée', 'parties jouées')}, ${pluriel(st.gagnees, 'gagnée', 'gagnées')}.`,
        droite: h(
          'button',
          {
            type: 'button',
            class: 'bouton danger',
            'data-action': 'deconnecter',
            onclick: async () => {
              try {
                await app.api.deconnecter();
                app.naviguer('#/parties');
              } catch (e) {
                toast(messageErreur(e), { erreur: true });
              }
            },
          },
          'Se déconnecter',
        ),
      }),
    );
    return lignes;
  }

  dessiner();
  app.surJoueur = () => dessiner();
  return () => {
    app.surJoueur = null;
  };
}
