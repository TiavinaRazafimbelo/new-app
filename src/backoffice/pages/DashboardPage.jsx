/**
 * DashboardPage.jsx
 * ─────────────────────────────────────────────────────────────
 * MODIFICATION v3 :
 *   - Section paniers : ID panier | Client | Date | Nb articles | Montant
 *     + ligne sous-total en bas
 *   - Section commandes : inchangée (avec montants barrés si non payé)
 *   - Section récapitulatif global : totaux séparés + combinés
 * ─────────────────────────────────────────────────────────────
 */

import React, { useState, useEffect, useCallback } from 'react';
import { getDashboardData, STATUT_PAYE_ID } from '../services/commandesService';
import './DashboardPage.css';

const STATUT_PAIEMENT_EFFECTUE = STATUT_PAYE_ID;

const STATUT_MAP = {
  10: { label: 'Dans le panier',    classe: 'gris'   },
  2:  { label: 'Paiement effectué', classe: 'vert'   },
  6:  { label: 'Annulé',            classe: 'rouge'  },
  3:  { label: 'En préparation',    classe: 'bleu'   },
  4:  { label: 'Expédié',           classe: 'bleu'   },
  5:  { label: 'Livré',             classe: 'vert'   },
  8:  { label: 'Erreur paiement',   classe: 'rouge'  },
  1:  { label: 'En attente',        classe: 'orange' },
};

