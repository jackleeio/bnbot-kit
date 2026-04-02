/**
 * FollowDigestExecutor
 *
 * 执行关注摘要任务：
 * 1. 导航到 Following tab
 * 2. 滚动触发 API 请求
 * 3. 从 apiDataCache 收集推文
 * 4. 发送给后端生成摘要
 */

import { apiDataCache } from './ApiDataCache';
import { TimelineTweetData } from './HomeTimelineMonitor';
import { authService } from '../services/authService';

const API_BASE_URL = process.env.API_BASE_URL || 'https://api.bnbot.ai';

export interface FollowDigestConfig {
  /** 最大收集推文数量 */
  maxTweets: number;
  /** 滚动间隔（毫秒），模拟人类浏览速度 */
  scrollInterval: number;
  /** 用户兴趣标签（可选，用于 AI 过滤） */
  interests?: string[];
  /** 搜索关键词（可选） */
  keywords?: string[];
  /** 自定义提示词（可选，指导 AI 生成摘要的方向） */
  customPrompt?: string;
  /** 通知类型（控制是否发送 Telegram） */
  notificationType?: string;
}

/** 用户可配置的 Follow Digest 设置（持久化到 storage） */
export interface FollowDigestSettings {
  maxTweets: number;
  customPrompt: string;
  interests: string;
  keywords: string;
}

export const DEFAULT_FOLLOW_DIGEST_SETTINGS: FollowDigestSettings = {
  maxTweets: 100,
  customPrompt: '',
  interests: '',
  keywords: '',
};

export interface FollowDigestResult {
  success: boolean;
  tweetsCollected: number;
  timelineRequests: number;
  oldestTweetTime?: string;
  duration: number;
  error?: string;
}

const DEFAULT_CONFIG: FollowDigestConfig = {
  maxTweets: 100,
  scrollInterval: 2000,
};

class FollowDigestExecutor {
  private isRunning = false;
  private config: FollowDigestConfig = DEFAULT_CONFIG;

