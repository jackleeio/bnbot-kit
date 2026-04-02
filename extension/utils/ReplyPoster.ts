/**
 * Reply Poster
 * Automates DOM interactions to post replies on Twitter/X
 */

import { ScrapedTweet } from '../types/autoReply';
import { HumanBehaviorSimulator } from './HumanBehaviorSimulator';

export interface ReplyPosterOptions {
  onPostStart?: (tweetId: string) => void;
  onPostSuccess?: (tweetId: string) => void;
  onPostError?: (tweetId: string, error: Error) => void;
}

// Twitter DOM selectors
const SELECTORS = {
  replyButton: '[data-testid="reply"]',
  replyTextarea: '[data-testid="tweetTextarea_0"]',
  replyLabel: '[data-testid="tweetTextarea_0_label"]',
  submitButtonInline: '[data-testid="tweetButtonInline"]',
  submitButton: '[data-testid="tweetButton"]',
  tweet: 'article[data-testid="tweet"]',
  dialog: '[role="dialog"]',
  closeButton: '[data-testid="app-bar-close"]'
};

export class ReplyPoster {
  private options: ReplyPosterOptions;

  constructor(options: ReplyPosterOptions = {}) {
    this.options = options;
  }


  /**
   * Simulate typing a reply without sending (Dry Run)
   */
  async simulateTyping(tweet: ScrapedTweet, replyContent: string, imageBlob?: Blob): Promise<boolean> {
    this.options.onPostStart?.(tweet.id);

    try {
      // Navigate to tweet if not already there
      const isOnTweetPage = await this.ensureOnTweetPage(tweet);
      if (!isOnTweetPage) {
        throw new Error('Failed to navigate to tweet page');
      }

      // Wait for page to load
      await HumanBehaviorSimulator.randomDelay(1000, 2000);

      // Click reply to open composer
      const composerOpened = await this.openReplyComposer();
      if (!composerOpened) {
        throw new Error('Failed to open reply composer');
      }

      // Fill the reply text
      await HumanBehaviorSimulator.clickDelay();
      const textFilled = await this.fillReplyText(replyContent);
      if (!textFilled) {
        throw new Error('Failed to fill reply text');
      }

      // Upload image if provided (for dry run preview)
      if (imageBlob) {
        console.log('[ReplyPoster] Dry run: Uploading image for preview...');
        await this.uploadImageToReply(imageBlob);
      }

      console.log('[ReplyPoster] Dry run: Text filled, not sending.');

      // Wait to let user see it
      await HumanBehaviorSimulator.randomDelay(3000, 5000);

      // Close the composer to clean up? 
      // User said "present it out". 
      // If we leave it open, the next scroll action ensures we are on timeline?
      // Actually autoReplyService will call returnToTimeline right after.
      // So we don't need to close it here. returnToTimeline handles back/close.

      return true;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.options.onPostError?.(tweet.id, err);
      console.error('[ReplyPoster] Failed to simulate reply:', err);
      return false;
    }
  }

  /**
   * Post a reply to a specific tweet
   */
  async postReply(tweet: ScrapedTweet, replyContent: string, imageBlob?: Blob): Promise<boolean> {
    this.options.onPostStart?.(tweet.id);

    try {
      // Navigate to tweet if not already there
      const isOnTweetPage = await this.ensureOnTweetPage(tweet);
      if (!isOnTweetPage) {
        throw new Error('Failed to navigate to tweet page');
      }

      // Wait for page to load
      await HumanBehaviorSimulator.randomDelay(1000, 2000);

      // Click reply to open composer
      const composerOpened = await this.openReplyComposer();
      if (!composerOpened) {
        throw new Error('Failed to open reply composer');
      }

      // Fill the reply text
      await HumanBehaviorSimulator.clickDelay();
      const textFilled = await this.fillReplyText(replyContent);
      if (!textFilled) {
        throw new Error('Failed to fill reply text');
      }

      // Upload image if provided (NEW)
      if (imageBlob) {
        console.log('[ReplyPoster] Uploading image with reply...');
        const imageUploaded = await this.uploadImageToReply(imageBlob);

        if (!imageUploaded) {
          console.warn('[ReplyPoster] Image upload failed, proceeding with text-only reply');
          // Don't fail the entire reply, just continue without image
        }
      }

      // Submit the reply immediately
      const submitted = await this.submitReply();
      if (!submitted) {
        throw new Error('Failed to submit reply');
      }

      // Wait for confirmation
      const success = await this.waitForPostSuccess();
      if (success) {
        this.options.onPostSuccess?.(tweet.id);
        console.log('[ReplyPoster] Reply posted successfully');
      } else {
        throw new Error('Post confirmation timeout');
      }

      return success;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.options.onPostError?.(tweet.id, err);
      console.error('[ReplyPoster] Failed to post reply:', err);
      return false;
    }
  }

