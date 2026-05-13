/**
 * FrontofficeClientContext.jsx
 * 
 * Contexte global pour gérer la session client du frontoffice
 * ⚠️ IMPORTANT : Un seul état du client partagé par toute l'app
 * Écoute aussi les changements du sessionStorage
 */

import { createContext, useContext, useState, useEffect } from 'react';
import { getOrCreateAnonSessionId, clearAnonSession } from '../utils/anonSessionUtil';

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
   * ⚠️ Si c'est un client anonyme sans anonSessionId, on en génère un
   */
  const connect = (clientData) => {
    let finalClientData = clientData;
    
    // Si c'est un client anonyme sans anonSessionId, générer un UUID
    if (clientData.anonymous && !clientData.anonSessionId) {
      finalClientData = {
        ...clientData,
        anonSessionId: getOrCreateAnonSessionId(),
      };
      console.log('[FrontofficeClientContext] Client anonyme corrigé avec anonSessionId :', finalClientData.anonSessionId);
    }
    
    console.log('[FrontofficeClientContext] Connexion client :', finalClientData);
    sessionStorage.setItem('frontoffice_client', JSON.stringify(finalClientData));
    setClient(finalClientData);
    setIsConnected(true);
  };

  /**
   * Déconnecter le client
   * ⚠️ Pour un client anonyme : supprime l'UUID et génère un nouveau panier
   */
  const logout = () => {
    console.log('[FrontofficeClientContext] Déconnexion');
    sessionStorage.removeItem('frontoffice_client');
    clearAnonSession(); // ← Supprime l'UUID pour créer un nouveau à la reconnexion
    connectAnonymous(); // ← Génère un nouvel UUID + nouveau panier
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
    const anonSessionId = getOrCreateAnonSessionId();
    const anonymousClient = {
      anonymous: true,
      authenticated: false,
      anonSessionId, // UUID unique et persistant
      loginTime: new Date().toISOString(),
    };

    console.log('[FrontofficeClientContext] Connexion anonyme avec session :', anonSessionId);
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
