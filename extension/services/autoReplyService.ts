/// <reference types="chrome" />
/**
 * Auto Reply Service
 * Core orchestration service that coordinates all auto-reply modules
 */

import {
  ScrapedTweet,
  TweetEvaluation,
  GeneratedReply,
  ReplyRecord,
  AutoReplySettings,
  AutoReplySession,
  AutoReplyEvent,
  AutoReplyEventCallback,
  ActivityLogEntry,
  DailyStats,
  DEFAULT_AUTO_REPLY_SETTINGS,
  STORAGE_KEYS,
  SessionStatus
} from '../types/autoReply';
import { TimelineScroller } from '../utils/TimelineScroller';
import { TweetEvaluator } from '../utils/TweetEvaluator';
import { ReplyGenerator } from '../utils/ReplyGenerator';
import { ReplyPoster } from '../utils/ReplyPoster';
import { HumanBehaviorSimulator } from '../utils/HumanBehaviorSimulator';
import { NotificationProcessor } from '../utils/NotificationProcessor';
import { apiDataCache } from '../utils/ApiDataCache';
import { ApiTweetProvider } from '../utils/ApiTweetProvider';
import { authService } from './authService';
import { navigateToUrl } from '../utils/navigationUtils';
import { reportService } from './reportService';

class AutoReplyService {
  private static instance: AutoReplyService;

  // Components
  private scroller: TimelineScroller | null = null;
  private apiTweetProvider: ApiTweetProvider | null = null;
  private evaluator: TweetEvaluator | null = null;
  private generator: ReplyGenerator | null = null;
  private poster: ReplyPoster | null = null;
  private notificationProcessor: NotificationProcessor | null = null;

  // State
  private session: AutoReplySession | null = null;
  private settings: AutoReplySettings = DEFAULT_AUTO_REPLY_SETTINGS;
  private pendingTweet: ScrapedTweet | null = null;  // Single tweet to process (no queue)
  private dailyStats: DailyStats | null = null;
  private lastReplyTime: Date | null = null;

  // Deduplication tracking
  private processedTweetIds: Set<string> = new Set();  // Already processed tweets (posted/skipped)
  private processingTweetIds: Set<string> = new Set(); // Currently being processed tweets
  private tweetsProcessedCount: number = 0;             // Counter for cleanup trigger

  // Event listeners
  private eventListeners: AutoReplyEventCallback[] = [];

  // Activity log
  private activityLog: ActivityLogEntry[] = [];

  // Confirmation state
  private pendingConfirmation: {
    resolve: (confirmed: boolean) => void;
    reject: (error: Error) => void;
  } | null = null;

  // Highlight Overlay Tracking
  private currentHighlightOverlay: HTMLElement | null = null;

  private constructor() {
    this.loadSettings();
    this.loadDailyStats();
  }

  static getInstance(): AutoReplyService {
    if (!AutoReplyService.instance) {
      AutoReplyService.instance = new AutoReplyService();
    }
    return AutoReplyService.instance;
  }

  // ============ Public API ============

