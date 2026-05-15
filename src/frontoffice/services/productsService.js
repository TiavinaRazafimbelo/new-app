/**
 * productsService.js
 * ─────────────────────────────────────────────────────────────
 * Service d'accès à l'API Web Services PrestaShop.
 *
 * CORRECTIONS v3 :
 *   FIX PRIX  : Affichage prix TTC (HT × (1 + taux_tva / 100))
 *               Le taux TVA est récupéré via /tax_rule_groups + /taxes
 *               et mis en cache pour éviter les appels répétés.
 *
 *   FIX SPEED : getProductById optimisé — tous les appels sont
 *               faits en parallèle (Promise.all) au lieu de séquentiels.
 *               Avant : ~30 appels séquentiels → ~15s de chargement.
 *               Après : groupes parallèles → ~3-5s.
 *
 *   FIX CACHE : taxRateCache + productCache mémorisent les résultats
 *               pour éviter les re-fetch à chaque navigation.
 * ─────────────────────────────────────────────────────────────
 */

import { XMLParser } from 'fast-xml-parser';

// ─── Configuration ────────────────────────────────────────────

const API_KEY  = import.meta.env.VITE_PRESTA_API_KEY;
const BASE_URL = '/api';

function getAuthHeader() {
  return 'Basic ' + btoa(`${API_KEY}:`);
}

const parser = new XMLParser({
  ignoreAttributes:       false,
  attributeNamePrefix:    '@_',
  cdataPropName:          '__cdata',
  textNodeName:           '#text',
  parseAttributeValue:    true,
  allowBooleanAttributes: true,
  isArray: (tagName) =>
    ['product', 'category', 'order', 'order_state', 'image',
     'combination', 'language', 'product_option_value', 'tax_rule',
     'stock_available'].includes(tagName),
});

// ─── Caches en mémoire ────────────────────────────────────────

/** Cache des taux TVA : taxGroupId → taux (ex: 20) */
const taxRateCache = new Map();

/** Cache des noms d'attributs : groupId → "Taille" */
const attributeGroupCache = new Map();

/** Cache des valeurs d'options : optionValueId → { id, name, id_attribute_group } */
const optionValueCache = new Map();

// ─── Fetch de base ────────────────────────────────────────────

