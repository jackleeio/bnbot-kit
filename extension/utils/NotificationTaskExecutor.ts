/**
 * NotificationTaskExecutor
 * HANDLE_NOTIFICATION scheduled task executor
 *
 * Executes two phases:
 * 1. Process new post notifications (configurable time range, count, like probability)
 * 2. Process reply notifications (configurable count, reply probability, like probability)
 */

import { ScrapedTweet, TweetEvaluation, GeneratedReply, DEFAULT_AUTO_REPLY_SETTINGS, ActivityLogEntry } from '../types/autoReply';
import { NotificationProcessor } from './NotificationProcessor';
import { TimelineScroller } from './TimelineScroller';
import { TweetEvaluator } from './TweetEvaluator';
import { ReplyGenerator } from './ReplyGenerator';
import { ReplyPoster } from './ReplyPoster';
import { replyNotificationStorage, ProcessedReply } from './ReplyNotificationStorage';
import { HumanBehaviorSimulator } from './HumanBehaviorSimulator';
import { predictExposure } from '../services/exposurePredictionService';
import { TimelineTweetData } from './HomeTimelineMonitor';
import { navigateToUrl } from './navigationUtils';

/**
 * Parsed notification tweet from NotificationsTimeline API
 */
interface NotificationTweetEntry {
  tweetId: string;
  authorHandle: string;
  authorName: string;
  authorAvatar: string;
  authorBio: string;
  authorFollowers: number;
  content: string;
  timestamp: string;
  tweetUrl: string;
  metrics: { replies: number; retweets: number; likes: number; views: number };
  media: { type: 'photo' | 'video'; url: string }[];
}

/**
 * Notification task settings interface
 */
export interface NotificationTaskSettings {
  // Phase 1: New post notifications
  phase1Enabled: boolean;           // Enable processing new post notifications
  phase1MaxCount: number;           // Max notifications to process (default 20)
  phase1MaxTweetAge: number;        // Max tweet age in minutes (default 30)
  phase1MinExpectedExposure: number; // Min expected exposure to process (default 0 = no filter)

  // Phase 2: Reply notifications
  phase2Enabled: boolean;           // Enable processing reply notifications
  phase2MaxCount: number;           // Max notifications to process (default 50)
  phase2ReplyProbability: number;   // Reply probability 0-1 (default 0.7)
  phase2MinExpectedExposure: number; // Min expected exposure to process (default 0 = no filter)

  // Common settings
  minWaitSeconds: number;           // Min wait time between notifications (default 5)
  maxWaitSeconds: number;           // Max wait time between notifications (default 10)

  // Reply style settings
  replyTone: 'professional' | 'casual' | 'humorous' | 'match_author';
  maxReplyLength: number;           // Max reply length (default 280)
  customInstructions: string;       // Custom prompt/instructions for reply generation

  // Filter settings
  targetTweetTypes: string;         // What types of tweets to process
  excludeHandles: string[];         // Accounts to skip
}

export const DEFAULT_NOTIFICATION_TASK_SETTINGS: NotificationTaskSettings = {
  phase1Enabled: true,
  phase1MaxCount: 20,
  phase1MaxTweetAge: 60,
  phase1MinExpectedExposure: 0,

  phase2Enabled: true,
  phase2MaxCount: 20,
  phase2ReplyProbability: 0.7,
  phase2MinExpectedExposure: 0,

  minWaitSeconds: 5,
  maxWaitSeconds: 10,

  replyTone: 'casual',
  maxReplyLength: 280,
  customInstructions: '',

  targetTweetTypes: '',
  excludeHandles: [],
};

/**
 * Execution result interface
 */
export interface NotificationTaskResult {
  phase1: {
    processed: number;
    replied: number;
    liked: number;
    skipped: number;
  };
  phase2: {
    processed: number;
    replied: number;
    liked: number;
    skipped: number;
  };
  errors: string[];
  duration: number;
}

/**
 * Event types for notification task
 */
export type NotificationTaskEventType =
  | 'session_start' | 'session_end'
  | 'phase_start' | 'phase_end'
  | 'navigating' | 'notification_found' | 'no_notifications'
  | 'tweet_found' | 'tweet_evaluating' | 'tweet_evaluated' | 'tweet_skipped'
  | 'reply_generating' | 'reply_generated' | 'reply_posting' | 'reply_posted' | 'reply_failed'
  | 'waiting' | 'error' | 'debug' | 'stats_update';

export interface NotificationTaskEvent {
  type: NotificationTaskEventType;
  data?: any;
  timestamp: Date;
}

export type NotificationTaskEventCallback = (event: NotificationTaskEvent) => void;

export class NotificationTaskExecutor {
  private processor: NotificationProcessor;
  private scroller: TimelineScroller;
  private evaluator: TweetEvaluator;
  private generator: ReplyGenerator;
  private poster: ReplyPoster;
  private settings: NotificationTaskSettings;
  private isRunning: boolean = false;
  private isStopped: boolean = false;
  private isPaused: boolean = false;

  // Event system
  private eventListeners: NotificationTaskEventCallback[] = [];
  private activityLog: ActivityLogEntry[] = [];
  private logIdCounter = 0;

