/**
 * ClientsPage.jsx
 * Page d'accueil avec sélection de client
 */

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getCustomers } from '../services/customersService';
import ClientCard from '../components/ClientCard';
import LoginModal from '../components/LoginModal';
import { useFrontofficeClient } from '../contexts/FrontofficeClientContext';
import './ClientsPage.css';

const ClientsPage = () => {
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedClient, setSelectedClient] = useState(null);
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const [loginModalClient, setLoginModalClient] = useState(null);

  const navigate = useNavigate();
  const { connect } = useFrontofficeClient();

  useEffect(() => {
    loadClients();
  }, []);

  const loadClients = async () => {
    try {
      setLoading(true);
      const data = await getCustomers();
      setClients(data);
    } catch (err) {
      setError('Erreur lors du chargement des clients');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  /**
   * Gère la connexion (modal de password)
   */
  const handleClientConnect = (arg1, arg2) => {
    // Mode modal : ouvrir le formulaire de password
    if (arg1 === 'openLoginModal' && arg2) {
      setLoginModalClient(arg2);
      setIsLoginModalOpen(true);
      return;
    }
  };

  /**
   * Callback du modal : client authentifié
   */
  const handleLoginSuccess = (authenticatedCustomer) => {
    setIsLoginModalOpen(false);
    connect(authenticatedCustomer);
    navigate('/products');
  };

  /**
   * Accès anonyme
   */
  const handleAnonymousAccess = () => {
    connect({ id: null, anonymous: true, loginTime: new Date().toISOString() });
    navigate('/products');
  };

  if (loading) {
    return (
      <div className="clients-page clients-page--loading">
        <div className="spinner" />
        <p>Chargement des clients...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="clients-page clients-page--error">
        <div className="error-box">
          <p className="error-message">{error}</p>
          <button onClick={loadClients} className="btn-retry">
            Réessayer
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="clients-page">
      <div className="clients-container">
        <div className="clients-header">
          <h1>Bienvenue</h1>
          <p className="subtitle">Sélectionnez un client ou continuez en anonyme</p>
        </div>

        <div className="clients-grid">
          {/* Cartes clients avec composant réutilisable */}
          {clients.length > 0 ? (
            clients.map((client) => (
              <ClientCard
                key={client.id}
                client={client}
                isSelected={selectedClient === client.id}
                onSelect={() => setSelectedClient(client.id)}
                onConnect={handleClientConnect}
              />
            ))
          ) : (
            <p className="no-clients">Aucun client disponible</p>
          )}

          {/* Carte Anonyme */}
          <div
            className={`client-card client-card--anonymous ${
              selectedClient === 'anonymous' ? 'client-card--selected' : ''
            }`}
            onClick={() => setSelectedClient('anonymous')}
          >
            <div className="client-card__avatar client-card__avatar--anonymous">
              <span className="client-card__initials">?</span>
            </div>
            <div className="client-card__content">
              <h3 className="client-card__name">Anonyme</h3>
              <p className="client-card__email">Visiteur non identifié</p>
            </div>
            <button
              className="client-card__btn client-card__btn--anonymous"
              onClick={(e) => {
                e.stopPropagation();
                handleAnonymousAccess();
              }}
            >
              →
            </button>
          </div>
        </div>

        <div className="clients-footer">
          <p className="info-text">
            🛒 Parcourez le catalogue avec l'identité sélectionnée
          </p>
        </div>
      </div>

      {/* Modal de connexion */}
      <LoginModal
        isOpen={isLoginModalOpen}
        onClose={() => {
          setIsLoginModalOpen(false);
          setLoginModalClient(null);
        }}
        client={loginModalClient}
        onLoginSuccess={handleLoginSuccess}
      />
    </div>
  );
};

export default ClientsPage;