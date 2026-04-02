/**
 * ReplyNotificationStorage
 * Stores processed reply notifications in chrome.storage.local
 * Records are kept for 48 hours to prevent duplicate processing
 */

export interface ProcessedReply {
  notificationId: string;  // Unique notification identifier
  tweetId: string;         // Tweet ID that was replied to
  authorHandle: string;    // Author who replied to us
  processedAt: number;     // Timestamp when processed
}

const STORAGE_KEY = 'bnbot_processed_replies';
const MAX_AGE_MS = 48 * 60 * 60 * 1000; // 48 hours

export class ReplyNotificationStorage {
  /**
   * Get all processed replies from storage
   */
  async getProcessedReplies(): Promise<ProcessedReply[]> {
    try {
      const result = await chrome.storage.local.get(STORAGE_KEY);
      return result[STORAGE_KEY] || [];
    } catch (e) {
      console.error('[ReplyNotificationStorage] Failed to get processed replies:', e);
      return [];
    }
  }

  /**
   * Check if a notification has been processed
   */
  async isProcessed(notificationId: string): Promise<boolean> {
    const replies = await this.getProcessedReplies();
    return replies.some(r => r.notificationId === notificationId);
  }

  /**
   * Check if a tweet has been replied to (by tweet ID)
   */
  async isTweetProcessed(tweetId: string): Promise<boolean> {
    const replies = await this.getProcessedReplies();
    return replies.some(r => r.tweetId === tweetId);
  }

  /**
   * Mark a reply notification as processed
   */
  async markAsProcessed(reply: ProcessedReply): Promise<void> {
    try {
      const replies = await this.getProcessedReplies();

      // Add new entry
      replies.push(reply);

      // Clean up old entries and save
      await this.cleanupAndSave(replies);

      console.log('[ReplyNotificationStorage] Marked as processed:', reply.notificationId);
    } catch (e) {
      console.error('[ReplyNotificationStorage] Failed to mark as processed:', e);
    }
  }

  /**
   * Clean up expired entries and save to storage
   */
  private async cleanupAndSave(replies: ProcessedReply[]): Promise<void> {
    const now = Date.now();
    const valid = replies.filter(r => (now - r.processedAt) < MAX_AGE_MS);

    await chrome.storage.local.set({ [STORAGE_KEY]: valid });

    if (replies.length !== valid.length) {
      console.log(`[ReplyNotificationStorage] Cleaned up ${replies.length - valid.length} expired entries`);
    }
  }

  /**
   * Force cleanup of expired entries
   */
  async cleanup(): Promise<void> {
    const replies = await this.getProcessedReplies();
    await this.cleanupAndSave(replies);
  }

  /**
   * Get count of processed replies
   */
  async getCount(): Promise<number> {
    const replies = await this.getProcessedReplies();
    return replies.length;
  }

  /**
   * Clear all processed replies (for testing)
   */
  async clear(): Promise<void> {
    await chrome.storage.local.remove(STORAGE_KEY);
    console.log('[ReplyNotificationStorage] Cleared all processed replies');
  }
}

export const replyNotificationStorage = new ReplyNotificationStorage();
