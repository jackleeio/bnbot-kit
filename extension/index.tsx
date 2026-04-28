import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import cssText from './styles.css?inline';
import { TwitterInjector } from './utils/TwitterInjector';
import { initAdBlocker } from './utils/adBlocker';
import { MarkdownPasteProcessor } from './utils/MarkdownPasteProcessor';
import { BoostChecker } from './utils/BoostChecker';
import { xUserStore } from './stores/xUserStore';
import { HomeBoostChecker } from './utils/HomeBoostChecker';
import { BnbotFabInjector } from './utils/BnbotFabInjector';
// VideoDownloadManager removed — old "download tweet video" share-menu
// injection was part of the abandoned cross-post / republish flow.
// 初始化 commandService 消息监听器，确保 LOCAL_ACTION（bnbot 本地桥）在内容脚本加载时就能处理
import { commandService } from './services/commandService';
commandService.init();
// 导入微信抓取服务（会自动暴露到 window 对象）
import './services/wechatScraperService';
// tiktokService removed — TIKTOK_FETCH / fetch_tiktok_video was the
// republish path. CLI's `bnbot tiktok search` still works (uses scraper
// pool in scraperService.ts, not this file).
// xiaohongshuScraperService removed — same reason: XIAOHONGSHU_SCRAPE +
// fetch_xiaohongshu_note were the abandoned republish flow. New publish-
// to-XHS feature (task #66) will rebuild from scratch.

declare const chrome: any;

// ========== EARLY INJECTION ==========
// Inject interceptors as early as possible, before Twitter caches fetch reference
// Must use external script files due to CSP restrictions on inline scripts
(function injectInterceptorsEarly() {
  const inject = (id: string, file: string) => {
    if (document.getElementById(id)) return;
    try {
      const script = document.createElement('script');
      script.id = id;
      script.src = chrome.runtime.getURL(file);
      const target = document.head || document.documentElement;
      if (target) {
        if (target.firstChild) {
          target.insertBefore(script, target.firstChild);
        } else {
          target.appendChild(script);
        }
      }
    } catch (err) {
      console.error(`[BNBot] Failed to inject ${file}:`, err);
    }
  };

  inject('bnbot-timeline-interceptor-early', 'timeline-interceptor.js');
  inject('bnbot-tweet-interceptor-early', 'tweet-interceptor.js');
  console.log('[BNBot] Interceptors injected early');
})();
// ========== END EARLY INJECTION ==========

console.log('[BNBot] Extension script loaded');

// Global drag debug listener - check if ANY drag events reach the document
document.addEventListener('dragstart', (e) => {
  console.log('[BNBot] DRAGSTART on document!', e.target);
}, true);

document.addEventListener('dragenter', (e) => {
  console.log('[BNBot] DRAGENTER on document');
}, true);

