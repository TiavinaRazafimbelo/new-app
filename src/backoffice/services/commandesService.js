/**
 * commandesService.js
 * ─────────────────────────────────────────────────────────────
 * MODIFICATION v5 :
 *   - getCartsAbandonnes() :
 *       • Exclut les carts déjà rattachés à une order
 *       • Exclut les carts vides (nbArticles === 0)
 *       • Calcule le montant total (prix TTC × qté par ligne)
 *   - getCommandes() retourne { commandes, paniers } SÉPARÉMENT
 *   - getDashboardData() : idem
 * ─────────────────────────────────────────────────────────────
 */

import { XMLParser } from 'fast-xml-parser';

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
    ['order', 'order_state', 'language', 'history', 'cart', 'cart_row',
     'tax_rule', 'stock_available'].includes(tagName),
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
  if (import.meta.env.DEV) console.debug(`[prestaFetch] ${endpoint}`, xmlText.slice(0, 300));

  const parsed = parser.parse(xmlText);
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

// Seuls ces statuts sont proposés dans le select de modification
const STATUTS_MODIFIABLES_IDS = [STATUT_PAYE_ID, STATUT_ANNULE_ID];
const STATUTS_MODIFIABLES_LABELS = {
  [STATUT_PAYE_ID]:   STATUT_PAYE_LABEL,
  [STATUT_ANNULE_ID]: 'Annulé',
};

// ─── STATUTS ──────────────────────────────────────────────────

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

// ─── CACHE CLIENTS ────────────────────────────────────────────

const clientCache = new Map();

async function getClientInfo(customerId) {
  if (!customerId || customerId === '0') return { id: '0', firstname: '', lastname: '', email: '' };
  if (clientCache.has(customerId)) return clientCache.get(customerId);
  try {
    const d = await prestaFetch(`/customers/${customerId}?display=full`);
    const c = d.customers?.customer?.[0] || d.customer || {};
    const info = {
      id:        customerId,
      firstname: val(c.firstname),
      lastname:  val(c.lastname),
      email:     val(c.email),
    };
    clientCache.set(customerId, info);
    return info;
  } catch {
    return { id: customerId, firstname: '', lastname: '', email: '' };
  }
}

// ─── CACHE PRIX PRODUITS TTC ──────────────────────────────────

const prixCache = new Map();

/**
 * Retourne le prix TTC d'un produit/combinaison.
 * Prix HT (+ supplément combi) × (1 + taux TVA / 100)
 */
async function getPrixTTC(productId, combinationId = '0') {
  const cacheKey = `${productId}_${combinationId}`;
  if (prixCache.has(cacheKey)) return prixCache.get(cacheKey);

  try {
    const d    = await prestaFetch(`/products/${productId}?display=full`);
    const prod = d.product?.[0] || d.product;
    if (!prod) { prixCache.set(cacheKey, 0); return 0; }

    const priceHT = parseFloat(val(prod.price) || 0);

    // Prix additionnel de la combinaison
    let priceAddiHT = 0;
    if (combinationId && combinationId !== '0') {
      try {
        const dc   = await prestaFetch(`/combinations/${combinationId}?display=full`);
        const comb = dc.combination?.[0] || dc.combination;
        priceAddiHT = parseFloat(val(comb?.price) || 0);
      } catch { /* ignore */ }
    }

    // Taux TVA
    const taxGroupId = Number(val(prod.id_tax_rules_group));
    let taxRate = 0;
    if (taxGroupId) {
      try {
        const dt   = await prestaFetch(`/tax_rules?filter[id_tax_rules_group]=${taxGroupId}&display=full`);
        const rl   = dt.tax_rules?.tax_rule || [];
        const rll  = Array.isArray(rl) ? rl : [rl];
        if (rll.length) {
          const taxId = Number(val(rll[0].id_tax));
          if (taxId) {
            const dtx = await prestaFetch(`/taxes/${taxId}?display=full`);
            const tx  = dtx.tax?.[0] || dtx.tax;
            taxRate   = parseFloat(val(tx?.rate) || 0);
          }
        }
      } catch { /* ignore */ }
    }

    const priceTTC = (priceHT + priceAddiHT) * (1 + taxRate / 100);
    prixCache.set(cacheKey, priceTTC);
    return priceTTC;
  } catch {
    prixCache.set(cacheKey, 0);
    return 0;
  }
}

// ─── PANIERS ABANDONNÉS ───────────────────────────────────────

/**
 * Carts sans order associée, non vides, avec client réel.
 * Calcule nbArticles et montantTotal (TTC).
 */
