import React, { useEffect, useState } from 'react';
import iconSrc from './icon.svg';
import type { ApiServerInfo, AuthStatus, NowPlaying, PlaybackState, Track } from '../../shared/models';

export function App(): JSX.Element {
  const [apiInfo, setApiInfo] = useState<ApiServerInfo | null>(null);
  const [auth, setAuth] = useState<AuthStatus>({ authenticated: false });
  const [track, setTrack] = useState<Track | undefined>(undefined);
  const [state, setState] = useState<PlaybackState>('idle');

  useEffect(() => {
    void window.tidalApp.getApiInfo().then(setApiInfo);
    void window.tidalApp.getAuthStatus().then(setAuth);
    void window.tidalApp.getNowPlaying().then((np: NowPlaying | null) => {
      if (np) { setTrack(np.track); setState(np.state); }
    });

    const off = window.tidalApp.onEvent(event => {
      switch (event.type) {
        case 'now-playing':
          setTrack(event.payload.track);
          break;
        case 'playback-state':
          setState(event.payload.state);
          break;
        case 'auth-changed':
          setAuth(event.payload);
          break;
      }
    });
    return off;
  }, []);

  const trackLabel = track
    ? `${track.title} — ${track.artists.map(a => a.name).join(', ')}`
    : '—';

  const docsUrl = apiInfo ? `${apiInfo.url}/docs` : null;

  return (
    <>
      <header style={styles.bar}>
        <div style={styles.left}>
          <img src={iconSrc} alt="Littoral" style={styles.icon} />
          <strong style={styles.brand}>Littoral</strong>
          <span style={styles.dim}>{state}</span>
          <span style={styles.track}>{trackLabel}</span>
        </div>
        <div style={styles.right}>
          {docsUrl && (
            <a
              href={docsUrl}
              onClick={(e) => {
                e.preventDefault();
                // Ouvre Swagger UI dans le navigateur par défaut (hors WebView Tidal).
                void window.tidalApp.openExternal(docsUrl);
              }}
              style={styles.link}
              title="Documentation API (Swagger UI)"
            >
              API docs
            </a>
          )}
          <span style={styles.dim}>{apiInfo ? apiInfo.url : '...'}</span>
          <button
            style={styles.iconBtn}
            onClick={() => void window.tidalApp.openCorsPanel()}
            title="Allowed CORS origins"
          >
            {/* Icône shield : outline + forme intérieure remplie */}
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
              {/* Outline */}
              <path
                d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
              {/* Forme intérieure remplie, légèrement réduite */}
              <path
                d="M12 3.5L5 7v4c0 4.25 2.95 8.22 7 9.42 4.05-1.2 7-5.17 7-9.42V7l-7-3.5z"
                fill="currentColor"
                opacity="0.85"
              />
            </svg>
          </button>
          {auth.authenticated ? (
            <button style={styles.btn} onClick={() => void window.tidalApp.logout()}>Disconnect</button>
          ) : (
            <button style={styles.btn} onClick={() => void window.tidalApp.startLogin()}>Sign in</button>
          )}
        </div>
      </header>
    </>
  );
}

const styles: Record<string, React.CSSProperties> = {
  bar: {
    height: 64,
    boxSizing: 'border-box',
    padding: '0 160px 0 16px', // 160px à droite : laisse la place aux boutons natifs (overlay) sur Windows
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    background: '#0a0a0a',
    borderBottom: '1px solid #1f1f1f',
    // Toute la barre est draggable (déplacement de la fenêtre), sauf les éléments interactifs.
    WebkitAppRegion: 'drag',
  } as React.CSSProperties,
  left: { display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, overflow: 'hidden' },
  right: { display: 'flex', alignItems: 'center', gap: 12, WebkitAppRegion: 'no-drag' } as React.CSSProperties,
  icon: { width: 28, height: 28, flexShrink: 0 },
  brand: { fontSize: 14, letterSpacing: 0.5 },
  track: { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '50vw' },
  dim: { color: '#888', fontSize: 12 },
  link: {
    color: '#7fc7ff', textDecoration: 'none', fontSize: 12, padding: '4px 8px',
    border: '1px solid #234', borderRadius: 4, WebkitAppRegion: 'no-drag',
  } as React.CSSProperties,
  iconBtn: {
    background: 'none', border: '1px solid #2a2a2a', color: '#888', cursor: 'pointer',
    borderRadius: 4, padding: '4px 6px', display: 'flex', alignItems: 'center',
    WebkitAppRegion: 'no-drag',
  } as React.CSSProperties,
  btn: {
    background: '#1f1f1f', color: '#eee', border: '1px solid #333',
    padding: '6px 12px', borderRadius: 4, cursor: 'pointer', WebkitAppRegion: 'no-drag',
  } as React.CSSProperties,
};
