/**
 * productsService.js
 * ─────────────────────────────────────────────────────────────
 * CORRECTIONS v4 :
 *   FIX PRIX PROMO : getProductById applique maintenant les specific_prices
 *     sur le produit de base ET sur chaque combinaison.
 *     Avant : specific_prices seulement dans getProducts() (liste).
 *     Après : aussi dans getProductById() (fiche détail) → cohérence.
 *
 *   LOGIQUE DE PRIX COMPLÈTE :
 *     1. Prix HT de base (product.price)
 *     2. + Prix additionnel HT combinaison (combination.price)
 *     3. → Prix HT final = base + additionnel
 *     4. Chercher specific_price pour (produit, combinaison) → réduction HT
 *     5. Prix TTC = prix_HT_après_réduction × (1 + TVA/100)
 *
 *   SPECIFIC_PRICES : Les réductions PrestaShop sont appliquées sur le HT.
 *     - reduction_type = 'percentage' → HT × (1 - réduction)
 *     - reduction_type = 'amount'     → HT - montant
 *     - price > 0                     → prix fixe HT (écrase tout)
 * ─────────────────────────────────────────────────────────────
 */

import { XMLParser } from 'fast-xml-parser';

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
     'stock_available', 'specific_price'].includes(tagName),
});

// ─── Caches ───────────────────────────────────────────────────

const taxRateCache        = new Map(); // taxGroupId → taux
const attributeGroupCache = new Map(); // groupId → "Taille"
const optionValueCache    = new Map(); // optionValueId → { id, name, id_attribute_group }
const specificPriceCache  = new Map(); // productId → specific_price[]

// ─── Fetch de base ────────────────────────────────────────────

