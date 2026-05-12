/**
 * CommandesPage.jsx
 * ─────────────────────────────────────────────────────────────
 * Page principale de gestion des commandes PrestaShop.
 *
 * FONCTIONNALITÉS :
 *   - Tableau paginé des commandes (ID, client, date, total, statut)
 *   - Filtre par statut de paiement
 *   - Recherche par nom de client ou référence
 *   - Modification inline de l'état de paiement via liste déroulante
 *   - Indicateur de chargement et gestion des erreurs
 *   - Feedback visuel (toast) après chaque modification
 *
 * DÉPENDANCES :
 *   - commandesService.js (appels API backend)
 * ─────────────────────────────────────────────────────────────
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  getCommandes,
  getStatutsCommande,
  updateStatutCommande,
} from '../services/commandesService';
import './CommandesPage.css';

// ─── CONSTANTES ───────────────────────────────────────────────

/** Nombre de commandes affichées par page */
const LIMIT = 20;

/**
 * Couleur associée à chaque catégorie de statut PrestaShop.
 * Utilisé pour coloriser les badges de statut dans le tableau.
 * On mappe par nom (insensible à la casse) car les IDs peuvent
 * différer selon l'installation PrestaShop.
 */
const STATUT_COULEURS = {
  'paiement accepté':         'vert',
  'en cours de préparation':  'bleu',
  'expédié':                  'bleu',
  'livré':                    'vert',
  'annulé':                   'rouge',
  'remboursé':                'orange',
  'erreur de paiement':       'rouge',
  'en attente':               'gris',
};

/**
 * Retourne la classe CSS de couleur pour un libellé de statut.
 * @param {string} libelle
 * @returns {string} classe CSS
 */
function getCouleurStatut(libelle = '') {
  const key = libelle.toLowerCase();
  for (const [pattern, couleur] of Object.entries(STATUT_COULEURS)) {
    if (key.includes(pattern)) return couleur;
  }
  return 'gris';
}

// ─── COMPOSANT TOAST ──────────────────────────────────────────

/**
 * Toast — notification temporaire en bas de page.
 * @param {{ message: string, type: 'succes'|'erreur', visible: boolean }} props
 */
function Toast({ message, type, visible }) {
  return (
    <div className={`toast toast--${type} ${visible ? 'toast--visible' : ''}`}>
      <span className="toast__icone">{type === 'succes' ? '✓' : '✕'}</span>
      {message}
    </div>
  );
}

// ─── COMPOSANT BADGE STATUT ───────────────────────────────────

/**
 * Badge coloré pour afficher le statut d'une commande.
 * @param {{ libelle: string }} props
 */
function BadgeStatut({ libelle }) {
  const couleur = getCouleurStatut(libelle);
  return (
    <span className={`badge badge--${couleur}`}>
      {libelle || '—'}
    </span>
  );
}

// ─── COMPOSANT LIGNE COMMANDE ─────────────────────────────────

/**
 * Ligne du tableau représentant une commande.
 * Permet la modification inline du statut via un <select>.
 *
 * @param {{
 *   commande: Object,
 *   statuts: Array,
 *   onStatutChange: Function,
 *   enCoursDeMaj: boolean
 * }} props
 */
function LigneCommande({ commande, statuts, onStatutChange, enCoursDeMaj }) {
  const [statutSelectionne, setStatutSelectionne] = useState(
    commande.current_state?.toString() || ''
  );

  // Synchronise si le parent met à jour la commande (après rafraîchissement)
  useEffect(() => {
    setStatutSelectionne(commande.current_state?.toString() || '');
  }, [commande.current_state]);

  const handleChange = (e) => {
    const nouveauStatutId = e.target.value;
    setStatutSelectionne(nouveauStatutId);
    onStatutChange(commande.id, nouveauStatutId);
  };

  // Libellé du statut actuel pour le badge
  const statutActuel = statuts.find(
    (s) => s.id?.toString() === commande.current_state?.toString()
  );

  return (
    <tr className={`ligne-commande ${enCoursDeMaj ? 'ligne-commande--maj' : ''}`}>
      {/* ID Commande */}
      <td className="col-id">
        <span className="id-commande">#{commande.id}</span>
      </td>

      {/* Référence */}
      <td className="col-ref">
        <span className="ref">{commande.reference || '—'}</span>
      </td>

      {/* Client */}
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

      {/* Date */}
      <td className="col-date">
        {commande.date_add
          ? new Date(commande.date_add).toLocaleDateString('fr-FR', {
              day: '2-digit',
              month: '2-digit',
              year: 'numeric',
            })
          : '—'}
      </td>

      {/* Total */}
      <td className="col-total">
        <span className="montant">
          {parseFloat(commande.total_paid || 0).toFixed(2)} €
        </span>
      </td>

      {/* Statut actuel (badge) */}
      <td className="col-statut">
        <BadgeStatut libelle={statutActuel?.name || commande.statut_libelle || '—'} />
      </td>

      {/* Modification du statut */}
      <td className="col-action">
        <div className="select-wrapper">
          <select
            value={statutSelectionne}
            onChange={handleChange}
            disabled={enCoursDeMaj}
            className="select-statut"
            aria-label={`Modifier le statut de la commande #${commande.id}`}
          >
            <option value="" disabled>
              Choisir un statut…
            </option>
            {statuts.map((s) => (
              <option key={s.id} value={s.id.toString()}>
                {s.name}
              </option>
            ))}
          </select>
          {enCoursDeMaj && <span className="spinner-inline" />}
        </div>
      </td>
    </tr>
  );
}

