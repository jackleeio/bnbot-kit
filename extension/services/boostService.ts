// Boost API Service
// Endpoint: /api/v1/engage

import { authService } from './authService';

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:8000';

// --- Types ---

export interface TweetSnapshot {
  content: string;
  author: {
    username: string;
    name: string;
    avatar: string;
    verified: boolean;
  };
  media: Array<{ type: string; url: string }>;
  metrics: {
    likes: number;
    retweets: number;
    quotes: number;
    replies: number;
  };
  created_at: string;
}

export interface Boost {
  id: string;
  tweet_id: string;
  tweet_url: string | null;
  tweet_snapshot: TweetSnapshot | null;
  user_id: string;
  sponsor_address: string;
  total_budget: string; // wei string
  token_type: 'NATIVE' | 'ERC20';
  token_address: string | null;
  token_symbol: string;
  chain_id: number;
  quoter_pool_percentage: number;
  retweeter_pool_percentage: number;
  verified_user_weight: number;
  unverified_user_weight: number;
  min_quality_score: number;
  status: 'pending' | 'active' | 'distributing' | 'completed';
  duration_days: number;
  start_time: string | null;
  end_time: string | null;
  total_distributed: string; // wei string
  current_round: number;
  quoter_paid_usernames: string[];
  retweeter_paid_usernames: string[];
  contract_boost_id: string | null;
  deposit_tx_hash: string | null;
  created_at: string;
  updated_at: string;
}

export interface BoostPluginSummary {
  boost_id: string;
  tweet_id: string;
  total_budget: string;
  total_distributed: string;
  remaining_budget: string;
  token_type: 'NATIVE' | 'ERC20';
  token_symbol: string;
  quoter_count: number;
  retweeter_count: number;
  status: string;
  ends_at: string | null;
  hours_remaining: number | null;
}

export interface BoostCreate {
  tweet_id: string;
  tweet_url?: string;
  sponsor_address: string;
  total_budget: string;
  token_type?: 'NATIVE' | 'ERC20';
  token_address?: string;
  token_symbol?: string;
  chain_id?: number;
  quoter_pool_percentage?: number;
  retweeter_pool_percentage?: number;
  replier_pool_percentage?: number;
  verified_user_weight?: number;
  unverified_user_weight?: number;
  min_quality_score?: number;
  duration_days?: number;
}

export interface BoostListResponse {
  data: Boost[];
  count: number;
}

export interface BoostListParams {
  skip?: number;
  limit?: number;
  status?: 'pending' | 'active' | 'distributing' | 'completed';
  mine_only?: boolean;
}

// Search API Types
export interface BoostSearchParams {
  // Unified search (OR logic: name, username, content, tweet_id)
  q?: string;
  // Precise search
  author?: string;
  keyword?: string;
  // Status filter
  status?: 'pending' | 'active' | 'distributing' | 'completed';
  token_symbol?: string;
  chain_id?: number;
  // Time filter
  created_after?: string;
  created_before?: string;
  ending_soon?: boolean;
  // Amount filter
  min_budget?: string;
  max_budget?: string;
  has_remaining?: boolean;
  // Sort
  sort_by?: 'created_at' | 'total_budget' | 'end_time' | 'quoter_count' | 'retweeter_count' | 'remaining_budget';
  sort_order?: 'asc' | 'desc';
  // Pagination
  skip?: number;
  limit?: number;
}

export interface BoostSearchResponse {
  data: Boost[];
  count: number;
}

export interface CheckTweetsResponse {
  active_tweet_ids: string[];
  rewards?: {
    [tweetId: string]: Array<{
      boost_id: string;
      amount: string;        // wei string
      token_symbol: string;
      user_type: 'quoter' | 'retweeter';
      tx_hash: string | null;
    }>;
  };
}

// --- Helper Functions ---

/**
 * Convert wei string to human-readable token amount
 */
