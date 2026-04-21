import React, { useState, useRef, useEffect } from 'react';
import { Zap, TrendingUp, UserCircle, Sparkles, LogOut, Languages, AtSign, Crown, ScanEye, CalendarDays, MessageSquare, Settings, Wallet, Send, Check, X, ExternalLink, BarChart3, RefreshCw } from 'lucide-react';
import { commandService } from '../services/commandService';
import { telegramService, TelegramStatus } from '../services/telegramService';
import { SteeringWheel } from './icons/SteeringWheel';
import TextSwitch from './TextSwitch';
import { ThemeToggle } from './ThemeToggle';
import { Tab } from '../types';
import { useLanguage } from './LanguageContext';
import type { SubscriptionTier } from '../services/authService';

declare const chrome: any;

interface SidebarProps {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
  onCollapse: () => void;
  onProfileClick: () => void;
  onSignOut: () => void;
  onRefreshCredits?: () => Promise<void>;
  isLoggedIn: boolean;
  showingLogin: boolean;
  userCredits?: number;
  xBalance?: number;
  subscriptionTier?: SubscriptionTier;
  currentTweetId?: string | null;
  tweetHighlightEnabled?: boolean;
  onToggleTweetHighlight?: () => void;
  userEmail?: string;
  userName?: string;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onTabChange,
  onCollapse,
  onProfileClick,
  onSignOut,
  onRefreshCredits,
  isLoggedIn,
  showingLogin,
  userCredits = 0,
  xBalance = 0,
  subscriptionTier = 'free',
  currentTweetId,
  tweetHighlightEnabled = false,
  onToggleTweetHighlight,
  userEmail,
  userName
}) => {
  const [showMenu, setShowMenu] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [isLoadingCredits, setIsLoadingCredits] = useState(false);
  const [telegramStatus, setTelegramStatus] = useState<TelegramStatus | null>(null);
  const [telegramEnabled, setTelegramEnabled] = useState(false);
  const [isBindingTelegram, setIsBindingTelegram] = useState(false);
  const [openclawConnected, setOpenclawConnected] = useState(false);
  const [openclawPort, setOpenclawPort] = useState(18900);
  const [updateAvailable, setUpdateAvailable] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const { language, toggleLanguage, t, setLanguage } = useLanguage();
  const currentVersion = chrome.runtime?.getManifest?.()?.version || '0.0.0';

  const navItems = [
    // Chat tab removed — chat lives in the bnbot desktop app now;
    // extension is pure browser executor. ChatPanel render path is
    // kept for legacy panel-to-chat transitions used elsewhere.
    { id: Tab.ANALYSIS, icon: TrendingUp, label: t.sidebar.analysis },
    // Auto Reply tab removed — see /auto-reply, /inbox-watch skills.
    { id: Tab.BOOST, icon: Zap, label: t.sidebar.boost },
    { id: Tab.DRAFTS, icon: CalendarDays, label: t.sidebar.drafts },
    { id: Tab.X_ANALYTICS, icon: BarChart3, label: t.common.xAnalytics },
    { id: Tab.X_BALANCE, icon: Wallet, label: t.common.xBalance },
  ];

  // Check if profile button should show active state
  const isProfileActive = (isLoggedIn && activeTab === Tab.CREDITS) || showingLogin;

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

  // Load Telegram status on mount (for auto-connect WebSocket)
  useEffect(() => {
    console.log('[Sidebar] Mount effect, isLoggedIn:', isLoggedIn);
    if (isLoggedIn) {
      // Load saved toggle state
      chrome.storage.local.get(['telegramEnabled']).then((result: { telegramEnabled?: boolean }) => {
        console.log('[Sidebar] telegramEnabled from storage:', result.telegramEnabled);
        if (result.telegramEnabled !== undefined) {
          setTelegramEnabled(result.telegramEnabled);
        }
      });

      telegramService.getStatus().then(status => {
        console.log('[Sidebar] telegramStatus from API:', status);
        if (status) {
          setTelegramStatus(status);
          // Only auto-enable on first bind (when no saved preference)
          if (status.linked) {
            chrome.storage.local.get(['telegramEnabled']).then((result: { telegramEnabled?: boolean }) => {
              if (result.telegramEnabled === undefined) {
                // First time binding, auto-enable
                setTelegramEnabled(true);
                chrome.storage.local.set({ telegramEnabled: true });
              }
            });
          }
        }
      });
    }
  }, [isLoggedIn]);

  // Load Telegram status when settings panel opens (refresh)
  useEffect(() => {
    if (showSettings && isLoggedIn) {
      telegramService.getStatus().then(status => {
        if (status) {
          setTelegramStatus(status);
          // Only set enabled to true if already linked, don't turn off if user manually enabled
          if (status.linked) {
            setTelegramEnabled(true);
          }
        }
      });
    }
  }, [showSettings, isLoggedIn]);

  // Auto-connect WebSocket when Telegram is linked and enabled
  const wsConnectedRef = useRef(false);
  useEffect(() => {
    const shouldConnect = telegramStatus?.linked && telegramEnabled && isLoggedIn;

    if (shouldConnect && !wsConnectedRef.current) {
      // Connect WebSocket automatically
      console.log('[Sidebar] Connecting WebSocket...');
      wsConnectedRef.current = true;
      commandService.init({
        onConnected: () => console.log('[Sidebar] WebSocket connected for Telegram'),
        onDisconnected: () => {
          console.log('[Sidebar] WebSocket disconnected');
          wsConnectedRef.current = false;
        },
      });
      commandService.connect().then(result => {
        console.log('[Sidebar] WebSocket connect result:', result);
        if (!result) {
          wsConnectedRef.current = false;
        }
      });
    } else if (!shouldConnect && wsConnectedRef.current) {
      // Disconnect when disabled or unlinked
      wsConnectedRef.current = false;
      commandService.disconnect();
    }

    return () => {
      if (wsConnectedRef.current) {
        wsConnectedRef.current = false;
        commandService.disconnect();
      }
    };
  }, [telegramStatus?.linked, telegramEnabled, isLoggedIn]);

  // Handle Telegram binding
  const handleTelegramBind = async () => {
    setIsBindingTelegram(true);
    try {
      const linkData = await telegramService.getBindingLink();
      if (linkData) {
        telegramService.openBindingLink(linkData.deep_link);
        // Poll for status update
        const pollInterval = setInterval(async () => {
          const status = await telegramService.getStatus();
          if (status?.linked) {
            setTelegramStatus(status);
            setTelegramEnabled(true);
            setIsBindingTelegram(false);
            clearInterval(pollInterval);
          }
        }, 2000);
        // Stop polling after 60 seconds
        setTimeout(() => {
          clearInterval(pollInterval);
          setIsBindingTelegram(false);
        }, 60000);
      }
    } catch (error) {
      console.error('[Sidebar] Telegram bind error:', error);
      setIsBindingTelegram(false);
    }
  };

  // Handle Telegram unbind
  const handleTelegramUnbind = async () => {
    const success = await telegramService.unlink();
    if (success) {
      setTelegramStatus(null);
      setTelegramEnabled(false);
    }
  };

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowMenu(false);
      }
    };

    if (showMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showMenu]);

  const handleProfileButtonClick = () => {
    // Only handle click when not logged in (to show login)
    if (!isLoggedIn) {
      onProfileClick();
    }
    // When logged in, hover menu handles interactions
  };

  const handleCreditsClick = () => {
    setShowMenu(false);
    onTabChange(Tab.CREDITS);
  };

  const handleSignOutClick = () => {
    setShowMenu(false);
    onSignOut();
  };

  return (
    <div data-testid="bnbot-sidebar" style={{ width: '48px', display: 'flex', flexDirection: 'column', alignItems: 'center', backgroundColor: 'transparent', borderLeft: '1px solid var(--border-color)', flexShrink: 0, zIndex: 20, padding: '12px 0', height: '100%' }}>


      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', alignItems: 'center', width: '100%' }}>
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
                className="absolute right-full mr-2 px-3 py-1.5 bg-[var(--bg-primary)] text-[var(--text-primary)] text-xs font-medium rounded-lg border border-[var(--border-color)] opacity-0 group-hover:opacity-100 transition-all duration-150 whitespace-nowrap pointer-events-none z-50 group-hover:translate-x-0 translate-x-1"
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



      <div style={{ marginTop: 'auto', marginBottom: '16px', display: 'flex', flexDirection: 'column', gap: '16px', alignItems: 'center' }}>
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
                bottom: '0',
                right: '36px',
                zIndex: 100,
                paddingRight: '12px',
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

                {/* Telegram UI hidden — TODO: remove Telegram integration entirely (see TODO-remove-telegram.md) */}

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
            <span
              className="absolute right-full mr-2 px-3 py-1.5 bg-[var(--bg-primary)] text-[var(--text-primary)] text-xs font-medium rounded-lg border border-[var(--border-color)] opacity-0 group-hover:opacity-100 transition-all duration-150 whitespace-nowrap pointer-events-none z-50 group-hover:translate-x-0 translate-x-1"
              style={{ boxShadow: '0 4px 12px rgba(0, 0, 0, 0.05), 0 2px 4px rgba(0, 0, 0, 0.03)' }}
            >
              {t.common.settings || 'Settings'}
            </span>
            <Settings size={16} strokeWidth={showSettings ? 2.5 : 2} />
            {updateAvailable && (
              <div className="absolute top-0.5 right-0.5 w-2 h-2 bg-green-500 rounded-full" />
            )}
          </button>
        </div>
      </div>

      {/* Spacer to push User Profile to bottom */}
      <div style={{ flex: 0 }} />

      {/* User Profile Button with Menu */}
      <div
        ref={menuRef}
        style={{ position: 'relative' }}
        onMouseEnter={async () => {
          if (isLoggedIn) {
            setShowMenu(true);
            if (onRefreshCredits) {
              setIsLoadingCredits(true);
              await onRefreshCredits();
              setIsLoadingCredits(false);
            }
          }
        }}
        onMouseLeave={() => setShowMenu(false)}
      >
        {/* Profile Menu */}
        {showMenu && isLoggedIn && (
          <div
            style={{
              position: 'absolute',
              bottom: '0',
              right: '36px',
              zIndex: 100,
              // Transparent padding area to bridge gap with button
              paddingRight: '12px',
            }}
          >
            <div
              style={{
                backgroundColor: 'var(--bg-primary)',
                borderRadius: '16px',
                boxShadow: '0 4px 20px rgba(0, 0, 0, 0.15)',
                padding: '8px',
                minWidth: '180px',
                border: '1px solid var(--border-color)',
              }}
            >
              {/* User Info Section */}
              {(userName || userEmail) && (
                <div
                  style={{
                    width: '100%',
                    padding: '12px',
                    borderBottom: '1px solid var(--border-color)',
                    marginBottom: '8px',
                  }}
                >
                  {userName && (
                    <div style={{
                      fontSize: '14px',
                      fontWeight: 600,
                      color: 'var(--text-primary)',
                      marginBottom: '2px',
                    }}>
                      {userName}
                    </div>
                  )}
                  {userEmail && (
                    <div style={{
                      fontSize: '12px',
                      color: 'var(--text-secondary)',
                    }}>
                      {userEmail}
                    </div>
                  )}
                </div>
              )}

              {/* Subscription Tier Item */}
              <div
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '12px',
                  borderRadius: '12px',
                  backgroundColor: 'transparent',
                }}
              >
                <Crown size={18} style={{ color: subscriptionTier === 'pro' ? '#f59e0b' : 'var(--text-secondary)' }} />
                <span style={{ fontSize: '14px', fontWeight: 500, color: 'var(--text-primary)' }}>{t.common.subscription}</span>
                <span style={{
                  marginLeft: 'auto',
                  fontSize: '12px',
                  fontWeight: 600,
                  color: isLoadingCredits ? 'transparent' : subscriptionTier === 'pro' ? '#f59e0b' : subscriptionTier === 'basic' ? '#8b5cf6' : subscriptionTier === 'starter' ? '#3b82f6' : 'var(--text-secondary)',
                  backgroundColor: isLoadingCredits ? 'var(--border-color)' : subscriptionTier === 'pro' ? '#fef3c7' : subscriptionTier === 'basic' ? '#ede9fe' : subscriptionTier === 'starter' ? '#dbeafe' : 'var(--bg-secondary)',
                  padding: '2px 8px',
                  borderRadius: '9999px',
                  textTransform: 'capitalize',
                  minWidth: '56px',
                  width: 'fit-content',
                  textAlign: 'center',
                  display: 'inline-block',
                }}
                  className={isLoadingCredits ? 'animate-pulse' : ''}
                >
                  {isLoadingCredits ? '\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0' : t.common.subscriptionTiers[subscriptionTier]}
                </span>
              </div>

              {/* Credits Item */}
              <button
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  console.log('[BNBot] Credits clicked');
                  handleCreditsClick();
                }}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '12px',
                  borderRadius: '12px',
                  backgroundColor: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  transition: 'background-color 0.2s',
                }}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f9fafb'}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
              >
                <Sparkles size={18} style={{ color: 'var(--text-secondary)' }} />
                <span style={{ fontSize: '14px', fontWeight: 500, color: 'var(--text-primary)' }}>{t.common.credits}</span>
                <span style={{
                  marginLeft: 'auto',
                  fontSize: '13px',
                  fontWeight: 600,
                  color: isLoadingCredits ? 'transparent' : 'var(--text-primary)',
                  backgroundColor: isLoadingCredits ? 'var(--border-color)' : 'var(--bg-secondary)',
                  padding: '2px 8px',
                  borderRadius: '9999px',
                  minWidth: '56px',
                  width: '56px',
                  textAlign: 'center',
                  display: 'inline-block',
                }}
                  className={isLoadingCredits ? 'animate-pulse' : ''}
                >
                  {isLoadingCredits ? '\u00A0' : Math.floor(userCredits).toLocaleString()}
                </span>
              </button>

              {/* Sign Out Item */}
              <button
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  console.log('[BNBot] Sign out clicked');
                  handleSignOutClick();
                }}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '12px',
                  borderRadius: '12px',
                  backgroundColor: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  transition: 'background-color 0.2s',
                }}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--hover-bg)'}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
              >
                <LogOut size={18} style={{ color: 'var(--text-secondary)' }} />
                <span style={{ fontSize: '14px', fontWeight: 500, color: 'var(--text-primary)' }}>{t.common.signOut}</span>
              </button>
            </div>
          </div>
        )}

        {/* Profile Button */}
        <button
          onClick={handleProfileButtonClick}
          className={`group relative w-9 h-9 flex items-center justify-center rounded-xl transition-colors cursor-pointer ${isProfileActive || showMenu
            ? 'bg-[var(--hover-bg)] text-[var(--text-primary)]'
            : 'bg-transparent text-[var(--text-secondary)] hover:bg-[var(--hover-bg)]'
            }`}
        >
          <span
            className="absolute right-full mr-2 px-3 py-1.5 bg-[var(--bg-primary)] text-[var(--text-primary)] text-xs font-medium rounded-lg border border-[var(--border-color)] opacity-0 group-hover:opacity-100 transition-all duration-150 whitespace-nowrap pointer-events-none z-50 group-hover:translate-x-0 translate-x-1"
            style={{ boxShadow: '0 4px 12px rgba(0, 0, 0, 0.05), 0 2px 4px rgba(0, 0, 0, 0.03)' }}
          >
            {isLoggedIn ? t.common.profileMenu : t.common.signIn}
          </span>
          {isLoggedIn ? (
            <img
              src={`https://api.dicebear.com/7.x/thumbs/svg?seed=${userEmail || 'user'}`}
              alt="avatar"
              className="w-7 h-7 rounded-full object-cover"
            />
          ) : (
            <UserCircle size={18} strokeWidth={isProfileActive || showMenu ? 2.5 : 2} />
          )}
        </button>
      </div>

    </div>
  );
};
