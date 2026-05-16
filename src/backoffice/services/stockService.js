/**
 * stockService.js
 * ─────────────────────────────────────────────────────────────
 * Service de gestion du stock PrestaShop.
 *
 * STRATÉGIE MISE À JOUR :
 *   1. Si une ligne stock_available existe → PUT /stock_availables/:id
 *   2. Si aucune ligne n'existe → appel à l'endpoint custom PrestaShop
 *      qui appelle StockAvailable::updateQuantity($idProduct, $idAttribute, $delta)
 *      Cet endpoint crée la ligne s'il n'en existe pas.
 *
 * ENDPOINT CUSTOM PrestaShop :
 *   Fichier à créer : /modules/monmodule/controllers/front/stock.php
 *   ou via override — voir instructions en bas de ce fichier.
 *
 *   URL : /index.php?fc=module&module=monmodule&controller=stock
 *   Méthode : POST
 *   Body (JSON) : { id_product, id_product_attribute, delta }
 *   Réponse (JSON) : { success: true, quantity: 42 }
 *
 * ─────────────────────────────────────────────────────────────
 */

const API_KEY  = import.meta.env.VITE_PRESTA_API_KEY;
const BASE_URL = '/api';

/**
 * URL de l'endpoint custom PrestaShop.
 * Passe par le proxy Vite (/presta → http://localhost/prestashop_edition_classic_version_8.2.6)
 * Configurer dans vite.config.js :
 *   '/presta': { target: 'http://localhost/prestashop_edition_classic_version_8.2.6', changeOrigin: true, rewrite: (p) => p.replace(/^\/presta/, '') }
 */
const CUSTOM_ENDPOINT = '/presta/index.php';


// ─── Auth ─────────────────────────────────────────────────────

function getAuthHeader() {
  return 'Basic ' + btoa(`${API_KEY}:`);
}

// ─── Helpers XML ──────────────────────────────────────────────

async function prestaGet(endpoint) {
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    headers: { Authorization: getAuthHeader(), Accept: 'application/xml' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${endpoint}`);
  return res.text();
}

async function prestaWrite(endpoint, xml, method = 'PUT') {
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    method,
    headers: {
      Authorization:  getAuthHeader(),
      'Content-Type': 'application/xml',
      Accept:         'application/xml',
    },
    body: xml,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text.slice(0, 300) || `HTTP ${res.status}`);
  return text;
}

// ─── Parsing XML ──────────────────────────────────────────────

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
      id_shop_group:        xmlVal(inner, 'id_shop_group') || '0',
      depends_on_stock:     xmlVal(inner, 'depends_on_stock') || '0',
      out_of_stock:         xmlVal(inner, 'out_of_stock') || '2',
    };
  }).filter((s) => s.id);
}

// ─── PRODUITS ─────────────────────────────────────────────────

/**
 * Récupère la liste des produits (id, name, reference).
 * @returns {Promise<Array<{id, name, reference}>>}
 */
export async function getProductsForStock() {
  const xml    = await prestaGet('/products?display=[id,name,reference]');
  const blocks = [...xml.matchAll(/<product[^>]*>([\s\S]*?)<\/product>/g)];

  return blocks.map((b) => {
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

/**
 * Récupère les combinaisons d'un produit avec leurs attributs.
 * @param {string|number} productId
 * @returns {Promise<Array<{id, reference, label}>>}
 */
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

      // Extraire les IDs des product_option_values pour construire un label
      const optMatches = [...inner.matchAll(/<product_option_value[^>]*>\s*<id[^>]*>(?:<!\\[CDATA\\[)?(\d+)(?:\\]\\]>)?<\/id>/g)];
      const optIds = optMatches.map((m) => m[1]).join(', ');

      return {
        id,
        reference: ref,
        label: ref || (optIds ? `Options: ${optIds}` : `Combi #${id}`),
      };
    }).filter((c) => c.id);
  } catch {
    return [];
  }
}

// ─── STOCKS ───────────────────────────────────────────────────