  /**
   * Start auto-reply session
   */
  async start(customSettings?: Partial<AutoReplySettings>): Promise<void> {
    console.log('[AutoReplyService] start() called');
    console.log('[AutoReplyService] Current session:', this.session);
    console.log('[AutoReplyService] Current session status:', this.session?.status);

    if (this.session && this.session.status !== 'stopped' && this.session.status !== 'idle') {
      console.log('[AutoReplyService] Session already running, ignoring start request');
      return;
    }

    // Apply custom settings
    if (customSettings) {
      console.log('[AutoReplyService] Applying custom settings:', customSettings);
      this.updateSettings(customSettings);
    }

    console.log('[AutoReplyService] Active Settings - Min Interval:', this.settings.minIntervalSeconds, 'Max Interval:', this.settings.maxIntervalSeconds);

    // Start API data cache listener (for exposure prediction)
    console.log('[AutoReplyService] Starting API data cache...');
    apiDataCache.start();

    // Clear old logs (but keep queue/history)
    this.clearActivityLog();

    // Create new session
    this.session = {
      id: crypto.randomUUID(),
      startTime: new Date(),
      status: 'scrolling', // Start in active state
      tweetsScanned: 0,
      tweetsEvaluated: 0,
      repliesPosted: 0,
      repliesFailed: 0,
      repliesSkipped: 0,
      replyHistory: [],
      errors: [],
      tokensUsed: 0,
      evaluationCount: 0,
      generationCount: 0,
      currentReasoning: '' // Reset reasoning text
    };

    console.log('[AutoReplyService] Session created:', this.session.id);

    // Initialize deduplication state
    console.log('[AutoReplyService] Initializing deduplication...');
    this.processingTweetIds.clear(); // Clear processing state for new session
    this.tweetsProcessedCount = 0;
    // this.cleanOldProcessedTweets(); // DON'T clean history on start, preserves previous memory
    console.log('[AutoReplyService] Deduplication initialized, tracked tweets:', this.processedTweetIds.size);

    // Initialize components
    console.log('[AutoReplyService] Initializing components...');
    this.initializeComponents();
    console.log('[AutoReplyService] Components initialized');

    // Start the main loop
    console.log('[AutoReplyService] Emitting session_start event');
    this.emit({ type: 'session_start', data: { sessionId: this.session.id }, timestamp: new Date() });
    this.addToLog('session_start', 'Auto Reply session started');
    console.log('[AutoReplyService] Event listeners count:', this.eventListeners.length);

    // Start report tracking
    reportService.startPeriod();

    // Initial Navigation Logic
    if (this.settings.onlyProcessNotifications) {
      if (!window.location.pathname.includes('/notifications')) {
        console.log('[AutoReplyService] Notification Mode: Navigating directly to notifications');
        this.addToLog('debug', 'Navigating directly to Notifications page...');

        // Visual feedback: Highlight the notifications link
        const notificationLink = document.querySelector('a[data-testid="AppTabBar_Notifications_Link"]') as HTMLElement;
        if (notificationLink) {
          const originalPosition = notificationLink.style.position;

          // Create Bloom Animation Overlay
          const overlay = document.createElement('div');

          // Try to match parent border radius (sidebar icons are often circular)
          const computedStyle = window.getComputedStyle(notificationLink);
          // Just inherit, don't force circle
          const borderRadius = computedStyle.borderRadius;

          Object.assign(overlay.style, {
            position: 'absolute',
            top: '0', left: '0', width: '100%', height: '100%',
            pointerEvents: 'none',
            zIndex: '9999',
            borderRadius: borderRadius,
            boxSizing: 'border-box',

            // Highlight Style
            border: '4px solid rgba(29, 155, 240, 0.3)',
            boxShadow: 'inset 0 0 15px 2px rgba(29, 155, 240, 0.1)',

            // Animation Initial State
            opacity: '0',
            transition: 'opacity 0.5s ease-out'
          });

          notificationLink.style.position = 'relative'; // Ensure anchor is relative
          notificationLink.appendChild(overlay);

          // Trigger Fade In
          requestAnimationFrame(() => {
            overlay.style.opacity = '1';
          });

          // Wait a bit for user to see
          await new Promise(resolve => setTimeout(resolve, 1000));

          // Clean up
          overlay.remove();
          notificationLink.style.position = originalPosition;

          // Click it for native nav
          notificationLink.click();
        } else {
          // Fallback if link not found
          navigateToUrl('/notifications');
        }

        // Wait for nav completion
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    } else {
      // Home timeline mode: Always click Home button to trigger fresh API request
      // This ensures cache has the latest data even if it already has some entries
      console.log('[AutoReplyService] Home Mode: Clicking Home button to trigger API refresh');
      this.addToLog('debug', 'Clicking Home to load fresh timeline data...');

      const homeLink = document.querySelector('a[data-testid="AppTabBar_Home_Link"]') as HTMLElement;
      if (homeLink) {
        homeLink.click();
      } else {
        navigateToUrl('/home');
      }

      // Wait for navigation and API response
      await new Promise(resolve => setTimeout(resolve, 1500));

      // Wait for API data to arrive (timeline interceptor populates cache)
      console.log('[AutoReplyService] Waiting for API data to populate cache...');
      this.addToLog('debug', 'Waiting for timeline data...');

      const maxWaitTime = 10000; // 10 seconds max
      const checkInterval = 500;
      let waited = 0;

      while (waited < maxWaitTime) {
        const cacheSize = apiDataCache.size();
        console.log(`[AutoReplyService] Cache size: ${cacheSize}, waited: ${waited}ms`);
        if (cacheSize > 0) {
          console.log('[AutoReplyService] API data received, cache has', cacheSize, 'tweets');
          this.addToLog('debug', `Timeline data loaded (${cacheSize} tweets cached)`);
          break;
        }
        await new Promise(resolve => setTimeout(resolve, checkInterval));
        waited += checkInterval;
      }

      if (apiDataCache.size() === 0) {
        // Clicking Home while already on Home may not trigger a new API request.
        // Use manual fetch as fallback.
        console.log('[AutoReplyService] No API data after Home click, trying manual fetch...');
        this.addToLog('debug', 'Triggering manual timeline fetch...');
        window.postMessage({ type: 'BNBOT_REFRESH_TIMELINE' }, '*');

        // Wait for manual fetch to complete
        const manualWaitMax = 8000;
        let manualWaited = 0;
        while (manualWaited < manualWaitMax) {
          if (apiDataCache.size() > 0) {
            console.log('[AutoReplyService] Manual fetch succeeded, cache has', apiDataCache.size(), 'tweets');
            this.addToLog('debug', `Timeline data loaded via manual fetch (${apiDataCache.size()} tweets cached)`);
            break;
          }
          await new Promise(resolve => setTimeout(resolve, checkInterval));
          manualWaited += checkInterval;
        }

        if (apiDataCache.size() === 0) {
          console.warn('[AutoReplyService] No API data received after manual fetch');
          this.addToLog('warning', 'No cached data available, some tweets may be skipped');
        }
      }
    }

    console.log('[AutoReplyService] About to call runLoop()');
    await this.runLoop();
    console.log('[AutoReplyService] runLoop() completed');
  }

  /**
   * Pause the session
   */
  pause(): void {
    if (this.session && this.session.status !== 'stopped') {
      this.session.status = 'paused';
      this.scroller?.pause();
      // Cancel any ongoing AI operations
      this.evaluator?.cancel();
      this.generator?.cancel();
      this.emit({ type: 'session_pause', timestamp: new Date() });
      this.addToLog('session_pause', 'Session paused');
    }
  }

  /**
   * Resume the session
   */
  resume(): void {
    if (this.session && this.session.status === 'paused') {
      this.session.status = 'scrolling';
      this.scroller?.resume();
      this.emit({ type: 'session_resume', timestamp: new Date() });
      this.addToLog('session_resume', 'Session resumed');
      this.runLoop();
    }
  }

  /**
   * Stop the session
   */
  stop(): void {
    if (this.session) {
      this.session.status = 'stopped';
      this.session.endTime = new Date();
      this.scroller?.stop();
      this.evaluator?.cancel();
      this.generator?.cancel();

      // Save API tweet provider state
      this.apiTweetProvider?.saveProcessedToStorage();

      // Stop API data cache listener
      apiDataCache.stop();

      // Clean up deduplication state
      console.log('[AutoReplyService] Cleaning up deduplication state...');
      this.processingTweetIds.clear();

      this.emit({ type: 'session_end', data: { session: this.session }, timestamp: new Date() });
      this.addToLog('session_end', `Session ended. Posted: ${this.session.repliesPosted}, Failed: ${this.session.repliesFailed}`);

      // Send autopilot_complete to backend for Telegram notification
      this.sendAutopilotComplete();

      // Send report to Telegram (if connected)
      try {
        reportService.sendReport();
      } catch (e) {
        console.warn('[AutoReplyService] Failed to send report:', e);
      }

      // Save session and stats
      this.saveSession();
      this.saveDailyStats();
    }
  }

  /**
   * Send autopilot complete notification to backend
   */
  private sendAutopilotComplete(): void {
    try {
      // Dynamic import to avoid circular dependency
      import('./commandService').then(({ commandService }) => {
        if (commandService.isConnected() && this.session) {
          const durationMs = this.session.endTime && this.session.startTime
            ? this.session.endTime.getTime() - this.session.startTime.getTime()
            : 0;

          commandService.send({
            type: 'autopilot_complete',
            session: {
              tweetsScanned: this.session.tweetsScanned,
              repliesPosted: this.session.repliesPosted,
              repliesFailed: this.session.repliesFailed,
              durationMinutes: Math.round(durationMs / 60000),
              stopReason: this.session.status === 'stopped' ? 'manual' : 'completed',
              topReplies: this.activityLog
                .filter(log => log.type === 'reply_posted')
                .slice(-3)
                .map(log => ({
                  author: log.details?.authorHandle || 'unknown',
                  content: log.details?.replyContent || log.message
                }))
            }
          });
          console.log('[AutoReplyService] Sent autopilot_complete to backend');
        }
      });
    } catch (e) {
      console.warn('[AutoReplyService] Failed to send autopilot_complete:', e);
    }
  }

  /**
   * Confirm or reject current reply
   */
  confirmReply(confirmed: boolean): void {
    if (this.pendingConfirmation) {
      this.pendingConfirmation.resolve(confirmed);
      this.pendingConfirmation = null;
    }
  }

  /**
   * Edit and confirm current reply
   */
  editAndConfirmReply(newContent: string): void {
    if (this.session?.currentReply) {
      this.session.currentReply.content = newContent;
    }
    this.confirmReply(true);
  }

  /**
   * Update settings
   */
  updateSettings(newSettings: Partial<AutoReplySettings>): void {
    this.settings = { ...this.settings, ...newSettings };
    this.saveSettings();
    this.emit({ type: 'settings_changed', data: this.settings, timestamp: new Date() });

    // Update components if initialized
    this.evaluator?.updateSettings(this.settings);
    this.generator?.updateSettings(this.settings);
  }

  /**
   * Get current settings
   */
  getSettings(): AutoReplySettings {
    return { ...this.settings };
  }

  /**
   * Get current session
   */
  getSession(): AutoReplySession | null {
    return this.session ? { ...this.session } : null;
  }

  /**
   * Check if running
   */
  isRunning(): boolean {
    return this.session !== null &&
      this.session.status !== 'stopped' &&
      this.session.status !== 'idle' &&
      this.session.status !== 'paused';
  }

  /**
   * Get daily stats
   */
  getDailyStats(): DailyStats | null {
    return this.dailyStats ? { ...this.dailyStats } : null;
  }

  /**
   * Get activity log
   */
  getActivityLog(): ActivityLogEntry[] {
    return [...this.activityLog];
  }

  /**
   * Clear activity log
   */
  clearActivityLog(): void {
    this.activityLog = [];
  }

  /**
   * Add event listener
   */
  addEventListener(callback: AutoReplyEventCallback): void {
    this.eventListeners.push(callback);
  }

  /**
   * Remove event listener
   */
  removeEventListener(callback: AutoReplyEventCallback): void {
    const index = this.eventListeners.indexOf(callback);
    if (index > -1) {
      this.eventListeners.splice(index, 1);
    }
  }

  // ============ External Session (for scheduled executor) ============

  /**
   * Create a session for external callers (e.g., AutoReplyTaskExecutor).
   * This allows the UI to show stats, tweet cards, reasoning, etc.
   */
  createExternalSession(): void {
    if (this.session && this.session.status !== 'stopped' && this.session.status !== 'idle') {
      return; // Don't overwrite an active session
    }
    this.session = {
      id: `sched_${Date.now()}`,
      startTime: new Date(),
      status: 'scrolling',
      tweetsScanned: 0,
      tweetsEvaluated: 0,
      repliesPosted: 0,
      repliesFailed: 0,
      repliesSkipped: 0,
      replyHistory: [],
      errors: [],
      tokensUsed: 0,
      evaluationCount: 0,
      generationCount: 0,
    };
    this.emit({ type: 'session_start', data: { sessionId: this.session.id }, timestamp: new Date() });
  }

  /**
   * Update session state from external caller
   */
  updateExternalSession(updates: Partial<AutoReplySession>): void {
    if (!this.session) return;
    Object.assign(this.session, updates);
    this.emit({ type: 'stats_update', data: this.session, timestamp: new Date() });
  }

  /**
   * End an external session
   */
  endExternalSession(): void {
    if (!this.session) return;
    this.session.status = 'stopped';
    this.session.endTime = new Date();
    this.emit({ type: 'session_end', data: { session: this.session }, timestamp: new Date() });
  }

  // ============ Deduplication Methods ============

  /**
   * Check if a tweet has been processed (posted or skipped)
   */
  private hasProcessedTweet(tweetId: string): boolean {
    // Check already processed set
    if (this.processedTweetIds.has(tweetId)) {
      return true;
    }

    // Check if currently being processed
    if (this.processingTweetIds.has(tweetId)) {
      return true;
    }

    // Check session reply history
    if (this.session?.replyHistory.some(r => r.tweetId === tweetId)) {
      return true;
    }

    return false;
  }

  /**
   * Mark a tweet as currently being processed
   */
  private markTweetAsProcessing(tweetId: string): void {
    this.processingTweetIds.add(tweetId);
    console.log('[AutoReplyService] Marked tweet as processing:', tweetId);
  }

  /**
   * Mark a tweet as processed (completed processing)
   * Only marks as processed if status is 'posted' or 'skipped'
   * Failed tweets are allowed to retry
   */
  private markTweetAsProcessed(tweetId: string, status: 'posted' | 'failed' | 'skipped'): void {
    // Remove from processing
    this.processingTweetIds.delete(tweetId);

    // Only mark as processed for successful/skipped cases
    if (status === 'posted' || status === 'skipped') {
      this.processedTweetIds.add(tweetId);
      this.tweetsProcessedCount++;

      // Sync to TimelineScroller
      if (this.scroller) {
        this.scroller.markAsProcessed(tweetId);
      }

      console.log(`[AutoReplyService] Marked tweet as ${status}:`, tweetId);

      // Trigger cleanup every 1000 tweets
      if (this.tweetsProcessedCount % 1000 === 0) {
        this.cleanOldProcessedTweets();
      }
    } else {
      console.log(`[AutoReplyService] Tweet ${status}, allowing retry:`, tweetId);
    }
  }

  /**
   * Load processed tweets from session history and scroller
   */
  private loadProcessedTweets(): void {
    // Clear and rebuild from history
    this.processedTweetIds.clear();

    if (this.session?.replyHistory) {
      this.session.replyHistory.forEach(record => {
        // Only include posted and skipped tweets
        if (record.status === 'posted' || record.status === 'skipped') {
          this.processedTweetIds.add(record.tweetId);
        }
      });
    }

    console.log('[AutoReplyService] Loaded processed tweets:', this.processedTweetIds.size);
  }

  /**
   * Clean tweets older than 48 hours from processing records
   */
  private cleanOldProcessedTweets(): void {
    const now = Date.now();
    const maxAge = 48 * 60 * 60 * 1000; // 48 hours in milliseconds

    // Filter out old records from reply history
    if (this.session?.replyHistory) {
      const beforeCount = this.session.replyHistory.length;
      this.session.replyHistory = this.session.replyHistory.filter(record => {
        const age = now - new Date(record.timestamp).getTime();
        return age < maxAge;
      });
      const removedCount = beforeCount - this.session.replyHistory.length;

      if (removedCount > 0) {
        console.log(`[AutoReplyService] Cleaned ${removedCount} tweets older than 48 hours`);
      }
    }

    // Rebuild processedTweetIds from cleaned history
    this.processedTweetIds.clear();
    if (this.session?.replyHistory) {
      this.session.replyHistory.forEach(record => {
        if (record.status === 'posted' || record.status === 'skipped') {
          this.processedTweetIds.add(record.tweetId);
        }
      });
    }

    console.log('[AutoReplyService] After cleanup, tracked tweets:', this.processedTweetIds.size);
  }

  // ============ Image Generation Methods ============

  /**
   * Generate image based on prompt
   * Uses the same API as RewrittenTimeline
   */
  private async generateReplyImage(prompt: string): Promise<Blob | null> {
    try {
      console.log('[AutoReplyService] Generating image with prompt:', prompt);
      this.addToLog('image_generation', `Generating image: ${prompt.substring(0, 50)}...`);

      const formData = new FormData();
      formData.append('prompt', prompt);
      formData.append('model', 'nano-banana');

      const response = await authService.fetchWithAuth(
        'http://localhost:8000/api/v1/ai/generate-image',
        {
          method: 'POST',
          body: formData,
        }
      );

      if (!response.ok) {
        let errorMsg = `Image generation failed: ${response.status}`;
        try {
          const errorBody = await response.json();
          if (typeof errorBody.detail === 'string') {
            errorMsg = errorBody.detail;
          } else if (Array.isArray(errorBody.detail) && errorBody.detail.length > 0) {
            const firstError = errorBody.detail[0];
            errorMsg = typeof firstError === 'string' ? firstError : (firstError.msg || JSON.stringify(firstError));
          } else if (typeof errorBody.detail === 'object') {
            errorMsg = JSON.stringify(errorBody.detail);
          } else if (errorBody.message) {
            errorMsg = errorBody.message;
          }
        } catch {
          // Keep original status-based message
        }
        console.error('[AutoReplyService] Image generation error details:', errorMsg);
        throw new Error(errorMsg);
      }

      const result = await response.json();

      if (!result.data || !result.data[0]) {
        throw new Error('No image data in response');
      }

      // Convert base64 to Blob
      const base64Data = result.data[0].b64_json;
      const mimeType = result.data[0].mime_type || 'image/png';
      const byteString = atob(base64Data);
      const ab = new ArrayBuffer(byteString.length);
      const ia = new Uint8Array(ab);

      for (let i = 0; i < byteString.length; i++) {
        ia[i] = byteString.charCodeAt(i);
      }

      const blob = new Blob([ab], { type: mimeType });

      console.log('[AutoReplyService] Image generated successfully, size:', blob.size);
      this.addToLog('image_generated', `Image generated (${(blob.size / 1024).toFixed(1)}KB)`);

      return blob;
    } catch (error) {
      console.error('[AutoReplyService] Image generation failed:', error);
      this.addToLog('image_failed', `Image generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      this.handleError(error instanceof Error ? error : new Error(String(error)), 'Image Generation');
      return null;
    }
  }

  // ============ Private Methods ============

  private initializeComponents(): void {
    // Initialize API tweet provider (replaces DOM-based scraping for auto-reply)
    this.apiTweetProvider = new ApiTweetProvider();

    // Initialize scroller (still needed for NotificationProcessor and other features)
    this.scroller = new TimelineScroller({
      onTweetFound: (tweet) => {
        // No longer used for auto-reply pipeline (ApiTweetProvider handles it)
        // Kept for NotificationProcessor compatibility
      },
      onScrollComplete: () => {
        // Continue processing
      },
      onError: (error) => {
        this.handleError(error, 'Scroller');
      }
    });

    this.notificationProcessor = new NotificationProcessor(this.scroller);

    // Initialize evaluator
    this.evaluator = new TweetEvaluator({
      settings: this.settings,
      onEvaluationStart: (tweet) => {
        if (this.session) {
          const timestamp = new Date().toLocaleTimeString();
          const header = `\n\n---\n**Evaluation for @${tweet.authorHandle} (${timestamp})**\n\n`;
          this.session.currentReasoning = (this.session.currentReasoning || '') + header;
        }
        this.emit({ type: 'tweet_evaluating', data: tweet, timestamp: new Date() });
        const followers = tweet.authorFollowers !== undefined ? this.formatNumber(tweet.authorFollowers) + ' followers' : '';
        this.addToLog('tweet_evaluating', `Evaluating @${tweet.authorHandle}${followers ? ` (${followers})` : ''}`);
        if (tweet.authorBio) {
          this.addToLog('debug', `   Bio: "${tweet.authorBio.slice(0, 50)}${tweet.authorBio.length > 50 ? '...' : ''}"`);
        }
        this.addToLog('api_request', `→ API: Sending evaluation request`);
      },
      onReasoning: (chunk) => {
        if (this.session && this.session.status !== 'paused' && this.session.status !== 'stopped') {
          this.session.currentReasoning = (this.session.currentReasoning || '') + chunk;
          this.emit({ type: 'reasoning_update', data: { chunk, full: this.session.currentReasoning }, timestamp: new Date() });
        }
      },
      onEvaluationComplete: (evaluation) => {
        if (this.session) {
          this.session.tweetsEvaluated++;
          this.session.evaluationCount++;
          // Extended thinking uses more tokens: ~2000 input + ~3000 reasoning/output
          this.session.tokensUsed += 5000;
        }
        this.addToLog('api_response', `← API: Evaluation complete`);
      },
      onError: (error) => {
        this.handleError(error, 'Evaluator');
      }
    });

    // Initialize generator
    this.generator = new ReplyGenerator({
      settings: this.settings,
      onGenerationStart: (tweet) => {
        if (this.session) {
          const timestamp = new Date().toLocaleTimeString();
          const header = `\n\n**Generating Reply (${timestamp})**\n\n`;
          this.session.currentReasoning = (this.session.currentReasoning || '') + header;
        }
        this.emit({ type: 'reply_generating', data: tweet, timestamp: new Date() });
        this.addToLog('reply_generating', `Generating reply for @${tweet.authorHandle}...`);
        this.addToLog('api_request', `→ API: Sending generation request`);
      },
      onContentChunk: (chunk) => {
        // Can be used for streaming display
      },
      onReasoning: (chunk) => {
        if (this.session && this.session.status !== 'paused' && this.session.status !== 'stopped') {
          this.session.currentReasoning = (this.session.currentReasoning || '') + chunk;
          this.emit({ type: 'reasoning_update', data: { chunk, full: this.session.currentReasoning }, timestamp: new Date() });
        }
      },
      onGenerationComplete: (reply) => {
        if (this.session) {
          this.session.generationCount++;
          // Extended thinking uses more tokens: ~1500 input + ~2500 reasoning/output
          this.session.tokensUsed += 4000;
        }
        this.addToLog('api_response', `← API: Reply generated (${reply.content.length} chars)`);
      },
      onError: (error) => {
        this.handleError(error, 'Generator');
      }
    });

    // Initialize poster
    this.poster = new ReplyPoster({
      onPostStart: (tweetId) => {
        this.emit({ type: 'reply_posting', data: { tweetId }, timestamp: new Date() });
        this.addToLog('reply_posting', 'Posting reply...');
      },
      onPostSuccess: (tweetId) => {
        if (this.session) {
          this.session.repliesPosted++;
        }
        if (this.dailyStats) {
          this.dailyStats.repliesPosted++;
        }
        this.lastReplyTime = new Date();
        this.emit({ type: 'reply_posted', data: { tweetId }, timestamp: new Date() });
        this.addToLog('reply_posted', 'Reply posted successfully!');
      },
      onPostError: (tweetId, error) => {
        if (this.session) {
          this.session.repliesFailed++;
        }
        if (this.dailyStats) {
          this.dailyStats.repliesFailed++;
        }
        this.emit({ type: 'reply_failed', data: { tweetId, error: error.message }, timestamp: new Date() });
        this.addToLog('reply_failed', `Failed to post reply: ${error.message}`);
      }
    });
  }

  private async runLoop(): Promise<void> {
    console.log('[AutoReplyService.runLoop] Started, session:', this.session?.id);
    if (!this.session) {
      console.error('[AutoReplyService.runLoop] No session, returning');
      return;
    }

    console.log('[AutoReplyService.runLoop] Entering main loop');
    while (this.session.status !== 'stopped') {
      // Check if paused
      if (this.session.status === 'paused') {
        console.log('[AutoReplyService.runLoop] Session paused, waiting...');
        await new Promise(resolve => setTimeout(resolve, 500));
        continue;
      }

      // Check session limit
      if (this.session.repliesPosted >= this.settings.sessionLimit) {
        this.addToLog('session_end', 'Session limit reached');
        this.stop();
        break;
      }

      // Get next tweet if none pending
      if (!this.pendingTweet) {
        // Check if restricted to notifications only
        if (this.settings.onlyProcessNotifications) {
          console.log('[AutoReplyService] Only processing notifications. Checking for new notifications...');
          this.session.status = 'scrolling'; // Status 'scrolling' implies looking for work
          this.addToLog('scrolling', 'Checking notifications...');

          try {
            const tweets = await this.notificationProcessor?.fetchTweetsFromNextNotification();
            if (tweets && tweets.length > 0) {
              console.log(`[AutoReplyService] Found ${tweets.length} tweets from notifications`);
              // Take only the first one
              this.pendingTweet = tweets[0];
              this.addToLog('tweet_found', `Found tweet from notification`);
            } else {
              console.log('[AutoReplyService] No tweets found from notifications. Waiting...');
              this.session.status = 'waiting';
              this.addToLog('debug', 'No new notifications to process. Waiting...');
              await new Promise(resolve => setTimeout(resolve, 5000));
            }
          } catch (error) {
            console.error('[AutoReplyService] Notification processing failed:', error);
            await new Promise(resolve => setTimeout(resolve, 5000));
          }
        } else {
          // Use ApiTweetProvider to get tweets from API cache (no DOM scraping)
          console.log('[AutoReplyService.runLoop] No pending tweet, reading from API cache...');
          this.session.status = 'scrolling';
          this.emit({ type: 'scrolling', timestamp: new Date() });

          if (this.apiTweetProvider) {
            const batch = this.apiTweetProvider.getNextBatch(1);

            if (batch.length > 0) {
              const tweet = batch[0];

              // Check deduplication
              if (!this.hasProcessedTweet(tweet.id)) {
                this.pendingTweet = tweet;
                this.apiTweetProvider.markAsProcessed(tweet.id);
                this.emit({ type: 'tweet_found', data: tweet, timestamp: new Date() });
                const tweetAge = this.formatTweetAge(tweet.timestamp);
                const views = this.formatNumber(tweet.metrics.views);
                const likes = this.formatNumber(tweet.metrics.likes);
                const verified = tweet.isVerified ? ' (verified)' : '';
                const media = tweet.media.length > 0 ? ` [${tweet.media.length} media]` : '';
                this.addToLog('tweet_found', `@${tweet.authorHandle}${verified} · ${views} views · ${likes} likes · ${tweetAge}${media}`);
                this.addToLog('debug', `   "${tweet.content.slice(0, 60)}${tweet.content.length > 60 ? '...' : ''}"`);
                this.addToLog('debug', `   ID: ${tweet.id} (from API cache)`);
              }
            } else {
              // Cache exhausted, scroll to trigger new API requests
              console.log('[AutoReplyService.runLoop] API cache exhausted, scrolling for more...');
              this.addToLog('scrolling', 'Cache exhausted, scrolling to load more tweets...');
              const gotMore = await this.apiTweetProvider.scrollForMore();
              if (!gotMore) {
                console.log('[AutoReplyService.runLoop] No new tweets after scrolling');
                this.addToLog('debug', 'No new tweets found after scrolling');
                // Short wait before retrying
                await new Promise(resolve => setTimeout(resolve, 2000));
              }
            }
          }
          console.log('[AutoReplyService.runLoop] API cache read completed, pendingTweet:', !!this.pendingTweet);
        }
      }

      // Process the pending tweet
      if (this.pendingTweet) {
        console.log(`[AutoReplyService.runLoop] Processing tweet: ${this.pendingTweet.id}`);
        const wasActionTaken = await this.processNextTweet();
        console.log(`[AutoReplyService.runLoop] processNextTweet result: ${wasActionTaken}`);

        // Only wait if an action was taken (reply sent)
        // Skip waiting if tweet was rejected/skipped for faster processing
        if (wasActionTaken) {
          const waitTime = HumanBehaviorSimulator.calculateReplyInterval(
            this.settings.minIntervalSeconds,
            this.settings.maxIntervalSeconds
          );

          console.log(`[AutoReplyService.runLoop] Action taken. Waiting for ${waitTime}ms (Settings: ${this.settings.minIntervalSeconds}-${this.settings.maxIntervalSeconds}s)`);

          const waitStart = Date.now();
          const waitEndTime = waitStart + waitTime;
          this.session.waitEndTime = waitEndTime;

          this.session.status = 'waiting';
          this.emit({ type: 'waiting', data: { waitTimeMs: waitTime, waitEndTime }, timestamp: new Date() });
          this.addToLog('waiting', `Waiting ${Math.round(waitTime / 1000)}s before next action...`);

          await new Promise(resolve => setTimeout(resolve, waitTime));
          console.log(`[AutoReplyService.runLoop] Wait complete. Actual waittime: ${Date.now() - waitStart}ms`);

          if (this.session) {
            this.session.waitEndTime = undefined;
          }
        } else {
          // Short micro-pause before next evaluation
          console.log('[AutoReplyService.runLoop] No action taken (skipped). Micro-pausing.');
          await HumanBehaviorSimulator.microPause();
        }
      }
    }
  }

  private async processNextTweet(): Promise<boolean> {
    if (!this.session || !this.evaluator || !this.generator || !this.poster) return false;

    // ===== Pre-check: Ensure we're on home timeline =====
    if (window.location.pathname.includes('/status/')) {
      console.log('[AutoReplyService] Still on tweet detail page, returning to timeline first...');
      this.addToLog('debug', 'Returning to home timeline...');
      await this.poster.returnToTimeline();
      // Extra wait to ensure we're back
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Double check
      if (window.location.pathname.includes('/status/')) {
        console.error('[AutoReplyService] Failed to return to timeline, skipping this cycle');
        this.addToLog('error', 'Failed to return to timeline');
        return false;
      }
    }

    const tweet = this.pendingTweet;
    this.pendingTweet = null;  // Clear immediately (single tweet mode)
    if (!tweet) return false;

    // Final safety check before processing
    if (this.hasProcessedTweet(tweet.id)) {
      console.warn('[AutoReplyService] Tweet was already processed, skipping:', tweet.id);
      return false;
    }

    // Mark as currently being processed
    this.markTweetAsProcessing(tweet.id);

    this.session.currentTweet = tweet;
    this.session.tweetsScanned++;
    reportService.recordScan(); // Track for report
    this.addToLog('debug', `Processing tweet #${this.session.tweetsScanned}`);

    // Scroll to tweet for visibility
    this.scrollToTweet(tweet);

    // 1. Evaluate
    this.session.status = 'evaluating';
    const evaluation = await this.evaluator.evaluate(tweet);
    this.session.currentEvaluation = evaluation;

    // Check pause after long evaluation
    if (!this.isRunning()) {
      this.session.currentTweet = undefined;
      this.session.currentEvaluation = undefined;
      return false;
    }

    this.emit({ type: 'tweet_evaluated', data: evaluation, timestamp: new Date() });
    // Show exposure prediction instead of score (exposure is the real decision factor)
    const exposureText = tweet.expectedExposure ? `Exposure: ${this.formatNumber(tweet.expectedExposure)}` : `Score: ${evaluation.score}`;
    this.addToLog('tweet_evaluated', `${exposureText} - ${evaluation.shouldReply ? 'Will reply' : 'Skipped'}`);

    // Append evaluation result to reasoning (Thought Process panel)
    if (this.session) {
      if (evaluation.shouldReply) {
        const resultText = `\n\n**>> Will reply** — ${exposureText}, Score: ${evaluation.score}\n`;
        this.session.currentReasoning = (this.session.currentReasoning || '') + resultText;
      } else {
        const reason = evaluation.reasons?.[0] || 'Low score';
        const resultText = `\n\n**>> Skipped @${tweet.authorHandle}** — ${reason}\n`;
        this.session.currentReasoning = (this.session.currentReasoning || '') + resultText;
      }
      this.emit({ type: 'reasoning_update', data: { chunk: '', full: this.session.currentReasoning }, timestamp: new Date() });
    }

    if (!evaluation.shouldReply) {
      this.session.repliesSkipped++;
      reportService.recordSkip(); // Track for report
      this.addToLog('tweet_skipped', `Skipped @${tweet.authorHandle} - ${evaluation.reasons?.[0] || 'Low score'}`);
      this.emit({ type: 'tweet_skipped', data: { tweet, evaluation }, timestamp: new Date() });
      this.session.currentTweet = undefined;
      this.session.currentEvaluation = undefined;

      // Mark as skipped (don't retry)
      this.markTweetAsProcessed(tweet.id, 'skipped');
      return false; // No action taken
    }

    // 1.5 Navigate to tweet detail page (User requested: Navigate -> Generate -> Post)
    this.session.status = 'scrolling'; // Re-use scrolling or define new status 'navigating'? 'scrolling' is fine for UI
    this.addToLog('debug', 'Navigating to tweet detail page...');

    // We stay on timeline for evaluation, but navigate before generation
    try {
      const navSuccess = await this.poster.ensureOnTweetPage(tweet);
      if (!navSuccess) {
        throw new Error('Failed to navigate to tweet detail page');
      }
    } catch (error) {
      this.handleError(error instanceof Error ? error : new Error(String(error)), 'Navigation');
      // Navigation failed, we probably can't proceed with this tweet
      this.processingTweetIds.delete(tweet.id);
      this.session.currentTweet = undefined;
      this.session.currentEvaluation = undefined;
      return false;
    }

    // 2. Generate reply
    this.session.status = 'generating';
    let reply: GeneratedReply;
    try {
      reply = await this.generator.generate(tweet, evaluation);
      this.session.currentReply = reply;
      this.emit({ type: 'reply_generated', data: reply, timestamp: new Date() });
      this.addToLog('reply_generated', `Reply: "${reply.content.substring(0, 50)}..."`);
    } catch (error) {
      this.handleError(error instanceof Error ? error : new Error(String(error)), 'Generation');

      // Clean up state but allow retry (don't mark as processed)
      this.processingTweetIds.delete(tweet.id);
      this.session.currentTweet = undefined;
      this.session.currentEvaluation = undefined;

      return false; // No action taken due to error
    }

    // Check pause after generation
    if (!this.isRunning()) {
      this.session.currentTweet = undefined;
      this.session.currentEvaluation = undefined;
      this.session.currentReply = undefined;

      // Session paused/stopped - allow retry
      this.processingTweetIds.delete(tweet.id);

      // Return to timeline since we navigated
      await this.poster.returnToTimeline();

      return false;
    }

    // 2.5. Generate image if needed (NEW)
    // Only if image generation is enabled in settings
    if (this.settings.enableImageGeneration && reply.needsImage && reply.imagePrompt) {
      this.session.status = 'generating_image';
      this.addToLog('image_generation', `AI decided image is needed: ${reply.imagePrompt.substring(0, 50)}...`);

      const imageBlob = await this.generateReplyImage(reply.imagePrompt);

      if (imageBlob) {
        this.session.currentImageBlob = imageBlob;
        console.log('[AutoReplyService] Image ready for reply');
      } else {
        console.warn('[AutoReplyService] Image generation failed, will send text-only reply');
        this.addToLog('image_failed', 'Image generation failed, proceeding with text-only reply');
        // Continue with text-only reply (失败降级)
      }
    }

    // Check pause after image generation
    if (!this.isRunning()) {
      this.session.currentTweet = undefined;
      this.session.currentEvaluation = undefined;
      this.session.currentReply = undefined;
      this.session.currentImageBlob = undefined;  // 新增清理
      this.processingTweetIds.delete(tweet.id);

      // Return to timeline since we navigated
      await this.poster.returnToTimeline();

      return false;
    }

    // 3. Check confirmation requirement
    if (this.settings.requireConfirmation) {
      this.session.status = 'confirming';
      this.emit({ type: 'reply_confirming', data: { tweet, reply }, timestamp: new Date() });
      this.addToLog('reply_confirming', 'Waiting for user confirmation...');

      const confirmed = await this.waitForUserConfirmation();
      this.emit({ type: 'reply_confirmed', data: { confirmed }, timestamp: new Date() });

      if (!confirmed) {
        this.session.repliesSkipped++;
        this.addToLog('tweet_skipped', 'User skipped this reply');
        this.session.currentTweet = undefined;
        this.session.currentEvaluation = undefined;
        this.session.currentReply = undefined;
        this.session.currentImageBlob = undefined;  // 清理图片blob

        // Mark as skipped (user explicitly skipped)
        this.markTweetAsProcessed(tweet.id, 'skipped');

        // Return to timeline
        await this.poster.returnToTimeline();

        return false; // User rejected
      }
    }

    // 4. Post reply (unless dry run)
    if (!this.settings.dryRunMode) {
      this.session.status = 'posting';
      const success = await this.poster.postReply(
        tweet,
        this.session.currentReply?.content || reply.content,
        this.session.currentImageBlob  // 新增参数：图片blob
      );

      // Record history
      const record: ReplyRecord = {
        id: crypto.randomUUID(),
        tweetId: tweet.id,
        authorHandle: tweet.authorHandle,
        tweetContent: tweet.content,
        replyContent: reply.content,
        status: success ? 'posted' : 'failed',
        timestamp: new Date(),
        error: success ? undefined : 'Post failed'
      };
      this.session.replyHistory.push(record);

      if (success) {
        // Mark as successfully posted
        this.markTweetAsProcessed(tweet.id, 'posted');

        // Record reply for context (avoid repetitive styles in future replies)
        const postedContent = this.session.currentReply?.content || reply.content;
        this.generator?.recordReply(tweet.authorHandle, postedContent);

        // Track for report
        reportService.recordReply(
          tweet.authorHandle,
          tweet.content,
          postedContent,
          evaluation.score
        );

        // Return to timeline
        await this.poster.returnToTimeline();
      } else {
        // Post failed - allow retry
        this.markTweetAsProcessed(tweet.id, 'failed');

        // Return to timeline even on failure, to continue loop
        await this.poster.returnToTimeline();
      }
    } else {
      // Dry run - simulate navigation and log
      this.session.status = 'posting'; // Show posting status briefly
      this.addToLog('reply_posting', '[DRY RUN] Simulating typing (no send)...');

      // Visual typing simulation (including image if available)
      const content = this.session.currentReply?.content || reply.content;
      await this.poster.simulateTyping(tweet, content, this.session.currentImageBlob);

      // Log success
      this.addToLog('reply_posted', '[DRY RUN] Would have posted reply');
      this.emit({ type: 'reply_posted', data: { tweet, reply, dryRun: true }, timestamp: new Date() });

      // Dry run counts as processed
      this.markTweetAsProcessed(tweet.id, 'posted');

      // Return to timeline
      await this.poster.returnToTimeline();

      // Clear image blob
      this.session.currentImageBlob = undefined;
    }

    // Clear current state
    this.session.currentTweet = undefined;
    this.session.currentEvaluation = undefined;
    this.session.currentReply = undefined;
    this.session.currentImageBlob = undefined;  // 新增清理

    // Save session
    this.saveSession();
    this.saveDailyStats();

    // Emit stats update
    this.emit({ type: 'stats_update', data: this.session, timestamp: new Date() });

    return true; // Action was taken
  }

  private async waitForUserConfirmation(): Promise<boolean> {
    return new Promise((resolve, reject) => {
      this.pendingConfirmation = { resolve, reject };

      // Auto-timeout after 5 minutes
      setTimeout(() => {
        if (this.pendingConfirmation) {
          this.pendingConfirmation.resolve(false);
          this.pendingConfirmation = null;
        }
      }, 5 * 60 * 1000);
    });
  }

  private handleError(error: Error, context: string): void {
    // Ignore abort errors (caused by pause/stop)
    if (error.name === 'AbortError' || error.message.includes('aborted')) {
      console.log(`[AutoReplyService] ${context} aborted (user paused/stopped)`);
      return;
    }

    console.error(`[AutoReplyService] ${context} error:`, error);

    if (this.session) {
      this.session.errors.push({
        timestamp: new Date(),
        message: `${context}: ${error.message}`
      });
    }

    this.emit({ type: 'error', data: { context, message: error.message }, timestamp: new Date() });
    this.addToLog('error', `${context}: ${error.message}`);

    // Check for critical errors
    if (error.message.includes('401') || error.message.includes('auth')) {
      this.pause();
      this.addToLog('error', 'Authentication error - session paused');
    }
  }

  private scrollToTweet(tweet: ScrapedTweet): void {
    try {
      let element = tweet.articleElement;

      // Re-query if stale
      if (!element || !element.isConnected) {
        // Find by link presence
        // Note: This matches the tweet detail link which is always present in the timestamp or status link
        const link = document.querySelector(`a[href*="/status/${tweet.id}"]`);
        if (link) {
          element = link.closest('article') as HTMLElement;
        }
      }

      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });

        // 1. Remove any existing highlight first
        this.clearCurrentHighlight();

        // 2. Create new Bloom Overlay
        const overlay = document.createElement('div');

        // Match standard tweet card radius (usually 0 or small)
        const computedStyle = window.getComputedStyle(element);
        const radius = computedStyle.borderRadius;

        Object.assign(overlay.style, {
          position: 'absolute',
          top: '0', left: '0', width: '100%', height: '100%',
          pointerEvents: 'none',
          zIndex: '99999',
          borderRadius: radius,
          boxSizing: 'border-box',

          // Standard "Blue Fade" style
          border: '4px solid rgba(29, 155, 240, 0.3)',
          boxShadow: 'inset 0 0 15px 2px rgba(29, 155, 240, 0.1)',

          // Animation
          opacity: '0',
          transition: 'opacity 0.6s ease-out'
        });

        // Ensure parent is relative
        const originalPosition = element.style.position || 'static';
        if (originalPosition === 'static') {
          element.style.position = 'relative';
        }

        element.appendChild(overlay);
        this.currentHighlightOverlay = overlay; // Track it

        // Trigger Fade In
        requestAnimationFrame(() => {
          if (overlay) overlay.style.opacity = '1';
        });

        // Highlight persists until next tweet (cleared by clearCurrentHighlight at start of scrollToTweet)
      }
    } catch (e) {
      console.warn('[AutoReplyService] Scroll failed:', e);
    }
  }

