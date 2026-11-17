// « Mes parties » (écran d'ouverture, comme dans l'appli Scrabble) : connexion par simple nom d'utilisateur,
// invitations reçues, parties classées (à toi de jouer, en attente, salles d'attente, terminées), nouvelle partie
// d'un toucher, rejoindre avec un code. Les salles d'attente sont ouvertes à tous : on y voit aussi celles des
// autres joueurs. Les statistiques sont dans l'onglet « Stats ». Gère aussi la route #/rejoindre/CODE.

import { h, remplacer, messageErreur, ilYa, lire, ecrire, pluriel } from './dom.js';
import { entete, avatar, interrupteur, segments, toast, choixCouleur } from './composants.js';
import { couleurPreferee, retenirCouleur } from './couleurs.js';
import { surVeille } from './veille.js';
import { demanderPermission, notificationsAutorisees, notificationsRefusees } from './notifications.js';
import { notificationVoulue, lireReglages } from './reglages.js';
import { conseilInstallation } from './installation.js';
import { piPlus } from './pictos.js';
import { emojiIcone } from './icones.js';
import { nomNiveau } from './niveaux.js';

const CLE_CODE = 'toc.codeARejoindre';
const CLE_OPTIONS = 'toc.optionsEnLigne';

export function afficher(racine, app, { page, reste }) {
  const api = app.api;
  if (page === 'rejoindre' && reste[0]) ecrire(CLE_CODE, reste[0].toUpperCase());

  if (!app.enLigne()) {
    remplacer(
      racine,
      h(
        'div',
        { class: 'contenu' },
        entete('Mes parties'),
        h(
          'div',
          { class: 'carte', style: { lineHeight: 1.5 } },
          h('b', {}, 'Le jeu en ligne n’est pas disponible.'),
          h('p', {}, 'Pas de connexion à Internet, ou le service en ligne n’est pas encore configuré. Les parties contre l’IA marchent sans réseau.'),
          h('a', { class: 'bouton principal large', href: '#/ia' }, 'Jouer contre l’IA'),
        ),
      ),
    );
    return null;
  }

  if (!app.joueur) return afficherConnexion(racine, app);

  const code = lire(CLE_CODE, null);
  if (code) return rejoindre(racine, app, code);

  return afficherListe(racine, app);
}

// ─── Connexion ──────────────────────────────────────────────────────────────

function afficherConnexion(racine, app) {
  const code = lire(CLE_CODE, null);
  const champ = h('input', { name: 'pseudo', maxlength: 20, autocomplete: 'given-name', autocapitalize: 'words', autofocus: true, required: true });
  const erreur = h('div', { class: 'apercu erreur', hidden: true });
  const bouton = h('button', { type: 'submit', class: 'bouton principal' }, 'Continuer');
  const formulaire = h(
    'form',
    {
      class: 'carte formulaire',
      onsubmit: async (e) => {
        e.preventDefault();
        const nom = champ.value.trim().slice(0, 20);
        if (!nom) return;
        // Dans le geste de l'utilisateur (les navigateurs l'exigent) : un invité doit pouvoir être prévenu.
        if (notificationVoulue()) void demanderPermission();
        bouton.disabled = true;
        erreur.hidden = true;
        try {
          await app.api.connecter(nom);
          ecrire('toc.sansCompte', false);
          // surAuth réaffiche l'écran (liste, ou partie à rejoindre).
        } catch (err) {
          erreur.textContent = messageErreur(err);
          erreur.hidden = false;
          bouton.disabled = false;
        }
      },
    },
    h('b', {}, code ? `Pour rejoindre la partie ${code}, indique ton prénom` : 'Quel est ton prénom ?'),
    h(
      'span',
      { class: 'note' },
      'Pas de mot de passe : saisis le même prénom sur tous tes appareils pour retrouver tes parties. Si quelqu’un porte déjà ce prénom, ajoute une initiale (« Marie D ») : deux personnes qui saisissent le même prénom arrivent sur le même compte.',
    ),
    h('label', { class: 'champ' }, 'Prénom', champ),
    bouton,
    erreur,
  );
  champ.addEventListener('input', () => (bouton.disabled = !champ.value.trim()));
  bouton.disabled = true;
  remplacer(
    racine,
    h(
      'div',
      { class: 'contenu' },
      entete('Mes parties'),
      formulaire,
      h(
        'button',
        {
          type: 'button',
          class: 'bouton discret',
          onclick: () => {
            ecrire('toc.sansCompte', true);
            ecrire(CLE_CODE, null);
            app.naviguer('#/ia');
          },
        },
        'Jouer contre l’IA sans compte',
      ),
    ),
  );
  return null;
}