  // Current state for UI display
  private _currentTweet: ScrapedTweet | null = null;
  private _currentEvaluation: TweetEvaluation | null = null;
  private _currentReasoning: string = '';

  // Blue highlight overlay for the tweet being processed
  private currentHighlightOverlay: HTMLElement | null = null;

  constructor(settings: Partial<NotificationTaskSettings> = {}) {
    this.settings = { ...DEFAULT_NOTIFICATION_TASK_SETTINGS, ...settings };

    // Initialize components
    this.scroller = new TimelineScroller({
      onTweetFound: () => {},
      tweetsPerBatch: 5,
      maxScrollAttempts: 10
    });

    this.processor = new NotificationProcessor(this.scroller);

    // Build AutoReplySettings — disable metric filters since notification task
    // has its own filtering (phase1MinExpectedExposure, phase1MaxTweetAge, etc.)
    const autoReplySettings = this.buildAutoReplySettings();

    this.evaluator = new TweetEvaluator({
      settings: autoReplySettings,
      onEvaluationStart: (tweet) => {
        this._currentTweet = tweet;
        this._currentEvaluation = null;
        this.addToLog('tweet_evaluating', `Evaluating @${tweet.authorHandle}: "${tweet.content.substring(0, 60)}..."`);
        this.emit({ type: 'tweet_evaluating', data: { tweet }, timestamp: new Date() });
      },
      onEvaluationComplete: (evaluation) => {
        this._currentEvaluation = evaluation;
        const reasons = evaluation.reasons?.join(', ') || '';
        if (evaluation.shouldReply) {
          this.addToLog('tweet_evaluated', `Will reply (score: ${evaluation.score}) ${reasons}`);
        } else {
          this.addToLog('tweet_skipped', `Skipped (score: ${evaluation.score}) ${reasons}`);
        }
        // Write evaluation result to reasoning so the panel has content immediately
        const evalSummary = `**Evaluation**\nScore: ${evaluation.score} | Reply: ${evaluation.shouldReply ? 'Yes' : 'No'}\n${reasons}\n\n`;
        this._currentReasoning += evalSummary;
        this.emit({ type: 'stats_update', data: { reasoning: this._currentReasoning }, timestamp: new Date() });
        this.emit({ type: 'tweet_evaluated', data: { evaluation }, timestamp: new Date() });
      },
      onReasoning: (chunk) => {
        this._currentReasoning += chunk;
        this.emit({ type: 'stats_update', data: { reasoning: this._currentReasoning }, timestamp: new Date() });
      }
    });

    this.generator = new ReplyGenerator({
      settings: autoReplySettings,
      onGenerationStart: (tweet) => {
        this._currentReasoning += '**Generating Reply**\n';
        this.emit({ type: 'stats_update', data: { reasoning: this._currentReasoning }, timestamp: new Date() });
        this.addToLog('reply_generating', `Generating reply for @${tweet.authorHandle}...`);
        this.emit({ type: 'reply_generating', data: { tweet }, timestamp: new Date() });
      },
      onReasoning: (chunk) => {
        this._currentReasoning += chunk;
        this.emit({ type: 'stats_update', data: { reasoning: this._currentReasoning }, timestamp: new Date() });
      },
      onContentChunk: (chunk) => {
        this._currentReasoning += chunk;
        this.emit({ type: 'stats_update', data: { reasoning: this._currentReasoning }, timestamp: new Date() });
      },
      onGenerationComplete: (reply) => {
        this.addToLog('reply_generated', `Reply: "${reply.content.substring(0, 80)}..."`);
        this.emit({ type: 'reply_generated', data: { reply }, timestamp: new Date() });
      }
    });

    this.poster = new ReplyPoster({
      onPostStart: (tweetId) => {
        this.addToLog('reply_posting', `Posting reply to ${tweetId}...`);
      },
      onPostSuccess: (tweetId) => {
        this.addToLog('reply_posted', `Reply posted successfully to ${tweetId}`);
      },
      onPostError: (tweetId, error) => {
        this.addToLog('reply_failed', `Failed to post reply to ${tweetId}: ${error.message}`);
      }
    });
  }

  /**
   * Build AutoReplySettings for the evaluator/generator.
   * Disables metric-based filters since the notification task has its own filtering logic.
   */
  private buildAutoReplySettings() {
    return {
      ...DEFAULT_AUTO_REPLY_SETTINGS,
      // Disable metric filters — notification task uses its own exposure/age filtering
      minExpectedExposure: 0,
      minFollowerCount: 0,
      minLikeCount: 0,
      minTweetViews: 0,
      maxTweetAgeHours: 0,  // 0 = disabled; notification task uses phase1MaxTweetAge
      // Propagate user-configured settings
      replyTone: this.settings.replyTone,
      maxReplyLength: this.settings.maxReplyLength,
      customInstructions: this.settings.customInstructions,
      targetTweetTypes: this.settings.targetTweetTypes,
      excludeHandles: this.settings.excludeHandles,
    };
  }

  // ============ Event System ============

  addEventListener(callback: NotificationTaskEventCallback): void {
    this.eventListeners.push(callback);
  }

  removeEventListener(callback: NotificationTaskEventCallback): void {
    const index = this.eventListeners.indexOf(callback);
    if (index > -1) this.eventListeners.splice(index, 1);
  }