  /**
   * Ensure we're on the tweet detail page
   */
  public async ensureOnTweetPage(tweet: ScrapedTweet): Promise<boolean> {
    const currentUrl = window.location.href;
    if (currentUrl.includes(`/status/${tweet.id}`)) {
      return true;
    }

    console.log('[ReplyPoster] Navigating to tweet detail page:', tweet.tweetUrl);

    // Step 1: First, try to scroll to the tweet element if it exists
    let element = tweet.articleElement;

    // Re-query if stale (element might have been removed from DOM after navigation)
    if (!element || !element.isConnected) {
      console.log('[ReplyPoster] Tweet element stale, searching in DOM...');
      const link = document.querySelector(`a[href*="/status/${tweet.id}"]`);
      if (link) {
        element = link.closest('article') as HTMLElement;
      }
    }

    // Step 2: If element found, scroll to it first
    if (element && element.isConnected) {
      console.log('[ReplyPoster] Scrolling to tweet element...');
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await HumanBehaviorSimulator.randomDelay(500, 1000);
    } else {
      console.log('[ReplyPoster] Tweet element not in DOM, will use direct navigation');
    }

    // Step 3: Try to find and click the tweet link
    // Priority 1: If we have the article element, search within it first
    let targetLink: HTMLElement | null = null;

    if (element && element.isConnected) {
      // Look for timestamp link first (most reliable)
      const timeEl = element.querySelector('time');
      if (timeEl) {
        const timeLink = timeEl.closest('a') as HTMLElement;
        if (timeLink && timeLink.getAttribute('href')?.includes(`/status/${tweet.id}`)) {
          // Verify it's not a photo/video link
          const href = timeLink.getAttribute('href') || '';
          if (!href.includes('/photo/') && !href.includes('/video/')) {
            targetLink = timeLink;
            console.log('[ReplyPoster] Found timestamp link in article element');
          }
        }
      }
    }

    // Priority 2: Search all articles if not found
    if (!targetLink) {
      const tweetSelector = `article[data-testid="tweet"]`;
      const articles = Array.from(document.querySelectorAll(tweetSelector));

      for (const article of articles) {
        // Target the timestamp link specifically
        const timeEl = article.querySelector('time');
        if (timeEl) {
          const timeLink = timeEl.closest('a') as HTMLElement;
          if (timeLink) {
            const href = timeLink.getAttribute('href') || '';
            if (href.includes(`/status/${tweet.id}`) && !href.includes('/photo/') && !href.includes('/video/')) {
              targetLink = timeLink;
              console.log('[ReplyPoster] Found timestamp link in DOM search');
              break;
            }
          }
        }
      }
    }

    // Priority 3: Fallback - search for any valid link (excluding media)
    if (!targetLink) {
      const allLinks = Array.from(document.querySelectorAll(`a[href*="/status/${tweet.id}"]`));
      targetLink = allLinks.find(a => {
        const href = a.getAttribute('href') || '';
        // Exclude photo/video/analytics links
        if (href.includes('/photo/') || href.includes('/video/') || href.includes('/analytics')) return false;
        // Exclude if it contains media images
        if (a.querySelector('img[src*="pbs.twimg.com/media"]')) return false;
        // Exclude aria-labels that indicate analytics
        const ariaLabel = a.getAttribute('aria-label') || '';
        if (ariaLabel.includes('View') || ariaLabel.includes('Analytics') || ariaLabel.includes('查看')) return false;
        return true;
      }) as HTMLElement || null;

      if (targetLink) {
        console.log('[ReplyPoster] Found link via fallback search');
      }
    }

    if (targetLink) {
      console.log('[ReplyPoster] Found tweet link, clicking...');
      targetLink.click();
      await HumanBehaviorSimulator.randomDelay(2000, 3000);
      return window.location.href.includes(`/status/${tweet.id}`);
    }

    // Method 2: Create and click a temporary link inside React root (SPA navigation)
    console.log('[ReplyPoster] Link not found, creating temp link to navigate...');
    // Use relative path so Twitter's SPA router intercepts the click
    const tweetPath = tweet.tweetUrl.replace(/^https?:\/\/[^/]+/, '');
    const tempLink = document.createElement('a');
    tempLink.href = tweetPath;
    tempLink.style.display = 'none';
    // Append inside Twitter's React root so the click event propagates through React's event system
    const reactRoot = document.getElementById('react-root') || document.body;
    reactRoot.appendChild(tempLink);
    tempLink.click();
    reactRoot.removeChild(tempLink);

    // Wait for navigation
    await HumanBehaviorSimulator.randomDelay(2000, 3000);

    const success = window.location.href.includes(`/status/${tweet.id}`);

    // If navigation succeeded, try to refresh author info from detail page
    if (success) {
      this.refreshAuthorInfoFromDetailPage(tweet);
    }

    return success;
  }

