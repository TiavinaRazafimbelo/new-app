/**
 * parseCombinations.js
 * Parse le CSV2 (combinaisons/stock) en objets normalisés.
 *
 * Format attendu :
 *   reference | specificité | karazany | stock_initial | prix_vente_ttc
 *
 * Lignes sans specificité/karazany = produit simple (pas de combinaison)
 */

import { COMBINATION_COLUMNS, ATTRIBUTE_VALUE_LABELS, ATTRIBUTE_GROUP_LABELS, TAX_RATE_TO_RULE_ID } from '../config/columnMapping.js';

/**
 * @param {string} csvText
 * @returns {Array<Object>} Combinaisons normalisées groupées par référence produit
 */
export function parseCombinationsCsv(csvText) {
  const lines = csvText
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length < 2) throw new Error('[parseCombinations] CSV vide ou sans données');

  const sep     = lines[0].includes(';') ? ';' : ',';
  const headers = lines[0].split(sep).map((h) => h.trim());
  const rows    = lines.slice(1);

  return rows.map((line, idx) => {
    const cols = line.split(sep).map((c) => c.trim());
    const raw  = {};
    headers.forEach((h, i) => { raw[h] = cols[i] ?? ''; });

    // Mapping
    const mapped = {};
    Object.entries(COMBINATION_COLUMNS).forEach(([csvCol, normKey]) => {
      mapped[normKey] = raw[csvCol] ?? '';
    });

    const qty      = parseInt(mapped.quantity || '0', 10) || 0;
    const priceTTC = parseFloat((mapped.price_ttc || '0').replace(',', '.')) || 0;

    const attrGroupRaw = (mapped.attribute_group || '').trim().toLowerCase();
    const attrValRaw   = (mapped.attribute_value  || '').trim().toLowerCase();

    // Libellés traduits
    const attrGroupLabel = ATTRIBUTE_GROUP_LABELS[attrGroupRaw] || attrGroupRaw || null;
    const attrValueLabel = ATTRIBUTE_VALUE_LABELS[attrValRaw]   || attrValRaw   || null;

    // Produit simple si pas de specificité/karazany
    const isSimple = !attrGroupRaw && !attrValRaw;

    return {
      _line:             idx + 2,
      product_reference: mapped.product_reference || '',
      is_simple:         isSimple,
      attribute_group:   attrGroupRaw   || null,   // clé interne (taille, couleur)
      attribute_value:   attrValRaw     || null,   // clé interne (ngoza, kely...)
      attribute_group_label: attrGroupLabel,        // libellé affiché
      attribute_value_label: attrValueLabel,        // libellé affiché
      quantity:          qty,
      price_ttc:         priceTTC,
    };
  }).filter((c) => c.product_reference);
}

/**
 * Groupe les combinaisons par référence produit.
 * Retourne un Map<reference, Array<combination>>
 *
 * @param {Array} combinations - sortie de parseCombinationsCsv
 * @returns {Map<string, Array>}
 */
export function groupByProduct(combinations) {
  const map = new Map();
  for (const combo of combinations) {
    const ref = combo.product_reference;
    if (!map.has(ref)) map.set(ref, []);
    map.get(ref).push(combo);
  }
  return map;
}
