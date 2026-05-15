/**
 * StockPage.jsx
 * ─────────────────────────────────────────────────────────────
 * Page de gestion du stock — Backoffice PrestaShop
 *
 * FONCTIONNALITÉS :
 *   1. Ajout de stock :
 *      - Sélection produit (avec référence)
 *      - Sélection combinaison si le produit en a
 *      - Saisie de la quantité à ajouter (ou retirer si négatif)
 *      - PUT /stock_availables/:id via l'API PrestaShop
 *
 *   2. Graphique d'évolution journalière :
 *      - Historique stocké en mémoire + sessionStorage (par session)
 *      - Snapshot du stock courant affiché sur graphique SVG maison
 *      - Sélection du produit/combinaison à observer
 * ─────────────────────────────────────────────────────────────
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import './StockPage.css';

// ─── Config API ───────────────────────────────────────────────
const API_KEY  = import.meta.env.VITE_PRESTA_API_KEY;
const BASE_URL = '/api';

function getAuthHeader() {
  return 'Basic ' + btoa(`${API_KEY}:`);
}

// ─── Helpers XML ──────────────────────────────────────────────
async function prestaGet(endpoint) {
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    headers: { Authorization: getAuthHeader(), Accept: 'application/xml' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${endpoint}`);
  return res.text();
}

async function prestaWrite(endpoint, xml, method = 'PUT') {
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    method,
    headers: {
      Authorization:  getAuthHeader(),
      'Content-Type': 'application/xml',
      Accept:         'application/xml',
    },
    body: xml,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text || `HTTP ${res.status}`);
  return text;
}

function xmlVal(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?(.*?)(?:\\]\\]>)?<\\/${tag}>`, 's'));
  return m ? m[1].trim() : '';
}

function xmlValLang(xml, tag, langId = 1) {
  // Try language tag first
  const langRe = new RegExp(`<${tag}[^>]*>[\\s\\S]*?<language id="${langId}"[^>]*>(?:<!\\[CDATA\\[)?(.*?)(?:\\]\\]>)?<\\/language>`, 's');
  const m = xml.match(langRe);
  if (m) return m[1].trim();
  return xmlVal(xml, tag);
}

function parseProducts(xml) {
  const blocks = [...xml.matchAll(/<product[^>]*>([\s\S]*?)<\/product>/g)];
  return blocks.map((b) => {
    const inner = b[1];
    return {
      id:        xmlVal(inner, 'id'),
      name:      xmlValLang(inner, 'name') || xmlVal(inner, 'name'),
      reference: xmlVal(inner, 'reference'),
    };
  }).filter((p) => p.id);
}

function parseCombinations(xml) {
  const blocks = [...xml.matchAll(/<combination[^>]*>([\s\S]*?)<\/combination>/g)];
  return blocks.map((b) => {
    const inner = b[1];
    return {
      id:        xmlVal(inner, 'id'),
      reference: xmlVal(inner, 'reference'),
      // Extract option values names if present
    };
  }).filter((c) => c.id);
}

function parseStockAvailables(xml) {
  const blocks = [...xml.matchAll(/<stock_available[^>]*>([\s\S]*?)<\/stock_available>/g)];
  return blocks.map((b) => {
    const inner = b[1];
    return {
      id:                   xmlVal(inner, 'id'),
      id_product:           xmlVal(inner, 'id_product'),
      id_product_attribute: xmlVal(inner, 'id_product_attribute'),
      quantity:             parseInt(xmlVal(inner, 'quantity') || '0'),
      id_shop:              xmlVal(inner, 'id_shop'),
    };
  }).filter((s) => s.id);
}

// ─── Build PUT XML pour stock_available ──────────────────────
function buildStockXml(stockItem, newQty) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<prestashop xmlns:xlink="http://www.w3.org/1999/xlink">
  <stock_available>
    <id><![CDATA[${stockItem.id}]]></id>
    <id_product><![CDATA[${stockItem.id_product}]]></id_product>
    <id_product_attribute><![CDATA[${stockItem.id_product_attribute}]]></id_product_attribute>
    <id_shop><![CDATA[${stockItem.id_shop || 1}]]></id_shop>
    <id_shop_group><![CDATA[0]]></id_shop_group>
    <quantity><![CDATA[${newQty}]]></quantity>
    <depends_on_stock><![CDATA[0]]></depends_on_stock>
    <out_of_stock><![CDATA[2]]></out_of_stock>
  </stock_available>
</prestashop>`;
}

// ─── Historique (sessionStorage) ──────────────────────────────
const HISTORY_KEY = 'stock_history_v1';

function loadHistory() {
  try {
    const raw = sessionStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function saveHistory(h) {
  try { sessionStorage.setItem(HISTORY_KEY, JSON.stringify(h)); } catch {}
}

/** Clé unique pour un produit/combinaison */
function histKey(productId, combiId) {
  return `${productId}_${combiId || '0'}`;
}

