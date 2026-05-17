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
     'tax_rule', 'stock_available', 'cart_rule'].includes(tagName),
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

// ─── CACHES PRIX ──────────────────────────────────────────────

const prixCache        = new Map(); // `${productId}_${combiId}` → prixTTC
const taxRateCache     = new Map(); // taxGroupId → taux
const specPriceCache   = new Map(); // productId  → specific_price[]

// ── TVA (cache) ───────────────────────────────────────────────

async function getTaxRate(taxGroupId) {
  if (!taxGroupId || taxGroupId === 0) return 0;
  if (taxRateCache.has(taxGroupId)) return taxRateCache.get(taxGroupId);
  try {
    const dt  = await prestaFetch(`/tax_rules?filter[id_tax_rules_group]=${taxGroupId}&display=full`);
    const rl  = dt.tax_rules?.tax_rule || [];
    const rll = Array.isArray(rl) ? rl : [rl];
    if (!rll.length) { taxRateCache.set(taxGroupId, 0); return 0; }
    const taxId = Number(val(rll[0].id_tax));
    if (!taxId) { taxRateCache.set(taxGroupId, 0); return 0; }
    const dtx   = await prestaFetch(`/taxes/${taxId}?display=full`);
    const tx    = dtx.tax?.[0] || dtx.tax;
    const rate  = parseFloat(val(tx?.rate) || 0);
    taxRateCache.set(taxGroupId, rate);
    return rate;
  } catch {
    taxRateCache.set(taxGroupId, 0);
    return 0;
  }
}

// ── Specific prices (cache) ───────────────────────────────────

async function chargerSpecificPrices(productId) {
  if (specPriceCache.has(productId)) return specPriceCache.get(productId);
  try {
    const data = await prestaFetch(`/specific_prices?filter[id_product]=${productId}&display=full`);
    const list = data.specific_prices?.specific_price || [];
    const arr  = Array.isArray(list) ? list : (list ? [list] : []);
    specPriceCache.set(productId, arr);
    return arr;
  } catch {
    specPriceCache.set(productId, []);
    return [];
  }
}

/**
 * Identique à productsService.trouverSpecificPrice :
 * trouve le specific_price valide pour (produit, combinaison),
 * en vérifiant les dates et en priorisant la combi exacte.
 */
function trouverSpecificPrice(specificPrices, combinationId = 0) {
  if (!specificPrices?.length) return null;
  const now = new Date();

  const valides = specificPrices.filter((sp) => {
    const from    = val(sp.from);
    const to      = val(sp.to);
    const fromOk  = !from || from.startsWith('0000') || new Date(from) <= now;
    const toOk    = !to   || to.startsWith('0000')   || new Date(to)   >= now;
    const idCombi = Number(val(sp.id_product_attribute));
    const combiOk = idCombi === 0 || idCombi === combinationId;
    return fromOk && toOk && combiOk;
  });

  if (!valides.length) return null;
  const exact = valides.find(
    (sp) => Number(val(sp.id_product_attribute)) === combinationId && combinationId > 0
  );
  return exact || valides[0];
}

/**
 * Identique à productsService.appliquerSpecificPrice :
 * applique la réduction sur le prix HT et retourne le prix HT net.
 *   - price > 0         → prix fixe HT
 *   - percentage        → HT × (1 - reduction)
 *   - amount            → HT − reduction
 */
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