  /**
   * 执行关注摘要任务
   */
  async execute(config?: Partial<FollowDigestConfig>): Promise<FollowDigestResult> {
    if (this.isRunning) {
      return { success: false, tweetsCollected: 0, timelineRequests: 0, duration: 0, error: 'Already running' };
    }

    this.isRunning = true;
    this.config = { ...DEFAULT_CONFIG, ...config };
    const startTime = Date.now();

    console.log('[FollowDigestExecutor] Starting with config:', this.config);

    try {
      // 1. 停止之前的监听（如果有），然后重新开始
      apiDataCache.stop();
      apiDataCache.clear();
      apiDataCache.start();

      // 2. 导航到 Following tab
      await this.switchToFollowingTab();

      // 3. 等待初始 API 数据到达，如果没有则主动触发刷新
      await this.ensureTimelineData();

      // 4. 滚动收集推文
      const tweets = await this.scrollAndCollect();

      // 5. 停止监听
      const totalRequests = apiDataCache.getTimelineRequestCount();
      apiDataCache.stop();

      console.log(`[FollowDigestExecutor] Collected ${tweets.length} tweets from ${totalRequests} timeline requests`);

      // 6. 发送给后端生成报告
      if (tweets.length > 0) {
        await this.sendToBackend(tweets);
      } else {
        console.warn('[FollowDigestExecutor] No tweets collected, skipping backend call');
      }

      const duration = Date.now() - startTime;
      return {
        success: true,
        tweetsCollected: tweets.length,
        timelineRequests: totalRequests,
        duration,
      };
    } catch (error) {
      console.error('[FollowDigestExecutor] Error:', error);
      apiDataCache.stop();
      return {
        success: false,
        tweetsCollected: 0,
        timelineRequests: apiDataCache.getTimelineRequestCount(),
        duration: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * 切换到 Following tab
   */
  private async switchToFollowingTab(): Promise<void> {
    console.log('[FollowDigestExecutor] Switching to Following tab...');

    // 先切到 For you tab（如果已在 Following tab，直接点 Following 不会触发新 API 请求）
    // 通过先切走再切回来，强制 Twitter 重新加载 Following timeline
    const tabs = document.querySelectorAll('[role="tab"]');
    let forYouTab: Element | null = null;
    let followingTab: Element | null = null;

    for (const tab of tabs) {
      const text = tab.textContent || '';
      if (text.includes('For you') || text.includes('推荐')) {
        forYouTab = tab;
      }
      if (text.includes('Following') || text.includes('正在关注')) {
        followingTab = tab;
      }
    }

    // 确保在 home 页面
    if (!window.location.pathname.startsWith('/home')) {
      const homeLink = document.querySelector('a[data-testid="AppTabBar_Home_Link"]') as HTMLElement;
      if (homeLink) {
        homeLink.click();
      } else {
        const tempLink = document.createElement('a');
        tempLink.href = '/home';
        tempLink.style.display = 'none';
        const reactRoot = document.getElementById('react-root') || document.body;
        reactRoot.appendChild(tempLink);
        tempLink.click();
        reactRoot.removeChild(tempLink);
      }
      await this.delay(2000);

      // 重新查找 tabs（导航后 DOM 可能更新）
      const newTabs = document.querySelectorAll('[role="tab"]');
      for (const tab of newTabs) {
        const text = tab.textContent || '';
        if (text.includes('For you') || text.includes('推荐')) {
          forYouTab = tab;
        }
        if (text.includes('Following') || text.includes('正在关注')) {
          followingTab = tab;
        }
      }
    }

    // 先点 For you，再点 Following，确保触发新的 API 请求
    if (forYouTab && followingTab) {
      (forYouTab as HTMLElement).click();
      console.log('[FollowDigestExecutor] Clicked For you tab first');
      await this.delay(1000);

      (followingTab as HTMLElement).click();
      console.log('[FollowDigestExecutor] Clicked Following tab');
      await this.delay(2000);
    } else if (followingTab) {
      (followingTab as HTMLElement).click();
      console.log('[FollowDigestExecutor] Clicked Following tab');
      await this.delay(2000);
    } else {
      console.warn('[FollowDigestExecutor] Following tab not found, using current view');
    }
  }

  /**
   * 确保有 timeline 数据到达，如果没有则主动触发刷新
   */
  private async ensureTimelineData(): Promise<void> {
    // 检查是否已经捕获到 timeline 请求
    if (apiDataCache.getTimelineRequestCount() > 0) {
      console.log('[FollowDigestExecutor] Timeline data already captured');
      return;
    }

    console.log('[FollowDigestExecutor] No timeline data yet, triggering manual refresh...');

    // 通过 postMessage 通知 timeline-interceptor 主动 fetch
    window.postMessage({ type: 'BNBOT_REFRESH_TIMELINE' }, '*');
    await this.delay(3000);

    if (apiDataCache.getTimelineRequestCount() > 0) {
      console.log('[FollowDigestExecutor] Manual refresh captured data');
      return;
    }

    // 最后尝试：滚动到顶部后再向下滚，触发 lazy load
    console.log('[FollowDigestExecutor] Manual refresh failed, trying scroll trigger...');
    window.scrollTo({ top: 0 });
    await this.delay(500);
    window.scrollBy({ top: 2000, behavior: 'smooth' });
    await this.delay(2000);
  }

  /**
   * 滚动并收集推文
   */
  private async scrollAndCollect(): Promise<TimelineTweetData[]> {
    console.log('[FollowDigestExecutor] Starting scroll and collect...');
    console.log(`[FollowDigestExecutor] Target: ${this.config.maxTweets} tweets`);

    let lastTweetCount = apiDataCache.size();
    let noNewTweetCount = 0;
    console.log(`[FollowDigestExecutor] Starting with ${lastTweetCount} existing tweets`);

    while (true) {
      const currentTweetCount = apiDataCache.size();

      // 检查是否达到推文数量上限
      if (currentTweetCount >= this.config.maxTweets) {
        console.log(`[FollowDigestExecutor] Reached target: ${currentTweetCount} tweets collected`);
        break;
      }

      // 滚动到页面底部触发 Twitter 无限加载，每次加随机偏移避免机械式行为
      const randomOffset = Math.floor(Math.random() * 500);
      window.scrollTo({
        top: document.body.scrollHeight - randomOffset,
        behavior: 'smooth',
      });

      // 等待 Twitter 加载新内容（API 请求 + DOM 渲染）
      await this.delay(this.config.scrollInterval + Math.floor(Math.random() * 1000));

      // 检查是否有新推文
      const newTweetCount = apiDataCache.size();
      if (newTweetCount === lastTweetCount) {
        noNewTweetCount++;
        if (noNewTweetCount >= 5) {
          console.log(`[FollowDigestExecutor] No new tweets after ${noNewTweetCount} scrolls, stopping`);
          break;
        }
      } else {
        noNewTweetCount = 0;
        lastTweetCount = newTweetCount;
        console.log(`[FollowDigestExecutor] Tweets: ${newTweetCount}/${this.config.maxTweets}, requests: ${apiDataCache.getTimelineRequestCount()}`);
      }
    }

    // 获取所有缓存的推文，过滤掉空内容和广告，截取到 maxTweets
    const allTweets = apiDataCache.getAllTweets();
    const filteredTweets = this.filterTweets(allTweets).slice(0, this.config.maxTweets);

    console.log(`[FollowDigestExecutor] Collected ${allTweets.length} tweets, after filter: ${filteredTweets.length}`);

    return filteredTweets;
  }

  /**
   * 过滤推文
   */
  private filterTweets(tweets: TimelineTweetData[]): TimelineTweetData[] {
    return tweets.filter(tweet => {
      // 过滤掉空内容
      if (!tweet.tweetText || tweet.tweetText.trim().length === 0) {
        return false;
      }

      // 过滤广告（通常包含 "Promoted" 或 "推广"）
      const text = tweet.tweetText.toLowerCase();
      if (text.includes('promoted') || text.includes('推广')) {
        return false;
      }

      return true;
    });
  }

  /**
   * 发送给后端生成报告
   */
  private async sendToBackend(tweets: TimelineTweetData[]): Promise<void> {
    console.log(`[FollowDigestExecutor] Sending ${tweets.length} tweets to backend...`);

    try {
      const response = await authService.fetchWithAuth(
        `${API_BASE_URL}/api/v1/follow-digest/generate`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            tweets: tweets.map(t => ({
              tweet_id: t.tweetId,
              username: t.username,
              display_name: t.displayName,
              text: t.tweetText,
              followers: t.followers,
              likes: t.likeCount,
              retweets: t.retweetCount,
              replies: t.replyCount,
              views: t.viewCount,
              created_at: t.createdAt,
              media_type: t.mediaType,
            })),
            interests: this.config.interests || [],
            keywords: this.config.keywords || [],
            custom_prompt: this.config.customPrompt || '',
            notification_type: this.config.notificationType || 'telegram_only',
            collected_at: new Date().toISOString(),
          }),
        }
      );

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Backend error: ${response.status} - ${error}`);
      }

      const result = await response.json();
      console.log('[FollowDigestExecutor] Backend response:', result);
    } catch (error) {
      console.error('[FollowDigestExecutor] Failed to send to backend:', error);
      throw error;
    }
  }

  /**
   * 延迟
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 检查是否正在运行
   */
  isExecuting(): boolean {
    return this.isRunning;
  }

  /**
   * 停止执行
   */
  stop(): void {
    this.isRunning = false;
    apiDataCache.stop();
    console.log('[FollowDigestExecutor] Stopped');
  }
}

export const followDigestExecutor = new FollowDigestExecutor();
