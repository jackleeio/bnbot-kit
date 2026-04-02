// Boost API 调用封装

const API_BASE = process.env.NEXT_PUBLIC_REST_API_ENDPOINT || '';
const API_KEY = process.env.NEXT_PUBLIC_X_API_KEY || '';

function getAuthHeaders(): HeadersInit {
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    'x-api-key': API_KEY,
  };
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('access_token');
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
  }
  return headers;
}

// --- Tweet Info types (preserved) ---

export interface TweetInfo {
  id: string;
  text: string;
  created_at: string;
  likes: number;
  retweets: number;
  quotes: number;
  replies: number;
  views_count: number;
  bookmarks: number;
  lang: string;
  author: {
    rest_id: string;
    name: string;
    screen_name: string;
    image: string;
    followers_count: number;
    blue_verified: boolean;
  };
  media?: {
    images?: Array<{ media_url_https: string }>;
    videos?: Array<{
      media_url_https: string;
      thumb_url: string;
      large_url: string;
    }>;
  };
}

// --- Boost types (aligned with backend schema) ---

export type BoostStatus = 'pending' | 'active' | 'distributing' | 'completed' | 'cancelled';
export type BoostSortBy = 'created_at' | 'total_budget' | 'end_time' | 'quoter_count' | 'retweeter_count' | 'remaining_budget';
export type BoostSortOrder = 'asc' | 'desc';

export interface BoostPublic {
  id: string;
  user_id: string;
  tweet_id: string;
  tweet_author: string;
  tweet_content: string | null;
  tweet_snapshot: Record<string, unknown> | null;
  total_budget: string;
  total_distributed: string;
  token_type: 'NATIVE' | 'ERC20';
  token_symbol: string;
  token_address: string | null;
  chain_id: number;
  quoter_pool_percentage: number;
  retweeter_pool_percentage: number;
  quoter_paid_usernames: string[];
  retweeter_paid_usernames: string[];
  status: BoostStatus;
  duration_days: number;
  end_time: string | null;
  created_at: string;
  contract_boost_id: string | null;
  payment_method: string | null;
}

export interface CreateBoostParams {
  tweet_id: string;
  tweet_author: string;
  tweet_content?: string;
  tweet_snapshot?: Record<string, unknown>;
  total_budget: string;
  token_type: 'NATIVE' | 'ERC20';
  token_symbol: string;
  token_address?: string;
  chain_id: number;
  quoter_pool_percentage?: number;
  retweeter_pool_percentage?: number;
  replier_pool_percentage?: number;
  duration_days?: number;
}

export interface BoostSearchParams {
  q?: string;
  author?: string;
  keyword?: string;
  status?: BoostStatus;
  token_symbol?: string;
  chain_id?: number;
  created_after?: string;
  created_before?: string;
  ending_soon?: boolean;
  min_budget?: string;
  max_budget?: string;
  has_remaining?: boolean;
  sort_by?: BoostSortBy;
  sort_order?: BoostSortOrder;
  skip?: number;
  limit?: number;
}

export interface BoostSearchResponse {
  data: BoostPublic[];
  count: number;
}

export interface BoostSignatureResponse {
  boost_id_bytes32: string;
  token: string;
  amount: string;
  end_time: number;
  deadline: number;
  signature: string;
  contract_address: string;
}

export interface BoostTweetInfo {
  [key: string]: unknown;
}

export interface BoostByTweetResponse {
  tweet_id: string;
  boosts: BoostTweetInfo[];
  total_count: number;
}

export interface UserReward {
  [key: string]: unknown;
}

export interface CheckTweetsResponse {
  active_tweet_ids: string[];
  rewards?: UserReward[];
}

export interface BoostCheckoutResponse {
  checkout_url: string;
  session_id: string;
}

export interface BoostPluginSummary {
  [key: string]: unknown;
}

// --- Internal helper types (preserved) ---

interface MediaEntity {
  type: string;
  media_url_https: string;
  video_info?: {
    aspect_ratio: [number, number];
    duration_millis: number;
    variants: Array<{
      content_type: string;
      bitrate?: number;
      url: string;
    }>;
  };
}

// --- Tweet Info function (preserved) ---

export async function fetchTweetInfo(tweetId: string): Promise<TweetInfo> {
  const response = await fetch(
    `${API_BASE}/api/v1/x-public/tweet-info?tweet_id=${tweetId}`,
    { headers: { 'x-api-key': API_KEY } },
  );
  if (!response.ok) throw new Error('Failed to fetch tweet info');

  const data = await response.json();
  if (data.code !== 1 || !data.data?.data?.tweetResult?.result) {
    throw new Error('Tweet not found');
  }

  const result = data.data.data.tweetResult.result;
  const legacy = result.legacy;
  const user = result.core.user_results.result;

  return {
    id: legacy.id_str,
    text: legacy.full_text,
    created_at: legacy.created_at,
    likes: legacy.favorite_count,
    retweets: legacy.retweet_count,
    quotes: legacy.quote_count,
    replies: legacy.reply_count,
    views_count: parseInt(result.views.count, 10),
    bookmarks: legacy.bookmark_count,
    lang: legacy.lang,
    author: {
      rest_id: user.rest_id,
      name: user.legacy.name,
      screen_name: user.legacy.screen_name,
      image: user.legacy.profile_image_url_https,
      followers_count: user.legacy.followers_count,
      blue_verified: user.is_blue_verified,
    },
    media: legacy.extended_entities?.media
      ? {
          images: legacy.extended_entities.media
            .filter((m: MediaEntity) => m.type === 'photo')
            .map((img: MediaEntity) => ({
              media_url_https: img.media_url_https,
            })),
          videos: legacy.extended_entities.media
            .filter((m: MediaEntity) => m.type === 'video')
            .map((video: MediaEntity) => {
              if (!video.video_info) return null;
              const variants = video.video_info.variants
                .filter((v) => v.content_type === 'video/mp4')
                .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
              return {
                media_url_https: video.media_url_https,
                thumb_url: variants[variants.length - 1]?.url || '',
                large_url: variants[0]?.url || '',
              };
            })
            .filter(Boolean),
        }
      : undefined,
  };
}