  private emit(event: NotificationTaskEvent): void {
    this.eventListeners.forEach(listener => {
      try { listener(event); } catch (e) { console.error('[NotificationTaskExecutor] Event listener error:', e); }
    });
  }

  private addToLog(type: string, message: string, details?: Record<string, any>): void {
    const entry: ActivityLogEntry = {
      id: `ntask-${++this.logIdCounter}`,
      timestamp: new Date(),
      type,
      message,
      details,
    };
    this.activityLog.push(entry);
    // Keep log size manageable
    if (this.activityLog.length > 500) {
      this.activityLog = this.activityLog.slice(-300);
    }
    console.log(`[NotificationTaskExecutor] [${type}] ${message}`);
    this.emit({ type: type as NotificationTaskEventType, data: { message, details }, timestamp: new Date() });
  }

  getActivityLog(): ActivityLogEntry[] {
    return [...this.activityLog];
  }

  clearActivityLog(): void {
    this.activityLog = [];
    this.logIdCounter = 0;
  }

  getCurrentTweet(): ScrapedTweet | null {
    return this._currentTweet;
  }

  getCurrentEvaluation(): TweetEvaluation | null {
    return this._currentEvaluation;
  }

  getCurrentReasoning(): string {
    return this._currentReasoning;
  }

  // ============ Settings ============

  /**
   * Update settings and propagate to evaluator/generator
   */
  updateSettings(settings: Partial<NotificationTaskSettings>): void {
    this.settings = { ...this.settings, ...settings };
    // Propagate to evaluator and generator
    const autoReplySettings = this.buildAutoReplySettings();
    this.evaluator.updateSettings(autoReplySettings);
    this.generator.updateSettings(autoReplySettings);
  }

  // ============ Execution ============

  /**
   * Execute the notification task
   */
  async execute(): Promise<NotificationTaskResult> {
    if (this.isRunning) {
      console.warn('[NotificationTaskExecutor] Already running');
      return {
        phase1: { processed: 0, replied: 0, liked: 0, skipped: 0 },
        phase2: { processed: 0, replied: 0, liked: 0, skipped: 0 },
        errors: ['Task already running'],
        duration: 0
      };
    }

    this.isRunning = true;
    this.isStopped = false;
    this.isPaused = false;
    this._currentTweet = null;
    this._currentEvaluation = null;
    this._currentReasoning = '';
    const startTime = Date.now();

    // Clear scroller's processed tweet IDs to avoid stale filtering
    this.scroller.clearProcessedHistory();

    const result: NotificationTaskResult = {
      phase1: { processed: 0, replied: 0, liked: 0, skipped: 0 },
      phase2: { processed: 0, replied: 0, liked: 0, skipped: 0 },
      errors: [],
      duration: 0
    };

    this.addToLog('session_start', 'Notification task started');
    this.emit({ type: 'session_start', data: { settings: this.settings }, timestamp: new Date() });

    try {
      // Phase 1: Process new post notifications
      if (this.settings.phase1Enabled) {
        await this.executePhase1(result);
      } else {
        this.addToLog('debug', 'Phase 1 disabled, skipping');
      }

      // Phase 2: Process reply notifications
      if (this.settings.phase2Enabled) {
        await this.executePhase2(result);
      } else {
        this.addToLog('debug', 'Phase 2 disabled, skipping');
      }

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.addToLog('error', `Task error: ${errorMsg}`);
      result.errors.push(errorMsg);
    } finally {
      this.isRunning = false;
      result.duration = Date.now() - startTime;
      const summary = `Task completed in ${(result.duration / 1000).toFixed(1)}s — ` +
        `P1: ${result.phase1.processed} processed, ${result.phase1.replied} replied, ${result.phase1.skipped} skipped | ` +
        `P2: ${result.phase2.processed} processed, ${result.phase2.replied} replied, ${result.phase2.skipped} skipped`;
      this.addToLog('session_end', summary);
      this.emit({ type: 'session_end', data: { result }, timestamp: new Date() });
    }

    return result;
  }

