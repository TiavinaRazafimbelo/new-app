/**
 * ClientCard.jsx
 * Carte client avec plus de détails
 */

import React from 'react';
import './ClientCard.css';

export const ClientCard = ({
  client,
  isSelected = false,
  onSelect,
  onConnect,
}) => {
  const { id, firstName, lastName, email, active, dateAdd, company } = client;
  const fullName = `${firstName} ${lastName}`;
  const initials = `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();

  // Formater la date
  const formattedDate = dateAdd 
    ? new Date(dateAdd).toLocaleDateString('fr-FR', { 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric' 
      })
    : '';

  return (
    <div
      className={`client-card ${isSelected ? 'client-card--selected' : ''}`}
      onClick={onSelect}
    >
      {/* Avatar avec initiales */}
      <div className="client-card__avatar">
        <span className="client-card__initials">{initials}</span>
        {active && <span className="client-card__badge-active" />}
      </div>

      {/* Informations principales */}
      <div className="client-card__main">
        <h3 className="client-card__name">{fullName}</h3>
        <p className="client-card__email">{email}</p>
        {company && <p className="client-card__company">{company}</p>}
      </div>

      {/* Infos secondaires */}
      <div className="client-card__meta">
        <span className="client-card__date">{formattedDate}</span>
        <span className={`client-card__status ${active ? 'active' : 'inactive'}`}>
          {active ? '●' : '○'}
        </span>
      </div>

      {/* Bouton de connexion */}
      <button
        className="client-card__btn"
        onClick={(e) => {
          e.stopPropagation();
          // Le password est déjà disponible dans 'client'
          onConnect('openLoginModal', client);
        }}
        title="Se connecter"
      >
        →
      </button>
    </div>
  );
};

export default ClientCard;