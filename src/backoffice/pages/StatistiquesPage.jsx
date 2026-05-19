/**
 * StatistiquesPage.jsx
 * src/backoffice/pages/StatistiquesPage.jsx
 * ─────────────────────────────────────────────────────────────
 * Page statistiques du backoffice.
 *
 * SECTIONS :
 *   1. Cartes KPI globaux
 *      - CA HT total
 *      - Coût d'achat HT total
 *      - Bénéfice HT total
 *      - Marge %
 *
 *   2. Tableau ventes par catégorie
 *      Catégorie | CA HT | Coût achat HT | Bénéfice HT | Marge % | Qté vendue
 *
 *   3. Tableau stock par catégorie
 *      Catégorie | Qté physique | Qté réservée | Qté disponible
 * ─────────────────────────────────────────────────────────────
 */

import React, { useState, useEffect, useCallback } from 'react';
import { getStatistiques, getStockParCategorie } from '../services/commandesService';
import './StatistiquesPage.css';

// ─── Formatage ────────────────────────────────────────────────

function euro(v) {
  return Number(v || 0).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
}

function pct(v) {
  return `${Number(v || 0).toFixed(1)} %`;
}

// ─── KPI Card ─────────────────────────────────────────────────

function KpiCard({ label, valeur, formatFn, couleur, icone }) {
  return (
    <div className={`kpi-card kpi-card--${couleur}`}>
      <div className="kpi-card__icone">{icone}</div>
      <div className="kpi-card__corps">
        <span className="kpi-card__label">{label}</span>
        <span className="kpi-card__valeur">{formatFn(valeur)}</span>
      </div>
    </div>
  );
}

// ─── Barre de marge ───────────────────────────────────────────

function BarreMarge({ pct: margeVal }) {
  const val     = Math.max(0, Math.min(100, margeVal));
  const couleur = val >= 30 ? 'vert' : val >= 10 ? 'orange' : 'rouge';
  return (
    <div className="barre-marge" title={`${margeVal.toFixed(1)}%`}>
      <div
        className={`barre-marge__fill barre-marge__fill--${couleur}`}
        style={{ width: `${val}%` }}
      />
      <span className="barre-marge__label">{margeVal.toFixed(1)}%</span>
    </div>
  );
}

// ─── Tableau ventes ───────────────────────────────────────────

