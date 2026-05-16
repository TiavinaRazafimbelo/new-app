/**
 * CheckoutPage.jsx
 * ─────────────────────────────────────────────────────────────
 * v2 : Passe `existingCartId` à createFullOrder pour les clients connectés.
 *
 * Le cart PS est déjà créé et synchronisé par CartContext.
 * CheckoutPage n'a plus qu'à créer l'ORDER à partir de ce cart.
 *
 * Pour les guests, le flux est inchangé (cart créé pendant createFullOrder).
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
  const handleChange = (e) => onChange({ ...adresse, [e.target.name]: e.target.value });

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
                  {item.image && <img src={item.image} alt={item.name} className="recap-img" />}
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
  const navigate   = useNavigate();
  const location   = useLocation();
  const { cart, clearCart, getPsCartId, isSyncing } = useCart();
  const { client } = useFrontofficeClient();

  const isGuest = location.state?.guest === true || client?.anonymous === true;

  const [step,               setStep]               = useState(0);
  const [adresse,            setAdresse]            = useState({
    alias:     'Mon adresse',
    firstname: client?.firstName || '',
    lastname:  client?.lastName  || '',
  });
  const [guestData,          setGuestData]          = useState({ email: '', firstname: '', lastname: '' });
  const [adressesExistantes, setAdressesExistantes] = useState([]);
  const [adresseSelecteeId,  setAdresseSelecteeId]  = useState(null);
  const [erreurs,            setErreurs]            = useState({});
  const [loading,            setLoading]            = useState(false);
  const [orderResult,        setOrderResult]        = useState(null);
  const [erreurGlobale,      setErreurGlobale]      = useState(null);

  // Garde : panier vide
  useEffect(() => {
    if (cart.length === 0 && !orderResult) navigate('/cart');
  }, [cart, navigate, orderResult]);

  // Chargement adresses existantes (client connecté)
  useEffect(() => {
    if (!isGuest && client && !client.anonymous && client.id) {
      getCustomerAddresses(client.id).then((addrs) => {
        setAdressesExistantes(addrs);
        if (addrs.length > 0) {
          setAdresseSelecteeId(addrs[0].id);
          const a = addrs[0];
          setAdresse({ alias: a.alias, firstname: a.firstname, lastname: a.lastname,
            address1: a.address1, address2: a.address2 || '', postcode: a.postcode,
            city: a.city, phone: a.phone });
        } else {
          setAdresse((prev) => ({
            ...prev,
            firstname: client.firstName || '',
            lastname:  client.lastName  || '',
          }));
        }
      });
    }
  }, [client, isGuest]);

  // Validation
  const validerAdresse = () => {
    const e = {};
    if (isGuest) {
      if (!guestData.email.trim())     e.email      = 'Email requis';
      if (!guestData.firstname.trim()) e.gfirstname = 'Prénom requis';
      if (!guestData.lastname.trim())  e.glastname  = 'Nom requis';
    }
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

  const handleNextStep = () => {
    if (step === 0 && validerAdresse()) setStep(1);
  };

  const handleSelectAdresse = (addr) => {
    setAdresseSelecteeId(addr.id);
    setAdresse({ alias: addr.alias, firstname: addr.firstname, lastname: addr.lastname,
      address1: addr.address1, address2: addr.address2 || '', postcode: addr.postcode,
      city: addr.city, phone: addr.phone });
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

      // Récupère le cartId PS déjà créé par CartContext (null si guest)
      const existingCartId = isGuest ? null : getPsCartId();

      if (!isGuest && !existingCartId) {
        // Cas rare : client connecté mais cart PS pas encore créé (réseau lent)
        // On attend un peu et on réessaie
        await new Promise((r) => setTimeout(r, 1000));
        const retryId = getPsCartId();
        if (!retryId && isSyncing) {
          setErreurGlobale('Le panier est en cours de synchronisation. Veuillez réessayer dans quelques secondes.');
          setLoading(false);
          return;
        }
      }

      const result = await createFullOrder({
        customerId,
        guestData:         guestInfo,
        cartItems:         cart,
        addressData:       adresse,
        existingAddressId: adresseSelecteeId,
        existingCartId:    isGuest ? null : getPsCartId(),
      });

      setOrderResult(result);
      clearCart();
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

        <nav className="checkout-breadcrumb">
          <Link to="/products">Produits</Link>
          <span>›</span>
          <Link to="/cart">Panier</Link>
          <span>›</span>
          <span>Commande</span>
        </nav>

        <h1 className="checkout-title">Finaliser ma commande</h1>

        {/* Badge synchro panier (clients connectés) */}
        {isSyncing && !isGuest && (
          <div className="sync-badge">
            ⏳ Synchronisation du panier en cours…
          </div>
        )}

        <StepIndicator currentStep={step} />

        {/* ── ÉTAPE 0 : ADRESSE ─────────────────────────── */}
        {step === 0 && (
          <div className="checkout-step">
            <h2>Adresse de livraison et facturation</h2>

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
                    <label>Prénom <span className="required">*</span></label>
                    <input type="text" value={guestData.firstname}
                      onChange={(e) => setGuestData({ ...guestData, firstname: e.target.value })}
                      className={erreurs.gfirstname ? 'input--error' : ''} />
                    {erreurs.gfirstname && <span className="error-msg">{erreurs.gfirstname}</span>}
                  </div>
                  <div className="form-group">
                    <label>Nom <span className="required">*</span></label>
                    <input type="text" value={guestData.lastname}
                      onChange={(e) => setGuestData({ ...guestData, lastname: e.target.value })}
                      className={erreurs.glastname ? 'input--error' : ''} />
                    {erreurs.glastname && <span className="error-msg">{erreurs.glastname}</span>}
                  </div>
                </div>
              </div>
            )}

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

            {(!adresseSelecteeId || adressesExistantes.length === 0) && (
              <div className="adresse-form-section">
                {adressesExistantes.length > 0 && <h3>Saisir une nouvelle adresse</h3>}
                <AdresseForm adresse={adresse} onChange={setAdresse} errors={erreurs} />
              </div>
            )}

            <div className="checkout-actions">
              <Link to="/cart" className="btn-secondary">← Retour au panier</Link>
              <button className="btn-primary" onClick={handleNextStep}>Continuer →</button>
            </div>
          </div>
        )}

        {/* ── ÉTAPE 1 : RÉCAPITULATIF ───────────────────── */}
        {step === 1 && (
          <div className="checkout-step">
            <div className="adresse-choisie">
              <h3>Adresse de livraison</h3>
              <p>
                {adresse.firstname} {adresse.lastname}<br />
                {adresse.address1}
                {adresse.address2 && <>, {adresse.address2}</>}<br />
                {adresse.postcode} {adresse.city} — France<br />
                {adresse.phone}
              </p>
              <button className="btn-link" onClick={() => setStep(0)}>Modifier</button>
            </div>

            <RecapPanier cartItems={cart} />

            {erreurGlobale && (
              <div className="erreur-globale">⚠ {erreurGlobale}</div>
            )}

            <div className="checkout-actions">
              <button className="btn-secondary" onClick={() => setStep(0)}>← Retour</button>
              <button
                className="btn-confirm"
                onClick={handleConfirmerCommande}
                disabled={loading || isSyncing}
                title={isSyncing ? 'Synchronisation en cours…' : ''}
              >
                {loading ? 'Création en cours…' : isSyncing ? 'Patientez…' : 'Confirmer la commande'}
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