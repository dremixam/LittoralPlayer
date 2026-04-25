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
  | { type: 'now-playing'; timestamp: string; payload: NowPlaying }
  | { type: 'playback-state'; timestamp: string; payload: { state: PlaybackState } }
  | { type: 'track-changed'; timestamp: string; payload: { track?: Track } }
  | { type: 'position'; timestamp: string; payload: { positionSeconds: number; durationSeconds?: number } }
  | { type: 'queue-changed'; timestamp: string; payload: Queue }
  | { type: 'auth-changed'; timestamp: string; payload: AuthStatus };

export type AppEventType = AppEvent['type'];

export interface ApiServerInfo {
  port: number;
  url: string;
}
