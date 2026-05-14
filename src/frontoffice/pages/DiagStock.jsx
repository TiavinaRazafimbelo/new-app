/**
 * DiagProduitXML.jsx
 * Affiche le XML brut du produit pour voir la structure exacte des associations.
 * Naviguer vers /diag-produit-xml/5
 */

import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

const API_KEY  = import.meta.env.VITE_PRESTA_API_KEY;
const BASE_URL = '/api';

function auth() { return 'Basic ' + btoa(`${API_KEY}:`); }

export default function DiagProduitXML() {
  const { id } = useParams();
  const [xml, setXml] = useState('');

  useEffect(() => {
    fetch(`${BASE_URL}/products/${id}?display=full`, {
      headers: { Authorization: auth(), Accept: 'application/xml' },
    })
      .then(r => r.text())
      .then(text => {
        // Extraire uniquement la section <associations> pour ne pas surcharger
        const start = text.indexOf('<associations>');
        const end   = text.indexOf('</associations>') + '</associations>'.length;
        const assoc = start >= 0 ? text.slice(start, end) : '(section <associations> non trouvée dans le XML)';

        // Aussi extraire les 500 premiers caractères du produit pour contexte
        const debut = text.slice(0, 300);

        setXml({ assoc, debut, full: text });
      });
  }, [id]);

  if (!xml) return <div style={{ padding: '2rem' }}>Chargement...</div>;

  return (
    <div style={{ padding: '1rem', fontFamily: 'monospace', fontSize: '12px', maxWidth: '900px' }}>
      <h1 style={{ fontFamily: 'sans-serif', fontSize: '1.2rem' }}>
        🔍 XML brut produit #{id} — section associations
      </h1>

      <h2 style={{ fontFamily: 'sans-serif', fontSize: '1rem', marginTop: '1rem' }}>
        Début du XML (300 premiers caractères)
      </h2>
      <pre style={{ background: '#f8f9fa', padding: '1rem', overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: '11px', border: '1px solid #dee2e6', borderRadius: '6px' }}>
        {xml.debut}
      </pre>

      <h2 style={{ fontFamily: 'sans-serif', fontSize: '1rem', marginTop: '1rem' }}>
        Section &lt;associations&gt; complète
      </h2>
      <pre style={{ background: '#f8f9fa', padding: '1rem', overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: '11px', border: '1px solid #dee2e6', borderRadius: '6px', maxHeight: '600px' }}>
        {xml.assoc}
      </pre>

      <h2 style={{ fontFamily: 'sans-serif', fontSize: '1rem', marginTop: '1rem' }}>
        XML complet (pour copier-coller)
      </h2>
      <details>
        <summary style={{ cursor: 'pointer', padding: '4px' }}>Afficher le XML complet</summary>
        <pre style={{ background: '#f8f9fa', padding: '1rem', overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: '10px', border: '1px solid #dee2e6', borderRadius: '6px', maxHeight: '800px' }}>
          {xml.full}
        </pre>
      </details>
    </div>
  );
}