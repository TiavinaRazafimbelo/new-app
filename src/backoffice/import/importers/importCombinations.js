/**
 * importCombinations.js
 * Importe les groupes d'attributs, attributs, combinaisons et stocks.
 *
 * ORDRE :
 *   1. Créer/récupérer les groupes d'attributs (taille, couleur...)
 *   2. Créer/récupérer les valeurs d'attributs (ngoza, kely...)
 *   3. Créer les combinaisons sur le produit
 *   4. Mettre à jour les stocks
 */

import { prestaGet, prestaWrite, extraireValeur } from '../config/prestaApi.js';
import { PRESTA_CONFIG } from '../config/columnMapping.js';

// ─── Groupes d'attributs ──────────────────────────────────────

async function getExistingAttributeGroups() {
  const data  = await prestaGet('/product_options?display=full');
  const items = data.product_options?.product_option || [];
  const liste = Array.isArray(items) ? items : [items];

  const map = new Map(); // label.lower → id
  for (const g of liste) {
    const name = extraireValeur(g.name, PRESTA_CONFIG.ID_LANG).toLowerCase().trim();
    const id   = Number(extraireValeur(g.id));
    if (name && id) map.set(name, id);
  }
  return map;
}

async function getOrCreateAttributeGroup(label, groupMap) {
  const key = label.toLowerCase().trim();
  if (groupMap.has(key)) return groupMap.get(key);

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<prestashop xmlns:xlink="http://www.w3.org/1999/xlink">
  <product_option>
    <is_color_group>0</is_color_group>
    <group_type>select</group_type>
    <position>0</position>
    <name>
      <language id="${PRESTA_CONFIG.ID_LANG}"><![CDATA[${label}]]></language>
    </name>
    <public_name>
      <language id="${PRESTA_CONFIG.ID_LANG}"><![CDATA[${label}]]></language>
    </public_name>
  </product_option>
</prestashop>`;

  const result = await prestaWrite('/product_options', xml, 'POST');
  const grp    = result.product_option?.[0] || result.product_option;
  const newId  = Number(extraireValeur(grp?.id));

  if (!newId) throw new Error(`Groupe attribut "${label}" non créé`);

  groupMap.set(key, newId);
  console.log(`[importCombinations] Groupe attribut créé : "${label}" → ID ${newId}`);
  return newId;
}

// ─── Valeurs d'attributs ──────────────────────────────────────

async function getExistingAttributeValues() {
  const data  = await prestaGet('/product_option_values?display=full');
  const items = data.product_option_values?.product_option_value || [];
  const liste = Array.isArray(items) ? items : [items];

  const map = new Map(); // `groupId:label.lower` → id
  for (const v of liste) {
    const name    = extraireValeur(v.name, PRESTA_CONFIG.ID_LANG).toLowerCase().trim();
    const groupId = Number(extraireValeur(v.id_attribute_group));
    const id      = Number(extraireValeur(v.id));
    if (name && groupId && id) map.set(`${groupId}:${name}`, id);
  }
  return map;
}

async function getOrCreateAttributeValue(label, groupId, valueMap) {
  const key = `${groupId}:${label.toLowerCase().trim()}`;
  if (valueMap.has(key)) return valueMap.get(key);

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<prestashop xmlns:xlink="http://www.w3.org/1999/xlink">
  <product_option_value>
    <id_attribute_group>${groupId}</id_attribute_group>
    <position>0</position>
    <name>
      <language id="${PRESTA_CONFIG.ID_LANG}"><![CDATA[${label}]]></language>
    </name>
  </product_option_value>
</prestashop>`;

  const result = await prestaWrite('/product_option_values', xml, 'POST');
  const val    = result.product_option_value?.[0] || result.product_option_value;
  const newId  = Number(extraireValeur(val?.id));

  if (!newId) throw new Error(`Valeur attribut "${label}" non créée`);

  valueMap.set(key, newId);
  console.log(`[importCombinations] Valeur attribut créée : "${label}" → ID ${newId}`);
  return newId;
}

// ─── Combinaisons ─────────────────────────────────────────────

