/**
 * App.jsx
 * ─────────────────────────────────────────────────────────────
 * Routing principal de l'application PrestaShop (Backoffice + Frontoffice).
 *
 * MODIFICATION v3 :
 *   - Import CSV structuré par type :
 *       /backoffice/import/produits      ← CSV 1 (actif)
 *       /backoffice/import/combinaisons  ← CSV 2 (à venir)
 *       /backoffice/import/commandes     ← CSV 3 (à venir)
 *       /backoffice/import/images        ← ZIP   (à venir)
 *   - /backoffice/import redirige vers /backoffice/import/produits
 * ─────────────────────────────────────────────────────────────
 */

import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';

// ── Contextes ─────────────────────────────────────────────────
import { AuthProvider }              from './contexts/AuthContext';
import { FrontofficeClientProvider } from './frontoffice/contexts/FrontofficeClientContext';
import { CartProvider }              from './frontoffice/contexts/CartContext';

// ── Backoffice : structure ────────────────────────────────────
import ProtectedRoute    from './backoffice/components/ProtectedRoute';
import BackofficeLayout  from './backoffice/components/BackofficeLayout';

// ── Backoffice : pages principales ───────────────────────────
import LoginPage      from './backoffice/pages/LoginPage';
import DashboardPage  from './backoffice/pages/DashboardPage';
import CommandesPage  from './backoffice/pages/CommandesPage';
import StockPage      from './backoffice/pages/StockPage';
import ResetDataPage  from './backoffice/pages/ResetDataPage';

// ── Backoffice : imports CSV ──────────────────────────────────
// Chaque CSV a sa propre page dédiée dans src/backoffice/import/ui/
import ImportProductsPage from './backoffice/import/ui/ImportProductsPage';
import ImportCombinationsPage from './backoffice/import/ui/ImportCombinationsPage'; // CSV 2 — à venir
import ImportOrdersPage       from './backoffice/import/ui/ImportOrdersPage';       // CSV 3 — à venir
import ImportImagesPage        from './backoffice/import/ui/ImportImagesPage';       // ZIP   — à venir

// ── Frontoffice : pages ───────────────────────────────────────
import ProductsPage      from './frontoffice/pages/products';
import ProductDetailPage from './frontoffice/pages/ProductDetailPage';
import ClientsPage       from './frontoffice/pages/ClientsPage';
import CartPage          from './frontoffice/pages/CartPage';
import CheckoutPage      from './frontoffice/pages/CheckoutPage';
import OrdersPage        from './frontoffice/pages/OrdersPage';

import DiagOrderSchema from './frontoffice/pages/DiagOrderSchema';

import './App.css';
import StatistiquesPage from './backoffice/pages/StatistiquesPage';

function App() {
  return (
    <Router>
      <Routes>

        {/* ═══════════════════════════════════════════════════
            BACKOFFICE
            Toutes les routes sous /backoffice/* sont protégées
            et s'affichent dans BackofficeLayout (sidebar + header).
        ════════════════════════════════════════════════════ */}
        <Route
          path="/backoffice/*"
          element={
            <AuthProvider>
              <ProtectedRoute>
                <BackofficeLayout />
              </ProtectedRoute>
            </AuthProvider>
          }
        >
          {/* Pages principales */}
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="commandes" element={<CommandesPage />} />
          <Route path="stock"     element={<StockPage />} />
          <Route path="statistiques"     element={<StatistiquesPage />} />
          <Route path="reset"     element={<ResetDataPage />} />

          {/* ── Import CSV ────────────────────────────────────
              /backoffice/import            → redirige vers produits
              /backoffice/import/produits   → CSV 1 (actif)
              /backoffice/import/combinaisons → CSV 2 (à venir)
              /backoffice/import/commandes    → CSV 3 (à venir)
              /backoffice/import/images       → ZIP   (à venir)
          ──────────────────────────────────────────────────── */}
          <Route
            path="import"
            element={<Navigate to="/backoffice/import/produits" replace />}
          />
          <Route path="import/produits"     element={<ImportProductsPage />} />
          
          <Route path="import/combinaisons" element={<ImportCombinationsPage />} />
          <Route path="import/commandes"    element={<ImportOrdersPage />} />
          <Route path="import/images"       element={<ImportImagesPage />} />

          {/* Fallback backoffice */}
          <Route index element={<Navigate to="/backoffice/dashboard" replace />} />
        </Route>

        {/* ═══════════════════════════════════════════════════
            FRONTOFFICE
        ════════════════════════════════════════════════════ */}
        <Route
          path="/*"
          element={
            <FrontofficeClientProvider>
              <CartProvider>
                <Routes>
                  <Route path="/login"       element={<LoginPage />} />
                  <Route path="/products"    element={<ProductsPage />} />
                  <Route path="/product/:id" element={<ProductDetailPage />} />
                  <Route path="/clients"     element={<ClientsPage />} />
                  <Route path="/cart"        element={<CartPage />} />
                  <Route path="/checkout"    element={<CheckoutPage />} />
                  <Route path="/orders"      element={<OrdersPage />} />

                  <Route path="/diag-order-schema"      element={<DiagOrderSchema />} />

                  {/* Redirections par défaut */}
                  <Route index element={<Navigate to="/clients" replace />} />
                  <Route path="/"    element={<Navigate to="/clients" replace />} />
                  <Route path="*"    element={<Navigate to="/clients" replace />} />
                </Routes>
              </CartProvider>
            </FrontofficeClientProvider>
          }
        />

      </Routes>
    </Router>
  );
}

export default App;