// Couche réseau FACTICE, en mémoire, pour tester et montrer les écrans en ligne sans Firebase.
// Chargée à la place de reseau/api.js uniquement quand l'URL contient « ?demo » (voir app.js). Même contrat que
// reseau/api.js : comptes par simple nom d'utilisateur, parties, invitations, salle d'attente, sessions de jeu.
//
// De faux joueurs (Camille, Malo, Léna…) existent déjà : ils acceptent les invitations, rejoignent, lancent
// leurs parties et jouent (avec l'IA) quand c'est leur tour. L'état est gardé dans sessionStorage (onglet courant)
// pour survivre à un rechargement. « &rapide » dans l'URL accélère tout (tests automatisés).

import { nouvellePartie, donnerCarte, jouerCoup, coupsLegauxMain, donneurDon, nombreJoueurs } from '../moteur/index.js';
import { choisirCoup, choisirDon } from '../ia/ia.js';
import { choisirCoup3, choisirDon3 } from '../ia/ia3.js';

const CLE = 'toc.demo3';
let vitesse = 1;

/** Multiplie tous les délais des faux joueurs (0.1 : dix fois plus vite). */
export function reglerVitesse(f) {
  vitesse = Math.max(0.01, f);
}
const delai = (ms) => Math.max(15, ms * vitesse);

// ─── Données ────────────────────────────────────────────────────────────────

const FAUX = [
  { uid: 'f-camille', pseudo: 'Camille', icone: 'renard' },
  { uid: 'f-malo', pseudo: 'Malo', icone: 'ours' },
  { uid: 'f-lena', pseudo: 'Léna', icone: 'tournesol' },
  { uid: 'f-jules', pseudo: 'Jules', icone: 'voilier' },
  { uid: 'f-ines', pseudo: 'Inès', icone: 'hibou' },
  { uid: 'f-robert', pseudo: 'Robert', icone: null },
];

function etatNeuf() {
  const comptes = {};
  for (const f of FAUX) comptes[f.uid] = { ...f, visible: true, verrouille: false, stats: { jouees: 3, gagnees: 1 }, faux: true };
  return { comptes, moi: null, parties: {}, seq: 1, initialises: {} };
}

let db = charger();

function charger() {
  try {
    const brut = sessionStorage.getItem(CLE);
    if (brut) return JSON.parse(brut);
  } catch {
    /* rien */
  }
  return etatNeuf();
}

function sauver() {
  try {
    sessionStorage.setItem(CLE, JSON.stringify(db));
  } catch {
    /* plein */
  }
}

// ─── Écoutes ────────────────────────────────────────────────────────────────

const ecoutesAuth = new Set();
const ecoutesListe = new Set();
const ecoutesInvitations = new Set();
const ecoutesSalles = new Set();
const ecoutesPartie = new Map(); // id → Set<cb>
const sessions = new Set();

function changer() {
  sauver();
  // Différé : comme Firestore, les rappels arrivent après la fin de l'action.
  queueMicrotask(diffuser);
  planifier();
}

function diffuser() {
  const j = joueurCourant();
  for (const cb of ecoutesAuth) cb(j);
  for (const cb of ecoutesListe) cb(mesParties());
  for (const cb of ecoutesInvitations) cb(mesInvitations());
  for (const cb of ecoutesSalles) cb(sallesAttente());
  for (const [id, cbs] of ecoutesPartie) for (const cb of cbs) cb(resumeDe(db.parties[id]));
  for (const s of sessions) s.notifier();
}

const copie = (x) => JSON.parse(JSON.stringify(x));

function joueurCourant() {
  const c = db.comptes[db.moi];
  return c ? { uid: c.uid, pseudo: c.pseudo, icone: c.icone || null, visible: c.visible, verrouille: c.verrouille, stats: { ...c.stats } } : null;
}

function exigerConnexion() {
  if (!db.moi || !db.comptes[db.moi]) throw new Error('Tu n’es pas connecté.');
  return db.comptes[db.moi];
}

function exigerPartie(id) {
  const p = db.parties[id];
  if (!p) throw new Error('Cette partie n’existe plus.');
  return p;
}

const attendre = (ms = 120) => new Promise((r) => setTimeout(r, Math.max(5, ms * Math.min(1, vitesse * 4))));