// --- Boost API functions ---

/** POST /api/v1/boost/ - 创建 Boost（需认证） */
export async function createBoost(
  params: CreateBoostParams,
): Promise<BoostPublic> {
  const response = await fetch(`${API_BASE}/api/v1/boost/`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(params),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to create boost');
  }
  return response.json();
}

/** GET /api/v1/boost/search - 搜索 Boost（公开） */
export async function searchBoosts(
  params: BoostSearchParams = {},
): Promise<BoostSearchResponse> {
  const query = new URLSearchParams();
  if (params.q) query.set('q', params.q);
  if (params.author) query.set('author', params.author);
  if (params.keyword) query.set('keyword', params.keyword);
  if (params.status) query.set('status', params.status);
  if (params.token_symbol) query.set('token_symbol', params.token_symbol);
  if (params.chain_id !== undefined) query.set('chain_id', String(params.chain_id));
  if (params.created_after) query.set('created_after', params.created_after);
  if (params.created_before) query.set('created_before', params.created_before);
  if (params.ending_soon !== undefined) query.set('ending_soon', String(params.ending_soon));
  if (params.min_budget) query.set('min_budget', params.min_budget);
  if (params.max_budget) query.set('max_budget', params.max_budget);
  if (params.has_remaining !== undefined) query.set('has_remaining', String(params.has_remaining));
  if (params.sort_by) query.set('sort_by', params.sort_by);
  if (params.sort_order) query.set('sort_order', params.sort_order);
  if (params.skip !== undefined) query.set('skip', String(params.skip));
  if (params.limit !== undefined) query.set('limit', String(params.limit));

  const response = await fetch(
    `${API_BASE}/api/v1/boost/search?${query.toString()}`,
    { headers: { 'x-api-key': API_KEY } },
  );
  if (!response.ok) throw new Error('Failed to search boosts');
  return response.json();
}

/** GET /api/v1/boost/{boost_id} - 获取 Boost 详情（公开） */
export async function getBoostDetail(boostId: string): Promise<BoostPublic> {
  const response = await fetch(`${API_BASE}/api/v1/boost/${boostId}`, {
    headers: { 'x-api-key': API_KEY },
  });
  if (!response.ok) throw new Error('Failed to fetch boost detail');
  return response.json();
}

/** GET /api/v1/boost/by-tweet/{tweet_id} - 按推文获取 Boost（公开） */
export async function getBoostsByTweet(tweetId: string): Promise<BoostByTweetResponse> {
  const response = await fetch(`${API_BASE}/api/v1/boost/by-tweet/${tweetId}`, {
    headers: { 'x-api-key': API_KEY },
  });
  if (!response.ok) throw new Error('Failed to fetch boosts by tweet');
  return response.json();
}

/** GET /api/v1/boost/check-tweets - 批量检查推文是否有活跃 Boost（公开） */
export async function checkTweets(params: {
  tweet_ids: string[];
  username?: string;
  include_completed?: boolean;
}): Promise<CheckTweetsResponse> {
  const query = new URLSearchParams();
  query.set('tweet_ids', params.tweet_ids.join(','));
  if (params.username) query.set('username', params.username);
  if (params.include_completed !== undefined) query.set('include_completed', String(params.include_completed));

  const response = await fetch(
    `${API_BASE}/api/v1/boost/check-tweets?${query.toString()}`,
    { headers: { 'x-api-key': API_KEY } },
  );
  if (!response.ok) throw new Error('Failed to check tweets');
  return response.json();
}

/** POST /api/v1/boost/{boost_id}/signature - 获取链上签名（需认证） */
export async function getBoostSignature(
  boostId: string,
): Promise<BoostSignatureResponse> {
  const response = await fetch(
    `${API_BASE}/api/v1/boost/${boostId}/signature`,
    {
      method: 'POST',
      headers: getAuthHeaders(),
    },
  );
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to get signature');
  }
  return response.json();
}

/** POST /api/v1/boost/{boost_id}/checkout - Stripe 支付（需认证） */
export async function createBoostCheckout(
  boostId: string,
  amountUsd: number,
): Promise<BoostCheckoutResponse> {
  const query = new URLSearchParams();
  query.set('amount_usd', String(amountUsd));

  const response = await fetch(
    `${API_BASE}/api/v1/boost/${boostId}/checkout?${query.toString()}`,
    {
      method: 'POST',
      headers: getAuthHeaders(),
    },
  );
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to create checkout');
  }
  return response.json();
}

/** GET /api/v1/boost/plugin/summary/{tweet_id} - 插件摘要（公开） */
export async function getBoostPluginSummary(
  tweetId: string,
): Promise<BoostPluginSummary[]> {
  const response = await fetch(
    `${API_BASE}/api/v1/boost/plugin/summary/${tweetId}`,
    { headers: { 'x-api-key': API_KEY } },
  );
  if (!response.ok) throw new Error('Failed to fetch boost plugin summary');
  return response.json();
}
