const API_KEY = import.meta.env.VITE_PRESTA_API_KEY;

const BASE_URL = '/api';

function getAuthHeader() {
  return 'Basic ' + btoa(`${API_KEY}:`);
}

async function prestaFetch(endpoint, options = {}) {
  const response = await fetch(`${BASE_URL}${endpoint}`, {
    headers: {
      Authorization: getAuthHeader(),
      'Output-Format': 'JSON',
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Erreur HTTP ${response.status}`);
  }

  return response.json();
}

/**
 * LISTE COMMANDES
 */
export async function getCommandes({
  page = 1,
  limit = 20,
  statut = '',
  recherche = '',
} = {}) {

  // récupérer toutes les commandes
  const data = await prestaFetch('/orders?display=full');

  let commandes = data.orders || [];

  // récupérer les infos clients
  commandes = await Promise.all(
    commandes.map(async (commande) => {

      let firstname = '';
      let lastname = '';
      let email = '';

      try {

        if (commande.id_customer && commande.id_customer !== '0') {

          const clientData = await prestaFetch(
            `/customers/${commande.id_customer}`
          );

          const client = clientData.customer;

          firstname = client.firstname || '';
          lastname = client.lastname || '';
          email = client.email || '';
        }

      } catch (e) {
        console.error(
          `Erreur client ${commande.id_customer}`,
          e
        );
      }

      return {
        ...commande,
        firstname,
        lastname,
        email,
      };
    })
  );

  // ─── FILTRE STATUT ─────────────────────────

  if (statut) {
    commandes = commandes.filter(
      (c) => c.current_state?.toString() === statut.toString()
    );
  }

  // ─── RECHERCHE ─────────────────────────────

  if (recherche.trim()) {

    const r = recherche.toLowerCase();

    commandes = commandes.filter((c) => {

      const texte = `
        ${c.firstname || ''}
        ${c.lastname || ''}
        ${c.reference || ''}
        ${c.email || ''}
      `.toLowerCase();

      return texte.includes(r);
    });
  }

  // ─── TRI DATE DESC ─────────────────────────

  commandes.sort(
    (a, b) => new Date(b.date_add) - new Date(a.date_add)
  );

  // ─── PAGINATION ────────────────────────────

  const total = commandes.length;

  const debut = (page - 1) * limit;
  const fin = debut + limit;

  const commandesPage = commandes.slice(debut, fin);

  return {
    commandes: commandesPage,
    total,
    pages: Math.ceil(total / limit),
  };
}

/**
 * DETAIL COMMANDE
 */
export async function getCommandeById(id) {
  const data = await prestaFetch(`/orders/${id}?display=full`);

  return data.order;
}

/**
 * LISTE DES STATUTS
 */
export async function getStatutsCommande() {
  const data = await prestaFetch(
    '/order_states?display=full&language=1'
  );

  return data.order_states || [];
}

/**
 * MODIFIER STATUT COMMANDE
 */
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
      Authorization: getAuthHeader(),
      'Content-Type': 'application/xml',
    },
    body: xml,
  });

  const text = await response.text();
  console.log('ORDER HISTORY RESPONSE:', text);

  if (!response.ok) {
    throw new Error(text);
  }

  return { success: true };
}