// ─── COMPOSANT PRINCIPAL ──────────────────────────────────────

/**
 * CommandesPage
 * Page de gestion des commandes PrestaShop dans le backoffice.
 */
export const CommandesPage = () => {
  // ── États principaux ──────────────────────────────────────
  const [commandes,     setCommandes]     = useState([]);
  const [statuts,       setStatuts]       = useState([]);
  const [total,         setTotal]         = useState(0);
  const [pages,         setPages]         = useState(1);
  const [pageActuelle,  setPageActuelle]  = useState(1);

  // ── États UI ──────────────────────────────────────────────
  const [chargement,    setChargement]    = useState(true);
  const [erreur,        setErreur]        = useState(null);
  const [majEnCours,    setMajEnCours]    = useState({}); // { [commandeId]: bool }
  const [toast,         setToast]         = useState({ visible: false, message: '', type: 'succes' });

  // ── États filtres ─────────────────────────────────────────
  const [filtreStatut,   setFiltreStatut]   = useState('');
  const [filtreRecherche, setFiltreRecherche] = useState('');
  const [rechercheInput,  setRechercheInput]  = useState('');

  // Délai pour la recherche (évite d'appeler l'API à chaque frappe)
  const rechercheTimeout = useRef(null);

  // ── Chargement des statuts (une seule fois) ────────────────
  useEffect(() => {
    getStatutsCommande()
      .then(setStatuts)
      .catch((err) => console.warn('Statuts non chargés :', err.message));
  }, []);

  // ── Chargement des commandes (à chaque changement de filtre/page) ──
  const chargerCommandes = useCallback(async () => {
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
      setTotal(data.total || 0);
      setPages(data.pages || 1);
    } catch (err) {
      setErreur(err.message);
    } finally {
      setChargement(false);
    }
  }, [pageActuelle, filtreStatut, filtreRecherche]);

  useEffect(() => {
    chargerCommandes();
  }, [chargerCommandes]);

  // ── Recherche avec délai (300ms) ───────────────────────────
  const handleRechercheChange = (e) => {
    const valeur = e.target.value;
    setRechercheInput(valeur);
    clearTimeout(rechercheTimeout.current);
    rechercheTimeout.current = setTimeout(() => {
      setFiltreRecherche(valeur);
      setPageActuelle(1);
    }, 300);
  };

  // ── Modification du statut d'une commande ─────────────────
  const handleStatutChange = async (commandeId, nouveauStatutId) => {
    // Marquer cette commande comme "en cours de mise à jour"
    setMajEnCours((prev) => ({ ...prev, [commandeId]: true }));
    try {
      await updateStatutCommande(commandeId, nouveauStatutId);

      // Mettre à jour localement sans recharger toute la liste
      setCommandes((prev) =>
        prev.map((c) =>
          c.id === commandeId
            ? { ...c, current_state: nouveauStatutId }
            : c
        )
      );

      afficherToast('Statut mis à jour avec succès', 'succes');
    } catch (err) {
      afficherToast(`Erreur : ${err.message}`, 'erreur');
      // Recharger pour annuler la modification locale
      chargerCommandes();
    } finally {
      setMajEnCours((prev) => ({ ...prev, [commandeId]: false }));
    }
  };

  // ── Affichage d'un toast temporaire (3s) ──────────────────
  const afficherToast = (message, type) => {
    setToast({ visible: true, message, type });
    setTimeout(() => setToast((t) => ({ ...t, visible: false })), 3000);
  };

  // ── Pagination ────────────────────────────────────────────
  const allerPage = (page) => {
    if (page >= 1 && page <= pages) setPageActuelle(page);
  };

  // ── Rendu ─────────────────────────────────────────────────
  return (
    <div className="commandes-page">

      {/* ─── En-tête ─────────────────────────────────────── */}
      <div className="commandes-entete">
        <div className="commandes-entete__titre">
          <h2>Commandes</h2>
          {!chargement && (
            <span className="badge-total">{total} commande{total > 1 ? 's' : ''}</span>
          )}
        </div>
        <button
          className="btn-actualiser"
          onClick={chargerCommandes}
          disabled={chargement}
          title="Actualiser la liste"
        >
          {chargement ? '…' : '↻'} Actualiser
        </button>
      </div>

      {/* ─── Filtres ──────────────────────────────────────── */}
      <div className="commandes-filtres">
        {/* Recherche */}
        <div className="filtre-groupe">
          <label htmlFor="recherche" className="filtre-label">Recherche</label>
          <input
            id="recherche"
            type="text"
            className="filtre-input"
            placeholder="Nom, prénom, référence…"
            value={rechercheInput}
            onChange={handleRechercheChange}
          />
        </div>

        {/* Filtre statut */}
        <div className="filtre-groupe">
          <label htmlFor="filtreStatut" className="filtre-label">Statut</label>
          <select
            id="filtreStatut"
            className="filtre-select"
            value={filtreStatut}
            onChange={(e) => {
              setFiltreStatut(e.target.value);
              setPageActuelle(1);
            }}
          >
            <option value="">Tous les statuts</option>
            {statuts.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* ─── Contenu principal ────────────────────────────── */}
      <div className="commandes-contenu">

        {/* État : chargement */}
        {chargement && (
          <div className="etat-chargement">
            <div className="spinner" />
            <p>Chargement des commandes…</p>
          </div>
        )}

        {/* État : erreur */}
        {!chargement && erreur && (
          <div className="etat-erreur">
            <span className="etat-erreur__icone">⚠</span>
            <div>
              <strong>Impossible de charger les commandes</strong>
              <p>{erreur}</p>
              <button className="btn-reessayer" onClick={chargerCommandes}>
                Réessayer
              </button>
            </div>
          </div>
        )}

        {/* État : liste vide */}
        {!chargement && !erreur && commandes.length === 0 && (
          <div className="etat-vide">
            <h3>Aucune commande trouvée</h3>
            <p>
              {filtreStatut || filtreRecherche
                ? 'Essayez de modifier vos filtres.'
                : 'Les commandes importées depuis PrestaShop s\'afficheront ici.'}
            </p>
          </div>
        )}

        {/* Tableau des commandes */}
        {!chargement && !erreur && commandes.length > 0 && (
          <>
            <div className="tableau-wrapper">
              <table className="tableau-commandes">
                <thead>
                  <tr>
                    <th className="col-id">ID</th>
                    <th className="col-ref">Référence</th>
                    <th className="col-client">Client</th>
                    <th className="col-date">Date</th>
                    <th className="col-total">Total</th>
                    <th className="col-statut">Statut actuel</th>
                    <th className="col-action">Modifier le statut</th>
                  </tr>
                </thead>
                <tbody>
                  {commandes.map((commande) => (
                    <LigneCommande
                      key={commande.id}
                      commande={commande}
                      statuts={statuts}
                      onStatutChange={handleStatutChange}
                      enCoursDeMaj={!!majEnCours[commande.id]}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {pages > 1 && (
              <div className="pagination">
                <button
                  className="pagination__btn"
                  onClick={() => allerPage(1)}
                  disabled={pageActuelle === 1}
                  title="Première page"
                >
                  «
                </button>
                <button
                  className="pagination__btn"
                  onClick={() => allerPage(pageActuelle - 1)}
                  disabled={pageActuelle === 1}
                  title="Page précédente"
                >
                  ‹
                </button>

                <span className="pagination__info">
                  Page <strong>{pageActuelle}</strong> sur <strong>{pages}</strong>
                </span>

                <button
                  className="pagination__btn"
                  onClick={() => allerPage(pageActuelle + 1)}
                  disabled={pageActuelle === pages}
                  title="Page suivante"
                >
                  ›
                </button>
                <button
                  className="pagination__btn"
                  onClick={() => allerPage(pages)}
                  disabled={pageActuelle === pages}
                  title="Dernière page"
                >
                  »
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* ─── Toast notification ───────────────────────────── */}
      <Toast
        message={toast.message}
        type={toast.type}
        visible={toast.visible}
      />
    </div>
  );
};

export default CommandesPage;