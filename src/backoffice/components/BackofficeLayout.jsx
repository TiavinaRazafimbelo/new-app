/**
 * BackofficeLayout.jsx
 * ─────────────────────────────────────────────────────────────
 * Layout du Backoffice.
 * Contient la navigation latérale et la structure commune.
 *
 * MODIFICATION v2 :
 *   - Ajout du lien "Tableau de bord" en haut de la sidebar
 *   - Utilisation de NavLink (react-router-dom) à la place de <a>
 *     pour mettre en surbrillance automatiquement la page active
 * ─────────────────────────────────────────────────────────────
 */

import React from 'react';
import { useNavigate, Outlet, NavLink } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import './BackofficeLayout.css';

/**
 * Liens de navigation de la sidebar.
 * On les déclare ici pour faciliter l'ajout de nouveaux liens.
 */
const NAV_LIENS = [
  { path: '/backoffice/dashboard', label: 'Tableau de bord', icone: '' },
  { path: '/backoffice/commandes', label: 'Commandes',        icone: '' },
  { path: '/backoffice/stock',     label: 'Stock',            icone: '' },
  { path: '/backoffice/import',    label: 'Import',           icone: '' },
  { path: '/backoffice/reset',     label: 'Reset Data',       icone: '' },
];

export const BackofficeLayout = () => {
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="backoffice-layout">

      {/* ─── Header ──────────────────────────────────────── */}
      <header className="backoffice-header">
        <div className="header-left">
          <h1>PrestaShop Admin</h1>
        </div>
        <div className="header-right">
          <span className="user-info">{user?.username}</span>
          <button onClick={handleLogout} className="logout-btn">
            Déconnexion
          </button>
        </div>
      </header>

      <div className="backoffice-container">

        {/* ─── Sidebar ─────────────────────────────────────── */}
        <aside className="backoffice-sidebar">
          <nav className="sidebar-nav">
            <ul>
              {NAV_LIENS.map(({ path, label, icone }) => (
                <li key={path}>
                  {/*
                   * NavLink ajoute automatiquement la classe "active"
                   * quand l'URL correspond — pratique pour le style CSS
                   * de la page sélectionnée.
                   */}
                  <NavLink
                    to={path}
                    className={({ isActive }) =>
                      `nav-link ${isActive ? 'nav-link--active' : ''}`
                    }
                  >
                    <span className="nav-link__icone">{icone}</span>
                    {label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
        </aside>

        {/* ─── Contenu principal ───────────────────────────── */}
        <main className="backoffice-content">
          <Outlet />
        </main>

      </div>
    </div>
  );
};

export default BackofficeLayout;