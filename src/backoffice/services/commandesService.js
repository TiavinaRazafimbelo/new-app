/**
 * commandesService.js
 * ─────────────────────────────────────────────────────────────
 * Service d'accès aux commandes PrestaShop via Web Services.
 * XML brut parsé avec fast-xml-parser.
 *
 * STATUTS :
 *   - getStatutsCommande()    → TOUS les statuts (pour les badges)
 *   - getStatutsModifiables() → Seulement les 3 autorisés (pour le <select>)
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
    ['order', 'order_state', 'language', 'history'].includes(tagName),
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
    console.debug(`[prestaFetch] ${endpoint}\n`, xmlText.slice(0, 600));
  }

  const parsed = parser.parse(xmlText);
  return parsed.prestashop || parsed;
}

function val(champ, langId = 1) {
  if (champ === undefined || champ === null) return '';
  if (typeof champ === 'string' || typeof champ === 'number') return String(champ);
  if (champ.__cdata !== undefined) return String(champ.__cdata);
  if (champ['#text'] !== undefined) return String(champ['#text']);
  if (champ.language) {
    const langues = Array.isArray(champ.language) ? champ.language : [champ.language];
    const langue  = langues.find((l) => Number(l['@_id']) === langId) || langues[0];
    if (!langue) return '';
    if (langue.__cdata !== undefined) return String(langue.__cdata);
    if (langue['#text'] !== undefined) return String(langue['#text']);
    return String(langue);
  }
  return '';
}

// ─── IDs des 3 statuts modifiables ───────────────────────────
// Ajuste ces IDs si ton PrestaShop a des valeurs différentes.
// Backoffice PrestaShop → Commandes → Statuts pour vérifier.
const STATUTS_MODIFIABLES_IDS = [10, 2, 6];

const STATUTS_MODIFIABLES_LABELS = {
  10: 'Dans le panier',
  2:  'Paiement effectué',
  6:  'Annulé',
};

// ─── TOUS LES STATUTS (pour les badges de la colonne "Statut actuel") ──

/**
 * Retourne TOUS les statuts PrestaShop.
 * Utilisé pour afficher le badge de statut actuel dans le tableau,
 * quelle que soit la valeur de current_state de la commande.
 *
 * @returns {Promise<Array<{ id: number, name: string, color: string }>>}
 */
export async function getStatutsCommande() {
  const data = await prestaFetch('/order_states?display=full');

  const tousStatuts = data.order_states?.order_state || [];
  const liste       = Array.isArray(tousStatuts) ? tousStatuts : [tousStatuts];

  return liste.map((s) => ({
    id:      Number(val(s.id)),
    name:    val(s.name),       // Nom natif PrestaShop (fr)
    color:   val(s.color) || '#cccccc',
    paid:    val(s.paid)    === '1',
    shipped: val(s.shipped) === '1',
  }));
}

// ─── STATUTS MODIFIABLES (pour le <select> de modification) ──

/**
 * Retourne seulement les 3 statuts autorisés par le prof.
 * Utilisé dans le <select> de la colonne "Modifier le statut".
 *
 * IDs filtrés : 10 (Dans le panier), 2 (Paiement effectué), 6 (Annulé).
 *
 * @returns {Promise<Array<{ id: number, name: string }>>}
 */
export async function getStatutsModifiables() {
  const data = await prestaFetch('/order_states?display=full');

  const tousStatuts = data.order_states?.order_state || [];
  const liste       = Array.isArray(tousStatuts) ? tousStatuts : [tousStatuts];

  return liste
    .filter((s) => STATUTS_MODIFIABLES_IDS.includes(Number(val(s.id))))
    .map((s) => {
      const id = Number(val(s.id));
      return {
        id,
        // Libellé français défini par le prof (pas le nom PrestaShop)
        name: STATUTS_MODIFIABLES_LABELS[id] || val(s.name),
      };
    })
    .sort(
      (a, b) =>
        STATUTS_MODIFIABLES_IDS.indexOf(a.id) -
        STATUTS_MODIFIABLES_IDS.indexOf(b.id)
    );
}

// ─── LISTE COMMANDES ──────────────────────────────────────────

export async function getCommandes({
  page      = 1,
  limit     = 20,
  statut    = '',
  recherche = '',
} = {}) {
  const data      = await prestaFetch('/orders?display=full');
  const brutes    = data.orders?.order || [];
  let   commandes = Array.isArray(brutes) ? brutes : [brutes];

  commandes = commandes.map((c) => ({
    id:            val(c.id),
    reference:     val(c.reference),
    current_state: val(c.current_state),
    date_add:      val(c.date_add),
    date_upd:      val(c.date_upd),
    total_paid:    val(c.total_paid),
    id_customer:   val(c.id_customer),
    payment:       val(c.payment),
    firstname: '',
    lastname:  '',
    email:     '',
    _raw: c,
  }));

  commandes = await Promise.all(
    commandes.map(async (commande) => {
      let firstname = '';
      let lastname  = '';
      let email     = '';
      try {
        if (commande.id_customer && commande.id_customer !== '0') {
          const dataClient = await prestaFetch(
            `/customers/${commande.id_customer}?display=full`
          );
          const client =
            dataClient.customers?.customer?.[0] ||
            dataClient.customer ||
            {};
          firstname = val(client.firstname);
          lastname  = val(client.lastname);
          email     = val(client.email);
        }
      } catch (e) {
        console.error(`Erreur client ${commande.id_customer}`, e);
      }
      return { ...commande, firstname, lastname, email };
    })
  );

  if (statut) {
    commandes = commandes.filter(
      (c) => c.current_state?.toString() === statut.toString()
    );
  }

  if (recherche.trim()) {
    const r = recherche.toLowerCase();
    commandes = commandes.filter((c) => {
      const texte = `${c.firstname} ${c.lastname} ${c.reference} ${c.email}`.toLowerCase();
      return texte.includes(r);
    });
  }

  commandes.sort((a, b) => new Date(b.date_add) - new Date(a.date_add));

  const total        = commandes.length;
  const debut        = (page - 1) * limit;
  const commandePage = commandes.slice(debut, debut + limit);

  return { commandes: commandePage, total, pages: Math.ceil(total / limit) };
}

// ─── DETAIL COMMANDE ──────────────────────────────────────────

export async function getCommandeById(id) {
  const data = await prestaFetch(`/orders/${id}?display=full`);
  return data.orders?.order?.[0] || data.order || null;
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
    headers: {
      Authorization:  getAuthHeader(),
      'Content-Type': 'application/xml',
    },
    body: xml,
  });

  const text = await response.text();
  console.log('ORDER HISTORY RESPONSE:', text);
  if (!response.ok) throw new Error(text);
  return { success: true };
}

// ─── COMMANDES PAR DATE (tableau de bord) ─────────────────────

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