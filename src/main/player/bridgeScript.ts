/**
 * Script injecté dans la BrowserView qui charge listen.tidal.com.
 *
 * Stratégie :
 * - Utilise la Media Session API (navigator.mediaSession) que Tidal alimente
 *   pour récupérer les métadonnées du morceau et l'état playing/paused.
 * - Observe le <audio>/<video> sous-jacent pour position/duration.
 * - Fallback sur les sélecteurs DOM des contrôles du player pour play/pause/next/prev/seek/volume.
 *
 * Ce script communique avec le main process via `window.tidalBridge` (exposé par le preload de la view).
 */
export const PLAYER_BRIDGE_SCRIPT = String.raw`
(() => {
  if (window.__tidalBridgeInstalled) return;
  window.__tidalBridgeInstalled = true;

  const post = (msg) => {
    try { window.tidalBridge && window.tidalBridge.send(msg); }
    catch (e) { console.warn('[tidal-bridge] post failed', e); }
  };

  // --- Sélecteurs de contrôles (peuvent évoluer côté Tidal) ---
  const SELECTORS = {
    play: '[data-test="play"], button[aria-label="Play" i]',
    pause: '[data-test="pause"], button[aria-label="Pause" i]',
    next: '[data-test="next"], button[aria-label*="Next" i]',
    prev: '[data-test="previous"], button[aria-label*="Previous" i]',
    progressBar: '[data-test="progress-bar"], [role="slider"][aria-label*="seek" i]',
    volumeSlider: '[role="slider"][aria-label*="volume" i]',
  };

  const click = (sel) => {
    const el = document.querySelector(sel);
    if (el) { el.click(); return true; }
    return false;
  };

  // --- Récupération de l'élément <audio>/<video> actif ---
  // Tidal peut créer plusieurs <audio>/<video> (preview, MSE buffer, etc.).
  // On préfère celui qui joue, sinon celui qui a une duration valide, sinon le premier.
  const findMediaElement = () => {
    const els = [...document.querySelectorAll('audio, video')];
    if (!els.length) return undefined;
    return els.find(e => !e.paused) ||
      els.find(e => isFinite(e.duration) && e.duration > 0) ||
      els[0];
  };

  // --- Snapshot de l'état ---
  const trackFromMediaSession = () => {
    const m = navigator.mediaSession && navigator.mediaSession.metadata;
    if (!m) return undefined;
    const cover = m.artwork && m.artwork.length ? m.artwork[m.artwork.length - 1].src : undefined;
    return {
      id: m.title ? (m.title + '|' + (m.artist || '')) : undefined, // fallback : id stable basé sur titre/artiste
      title: m.title || '',
      artists: m.artist ? [{ id: m.artist, name: m.artist }] : [],
      album: m.album ? { id: m.album, title: m.album, coverUrl: cover } : undefined,
      coverUrl: cover,
      durationSeconds: 0, // complété par le media element
    };
  };

  let lastSnapshot = null;

  const snapshot = () => {
    const media = findMediaElement();
    const ms = navigator.mediaSession;
    const playbackState = ms ? ms.playbackState : 'none';
    const track = trackFromMediaSession();
    if (track && media && isFinite(media.duration)) track.durationSeconds = media.duration;

    // mediaSession.playbackState est la source la plus fiable (Tidal le maintient à jour).
    // L'élément <audio> peut être 'paused' alors que MSE buffer joue via Web Audio.
    let state = 'idle';
    if (playbackState === 'playing') state = 'playing';
    else if (playbackState === 'paused') state = 'paused';
    else if (media && !media.paused) state = 'playing';
    else if (media && media.paused && media.currentTime > 0) state = 'paused';
    // Fallback : si mediaSession a une metadata mais aucun état, considère playing.
    else if (track && playbackState === 'none') state = 'playing';

    return {
      state,
      track,
      positionSeconds: media ? media.currentTime : 0,
      durationSeconds: media && isFinite(media.duration) ? media.duration : undefined,
      volume: media ? Math.round((media.muted ? 0 : media.volume) * 100) : undefined,
    };
  };

  const sendSnapshot = () => {
    // Préfère l'état Redux si disponible (track avec id Tidal réel + métadonnées),
    // sinon fallback sur mediaSession.
    const s = nowPlayingFromRedux() || snapshot();
    const prevTrackId = lastSnapshot && lastSnapshot.track ? lastSnapshot.track.id : undefined;
    const newTrackId = s.track ? s.track.id : undefined;
    const stateChanged = !lastSnapshot || lastSnapshot.state !== s.state;
    const trackChanged = prevTrackId !== newTrackId;

    if (stateChanged || trackChanged) {
      post({ kind: 'snapshot', data: s });
    } else {
      post({ kind: 'position', data: { positionSeconds: s.positionSeconds, durationSeconds: s.durationSeconds } });
    }
    lastSnapshot = s;
  };

  // --- Hooks d'observation ---
  const attachMediaListeners = (el) => {
    if (!el || el.__tidalHooked) return;
    el.__tidalHooked = true;
    ['play', 'pause', 'ended', 'loadedmetadata', 'volumechange'].forEach(evt =>
      el.addEventListener(evt, () => sendSnapshot())
    );
    el.addEventListener('timeupdate', () => {
      // Throttlé naturellement par le navigateur (~4Hz)
      sendSnapshot();
    });
  };

  // Observe l'apparition de nouveaux media elements
  const mo = new MutationObserver(() => {
    const el = findMediaElement();
    if (el) attachMediaListeners(el);
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });

  // Observe les changements de metadata mediaSession (changement de morceau)
  if (navigator.mediaSession) {
    let lastMetaKey = '';
    setInterval(() => {
      const m = navigator.mediaSession.metadata;
      const k = m ? (m.title + '|' + m.artist + '|' + m.album) : '';
      if (k !== lastMetaKey) {
        lastMetaKey = k;
        sendSnapshot();
      }
    }, 1000);
  }

  // --- Accès au store Redux de Tidal pour piloter la queue interne ---
  // Cherche dans la fiber React un objet exposant dispatch/getState/subscribe.
  let cachedStore = null;

  // Parse une durée ISO 8601 type 'PT5M10S' en secondes.
  const parseDuration = (iso) => {
    if (!iso || typeof iso !== 'string') return 0;
    const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(iso);
    if (!m) return 0;
    return (Number(m[1])||0) * 3600 + (Number(m[2])||0) * 60 + (Number(m[3])||0);
  };

  // Construit un objet Track au format de notre API à partir des entities Redux.
  const buildTrack = (state, trackId) => {
    const id = String(trackId);
    const ents = state.entities || {};
    const tEnts = (ents.tracks && ents.tracks.entities) || {};
    const t = tEnts[id];
    if (!t) return { id, title: '', artists: [], durationSeconds: 0 };
    const attr = t.attributes || {};
    const rel = t.relationships || {};
    const aEnts = (ents.artists && ents.artists.entities) || {};
    const artistIds = ((rel.artists && rel.artists.data) || []).map(d => d.id);
    const artists = artistIds.map(aid => ({
      id: aid,
      name: (aEnts[aid] && aEnts[aid].attributes && aEnts[aid].attributes.name) || '',
    }));
    const albEnts = (ents.albums && ents.albums.entities) || {};
    const artEnts = (ents.artworks && ents.artworks.entities) || {};
    let album, coverUrl;
    const albumId = ((rel.albums && rel.albums.data) || [])[0] && rel.albums.data[0].id;
    if (albumId && albEnts[albumId]) {
      const ab = albEnts[albumId];
      album = { id: albumId, title: (ab.attributes && ab.attributes.title) || '' };
      const coverId = ((ab.relationships && ab.relationships.coverArt && ab.relationships.coverArt.data) || [])[0]
        && ab.relationships.coverArt.data[0].id;
      if (coverId && artEnts[coverId]) {
        const files = (artEnts[coverId].attributes && artEnts[coverId].attributes.files) || [];
        const f = files[files.length - 1] || files[0];
        if (f && f.href) { coverUrl = f.href; album.coverUrl = f.href; }
      }
    }
    return {
      id,
      title: attr.title || '',
      artists,
      album,
      coverUrl,
      durationSeconds: parseDuration(attr.duration),
    };
  };

  // Snapshot now-playing depuis Redux (plus fiable que mediaSession).
  const nowPlayingFromRedux = () => {
    const store = findReduxStore();
    if (!store) return null;
    const s = store.getState();
    const pc = s.playbackControls || {};
    const mp = pc.mediaProduct || {};
    const trackId = mp.productId;
    const track = trackId ? buildTrack(s, trackId) : undefined;
    let state = 'idle';
    if (pc.desiredPlaybackState === 'PLAYING') state = 'playing';
    else if (track) state = 'paused';
    // Si Redux n'a ni piste ni état de lecture actif (ex: lecture lancée via
    // "Aléatoire" avant que playbackControls soit hydraté), retourner null
    // pour laisser snapshot() (mediaSession) prendre le relais.
    if (!track && state === 'idle') return null;
    const media = findMediaElement();
    const positionSeconds = (typeof pc.latestCurrentTime === 'number')
      ? pc.latestCurrentTime
      : (media ? media.currentTime : 0);
    const durationSeconds = (track && track.durationSeconds) ||
      (media && isFinite(media.duration) ? media.duration : undefined);
    const volume = media ? Math.round((media.muted ? 0 : media.volume) * 100) : undefined;
    return { state, track, positionSeconds, durationSeconds, volume };
  };

  // Lit la file d'attente Tidal (éléments à venir, hors morceau courant).
  const queueFromRedux = () => {
    const store = findReduxStore();
    if (!store) return { items: [] };
    const s = store.getState();
    const elements = (s.playQueue && s.playQueue.elements) || [];
    const currentIndex = (s.playQueue && typeof s.playQueue.currentIndex === 'number')
      ? s.playQueue.currentIndex : -1;
    const upcoming = elements.slice(currentIndex + 1);
    return {
      items: upcoming.map(el => ({
        id: el.uid,
        trackId: String(el.mediaItemId),
        addedAt: '',
        track: buildTrack(s, el.mediaItemId),
      })),
    };
  };

  const findReduxStore = () => {
    if (cachedStore) return cachedStore;
    // Valide qu'on a bien LE store applicatif Tidal (et pas un store d'une lib
    // tierce). Le slice playQueue est la cible des dispatch d'enqueue —
    // c'est le seul indispensable. (playbackControls peut arriver plus tard.)
    const isTidalStore = (o) => {
      if (!o || typeof o !== 'object') return false;
      if (typeof o.dispatch !== 'function' ||
          typeof o.getState !== 'function' ||
          typeof o.subscribe !== 'function') return false;
      try {
        const st = o.getState();
        return !!(st && typeof st === 'object' && st.playQueue);
      } catch { return false; }
    };
    const roots = [document.getElementById('wimp'), document.getElementById('root'),
      ...document.body.children];
    const findFiberKey = (n) => n ? Object.keys(n).find(k =>
      k.startsWith('__reactContainer$') || k.startsWith('__reactFiber$')) : null;
    const collect = (fiber) => {
      const seen = new Set(); let found = null;
      const tryStore = (o) => {
        if (!found && isTidalStore(o)) found = o;
      };
      const visit = (f) => {
        if (!f || found || seen.size > 10000 || seen.has(f)) return;
        seen.add(f);
        for (const c of [f.memoizedProps, f.stateNode, f.memoizedState]) {
          if (!c || typeof c !== 'object') continue;
          tryStore(c); tryStore(c.store);
          if (c.value) { tryStore(c.value); tryStore(c.value.store); }
        }
        if (f.child) visit(f.child); if (f.sibling) visit(f.sibling);
      };
      let f = fiber; if (f && f.stateNode && f.stateNode.current) f = f.stateNode.current;
      visit(f); return found;
    };
    for (const r of roots) {
      if (!r) continue;
      const k = findFiberKey(r);
      if (!k) continue;
      const s = collect(r[k]);
      if (s) { cachedStore = s; installActionSpy(s); return s; }
    }
    return null;
  };

  // --- Spy Redux : capture les N dernières actions dispatch.
  //     Sert à découvrir les action types réels de Tidal pour reproduire
  //     l'enqueue (ex: cliquer "Add to queue" en natif puis getRecentActions). ---
  const RECENT_ACTIONS_MAX = 200;
  const recentActions = [];
  const installActionSpy = (s) => {
    if (s.__tidalSpyInstalled) return;
    s.__tidalSpyInstalled = true;
    const orig = s.dispatch.bind(s);
    s.dispatch = (action) => {
      try {
        if (action && typeof action === 'object' && action.type) {
          recentActions.push({ t: Date.now(), type: action.type, payload: action.payload });
          if (recentActions.length > RECENT_ACTIONS_MAX) recentActions.shift();
        }
      } catch (e) { /* ignore */ }
      return orig(action);
    };
  };

  // --- Commandes exposées au main process ---
  window.__tidalControl = {
    play: () => {
      const el = findMediaElement();
      if (el && el.paused) { el.play().catch(() => click(SELECTORS.play)); return true; }
      return click(SELECTORS.play);
    },
    pause: () => {
      const el = findMediaElement();
      if (el && !el.paused) { el.pause(); return true; }
      return click(SELECTORS.pause);
    },
    toggle: () => {
      const el = findMediaElement();
      if (el) { el.paused ? el.play() : el.pause(); return true; }
      return click(SELECTORS.pause) || click(SELECTORS.play);
    },
    next: () => click(SELECTORS.next),
    previous: () => click(SELECTORS.prev),
    seek: (seconds) => {
      const el = findMediaElement();
      if (el) { el.currentTime = Math.max(0, Number(seconds) || 0); return true; }
      return false;
    },
    setVolume: (vol01) => {
      const el = findMediaElement();
      if (el) { el.muted = false; el.volume = Math.max(0, Math.min(1, Number(vol01) || 0)); return true; }
      return false;
    },
    snapshot: () => snapshot(),
    /** Snapshot now-playing depuis le store Redux Tidal (plus complet que mediaSession). */
    getNowPlaying: () => nowPlayingFromRedux(),
    /** File d'attente Tidal (items à venir). */
    getQueue: () => queueFromRedux(),
    /** Retourne les N dernières actions Redux dispatchées (filtrables par regex). */
    getRecentActions: (filter) => {
      const re = filter ? new RegExp(filter, 'i') : null;
      return recentActions.filter(a => !re || re.test(a.type));
    },
    /** Vide le buffer d'actions récentes. */
    clearActions: () => { recentActions.length = 0; return true; },
    /** Dispatche une action arbitraire (debug). */
    dispatch: (action) => {
      const s = findReduxStore();
      if (!s) return false;
      try { s.dispatch(action); return true; } catch (e) { return false; }
    },
    /** Retourne les clés top-level du state Redux (debug). */
    getStateKeys: () => {
      const s = findReduxStore();
      if (!s) return null;
      try { return Object.keys(s.getState()); } catch (e) { return null; }
    },
    /** Retourne une "tranche" du state à un chemin donné, ex: "entities.tracks.622469" (debug). */
    getStateAt: (path) => {
      const s = findReduxStore();
      if (!s) return null;
      try {
        const parts = String(path || '').split('.').filter(Boolean);
        let v = s.getState();
        for (const p of parts) { if (v == null) return null; v = v[p]; }
        return v;
      } catch (e) { return null; }
    },
    /**
     * Ajoute une piste dans la file d'attente Tidal.
     *
     * Le reducer playQueue ignore silencieusement un mediaItemId dont l'entité
     * n'est pas dans entities.tracks. Tidal ne charge pas les tracks via un
     * endpoint RTKQ unitaire : l'hydratation se fait par effet de bord des
     * réponses de pages (album, playlist, feed, /track/X, ...).
     *
     * Stratégie pour rendre disponible une piste arbitraire :
     *   1) Si entities.tracks[id] est déjà présent → enqueue direct.
     *   2) Sinon : sauvegarde le path courant, push '/track/<id>' (ce qui
     *      déclenche les sagas qui peuplent entities.tracks), poll jusqu'à
     *      apparition de l'entité (≈100-300ms en général), restaure le path
     *      original, puis dispatch l'enqueue.
     *
     * Le bref flash sur la page de track est inévitable tant qu'on ne connaît
     * pas l'action saga interne qui hydrate l'entité sans navigation.
     */
    enqueue: (trackId, position, sourceContext) => {
      const diag = {
        step: 'init', ok: false, before: -1, after: -1, errors: [],
        hasStore: false, sourceContext: null, cached: false,
        prevPath: null, hydrateMs: -1,
      };
      const store = findReduxStore();
      diag.hasStore = !!store;
      if (!store) { diag.errors.push('store not found'); return Promise.resolve(diag); }
      const id = Number(trackId);
      if (!Number.isFinite(id)) { diag.errors.push('invalid trackId'); return Promise.resolve(diag); }
      const before = ((store.getState().playQueue && store.getState().playQueue.elements) || []).length;
      diag.before = before;

      const isCached = () => {
        try {
          const ents = store.getState().entities;
          const map = ents && ents.tracks && ents.tracks.entities;
          return !!(map && map[String(id)]);
        } catch (e) { return false; }
      };

      const ctx = sourceContext && typeof sourceContext === 'object'
        ? sourceContext
        : { id: '', type: 'UNKNOWN' };
      diag.sourceContext = ctx;

      const doEnqueue = () => {
        try {
          store.dispatch({
            type: 'playQueue/ADD_MEDIA_ITEMS_TO_QUEUE',
            payload: {
              mediaItemIds: [id],
              position: position === 'last' ? 'last' : 'next',
              sourceContext: ctx,
            },
          });
        } catch (e) { diag.errors.push('dispatch failed: ' + (e && e.message)); }
      };

      const finalize = () => new Promise(r => setTimeout(r, 800)).then(() => {
        try {
          const after = ((store.getState().playQueue && store.getState().playQueue.elements) || []).length;
          diag.after = after;
          diag.ok = after > before;
        } catch (e) { diag.errors.push('finalize failed: ' + (e && e.message)); }
        return diag;
      });

      if (isCached()) {
        diag.cached = true;
        diag.step = 'cached';
        doEnqueue();
        return finalize();
      }

      // Hydratation via navigation invisible : on capture le path courant
      // pour le restaurer dès que l'entité apparaît.
      let prevPath = '/';
      try {
        const loc = window.location;
        prevPath = (loc.pathname || '/') + (loc.search || '') + (loc.hash || '');
      } catch (e) { /* ignore */ }
      diag.prevPath = prevPath;

      try {
        store.dispatch({ type: 'router/PUSH', payload: '/track/' + id });
        diag.step = 'pushed';
      } catch (e) {
        diag.errors.push('push failed: ' + (e && e.message));
        return Promise.resolve(diag);
      }

      return new Promise(resolve => {
        let elapsed = 0;
        const STEP = 30;
        const TIMEOUT = 3000;
        const tick = () => {
          if (isCached()) {
            diag.hydrateMs = elapsed;
            diag.step = 'hydrated';
            try { store.dispatch({ type: 'router/PUSH', payload: prevPath }); }
            catch (e) { diag.errors.push('restore failed: ' + (e && e.message)); }
            doEnqueue();
            finalize().then(resolve);
            return;
          }
          elapsed += STEP;
          if (elapsed >= TIMEOUT) {
            diag.step = 'hydrate-timeout';
            try { store.dispatch({ type: 'router/PUSH', payload: prevPath }); } catch (e) { /* ignore */ }
            doEnqueue();
            finalize().then(resolve);
            return;
          }
          setTimeout(tick, STEP);
        };
        tick();
      });
    },
  };

  // --- Subscription Redux : désactivée. Les events WebSocket sont alimentés
  //     par un polling côté main qui appelle getNowPlaying() périodiquement.
  //     La file d'attente est lue à la demande via REST GET /queue. ---

  // Premier ping
  setTimeout(sendSnapshot, 1000);
  console.log('[tidal-bridge] installed');
})();
`;
