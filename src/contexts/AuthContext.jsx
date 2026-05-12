/**
 * Contexte d'authentification pour React
 * Fournit l'état global de l'authentification à toute l'application
 * Utilise React Context API pour éviter le prop drilling
 */

import React, { createContext, useState, useContext, useEffect } from 'react';
import * as authService from '../services/authService';

// Création du contexte
const AuthContext = createContext(null);

/**
 * Provider d'authentification
 * À placer au sommet de l'arborescence des composants
 */
export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  // Vérifier les credentials au chargement de l'app
  useEffect(() => {
    const storedUser = authService.getStoredCredentials();
    if (storedUser) {
      setUser(storedUser);
    }
    setIsLoading(false);
  }, []);

  /**
   * Connexion utilisateur
   */
  const handleLogin = async (username, password) => {
    setIsLoading(true);
    setError(null);
    try {
      const userData = await authService.login(username, password);
      setUser(userData);
      return userData;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Déconnexion utilisateur
   */
  const handleLogout = () => {
    authService.logout();
    setUser(null);
    setError(null);
  };

  const value = {
    user,
    isLoading,
    error,
    login: handleLogin,
    logout: handleLogout,
    isAuthenticated: authService.isAuthenticated(),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

/**
 * Hook pour utiliser le contexte d'authentification
 * @returns {Object} Le contexte d'authentification
 * @example
 * const { user, login, logout } = useAuth();
 */
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth doit être utilisé avec AuthProvider');
  }
  return context;
};
