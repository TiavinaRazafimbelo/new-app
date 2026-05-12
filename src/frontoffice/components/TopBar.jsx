import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useFrontofficeClient } from '../hooks/useFrontofficeClient';
import './TopBar.css';

const TopBar = () => {
  const { client, isConnected, logout } = useFrontofficeClient();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout(); // Utiliser la méthode du hook
    navigate('/'); // Rediriger vers la page d'accueil (ClientsPage)
  };

  return (
    <header className="topbar">
      <div className="topbar-left">
        <span className="topbar-logo"><h1>Frontoffice new app</h1></span>
      </div>

      <div className="topbar-right">
        {/* Bouton panier */}
        <Link to="/cart" className="cart-button">
          <span className="cart-icon">🛒</span>
          <span className="cart-label">Mon panier</span>
        </Link>

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