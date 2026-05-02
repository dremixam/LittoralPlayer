# Littoral — Developer Documentation

This document covers the project architecture, development environment setup, Castlabs DRM details, and the maintenance procedure when the Tidal web player changes.

---

## Stack

- **Castlabs Electron v41+wvcus** — Electron fork bundling the Widevine CDM (required for Tidal DRM streams, without it: S6001 error)
- `electron-vite` + TypeScript
- **React 18** renderer (minimal UI: status bar + login button)
- API: **Express** + **`openapi-backend`** (request validation from the OpenAPI spec) + **`ws`**
- Auth: single login performed by the user in the WebView. The OAuth token is captured by intercepting outgoing `Authorization: Bearer` headers from the WebView (Tidal now encrypts its `localStorage`, so header interception is the only reliable approach) and reused for catalogue calls.

---

## Architecture

```
src/
├── main/
│   ├── api/              # Express + openapi-backend + WebSocket
│   ├── auth/             # Token extraction from the WebView localStorage
│   ├── integrations/     # Discord Rich Presence, SMTC (mediaSession)
│   ├── player/           # WebContentsView listen.tidal.com + injected bridge script
│   ├── tidal/            # api.tidal.com/v1 client (catalogue/search)
│   ├── state/            # Centralised store + typed EventBus
│   ├── ipc.ts            # IPC bridges main <-> renderer
│   └── settings.ts       # electron-store (port, persisted tokens)
├── preload/              # window.tidalApp exposed to the renderer via contextBridge
├── renderer/             # React UI (64px top bar)
└── shared/               # Models + constants + api-types.ts (generated)
openapi/tidal-player-api.yaml   # API source of truth
```

### Data flow

```
Renderer / API  ──IPC/HTTP──▶  Main process
                                    │  ▲
                        exec JS  ▼  │  console-message event
                           WebContentsView (listen.tidal.com)
                           window.__tidalControl (bridgeScript.ts)
```

Commands flow down via `executeJavaScript`; events flow back up through `console.log('[TIDAL_BRIDGE]...')` intercepted on the `console-message` event.

---

## Development environment

### Prerequisites

