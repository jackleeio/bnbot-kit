/**
 * AutoReplyTaskExecutor
 * AUTO_REPLY 定时任务执行器
 *
 * 滚动时间线，评估推文，生成回复，发布回复
 * 返回统一格式的执行结果
 */

import { ScrapedTweet, TweetEvaluation, GeneratedReply, DEFAULT_AUTO_REPLY_SETTINGS, AutoReplySettings } from '../types/autoReply';
import { ApiTweetProvider } from './ApiTweetProvider';
import { TweetEvaluator } from './TweetEvaluator';
import { ReplyGenerator } from './ReplyGenerator';
import { ReplyPoster } from './ReplyPoster';
import { HumanBehaviorSimulator } from './HumanBehaviorSimulator';
import { apiDataCache } from './ApiDataCache';
import { autoReplyService } from '../services/autoReplyService';

/**
 * Auto Reply 任务配置
 */
export interface AutoReplyTaskSettings {
  enabled: boolean;
  maxTweets: number;              // 最多处理几条推文
  maxReplies: number;             // 最多发布几条回复
  maxTweetAgeHours: number;       // 推文最大年龄（小时）
  minLikeCount: number;           // 最小点赞数
  minViewCount: number;           // 最小浏览数
  likeProbability: number;        // 点赞概率 (0-1)
}

export const DEFAULT_AUTO_REPLY_TASK_SETTINGS: AutoReplyTaskSettings = {
  enabled: true,
  maxTweets: 30,                  // 最多扫描30条
  maxReplies: 5,                  // 最多回复5条
  maxTweetAgeHours: 24,           // 24小时内的推文
  minLikeCount: 0,
  minViewCount: 0,
  likeProbability: 0.3,           // 30%概率点赞
};

/**
 * 执行结果
 */
export interface AutoReplyTaskResult {
  tweetsScanned: number;
  tweetsEvaluated: number;
  repliesPosted: number;
  repliesSkipped: number;
  liked: number;
  errors: string[];
  duration: number;
}

export class AutoReplyTaskExecutor {
  private provider: ApiTweetProvider;
  private evaluator: TweetEvaluator;
  private generator: ReplyGenerator;
  private poster: ReplyPoster;
  private settings: AutoReplyTaskSettings;
  private autoReplySettings: AutoReplySettings;
  private isRunning: boolean = false;
  private isStopped: boolean = false;

  constructor(settings: Partial<AutoReplyTaskSettings> = {}) {
    this.settings = { ...DEFAULT_AUTO_REPLY_TASK_SETTINGS, ...settings };
    this.autoReplySettings = { ...DEFAULT_AUTO_REPLY_SETTINGS };

    // Initialize API tweet provider (replaces DOM-based TimelineScroller)
    this.provider = new ApiTweetProvider();

    this.evaluator = new TweetEvaluator({
      settings: this.autoReplySettings,
      onEvaluationStart: (tweet) => {
        console.log('[AutoReplyTaskExecutor] Evaluating tweet:', tweet.id);
      },
      onEvaluationComplete: (evaluation) => {
        console.log('[AutoReplyTaskExecutor] Evaluation complete:', evaluation.shouldReply, 'score:', evaluation.score);
      }
    });

    this.generator = new ReplyGenerator({
      settings: this.autoReplySettings,
      onGenerationStart: (tweet) => {
        console.log('[AutoReplyTaskExecutor] Generating reply for:', tweet.id);
      },
      onReasoning: (chunk) => {
        // Log reasoning chunks to activity log
        autoReplyService.addToLog('reasoning_update', chunk);
      },
      onGenerationComplete: (reply) => {
        console.log('[AutoReplyTaskExecutor] Reply generated:', reply.content.substring(0, 50) + '...');
      }
    });

    this.poster = new ReplyPoster({
      onPostStart: (tweetId) => {
        console.log('[AutoReplyTaskExecutor] Posting reply to:', tweetId);
      },
      onPostSuccess: (tweetId) => {
        console.log('[AutoReplyTaskExecutor] Reply posted successfully:', tweetId);
      },
      onPostError: (tweetId, error) => {
        console.error('[AutoReplyTaskExecutor] Reply failed:', tweetId, error);
      }
    });
  }