const mount = () => {
  // Check if we are running in a standard web environment (dev) or extension
  let rootElement = document.getElementById('root');

  // ...

  // Helper: Drag-and-drop Polyfill for Twitter
  // Twitter's React implementation ignores synthetic drop/paste events.
  // We intercept the drop and use the hidden fileInput to upload images.
  const uploadFileToTwitter = async (file: File): Promise<boolean> => {
    // Find Twitter's fileInput - it has data-testid="fileInput"
    let fileInput = document.querySelector('input[data-testid="fileInput"]') as HTMLInputElement;

    // If no fileInput, the reply box might be collapsed - try to expand it
    if (!fileInput) {
      console.log('[BNBot] fileInput not found, trying to expand reply box...');

      // Click on the textarea to expand the reply box
      const textarea = document.querySelector('[data-testid="tweetTextarea_0"]') as HTMLElement;
      if (textarea) {
        textarea.click();
        textarea.focus();

        // Wait for fileInput to appear
        await new Promise(resolve => setTimeout(resolve, 300));
        fileInput = document.querySelector('input[data-testid="fileInput"]') as HTMLInputElement;
      }
    }

    if (fileInput) {
      console.log('[BNBot] Found fileInput, uploading...');
      try {
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        fileInput.files = dataTransfer.files;
        fileInput.dispatchEvent(new Event('change', { bubbles: true }));
        console.log('[BNBot] Upload successful');
        return true;
      } catch (err) {
        console.error('[BNBot] Upload failed:', err);
        return false;
      }
    }

    console.warn('[BNBot] fileInput not found - make sure reply box is visible');
    return false;
  };

  // Check if we're on the article editor page
  const isArticleEditorPage = () => window.location.pathname.includes('/compose/articles/edit/');

  // Fallback method: Upload via Insert -> Media menu
  const uploadImageViaInsertMenu = async (file: File) => {
    // Find the "Insert" button (Plus icon) in the toolbar
    // The button is in the last div of the toolbar-styling-buttons container
    const toolbar = document.querySelector('#toolbar-styling-buttons');
    let insertBtn: HTMLButtonElement | null = null;

    if (toolbar) {
      const lastDiv = toolbar.querySelector(':scope > div:last-child');
      if (lastDiv) {
        // Try multiple aria-label values (English and Chinese, case variations)
        insertBtn = lastDiv.querySelector('button[aria-label="添加媒体内容"], button[aria-label="Add Media"], button[aria-label="Add media"], button[aria-label="Insert"], button[aria-label="插入"]') as HTMLButtonElement;
      }
    }

    // Fallback: try global selectors
    if (!insertBtn) {
      const insertBtnSelectors = [
        'button[aria-label="添加媒体内容"]',
        'button[aria-label="Add Media"]',
        'button[aria-label="Add media"]',
        'button[aria-label="Insert"]',
        'button[aria-label="插入"]'
      ];
      for (const sel of insertBtnSelectors) {
        insertBtn = document.querySelector(sel) as HTMLButtonElement;
        if (insertBtn) break;
      }
    }

    if (!insertBtn) {
      console.error('[BNBot] "Insert" button not found. Available buttons:',
        Array.from(document.querySelectorAll('#toolbar-styling-buttons button')).map(b => b.getAttribute('aria-label'))
      );
      return false;
    }

    console.log('[BNBot] Found Insert button:', insertBtn.getAttribute('aria-label'));

    // Click Insert button
    insertBtn.click();

    // 2. Wait for the menu to appear and click "Media"
    // We need to wait a short bit for the dropdown to render
    await new Promise(r => setTimeout(r, 200));

    const menu = document.querySelector('[role="menu"]');
    if (!menu) {
      console.error('[BNBot] Insert menu not found');
      return false;
    }

    // "Media" is usually the first item, but let's look for icon or text just in case
    // The user provided HTML shows specific SVGs, but order is reliable (1st item)
    const menuItems = menu.querySelectorAll('[role="menuitem"]');
    if (menuItems.length === 0) {
      console.error('[BNBot] No menu items found');
      return false;
    }

    // Click the first item (Media)
    (menuItems[0] as HTMLElement).click();

    // 3. Wait for the modal ("Edit Media" / Upload)
    await new Promise(r => setTimeout(r, 500)); // slightly longer wait for modal animation

    // 4. Find the file input in the modal
    // The modal has `role="dialog"` or `data-testid="sheetDialog"`
    // We search globally for the visible file input, as it should be the one in the modal
    // The user showed the modal contains `input[data-testid="fileInput"]`

    // Sometimes there might be multiple file inputs (one in header, one in modal)
    // We should prefer the one inside the dialog if possible
    const dialog = document.querySelector('[role="dialog"]') || document.querySelector('[data-testid="sheetDialog"]');
    let modalFileInput: HTMLInputElement | null = null;

    if (dialog) {
      modalFileInput = dialog.querySelector('input[data-testid="fileInput"]');
    } else {
      // Fallback: look for any visible file input that isn't the header one?
      // Actually the header one is usually hidden/0x0. The modal one is also hidden.
      // Let's query all and pick the last one, or the one that isn't the header one.
      const allInputs = document.querySelectorAll('input[data-testid="fileInput"]');
      modalFileInput = allInputs[allInputs.length - 1] as HTMLInputElement;
    }

    if (!modalFileInput) {
      console.error('[BNBot] File input in modal not found');
      return false;
    }

    console.log('[BNBot] Found modal file input, uploading...');
    try {
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      modalFileInput.files = dataTransfer.files;
      modalFileInput.dispatchEvent(new Event('change', { bubbles: true }));
      console.log('[BNBot] Article body upload triggered successfully');
      return true;
    } catch (e) {
      console.error('[BNBot] Failed to trigger upload in modal', e);
      return false;
    }
  };

  // Helper: Set a brief cursor at the specific point to prevent text replacement
  const setBriefCursorAtPoint = (x: number, y: number, target?: EventTarget | null) => {
    const selection = window.getSelection();
    if (!selection) return;

    let range: Range | null = null;

    // 1. Try standard caretRangeFromPoint
    if (document.caretRangeFromPoint) {
      range = document.caretRangeFromPoint(x, y);
    }
    // Fallback for some browsers (though Chrome uses caretRangeFromPoint)
    else if ((document as any).caretPositionFromPoint) {
      const pos = (document as any).caretPositionFromPoint(x, y);
      if (pos) {
        range = document.createRange();
        range.setStart(pos.offsetNode, pos.offset);
        range.collapse(true);
      }
    }

    // 2. Fallback: If no range from point (e.g. drop in empty padding or container), use target
    if ((!range || range.startContainer.nodeType === 1) && target) { // nodeType 1 is Element (not text)
      // If range points to container, it might be imprecise. Let's try to improve or fallback.
      const t = target as HTMLElement;
      const editor = t.closest('[contenteditable="true"]') || t.querySelector('[contenteditable="true"]');

      // Only invoke fallback if we don't have a specific text node range
      if (editor && (!range || range.startContainer === editor)) {
        if (!range) range = document.createRange();

        range.selectNodeContents(editor);

        const rect = editor.getBoundingClientRect();
        // If drop is in the top 30% of the editor, consider it "Start"
        if (y < rect.top + (rect.height * 0.3)) {
          range.collapse(true); // Start
        } else {
          range.collapse(false); // End
        }
      }
    }

    if (range) {
      selection.removeAllRanges();
      selection.addRange(range);
      // Ensure it's collapsed so we don't replace text
      if (!range.collapsed) range.collapse(true);

      // Important: Focus the editor so DraftJS/Twitter knows where to insert
      let container = range.commonAncestorContainer;
      if (container.nodeType === 3 && container.parentElement) {
        container = container.parentElement;
      }
      const editor = (container as HTMLElement).closest('[contenteditable="true"]');
      if (editor) {
        editor.focus();
      }
    }
  };

  // Helper to find the specific image upload zone (grey box)
  const findImageUploadZone = (input: Element | null): Element | null => {
    if (!input) return null;
    let current = input.parentElement;
    const editorSection = input.closest('section[role="region"]');
    let depth = 0;
    while (current && current !== editorSection && depth < 10) {
      // Look for the placeholder (padding-bottom: 40%) style
      if (current.querySelector('div[style*="padding-bottom: 40%"]')) return current;
      // Look for specific text hints (EN/CN)
      if (current.innerText.includes('5:2') || current.innerText.includes('5：2')) {
        return current.parentElement?.parentElement || current;
      }
      current = current.parentElement;
      depth++;
    }
    // Fallback: 6th parent is roughly the container level below the main section
    let fallback = input;
    for (let i = 0; i < 6; i++) {
      if (fallback?.parentElement && fallback.parentElement !== editorSection) {
        fallback = fallback.parentElement;
      }
    }
    return fallback;
  };

  // Helper to clear drag visual state (blue border) after drop
  const clearDragVisualState = () => {
    setTimeout(() => {
      // Find all elements with the blue border class
      const blueBorderElements = document.querySelectorAll('.r-vhj8yc, .r-17gur6a');
      blueBorderElements.forEach(el => {
        el.classList.remove('r-vhj8yc');
        el.classList.remove('r-17gur6a');
      });

      // Find the file input and clean up its parent containers
      const fileInput = document.querySelector('input[data-testid="fileInput"]');
      if (fileInput) {
        // Traverse up and dispatch dragleave events
        let current = fileInput.parentElement;
        for (let i = 0; i < 8 && current; i++) {
          const dragLeaveEvent = new DragEvent('dragleave', {
            bubbles: true,
            cancelable: true,
          });
          current.dispatchEvent(dragLeaveEvent);

          // Also try to blur
          if (current instanceof HTMLElement) {
            current.blur();
          }
          current = current.parentElement;
        }
      }

      // Dispatch global dragend to reset any remaining drag state
      document.dispatchEvent(new DragEvent('dragend', { bubbles: true }));

      // Also find elements with dashed border (drag active state) and reset them
      const droppables = document.querySelectorAll('[data-rbd-droppable-id]');
      droppables.forEach(el => {
        el.dispatchEvent(new DragEvent('dragleave', { bubbles: true }));
        el.dispatchEvent(new DragEvent('dragend', { bubbles: true }));
      });

      console.log('[BNBot] Cleared drag visual state');
    }, 100);
  };

  // Listen for dragover to allow drop on article header image zone only
  document.addEventListener('dragover', (e) => {
    if (!e.dataTransfer) return;

    const hasFiles = e.dataTransfer.types.includes('Files');
    const hasTextBridge = e.dataTransfer.types.includes('text/plain');

    if (hasFiles || hasTextBridge) {
      const target = e.target as HTMLElement;

      // Only allow drop on article header image upload zone
      if (isArticleEditorPage()) {
        const fileInput = document.querySelector('input[data-testid="fileInput"]');
        const imageUploadZone = findImageUploadZone(fileInput);
        const isInImageUploadZone = imageUploadZone && imageUploadZone.contains(target);

        if (isInImageUploadZone) {
          e.preventDefault();
          e.stopImmediatePropagation();
          e.dataTransfer.dropEffect = 'copy';
        }
      }
    }
  }, true);

  // Handle drop on article header image zone only
  document.addEventListener('drop', async (e) => {
    const target = e.target as HTMLElement;

    // Only handle drops on article editor page
    if (!isArticleEditorPage()) return;

    const fileInput = document.querySelector('input[data-testid="fileInput"]');
    const imageUploadZone = findImageUploadZone(fileInput);
    const isInImageUploadZone = imageUploadZone && imageUploadZone.contains(target);

    // Only handle drops in the header image upload zone
    if (!isInImageUploadZone) return;

    // Check if we have data from our extension (via window bridge)
    const dragData = (window as any).__bnbotDragData;
    const isFromExtension = dragData && (Date.now() - dragData.timestamp < 5000);

    if (isFromExtension) {
      console.log('[BNBot] Processing extension image drop on article header');
      e.preventDefault();
      e.stopImmediatePropagation();

      const src = dragData.src;
      delete (window as any).__bnbotDragData;

      try {
        let blob: Blob;
        let filename: string;

        if (src.startsWith('data:')) {
          const arr = src.split(',');
          const mimeMatch = arr[0].match(/data:([^;]+)/);
          const mime = mimeMatch ? mimeMatch[1] : 'image/png';
          const bstr = atob(arr[1]);
          let n = bstr.length;
          const u8arr = new Uint8Array(n);
          while (n--) {
            u8arr[n] = bstr.charCodeAt(n);
          }
          blob = new Blob([u8arr], { type: mime });
          const ext = mime.split('/')[1] || 'png';
          filename = `bnbot-image-${Date.now()}.${ext}`;
        } else {
          const res = await fetch(src);
          blob = await res.blob();
          filename = `bnbot-image-${Date.now()}.png`;
        }

        const file = new File([blob], filename, { type: blob.type });
        const success = await uploadFileToTwitter(file);
        console.log('[BNBot] Article header upload result:', success);

        if (success) {
          setTimeout(() => {
            const applyButton = document.querySelector('button[data-testid="applyButton"]') ||
              Array.from(document.querySelectorAll('button')).find(btn =>
                btn.textContent?.includes('应用') || btn.textContent?.includes('Apply')
              );
            if (applyButton) {
              (applyButton as HTMLButtonElement).click();
            }
          }, 500);
        }

        clearDragVisualState();
      } catch (err) {
        console.error('[BNBot] Failed to process header image drop:', err);
        clearDragVisualState();
      }
      return;
    }

    // Handle native file drops on header zone
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      console.log('[BNBot] Detected native file drop on article header');
      e.preventDefault();
      e.stopImmediatePropagation();

      const files = Array.from(e.dataTransfer.files);
      const imageFiles = files.filter(f => f.type.startsWith('image/'));

      if (imageFiles.length > 0) {
        await uploadFileToTwitter(imageFiles[0]);
      }
    }
  }, true);

  // Start the Twitter Injector
  const injector = new TwitterInjector();
  injector.start();

  // Start the floating BNBot FAB (right-bottom, above X's Grok drawer)
  const bnbotFab = new BnbotFabInjector();
  bnbotFab.start();

  // Initialize Ad Blocker
  initAdBlocker();

  // Initialize Markdown Paste Processor
  new MarkdownPasteProcessor();

  // Initialize X User Store (获取当前登录用户信息)
  xUserStore.init();

  // If #root doesn't exist, we assume we are injected into a target page (Twitter/X)
  if (!rootElement) {
    console.log('[BNBot] Running in extension mode, injecting into Twitter');
    // Hide Twitter sidebar initially (panel starts open) - now handled by checkUrl
    // setTwitterSidebarHidden(true);

    // Create a container for our extension
    const extensionContainer = document.createElement('div');
    extensionContainer.id = 'x-sidekick-container';
    // Use cssText with !important to prevent Twitter CSS from overriding
    // CHANGED: Use 100vw/100vh to allow full-screen overlays (modals)
    // We keep pointer-events: none so clicks pass through to Twitter by default.
    // Interactive elements (Sidebar, Modal) will have pointer-events: auto.
    extensionContainer.style.cssText = `
      all: initial !important;
      position: fixed !important;
      top: 0 !important;
      right: 0 !important;
      width: 100vw !important;
      height: 100vh !important;
      z-index: 999999 !important;
      pointer-events: none !important;
      display: block !important;
      box-sizing: border-box !important;
    `;
    document.body.appendChild(extensionContainer);

    // Use Shadow DOM to isolate styles from Twitter
    const shadowRoot = extensionContainer.attachShadow({ mode: 'open' });

    // Inject styles into shadow DOM
    const styleEl = document.createElement('style');
    // Replace asset URLs with chrome extension URLs
    const processedCss = cssText.replace(
      /url\((['"]?)\/assets\//g,
      `url($1${chrome.runtime.getURL('assets/')}`
    );
    styleEl.textContent = processedCss;
    shadowRoot.appendChild(styleEl);

    // Create root element inside shadow DOM
    rootElement = document.createElement('div');
    rootElement.id = 'x-sidekick-root';
    rootElement.style.width = '100%';
    rootElement.style.height = '100%';
    rootElement.style.pointerEvents = 'none';
    shadowRoot.appendChild(rootElement);

    // Add dragstart listener inside Shadow DOM to capture image drags
    // React's onDragStart doesn't propagate properly across Shadow DOM boundary
    shadowRoot.addEventListener('dragstart', (e) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'IMG') {
        const img = target as HTMLImageElement;
        const src = img.src;
        if (src) {
          console.log('[BNBot] Shadow DOM dragstart captured for image');
          (window as any).__bnbotDragData = {
            src,
            timestamp: Date.now()
          };
        }
      }
    }, true);
  }

  const root = ReactDOM.createRoot(rootElement);
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );

  // If we created a container, set up the modal observer on it
  if (!document.getElementById('root') && document.getElementById('x-sidekick-container')) {
    const container = document.getElementById('x-sidekick-container')!;

    const checkState = () => {
      // 1. Check for Modals
      const mask = document.querySelector('[data-testid="mask"]');
      const mediaViewer = document.querySelector('[data-testid="app-bar-close"]');
      const sheetDialog = document.querySelector('[data-testid="sheetDialog"]');
      const swipeToDismiss = document.querySelector('[data-testid="swipe-to-dismiss"]');
      const genericModal = document.querySelector('[role="dialog"][aria-modal="true"]');
      const isPhotoUrl = window.location.pathname.includes('/photo/');
      const isArticleFocusMode = window.location.pathname.includes('/compose/articles') && window.location.pathname.includes('/focus');

      // Don't treat article focus mode as a modal
      const isModalOpen = !isArticleFocusMode && (!!mask || !!mediaViewer || !!sheetDialog || !!swipeToDismiss || !!genericModal || isPhotoUrl);

      // Toggle z-index of the host container
      container.style.setProperty('z-index', isModalOpen ? '-1' : '999999', 'important');

      // 2. Sidebar mode is now handled by App.tsx based on panel collapsed state

      // 3. Fix for Blue Box on Cancel
      // When canceling image upload via "Back" in the media editor, Twitter leaves the focus on the upload zone.
      // We attach a listener to the Back button to force a blur.
      const backButton = document.querySelector('[role="dialog"] button[data-testid="app-bar-back"]');
      if (backButton && !backButton.hasAttribute('data-bnbot-listener')) {
        backButton.setAttribute('data-bnbot-listener', 'true');
        backButton.addEventListener('click', () => {
          console.log('[BNBot] Back button clicked, cleaning up focus');
          // Small delay to allow React to process the click and close the modal first
          setTimeout(() => {
            if (document.activeElement instanceof HTMLElement) {
              document.activeElement.blur();
            }

            const fileInput = document.querySelector('input[data-testid="fileInput"]');
            if (fileInput) {
              // 1. Blur the input itself
              if (fileInput instanceof HTMLElement) fileInput.blur();

              // 2. Find the specific container with the blue border (class r-vhj8yc) and blur/clean it
              // The user identified 'r-vhj8yc' as the class causing the blue border
              const blueBorderContainer = fileInput.closest('.r-vhj8yc') || fileInput.closest('.r-17gur6a');
              if (blueBorderContainer instanceof HTMLElement) {
                blueBorderContainer.blur();

                // Forcefully remove the visual classes
                blueBorderContainer.classList.remove('r-vhj8yc'); // Blue color
                blueBorderContainer.classList.remove('r-17gur6a'); // Often associated with focus rings

                // Dispatch dragleave events to reset the component state
                // This should handle the dashed border which is likely a "drag active" state
                const dragLeaveEvent = new DragEvent('dragleave', {
                  bubbles: true,
                  cancelable: true,
                });
                blueBorderContainer.dispatchEvent(dragLeaveEvent);

                // Also try dispatching on the file input parent which often handles the drag state
                if (fileInput.parentElement) {
                  fileInput.parentElement.dispatchEvent(dragLeaveEvent);
                }
              }

              // 3. Fallback: Traverse up and blur parents
              if (fileInput.parentElement) {
                fileInput.parentElement.blur();
                if (fileInput.parentElement.parentElement) {
                  fileInput.parentElement.parentElement.blur();
                }
              }
            }
          }, 100);
        });
      }
    };

    // Check initially
    checkState();

    // Observe DOM mutations
    const observer = new MutationObserver(() => {
      checkState();
    });

    // Ensure document.body exists before observing
    if (document.body) {
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
      });
    } else {
      // Fallback: wait for body to be available
      const waitForBody = setInterval(() => {
        if (document.body) {
          clearInterval(waitForBody);
          observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
          });
        }
      }, 100);
    }

    // Polling fallback
    setInterval(checkState, 500);

  }

  // --- Boost Feature Integration ---

  // Track the BoostChecker instance
  let globalBoostChecker: BoostChecker | null = null;
  let currentLoggedInUser: string | null = null;

  // Helper to get current username from Twitter UI (specifically UserAvatar-Container)
  const getLoggedInUsername = (): string | null => {
    // User provided method: data-testid="UserAvatar-Container-jackleeio"
    // This element usually appears in the sidebar or top bar for the logged-in user.
    // We look for any element starting with UserAvatar-Container-
    const avatarContainer = document.querySelector('[data-testid^="UserAvatar-Container-"]');
    if (avatarContainer) {
      const testId = avatarContainer.getAttribute('data-testid');
      if (testId) {
        const match = testId.match(/UserAvatar-Container-(.+)/);
        if (match && match[1]) {
          return match[1];
        }
      }
    }

    // Fallback: Try AppTabBar_Profile_Link
    const profileLink = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]');
    if (profileLink) {
      const href = profileLink.getAttribute('href');
      if (href) {
        return href.replace('/', '');
      }
    }

    return null;
  };

  // Check valid profile and manage BoostChecker (called repeatedly)
  const updateBoostCheckerState = () => {
    // 1. Get Logged In User
    const username = getLoggedInUsername();

    // If we can't find who is logged in, we can't verify "own profile". Stop everything.
    if (!username) {
      if (globalBoostChecker) {
        console.log('[BNBot] Username lost, stopping BoostChecker');
        globalBoostChecker.destroy();
        globalBoostChecker = null;
      }
      return;
    }

    if (currentLoggedInUser !== username) {
      console.log('[BNBot] Detected logged in user:', username);
      currentLoggedInUser = username;
    }

    // 2. Check if Current URL is User's Profile
    // Strictly /username (ignoring /with_replies for now unless requested, user said "x.com/jackleeio")
    const pathname = window.location.pathname;
    const isUserProfile = pathname === `/${username}`;

    // 3. Start or Stop BoostChecker
    if (isUserProfile) {
      if (!globalBoostChecker) {
        console.log(`[BNBot] On profile page (${username}), starting BoostChecker...`);
        globalBoostChecker = new BoostChecker(username);
        globalBoostChecker.start();
      }
    } else {
      if (globalBoostChecker) {
        console.log(`[BNBot] Left profile page (${username}), stopping BoostChecker...`);
        globalBoostChecker.destroy();
        globalBoostChecker = null;
      }
    }
  };

  // We add this to the existing periodic check
  setInterval(updateBoostCheckerState, 1000);

  // Also run heavily on navigation
  const handleUrlChangeForBoost = () => {
    setTimeout(updateBoostCheckerState, 100); // slight delay for DOM
    setTimeout(updateBoostCheckerState, 1000); // retry
  };
  window.addEventListener('popstate', handleUrlChangeForBoost);
  // Add to the history hacks as well if not already covered by existing intervals

  // VideoDownloadManager removed — see import-site comment.

  // --- Home Boost Checker Integration (Money Vision) ---
  const homeBoostChecker = new HomeBoostChecker();

  // Expose instance globally for App.tsx to control
  (window as any).__bnbotHomeBoostChecker = homeBoostChecker;

  // Check if Money Vision is enabled and we're on home page
  const checkHomeBoostCheckerState = () => {
    const isHomePage = window.location.pathname === '/home';
    const moneyVisionEnabled = (window as any).__bnbotMoneyVisionEnabled || false;

    if (isHomePage && moneyVisionEnabled) {
      if (!homeBoostChecker.getIsRunning()) {
        console.log('[BNBot] Money Vision enabled on /home, starting HomeBoostChecker...');
        homeBoostChecker.start();
      }
    } else {
      if (homeBoostChecker.getIsRunning()) {
        console.log('[BNBot] Leaving /home or Money Vision disabled, pausing HomeBoostChecker...');
        homeBoostChecker.pause();
      }
    }
  };

  // Periodic check for URL changes
  setInterval(checkHomeBoostCheckerState, 1000);

  // Also listen for popstate events
  window.addEventListener('popstate', () => {
    setTimeout(checkHomeBoostCheckerState, 100);
    setTimeout(checkHomeBoostCheckerState, 500);
  });
};

// Start the app
const startApp = () => {
  if (document.body) {
    mount();
  } else {
    // Wait for body to be available
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', mount);
    } else {
      // Fallback: poll for body
      const waitForBody = setInterval(() => {
        if (document.body) {
          clearInterval(waitForBody);
          mount();
        }
      }, 50);
    }
  }
};

startApp();