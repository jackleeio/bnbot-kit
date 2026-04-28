import React from 'react';
import { Zap, TrendingUp, Wallet } from 'lucide-react';
import { Tab } from '../types';
import { useLanguage } from './LanguageContext';

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
  // automatically (see LanguageContext / ThemeContext). OpenClaw bridge
  // is enabled by default on the background side; version checks happen
  // through chrome.runtime regardless of UI surface.
  const showingLogin = false;
  const { t } = useLanguage();

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

  return (
    <div
      data-testid="bnbot-sidebar"
      style={{
        width: '100%',
        height: '52px',
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'flex-start',
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
    </div>
  );
};
