/**
 * importProducts.js
 * Importe catégories, produits et images dans PrestaShop.
 *
 * ORDRE :
 *   1. Récupérer/créer les catégories
 *   2. Créer chaque produit
 *   3. Upload de l'image si disponible
 *
 * FIX : slugify robuste (gère accents, caractères malgaches, tirets, fallback)
 *       tax_rule_id défensif (log + fallback si taux inconnu)
 *       Validation catId/productId avant tout appel POST
 */

import { prestaGet, prestaWrite, prestaUploadImage, extraireValeur } from '../config/prestaApi.js';
import { PRESTA_CONFIG, TAX_RATE_TO_RULE_ID } from '../config/columnMapping.js';

// ─── Utilitaire ───────────────────────────────────────────────

/**
 * Convertit une chaîne quelconque en slug PrestaShop valide.
 * Gère les accents, caractères malgaches, espaces, tirets multiples.
 * Ne retourne jamais une chaîne vide (fallback sur 'item').
 *
 * @param {string} str
 * @returns {string}
 */
function slugify(str) {
  return (
    String(str)
      .toLowerCase()
      .normalize('NFD')                 // décompose les caractères accentués
      .replace(/[\u0300-\u036f]/g, '')  // supprime les diacritiques (é→e, à→a…)
      .replace(/[^a-z0-9]+/g, '-')     // tout caractère non alphanum → tiret
      .replace(/^-+|-+$/g, '')         // trim les tirets de début/fin
    || 'item'                           // fallback si slug totalement vide
  );
}

// ─── Catégories ───────────────────────────────────────────────

/**
 * Récupère toutes les catégories existantes.
 * @returns {Promise<Map<string, number>>} Map nom_lowercase → id
 */
async function getExistingCategories() {
  const data = await prestaGet('/categories?display=full');
  const cats = data.categories?.category || [];
  const liste = Array.isArray(cats) ? cats : [cats];

  const map = new Map();
  for (const c of liste) {
    const name = extraireValeur(c.name, PRESTA_CONFIG.ID_LANG).toLowerCase().trim();
    const id   = Number(extraireValeur(c.id));
    if (id && name) map.set(name, id);
  }
  return map;
}

/**
 * Crée une catégorie si elle n'existe pas déjà.
 * @param {string} name        - nom brut issu du CSV
 * @param {Map}    existingMap - Map nom_lowercase → id (mis à jour en place)
 * @returns {Promise<number>} ID de la catégorie
 */
