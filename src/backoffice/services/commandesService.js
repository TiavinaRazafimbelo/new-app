/**
 * commandesService.js — v6
 * ─────────────────────────────────────────────────────────────
 * MODIFICATIONS v6 :
 *   - updateOrderAction(id, action) : appelle /shiporder pour
 *     "deliver" (id=5) et "cancel" (id=6) via le module PS
 *   - getStatistiques() : calcule CA HT, coût achat, bénéfice
 *     par catégorie de produit
 *   - getStockParCategorie() : quantités physique/réservée/disponible
 *     par catégorie
 *
 * Le reste est identique à v5 (non reproduit pour concision).
 * ─────────────────────────────────────────────────────────────
 */

import { XMLParser } from 'fast-xml-parser';

const API_KEY       = import.meta.env.VITE_PRESTA_API_KEY;
const BASE_URL      = '/api';
const SHIP_ENDPOINT = '/shiporder';

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
    ['order', 'order_state', 'language', 'history', 'cart', 'cart_row',
     'tax_rule', 'stock_available', 'cart_rule', 'combination',
     'product', 'category', 'order_row'].includes(tagName),
});

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
    throw new Error(text || `Erreur HTTP ${response.status}`);
  }
  const xmlText = await response.text();
  const parsed  = parser.parse(xmlText);
  return parsed.prestashop || parsed;
}

function val(champ) {
  if (champ === undefined || champ === null) return '';
  if (typeof champ === 'string' || typeof champ === 'number') return String(champ);
  if (champ.__cdata !== undefined) return String(champ.__cdata);
  if (champ['#text'] !== undefined) return String(champ['#text']);
  if (champ.language) {
    const langues = Array.isArray(champ.language) ? champ.language : [champ.language];
    const langue  = langues.find((l) => Number(l['@_id']) === 1) || langues[0];
    if (!langue) return '';
    if (langue.__cdata !== undefined) return String(langue.__cdata);
    if (langue['#text']  !== undefined) return String(langue['#text']);
    return String(langue);
  }
  return '';
}

// ─── Constantes exportées ─────────────────────────────────────
export const STATUT_PANIER_ID    = 10;
export const STATUT_PANIER_LABEL = 'Dans le panier';
export const STATUT_PAYE_ID      = 2;
export const STATUT_PAYE_LABEL   = 'Paiement effectué';
export const STATUT_ANNULE_ID    = 6;
export const STATUT_LIVRE_ID     = 5;

// Boutons d'action disponibles par état
export const ACTIONS_PAR_ETAT = {
  2: ['deliver', 'cancel'],   // Paiement accepté → livrer ou annuler
  3: ['deliver', 'cancel'],   // En préparation
  4: ['deliver', 'cancel'],   // Expédié
  5: [],                       // Livré — terminal
  6: [],                       // Annulé — terminal
};

export const ACTION_LABELS = {
  deliver: { label: 'Livrer',  icon: '✓', style: 'vert'  },
  cancel:  { label: 'Annuler', icon: '✕', style: 'rouge' },
  ship:    { label: 'Expédier',icon: '→', style: 'bleu'  },
};

const STATUTS_MODIFIABLES_IDS    = [STATUT_PAYE_ID, STATUT_ANNULE_ID, STATUT_LIVRE_ID];
const STATUTS_MODIFIABLES_LABELS = {
  [STATUT_PAYE_ID]:   STATUT_PAYE_LABEL,
  [STATUT_ANNULE_ID]: 'Annulé',
  [STATUT_LIVRE_ID]:  'Livré',
};

// ─── Statuts ──────────────────────────────────────────────────

export async function getStatutsCommande() {
  const data  = await prestaFetch('/order_states?display=full');
  const bruts = data.order_states?.order_state || [];
  const liste = Array.isArray(bruts) ? bruts : [bruts];
  return liste.map((s) => ({
    id:      Number(val(s.id)),
    name:    val(s.name),
    color:   val(s.color) || '#cccccc',
    paid:    val(s.paid)    === '1',
    shipped: val(s.shipped) === '1',
  }));
}

