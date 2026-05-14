/**
 * importProducts.js
 * Importe catégories, produits et images dans PrestaShop.
 *
 * ORDRE :
 *   1. Récupérer/créer les catégories
 *   2. Créer chaque produit
 *   3. Upload de l'image si disponible
 */

import { prestaGet, prestaWrite, prestaUploadImage, extraireValeur } from '../config/prestaApi.js';
import { PRESTA_CONFIG } from '../config/columnMapping.js';

// ─── Catégories ───────────────────────────────────────────────

/**
 * Récupère toutes les catégories existantes.
 * @returns {Promise<Map<string, number>>} Map nom→id
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
 * Crée une catégorie si elle n'existe pas.
 * @param {string} name
 * @param {Map} existingMap
 * @returns {Promise<number>} ID de la catégorie
 */
async function getOrCreateCategory(name, existingMap) {
  const key = name.toLowerCase().trim();
  if (existingMap.has(key)) return existingMap.get(key);

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<prestashop xmlns:xlink="http://www.w3.org/1999/xlink">
  <category>
    <id_parent>2</id_parent>
    <active>1</active>
    <id_shop_default>${PRESTA_CONFIG.ID_SHOP}</id_shop_default>
    <is_root_category>0</is_root_category>
    <name>
      <language id="${PRESTA_CONFIG.ID_LANG}"><![CDATA[${name}]]></language>
    </name>
    <description>
      <language id="${PRESTA_CONFIG.ID_LANG}"><![CDATA[]]></language>
    </description>
    <link_rewrite>
      <language id="${PRESTA_CONFIG.ID_LANG}"><![CDATA[${name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')}]]></language>
    </link_rewrite>
  </category>
</prestashop>`;

  const result  = await prestaWrite('/categories', xml, 'POST');
  const cat     = result.category?.[0] || result.category;
  const newId   = Number(extraireValeur(cat?.id));

  if (!newId) throw new Error(`[importProducts] Catégorie "${name}" non créée`);

  existingMap.set(key, newId);
  console.log(`[importProducts] Catégorie créée : "${name}" → ID ${newId}`);
  return newId;
}

// ─── Produits ─────────────────────────────────────────────────

/**
 * Récupère les produits existants par référence.
 * @returns {Promise<Map<string, number>>} Map référence→id
 */
export async function getExistingProductsByRef() {
  const data = await prestaGet('/products?display=full');
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
 * Crée un produit PrestaShop.
 * @param {Object} product - normalisé par parseProducts
 * @param {number} categoryId
 * @returns {Promise<number>} ID du produit créé
 */
async function createProduct(product, categoryId) {
  const availableDate = product.available_date
    ? product.available_date.split('/').reverse().join('-') // dd/mm/yyyy → yyyy-mm-dd
    : '0000-00-00';

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<prestashop xmlns:xlink="http://www.w3.org/1999/xlink">
  <product>
    <id_category_default>${categoryId}</id_category_default>
    <id_shop_default>${PRESTA_CONFIG.ID_SHOP}</id_shop_default>
    <id_tax_rules_group>${product.tax_rule_id}</id_tax_rules_group>
    <reference><![CDATA[${product.reference}]]></reference>
    <price>${product.price_ht.toFixed(6)}</price>
    <wholesale_price>${product.wholesale_price.toFixed(6)}</wholesale_price>
    <active>1</active>
    <available_for_order>1</available_for_order>
    <show_price>1</show_price>
    <visibility>both</visibility>
    <available_date>${availableDate}</available_date>
    <name>
      <language id="${PRESTA_CONFIG.ID_LANG}"><![CDATA[${product.name}]]></language>
    </name>
    <description>
      <language id="${PRESTA_CONFIG.ID_LANG}"><![CDATA[]]></language>
    </description>
    <description_short>
      <language id="${PRESTA_CONFIG.ID_LANG}"><![CDATA[${product.name}]]></language>
    </description_short>
    <link_rewrite>
      <language id="${PRESTA_CONFIG.ID_LANG}"><![CDATA[${product.reference.toLowerCase().replace(/[^a-z0-9]/g, '-')}]]></language>
    </link_rewrite>
    <associations>
      <categories>
        <category><id>${categoryId}</id></category>
      </categories>
    </associations>
  </product>
</prestashop>`;

  const result  = await prestaWrite('/products', xml, 'POST');
  const prod    = result.product?.[0] || result.product;
  const newId   = Number(extraireValeur(prod?.id));

  if (!newId) throw new Error(`[importProducts] Produit "${product.reference}" non créé`);

  console.log(`[importProducts] Produit créé : "${product.name}" (${product.reference}) → ID ${newId}`);
  return newId;
}

// ─── Fonction principale ──────────────────────────────────────

/**
 * Importe tous les produits du CSV1.
 *
 * @param {Array}  products   - sortie de parseProductsCsv
 * @param {Object} imageFiles - Map<reference, File> depuis le zip
 * @param {Function} onProgress - callback(message, type)
 * @returns {Promise<Map<string, number>>} Map référence→productId
 */
export async function importProducts(products, imageFiles = {}, onProgress = () => {}) {
  const refToId = new Map();

  onProgress('Récupération des catégories existantes...', 'info');
  const catMap = await getExistingCategories();

  onProgress('Récupération des produits existants...', 'info');
  const existingProds = await getExistingProductsByRef();

  for (const product of products) {
    try {
      // Catégorie
      const catId = await getOrCreateCategory(product.category_name, catMap);

      let productId;

      if (existingProds.has(product.reference)) {
        productId = existingProds.get(product.reference);
        onProgress(`⏭ Produit existant réutilisé : ${product.reference} (ID ${productId})`, 'skip');
      } else {
        productId = await createProduct(product, catId);
        onProgress(`✅ Produit créé : ${product.name} (${product.reference})`, 'success');
      }

      refToId.set(product.reference, productId);

      // Image
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

  return refToId;
}
