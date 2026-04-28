import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
declare const chrome: any;

const isZh = (navigator.language || 'en').toLowerCase().startsWith('zh');
const T = {
  title: 'BNBot',
  connected: isZh ? '已连接到本地桥' : 'Connected to bnbot bridge',
  disconnected: isZh ? '未连接 — bnbot serve 未运行?' : 'Disconnected — is `bnbot serve` running?',
  reconnecting: isZh ? '正在重连...' : 'Reconnecting...',
  reconnect: isZh ? '重连' : 'Reconnect',
};

function Popup() {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  const fetchStatus = () => {
    try {
      chrome.runtime.sendMessage({ type: 'BNBOT_BRIDGE_GET_STATUS' }, (response: any) => {
        if (chrome.runtime.lastError) {
          setConnected(false);
          return;
        }
        setConnected(!!response?.connected);
      });
    } catch {
      setConnected(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 1500);
    return () => clearInterval(interval);
  }, []);

  const reconnect = () => {
    setBusy(true);
    setConnected(false);
    try {
      chrome.runtime.sendMessage({ type: 'BNBOT_BRIDGE_RECONNECT' });
    } catch { /* ignore */ }
    let attempts = 0;
    const poll = setInterval(() => {
      try {
        chrome.runtime.sendMessage({ type: 'BNBOT_BRIDGE_GET_STATUS' }, (response: any) => {
          if (chrome.runtime.lastError || response?.connected || ++attempts >= 6) {
            if (response) setConnected(response.connected);
            clearInterval(poll);
            setBusy(false);
          }
        });
      } catch {
        clearInterval(poll);
        setBusy(false);
      }
    }, 800);
  };

  const version = chrome.runtime?.getManifest?.()?.version || '';

  const dot: React.CSSProperties = {
    width: 9,
    height: 9,
    borderRadius: 999,
    flexShrink: 0,
    backgroundColor: connected ? 'var(--green)' : 'var(--gray)',
    animation: connected || connected === null ? 'none' : 'bnbot-breathe 2s ease-in-out infinite',
  };

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <img
          src={chrome.runtime.getURL('assets/images/icon-48.png')}
          width={28}
          height={28}
          style={{ borderRadius: 6 }}
          alt="BNBot"
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{ fontWeight: 600, fontSize: 15, color: 'var(--text)' }}>{T.title}</div>
          {version && (
            <div style={{ fontSize: 11, color: 'var(--text-mute)' }}>v{version}</div>
          )}
        </div>
      </div>

      {/* Status card */}
      <div
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          padding: '12px 14px',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <span style={dot} />
        <div style={{ flex: 1, fontWeight: 500 }}>
          {connected === null
            ? T.reconnecting
            : connected
              ? T.connected
              : busy
                ? T.reconnecting
                : T.disconnected}
        </div>
        {!connected && !busy && (
          <button
            onClick={reconnect}
            style={{
              appearance: 'none',
              border: '1px solid var(--border)',
              background: 'var(--bg)',
              color: 'var(--text)',
              fontSize: 11,
              padding: '4px 10px',
              borderRadius: 999,
              cursor: 'pointer',
              fontWeight: 500,
            }}
          >
            {T.reconnect}
          </button>
        )}
      </div>

    </div>
  );
}

const root = createRoot(document.getElementById('root')!);
root.render(<Popup />);
