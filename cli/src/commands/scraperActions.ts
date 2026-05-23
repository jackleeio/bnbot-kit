/**
 * Commander action handlers for browser-based scraper commands.
 * These send WebSocket actions to the extension which executes chrome.scripting.
 */

import { runCliAction } from '../cli.js';

const DEFAULT_PORT = 18900;

async function scrape(actionType: string, params: Record<string, unknown>): Promise<void> {
  await runCliAction(actionType, params, DEFAULT_PORT);
}

// ── TikTok ───────────────────────────────────────────────────

export async function tiktokSearchCommand(query: string, options: { limit?: string }) {
  await scrape('SCRAPER_SEARCH_TIKTOK', { query, limit: parseInt(options.limit || '10', 10) });
}

export async function tiktokExploreCommand(options: { limit?: string }) {
  await scrape('SCRAPER_FETCH_TIKTOK_EXPLORE', { limit: parseInt(options.limit || '20', 10) });
}

export async function tiktokProfileCommand(username: string) {
  await scrape('TIKTOK_PROFILE', { username });
}

export async function tiktokUserPostsCommand(
  user: string,
  options: { limit?: string; cursor?: string } = {},
) {
  await scrape('SCRAPER_FETCH_TIKTOK_USER_POSTS', {
    user,
    cursor: options.cursor || '',
    limit: parseInt(options.limit || '30', 10),
  });
}

export async function tiktokUserFollowersCommand(
  user: string,
  options: { limit?: string; cursor?: string } = {},
) {
  await scrape('SCRAPER_FETCH_TIKTOK_USER_FOLLOWERS', {
    user,
    cursor: options.cursor || '',
    limit: parseInt(options.limit || '30', 10),
  });
}

export async function tiktokPostDetailCommand(video: string) {
  await scrape('SCRAPER_FETCH_TIKTOK_POST_DETAIL', { video });
}

export async function tiktokPostCommentsCommand(
  video: string,
  options: { limit?: string; cursor?: string } = {},
) {
  await scrape('SCRAPER_FETCH_TIKTOK_POST_COMMENTS', {
    video,
    cursor: options.cursor || '',
    limit: parseInt(options.limit || '50', 10),
  });
}

export async function tiktokSearchAccountCommand(
  query: string,
  options: { limit?: string } = {},
) {
  await scrape('SCRAPER_SEARCH_TIKTOK_ACCOUNT', {
    query,
    limit: parseInt(options.limit || '20', 10),
  });
}

// ── Douyin (Wave 1) ──────────────────────────────────────────
//
// Mirrors the douyin-api23 RapidAPI surface. Douyin uses `secUid`
// (sec_user_id) as the canonical user identifier, `max_time` for
// follower/following pagination, and `offset`-based pagination for
// search endpoints. Hashtag scraping uses `hashtag` (ch_id) param.
//
// All scraping is performed by the chrome extension on douyin.com;
// the CLI just routes the action + payload through WebSocket.

export async function douyinUserInfoCommand(secUid: string) {
  await scrape('SCRAPER_FETCH_DY_USER_INFO', { secUid });
}

export async function douyinUserPostsCommand(
  secUid: string,
  options: { limit?: string; cursor?: string } = {},
) {
  await scrape('SCRAPER_FETCH_DY_USER_POSTS', {
    secUid,
    cursor: options.cursor || '',
    limit: parseInt(options.limit || '30', 10),
  });
}

export async function douyinUserLikedCommand(
  secUid: string,
  options: { limit?: string; cursor?: string } = {},
) {
  await scrape('SCRAPER_FETCH_DY_USER_LIKED', {
    secUid,
    cursor: options.cursor || '',
    limit: parseInt(options.limit || '30', 10),
  });
}

export async function douyinUserFollowersCommand(
  secUid: string,
  options: { limit?: string; maxTime?: string } = {},
) {
  await scrape('SCRAPER_FETCH_DY_USER_FOLLOWERS', {
    secUid,
    max_time: options.maxTime || '',
    limit: parseInt(options.limit || '30', 10),
  });
}

export async function douyinUserFollowingCommand(
  secUid: string,
  options: { limit?: string; maxTime?: string } = {},
) {
  await scrape('SCRAPER_FETCH_DY_USER_FOLLOWING', {
    secUid,
    max_time: options.maxTime || '',
    limit: parseInt(options.limit || '30', 10),
  });
}

export async function douyinPostCommentsCommand(
  video: string,
  options: { limit?: string; cursor?: string } = {},
) {
  await scrape('SCRAPER_FETCH_DY_POST_COMMENTS', {
    video,
    cursor: options.cursor || '',
    limit: parseInt(options.limit || '50', 10),
  });
}


export async function douyinSearchGeneralCommand(
  query: string,
  options: { limit?: string; offset?: string } = {},
) {
  await scrape('SCRAPER_SEARCH_DY_GENERAL', {
    query,
    offset: parseInt(options.offset || '0', 10),
    limit: parseInt(options.limit || '20', 10),
  });
}

export async function douyinSearchVideoCommand(
  query: string,
  options: { limit?: string; offset?: string } = {},
) {
  await scrape('SCRAPER_SEARCH_DY_VIDEO', {
    query,
    offset: parseInt(options.offset || '0', 10),
    limit: parseInt(options.limit || '20', 10),
  });
}

export async function douyinSearchAccountCommand(
  query: string,
  options: { limit?: string; cursor?: string } = {},
) {
  await scrape('SCRAPER_SEARCH_DY_ACCOUNT', {
    query,
    cursor: options.cursor || '',
    limit: parseInt(options.limit || '20', 10),
  });
}

