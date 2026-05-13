# Module Checkout — new-app (PrestaShop Frontoffice)

## Vue d'ensemble

Ce module gère le **tunnel de commande complet** du frontoffice, de la validation du panier jusqu'au suivi de commande.

---

## Architecture générale

```
/cart
  ↓ (bouton "Commander")
  ├── Client connecté → /checkout
  └── Client anonyme → modal 2 choix
        ├── "Se connecter" → /clients → (retour) /checkout
        └── "Commander en guest" → /checkout (guest)

/checkout
  ├── Étape 1 : Vérification / saisie adresse
  ├── Étape 2 : Récapitulatif panier
  ├── Étape 3 : Paiement (uniquement "Paiement à la livraison")
  └── Confirmation → /orders/:orderId

/orders
  └── Suivi de toutes les commandes du client
```

---

## Fichiers créés / modifiés

### Nouveaux fichiers

| Fichier | Rôle |
|---|---|
| `src/frontoffice/services/orderService.js` | Toutes les opérations API PrestaShop (cart, order, stock, adresse) |
| `src/frontoffice/pages/CheckoutPage.jsx` | Tunnel de commande (adresse + paiement) |
| `src/frontoffice/pages/CheckoutPage.css` | Styles de la page checkout |
| `src/frontoffice/pages/OrdersPage.jsx` | Suivi des commandes |
| `src/frontoffice/pages/OrdersPage.css` | Styles de la page suivi |
| `src/frontoffice/components/AnonCheckoutModal.jsx` | Modal "Se connecter ou commander en guest" |
| `src/frontoffice/components/AnonCheckoutModal.css` | Styles du modal |

### Fichiers modifiés

| Fichier | Modifications |
|---|---|
| `src/App.jsx` | Ajout routes `/checkout` et `/orders` |
| `src/frontoffice/pages/CartPage.jsx` | Bouton commander → gestion anonyme |

---

## Flux détaillé

### 1. Client connecté

```
CartPage → handleCheckout()
  → client.anonymous === false
  → navigate('/checkout')

CheckoutPage
  → Étape 1 : récupère adresses du client via PrestaShop API
      → Si adresse existante : pré-remplit le formulaire
      → Si aucune adresse : formulaire vide obligatoire
  → Étape 2 : récapitulatif panier (lecture seule)
  → Étape 3 : bouton "Confirmer la commande"
      → orderService.createFullOrder(...)
          1. Crée un Cart PrestaShop (POST /carts)
          2. Ajoute chaque produit (POST /carts/{id}/update)
          3. Crée l'Order (POST /orders)
          4. Met à jour les stocks
      → navigate('/orders')
```

### 2. Client anonyme

```
CartPage → handleCheckout()
  → client.anonymous === true
  → Ouvre <AnonCheckoutModal>
      ├── "Se connecter" → navigate('/clients', { state: { from: '/checkout' } })
      └── "Commander en guest" → navigate('/checkout', { state: { guest: true } })

CheckoutPage (mode guest)
  → Saisie email + informations personnelles + adresse
  → Même flux de commande ensuite
  → Pas de compte créé (guest = commande sans compte)
```

### 3. Création de commande (orderService)

```javascript
createFullOrder({
  clientId,        // ID PrestaShop du client (ou null si guest)
  guestData,       // { email, firstname, lastname } si guest
  cartItems,       // Articles du panier local
  addressData,     // Adresse de livraison/facturation
  paymentMethod,   // Toujours 'cod' (Cash on Delivery)
})
```

**Étapes internes :**
1. `POST /carts` → crée un panier PrestaShop
2. Pour chaque article : `PUT /carts/{id}` → ajoute le produit
3. `POST /orders` → crée la commande avec `id_order_state` configuré
4. Vide le panier localStorage du client

---

## Configuration de l'état de commande

L'état par défaut est défini dans `orderService.js` via une **constante exportée** :

```javascript
// orderService.js — ligne ~20
export const ORDER_CONFIG = {
  // État par défaut des nouvelles commandes
  // PrestaShop états courants :
  //   1 = En attente de paiement par chèque
  //   2 = Paiement accepté
  //   3 = En cours de préparation
  //   4 = Expédié
  //   5 = Livré
  //   6 = Annulé
  //   7 = Remboursé
  // ⚠️ Modifiable facilement selon les instructions du prof
  DEFAULT_ORDER_STATE: 2,  // Paiement accepté par défaut
  
  // Module de paiement PrestaShop
  PAYMENT_MODULE: 'cod',
  
  // Libellé affiché au client
  PAYMENT_LABEL: 'Paiement à la livraison',
  
  // Frais de livraison (0 selon consigne)
  SHIPPING_COST: 0,
};
```

**Pour changer l'état par défaut** : modifier uniquement `DEFAULT_ORDER_STATE` dans `orderService.js`.

---

## Gestion des stocks

Lors de la création de commande, les stocks sont mis à jour automatiquement :

- **Produit sans combinaison** : `PUT /stock_availables/{id}` avec `quantity - commandée`
- **Produit avec combinaison** : `PUT /stock_availables/{id_combi}` avec `quantity - commandée`

La mise à jour du stock se fait **après** la création de l'order pour éviter les incohérences.

---

## Formulaire d'adresse

Champs requis (conformes PrestaShop) :

| Champ | Obligatoire | Valeur par défaut |
|---|---|---|
| Prénom | ✓ | — |
| Nom | ✓ | — |
| Adresse (ligne 1) | ✓ | — |
| Code postal | ✓ | — |
| Ville | ✓ | — |
| Pays | ✓ | **France** (id_country = 8 dans PrestaShop) |
| Téléphone | ✓ | — |
| Alias | ✓ | "Mon adresse" (pré-rempli) |

Le pays est **toujours France**, affiché en lecture seule dans l'UI.

---

## Page de suivi des commandes (`/orders`)

Affiche pour chaque commande :
- Numéro de commande
- Date
- Montant total
- État (libellé + couleur)
- Détail des articles

Les données sont récupérées via `GET /orders?filter[id_customer]={clientId}&display=full`.

---

## Extensibilité future

Le code est conçu pour s'adapter facilement :

| Évolution possible | Où modifier |
|---|---|
| Changer l'état de commande par défaut | `ORDER_CONFIG.DEFAULT_ORDER_STATE` dans `orderService.js` |
| Ajouter un mode de paiement | Ajouter une option dans `CheckoutPage.jsx` section paiement + passer le module dans `createFullOrder` |
| Ajouter des frais de livraison | `ORDER_CONFIG.SHIPPING_COST` dans `orderService.js` |
| Ajouter d'autres pays | Décommenter le select pays dans `CheckoutPage.jsx` |
| Envoyer un email de confirmation | Hook post-commande dans `orderService.js` après `createFullOrder` |

---

## Routes ajoutées dans App.jsx

```jsx
<Route path="/checkout" element={<CheckoutPage />} />
<Route path="/orders"   element={<OrdersPage />} />
```

---

## Dépendances

Aucune nouvelle dépendance npm. Utilise uniquement :
- React, React Router déjà installés
- `fast-xml-parser` déjà installé
- `productsService.js` existant pour la structure de `prestaFetch`