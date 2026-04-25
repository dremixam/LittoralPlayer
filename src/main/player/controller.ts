import { BrowserWindow, WebContentsView, ipcMain } from 'electron';
import { TIDAL_WEB_PLAYER_URL } from '../../shared/constants';
import { store } from '../state/store';
import type { PlaybackState, Track } from '../../shared/models';
import { PLAYER_BRIDGE_SCRIPT } from './bridgeScript';
import { startTokenWatcher, stopTokenWatcher } from '../auth/webviewToken';
import { prefetchTrackMix, fetchTrackEntityV2 } from '../tidal/catalogue';

interface BridgeSnapshot {
  state: PlaybackState;
  track?: {
    id?: string;
    title: string;
    artists: { id: string; name: string }[];
    album?: { id: string; title: string; coverUrl?: string };
    coverUrl?: string;
    durationSeconds: number;
  };
  positionSeconds?: number;
  durationSeconds?: number;
  volume?: number;
}

interface BridgeMessage {
  kind: 'snapshot' | 'position' | 'queue';
  data:
    | BridgeSnapshot
    | { positionSeconds: number; durationSeconds?: number }
    | { items: Array<{ id: string; trackId: string; addedAt: string; track?: Track }> };
}

const BRIDGE_IPC_CHANNEL = 'tidal-bridge:message';

let view: WebContentsView | null = null;

export function createPlayerView(host: BrowserWindow): WebContentsView {
  view = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      // Le preload de la view expose `window.tidalBridge.send(msg)` via ipcRenderer.
      preload: undefined, // on injecte le bridge via executeJavaScript après load (voir installBridge)
    },
  });

  host.contentView.addChildView(view);
  layoutView(host);
  host.on('resize', () => layoutView(host));

  view.webContents.loadURL(TIDAL_WEB_PLAYER_URL);

  // En dev, ouvre automatiquement DevTools sur la WebView Tidal pour pouvoir
  // diagnostiquer les erreurs DRM / lecture (S6001, etc.)
  if (process.env.NODE_ENV !== 'production') {
    view.webContents.once('did-finish-load', () => {
      view?.webContents.openDevTools({ mode: 'detach' });
    });
  }

  view.webContents.on('did-finish-load', () => {
    void installBridge();
    // Démarre / rafraîchit le watcher de token dès qu'une page se charge
    if (view) startTokenWatcher(view);
  });
  view.webContents.on('did-navigate-in-page', () => {
    void installBridge();
  });

  // Réception des messages depuis le script injecté via window.tidalBridge.send
  // (on l'expose sous forme de fonction qui IPC vers le main)
  ipcMain.removeHandler(BRIDGE_IPC_CHANNEL);
  ipcMain.handle(BRIDGE_IPC_CHANNEL, (_evt, msg: BridgeMessage) => handleBridgeMessage(msg));

  return view;
}

function layoutView(host: BrowserWindow): void {
  if (!view) return;
  const { width, height } = host.getContentBounds();
  // Bandeau supérieur de 64px : 40px de title bar overlay (boutons natifs Win/Mac)
  // + 24px d'espace pour le contenu de notre UI React (état du lecteur, login).
  const TOP = 64;
  view.setBounds({ x: 0, y: TOP, width, height: Math.max(0, height - TOP) });
}

async function installBridge(): Promise<void> {
  if (!view) return;
  try {
    await view.webContents.executeJavaScript(
      `window.tidalBridge = { send: (msg) => console.log('[TIDAL_BRIDGE]' + JSON.stringify(msg)) };\n` +
        PLAYER_BRIDGE_SCRIPT,
      true,
    );
    console.log('[player] bridge installed at', view.webContents.getURL());
  } catch (err) {
    console.warn('[player] failed to install bridge:', err);
  }
}

// Intercepte les messages console pour récupérer les snapshots du bridge
export function attachConsoleBridge(): void {
  if (!view) return;
  view.webContents.on('console-message', (...args: unknown[]) => {
    // Electron 33+ : (event: { message, level, lineNumber, sourceId, frame })
    // Electron <33 : (event, level, message, line, sourceId)
    let message: string | undefined;
    const first = args[0] as { message?: string } | undefined;
    if (first && typeof first === 'object' && typeof first.message === 'string') {
      message = first.message;
    } else if (typeof args[2] === 'string') {
      message = args[2];
    }
    if (!message || !message.startsWith('[TIDAL_BRIDGE]')) return;
    try {
      const json = message.slice('[TIDAL_BRIDGE]'.length);
      const msg = JSON.parse(json) as BridgeMessage;
      handleBridgeMessage(msg);
    } catch (err) {
      console.warn('[player] failed to parse bridge message:', err);
    }
  });
  console.log('[player] console bridge attached');
}

