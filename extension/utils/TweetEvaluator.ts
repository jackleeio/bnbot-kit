/**
 * Tweet Evaluator
 * Uses local exposure prediction algorithm to determine if a tweet is worth replying to.
 * Falls back to AI evaluation when needed.
 *
 * v2.0: Replaced AI-based evaluation with local predictExposure algorithm for:
 * - Zero API cost
 * - Instant evaluation (<10ms vs 2-5s)
 * - Consistent scoring
 */

import { ScrapedTweet, TweetEvaluation, AutoReplySettings } from '../types/autoReply';
import { chatService } from '../services/chatService';
import { apiDataCache } from './ApiDataCache';
import { TimelineTweetData } from './HomeTimelineMonitor';
import { predictExposure, ExposurePrediction } from '../services/exposurePredictionService';

export interface TweetEvaluatorOptions {
  settings: AutoReplySettings;
  onEvaluationStart?: (tweet: ScrapedTweet) => void;
  onEvaluationComplete?: (evaluation: TweetEvaluation) => void;
  onReasoning?: (chunk: string) => void;
  onError?: (error: Error) => void;
}

export class TweetEvaluator {
  private settings: AutoReplySettings;
  private abortController: AbortController | null = null;
  private options: TweetEvaluatorOptions;

  constructor(options: TweetEvaluatorOptions) {
    this.settings = options.settings;
    this.options = options;
  }

  /**
   * Update settings
   */
  updateSettings(settings: Partial<AutoReplySettings>): void {
    this.settings = { ...this.settings, ...settings };
  }