/** Ajoute un point dans l'historique */
function addHistoryPoint(history, productId, combiId, qty) {
  const key = histKey(productId, combiId);
  const now  = new Date();
  const label = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  const points = history[key] || [];
  const updated = [...points, { label, qty, ts: now.toISOString() }].slice(-20); // max 20 points
  return { ...history, [key]: updated };
}

// ─── SVG Sparkline chart ──────────────────────────────────────
function StockChart({ points, color = '#2563a8' }) {
  if (!points || points.length < 2) {
    return (
      <div className="chart-empty">
        <span>📊</span>
        <p>Ajoutez du stock pour voir l'évolution</p>
      </div>
    );
  }

  const W = 560, H = 180, PAD = { t: 20, r: 20, b: 40, l: 55 };
  const innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;

  const qtys  = points.map((p) => p.qty);
  const minQ  = Math.min(...qtys);
  const maxQ  = Math.max(...qtys);
  const range = maxQ - minQ || 1;

  const toX = (i) => PAD.l + (i / (points.length - 1)) * innerW;
  const toY = (q) => PAD.t + innerH - ((q - minQ) / range) * innerH;

  const pathD = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${toX(i).toFixed(1)} ${toY(p.qty).toFixed(1)}`)
    .join(' ');

  const areaD =
    `${pathD} L ${toX(points.length - 1).toFixed(1)} ${(PAD.t + innerH).toFixed(1)} L ${PAD.l} ${(PAD.t + innerH).toFixed(1)} Z`;

  // Y axis ticks
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => ({
    y:   toY(minQ + f * range),
    val: Math.round(minQ + f * range),
  }));

  // X labels (every nth)
  const step  = Math.max(1, Math.ceil(points.length / 6));
  const xLabels = points.filter((_, i) => i % step === 0 || i === points.length - 1);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="stock-chart-svg" preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={color} stopOpacity="0.18" />
          <stop offset="100%" stopColor={color} stopOpacity="0.01" />
        </linearGradient>
        <filter id="glow">
          <feGaussianBlur stdDeviation="2" result="blur" />
          <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>

      {/* Grid */}
      {yTicks.map((t, i) => (
        <g key={i}>
          <line x1={PAD.l} y1={t.y} x2={W - PAD.r} y2={t.y}
            stroke="#e2e0db" strokeWidth="1" strokeDasharray="4 3" />
          <text x={PAD.l - 8} y={t.y + 4} textAnchor="end"
            fontSize="10" fill="#6b6860" fontFamily="'IBM Plex Mono', monospace">
            {t.val}
          </text>
        </g>
      ))}

      {/* Area */}
      <path d={areaD} fill="url(#areaGrad)" />

      {/* Line */}
      <path d={pathD} fill="none" stroke={color} strokeWidth="2.2"
        strokeLinejoin="round" strokeLinecap="round" filter="url(#glow)" />

      {/* Dots */}
      {points.map((p, i) => (
        <circle key={i} cx={toX(i)} cy={toY(p.qty)} r="3.5"
          fill="#fff" stroke={color} strokeWidth="2" />
      ))}

      {/* X labels */}
      {xLabels.map((p, i) => {
        const origIdx = points.indexOf(p);
        return (
          <text key={i} x={toX(origIdx)} y={H - 8} textAnchor="middle"
            fontSize="10" fill="#6b6860" fontFamily="'IBM Plex Mono', monospace">
            {p.label}
          </text>
        );
      })}
    </svg>
  );
}

// ─── Composant principal ──────────────────────────────────────
export default function StockPage() {
  const [products,     setProducts]     = useState([]);
  const [selectedProd, setSelectedProd] = useState('');
  const [combinations, setCombinations] = useState([]);   // combis du produit sélectionné
  const [selectedCombi,setSelectedCombi]= useState('');   // '' = produit de base
  const [stocks,       setStocks]       = useState([]);   // stock_availables du produit
  const [currentStock, setCurrentStock] = useState(null); // stock_available sélectionné
  const [deltaQty,     setDeltaQty]     = useState('');   // delta à ajouter
  const [loading,      setLoading]      = useState(false);
  const [loadingProds, setLoadingProds] = useState(true);
  const [loadingCombi, setLoadingCombi] = useState(false);
  const [saving,       setSaving]       = useState(false);
  const [toast,        setToast]        = useState(null); // { msg, type }

  // Graphe
  const [chartProd,    setChartProd]    = useState('');
  const [chartCombi,   setChartCombi,]  = useState('');
  const [chartCombis,  setChartCombis]  = useState([]);
  const [history,      setHistory]      = useState(loadHistory);
  const [chartStock,   setChartStock]   = useState(null);
  const [loadingChart, setLoadingChart] = useState(false);

  const toastTimer = useRef(null);

  // ── Afficher un toast ────────────────────────────────────────
  function showToast(msg, type = 'succes') {
    setToast({ msg, type });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }

  // ── Charger tous les produits ────────────────────────────────
  useEffect(() => {
    setLoadingProds(true);
    prestaGet('/products?display=[id,name,reference]')
      .then((xml) => {
        const prods = parseProducts(xml);
        prods.sort((a, b) => a.name.localeCompare(b.name));
        setProducts(prods);
      })
      .catch((err) => showToast(`Chargement produits : ${err.message}`, 'erreur'))
      .finally(() => setLoadingProds(false));
  }, []);

  // ── Chargement combinaisons + stocks quand produit change ────
  useEffect(() => {
    if (!selectedProd) {
      setCombinations([]);
      setSelectedCombi('');
      setStocks([]);
      setCurrentStock(null);
      return;
    }

    setLoadingCombi(true);
    setSelectedCombi('');
    setCombinations([]);
    setCurrentStock(null);

    Promise.all([
      prestaGet(`/combinations?filter[id_product]=${selectedProd}&display=[id,reference]`),
      prestaGet(`/stock_availables?filter[id_product]=${selectedProd}&display=full`),
    ])
      .then(([combiXml, stockXml]) => {
        const combis = parseCombinations(combiXml);
        const stks   = parseStockAvailables(stockXml);
        setCombinations(combis);
        setStocks(stks);

        // Stock de base (id_product_attribute = 0)
        const base = stks.find((s) => s.id_product_attribute === '0' || s.id_product_attribute === 0);
        setCurrentStock(base || null);
      })
      .catch((err) => showToast(`Chargement : ${err.message}`, 'erreur'))
      .finally(() => setLoadingCombi(false));
  }, [selectedProd]);

  // ── Quand combinaison change, mettre à jour currentStock ─────
  useEffect(() => {
    if (!selectedProd) return;
    const attrId = selectedCombi || '0';
    const match  = stocks.find(
      (s) => String(s.id_product_attribute) === String(attrId)
    );
    setCurrentStock(match || null);
  }, [selectedCombi, stocks]);

  // ── Soumettre l'ajout de stock ───────────────────────────────
  async function handleAddStock(e) {
    e.preventDefault();
    const delta = parseInt(deltaQty);
    if (isNaN(delta) || delta === 0) { showToast('Quantité invalide', 'erreur'); return; }
    if (!currentStock) { showToast('Stock introuvable pour ce produit/combinaison', 'erreur'); return; }

    setSaving(true);
    try {
      const newQty = currentStock.quantity + delta;
      if (newQty < 0) { showToast('Le stock ne peut pas être négatif', 'erreur'); return; }

      const xml = buildStockXml(currentStock, newQty);
      await prestaWrite(`/stock_availables/${currentStock.id}`, xml);

      // Mise à jour locale
      const updated = { ...currentStock, quantity: newQty };
      setCurrentStock(updated);
      setStocks((prev) => prev.map((s) => s.id === currentStock.id ? updated : s));

      // Historique
      const newHistory = addHistoryPoint(history, selectedProd, selectedCombi, newQty);
      setHistory(newHistory);
      saveHistory(newHistory);

      showToast(`Stock mis à jour → ${newQty} unités`, 'succes');
      setDeltaQty('');
    } catch (err) {
      showToast(`Erreur : ${err.message}`, 'erreur');
    } finally {
      setSaving(false);
    }
  }

  // ── Snapshot stock (pour le graphe) ─────────────────────────
  async function snapshotChartStock() {
    if (!chartProd) return;
    setLoadingChart(true);
    try {
      const xml  = await prestaGet(`/stock_availables?filter[id_product]=${chartProd}&display=full`);
      const stks = parseStockAvailables(xml);
      const attrId = chartCombi || '0';
      const match  = stks.find((s) => String(s.id_product_attribute) === String(attrId));
      if (!match) { showToast('Aucun stock trouvé', 'erreur'); return; }

      setChartStock(match);
      const newHistory = addHistoryPoint(history, chartProd, chartCombi, match.quantity);
      setHistory(newHistory);
      saveHistory(newHistory);
    } catch (err) {
      showToast(`Snapshot : ${err.message}`, 'erreur');
    } finally {
      setLoadingChart(false);
    }
  }

  // ── Charger combis pour le graphe ───────────────────────────
  useEffect(() => {
    if (!chartProd) { setChartCombis([]); setChartCombi(''); return; }
    prestaGet(`/combinations?filter[id_product]=${chartProd}&display=[id,reference]`)
      .then((xml) => {
        setChartCombis(parseCombinations(xml));
        setChartCombi('');
      })
      .catch(() => setChartCombis([]));
  }, [chartProd]);

  // ── Snapshot auto quand chartProd/chartCombi change ──────────
  useEffect(() => {
    if (chartProd) snapshotChartStock();
  }, [chartProd, chartCombi]);

  const chartPoints = history[histKey(chartProd, chartCombi)] || [];
  const selectedProdObj  = products.find((p) => p.id === selectedProd);
  const selectedCombiObj = combinations.find((c) => c.id === selectedCombi);

  // ─── Render ──────────────────────────────────────────────────
  return (
    <div className="stock-page">

      {/* ── En-tête ─────────────────────────────────────────── */}
      <div className="stock-entete">
        <div className="stock-entete__titre">
          <span className="stock-entete__icone"></span>
          <div>
            <h2>Gestion du stock</h2>
            <p className="stock-entete__sub">Ajustez les niveaux et suivez l'évolution</p>
          </div>
        </div>
      </div>

      <div className="stock-grid">

        {/* ── Panneau gauche : ajout de stock ─────────────── */}
        <section className="stock-card stock-card--form">
          <div className="stock-card__header">
            <h3>Ajout / Retrait de stock</h3>
          </div>

          <form onSubmit={handleAddStock} className="stock-form">

            {/* Produit */}
            <div className="form-groupe">
              <label className="form-label">Produit</label>
              {loadingProds ? (
                <div className="skeleton-select" />
              ) : (
                <select
                  className="form-select"
                  value={selectedProd}
                  onChange={(e) => setSelectedProd(e.target.value)}
                  required
                >
                  <option value="">— Choisir un produit —</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}{p.reference ? ` (${p.reference})` : ''}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Combinaison */}
            <div className="form-groupe">
              <label className="form-label">
                Variante / Combinaison
                {combinations.length === 0 && selectedProd && !loadingCombi && (
                  <span className="form-label__hint"> — produit simple</span>
                )}
              </label>
              {loadingCombi ? (
                <div className="skeleton-select" />
              ) : (
                <select
                  className="form-select"
                  value={selectedCombi}
                  onChange={(e) => setSelectedCombi(e.target.value)}
                  disabled={combinations.length === 0}
                >
                  <option value="">— Produit de base —</option>
                  {combinations.map((c) => (
                    <option key={c.id} value={c.id}>
                      Combinaison #{c.id}{c.reference ? ` — ${c.reference}` : ''}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Stock actuel */}
            {currentStock && (
              <div className="stock-actuel">
                <span className="stock-actuel__label">Stock actuel</span>
                <span className="stock-actuel__val">{currentStock.quantity}</span>
                <span className="stock-actuel__unit">unités</span>
              </div>
            )}

            {selectedProd && !loadingCombi && !currentStock && (
              <div className="stock-warning">
                ⚠️ Aucune ligne de stock trouvée pour cette sélection
              </div>
            )}

            {/* Delta quantité */}
            <div className="form-groupe">
              <label className="form-label">
                Quantité à ajouter
                <span className="form-label__hint"> (négatif pour retirer)</span>
              </label>
              <div className="delta-input-wrapper">
                <button
                  type="button"
                  className="delta-btn delta-btn--minus"
                  onClick={() => setDeltaQty((v) => String((parseInt(v) || 0) - 1))}
                >−</button>
                <input
                  type="number"
                  className="form-input delta-input"
                  value={deltaQty}
                  onChange={(e) => setDeltaQty(e.target.value)}
                  placeholder="ex: 50"
                  required
                />
                <button
                  type="button"
                  className="delta-btn delta-btn--plus"
                  onClick={() => setDeltaQty((v) => String((parseInt(v) || 0) + 1))}
                >+</button>
              </div>
              {deltaQty !== '' && currentStock && (
                <div className="delta-preview">
                  {parseInt(deltaQty) > 0 ? '▲' : '▼'} Nouveau stock :{' '}
                  <strong>{currentStock.quantity + (parseInt(deltaQty) || 0)}</strong>
                </div>
              )}
            </div>

            <button
              type="submit"
              className={`btn-submit ${saving ? 'btn-submit--loading' : ''}`}
              disabled={saving || !selectedProd || !currentStock}
            >
              {saving ? (
                <><span className="btn-spinner" /> Mise à jour…</>
              ) : (
                <>✓ Appliquer la modification</>
              )}
            </button>
          </form>
        </section>

        {/* ── Panneau droit : graphique ────────────────────── */}
        <section className="stock-card stock-card--chart">
          <div className="stock-card__header">
            <h3>Évolution du stock</h3>
            <button
              className="btn-snapshot"
              onClick={snapshotChartStock}
              disabled={!chartProd || loadingChart}
              title="Capturer le stock actuel"
            >
              {loadingChart ? <span className="btn-spinner btn-spinner--sm" /> : '📸'} Snapshot
            </button>
          </div>

          {/* Sélecteurs graphe */}
          <div className="chart-selectors">
            <select
              className="form-select form-select--sm"
              value={chartProd}
              onChange={(e) => setChartProd(e.target.value)}
            >
              <option value="">— Produit à observer —</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}{p.reference ? ` (${p.reference})` : ''}
                </option>
              ))}
            </select>

            <select
              className="form-select form-select--sm"
              value={chartCombi}
              onChange={(e) => setChartCombi(e.target.value)}
              disabled={chartCombis.length === 0}
            >
              <option value="">— Base —</option>
              {chartCombis.map((c) => (
                <option key={c.id} value={c.id}>
                  Combinaison #{c.id}{c.reference ? ` — ${c.reference}` : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Graphe */}
          <div className="chart-area">
            {chartStock && (
              <div className="chart-meta">
                <span className="chart-meta__qty">{chartStock.quantity}</span>
                <span className="chart-meta__label">unités actuellement</span>
                {chartPoints.length > 1 && (() => {
                  const first = chartPoints[0].qty;
                  const last  = chartPoints[chartPoints.length - 1].qty;
                  const diff  = last - first;
                  return (
                    <span className={`chart-meta__delta ${diff >= 0 ? 'chart-meta__delta--up' : 'chart-meta__delta--down'}`}>
                      {diff >= 0 ? '▲' : '▼'} {Math.abs(diff)}
                    </span>
                  );
                })()}
              </div>
            )}
            <StockChart points={chartPoints} />
          </div>

          {/* Tableau historique */}
          {chartPoints.length > 0 && (
            <div className="chart-history">
              <table className="history-table">
                <thead>
                  <tr>
                    <th>Heure</th>
                    <th>Stock</th>
                    <th>Variation</th>
                  </tr>
                </thead>
                <tbody>
                  {[...chartPoints].reverse().map((p, i, arr) => {
                    const prev = arr[i + 1];
                    const diff = prev ? p.qty - prev.qty : null;
                    return (
                      <tr key={i}>
                        <td className="history-time">{p.label}</td>
                        <td className="history-qty">{p.qty}</td>
                        <td>
                          {diff !== null ? (
                            <span className={`history-delta ${diff > 0 ? 'history-delta--up' : diff < 0 ? 'history-delta--down' : ''}`}>
                              {diff > 0 ? '+' : ''}{diff}
                            </span>
                          ) : <span className="history-delta">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

      </div>

      {/* ── Toast ──────────────────────────────────────────── */}
      {toast && (
        <div className={`toast toast--${toast.type} toast--visible`}>
          <span className="toast__icone">{toast.type === 'succes' ? '✓' : '✕'}</span>
          {toast.msg}
        </div>
      )}
    </div>
  );
}