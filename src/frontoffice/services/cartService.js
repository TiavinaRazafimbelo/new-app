/**
 * cartService.js
 * 
 * Gère le panier client stocké dans localStorage
 * ⚠️ IMPORTANT : Chaque client a son propre panier (isolé par clientId)
 * 
 * Clé localStorage : cart_${clientId}
 * Exemple :
 *   - Client anonyme : cart_anon_${uuid} (ex: cart_anon_a1b2c3d4-...)
 *   - Client ID 42 : cart_42
 */

/**
 * Génère la clé localStorage basée sur le clientId
 * @param {string|number} clientId - ID du client ou 'anonymous'
 * @returns {string} Clé pour localStorage
 */
const getStorageKey = (clientId) => {
  return `cart_${clientId || 'anonymous'}`;
};

/**
 * Récupère le panier complet depuis localStorage
 * @param {string|number} clientId - ID du client
 * @returns {Array} Tableau des articles du panier
 */
export const getCart = (clientId) => {
  try {
    const storageKey = getStorageKey(clientId);
    const cart = localStorage.getItem(storageKey);
    return cart ? JSON.parse(cart) : [];
  } catch (error) {
    console.error('Erreur lors de la récupération du panier:', error);
    return [];
  }
};

/**
 * Sauvegarde le panier dans localStorage
 * @param {string|number} clientId - ID du client
 * @param {Array} cartItems - Tableau des articles
 */
const saveCart = (clientId, cartItems) => {
  try {
    const storageKey = getStorageKey(clientId);
    localStorage.setItem(storageKey, JSON.stringify(cartItems));
  } catch (error) {
    console.error('Erreur lors de la sauvegarde du panier:', error);
  }
};

/**
 * Ajoute un article au panier
 * Si le même produit + même combinaison existe → augmente la quantité
 * Sinon → ajoute une nouvelle ligne
 * 
 * @param {string|number} clientId - ID du client
 * @param {Object} item - Article à ajouter
 * @param {number} item.productId - ID du produit
 * @param {number} item.combinationId - ID de la variante (taille, couleur, etc.)
 * @param {number} item.quantity - Quantité à ajouter
 * @param {string} item.name - Nom du produit
 * @param {string} item.image - URL image
 * @param {number} item.price - Prix unitaire
 * @param {number} item.stock - Stock disponible
 */
export const addToCart = (clientId, item) => {
  const cart = getCart(clientId);

  // Cherche si ce produit + combinaison existe déjà
  const existingIndex = cart.findIndex(
    (cartItem) =>
      cartItem.productId === item.productId &&
      cartItem.combinationId === item.combinationId
  );

  if (existingIndex !== -1) {
    // Produit existe → augmente la quantité
    cart[existingIndex].quantity += item.quantity;
  } else {
    // Nouveau produit → l'ajoute
    cart.push(item);
  }

  saveCart(clientId, cart);
  return cart;
};

/**
 * Supprime un article du panier
 * 
 * @param {string|number} clientId - ID du client
 * @param {number} productId - ID du produit
 * @param {number} combinationId - ID de la combinaison
 */
export const removeFromCart = (clientId, productId, combinationId) => {
  let cart = getCart(clientId);

  cart = cart.filter(
    (item) =>
      !(item.productId === productId && item.combinationId === combinationId)
  );

  saveCart(clientId, cart);
  return cart;
};

/**
 * Modifie la quantité d'un article
 * 
 * @param {string|number} clientId - ID du client
 * @param {number} productId - ID du produit
 * @param {number} combinationId - ID de la combinaison
 * @param {number} newQuantity - Nouvelle quantité (si 0 → supprime l'article)
 */
export const updateQuantity = (clientId, productId, combinationId, newQuantity) => {
  let cart = getCart(clientId);

  if (newQuantity <= 0) {
    // Quantité ≤ 0 → supprime l'article
    return removeFromCart(clientId, productId, combinationId);
  }

  // Cherche l'article
  const item = cart.find(
    (cartItem) =>
      cartItem.productId === productId &&
      cartItem.combinationId === combinationId
  );

  if (item) {
    item.quantity = newQuantity;
  }

  saveCart(clientId, cart);
  return cart;
};

/**
 * Vide complètement le panier
 * 
 * @param {string|number} clientId - ID du client
 */
export const clearCart = (clientId) => {
  saveCart(clientId, []);
  return [];
};

/**
 * Calcule le total du panier
 * total = SUM(price * quantity)
 * 
 * @param {string|number} clientId - ID du client
 * @returns {number} Total en euros
 */
export const getCartTotal = (clientId) => {
  const cart = getCart(clientId);
  return cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
};

/**
 * Compte le nombre total d'articles dans le panier
 * 
 * @param {string|number} clientId - ID du client
 * @returns {number} Nombre total d'articles
 */
export const getCartCount = (clientId) => {
  const cart = getCart(clientId);
  return cart.reduce((sum, item) => sum + item.quantity, 0);
};

/**
 * Obtient le nombre de lignes différentes dans le panier
 * 
 * @param {string|number} clientId - ID du client
 * @returns {number} Nombre de lignes
 */
export const getCartLineCount = (clientId) => {
  return getCart(clientId).length;
};

/**
 * Fusionne le panier anonyme avec le panier d'un client authentifié
 * Les articles du panier anonyme sont ajoutés au panier du client
 * Si un article existe dans les deux → les quantités s'ajoutent
 * 
 * @param {string|number} anonClientId - ID du client anonyme (ex: "anon_uuid-...")
 * @param {string|number} authenticatedClientId - ID du client authentifié (ex: client.id)
 * @returns {Array} Le panier fusionné du client authentifié
 */
export const mergeAnonymousCartToAuthenticatedCart = (anonClientId, authenticatedClientId) => {
  const anonCart = getCart(anonClientId);
  const authCart = getCart(authenticatedClientId);
  
  if (anonCart.length === 0) {
    console.log('[cartService] Panier anonyme vide, rien à fusionner');
    return authCart;
  }
  
  let mergedCart = [...authCart];
  
  // Pour chaque article du panier anonyme
  anonCart.forEach((anonItem) => {
    // Cherche si ce même article existe dans le panier authentifié
    const existingIndex = mergedCart.findIndex(
      (authItem) =>
        authItem.productId === anonItem.productId &&
        authItem.combinationId === anonItem.combinationId
    );
    
    if (existingIndex !== -1) {
      // Article existe → additionner les quantités
      console.log(
        `[cartService] Fusion : quantité ${mergedCart[existingIndex].quantity} + ${anonItem.quantity}`
      );
      mergedCart[existingIndex].quantity += anonItem.quantity;
    } else {
      // Article n'existe pas → l'ajouter
      mergedCart.push(anonItem);
    }
  });
  
  // Sauvegarder le panier fusionné pour le client authentifié
  saveCart(authenticatedClientId, mergedCart);
  
  console.log(
    `[cartService] Fusion terminée : ${anonCart.length} articles anonymes → ${mergedCart.length} articles total`
  );
  
  // ⚠️ Supprimer le panier anonyme (optionnel, pour éviter la pollution)
  localStorage.removeItem(getStorageKey(anonClientId));
  console.log(`[cartService] Panier anonyme supprimé (${anonClientId})`);
  
  return mergedCart;
};
