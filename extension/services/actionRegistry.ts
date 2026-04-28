/**
 * Action Registry
 * 注册所有 Action 定义
 */

import { ActionDefinition } from '../types/action';

// ============================================
// 导航类 Actions
// ============================================

export const NAVIGATE_TO_TWEET: ActionDefinition = {
  id: 'navigate_to_tweet',
  name: 'Navigate to Tweet',
  nameKey: 'actions.navigateToTweet',
  category: 'navigation',
  trigger: 'both',
  parameters: [
    { name: 'tweetUrl', type: 'string', required: true, description: '推文 URL' }
  ],
  timeout: 10000
};

export const NAVIGATE_TO_URL: ActionDefinition = {
  id: 'navigate_to_url',
  name: 'Navigate to URL',
  nameKey: 'actions.navigateToUrl',
  category: 'navigation',
  trigger: 'both',
  parameters: [
    { name: 'url', type: 'string', required: true, description: '目标 URL' }
  ],
  timeout: 10000
};

export const NAVIGATE_TO_BOOKMARKS: ActionDefinition = {
  id: 'navigate_to_bookmarks',
  name: 'Navigate to Bookmarks',
  nameKey: 'actions.navigateToBookmarks',
  category: 'navigation',
  trigger: 'both',
  parameters: [],
  timeout: 10000
};

export const NAVIGATE_TO_NOTIFICATIONS: ActionDefinition = {
  id: 'navigate_to_notifications',
  name: 'Navigate to Notifications',
  nameKey: 'actions.navigateToNotifications',
  category: 'navigation',
  trigger: 'both',
  parameters: [],
  timeout: 10000
};

export const NAVIGATE_TO_SEARCH: ActionDefinition = {
  id: 'navigate_to_search',
  name: 'Navigate to Search',
  nameKey: 'actions.navigateToSearch',
  category: 'navigation',
  trigger: 'both',
  parameters: [
    { name: 'query', type: 'string', required: false, description: '搜索关键词' },
    { name: 'filters', type: 'object', required: false, description: '搜索过滤器' }
  ],
  timeout: 10000
};

export const RETURN_TO_TIMELINE: ActionDefinition = {
  id: 'return_to_timeline',
  name: 'Return to Timeline',
  nameKey: 'actions.returnToTimeline',
  category: 'navigation',
  trigger: 'both',
  parameters: [],
  timeout: 10000
};

export const NAVIGATE_TO_GROK: ActionDefinition = {
  id: 'navigate_to_grok',
  name: 'Navigate to Grok',
  nameKey: 'actions.navigateToGrok',
  category: 'navigation',
  trigger: 'both',
  parameters: [],
  timeout: 10000
};

export const NAVIGATE_TO_COMPOSE_ARTICLE: ActionDefinition = {
  id: 'navigate_to_compose_article',
  name: 'Navigate to Compose Article',
  nameKey: 'actions.navigateToComposeArticle',
  category: 'navigation',
  trigger: 'both',
  parameters: [],
  timeout: 10000
};

export const NAVIGATE_TO_COMMUNITIES: ActionDefinition = {
  id: 'navigate_to_communities',
  name: 'Navigate to Communities',
  nameKey: 'actions.navigateToCommunities',
  category: 'navigation',
  trigger: 'both',
  parameters: [
    { name: 'username', type: 'string', required: false, description: '用户名（可选，不传则自动从页面获取）' }
  ],
  timeout: 10000
};

export const NAVIGATE_TO_FOLLOWING: ActionDefinition = {
  id: 'navigate_to_following',
  name: 'Navigate to Following Timeline',
  category: 'navigation',
  trigger: 'both',
  parameters: [],
  timeout: 10000
};

// ============================================
// 回复类 Actions
// ============================================

export const OPEN_REPLY_COMPOSER: ActionDefinition = {
  id: 'open_reply_composer',
  name: 'Open Reply Composer',
  nameKey: 'actions.openReplyComposer',
  category: 'reply',
  trigger: 'both',
  parameters: [],
  timeout: 5000
};

export const FILL_REPLY_TEXT: ActionDefinition = {
  id: 'fill_reply_text',
  name: 'Fill Reply Text',
  nameKey: 'actions.fillReply',
  category: 'reply',
  trigger: 'both',
  parameters: [
    { name: 'content', type: 'string', required: true, description: '回复内容' },
    { name: 'highlight', type: 'boolean', required: false, default: true, description: '是否高亮显示' }
  ],
  timeout: 5000
};

