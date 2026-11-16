// Conseil d'installation (comme ConseilInstallation de l'appli Scrabble) : sur iPhone / iPad dans Safari,
// expliquer « Sur l'écran d'accueil » ; ailleurs, proposer le bouton « Installer » quand le navigateur l'offre.

import { h, lire, ecrire } from './dom.js';

const CLE = 'toc.installationEcartee';

function installee() {
  return navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
}

function appareilApple() {
  const iphone = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const ipadMac = navigator.platform === 'MacIntel' && (navigator.maxTouchPoints ?? 0) > 1;
  return iphone || ipadMac;
}

/** Carte de conseil, ou null s'il n'y a rien à conseiller. `app` : pour l'invitation d'installation gardée. */
export function conseilInstallation(app) {
  if (lire(CLE, false) || installee()) return null;
  const apple = appareilApple();
  if (!apple && !app.invitationInstallation) return null;
  const carte = h(
    'div',
    { class: 'carte carte-accent' },
    h('b', {}, 'Installe l’appli sur ton écran d’accueil'),
    h(
      'span',
      { class: 'note' },
      apple
        ? 'Touche le bouton Partager de Safari, puis « Sur l’écran d’accueil ». Le Toc s’ouvre alors comme une appli, même sans réseau, et peut te prévenir quand c’est ton tour.'
        : 'Le Toc s’ouvre alors comme une appli, même sans réseau, et peut te prévenir quand c’est ton tour.',
    ),
  );
  const actions = h('div', { class: 'actions' });
  actions.append(
    h(
      'button',
      {
        type: 'button',
        class: 'bouton large',
        onclick: () => {
          ecrire(CLE, true);
          carte.remove();
        },
      },
      'Masquer',
    ),
  );
  if (!apple && app.invitationInstallation) {
    actions.append(
      h(
        'button',
        {
          type: 'button',
          class: 'bouton large',
          onclick: async () => {
            const invite = app.invitationInstallation;
            app.invitationInstallation = null;
            try {
              await invite.prompt();
            } catch {
              /* refusé */
            }
            carte.remove();
          },
        },
        'Installer',
      ),
    );
  }
  carte.append(actions);
  return carte;
}
