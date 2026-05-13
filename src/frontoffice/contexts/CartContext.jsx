/**
 * CartContext.jsx
 * 
 * Contexte global pour gérer le panier
 * Permet à toute l'app d'accéder au panier et d'être notifiée des changements
 */

import { createContext, useContext, useState, useEffect } from 'react';
import {
  getCart,
  addToCart as addToCartService,
  removeFromCart as removeFromCartService,
  updateQuantity as updateQuantityService,
  clearCart as clearCartService,
  getCartTotal,
  getCartCount,
  mergeAnonymousCartToAuthenticatedCart,
} from '../services/cartService';
import { useFrontofficeClient } from './FrontofficeClientContext';

// Crée le contexte
const CartContext = createContext();

/**
 * Provider du panier
 * À envelopper autour de l'app dans App.jsx
 * 
 * ⚠️ IMPORTANT : Chaque client a son propre panier !
 * Quand le client change (login/logout), le panier se met à jour automatiquement
 */
export const CartProvider = ({ children }) => {
  const { client } = useFrontofficeClient(); // Récupère le client actuel
  const [cart, setCart] = useState([]);
  const [cartCount, setCartCount] = useState(0);
  const [currentClientId, setCurrentClientId] = useState(() => {
    // Initialiser avec le clientId du client actuel
    if (!client) return 'anonymous';
    if (client.anonymous) return `anon_${client.anonSessionId}` || 'anonymous';
    return client.id || 'anonymous';
  });

  // Génère l'ID du client (utilise l'UUID pour les anonymes)
  const getClientId = () => {
    if (!client) return 'anonymous';
    if (client.anonymous) return `anon_${client.anonSessionId}` || 'anonymous';
    return client.id || 'anonymous';
  };

  // ⚠️ SYNCHRONISATION IMPORTANTE : Écoute les changements du client
  useEffect(() => {
    const newClientId = getClientId();
    console.log('[CartContext] Client changé :', { ancien: currentClientId, nouveau: newClientId, client });
    
    // Si le client a réellement changé, met à jour le panier
    if (newClientId !== currentClientId) {
      setCurrentClientId(newClientId);
      const newCart = getCart(newClientId);
      setCart(newCart);
      console.log('[CartContext] Panier chargé pour client', newClientId, ':', newCart.length, 'articles');
    }
  }, [client]); // Écoute le client directement

  // Met à jour le badge de quantité
  useEffect(() => {
    setCartCount(getCartCount(currentClientId));
  }, [cart, currentClientId]);

  /**
   * Charge le panier depuis localStorage
   */
  const loadCart = () => {
    const cartItems = getCart(currentClientId);
    setCart(cartItems);
  };

  /**
   * Ajoute un article au panier
   */
  const addToCart = (item) => {
    console.log('[CartContext] Ajout article au panier du client', currentClientId);
    const updatedCart = addToCartService(currentClientId, item);
    setCart(updatedCart);
  };

  /**
   * Supprime une ligne du panier
   */
  const removeFromCart = (productId, combinationId) => {
    const updatedCart = removeFromCartService(currentClientId, productId, combinationId);
    setCart(updatedCart);
  };

  /**
   * Modifie la quantité
   */
  const updateQuantity = (productId, combinationId, newQuantity) => {
    const updatedCart = updateQuantityService(currentClientId, productId, combinationId, newQuantity);
    setCart(updatedCart);
  };

  /**
   * Vide le panier
   */
  const clearCart = () => {
    const updatedCart = clearCartService(currentClientId);
    setCart(updatedCart);
  };

  /**
   * Récupère le total
   */
  const getTotal = () => {
    return getCartTotal(currentClientId);
  };

  /**
   * Fusionne le panier anonyme avec le panier du client authentifié
   * À appeler quand un anonyme se connecte
   * 
   * @param {string|number} anonClientId - ID du client anonyme (ex: "anon_uuid")
   * @param {string|number} authenticatedClientId - ID du client authentifié (ex: 9)
   */
  const mergeAnonToAuthCart = (anonClientId, authenticatedClientId) => {
    console.log(
      `[CartContext] Fusion panier anonyme (${anonClientId}) → authentifié (${authenticatedClientId})`
    );
    const mergedCart = mergeAnonymousCartToAuthenticatedCart(anonClientId, authenticatedClientId);
    
    // Mettre à jour le panier local et le currentClientId
    setCurrentClientId(authenticatedClientId);
    setCart(mergedCart);
    
    console.log('[CartContext] Fusion terminée, panier mis à jour');
  };

  const value = {
    cart,
    cartCount,
    addToCart,
    removeFromCart,
    updateQuantity,
    clearCart,
    getTotal,
    loadCart,
    mergeAnonToAuthCart,
  };

  return (
    <CartContext.Provider value={value}>
      {children}
    </CartContext.Provider>
  );
};

/**
 * Hook pour accéder au contexte du panier
 * @returns {Object} Le contexte du panier
 * 
 * Utilisation dans un composant :
 * const { cart, cartCount, addToCart } = useCart();
 */
export const useCart = () => {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error('useCart doit être utilisé avec CartProvider');
  }
  return context;
};
