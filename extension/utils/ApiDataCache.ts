/**
 * ApiDataCache
 *
 * Unified cache for Twitter API data intercepted from various endpoints.
 * Provides a centralized way to access tweet data without DOM scraping.
 */

declare const chrome: any;

export interface TimelineTweetData {
  tweetId: string;
  username: string;
  displayName: string;
  profileImageUrl: string;
  followers: number;
  following: number;
  bio: string;
  tweetText: string;
  replyCount: number;
  retweetCount: number;
  likeCount: number;
  viewCount: number;
  createdAt: string;
  mediaType: 'video' | 'image' | 'none';
  mediaUrls?: Array<{ type: 'photo' | 'video' | 'animated_gif'; url: string; thumbnail?: string }>;
}

export type ApiEndpointType = 'timeline' | 'notifications' | 'tweet_detail' | 'user_tweets';

export interface ApiDataMessage {
  type: 'BNBOT_API_DATA';
  endpoint: ApiEndpointType;
  pattern: string;
  payload: any;
}

class ApiDataCache {
  private tweetCache: Map<string, TimelineTweetData> = new Map();
  private messageHandler: ((event: MessageEvent) => void) | null = null;
  private isRunning: boolean = false;
  private timelineRequestCount: number = 0;

  // Maximum cache size to prevent memory leaks
  private readonly MAX_CACHE_SIZE = 1000;

  constructor() {
    console.log('[ApiDataCache] Instance created');
  }

  /**
   * Start listening for API data messages
   */
  start(): void {
    if (this.isRunning) {
      console.log('[ApiDataCache] Already running');
      return;
    }

    console.log('[ApiDataCache] Starting...');
    this.isRunning = true;

    this.messageHandler = (event: MessageEvent) => {
      // Only accept messages from the same window
      if (event.source !== window) {
        return;
      }

      if (event.data?.type === 'BNBOT_API_DATA') {
        this.handleApiData(event.data as ApiDataMessage);
      }
    };

    window.addEventListener('message', this.messageHandler);
    console.log('[ApiDataCache] Started, listening for API data');
  }

  /**
   * Stop listening for API data messages
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    console.log('[ApiDataCache] Stopping...');
    this.isRunning = false;

    if (this.messageHandler) {
      window.removeEventListener('message', this.messageHandler);
      this.messageHandler = null;
    }

    console.log('[ApiDataCache] Stopped');
  }

  /**
   * Get tweet data by ID
   */
  getTweet(tweetId: string): TimelineTweetData | undefined {
    return this.tweetCache.get(tweetId);
  }

  /**
   * Get all cached tweets
   */
  getAllTweets(): TimelineTweetData[] {
    return Array.from(this.tweetCache.values());
  }

  /**
   * Get current cache size
   */
  size(): number {
    return this.tweetCache.size;
  }

  /**
   * Check if cache has a specific tweet
   */
  hasTweet(tweetId: string): boolean {
    return this.tweetCache.has(tweetId);
  }

  /**
   * Clear the cache
   */
  clear(): void {
    this.tweetCache.clear();
    this.timelineRequestCount = 0;
    console.log('[ApiDataCache] Cache cleared');
  }

  /**
   * Get timeline request count
   */
  getTimelineRequestCount(): number {
    return this.timelineRequestCount;
  }

  /**
   * Handle incoming API data
   */
  private handleApiData(message: ApiDataMessage): void {
    const { endpoint, payload } = message;

    try {
      switch (endpoint) {
        case 'timeline':
          this.parseTimelineData(payload);
          break;
        case 'notifications':
          this.parseNotificationsData(payload);
          break;
        case 'tweet_detail':
          this.parseTweetDetailData(payload);
          break;
        case 'user_tweets':
          this.parseUserTweetsData(payload);
          break;
        default:
          console.log(`[ApiDataCache] Unknown endpoint: ${endpoint}`);
      }

      // Trim cache if too large
      this.trimCache();

      console.log(`[ApiDataCache] Cache updated from ${endpoint}, total tweets: ${this.tweetCache.size}`);
    } catch (err) {
      console.error('[ApiDataCache] Error parsing API data:', err);
    }
  }

  /**
   * Parse timeline data (HomeTimeline / HomeLatestTimeline)
   */
  private parseTimelineData(data: any): void {
    this.timelineRequestCount++;
    console.log(`[ApiDataCache] Timeline request #${this.timelineRequestCount}`);

    const instructions = data?.data?.home?.home_timeline_urt?.instructions || [];

    for (const instruction of instructions) {
      const entries = instruction?.entries || [];
      for (const entry of entries) {
        this.parseEntry(entry);
      }
    }
  }

  /**
   * Parse notifications data
   */
  private parseNotificationsData(data: any): void {
    // Notifications API structure
    const instructions = data?.data?.notifications?.notifications_timeline_urt?.instructions || [];

    for (const instruction of instructions) {
      const entries = instruction?.entries || [];
      for (const entry of entries) {
        // Notifications can have different content types
        const content = entry?.content;
        if (content?.itemContent?.tweet_results?.result) {
          this.parseTweetResult(content.itemContent.tweet_results.result);
        }
        // Handle notification groups (e.g., "X liked your post")
        if (content?.items) {
          for (const item of content.items) {
            if (item?.item?.itemContent?.tweet_results?.result) {
              this.parseTweetResult(item.item.itemContent.tweet_results.result);
            }
          }
        }
      }
    }
  }