  /**
   * Evaluate a single tweet using local exposure prediction algorithm
   * v2.0: Uses predictExposure() instead of AI for instant, zero-cost evaluation
   */
  async evaluate(tweet: ScrapedTweet): Promise<TweetEvaluation> {
    // 1. Try to get complete data from API cache first
    const cachedData = apiDataCache.getTweet(tweet.id);

    console.log('[TweetEvaluator] Cache lookup for tweet:', tweet.id, {
      found: !!cachedData,
      cachedAvatar: cachedData?.profileImageUrl?.substring(0, 50),
      currentAvatar: tweet.authorAvatar?.substring(0, 50),
      cacheSize: apiDataCache.size()
    });

    if (cachedData) {
      // Use API cache data (includes followers, bio, avatar, etc.)
      console.log('[TweetEvaluator] Using API cache data for tweet:', tweet.id);
      tweet.authorFollowers = cachedData.followers;
      tweet.authorBio = cachedData.bio;
      // Use API avatar as primary source (more reliable than DOM scraping)
      if (cachedData.profileImageUrl) {
        tweet.authorAvatar = cachedData.profileImageUrl;
        console.log('[TweetEvaluator] Avatar updated from cache:', cachedData.profileImageUrl);
      }
      // Also update name/handle if missing
      if (!tweet.authorName && cachedData.displayName) {
        tweet.authorName = cachedData.displayName;
      }
      if (!tweet.authorHandle && cachedData.username) {
        tweet.authorHandle = cachedData.username;
      }
    } else {
      // No cache data - try to scrape avatar from DOM as fallback
      console.log('[TweetEvaluator] No cache data for tweet:', tweet.id, '- trying DOM fallback');

      // Fallback: Try to find avatar in the article element
      if (!tweet.authorAvatar && tweet.articleElement?.isConnected) {
        const avatarImg = tweet.articleElement.querySelector('img[src*="profile_images"]') as HTMLImageElement;
        if (avatarImg?.src) {
          tweet.authorAvatar = avatarImg.src.replace('_normal.', '_bigger.');
          console.log('[TweetEvaluator] Avatar scraped from DOM:', tweet.authorAvatar);
        }
      }
    }

    // 2. Quick filters before evaluation
    const filterReason = this.checkQuickFilters(tweet);
    if (filterReason) {
      return {
        tweetId: tweet.id,
        shouldReply: false,
        score: 0,
        reasons: [`Did not pass quick filters: ${filterReason}`],
        topics: []
      };
    }

    this.options.onEvaluationStart?.(tweet);

    try {
      // 3. Convert ScrapedTweet to TimelineTweetData for prediction
      const timelineData = this.convertToTimelineTweetData(tweet);

      // 4. Use local exposure prediction algorithm (instant, zero cost)
      const prediction = predictExposure(timelineData);

      console.log('[TweetEvaluator] Exposure prediction:', {
        tweetId: tweet.id,
        expected: prediction.expected,
        range: prediction.range,
        score: prediction.score,
        timing: prediction.timing,
        phase: prediction.phase
      });

      // Store expected exposure on tweet for UI display
      tweet.expectedExposure = prediction.expected;

      // 5. Check minimum expected exposure threshold
      const minExpectedExposure = (this.settings as any).minExpectedExposure ?? 0;
      if (minExpectedExposure > 0 && prediction.expected < minExpectedExposure) {
        const evaluation: TweetEvaluation = {
          tweetId: tweet.id,
          shouldReply: false,
          score: prediction.score,
          reasons: [`Expected exposure too low (${prediction.expected} < ${minExpectedExposure})`],
          topics: []
        };
        this.options.onEvaluationComplete?.(evaluation);
        return evaluation;
      }

      // 6. Determine if we should reply based on predicted exposure
      // If minExpectedExposure is 0, skip exposure filtering entirely
      // Otherwise, reply if expected exposure >= minExpectedExposure and timing is not 'dead'
      let shouldReply = true;
      let reason = '';

      if (minExpectedExposure > 0) {
        // Exposure filtering enabled
        shouldReply = prediction.expected >= minExpectedExposure && prediction.timing !== 'dead';
        reason = `Expected exposure: ${prediction.expected}, min: ${minExpectedExposure}, timing: ${prediction.timing}`;
      } else {
        // No exposure filtering - always reply (let AI decide quality)
        shouldReply = true;
        reason = `Exposure filtering disabled (min=0), passing to AI generation`;
      }

      // 7. If passed exposure filter, check content matching via AI (if target types configured)
      const targetTweetTypes = (this.settings as any).targetTweetTypes || '';
      const customInstructions = (this.settings as any).customInstructions || '';

      if (shouldReply && (targetTweetTypes.trim() || customInstructions.trim())) {
        console.log('[TweetEvaluator] Content filtering enabled, calling quick-eval API...');

        try {
          const quickEvalResult = await chatService.quickEval({
            tweetContent: tweet.content,
            authorHandle: tweet.authorHandle,
            authorBio: tweet.authorBio || '',
            targetTypes: targetTweetTypes,
            customInstructions: customInstructions,
          });

          console.log('[TweetEvaluator] Quick-eval result:', quickEvalResult);

          if (!quickEvalResult.shouldReply) {
            shouldReply = false;
            reason = `Content not matched: ${quickEvalResult.reason}`;
          } else {
            reason = `Content matched (${quickEvalResult.confidence.toFixed(2)}): ${quickEvalResult.matchedTypes.join(', ') || 'general'}`;
          }
        } catch (error) {
          console.error('[TweetEvaluator] Quick-eval failed, defaulting to reply:', error);
          // On error, continue with reply (don't block due to eval failure)
        }
      }

      console.log('[TweetEvaluator] Decision:', {
        expected: prediction.expected,
        minExpectedExposure,
        timing: prediction.timing,
        shouldReply
      });

      const evaluation: TweetEvaluation = {
        tweetId: tweet.id,
        shouldReply,
        score: prediction.score,
        reasons: [reason],
        suggestedTone: 'casual',
        topics: []
      };

      this.options.onEvaluationComplete?.(evaluation);
      return evaluation;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.options.onError?.(err);
      return {
        tweetId: tweet.id,
        shouldReply: false,
        score: 0,
        reasons: ['Evaluation failed: ' + err.message],
        topics: []
      };
    }
  }