export const UPLOAD_IMAGE_TO_REPLY: ActionDefinition = {
  id: 'upload_image_to_reply',
  name: 'Upload Image to Reply',
  nameKey: 'actions.uploadImage',
  category: 'reply',
  trigger: 'both',
  parameters: [
    { name: 'imageData', type: 'string', required: true, description: '图片数据 (base64)' }
  ],
  timeout: 30000
};

export const SUBMIT_REPLY: ActionDefinition = {
  id: 'submit_reply',
  name: 'Submit Reply',
  nameKey: 'actions.submitReply',
  category: 'reply',
  trigger: 'both',
  parameters: [
    { name: 'waitForSuccess', type: 'boolean', required: false, default: true, description: '等待发布成功' }
  ],
  timeout: 30000
};

// ============================================
// 发推类 Actions
// ============================================

export const OPEN_TWEET_COMPOSER: ActionDefinition = {
  id: 'open_tweet_composer',
  name: 'Open Tweet Composer',
  nameKey: 'actions.openComposer',
  category: 'tweet',
  trigger: 'both',
  parameters: [],
  timeout: 5000
};

export const POST_TWEET: ActionDefinition = {
  id: 'post_tweet',
  name: 'Post Tweet',
  nameKey: 'actions.postTweet',
  category: 'tweet',
  trigger: 'both',
  parameters: [
    { name: 'text', type: 'string', required: true, description: '推文内容' },
    { name: 'media', type: 'array', required: false, description: '媒体数组' }
  ],
  timeout: 60000
};

export const POST_THREAD: ActionDefinition = {
  id: 'post_thread',
  name: 'Post Thread',
  nameKey: 'actions.postThread',
  category: 'tweet',
  trigger: 'both',
  parameters: [
    { name: 'tweets', type: 'array', required: true, description: '推文数组 [{ text, media? }]' }
  ],
  timeout: 120000
};

export const CLOSE_COMPOSER: ActionDefinition = {
  id: 'close_composer',
  name: 'Close Tweet Composer',
  nameKey: 'actions.closeComposer',
  category: 'tweet',
  trigger: 'both',
  parameters: [
    { name: 'save', type: 'boolean', required: false, default: false, description: '保存为草稿 (true) 或放弃 (false)' }
  ],
  timeout: 10000
};

// ============================================
// 文章类 Actions
// ============================================

export const OPEN_ARTICLE_EDITOR: ActionDefinition = {
  id: 'open_article_editor',
  name: 'Open Article Editor',
  nameKey: 'actions.openArticleEditor',
  category: 'article',
  trigger: 'both',
  parameters: [],
  timeout: 10000
};

export const FILL_ARTICLE_TITLE: ActionDefinition = {
  id: 'fill_article_title',
  name: 'Fill Article Title',
  nameKey: 'actions.fillArticleTitle',
  category: 'article',
  trigger: 'both',
  parameters: [
    { name: 'title', type: 'string', required: true, description: '文章标题' }
  ],
  timeout: 5000
};

export const FILL_ARTICLE_BODY: ActionDefinition = {
  id: 'fill_article_body',
  name: 'Fill Article Body',
  nameKey: 'actions.fillArticleBody',
  category: 'article',
  trigger: 'both',
  parameters: [
    { name: 'content', type: 'string', required: true, description: '文章正文' },
    { name: 'format', type: 'string', required: false, default: 'plain', description: 'plain|markdown|html' }
  ],
  timeout: 10000
};

export const UPLOAD_ARTICLE_HEADER_IMAGE: ActionDefinition = {
  id: 'upload_article_header_image',
  name: 'Upload Article Header Image',
  nameKey: 'actions.uploadArticleHeaderImage',
  category: 'article',
  trigger: 'both',
  parameters: [
    { name: 'imageData', type: 'string', required: true, description: '图片数据 (base64)' }
  ],
  timeout: 30000
};

export const PUBLISH_ARTICLE: ActionDefinition = {
  id: 'publish_article',
  name: 'Publish Article',
  nameKey: 'actions.publishArticle',
  category: 'article',
  trigger: 'both',
  parameters: [
    { name: 'asDraft', type: 'boolean', required: false, default: false, description: '保存为草稿' }
  ],
  timeout: 30000
};

