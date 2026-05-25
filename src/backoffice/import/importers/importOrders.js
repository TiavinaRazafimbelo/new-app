/**
 * importOrders.js — v6
 * src/backoffice/import/importers/importOrders.js
 * ─────────────────────────────────────────────────────────────
 * CORRECTIONS v6 :
 *
 *   FIX #E — Correction des dates des paniers abandonnés :
 *     Les paniers sans commande (état vide dans le CSV) étaient
 *     stockés dans bilan.details mais pas dans bilan.dateCorrections,
 *     et l'appel /fix-import-dates n'envoyait pas de "cartOnly".
 *     Désormais :
 *       - bilan.cartCorrections[] stocke { idCart, date } pour chaque panier
 *       - L'appel /fix-import-dates envoie aussi le tableau "cartOnly"
 *       - fix-import-dates.php met à jour ps_cart.date_add/date_upd pour ces paniers
 *
 * CORRECTIONS héritées (v5) :
 *   FIX #A — ps_cart_product : PUT /carts/:id après POST /carts
 *   FIX #B — HTTP 500 gamification : fallback GET /orders?filter[id_cart]
 *   FIX #C — secure_key incluse dans cart + commande
 *   FIX #D — id_shop/id_shop_group = 1 partout
 * ─────────────────────────────────────────────────────────────
 */

import { prestaGet, prestaWrite, extraireVal, getAuthHeader } from '../config/prestaApi.js';
import { XMLParser } from 'fast-xml-parser';

// ─── Configuration ────────────────────────────────────────────

export const ORDER_CONFIG = {
  DEFAULT_ORDER_STATE:  2,
  PAYMENT_MODULE:       'ps_cashondelivery',
  PAYMENT_LABEL:        'Cash On Delivery',
  SHIPPING_COST:        0,
  ID_COUNTRY:           8,
  ID_CARRIER:           2,
  ID_LANG:              1,
  ID_CURRENCY:          1,
  ID_SHOP:              1,
  ID_SHOP_GROUP:        1,
};

const STOCK_ENDPOINT = '/updatestock';

// ─── Parser pour les réponses (y compris les 500) ─────────────
const errorParser = new XMLParser({
  ignoreAttributes:    false,
  attributeNamePrefix: '@_',
  cdataPropName:       '__cdata',
  textNodeName:        '#text',
  parseAttributeValue: true,
  isArray: (tag) => ['error', 'order', 'cart'].includes(tag),
});

// ─── Traductions malgache ↔ français ─────────────────────────
const TRADUCTION_INVERSE = {
  'grande taille': 'ngoza',
  'petite taille': 'kely',
  'noir':          'mainty',
  'blanc':         'fotsy',
};

// ─── Helpers ──────────────────────────────────────────────────

function extraireId(reponse, ressource) {
  const direct = reponse[ressource];
  if (Array.isArray(direct) && direct.length > 0) return Number(extraireVal(direct[0]?.id));
  if (direct && !Array.isArray(direct))            return Number(extraireVal(direct?.id));
  const pluriel = reponse[ressource + 's']?.[ressource];
  if (Array.isArray(pluriel) && pluriel.length > 0) return Number(extraireVal(pluriel[0]?.id));
  if (pluriel && !Array.isArray(pluriel))            return Number(extraireVal(pluriel?.id));
  return 0;
}

// ─── POST /orders avec gestion robuste HTTP 500 ───────────────

async function postOrder(xmlBody, idCart) {
  const res = await fetch('/api/orders', {
    method: 'POST',
    headers: {
      Authorization:  getAuthHeader(),
      'Content-Type': 'application/xml',
      Accept:         'application/xml',
    },
    body: xmlBody,
  });

  const xmlText = await res.text();

  if (res.ok) {
    let parsed = {};
    try { parsed = errorParser.parse(xmlText)?.prestashop || {}; } catch (_) {}
    const id = extraireId(parsed, 'order');
    if (id) return id;
    await new Promise((r) => setTimeout(r, 400));
    return fallbackGetOrderByCart(idCart, 'HTTP 200 sans ID dans la réponse');
  }

  console.warn(`[postOrder] HTTP 500 pour cart=${idCart} — tentative fallback GET…`);
  await new Promise((r) => setTimeout(r, 800));

  try {
    const idTrouve = await fallbackGetOrderByCart(idCart, null);
    if (idTrouve) {
      console.warn(`[postOrder] Commande retrouvée via fallback : id=${idTrouve} (hook gamification ignoré)`);
      return idTrouve;
    }
  } catch (_) {}

  let msgErreur = `HTTP 500 — commande introuvable après fallback (cart=${idCart})`;
  try {
    const parsed  = errorParser.parse(xmlText)?.prestashop || {};
    const errors  = parsed?.errors?.error || [];
    const errList = Array.isArray(errors) ? errors : [errors];
    const msgs    = errList.map((e) => extraireVal(e?.message)).filter(Boolean);
    if (msgs.length) msgErreur = `HTTP 500: ${msgs.join('; ')}`;
  } catch (_) {
    if (xmlText.length > 0) msgErreur = `HTTP 500: ${xmlText.slice(0, 200)}`;
  }

  throw new Error(msgErreur);
}

