/**
 * orderService.js — v3
 * ─────────────────────────────────────────────────────────────
 * CORRECTIONS v3 :
 *
 *   FIX STOCK : La décrémentation était doublée.
 *     Cause : decrementStock était appelée avec combinationId=0 ET combinationId=X
 *     pour le même produit, ce qui mettait à jour le stock "base" (id_product_attribute=0)
 *     deux fois. Désormais, on ne décrémente QUE le stock de la combinaison
 *     si elle existe (id_product_attribute > 0), ou QUE le stock de base sinon.
 *
 *   FIX SOUS-TOTAUX : normaliserLignesCommande calculait total_price_tax_incl
 *     qui n'existe pas dans les order_rows de l'API PrestaShop.
 *     → On calcule le total = unit_price_tax_incl × product_quantity côté JS.
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
  ID_CARRIER:          0,
  ID_LANG:             1,
  ID_CURRENCY:         1,
  ID_SHOP:             1,
  ID_SHOP_GROUP:       1,
};

// ─── Config API ───────────────────────────────────────────────

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

// ─── Fetch ────────────────────────────────────────────────────

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
  if (import.meta.env.DEV) console.debug(`[prestaFetch] ${endpoint}\n`, xmlText.slice(0, 500));
  const parsed = parser.parse(xmlText);
  return parsed.prestashop || parsed;
}

async function prestaWrite(endpoint, xmlBody, method = 'POST', context = {}) {
  if (import.meta.env.DEV) console.debug(`[prestaWrite] ${method} ${endpoint}\n`, xmlBody.slice(0, 600));

  const response = await fetch(`${BASE_URL}${endpoint}`, {
    method,
    headers: {
      Authorization:  getAuthHeader(),
      'Content-Type': 'application/xml',
      Accept:         'application/xml',
    },
    body: xmlBody,
  });

  const xmlText = await response.text();
  if (import.meta.env.DEV) console.debug(`[prestaWrite] response HTTP ${response.status}\n`, xmlText.slice(0, 600));

  if (response.ok) {
    const parsed = parser.parse(xmlText);
    return parsed.prestashop || parsed;
  }

  // HTTP 500 sur POST /orders → tentative de récupération via fallback
  if (endpoint === '/orders' && method === 'POST') {
    let ps;
    try { ps = (parser.parse(xmlText))?.prestashop || parser.parse(xmlText); } catch (_) { ps = {}; }

    const errors  = ps?.errors?.error || [];
    const errList = Array.isArray(errors) ? errors : [errors];
    errList.forEach((e) => console.warn(`[prestaWrite] PS error: ${extraireValeur(e?.message)}`));

    const orderInError = ps?.order?.[0] || ps?.order;
    const idInError    = orderInError ? Number(extraireValeur(orderInError?.id)) : 0;
    if (idInError > 0) {
      console.warn(`[prestaWrite] HTTP 500 mais order ID ${idInError} trouvé. Poursuite.`);
      return ps;
    }

    if (context.cartId) {
      console.warn(`[prestaWrite] Fallback GET /orders?filter[id_cart]=${context.cartId}`);
      try {
        const fb     = await prestaFetch(`/orders?filter[id_cart]=${context.cartId}&display=full`);
        const orders = fb.orders?.order || [];
        const liste  = Array.isArray(orders) ? orders : [orders];
        if (liste.length > 0) {
          console.warn(`[prestaWrite] Commande retrouvée via fallback. ID=${extraireValeur(liste[0]?.id)}`);
          return { order: liste };
        }
      } catch (fbErr) {
        console.error('[prestaWrite] Fallback GET échoué:', fbErr.message);
      }
    }

    throw new Error(`[prestaWrite] POST /orders HTTP 500 irrecuperable: ${xmlText.slice(0, 400)}`);
  }

  throw new Error(`[prestaWrite] ${method} ${endpoint} -> HTTP ${response.status}: ${xmlText.slice(0, 400)}`);
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

// ─── SECURE KEY ───────────────────────────────────────────────

async function getCustomerSecureKey(customerId) {
  const data     = await prestaFetch(`/customers/${customerId}`);
  const customer = data.customer?.[0] || data.customer;
  const key      = extraireValeur(customer?.secure_key);
  if (!key || key.length !== 32) throw new Error(`secure_key invalide pour customer ${customerId}`);
  return key;
}

// ─── GUEST CUSTOMER ───────────────────────────────────────────

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

  if (!guestId) throw new Error('[createGuestCustomer] ID guest non récupéré');
  if (!key || key.length !== 32) throw new Error('[createGuestCustomer] secure_key invalide');

  console.log('[orderService] Customer guest créé, ID:', guestId);
  return { guestId, secureKey: key };
}

// ─── ADRESSES ─────────────────────────────────────────────────

export async function getCustomerAddresses(customerId) {
  try {
    const data      = await prestaFetch(`/addresses?filter[id_customer]=${customerId}&display=full`);
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
  if (!newId) throw new Error("[createAddress] ID adresse non récupéré");
  console.log('[orderService] Adresse créée, ID:', newId);
  return newId;
}

// ─── CART ─────────────────────────────────────────────────────

async function createPrestaCartWithProducts(customerId, addressId, secureKey, cartItems) {
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
  if (!cartId) throw new Error('[createPrestaCartWithProducts] Cart ID non récupéré');
  console.log('[orderService] Cart créé, ID:', cartId);

  const cartRowsXml = cartItems.map((item) => `
      <cart_row>
        <id_product>${item.productId}</id_product>
        <id_product_attribute>${item.combinationId || 0}</id_product_attribute>
        <id_address_delivery>${addressId}</id_address_delivery>
        <quantity>${item.quantity}</quantity>
      </cart_row>`).join('\n');

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
      <cart_rows>
        ${cartRowsXml}
      </cart_rows>
    </associations>
  </cart>
</prestashop>`;

  await prestaWrite(`/carts/${cartId}`, xmlUpdate, 'PUT');
  console.log('[orderService] Produits ajoutés au cart', cartId);
  return cartId;
}

// ─── STOCKS ───────────────────────────────────────────────────

/**
 * FIX STOCK : Récupère les infos de stock pour décrémentation.
 *
 * Règle importante :
 *   - Si combinationId > 0 → on cherche UNIQUEMENT le stock de la combinaison
 *     (id_product_attribute = combinationId)
 *   - Si combinationId = 0 → on cherche UNIQUEMENT le stock du produit de base
 *     (id_product_attribute = 0)
 *
 * AVANT (bug) : on cherchait filter[id_product]=X et on prenait le 1er résultat,
 * ce qui pouvait être le stock de la combinaison OU le stock du produit de base,
 * causant une double décrémentation quand les deux étaient mis à jour.
 */
