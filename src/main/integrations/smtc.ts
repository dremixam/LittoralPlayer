/**
 * Intégration Windows SMTC (System Media Transport Controls) via l'API
 * Web `navigator.mediaSession`.
 *
 * Chromium (donc Electron) expose nativement `navigator.mediaSession` dans
 * chaque renderer et synchronise automatiquement son état avec :
 *   - Le SMTC Windows (lock screen, taskbar, overlay Xbox Game Bar)
 *   - Le Now Playing macOS (menu bar + Control Center)
 *   - Les touches multimédia clavier (affichage de la piste en cours)
 *
 * L'audio étant produit dans la WebContentsView Tidal, c'est dans ce
 * contexte que l'on injecte les métadonnées — pas dans le renderer React.
 * Tidal définit lui-même des valeurs `mediaSession`, qu'on écrase avec
 * les données déjà extraites par notre bridge (titre, artiste, pochette…).
 *
 * Aucun addon natif, aucune recompilation : fonctionne tel quel avec le
 * build automatisé electron-builder + Castlabs.
 */

import { executeInPlayerView } from '../player/controller';
import { eventBus, store } from '../state/store';
import type { NowPlaying } from '../../shared/models';

let unsubscribe: (() => void) | null = null;

// ─── Injection ────────────────────────────────────────────────────────────────

function buildInjection(np: NowPlaying): string {
  const { state, track } = np;

  if (!track || state === 'idle') {
    return `
      try {
        navigator.mediaSession.metadata = null;
        navigator.mediaSession.playbackState = 'none';
      } catch(e) {}
      void 0;
    `;
  }

  const artists = track.artists.map(a => a.name).join(', ');
  const album = track.album?.title ?? '';

  // Artwork : on préfère la coverUrl extraite du bridge (URL Tidal CDN).
  // navigator.mediaSession accepte les URL absolues depuis Chrome 73+.
  const artworkJson = track.coverUrl
    ? JSON.stringify([{ src: track.coverUrl, sizes: '640x640', type: 'image/jpeg' }])
    : '[]';

  const playbackState = state === 'playing' ? 'playing' : 'paused';

  return `
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title:   ${JSON.stringify(track.title)},
        artist:  ${JSON.stringify(artists)},
        album:   ${JSON.stringify(album)},
        artwork: ${artworkJson},
      });
      navigator.mediaSession.playbackState = ${JSON.stringify(playbackState)};
    } catch(e) {}
    void 0;
  `;
}

async function update(np: NowPlaying): Promise<void> {
  try {
    await executeInPlayerView(buildInjection(np));
  } catch {
    // La view peut ne pas être prête (navigation en cours) — on ignore.
  }
}

// ─── API publique ─────────────────────────────────────────────────────────────

/**
 * Démarre la synchronisation SMTC/mediaSession.
 * Doit être appelé après que la WebContentsView Tidal est créée.
 */
export function initSmtc(): void {
  unsubscribe = eventBus.onEvent(event => {
    if (event.type === 'now-playing' || event.type === 'playback-state') {
      void update(store.nowPlaying);
    }
  });

  // Applique l'état courant immédiatement (au cas où une piste joue déjà).
  void update(store.nowPlaying);
  console.log('[smtc] mediaSession synchronisation démarrée');
}

/**
 * Arrête la synchronisation et efface les métadonnées SMTC.
 */
export function destroySmtc(): void {
  unsubscribe?.();
  unsubscribe = null;
  void executeInPlayerView(`
    try {
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.playbackState = 'none';
    } catch(e) {}
    void 0;
  `).catch(() => {});
}