function handleBridgeMessage(msg: BridgeMessage): void {
  if (msg.kind === 'position') {
    const p = msg.data as { positionSeconds: number; durationSeconds?: number };
    store.emitPosition(p.positionSeconds, p.durationSeconds);
    return;
  }
  if (msg.kind === 'queue') {
    const q = msg.data as { items: Array<{ id: string; trackId: string; addedAt: string; track?: Track }> };
    store.setQueue({ items: q.items });
    return;
  }
  const snap = msg.data as BridgeSnapshot;
  const track: Track | undefined = snap.track
    ? {
        id: snap.track.id ?? `${snap.track.title}|${snap.track.artists.map(a => a.name).join(',')}`,
        title: snap.track.title,
        artists: snap.track.artists,
        album: snap.track.album,
        coverUrl: snap.track.coverUrl,
        durationSeconds: snap.track.durationSeconds,
      }
    : undefined;
  store.setNowPlaying({
    state: snap.state,
    track,
    positionSeconds: snap.positionSeconds,
    durationSeconds: snap.durationSeconds,
    volume: snap.volume,
  });
}

// --- Commandes exposées aux handlers API ---
async function exec<T = unknown>(expr: string): Promise<T | null> {
  if (!view) {
    console.warn('[player] exec called but no view ready');
    return null;
  }
  try {
    return (await view.webContents.executeJavaScript(expr, true)) as T;
  } catch (err) {
    console.warn('[player] executeJavaScript failed:', err instanceof Error ? err.message : err, '— expr:', expr);
    throw err;
  }
}

export const playerControl = {
  play: () => exec('window.__tidalControl && window.__tidalControl.play()'),
  pause: () => exec('window.__tidalControl && window.__tidalControl.pause()'),
  toggle: () => exec('window.__tidalControl && window.__tidalControl.toggle()'),
  next: () => exec('window.__tidalControl && window.__tidalControl.next()'),
  previous: () => exec('window.__tidalControl && window.__tidalControl.previous()'),
  seek: (positionSeconds: number) =>
    exec(`window.__tidalControl && window.__tidalControl.seek(${Number(positionSeconds)})`),
  setVolume: (vol0_100: number) => {
    const v = Math.max(0, Math.min(1, vol0_100 / 100));
    return exec(`window.__tidalControl && window.__tidalControl.setVolume(${v})`);
  },
  /**
   * Joue un morceau Tidal en navigant vers son URL `tidal.com/track/{id}` dans la BrowserView,
   * puis déclenche play.
   */
  playTrack: async (trackId: string) => {
    if (!view) return null;
    await view.webContents.loadURL(`https://listen.tidal.com/track/${encodeURIComponent(trackId)}`);
    // Le bridge se ré-installe via did-finish-load ; on tente play après un court délai.
    setTimeout(() => { void exec('window.__tidalControl && window.__tidalControl.play()'); }, 1500);
    return true;
  },
  /**
   * Ajoute un morceau directement dans la "Liste d'attente" native du lecteur Tidal
   * (slice Redux `playQueue`). De ce fait, la touche média ▶▶| comme le bouton next
   * du lecteur web piochent dans cette même file.
   */
  enqueueInTidal: async (trackId: string, position: 'next' | 'last' = 'last') => {
    // Best-effort : prefetch /v1/.../mix côté main (cache HTTP côté Tidal).
    void prefetchTrackMix(trackId);
    // Récupère l'entité v2 (JSON:API) pour extraire l'albumId. La saga
    // ADD_MEDIA_ITEMS_TO_QUEUE utilise sourceContext pour déclencher la
    // RTK Query qui hydrate l'entité — sans contexte (UNKNOWN) elle ne
    // fait rien si la track n'est pas déjà dans le cache.
    let albumId: string | null = null;
    try {
      const entity = (await fetchTrackEntityV2(trackId)) as
        | { relationships?: { albums?: { data?: Array<{ id?: string }> } } }
        | null;
      const relAlbumId = entity?.relationships?.albums?.data?.[0]?.id;
      if (relAlbumId) albumId = String(relAlbumId);
    } catch (e) {
      console.warn('[player] fetchTrackEntityV2 failed:', e instanceof Error ? e.message : e);
    }
    const sourceContext = albumId
      ? { id: Number(albumId), type: 'album' }
      : { id: '', type: 'UNKNOWN' };
    console.log('[player] enqueueInTidal id=' + trackId + ' pos=' + position +
      ' sourceContext=' + JSON.stringify(sourceContext));
    const expr =
      `(window.__tidalControl && window.__tidalControl.enqueue(` +
      `${JSON.stringify(trackId)}, ${JSON.stringify(position)}, ${JSON.stringify(sourceContext)}))`;
    const diag = await exec<unknown>(expr);
    console.log('[player] enqueue diag:', JSON.stringify(diag));
    return !!(diag && typeof diag === 'object' && (diag as { ok?: boolean }).ok);
  },
  /** Lit la file d'attente Tidal (items à venir, hors morceau courant). */
  getQueueFromTidal: async () => {
    return exec<{ items: Array<{ id: string; trackId: string; addedAt: string; track?: Track }> } | null>(
      'window.__tidalControl && window.__tidalControl.getQueue()',
    );
  },
  /** Lit le now-playing complet depuis le store Redux Tidal (best-effort). */
  getNowPlayingFromTidal: async () => {
    return exec<{
      state: PlaybackState;
      track?: Track;
      positionSeconds?: number;
      durationSeconds?: number;
      volume?: number;
    } | null>('window.__tidalControl && window.__tidalControl.getNowPlaying()');
  },
};

export function getPlayerView(): WebContentsView | null {
  return view;
}

export function disposePlayerView(): void {
  stopTokenWatcher();
  view = null;
}
