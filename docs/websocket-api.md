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
   messages successifs : `now-playing`, `queue-changed`, `auth-changed`. Les
   payloads reflètent l'état courant lu depuis le store Redux du lecteur Tidal
   (avec fallback sur le cache local si la WebView n'est pas encore prête).
2. Ensuite, tout changement d'état déclenche un message du type approprié.
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

Émis à chaque changement de morceau, d'état (play/pause), ou de volume.

```json
{
  "type": "now-playing",
  "timestamp": "2025-01-20T14:32:11.123Z",
  "payload": {
    "state": "playing",                 // 'idle' | 'playing' | 'paused'
    "track": {
      "id": "12345678",                 // identifiant Tidal numérique (string)
      "title": "Title",
      "artists": [{ "id": "999", "name": "Artist" }],
      "album": { "id": "555", "title": "Album", "coverUrl": "https://..." },
      "coverUrl": "https://...",
      "durationSeconds": 213
    },
    "positionSeconds": 42.5,
    "durationSeconds": 213,
    "volume": 80,                       // 0..100
    "updatedAt": "2025-01-20T14:32:11.123Z"
  }
}
```

### `playback-state`

Émis quand l'état de lecture change (sans changement de morceau).

```json
{
  "type": "playback-state",
  "timestamp": "2025-01-20T14:32:11.123Z",
  "payload": { "state": "paused" }
}
```

### `track-changed`

Émis quand le morceau courant change (nouvelle piste, ou arrêt complet).

```json
{
  "type": "track-changed",
  "timestamp": "2025-01-20T14:32:11.123Z",
  "payload": {
    "track": { /* idem now-playing.track, ou absent si plus rien ne joue */ }
  }
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

### `queue-changed`

Émis chaque fois que la file d'attente Tidal change (ajout via
`/queue/enqueue`, drag&drop dans l'UI Tidal, lecture du morceau suivant qui
fait avancer le `currentIndex`, etc.). Les `items` listés sont les morceaux
**à venir** (le morceau en cours de lecture est exposé via `now-playing`).

```json
{
  "type": "queue-changed",
  "timestamp": "2025-01-20T14:32:11.123Z",
  "payload": {
    "items": [
      {
        "id": "<uid Tidal>",
        "trackId": "12345678",
        "addedAt": "",
        "track": { /* mêmes champs que now-playing.track */ }
      }
    ]
  }
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
      console.log('►', msg.payload.track?.title, msg.payload.state);
      break;
    case 'position':
      // mise à jour barre de progression
      break;
    case 'queue-changed':
      console.log('Queue:', msg.payload.items.length, 'item(s)');
      break;
  }
});
```

## Notes

- Le canal n'envoie pas l'historique : les événements survenus avant la
  connexion ne sont pas rejoués (sauf le snapshot initial).
- En cas de déconnexion, reconnecter et le snapshot initial vous resynchronise.
- Le bridge interne se reconnecte automatiquement au store Redux Tidal après
  navigation/rechargement de la WebView ; l'API WebSocket reste stable.
