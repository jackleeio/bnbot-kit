/**
 * Scroll Action Handlers
 * 刷推类 Action 处理器
 */

import { ActionHandler, ScrapedBookmark } from '../../types/action';
import { HumanBehaviorSimulator } from '../../utils/HumanBehaviorSimulator';

// Twitter DOM 选择器
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
};

/**
 * 从 article 元素抓取推文
 */
function scrapeTweet(article: HTMLElement): ScrapedBookmark | null {
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

    const avatarContainer = article.querySelector(SELECTORS.avatar);
    const avatarImg = avatarContainer?.querySelector('img');
    const authorAvatar = avatarImg?.src || '';

    const textEl = article.querySelector(SELECTORS.tweetText);
    const content = textEl?.textContent?.trim() || '';

    const timeEl = article.querySelector(SELECTORS.time);
    const timestamp = timeEl?.getAttribute('datetime') || new Date().toISOString();

    // 简化指标抓取
    const metrics = {
      replies: 0,
      retweets: 0,
      likes: 0,
      views: 0,
    };

    const replyBtn = article.querySelector(SELECTORS.replyCount);
    if (replyBtn) {
      const text = replyBtn.getAttribute('aria-label') || '';
      const match = text.match(/(\d+)/);
      if (match) metrics.replies = parseInt(match[1], 10);
    }

    // 简化媒体抓取
    const media: Array<{ type: 'photo' | 'video'; url: string }> = [];
    const photoContainers = article.querySelectorAll(SELECTORS.tweetPhoto);
    photoContainers.forEach(container => {
      const img = container.querySelector('img');
      if (img?.src) {
        media.push({ type: 'photo', url: img.src });
      }
    });

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
    console.error('[scrapeTweet] 抓取失败:', e);
    return null;
  }
}

/**
 * 滚动并收集推文
 */
export const scrollAndCollectHandler: ActionHandler = async (params, callbacks, context) => {
  const { count = 10, batchSize = 5, maxScrolls = 20 } = params as {
    count?: number;
    batchSize?: number;
    maxScrolls?: number;
  };
  callbacks.onProgress?.({} as any, `正在收集推文 (0/${count})...`);

  const tweets: ScrapedBookmark[] = [];
  const processedIds = new Set<string>();
  let scrollCount = 0;

  await HumanBehaviorSimulator.randomDelay(500, 1000);

  while (tweets.length < count && scrollCount < maxScrolls) {
    // 检查是否被中止
    if (context.abortController.signal.aborted) {
      break;
    }

    // 抓取当前视图的推文
    const articles = document.querySelectorAll(SELECTORS.tweet);
    let batchCount = 0;

    for (const article of articles) {
      if (tweets.length >= count) break;
      if (batchCount >= batchSize) break;

      const tweet = scrapeTweet(article as HTMLElement);
      if (tweet && !processedIds.has(tweet.tweetId)) {
        processedIds.add(tweet.tweetId);
        tweets.push(tweet);
        batchCount++;
        callbacks.onProgress?.({} as any, `正在收集推文 (${tweets.length}/${count})...`);
      }
    }

    // 滚动加载更多
    if (tweets.length < count) {
      await HumanBehaviorSimulator.scrollByViewport();
      await HumanBehaviorSimulator.randomDelay(1000, 2000);
      scrollCount++;
    }
  }

  return {
    success: true,
    data: {
      tweets,
      count: tweets.length,
      scrollCount,
    },
  };
};

/**
 * 持续滚动
 */
export const continuousScrollHandler: ActionHandler = async (params, callbacks, context) => {
  const {
    stopCondition = 'count',
    maxDuration = 60000,
    targetCount = 50,
  } = params as {
    stopCondition?: 'count' | 'time' | 'noNew';
    maxDuration?: number;
    targetCount?: number;
  };

  callbacks.onProgress?.({} as any, '正在持续滚动...');

  const startTime = Date.now();
  const tweets: ScrapedBookmark[] = [];
  const processedIds = new Set<string>();
  let noNewCount = 0;
  let scrollCount = 0;

  await HumanBehaviorSimulator.randomDelay(500, 1000);

  while (true) {
    // 检查是否被中止
    if (context.abortController.signal.aborted) {
      break;
    }

    const prevCount = tweets.length;

    // 抓取当前视图
    const articles = document.querySelectorAll(SELECTORS.tweet);
    for (const article of articles) {
      const tweet = scrapeTweet(article as HTMLElement);
      if (tweet && !processedIds.has(tweet.tweetId)) {
        processedIds.add(tweet.tweetId);
        tweets.push(tweet);
      }
    }

    // 检查停止条件
    if (stopCondition === 'time' && Date.now() - startTime > maxDuration) {
      callbacks.onProgress?.({} as any, '达到最大时长，停止滚动');
      break;
    }

    if (stopCondition === 'count' && tweets.length >= targetCount) {
      callbacks.onProgress?.({} as any, `达到目标数量 ${targetCount}，停止滚动`);
      break;
    }

    if (stopCondition === 'noNew') {
      if (tweets.length === prevCount) {
        noNewCount++;
        if (noNewCount >= 3) {
          callbacks.onProgress?.({} as any, '没有新内容，停止滚动');
          break;
        }
      } else {
        noNewCount = 0;
      }
    }

    // 滚动
    await HumanBehaviorSimulator.scrollByViewport();
    await HumanBehaviorSimulator.randomDelay(1000, 2000);
    scrollCount++;

    callbacks.onProgress?.({} as any, `已收集 ${tweets.length} 条推文，滚动 ${scrollCount} 次`);
  }

  return {
    success: true,
    data: {
      tweets,
      count: tweets.length,
      duration: Date.now() - startTime,
      scrollCount,
    },
  };
};

/**
 * 导出所有刷推 handlers
 */
export const scrollHandlers: Record<string, ActionHandler> = {
  scroll_and_collect: scrollAndCollectHandler,
  continuous_scroll: continuousScrollHandler,
};
