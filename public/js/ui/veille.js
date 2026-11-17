// Veille des parties en ligne de l'utilisateur connecté : une seule écoute de « Mes parties » et des invitations
// reçues, partagée par les écrans ; elle tient à jour la pastille, le badge et le titre, et prévient (notification
// locale, ou toast si l'appli est au premier plan) quand c'est à lui de jouer, quand on l'invite, quand une partie
// se termine.

import { majEnAttente, notifier } from './notifications.js';
import { toast } from './composants.js';

let api = null;
let arret = [];
let etat = { pret: false, parties: [], invitations: [], erreur: '' };
const abonnes = new Set();
// Ce qu'on savait déjà, pour ne prévenir que des changements.
let connues = null; // Map id → { aMoi, statut, nom, abandonAttendu } (abandonAttendu : on attend ma réponse à un abandon)
let invitationsConnues = null; // Set id
/** Partie affichée à l'écran (pas de toast pour elle). */
let partieOuverte = null;

export function definirPartieOuverte(id) {
  partieOuverte = id;
}

/** Écoute l'état de la veille : cb({ pret, parties, invitations, erreur }). */
export function surVeille(cb) {
  abonnes.add(cb);
  cb(etat);
  return () => abonnes.delete(cb);
}

function publier(modif) {
  etat = { ...etat, ...modif };
  majEnAttente(etat.parties.filter((p) => p.aMoiDeJouer).length + etat.invitations.length);
  for (const cb of abonnes) cb(etat);
}

export function demarrerVeille(reseau) {
  arreterVeille();
  api = reseau;
  connues = null;
  invitationsConnues = null;
  try {
    arret.push(
      api.surMesParties((parties) => {
        signalerParties(parties || []);
        publier({ pret: true, parties: parties || [] });
      }),
    );
  } catch (e) {
    publier({ pret: true, erreur: e.message });
  }
  if (typeof api.surInvitations === 'function') {
    try {
      arret.push(
        api.surInvitations((invitations) => {
          signalerInvitations(invitations || []);
          publier({ invitations: invitations || [] });
        }),
      );
    } catch {
      /* invitations indisponibles : le reste de l'écran marche */
    }
  }
}

export function arreterVeille() {
  for (const f of arret) {
    try {
      f?.();
    } catch {
      /* déjà arrêté */
    }
  }
  arret = [];
  etat = { pret: false, parties: [], invitations: [], erreur: '' };
  majEnAttente(0);
}

const cache = () => document.visibilityState === 'hidden';

function prevenir(cle, titre, texte, hash, genre, id) {
  if (cache()) void notifier(cle, titre, texte, hash, genre);
  else if (id !== partieOuverte) toast(texte);
}

function signalerParties(parties) {
  const reponseAttendue = (p) => !!p.abandon && !p.abandon.jAiAccepte;
  const suite = new Map(parties.map((p) => [p.id, { aMoi: !!p.aMoiDeJouer, statut: p.statut, nom: p.nom || 'Partie de Toc', abandonAttendu: reponseAttendue(p) }]));
  if (connues) {
    // Une partie en cours qui n'est plus dans la liste a été abandonnée d'un commun accord.
    for (const [id, avant] of connues) {
      if (avant.statut === 'encours' && !suite.has(id) && id !== partieOuverte) toast(`${avant.nom} : la partie a été abandonnée d’un commun accord.`);
    }
    for (const p of parties) {
      const avant = connues.get(p.id);
      const nom = p.nom || 'Partie de Toc';
      // Un joueur propose d'abandonner : ma réponse est attendue.
      if (reponseAttendue(p) && !avant?.abandonAttendu && p.statut === 'encours') {
        const qui = p.abandon.pour.map((x) => x.pseudo).join(', ') || 'Un joueur';
        prevenir('abandon-' + p.id, 'Abandon proposé', `${nom} : ${qui} propose d’abandonner la partie.`, '#/partie/' + p.id, 'tour', p.id);
      }
      if (p.aMoiDeJouer && !avant?.aMoi && p.statut === 'encours') {
        prevenir('tour-' + p.id, 'À toi de jouer', `${nom} : c’est à toi de jouer.`, '#/partie/' + p.id, 'tour', p.id);
      } else if (p.statut === 'finie' && avant && avant.statut !== 'finie') {
        const a3 = (p.nbJoueurs || p.joueurs?.length) === 3;
        const gagne = p.monSiege >= 0 && p.gagnant === (a3 ? p.monSiege : p.monSiege % 2);
        const texte = a3 ? (gagne ? 'tu as gagné !' : 'tu as perdu.') : gagne ? 'ton équipe a gagné !' : 'ton équipe a perdu.';
        prevenir('fin-' + p.id, 'Partie terminée', `${nom} : ${texte}`, '#/partie/' + p.id, 'fin', p.id);
      }
    }
  }
  connues = suite;
}

function signalerInvitations(invitations) {
  if (invitationsConnues) {
    for (const p of invitations) {
      if (invitationsConnues.has(p.id)) continue;
      const hote = p.joueurs?.find((j) => j && j.uid === p.hote)?.pseudo || 'Un joueur';
      prevenir('invitation-' + p.id, 'Invitation', `${hote} t’invite à jouer au Toc.`, '#/parties', 'invitation', null);
    }
  }
  invitationsConnues = new Set(invitations.map((p) => p.id));
}
