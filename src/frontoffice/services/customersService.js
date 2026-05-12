/**
 * customersService.js
 * ─────────────────────────────────────────────────────────────
 * Service d'accès aux clients PrestaShop.
 * Récupère et normalise les données des clients depuis l'API.
 * ─────────────────────────────────────────────────────────────
 */

import { XMLParser } from 'fast-xml-parser';
import bcrypt from 'bcryptjs';

const API_KEY = import.meta.env.VITE_PRESTA_API_KEY;
const BASE_URL = '/api';

/**
 * En-tête d'authentification HTTP Basic
 */
function getAuthHeader() {
  return 'Basic ' + btoa(`${API_KEY}:`);
}

/**
 * Parser XML pour PrestaShop
 */
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  cdataPropName: '__cdata',
  textNodeName: '#text',
  parseAttributeValue: true,
  allowBooleanAttributes: true,
  isArray: (tagName) =>
    ['customer', 'product', 'category', 'order', 'image', 'language'].includes(tagName),
});

/**
 * Effectue une requête vers l'API PrestaShop
 */
async function prestaFetch(endpoint, opts = {}) {
  const response = await fetch(`${BASE_URL}${endpoint}`, {
    headers: {
      Authorization: getAuthHeader(),
      'Accept': 'application/xml',
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

/**
 * Extrait la valeur d'un champ PrestaShop
 */
function extraireValeur(champ, langId = 1) {
  if (champ === undefined || champ === null) return '';

  if (typeof champ === 'string' || typeof champ === 'number') {
    return String(champ);
  }

  if (champ.__cdata !== undefined) return String(champ.__cdata);

  if (champ.language) {
    const langues = Array.isArray(champ.language)
      ? champ.language
      : [champ.language];
    const langue = langues.find((l) => Number(l['@_id']) === langId) || langues[0];
    if (!langue) return '';
    if (langue.__cdata !== undefined) return String(langue.__cdata);
    if (langue['#text'] !== undefined) return String(langue['#text']);
    return String(langue);
  }

  return String(champ);
}

/**
 * Récupère la liste complète des clients PrestaShop
 * 
 * @returns {Promise<Array>} Liste des clients normalisés
 */
export async function getCustomers() {
  try {
    const data = await prestaFetch('/customers?display=full');
    const customers = data.customers?.customer || [];

    const liste = Array.isArray(customers)
      ? customers
      : [customers];

    return liste.map((c) => ({
      id: Number(extraireValeur(c.id)),
      firstName: extraireValeur(c.firstname),
      lastName: extraireValeur(c.lastname),
      email: extraireValeur(c.email),
      password: extraireValeur(c.passwd),
      active: extraireValeur(c.active) === '1',
      dateAdd: extraireValeur(c.date_add),
      phone: extraireValeur(c.phone),
      company: extraireValeur(c.company),
    }));
  } catch (err) {
    console.warn('[getCustomers] Erreur:', err.message);
    return [];
  }
}

/**
 * Récupère un client par son ID
 * 
 * @param {number|string} customerId - ID du client
 * @returns {Promise<Object>} Détails du client
 */
export async function getCustomerById(customerId) {
  try {
    const data = await prestaFetch(`/customers/${customerId}?display=full`);
    const customer = data.customer?.[0] || data.customers?.customer?.[0];

    if (!customer) {
      throw new Error(`Client #${customerId} introuvable`);
    }

    return {
      id: Number(extraireValeur(customer.id)),
      firstName: extraireValeur(customer.firstname),
      lastName: extraireValeur(customer.lastname),
      email: extraireValeur(customer.email),
      password: extraireValeur(customer.passwd),
      active: extraireValeur(customer.active) === '1',
      dateAdd: extraireValeur(customer.date_add),
      phone: extraireValeur(customer.phone),
      company: extraireValeur(customer.company),
    };
  } catch (err) {
    console.error(`[getCustomerById] Erreur:`, err.message);
    throw err;
  }
}

/**
 * Valide le password d'un client
 * Compare le password entré avec le hash bcrypt stocké en base
 * PrestaShop utilise bcrypt pour hasher les mots de passe
 * 
 * @param {string} inputPassword - Password entré par l'utilisateur
 * @param {string} hashedPassword - Password hashé stocké dans la base (bcrypt)
 * @returns {Promise<boolean>} true si password valide
 */
export async function validateCustomerPassword(inputPassword, hashedPassword) {
  try {
    if (!inputPassword || !hashedPassword) return false;
    
    // Comparer avec bcrypt
    const isValid = await bcrypt.compare(inputPassword, hashedPassword);
    return isValid;
  } catch (err) {
    console.error('[validateCustomerPassword] Erreur:', err.message);
    return false;
  }
}