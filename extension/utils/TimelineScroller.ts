/**
 * Timeline Scroller
 * Scrolls through Twitter timeline and collects tweets for processing
 */

import { ScrapedTweet } from '../types/autoReply';
import { HumanBehaviorSimulator } from './HumanBehaviorSimulator';
import { apiDataCache } from './ApiDataCache';

export interface TimelineScrollerOptions {
  onTweetFound: (tweet: ScrapedTweet) => void;
  onScrollComplete?: () => void;
  onError?: (error: Error) => void;
  tweetsPerBatch?: number;      // Collect this many before pausing (default: 5)
  maxScrollAttempts?: number;   // Stop if no new tweets found (default: 10)
}

// Twitter DOM selectors
const SELECTORS = {
  tweet: 'article[data-testid="tweet"]',
  userName: '[data-testid="User-Name"]',
  tweetText: '[data-testid="tweetText"]',
  avatar: '[data-testid="Tweet-User-Avatar"]',
  time: 'time[datetime]',
  tweetPhoto: '[data-testid="tweetPhoto"]',
  videoPlayer: '[data-testid="videoPlayer"]',
  socialContext: '[data-testid="socialContext"]', // Retweet indicator
  replyCount: '[data-testid="reply"]',
  retweetCount: '[data-testid="retweet"]',
  likeCount: '[data-testid="like"]',
  viewCount: 'a[href*="/analytics"]'
};

export class TimelineScroller {
  private processedTweetIds: Set<string> = new Set();
  private mutationObserver: MutationObserver | null = null;
  private isScrolling: boolean = false;
  private isPaused: boolean = false;
  private scrollAttempts: number = 0;
  private options: Required<TimelineScrollerOptions>;
  private collectedTweets: ScrapedTweet[] = [];
  private currentUserHandle: string | null = null;
  private scrolledTweetCount: number = 0; // Track how many tweets we've scrolled past
  private readonly MAX_SCROLL_BEFORE_REFRESH = 15; // Scroll back to top after this many tweets

  constructor(options: TimelineScrollerOptions) {
    this.options = {
      onTweetFound: options.onTweetFound,
      onScrollComplete: options.onScrollComplete || (() => { }),
      onError: options.onError || ((e) => console.error('[TimelineScroller]', e)),
      tweetsPerBatch: options.tweetsPerBatch || 5,
      maxScrollAttempts: options.maxScrollAttempts || 10
    };
  }

  /**
   * Start scrolling and collecting tweets
   */
  async start(): Promise<void> {
    if (this.isScrolling) {
      console.log('[TimelineScroller] Already scrolling');
      return;
    }

    // Check if we're on timeline, navigate back if not
    if (!this.isOnHomeTimeline()) {
      console.log('[TimelineScroller] Not on home timeline, navigating to home');
      const navigated = await this.navigateToHome();
      if (!navigated) {
        console.warn('[TimelineScroller] Could not navigate to home, aborting start');
        return;
      }
    }

    console.log('[TimelineScroller] Starting...');
    this.isScrolling = true;
    this.isPaused = false;
    this.scrollAttempts = 0;

    // Get current user handle
    this.resolveCurrentUser();

    // Start mutation observer to detect new tweets
    this.startMutationObserver();

    // Initial scan
    await this.scanCurrentTweets();
  }

  /**
   * Pause scrolling
   */
  pause(): void {
    this.isPaused = true;
    console.log('[TimelineScroller] Paused');
  }

  /**
   * Resume scrolling
   */
  resume(): void {
    this.isPaused = false;
    console.log('[TimelineScroller] Resumed');
  }

  /**
   * Mark a tweet as processed (public method for external callers)
   * This ensures the tweet won't be rescanned in future sessions
   */
  markAsProcessed(tweetId: string): void {
    if (!this.processedTweetIds.has(tweetId)) {
      this.processedTweetIds.add(tweetId);
      console.log('[TimelineScroller] Marked tweet as processed:', tweetId);
      // Save to storage for persistence
      this.saveProcessedToStorage();
    }
  }