  /**
   * Parse tweet detail data
   */
  private parseTweetDetailData(data: any): void {
    const instructions = data?.data?.tweetResult?.result?.timeline_response?.timeline?.instructions || [];

    for (const instruction of instructions) {
      const entries = instruction?.entries || [];
      for (const entry of entries) {
        this.parseEntry(entry);
      }
    }

    // Also parse the main tweet
    const mainTweet = data?.data?.tweetResult?.result;
    if (mainTweet) {
      this.parseTweetResult(mainTweet);
    }
  }

  /**
   * Parse user tweets data
   */
  private parseUserTweetsData(data: any): void {
    const instructions = data?.data?.user?.result?.timeline_v2?.timeline?.instructions || [];

    for (const instruction of instructions) {
      const entries = instruction?.entries || [];
      for (const entry of entries) {
        this.parseEntry(entry);
      }
    }
  }

  /**
   * Parse a single entry from timeline/notifications
   */
  private parseEntry(entry: any): void {
    try {
      // Handle conversation threads (e.g., tweet + reply shown together)
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
   */
  private parseTweetResult(tweetResult: any): void {
    try {
      // Handle tweets that might be wrapped in a "tweet" property
      const tweet = tweetResult?.tweet || tweetResult;

      // Get tweet ID
      const tweetId = tweet?.rest_id;
      if (!tweetId) return;

      // Check if this is a retweet
      const retweetedResult = tweet?.legacy?.retweeted_status_result?.result;
      const isRetweet = !!retweetedResult;

      // For retweets, use the original tweet's data
      const targetTweet = isRetweet ? (retweetedResult?.tweet || retweetedResult) : tweet;
      const targetTweetLegacy = targetTweet?.legacy;

      if (!targetTweetLegacy) return;

      // Get user data - try multiple paths as Twitter API structure varies
      const userResult = targetTweet?.core?.user_results?.result;
      const userCore = userResult?.core;
      const userLegacy = userResult?.legacy;

      // Detect media type and extract media URLs
      const mediaType = this.detectMediaType(targetTweetLegacy, targetTweet);
      const mediaUrls = this.extractMediaUrls(targetTweetLegacy);

      // Extract profile image URL - NEW Twitter API uses avatar.image_url
      let profileImageUrl =
        // New API structure (2024+)
        userResult?.avatar?.image_url ||
        // Old API structure (legacy)
        userLegacy?.profile_image_url_https ||
        userResult?.legacy?.profile_image_url_https ||
        userResult?.profile_image_url_https ||
        userCore?.profile_image_url_https ||
        '';

      if (profileImageUrl) {
        // Twitter returns _normal size (48x48), replace with _bigger (73x73)
        profileImageUrl = profileImageUrl.replace('_normal.', '_bigger.');
      }

      // Build tweet data object
      const tweetData: TimelineTweetData = {
        tweetId: tweetId,
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
        mediaUrls: mediaUrls.length > 0 ? mediaUrls : undefined,
      };

      // Store in cache
      this.tweetCache.set(tweetId, tweetData);

      // For retweets, also store under the original tweet ID
      if (isRetweet && targetTweet?.rest_id) {
        this.tweetCache.set(targetTweet.rest_id, tweetData);
      }
    } catch (err) {
      // Silently ignore parse errors
    }
  }

  /**
   * Detect media type from tweet data
   */
  private detectMediaType(legacy: any, tweet: any): 'video' | 'image' | 'none' {
    try {
      // Check extended_entities first
      const extendedMedia = legacy?.extended_entities?.media;
      if (extendedMedia && Array.isArray(extendedMedia)) {
        for (const media of extendedMedia) {
          if (media.type === 'video' || media.type === 'animated_gif') {
            return 'video';
          }
        }
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

      // Check for card with video
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
   * Extract media URLs from tweet legacy data
   */
  private extractMediaUrls(legacy: any): Array<{ type: 'photo' | 'video' | 'animated_gif'; url: string; thumbnail?: string }> {
    const results: Array<{ type: 'photo' | 'video' | 'animated_gif'; url: string; thumbnail?: string }> = [];
    const mediaList = legacy?.extended_entities?.media || legacy?.entities?.media || [];

    for (const item of mediaList) {
      if (item.type === 'video' || item.type === 'animated_gif') {
        // Find best quality MP4 variant
        const variants = item.video_info?.variants || [];
        let bestUrl = '';
        let bestBitrate = -1;
        for (const v of variants) {
          if (v.content_type === 'video/mp4' && (v.bitrate || 0) > bestBitrate) {
            bestBitrate = v.bitrate || 0;
            bestUrl = v.url;
          }
        }
        if (bestUrl) {
          results.push({ type: item.type, url: bestUrl, thumbnail: item.media_url_https });
        }
      } else if (item.type === 'photo') {
        results.push({ type: 'photo', url: item.media_url_https });
      }
    }

    return results;
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
      console.log(`[ApiDataCache] Trimmed cache, removed ${toDelete.length} entries`);
    }
  }
}

// Export singleton instance
export const apiDataCache = new ApiDataCache();
