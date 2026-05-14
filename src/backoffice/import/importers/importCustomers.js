/**
 * importCustomers.js
 * Importe clients, adresses, commandes et paniers abandonnés.
 *
 * ORDRE :
 *   1. Créer/récupérer le client
 *   2. Créer l'adresse
 *   3. Pour chaque commande → créer cart + order + forcer état
 *   4. Pour chaque panier abandonné → créer cart uniquement
 */

import { prestaGet, prestaWrite, extraireValeur } from '../config/prestaApi.js';
import { PRESTA_CONFIG } from '../config/columnMapping.js';

// ─── Utilitaires ──────────────────────────────────────────────

function genMd5() {
  return Array.from({ length: 32 }, () =>
    Math.floor(Math.random() * 16).toString(16)
  ).join('');
}

function formatDate(ddmmyyyy) {
  if (!ddmmyyyy) return null;
  const parts = ddmmyyyy.split('/');
  if (parts.length !== 3) return null;
  return `${parts[2]}-${parts[1]}-${parts[0]} 00:00:00`;
}

// ─── Clients ──────────────────────────────────────────────────

async function getExistingCustomerByEmail(email) {
  try {
    const data  = await prestaGet(`/customers?filter[email]=${encodeURIComponent(email)}&display=full`);
    const custs = data.customers?.customer || [];
    const liste = Array.isArray(custs) ? custs : [custs];
    if (!liste.length || !liste[0]) return null;
    const c  = liste[0];
    const id = Number(extraireValeur(c.id));
    const sk = extraireValeur(c.secure_key);
    return id ? { id, secure_key: sk } : null;
  } catch {
    return null;
  }
}

async function createCustomer(customer) {
  const dateAdd = formatDate(customer.date_add) || '0000-00-00 00:00:00';

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<prestashop xmlns:xlink="http://www.w3.org/1999/xlink">
  <customer>
    <id_shop>${PRESTA_CONFIG.ID_SHOP}</id_shop>
    <id_shop_group>${PRESTA_CONFIG.ID_SHOP_GROUP}</id_shop_group>
    <firstname><![CDATA[${customer.firstname}]]></firstname>
    <lastname><![CDATA[${customer.lastname}]]></lastname>
    <email><![CDATA[${customer.email}]]></email>
    <passwd><![CDATA[${customer.passwd}]]></passwd>
    <active>1</active>
    <is_guest>0</is_guest>
    <deleted>0</deleted>
  </customer>
</prestashop>`;

  const result = await prestaWrite('/customers', xml, 'POST');
  const cust   = result.customer?.[0] || result.customer;
  const newId  = Number(extraireValeur(cust?.id));
  const sk     = extraireValeur(cust?.secure_key);

  if (!newId) throw new Error(`Client "${customer.email}" non créé`);

  console.log(`[importCustomers] Client créé : ${customer.email} → ID ${newId}`);
  return { id: newId, secure_key: sk };
}

// ─── Adresses ─────────────────────────────────────────────────

async function createAddress(customerId, customer) {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<prestashop xmlns:xlink="http://www.w3.org/1999/xlink">
  <address>
    <id_customer>${customerId}</id_customer>
    <id_country>${PRESTA_CONFIG.ID_COUNTRY}</id_country>
    <alias><![CDATA[Adresse principale]]></alias>
    <lastname><![CDATA[${customer.lastname}]]></lastname>
    <firstname><![CDATA[${customer.firstname}]]></firstname>
    <address1><![CDATA[${customer.address1 || 'Adresse inconnue'}]]></address1>
    <postcode><![CDATA[00000]]></postcode>
    <city><![CDATA[${customer.address1 || 'Ville'}]]></city>
    <active>1</active>
    <deleted>0</deleted>
  </address>
</prestashop>`;

  const result = await prestaWrite('/addresses', xml, 'POST');
  const addr   = result.address?.[0] || result.address;
  const newId  = Number(extraireValeur(addr?.id));

  if (!newId) throw new Error(`Adresse client ${customerId} non créée`);
  return newId;
}

// ─── Résolution produit/combinaison ──────────────────────────

/**
 * Résout une référence + variante → { productId, combinationId }
 * depuis les maps construites pendant l'import produits/combinaisons.
 */
