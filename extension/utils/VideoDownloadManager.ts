/**
 * VideoDownloadManager
 *
 * Injects a "Download Video" menu item into Twitter's share dropdown menu
 * for tweets that contain videos. Listens for BNBOT_VIDEO_DATA postMessages
 * from the timeline interceptor and monitors the DOM for share menus.
 */

declare const chrome: any;

interface VideoInfo {
  url: string;
  thumbnail?: string;
  duration?: number;
}

// Download icon SVG path (arrow pointing down into tray)
const DOWNLOAD_ICON_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true" class="r-4qtqp9 r-yyyyoo r-1xvli5t r-dnmrzs r-bnwqim r-lrvibr r-m6rgpd r-18jsvk2 r-1q142lx"><g><path d="M11.99 16l-5.7-5.7L7.7 8.88l3.29 3.3V2.59h2v9.59l3.3-3.3 1.41 1.42-5.71 5.7zM21 15l-.02 3.51c0 1.38-1.12 2.49-2.5 2.49H5.5C4.11 21 3 19.88 3 18.5V15h2v3.5c0 .28.22.5.5.5h12.98c.28 0 .5-.22.5-.5L19 15h2z"></path></g></svg>`;

export class VideoDownloadManager {
  private videoMap: Map<string, VideoInfo> = new Map();
  private menuObserver: MutationObserver | null = null;
  // Track which tweet's share menu is currently open
  private lastClickedTweetId: string | null = null;

  constructor() {
    this.handleMessage = this.handleMessage.bind(this);
    this.handleShareClick = this.handleShareClick.bind(this);
  }