// ─── Rejoindre par code ─────────────────────────────────────────────────────

function rejoindre(racine, app, code) {
  ecrire(CLE_CODE, null);
  const message = h('div', { class: 'vide-etat' }, `Connexion à la partie ${code}…`);
  remplacer(racine, h('div', { class: 'contenu' }, entete('Rejoindre'), message, h('a', { class: 'bouton discret', href: '#/parties' }, 'Mes parties')));
  let actif = true;
  void demanderPermission();
  app.api
    .rejoindrePartie(code)
    .then(({ id }) => actif && app.naviguer('#/partie/' + encodeURIComponent(id), true))
    .catch((e) => {
      if (!actif) return;
      message.className = 'apercu erreur';
      message.textContent = messageErreur(e);
    });
  return () => (actif = false);
}

// ─── Liste ──────────────────────────────────────────────────────────────────

function afficherListe(racine, app) {
  const api = app.api;
  const contenu = h('div', { class: 'contenu' });
  remplacer(racine, contenu);
  let veille = { pret: false, parties: [], invitations: [] };
  // Salles d'attente ouvertes (celles des autres joueurs comprises) : on peut s'y asseoir sans invitation.
  let salles = [];
  let occupe = false;
  let erreur = '';
  // « Nom et options » reste ouvert quand la liste se redessine (une partie change en arrière-plan).
  let optionsOuvertes = false;
  const options = { nom: '', cinqAdverse: false, nbJoueurs: 4, ...(lire(CLE_OPTIONS, {}) || {}) };

  const nouvelle = async () => {
    occupe = true;
    erreur = '';
    dessiner();
    void demanderPermission();
    try {
      const nom = options.nom.trim() || `Partie de ${app.joueur.pseudo}`;
      ecrire(CLE_OPTIONS, { cinqAdverse: options.cinqAdverse, nbJoueurs: options.nbJoueurs });
      const { id } = await api.creerPartie({ nom, cinqAdverse: options.cinqAdverse, nbJoueurs: options.nbJoueurs === 3 ? 3 : 4 });
      app.naviguer('#/partie/' + encodeURIComponent(id));
    } catch (e) {
      erreur = messageErreur(e);
      occupe = false;
      dessiner();
    }
  };

  const champCode = h('input', {
    class: 'champ-code',
    maxlength: 8,
    placeholder: 'Code',
    'aria-label': 'Code d’invitation',
    autocapitalize: 'characters',
    autocomplete: 'off',
    spellcheck: 'false',
  });

  const dessiner = () => {
    const j = app.joueur;
    if (!j) return;
    const { parties, invitations, pret } = veille;
    const aMoi = parties.filter((p) => p.aMoiDeJouer && p.statut !== 'finie');
    const enCours = parties.filter((p) => p.statut === 'encours' && !p.aMoiDeJouer);
    // Mes salles d'attente d'abord, puis celles des autres (les invitations reçues sont déjà affichées plus haut).
    const miennes = parties.filter((p) => p.statut === 'attente' && !p.aMoiDeJouer);
    const dejaVues = new Set([...parties, ...invitations].map((p) => p.id));
    const attente = miennes.concat(salles.filter((p) => p.statut === 'attente' && !dejaVues.has(p.id)));
    const finies = parties.filter((p) => p.statut === 'finie').slice(0, 20);

    const emoji = emojiIcone(j.icone);
    const blocs = [
      entete('Mes parties', h('a', { class: 'puce', href: '#/reglages', 'aria-label': 'Mon compte' }, (emoji ? emoji + ' ' : '') + j.pseudo)),
    ];
    const conseil = conseilInstallation(app);
    if (conseil) blocs.push(conseil);

    const details = h(
      'details',
      { class: 'options', open: optionsOuvertes, ontoggle: (e) => (optionsOuvertes = e.target.open) },
      h('summary', {}, `Nom et options${options.nbJoueurs === 3 ? ' · 3 joueurs' : ''}`),
      h(
        'div',
        { class: 'champ' },
        'Mode de jeu',
        segments(
          [
            { valeur: 4, nom: '2 contre 2' },
            { valeur: 3, nom: '3 joueurs' },
          ],
          options.nbJoueurs === 3 ? 3 : 4,
          (v) => {
            options.nbJoueurs = v;
            ecrire(CLE_OPTIONS, { cinqAdverse: options.cinqAdverse, nbJoueurs: v });
            const resume = details.querySelector('summary');
            if (resume) resume.textContent = `Nom et options${v === 3 ? ' · 3 joueurs' : ''}`;
          },
        ),
      ),
      // La couleur est retenue sur l'appareil : la salle d'attente la donne au joueur dès qu'il s'assoit.
      h(
        'div',
        { class: 'champ' },
        'Couleur de tes pions',
        choixCouleur({ actuelle: couleurPreferee() || 'bleu', surChoix: retenirCouleur }),
      ),
      h(
        'label',
        { class: 'champ' },
        'Nom de la partie (facultatif)',
        h('input', {
          value: options.nom,
          maxlength: 40,
          placeholder: `Partie de ${j.pseudo}`,
          oninput: (e) => (options.nom = e.target.value),
        }),
      ),
      interrupteur({
        titre: 'Option « 5 adverse »',
        texte: 'Le 5 peut aussi faire avancer un pion adverse de 5 cases.',
        actif: options.cinqAdverse,
        surChange: (v) => (options.cinqAdverse = v),
      }),
    );
    blocs.push(
      h(
        'div',
        { class: 'actions' },
        h('button', { type: 'button', class: 'bouton principal large', disabled: occupe, onclick: nouvelle, 'data-action': 'nouvelle-partie' }, piPlus(), 'Nouvelle partie'),
      ),
      details,
    );
    if (erreur) blocs.push(h('div', { class: 'apercu erreur' }, erreur));
    const rappel = rappelNotifications(dessiner);
    if (rappel) blocs.push(rappel);

    if (invitations.length) {
      blocs.push(h('h2', {}, 'Invitations reçues'), h('div', { class: 'liste' }, invitations.map((p) => ligneInvitation(p, app))));
    }
    if (!pret) blocs.push(h('div', { class: 'vide-etat' }, 'Chargement…'));
    else if (!parties.length && !invitations.length && !attente.length)
      blocs.push(h('div', { class: 'vide-etat' }, 'Aucune partie. Touche « Nouvelle partie », puis invite tes partenaires et adversaires.'));
    const section = (titre, liste) => liste.length && blocs.push(h('h2', {}, titre), h('div', { class: 'liste' }, liste.map((p) => lignePartie(p, app))));
    section('À toi de jouer', aMoi);
    section('En attente des autres', enCours);
    section('Salles d’attente', attente);
    section('Terminées', finies);

    // Rejoindre avec un code.
    blocs.push(
      h('h2', {}, 'Rejoindre avec un code'),
      h(
        'form',
        {
          class: 'actions',
          onsubmit: (e) => {
            e.preventDefault();
            const c = champCode.value.trim().toUpperCase();
            if (!c) return;
            ecrire(CLE_CODE, c);
            champCode.value = '';
            app.rafraichir();
          },
        },
        champCode,
        h('button', { type: 'submit', class: 'bouton' }, 'Rejoindre'),
      ),
    );

    const focus = document.activeElement === champCode;
    remplacer(contenu, blocs);
    if (focus) champCode.focus();
  };

  // Ne pas redessiner pendant la saisie du nom (le champ perdrait le focus).
  const saisieEnCours = () => contenu.contains(document.activeElement) && document.activeElement.tagName === 'INPUT' && document.activeElement !== champCode;
  const arret = surVeille((v) => {
    veille = v;
    if (!saisieEnCours()) dessiner();
  });
  const arretSalles =
    typeof api.surSallesAttente === 'function'
      ? api.surSallesAttente((liste) => {
          salles = liste || [];
          if (!saisieEnCours()) dessiner();
        })
      : () => {};
  app.surJoueur = () => dessiner();
  app.surInstallation = dessiner;
  return () => {
    arret();
    arretSalles();
    app.surJoueur = null;
    app.surInstallation = null;
  };
}

