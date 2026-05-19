/**
 * CommandesPage.jsx
 * ─────────────────────────────────────────────────────────────
 * MODIFICATION v5 :
 *   - Deux sections distinctes dans la page :
 *       1. Tableau des commandes (orders PrestaShop)
 *          Colonnes : ID | Référence | Client | Date | Total | Statut | Modifier
 *       2. Tableau des paniers abandonnés
 *          Colonnes : ID Client | Date | Nb articles | Total | Statut
 *   - Le filtre "Statut" permet de choisir "Dans le panier"
 *     pour n'afficher que la section paniers (la section commandes se masque)
 *   - Pas de mélange dans un même tableau
 * ─────────────────────────────────────────────────────────────
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  getCommandes,
  getStatutsCommande,
  getStatutsModifiables,
  updateStatutCommande,
  STATUT_PANIER_ID,
  STATUT_PANIER_LABEL,
  STATUT_PAYE_LABEL,   
  updateOrderAction,    
  ACTIONS_PAR_ETAT,     
  ACTION_LABELS,        
} from '../services/commandesService';

import './CommandesPage.css';

const LIMIT = 20;

const STATUT_COULEURS = {
  'paiement accepté':         'vert',
  'paiement effectué':        'vert',
  'en cours de préparation':  'bleu',
  'expédié':                  'bleu',
  'livré':                    'vert',
  'annulé':                   'rouge',
  'remboursé':                'orange',
  'erreur de paiement':       'rouge',
  'en attente':               'gris',
  'dans le panier':           'gris',
};

function getCouleurStatut(libelle = '') {
  const key = libelle.toLowerCase();
  for (const [pattern, couleur] of Object.entries(STATUT_COULEURS)) {
    if (key.includes(pattern)) return couleur;
  }
  return 'gris';
}

function montantFR(v) {
  return Number(v || 0).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
}

function Toast({ message, type, visible }) {
  return (
    <div className={`toast toast--${type} ${visible ? 'toast--visible' : ''}`}>
      <span className="toast__icone">{type === 'succes' ? '✓' : '✕'}</span>
      {message}
    </div>
  );
}

function BadgeStatut({ libelle }) {
  return (
    <span className={`badge badge--${getCouleurStatut(libelle)}`}>
      {libelle || '—'}
    </span>
  );
}

// ─── Ligne commande (order) ────────────────────────────────────

function LigneCommande({
  commande,
  statuts,
  statutsModifiables,
  onStatutChange,
  onAction,          // ← NOUVEAU : handler pour livrer/annuler
  enCoursDeMaj,
}) {
  const [statutSel, setStatutSel] = React.useState(
    commande.current_state?.toString() || ''
  );
 
  React.useEffect(() => {
    setStatutSel(commande.current_state?.toString() || '');
  }, [commande.current_state]);
 
  const statutActuel = statuts.find(
    (s) => s.id?.toString() === commande.current_state?.toString()
  );
 
  // Actions disponibles pour cet état
  const actionsDispos = ACTIONS_PAR_ETAT[Number(commande.current_state)] ?? [];
 
  return (
    <tr className={`ligne-commande ${enCoursDeMaj ? 'ligne-commande--maj' : ''}`}>
      <td className="col-id">
        <span className="id-commande">#{commande.id}</span>
      </td>
      <td className="col-ref">
        <span className="ref">{commande.reference || '—'}</span>
      </td>
      <td className="col-client">
        <div className="client-info">
          <span className="client-nom">
            {commande.firstname} {commande.lastname}
          </span>
          {commande.email && (
            <span className="client-email">{commande.email}</span>
          )}
        </div>
      </td>
      <td className="col-date">
        {commande.date_add
          ? new Date(commande.date_add).toLocaleDateString('fr-FR', {
              day: '2-digit', month: '2-digit', year: 'numeric',
            })
          : '—'}
      </td>
      <td className="col-total">
        <span className="montant">
          {Number(commande.total_paid || 0).toLocaleString('fr-FR', {
            style: 'currency', currency: 'EUR',
          })}
        </span>
      </td>
      <td className="col-statut">
        {/* Badge statut actuel */}
        <span className={`badge badge--${getCouleurStatut(statutActuel?.name || '')}`}>
          {statutActuel?.name || '—'}
        </span>
      </td>
      <td className="col-action">
        <div className="action-groupe">
 
          {/* Select de statut (existant) */}
          <div className="select-wrapper">
            <select
              value={statutSel}
              onChange={(e) => {
                setStatutSel(e.target.value);
                onStatutChange(commande.id, e.target.value);
              }}
              disabled={enCoursDeMaj}
              className="select-statut"
            >
              <option value="" disabled>Choisir…</option>
              {statutsModifiables.map((s) => (
                <option key={s.id} value={s.id.toString()}>{s.name}</option>
              ))}
            </select>
            {enCoursDeMaj && <span className="spinner-inline" />}
          </div>
 
          {/* ── Boutons d'action rapide ─────────────────────────
              Affichés uniquement si des actions sont disponibles
              pour l'état actuel (ACTIONS_PAR_ETAT).
              Les états terminaux (livré=5, annulé=6) n'ont pas
              d'actions → les boutons sont masqués.
          ─────────────────────────────────────────────────────── */}
          {actionsDispos.length > 0 && (
            <div className="btn-actions-rapides">
              {actionsDispos.map((action) => {
                const cfg = ACTION_LABELS[action];
                return (
                  <button
                    key={action}
                    className={`btn-action btn-action--${cfg.style}`}
                    onClick={() => onAction(commande.id, action)}
                    disabled={enCoursDeMaj}
                    title={cfg.label}
                  >
                    <span className="btn-action__icone">{cfg.icon}</span>
                    <span className="btn-action__label">{cfg.label}</span>
                  </button>
                );
              })}
            </div>
          )}
 
        </div>
      </td>
    </tr>
  );
}