function dateEnInput(d)  { return d.toISOString().slice(0, 10); }
function dateEnFR(iso)   {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
function montantFR(v) {
  return Number(v || 0).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
}
function estComptabilisee(c) { return Number(c.current_state) === STATUT_PAIEMENT_EFFECTUE; }

// ─── Sous-composants ──────────────────────────────────────────

function CarteStats({ icone, libelle, valeur, sous, couleur = 'neutre' }) {
  return (
    <div className={`carte-stats carte-stats--${couleur}`}>
      <div className="carte-stats__icone">{icone}</div>
      <div className="carte-stats__corps">
        <span className="carte-stats__valeur">{valeur}</span>
        <span className="carte-stats__libelle">{libelle}</span>
        {sous && <span className="carte-stats__sous">{sous}</span>}
      </div>
    </div>
  );
}

function BadgeStatutId({ statutId }) {
  const info = STATUT_MAP[statutId] || { label: String(statutId), classe: 'gris' };
  return <span className={`badge badge--${info.classe}`}>{info.label}</span>;
}

// ─── Tableau commandes du jour ────────────────────────────────

function TableauCommandes({ commandes }) {
  if (!commandes.length) return null;

  const sousTotal = commandes
    .filter(estComptabilisee)
    .reduce((s, c) => s + (c.total_paid || 0), 0);

  return (
    <div className="tableau-jour">
      <h3 className="tableau-jour__titre">
        <span className="tableau-jour__icone">📦</span>
        Commandes
        <span className="tableau-jour__badge">{commandes.length}</span>
      </h3>
      <div className="tableau-jour__wrapper">
        <table className="tableau-jour__table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Référence</th>
              <th>Date</th>
              <th>Statut</th>
              <th className="col-droite">Montant</th>
            </tr>
          </thead>
          <tbody>
            {commandes.map((c) => {
              const ok = estComptabilisee(c);
              return (
                <tr key={c.id} className={!ok ? 'ligne-non-comptabilisee' : ''}>
                  <td><span className="mono">#{c.id}</span></td>
                  <td><span className="mono">{c.reference || '—'}</span></td>
                  <td>{dateEnFR(c.date_add)}</td>
                  <td><BadgeStatutId statutId={Number(c.current_state)} /></td>
                  <td className="col-droite">
                    {ok
                      ? <strong>{montantFR(c.total_paid)}</strong>
                      : <span className="montant-exclu" title="Non comptabilisé"><s>{montantFR(c.total_paid)}</s></span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
          {sousTotal > 0 && (
            <tfoot>
              <tr className="tfoot-total">
                <td colSpan={4}>
                  Sous-total
                  <span className="tfoot-mention"> (paiements effectués uniquement)</span>
                </td>
                <td className="col-droite"><strong>{montantFR(sousTotal)}</strong></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

// ─── Tableau paniers du jour ──────────────────────────────────

function TableauPaniers({ paniers }) {
  if (!paniers.length) return null;

  const totalArticles   = paniers.reduce((s, p) => s + (p.nbArticles      || 0), 0);
  const totalMontant    = paniers.reduce((s, p) => s + (p.montantTotal    || 0), 0);
  const totalReductions = paniers.reduce((s, p) => s + (p.totalReductions || 0), 0);
  const hasReductions   = paniers.some((p) => (p.totalReductions || 0) > 0);

  return (
    <div className="tableau-jour tableau-jour--panier">
      <h3 className="tableau-jour__titre">
        <span className="tableau-jour__icone">🛒</span>
        Paniers abandonnés
        <span className="tableau-jour__badge tableau-jour__badge--panier">{paniers.length}</span>
      </h3>
      <div className="tableau-jour__wrapper">
        <table className="tableau-jour__table">
          <thead>
            <tr>
              <th>ID panier</th>
              <th>Client</th>
              <th>Date</th>
              <th className="col-droite">Nb articles</th>
              {hasReductions && <th className="col-droite">Sous-total</th>}
              {hasReductions && <th className="col-droite">Réduction</th>}
              <th className="col-droite">Montant TTC</th>
            </tr>
          </thead>
          <tbody>
            {paniers.map((p) => (
              <tr key={p.id}>
                <td><span className="mono panier-id">#{p.cartId}</span></td>
                <td>
                  <div className="client-info-dash">
                    <span className="client-nom-dash">
                      {p.firstname || p.lastname
                        ? `${p.firstname} ${p.lastname}`.trim()
                        : <span className="texte-muted">—</span>}
                    </span>
                    {p.email && <span className="client-email-dash">{p.email}</span>}
                  </div>
                </td>
                <td>{dateEnFR(p.date_add)}</td>
                <td className="col-droite">
                  <span className="badge-nb-art-dash">{p.nbArticles}</span>
                </td>
                {hasReductions && (
                  <td className="col-droite">
                    <span className="montant-panier montant--muted">
                      {montantFR(p.sousTotal || p.montantTotal)}
                    </span>
                  </td>
                )}
                {hasReductions && (
                  <td className="col-droite">
                    {(p.totalReductions || 0) > 0 ? (
                      <span
                        className="badge-reduction-dash"
                        title={(p.promos || []).map((pr) => `${pr.nom} : −${montantFR(pr.montant)}`).join(' | ')}
                      >
                        −{montantFR(p.totalReductions)}
                        {p.promos?.length > 0 && <span style={{fontSize:'10px'}}> ⓘ</span>}
                      </span>
                    ) : (
                      <span className="texte-muted">—</span>
                    )}
                  </td>
                )}
                <td className="col-droite">
                  <span className="montant-panier">{montantFR(p.montantTotal)}</span>
                </td>
              </tr>
            ))}
          </tbody>
          {/* ── Sous-total ── */}
          <tfoot>
            <tr className="tfoot-total tfoot-total--panier">
              <td colSpan={3} className="tfoot-label-panier">
                Sous-total — {paniers.length} panier{paniers.length > 1 ? 's' : ''}
              </td>
              <td className="col-droite">
                <strong>{totalArticles} art.</strong>
              </td>
              {hasReductions && (
                <td className="col-droite">
                  <strong>{montantFR(paniers.reduce((s, p) => s + (p.sousTotal || p.montantTotal || 0), 0))}</strong>
                </td>
              )}
              {hasReductions && (
                <td className="col-droite">
                  <strong className="montant-reduction-total">−{montantFR(totalReductions)}</strong>
                </td>
              )}
              <td className="col-droite">
                <strong>{montantFR(totalMontant)}</strong>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

// ─── Section totaux récapitulatifs ────────────────────────────

function SectionTotaux({ commandesPayees, tousLesPaniers, commandesTotales }) {
  const caReel        = commandesPayees.reduce((s, c) => s + (c.total_paid || 0), 0);
  const caPaniers     = tousLesPaniers.reduce((s, p) => s + (p.montantTotal || 0), 0);
  const caCombine     = caReel + caPaniers;

  return (
    <div className="section-totaux">
      <div className="section-titre" style={{ marginBottom: 16 }}>
        <span className="section-titre__ligne" />
        <span className="section-titre__texte">Récapitulatif global</span>
        <span className="section-titre__ligne" />
      </div>

      {/* Ligne 1 : compteurs */}
      <div className="cartes-grille cartes-grille--3">
        <CarteStats
          icone="✅"
          libelle="Commandes payées"
          valeur={commandesPayees.length}
          sous={`sur ${commandesTotales.length} commande${commandesTotales.length > 1 ? 's' : ''} au total`}
          couleur="vert"
        />
        <CarteStats
          icone="🛒"
          libelle="Paniers abandonnés"
          valeur={tousLesPaniers.length}
          sous="Avec articles, sans paiement"
          couleur="neutre"
        />
        <CarteStats
          icone="📋"
          libelle="Total commandes"
          valeur={commandesTotales.length}
          sous="Tous statuts"
          couleur="bleu"
        />
      </div>

      <div className="totaux-divider"><span>Montants</span></div>

      {/* Ligne 2 : montants */}
      <div className="cartes-grille cartes-grille--2">
        {/* CA réel : paiements uniquement */}
        <div className="carte-totaux carte-totaux--reel">
          <div className="carte-totaux__header">
            <span className="carte-totaux__icone">💶</span>
            <span className="carte-totaux__titre">CA réel (paiements effectués)</span>
          </div>
          <div className="carte-totaux__montant">{montantFR(caReel)}</div>
          <div className="carte-totaux__detail">
            {commandesPayees.length} commande{commandesPayees.length > 1 ? 's' : ''} payée{commandesPayees.length > 1 ? 's' : ''}
          </div>
        </div>

        {/* CA potentiel : réel + paniers */}
        <div className="carte-totaux carte-totaux--potentiel">
          <div className="carte-totaux__header">
            <span className="carte-totaux__icone">💡</span>
            <span className="carte-totaux__titre">CA potentiel (+ paniers)</span>
          </div>
          <div className="carte-totaux__montant">{montantFR(caCombine)}</div>
          <div className="carte-totaux__detail">
            <span className="detail-bloc">
              Payés : <strong>{montantFR(caReel)}</strong>
            </span>
            <span className="detail-sep">+</span>
            <span className="detail-bloc">
              Paniers : <strong>{montantFR(caPaniers)}</strong>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Composant principal ──────────────────────────────────────

const DashboardPage = () => {
  const [dateSelectionnee, setDateSelectionnee] = useState(dateEnInput(new Date()));
  const [commandesJour,    setCommandesJour]    = useState([]);
  const [paniersJour,      setPaniersJour]      = useState([]);
  const [commandesToutes,  setCommandesToutes]  = useState([]);
  const [paniersTous,      setPaniersTous]      = useState([]);
  const [chargement,       setChargement]       = useState(true);
  const [erreur,           setErreur]           = useState(null);

  const charger = useCallback(async () => {
    setChargement(true);
    setErreur(null);
    try {
      const [jour, global] = await Promise.all([
        getDashboardData(dateSelectionnee),
        getDashboardData(''),
      ]);
      setCommandesJour(jour.commandes);
      setPaniersJour(jour.paniers);
      setCommandesToutes(global.commandes);
      setPaniersTous(global.paniers);
    } catch (err) {
      setErreur(err.message);
    } finally {
      setChargement(false);
    }
  }, [dateSelectionnee]);

  useEffect(() => { charger(); }, [charger]);

  const commandesJourPayees   = commandesJour.filter(estComptabilisee);
  const commandesToutesPayees = commandesToutes.filter(estComptabilisee);
  const montantJour           = commandesJourPayees.reduce((s, c) => s + (c.total_paid || 0), 0);
  const montantPaniersJour    = paniersJour.reduce((s, p) => s + (p.montantTotal || 0), 0);

  return (
    <div className="dashboard-page">

      {/* ─── En-tête ─────────────────────────────────────── */}
      <div className="dashboard-entete">
        <div className="dashboard-entete__titre">
          <h2>Tableau de bord</h2>
        </div>
        <div className="dashboard-date">
          <label htmlFor="date-picker" className="date-label">Date consultée</label>
          <div className="date-wrapper">
            <input
              id="date-picker"
              type="date"
              className="date-input"
              value={dateSelectionnee}
              max={dateEnInput(new Date())}
              onChange={(e) => setDateSelectionnee(e.target.value)}
            />
            <button
              className="btn-aujourd-hui"
              onClick={() => setDateSelectionnee(dateEnInput(new Date()))}
            >
              Aujourd'hui
            </button>
          </div>
        </div>
      </div>

      {chargement && (
        <div className="dashboard-chargement">
          <div className="spinner" />
          <p>Chargement des données…</p>
        </div>
      )}

      {!chargement && erreur && (
        <div className="dashboard-erreur">
          <span>⚠</span>
          <div>
            <strong>Erreur de chargement</strong>
            <p>{erreur}</p>
            <button className="btn-reessayer" onClick={charger}>Réessayer</button>
          </div>
        </div>
      )}

      {!chargement && !erreur && (
        <>
          {/* ══ Section du jour ══════════════════════════════ */}
          <div className="section-titre">
            <span className="section-titre__ligne" />
            <span className="section-titre__texte">
              {dateSelectionnee === dateEnInput(new Date()) ? "Aujourd'hui" : `Le ${dateEnFR(dateSelectionnee)}`}
            </span>
            <span className="section-titre__ligne" />
          </div>

          {/* Cartes résumé du jour */}
          <div className="cartes-grille cartes-grille--3">
            <CarteStats
              icone="📦"
              libelle="Commandes"
              valeur={commandesJour.length}
              sous={`${commandesJourPayees.length} payée${commandesJourPayees.length > 1 ? 's' : ''} sur ${commandesJour.length}`}
              couleur="bleu"
            />
            <CarteStats
              icone="🛒"
              libelle="Paniers abandonnés"
              valeur={paniersJour.length}
              sous={paniersJour.length === 0 ? 'Aucun' : `${montantFR(montantPaniersJour)} en attente`}
              couleur="neutre"
            />
            <CarteStats
              icone="💶"
              libelle="Montant encaissé"
              valeur={montantFR(montantJour)}
              sous="Paiements effectués uniquement"
              couleur="vert"
            />
          </div>

          {/* Tableaux du jour */}
          {commandesJour.length === 0 && paniersJour.length === 0 ? (
            <div className="etat-vide">
              <span className="etat-vide__icone">🗓</span>
              <p>Aucune commande ni panier pour le {dateEnFR(dateSelectionnee)}</p>
            </div>
          ) : (
            <div className="tableaux-jour-wrapper">
              {commandesJour.length > 0 && <TableauCommandes commandes={commandesJour} />}
              {paniersJour.length   > 0 && <TableauPaniers   paniers={paniersJour} />}
            </div>
          )}

          {/* ══ Total général ════════════════════════════════ */}
          <div className="section-titre" style={{ marginTop: 44 }}>
            <span className="section-titre__ligne" />
            <span className="section-titre__texte">Total général</span>
            <span className="section-titre__ligne" />
          </div>

          <div className="cartes-grille cartes-grille--2" style={{ marginBottom: 24 }}>
            <CarteStats
              icone="📦"
              libelle="Toutes les commandes"
              valeur={commandesToutes.length}
              sous={`${commandesToutesPayees.length} payée${commandesToutesPayees.length > 1 ? 's' : ''}`}
              couleur="neutre"
            />
            <CarteStats
              icone="💶"
              libelle="CA total encaissé"
              valeur={montantFR(commandesToutesPayees.reduce((s, c) => s + (c.total_paid || 0), 0))}
              sous="Paiements effectués uniquement"
              couleur="or"
            />
          </div>

          {/* ══ Récapitulatif avec paniers ═══════════════════ */}
          <SectionTotaux
            commandesPayees={commandesToutesPayees}
            tousLesPaniers={paniersTous}
            commandesTotales={commandesToutes}
          />
        </>
      )}
    </div>
  );
};

export default DashboardPage;