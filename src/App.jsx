/**
 * App.jsx
 * ─────────────────────────────────────────────────────────────
 * Routing principal de l'application PrestaShop (Backoffice + Frontoffice).
 * 
 * MODIFIÉ : Ajout des routes /checkout et /orders
 * ─────────────────────────────────────────────────────────────
 */

import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider }                  from './contexts/AuthContext';
import { FrontofficeClientProvider }     from './frontoffice/contexts/FrontofficeClientContext';
import { CartProvider }                  from './frontoffice/contexts/CartContext';
import ProtectedRoute                    from './backoffice/components/ProtectedRoute';
import LoginPage                         from './backoffice/pages/LoginPage';
import DashboardPage                     from './backoffice/pages/DashboardPage';
import CommandesPage                     from './backoffice/pages/CommandesPage';
import ResetDataPage                     from './backoffice/pages/ResetDataPage';
import BackofficeLayout                  from './backoffice/components/BackofficeLayout';
import ProductsPage                      from './frontoffice/pages/products';
import ProductDetailPage                 from './frontoffice/pages/ProductDetailPage';
import ClientsPage                       from './frontoffice/pages/ClientsPage';
import CartPage                          from './frontoffice/pages/CartPage';
import CheckoutPage                      from './frontoffice/pages/CheckoutPage';   // ← NOUVEAU
import OrdersPage                        from './frontoffice/pages/OrdersPage';     // ← NOUVEAU

import ImportPage from './backoffice/import/ImportPage.jsx';


// import DiagOrderSchema from './frontoffice/pages/DiagOrderSchema';
import DiagStock from './frontoffice/pages/DiagStock';


import './App.css';

function App() {
  return (
    <Router>
      <Routes>

        {/* ─── BACKOFFICE ─────────────────────────────── */}
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
          <Route path="import"     element={<ImportPage />} />
          <Route path="dashboard"  element={<DashboardPage />} />
          <Route path="commandes"  element={<CommandesPage />} />
          <Route path="reset"      element={<ResetDataPage />} />
        </Route>

        {/* ─── FRONTOFFICE ─────────────────────────────── */}
        <Route
          path="/*"
          element={
            <FrontofficeClientProvider>
              <CartProvider>
                <Routes>
                  <Route path="/login"      element={<LoginPage />} />
                  <Route path="/products"   element={<ProductsPage />} />
                  <Route path="/product/:id" element={<ProductDetailPage />} />
                  <Route path="/clients"    element={<ClientsPage />} />
                  <Route path="/cart"       element={<CartPage />} />
                  <Route path="/checkout"   element={<CheckoutPage />} />  {/* ← NOUVEAU */}
                  <Route path="/orders"     element={<OrdersPage />} />    {/* ← NOUVEAU */}

                  
// dans les routes frontoffice :
<Route path="/diag-stock/:id" element={<DiagStock />} />

                  {/* Redirections par défaut */}
                  <Route index element={<Navigate to="/clients" replace />} />
                  <Route path="/" element={<Navigate to="/clients" replace />} />
                  <Route path="*" element={<Navigate to="/clients" replace />} />
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