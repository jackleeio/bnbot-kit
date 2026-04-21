/**
 * HomeTimelineMonitor
 *
 * Monitors the Twitter/X home timeline by:
 * 1. Injecting a script to intercept HomeTimeline API responses
 * 2. Using IntersectionObserver to detect when tweets become visible
 * 3. Logging tweet data to console when they enter the viewport
 * 4. Predicting comment exposure using v1.1 algorithm
 */

// predictExposure import removed — badge feature retired with auto-reply migration

declare const chrome: any;

// Extend Window interface for our injected flag
declare global {
  interface Window {
    __BNBOT_TIMELINE_INTERCEPTOR_INJECTED__?: boolean;
  }
}

export interface TimelineTweetData {
  tweetId: string;
  username: string;           // screen_name
  displayName: string;        // name
  profileImageUrl: string;    // profile_image_url_https (avatar)
  followers: number;          // followers_count
  following: number;          // friends_count
  bio: string;                // description
  tweetText: string;          // full_text
  replyCount: number;
  retweetCount: number;
  likeCount: number;
  viewCount: number;
  createdAt: string;          // created_at
  mediaType: 'video' | 'image' | 'none';  // 媒体类型：视频 > 图片 > 无
  mediaUrls?: Array<{ type: 'photo' | 'video' | 'animated_gif'; url: string; thumbnail?: string }>;
}

export class HomeTimelineMonitor {
  private tweetCache: Map<string, TimelineTweetData> = new Map();
  private intersectionObserver: IntersectionObserver | null = null;
  private mutationObserver: MutationObserver | null = null;
  private reportedTweets: Set<string> = new Set();
  private isRunning: boolean = false;
  private messageHandler: ((event: MessageEvent) => void) | null = null;
  private injectedScriptElement: HTMLScriptElement | null = null;
  private urlCheckInterval: ReturnType<typeof setInterval> | null = null;
  private lastUrl: string = '';
  private thresholdChangeHandler: ((event: Event) => void) | null = null;

  // Maximum cache size to prevent memory leaks
  private readonly MAX_CACHE_SIZE = 500;

  constructor() {
    console.log('[BNBot Timeline Monitor] Instance created');
  }

  /**
   * Get current cache size
   */
  getCacheSize(): number {
    return this.tweetCache.size;
  }

  /**
   * Check if monitor is currently running
   */
  getIsRunning(): boolean {
    return this.isRunning;
  }

  /**
   * Manually refresh the timeline cache
   * Triggers Home button click to get fresh API data
   */
  async refreshCache(): Promise<void> {
    console.log('[BNBot Timeline Monitor] Refreshing cache...');
    this.triggerHomeRefresh();
    await this.waitForCache(3000);
    console.log(`[BNBot Timeline Monitor] Cache refresh complete, size: ${this.tweetCache.size}`);
  }

