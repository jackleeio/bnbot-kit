import React, { useState, useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
// Sidebar removed — bottom nav is gone; X_Balance entry moved into BoostPanel
// header (top-left wallet icon).
// ChatPanel removed — chat now lives in bnbot CLI / desktop app.
// Extension popup is BoostPanel-only (boost queue + wallet).
import { BoostPanel } from './components/panels/BoostPanel';
// AnalysisPanel removed — KOL pulse moved to bnbot skill `/kol-pulse`
// (skills/kol-pulse/SKILL.md). Extension no longer hosts the trends UI.
// CreditsPanel removed — subscription / credits managed via CLI / desktop app
// (extension is a thin browser executor, no account UI).
// LoginPanel / LoginModal removed — extension is auth-free.
// SchedulePanel removed — scheduling lives in `bnbot calendar` + macOS launchd
// (skill: /schedule). Extension no longer hosts the calendar UI.
// AutoPilotPanel removed — autopilot lives in bnbot CLI /auto-reply + /inbox-watch skills.
import { XBalancePanel } from './components/panels/XBalancePanel';
// XAnalyticsPanel removed — Analytics moved to bnbot desktop app
// (packages/desktop/src/components/AnalyticsPane.tsx).
import { Tab } from './types';
// twitterUtils sidebar mutators removed — popup is a floating card now,
// no need to mutate X's right column / left nav layout.
import { TweetObserver } from './utils/TweetObserver';

import { ThemeProvider, useTheme } from './components/ThemeContext';
import { LanguageProvider, useLanguage } from './components/LanguageContext';

const ACTIVE_TAB_STORAGE_KEY = 'bnbot_active_tab';

declare const chrome: any;


function AppContent() {
  const { theme } = useTheme();
  const { t } = useLanguage();
  const [activeTab, setActiveTab] = useState<Tab>(Tab.BOOST);
  const [tabInitialized, setTabInitialized] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [currentTweetId, setCurrentTweetId] = useState<string | null>(null);
  const [previousTab, setPreviousTab] = useState<Tab | null>(null);
  const [tweetHighlightEnabled, setTweetHighlightEnabled] = useState(true);
  // Popup bottom/right follow the FAB's dynamic position. Updated via
  // `bnbot-fab-aligned` event broadcast by BnbotFabInjector. Defaults
  // match the CSS fallback so the first paint isn't a jump.
  const [fabPosition, setFabPosition] = useState({ bottom: 90, right: 20, height: 40 });
  const [showCollapseButton, setShowCollapseButton] = useState(true);
  const [collapseButtonHovered, setCollapseButtonHovered] = useState(false);
  const [isArticleFocusMode, setIsArticleFocusMode] = useState(false);
  const [isArticleEditorMode, setIsArticleEditorMode] = useState(false);
  const [tweetContextInitialMode, setTweetContextInitialMode] = useState<'agent' | 'boost'>('agent');
  const [pendingContextAction, setPendingContextAction] = useState<string | null>(null);

  const [boostPanelTweetId, setBoostPanelTweetId] = useState<string | null>(null);
  // Use ref with timestamp to track "stay on page" - valid for 1 second after being set
  const chatStayOnPageTimestampRef = useRef<number>(0);
  const tweetObserverRef = useRef<TweetObserver | null>(null);

  // Restore saved tab on mount
  useEffect(() => {
    const restoreTab = async () => {
      try {
        if (typeof chrome !== 'undefined' && chrome.storage?.local) {
          const result = await chrome.storage.local.get(ACTIVE_TAB_STORAGE_KEY);
          const savedTab = result[ACTIVE_TAB_STORAGE_KEY];
          if (savedTab && Object.values(Tab).includes(savedTab)) {
            setActiveTab(savedTab as Tab);
          }
        } else {
          const savedTab = localStorage.getItem(ACTIVE_TAB_STORAGE_KEY);
          if (savedTab && Object.values(Tab).includes(savedTab as Tab)) {
            setActiveTab(savedTab as Tab);
          }
        }
      } catch (e) {
        console.warn('[BNBot] Failed to restore active tab:', e);
      }
      setTabInitialized(true);
    };
    restoreTab();
  }, []);

  // Listen for pending article to publish after navigation to articles page
  useEffect(() => {
    let lastUrl = window.location.href;
    let processing = false;

    const processPendingArticle = async () => {
      if (processing) return;

      const currentUrl = window.location.href;
      if (!currentUrl.includes('/compose/articles')) return;

      const pendingData = localStorage.getItem('bnbot_pending_article');
      if (!pendingData) return;

      processing = true;
      console.log('[App] Found pending article, processing...');
      localStorage.removeItem('bnbot_pending_article');

      try {
        const { title, content, html, imageUrls } = JSON.parse(pendingData);
        console.log('[App] Pending article data:', { title, contentLength: content?.length, imageUrlsCount: imageUrls?.length });
        console.log('[App] Image URLs:', imageUrls);

        // Wait for page to be ready
        await new Promise(resolve => setTimeout(resolve, 1500));

        // Click create button
        const createButton = document.querySelector('button[aria-label="create"]') as HTMLButtonElement;
        if (createButton) {
          createButton.click();
          console.log('[App] Clicked create button');
          await new Promise(resolve => setTimeout(resolve, 2000));
        }

        // Fill title
        const fillTitle = () => {
          const titleTextarea = document.querySelector('textarea[name="文章标题"], textarea[placeholder="添加标题"]') as HTMLTextAreaElement;
          if (titleTextarea) {
            titleTextarea.focus();
            titleTextarea.value = title;
            titleTextarea.dispatchEvent(new Event('input', { bubbles: true }));
            titleTextarea.dispatchEvent(new Event('change', { bubbles: true }));
            console.log('[App] Filled title:', title);
            return true;
          }
          return false;
        };

        // Fill content
        const fillContent = async () => {
          const contentEditor = document.querySelector('[data-testid="composer"][contenteditable="true"]') as HTMLElement;
          if (contentEditor) {
            contentEditor.focus();
            await new Promise(resolve => setTimeout(resolve, 500));

            const dataTransfer = new DataTransfer();
            dataTransfer.setData('text/html', html || content);
            dataTransfer.setData('text/plain', content);

            const pasteEvent = new ClipboardEvent('paste', {
              bubbles: true,
              cancelable: true,
              clipboardData: dataTransfer
            });

            contentEditor.dispatchEvent(pasteEvent);
            console.log('[App] Filled content');
            return true;
          }
          return false;
        };

        // Try to fill with retries
        let titleFilled = false;
        let contentFilled = false;
        for (let i = 0; i < 20 && (!titleFilled || !contentFilled); i++) {
          if (!titleFilled) titleFilled = fillTitle();
          if (!contentFilled && titleFilled) contentFilled = await fillContent();
          if (!titleFilled || !contentFilled) {
            await new Promise(resolve => setTimeout(resolve, 300));
          }
        }

        console.log('[App] Fill result - titleFilled:', titleFilled, 'contentFilled:', contentFilled);
        console.log('[App] imageUrls:', imageUrls);

        // Upload images if any
        if (imageUrls && imageUrls.length > 0 && contentFilled) {
          console.log('[App] Starting image upload, count:', imageUrls.length);
          await new Promise(resolve => setTimeout(resolve, 1000));

          // Step 1: Download all images concurrently
          console.log('[App] Downloading all images concurrently...');
          const downloadPromises = imageUrls.map((url, index) =>
            new Promise<{ index: number; success: boolean; data?: string; mimeType?: string; error?: string }>((resolve) => {
              if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
                chrome.runtime.sendMessage({
                  type: 'FETCH_IMAGE',
                  url
                }, (response: { success: boolean; data?: string; mimeType?: string; error?: string }) => {
                  resolve({ index, ...response });
                });
              } else {
                resolve({ index, success: false, error: 'Chrome runtime not available' });
              }
            })
          );

          const downloadedImages = await Promise.all(downloadPromises);
          console.log('[App] All images downloaded, successful:', downloadedImages.filter(r => r.success).length);

          // Step 2: Upload images sequentially (UI operations must be sequential)
          for (const downloaded of downloadedImages) {
            const imageNumber = downloaded.index + 1;

            if (!downloaded.success || !downloaded.data) {
              console.error(`[App] Image ${imageNumber} download failed:`, downloaded.error);
              continue;
            }

            console.log(`[App] Uploading image ${imageNumber}/${imageUrls.length}, size:`, downloaded.data.length);

            try {
              // Find toolbar and click the "插入" button
              const toolbar = document.getElementById('toolbar-styling-buttons');
              if (!toolbar) {
                console.error('[App] Toolbar not found');
                continue;
              }

              const toolbarDivs = toolbar.querySelectorAll(':scope > div');
              const lastDiv = toolbarDivs[toolbarDivs.length - 1];
              const insertButton = lastDiv?.querySelector('button[aria-label="添加媒体内容"]') as HTMLElement;

              if (!insertButton) {
                console.error('[App] Insert button not found');
                continue;
              }

              insertButton.click();
              await new Promise(resolve => setTimeout(resolve, 300));

              // Find dropdown and click first menuitem (媒体)
              const dropdown = document.querySelector('[data-testid="Dropdown"]');
              if (!dropdown) {
                console.error('[App] Dropdown not found');
                continue;
              }

              const mediaMenuItem = dropdown.querySelector('[role="menuitem"]') as HTMLElement;
              if (!mediaMenuItem) {
                console.error('[App] Media menu item not found');
                continue;
              }

              mediaMenuItem.click();
              await new Promise(resolve => setTimeout(resolve, 300));

              // Find the sheet dialog and file input
              const sheetDialog = document.querySelector('[data-testid="sheetDialog"]');
              if (!sheetDialog) {
                console.error('[App] Sheet dialog not found');
                continue;
              }

              const fileInput = sheetDialog.querySelector('input[data-testid="fileInput"]') as HTMLInputElement;
              if (!fileInput) {
                console.error('[App] File input not found');
                continue;
              }

              // Convert base64 to File
              const base64Data = downloaded.data;
              const mimeType = downloaded.mimeType || 'image/jpeg';
              const byteString = atob(base64Data);
              const ab = new ArrayBuffer(byteString.length);
              const ia = new Uint8Array(ab);
              for (let j = 0; j < byteString.length; j++) {
                ia[j] = byteString.charCodeAt(j);
              }
              const blob = new Blob([ab], { type: mimeType });
              const file = new File([blob], `image_${imageNumber}.${mimeType.split('/')[1] || 'jpg'}`, { type: mimeType });

              // Set file to input and trigger change
              const dataTransfer = new DataTransfer();
              dataTransfer.items.add(file);
              fileInput.files = dataTransfer.files;
              fileInput.dispatchEvent(new Event('change', { bubbles: true }));

              console.log(`[App] Triggered upload for image ${imageNumber}`);

              // Short delay before next image (don't wait for upload to complete)
              await new Promise(resolve => setTimeout(resolve, 500));

            } catch (e) {
              console.error(`[App] Error uploading image ${imageNumber}:`, e);
            }
          }

          console.log('[App] All image uploads triggered');
        }

      } catch (e) {
        console.error('[App] Failed to process pending article:', e);
      } finally {
        processing = false;
      }
    };

    // Check URL periodically for SPA navigation
    const urlCheckInterval = setInterval(() => {
      const currentUrl = window.location.href;
      if (currentUrl !== lastUrl) {
        lastUrl = currentUrl;
        processPendingArticle();
      }
    }, 500);

    // Also process on mount
    processPendingArticle();

    // Listen for popstate as backup
    const handleUrlChange = () => {
      processPendingArticle();
    };
    window.addEventListener('popstate', handleUrlChange);

    return () => {
      clearInterval(urlCheckInterval);
      window.removeEventListener('popstate', handleUrlChange);
    };
  }, []);

  // Save tab when it changes (only after initialization)
  useEffect(() => {
    if (!tabInitialized) return;

    const saveTab = async () => {
      try {
        if (typeof chrome !== 'undefined' && chrome.storage?.local) {
          await chrome.storage.local.set({ [ACTIVE_TAB_STORAGE_KEY]: activeTab });
        } else {
          localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, activeTab);
        }
      } catch (e) {
        console.warn('[BNBot] Failed to save active tab:', e);
      }
    };
    saveTab();
  }, [activeTab, tabInitialized]);

  // Show collapse button for 2 seconds when sidebar opens
  useEffect(() => {
    if (!isCollapsed) {
      setShowCollapseButton(true);
      const timer = setTimeout(() => {
        setShowCollapseButton(false);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [isCollapsed]);

  // Pop-out is a 420×640 floating card now (not the old full-height panel),
  // so we no longer need to hide X's right column or collapse its left nav.
  // Keep the article-editor / focus-mode page detection — other handlers
  // still consume `isArticleFocusMode` / `isArticleEditorMode`.
  useEffect(() => {
    // setTwitterSidebarHidden / setTwitterSidebarCollapsed /
    // setFocusModeDialogOffset intentionally NOT called — leave X's
    // layout alone so its right rail / left nav stay visible behind the
    // popup glass.

    const updateSidebarStates = () => {
      const pathname = window.location.pathname;
      const isArticleEditor = pathname.startsWith('/compose/articles');
      const isChatPage = pathname.startsWith('/i/chat') || pathname.startsWith('/messages');
      const isFocusMode = isArticleEditor && pathname.includes('/focus');
      setIsArticleFocusMode(isFocusMode);
      setIsArticleEditorMode(isArticleEditor);

      // Auto-collapse BNBot panel on chat/messages page
      if (isChatPage && !isCollapsed) {
        setIsCollapsed(true);
      }
    };

    updateSidebarStates();

    // Listen for URL changes to update sidebar states
    const handlePopState = () => updateSidebarStates();
    window.addEventListener('popstate', handlePopState);

    // Also check periodically for SPA navigation
    const intervalId = setInterval(updateSidebarStates, 500);

    return () => {
      window.removeEventListener('popstate', handlePopState);
      clearInterval(intervalId);
    };
  }, [isCollapsed]);

  // Inject "BNBot" button into article editor header when collapsed
  useEffect(() => {
    const BUTTON_ID = 'bnbot-focus-open-button';

    const injectButton = () => {
      // Only inject when in article editor mode AND panel is collapsed
      if (!isArticleEditorMode || !isCollapsed) {
        // Remove existing button if any
        const existing = document.getElementById(BUTTON_ID);
        if (existing) existing.remove();
        return;
      }

      // Check if button already exists
      if (document.getElementById(BUTTON_ID)) return;

      // Find the preview link and its parent container
      const previewLink = document.querySelector('a[href*="/preview"][role="link"]') as HTMLElement;
      if (!previewLink) return;

      // The parent container holds preview, publish button, and other icons
      const container = previewLink.parentElement;
      if (!container) return;

      // Find the second div after the preview link (that's after 发布)
      // Structure: preview link -> div (发布) -> div -> div (icons)
      const siblings = Array.from(container.children);
      const previewIndex = siblings.indexOf(previewLink);

      // Insert after the first div following preview (which is 发布)
      const publishDiv = siblings[previewIndex + 1] as HTMLElement;
      if (!publishDiv) return;

      // Create the button element
      const button = document.createElement('button');
      button.id = BUTTON_ID;
      button.textContent = 'BNBot';
      button.style.cssText = `
        background-color: transparent;
        border: 1px solid rgb(29, 155, 240);
        border-radius: 9999px;
        color: rgb(29, 155, 240);
        font-size: 15px;
        font-weight: 700;
        padding: 0 16px;
        height: 32px;
        min-height: 32px;
        cursor: pointer;
        font-family: inherit;
      `;
      button.addEventListener('click', () => {
        setIsCollapsed(false);
      });

      // Insert after the publish div
      publishDiv.after(button);
    };

    injectButton();

    // Re-check periodically in case DOM changes
    const intervalId = setInterval(injectButton, 500);

    return () => {
      clearInterval(intervalId);
      const existing = document.getElementById(BUTTON_ID);
      if (existing) existing.remove();
    };
  }, [isArticleEditorMode, isCollapsed]);

  // TweetObserver - highlight tweets when fully visible
  useEffect(() => {
    // Create observer instance once
    if (!tweetObserverRef.current) {
      tweetObserverRef.current = new TweetObserver({
        onTweetVisible: (tweetId) => {
          console.log('[BNBot] Tweet visible:', tweetId);
        }
      });
    }

    const observer = tweetObserverRef.current;

    if (tweetHighlightEnabled) {
      observer.start();

      // Restart observer when URL changes (for SPA navigation)
      const handleUrlChange = () => {
        observer.stop();
        observer.start();
      };

      window.addEventListener('popstate', handleUrlChange);

      return () => {
        observer.stop();
        window.removeEventListener('popstate', handleUrlChange);
      };
    } else {
      observer.stop();
    }
  }, [tweetHighlightEnabled]);

  const handleToggleTweetHighlight = () => {
    const newState = !tweetHighlightEnabled;
    setTweetHighlightEnabled(newState);

    // Update global flag for HomeBoostChecker
    (window as any).__bnbotMoneyVisionEnabled = newState;

    // Control HomeBoostChecker based on Money Vision state
    const checker = (window as any).__bnbotHomeBoostChecker;
    if (checker) {
      if (newState && window.location.pathname === '/home') {
        checker.start();
      } else {
        checker.pause();
      }
    }
  };

  // handleProfileClick / handleRefreshCredits removed — profile button +
  // credits panel are gone. CLI owns account state.

  // Detect Tweet URL with multiple strategies for faster response
  useEffect(() => {
    const checkUrl = () => {
      const path = window.location.pathname;

      // Ignore compose page to maintain state
      if (path.includes('/compose/post')) {
        return;
      }

      const match = path.match(/\/status\/(\d+)/);
      if (match && match[1]) {
        if (currentTweetId !== match[1]) {
          console.log('[BNBot] Detected Tweet ID:', match[1]);
          // Always update the tweet ID so the sidebar shows the Tweet tab option
          setCurrentTweetId(match[1]);

          // Check if we should skip auto-switching to TWEET_CONTEXT tab
          // Stay on current tab if:
          // 1. Analysis tab with stayOnPage enabled
          // 2. Chat or Tweet Context tab with explicit onStayOnPage call (within 1 second)
          // 3. Already on Chat tab (don't auto-switch away from chat) - unless tweet highlight is enabled
          // 4. Already on Tweet Context tab (navigating between tweets)
          const isStayOnPageTriggered = Date.now() - chatStayOnPageTimestampRef.current < 1000;

          // Always stay on current tab — TWEET_CONTEXT tab removed
          const shouldStayOnCurrentTab = true;

          // Preserve chat when navigating between tweets if already on CHAT or TWEET_CONTEXT tab
          // This handles browser back/forward navigation between tweet pages
          const shouldPreserveChat = shouldStayOnCurrentTab;

          // Only reset chat when switching to a new tweet from a non-chat page (e.g., from BOOST or ANALYSIS)
          if (shouldStayOnCurrentTab) {
            console.log('[BNBot] Stay on current tab, preserving chat state');
            return;
          }

          // Save current tab before switching
          setPreviousTab(activeTab);
          // When tweet highlight is enabled, switch to TWEET_CONTEXT with boost mode (handled by initialMode prop)
          setActiveTab(Tab.TWEET_CONTEXT);
        }
      } else {
        // If leaving tweet page, reset ID and restore previous tab
        if (currentTweetId) {
          setCurrentTweetId(null);
          // If we were on the context tab, switch back to the previous tab
          setPreviousTab(null);
        }
      }
    };

    // Listen for browser back/forward navigation
    const handlePopState = () => {
      checkUrl();
    };

    // Intercept pushState and replaceState for SPA navigation
    const originalPushState = history.pushState.bind(history);
    const originalReplaceState = history.replaceState.bind(history);

    history.pushState = (...args) => {
      originalPushState(...args);
      setTimeout(checkUrl, 0);
    };

    history.replaceState = (...args) => {
      originalReplaceState(...args);
      setTimeout(checkUrl, 0);
    };

    // Add event listeners
    window.addEventListener('popstate', handlePopState);

    // Fallback: periodic check with shorter interval
    const intervalId = setInterval(checkUrl, 500);
    checkUrl(); // Initial check

    return () => {
      window.removeEventListener('popstate', handlePopState);
      clearInterval(intervalId);
      // Restore original methods
      history.pushState = originalPushState;
      history.replaceState = originalReplaceState;
    };
  }, [activeTab, currentTweetId, previousTab, tweetHighlightEnabled]);

  // Listen for specific Boost Panel Open requests
  useEffect(() => {
    const handleOpenBoostTab = (event: Event) => {
      const customEvent = event as CustomEvent;
      const { tweetId } = customEvent.detail;
      console.log('[BNBot] Opening Boost Tab for tweet:', tweetId);

      setBoostPanelTweetId(tweetId || null);
      setActiveTab(Tab.BOOST);
      setIsCollapsed(false);
    };

    window.addEventListener('bnbot-open-boost-tab', handleOpenBoostTab);

    const handleOpenSidebar = () => {
      setIsCollapsed(false);
    };
    window.addEventListener('bnbot-open-sidebar', handleOpenSidebar);

    // Floating FAB dispatches this to toggle the popup open/closed.
    const handleTogglePopup = () => {
      setIsCollapsed((prev) => !prev);
    };
    window.addEventListener('bnbot-toggle-popup', handleTogglePopup);

    // FAB broadcasts its own position when it re-aligns above Grok.
    // The popup anchors itself `height + 12px` above the FAB so it
    // doesn't cover the trigger.
    const handleFabAligned = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail && typeof detail.bottom === 'number') {
        setFabPosition({
          bottom: detail.bottom,
          right: detail.right,
          height: detail.height ?? 54,
        });
      }
    };
    window.addEventListener('bnbot-fab-aligned', handleFabAligned);

    // FAB injector tells us when X's Grok drawer expanded into a full
    // panel — collapse our popup so it doesn't overlap Grok. Don't
    // auto-reopen on collapse; the user re-opens via the FAB.
    const handleGrokExpanded = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.expanded) setIsCollapsed(true);
    };
    window.addEventListener('bnbot-grok-expanded', handleGrokExpanded);

    // Click-on-right-sidebar-to-close — pointerdown inside X's right
    // rail (sidebarColumn) collapses the popup. Center timeline and
    // left nav clicks don't trigger close — users may be reading /
    // composing while glancing at BNBot. Only the right rail area
    // (where the popup overlaps) auto-closes when interacted with.
    const handleOutsideClick = (e: Event) => {
      const target = e.target as Element | null;
      if (!target?.closest) return;
      if (target.closest('[data-bnbot-popup="true"]')) return;
      if (target.closest('#bnbot-fab-trigger')) return;
      if (target.closest('[data-testid="sidebarColumn"]')) {
        setIsCollapsed(true);
      }
    };
    document.addEventListener('pointerdown', handleOutsideClick, true);

    return () => {
      window.removeEventListener('bnbot-open-boost-tab', handleOpenBoostTab);
      window.removeEventListener('bnbot-open-sidebar', handleOpenSidebar);
      window.removeEventListener('bnbot-toggle-popup', handleTogglePopup);
      window.removeEventListener('bnbot-fab-aligned', handleFabAligned);
      window.removeEventListener('bnbot-grok-expanded', handleGrokExpanded);
      document.removeEventListener('pointerdown', handleOutsideClick, true);
    };
  }, []);

  const handleSwitchToContext = (options: { mode: 'agent' | 'boost', tweetId?: string }) => {
    if (options.tweetId) {
      setCurrentTweetId(options.tweetId);
    }
    setActiveTab(Tab.BOOST);
  };

  // Render non-persistent panels (conditional rendering)
  const renderActivePanel = () => {
    switch (activeTab) {
      case Tab.BOOST: return null; // BoostPanel is now persistent
      // Tab.CREDITS case removed — CreditsPanel deleted with the
      // login/account UI cleanup.
      case Tab.AUTO_REPLY:
        return (
          <div style={{ padding: 16, color: 'var(--text-secondary)', fontSize: 13 }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Autopilot moved</div>
            <div>
              Autopilot now lives in the bnbot CLI / desktop app —
              <code style={{ margin: '0 4px' }}>/auto-reply</code> /
              <code style={{ margin: '0 4px' }}>/inbox-watch</code> skills.
              Extension is browser executor only.
            </div>
          </div>
        );
      case Tab.X_BALANCE:
        return (
          <XBalancePanel onBack={() => setActiveTab(Tab.BOOST)} />
        );
      default: return null;
    }
  };

  return (
    // ... rest of render

    // Changed to fixed positioning to float over the Twitter UI
    // pointer-events-none on wrapper, pointer-events-auto on interactive elements
    <div
      className={theme}
      data-bnbot-popup="true"
      style={{
        position: 'fixed',
        // Anchor above the FAB — add FAB height + 12px gap, so the popup
        // never overlaps the trigger.
        bottom: `${fabPosition.bottom + fabPosition.height + 12}px`,
        right: `${fabPosition.right}px`,
        width: isCollapsed ? 0 : '420px',
        height: isCollapsed ? 0 : `min(900px, calc(100vh - ${fabPosition.bottom + fabPosition.height + 40}px))`,
        zIndex: 9997,
        pointerEvents: isCollapsed ? 'none' : 'auto',
        display: 'flex',
        overflow: 'hidden',
        borderRadius: '16px',
        boxShadow: isCollapsed ? 'none' : '0 8px 32px rgba(0, 0, 0, 0.18)',
        transition: 'opacity 0.15s ease, transform 0.15s ease',
        opacity: isCollapsed ? 0 : 1,
        transform: isCollapsed ? 'translateY(8px)' : 'translateY(0)',
        // Solid theme bg — no blur, no transparency. Popup is an opaque
        // floating card; X content stays untouched behind it (no DOM
        // mutation now that twitterUtils sidebar mutators are gone).
        backgroundColor: 'var(--bg-primary)',
      }}
    >

      {/* Popup main container — FAB (content script) toggles `bnbot-toggle-popup`
          to show/hide this card. No more tail button or collapse button: the
          FAB is the only trigger now. */}
      <div style={{ position: 'relative', display: 'flex', width: '100%', height: '100%' }}>

        {/* Main App Container — column so the nav bar (Sidebar) sits at the
            bottom of the popup. Was row (right-side vertical sidebar) until v0.11.x. */}
        <div
          style={{
            width: '100%',
            height: '100%',
            backgroundColor: 'transparent',
            overflow: 'visible',
            display: 'flex',
            flexDirection: 'column',
            position: 'relative',
            zIndex: 40,
          }}
        >
          <main style={{
            flex: 1,
            backgroundColor: 'transparent',
            position: 'relative',
            display: 'flex',
            flexDirection: 'column',
            minWidth: 0
          }}>


            {/* Content Area */}
            <div style={{ position: 'relative', flex: 1, display: 'flex', flexDirection: 'column', height: '100%', zIndex: 10, overflow: 'hidden' }}>
              {/* Persistent BoostPanel - stays mounted to preserve state */}
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: activeTab === Tab.BOOST ? 'flex' : 'none',
                  flexDirection: 'column',
                }}
              >
                <BoostPanel
                  initialTweetId={boostPanelTweetId || undefined}
                  onSwitchToContext={handleSwitchToContext}
                  onOpenWallet={() => setActiveTab(Tab.X_BALANCE)}
                />
              </div>
              {/* ChatPanel removed — chat moved to bnbot CLI / desktop. */}
              {/* Other panels rendered conditionally */}
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: activeTab !== Tab.BOOST ? 'flex' : 'none',
                  flexDirection: 'column',
                  zIndex: 20,
                }}
              >
                {renderActivePanel()}
              </div>
              {/* Login and create-boost modals removed — extension is read-only for Money Vision. */}
            </div>
          </main>

        </div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <LanguageProvider>
        <AppContent />
      </LanguageProvider>
    </ThemeProvider>
  );
}
