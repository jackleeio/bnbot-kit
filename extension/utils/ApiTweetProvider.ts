/**
 * ApiTweetProvider
 *
 * Reads tweets from ApiDataCache (populated by timeline-interceptor.js)
 * and converts them to ScrapedTweet format for the auto-reply pipeline.
 *
 * Replaces DOM-based scrolling/scraping with API-intercepted data.
 */

import { ScrapedTweet } from '../types/autoReply';
import { apiDataCache } from './ApiDataCache';
import { TimelineTweetData } from './HomeTimelineMonitor';
import { HumanBehaviorSimulator } from './HumanBehaviorSimulator';

export class ApiTweetProvider {
  private processedTweetIds: Set<string> = new Set();
  private currentUserHandle: string | null = null;
  private scrollCount: number = 0;
  private readonly MAX_SCROLL_BEFORE_REFRESH = 15;

  constructor() {
    this.resolveCurrentUser();
  }

  /**
   * Get next batch of unprocessed tweets from API cache
   */
  getNextBatch(batchSize: number): ScrapedTweet[] {
    const allCached = apiDataCache.getAllTweets();
    const batch: ScrapedTweet[] = [];

    for (const data of allCached) {
      if (batch.length >= batchSize) break;

      // Skip already processed
      if (this.processedTweetIds.has(data.tweetId)) continue;

      // Skip empty tweets
      if (!data.tweetText || data.tweetText.trim().length === 0) continue;

      // Skip own tweets
      if (this.currentUserHandle && data.username.toLowerCase() === this.currentUserHandle) continue;

      const tweet = this.convertToScrapedTweet(data);
      if (tweet) {
        batch.push(tweet);
      }
    }

    return batch;
  }

  /**
   * Mark a tweet as processed
   */
  markAsProcessed(tweetId: string): void {
    this.processedTweetIds.add(tweetId);
  }

  /**
   * Check if a tweet has been processed
   */
  hasProcessed(tweetId: string): boolean {
    return this.processedTweetIds.has(tweetId);
  }

  /**
   * Scroll page to trigger new API requests, then wait for cache to grow
   * Returns true if new tweets were loaded
   */
  async scrollForMore(): Promise<boolean> {
    // Check if we've scrolled too much - refresh instead
    if (this.scrollCount >= this.MAX_SCROLL_BEFORE_REFRESH) {
      console.log('[ApiTweetProvider] Scrolled', this.scrollCount, 'times, refreshing timeline...');
      await this.scrollToTopAndRefresh();
      this.scrollCount = 0;
      return apiDataCache.size() > 0;
    }

    const sizeBefore = apiDataCache.size();
    let retries = 0;
    const maxRetries = 3;

    while (retries < maxRetries) {
      // Scroll one viewport
      await HumanBehaviorSimulator.scrollByViewport();
      this.scrollCount++;

      // Wait for API response to arrive (1.5-3s)
      const waitMs = 1500 + Math.random() * 1500;
      await new Promise(resolve => setTimeout(resolve, waitMs));

      const sizeAfter = apiDataCache.size();
      if (sizeAfter > sizeBefore) {
        console.log('[ApiTweetProvider] Cache grew from', sizeBefore, 'to', sizeAfter, 'after scroll');
        return true;
      }

      retries++;
      console.log('[ApiTweetProvider] Scroll attempt', retries, '- no new data yet');
    }

    console.log('[ApiTweetProvider] No new data after', maxRetries, 'scroll attempts');

    // Last resort: trigger manual timeline fetch via interceptor
    if (apiDataCache.size() === 0) {
      console.log('[ApiTweetProvider] Cache still empty, trying manual fetch...');
      window.postMessage({ type: 'BNBOT_REFRESH_TIMELINE' }, '*');
      await new Promise(resolve => setTimeout(resolve, 5000));
      if (apiDataCache.size() > sizeBefore) {
        console.log('[ApiTweetProvider] Manual fetch succeeded, cache has', apiDataCache.size(), 'tweets');
        return true;
      }
    }

    return false;
  }