export async function douyinSearchLiveCommand(
  query: string,
  options: { limit?: string; offset?: string } = {},
) {
  await scrape('SCRAPER_SEARCH_DY_LIVE', {
    query,
    offset: parseInt(options.offset || '0', 10),
    limit: parseInt(options.limit || '20', 10),
  });
}

export async function douyinChallengePostsCommand(
  hashtag: string,
  options: { limit?: string; offset?: string } = {},
) {
  await scrape('SCRAPER_FETCH_DY_CHALLENGE_POSTS', {
    hashtag,
    offset: parseInt(options.offset || '0', 10),
    limit: parseInt(options.limit || '30', 10),
  });
}

export async function douyinMusicPostsCommand(
  musicId: string,
  options: { limit?: string; cursor?: string } = {},
) {
  await scrape('SCRAPER_FETCH_DY_MUSIC_POSTS', {
    musicId,
    cursor: options.cursor || '',
    limit: parseInt(options.limit || '30', 10),
  });
}

// ── TikTok Wave 2/3/4 ────────────────────────────────────────

// Challenge / Music
export async function tiktokChallengeInfoCommand(challengeName: string) {
  await scrape('SCRAPER_FETCH_TIKTOK_CHALLENGE_INFO', { challengeName });
}

export async function tiktokChallengePostsCommand(
  challengeId: string,
  options: { limit?: string; cursor?: string } = {},
) {
  await scrape('SCRAPER_FETCH_TIKTOK_CHALLENGE_POSTS', {
    challengeId,
    cursor: options.cursor || '',
    limit: parseInt(options.limit || '30', 10),
  });
}

export async function tiktokMusicInfoCommand(musicId: string) {
  await scrape('SCRAPER_FETCH_TIKTOK_MUSIC_INFO', { musicId });
}

export async function tiktokMusicPostsCommand(
  musicId: string,
  options: { limit?: string; cursor?: string } = {},
) {
  await scrape('SCRAPER_FETCH_TIKTOK_MUSIC_POSTS', {
    musicId,
    cursor: options.cursor || '',
    limit: parseInt(options.limit || '30', 10),
  });
}

export async function tiktokMusicUnlimitedSoundsCommand(
  options: { page?: string; pageSize?: string; orderBy?: string } = {},
) {
  await scrape('SCRAPER_FETCH_TIKTOK_MUSIC_UNLIMITED', {
    page: parseInt(options.page || '1', 10),
    pageSize: parseInt(options.pageSize || '30', 10),
    orderBy: options.orderBy || '',
  });
}

// User extras
export async function tiktokUserInfoRegionCommand(uniqueId: string) {
  await scrape('SCRAPER_FETCH_TIKTOK_USER_INFO_REGION', { uniqueId });
}

export async function tiktokUserInfoByIdCommand(userId: string) {
  await scrape('SCRAPER_FETCH_TIKTOK_USER_INFO_BY_ID', { userId });
}

export async function tiktokUserFollowingsCommand(
  user: string,
  options: { limit?: string; maxTime?: string } = {},
) {
  await scrape('SCRAPER_FETCH_TIKTOK_USER_FOLLOWINGS', {
    user,
    max_time: options.maxTime || '',
    limit: parseInt(options.limit || '30', 10),
  });
}

export async function tiktokUserLikedPostsCommand(
  user: string,
  options: { limit?: string; cursor?: string } = {},
) {
  await scrape('SCRAPER_FETCH_TIKTOK_USER_LIKED_POSTS', {
    user,
    cursor: options.cursor || '',
    limit: parseInt(options.limit || '30', 10),
  });
}

export async function tiktokUserPlaylistCommand(
  user: string,
  options: { limit?: string; cursor?: string } = {},
) {
  await scrape('SCRAPER_FETCH_TIKTOK_USER_PLAYLIST', {
    user,
    cursor: options.cursor || '',
    limit: parseInt(options.limit || '30', 10),
  });
}

export async function tiktokUserRepostCommand(
  user: string,
  options: { limit?: string; cursor?: string } = {},
) {
  await scrape('SCRAPER_FETCH_TIKTOK_USER_REPOST', {
    user,
    cursor: options.cursor || '',
    limit: parseInt(options.limit || '30', 10),
  });
}

export async function tiktokUserStoryCommand(
  userId: string,
  options: { maxCursor?: string } = {},
) {
  await scrape('SCRAPER_FETCH_TIKTOK_USER_STORY', {
    userId,
    maxCursor: options.maxCursor || '',
  });
}

// Search / Discovery
export async function tiktokSearchGeneralCommand(
  query: string,
  options: { limit?: string; cursor?: string } = {},
) {
  await scrape('SCRAPER_SEARCH_TIKTOK_GENERAL', {
    query,
    cursor: options.cursor || '',
    limit: parseInt(options.limit || '20', 10),
  });
}

export async function tiktokSearchLiveCommand(
  query: string,
  options: { limit?: string; cursor?: string } = {},
) {
  await scrape('SCRAPER_SEARCH_TIKTOK_LIVE', {
    query,
    cursor: options.cursor || '',
    limit: parseInt(options.limit || '20', 10),
  });
}

export async function tiktokSearchSuggestionsCommand(keyword: string) {
  await scrape('SCRAPER_FETCH_TIKTOK_SEARCH_SUGGESTIONS', { keyword });
}

