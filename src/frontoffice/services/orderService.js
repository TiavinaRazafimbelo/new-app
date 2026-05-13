/**
 * orderService.js
 * Service de gestion des commandes PrestaShop.
 *
 * CORRECTIONS APPLIQUEES :
 *   FIX #1 : PAYMENT_MODULE = 'ps_cashondelivery' (pas 'cod')
 *   FIX #2 : PAYMENT_LABEL  = 'CashOnDelivery' (format isGenericName)
 *   FIX #3 : order_rows en lecture seule => on les SUPPRIME du POST /orders
 *            PrestaShop les calcule lui-meme depuis le cart
 *   FIX #4 : total_paid_real = totalTTC (pas 0)
 *   FIX #5 : secure_key recuperee depuis le customer (pas generee aleatoirement)
 *   FIX #6 : invites => creation d'un customer guest PrestaShop (is_guest=1)
 *            pour avoir une secure_key valide et un id_customer reel
 */

import { XMLParser, XMLBuilder } from 'fast-xml-parser';

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
};

// ─── Configuration API ────────────────────────────────────────

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
     'cart_row', 'product', 'stock_available', 'customer'].includes(tagName),
});

const builder = new XMLBuilder({
  ignoreAttributes:    false,
  attributeNamePrefix: '@_',
  cdataPropName:       '__cdata',
  format:              true,
});

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
    throw new Error(`[prestaFetch] ${endpoint} -> HTTP ${response.status}: ${text.slice(0, 300)}`);
  }

  const xmlText = await response.text();

  if (import.meta.env.DEV) {
    console.debug(`[prestaFetch] ${endpoint}\n`, xmlText.slice(0, 300));
  }

  const parsed = parser.parse(xmlText);
  return parsed.prestashop || parsed;
}

async function prestaWrite(endpoint, xmlBody, method = 'POST') {
  const response = await fetch(`${BASE_URL}${endpoint}`, {
    method,
    headers: {
      Authorization:  getAuthHeader(),
      'Content-Type': 'application/xml',
      Accept:         'application/xml',
    },
    body: xmlBody,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`[prestaWrite] ${method} ${endpoint} -> HTTP ${response.status}: ${text}`);
  }

  const xmlText = await response.text();
  const parsed  = parser.parse(xmlText);
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
    if (langue['#text'] !== undefined) return String(langue['#text']);
  }
  return String(champ);
}

function genererMd5Aleatoire() {
  return Array.from({ length: 32 }, () =>
    Math.floor(Math.random() * 16).toString(16)
  ).join('');
}

// ─── SECURE KEY (client connecte) ────────────────────────────

/**
 * Recupere la secure_key d'un client connecte.
 *
 * POURQUOI : PrestaShop verifie que cart.secure_key === customer.secure_key
 * lors de la creation de l'Order. Une cle aleatoire provoque HTTP 500
 * "Secure key does not match".
 *
 * @param {number|string} customerId
 * @returns {Promise<string>} secure_key MD5 (32 hex)
 */
async function getCustomerSecureKey(customerId) {
  const data     = await prestaFetch(`/customers/${customerId}`);
  const customer = data.customer?.[0] || data.customer;
  const key      = extraireValeur(customer?.secure_key);

  if (!key || key.length !== 32) {
    throw new Error(`[getCustomerSecureKey] secure_key invalide pour customer ${customerId}: "${key}"`);
  }

  console.log('[orderService] secure_key recuperee pour customer', customerId);
  return key;
}

// ─── CUSTOMER GUEST ───────────────────────────────────────────

/**
 * Cree un customer "invite" (is_guest=1) dans PrestaShop.
 *
 * POURQUOI : On ne peut pas utiliser id_customer=0 avec une cle aleatoire.
 * PrestaShop verifie toujours que cart.secure_key === customer.secure_key.
 * La seule solution pour un anonyme est de creer un vrai customer guest,
 * puis de recuperer sa secure_key generee par PrestaShop.
 *
 * @param {Object} guestData - { email, firstname, lastname }
 * @returns {Promise<{guestId: number, secureKey: string}>}
 */
async function createGuestCustomer(guestData) {
  // Mot de passe fictif requis par l'API (non utilise pour la connexion)
  const passwd = genererMd5Aleatoire();

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

  if (!guestId) throw new Error('[createGuestCustomer] ID guest non recupere');
  if (!key || key.length !== 32) throw new Error('[createGuestCustomer] secure_key invalide pour le guest cree');

  console.log('[orderService] Customer guest cree, ID:', guestId);
  return { guestId, secureKey: key };
}

// ─── ADRESSES ─────────────────────────────────────────────────

