/**
 * parseOrders.js — v2
 * src/backoffice/import/parsers/parseOrders.js
 * ─────────────────────────────────────────────────────────────
 * CORRECTIFS v2 :
 *
 *   FIX #1 — etat vide = panier uniquement (cartOnly) :
 *     Quand la colonne "etat" est vide, on marque cartOnly=true
 *     et etatPS=null. L'importer crée le client + adresse + panier
 *     PS mais NE crée PAS de commande dans ps_orders.
 *
 *   FIX #2 — Plusieurs commandes par client :
 *     Chaque ligne CSV = une commande indépendante.
 *     Pas de déduplication par email au niveau commandes
 *     (un même client peut avoir N commandes = N lignes CSV).
 * ─────────────────────────────────────────────────────────────
 */

const ETAT_MAPPING = {
  'paiement accepte': 2,
  'paiement accepté': 2,
  'en attente':       1,
  'en preparation':   3,
  'en préparation':   3,
  'expedie':          4,
  'expédié':          4,
  'livre':            5,
  'livré':            5,
  'annule':           6,
  'annulé':           6,
  'rembourse':        7,
  'remboursé':        7,
};

function normaliserEtat(str) {
  return str.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

function convertirDate(dateStr) {
  const match = dateStr.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  const [, jour, mois, annee] = match;
  const d = new Date(`${annee}-${mois}-${jour}T00:00:00`);
  if (
    isNaN(d.getTime()) ||
    d.getDate()      !== parseInt(jour,  10) ||
    d.getMonth() + 1 !== parseInt(mois,  10) ||
    d.getFullYear()  !== parseInt(annee, 10)
  ) return null;
  return `${annee}-${mois}-${jour}`;
}

function validerEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

// ─── Remplace UNIQUEMENT la fonction parseAchat dans parseOrders.js ──────────
//
// PROBLÈME :
//   Dans un CSV avec guillemets, les guillemets internes sont doublés :
//     [(""T_01"";3;""ngoza""),(""C_03"";1;"""")]
//   Le regex attendait des guillemets simples ("T_01") mais recevait
//   des guillemets doublés (""), donc il ne matchait qu'un seul tuple
//   au lieu de tous.
//
// CORRECTION :
//   Avant de lancer le regex, on normalise les guillemets doublés
//   en guillemets simples :  ""  →  "
//   Mais uniquement à l'intérieur des tuples, pas les guillemets
//   englobants du champ CSV.
//
//   La façon la plus simple : remplacer "" par " dans toute la chaîne,
//   ce qui transforme :
//     [(""T_01"";3;""ngoza""),(""C_03"";1;"""")]
//   en :
//     [("T_01";3;"ngoza"),("C_03";1;"")]
//   puis le regex existant fonctionne normalement.
// ─────────────────────────────────────────────────────────────────────────────

function parseAchat(rawAchat) {
  const articles = [];
  const erreurs = [];

  if (!rawAchat || !rawAchat.trim()) {
    erreurs.push('Colonne "achat" vide');
    return { articles, erreurs };
  }

  const achatNorm = rawAchat
    .replace(/""/g, '"')
    .trim();

  // FIX IMPORTANT :
  // les quotes autour de la variante deviennent optionnelles
  const regex = /\("([^"]*)";\s*(\d+);\s*"?([^"]*)"?\)/g;

  let match;

  while ((match = regex.exec(achatNorm)) !== null) {
    const reference = match[1].trim();
    const quantite = parseInt(match[2], 10);
    const variante = match[3].trim();

    articles.push({
      reference,
      quantite,
      variante,
    });
  }

  if (articles.length === 0) {
    erreurs.push(`Format achat invalide : ${rawAchat}`);
  }

  console.log('ACHAT RAW =', rawAchat);
console.log('ACHAT NORM =', achatNorm);
console.log('ARTICLES =', articles);

  return { articles, erreurs };
}

function parseLigneCSV(ligne) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < ligne.length; i++) {
    const char = ligne[i];
    const next = ligne[i + 1];

    // Gestion des doubles quotes échappées ""
    if (char === '"' && next === '"') {
      current += '"';
      i++;
      continue;
    }

    // Ouverture / fermeture quote
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    // Virgule séparatrice seulement hors quotes
    if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  result.push(current);

  return result;
}