async function fallbackGetOrderByCart(idCart, contexteErreur) {
  const fb     = await prestaGet(`/orders?filter[id_cart]=${idCart}&display=full`);
  const orders = fb.orders?.order || [];
  const liste  = Array.isArray(orders) ? orders : [orders];

  if (liste.length > 0) {
    const id = Number(extraireVal(liste[0]?.id));
    if (id) return id;
  }

  const msg = contexteErreur
    ? `${contexteErreur} — commande introuvable via fallback cart=${idCart}`
    : null;
  if (msg) throw new Error(msg);
  return 0;
}

// ─── ÉTAPE 1 : Client ─────────────────────────────────────────

async function chercherCustomer(email) {
  try {
    const data  = await prestaGet(
      `/customers?filter[email]=${encodeURIComponent(email)}&display=full`
    );
    const bruts = data.customers?.customer || [];
    const liste = Array.isArray(bruts) ? bruts : [bruts];
    const trouve = liste.find(
      (c) => extraireVal(c.email).toLowerCase() === email.toLowerCase()
    );
    if (trouve) {
      return {
        id:        Number(extraireVal(trouve.id)),
        secureKey: extraireVal(trouve.secure_key),
        exists:    true,
      };
    }
    return { id: null, secureKey: '', exists: false };
  } catch {
    return { id: null, secureKey: '', exists: false };
  }
}

async function creerCustomer(commande) {
  const mots   = commande.nom.trim().split(/\s+/);
  const prenom = mots[0] || 'Client';
  const nom    = mots.slice(1).join(' ') || '.';

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<prestashop xmlns:xlink="http://www.w3.org/1999/xlink">
  <customer>
    <firstname><![CDATA[${prenom}]]></firstname>
    <lastname><![CDATA[${nom}]]></lastname>
    <email><![CDATA[${commande.email}]]></email>
    <passwd><![CDATA[${commande.pwd}]]></passwd>
    <active><![CDATA[1]]></active>
    <deleted><![CDATA[0]]></deleted>
    <id_default_group><![CDATA[3]]></id_default_group>
    <id_lang><![CDATA[${ORDER_CONFIG.ID_LANG}]]></id_lang>
    <id_shop><![CDATA[${ORDER_CONFIG.ID_SHOP}]]></id_shop>
    <newsletter><![CDATA[0]]></newsletter>
    <optin><![CDATA[0]]></optin>
    <is_guest><![CDATA[0]]></is_guest>
  </customer>
</prestashop>`;

  const res = await prestaWrite('/customers', xml, 'POST');
  const id  = extraireId(res, 'customer');
  if (!id) throw new Error(`Customer non créé pour "${commande.email}"`);

  const detail    = await prestaGet(`/customers/${id}`);
  const cust      = detail.customer?.[0] || detail.customer;
  const secureKey = extraireVal(cust?.secure_key);

  return { id, secureKey };
}

// ─── ÉTAPE 2 : Adresse ───────────────────────────────────────

async function chercherAdresse(idCustomer) {
  try {
    const data  = await prestaGet(
      `/addresses?filter[id_customer]=${idCustomer}&display=full`
    );
    const bruts = data.addresses?.address || [];
    const liste = Array.isArray(bruts) ? bruts : [bruts];
    const active = liste.find((a) => String(extraireVal(a.deleted)) !== '1');
    return active ? Number(extraireVal(active.id)) : null;
  } catch {
    return null;
  }
}

async function creerAdresse(idCustomer, commande) {
  const mots   = commande.nom.trim().split(/\s+/);
  const prenom = mots[0] || 'Client';
  const nom    = mots.slice(1).join(' ') || '.';

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<prestashop xmlns:xlink="http://www.w3.org/1999/xlink">
  <address>
    <id_customer><![CDATA[${idCustomer}]]></id_customer>
    <id_country><![CDATA[${ORDER_CONFIG.ID_COUNTRY}]]></id_country>
    <id_state><![CDATA[0]]></id_state>
    <alias><![CDATA[Mon adresse]]></alias>
    <company><![CDATA[]]></company>
    <lastname><![CDATA[${nom}]]></lastname>
    <firstname><![CDATA[${prenom}]]></firstname>
    <vat_number><![CDATA[]]></vat_number>
    <address1><![CDATA[${commande.adresse}]]></address1>
    <address2><![CDATA[]]></address2>
    <postcode><![CDATA[00000]]></postcode>
    <city><![CDATA[${commande.adresse}]]></city>
    <phone><![CDATA[]]></phone>
    <phone_mobile><![CDATA[]]></phone_mobile>
    <active><![CDATA[1]]></active>
    <deleted><![CDATA[0]]></deleted>
  </address>
</prestashop>`;

  const res = await prestaWrite('/addresses', xml, 'POST');
  const id  = extraireId(res, 'address');
  if (!id) throw new Error(`Adresse non créée pour customer ${idCustomer}`);
  return id;
}

