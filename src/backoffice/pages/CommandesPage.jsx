/**
 * CommandesPage.jsx
 * ─────────────────────────────────────────────────────────────
 * Page principale de gestion des commandes PrestaShop.
 *
 * MODIFICATION v3 :
 *   - `statuts`           → TOUS les statuts PrestaShop (badges colonne "Statut actuel")
 *   - `statutsModifiables`→ Seulement les 3 autorisés (options du <select>)
 *
 * Les deux listes sont chargées séparément depuis le service.
 * ─────────────────────────────────────────────────────────────
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  getCommandes,
  getStatutsCommande,       // tous les statuts → badges
  getStatutsModifiables,    // 3 statuts → <select>
  updateStatutCommande,
} from '../services/commandesService';
import './CommandesPage.css';

const LIMIT = 20;

const STATUT_COULEURS = {
  'paiement accepté':         'vert',
  'en cours de préparation':  'bleu',
  'expédié':                  'bleu',
  'livré':                    'vert',
  'annulé':                   'rouge',
  'remboursé':                'orange',
  'erreur de paiement':       'rouge',
  'en attente':               'gris',
  'dans le panier':           'gris',
  'paiement effectué':        'vert',
};

function getCouleurStatut(libelle = '') {
  const key = libelle.toLowerCase();
  for (const [pattern, couleur] of Object.entries(STATUT_COULEURS)) {
    if (key.includes(pattern)) return couleur;
  }
  return 'gris';
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
  const couleur = getCouleurStatut(libelle);
  return (
    <span className={`badge badge--${couleur}`}>
      {libelle || '—'}
    </span>
  );
}

/**
 * LigneCommande
 *
 * @param {{
 *   commande: Object,
 *   statuts: Array,              ← tous les statuts (pour le badge)
 *   statutsModifiables: Array,   ← 3 statuts seulement (pour le <select>)
 *   onStatutChange: Function,
 *   enCoursDeMaj: boolean
 * }} props
 */