export async function getCustomerAddresses(customerId) {
  try {
    const data = await prestaFetch(
      `/addresses?filter[id_customer]=${customerId}&display=full`
    );

    const addresses = data.addresses?.address || [];
    const liste     = Array.isArray(addresses) ? addresses : [addresses];

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
    <lastname><![CDATA[${addressData.lastname}]]></lastname>
    <firstname><![CDATA[${addressData.firstname}]]></firstname>
    <address1><![CDATA[${addressData.address1}]]></address1>
    <address2><![CDATA[${addressData.address2 || ''}]]></address2>
    <postcode><![CDATA[${addressData.postcode}]]></postcode>
    <city><![CDATA[${addressData.city}]]></city>
    <phone><![CDATA[${addressData.phone || ''}]]></phone>
    <phone_mobile><![CDATA[${addressData.phone_mobile || ''}]]></phone_mobile>
    <active>1</active>
    <deleted>0</deleted>
  </address>
</prestashop>`;

  const result  = await prestaWrite('/addresses', xmlBody, 'POST');
  const address = result.address?.[0] || result.address;
  const newId   = Number(extraireValeur(address?.id));

  if (!newId) throw new Error("[createAddress] Impossible de recuperer l'ID de l'adresse creee");

  console.log('[orderService] Adresse creee, ID:', newId);
  return newId;
}

export async function updateAddress(addressId, customerId, addressData) {
  const xmlBody = `<?xml version="1.0" encoding="UTF-8"?>
<prestashop xmlns:xlink="http://www.w3.org/1999/xlink">
  <address>
    <id>${addressId}</id>
    <id_customer>${customerId}</id_customer>
    <id_country>${ORDER_CONFIG.ID_COUNTRY_FRANCE}</id_country>
    <alias><![CDATA[${addressData.alias || 'Mon adresse'}]]></alias>
    <lastname><![CDATA[${addressData.lastname}]]></lastname>
    <firstname><![CDATA[${addressData.firstname}]]></firstname>
    <address1><![CDATA[${addressData.address1}]]></address1>
    <address2><![CDATA[${addressData.address2 || ''}]]></address2>
    <postcode><![CDATA[${addressData.postcode}]]></postcode>
    <city><![CDATA[${addressData.city}]]></city>
    <phone><![CDATA[${addressData.phone || ''}]]></phone>
    <phone_mobile><![CDATA[${addressData.phone_mobile || ''}]]></phone_mobile>
    <active>1</active>
    <deleted>0</deleted>
  </address>
</prestashop>`;

  await prestaWrite(`/addresses/${addressId}`, xmlBody, 'PUT');
  console.log('[orderService] Adresse mise a jour, ID:', addressId);
}

// ─── CART PRESTASHOP ──────────────────────────────────────────

/**
 * Cree un panier PrestaShop cote serveur.
 *
 * @param {number} customerId - ID customer reel (guest ou connecte)
 * @param {number} addressId
 * @param {string} secureKey  - Doit etre identique a customer.secure_key
 * @returns {Promise<number>} ID du cart cree
 */
async function createPrestaCart(customerId, addressId, secureKey) {
  const xmlBody = `<?xml version="1.0" encoding="UTF-8"?>
<prestashop xmlns:xlink="http://www.w3.org/1999/xlink">
  <cart>
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
    <delivery_option><![CDATA[{"${addressId}":"${ORDER_CONFIG.ID_CARRIER},"}]]></delivery_option>
    <secure_key>${secureKey}</secure_key>
    <allow_seperated_package>0</allow_seperated_package>
  </cart>
</prestashop>`;

  const result = await prestaWrite('/carts', xmlBody, 'POST');
  const cart   = result.cart?.[0] || result.cart;
  const cartId = Number(extraireValeur(cart?.id));

  if (!cartId) throw new Error('[createPrestaCart] Cart ID non recupere');

  console.log('[orderService] Cart PrestaShop cree, ID:', cartId);
  return cartId;
}

// ─── AJOUT PRODUITS AU PANIER ────────────────────────────────

async function addProductToCart(cartId, item, addressId) {
  const xmlBody = `<?xml version="1.0" encoding="UTF-8"?>
<prestashop>
  <cart_row>
    <id_product>${item.productId}</id_product>
    <id_product_attribute>${item.combinationId || 0}</id_product_attribute>
    <id_address_delivery>${addressId}</id_address_delivery>
    <id_currency>${ORDER_CONFIG.ID_CURRENCY}</id_currency>
    <id_lang>${ORDER_CONFIG.ID_LANG}</id_lang>
    <quantity>${item.quantity}</quantity>
  </cart_row>
</prestashop>`;

  return await prestaWrite(`/carts/${cartId}/associations/cart_rows`, xmlBody, 'POST');
}

// ─── STOCKS ───────────────────────────────────────────────────

async function getStockAvailableInfo(productId, combinationId = 0) {
  const filter = combinationId > 0
    ? `filter[id_product_attribute]=${combinationId}`
    : `filter[id_product]=${productId}&filter[id_product_attribute]=0`;

  const data   = await prestaFetch(`/stock_availables?${filter}&display=full`);
  const stocks = data.stock_availables?.stock_available || [];
  const liste  = Array.isArray(stocks) ? stocks : [stocks];

  if (!liste.length) {
    console.warn(`[getStockAvailableInfo] Pas de stock pour produit ${productId} combi ${combinationId}`);
    return { stockId: null, currentQty: 0 };
  }

  const stock = liste[0];
  return {
    stockId:    Number(extraireValeur(stock.id)),
    currentQty: Number(extraireValeur(stock.quantity)),
  };
}

async function decrementStock(productId, combinationId, quantiteCommandee) {
  try {
    const { stockId, currentQty } = await getStockAvailableInfo(productId, combinationId);

    if (!stockId) {
      console.warn(`[decrementStock] Pas de stockId pour produit ${productId}`);
      return;
    }

    const newQty = Math.max(0, currentQty - quantiteCommandee);

    const xmlBody = `<?xml version="1.0" encoding="UTF-8"?>
<prestashop xmlns:xlink="http://www.w3.org/1999/xlink">
  <stock_available>
    <id>${stockId}</id>
    <id_product>${productId}</id_product>
    <id_product_attribute>${combinationId || 0}</id_product_attribute>
    <quantity>${newQty}</quantity>
    <depends_on_stock>0</depends_on_stock>
    <out_of_stock>2</out_of_stock>
  </stock_available>
</prestashop>`;

    await prestaWrite(`/stock_availables/${stockId}`, xmlBody, 'PUT');
    console.log(`[orderService] Stock : produit ${productId} combi ${combinationId} -> ${currentQty} - ${quantiteCommandee} = ${newQty}`);
  } catch (err) {
    // Ne pas bloquer la commande si la mise a jour stock echoue
    console.error(`[decrementStock] Erreur produit ${productId}:`, err.message);
  }
}

// ─── ORDER ────────────────────────────────────────────────────

/**
 * Cree la commande PrestaShop complete.
 *
 * ETAPES :
 *   1. Resoudre le customer : connecte => getCustomerSecureKey
 *                             invite   => createGuestCustomer (is_guest=1)
 *   2. Creer l'adresse
 *   3. Calculer les totaux
 *   4. Creer le Cart (avec la secure_key du customer)
 *   5. Creer l'Order SANS associations (PS les calcule depuis le cart)
 *   6. Decrementer les stocks
 *
 * @param {Object}             params
 * @param {number|string|null} params.customerId        - ID client connecte (null si invite)
 * @param {Object|null}        params.guestData         - { email, firstname, lastname } si invite
 * @param {Array}              params.cartItems         - Articles du panier local
 * @param {Object}             params.addressData       - Donnees adresse
 * @param {number|null}        params.existingAddressId - ID adresse existante si deja creee
 *
 * @returns {Promise<{orderId: number, orderReference: string}>}
 */
export async function createFullOrder({
  customerId,
  guestData,
  cartItems,
  addressData,
  existingAddressId = null,
}) {
  console.log('[orderService] Debut creation commande', { customerId, guestData, cartItems });

  // Etape 1 : Customer et secure_key
  //
  // Client connecte : on recupere sa secure_key depuis PrestaShop.
  // Invite         : on cree un customer guest (is_guest=1) pour obtenir
  //                  un vrai id_customer et une secure_key valide.
  //                  id_customer=0 avec cle aleatoire => HTTP 500.
  let effectiveCustomerId;
  let secureKey;

  if (customerId) {
    // Client connecte
    effectiveCustomerId = Number(customerId);
    secureKey           = await getCustomerSecureKey(effectiveCustomerId);
  } else {
    // Invite
    if (!guestData?.email) {
      throw new Error('[createFullOrder] guestData.email requis pour une commande en tant qu\'invite');
    }
    const { guestId, secureKey: guestKey } = await createGuestCustomer(guestData);
    effectiveCustomerId = guestId;
    secureKey           = guestKey;
  }

  console.log('[orderService] effectiveCustomerId:', effectiveCustomerId, '| secureKey OK');

  // Etape 2 : Adresse
  let addressId = existingAddressId;

  if (!addressId) {
    const addrData = guestData
      ? { ...addressData, firstname: guestData.firstname, lastname: guestData.lastname }
      : addressData;

    addressId = await createAddress(effectiveCustomerId, addrData);
  }

  // Etape 3 : Totaux
  const totalProduits = cartItems.reduce(
    (sum, item) => sum + item.price * item.quantity, 0
  );
  const totalTTC = totalProduits + ORDER_CONFIG.SHIPPING_COST;

 // Etape 4 : Cart
const cartId = await createPrestaCart(
  effectiveCustomerId,
  addressId,
  secureKey
);

await Promise.all(
  cartItems.map(item =>
    addProductToCart(cartId, item, addressId)
  )
);

// Verification debug
const verification = await prestaFetch(`/carts/${cartId}`);

console.log(
  '[orderService] Cart verification:',
  verification
);

// Etape 5 : Order

// Etape 5 : Order


  // Etape 5 : Order
  //
  // FIX #3 : Le bloc <associations><order_rows> est SUPPRIME du POST.
  // PrestaShop 8 ne supporte pas les order_rows en ecriture directe via l'API
  // (virtualEntity=true dans le synopsis). Les details de commande sont crees
  // automatiquement par PrestaShop a partir du cart lie (id_cart).
  // Envoyer les associations provoque un HTTP 500 ou les ignore silencieusement.
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
    <total_products_wt>${totalProduits.toFixed(6)}</total_products_wt>
    <total_shipping>${ORDER_CONFIG.SHIPPING_COST.toFixed(6)}</total_shipping>
    <total_shipping_tax_incl>${ORDER_CONFIG.SHIPPING_COST.toFixed(6)}</total_shipping_tax_incl>
    <total_shipping_tax_excl>${ORDER_CONFIG.SHIPPING_COST.toFixed(6)}</total_shipping_tax_excl>
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

  const resultOrder = await prestaWrite('/orders', xmlOrder, 'POST');
  const order       = resultOrder.order?.[0] || resultOrder.order;
  const orderId     = Number(extraireValeur(order?.id));
  const orderRef    = extraireValeur(order?.reference);

  if (!orderId) {
    throw new Error("[createFullOrder] Impossible de recuperer l'ID de la commande creee");
  }

  console.log('[orderService] Commande creee, ID:', orderId, 'Ref:', orderRef);

  // Etape 6 : Stocks
  await Promise.allSettled(
    cartItems.map((item) =>
      decrementStock(item.productId, item.combinationId || 0, item.quantity)
    )
  );

  return { orderId, orderReference: orderRef };
}

// ─── RECUPERATION COMMANDES ───────────────────────────────────

export async function getCustomerOrders(customerId) {
  try {
    const data = await prestaFetch(
      `/orders?filter[id_customer]=${customerId}&display=full&sort=[date_add_DESC]`
    );

    const orders = data.orders?.order || [];
    const liste  = Array.isArray(orders) ? orders : [orders];

    return liste.map((o) => ({
      id:            Number(extraireValeur(o.id)),
      reference:     extraireValeur(o.reference),
      date_add:      extraireValeur(o.date_add),
      total_paid:    parseFloat(extraireValeur(o.total_paid) || 0),
      current_state: Number(extraireValeur(o.current_state)),
      payment:       extraireValeur(o.payment),
      rows:          normaliserLignesCommande(o.associations?.order_rows?.order_row),
    }));
  } catch (err) {
    console.error('[getCustomerOrders]', err.message);
    return [];
  }
}

function normaliserLignesCommande(rows) {
  if (!rows) return [];
  const liste = Array.isArray(rows) ? rows : [rows];
  return liste.map((r) => ({
    productId:   Number(extraireValeur(r.product_id)),
    productName: extraireValeur(r.product_name),
    quantity:    Number(extraireValeur(r.product_quantity)),
    unitPrice:   parseFloat(extraireValeur(r.unit_price_tax_incl) || 0),
    totalPrice:  parseFloat(extraireValeur(r.total_price_tax_incl) || 0),
  }));
}

export async function getOrderStates() {
  try {
    const data   = await prestaFetch('/order_states?display=full');
    const states = data.order_states?.order_state || [];
    const liste  = Array.isArray(states) ? states : [states];

    return liste.map((s) => ({
      id:    Number(extraireValeur(s.id)),
      name:  extraireValeur(s.name),
      color: extraireValeur(s.color) || '#666',
    }));
  } catch (err) {
    console.warn('[getOrderStates]', err.message);
    return [
      { id: 1, name: 'En attente de paiement', color: '#FF8C00' },
      { id: 2, name: 'Paiement accepte',        color: '#32CD32' },
      { id: 3, name: 'En cours de preparation', color: '#4169E1' },
      { id: 4, name: 'Expedie',                 color: '#9932CC' },
      { id: 5, name: 'Livre',                   color: '#228B22' },
      { id: 6, name: 'Annule',                  color: '#DC143C' },
      { id: 7, name: 'Rembourse',               color: '#808080' },
    ];
  }
}