/** Rappel tant que les notifications sont voulues mais pas encore autorisées par le système. */
function rappelNotifications(redessiner) {
  if (lire('toc.rappelNotifications', false) || notificationsAutorisees() !== false || !lireReglages().notifications) return null;
  if (notificationsRefusees()) return null;
  return h(
    'div',
    { class: 'carte carte-accent' },
    h('b', {}, 'Être prévenu quand c’est ton tour'),
    h('span', { class: 'note' }, 'Autorise les notifications pour recevoir les invitations et savoir quand tes partenaires ont joué.'),
    h(
      'div',
      { class: 'actions' },
      h('button', { type: 'button', class: 'bouton large', onclick: () => (ecrire('toc.rappelNotifications', true), redessiner()) }, 'Masquer'),
      h('button', { type: 'button', class: 'bouton large', onclick: async () => (await demanderPermission(), redessiner()) }, 'Autoriser'),
    ),
  );
}

/** Nom d'une place ; une IA porte son niveau : « IA Est (Expert) ». */
const nomPlace = (p) => (p ? (p.ia ? `${p.pseudo || 'IA'} (${nomNiveau(p.niveau)})` : p.pseudo || '?') : null);

function ligneInvitation(p, app) {
  const hote = p.joueurs?.find((j) => j && j.uid === p.hote);
  const nomHote = hote?.pseudo || 'Un joueur';
  const erreur = h('div', { class: 'apercu erreur', hidden: true });
  const presents = (p.joueurs || []).filter(Boolean).map(nomPlace);
  const repondre = async (action, bouton) => {
    for (const b of el.querySelectorAll('button')) b.disabled = true;
    try {
      await action();
    } catch (e) {
      erreur.textContent = messageErreur(e);
      erreur.hidden = false;
      for (const b of el.querySelectorAll('button')) b.disabled = false;
    }
    void bouton;
  };
  const el = h(
    'div',
    { class: 'ligne choisie invitation', 'data-invitation': p.id },
    h(
      'div',
      { class: 'rangee-invitation' },
      avatar({ uid: p.hote, nom: nomHote, fond: 'var(--accent)' }),
      h(
        'div',
        { class: 'principal' },
        h('div', { class: 'mot' }, `${nomHote} t’invite à jouer`),
        h('div', { class: 'note' }, `${p.nom || 'Partie de Toc'} · ${presents.join(', ')}${p.reglages?.cinqAdverse ? ' · 5 adverse' : ''}`),
      ),
    ),
    h(
      'div',
      { class: 'actions' },
      h('button', { type: 'button', class: 'bouton large', onclick: () => repondre(() => app.api.refuserInvitation(p.id)) }, 'Refuser'),
      h(
        'button',
        {
          type: 'button',
          class: 'bouton principal large',
          'data-action': 'accepter',
          onclick: () =>
            repondre(async () => {
              void demanderPermission();
              await app.api.accepterInvitation(p.id);
              app.naviguer('#/partie/' + encodeURIComponent(p.id));
            }),
        },
        'Accepter',
      ),
    ),
    erreur,
  );
  return el;
}