function resolveItem(item, refToProductId, refToComboMap) {
  const productId = refToProductId.get(item.reference);
  if (!productId) return null;

  let combinationId = 0;

  if (item.variant && refToComboMap.has(item.reference)) {
    const comboMap = refToComboMap.get(item.reference); // Map<attrValueKey, comboId>
    const varKey   = item.variant.toLowerCase().trim();
    combinationId  = comboMap.get(varKey) || 0;
  }

  return { productId, combinationId };
}

// ─── Cart PrestaShop ──────────────────────────────────────────

async function createCart(customerId, addressId, secureKey, cartItems, refToProductId, refToComboMap) {
  // Création cart vide
  const xmlCart = `<?xml version="1.0" encoding="UTF-8"?>
<prestashop xmlns:xlink="http://www.w3.org/1999/xlink">
  <cart>
    <id_shop_group>${PRESTA_CONFIG.ID_SHOP_GROUP}</id_shop_group>
    <id_shop>${PRESTA_CONFIG.ID_SHOP}</id_shop>
    <id_address_delivery>${addressId}</id_address_delivery>
    <id_address_invoice>${addressId}</id_address_invoice>
    <id_currency>${PRESTA_CONFIG.ID_CURRENCY}</id_currency>
    <id_lang>${PRESTA_CONFIG.ID_LANG}</id_lang>
    <id_customer>${customerId}</id_customer>
    <id_carrier>${PRESTA_CONFIG.ID_CARRIER}</id_carrier>
    <recyclable>0</recyclable>
    <gift>0</gift>
    <gift_message></gift_message>
    <mobile_theme>0</mobile_theme>
    <delivery_option><![CDATA[{"${addressId}":"${PRESTA_CONFIG.ID_CARRIER},"}]]></delivery_option>
    <secure_key>${secureKey}</secure_key>
    <allow_seperated_package>0</allow_seperated_package>
  </cart>
</prestashop>`;

  const resultCart = await prestaWrite('/carts', xmlCart, 'POST');
  const cart       = resultCart.cart?.[0] || resultCart.cart;
  const cartId     = Number(extraireValeur(cart?.id));
  if (!cartId) throw new Error('Cart non créé');

  // Résolution des items
  const resolvedItems = cartItems
    .map((item) => {
      const resolved = resolveItem(item, refToProductId, refToComboMap);
      return resolved ? { ...item, ...resolved } : null;
    })
    .filter(Boolean);

  if (!resolvedItems.length) {
    console.warn('[importCustomers] Aucun article résolu pour ce panier');
    return { cartId, resolvedItems: [] };
  }

  // Ajout produits via PUT /carts/:id
  const rowsXml = resolvedItems.map((item) => `
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
    <id_shop_group>${PRESTA_CONFIG.ID_SHOP_GROUP}</id_shop_group>
    <id_shop>${PRESTA_CONFIG.ID_SHOP}</id_shop>
    <id_address_delivery>${addressId}</id_address_delivery>
    <id_address_invoice>${addressId}</id_address_invoice>
    <id_currency>${PRESTA_CONFIG.ID_CURRENCY}</id_currency>
    <id_lang>${PRESTA_CONFIG.ID_LANG}</id_lang>
    <id_customer>${customerId}</id_customer>
    <id_carrier>${PRESTA_CONFIG.ID_CARRIER}</id_carrier>
    <recyclable>0</recyclable>
    <gift>0</gift>
    <gift_message></gift_message>
    <mobile_theme>0</mobile_theme>
    <delivery_option><![CDATA[{"${addressId}":"${PRESTA_CONFIG.ID_CARRIER},"}]]></delivery_option>
    <secure_key>${secureKey}</secure_key>
    <allow_seperated_package>0</allow_seperated_package>
    <associations>
      <cart_rows>${rowsXml}</cart_rows>
    </associations>
  </cart>
</prestashop>`;

  await prestaWrite(`/carts/${cartId}`, xmlUpdate, 'PUT');
  return { cartId, resolvedItems };
}

// ─── Commande ─────────────────────────────────────────────────

async function createOrder(customerId, addressId, cartId, secureKey, resolvedItems, orderState) {
  const totalProduits = resolvedItems.reduce((s, i) => s + (i.price || 0) * i.quantity, 0);
  const totalTTC      = totalProduits; // SHIPPING_COST = 0

  const xmlOrder = `<?xml version="1.0" encoding="UTF-8"?>
<prestashop xmlns:xlink="http://www.w3.org/1999/xlink">
  <order>
    <id_address_delivery>${addressId}</id_address_delivery>
    <id_address_invoice>${addressId}</id_address_invoice>
    <id_cart>${cartId}</id_cart>
    <id_currency>${PRESTA_CONFIG.ID_CURRENCY}</id_currency>
    <id_lang>${PRESTA_CONFIG.ID_LANG}</id_lang>
    <id_customer>${customerId}</id_customer>
    <id_carrier>${PRESTA_CONFIG.ID_CARRIER}</id_carrier>
    <id_shop_group>${PRESTA_CONFIG.ID_SHOP_GROUP}</id_shop_group>
    <id_shop>${PRESTA_CONFIG.ID_SHOP}</id_shop>
    <current_state>${orderState}</current_state>
    <module><![CDATA[ps_cashondelivery]]></module>
    <invoice_date>0000-00-00 00:00:00</invoice_date>
    <delivery_date>0000-00-00 00:00:00</delivery_date>
    <valid>1</valid>
    <payment><![CDATA[CashOnDelivery]]></payment>
    <total_discounts>0.000000</total_discounts>
    <total_discounts_tax_incl>0.000000</total_discounts_tax_incl>
    <total_discounts_tax_excl>0.000000</total_discounts_tax_excl>
    <total_paid>${totalTTC.toFixed(6)}</total_paid>
    <total_paid_tax_incl>${totalTTC.toFixed(6)}</total_paid_tax_incl>
    <total_paid_tax_excl>${totalTTC.toFixed(6)}</total_paid_tax_excl>
    <total_paid_real>${totalTTC.toFixed(6)}</total_paid_real>
    <total_products>${totalProduits.toFixed(6)}</total_products>
    <total_products_wt>${totalProduits.toFixed(6)}</total_products_wt>
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

  const resultOrder = await prestaWrite('/orders', xmlOrder, 'POST');

  let orderId;

  if (resultOrder?.hookError) {
    // Hook gamification : récupérer via cartId
    await new Promise((r) => setTimeout(r, 500));
    const data   = await prestaGet(`/orders?filter[id_cart]=${cartId}&display=full`);
    const orders = data.orders?.order || [];
    const liste  = Array.isArray(orders) ? orders : [orders];
    orderId      = Number(extraireValeur(liste[0]?.id));
  } else {
    const order = resultOrder.order?.[0] || resultOrder.order;
    orderId     = Number(extraireValeur(order?.id));
  }

  if (!orderId) throw new Error(`Order non créé pour cart ${cartId}`);

  // Forcer l'état via PUT
  await forcerEtatCommande(orderId, orderState);

  return orderId;
}

async function forcerEtatCommande(orderId, state) {
  try {
    const data  = await prestaGet(`/orders/${orderId}`);
    const order = data.order?.[0] || data.order;
    if (!order) return;

    const xmlPut = `<?xml version="1.0" encoding="UTF-8"?>
<prestashop xmlns:xlink="http://www.w3.org/1999/xlink">
  <order>
    <id>${orderId}</id>
    <id_address_delivery>${extraireValeur(order.id_address_delivery)}</id_address_delivery>
    <id_address_invoice>${extraireValeur(order.id_address_invoice)}</id_address_invoice>
    <id_cart>${extraireValeur(order.id_cart)}</id_cart>
    <id_currency>${extraireValeur(order.id_currency)}</id_currency>
    <id_lang>${extraireValeur(order.id_lang)}</id_lang>
    <id_customer>${extraireValeur(order.id_customer)}</id_customer>
    <id_carrier>${extraireValeur(order.id_carrier)}</id_carrier>
    <id_shop_group>${PRESTA_CONFIG.ID_SHOP_GROUP}</id_shop_group>
    <id_shop>${PRESTA_CONFIG.ID_SHOP}</id_shop>
    <current_state>${state}</current_state>
    <module><![CDATA[${extraireValeur(order.module)}]]></module>
    <payment><![CDATA[${extraireValeur(order.payment)}]]></payment>
    <valid>1</valid>
    <total_paid>${extraireValeur(order.total_paid)}</total_paid>
    <total_paid_tax_incl>${extraireValeur(order.total_paid_tax_incl)}</total_paid_tax_incl>
    <total_paid_tax_excl>${extraireValeur(order.total_paid_tax_excl)}</total_paid_tax_excl>
    <total_paid_real>${extraireValeur(order.total_paid_real)}</total_paid_real>
    <total_products>${extraireValeur(order.total_products)}</total_products>
    <total_products_wt>${extraireValeur(order.total_products_wt)}</total_products_wt>
    <total_shipping>${extraireValeur(order.total_shipping)}</total_shipping>
    <total_shipping_tax_incl>${extraireValeur(order.total_shipping_tax_incl)}</total_shipping_tax_incl>
    <total_shipping_tax_excl>${extraireValeur(order.total_shipping_tax_excl)}</total_shipping_tax_excl>
    <total_discounts>${extraireValeur(order.total_discounts)}</total_discounts>
    <total_discounts_tax_incl>${extraireValeur(order.total_discounts_tax_incl)}</total_discounts_tax_incl>
    <total_discounts_tax_excl>${extraireValeur(order.total_discounts_tax_excl)}</total_discounts_tax_excl>
    <total_wrapping>${extraireValeur(order.total_wrapping)}</total_wrapping>
    <total_wrapping_tax_incl>${extraireValeur(order.total_wrapping_tax_incl)}</total_wrapping_tax_incl>
    <total_wrapping_tax_excl>${extraireValeur(order.total_wrapping_tax_excl)}</total_wrapping_tax_excl>
    <carrier_tax_rate>${extraireValeur(order.carrier_tax_rate)}</carrier_tax_rate>
    <round_mode>${extraireValeur(order.round_mode)}</round_mode>
    <round_type>${extraireValeur(order.round_type)}</round_type>
    <conversion_rate>${extraireValeur(order.conversion_rate)}</conversion_rate>
    <invoice_date>${extraireValeur(order.invoice_date)}</invoice_date>
    <delivery_date>${extraireValeur(order.delivery_date)}</delivery_date>
    <gift>0</gift>
    <recyclable>0</recyclable>
  </order>
</prestashop>`;

    await prestaWrite(`/orders/${orderId}`, xmlPut, 'PUT');
    console.log(`[importCustomers] current_state forcé à ${state} pour order ${orderId}`);
  } catch (err) {
    console.error('[importCustomers] forcerEtatCommande:', err.message);
  }
}

// ─── Fonction principale ──────────────────────────────────────

/**
 * Importe clients, commandes et paniers.
 *
 * @param {Array}  groupedCustomers  - sortie de groupCustomerOrders
 * @param {Map}    refToProductId    - référence → productId
 * @param {Map}    refToComboMap     - référence → Map<variantKey, comboId>
 * @param {Function} onProgress
 */
export async function importCustomers(
  groupedCustomers,
  refToProductId,
  refToComboMap,
  onProgress = () => {}
) {
  for (const entry of groupedCustomers) {
    const { customer, orders, carts } = entry;

    try {
      // Client
      let custId, secureKey;
      const existing = await getExistingCustomerByEmail(customer.email);

      if (existing) {
        custId    = existing.id;
        secureKey = existing.secure_key;
        onProgress(`⏭ Client existant réutilisé : ${customer.email} (ID ${custId})`, 'skip');
      } else {
        const created = await createCustomer(customer);
        custId    = created.id;
        secureKey = created.secure_key;
        onProgress(`✅ Client créé : ${customer.email}`, 'success');
      }

      // Adresse
      const addressId = await createAddress(custId, customer);
      onProgress(`📍 Adresse créée pour ${customer.email}`, 'success');

      // Commandes
      for (const order of orders) {
        try {
          const { cartId, resolvedItems } = await createCart(
            custId, addressId, secureKey, order.cart_items,
            refToProductId, refToComboMap
          );

          const orderId = await createOrder(
            custId, addressId, cartId, secureKey,
            resolvedItems, order.order_state
          );

          onProgress(`✅ Commande créée : ${customer.email} → Order #${orderId} (état ${order.order_state})`, 'success');
        } catch (err) {
          onProgress(`❌ Commande ${customer.email} : ${err.message}`, 'error');
        }
      }

      // Paniers abandonnés
      for (const cart of carts) {
        try {
          const { cartId } = await createCart(
            custId, addressId, secureKey, cart.cart_items,
            refToProductId, refToComboMap
          );
          onProgress(`🛒 Panier abandonné créé : ${customer.email} → Cart #${cartId}`, 'success');
        } catch (err) {
          onProgress(`❌ Panier ${customer.email} : ${err.message}`, 'error');
        }
      }

    } catch (err) {
      onProgress(`❌ Client ${customer.email} : ${err.message}`, 'error');
    }
  }
}
