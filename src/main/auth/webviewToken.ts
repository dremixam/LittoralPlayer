import { WebContentsView } from 'electron';
import { settings, type PersistedTokens } from '../settings';
import { store } from '../state/store';
import { TIDAL_LOGIN_URL } from '../../shared/constants';

/**
 * Capture du token OAuth Tidal en interceptant les requêtes sortantes de la WebView.
 *
 * Tidal chiffre désormais (AES-GCM) ses credentials dans le localStorage
 * (clés `AuthDB/<uuid>{Key,Salt,Counter,Data}`) → impossible d'extraire en clair.
 *
 * On contourne en regardant le header `Authorization: Bearer …` que la WebView
 * envoie elle-même à `*.tidal.com`. Avantages :
 *   - on suit automatiquement les rotations / refresh transparents,
 *   - c'est exactement le token utilisé par listen.tidal.com (donc scopes corrects).
 */

let lastTokenSeen: string | null = null;
let capturedTidalToken: string | null = null; // X-Tidal-Token (client public)
let captureRegistered = false;

interface JwtPayload {
  uid?: number | string;
  cid?: number | string;
  scope?: string;
  exp?: number;
}

function decodeJwt(token: string): JwtPayload | null {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const json = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    return JSON.parse(json) as JwtPayload;
  } catch {
    return null;
  }
}

function persistToken(accessToken: string): void {
  if (accessToken === lastTokenSeen) return;
  lastTokenSeen = accessToken;
  const decoded = decodeJwt(accessToken);
  const previous = settings.get('tokens');
  const tokens: PersistedTokens = {
    accessToken,
    expiresAt: decoded?.exp ? decoded.exp * 1000 : undefined,
    clientId: decoded?.cid !== undefined ? String(decoded.cid) : previous?.clientId,
    userId: decoded?.uid ?? previous?.userId,
    countryCode: previous?.countryCode,
    sessionId: previous?.sessionId,
  };
  settings.set('tokens', tokens);
  store.setAuth({
    authenticated: true,
    scopes: decoded?.scope ? decoded.scope.split(/\s+/) : [],
    expiresAt: tokens.expiresAt ? new Date(tokens.expiresAt).toISOString() : undefined,
    userId: tokens.userId !== undefined ? String(tokens.userId) : undefined,
    countryCode: tokens.countryCode,
  });
  console.log('[auth] token captured (expires:', tokens.expiresAt ? new Date(tokens.expiresAt).toISOString() : 'unknown', ')');
}

/**
 * Installe l'intercepteur webRequest sur la session de la WebView.
 * Idempotent : appelable plusieurs fois sans risque.
 */
export function startTokenWatcher(view: WebContentsView): void {
  if (!view || view.webContents.isDestroyed()) return;
  if (captureRegistered) return;
  const ses = view.webContents.session;

  ses.webRequest.onBeforeSendHeaders(
    { urls: ['https://*.tidal.com/*', 'https://*.tidalhifi.com/*'] },
    (details, callback) => {
      try {
        const headers = details.requestHeaders;
        const auth = headers['Authorization'] ?? headers['authorization'];
        if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
          const token = auth.slice(7).trim();
          if (token && token !== lastTokenSeen) persistToken(token);
        }
        const xt = headers['X-Tidal-Token'] ?? headers['x-tidal-token'];
        if (typeof xt === 'string' && xt && xt !== capturedTidalToken) {
          capturedTidalToken = xt;
          console.log('[auth] X-Tidal-Token captured');
        }
        try {
          const url = new URL(details.url);
          const cc = url.searchParams.get('countryCode');
          if (cc && /^[A-Z]{2}$/.test(cc)) {
            const cur = settings.get('tokens');
            if (cur && cur.countryCode !== cc) {
              settings.set('tokens', { ...cur, countryCode: cc });
              const auth = store.auth;
              if (auth.authenticated) store.setAuth({ ...auth, countryCode: cc });
            }
          }
        } catch {
          /* ignore URL parse errors */
        }
      } catch (err) {
        console.warn('[auth] webRequest interceptor error:', err);
      }
      callback({ requestHeaders: details.requestHeaders });
    },
  );

  captureRegistered = true;
  console.log('[auth] webRequest token interceptor installed on WebView session');
}

export function stopTokenWatcher(): void {
  // Pas de moyen de désenregistrer un listener webRequest individuel proprement ;
  // on garde le flag pour ne pas réinstaller.
}

export function getCapturedTidalToken(): string | null {
  return capturedTidalToken;
}

/**
 * Rétablit l'état d'auth au démarrage à partir des tokens persistés.
 */
export function bootstrapAuth(): void {
  const tokens = settings.get('tokens');
  if (!tokens?.accessToken) {
    store.setAuth({ authenticated: false });
    return;
  }
  if (tokens.expiresAt && tokens.expiresAt < Date.now()) {
    console.log('[auth] persisted token expired, waiting for fresh capture');
    settings.delete('tokens');
    store.setAuth({ authenticated: false });
    return;
  }
  lastTokenSeen = tokens.accessToken;
  const decoded = decodeJwt(tokens.accessToken);
  store.setAuth({
    authenticated: true,
    scopes: decoded?.scope ? decoded.scope.split(/\s+/) : [],
    expiresAt: tokens.expiresAt ? new Date(tokens.expiresAt).toISOString() : undefined,
    userId: tokens.userId !== undefined ? String(tokens.userId) : undefined,
    countryCode: tokens.countryCode,
  });
}

export function getAccessToken(): string | null {
  const tokens = settings.get('tokens');
  if (!tokens?.accessToken) return null;
  if (tokens.expiresAt && tokens.expiresAt < Date.now()) return null;
  return tokens.accessToken;
}

export function getCountryCode(): string {
  return settings.get('tokens')?.countryCode ?? 'US';
}

/**
 * Force la WebView à afficher la page de login Tidal.
 */
export async function navigateToLogin(view: WebContentsView): Promise<void> {
  if (!view || view.webContents.isDestroyed()) return;
  await view.webContents.loadURL(TIDAL_LOGIN_URL);
}

/**
 * Déconnexion : vide localStorage + cookies + IndexedDB de la session WebView,
 * efface les tokens persistés, et navigue vers la page de login.
 */
export async function logout(view: WebContentsView | null): Promise<void> {
  settings.delete('tokens');
  lastTokenSeen = null;
  store.setAuth({ authenticated: false });
  if (view && !view.webContents.isDestroyed()) {
    try {
      await view.webContents.executeJavaScript('try{localStorage.clear();sessionStorage.clear();}catch(e){}', true);
    } catch {
      /* ignore */
    }
    try {
      await view.webContents.session.clearStorageData({
        storages: ['cookies', 'localstorage', 'indexdb', 'serviceworkers', 'cachestorage'],
      });
    } catch {
      /* ignore */
    }
    await navigateToLogin(view);
  }
}

// Compat : ancienne API gardée comme no-op.
export async function extractOnce(_view: WebContentsView): Promise<PersistedTokens | null> {
  return settings.get('tokens') ?? null;
}
