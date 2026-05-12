/**
 * Layout du Backoffice
 * Contient la navigation et la structure commune à toutes les pages du backoffice
 */

import React from 'react';
import { useNavigate, Outlet } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import './BackofficeLayout.css';

export const BackofficeLayout = () => {
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="backoffice-layout">
      {/* Navigation Header */}
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
        {/* Sidebar Navigation */}
        <aside className="backoffice-sidebar">
          <nav className="sidebar-nav">
            <ul>
              <li>
                <a 
                  href="#" 
                  onClick={(e) => {
                    e.preventDefault();
                    navigate('/backoffice/import');
                  }}
                  className="nav-link"
                >
                  Import
                </a>
              </li>
              <li>
                <a 
                  href="#" 
                  onClick={(e) => {
                    e.preventDefault();
                    navigate('/backoffice/commandes');
                  }}
                  className="nav-link"
                >
                  Commandes
                </a>
              </li>
              <li>
                <a 
                  href="#" 
                  onClick={(e) => {
                    e.preventDefault();
                    navigate('/backoffice/reset');
                  }}
                  className="nav-link"
                >
                  Reset Data
                </a>
              </li>
            </ul>
          </nav>
        </aside>

        {/* Main Content */}
        <main className="backoffice-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default BackofficeLayout;
