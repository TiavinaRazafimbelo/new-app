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