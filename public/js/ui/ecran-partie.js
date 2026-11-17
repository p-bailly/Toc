// Partie en ligne (route #/partie/ID) : salle d'attente tant que la partie n'est pas lancée, puis plateau.
// Salle d'attente sur le modèle de l'appli Scrabble : on touche le nom d'un joueur pour l'inviter, ou on envoie
// le lien ; le code reste affiché (le cahier des charges le demande). Le Toc se joue à 4 : jusqu'à 3 invités,
// et l'hôte peut compléter avec des IA.

import { h, remplacer, messageErreur, pluriel } from './dom.js';
import { enteteRetour, avatar, toast, retenirIcone, chargerIcone, iconeConnue, ouvrirFeuille } from './composants.js';
import { nomNiveau, niveauValide, niveauEnLigne, ecrireNiveauEnLigne, listeNiveaux } from './niveaux.js';
import { monterJeu } from './vue-jeu.js';
import { definirPartieOuverte } from './veille.js';
import { piPartager, piPlus } from './pictos.js';
import { couleurSiege } from './couleurs.js';
import { android } from './android.js';

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
    demonterJeu = monterJeu(racine, { session: avecIcones(session), retour: '#/parties', libelleRetour: 'Mes parties', essais: !!app.rapide, analyse: '#/analyse/' + encodeURIComponent(id) });
  }

  /** Ajoute l'icône de chaque joueur (lue dans sa fiche) aux joueurs de la vue. */
  function avecIcones(s) {
    let rappel = null;
    let derniere = null;
    const completer = (v) => ({
      ...v,
      joueurs: v.joueurs.map((j, i) => {
        const uid = j?.uid ?? resume?.joueurs?.[i]?.uid;
        return { ...j, uid, icone: j?.icone ?? iconeConnue(uid), niveau: j?.niveau ?? resume?.joueurs?.[i]?.niveau };
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
    const n = p.nbJoueurs === 3 || places.length === 3 ? 3 : 4;
    const libres = Array.from({ length: n }, (_, si) => si).filter((si) => !places[si]);
    const complet = libres.length === 0;
    const vue = monSiege >= 0 ? monSiege : 0;
    // À 3 : pas d'équipe ; on indique l'ordre de jeu (1er, 2e, 3e à partir du siège 0).
    const rangJeu = (si) => ['1er à jouer', '2e à jouer', '3e à jouer'][si];

    const siege = (si) => {
      const place = places[si];
      const equipe = n === 3 ? rangJeu(si) : si % 2 === vue % 2 ? 'Mon équipe' : 'Adversaires';
      const actions = [];
      if (!place) {
        if (monSiege >= 0) actions.push(h('button', { type: 'button', class: 'bouton petit', disabled: occupe, onclick: () => agir(() => api.choisirSiege(p.id, si)) }, 'M’asseoir ici'));
        // L'IA arrive au dernier niveau choisi ; l'hôte peut le changer d'un toucher sur sa place.
        if (hote) actions.push(h('button', { type: 'button', class: 'bouton petit', disabled: occupe, 'data-action': 'ajouter-ia', onclick: () => agir(() => api.ajouterIA(p.id, si, niveauEnLigne())) }, piPlus(14), 'IA'));
      } else if (place.ia && hote) {
        actions.push(
          h('button', { type: 'button', class: 'bouton petit', disabled: occupe, 'data-action': 'niveau-ia', onclick: () => choisirNiveauIA(p, si, place) }, nomNiveau(place.niveau), ' ▾'),
          h('button', { type: 'button', class: 'bouton petit danger', disabled: occupe, onclick: () => agir(() => api.retirerIA(p.id, si)) }, 'Retirer'),
        );
      }
      const nom = place ? (place.uid === moi ? `${place.pseudo} (toi)` : place.pseudo || (place.ia ? 'IA' : '?')) : 'Place libre';
      return h(
        'div',
        { class: 'siege' + (place ? '' : ' libre') + (si === monSiege ? ' moi' : ''), 'data-siege': si, style: { '--c': couleurSiege(si) } },
        place ? avatar({ uid: place.uid, nom: place.pseudo, ia: place.ia, fond: couleurSiege(si) }) : h('div', { class: 'avatar vide', 'aria-hidden': 'true' }, '?'),
        h('div', { class: 'nom-siege' }, nom),
        h('div', { class: 'note' }, place?.uid === p.hote ? `Hôte · ${equipe}` : place?.ia ? (hote ? `IA · ${equipe}` : `IA ${nomNiveau(place.niveau)} · ${equipe}`) : equipe),
        actions.length ? h('div', { class: 'actions-siege' }, actions) : null,
      );
    };
    const pos = (c) => (vue + c) % n;
    const ordre = Array.from({ length: n }, (_, k) => {
      const pl = places[k];
      return pl ? (pl.uid === moi ? 'toi' : pl.pseudo) : 'place libre';
    });
    const table =
      n === 3
        ? h(
            'div',
            { class: 'table-attente table-3', 'aria-label': 'Places autour de la table' },
            h('div', { class: 'place-haut-gauche' }, siege(pos(1))),
            h('div', { class: 'place-haut-droite' }, siege(pos(2))),
            h(
              'div',
              { class: 'tapis-table tapis-triangle-attente' },
              h('span', {}, 'Chacun pour soi'),
            ),
            h('div', { class: 'place-bas' }, siege(pos(0))),
          )
        : h(
      'div',
      { class: 'table-attente', 'aria-label': 'Places autour de la table' },
      h('div', { class: 'place-haut' }, siege(pos(2))),
      h('div', { class: 'place-gauche' }, siege(pos(1))),
      h('div', { class: 'tapis-table' }, h('span', {}, 'Partenaires'), h('span', { class: 'note' }, 'face à face')),
      h('div', { class: 'place-droite' }, siege(pos(3))),
      h('div', { class: 'place-bas' }, siege(pos(0))),
    );

    const options = [n === 3 ? '3 joueurs' : '2 contre 2'];
    if (p.reglages?.cinqAdverse) options.push('« 5 adverse »');
    const blocs = [
      enteteRetour(p.nom || 'Salle d’attente', '#/parties'),
      h(
        'div',
        { class: 'carte' },
        h('div', { class: 'titre-carte' }, h('b', {}, 'Salle d’attente'), h('span', { class: 'note' }, `${options.join(' · ')} · ${complet ? 'prêt à lancer' : pluriel(libres.length, 'place libre', 'places libres')}`)),
        table,
        n === 3 ? h('p', { class: 'note ordre-jeu' }, `Ordre de jeu (sens des aiguilles d’une montre) : ${ordre.join(' → ')}`) : null,
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

  /** Feuille de choix du niveau d'une IA déjà assise (hôte, avant le lancement). */
  function choisirNiveauIA(p, si, place) {
    const feuille = ouvrirFeuille([
      h('h3', {}, `Niveau de ${place.pseudo || 'l’IA'}`),
      listeNiveaux(niveauValide(place.niveau), (id) => {
        feuille.fermer();
        ecrireNiveauEnLigne(id);
        if (id === niveauValide(place.niveau)) return;
        agir(async () => {
          if (typeof api.changerNiveauIA === 'function') await api.changerNiveauIA(p.id, si, id);
          else {
            await api.retirerIA(p.id, si);
            await api.ajouterIA(p.id, si, id);
          }
        });
      }),
      h('button', { type: 'button', class: 'bouton large', onclick: () => feuille.fermer() }, 'Fermer'),
    ]);
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
    const refus = (p.refus || []).filter((r) => !invites.some((i) => i.uid === r.uid));
    if (refus.length) carte.append(h('span', { class: 'note ecart-neg' }, `${refus.map((r) => r.pseudo).join(', ')} a refusé. Tu peux inviter quelqu’un d’autre.`));
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
    // Dans l'appli Android, la page n'a pas d'adresse à donner : le lien mène à la version web.
    const adresse = android ? android.adresseWeb() : location.origin + location.pathname;
    const lien = `${adresse}${app.demo ? '?demo' : ''}#/rejoindre/${p.code}`;
    const message = `Viens jouer au Toc avec moi ! Touche ce lien : ${lien} (code ${p.code})`;
    const bouton = h(
      'button',
      {
        type: 'button',
        class: 'bouton principal large',
        'data-action': 'partager',
        onclick: async () => {
          if (android) return android.partager(message);
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
      h('span', { class: 'note' }, 'Envoie le lien, ou donne le code à saisir dans « Mes parties ».'),
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
