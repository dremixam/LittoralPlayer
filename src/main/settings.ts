import Store from 'electron-store';
import { DEFAULT_API_PORT } from '../shared/constants';

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
  tokens?: PersistedTokens;
}

const defaults: SettingsSchema = {
  apiPort: Number(process.env.TIDAL_API_PORT) || DEFAULT_API_PORT,
};

export const settings = new Store<SettingsSchema>({
  name: 'tidal-custom-player',
  defaults,
});

export function getApiPort(): number {
  return Number(process.env.TIDAL_API_PORT) || settings.get('apiPort');
}