export async function getStatutsModifiables() {
  const data  = await prestaFetch('/order_states?display=full');
  const bruts = data.order_states?.order_state || [];
  const liste = Array.isArray(bruts) ? bruts : [bruts];
  return liste
    .filter((s) => STATUTS_MODIFIABLES_IDS.includes(Number(val(s.id))))
    .map((s) => {
      const id = Number(val(s.id));
      return { id, name: STATUTS_MODIFIABLES_LABELS[id] || val(s.name) };
    })
    .sort((a, b) =>
      STATUTS_MODIFIABLES_IDS.indexOf(a.id) - STATUTS_MODIFIABLES_IDS.indexOf(b.id)
    );
}

// ─── Cache clients ────────────────────────────────────────────

const clientCache = new Map();

async function getClientInfo(customerId) {
  if (!customerId || customerId === '0') return { id: '0', firstname: '', lastname: '', email: '' };
  if (clientCache.has(customerId)) return clientCache.get(customerId);
  try {
    const d = await prestaFetch(`/customers/${customerId}?display=full`);
    const c = d.customers?.customer?.[0] || d.customer || {};
    const info = { id: customerId, firstname: val(c.firstname), lastname: val(c.lastname), email: val(c.email) };
    clientCache.set(customerId, info);
    return info;
  } catch {
    return { id: customerId, firstname: '', lastname: '', email: '' };
  }
}

// ─── Cache prix / TVA ─────────────────────────────────────────

const prixCache      = new Map();
const taxRateCache   = new Map();
const specPriceCache = new Map();

async function getTaxRate(taxGroupId) {
  if (!taxGroupId || taxGroupId === 0) return 0;
  if (taxRateCache.has(taxGroupId)) return taxRateCache.get(taxGroupId);
  try {
    const dt  = await prestaFetch(`/tax_rules?filter[id_tax_rules_group]=${taxGroupId}&display=full`);
    const rl  = dt.tax_rules?.tax_rule || [];
    const rll = Array.isArray(rl) ? rl : [rl];
    if (!rll.length) { taxRateCache.set(taxGroupId, 0); return 0; }
    const taxId = Number(val(rll[0].id_tax));
    if (!taxId)  { taxRateCache.set(taxGroupId, 0); return 0; }
    const dtx  = await prestaFetch(`/taxes/${taxId}?display=full`);
    const tx   = dtx.tax?.[0] || dtx.tax;
    const rate = parseFloat(val(tx?.rate) || 0);
    taxRateCache.set(taxGroupId, rate);
    return rate;
  } catch { taxRateCache.set(taxGroupId, 0); return 0; }
}

async function chargerSpecificPrices(productId) {
  if (specPriceCache.has(productId)) return specPriceCache.get(productId);
  try {
    const d    = await prestaFetch(`/specific_prices?filter[id_product]=${productId}&display=full`);
    const list = d.specific_prices?.specific_price || [];
    const arr  = Array.isArray(list) ? list : (list ? [list] : []);
    specPriceCache.set(productId, arr);
    return arr;
  } catch { specPriceCache.set(productId, []); return []; }
}

function trouverSpecificPrice(sps, combinationId = 0) {
  if (!sps?.length) return null;
  const now    = new Date();
  const valides = sps.filter((sp) => {
    const fromOk  = !val(sp.from) || val(sp.from).startsWith('0000') || new Date(val(sp.from)) <= now;
    const toOk    = !val(sp.to)   || val(sp.to).startsWith('0000')   || new Date(val(sp.to))   >= now;
    const combiOk = Number(val(sp.id_product_attribute)) === 0 || Number(val(sp.id_product_attribute)) === combinationId;
    return fromOk && toOk && combiOk;
  });
  if (!valides.length) return null;
  return valides.find((sp) => Number(val(sp.id_product_attribute)) === combinationId && combinationId > 0) || valides[0];
}

