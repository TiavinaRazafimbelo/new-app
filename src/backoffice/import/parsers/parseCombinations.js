/**
 * parseCombinations.js
 * src/backoffice/import/parsers/parseCombinations.js
 * ─────────────────────────────────────────────────────────────
 * Parse le CSV 2 (combinaisons / déclinaisons) et valide les données.
 *
 * FORMAT CSV 2 :
 *   reference,specificité,karazany,stock_initial,prix_vente_ttc
 *
 * COLONNES :
 *   reference      - référence du produit parent (doit exister après CSV 1)
 *   specificité    - nom du groupe d'attributs (ex: "taille", "couleur")
 *                    vide = produit simple (pas de combinaison)
 *   karazany       - valeur de l'attribut (ex: "ngoza", "kely", "mainty", "fotsy")
 *                    vide = produit simple
 *   stock_initial  - quantité en stock (entier ≥ 0)
 *   prix_vente_ttc - prix TTC de la combinaison (décimal, virgule ou point)
 *                    vide = hérite du prix produit parent
 *
 * DEUX CAS :
 *   1. Ligne SIMPLE  : specificité ET karazany vides
 *      → Initialise juste le stock du produit (id_product_attribute = 0)
 *   2. Ligne COMBO   : specificité ET karazany renseignées
 *      → Crée un groupe d'attributs + une valeur + une combinaison
 *
 * TRADUCTION "karazany" (malgache → français) :
 *   ngoza  = Grande taille
 *   kely   = Petite taille
 *   mainty = Noir
 *   fotsy  = Blanc
 *
 * VALIDATION :
 *   - Colonnes obligatoires présentes
 *   - reference non vide
 *   - stock_initial entier ≥ 0
 *   - prix_vente_ttc positif si renseigné
 *   - specificité + karazany : les deux renseignés ou les deux vides
 *
 * RETOUR :
 *   {
 *     ok: boolean,
 *     lignes: CombinaisonLigne[],   ← données normalisées
 *     avertissements: Avert[],       ← warnings non-bloquants
 *     errors: string[],              ← erreurs bloquantes (ok=false)
 *   }
 * ─────────────────────────────────────────────────────────────
 */

// ─── Constantes ───────────────────────────────────────────────

/** Colonnes attendues dans le CSV 2 */
const COLONNES_ATTENDUES = [
  'reference',
  'specificité',
  'karazany',
  'stock_initial',
  'prix_vente_ttc',
];

/**
 * Traduction des valeurs d'attributs malgaches → labels PrestaShop.
 * Utilisé comme fallback si la valeur n'a pas de traduction connue
 * (dans ce cas on capitalise juste la valeur brute).
 */
export const TRADUCTION_KARAZANY = {
  ngoza:  'Grande taille',
  kely:   'Petite taille',
  mainty: 'Noir',
  fotsy:  'Blanc',
};

/**
 * Traduction des noms de groupes d'attributs malgaches → labels PS.
 * "specificité" dans le CSV = nom du groupe.
 */
export const TRADUCTION_SPECIFICITE = {
  taille:  'Taille',
  couleur: 'Couleur',
};

// ─── Parser CSV robuste (respecte les guillemets) ─────────────

/**
 * Détecte le séparateur de colonnes d'une ligne CSV.
 * Priorité : | > ; > ,
 *
 * @param {string} ligne
 * @returns {string} séparateur
 */
function detecterSeparateur(ligne) {
  if (ligne.includes('|')) return '|';
  if (ligne.includes(';')) return ';';
  return ',';
}

/**
 * Découpe une ligne CSV en respectant les champs entre guillemets.
 * "12,5" est un seul champ, pas deux.
 *
 * @param {string} ligne
 * @param {string} sep
 * @returns {string[]}
 */
