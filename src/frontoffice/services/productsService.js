/**
 * productsService.js
 * ─────────────────────────────────────────────────────────────
 * Service d'accès à l'API Web Services PrestaShop.
 *
 * STRATÉGIE :
 *   - Toutes les requêtes passent par le proxy Vite (/api → localhost/prestashop/api)
 *   - On récupère le XML brut et on le parse avec fast-xml-parser
 *   - La clé API est envoyée en header Authorization (Basic Auth)
 *     SAUF pour les images (les <img src="..."> chargent l'URL directement
 *     sans pouvoir attacher un header → pas de popup d'authentification)
 *
 * INSTALLATION :
 *   npm install fast-xml-parser
 *
 * PROXY VITE (vite.config.js) :
 *   '/api': { target: 'http://localhost/prestashop_edition_classic_version_8.2.6', changeOrigin: true }
 * ─────────────────────────────────────────────────────────────
 */

import { XMLParser } from 'fast-xml-parser';

// ─── Configuration ────────────────────────────────────────────

const API_KEY  = import.meta.env.VITE_PRESTA_API_KEY;
const BASE_URL = '/api'; // Proxy Vite intercepte et redirige

/**
 * En-tête d'authentification HTTP Basic pour PrestaShop.
 * PrestaShop utilise la clé API comme "username", le password est vide.
 */
function getAuthHeader() {
  return 'Basic ' + btoa(`${API_KEY}:`);
}

/**
 * Parser XML configuré pour PrestaShop.
 * - ignoreAttributes: false → on garde les attributs xlink:href etc.
 * - CDATA: PrestaShop encapsule les valeurs dans des CDATA
 * - isArray: on force certains champs à toujours être des tableaux
 *   même si PrestaShop n'en retourne qu'un seul (évite les bugs de parsing)
 */
const parser = new XMLParser({
  ignoreAttributes:        false,       // Garder xlink:href, etc.
  attributeNamePrefix:     '@_',        // Les attrs auront le préfixe @_
  cdataPropName:           '__cdata',   // Les CDATA sous .__cdata
  textNodeName:            '#text',
  parseAttributeValue:     true,
  allowBooleanAttributes:  true,
  // Ces clés sont TOUJOURS des tableaux même si un seul élément
  isArray: (tagName) =>
    ['product', 'category', 'order', 'order_state', 'image',
     'combination', 'language', 'product_option_value'].includes(tagName),
});

// ─── Fetch de base ────────────────────────────────────────────

/**
 * Effectue une requête vers l'API PrestaShop.
 * Récupère le XML brut, le parse avec fast-xml-parser,
 * et retourne l'objet JavaScript résultant.
 *
 * @param {string} endpoint  - Ex: '/products?display=full'
 * @param {RequestInit} opts - Options fetch supplémentaires
 * @returns {Promise<Object>} - Objet JS parsé depuis le XML PrestaShop
 */
