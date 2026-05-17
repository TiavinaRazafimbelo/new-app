/**
 * parseOrders.js
 * src/backoffice/import/parsers/parseOrders.js
 * ─────────────────────────────────────────────────────────────
 * Parse et valide le CSV 3 (commandes).
 *
 * Format attendu du CSV :
 *   date,nom,email,pwd,adresse,achat,etat
 *
 * Colonne "achat" : liste de tuples JSON-like
 *   [("REF";QTE;"VARIANTE"), ...]
 *   Exemple : [("T_01";3;"ngoza"),("C_03";1;"")]
 *
 * Colonne "etat" : libre (ex: "paiement accepté") ou vide
 *
 * Retourne un objet ParseResult :
 * {
 *   ok:              boolean,
 *   errors:          string[],        // erreurs bloquantes (colonnes manquantes, etc.)
 *   commandes:       CommandeRow[],   // lignes valides prêtes à l'import
 *   avertissements:  WarningRow[],    // lignes avec problèmes non bloquants
 * }
 *
 * CommandeRow :
 * {
 *   ligneCSV:    number,
 *   date:        string,          // format ISO YYYY-MM-DD
 *   dateRaw:     string,          // format original DD/MM/YYYY
 *   nom:         string,
 *   email:       string,
 *   pwd:         string,
 *   adresse:     string,
 *   articles:    ArticleRow[],
 *   etat:        string,          // '' | 'paiement accepté' | autre
 *   etatPS:      number,          // ID d'état PS (voir mapEtatToPS)
 * }
 *
 * ArticleRow :
 * {
 *   reference:  string,
 *   quantite:   number,
 *   variante:   string,   // '' si produit simple
 * }
 * ─────────────────────────────────────────────────────────────
 */

// ─── Configuration état commande ─────────────────────────────

/**
 * Mapping texte CSV → ID état PrestaShop.
 *
 * Les IDs correspondent aux états par défaut de PS 8 :
 *   1 = En attente de virement
 *   2 = Paiement accepté
 *   3 = En cours de préparation
 *   4 = Expédié
 *   5 = Livré
 *   6 = Annulé
 *   7 = Remboursé
 *
 * On compare en minuscules normalisés (sans accents).
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

/** État par défaut si la colonne "etat" est vide ou non reconnu */
const ETAT_DEFAUT_PS = 2; // Paiement accepté

// ─── Utilitaires ──────────────────────────────────────────────

/**
 * Normalise une chaîne pour la comparaison :
 * minuscules + suppression des accents.
 */