// ============================================
// 抓取类 Actions
// ============================================

export const SCRAPE_TIMELINE: ActionDefinition = {
  id: 'scrape_timeline',
  name: 'Scrape Timeline',
  nameKey: 'actions.scrapeTimeline',
  category: 'scrape',
  trigger: 'both',
  parameters: [
    { name: 'limit', type: 'number', required: false, default: 10, description: '抓取数量' },
    { name: 'scrollAttempts', type: 'number', required: false, default: 5, description: '滚动尝试次数' }
  ],
  timeout: 60000
};

export const SCRAPE_BOOKMARKS: ActionDefinition = {
  id: 'scrape_bookmarks',
  name: 'Scrape Bookmarks',
  nameKey: 'actions.scrapeBookmarks',
  category: 'scrape',
  trigger: 'both',
  parameters: [
    { name: 'limit', type: 'number', required: false, default: 20, description: '抓取数量' }
  ],
  timeout: 60000
};

export const SCRAPE_CURRENT_VIEW: ActionDefinition = {
  id: 'scrape_current_view',
  name: 'Scrape Current View',
  nameKey: 'actions.scrapeCurrentView',
  category: 'scrape',
  trigger: 'both',
  parameters: [],
  timeout: 10000
};

export const SCRAPE_SEARCH_RESULTS: ActionDefinition = {
  id: 'scrape_search_results',
  name: 'Scrape Search Results',
  nameKey: 'actions.scrapeSearchResults',
  category: 'scrape',
  trigger: 'both',
  parameters: [
    { name: 'query', type: 'string', required: false, description: '搜索关键词' },
    { name: 'tab', type: 'string', required: false, description: '搜索 tab: live/user/image/list' },
    { name: 'limit', type: 'number', required: false, default: 20, description: '抓取数量' }
  ],
  timeout: 120000
};

export const FETCH_WECHAT_ARTICLE: ActionDefinition = {
  id: 'fetch_wechat_article',
  name: 'Fetch WeChat Article',
  nameKey: 'actions.fetchWechatArticle',
  category: 'scrape',
  trigger: 'backend',
  parameters: [
    { name: 'url', type: 'string', required: true, description: '微信公众号文章链接' }
  ],
  timeout: 30000
};

// FETCH_TIKTOK_VIDEO removed — backend interrupt flow for the abandoned
// republish path. CLI's `bnbot tiktok search` (read-only) still works
// via scraperService.

// FETCH_XIAOHONGSHU_NOTE removed — backend interrupt flow for the
// abandoned XHS republish path. The new XHS publish feature (task #66)
// will use a different action shape.

export const SCRAPE_THREAD: ActionDefinition = {
  id: 'scrape_thread',
  name: 'Scrape Thread',
  category: 'scrape',
  trigger: 'both',
  parameters: [
    { name: 'maxScrolls', type: 'number', required: false, default: 10, description: '最大滚动次数' }
  ],
  timeout: 60000
};

export const SCRAPE_USER_PROFILE: ActionDefinition = {
  id: 'scrape_user_profile',
  name: 'Scrape User Profile',
  nameKey: 'actions.scrapeUserProfile',
  category: 'scrape',
  trigger: 'both',
  parameters: [
    { name: 'username', type: 'string', required: true, description: '用户名' }
  ],
  timeout: 15000
};

export const SCRAPE_USER_TWEETS: ActionDefinition = {
  id: 'scrape_user_tweets',
  name: 'Scrape User Tweets',
  nameKey: 'actions.scrapeUserTweets',
  category: 'scrape',
  trigger: 'both',
  parameters: [
    { name: 'username', type: 'string', required: true, description: '用户名' },
    { name: 'limit', type: 'number', required: false, default: 20, description: '抓取数量' },
    { name: 'scrollAttempts', type: 'number', required: false, default: 5, description: '滚动次数' }
  ],
  timeout: 60000
};

export const SCRAPE_FOLLOWERS: ActionDefinition = {
  id: 'scrape_followers',
  name: 'Scrape Followers',
  nameKey: 'actions.scrapeFollowers',
  category: 'scrape',
  trigger: 'both',
  parameters: [
    { name: 'username', type: 'string', required: true, description: '用户名' },
    { name: 'limit', type: 'number', required: false, default: 20, description: '抓取数量' },
    { name: 'scrollAttempts', type: 'number', required: false, default: 5, description: '滚动次数' }
  ],
  timeout: 60000
};

