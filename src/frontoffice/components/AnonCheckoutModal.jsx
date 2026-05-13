/**
 * AnonCheckoutModal.jsx
 * ─────────────────────────────────────────────────────────────
 * Modal affiché quand un client anonyme clique sur "Commander".
 * Propose 2 choix :
 *   1. Se connecter (→ /clients avec redirect vers /checkout)
 *   2. Commander en guest (→ /checkout avec state guest:true)
 * ─────────────────────────────────────────────────────────────
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';
import './AnonCheckoutModal.css';

/**
 * @param {Object} props
 * @param {boolean}  props.isOpen   - Afficher ou masquer le modal
 * @param {Function} props.onClose  - Fermer le modal
 */
const AnonCheckoutModal = ({ isOpen, onClose }) => {
  const navigate = useNavigate();

  if (!isOpen) return null;

  const handleLogin = () => {
    onClose();
    // Redirige vers la page de connexion avec retour sur /checkout après auth
    navigate('/clients', { state: { from: '/checkout' } });
  };

  const handleGuest = () => {
    onClose();
    // Passe en mode guest directement vers checkout
    navigate('/checkout', { state: { guest: true } });
  };

  return (
    <div className="anon-modal-overlay" onClick={onClose}>
      <div
        className="anon-modal"
        onClick={(e) => e.stopPropagation()} // Empêche la fermeture au clic dans le modal
        role="dialog"
        aria-modal="true"
        aria-labelledby="anon-modal-title"
      >
        {/* Fermeture */}
        <button className="anon-modal__close" onClick={onClose} aria-label="Fermer">
          ×
        </button>

        {/* Titre */}
        <h2 id="anon-modal-title" className="anon-modal__title">
          Comment voulez-vous commander ?
        </h2>

        <p className="anon-modal__subtitle">
          Vous naviguez en tant qu'invité. Choisissez une option pour continuer.
        </p>

        {/* Options */}
        <div className="anon-modal__options">

          {/* Option 1 : Se connecter */}
          <div className="anon-modal__option anon-modal__option--login">
            <div className="anon-modal__option-icon">👤</div>
            <h3>J'ai un compte</h3>
            <p>Connectez-vous pour retrouver vos commandes et adresses enregistrées.</p>
            <button className="anon-modal__btn anon-modal__btn--primary" onClick={handleLogin}>
              Se connecter
            </button>
          </div>

          {/* Séparateur */}
          <div className="anon-modal__separator">
            <span>ou</span>
          </div>

          {/* Option 2 : Commander en guest */}
          <div className="anon-modal__option anon-modal__option--guest">
            <div className="anon-modal__option-icon">🛍️</div>
            <h3>Commander en invité</h3>
            <p>Commandez sans créer de compte. Vous devrez saisir vos informations.</p>
            <button className="anon-modal__btn anon-modal__btn--secondary" onClick={handleGuest}>
              Continuer en invité
            </button>
          </div>

        </div>
      </div>
    </div>
  );
};

export default AnonCheckoutModal;