function appliquerSpecificPrice(priceHT, sp) {
  if (!sp) return priceHT;
  const prixFixe = parseFloat(val(sp.price) || 0);
  if (prixFixe > 0) return prixFixe;
  const reduction     = parseFloat(val(sp.reduction) || 0);
  const reductionType = val(sp.reduction_type);
  if (!reduction) return priceHT;
  if (reductionType === 'percentage') return Math.max(0, priceHT * (1 - reduction));
  if (reductionType === 'amount')     return Math.max(0, priceHT - reduction);
  return priceHT;
}

async function getPrixTTC(productId, combinationId = '0') {
  const combiIdNum = Number(combinationId) || 0;
  const cacheKey   = `${productId}_${combiIdNum}`;
  if (prixCache.has(cacheKey)) return prixCache.get(cacheKey);
  try {
    const d    = await prestaFetch(`/products/${productId}?display=full`);
    const prod = d.product?.[0] || d.product;
    if (!prod) { prixCache.set(cacheKey, 0); return 0; }
    const priceHT    = parseFloat(val(prod.price) || 0);
    const taxGroupId = Number(val(prod.id_tax_rules_group));
    let priceAddiHT  = 0;
    if (combiIdNum > 0) {
      try {
        const dc   = await prestaFetch(`/combinations/${combiIdNum}?display=full`);
        const comb = dc.combination?.[0] || dc.combination;
        priceAddiHT = parseFloat(val(comb?.price) || 0);
      } catch { /* ignore */ }
    }
    const [taxRate, specificPrices] = await Promise.all([
      getTaxRate(taxGroupId),
      chargerSpecificPrices(productId),
    ]);
    const prixHTTotal = priceHT + priceAddiHT;
    const sp          = trouverSpecificPrice(specificPrices, combiIdNum);
    const prixHTNet   = appliquerSpecificPrice(prixHTTotal, sp);
    const prixTTC     = prixHTNet * (1 + taxRate / 100);
    prixCache.set(cacheKey, prixTTC);
    return prixTTC;
  } catch { prixCache.set(cacheKey, 0); return 0; }
}

// ─── ACTIONS COMMANDE (livrer / annuler) ──────────────────────

/**
 * Envoie une action de changement d'état via l'endpoint shiporder.php.
 *
 * @param {number} idOrder
 * @param {'deliver'|'cancel'|'ship'} action
 * @returns {Promise<{ success, current_state, state_name }>}
 */
export async function updateOrderAction(idOrder, action) {
  const res = await fetch(SHIP_ENDPOINT, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ id_order: idOrder, action }),
  });

  const data = await res.json();

  if (!res.ok || !data.success) {
    throw new Error(data.error || `shiporder HTTP ${res.status}`);
  }

  return {
    success:       data.success,
    current_state: data.current_state,
    state_name:    data.state_name,
    reference:     data.reference,
  };
}

/**
 * Garde l'ancienne fonction pour compatibilité avec le select de statut.
 * Utilise order_histories (API PS directe).
 */