export const SCRAPE_FOLLOWING: ActionDefinition = {
  id: 'scrape_following',
  name: 'Scrape Following',
  nameKey: 'actions.scrapeFollowing',
  category: 'scrape',
  trigger: 'both',
  parameters: [
    { name: 'username', type: 'string', required: true, description: '用户名' },
    { name: 'limit', type: 'number', required: false, default: 20, description: '抓取数量' },
    { name: 'scrollAttempts', type: 'number', required: false, default: 5, description: '滚动次数' }
  ],
  timeout: 60000
};

export const ACCOUNT_ANALYTICS: ActionDefinition = {
  id: 'account_analytics',
  name: 'Account Analytics',
  nameKey: 'actions.accountAnalytics',
  category: 'scrape',
  trigger: 'both',
  parameters: [
    { name: 'fromTime', type: 'string', required: true, description: '开始时间 (ISO格式)' },
    { name: 'toTime', type: 'string', required: true, description: '结束时间 (ISO格式)' },
    { name: 'granularity', type: 'string', required: false, default: 'Daily', description: 'Daily/Weekly/Monthly' }
  ],
  timeout: 30000
};

export const POST_IMPRESSIONS: ActionDefinition = {
  id: 'post_impressions',
  name: 'Post Impressions',
  nameKey: 'actions.postImpressions',
  category: 'scrape',
  trigger: 'both',
  parameters: [
    { name: 'fromTime', type: 'string', required: true, description: '开始时间 (ISO格式)' },
    { name: 'toTime', type: 'string', required: true, description: '结束时间 (ISO格式)' }
  ],
  timeout: 60000
};

export const REPLY_IMPRESSIONS: ActionDefinition = {
  id: 'reply_impressions',
  name: 'Reply Impressions',
  nameKey: 'actions.replyImpressions',
  category: 'scrape',
  trigger: 'both',
  parameters: [
    { name: 'fromTime', type: 'string', required: true, description: '开始时间 (ISO格式)' },
    { name: 'toTime', type: 'string', required: true, description: '结束时间 (ISO格式)' }
  ],
  timeout: 60000
};

// ============================================
// 通知类 Actions
// ============================================

export const PROCESS_NOTIFICATIONS: ActionDefinition = {
  id: 'process_notifications',
  name: 'Process Notifications',
  nameKey: 'actions.processNotifications',
  category: 'notification',
  trigger: 'both',
  parameters: [
    { name: 'limit', type: 'number', required: false, default: 3, description: '处理数量' },
    { name: 'keywords', type: 'array', required: false, description: '过滤关键词' }
  ],
  timeout: 60000
};

export const CLICK_NOTIFICATION: ActionDefinition = {
  id: 'click_notification',
  name: 'Click Notification',
  nameKey: 'actions.clickNotification',
  category: 'notification',
  trigger: 'both',
  parameters: [
    { name: 'keywords', type: 'array', required: false, description: '匹配关键词' },
    { name: 'highlight', type: 'boolean', required: false, default: true, description: '是否高亮' }
  ],
  timeout: 10000
};

// ============================================
// 搜索类 Actions
// ============================================

export const ADVANCED_SEARCH: ActionDefinition = {
  id: 'advanced_search',
  name: 'Advanced Search',
  nameKey: 'actions.advancedSearch',
  category: 'search',
  trigger: 'both',
  parameters: [
    { name: 'query', type: 'string', required: true, description: '搜索关键词' },
    { name: 'filters', type: 'object', required: false, description: '高级过滤器' },
    { name: 'limit', type: 'number', required: false, default: 50, description: '抓取数量' }
  ],
  timeout: 180000  // 3 minutes for scraping tweets
};

// ============================================
// 刷推类 Actions
// ============================================

export const SCROLL_AND_COLLECT: ActionDefinition = {
  id: 'scroll_and_collect',
  name: 'Scroll and Collect',
  nameKey: 'actions.scrollAndCollect',
  category: 'scroll',
  trigger: 'both',
  parameters: [
    { name: 'count', type: 'number', required: false, default: 10, description: '收集数量' },
    { name: 'batchSize', type: 'number', required: false, default: 5, description: '批次大小' },
    { name: 'maxScrolls', type: 'number', required: false, default: 20, description: '最大滚动次数' }
  ],
  timeout: 120000
};

