/**
 * LoginModal.jsx
 * ─────────────────────────────────────────────────────────────
 * Modal pour vérifier le password du client sélectionné
 * ─────────────────────────────────────────────────────────────
 */

import React, { useState } from 'react';
import { validateCustomerPassword } from '../services/customersService';
import './LoginModal.css';

export const LoginModal = ({ isOpen, onClose, client, onLoginSuccess }) => {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!password) {
      setError('Veuillez entrer votre mot de passe');
      return;
    }

    setIsLoading(true);

    try {
      // Comparer les passwords (async)
      const isValid = await validateCustomerPassword(password, client.password);

      if (!isValid) {
        setError('Mot de passe incorrect');
        setPassword('');
        setIsLoading(false);
        return;
      }

      // Password correct → connecter le client
      const clientData = {
        id: client.id,
        firstName: client.firstName,
        lastName: client.lastName,
        email: client.email,
        company: client.company,
        loginTime: new Date().toISOString(),
        authenticated: true,
      };

      onLoginSuccess(clientData);
      setPassword('');
    } catch (err) {
      setError('Erreur lors de la vérification');
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen || !client) return null;

  return (
    <div className="login-modal-overlay" onClick={onClose}>
      <div className="login-modal" onClick={(e) => e.stopPropagation()}>
        <button className="login-modal__close" onClick={onClose}>
          ✕
        </button>

        <h2 className="login-modal__title">
          Bonjour {client.firstName}
        </h2>
        <p className="login-modal__subtitle">Entrez votre mot de passe</p>

        <form onSubmit={handleSubmit} className="login-modal__form">
          {/* Afficher l'email (read-only) */}
          <div className="form-group">
            <label>Email</label>
            <input
              type="email"
              value={client.email}
              disabled
              className="form-group__readonly"
            />
          </div>

          {/* Champ password */}
          <div className="form-group">
            <label htmlFor="login-password">Mot de passe</label>
            <input
              id="login-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              disabled={isLoading}
              required
              autoFocus
            />
          </div>

          {/* Message d'erreur */}
          {error && (
            <div className="login-modal__error">
              <span>⚠</span> {error}
            </div>
          )}

          {/* Bouton submit */}
          <button
            type="submit"
            className="login-modal__submit"
            disabled={isLoading}
          >
            {isLoading ? 'Vérification...' : 'Se connecter'}
          </button>
        </form>

        <button className="login-modal__cancel" onClick={onClose}>
          Retour
        </button>
      </div>
    </div>
  );
};

export default LoginModal;
