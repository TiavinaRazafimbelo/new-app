/**
 * parseProducts.js
 * src/backoffice/import/parsers/parseProducts.js
 * ─────────────────────────────────────────────────────────────
 * Parse, valide et normalise le CSV 1 (produits).
 *
 * CSV 1 attendu :
 *   date_availability_produit,nom,reference,prix_ttc,Taxe,categorie,prix_achat
 *
 * ÉTAPES :
 *   1. Vérification des colonnes requises (bloquant si manquantes)
 *   2. Ligne par ligne : validation + normalisation
 *   3. Vérification des doublons de référence dans le CSV lui-même
 *
 * RÉSULTAT :
 *   {
 *     ok:     boolean,        // false si colonnes invalides
 *     errors: string[],       // erreurs bloquantes (colonnes)
 *     produits: ProduitNorm[] // produits validés et normalisés
 *     avertissements: { ligne, ref, message }[] // warnings non bloquants
 *   }
 *
 * ProduitNorm :
 *   {
 *     ligneCSV:       number,  // numéro de ligne dans le CSV (1-based, hors header)
 *     nom:            string,
 *     reference:      string,
 *     dateDisponible: string,  // format YYYY-MM-DD (converti depuis DD/MM/YYYY)
 *     prixTTC:        number,
 *     tauxTVA:        number,  // ex: 11.65 (float, pas string)
 *     categorie:      string,
 *     prixAchat:      number,  // prix d'achat (wholesale_price)
 *   }
 * ─────────────────────────────────────────────────────────────
 */

// Colonnes exactes attendues dans le CSV 1
// (insensible à la casse et aux espaces en bordure)
const COLONNES_REQUISES = [
  'date_availability_produit',
  'nom',
  'reference',
  'prix_ttc',
  'taxe',         // "Taxe" → normalisé en minuscule pour la comparaison
  'categorie',
  'prix_achat',
];

// ─── Utilitaires de parsing ───────────────────────────────────

/**
 * Parse un fichier CSV texte en tableau de lignes.
 * Gère les champs entre guillemets contenant des virgules.
 *
 * @param {string} texte - contenu brut du fichier CSV
 * @returns {{ headers: string[], rows: string[][] }}
 */
function parseCSVTexte(texte) {
  // Normaliser les fins de ligne
  const lignes = texte.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

  // Filtrer les lignes vides
  const lignesNonVides = lignes.filter((l) => l.trim() !== '');

  if (lignesNonVides.length === 0) {
    return { headers: [], rows: [] };
  }

  const headers = parseCSVLigne(lignesNonVides[0]);
  const rows    = lignesNonVides.slice(1).map(parseCSVLigne);

  return { headers, rows };
}

/**
 * Parse une ligne CSV en respectant les guillemets.
 * Gère "12,5" (nombre avec virgule entre guillemets).
 *
 * @param {string} ligne
 * @returns {string[]}
 */
function parseCSVLigne(ligne) {
  const champs = [];
  let i        = 0;
  let champ    = '';
  let dansGuillemets = false;

  while (i < ligne.length) {
    const c = ligne[i];

    if (c === '"') {
      if (dansGuillemets && ligne[i + 1] === '"') {
        // Guillemet échappé ("")
        champ += '"';
        i += 2;
      } else {
        dansGuillemets = !dansGuillemets;
        i++;
      }
    } else if (c === ',' && !dansGuillemets) {
      champs.push(champ.trim());
      champ = '';
      i++;
    } else {
      champ += c;
      i++;
    }
  }

  champs.push(champ.trim());
  return champs;
}

/**
 * Normalise un nombre depuis le CSV :
 * "12,5" → 12.5, "8,5" → 8.5, "18.99" → 18.99
 *
 * @param {string} valeur
 * @returns {number|null} null si invalide
 */
function parseNombre(valeur) {
  if (!valeur || valeur.trim() === '') return null;
  const normalise = valeur.trim().replace(',', '.');
  const n = parseFloat(normalise);
  return isNaN(n) ? null : n;
}

/**
 * Valide et convertit une date DD/MM/YYYY en YYYY-MM-DD.
 *
 * @param {string} valeur - ex: "01/12/2025"
 * @returns {{ ok: true, iso: string } | { ok: false, erreur: string }}
 */
function parseDate(valeur) {
  if (!valeur || valeur.trim() === '') {
    return { ok: false, erreur: 'Date vide' };
  }

  const match = valeur.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) {
    return {
      ok:     false,
      erreur: `Format de date invalide : "${valeur}" (attendu DD/MM/YYYY)`,
    };
  }

  const [, jour, mois, annee] = match;
  const d = new Date(`${annee}-${mois}-${jour}`);

  // Vérifier que la date est réelle (ex: 31/02/2025 serait invalide)
  if (isNaN(d.getTime())) {
    return { ok: false, erreur: `Date invalide : "${valeur}"` };
  }

  return { ok: true, iso: `${annee}-${mois}-${jour}` };
}

/**
 * Normalise un taux TVA depuis le CSV.
 * "11,65%" → 11.65, "5.60%" → 5.60
 *
 * @param {string} valeur
 * @returns {number|null}
 */
function parseTaux(valeur) {
  if (!valeur || valeur.trim() === '') return null;
  const normalise = valeur.trim().replace('%', '').replace(',', '.').trim();
  const n = parseFloat(normalise);
  return isNaN(n) ? null : n;
}

// ─── Fonction principale d'export ─────────────────────────────