  /**
   * Convert ScrapedTweet to TimelineTweetData format for exposure prediction
   */
  private convertToTimelineTweetData(tweet: ScrapedTweet): TimelineTweetData {
    const detectMediaType = (): 'video' | 'image' | 'none' => {
      if (!tweet.media || tweet.media.length === 0) return 'none';
      if (tweet.media.some(m => m.type === 'video')) return 'video';
      return 'image';
    };

    return {
      tweetId: tweet.id,
      username: tweet.authorHandle,
      displayName: tweet.authorName,
      followers: tweet.authorFollowers ?? 0,
      following: 0,
      bio: tweet.authorBio ?? '',
      tweetText: tweet.content,
      replyCount: tweet.metrics.replies,
      retweetCount: tweet.metrics.retweets,
      likeCount: tweet.metrics.likes,
      viewCount: tweet.metrics.views,
      createdAt: tweet.timestamp,
      mediaType: detectMediaType()
    };
  }

  /**
   * Fetch follower count and bio by hovering over user card
   */
  private async fetchAuthorDetails(tweet: ScrapedTweet): Promise<void> {
    if (tweet.authorFollowers !== undefined && tweet.authorBio !== undefined) return;

    // Check for stale DOM reference (common after navigation)
    // Skip DOM-based hover if no article element (API-sourced tweet)
    if (!tweet.articleElement) {
      console.log('[TweetEvaluator] No article element (API-sourced tweet), skipping hover:', tweet.id);
      return;
    }

    if (!tweet.articleElement.isConnected) {
      console.log('[TweetEvaluator] Element detached, trying to re-find tweet:', tweet.id);
      // Try to find the tweet link containing the ID
      const tweetLink = document.querySelector(`a[href*="/status/${tweet.id}"]`);
      if (tweetLink) {
        const newArticle = tweetLink.closest('article');
        if (newArticle) {
          console.log('[TweetEvaluator] Successfully re-found tweet element');
          tweet.articleElement = newArticle as HTMLElement;
          // Update the timestamp in case it changed (re-render)
          const timeEl = newArticle.querySelector('time');
          if (timeEl) tweet.timestamp = timeEl.getAttribute('datetime') || tweet.timestamp;
        } else {
          console.warn('[TweetEvaluator] Found link but no article for id:', tweet.id);
        }
      } else {
        console.warn('[TweetEvaluator] Could not re-find tweet in DOM:', tweet.id);
        // If we can't find it, we can't hover.
        // But maybe it's just scrolled out of view virtualized?
        // Attempt to scroll to where it *should* be?
        // For now, return to avoid crashing.
        return;
      }
    }

    // Find user link using specific User-Name test ID as requested
    const userLink = tweet.articleElement!.querySelector('[data-testid="User-Name"] a') as HTMLElement;
    if (!userLink) {
      console.warn('[TweetEvaluator] User-Name link not found');
      return;
    }

    return new Promise((resolve) => {
      console.log('[TweetEvaluator] Triggering hover for', tweet.authorHandle);

      // Scroll into view first to ensure events work
      userLink.scrollIntoView({ behavior: 'smooth', block: 'center' });

      // Wait for scroll to likely finish
      setTimeout(() => {
        const rect = userLink.getBoundingClientRect();
        const centerX = rect.left + (rect.width / 2);
        const centerY = rect.top + (rect.height / 2);

        console.log(`[TweetEvaluator] Hovering at x:${Math.round(centerX)} y:${Math.round(centerY)}`);

        // Trigger hover with multiple events + Pointer events for modern React
        const eventTypes = [
          'mouseover', 'mouseenter', 'mousemove',
          'pointerover', 'pointerenter', 'pointermove'
        ];

        eventTypes.forEach(type => {
          const isPointer = type.startsWith('pointer');
          const EventClass = isPointer ? PointerEvent : MouseEvent;

          const eventInit: any = {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX: centerX,
            clientY: centerY
          };

          if (isPointer) {
            eventInit.pointerId = 1;
            eventInit.isPrimary = true;
          }

          const event = new EventClass(type, eventInit);
          userLink.dispatchEvent(event);
        });
      }, 800); // Increased wait for scroll

      // Wait for hover card
      let attempts = 0;
      const checkHoverCard = setInterval(() => {
        attempts++;
        const hoverCard = document.querySelector('[data-testid="HoverCard"]');

        // Wait for card AND content (links) to be present
        // React may render the container frame before the content
        if (hoverCard) {
          const links = hoverCard.querySelectorAll('a');
          if (links.length === 0 && attempts < 40) {
            // Found card but it's empty, keep waiting
            return;
          }

          clearInterval(checkHoverCard);
          console.log('[TweetEvaluator] Hover card found with content');

          // Get Bio
          // Try standard testid first, then fallback
          let bioEl = hoverCard.querySelector('[data-testid="UserDescription"]');
          console.log('[TweetEvaluator] Looking for Bio...', bioEl ? 'Found standard' : 'Standard not found');

          if (!bioEl) {
            // Fallback: look for the text container that isn't the name/handle
            // Bio usually has dir="auto" and is inside the card
            const candidates = Array.from(hoverCard.querySelectorAll('div[dir="auto"]'));
            console.log('[TweetEvaluator] Fallback candidates:', candidates.length);
            for (const el of candidates) {
              const text = el.textContent?.trim() || '';
              console.log('[TweetEvaluator] Candidate text:', text);

              // Filter out common UI elements and Buttons
              const isButton = el.closest('button') || el.closest('[role="button"]') || el.getAttribute('role') === 'button';

              // Check visibility - crucial for "Click to Unfollow" hidden text
              const isHidden = (el as HTMLElement).offsetParent === null;

              const isMetrics = /^\d/.test(text) || text.includes('关注者') || text.includes('正在关注');

              // UI Elements logic:
              // Rely strictly on structural checks (button, hidden) and metrics patterns
              // We do NOT filter specific words like "Follow" because legitimate bios can start with them

              const hasHandle = text.includes('@');

              // Allow @ in bio
              // Allow "Follow ..." (we trust isButton/isHidden handles the UI elements)
              if (text.length > 5 && !isButton && !isHidden && !isMetrics) {
                bioEl = el;
                console.log('[TweetEvaluator] Fallback Bio match!');
                break;
              }
            }
          }

          if (bioEl) {
            tweet.authorBio = bioEl.textContent || '';
          }

          // Parse followers
          // Check for "Followers" (English) or "关注者" (Chinese)
          const allLinks = Array.from(hoverCard.querySelectorAll('a'));
          console.log('[TweetEvaluator] Processing links:', allLinks.length, allLinks.map(a => a.href));

          let followerLink = allLinks.find(a =>
            a.href.includes('/followers') ||
            a.href.includes('/verified_followers')
          );

          if (followerLink) {
            console.log('[TweetEvaluator] Follower link found:', followerLink.textContent);
            // Extract the number part from the link text (e.g. "4.5万 关注者" -> "4.5万")
            const text = followerLink.textContent || '';
            // Search for the number pattern specifically
            const numberMatch = text.match(/[\d.,]+[KMB万亿]?/);
            if (numberMatch) {
              console.log('[TweetEvaluator] Metric match:', numberMatch[0]);
              tweet.authorFollowers = this.parseMetric(numberMatch[0]);
            } else {
              console.log('[TweetEvaluator] No metric regex match in:', text);
            }
          } else {
            console.log('[TweetEvaluator] No follower link found!');
          }

          console.log('[TweetEvaluator] Scraped:', { bio: tweet.authorBio, followers: tweet.authorFollowers });

          // Wait a bit so user can see it (and for data to fully load if needed)
          setTimeout(() => {
            // Close card (move mouse away)
            // Close card (move mouse away)
            console.log('[TweetEvaluator] Closing card');

            // Dispatch multiple events to ensure it closes
            const closeEvents = ['mouseleave', 'mouseout', 'pointerleave', 'pointerout'];
            closeEvents.forEach(type => {
              const EventClass = type.startsWith('pointer') ? PointerEvent : MouseEvent;
              const evt = new EventClass(type, {
                bubbles: true,
                cancelable: true,
                view: window,
                clientX: 0, // Move to corner
                clientY: 0
              });
              userLink.dispatchEvent(evt);
            });

            // Also try to hover body to really force it away
            document.body.dispatchEvent(new MouseEvent('mouseover', {
              bubbles: true,
              view: window,
              clientX: 0,
              clientY: 0
            }));

            resolve();
          }, 500); // Fast close after scraping

        } else if (attempts > 50) { // Timeout 5s
          console.log('[TweetEvaluator] Hover card timeout');
          clearInterval(checkHoverCard);
          resolve();
        }
      }, 100);
    });
  }

