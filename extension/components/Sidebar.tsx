import React, { useState, useRef, useEffect } from 'react';
import { Zap, TrendingUp, UserCircle, Sparkles, LogOut, Languages, AtSign, Crown, ScanEye, MessageSquare, Settings, Wallet, Send, Check, X, ExternalLink, BarChart3, RefreshCw } from 'lucide-react';
import { commandService } from '../services/commandService';
// telegramService removed — Telegram integration retired (was hidden UI).
import { SteeringWheel } from './icons/SteeringWheel';
import TextSwitch from './TextSwitch';
import { ThemeToggle } from './ThemeToggle';
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
  onCollapse,
  currentTweetId,
  tweetHighlightEnabled = false,
  onToggleTweetHighlight,
}) => {
  // Profile dropdown removed with the OAuth UI — no in-extension account
  // surface (no avatar, no email, no plan / credits, no in-UI logout).
  // Account state lives in CLI: `bnbot login` / `bnbot logout`.
  // `showingLogin` is also a leftover marker that older nav code reads to
  // dim the active-tab indicator while the login hint is showing — not
  // applicable here (no nav-driven login flow), keep `false`.
  const showingLogin = false;
  const [showSettings, setShowSettings] = useState(false);
  // Telegram state removed — integration retired.
  const [openclawConnected, setOpenclawConnected] = useState(false);
  const [openclawPort, setOpenclawPort] = useState(18900);
  const [updateAvailable, setUpdateAvailable] = useState<string | null>(null);
  const { language, toggleLanguage, t, setLanguage } = useLanguage();
  const currentVersion = chrome.runtime?.getManifest?.()?.version || '0.0.0';

  const navItems = [
    // Chat tab removed — chat lives in the bnbot desktop app now;
    // extension is pure browser executor. ChatPanel render path is
    // kept for legacy panel-to-chat transitions used elsewhere.
    { id: Tab.ANALYSIS, icon: TrendingUp, label: t.sidebar.analysis },
    // Auto Reply tab removed — see /auto-reply, /inbox-watch skills.
    { id: Tab.BOOST, icon: Zap, label: t.sidebar.boost },
    // Drafts/Schedule tab removed — scheduling moved to `bnbot calendar` + launchd.
    { id: Tab.X_ANALYTICS, icon: BarChart3, label: t.common.xAnalytics },
    { id: Tab.X_BALANCE, icon: Wallet, label: t.common.xBalance },
  ];

  // Check for extension updates on mount and when settings panel opens
  useEffect(() => {
    const checkUpdate = () => {
      try {
        chrome.runtime.sendMessage({ type: 'CHECK_FOR_UPDATES' }, (response: any) => {
          if (chrome.runtime.lastError) return; // context invalidated
          if (response?.updateAvailable && response.version) {
            setUpdateAvailable(response.version);
          }
        });
      } catch { /* extension context invalidated */ }
    };
    checkUpdate();
    // Re-check every 30 minutes
    const interval = setInterval(checkUpdate, 30 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  // Load OpenClaw port on mount
  useEffect(() => {
    try {
      chrome.storage.local.get(['openclawPort'], (result: { openclawPort?: number }) => {
        if (chrome.runtime.lastError) return;
        if (result.openclawPort !== undefined) setOpenclawPort(result.openclawPort);
      });
      chrome.storage.local.set({ openclawEnabled: true });
    } catch { /* extension context invalidated */ }
  }, []);

  // Poll OpenClaw connection status when settings panel is open
  useEffect(() => {
    if (!showSettings) return;
    const checkStatus = () => {
      try {
        chrome.runtime.sendMessage({ type: 'OPENCLAW_GET_STATUS' }, (response: any) => {
          if (chrome.runtime.lastError) return;
          if (response) setOpenclawConnected(response.connected);
        });
      } catch { /* extension context invalidated */ }
    };
    checkStatus();
    const interval = setInterval(checkStatus, 3000);
    return () => clearInterval(interval);
  }, [showSettings]);

  // Telegram bind/unbind/status effects + handlers removed — integration retired.

  // Profile menu / click-outside handlers removed with the profile button.

  return (
    <div data-testid="bnbot-sidebar" style={{ width: '100%', height: '52px', display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: 'transparent', borderTop: '1px solid var(--border-color)', flexShrink: 0, zIndex: 20, padding: '0 16px' }}>


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



      <div style={{ display: 'flex', flexDirection: 'row', gap: '8px', alignItems: 'center' }}>
        {/* Settings Button with Popover */}
        <div
          style={{ position: 'relative' }}
          onMouseEnter={() => setShowSettings(true)}
          onMouseLeave={() => setShowSettings(false)}
        >
          {showSettings && (
            <div
              style={{
                position: 'absolute',
                bottom: '36px',
                right: '0',
                zIndex: 100,
                paddingBottom: '12px',
                width: 'max-content'
              }}
            >
              <div
                style={{
                  backgroundColor: 'var(--bg-primary)',
                  borderRadius: '16px',
                  boxShadow: '0 4px 20px rgba(0, 0, 0, 0.15)',
                  padding: '8px',
                  minWidth: '200px',
                  border: '1px solid var(--border-color)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px'
                }}
              >
                {/* Theme Toggle */}
                <ThemeToggle displayMode="list" />

                <div className="flex items-center justify-between p-2 rounded-lg hover:bg-[var(--hover-bg)] transition-colors w-full cursor-pointer group">
                  <span className="text-[var(--text-primary)] text-[13px] font-medium pl-1">{t.common.language || 'Language'}</span>
                  <select
                    value={language}
                    onChange={(e) => setLanguage(e.target.value as 'en' | 'zh')}
                    onClick={(e) => e.stopPropagation()} // Prevent parent click if any
                    className="bg-transparent text-[13px] text-[var(--text-secondary)] border-none outline-none cursor-pointer text-right appearance-none"
                    style={{ backgroundImage: 'none' }} // Remove default arrow if creating custom, or keep it.
                  >
                    <option value="en">English</option>
                    <option value="zh">简体中文</option>
                  </select>
                  {/* Custom Arrow or let browser handle it? Browser is easiest for now, but appearance-none removes it. */}
                  {/* Let's use a simple styled select with standard appearance for reliability, or minimal. */}
                </div>

                {/* Local Bridge Status */}
                <div className="flex items-center justify-between p-2 rounded-lg hover:bg-[var(--hover-bg)] transition-colors w-full">
                  <div className="flex items-center gap-1.5 pl-1">
                    <span className="text-[var(--text-primary)] text-[13px] font-medium">
                      Local Bridge
                    </span>
                    <div
                      className="w-2 h-2 rounded-full"
                      style={openclawConnected
                        ? { backgroundColor: '#22c55e' }
                        : { backgroundColor: '#9ca3af', animation: 'bnbot-breathe 2s ease-in-out infinite' }
                      }
                    />
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpenclawConnected(false);
                      try { chrome.runtime.sendMessage({ type: 'OPENCLAW_RECONNECT' }); } catch { return; }
                      let attempts = 0;
                      const poll = setInterval(() => {
                        try { chrome.runtime.sendMessage({ type: 'OPENCLAW_GET_STATUS' }, (response: any) => {
                          if (chrome.runtime.lastError || response?.connected || ++attempts >= 5) {
                            if (response) setOpenclawConnected(response.connected);
                            clearInterval(poll);
                          }
                        }); } catch { clearInterval(poll); }
                      }, 1000);
                    }}
                    className="p-1 rounded hover:bg-[var(--hover-bg)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
                    title={language === 'zh' ? '刷新连接' : 'Refresh connection'}
                  >
                    <RefreshCw size={12} />
                  </button>
                </div>

                {/* Version & Update */}
                <div className="border-t border-[var(--border-color)] mt-1 pt-2 px-2 pb-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-[var(--text-secondary)]">v{currentVersion}</span>
                    {updateAvailable ? (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          chrome.runtime.reload();
                        }}
                        className="flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 rounded-full hover:bg-green-100 dark:hover:bg-green-900/40 transition-colors cursor-pointer"
                      >
                        <RefreshCw size={10} />
                        {language === 'zh' ? `更新 v${updateAvailable}` : `Update v${updateAvailable}`}
                      </button>
                    ) : (
                      <span className="text-[11px] text-[var(--text-secondary)]">
                        {language === 'zh' ? '已是最新' : 'Up to date'}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          <button
            className={`group w-9 h-9 flex items-center justify-center rounded-xl transition-colors cursor-pointer relative bg-transparent text-[var(--text-secondary)] hover:bg-[var(--hover-bg)] ${showSettings ? 'bg-[var(--hover-bg)] text-[var(--text-primary)]' : ''}`}
          >
            {/* Tooltip removed — gear icon is self-evident, hover label
                "设置" was visual noise. */}
            <Settings size={16} strokeWidth={showSettings ? 2.5 : 2} />
            {updateAvailable && (
              <div className="absolute top-0.5 right-0.5 w-2 h-2 bg-green-500 rounded-full" />
            )}
          </button>
        </div>
      </div>

    </div>
  );
};