/**
 * Retourne le prix TTC final d'un produit/combinaison,
 * en appliquant les specific_prices (promos) exactement comme
 * productsService.js le fait côté frontoffice.
 *
 * Logique :
 *   1. priceHT       = product.price (HT de base)
 *   2. priceAddiHT   = combination.price (supplément HT, 0 si produit simple)
 *   3. prixHTTotal   = priceHT + priceAddiHT
 *   4. sp            = specific_price pour (produit, combinaison)
 *   5. prixHTNet     = appliquerSpecificPrice(prixHTTotal, sp)
 *   6. prixTTC       = prixHTNet × (1 + taxRate/100)
 */
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

    // Prix additionnel de la combinaison
    let priceAddiHT = 0;
    if (combiIdNum > 0) {
      try {
        const dc   = await prestaFetch(`/combinations/${combiIdNum}?display=full`);
        const comb = dc.combination?.[0] || dc.combination;
        priceAddiHT = parseFloat(val(comb?.price) || 0);
      } catch { /* ignore */ }
    }

    // TVA + specific_prices en parallèle
    const [taxRate, specificPrices] = await Promise.all([
      getTaxRate(taxGroupId),
      chargerSpecificPrices(productId),
    ]);

    // Appliquer la promo sur le HT total (base + supplément combi)
    const prixHTTotal = priceHT + priceAddiHT;
    const sp          = trouverSpecificPrice(specificPrices, combiIdNum);
    const prixHTNet   = appliquerSpecificPrice(prixHTTotal, sp);
    const prixTTC     = prixHTNet * (1 + taxRate / 100);

    prixCache.set(cacheKey, prixTTC);
    return prixTTC;
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

      // Client + prix lignes en parallèle
      const [client, ...montantsLignes] = await Promise.all([
        getClientInfo(customerId),
        ...rowsListe.map((r) =>
          getPrixTTC(val(r.id_product), val(r.id_product_attribute))
            .then((u) => u * Number(val(r.quantity) || 0))
        ),
      ]);

      const sousTotal = montantsLignes.reduce((s, m) => s + m, 0);

      // ── Réductions cart_rules ──────────────────────────────────────────────
      // GET /carts/:id retourne les associations complètes dont cart_rules.
      // /carts?display=full ne les inclut pas toujours selon la version PS.
      // On fetch donc le cart individuel pour être sûr d'avoir les règles.
      let totalReductions = 0;
      let cartRulesDetail = [];

      try {
        const cartDetail     = await prestaFetch(`/carts/${cartId}?display=full`);
        const cartObj        = cartDetail.cart?.[0] || cartDetail.cart || {};
        const cartRuleAssocs = cartObj.associations?.cart_rules?.cart_rule || [];
        const cartRuleListe  = Array.isArray(cartRuleAssocs)
          ? cartRuleAssocs
          : (cartRuleAssocs ? [cartRuleAssocs] : []);

        if (cartRuleListe.length > 0) {
          const reductions = await Promise.all(
            cartRuleListe.map(async (cr) => {
              const ruleId = val(cr.id);
              if (!ruleId || ruleId === '0') return { montant: 0, nom: '' };

              try {
                const d    = await prestaFetch(`/cart_rules/${ruleId}?display=full`);
                const rule = d.cart_rule?.[0] || d.cart_rule;
                if (!rule) return { montant: 0, nom: '' };

                const nom              = val(rule.name) || `Promo #${ruleId}`;
                const reductionPercent = parseFloat(val(rule.reduction_percent) || 0);
                const reductionAmount  = parseFloat(val(rule.reduction_amount)  || 0);
                const freeShipping     = val(rule.free_shipping) === '1';

                let montant = 0;

                if (reductionPercent > 0) {
                  // % appliqué sur le sous-total TTC (identique à PS)
                  montant = sousTotal * (reductionPercent / 100);

                } else if (reductionAmount > 0) {
                  // Montant fixe.
                  // reduction_tax = 1 → montant déjà en TTC
                  // reduction_tax = 0 → montant en HT → convertir en TTC
                  //
                  // Pour HT→TTC on utilise le taux TVA du produit de réduction
                  // si id_reduction_product est spécifié, sinon taux moyen du panier.
                  const isTTC = val(rule.reduction_tax) === '1';
                  if (isTTC) {
                    montant = reductionAmount;
                  } else {
                    // Taux moyen du panier = sousTotal_TTC / sousTotal_HT
                    // sousTotal_HT : on refetch les prix HT depuis le cache produit
                    // (les produits sont déjà en cache après getPrixTTC ci-dessus)
                    const sousTotalHTLignes = await Promise.all(
                      rowsListe.map(async (r) => {
                        const pid  = val(r.id_product);
                        const d2   = await prestaFetch(`/products/${pid}?display=full`);
                        const prod = d2.product?.[0] || d2.product;
                        const ht   = parseFloat(val(prod?.price) || 0);
                        // + supplément combi HT si besoin
                        let addi = 0;
                        const cid = Number(val(r.id_product_attribute));
                        if (cid > 0) {
                          try {
                            const dc   = await prestaFetch(`/combinations/${cid}?display=full`);
                            const comb = dc.combination?.[0] || dc.combination;
                            addi = parseFloat(val(comb?.price) || 0);
                          } catch { /* ignore */ }
                        }
                        // Appliquer specific_price sur le HT aussi (cohérence)
                        const sp2       = await chargerSpecificPrices(Number(pid));
                        const spR       = trouverSpecificPrice(sp2, cid);
                        const htNet     = appliquerSpecificPrice(ht + addi, spR);
                        return htNet * Number(val(r.quantity) || 0);
                      })
                    );
                    const sousTotalHT = sousTotalHTLignes.reduce((s, v) => s + v, 0);
                    // Ratio TTC/HT du panier entier
                    const ratioTTC = sousTotalHT > 0 ? sousTotal / sousTotalHT : 1;
                    montant = reductionAmount * ratioTTC;
                  }
                }

                // Plafonner à la valeur du panier
                montant = Math.min(montant, sousTotal);
                return { montant, nom, freeShipping };
              } catch {
                return { montant: 0, nom: '' };
              }
            })
          );

          cartRulesDetail = reductions.filter((r) => r.montant > 0 || r.freeShipping);
          totalReductions = reductions.reduce((s, r) => s + (r.montant || 0), 0);
        }
      } catch {
        // Si le fetch du cart individuel échoue, on continue sans réduction
      }

      // Montant final = sous-total − réductions (plancher à 0)
      const montantTotal = Math.max(0, sousTotal - totalReductions);

      return {
        id:             `cart_${cartId}`,
        cartId,
        id_customer:    customerId,
        firstname:      client.firstname,
        lastname:       client.lastname,
        email:          client.email,
        date_add:       val(c.date_add),
        date_upd:       val(c.date_upd),
        nbArticles,
        sousTotal,          // montant brut avant réductions
        totalReductions,    // montant total déduit
        montantTotal,       // montant net après réductions
        promos:         cartRulesDetail, // [{ nom, montant, freeShipping }]
        estPanier:      true,
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