  /**
   * Refresh author info (avatar, name, handle) from tweet detail page
   */
  private refreshAuthorInfoFromDetailPage(tweet: ScrapedTweet): void {
    const article = document.querySelector('article[data-testid="tweet"]');
    if (!article) return;

    // Refresh avatar if missing
    if (!tweet.authorAvatar) {
      const avatar = this.extractAvatarFromDetailPage(article);
      if (avatar) {
        tweet.authorAvatar = avatar;
        console.log('[ReplyPoster] Refreshed avatar from detail page:', avatar);
      }
    }

    // Refresh name and handle from User-Name element
    const userNameEl = article.querySelector('[data-testid="User-Name"]');
    if (userNameEl) {
      // Get display name from first span
      if (!tweet.authorName) {
        const nameSpan = userNameEl.querySelector('a span span');
        if (nameSpan?.textContent) {
          tweet.authorName = nameSpan.textContent.trim();
          console.log('[ReplyPoster] Refreshed name from detail page:', tweet.authorName);
        }
      }

      // Get handle from link href or @username span
      if (!tweet.authorHandle) {
        const handleSpan = userNameEl.querySelector('a[tabindex="-1"] span');
        if (handleSpan?.textContent) {
          const handle = handleSpan.textContent.replace('@', '').trim();
          if (handle) {
            tweet.authorHandle = handle;
            console.log('[ReplyPoster] Refreshed handle from detail page:', tweet.authorHandle);
          }
        }
      }

      // Check verified status
      if (tweet.isVerified === undefined) {
        const verifiedBadge = userNameEl.querySelector('[data-testid="icon-verified"], svg[aria-label*="Verified"], svg[aria-label*="认证"]');
        tweet.isVerified = !!verifiedBadge;
      }
    }
  }

  /**
   * Extract author avatar from tweet detail page
   */
  private extractAvatarFromDetailPage(article: Element): string | null {
    // Method 1: Find UserAvatar-Container-* element (most reliable)
    // data-testid="UserAvatar-Container-{username}"
    const avatarContainer = article.querySelector('[data-testid^="UserAvatar-Container-"]');
    if (avatarContainer) {
      // Try img.css-9pa8cd inside the container
      const img = avatarContainer.querySelector('img.css-9pa8cd') as HTMLImageElement;
      if (img?.src && !img.src.includes('data:')) {
        return img.src;
      }

      // Try any img with profile_images
      const profileImg = avatarContainer.querySelector('img[src*="profile_images"]') as HTMLImageElement;
      if (profileImg?.src) {
        return profileImg.src;
      }

      // Try background-image style
      const bgDiv = avatarContainer.querySelector('div[style*="background-image"]') as HTMLElement;
      if (bgDiv) {
        const style = bgDiv.getAttribute('style') || '';
        const match = style.match(/url\("?([^"]+)"?\)/);
        if (match && match[1] && !match[1].includes('data:')) {
          return match[1];
        }
      }
    }

    // Fallback: Find img with profile_images in src anywhere in article
    const profileImg = article.querySelector('img[src*="profile_images"]') as HTMLImageElement;
    if (profileImg?.src && !profileImg.src.includes('data:')) {
      return profileImg.src;
    }

    return null;
  }