export function weiToToken(wei: string, decimals: number = 18): string {
  const value = BigInt(wei);
  const divisor = BigInt(10 ** decimals);
  const integerPart = value / divisor;
  const remainder = value % divisor;

  if (remainder === BigInt(0)) {
    return integerPart.toString();
  }

  // Format with up to 4 decimal places
  const remainderStr = remainder.toString().padStart(decimals, '0');
  const decimalPart = remainderStr.slice(0, 4).replace(/0+$/, '');

  if (decimalPart) {
    return `${integerPart}.${decimalPart}`;
  }
  return integerPart.toString();
}

/**
 * Convert human-readable token amount to wei string
 */
export function tokenToWei(amount: string, decimals: number = 18): string {
  const parts = amount.split('.');
  const integerPart = parts[0] || '0';
  let decimalPart = parts[1] || '';

  // Pad or truncate decimal part to match decimals
  decimalPart = decimalPart.padEnd(decimals, '0').slice(0, decimals);

  const combined = integerPart + decimalPart;
  // Remove leading zeros but keep at least one digit
  return combined.replace(/^0+/, '') || '0';
}

/**
 * Extract tweet ID from Twitter URL
 */
export function extractTweetId(url: string): string | null {
  const match = url.match(/status\/(\d+)/);
  return match ? match[1] : null;
}

/**
 * Format remaining time from hours
 */
export function formatRemainingTime(hours: number | null): string {
  if (hours === null || hours <= 0) return 'Ended';

  if (hours < 1) {
    const minutes = Math.floor(hours * 60);
    return `${minutes}m`;
  }

  if (hours < 24) {
    return `${Math.floor(hours)}h`;
  }

  const days = Math.floor(hours / 24);
  const remainingHours = Math.floor(hours % 24);

  if (remainingHours === 0) {
    return `${days}d`;
  }
  return `${days}d ${remainingHours}h`;
}

// --- Service Class ---

