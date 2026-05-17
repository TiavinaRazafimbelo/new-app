/**
 * prestaApi.js
 * src/backoffice/import/config/prestaApi.js
 * ─────────────────────────────────────────────────────────────
 * Fonctions utilitaires pour communiquer avec l'API Web Services
 * de PrestaShop 8.2.6.
 *
 * Toutes les requêtes passent par le proxy Vite (/api).
 * Authentification : Basic Auth avec VITE_PRESTA_API_KEY.
 * Format : XML (l'API PS ne supporte pas JSON nativement).
 * ─────────────────────────────────────────────────────────────
 */

import { XMLParser, XMLBuilder } from 'fast-xml-parser';

const API_KEY  = import.meta.env.VITE_PRESTA_API_KEY;
const BASE_URL = '/api';

// ─── Auth ─────────────────────────────────────────────────────

export function getAuthHeader() {
  return 'Basic ' + btoa(`${API_KEY}:`);
}

// ─── Parser XML (lecture) ─────────────────────────────────────

export const xmlParser = new XMLParser({
  ignoreAttributes:       false,
  attributeNamePrefix:    '@_',
  cdataPropName:          '__cdata',
  textNodeName:           '#text',
  parseAttributeValue:    true,
  allowBooleanAttributes: true,
  // Ces tags peuvent apparaître plusieurs fois → toujours en tableau
  isArray: (tagName) => [
    'product', 'category', 'tax_rule', 'tax_rule_group',
    'language', 'image', 'combination', 'product_option',
    'product_option_value', 'stock_available', 'specific_price',
  ].includes(tagName),
});

// ─── Extraction de valeur depuis un champ parsé ───────────────

/**
 * Extrait la valeur d'un champ PrestaShop, qu'il soit :
 *   - une chaîne simple
 *   - un objet CDATA { __cdata: "valeur" }
 *   - un objet multilingue { language: [{ @_id: 1, __cdata: "valeur" }] }
 *
 * @param {*}      champ  - champ brut issu du parser XML
 * @param {number} langId - ID de langue (1 = français/défaut)
 * @returns {string}
 */
export function extraireVal(champ, langId = 1) {
  if (champ === undefined || champ === null) return '';
  if (typeof champ === 'string' || typeof champ === 'number') return String(champ);
  if (champ.__cdata !== undefined) return String(champ.__cdata);
  if (champ['#text'] !== undefined) return String(champ['#text']);
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

// ─── GET ──────────────────────────────────────────────────────

/**
 * Requête GET vers l'API PrestaShop.
 * Retourne l'objet parsé depuis le XML de réponse.
 *
 * @param {string} endpoint - ex: '/products?display=full'
 * @returns {Promise<Object>} - objet prestashop parsé
 * @throws {Error} si la réponse HTTP n'est pas ok
 */
export async function prestaGet(endpoint) {
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    headers: {
      Authorization: getAuthHeader(),
      Accept:        'application/xml',
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GET ${endpoint} → HTTP ${res.status}: ${text.slice(0, 300)}`);
  }

  const xml    = await res.text();
  const parsed = xmlParser.parse(xml);
  return parsed.prestashop || parsed;
}

// ─── POST / PUT ───────────────────────────────────────────────

/**
 * Requête POST ou PUT vers l'API PrestaShop avec un body XML.
 * Retourne l'objet parsé depuis le XML de réponse.
 *
 * @param {string} endpoint    - ex: '/products'
 * @param {string} xmlBody     - XML complet à envoyer
 * @param {'POST'|'PUT'} method
 * @returns {Promise<Object>}
 * @throws {Error} si la réponse HTTP n'est pas ok
 */
export async function prestaWrite(endpoint, xmlBody, method = 'POST') {
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    method,
    headers: {
      Authorization:  getAuthHeader(),
      'Content-Type': 'application/xml',
      Accept:         'application/xml',
    },
    body: xmlBody,
  });

  const text = await res.text();

  if (!res.ok) {
    // Extraire le message d'erreur PrestaShop s'il existe
    const msgMatch = text.match(/<message><!\[CDATA\[(.*?)\]\]><\/message>/);
    const msg = msgMatch ? msgMatch[1] : text.slice(0, 300);
    throw new Error(`${method} ${endpoint} → HTTP ${res.status}: ${msg}`);
  }

  const parsed = xmlParser.parse(text);
  return parsed.prestashop || parsed;
}

// ─── Upload image ─────────────────────────────────────────────

/**
 * Upload une image pour un produit via multipart/form-data.
 * Endpoint : POST /api/images/products/:productId
 *
 * @param {number} productId
 * @param {File|Blob} imageFile
 * @returns {Promise<Object>} réponse parsée
 * @throws {Error}
 */
export async function prestaUploadImage(productId, imageFile) {
  const formData = new FormData();
  formData.append('image', imageFile);

  const res = await fetch(`${BASE_URL}/images/products/${productId}`, {
    method: 'POST',
    headers: {
      Authorization: getAuthHeader(),
      // Ne pas définir Content-Type : le navigateur le fait avec le boundary
    },
    body: formData,
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Upload image produit ${productId} → HTTP ${res.status}: ${text.slice(0, 200)}`);
  }

  const parsed = xmlParser.parse(text);
  return parsed.prestashop || parsed;
}

// ─── Récupération du schéma vide (synopsis) ──────────────────

/**
 * Récupère le schéma XML vide d'une ressource PrestaShop.
 * Utile pour connaître tous les champs disponibles.
 * Exemple : prestaGetSchema('products') → XML du schéma produit vide
 *
 * @param {string} resource - ex: 'products', 'categories'
 * @returns {Promise<string>} XML brut du schéma
 */
export async function prestaGetSchema(resource) {
  const res = await fetch(`${BASE_URL}/${resource}?schema=synopsis`, {
    headers: {
      Authorization: getAuthHeader(),
      Accept:        'application/xml',
    },
  });

  if (!res.ok) throw new Error(`Schéma ${resource} → HTTP ${res.status}`);
  return res.text();
}