  /**
   * Stop scrolling completely
   */
  stop(): void {
    this.isScrolling = false;
    this.isPaused = false;

    if (this.mutationObserver) {
      this.mutationObserver.disconnect();
      this.mutationObserver = null;
    }

    console.log('[TimelineScroller] Stopped');
  }

  /**
   * Check if currently on the home timeline
   */
  isOnHomeTimeline(): boolean {
    const path = window.location.pathname;
    return path === '/' || path === '/home' || path.startsWith('/home');
  }

  /**
   * Navigate back to home timeline using SPA-friendly method
   */
  async navigateToHome(): Promise<boolean> {
    if (this.isOnHomeTimeline()) return true;

    console.log('[TimelineScroller] Navigating to home from:', window.location.pathname);

    // Method 1: Click home button (SPA navigation, no refresh)
    const homeLink = document.querySelector('a[data-testid="AppTabBar_Home_Link"]') as HTMLElement;
    if (homeLink) {
      homeLink.click();
    } else {
      // Method 2: Create temp link inside React root (SPA navigation)
      const tempLink = document.createElement('a');
      tempLink.href = '/home';
      tempLink.style.display = 'none';
      const reactRoot = document.getElementById('react-root') || document.body;
      reactRoot.appendChild(tempLink);
      tempLink.click();
      reactRoot.removeChild(tempLink);
    }

    // Wait and verify navigation succeeded
    const maxWait = 5000;
    const interval = 300;
    let waited = 0;
    while (waited < maxWait) {
      await new Promise(resolve => setTimeout(resolve, interval));
      waited += interval;
      if (this.isOnHomeTimeline()) {
        console.log('[TimelineScroller] Successfully navigated to home');
        await HumanBehaviorSimulator.randomDelay(500, 1000);
        return true;
      }
    }

    console.warn('[TimelineScroller] Failed to navigate to home after', maxWait, 'ms');
    return false;
  }

  /**
   * Scroll and collect a batch of tweets
   */
  async scrollAndCollect(): Promise<ScrapedTweet[]> {
    // Check if we're on the home timeline - skip scrolling if not
    if (!this.isOnHomeTimeline()) {
      console.log('[TimelineScroller] Not on home timeline (' + window.location.pathname + '), cannot scroll here.');
      return [];
    }

    if (!this.isScrolling) {
      await this.start();
    }

    this.collectedTweets = [];
    let attempts = 0;

    while (this.collectedTweets.length < this.options.tweetsPerBatch &&
      attempts < this.options.maxScrollAttempts) {
      if (this.isPaused) {
        await new Promise(resolve => setTimeout(resolve, 500));
        continue;
      }

      // Re-check URL inside loop - page might have changed during scrolling
      if (!this.isOnHomeTimeline()) {
        console.log('[TimelineScroller] Left home timeline during scroll, stopping collection.');
        break;
      }

      // Check if we've scrolled past too many tweets - time to refresh
      if (this.scrolledTweetCount >= this.MAX_SCROLL_BEFORE_REFRESH) {
        console.log('[TimelineScroller] Scrolled past', this.scrolledTweetCount, 'tweets, refreshing timeline...');
        await this.scrollToTopAndLoadNew();
        this.scrolledTweetCount = 0; // Reset counter
        continue;
      }

      // Scroll down
      await HumanBehaviorSimulator.scrollByViewport();
      await HumanBehaviorSimulator.microPause();

      // Scan for new tweets
      const newTweets = await this.scanCurrentTweets();
      this.scrolledTweetCount += newTweets; // Count tweets we've scrolled past

      if (newTweets === 0) {
        attempts++;
        this.scrollAttempts++;
      } else {
        attempts = 0;
      }

      // Natural reading pause
      await HumanBehaviorSimulator.randomDelay(500, 1500);
    }

    this.options.onScrollComplete?.();
    return this.collectedTweets;
  }