export async function tiktokPostRelatedCommand(
  video: string,
  options: { limit?: string; cursor?: string } = {},
) {
  await scrape('SCRAPER_FETCH_TIKTOK_POST_RELATED', {
    video,
    cursor: options.cursor || '',
    limit: parseInt(options.limit || '20', 10),
  });
}

export async function tiktokPostExploreCommand(
  options: { limit?: string; categoryType?: string } = {},
) {
  await scrape('SCRAPER_FETCH_TIKTOK_POST_EXPLORE', {
    categoryType: options.categoryType || '',
    limit: parseInt(options.limit || '20', 10),
  });
}

export async function tiktokPostDiscoverCommand(
  keyword: string,
  options: { page?: string } = {},
) {
  await scrape('SCRAPER_FETCH_TIKTOK_POST_DISCOVER', {
    keyword,
    page: parseInt(options.page || '1', 10),
  });
}

// ── TikTok Wave 5 — Creative Center (ads.tiktok.com) ─────────
//
// Separate ads-domain login required. Every command shells the same
// JSON-or-error envelope from the radar API; CLI defaults mirror the
// tiktok-api23 query shape (period in days, country as ISO code).

interface AdsTopOpts {
  page?: string;
  period?: string;
  limit?: string;
  country?: string;
  orderBy?: string;
}
export async function tiktokAdsTopCommand(options: AdsTopOpts = {}) {
  await scrape('SCRAPER_FETCH_TT_ADS_TOP', {
    page: parseInt(options.page || '1', 10),
    period: parseInt(options.period || '7', 10),
    limit: parseInt(options.limit || '20', 10),
    country: options.country || 'US',
    order_by: options.orderBy || 'ctr',
  });
}

export async function tiktokAdsDetailCommand(adsId: string) {
  await scrape('SCRAPER_FETCH_TT_ADS_DETAIL', { ads_id: adsId });
}

interface TrendingCreatorOpts {
  page?: string;
  limit?: string;
  sortBy?: string;
  country?: string;
}
export async function tiktokTrendingCreatorCommand(options: TrendingCreatorOpts = {}) {
  await scrape('SCRAPER_FETCH_TT_TRENDING_CREATOR', {
    page: parseInt(options.page || '1', 10),
    limit: parseInt(options.limit || '20', 10),
    sort_by: options.sortBy || 'follower',
    country: options.country || 'US',
  });
}

interface TrendingVideoOpts {
  page?: string;
  limit?: string;
  period?: string;
  orderBy?: string;
  country?: string;
}
export async function tiktokTrendingVideoCommand(options: TrendingVideoOpts = {}) {
  await scrape('SCRAPER_FETCH_TT_TRENDING_VIDEO', {
    page: parseInt(options.page || '1', 10),
    limit: parseInt(options.limit || '20', 10),
    period: parseInt(options.period || '30', 10),
    order_by: options.orderBy || 'vv',
    country: options.country || 'US',
  });
}

interface TrendingHashtagOpts {
  page?: string;
  limit?: string;
  period?: string;
  country?: string;
  sortBy?: string;
}
export async function tiktokTrendingHashtagCommand(options: TrendingHashtagOpts = {}) {
  await scrape('SCRAPER_FETCH_TT_TRENDING_HASHTAG', {
    page: parseInt(options.page || '1', 10),
    limit: parseInt(options.limit || '20', 10),
    period: parseInt(options.period || '120', 10),
    country: options.country || 'US',
    sort_by: options.sortBy || 'popular',
  });
}

interface TrendingSongOpts {
  page?: string;
  limit?: string;
  period?: string;
  rankType?: string;
  country?: string;
}
export async function tiktokTrendingSongCommand(options: TrendingSongOpts = {}) {
  await scrape('SCRAPER_FETCH_TT_TRENDING_SONG', {
    page: parseInt(options.page || '1', 10),
    limit: parseInt(options.limit || '20', 10),
    period: parseInt(options.period || '7', 10),
    rank_type: options.rankType || 'popular',
    country: options.country || 'US',
  });
}

interface TrendingKeywordOpts {
  page?: string;
  limit?: string;
  period?: string;
  country?: string;
}
export async function tiktokTrendingKeywordCommand(options: TrendingKeywordOpts = {}) {
  await scrape('SCRAPER_FETCH_TT_TRENDING_KEYWORD', {
    page: parseInt(options.page || '1', 10),
    limit: parseInt(options.limit || '20', 10),
    period: parseInt(options.period || '7', 10),
    country: options.country || 'US',
  });
}

interface KeywordPostsOpts {
  country?: string;
  limit?: string;
  period?: string;
}
export async function tiktokTrendingKeywordPostsCommand(
  keyword: string,
  options: KeywordPostsOpts = {},
) {
  await scrape('SCRAPER_FETCH_TT_TRENDING_KEYWORD_POSTS', {
    keyword,
    country: options.country || 'US',
    limit: parseInt(options.limit || '10', 10),
    period: parseInt(options.period || '7', 10),
  });
}

interface KeywordSentenceOpts {
  page?: string;
  limit?: string;
  period?: string;
  country?: string;
  orderType?: string;
}
export async function tiktokTrendingKeywordSentenceCommand(
  keyword: string,
  options: KeywordSentenceOpts = {},
) {
  await scrape('SCRAPER_FETCH_TT_TRENDING_KEYWORD_SENTENCE', {
    keyword,
    page: parseInt(options.page || '1', 10),
    limit: parseInt(options.limit || '50', 10),
    period: parseInt(options.period || '30', 10),
    country: options.country || 'US',
    order_type: options.orderType || 'desc',
  });
}