  private parseMetric(text: string): number {
    // Remove commonplace text chars but keep numbers, dots, commas, K, M, B, and Chinese units
    const cleanText = text.trim().toUpperCase();

    // Extract number and unit
    const match = cleanText.match(/([\d.,]+)\s*([KMB万亿]?)/);
    if (!match) return 0;

    let val = parseFloat(match[1].replace(/,/g, ''));
    const unit = match[2];

    if (unit === 'K') val *= 1000;
    if (unit === 'M') val *= 1000000;
    if (unit === 'B') val *= 1000000000;
    if (unit === '万') val *= 10000;
    if (unit === '亿') val *= 100000000;

    return Math.round(val);
  }

  // ... (existing helper methods)

  /**
   * Quick filters before calling AI
   */

  private checkQuickFilters(tweet: ScrapedTweet): string | null {
    // Skip retweets
    if (tweet.isRetweet) return 'Is Retweet';

    // Exclude handles
    if (this.settings.excludeHandles.includes(tweet.authorHandle.toLowerCase())) return `Excluded handle @${tweet.authorHandle}`;

    // Minimum likes
    // Skip like count check for notifications (they are fresh)
    if (this.settings.minLikeCount > 0 && tweet.source !== 'notification' && tweet.metrics.likes < this.settings.minLikeCount) {
      return `Low likes (${tweet.metrics.likes} < ${this.settings.minLikeCount})`;
    }

    // Minimum views (New)
    // Skip view count check for notifications (they don't show views on timeline)
    if (this.settings.minTweetViews > 0 && tweet.source !== 'notification' && tweet.metrics.views < this.settings.minTweetViews) {
      console.log('[TweetEvaluator] Skipped low views:', tweet.metrics.views);
      return `Low views (${tweet.metrics.views} < ${this.settings.minTweetViews})`;
    }

    // Max Age (New)
    const tweetDate = new Date(tweet.timestamp);
    const ageHours = (new Date().getTime() - tweetDate.getTime()) / (1000 * 60 * 60);
    if (this.settings.maxTweetAgeHours > 0 && ageHours > this.settings.maxTweetAgeHours) {
      console.log('[TweetEvaluator] Skipped old tweet:', ageHours.toFixed(1), 'hours');
      return `Too old (${ageHours.toFixed(1)}h > ${this.settings.maxTweetAgeHours}h)`;
    }

    // Min Followers (New) - if fetched
    if (this.settings.minFollowerCount > 0 && tweet.authorFollowers !== undefined) {
      if (tweet.authorFollowers < this.settings.minFollowerCount) {
        console.log('[TweetEvaluator] Skipped low followers:', tweet.authorFollowers);
        return `Low followers (${tweet.authorFollowers} < ${this.settings.minFollowerCount})`;
      }
    }

    // ... (rest of logic)
    return null;
  }


