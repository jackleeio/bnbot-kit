/**
 * Auto Reply Feature Type Definitions
 */

// Scraped tweet data structure for processing
export interface ScrapedTweet {
  id: string;
  authorHandle: string;
  authorName: string;
  authorAvatar: string;
  authorBio?: string; // Optional, fetched on demand
  authorFollowers?: number; // Optional, fetched on demand
  isVerified?: boolean; // Blue check badge
  content: string;
  timestamp: string;
  metrics: {
    replies: number;
    retweets: number;
    likes: number;
    views: number;
  };
  media: { type: 'photo' | 'video'; url: string }[];
  isRetweet: boolean;
  isQuote: boolean;
  quotedTweet?: ScrapedTweet;
  articleElement?: HTMLElement; // Reference to DOM for scrolling/clicking (undefined for API-sourced tweets)
  tweetUrl: string;
  source?: 'timeline' | 'notification' | 'other'; // Where this tweet came from
  expectedExposure?: number; // Predicted exposure from API data cache
}

// Evaluation result from AI
export interface TweetEvaluation {
  tweetId: string;
  shouldReply: boolean;
  score: number; // 0-100
  reasons: string[];
  suggestedTone?: 'professional' | 'casual' | 'humorous' | 'informative';
  topics: string[];
}

// Generated reply
export interface GeneratedReply {
  tweetId: string;
  content: string;
  reasoning: string;
  alternativeContents?: string[];
  // Image generation fields
  needsImage?: boolean;      // AI judgment: whether image is needed
  imagePrompt?: string;      // Prompt for image generation (if needsImage is true)
}

// Reply record for tracking
export interface ReplyRecord {
  id: string;
  tweetId: string;
  authorHandle: string;
  tweetContent: string;
  replyContent: string;
  status: 'pending' | 'posted' | 'failed' | 'skipped';
  timestamp: Date;
  error?: string;
}

// User settings
export interface AutoReplySettings {
  // Core toggle
  enableAutoReply: boolean;          // Master switch: whether to actually post replies

  // Frequency controls
  minIntervalSeconds: number;      // Minimum seconds between replies (default: 60)
  maxIntervalSeconds: number;      // Maximum for random variation (default: 180)
  dailyLimit: number;              // Max replies per day (default: 50)
  sessionLimit: number;            // Max replies per session (default: 20)

  // Filter settings
  minFollowerCount: number;        // Minimum followers to consider (default: 0)
  minLikeCount: number;            // Minimum likes on tweet (default: 5)
  minTweetViews: number;           // Minimum views (default: 0)
  maxTweetAgeHours: number;        // Max age in hours (default: 24)
  minExpectedExposure: number;     // Minimum expected exposure from prediction (default: 0)
  targetTweetTypes: string;        // New field for user defined tweet types
  topicFilters: string[];          // Topics of interest
  excludeHandles: string[];        // Accounts to skip
  onlyFollowing: boolean;          // Only reply to accounts user follows

  // Reply style
  replyTone: 'professional' | 'casual' | 'humorous' | 'match_author';
  maxReplyLength: number;          // Character limit (default: 280)
  customInstructions: string;      // User's guidance for AI

  // Safety
  requireConfirmation: boolean;    // Confirm before posting (default: true)
  dryRunMode: boolean;             // Preview without posting (default: true)

  // Notification Handling
  enableNotificationHandler: boolean; // Handle notifications automatically
  notificationCheckIntervalMins: number; // Interval in minutes to check notifications
  enableImageGeneration: boolean;  // New: Toggle for image generation
  onlyProcessNotifications: boolean; // Only process notifications, ignore timeline
}

// Default settings
export const DEFAULT_AUTO_REPLY_SETTINGS: AutoReplySettings = {
  minIntervalSeconds: 5,
  maxIntervalSeconds: 10,
  dailyLimit: 50,
  sessionLimit: 20,
  minFollowerCount: 1000,
  minLikeCount: 0,
  minTweetViews: 1000,
  maxTweetAgeHours: 24,
  minExpectedExposure: 500,  // 500 = default minimum expected exposure filter
  targetTweetTypes: '',
  topicFilters: [],
  excludeHandles: [],
  onlyFollowing: false,
  replyTone: 'casual',
  maxReplyLength: 280,
  customInstructions: '',
  requireConfirmation: false,
  dryRunMode: false,
  enableNotificationHandler: false,
  notificationCheckIntervalMins: 15,
  enableImageGeneration: false,  // Default to false
  onlyProcessNotifications: false
};

// Session status
export type SessionStatus =
  | 'idle'
  | 'scrolling'
  | 'evaluating'
  | 'generating'
  | 'generating_image'  // New: generating image for reply
  | 'posting'
  | 'waiting'
  | 'paused'
  | 'stopped'
  | 'confirming';

// Session state
export interface AutoReplySession {
  id: string;
  startTime: Date;
  endTime?: Date;
  status: SessionStatus;
  tweetsScanned: number;
  tweetsEvaluated: number;
  repliesPosted: number;
  repliesFailed: number;
  repliesSkipped: number;
  currentTweet?: ScrapedTweet;
  currentEvaluation?: TweetEvaluation;
  currentReply?: GeneratedReply;
  currentReasoning?: string;
  currentImageBlob?: Blob;  // New: current generated image for reply
  replyHistory: ReplyRecord[];
  errors: { timestamp: Date; message: string }[];
  // Token consumption tracking
  tokensUsed: number;
  evaluationCount: number;
  generationCount: number;
  waitEndTime?: number; // Timestamp when waiting ends
}

// Event types for UI updates
export type AutoReplyEventType =
  | 'session_start'
  | 'session_end'
  | 'session_pause'
  | 'session_resume'
  | 'tweet_found'
  | 'tweet_evaluating'
  | 'tweet_evaluated'
  | 'tweet_skipped'
  | 'reply_generating'
  | 'reply_generated'
  | 'reply_confirming'
  | 'reply_confirmed'
  | 'reply_posting'
  | 'reply_posted'
  | 'reply_failed'
  | 'error'
  | 'waiting'
  | 'scrolling'
  | 'settings_changed'
  | 'stats_update'
  | 'reasoning_update'
  | 'api_request'
  | 'api_response'
  | 'image_generation'
  | 'image_generated'
  | 'image_failed'
  | 'debug';

// Event payload
export interface AutoReplyEvent {
  type: AutoReplyEventType;
  data?: any;
  timestamp: Date;
}

// Event callback type
export type AutoReplyEventCallback = (event: AutoReplyEvent) => void;

// Activity log entry for UI display
export interface ActivityLogEntry {
  id: string;
  timestamp: Date;
  type: AutoReplyEventType | string;
  message: string;
  details?: Record<string, any>;
}

// Daily statistics for persistence
export interface DailyStats {
  date: string; // YYYY-MM-DD format
  repliesPosted: number;
  repliesFailed: number;
  repliesSkipped: number;
  tweetsScanned: number;
  tokensUsed: number;
}

// Storage keys
export const STORAGE_KEYS = {
  AUTO_REPLY_SETTINGS: 'bnbot_auto_reply_settings',
  AUTO_REPLY_SESSION: 'bnbot_auto_reply_session',
  AUTO_REPLY_DAILY_STATS: 'bnbot_auto_reply_daily_stats',
  AUTO_REPLY_HISTORY: 'bnbot_auto_reply_history',
  AUTO_REPLY_PROCESSED_TWEETS: 'bnbot_auto_reply_processed_tweets'
} as const;
