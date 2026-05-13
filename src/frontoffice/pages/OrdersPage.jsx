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
import { getCustomerOrders, getOrderStates } from '../services/orderService';
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

function CarteCommande({ order, states, defaultExpanded }) {
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
        </div>
      )}
    </div>
  );
}

// ─── Composant principal ──────────────────────────────────────

const OrdersPage = () => {
  const navigate = useNavigate();
  const { client } = useFrontofficeClient();

  const [orders,   setOrders]   = useState([]);
  const [states,   setStates]   = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [erreur,   setErreur]   = useState(null);

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
              />
            ))}
          </div>
        )}

        {/* Retour */}
        <div className="orders-footer">
          <Link to="/products" className="btn-secondary">← Continuer mes achats</Link>
        </div>

      </div>
    </>
  );
};

export default OrdersPage;