  /**
   * Open the reply composer
   */
  private async openReplyComposer(): Promise<boolean> {
    // Check if we are on detail page
    const isDetailPage = window.location.href.includes('/status/');

    if (isDetailPage) {
      // On detail page, the main reply box is usually visible at the bottom or top
      // It often has "Post your reply" placeholder
      const inlineComposeArea = document.querySelector('[data-testid="tweetTextarea_0"]');
      if (inlineComposeArea) {
        // Scroll into view
        inlineComposeArea.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await HumanBehaviorSimulator.randomDelay(500, 1000);

        // Click to focus/expand
        (inlineComposeArea as HTMLElement).click();
        await HumanBehaviorSimulator.randomDelay(300, 500);
        return true;
      }
    }

    // Standard flow (Modal or Inline reply button)
    // First try clicking the reply label (if inline reply exists in timeline)
    const replyLabel = document.querySelector(SELECTORS.replyLabel) as HTMLElement;
    if (replyLabel) {
      await HumanBehaviorSimulator.clickDelay();
      replyLabel.click();
      await HumanBehaviorSimulator.randomDelay(300, 500);

      const textarea = document.querySelector(SELECTORS.replyTextarea);
      if (textarea) return true;
    }

    // Fallback: Click reply button on the tweet (works for both timeline and detail)
    // On detail page, we target the main tweet's reply button
    const articles = document.querySelectorAll(SELECTORS.tweet);
    // On detail page, the main tweet is usually the stored one, or the first one if it's the conversation head
    // But usually the focused tweet is part of a conversation thread.
    // The "main" tweet in detail view often has a distinct class or position, but simply clicking the first available reply button 
    // in the focused thread might be enough. 
    // Improved strategy: Look for the reply button specifically within the main tweet cell

    // Simplification: Just find any visible reply button in the viewport
    const replyButtons = Array.from(document.querySelectorAll(SELECTORS.replyButton));
    for (const btn of replyButtons) {
      if ((btn as HTMLElement).offsetParent !== null) { // Is visible
        (btn as HTMLElement).click();
        await HumanBehaviorSimulator.randomDelay(500, 1000);
        const textarea = document.querySelector(SELECTORS.replyTextarea);
        if (textarea) return true;
      }
    }

    return false;
  }

  /**
   * Upload image to reply composer
   */
  private async uploadImageToReply(blob: Blob): Promise<boolean> {
    try {
      console.log('[ReplyPoster] Uploading image to reply...');

      // Find the file input - try dialog first, then inline reply
      let fileInput = document.querySelector(
        '[role="dialog"] input[data-testid="fileInput"]'
      ) as HTMLInputElement;

      // Fallback: Find any visible file input for tweet composition
      if (!fileInput) {
        fileInput = document.querySelector(
          'input[data-testid="fileInput"]'
        ) as HTMLInputElement;
      }

      if (!fileInput) {
        console.error('[ReplyPoster] File input not found');
        return false;
      }

      // Create a File object from the Blob
      const file = new File([blob], 'reply_image.png', {
        type: blob.type || 'image/png'
      });

      // Use DataTransfer to set files
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      fileInput.files = dataTransfer.files;

      // Trigger change event
      const changeEvent = new Event('change', { bubbles: true });
      fileInput.dispatchEvent(changeEvent);

      console.log('[ReplyPoster] Image upload triggered');

      // Wait for upload to process
      await this.delay(2000);

      // Verify image was uploaded (check for image preview)
      let imagePreview = document.querySelector('[role="dialog"] [data-testid="attachments"]');
      if (!imagePreview) {
        // Try inline reply attachments
        imagePreview = document.querySelector('[data-testid="attachments"]');
      }

      if (!imagePreview) {
        console.warn('[ReplyPoster] Image preview not found, upload may have failed');
        return false;
      }

      console.log('[ReplyPoster] Image uploaded successfully');
      return true;
    } catch (error) {
      console.error('[ReplyPoster] Image upload failed:', error);
      return false;
    }
  }