  // Helper to remove highlight immediately
  private clearCurrentHighlight(): void {
    if (this.currentHighlightOverlay) {
      this.currentHighlightOverlay.remove();
      this.currentHighlightOverlay = null;
    }
  }

  private emit(event: AutoReplyEvent): void {
    console.log(`[AutoReplyService] Emitting event: ${event.type}, listeners: ${this.eventListeners.length}`);
    this.eventListeners.forEach((listener, idx) => {
      try {
        console.log(`[AutoReplyService] Calling listener ${idx + 1}/${this.eventListeners.length}`);
        listener(event);
        console.log(`[AutoReplyService] Listener ${idx + 1} completed`);
      } catch (e) {
        console.error('[AutoReplyService] Event listener error:', e);
      }
    });
  }

  /**
   * Subscribe to auto-reply events
   */
  subscribe(callback: AutoReplyEventCallback): void {
    if (!this.eventListeners.includes(callback)) {
      this.eventListeners.push(callback);
      console.log('[AutoReplyService] Subscriber added, total:', this.eventListeners.length);
    }
  }

  /**
   * Unsubscribe from auto-reply events
   */
  unsubscribe(callback: AutoReplyEventCallback): void {
    const index = this.eventListeners.indexOf(callback);
    if (index > -1) {
      this.eventListeners.splice(index, 1);
      console.log('[AutoReplyService] Subscriber removed, total:', this.eventListeners.length);
    }
  }

