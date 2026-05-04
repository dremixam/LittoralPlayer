import React, { useEffect, useState } from 'react';

/**
 * CorsPanel — rendered in a dedicated frameless child BrowserWindow.
 * Lets the user control which websites and web apps can use the local API.
 */
export function CorsPanel(): JSX.Element {
  const [origins, setOrigins] = useState<string[]>([]);
  const [allowAll, setAllowAll] = useState(false);
  const [allowFileOrigin, setAllowFileOrigin] = useState(true);
  const [host, setHost] = useState('127.0.0.1');
  const [savedHost, setSavedHost] = useState('127.0.0.1');
  const [savedPort, setSavedPort] = useState(7143);
  const [portInput, setPortInput] = useState('7143');
  const [portError, setPortError] = useState('');
  const [restarting, setRestarting] = useState(false);
  const [input, setInput] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    void Promise.all([
      window.tidalApp.getCorsOrigins(),
      window.tidalApp.getCorsAllowAll(),
      window.tidalApp.getCorsAllowFileOrigin(),
      window.tidalApp.getApiHost(),
    ]).then(([o, a, f, h]) => {
      setOrigins(o); setAllowAll(a); setAllowFileOrigin(f);
      setHost(h.host); setSavedHost(h.host);
      setSavedPort(h.port); setPortInput(String(h.port));
    });
  }, []);

  const isDirty = host !== savedHost || parseInt(portInput, 10) !== savedPort;

  const close = () => void window.tidalApp.closeCorsPanel();

  const handleToggleAllowAll = async (checked: boolean) => {
    await window.tidalApp.setCorsAllowAll(checked);
    setAllowAll(checked);
  };

  const handleToggleAllowFileOrigin = async (checked: boolean) => {
    await window.tidalApp.setCorsAllowFileOrigin(checked);
    setAllowFileOrigin(checked);
  };

  const applyListen = async (h: string, portStr: string) => {
    const p = parseInt(portStr, 10);
    if (!Number.isInteger(p) || p < 1024 || p > 65535) {
      setPortError('Port must be between 1024 and 65535');
      return;
    }
    setPortError('');
    setRestarting(true);
    await window.tidalApp.setApiHost(h);
    await window.tidalApp.setApiPort(p);
    const info = await window.tidalApp.restartApiServer();
    setSavedHost(h);
    setSavedPort(info.port);
    setHost(h);
    setPortInput(String(info.port));
    setRestarting(false);
  };

  const handleApplyListen = () => void applyListen(host, portInput);
  const handleReset = () => void applyListen('127.0.0.1', '7143');

  const handleAdd = async () => {
    const val = input.trim();
    if (!val) return;
    let parsed: URL;
    try {
      parsed = new URL(val.includes('://') ? val : `https://${val}`);
    } catch {
      setError('Invalid URL');
      return;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      setError('Only http:// and https:// are allowed');
      return;
    }
    setError('');
    const next = await window.tidalApp.addCorsOrigin(parsed.origin);
    setOrigins(next);
    setInput('');
  };

  const handleRemove = async (origin: string) => {
    const next = await window.tidalApp.removeCorsOrigin(origin);
    setOrigins(next);
  };

  return (
    <div style={styles.root}>

      {/* ── Header ── */}
      <div style={styles.header}>
        <span style={styles.title}>API access</span>
        <button style={styles.closeBtn} onClick={close} title="Close">✕</button>
      </div>

      {/* ── Server section ── */}
      <div style={styles.section}>
        <span style={styles.sectionTitle}>Server</span>
        <div style={styles.listenRow}>
          <select
            style={styles.select}
            value={host}
            onChange={e => setHost(e.target.value)}
          >
            <option value="127.0.0.1">127.0.0.1 — local only</option>
            <option value="0.0.0.0">0.0.0.0 — all interfaces (LAN)</option>
          </select>
          <span style={styles.colon}>:</span>
          <input
            style={styles.portInput}
            type="number"
            min={1024}
            max={65535}
            value={portInput}
            onChange={e => { setPortInput(e.target.value); setPortError(''); }}
          />
          <button style={styles.resetBtn} onClick={handleReset} title="Reset to defaults" disabled={restarting}>↺</button>
          <button style={styles.applyBtn} onClick={handleApplyListen} disabled={!isDirty || restarting}>
            {restarting ? '…' : 'Apply'}
          </button>
        </div>
        {portError && <p style={styles.error}>{portError}</p>}
        {host === '0.0.0.0' && (
          <div style={styles.warning}>
            <span style={styles.warningIcon}>⚠</span>
            <span>Listening on all interfaces allows other devices on your local network to control the player.</span>
          </div>
        )}
      </div>

      {/* ── CORS section ── */}
      <div style={styles.section}>
        <span style={styles.sectionTitle}>Allowed origins</span>
        <p style={styles.hint}>
          Websites and web apps listed below are allowed to control Littoral through its local API.
        </p>

        {/* Allow all */}
        <label style={styles.checkRow}>
          <input
            type="checkbox"
            checked={allowAll}
            onChange={e => void handleToggleAllowAll(e.target.checked)}
            style={styles.checkbox}
          />
          <div style={styles.checkContent}>
            <span style={styles.checkLabel}>Allow all origins</span>
            <span style={styles.checkDesc}>Any website you visit can control the player. Use with caution.</span>
          </div>
        </label>
        {allowAll && (
          <div style={styles.warning}>
            <span style={styles.warningIcon}>⚠</span>
            <span>Any website you visit will be able to control the player. Only enable this if you know what you're doing.</span>
          </div>
        )}

        {/* Local files */}
        <label style={styles.checkRow}>
          <input
            type="checkbox"
            checked={allowFileOrigin}
            onChange={e => void handleToggleAllowFileOrigin(e.target.checked)}
            style={styles.checkbox}
          />
          <div style={styles.checkContent}>
            <span style={styles.checkLabel}>Local files</span>
            <span style={styles.checkDesc}>Allows HTML files opened directly from your computer (file://) to use the API.</span>
          </div>
        </label>
      </div>

      {/* ── Per-origin list ── */}
      <ul style={{ ...styles.list, opacity: allowAll ? 0.4 : 1, pointerEvents: allowAll ? 'none' : 'auto' }}>
        {origins.length === 0 && (
          <li style={styles.empty}>No origins configured</li>
        )}
        {origins.map(o => (
          <li key={o} style={styles.item}>
            <span style={styles.originLabel}>{o}</span>
            <button style={styles.removeBtn} onClick={() => void handleRemove(o)} title="Remove">✕</button>
          </li>
        ))}
      </ul>
      <div style={{ ...styles.addRow, opacity: allowAll ? 0.4 : 1, pointerEvents: allowAll ? 'none' : 'auto' }}>
        <input
          style={styles.input}
          type="text"
          placeholder="https://example.com"
          value={input}
          onChange={e => { setInput(e.target.value); setError(''); }}
          onKeyDown={e => { if (e.key === 'Enter') void handleAdd(); }}
        />
        <button style={styles.addBtn} onClick={() => void handleAdd()}>Add</button>
      </div>
      {error && <p style={styles.error}>{error}</p>}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    height: '100vh',
    boxSizing: 'border-box',
    background: '#141414',
    border: '1px solid #2a2a2a',
    borderRadius: 8,
    padding: '14px 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    overflow: 'hidden',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
    color: '#eee',
    fontSize: 13,
    WebkitAppRegion: 'drag',
  } as React.CSSProperties,
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexShrink: 0,
  },
  title: { fontWeight: 600, fontSize: 13, color: '#eee', userSelect: 'none' },
  closeBtn: {
    background: 'none', border: 'none', color: '#666', cursor: 'pointer',
    fontSize: 14, padding: '2px 4px', lineHeight: 1,
    WebkitAppRegion: 'no-drag',
  } as React.CSSProperties,
  section: { display: 'flex', flexDirection: 'column', gap: 7, flexShrink: 0 },
  sectionTitle: {
    fontSize: 10, color: '#555', textTransform: 'uppercase',
    letterSpacing: '0.6px', userSelect: 'none', fontWeight: 600,
  },
  hint: { margin: 0, fontSize: 11, color: '#666', lineHeight: 1.5, userSelect: 'none' },
  listenRow: {
    display: 'flex', alignItems: 'center', gap: 5,
    WebkitAppRegion: 'no-drag',
  } as React.CSSProperties,
  select: {
    flex: 1, background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 4,
    color: '#eee', padding: '5px 6px', fontSize: 12, outline: 'none',
  },
  colon: { color: '#555', fontSize: 13 },
  portInput: {
    width: 58, background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 4,
    color: '#eee', padding: '5px 6px', fontSize: 12, outline: 'none', textAlign: 'center',
  },
  resetBtn: {
    background: 'none', color: '#555', border: '1px solid #2a2a2a',
    borderRadius: 4, padding: '4px 7px', cursor: 'pointer', fontSize: 14, flexShrink: 0,
    WebkitAppRegion: 'no-drag',
  } as React.CSSProperties,
  applyBtn: {
    background: '#1f3040', color: '#7fc7ff', border: '1px solid #234',
    borderRadius: 4, padding: '5px 10px', cursor: 'pointer', fontSize: 12, flexShrink: 0,
    WebkitAppRegion: 'no-drag',
  } as React.CSSProperties,
  checkRow: {
    display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer',
    WebkitAppRegion: 'no-drag',
  } as React.CSSProperties,
  checkbox: { accentColor: '#7fc7ff', cursor: 'pointer', width: 14, height: 14, marginTop: 2, flexShrink: 0 },
  checkContent: { display: 'flex', flexDirection: 'column', gap: 2 },
  checkLabel: { fontSize: 12, color: '#ccc', userSelect: 'none', lineHeight: 1.3 },
  checkDesc: { fontSize: 11, color: '#555', userSelect: 'none', lineHeight: 1.4 },
  warning: {
    display: 'flex', gap: 7, alignItems: 'flex-start',
    background: '#2a1a0a', border: '1px solid #5a3010', borderRadius: 4,
    padding: '7px 9px', fontSize: 11, color: '#e8a060', lineHeight: 1.45,
    flexShrink: 0,
    WebkitAppRegion: 'no-drag',
  } as React.CSSProperties,
  warningIcon: { flexShrink: 0, fontSize: 13, marginTop: 1 },
  list: {
    margin: 0, padding: 0, listStyle: 'none',
    display: 'flex', flexDirection: 'column', gap: 4,
    overflowY: 'auto', flex: 1, transition: 'opacity 0.2s',
    WebkitAppRegion: 'no-drag',
  } as React.CSSProperties,
  empty: { fontSize: 12, color: '#555', fontStyle: 'italic' },
  item: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    background: '#1a1a1a', borderRadius: 4, padding: '6px 8px',
    flexShrink: 0,
  },
  originLabel: { fontSize: 12, color: '#ccc', wordBreak: 'break-all' },
  removeBtn: {
    background: 'none', border: 'none', color: '#555', cursor: 'pointer',
    fontSize: 12, padding: '2px 4px', flexShrink: 0,
    WebkitAppRegion: 'no-drag',
  } as React.CSSProperties,
  addRow: {
    display: 'flex', gap: 6, flexShrink: 0, transition: 'opacity 0.2s',
    WebkitAppRegion: 'no-drag',
  } as React.CSSProperties,
  input: {
    flex: 1, background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 4,
    color: '#eee', padding: '6px 8px', fontSize: 12, outline: 'none',
  },
  addBtn: {
    background: '#1f3040', color: '#7fc7ff', border: '1px solid #234',
    borderRadius: 4, padding: '6px 10px', cursor: 'pointer', fontSize: 12, flexShrink: 0,
  },
  error: { margin: 0, fontSize: 11, color: '#e06c6c', flexShrink: 0 },
};