interface CommercialMusicOpts {
  page?: string;
  limit?: string;
  region?: string;
  scenarios?: string;
  duration?: string;
  placements?: string;   // comma-separated
  themes?: string;
  genres?: string;
  moods?: string;
}
function splitCsv(s?: string): string[] {
  return s ? s.split(',').map((x) => x.trim()).filter(Boolean) : [];
}
export async function tiktokCommercialMusicCommand(options: CommercialMusicOpts = {}) {
  await scrape('SCRAPER_FETCH_TT_COMMERCIAL_MUSIC', {
    page: parseInt(options.page || '1', 10),
    limit: parseInt(options.limit || '20', 10),
    region: options.region || 'US',
    scenarios: parseInt(options.scenarios || '0', 10),
    duration: parseInt(options.duration || '0', 10),
    placements: splitCsv(options.placements),
    themes: splitCsv(options.themes),
    genres: splitCsv(options.genres),
    moods: splitCsv(options.moods),
  });
}

interface CommercialPlaylistsOpts {
  limit?: string;
  region?: string;
}
export async function tiktokCommercialPlaylistsCommand(options: CommercialPlaylistsOpts = {}) {
  await scrape('SCRAPER_FETCH_TT_COMMERCIAL_PLAYLISTS', {
    limit: parseInt(options.limit || '20', 10),
    region: options.region || 'US',
  });
}

interface CommercialPlaylistDetailOpts {
  page?: string;
  limit?: string;
  region?: string;
}
export async function tiktokCommercialPlaylistDetailCommand(
  playlistId: string,
  options: CommercialPlaylistDetailOpts = {},
) {
  await scrape('SCRAPER_FETCH_TT_COMMERCIAL_PLAYLIST_DETAIL', {
    playlist_id: playlistId,
    page: parseInt(options.page || '1', 10),
    limit: parseInt(options.limit || '20', 10),
    region: options.region || 'US',
  });
}

interface TopProductsOpts {
  page?: string;
  last?: string;
  orderBy?: string;
  orderType?: string;
}
export async function tiktokTopProductsCommand(options: TopProductsOpts = {}) {
  await scrape('SCRAPER_FETCH_TT_TOP_PRODUCTS', {
    page: parseInt(options.page || '1', 10),
    last: parseInt(options.last || '7', 10),
    order_by: options.orderBy || 'post',
    order_type: options.orderType || 'desc',
  });
}

export async function tiktokTopProductDetailCommand(productId: string) {
  await scrape('SCRAPER_FETCH_TT_TOP_PRODUCT_DETAIL', { product_id: productId });
}

export async function tiktokTopProductMetricsCommand(productId: string) {
  await scrape('SCRAPER_FETCH_TT_TOP_PRODUCT_METRICS', { product_id: productId });
}

// ── TikTok Wave 6 — long-tail (place / effect / collection / comment-replies) ──
//
// Same www.tiktok.com auth as Wave 1-4. Place + Effect info call
// landing-page rehydration scripts whose namespace is a best-effort
// guess; the underlying scraper surfaces a structured error envelope on
// miss so callers can flag for follow-up reverse-engineering.

export async function tiktokPlaceInfoCommand(placeId: string) {
  await scrape('SCRAPER_FETCH_TT_PLACE_INFO', { placeId });
}

export async function tiktokPlacePostsCommand(
  placeId: string,
  options: { limit?: string; cursor?: string } = {},
) {
  await scrape('SCRAPER_FETCH_TT_PLACE_POSTS', {
    placeId,
    cursor: options.cursor || '',
    limit: parseInt(options.limit || '30', 10),
  });
}

export async function tiktokEffectInfoCommand(effectId: string) {
  await scrape('SCRAPER_FETCH_TT_EFFECT_INFO', { effectId });
}

export async function tiktokEffectPostsCommand(
  effectId: string,
  options: { limit?: string; cursor?: string } = {},
) {
  await scrape('SCRAPER_FETCH_TT_EFFECT_POSTS', {
    effectId,
    cursor: options.cursor || '',
    limit: parseInt(options.limit || '30', 10),
  });
}

export async function tiktokCollectionInfoCommand(collectionId: string) {
  await scrape('SCRAPER_FETCH_TT_COLLECTION_INFO', { collectionId });
}

export async function tiktokCollectionPostsCommand(
  collectionId: string,
  options: { limit?: string } = {},
) {
  // No cursor: tiktok-api23's /api/collection/posts sample paginates
  // by `count` only. The scraper returns has_more from the response;
  // if true, callers may need to bump count or wait on TikTok exposing
  // a cursor token.
  await scrape('SCRAPER_FETCH_TT_COLLECTION_POSTS', {
    collectionId,
    limit: parseInt(options.limit || '30', 10),
  });
}

export async function tiktokPostCommentRepliesCommand(
  video: string,
  commentId: string,
  options: { limit?: string; cursor?: string } = {},
) {
  await scrape('SCRAPER_FETCH_TT_POST_COMMENT_REPLIES', {
    video,
    comment_id: commentId,
    cursor: options.cursor || '',
    limit: parseInt(options.limit || '6', 10),
  });
}

// ── YouTube ──────────────────────────────────────────────────

export async function youtubeSearchCommand(query: string, options: { limit?: string; type?: string; upload?: string; sort?: string }) {
  await scrape('SCRAPER_SEARCH_YOUTUBE', {
    query, limit: parseInt(options.limit || '20', 10),
    type: options.type || '', upload: options.upload || '', sort: options.sort || '',
  });
}

export async function youtubeVideoCommand(url: string) {
  await scrape('SCRAPER_FETCH_YOUTUBE_VIDEO', { url });
}

