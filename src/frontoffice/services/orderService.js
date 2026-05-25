/**
 * orderService.js — v4
 * ─────────────────────────────────────────────────────────────
 * NOUVEAUTÉ v4 :
 *
 *   Le cart PS est maintenant créé/mis à jour en temps réel par CartContext
 *   dès que l'utilisateur modifie son panier (client connecté).
 *
 *   createFullOrder reçoit désormais un paramètre optionnel `existingCartId` :
 *     - Si fourni (client connecté) → on réutilise ce cart PS, pas de recréation.
 *     - Si absent (guest/anon)     → on crée le cart comme avant.
 *
 *   Le reste du flux est identique :
 *     Étape 1 : Customer & secure_key
 *     Étape 2 : Adresse
 *     Étape 3 : Cart (réutilisé OU créé si guest)
 *     Étape 4 : POST /orders
 *     Étape 5 : Forcer statut via order_histories
 * ─────────────────────────────────────────────────────────────
 */

import { XMLParser } from 'fast-xml-parser';

// ─── Configuration commande ───────────────────────────────────

export const ORDER_CONFIG = {
  DEFAULT_ORDER_STATE: 2,
  PAYMENT_MODULE:      'ps_cashondelivery',
  PAYMENT_LABEL:       'CashOnDelivery',
  SHIPPING_COST:       0,
  ID_COUNTRY_FRANCE:   8,
  ID_CARRIER:          2,
  ID_LANG:             1,
  ID_CURRENCY:         1,
  ID_SHOP:             1,
  ID_SHOP_GROUP:       1,
};

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
    ['order', 'order_row', 'order_state', 'address', 'cart',
     'cart_row', 'product', 'stock_available', 'customer', 'error'].includes(tagName),
});

// ─── Fetch helpers ────────────────────────────────────────────

async function prestaFetch(endpoint) {
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    headers: { Authorization: getAuthHeader(), Accept: 'application/xml' },
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`GET ${endpoint} → ${res.status}: ${txt.slice(0, 300)}`);
  }
  const xml    = await res.text();
  const parsed = parser.parse(xml);
  return parsed.prestashop || parsed;
}

async function prestaWrite(endpoint, xmlBody, method = 'POST', context = {}) {
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    method,
    headers: {
      Authorization:  getAuthHeader(),
      'Content-Type': 'application/xml',
      Accept:         'application/xml',
    },
    body: xmlBody,
  });

  const xmlText = await res.text();

  if (res.ok) {
    const parsed = parser.parse(xmlText);
    return parsed.prestashop || parsed;
  }

  // HTTP 500 sur POST /orders → tentative de récupération via fallback
  if (endpoint === '/orders' && method === 'POST') {
    let ps = {};
    try { ps = parser.parse(xmlText)?.prestashop || {}; } catch (_) {}

    const orderInError = ps?.order?.[0] || ps?.order;
    const idInError    = orderInError ? Number(extraireValeur(orderInError?.id)) : 0;
    if (idInError > 0) {
      console.warn(`[prestaWrite] HTTP 500 mais order ID ${idInError} présent. Poursuite.`);
      return ps;
    }

    if (context.cartId) {
      try {
        const fb     = await prestaFetch(`/orders?filter[id_cart]=${context.cartId}&display=full`);
        const orders = fb.orders?.order || [];
        const liste  = Array.isArray(orders) ? orders : [orders];
        if (liste.length > 0) return { order: liste };
      } catch (fbErr) {
        console.error('[prestaWrite] Fallback GET échoué:', fbErr.message);
      }
    }

    throw new Error(`POST /orders HTTP 500: ${xmlText.slice(0, 400)}`);
  }

  throw new Error(`${method} ${endpoint} → ${res.status}: ${xmlText.slice(0, 400)}`);
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
    if (langue['#text'] !== undefined) return String(langue['#text']);
  }
  return String(champ);
}

function genererMd5Aleatoire() {
  return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
}

// ─── Secure key ───────────────────────────────────────────────

async function getCustomerSecureKey(customerId) {
  const data = await prestaFetch(`/customers/${customerId}`);
  const cust = data.customer?.[0] || data.customer;
  const key  = extraireValeur(cust?.secure_key);
  if (!key || key.length !== 32) throw new Error(`secure_key invalide pour customer ${customerId}`);
  return key;
}

