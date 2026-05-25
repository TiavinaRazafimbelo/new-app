/**
 * StockPage.jsx
 * ─────────────────────────────────────────────────────────────
 * Page de gestion du stock — Backoffice PrestaShop
 *
 * AJOUT :
 *   Tableau "Stock par catégorie" en bas de page.
 *   Utilise getStockParCategorie() depuis commandesService.
 *   Affiche : Catégorie | Qté physique | Qté réservée (paniers actifs) | Qté disponible
 *
 *   Ce tableau remplace la section équivalente dans StatistiquesPage.
 * ─────────────────────────────────────────────────────────────
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  getProductsForStock,
  getCombinaisonsForStock,
  getStocksForProduct,
  findStockItem,
  applyStockDelta,
  getStockHistory,
  getStockParCategorie,
} from '../services/stockService';
import './StockPage.css';

// ─── Tableau stock par catégorie ──────────────────────────────

function StockParCategorie({ data, loading, erreur, onActualiser }) {
  if (loading) {
    return (
      <div className="stock-cat-loading">
        <span className="btn-spinner btn-spinner--sm" />
        Chargement du stock par catégorie…
      </div>
    );
  }

  if (erreur) {
    return (
      <div className="stock-cat-erreur">
        <span>⚠</span>
        <span>{erreur}</span>
        <button className="btn-cat-retry" onClick={onActualiser}>↻ Réessayer</button>
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className="stock-cat-vide">
        <span></span>
        <p>Aucune donnée de stock disponible.</p>
      </div>
    );
  }

  const totalPhysique   = data.reduce((s, r) => s + r.qtyPhysique,   0);
  const totalReservee   = data.reduce((s, r) => s + r.qtyReservee,   0);
  const totalDisponible = data.reduce((s, r) => s + r.qtyDisponible, 0);

  return (
    <div className="stock-cat-tableau">
      <table className="stock-cat-table">
        <thead>
          <tr>
            <th>Catégorie</th>
            <th className="col-qty">Physique</th>
            <th className="col-qty">Réservé</th>
            <th className="col-qty">Disponible</th>
          </tr>
        </thead>
        <tbody>
          {data.map((r) => (
            <tr key={r.idCategorie}>
              <td className="cat-nom">{r.nomCategorie}</td>
              <td className="col-qty">
                <span className="qty-pill qty-pill--physique">{r.qtyPhysique}</span>
              </td>
              <td className="col-qty">
                {r.qtyReservee > 0
                  ? <span className="qty-pill qty-pill--reserve">{r.qtyReservee}</span>
                  : <span className="qty-zero">—</span>
                }
              </td>
              <td className="col-qty">
                <span className={`qty-pill qty-pill--dispo${r.qtyDisponible === 0 ? ' qty-pill--rupture' : ''}`}>
                  {r.qtyDisponible}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="stock-cat-total">
            <td><strong>TOTAL</strong></td>
            <td className="col-qty"><strong>{totalPhysique}</strong></td>
            <td className="col-qty"><strong>{totalReservee}</strong></td>
            <td className="col-qty"><strong>{totalDisponible}</strong></td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ─── Graphique SVG ────────────────────────────────────────────

function StockChart({ movements, currentQty }) {
  const points = (() => {
    if (!movements || movements.length === 0) return [];
    const chrono = [...movements].reverse();
    let qty = currentQty;
    const pts = [{ label: 'Actuel', qty, date: 'maintenant' }];
    for (const mvt of chrono) {
      qty -= mvt.quantity;
      const date  = new Date(mvt.date);
      const label = `${String(date.getDate()).padStart(2,'0')}/${String(date.getMonth()+1).padStart(2,'0')} ${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`;
      pts.push({ label, qty: Math.max(0, qty), date: mvt.date });
    }
    return pts.reverse();
  })();

  if (points.length < 2) {
    return (
      <div className="chart-empty">
        <span className="chart-empty__icon">📊</span>
        <p>Aucun mouvement de stock enregistré pour ce produit</p>
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
  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${toX(i).toFixed(1)} ${toY(p.qty).toFixed(1)}`).join(' ');
  const areaD = `${pathD} L ${toX(points.length - 1).toFixed(1)} ${(PAD.t + innerH).toFixed(1)} L ${PAD.l} ${(PAD.t + innerH).toFixed(1)} Z`;
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => ({ y: toY(minQ + f * range), val: Math.round(minQ + f * range) }));
  const step    = Math.max(1, Math.ceil(points.length / 5));
  const xLabels = points.map((p, i) => ({ p, i })).filter(({ i }) => i % step === 0 || i === points.length - 1);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="stock-chart-svg" preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2563a8" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#2563a8" stopOpacity="0.01" />
        </linearGradient>
        <filter id="glow">
          <feGaussianBlur stdDeviation="2" result="blur" />
          <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>
      {yTicks.map((t, i) => (
        <g key={i}>
          <line x1={PAD.l} y1={t.y} x2={W - PAD.r} y2={t.y} stroke="#e2e0db" strokeWidth="1" strokeDasharray="4 3" />
          <text x={PAD.l - 8} y={t.y + 4} textAnchor="end" fontSize="10" fill="#6b6860" fontFamily="'IBM Plex Mono', monospace">{t.val}</text>
        </g>
      ))}
      <path d={areaD} fill="url(#areaGrad)" />
      <path d={pathD} fill="none" stroke="#2563a8" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" filter="url(#glow)" />
      {points.map((p, i) => <circle key={i} cx={toX(i)} cy={toY(p.qty)} r="3.5" fill="#fff" stroke="#2563a8" strokeWidth="2" />)}
      {xLabels.map(({ p, i }) => <text key={i} x={toX(i)} y={H - 8} textAnchor="middle" fontSize="9" fill="#6b6860" fontFamily="'IBM Plex Mono', monospace">{p.label}</text>)}
    </svg>
  );
}

// ─── Composant principal ──────────────────────────────────────

export default function StockPage() {
  // ── Formulaire ──────────────────────────────────────────────
  const [products,      setProducts]      = useState([]);
  const [selectedProd,  setSelectedProd]  = useState('');
  const [combinations,  setCombinations]  = useState([]);
  const [selectedCombi, setSelectedCombi] = useState('');
  const [stocks,        setStocks]        = useState([]);
  const [currentStock,  setCurrentStock]  = useState(null);
  const [deltaQty,      setDeltaQty]      = useState('');

  const [loadingProds, setLoadingProds] = useState(true);
  const [loadingCombi, setLoadingCombi] = useState(false);
  const [saving,       setSaving]       = useState(false);

  // ── Graphique / Historique ───────────────────────────────────
  const [chartProd,   setChartProd]   = useState('');
  const [chartCombi,  setChartCombi]  = useState('');
  const [chartCombis, setChartCombis] = useState([]);
  const [historyData, setHistoryData] = useState(null);
  const [loadingHist, setLoadingHist] = useState(false);

  // ── Stock par catégorie ──────────────────────────────────────
  const [stockCatData,    setStockCatData]    = useState(null);
  const [stockCatLoading, setStockCatLoading] = useState(true);
  const [stockCatErreur,  setStockCatErreur]  = useState(null);

  // ── Toast ────────────────────────────────────────────────────
  const [toast,    setToast]    = useState(null);
  const toastTimer              = useRef(null);

  function showToast(msg, type = 'succes') {
    setToast({ msg, type });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }

  // ── Chargement stock par catégorie ───────────────────────────
  const chargerStockCat = useCallback(async () => {
    setStockCatLoading(true);
    setStockCatErreur(null);
    try {
      const data = await getStockParCategorie();
      setStockCatData(data);
    } catch (err) {
      setStockCatErreur(err.message);
    } finally {
      setStockCatLoading(false);
    }
  }, []);

  useEffect(() => { chargerStockCat(); }, [chargerStockCat]);

  // ── Chargement produits ──────────────────────────────────────
  useEffect(() => {
    setLoadingProds(true);
    getProductsForStock()
      .then(setProducts)
      .catch((err) => showToast(`Chargement produits : ${err.message}`, 'erreur'))
      .finally(() => setLoadingProds(false));
  }, []);

  // ── Produit formulaire → combis + stocks ─────────────────────
  useEffect(() => {
    if (!selectedProd) {
      setCombinations([]); setSelectedCombi('');
      setStocks([]); setCurrentStock(null);
      return;
    }
    setLoadingCombi(true);
    setSelectedCombi(''); setCombinations([]); setCurrentStock(null);

    Promise.all([
      getCombinaisonsForStock(selectedProd),
      getStocksForProduct(selectedProd),
    ])
      .then(([combis, stks]) => {
        setCombinations(combis);
        setStocks(stks);
        setCurrentStock(findStockItem(stks, ''));
        setSelectedCombi('');
      })
      .catch((err) => showToast(`Chargement : ${err.message}`, 'erreur'))
      .finally(() => setLoadingCombi(false));
  }, [selectedProd]);

  // ── Combinaison formulaire change ────────────────────────────
  useEffect(() => {
    if (!selectedProd) return;
    setCurrentStock(findStockItem(stocks, selectedCombi));
  }, [selectedCombi, stocks]);

  // ── Chargement historique ─────────────────────────────────────
  const chargerHistorique = useCallback(async () => {
    if (!chartProd) return;
    setLoadingHist(true);
    try {
      const data = await getStockHistory(chartProd, chartCombi, 50);
      setHistoryData(data);
    } catch (err) {
      showToast(`Historique : ${err.message}`, 'erreur');
      setHistoryData(null);
    } finally {
      setLoadingHist(false);
    }
  }, [chartProd, chartCombi]);

  useEffect(() => {
    setHistoryData(null);
    chargerHistorique();
  }, [chargerHistorique]);

  // ── Combis graphique ─────────────────────────────────────────
  useEffect(() => {
    if (!chartProd) { setChartCombis([]); setChartCombi(''); setHistoryData(null); return; }
    getCombinaisonsForStock(chartProd)
      .then((c) => { setChartCombis(c); setChartCombi(''); })
      .catch(() => setChartCombis([]));
  }, [chartProd]);

  // ── Soumission formulaire ─────────────────────────────────────
  async function handleSubmitStock(e) {
    e.preventDefault();
    if (!selectedProd) { showToast('Sélectionnez un produit', 'erreur'); return; }

    const delta = parseInt(deltaQty);
    if (isNaN(delta) || delta === 0) {
      showToast('Quantité invalide (ne peut pas être 0)', 'erreur');
      return;
    }

    setSaving(true);
    try {
      const result = await applyStockDelta(currentStock, selectedProd, selectedCombi, delta);

      const stksRefresh = await getStocksForProduct(selectedProd);
      setStocks(stksRefresh);
      setCurrentStock(findStockItem(stksRefresh, selectedCombi));

      const sameAttr =
        parseInt(chartCombi || '0') === parseInt(selectedCombi || '0');
      if (chartProd === selectedProd && sameAttr) {
        await chargerHistorique();
      }

      // Rafraîchir aussi le tableau stock catégorie
      chargerStockCat();

      showToast(`Stock mis à jour : ${result.qtyBefore} → ${result.newQty} unités`, 'succes');
      setDeltaQty('');
    } catch (err) {
      showToast(`Erreur : ${err.message}`, 'erreur');
    } finally {
      setSaving(false);
    }
  }

  const deltaPreview = (() => {
    if (deltaQty === '' || !currentStock) return null;
    const d = parseInt(deltaQty) || 0;
    return d !== 0 ? currentStock.quantity + d : null;
  })();

  // ─── Rendu ────────────────────────────────────────────────────
  return (
    <div className="stock-page">

      <div className="stock-entete">
        <div className="stock-entete__titre">
          <h2>Gestion du stock</h2>
          <p className="stock-entete__sub">Ajustez les niveaux et suivez les mouvements</p>
        </div>
      </div>

      <div className="stock-grid">

        {/* ── Panneau gauche : formulaire ───────────────────── */}
        <section className="stock-card">
          <div className="stock-card__header">
            <h3>Ajout / Retrait de stock</h3>
          </div>

          <form onSubmit={handleSubmitStock} className="stock-form">
            <div className="form-groupe">
              <label className="form-label">Produit</label>
              {loadingProds ? <div className="skeleton-select" /> : (
                <select className="form-select" value={selectedProd}
                  onChange={(e) => setSelectedProd(e.target.value)} required>
                  <option value="">— Choisir un produit —</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}{p.reference ? ` (${p.reference})` : ''}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="form-groupe">
              <label className="form-label">
                Variante / Combinaison
                {combinations.length === 0 && selectedProd && !loadingCombi && (
                  <span className="form-label__hint"> — produit simple</span>
                )}
              </label>
              {loadingCombi ? <div className="skeleton-select" /> : (
                <select className="form-select" value={selectedCombi}
                  onChange={(e) => setSelectedCombi(e.target.value)}
                  disabled={combinations.length === 0}>
                  <option value="">— Produit de base —</option>
                  {combinations.map((c) => (
                    <option key={c.id} value={c.id}>#{c.id} — Réf: {c.reference}</option>
                  ))}
                </select>
              )}
            </div>

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
                      <p>Créez un stock initial dans PrestaShop pour ce produit.</p>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="form-groupe">
              <label className="form-label">
                Quantité à ajouter
                <span className="form-label__hint"> (négatif pour retirer)</span>
              </label>
              <div className="delta-input-wrapper">
                <button type="button" className="delta-btn"
                  onClick={() => setDeltaQty((v) => String((parseInt(v) || 0) - 1))}>−</button>
                <input type="number" className="form-input delta-input" value={deltaQty}
                  onChange={(e) => setDeltaQty(e.target.value)} placeholder="ex : 50" required />
                <button type="button" className="delta-btn"
                  onClick={() => setDeltaQty((v) => String((parseInt(v) || 0) + 1))}>+</button>
              </div>
              {deltaPreview !== null && (
                <div className={`delta-preview ${deltaPreview < (currentStock?.quantity ?? 0) ? 'delta-preview--down' : 'delta-preview--up'}`}>
                  {deltaPreview < (currentStock?.quantity ?? 0) ? '▼' : '▲'}{' '}
                  Nouveau stock : <strong>{deltaPreview}</strong>
                </div>
              )}
            </div>

            <button type="submit"
              className={`btn-submit ${saving ? 'btn-submit--loading' : ''}`}
              disabled={saving || !selectedProd || !currentStock}>
              {saving
                ? <><span className="btn-spinner" /> Mise à jour…</>
                : <>✓ Appliquer la modification</>
              }
            </button>
          </form>
        </section>

        {/* ── Panneau droit : graphique + historique ────────── */}
        <section className="stock-card">
          <div className="stock-card__header">
            <h3>Évolution du stock</h3>
            {loadingHist && <span className="btn-spinner btn-spinner--sm" />}
          </div>

          <div className="chart-selectors">
            <select className="form-select form-select--sm" value={chartProd}
              onChange={(e) => setChartProd(e.target.value)}>
              <option value="">— Produit à observer —</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}{p.reference ? ` (${p.reference})` : ''}
                </option>
              ))}
            </select>

            <select className="form-select form-select--sm" value={chartCombi}
              onChange={(e) => setChartCombi(e.target.value)}
              disabled={chartCombis.length === 0}>
              <option value="">— Produit de base —</option>
              {chartCombis.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
          </div>

          {historyData && (
            <div className="chart-meta">
              <span className="chart-meta__qty">{historyData.current_qty}</span>
              <span className="chart-meta__label">unités actuellement</span>
              {historyData.movements.length > 0 && (() => {
                const total = historyData.movements.reduce((s, m) => s + m.quantity, 0);
                return (
                  <span className={`chart-meta__delta ${total >= 0 ? 'chart-meta__delta--up' : 'chart-meta__delta--down'}`}>
                    {total >= 0 ? '▲' : '▼'} {Math.abs(total)} sur {historyData.total} mouvements
                  </span>
                );
              })()}
            </div>
          )}

          <div className="chart-area">
            {historyData ? (
              <StockChart movements={historyData.movements} currentQty={historyData.current_qty} />
            ) : (
              !loadingHist && (
                <div className="chart-empty">
                  <span className="chart-empty__icon">📊</span>
                  <p>Sélectionnez un produit pour voir l'évolution</p>
                </div>
              )
            )}
          </div>

          {historyData && historyData.movements.length > 0 && (
            <div className="chart-history">
              <table className="history-table">
                <thead>
                  <tr><th>Date</th><th>Mouvement</th><th>Raison</th></tr>
                </thead>
                <tbody>
                  {historyData.movements.map((mvt) => (
                    <tr key={mvt.id}>
                      <td className="history-time">
                        {new Date(mvt.date).toLocaleString('fr-FR', {
                          day: '2-digit', month: '2-digit',
                          hour: '2-digit', minute: '2-digit',
                        })}
                      </td>
                      <td>
                        <span className={`history-delta ${mvt.quantity > 0 ? 'history-delta--up' : 'history-delta--down'}`}>
                          {mvt.quantity > 0 ? '+' : ''}{mvt.quantity}
                        </span>
                      </td>
                      <td className="history-reason">{mvt.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {historyData && historyData.movements.length === 0 && (
            <div className="chart-empty" style={{ padding: '24px' }}>
              <p>Aucun mouvement enregistré pour ce produit/combinaison.</p>
            </div>
          )}
        </section>
      </div>

      {/* ── Tableau stock par catégorie ───────────────────────── */}
      <section className="stock-card stock-card--full">
        <div className="stock-card__header">
          <h3>Stock par catégorie</h3>
          <span className="stock-card__hint">
            Qté réservée = articles dans des paniers actifs non commandés
          </span>
          <button
            className="btn-cat-actualiser"
            onClick={chargerStockCat}
            disabled={stockCatLoading}
            title="Actualiser"
          >
            {stockCatLoading ? '…' : '↻'}
          </button>
        </div>

        <StockParCategorie
          data={stockCatData}
          loading={stockCatLoading}
          erreur={stockCatErreur}
          onActualiser={chargerStockCat}
        />
      </section>

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