/**
 * Parse et valide le contenu texte du CSV 1 (produits).
 *
 * @param {string} texteCSV - contenu brut du fichier uploadé
 * @returns {{
 *   ok:              boolean,
 *   errors:          string[],
 *   produits:        ProduitNorm[],
 *   avertissements:  { ligne: number, ref: string, message: string }[],
 * }}
 */
export function parseCSVProduits(texteCSV) {
  const resultat = {
    ok:             true,
    errors:         [],
    produits:       [],
    avertissements: [],
  };

  // ── ÉTAPE 1 : Parser le texte CSV ────────────────────────────
  const { headers, rows } = parseCSVTexte(texteCSV);

  if (headers.length === 0) {
    resultat.ok = false;
    resultat.errors.push('Le fichier CSV est vide ou illisible.');
    return resultat;
  }

  // ── ÉTAPE 2 : Vérifier les colonnes ──────────────────────────
  // Normaliser les headers : minuscule + trim
  const headersNorm = headers.map((h) => h.toLowerCase().trim());

  const colonnesManquantes = COLONNES_REQUISES.filter(
    (col) => !headersNorm.includes(col)
  );

  if (colonnesManquantes.length > 0) {
    resultat.ok = false;
    resultat.errors.push(
      `Colonnes manquantes dans le CSV : ${colonnesManquantes.join(', ')}`
    );
    return resultat;
  }

  // Index de chaque colonne pour accéder aux valeurs par nom
  const idx = {};
  for (const col of COLONNES_REQUISES) {
    idx[col] = headersNorm.indexOf(col);
  }

  // ── ÉTAPE 3 : Traiter chaque ligne ───────────────────────────
  const referencesVues = new Set(); // pour détecter les doublons dans le CSV

  for (let i = 0; i < rows.length; i++) {
    const row      = rows[i];
    const ligneNum = i + 1; // numéro de ligne (1-based, hors header)
    const erreurs  = [];    // erreurs de cette ligne (non bloquantes globalement)

    // Extraire les valeurs brutes
    const dateRaw   = row[idx['date_availability_produit']] || '';
    const nomRaw    = row[idx['nom']]        || '';
    const refRaw    = row[idx['reference']]  || '';
    const prixRaw   = row[idx['prix_ttc']]   || '';
    const taxeRaw   = row[idx['taxe']]       || '';
    const catRaw    = row[idx['categorie']]  || '';
    const achatRaw  = row[idx['prix_achat']] || '';

    // ── Valider : nom ──────────────────────────────────────────
    const nom = nomRaw.trim();
    if (!nom) erreurs.push('Le nom est vide');

    // ── Valider : reference ────────────────────────────────────
    const reference = refRaw.trim();
    if (!reference) {
      erreurs.push('La référence est vide');
    } else if (referencesVues.has(reference)) {
      // Doublon dans le CSV lui-même
      erreurs.push(`Référence dupliquée dans le CSV : "${reference}"`);
    } else {
      referencesVues.add(reference);
    }

    // ── Valider : date ─────────────────────────────────────────
    const dateResult = parseDate(dateRaw);
    if (!dateResult.ok) erreurs.push(dateResult.erreur);

    // ── Valider : prix_ttc ─────────────────────────────────────
    const prixTTC = parseNombre(prixRaw);
    if (prixTTC === null) {
      erreurs.push(`Prix TTC invalide : "${prixRaw}"`);
    } else if (prixTTC <= 0) {
      erreurs.push(`Prix TTC doit être positif : ${prixTTC}`);
    }

    // ── Valider : taux TVA ─────────────────────────────────────
    const tauxTVA = parseTaux(taxeRaw);
    if (tauxTVA === null) {
      erreurs.push(`Taux TVA invalide : "${taxeRaw}"`);
    } else if (tauxTVA < 0) {
      erreurs.push(`Taux TVA ne peut pas être négatif : ${tauxTVA}`);
    }

    // ── Valider : categorie ────────────────────────────────────
    const categorie = catRaw.trim();
    if (!categorie) erreurs.push('La catégorie est vide');

    // ── Valider : prix_achat ───────────────────────────────────
    // Peut être vide (certains produits n'ont pas de prix d'achat)
    let prixAchat = 0;
    if (achatRaw.trim() !== '') {
      const parsed = parseNombre(achatRaw);
      if (parsed === null) {
        erreurs.push(`Prix d'achat invalide : "${achatRaw}"`);
      } else if (parsed < 0) {
        erreurs.push(`Prix d'achat ne peut pas être négatif : ${parsed}`);
      } else {
        prixAchat = parsed;
      }
    }

    // ── Résultat de la ligne ───────────────────────────────────
    if (erreurs.length > 0) {
      // La ligne a des erreurs → elle est skippée, on log les erreurs
      for (const err of erreurs) {
        resultat.avertissements.push({
          ligne:   ligneNum,
          ref:     reference || `ligne ${ligneNum}`,
          message: err,
          type:    'erreur', // distingue erreur de warning
        });
      }
    } else {
      // Ligne valide → ajouter au résultat normalisé
      resultat.produits.push({
        ligneCSV:       ligneNum,
        nom:            nom,
        reference:      reference,
        dateDisponible: dateResult.iso, // YYYY-MM-DD
        prixTTC:        prixTTC,
        tauxTVA:        tauxTVA,
        categorie:      categorie,
        prixAchat:      prixAchat,
      });
    }
  }

  // ── ÉTAPE 4 : Résumé ──────────────────────────────────────────
  // ok reste true même s'il y a des lignes skippées
  // (les erreurs de ligne ne sont pas bloquantes)
  // ok = false uniquement si colonnes manquantes (géré en ÉTAPE 2)

  return resultat;
}