function splitLigneCSV(ligne, sep) {
  const result   = [];
  let   courant  = '';
  let   inQuotes = false;
  let   i        = 0;

  while (i < ligne.length) {
    const ch   = ligne[i];
    const next = ligne[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') {
        // Guillemet échappé ("") → un guillemet littéral
        courant += '"';
        i += 2;
        continue;
      }
      inQuotes = !inQuotes;
      i++;
      continue;
    }

    if (!inQuotes && ch === sep) {
      result.push(courant.trim());
      courant = '';
      i++;
      continue;
    }

    courant += ch;
    i++;
  }

  result.push(courant.trim());
  return result;
}

// ─── Normalisation ────────────────────────────────────────────

/**
 * Convertit un prix CSV en nombre flottant.
 * Accepte : "12,5" → 12.5 / "18.99" → 18.99 / "" → null
 *
 * @param {string} val
 * @returns {number|null}
 */
function normaliserPrix(val) {
  if (!val || val.trim() === '') return null;
  const clean = val.trim().replace(',', '.');
  const n     = parseFloat(clean);
  return isNaN(n) ? null : n;
}

/**
 * Convertit un stock CSV en entier.
 * Accepte : "10" → 10 / "" → 0 / "abc" → null (erreur)
 *
 * @param {string} val
 * @returns {number|null} null = invalide
 */
function normaliserStock(val) {
  if (!val || val.trim() === '') return 0;
  const n = parseInt(val.trim(), 10);
  return isNaN(n) ? null : n;
}

/**
 * Traduit une valeur karazany (malgache) vers son label PS.
 * Si pas de traduction → capitalise la valeur brute.
 *
 * @param {string} karazany
 * @returns {string}
 */
function traduireKarazany(karazany) {
  const key = karazany.toLowerCase().trim();
  return TRADUCTION_KARAZANY[key] || karazany.charAt(0).toUpperCase() + karazany.slice(1);
}

/**
 * Traduit un nom de groupe de spécificité (malgache → PS).
 *
 * @param {string} specificite
 * @returns {string}
 */
function traduireSpecificite(specificite) {
  const key = specificite.toLowerCase().trim();
  return TRADUCTION_SPECIFICITE[key] || specificite.charAt(0).toUpperCase() + specificite.slice(1);
}

// ─── Export principal ─────────────────────────────────────────

/**
 * Parse et valide le contenu brut d'un CSV 2.
 *
 * @param {string} texteCSV - contenu brut du fichier
 * @returns {{
 *   ok:             boolean,
 *   lignes:         CombinaisonLigne[],
 *   avertissements: Array<{ligne:number, ref:string, type:string, message:string}>,
 *   errors:         string[],
 * }}
 */
