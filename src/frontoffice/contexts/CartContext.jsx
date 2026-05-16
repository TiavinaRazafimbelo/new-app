/**
 * CartContext.jsx — v3
 * ─────────────────────────────────────────────────────────────
 * FIX : plus de doublons de cart à la reconnexion.
 *
 * PROBLÈME v2 :
 *   - Au login, useEffect lançait getActivePsCartId() en arrière-plan (async)
 *   - Si l'user modifiait son panier avant que la réponse arrive,
 *     syncToPrestashop voyait psCartRef=null et créait un nouveau cart
 *   - Race condition → 2 carts créés pour le même client
 *
 * SOLUTION v3 : cartResolutionRef
 *   - Au changement de client, on stocke la promesse de résolution dans cartResolutionRef
 *   - syncToPrestashop ATTEND cette promesse avant d'agir
 *   - resolveActiveCart interroge TOUJOURS PS en base en priorité
 *     (source de vérité) avant de créer quoi que ce soit
 *   - Un cart n'est créé QUE si aucun cart actif n'existe en base
 *
 * RÈGLE MÉTIER :
 *   - 1 seul cart actif par client à la fois
 *   - Un cart devient inactif quand il est converti en order
 *   - clearCart() tente DELETE (PS refusera si lié à une order → ignoré)
 * ─────────────────────────────────────────────────────────────
 */

import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import {
  getCart,
  addToCart         as addToCartLocal,
  removeFromCart    as removeFromCartLocal,
  updateQuantity    as updateQuantityLocal,
  clearCart         as clearCartLocal,
  getCartTotal,
  getCartCount,
  mergeAnonymousCartToAuthenticatedCart,
} from '../services/cartService';
import {
  createPsCart,
  updatePsCartRows,
  deletePsCart,
  getActivePsCartId,
} from '../services/cartApiService';
import { useFrontofficeClient } from './FrontofficeClientContext';

const CartContext = createContext();

const psCartKey = (clientId) => `ps_cart_id_${clientId}`;

