/**
 * Reply Generator
 * Uses AI to generate contextual, engaging replies
 */

import { ScrapedTweet, TweetEvaluation, GeneratedReply, AutoReplySettings } from '../types/autoReply';
import { chatService } from '../services/chatService';

export interface ReplyGeneratorOptions {
  settings: AutoReplySettings;
  onGenerationStart?: (tweet: ScrapedTweet) => void;
  onContentChunk?: (chunk: string) => void;
  onReasoning?: (chunk: string) => void;
  onGenerationComplete?: (reply: GeneratedReply) => void;
  onError?: (error: Error) => void;
}

// 历史回复记录
export interface RecentReply {
  authorHandle: string;
  content: string;
}

export class ReplyGenerator {
  private settings: AutoReplySettings;
  private abortController: AbortController | null = null;
  private options: ReplyGeneratorOptions;
  private recentReplies: RecentReply[] = [];
  private readonly MAX_RECENT_REPLIES = 5;

  constructor(options: ReplyGeneratorOptions) {
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
   * Record a recent reply for context (avoid repetitive styles)
   */
  recordReply(authorHandle: string, content: string): void {
    this.recentReplies.push({ authorHandle, content });
    // Keep only the most recent N replies
    if (this.recentReplies.length > this.MAX_RECENT_REPLIES) {
      this.recentReplies.shift();
    }
    console.log('[ReplyGenerator] Recorded reply, history size:', this.recentReplies.length);
  }

  /**
   * Clear recent replies (e.g., on new session)
   */
  clearRecentReplies(): void {
    this.recentReplies = [];
  }

  /**
   * Get recent replies for debugging
   */
  getRecentReplies(): RecentReply[] {
    return [...this.recentReplies];
  }

  /**
   * Generate a reply for a tweet
   */
  async generate(tweet: ScrapedTweet, evaluation: TweetEvaluation): Promise<GeneratedReply> {
    this.options.onGenerationStart?.(tweet);

    try {
      this.abortController = new AbortController();
      const reply = await this.callAIGeneration(tweet, evaluation);

      // Validate reply
      if (!this.validateReply(reply.content)) {
        throw new Error('Generated reply failed validation');
      }

      this.options.onGenerationComplete?.(reply);
      return reply;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.options.onError?.(err);
      throw err;
    }
  }

  /**
   * Cancel pending generation
   */
  cancel(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  /**
   * Call AI to generate reply
   */
  private async callAIGeneration(tweet: ScrapedTweet, evaluation: TweetEvaluation): Promise<GeneratedReply> {
    const prompt = this.buildGenerationPrompt(tweet, evaluation);

    return new Promise((resolve, reject) => {
      let responseContent = '';

      chatService.sendStatelessMessageStream(
        prompt,
        {
          onContent: (chunk) => {
            responseContent += chunk;
            this.options.onContentChunk?.(chunk);
          },
          onReasoning: (chunk) => {
            this.options.onReasoning?.(chunk);
          },
          onToolCall: (name, args) => {
            // Not used in generation
          },
          onToolResult: (name, result) => {
            // Not used in generation
          },
          onComplete: () => {
            try {
              const reply = this.parseGenerationResponse(responseContent, tweet.id);
              resolve(reply);
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
   * Build generation prompt
   */
  private buildGenerationPrompt(tweet: ScrapedTweet, evaluation: TweetEvaluation): string {
    const toneDescriptions: Record<string, string> = {
      professional: 'Professional and polished, using industry terminology appropriately',
      casual: 'Friendly and conversational, like talking to a peer',
      humorous: 'Light-hearted with appropriate humor, but not forced',
      informative: 'Educational and helpful, sharing knowledge',
      match_author: 'Match the tone and style of the original tweet'
    };

    const tone = this.settings.replyTone;
    const toneDesc = toneDescriptions[tone] || toneDescriptions.casual;

    // Detect language of original tweet
    const isChineseTweet = /[\u4e00-\u9fff]/.test(tweet.content);
    const languageInstruction = isChineseTweet
      ? 'Reply in Chinese (中文回复)'
      : 'Reply in English';

    const hasMedia = tweet.media && tweet.media.length > 0;
    const mediaContext = hasMedia ? `\n- Tweet includes ${tweet.media.length} media item(s)` : '';

    // Build recent replies context to avoid repetitive styles
    let recentRepliesContext = '';
    if (this.recentReplies.length > 0) {
      const repliesList = this.recentReplies
        .map((r, i) => `${i + 1}. @${r.authorHandle}: "${r.content}"`)
        .join('\n');
      recentRepliesContext = `

IMPORTANT - Your Recent Replies (avoid similar styles/openings):
${repliesList}

Please vary your reply style, opening phrase, and approach. Don't start replies the same way.`;
    }

    return `Generate a reply to this tweet.

Original Tweet:
- Author: @${tweet.authorHandle}
- Content: "${tweet.content}"
- Topics identified: ${evaluation.topics.join(', ') || 'general'}${mediaContext}

Reply Guidelines:
- Maximum length: ${this.settings.maxReplyLength} characters
- Tone: ${toneDesc}
- ${languageInstruction}
- Add value to the conversation
- Be genuine and authentic
- Don't be promotional or spammy
- Don't use excessive emojis or hashtags
- Don't mention that you're an AI
${this.settings.customInstructions ? `- Custom instructions: ${this.settings.customInstructions}` : ''}

IMAGE DECISION:
After generating your reply, decide if adding an image would enhance it. Consider adding an image when:
- Replying to visual content (memes, art, screenshots, photos)
- Explaining complex concepts that benefit from visualization
- Adding humor with a reaction image or relevant meme
- Sharing data, statistics, or infographics
- Providing tutorial or how-to visual content

Do NOT add images for:
- Simple text conversations or questions
- Questions that only need text answers
- Greetings or casual chat
- When the reply is complete without visuals

IMPORTANT: Respond with ONLY a valid JSON object in this exact format:
{
  "content": "Your reply text here",
  "reasoning": "Brief explanation of why this reply is appropriate",
  "needsImage": false,
  "imagePrompt": "Only include this field if needsImage is true. Detailed description of the visual content to generate"
}

The "content" field should contain ONLY the reply text, nothing else.
The "imagePrompt" field should be a detailed, specific description if an image would enhance the reply.${recentRepliesContext}`;
  }

  /**
   * Parse AI response into GeneratedReply
   */
  private parseGenerationResponse(response: string, tweetId: string): GeneratedReply {
    try {
      // Try to extract JSON from response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        // If no JSON found, treat the whole response as the reply content
        return {
          tweetId,
          content: response.trim(),
          reasoning: 'Direct response',
          needsImage: false
        };
      }

      const parsed = JSON.parse(jsonMatch[0]);

      // Handle nested format: { "type": "tweet", "data": { "content": "..." } }
      // This format is sometimes returned by the backend
      const data = parsed.data || parsed;

      // Extract content - check multiple possible locations
      const content = data.content || parsed.content || '';

      // Extract reasoning
      const reasoning = data.reasoning || parsed.reasoning || '';

      // Extract image-related fields (handle both formats)
      const needsImage = data.needsImage === true ||
                         parsed.needsImage === true ||
                         data.image_suggestion?.has_suggestion === true;

      const imagePrompt = data.imagePrompt ||
                          parsed.imagePrompt ||
                          data.image_suggestion?.image_prompt ||
                          '';

      console.log('[ReplyGenerator] Parsed response:', {
        format: parsed.type ? 'nested' : 'direct',
        contentLength: content.length,
        hasReasoning: !!reasoning
      });

      return {
        tweetId,
        content: String(content).trim(),
        reasoning: String(reasoning),
        alternativeContents: data.alternatives || parsed.alternatives,
        needsImage: needsImage,
        imagePrompt: imagePrompt ? String(imagePrompt).trim() : undefined
      };
    } catch (e) {
      console.error('[ReplyGenerator] Failed to parse response:', response, e);
      // Try to use the response as-is if it looks like valid text
      const cleanedResponse = response.trim();
      if (cleanedResponse.length > 0 && cleanedResponse.length <= this.settings.maxReplyLength) {
        return {
          tweetId,
          content: cleanedResponse,
          reasoning: 'Fallback: used raw response',
          needsImage: false
        };
      }
      throw new Error('Failed to parse AI response');
    }
  }

  /**
   * Validate generated reply
   */
  private validateReply(content: string): boolean {
    // Check length
    if (content.length === 0) {
      console.log('[ReplyGenerator] Validation failed: empty content');
      return false;
    }

    if (content.length > this.settings.maxReplyLength) {
      console.log('[ReplyGenerator] Validation failed: too long', content.length);
      return false;
    }

    // Check for obvious issues
    const badPatterns = [
      /^(hi|hello|hey)\s*$/i,  // Too generic
      /^(thanks|thank you)\s*$/i,  // Too generic
      /buy now|click here|limited time/i,  // Spammy
      /I am an AI|I'm an AI|As an AI/i,  // AI disclosure
    ];

    for (const pattern of badPatterns) {
      if (pattern.test(content)) {
        console.log('[ReplyGenerator] Validation failed: bad pattern', pattern);
        return false;
      }
    }

    return true;
  }
}