  /**
   * Update settings
   */
  updateSettings(settings: Partial<AutoReplyTaskSettings>): void {
    this.settings = { ...this.settings, ...settings };
  }

  /**
   * Sync user's AutoReplySettings into evaluator & generator
   * Called before scheduled execution so that scoring/filtering/generation
   * use the same config as "Run Now".
   */
  syncAutoReplySettings(userSettings: AutoReplySettings): void {
    this.autoReplySettings = { ...userSettings };
    this.evaluator.updateSettings(userSettings);
    this.generator.updateSettings(userSettings);
    console.log('[AutoReplyTaskExecutor] Synced user settings:', {
      customInstructions: userSettings.customInstructions?.substring(0, 50),
      minFollowerCount: userSettings.minFollowerCount,
      minLikeCount: userSettings.minLikeCount,
      minTweetViews: userSettings.minTweetViews,
      minExpectedExposure: userSettings.minExpectedExposure,
      maxTweetAgeHours: userSettings.maxTweetAgeHours,
      dryRunMode: userSettings.dryRunMode,
      replyTone: userSettings.replyTone,
      targetTweetTypes: userSettings.targetTweetTypes,
    });
  }

  /**
   * Execute the auto reply task
   */
  async execute(): Promise<AutoReplyTaskResult> {
    if (this.isRunning) {
      console.warn('[AutoReplyTaskExecutor] Already running');
      return {
        tweetsScanned: 0,
        tweetsEvaluated: 0,
        repliesPosted: 0,
        repliesSkipped: 0,
        liked: 0,
        errors: ['Task already running'],
        duration: 0
      };
    }

    this.isRunning = true;
    this.isStopped = false;
    const startTime = Date.now();

    const result: AutoReplyTaskResult = {
      tweetsScanned: 0,
      tweetsEvaluated: 0,
      repliesPosted: 0,
      repliesSkipped: 0,
      liked: 0,
      errors: [],
      duration: 0
    };

    try {
      console.log('[AutoReplyTaskExecutor] Starting auto reply task...');
      // Create session so UI can show stats/tweet/reasoning
      autoReplyService.createExternalSession();
      autoReplyService.addToLog('started', 'Scheduled auto reply task started');
      console.log('[AutoReplyTaskExecutor] Settings:', this.settings);

      // Ensure we're on home timeline
      await this.ensureOnTimeline();
      autoReplyService.addToLog('scrolling', 'Navigated to home timeline');

      // Start API data cache listener
      apiDataCache.start();

      // Load processed tweets from storage
      await this.provider.loadProcessedFromStorage();

      // Click Home button to trigger fresh API request
      console.log('[AutoReplyTaskExecutor] Clicking Home to trigger API refresh...');
      autoReplyService.addToLog('debug', 'Clicking Home to load fresh timeline data...');
      const homeLink = document.querySelector('a[data-testid="AppTabBar_Home_Link"]') as HTMLElement;
      if (homeLink) {
        homeLink.click();
      }
      await new Promise(resolve => setTimeout(resolve, 1500));

      // Wait for API data to arrive
      const maxWaitTime = 10000;
      const checkInterval = 500;
      let waited = 0;
      while (waited < maxWaitTime) {
        if (apiDataCache.size() > 0) {
          console.log('[AutoReplyTaskExecutor] API data received, cache has', apiDataCache.size(), 'tweets');
          autoReplyService.addToLog('debug', `Timeline data loaded (${apiDataCache.size()} tweets cached)`);
          break;
        }
        await new Promise(resolve => setTimeout(resolve, checkInterval));
        waited += checkInterval;
      }

      // Fallback: manual fetch if clicking Home didn't trigger a new API request
      if (apiDataCache.size() === 0) {
        console.log('[AutoReplyTaskExecutor] No API data after Home click, trying manual fetch...');
        autoReplyService.addToLog('debug', 'Triggering manual timeline fetch...');
        window.postMessage({ type: 'BNBOT_REFRESH_TIMELINE' }, '*');

        let manualWaited = 0;
        const manualWaitMax = 8000;
        while (manualWaited < manualWaitMax) {
          if (apiDataCache.size() > 0) {
            console.log('[AutoReplyTaskExecutor] Manual fetch succeeded, cache has', apiDataCache.size(), 'tweets');
            autoReplyService.addToLog('debug', `Timeline data loaded via manual fetch (${apiDataCache.size()} tweets cached)`);
            break;
          }
          await new Promise(resolve => setTimeout(resolve, checkInterval));
          manualWaited += checkInterval;
        }
      }

      autoReplyService.addToLog('scrolling', `Reading tweets from API cache (${apiDataCache.size()} available)`);

      let emptyBatchAttempts = 0;
      const maxEmptyAttempts = 10;

      while (
        result.repliesPosted < this.settings.maxReplies &&
        result.tweetsScanned < this.settings.maxTweets &&
        emptyBatchAttempts < maxEmptyAttempts &&
        !this.isStopped
      ) {
        // Ensure we're on home timeline
        if (!this.provider.isOnHomeTimeline()) {
          console.log('[AutoReplyTaskExecutor] Not on home timeline, navigating back...');
          autoReplyService.addToLog('scrolling', 'Not on home timeline, navigating back...');
          const navigated = await this.provider.navigateToHome();
          if (!navigated) {
            console.error('[AutoReplyTaskExecutor] Failed to return to home timeline');
            result.errors.push('Failed to navigate to home timeline');
            break;
          }
          await this.clickFirstTab();
        }

        // Get tweets from API cache
        const tweets = this.provider.getNextBatch(5);

        if (tweets.length === 0) {
          // Cache exhausted, scroll to trigger new API requests
          console.log('[AutoReplyTaskExecutor] Cache exhausted, scrolling for more...');
          autoReplyService.addToLog('scrolling', `Cache exhausted, scrolling to load more (attempt ${emptyBatchAttempts + 1}/${maxEmptyAttempts})`);
          const gotMore = await this.provider.scrollForMore();
          if (!gotMore) {
            emptyBatchAttempts++;
          } else {
            emptyBatchAttempts = 0;
          }
          continue;
        }

        emptyBatchAttempts = 0;
        autoReplyService.addToLog('scrolling', `Found ${tweets.length} tweets from API cache to evaluate`);

        for (const tweet of tweets) {
          // Check if stopped
          if (this.isStopped) {
            console.log('[AutoReplyTaskExecutor] Stopped by user');
            autoReplyService.addToLog('stopped', 'Task stopped by user');
            result.errors.push('Stopped by user');
            break;
          }

          // Check limits
          if (result.repliesPosted >= this.settings.maxReplies) {
            console.log('[AutoReplyTaskExecutor] Max replies reached');
            autoReplyService.addToLog('stopped', `Max replies reached (${this.settings.maxReplies})`);
            break;
          }

          if (result.tweetsScanned >= this.settings.maxTweets) {
            console.log('[AutoReplyTaskExecutor] Max tweets scanned');
            autoReplyService.addToLog('stopped', `Max tweets scanned (${this.settings.maxTweets})`);
            break;
          }

          result.tweetsScanned++;
          this.provider.markAsProcessed(tweet.id);

          // Log tweet details
          const tweetAge = this.formatTweetAge(tweet.timestamp);
          const views = this.formatNumber(tweet.metrics.views);
          const likes = this.formatNumber(tweet.metrics.likes);
          const followers = tweet.authorFollowers ? this.formatNumber(tweet.authorFollowers) : '?';

          // Update session with current tweet
          autoReplyService.updateExternalSession({
            status: 'evaluating',
            tweetsScanned: result.tweetsScanned,
            currentTweet: tweet,
            currentReasoning: undefined,
          });

          autoReplyService.addToLog('tweet_found', `@${tweet.authorHandle} · ${followers} followers · ${views} views · ${likes} likes · ${tweetAge}`, {
            authorHandle: tweet.authorHandle,
            content: tweet.content.substring(0, 100)
          });
          autoReplyService.addToLog('debug', `"${tweet.content.slice(0, 80)}${tweet.content.length > 80 ? '...' : ''}" (from API cache)`);
          autoReplyService.addToLog('tweet_evaluating', `Evaluating tweet from @${tweet.authorHandle}`);

          try {
            // Evaluate tweet
            result.tweetsEvaluated++;
            const evaluation = await this.evaluator.evaluate(tweet);

            // Update session with evaluation result
            autoReplyService.updateExternalSession({
              tweetsEvaluated: result.tweetsEvaluated,
              currentEvaluation: evaluation,
              currentReasoning: `Score: ${evaluation.score} — ${evaluation.shouldReply ? 'Will reply' : 'Skipped'}\n${evaluation.reasons?.join('\n') || ''}`,
            });

            if (!evaluation.shouldReply) {
              console.log('[AutoReplyTaskExecutor] Skip:', tweet.id, 'score:', evaluation.score);
              autoReplyService.addToLog('tweet_skipped', `Skipped @${tweet.authorHandle}: ${evaluation.reasons?.[0] || 'Low score'} (score: ${evaluation.score})`);
              result.repliesSkipped++;
              autoReplyService.updateExternalSession({ repliesSkipped: result.repliesSkipped });
              continue;
            }

            // Generate reply
            autoReplyService.updateExternalSession({ status: 'generating' });
            autoReplyService.addToLog('reply_generating', `Generating reply for @${tweet.authorHandle}`);
            const reply = await this.generator.generate(tweet, evaluation);

            // Check dry run mode from autoReplyService settings
            autoReplyService.updateExternalSession({ status: 'posting' });
            const currentSettings = autoReplyService.getSettings();
            if (currentSettings.dryRunMode) {
              // Dry run - skip posting
              result.repliesPosted++;
              autoReplyService.updateExternalSession({ repliesPosted: result.repliesPosted });
              autoReplyService.addToLog('reply_posted', `[DRY RUN] Would post to @${tweet.authorHandle}: ${reply.content.substring(0, 50)}...`);
              this.generator.recordReply(tweet.authorHandle, reply.content);
              await HumanBehaviorSimulator.randomDelay(1000, 2000);
            } else {
              // Post reply
              autoReplyService.addToLog('reply_posting', `Posting reply to @${tweet.authorHandle}`);
              const posted = await this.poster.postReply(tweet, reply.content);

              if (posted) {
                result.repliesPosted++;
                autoReplyService.updateExternalSession({ repliesPosted: result.repliesPosted });
                autoReplyService.addToLog('reply_posted', `Reply posted to @${tweet.authorHandle}: ${reply.content.substring(0, 50)}...`);
                this.generator.recordReply(tweet.authorHandle, reply.content);

                // Random like
                if (Math.random() < this.settings.likeProbability) {
                  await this.likeTweet(tweet);
                  result.liked++;
                  autoReplyService.addToLog('tweet_liked', `Liked tweet from @${tweet.authorHandle}`);
                }

                // Return to timeline and verify
                await this.poster.returnToTimeline();
                if (!this.provider.isOnHomeTimeline()) {
                  console.log('[AutoReplyTaskExecutor] returnToTimeline failed, forcing navigation...');
                  await this.provider.navigateToHome();
                }
                await HumanBehaviorSimulator.randomDelay(2000, 4000);
              } else {
                autoReplyService.addToLog('reply_failed', `Failed to post reply to @${tweet.authorHandle}`);
                result.repliesSkipped++;
              }
            }

          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            console.error('[AutoReplyTaskExecutor] Error processing tweet:', tweet.id, errorMsg);
            autoReplyService.addToLog('error', `Error: ${errorMsg}`);
            result.errors.push(errorMsg);
            result.repliesSkipped++;
          }
        }
      }

      // Save processed tweets
      await this.provider.saveProcessedToStorage();
      autoReplyService.addToLog('stopped', `Task completed: ${result.repliesPosted} replies, ${result.repliesSkipped} skipped`);

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('[AutoReplyTaskExecutor] Task error:', errorMsg);
      result.errors.push(errorMsg);
    } finally {
      this.isRunning = false;
      result.duration = Date.now() - startTime;
      // End the external session
      autoReplyService.endExternalSession();
      console.log('[AutoReplyTaskExecutor] Task completed in', result.duration, 'ms');
      console.log('[AutoReplyTaskExecutor] Result:', result);
    }

    return result;
  }

