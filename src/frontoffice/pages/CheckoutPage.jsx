/**
 * CheckoutPage.jsx
 * ─────────────────────────────────────────────────────────────
 * Tunnel de commande — saisie adresse + confirmation.
 *
 * MODES :
 *   - Client connecté  : pré-remplit l'adresse si existante
 *   - Guest (anonyme)  : saisie complète email + infos perso + adresse
 *
 * FLUX :
 *   Étape 1 : Infos personnelles (guest uniquement)
 *   Étape 2 : Adresse de livraison
 *   Étape 3 : Récapitulatif + paiement → Confirmer
 *
 * ROUTE : /checkout
 *   State attendu : { guest: true } si mode invité
 * ─────────────────────────────────────────────────────────────
 */

import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useCart } from '../contexts/CartContext';
import { useFrontofficeClient } from '../contexts/FrontofficeClientContext';
import TopBar from '../components/TopBar';
import {
  getCustomerAddresses,
  createAddress,
  createFullOrder,
  ORDER_CONFIG,
} from '../services/orderService';
import './CheckoutPage.css';

// ─── Constantes ───────────────────────────────────────────────

const STEPS = ['Adresse', 'Récapitulatif', 'Confirmation'];

// ─── Sous-composant : indicateur d'étapes ─────────────────────

