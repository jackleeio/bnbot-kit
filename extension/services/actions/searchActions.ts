/**
 * Search Action Handlers
 * 搜索类 Action 处理器
 */

import { ActionHandler, SearchFilters, ScrapedBookmark } from '../../types/action';
import { HumanBehaviorSimulator } from '../../utils/HumanBehaviorSimulator';
import { scrapeTweet } from './scrapeActions';

// Twitter DOM 选择器
const SELECTORS = {
  tweet: 'article[data-testid="tweet"]',
};

/**
 * 构建 Twitter 高级搜索查询
 */
function buildAdvancedSearchQuery(query: string, filters: SearchFilters): string {
  let searchQuery = query;

  if (filters.from) searchQuery += ` from:${filters.from}`;
  if (filters.to) searchQuery += ` to:${filters.to}`;
  if (filters.since) searchQuery += ` since:${filters.since}`;
  if (filters.until) searchQuery += ` until:${filters.until}`;
  if (filters.minReplies) searchQuery += ` min_replies:${filters.minReplies}`;
  if (filters.minLikes) searchQuery += ` min_faves:${filters.minLikes}`;
  if (filters.minRetweets) searchQuery += ` min_retweets:${filters.minRetweets}`;
  if (filters.hasMedia) searchQuery += ` filter:media`;
  if (filters.hasLinks) searchQuery += ` filter:links`;
  if (filters.lang) searchQuery += ` lang:${filters.lang}`;

  return searchQuery;
}

/**
 * 等待导航完成
 */
async function waitForNavigation(pathContains: string, timeout: number = 10000): Promise<boolean> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    if (window.location.href.includes(pathContains)) {
      return true;
    }
    await HumanBehaviorSimulator.randomDelay(200, 300);
  }
  return false;
}

/**
 * 快速滚动 - 模拟人类快速浏览行为
 * 使用 smooth 滚动，距离和速度随机化
 */
async function fastScroll(): Promise<void> {
  const viewportHeight = window.innerHeight;
  // 滚动 1.5-3 倍视口高度，模拟人类快速浏览
  const scrollAmount = viewportHeight * (1.5 + Math.random() * 1.5);

  window.scrollBy({
    top: scrollAmount,
    behavior: 'smooth'
  });

  // 等待滚动动画完成（根据距离调整等待时间）
  const animationTime = 400 + Math.random() * 200;
  await new Promise(resolve => setTimeout(resolve, animationTime));
}

/**
 * 高级搜索 - 导航到搜索页并抓取结果
 */
export const advancedSearchHandler: ActionHandler = async (params, callbacks, context) => {
  const { query = '', filters = {}, limit = 50 } = params as {
    query?: string;
    filters?: SearchFilters;
    limit?: number;
  };
  callbacks.onProgress?.({} as any, '正在执行高级搜索...');

  // 构建搜索查询（允许空 query，只要有 filters 就可以搜索）
  const searchQuery = buildAdvancedSearchQuery(query, filters);
  const searchUrl = `/search?q=${encodeURIComponent(searchQuery)}&src=typed_query`;

  // 执行导航
  window.history.pushState({}, '', `https://x.com${searchUrl}`);
  window.dispatchEvent(new PopStateEvent('popstate'));

  await HumanBehaviorSimulator.randomDelay(1000, 1500);

  const navigationSuccess = await waitForNavigation('/search');
  if (!navigationSuccess) {
    return { success: false, error: '导航到搜索页超时' };
  }

  // 等待搜索结果加载（确保内容完全加载后再滚动）
  await HumanBehaviorSimulator.randomDelay(2000, 2000);

  // 抓取搜索结果
  callbacks.onProgress?.({} as any, '正在抓取搜索结果...');

  const tweets: ScrapedBookmark[] = [];
  const processedIds = new Set<string>();
  let attempts = 0;
  const maxAttempts = 40; // 足够的滚动次数，确保能抓到50条
  let noNewTweetsCount = 0; // 连续没有新推文的次数

  while (tweets.length < limit && attempts < maxAttempts) {
    // 检查是否被中止
    if (context.abortController.signal.aborted) {
      break;
    }

    const prevCount = tweets.length;
    const articles = document.querySelectorAll(SELECTORS.tweet);

    for (const article of articles) {
      if (tweets.length >= limit) break;

      const tweet = scrapeTweet(article as HTMLElement);
      if (tweet && !processedIds.has(tweet.tweetId)) {
        processedIds.add(tweet.tweetId);
        tweets.push(tweet);
        callbacks.onProgress?.({} as any, `已抓取 ${tweets.length}/${limit} 条`);
      }
    }

    // 如果达到目标数量，立即退出
    if (tweets.length >= limit) {
      break;
    }

    // 检查是否有新推文
    if (tweets.length === prevCount) {
      noNewTweetsCount++;
      // 连续5次没有新推文，说明已经到底了
      if (noNewTweetsCount >= 5) {
        callbacks.onProgress?.({} as any, `已到达底部，共抓取 ${tweets.length} 条`);
        break;
      }
    } else {
      noNewTweetsCount = 0;
    }

    await fastScroll();
    await HumanBehaviorSimulator.randomDelay(1000, 1500); // 等待 smooth 滚动完成 + 模拟人类节奏
    attempts++;
  }

  return {
    success: true,
    data: {
      query: searchQuery,
      filters,
      url: window.location.href,
      tweets,
      count: tweets.length,
    },
  };
};

/**
 * 导出所有搜索 handlers
 */
export const searchHandlers: Record<string, ActionHandler> = {
  advanced_search: advancedSearchHandler,
};