export async function getCartsAbandonnes() {
  // IDs de carts déjà rattachés à une order
  const ordersData  = await prestaFetch('/orders?display=[id,id_cart]');
  const ordresBruts = ordersData.orders?.order || [];
  const ordresListe = Array.isArray(ordresBruts) ? ordresBruts : [ordresBruts];
  const cartIdsAvecOrder = new Set(
    ordresListe.map((o) => String(val(o.id_cart))).filter(Boolean)
  );

  // Tous les carts
  const cartsData  = await prestaFetch('/carts?display=full');
  const cartsBruts = cartsData.carts?.cart || [];
  const cartsListe = Array.isArray(cartsBruts) ? cartsBruts : [cartsBruts];

  // Filtrer : pas d'order, client réel, au moins 1 article
  const candidats = cartsListe.filter((c) => {
    const cartId     = String(val(c.id));
    const customerId = String(val(c.id_customer));
    if (cartIdsAvecOrder.has(cartId)) return false;
    if (customerId === '0') return false;

    const rows      = c.associations?.cart_rows?.cart_row || [];
    const rowsListe = Array.isArray(rows) ? rows : (rows ? [rows] : []);
    const nbArticles = rowsListe.reduce((s, r) => s + Number(val(r.quantity) || 0), 0);
    return nbArticles > 0;
  });

  // Enrichir en parallèle
  const paniers = await Promise.all(
    candidats.map(async (c) => {
      const cartId     = val(c.id);
      const customerId = val(c.id_customer);

      const rows      = c.associations?.cart_rows?.cart_row || [];
      const rowsListe = Array.isArray(rows) ? rows : (rows ? [rows] : []);
      const nbArticles = rowsListe.reduce((s, r) => s + Number(val(r.quantity) || 0), 0);

      // Client + prix en parallèle
      const [client, ...montantsLignes] = await Promise.all([
        getClientInfo(customerId),
        ...rowsListe.map((r) =>
          getPrixTTC(val(r.id_product), val(r.id_product_attribute))
            .then((u) => u * Number(val(r.quantity) || 0))
        ),
      ]);

      const montantTotal = montantsLignes.reduce((s, m) => s + m, 0);

      return {
        id:           `cart_${cartId}`,
        cartId,
        id_customer:  customerId,
        firstname:    client.firstname,
        lastname:     client.lastname,
        email:        client.email,
        date_add:     val(c.date_add),
        date_upd:     val(c.date_upd),
        nbArticles,
        montantTotal,
        estPanier:    true,
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
        date_upd:      val(c.date_upd),
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

// ─── getCommandes — retourne orders ET paniers SÉPARÉMENT ─────

/**
 * @returns {{
 *   commandes: Array,    orders filtrées + paginées
 *   paniers:   Array,    carts abandonnés filtrés (tous, pas paginés)
 *   totalCommandes: number,
 *   totalPaniers:   number,
 *   pages:          number,
 * }}
 */
export async function getCommandes({
  page      = 1,
  limit     = 20,
  statut    = '',
  recherche = '',
} = {}) {
  const paniersSeulement    = statut === String(STATUT_PANIER_ID);
  const commandesSeulement  = statut !== '' && !paniersSeulement;

  const [ordersRaw, paniersRaw] = await Promise.all([
    paniersSeulement   ? Promise.resolve([]) : _chargerOrders(),
    commandesSeulement ? Promise.resolve([]) : getCartsAbandonnes(),
  ]);

  // Filtrer les commandes
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
  const commandesPage  = commandes.slice(debut, debut + limit);

  // Filtrer les paniers
  let paniers = paniersRaw;
  if (recherche.trim()) {
    const r = recherche.toLowerCase();
    paniers = paniers.filter((p) =>
      `${p.firstname} ${p.lastname} ${p.email} ${p.cartId}`.toLowerCase().includes(r)
    );
  }

  return {
    commandes:      commandesPage,
    paniers,
    totalCommandes,
    totalPaniers:   paniers.length,
    pages:          Math.ceil(totalCommandes / limit) || 1,
  };
}

// ─── DONNÉES DASHBOARD ────────────────────────────────────────

export async function getDashboardData(date = '') {
  const [orders, paniers] = await Promise.all([
    _chargerOrders(),
    getCartsAbandonnes(),
  ]);
  const filtrer = (l) => date ? l.filter((c) => c.date_add?.startsWith(date)) : l;
  return { commandes: filtrer(orders), paniers: filtrer(paniers) };
}

// ─── MODIFIER STATUT COMMANDE ─────────────────────────────────

export async function updateStatutCommande(id, statutId) {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<prestashop>
  <order_history>
    <id_order>${id}</id_order>
    <id_order_state>${statutId}</id_order_state>
  </order_history>
</prestashop>`;

  const response = await fetch(`/api/order_histories`, {
    method: 'POST',
    headers: { Authorization: getAuthHeader(), 'Content-Type': 'application/xml' },
    body: xml,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(text);
  return { success: true };
}

// ─── LEGACY ───────────────────────────────────────────────────

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