// ─── Résumés ────────────────────────────────────────────────────────────────

function siegeDe(p, uid) {
  return p.joueurs.findIndex((j) => j && j.uid === uid);
}

function aMoiDeJouer(p, siege) {
  if (p.statut !== 'encours' || siege < 0 || !p.partie) return false;
  const e = p.partie.etat;
  if (e.phase === 'echange') return !e.echanges[siege];
  return e.phase === 'jeu' && e.tour === siege;
}

function resumeDe(p) {
  if (!p) return null;
  const monSiege = db.moi ? siegeDe(p, db.moi) : -1;
  return {
    id: p.id,
    nom: p.nom,
    code: p.code,
    statut: p.statut,
    hote: p.hote,
    reglages: { ...p.reglages },
    nbJoueurs: p.joueurs.length,
    joueurs: p.joueurs.map((j) => (j ? { uid: j.uid, pseudo: j.pseudo, ia: !!j.ia, ...(j.ia && j.niveau ? { niveau: j.niveau } : {}) } : null)),
    invites: (p.invites || []).map((i) => ({ ...i })),
    refus: (p.refus || []).map((i) => ({ ...i })),
    monSiege,
    aMoiDeJouer: aMoiDeJouer(p, monSiege),
    gagnant: p.gagnant ?? null,
    majLe: new Date(p.majLe),
  };
}

function mesParties() {
  if (!db.moi) return [];
  return Object.values(db.parties)
    .filter((p) => siegeDe(p, db.moi) >= 0)
    .sort((a, b) => b.majLe - a.majLe)
    .map(resumeDe);
}

function mesInvitations() {
  if (!db.moi) return [];
  return Object.values(db.parties)
    .filter((p) => p.statut === 'attente' && (p.invites || []).some((i) => i.uid === db.moi) && siegeDe(p, db.moi) < 0)
    .sort((a, b) => b.majLe - a.majLe)
    .map(resumeDe);
}

/** Toutes les salles d'attente ouvertes (les miennes comprises), de la plus récente à la plus ancienne. */
function sallesAttente() {
  if (!db.moi) return [];
  return Object.values(db.parties)
    .filter((p) => p.statut === 'attente')
    .sort((a, b) => b.majLe - a.majLe)
    .map(resumeDe);
}

// ─── Contrat ────────────────────────────────────────────────────────────────

export function reseauDisponible() {
  return true;
}

export function surAuth(cb) {
  ecoutesAuth.add(cb);
  cb(joueurCourant());
  planifier();
  return () => ecoutesAuth.delete(cb);
}

const identifiant = (nom) =>
  nom
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/** Connexion par simple nom d'utilisateur ; crée le compte la première fois. → Joueur */
export async function connecter(pseudo) {
  await attendre();
  const nom = String(pseudo || '').trim().slice(0, 20);
  const id = identifiant(nom);
  if (!id) throw new Error('Ton prénom doit compter au moins une lettre ou un chiffre.');
  const faux = FAUX.find((f) => identifiant(f.pseudo) === id);
  const uid = faux ? faux.uid : 'u-' + id;
  if (!db.comptes[uid]) db.comptes[uid] = { uid, pseudo: nom, icone: null, visible: true, verrouille: false, stats: { jouees: 0, gagnees: 0 } };
  db.moi = uid;
  if (!db.initialises[uid]) {
    db.initialises[uid] = true;
    peupler(uid);
  }
  changer();
  return joueurCourant();
}

export async function deconnecter() {
  db.moi = null;
  changer();
}

export async function modifierProfil({ pseudo, icone, visible } = {}) {
  await attendre();
  const c = exigerConnexion();
  if (pseudo !== undefined) {
    if (c.verrouille) throw new Error('Ton prénom a été fixé par l’administrateur : il ne peut pas être changé.');
    const p = String(pseudo).trim().slice(0, 20);
    if (!p) throw new Error('Le prénom ne peut pas être vide.');
    c.pseudo = p;
    for (const partie of Object.values(db.parties)) {
      if (partie.statut !== 'attente') continue;
      for (const j of partie.joueurs) if (j && j.uid === c.uid) j.pseudo = p;
    }
  }
  if (icone !== undefined) c.icone = icone || null;
  if (visible !== undefined) c.visible = !!visible;
  changer();
  return joueurCourant();
}

