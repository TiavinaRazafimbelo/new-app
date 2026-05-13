/**
 * CartPage.jsx
 * 
 * Page du panier
 * Affiche : liste des articles, résumé, bouton checkout
 */

import { useNavigate } from 'react-router-dom';
import { useCart } from '../contexts/CartContext';
import { useFrontofficeClient } from '../contexts/FrontofficeClientContext';
import TopBar from '../components/TopBar';
import './CartPage.css';

export default function CartPage() {
  const navigate = useNavigate();
  const { cart, removeFromCart, updateQuantity, getTotal } = useCart();
  const { client } = useFrontofficeClient(); // client = { anonymous: true/false, ... }

  // Calcule sous-total et total
  const subtotal = getTotal();
  const shipping = 0; // Pas de frais de livraison
  const total = subtotal + shipping;

  /**
   * Supprime un article du panier
   */
  const handleRemoveItem = (productId, combinationId) => {
    removeFromCart(productId, combinationId);
  };

  /**
   * Change la quantité d'un article
   */
  const handleUpdateQuantity = (productId, combinationId, newQuantity) => {
    if (newQuantity > 0) {
      updateQuantity(productId, combinationId, newQuantity);
    }
  };

  /**
   * Lance le checkout
   * Vérifie si client est connecté
   */
  const handleCheckout = () => {
    if (!client || client?.anonymous) {
      // Client anonyme → le rediriger vers login avec redirect vers /cart
      navigate('/login', { state: { from: '/cart' } });
      return;
    }

    // Client connecté → aller vers commande
    // TODO : créer OrderPage
    console.log('TODO : Créer la page de commande');
    navigate('/order');
  };

  // ─── RENDU ─────────────────────────────────────────

  return (
    <>
      <TopBar />
      <div className="cart-page">
      <h1>Mon Panier</h1>

      {/* Panier vide */}
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
                    {/* Image + Nom */}
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

                    {/* Combinaison (exemple : Taille M, Couleur Rouge) */}
                    <td className="cart-combination">
                      {item.combinationId > 0 ? `ID: ${item.combinationId}` : '-'}
                    </td>

                    {/* Prix unitaire */}
                    <td className="cart-price">
                      {item.price.toFixed(2)} €
                    </td>

                    {/* Quantité avec input */}
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

                    {/* Total ligne */}
                    <td className="cart-line-total">
                      {(item.price * item.quantity).toFixed(2)} €
                    </td>

                    {/* Supprimer */}
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

            {/* Règle checkout */}
            {client?.anonymous ? (
              <div className="alert alert-info">
                <p>Veuillez vous connecter pour commander</p>
                <button
                  className="btn btn-primary btn-block"
                  onClick={() => navigate('/clients')}
                >
                  Se connecter
                </button>
              </div>
            ) : (
              <button
                className="btn btn-primary btn-block"
                onClick={handleCheckout}
              >
                Passer la commande
              </button>
            )}

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