class BoostService {
  /**
   * Get boost summary for a tweet (no auth required)
   * Used by the plugin to show boost info on tweet pages
   */
  async getBoostSummary(tweetId: string): Promise<BoostPluginSummary[]> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/v1/engage/plugin/summary/${tweetId}`);

      if (!response.ok) {
        if (response.status === 404) {
          return [];
        }
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('[BoostService] Error fetching boost summary:', error);
      return [];
    }
  }

  /**
   * Get all boosts for a tweet (no auth required)
   */
  async getBoostsByTweet(tweetId: string): Promise<Boost[]> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/v1/engage/tweet/${tweetId}`);

      if (!response.ok) {
        if (response.status === 404) {
          return [];
        }
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();
      return result.data || [];
    } catch (error) {
      console.error('[BoostService] Error fetching boosts by tweet:', error);
      return [];
    }
  }

  /**
   * Get boost details by ID (no auth required)
   */
  async getBoost(boostId: string): Promise<Boost | null> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/v1/engage/${boostId}`);

      if (!response.ok) {
        if (response.status === 404) {
          return null;
        }
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('[BoostService] Error fetching boost:', error);
      return null;
    }
  }

  /**
   * Get boost list (requires auth)
   */
  /**
   * Get boost list (requires auth)
   */
  async listBoosts(params: BoostListParams = {}): Promise<BoostListResponse> {
    const queryParams = new URLSearchParams();
    if (params.skip !== undefined) queryParams.set('skip', params.skip.toString());
    if (params.limit !== undefined) queryParams.set('limit', params.limit.toString());
    if (params.status) queryParams.set('status', params.status);
    if (params.mine_only) queryParams.set('mine_only', 'true');

    const response = await authService.fetchWithAuth(
      `${API_BASE_URL}/api/v1/engage/?${queryParams.toString()}`,
      { method: 'GET' }
    );

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return await response.json();
  }

  /**
   * Create a new boost (requires auth)
   */
  async createBoost(data: BoostCreate): Promise<Boost | null> {
    try {
      const response = await authService.fetchWithAuth(
        `${API_BASE_URL}/api/v1/engage/`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(data),
        }
      );

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        throw new Error(errorBody.detail || `HTTP error! status: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('[BoostService] Error creating boost:', error);
      throw error;
    }
  }

  /**
   * Activate a boost after on-chain deposit (no auth required - webhook)
   */
  async activateBoost(boostId: string, contractBoostId: string, depositTxHash: string): Promise<Boost | null> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/v1/engage/${boostId}/activate`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contract_boost_id: contractBoostId,
          deposit_tx_hash: depositTxHash,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('[BoostService] Error activating boost:', error);
      throw error;
    }
  }

  /**
   * Add budget to an existing boost (requires auth)
   */
  async addBudget(boostId: string, additionalBudget: string, txHash: string): Promise<Boost | null> {
    try {
      const response = await authService.fetchWithAuth(
        `${API_BASE_URL}/api/v1/engage/${boostId}/add-budget`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            additional_budget: additionalBudget,
            tx_hash: txHash,
          }),
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('[BoostService] Error adding budget:', error);
      throw error;
    }
  }

  /**
   * Complete a boost (requires auth - creator only)
   */
  async completeBoost(boostId: string): Promise<Boost | null> {
    try {
      const response = await authService.fetchWithAuth(
        `${API_BASE_URL}/api/v1/engage/${boostId}/complete`,
        { method: 'PATCH' }
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('[BoostService] Error completing boost:', error);
      throw error;
    }
  }

  /**
   * Create Stripe Checkout Session for a boost (requires auth)
   * Returns checkout_url to redirect user to Stripe payment page
   */
  async createCheckoutSession(boostId: string, amountUsd: number): Promise<{ checkout_url: string; session_id: string }> {
    const response = await authService.fetchWithAuth(
      `${API_BASE_URL}/api/v1/engage/${boostId}/checkout?amount_usd=${amountUsd}`,
      { method: 'POST' }
    );

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      throw new Error(errorBody.detail || `HTTP error! status: ${response.status}`);
    }

    return await response.json();
  }

  /**
   * Get all active boosts (for discovery/list view)
   */
  async getActiveBoosts(limit: number = 20): Promise<Boost[]> {
    const result = await this.listBoosts({ status: 'active', limit });
    return result.data;
  }

  /**
   * Get my boosts (requires auth)
   */
  async getMyBoosts(status?: 'pending' | 'active' | 'distributing' | 'completed'): Promise<Boost[]> {
    try {
      const result = await this.listBoosts({ mine_only: true, status });
      return result.data;
    } catch (error) {
      console.error('[BoostService] Error fetching my boosts:', error);
      return [];
    }
  }
  /**
   * Search boosts with filters (no auth required - public API)
   */
  async searchBoosts(params: BoostSearchParams = {}): Promise<BoostSearchResponse> {
    try {
      const searchParams = new URLSearchParams();

      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          searchParams.append(key, String(value));
        }
      });

      const response = await fetch(
        `${API_BASE_URL}/api/v1/engage/search?${searchParams.toString()}`
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('[BoostService] Error searching boosts:', error);
      return { data: [], count: 0 };
    }
  }

  /**
   * Batch check tweets for boost activities and rewards
   */
  async checkTweets(tweetIds: string[], username?: string, includeCompleted: boolean = false): Promise<CheckTweetsResponse> {
    const ids = tweetIds.join(',');
    const url = new URL(`${API_BASE_URL}/api/v1/engage/check-tweets`);
    url.searchParams.append('tweet_ids', ids);
    if (username) {
      url.searchParams.append('username', username);
    }
    if (includeCompleted) {
      url.searchParams.append('include_completed', 'true');
    }

    try {
      const response = await fetch(url.toString());

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('[BoostService] Error checking tweets:', error);
      return { active_tweet_ids: [], rewards: {} };
    }
  }
}

export const boostService = new BoostService();