async function getStockInfo(productId, combinationId) {
  let filter;

  if (combinationId > 0) {
    // Stock spécifique à la combinaison
    filter = `filter[id_product]=${productId}&filter[id_product_attribute]=${combinationId}`;
  } else {
    // Stock du produit sans combinaison (id_product_attribute = 0)
    filter = `filter[id_product]=${productId}&filter[id_product_attribute]=0`;
  }

  const data   = await prestaFetch(`/stock_availables?${filter}&display=full`);
  const stocks = data.stock_availables?.stock_available || [];
  const liste  = Array.isArray(stocks) ? stocks : [stocks];

  if (!liste.length) {
    console.warn(`[getStockInfo] Pas de stock pour produit ${productId} combi ${combinationId}`);
    return { stockId: null, currentQty: 0 };
  }

  const stock = liste[0];
  return {
    stockId:    Number(extraireValeur(stock.id)),
    currentQty: Number(extraireValeur(stock.quantity)),
    productId:  Number(extraireValeur(stock.id_product)),
    combiId:    Number(extraireValeur(stock.id_product_attribute)),
  };
}

/**
 * Décrémente le stock d'UN seul enregistrement stock_available.
 *
 * FIX : On ne décrémente QUE le stock ciblé (combinaison OU produit de base),
 * jamais les deux pour le même article commandé.
 */