/** Historique des parties contre l'IA gardé par le compte (voir reseau/api.js) : fusion avec celui de l'appareil. */
export async function synchroniserPartiesIA({ parties = [], retirees = [] } = {}) {
  await attendre(60);
  const c = exigerConnexion();
  const retire = [...new Set([...(c.retireesIA || []), ...retirees])];
  const parId = new Map();
  for (const p of [...(c.partiesIA || []), ...parties]) if (p?.id && !retire.includes(p.id) && !parId.has(p.id)) parId.set(p.id, copie(p));
  c.partiesIA = [...parId.values()].sort((a, b) => b.date - a.date).slice(0, 300);
  c.retireesIA = retire;
  sauver();
  return { parties: copie(c.partiesIA), retirees: retire.slice() };
}

export async function lireJoueur(uid) {
  await attendre(60);
  const c = db.comptes[uid];
  return c ? { uid: c.uid, pseudo: c.pseudo, icone: c.icone || null } : null;
}

export async function listerJoueurs() {
  await attendre();
  const recents = new Map();
  for (const p of Object.values(db.parties)) {
    if (siegeDe(p, db.moi) < 0) continue;
    for (const j of p.joueurs) if (j && j.uid && !j.ia) recents.set(j.uid, Math.max(recents.get(j.uid) || 0, p.majLe));
  }
  return Object.values(db.comptes)
    .filter((c) => c.uid !== db.moi && c.visible)
    .sort((a, b) => (recents.get(b.uid) || 0) - (recents.get(a.uid) || 0))
    .map((c) => ({ uid: c.uid, pseudo: c.pseudo, icone: c.icone || null }));
}

export function surMesParties(cb) {
  ecoutesListe.add(cb);
  cb(mesParties());
  return () => ecoutesListe.delete(cb);
}

export function surInvitations(cb) {
  ecoutesInvitations.add(cb);
  cb(mesInvitations());
  return () => ecoutesInvitations.delete(cb);
}

export function surSallesAttente(cb) {
  ecoutesSalles.add(cb);
  cb(sallesAttente());
  return () => ecoutesSalles.delete(cb);
}

export function surPartie(id, cb) {
  if (!ecoutesPartie.has(id)) ecoutesPartie.set(id, new Set());
  ecoutesPartie.get(id).add(cb);
  cb(resumeDe(db.parties[id]));
  return () => ecoutesPartie.get(id)?.delete(cb);
}

function nouveauCode() {
  const lettres = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 6 }, () => lettres[Math.floor(Math.random() * lettres.length)]).join('');
  } while (Object.values(db.parties).some((p) => p.code === code));
  return code;
}

function placeDe(uid) {
  const c = db.comptes[uid];
  return { uid, pseudo: c.pseudo, ia: false };
}

function creer({ nom, cinqAdverse, hote, code, nbJoueurs = 4 }) {
  const n = nbJoueurs === 3 ? 3 : 4;
  // Comme dans la vraie couche réseau, l'identifiant d'une partie est son code d'invitation.
  const id = code || nouveauCode();
  db.seq++;
  const p = {
    id,
    nom: nom || `Partie de ${db.comptes[hote].pseudo}`,
    code: id,
    statut: 'attente',
    hote,
    reglages: n === 3 ? { cinqAdverse: !!cinqAdverse, nbJoueurs: 3 } : { cinqAdverse: !!cinqAdverse },
    joueurs: [placeDe(hote), ...Array(n - 1).fill(null)],
    invites: [],
    partie: null,
    gagnant: null,
    majLe: Date.now(),
  };
  db.parties[id] = p;
  return p;
}

export async function creerPartie({ nom, cinqAdverse, nbJoueurs } = {}) {
  await attendre();
  const c = exigerConnexion();
  const p = creer({ nom: String(nom || '').trim().slice(0, 40), cinqAdverse, hote: c.uid, nbJoueurs });
  changer();
  return { id: p.id, code: p.code };
}

function asseoir(p, uid) {
  if (siegeDe(p, uid) >= 0) return;
  const libre = p.joueurs.findIndex((j) => !j);
  if (libre < 0) throw new Error('Cette partie est complète.');
  p.joueurs[libre] = placeDe(uid);
  p.invites = (p.invites || []).filter((i) => i.uid !== uid);
  p.majLe = Date.now();
}