  /**
   * Ensure we're on the home timeline and select the first tab (For You)
   */
  private async ensureOnTimeline(): Promise<void> {
    if (!this.provider.isOnHomeTimeline()) {
      console.log('[AutoReplyTaskExecutor] Not on home timeline, navigating...');
      const navigated = await this.provider.navigateToHome();
      if (!navigated) {
        throw new Error('Failed to navigate to home timeline');
      }
    } else {
      console.log('[AutoReplyTaskExecutor] Already on timeline');
    }

    // Click the first tab (For You / 为你推荐)
    await this.clickFirstTab();
  }

  /**
   * Click the first tab in the timeline tab list
   */
  private async clickFirstTab(): Promise<void> {
    try {
      // Find the tab list container
      const tabList = document.querySelector('[data-testid="ScrollSnap-List"]') as HTMLElement;
      if (!tabList) {
        console.log('[AutoReplyTaskExecutor] Tab list not found');
        return;
      }

      // Find the first tab
      const firstTab = tabList.querySelector('[role="tab"]') as HTMLElement;
      if (!firstTab) {
        console.log('[AutoReplyTaskExecutor] First tab not found');
        return;
      }

      // Check if already selected
      if (firstTab.getAttribute('aria-selected') === 'true') {
        console.log('[AutoReplyTaskExecutor] First tab already selected');
        return;
      }

      // Click the first tab
      console.log('[AutoReplyTaskExecutor] Clicking first tab...');
      firstTab.click();
      await HumanBehaviorSimulator.randomDelay(1000, 2000);
      console.log('[AutoReplyTaskExecutor] First tab clicked');
    } catch (error) {
      console.error('[AutoReplyTaskExecutor] Failed to click first tab:', error);
    }
  }

