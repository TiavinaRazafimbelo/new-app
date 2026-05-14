/**
 * TopBar.jsx
 * ─────────────────────────────────────────────────────────────
 * Barre de navigation du frontoffice.
 *
 * MODIFICATION :
 *   - Ajout du lien "Mes commandes" visible uniquement si le client
 *     est authentifié (pas anonyme).
 *   - Lien actif mis en surbrillance selon la route courante.
 * ─────────────────────────────────────────────────────────────
 */

import React from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useFrontofficeClient } from '../contexts/FrontofficeClientContext';
import { useCartContext } from '../contexts/CartContext';
import './TopBar.css';

const TopBar = () => {
  const { client, isConnected, logout } = useFrontofficeClient();
  const { cartCount: nbArticles } = useCartContext();
  const navigate  = useNavigate();
  const location  = useLocation();

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  const isCartPage   = location.pathname === '/cart';
  const isOrdersPage = location.pathname === '/orders';

  // Un client est "authentifié" s'il n'est pas anonyme et a un ID réel
  const estAuthentifie = isConnected && client && !client.anonymous && client.id;

  return (
    <header className="topbar">
      <div className="topbar-left">
        <Link to="/products" className="topbar-logo">
          <h1>Frontoffice new app</h1>
        </Link>
      </div>

      <div className="topbar-right">

        {/* ── Mes commandes (uniquement si authentifié) ────── */}
        {estAuthentifie && (
          <Link
            to="/orders"
            className={`nav-link-topbar ${isOrdersPage ? 'nav-link-topbar--active' : ''}`}
          >
            <span>📋</span>
            <span>Mes commandes</span>
          </Link>
        )}

        {/* ── Panier (masqué sur /cart) ─────────────────────── */}
        {!isCartPage && (
          <Link to="/cart" className="cart-button">
            <span className="cart-icon">🛒</span>
            <span className="cart-label">Mon panier</span>
            {/* Badge nombre d'articles */}
            {nbArticles > 0 && (
              <span className="cart-badge">{nbArticles}</span>
            )}
          </Link>
        )}

        {/* ── Infos client + actions ────────────────────────── */}
        <div className="auth-status">
          {isConnected ? (
            <>
              <span className="user-info">
                {client.anonymous ? (
                  <>Navigation en tant qu'<strong>Anonyme</strong></>
                ) : (
                  <>
                    <strong>{client.firstName} {client.lastName}</strong>
                  </>
                )}
              </span>

              {/* Bouton "Se connecter" si anonyme */}
              {client.anonymous && (
                <Link to="/clients" className="btn-login">
                  Se connecter
                </Link>
              )}

              <button className="btn-logout" onClick={handleLogout}>
                Déconnexion
              </button>
            </>
          ) : (
            <Link to="/" className="btn-login">
              Se connecter
            </Link>
          )}
        </div>

      </div>
    </header>
  );
};

export default TopBar;