const COLONNES_REQUISES = ['date', 'nom', 'email', 'pwd', 'adresse', 'achat', 'etat'];

export function parseCSVCommandes(contenuCSV) {
  const result = { ok: false, errors: [], commandes: [], avertissements: [] };

  const lignes = contenuCSV.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);

  if (lignes.length < 2) {
    result.errors.push('Le fichier CSV est vide ou ne contient pas de données.');
    return result;
  }

  const entete = parseLigneCSV(lignes[0]).map((c) => c.trim().toLowerCase());
  const colonnesManquantes = COLONNES_REQUISES.filter((col) => !entete.includes(col));
  if (colonnesManquantes.length > 0) {
    result.errors.push(`Colonnes manquantes : ${colonnesManquantes.join(', ')}`);
    return result;
  }

  const idx = Object.fromEntries(entete.map((c, i) => [c, i]));

  for (let i = 1; i < lignes.length; i++) {
    const numLigne = i + 1;
    const champs   = parseLigneCSV(lignes[i]);

    if (champs.length < COLONNES_REQUISES.length) {
      result.avertissements.push({
        ligne: numLigne, ref: '', type: 'erreur',
        message: `Ligne incomplète (${champs.length} champs) — ignorée`,
      });
      continue;
    }

    const dateRaw  = (champs[idx.date]    || '').trim();
    const nom      = (champs[idx.nom]     || '').trim();
    const email    = (champs[idx.email]   || '').trim();
    const pwd      = (champs[idx.pwd]     || '').trim();
    const adresse  = (champs[idx.adresse] || '').trim();
    const achatRaw = (champs[idx.achat]   || '').trim();
    const etatRaw  = (champs[idx.etat]    || '').trim();

    let ok = true;

    const dateISO = convertirDate(dateRaw);
    if (!dateISO) {
      result.avertissements.push({ ligne: numLigne, ref: email, type: 'erreur',
        message: `Date invalide : "${dateRaw}" — attendu DD/MM/YYYY` });
      ok = false;
    }
    if (!nom) {
      result.avertissements.push({ ligne: numLigne, ref: email, type: 'erreur', message: 'Nom vide' });
      ok = false;
    }
    if (!email || !validerEmail(email)) {
      result.avertissements.push({ ligne: numLigne, ref: email || '—', type: 'erreur',
        message: `Email invalide : "${email}"` });
      ok = false;
    }
    if (!pwd) {
      result.avertissements.push({ ligne: numLigne, ref: email, type: 'erreur', message: 'Mot de passe vide' });
      ok = false;
    }
    if (!adresse) {
      result.avertissements.push({ ligne: numLigne, ref: email, type: 'erreur', message: 'Adresse vide' });
      ok = false;
    }

    const { articles, erreurs: erreursAchat } = parseAchat(achatRaw);
    if (erreursAchat.length > 0) {
      erreursAchat.forEach((msg) =>
        result.avertissements.push({ ligne: numLigne, ref: email, type: 'erreur', message: msg })
      );
      ok = false;
    }

    if (!ok) continue;

    // ── FIX #1 : etat vide → cartOnly, pas de commande ────────
    const etatNorm = normaliserEtat(etatRaw);
    let   etatPS   = null;
    let   cartOnly = false;

    if (etatRaw === '') {
      cartOnly = true;  // créer le panier uniquement
      etatPS   = null;
    } else {
      etatPS = ETAT_MAPPING[etatNorm] ?? 2;
      if (!(etatNorm in ETAT_MAPPING)) {
        result.avertissements.push({ ligne: numLigne, ref: email, type: 'warning',
          message: `État "${etatRaw}" non reconnu → Paiement accepté (id=2) appliqué par défaut` });
      }
    }

    result.commandes.push({
      ligneCSV: numLigne,
      date:  dateISO,
      dateRaw,
      nom,
      email,
      pwd,
      adresse,
      articles,
      etat:     etatRaw,
      etatPS,
      cartOnly, // true = panier uniquement, false = commande complète
    });
  }

  result.ok = result.errors.length === 0 && result.commandes.length > 0;
  return result;
}