export function parseCSVCombinations(texteCSV) {
  const erreurs        = [];
  const avertissements = [];
  const lignesValidees = [];

  // ── Découpage en lignes ─────────────────────────────────
  const toutesLignes = texteCSV
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => l.trim() !== '');

  if (toutesLignes.length < 2) {
    erreurs.push('Le fichier CSV est vide ou ne contient que l\'en-tête.');
    return { ok: false, lignes: [], avertissements, errors: erreurs };
  }

  // ── Séparateur et en-têtes ──────────────────────────────
  const sep     = detecterSeparateur(toutesLignes[0]);
  const headers = splitLigneCSV(toutesLignes[0], sep).map((h) => h.trim());

  // Vérification colonnes obligatoires
  const colonnesManquantes = COLONNES_ATTENDUES.filter((c) => !headers.includes(c));
  if (colonnesManquantes.length > 0) {
    erreurs.push(`Colonnes manquantes : ${colonnesManquantes.join(', ')}`);
    return { ok: false, lignes: [], avertissements, errors: erreurs };
  }

  // ── Traitement ligne par ligne ──────────────────────────
  const lignesDonnees = toutesLignes.slice(1);

  for (let idx = 0; idx < lignesDonnees.length; idx++) {
    const numLigne = idx + 2; // ligne humaine (en-tête = 1)
    const ligne    = lignesDonnees[idx];
    const cols     = splitLigneCSV(ligne, sep);

    // Map colonne → valeur
    const raw = {};
    headers.forEach((h, i) => { raw[h] = cols[i] ?? ''; });

    const ref         = raw['reference']?.trim()      || '';
    const specificite = raw['specificité']?.trim()    || '';
    const karazany    = raw['karazany']?.trim()        || '';
    const stockRaw    = raw['stock_initial']?.trim()  || '0';
    const prixRaw     = raw['prix_vente_ttc']?.trim() || '';

    // ── Validation référence ────────────────────────────
    if (!ref) {
      avertissements.push({
        ligne:   numLigne,
        ref:     '—',
        type:    'erreur',
        message: 'Référence vide — ligne ignorée',
      });
      continue;
    }

    // ── Validation cohérence specificité/karazany ───────
    // Les deux renseignés OU les deux vides (= produit simple)
    const aSpecificite = specificite !== '';
    const aKarazany    = karazany    !== '';

    if (aSpecificite !== aKarazany) {
      avertissements.push({
        ligne:   numLigne,
        ref,
        type:    'erreur',
        message: `"specificité" et "karazany" doivent être tous les deux renseignés ou tous les deux vides — ligne ignorée`,
      });
      continue;
    }

    const estSimple = !aSpecificite && !aKarazany;

    // ── Validation stock ────────────────────────────────
    const stock = normaliserStock(stockRaw);
    if (stock === null) {
      avertissements.push({
        ligne:   numLigne,
        ref,
        type:    'erreur',
        message: `stock_initial invalide : "${stockRaw}" — ligne ignorée`,
      });
      continue;
    }
    if (stock < 0) {
      avertissements.push({
        ligne:   numLigne,
        ref,
        type:    'erreur',
        message: `stock_initial négatif (${stock}) — ligne ignorée`,
      });
      continue;
    }

    // ── Validation prix ─────────────────────────────────
    const prix = normaliserPrix(prixRaw);
    if (prixRaw !== '' && prix === null) {
      avertissements.push({
        ligne:   numLigne,
        ref,
        type:    'warning',
        message: `prix_vente_ttc invalide : "${prixRaw}" — sera ignoré (héritage prix produit)`,
      });
    }
    if (prix !== null && prix < 0) {
      avertissements.push({
        ligne:   numLigne,
        ref,
        type:    'erreur',
        message: `prix_vente_ttc négatif (${prix}) — ligne ignorée`,
      });
      continue;
    }

    // ── Ligne validée ───────────────────────────────────
    lignesValidees.push({
      ligneCSV:      numLigne,
      reference:     ref,

      // Mode : 'simple' (initialisation stock) ou 'combo' (déclinaison)
      mode:          estSimple ? 'simple' : 'combo',

      // Attributs (null si produit simple)
      specificite:   estSimple ? null : specificite,
      specificitePS: estSimple ? null : traduireSpecificite(specificite),  // label PS
      karazany:      estSimple ? null : karazany,
      karazanyPS:    estSimple ? null : traduireKarazany(karazany),        // label PS

      // Stock et prix normalisés
      stockInitial:  stock,
      prixTTC:       prix,   // null = hériter du produit parent
    });
  }

  // ── Cohérence globale : vérifier les doublons ────────
  // Une même référence ne peut pas avoir à la fois des lignes 'simple'
  // et des lignes 'combo' (incohérence métier).
  const modesParRef = new Map();
  for (const ligne of lignesValidees) {
    const { reference, mode } = ligne;
    if (!modesParRef.has(reference)) {
      modesParRef.set(reference, new Set());
    }
    modesParRef.get(reference).add(mode);
  }

  for (const [ref, modes] of modesParRef) {
    if (modes.has('simple') && modes.has('combo')) {
      avertissements.push({
        ligne:   '—',
        ref,
        type:    'warning',
        message: `"${ref}" a des lignes "simple" ET "combo" — les lignes "simple" seront ignorées au profit des "combo"`,
      });
    }
  }

  return {
    ok:             erreurs.length === 0 && lignesValidees.length > 0,
    lignes:         lignesValidees,
    avertissements,
    errors:         erreurs,
  };
}