  /**
   * Fill the reply textarea with content
   */
  private async fillReplyText(content: string): Promise<boolean> {
    // Retry finding textarea up to 3 times with delay
    let textarea: HTMLElement | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      textarea = document.querySelector(SELECTORS.replyTextarea) as HTMLElement;
      if (textarea) break;
      console.log(`[ReplyPoster] Textarea not found, attempt ${attempt + 1}/3...`);
      await HumanBehaviorSimulator.randomDelay(500, 800);
    }

    if (!textarea) {
      console.error('[ReplyPoster] Textarea not found after retries');
      return false;
    }

    // Focus the textarea
    textarea.click();
    textarea.focus();
    await HumanBehaviorSimulator.randomDelay(200, 400);

    // Visual Feedback: Highlight the reply box (User Request)
    try {
      // Find the inline reply container
      const container = document.querySelector('[data-testid="inline_reply_offscreen"]') as HTMLElement;
      if (container) {
        // Apply blue outer border/shadow directly to the container
        const originalBoxShadow = container.style.boxShadow;
        const originalTransition = container.style.transition;

        container.style.transition = 'box-shadow 0.4s ease-out';
        container.style.boxShadow = '0 0 0 4px rgba(29,155,240,0.3), 0 0 15px 2px rgba(29,155,240,0.1)';

        // Auto-remove after 5s
        setTimeout(() => {
          container.style.boxShadow = originalBoxShadow;
          setTimeout(() => {
            container.style.transition = originalTransition;
          }, 400);
        }, 5000);
      }
    } catch (e) {
      console.warn('[ReplyPoster] Failed to highlight reply box:', e);
    }

    // Clear existing text if any (rare but safe)
    if (textarea.textContent && textarea.textContent.trim().length > 0) {
      document.execCommand('selectAll', false);
      document.execCommand('delete', false);
      await HumanBehaviorSimulator.microPause();
    }