export const CONTINUOUS_SCROLL: ActionDefinition = {
  id: 'continuous_scroll',
  name: 'Continuous Scroll',
  nameKey: 'actions.continuousScroll',
  category: 'scroll',
  trigger: 'both',
  parameters: [
    { name: 'stopCondition', type: 'string', required: true, description: 'count|time|noNew' },
    { name: 'maxDuration', type: 'number', required: false, default: 60000, description: '最大时长(ms)' },
    { name: 'targetCount', type: 'number', required: false, default: 50, description: '目标数量' }
  ],
  timeout: 120000
};

// ============================================
// 互动类 Actions
// ============================================

export const LIKE_TWEET: ActionDefinition = {
  id: 'like_tweet',
  name: 'Like Tweet',
  nameKey: 'actions.likeTweet',
  category: 'tweet',
  trigger: 'both',
  parameters: [],
  timeout: 10000
};

export const RETWEET: ActionDefinition = {
  id: 'retweet',
  name: 'Retweet',
  nameKey: 'actions.retweet',
  category: 'tweet',
  trigger: 'both',
  parameters: [],
  timeout: 10000
};

export const FOLLOW_USER: ActionDefinition = {
  id: 'follow_user',
  name: 'Follow User',
  nameKey: 'actions.followUser',
  category: 'tweet',
  trigger: 'both',
  parameters: [
    { name: 'username', type: 'string', required: false, description: '用户名（可选，提供则跳转到用户主页关注）' }
  ],
  timeout: 15000
};

export const QUOTE_TWEET: ActionDefinition = {
  id: 'quote_tweet',
  name: 'Quote Tweet',
  nameKey: 'actions.quoteTweet',
  category: 'tweet',
  trigger: 'both',
  parameters: [
    { name: 'text', type: 'string', required: true, description: '引用文本' }
  ],
  timeout: 30000
};

export const UNLIKE_TWEET: ActionDefinition = {
  id: 'unlike_tweet',
  name: 'Unlike Tweet',
  nameKey: 'actions.unlikeTweet',
  category: 'tweet',
  trigger: 'both',
  parameters: [],
  timeout: 10000
};

export const UNRETWEET: ActionDefinition = {
  id: 'unretweet',
  name: 'Unretweet',
  nameKey: 'actions.unretweet',
  category: 'tweet',
  trigger: 'both',
  parameters: [],
  timeout: 10000
};

export const UNFOLLOW_USER: ActionDefinition = {
  id: 'unfollow_user',
  name: 'Unfollow User',
  nameKey: 'actions.unfollowUser',
  category: 'tweet',
  trigger: 'both',
  parameters: [
    { name: 'username', type: 'string', required: false, description: '用户名（可选，提供则跳转到用户主页取关）' }
  ],
  timeout: 15000
};

export const DELETE_TWEET: ActionDefinition = {
  id: 'delete_tweet',
  name: 'Delete Tweet',
  nameKey: 'actions.deleteTweet',
  category: 'tweet',
  trigger: 'both',
  parameters: [],
  timeout: 15000
};

export const BOOKMARK_TWEET: ActionDefinition = {
  id: 'bookmark_tweet',
  name: 'Bookmark Tweet',
  nameKey: 'actions.bookmarkTweet',
  category: 'tweet',
  trigger: 'both',
  parameters: [],
  timeout: 10000
};

export const UNBOOKMARK_TWEET: ActionDefinition = {
  id: 'unbookmark_tweet',
  name: 'Unbookmark Tweet',
  nameKey: 'actions.unbookmarkTweet',
  category: 'tweet',
  trigger: 'both',
  parameters: [],
  timeout: 10000
};

export const GET_CURRENT_URL: ActionDefinition = {
  id: 'get_current_url',
  name: 'Get Current URL',
  nameKey: 'actions.getCurrentUrl',
  category: 'navigation',
  trigger: 'both',
  parameters: [],
  timeout: 5000
};

export const GET_EXTENSION_STATUS: ActionDefinition = {
  id: 'get_extension_status',
  name: 'Get Extension Status',
  nameKey: 'actions.getExtensionStatus',
  category: 'navigation',
  trigger: 'both',
  parameters: [],
  timeout: 5000
};

