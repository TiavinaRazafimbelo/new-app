/**
 * cartApiService.js
 * ─────────────────────────────────────────────────────────────
 * Service dédié à la persistance du panier dans PrestaShop via l'API WS.
 *
 * RESPONSABILITÉS :
 *   - Créer un cart PS vide pour un client connecté
 *   - Mettre à jour les cart_rows (ajout / suppression / quantité)
 *   - Supprimer un cart PS
 *   - Récupérer un cart PS existant
 *
 * USAGE :
 *   Appelé par CartContext à chaque mutation du panier.
 *   Uniquement pour les clients connectés (customerId > 0).
 *   Les clients anonymes restent en localStorage jusqu'au checkout.
 *
 * RÈGLE PS : les produits s'ajoutent via PUT /carts/:id avec
 *   <associations><cart_rows>. Chaque PUT remplace TOUTES les lignes.
 *   → On envoie toujours la liste complète du panier courant.
 * ─────────────────────────────────────────────────────────────
 */

import { XMLParser } from 'fast-xml-parser';

const API_KEY  = import.meta.env.VITE_PRESTA_API_KEY;
const BASE_URL = '/api';

function authHeader() {
  return 'Basic ' + btoa(`${API_KEY}:`);
}

const parser = new XMLParser({
  ignoreAttributes:       false,
  attributeNamePrefix:    '@_',
  cdataPropName:          '__cdata',
  textNodeName:           '#text',
  parseAttributeValue:    true,
  allowBooleanAttributes: true,
  isArray: (tag) => ['cart', 'cart_row', 'customer', 'error'].includes(tag),
});

function extraire(champ) {
  if (champ === undefined || champ === null) return '';
  if (typeof champ === 'string' || typeof champ === 'number') return String(champ);
  if (champ.__cdata !== undefined) return String(champ.__cdata);
  if (champ['#text']  !== undefined) return String(champ['#text']);
  return String(champ);
}

async function psGet(endpoint) {
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    headers: { Authorization: authHeader(), Accept: 'application/xml' },
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`GET ${endpoint} → ${res.status}: ${txt.slice(0, 200)}`);
  }
  const xml    = await res.text();
  const parsed = parser.parse(xml);
  return parsed.prestashop || parsed;
}

async function psWrite(endpoint, xmlBody, method = 'POST') {
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    method,
    headers: {
      Authorization:  authHeader(),
      'Content-Type': 'application/xml',
      Accept:         'application/xml',
    },
    body: xmlBody,
  });
  const xml    = await res.text();
  if (!res.ok) throw new Error(`${method} ${endpoint} → ${res.status}: ${xml.slice(0, 300)}`);
  const parsed = parser.parse(xml);
  return parsed.prestashop || parsed;
}

// ─── Config shop ──────────────────────────────────────────────

const SHOP = {
  ID_SHOP:       1,
  ID_SHOP_GROUP: 1,
  ID_CURRENCY:   1,
  ID_LANG:       1,
  ID_CARRIER:    2,
};

// ─── Secure key ───────────────────────────────────────────────

async function getSecureKey(customerId) {
  const data = await psGet(`/customers/${customerId}`);
  const cust = data.customer?.[0] || data.customer;
  const key  = extraire(cust?.secure_key);
  if (!key || key.length !== 32) throw new Error(`secure_key invalide pour customer ${customerId}`);
  return key;
}

// ─── Adresse par défaut ───────────────────────────────────────

/**
 * Retourne l'ID de la première adresse active du client,
 * ou 0 si aucune adresse (le cart PS accepte id_address=0).
 */
async function getDefaultAddressId(customerId) {
  try {
    const data  = await psGet(`/addresses?filter[id_customer]=${customerId}&display=full`);
    const addrs = data.addresses?.address || [];
    const liste = Array.isArray(addrs) ? addrs : [addrs];
    const active = liste.find((a) => extraire(a.deleted) !== '1');
    return active ? Number(extraire(active.id)) : 0;
  } catch {
    return 0;
  }
}

// ─── XML helpers ─────────────────────────────────────────────

