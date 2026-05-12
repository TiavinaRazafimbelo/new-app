# 📚 Documentation - JOUR 1 : Backoffice Base + Structure

> **Date**: May 11, 2026  
> **Version**: 1.0.0  
> **Statut**: ✅ Complété

---

## 📋 Table des Matières

1. [Vue d'ensemble](#vue-densemble)
2. [Architecture](#architecture)
3. [Structure des dossiers](#structure-des-dossiers)
4. [Authentification](#authentification)
5. [Routing & Protection](#routing--protection)
6. [Pages du Backoffice](#pages-du-backoffice)
7. [Comment démarrer](#comment-démarrer)
8. [Prochaines étapes](#prochaines-étapes)

---

## 🎯 Vue d'ensemble

Ce projet est un **frontend React** qui communique avec les **APIs PrestaShop 8.2.6**. 

### Jour 1 - Réalisations:
- ✅ **Authentification** : Login/logout avec credentials (admin/admin par défaut)
- ✅ **Middleware de protection** : Bloque l'accès aux pages backoffice si non connecté
- ✅ **Structure des dossiers** : Organisation claire pour la scalabilité
- ✅ **Pages du Backoffice** : 4 pages de base (Dashboard, Import, Commandes, Reset)
- ✅ **Interface utilisateur** : Design moderne et responsive

---

## 🏗️ Architecture

```
FRONTEND REACT (Vite)
        ↓
    Router (React Router v7)
        ↓
    ┌───────────────────────────────┐
    │      AuthProvider Context     │
    │   (Gère l'authentification)   │
    └───────────────────────────────┘
        ↓
    ┌───────────────────────────────┐
    │     Route Publique (Login)    │
    │   ou ProtectedRoute (Guard)   │
    └───────────────────────────────┘
        ↓
    ┌───────────────────────────────┐
    │  BackofficeLayout Component   │
    │  (Header + Sidebar + Content) │
    └───────────────────────────────┘
        ↓
    Pages Spécifiques
    (Dashboard, Import, etc.)
        ↓
    Services API
    (PrestaShop)
```

### Flux d'authentification:

```
Utilisateur → Login Page → authService.login() 
  ↓
AuthContext.handleLogin()
  ↓
localStorage (credentials)
  ↓
Redirection vers Backoffice ✅
```

---

## 📁 Structure des dossiers

```
src/
├── services/
│   └── authService.js           # 🔐 Service d'authentification PrestaShop
├── contexts/
│   └── AuthContext.jsx          # 🌍 Context React pour l'auth globale
├── components/
│   ├── ProtectedRoute.jsx       # 🛡️ Guard pour protéger les routes
│   ├── BackofficeLayout.jsx     # 📦 Layout principal du backoffice
│   ├── BackofficeLayout.css     # Styles du layout
│   └── ...
├── pages/
│   ├── LoginPage.jsx            # 🔑 Page de connexion
│   ├── LoginPage.css            # Styles login
│   ├── DashboardPage.jsx        # 📊 Tableau de bord
│   ├── DashboardPage.css        # Styles dashboard
│   ├── ImportPage.jsx           # 📥 Page d'import
│   ├── CommandesPage.jsx        # 📋 Gestion des commandes
│   ├── ResetDataPage.jsx        # 🔄 Réinitialisation
│   └── BackofficePage.css       # Styles partagés pages
├── import/                      # 📂 À utiliser pour logique import
├── services/                    # 📂 Services supplémentaires (préparé)
├── workflows/                   # 📂 Workflows complexes (préparé)
├── mapping/                     # 📂 Transformation de données (préparé)
├── controllers/                 # 📂 Logique métier (préparé)
└── App.jsx                      # 🎯 Configuration du routing principal
```

---

## 🔐 Authentification

### Service d'authentification (`services/authService.js`)

**Fonctions disponibles:**

```javascript
// Connexion utilisateur
login(username, password)
// Appelle l'API PrestaShop
// Stocke les credentials dans localStorage
// Retourne les données utilisateur

// Déconnexion
logout()
// Supprime les données de session

// Vérifier si connecté
isAuthenticated()
// Retourne true/false

// Récupérer l'utilisateur actuel
getCurrentUser()
// Retourne l'objet utilisateur ou null
```

**Stockage:**
- `localStorage.prestashop_user` : JSON de l'utilisateur
- `localStorage.prestashop_session` : Credentials en Base64

**⚠️ Sécurité (À améliorer):**
```javascript
// ACTUELLEMENT: Stockage des passwords en localStorage ❌
// À FAIRE: Implémenter JWT tokens ✅ (Jour 2/3)
```

### Context d'authentification (`contexts/AuthContext.jsx`)

**Hook personnalisé:**

```javascript
const { 
  user,              // Objet utilisateur actuel
  isLoading,         // Booléen : chargement en cours
  error,             // Message d'erreur si présent
  login,             // Fonction(username, password)
  logout,            // Fonction()
  isAuthenticated    // Booléen : connecté?
} = useAuth();
```

**Utilisation dans les composants:**

```javascript
import { useAuth } from '../contexts/AuthContext';

function MyComponent() {
  const { user, logout } = useAuth();
  
  return (
    <div>
      <p>Connecté en tant que: {user?.username}</p>
      <button onClick={logout}>Déconnexion</button>
    </div>
  );
}
```

---

## 🛣️ Routing & Protection

### Configuration du Routing (`App.jsx`)

```javascript
<Router>
  <AuthProvider>
    <Routes>
      {/* Public */}
      <Route path="/login" element={<LoginPage />} />

      {/* Protected */}
      <Route path="/backoffice" element={<ProtectedRoute><BackofficeLayout /></ProtectedRoute>}>
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="import" element={<ImportPage />} />
        <Route path="commandes" element={<CommandesPage />} />
        <Route path="reset" element={<ResetDataPage />} />
      </Route>

      {/* Default */}
      <Route path="/" element={<Navigate to="/login" />} />
    </Routes>
  </AuthProvider>
</Router>
```

### ProtectedRoute Guard (`components/ProtectedRoute.jsx`)

```javascript
<ProtectedRoute>
  <MonPage />  {/* Affichée UNIQUEMENT si authentifié */}
</ProtectedRoute>
```

**Comportement:**
- ✅ Utilisateur connecté → Affiche le composant
- ❌ Utilisateur non connecté → Redirection vers `/login`
- ⏳ Chargement en cours → Affiche "Chargement..."

---

## 🖥️ Pages du Backoffice

### 1️⃣ Page de Connexion (`pages/LoginPage.jsx`)

**Fonctionnalités:**
- Formulaire username/password
- Credentials par défaut : `admin` / `admin`
- Gestion des erreurs
- Bouton submit désactivé pendant la connexion

**URL:** `/login`

**Après connexion:** Redirection vers `/backoffice/dashboard`

### 2️⃣ Layout du Backoffice (`components/BackofficeLayout.jsx`)

**Structure:**
```
┌─────────────────────────────────┐
│     Header (Violet/Gradient)    │
│  PrestaShop Admin | 👤 admin    │ <- Logout button
├─────────────┬───────────────────┤
│  Sidebar    │                   │
│  📊 ────    │   Page Content    │
│  📥 ────    │   (Outlet)        │
│  📋 ────    │                   │
│  🔄 ────    │                   │
└─────────────┴───────────────────┘
```

**Navigation:**
- Chaque lien utilise `navigate()` de React Router
- Design responsive (sidebar se réduit sur mobile)

### 3️⃣ Dashboard (`pages/DashboardPage.jsx`)

**Affiche:**
- 4 cartes KPI (Produits, Commandes, Clients, CA)
- Section "Activité récente" (placeholder)

**URL:** `/backoffice/dashboard` (par défaut)

**Prochainement:** Intégration données PrestaShop

### 4️⃣ Page Import (`pages/ImportPage.jsx`)

**Affiche:** Message "En développement"

**URL:** `/backoffice/import`

**Prochainement (Jour 2-3):**
- Upload de fichiers CSV/XML
- Mapping avec produits PrestaShop
- Validation des données

### 5️⃣ Page Commandes (`pages/CommandesPage.jsx`)

**Affiche:** Message "Aucune commande"

**URL:** `/backoffice/commandes`

**Prochainement:**
- Tableau avec les commandes PrestaShop
- Filtres et recherche
- Actions (éditer, supprimer, etc.)

### 6️⃣ Page Reset Data (`pages/ResetDataPage.jsx`)

**Zone dangereuse avec:**
- Confirmation avant reset
- Bouton rouge (warning style)

**URL:** `/backoffice/reset`

**Prochainement:**
- Réinitialisation de la base données
- Logs des actions

---

## 🚀 Comment démarrer

### 1. Installation des dépendances

```bash
cd d:\ITU\S6\eval\new-app
npm install
```

### 2. Configuration (optionnel)

Créer un fichier `.env`:

```env
VITE_PRESTASHOP_API_URL=http://localhost/prestashop/api
```

### 3. Lancer le serveur de développement

```bash
npm run dev
```

**Output:**
```
  VITE v8.0.10  ready in 123 ms

  ➜  Local:   http://localhost:5173/
  ➜  press h to show help
```

### 4. Accéder à l'application

- **Login:** http://localhost:5173/login
- **Credentials par défaut:**
  - Username: `admin`
  - Password: `admin`

### 5. Après connexion

Vous serez redirigé vers: http://localhost:5173/backoffice/dashboard

---

## 📝 Code Commenté

Tous les fichiers contiennent des commentaires détaillés:

```javascript
/**
 * Description courte du fichier
 * Cas d'usage
 */

/**
 * Description de la fonction
 * @param {Type} paramName - Description
 * @returns {Type} Description
 * @example
 * // Exemple d'utilisation
 */
```

---

## 🔄 Flux d'une requête complète

### Scénario: Un utilisateur se connecte

1. **L'utilisateur** arrive sur `/login`
2. **LoginPage** affiche le formulaire
3. **L'utilisateur** tape `admin` et clique "Se connecter"
4. **handleSubmit** appelle `login(username, password)`
5. **authService.login()** fait un appel API à PrestaShop
6. **Réponse réussie** → credentials stockés dans localStorage
7. **AuthContext** met à jour `user` state
8. **App.jsx** détecte que l'utilisateur est connecté
9. **ProtectedRoute** permet d'accéder au backoffice
10. **Redirection** vers `/backoffice/dashboard`
11. **BackofficeLayout** s'affiche avec la navigation

---

## 🎨 Styling

### Couleurs principales:
```css
/* Primary Gradient */
background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);

/* Text */
#333 = Dark (headings)
#666 = Medium (body)
#999 = Light (secondary)

/* Status */
#ff6b6b = Error/Danger (red)
```

### Classes réutilisables:
- `.backoffice-page` : Padding + animation fade-in
- `.empty-state` : Placeholder centered
- `.card` / `.dashboard-card` : Elevation + hover effect

---

## 🔗 Intégration PrestaShop API

**Actuellement:** L'app essaie de se connecter à l'API PrestaShop avec Basic Auth

```javascript
fetch(`${PRESTASHOP_API_URL}/employees`, {
  headers: {
    'Authorization': 'Basic ' + btoa(`${username}:${password}`)
  }
})
```

**À faire (Jour 2-3):**
- [ ] Configurer l'endpoint PrestaShop correct
- [ ] Implémenter JWT tokens
- [ ] Tester avec une instance PrestaShop réelle
- [ ] Gestion d'erreurs API robuste

---

## ✅ Checklist JOUR 1

- [x] Créer page login
- [x] Mettre un login/mot de passe par défaut (admin/admin)
- [x] Créer session utilisateur (localStorage + Context)
- [x] Bloquer accès si non connecté (ProtectedRoute)
- [x] Créer dossiers:
  - [x] `/import`
  - [x] `/services` (avec authService)
  - [x] `/workflows` (préparé)
  - [x] `/mapping` (préparé)
  - [x] `/controllers` (préparé)
- [x] Pages Backoffice UI:
  - [x] Page import
  - [x] Page reset data
  - [x] Page commandes
  - [x] Page dashboard

---

## 📅 Prochaines étapes (JOUR 2)

- [ ] Intégration API PrestaShop réelle
- [ ] Récuperation des produits
- [ ] Récuperation des commandes
- [ ] Service d'import (CSV/XML)
- [ ] Middleware de validation de données

---

## 📞 Support

Pour des questions sur l'architecture ou le code, consultez les commentaires en ligne dans chaque fichier.

**Structure des commentaires JSDoc:**
```javascript
/**
 * @param {type} name - Description
 * @returns {type} Description
 * @example
 * // Exemple d'usage
 */
```

---

**📝 Document créé**: May 11, 2026  
**👤 Auteur**: AI Assistant  
**📦 Version**: 1.0.0
