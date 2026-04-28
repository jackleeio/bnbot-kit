import React, { useEffect, useState } from 'react';
import { Zap, TrendingUp, Wallet, RefreshCw } from 'lucide-react';
import { Tab } from '../types';
import { useLanguage } from './LanguageContext';
declare const chrome: any;

interface SidebarProps {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
  onCollapse: () => void;
  currentTweetId?: string | null;
  tweetHighlightEnabled?: boolean;
  onToggleTweetHighlight?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onTabChange,
}) => {
  // Settings popover removed — language + theme now mirror the X page
  // automatically (see LanguageContext / ThemeContext). What's left here
  // is just a passive Local Bridge status indicator on the bottom-right.
  const showingLogin = false;
  const { t, language } = useLanguage();
  const [bridgeConnected, setBridgeConnected] = useState(false);

  // Poll bnbot bridge status every 3s. Cheap (background no-op when
  // already connected) and the only signal users have that the local
  // daemon is alive.
  useEffect(() => {
    const checkStatus = () => {
      try {
        chrome.runtime.sendMessage({ type: 'BNBOT_BRIDGE_GET_STATUS' }, (response: any) => {
          if (chrome.runtime.lastError) return;
          if (response) setBridgeConnected(response.connected);
        });
      } catch { /* extension context invalidated */ }
    };
    checkStatus();
    const interval = setInterval(checkStatus, 3000);
    return () => clearInterval(interval);
  }, []);

  const reconnectBridge = (e: React.MouseEvent) => {
    e.stopPropagation();
    try { chrome.runtime.sendMessage({ type: 'BNBOT_BRIDGE_RECONNECT' }); } catch { return; }
    setBridgeConnected(false);
    let attempts = 0;
    const poll = setInterval(() => {
      try {
        chrome.runtime.sendMessage({ type: 'BNBOT_BRIDGE_GET_STATUS' }, (response: any) => {
          if (chrome.runtime.lastError || response?.connected || ++attempts >= 5) {
            if (response) setBridgeConnected(response.connected);
            clearInterval(poll);
          }
        });
      } catch { clearInterval(poll); }
    }, 1000);
  };

  const navItems = [
    // Chat tab removed — chat lives in the bnbot desktop app now;
    // extension is pure browser executor.
    { id: Tab.ANALYSIS, icon: TrendingUp, label: t.sidebar.analysis },
    // Auto Reply tab removed — see /auto-reply, /inbox-watch skills.
    { id: Tab.BOOST, icon: Zap, label: t.sidebar.boost },
    // Drafts/Schedule tab removed — scheduling moved to `bnbot calendar` + launchd.
    // X_ANALYTICS tab removed — Analytics moved to bnbot desktop app.
    { id: Tab.X_BALANCE, icon: Wallet, label: t.common.xBalance },
  ];

  const bridgeLabel = language === 'zh' ? '本地桥' : 'Local Bridge';
  const bridgeStatus = bridgeConnected
    ? language === 'zh' ? '已连接' : 'connected'
    : language === 'zh' ? '未连接 — 点击重连' : 'disconnected — click to reconnect';

  return (
    <div
      data-testid="bnbot-sidebar"
      style={{
        width: '100%',
        height: '52px',
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: 'transparent',
        borderTop: '1px solid var(--border-color)',
        flexShrink: 0,
        zIndex: 20,
        padding: '0 16px',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'row', gap: '8px', alignItems: 'center' }}>
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => onTabChange(item.id)}
            className={`group relative w-9 h-9 flex items-center justify-center rounded-xl transition-colors cursor-pointer ${activeTab === item.id && !showingLogin
              ? 'bg-[var(--hover-bg)] text-[var(--text-primary)]'
              : 'bg-transparent text-[var(--text-secondary)] hover:bg-[var(--hover-bg)]'
              }`}
          >
            {item.label && (
              <span
                className="absolute bottom-full mb-2 px-3 py-1.5 bg-[var(--bg-primary)] text-[var(--text-primary)] text-xs font-medium rounded-lg border border-[var(--border-color)] opacity-0 group-hover:opacity-100 transition-all duration-150 whitespace-nowrap pointer-events-none z-50 group-hover:translate-y-0 translate-y-1"
                style={{ boxShadow: '0 4px 12px rgba(0, 0, 0, 0.05), 0 2px 4px rgba(0, 0, 0, 0.03)' }}
              >
                {item.label}
              </span>
            )}
            <item.icon
              size={item.id === Tab.CHAT ? 16 : 18}
              strokeWidth={activeTab === item.id && !showingLogin ? (item.id === Tab.CHAT ? 2.8 : 2.5) : 2}
            />
          </button>
        ))}
      </div>

      <button
        onClick={reconnectBridge}
        title={`${bridgeLabel} · ${bridgeStatus}`}
        className="group flex items-center gap-1.5 px-2 py-1 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--hover-bg)] transition-colors cursor-pointer"
      >
        <span className="text-[11px] font-medium tracking-wide">{bridgeLabel}</span>
        <span
          className="w-2 h-2 rounded-full"
          style={bridgeConnected
            ? { backgroundColor: '#22c55e' }
            : { backgroundColor: '#9ca3af', animation: 'bnbot-breathe 2s ease-in-out infinite' }
          }
        />
        <RefreshCw
          size={11}
          className="opacity-0 group-hover:opacity-100 transition-opacity"
        />
      </button>
    </div>
  );
};
