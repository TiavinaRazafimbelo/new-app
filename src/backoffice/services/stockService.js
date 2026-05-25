/**
 * stockService.js
 * ─────────────────────────────────────────────────────────────
 * Service de gestion du stock PrestaShop.
 *
 * STRATEGIE :
 *   - Lecture stock    : GET /api/stock_availables (API PS)
 *   - Ecriture stock   : POST /updatestock (fichier standalone PS)
 *   - Historique       : GET /updatestock?action=history (depuis ps_stock_mvt_backoffice)
 *
 * REGLES :
 *   - Seul le mode delta est supporte (pas de valeur absolue)
 *   - Si aucune ligne stock n'existe → erreur bloquante
 *   - Pas de sessionStorage ni de snapshot
 *
 * CORRECTIFS :
 *   - normalizeAttrId() : '' et null/undefined → '0' de façon cohérente
 *   - findStockItem()   : utilise normalizeAttrId des deux côtés
 *   - getStockHistory() : idem, id_product_attribute toujours un entier
 * ─────────────────────────────────────────────────────────────
 */

const API_KEY        = import.meta.env.VITE_PRESTA_API_KEY;
const BASE_URL       = '/api';
const STOCK_ENDPOINT = '/updatestock';

// ─── Auth ─────────────────────────────────────────────────────

function getAuthHeader() {
  return 'Basic ' + btoa(`${API_KEY}:`);
}

// ─── Helper : normalisation id_product_attribute ─────────────
/**
 * Toute valeur absente / vide / '0' / 0 → '0'.
 * Évite les bugs de comparaison '' vs '0' vs 0.
 */
function normalizeAttrId(combiId) {
  const n = parseInt(combiId, 10);
  return isNaN(n) || n === 0 ? '0' : String(n);
}

// ─── Helpers XML (lecture) ────────────────────────────────────

async function prestaGet(endpoint) {
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    headers: { Authorization: getAuthHeader(), Accept: 'application/xml' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${endpoint}`);
  return res.text();
}

function xmlVal(xml, tag) {
  const m = xml.match(
    new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?(.*?)(?:\\]\\]>)?<\\/${tag}>`, 's')
  );
  return m ? m[1].trim() : '';
}

function xmlValLang(xml, tag, langId = 1) {
  const re = new RegExp(
    `<${tag}[^>]*>[\\s\\S]*?<language id="${langId}"[^>]*>(?:<!\\[CDATA\\[)?(.*?)(?:\\]\\]>)?<\\/language>`,
    's'
  );
  const m = xml.match(re);
  if (m) return m[1].trim();
  return xmlVal(xml, tag);
}

function parseStockAvailables(xml) {
  const blocks = [...xml.matchAll(/<stock_available[^>]*>([\s\S]*?)<\/stock_available>/g)];
  return blocks.map((b) => {
    const inner = b[1];
    return {
      id:                   xmlVal(inner, 'id'),
      id_product:           xmlVal(inner, 'id_product'),
      id_product_attribute: xmlVal(inner, 'id_product_attribute'),
      quantity:             parseInt(xmlVal(inner, 'quantity') || '0'),
      id_shop:              xmlVal(inner, 'id_shop') || '1',
    };
  }).filter((s) => s.id);
}

// ─── PRODUITS ─────────────────────────────────────────────────