export async function rejoindrePartie(code) {
  await attendre();
  const c = exigerConnexion();
  const cle = String(code || '').trim().toUpperCase();
  const p = Object.values(db.parties).find((x) => x.code === cle);
  if (!p) throw new Error(`Aucune partie ne porte le code ${cle}.`);
  if (siegeDe(p, c.uid) >= 0) return { id: p.id };
  if (p.statut !== 'attente') throw new Error('Cette partie a déjà commencé.');
  asseoir(p, c.uid);
  reactionHote(p);
  changer();
  return { id: p.id };
}

export async function choisirSiege(id, siege) {
  await attendre();
  const c = exigerConnexion();
  const p = exigerPartie(id);
  if (p.statut !== 'attente') throw new Error('La partie a déjà commencé.');
  const actuel = siegeDe(p, c.uid);
  if (actuel === siege) return;
  if (p.joueurs[siege]) throw new Error('Cette place est déjà prise.');
  if (actuel >= 0) {
    p.joueurs[siege] = p.joueurs[actuel];
    p.joueurs[actuel] = null;
  } else {
    // Pas encore dans la partie : on y entre, invité ou non.
    p.joueurs[siege] = placeDe(c.uid);
    p.invites = (p.invites || []).filter((i) => i.uid !== c.uid);
    reactionHote(p);
  }
  p.majLe = Date.now();
  changer();
}

/** Salle d'attente : active ou désactive le « 5 adverse » (tout joueur connecté). */
export async function reglerCinqAdverse(id, actif) {
  await attendre();
  exigerConnexion();
  const p = exigerPartie(id);
  if (p.statut !== 'attente') throw new Error('La partie a déjà commencé.');
  p.reglages = { ...p.reglages, cinqAdverse: !!actif };
  p.majLe = Date.now();
  changer();
}

/** Supprime une salle d'attente (tout joueur connecté). */
export async function supprimerPartie(id) {
  await attendre();
  exigerConnexion();
  const p = db.parties[id];
  if (!p) return;
  if (p.statut !== 'attente') throw new Error('La partie a commencé : on ne peut plus la supprimer.');
  delete db.parties[id];
  changer();
}

function exigerHote(p) {
  if (p.hote !== db.moi) throw new Error('Seul l’hôte de la partie peut faire cela.');
  if (p.statut !== 'attente') throw new Error('La partie a déjà commencé.');
}

const NIVEAUX_IDS = ['debutant', 'amateur', 'confirme', 'expert', 'champion'];

export async function ajouterIA(id, siege, niveau) {
  await attendre();
  const p = exigerPartie(id);
  exigerHote(p);
  if (p.joueurs[siege]) throw new Error('Cette place est déjà prise.');
  const noms = ['IA Nord', 'IA Est', 'IA Sud', 'IA Ouest'];
  p.joueurs[siege] = { uid: null, pseudo: noms[siege], ia: true, niveau: NIVEAUX_IDS.includes(niveau) ? niveau : 'champion' };
  p.majLe = Date.now();
  changer();
}

/** Hôte : change le niveau d'une IA assise (partie en attente). */
export async function changerNiveauIA(id, siege, niveau) {
  await attendre();
  const p = exigerPartie(id);
  exigerHote(p);
  if (!p.joueurs[siege]?.ia) throw new Error('Il n’y a pas d’IA à cette place.');
  if (!NIVEAUX_IDS.includes(niveau)) throw new Error('Niveau inconnu.');
  p.joueurs[siege].niveau = niveau;
  p.majLe = Date.now();
  changer();
}

export async function retirerIA(id, siege) {
  await attendre();
  const p = exigerPartie(id);
  exigerHote(p);
  if (!p.joueurs[siege]?.ia) throw new Error('Il n’y a pas d’IA à cette place.');
  p.joueurs[siege] = null;
  p.majLe = Date.now();
  changer();
}

export async function quitterPartie(id) {
  await attendre();
  const c = exigerConnexion();
  const p = exigerPartie(id);
  if (p.statut !== 'attente') throw new Error('On ne peut quitter qu’une partie en attente.');
  if (p.hote === c.uid) delete db.parties[id];
  else {
    const s = siegeDe(p, c.uid);
    if (s >= 0) p.joueurs[s] = null;
    p.majLe = Date.now();
  }
  changer();
}

