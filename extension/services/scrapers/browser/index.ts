/**
 * Browser-based scrapers — use chrome.debugger (CDP Runtime.evaluate) to call
 * internal APIs with the user's browser cookies.
 */

export {
  searchReddit,
  fetchRedditHot,
  redditUpvote,
  redditSave,
  getRedditFrontpage,
  getRedditPost,
  getRedditUser,
  redditSubscribe,
  getRedditPopularPosts,
  getRedditTopPopularPosts,
  getRedditRisingPopularPosts,
  getRedditBestPopularPosts,
  getRedditPopularPostsByCountry,
  getRedditPostsBySubreddit,
  getRedditTopPostsBySubreddit,
  getRedditControversialPostsBySubreddit,
  getRedditCommentsBySubreddit,
  getRedditSubredditInfo,
  getRedditSubredditRules,
  getRedditSimilarSubreddits,
  getRedditNewSubreddits,
  getRedditPopularSubreddits,
  getRedditPostsByUsername,
  getRedditTopPostsByUsername,
  getRedditCommentsByUsername,
  getRedditTopCommentsByUsername,
  getRedditUserOverview,
  getRedditUserPostRankInSubreddit,
  getRedditProfile,
  getRedditUserStats,
  searchRedditUsers,
  searchRedditPosts,
  searchRedditSubreddits,
  getRedditPostDetails,
  getRedditPostComments,
  getRedditPostCommentsWithSort,
  getRedditPostDuplicates,
} from './reddit';
export type {
  RedditResult,
  RedditHotResult,
  RedditPost,
  RedditComment,
  RedditSubreddit,
  RedditUser,
  RedditListingResult,
  RedditPostThread,
} from './reddit';

export { searchBilibili, fetchBilibiliHot, fetchBilibiliRanking, getBilibiliDynamic, getBilibiliHistory, getBilibiliFollowing, getBilibiliUserVideos, getBilibiliComments } from './bilibili';
export type { BilibiliResult, BilibiliHotResult, BilibiliRankingResult } from './bilibili';

export { searchZhihu, fetchZhihuHot, likeZhihu, getZhihuQuestion } from './zhihu';
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
export {
  xhsGetCreatorHotInspirationFeed,
  xhsGetProductRecommendations,
  xhsGetTopicInfo,
  xhsGetNoteComments,
  xhsSearchGroups,
  xhsGetProductReviews,
  xhsGetTopicFeed,
  xhsGetMixedNoteDetail,
  xhsSearchNotes,
  xhsGetProductDetail,
  xhsGetProductReviewOverview,
  xhsGetCreatorInspirationFeed,
  xhsGetImageNoteDetail,
  xhsSearchUsers,
  xhsSearchImages,
  xhsSearchProducts,
  xhsGetUserFavedNotes,
} from './xiaohongshu-app-v2';
export type { XiaohongshuEnvelope, XiaohongshuNoteDetail, XiaohongshuComment } from './xiaohongshu-app-v2';

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

export { getTwitterTimeline, searchTwitter, getTwitterTrending, getTwitterProfile, getTwitterBookmarks, getTwitterUserTweets, getTwitterThread, getTwitterNotifications } from './twitter';

export {
  getYouTubeVideoDetails,
  getYouTubeChannelDetails,
  getYouTubeChannelVideos,
  getYouTubeTrending,
  searchYouTubeChannel,
  getYouTubeStreamingData,
  getYouTubeRelatedVideos,
  getYouTubeComments,
  getYouTubeTranscript,
  parseYouTubeVideoId,
} from './youtube';
export type {
  YouTubeVideoDetails,
  YouTubeChannelDetails,
  YouTubeChannelVideo,
  YouTubeChannelVideosFilter,
  YouTubeTrendingVideo,
  YouTubeChannelSearchResult,
  YouTubeStreamingFormat,
  YouTubeStreamingData,
  YouTubeRelatedVideo,
  YouTubeComment,
  YouTubeTranscriptLine,
  YouTubeTranscript,
} from './youtube';

