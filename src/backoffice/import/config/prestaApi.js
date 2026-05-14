/**
 * prestaApi.js
 * Client HTTP partagé pour tous les modules d'import.
 * Gère l'auth, le parsing XML et les erreurs PrestaShop.
 */

import { XMLParser } from 'fast-xml-parser';

const API_KEY  = import.meta.env.VITE_PRESTA_API_KEY;
const BASE_URL = '/api';

const parser = new XMLParser({
  ignoreAttributes:       false,
  attributeNamePrefix:    '@_',
  cdataPropName:          '__cdata',
  textNodeName:           '#text',
  parseAttributeValue:    true,
  allowBooleanAttributes: true,
  isArray: (tag) => [
    'order', 'order_row', 'order_state', 'address', 'cart', 'cart_row',
    'product', 'stock_available', 'customer', 'category', 'combination',
    'product_option', 'product_option_value', 'image', 'error',
    'tax_rule_group', 'attribute', 'attribute_group',
  ].includes(tag),
});

function getAuthHeader() {
  return 'Basic ' + btoa(`${API_KEY}:`);
}

export function extraireValeur(champ, langId = 1) {
  if (champ === undefined || champ === null) return '';
  if (typeof champ === 'string' || typeof champ === 'number') return String(champ);
  if (champ.__cdata !== undefined) return String(champ.__cdata);
  if (champ.language) {
    const langues = Array.isArray(champ.language) ? champ.language : [champ.language];
    const langue  = langues.find((l) => Number(l['@_id']) === langId) || langues[0];
    if (!langue) return '';
    if (langue.__cdata !== undefined) return String(langue.__cdata);
    if (langue['#text'] !== undefined) return String(langue['#text']);
  }
  return String(champ);
}

/**
 * GET vers l'API PrestaShop
 */
export async function prestaGet(endpoint) {
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    headers: { Authorization: getAuthHeader(), Accept: 'application/xml' },
  });

  const xml = await res.text();
  if (!res.ok) throw new Error(`GET ${endpoint} -> ${res.status}: ${xml.slice(0, 200)}`);

  const parsed = parser.parse(xml);
  return parsed.prestashop || parsed;
}

/**
 * POST ou PUT vers l'API PrestaShop
 * Retourne { hookError: true } si HTTP 500 causé uniquement par des hooks deprecated
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

  const xml = await res.text();

  if (!res.ok) {
    // Detecter erreur hook deprecated (gamification) = non bloquant
    try {
      const parsed = parser.parse(xml);
      const errors = parsed?.prestashop?.errors?.error || [];
      const liste  = Array.isArray(errors) ? errors : [errors];
      const tousHooks = liste.length > 0 && liste.every(
        (e) => String(extraireValeur(e?.code)) === '15'
      );
      if (tousHooks && method === 'POST') {
        console.warn(`[prestaWrite] ${method} ${endpoint} -> Hook deprecated (non bloquant)`);
        return { hookError: true };
      }
    } catch (_) {}

    throw new Error(`${method} ${endpoint} -> ${res.status}: ${xml.slice(0, 300)}`);
  }

  const parsed = parser.parse(xml);
  return parsed.prestashop || parsed;
}

/**
 * Upload d'une image produit (multipart/form-data)
 */
export async function prestaUploadImage(productId, file) {
  const formData = new FormData();
  formData.append('image', file, file.name);

  const res = await fetch(`${BASE_URL}/images/products/${productId}`, {
    method: 'POST',
    headers: { Authorization: getAuthHeader() },
    body: formData,
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Image upload produit ${productId} -> ${res.status}: ${txt.slice(0, 200)}`);
  }

  return true;
}
