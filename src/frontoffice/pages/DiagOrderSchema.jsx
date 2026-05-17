/**
 * DiagSchemas.jsx
 * Diagnostic temporaire — affiche les synopsis de taxes et categories
 * pour voir le format exact attendu par PrestaShop 8.
 * Route : /diag-schemas
 */

import React, { useEffect, useState } from 'react';

const API_KEY  = import.meta.env.VITE_PRESTA_API_KEY;
const BASE_URL = '/api';
function auth() { return 'Basic ' + btoa(`${API_KEY}:`); }

async function fetchSynopsis(resource) {
  const r = await fetch(`${BASE_URL}/${resource}?schema=synopsis`, {
    headers: { Authorization: auth(), Accept: 'application/xml' },
  });
  return { status: r.status, text: await r.text() };
}

export default function DiagSchemas() {
  const [results, setResults] = useState(null);

  useEffect(() => {
    Promise.all([
      fetchSynopsis('taxes'),
      fetchSynopsis('tax_rule_groups'),
      fetchSynopsis('categories'),
    ]).then(([taxes, groups, cats]) => {
      setResults({ taxes, groups, cats });
    });
  }, []);

  if (!results) return <div style={{ padding: '2rem' }}>Chargement...</div>;

  return (
    <div style={{ padding: '1rem', fontFamily: 'monospace', fontSize: '12px' }}>
      <h1 style={{ fontFamily: 'sans-serif' }}>Synopsis PrestaShop</h1>
      {Object.entries(results).map(([key, val]) => (
        <details key={key} open style={{ marginBottom: '1rem', border: '1px solid #ccc', borderRadius: '6px' }}>
          <summary style={{ padding: '8px 12px', background: val.status === 200 ? '#d4edda' : '#f8d7da', fontWeight: 'bold', cursor: 'pointer' }}>
            [{val.status}] {key}
          </summary>
          <pre style={{ padding: '1rem', overflow: 'auto', whiteSpace: 'pre-wrap', fontSize: '11px', background: '#f8f9fa' }}>
            {val.text}
          </pre>
        </details>
      ))}
    </div>
  );
}