    // Use simulated paste event (like ChatPanel.tsx does)
    try {
      const dataTransfer = new DataTransfer();
      dataTransfer.setData('text/plain', content);

      const pasteEvent = new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: dataTransfer
      });

      textarea.dispatchEvent(pasteEvent);
      textarea.dispatchEvent(new Event('input', { bubbles: true }));

      // Verify content was inserted
      await HumanBehaviorSimulator.randomDelay(100, 200);
      const currentContent = textarea.textContent || '';

      // If paste failed, try execCommand
      if (!currentContent.includes(content.substring(0, Math.min(content.length, 20)))) {
        document.execCommand('insertText', false, content);
      }

      return true;
    } catch (e) {
      console.error('[ReplyPoster] Failed to fill text:', e);
      try {
        document.execCommand('insertText', false, content);
        return true;
      } catch (e2) {
        console.error('[ReplyPoster] execCommand also failed:', e2);
        return false;
      }
    }
  }

  /**
   * Submit the reply
   */
  private async submitReply(): Promise<boolean> {
    // Try inline submit button first
    let submitButton = document.querySelector(SELECTORS.submitButtonInline) as HTMLElement;

    // Fallback to regular submit button
    if (!submitButton) {
      submitButton = document.querySelector(SELECTORS.submitButton) as HTMLElement;
    }

    if (!submitButton) {
      console.error('[ReplyPoster] Submit button not found');
      return false;
    }

    // Check if button is enabled
    if (submitButton.getAttribute('aria-disabled') === 'true') {
      console.error('[ReplyPoster] Submit button is disabled');
      return false;
    }

    await HumanBehaviorSimulator.randomDelay(50, 150);
    submitButton.click();

    return true;
  }

  /**
   * Wait for post success confirmation
   */
  private async waitForPostSuccess(timeout: number = 30000): Promise<boolean> {
    const startTime = Date.now();

    return new Promise((resolve) => {
      const check = setInterval(() => {
        // Method 1: Check if textarea content is cleared
        const textarea = document.querySelector(SELECTORS.replyTextarea);
        const isEmpty = !textarea || !(textarea as HTMLElement).textContent?.trim();

        // Method 2: Check if submit button is gone or disabled
        const submitBtn = document.querySelector(SELECTORS.submitButtonInline) as HTMLButtonElement;
        const submitBtn2 = document.querySelector(SELECTORS.submitButton) as HTMLButtonElement;
        const isDisabledOrGone = (!submitBtn && !submitBtn2) ||
          (submitBtn?.getAttribute('aria-disabled') === 'true') ||
          (submitBtn2?.getAttribute('aria-disabled') === 'true');

        // Method 3: Check if reply composer label is visible (means composer closed)
        const composerLabel = document.querySelector(SELECTORS.replyLabel);

        // Success condition: content cleared AND button state changed
        if (isEmpty && isDisabledOrGone) {
          clearInterval(check);
          resolve(true);
          return;
        }

        // Timeout check
        if (Date.now() - startTime > timeout) {
          clearInterval(check);
          // Even if timeout, check one more time if content is cleared
          const finalCheck = !textarea || !(textarea as HTMLElement).textContent?.trim();
          resolve(finalCheck);
        }
      }, 200);
    });
  }

  /**
   * Helper: Simple delay
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Return to timeline after posting
   */
  async returnToTimeline(): Promise<void> {
    console.log('[ReplyPoster] Returning to timeline, current URL:', window.location.pathname);

    // Check if already on home (not on a tweet detail page)
    const isOnTweetPage = window.location.pathname.includes('/status/');
    if (!isOnTweetPage) {
      console.log('[ReplyPoster] Already on timeline (not on tweet page)');
      return;
    }

    // Method 1: Click UI back button (app-bar-back)
    const backButton = document.querySelector('[data-testid="app-bar-back"]') as HTMLElement;
    if (backButton) {
      console.log('[ReplyPoster] Clicking back button');
      backButton.click();
    } else {
      // Method 2: Use history.back() as fallback
      console.log('[ReplyPoster] Back button not found, using history.back()');
      window.history.back();
    }

    // Wait for navigation to complete (check URL no longer contains /status/)
    const maxWaitTime = 5000;
    const checkInterval = 200;
    let waited = 0;

    while (waited < maxWaitTime) {
      await new Promise(resolve => setTimeout(resolve, checkInterval));
      waited += checkInterval;

      const currentPath = window.location.pathname;
      console.log('[ReplyPoster] Checking URL:', currentPath);

      // Success if no longer on a tweet detail page
      if (!currentPath.includes('/status/')) {
        console.log('[ReplyPoster] Successfully returned to timeline');
        // Extra wait for page to stabilize
        await HumanBehaviorSimulator.randomDelay(500, 1000);
        return;
      }
    }

    // If still on tweet page after max wait, force click Home tab
    console.log('[ReplyPoster] Navigation timeout, forcing Home tab click');
    const homeLink = document.querySelector('a[data-testid="AppTabBar_Home_Link"]') as HTMLElement;
    if (homeLink) {
      homeLink.click();
      await HumanBehaviorSimulator.randomDelay(1500, 2000);
    } else {
      // Last resort: create temp link inside React root (SPA navigation)
      console.log('[ReplyPoster] Home tab not found, creating temp link to navigate...');
      const tempLink = document.createElement('a');
      tempLink.href = '/home';
      tempLink.style.display = 'none';
      const reactRoot = document.getElementById('react-root') || document.body;
      reactRoot.appendChild(tempLink);
      tempLink.click();
      reactRoot.removeChild(tempLink);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
}
