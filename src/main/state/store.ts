import { EventEmitter } from 'node:events';
import type { AppEvent, AuthStatus, NowPlaying, Queue, PlaybackState } from '../../shared/models';

/**
 * Bus d'événements applicatif typé.
 * Centralise tous les événements diffusés vers les clients (WebSocket, IPC renderer).
 */
class TypedEventBus extends EventEmitter {
  emitEvent(event: AppEvent): void {
    this.emit('event', event);
  }
  onEvent(listener: (event: AppEvent) => void): () => void {
    this.on('event', listener);
    return () => this.off('event', listener);
  }
}

export const eventBus = new TypedEventBus();
eventBus.setMaxListeners(50);

/**
 * État centralisé : seule source de vérité pour now-playing, queue, auth.
 * Toute mutation passe par les setters qui émettent l'événement adéquat.
 */
class AppStore {
  private _nowPlaying: NowPlaying = {
    state: 'idle',
    updatedAt: new Date().toISOString(),
  };
  private _queue: Queue = { items: [] };
  private _auth: AuthStatus = { authenticated: false };

  get nowPlaying(): NowPlaying { return this._nowPlaying; }
  get queue(): Queue { return this._queue; }
  get auth(): AuthStatus { return this._auth; }

  setNowPlaying(next: Partial<NowPlaying>): void {
    const previousTrackId = this._nowPlaying.track?.id;
    const previousState = this._nowPlaying.state;
    this._nowPlaying = {
      ...this._nowPlaying,
      ...next,
      updatedAt: new Date().toISOString(),
    };

    eventBus.emitEvent({
      type: 'now-playing',
      timestamp: this._nowPlaying.updatedAt,
      payload: this._nowPlaying,
    });

    if (next.state && next.state !== previousState) {
      this.emitPlaybackState(next.state);
    }
    const nextTrackId = this._nowPlaying.track?.id;
    if (nextTrackId !== previousTrackId) {
      eventBus.emitEvent({
        type: 'track-changed',
        timestamp: new Date().toISOString(),
        payload: { track: this._nowPlaying.track },
      });
    }
  }

  emitPosition(positionSeconds: number, durationSeconds?: number): void {
    this._nowPlaying = {
      ...this._nowPlaying,
      positionSeconds,
      durationSeconds: durationSeconds ?? this._nowPlaying.durationSeconds,
      updatedAt: new Date().toISOString(),
    };
    eventBus.emitEvent({
      type: 'position',
      timestamp: this._nowPlaying.updatedAt,
      payload: { positionSeconds, durationSeconds: this._nowPlaying.durationSeconds },
    });
  }

  private emitPlaybackState(state: PlaybackState): void {
    eventBus.emitEvent({
      type: 'playback-state',
      timestamp: new Date().toISOString(),
      payload: { state },
    });
  }

  /**
   * Met à jour le miroir local de la file d'attente Tidal (alimenté par le bridge
   * via une subscription Redux). Émet `queue-changed` pour les clients WebSocket.
   */
  setQueue(next: Queue): void {
    this._queue = next;
    eventBus.emitEvent({
      type: 'queue-changed',
      timestamp: new Date().toISOString(),
      payload: this._queue,
    });
  }

  setAuth(next: AuthStatus): void {
    this._auth = next;
    eventBus.emitEvent({
      type: 'auth-changed',
      timestamp: new Date().toISOString(),
      payload: this._auth,
    });
  }
}

export const store = new AppStore();