// ─── Guest customer ───────────────────────────────────────────

async function createGuestCustomer(guestData) {
  const passwd  = genererMd5Aleatoire();
  const xmlBody = `<?xml version="1.0" encoding="UTF-8"?>
<prestashop xmlns:xlink="http://www.w3.org/1999/xlink">
  <customer>
    <email><![CDATA[${guestData.email}]]></email>
    <firstname><![CDATA[${guestData.firstname}]]></firstname>
    <lastname><![CDATA[${guestData.lastname}]]></lastname>
    <passwd><![CDATA[${passwd}]]></passwd>
    <is_guest>1</is_guest>
    <active>1</active>
    <deleted>0</deleted>
  </customer>
</prestashop>`;

  const result   = await prestaWrite('/customers', xmlBody, 'POST');
  const customer = result.customer?.[0] || result.customer;
  const guestId  = Number(extraireValeur(customer?.id));
  const key      = extraireValeur(customer?.secure_key);

  if (!guestId) throw new Error('[createGuestCustomer] ID non récupéré');
  if (!key || key.length !== 32) throw new Error('[createGuestCustomer] secure_key invalide');
  return { guestId, secureKey: key };
}

// ─── Adresses ─────────────────────────────────────────────────

export async function getCustomerAddresses(customerId) {
  try {
    const data  = await prestaFetch(`/addresses?filter[id_customer]=${customerId}&display=full`);
    const addrs = data.addresses?.address || [];
    const liste = Array.isArray(addrs) ? addrs : [addrs];
    return liste
      .filter((a) => extraireValeur(a.deleted) !== '1')
      .map((a) => ({
        id:           Number(extraireValeur(a.id)),
        alias:        extraireValeur(a.alias),
        firstname:    extraireValeur(a.firstname),
        lastname:     extraireValeur(a.lastname),
        address1:     extraireValeur(a.address1),
        address2:     extraireValeur(a.address2),
        postcode:     extraireValeur(a.postcode),
        city:         extraireValeur(a.city),
        phone:        extraireValeur(a.phone),
        phone_mobile: extraireValeur(a.phone_mobile),
        id_country:   Number(extraireValeur(a.id_country)),
      }));
  } catch (err) {
    console.warn('[getCustomerAddresses]', err.message);
    return [];
  }
}

export async function createAddress(customerId, addressData) {
  const xmlBody = `<?xml version="1.0" encoding="UTF-8"?>
<prestashop xmlns:xlink="http://www.w3.org/1999/xlink">
  <address>
    <id_customer>${customerId}</id_customer>
    <id_country>${ORDER_CONFIG.ID_COUNTRY_FRANCE}</id_country>
    <alias><![CDATA[${addressData.alias || 'Mon adresse'}]]></alias>
    <lastname><![CDATA[${addressData.lastname || ''}]]></lastname>
    <firstname><![CDATA[${addressData.firstname || ''}]]></firstname>
    <address1><![CDATA[${addressData.address1 || ''}]]></address1>
    <address2><![CDATA[${addressData.address2 || ''}]]></address2>
    <postcode><![CDATA[${addressData.postcode || ''}]]></postcode>
    <city><![CDATA[${addressData.city || ''}]]></city>
    <phone><![CDATA[${addressData.phone || ''}]]></phone>
    <phone_mobile><![CDATA[${addressData.phone_mobile || ''}]]></phone_mobile>
    <active>1</active>
    <deleted>0</deleted>
  </address>
</prestashop>`;

  const result  = await prestaWrite('/addresses', xmlBody, 'POST');
  const address = result.address?.[0] || result.address;
  const newId   = Number(extraireValeur(address?.id));
  if (!newId) throw new Error('[createAddress] ID non récupéré');
  return newId;
}

// ─── Cart (pour guests uniquement) ───────────────────────────

