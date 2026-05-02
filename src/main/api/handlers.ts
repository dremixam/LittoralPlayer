import type { Request, Response } from 'express';
import type { Context } from 'openapi-backend';
import { app as electronApp } from 'electron';
import { store } from '../state/store';
import { playerControl, getPlayerView } from '../player/controller';
import { navigateToLogin, logout } from '../auth/webviewToken';
import { search, getTrack, UnauthorizedError } from '../tidal/catalogue';

const startedAt = Date.now();

type Handler = (c: Context, req: Request, res: Response) => Promise<void> | void;

const wrap = (fn: () => Promise<unknown> | unknown) => async (_c: Context, _req: Request, res: Response) => {
  try {
    await fn();
    res.status(204).end();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!res.headersSent) {
      res.status(502).json({ code: 'player_command_failed', message });
    }
  }
};

export const handlers: Record<string, Handler> = {
  getHealth: (_c, _req, res) => {
    res.json({
      status: 'ok',
      version: electronApp.getVersion(),
      uptimeSeconds: (Date.now() - startedAt) / 1000,
    });
  },

  getNowPlaying: async (_c, _req, res) => {
    // Lit l'état réel depuis le store Redux Tidal via le bridge.
    // Fallback : dernière snapshot connue dans notre store local.
    try {
      const np = await playerControl.getNowPlayingFromTidal();
      if (np) { res.json({ ...np, updatedAt: new Date().toISOString() }); return; }
    } catch (err) {
      console.warn('[api] getNowPlaying via bridge failed:', (err as Error).message);
    }
    res.json(store.nowPlaying);
  },

  play: wrap(() => playerControl.play()),
  pause: wrap(() => playerControl.pause()),
  togglePlayPause: wrap(() => playerControl.toggle()),
  /**
   * Avance vers la piste suivante.
   * On délègue toujours au bouton "next" du lecteur Tidal, qui sait piocher
   * dans sa propre file (et donc aussi dans les pistes que /queue/enqueue
   * y a injectées via `enqueueInTidal`). De cette façon, la touche média
   * ▶▶| du clavier — qui appelle exactement le même comportement — reste
   * cohérente avec l'API.
   */
  next: wrap(() => playerControl.next()),
  previous: wrap(() => playerControl.previous()),

  seek: async (c, _req, res) => {
    const body = c.request.requestBody as { positionSeconds?: unknown };
    const pos = Number(body?.positionSeconds);
    if (!Number.isFinite(pos) || pos < 0) {
      res.status(400).json({ code: 'invalid_body', message: 'positionSeconds must be a non-negative number' });
      return;
    }
    try {
      await playerControl.seek(pos);
      res.status(204).end();
    } catch (err) {
      res.status(502).json({ code: 'player_command_failed', message: (err as Error).message });
    }
  },

  setVolume: async (c, _req, res) => {
    const body = c.request.requestBody as { volume?: unknown };
    const raw = Number(body?.volume);
    if (!Number.isFinite(raw)) {
      res.status(400).json({ code: 'invalid_body', message: 'volume must be a number' });
      return;
    }
    const volume = Math.max(0, Math.min(100, raw));
    try {
      await playerControl.setVolume(volume);
      store.setNowPlaying({ volume });
      res.status(204).end();
    } catch (err) {
      res.status(502).json({ code: 'player_command_failed', message: (err as Error).message });
    }
  },

  getQueue: async (_c, _req, res) => {
    try {
      const q = await playerControl.getQueueFromTidal();
      if (q) { res.json(q); return; }
    } catch (err) {
      console.warn('[api] getQueue via bridge failed:', (err as Error).message);
    }
    res.json({ items: [] });
  },

  enqueueTrack: async (c, _req, res) => {
    const body = c.request.requestBody as { trackId?: unknown; position?: unknown };
    const trackId = String(body?.trackId ?? '');
    if (!/^\d+$/.test(trackId)) {
      res.status(400).json({ code: 'invalid_body', message: 'trackId must be a numeric string' });
      return;
    }
    // Pousse dans la "Liste d'attente" native Tidal. 'end' (API) ↔ 'last' (Tidal).
    const tidalPos: 'next' | 'last' = body.position === 'next' ? 'next' : 'last';
    try {
      await playerControl.enqueueInTidal(trackId, tidalPos);
    } catch (err) {
      console.warn('[api] enqueueInTidal failed:', (err as Error).message);
    }
    // Renvoie la file d'attente Tidal mise à jour.
    try {
      const q = await playerControl.getQueueFromTidal();
      res.json(q ?? { items: [] });
    } catch {
      res.json({ items: [] });
    }
  },

  search: async (c, _req, res) => {
    const q = String(c.request.query.q ?? '').slice(0, 256);
    if (!q.trim()) {
      res.status(400).json({ code: 'invalid_query', message: 'q must be a non-empty string' });
      return;
    }
    const types = String(c.request.query.types ?? 'tracks,albums,artists,playlists')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    const rawLimit = Number(c.request.query.limit ?? 20);
    const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(50, rawLimit)) : 20;
    try {
      const results = await search({ q, types, limit });
      res.json(results);
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        res.status(401).json({ code: 'unauthorized', message: err.message });
        return;
      }
      throw err;
    }
  },

  getTrack: async (c, _req, res) => {
    const trackId = String(c.request.params.trackId);
    if (!/^\d+$/.test(trackId)) {
      res.status(400).json({ code: 'invalid_param', message: 'trackId must be numeric' });
      return;
    }
    try {
      const track = await getTrack(trackId);
      if (!track) {
        res.status(404).json({ code: 'not_found', message: 'Track not found' });
        return;
      }
      res.json(track);
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        res.status(401).json({ code: 'unauthorized', message: err.message });
        return;
      }
      throw err;
    }
  },

  getAuthStatus: (_c, _req, res) => { res.json(store.auth); },

  startLogin: async (_c, _req, res) => {
    try {
      const view = getPlayerView();
      if (view) await navigateToLogin(view);
      // Plus de second flow OAuth : l'utilisateur se connecte directement dans la WebView
      // (listen.tidal.com/login). Le watcher détectera le token automatiquement.
      res.status(202).json({ authorizationUrl: 'embedded://listen.tidal.com/login' });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ code: 'login_failed', message });
    }
  },

  logout: async (_c, _req, res) => {
    await logout(getPlayerView());
    res.status(204).end();
  },

  // openapi-backend handlers spéciaux
  notFound: (_c, _req, res) => { res.status(404).json({ code: 'not_found', message: 'Route not found' }); },
  validationFail: (c, _req, res) => {
    res.status(400).json({ code: 'validation_failed', message: c.validation.errors?.[0]?.message ?? 'Invalid request' });
  },
  notImplemented: (_c, _req, res) => { res.status(501).json({ code: 'not_implemented', message: 'Not implemented' }); },
};