  start() {
    // Listen for video data from timeline interceptor
    window.addEventListener('message', this.handleMessage);

    // Listen for clicks on share buttons to track which tweet is active
    document.addEventListener('click', this.handleShareClick, true);

    // Observe DOM for share menus appearing
    this.menuObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node instanceof HTMLElement) {
            // Check if a menu appeared (either the node itself or a child)
            const menu = node.matches('[role="menu"]')
              ? node
              : node.querySelector?.('[role="menu"]');
            if (menu) {
              // Delay slightly to ensure click handler sets lastClickedTweetId first
              setTimeout(() => this.onMenuAppeared(menu as HTMLElement), 50);
            }
          }
        }
      }
    });

    if (document.body) {
      this.menuObserver.observe(document.body, {
        childList: true,
        subtree: true,
      });
    } else {
      const waitForBody = setInterval(() => {
        if (document.body) {
          clearInterval(waitForBody);
          this.menuObserver!.observe(document.body, {
            childList: true,
            subtree: true,
          });
        }
      }, 100);
    }

    console.log('[BNBot VideoDownload] Started');
  }

  destroy() {
    window.removeEventListener('message', this.handleMessage);
    document.removeEventListener('click', this.handleShareClick, true);
    if (this.menuObserver) {
      this.menuObserver.disconnect();
      this.menuObserver = null;
    }
    this.videoMap.clear();
  }

  private handleMessage(event: MessageEvent) {
    if (event.source !== window) return;
    if (event.data?.type !== 'BNBOT_VIDEO_DATA') return;

    const payload = event.data.payload as Record<string, VideoInfo>;
    if (!payload) return;

    let count = 0;
    for (const [tweetId, info] of Object.entries(payload)) {
      if (!this.videoMap.has(tweetId)) {
        this.videoMap.set(tweetId, info);
        count++;
      }
    }

    if (count > 0) {
      console.log(`[BNBot VideoDownload] Received ${count} video URLs, total: ${this.videoMap.size}`);
    }
  }

  /**
   * When the share button is clicked, figure out which tweet it belongs to
   * so we know the tweetId when the menu appears.
   */
  private handleShareClick(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (!target) return;

    // Find the share button: it's a button with aria-label containing "分享" or "Share"
    const shareButton = target.closest('button[aria-label*="分享"], button[aria-label*="Share"], button[aria-label*="share"]') as HTMLElement | null;
    if (!shareButton) return;

    // Find the parent article
    const article = shareButton.closest('article[data-testid="tweet"]');
    if (!article) return;

    // Extract tweetId
    const tweetId = this.extractTweetId(article);
    if (!tweetId) return;

    // Don't check videoMap here — data might arrive later.
    // We'll check when the menu actually appears.
    this.lastClickedTweetId = tweetId;
    // Debug: show what IDs are in videoMap to compare
    const mapKeys = Array.from(this.videoMap.keys());
    console.log(`[BNBot VideoDownload] Share clicked for tweet ${tweetId}, hasVideo: ${this.videoMap.has(tweetId)}, videoMap sample:`, mapKeys.slice(0, 5));
  }

  /**
   * When a dropdown menu appears, check if it's from a share button click
   * on a video tweet, and inject the download item.
   */
  private onMenuAppeared(menu: HTMLElement) {
    if (!this.lastClickedTweetId) return;

    const tweetId = this.lastClickedTweetId;
    const videoInfo = this.videoMap.get(tweetId);
    if (!videoInfo) return;

    // Check if we already injected
    if (menu.querySelector('[data-bnbot-download-item]')) return;

    // Find the Dropdown container inside the menu
    const dropdown = menu.querySelector('[data-testid="Dropdown"]');
    if (!dropdown) return;

    // Check if Twitter's native download option already exists (it uses <a> tag, not <div>)
    if (dropdown.querySelector('a[download]')) return;

    // Create the download menu item, matching Twitter's structure exactly
    const menuItem = document.createElement('div');
    menuItem.setAttribute('role', 'menuitem');
    menuItem.setAttribute('tabindex', '0');
    menuItem.setAttribute('data-bnbot-download-item', tweetId);
    menuItem.className = 'css-175oi2r r-18u37iz r-1mmae3n r-3pj75a r-13qz1uu r-1loqt21 r-o7ynqc r-6416eg r-1ny4l3l';
    menuItem.style.cursor = 'pointer';
    menuItem.addEventListener('mouseenter', () => {
      menuItem.style.backgroundColor = 'rgba(15, 20, 25, 0.03)';
    });
    menuItem.addEventListener('mouseleave', () => {
      menuItem.style.backgroundColor = '';
    });

    // Icon container
    const iconContainer = document.createElement('div');
    iconContainer.className = 'css-175oi2r r-1777fci r-faml9v';
    iconContainer.innerHTML = DOWNLOAD_ICON_SVG;

    // Text container
    const textContainer = document.createElement('div');
    textContainer.className = 'css-175oi2r r-16y2uox r-1wbh5a2';

    const textDiv = document.createElement('div');
    textDiv.setAttribute('dir', 'ltr');
    textDiv.className = 'css-146c3p1 r-bcqeeo r-1ttztb7 r-qvutc0 r-37j5jr r-a023e6 r-rjixqe r-b88u0q';
    textDiv.style.color = 'rgb(15, 20, 25)';

    const textSpan = document.createElement('span');
    textSpan.className = 'css-1jxf684 r-bcqeeo r-1ttztb7 r-qvutc0 r-poiln3';
    // Detect language from existing menu items
    const firstItem = dropdown.querySelector('[role="menuitem"]');
    const isChinese = firstItem?.textContent && /[\u4e00-\u9fff]/.test(firstItem.textContent);
    textSpan.textContent = isChinese ? '下载视频' : 'Download video';

    textDiv.appendChild(textSpan);
    textContainer.appendChild(textDiv);
    menuItem.appendChild(iconContainer);
    menuItem.appendChild(textContainer);

    // Click handler
    menuItem.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.downloadVideo(tweetId, videoInfo);
      // Close the menu by clicking elsewhere
      document.body.click();
    });

    // Append as last item in the dropdown
    dropdown.appendChild(menuItem);

    console.log(`[BNBot VideoDownload] Injected download menu item for tweet ${tweetId}`);
  }

  /**
   * Extract tweetId from article element.
   * For retweets, the DOM may contain multiple /status/ links (retweeter's and original author's).
   * We try all of them against videoMap and return the first match.
   * Falls back to the first ID found if none match.
   */
  private extractTweetId(article: Element): string | null {
    const links = article.querySelectorAll('a[href*="/status/"]');
    const ids: string[] = [];
    for (const link of links) {
      const href = link.getAttribute('href') || '';
      const match = href.match(/\/status\/(\d+)/);
      if (match && !ids.includes(match[1])) {
        ids.push(match[1]);
      }
    }
    // Prefer an ID that exists in videoMap
    for (const id of ids) {
      if (this.videoMap.has(id)) return id;
    }
    // Fallback to first ID
    return ids[0] || null;
  }

  private downloadVideo(tweetId: string, videoInfo: VideoInfo) {
    console.log(`[BNBot VideoDownload] Opening video for tweet ${tweetId}:`, videoInfo.url);
    window.open(videoInfo.url, '_blank');
  }
}
