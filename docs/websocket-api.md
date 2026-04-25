# API WebSocket — événements temps réel

L'application expose un canal WebSocket pour pousser les changements d'état du
lecteur (lecture, position, file d'attente, auth) sans polling.

## Endpoint

```
ws://127.0.0.1:<PORT>/events
```

Le port est celui du serveur HTTP de l'app (voir `/health` ou la log
`[api] listening on http://127.0.0.1:<PORT>` au démarrage). En général **8787**.

Aucune authentification requise (loopback only).

## Cycle de vie

1. À la connexion, le serveur envoie un **snapshot initial** sous forme de 3
   messages successifs : `now-playing`, `playback-state`, `auth-changed`. Les
   payloads reflètent l'état courant lu depuis le store Redux du lecteur Tidal
   (avec fallback sur le cache local si la WebView n'est pas encore prête).
2. Ensuite, chaque message n'est émis **que lorsque sa valeur change** :
   `now-playing` uniquement au changement de piste, `playback-state` uniquement
   au changement d'état (play ↔ pause).
3. Un `ping` WebSocket est envoyé toutes les 30 s pour maintenir la connexion.
   Le client doit y répondre par un `pong` (la plupart des libs le font
   automatiquement).

## Format des messages

Tous les messages sont du JSON UTF-8 avec la forme :

```json
{
  "type": "<type>",
  "timestamp": "<ISO-8601>",
  "payload": { ... }
}
```

### `now-playing`

Émis **uniquement lors d'un changement de piste** (identifiant Tidal différent).
Re-jouer la même piste après une pause **ne déclenche pas** cet événement.
Le payload contient les infos de la nouvelle piste ; l'état play/pause est
dans `playback-state`.

```json
{
  "type": "now-playing",
  "timestamp": "2025-01-20T14:32:11.123Z",
  "payload": {
    "track": {
      "id": "12345678",                 // identifiant Tidal numérique (string)
      "title": "Title",
      "artists": [{ "id": "999", "name": "Artist" }],
      "album": { "id": "555", "title": "Album", "coverUrl": "https://..." },
      "coverUrl": "https://...",
      "durationSeconds": 213
    }
  }
}
```

### `playback-state`

Émis **uniquement lors d'un changement d'état** (play ↔ pause). Ne se
déclenche pas si la piste change sans changement d'état.

```json
{
  "type": "playback-state",
  "timestamp": "2025-01-20T14:32:11.123Z",
  "payload": { "state": "paused" }     // 'idle' | 'playing' | 'paused'
}
```

### `position`

Émis périodiquement pendant la lecture (~1×/s) avec la position courante.

```json
{
  "type": "position",
  "timestamp": "2025-01-20T14:32:11.123Z",
  "payload": { "positionSeconds": 42.5, "durationSeconds": 213 }
}
```

### `auth-changed`

Émis quand le token Tidal est capturé/perdu.

```json
{
  "type": "auth-changed",
  "timestamp": "2025-01-20T14:32:11.123Z",
  "payload": {
    "authenticated": true,
    "scopes": ["r_usr", "w_usr"],
    "expiresAt": "2025-01-21T14:32:11.000Z",
    "userId": "1234567",
    "countryCode": "FR"
  }
}
```

## Exemple client (Node / navigateur)

```js
const ws = new WebSocket('ws://127.0.0.1:8787/events');

ws.addEventListener('message', (evt) => {
  const msg = JSON.parse(evt.data);
  switch (msg.type) {
    case 'now-playing':
      console.log('Nouvelle piste :', msg.payload.track?.title);
      break;
    case 'playback-state':
      console.log('État :', msg.payload.state); // 'playing' | 'paused' | 'idle'
      break;
    case 'position':
      // mise à jour barre de progression
      break;
    case 'auth-changed':
      console.log('Auth :', msg.payload.authenticated);
      break;
  }
});
```

## Notes

- Le canal n'envoie pas l'historique : les événements survenus avant la
  connexion ne sont pas rejoués (sauf le snapshot initial).
- En cas de déconnexion, reconnecter et le snapshot initial vous resynchronise.
- La file d'attente n'est pas diffusée par WebSocket ; consultez `GET /queue`
  pour la lire à la demande.
- Le bridge interne se reconnecte automatiquement au store Redux Tidal après
  navigation/rechargement de la WebView ; l'API WebSocket reste stable.
