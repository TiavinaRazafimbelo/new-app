/**
 * Service d'authentification pour PrestaShop
 * Gère l'authentification avec des données en dur (hardcodées)
 * Stocke les credentials dans localStorage
 */

// Credentials par défaut - EN DUR
const HARDCODED_USERS = {
  'admin': 'admin',
  'user': 'user123',
  'moderator': 'mod456'
};

/**
 * Récupère les credentials stockés localement
 * @returns {Object|null} L'objet utilisateur ou null
 */
export const getStoredCredentials = () => {
  const stored = localStorage.getItem('prestashop_user');
  return stored ? JSON.parse(stored) : null;
};

/**
 * Connexion à PrestaShop (données hardcodées)
 * @param {string} username - Nom d'utilisateur
 * @param {string} password - Mot de passe
 * @returns {Promise<Object>} Les données utilisateur
 */
export const login = async (username, password) => {
  try {
    // Vérification des credentials EN DUR
    if (!HARDCODED_USERS[username] || HARDCODED_USERS[username] !== password) {
      throw new Error('Identifiants invalides');
    }

    const userData = {
      username,
      role: username === 'admin' ? 'administrator' : 'user',
      loginTime: new Date().toISOString(),
    };

    // Stockage sécurisé dans localStorage
    localStorage.setItem('prestashop_user', JSON.stringify(userData));
    localStorage.setItem('prestashop_session', btoa(username));

    return userData;
  } catch (error) {
    console.error('Erreur lors de la connexion:', error);
    throw new Error(error.message || 'Erreur de connexion');
  }
};

/**
 * Déconnexion - Supprime les données de session
 */
export const logout = () => {
  localStorage.removeItem('prestashop_user');
  localStorage.removeItem('prestashop_session');
};

/**
 * Vérifie si l'utilisateur est connecté
 * @returns {boolean}
 */
export const isAuthenticated = () => {
  return getStoredCredentials() !== null;
};

/**
 * Récupère l'utilisateur actuellement connecté
 * @returns {Object|null}
 */
export const getCurrentUser = () => {
  return getStoredCredentials();
};