// ─── ÉTAPE 3 : Produits + TVA ─────────────────────────────────

async function chargerProduits() {
  const data  = await prestaGet('/products?display=full');
  const bruts = data.products?.product || [];
  const liste = Array.isArray(bruts) ? bruts : [bruts];

  const map = new Map();
  for (const p of liste) {
    const ref = extraireVal(p.reference).trim();
    if (!ref) continue;
    map.set(ref, {
      id:         Number(extraireVal(p.id)),
      priceHT:    parseFloat(extraireVal(p.price) || '0'),
      idTaxGroup: Number(extraireVal(p.id_tax_rules_group)),
      taxRate:    0,
    });
  }
  return map;
}

// ─── ÉTAPE 3b : Combinaisons ──────────────────────────────────

async function chargerCombinaisonsProduit(idProduit, log) {
  const map = new Map();

  const dataCombis = await prestaGet(
    `/combinations?filter[id_product]=${idProduit}&display=full`
  );
  const brutsCombis = dataCombis.combinations?.combination || [];
  const listeCombis = Array.isArray(brutsCombis) ? brutsCombis : [brutsCombis];
  if (!listeCombis.length) return map;

  const dataVals = await prestaGet('/product_option_values?display=full');
  const brutsVals = dataVals.product_option_values?.product_option_value || [];
  const listeVals = Array.isArray(brutsVals) ? brutsVals : [brutsVals];

  const labelParId = new Map();
  for (const v of listeVals) {
    const id = Number(extraireVal(v.id));
    if (!id) continue;
    const labels = new Set();

    if (v.name?.language) {
      const langues = Array.isArray(v.name.language) ? v.name.language : [v.name.language];
      for (const l of langues) {
        const t = (l.__cdata ?? l['#text'] ?? '').toString().toLowerCase().trim();
        if (t) labels.add(t);
      }
    } else {
      const t = extraireVal(v.name).toLowerCase().trim();
      if (t) labels.add(t);
    }

    for (const label of [...labels]) {
      const alias = TRADUCTION_INVERSE[label];
      if (alias) labels.add(alias);
    }

    labelParId.set(id, labels);
  }

  for (const combi of listeCombis) {
    const idCombi      = Number(extraireVal(combi.id));
    const supplementHT = parseFloat(extraireVal(combi.price) || '0');

    const optsRaw = combi.associations?.product_option_values?.product_option_value;
    if (!optsRaw) continue;
    const opts = Array.isArray(optsRaw) ? optsRaw : [optsRaw];

    const labelsCombi = [];
    for (const opt of opts) {
      const idVal = Number(extraireVal(opt.id));
      if (!idVal) continue;
      const labelsSet = labelParId.get(idVal);
      if (!labelsSet) continue;
      for (const label of labelsSet) {
        map.set(label, { idCombi, supplementHT });
        labelsCombi.push(label);
      }
    }

    log('info', `  Combi id=${idCombi} → [${labelsCombi.join(' | ')}]`);
  }

  return map;
}

// ─── ÉTAPE 4 : Cart + cart_rows ──────────────────────────────