export async function youtubeTranscriptCommand(url: string, options: { lang?: string } = {}) {
  await scrape('SCRAPER_FETCH_YOUTUBE_TRANSCRIPT', { url, lang: options.lang || '' });
}

export async function youtubeChannelDetailsCommand(channel: string) {
  await scrape('SCRAPER_FETCH_YOUTUBE_CHANNEL_DETAILS', { channel });
}

export async function youtubeChannelVideosCommand(
  channel: string,
  options: { filter?: string; limit?: string } = {},
) {
  await scrape('SCRAPER_FETCH_YOUTUBE_CHANNEL_VIDEOS', {
    channel,
    filter: options.filter || 'latest',
    limit: parseInt(options.limit || '30', 10),
  });
}

export async function youtubeTrendingCommand(options: { limit?: string } = {}) {
  await scrape('SCRAPER_FETCH_YOUTUBE_TRENDING', { limit: parseInt(options.limit || '30', 10) });
}

export async function youtubeChannelSearchCommand(
  channel: string,
  query: string,
  options: { limit?: string } = {},
) {
  await scrape('SCRAPER_SEARCH_YOUTUBE_CHANNEL', {
    channel,
    query,
    limit: parseInt(options.limit || '20', 10),
  });
}

export async function youtubeStreamingDataCommand(url: string) {
  await scrape('SCRAPER_FETCH_YOUTUBE_STREAMING_DATA', { url });
}

export async function youtubeRelatedCommand(url: string, options: { limit?: string } = {}) {
  await scrape('SCRAPER_FETCH_YOUTUBE_RELATED', { url, limit: parseInt(options.limit || '20', 10) });
}

export async function youtubeCommentsCommand(url: string, options: { limit?: string } = {}) {
  await scrape('SCRAPER_FETCH_YOUTUBE_COMMENTS', { url, limit: parseInt(options.limit || '50', 10) });
}

// ── Reddit ───────────────────────────────────────────────────

export async function redditSearchCommand(query: string, options: { limit?: string }) {
  await scrape('SCRAPER_SEARCH_REDDIT', { query, limit: parseInt(options.limit || '10', 10) });
}

export async function redditHotCommand(options: { limit?: string }) {
  await scrape('SCRAPER_FETCH_REDDIT_HOT', { limit: parseInt(options.limit || '20', 10) });
}

export async function redditPopularPostsCommand(options: { sort?: string; limit?: string } = {}) {
  await scrape('SCRAPER_FETCH_RD_POPULAR_POSTS', {
    sort: options.sort || 'hot',
    limit: parseInt(options.limit || '25', 10),
  });
}

export async function redditTopPopularPostsCommand(options: { time?: string; limit?: string } = {}) {
  await scrape('SCRAPER_FETCH_RD_TOP_POPULAR_POSTS', {
    time: options.time || 'day',
    limit: parseInt(options.limit || '25', 10),
  });
}

export async function redditRisingPopularPostsCommand(options: { limit?: string } = {}) {
  await scrape('SCRAPER_FETCH_RD_RISING_POPULAR_POSTS', {
    limit: parseInt(options.limit || '25', 10),
  });
}

export async function redditBestPopularPostsCommand(options: { limit?: string } = {}) {
  await scrape('SCRAPER_FETCH_RD_BEST_POPULAR_POSTS', {
    limit: parseInt(options.limit || '25', 10),
  });
}

export async function redditPopularPostsByCountryCommand(
  country: string,
  options: { sort?: string; time?: string; limit?: string } = {},
) {
  await scrape('SCRAPER_FETCH_RD_POPULAR_POSTS_BY_COUNTRY', {
    country,
    sort: options.sort || 'hot',
    time: options.time || 'day',
    limit: parseInt(options.limit || '25', 10),
  });
}

export async function redditPostsBySubredditCommand(
  subreddit: string,
  options: { sort?: string; time?: string; limit?: string } = {},
) {
  await scrape('SCRAPER_FETCH_RD_POSTS_BY_SUBREDDIT', {
    subreddit,
    sort: options.sort || 'hot',
    time: options.time || 'day',
    limit: parseInt(options.limit || '25', 10),
  });
}

export async function redditTopPostsBySubredditCommand(
  subreddit: string,
  options: { time?: string; limit?: string } = {},
) {
  await scrape('SCRAPER_FETCH_RD_TOP_POSTS_BY_SUBREDDIT', {
    subreddit,
    time: options.time || 'day',
    limit: parseInt(options.limit || '25', 10),
  });
}

export async function redditControversialPostsBySubredditCommand(
  subreddit: string,
  options: { time?: string; limit?: string } = {},
) {
  await scrape('SCRAPER_FETCH_RD_CONTROVERSIAL_POSTS_BY_SUBREDDIT', {
    subreddit,
    time: options.time || 'all',
    limit: parseInt(options.limit || '25', 10),
  });
}

export async function redditCommentsBySubredditCommand(
  subreddit: string,
  options: { limit?: string } = {},
) {
  await scrape('SCRAPER_FETCH_RD_COMMENTS_BY_SUBREDDIT', {
    subreddit,
    limit: parseInt(options.limit || '25', 10),
  });
}

export async function redditSubredditInfoCommand(subreddit: string) {
  await scrape('SCRAPER_FETCH_RD_SUBREDDIT_INFO', { subreddit });
}

export async function redditSubredditModeratorsCommand(subreddit: string) {
  await scrape('SCRAPER_FETCH_RD_SUBREDDIT_MODERATORS', { subreddit });
}