function TableauVentes({ stats, totaux }) {
  if (!stats.length) {
    return (
      <div className="stats-vide">
        <span>📊</span>
        <p>Aucune vente enregistrée (ou toutes les commandes sont annulées).</p>
      </div>
    );
  }

  return (
    <div className="stats-tableau-wrapper">
      <table className="stats-table">
        <thead>
          <tr>
            <th className="col-cat">Catégorie</th>
            <th className="col-num">CA HT</th>
            <th className="col-num">Coût achat HT</th>
            <th className="col-num">Bénéfice HT</th>
            <th className="col-marge">Marge</th>
            <th className="col-qty">Qté vendue</th>
          </tr>
        </thead>
        <tbody>
          {stats.map((s) => (
            <tr key={s.idCategorie} className="stats-row">
              <td className="col-cat">
                <span className="cat-label">{s.nomCategorie}</span>
              </td>
              <td className="col-num">
                <span className="montant">{euro(s.caHT)}</span>
              </td>
              <td className="col-num">
                <span className="montant montant--muted">{euro(s.coutAchatHT)}</span>
              </td>
              <td className="col-num">
                <span className={`montant montant--${s.beneficeHT >= 0 ? 'positif' : 'negatif'}`}>
                  {s.beneficeHT >= 0 ? '+' : ''}{euro(s.beneficeHT)}
                </span>
              </td>
              <td className="col-marge">
                <BarreMarge pct={s.margePercent} />
              </td>
              <td className="col-qty">
                <span className="qty-badge">{s.nbVentes}</span>
              </td>
            </tr>
          ))}
        </tbody>

        {/* Ligne totaux */}
        <tfoot>
          <tr className="stats-row stats-row--total">
            <td className="col-cat">
              <strong>TOTAL</strong>
            </td>
            <td className="col-num">
              <strong>{euro(totaux.caHT)}</strong>
            </td>
            <td className="col-num">
              <strong>{euro(totaux.coutAchatHT)}</strong>
            </td>
            <td className="col-num">
              <strong className={`montant--${totaux.beneficeHT >= 0 ? 'positif' : 'negatif'}`}>
                {totaux.beneficeHT >= 0 ? '+' : ''}{euro(totaux.beneficeHT)}
              </strong>
            </td>
            <td className="col-marge">
              <BarreMarge pct={totaux.margePercent} />
            </td>
            <td className="col-qty">
              <strong>{totaux.nbVentes}</strong>
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ─── Tableau stock ────────────────────────────────────────────

function TableauStock({ stock }) {
  if (!stock.length) {
    return (
      <div className="stats-vide">
        <span>📦</span>
        <p>Aucune donnée de stock disponible.</p>
      </div>
    );
  }

  const totalPhysique   = stock.reduce((s, r) => s + r.qtyPhysique,   0);
  const totalReservee   = stock.reduce((s, r) => s + r.qtyReservee,   0);
  const totalDisponible = stock.reduce((s, r) => s + r.qtyDisponible, 0);

  return (
    <div className="stats-tableau-wrapper">
      <table className="stats-table stats-table--stock">
        <thead>
          <tr>
            <th className="col-cat">Catégorie</th>
            <th className="col-qty col-qty--physique">Qté physique</th>
            <th className="col-qty col-qty--reserve">Qté réservée</th>
            <th className="col-qty col-qty--dispo">Qté disponible</th>
          </tr>
        </thead>
        <tbody>
          {stock.map((r) => (
            <tr key={r.idCategorie} className="stats-row">
              <td className="col-cat">
                <span className="cat-label">{r.nomCategorie}</span>
              </td>
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
                <span className={`qty-pill qty-pill--dispo ${r.qtyDisponible === 0 ? 'qty-pill--rupture' : ''}`}>
                  {r.qtyDisponible}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="stats-row stats-row--total">
            <td className="col-cat"><strong>TOTAL</strong></td>
            <td className="col-qty"><strong>{totalPhysique}</strong></td>
            <td className="col-qty"><strong>{totalReservee}</strong></td>
            <td className="col-qty"><strong>{totalDisponible}</strong></td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ─── Composant principal ──────────────────────────────────────

export default function StatistiquesPage() {
  const [statsData,    setStatsData]    = useState(null);
  const [stockData,    setStockData]    = useState(null);
  const [chargement,   setChargement]   = useState(true);
  const [erreur,       setErreur]       = useState(null);

  const charger = useCallback(async () => {
    setChargement(true);
    setErreur(null);
    try {
      const [stats, stock] = await Promise.all([
        getStatistiques(),
        getStockParCategorie(),
      ]);
      setStatsData(stats);
      setStockData(stock);
    } catch (err) {
      setErreur(err.message);
    } finally {
      setChargement(false);
    }
  }, []);

  useEffect(() => { charger(); }, [charger]);

  // ── Rendu ──────────────────────────────────────────────────
  return (
    <div className="stats-page">

      {/* ── En-tête ─────────────────────────────────────────── */}
      <div className="stats-entete">
        <div>
          <h2 className="stats-titre">Statistiques</h2>
          <p className="stats-sous-titre">
            Ventes, marges et niveaux de stock par catégorie
          </p>
        </div>
        <button
          className="btn-actualiser"
          onClick={charger}
          disabled={chargement}
        >
          {chargement ? '…' : '↻'} Actualiser
        </button>
      </div>

      {/* ── Chargement ──────────────────────────────────────── */}
      {chargement && (
        <div className="stats-chargement">
          <div className="spinner" />
          <p>Calcul des statistiques…</p>
        </div>
      )}

      {/* ── Erreur ──────────────────────────────────────────── */}
      {!chargement && erreur && (
        <div className="stats-erreur">
          <span>⚠</span>
          <div>
            <strong>Impossible de charger les statistiques</strong>
            <p>{erreur}</p>
            <button className="btn-reessayer" onClick={charger}>Réessayer</button>
          </div>
        </div>
      )}

      {/* ── Contenu ─────────────────────────────────────────── */}
      {!chargement && !erreur && statsData && stockData && (
        <>
          {/* ── KPI globaux ──────────────────────────────────── */}
          <div className="kpi-grille">
            <KpiCard
              label="CA HT total"
              valeur={statsData.totaux.caHT}
              formatFn={euro}
              couleur="bleu"
              icone=""
            />
            <KpiCard
              label="Coût d'achat HT"
              valeur={statsData.totaux.coutAchatHT}
              formatFn={euro}
              couleur="orange"
              icone=""
            />
            <KpiCard
              label="Bénéfice HT"
              valeur={statsData.totaux.beneficeHT}
              formatFn={euro}
              couleur={statsData.totaux.beneficeHT >= 0 ? 'vert' : 'rouge'}
              icone={statsData.totaux.beneficeHT >= 0 ? '' : ''}
            />
            <KpiCard
              label="Marge globale"
              valeur={statsData.totaux.margePercent}
              formatFn={pct}
              couleur={statsData.totaux.margePercent >= 20 ? 'vert' : 'orange'}
              icone=""
            />
          </div>

          {/* ── Section ventes ───────────────────────────────── */}
          <section className="stats-section">
            <div className="stats-section__entete">
              <h3 className="stats-section__titre">Ventes par catégorie</h3>
              <span className="stats-section__hint">
                Commandes non annulées uniquement
              </span>
            </div>
            <TableauVentes
              stats={statsData.stats}
              totaux={statsData.totaux}
            />
          </section>

          {/* ── Section stock ────────────────────────────────── */}
          <section className="stats-section">
            <div className="stats-section__entete">
              <h3 className="stats-section__titre">Stock par catégorie</h3>
              <span className="stats-section__hint">
                Qté réservée = articles dans des paniers actifs non commandés
              </span>
            </div>
            <TableauStock stock={stockData} />
          </section>
        </>
      )}
    </div>
  );
}