/**
 * Intégration Discord Rich Presence.
 *
 * Affiche la piste en cours de lecture dans le statut Discord de l'utilisateur.
 *
 * ─── CONFIGURATION ──────────────────────────────────────────────────────────
 * 1. Créer une application sur https://discord.com/developers/applications
 * 2. Copier l'Application ID (= Client ID)
 * 3. Remplacer la valeur de DISCORD_CLIENT_ID ci-dessous (ou définir la
 *    variable d'environnement DISCORD_CLIENT_ID avant de lancer l'app).
 * ────────────────────────────────────────────────────────────────────────────
 */

import { Client } from '@xhayper/discord-rpc';
import { ActivityType } from 'discord-api-types/v10';
import { eventBus, store } from '../state/store';
import type { NowPlaying } from '../../shared/models';

// ⬇ Remplacer par l'Application ID de votre app Discord Developer Portal
const DISCORD_CLIENT_ID: string = process.env.DISCORD_CLIENT_ID ?? '1499978884190306435';

// Délai en ms entre deux tentatives de reconnexion après une déconnexion.
const RECONNECT_DELAY_MS = 30_000;

let client: Client | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let unsubscribe: (() => void) | null = null;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildActivity(np: NowPlaying): Parameters<NonNullable<Client['user']>['setActivity']>[0] {
  const { state, track, positionSeconds, durationSeconds } = np;

  if (!track) return {};

  const artists = track.artists.map(a => a.name).join(', ');

  const activity: Parameters<NonNullable<Client['user']>['setActivity']>[0] = {
    type: ActivityType.Listening,
    details: track.title,
    state: artists,
    largeImageText: track.album?.title ?? track.title,
    instance: false,
  };

  // Discord supporte les URL externes comme clé d'image depuis 2022.
  if (track.coverUrl) {
    activity.largeImageKey = track.coverUrl;
  }

  if (state === 'playing' && positionSeconds !== undefined) {
    const startMs = Date.now() - positionSeconds * 1000;
    activity.startTimestamp = startMs;
    if (durationSeconds) {
      activity.endTimestamp = startMs + durationSeconds * 1000;
    }
  }

  return activity;
}

async function updateActivity(np: NowPlaying): Promise<void> {
  if (!client?.user) return;

  try {
    if (np.state === 'idle' || !np.track) {
      await client.user.clearActivity(process.pid);
    } else {
      await client.user.setActivity(buildActivity(np), process.pid);
    }
  } catch (err) {
    console.warn('[discord-rpc] updateActivity error:', err);
  }
}

// ─── Connexion / reconnexion ──────────────────────────────────────────────────

function scheduleReconnect(): void {
  if (reconnectTimer !== null) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void connect();
  }, RECONNECT_DELAY_MS);
}

async function connect(): Promise<void> {
  if (client !== null) return;

  client = new Client({ clientId: DISCORD_CLIENT_ID });

  client.on('ready', () => {
    console.log('[discord-rpc] connecté à Discord');
    void updateActivity(store.nowPlaying);
  });

  client.on('disconnected', () => {
    console.warn(`[discord-rpc] déconnecté — nouvelle tentative dans ${RECONNECT_DELAY_MS / 1000}s`);
    client = null;
    scheduleReconnect();
  });

  try {
    await client.login();
  } catch (err) {
    console.warn('[discord-rpc] impossible de se connecter à Discord (Discord lancé ?):', err);
    client = null;
    scheduleReconnect();
  }
}

// ─── API publique ─────────────────────────────────────────────────────────────

/**
 * Démarre l'intégration Discord Rich Presence.
 * Sans effet si DISCORD_CLIENT_ID n'est pas configuré.
 */
export function initDiscordRpc(): void {
  if (!DISCORD_CLIENT_ID) {
    console.log(
      '[discord-rpc] DISCORD_CLIENT_ID non configuré — Rich Presence désactivé.\n' +
      '  → Créer une app sur https://discord.com/developers/applications,\n' +
      '    copier l\'Application ID et le renseigner dans src/main/integrations/discordRpc.ts',
    );
    return;
  }

  // Écoute les changements de piste et les changements d'état play/pause.
  unsubscribe = eventBus.onEvent(event => {
    if (event.type === 'now-playing' || event.type === 'playback-state') {
      void updateActivity(store.nowPlaying);
    }
  });

  void connect();
}

/**
 * Arrête l'intégration et libère les ressources (à appeler avant quit).
 */
export function destroyDiscordRpc(): void {
  unsubscribe?.();
  unsubscribe = null;

  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  client?.destroy();
  client = null;
}