function buildCartXml({ cartId = null, customerId, addressId, secureKey, cartItems = [] }) {
  const rowsXml = cartItems.map((item) => `
        <cart_row>
          <id_product>${item.productId}</id_product>
          <id_product_attribute>${item.combinationId || 0}</id_product_attribute>
          <id_address_delivery>${addressId || 0}</id_address_delivery>
          <quantity>${item.quantity}</quantity>
        </cart_row>`).join('');

  const idTag        = cartId ? `<id>${cartId}</id>` : '';
  const assocTag     = cartItems.length > 0
    ? `<associations><cart_rows>${rowsXml}</cart_rows></associations>`
    : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<prestashop xmlns:xlink="http://www.w3.org/1999/xlink">
  <cart>
    ${idTag}
    <id_shop_group>${SHOP.ID_SHOP_GROUP}</id_shop_group>
    <id_shop>${SHOP.ID_SHOP}</id_shop>
    <id_address_delivery>${addressId || 0}</id_address_delivery>
    <id_address_invoice>${addressId || 0}</id_address_invoice>
    <id_currency>${SHOP.ID_CURRENCY}</id_currency>
    <id_lang>${SHOP.ID_LANG}</id_lang>
    <id_customer>${customerId}</id_customer>
    <id_carrier>${SHOP.ID_CARRIER}</id_carrier>
    <recyclable>0</recyclable>
    <gift>0</gift>
    <gift_message></gift_message>
    <mobile_theme>0</mobile_theme>
    <delivery_option></delivery_option>
    <secure_key>${secureKey}</secure_key>
    <allow_seperated_package>0</allow_seperated_package>
    ${assocTag}
  </cart>
</prestashop>`;
}

// ─── API publique ─────────────────────────────────────────────

/**
 * Crée un cart vide dans PrestaShop pour un client connecté.
 * @param {number} customerId
 * @returns {Promise<{ cartId: number, secureKey: string }>}
 */
export async function createPsCart(customerId) {
  const [secureKey, addressId] = await Promise.all([
    getSecureKey(customerId),
    getDefaultAddressId(customerId),
  ]);

  const xml    = buildCartXml({ customerId, addressId, secureKey });
  const result = await psWrite('/carts', xml, 'POST');
  const cart   = result.cart?.[0] || result.cart;
  const cartId = Number(extraire(cart?.id));

  if (!cartId) throw new Error('[cartApiService] Cart PS non créé');
  console.log('[cartApiService] Cart PS créé :', cartId);
  return { cartId, secureKey, addressId };
}

/**
 * Met à jour les cart_rows d'un cart PS existant.
 * Envoie TOUJOURS la liste complète (PUT remplace tout).
 *
 * @param {number}   cartId
 * @param {number}   customerId
 * @param {Array}    cartItems  - liste complète des articles [{productId, combinationId, quantity}]
 * @param {string}   secureKey
 * @param {number}   addressId
 */
export async function updatePsCartRows(cartId, customerId, cartItems, secureKey, addressId) {
  const xml = buildCartXml({ cartId, customerId, addressId, secureKey, cartItems });
  await psWrite(`/carts/${cartId}`, xml, 'PUT');
  console.log('[cartApiService] Cart PS mis à jour :', cartId, `(${cartItems.length} lignes)`);
}

/**
 * Supprime un cart PS (ne pas appeler si une commande en dépend).
 * Utilisé au clearCart ou logout.
 */
export async function deletePsCart(cartId) {
  try {
    const res = await fetch(`${BASE_URL}/carts/${cartId}`, {
      method:  'DELETE',
      headers: { Authorization: authHeader() },
    });
    if (res.ok) {
      console.log('[cartApiService] Cart PS supprimé :', cartId);
    } else {
      // PS refuse la suppression si le cart est lié à une commande (contrainte FK) — normal
      console.log(`[cartApiService] Cart PS ${cartId} conservé en base (lié à une commande ou protégé)`);
    }
  } catch (err) {
    console.warn('[cartApiService] deletePsCart (non-bloquant):', err.message);
  }
}

/**
 * Récupère le dernier cart PS actif d'un client (non associé à une commande).
 * Utile pour retrouver le cartId après un rechargement de page.
 *
 * @param {number} customerId
 * @returns {Promise<number|null>} cartId ou null
 */
export async function getActivePsCartId(customerId) {
  try {
    const data  = await psGet(`/carts?filter[id_customer]=${customerId}&display=full`);
    const carts = data.carts?.cart || [];
    const liste = Array.isArray(carts) ? carts : [carts];

    if (!liste.length) return null;

    // Récupérer les IDs de carts déjà liés à une commande
    const ordersData = await psGet(`/orders?filter[id_customer]=${customerId}&display=[id_cart]`);
    const orders     = ordersData.orders?.order || [];
    const ordersList = Array.isArray(orders) ? orders : [orders];
    const usedCartIds = new Set(ordersList.map((o) => Number(extraire(o.id_cart))));

    // Trouver le premier cart non utilisé (du plus récent au plus ancien)
    const sorted = [...liste].sort(
      (a, b) => Number(extraire(b.id)) - Number(extraire(a.id))
    );
    const active = sorted.find((c) => !usedCartIds.has(Number(extraire(c.id))));
    return active ? Number(extraire(active.id)) : null;
  } catch (err) {
    console.warn('[cartApiService] getActivePsCartId:', err.message);
    return null;
  }
}