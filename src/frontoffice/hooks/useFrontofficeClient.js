/**
 * useFrontofficeClient.js
 * ─────────────────────────────────────────────────────────────
 * Hook pour gérer la session client du frontoffice
 * Permet d'accéder au client connecté depuis n'importe quel composant
 * ─────────────────────────────────────────────────────────────
 * 
 * ⚠️ IMPORTANT : Préférer le contexte FrontofficeClientContext
 * ce fichier est gardé pour compatibilité
 */

import { useState, useEffect } from 'react';
import { getOrCreateAnonSessionId } from '../utils/anonSessionUtil';

/**
 * Hook pour récupérer le client actuellement connecté
 * @returns {Object} { client, isConnected, connect, logout, update }
 */
export const useFrontofficeClient = () => {
  const [client, setClient] = useState(null);
  const [isConnected, setIsConnected] = useState(false);

  // Charger la session au montage du composant
  useEffect(() => {
    const stored = sessionStorage.getItem('frontoffice_client');
    if (stored) {
      try {
        const clientData = JSON.parse(stored);
        setClient(clientData);
        setIsConnected(true);
      } catch (err) {
        console.error('Erreur parsing session client:', err);
        sessionStorage.removeItem('frontoffice_client');
        connectAnonymous();
      }
    } else {
      connectAnonymous();
    }
  }, []);

  /**
   * Connecter un client
   * @param {Object} clientData - Données du client
   */
  const connect = (clientData) => {
    sessionStorage.setItem('frontoffice_client', JSON.stringify(clientData));
    setClient(clientData);
    setIsConnected(true);
  };

  /**
   * Déconnecter le client
   */
const logout = () => {
  sessionStorage.removeItem('frontoffice_client');
  connectAnonymous();
};

  /**
   * Mettre à jour les infos du client
   */
  const update = (updates) => {
    const updated = { ...client, ...updates };
    sessionStorage.setItem('frontoffice_client', JSON.stringify(updated));
    setClient(updated);
  };


  const connectAnonymous = () => {
    const anonSessionId = getOrCreateAnonSessionId();
    const anonymousClient = {
      anonymous: true,
      authenticated: false,
      anonSessionId, // UUID unique et persistant
      loginTime: new Date().toISOString(),
    };

    sessionStorage.setItem(
      'frontoffice_client',
      JSON.stringify(anonymousClient)
    );

    setClient(anonymousClient);
    setIsConnected(true);
  };


  return {
    client,
    isConnected,
    connect,
    logout,
    update,
    connectAnonymous
  };
};

export default useFrontofficeClient;