async function decrementStock(productId, combinationId, quantiteCommandee) {
  try {
    const { stockId, currentQty, combiId } = await getStockInfo(productId, combinationId);

    if (!stockId) {
      console.warn(`[decrementStock] Pas de stockId pour produit ${productId} combi ${combinationId}`);
      return;
    }

    const newQty  = Math.max(0, currentQty - quantiteCommandee);
    const xmlBody = `<?xml version="1.0" encoding="UTF-8"?>
<prestashop xmlns:xlink="http://www.w3.org/1999/xlink">
  <stock_available>
    <id>${stockId}</id>
    <id_product>${productId}</id_product>
    <id_product_attribute>${combiId}</id_product_attribute>
    <quantity>${newQty}</quantity>
    <depends_on_stock>0</depends_on_stock>
    <out_of_stock>2</out_of_stock>
  </stock_available>
</prestashop>`;

    await prestaWrite(`/stock_availables/${stockId}`, xmlBody, 'PUT');
    console.log(
      `[orderService] Stock produit ${productId} combi ${combiId}: ${currentQty} → ${newQty} (-${quantiteCommandee})`
    );
  } catch (err) {
    console.error(`[decrementStock] Erreur produit ${productId} combi ${combinationId}:`, err.message);
  }
}

// ─── ORDER_HISTORIES ──────────────────────────────────────────

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
    console.log(`[orderService] Statut forcé à ${newState} pour commande ${orderId}`);
  } catch (err) {
    console.warn(`[orderService] forcerStatutViaHistorique (non-bloquant):`, err.message);
  }
}

// ─── ORDER_PAYMENTS ───────────────────────────────────────────

async function enregistrerPaiement(orderReference, montant) {
  const xmlPayment = `<?xml version="1.0" encoding="UTF-8"?>
<prestashop xmlns:xlink="http://www.w3.org/1999/xlink">
  <order_payment>
    <order_reference><![CDATA[${orderReference}]]></order_reference>
    <id_currency>${ORDER_CONFIG.ID_CURRENCY}</id_currency>
    <amount>${montant.toFixed(6)}</amount>
    <payment_method><![CDATA[${ORDER_CONFIG.PAYMENT_LABEL}]]></payment_method>
    <conversion_rate>1.000000</conversion_rate>
    <transaction_id></transaction_id>
    <card_number></card_number>
    <card_brand></card_brand>
    <card_expiration></card_expiration>
    <card_holder></card_holder>
  </order_payment>
</prestashop>`;

  try {
    await prestaWrite('/order_payments', xmlPayment, 'POST');
    console.log(`[orderService] Paiement enregistré pour ref ${orderReference}, montant=${montant}`);
  } catch (err) {
    console.warn(`[orderService] enregistrerPaiement (non-bloquant):`, err.message);
  }
}

// ─── CRÉER COMMANDE COMPLÈTE ──────────────────────────────────
// ─── PATCH orderService.js ────────────────────────────────────
//
// Remplace UNIQUEMENT la fonction createFullOrder.
//
// PROBLÈMES IDENTIFIÉS via MySQL :
//
//   1. Triple ligne dans ps_order_payment (total affiché = 160.61 au lieu de 45.89) :
//      - PrestaShop insère automatiquement une ligne order_payment lors du POST /orders
//      - Le module ps_cashondelivery en insère une deuxième lors du changement de statut
//      - Notre enregistrerPaiement() en ajoutait une troisième
//      FIX : supprimer l'appel à enregistrerPaiement()
//
//   2. Montant incohérent (57.36 au lieu de 45.89) :
//      - On envoyait cartItems.price qui est en TTC (×1.2 appliqué dans productsService)
//      - PrestaShop stocke ses prix en HT et recalcule lui-même la TVA
//      - Le montant TTC du frontoffice ne correspond pas au montant HT PrestaShop
//      FIX : envoyer les montants tels que PrestaShop les retourne (depuis ses propres
//            prix, pas nos prix TTC recalculés)
//
//   3. Stock décrémenté 2× (corrigé dans le patch précédent) :
//      FIX : supprimer l'appel à decrementStock()
//
// RÉSULTAT : createFullOrder ne fait que créer le cart + l'order + forcer le statut.
// PrestaShop gère lui-même les payments et les stocks.
// ─────────────────────────────────────────────────────────────