  /**
   * Phase 1: Process new post notifications
   * Clicks notifications to enter /i/timeline, scrapes multiple tweets,
   * processes each tweet, navigates back to /i/timeline between tweets,
   * then returns to /notifications only when all tweets from that notification are done.
   */
  private async executePhase1(result: NotificationTaskResult): Promise<void> {
    this.addToLog('phase_start', `Phase 1: Processing new post notifications (max ${this.settings.phase1MaxCount})`);
    this.emit({ type: 'phase_start', data: { phase: 1 }, timestamp: new Date() });

    let totalProcessed = 0;
    let notifIndex = 0;

    // Outer loop: iterate over notification entries
    while (totalProcessed < this.settings.phase1MaxCount && !this.isStopped) {
      // Check pause state
      if (this.isPaused) {
        this.addToLog('debug', 'Phase 1 paused, waiting to resume...');
        if (!await this.waitWhilePaused()) break;
      }

      notifIndex++;

      try {
        this.addToLog('navigating', `Scanning notifications for new posts (notification #${notifIndex})...`);

        // Click next unprocessed notification → enters /i/timeline
        const tweets = await this.processor.fetchTweetsFromNextNotification(5);

        if (tweets.length === 0) {
          this.addToLog('no_notifications', 'No more new post notifications found');
          break;
        }

        this.addToLog('notification_found', `Entered timeline with ${tweets.length} tweet(s)`);

        // Inner loop: process each tweet from this notification's timeline
        for (let tweetIdx = 0; tweetIdx < tweets.length; tweetIdx++) {
          if (this.isStopped || totalProcessed >= this.settings.phase1MaxCount) break;

          // Check pause state between tweets
          if (this.isPaused) {
            this.addToLog('debug', 'Paused between tweets, waiting to resume...');
            if (!await this.waitWhilePaused()) break;
          }

          const tweet = tweets[tweetIdx];
          this.addToLog('tweet_found', `Tweet ${tweetIdx + 1}/${tweets.length} from @${tweet.authorHandle}: "${tweet.content.substring(0, 60)}..."`, {
            tweetId: tweet.id,
            timestamp: tweet.timestamp,
            metrics: tweet.metrics,
          });

          // Check if already replied to this tweet (persisted across sessions)
          if (tweet.id && await replyNotificationStorage.isTweetProcessed(tweet.id)) {
            this.addToLog('tweet_skipped', `Already replied to tweet ${tweet.id}, skipping`);
            result.phase1.skipped++;
            continue;
          }

          // Check tweet age
          if (this.settings.phase1MaxTweetAge > 0 && !this.isTweetWithinTimeRange(tweet.timestamp, this.settings.phase1MaxTweetAge)) {
            const ageMinutes = ((Date.now() - new Date(tweet.timestamp).getTime()) / 60000).toFixed(0);
            this.addToLog('tweet_skipped', `Tweet too old (${ageMinutes}min > ${this.settings.phase1MaxTweetAge}min)`);
            result.phase1.skipped++;
            continue;
          }

          // Check expected exposure if threshold is set
          if (this.settings.phase1MinExpectedExposure > 0) {
            const timelineData = this.convertToTimelineTweetData(tweet);
            const prediction = predictExposure(timelineData);
            tweet.expectedExposure = prediction.expected;
            this.addToLog('debug', `Exposure prediction: ${prediction.expected} (min: ${this.settings.phase1MinExpectedExposure})`);

            if (prediction.expected < this.settings.phase1MinExpectedExposure) {
              this.addToLog('tweet_skipped', `Expected exposure too low (${prediction.expected} < ${this.settings.phase1MinExpectedExposure})`);
              result.phase1.skipped++;
              continue;
            }
          }

          result.phase1.processed++;
          totalProcessed++;

          // Clear reasoning for new tweet
          this._currentReasoning = '';
          this._currentTweet = tweet;
          this._currentEvaluation = null;

          // Highlight the tweet being processed with blue border
          this.highlightTweet(tweet);

          this.emit({ type: 'tweet_evaluating', data: { tweet }, timestamp: new Date() });

          // Evaluate tweet
          const evaluation = await this.evaluator.evaluate(tweet);

          if (evaluation.shouldReply) {
            // Generate reply
            const reply = await this.generator.generate(tweet, evaluation);

            // Post reply (navigates to /status/xxx internally)
            const posted = await this.poster.postReply(tweet, reply.content);

            if (posted) {
              result.phase1.replied++;
              this.generator.recordReply(tweet.authorHandle, reply.content);

              // Persist so we don't reply to the same tweet again across sessions
              await replyNotificationStorage.markAsProcessed({
                notificationId: `phase1-${tweet.id}`,
                tweetId: tweet.id,
                authorHandle: tweet.authorHandle,
                processedAt: Date.now(),
              });
            }

            // Clear highlight
            this.clearHighlight();

            // Navigate back to /i/timeline (not /notifications) for next tweet
            if (tweetIdx < tweets.length - 1) {
              this.addToLog('navigating', 'Returning to timeline for next tweet...');
              await this.navigateBack();
            }
          } else {
            result.phase1.skipped++;
            this.clearHighlight();
          }

          // Wait with configurable delay between tweets
          if (tweetIdx < tweets.length - 1) {
            const waitMs = this.getRandomWaitTime();
            this.addToLog('waiting', `Waiting ${Math.round(waitMs / 1000)}s before next tweet...`);
            this.emit({ type: 'waiting', data: { waitTimeMs: waitMs }, timestamp: new Date() });
            await HumanBehaviorSimulator.randomDelay(waitMs, waitMs + 1000);
          }
        }

        // Done with this notification's timeline, go back to /notifications for next notification
        this.addToLog('navigating', 'Returning to notifications...');
        await this.navigateBackToNotifications();

        // Wait before processing next notification
        if (totalProcessed < this.settings.phase1MaxCount && !this.isStopped) {
          const waitMs = this.getRandomWaitTime();
          this.addToLog('waiting', `Waiting ${Math.round(waitMs / 1000)}s before next notification...`);
          this.emit({ type: 'waiting', data: { waitTimeMs: waitMs }, timestamp: new Date() });
          await HumanBehaviorSimulator.randomDelay(waitMs, waitMs + 1000);
        }

      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        this.addToLog('error', `Phase 1 error: ${errorMsg}`);
        result.errors.push(`Phase 1: ${errorMsg}`);

        // Try to recover by navigating to notifications
        this.clearHighlight();
        await this.navigateBackToNotifications();
      }
    }

    this.addToLog('phase_end', `Phase 1 complete: ${result.phase1.processed} processed, ${result.phase1.replied} replied, ${result.phase1.skipped} skipped`);
    this.emit({ type: 'phase_end', data: { phase: 1, result: result.phase1 }, timestamp: new Date() });
  }

