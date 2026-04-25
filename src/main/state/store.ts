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

    // `now-playing` est émis lors d'un changement de piste OU d'une reprise
    // après pause (paused → playing), pour que les clients WebSocket qui
    // rejoignent en cours de lecture reçoivent bien la piste en cours.
    const nextTrackId = this._nowPlaying.track?.id;
    const isResumingFromPause = next.state === 'playing' && previousState === 'paused';
    if (nextTrackId !== previousTrackId || isResumingFromPause) {
      eventBus.emitEvent({
        type: 'now-playing',
        timestamp: this._nowPlaying.updatedAt,
        payload: { track: this._nowPlaying.track },
      });
    }

    // `playback-state` n'est émis QUE lors d'un changement d'état.
    if (next.state && next.state !== previousState) {
      this.emitPlaybackState(next.state);
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
   * Met à jour le miroir local de la file d'attente Tidal. Aucune émission
   * d'événement WebSocket : la queue est consultable via REST `GET /queue`.
   */
  setQueue(next: Queue): void {
    this._queue = next;
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
