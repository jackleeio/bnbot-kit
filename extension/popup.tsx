import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
declare const chrome: any;

const isZh = (navigator.language || 'en').toLowerCase().startsWith('zh');
const T = {
  title: 'BNBot',
  connected: isZh ? '已连接到本地 Agent' : 'Connected to local agent',
  disconnected: isZh ? '未连接到本地 Agent' : 'Local agent disconnected',
  reconnecting: isZh ? '正在重连...' : 'Reconnecting...',
  reconnect: isZh ? '重连' : 'Reconnect',
  downloadApp: isZh ? '下载 App' : 'Download App',
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

  const openDownload = () => {
    try {
      chrome.tabs.create({ url: 'https://bnbot.ai' });
    } catch {
      window.open('https://bnbot.ai', '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <div className="popup-shell">
      <div className="popup-header">
        <img
          src={chrome.runtime.getURL('assets/images/icon-48.png')}
          className="brand-icon"
          alt="BNBot"
        />
        <div className="brand-copy">
          <div className="brand-title">{T.title}</div>
          {version && (
            <div className="brand-version">v{version}</div>
          )}
        </div>
        <button
          onClick={openDownload}
          className="download-button"
        >
          {T.downloadApp}
        </button>
      </div>

      <div className="status-card">
        <span
          className="status-dot"
          data-state={
            connected ? 'connected' : (connected === null || busy) ? 'connecting' : 'disconnected'
          }
        />
        <div className="status-text">
          {connected === null
            ? T.reconnecting
            : connected
              ? T.connected
              : busy
                ? T.reconnecting
                : T.disconnected}
        </div>
        {!connected && !busy && connected !== null && (
          <button
            onClick={reconnect}
            className="reconnect-button"
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