export async function redditSubredditRulesCommand(subreddit: string) {
  await scrape('SCRAPER_FETCH_RD_SUBREDDIT_RULES', { subreddit });
}

export async function redditSimilarSubredditsCommand(
  subreddit: string,
  options: { limit?: string } = {},
) {
  await scrape('SCRAPER_FETCH_RD_SIMILAR_SUBREDDITS', {
    subreddit,
    limit: parseInt(options.limit || '25', 10),
  });
}

export async function redditNewSubredditsCommand(options: { limit?: string } = {}) {
  await scrape('SCRAPER_FETCH_RD_NEW_SUBREDDITS', {
    limit: parseInt(options.limit || '25', 10),
  });
}

export async function redditPopularSubredditsCommand(options: { limit?: string } = {}) {
  await scrape('SCRAPER_FETCH_RD_POPULAR_SUBREDDITS', {
    limit: parseInt(options.limit || '25', 10),
  });
}

export async function redditPostsByUsernameCommand(
  username: string,
  options: { sort?: string; time?: string; limit?: string } = {},
) {
  await scrape('SCRAPER_FETCH_RD_POSTS_BY_USERNAME', {
    username,
    sort: options.sort || 'new',
    time: options.time || 'all',
    limit: parseInt(options.limit || '25', 10),
  });
}

export async function redditTopPostsByUsernameCommand(
  username: string,
  options: { time?: string; limit?: string } = {},
) {
  await scrape('SCRAPER_FETCH_RD_TOP_POSTS_BY_USERNAME', {
    username,
    time: options.time || 'all',
    limit: parseInt(options.limit || '25', 10),
  });
}

export async function redditCommentsByUsernameCommand(
  username: string,
  options: { sort?: string; time?: string; limit?: string } = {},
) {
  await scrape('SCRAPER_FETCH_RD_COMMENTS_BY_USERNAME', {
    username,
    sort: options.sort || 'new',
    time: options.time || 'all',
    limit: parseInt(options.limit || '25', 10),
  });
}

export async function redditTopCommentsByUsernameCommand(
  username: string,
  options: { time?: string; limit?: string } = {},
) {
  await scrape('SCRAPER_FETCH_RD_TOP_COMMENTS_BY_USERNAME', {
    username,
    time: options.time || 'all',
    limit: parseInt(options.limit || '25', 10),
  });
}

export async function redditUserOverviewCommand(
  username: string,
  options: { sort?: string; time?: string; limit?: string } = {},
) {
  await scrape('SCRAPER_FETCH_RD_USER_OVERVIEW', {
    username,
    sort: options.sort || 'new',
    time: options.time || 'all',
    limit: parseInt(options.limit || '25', 10),
  });
}

export async function redditUserPostRankInSubredditCommand(
  username: string,
  subreddit: string,
  options: { sort?: string; limit?: string } = {},
) {
  await scrape('SCRAPER_FETCH_RD_USER_POST_RANK_IN_SUBREDDIT', {
    username,
    subreddit,
    sort: options.sort || 'new',
    limit: parseInt(options.limit || '100', 10),
  });
}

export async function redditProfileCommand(username: string) {
  await scrape('SCRAPER_FETCH_RD_PROFILE', { username });
}

export async function redditUserStatsCommand(username: string) {
  await scrape('SCRAPER_FETCH_RD_USER_STATS', { username });
}

export async function redditSearchUsersCommand(query: string, options: { limit?: string } = {}) {
  await scrape('SCRAPER_SEARCH_RD_USERS', {
    query,
    limit: parseInt(options.limit || '25', 10),
  });
}

export async function redditSearchPostsCommand(
  query: string,
  options: { subreddit?: string; sort?: string; time?: string; limit?: string } = {},
) {
  await scrape('SCRAPER_SEARCH_RD_POSTS', {
    query,
    subreddit: options.subreddit || '',
    sort: options.sort || 'relevance',
    time: options.time || 'all',
    limit: parseInt(options.limit || '25', 10),
  });
}

export async function redditSearchSubredditsCommand(query: string, options: { limit?: string } = {}) {
  await scrape('SCRAPER_SEARCH_RD_SUBREDDITS', {
    query,
    limit: parseInt(options.limit || '25', 10),
  });
}

export async function redditPostDetailsCommand(postUrl: string) {
  await scrape('SCRAPER_FETCH_RD_POST_DETAILS', { post_url: postUrl });
}

export async function redditPostCommentsCommand(postUrl: string, options: { limit?: string } = {}) {
  await scrape('SCRAPER_FETCH_RD_POST_COMMENTS', {
    post_url: postUrl,
    limit: parseInt(options.limit || '50', 10),
  });
}

export async function redditPostCommentsWithSortCommand(
  postUrl: string,
  options: { sort?: string; limit?: string } = {},
) {
  await scrape('SCRAPER_FETCH_RD_POST_COMMENTS_WITH_SORT', {
    post_url: postUrl,
    sort: options.sort || 'best',
    limit: parseInt(options.limit || '50', 10),
  });
}

export async function redditPostDuplicatesCommand(postUrl: string, options: { limit?: string } = {}) {
  await scrape('SCRAPER_FETCH_RD_POST_DUPLICATES', {
    post_url: postUrl,
    limit: parseInt(options.limit || '25', 10),
  });
}

// ── Bilibili ─────────────────────────────────────────────────

export async function bilibiliSearchCommand(query: string, options: { limit?: string }) {
  await scrape('SCRAPER_SEARCH_BILIBILI', { query, limit: parseInt(options.limit || '10', 10) });
}

