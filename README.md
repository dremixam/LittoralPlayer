# Littoral

Lecteur Tidal Electron qui :

- charge le lecteur web officiel `listen.tidal.com` dans une **`WebContentsView`** ;
- expose une **API HTTP locale** (REST + WebSocket) pour le contrôle, la recherche, la file d'attente et les notifications de playback ;
- utilise une spec **OpenAPI 3.1** comme source de vérité (validation des requêtes, génération des types TS).

Documentation complémentaire :

- [docs/websocket-api.md](docs/websocket-api.md) — format des events temps réel.
- [docs/maintenance-tidal.md](docs/maintenance-tidal.md) — **comment adapter Littoral quand `listen.tidal.com` évolue** (selectors DOM, slices Redux, actions, etc.).
- [docs/api-tester.html](docs/api-tester.html) — page HTML autonome pour tester l'API REST + WebSocket dans un navigateur.

## Stack

- **Castlabs Electron 33** (`electron-releases` — fork d'Electron incluant le CDM Widevine, indispensable pour décoder les flux DRM Tidal — sans ça : erreur `S6001`)
- `electron-vite` + TypeScript
- Renderer **React 18** (UI minimale = barre d'état + bouton login)
- API : **Express** + **`openapi-backend`** (validation depuis la spec) + **`ws`**
- Auth : **un seul login**, fait par l'utilisateur directement dans la WebView Tidal. Le token OAuth est ensuite extrait du `localStorage` de `listen.tidal.com` et réutilisé pour les appels catalogue (`api.tidal.com/v1`).

## Démarrage

```bash
npm install                                    # installe Castlabs Electron + deps
# .env (chargé automatiquement par electron-vite)
#   TIDAL_API_PORT=7143                         # port de l'API locale (défaut 7143)
npm run dev
```

Au premier lancement, Castlabs télécharge automatiquement le composant Widevine. Connectez-vous **dans le lecteur web Tidal** affiché dans la fenêtre — c'est la seule auth nécessaire. L'app détecte le token et l'utilise aussi pour les endpoints `/catalogue/*`.

L'API est joignable sur `http://127.0.0.1:7143`. Spec brute : `GET /openapi.yaml` (ou `/openapi.json`). **Documentation interactive Swagger UI : `http://127.0.0.1:7143/docs`**.

## Endpoints principaux

- `GET  /now-playing` — état courant
- `POST /playback/{play|pause|toggle|next|previous}`
- `POST /playback/seek`   `{ "positionSeconds": 42 }`
- `POST /playback/volume` `{ "volume": 80 }`
- `GET  /queue` · `POST /queue/enqueue` `{ "trackId": "...", "position": "end|next" }`  
  > La file exposée est la **vraie file d'attente du lecteur Tidal** (slice Redux `playQueue`). Les ajouts sont aussi pris en compte par les touches média ▶▶| et le bouton "next" du lecteur web.
- `GET  /catalogue/search?q=...&types=tracks,albums,artists,playlists&limit=20`
- `GET  /catalogue/tracks/{trackId}`
- `GET  /auth/status` · `POST /auth/login` (force la WebView vers la page de login Tidal) · `POST /auth/logout` (vide cookies + localStorage de la WebView)
- **WebSocket** `ws://127.0.0.1:7143/events` — push (`now-playing`, `playback-state`, `track-changed`, `position`, `queue-changed`, `auth-changed`).

À la connexion WebSocket, un snapshot complet est envoyé immédiatement.

## Architecture

```
src/
├── main/               # processus Electron principal
│   ├── api/            # Express + openapi-backend + WebSocket
│   ├── auth/           # Extraction du token Tidal depuis le localStorage de la WebView
│   ├── player/         # WebContentsView listen.tidal.com + script bridge injecté
│   ├── tidal/          # Client api.tidal.com/v1 (catalogue/search) avec le token de la WebView
│   ├── state/          # Store + EventBus typé
│   ├── ipc.ts          # ponts IPC main <-> renderer
│   └── settings.ts     # electron-store
├── preload/            # `window.tidalApp` exposé au renderer
├── renderer/           # UI React (barre supérieure 56px ; le reste = WebContentsView)
└── shared/             # modèles + constantes ; `api-types.ts` (généré depuis OpenAPI)
openapi/tidal-player-api.yaml  # source de vérité
```

### Contrôle du lecteur

Le main process injecte un script (`src/main/player/bridgeScript.ts`) dans la WebContentsView qui :

- lit l'état **directement depuis le store Redux Tidal** (slice `playbackControls` + `entities.tracks`/`albums`/`artists`) avec un fallback sur `navigator.mediaSession.metadata` ;
- pilote la **vraie file d'attente Tidal** (slice `playQueue`) via dispatch d'actions (précédé d'un `GET /v1/tracks/{id}/mix` indispensable) ;
- expose `window.__tidalControl.{play,pause,toggle,next,previous,seek,setVolume,enqueue,getNowPlaying,getQueue}` que le main appelle via `webContents.executeJavaScript` ;
- diffuse les snapshots/positions/changements de queue au main via le canal `tidal-bridge:message` (avec fallback `console.log('[TIDAL_BRIDGE]...')`).

> Tout ce qui dépend de la structure interne de Tidal (noms de slices, d'actions, sélecteurs DOM) est concentré dans `bridgeScript.ts`. Voir [docs/maintenance-tidal.md](docs/maintenance-tidal.md) pour la procédure de mise à jour quand Tidal évolue.

### Authentification (single login)

`src/main/auth/webviewToken.ts` parcourt en permanence (toutes les 5 s) les clés `_TIDAL_*` du `localStorage` de la WebView et y détecte un `accessToken`. Dès qu'il apparaît :

- il est persisté via `electron-store` (`settings.tokens`) ;
- `store.auth` passe à `authenticated: true` (avec `userId` et `countryCode` extraits) ;
- l'événement `auth-changed` est diffusé sur le WebSocket.

Le client catalogue (`src/main/tidal/catalogue.ts`) utilise ce token comme `Bearer` contre `https://api.tidal.com/v1/*` (la même API qu'utilise `listen.tidal.com`). Pas de second flow OAuth, pas de `client_id` à provisionner.

`POST /auth/logout` vide localStorage + cookies de la WebView et la renvoie sur la page de login.

## Génération des types depuis OpenAPI

```bash
npm run openapi:types   # -> src/shared/api-types.ts
```

## Notes DRM

Le streaming Tidal est protégé par **Widevine**. Le faire fonctionner depuis une app Electron tierce demande **trois ingrédients cumulatifs**, sans lesquels la lecture échoue avec l'erreur **S6001** ("This content cannot be played"). Sauter une seule de ces étapes = pas de son.

### 1. Castlabs Electron (au lieu d'Electron standard)

L'Electron officiel ne livre pas le CDM Widevine (licence Google). Castlabs `electron-releases` est un fork qui télécharge automatiquement le CDM au premier lancement.

```jsonc
// package.json (devDependencies) — déjà configuré
"electron": "github:castlabs/electron-releases#v41.1.1+wvcus"
```

> ⚠️ **Version minimum : v41.x+wvcus.** Les anciennes branches (v33 et antérieures) ne distribuent plus que la nouvelle "Google Widevine Windows CDM" via Media Foundation, **incompatible** avec le keysystem `com.widevine.alpha` que Tidal utilise. La v41 réinstalle bien le CDM legacy `oimompecagnajdejgnnjijobebaeigek` (v4.10.x), seul accepté par Tidal.

Le main process attend la disponibilité du CDM avant de créer la fenêtre :

```ts
import { app, components, BrowserWindow } from 'electron';
app.whenReady().then(async () => {
  await components.whenReady();      // installe / met à jour le CDM
  // ... createWindow()
});
```

### 2. Signature VMP personnelle via Castlabs EVS (obligatoire pour Tidal)

Le binaire Castlabs ECS est livré avec une signature VMP **développeur générique**. Tidal **rejette** cette signature (HTTP 400 sur `POST https://api.tidal.com/v2/widevine`), probablement parce qu'elle est partagée par trop d'apps non-officielles. Symptôme : la lecture démarre quelques secondes (le compteur défile) puis coupe avec S6001.

La solution est de signer le binaire Electron local avec **votre propre certificat VMP**, gratuit pour usage non-commercial via [Castlabs EVS](https://github.com/castlabs/electron-releases/wiki/EVS).

#### Setup une fois pour toutes

1. Installer le CLI EVS (Python 3 requis) :
   ```pwsh
   py -3 -m pip install --upgrade castlabs-evs
   ```
2. Créer un compte EVS et valider l'e-mail :
   ```pwsh
   py -3 -m castlabs_evs.account signup
   ```
3. Authentifier la session locale :
   ```pwsh
   py -3 -m castlabs_evs.account reauth
   ```

#### Signature automatique à chaque `npm install`

Un hook `postinstall` est déjà présent dans `package.json` :

```jsonc
"scripts": {
  "postinstall": "py -3 -m castlabs_evs.vmp sign-pkg node_modules/electron/dist || python -m castlabs_evs.vmp sign-pkg node_modules/electron/dist"
}
```

À chaque `npm install` (qui réécrit `node_modules/electron/dist/`), le binaire est re-signé automatiquement avec votre certificat. **Si vous clonez le repo sur une autre machine**, refaire les étapes 1-3 au préalable, puis `npm install` signera tout seul.

> ℹ️ La signature dure ~1500 jours et est mise en cache par EVS, donc les `npm install` suivants sont quasi-instantanés.

#### Signature manuelle ponctuelle

```pwsh
py -3 -m castlabs_evs.vmp sign-pkg node_modules/electron/dist
```

Après signature, **vider le cache CDM** pour forcer une renégociation propre :

```pwsh
Remove-Item "$env:APPDATA\Littoral\WidevineCdm","$env:APPDATA\Littoral\MediaFoundationWidevineCdm","$env:APPDATA\Littoral\component_crx_cache" -Recurse -Force
```

### 3. Compte Tidal HiFi / HiFi Plus actif

Sans abonnement payant, Tidal renvoie de toute façon S6001 sur les pistes streamées (les previews 30s peuvent passer).

### Récapitulatif checklist

| ✅ | Étape |
|----|------|
| ☐ | `npm install` avec Castlabs ≥ v41.x dans `package.json` |
| ☐ | Compte EVS créé (`evs.account signup` + validation e-mail) |
| ☐ | Session EVS active (`evs.account reauth`) |
| ☐ | Binaire signé (`postinstall` automatique ou manuel) |
| ☐ | Compte Tidal HiFi connecté dans la WebView |

Si la lecture échoue malgré tout : ouvrir DevTools sur la WebView Tidal (auto en dev), aller dans l'onglet Network, lancer une lecture et vérifier que `POST /v2/widevine` renvoie **200** (pas 400). Si toujours 400 → re-signer + vider cache CDM.

### Build de production

`electron-builder` re-extrait le binaire ; il faudra ajouter un hook `afterPack` qui appelle `evs-vmp sign-pkg` sur le dossier `app/resources/` final, et signer également l'app avec un cert Authenticode standard pour Windows. Voir le [wiki Castlabs](https://github.com/castlabs/electron-releases/wiki/EVS) pour les détails.

