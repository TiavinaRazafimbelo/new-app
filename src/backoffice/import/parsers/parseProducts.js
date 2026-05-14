/**
 * parseProducts.js
 * Parse le CSV1 (produits) en objets normalisés.
 *
 * Format attendu :
 *   date_availability_produit | nom | reference | prix_ttc | Taxe | categorie | prix_achat
 *
 * Séparateur détecté automatiquement (virgule ou point-virgule).
 */

import { PRODUCT_COLUMNS, TAX_RATE_TO_RULE_ID } from '../config/columnMapping.js';

/**
 * @param {string} csvText - Contenu brut du fichier CSV
 * @returns {Array<Object>} Produits normalisés
 */
export function parseProductsCsv(csvText) {
  const lines = csvText
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length < 2) throw new Error('[parseProducts] CSV vide ou sans données');

  // Détection séparateur
  const sep = lines[0].includes(';') ? ';' : ',';

  const headers = lines[0].split(sep).map((h) => h.trim());
  const rows    = lines.slice(1);

  return rows.map((line, idx) => {
    const cols = line.split(sep).map((c) => c.trim());
    const raw  = {};
    headers.forEach((h, i) => { raw[h] = cols[i] ?? ''; });

    // Mapping vers noms normalisés
    const mapped = {};
    Object.entries(PRODUCT_COLUMNS).forEach(([csvCol, normKey]) => {
      mapped[normKey] = raw[csvCol] ?? '';
    });

    // Nettoyage prix (virgule → point)
    const priceTTC     = parseFloat((mapped.price_ttc     || '0').replace(',', '.')) || 0;
    const wholesaleRaw = parseFloat((mapped.wholesale_price|| '0').replace(',', '.')) || 0;

    // Taux de taxe → id_tax_rule_group
    const taxKey        = (mapped.tax_rate || '').trim();
    const taxRuleId     = TAX_RATE_TO_RULE_ID[taxKey] ?? 1;
    const taxRate       = parseFloat(taxKey.replace('%', '').replace(',', '.')) || 0;

    // Prix HT depuis TTC
    const priceHT = taxRate > 0
      ? priceTTC / (1 + taxRate / 100)
      : priceTTC;

    return {
      _line:          idx + 2,
      available_date: mapped.available_date || '',
      name:           mapped.name           || `Produit ${idx + 1}`,
      reference:      mapped.reference      || '',
      price_ttc:      priceTTC,
      price_ht:       Math.round(priceHT * 1000000) / 1000000,
      tax_rate:       taxRate,
      tax_rule_id:    taxRuleId,
      category_name:  mapped.category_name  || 'Home',
      wholesale_price: wholesaleRaw,
    };
  }).filter((p) => p.reference); // Ignorer les lignes sans référence
}
