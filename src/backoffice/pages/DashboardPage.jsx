/**
 * DashboardPage.jsx
 * ─────────────────────────────────────────────────────────────
 * Tableau de bord backoffice PrestaShop.
 *
 * MODIFICATION v2 :
 *   - Les montants (jour et total général) ne comptent QUE les
 *     commandes avec statut "Paiement effectué" (ID 2).
 *   - Les commandes annulées ou "dans le panier" restent affichées
 *     dans le tableau détail, mais leur montant est exclu des totaux.
 *   - Le tableau détail affiche maintenant un indicateur visuel
 *     (texte barré / grisé) pour les montants non comptabilisés.
 * ─────────────────────────────────────────────────────────────
 */

import React, { useState, useEffect, useCallback } from 'react';
import { getCommandesParDate } from '../services/commandesService';
import './DashboardPage.css';

// ─── Constante : seul ce statut est comptabilisé dans les montants ──
/**
 * ID PrestaShop du statut "Paiement effectué".
 * Les commandes avec un autre statut sont affichées mais
 * leur montant n'est PAS inclus dans les totaux.
 */
const STATUT_PAIEMENT_EFFECTUE = 2;

// ─── Utilitaires ──────────────────────────────────────────────

function dateEnInput(d) {
  return d.toISOString().slice(0, 10);
}

function dateEnFR(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  });
}

function montantFR(v) {
  return Number(v || 0).toLocaleString('fr-FR', {
    style: 'currency', currency: 'EUR',
  });
}

/**
 * Retourne true si la commande est comptabilisée dans les montants.
 * Seul le statut "Paiement effectué" (ID 2) est pris en compte.
 */
function estComptabilisee(commande) {
  return Number(commande.current_state) === STATUT_PAIEMENT_EFFECTUE;
}

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

/**
 * Badge coloré selon l'ID de statut.
 */
function BadgeStatutId({ statutId, statutName }) {
  const MAP = {
    10: { label: 'Dans le panier',    classe: 'gris'  },
    2:  { label: 'Paiement effectué', classe: 'vert'  },
    6:  { label: 'Annulé',            classe: 'rouge' },
  };
  const info = MAP[statutId] || { label: statutName, classe: 'gris' };
  return <span className={`badge badge--${info.classe}`}>{info.label}</span>;
}

/**
 * Tableau des commandes du jour.
 * Toutes les commandes sont affichées.
 * Les montants des commandes NON payées sont barrés/grisés
 * pour indiquer qu'ils ne sont pas comptabilisés.
 */
