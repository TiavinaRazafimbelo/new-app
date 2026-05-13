/**
 * DiagOrderSchema.jsx
 * ─────────────────────────────────────────────────────────────
 * Composant de diagnostic temporaire.
 * Affiche le schéma XML blank d'une order PrestaShop
 * pour identifier les champs requis exacts.
 *
 * UTILISATION :
 *   1. Ajouter temporairement dans App.jsx :
 *      import DiagOrderSchema from './frontoffice/pages/DiagOrderSchema';
 *      <Route path="/diag" element={<DiagOrderSchema />} />
 *   2. Naviguer vers /diag
 *   3. Copier le résultat et me l'envoyer
 *   4. Supprimer ce composant après diagnostic
 * ─────────────────────────────────────────────────────────────
 */

import React, { useEffect, useState } from 'react';

const API_KEY  = import.meta.env.VITE_PRESTA_API_KEY;
const BASE_URL = '/api';

function getAuthHeader() {
  return 'Basic ' + btoa(`${API_KEY}:`);
}

async function fetchRaw(endpoint) {
  const response = await fetch(`${BASE_URL}${endpoint}`, {
    headers: {
      Authorization: getAuthHeader(),
      Accept: 'application/xml',
    },
  });
  return {
    status: response.status,
    text: await response.text(),
  };
}

export default function DiagOrderSchema() {
  const [results, setResults] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function run() {
      const out = {};

      // 1. Schéma blank de l'order
      out['orders?schema=blank'] = await fetchRaw('/orders?schema=blank');

      // 2. Schéma synopsis (champs requis marqués)
      out['orders?schema=synopsis'] = await fetchRaw('/orders?schema=synopsis');

      // 3. Schéma blank du cart
      out['carts?schema=blank'] = await fetchRaw('/carts?schema=blank');

      // 4. Un exemple de commande existante (si elle existe)
      const ordersResp = await fetchRaw('/orders?limit=1&display=full');
      out['orders (exemple existant)'] = ordersResp;

      // 5. Liste des order_states disponibles
      out['order_states'] = await fetchRaw('/order_states?display=full');

      // 6. Liste des carriers disponibles
      out['carriers'] = await fetchRaw('/carriers?display=[id,name,active]');

      // 7. Liste des currencies
      out['currencies'] = await fetchRaw('/currencies?display=[id,name,active]');

      setResults(out);
      setLoading(false);
    }
    run();
  }, []);

  if (loading) return <div style={{ padding: '2rem', fontFamily: 'monospace' }}>Chargement diagnostic...</div>;

  return (
    <div style={{ padding: '1rem', fontFamily: 'monospace', fontSize: '12px' }}>
      <h1 style={{ fontFamily: 'sans-serif' }}>🔍 Diagnostic schéma PrestaShop Order</h1>
      <p style={{ fontFamily: 'sans-serif', color: '#666' }}>
        Copie tout le contenu de cette page et envoie-le pour diagnostic.
      </p>

      {Object.entries(results).map(([key, val]) => (
        <details key={key} style={{ marginBottom: '1rem', border: '1px solid #ccc', borderRadius: '6px' }}>
          <summary style={{
            padding: '0.5rem 0.75rem',
            cursor: 'pointer',
            background: val.status === 200 ? '#d4edda' : '#f8d7da',
            fontWeight: 'bold',
          }}>
            [{val.status}] {key}
          </summary>
          <pre style={{
            padding: '0.75rem',
            margin: 0,
            overflow: 'auto',
            maxHeight: '400px',
            background: '#f8f9fa',
            fontSize: '11px',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
          }}>
            {val.text || '(réponse vide)'}
          </pre>
        </details>
      ))}
    </div>
  );
}