async function creerCartAvecProduits(idCustomer, idAdresse, secureKey, lignesResolues) {
  const xmlCart = `<?xml version="1.0" encoding="UTF-8"?>
<prestashop xmlns:xlink="http://www.w3.org/1999/xlink">
  <cart>
    <id_currency><![CDATA[${ORDER_CONFIG.ID_CURRENCY}]]></id_currency>
    <id_lang><![CDATA[${ORDER_CONFIG.ID_LANG}]]></id_lang>
    <id_shop><![CDATA[${ORDER_CONFIG.ID_SHOP}]]></id_shop>
    <id_shop_group><![CDATA[${ORDER_CONFIG.ID_SHOP_GROUP}]]></id_shop_group>
    <id_customer><![CDATA[${idCustomer}]]></id_customer>
    <id_address_delivery><![CDATA[${idAdresse}]]></id_address_delivery>
    <id_address_invoice><![CDATA[${idAdresse}]]></id_address_invoice>
    <id_carrier><![CDATA[${ORDER_CONFIG.ID_CARRIER}]]></id_carrier>
    <recyclable><![CDATA[0]]></recyclable>
    <gift><![CDATA[0]]></gift>
    <gift_message><![CDATA[]]></gift_message>
    <mobile_theme><![CDATA[0]]></mobile_theme>
    <delivery_option><![CDATA[]]></delivery_option>
    <secure_key><![CDATA[${secureKey}]]></secure_key>
    <allow_seperated_package><![CDATA[0]]></allow_seperated_package>
  </cart>
</prestashop>`;

  const resCart = await prestaWrite('/carts', xmlCart, 'POST');
  const idCart  = extraireId(resCart, 'cart');
  if (!idCart) throw new Error('Cart non créé (pas d\'ID dans la réponse)');

  const cartRowsXml = lignesResolues.map((ligne) => `
      <cart_row>
        <id_product><![CDATA[${ligne.idProduit}]]></id_product>
        <id_product_attribute><![CDATA[${ligne.idCombi ?? 0}]]></id_product_attribute>
        <id_address_delivery><![CDATA[${idAdresse}]]></id_address_delivery>
        <quantity><![CDATA[${ligne.quantite}]]></quantity>
      </cart_row>`).join('');

  const xmlCartUpdate = `<?xml version="1.0" encoding="UTF-8"?>
<prestashop xmlns:xlink="http://www.w3.org/1999/xlink">
  <cart>
    <id><![CDATA[${idCart}]]></id>
    <id_currency><![CDATA[${ORDER_CONFIG.ID_CURRENCY}]]></id_currency>
    <id_lang><![CDATA[${ORDER_CONFIG.ID_LANG}]]></id_lang>
    <id_shop><![CDATA[${ORDER_CONFIG.ID_SHOP}]]></id_shop>
    <id_shop_group><![CDATA[${ORDER_CONFIG.ID_SHOP_GROUP}]]></id_shop_group>
    <id_customer><![CDATA[${idCustomer}]]></id_customer>
    <id_address_delivery><![CDATA[${idAdresse}]]></id_address_delivery>
    <id_address_invoice><![CDATA[${idAdresse}]]></id_address_invoice>
    <id_carrier><![CDATA[${ORDER_CONFIG.ID_CARRIER}]]></id_carrier>
    <recyclable><![CDATA[0]]></recyclable>
    <gift><![CDATA[0]]></gift>
    <gift_message><![CDATA[]]></gift_message>
    <mobile_theme><![CDATA[0]]></mobile_theme>
    <delivery_option><![CDATA[]]></delivery_option>
    <secure_key><![CDATA[${secureKey}]]></secure_key>
    <allow_seperated_package><![CDATA[0]]></allow_seperated_package>
    <associations>
      <cart_rows>
        ${cartRowsXml}
      </cart_rows>
    </associations>
  </cart>
</prestashop>`;

  await prestaWrite(`/carts/${idCart}`, xmlCartUpdate, 'PUT');

  return idCart;
}

// ─── ÉTAPE 5 : Commande ───────────────────────────────────────

function calculerTotaux(lignesResolues) {
  let totalHT = 0, totalTTC = 0;
  for (const ligne of lignesResolues) {
    const ht  = ligne.prixUnitaireHT * ligne.quantite;
    const ttc = ht * (1 + ligne.tauxTVA / 100);
    totalHT  += ht;
    totalTTC += ttc;
  }
  return {
    totalHT:  Math.round(totalHT  * 1000000) / 1000000,
    totalTTC: Math.round(totalTTC * 1000000) / 1000000,
  };
}

