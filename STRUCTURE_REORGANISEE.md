# 📁 Structure du Projet Réorganisée

> **Date**: May 11, 2026  
> **Version**: 2.0.0  
> **Mise à jour**: Réorganisation Backoffice/Frontoffice

---

## 🏗️ Nouvelle Architecture

Le projet est maintenant organisé en deux domaines principaux: **backoffice** et **frontoffice**, avec des éléments partagés.

```
src/
├── 📂 shared/             (Contextes et services partagés)
│   ├── contexts/
│   │   └── AuthContext.jsx
│   └── services/
│       └── authService.js
│
├── 📂 backoffice/         (Administration et gestion)
│   ├── components/
│   │   ├── BackofficeLayout.jsx
│   │   ├── BackofficeLayout.css
│   │   └── ProtectedRoute.jsx
│   │
│   ├── pages/
│   │   ├── LoginPage.jsx
│   │   ├── LoginPage.css
│   │   ├── DashboardPage.jsx
│   │   ├── DashboardPage.css
│   │   ├── ImportPage.jsx
│   │   ├── CommandesPage.jsx
│   │   ├── ResetDataPage.jsx
│   │   └── BackofficePage.css
│   │
│   ├── services/          (Services spécifiques backoffice)
│   │
│   ├── import/            (Logique d'import de données)
│   ├── workflows/         (Workflows complexes)
│   ├── mapping/           (Transformation de données)
│   └── controllers/       (Logique métier)
│
├── 📂 frontoffice/        (Partie client/shop)
│   ├── pages/
│   ├── components/
│   └── services/
│
├── contexts/              (Contextes partagés)
│   └── AuthContext.jsx
│
├── services/              (Services partagés)
│   └── authService.js
│
├── App.jsx                (Routing principal)
├── main.jsx
└── ...
```

---

## 🔄 Changements Effectués

### 1️⃣ Fichiers Déplacés vers `backoffice/pages/`
```
pages/
├── LoginPage.jsx              ✅ Déplacé
├── LoginPage.css              ✅ Déplacé
├── DashboardPage.jsx          ✅ Déplacé
├── DashboardPage.css          ✅ Déplacé
├── ImportPage.jsx             ✅ Déplacé
├── CommandesPage.jsx          ✅ Déplacé
├── ResetDataPage.jsx          ✅ Déplacé
└── BackofficePage.css         ✅ Déplacé
```

### 2️⃣ Fichiers Déplacés vers `backoffice/components/`
```
components/
├── BackofficeLayout.jsx       ✅ Déplacé
├── BackofficeLayout.css       ✅ Déplacé
└── ProtectedRoute.jsx         ✅ Déplacé
```

### 3️⃣ Dossiers Déplacés vers `backoffice/`
```
backoffice/
├── import/                    ✅ Déplacé
├── workflows/                 ✅ Déplacé
├── mapping/                   ✅ Déplacé
└── controllers/               ✅ Déplacé
```

### 4️⃣ Imports Mis à Jour dans `App.jsx`
```javascript
// AVANT
import ProtectedRoute from './components/ProtectedRoute';
import LoginPage from './pages/LoginPage';

// APRÈS
import ProtectedRoute from './backoffice/components/ProtectedRoute';
import LoginPage from './backoffice/pages/LoginPage';
```

### 5️⃣ Imports Mis à Jour dans les Fichiers Backoffice
```javascript
// AVANT
import { useAuth } from '../contexts/AuthContext';

// APRÈS
import { useAuth } from '../../contexts/AuthContext';
```

---

## 📚 Avantages de cette Structure

### ✅ **Séparation claire**
- Backoffice et Frontoffice sont maintenant isolés
- Facilite la maintenance et les évolutions

### ✅ **Scalabilité**
- Chaque domaine peut grandir indépendamment
- Services spécifiques par domaine

### ✅ **Réutilisabilité**
- Contextes et services partagés au niveau racine
- Pas de duplication

### ✅ **Organisation logique**
- Import, workflows, mapping, controllers regroupés
- Structure métier cohérente

### ✅ **Modularité**
- Facile de créer un frontoffice sans toucher au backoffice
- Chaque domaine a son propre style

---

## 🔗 Chemins d'Importation

### Depuis un fichier Backoffice vers Contexte Partagé

**Fichier:** `src/backoffice/pages/LoginPage.jsx`

