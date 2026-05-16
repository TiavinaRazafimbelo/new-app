/**
 * StockPage.jsx
 * ─────────────────────────────────────────────────────────────
 * Page de gestion du stock — Backoffice PrestaShop
 * Refactorisée pour utiliser stockService.js
 *
 * FONCTIONNALITÉS :
 *   1. Ajout/retrait de stock (delta ou valeur absolue)
 *      - Si ligne stock existe → PUT /stock_availables/:id
 *      - Si ligne manquante   → endpoint custom PrestaShop
 *        (StockAvailable::updateQuantity)
 *
 *   2. Graphique d'évolution avec snapshot manuel/auto
 *      - Historique en sessionStorage
 *      - Tableau des variations
 * ─────────────────────────────────────────────────────────────
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  getProductsForStock,
  getCombinaisonsForStock,
  getStocksForProduct,
  findStockItem,
  applyStockDelta,
  setAbsoluteStock,
  chargerHistorique,
  sauvegarderHistorique,
  cleHistorique,
  ajouterPointHistorique,
} from '../services/stockService';
import './StockPage.css';

// ─── SVG Sparkline ────────────────────────────────────────────

function StockChart({ points, color = '#2563a8' }) {
  if (!points || points.length < 2) {
    return (
      <div className="chart-empty">
        <span className="chart-empty__icon">📊</span>
        <p>Sélectionnez un produit et faites un snapshot pour voir l'évolution</p>
      </div>
    );
  }

  const W = 560, H = 180, PAD = { t: 20, r: 20, b: 40, l: 60 };
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

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => ({
    y:   toY(minQ + f * range),
    val: Math.round(minQ + f * range),
  }));

  const step    = Math.max(1, Math.ceil(points.length / 6));
  const xLabels = points
    .map((p, i) => ({ p, i }))
    .filter(({ i }) => i % step === 0 || i === points.length - 1);

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

      <path d={areaD} fill="url(#areaGrad)" />
      <path d={pathD} fill="none" stroke={color} strokeWidth="2.2"
        strokeLinejoin="round" strokeLinecap="round" filter="url(#glow)" />

      {points.map((p, i) => (
        <circle key={i} cx={toX(i)} cy={toY(p.qty)} r="3.5"
          fill="#fff" stroke={color} strokeWidth="2" />
      ))}

      {xLabels.map(({ p, i }) => (
        <text key={i} x={toX(i)} y={H - 8} textAnchor="middle"
          fontSize="10" fill="#6b6860" fontFamily="'IBM Plex Mono', monospace">
          {p.label}
        </text>
      ))}
    </svg>
  );
}

// ─── Composant principal ──────────────────────────────────────

export default function StockPage() {
  // ── Section ajout de stock ──────────────────────────────────
  const [products,      setProducts]      = useState([]);
  const [selectedProd,  setSelectedProd]  = useState('');
  const [combinations,  setCombinations]  = useState([]);
  const [selectedCombi, setSelectedCombi] = useState('');
  const [stocks,        setStocks]        = useState([]);
  const [currentStock,  setCurrentStock]  = useState(null);
  const [modeInput,     setModeInput]     = useState('delta'); // 'delta' | 'absolu'
  const [deltaQty,      setDeltaQty]      = useState('');
  const [absolQty,      setAbsolQty]      = useState('');

  const [loadingProds,  setLoadingProds]  = useState(true);
  const [loadingCombi,  setLoadingCombi]  = useState(false);
  const [saving,        setSaving]        = useState(false);

  // ── Section graphique ───────────────────────────────────────
  const [chartProd,     setChartProd]     = useState('');
  const [chartCombi,    setChartCombi]    = useState('');
  const [chartCombis,   setChartCombis]   = useState([]);
  const [chartStock,    setChartStock]    = useState(null);
  const [loadingChart,  setLoadingChart]  = useState(false);
  const [history,       setHistory]       = useState(chargerHistorique);

  // ── Toast ───────────────────────────────────────────────────
  const [toast, setToast]     = useState(null);
  const toastTimer            = useRef(null);

  function showToast(msg, type = 'succes') {
    setToast({ msg, type });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }

  // ── Charger les produits ────────────────────────────────────
  useEffect(() => {
    setLoadingProds(true);
    getProductsForStock()
      .then(setProducts)
      .catch((err) => showToast(`Chargement produits : ${err.message}`, 'erreur'))
      .finally(() => setLoadingProds(false));
  }, []);

  // ── Produit sélectionné → charger combis + stocks ───────────
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
      getCombinaisonsForStock(selectedProd),
      getStocksForProduct(selectedProd),
    ])
      .then(([combis, stks]) => {
        setCombinations(combis);
        setStocks(stks);
        // Stock de base par défaut
        setCurrentStock(findStockItem(stks, '0'));
      })
      .catch((err) => showToast(`Chargement : ${err.message}`, 'erreur'))
      .finally(() => setLoadingCombi(false));
  }, [selectedProd]);

  // ── Combinaison change → mettre à jour currentStock ─────────
  useEffect(() => {
    if (!selectedProd) return;
    setCurrentStock(findStockItem(stocks, selectedCombi));
  }, [selectedCombi, stocks]);

  // ── Soumettre la modification de stock ──────────────────────
  async function handleSubmitStock(e) {
    e.preventDefault();

    if (!selectedProd) { showToast('Sélectionnez un produit', 'erreur'); return; }

    setSaving(true);
    try {
      let result;

      if (modeInput === 'delta') {
        const delta = parseInt(deltaQty);
        if (isNaN(delta) || delta === 0) throw new Error('Quantité invalide (ne peut pas être 0)');
        result = await applyStockDelta(currentStock, selectedProd, selectedCombi, delta);
      } else {
        const target = parseInt(absolQty);
        if (isNaN(target) || target < 0) throw new Error('Quantité absolue invalide');
        result = await setAbsoluteStock(currentStock, selectedProd, selectedCombi, target);
      }

      const { newQty, createdNew } = result;

      // Rafraîchir les stocks locaux
      const stksRefresh = await getStocksForProduct(selectedProd);
      setStocks(stksRefresh);
      setCurrentStock(findStockItem(stksRefresh, selectedCombi));

      // Ajouter au graphique si même produit/combi observé
      if (chartProd === selectedProd && chartCombi === selectedCombi) {
        const newHistory = ajouterPointHistorique(history, selectedProd, selectedCombi, newQty);
        setHistory(newHistory);
        sauvegarderHistorique(newHistory);
        setChartStock(findStockItem(stksRefresh, selectedCombi));
      }

      showToast(
        `${createdNew ? 'Ligne créée — ' : ''}Stock mis à jour → ${newQty} unités`,
        'succes'
      );
      setDeltaQty('');
      setAbsolQty('');
    } catch (err) {
      showToast(`Erreur : ${err.message}`, 'erreur');
    } finally {
      setSaving(false);
    }
  }

  // ── Snapshot graphique ──────────────────────────────────────
  async function snapshotChartStock() {
    if (!chartProd) return;
    setLoadingChart(true);
    try {
      const stks  = await getStocksForProduct(chartProd);
      const match = findStockItem(stks, chartCombi);
      if (!match) { showToast('Aucun stock trouvé pour ce produit/combinaison', 'erreur'); return; }

      setChartStock(match);
      const newHistory = ajouterPointHistorique(history, chartProd, chartCombi, match.quantity);
      setHistory(newHistory);
      sauvegarderHistorique(newHistory);
    } catch (err) {
      showToast(`Snapshot : ${err.message}`, 'erreur');
    } finally {
      setLoadingChart(false);
    }
  }

  // ── Combis pour le graphique ────────────────────────────────
  useEffect(() => {
    if (!chartProd) { setChartCombis([]); setChartCombi(''); setChartStock(null); return; }
    getCombinaisonsForStock(chartProd)
      .then((c) => { setChartCombis(c); setChartCombi(''); })
      .catch(() => setChartCombis([]));
  }, [chartProd]);

  // ── Snapshot auto quand chartProd/chartCombi change ─────────
  useEffect(() => {
    if (chartProd) snapshotChartStock();
  }, [chartProd, chartCombi]);

  const chartPoints = history[cleHistorique(chartProd, chartCombi)] || [];

  // Calcul aperçu delta
  const deltaPreview = (() => {
    if (modeInput === 'delta' && deltaQty !== '' && currentStock !== null) {
      const d = parseInt(deltaQty) || 0;
      if (d !== 0) return (currentStock?.quantity ?? 0) + d;
    }
    return null;
  })();

  // ─── Render ────────────────────────────────────────────────
  return (
    <div className="stock-page">

      {/* En-tête */}
      <div className="stock-entete">
        <div className="stock-entete__titre">
          <h2>Gestion du stock</h2>
          <p className="stock-entete__sub">Ajustez les niveaux et suivez l'évolution</p>
        </div>
      </div>

      <div className="stock-grid">

        {/* ── Panneau gauche : ajout / retrait ─────────────── */}
        <section className="stock-card">
          <div className="stock-card__header">
            <h3>Ajout / Retrait de stock</h3>
          </div>

          <form onSubmit={handleSubmitStock} className="stock-form">

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
                      #{c.id}  — Réf: {c.reference}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Stock actuel + statut de la ligne */}
            {selectedProd && !loadingCombi && (
              <div className={`stock-actuel ${currentStock ? '' : 'stock-actuel--absent'}`}>
                {currentStock ? (
                  <>
                    <span className="stock-actuel__label">Stock actuel</span>
                    <span className="stock-actuel__val">{currentStock.quantity}</span>
                    <span className="stock-actuel__unit">unités</span>
                  </>
                ) : (
                  <div className="stock-absent">
                    <span className="stock-absent__icon">⚠</span>
                    <div>
                      <strong>Aucune ligne de stock</strong>
                      <p>La ligne sera créée automatiquement via l'endpoint PrestaShop</p>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Mode : delta ou absolu */}
            <div className="form-groupe">
              <label className="form-label">Mode de saisie</label>
              <div className="mode-toggle">
                <button
                  type="button"
                  className={`mode-btn ${modeInput === 'delta' ? 'mode-btn--active' : ''}`}
                  onClick={() => setModeInput('delta')}
                >
                  ± Delta
                </button>
                <button
                  type="button"
                  className={`mode-btn ${modeInput === 'absolu' ? 'mode-btn--active' : ''}`}
                  onClick={() => setModeInput('absolu')}
                >
                  = Valeur absolue
                </button>
              </div>
            </div>

            {/* Input quantité */}
            {modeInput === 'delta' ? (
              <div className="form-groupe">
                <label className="form-label">
                  Quantité à ajouter
                  <span className="form-label__hint"> (négatif pour retirer)</span>
                </label>
                <div className="delta-input-wrapper">
                  <button
                    type="button"
                    className="delta-btn"
                    onClick={() => setDeltaQty((v) => String((parseInt(v) || 0) - 1))}
                  >−</button>
                  <input
                    type="number"
                    className="form-input delta-input"
                    value={deltaQty}
                    onChange={(e) => setDeltaQty(e.target.value)}
                    placeholder="ex : 50"
                    required
                  />
                  <button
                    type="button"
                    className="delta-btn"
                    onClick={() => setDeltaQty((v) => String((parseInt(v) || 0) + 1))}
                  >+</button>
                </div>
                {deltaPreview !== null && (
                  <div className={`delta-preview ${deltaPreview < (currentStock?.quantity ?? 0) ? 'delta-preview--down' : 'delta-preview--up'}`}>
                    {deltaPreview < (currentStock?.quantity ?? 0) ? '▼' : '▲'}{' '}
                    Nouveau stock : <strong>{deltaPreview}</strong>
                  </div>
                )}
              </div>
            ) : (
              <div className="form-groupe">
                <label className="form-label">Quantité absolue cible</label>
                <input
                  type="number"
                  min="0"
                  className="form-input"
                  value={absolQty}
                  onChange={(e) => setAbsolQty(e.target.value)}
                  placeholder="ex : 300"
                  required
                />
                {absolQty !== '' && currentStock && (
                  <div className={`delta-preview ${Number(absolQty) < currentStock.quantity ? 'delta-preview--down' : 'delta-preview--up'}`}>
                    {Number(absolQty) < currentStock.quantity ? '▼' : '▲'}{' '}
                    {currentStock.quantity} → <strong>{absolQty}</strong>
                  </div>
                )}
              </div>
            )}

            <button
              type="submit"
              className={`btn-submit ${saving ? 'btn-submit--loading' : ''}`}
              disabled={saving || !selectedProd}
            >
              {saving
                ? <><span className="btn-spinner" /> Mise à jour…</>
                : <>✓ Appliquer la modification</>
              }
            </button>
          </form>
        </section>

        {/* ── Panneau droit : graphique ────────────────────── */}
        <section className="stock-card">
          <div className="stock-card__header">
            <h3>Évolution du stock</h3>
            <button
              className="btn-snapshot"
              onClick={snapshotChartStock}
              disabled={!chartProd || loadingChart}
              title="Capturer le stock actuel"
            >
              {loadingChart
                ? <span className="btn-spinner btn-spinner--sm" />
                : '📸'
              }{' '}
              Snapshot
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
              <option value="">— Produit de base —</option>
              {chartCombis.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>

          {/* Méta stock actuel */}
          {chartStock && (
            <div className="chart-meta">
              <span className="chart-meta__qty">{chartStock.quantity}</span>
              <span className="chart-meta__label">unités actuellement</span>
              {chartPoints.length > 1 && (() => {
                const diff = chartPoints[chartPoints.length - 1].qty - chartPoints[0].qty;
                return (
                  <span className={`chart-meta__delta ${diff >= 0 ? 'chart-meta__delta--up' : 'chart-meta__delta--down'}`}>
                    {diff >= 0 ? '▲' : '▼'} {Math.abs(diff)}
                  </span>
                );
              })()}
            </div>
          )}

          {/* SVG Chart */}
          <div className="chart-area">
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
                    const diff = prev != null ? p.qty - prev.qty : null;
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

      {/* Toast */}
      {toast && (
        <div className={`toast toast--${toast.type} toast--visible`}>
          <span className="toast__icone">{toast.type === 'succes' ? '✓' : '✕'}</span>
          {toast.msg}
        </div>
      )}
    </div>
  );
}