function LigneCommande({ commande, statuts, statutsModifiables, onStatutChange, enCoursDeMaj }) {
  const [statutSelectionne, setStatutSelectionne] = useState(
    commande.current_state?.toString() || ''
  );

  useEffect(() => {
    setStatutSelectionne(commande.current_state?.toString() || '');
  }, [commande.current_state]);

  const handleChange = (e) => {
    const nouveauStatutId = e.target.value;
    setStatutSelectionne(nouveauStatutId);
    onStatutChange(commande.id, nouveauStatutId);
  };

  // Badge : cherche dans TOUS les statuts pour afficher le vrai libellé
  const statutActuel = statuts.find(
    (s) => s.id?.toString() === commande.current_state?.toString()
  );

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
          <span className="client-nom">{commande.firstname} {commande.lastname}</span>
          {commande.email && <span className="client-email">{commande.email}</span>}
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
          {parseFloat(commande.total_paid || 0).toFixed(2)} €
        </span>
      </td>

      {/* Statut actuel : badge avec le vrai libellé PrestaShop */}
      <td className="col-statut">
        <BadgeStatut libelle={statutActuel?.name || '—'} />
      </td>

      {/* Modification : seulement les 3 statuts autorisés */}
      <td className="col-action">
        <div className="select-wrapper">
          <select
            value={statutSelectionne}
            onChange={handleChange}
            disabled={enCoursDeMaj}
            className="select-statut"
            aria-label={`Modifier le statut de la commande #${commande.id}`}
          >
            <option value="" disabled>Choisir un statut…</option>
            {statutsModifiables.map((s) => (
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

// ─── Composant principal ──────────────────────────────────────

export const CommandesPage = () => {
  const [commandes,          setCommandes]          = useState([]);
  const [statuts,            setStatuts]            = useState([]);      // tous
  const [statutsModifiables, setStatutsModifiables] = useState([]);      // 3 seulement
  const [total,              setTotal]              = useState(0);
  const [pages,              setPages]              = useState(1);
  const [pageActuelle,       setPageActuelle]       = useState(1);

  const [chargement,  setChargement]  = useState(true);
  const [erreur,      setErreur]      = useState(null);
  const [majEnCours,  setMajEnCours]  = useState({});
  const [toast,       setToast]       = useState({ visible: false, message: '', type: 'succes' });

  const [filtreStatut,     setFiltreStatut]     = useState('');
  const [filtreRecherche,  setFiltreRecherche]  = useState('');
  const [rechercheInput,   setRechercheInput]   = useState('');
  const rechercheTimeout = useRef(null);

  // Charger les deux listes de statuts au montage
  useEffect(() => {
    // Tous les statuts pour les badges
    getStatutsCommande()
      .then(setStatuts)
      .catch((err) => console.warn('Statuts non chargés :', err.message));

    // Les 3 statuts modifiables pour le <select>
    getStatutsModifiables()
      .then(setStatutsModifiables)
      .catch((err) => console.warn('Statuts modifiables non chargés :', err.message));
  }, []);

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

  const handleRechercheChange = (e) => {
    const valeur = e.target.value;
    setRechercheInput(valeur);
    clearTimeout(rechercheTimeout.current);
    rechercheTimeout.current = setTimeout(() => {
      setFiltreRecherche(valeur);
      setPageActuelle(1);
    }, 300);
  };

  const handleStatutChange = async (commandeId, nouveauStatutId) => {
    setMajEnCours((prev) => ({ ...prev, [commandeId]: true }));
    try {
      await updateStatutCommande(commandeId, nouveauStatutId);
      setCommandes((prev) =>
        prev.map((c) =>
          c.id === commandeId ? { ...c, current_state: nouveauStatutId } : c
        )
      );
      afficherToast('Statut mis à jour avec succès', 'succes');
    } catch (err) {
      afficherToast(`Erreur : ${err.message}`, 'erreur');
      chargerCommandes();
    } finally {
      setMajEnCours((prev) => ({ ...prev, [commandeId]: false }));
    }
  };

  const afficherToast = (message, type) => {
    setToast({ visible: true, message, type });
    setTimeout(() => setToast((t) => ({ ...t, visible: false })), 3000);
  };

  const allerPage = (page) => {
    if (page >= 1 && page <= pages) setPageActuelle(page);
  };

  return (
    <div className="commandes-page">
      <div className="commandes-entete">
        <div className="commandes-entete__titre">
          <h2>Commandes</h2>
          {!chargement && (
            <span className="badge-total">{total} commande{total > 1 ? 's' : ''}</span>
          )}
        </div>
        <button className="btn-actualiser" onClick={chargerCommandes} disabled={chargement}>
          {chargement ? '…' : '↻'} Actualiser
        </button>
      </div>

      <div className="commandes-filtres">
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
        <div className="filtre-groupe">
          <label htmlFor="filtreStatut" className="filtre-label">Statut</label>
          <select
            id="filtreStatut"
            className="filtre-select"
            value={filtreStatut}
            onChange={(e) => { setFiltreStatut(e.target.value); setPageActuelle(1); }}
          >
            <option value="">Tous les statuts</option>
            {/* Le filtre utilise tous les statuts aussi */}
            {statuts.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="commandes-contenu">
        {chargement && (
          <div className="etat-chargement">
            <div className="spinner" />
            <p>Chargement des commandes…</p>
          </div>
        )}

        {!chargement && erreur && (
          <div className="etat-erreur">
            <span className="etat-erreur__icone">⚠</span>
            <div>
              <strong>Impossible de charger les commandes</strong>
              <p>{erreur}</p>
              <button className="btn-reessayer" onClick={chargerCommandes}>Réessayer</button>
            </div>
          </div>
        )}

        {!chargement && !erreur && commandes.length === 0 && (
          <div className="etat-vide">
            <h3>Aucune commande trouvée</h3>
            <p>
              {filtreStatut || filtreRecherche
                ? 'Essayez de modifier vos filtres.'
                : "Les commandes PrestaShop s'afficheront ici."}
            </p>
          </div>
        )}

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
                      statuts={statuts}                        // tous → badge
                      statutsModifiables={statutsModifiables}  // 3 → select
                      onStatutChange={handleStatutChange}
                      enCoursDeMaj={!!majEnCours[commande.id]}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            {pages > 1 && (
              <div className="pagination">
                <button className="pagination__btn" onClick={() => allerPage(1)}           disabled={pageActuelle === 1}>«</button>
                <button className="pagination__btn" onClick={() => allerPage(pageActuelle - 1)} disabled={pageActuelle === 1}>‹</button>
                <span className="pagination__info">
                  Page <strong>{pageActuelle}</strong> sur <strong>{pages}</strong>
                </span>
                <button className="pagination__btn" onClick={() => allerPage(pageActuelle + 1)} disabled={pageActuelle === pages}>›</button>
                <button className="pagination__btn" onClick={() => allerPage(pages)}        disabled={pageActuelle === pages}>»</button>
              </div>
            )}
          </>
        )}
      </div>

      <Toast message={toast.message} type={toast.type} visible={toast.visible} />
    </div>
  );
};

export default CommandesPage;