async function createGuestCart(customerId, addressId, secureKey, cartItems) {
  const rowsXml = cartItems.map((item) => `
      <cart_row>
        <id_product>${item.productId}</id_product>
        <id_product_attribute>${item.combinationId || 0}</id_product_attribute>
        <id_address_delivery>${addressId}</id_address_delivery>
        <quantity>${item.quantity}</quantity>
      </cart_row>`).join('');

  const xmlCreate = `<?xml version="1.0" encoding="UTF-8"?>
<prestashop xmlns:xlink="http://www.w3.org/1999/xlink">
  <cart>
    <id_shop_group>${ORDER_CONFIG.ID_SHOP_GROUP}</id_shop_group>
    <id_shop>${ORDER_CONFIG.ID_SHOP}</id_shop>
    <id_address_delivery>${addressId}</id_address_delivery>
    <id_address_invoice>${addressId}</id_address_invoice>
    <id_currency>${ORDER_CONFIG.ID_CURRENCY}</id_currency>
    <id_lang>${ORDER_CONFIG.ID_LANG}</id_lang>
    <id_customer>${customerId}</id_customer>
    <id_carrier>${ORDER_CONFIG.ID_CARRIER}</id_carrier>
    <recyclable>0</recyclable>
    <gift>0</gift>
    <gift_message></gift_message>
    <mobile_theme>0</mobile_theme>
    <delivery_option></delivery_option>
    <secure_key>${secureKey}</secure_key>
    <allow_seperated_package>0</allow_seperated_package>
  </cart>
</prestashop>`;

  const resultCreate = await prestaWrite('/carts', xmlCreate, 'POST');
  const cartCreated  = resultCreate.cart?.[0] || resultCreate.cart;
  const cartId       = Number(extraireValeur(cartCreated?.id));
  if (!cartId) throw new Error('[createGuestCart] Cart ID non récupéré');

  // Ajout des produits via PUT
  const xmlUpdate = `<?xml version="1.0" encoding="UTF-8"?>
<prestashop xmlns:xlink="http://www.w3.org/1999/xlink">
  <cart>
    <id>${cartId}</id>
    <id_shop_group>${ORDER_CONFIG.ID_SHOP_GROUP}</id_shop_group>
    <id_shop>${ORDER_CONFIG.ID_SHOP}</id_shop>
    <id_address_delivery>${addressId}</id_address_delivery>
    <id_address_invoice>${addressId}</id_address_invoice>
    <id_currency>${ORDER_CONFIG.ID_CURRENCY}</id_currency>
    <id_lang>${ORDER_CONFIG.ID_LANG}</id_lang>
    <id_customer>${customerId}</id_customer>
    <id_carrier>${ORDER_CONFIG.ID_CARRIER}</id_carrier>
    <recyclable>0</recyclable>
    <gift>0</gift>
    <gift_message></gift_message>
    <mobile_theme>0</mobile_theme>
    <delivery_option></delivery_option>
    <secure_key>${secureKey}</secure_key>
    <allow_seperated_package>0</allow_seperated_package>
    <associations>
      <cart_rows>${rowsXml}</cart_rows>
    </associations>
  </cart>
</prestashop>`;

  await prestaWrite(`/carts/${cartId}`, xmlUpdate, 'PUT');
  return cartId;
}

// ─── Mise à jour adresse de livraison sur le cart ─────────────

/**
 * Met à jour l'adresse de livraison d'un cart PS existant.
 * Nécessaire quand le client connecté choisit/crée une adresse au checkout
 * (le cart a été créé avant avec addressId=0 ou l'adresse par défaut).
 */
