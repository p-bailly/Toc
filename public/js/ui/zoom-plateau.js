// Zoom du plateau, pour mieux voir : on écarte deux doigts (ou Ctrl + molette), on touche deux fois un endroit libre
// du plateau, ou on se sert du bouton loupe. Agrandi, le plateau se déplace d'un doigt. Les touchers des pions et des
// cases passent comme d'habitude ; seul un vrai geste (pincement, déplacement) n'est pas pris pour un toucher.
//
// Le plateau (`cible`) est agrandi par une transformation CSS dans sa zone (`zone`), qui le rogne : rien d'autre à
// l'écran ne bouge. État : { k, x, y } = échelle (1 = entier) et décalage en pixels du coin haut gauche.

export const ZOOM_MAX = 3;
/** Échelle prise au double toucher et au bouton loupe. */
export const ZOOM_DOUBLE = 2;

/** L'état borné : échelle entre 1 et `max`, et le plateau couvre toujours toute sa zone (pas de vide sur les bords). */
export function bornerZoom({ k, x, y }, largeur, hauteur, max = ZOOM_MAX) {
  const e = Math.min(max, Math.max(1, k));
  const borne = (v, taille) => Math.min(0, Math.max(taille * (1 - e), v));
  return { k: e, x: borne(x, largeur), y: borne(y, hauteur) };
}

/** Passe à l'échelle `k` en gardant sous le doigt le point (px, py) de la zone. */
export function zoomerVers(etat, k, px, py) {
  const r = k / etat.k;
  return { k, x: px - (px - etat.x) * r, y: py - (py - etat.y) * r };
}

/**
 * Branche le zoom sur une zone et son contenu. `surChange(k)` à chaque changement d'échelle.
 * @returns {{ echelle: () => number, basculer: () => void, reinitialiser: () => void }}
 */
export function activerZoom(zone, cible, { max = ZOOM_MAX, surChange } = {}) {
  let etat = { k: 1, x: 0, y: 0 };
  const pointeurs = new Map();
  let pince = null; // { d0, etat0, mx, my, bouge } : deux doigts posés
  let glisse = null; // { p0, etat0, actif } : un doigt déplace le plateau agrandi
  let dernierToucher = null;
  let sansClicJusqua = 0;

  const local = (e) => {
    const r = zone.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  const poser = (voulu, anime = false) => {
    const r = zone.getBoundingClientRect();
    const avant = etat.k;
    etat = bornerZoom(voulu, r.width, r.height, max);
    cible.style.transformOrigin = '0 0';
    cible.style.transition = anime ? 'transform 0.22s ease-out' : 'none';
    cible.style.transform = etat.k === 1 ? '' : `translate(${etat.x.toFixed(1)}px, ${etat.y.toFixed(1)}px) scale(${etat.k.toFixed(3)})`;
    zone.toggleAttribute('data-zoom', etat.k > 1);
    if (etat.k !== avant) surChange?.(etat.k);
  };
  const ecart = () => {
    const [a, b] = [...pointeurs.values()];
    return { d: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, mx: (a[0] + b[0]) / 2, my: (a[1] + b[1]) / 2 };
  };

  zone.addEventListener('pointerdown', (e) => {
    pointeurs.set(e.pointerId, local(e));
    if (pointeurs.size === 2) {
      const { d, mx, my } = ecart();
      pince = { d0: d, etat0: etat, mx, my, bouge: false };
      glisse = null;
    } else if (pointeurs.size === 1 && etat.k > 1) {
      glisse = { p0: local(e), etat0: etat, actif: false };
    }
  });
  zone.addEventListener('pointermove', (e) => {
    if (!pointeurs.has(e.pointerId)) return;
    pointeurs.set(e.pointerId, local(e));
    if (pince && pointeurs.size >= 2) {
      const { d, mx, my } = ecart();
      const k = Math.min(max, Math.max(1, (pince.etat0.k * d) / pince.d0));
      const vise = zoomerVers(pince.etat0, k, pince.mx, pince.my);
      poser({ k, x: vise.x + mx - pince.mx, y: vise.y + my - pince.my });
      pince.bouge = true;
      e.preventDefault();
    } else if (glisse) {
      const [x, y] = local(e);
      const dx = x - glisse.p0[0];
      const dy = y - glisse.p0[1];
      if (!glisse.actif && Math.hypot(dx, dy) < 8) return;
      glisse.actif = true;
      poser({ k: glisse.etat0.k, x: glisse.etat0.x + dx, y: glisse.etat0.y + dy });
      e.preventDefault();
    }
  });
  const fin = (e) => {
    if (!pointeurs.delete(e.pointerId)) return;
    if (pince) {
      if (pince.bouge) sansClicJusqua = Date.now() + 80;
      pince = null;
      glisse = null;
    } else if (glisse && pointeurs.size === 0) {
      if (glisse.actif) sansClicJusqua = Date.now() + 80;
      glisse = null;
    }
  };
  zone.addEventListener('pointerup', fin);
  zone.addEventListener('pointercancel', fin);
  // Un geste n'est pas un toucher : le clic qui suit le relâchement est ignoré.
  zone.addEventListener(
    'click',
    (e) => {
      if (Date.now() < sansClicJusqua) {
        e.stopPropagation();
        e.preventDefault();
      }
    },
    true,
  );
  // Double toucher d'un endroit libre (ni pion, ni case proposée, ni bouton) : agrandit là, ou revient au plateau entier.
  zone.addEventListener('click', (e) => {
    if (e.target.closest?.('[data-action], button')) {
      dernierToucher = null;
      return;
    }
    const [x, y] = local(e);
    const t = Date.now();
    if (dernierToucher && t - dernierToucher.t < 320 && Math.hypot(x - dernierToucher.x, y - dernierToucher.y) < 30) {
      dernierToucher = null;
      poser(etat.k > 1 ? { k: 1, x: 0, y: 0 } : zoomerVers(etat, ZOOM_DOUBLE, x, y), true);
    } else {
      dernierToucher = { t, x, y };
    }
  });
  // Ordinateur : Ctrl + molette (c'est aussi ce qu'envoie un pincement sur un pavé tactile).
  zone.addEventListener(
    'wheel',
    (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const [x, y] = local(e);
      const k = Math.min(max, Math.max(1, etat.k * Math.exp(-e.deltaY / 200)));
      poser(zoomerVers(etat, k, x, y));
    },
    { passive: false },
  );

  return {
    echelle: () => etat.k,
    /** Bouton loupe : agrandit sur le milieu du plateau, ou revient au plateau entier. */
    basculer() {
      const r = zone.getBoundingClientRect();
      poser(etat.k > 1 ? { k: 1, x: 0, y: 0 } : zoomerVers(etat, ZOOM_DOUBLE, r.width / 2, r.height / 2), true);
    },
    reinitialiser: () => poser({ k: 1, x: 0, y: 0 }, true),
  };
}