// ─── Tableau commandes ─────────────────────────────────────────

function TableauCommandes({ commandes, statuts, statutsModifiables, onStatutChange, onAction, majEnCours, pages, pageActuelle, onPage }) {
  return (
    <div className="commandes-contenu">
      {commandes.length === 0 ? (
        <div className="etat-vide">
          <span className="etat-vide__icone">📦</span>
          <h3>Aucune commande</h3>
          <p>Essayez de modifier vos filtres.</p>
        </div>
      ) : (
        <>
          <div className="tableau-wrapper">
            <table className="tableau-commandes">
              <thead>
                <tr>
                  <th className="col-id">ID</th>
                  <th className="col-ref">Référence</th>
                  <th className="col-client">Client</th>
                  <th className="col-date">Date</th>
                  <th className="col-total">Total TTC</th>
                  <th className="col-statut">Statut</th>
                  <th className="col-action">Modifier</th>
                </tr>
              </thead>
              <tbody>
                {commandes.map((c) => (
                  <LigneCommande
                    key={c.id}
                    commande={c}
                    statuts={statuts}
                    statutsModifiables={statutsModifiables}
                    onStatutChange={onStatutChange}
                    onAction={onAction}
                    enCoursDeMaj={!!majEnCours[c.id]}
                  />
                ))}
              </tbody>
            </table>
          </div>
          {pages > 1 && (
            <div className="pagination">
              <button className="pagination__btn" onClick={() => onPage(1)}               disabled={pageActuelle === 1}>«</button>
              <button className="pagination__btn" onClick={() => onPage(pageActuelle - 1)} disabled={pageActuelle === 1}>‹</button>
              <span className="pagination__info">
                Page <strong>{pageActuelle}</strong> sur <strong>{pages}</strong>
              </span>
              <button className="pagination__btn" onClick={() => onPage(pageActuelle + 1)} disabled={pageActuelle === pages}>›</button>
              <button className="pagination__btn" onClick={() => onPage(pages)}            disabled={pageActuelle === pages}>»</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Tableau paniers ───────────────────────────────────────────

function TableauPaniers({ paniers }) {
  if (paniers.length === 0) {
    return (
      <div className="commandes-contenu">
        <div className="etat-vide">
          <span className="etat-vide__icone">🛒</span>
          <h3>Aucun panier abandonné</h3>
          <p>Tous les paniers avec articles ont une commande associée.</p>
        </div>
      </div>
    );
  }

  const totalMontant    = paniers.reduce((s, p) => s + (p.montantTotal    || 0), 0);
  const totalArticles   = paniers.reduce((s, p) => s + (p.nbArticles      || 0), 0);
  const totalReductions = paniers.reduce((s, p) => s + (p.totalReductions || 0), 0);
  const hasReductions   = paniers.some((p) => (p.totalReductions || 0) > 0);

  return (
    <div className="commandes-contenu">
      <div className="tableau-wrapper">
        <table className="tableau-commandes">
          <thead>
            <tr>
              <th className="col-id">ID Client</th>
              <th className="col-client">Client</th>
              <th className="col-date">Date</th>
              <th className="col-nb-art">Nb articles</th>
              {hasReductions && <th className="col-total">Sous-total</th>}
              {hasReductions && <th className="col-reduction">Réduction</th>}
              <th className="col-total">Total TTC</th>
              <th className="col-statut">Statut</th>
            </tr>
          </thead>
          <tbody>
            {paniers.map((p) => (
              <tr key={p.id} className="ligne-commande ligne-panier">
                <td className="col-id">
                  <span className="id-commande id-commande--panier">
                    #{p.id_customer}
                  </span>
                </td>
                <td className="col-client">
                  <div className="client-info">
                    <span className="client-nom">
                      {p.firstname || p.lastname
                        ? `${p.firstname} ${p.lastname}`.trim()
                        : <span className="texte-muted">—</span>}
                    </span>
                    {p.email && <span className="client-email">{p.email}</span>}
                  </div>
                </td>
                <td className="col-date">
                  {p.date_add
                    ? new Date(p.date_add).toLocaleDateString('fr-FR', {
                        day: '2-digit', month: '2-digit', year: 'numeric',
                      })
                    : '—'}
                </td>
                <td className="col-nb-art">
                  <span className="badge-nb-art">{p.nbArticles}</span>
                </td>
                {hasReductions && (
                  <td className="col-total">
                    <span className="montant montant--muted">{montantFR(p.sousTotal || p.montantTotal)}</span>
                  </td>
                )}
                {hasReductions && (
                  <td className="col-reduction">
                    {(p.totalReductions || 0) > 0 ? (
                      <span
                        className="badge-reduction"
                        title={(p.promos || []).map((pr) => `${pr.nom} : −${montantFR(pr.montant)}`).join(' | ')}
                      >
                        −{montantFR(p.totalReductions)}
                        {p.promos?.length > 0 && <span className="badge-reduction__hint"> ⓘ</span>}
                      </span>
                    ) : (
                      <span className="texte-muted">—</span>
                    )}
                  </td>
                )}
                <td className="col-total">
                  <span className="montant">{montantFR(p.montantTotal)}</span>
                </td>
                <td className="col-statut">
                  <BadgeStatut libelle={STATUT_PANIER_LABEL} />
                </td>
              </tr>
            ))}
          </tbody>
          {/* Sous-total */}
          <tfoot>
            <tr className="tfoot-panier">
              <td colSpan={3} className="tfoot-label">
                Sous-total — {paniers.length} panier{paniers.length > 1 ? 's' : ''}
              </td>
              <td className="col-nb-art tfoot-val">
                <strong>{totalArticles}</strong>
              </td>
              {hasReductions && (
                <td className="col-total tfoot-val">
                  <strong>{montantFR(paniers.reduce((s, p) => s + (p.sousTotal || p.montantTotal || 0), 0))}</strong>
                </td>
              )}
              {hasReductions && (
                <td className="col-reduction tfoot-val">
                  <strong className="montant-reduction-total">−{montantFR(totalReductions)}</strong>
                </td>
              )}
              <td className="col-total tfoot-val">
                <strong>{montantFR(totalMontant)}</strong>
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

// ─── Composant principal ──────────────────────────────────────

export const CommandesPage = () => {
  const [commandes,          setCommandes]          = useState([]);
  const [paniers,            setPaniers]            = useState([]);
  const [statuts,            setStatuts]            = useState([]);
  const [statutsModifiables, setStatutsModifiables] = useState([]);
  const [totalCommandes,     setTotalCommandes]     = useState(0);
  const [totalPaniers,       setTotalPaniers]       = useState(0);
  const [pages,              setPages]              = useState(1);
  const [pageActuelle,       setPageActuelle]       = useState(1);

  const [chargement,  setChargement]  = useState(true);
  const [erreur,      setErreur]      = useState(null);
  const [majEnCours,  setMajEnCours]  = useState({});
  const [toast,       setToast]       = useState({ visible: false, message: '', type: 'succes' });

  const [filtreStatut,    setFiltreStatut]    = useState('');
  const [filtreRecherche, setFiltreRecherche] = useState('');
  const [rechercheInput,  setRechercheInput]  = useState('');
  const rechercheTimeout = useRef(null);

  useEffect(() => {
    getStatutsCommande().then(setStatuts).catch(console.warn);
    getStatutsModifiables().then(setStatutsModifiables).catch(console.warn);
  }, []);

  const chargerDonnees = useCallback(async () => {
    setChargement(true);
    setErreur(null);
    try {
      const data = await getCommandes({
        page:      pageActuelle,
        limit:     LIMIT,
        statut:    filtreStatut,
        recherche: filtreRecherche,
      });
      setCommandes(data.commandes || []);
      setPaniers(data.paniers || []);
      setTotalCommandes(data.totalCommandes || 0);
      setTotalPaniers(data.totalPaniers || 0);
      setPages(data.pages || 1);
    } catch (err) {
      setErreur(err.message);
    } finally {
      setChargement(false);
    }
  }, [pageActuelle, filtreStatut, filtreRecherche]);

  useEffect(() => { chargerDonnees(); }, [chargerDonnees]);

  const handleRechercheChange = (e) => {
    const v = e.target.value;
    setRechercheInput(v);
    clearTimeout(rechercheTimeout.current);
    rechercheTimeout.current = setTimeout(() => {
      setFiltreRecherche(v);
      setPageActuelle(1);
    }, 300);
  };

  const handleStatutChange = async (commandeId, nouveauStatutId) => {
    setMajEnCours((prev) => ({ ...prev, [commandeId]: true }));
    try {
      await updateStatutCommande(commandeId, nouveauStatutId);
      setCommandes((prev) =>
        prev.map((c) => c.id === commandeId ? { ...c, current_state: nouveauStatutId } : c)
      );
      afficherToast('Statut mis à jour avec succès', 'succes');
    } catch (err) {
      afficherToast(`Erreur : ${err.message}`, 'erreur');
      chargerDonnees();
    } finally {
      setMajEnCours((prev) => ({ ...prev, [commandeId]: false }));
    }
  };

  const handleAction = async (commandeId, action) => {
    // On utilise la même map enCoursDeMaj pour désactiver les boutons
    setMajEnCours((prev) => ({ ...prev, [commandeId]: true }));
    try {
      const result = await updateOrderAction(commandeId, action);
 
      // Mettre à jour l'état localement sans recharger toute la page
      setCommandes((prev) =>
        prev.map((c) =>
          c.id === commandeId
            ? { ...c, current_state: String(result.current_state) }
            : c
        )
      );
 
      const label = ACTION_LABELS[action]?.label || action;
      afficherToast(`${label} appliqué avec succès`, 'succes');
    } catch (err) {
      afficherToast(`Erreur : ${err.message}`, 'erreur');
    } finally {
      setMajEnCours((prev) => ({ ...prev, [commandeId]: false }));
    }
  };

  const afficherToast = (message, type) => {
    setToast({ visible: true, message, type });
    setTimeout(() => setToast((t) => ({ ...t, visible: false })), 3000);
  };

  // Détermine quelles sections afficher selon le filtre statut
  const paniersSeulement    = filtreStatut === String(STATUT_PANIER_ID);
  const commandesSeulement  = filtreStatut !== '' && !paniersSeulement;
  const afficherCommandes   = !paniersSeulement;
  const afficherPaniers     = !commandesSeulement;

  return (
    <div className="commandes-page">

      {/* ── En-tête ─────────────────────────────────────── */}
      <div className="commandes-entete">
        <div className="commandes-entete__titre">
          <h2>Commandes &amp; Paniers</h2>
          {!chargement && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {afficherCommandes && (
                <span className="badge-total">
                  {totalCommandes} commande{totalCommandes > 1 ? 's' : ''}
                </span>
              )}
              {afficherPaniers && (
                <span className="badge-total badge-total--panier">
                  {totalPaniers} panier{totalPaniers > 1 ? 's' : ''}
                </span>
              )}
            </div>
          )}
        </div>
        <button className="btn-actualiser" onClick={chargerDonnees} disabled={chargement}>
          {chargement ? '…' : '↻'} Actualiser
        </button>
      </div>

      {/* ── Filtres ─────────────────────────────────────── */}
      <div className="commandes-filtres">
        <div className="filtre-groupe">
          <label htmlFor="recherche" className="filtre-label">Recherche</label>
          <input
            id="recherche"
            type="text"
            className="filtre-input"
            placeholder="Nom, prénom, référence, email…"
            value={rechercheInput}
            onChange={handleRechercheChange}
          />
        </div>
        <div className="filtre-groupe">
          <label htmlFor="filtreStatut" className="filtre-label">Afficher</label>
          <select
            id="filtreStatut"
            className="filtre-select"
            value={filtreStatut}
            onChange={(e) => { setFiltreStatut(e.target.value); setPageActuelle(1); }}
          >
            <option value="">Tout (commandes + paniers)</option>
            <optgroup label="Statuts commandes">
              {statuts.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </optgroup>
            <optgroup label="Paniers">
              <option value={STATUT_PANIER_ID}>{STATUT_PANIER_LABEL} uniquement</option>
            </optgroup>
          </select>
        </div>
      </div>

      {/* ── Chargement / Erreur ─────────────────────────── */}
      {chargement && (
        <div className="commandes-contenu">
          <div className="etat-chargement">
            <div className="spinner" />
            <p>Chargement des commandes et paniers…</p>
          </div>
        </div>
      )}

      {!chargement && erreur && (
        <div className="commandes-contenu">
          <div className="etat-erreur">
            <span className="etat-erreur__icone">⚠</span>
            <div>
              <strong>Impossible de charger les données</strong>
              <p>{erreur}</p>
              <button className="btn-reessayer" onClick={chargerDonnees}>Réessayer</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Section 1 : Commandes ───────────────────────── */}
      {!chargement && !erreur && afficherCommandes && (
        <>
          <div className="section-label">
            <span className="section-label__texte">Commandes</span>
            <b>  :  </b>
            <span className="section-label__count">{totalCommandes}</span>
          </div>
          <TableauCommandes
            commandes={commandes}
            statuts={statuts}
            statutsModifiables={statutsModifiables}
            onStatutChange={handleStatutChange}
            onAction={handleAction}
            majEnCours={majEnCours}
            pages={pages}
            pageActuelle={pageActuelle}
            onPage={setPageActuelle}
          />
        </>
      )}

      {/* ── Section 2 : Paniers ─────────────────────────── */}
      {!chargement && !erreur && afficherPaniers && (
        <>
          <div className="section-label section-label--panier">
            <span className="section-label__texte">Paniers abandonnés</span>
            <b>  :  </b>
            <span className="section-label__count section-label__count--panier">{totalPaniers}</span>
          </div>
          <TableauPaniers paniers={paniers} />
        </>
      )}

      <Toast message={toast.message} type={toast.type} visible={toast.visible} />
    </div>
  );
};

export default CommandesPage;