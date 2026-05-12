/**
 * Composant de protection des routes
 * Redirige vers la page de login si l'utilisateur n'est pas authentifié
 * Utilisé pour protéger les pages du backoffice
 */

import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';

/**
 * ProtectedRoute - Middleware de sécurité
 * @param {React.ReactNode} children - Le composant à protéger
 * @returns {React.ReactNode} Affiche le composant ou redirige vers login
 * @example
 * <ProtectedRoute>
 *   <Dashboard />
 * </ProtectedRoute>
 */
export const ProtectedRoute = ({ children }) => {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return <div className="loading">Chargement...</div>;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return children;
};

export default ProtectedRoute;