/** Garde, pour l'analyse de fin de partie, les mains distribuées et les cartes échangées de chaque donne. */
function suivreDonnes(p) {
  if (!p.partie) return;
  const e = p.partie.etat;
  p.donnes = p.donnes || [];
  if (!p.donnes[e.donne] && e.phase === 'echange') p.donnes[e.donne] = { mains: p.partie.mains.map((m) => m.slice()), dons: [null, null, null, null] };
  if (p.donnes[e.donne] && e.phase !== 'fini') p.donnes[e.donne].dons = p.partie.dons.slice();
}

function lancer(p) {
  p.partie = nouvellePartie(p.reglages);
  p.donnes = [];
  suivreDonnes(p);
  p.statut = 'encours';
  p.invites = [];
  p.majLe = Date.now();
}

export async function lancerPartie(id) {
  await attendre();
  const p = exigerPartie(id);
  exigerHote(p);
  if (p.joueurs.some((j) => !j)) throw new Error(`Il faut ${p.joueurs.length} joueurs (ou IA) pour lancer la partie.`);
  lancer(p);
  changer();
}

export async function inviter(id, uid) {
  await attendre();
  const p = exigerPartie(id);
  exigerHote(p);
  const c = db.comptes[uid];
  if (!c) throw new Error('Ce joueur n’existe pas.');
  if (siegeDe(p, uid) >= 0) throw new Error(`${c.pseudo} est déjà dans la partie.`);
  const libres = p.joueurs.filter((j) => !j).length;
  p.invites = p.invites || [];
  if (p.invites.some((i) => i.uid === uid)) return;
  if (p.invites.length >= libres) throw new Error('Plus de place libre pour un nouvel invité.');
  p.invites.push({ uid, pseudo: c.pseudo });
  p.majLe = Date.now();
  if (c.faux) reponseFaux(p.id, uid);
  changer();
}

export async function annulerInvitation(id, uid) {
  await attendre();
  const p = exigerPartie(id);
  exigerHote(p);
  p.invites = (p.invites || []).filter((i) => i.uid !== uid);
  changer();
}

export async function accepterInvitation(id) {
  await attendre();
  const c = exigerConnexion();
  const p = exigerPartie(id);
  if (p.statut !== 'attente') throw new Error('Cette partie a déjà commencé.');
  asseoir(p, c.uid);
  reactionHote(p);
  changer();
}

export async function refuserInvitation(id) {
  await attendre();
  const c = exigerConnexion();
  const p = exigerPartie(id);
  p.invites = (p.invites || []).filter((i) => i.uid !== c.uid);
  p.refus = (p.refus || []).concat([{ uid: c.uid, pseudo: c.pseudo }]);
  p.majLe = Date.now();
  changer();
}

// ─── Faux joueurs ───────────────────────────────────────────────────────────

/** Un faux joueur invité répond : Inès refuse (pour montrer le refus), les autres acceptent. */
function reponseFaux(id, uid) {
  setTimeout(() => {
    const p = db.parties[id];
    if (!p || p.statut !== 'attente' || !(p.invites || []).some((i) => i.uid === uid)) return;
    if (uid === 'f-ines') {
      p.invites = p.invites.filter((i) => i.uid !== uid);
      p.refus = (p.refus || []).concat([{ uid, pseudo: db.comptes[uid].pseudo }]);
    }
    else {
      try {
        asseoir(p, uid);
      } catch {
        p.invites = p.invites.filter((i) => i.uid !== uid);
      }
    }
    p.majLe = Date.now();
    changer();
  }, delai(1800));
}

/** Partie d'un faux hôte : quand l'utilisateur la rejoint, l'hôte complète avec une IA et lance. */
function reactionHote(p) {
  const hote = db.comptes[p.hote];
  if (!hote?.faux) return;
  setTimeout(() => {
    const q = db.parties[p.id];
    if (!q || q.statut !== 'attente') return;
    q.joueurs.forEach((j, s) => {
      if (!j) q.joueurs[s] = { uid: null, pseudo: ['IA Nord', 'IA Est', 'IA Sud', 'IA Ouest'][s], ia: true };
    });
    lancer(q);
    changer();
  }, delai(2500));
}