export const SWITCH_ACCOUNT: ActionDefinition = {
  id: 'switch_account',
  name: 'Switch Account',
  nameKey: 'actions.switchAccount',
  category: 'navigation',
  trigger: 'both',
  parameters: [
    { name: 'username', type: 'string', required: true, description: '要切换到的 Twitter 用户名（不含 @）' }
  ],
  timeout: 10000
};

// ============================================
// 复合 Actions
// ============================================

export const BOOKMARK_SUMMARY: ActionDefinition = {
  id: 'bookmark_summary',
  name: 'Bookmark Summary',
  nameKey: 'actions.bookmarkSummary',
  category: 'composite',
  trigger: 'both',
  parameters: [
    { name: 'limit', type: 'number', required: false, default: 20, description: '抓取数量' }
  ],
  steps: [
    { id: 'navigate', actionId: 'navigate_to_bookmarks', params: {} },
    { id: 'scrape', actionId: 'scrape_bookmarks', dependsOn: ['navigate'] }
  ],
  timeout: 120000
};

export const REPLY_WITH_IMAGE: ActionDefinition = {
  id: 'reply_with_image',
  name: 'Reply with Image',
  nameKey: 'actions.replyWithImage',
  category: 'composite',
  trigger: 'backend',
  parameters: [
    { name: 'tweetUrl', type: 'string', required: true, description: '推文 URL' },
    { name: 'content', type: 'string', required: true, description: '回复内容' },
    { name: 'imageData', type: 'string', required: true, description: '图片数据' }
  ],
  steps: [
    { id: 'navigate', actionId: 'navigate_to_tweet', params: {} },
    { id: 'open', actionId: 'open_reply_composer', dependsOn: ['navigate'] },
    { id: 'fill', actionId: 'fill_reply_text', dependsOn: ['open'] },
    { id: 'upload', actionId: 'upload_image_to_reply', dependsOn: ['fill'] },
    { id: 'submit', actionId: 'submit_reply', dependsOn: ['upload'] }
  ],
  timeout: 120000
};

export const SEARCH_AND_ANALYZE: ActionDefinition = {
  id: 'search_and_analyze',
  name: 'Search and Analyze',
  nameKey: 'actions.searchAndAnalyze',
  category: 'composite',
  trigger: 'both',
  parameters: [
    { name: 'query', type: 'string', required: true, description: '搜索关键词' },
    { name: 'filters', type: 'object', required: false, description: '过滤器' },
    { name: 'limit', type: 'number', required: false, default: 20, description: '抓取数量' }
  ],
  steps: [
    { id: 'search', actionId: 'advanced_search', params: {} },
    { id: 'scrape', actionId: 'scrape_search_results', dependsOn: ['search'] }
  ],
  timeout: 120000
};

export const TIMELINE_ANALYSIS: ActionDefinition = {
  id: 'timeline_analysis',
  name: 'Timeline Analysis',
  nameKey: 'actions.timelineAnalysis',
  category: 'composite',
  trigger: 'both',
  parameters: [
    { name: 'count', type: 'number', required: false, default: 30, description: '收集数量' }
  ],
  steps: [
    { id: 'scroll', actionId: 'scroll_and_collect', params: {} }
  ],
  timeout: 180000
};

export const CREATE_THREAD: ActionDefinition = {
  id: 'create_thread',
  name: 'Create Thread',
  nameKey: 'actions.createThread',
  category: 'composite',
  trigger: 'both',
  parameters: [
    { name: 'tweets', type: 'array', required: true, description: '推文数组' }
  ],
  steps: [
    { id: 'open', actionId: 'open_tweet_composer', params: {} },
    { id: 'post', actionId: 'post_thread', dependsOn: ['open'] }
  ],
  timeout: 180000
};

export const CREATE_ARTICLE: ActionDefinition = {
  id: 'create_article',
  name: 'Create Article',
  nameKey: 'actions.createArticle',
  category: 'composite',
  trigger: 'both',
  parameters: [
    { name: 'title', type: 'string', required: true, description: '文章标题' },
    { name: 'content', type: 'string', required: true, description: '文章内容' },
    { name: 'headerImage', type: 'string', required: false, description: '头图数据' }
  ],
  steps: [
    { id: 'open', actionId: 'open_article_editor', params: {} },
    { id: 'title', actionId: 'fill_article_title', dependsOn: ['open'] },
    { id: 'body', actionId: 'fill_article_body', dependsOn: ['title'] },
    { id: 'header', actionId: 'upload_article_header_image', dependsOn: ['body'] },
    { id: 'publish', actionId: 'publish_article', dependsOn: ['header'] }
  ],
  timeout: 180000
};