  /**
   * Scroll to top and click "Show X posts" button to load new tweets
   */
  private findShowPostsButton(): HTMLElement | null {
    const buttons = document.querySelectorAll('button[type="button"]');
    for (const btn of buttons) {
      const text = btn.textContent || '';
      // Match: "显示 38 帖子", "Show 35 posts", "Show 12 Tweets", "显示38帖子"
      if (/显示\s*\d+\s*帖子|Show\s*\d+\s*(posts|Tweets)/i.test(text)) {
        return btn as HTMLElement;
      }
    }
    return null;
  }

  private async scrollToTopAndLoadNew(): Promise<void> {
    console.log('[TimelineScroller] Scrolling to top...');

    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
    await HumanBehaviorSimulator.randomDelay(500, 800);

    // Wait for "Show X posts" button to appear (poll up to 8 seconds)
    let loadMoreButton: HTMLElement | null = null;
    const maxWait = 8000;
    const interval = 500;
    let waited = 0;

    while (waited < maxWait) {
      loadMoreButton = this.findShowPostsButton();
      if (loadMoreButton) break;
      await new Promise(resolve => setTimeout(resolve, interval));
      waited += interval;
    }

    if (loadMoreButton) {
      console.log('[TimelineScroller] Found "Show posts" button after', waited, 'ms, clicking...');
      loadMoreButton.click();
      await HumanBehaviorSimulator.randomDelay(1000, 1500);
    } else {
      console.log('[TimelineScroller] "Show posts" button not found after', maxWait, 'ms, clicking Home to refresh');
      // Fallback: click Home button to refresh
      const homeLink = document.querySelector('a[data-testid="AppTabBar_Home_Link"]') as HTMLElement;
      if (homeLink) {
        homeLink.click();
        await HumanBehaviorSimulator.randomDelay(1500, 2000);
      }
    }
  }

  /**
   * Scan for tweets in current view (without scrolling)
   * Used by NotificationProcessor
   */
  async scanTweetsInCurrentView(): Promise<ScrapedTweet[]> {
    const articles = document.querySelectorAll(SELECTORS.tweet);
    const tweets: ScrapedTweet[] = [];

    articles.forEach(article => {
      if (article instanceof HTMLElement) {
        const tweet = this.scrapeTweetArticle(article);
        // Note: scrapeTweetArticle checks processedTweetIds and duplicate/own tweets
        if (tweet) {
          tweets.push(tweet);
          // We mark as processed here? or let caller?
          // scrapeTweetArticle does NOT modify processedTweetIds
          // But scroller usually relies on onTweetFound or something.
          // NotificationProcessor needs to return them.
        }
      }
    });

    return tweets;
  }

  /**
   * Get the list of processed tweet IDs
   */
  getProcessedTweetIds(): Set<string> {
    return this.processedTweetIds;
  }

  /**
   * Clear processed tweet history
   */
  clearProcessedHistory(): void {
    this.processedTweetIds.clear();
  }

  /**
   * Load processed tweet IDs from storage
   */
  async loadProcessedFromStorage(): Promise<void> {
    try {
      const result = await chrome.storage.local.get('bnbot_auto_reply_processed_tweets');
      if (result.bnbot_auto_reply_processed_tweets) {
        const ids = JSON.parse(result.bnbot_auto_reply_processed_tweets as string);
        this.processedTweetIds = new Set(ids);
        console.log('[TimelineScroller] Loaded', this.processedTweetIds.size, 'processed tweets from storage');
      }
    } catch (e) {
      console.error('[TimelineScroller] Failed to load processed tweets', e);
    }
  }

