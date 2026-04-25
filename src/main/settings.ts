import Store from 'electron-store';
import { DEFAULT_API_PORT } from '../shared/constants';

/**
 * Token Tidal extrait du localStorage de la WebView (listen.tidal.com).
 * On le re-lit régulièrement côté main pour rester à jour avec d'éventuels refresh.
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
