// Partie en ligne (route #/partie/ID) : salle d'attente tant que la partie n'est pas lancée, puis plateau.
// Salle d'attente sur le modèle de l'appli Scrabble : on touche le nom d'un joueur pour l'inviter, ou on envoie
// le lien ; le code reste affiché (le cahier des charges le demande). Le Toc se joue à 4 : jusqu'à 3 invités,
// et l'hôte peut compléter avec des IA.

import { h, remplacer, messageErreur, pluriel } from './dom.js';
import { enteteRetour, avatar, toast, retenirIcone, chargerIcone, iconeConnue } from './composants.js';
import { monterJeu } from './vue-jeu.js';
import { definirPartieOuverte } from './veille.js';
import { piPartager, piPlus } from './pictos.js';
import { couleurSiege } from './couleurs.js';

export function afficher(racine, app, { reste }) {
  const id = reste[0];
  const api = app.api;
  if (!app.enLigne() || !app.joueur) {
    app.naviguer('#/parties', true);
    return null;
  }
  definirPartieOuverte(id);
  let resume;
  let modeJeu = false;
  let demonterJeu = null;
  let session = null;
  let fermee = false;
  let joueursConnus = null; // liste des joueurs qu'on peut inviter
  let erreurAttente = '';
  let occupe = false;

  const arretPartie = api.surPartie(id, (p) => {
    resume = p;
    if (fermee) return;
    if (p === null) {
      if (!modeJeu) {
        remplacer(
          racine,
          h(
            'div',
            { class: 'contenu' },
            enteteRetour('Partie', '#/parties'),
            h('div', { class: 'vide-etat' }, 'Cette partie n’existe plus (l’hôte l’a peut-être supprimée).'),
            h('a', { class: 'bouton', href: '#/parties' }, 'Mes parties'),
          ),
        );
      }
      return;
    }
    if (p.statut === 'attente') dessinerAttente();
    else if (!modeJeu) ouvrirJeu();
  });

  async function ouvrirJeu() {
    modeJeu = true;
    remplacer(racine, h('div', { class: 'vide-etat' }, 'Ouverture de la partie…'));
    try {
      session = await api.ouvrirSession(id);
    } catch (e) {
      modeJeu = false;
      remplacer(
        racine,
        h('div', { class: 'contenu' }, enteteRetour(resume?.nom || 'Partie', '#/parties'), h('div', { class: 'apercu erreur' }, messageErreur(e))),
      );
      return;
    }
    if (fermee) {
      session.fermer();
      return;
    }
    demonterJeu = monterJeu(racine, { session: avecIcones(session), retour: '#/parties', libelleRetour: 'Mes parties' });
  }

  /** Ajoute l'icône de chaque joueur (lue dans sa fiche) aux joueurs de la vue. */
  function avecIcones(s) {
    let rappel = null;
    let derniere = null;
    const completer = (v) => ({
      ...v,
      joueurs: v.joueurs.map((j, i) => {
        const uid = j?.uid ?? resume?.joueurs?.[i]?.uid;
        return { ...j, uid, icone: j?.icone ?? iconeConnue(uid) };
      }),
    });
    return {
      abonner(cb) {
        rappel = cb;
        return s.abonner((v) => {
          derniere = v;
          const c = completer(v);
          cb(c);
          for (const j of c.joueurs) {
            if (j.uid && !j.ia && j.icone === undefined) chargerIcone(j.uid).then(() => derniere && rappel?.(completer(derniere)));
          }
        });
      },
      donner: (c) => s.donner(c),
      jouer: (c) => s.jouer(c),
      fermer: () => s.fermer(),
    };
  }

  // ─── Salle d'attente ──────────────────────────────────────────────────────

  async function agir(action) {
    occupe = true;
    erreurAttente = '';
    dessinerAttente();
    try {
      await action();
    } catch (e) {
      erreurAttente = messageErreur(e);
    } finally {
      occupe = false;
      if (!fermee && resume?.statut === 'attente') dessinerAttente();
    }
  }

  function dessinerAttente() {
    const p = resume;
    const moi = app.joueur.uid;
    const hote = p.hote === moi;
    const places = p.joueurs || [];
    const monSiege = places.findIndex((x) => x && x.uid === moi);
    const libres = [0, 1, 2, 3].filter((si) => !places[si]);
    const complet = libres.length === 0;
    const vue = monSiege >= 0 ? monSiege : 0;

    const siege = (si) => {
      const place = places[si];
      const equipe = si % 2 === vue % 2 ? 'Mon équipe' : 'Adversaires';
      const actions = [];
      if (!place) {
        if (monSiege >= 0) actions.push(h('button', { type: 'button', class: 'bouton petit', disabled: occupe, onclick: () => agir(() => api.choisirSiege(p.id, si)) }, 'M’asseoir ici'));
        if (hote) actions.push(h('button', { type: 'button', class: 'bouton petit', disabled: occupe, 'data-action': 'ajouter-ia', onclick: () => agir(() => api.ajouterIA(p.id, si)) }, piPlus(14), 'IA'));
      } else if (place.ia && hote) {
        actions.push(h('button', { type: 'button', class: 'bouton petit danger', disabled: occupe, onclick: () => agir(() => api.retirerIA(p.id, si)) }, 'Retirer'));
      }
      const nom = place ? (place.uid === moi ? `${place.pseudo} (toi)` : place.pseudo || (place.ia ? 'IA' : '?')) : 'Place libre';
      return h(
        'div',
        { class: 'siege' + (place ? '' : ' libre') + (si === monSiege ? ' moi' : ''), 'data-siege': si, style: { '--c': couleurSiege(si) } },
        place ? avatar({ uid: place.uid, nom: place.pseudo, ia: place.ia, fond: couleurSiege(si) }) : h('div', { class: 'avatar vide', 'aria-hidden': 'true' }, '?'),
        h('div', { class: 'nom-siege' }, nom),
        h('div', { class: 'note' }, place?.uid === p.hote ? `Hôte · ${equipe}` : place?.ia ? `IA · ${equipe}` : equipe),
        actions.length ? h('div', { class: 'actions-siege' }, actions) : null,
      );
    };
    const pos = (c) => (vue + c) % 4;
    const table = h(
      'div',
      { class: 'table-attente', 'aria-label': 'Places autour de la table' },
      h('div', { class: 'place-haut' }, siege(pos(2))),
      h('div', { class: 'place-gauche' }, siege(pos(1))),
      h('div', { class: 'tapis-table' }, h('span', {}, 'Partenaires'), h('span', { class: 'note' }, 'face à face')),
      h('div', { class: 'place-droite' }, siege(pos(3))),
      h('div', { class: 'place-bas' }, siege(pos(0))),
    );

    const blocs = [
      enteteRetour(p.nom || 'Salle d’attente', '#/parties'),
      h(
        'div',
        { class: 'carte' },
        h('div', { class: 'titre-carte' }, h('b', {}, 'Salle d’attente'), h('span', { class: 'note' }, `${p.reglages?.cinqAdverse ? 'Option « 5 adverse »' : '5 normal'} · ${complet ? '4 joueurs : prêt' : pluriel(libres.length, 'place libre', 'places libres')}`)),
        table,
      ),
    ];
    if (erreurAttente) blocs.push(h('div', { class: 'apercu erreur' }, erreurAttente));
    if (hote) {
      blocs.push(
        h(
          'button',
          { type: 'button', class: 'bouton principal large', disabled: !complet || occupe, 'data-action': 'lancer', onclick: () => agir(() => api.lancerPartie(p.id)) },
          complet ? 'Lancer la partie' : `Lancer la partie (encore ${pluriel(libres.length, 'place')} à remplir)`,
        ),
      );
      if (!complet) blocs.push(h('p', { class: 'note centre' }, 'Invite des joueurs, ou touche « IA » sur une place libre pour la compléter.'));
    } else {
      blocs.push(h('div', { class: 'apercu' }, h('span', {}, complet ? 'Tout le monde est là : l’hôte va lancer la partie.' : `En attente de ${pluriel(libres.length, 'joueur')}… L’hôte lancera la partie.`)));
    }
    if (!complet) blocs.push(carteInviter(p, hote, libres.length));
    blocs.push(carteLien(p));
    blocs.push(
      h(
        'button',
        {
          type: 'button',
          class: 'bouton discret danger',
          'data-action': 'quitter',
          onclick: () => {
            if (!confirm(hote ? 'Supprimer cette partie ? Les joueurs déjà assis en sortiront.' : 'Quitter cette partie ?')) return;
            agir(async () => {
              await api.quitterPartie(p.id);
              app.naviguer('#/parties');
            });
          },
        },
        hote ? 'Supprimer la partie' : 'Quitter la partie',
      ),
    );
    remplacer(racine, h('div', { class: 'contenu salle-attente' }, blocs));
  }

  function carteInviter(p, hote, nbLibres) {
    const invites = p.invites || [];
    const assis = new Set((p.joueurs || []).filter(Boolean).map((x) => x.uid));
    const carte = h('div', { class: 'carte formulaire' }, h('b', { class: 'grand' }, 'Avec qui veux-tu jouer ?'));
    if (!hote) {
      carte.append(h('span', { class: 'note' }, 'Seul l’hôte invite des joueurs ; tu peux envoyer le lien ci-dessous.'));
      return carte;
    }
    const peutInviter = invites.length < nbLibres;
    carte.append(
      h(
        'span',
        { class: 'note' },
        invites.length ? `Invité${invites.length > 1 ? 's' : ''} : ${invites.map((i) => i.pseudo).join(', ')}. Ils reçoivent l’invitation dans « Mes parties ».` : `Touche le nom d’un joueur pour l’inviter (jusqu’à ${pluriel(nbLibres, 'joueur')}).`,
      ),
    );
    const liste = h('div', { class: 'liste' });
    carte.append(liste);
    if (joueursConnus === null) {
      liste.append(h('span', { class: 'note' }, 'Chargement des joueurs…'));
      if (typeof api.listerJoueurs === 'function') {
        api
          .listerJoueurs()
          .then((js) => {
            joueursConnus = js || [];
            for (const j of joueursConnus) retenirIcone(j.uid, j.icone);
            if (!fermee && resume?.statut === 'attente') dessinerAttente();
          })
          .catch((e) => {
            joueursConnus = [];
            erreurAttente = messageErreur(e);
          });
      } else joueursConnus = [];
      return carte;
    }
    const candidats = joueursConnus.filter((j) => j.uid !== app.joueur.uid && !assis.has(j.uid));
    if (!candidats.length) liste.append(h('span', { class: 'note' }, 'Aucun autre joueur pour l’instant : envoie le lien ci-dessous.'));
    for (const j of candidats.slice(0, 30)) {
      const invite = invites.some((i) => i.uid === j.uid);
      liste.append(
        h(
          'button',
          {
            type: 'button',
            class: 'ligne' + (invite ? ' choisie' : ''),
            disabled: occupe || (!invite && !peutInviter),
            'data-inviter': j.pseudo,
            onclick: () => agir(() => (invite ? api.annulerInvitation(p.id, j.uid) : api.inviter(p.id, j.uid))),
          },
          avatar({ uid: j.uid, nom: j.pseudo, icone: j.icone ?? null, fond: invite ? 'var(--accent)' : 'var(--muted)' }),
          h('div', { class: 'principal mot grand' }, j.pseudo),
          h('span', { class: invite ? 'note' : 'bouton' }, invite ? 'Invité ✓ · annuler' : 'Inviter'),
        ),
      );
    }
    return carte;
  }

  function carteLien(p) {
    const lien = `${location.origin}${location.pathname}${app.demo ? '?demo' : ''}#/rejoindre/${p.code}`;
    const message = `Viens jouer au Toc avec moi ! Touche ce lien : ${lien} (code ${p.code})`;
    const bouton = h(
      'button',
      {
        type: 'button',
        class: 'bouton principal large',
        'data-action': 'partager',
        onclick: async () => {
          if (navigator.share) {
            try {
              await navigator.share({ title: 'Partie de Toc', text: message });
              return;
            } catch (e) {
              if (e?.name === 'AbortError') return;
            }
          }
          try {
            await navigator.clipboard.writeText(message);
            bouton.lastChild.textContent = 'Lien copié !';
            toast('Lien copié : colle-le dans un message.');
          } catch {
            toast('Copie impossible : donne le code ' + p.code, { erreur: true });
          }
        },
      },
      piPartager(),
      h('span', {}, 'Envoyer le lien'),
    );
    return h(
      'div',
      { class: 'carte formulaire' },
      h('b', { class: 'grand' }, 'Quelqu’un d’autre ?'),
      h('span', { class: 'note' }, 'Envoie-lui le lien : en le touchant, il arrive directement dans la partie. Il peut aussi saisir le code dans « Mes parties ».'),
      h('div', { class: 'code-invitation', 'aria-label': `Code d’invitation ${p.code.split('').join(' ')}` }, h('span', { class: 'note' }, 'Code'), h('span', { class: 'code' }, p.code)),
      bouton,
    );
  }

  return () => {
    fermee = true;
    definirPartieOuverte(null);
    try {
      arretPartie?.();
    } catch {
      /* déjà arrêté */
    }
    demonterJeu?.();
    session?.fermer();
  };
}