  /**
   * Save processed tweet IDs to storage
   */
  async saveProcessedToStorage(): Promise<void> {
    try {
      const ids = Array.from(this.processedTweetIds);
      // Keep only the last 1000 to prevent storage bloat
      const recentIds = ids.slice(-1000);
      await chrome.storage.local.set({
        bnbot_auto_reply_processed_tweets: JSON.stringify(recentIds)
      });
    } catch (e) {
      console.error('[TimelineScroller] Failed to save processed tweets', e);
    }
  }

  // Private methods

  private resolveCurrentUser(): void {
    const btn = document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]');
    if (btn) {
      const text = btn.textContent || '';
      const match = text.match(/@(\w+)/);
      if (match) {
        this.currentUserHandle = match[1].toLowerCase();
        console.log('[TimelineScroller] Current user:', this.currentUserHandle);
      }
    }
  }

  private startMutationObserver(): void {
    if (this.mutationObserver) {
      this.mutationObserver.disconnect();
    }

    this.mutationObserver = new MutationObserver((mutations) => {
      // Skip mutation processing if not on home timeline
      if (!this.isOnHomeTimeline()) {
        return;
      }

      if (this.isPaused) return;

      mutations.forEach(mutation => {
        mutation.addedNodes.forEach(node => {
          if (node instanceof HTMLElement) {
            const articles = node.querySelectorAll(SELECTORS.tweet);
            articles.forEach(article => {
              if (article instanceof HTMLElement) {
                const tweet = this.scrapeTweetArticle(article);
                if (tweet && !this.processedTweetIds.has(tweet.id)) {
                  this.collectedTweets.push(tweet);
                  this.options.onTweetFound(tweet);
                }
              }
            });
          }
        });
      });
    });

    this.mutationObserver.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  private async scanCurrentTweets(): Promise<number> {
    // Skip scanning if not on home timeline
    if (!this.isOnHomeTimeline()) {
      return 0;
    }

    let newTweetsCount = 0;
    const articles = document.querySelectorAll(SELECTORS.tweet);

    articles.forEach(article => {
      if (article instanceof HTMLElement) {
        const tweet = this.scrapeTweetArticle(article);
        if (tweet && !this.processedTweetIds.has(tweet.id)) {
          this.processedTweetIds.add(tweet.id);
          this.collectedTweets.push(tweet);
          this.options.onTweetFound(tweet);
          newTweetsCount++;
        }
      }
    });

    return newTweetsCount;
  }

  private scrapeTweetArticle(article: HTMLElement): ScrapedTweet | null {
    try {
      // Get tweet ID from status link
      const tweetId = this.getTweetId(article);
      if (!tweetId) return null;

      // Skip if already processed
      if (this.processedTweetIds.has(tweetId)) return null;

      // Check if it's a retweet
      const socialContext = article.querySelector(SELECTORS.socialContext);
      const isRetweet = !!socialContext?.textContent?.toLowerCase().includes('repost');

      // Get author info from DOM
      const { handle, name, avatar, isVerified } = this.getAuthorInfo(article);

      // Skip own tweets
      if (this.currentUserHandle && handle.toLowerCase() === this.currentUserHandle) {
        return null;
      }

      // Get tweet content
      const content = this.getTweetContent(article);
      if (!content) return null;

      // Get timestamp
      const timeEl = article.querySelector(SELECTORS.time);
      const timestamp = timeEl?.getAttribute('datetime') || new Date().toISOString();

      // Get metrics
      const metrics = this.getTweetMetrics(article);

      // Get media
      const media = this.getMedia(article);

      // Get tweet URL
      const tweetUrl = `https://x.com/${handle}/status/${tweetId}`;

      // Try to get avatar from API cache (more reliable than DOM scraping)
      let finalAvatar = avatar;
      let finalName = name;
      const cachedData = apiDataCache.getTweet(tweetId);
      if (cachedData) {
        if (cachedData.profileImageUrl) {
          finalAvatar = cachedData.profileImageUrl;
        }
        if (!finalName && cachedData.displayName) {
          finalName = cachedData.displayName;
        }
      }

      return {
        id: tweetId,
        authorHandle: handle,
        authorName: finalName,
        authorAvatar: finalAvatar,
        isVerified,
        content,
        timestamp,
        metrics,
        media,
        isRetweet,
        isQuote: false, // TODO: detect quote tweets
        articleElement: article,
        tweetUrl
      };
    } catch (e) {
      console.error('[TimelineScroller] Failed to scrape tweet', e);
      return null;
    }
  }

  private getTweetId(article: HTMLElement): string | null {
    const link = article.querySelector('a[href*="/status/"]');
    if (link) {
      const href = link.getAttribute('href');
      const match = href?.match(/\/status\/(\d+)/);
      if (match) {
        return match[1];
      }
    }
    return null;
  }

  private getAuthorInfo(article: HTMLElement): { handle: string; name: string; avatar: string; isVerified: boolean } {
    let handle = '';
    let name = '';
    let avatar = '';
    let isVerified = false;

    const userNameEl = article.querySelector(SELECTORS.userName);
    if (userNameEl) {
      // Get name from first span
      const nameSpan = userNameEl.querySelector('span');
      name = nameSpan?.textContent?.trim() || '';

      // Get handle from link
      const links = userNameEl.querySelectorAll('a');
      for (const link of links) {
        const href = link.getAttribute('href');
        if (href && href.startsWith('/') && !href.includes('/status/')) {
          handle = href.substring(1);
          break;
        }
      }

      // Check for verified badge (blue checkmark SVG)
      // Supports English "Verified", Chinese "认证账号", and data-testid
      const verifiedBadge = userNameEl.querySelector('svg[aria-label*="Verified"], svg[aria-label*="verified"], svg[aria-label*="认证账号"], [data-testid="icon-verified"]');
      isVerified = !!verifiedBadge;
    }

    // Get avatar - try multiple methods
    // Method 1: Standard avatar container
    const avatarContainer = article.querySelector(SELECTORS.avatar);
    if (avatarContainer) {
      // Try finding img tag (most common)
      const img = avatarContainer.querySelector('img');
      if (img && img.src && !img.src.includes('data:')) {
        avatar = img.src;
      }

      // If no img src, check background-image on div
      if (!avatar) {
        const bgDiv = avatarContainer.querySelector('div[style*="background-image"]');
        if (bgDiv) {
          const style = bgDiv.getAttribute('style') || '';
          const match = style.match(/url\("?(.+?)"?\)/);
          if (match && match[1]) {
            avatar = match[1];
          }
        }
      }
    }

    // Method 2: Fallback - find any profile image in the article header area
    if (!avatar) {
      // Try to find img near the user name
      const headerImgs = article.querySelectorAll('img[src*="profile_images"], img[src*="pbs.twimg.com"]');
      for (const img of headerImgs) {
        const src = (img as HTMLImageElement).src;
        if (src && !src.includes('emoji') && !src.includes('media') && !src.includes('data:')) {
          avatar = src;
          break;
        }
      }
    }

    // Method 3: Use handle to construct default avatar URL if still no avatar
    if (!avatar && handle) {
      // We can't construct a reliable avatar URL without API, so leave empty
      // The UI should handle missing avatars gracefully
      console.log('[TimelineScroller] Could not find avatar for @' + handle);
    }

    return { handle, name, avatar, isVerified };
  }

  private getTweetContent(article: HTMLElement): string {
    const textEl = article.querySelector(SELECTORS.tweetText);
    return textEl?.textContent?.trim() || '';
  }

  private getTweetMetrics(article: HTMLElement): ScrapedTweet['metrics'] {
    const metrics = {
      replies: 0,
      retweets: 0,
      likes: 0,
      views: 0
    };

    // Reply count
    const replyBtn = article.querySelector(SELECTORS.replyCount);
    if (replyBtn) {
      const text = replyBtn.getAttribute('aria-label') || '';
      const match = text.match(/(\d+)/);
      if (match) metrics.replies = parseInt(match[1], 10);
    }

    // Retweet count
    const retweetBtn = article.querySelector(SELECTORS.retweetCount);
    if (retweetBtn) {
      const text = retweetBtn.getAttribute('aria-label') || '';
      const match = text.match(/(\d+)/);
      if (match) metrics.retweets = parseInt(match[1], 10);
    }

    // Like count
    const likeBtn = article.querySelector(SELECTORS.likeCount);
    if (likeBtn) {
      const text = likeBtn.getAttribute('aria-label') || '';
      const match = text.match(/(\d+)/);
      if (match) metrics.likes = parseInt(match[1], 10);
    }

    // View count
    const viewLink = article.querySelector(SELECTORS.viewCount);
    if (viewLink) {
      // Try aria-label first (e.g. "50685 次查看")
      const ariaLabel = viewLink.getAttribute('aria-label');
      // Try text content (e.g. "5万")
      const text = viewLink.textContent || '';

      // Match number potentially with units K, M, B, 万, 亿
      // Prioritize full number in aria-label if available for accuracy
      const fullNumMatch = ariaLabel?.match(/^(\d[\d,]*)/);
      if (fullNumMatch) {
        metrics.views = parseInt(fullNumMatch[1].replace(/,/g, ''), 10);
      } else {
        const match = text.match(/([\d.,]+[KMB万亿]?)/i);
        if (match) {
          metrics.views = this.parseMetricNumber(match[1]);
        }
      }
    }

    return metrics;
  }

  private parseMetricNumber(text: string): number {
    const cleanText = text.replace(/,/g, '');
    const num = parseFloat(cleanText);

    const upperText = cleanText.toUpperCase();
    if (upperText.includes('K')) return num * 1000;
    if (upperText.includes('M')) return num * 1000000;
    if (upperText.includes('B')) return num * 1000000000;
    // Chinese units
    if (upperText.includes('万')) return num * 10000;
    if (upperText.includes('亿')) return num * 100000000;

    return isNaN(num) ? 0 : num;
  }

  private getMedia(article: HTMLElement): { type: 'photo' | 'video'; url: string }[] {
    const media: { type: 'photo' | 'video'; url: string }[] = [];

    // Photos: Query for the container first
    // User HTML shows: <div ... data-testid="tweetPhoto"><img ...></div>
    const photoContainers = article.querySelectorAll('[data-testid="tweetPhoto"]');
    photoContainers.forEach(container => {
      // Find the image inside the container
      const img = container.querySelector('img');
      const src = img?.getAttribute('src');
      if (src) {
        media.push({ type: 'photo', url: src });
      }
    });

    // Videos: <div data-testid="videoPlayer">...<video poster="...">...</div>
    const videoPlayers = article.querySelectorAll('[data-testid="videoPlayer"]');
    videoPlayers.forEach(player => {
      // Find the poster image or video element
      const videoEl = player.querySelector('video');
      const poster = videoEl?.getAttribute('poster');

      if (poster) {
        media.push({ type: 'video', url: poster });
      } else {
        // Fallback: finding img in the player (often the thumbnail)
        const img = player.querySelector('img');
        const src = img?.getAttribute('src');
        if (src) {
          media.push({ type: 'video', url: src });
        }
      }
    });

    // Dedup media by URL
    const uniqueMedia = media.filter((v, i, a) => a.findIndex(t => t.url === v.url) === i);

    return uniqueMedia;
  }

  /**
   * Scroll a specific tweet into view
   */
  scrollToTweet(tweet: ScrapedTweet): void {
    if (tweet.articleElement) {
      tweet.articleElement.scrollIntoView({
        behavior: 'smooth',
        block: 'center'
      });
    }
  }
}