export async function updateStatutCommande(id, statutId) {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<prestashop>
  <order_history>
    <id_order>${id}</id_order>
    <id_order_state>${statutId}</id_order_state>
  </order_history>
</prestashop>`;
  const response = await fetch(`/api/order_histories`, {
    method:  'POST',
    headers: { Authorization: getAuthHeader(), 'Content-Type': 'application/xml' },
    body:    xml,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(text);
  return { success: true };
}

// ─── PANIERS ABANDONNÉS ───────────────────────────────────────

export async function getCartsAbandonnes() {
  const ordersData  = await prestaFetch('/orders?display=[id,id_cart]');
  const ordresBruts = ordersData.orders?.order || [];
  const ordresListe = Array.isArray(ordresBruts) ? ordresBruts : [ordresBruts];
  const cartIdsAvecOrder = new Set(
    ordresListe.map((o) => String(val(o.id_cart))).filter(Boolean)
  );

  const cartsData  = await prestaFetch('/carts?display=full');
  const cartsBruts = cartsData.carts?.cart || [];
  const cartsListe = Array.isArray(cartsBruts) ? cartsBruts : [cartsBruts];

  const candidats = cartsListe.filter((c) => {
    const cartId     = String(val(c.id));
    const customerId = String(val(c.id_customer));
    if (cartIdsAvecOrder.has(cartId)) return false;
    if (customerId === '0') return false;
    const rows      = c.associations?.cart_rows?.cart_row || [];
    const rowsListe = Array.isArray(rows) ? rows : (rows ? [rows] : []);
    return rowsListe.reduce((s, r) => s + Number(val(r.quantity) || 0), 0) > 0;
  });

  const paniers = await Promise.all(
    candidats.map(async (c) => {
      const cartId     = val(c.id);
      const customerId = val(c.id_customer);
      const rows       = c.associations?.cart_rows?.cart_row || [];
      const rowsListe  = Array.isArray(rows) ? rows : (rows ? [rows] : []);
      const nbArticles = rowsListe.reduce((s, r) => s + Number(val(r.quantity) || 0), 0);

      const [client, ...montantsLignes] = await Promise.all([
        getClientInfo(customerId),
        ...rowsListe.map((r) =>
          getPrixTTC(val(r.id_product), val(r.id_product_attribute))
            .then((u) => u * Number(val(r.quantity) || 0))
        ),
      ]);

      const montantTotal = montantsLignes.reduce((s, m) => s + m, 0);

      return {
        id:          `cart_${cartId}`,
        cartId,
        id_customer: customerId,
        firstname:   client.firstname,
        lastname:    client.lastname,
        email:       client.email,
        date_add:    val(c.date_add),
        nbArticles,
        montantTotal,
        estPanier:   true,
      };
    })
  );

  paniers.sort((a, b) => new Date(b.date_add) - new Date(a.date_add));
  return paniers;
}

// ─── ORDERS ───────────────────────────────────────────────────

async function _chargerOrders() {
  const data   = await prestaFetch('/orders?display=full');
  const brutes = data.orders?.order || [];
  const liste  = Array.isArray(brutes) ? brutes : [brutes];

  return Promise.all(
    liste.map(async (c) => {
      const customerId = val(c.id_customer);
      const client     = await getClientInfo(customerId);
      return {
        id:            val(c.id),
        reference:     val(c.reference),
        current_state: val(c.current_state),
        date_add:      val(c.date_add),
        total_paid:    parseFloat(val(c.total_paid) || 0),
        id_customer:   customerId,
        payment:       val(c.payment),
        firstname:     client.firstname,
        lastname:      client.lastname,
        email:         client.email,
        estPanier:     false,
      };
    })
  );
}

export async function getCommandes({ page = 1, limit = 20, statut = '', recherche = '' } = {}) {
  const paniersSeulement   = statut === String(STATUT_PANIER_ID);
  const commandesSeulement = statut !== '' && !paniersSeulement;

  const [ordersRaw, paniersRaw] = await Promise.all([
    paniersSeulement   ? Promise.resolve([]) : _chargerOrders(),
    commandesSeulement ? Promise.resolve([]) : getCartsAbandonnes(),
  ]);

  let commandes = ordersRaw;
  if (statut && !paniersSeulement) {
    commandes = commandes.filter((c) => String(c.current_state) === statut);
  }
  if (recherche.trim()) {
    const r = recherche.toLowerCase();
    commandes = commandes.filter((c) =>
      `${c.firstname} ${c.lastname} ${c.reference} ${c.email}`.toLowerCase().includes(r)
    );
  }
  commandes.sort((a, b) => new Date(b.date_add) - new Date(a.date_add));
  const totalCommandes = commandes.length;
  const debut          = (page - 1) * limit;

  let paniers = paniersRaw;
  if (recherche.trim()) {
    const r = recherche.toLowerCase();
    paniers = paniers.filter((p) =>
      `${p.firstname} ${p.lastname} ${p.email} ${p.cartId}`.toLowerCase().includes(r)
    );
  }

  return {
    commandes:      commandes.slice(debut, debut + limit),
    paniers,
    totalCommandes,
    totalPaniers:   paniers.length,
    pages:          Math.ceil(totalCommandes / limit) || 1,
  };
}

export async function getDashboardData(date = '') {
  const [orders, paniers] = await Promise.all([_chargerOrders(), getCartsAbandonnes()]);
  const filtrer = (l) => date ? l.filter((c) => c.date_add?.startsWith(date)) : l;
  return { commandes: filtrer(orders), paniers: filtrer(paniers) };
}

// ─── STATISTIQUES ─────────────────────────────────────────────

/**
 * Calcule pour chaque catégorie :
 *   - CA HT (chiffre d'affaires hors taxe = prix_vente_HT × qté vendue)
 *   - Coût achat HT (wholesale_price × qté vendue)
 *   - Bénéfice HT = CA − Coût achat
 *
 * Source : toutes les order_rows des commandes non annulées.
 * Les commandes annulées (state=6) sont exclues.
 *
 * @returns {Promise<StatParCategorie[]>}
 */
export async function getStatistiques() {
  // ── 1. Charger produits (prix HT, wholesale, catégorie) ───
  const prodsData  = await prestaFetch('/products?display=full');
  const prodsBruts = prodsData.products?.product || [];
  const prodsList  = Array.isArray(prodsBruts) ? prodsBruts : [prodsBruts];

  // Map productId → { priceHT, wholesalePrice, idCategory, name }
  const prodMap = new Map();
  for (const p of prodsList) {
    const id = Number(val(p.id));
    prodMap.set(id, {
      id,
      name:          val(p.name),
      priceHT:       parseFloat(val(p.price)           || 0),
      wholesalePrice: parseFloat(val(p.wholesale_price) || 0),
      idCategory:    Number(val(p.id_category_default)),
    });
  }

  // ── 2. Charger catégories (id → nom) ──────────────────────
  const catsData  = await prestaFetch('/categories?display=full');
  const catsBruts = catsData.categories?.category || [];
  const catsList  = Array.isArray(catsBruts) ? catsBruts : [catsBruts];

  const catMap = new Map();
  for (const c of catsList) {
    const id  = Number(val(c.id));
    const nom = val(c.name).trim();
    if (id && nom) catMap.set(id, nom);
  }

  // ── 3. Charger les commandes non annulées ─────────────────
  const ordersData  = await prestaFetch('/orders?display=full');
  const ordersBruts = ordersData.orders?.order || [];
  const ordersList  = Array.isArray(ordersBruts) ? ordersBruts : [ordersBruts];

  const commandesActives = ordersList.filter(
    (o) => Number(val(o.current_state)) !== STATUT_ANNULE_ID
  );

  // ── 4. Agréger par catégorie ──────────────────────────────
  // Map catId → { nomCat, caHT, coutAchatHT, nbVentes }
  const statsMap = new Map();

  for (const order of commandesActives) {
    const rows      = order.associations?.order_rows?.order_row || [];
    const rowsList  = Array.isArray(rows) ? rows : (rows ? [rows] : []);

    for (const row of rowsList) {
      const productId = Number(val(row.product_id));
      const quantite  = Number(val(row.product_quantity)) || 0;

      // Prix unitaire HT de vente depuis la commande (le plus fiable)
      const unitPrixHTVente = parseFloat(val(row.unit_price_tax_excl) || 0);

      // Wholesale depuis le catalogue produit
      const prodInfo       = prodMap.get(productId);
      const wholesaleHT    = prodInfo?.wholesalePrice ?? 0;
      const idCategory     = prodInfo?.idCategory ?? 0;
      const nomCategorie   = catMap.get(idCategory) || `Catégorie #${idCategory}`;

      if (!idCategory) continue;

      if (!statsMap.has(idCategory)) {
        statsMap.set(idCategory, {
          idCategorie:  idCategory,
          nomCategorie,
          caHT:         0,
          coutAchatHT:  0,
          nbVentes:     0,
        });
      }

      const entry = statsMap.get(idCategory);
      entry.caHT        += unitPrixHTVente * quantite;
      entry.coutAchatHT += wholesaleHT     * quantite;
      entry.nbVentes    += quantite;
    }
  }

  // ── 5. Calculer bénéfice + formater ──────────────────────
  const stats = [...statsMap.values()].map((s) => ({
    ...s,
    caHT:         Math.round(s.caHT        * 100) / 100,
    coutAchatHT:  Math.round(s.coutAchatHT * 100) / 100,
    beneficeHT:   Math.round((s.caHT - s.coutAchatHT) * 100) / 100,
    margePercent: s.caHT > 0
      ? Math.round(((s.caHT - s.coutAchatHT) / s.caHT) * 10000) / 100
      : 0,
  }));

  // Trier par CA décroissant
  stats.sort((a, b) => b.caHT - a.caHT);

  // Totaux globaux
  const totaux = {
    caHT:        stats.reduce((s, e) => s + e.caHT,        0),
    coutAchatHT: stats.reduce((s, e) => s + e.coutAchatHT, 0),
    beneficeHT:  stats.reduce((s, e) => s + e.beneficeHT,  0),
    nbVentes:    stats.reduce((s, e) => s + e.nbVentes,    0),
  };
  totaux.caHT        = Math.round(totaux.caHT        * 100) / 100;
  totaux.coutAchatHT = Math.round(totaux.coutAchatHT * 100) / 100;
  totaux.beneficeHT  = Math.round(totaux.beneficeHT  * 100) / 100;
  totaux.margePercent = totaux.caHT > 0
    ? Math.round(((totaux.beneficeHT / totaux.caHT) * 10000)) / 100
    : 0;

  return { stats, totaux };
}