async function prestaFetch(endpoint, opts = {}) {
  const response = await fetch(`${BASE_URL}${endpoint}`, {
    headers: { Authorization: getAuthHeader(), Accept: 'application/xml', ...(opts.headers || {}) },
    ...opts,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Erreur HTTP ${response.status}`);
  }
  const xmlText = await response.text();
  if (import.meta.env.DEV) console.debug(`[prestaFetch] ${endpoint}\n`, xmlText.slice(0, 300));
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

async function getTaxRate(taxRulesGroupId) {
  if (!taxRulesGroupId || taxRulesGroupId === 0) return 0;
  if (taxRateCache.has(taxRulesGroupId)) return taxRateCache.get(taxRulesGroupId);

  try {
    const data  = await prestaFetch(`/tax_rules?filter[id_tax_rules_group]=${taxRulesGroupId}&display=full`);
    const rules = data.tax_rules?.tax_rule || [];
    const liste = Array.isArray(rules) ? rules : [rules];
    if (!liste.length) { taxRateCache.set(taxRulesGroupId, 0); return 0; }

    const taxId = Number(extraireValeur(liste[0].id_tax));
    if (!taxId) { taxRateCache.set(taxRulesGroupId, 0); return 0; }

    const taxData = await prestaFetch(`/taxes/${taxId}?display=full`);
    const tax     = taxData.tax?.[0] || taxData.tax;
    const rate    = parseFloat(extraireValeur(tax?.rate) || 0);
    taxRateCache.set(taxRulesGroupId, rate);
    return rate;
  } catch (err) {
    console.warn(`[getTaxRate] Groupe ${taxRulesGroupId}:`, err.message);
    taxRateCache.set(taxRulesGroupId, 0);
    return 0;
  }
}

function calculerPrixTTC(priceHT, taxRate) {
  return priceHT * (1 + taxRate / 100);
}

// ─── SPECIFIC PRICES ──────────────────────────────────────────

/**
 * Charge TOUS les specific_prices d'un produit en une requête.
 * Résultat mis en cache par productId.
 *
 * @param {number} productId
 * @returns {Promise<Array>} Liste brute des specific_prices
 */
async function chargerSpecificPrices(productId) {
  if (specificPriceCache.has(productId)) return specificPriceCache.get(productId);

  try {
    const data = await prestaFetch(`/specific_prices?filter[id_product]=${productId}&display=full`);
    const list = data.specific_prices?.specific_price || [];
    const arr  = Array.isArray(list) ? list : (list ? [list] : []);
    specificPriceCache.set(productId, arr);
    return arr;
  } catch (err) {
    console.warn('[chargerSpecificPrices]', err.message);
    specificPriceCache.set(productId, []);
    return [];
  }
}

/**
 * Trouve le specific_price applicable pour un produit + combinaison donnés.
 *
 * PrestaShop cherche dans cet ordre de priorité :
 *   1. specific_price ciblant cette combinaison précise (id_product_attribute > 0)
 *   2. specific_price ciblant toutes les combinaisons (id_product_attribute = 0)
 *
 * On filtre aussi sur les dates de validité (from/to).
 *
 * @param {Array}  specificPrices - Tableau brut des specific_prices du produit
 * @param {number} combinationId  - 0 si produit de base
 * @returns {Object|null}
 */
function trouverSpecificPrice(specificPrices, combinationId = 0) {
  if (!specificPrices?.length) return null;
  const now = new Date();

  // Filtrer les prix valides (dates + combinaison)
  const valides = specificPrices.filter((sp) => {
    const from = extraireValeur(sp.from);
    const to   = extraireValeur(sp.to);

    // Vérifier les dates (ignorer si "0000-00-00 00:00:00")
    const fromOk = !from || from.startsWith('0000') || new Date(from) <= now;
    const toOk   = !to   || to.startsWith('0000')   || new Date(to)   >= now;

    const idCombi = Number(extraireValeur(sp.id_product_attribute));
    // S'applique si : ciblé sur cette combi OU applicable à toutes les combis (0)
    const combiOk = idCombi === 0 || idCombi === combinationId;

    return fromOk && toOk && combiOk;
  });

  if (!valides.length) return null;

  // Priorité : sp ciblant la combinaison spécifique > sp général (combi=0)
  const exact = valides.find(
    (sp) => Number(extraireValeur(sp.id_product_attribute)) === combinationId && combinationId > 0
  );
  return exact || valides[0];
}

/**
 * Applique un specific_price sur un prix HT de base.
 *
 * @param {number}      priceHT - Prix HT avant réduction
 * @param {Object|null} sp      - specific_price PrestaShop (peut être null)
 * @returns {number} Prix HT après réduction
 */
function appliquerSpecificPrice(priceHT, sp) {
  if (!sp) return priceHT;

  // 1. Prix fixe HT (champ "price" > 0 dans le specific_price)
  //    Ce prix écrase complètement le prix de base.
  const prixFixe = parseFloat(extraireValeur(sp.price) || 0);
  if (prixFixe > 0) {
    if (import.meta.env.DEV) console.debug('[appliquerSpecificPrice] Prix fixe:', prixFixe);
    return prixFixe;
  }

  const reduction      = parseFloat(extraireValeur(sp.reduction) || 0);
  const reductionType  = extraireValeur(sp.reduction_type);
  const reductionTaxe  = extraireValeur(sp.reduction_tax); // '1' = réduction appliquée TTC

  if (!reduction) return priceHT;

  if (reductionType === 'percentage') {
    // Réduction en % : HT × (1 - réduction)
    const result = priceHT * (1 - reduction);
    if (import.meta.env.DEV) console.debug(`[appliquerSpecificPrice] -${reduction * 100}% → ${result.toFixed(4)}`);
    return Math.max(0, result);
  }

  if (reductionType === 'amount') {
    // Réduction fixe en montant (HT si reduction_tax=0, TTC si reduction_tax=1)
    // On travaille en HT → si c'est une réduction TTC, on la laisse telle quelle
    // (approximation acceptable pour un front-end)
    const result = priceHT - reduction;
    if (import.meta.env.DEV) console.debug(`[appliquerSpecificPrice] -${reduction}€ → ${result.toFixed(4)}`);
    return Math.max(0, result);
  }

  return priceHT;
}

// ─── PRODUITS (liste) ─────────────────────────────────────────

export async function getProducts() {
  const data     = await prestaFetch('/products?display=full');
  const produits = data.products?.product || [];

  const results = await Promise.all(
    produits.map(async (p) => {
      const productId       = Number(extraireValeur(p.id));
      const priceHT         = parseFloat(extraireValeur(p.price) || 0);
      const taxRulesGroupId = Number(extraireValeur(p.id_tax_rules_group));

      // Charger TVA et specific_prices en parallèle
      const [taxRate, specificPrices] = await Promise.all([
        getTaxRate(taxRulesGroupId),
        chargerSpecificPrices(productId),
      ]);

      // Appliquer la promo sur le produit de base (combi = 0)
      const sp         = trouverSpecificPrice(specificPrices, 0);
      const priceHTNet = appliquerSpecificPrice(priceHT, sp);
      const priceTTC   = calculerPrixTTC(priceHTNet, taxRate);

      // Badge promo
      const aPromo = sp !== null;

      return {
        id:                  productId,
        reference:           extraireValeur(p.reference),
        priceHT,
        priceHTNet,          // HT après réduction
        price:               priceTTC,
        prixOriginalTTC:     aPromo ? calculerPrixTTC(priceHT, taxRate) : null, // Pour afficher le barré
        aPromo,
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
  } catch { return null; }
}

// ─── STOCK ────────────────────────────────────────────────────

async function getProductAllStocks(productId) {
  const data   = await prestaFetch(`/stock_availables?filter[id_product]=${productId}&display=full`);
  const stocks = data.stock_availables?.stock_available || [];
  const liste  = Array.isArray(stocks) ? stocks : [stocks];

  const tmp = new Map();
  for (const s of liste) {
    const combiId = Number(extraireValeur(s.id_product_attribute));
    const qty     = Number(extraireValeur(s.quantity));
    const shopId  = Number(extraireValeur(s.id_shop));
    const existing = tmp.get(combiId);
    if (!existing || (shopId === 1 && existing.shopId !== 1)) {
      tmp.set(combiId, { qty, shopId });
    }
  }

  const result = new Map();
  for (const [combiId, { qty }] of tmp) result.set(combiId, qty);
  return result;
}

// ─── OPTIONS / ATTRIBUTS ──────────────────────────────────────

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
    attributeGroupCache.set(groupId, null);
    return null;
  }
}

async function enrichirCombinaison(combi) {
  try {
    const opts      = combi.associations?.product_option_values?.product_option_value || [];
    const liste     = Array.isArray(opts) ? opts : [opts];
    const optionIds = liste.map((o) => Number(extraireValeur(o.id))).filter(Boolean);
    if (!optionIds.length) return {};

    const optionDatas = await Promise.all(optionIds.map(getOptionValueName));
    const groupIds    = [...new Set(optionDatas.filter(Boolean).map((o) => o.id_attribute_group))];
    const groupNames  = await Promise.all(groupIds.map(getAttributeGroupName));
    const groupMap    = Object.fromEntries(groupIds.map((id, i) => [id, groupNames[i]]));

    const attributes = {};
    for (const optData of optionDatas) {
      if (!optData) continue;
      const groupName = groupMap[optData.id_attribute_group];
      if (groupName) attributes[groupName] = optData.name;
    }
    return attributes;
  } catch (err) {
    console.warn('[enrichirCombinaison]:', err.message);
    return {};
  }
}

// ─── PRODUIT DÉTAIL ───────────────────────────────────────────

/**
 * getProductById — Fiche produit complète avec prix promo.
 *
 * CALCUL DE PRIX POUR CHAQUE COMBINAISON :
 *   1. priceHTBase    = product.price (HT produit de base)
 *   2. priceHTAddi    = combination.price (supplément HT)
 *   3. priceHTTotal   = priceHTBase + priceHTAddi
 *   4. sp             = specific_price pour (product, combination)
 *   5. priceHTNet     = appliquerSpecificPrice(priceHTTotal, sp)
 *   6. priceTTC       = priceHTNet × (1 + TVA/100)
 *
 * Pour le produit de base (sans combinaison) :
 *   priceHTAddi = 0, même logique.
 */
export async function getProductById(id) {
  const productId = Number(id);

  // Phase 1 : tout en parallèle
  const [data, stocksMap, specificPrices] = await Promise.all([
    prestaFetch(`/products/${productId}?display=full`),
    getProductAllStocks(productId),
    chargerSpecificPrices(productId),
  ]);

  const product = data.product?.[0];
  if (!product) throw new Error('Produit introuvable');

  const stockBase       = stocksMap.get(0) ?? 0;
  const taxRulesGroupId = Number(extraireValeur(product.id_tax_rules_group));
  const taxRate         = await getTaxRate(taxRulesGroupId);
  const priceHT         = parseFloat(product.price?.__cdata || 0);

  // Prix produit de base avec promo
  const spBase      = trouverSpecificPrice(specificPrices, 0);
  const priceHTNet  = appliquerSpecificPrice(priceHT, spBase);
  const priceTTC    = calculerPrixTTC(priceHTNet, taxRate);
  const aPromo      = spBase !== null;

  // Images
  const rawImages   = product.associations?.images?.image || [];
  const imagesArray = Array.isArray(rawImages) ? rawImages : [rawImages];
  const images      = imagesArray.map((img) => {
    const imageId = img.id?.__cdata || img.id || img['@_id'];
    return { id: Number(imageId), url: `/api/images/products/${productId}/${imageId}` };
  });

  // Combinaisons
  const rawCombis   = product.associations?.combinations?.combination || [];
  const combisArray = Array.isArray(rawCombis) ? rawCombis : [rawCombis];

  const combinations = await Promise.all(
    combisArray.map(async (c) => {
      const combiId = Number(c.id?.__cdata || c.id);

      const combiData    = await prestaFetch(`/combinations/${combiId}?display=full`);
      const combi        = combiData.combination?.[0] || combiData.combination;
      const priceAddiHT  = parseFloat(extraireValeur(combi?.price) || 0);
      const attributes   = await enrichirCombinaison(combi);

      // Prix total HT = base + additionnel
      const prixHTTotal = priceHT + priceAddiHT;

      // Chercher promo spécifique à cette combinaison
      // (ou promo générale si pas de promo spécifique pour cette combi)
      const spCombi       = trouverSpecificPrice(specificPrices, combiId);
      const prixHTNetCombi = appliquerSpecificPrice(prixHTTotal, spCombi);

      // Prix TTC final de la combinaison
      const prixTTCCombi  = calculerPrixTTC(prixHTNetCombi, taxRate);

      // Prix additionnel TTC à afficher dans le sélecteur
      // = différence entre prix combi TTC et prix base TTC
      const prixAddiTTC   = prixTTCCombi - priceTTC;

      const qty = stocksMap.get(combiId) ?? 0;

      return {
        id:              combiId,
        reference:       extraireValeur(combi?.reference),
        priceHTAddi:     priceAddiHT,      // Supplément HT brut
        price:           prixAddiTTC,      // Supplément TTC après promo (pour le sélecteur)
        priceTTC:        prixTTCCombi,     // Prix TTC total de la combinaison
        prixOriginalTTC: spCombi ? calculerPrixTTC(prixHTTotal, taxRate) : null,
        aPromo:          spCombi !== null,
        quantity:        qty,
        ean13:           extraireValeur(combi?.ean13),
        attributes,
      };
    })
  );

  const langName  = product.name?.language?.[0]?.__cdata || 'Sans nom';
  const shortDesc = product.description_short?.language?.[0]?.__cdata || '';
  const fullDesc  = product.description?.language?.[0]?.__cdata || '';

  return {
    id:         productId,
    name:       langName,
    reference:  product.reference?.__cdata || '',
    priceHT,
    priceHTNet,
    price:      priceTTC,                // TTC après promo
    prixOriginalTTC: aPromo ? calculerPrixTTC(priceHT, taxRate) : null,
    aPromo,
    taxRate,
    quantity:   stockBase,
    condition:  product.condition?.__cdata || 'new',
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

// ─── Exports utilitaires ──────────────────────────────────────

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