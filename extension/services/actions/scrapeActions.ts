/**
 * Scrape Action Handlers
 * 抓取类 Action 处理器
 */

import { ActionHandler, ScrapedBookmark } from '../../types/action';
import { HumanBehaviorSimulator } from '../../utils/HumanBehaviorSimulator';
import { bookmarkScraper } from '../../utils/BookmarkScraper';
import { TwitterClient } from '../../utils/TwitterClient';

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
  viewCount: 'a[href*="/analytics"]',
};

/**
 * 通用推文抓取函数 - 导出供其他模块使用
 */
export function scrapeTweet(article: HTMLElement): ScrapedBookmark | null {
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
    const metrics = scrapeMetrics(article);

    // 获取媒体
    const media = scrapeMedia(article);

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
 * 抓取推文指标
 */
function scrapeMetrics(article: HTMLElement): ScrapedBookmark['metrics'] {
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
    metrics.views = parseMetricNumber(text);
  }

  return metrics;
}

/**
 * 解析带单位的数字
 */
function parseMetricNumber(text: string): number {
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
 * 抓取媒体
 */
function scrapeMedia(article: HTMLElement): Array<{ type: 'photo' | 'video'; url: string }> {
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
 * 抓取时间线
 */
export const scrapeTimelineHandler: ActionHandler = async (params, callbacks, context) => {
  const { limit = 10, scrollAttempts = 5 } = params as { limit?: number; scrollAttempts?: number };
  callbacks.onProgress?.({} as any, '正在抓取时间线...');

  const tweets: ScrapedBookmark[] = [];
  const processedIds = new Set<string>();
  let attempts = 0;

  await HumanBehaviorSimulator.randomDelay(500, 1000);

  while (tweets.length < limit && attempts < scrollAttempts) {
    // 检查是否被中止
    if (context.abortController.signal.aborted) {
      break;
    }

    const articles = document.querySelectorAll(SELECTORS.tweet);

    for (const article of articles) {
      if (tweets.length >= limit) break;

      const tweet = scrapeTweet(article as HTMLElement);
      if (tweet && !processedIds.has(tweet.tweetId)) {
        processedIds.add(tweet.tweetId);
        tweets.push(tweet);
        callbacks.onProgress?.({} as any, `已抓取 ${tweets.length}/${limit} 条推文`);
      }
    }

    if (tweets.length < limit) {
      await HumanBehaviorSimulator.scrollByViewport();
      await HumanBehaviorSimulator.randomDelay(1000, 2000);
      attempts++;
    }
  }

  return { success: true, data: { tweets, count: tweets.length } };
};

/**
 * 抓取书签
 * 使用 Twitter GraphQL API 获取书签数据
 */
export const scrapeBookmarksHandler: ActionHandler = async (params, callbacks, context) => {
  const { limit = 20 } = params as { limit?: number };
  callbacks.onProgress?.({} as any, '正在获取书签...');

  try {
    // 使用 TwitterClient API 获取书签
    const tweets = await TwitterClient.getAllBookmarks(limit, (fetched, total) => {
      callbacks.onProgress?.({} as any, `已获取 ${fetched}/${total} 个书签`);
    });

    if (tweets.length === 0) {
      return { success: false, error: '未获取到书签数据，请确保已登录 Twitter' };
    }

    console.log(`[scrapeBookmarks] 成功获取 ${tweets.length} 个书签`);

    return {
      success: true,
      data: {
        tweets,
        count: tweets.length
      }
    };
  } catch (e) {
    console.error('[scrapeBookmarks] 获取失败:', e);
    return { success: false, error: e instanceof Error ? e.message : '获取书签失败' };
  }
};

/**
 * 抓取当前视图
 */
export const scrapeCurrentViewHandler: ActionHandler = async (params, callbacks) => {
  callbacks.onProgress?.({} as any, '正在抓取当前视图...');

  const tweets: ScrapedBookmark[] = [];
  const articles = document.querySelectorAll(SELECTORS.tweet);

  for (const article of articles) {
    const tweet = scrapeTweet(article as HTMLElement);
    if (tweet) {
      tweets.push(tweet);
    }
  }

  return { success: true, data: { tweets, count: tweets.length } };
};

/**
 * 抓取搜索结果（DOM 方式）
 * 支持 query + tab 参数，自动导航到搜索页
 */
export const scrapeSearchResultsHandler: ActionHandler = async (params, callbacks, context) => {
  const { query, tab, limit = 20, from, since, until, lang } = params as {
    query?: string; tab?: string; limit?: number;
    from?: string; since?: string; until?: string; lang?: string;
  };

  // 构建搜索查询（支持 CLI 直传过滤参数）
  const parts: string[] = [];
  if (query) parts.push(query);
  if (from) parts.push(`from:${from}`);
  if (since) parts.push(`since:${since}`);
  if (until) parts.push(`until:${until}`);
  if (lang) parts.push(`lang:${lang}`);
  const fullQuery = parts.join(' ');

  if (fullQuery) {
    callbacks.onProgress?.({} as any, '正在搜索...');
    let searchUrl = `/search?q=${encodeURIComponent(fullQuery)}&src=typed_query`;
    if (tab) searchUrl += `&f=${tab}`;
    window.history.pushState({}, '', `https://x.com${searchUrl}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
    await HumanBehaviorSimulator.randomDelay(3000, 4000);
  }

  if (!window.location.href.includes('/search')) {
    return { success: false, error: '不在搜索页面' };
  }

  callbacks.onProgress?.({} as any, '正在抓取搜索结果...');
  const tweets: ScrapedBookmark[] = [];
  const processedIds = new Set<string>();
  let attempts = 0;
  let noNewCount = 0;
  const maxAttempts = Math.min(Math.ceil(limit / 3) + 5, 40);

  while (tweets.length < limit && attempts < maxAttempts) {
    if (context.abortController.signal.aborted) break;
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
    if (tweets.length >= limit) break;
    if (tweets.length === prevCount) { noNewCount++; if (noNewCount >= 5) break; } else { noNewCount = 0; }
    await HumanBehaviorSimulator.scrollByViewport();
    await HumanBehaviorSimulator.randomDelay(1000, 1500);
    attempts++;
  }

  return { success: true, data: { tweets, count: tweets.length } };
};

/**
 * 获取账户分析数据
 */
export const accountAnalyticsHandler: ActionHandler = async (params, callbacks) => {
  const { fromTime, toTime, granularity } = params as {
    fromTime: string;
    toTime: string;
    granularity?: 'Daily' | 'Weekly' | 'Monthly';
  };

  callbacks.onProgress?.({} as any, '正在获取账户分析数据...');

  try {
    const response = await TwitterClient.getAccountAnalytics({
      fromTime,
      toTime,
      granularity: granularity || 'Daily'
    });

    // 解析实际返回结构: data.viewer_v2.user_results.result
    const userResult = response?.data?.viewer_v2?.user_results?.result;

    if (!userResult) {
      return { success: false, error: '未获取到分析数据' };
    }

    // 返回解析后的数据
    return {
      success: true,
      data: {
        followers: userResult.relationship_counts?.followers,
        verifiedFollowers: userResult.verified_follower_count,
        timeSeries: userResult.organic_metrics_time_series
      }
    };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : '获取失败' };
  }
};

/**
 * 获取主推文曝光数据（排除回复）
 */
export const postImpressionsHandler: ActionHandler = async (params, callbacks) => {
  const { fromTime, toTime } = params as { fromTime: string; toTime: string };
  callbacks.onProgress?.({} as any, '正在获取主推文曝光数据...');
  try {
    const response = await TwitterClient.getPostImpressions({
      from: new Date(fromTime),
      to: new Date(toTime)
    });
    return { success: true, data: response };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : '获取失败' };
  }
};

/**
 * 获取 KOL 最近推文（用于 /kol-pulse skill）
 */
export const kolPulseHandler: ActionHandler = async (params, callbacks) => {
  const { kol_type = 'crypto', page_size = 100 } = params as {
    kol_type?: string;
    page_size?: number;
  };
  callbacks.onProgress?.({} as any, `正在获取 ${kol_type} KOL 推文...`);
  try {
    const { analysisService } = await import('../analysisService');
    const response = await analysisService.getKolRecentData({ kol_type, page_size });
    return { success: true, data: response };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : '获取失败' };
  }
};

/**
 * 获取回复推文曝光数据
 */
export const replyImpressionsHandler: ActionHandler = async (params, callbacks) => {
  const { fromTime, toTime } = params as { fromTime: string; toTime: string };
  callbacks.onProgress?.({} as any, '正在获取回复推文曝光数据...');
  try {
    const response = await TwitterClient.getReplyImpressions({
      from: new Date(fromTime),
      to: new Date(toTime)
    });
    return { success: true, data: response };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : '获取失败' };
  }
};

/**
 * 抓取推文 Thread
 * 在推文详情页，向下滚动抓取同一作者的所有连续推文
 * 返回按顺序排列的 thread 推文列表 + 合并后的纯文本
 */
export const scrapeThreadHandler: ActionHandler = async (params, callbacks, context) => {
  const { maxScrolls = 10 } = params as { maxScrolls?: number };
  callbacks.onProgress?.({} as any, '正在抓取 Thread...');

  // 确保在推文详情页
  if (!window.location.href.includes('/status/')) {
    return { success: false, error: '请先导航到推文详情页' };
  }

  // 获取当前推文的作者 handle
  const firstArticle = document.querySelector(SELECTORS.tweet) as HTMLElement;
  if (!firstArticle) {
    return { success: false, error: '未找到推文' };
  }
  const firstTweet = scrapeTweet(firstArticle);
  if (!firstTweet) {
    return { success: false, error: '无法解析推文' };
  }

  const threadAuthor = firstTweet.authorHandle;
  const threadTweets: ScrapedBookmark[] = [];
  const processedIds = new Set<string>();
  let scrollAttempts = 0;
  let noNewCount = 0;

  while (scrollAttempts < maxScrolls && noNewCount < 3) {
    if (context.abortController.signal.aborted) break;

    const articles = document.querySelectorAll(SELECTORS.tweet);
    let foundNew = false;

    for (const article of articles) {
      const tweet = scrapeTweet(article as HTMLElement);
      if (!tweet || processedIds.has(tweet.tweetId)) continue;

      // 只收集同一作者的推文（thread 属于同一个人）
      if (tweet.authorHandle === threadAuthor) {
        processedIds.add(tweet.tweetId);
        threadTweets.push(tweet);
        foundNew = true;
        callbacks.onProgress?.({} as any, `已抓取 ${threadTweets.length} 条 Thread 推文`);
      }
    }

    if (!foundNew) {
      noNewCount++;
    } else {
      noNewCount = 0;
    }

    // 向下滚动加载更多
    await HumanBehaviorSimulator.scrollByViewport();
    await HumanBehaviorSimulator.randomDelay(1000, 2000);
    scrollAttempts++;
  }

  // 按时间排序（旧→新）
  threadTweets.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  // 合并文本
  const mergedText = threadTweets.map((t, i) => `[${i + 1}/${threadTweets.length}] ${t.content}`).join('\n\n');

  return {
    success: true,
    data: {
      author: threadAuthor,
      authorName: firstTweet.authorName,
      tweets: threadTweets,
      count: threadTweets.length,
      mergedText,
    }
  };
};

/**
 * 抓取用户资料（via GraphQL API）
 */
export const scrapeUserProfileHandler: ActionHandler = async (params, callbacks) => {
  const { username } = params as { username: string };
  if (!username) {
    return { success: false, error: '缺少 username 参数' };
  }

  callbacks.onProgress?.({} as any, `正在获取 @${username} 资料...`);

  try {
    const profile = await TwitterClient.getUserProfile(username);
    if (!profile) {
      return { success: false, error: `未找到用户 @${username}` };
    }
    return { success: true, data: profile };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : '获取用户资料失败' };
  }
};

/**
 * 抓取用户推文列表（via GraphQL API）
 */
export const scrapeUserTweetsHandler: ActionHandler = async (params, callbacks) => {
  const { username, limit = 20 } = params as { username: string; limit?: number };
  if (!username) {
    return { success: false, error: '缺少 username 参数' };
  }

  callbacks.onProgress?.({} as any, `正在获取 @${username} 的推文...`);

  try {
    const userId = await TwitterClient.getUserIdByScreenName(username);
    if (!userId) {
      return { success: false, error: `未找到用户 @${username}` };
    }

    // 分页获取直到达到 limit
    const allTweetIds: string[] = [];
    const allTweets: any[] = [];
    const allQuoteIds: string[] = [];
    const allRetweetOriginalIds: string[] = [];
    let cursor: string | undefined;
    const maxPages = Math.ceil(limit / 20);

    for (let page = 0; page < maxPages; page++) {
      const result = await TwitterClient.getUserTweets(userId, Math.min(limit - allTweetIds.length, 20), cursor || undefined);
      allTweetIds.push(...result.tweetIds);
      allTweets.push(...result.tweets);
      allQuoteIds.push(...result.quoteIds);
      allRetweetOriginalIds.push(...result.retweetOriginalIds);

      callbacks.onProgress?.({} as any, `已获取 ${allTweetIds.length} 条推文...`);

      if (!result.nextCursor || allTweetIds.length >= limit) break;
      cursor = result.nextCursor;
    }

    return {
      success: true,
      data: {
        username,
        userId,
        tweets: allTweets.slice(0, limit),
        tweetIds: allTweetIds.slice(0, limit),
        quoteIds: allQuoteIds,
        retweetOriginalIds: allRetweetOriginalIds,
        count: Math.min(allTweetIds.length, limit),
      }
    };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : '获取用户推文失败' };
  }
};


/**
 * 导出所有抓取 handlers
 */
export const scrapeHandlers: Record<string, ActionHandler> = {
  scrape_timeline: scrapeTimelineHandler,
  scrape_bookmarks: scrapeBookmarksHandler,
  scrape_current_view: scrapeCurrentViewHandler,
  scrape_search_results: scrapeSearchResultsHandler,
  scrape_thread: scrapeThreadHandler,
  account_analytics: accountAnalyticsHandler,
  post_impressions: postImpressionsHandler,
  reply_impressions: replyImpressionsHandler,
  kol_pulse: kolPulseHandler,
  scrape_user_profile: scrapeUserProfileHandler,
  scrape_user_tweets: scrapeUserTweetsHandler,
};
