/**
 * HomeBoostChecker
 *
 * Monitors the Home Timeline for tweets that have active Boost campaigns.
 * Phase 1: Console output for testing ✅
 * Phase 2: Badge injection ✅
 */

import { boostService } from '../services/boostService';

export class HomeBoostChecker {
  private isRunning = false;
  private observer: IntersectionObserver | null = null;
  private mutationObserver: MutationObserver | null = null;

  // Caches
  private checkedTweetIds = new Set<string>();
  private activeBoostCache = new Set<string>();
  private pendingTweetIds = new Set<string>();
  private badgeInjectedTweetIds = new Set<string>();

  // Debounce
  private debounceTimer: number | null = null;
  private readonly DEBOUNCE_MS = 1000;

  constructor() {
    console.log('[HomeBoostChecker] Instance created');
  }

  /**
   * Start monitoring the home timeline for boosted tweets
   */
  start(): void {
    if (this.isRunning) {
      console.log('[HomeBoostChecker] Already running');
      return;
    }

    this.isRunning = true;
    console.log('[HomeBoostChecker] Starting...');

    this.setupObserver();
    this.setupMutationObserver();
    this.scanExistingTweets();

    console.log('[HomeBoostChecker] Started successfully');
  }

  /**
   * Pause monitoring (when leaving /home or disabling Money Vision)
   */
  pause(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    console.log('[HomeBoostChecker] Paused');

    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }

    if (this.mutationObserver) {
      this.mutationObserver.disconnect();
      this.mutationObserver = null;
    }

    if (this.debounceTimer) {
      window.clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    // Clear pending but keep caches for when user returns
    this.pendingTweetIds.clear();
  }

  /**
   * Check if the checker is currently running
   */
  getIsRunning(): boolean {
    return this.isRunning;
  }

  /**
   * Get the set of tweet IDs that have active boosts
   */
  getActiveBoostCache(): Set<string> {
    return this.activeBoostCache;
  }

