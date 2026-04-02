/**
 * Bookmark Scraper
 * 从 Twitter 书签页面爬取书签推文数据
 * 复用 TimelineScroller 的 DOM 选择器和提取模式
 */

import { ScrapedBookmark } from '../types/action';
import { HumanBehaviorSimulator } from './HumanBehaviorSimulator';

// Twitter DOM 选择器（与 TimelineScroller 保持一致）
const SELECTORS = {
  tweet: 'article[data-testid="tweet"]',
  userName: '[data-testid="User-Name"]',
  tweetText: '[data-testid="tweetText"]',
  avatar: '[data-testid="Tweet-User-Avatar"]',
  time: 'time[datetime]',
  tweetPhoto: '[data-testid="tweetPhoto"]',
  videoPlayer: '[data-testid="videoPlayer"]',
  replyCount: '[data-testid="reply"]',
  retweetCount: '[data-testid="retweet"]',
  likeCount: '[data-testid="like"]',
  viewCount: 'a[href*="/analytics"]'
};

export interface BookmarkScraperOptions {
  limit?: number;
  scrollAttempts?: number;
  onProgress?: (scraped: number, total: number) => void;
  onBookmarkFound?: (bookmark: ScrapedBookmark) => void;
  signal?: AbortSignal;
}

export class BookmarkScraper {
  private processedIds: Set<string> = new Set();

  /**
   * 检查是否在书签页面
   */
  isOnBookmarksPage(): boolean {
    return window.location.pathname.includes('/i/bookmarks');
  }

  /**
   * 爬取书签
   */
  async scrape(options: BookmarkScraperOptions = {}): Promise<ScrapedBookmark[]> {
    const {
      limit = 20,
      scrollAttempts = 5,
      onProgress,
      onBookmarkFound,
      signal
    } = options;

    if (!this.isOnBookmarksPage()) {
      throw new Error('Not on bookmarks page. Navigate to /i/bookmarks first.');
    }

    const bookmarks: ScrapedBookmark[] = [];
    let attempts = 0;

    // 初始等待页面内容加载
    await HumanBehaviorSimulator.randomDelay(500, 1000);

    while (bookmarks.length < limit && attempts < scrollAttempts) {
      // 检查是否被中止
      if (signal?.aborted) {
        console.log('[BookmarkScraper] Aborted');
        break;
      }

      // 扫描当前视图
      const articles = document.querySelectorAll(SELECTORS.tweet);

      for (const article of articles) {
        if (bookmarks.length >= limit) break;
        if (signal?.aborted) break;

        const bookmark = this.scrapeArticle(article as HTMLElement);
        if (bookmark && !this.processedIds.has(bookmark.tweetId)) {
          this.processedIds.add(bookmark.tweetId);
          bookmarks.push(bookmark);

          onBookmarkFound?.(bookmark);
          onProgress?.(bookmarks.length, limit);
        }
      }

      // 需要更多书签？滚动加载
      if (bookmarks.length < limit) {
        await HumanBehaviorSimulator.scrollByViewport();
        await HumanBehaviorSimulator.randomDelay(1000, 2000);
        attempts++;
      }
    }

    console.log(`[BookmarkScraper] Scraped ${bookmarks.length} bookmarks`);
    return bookmarks;
  }