async function createCombination(productId, attributeValueId, priceDiff = 0) {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<prestashop xmlns:xlink="http://www.w3.org/1999/xlink">
  <combination>
    <id_product>${productId}</id_product>
    <price>${priceDiff.toFixed(6)}</price>
    <weight>0</weight>
    <unit_price_impact>0</unit_price_impact>
    <minimal_quantity>1</minimal_quantity>
    <default_on>0</default_on>
    <associations>
      <product_option_values>
        <product_option_value><id>${attributeValueId}</id></product_option_value>
      </product_option_values>
    </associations>
  </combination>
</prestashop>`;

  const result = await prestaWrite('/combinations', xml, 'POST');
  const combo  = result.combination?.[0] || result.combination;
  const newId  = Number(extraireValeur(combo?.id));

  if (!newId) throw new Error(`Combinaison produit ${productId} non créée`);
  return newId;
}

// ─── Stocks ───────────────────────────────────────────────────

async function updateStock(productId, combinationId, quantity) {
  const filter = combinationId > 0
    ? `filter[id_product_attribute]=${combinationId}&filter[id_product]=${productId}`
    : `filter[id_product]=${productId}&filter[id_product_attribute]=0`;

  const data   = await prestaGet(`/stock_availables?${filter}&display=full`);
  const stocks = data.stock_availables?.stock_available || [];
  const liste  = Array.isArray(stocks) ? stocks : [stocks];

  if (!liste.length) {
    console.warn(`[importCombinations] Pas de stock_available pour produit ${productId} combi ${combinationId}`);
    return;
  }

  const stock   = liste[0];
  const stockId = Number(extraireValeur(stock.id));

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<prestashop xmlns:xlink="http://www.w3.org/1999/xlink">
  <stock_available>
    <id>${stockId}</id>
    <id_product>${productId}</id_product>
    <id_product_attribute>${combinationId}</id_product_attribute>
    <quantity>${quantity}</quantity>
    <depends_on_stock>0</depends_on_stock>
    <out_of_stock>2</out_of_stock>
  </stock_available>
</prestashop>`;

  await prestaWrite(`/stock_availables/${stockId}`, xml, 'PUT');
  console.log(`[importCombinations] Stock mis à jour : produit ${productId} combi ${combinationId} → ${quantity}`);
}

// ─── Fonction principale ──────────────────────────────────────

/**
 * Importe les combinaisons et stocks pour tous les produits.
 *
 * @param {Map<string, number>} refToProductId - référence → productId (sortie importProducts)
 * @param {Map<string, Array>}  combosByRef    - référence → combinaisons (sortie groupByProduct)
 * @param {Function} onProgress
 */
export async function importCombinations(refToProductId, combosByRef, onProgress = () => {}) {
  onProgress('Récupération des groupes d\'attributs existants...', 'info');
  const groupMap = await getExistingAttributeGroups();

  onProgress('Récupération des valeurs d\'attributs existantes...', 'info');
  const valueMap = await getExistingAttributeValues();

  for (const [ref, combos] of combosByRef.entries()) {
    const productId = refToProductId.get(ref);
    if (!productId) {
      onProgress(`⚠ Référence "${ref}" inconnue — combinaisons ignorées`, 'warning');
      continue;
    }

    // Cas produit simple (pas de combinaison)
    if (combos.length === 1 && combos[0].is_simple) {
      try {
        await updateStock(productId, 0, combos[0].quantity);
        onProgress(`✅ Stock simple mis à jour : ${ref} → ${combos[0].quantity}`, 'success');
      } catch (err) {
        onProgress(`❌ Stock ${ref} : ${err.message}`, 'error');
      }
      continue;
    }

    // Cas produit avec combinaisons
    for (const combo of combos) {
      if (combo.is_simple) continue;

      try {
        // Groupe attribut (ex: "Taille")
        const groupId = await getOrCreateAttributeGroup(
          combo.attribute_group_label, groupMap
        );

        // Valeur attribut (ex: "Grande taille")
        const valueId = await getOrCreateAttributeValue(
          combo.attribute_value_label, groupId, valueMap
        );

        // Combinaison
        const comboId = await createCombination(productId, valueId);
        onProgress(`✅ Combinaison créée : ${ref} / ${combo.attribute_value_label} → ID ${comboId}`, 'success');

        // Stock
        await updateStock(productId, comboId, combo.quantity);
        onProgress(`📦 Stock : ${ref} / ${combo.attribute_value_label} → ${combo.quantity}`, 'success');

      } catch (err) {
        onProgress(`❌ Combinaison ${ref}/${combo.attribute_value} : ${err.message}`, 'error');
      }
    }
  }
}
