/**
 * Modèles internes partagés entre le main, le preload et le renderer.
 * Les types HTTP de l'API publique sont générés depuis OpenAPI dans `api-types.ts`.
 */

export type PlaybackState = 'idle' | 'playing' | 'paused' | 'buffering';
export type RepeatMode = 'off' | 'one' | 'all';

export interface Artist {
  id: string;
  name: string;
  pictureUrl?: string;
}

export interface AlbumRef {
  id: string;
  title: string;
  coverUrl?: string;
}

export interface Track {
  id: string;
  title: string;
  artists: Artist[];
  album?: AlbumRef;
  durationSeconds: number;
  isrc?: string;
  explicit?: boolean;
  coverUrl?: string;
  url?: string;
}

export interface NowPlaying {
  state: PlaybackState;
  track?: Track;
  positionSeconds?: number;
  durationSeconds?: number;
  volume?: number;
  shuffle?: boolean;
  repeat?: RepeatMode;
  updatedAt: string;
}

export interface QueueItem {
  id: string;
  trackId: string;
  addedAt: string;
  track?: Track;
}

export interface Queue {
  items: QueueItem[];
}

export interface AuthStatus {
  authenticated: boolean;
  scopes?: string[];
  expiresAt?: string;
  userId?: string;
  countryCode?: string;
}

export type AppEvent =
  // Émis uniquement lors d'un changement de piste (track.id différent).
  // Le payload contient les infos de la nouvelle piste — pas de state ici.
  | { type: 'now-playing'; timestamp: string; payload: { track?: Track } }
  // Émis uniquement lors d'un changement d'état du playback (play <-> pause).
  | { type: 'playback-state'; timestamp: string; payload: { state: PlaybackState } }
  | { type: 'position'; timestamp: string; payload: { positionSeconds: number; durationSeconds?: number } }
  | { type: 'auth-changed'; timestamp: string; payload: AuthStatus }
  | { type: 'api-restarted'; timestamp: string; payload: ApiServerInfo };

export type AppEventType = AppEvent['type'];

export interface ApiServerInfo {
  port: number;
  url: string;
}
