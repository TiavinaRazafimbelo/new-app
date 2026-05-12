/**
 * Page Import du Backoffice
 * Page pour importer les données depuis PrestaShop
 */

import React from 'react';
import './ImportPage.css';

export const ImportPage = () => {
  return (
    <div className="import-page">
      <h2>Import de données</h2>
      
      <div className="import-content">
        <div className="empty-state">
          <h3>Fonctionnalité en développement</h3>
          <p>
            Cette page permettra d'importer les données depuis PrestaShop.
          </p>
        </div>
      </div>
    </div>
  );
};

export default ImportPage;