- Node.js 20+
- Python 3 (for Castlabs VMP signing)
- A [Castlabs EVS](https://github.com/castlabs/electron-releases/wiki/EVS) account

### Initial setup

```bash
# 1. Install the EVS CLI (once per machine)
py -3 -m pip install --upgrade castlabs-evs

# 2. Create an EVS account and validate the email
py -3 -m castlabs_evs.account signup

# 3. Authenticate the local session
py -3 -m castlabs_evs.account reauth

# 4. Install dependencies (automatically signs the Electron binary via postinstall)
npm install

# 5. Start in development mode
npm run dev
```

The `.env` file at the project root is loaded automatically by `electron-vite`:

```env
TIDAL_API_PORT=7143          # local API port (default: 7143)
DISCORD_CLIENT_ID=...        # optional — for Discord Rich Presence
```

### Useful scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start in development mode (HMR enabled) |
| `npm run typecheck` | TypeScript check (main + renderer) |
| `npm run openapi:types` | Regenerate `src/shared/api-types.ts` from the spec |
| `npm run openapi:lint` | Validate the OpenAPI spec with redocly |
| `npm run build` | Production build |
| `npm run package` | Build + electron-builder packaging (installable `.exe`) |

---

## Widevine DRM — how it works and constraints

Tidal streaming is protected by Widevine. Three conditions must all be met for playback to work; missing any one of them produces the **S6001** error.

### 1. Castlabs Electron (required)

Official Electron does not ship the Widevine CDM. Castlabs `electron-releases` is a fork that downloads it automatically on first launch.

```jsonc
// package.json — already configured
"electron": "github:castlabs/electron-releases#v41.1.1+wvcus"
```

> ⚠️ **Minimum version: v41.x+wvcus.** Earlier branches (v33 and before) only distribute the new "Google Widevine Windows CDM" (Media Foundation), which is incompatible with the `com.widevine.alpha` keysystem used by Tidal. v41 reinstalls the legacy CDM `oimompecagnajdejgnnjijobebaeigek` (v4.10.x), the only one accepted by Tidal.

The main process waits for the CDM to be available before creating the window (`components.whenReady()`). The detection logic handles both components (deprecated legacy CDM + new CDM) and automatically relaunches the app if the CDM was just downloaded (status `new`).

### 2. Personal VMP signature (required)

The Castlabs binary ships with a **generic developer VMP signature** that Tidal rejects (HTTP 400 on `POST /v2/widevine`). Symptom: playback starts for a few seconds then cuts with S6001.

You must sign the binary with **your own VMP certificate** (free for non-commercial use via EVS).

The `postinstall` hook in `package.json` re-signs automatically after each `npm install`. On a new machine, run `evs.account reauth` first, then `npm install`.

Manual one-off signing:

```pwsh
py -3 -m castlabs_evs.vmp sign-pkg node_modules/electron/dist
```

After re-signing, clear the CDM cache to force a clean renegotiation:

```pwsh
Remove-Item "$env:APPDATA\Littoral\WidevineCdm",
            "$env:APPDATA\Littoral\MediaFoundationWidevineCdm",
            "$env:APPDATA\Littoral\component_crx_cache" -Recurse -Force
```

### 3. Active Tidal HiFi subscription

Without a paid subscription, Tidal returns S6001 for protected tracks.

### Diagnosis

In dev mode, the DevTools for the Tidal WebView open automatically. Go to the Network tab, start playback and verify that `POST /v2/widevine` returns **200**. If 400 → re-sign + clear CDM cache.

---

## Player control — the bridge

`src/main/player/bridgeScript.ts` is the script injected into the WebContentsView via `executeJavaScript`. It is **the only file** that knows how Tidal is built internally.

### What the bridge exposes

`window.__tidalControl.{play, pause, toggle, next, previous, seek, setVolume, enqueue, getNowPlaying, getQueue, snapshot}`

### Mechanisms by feature

| Feature | Mechanism | Break risk |
|---------|-----------|------------|
| play / pause / toggle | Direct manipulation of the active `<audio>`/`<video>`. Fallback: click on `[data-test="play\|pause"]`. | Low |
| next / previous | Click on `[data-test="next"]` / `[data-test="previous"]` | Medium (DOM selectors) |
| seek | `mediaElement.currentTime = …` | Low |
| volume | `mediaElement.volume = …` | Low |
| now-playing (rich) | Read from `state.playbackControls.mediaProduct` + `state.entities.tracks/artists/albums` in the Redux store | **High** (slice/key names) |
| now-playing (fallback) | `navigator.mediaSession.metadata` + `mediaElement.currentTime/duration` | Low |
| queue (read) | `state.playQueue.elements` | **High** |
| queue (add) | `dispatch({ type: 'playQueue/ADD_MEDIA_ITEMS_TO_QUEUE', ... })` preceded by a `/track/<id>` navigation if the entity is not cached | **High** (fragile action schema) |
| WebSocket events | `store.subscribe()` detects changes in `playQueue`, re-emits to main | High |

### Finding the Redux store

`findReduxStore()` walks the React fiber of `#wimp`, `#root` and `document.body.children` looking for an object with `{ dispatch, getState, subscribe }`.

**If it stops working:**
1. Open DevTools on the WebView.
2. Type `__tidalControl.snapshot()` in the console to check whether the store is found.
3. If not: inspect `document.body.children`, locate the app root node and examine its fiber (`Object.keys(node)` → keys `__reactContainer$xxx` or `__reactFiber$xxx`).

### Finding action / slice names

When Tidal renames a Redux action, bridge `dispatch({ type: '...' })` calls fail silently.

To find the new name:

```js
// In the WebView DevTools console:
const s = findReduxStore();
const orig = s.dispatch;
s.dispatch = (a) => { console.log('[ACTION]', a.type, a.payload); return orig(a); };
// Perform the action in the Tidal player → the name appears in the console
```

### Entity schema

The bridge reads from `state.entities.tracks.entities[id].attributes.{title,duration}` and `.relationships.{artists,albums}.data[].id` — JSON:API format from the Tidal Open Platform.

If the structure changes:

```js
// In the DevTools console:
findReduxStore().getState().entities;   // inspect the full shape
__tidalControl.snapshot();              // see what the bridge extracts
```

### DOM selectors

Defined in `const SELECTORS = { ... }` at the top of `bridgeScript.ts`. If Tidal changes its `data-test` attributes or `aria-label` values, update that table.

To find the right selector: inspect the button in DevTools, prefer `data-test="..."` (used by Tidal's internal tests — relatively stable), otherwise `[aria-label*="..."]`.

---

## Authentication

`src/main/auth/webviewToken.ts` intercepts outgoing WebView requests to `*.tidal.com` via `webRequest.onBeforeSendHeaders` and captures the `Authorization: Bearer …` header.

Once a token is detected:
- it is persisted via `electron-store` (`settings.tokens`)
- `store.auth` switches to `authenticated: true` (with `userId` and `countryCode`)
- the `auth-changed` event is broadcast over the WebSocket

The catalogue client (`src/main/tidal/catalogue.ts`) uses this token as a `Bearer` against `https://api.tidal.com/v1/*`. No second OAuth flow, no `client_id` to provision.

If Tidal stops sending the `Authorization: Bearer` header in its outgoing requests (e.g. switches to a non-HTTP auth mechanism), a different capture approach will be needed in `webviewToken.ts`.

---

## OpenAPI — source of truth

The `openapi/tidal-player-api.yaml` spec is the source of truth for:
- HTTP request validation (via `openapi-backend`)
- Generated TypeScript types (`src/shared/api-types.ts`)
- Swagger UI documentation served at `/docs`

```bash
npm run openapi:types   # regenerates api-types.ts
npm run openapi:lint    # validates the spec with redocly
```

Any new endpoint must first be declared in the spec, then implemented in `src/main/api/handlers.ts`.

---

## Integrations

### Discord Rich Presence (`src/main/integrations/discordRpc.ts`)

Uses `@xhayper/discord-rpc` with `ActivityType.Listening` ("Listening to" activity type). Reconnects automatically every 30 s if Discord is not running. Requires `DISCORD_CLIENT_ID` (Application ID from the Discord Developer Portal).

### SMTC / mediaSession (`src/main/integrations/smtc.ts`)

Injects `navigator.mediaSession` into the Tidal WebContentsView via `executeJavaScript`. Chromium natively synchronises `mediaSession` with the Windows SMTC — no native addon, no recompilation needed. Works as-is in the electron-builder output.

---

## Build and packaging

```bash
npm run build     # typecheck + openapi:types + electron-vite build
npm run package   # build + electron-builder --dir + VMP sign + electron-builder --prepackaged
```

The signing is done explicitly between the two `electron-builder` calls via `npm run vmp:sign` (`scripts/vmpSign.cjs`). Using the `afterPack` hook would be too early: `electron-builder` embeds asar integrity hashes into the binary *after* `afterPack` runs, which would invalidate the VMP signature. The sequence is: build to directory → sign VMP → repackage from the pre-signed directory.

---

## Quick manual tests after a bridge change

1. `npm run dev`
2. Sign in to Tidal in the WebView.
3. Open [api-tester.html](api-tester.html) in a browser. Set the base URL to `http://127.0.0.1:7143`.
4. Click "Connect WS" → verify receipt of `now-playing`, `playback-state`, `auth-changed`.
5. Start a track → verify that `now-playing` contains the real `track.id` (numeric Tidal ID).
6. Search for a track and add it to the queue → verify `queue-changed` + `GET /queue`.
7. Test `next` / `previous` / keyboard media keys.