```javascript
// ✅ Correct
import { useAuth } from '../../contexts/AuthContext';

// ❌ Incorrect (ancien chemin)
import { useAuth } from '../contexts/AuthContext';
```

### Depuis un fichier Backoffice vers Service Partagé

**Fichier:** `src/backoffice/services/someService.js`

```javascript
// ✅ Correct
import * as authService from '../../services/authService';
```

### Depuis un fichier Frontoffice vers Contexte Partagé

**Fichier:** `src/frontoffice/pages/HomePage.jsx`

```javascript
// ✅ Correct (même niveau up)
import { useAuth } from '../../contexts/AuthContext';
```

---

## 📋 Checklist de Vérification

- [x] Dossiers `backoffice` et `frontoffice` créés
- [x] Pages déplacées dans `backoffice/pages/`
- [x] Composants déplacés dans `backoffice/components/`
- [x] Dossiers spécifiques (`import/`, `workflows/`, etc.) déplacés
- [x] Contextes restent à la racine (partagés)
- [x] Services restent à la racine (partagés)
- [x] Imports dans `App.jsx` mis à jour
- [x] Imports dans les fichiers backoffice mis à jour

---

## 🚀 Prochaines Étapes (Frontoffice)

Pour le **frontoffice**, vous voudrez créer:

```
src/frontoffice/
├── pages/
│   ├── HomePage.jsx
│   ├── ProductPage.jsx
│   ├── CartPage.jsx
│   └── CheckoutPage.jsx
│
├── components/
│   ├── Header.jsx
│   ├── Footer.jsx
│   ├── ProductCard.jsx
│   └── Cart.jsx
│
└── services/
    └── productService.js
```

---

## 💡 Exemple d'Intégration

### Créer un Service Spécifique au Backoffice

**Fichier:** `src/backoffice/services/importService.js`

```javascript
// Importer depuis les services partagés si nécessaire
import * as authService from '../../services/authService';

/**
 * Service d'import pour le backoffice
 */
export const importProducts = async (data) => {
  // Logique d'import
};
```

### Utiliser dans une Page Backoffice

**Fichier:** `src/backoffice/pages/ImportPage.jsx`

```javascript
import { useAuth } from '../../contexts/AuthContext';
import * as importService from '../services/importService';

export const ImportPage = () => {
  const { user } = useAuth();
  
  const handleImport = async () => {
    const result = await importService.importProducts(data);
  };
};
```

---

## 📞 Navigation dans la Codebase

### Depuis le Backoffice
- **Vers contexte partagé:** `../../contexts/`
- **Vers service partagé:** `../../services/`
- **Vers autre page backoffice:** `../NomPage.jsx`
- **Vers autre composant backoffice:** `../components/NomComponent.jsx`

### Depuis le Frontoffice
- **Vers contexte partagé:** `../../contexts/`
- **Vers service partagé:** `../../services/`
- **Vers autre page frontoffice:** `../NomPage.jsx`
- **Vers autre composant frontoffice:** `../components/NomComponent.jsx`

---

## ✨ Notes Importantes

### 1. Pas d'Import Cross-Domain
**❌ Ne pas faire:**
```javascript
// Dans src/backoffice/pages/
import SomethingFromFrontoffice from '../../frontoffice/pages/';
```

**✅ À la place, utiliser les contextes partagés:**
```javascript
// Utiliser le contexte partagé
import { useAuth } from '../../contexts/AuthContext';
```

### 2. Services Spécifiques
Chaque domaine peut avoir ses propres services dans `{domaine}/services/`.

**Exemple:**
- `src/backoffice/services/importService.js`
- `src/frontoffice/services/cartService.js`

### 3. Maintenir la Cohérence
Tous les fichiers d'un même domaine doivent suivre la même structure.

---

## 📊 Statistiques Projet

| Élément | Nombre |
|---------|--------|
| Pages Backoffice | 6 |
| Composants Backoffice | 2 |
| Contextes Partagés | 1 |
| Services Partagés | 1 |
| Dossiers Backoffice | 7 |
| Dossiers Frontoffice | 3 |

---

**✅ Réorganisation complétée avec succès!**

**Prochaine étape:** Développer le frontoffice ou intégrer l'API PrestaShop 🚀

---

*Document créé le May 11, 2026*
