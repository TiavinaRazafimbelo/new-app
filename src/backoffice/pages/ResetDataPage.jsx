/**
 * Page Reset Data du Backoffice
 * Page pour réinitialiser les données
 */

import React, { useState } from 'react';
import './ResetDataPage.css';

export const ResetDataPage = () => {
  const [isConfirming, setIsConfirming] = useState(false);

  const handleReset = () => {
    if (window.confirm('Êtes-vous certain de vouloir réinitialiser toutes les données? Cette action est irréversible.')) {
      // Appel API pour réinitialiser les données
      console.log('Réinitialisation des données...');
      // À implémenter
    }
  };

  return (
    <div className="reset-page">
      <h2>Réinitialiser les données</h2>
      
      <div className="reset-content">
        <div className="reset-warning">
          <h3>Zone Dangereuse</h3>
          <p>
            Cette action réinitialisera <strong>toutes</strong> les données importées.
          </p>
          <p className="warning-text">
            Cette action <strong>ne peut pas être annulée</strong>.
          </p>
          
          <button 
            className="reset-button"
            onClick={handleReset}
          >
            Réinitialiser toutes les données
          </button>
        </div>
      </div>
    </div>
  );
};

export default ResetDataPage;
