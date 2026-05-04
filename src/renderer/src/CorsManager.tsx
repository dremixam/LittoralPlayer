import React, { useEffect, useState } from 'react';

/**
 * CorsPanel — rendered in a dedicated frameless child BrowserWindow.
 * Lets the user control which websites and web apps can use the local API.
 */
export function CorsPanel(): JSX.Element {
  const [origins, setOrigins] = useState<string[]>([]);
  const [allowAll, setAllowAll] = useState(false);
  const [allowFileOrigin, setAllowFileOrigin] = useState(true);
  const [input, setInput] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    void Promise.all([
      window.tidalApp.getCorsOrigins(),
      window.tidalApp.getCorsAllowAll(),
      window.tidalApp.getCorsAllowFileOrigin(),
    ]).then(([o, a, f]) => { setOrigins(o); setAllowAll(a); setAllowFileOrigin(f); });
  }, []);

  const close = () => void window.tidalApp.closeCorsPanel();

  const handleToggleAllowAll = async (checked: boolean) => {
    await window.tidalApp.setCorsAllowAll(checked);
    setAllowAll(checked);
  };

  const handleToggleAllowFileOrigin = async (checked: boolean) => {
    await window.tidalApp.setCorsAllowFileOrigin(checked);
    setAllowFileOrigin(checked);
  };

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
      <div style={styles.header}>
        <span style={styles.title}>API access</span>
        <button style={styles.closeBtn} onClick={close} title="Close">✕</button>
      </div>
      <p style={styles.hint}>
        Websites and web apps listed below are allowed to control Littoral through its local API.
      </p>

      {/* Allow-all toggle */}
      <label style={styles.allowAllRow}>
        <input
          type="checkbox"
          checked={allowAll}
          onChange={e => void handleToggleAllowAll(e.target.checked)}
          style={styles.checkbox}
        />
        <span style={styles.allowAllLabel}>Allow all origins</span>
      </label>
      {allowAll && (
        <div style={styles.warning}>
          <span style={styles.warningIcon}>⚠</span>
          <span>
            Any website you visit will be able to control the player. Only enable this if you know what you're doing.
          </span>
        </div>
      )}

      {/* Local files toggle */}
      <label style={styles.allowAllRow}>
        <input
          type="checkbox"
          checked={allowFileOrigin}
          onChange={e => void handleToggleAllowFileOrigin(e.target.checked)}
          style={styles.checkbox}
        />
        <span style={styles.allowAllLabel}>Local files <span style={styles.hint2}>(HTML files opened from disk)</span></span>
      </label>

      {/* Per-origin list */}
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
          autoFocus
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
  hint: { margin: 0, fontSize: 11, color: '#666', lineHeight: 1.5, flexShrink: 0, userSelect: 'none' },
  allowAllRow: {
    display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, cursor: 'pointer',
    WebkitAppRegion: 'no-drag',
  } as React.CSSProperties,
  checkbox: { accentColor: '#7fc7ff', cursor: 'pointer', width: 14, height: 14 },
  allowAllLabel: { fontSize: 12, color: '#ccc', userSelect: 'none' },
  hint2: { fontSize: 11, color: '#555' },
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
