/**
 * Page Reset Data du Backoffice
 * Page pour réinitialiser les données
 */

import React, { useState } from 'react';
import './ResetDataPage.css';
import { get, getXmlText, del } from '../reset/client.js';

// export const ResetDataPage = () => {
  // =============================================================
// src/pages/backoffice/ResetPage.jsx
// =============================================================





const RESET_CONFIG = [
  { key: 'orders', label: 'Commandes', path: 'orders' },
  { key: 'customers', label: 'Clients', path: 'customers' },
  { key: 'products', label: 'Produits', path: 'products' },
  { key: 'categories', label: 'Categories', path: 'categories' },
];

const SINGULAR_NODE = {
  orders: 'order',
  customers: 'customer',
  products: 'product',
  categories: 'category',
};

const PROTECTED_CATEGORY_IDS = new Set(['1', '2']);

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export default function ResetDataPage() {
  const [selected, setSelected] = useState({
    orders: false,
    customers: false,
    products: false,
    categories: false,
  });
  const [logs, setLogs] = useState([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');

  function appendLog(message) {
    setLogs(prev => [...prev, { id: `${Date.now()}-${prev.length}`, message }]);
  }

  async function fetchIds(path) {
    const doc = await get(`${path}?display=full`);
    if (!doc) return [];
    const nodeName = SINGULAR_NODE[path] || path.slice(0, -1);
    return Array.from(doc.querySelectorAll(nodeName)).map(node => (
      node.getAttribute('id') || getXmlText(node, 'id')
    ));
  }

  async function deleteEntity(path, label) {
    appendLog(`Lecture des ${label}...`);
    const ids = await fetchIds(path);
    appendLog(`${ids.length} ${label} trouves.`);

    for (const id of ids) {
      if (path === 'categories' && PROTECTED_CATEGORY_IDS.has(String(id))) {
        appendLog(`Ignore ${label} #${id} (categorie systeme)`);
        continue;
      }
      try {
        await del(path, id);
        appendLog(`Supprime ${label} #${id}`);
      } catch (err) {
        if (err.message.includes('Id(s) not exists')) {
          appendLog(`${label} #${id} deja supprime`);
        } else {
          appendLog(`Erreur suppression ${label} #${id}: ${err.message}`);
        }
      }
      await sleep(300);
    }
  }

  async function handleReset() {
    setError('');
    setLogs([]);

    const summary = RESET_CONFIG
      .filter(item => selected[item.key])
      .map(item => item.label);

    if (summary.length === 0) {
      setError('Selectionnez au moins une entite.');
      return;
    }

    const confirmPayload = JSON.stringify({
      reset: summary,
      order: ['Commandes', 'Clients', 'Produits', 'Categories'],
    }, null, 2);

    const confirmed = window.confirm(
      `Confirmer la reinitialisation ?\n\n${confirmPayload}`
    );
    if (!confirmed) return;

    setRunning(true);

    try {
      for (const item of RESET_CONFIG) {
        if (!selected[item.key]) continue;
        await deleteEntity(item.path, item.label);
      }
      appendLog('Reset termine.');
    } catch (err) {
      setError(err.message);
    } finally {
      setRunning(false);
    }
  }

  return (
  <div className="reset-page">

    <div className="reset-content">

      <div className="reset-warning">
        <div>
          <h3>Reinitialisation</h3>
          <p>Suppression par API, dans l'ordre requis.</p>
        </div>
      </div>

      {error && <div className="reset-warning">{error}</div>}

      <div className="reset-content">

        <div className="sectionTitle">Choisir les entites</div>

        <div className="options">
          {RESET_CONFIG.map(item => (
            <label key={item.key} className="option">
              <input
                type="checkbox"
                checked={selected[item.key]}
                disabled={running}
                onChange={e => setSelected(prev => ({
                  ...prev,
                  [item.key]: e.target.checked,
                }))}
              />
              <span>{item.label}</span>
            </label>
          ))}
        </div>

        <button
          className="reset-button"
          type="button"
          onClick={handleReset}
          disabled={running}
        >
          {running ? 'Suppression en cours...' : 'Lancer la reinitialisation'}
        </button>

      </div>

      <div className="logs">

        <div className="sectionTitle">Logs</div>

        {logs.length === 0
          ? <div className="logEmpty">Aucun log pour le moment.</div>
          : logs.map(entry => (
            <div key={entry.id} className="logLine">{entry.message}</div>
          ))
        }

      </div>

    </div>
  </div>
);
}

// };

// export default ResetDataPage;