// ─── STOCK PAR CATÉGORIE ──────────────────────────────────────

/**
 * Retourne pour chaque catégorie :
 *   - qtyPhysique   : stock en ps_stock_available (toutes combis confondues)
 *   - qtyReservee   : articles dans des paniers actifs (carts non commandés)
 *   - qtyDisponible : qtyPhysique − qtyReservee
 *
 * @returns {Promise<StockCategorie[]>}
 */
export async function getStockParCategorie() {
  // ── 1. Produits + catégories ──────────────────────────────
  const [prodsData, catsData, stocksData, cartsData, ordersData] = await Promise.all([
    prestaFetch('/products?display=full'),
    prestaFetch('/categories?display=full'),
    prestaFetch('/stock_availables?display=full'),
    prestaFetch('/carts?display=full'),
    prestaFetch('/orders?display=[id,id_cart]'),
  ]);

  const prodsList  = Array.isArray(prodsData.products?.product)    ? prodsData.products.product    : [];
  const catsList   = Array.isArray(catsData.categories?.category)  ? catsData.categories.category  : [];
  const stocksList = Array.isArray(stocksData.stock_availables?.stock_available)
    ? stocksData.stock_availables.stock_available : [];
  const cartsList  = Array.isArray(cartsData.carts?.cart) ? cartsData.carts.cart : [];

  // Carts déjà rattachés à une order
  const ordresList = Array.isArray(ordersData.orders?.order) ? ordersData.orders.order : [];
  const cartIdsAvecOrder = new Set(ordresList.map((o) => String(val(o.id_cart))));

  // ── 2. Map catId → nomCat ─────────────────────────────────
  const catMap = new Map();
  for (const c of catsList) {
    catMap.set(Number(val(c.id)), val(c.name).trim());
  }

  // ── 3. Map productId → idCategorie ────────────────────────
  const prodCatMap = new Map();
  for (const p of prodsList) {
    prodCatMap.set(Number(val(p.id)), Number(val(p.id_category_default)));
  }

  // ── 4. Stock physique par catégorie ───────────────────────
  // Sommer tous les stock_availables par catégorie du produit
  // (id_shop=1 prioritaire si doublon)
  const stockParProdCombi = new Map(); // `${pid}_${cid}` → { qty, shopId }
  for (const s of stocksList) {
    const pid    = Number(val(s.id_product));
    const cid    = Number(val(s.id_product_attribute));
    const qty    = Number(val(s.quantity));
    const shopId = Number(val(s.id_shop));
    const key    = `${pid}_${cid}`;
    const ex     = stockParProdCombi.get(key);
    if (!ex || (shopId === 1 && ex.shopId !== 1)) {
      stockParProdCombi.set(key, { qty, shopId });
    }
  }

  // Agréger par catégorie
  const stockPhysiqueParCat = new Map(); // catId → qty
  for (const [key, { qty }] of stockParProdCombi) {
    const pid   = Number(key.split('_')[0]);
    const catId = prodCatMap.get(pid);
    if (!catId) continue;
    stockPhysiqueParCat.set(catId, (stockPhysiqueParCat.get(catId) ?? 0) + qty);
  }

  // ── 5. Quantités réservées (dans des paniers actifs) ──────
  // Paniers sans order, avec client réel
  const paniersActifs = cartsList.filter((c) => {
    const cartId     = String(val(c.id));
    const customerId = String(val(c.id_customer));
    return !cartIdsAvecOrder.has(cartId) && customerId !== '0';
  });

  const reserveParCat = new Map(); // catId → qty
  for (const cart of paniersActifs) {
    const rows      = cart.associations?.cart_rows?.cart_row || [];
    const rowsList2 = Array.isArray(rows) ? rows : (rows ? [rows] : []);
    for (const row of rowsList2) {
      const pid   = Number(val(row.id_product));
      const qty   = Number(val(row.quantity)) || 0;
      const catId = prodCatMap.get(pid);
      if (catId && qty > 0) {
        reserveParCat.set(catId, (reserveParCat.get(catId) ?? 0) + qty);
      }
    }
  }

  // ── 6. Construire le résultat ─────────────────────────────
  const toutesLesCatIds = new Set([
    ...stockPhysiqueParCat.keys(),
    ...reserveParCat.keys(),
  ]);

  const result = [...toutesLesCatIds]
    .map((catId) => {
      const nomCategorie  = catMap.get(catId) || `Catégorie #${catId}`;
      const qtyPhysique   = stockPhysiqueParCat.get(catId) ?? 0;
      const qtyReservee   = reserveParCat.get(catId)       ?? 0;
      const qtyDisponible = Math.max(0, qtyPhysique - qtyReservee);
      return { idCategorie: catId, nomCategorie, qtyPhysique, qtyReservee, qtyDisponible };
    })
    .filter((r) => r.qtyPhysique > 0 || r.qtyReservee > 0)
    .sort((a, b) => a.nomCategorie.localeCompare(b.nomCategorie));

  return result;
}

export async function getCommandesParDate(date) {
  const data   = await prestaFetch('/orders?display=full');
  const brutes = data.orders?.order || [];
  const liste  = Array.isArray(brutes) ? brutes : [brutes];
  return liste
    .map((c) => ({
      id:            val(c.id),
      reference:     val(c.reference),
      current_state: val(c.current_state),
      date_add:      val(c.date_add),
      total_paid:    parseFloat(val(c.total_paid) || 0),
    }))
    .filter((c) => !date || c.date_add?.startsWith(date));
}