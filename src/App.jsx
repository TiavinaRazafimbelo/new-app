/**
 * App.jsx
 * ─────────────────────────────────────────────────────────────
 * Routing principal de l'application PrestaShop (Backoffice + Frontoffice).
 * ─────────────────────────────────────────────────────────────
 */

import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider }    from './contexts/AuthContext';
import ProtectedRoute      from './backoffice/components/ProtectedRoute';
import LoginPage           from './backoffice/pages/LoginPage';
import DashboardPage           from './backoffice/pages/DashboardPage';
import ImportPage          from './backoffice/pages/ImportPage';
import CommandesPage       from './backoffice/pages/CommandesPage';
import ResetDataPage       from './backoffice/pages/ResetDataPage';
import BackofficeLayout    from './backoffice/components/BackofficeLayout';
import ProductsPage        from './frontoffice/pages/products';
import ProductDetailPage   from './frontoffice/pages/ProductDetailPage'; // ← Nouvelle page
import ClientsPage   from './frontoffice/pages/ClientsPage'; // ← Nouvelle page
import './App.css';

function App() {
  return (
    <Router>
      <AuthProvider>
        <Routes>

          {/* ─── Routes publiques ─────────────────────────── */}
          <Route path="/login" element={<LoginPage />} />

          {/* ─── Frontoffice ──────────────────────────────── */}
          <Route path="/products"     element={<ProductsPage />} />
          {/* Fiche produit : /product/42 */}
          <Route path="/product/:id"  element={<ProductDetailPage />} />
          <Route path="/clients"  element={<ClientsPage />} />

          {/* ─── Backoffice (protégé) ─────────────────────── */}
          <Route
            path="/backoffice"
            element={
              <ProtectedRoute>
                <BackofficeLayout />
              </ProtectedRoute>
            }
          >
            <Route path="import"    element={<ImportPage />} />
            <Route path="dashboard" element={<DashboardPage />} />
            <Route path="commandes" element={<CommandesPage />} />
            <Route path="reset"     element={<ResetDataPage />} />
            {/* Redirection par défaut backoffice */}
          </Route>

          {/* ─── Redirections par défaut ───────────────────── */}
          <Route index element={<Navigate to="clients" replace />} />
          <Route path="/"  element={<Navigate to="/clients" replace />} />
          <Route path="*"  element={<Navigate to="/clients" replace />} />

        </Routes>
      </AuthProvider>
    </Router>
  );
}

export default App;
