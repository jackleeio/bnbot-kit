import { authService } from './authService';
import { ScrapedBookmark } from '../types/action';
import { ArticleData } from '../components/ArticleCard';

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:8000';

export interface TweetContent {
  type: "tweet_draft";
  data: {
    drafts: Array<{
      action: "post";
      content: string;           // 推文文本
      media: any | null;
      hashtags: string[];
      image_suggestion: {
        type: "none" | "generate" | "search";
        has_suggestion: boolean;
        description?: string;
        image_prompt?: string;
      };
      reference_tweet_ids: string[];
    }>;
  };
}

export interface ThreadContent {
  type: "tweet_timeline";
  data: {
    timeline: Array<{
      text: string;              // 每条推文内容
      media: any[];
    }>;
    total_tweets: number;
    source_type: string;
    target_style: string;
    target_language: string;
    user: {
      avatar: string | null;
      username: string | null;
      display_name: string | null;
    };
  };
}

export interface TweetDraft {
  id: string;                    // UUID
  user_id: string;               // UUID
  draft_type: "tweet" | "thread" | "article";
  title: string | null;          // ⚠️ 仅 article 类型有值，tweet/thread 始终为 null
  content: TweetContent | ThreadContent | any;  // 根据 draft_type 不同结构不同, any for backward compat/article
  scheduled_at: string | null;   // ISO 8601 时间，定时发布时间
  publish_status: "draft" | "scheduled" | "published" | "failed";
  published_at: string | null;   // 实际发布时间
  publish_error: string | null;  // 发布失败原因
  created_at: string;            // ISO 8601
  updated_at: string;            // ISO 8601
}

export interface TweetDraftsResponse {
  data: TweetDraft[];
  count: number;
}