  /**
   * Phase 2: Process reply notifications
   */
  private async executePhase2(result: NotificationTaskResult): Promise<void> {
    this.addToLog('phase_start', `Phase 2: Processing reply notifications (max ${this.settings.phase2MaxCount})`);
    this.emit({ type: 'phase_start', data: { phase: 2 }, timestamp: new Date() });

    for (let i = 0; i < this.settings.phase2MaxCount; i++) {
      if (this.isStopped) {
        this.addToLog('debug', 'Phase 2 stopped by user');
        result.errors.push('Stopped by user');
        break;
      }

      // Check pause state
      if (this.isPaused) {
        this.addToLog('debug', 'Phase 2 paused, waiting to resume...');
        if (!await this.waitWhilePaused()) break;
      }

      try {
        this.addToLog('debug', `Phase 2 iteration ${i + 1}/${this.settings.phase2MaxCount}`);

        // Fetch next reply notification
        const replyNotification = await this.processor.fetchNextReplyNotification();

        if (!replyNotification) {
          this.addToLog('no_notifications', 'No more reply notifications found');
          break;
        }

        this.addToLog('notification_found', `Reply notification from @${replyNotification.authorHandle}: "${replyNotification.previewText.substring(0, 60)}"`);

        // Check if it's from today
        if (!this.isToday(replyNotification.timestamp)) {
          this.addToLog('debug', 'Notification not from today, stopping Phase 2');
          break;
        }

        // Check if already processed
        if (await replyNotificationStorage.isProcessed(replyNotification.id)) {
          this.addToLog('tweet_skipped', `Already processed: ${replyNotification.id}`);
          result.phase2.skipped++;
          continue;
        }

        result.phase2.processed++;

        // Click to enter the notification
        this.addToLog('navigating', `Clicking notification from @${replyNotification.authorHandle}...`);
        await this.processor.clickNotification(replyNotification);

        // Wait for page to load
        await HumanBehaviorSimulator.randomDelay(2000, 3000);

        // Scrape the current tweet (the reply)
        const tweet = await this.processor.scrapCurrentTweet();

        if (tweet) {
          // Clear reasoning for new tweet
          this._currentReasoning = '';
          this._currentTweet = tweet;
          this._currentEvaluation = null;

          // Highlight the tweet being processed
          this.highlightTweet(tweet);

          this.addToLog('tweet_found', `Scraped reply tweet from @${tweet.authorHandle}: "${tweet.content.substring(0, 60)}..."`, {
            tweetId: tweet.id,
          });

          // Check if already replied to this tweet (persisted across sessions)
          if (tweet.id && await replyNotificationStorage.isTweetProcessed(tweet.id)) {
            this.addToLog('tweet_skipped', `Already replied to tweet ${tweet.id}, skipping`);
            result.phase2.skipped++;
            await this.navigateBack();
            continue;
          }

          // Check expected exposure if threshold is set
          if (this.settings.phase2MinExpectedExposure > 0) {
            const timelineData = this.convertToTimelineTweetData(tweet);
            const prediction = predictExposure(timelineData);
            this.addToLog('debug', `Exposure prediction: ${prediction.expected} (min: ${this.settings.phase2MinExpectedExposure})`);

            if (prediction.expected < this.settings.phase2MinExpectedExposure) {
              this.addToLog('tweet_skipped', `Expected exposure too low (${prediction.expected} < ${this.settings.phase2MinExpectedExposure})`);
              result.phase2.skipped++;
              await replyNotificationStorage.markAsProcessed({
                notificationId: replyNotification.id,
                tweetId: tweet.id,
                authorHandle: replyNotification.authorHandle,
                processedAt: Date.now()
              });
              await this.navigateBackToNotifications();
              continue;
            }
          }

          // Random decision to reply based on probability
          const roll = Math.random();
          if (roll < this.settings.phase2ReplyProbability) {
            this.addToLog('debug', `Reply probability check passed (${roll.toFixed(2)} < ${this.settings.phase2ReplyProbability})`);

            // Evaluate tweet
            const evaluation = await this.evaluator.evaluate(tweet);

            if (evaluation.shouldReply) {
              // Generate reply
              const reply = await this.generator.generate(tweet, evaluation);

              // Post reply
              const posted = await this.poster.postReply(tweet, reply.content);

              if (posted) {
                result.phase2.replied++;
                this.generator.recordReply(tweet.authorHandle, reply.content);
              }
            }
          } else {
            this.addToLog('tweet_skipped', `Reply probability check failed (${roll.toFixed(2)} >= ${this.settings.phase2ReplyProbability})`);
          }
        } else {
          this.addToLog('error', 'Failed to scrape tweet after clicking notification');
        }

        // Clear highlight before navigating away
        this.clearHighlight();

        // Mark as processed regardless of outcome
        await replyNotificationStorage.markAsProcessed({
          notificationId: replyNotification.id,
          tweetId: tweet?.id || '',
          authorHandle: replyNotification.authorHandle,
          processedAt: Date.now()
        });

        // Go back to the page we came from (history.back)
        this.addToLog('navigating', 'Going back...');
        await this.navigateBack();

        // Wait with configurable delay
        const waitMs = this.getRandomWaitTime();
        this.addToLog('waiting', `Waiting ${Math.round(waitMs / 1000)}s before next notification...`);
        this.emit({ type: 'waiting', data: { waitTimeMs: waitMs }, timestamp: new Date() });
        await HumanBehaviorSimulator.randomDelay(waitMs, waitMs + 1000);

      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        this.addToLog('error', `Phase 2 error: ${errorMsg}`);
        result.errors.push(`Phase 2: ${errorMsg}`);

        // Try to recover
        await this.navigateBackToNotifications();
      }
    }

    this.addToLog('phase_end', `Phase 2 complete: ${result.phase2.processed} processed, ${result.phase2.replied} replied, ${result.phase2.skipped} skipped`);
    this.emit({ type: 'phase_end', data: { phase: 2, result: result.phase2 }, timestamp: new Date() });
  }

