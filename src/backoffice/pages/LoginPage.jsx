/**
 * Page de connexion au backoffice
 * Formulaire simple avec username/password
 * Credentials par défaut: admin / admin
 */

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import './LoginPage.css';

export const LoginPage = () => {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('admin');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const navigate = useNavigate();
  const { login } = useAuth();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      await login(username, password);
      // Redirection vers les commandes après connexion réussie
      navigate('/backoffice/commandes');
    } catch (err) {
      setError(err.message || 'Erreur de connexion');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-box">
        <h1>PrestaShop Backoffice</h1>
        <p className="subtitle">Gestion Administrative</p>

        <form onSubmit={handleSubmit} className="login-form">
          {/* Champ Username */}
          <div className="form-group">
            <label htmlFor="username">Utilisateur</label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Entrez votre nom d'utilisateur"
              disabled={isLoading}
              required
            />
          </div>

          {/* Champ Password */}
          <div className="form-group">
            <label htmlFor="password">Mot de passe</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Entrez votre mot de passe"
              disabled={isLoading}
              required
            />
          </div>

          {/* Message d'erreur */}
          {error && <div className="error-message">{error}</div>}

          {/* Bouton de connexion */}
          <button type="submit" className="login-button" disabled={isLoading}>
            {isLoading ? 'Connexion en cours...' : 'Se connecter'}
          </button>
        </form>

        {/* Informations par défaut */}
        <div className="default-credentials">
          <p><strong>Identifiants par défaut :</strong></p>
          <p>Utilisateur: <code>admin</code></p>
          <p>Mot de passe: <code>admin</code></p>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