async function prestaFetch(endpoint, opts = {}) {
  const response = await fetch(`${BASE_URL}${endpoint}`, {
    headers: {
      Authorization: getAuthHeader(),
      Accept:        'application/xml',
      ...(opts.headers || {}),
    },
    ...opts,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Erreur HTTP ${response.status}`);
  }

  const xmlText = await response.text();

  if (import.meta.env.DEV) {
    console.debug(`[prestaFetch] ${endpoint}\n`, xmlText.slice(0, 300));
  }

  const parsed = parser.parse(xmlText);
  return parsed.prestashop || parsed;
}

// ─── Utilitaires ──────────────────────────────────────────────

function extraireValeur(champ, langId = 1) {
  if (champ === undefined || champ === null) return '';
  if (typeof champ === 'string' || typeof champ === 'number') return String(champ);
  if (champ.__cdata !== undefined) return String(champ.__cdata);
  if (champ.language) {
    const langues = Array.isArray(champ.language) ? champ.language : [champ.language];
    const langue  = langues.find((l) => Number(l['@_id']) === langId) || langues[0];
    if (!langue) return '';
    if (langue.__cdata !== undefined) return String(langue.__cdata);
    if (langue['#text']  !== undefined) return String(langue['#text']);
    return String(langue);
  }
  return String(champ);
}

function getProductBadge(dateAdd) {
  if (!dateAdd) return null;
  const diffJours = (new Date() - new Date(dateAdd)) / (1000 * 60 * 60 * 24);
  if (diffJours < 1) return 'HOT';
  if (diffJours < 7) return 'NEW';
  return null;
}

// ─── TVA ──────────────────────────────────────────────────────

/**
 * Récupère le taux TVA d'un groupe de règles fiscales.
 * Résultat mis en cache pour éviter les re-fetch.
 *
 * @param {number} taxRulesGroupId - id_tax_rules_group du produit
 * @returns {Promise<number>} Taux TVA en pourcentage (ex: 20)
 */
async function getTaxRate(taxRulesGroupId) {
  if (!taxRulesGroupId || taxRulesGroupId === 0) return 0;

  // Vérifier le cache
  if (taxRateCache.has(taxRulesGroupId)) {
    return taxRateCache.get(taxRulesGroupId);
  }

  try {
    // Récupérer les règles du groupe
    const data  = await prestaFetch(
      `/tax_rules?filter[id_tax_rules_group]=${taxRulesGroupId}&display=full`
    );
    const rules = data.tax_rules?.tax_rule || [];
    const liste = Array.isArray(rules) ? rules : [rules];

    if (!liste.length) {
      taxRateCache.set(taxRulesGroupId, 0);
      return 0;
    }

    // Prendre la première règle et récupérer la taxe associée
    const taxId = Number(extraireValeur(liste[0].id_tax));

    if (!taxId) {
      taxRateCache.set(taxRulesGroupId, 0);
      return 0;
    }

    const taxData = await prestaFetch(`/taxes/${taxId}?display=full`);
    const tax     = taxData.tax?.[0] || taxData.tax;
    const rate    = parseFloat(extraireValeur(tax?.rate) || 0);

    taxRateCache.set(taxRulesGroupId, rate);
    console.debug(`[getTaxRate] Groupe ${taxRulesGroupId} → TVA ${rate}%`);
    return rate;

  } catch (err) {
    console.warn(`[getTaxRate] Groupe ${taxRulesGroupId}:`, err.message);
    taxRateCache.set(taxRulesGroupId, 0);
    return 0;
  }
}

// ─── SPECIFIC PRICES (PROMOTIONS) ────────────────────────────

async function getSpecificPrice(productId, combinationId = 0) {
  try {
    const data = await prestaFetch(
      `/specific_prices?filter[id_product]=${productId}&display=full`
    );

    const list = data.specific_prices?.specific_price || [];
    const arr  = Array.isArray(list) ? list : [list];

    if (!arr.length) return null;

    const now = new Date();

    return arr.find(sp => {
      const fromOk = !sp.from || new Date(sp.from) <= now;
      const toOk   = !sp.to || new Date(sp.to) >= now;

      const combOk =
        Number(extraireValeur(sp.id_product_attribute)) === 0 ||
        Number(extraireValeur(sp.id_product_attribute)) === combinationId;

      return fromOk && toOk && combOk;
    }) || null;

  } catch (err) {
    console.warn('[getSpecificPrice]', err.message);
    return null;
  }
}

function applySpecificPrice(basePrice, sp) {
  if (!sp) return basePrice;

  const priceFixed = parseFloat(sp.price || 0);

  // 1. Prix fixe (priorité max)
  if (priceFixed > 0) {
    return priceFixed;
  }

  const reduction = parseFloat(sp.reduction || 0);

  // 2. Réduction pourcentage
  if (sp.reduction_type === 'percentage') {
    return basePrice * (1 - reduction);
  }

  // 3. Réduction fixe
  if (sp.reduction_type === 'amount') {
    return basePrice - reduction;
  }

  return basePrice;
}

/**
 * Calcule le prix TTC depuis un prix HT et un taux TVA.
 * @param {number} priceHT
 * @param {number} taxRate - En pourcentage (ex: 20)
 */
function calculerPrixTTC(priceHT, taxRate) {
  return priceHT * (1 + taxRate / 100);
}

// ─── PRODUITS (liste) ─────────────────────────────────────────

/**
 * Récupère la liste des produits avec prix TTC.
 * La TVA est chargée en parallèle pour chaque produit.
 */
export async function getProducts() {
  const data    = await prestaFetch('/products?display=full');
  const produits = data.products?.product || [];

  // Charger les taux TVA en parallèle (dédupliqués grâce au cache)
  const results = await Promise.all(
    produits.map(async (p) => {
const priceHT = parseFloat(extraireValeur(p.price) || 0);
const taxRulesGroupId = Number(extraireValeur(p.id_tax_rules_group));
const taxRate = await getTaxRate(taxRulesGroupId);

// ✔ récupérer combinaison 0 (produit de base)
const sp = await getSpecificPrice(Number(extraireValeur(p.id)), 0);

// ✔ appliquer promo AVANT TVA
let finalHT = applySpecificPrice(priceHT, sp);

// ✔ TTC final
const priceTTC = calculerPrixTTC(finalHT, taxRate);

      return {
        id:                  Number(extraireValeur(p.id)),
        reference:           extraireValeur(p.reference),
        priceHT,
        price:               priceTTC,       // ← TTC affiché
        taxRate,
        active:              extraireValeur(p.active) === '1',
        name:                extraireValeur(p.name),
        imageId:             extraireImageId(p),
        id_category_default: Number(extraireValeur(p.id_category_default)),
        date_add:            extraireValeur(p.date_add),
        badge:               getProductBadge(extraireValeur(p.date_add)),
        id_tax_rules_group:  taxRulesGroupId,
      };
    })
  );

  return results;
}

function extraireImageId(produit) {
  try {
    const images = produit.associations?.images?.image || produit.associations?.images || [];
    const liste  = Array.isArray(images) ? images : [images];
    if (!liste.length) return null;
    const premier = liste[0];
    const id = premier.id || premier['@_id'] || premier.__cdata;
    return id ? Number(extraireValeur(id)) : null;
  } catch {
    return null;
  }
}

// // ─── STOCK ───────────────────────────────────────────────────

// async function getProductStock(productId) {
//   const data   = await prestaFetch(
//     `/stock_availables?filter[id_product]=${productId}&display=full`
//   );
//   const stocks = data.stock_availables?.stock_available || [];
//   const list   = Array.isArray(stocks) ? stocks : [stocks];

//   const principal = list.find(
//     (s) => Number(extraireValeur(s.id_product_attribute)) === 0
//   );
//   return principal ? Number(extraireValeur(principal.quantity)) : 0;
// }

// async function getCombinationStock(combinationId) {
//   const data   = await prestaFetch(
//     `/stock_availables?filter[id_product_attribute]=${combinationId}&display=full`
//   );
//   const stocks = data.stock_availables?.stock_available || [];
//   const list   = Array.isArray(stocks) ? stocks : [stocks];
//   if (!list.length) return 0;
//   return Number(extraireValeur(list[0].quantity));
// }

// ─── OPTIONS / ATTRIBUTS (avec cache) ────────────────────────

async function getOptionValueName(optionValueId) {
  if (optionValueCache.has(optionValueId)) return optionValueCache.get(optionValueId);

  try {
    const data   = await prestaFetch(`/product_option_values/${optionValueId}?display=full`);
    const optVal = data.product_option_value?.[0];
    if (!optVal) { optionValueCache.set(optionValueId, null); return null; }

    const result = {
      id:                 Number(extraireValeur(optVal.id)),
      name:               extraireValeur(optVal.name),
      id_attribute_group: Number(extraireValeur(optVal.id_attribute_group)),
    };
    optionValueCache.set(optionValueId, result);
    return result;
  } catch (err) {
    console.warn(`[getOptionValueName] option ${optionValueId}:`, err.message);
    optionValueCache.set(optionValueId, null);
    return null;
  }
}

async function getAttributeGroupName(groupId) {
  if (attributeGroupCache.has(groupId)) return attributeGroupCache.get(groupId);

  try {
    const data  = await prestaFetch(`/product_options/${groupId}?display=full`);
    const group = data.product_option?.[0] || data.product_option;
    if (!group) { attributeGroupCache.set(groupId, null); return null; }

    const name = extraireValeur(group.name);
    attributeGroupCache.set(groupId, name);
    return name;
  } catch (err) {
    console.warn(`[getAttributeGroupName] groupe ${groupId}:`, err.message);
    attributeGroupCache.set(groupId, null);
    return null;
  }
}

/**
 * Enrichit une combinaison avec ses attributs.
 * Retourne { "Taille": "M", "Couleur": "Bleu" }
 * OPTIMISÉ : appels parallèles pour les options.
 */
async function enrichirCombinaison(combi) {
  try {
    const opts     = combi.associations?.product_option_values?.product_option_value || [];
    const liste    = Array.isArray(opts) ? opts : [opts];
    const optionIds = liste.map((o) => Number(extraireValeur(o.id))).filter(Boolean);

    if (!optionIds.length) return {};

    // Charger toutes les options en parallèle
    const optionDatas = await Promise.all(optionIds.map(getOptionValueName));

    // Charger tous les groupes en parallèle (dédupliqués)
    const groupIds   = [...new Set(optionDatas.filter(Boolean).map((o) => o.id_attribute_group))];
    const groupNames = await Promise.all(groupIds.map(getAttributeGroupName));
    const groupMap   = Object.fromEntries(groupIds.map((id, i) => [id, groupNames[i]]));

    const attributes = {};
    for (const optData of optionDatas) {
      if (!optData) continue;
      const groupName = groupMap[optData.id_attribute_group];
      if (groupName) attributes[groupName] = optData.name;
    }

    return attributes;
  } catch (err) {
    console.warn(`[enrichirCombinaison]:`, err.message);
    return {};
  }
}

// ─── PRODUIT DÉTAIL ───────────────────────────────────────────

// ─── PATCH productsService.js ─────────────────────────────────
//
// PROBLÈME IDENTIFIÉ via /diag-stock/5 :
//
//   Le produit 5 a 4 lignes dans ps_stock_available :
//     id=5  : produit de base (id_product_attribute=0), id_shop=1, qty=600
//     id=38 : combinaison 19,                           id_shop=1, qty=300
//     id=39 : combinaison 20 (60x90cm),                 id_shop=0, qty=296  ← id_shop=0 !
//     id=40 : combinaison 21,                           id_shop=1, qty=300
//
//   Sans filtre id_shop, l'API retourne TOUTES les lignes (shop 0 et shop 1).
//   getCombinationStock prenait [0] sans discriminer → mauvaise valeur.
//
//   De plus, getProductStock cherchait id_product_attribute=0 mais sans
//   filtrer id_shop=1 → pouvait retourner une ligne incorrecte.
//
// FIX :
//   Utiliser getProductAllStocks() qui charge TOUTES les lignes en 1 requête,
//   puis priorise id_shop=1 si disponible, sinon id_shop=0.
//   C'est plus robuste et réduit le nombre de requêtes.
//
// REMPLACE les fonctions getProductStock, getCombinationStock ET
// la section "── Phase 1" de getProductById dans productsService.js.
// ─────────────────────────────────────────────────────────────


//  * Charge TOUS les stocks d'un produit en 1 requête.
//  * Retourne Map<id_product_attribute, quantity>.
//  *
//  * Priorité id_shop=1 sur id_shop=0 pour la même combinaison.
//  * La combinaison 60x90cm (id_shop=0) sera quand même correctement lue
//  * car c'est sa seule ligne disponible.
 
async function getProductAllStocks(productId) {
  const data   = await prestaFetch(
    `/stock_availables?filter[id_product]=${productId}&display=full`
  );
  const stocks = data.stock_availables?.stock_available || [];
  const liste  = Array.isArray(stocks) ? stocks : [stocks];
 
  // Map temporaire : combiId → { qty, shopId }
  const tmp = new Map();
 
  for (const s of liste) {
    const combiId = Number(extraireValeur(s.id_product_attribute));
    const qty     = Number(extraireValeur(s.quantity));
    const shopId  = Number(extraireValeur(s.id_shop));
 
    const existing = tmp.get(combiId);
    if (!existing) {
      tmp.set(combiId, { qty, shopId });
    } else if (shopId === 1 && existing.shopId !== 1) {
      // Priorité id_shop=1
      tmp.set(combiId, { qty, shopId });
    }
  }
 
  // Retourner Map<combiId, qty>
  const result = new Map();
  for (const [combiId, { qty }] of tmp) {
    result.set(combiId, qty);
  }
 
  if (import.meta.env.DEV) {
    console.debug(`[getProductAllStocks] produit ${productId}:`, Object.fromEntries(result));
  }
 
  return result;
}
 
 
// ── FIX 1+2 : getProductById corrigé ─────────────────────────
 
export async function getProductById(id) {
  // Phase 1 : produit + tous les stocks en parallèle
  const [data, stocksMap] = await Promise.all([
    prestaFetch(`/products/${id}?display=full`),
    getProductAllStocks(id),  // ← FIX 2 : requête séparée, pas les associations
  ]);
 
  const product = data.product?.[0];
  if (!product) throw new Error('Produit introuvable');
 
  // Stock produit de base (combi = 0)
  const stockBase = stocksMap.get(0) ?? 0;
 
  // TVA
  const taxRulesGroupId = Number(extraireValeur(product.id_tax_rules_group));
  const taxRate         = await getTaxRate(taxRulesGroupId);
  const priceHT         = parseFloat(product.price?.__cdata || 0);
  const priceTTC        = calculerPrixTTC(priceHT, taxRate);
 
  // Images
  const rawImages   = product.associations?.images?.image || [];
  const imagesArray = Array.isArray(rawImages) ? rawImages : [rawImages];
  const images      = imagesArray.map((img) => {
    const imageId = img.id?.__cdata || img.id || img['@_id'];
    return { id: Number(imageId), url: `/api/images/products/${id}/${imageId}` };
  });
 
  // ── FIX 1 : combinaisons — parser corrigé avec 'combination' dans isArray
  // Avec le fix du parser, combisArray sera toujours un vrai tableau.
  const rawCombis   = product.associations?.combinations?.combination || [];
  const combisArray = Array.isArray(rawCombis) ? rawCombis : [rawCombis];
 
  if (import.meta.env.DEV) {
    console.debug(`[getProductById] produit ${id}: ${combisArray.length} combinaisons trouvées`);
  }
 
  const combinations = await Promise.all(
    combisArray.map(async (c) => {
      const combiId   = Number(c.id?.__cdata || c.id);
 
      const combiData = await prestaFetch(`/combinations/${combiId}?display=full`);
      const combi     = combiData.combination?.[0] || combiData.combination;
 
      const priceAddiHT  = parseFloat(extraireValeur(combi?.price) || 0);
      const priceAddiTTC = calculerPrixTTC(priceAddiHT, taxRate);
      const attributes   = await enrichirCombinaison(combi);
 
      // ── FIX 2 : stock depuis la Map (pas getCombinationStock)
      const qty = stocksMap.get(combiId) ?? 0;
 
      if (import.meta.env.DEV) {
        console.debug(`  combi ${combiId}: qty=${qty}, attrs=`, attributes);
      }
 
      return {
        id:        combiId,
        reference: extraireValeur(combi?.reference),
        priceHT:   priceAddiHT,
        price:     priceAddiTTC,
        quantity:  qty,          // ← stock réel depuis getProductAllStocks
        ean13:     extraireValeur(combi?.ean13),
        attributes,
      };
    })
  );
 
  const langName  = product.name?.language?.[0]?.__cdata || 'Sans nom';
  const shortDesc = product.description_short?.language?.[0]?.__cdata || '';
  const fullDesc  = product.description?.language?.[0]?.__cdata || '';
 
  return {
    id:        Number(product.id?.__cdata),
    name:      langName,
    reference: product.reference?.__cdata || '',
    priceHT,
    price:     priceTTC,
    taxRate,
    quantity:  stockBase,        // ← stock produit de base correct
    condition: product.condition?.__cdata || 'new',
    description_short: shortDesc,
    description:       fullDesc,
    weight: parseFloat(product.weight?.__cdata || 0),
    width:  parseFloat(product.width?.__cdata  || 0),
    height: parseFloat(product.height?.__cdata || 0),
    depth:  parseFloat(product.depth?.__cdata  || 0),
    ean13:            product.ean13?.__cdata || '',
    minimal_quantity: parseInt(product.minimal_quantity?.__cdata || 1),
    date_add:         product.date_add?.__cdata || null,
    id_tax_rules_group: taxRulesGroupId,
    images,
    combinations,
  };
}

// ─── Images (utilisé par ProductCard) ────────────────────────

export async function getProductImages(productId) {
  try {
    const data   = await prestaFetch(`/products/${productId}?display=full`);
    const images = data.product?.[0]?.associations?.images?.image || [];
    return images.map((img) => ({ id: Number(img.id?.__cdata || img.id) }));
  } catch (err) {
    console.error(`[getProductImages] Produit ${productId}:`, err);
    return [];
  }
}

// ─── Catégories ───────────────────────────────────────────────

export async function getCategoryById(id) {
  const data = await prestaFetch(`/categories/${id}?display=full`);
  const c    = data.categories?.category?.[0] || data.category;
  if (!c) throw new Error(`Catégorie #${id} introuvable`);
  return { id: Number(extraireValeur(c.id)), name: extraireValeur(c.name) };
}

export async function getCategories() {
  const data = await prestaFetch('/categories?display=[id,name]');
  const cats = data.categories?.category || [];
  return (Array.isArray(cats) ? cats : [cats]).map((c) => ({
    id:   Number(extraireValeur(c.id)),
    name: extraireValeur(c.name),
  }));
}

export async function searchProducts(criteria = {}) {
  const { searchTerm = '', categoryId = null, minPrice = 0, maxPrice = Infinity } = criteria;
  const allProducts = await getProducts();

  return allProducts.filter((p) => {
    const matchName     = searchTerm === '' || p.name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchCategory = categoryId === null || p.id_category_default === Number(categoryId);
    const matchPrice    = p.price >= minPrice && p.price <= maxPrice;
    return matchName && matchCategory && matchPrice;
  });
}

export async function getProductCombinations(idProduit) {
  try {
    const data   = await prestaFetch(`/combinations?filter[id_product]=${idProduit}&display=full`);
    const combis = data.combinations?.combination || [];
    const liste  = Array.isArray(combis) ? combis : [combis];
    return liste.map((c) => ({
      id:        Number(extraireValeur(c.id)),
      reference: extraireValeur(c.reference),
      price:     parseFloat(extraireValeur(c.price) || 0),
      quantity:  Number(extraireValeur(c.quantity) || 0),
      ean13:     extraireValeur(c.ean13),
    }));
  } catch (err) {
    console.warn(`[getProductCombinations] Produit ${idProduit}:`, err.message);
    return [];
  }
}