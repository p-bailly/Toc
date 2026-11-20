// Partie en ligne (route #/partie/ID) : salle d'attente tant que la partie n'est pas lancée, puis plateau.
//
// Salle d'attente : la table, montrée par un aperçu du plateau tel qu'il sera joué (vu de sa place, aux couleurs
// des joueurs ; on y touche une place libre pour s'y asseoir, une place occupée pour choisir la couleur de ses
// pions), la palette juste dessous (ses pions, ceux d'une IA ou d'un autre joueur ; le plateau prend la couleur
// aussitôt), la liste des places (on s'assoit, on place des IA), les réglages de la partie (nom, mode, règle du
// « 5 adverse »), les invitations (lien, code, joueurs de l'appli), et en bas le bouton qui lance la partie.
// Elle est ouverte à tous et personne n'y a de droit particulier : tout joueur connecté peut
// l'ouvrir, s'y asseoir (invité ou non), placer ou retirer des IA, changer les réglages, inviter, et supprimer la
// salle ; tout joueur assis peut lancer la partie. Celui qui l'a créée peut la quitter comme les autres.
//
// Partie en cours : un joueur peut proposer de l'abandonner ; elle l'est quand tous les joueurs humains ont accepté.
// Elle disparaît alors des listes et ne compte pas dans les statistiques.
//
// Partie en cours où l'on n'est pas assis : on la regarde (mode spectateur de l'écran de jeu), sans cartes ni
// bouton de jeu, sans abandon ni analyse. Tout joueur connecté peut regarder une partie en cours.

