import React from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useFrontofficeClient } from '../contexts/FrontofficeClientContext';
import './TopBar.css';

const TopBar = () => {
  const { client, isConnected, logout } = useFrontofficeClient();
  const navigate = useNavigate();
  const location = useLocation(); // Récupère la route actuelle

  const handleLogout = () => {
    logout(); // Utiliser la méthode du hook
    navigate('/'); // Rediriger vers la page d'accueil (ClientsPage)
  };

  // Masquer le bouton panier si on est déjà sur /cart
  const isCartPage = location.pathname === '/cart';

  return (
    <header className="topbar">
      <div className="topbar-left">
        <span className="topbar-logo"><h1>Frontoffice new app</h1></span>
      </div>

      <div className="topbar-right">
        {/* Bouton panier - masqué sur /cart */}
        {!isCartPage && (
          <Link to="/cart" className="cart-button">
            <span className="cart-icon">🛒</span>
            <span className="cart-label">Mon panier</span>
          </Link>
        )}

        {/* État de connexion */}
        <div className="auth-status">
          {isConnected ? (
            <>
              <span className="user-info">
                {client.anonymous ? (
                  <>Navigation en tant qu'<strong>Anonyme</strong></>
                ) : (
                  <>Connecté en tant que <strong>{client.firstName} {client.lastName}</strong></>
                )}
              </span>
              {/* Si anonyme : afficher les deux boutons (Se connecter + Déconnexion) */}
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