function StepIndicator({ currentStep }) {
  return (
    <div className="step-indicator">
      {STEPS.map((label, i) => (
        <React.Fragment key={label}>
          <div className={`step ${i < currentStep ? 'step--done' : ''} ${i === currentStep ? 'step--active' : ''}`}>
            <div className="step__circle">
              {i < currentStep ? '✓' : i + 1}
            </div>
            <span className="step__label">{label}</span>
          </div>
          {i < STEPS.length - 1 && (
            <div className={`step__line ${i < currentStep ? 'step__line--done' : ''}`} />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

// ─── Sous-composant : formulaire adresse ──────────────────────

function AdresseForm({ adresse, onChange, errors }) {
  const handleChange = (e) => {
    onChange({ ...adresse, [e.target.name]: e.target.value });
  };

  const champ = (name, label, required = true, type = 'text', placeholder = '') => (
    <div className="form-group">
      <label htmlFor={name}>
        {label} {required && <span className="required">*</span>}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        value={adresse[name] || ''}
        onChange={handleChange}
        placeholder={placeholder}
        className={errors?.[name] ? 'input--error' : ''}
      />
      {errors?.[name] && <span className="error-msg">{errors[name]}</span>}
    </div>
  );

  return (
    <div className="adresse-form">
      <div className="form-row">
        {champ('firstname', 'Prénom')}
        {champ('lastname', 'Nom')}
      </div>

      {champ('alias', 'Alias adresse', true, 'text', 'Ex : Domicile, Bureau…')}
      {champ('address1', 'Adresse (ligne 1)')}
      {champ('address2', 'Adresse (ligne 2)', false, 'text', 'Complément (optionnel)')}

      <div className="form-row">
        {champ('postcode', 'Code postal')}
        {champ('city', 'Ville')}
      </div>

      {/* Pays : toujours France, lecture seule */}
      <div className="form-group">
        <label>Pays <span className="required">*</span></label>
        <input type="text" value="France" readOnly className="input--readonly" />
      </div>

      {champ('phone', 'Téléphone', true, 'tel', '06 00 00 00 00')}
    </div>
  );
}

// ─── Sous-composant : récapitulatif panier ────────────────────

function RecapPanier({ cartItems }) {
  const total = cartItems.reduce((s, item) => s + item.price * item.quantity, 0);

  return (
    <div className="recap-panier">
      <h3>Récapitulatif de votre commande</h3>

      <table className="recap-table">
        <thead>
          <tr>
            <th>Produit</th>
            <th>Qté</th>
            <th>Prix unit.</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          {cartItems.map((item) => (
            <tr key={`${item.productId}-${item.combinationId}`}>
              <td>
                <div className="recap-produit">
                  {item.image && (
                    <img src={item.image} alt={item.name} className="recap-img" />
                  )}
                  <span>{item.name}</span>
                </div>
              </td>
              <td>{item.quantity}</td>
              <td>{item.price.toFixed(2)} €</td>
              <td><strong>{(item.price * item.quantity).toFixed(2)} €</strong></td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="recap-totaux">
        <div className="recap-ligne">
          <span>Sous-total produits</span>
          <span>{total.toFixed(2)} €</span>
        </div>
        <div className="recap-ligne">
          <span>Frais de livraison</span>
          <span>{ORDER_CONFIG.SHIPPING_COST.toFixed(2)} €</span>
        </div>
        <div className="recap-ligne recap-ligne--total">
          <span>Total TTC</span>
          <span>{(total + ORDER_CONFIG.SHIPPING_COST).toFixed(2)} €</span>
        </div>
      </div>

      {/* Paiement — toujours "Paiement à la livraison" */}
      <div className="paiement-section">
        <h4>Mode de paiement</h4>
        <div className="paiement-option paiement-option--selected">
          <span className="paiement-radio">●</span>
          <div>
            <strong>{ORDER_CONFIG.PAYMENT_LABEL}</strong>
            <p>Vous réglez à la réception de votre commande. Aucun frais supplémentaire.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Composant principal ──────────────────────────────────────

const CheckoutPage = () => {
  const navigate  = useNavigate();
  const location  = useLocation();
  const { cart, clearCart } = useCart();
  const { client } = useFrontofficeClient();

  // Mode guest si navigué avec state.guest = true
  const isGuest = location.state?.guest === true || client?.anonymous === true;

  // Étape courante : 0 = adresse, 1 = récap, 2 = terminé
  const [step,             setStep]             = useState(0);
  const [adresse,          setAdresse]          = useState({
    alias:    'Mon adresse',
    firstname: client?.firstName || '',
    lastname:  client?.lastName  || '',
  });
  const [guestData,        setGuestData]        = useState({
    email:     '',
    firstname: '',
    lastname:  '',
  });
  const [adressesExistantes, setAdressesExistantes] = useState([]);
  const [adresseSelecteeId,  setAdresseSelecteeId]  = useState(null); // null = nouvelle
  const [erreurs,          setErreurs]          = useState({});
  const [loading,          setLoading]          = useState(false);
  const [orderResult,      setOrderResult]      = useState(null); // { orderId, orderReference }
  const [erreurGlobale,    setErreurGlobale]    = useState(null);

  // ── Garde : panier vide → retour ──────────────────────────
  useEffect(() => {
    if (cart.length === 0 && !orderResult) {
      navigate('/cart');
    }
  }, [cart, navigate, orderResult]);

  // ── Garde : client non connecté en mode non-guest → login ─
  useEffect(() => {
    if (!isGuest && client && client.anonymous) {
      navigate('/clients', { state: { from: '/checkout' } });
    }
  }, [client, isGuest, navigate]);

  // ── Chargement des adresses existantes (client connecté) ──
  useEffect(() => {
    if (!isGuest && client && !client.anonymous && client.id) {
      getCustomerAddresses(client.id)
        .then((addrs) => {
          setAdressesExistantes(addrs);
          if (addrs.length > 0) {
            // Pré-sélectionner la première adresse
            setAdresseSelecteeId(addrs[0].id);
            setAdresse({
              alias:    addrs[0].alias,
              firstname: addrs[0].firstname,
              lastname:  addrs[0].lastname,
              address1:  addrs[0].address1,
              address2:  addrs[0].address2 || '',
              postcode:  addrs[0].postcode,
              city:      addrs[0].city,
              phone:     addrs[0].phone,
            });
          } else {
            // Pas d'adresse → pré-remplir avec les infos du client
            setAdresse((prev) => ({
              ...prev,
              firstname: client.firstName || '',
              lastname:  client.lastName  || '',
            }));
          }
        });
    }
  }, [client, isGuest]);

  // ── Validation formulaire adresse ─────────────────────────
  const validerAdresse = () => {
    const e = {};

    if (isGuest) {
      if (!guestData.email.trim())     e.email     = 'Email requis';
      if (!guestData.firstname.trim()) e.gfirstname = 'Prénom requis';
      if (!guestData.lastname.trim())  e.glastname  = 'Nom requis';
    }

    // Si adresse existante sélectionnée → pas de validation du formulaire
    if (!adresseSelecteeId) {
      if (!adresse.firstname?.trim()) e.firstname = 'Prénom requis';
      if (!adresse.lastname?.trim())  e.lastname  = 'Nom requis';
      if (!adresse.address1?.trim())  e.address1  = 'Adresse requise';
      if (!adresse.postcode?.trim())  e.postcode  = 'Code postal requis';
      if (!adresse.city?.trim())      e.city      = 'Ville requise';
      if (!adresse.phone?.trim())     e.phone     = 'Téléphone requis';
    }

    setErreurs(e);
    return Object.keys(e).length === 0;
  };

  // ── Navigation étapes ─────────────────────────────────────
  const handleNextStep = () => {
    if (step === 0) {
      if (!validerAdresse()) return;
      setStep(1);
    }
  };

  const handlePrevStep = () => {
    if (step > 0) setStep((s) => s - 1);
  };

  // ── Sélection adresse existante ───────────────────────────
  const handleSelectAdresse = (addr) => {
    setAdresseSelecteeId(addr.id);
    setAdresse({
      alias:    addr.alias,
      firstname: addr.firstname,
      lastname:  addr.lastname,
      address1:  addr.address1,
      address2:  addr.address2 || '',
      postcode:  addr.postcode,
      city:      addr.city,
      phone:     addr.phone,
    });
  };

  const handleNouvelleAdresse = () => {
    setAdresseSelecteeId(null);
    setAdresse({
      alias:     'Mon adresse',
      firstname: isGuest ? guestData.firstname : (client?.firstName || ''),
      lastname:  isGuest ? guestData.lastname  : (client?.lastName  || ''),
    });
  };

  // ── Confirmation commande ─────────────────────────────────
  const handleConfirmerCommande = async () => {
    setLoading(true);
    setErreurGlobale(null);

    try {
      const customerId = isGuest ? 0 : (client?.id || 0);
      const guestInfo  = isGuest
        ? { email: guestData.email, firstname: guestData.firstname, lastname: guestData.lastname }
        : null;

      const result = await createFullOrder({
        customerId,
        guestData: guestInfo,
        cartItems: cart,
        addressData: adresse,
        existingAddressId: adresseSelecteeId, // null = créer nouvelle
      });

      setOrderResult(result);
      clearCart(); // Vide le panier localStorage
      setStep(2);

    } catch (err) {
      console.error('[CheckoutPage] Erreur commande:', err);
      setErreurGlobale(err.message || 'Une erreur est survenue lors de la création de la commande.');
    } finally {
      setLoading(false);
    }
  };

  // ── Rendu ─────────────────────────────────────────────────

  return (
    <>
      <TopBar />
      <div className="checkout-page">

        {/* Fil d'Ariane */}
        <nav className="checkout-breadcrumb">
          <Link to="/products">Produits</Link>
          <span>›</span>
          <Link to="/cart">Panier</Link>
          <span>›</span>
          <span>Commande</span>
        </nav>

        <h1 className="checkout-title">Finaliser ma commande</h1>

        {/* Indicateur d'étapes */}
        <StepIndicator currentStep={step} />

        {/* ── ÉTAPE 0 : ADRESSE ─────────────────────────── */}
        {step === 0 && (
          <div className="checkout-step">
            <h2>Adresse de livraison et facturation</h2>

            {/* Infos guest */}
            {isGuest && (
              <div className="guest-infos-section">
                <h3>Vos informations</h3>
                <div className="form-group">
                  <label htmlFor="guest-email">Email <span className="required">*</span></label>
                  <input
                    id="guest-email"
                    name="email"
                    type="email"
                    value={guestData.email}
                    onChange={(e) => setGuestData({ ...guestData, email: e.target.value })}
                    placeholder="votre@email.com"
                    className={erreurs.email ? 'input--error' : ''}
                  />
                  {erreurs.email && <span className="error-msg">{erreurs.email}</span>}
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor="guest-firstname">Prénom <span className="required">*</span></label>
                    <input
                      id="guest-firstname"
                      type="text"
                      value={guestData.firstname}
                      onChange={(e) => setGuestData({ ...guestData, firstname: e.target.value })}
                      className={erreurs.gfirstname ? 'input--error' : ''}
                    />
                    {erreurs.gfirstname && <span className="error-msg">{erreurs.gfirstname}</span>}
                  </div>
                  <div className="form-group">
                    <label htmlFor="guest-lastname">Nom <span className="required">*</span></label>
                    <input
                      id="guest-lastname"
                      type="text"
                      value={guestData.lastname}
                      onChange={(e) => setGuestData({ ...guestData, lastname: e.target.value })}
                      className={erreurs.glastname ? 'input--error' : ''}
                    />
                    {erreurs.glastname && <span className="error-msg">{erreurs.glastname}</span>}
                  </div>
                </div>
              </div>
            )}

            {/* Adresses existantes (client connecté) */}
            {!isGuest && adressesExistantes.length > 0 && (
              <div className="adresses-existantes">
                <h3>Vos adresses enregistrées</h3>
                <div className="adresses-grid">
                  {adressesExistantes.map((addr) => (
                    <div
                      key={addr.id}
                      className={`adresse-card ${adresseSelecteeId === addr.id ? 'adresse-card--selected' : ''}`}
                      onClick={() => handleSelectAdresse(addr)}
                    >
                      <strong>{addr.alias}</strong>
                      <p>{addr.firstname} {addr.lastname}</p>
                      <p>{addr.address1}</p>
                      {addr.address2 && <p>{addr.address2}</p>}
                      <p>{addr.postcode} {addr.city}</p>
                      <p>{addr.phone}</p>
                    </div>
                  ))}

                  {/* Carte "Nouvelle adresse" */}
                  <div
                    className={`adresse-card adresse-card--new ${adresseSelecteeId === null ? 'adresse-card--selected' : ''}`}
                    onClick={handleNouvelleAdresse}
                  >
                    <span className="adresse-card__plus">+</span>
                    <strong>Nouvelle adresse</strong>
                  </div>
                </div>
              </div>
            )}

            {/* Formulaire adresse (nouvelle ou pas d'adresse existante) */}
            {(!adresseSelecteeId || adressesExistantes.length === 0) && (
              <div className="adresse-form-section">
                {adressesExistantes.length > 0 && <h3>Saisir une nouvelle adresse</h3>}
                <AdresseForm
                  adresse={adresse}
                  onChange={setAdresse}
                  errors={erreurs}
                />
              </div>
            )}

            <div className="checkout-actions">
              <Link to="/cart" className="btn-secondary">← Retour au panier</Link>
              <button className="btn-primary" onClick={handleNextStep}>
                Continuer →
              </button>
            </div>
          </div>
        )}

        {/* ── ÉTAPE 1 : RÉCAPITULATIF ───────────────────── */}
        {step === 1 && (
          <div className="checkout-step">
            {/* Adresse choisie */}
            <div className="adresse-choisie">
              <h3>Adresse de livraison</h3>
              <p>
                {adresse.firstname} {adresse.lastname}<br />
                {adresse.address1}
                {adresse.address2 && <>, {adresse.address2}</>}<br />
                {adresse.postcode} {adresse.city} — France<br />
                {adresse.phone}
              </p>
              <button className="btn-link" onClick={handlePrevStep}>Modifier</button>
            </div>

            {/* Récap panier + paiement */}
            <RecapPanier cartItems={cart} />

            {/* Erreur globale */}
            {erreurGlobale && (
              <div className="erreur-globale">
                ⚠ {erreurGlobale}
              </div>
            )}

            <div className="checkout-actions">
              <button className="btn-secondary" onClick={handlePrevStep}>← Retour</button>
              <button
                className="btn-confirm"
                onClick={handleConfirmerCommande}
                disabled={loading}
              >
                {loading ? 'Création en cours…' : 'Confirmer la commande'}
              </button>
            </div>
          </div>
        )}

        {/* ── ÉTAPE 2 : CONFIRMATION ────────────────────── */}
        {step === 2 && orderResult && (
          <div className="checkout-step checkout-step--success">
            <div className="success-icon">✓</div>
            <h2>Commande confirmée !</h2>
            <p>Merci pour votre commande.</p>

            <div className="order-info-box">
              <div>
                <span>Numéro de commande</span>
                <strong>#{orderResult.orderId}</strong>
              </div>
              {orderResult.orderReference && (
                <div>
                  <span>Référence</span>
                  <strong>{orderResult.orderReference}</strong>
                </div>
              )}
              <div>
                <span>Mode de paiement</span>
                <strong>{ORDER_CONFIG.PAYMENT_LABEL}</strong>
              </div>
            </div>

            <div className="checkout-actions checkout-actions--center">
              {!isGuest && (
                <button className="btn-primary" onClick={() => navigate('/orders')}>
                  Suivre mes commandes
                </button>
              )}
              <button className="btn-secondary" onClick={() => navigate('/products')}>
                Continuer mes achats
              </button>
            </div>
          </div>
        )}

      </div>
    </>
  );
};

export default CheckoutPage;