import { h, remplacer, messageErreur, pluriel } from './dom.js';
import { enteteRetour, avatar, toast, retenirIcone, chargerIcone, iconeConnue, ouvrirFeuille, interrupteur, choixCouleur, segments } from './composants.js';
import { enumerer, rolePlace, cotePlace, deNom } from './libelles.js';
import { nomNiveau, niveauValide, niveauEnLigne, ecrireNiveauEnLigne, listeNiveaux } from './niveaux.js';
import { monterJeu } from './vue-jeu.js';
import { Plateau } from './plateau.js';
import { definirPartieOuverte } from './veille.js';
import { piPartager, piPlus, piCrayon } from './pictos.js';
import { couleurSiege, couleurFonceeSiege, couleursPartie, appliquerCouleurs, nomCouleurPartie, couleurPreferee, retenirCouleur } from './couleurs.js';
import { couleursIndisponibles } from '../palette.js';
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
  // Couleur préférée déjà proposée au serveur dans cette salle (un seul essai automatique).
  let couleurTentee = false;
  // Règle du 5 : valeur que je viens de demander, affichée en attendant que la salle la confirme.
  let cinqVoulu = null;
  let cinqEnvoye = false;
  // Couleur des pions : la place dont la palette règle la couleur (null : la mienne, ou la première occupée), et
  // la couleur que je viens de toucher ({ siege, id }), montrée tout de suite sur le plateau en attendant la salle.
  let siegeCouleur = null;
  let couleurVoulue = null;
  let couleurEnvoyee = false;
  // Aperçu du plateau de la salle d'attente : le même d'un dessin à l'autre (il tourne quand on change de place).
  let apercuPlateau = null;
  // Abandon d'une partie en cours : le bandeau posé dans l'écran de jeu, et ce qu'on savait de ma proposition.
  const bandeauAbandon = h('div', { class: 'bandeau-abandon', hidden: true, role: 'status', 'aria-live': 'polite' });
  let salleVue = false; // la salle d'attente a déjà été dessinée (les fois suivantes, sans fondu)
  let abandonOccupe = false;
  let jAvaisAccepte = false;
  let jeRetire = false;

  const arretPartie = api.surPartie(id, (p) => {
    resume = p;
    if (fermee) return;
    // Partie abandonnée d'un commun accord : l'écran de jeu se ferme, il n'y a plus rien à jouer.
    if (p && p.statut === 'abandonnee') {
      demonterJeu?.();
      demonterJeu = null;
      session?.fermer();
      session = null;
      remplacer(
        racine,
        h(
          'div',
          { class: 'contenu' },
          enteteRetour(p.nom || 'Partie', '#/parties'),
          h('div', { class: 'vide-etat', 'data-etat': 'abandonnee' }, 'Cette partie a été abandonnée d’un commun accord. Elle ne compte pas dans les statistiques.'),
          h('a', { class: 'bouton', href: '#/parties' }, 'Mes parties'),
        ),
      );
      return;
    }
    // Ma proposition d'abandon est tombée sans que je la retire : quelqu'un l'a refusée.
    if (p && p.statut === 'encours' && p.monSiege >= 0) {
      if (jAvaisAccepte && !p.abandon && !jeRetire) toast('L’abandon a été refusé : la partie continue.');
      jAvaisAccepte = !!p.abandon?.jAiAccepte;
      jeRetire = false;
      majAbandon();
    }
    if (cinqVoulu !== null && (cinqEnvoye || !p || !!p.reglages?.cinqAdverse === cinqVoulu)) {
      cinqVoulu = null;
      cinqEnvoye = false;
    }
    if (couleurVoulue !== null && (couleurEnvoyee || !p || p.joueurs?.[couleurVoulue.siege]?.couleur === couleurVoulue.id)) {
      couleurVoulue = null;
      couleurEnvoyee = false;
    }
    // Salle supprimée (par n'importe quel joueur), ou partie devenue illisible : il n'y a plus rien à voir ici.
    if (p === null) {
      if (!modeJeu) {
        remplacer(
          racine,
          h(
            'div',
            { class: 'contenu' },
            enteteRetour('Partie', '#/parties'),
            h('div', { class: 'vide-etat' }, 'Cette partie n’est plus disponible : la salle d’attente a été supprimée, ou la partie a commencé sans toi.'),
            h('a', { class: 'bouton', href: '#/parties' }, 'Mes parties'),
          ),
        );
      }
      return;
    }
    // Partie lancée : j'y joue si j'y suis assis, sinon je la regarde (ouvrirJeu : la session le sait).
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
    // Pas assis à la table : je regarde. Ni abandon à voter, ni analyse (elle part des cartes qu'on a eues en main).
    const spectateur = !resume || resume.monSiege < 0;
    demonterJeu = monterJeu(racine, {
      session: avecIcones(session),
      retour: '#/parties',
      libelleRetour: 'Mes parties',
      essais: !!app.rapide,
      analyse: spectateur ? null : '#/analyse/' + encodeURIComponent(id),
      abandon: !spectateur && typeof api.voterAbandon === 'function' ? { bandeau: bandeauAbandon, proposer: proposerAbandon } : null,
    });
    majAbandon();
  }

  // ─── Abandon d'un commun accord ───────────────────────────────────────────

  async function voterAbandon(accepte) {
    abandonOccupe = true;
    if (!accepte) jeRetire = true;
    majAbandon();
    try {
      await api.voterAbandon(id, accepte);
    } catch (e) {
      toast(messageErreur(e), { erreur: true });
    } finally {
      abandonOccupe = false;
      majAbandon();
    }
  }

  /** Bouton « Abandonner » de l'écran de jeu : on propose l'abandon aux autres joueurs (seul humain : il est immédiat). */
  function proposerAbandon() {
    if (!resume || resume.statut !== 'encours' || resume.abandon || abandonOccupe) return;
    const autres = (resume.joueurs || []).filter((x) => x && !x.ia && x.uid !== app.joueur.uid).length;
    const suite = 'Elle disparaîtra et ne comptera pas dans les statistiques.';
    const question = autres
      ? `Proposer d’abandonner cette partie ? Elle sera abandonnée si ${autres > 1 ? 'tous les autres joueurs acceptent' : 'l’autre joueur accepte'}. ${suite}`
      : `Abandonner cette partie ? ${suite}`;
    if (confirm(question)) void voterAbandon(true);
  }

  /** Le bandeau de l'écran de jeu : la proposition en cours, et de quoi y répondre. */
  function majAbandon() {
    const a = resume?.statut === 'encours' && resume.monSiege >= 0 ? resume.abandon : null;
    bandeauAbandon.hidden = !a;
    if (!a) {
      bandeauAbandon.replaceChildren();
      return;
    }
    const noms = (liste) => enumerer(liste.map((x) => (x.uid === app.joueur.uid ? 'toi' : x.pseudo)));
    const bouton = (texte, accepte, classe, action) => h('button', { type: 'button', class: 'bouton ' + classe, disabled: abandonOccupe, 'data-action': action, onclick: () => voterAbandon(accepte) }, texte);
    if (a.jAiAccepte) {
      remplacer(
        bandeauAbandon,
        h('span', {}, h('b', {}, 'Abandon proposé. '), a.attendus.length ? `On attend la réponse de ${noms(a.attendus)}.` : ''),
        h('div', { class: 'actions' }, bouton('Retirer ma proposition', false, '', 'abandon-retirer')),
      );
    } else {
      const proposent = a.pour.length > 1 ? `${noms(a.pour)} proposent` : `${noms(a.pour)} propose`;
      remplacer(
        bandeauAbandon,
        h('span', {}, h('b', {}, `${proposent} d’abandonner la partie. `), 'Abandonnée, elle disparaît et ne compte pas dans les statistiques.'),
        h('div', { class: 'actions' }, bouton('Refuser', false, '', 'abandon-refuser'), bouton('Accepter', true, 'principal', 'abandon-accepter')),
      );
    }
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

  /**
   * Choix d'une couleur dans la palette, pour les pions de la place `si` (la mienne, une IA, un autre joueur) : le
   * plateau la prend aussitôt, sans attendre la salle, et la palette reste utilisable (on peut en essayer plusieurs
   * de suite). La mienne est retenue sur l'appareil pour les parties suivantes.
   */
  async function changerCouleur(si, id) {
    const aMoi = resume?.joueurs?.[si]?.uid === app.joueur.uid;
    if (aMoi) {
      retenirCouleur(id);
      couleurTentee = true;
    }
    const voulue = { siege: si, id };
    couleurVoulue = voulue;
    couleurEnvoyee = false;
    erreurAttente = '';
    dessinerAttente();
    try {
      // Sa propre couleur se choisit sans nommer de siège (comme avant : toutes les versions du serveur l'acceptent).
      await (aMoi ? api.choisirCouleur(resume.id, id) : api.choisirCouleur(resume.id, id, si));
      if (couleurVoulue === voulue) {
        // Déjà confirmée par la salle ? Sinon, la prochaine mise à jour reçue fait foi.
        if (resume?.joueurs?.[si]?.couleur === id) couleurVoulue = null;
        else couleurEnvoyee = true;
      }
    } catch (e) {
      if (couleurVoulue === voulue) couleurVoulue = null;
      erreurAttente = messageErreur(e);
    } finally {
      if (!fermee && resume?.statut === 'attente') dessinerAttente();
    }
  }

  /**
   * Une place touchée sur l'aperçu du plateau : libre, on s'y assoit (ou on y vient) ; occupée, la palette règle
   * désormais la couleur de ses pions.
   */
  function toucherPlace(si) {
    const p = resume;
    if (!p || p.statut !== 'attente' || fermee) return;
    if (p.joueurs?.[si]) {
      siegeCouleur = si;
      dessinerAttente();
    } else if (!occupe) agir(() => api.choisirSiege(p.id, si));
  }

  function dessinerAttente() {
    const p = resume;
    const moi = app.joueur.uid;
    const places = p.joueurs || [];
    const monSiege = places.findIndex((x) => x && x.uid === moi);
    const assis = monSiege >= 0;
    const n = p.nbJoueurs === 3 || places.length === 3 ? 3 : 4;
    const libres = Array.from({ length: n }, (_, si) => si).filter((si) => !places[si]);
    const complet = libres.length === 0;
    const vue = assis ? monSiege : 0;
    // Couleur de chaque place : celle qu'on lui a choisie, sinon une couleur libre (la même chez tous). La couleur
    // que je viens de toucher compte déjà pour sa place.
    const voulue = couleurVoulue && places[couleurVoulue.siege] ? couleurVoulue : null;
    const couleurs = couleursPartie(voulue ? places.map((x, si) => (si === voulue.siege ? { ...x, couleur: voulue.id } : x)) : places, n);
    const prises = assis ? couleursIndisponibles(places, monSiege) : [];
    // Les places occupées, dans le sens du jeu à partir de celle du bas ; et celle dont la palette règle la couleur :
    // la dernière touchée si elle est encore occupée, sinon la mienne, sinon la première.
    const occupees = Array.from({ length: n }, (_, c) => (vue + c) % n).filter((si) => places[si]);
    if (siegeCouleur !== null && (!places[siegeCouleur] || siegeCouleur === monSiege)) siegeCouleur = null;
    const cible = siegeCouleur ?? (assis ? monSiege : occupees[0] ?? -1);
    const nomPlace = (si) => (si === monSiege ? 'Toi' : places[si]?.pseudo || (places[si]?.ia ? 'IA' : '?'));
    const titreCouleur = cible < 0 ? '' : cible === monSiege ? 'Couleur de tes pions' : `Couleur des pions ${deNom(nomPlace(cible), !!places[cible].ia)}`;
    // À peine assis, le joueur reçoit la couleur qu'il a choisie la dernière fois (ou en créant la partie), si elle
    // est libre. Un seul essai par salle : si les règles du serveur la refusent, on garde la couleur d'office.
    const preferee = couleurPreferee();
    if (assis && !places[monSiege].couleur && preferee && !couleurTentee && !prises.includes(preferee) && typeof api.choisirCouleur === 'function') {
      couleurTentee = true;
      api.choisirCouleur(p.id, preferee).catch(() => {});
    }
    const modifiable = typeof api.modifierSalle === 'function';
    const majuscule = (t) => t.charAt(0).toUpperCase() + t.slice(1);

    // ── La table : l'aperçu du plateau, puis une ligne par place (on s'assoit, on place ou on retire des IA). ──
    const siege = (si) => {
      const place = places[si];
      // Ce qu'est cette place pour moi (partenaire, adversaire ; à 3 : son rang de jeu), et où elle est sur le plateau.
      const role = rolePlace(n, si, monSiege);
      const ou = cotePlace(n, si, vue);
      const actions = [];
      if (!place) {
        // Ouvert à tous : qui n'est pas encore dans la partie y entre en s'asseyant, invité ou non.
        actions.push(h('button', { type: 'button', class: 'bouton petit' + (!assis ? ' principal' : ''), disabled: occupe, 'data-action': 'asseoir', onclick: () => agir(() => api.choisirSiege(p.id, si)) }, assis ? 'Venir ici' : 'M’asseoir'));
        // L'IA arrive au dernier niveau choisi ; il se change d'un toucher sur sa place.
        actions.push(h('button', { type: 'button', class: 'bouton petit', disabled: occupe, 'data-action': 'ajouter-ia', onclick: () => agir(() => api.ajouterIA(p.id, si, niveauEnLigne())) }, piPlus(14), 'IA'));
      } else if (place.ia) {
        actions.push(
          h('button', { type: 'button', class: 'bouton petit', disabled: occupe, 'data-action': 'niveau-ia', 'aria-label': `Niveau de ${place.pseudo} : ${nomNiveau(place.niveau)}`, onclick: () => choisirNiveauIA(p, si, place) }, nomNiveau(place.niveau), ' ▾'),
          h('button', { type: 'button', class: 'bouton petit danger', disabled: occupe, 'data-action': 'retirer-ia', onclick: () => agir(() => api.retirerIA(p.id, si)) }, 'Retirer'),
        );
      }
      const nom = place ? (place.uid === moi ? `${place.pseudo} (toi)` : place.pseudo || (place.ia ? 'IA' : '?')) : 'Place libre';
      const note = majuscule([role, si === monSiege && !role ? 'en bas du plateau' : ou].filter(Boolean).join(' · '));
      return h(
        'div',
        { class: 'siege' + (place ? '' : ' libre') + (si === monSiege ? ' moi' : ''), 'data-siege': si, style: { '--c': couleurSiege(si) } },
        place ? avatar({ uid: place.uid, nom: place.pseudo, ia: place.ia, fond: couleurSiege(si) }) : h('div', { class: 'avatar vide', 'aria-hidden': 'true' }, '?'),
        h('div', { class: 'texte-siege' }, h('div', { class: 'nom-siege' }, nom), h('div', { class: 'note' }, note)),
        actions.length ? h('div', { class: 'actions-siege' }, actions) : null,
      );
    };
    // L'aperçu du plateau : celui de la partie, vu de ma place (en bas), aux couleurs des joueurs.
    apercuPlateau ||= new Plateau({ surSiege: toucherPlace });
    const gestes = [complet ? '' : `un + pour ${assis ? 'changer de place' : 't’asseoir'}`, occupees.length > 1 ? 'des pions pour choisir leur couleur' : ''].filter(Boolean);
    const aide = gestes.length ? `Touche ${gestes.join(', ')}.` : '';
    const carteTable = h(
      'div',
      { class: 'carte carte-table' },
      h('div', { class: 'titre-carte' }, h('b', {}, 'La table'), h('span', { class: 'note', 'data-etat': complet ? 'complete' : 'incomplete' }, complet ? 'Tout le monde est là' : `${pluriel(libres.length, 'place libre', 'places libres')} : un joueur ou une IA`)),
      h('div', { class: 'apercu-plateau', 'data-mode': String(n), 'data-vue': String(vue) }, apercuPlateau.el),
      aide ? h('p', { class: 'note aide-apercu' }, aide) : null,
      // La couleur des pions : les siens, ceux d'une IA ou d'un autre joueur (on choisit la place en la touchant sur
      // le plateau, ou ici). Une couleur choisie pour une autre place est prise.
      cible >= 0 && typeof api.choisirCouleur === 'function'
        ? h(
            'div',
            { class: 'carte-couleur', 'data-place': cible },
            h(
              'div',
              { class: 'titre-couleur' },
              h('b', {}, titreCouleur),
              h('span', { class: 'note' }, nomCouleurPartie(couleurs, cible)),
            ),
            occupees.length > 1
              ? h(
                  'div',
                  { class: 'choix-place', role: 'radiogroup', 'aria-label': 'Les pions de qui ?' },
                  occupees.map((si) =>
                    h(
                      'button',
                      {
                        type: 'button',
                        role: 'radio',
                        class: 'puce-place' + (si === cible ? ' choisie' : ''),
                        'aria-checked': String(si === cible),
                        'data-place': si,
                        style: { '--c': couleurSiege(si), '--c-fonce': couleurFonceeSiege(si) },
                        onclick: () => {
                          siegeCouleur = si;
                          dessinerAttente();
                        },
                      },
                      h('span', { class: 'bille', 'aria-hidden': 'true' }),
                      h('span', { class: 'nom' }, nomPlace(si)),
                    ),
                  ),
                )
              : null,
            choixCouleur({
              actuelle: couleurs[cible],
              indisponibles: couleursIndisponibles(places, cible),
              libelle: titreCouleur,
              surChoix: (id) => changerCouleur(cible, id),
            }),
          )
        : null,
      // Les places, dans le sens du jeu à partir de celle du bas du plateau.
      h(
        'div',
        { class: 'places-table', 'aria-label': 'Places autour de la table' },
        Array.from({ length: n }, (_, c) => siege((vue + c) % n)),
      ),
    );

    // ── Les réglages de la partie : chacun peut les changer jusqu'au lancement. ──
    const cinq = cinqVoulu ?? !!p.reglages?.cinqAdverse;
    const reglerCinq = (v) => {
      cinqVoulu = v;
      cinqEnvoye = false;
      agir(async () => {
        try {
          await api.reglerCinqAdverse(p.id, v);
          // Déjà confirmé par la salle ? Sinon, la prochaine mise à jour reçue fait foi.
          if (!!resume?.reglages?.cinqAdverse === v) cinqVoulu = null;
          else cinqEnvoye = true;
        } catch (e) {
          cinqVoulu = null;
          throw e;
        }
      });
    };
    const carteReglages = h(
      'div',
      { class: 'carte carte-reglages-salle', 'data-cinq-adverse': String(cinq), 'data-mode': String(n) },
      h('div', { class: 'titre-carte' }, h('b', {}, 'La partie'), h('span', { class: 'note' }, 'Chacun peut changer ces réglages jusqu’au lancement.')),
      modifiable
        ? h(
            'div',
            { class: 'reglage' },
            h('div', { class: 'texte' }, h('div', { class: 'titre' }, 'Nom'), h('div', { class: 'note nom-salle' }, p.nom || 'Partie de Toc')),
            h('button', { type: 'button', class: 'bouton', disabled: occupe, 'data-action': 'renommer', onclick: () => renommer(p) }, piCrayon(16), 'Renommer'),
          )
        : null,
      modifiable
        ? h(
            'div',
            { class: 'reglage reglage-mode' },
            h('div', { class: 'texte' }, h('div', { class: 'titre' }, 'Mode de jeu'), h('div', { class: 'note' }, n === 3 ? 'Chacun pour soi, sur un plateau en triangle.' : 'Deux équipes, partenaires face à face.')),
            segments(
              [
                { valeur: 4, nom: '2 contre 2' },
                { valeur: 3, nom: '3 joueurs' },
              ],
              n,
              (v) => v !== n && agir(() => api.modifierSalle(p.id, { nbJoueurs: v })),
            ),
          )
        : null,
      interrupteur({
        titre: 'Règle du « 5 adverse »',
        texte: cinq ? 'Activée : le 5 peut aussi faire avancer un pion adverse de 5 cases.' : 'Désactivée : le 5 ne fait avancer que tes pions.',
        actif: cinq,
        desactive: occupe,
        surChange: reglerCinq,
      }),
    );

    const blocs = [enteteRetour(p.nom || 'Salle d’attente', '#/parties'), carteTable, carteReglages, carteInviter(p, libres.length)];
    // Quitter la table (si l'on y est) ; supprimer la salle : n'importe quel joueur, tant que la partie n'est pas lancée.
    const autres = places.filter((x) => x && !x.ia && x.uid !== moi).length;
    blocs.push(
      h(
        'div',
        { class: 'actions sorties-salle' },
        assis
          ? h(
              'button',
              {
                type: 'button',
                class: 'bouton discret danger',
                'data-action': 'quitter',
                disabled: occupe,
                onclick: () => {
                  if (!confirm(autres ? 'Quitter cette table ?' : 'Quitter cette table ? Tu es le dernier joueur : la salle d’attente sera supprimée.')) return;
                  agir(async () => {
                    await api.quitterPartie(p.id);
                    app.naviguer('#/parties');
                  });
                },
              },
              'Quitter la table',
            )
          : null,
        h(
          'button',
          {
            type: 'button',
            class: 'bouton discret danger',
            'data-action': 'supprimer',
            disabled: occupe,
            onclick: () => {
              if (!confirm(autres ? `Supprimer cette salle d’attente ? ${pluriel(autres, 'joueur déjà assis en sortira', 'joueurs déjà assis en sortiront')}.` : 'Supprimer cette salle d’attente ?')) return;
              agir(async () => {
                await api.supprimerPartie(p.id);
                app.naviguer('#/parties');
              });
            },
          },
          'Supprimer la salle',
        ),
      ),
    );
    // En bas, toujours sous la main : l'erreur éventuelle, et le lancement (par tout joueur assis à la table).
    const manque = pluriel(libres.length, 'place');
    blocs.push(
      h(
        'div',
        { class: 'barre-salle' },
        erreurAttente ? h('div', { class: 'apercu erreur', role: 'alert' }, erreurAttente) : null,
        assis
          ? h(
              'button',
              { type: 'button', class: 'bouton principal large', disabled: !complet || occupe, 'data-action': 'lancer', onclick: () => agir(() => api.lancerPartie(p.id)) },
              complet ? 'Lancer la partie' : `Lancer la partie (encore ${manque} à remplir)`,
            )
          : h('div', { class: 'apercu' }, h('span', {}, complet ? 'La table est complète.' : 'Assieds-toi à une place libre pour jouer.')),
      ),
    );
    const salle = h('div', { class: 'contenu salle-attente' + (salleVue ? ' deja-vue' : '') }, blocs);
    salleVue = true;
    appliquerCouleurs(salle, couleurs);
    // La page garde sa place quand la salle se redessine (une mise à jour arrive, ou une action vient d'être faite).
    const defilement = window.scrollY;
    remplacer(racine, salle);
    // Une fois dans la page (les noms se mesurent pour se centrer) : le plateau de la salle, vu de ma place.
    const titres = Array.from({ length: n }, (_, si) => rolePlace(n, si, monSiege)).map((t) => t.charAt(0).toLowerCase() + t.slice(1));
    apercuPlateau.apercu({
      nbJoueurs: n,
      siegeVue: vue,
      siegeLocal: monSiege,
      places: Array.from({ length: n }, (_, si) => (places[si] ? { ...places[si], icone: places[si].ia ? null : iconeConnue(places[si].uid) } : null)),
      couleurs,
      sousTitres: titres,
      // La place dont la palette règle la couleur (entourée, dès qu'il y a le choix).
      choisi: occupees.length > 1 ? cible : -1,
      // Tout se touche : une place libre pour s'y asseoir (pas pendant une action), une place occupée pour sa couleur.
      touchables: Array.from({ length: n }, (_, si) => si)
        .filter((si) => (places[si] ? si !== cible : !occupe))
        .map((si) => ({
          siege: si,
          libelle: places[si] ? `${nomPlace(si)}, ${cotePlace(n, si, vue)} : choisir la couleur de ses pions` : `Place libre ${cotePlace(n, si, vue)} : ${assis ? 'venir ici' : 'm’asseoir ici'}`,
        })),
    });
    if (defilement) window.scrollTo(0, defilement);
  }

  /** Feuille pour renommer la partie. */
  function renommer(p) {
    const champ = h('input', { value: p.nom || '', maxlength: 40, autocomplete: 'off', 'aria-label': 'Nom de la partie' });
    const feuille = ouvrirFeuille([
      h('h3', {}, 'Nom de la partie'),
      h(
        'form',
        {
          class: 'formulaire',
          onsubmit: (e) => {
            e.preventDefault();
            const nom = champ.value.trim();
            feuille.fermer();
            if (nom && nom !== p.nom) agir(() => api.modifierSalle(p.id, { nom }));
          },
        },
        h('label', { class: 'champ' }, 'Nom', champ),
        h(
          'div',
          { class: 'actions' },
          h('button', { type: 'button', class: 'bouton large', onclick: () => feuille.fermer() }, 'Annuler'),
          h('button', { type: 'submit', class: 'bouton principal large', 'data-action': 'enregistrer-nom' }, 'Enregistrer'),
        ),
      ),
    ]);
    champ.focus();
    champ.select();
  }

  /** Feuille de choix du niveau d'une IA déjà assise (avant le lancement). */
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

  /** Inviter : le lien et le code, pour n'importe qui ; puis les joueurs de l'appli, tant qu'il reste des places. */
  function carteInviter(p, nbLibres) {
    const invites = p.invites || [];
    const assis = new Set((p.joueurs || []).filter(Boolean).map((x) => x.uid));
    const carte = h(
      'div',
      { class: 'carte formulaire carte-inviter' },
      h('div', { class: 'titre-carte' }, h('b', {}, 'Inviter'), h('span', { class: 'note' }, 'Envoie le lien, donne le code, ou invite un joueur de l’appli.')),
      h(
        'div',
        { class: 'partage-salle' },
        h('div', { class: 'code-invitation', 'aria-label': `Code d’invitation ${p.code.split('').join(' ')}` }, h('span', { class: 'note' }, 'Code'), h('span', { class: 'code' }, p.code)),
        boutonLien(p),
      ),
    );
    if (!nbLibres) return carte;
    const peutInviter = invites.length < nbLibres;
    if (invites.length) carte.append(h('span', { class: 'note' }, `Invité${invites.length > 1 ? 's' : ''} : ${invites.map((i) => i.pseudo).join(', ')}. L’invitation est dans « Mes parties ».`));
    const refus = (p.refus || []).filter((r) => !invites.some((i) => i.uid === r.uid));
    if (refus.length) carte.append(h('span', { class: 'note ecart-neg' }, `${refus.map((r) => r.pseudo).join(', ')} a refusé.`));
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

  function boutonLien(p) {
    // Dans l'appli Android, la page n'a pas d'adresse à donner : le lien mène à la version web.
    const adresse = android ? android.adresseWeb() : location.origin + location.pathname;
    const lien = `${adresse}${app.demo ? '?demo' : ''}#/rejoindre/${p.code}`;
    const message = `Viens jouer au Toc avec moi ! Touche ce lien : ${lien} (code ${p.code})`;
    const bouton = h(
      'button',
      {
        type: 'button',
        class: 'bouton large',
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
    return bouton;
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
