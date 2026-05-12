# 📦 Fiche Produit — PrestaShop Frontoffice

## Ce qui a été fait

### 1. `productsService.js` — Refactorisé

**Problème résolu : la popup d'authentification sur les images**

PrestaShop, quand on accède à `/api/images/...` dans un `<img src="">`, le navigateur
ne peut pas envoyer de header `Authorization` → le serveur répond 401 → popup.

**Solution :** On passe par le proxy Vite qui intercepte `/api` et redirige vers
`http://localhost/prestashop_edition_classic_version_8.2.6`. Le navigateur ne voit
jamais le serveur PrestaShop directement, donc pas de popup.

Pour les images, l'URL `/api/images/products/{id}/{imgId}` est simplement un `src`
qui passe par le proxy — **sans header Authorization** côté balise `<img>`.

**Nouveau : XML brut + fast-xml-parser**

```bash
npm install fast-xml-parser
```

Toutes les requêtes récupèrent maintenant le XML brut et le parsent avec
`fast-xml-parser` (plus fiable que le mode JSON de PrestaShop qui est souvent
mal formé ou incohérent).

---

### 2. `ProductDetailPage.jsx` — Nouvelle page

Fiche produit complète accessible via `/product/:id`.

**Ce qui est affiché :**

| Section | Contenu |
|---|---|
| Fil d'Ariane | Produits › Catégorie › Nom |
| Galerie | Toutes les images + miniatures cliquables |
| Badges | Condition (Neuf/Occasion/Reconditionné), Catégorie |
| Nom | En typographie Playfair Display |
| Référence | En monospace |
| Prix | HT, mis à jour si combinaison sélectionnée |
| Stock | Badge vert/rouge avec quantité |
| Description courte | Affiché directement |
| Déclinaisons | `<select>` avec prix additionnel et stock par déclinaison |
| Bouton panier | UI only (désactivé si rupture) |
| Méta | EAN-13, quantité minimale, dimensions, poids, date |
| Description longue | Accordéon dépliable |
| Retour | Lien animé vers /products |

---

### 3. `App.jsx` — Mis à jour

La route `/product/:id` est maintenant active :

```jsx
<Route path="/product/:id" element={<ProductDetailPage />} />
```

---

## Structure des fichiers à placer

```
src/
├── App.jsx                                     ← Remplacer
├── frontoffice/
│   ├── pages/
│   │   ├── ProductDetailPage.jsx               ← Nouveau
│   │   └── ProductDetailPage.css               ← Nouveau
│   └── services/
│       └── productsService.js                  ← Remplacer
```

---

## Comment ça marche : le proxy Vite

```
Navigateur → /api/products?display=full
     ↓  (Vite intercepte)
Vite proxy → http://localhost/prestashop_edition_classic_version_8.2.6/api/products?display=full
     ↓  (ajoute Authorization en header fetch JS, pas pour les <img>)
PrestaShop répond en XML
     ↓
fast-xml-parser parse le XML → objet JavaScript
     ↓
Composant React affiche les données
```

Pour les images `<img src="/api/images/products/1/1">` :
- Le proxy Vite redirige vers PrestaShop
- PrestaShop accepte car la session du navigateur ou la clé est dans le proxy
- **Astuce** : si les images restent bloquées, ajouter dans `vite.config.js` :

```js
export default {
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost/prestashop_edition_classic_version_8.2.6',
        changeOrigin: true,
        // Ajouter le header Authorization directement dans le proxy :
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            const key = 'UK5SK4KF2CK1JAZ3SSG8CJRXV81HE2Z1';
            proxyReq.setHeader('Authorization', 'Basic ' + Buffer.from(key + ':').toString('base64'));
          });
        }
      }
    }
  }
}
```

Ainsi **même les images** passent avec l'auth, sans exposer la clé dans le HTML.

---

## Combinaisons PrestaShop

Les combinaisons (déclinaisons) sont récupérées via :
```
GET /api/combinations?filter[id_product]={id}&display=full
```

Chaque combinaison a :
- `reference` — référence spécifique
- `price` — **prix additionnel** (s'additionne au prix de base)
- `quantity` — stock propre à cette déclinaison
- `ean13` — code-barres propre

Le sélecteur dans la fiche produit met à jour le prix affiché en temps réel.