/** Données de départ d'un nouveau compte : une invitation, une partie en cours, une terminée, une partie à code. */
function peupler(uid) {
  const camille = creer({ nom: 'Le Toc du jeudi', cinqAdverse: true, hote: 'f-camille' });
  camille.joueurs[1] = placeDe('f-malo');
  camille.invites = [{ uid, pseudo: db.comptes[uid].pseudo }];
  camille.majLe = Date.now() - 5 * 60e3;

  const enCours = creer({ nom: 'Revanche en famille', hote: uid });
  enCours.joueurs = [placeDe(uid), placeDe('f-jules'), placeDe('f-lena'), { uid: null, pseudo: 'IA Ouest', ia: true }];
  lancer(enCours);
  enCours.majLe = Date.now() - 60 * 60e3;

  const finie = creer({ nom: 'Partie d’essai', hote: 'f-camille' });
  finie.joueurs = [placeDe('f-camille'), placeDe(uid), placeDe('f-malo'), placeDe('f-ines')];
  lancer(finie);
  simulerJusquALaFin(finie);
  finie.majLe = Date.now() - 2 * 86400e3;

  const aTrois = creer({ nom: 'Toc à trois', hote: uid, nbJoueurs: 3 });
  aTrois.joueurs = [placeDe(uid), placeDe('f-malo'), { uid: null, pseudo: 'IA Droite', ia: true }];
  lancer(aTrois);
  aTrois.majLe = Date.now() - 3 * 60e3;

  const aCode = creer({ nom: 'Partie de Jules', hote: 'f-jules', code: 'TOC42A' });
  aCode.joueurs[2] = placeDe('f-ines');
  aCode.majLe = Date.now() - 20 * 60e3;
}

/** Joue une partie entière au hasard (rapide) : sert à fournir une partie terminée. */
function simulerJusquALaFin(p) {
  let partie = p.partie;
  for (let n = 0; n < 5000 && partie.etat.phase !== 'fini'; n++) {
    const e = partie.etat;
    if (e.phase === 'echange') {
      for (let s = 0; s < partie.etat.echanges.length; s++) if (!partie.etat.echanges[s]) partie = donnerCarte(partie, s, partie.mains[s][0]);
      p.partie = partie;
      suivreDonnes(p);
    } else {
      const coups = coupsLegauxMain(e, e.tour, partie.mains[e.tour]);
      partie = jouerCoup(partie, e.tour, coups[Math.floor(Math.random() * coups.length)]);
      p.partie = partie;
      suivreDonnes(p);
    }
  }
  p.partie = partie;
  terminerSiFini(p);
}

function terminerSiFini(p) {
  if (!p.partie || p.partie.etat.phase !== 'fini' || p.statut === 'finie') return;
  p.statut = 'finie';
  p.gagnant = p.partie.etat.gagnant;
  p.joueurs.forEach((j, s) => {
    const c = j && j.uid ? db.comptes[j.uid] : null;
    if (!c) return;
    c.stats.jouees += 1;
    if (p.joueurs.length === 3 ? s === p.gagnant : s % 2 === p.gagnant) c.stats.gagnees += 1;
  });
}

// Moteur des faux joueurs et des IA : une action à la fois, avec un délai, pour toutes les parties en cours.
let minuterie = null;

function planifier() {
  if (minuterie) return;
  const prochaine = trouverAction();
  if (!prochaine) return;
  minuterie = setTimeout(() => {
    minuterie = null;
    const action = trouverAction();
    if (action) {
      try {
        action.faire();
      } catch (e) {
        console.error('Démo : action d’un faux joueur impossible', e);
      }
      changer();
    }
  }, delai(prochaine.ia ? 700 : 1300));
}

