/**
 * parseCustomersOrders.js
 * Parse le CSV3 (clients + commandes/paniers) en objets normalisés.
 *
 * Format attendu :
 *   date | nom | email | pwd | adresse | achat | etat
 *
 * Format colonne "achat" :
 *   [("REF";QTY;"VARIANTE"),("REF2";QTY2;"")]
 *   Variante vide = produit simple ou combinaison par défaut
 *
 * Logique "etat" :
 *   "paiement accepté" → commande avec current_state=2
 *   ""                 → panier abandonné (cart créé, pas d'order)
 */

import { CUSTOMER_COLUMNS, ORDER_STATE_MAP } from '../config/columnMapping.js';

/**
 * Parse la colonne "achat" en tableau d'items
 * Exemples :
 *   [("T_01";3;"ngoza")]
 *   [("T_01";2;"kely"),("C_03";1;"")]
 *
 * @param {string} raw
 * @returns {Array<{reference: string, quantity: number, variant: string}>}
 */
function parseCartItems(raw) {
  if (!raw || raw.trim() === '') return [];

  const items = [];
  // Regex : ("REF";QTY;"VARIANT")
  const regex = /\("([^"]+)";(\d+);"([^"]*)"\)/g;
  let match;

  while ((match = regex.exec(raw)) !== null) {
    items.push({
      reference: match[1].trim(),
      quantity:  parseInt(match[2], 10) || 1,
      variant:   match[3].trim().toLowerCase(), // ngoza, kely, mainty...
    });
  }

  return items;
}

/**
 * @param {string} csvText
 * @returns {Array<Object>} Clients + leurs achats normalisés
 */
export function parseCustomersOrdersCsv(csvText) {
  const lines = csvText
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length < 2) throw new Error('[parseCustomersOrders] CSV vide ou sans données');

  const sep     = lines[0].includes(';') ? ';' : ' ';
  // CSV3 utilise des espaces comme séparateur entre colonnes,
  // mais les valeurs peuvent contenir des espaces → on split sur \t ou espaces multiples
  // Fallback: split sur tabulation si présente, sinon regex espace
  const hasTab  = lines[0].includes('\t');
  const splitter = hasTab
    ? (l) => l.split('\t').map((c) => c.trim())
    : (l) => l.split(/\s{2,}|\t/).map((c) => c.trim());

  // Si séparateur standard détecté
  const useStdSep = lines[0].includes(';') || lines[0].includes(',');
  const stdSep    = lines[0].includes(';') ? ';' : ',';

  const headers = useStdSep
    ? lines[0].split(stdSep).map((h) => h.trim())
    : splitter(lines[0]);

  const rows = lines.slice(1);

  const results = [];

  for (let idx = 0; idx < rows.length; idx++) {
    const line = rows[idx];
    const cols  = useStdSep
      ? line.split(stdSep).map((c) => c.trim())
      : splitter(line);

    const raw = {};
    headers.forEach((h, i) => { raw[h] = cols[i] ?? ''; });

    // Mapping
    const mapped = {};
    Object.entries(CUSTOMER_COLUMNS).forEach(([csvCol, normKey]) => {
      mapped[normKey] = raw[csvCol] ?? '';
    });

    // Etat de commande
    const etatRaw    = (mapped.order_state || '').toLowerCase().trim()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, ''); // suppr accents
    const orderState = ORDER_STATE_MAP[etatRaw] ?? ORDER_STATE_MAP[''];

    // Articles
    const cartItems = parseCartItems(mapped.cart_items);

    // Nom → prénom/nom (CSV donne juste "Rakoto" = nom de famille)
    const nomParts = (mapped.lastname || '').trim().split(' ');
    const lastname  = nomParts[nomParts.length - 1] || 'Client';
    const firstname = nomParts.length > 1 ? nomParts.slice(0, -1).join(' ') : 'Prénom';

    results.push({
      _line:       idx + 2,
      date_add:    mapped.date_add    || '',
      lastname,
      firstname,
      email:       mapped.email       || '',
      passwd:      mapped.passwd      || '',
      address1:    mapped.address1    || '',
      cart_items:  cartItems,
      order_state: orderState,          // null = panier, number = commande
      is_cart_only: orderState === null, // true = panier abandonné
    });
  }

  return results.filter((c) => c.email);
}

/**
 * Déduplique les clients par email.
 * Regroupe les commandes/paniers du même client.
 *
 * @param {Array} parsed - sortie de parseCustomersOrdersCsv
 * @returns {Array<{customer, orders: Array, carts: Array}>}
 */
export function groupCustomerOrders(parsed) {
  const map = new Map();

  for (const row of parsed) {
    const key = row.email.toLowerCase();

    if (!map.has(key)) {
      map.set(key, {
        customer: {
          lastname:  row.lastname,
          firstname: row.firstname,
          email:     row.email,
          passwd:    row.passwd,
          date_add:  row.date_add,
          address1:  row.address1,
        },
        orders: [],
        carts:  [],
      });
    }

    const entry = map.get(key);

    if (row.cart_items.length === 0) continue;

    if (row.is_cart_only) {
      // Panier abandonné
      entry.carts.push({
        date_add:   row.date_add,
        cart_items: row.cart_items,
      });
    } else {
      // Commande
      entry.orders.push({
        date_add:    row.date_add,
        cart_items:  row.cart_items,
        order_state: row.order_state,
      });
    }
  }

  return Array.from(map.values());
}
