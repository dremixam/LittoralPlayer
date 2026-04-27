# Maintenance — adapter Littoral aux évolutions du lecteur Tidal

Ce document explique **où regarder** quand quelque chose casse parce que
`listen.tidal.com` a changé. Tidal est une SPA React/Redux : leurs noms de
slice, d'action ou la structure du DOM peuvent bouger. Tout le code qui
"sait" comment Tidal est fait est concentré dans **un seul fichier** :
[src/main/player/bridgeScript.ts](../src/main/player/bridgeScript.ts).

## Architecture du contrôle

```
Renderer/API  ──IPC/HTTP──▶  Main process  ──executeJavaScript──▶  WebContentsView (listen.tidal.com)
                                                                       │
                                                                       └─ window.__tidalControl  (injecté par bridgeScript.ts)
```

Aucun code "métier Tidal" n'est dupliqué côté main : tout ce qui touche au
DOM/Redux de Tidal est exécuté **dans la WebView**, via le script injecté.
Les handlers HTTP appellent des wrappers TypeScript (`playerControl.*`) qui
font juste `executeJavaScript('window.__tidalControl.xxx()')`.

## Ce que le bridge fait — par fonctionnalité

| Fonction                | Mécanisme actuel                                         | Risque de cassure |
|-------------------------|----------------------------------------------------------|-------------------|
| play / pause / toggle   | Manipulation directe du `<audio>`/`<video>` actif. Fallback : clic sur `[data-test="play|pause"]`. | Faible |
| next / previous         | Clic sur `[data-test="next"]` / `[data-test="previous"]` | Moyen — sélecteurs DOM |
| seek                    | `mediaElement.currentTime = …`                           | Faible |
| volume                  | `mediaElement.volume = …`                                | Faible |
| now-playing (rich)      | Lecture de `state.playbackControls.mediaProduct` + `state.entities.tracks/artists/albums` du store Redux | **Élevé** — noms de slice/clé spécifiques |
| now-playing (fallback)  | `navigator.mediaSession.metadata` + `mediaElement.currentTime/duration` | Faible |
| queue (lecture)         | `state.playQueue.elements` du store Redux                 | **Élevé** |
| queue (ajout)           | `dispatch({ type: 'playQueue/ADD_MEDIA_ITEMS_TO_QUEUE', payload: { mediaItemIds, position, sourceContext } })` précédé d'une navigation interne vers `/track/<id>` (via `router/PUSH`) si l'entité n'est pas dans `entities.tracks` | **Élevé** — schéma d'action fragile |
| événements WebSocket    | `store.subscribe()` détecte les changements du slice `playQueue`, ré-émet vers le main | Élevé |

## Trouver le store Redux

`findReduxStore()` parcourt la fiber React des roots `#wimp`, `#root`, et
`document.body.children`, à la recherche d'un objet exposant
`{ dispatch, getState, subscribe }`. Tant que Tidal reste sur React+Redux,
ça marche.

**Si ça ne marche plus :**
1. Ouvrir DevTools sur la WebView (mode dev → DevTools s'ouvre auto).
2. Dans la console : `findReduxStore()` (le bridge expose les helpers
   localement : tape simplement `__tidalControl.snapshot()` pour voir si
   le store est trouvé).
3. Si non : inspecter `document.body.children`, repérer le nœud racine de
   l'app Tidal et examiner sa fiber (`Object.keys(node)` → clés
   `__reactContainer$xxx` ou `__reactFiber$xxx`).

## Trouver les noms d'action / slices

Quand Tidal renomme une action, tout `dispatch({ type: '...' })` du
bridge échoue silencieusement. Pour trouver le **nouveau nom** :

1. Dans la WebView, ouvrir DevTools → Console.
2. Patcher `dispatch` pour logger toutes les actions :
   ```js
   const s = /* trouver le store, voir ci-dessus */;
   const orig = s.dispatch;
   s.dispatch = (a) => { console.log('[ACTION]', a.type, a.payload); return orig(a); };
   ```
3. Effectuer l'action UI dans le lecteur Tidal (clic sur "Ajouter à la file
   d'attente", etc.).
4. Repérer le `type` qui apparaît dans la console — c'est le nouveau nom à
   utiliser dans le bridge.

> Cette technique a été utilisée pour identifier
> `playQueue/ADD_MEDIA_ITEMS_TO_QUEUE` et le préalable `GET /v1/tracks/{id}/mix`
> (sans lequel le reducer rejette silencieusement l'ajout).

## Sélecteurs DOM (fallback play/pause/next/prev)

Définis en haut de `bridgeScript.ts` (`const SELECTORS = { ... }`). Si Tidal
modifie ses `data-test` ou ses `aria-label`, mettre à jour cette table
suffit.

Pour trouver le bon sélecteur :
1. Inspecter le bouton dans DevTools (Ctrl+Shift+C).
2. Préférer `data-test="..."` (Tidal utilise cet attribut pour ses tests
   internes — relativement stable). Sinon `[aria-label*="..."]`.

## Schéma des entités (tracks/albums/artists)

Le bridge lit dans `state.entities.tracks.entities[id].attributes.{title,duration}`
et `state.entities.tracks.entities[id].relationships.{artists,albums}.data[].id`.
C'est le format **JSON:API** standard utilisé par la nouvelle Tidal Open
Platform API (slice `tidalOpenPlatformApi` côté RTK Query).

Si le schéma change (ex. nouvelle clé `attributes.name`), regarder dans
DevTools :
```js
__tidalControl.snapshot();   // imprime la state shape vue par le bridge
```
Ou directement :
```js
findReduxStore().getState().entities;
```

## Token Tidal (auth)

Extraction depuis le `localStorage` de la WebView. Voir
[`src/main/auth/webviewToken.ts`](../src/main/auth/webviewToken.ts). Cherche
les clés commençant par `_TIDAL_` qui contiennent un `accessToken`. Si
Tidal change le préfixe, ajuster ici.

## Procédure de mise à jour générale

1. Reproduire le bug (la file d'attente ne s'ajoute plus, le now-playing
   est vide, etc.).
2. Vérifier dans DevTools : est-ce le store Redux qui n'est plus trouvé
   (`__tidalControl.snapshot()` renvoie `null`) ou la structure interne ?
3. Si store introuvable → revoir `findReduxStore()`.
4. Si action rejetée → patcher `dispatch` (voir ci-dessus) pour identifier
   le nouveau nom.
5. Si la structure d'entité a changé → ajuster `buildTrack()` /
   `nowPlayingFromRedux()` / `queueFromRedux()`.
6. Mettre à jour ce document avec le nouveau comportement.

## Tests manuels rapides après changement

1. `npm run dev`
2. Se connecter à Tidal dans la WebView.
3. Ouvrir [docs/api-tester.html](api-tester.html) dans un navigateur (ou
   dépose-le sur le navigateur). Définir l'URL de base (`http://127.0.0.1:7143`).
4. Cliquer "Connect WS" → vérifier qu'on reçoit `now-playing`,
   `queue-changed`, `auth-changed` immédiatement.
5. Lancer une lecture dans la WebView Tidal → l'event `now-playing` doit
   apparaître avec le **vrai** `track.id` (numérique Tidal).
6. Rechercher un morceau, cliquer "+ queue" sur un résultat → vérifier que
   `queue-changed` arrive et que `GET /queue` reflète la nouvelle file.
7. Tester `next` / `previous` / les touches média ▶▶| du clavier.