export async function createFullOrder({
  customerId,
  guestData,
  cartItems,
  addressData,
  existingAddressId = null,
}) {
  console.log('[orderService] Début création commande', {
    customerId,
    isGuest: !!guestData,
    nbArticles: cartItems.length,
  });

  // ── Étape 1 : Customer & secure_key ──────────────────────
  let effectiveCustomerId;
  let secureKey;

  if (customerId) {
    effectiveCustomerId = Number(customerId);
    secureKey           = await getCustomerSecureKey(effectiveCustomerId);
  } else {
    if (!guestData?.email) throw new Error('guestData.email requis pour commande invité');
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

  // ── Étape 3 : Totaux ──────────────────────────────────────
  //
  // On envoie les totaux calculés depuis les prix du panier (TTC côté frontoffice).
  // PrestaShop les écrasera de toute façon avec ses propres calculs depuis le cart.
  // L'important est que les champs required soient présents et non nuls.
  //
  const totalProduits = cartItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const totalTTC      = totalProduits; // SHIPPING_COST = 0

  // ── Étape 4 : Cart + produits ─────────────────────────────
  const cartId = await createPrestaCartWithProducts(
    effectiveCustomerId,
    addressId,
    secureKey,
    cartItems,
  );

  // ── Étape 5 : Order ───────────────────────────────────────
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

  // ── Étape 6 : Forcer statut via order_histories ───────────
  //
  // On force le statut UNIQUEMENT via order_histories.
  // C'est le seul appel supplémentaire nécessaire.
  // Le module ps_cashondelivery va insérer sa propre ligne order_payment
  // lors de ce changement de statut — c'est son comportement normal.
  //
  await forcerStatutViaHistorique(orderId, ORDER_CONFIG.DEFAULT_ORDER_STATE);

  // ⚠️ PAS d'enregistrerPaiement() :
  //    PrestaShop insère déjà une ligne order_payment lors du POST /orders.
  //    Le module ps_cashondelivery en insère une deuxième lors du changement de statut.
  //    Un 3ème appel manuel crée le warning "€X paid instead of €Y" dans le backoffice.

  // ⚠️ PAS de decrementStock() :
  //    PrestaShop décrémente le stock automatiquement lors de la création de la commande
  //    (il lit les cart_rows). Un appel manuel ferait une double décrémentation.

  return { orderId, orderReference: orderRef };
}


// ─── RÉCUPÉRATION COMMANDES ───────────────────────────────────

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

/**
 * FIX SOUS-TOTAUX :
 * PrestaShop ne retourne PAS total_price_tax_incl dans les order_rows de l'API.
 * Seuls product_quantity et unit_price_tax_incl sont fiables.
 * → On calcule totalPrice = unit_price_tax_incl × product_quantity côté JS.
 */
function normaliserLignesCommande(rows) {
  if (!rows) return [];
  const liste = Array.isArray(rows) ? rows : [rows];
  return liste.map((r) => {
    const qty       = Number(extraireValeur(r.product_quantity)) || 0;
    const unitPrice = parseFloat(extraireValeur(r.unit_price_tax_incl) || 0);
    return {
      productId:   Number(extraireValeur(r.product_id)),
      productName: extraireValeur(r.product_name),
      quantity:    qty,
      unitPrice,
      totalPrice:  Math.round(unitPrice * qty * 100) / 100, // calculé côté JS
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
  } catch (err) {
    console.warn('[getOrderStates] Fallback:', err.message);
    return [
      { id: 2,  name: 'Paiement accepté',                      color: '#3498D8' },
      { id: 3,  name: 'En cours de préparation',               color: '#3498D8' },
      { id: 4,  name: 'Expédié',                               color: '#01B887' },
      { id: 5,  name: 'Livré',                                 color: '#01B887' },
      { id: 6,  name: 'Annulé',                                color: '#2C3E50' },
      { id: 13, name: 'En attente de paiement à la livraison', color: '#34209E' },
    ];
  }
}