function trouverAction() {
  for (const p of Object.values(db.parties)) {
    if (p.statut !== 'encours' || !p.partie) continue;
    const e = p.partie.etat;
    const automatique = (s) => p.joueurs[s] && p.joueurs[s].uid !== db.moi && (p.joueurs[s].ia || db.comptes[p.joueurs[s].uid]?.faux || !db.comptes[p.joueurs[s].uid]);
    if (e.phase === 'echange') {
      const s = e.echanges.findIndex((fait, x) => !fait && automatique(x));
      if (s < 0) continue;
      return {
        ia: !!p.joueurs[s].ia,
        faire: () => {
          const carte = (p.joueurs.length === 3 ? choisirDon3 : choisirDon)(p.partie.etat, s, p.partie.mains[s], { niveau: p.joueurs[s].niveau });
          p.partie = donnerCarte(p.partie, s, carte);
          suivreDonnes(p);
          p.majLe = Date.now();
        },
      };
    }
    if (e.phase === 'jeu' && automatique(e.tour)) {
      const s = e.tour;
      return {
        ia: !!p.joueurs[s].ia,
        faire: () => {
          const n = p.joueurs.length;
          const coup = (n === 3 ? choisirCoup3 : choisirCoup)(p.partie.etat, s, p.partie.mains[s], {
            budgetMs: Math.max(10, 250 * vitesse),
            niveau: p.joueurs[s].niveau,
            carteDonnee: p.partie.dons[s],
            carteRecue: p.partie.dons[donneurDon(p.partie.etat.donne, s, n)],
          });
          p.partie = jouerCoup(p.partie, s, coup);
          suivreDonnes(p);
          p.majLe = Date.now();
          terminerSiFini(p);
        },
      };
    }
  }
  return null;
}

// ─── Session de jeu ─────────────────────────────────────────────────────────

export async function ouvrirSession(id) {
  await attendre();
  const c = exigerConnexion();
  const p = exigerPartie(id);
  if (!p.partie) throw new Error('La partie n’a pas encore commencé.');
  const siege = siegeDe(p, c.uid);
  if (siege < 0) throw new Error('Tu ne fais pas partie de cette partie.');
  const abonnes = new Set();
  let derniere = null;
  const vue = () => {
    const q = db.parties[id];
    const { etat, mains, dons, historique } = q.partie;
    return {
      id,
      enLigne: true,
      statut: q.statut,
      nom: q.nom,
      siege,
      joueurs: q.joueurs.map((j) => ({ pseudo: j.pseudo, ia: !!j.ia, uid: j.uid, ...(j.ia && j.niveau ? { niveau: j.niveau } : {}) })),
      etat: copie(etat),
      main: mains[siege].slice(),
      don: dons[siege],
      recu: etat.phase === 'echange' ? null : dons[donneurDon(etat.donne, siege, nombreJoueurs(etat))],
      historique: copie(historique),
    };
  };
  const session = {
    notifier() {
      const q = db.parties[id];
      if (!q?.partie) return;
      const cle = q.partie.etat.numCoup + '|' + q.partie.etat.phase + '|' + q.partie.mains[siege].join();
      if (cle === derniere) return;
      derniere = cle;
      const v = vue();
      for (const cb of abonnes) cb(v);
    },
    abonner(cb) {
      abonnes.add(cb);
      cb(vue());
      return () => abonnes.delete(cb);
    },
    async donner(carte) {
      await attendre(80);
      const q = exigerPartie(id);
      q.partie = donnerCarte(q.partie, siege, carte);
      suivreDonnes(q);
      q.majLe = Date.now();
      changer();
    },
    async jouer(coup) {
      await attendre(80);
      const q = exigerPartie(id);
      q.partie = jouerCoup(q.partie, siege, coup);
      suivreDonnes(q);
      q.majLe = Date.now();
      terminerSiFini(q);
      changer();
    },
    /** Données pour l'analyse de fin de partie (voir session-locale.js). */
    async donneesAnalyse() {
      const q = exigerPartie(id);
      return {
        reglages: { ...q.reglages },
        joueurs: q.joueurs.map((j) => ({ pseudo: j.pseudo, ia: !!j.ia, uid: j.uid, ...(j.ia && j.niveau ? { niveau: j.niveau } : {}) })),
        siege,
        historique: copie(q.partie.historique),
        donnes: (q.donnes || []).map((d, k) => ({ distribuees: d.mains[siege].slice(), donnee: d.dons[siege], recue: d.dons[donneurDon(k, siege, q.joueurs.length)] })),
      };
    },
    fermer() {
      abonnes.clear();
      sessions.delete(session);
    },
  };
  derniere = null;
  sessions.add(session);
  return session;
}