  // ============ Helpers ============

  /**
   * Convert ScrapedTweet to TimelineTweetData for exposure prediction
   */
  private convertToTimelineTweetData(tweet: ScrapedTweet): TimelineTweetData {
    return {
      tweetId: tweet.id,
      username: tweet.authorHandle,
      displayName: tweet.authorName,
      profileImageUrl: tweet.authorAvatar || '',
      followers: tweet.authorFollowers || 0,
      following: 0,
      bio: tweet.authorBio || '',
      tweetText: tweet.content,
      replyCount: tweet.metrics?.replies || 0,
      retweetCount: tweet.metrics?.retweets || 0,
      likeCount: tweet.metrics?.likes || 0,
      viewCount: tweet.metrics?.views || 0,
      createdAt: tweet.timestamp,
      mediaType: 'none',
    };
  }

  /**
   * Navigate to /notifications, wait for NotificationsTimeline API data,
   * and parse notification tweet entries from the response.
   */
  private async fetchNotificationTweetsViaApi(): Promise<NotificationTweetEntry[]> {
    return new Promise<NotificationTweetEntry[]>(async (resolve) => {
      let resolved = false;
      const entries: NotificationTweetEntry[] = [];

      // Listen for the intercepted API data
      const handler = (event: MessageEvent) => {
        if (event.source !== window) return;
        if (event.data?.type !== 'BNBOT_API_DATA') return;
        if (event.data?.endpoint !== 'notifications') return;
        if (resolved) return;

        console.log('[NotificationTaskExecutor] Received NotificationsTimeline API data');
        const parsed = this.parseNotificationApiResponse(event.data.payload);
        entries.push(...parsed);

        // Resolve after receiving data
        resolved = true;
        window.removeEventListener('message', handler);
        resolve(entries);
      };

      window.addEventListener('message', handler);

      // Navigate to notifications page to trigger the API call
      this.addToLog('navigating', 'Navigating to notifications (waiting for API data)...');
      await this.navigateBackToNotifications();

      // Timeout fallback: if API data doesn't arrive within 10s, resolve with empty
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          window.removeEventListener('message', handler);
          console.warn('[NotificationTaskExecutor] Timeout waiting for notification API data');
          this.addToLog('error', 'Timeout waiting for notification API data');
          resolve(entries);
        }
      }, 10000);
    });
  }

  /**
   * Parse the NotificationsTimeline API response to extract tweet entries.
   * Handles multiple possible API response structures.
   */
  private parseNotificationApiResponse(data: any): NotificationTweetEntry[] {
    const entries: NotificationTweetEntry[] = [];

    try {
      // Try multiple possible paths for NotificationsTimeline response
      let instructions =
        data?.data?.notifications?.notifications_timeline_urt?.instructions ||
        data?.data?.notifications_all?.timeline?.instructions ||
        data?.data?.viewer?.notifications_timeline?.timeline?.instructions ||
        null;

      // Fallback: walk one level deep to find instructions
      if (!instructions && data?.data) {
        for (const key of Object.keys(data.data)) {
          const val = data.data[key];
          if (val?.instructions) { instructions = val.instructions; break; }
          if (val?.timeline?.instructions) { instructions = val.timeline.instructions; break; }
          if (val?.notifications_timeline_urt?.instructions) { instructions = val.notifications_timeline_urt.instructions; break; }
        }
      }

      if (!instructions || !Array.isArray(instructions)) {
        console.warn('[NotificationTaskExecutor] No instructions found in notification API data');
        return entries;
      }

      for (const instruction of instructions) {
        const instrEntries = instruction?.entries || [];
        if (instruction?.type === 'TimelineAddToModule' && instruction?.moduleItems) {
          // Handle module items
          for (const item of instruction.moduleItems) {
            this.extractTweetFromItemContent(item?.item?.itemContent, entries);
          }
        }
        for (const entry of instrEntries) {
          const content = entry?.content;
          // Direct tweet in notification
          this.extractTweetFromItemContent(content?.itemContent, entries);
          // Grouped notification items
          if (content?.items && Array.isArray(content.items)) {
            for (const item of content.items) {
              this.extractTweetFromItemContent(item?.item?.itemContent, entries);
            }
          }
        }
      }

      console.log(`[NotificationTaskExecutor] Parsed ${entries.length} tweets from notification API`);
    } catch (err) {
      console.error('[NotificationTaskExecutor] Error parsing notification API data:', err);
    }

    return entries;
  }

  /**
   * Extract a tweet entry from an itemContent object in the API response.
   */
  private extractTweetFromItemContent(itemContent: any, entries: NotificationTweetEntry[]): void {
    const tweetResult = itemContent?.tweet_results?.result;
    if (!tweetResult) return;

    try {
      const tweet = tweetResult?.tweet || tweetResult;
      const tweetId = tweet?.rest_id;
      if (!tweetId) return;

      // Skip retweets — we want original tweets
      const retweetedResult = tweet?.legacy?.retweeted_status_result?.result;
      const targetTweet = retweetedResult ? (retweetedResult?.tweet || retweetedResult) : tweet;
      const legacy = targetTweet?.legacy;
      if (!legacy) return;

      const userResult = targetTweet?.core?.user_results?.result;
      const userLegacy = userResult?.legacy;
      const userCore = userResult?.core;
      const screenName = userCore?.screen_name || userLegacy?.screen_name || '';

      let profileImageUrl = userResult?.avatar?.image_url || userLegacy?.profile_image_url_https || '';
      if (profileImageUrl) {
        profileImageUrl = profileImageUrl.replace('_normal.', '_bigger.');
      }

      const entry: NotificationTweetEntry = {
        tweetId: targetTweet?.rest_id || tweetId,
        authorHandle: screenName,
        authorName: userCore?.name || userLegacy?.name || '',
        authorAvatar: profileImageUrl,
        authorBio: userLegacy?.description || userResult?.profile_bio?.description || '',
        authorFollowers: userLegacy?.followers_count || 0,
        content: legacy.full_text || '',
        timestamp: legacy.created_at || '',
        tweetUrl: screenName ? `https://x.com/${screenName}/status/${targetTweet?.rest_id || tweetId}` : '',
        metrics: {
          replies: legacy.reply_count || 0,
          retweets: legacy.retweet_count || 0,
          likes: legacy.favorite_count || 0,
          views: parseInt(targetTweet?.views?.count || '0', 10),
        },
        media: this.extractMediaFromLegacy(legacy),
      };

      // Avoid duplicates
      if (!entries.some(e => e.tweetId === entry.tweetId)) {
        entries.push(entry);
      }
    } catch (err) {
      // Silently ignore individual parse errors
    }
  }

  /**
   * Extract media from tweet legacy data
   */
  private extractMediaFromLegacy(legacy: any): { type: 'photo' | 'video'; url: string }[] {
    const results: { type: 'photo' | 'video'; url: string }[] = [];
    const mediaList = legacy?.extended_entities?.media || legacy?.entities?.media || [];
    for (const item of mediaList) {
      if (item.type === 'video' || item.type === 'animated_gif') {
        const variants = item.video_info?.variants || [];
        let bestUrl = '';
        let bestBitrate = -1;
        for (const v of variants) {
          if (v.content_type === 'video/mp4' && (v.bitrate || 0) > bestBitrate) {
            bestBitrate = v.bitrate || 0;
            bestUrl = v.url;
          }
        }
        if (bestUrl) results.push({ type: 'video', url: bestUrl });
      } else if (item.type === 'photo') {
        results.push({ type: 'photo', url: item.media_url_https });
      }
    }
    return results;
  }

  /**
   * Convert a NotificationTweetEntry to ScrapedTweet for evaluation/generation.
   */
  private toScrapedTweet(entry: NotificationTweetEntry): ScrapedTweet {
    return {
      id: entry.tweetId,
      authorHandle: entry.authorHandle,
      authorName: entry.authorName,
      authorAvatar: entry.authorAvatar,
      authorBio: entry.authorBio,
      authorFollowers: entry.authorFollowers,
      content: entry.content,
      timestamp: entry.timestamp,
      tweetUrl: entry.tweetUrl,
      metrics: entry.metrics,
      media: entry.media,
      isRetweet: false,
      isQuote: false,
      source: 'notification',
    };
  }

  /**
   * Highlight a tweet in the DOM with a blue border overlay.
   * Finds the tweet's article element and adds a visual indicator.
   */
  private highlightTweet(tweet: ScrapedTweet): void {
    try {
      // Remove any existing highlight
      this.clearHighlight();

      // Find the tweet element in DOM
      let element = tweet.articleElement;
      if (!element || !element.isConnected) {
        const link = document.querySelector(`a[href*="/status/${tweet.id}"]`);
        if (link) {
          element = link.closest('article') as HTMLElement;
        }
      }

      if (!element) return;

      element.scrollIntoView({ behavior: 'smooth', block: 'center' });

      const overlay = document.createElement('div');
      const computedStyle = window.getComputedStyle(element);
      const radius = computedStyle.borderRadius;

      Object.assign(overlay.style, {
        position: 'absolute',
        top: '0', left: '0', width: '100%', height: '100%',
        pointerEvents: 'none',
        zIndex: '99999',
        borderRadius: radius,
        boxSizing: 'border-box',
        border: '4px solid rgba(29, 155, 240, 0.3)',
        boxShadow: 'inset 0 0 15px 2px rgba(29, 155, 240, 0.1)',
        opacity: '0',
        transition: 'opacity 0.6s ease-out',
      });

      const originalPosition = element.style.position || 'static';
      if (originalPosition === 'static') {
        element.style.position = 'relative';
      }

      element.appendChild(overlay);
      this.currentHighlightOverlay = overlay;

      requestAnimationFrame(() => {
        if (overlay) overlay.style.opacity = '1';
      });
    } catch (e) {
      console.warn('[NotificationTaskExecutor] Highlight failed:', e);
    }
  }

  /**
   * Remove the current highlight overlay.
   */
  private clearHighlight(): void {
    if (this.currentHighlightOverlay) {
      this.currentHighlightOverlay.remove();
      this.currentHighlightOverlay = null;
    }
  }

  private isTweetWithinTimeRange(timestamp: string, maxMinutes: number): boolean {
    try {
      const tweetDate = new Date(timestamp);
      const now = new Date();
      const diffMs = now.getTime() - tweetDate.getTime();
      const diffMinutes = diffMs / (1000 * 60);
      return diffMinutes <= maxMinutes;
    } catch {
      return false;
    }
  }

  private isToday(timestamp: string): boolean {
    try {
      const date = new Date(timestamp);
      const today = new Date();
      return date.toDateString() === today.toDateString();
    } catch {
      return false;
    }
  }

  /**
   * Go back one page in browser history (e.g. from /status/xxx back to /i/timeline)
   */
  private async navigateBack(): Promise<void> {
    const backButton = document.querySelector('[data-testid="app-bar-back"]') as HTMLElement;
    if (backButton) {
      backButton.click();
    } else {
      window.history.back();
    }
    await HumanBehaviorSimulator.randomDelay(2000, 3000);
  }

  private async navigateBackToNotifications(): Promise<void> {
    // Use sidebar link for reliable SPA navigation
    const navLink = document.querySelector('a[data-testid="AppTabBar_Notifications_Link"]') as HTMLElement;
    if (navLink) {
      navLink.click();
    } else {
      const tempLink = document.createElement('a');
      tempLink.href = '/notifications';
      tempLink.style.display = 'none';
      const reactRoot = document.getElementById('react-root') || document.body;
      reactRoot.appendChild(tempLink);
      tempLink.click();
      reactRoot.removeChild(tempLink);
    }

    // Wait for navigation and DOM cells to load
    await HumanBehaviorSimulator.randomDelay(2000, 3000);

    // Wait until notification cells appear in DOM (max 8s)
    const maxWait = 8000;
    const start = Date.now();
    while (Date.now() - start < maxWait) {
      const cells = document.querySelectorAll('div[data-testid="cellInnerDiv"]');
      if (cells.length > 0) break;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  private async navigateToTimeline(): Promise<void> {
    if (window.location.pathname === '/home' || window.location.pathname === '/') {
      return;
    }

    const homeLink = document.querySelector('a[data-testid="AppTabBar_Home_Link"]') as HTMLElement;
    if (homeLink) {
      homeLink.click();
    } else {
      const tempLink = document.createElement('a');
      tempLink.href = '/home';
      tempLink.style.display = 'none';
      const reactRoot = document.getElementById('react-root') || document.body;
      reactRoot.appendChild(tempLink);
      tempLink.click();
      reactRoot.removeChild(tempLink);
    }

    await HumanBehaviorSimulator.randomDelay(2000, 3000);
  }

  private getRandomWaitTime(): number {
    const minMs = this.settings.minWaitSeconds * 1000;
    const maxMs = this.settings.maxWaitSeconds * 1000;
    return Math.floor(Math.random() * (maxMs - minMs)) + minMs;
  }

  isTaskRunning(): boolean {
    return this.isRunning;
  }

  isTaskPaused(): boolean {
    return this.isPaused;
  }

  pause(): void {
    if (this.isRunning && !this.isPaused) {
      this.isPaused = true;
      this.addToLog('debug', 'Task paused by user');
      this.emit({ type: 'debug', data: { message: 'Task paused' }, timestamp: new Date() });
    }
  }

  resume(): void {
    if (this.isPaused) {
      this.isPaused = false;
      this.addToLog('debug', 'Task resumed by user');
      this.emit({ type: 'debug', data: { message: 'Task resumed' }, timestamp: new Date() });
    }
  }

  stop(): void {
    this.isStopped = true;
    this.isPaused = false;
    this.isRunning = false;
    this.addToLog('session_end', 'Task stopped by user');
  }

  /**
   * Wait while paused. Returns true if should continue, false if stopped.
   */
  private async waitWhilePaused(): Promise<boolean> {
    while (this.isPaused && !this.isStopped) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    return !this.isStopped;
  }
}

// Singleton instance
export const notificationTaskExecutor = new NotificationTaskExecutor();