function TableauCommandes({ commandes }) {
  if (!commandes.length) return null;

  // Sous-total : seulement les commandes payées
  const sousTotal = commandes
    .filter(estComptabilisee)
    .reduce((s, c) => s + (c.total_paid || 0), 0);

  return (
    <div className="tableau-jour">
      <h3 className="tableau-jour__titre">
        Détail des commandes
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
              const comptabilisee = estComptabilisee(c);
              return (
                <tr key={c.id} className={!comptabilisee ? 'ligne-non-comptabilisee' : ''}>
                  <td><span className="mono">#{c.id}</span></td>
                  <td><span className="mono">{c.reference || '—'}</span></td>
                  <td>{dateEnFR(c.date_add)}</td>
                  <td><BadgeStatutId statutId={Number(c.current_state)} statutName={c.current_state_name} /></td>
                  <td className="col-droite">
                    {comptabilisee ? (
                      // Montant normal : commande payée
                      <strong>{montantFR(c.total_paid)}</strong>
                    ) : (
                      // Montant barré : non comptabilisé
                      <span className="montant-exclu" title="Non comptabilisé (statut non payé)">
                        <s>{montantFR(c.total_paid)}</s>
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>

          {/* Sous-total : seulement les commandes payées */}
          <tfoot>
            <tr className="tfoot-total">
              <td colSpan={4}>
                Sous-total
                <span className="tfoot-mention"> (paiements effectués uniquement)</span>
              </td>
              <td className="col-droite">
                <strong>{montantFR(sousTotal)}</strong>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

// ─── Composant principal ──────────────────────────────────────

const DashboardPage = () => {
  const [dateSelectionnee, setDateSelectionnee] = useState(dateEnInput(new Date()));
  const [commandesJour,    setCommandesJour]    = useState([]);
  const [toutesCommandes,  setToutesCommandes]  = useState([]);
  const [chargement,       setChargement]       = useState(true);
  const [erreur,           setErreur]           = useState(null);

  const charger = useCallback(async () => {
    setChargement(true);
    setErreur(null);
    try {
      const [jour, toutes] = await Promise.all([
        getCommandesParDate(dateSelectionnee),
        getCommandesParDate(''),
      ]);
      setCommandesJour(jour);
      setToutesCommandes(toutes);
    } catch (err) {
      setErreur(err.message);
    } finally {
      setChargement(false);
    }
  }, [dateSelectionnee]);

  useEffect(() => { charger(); }, [charger]);

  // ── Calculs : seulement les commandes payées ─────────────
  // Toutes les commandes sont affichées, mais les montants
  // ne comptent que celles avec statut "Paiement effectué".

  const commandesJourPayees   = commandesJour.filter(estComptabilisee);
  const commandesToutesPayees = toutesCommandes.filter(estComptabilisee);

  // Nombre : toutes les commandes du jour (peu importe le statut)
  const nbJour = commandesJour.length;
  // Montant : seulement celles payées
  const montantJour = commandesJourPayees.reduce((s, c) => s + (c.total_paid || 0), 0);

  const nbTotal      = toutesCommandes.length;
  const montantTotal = commandesToutesPayees.reduce((s, c) => s + (c.total_paid || 0), 0);

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

      {/* ─── Chargement / Erreur ─────────────────────────── */}
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

      {/* ─── Contenu ─────────────────────────────────────── */}
      {!chargement && !erreur && (
        <>
          {/* Section : jour sélectionné */}
          <div className="section-titre">
            <span className="section-titre__ligne" />
            <span className="section-titre__texte">
              {dateSelectionnee === dateEnInput(new Date())
                ? "Aujourd'hui"
                : `Le ${dateEnFR(dateSelectionnee)}`}
            </span>
            <span className="section-titre__ligne" />
          </div>

          {/* Cartes du jour */}
          <div className="cartes-grille">
            <CarteStats
              icone=""
              libelle="Commandes"
              valeur={nbJour}
              // Précise combien sont effectivement payées
              sous={nbJour === 0
                ? 'Aucune commande ce jour'
                : `${commandesJourPayees.length} payée${commandesJourPayees.length > 1 ? 's' : ''} sur ${nbJour}`}
              couleur="bleu"
            />
            <CarteStats
              icone=""
              libelle="Montant du jour"
              valeur={montantFR(montantJour)}
              // Indique explicitement que ce total exclut les non-payés
              sous={commandesJourPayees.length > 0
                ? `Paiements effectués uniquement`
                : 'Aucun paiement effectué'}
              couleur="vert"
            />
          </div>

          {/* Tableau détail */}
          {commandesJour.length === 0 ? (
            <div className="etat-vide">
              <span className="etat-vide__icone">🗓</span>
              <p>Aucune commande pour le {dateEnFR(dateSelectionnee)}</p>
            </div>
          ) : (
            <TableauCommandes commandes={commandesJour} />
          )}

          {/* Section : total général */}
          <div className="section-titre" style={{ marginTop: '40px' }}>
            <span className="section-titre__ligne" />
            <span className="section-titre__texte">Total général</span>
            <span className="section-titre__ligne" />
          </div>

          <div className="cartes-grille">
            <CarteStats
              icone=""
              libelle="Toutes les commandes"
              valeur={nbTotal}
              sous={`${commandesToutesPayees.length} payée${commandesToutesPayees.length > 1 ? 's' : ''} sur ${nbTotal}`}
              couleur="neutre"
            />
            <CarteStats
              icone=""
              libelle="Chiffre d'affaires total"
              valeur={montantFR(montantTotal)}
              sous="Paiements effectués uniquement"
              couleur="or"
            />
          </div>
        </>
      )}
    </div>
  );
};

export default DashboardPage;