  /**
   * Scroll to top and click "Show N posts" or Home button to refresh
   */
  private async scrollToTopAndRefresh(): Promise<void> {
    console.log('[ApiTweetProvider] Scrolling to top and refreshing...');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    await HumanBehaviorSimulator.randomDelay(500, 800);

    // Look for "Show X posts" button
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
      console.log('[ApiTweetProvider] Found "Show posts" button, clicking...');
      loadMoreButton.click();
      await HumanBehaviorSimulator.randomDelay(1500, 2500);
    } else {
      console.log('[ApiTweetProvider] No "Show posts" button, clicking Home to refresh');
      const homeLink = document.querySelector('a[data-testid="AppTabBar_Home_Link"]') as HTMLElement;
      if (homeLink) {
        homeLink.click();
        await HumanBehaviorSimulator.randomDelay(1500, 2500);
      }
    }
  }

  private findShowPostsButton(): HTMLElement | null {
    const buttons = document.querySelectorAll('button[type="button"]');
    for (const btn of buttons) {
      const text = btn.textContent || '';
      if (/显示\s*\d+\s*帖子|Show\s*\d+\s*(posts|Tweets)/i.test(text)) {
        return btn as HTMLElement;
      }
    }
    return null;
  }

  /**
   * Check if currently on the home timeline
   */
  isOnHomeTimeline(): boolean {
    const path = window.location.pathname;
    return path === '/' || path === '/home' || path.startsWith('/home');
  }

  /**
   * Navigate back to home timeline
   */
  async navigateToHome(): Promise<boolean> {
    if (this.isOnHomeTimeline()) return true;

    console.log('[ApiTweetProvider] Navigating to home from:', window.location.pathname);

    const homeLink = document.querySelector('a[data-testid="AppTabBar_Home_Link"]') as HTMLElement;
    if (homeLink) {
      homeLink.click();
    } else {
      // SPA-friendly temp link inside React root
      const tempLink = document.createElement('a');
      tempLink.href = '/home';
      tempLink.style.display = 'none';
      const reactRoot = document.getElementById('react-root') || document.body;
      reactRoot.appendChild(tempLink);
      tempLink.click();
      reactRoot.removeChild(tempLink);
    }

    // Wait and verify
    const maxWait = 5000;
    const interval = 300;
    let waited = 0;
    while (waited < maxWait) {
      await new Promise(resolve => setTimeout(resolve, interval));
      waited += interval;
      if (this.isOnHomeTimeline()) {
        console.log('[ApiTweetProvider] Successfully navigated to home');
        await HumanBehaviorSimulator.randomDelay(500, 1000);
        return true;
      }
    }

    console.warn('[ApiTweetProvider] Failed to navigate to home');
    return false;
  }

  /**
   * Convert TimelineTweetData to ScrapedTweet format
   */
  private convertToScrapedTweet(data: TimelineTweetData): ScrapedTweet | null {
    try {
      // Detect media from mediaType field
      const media: { type: 'photo' | 'video'; url: string }[] = [];
      if (data.mediaType === 'image') {
        media.push({ type: 'photo', url: '' });
      } else if (data.mediaType === 'video') {
        media.push({ type: 'video', url: '' });
      }

      // Check if it's a retweet (text starts with "RT @")
      const isRetweet = data.tweetText.startsWith('RT @');

      return {
        id: data.tweetId,
        authorHandle: data.username,
        authorName: data.displayName,
        authorAvatar: data.profileImageUrl || '',
        authorBio: data.bio || undefined,
        authorFollowers: data.followers || undefined,
        content: data.tweetText,
        timestamp: data.createdAt,
        metrics: {
          replies: data.replyCount,
          retweets: data.retweetCount,
          likes: data.likeCount,
          views: data.viewCount,
        },
        media,
        isRetweet,
        isQuote: false,
        articleElement: undefined, // API-sourced, no DOM element
        tweetUrl: `https://x.com/${data.username}/status/${data.tweetId}`,
        source: 'timeline',
        expectedExposure: undefined,
      };
    } catch (e) {
      console.error('[ApiTweetProvider] Failed to convert tweet:', data.tweetId, e);
      return null;
    }
  }

  /**
   * Resolve current user handle from Twitter's sidebar
   */
  private resolveCurrentUser(): void {
    const btn = document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]');
    if (btn) {
      const text = btn.textContent || '';
      const match = text.match(/@(\w+)/);
      if (match) {
        this.currentUserHandle = match[1].toLowerCase();
        console.log('[ApiTweetProvider] Current user:', this.currentUserHandle);
      }
    }
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
        console.log('[ApiTweetProvider] Loaded', this.processedTweetIds.size, 'processed tweets from storage');
      }
    } catch (e) {
      console.error('[ApiTweetProvider] Failed to load processed tweets', e);
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
      console.log('[ApiTweetProvider] Saved', recentIds.length, 'processed tweets to storage');
    } catch (e) {
      console.error('[ApiTweetProvider] Failed to save processed tweets', e);
    }
  }

  /**
   * Get processed tweet IDs set (for external callers)
   */
  getProcessedTweetIds(): Set<string> {
    return this.processedTweetIds;
  }

  /**
   * Reset scroll counter (e.g., after a fresh Home click)
   */
  resetScrollCount(): void {
    this.scrollCount = 0;
  }
}
