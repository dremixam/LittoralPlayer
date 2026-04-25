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
    // now-playing : prefer live Tidal Redux read, fallback cache.
    let nowPlaying: unknown = store.nowPlaying;
    try {
      const np = await playerControl.getNowPlayingFromTidal();
      if (np) nowPlaying = { ...np, updatedAt: now };
    } catch { /* ignore */ }
    safeSend(ws, { type: 'now-playing', timestamp: now, payload: nowPlaying });

    // queue : same approach
    let queue: unknown = store.queue;
    try {
      const q = await playerControl.getQueueFromTidal();
      if (q) queue = q;
    } catch { /* ignore */ }
    safeSend(ws, { type: 'queue-changed', timestamp: now, payload: queue });

    safeSend(ws, { type: 'auth-changed', timestamp: now, payload: store.auth });
  };

  wss.on('connection', ws => {
    void sendInitialSnapshot(ws);

    const unsubscribe = eventBus.onEvent(event => safeSend(ws, event));

    ws.on('close', unsubscribe);
    ws.on('error', unsubscribe);

    // Ping keep-alive
    const ping = setInterval(() => {
      if (ws.readyState === ws.OPEN) ws.ping();
    }, 30_000);
    ws.on('close', () => clearInterval(ping));
  });

  return wss;
}

function safeSend(ws: WebSocket, data: unknown): void {
  if (ws.readyState !== ws.OPEN) return;
  try { ws.send(JSON.stringify(data)); } catch { /* ignore */ }
}
