/**
 * Constantes partagées.
 */

export const TIDAL_WEB_PLAYER_URL = 'https://listen.tidal.com/';
export const TIDAL_LOGIN_URL = 'https://listen.tidal.com/login';

export const DEFAULT_API_PORT = 7143;

export const DEFAULT_CORS_ORIGINS = ['https://twitchat.fr', 'https://beta.twitchat.fr'];

/**
 * Base de l'API Tidal "interne" v1, celle utilisée par listen.tidal.com.
 * On la cible avec le token OAuth extrait du localStorage de la WebView,
 * ce qui évite à l'utilisateur un second login.
 */
export const TIDAL_API_BASE = 'https://api.tidal.com/v1';

/**
 * Resource server pour les images (cover/artist).
 */
export const TIDAL_IMAGE_BASE = 'https://resources.tidal.com/images';

export const IPC_CHANNELS = {
  // Renderer -> Main
  authStart: 'auth:start',
  authLogout: 'auth:logout',
  getApiInfo: 'api:info',
  getAuthStatus: 'auth:status',
  getNowPlaying: 'player:now-playing',
  openExternal: 'shell:open-external',
  getCorsOrigins: 'cors:get',
  addCorsOrigin: 'cors:add',
  removeCorsOrigin: 'cors:remove',
  getCorsAllowAll: 'cors:getAllowAll',
  setCorsAllowAll: 'cors:setAllowAll',
  getCorsAllowFileOrigin: 'cors:getAllowFileOrigin',
  setCorsAllowFileOrigin: 'cors:setAllowFileOrigin',
  openCorsPanel: 'cors:openPanel',
  closeCorsPanel: 'cors:closePanel',
  // Main -> Renderer (push)
  appEvent: 'app:event',
} as const;
