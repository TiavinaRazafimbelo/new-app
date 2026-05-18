// =============================================================
// src/backoffice/reset/client.js
//
// USAGE : Utilisé par TOUS les fichiers api/ (front ET back-office)
//
// Rôle : couche HTTP de base vers l'API PrestaShop.
//   - Gère l'authentification Basic (clé API en variable .env)
//   - Parse le XML retourné par PrestaShop
//   - Expose get(), post(), put() réutilisables partout
//
// PrestaShop attend :
//   - Header Authorization: Basic base64(CLE_API + ":")
//   - Content-Type: application/xml pour les POST/PUT
//   - Les réponses sont toujours en XML
// =============================================================

// URL de base de l'API (ex: /api → proxifiée vers localhost/prestashop/api)
const API_URL = import.meta.env.VITE_API_BASE_URL || '/api';

// Clé API PrestaShop (définie dans .env)
const API_KEY = import.meta.env.VITE_PRESTASHOP_API_KEY;

// -------------------------------------------------------------
// authHeaders()
// Construit les headers HTTP pour s'authentifier auprès de
// l'API PrestaShop. L'API utilise Basic Auth avec la clé API
// comme identifiant et un mot de passe vide.
// btoa() encode "CLE:" en base64.
// -------------------------------------------------------------
export function authHeaders(contentType = 'application/xml') {
  return {
    Authorization: `Basic ${btoa(API_KEY + ':')}`,
    'Content-Type': contentType,
    Accept:         'application/xml',
  };
}

// -------------------------------------------------------------
// parseXml(text)
// Convertit une chaîne XML en document DOM navigable.
// Exemple : parseXml('<product><id>1</id></product>')
//           .querySelector('id').textContent → "1"
// -------------------------------------------------------------
export function parseXml(text) {
  return new DOMParser().parseFromString(text, 'application/xml');
}

// -------------------------------------------------------------
// getXmlText(node, selector)
// Extrait le texte d'un élément XML via un sélecteur CSS.
// Retourne '' si l'élément n'existe pas.
// Exemple : getXmlText(doc, 'product name language') → "T-shirt"
// -------------------------------------------------------------
export function getXmlText(node, selector) {
  const el = node.querySelector(selector);
  return el ? el.textContent.trim() : '';
}

// -------------------------------------------------------------
// get(path)
// Effectue un GET sur /api/{path} et retourne le document XML.
// Retourne null si 404 (ressource introuvable).
// Lance une erreur pour les autres codes d'erreur.
//
// Exemple : await get('products?display=full')
// -------------------------------------------------------------
export async function get(path) {
  const res = await fetch(`${API_URL}/${path}`, {
    method:  'GET',
    headers: authHeaders(),
  });

  if (res.status === 404) return null;

  if (!res.ok) {
    throw new Error(`GET ${path} → HTTP ${res.status}`);
  }

  return parseXml(await res.text());
}

// -------------------------------------------------------------
// post(path, xmlBody)
// Effectue un POST sur /api/{path} avec un body XML.
// Retourne le document XML de la ressource créée.
//
// Exemple : await post('carts', '<prestashop>...</prestashop>')
// -------------------------------------------------------------
export async function post(path, xmlBody) {
  const res = await fetch(`${API_URL}/${path}`, {
    method:  'POST',
    headers: authHeaders(),
    body:    xmlBody,
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    // On inclut les premiers caractères du message d'erreur PrestaShop
    throw new Error(`POST ${path} → HTTP ${res.status}: ${txt.slice(0, 400)}`);
  }

  return parseXml(await res.text());
}

// -------------------------------------------------------------
// put(path, id, xmlBody)
// Effectue un PUT sur /api/{path}/{id} pour mettre à jour
// une ressource existante.
//
// Exemple : await put('carts', '42', '<prestashop>...</prestashop>')
// -------------------------------------------------------------
export async function put(path, id, xmlBody) {
  const res = await fetch(`${API_URL}/${path}/${id}`, {
    method:  'PUT',
    headers: authHeaders(),
    body:    xmlBody,
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`PUT ${path}/${id} → HTTP ${res.status}: ${txt.slice(0, 400)}`);
  }

  return parseXml(await res.text());
}

// -------------------------------------------------------------
// del(path, id)
// Effectue un DELETE sur /api/{path}/{id}.
// -------------------------------------------------------------
export async function del(path, id) {
  const res = await fetch(`${API_URL}/${path}/${id}`, {
    method:  'DELETE',
    headers: authHeaders(),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`DELETE ${path}/${id} → HTTP ${res.status}: ${txt.slice(0, 400)}`);
  }

  return true;
}

// -------------------------------------------------------------
// postImage(path, formData)
// Cas spécial : upload d'image via multipart/form-data.
// On n'envoie PAS de Content-Type (le navigateur le gère).
// Utilisé uniquement dans le back-office pour l'import.
// -------------------------------------------------------------
export async function postImage(path, formData) {
  const res = await fetch(`${API_URL}/${path}`, {
    method:  'POST',
    headers: { Authorization: `Basic ${btoa(API_KEY + ':')}` },
    body:    formData,
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`POST image ${path} → HTTP ${res.status}: ${txt.slice(0, 200)}`);
  }

  return res;
}