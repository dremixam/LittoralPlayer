import Store from 'electron-store';
import { DEFAULT_API_PORT, DEFAULT_CORS_ORIGINS } from '../shared/constants';

/**
 * Token Tidal capturé via `webRequest.onBeforeSendHeaders` sur les requêtes
 * de la WebView vers `*.tidal.com`. Persisté pour survie au redémarrage.
 */
export interface PersistedTokens {
  accessToken: string;
  expiresAt?: number; // epoch ms (si connu)
  clientId?: string;
  userId?: number | string;
  countryCode?: string;
  sessionId?: string;
}

interface SettingsSchema {
  apiPort: number;
  apiHost: string;
  tokens?: PersistedTokens;
  corsOrigins: string[];
  corsAllowAll: boolean;
  corsAllowFileOrigin: boolean;
}

const defaults: SettingsSchema = {
  apiPort: Number(process.env.TIDAL_API_PORT) || DEFAULT_API_PORT,
  apiHost: '127.0.0.1',
  corsOrigins: DEFAULT_CORS_ORIGINS,
  corsAllowAll: false,
  corsAllowFileOrigin: true,
};

export const settings = new Store<SettingsSchema>({
  name: 'tidal-custom-player',
  defaults,
});

export function getApiPort(): number {
  return Number(process.env.TIDAL_API_PORT) || settings.get('apiPort');
}

export function setApiPort(port: number): void {
  settings.set('apiPort', port);
}

export function getApiHost(): string {
  return settings.get('apiHost');
}

export function setApiHost(host: string): void {
  settings.set('apiHost', host);
}

export function getCorsOrigins(): string[] {
  return settings.get('corsOrigins');
}

export function addCorsOrigin(origin: string): string[] {
  const current = settings.get('corsOrigins');
  if (!current.includes(origin)) {
    settings.set('corsOrigins', [...current, origin]);
  }
  return settings.get('corsOrigins');
}

export function removeCorsOrigin(origin: string): string[] {
  const current = settings.get('corsOrigins');
  settings.set('corsOrigins', current.filter(o => o !== origin));
  return settings.get('corsOrigins');
}

export function getCorsAllowAll(): boolean {
  return settings.get('corsAllowAll');
}

export function setCorsAllowAll(value: boolean): void {
  settings.set('corsAllowAll', value);
}

export function getCorsAllowFileOrigin(): boolean {
  return settings.get('corsAllowFileOrigin');
}

export function setCorsAllowFileOrigin(value: boolean): void {
  settings.set('corsAllowFileOrigin', value);
}