  /**
   * Set up IntersectionObserver to detect when tweets become visible
   */
  private setupObserver(): void {
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            this.onTweetVisible(entry.target as HTMLElement);
          }
        }
      },
      {
        root: null,
        rootMargin: '2000px', // Pre-load tweets before they're fully visible
        threshold: 0.1,
      }
    );
  }

  /**
   * Handle when a tweet element becomes visible
   */
  private onTweetVisible(element: HTMLElement): void {
    const tweetId = this.extractTweetId(element);
    if (!tweetId) return;

    // Skip if already checked
    if (this.checkedTweetIds.has(tweetId)) {
      // If we already know it has a boost, inject badge
      if (this.activeBoostCache.has(tweetId)) {
        this.injectBadge(element, tweetId);
      }
      return;
    }

    // Add to pending batch
    this.pendingTweetIds.add(tweetId);
    this.scheduleCheck();
  }

  /**
   * Schedule a debounced API check
   */
  private scheduleCheck(): void {
    if (this.debounceTimer) return;

    this.debounceTimer = window.setTimeout(() => {
      this.debounceTimer = null;
      this.flushPendingTweets();
    }, this.DEBOUNCE_MS);
  }

  /**
   * Flush pending tweets and send batch API request
   */
  private async flushPendingTweets(): Promise<void> {
    const ids = Array.from(this.pendingTweetIds);
    this.pendingTweetIds.clear();

    if (ids.length === 0) return;

    // Mark as checked to avoid duplicate requests
    ids.forEach((id) => this.checkedTweetIds.add(id));

    console.log('[HomeBoostChecker] Checking tweets:', ids);

    try {
      const result = await boostService.checkTweets(ids);

      // ===== Console Output for Testing =====
      console.log('[HomeBoostChecker] API Response:', result);

      if (result.active_tweet_ids && result.active_tweet_ids.length > 0) {
        console.log(
          '🎉 [HomeBoostChecker] Found BOOSTED tweets:',
          result.active_tweet_ids
        );

        // Cache the active boost IDs
        result.active_tweet_ids.forEach((id) => this.activeBoostCache.add(id));

        // Log rewards info if available
        if (result.rewards) {
          console.log('[HomeBoostChecker] Rewards info:', result.rewards);
        }

        // Inject badges for boosted tweets
        this.injectBadgesForTweets(result.active_tweet_ids);
      } else {
        console.log('[HomeBoostChecker] No boosted tweets in this batch');
      }
    } catch (error) {
      console.error('[HomeBoostChecker] API Error:', error);
      // Remove from checked so we can retry later
      ids.forEach((id) => this.checkedTweetIds.delete(id));
    }
  }

  /**
   * Extract tweet ID from a tweet DOM element
   * Reuses logic from HomeTimelineMonitor
   */
  private extractTweetId(element: HTMLElement): string | null {
    try {
      // Method 1: Find the tweet link with status ID
      // Format: /username/status/1234567890
      const tweetLinks = element.querySelectorAll('a[href*="/status/"]');

      for (const link of tweetLinks) {
        const href = link.getAttribute('href');
        if (href) {
          const match = href.match(/\/status\/(\d+)/);
          if (match && match[1]) {
            return match[1];
          }
        }
      }

      // Method 2: Look for time element with datetime and parent link
      const timeElement = element.querySelector('time[datetime]');
      if (timeElement) {
        const parentLink = timeElement.closest('a[href*="/status/"]');
        if (parentLink) {
          const href = parentLink.getAttribute('href');
          if (href) {
            const match = href.match(/\/status\/(\d+)/);
            if (match && match[1]) {
              return match[1];
            }
          }
        }
      }

      return null;
    } catch (err) {
      return null;
    }
  }

  /**
   * Scan existing tweets on the page and observe them
   */
  private scanExistingTweets(): void {
    const tweetElements = document.querySelectorAll(
      'article[data-testid="tweet"]'
    );

    tweetElements.forEach((element) => {
      if (this.observer) {
        this.observer.observe(element);
      }
    });

    console.log(
      `[HomeBoostChecker] Observing ${tweetElements.length} existing tweets`
    );
  }

  /**
   * Set up MutationObserver to watch for new tweet elements (infinite scroll)
   */
  private setupMutationObserver(): void {
    this.mutationObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node instanceof HTMLElement) {
            this.observeTweetElements(node);
          }
        }
      }
    });

    // Start observing once body is available
    const startObserving = () => {
      if (document.body && this.mutationObserver) {
        this.mutationObserver.observe(document.body, {
          childList: true,
          subtree: true,
        });
      }
    };

    if (document.body) {
      startObserving();
    } else {
      document.addEventListener('DOMContentLoaded', startObserving);
    }
  }

  /**
   * Find and observe tweet elements within a container
   */
  private observeTweetElements(container: HTMLElement): void {
    // Check if the container itself is a tweet
    if (container.getAttribute('data-testid') === 'tweet') {
      if (this.observer) {
        this.observer.observe(container);
      }
      return;
    }

    // Find tweet elements within the container
    const tweetElements = container.querySelectorAll(
      'article[data-testid="tweet"]'
    );
    tweetElements.forEach((element) => {
      if (this.observer) {
        this.observer.observe(element);
      }
    });
  }

  /**
   * Clear all caches (useful for testing or when user logs out)
   */
  clearCaches(): void {
    this.checkedTweetIds.clear();
    this.activeBoostCache.clear();
    this.pendingTweetIds.clear();
    this.badgeInjectedTweetIds.clear();
    console.log('[HomeBoostChecker] Caches cleared');
  }

  /**
   * Inject badges for all boosted tweets in the list
   */
  private injectBadgesForTweets(tweetIds: string[]): void {
    for (const tweetId of tweetIds) {
      // Find the tweet element in DOM
      const selector = `a[href*="/status/${tweetId}"]`;
      const links = document.querySelectorAll(selector);

      links.forEach((link) => {
        const article = link.closest('article[data-testid="tweet"]');
        if (article) {
          this.injectBadge(article as HTMLElement, tweetId);
        }
      });
    }
  }

  /**
   * Inject a golden lightning badge into a tweet element
   * Styled to match Twitter's action buttons, placed left of bookmark
   */
  private injectBadge(article: HTMLElement, tweetId: string): void {
    // Skip if already injected
    if (this.badgeInjectedTweetIds.has(tweetId)) return;
    if (article.querySelector('.bnbot-home-boost-badge')) return;

    // Find the bookmark button to insert before it
    const bookmarkButton = article.querySelector('[data-testid="bookmark"]');
    if (!bookmarkButton) return;

    const bookmarkContainer = bookmarkButton.parentElement;
    if (!bookmarkContainer || !bookmarkContainer.parentElement) return;

    // Add gold border to the article
    article.style.boxShadow = 'inset 0 0 0 1px #F0B90B';
    article.style.borderRadius = '16px';

    // Create container div matching Twitter's action button style
    const badge = document.createElement('div');
    badge.className = 'bnbot-home-boost-badge css-175oi2r r-18u37iz r-1h0z5md r-13awgt0';
    badge.setAttribute('data-tweet-id', tweetId);

    // Create inner structure matching Twitter's button style
    badge.innerHTML = `
      <div role="button" tabindex="0" class="css-175oi2r r-1777fci r-bt1l66 r-bztko3 r-lrvibr r-1loqt21 r-1ny4l3l" style="cursor: pointer;">
        <div dir="ltr" class="css-146c3p1 r-bcqeeo r-1ttztb7 r-qvutc0 r-37j5jr r-a023e6 r-rjixqe r-16dba41 r-1awozwy r-6koalj r-1h0z5md r-o7ynqc r-clp7b1 r-3s2u2q" style="color: #F59E0B;">
          <div class="css-175oi2r r-xoduu5">
            <div class="bnbot-hover-circle css-175oi2r r-xoduu5 r-1p0dtai r-1d2f490 r-u8s1d r-zchlnj r-ipm5af r-1niwhzg r-sdzlij r-xf4iuw r-o7ynqc r-6416eg r-1ny4l3l" style="transition: background-color 0.2s;"></div>
            <svg viewBox="0 0 24 24" aria-hidden="true" class="r-4qtqp9 r-yyyyoo r-dnmrzs r-bnwqim r-lrvibr r-m6rgpd r-1xvli5t r-1hdv0qi" style="fill: currentColor;">
              <g><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"></path></g>
            </svg>
          </div>
        </div>
      </div>
    `;

    // Add hover effect
    const hoverCircle = badge.querySelector('.bnbot-hover-circle') as HTMLElement;
    if (hoverCircle) {
      badge.addEventListener('mouseenter', () => {
        hoverCircle.style.backgroundColor = 'rgba(245, 158, 11, 0.2)';
      });
      badge.addEventListener('mouseleave', () => {
        hoverCircle.style.backgroundColor = 'transparent';
      });
    }

    // Add tooltip
    badge.title = 'Active Boost Campaign - Click to view details';

    // Add click handler to open Boost panel
    badge.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      window.dispatchEvent(
        new CustomEvent('bnbot-open-boost-tab', { detail: { tweetId } })
      );
    });

    // Insert badge before bookmark container
    bookmarkContainer.parentElement.insertBefore(badge, bookmarkContainer);

    // Mark as injected
    this.badgeInjectedTweetIds.add(tweetId);
    console.log(`[HomeBoostChecker] ⚡ Badge injected for tweet: ${tweetId}`);
  }
}