function normaliserEtat(str) {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

/**
 * Convertit une date DD/MM/YYYY en YYYY-MM-DD (format ISO pour PS).
 * Retourne null si le format est invalide.
 *
 * @param {string} dateStr
 * @returns {string|null}
 */
function convertirDate(dateStr) {
  const match = dateStr.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;

  const [, jour, mois, annee] = match;
  const d = new Date(`${annee}-${mois}-${jour}T00:00:00`);

  // Vérifier que la date est réelle (ex: 31/02 serait invalide)
  if (
    isNaN(d.getTime()) ||
    d.getDate()     !== parseInt(jour,  10) ||
    d.getMonth() + 1 !== parseInt(mois,  10) ||
    d.getFullYear()  !== parseInt(annee, 10)
  ) {
    return null;
  }

  return `${annee}-${mois}-${jour}`;
}

/**
 * Valide le format email (RFC simplifié).
 *
 * @param {string} email
 * @returns {boolean}
 */
function validerEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

/**
 * Parse la colonne "achat" du CSV.
 *
 * Format : [("REF";QTE;"VARIANTE"), ...]
 * Les guillemets doubles sont encodés en "" dans le CSV.
 *
 * Exemples :
 *   [("T_01";3;"ngoza")]
 *   [("T_01";2;"kely"),("C_03";1;"")]
 *
 * @param {string} rawAchat  - valeur brute de la colonne achat
 * @returns {{ articles: ArticleRow[], erreurs: string[] }}
 */
function parseAchat(rawAchat) {
  const articles = [];
  const erreurs  = [];

  if (!rawAchat || !rawAchat.trim()) {
    erreurs.push('Colonne "achat" vide');
    return { articles, erreurs };
  }

  // Nettoyer les guillemets doubles encodés CSV → guillemets simples pour parsing
  // Le CSV encode les " internes comme "" (RFC 4180)
  const achatNorm = rawAchat.trim().replace(/""/g, '"');

  // Extraire chaque tuple de la forme ("REF";QTE;"VARIANTE")
  // Pattern : parenthèses contenant 3 champs séparés par ";"
  const tuplePattern = /\("([^"]+)"\s*;\s*(\d+)\s*;\s*"([^"]*)"\)/g;
  let match;

  while ((match = tuplePattern.exec(achatNorm)) !== null) {
    const [, reference, qteStr, variante] = match;
    const quantite = parseInt(qteStr, 10);

    if (!reference.trim()) {
      erreurs.push(`Référence vide dans un tuple`);
      continue;
    }

    if (isNaN(quantite) || quantite <= 0) {
      erreurs.push(`Quantité invalide pour "${reference}" : "${qteStr}"`);
      continue;
    }

    articles.push({
      reference: reference.trim(),
      quantite,
      variante:  variante.trim(),
    });
  }

  if (articles.length === 0 && erreurs.length === 0) {
    erreurs.push(`Format "achat" non reconnu : "${rawAchat.slice(0, 60)}"`);
  }

  return { articles, erreurs };
}

/**
 * Parse une ligne CSV en tenant compte des champs entre guillemets
 * contenant des virgules ou des guillemets doublés (RFC 4180).
 *
 * @param {string} ligne
 * @returns {string[]}
 */
function parseLigneCSV(ligne) {
  const champs = [];
  let   courant = '';
  let   inQuote = false;

  for (let i = 0; i < ligne.length; i++) {
    const c = ligne[i];

    if (inQuote) {
      if (c === '"') {
        // Guillemet fermant ou guillemet doublé
        if (ligne[i + 1] === '"') {
          courant += '"';
          i++; // sauter le second guillemet
        } else {
          inQuote = false;
        }
      } else {
        courant += c;
      }
    } else {
      if (c === '"') {
        inQuote = true;
      } else if (c === ',') {
        champs.push(courant);
        courant = '';
      } else {
        courant += c;
      }
    }
  }

  champs.push(courant); // dernier champ
  return champs;
}

// ─── Colonnes attendues ───────────────────────────────────────

const COLONNES_REQUISES = ['date', 'nom', 'email', 'pwd', 'adresse', 'achat', 'etat'];

// ─── Fonction principale ──────────────────────────────────────

/**
 * Parse le contenu texte du CSV 3 et retourne un ParseResult.
 *
 * @param {string} contenuCSV - contenu brut du fichier CSV (UTF-8)
 * @returns {ParseResult}
 */
export function parseCSVCommandes(contenuCSV) {
  const result = {
    ok:             false,
    errors:         [],
    commandes:      [],
    avertissements: [],
  };

  // ── 1. Découpage en lignes ─────────────────────────────────
  const lignes = contenuCSV
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lignes.length < 2) {
    result.errors.push('Le fichier CSV est vide ou ne contient pas de données.');
    return result;
  }

  // ── 2. Vérification de l'en-tête ──────────────────────────
  const entete = parseLigneCSV(lignes[0]).map((c) => c.trim().toLowerCase());

  // Vérifier que toutes les colonnes requises sont présentes
  const colonnesManquantes = COLONNES_REQUISES.filter(
    (col) => !entete.includes(col)
  );

  if (colonnesManquantes.length > 0) {
    result.errors.push(
      `Colonnes manquantes dans l'en-tête : ${colonnesManquantes.join(', ')}`
    );
    return result;
  }

  // Vérifier les colonnes inconnues (avertissement non bloquant)
  const colonnesInconnues = entete.filter(
    (col) => !COLONNES_REQUISES.includes(col)
  );
  if (colonnesInconnues.length > 0) {
    result.avertissements.push({
      ligne:   'En-tête',
      ref:     '',
      message: `Colonne(s) inconnue(s) ignorée(s) : ${colonnesInconnues.join(', ')}`,
      type:    'warning',
    });
  }

  // Index des colonnes pour accès rapide
  const idx = Object.fromEntries(entete.map((c, i) => [c, i]));

  // ── 3. Parsing ligne par ligne ─────────────────────────────
  for (let i = 1; i < lignes.length; i++) {
    const numLigne = i + 1; // numéro humain (en-tête = ligne 1)
    const champs   = parseLigneCSV(lignes[i]);

    // Vérifier le nombre de colonnes
    if (champs.length < COLONNES_REQUISES.length) {
      result.avertissements.push({
        ligne:   numLigne,
        ref:     champs[idx.email] || '',
        message: `Ligne incomplète (${champs.length} champs attendus, ${COLONNES_REQUISES.length} minimum) — ignorée`,
        type:    'erreur',
      });
      continue;
    }

    // Extraction des champs bruts
    const dateRaw  = (champs[idx.date]    || '').trim();
    const nom      = (champs[idx.nom]     || '').trim();
    const email    = (champs[idx.email]   || '').trim();
    const pwd      = (champs[idx.pwd]     || '').trim();
    const adresse  = (champs[idx.adresse] || '').trim();
    const achatRaw = (champs[idx.achat]   || '').trim();
    const etatRaw  = (champs[idx.etat]    || '').trim();

    let ligneValide = true;

    // ─ Validation date ──────────────────────────────────────
    const dateISO = convertirDate(dateRaw);
    if (!dateISO) {
      result.avertissements.push({
        ligne:   numLigne,
        ref:     email,
        message: `Date invalide : "${dateRaw}" — format attendu DD/MM/YYYY`,
        type:    'erreur',
      });
      ligneValide = false;
    }

    // ─ Validation nom ────────────────────────────────────────
    if (!nom) {
      result.avertissements.push({
        ligne: numLigne, ref: email,
        message: 'Nom client vide',
        type:  'erreur',
      });
      ligneValide = false;
    }

    // ─ Validation email ──────────────────────────────────────
    if (!email || !validerEmail(email)) {
      result.avertissements.push({
        ligne:   numLigne,
        ref:     email || '—',
        message: `Email invalide : "${email}"`,
        type:    'erreur',
      });
      ligneValide = false;
    }

    // ─ Validation mot de passe ───────────────────────────────
    if (!pwd) {
      result.avertissements.push({
        ligne: numLigne, ref: email,
        message: 'Mot de passe vide',
        type:  'erreur',
      });
      ligneValide = false;
    }

    // ─ Validation adresse ────────────────────────────────────
    if (!adresse) {
      result.avertissements.push({
        ligne: numLigne, ref: email,
        message: 'Adresse vide',
        type:  'erreur',
      });
      ligneValide = false;
    }

    // ─ Parsing colonne achat ─────────────────────────────────
    const { articles, erreurs: erreursAchat } = parseAchat(achatRaw);

    if (erreursAchat.length > 0) {
      erreursAchat.forEach((msg) =>
        result.avertissements.push({
          ligne: numLigne, ref: email, message: msg, type: 'erreur',
        })
      );
      ligneValide = false;
    }

    // ─ Résolution état PrestaShop ────────────────────────────
    const etatNorm   = normaliserEtat(etatRaw);
    const etatPS     = ETAT_MAPPING[etatNorm] ?? ETAT_DEFAUT_PS;

    // Avertissement si l'état n'est pas reconnu mais n'est pas vide
    if (etatRaw && !(etatNorm in ETAT_MAPPING)) {
      result.avertissements.push({
        ligne:   numLigne,
        ref:     email,
        message: `État "${etatRaw}" non reconnu — état par défaut appliqué (id=${ETAT_DEFAUT_PS})`,
        type:    'warning',
      });
    }

    // ─ Ajout si ligne valide ─────────────────────────────────
    if (!ligneValide) continue;

    result.commandes.push({
      ligneCSV: numLigne,
      date:     dateISO,
      dateRaw,
      nom,
      email,
      pwd,
      adresse,
      articles,
      etat:   etatRaw,
      etatPS,
    });
  }

  // ── 4. Résultat global ─────────────────────────────────────
  result.ok = result.errors.length === 0 && result.commandes.length > 0;

  return result;
}
