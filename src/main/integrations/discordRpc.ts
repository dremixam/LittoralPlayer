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
// startTimestamp (ms) envoyé à Discord, sert à détecter les seeks par dérive.
let lastSentStartMs: number | undefined;
// Timer one-shot pour résynchroniser après un seek ou une reprise.
// One-shot = on ne reset PAS si déjà en attente.
let resyncTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleResync(delayMs: number): void {
  if (resyncTimer !== null) return; // déjà planifié, on attend
  resyncTimer = setTimeout(() => {
    resyncTimer = null;
    void updateActivity(store.nowPlaying);
  }, delayMs);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildActivity(np: NowPlaying): Parameters<NonNullable<Client['user']>['setActivity']>[0] {
  const { state, track } = np;
  const rawPos = np.positionSeconds;
  const positionSeconds = (typeof rawPos === 'number' && isFinite(rawPos)) ? rawPos : undefined;

  if (!track) return {};

  const artists = track.artists.map(a => a.name).join(', ');
  // Prefer NowPlaying duration (updated in real-time), fall back to track metadata.
  const durationSeconds = np.durationSeconds ?? track.durationSeconds;

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
  activity.smallImageKey = 'icon';

  if (state === 'playing') {
    const startMs = Date.now() - (positionSeconds ?? 0) * 1000;
    activity.startTimestamp = startMs;
    if (durationSeconds) {
      activity.endTimestamp = startMs + durationSeconds * 1000;
    }
  }

  // Boutons : jusqu'à 2 maximum selon l'API Discord RPC.
  // On ne construit l'URL TIDAL que si track.id est un ID numérique valide
  // (évite les URLs invalides quand l'id est un fallback "titre|artiste").
  const buttons: { label: string; url: string }[] = [];
  const tidalUrl = track.url ?? (/^\d+$/.test(track.id) ? `https://listen.tidal.com/track/${track.id}` : undefined);
  if (tidalUrl) buttons.push({ label: 'Open in TIDAL', url: tidalUrl });
  buttons.push({ label: 'Get Littoral Player', url: 'https://littoral.dremixam.com/' });
  activity.buttons = buttons;

  return activity;
}

async function updateActivity(np: NowPlaying): Promise<void> {
  if (!client?.user) return;

  try {
    if (np.state === 'idle' || np.state === 'paused' || !np.track) {
      lastSentStartMs = undefined;
      await client.user.clearActivity(process.pid);
    } else {
      const activity = buildActivity(np);
      await client.user.setActivity(activity, process.pid);
      // Mémorise le startTimestamp envoyé pour détecter les futurs seeks.
      lastSentStartMs = typeof activity.startTimestamp === 'number' ? activity.startTimestamp : undefined;
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
    if (event.type === 'position') {
      const actualPos = event.payload.positionSeconds;
      const safeActual = (typeof actualPos === 'number' && isFinite(actualPos)) ? actualPos : NaN;
      if (!isNaN(safeActual) && store.nowPlaying.state === 'playing' && lastSentStartMs !== undefined) {
        const expectedPos = (Date.now() - lastSentStartMs) / 1000;
        if (Math.abs(safeActual - expectedPos) > 3) {
          scheduleResync(0);
        }
      }
      return;
    }
    if (event.type === 'now-playing' || event.type === 'playback-state') {
      scheduleResync(300);
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

  if (resyncTimer !== null) {
    clearTimeout(resyncTimer);
    resyncTimer = null;
  }

  client?.destroy();
  client = null;
  lastSentStartMs = undefined;
}