async function prestaFetch(endpoint, opts = {}) {
  const response = await fetch(`${BASE_URL}${endpoint}`, {
    headers: {
      Authorization: getAuthHeader(),
      // On demande du XML — on parse nous-même avec fast-xml-parser
      // (Output-Format: JSON de PrestaShop est souvent mal formé)
      'Accept': 'application/xml',
      ...(opts.headers || {}),
    },
    ...opts,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Erreur HTTP ${response.status}`);
  }

  const xmlText = await response.text();

  // Débug en développement : affiche le XML brut dans la console
  if (import.meta.env.DEV) {
    console.debug(`[prestaFetch] ${endpoint}\n`, xmlText.slice(0, 500));
  }

  // Parse XML → JS
  const parsed = parser.parse(xmlText);

  // Le root est toujours <prestashop>
  return parsed.prestashop || parsed;
}

// ─── Utilitaires de parsing ───────────────────────────────────

/**
 * Extrait la valeur d'un champ PrestaShop.
 * PrestaShop encapsule les valeurs dans CDATA ou directement.
 * Certains champs multi-langue sont des tableaux d'objets {language}.
 *
 * @param {*}      champ    - La valeur brute du champ PrestaShop
 * @param {number} langId   - ID de la langue à extraire (défaut: 1 = fr)
 * @returns {string}
 */
function extraireValeur(champ, langId = 1) {
  if (champ === undefined || champ === null) return '';

  // Champ simple (string, number)
  if (typeof champ === 'string' || typeof champ === 'number') {
    return String(champ);
  }

  // CDATA : { __cdata: "valeur" }
  if (champ.__cdata !== undefined) return String(champ.__cdata);

  // Champ multi-langue : { language: [ { @_id: 1, __cdata: "nom" } ] }
  if (champ.language) {
    const langues = Array.isArray(champ.language)
      ? champ.language
      : [champ.language];

    // Chercher la langue demandée, sinon prendre la première
    const langue =
      langues.find((l) => Number(l['@_id']) === langId) || langues[1];

    if (!langue) return '';
    if (langue.__cdata !== undefined) return String(langue.__cdata);
    if (langue['#text'] !== undefined) return String(langue['#text']);
    return String(langue);
  }

  return String(champ);
}

/**
 * Détermine le badge à afficher selon la date d'ajout du produit.
 * HOT   : produit ajouté il y a moins de 1 jour
 * NEW   : produit ajouté il y a moins de 7 jours
 * null  : pas de badge
 * 
 * @param {string} dateAdd - Date d'ajout au format ISO (ex: "2025-05-12 14:30:00")
 * @returns {string|null} "HOT", "NEW", ou null
 */
function getProductBadge(dateAdd) {
  if (!dateAdd) return null;

  const maintenant = new Date();
  const dateAjout = new Date(dateAdd);
  const diffMs = maintenant - dateAjout;
  const diffJours = diffMs / (1000 * 60 * 60 * 24);

  if (diffJours < 1) return 'HOT';
  if (diffJours < 7) return 'NEW';
  return null;
}

/**
 * Construit l'URL d'une image produit PrestaShop.
 * Les images sont servies directement par PrestaShop via le proxy Vite.
 * PAS de header Authorization : les balises <img> ne peuvent pas
 * envoyer de headers → on utilise le proxy pour masquer la clé.
 *
 * Format PrestaShop : /api/images/products/{id_produit}/{id_image}
 *
 * @param {number|string} idProduit
 * @param {number|string} idImage
 * @returns {string} URL relative (passera par le proxy Vite)
 */
// export function buildImageUrl(idProduit, idImage) {
//   return `/api/images/products/${idProduit}/${idImage}`;
// }

// ─── PRODUITS ─────────────────────────────────────────────────

/**
 * Récupère la liste complète des produits.
 * Inclut les images (première image de chaque produit).
 *
 * @returns {Promise<Array>} Liste de produits normalisés
 */
export async function getProducts() {
  const data = await prestaFetch('/products?display=full');
  const produits = data.products?.product || [];

  return produits.map((p) => ({
    id:        Number(extraireValeur(p.id)),
    reference: extraireValeur(p.reference),
    price:     parseFloat(extraireValeur(p.price) || 0),
    active:    extraireValeur(p.active) === '1',
    name:      extraireValeur(p.name),
    imageId:   extraireImageId(p),
    id_category_default: Number(extraireValeur(p.id_category_default)),
    // Nouvelles propriétés
    date_add:  extraireValeur(p.date_add),
    badge:     getProductBadge(extraireValeur(p.date_add)),
  }));
}

/**
 * Extrait l'ID de la première image d'un produit depuis le XML parsé.
 * Les associations/images sont imbriquées dans le XML PrestaShop.
 *
 * @param {Object} produit - Produit parsé
 * @returns {number|null}
 */
function extraireImageId(produit) {
  try {
    const images =
      produit.associations?.images?.image ||
      produit.associations?.images ||
      [];

    const liste = Array.isArray(images) ? images : [images];
    if (!liste.length) return null;

    const premier = liste[0];
    const id = premier.id || premier['@_id'] || premier.__cdata;
    return id ? Number(extraireValeur(id)) : null;
  } catch {
    return null;
  }
}


async function getProductStock(productId) {

  const data = await prestaFetch(
    `/stock_availables?filter[id_product]=${productId}&display=full`
  );

  const stocks =
    data.stock_availables?.stock_available || [];

  const list = Array.isArray(stocks)
    ? stocks
    : [stocks];

  // Ligne principale produit = id_product_attribute = 0
  const principal = list.find(
    (s) =>
      Number(extraireValeur(s.id_product_attribute)) === 0
  );

  return principal
    ? Number(extraireValeur(principal.quantity))
    : 0;
}


async function getCombinationStock(combinationId) {

  const data = await prestaFetch(
    `/stock_availables?filter[id_product_attribute]=${combinationId}&display=full`
  );

  const stocks =
    data.stock_availables?.stock_available || [];

  const list = Array.isArray(stocks)
    ? stocks
    : [stocks];

  if (!list.length) return 0;

  return Number(
    extraireValeur(list[0].quantity)
  );
}


/**
 * Récupère le détail complet d'un produit par son ID.
 * Inclut : infos de base, toutes les images, catégorie, combinaisons, description.
 *
 * @param {number|string} id - ID du produit PrestaShop
 * @returns {Promise<Object>} Produit normalisé complet
 */
export async function getProductById(id) {

  // Produit complet
  const data = await prestaFetch(`/products/${id}?display=full`);


  const product = data.product?.[0];
  const stock = await getProductStock(id);

  if (!product) {
    throw new Error("Produit introuvable");
  }

  // ─────────────────────────────────────
  // EXTRAIRE LES IMAGES
  // ─────────────────────────────────────

  const rawImages =
    product.associations?.images?.image || [];

  const imagesArray = Array.isArray(rawImages)
    ? rawImages
    : [rawImages];

  const images = imagesArray.map((img) => {

    const imageId =
      img.id?.__cdata ||
      img.id ||
      img['@_id'];

    return {
      id: Number(imageId),
      url: `/api/images/products/${id}/${imageId}`,
    };
  });

  // ─────────────────────────────────────
  // EXTRAIRE LES COMBINAISONS
  // ─────────────────────────────────────

  const rawCombis =
    product.associations?.combinations?.combination || [];

  const combinations = await Promise.all(
    (
      Array.isArray(rawCombis)
        ? rawCombis
        : [rawCombis]
    ).map(async (c) => {

      const combiId = Number(
        c.id?.__cdata || c.id
      );

      const combiData = await prestaFetch(
  `/combinations/${combiId}?display=full`
);

const combi =
  combiData.combination?.[0] ||
  combiData.combination;

return {
  id: combiId,

  reference:
    extraireValeur(combi.reference),

  // impact prix de la combinaison
  price: parseFloat(
    extraireValeur(combi.price) || 0
  ),

  quantity:
    await getCombinationStock(combiId),

  ean13:
    extraireValeur(combi.ean13),

  attributes:
    await enrichirCombinaison(combiId),
};
    })
  );


  // ─────────────────────────────────────
  // NOM / DESCRIPTION
  // ─────────────────────────────────────

  const langName =
    product.name?.language?.[0]?.__cdata ||
    "Sans nom";

  const shortDesc =
    product.description_short?.language?.[0]?.__cdata ||
    "";

  const fullDesc =
    product.description?.language?.[0]?.__cdata ||
    "";

  // ─────────────────────────────────────
  // RETOUR FINAL NORMALISÉ
  // ─────────────────────────────────────

  return {
    id: Number(product.id?.__cdata),
    name: langName,

    reference:
      product.reference?.__cdata || "",

    price: parseFloat(
      product.price?.__cdata || 0
    ),

    // Stock réel PrestaShop
    quantity:
      stock,



    condition:
      product.condition?.__cdata || "new",

    description_short: shortDesc,
    description: fullDesc,

    weight: parseFloat(
      product.weight?.__cdata || 0
    ),

    width: parseFloat(
      product.width?.__cdata || 0
    ),

    height: parseFloat(
      product.height?.__cdata || 0
    ),

    depth: parseFloat(
      product.depth?.__cdata || 0
    ),

    ean13:
      product.ean13?.__cdata || "",

    minimal_quantity: parseInt(
      product.minimal_quantity?.__cdata || 1
    ),

    date_add:
      product.date_add?.__cdata || null,

    images,
    combinations,
  };
}

/**
 * Récupère toutes les images d'un produit.
 * Retourne des objets { id, url } prêts à l'emploi.
 *
 * @param {number|string} idProduit
 * @returns {Promise<Array<{ id: number, url: string }>>}
 */
export async function getProductImages(productId) {

  try {

    const data = await prestaFetch(
      `/products/${productId}?display=full`
    );


    const images =
      data.product?.[0]?.associations?.images?.image || [];

    return images.map((img) => ({
      id: Number(img.id?.__cdata || img.id),
    }));

  } catch (err) {

    console.error(
      `[getProductImages] Produit ${productId}:`,
      err
    );

    return [];
  }
}


/**
 * Récupère les combinaisons (déclinaisons) d'un produit.
 * Ex : Taille S, M, L / Couleur Rouge, Bleu…
 *
 * @param {number|string} idProduit
 * @returns {Promise<Array>}
 */
export async function getProductCombinations(idProduit) {
  try {
    const data = await prestaFetch(`/combinations?filter[id_product]=${idProduit}&display=full`);
    const combis = data.combinations?.combination || [];
    const liste  = Array.isArray(combis) ? combis : [combis];

    return liste.map((c) => ({
      id:        Number(extraireValeur(c.id)),
      reference: extraireValeur(c.reference),
      price:     parseFloat(extraireValeur(c.price) || 0),  // Prix additionnel
      quantity:  Number(extraireValeur(c.quantity) || 0),
      ean13:     extraireValeur(c.ean13),
      // Les options (ex: "Taille: L") sont dans les associations
      options:   extraireOptionsCombinaison(c),
    }));
  } catch (err) {
    console.warn(`[getProductCombinations] Produit ${idProduit} :`, err.message);
    return [];
  }
}

/**
 * Extrait les options lisibles d'une combinaison.
 * @param {Object} combinaison - Combinaison parsée
 * @returns {string} Ex: "Taille: L, Couleur: Rouge"
 */
function extraireOptionsCombinaison(combinaison) {
  try {
    const opts =
      combinaison.associations?.product_option_values?.product_option_value || [];
    const liste = Array.isArray(opts) ? opts : [opts];
    // On retourne les IDs pour que le composant puisse les afficher
    return liste.map((o) => Number(extraireValeur(o.id))).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Récupère le nom lisible d'une option (product_option_value).
 * Ex: ID 123 → { id: 123, name: "M", id_attribute_group: 1 }
 */
async function getOptionValueName(optionValueId) {
  try {
    const data = await prestaFetch(
      `/product_option_values/${optionValueId}?display=full`
    );
    const optVal = data.product_option_value?.[0];
    if (!optVal) return null;
    
    return {
      id: Number(extraireValeur(optVal.id)),
      name: extraireValeur(optVal.name),
      id_attribute_group: Number(extraireValeur(optVal.id_attribute_group)),
    };
  } catch (err) {
    console.warn(`[getOptionValueName] Impossible de récupérer option ${optionValueId}:`, err.message);
    return null;
  }
}

/**
 * Récupère le nom d'un groupe d'attributs.
 * Ex: ID 1 → "Taille"
 */
async function getAttributeGroupName(groupId) {
  try {
    const data = await prestaFetch(
      `/product_options/${groupId}?display=full`
    );

    const group =
      data.product_option?.[0] ||
      data.product_option;

    if (!group) return null;

    return extraireValeur(group.name);

  } catch (err) {
    console.warn(
      `[getAttributeGroupName] Impossible de récupérer groupe ${groupId}:`,
      err.message
    );

    return null;
  }
}

/**
 * Enrichit une combinaison avec ses attributs structurés.
 * Récupère d'abord la combinaison complète via l'API.
 * Retourne : { "Taille": "M", "Couleur": "Bleu" }
 */
async function enrichirCombinaison(combiId) {
  try {
    // Récupérer les détails COMPLETS de la combinaison
    const data = await prestaFetch(`/combinations/${combiId}?display=full`);
    const combi = data.combination?.[0] || data.combinations?.combination?.[0];
    
    if (!combi) {
      console.warn(`[enrichirCombinaison] Combinaison ${combiId} introuvable`);
      return {};
    }
    
    
    const optionIds = extraireOptionsCombinaison(combi);
    
    const attributes = {};
    
    for (const optionId of optionIds) {
      const optionData = await getOptionValueName(optionId);
      
      if (optionData) {
        const groupName = await getAttributeGroupName(optionData.id_attribute_group);
        
        if (groupName) {
          attributes[groupName] = optionData.name;
        }
      }
    }
    
    return attributes;
  } catch (err) {
    console.warn(`[enrichirCombinaison] Erreur combinaison ${combiId}:`, err.message);
    return {};
  }
}

// ─── CATÉGORIES ───────────────────────────────────────────────

/**
 * Récupère une catégorie par son ID.
 *
 * @param {number|string} id
 * @returns {Promise<{ id: number, name: string }>}
 */
export async function getCategoryById(id) {
  const data = await prestaFetch(`/categories/${id}?display=full`);
  const c = data.categories?.category?.[0] || data.category;
  if (!c) throw new Error(`Catégorie #${id} introuvable`);
  return {
    id:   Number(extraireValeur(c.id)),
    name: extraireValeur(c.name),
  };
}

/**
 * Récupère toutes les catégories.
 *
 * @returns {Promise<Array<{ id: number, name: string }>>}
 */
export async function getCategories() {
  const data = await prestaFetch('/categories?display=[id,name]');
  const cats = data.categories?.category || [];
  return (Array.isArray(cats) ? cats : [cats]).map((c) => ({
    id:   Number(extraireValeur(c.id)),
    name: extraireValeur(c.name),
  }));
}


/**
 * Recherche les produits selon des critères multicritères.
 * Applique les filtres en côté client après récupération complète.
 * 
 * @param {Object} criteria - Critères de recherche
 * @param {string} criteria.searchTerm - Nom du produit (filtrage par texte)
 * @param {number|null} criteria.categoryId - ID de la catégorie
 * @param {number} criteria.minPrice - Prix minimum (inclus)
 * @param {number} criteria.maxPrice - Prix maximum (inclus)
 * @returns {Promise<Array>} Produits filtrés et normalisés
 */
export async function searchProducts(criteria = {}) {
  const {
    searchTerm = '',
    categoryId = null,
    minPrice = 0,
    maxPrice = Infinity,
  } = criteria;

  // Récupérer tous les produits
  const allProducts = await getProducts();

  // Appliquer les filtres
  return allProducts.filter((p) => {
    // Filtre 1 : Nom du produit (insensible à la casse)
    const matchName = searchTerm === '' || 
      p.name.toLowerCase().includes(searchTerm.toLowerCase());

    // Filtre 2 : Catégorie
    const matchCategory = categoryId === null || 
      p.id_category_default === Number(categoryId);

    // Filtre 3 : Intervalle de prix
    const matchPrice = p.price >= minPrice && p.price <= maxPrice;

    return matchName && matchCategory && matchPrice;
  });
}