  /**
   * Wait for cache to be populated (up to specified timeout)
   */
  private waitForCache(timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      const startTime = Date.now();
      const checkInterval = 100;

      const check = () => {
        if (this.tweetCache.size > 0) {
          console.log(`[BNBot Timeline Monitor] Cache populated after ${Date.now() - startTime}ms`);
          resolve();
          return;
        }

        if (Date.now() - startTime >= timeoutMs) {
          console.log('[BNBot Timeline Monitor] Cache wait timeout');
          resolve();
          return;
        }

        setTimeout(check, checkInterval);
      };

      check();
    });
  }

  /**
   * Start monitoring the timeline
   * @param skipRefresh - 如果为 true，不触发 Home 按钮点击刷新（用于从详情页返回时）
   */
  start(skipRefresh: boolean = false): void {
    if (this.isRunning) {
      return;
    }

    console.log('[BNBot Timeline Monitor] Starting...');
    this.isRunning = true;
    this.lastUrl = window.location.href;

    // 1. Inject the fetch interceptor script (runs in background)
    this.injectFetchInterceptor();

    // 2. Set up message listener for API data
    this.setupMessageListener();

    // 3. Set up IntersectionObserver for future tweets
    this.setupIntersectionObserver();

    // 4. Set up MutationObserver to watch for new tweet elements
    this.setupMutationObserver();

    // 5. Scan existing tweets for observer
    this.scanExistingTweets();

    // 6. Trigger Home button click to refresh timeline and get API data
    // Skip this when returning from tweet detail to avoid scrolling to top
    if (!skipRefresh) {
      this.triggerHomeRefresh();
    } else {
      console.log('[BNBot Timeline Monitor] Skipping refresh (returning from detail page)');
      // 直接扫描当前可见推文
      this.logCurrentlyVisibleTweets();
    }

    // 7. Set up URL change detection for SPA navigation
    this.setupUrlChangeDetection();

    // 8. Listen for threshold changes to update badge colors
    this.setupThresholdChangeListener();

    console.log('[BNBot Timeline Monitor] Started successfully');
  }

  /**
   * Trigger a Home button click to refresh the timeline
   * This causes Twitter to make a new HomeTimeline API request
   * which our interceptor will capture with full user data
   */
  private triggerHomeRefresh(): void {
    // Method 1: Try clicking the Home link in the navigation
    const homeLink = document.querySelector('a[data-testid="AppTabBar_Home_Link"]') as HTMLElement;
    if (homeLink) {
      console.log('[BNBot Timeline Monitor] Clicking Home button to refresh timeline...');
      homeLink.click();
      return;
    }

    // Method 2: Try clicking the X logo (also navigates to /home)
    const xLogoLink = document.querySelector('header[role="banner"] h1 a[href="/home"]') as HTMLElement;
    if (xLogoLink) {
      console.log('[BNBot Timeline Monitor] Clicking X logo to refresh timeline...');
      xLogoLink.click();
      return;
    }

    // Method 3: Fallback - find any link to /home in the header
    const headerHomeLink = document.querySelector('header[role="banner"] a[href="/home"]') as HTMLElement;
    if (headerHomeLink) {
      console.log('[BNBot Timeline Monitor] Clicking header home link to refresh timeline...');
      headerHomeLink.click();
      return;
    }

    console.log('[BNBot Timeline Monitor] Could not find Home button to trigger refresh');
  }

  /**
   * Stop monitoring the timeline
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    console.log('[BNBot Timeline Monitor] Stopping...');
    this.isRunning = false;

    // Remove message listener
    if (this.messageHandler) {
      window.removeEventListener('message', this.messageHandler);
      this.messageHandler = null;
    }

    // Disconnect observers
    if (this.intersectionObserver) {
      this.intersectionObserver.disconnect();
      this.intersectionObserver = null;
    }

    if (this.mutationObserver) {
      this.mutationObserver.disconnect();
      this.mutationObserver = null;
    }

    // Clear URL check interval
    if (this.urlCheckInterval) {
      clearInterval(this.urlCheckInterval);
      this.urlCheckInterval = null;
    }

    // Remove threshold change listener
    if (this.thresholdChangeHandler) {
      window.removeEventListener('bnbot:exposure-threshold-changed', this.thresholdChangeHandler);
      this.thresholdChangeHandler = null;
    }

    // Clear state but KEEP tweetCache for when user returns
    // tweetCache should persist across page navigations
    this.reportedTweets.clear();

    console.log('[BNBot Timeline Monitor] Stopped');
  }

  /**
   * Set up URL change detection for SPA navigation
   * When user navigates back to /home, rescan tweets
   */
  private setupUrlChangeDetection(): void {
    // Clear any existing interval
    if (this.urlCheckInterval) {
      clearInterval(this.urlCheckInterval);
    }

    // Check URL every 500ms for SPA navigation
    this.urlCheckInterval = setInterval(() => {
      const currentUrl = window.location.href;

      if (currentUrl !== this.lastUrl) {
        const wasOnHome = this.lastUrl.includes('/home');
        const isOnHome = currentUrl.includes('/home');

        console.log(`[BNBot Timeline Monitor] URL changed: ${this.lastUrl} -> ${currentUrl}`);
        this.lastUrl = currentUrl;

        // If user navigated back to /home, rescan and re-observe tweets
        if (isOnHome && !wasOnHome) {
          console.log('[BNBot Timeline Monitor] Returned to /home, rescanning tweets...');
          this.onReturnToHome();
        }
      }
    }, 500);
  }

  /**
   * Handle when user returns to /home from another page
   */
  private onReturnToHome(): void {
    // Give DOM time to render
    setTimeout(() => {
      // Ensure message listener is still active
      if (!this.messageHandler) {
        console.log('[BNBot Timeline Monitor] Re-setting up message listener...');
        this.setupMessageListener();
      }

      // Re-setup IntersectionObserver (old one may have stale references)
      if (this.intersectionObserver) {
        this.intersectionObserver.disconnect();
      }
      this.setupIntersectionObserver();

      // Re-setup MutationObserver
      if (this.mutationObserver) {
        this.mutationObserver.disconnect();
      }
      this.setupMutationObserver();

      // Rescan existing tweets
      this.scanExistingTweets();

      // Log currently visible tweets from cache
      this.logCurrentlyVisibleTweets();
    }, 500);
  }

  /**
   * Inject the timeline interceptor script into the page context
   * Uses external script file due to CSP restrictions on inline scripts
   */
  private injectFetchInterceptor(): void {
    // Check if already injected
    if (document.getElementById('bnbot-timeline-interceptor')) {
      console.log('[BNBot Timeline Monitor] Interceptor already injected');
      return;
    }

    try {
      const script = document.createElement('script');
      script.id = 'bnbot-timeline-interceptor';
      script.src = chrome.runtime.getURL('timeline-interceptor.js');
      script.onload = () => {
        console.log('[BNBot Timeline Monitor] Interceptor script loaded');
      };
      script.onerror = (err) => {
        console.error('[BNBot Timeline Monitor] Failed to load interceptor:', err);
      };

      // Insert at the beginning for earliest execution
      const target = document.head || document.documentElement;
      if (target.firstChild) {
        target.insertBefore(script, target.firstChild);
      } else {
        target.appendChild(script);
      }

      this.injectedScriptElement = script;
    } catch (err) {
      console.error('[BNBot Timeline Monitor] Error injecting interceptor:', err);
    }
  }

  /**
   * Set up listener for messages from the injected script
   */
  private setupMessageListener(): void {
    this.messageHandler = (event: MessageEvent) => {
      // Only accept messages from the same window
      if (event.source !== window) {
        return;
      }

      if (event.data?.type === 'BNBOT_TIMELINE_DATA') {
        this.handleApiData(event.data.payload);
      }

      // Handle TweetDetail API data for prediction badges on tweet detail pages
      if (event.data?.type === 'BNBOT_API_DATA' && event.data?.endpoint === 'tweet_detail') {
        this.handleTweetDetailData(event.data.payload);
      }
    };

    window.addEventListener('message', this.messageHandler);
  }

  /**
   * Parse and cache tweet data from API response
   */
  private handleApiData(data: any): void {
    try {
      // Navigate to the instructions array
      const instructions = data?.data?.home?.home_timeline_urt?.instructions || [];

      for (const instruction of instructions) {
        const entries = instruction?.entries || [];

        for (const entry of entries) {
          this.parseEntry(entry);
        }
      }

      // Limit cache size
      this.trimCache();

      console.log(`[BNBot Timeline Monitor] Cache updated, total tweets: ${this.tweetCache.size}`);

      // 立即扫描当前可见的推文并输出预测
      this.logCurrentlyVisibleTweets();
    } catch (err) {
      console.error('[BNBot Timeline Monitor] Error parsing API data:', err);
    }
  }

  /**
   * Parse and cache tweet data from TweetDetail API response
   * This enables prediction badges on tweet detail pages
   */
  private handleTweetDetailData(data: any): void {
    try {
      const instructions = data?.data?.threaded_conversation_with_injections_v2?.instructions;
      if (!instructions || !Array.isArray(instructions)) return;

      for (const instruction of instructions) {
        const entries = instruction?.entries;
        if (!entries) continue;

        for (const entry of entries) {
          // Focal tweet entry (e.g., "tweet-123456")
          this.parseEntry(entry);

          // Conversation thread modules (replies shown below the focal tweet)
          const items = entry?.content?.items;
          if (items && Array.isArray(items)) {
            for (const item of items) {
              const itemContent = item?.item?.itemContent;
              if (itemContent?.tweet_results?.result) {
                this.parseTweetResult(itemContent.tweet_results.result);
              }
            }
          }
        }
      }

      this.trimCache();
      console.log(`[BNBot Timeline Monitor] TweetDetail cache updated, total tweets: ${this.tweetCache.size}`);

      // Scan visible tweets and inject prediction badges
      this.logCurrentlyVisibleTweets();
    } catch (err) {
      console.error('[BNBot Timeline Monitor] Error parsing TweetDetail data:', err);
    }
  }

  /**
   * 扫描当前页面上可见的推文并输出预测
   */
  private logCurrentlyVisibleTweets(): void {
    const tweetElements = document.querySelectorAll('[data-testid="tweet"]');

    for (const element of tweetElements) {
      // 检查元素是否在视口中
      const rect = element.getBoundingClientRect();
      const isVisible = rect.top < window.innerHeight && rect.bottom > 0;

      if (isVisible) {
        const tweetId = this.extractTweetIdFromElement(element as HTMLElement);
        if (tweetId && !this.reportedTweets.has(tweetId)) {
          const data = this.tweetCache.get(tweetId);
          if (data) {
            this.logTweetData(data);
            this.injectPredictionBadgeWithRetry(element as HTMLElement, data);
            this.reportedTweets.add(tweetId);
          }
        }
      }
    }
  }

  /**
   * Inject prediction badge with retry mechanism
   * Sometimes DOM is not fully rendered when we first try to inject
   */
  private injectPredictionBadgeWithRetry(element: HTMLElement, data: TimelineTweetData, retryCount = 0): void {
    const maxRetries = 3;
    const retryDelay = 200;

    // Try to inject
    const success = this.injectPredictionBadge(element, data);

    // If failed and we have retries left, try again after delay
    if (!success && retryCount < maxRetries) {
      setTimeout(() => {
        this.injectPredictionBadgeWithRetry(element, data, retryCount + 1);
      }, retryDelay);
    }
  }

  /**
   * Parse a single entry from the timeline
   */
  private parseEntry(entry: any): void {
    try {
      // Handle conversation threads (e.g., tweet + reply shown together)
      // These have content.items[] instead of content.itemContent
      const items = entry?.content?.items;
      if (items && Array.isArray(items)) {
        for (const item of items) {
          const nestedItemContent = item?.item?.itemContent;
          if (nestedItemContent?.tweet_results?.result) {
            this.parseTweetResult(nestedItemContent.tweet_results.result);
          }
        }
        return;
      }

      const itemContent = entry?.content?.itemContent;
      if (!itemContent) return;

      const tweetResult = itemContent?.tweet_results?.result;
      if (!tweetResult) return;

      this.parseTweetResult(tweetResult);
    } catch (err) {
      // Silently ignore parse errors for individual entries
    }
  }

  /**
   * Parse a tweet result object and store in cache
   * Used by both regular tweets and conversation thread items
   */
  private parseTweetResult(tweetResult: any): void {
    try {
      // Handle tweets that might be wrapped in a "tweet" property
      const tweet = tweetResult?.tweet || tweetResult;

      // Get tweet ID (this is the ID shown in the timeline, could be RT's ID)
      const tweetId = tweet?.rest_id;
      if (!tweetId) return;

      // Check if this is a retweet - if so, get the original tweet data
      const retweetedResult = tweet?.legacy?.retweeted_status_result?.result;
      const isRetweet = !!retweetedResult;

      // For retweets, we want to use the original tweet's data for prediction
      // but store it under the retweet's ID (since that's what shows in the DOM)
      const targetTweet = isRetweet ? (retweetedResult?.tweet || retweetedResult) : tweet;
      const targetTweetLegacy = targetTweet?.legacy;

      if (!targetTweetLegacy) return;

      // Get user data from the target tweet (original author for retweets)
      const userResult = targetTweet?.core?.user_results?.result;
      const userCore = userResult?.core;
      const userLegacy = userResult?.legacy;

      // Detect media type: video > image > none
      const mediaType = this.detectMediaType(targetTweetLegacy, targetTweet);

      // Extract profile image URL (prefer higher resolution by removing _normal suffix)
      let profileImageUrl = userLegacy?.profile_image_url_https || '';
      if (profileImageUrl) {
        // Twitter returns _normal size (48x48), replace with _bigger (73x73) or remove for original
        profileImageUrl = profileImageUrl.replace('_normal.', '_bigger.');
      }

      // Build tweet data object
      const tweetData: TimelineTweetData = {
        tweetId: tweetId,  // Use the timeline entry ID (retweet ID if RT)
        username: userCore?.screen_name || userLegacy?.screen_name || '',
        displayName: userCore?.name || userLegacy?.name || '',
        profileImageUrl: profileImageUrl,
        followers: userLegacy?.followers_count || 0,
        following: userLegacy?.friends_count || 0,
        bio: userLegacy?.description || userResult?.profile_bio?.description || '',
        tweetText: targetTweetLegacy.full_text || '',
        replyCount: targetTweetLegacy.reply_count || 0,
        retweetCount: targetTweetLegacy.retweet_count || 0,
        likeCount: targetTweetLegacy.favorite_count || 0,
        viewCount: parseInt(targetTweet?.views?.count || '0', 10),
        createdAt: targetTweetLegacy.created_at || '',
        mediaType: mediaType,
      };

      // Store in cache
      this.tweetCache.set(tweetId, tweetData);

      // For retweets, also store under the original tweet ID
      // This helps match when DOM shows original tweet ID
      if (isRetweet && targetTweet?.rest_id) {
        this.tweetCache.set(targetTweet.rest_id, tweetData);
      }
    } catch (err) {
      // Silently ignore parse errors
    }
  }

  /**
   * Detect media type from tweet data
   * Priority: video > image > none
   */
  private detectMediaType(legacy: any, tweet: any): 'video' | 'image' | 'none' {
    try {
      // Check extended_entities first (more reliable)
      const extendedMedia = legacy?.extended_entities?.media;
      if (extendedMedia && Array.isArray(extendedMedia)) {
        for (const media of extendedMedia) {
          // video, animated_gif are video types
          if (media.type === 'video' || media.type === 'animated_gif') {
            return 'video';
          }
        }
        // If we have media but no video, it's image
        if (extendedMedia.length > 0) {
          return 'image';
        }
      }

      // Fallback to entities.media
      const entityMedia = legacy?.entities?.media;
      if (entityMedia && Array.isArray(entityMedia) && entityMedia.length > 0) {
        for (const media of entityMedia) {
          if (media.type === 'video' || media.type === 'animated_gif') {
            return 'video';
          }
        }
        return 'image';
      }

      // Check for card with video (e.g., YouTube embeds)
      const card = tweet?.card?.legacy;
      if (card?.name?.includes('player') || card?.name?.includes('video')) {
        return 'video';
      }

      return 'none';
    } catch {
      return 'none';
    }
  }

  /**
   * Trim cache to prevent memory leaks
   */
  private trimCache(): void {
    if (this.tweetCache.size > this.MAX_CACHE_SIZE) {
      const entries = Array.from(this.tweetCache.entries());
      const toDelete = entries.slice(0, entries.length - this.MAX_CACHE_SIZE);
      for (const [key] of toDelete) {
        this.tweetCache.delete(key);
      }
    }
  }

  /**
   * Set up IntersectionObserver to detect visible tweets
   */
  private setupIntersectionObserver(): void {
    this.intersectionObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            this.onTweetElementVisible(entry.target as HTMLElement);
          }
        }
      },
      {
        root: null,
        rootMargin: '0px',
        threshold: 0.5, // Trigger when 50% visible
      }
    );
  }

  /**
   * Set up MutationObserver to watch for new tweet elements
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
   * Scan existing tweets on the page
   */
  private scanExistingTweets(): void {
    const tweetElements = document.querySelectorAll('[data-testid="tweet"]');
    tweetElements.forEach((element) => {
      if (this.intersectionObserver) {
        this.intersectionObserver.observe(element);
      }
    });
    console.log(`[BNBot Timeline Monitor] Observing ${tweetElements.length} existing tweets`);
  }

  /**
   * Find and observe tweet elements within a container
   */
  private observeTweetElements(container: HTMLElement): void {
    // Check if the container itself is a tweet
    if (container.getAttribute('data-testid') === 'tweet') {
      if (this.intersectionObserver) {
        this.intersectionObserver.observe(container);
      }
      return;
    }

    // Find tweet elements within the container
    const tweetElements = container.querySelectorAll('[data-testid="tweet"]');
    tweetElements.forEach((element) => {
      if (this.intersectionObserver) {
        this.intersectionObserver.observe(element);
      }
    });
  }

  /**
   * Handle when a tweet element becomes visible
   * Only reports tweets that are in the API cache
   */
  private onTweetElementVisible(element: HTMLElement): void {
    const tweetId = this.extractTweetIdFromElement(element);
    if (!tweetId || this.reportedTweets.has(tweetId)) return;

    // Only use API cache data (has full user info)
    const data = this.tweetCache.get(tweetId);
    if (data) {
      this.logTweetData(data);
      this.injectPredictionBadge(element, data);
      this.reportedTweets.add(tweetId);
    }
    // If not in cache yet, will be picked up when API data arrives and user scrolls
  }

  /**
   * Inject prediction badge into tweet action bar
   * Inserts to the left of bookmark button, styled like other action buttons
   * @returns true if injection was successful, false otherwise
   */
  private injectPredictionBadge(tweetElement: HTMLElement, tweetData: TimelineTweetData): boolean {
    try {
      // Check if badge already exists in this tweet
      if (tweetElement.querySelector('.bnbot-prediction-badge')) return true;

      // Find the bookmark button
      const bookmarkButton = tweetElement.querySelector('[data-testid="bookmark"]');
      if (!bookmarkButton) return false;

      // Get the parent div of bookmark button (the container we insert before)
      const bookmarkContainer = bookmarkButton.parentElement;
      if (!bookmarkContainer || !bookmarkContainer.parentElement) return false;

      // Get prediction
      const prediction = predictExposure(tweetData);

      // Create container div matching Twitter's action button style
      const badge = document.createElement('div');
      badge.className = 'bnbot-prediction-badge css-175oi2r r-18u37iz r-1h0z5md r-13awgt0';
      badge.setAttribute('data-expected', prediction.range.low.toString());

      // Format the expected value with + suffix, rounded down to nice numbers
      // e.g., 2930 -> 2,900+, 56 -> 50+, 5 -> 10+, 150000 -> 15万+
      const formatNumber = (num: number): string => {
        // < 100: 显示 "< 100"
        if (num < 100) {
          return '< 100';
        }

        // 100-999: 显示 "< 1k"
        if (num < 1000) {
          return '< 1k';
        }

        // 1k-10k: 保留一位小数（如 1.2k, 5.5k）
        if (num < 10000) {
          return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
        }

        // 10k-100k: 取整到千（如 15k, 56k）
        if (num < 100000) {
          return Math.round(num / 1000) + 'k';
        }

        // 100k+: 用万（如 15万, 150万）
        return Math.round(num / 10000) + '万';
      };

      // Create inner structure matching Twitter's button style
      const scoreColor = this.getScoreColor(prediction.range.low);
      badge.innerHTML = `
        <div role="button" tabindex="0" class="css-175oi2r r-1777fci r-bt1l66 r-bztko3 r-lrvibr r-1loqt21 r-1ny4l3l" style="cursor: pointer;">
          <div dir="ltr" class="css-146c3p1 r-bcqeeo r-1ttztb7 r-qvutc0 r-37j5jr r-a023e6 r-rjixqe r-16dba41 r-1awozwy r-6koalj r-1h0z5md r-o7ynqc r-clp7b1 r-3s2u2q" style="color: ${scoreColor};">
            <div class="css-175oi2r r-xoduu5">
              <div class="bnbot-hover-circle css-175oi2r r-xoduu5 r-1p0dtai r-1d2f490 r-u8s1d r-zchlnj r-ipm5af r-1niwhzg r-sdzlij r-xf4iuw r-o7ynqc r-6416eg r-1ny4l3l" style="transition: background-color 0.2s;"></div>
              <svg viewBox="-2 -2 28 28" aria-hidden="true" class="r-4qtqp9 r-yyyyoo r-dnmrzs r-bnwqim r-lrvibr r-m6rgpd r-1xvli5t r-1hdv0qi" fill="currentColor">
                <path fill-rule="evenodd" clip-rule="evenodd" d="M14.7529 0.790742C15.5284 0.0152789 16.7837 0.00892685 17.567 0.776495L23.2422 6.33797C24.039 7.11875 24.043 8.40043 23.2511 9.18615L16.3702 16.0136C15.3949 16.9814 13.9421 17.1752 12.7754 16.5967L9.36714 20.0049C8.67655 20.6955 7.67166 20.8802 6.81291 20.5591L5.04343 22.3286C5.24437 22.7066 5.1856 23.1864 4.86714 23.5049C4.47662 23.8954 3.84345 23.8954 3.45293 23.5049L2.95293 23.0049L0.952927 21.0049L0.452927 20.5049C0.0624031 20.1144 0.0624031 19.4812 0.452927 19.0907C0.77139 18.7722 1.25121 18.7134 1.62922 18.9144L3.3987 17.1449C3.07759 16.2861 3.26234 15.2813 3.95294 14.5907L7.36152 11.1822C6.78415 10.0153 6.98129 8.5624 7.95293 7.59076L14.7529 0.790742ZM8.66003 12.7121L5.36714 16.0049C5.20539 16.1667 5.20538 16.4289 5.36714 16.5907L7.36714 18.5907C7.52891 18.7524 7.79118 18.7524 7.95294 18.5907L11.2458 15.2979L8.66003 12.7121ZM4.66003 18.712L3.07425 20.2978L3.66003 20.8836L5.24582 19.2978L4.66003 18.712ZM21.8424 7.76644L16.1672 2.20496L9.36714 9.00498C8.92924 9.44288 8.92924 10.1529 9.36714 10.5908L13.3671 14.5908C13.8071 15.0307 14.5199 15.0321 14.9615 14.5939L21.8424 7.76644Z"/>
              </svg>
            </div>
            <div class="css-175oi2r r-xoduu5 r-1udh08x">
              <span data-testid="app-text-transition-container" style="transition-property: transform; transition-duration: 0.3s; transform: translate3d(0px, 0px, 0px);">
                <span class="css-1jxf684 r-1ttztb7 r-qvutc0 r-poiln3 r-n6v787 r-1cwl3u0 r-1k6nrdp r-n7gxbd">
                  <span class="css-1jxf684 r-bcqeeo r-1ttztb7 r-qvutc0 r-poiln3">${formatNumber(prediction.range.low)}</span>
                </span>
              </span>
            </div>
          </div>
        </div>
      `;

      // Add hover effect
      const hoverCircle = badge.querySelector('.bnbot-hover-circle') as HTMLElement;
      if (hoverCircle) {
        badge.addEventListener('mouseenter', () => {
          hoverCircle.style.backgroundColor = `${scoreColor}1a`; // 10% opacity
        });
        badge.addEventListener('mouseleave', () => {
          hoverCircle.style.backgroundColor = 'transparent';
        });
      }

      // Add tooltip with full prediction info (supports i18n)
      const lang = localStorage.getItem('bnbot-language') || 'en';
      const isZh = lang === 'zh';

      const timingLabels: Record<string, { en: string; zh: string }> = {
        golden: { en: '🌕 Golden', zh: '🌕 黄金时机' },
        good: { en: '🌖 Good', zh: '🌖 值得评论' },
        late: { en: '🌗 Late', zh: '🌗 较晚' },
        dead: { en: '🌘 Fading', zh: '🌘 尾声' }
      };

      const lifecycleLabels: Record<string, { en: string; zh: string }> = {
        launching: { en: '🌕 Launching', zh: '🌕 起飞中' },
        accelerating: { en: '🌖 Accelerating', zh: '🌖 加速中' },
        peaking: { en: '🌗 Peaking', zh: '🌗 峰值期' },
        decaying: { en: '🌘 Decaying', zh: '🌘 衰退中' },
        dead: { en: '🌘 Fading', zh: '🌘 尾声' }
      };

      const timing = timingLabels[prediction.timing] || { en: prediction.timing, zh: prediction.timing };
      const lifecycle = lifecycleLabels[prediction.phase] || { en: prediction.phase, zh: prediction.phase };

      const formatRangeNum = (n: number) => n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : n.toString();

      // Ensure low <= high for display
      const displayLow = Math.min(prediction.range.low, prediction.range.high);
      const displayHigh = Math.max(prediction.range.low, prediction.range.high);
      const rangeText = `${formatRangeNum(displayLow)} - ${formatRangeNum(displayHigh)}`;

      if (isZh) {
        badge.title = `🌟 曝光预测
预计曝光: ${prediction.range.low}+ (${rangeText})
评分: ${prediction.score}
时机: ${timing.zh}
生命周期: ${lifecycle.zh}
渗透率: ${(prediction.penetrationRate * 100).toFixed(2)}%
${prediction.reason.zh}
⚠️ AI 预测仅供参考，实际结果可能有偏差`;
      } else {
        badge.title = `🌟 Exposure Prediction
Expected: ${prediction.range.low}+ (${rangeText})
Score: ${prediction.score}
Timing: ${timing.en}
Lifecycle: ${lifecycle.en}
Penetration: ${(prediction.penetrationRate * 100).toFixed(2)}%
${prediction.reason.en}
⚠️ AI prediction for reference only, actual results may vary`;
      }

      // Insert badge before bookmark container
      bookmarkContainer.parentElement.insertBefore(badge, bookmarkContainer);
      return true;
    } catch (err) {
      // Silently ignore injection errors
      console.debug('[BNBot Timeline] Badge injection failed:', err);
      return false;
    }
  }

  /**
   * Get color based on expected exposure vs threshold
   * Only green if expected >= threshold, otherwise gray
   */
  private getScoreColor(expected: number): string {
    const threshold = parseInt(localStorage.getItem('bnbot_exposure_threshold') || '1000', 10);
    if (expected >= threshold) return '#00ba7c'; // Green - recommended
    return '#536471'; // Twitter default icon gray
  }

  /**
   * Set up listener for threshold changes to update badge colors immediately
   */
  private setupThresholdChangeListener(): void {
    this.thresholdChangeHandler = (event: Event) => {
      const customEvent = event as CustomEvent<number>;
      const newThreshold = customEvent.detail;
      console.log('[BNBot Timeline Monitor] Threshold changed to:', newThreshold);

      // Find all existing badges and update their colors
      const badges = document.querySelectorAll('.bnbot-prediction-badge');
      badges.forEach((badge) => {
        const expectedStr = badge.getAttribute('data-expected');
        if (!expectedStr) return;

        const expected = parseInt(expectedStr, 10);
        const newColor = expected >= newThreshold ? '#00ba7c' : '#536471';

        // Update the color in the badge's inner div
        const colorDiv = badge.querySelector('[dir="ltr"]') as HTMLElement;
        if (colorDiv) {
          colorDiv.style.color = newColor;
        }
      });

      console.log(`[BNBot Timeline Monitor] Updated ${badges.length} badge colors`);
    };

    window.addEventListener('bnbot:exposure-threshold-changed', this.thresholdChangeHandler);
  }

  /**
   * Extract tweet ID from a tweet DOM element
   */
  private extractTweetIdFromElement(element: HTMLElement): string | null {
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
   * Log tweet data to console with exposure prediction
   */
  private logTweetData(data: TimelineTweetData): void {
    // Tweet data log
    console.log('[BNBot Timeline] Visible Tweet:', {
      tweetId: data.tweetId,
      username: data.username,
      displayName: data.displayName,
      followers: data.followers,
      following: data.following,
      bio: data.bio,
      tweetText: data.tweetText,
      replyCount: data.replyCount,
      retweetCount: data.retweetCount,
      likeCount: data.likeCount,
      viewCount: data.viewCount,
      createdAt: data.createdAt,
      mediaType: data.mediaType,
    });

    // Exposure prediction v1.1
    try {
      const prediction = predictExposure(data);
      const phaseEmoji = {
        launching: '🚀',
        accelerating: '📈',
        peaking: '🔝',
        decaying: '📉',
        dead: '💀'
      }[prediction.phase];

      console.log('[BNBot Timeline] 📊 Exposure Prediction:', {
        range: `${prediction.range.low} - ${prediction.range.high}`,
        expected: prediction.expected,
        lifecycle: `${phaseEmoji} ${prediction.phase}`,
        timing: prediction.timing,
        score: prediction.score,
        penetrationRate: `${(prediction.penetrationRate * 100).toFixed(2)}%`,
        accountHealth: prediction.accountHealth,
        blueGateApplied: prediction.blueGateApplied,
        recommendation: prediction.reason.en
      });
    } catch (err) {
      console.warn('[BNBot Timeline] Exposure prediction failed:', err);
    }
  }
}