  /**
   * 从单个 article 元素提取书签数据
   */
  private scrapeArticle(article: HTMLElement): ScrapedBookmark | null {
    try {
      // 获取推文 ID
      const link = article.querySelector('a[href*="/status/"]');
      const href = link?.getAttribute('href');
      const idMatch = href?.match(/\/status\/(\d+)/);
      if (!idMatch) return null;

      const tweetId = idMatch[1];

      // 获取作者信息
      const userNameEl = article.querySelector(SELECTORS.userName);
      const nameSpan = userNameEl?.querySelector('span');
      const authorName = nameSpan?.textContent?.trim() || 'Unknown';

      // 获取 handle
      let authorHandle = '';
      const links = userNameEl?.querySelectorAll('a') || [];
      for (const l of links) {
        const h = l.getAttribute('href');
        if (h && h.startsWith('/') && !h.includes('/status/')) {
          authorHandle = h.substring(1);
          break;
        }
      }

      // 获取头像
      const avatarContainer = article.querySelector(SELECTORS.avatar);
      const avatarImg = avatarContainer?.querySelector('img');
      const authorAvatar = avatarImg?.src || '';

      // 获取内容
      const textEl = article.querySelector(SELECTORS.tweetText);
      const content = textEl?.textContent?.trim() || '';

      // 获取时间戳
      const timeEl = article.querySelector(SELECTORS.time);
      const timestamp = timeEl?.getAttribute('datetime') || new Date().toISOString();

      // 获取指标
      const metrics = this.scrapeMetrics(article);

      // 获取媒体
      const media = this.scrapeMedia(article);

      return {
        tweetId,
        authorHandle,
        authorName,
        authorAvatar,
        content,
        timestamp,
        metrics,
        media,
      };
    } catch (e) {
      console.error('[BookmarkScraper] Failed to scrape article:', e);
      return null;
    }
  }

  /**
   * 提取推文指标
   */
  private scrapeMetrics(article: HTMLElement): ScrapedBookmark['metrics'] {
    const metrics = {
      replies: 0,
      retweets: 0,
      likes: 0,
      views: 0,
    };

    // 回复数
    const replyBtn = article.querySelector(SELECTORS.replyCount);
    if (replyBtn) {
      const text = replyBtn.getAttribute('aria-label') || '';
      const match = text.match(/(\d+)/);
      if (match) metrics.replies = parseInt(match[1], 10);
    }

    // 转发数
    const retweetBtn = article.querySelector(SELECTORS.retweetCount);
    if (retweetBtn) {
      const text = retweetBtn.getAttribute('aria-label') || '';
      const match = text.match(/(\d+)/);
      if (match) metrics.retweets = parseInt(match[1], 10);
    }

    // 点赞数
    const likeBtn = article.querySelector(SELECTORS.likeCount);
    if (likeBtn) {
      const text = likeBtn.getAttribute('aria-label') || '';
      const match = text.match(/(\d+)/);
      if (match) metrics.likes = parseInt(match[1], 10);
    }

    // 浏览数
    const viewLink = article.querySelector(SELECTORS.viewCount);
    if (viewLink) {
      const text = viewLink.textContent || '';
      metrics.views = this.parseMetricNumber(text);
    }

    return metrics;
  }

  /**
   * 解析带单位的数字（如 1.5K, 2M, 3万）
   */
  private parseMetricNumber(text: string): number {
    const cleanText = text.replace(/,/g, '');
    const num = parseFloat(cleanText);

    const upperText = cleanText.toUpperCase();
    if (upperText.includes('K')) return Math.round(num * 1000);
    if (upperText.includes('M')) return Math.round(num * 1000000);
    if (upperText.includes('B')) return Math.round(num * 1000000000);
    if (upperText.includes('万')) return Math.round(num * 10000);
    if (upperText.includes('亿')) return Math.round(num * 100000000);

    return isNaN(num) ? 0 : Math.round(num);
  }

  /**
   * 提取媒体
   */
  private scrapeMedia(article: HTMLElement): Array<{ type: 'photo' | 'video'; url: string }> {
    const media: Array<{ type: 'photo' | 'video'; url: string }> = [];

    // 图片
    const photoContainers = article.querySelectorAll(SELECTORS.tweetPhoto);
    photoContainers.forEach(container => {
      const img = container.querySelector('img');
      if (img?.src) {
        media.push({ type: 'photo', url: img.src });
      }
    });

    // 视频
    const videoPlayers = article.querySelectorAll(SELECTORS.videoPlayer);
    videoPlayers.forEach(player => {
      const videoEl = player.querySelector('video');
      const poster = videoEl?.getAttribute('poster');
      if (poster) {
        media.push({ type: 'video', url: poster });
      }
    });

    // 去重
    return media.filter((v, i, a) => a.findIndex(t => t.url === v.url) === i);
  }

  /**
   * 重置已处理的 ID（新爬取会话）
   */
  reset(): void {
    this.processedIds.clear();
  }
}

// 单例导出
export const bookmarkScraper = new BookmarkScraper();