  public addToLog(type: AutoReplyEvent['type'] | string, message: string, details?: Record<string, any>): void {
    const entry: ActivityLogEntry = {
      id: crypto.randomUUID(),
      timestamp: new Date(),
      type: type as AutoReplyEvent['type'],
      message,
      details
    };

    this.activityLog.push(entry);

    // Keep only last 100 entries
    if (this.activityLog.length > 100) {
      this.activityLog.shift();
    }

    // Emit event to notify listeners
    this.emit({ type: type as AutoReplyEvent['type'], data: { message, details }, timestamp: new Date() });
  }

  private formatNumber(num: number): string {
    if (num >= 1000000) {
      return (num / 1000000).toFixed(1) + 'M';
    } else if (num >= 1000) {
      return (num / 1000).toFixed(1) + 'K';
    }
    return num.toString();
  }

  private formatTweetAge(timestamp: string): string {
    const tweetDate = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - tweetDate.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 60) {
      return `${diffMins}m ago`;
    } else if (diffHours < 24) {
      return `${diffHours}h ago`;
    } else {
      return `${diffDays}d ago`;
    }
  }

  // ============ Storage Methods ============

  private async loadSettings(): Promise<void> {
    try {
      const result = await chrome.storage.local.get(STORAGE_KEYS.AUTO_REPLY_SETTINGS);
      if (result[STORAGE_KEYS.AUTO_REPLY_SETTINGS]) {
        this.settings = {
          ...DEFAULT_AUTO_REPLY_SETTINGS,
          ...JSON.parse(result[STORAGE_KEYS.AUTO_REPLY_SETTINGS] as string)
        };
      }
    } catch (e) {
      console.error('[AutoReplyService] Failed to load settings:', e);
    }
  }

  private async saveSettings(): Promise<void> {
    try {
      await chrome.storage.local.set({
        [STORAGE_KEYS.AUTO_REPLY_SETTINGS]: JSON.stringify(this.settings)
      });
    } catch (e) {
      console.error('[AutoReplyService] Failed to save settings:', e);
    }
  }

  private async loadDailyStats(): Promise<void> {
    try {
      const today = new Date().toISOString().split('T')[0];
      const result = await chrome.storage.local.get(STORAGE_KEYS.AUTO_REPLY_DAILY_STATS);

      if (result[STORAGE_KEYS.AUTO_REPLY_DAILY_STATS]) {
        const stats = JSON.parse(result[STORAGE_KEYS.AUTO_REPLY_DAILY_STATS] as string);
        if (stats.date === today) {
          this.dailyStats = stats;
        } else {
          // New day, reset stats
          this.dailyStats = {
            date: today,
            repliesPosted: 0,
            repliesFailed: 0,
            repliesSkipped: 0,
            tweetsScanned: 0,
            tokensUsed: 0
          };
        }
      } else {
        this.dailyStats = {
          date: today,
          repliesPosted: 0,
          repliesFailed: 0,
          repliesSkipped: 0,
          tweetsScanned: 0,
          tokensUsed: 0
        };
      }
    } catch (e) {
      console.error('[AutoReplyService] Failed to load daily stats:', e);
    }
  }

  private async saveDailyStats(): Promise<void> {
    if (!this.dailyStats) return;

    // Update from session
    if (this.session) {
      this.dailyStats.tweetsScanned += this.session.tweetsScanned;
      this.dailyStats.tokensUsed = this.session.tokensUsed;
    }

    try {
      await chrome.storage.local.set({
        [STORAGE_KEYS.AUTO_REPLY_DAILY_STATS]: JSON.stringify(this.dailyStats)
      });
    } catch (e) {
      console.error('[AutoReplyService] Failed to save daily stats:', e);
    }
  }

  private async saveSession(): Promise<void> {
    if (!this.session) return;

    try {
      await chrome.storage.local.set({
        [STORAGE_KEYS.AUTO_REPLY_SESSION]: JSON.stringify(this.session)
      });
    } catch (e) {
      console.error('[AutoReplyService] Failed to save session:', e);
    }
  }
}

// Export singleton instance
export const autoReplyService = AutoReplyService.getInstance();