  /**
   * Like a tweet
   */
  private async likeTweet(tweet: ScrapedTweet): Promise<boolean> {
    try {
      // Navigate to tweet first if needed
      await this.poster.ensureOnTweetPage(tweet);
      await HumanBehaviorSimulator.randomDelay(500, 1000);

      const likeButton = document.querySelector('button[data-testid="like"]') as HTMLElement;
      if (!likeButton) return false;

      // Check if already liked
      if (document.querySelector('button[data-testid="unlike"]')) return false;

      likeButton.click();
      await HumanBehaviorSimulator.randomDelay(300, 500);

      console.log('[AutoReplyTaskExecutor] Liked tweet:', tweet.id);
      return true;
    } catch (error) {
      console.error('[AutoReplyTaskExecutor] Failed to like tweet:', error);
      return false;
    }
  }

  /**
   * Check if task is running
   */
  isTaskRunning(): boolean {
    return this.isRunning;
  }

  /**
   * Stop the current task
   */
  stop(): void {
    this.isStopped = true;
    this.isRunning = false;
    this.provider.saveProcessedToStorage();
    console.log('[AutoReplyTaskExecutor] Task stopped by user');
  }

  /**
   * Format number to K/M format
   */
  private formatNumber(num: number): string {
    if (num >= 1000000) {
      return (num / 1000000).toFixed(1) + 'M';
    } else if (num >= 1000) {
      return (num / 1000).toFixed(1) + 'K';
    }
    return num.toString();
  }

  /**
   * Format tweet age
   */
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
}

// Singleton instance
export const autoReplyTaskExecutor = new AutoReplyTaskExecutor();