/**
 * Récupère toutes les lignes stock_available d'un produit.
 * Priorise id_shop=1 sur id_shop=0 pour chaque combinaison.
 *
 * @param {string|number} productId
 * @returns {Promise<Array<StockItem>>}
 */
export async function getStocksForProduct(productId) {
  const xml    = await prestaGet(
    `/stock_availables?filter[id_product]=${productId}&display=full`
  );
  const stocks = parseStockAvailables(xml);

  // Prioriser id_shop=1 sur id_shop=0 pour la même combi
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

/**
 * Trouve la ligne stock_available pour un produit + combinaison donnés.
 *
 * @param {Array}        stocks         - Résultat de getStocksForProduct()
 * @param {string|number} combiId       - '' ou '0' pour produit de base
 * @returns {StockItem|null}
 */
export function findStockItem(stocks, combiId) {
  const attrId = combiId || '0';
  return stocks.find((s) => String(s.id_product_attribute) === String(attrId)) || null;
}

// ─── MISE À JOUR STOCK ────────────────────────────────────────

/**
 * XML pour mettre à jour un stock_available existant.
 */
function buildStockUpdateXml(stockItem, newQty) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<prestashop xmlns:xlink="http://www.w3.org/1999/xlink">
  <stock_available>
    <id><![CDATA[${stockItem.id}]]></id>
    <id_product><![CDATA[${stockItem.id_product}]]></id_product>
    <id_product_attribute><![CDATA[${stockItem.id_product_attribute}]]></id_product_attribute>
    <id_shop><![CDATA[${stockItem.id_shop || 1}]]></id_shop>
    <id_shop_group><![CDATA[${stockItem.id_shop_group || 0}]]></id_shop_group>
    <quantity><![CDATA[${newQty}]]></quantity>
    <depends_on_stock><![CDATA[0]]></depends_on_stock>
    <out_of_stock><![CDATA[2]]></out_of_stock>
    <location><![CDATA[]]></location>
  </stock_available>
</prestashop>`;
}

/**
 * Appelle l'endpoint custom PrestaShop qui crée la ligne si elle n'existe pas.
 *
 * ENDPOINT CUSTOM (à créer dans PrestaShop) :
 * ─────────────────────────────────────────────
 * Crée le fichier : /override/controllers/front/StockAjaxController.php
 * OU un module simple avec un controller front.
 *
 * Exemple de module minimal (modules/stockajax/stockajax.php) :
 *   <?php
 *   class StockAjax extends Module { ... }
 *
 * Controller (modules/stockajax/controllers/front/update.php) :
 *   <?php
 *   class StockAjaxUpdateModuleFrontController extends ModuleFrontController {
 *     public function initContent() {
 *       $data = json_decode(file_get_contents('php://input'), true);
 *       $idProduct   = (int)($data['id_product'] ?? 0);
 *       $idAttribute = (int)($data['id_product_attribute'] ?? 0);
 *       $delta       = (int)($data['delta'] ?? 0);
 *       $newQty      = (int)($data['quantity'] ?? 0);
 *
 *       if ($idProduct && $delta !== 0) {
 *         StockAvailable::updateQuantity($idProduct, $idAttribute, $delta);
 *       } elseif ($idProduct) {
 *         // Définir une quantité absolue
 *         StockAvailable::setQuantity($idProduct, $idAttribute, $newQty);
 *       }
 *
 *       $qty = StockAvailable::getQuantityAvailableByProduct($idProduct, $idAttribute);
 *       header('Content-Type: application/json');
 *       die(json_encode(['success' => true, 'quantity' => $qty]));
 *     }
 *   }
 *
 * URL : /index.php?fc=module&module=stockajax&controller=update
 * ─────────────────────────────────────────────────────────────
 *

 
/**
 * Appelle l'endpoint custom PrestaShop.
 *
 * @param {number} productId
 * @param {number} combiId    - 0 si produit simple
 * @param {number} value      - delta ou quantite absolue selon mode
 * @param {'delta'|'absolute'} mode
 */
async function callCustomStockEndpoint(productId, combiId, value, mode = 'delta') {
  const url = `${CUSTOM_ENDPOINT}?fc=module&module=stockajax&controller=update`;
 
  // Corps different selon le mode :
  //   delta    → { id_product, id_product_attribute, delta }
  //   absolute → { id_product, id_product_attribute, quantity }
  const body = {
    id_product:           Number(productId),
    id_product_attribute: Number(combiId) || 0,
    ...(mode === 'absolute'
      ? { quantity: value }   // setQuantity() côté PS — accepte 0, crée la ligne
      : { delta:    value }   // updateQuantity() côté PS — crée la ligne si absente
    ),
  };
 
  const res = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
 
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Endpoint custom HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
 
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Endpoint custom : échec');
 
  return data; // { success: true, quantity: 42 }
}

/**
 * Applique un delta de stock (ajouter ou retirer).
 *
 * STRATEGIE :
 *   - Ligne existante → PUT /stock_availables/:id (API standard)
 *   - Ligne absente   → endpoint custom mode 'delta'
 *                       (updateQuantity crée la ligne avec qty=delta)
 */
export async function applyStockDelta(stockItem, productId, combiId, delta) {
  if (delta === 0) throw new Error('Le delta ne peut pas être zéro');
 
  if (stockItem) {
    // Ligne existante : PUT via API standard PrestaShop
    const newQty = stockItem.quantity + delta;
    if (newQty < 0) {
      throw new Error(`Stock insuffisant (actuel: ${stockItem.quantity}, delta: ${delta})`);
    }
    const xml = buildStockUpdateXml(stockItem, newQty);
    await prestaWrite(`/stock_availables/${stockItem.id}`, xml);
    return { newQty, createdNew: false };
 
  } else {
    // Ligne absente : endpoint custom mode delta
    // updateQuantity() côté PS crée la ligne avec qty = delta
    if (delta < 0) {
      throw new Error('Impossible de retirer du stock : aucune ligne existante');
    }
    const result = await callCustomStockEndpoint(productId, combiId, delta, 'delta');
    return { newQty: result.quantity, createdNew: true };
  }
}

/**
 * Définit une quantité absolue.
 *
 * STRATEGIE :
 *   - Ligne existante → PUT /stock_availables/:id (API standard)
 *   - Ligne absente   → endpoint custom mode 'absolute'
 *                       (setQuantity() côté PS — accepte 0, crée la ligne)
 *
 * CORRECTION : l'ancienne version passait targetQty comme delta
 * ce qui provoquait une erreur 400 si targetQty = 0.
 */
export async function setAbsoluteStock(stockItem, productId, combiId, targetQty) {
  if (targetQty < 0) throw new Error('La quantité ne peut pas être négative');
 
  if (stockItem) {
    // Ligne existante : PUT via API standard
    const xml = buildStockUpdateXml(stockItem, targetQty);
    await prestaWrite(`/stock_availables/${stockItem.id}`, xml);
    return { newQty: targetQty, createdNew: false };
 
  } else {
    // Ligne absente : endpoint custom mode absolute
    // setQuantity() côté PS crée la ligne même si qty = 0
    const result = await callCustomStockEndpoint(productId, combiId, targetQty, 'absolute');
    return { newQty: result.quantity, createdNew: true };
  }
}

// ─── HISTORIQUE ───────────────────────────────────────────────

const HISTORY_KEY = 'stock_history_v1';

export function chargerHistorique() {
  try {
    const raw = sessionStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

export function sauvegarderHistorique(h) {
  try { sessionStorage.setItem(HISTORY_KEY, JSON.stringify(h)); } catch {}
}

export function cleHistorique(productId, combiId) {
  return `${productId}_${combiId || '0'}`;
}

/**
 * Ajoute un point de snapshot à l'historique.
 * Max 30 points par clé.
 */
export function ajouterPointHistorique(history, productId, combiId, qty) {
  const key  = cleHistorique(productId, combiId);
  const now  = new Date();
  const label = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const points  = history[key] || [];
  const updated = [...points, { label, qty, ts: now.toISOString() }].slice(-30);
  return { ...history, [key]: updated };
}