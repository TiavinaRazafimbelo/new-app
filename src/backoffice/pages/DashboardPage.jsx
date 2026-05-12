/**
 * Page Dashboard du Backoffice
 * Page d'accueil du backoffice avec informations générales
 */

import React from 'react';
import './DashboardPage.css';

export const DashboardPage = () => {
  return (
    <div className="dashboard-page">
      <h2>Tableau de bord</h2>
      
      <div className="dashboard-grid">
        {/* Card Stats */}
        <div className="dashboard-card">
          <div className="card-icon">📦</div>
          <div className="card-content">
            <h3>Produits</h3>
            <p className="card-number">0</p>
            <p className="card-label">Produits en stock</p>
          </div>
        </div>

        <div className="dashboard-card">
          <div className="card-icon">🛒</div>
          <div className="card-content">
            <h3>Commandes</h3>
            <p className="card-number">0</p>
            <p className="card-label">Commandes totales</p>
          </div>
        </div>

        <div className="dashboard-card">
          <div className="card-icon">👥</div>
          <div className="card-content">
            <h3>Clients</h3>
            <p className="card-number">0</p>
            <p className="card-label">Clients enregistrés</p>
          </div>
        </div>

        <div className="dashboard-card">
          <div className="card-icon">💰</div>
          <div className="card-content">
            <h3>Chiffre d'affaires</h3>
            <p className="card-number">0€</p>
            <p className="card-label">Ventes totales</p>
          </div>
        </div>
      </div>

      {/* Placeholder pour contenu futur */}
      <div className="dashboard-section">
        <h3>Activité récente</h3>
        <p className="placeholder-text">
          📋 Aucune donnée pour l'instant. Cette section affichera bientôt l'historique des actions.
        </p>
      </div>
    </div>
  );
};

export default DashboardPage;
