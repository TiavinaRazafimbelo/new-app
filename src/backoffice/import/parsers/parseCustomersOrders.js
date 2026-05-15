/**
 * parseCustomersOrders.js
 * Parse le CSV3 (clients + commandes/paniers) en objets normalisés.
 *
 * Format attendu :
 *   date,nom,email,pwd,adresse,achat,etat
 *
 * Format colonne "achat" (séparateur interne = \t OU ; selon export) :
 *   [("REF"\tQTY\t"VARIANTE"),("REF2"\tQTY2\t"")]
 *   [("REF";QTY;"VARIANTE")]
 *   Variante vide = produit simple ou combinaison par défaut
 *
 * Logique "etat" :
 *   "paiement accepté" → commande avec current_state=2
 *   ""                 → panier abandonné (cart créé, pas d'order)
 *
 * FIX :
 *  - Parser CSV qui respecte les guillemets (ne coupe pas sur , dans "...")
 *  - Regex parseCartItems accepte \t ET ; comme séparateur interne
 *  - Normalisation accents pour ORDER_STATE_MAP (gère Latin-1 mal décodé)
 */

import { CUSTOMER_COLUMNS, ORDER_STATE_MAP } from '../config/columnMapping.js';

// ─── Parser CSV robuste ───────────────────────────────────────

/**
 * Split une ligne CSV en respectant les champs entre guillemets doubles.
 * Gère : virgule, point-virgule, pipe comme séparateur de colonnes.
 * Gère : "" comme guillemet échappé à l'intérieur d'un champ guillemété.
 *
 * @param {string} line
 * @param {string} sep - séparateur détecté (',', ';', '|')
 * @returns {string[]}
 */
function splitCsvLine(line, sep) {
  const result = [];
  let current  = '';
  let inQuotes = false;
  let i        = 0;

  while (i < line.length) {
    const ch   = line[i];
    const next = line[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') {
        // Guillemet échappé ("") → un seul guillemet littéral
        current += '"';
        i += 2;
        continue;
      }
      inQuotes = !inQuotes;
      i++;
      continue;
    }

    if (!inQuotes && ch === sep) {
      result.push(current.trim());
      current = '';
      i++;
      continue;
    }

    current += ch;
    i++;
  }

  result.push(current.trim());
  return result;
}

/**
 * Détecte le séparateur de colonnes d'un CSV.
 * Priorité : | > ; > , (on ignore les virgules dans les champs guillemétés).
 * Pour CSV3 le séparateur est généralement la virgule — on le détecte sur l'en-tête.
 */
function detectSep(headerLine) {
  if (headerLine.includes('|')) return '|';
  if (headerLine.includes(';')) return ';';
  return ',';
}

// ─── Parser colonne "achat" ───────────────────────────────────

/**
 * Parse la colonne "achat" en tableau d'items.
 *
 * Accepte les deux formats :
 *   [("T_01";3;"ngoza")]          ← séparateur ;
 *   [("T_01"\t3\tngoza)]          ← séparateur \t (tabulation)
 *   [("T_01"\t3\t"ngoza")]        ← \t avec guillemets sur variant
 *
 * @param {string} raw
 * @returns {Array<{reference: string, quantity: number, variant: string}>}
 */
function parseCartItems(raw) {
  if (!raw || raw.trim() === '') return [];

  // Normalise : remplace les tabulations internes par ;
  // pour n'avoir qu'une seule regex à maintenir
  const normalized = raw.replace(/\t/g, ';');

  const items = [];

  // Regex flexible :
  //   - REF : entre guillemets ou non
  //   - QTY : entier
  //   - VARIANT : entre guillemets ou non, peut être vide
  const regex = /"?([^";,()[\]]+)"?\s*;\s*(\d+)\s*;\s*"?([^";()[\]]*)"?/g;
  let match;

  while ((match = regex.exec(normalized)) !== null) {
    const ref     = match[1].trim();
    const qty     = parseInt(match[2], 10) || 1;
    const variant = match[3].trim().toLowerCase();

    if (ref) {
      items.push({ reference: ref, quantity: qty, variant });
    }
  }

  return items;
}

// ─── Normalisation état commande ──────────────────────────────

/**
 * Normalise une chaîne d'état : minuscules, suppression accents.
 * Gère les deux cas : UTF-8 correct ("accepté") et Latin-1 mal décodé ("acceptÃ©").
 */
function normalizeEtat(raw) {
  if (!raw) return '';
  // Tentative de re-décodage Latin-1 → UTF-8 si caractères Ã présents
  let str = raw;
  if (str.includes('Ã')) {
    try {
      // Encode chaque char comme Latin-1 puis redécode en UTF-8
      const bytes = Uint8Array.from(str, (c) => c.charCodeAt(0));
      str = new TextDecoder('utf-8').decode(bytes);
    } catch (_) {
      // Si ça échoue, on garde la chaîne originale
    }
  }
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // supprime diacritiques
    .trim();
}

// ─── Export principal ─────────────────────────────────────────

/**
 * @param {string} csvText
 * @returns {Array<Object>} Clients + leurs achats normalisés
 */
export function parseCustomersOrdersCsv(csvText) {
  const lines = csvText
    .split('\n')
    .map((l) => l.trimEnd())   // trimEnd seulement : ne pas perdre les colonnes vides en fin
    .filter(Boolean);

  if (lines.length < 2) throw new Error('[parseCustomersOrders] CSV vide ou sans données');

  const sep     = detectSep(lines[0]);
  const headers = splitCsvLine(lines[0], sep).map((h) => h.trim());
  const rows    = lines.slice(1);

  const results = [];

  for (let idx = 0; idx < rows.length; idx++) {
    const line = rows[idx];
    const cols = splitCsvLine(line, sep);

    const raw = {};
    headers.forEach((h, i) => { raw[h] = cols[i] ?? ''; });

    // Mapping
    const mapped = {};
    Object.entries(CUSTOMER_COLUMNS).forEach(([csvCol, normKey]) => {
      mapped[normKey] = raw[csvCol] ?? '';
    });

    // État de commande — robuste aux accents mal encodés
    const etatNorm   = normalizeEtat(mapped.order_state);
    const orderState = ORDER_STATE_MAP[etatNorm] ?? ORDER_STATE_MAP[''];

    // Articles
    const cartItems = parseCartItems(mapped.cart_items);

    // Nom → prénom / nom de famille
    const nomParts = (mapped.lastname || '').trim().split(' ');
    const lastname  = nomParts[nomParts.length - 1] || 'Client';
    const firstname = nomParts.length > 1 ? nomParts.slice(0, -1).join(' ') : 'Prenom';

    results.push({
      _line:        idx + 2,
      date_add:     mapped.date_add || '',
      lastname,
      firstname,
      email:        (mapped.email || '').toLowerCase().trim(),
      passwd:       mapped.passwd  || '',
      address1:     mapped.address1 || '',
      cart_items:   cartItems,
      order_state:  orderState,           // null = panier, number = commande
      is_cart_only: orderState === null,  // true = panier abandonné
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
      entry.carts.push({
        date_add:   row.date_add,
        cart_items: row.cart_items,
      });
    } else {
      entry.orders.push({
        date_add:    row.date_add,
        cart_items:  row.cart_items,
        order_state: row.order_state,
      });
    }
  }

  return Array.from(map.values());
}