export const CartProvider = ({ children }) => {
  const { client } = useFrontofficeClient();

  const [cart,      setCart]      = useState([]);
  const [cartCount, setCartCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncError, setSyncError] = useState(null);

  const psCartRef         = useRef(null);   // { cartId, secureKey, addressId }
  const syncQueueRef      = useRef(null);   // timeout debounce
  const cartResolutionRef = useRef(null);   // Promise<cartId|null> en cours

  // ── Helpers ────────────────────────────────────────────────

  const getClientId = useCallback(() => {
    if (!client) return 'anonymous';
    if (client.anonymous) return `anon_${client.anonSessionId || 'guest'}`;
    return client.id || 'anonymous';
  }, [client]);

  const isConnected = useCallback(() => {
    return !!(client && !client.anonymous && client.id);
  }, [client]);

  /**
   * Récupère la secure_key via regex sur le XML brut (pas de dépendance à XMLParser).
   * Mise en cache dans psCartRef.secureKey.
   */
  const fetchSecureKey = useCallback(async (customerId) => {
    if (psCartRef.current?.secureKey) return psCartRef.current.secureKey;
    try {
      const res   = await fetch(`/api/customers/${customerId}`, {
        headers: {
          Authorization: 'Basic ' + btoa(`${import.meta.env.VITE_PRESTA_API_KEY}:`),
          Accept:        'application/xml',
        },
      });
      const xml   = await res.text();
      const match = xml.match(/<secure_key[^>]*>(?:<!\[CDATA\[)?([a-f0-9]{32})(?:\]\]>)?<\/secure_key>/);
      const sk    = match?.[1] || '';
      if (sk && psCartRef.current) psCartRef.current.secureKey = sk;
      return sk;
    } catch {
      return '';
    }
  }, []);

  /**
   * SOURCE DE VÉRITÉ : résout le cartId actif pour un client connecté.
   *
   * Priorité :
   *   1. Cart actif en base PS non lié à une order   → réutiliser
   *   2. Aucun cart actif + panier vide              → rien à faire
   *   3. Aucun cart actif + panier non vide          → créer un nouveau cart
   *
   * Appelé UNE SEULE FOIS par changement de client (useEffect).
   * syncToPrestashop attend cette promesse via cartResolutionRef.
   *
   * @returns {Promise<number|null>}
   */
  const resolveActiveCart = useCallback(async (clientId, customerId, items) => {
    setIsSyncing(true);
    try {
      const activeId = await getActivePsCartId(customerId);

      if (activeId) {
        // Cart actif trouvé en base → réutiliser, jamais recréer
        psCartRef.current = { cartId: activeId, secureKey: null, addressId: null };
        localStorage.setItem(psCartKey(clientId), String(activeId));
        console.log('[CartContext] Cart PS actif retrouvé :', activeId);

        // Synchroniser les articles locaux sur ce cart si nécessaire
        if (items.length > 0) {
          const sk = await fetchSecureKey(customerId);
          if (sk) {
            await updatePsCartRows(activeId, customerId, items, sk, 0);
          }
        }
        return activeId;
      }

      // Aucun cart actif en base
      if (items.length === 0) {
        // Panier vide → pas de cart à créer
        localStorage.removeItem(psCartKey(clientId));
        psCartRef.current = null;
        return null;
      }

      // Panier non vide → créer un cart
      console.log('[CartContext] Création nouveau cart PS…');
      const meta = await createPsCart(customerId);
      psCartRef.current = meta;
      localStorage.setItem(psCartKey(clientId), String(meta.cartId));
      await updatePsCartRows(meta.cartId, customerId, items, meta.secureKey, meta.addressId || 0);
      console.log('[CartContext] Cart PS créé :', meta.cartId);
      return meta.cartId;

    } catch (err) {
      console.error('[CartContext] resolveActiveCart échec :', err.message);
      setSyncError(err.message);
      return null;
    } finally {
      setIsSyncing(false);
    }
  }, [fetchSecureKey]);

  // ── Chargement au changement de client ─────────────────────
  useEffect(() => {
    const clientId = getClientId();
    const stored   = getCart(clientId);

    setCart(stored);
    setCartCount(getCartCount(clientId));
    setSyncError(null);
    psCartRef.current = null;       // reset mémoire
    cartResolutionRef.current = null;

    if (!isConnected()) return;     // anonyme → rien à faire côté PS

    // Lance la résolution et stocke la promesse pour que syncToPrestashop puisse l'attendre
    cartResolutionRef.current = resolveActiveCart(clientId, client.id, stored);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);

  // ── Badge count ────────────────────────────────────────────
  useEffect(() => {
    setCartCount(getCartCount(getClientId()));
  }, [cart, getClientId]);

  // ── Synchro PS (debounce 300ms) ────────────────────────────
  const syncToPrestashop = useCallback((clientId, updatedCart) => {
    if (!isConnected()) return;

    clearTimeout(syncQueueRef.current);
    syncQueueRef.current = setTimeout(async () => {
      setIsSyncing(true);
      setSyncError(null);
      try {
        // ATTENDRE la résolution initiale du cart avant d'agir
        // Élimine la race condition login → modification rapide
        if (cartResolutionRef.current) {
          await cartResolutionRef.current;
          cartResolutionRef.current = null;
        }

        // Après résolution, psCartRef est fiable
        if (!psCartRef.current?.cartId) {
          if (updatedCart.length === 0) {
            // Panier vidé sans cart existant → rien à faire
            return;
          }
          // Double vérification en base (sécurité contre les appels concurrents)
          const activeId = await getActivePsCartId(client.id);
          if (activeId) {
            psCartRef.current = { cartId: activeId, secureKey: null, addressId: null };
            localStorage.setItem(psCartKey(clientId), String(activeId));
            console.log('[CartContext] Cart PS retrouvé (double vérif) :', activeId);
          } else {
            const meta = await createPsCart(client.id);
            psCartRef.current = meta;
            localStorage.setItem(psCartKey(clientId), String(meta.cartId));
            console.log('[CartContext] Cart PS créé (sync) :', meta.cartId);
          }
        }

        const { cartId, addressId } = psCartRef.current;
        const sk = await fetchSecureKey(client.id);
        if (!sk) {
          console.warn('[CartContext] secure_key introuvable, synchro abandonnée');
          return;
        }

        await updatePsCartRows(cartId, client.id, updatedCart, sk, addressId || 0);
        setSyncError(null);

      } catch (err) {
        console.error('[CartContext] syncToPrestashop échec :', err.message);
        setSyncError(err.message);
      } finally {
        setIsSyncing(false);
      }
    }, 300);
  }, [client, isConnected, fetchSecureKey]);

  // ── Actions panier ─────────────────────────────────────────

  const addToCart = useCallback((item) => {
    const clientId    = getClientId();
    const updatedCart = addToCartLocal(clientId, item);
    setCart(updatedCart);
    syncToPrestashop(clientId, updatedCart);
  }, [getClientId, syncToPrestashop]);

  const removeFromCart = useCallback((productId, combinationId) => {
    const clientId    = getClientId();
    const updatedCart = removeFromCartLocal(clientId, productId, combinationId);
    setCart(updatedCart);
    syncToPrestashop(clientId, updatedCart);
  }, [getClientId, syncToPrestashop]);

  const updateQuantity = useCallback((productId, combinationId, newQty) => {
    const clientId    = getClientId();
    const updatedCart = updateQuantityLocal(clientId, productId, combinationId, newQty);
    setCart(updatedCart);
    syncToPrestashop(clientId, updatedCart);
  }, [getClientId, syncToPrestashop]);

  const clearCart = useCallback(() => {
    const clientId = getClientId();
    clearCartLocal(clientId);
    setCart([]);

    if (isConnected() && psCartRef.current?.cartId) {
      // PS refusera si le cart est lié à une order → ignoré silencieusement
      deletePsCart(psCartRef.current.cartId).catch(() => {});
      localStorage.removeItem(psCartKey(clientId));
      psCartRef.current = null;
    }
  }, [getClientId, isConnected]);

  const loadCart = useCallback(() => {
    setCart(getCart(getClientId()));
  }, [getClientId]);

  const getTotal = useCallback(() => {
    return getCartTotal(getClientId());
  }, [getClientId]);

  const mergeAnonToAuthCart = useCallback(async (anonClientId, authenticatedClientId) => {
    const mergedCart = mergeAnonymousCartToAuthenticatedCart(anonClientId, authenticatedClientId);
    setCart(mergedCart);
    if (isConnected()) {
      syncToPrestashop(String(authenticatedClientId), mergedCart);
    }
  }, [isConnected, syncToPrestashop]);

  // ── Valeur exposée ─────────────────────────────────────────

  const value = {
    cart,
    cartCount,
    isSyncing,
    syncError,
    psCartId: psCartRef.current?.cartId ?? null,
    getPsCartId: () => psCartRef.current?.cartId ?? null,
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

export const useCart = () => {
  const context = useContext(CartContext);
  if (!context) throw new Error('useCart doit être utilisé avec CartProvider');
  return context;
};

export const useCartContext = useCart;