// ============================================
// Action Registry 类
// ============================================

class ActionRegistry {
  private actions: Map<string, ActionDefinition> = new Map();

  constructor() {
    // 注册所有内置 Actions
    this.registerAll([
      // 导航类
      NAVIGATE_TO_TWEET,
      NAVIGATE_TO_URL,
      NAVIGATE_TO_BOOKMARKS,
      NAVIGATE_TO_NOTIFICATIONS,
      NAVIGATE_TO_SEARCH,
      RETURN_TO_TIMELINE,
      NAVIGATE_TO_GROK,
      NAVIGATE_TO_COMPOSE_ARTICLE,
      NAVIGATE_TO_COMMUNITIES,
      NAVIGATE_TO_FOLLOWING,
      // 回复类
      OPEN_REPLY_COMPOSER,
      FILL_REPLY_TEXT,
      UPLOAD_IMAGE_TO_REPLY,
      SUBMIT_REPLY,
      // 发推类
      OPEN_TWEET_COMPOSER,
      POST_TWEET,
      POST_THREAD,
      CLOSE_COMPOSER,
      // 文章类
      OPEN_ARTICLE_EDITOR,
      FILL_ARTICLE_TITLE,
      FILL_ARTICLE_BODY,
      UPLOAD_ARTICLE_HEADER_IMAGE,
      PUBLISH_ARTICLE,
      // 抓取类
      SCRAPE_TIMELINE,
      SCRAPE_BOOKMARKS,
      SCRAPE_CURRENT_VIEW,
      SCRAPE_SEARCH_RESULTS,
      SCRAPE_THREAD,
      SCRAPE_USER_PROFILE,
      SCRAPE_USER_TWEETS,
      FETCH_WECHAT_ARTICLE,
      ACCOUNT_ANALYTICS,
      POST_IMPRESSIONS,
      REPLY_IMPRESSIONS,
      // 通知类
      PROCESS_NOTIFICATIONS,
      CLICK_NOTIFICATION,
      // 搜索类
      ADVANCED_SEARCH,
      // 刷推类
      SCROLL_AND_COLLECT,
      CONTINUOUS_SCROLL,
      // 互动类
      LIKE_TWEET,
      UNLIKE_TWEET,
      RETWEET,
      UNRETWEET,
      FOLLOW_USER,
      UNFOLLOW_USER,
      QUOTE_TWEET,
      DELETE_TWEET,
      BOOKMARK_TWEET,
      UNBOOKMARK_TWEET,
      GET_CURRENT_URL,
      GET_EXTENSION_STATUS,
      SWITCH_ACCOUNT,
      // 复合类
      BOOKMARK_SUMMARY,
      REPLY_WITH_IMAGE,
      SEARCH_AND_ANALYZE,
      TIMELINE_ANALYSIS,
      CREATE_THREAD,
      CREATE_ARTICLE
    ]);
  }

  /**
   * 注册单个 Action
   */
  register(action: ActionDefinition): void {
    this.actions.set(action.id, action);
  }

  /**
   * 批量注册 Actions
   */
  registerAll(actions: ActionDefinition[]): void {
    actions.forEach(action => this.register(action));
  }

  /**
   * 获取 Action 定义
   */
  get(id: string): ActionDefinition | undefined {
    return this.actions.get(id);
  }

  /**
   * 获取所有 Actions
   */
  getAll(): ActionDefinition[] {
    return Array.from(this.actions.values());
  }

  /**
   * 按类别获取 Actions
   */
  getByCategory(category: string): ActionDefinition[] {
    return this.getAll().filter(a => a.category === category);
  }

  /**
   * 按触发方式获取 Actions
   */
  getByTrigger(trigger: 'backend' | 'frontend' | 'both'): ActionDefinition[] {
    return this.getAll().filter(a => a.trigger === trigger || a.trigger === 'both');
  }

  /**
   * 检查 Action 是否存在
   */
  has(id: string): boolean {
    return this.actions.has(id);
  }
}

// 导出单例
export const actionRegistry = new ActionRegistry();
