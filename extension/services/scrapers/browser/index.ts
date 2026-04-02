/**
 * Browser-based scrapers — use chrome.scripting.executeScript to call
 * internal APIs with the user's browser cookies.
 */

export { searchReddit, fetchRedditHot } from './reddit';
export type { RedditResult, RedditHotResult } from './reddit';

export { searchBilibili, fetchBilibiliHot, fetchBilibiliRanking } from './bilibili';
export type { BilibiliResult, BilibiliHotResult, BilibiliRankingResult } from './bilibili';

export { searchZhihu, fetchZhihuHot } from './zhihu';
export type { ZhihuResult, ZhihuHotResult } from './zhihu';

export { searchXueqiu, fetchXueqiuHot } from './xueqiu';
export type { XueqiuResult, XueqiuHotResult } from './xueqiu';

export { searchInstagram, fetchInstagramExplore } from './instagram';
export type { InstagramResult, InstagramExploreResult } from './instagram';

export { searchLinuxDo } from './linux-do';
export type { LinuxDoResult } from './linux-do';

export { searchJike } from './jike';
export type { JikeResult } from './jike';

export { searchXiaohongshu } from './xiaohongshu-search';
export type { XiaohongshuSearchResult } from './xiaohongshu-search';

export { searchWeibo, fetchWeiboHot } from './weibo';
export type { WeiboSearchResult, WeiboHotResult } from './weibo';

export { searchDouban, fetchDoubanMovieHot, fetchDoubanBookHot, fetchDoubanTop250 } from './douban';
export type { DoubanSearchResult, DoubanMovieHotResult, DoubanBookHotResult, DoubanTop250Result } from './douban';

export { searchMedium } from './medium';
export type { MediumSearchResult } from './medium';

export { searchGoogle, searchGoogleNews } from './google';
export type { GoogleSearchResult, GoogleNewsResult } from './google';

export { searchFacebook } from './facebook';
export type { FacebookSearchResult } from './facebook';

export { searchLinkedInJobs } from './linkedin';
export type { LinkedInJobResult, LinkedInSearchOptions } from './linkedin';

export { search36Kr, fetch36KrHot, fetch36KrNews } from './36kr';
export type { Kr36Result, Kr36HotResult, Kr36NewsResult } from './36kr';

export { fetchProductHuntHot } from './producthunt';
export type { ProductHuntResult } from './producthunt';

export { fetchWeixinArticle } from './weixin';
export type { WeixinArticleResult } from './weixin';

export { fetchYahooFinanceQuote } from './yahoo-finance';
export type { YahooFinanceQuote } from './yahoo-finance';