export {
  getTikTokUserPosts,
  getTikTokUserFollowers,
  getTikTokPostDetail,
  getTikTokPostComments,
  searchTikTokAccount,
  parseTikTokVideoId,
  // Wave 2 — Challenge + Music
  getTikTokChallengeInfo,
  getTikTokChallengePosts,
  getTikTokMusicInfo,
  getTikTokMusicPosts,
  getTikTokMusicUnlimitedSounds,
  // Wave 3 — User extras
  getTikTokUserInfoWithRegion,
  getTikTokUserInfoById,
  getTikTokUserFollowings,
  getTikTokUserLikedPosts,
  getTikTokUserPlaylist,
  getTikTokUserRepost,
  getTikTokUserStory,
  // Wave 4 — Search + Discovery
  searchTikTokGeneral,
  searchTikTokLive,
  getTikTokOthersSearchedFor,
  getTikTokPostRelated,
  getTikTokPostExplore,
  getTikTokPostDiscover,
  // Wave 6 — Place / Effect / Collection / Comment-replies
  getTikTokPlaceInfo,
  getTikTokPlacePosts,
  getTikTokEffectInfo,
  getTikTokEffectPosts,
  getTikTokCollectionInfo,
  getTikTokCollectionPosts,
  getTikTokPostCommentReplies,
} from './tiktok';
export type {
  TikTokVideo,
  TikTokUserPostsResult,
  TikTokUserSummary,
  TikTokUserListResult,
  TikTokPostDetail,
  TikTokComment,
  TikTokCommentsResult,
  TikTokAccountSearchResult,
  // Wave 2
  TikTokChallengeInfo,
  TikTokChallengePostsResult,
  TikTokMusicInfo,
  TikTokMusicPostsResult,
  TikTokUnlimitedSoundsResult,
  // Wave 3
  TikTokUserInfo,
  TikTokUserInfoWithRegion,
  TikTokPlaylist,
  TikTokUserPlaylistResult,
  TikTokRepostResult,
  TikTokStory,
  TikTokStoryResult,
  // Wave 4
  TikTokHashtagSummary,
  TikTokMusicSummary,
  TikTokGeneralSearchResult,
  TikTokLiveStream,
  TikTokLiveSearchResult,
  TikTokSuggestionsResult,
  TikTokPostRelatedResult,
  TikTokPostExploreResult,
  TikTokPostDiscoverResult,
  // Wave 6
  TikTokPlaceInfo,
  TikTokPlacePostsResult,
  TikTokEffectInfo,
  TikTokEffectPostsResult,
  TikTokCollectionInfo,
  TikTokCollectionPostsResult,
  TikTokPostCommentRepliesResult,
} from './tiktok';

// ─── Douyin (抖音) — TikTok's Chinese sibling on douyin.com ───────────
export {
  getDouyinUserInfo,
  getDouyinUserPosts,
  getDouyinUserLikedPosts,
  getDouyinUserFollowers,
  getDouyinUserFollowing,
  getDouyinPostComments,
  searchDouyinGeneral,
  searchDouyinVideo,
  searchDouyinAccount,
  searchDouyinLive,
  getDouyinChallengePosts,
  getDouyinMusicPosts,
} from './douyin';
export type {
  DouyinVideo,
  DouyinUser,
  DouyinUserSummary,
  DouyinComment,
  DouyinListResult,
  DouyinVideoListResult,
  DouyinUserListResult,
  DouyinCommentListResult,
  DouyinLiveStream,
  DouyinLiveListResult,
  DouyinGeneralSearchResult,
} from './douyin';

// ─── TikTok Wave 5 — Creative Center (ads.tiktok.com) ────────────────
//
// SEPARATE host from regular tiktok.com — requires TikTok For Business
// login. Each function lands on a creativecenter page, checks for the
// login bounce, then page-context fetches `/creative_radar_api/v1/*`.
//
// All return a raw envelope (the radar API's own JSON) — no schema
// remap yet because we can't easily verify the live payload shape
// without a TikTok Business account.
export {
  getTikTokAdsDetail,
  getTikTokAdsTop,
  getTikTokTrendingCreator,
  getTikTokTrendingVideo,
  getTikTokTrendingHashtag,
  getTikTokTrendingSong,
  getTikTokTrendingKeyword,
  getTikTokTrendingKeywordPosts,
  getTikTokTrendingKeywordSentence,
  getTikTokCommercialMusicLibrary,
  getTikTokCommercialMusicPlaylists,
  getTikTokCommercialMusicPlaylistDetail,
  getTikTokTopProducts,
  getTikTokTopProductDetail,
  getTikTokTopProductMetrics,
} from './tiktok-ads';