function lignePartie(p, app) {
  const moi = p.monSiege;
  const places = p.joueurs || [];
  const a3 = (p.nbJoueurs || places.length) === 3;
  const partenaire = moi >= 0 && !a3 ? places[(moi + 2) % 4] : null;
  const adversaires = moi < 0 ? [] : a3 ? [places[(moi + 1) % 3], places[(moi + 2) % 3]] : [places[(moi + 1) % 4], places[(moi + 3) % 4]];
  const libres = places.filter((x) => !x).length;
  let sousTitre = '';
  if (p.statut === 'attente') {
    const invites = p.invites || [];
    // Salle d'un autre joueur : on dit qui s'y trouve déjà.
    const presents = moi < 0 ? places.filter(Boolean).map(nomPlace).join(', ') : '';
    sousTitre = (a3 ? '3 joueurs · ' : '') + (presents ? presents + ' · ' : '') + (libres ? `${pluriel(libres, 'place libre', 'places libres')}` : moi < 0 ? 'Complet' : 'Complet : prêt à lancer');
    if (p.reglages?.cinqAdverse) sousTitre += ' · 5 adverse';
    if (invites.length && moi >= 0) sousTitre += ` · invité${invites.length > 1 ? 's' : ''} : ${invites.map((i) => i.pseudo).join(', ')}`;
  } else {
    const avec = partenaire ? `Avec ${nomPlace(partenaire)}` : '';
    const contre = adversaires.filter(Boolean).map(nomPlace).join(' et ');
    sousTitre = a3 ? `3 joueurs · contre ${contre}` : [avec, contre && `contre ${contre}`].filter(Boolean).join(' · ');
  }
  sousTitre += ' · ' + ilYa(p.majLe);
  let titre = p.nom || 'Partie de Toc';
  let badge = null;
  if (p.statut === 'finie') {
    const gagne = moi >= 0 && (a3 ? p.gagnant === moi : p.gagnant === moi % 2);
    badge = h('span', { class: 'badge ' + (gagne ? 'ok' : 'neutre') }, gagne ? 'Gagnée' : 'Perdue');
  } else if (p.aMoiDeJouer) {
    badge = h('span', { class: 'badge a-toi' }, 'À toi de jouer');
  } else if (p.statut === 'attente') {
    badge = h('span', { class: 'badge neutre' }, moi >= 0 ? 'En attente' : libres ? 'Ouverte' : 'Complète');
  }
  const autres = [partenaire, ...adversaires].filter(Boolean);
  const premier = autres[0] || places.find((x) => x && x.uid !== app.joueur?.uid);
  const ligne = h(
    'a',
    { class: 'ligne' + (p.aMoiDeJouer ? ' choisie' : ''), href: '#/partie/' + encodeURIComponent(p.id), 'data-partie': p.id },
    avatar({ uid: premier?.uid, nom: nomPlace(premier) || '?', ia: premier?.ia, fond: p.aMoiDeJouer ? 'var(--accent)' : 'var(--muted)' }),
    h('div', { class: 'principal' }, h('div', { class: 'mot' }, titre), h('div', { class: 'note' }, sousTitre)),
    badge,
  );
  if (p.statut !== 'finie') return ligne;
  return h(
    'div',
    { class: 'ligne-avec-action' },
    ligne,
    h('a', { class: 'bouton', href: '#/analyse/' + encodeURIComponent(p.id), 'aria-label': `Analyser ${titre}` }, 'Analyser'),
  );
}

export { toast };
