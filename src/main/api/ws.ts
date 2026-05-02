import { WebSocketServer, type WebSocket } from 'ws';
import type { Server } from 'node:http';
import { eventBus } from '../state/store';
import { store } from '../state/store';
import { playerControl } from '../player/controller';

/**
 * Attache un serveur WebSocket sur le serveur HTTP existant, à `path = /events`.
 * À la connexion, envoie un snapshot de l'état courant puis relaie tous les `AppEvent`.
 */
export function attachWebSocket(httpServer: Server): WebSocketServer {
  const wss = new WebSocketServer({ server: httpServer, path: '/events' });

  const sendInitialSnapshot = async (ws: WebSocket) => {
    const now = new Date().toISOString();
    // À la connexion, on envoie l'état courant : la piste actuelle (now-playing)
    // et l'état du playback (playback-state). Par la suite ces events ne seront
    // émis que lors d'un vrai changement.
    let track = store.nowPlaying.track;
    let state = store.nowPlaying.state;
    try {
      const np = await playerControl.getNowPlayingFromTidal();
      if (np) { track = np.track; state = np.state; }
    } catch { /* ignore */ }
    safeSend(ws, { type: 'now-playing', timestamp: now, payload: { track } });
    safeSend(ws, { type: 'playback-state', timestamp: now, payload: { state } });

    safeSend(ws, { type: 'auth-changed', timestamp: now, payload: store.auth });
  };

  wss.on('connection', ws => {
    void sendInitialSnapshot(ws);

    const unsubscribe = eventBus.onEvent(event => safeSend(ws, event));

    // Ping keep-alive
    const ping = setInterval(() => {
      if (ws.readyState === ws.OPEN) ws.ping();
    }, 30_000);

    let cleaned = false;
    const cleanup = (): void => {
      if (cleaned) return;
      cleaned = true;
      clearInterval(ping);
      unsubscribe();
    };
    ws.on('close', cleanup);
    ws.on('error', cleanup);
  });

  return wss;
}

function safeSend(ws: WebSocket, data: unknown): void {
  if (ws.readyState !== ws.OPEN) return;
  try { ws.send(JSON.stringify(data)); } catch { /* ignore */ }
}
