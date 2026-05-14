/**
 * customersService.js
 * ─────────────────────────────────────────────────────────────
 * Service d'accès aux clients PrestaShop.
 *
 * CORRECTION :
 *   - Filtre is_guest === '1' → les guests ne s'affichent plus dans la liste
 * ─────────────────────────────────────────────────────────────
 */

import { XMLParser } from 'fast-xml-parser';
import bcrypt from 'bcryptjs';

const API_KEY  = import.meta.env.VITE_PRESTA_API_KEY;
const BASE_URL = '/api';

function getAuthHeader() {
  return 'Basic ' + btoa(`${API_KEY}:`);
}

const parser = new XMLParser({
  ignoreAttributes:     false,
  attributeNamePrefix:  '@_',
  cdataPropName:        '__cdata',
  textNodeName:         '#text',
  parseAttributeValue:  true,
  allowBooleanAttributes: true,
  isArray: (tagName) =>
    ['customer', 'product', 'category', 'order', 'image', 'language'].includes(tagName),
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
  if (import.meta.env.DEV) {
    console.debug(`[customersService] ${endpoint}\n`, xmlText.slice(0, 300));
  }

  const parsed = parser.parse(xmlText);
  return parsed.prestashop || parsed;
}

function extraireValeur(champ, langId = 1) {
  if (champ === undefined || champ === null) return '';
  if (typeof champ === 'string' || typeof champ === 'number') return String(champ);
  if (champ.__cdata !== undefined) return String(champ.__cdata);
  if (champ.language) {
    const langues = Array.isArray(champ.language) ? champ.language : [champ.language];
    const langue  = langues.find((l) => Number(l['@_id']) === langId) || langues[0];
    if (!langue) return '';
    if (langue.__cdata !== undefined) return String(langue.__cdata);
    if (langue['#text']  !== undefined) return String(langue['#text']);
  }
  return String(champ);
}

/**
 * Récupère la liste des clients PrestaShop.
 * ⚠️ CORRECTION : exclut les comptes guest (is_guest = 1)
 */
export async function getCustomers() {
  try {
    const data      = await prestaFetch('/customers?display=full');
    const customers = data.customers?.customer || [];
    const liste     = Array.isArray(customers) ? customers : [customers];

    return liste
      // ← CORRECTION : on n'affiche pas les guests dans la liste
      .filter((c) => extraireValeur(c.is_guest) !== '1')
      .map((c) => ({
        id:        Number(extraireValeur(c.id)),
        firstName: extraireValeur(c.firstname),
        lastName:  extraireValeur(c.lastname),
        email:     extraireValeur(c.email),
        password:  extraireValeur(c.passwd),
        active:    extraireValeur(c.active) === '1',
        dateAdd:   extraireValeur(c.date_add),
        phone:     extraireValeur(c.phone),
        company:   extraireValeur(c.company),
      }));
  } catch (err) {
    console.warn('[getCustomers] Erreur:', err.message);
    return [];
  }
}

export async function getCustomerById(customerId) {
  try {
    const data     = await prestaFetch(`/customers/${customerId}?display=full`);
    const customer = data.customer?.[0] || data.customers?.customer?.[0];

    if (!customer) throw new Error(`Client #${customerId} introuvable`);

    return {
      id:        Number(extraireValeur(customer.id)),
      firstName: extraireValeur(customer.firstname),
      lastName:  extraireValeur(customer.lastname),
      email:     extraireValeur(customer.email),
      password:  extraireValeur(customer.passwd),
      active:    extraireValeur(customer.active) === '1',
      dateAdd:   extraireValeur(customer.date_add),
      phone:     extraireValeur(customer.phone),
      company:   extraireValeur(customer.company),
    };
  } catch (err) {
    console.error('[getCustomerById] Erreur:', err.message);
    throw err;
  }
}

export async function validateCustomerPassword(inputPassword, hashedPassword) {
  try {
    if (!inputPassword || !hashedPassword) return false;
    return await bcrypt.compare(inputPassword, hashedPassword);
  } catch (err) {
    console.error('[validateCustomerPassword] Erreur:', err.message);
    return false;
  }
}