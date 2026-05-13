/**
 * anonSessionUtil.js
 * ─────────────────────────────────────────────────────────────
 * Gère la session anonyme persistante avec UUID unique
 * 
 * Chaque visiteur anonyme reçoit un UUID unique stocké en localStorage
 * pour que sa session soit persistante et reconnaissable
 * ─────────────────────────────────────────────────────────────
 */

const ANON_SESSION_KEY = 'anon_session_id';

/**
 * Génère un UUID v4 simple
 * @returns {string} UUID unique (ex: "abc123def-456-789...")
 */
const generateUUID = () => {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

/**
 * Récupère ou crée l'UUID de session anonyme
 * @returns {string} UUID de session (créé s'il n'existe pas)
 */
export const getOrCreateAnonSessionId = () => {
  let sessionId = localStorage.getItem(ANON_SESSION_KEY);
  
  if (!sessionId) {
    // Créer un nouvel UUID
    sessionId = generateUUID();
    localStorage.setItem(ANON_SESSION_KEY, sessionId);
    console.log('[anonSessionUtil] Nouvelle session anonyme créée :', sessionId);
  } else {
    console.log('[anonSessionUtil] Session anonyme retrouvée :', sessionId);
  }
  
  return sessionId;
};

/**
 * Récupère l'UUID de session anonyme actuel (sans le créer)
 * @returns {string|null} UUID de session ou null s'il n'existe pas
 */
export const getAnonSessionId = () => {
  return localStorage.getItem(ANON_SESSION_KEY);
};

/**
 * Supprime la session anonyme (ex: lors d'une connexion authentifiée)
 */
export const clearAnonSession = () => {
  localStorage.removeItem(ANON_SESSION_KEY);
  console.log('[anonSessionUtil] Session anonyme supprimée');
};

export default {
  getOrCreateAnonSessionId,
  getAnonSessionId,
  clearAnonSession,
};