export async function getProductsForStock() {
  const xml    = await prestaGet('/products?display=[id,name,reference]');
  const blocks = [...xml.matchAll(/<product[^>]*>([\s\S]*?)<\/product>/g)];

  return blocks
    .map((b) => {
      const inner = b[1];
      return {
        id:        xmlVal(inner, 'id'),
        name:      xmlValLang(inner, 'name') || xmlVal(inner, 'name'),
        reference: xmlVal(inner, 'reference'),
      };
    })
    .filter((p) => p.id)
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ─── COMBINAISONS ─────────────────────────────────────────────

export async function getCombinaisonsForStock(productId) {
  try {
    const xml    = await prestaGet(
      `/combinations?filter[id_product]=${productId}&display=full`
    );
    const blocks = [...xml.matchAll(/<combination[^>]*>([\s\S]*?)<\/combination>/g)];

    return blocks.map((b) => {
      const inner = b[1];
      const id    = xmlVal(inner, 'id');
      const ref   = xmlVal(inner, 'reference');
      return {
        id,
        reference: ref,
        label:     ref || `Combi #${id}`,
      };
    }).filter((c) => c.id);
  } catch {
    return [];
  }
}

// ─── STOCKS (lecture) ─────────────────────────────────────────

export async function getStocksForProduct(productId) {
  const xml    = await prestaGet(
    `/stock_availables?filter[id_product]=${productId}&filter[id_shop]=1&display=full`
  );
  const stocks = parseStockAvailables(xml);

  // Dédupliquer : on préfère toujours la ligne id_shop=1
  const map = new Map();
  for (const s of stocks) {
    const key      = normalizeAttrId(s.id_product_attribute);
    const existing = map.get(key);
    if (!existing) {
      map.set(key, s);
    } else if (Number(s.id_shop) === 1 && Number(existing.id_shop) !== 1) {
      map.set(key, s);
    }
  }

  return [...map.values()];
}

/**
 * Trouve la ligne de stock correspondant à une combinaison.
 * combiId vide / null / 0 → cherche la ligne "produit de base" (id_product_attribute=0).
 */
export function findStockItem(stocks, combiId) {
  const target = normalizeAttrId(combiId);
  return (
    stocks.find((s) => normalizeAttrId(s.id_product_attribute) === target) || null
  );
}

// ─── MISE À JOUR STOCK (delta uniquement) ────────────────────

/**
 * Applique un delta de stock via l'endpoint custom PS.
 *
 * @param {Object|null} stockItem  - ligne stock lue en amont (null = bloquant)
 * @param {string}      productId
 * @param {string}      combiId
 * @param {number}      delta      - positif = ajout, negatif = retrait
 * @returns {Promise<{ newQty: number, qtyBefore: number, deltaApplied: number }>}
 */
export async function applyStockDelta(stockItem, productId, combiId, delta) {
  if (delta === 0) {
    throw new Error('Le delta ne peut pas être zéro');
  }

  if (!stockItem) {
    throw new Error(
      'Aucune ligne de stock existante pour ce produit/combinaison. ' +
      "Créez d'abord un stock initial dans PrestaShop."
    );
  }

  const newQtyCheck = stockItem.quantity + delta;
  if (newQtyCheck < 0) {
    throw new Error(
      `Stock insuffisant — actuel : ${stockItem.quantity}, delta : ${delta}`
    );
  }

  const attrId = parseInt(normalizeAttrId(combiId), 10); // toujours un entier (0 si simple)

  const res = await fetch(STOCK_ENDPOINT, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      id_product:           Number(productId),
      id_product_attribute: attrId,
      delta,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Endpoint stock HTTP ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Erreur endpoint stock');

  return {
    newQty:       data.quantity,
    qtyBefore:    data.quantity_before,
    deltaApplied: data.delta_applied,
  };
}

// ─── HISTORIQUE depuis ps_stock_mvt_backoffice ───────────────

/**
 * Récupère les mouvements depuis la table custom ps_stock_mvt_backoffice.
 *
 * @param {string|number} productId
 * @param {string|number} combiId    - '' / null / 0 → produit simple (attr=0)
 * @param {number}        limit      - max 100
 * @returns {Promise<{ current_qty: number, movements: Array, total: number }>}
 */
export async function getStockHistory(productId, combiId, limit = 50) {
  // Normaliser : '' → 0, '5' → 5
  const attrId = parseInt(normalizeAttrId(combiId), 10);

  const url = `${STOCK_ENDPOINT}?action=history&id_product=${productId}&id_product_attribute=${attrId}&limit=${limit}`;

  const res = await fetch(url);

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Historique HTTP ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Erreur chargement historique');

  return {
    current_qty: data.current_qty,
    movements:   data.movements || [],
    total:       data.total     || 0,
  };
}


// ─── STOCK PAR CATÉGORIE ──────────────────────────────────────
 
/**
 * Retourne pour chaque catégorie :
 *   qtyPhysique   : stock réel dans ps_stock_available
 *   qtyReservee   : articles dans des paniers actifs (carts sans order)
 *   qtyDisponible : qtyPhysique − qtyReservee
 *
 * RÈGLE ANTI-DOUBLE-COMPTAGE :
 *   PS crée une ligne attr=0 (stock global) ET une ligne par combinaison.
 *   Si on somme tout → chaque unité est comptée deux fois.
 *   Fix : si le produit a des combinaisons → sommer SEULEMENT les lignes
 *         attr > 0. La ligne attr=0 est ignorée dans ce cas.
 *
 *   Exemple T_01 (ngoza=13, kely=10) :
 *     Sans fix : attr=0(23) + attr=68(13) + attr=69(10) = 46  ← FAUX
 *     Avec fix :             attr=68(13) + attr=69(10)  = 23  ← CORRECT
 *
 * Déplacé depuis commandesService.getStockParCategorie.
 * Cette version utilise les parseurs XML de stockService (xmlVal, etc.)
 * et les filtres de catégories racines PS (Root/Home).
 */
export async function getStockParCategorie() {
  // ── 1. Charger tout en parallèle ─────────────────────────
  const [prodsXml, catsXml, stocksXml, cartsXml, ordersXml] = await Promise.all([
    prestaGet('/products?display=full'),
    prestaGet('/categories?display=full'),
    prestaGet('/stock_availables?display=full'),
    prestaGet('/carts?display=full'),
    prestaGet('/orders?display=[id,id_cart]'),
  ]);
 
  // ── 2. Map productId → idCategorie ───────────────────────
  const prodCatMap = new Map();
  for (const b of [...prodsXml.matchAll(/<product[^>]*>([\s\S]*?)<\/product>/g)]) {
    const pid   = parseInt(xmlVal(b[1], 'id'),                  10);
    const catId = parseInt(xmlVal(b[1], 'id_category_default'), 10);
    if (pid && catId) prodCatMap.set(pid, catId);
  }
 
  // ── 3. Map catId → nomCat ─────────────────────────────────
  const catMap = new Map();
  for (const b of [...catsXml.matchAll(/<category[^>]*>([\s\S]*?)<\/category>/g)]) {
    const id  = parseInt(xmlVal(b[1], 'id'), 10);
    const nom = xmlValLang(b[1], 'name') || xmlVal(b[1], 'name');
    if (id && nom.trim()) catMap.set(id, nom.trim());
  }
 
  // ── 4. Stock physique par catégorie (anti-double-comptage) ─
  const stocks = parseStockAvailables(stocksXml);
 
  // Grouper par produit → { baseQty, baseShop, combos: Map<attrId, {qty, shopId}> }
  const stocksParProd = new Map();
  for (const s of stocks) {
    const pid    = parseInt(s.id_product,           10);
    const attrId = parseInt(s.id_product_attribute, 10) || 0;
    const qty    = s.quantity;
    const shopId = parseInt(s.id_shop,              10);
 
    if (!stocksParProd.has(pid)) {
      stocksParProd.set(pid, { baseQty: 0, baseShop: 0, combos: new Map() });
    }
    const entry = stocksParProd.get(pid);
 
    if (attrId === 0) {
      // Ligne "stock global" : garder la version id_shop=1 si possible
      if (shopId === 1 || entry.baseShop !== 1) {
        entry.baseQty  = qty;
        entry.baseShop = shopId;
      }
    } else {
      // Ligne combinaison : prioriser id_shop=1
      const existing = entry.combos.get(attrId);
      if (!existing || (shopId === 1 && existing.shopId !== 1)) {
        entry.combos.set(attrId, { qty, shopId });
      }
    }
  }
 
  // Agréger par catégorie
  const stockPhysiqueParCat = new Map();
  for (const [pid, { baseQty, combos }] of stocksParProd) {
    const catId = prodCatMap.get(pid);
    if (!catId) continue;
 
    // Si le produit a des combinaisons → sommer les combos UNIQUEMENT
    // Si produit simple (pas de combos) → utiliser la ligne attr=0
    const qty = combos.size > 0
      ? [...combos.values()].reduce((s, c) => s + c.qty, 0)
      : baseQty;
 
    stockPhysiqueParCat.set(catId, (stockPhysiqueParCat.get(catId) ?? 0) + qty);
  }
 
  // ── 5. Quantités réservées (paniers actifs) ───────────────
  // IDs de carts déjà rattachés à une order
  const cartIdsAvecOrder = new Set(
    [...ordersXml.matchAll(/<order[^>]*>([\s\S]*?)<\/order>/g)]
      .map((m) => xmlVal(m[1], 'id_cart'))
      .filter(Boolean)
  );
 
  const reserveParCat = new Map();
  for (const b of [...cartsXml.matchAll(/<cart[^>]*>([\s\S]*?)<\/cart>/g)]) {
    const cartId     = xmlVal(b[1], 'id');
    const customerId = xmlVal(b[1], 'id_customer');
    if (cartIdsAvecOrder.has(cartId) || !customerId || customerId === '0') continue;
 
    for (const rm of [...b[1].matchAll(/<cart_row[^>]*>([\s\S]*?)<\/cart_row>/g)]) {
      const pid = parseInt(xmlVal(rm[1], 'id_product'), 10);
      const qty = parseInt(xmlVal(rm[1], 'quantity'),   10) || 0;
      if (!pid || qty <= 0) continue;
      const catId = prodCatMap.get(pid);
      if (catId) reserveParCat.set(catId, (reserveParCat.get(catId) ?? 0) + qty);
    }
  }
 
  // ── 6. Résultat final ─────────────────────────────────────
  // Ignorer les catégories racines PS (Root=1, Home=2)
  const CATS_RACINES = new Set([1, 2]);
 
  const toutesLesCatIds = new Set([
    ...stockPhysiqueParCat.keys(),
    ...reserveParCat.keys(),
  ]);
 
  return [...toutesLesCatIds]
    .filter((catId) => !CATS_RACINES.has(catId))
    .map((catId) => {
      const nomCategorie  = catMap.get(catId) || `Catégorie #${catId}`;
      const qtyPhysique   = stockPhysiqueParCat.get(catId) ?? 0;
      const qtyReservee   = reserveParCat.get(catId)       ?? 0;
      const qtyDisponible = Math.max(0, qtyPhysique - qtyReservee);
      return { idCategorie: catId, nomCategorie, qtyPhysique, qtyReservee, qtyDisponible };
    })
    .filter((r) => r.qtyPhysique > 0 || r.qtyReservee > 0)
    .sort((a, b) => a.nomCategorie.localeCompare(b.nomCategorie));
}