async function creerCommande({
  idCustomer, idAdresse, idCart, secureKey,
  dateCommande, etatPS, lignesResolues,
}) {
  const { totalHT, totalTTC } = calculerTotaux(lignesResolues);

  let dateFormatee = dateCommande;
  if (!dateFormatee || !/^\d{4}-\d{2}-\d{2}$/.test(dateFormatee)) {
    console.warn(`[creerCommande] Date invalide: "${dateCommande}" — utilisation de la date du jour`);
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    dateFormatee = `${yyyy}-${mm}-${dd}`;
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<prestashop xmlns:xlink="http://www.w3.org/1999/xlink">
  <order>
    <id_address_delivery><![CDATA[${idAdresse}]]></id_address_delivery>
    <id_address_invoice><![CDATA[${idAdresse}]]></id_address_invoice>
    <id_cart><![CDATA[${idCart}]]></id_cart>
    <id_currency><![CDATA[${ORDER_CONFIG.ID_CURRENCY}]]></id_currency>
    <id_lang><![CDATA[${ORDER_CONFIG.ID_LANG}]]></id_lang>
    <id_customer><![CDATA[${idCustomer}]]></id_customer>
    <id_carrier><![CDATA[${ORDER_CONFIG.ID_CARRIER}]]></id_carrier>
    <id_shop_group><![CDATA[${ORDER_CONFIG.ID_SHOP_GROUP}]]></id_shop_group>
    <id_shop><![CDATA[${ORDER_CONFIG.ID_SHOP}]]></id_shop>
    <current_state><![CDATA[${etatPS}]]></current_state>
    <module><![CDATA[${ORDER_CONFIG.PAYMENT_MODULE}]]></module>
    <invoice_number><![CDATA[0]]></invoice_number>
    <invoice_date><![CDATA[0000-00-00 00:00:00]]></invoice_date>
    <delivery_number><![CDATA[0]]></delivery_number>
    <delivery_date><![CDATA[0000-00-00 00:00:00]]></delivery_date>
    <valid><![CDATA[1]]></valid>
    <date_add><![CDATA[${dateFormatee} 00:00:00]]></date_add>
    <date_upd><![CDATA[${dateFormatee} 00:00:00]]></date_upd>
    <shipping_number><![CDATA[]]></shipping_number>
    <note><![CDATA[]]></note>
    <recyclable><![CDATA[0]]></recyclable>
    <gift><![CDATA[0]]></gift>
    <gift_message><![CDATA[]]></gift_message>
    <mobile_theme><![CDATA[0]]></mobile_theme>
    <secure_key><![CDATA[${secureKey}]]></secure_key>
    <total_discounts><![CDATA[0.000000]]></total_discounts>
    <total_discounts_tax_incl><![CDATA[0.000000]]></total_discounts_tax_incl>
    <total_discounts_tax_excl><![CDATA[0.000000]]></total_discounts_tax_excl>
    <total_paid><![CDATA[${totalTTC.toFixed(6)}]]></total_paid>
    <total_paid_tax_incl><![CDATA[${totalTTC.toFixed(6)}]]></total_paid_tax_incl>
    <total_paid_tax_excl><![CDATA[${totalHT.toFixed(6)}]]></total_paid_tax_excl>
    <total_paid_real><![CDATA[${totalTTC.toFixed(6)}]]></total_paid_real>
    <total_products><![CDATA[${totalHT.toFixed(6)}]]></total_products>
    <total_products_wt><![CDATA[${totalTTC.toFixed(6)}]]></total_products_wt>
    <total_shipping><![CDATA[0.000000]]></total_shipping>
    <total_shipping_tax_incl><![CDATA[0.000000]]></total_shipping_tax_incl>
    <total_shipping_tax_excl><![CDATA[0.000000]]></total_shipping_tax_excl>
    <carrier_tax_rate><![CDATA[0]]></carrier_tax_rate>
    <total_wrapping><![CDATA[0.000000]]></total_wrapping>
    <total_wrapping_tax_incl><![CDATA[0.000000]]></total_wrapping_tax_incl>
    <total_wrapping_tax_excl><![CDATA[0.000000]]></total_wrapping_tax_excl>
    <round_mode><![CDATA[2]]></round_mode>
    <round_type><![CDATA[1]]></round_type>
    <conversion_rate><![CDATA[1.000000]]></conversion_rate>
    <payment><![CDATA[${ORDER_CONFIG.PAYMENT_LABEL}]]></payment>
  </order>
</prestashop>`;

  return postOrder(xml, idCart);
}

// ─── ÉTAPE 6 : Historique état ────────────────────────────────

async function ajouterEtatCommande(idOrder, idOrderState) {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<prestashop xmlns:xlink="http://www.w3.org/1999/xlink">
  <order_history>
    <id_order><![CDATA[${idOrder}]]></id_order>
    <id_order_state><![CDATA[${idOrderState}]]></id_order_state>
    <id_employee><![CDATA[0]]></id_employee>
    <date_add><![CDATA[]]></date_add>
    <send_email><![CDATA[0]]></send_email>
    <message><![CDATA[]]></message>
  </order_history>
</prestashop>`;
  await prestaWrite('/order_histories', xml, 'POST');
}

// ─── ÉTAPE 7 : Décrémentation stock via endpoint custom ───────

async function decrementerStock(idProduit, idCombi, quantite, registerOnly = false) {
  const attrId = parseInt(idCombi, 10) || 0;
  const delta  = -quantite;

  const res = await fetch(STOCK_ENDPOINT, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      id_product:           Number(idProduit),
      id_product_attribute: attrId,
      delta,
      register_only:        registerOnly,
    }),
  });

  const text    = await res.text();
  const trimmed = text.trim();

  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    throw new Error(
      `/updatestock a retourné une réponse non-JSON (HTTP ${res.status}). ` +
      `Vérifiez que /updatestock.php est accessible. ` +
      `Réponse : ${trimmed.slice(0, 120)}`
    );
  }

  let data;
  try { data = JSON.parse(trimmed); }
  catch (e) { throw new Error(`/updatestock JSON invalide : ${trimmed.slice(0, 100)}`); }

  if (!res.ok || !data.success) {
    throw new Error(data.error || `/updatestock HTTP ${res.status}`);
  }

  return {
    newQty:    data.quantity,
    qtyBefore: data.quantity_before ?? null,
  };
}

