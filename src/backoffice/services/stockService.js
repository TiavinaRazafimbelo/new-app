/**
 * stockService.js
 * ─────────────────────────────────────────────────────────────
 * Service de gestion du stock PrestaShop.
 *
 * STRATEGIE :
 *   - Lecture stock    : GET /api/stock_availables (API PS)
 *   - Ecriture stock   : POST /updatestock (fichier standalone PS)
 *   - Historique       : GET /updatestock?action=history (depuis ps_stock_mvt)
 *
 * REGLES :
 *   - Seul le mode delta est supporte (pas de valeur absolue)
 *   - Si aucune ligne stock n'existe → erreur bloquante
 *   - Pas de sessionStorage ni de snapshot
 * ─────────────────────────────────────────────────────────────
 */

const API_KEY        = import.meta.env.VITE_PRESTA_API_KEY;
const BASE_URL       = '/api';
const STOCK_ENDPOINT = '/updatestock';

// ─── Auth ─────────────────────────────────────────────────────

function getAuthHeader() {
  return 'Basic ' + btoa(`${API_KEY}:`);
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
    `/stock_availables?filter[id_product]=${productId}&display=full`
  );
  const stocks = parseStockAvailables(xml);

  const map = new Map();
  for (const s of stocks) {
    const key      = String(s.id_product_attribute);
    const existing = map.get(key);
    if (!existing) {
      map.set(key, s);
    } else if (Number(s.id_shop) === 1 && Number(existing.id_shop) !== 1) {
      map.set(key, s);
    }
  }

  return [...map.values()];
}

export function findStockItem(stocks, combiId) {
  const attrId = combiId || '0';
  return stocks.find((s) => String(s.id_product_attribute) === String(attrId)) || null;
}

// ─── MISE À JOUR STOCK (delta uniquement) ────────────────────

/**
 * Applique un delta de stock via l'endpoint custom PS.
 * Insere automatiquement un mouvement dans ps_stock_mvt.
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
      'Créez d\'abord un stock initial dans PrestaShop.'
    );
  }

  const newQtyCheck = stockItem.quantity + delta;
  if (newQtyCheck < 0) {
    throw new Error(
      `Stock insuffisant — actuel : ${stockItem.quantity}, delta : ${delta}`
    );
  }

  const res = await fetch(STOCK_ENDPOINT, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      id_product:           Number(productId),
      id_product_attribute: Number(combiId) || 0,
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

// ─── HISTORIQUE depuis ps_stock_mvt ──────────────────────────

/**
 * Recupere les mouvements de stock depuis ps_stock_mvt via l'endpoint PS.
 *
 * @param {string|number} productId
 * @param {string|number} combiId    - 0 ou '' si produit simple
 * @param {number}        limit      - max 50
 * @returns {Promise<{ current_qty: number, movements: Array }>}
 */
export async function getStockHistory(productId, combiId = 0, limit = 50) {
  const attrId = Number(combiId) || 0;
  const url    = `${STOCK_ENDPOINT}?action=history&id_product=${productId}&id_product_attribute=${attrId}&limit=${limit}`;

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