async function getOrCreateCategory(name, existingMap) {
  const key  = name.toLowerCase().trim();
  const slug = slugify(name);

  if (existingMap.has(key)) return existingMap.get(key);

  // Sécurité : slug ne doit jamais être vide (PS rejette avec "name est vide" si le
  // champ link_rewrite est absent ou vide, même quand name est correct)
  if (!slug) {
    throw new Error(`[importProducts] Slug vide pour la catégorie "${name}" — vérifiez le nom dans le CSV`);
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<prestashop xmlns:xlink="http://www.w3.org/1999/xlink">
  <category>
    <id_parent><![CDATA[2]]></id_parent>
    <active><![CDATA[1]]></active>
    <id_shop_default><![CDATA[${PRESTA_CONFIG.ID_SHOP}]]></id_shop_default>
    <is_root_category><![CDATA[0]]></is_root_category>
    <name>
      <language id="${PRESTA_CONFIG.ID_LANG}"><![CDATA[${name}]]></language>
    </name>
    <description>
      <language id="${PRESTA_CONFIG.ID_LANG}"><![CDATA[]]></language>
    </description>
    <meta_title>
      <language id="${PRESTA_CONFIG.ID_LANG}"><![CDATA[${name}]]></language>
    </meta_title>
    <meta_description>
      <language id="${PRESTA_CONFIG.ID_LANG}"><![CDATA[]]></language>
    </meta_description>
    <meta_keywords>
      <language id="${PRESTA_CONFIG.ID_LANG}"><![CDATA[]]></language>
    </meta_keywords>
    <link_rewrite>
      <language id="${PRESTA_CONFIG.ID_LANG}"><![CDATA[${slug}]]></language>
    </link_rewrite>
  </category>
</prestashop>`;

console.log('[DEBUG XML catégorie]', xml);

  const result = await prestaWrite('/categories', xml, 'POST');
  const cat    = result.category?.[0] || result.category;
  const newId  = Number(extraireValeur(cat?.id));

  if (!newId) {
    throw new Error(`[importProducts] Catégorie "${name}" non créée — réponse PS inattendue : ${JSON.stringify(result)}`);
  }

  existingMap.set(key, newId);
  console.log(`[importProducts] Catégorie créée : "${name}" (slug: ${slug}) → ID ${newId}`);
  console.log('[DEBUG] name=', JSON.stringify(name), 'slug=', slugify(name));
  return newId;
}

// ─── Produits ─────────────────────────────────────────────────

/**
 * Récupère les produits existants indexés par référence.
 * @returns {Promise<Map<string, number>>} Map référence → id
 */
export async function getExistingProductsByRef() {
  const data  = await prestaGet('/products?display=full');
  const prods = data.products?.product || [];
  const liste = Array.isArray(prods) ? prods : [prods];

  const map = new Map();
  for (const p of liste) {
    const ref = extraireValeur(p.reference).trim();
    const id  = Number(extraireValeur(p.id));
    if (ref && id) map.set(ref, id);
  }
  return map;
}

/**
 * Résout l'ID du groupe de taxe à partir du taux brut CSV.
 * Log un avertissement si le taux est inconnu et utilise le défaut (1).
 *
 * @param {string} rawTaxRate - ex: "11,65%" ou "5.60%"
 * @returns {number} ID tax_rule_group PrestaShop
 */
function resolveTaxRuleId(rawTaxRate) {
  const normalized = String(rawTaxRate || '').trim();
  if (normalized in TAX_RATE_TO_RULE_ID) {
    return TAX_RATE_TO_RULE_ID[normalized];
  }
  // Tentative de normalisation : virgule ↔ point
  const alternate = normalized.includes(',')
    ? normalized.replace(',', '.')
    : normalized.replace('.', ',');
  if (alternate in TAX_RATE_TO_RULE_ID) {
    return TAX_RATE_TO_RULE_ID[alternate];
  }
  console.warn(
    `[importProducts] Taux TVA inconnu : "${normalized}" — fallback sur tax_rule_group 1. ` +
    `Ajoutez "${normalized}" dans TAX_RATE_TO_RULE_ID si nécessaire.`
  );
  return 1; // défaut : groupe 1
}

/**
 * Crée un produit dans PrestaShop.
 * @param {Object} product    - normalisé par parseProducts
 * @param {number} categoryId
 * @returns {Promise<number>} ID du produit créé
 */
async function createProduct(product, categoryId) {
  const availableDate = product.available_date
    ? product.available_date.split('/').reverse().join('-') // dd/mm/yyyy → yyyy-mm-dd
    : '0000-00-00';

  const taxRuleId  = resolveTaxRuleId(product.tax_rate);
  const slugRef    = slugify(product.reference);
  const priceHt    = Number(product.price_ht)      || 0;
  const wholesale  = Number(product.wholesale_price) || 0;

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<prestashop xmlns:xlink="http://www.w3.org/1999/xlink">
  <product>
    <id_category_default><![CDATA[${categoryId}]]></id_category_default>
    <id_shop_default><![CDATA[${PRESTA_CONFIG.ID_SHOP}]]></id_shop_default>
    <id_tax_rules_group><![CDATA[${taxRuleId}]]></id_tax_rules_group>
    <reference><![CDATA[${product.reference}]]></reference>
    <price>${priceHt.toFixed(6)}</price>
    <wholesale_price>${wholesale.toFixed(6)}</wholesale_price>
    <active><![CDATA[1]]></active>
    <available_for_order><![CDATA[1]]></available_for_order>
    <show_price><![CDATA[1]]></show_price>
    <visibility><![CDATA[both]]></visibility>
    <available_date><![CDATA[${availableDate}]]></available_date>
    <name>
      <language id="${PRESTA_CONFIG.ID_LANG}"><![CDATA[${product.name}]]></language>
    </name>
    <description>
      <language id="${PRESTA_CONFIG.ID_LANG}"><![CDATA[]]></language>
    </description>
    <description_short>
      <language id="${PRESTA_CONFIG.ID_LANG}"><![CDATA[${product.name}]]></language>
    </description_short>
    <meta_title>
      <language id="${PRESTA_CONFIG.ID_LANG}"><![CDATA[]]></language>
    </meta_title>
    <meta_description>
      <language id="${PRESTA_CONFIG.ID_LANG}"><![CDATA[]]></language>
    </meta_description>
    <meta_keywords>
      <language id="${PRESTA_CONFIG.ID_LANG}"><![CDATA[]]></language>
    </meta_keywords>
    <link_rewrite>
      <language id="${PRESTA_CONFIG.ID_LANG}"><![CDATA[${slugRef}]]></language>
    </link_rewrite>
    <associations>
      <categories>
        <category><id>${categoryId}</id></category>
      </categories>
    </associations>
  </product>
</prestashop>`;

  const result = await prestaWrite('/products', xml, 'POST');
  const prod   = result.product?.[0] || result.product;
  const newId  = Number(extraireValeur(prod?.id));

  if (!newId) {
    throw new Error(
      `[importProducts] Produit "${product.reference}" non créé — réponse PS inattendue : ${JSON.stringify(result)}`
    );
  }

  console.log(`[importProducts] Produit créé : "${product.name}" (${product.reference}) → ID ${newId}`);
  return newId;
}

// ─── Fonction principale ──────────────────────────────────────

/**
 * Importe tous les produits du CSV1.
 *
 * @param {Array}    products   - sortie de parseProductsCsv
 * @param {Object}   imageFiles - Map<reference, File> depuis le ZIP
 * @param {Function} onProgress - callback(message, type)
 * @returns {Promise<Map<string, number>>} Map référence → productId
 */
export async function importProducts(products, imageFiles = {}, onProgress = () => {}) {
  const refToId = new Map();

  onProgress('Récupération des catégories existantes...', 'info');
  const catMap = await getExistingCategories();

  onProgress('Récupération des produits existants...', 'info');
  const existingProds = await getExistingProductsByRef();

  for (const product of products) {
    try {
      // ── Validation minimale avant tout appel réseau ──
      if (!product.reference?.trim()) {
        onProgress(`⚠ Produit ignoré : référence manquante dans le CSV`, 'warning');
        continue;
      }
      if (!product.category_name?.trim()) {
        onProgress(`⚠ Produit ${product.reference} ignoré : catégorie manquante`, 'warning');
        continue;
      }

      // ── Catégorie ──
      const catId = await getOrCreateCategory(product.category_name.trim(), catMap);

      // ── Produit ──
      let productId;
      if (existingProds.has(product.reference)) {
        productId = existingProds.get(product.reference);
        onProgress(`⏭ Produit existant réutilisé : ${product.reference} (ID ${productId})`, 'skip');
      } else {
        productId = await createProduct(product, catId);
        onProgress(`✅ Produit créé : ${product.name} (${product.reference})`, 'success');
      }

      refToId.set(product.reference, productId);

      // ── Image ──
      const imageFile = imageFiles[product.reference];
      if (imageFile && !existingProds.has(product.reference)) {
        try {
          await prestaUploadImage(productId, imageFile);
          onProgress(`🖼 Image uploadée pour ${product.reference}`, 'success');
        } catch (imgErr) {
          onProgress(`⚠ Image ${product.reference} : ${imgErr.message}`, 'warning');
        }
      }

    } catch (err) {
      onProgress(`❌ Erreur produit ${product.reference} : ${err.message}`, 'error');
    }
  }

  const total = refToId.size;
  onProgress(`✅ ${total} produit(s) importé(s)`, total > 0 ? 'success' : 'warning');
  return refToId;
}