// ─── Import principal ─────────────────────────────────────────

export async function importerCommandes(commandes, onLog) {
  const log   = (type, message, ref = '') => onLog({ type, message, ref });
  const bilan = {
    crees:             0,
    clientsCrees:      0,
    clientsExistants:  0,
    skips:             0,
    erreurs:           0,
    details:           [],
    dateCorrections:   [], // { idOrder, idCart, date } — commandes avec état
    cartCorrections:   [], // { idCart, date }           — paniers sans commande (FIX #E)
  };

  // ── Pré-chargement produits ───────────────────────────────
  log('info', 'Chargement des produits PrestaShop…');
  let produitsMap;
  try {
    produitsMap = await chargerProduits();
    log('info', `${produitsMap.size} produit(s) chargé(s)`);
  } catch (err) {
    log('erreur', `Impossible de charger les produits : ${err.message}`);
    throw err;
  }

  // ── Pré-chargement TVA ────────────────────────────────────
  log('info', 'Chargement des taux de TVA…');
  const tauxParGroupe = new Map();
  try {
    const taxesData  = await prestaGet('/taxes?display=full');
    const taxesBruts = taxesData.taxes?.tax || [];
    const taxesListe = Array.isArray(taxesBruts) ? taxesBruts : [taxesBruts];
    const taxById    = new Map();
    for (const t of taxesListe) {
      taxById.set(Number(extraireVal(t.id)), parseFloat(extraireVal(t.rate) || '0'));
    }
    const rulesData  = await prestaGet('/tax_rules?display=full');
    const rulesBruts = rulesData.tax_rules?.tax_rule || [];
    const rulesListe = Array.isArray(rulesBruts) ? rulesBruts : [rulesBruts];
    for (const rule of rulesListe) {
      const groupId = Number(extraireVal(rule.id_tax_rules_group));
      const taxId   = Number(extraireVal(rule.id_tax));
      if (!tauxParGroupe.has(groupId) && taxById.has(taxId)) {
        tauxParGroupe.set(groupId, taxById.get(taxId));
      }
    }
    log('info', `${tauxParGroupe.size} taux TVA chargé(s)`);
  } catch (err) {
    log('erreur', `Impossible de charger les taxes : ${err.message}`);
    throw err;
  }

  for (const [ref, produit] of produitsMap) {
    produit.taxRate = tauxParGroupe.get(produit.idTaxGroup) ?? 0;
    produitsMap.set(ref, produit);
  }

  const combiCache = new Map();

  log('info', `Début import — ${commandes.length} commande(s) à traiter`);

  for (const commande of commandes) {
    const ref = commande.email;
    log('info', `── Commande ligne ${commande.ligneCSV} : ${commande.email}`, ref);

    try {
      // ── 1. Client + secure_key ──────────────────────────
      log('info', `Recherche client : ${commande.email}`, ref);
      let idCustomer, secureKey;

      const { id: idExistant, secureKey: skExistant, exists } =
        await chercherCustomer(commande.email);

      if (exists) {
        idCustomer = idExistant;
        secureKey  = skExistant;
        log('info', `Client existant : id=${idCustomer}`, ref);
        bilan.clientsExistants++;
      } else {
        const created = await creerCustomer(commande);
        idCustomer    = created.id;
        secureKey     = created.secureKey;
        log('succes', `Client créé : id=${idCustomer}`, ref);
        bilan.clientsCrees++;
      }

      if (!secureKey || secureKey.length < 30) {
        throw new Error(
          `secure_key invalide pour ${commande.email} (longueur=${secureKey?.length})`
        );
      }
      log('info', `secure_key OK (${secureKey.slice(0, 8)}…)`, ref);

      // ── 2. Adresse ──────────────────────────────────────
      let idAdresse = await chercherAdresse(idCustomer);
      if (!idAdresse) {
        idAdresse = await creerAdresse(idCustomer, commande);
        log('succes', `Adresse créée : id=${idAdresse}`, ref);
      } else {
        log('info', `Adresse existante : id=${idAdresse}`, ref);
      }

      // ── 3. Résolution articles ──────────────────────────
      log('info', `Résolution de ${commande.articles.length} article(s)…`, ref);
      const lignesResolues = [];
      let   erreurArticle  = false;

      for (const article of commande.articles) {
        const produit = produitsMap.get(article.reference);
        if (!produit) {
          const refsDispos = [...produitsMap.keys()].slice(0, 10).join(', ');
          log('erreur',
            `Produit "${article.reference}" introuvable dans PS (refs connues : ${refsDispos}…)`,
            ref
          );
          erreurArticle = true;
          break;
        }

        let idCombi      = 0;
        let supplementHT = 0;

        if (article.variante) {
          if (!combiCache.has(produit.id)) {
            log('info', `Chargement combinaisons produit id=${produit.id}…`, ref);
            const combis = await chargerCombinaisonsProduit(
              produit.id,
              (t, m) => log(t, m, ref)
            );
            combiCache.set(produit.id, combis);
          }

          const combisMap     = combiCache.get(produit.id);
          const varianteLower = article.variante.toLowerCase().trim();
          const combiData     = combisMap.get(varianteLower);

          if (!combiData) {
            log('erreur',
              `Variante "${article.variante}" introuvable pour "${article.reference}"`,
              ref
            );
            erreurArticle = true;
            break;
          }

          idCombi      = combiData.idCombi;
          supplementHT = combiData.supplementHT;
          log('info', `Variante "${article.variante}" → id_combi=${idCombi}`, ref);
        }

        lignesResolues.push({
          reference:      article.reference,
          idProduit:      produit.id,
          idCombi:        idCombi || 0,
          nomProduit:     article.reference,
          quantite:       article.quantite,
          prixUnitaireHT: produit.priceHT + supplementHT,
          tauxTVA:        produit.taxRate,
        });

        log('info',
          `"${article.reference}" ×${article.quantite} — HT=${(produit.priceHT + supplementHT).toFixed(4)} — TVA=${produit.taxRate}%`,
          ref
        );
      }

      if (erreurArticle) {
        bilan.erreurs++;
        bilan.details.push({
          ref, statut: 'erreur', raison: 'Article non résolu', email: commande.email,
        });
        continue;
      }

      // Agréger les doublons (même produit+combi) avant de créer le cart
      const lignesAgregees = [];
      const indexAgregation = new Map();
      for (const ligne of lignesResolues) {
        const cle = `${ligne.idProduit}:${ligne.idCombi}`;
        if (indexAgregation.has(cle)) {
          const existant = lignesAgregees[indexAgregation.get(cle)];
          existant.quantite += ligne.quantite;
        } else {
          indexAgregation.set(cle, lignesAgregees.length);
          lignesAgregees.push({ ...ligne });
        }
      }

      // ── 4. Cart + insertion produits ────────────────────
      const idCart = await creerCartAvecProduits(
        idCustomer, idAdresse, secureKey, lignesAgregees
      );
      log('succes', `Cart créé avec produits : id=${idCart}`, ref);

      // ── FIX #E : panier abandonné (état vide) ───────────
      // Stocker l'idCart dans cartCorrections pour correction de date en base.
      if (!commande.etatPS) {
        log('info', `État vide → panier abandonné conservé (pas de commande créée)`, ref);

        // FIX #E : enregistrer pour correction SQL
        bilan.cartCorrections.push({
          idCart,
          date: commande.date,
        });

        bilan.paniers = (bilan.paniers || 0) + 1;
        bilan.details.push({
          ref,
          statut:    'panier',
          idCart,
          idCustomer,
          email:     commande.email,
          articles:  commande.articles.length,
        });
        continue;
      }

      // ── 5. Commande (fallback robuste HTTP 500) ──────────
      log('info', `[DEBUG] dateCommande reçue : "${commande.date}"`, ref);
      const idOrder = await creerCommande({
        idCustomer, idAdresse, idCart, secureKey,
        dateCommande:  commande.date,
        etatPS:        commande.etatPS,
        lignesResolues,
      });
      log('succes', `Commande créée : id=${idOrder}`, ref);

      // ── 6. Historique état ───────────────────────────────
      try {
        await ajouterEtatCommande(idOrder, commande.etatPS);
        log('info', `État id=${commande.etatPS} appliqué`, ref);
      } catch (err) {
        log('warning', `Historique état non appliqué (non bloquant) : ${err.message}`, ref);
      }

      // ── 7. Décrémentation stock ──────────────────────────
      log('info', `[DEBUG] lignesResolues avant décrémentation: ${JSON.stringify(lignesResolues.map(l => ({ref: l.reference, qty: l.quantite, idCombi: l.idCombi})))}`, ref);

      for (const ligne of lignesResolues) {
        try {
          log('info', `[DEBUG] Enregistrement mouvement stock: ${ligne.reference} × ${ligne.quantite} (id_product=${ligne.idProduit}, id_combi=${ligne.idCombi})`, ref);
          const result = await decrementerStock(
            ligne.idProduit, ligne.idCombi, ligne.quantite, true
          );
          log('info',
            `Mouvement "${ligne.reference}" enregistré (qty actuelle: ${result.newQty})`,
            ref
          );
        } catch (err) {
          log('warning', `Enregistrement mouvement "${ligne.reference}" : ${err.message}`, ref);
        }
      }

      log('succes',
        `✓ Commande ${commande.email} (${commande.date}) importée — id=${idOrder}`,
        ref
      );

      bilan.dateCorrections.push({
        idOrder,
        idCart,
        date: commande.date,
      });

      bilan.crees++;
      bilan.details.push({
        ref,
        statut:    'succes',
        idOrder,
        idCustomer,
        email:     commande.email,
        articles:  commande.articles.length,
      });

    } catch (err) {
      log('erreur', `Commande "${ref}" : ${err.message}`, ref);
      bilan.erreurs++;
      bilan.details.push({
        ref, statut: 'erreur', raison: err.message, email: commande.email,
      });
    }
  }

  // ── Correction des dates en base de données ───────────────────
  // Envoie en un seul appel :
  //   "corrections" → commandes (ps_orders + ps_cart + ps_order_history)
  //   "cartOnly"    → paniers sans commande (ps_cart uniquement) — FIX #E
  const hasCorrections = bilan.dateCorrections.length > 0;
  const hasCartOnly    = bilan.cartCorrections.length > 0;

  if (hasCorrections || hasCartOnly) {
    try {
      const totalACorrigerLog = [];
      if (hasCorrections) totalACorrigerLog.push(`${bilan.dateCorrections.length} commande(s)`);
      if (hasCartOnly)    totalACorrigerLog.push(`${bilan.cartCorrections.length} panier(s)`);
      log('info', `Correction des dates en base : ${totalACorrigerLog.join(' + ')}`);

      const response = await fetch('/fix-import-dates', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          // Commandes avec état → met à jour ps_orders + ps_cart + ps_order_history
          corrections: bilan.dateCorrections.map(c => ({
            idOrder: c.idOrder,
            idCart:  c.idCart,
            dateISO: c.date,
          })),
          // Paniers sans commande → met à jour ps_cart uniquement (FIX #E)
          cartOnly: bilan.cartCorrections.map(c => ({
            idCart:  c.idCart,
            dateISO: c.date,
          })),
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`HTTP ${response.status}: ${text}`);
      }

      const result = await response.json();
      if (result.success) {
        log('succes',
          `✓ ${result.corrected} commande(s) + ${result.correctedCarts} panier(s) corrigé(s) en base`
        );
      } else {
        const errDetail = result.errors?.join(', ') || 'Erreur inconnue';
        log('warning', `Correction partielle : ${result.message} — ${errDetail}`);
      }
    } catch (err) {
      log('erreur', `⚠️  Impossible de corriger les dates : ${err.message}`);
    }
  }

  const nbPaniers = bilan.paniers || 0;
  log('info',
    `Import terminé — ✓ ${bilan.crees} commande(s) · 🛒 ${nbPaniers} panier(s) · ` +
    `👤 ${bilan.clientsCrees} client(s) créé(s) · ` +
    `✓ ${bilan.clientsExistants} existant(s) · ✗ ${bilan.erreurs} erreur(s)`
  );
  return bilan;
}