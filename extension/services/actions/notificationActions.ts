/**
 * Notification Action Handlers
 * 通知类 Action 处理器
 *
 * 复用 NotificationProcessor 的逻辑，与 autoReplyService 的 "Only Process Notifications" 模式保持一致
 */

import { ActionHandler, ScrapedBookmark } from '../../types/action';
import { HumanBehaviorSimulator } from '../../utils/HumanBehaviorSimulator';
import { NotificationProcessor } from '../../utils/NotificationProcessor';
import { TimelineScroller } from '../../utils/TimelineScroller';
import { navigateToUrl } from '../../utils/navigationUtils';

// Twitter DOM 选择器（用于 clickNotificationHandler）
const SELECTORS = {
  notification: '[data-testid="cellInnerDiv"]',
  notificationLink: 'a[href*="/status/"]',
  tweet: 'article[data-testid="tweet"]',
  userName: '[data-testid="User-Name"]',
  tweetText: '[data-testid="tweetText"]',
};

/**
 * 处理通知
 *
 * 步骤（与 NotificationProcessor.fetchTweetsFromNextNotification 一致）：
 * 1. 导航到 /notifications 页面（SPA 方式）
 * 2. 查找 "New Post" 通知（关键词匹配）
 * 3. 高亮通知（蓝色边框动画）
 * 4. 点击通知进入时间线
 * 5. 抓取推文
 * 6. 标记为已处理
 */
export const processNotificationsHandler: ActionHandler = async (params, callbacks, context) => {
  const { limit = 3 } = params as { limit?: number };
  callbacks.onProgress?.({} as any, '正在处理通知...');

  try {
    // 创建 NotificationProcessor 实例（复用现有逻辑）
    // TimelineScroller 需要 onTweetFound 回调
    const scroller = new TimelineScroller({
      onTweetFound: () => {}, // NotificationProcessor 内部使用 scanTweetsInCurrentView，不需要回调
    });
    const notificationProcessor = new NotificationProcessor(scroller);

    // 调用 NotificationProcessor 的方法（完整的处理流程）
    // 这会：导航到通知页 → 查找新帖子通知 → 高亮 → 点击 → 抓取推文
    callbacks.onProgress?.({} as any, '正在查找新帖子通知...');
    const tweets = await notificationProcessor.fetchTweetsFromNextNotification(limit);

    if (tweets.length === 0) {
      callbacks.onProgress?.({} as any, '未找到新的帖子通知');
      return {
        success: true,
        data: {
          notifications: [],
          count: 0,
          message: '未找到新的帖子通知',
        },
      };
    }

    // 转换为 ScrapedBookmark 格式
    const processedNotifications: Array<{
      index: number;
      tweet: ScrapedBookmark;
    }> = tweets.map((tweet, index) => ({
      index,
      tweet: {
        tweetId: tweet.id,
        authorHandle: tweet.authorHandle,
        authorName: tweet.authorName,
        authorAvatar: tweet.authorAvatar || '',
        content: tweet.content,
        timestamp: tweet.timestamp,
        metrics: tweet.metrics,
        media: tweet.media || [],
      },
    }));

    callbacks.onProgress?.({} as any, `成功处理 ${tweets.length} 条通知`);

    return {
      success: true,
      data: {
        notifications: processedNotifications,
        count: processedNotifications.length,
      },
    };
  } catch (error) {
    console.error('[processNotificationsHandler] Error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : '处理通知失败',
    };
  }
};

/**
 * 点击特定通知
 */
export const clickNotificationHandler: ActionHandler = async (params, callbacks) => {
  const { keywords, highlight = true } = params as { keywords?: string[]; highlight?: boolean };
  callbacks.onProgress?.({} as any, '正在查找通知...');

  // 确保在通知页面
  if (!window.location.href.includes('/notifications')) {
    return { success: false, error: '不在通知页面' };
  }

  await HumanBehaviorSimulator.randomDelay(500, 1000);

  const notificationCells = document.querySelectorAll(SELECTORS.notification);

  for (const cell of notificationCells) {
    const cellText = (cell as HTMLElement).textContent?.toLowerCase() || '';

    // 关键词匹配
    if (keywords && keywords.length > 0) {
      const hasKeyword = keywords.some(k => cellText.includes(k.toLowerCase()));
      if (!hasKeyword) continue;
    }

    // 查找可点击的链接
    const link = cell.querySelector(SELECTORS.notificationLink) as HTMLAnchorElement;
    if (link) {
      if (highlight) {
        highlightElement(cell as HTMLElement);
        await HumanBehaviorSimulator.randomDelay(500, 1000);
      }

      link.click();
      await HumanBehaviorSimulator.randomDelay(1500, 2500);

      return { success: true, data: { clicked: true } };
    }
  }

  return { success: false, error: '未找到匹配的通知' };
};

/**
 * 高亮 DOM 元素
 */
function highlightElement(element: HTMLElement, duration: number = 3000): void {
  const originalOutline = element.style.outline;
  const originalBackground = element.style.backgroundColor;

  element.style.outline = '3px solid rgba(29, 155, 240, 0.6)';
  element.style.backgroundColor = 'rgba(29, 155, 240, 0.1)';

  setTimeout(() => {
    element.style.outline = originalOutline;
    element.style.backgroundColor = originalBackground;
  }, duration);
}

/**
 * 从 article 元素抓取推文
 */
function scrapeTweetFromArticle(article: HTMLElement): ScrapedBookmark | null {
  try {
    const link = article.querySelector('a[href*="/status/"]');
    const href = link?.getAttribute('href');
    const idMatch = href?.match(/\/status\/(\d+)/);
    if (!idMatch) return null;

    const tweetId = idMatch[1];

    const userNameEl = article.querySelector(SELECTORS.userName);
    const nameSpan = userNameEl?.querySelector('span');
    const authorName = nameSpan?.textContent?.trim() || 'Unknown';

    let authorHandle = '';
    const links = userNameEl?.querySelectorAll('a') || [];
    for (const l of links) {
      const h = l.getAttribute('href');
      if (h && h.startsWith('/') && !h.includes('/status/')) {
        authorHandle = h.substring(1);
        break;
      }
    }

    const textEl = article.querySelector(SELECTORS.tweetText);
    const content = textEl?.textContent?.trim() || '';

    const timeEl = article.querySelector('time[datetime]');
    const timestamp = timeEl?.getAttribute('datetime') || new Date().toISOString();

    return {
      tweetId,
      authorHandle,
      authorName,
      authorAvatar: '',
      content,
      timestamp,
      metrics: { replies: 0, retweets: 0, likes: 0, views: 0 },
      media: [],
    };
  } catch (e) {
    console.error('[scrapeTweetFromArticle] 抓取失败:', e);
    return null;
  }
}

/**
 * 导出所有通知 handlers
 */
export const notificationHandlers: Record<string, ActionHandler> = {
  process_notifications: processNotificationsHandler,
  click_notification: clickNotificationHandler,
};