  /**
   * Call AI to evaluate tweet
   */
  private async callAIEvaluation(tweet: ScrapedTweet): Promise<TweetEvaluation> {
    const prompt = this.buildEvaluationPrompt(tweet);

    return new Promise((resolve, reject) => {
      let responseContent = '';

      chatService.sendStatelessMessageStream(
        prompt,
        {
          onContent: (chunk) => {
            responseContent += chunk;
          },
          onReasoning: (chunk) => {
            this.options.onReasoning?.(chunk);
          },
          onToolCall: (name, args) => {
            // Not used in evaluation
          },
          onToolResult: (name, result) => {
            // Not used in evaluation
          },
          onComplete: () => {
            try {
              const evaluation = this.parseEvaluationResponse(responseContent, tweet.id);
              resolve(evaluation);
            } catch (e) {
              reject(e);
            }
          },
          onError: (error) => {
            reject(error instanceof Error ? error : new Error(String(error)));
          }
        },
        this.abortController?.signal
      );
    });
  }

  /**
   * Build evaluation prompt
   */
  private buildEvaluationPrompt(tweet: ScrapedTweet): string {
    const topicsContext = this.settings.topicFilters.length > 0
      ? `Focus areas: ${this.settings.topicFilters.join(', ')}`
      : 'General topics';

    const targetTypesContext = this.settings.targetTweetTypes
      ? `Target Tweet Types: ${this.settings.targetTweetTypes}`
      : 'Target Types: Any relevant tweets';

    const tweetAgeHours = ((new Date().getTime() - new Date(tweet.timestamp).getTime()) / (1000 * 60 * 60)).toFixed(1);
    const followersInfo = tweet.authorFollowers !== undefined ? `${tweet.authorFollowers}` : 'Unknown';
    const bioInfo = tweet.authorBio ? `Bio: "${tweet.authorBio}"` : 'Bio: Unknown';

    // Add custom instructions if available
    const customInstructionsContext = this.settings.customInstructions
      ? `User Custom Instructions: "${this.settings.customInstructions}"`
      : '';

    const viewsInfo = tweet.source === 'notification' ? 'N/A (Notification)' : `${tweet.metrics.views}`;

    // Add context for notification tweets
    const notificationContext = tweet.source === 'notification'
      ? `
IMPORTANT: This tweet is from a NEW NOTIFICATION. 
- Ignore low engagement metrics (Views, Likes, Replies) as it was just posted.
- Focus ONLY on the content quality, relevance to topics, and author influence (Followers).
- **Recency is still important**: Fresh content is good.`
      : '';

    return `You are an expert social media manager evaluating tweets for "Exposure Growth Value".
    
Analyze this tweet to determine if replying will generate significant visibility and engagement.
${notificationContext}

Tweet Data:
- Author: @${tweet.authorHandle} (Followers: ${followersInfo})
- ${bioInfo}
- Content: "${tweet.content}"
- Age: ${tweetAgeHours} hours ago
- Metrics: ${viewsInfo} Views, ${tweet.metrics.likes} Likes, ${tweet.metrics.retweets} RTs, ${tweet.metrics.replies} Replies

5. Evaluation Context:
- ${topicsContext}
- ${targetTypesContext}
- ${customInstructionsContext}

CRITICAL: EXPOSURE VALUE JUDGMENT
Calculate the potential value of commenting based on:
1. **Recency**: Is the tweet fresh? (< 24h is best, < 6h is prime)
2. **Velocity**: Are views/likes growing fast relative to age? (e.g., 10k views in 1 hour is High Velocity)
3. **Reach**: Does the author have a large following?
4. **Relevance**: Does the topic match our focus?

Logic:
- If High Velocity + Recent -> HIGH VALUE (Reply immediately)
- If High Reach + Recent -> HIGH VALUE
- If Low Views + Old (>24h) -> LOW VALUE (Skip)
- If Niche Topic + Engaged Audience -> MEDIUM VALUE

If user provided "Target Tweet Types", STRICTLY match them.

Respond with JSON:
{
  "shouldReply": boolean,
  "score": 0-100, // < 50 skip, > 70 high priority
  "exposureValue": "High" | "Medium" | "Low",
  "reasons": ["reason1", "reason2"],
  "suggestedTone": "casual" | ...
}`;
  }



  /**
   * Parse AI response into TweetEvaluation
   */
  private parseEvaluationResponse(response: string, tweetId: string): TweetEvaluation {
    try {
      // Try to extract JSON from response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const parsed = JSON.parse(jsonMatch[0]);

      return {
        tweetId,
        shouldReply: Boolean(parsed.shouldReply),
        score: typeof parsed.score === 'number' ? parsed.score : 0,
        reasons: Array.isArray(parsed.reasons) ? parsed.reasons : [],
        suggestedTone: parsed.suggestedTone || 'casual',
        topics: Array.isArray(parsed.topics) ? parsed.topics : []
      };
    } catch (e) {
      console.error('[TweetEvaluator] Failed to parse response:', response, e);
      // Default to not replying on parse error
      return {
        tweetId,
        shouldReply: false,
        score: 0,
        reasons: ['Failed to parse AI response'],
        topics: []
      };
    }
  }
  /**
   * Cancel any pending evaluation
   */
  public cancel(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }
}