class DraftService {
  /**
   * Save a tweet to drafts
   */
  async saveTweetDraft(tweet: ScrapedBookmark, title?: string): Promise<TweetDraft> {
    const tweetUrl = `https://twitter.com/${tweet.authorHandle}/status/${tweet.tweetId}`;

    const response = await authService.fetchWithAuth(`${API_BASE_URL}/api/v1/drafts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        draft_type: 'tweet',
        title: title || `Tweet from @${tweet.authorHandle}`,
        content: {
          type: 'tweet_draft',
          data: {
            drafts: [{
              action: 'post',
              content: tweet.content,
              media: tweet.media,
              hashtags: [],
              image_suggestion: { type: 'none', has_suggestion: false },
              reference_tweet_ids: [tweet.tweetId]
            }]
          }
        }
      })
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data?.detail || 'Failed to save draft');
    }

    return response.json();
  }

  /**
   * Save an article to drafts
   */
  async saveArticleDraft(article: ArticleData): Promise<TweetDraft> {
    console.log('[DraftService] saveArticleDraft - Saving article:', article.title);

    const response = await authService.fetchWithAuth(`${API_BASE_URL}/api/v1/drafts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        draft_type: 'article',
        title: article.title,
        content: {
          type: 'article',
          data: {
            title: article.title,
            subtitle: article.subtitle,
            summary: article.summary,
            content: article.content,
            header_image: article.header_image,
            inline_images: article.inline_images,
            tags: article.tags,
            estimated_read_time: article.estimated_read_time,
            reference_sources: article.reference_sources,
          }
        }
      })
    });

    if (!response.ok) {
      const data = await response.json();
      console.error('[DraftService] saveArticleDraft - Error:', data);
      throw new Error(data?.detail || 'Failed to save article draft');
    }

    const result = await response.json();
    console.log('[DraftService] saveArticleDraft - Saved successfully:', result.id);
    return result;
  }

  /**
   * Update a tweet draft
   */
  async updateDraft(draftId: string, updates: Partial<TweetDraft> | { content: any }): Promise<TweetDraft> {
    const response = await authService.fetchWithAuth(`${API_BASE_URL}/api/v1/drafts/${draftId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(updates)
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data?.detail || 'Failed to update draft');
    }

    return response.json();
  }

  /**
   * Schedule a draft for publishing
   */
  async scheduleDraft(draftId: string, scheduledAt: string): Promise<TweetDraft> {
    const response = await authService.fetchWithAuth(`${API_BASE_URL}/api/v1/drafts/${draftId}/schedule`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ scheduled_at: scheduledAt })
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data?.detail || 'Failed to schedule draft');
    }

    return response.json();
  }

  /**
   * Cancel a scheduled draft
   */
  async unscheduleDraft(draftId: string): Promise<TweetDraft> {
    const response = await authService.fetchWithAuth(`${API_BASE_URL}/api/v1/drafts/${draftId}/schedule`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data?.detail || 'Failed to unschedule draft');
    }

    return response.json();
  }

  /**
   * Get all tweet drafts
   */
  async getAllDrafts(params?: {
    skip?: number;
    limit?: number;
    draft_type?: 'tweet' | 'thread' | 'article';
    q?: string;  // 搜索关键词
  }): Promise<TweetDraft[]> {
    console.log('[DraftService] getAllDrafts - Starting...');

    const query = new URLSearchParams();
    if (params?.skip) query.set('skip', String(params.skip));
    if (params?.limit) query.set('limit', String(params.limit));
    else query.set('limit', '100'); // default
    if (params?.draft_type) query.set('draft_type', params.draft_type);
    if (params?.q) query.set('q', params.q);

    const response = await authService.fetchWithAuth(
      `${API_BASE_URL}/api/v1/drafts?${query.toString()}`,
      {
        method: 'GET',
      }
    );

    console.log('[DraftService] getAllDrafts - Response status:', response.status);

    if (!response.ok) {
      const data = await response.json();
      const errorMsg = data?.detail || `HTTP ${response.status}`;
      console.error('[DraftService] getAllDrafts - Error:', errorMsg);
      // Fallback for demo purposes if backend isn't ready
      // return this.getMockDrafts(); 
      throw new Error(errorMsg);
    }

    const data = await response.json();
    const drafts = data?.data || [];
    console.log('[DraftService] getAllDrafts - Drafts count:', drafts.length);
    return drafts;
  }

  // Temporary mock data for development
  getMockDrafts(): TweetDraft[] {
    return [
      {
        "id": "5a8b72c4-1c89-40a8-9bd6-be59cc0f79d0",
        "user_id": "abc123...",
        "draft_type": "tweet",
        "title": null,
        "content": {
          "type": "tweet_draft",
          "data": {
            "drafts": [{
              "action": "post",
              "content": "Solana 的复苏证明了一点：技术优势需要时间被市场认可。#Solana #SOL",
              "media": null,
              "hashtags": [],
              "image_suggestion": { "type": "none", "has_suggestion": false },
              "reference_tweet_ids": []
            }]
          }
        },
        "scheduled_at": null,
        "publish_status": "draft",
        "published_at": null,
        "publish_error": null,
        "created_at": "2026-01-17T14:19:56.929497+00:00",
        "updated_at": "2026-01-17T14:19:56.929525+00:00"
      },
      {
        "id": "0ecf9742-eaf8-4556-a383-d6eae548c590",
        "user_id": "abc123...",
        "draft_type": "thread",
        "title": null,
        "content": {
          "type": "tweet_timeline",
          "data": {
            "timeline": [
              { "text": "第一年：什么都想做，什么都做不好。", "media": [] },
              { "text": "第二年：找到了 PMF，但团队管理一塌糊涂。", "media": [] },
              { "text": "第三年：第一次融资，第一次裁员。", "media": [] }
            ],
            "total_tweets": 3,
            "source_type": "article",
            "target_style": "casual",
            "target_language": "zh-CN",
            "user": {
              "avatar": null,
              "username": null,
              "display_name": null
            }
          }
        },
        "scheduled_at": null,
        "publish_status": "draft",
        "published_at": null,
        "publish_error": null,
        "created_at": "2026-01-18T10:52:12.869546+00:00",
        "updated_at": "2026-01-18T10:52:12.869546+00:00"
      }
    ];
  }

  /**
   * Delete a draft
   */
  async deleteDraft(draftId: string): Promise<void> {
    const response = await authService.fetchWithAuth(`${API_BASE_URL}/api/v1/drafts/${draftId}`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data?.detail || 'Failed to delete draft');
    }
  }

  /**
   * Get pending drafts (for browser extension polling)
   */
  async getPendingDrafts(): Promise<TweetDraft[]> {
    const response = await authService.fetchWithAuth(`${API_BASE_URL}/api/v1/drafts/pending`, {
      method: 'GET',
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data?.detail || 'Failed to get pending drafts');
    }

    const data = await response.json();
    return data?.data || data || [];
  }

  /**
   * Mark draft as published
   */
  async markPublished(draftId: string): Promise<TweetDraft> {
    const response = await authService.fetchWithAuth(`${API_BASE_URL}/api/v1/drafts/${draftId}/publish`, {
      method: 'PUT',
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data?.detail || 'Failed to mark draft as published');
    }

    return response.json();
  }

  /**
   * Mark draft as failed
   */
  async markFailed(draftId: string, errorMessage: string): Promise<TweetDraft> {
    const response = await authService.fetchWithAuth(`${API_BASE_URL}/api/v1/drafts/${draftId}/fail`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        error_message: errorMessage,
      }),
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data?.detail || 'Failed to mark draft as failed');
    }

    return response.json();
  }

  /**
   * Get calendar view drafts
   */
  async getCalendarDrafts(startDate: Date, endDate: Date): Promise<TweetDraft[]> {
    const params = new URLSearchParams({
      start_date: startDate.toISOString(),
      end_date: endDate.toISOString(),
    });

    const response = await authService.fetchWithAuth(
      `${API_BASE_URL}/api/v1/drafts/calendar?${params}`,
      {
        method: 'GET',
      }
    );

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data?.detail || 'Failed to get calendar drafts');
    }

    const data = await response.json();
    return data?.data || data || [];
  }

  /**
   * Notify background to sync a draft's alarm (after scheduling).
   */
  async notifyDraftAlarmSync(draftId: string): Promise<void> {
    return new Promise(resolve => {
      chrome.runtime.sendMessage({ type: 'DRAFT_ALARM_SYNC', draftId }, () => resolve());
    });
  }

  /**
   * Notify background to remove a draft's alarm (after unscheduling).
   */
  async notifyDraftAlarmRemove(draftId: string): Promise<void> {
    return new Promise(resolve => {
      chrome.runtime.sendMessage({ type: 'DRAFT_ALARM_REMOVE', draftId }, () => resolve());
    });
  }
}

export const draftService = new DraftService();
