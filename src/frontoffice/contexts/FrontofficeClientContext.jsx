/**
 * FrontofficeClientContext.jsx
 * 
 * Contexte global pour gérer la session client du frontoffice
 * ⚠️ IMPORTANT : Un seul état du client partagé par toute l'app
 * Écoute aussi les changements du sessionStorage
 */

import { createContext, useContext, useState, useEffect } from 'react';

const FrontofficeClientContext = createContext();

/**
 * Provider du client frontoffice
 * À envelopper autour de l'app dans App.jsx
 */
export const FrontofficeClientProvider = ({ children }) => {
  const [client, setClient] = useState(null);
  const [isConnected, setIsConnected] = useState(false);

  // Charger la session au montage ET écouter les changements du sessionStorage
  useEffect(() => {
    const loadClient = () => {
      const stored = sessionStorage.getItem('frontoffice_client');
      if (stored) {
        try {
          const clientData = JSON.parse(stored);
          console.log('[FrontofficeClientContext] Client chargé :', clientData);
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
    };

    // Charger au montage
    loadClient();

    // ⚠️ IMPORTANT : Écouter les changements du sessionStorage
    const handleStorageChange = (e) => {
      if (e.key === 'frontoffice_client') {
        console.log('[FrontofficeClientContext] sessionStorage changé !');
        loadClient();
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  /**
   * Connecter un client
   * @param {Object} clientData - Données du client
   */
  const connect = (clientData) => {
    console.log('[FrontofficeClientContext] Connexion client :', clientData);
    sessionStorage.setItem('frontoffice_client', JSON.stringify(clientData));
    setClient(clientData);
    setIsConnected(true);
  };

  /**
   * Déconnecter le client
   */
  const logout = () => {
    console.log('[FrontofficeClientContext] Déconnexion');
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

  /**
   * Connecter en tant qu'anonyme
   */
  const connectAnonymous = () => {
    const anonymousClient = {
      anonymous: true,
      authenticated: false,
      loginTime: new Date().toISOString(),
    };

    console.log('[FrontofficeClientContext] Connexion anonyme');
    sessionStorage.setItem('frontoffice_client', JSON.stringify(anonymousClient));
    setClient(anonymousClient);
    setIsConnected(true);
  };

  const value = {
    client,
    isConnected,
    connect,
    logout,
    update,
    connectAnonymous,
  };

  return (
    <FrontofficeClientContext.Provider value={value}>
      {children}
    </FrontofficeClientContext.Provider>
  );
};

/**
 * Hook pour accéder au contexte du client frontoffice
 */
export const useFrontofficeClient = () => {
  const context = useContext(FrontofficeClientContext);
  if (!context) {
    throw new Error('useFrontofficeClient doit être utilisé avec FrontofficeClientProvider');
  }
  return context;
};

export default useFrontofficeClient;