export async function bilibiliHotCommand(options: { limit?: string }) {
  await scrape('SCRAPER_FETCH_BILIBILI_HOT', { limit: parseInt(options.limit || '20', 10) });
}

export async function bilibiliRankingCommand(options: { limit?: string }) {
  await scrape('SCRAPER_FETCH_BILIBILI_RANKING', { limit: parseInt(options.limit || '20', 10) });
}

// ── Zhihu ────────────────────────────────────────────────────

export async function zhihuSearchCommand(query: string, options: { limit?: string }) {
  await scrape('SCRAPER_SEARCH_ZHIHU', { query, limit: parseInt(options.limit || '10', 10) });
}

export async function zhihuHotCommand(options: { limit?: string }) {
  await scrape('SCRAPER_FETCH_ZHIHU_HOT', { limit: parseInt(options.limit || '50', 10) });
}

// ── Xueqiu ───────────────────────────────────────────────────

export async function xueqiuSearchCommand(query: string, options: { limit?: string }) {
  await scrape('SCRAPER_SEARCH_XUEQIU', { query, limit: parseInt(options.limit || '10', 10) });
}

export async function xueqiuHotCommand(options: { limit?: string }) {
  await scrape('SCRAPER_FETCH_XUEQIU_HOT', { limit: parseInt(options.limit || '20', 10) });
}

// ── Instagram ────────────────────────────────────────────────

export async function instagramSearchCommand(query: string, options: { limit?: string }) {
  await scrape('SCRAPER_SEARCH_INSTAGRAM', { query, limit: parseInt(options.limit || '10', 10) });
}

export async function instagramExploreCommand(options: { limit?: string }) {
  await scrape('SCRAPER_FETCH_INSTAGRAM_EXPLORE', { limit: parseInt(options.limit || '20', 10) });
}

// ── Linux.do ─────────────────────────────────────────────────

export async function linuxdoSearchCommand(query: string, options: { limit?: string }) {
  await scrape('SCRAPER_SEARCH_LINUX_DO', { query, limit: parseInt(options.limit || '10', 10) });
}

// ── Jike ─────────────────────────────────────────────────────

export async function jikeSearchCommand(query: string, options: { limit?: string }) {
  await scrape('SCRAPER_SEARCH_JIKE', { query, limit: parseInt(options.limit || '10', 10) });
}

// ── Xiaohongshu ──────────────────────────────────────────────

export async function xiaohongshuSearchCommand(query: string, options: { limit?: string }) {
  await scrape('SCRAPER_SEARCH_XIAOHONGSHU', { query, limit: parseInt(options.limit || '10', 10) });
}

export async function xhsCreatorHotInspirationFeedCommand() {
  await scrape('SCRAPER_FETCH_XHS_CREATOR_HOT_INSPIRATION_FEED', {});
}

export async function xhsProductRecommendationsCommand(options: { region?: string; skuId?: string } = {}) {
  await scrape('SCRAPER_FETCH_XHS_PRODUCT_RECOMMENDATIONS', { region: options.region, sku_id: options.skuId });
}

export async function xhsTopicInfoCommand(options: { source?: string; pageId?: string } = {}) {
  await scrape('SCRAPER_FETCH_XHS_TOPIC_INFO', { source: options.source, page_id: options.pageId });
}

export async function xhsNoteCommentsCommand(options: { index?: string; cursor?: string; noteId?: string; shareText?: string; sortStrategy?: string; limit?: string } = {}) {
  await scrape('SCRAPER_FETCH_XHS_NOTE_COMMENTS', {
    index: parseInt(options.index || '1', 10),
    cursor: options.cursor || '',
    note_id: options.noteId || '',
    share_text: options.shareText || '',
    sort_strategy: options.sortStrategy || '',
    limit: parseInt(options.limit || '20', 10),
  });
}

export async function xhsSearchGroupsCommand(keyword: string, options: { source?: string; searchId?: string } = {}) {
  await scrape('SCRAPER_SEARCH_XHS_GROUPS', { keyword, source: options.source, search_id: options.searchId });
}

export async function xhsProductReviewsCommand(options: { skuId?: string; fromPage?: string } = {}) {
  await scrape('SCRAPER_FETCH_XHS_PRODUCT_REVIEWS', { sku_id: options.skuId, from_page: options.fromPage });
}

export async function xhsTopicFeedCommand(options: { sort?: string; source?: string; pageId?: string } = {}) {
  await scrape('SCRAPER_FETCH_XHS_TOPIC_FEED', { sort: options.sort, source: options.source, page_id: options.pageId });
}

export async function xhsMixedNoteDetailCommand(options: { noteId?: string; shareText?: string } = {}) {
  await scrape('SCRAPER_FETCH_XHS_MIXED_NOTE_DETAIL', { note_id: options.noteId, share_text: options.shareText });
}

export async function xhsSearchNotesCommand(keyword: string, options: { page?: string; source?: string; noteType?: string; sortType?: string; timeFilter?: string; limit?: string } = {}) {
  await scrape('SCRAPER_SEARCH_XHS_NOTES', {
    keyword,
    page: parseInt(options.page || '1', 10),
    source: options.source || 'explore_feed',
    note_type: options.noteType,
    sort_type: options.sortType,
    time_filter: options.timeFilter,
    limit: parseInt(options.limit || '20', 10),
  });
}

export async function xhsProductDetailCommand(options: { skuId?: string; source?: string; prePage?: string } = {}) {
  await scrape('SCRAPER_FETCH_XHS_PRODUCT_DETAIL', { sku_id: options.skuId, source: options.source, pre_page: options.prePage });
}

