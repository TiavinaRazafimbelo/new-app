/**
 * OrdersPage.jsx
 * ─────────────────────────────────────────────────────────────
 * Page de suivi des commandes du client connecté.
 *
 * AFFICHE :
 *   - Liste de toutes les commandes du client
 *   - Pour chaque commande : numéro, date, montant, état, détail articles
 *   - Badge coloré selon l'état PrestaShop
 *
 * ROUTE : /orders
 * ─────────────────────────────────────────────────────────────
 */

import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useFrontofficeClient } from '../contexts/FrontofficeClientContext';
import { getCustomerOrders, getOrderStates, duplicateOrder } from '../services/orderService';
import TopBar from '../components/TopBar';
import './OrdersPage.css';

// ─── Badge état commande ──────────────────────────────────────

function BadgeEtat({ stateId, states }) {
  const state = states.find((s) => s.id === stateId);
  if (!state) return <span className="badge-etat">État #{stateId}</span>;

  return (
    <span
      className="badge-etat"
      style={{
        backgroundColor: state.color + '22', // Couleur légère en fond
        color:            state.color,
        borderColor:      state.color + '55',
      }}
    >
      {state.name}
    </span>
  );
}

// ─── Carte commande ───────────────────────────────────────────

function CarteCommande({ order, states, defaultExpanded, onDuplicate }) {
  const [expanded, setExpanded] = useState(defaultExpanded || false);

  return (
    <div className="carte-commande">
      {/* En-tête */}
      <div className="carte-commande__header" onClick={() => setExpanded((v) => !v)}>
        <div className="carte-commande__infos">
          <span className="carte-commande__ref">
            Commande #{order.id}
            {order.reference && <> — <em>{order.reference}</em></>}
          </span>
          <span className="carte-commande__date">
            {order.date_add
              ? new Date(order.date_add).toLocaleDateString('fr-FR', {
                  day: '2-digit', month: 'long', year: 'numeric',
                })
              : '—'}
          </span>
        </div>

        <div className="carte-commande__droite">
          <BadgeEtat stateId={order.current_state} states={states} />
          <span className="carte-commande__total">
            {order.total_paid.toFixed(2)} €
          </span>
          <span className="carte-commande__chevron">{expanded ? '▲' : '▼'}</span>
        </div>
      </div>

      {/* Détail articles */}
      {expanded && (
        <div className="carte-commande__detail">
          {order.rows && order.rows.length > 0 ? (
            <table className="order-rows-table">
              <thead>
                <tr>
                  <th>Produit</th>
                  <th>Qté</th>
                  <th>Prix unit.</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {order.rows.map((row, i) => (
                  <tr key={i}>
                    <td>{row.productName || `Produit #${row.productId}`}</td>
                    <td>{row.quantity}</td>
                    <td>{row.unitPrice.toFixed(2)} €</td>
                    <td><strong>{row.totalPrice.toFixed(2)} €</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="no-rows">Détail des articles non disponible.</p>
          )}

          <div className="order-total-line">
            <span>Total payé</span>
            <strong>{order.total_paid.toFixed(2)} €</strong>
          </div>

          <div className="order-paiement">
            Mode de paiement : <strong>{order.payment || '—'}</strong>
          </div>

          {/* Bouton dupliquer */}
          <div className="order-actions">
            <button
              className="btn-duplicate"
              onClick={() => onDuplicate(order)}
              title="Dupliquer cette commande"
            >
               Dupliquer
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Composant principal ──────────────────────────────────────

const OrdersPage = () => {
  const navigate = useNavigate();
  const { client } = useFrontofficeClient();

  const [orders,              setOrders]              = useState([]);
  const [states,              setStates]              = useState([]);
  const [loading,             setLoading]             = useState(true);
  const [erreur,              setErreur]              = useState(null);
  const [showDuplicateModal,  setShowDuplicateModal]  = useState(false);
  const [selectedOrder,       setSelectedOrder]       = useState(null);
  const [duplicateCount,      setDuplicateCount]      = useState(1);
  const [duplicating,         setDuplicating]         = useState(false);
  const [duplicateError,      setDuplicateError]      = useState(null);
  const [duplicateSuccess,    setDuplicateSuccess]    = useState(false);

  // Garde : client non connecté → login
  useEffect(() => {
    if (client && client.anonymous) {
      navigate('/clients', { state: { from: '/orders' } });
    }
  }, [client, navigate]);

  // Chargement des données
  useEffect(() => {
    if (!client || client.anonymous || !client.id) return;

    setLoading(true);

    Promise.all([
      getCustomerOrders(client.id),
      getOrderStates(),
    ])
      .then(([ordersData, statesData]) => {
        setOrders(ordersData);
        setStates(statesData);
      })
      .catch((err) => {
        console.error('[OrdersPage]', err);
        setErreur(err.message || 'Erreur lors du chargement des commandes.');
      })
      .finally(() => setLoading(false));
  }, [client]);

  // ── Fonctions duplication ──────────────────────────────────

  const handleOpenDuplicateModal = (order) => {
    setSelectedOrder(order);
    setDuplicateCount(1);
    setDuplicateError(null);
    setDuplicateSuccess(false);
    setShowDuplicateModal(true);
  };

  const handleCloseDuplicateModal = () => {
    setShowDuplicateModal(false);
    setSelectedOrder(null);
    setDuplicateCount(1);
    setDuplicateError(null);
    setDuplicateSuccess(false);
  };

  const handleExecuteDuplicate = async () => {
    if (!selectedOrder || !client) return;

    setDuplicating(true);
    setDuplicateError(null);
    setDuplicateSuccess(false);

    try {
      const result = await duplicateOrder(
        selectedOrder,
        client.id,
        duplicateCount
      );
      
      console.log('[OrdersPage] Commande dupliquée :', result);
      setDuplicateSuccess(true);
      
      // Fermer le modal après 2 secondes et recharger les commandes
      setTimeout(() => {
        handleCloseDuplicateModal();
        // Recharger la liste des commandes
        getCustomerOrders(client.id).then((ordersData) => {
          setOrders(ordersData);
        });
      }, 2000);
    } catch (err) {
      console.error('[handleExecuteDuplicate]', err);
      setDuplicateError(err.message || 'Erreur lors de la duplication');
    } finally {
      setDuplicating(false);
    }
  };

  // ── Rendu ──────────────────────────────────────────────────

  return (
    <>
      <TopBar />
      <div className="orders-page">

        {/* Fil d'Ariane */}
        <nav className="orders-breadcrumb">
          <Link to="/products">Produits</Link>
          <span>›</span>
          <span>Mes commandes</span>
        </nav>

        <h1 className="orders-title">Mes commandes</h1>

        {/* Chargement */}
        {loading && (
          <div className="orders-loading">
            <div className="spinner" />
            <p>Chargement de vos commandes…</p>
          </div>
        )}

        {/* Erreur */}
        {!loading && erreur && (
          <div className="orders-erreur">
            <span>⚠</span> {erreur}
          </div>
        )}

        {/* Aucune commande */}
        {!loading && !erreur && orders.length === 0 && (
          <div className="orders-empty">
            <p>Vous n'avez pas encore passé de commande.</p>
            <Link to="/products" className="btn-primary">
              Découvrir nos produits
            </Link>
          </div>
        )}

        {/* Liste des commandes */}
        {!loading && !erreur && orders.length > 0 && (
          <div className="orders-list">
            <p className="orders-count">
              {orders.length} commande{orders.length > 1 ? 's' : ''} trouvée{orders.length > 1 ? 's' : ''}
            </p>

            {orders.map((order, i) => (
              <CarteCommande
                key={order.id}
                order={order}
                states={states}
                defaultExpanded={i === 0} // Première commande ouverte par défaut
                onDuplicate={handleOpenDuplicateModal}
              />
            ))}
          </div>
        )}

        {/* Retour */}
        <div className="orders-footer">
          <Link to="/products" className="btn-secondary">← Continuer mes achats</Link>
        </div>

      </div>

      {/* Modal Duplication */}
      {showDuplicateModal && (
        <div className="modal-overlay" onClick={handleCloseDuplicateModal}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Dupliquer la commande #{selectedOrder?.id}</h2>
              <button className="modal-close" onClick={handleCloseDuplicateModal}>✕</button>
            </div>

            <div className="modal-body">
              {duplicateSuccess ? (
                <div className="modal-success">
                  <div className="success-icon">✓</div>
                  <p>Commande dupliquée avec succès !</p>
                </div>
              ) : (
                <>
                  <p className="modal-description">
                    Combien de fois voulez-vous dupliquer cette commande ?
                  </p>

                  {selectedOrder?.rows && (
                    <div className="duplicate-preview">
                      <p className="preview-title">Aperçu des articles :</p>
                      <ul className="preview-list">
                        {selectedOrder.rows.map((row, i) => (
                          <li key={i}>
                            <span>{row.productName}</span>
                            <span className="preview-qty">
                              {row.quantity} × {duplicateCount} = {row.quantity * duplicateCount}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="modal-input-group">
                    <label htmlFor="duplicateCount">Nombre de duplication :</label>
                    <div className="input-spinner">
                      <button
                        className="spinner-btn"
                        onClick={() => setDuplicateCount(Math.max(1, duplicateCount - 1))}
                        disabled={duplicating}
                      >
                        −
                      </button>
                      <input
                        id="duplicateCount"
                        type="number"
                        min="1"
                        max="10"
                        value={duplicateCount}
                        onChange={(e) => {
                          const val = Math.max(1, Math.min(10, Number(e.target.value) || 1));
                          setDuplicateCount(val);
                        }}
                        disabled={duplicating}
                      />
                      <button
                        className="spinner-btn"
                        onClick={() => setDuplicateCount(Math.min(10, duplicateCount + 1))}
                        disabled={duplicating}
                      >
                        +
                      </button>
                    </div>
                  </div>

                  {duplicateError && (
                    <div className="modal-error">
                      <span>⚠</span> {duplicateError}
                    </div>
                  )}
                </>
              )}
            </div>

            {!duplicateSuccess && (
              <div className="modal-footer">
                <button
                  className="btn-secondary"
                  onClick={handleCloseDuplicateModal}
                  disabled={duplicating}
                >
                  Annuler
                </button>
                <button
                  className="btn-primary"
                  onClick={handleExecuteDuplicate}
                  disabled={duplicating}
                >
                  {duplicating ? 'Duplication en cours...' : 'Dupliquer'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
};

export default OrdersPage;