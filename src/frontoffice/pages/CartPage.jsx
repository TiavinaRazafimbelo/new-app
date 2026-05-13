/**
 * CartPage.jsx
 * 
 * Page du panier
 * Affiche : liste des articles, résumé, bouton checkout
 * 
 * MODIFIÉ : Gestion client anonyme avec modal 2 choix
 *   - Client connecté → /checkout directement
 *   - Client anonyme → modal (Se connecter | Commander en guest)
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCart } from '../contexts/CartContext';
import { useFrontofficeClient } from '../contexts/FrontofficeClientContext';
import TopBar from '../components/TopBar';
import AnonCheckoutModal from '../components/AnonCheckoutModal';
import './CartPage.css';

export default function CartPage() {
  const navigate = useNavigate();
  const { cart, removeFromCart, updateQuantity, getTotal, clearCart } = useCart();
  const { client } = useFrontofficeClient();

  // État du modal anonyme
  const [anonModalOpen, setAnonModalOpen] = useState(false);

  const subtotal = getTotal();
  const shipping = 0;
  const total    = subtotal + shipping;

  const handleRemoveItem = (productId, combinationId) => {
    removeFromCart(productId, combinationId);
  };

  const handleUpdateQuantity = (productId, combinationId, newQuantity) => {
    if (newQuantity > 0) {
      updateQuantity(productId, combinationId, newQuantity);
    }
  };

  /**
   * Lance le checkout
   * - Client connecté → /checkout
   * - Client anonyme → ouvre le modal 2 choix
   */
  const handleCheckout = () => {
    if (!client || client?.anonymous) {
      setAnonModalOpen(true);
      return;
    }
    navigate('/checkout');
  };

  const handleClearCart = () => {
    if (window.confirm('Êtes-vous sûr de vouloir vider votre panier ?')) {
      clearCart();
    }
  };

  return (
    <>
      <TopBar />

      {/* Modal pour les clients anonymes */}
      <AnonCheckoutModal
        isOpen={anonModalOpen}
        onClose={() => setAnonModalOpen(false)}
      />

      <div className="cart-page">
        <h1>Mon Panier</h1>

        {cart.length === 0 ? (
          <div className="cart-empty">
            <p>Votre panier est vide</p>
            <button
              className="btn btn-primary"
              onClick={() => navigate('/products')}
            >
              Continuer les achats
            </button>
          </div>
        ) : (
          <div className="cart-container">
            {/* ─── LISTE DES ARTICLES ─────────────────────────── */}
            <div className="cart-items">
              <table className="cart-table">
                <thead>
                  <tr>
                    <th>Produit</th>
                    <th>Combinaison</th>
                    <th>Prix</th>
                    <th>Quantité</th>
                    <th>Total</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {cart.map((item) => (
                    <tr key={`${item.productId}-${item.combinationId}`}>
                      <td className="cart-product">
                        {item.image && (
                          <img
                            src={item.image}
                            alt={item.name}
                            className="cart-product-image"
                          />
                        )}
                        <span>{item.name}</span>
                      </td>

                      <td className="cart-combination">
                        {item.combinationId > 0 ? `ID: ${item.combinationId}` : '-'}
                      </td>

                      <td className="cart-price">
                        {item.price.toFixed(2)} €
                      </td>

                      <td className="cart-quantity">
                        <input
                          type="number"
                          min="1"
                          max={item.stock}
                          value={item.quantity}
                          onChange={(e) =>
                            handleUpdateQuantity(
                              item.productId,
                              item.combinationId,
                              parseInt(e.target.value) || 1
                            )
                          }
                          className="quantity-input"
                        />
                        <small>Stock: {item.stock}</small>
                      </td>

                      <td className="cart-line-total">
                        {(item.price * item.quantity).toFixed(2)} €
                      </td>

                      <td className="cart-actions">
                        <button
                          className="btn btn-danger btn-small"
                          onClick={() =>
                            handleRemoveItem(item.productId, item.combinationId)
                          }
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="cart-actions-bar">
                <button
                  className="btn btn-secondary"
                  onClick={() => navigate('/products')}
                >
                  ← Continuer les achats
                </button>
                <button
                  className="btn btn-danger btn-small"
                  onClick={handleClearCart}
                >
                  Vider
                </button>
              </div>
            </div>

            {/* ─── RÉSUMÉ ET CHECKOUT ──────────────────────── */}
            <aside className="cart-summary">
              <h2>Résumé</h2>

              <div className="summary-row">
                <span>Sous-total</span>
                <span className="amount">{subtotal.toFixed(2)} €</span>
              </div>

              <div className="summary-row">
                <span>Livraison</span>
                <span className="amount">{shipping.toFixed(2)} €</span>
              </div>

              <div className="summary-row summary-total">
                <span>Total</span>
                <span className="amount">{total.toFixed(2)} €</span>
              </div>

              {/* Bouton commander — même pour les anonymes (modal s'ouvre) */}
              <button
                className="btn btn-primary btn-block"
                onClick={handleCheckout}
              >
                Passer la commande
              </button>

              <button
                className="btn btn-link"
                onClick={() => navigate('/products')}
              >
                Continuer les achats
              </button>
            </aside>
          </div>
        )}
      </div>
    </>
  );
}