export async function xhsProductReviewOverviewCommand(options: { tab?: string; skuId?: string } = {}) {
  await scrape('SCRAPER_FETCH_XHS_PRODUCT_REVIEW_OVERVIEW', { tab: options.tab, sku_id: options.skuId });
}

export async function xhsCreatorInspirationFeedCommand(options: { source?: string } = {}) {
  await scrape('SCRAPER_FETCH_XHS_CREATOR_INSPIRATION_FEED', { source: options.source });
}

export async function xhsImageNoteDetailCommand(options: { noteId?: string; shareText?: string } = {}) {
  await scrape('SCRAPER_FETCH_XHS_IMAGE_NOTE_DETAIL', { note_id: options.noteId, share_text: options.shareText });
}

export async function xhsSearchUsersCommand(keyword: string, options: { page?: string; source?: string } = {}) {
  await scrape('SCRAPER_SEARCH_XHS_USERS', { keyword, page: parseInt(options.page || '1', 10), source: options.source });
}

export async function xhsSearchImagesCommand(keyword: string, options: { page?: string; source?: string; limit?: string } = {}) {
  await scrape('SCRAPER_SEARCH_XHS_IMAGES', {
    keyword,
    page: parseInt(options.page || '1', 10),
    source: options.source,
    limit: parseInt(options.limit || '20', 10),
  });
}

export async function xhsSearchProductsCommand(keyword: string, options: { page?: string; source?: string } = {}) {
  await scrape('SCRAPER_SEARCH_XHS_PRODUCTS', { keyword, page: parseInt(options.page || '1', 10), source: options.source });
}

export async function xhsUserFavedNotesCommand() {
  await scrape('SCRAPER_FETCH_XHS_USER_FAVED_NOTES', {});
}

// ── Weibo ────────────────────────────────────────────────────

export async function weiboSearchCommand(query: string, options: { limit?: string }) {
  await scrape('SCRAPER_SEARCH_WEIBO', { query, limit: parseInt(options.limit || '10', 10) });
}

export async function weiboHotCommand(options: { limit?: string }) {
  await scrape('SCRAPER_FETCH_WEIBO_HOT', { limit: parseInt(options.limit || '50', 10) });
}

// ── Douban ───────────────────────────────────────────────────

export async function doubanSearchCommand(query: string, options: { limit?: string }) {
  await scrape('SCRAPER_SEARCH_DOUBAN', { query, limit: parseInt(options.limit || '10', 10) });
}

export async function doubanMovieHotCommand(options: { limit?: string }) {
  await scrape('SCRAPER_FETCH_DOUBAN_MOVIE_HOT', { limit: parseInt(options.limit || '20', 10) });
}

export async function doubanBookHotCommand(options: { limit?: string }) {
  await scrape('SCRAPER_FETCH_DOUBAN_BOOK_HOT', { limit: parseInt(options.limit || '20', 10) });
}

export async function doubanTop250Command(options: { limit?: string }) {
  await scrape('SCRAPER_FETCH_DOUBAN_TOP250', { limit: parseInt(options.limit || '20', 10) });
}

// ── Medium ───────────────────────────────────────────────────

export async function mediumSearchCommand(query: string, options: { limit?: string }) {
  await scrape('SCRAPER_SEARCH_MEDIUM', { query, limit: parseInt(options.limit || '10', 10) });
}

// ── Google ───────────────────────────────────────────────────

export async function googleSearchCommand(query: string, options: { limit?: string }) {
  await scrape('SCRAPER_SEARCH_GOOGLE', { query, limit: parseInt(options.limit || '10', 10) });
}

export async function googleNewsCommand(query: string, options: { limit?: string }) {
  await scrape('SCRAPER_SEARCH_GOOGLE_NEWS', { query, limit: parseInt(options.limit || '10', 10) });
}

// ── Facebook ─────────────────────────────────────────────────

export async function facebookSearchCommand(query: string, options: { limit?: string }) {
  await scrape('SCRAPER_SEARCH_FACEBOOK', { query, limit: parseInt(options.limit || '10', 10) });
}

// ── LinkedIn ─────────────────────────────────────────────────

export async function linkedinSearchCommand(query: string, options: { limit?: string }) {
  await scrape('SCRAPER_SEARCH_LINKEDIN', { query, limit: parseInt(options.limit || '10', 10) });
}

// ── 36Kr ─────────────────────────────────────────────────────

export async function kr36SearchCommand(query: string, options: { limit?: string }) {
  await scrape('SCRAPER_SEARCH_36KR', { query, limit: parseInt(options.limit || '10', 10) });
}

export async function kr36HotCommand(options: { limit?: string }) {
  await scrape('SCRAPER_FETCH_36KR_HOT', { limit: parseInt(options.limit || '20', 10) });
}

export async function kr36NewsCommand(options: { limit?: string }) {
  await scrape('SCRAPER_FETCH_36KR_NEWS', { limit: parseInt(options.limit || '20', 10) });
}

// ── ProductHunt ──────────────────────────────────────────────

export async function producthuntHotCommand(options: { limit?: string }) {
  await scrape('SCRAPER_FETCH_PRODUCTHUNT', { limit: parseInt(options.limit || '20', 10) });
}

// ── Yahoo Finance ────────────────────────────────────────────

export async function yahooFinanceQuoteCommand(symbol: string) {
  await scrape('SCRAPER_FETCH_YAHOO_FINANCE', { symbol });
}
