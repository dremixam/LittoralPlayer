# Littoral

Littoral is a Tidal player for Windows that exposes a **local REST + WebSocket API** to control playback and receive real-time events from any application.

## Requirements

- Windows 10 or 11 (64-bit)
- An active Tidal **HiFi** or **HiFi Plus** subscription

## Installation

Download the latest installer from the [Releases](../../releases/latest) page and run it.

> Windows may show a SmartScreen warning on first install — click "More info" then "Run anyway".

## First launch

On startup, Littoral automatically downloads the Widevine component required to play Tidal's DRM streams (takes a few seconds).

Sign in to your Tidal account **directly in the player window** — that's the only authentication needed.

## REST API

The API is available at `http://127.0.0.1:7143` (port configurable via the `TIDAL_API_PORT` environment variable).

**Interactive Swagger UI docs: [`http://127.0.0.1:7143/docs`](http://127.0.0.1:7143/docs)**

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check + version |
| GET | `/now-playing` | Current track and player state |
| POST | `/playback/play` | Resume playback |
| POST | `/playback/pause` | Pause playback |
| POST | `/playback/toggle` | Toggle play/pause |
| POST | `/playback/next` | Skip to next track |
| POST | `/playback/previous` | Go to previous track |
| POST | `/playback/seek` | `{ "positionSeconds": 42 }` |
| POST | `/playback/volume` | `{ "volume": 80 }` (0–100) |
| GET | `/queue` | Current playback queue |
| POST | `/queue/enqueue` | `{ "trackId": "...", "position": "end\|next" }` |
| GET | `/catalogue/search` | `?q=...&types=tracks,albums,artists,playlists&limit=20` |
| GET | `/catalogue/tracks/{trackId}` | Track metadata |
| GET | `/auth/status` | Authentication status |
| POST | `/auth/login` | Navigate the player to the Tidal login page |
| POST | `/auth/logout` | Log out of the player |

## WebSocket

Connect to: `ws://127.0.0.1:7143/events`

No authentication required. On connection, a full snapshot of the current state is sent immediately as several successive messages.

All messages are JSON with the following structure:

```json
{
  "type": "<type>",
  "timestamp": "<ISO-8601>",
  "payload": { ... }
}
```

### `now-playing` — track changed

```json
{
  "type": "now-playing",
  "timestamp": "2025-01-20T14:32:11.123Z",
  "payload": {
    "track": {
      "id": "12345678",
      "title": "Title",
      "artists": [{ "id": "999", "name": "Artist" }],
      "album": { "id": "555", "title": "Album", "coverUrl": "https://..." },
      "coverUrl": "https://...",
      "durationSeconds": 213
    }
  }
}
```

### `playback-state` — state changed

Possible states: `idle` · `playing` · `paused` · `buffering`

```json
{
  "type": "playback-state",
  "timestamp": "2025-01-20T14:32:11.123Z",
  "payload": { "state": "playing" }
}
```

### `position` — current position (~1×/s during playback)

```json
{
  "type": "position",
  "timestamp": "2025-01-20T14:32:11.123Z",
  "payload": { "positionSeconds": 42.5, "durationSeconds": 213 }
}
```

### `auth-changed` — signed in / signed out

```json
{
  "type": "auth-changed",
  "timestamp": "2025-01-20T14:32:11.123Z",
  "payload": { "authenticated": true, "userId": "...", "countryCode": "FR" }
}
```

## Integrations

### Windows SMTC

Track title, artist and artwork appear automatically on the lock screen, in the taskbar media widget and in Xbox Game Bar.

### Discord Rich Presence

Littoral can show the current track in your Discord status ("Listening to…").

## Limitations

- **Windows only** — Widevine DRM requires the Windows Media Foundation CDM.
- The API is **loopback only** (`127.0.0.1`) and is not exposed on the local network.
- Player control (queue, metadata) relies on the internal structure of the Tidal web player. If Tidal changes its internals, some features may be temporarily unavailable until Littoral is updated.
- When adding a track to the queue via the API, if Tidal hasn't loaded that track's data yet, the player will briefly navigate to the track's page to fetch it and then return — this causes a short visible flash in the window. If the data doesn't load within 3 seconds, the enqueue silently fails.
- When playback is started via Tidal's shuffle button, the `now-playing` event may initially report a synthetic track ID (derived from the title and artist name) instead of the real Tidal numeric ID, until the player's internal state fully catches up.

## Contributing

For architecture details, development setup, and maintenance procedures, see [docs/developer.md](docs/developer.md).

