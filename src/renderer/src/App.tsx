import React, { useEffect, useState } from 'react';
import type { ApiServerInfo, AuthStatus, NowPlaying } from '../../shared/models';

export function App(): JSX.Element {
  const [apiInfo, setApiInfo] = useState<ApiServerInfo | null>(null);
  const [auth, setAuth] = useState<AuthStatus>({ authenticated: false });
  const [nowPlaying, setNowPlaying] = useState<NowPlaying | null>(null);

  useEffect(() => {
    void window.tidalApp.getApiInfo().then(setApiInfo);
    void window.tidalApp.getAuthStatus().then(setAuth);
    void window.tidalApp.getNowPlaying().then(setNowPlaying);

    const off = window.tidalApp.onEvent(event => {
      switch (event.type) {
        case 'now-playing':
          setNowPlaying(event.payload);
          break;
        case 'auth-changed':
          setAuth(event.payload);
          break;
      }
    });
    return off;
  }, []);

  const trackLabel = nowPlaying?.track
    ? `${nowPlaying.track.title} — ${nowPlaying.track.artists.map(a => a.name).join(', ')}`
    : '—';

  const docsUrl = apiInfo ? `${apiInfo.url}/docs` : null;

  return (
    <header style={styles.bar}>
      <div style={styles.left}>
        <strong style={styles.brand}>Littoral</strong>
        <span style={styles.dim}>{nowPlaying?.state ?? 'idle'}</span>
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
        {auth.authenticated ? (
          <button style={styles.btn} onClick={() => void window.tidalApp.logout()}>Déconnecter</button>
        ) : (
          <button style={styles.btn} onClick={() => void window.tidalApp.startLogin()}>Se connecter</button>
        )}
      </div>
    </header>
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
  brand: { fontSize: 14, letterSpacing: 0.5 },
  track: { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '50vw' },
  dim: { color: '#888', fontSize: 12 },
  link: {
    color: '#7fc7ff', textDecoration: 'none', fontSize: 12, padding: '4px 8px',
    border: '1px solid #234', borderRadius: 4, WebkitAppRegion: 'no-drag',
  } as React.CSSProperties,
  btn: {
    background: '#1f1f1f', color: '#eee', border: '1px solid #333',
    padding: '6px 12px', borderRadius: 4, cursor: 'pointer', WebkitAppRegion: 'no-drag',
  } as React.CSSProperties,
};