async function updateCartAddress(cartId, customerId, addressId, secureKey) {
  // Lire le cart actuel pour avoir toutes les associations
  const data = await prestaFetch(`/carts/${cartId}?display=full`);
  const cart = data.cart?.[0] || data.cart;
  if (!cart) return;

  const rawRows = cart.associations?.cart_rows?.cart_row || [];
  const rows    = Array.isArray(rawRows) ? rawRows : [rawRows];

  const rowsXml = rows.map((r) => `
      <cart_row>
        <id_product>${extraireValeur(r.id_product)}</id_product>
        <id_product_attribute>${extraireValeur(r.id_product_attribute)}</id_product_attribute>
        <id_address_delivery>${addressId}</id_address_delivery>
        <quantity>${extraireValeur(r.quantity)}</quantity>
      </cart_row>`).join('');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<prestashop xmlns:xlink="http://www.w3.org/1999/xlink">
  <cart>
    <id>${cartId}</id>
    <id_shop_group>${ORDER_CONFIG.ID_SHOP_GROUP}</id_shop_group>
    <id_shop>${ORDER_CONFIG.ID_SHOP}</id_shop>
    <id_address_delivery>${addressId}</id_address_delivery>
    <id_address_invoice>${addressId}</id_address_invoice>
    <id_currency>${ORDER_CONFIG.ID_CURRENCY}</id_currency>
    <id_lang>${ORDER_CONFIG.ID_LANG}</id_lang>
    <id_customer>${customerId}</id_customer>
    <id_carrier>${ORDER_CONFIG.ID_CARRIER}</id_carrier>
    <recyclable>0</recyclable>
    <gift>0</gift>
    <gift_message></gift_message>
    <mobile_theme>0</mobile_theme>
    <delivery_option></delivery_option>
    <secure_key>${secureKey}</secure_key>
    <allow_seperated_package>0</allow_seperated_package>
    <associations>
      <cart_rows>${rowsXml}</cart_rows>
    </associations>
  </cart>
</prestashop>`;

  await prestaWrite(`/carts/${cartId}`, xml, 'PUT');
  console.log(`[orderService] Adresse du cart ${cartId} mise à jour → ${addressId}`);
}

// ─── Statut commande ──────────────────────────────────────────

async function forcerStatutViaHistorique(orderId, newState) {
  const xmlHistory = `<?xml version="1.0" encoding="UTF-8"?>
<prestashop xmlns:xlink="http://www.w3.org/1999/xlink">
  <order_history>
    <id_order>${orderId}</id_order>
    <id_order_state>${newState}</id_order_state>
  </order_history>
</prestashop>`;
  try {
    await prestaWrite('/order_histories', xmlHistory, 'POST');
    console.log(`[orderService] Statut forcé à ${newState} pour order ${orderId}`);
  } catch (err) {
    console.warn('[orderService] forcerStatutViaHistorique (non-bloquant):', err.message);
  }
}

// ─── CRÉER COMMANDE COMPLÈTE ──────────────────────────────────

/**
 * @param {Object} params
 * @param {number}      params.customerId          - 0 si guest
 * @param {Object|null} params.guestData           - { email, firstname, lastname } si guest
 * @param {Array}       params.cartItems           - articles du panier
 * @param {Object}      params.addressData         - données adresse saisies
 * @param {number|null} params.existingAddressId   - ID adresse PS si déjà existante
 * @param {number|null} params.existingCartId      - ID cart PS si déjà créé (client connecté)
 *
 * @returns {Promise<{ orderId: number, orderReference: string }>}
 */
export async function createFullOrder({
  customerId,
  guestData,
  cartItems,
  addressData,
  existingAddressId = null,
  existingCartId    = null,   // ← NOUVEAU : cartId déjà persisté par CartContext
}) {
  console.log('[orderService] Début création commande', {
    customerId,
    isGuest:        !!guestData,
    nbArticles:     cartItems.length,
    existingCartId,
  });

  // ── Étape 1 : Customer & secure_key ──────────────────────
  let effectiveCustomerId;
  let secureKey;

  if (customerId) {
    effectiveCustomerId = Number(customerId);
    secureKey           = await getCustomerSecureKey(effectiveCustomerId);
  } else {
    if (!guestData?.email) throw new Error('guestData.email requis');
    const { guestId, secureKey: guestKey } = await createGuestCustomer(guestData);
    effectiveCustomerId = guestId;
    secureKey           = guestKey;
  }

  // ── Étape 2 : Adresse ─────────────────────────────────────
  let addressId = existingAddressId;
  if (!addressId) {
    const addrData = guestData
      ? { ...addressData, firstname: guestData.firstname, lastname: guestData.lastname }
      : addressData;
    addressId = await createAddress(effectiveCustomerId, addrData);
  }

  // ── Étape 3 : Cart ────────────────────────────────────────
  let cartId;

  if (existingCartId) {
    // Client connecté : cart déjà créé et synchronisé par CartContext
    // Il suffit de mettre à jour l'adresse (qui n'était pas connue avant)
    cartId = existingCartId;
    await updateCartAddress(cartId, effectiveCustomerId, addressId, secureKey);
    console.log('[orderService] Cart PS existant réutilisé :', cartId);
  } else {
    // Guest/anonyme : créer le cart maintenant
    cartId = await createGuestCart(effectiveCustomerId, addressId, secureKey, cartItems);
    console.log('[orderService] Cart PS guest créé :', cartId);
  }

  // ── Étape 4 : Totaux ──────────────────────────────────────
  const totalProduits = cartItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const totalTTC      = totalProduits;

  // ── Étape 5 : POST /orders ────────────────────────────────
  const xmlOrder = `<?xml version="1.0" encoding="UTF-8"?>
<prestashop xmlns:xlink="http://www.w3.org/1999/xlink">
  <order>
    <id_address_delivery>${addressId}</id_address_delivery>
    <id_address_invoice>${addressId}</id_address_invoice>
    <id_cart>${cartId}</id_cart>
    <id_currency>${ORDER_CONFIG.ID_CURRENCY}</id_currency>
    <id_lang>${ORDER_CONFIG.ID_LANG}</id_lang>
    <id_customer>${effectiveCustomerId}</id_customer>
    <id_carrier>${ORDER_CONFIG.ID_CARRIER}</id_carrier>
    <id_shop_group>${ORDER_CONFIG.ID_SHOP_GROUP}</id_shop_group>
    <id_shop>${ORDER_CONFIG.ID_SHOP}</id_shop>
    <current_state>${ORDER_CONFIG.DEFAULT_ORDER_STATE}</current_state>
    <module><![CDATA[${ORDER_CONFIG.PAYMENT_MODULE}]]></module>
    <invoice_date>0000-00-00 00:00:00</invoice_date>
    <delivery_date>0000-00-00 00:00:00</delivery_date>
    <valid>1</valid>
    <payment><![CDATA[${ORDER_CONFIG.PAYMENT_LABEL}]]></payment>
    <total_discounts>0.000000</total_discounts>
    <total_discounts_tax_incl>0.000000</total_discounts_tax_incl>
    <total_discounts_tax_excl>0.000000</total_discounts_tax_excl>
    <total_paid>${totalTTC.toFixed(6)}</total_paid>
    <total_paid_tax_incl>${totalTTC.toFixed(6)}</total_paid_tax_incl>
    <total_paid_tax_excl>${totalProduits.toFixed(6)}</total_paid_tax_excl>
    <total_paid_real>${totalTTC.toFixed(6)}</total_paid_real>
    <total_products>${totalProduits.toFixed(6)}</total_products>
    <total_products_wt>${totalTTC.toFixed(6)}</total_products_wt>
    <total_shipping>0.000000</total_shipping>
    <total_shipping_tax_incl>0.000000</total_shipping_tax_incl>
    <total_shipping_tax_excl>0.000000</total_shipping_tax_excl>
    <carrier_tax_rate>0.000000</carrier_tax_rate>
    <total_wrapping>0.000000</total_wrapping>
    <total_wrapping_tax_incl>0.000000</total_wrapping_tax_incl>
    <total_wrapping_tax_excl>0.000000</total_wrapping_tax_excl>
    <round_mode>2</round_mode>
    <round_type>1</round_type>
    <conversion_rate>1.000000</conversion_rate>
    <gift>0</gift>
    <recyclable>0</recyclable>
  </order>
</prestashop>`;

  const resultOrder = await prestaWrite('/orders', xmlOrder, 'POST', { cartId });
  const order       = resultOrder.order?.[0] || resultOrder.order;
  const orderId     = Number(extraireValeur(order?.id));
  const orderRef    = extraireValeur(order?.reference);

  if (!orderId) throw new Error('[createFullOrder] ID commande non récupéré');
  console.log('[orderService] ✓ Commande créée, ID:', orderId, '| Ref:', orderRef);

  // ── Étape 6 : Forcer statut ───────────────────────────────
  await forcerStatutViaHistorique(orderId, ORDER_CONFIG.DEFAULT_ORDER_STATE);

  return { orderId, orderReference: orderRef };
}

// ─── Récupération commandes ───────────────────────────────────

export async function getCustomerOrders(customerId) {
  try {
    const data   = await prestaFetch('/orders?display=full');
    const orders = data.orders?.order || [];
    const liste  = Array.isArray(orders) ? orders : [orders];

    return liste
      .filter((o) => Number(extraireValeur(o.id_customer)) === Number(customerId))
      .map((o) => ({
        id:            Number(extraireValeur(o.id)),
        reference:     extraireValeur(o.reference),
        date_add:      extraireValeur(o.date_add),
        total_paid:    parseFloat(extraireValeur(o.total_paid) || 0),
        current_state: Number(extraireValeur(o.current_state)),
        payment:       extraireValeur(o.payment),
        rows:          normaliserLignesCommande(o.associations?.order_rows?.order_row),
      }))
      .sort((a, b) => new Date(b.date_add) - new Date(a.date_add));
  } catch (err) {
    console.error('[getCustomerOrders]', err.message);
    return [];
  }
}

function normaliserLignesCommande(rows) {
  if (!rows) return [];
  const liste = Array.isArray(rows) ? rows : [rows];
  return liste.map((r) => {
    const qty              = Number(extraireValeur(r.product_quantity)) || 0;
    const unitPrice        = parseFloat(extraireValeur(r.unit_price_tax_incl) || 0);
    const totalFromAPI     = parseFloat(extraireValeur(r.total_price_tax_incl) || 0);
    const productId        = Number(extraireValeur(r.product_id));
    const attributeId      = Number(extraireValeur(r.product_attribute_id)) || 0;
    
    // Si PrestaShop retourne un total_price_tax_incl, l'utiliser (plus fiable)
    // Sinon le calculer à partir du prix unitaire et de la quantité
    const totalPrice = totalFromAPI > 0 
      ? totalFromAPI 
      : Math.round(unitPrice * qty * 100) / 100;

    return {
      productId,
      productAttributeId: attributeId,  // ID de la combinaison (0 si produit simple)
      productName:        extraireValeur(r.product_name),
      quantity:           qty,
      unitPrice,
      totalPrice,
    };
  });
}

export async function getOrderStates() {
  try {
    const data   = await prestaFetch('/order_states?display=full');
    const states = data.order_states?.order_state || [];
    const liste  = Array.isArray(states) ? states : [states];
    return liste.map((s) => ({
      id:    Number(extraireValeur(s.id)),
      name:  extraireValeur(s.name, 2) || extraireValeur(s.name, 1),
      color: extraireValeur(s.color) || '#666',
    }));
  } catch {
    return [
      { id: 2, name: 'Paiement accepté',        color: '#3498D8' },
      { id: 3, name: 'En cours de préparation',  color: '#3498D8' },
      { id: 4, name: 'Expédié',                  color: '#01B887' },
      { id: 5, name: 'Livré',                    color: '#01B887' },
      { id: 6, name: 'Annulé',                   color: '#2C3E50' },
    ];
  }
}

// ─── Duplication de commande ──────────────────────────────────

export async function duplicateOrder(order, customerId, duplicateCount = 1) {
  if (!order || !order.rows || order.rows.length === 0) {
    throw new Error('Commande invalide ou sans articles');
  }

  // Transformer les rows en cartItems avec quantités multipliées
  // Attention : productAttributeId de PrestaShop → combinationId pour le cartService
  const cartItems = order.rows.map((row) => ({
    productId:    row.productId,
    combinationId: row.productAttributeId || 0,  // product_attribute_id en cartService
    name:         row.productName,
    quantity:     row.quantity * duplicateCount,
    price:        row.unitPrice,
  }));

  console.log('[duplicateOrder] Création nouvelle commande', {
    orderId:         order.id,
    duplicateCount,
    nbArticles:      cartItems.length,
    customerId,
    cartItems,
  });

  // Récupérer les adresses du client
  const addresses = await getCustomerAddresses(customerId);
  if (!addresses || addresses.length === 0) {
    throw new Error('Aucune adresse trouvée pour ce client');
  }

  // Utiliser la première adresse (ou on pourrait proposer un choix)
  const addressData = addresses[0];
  const existingAddressId = addressData.id;

  // Créer la nouvelle commande
  const result = await createFullOrder({
    customerId,
    cartItems,
    addressData,
    existingAddressId,
  });

  return result;
}