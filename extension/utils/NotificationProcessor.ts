import { ScrapedTweet } from '../types/autoReply';
import { TimelineScroller } from './TimelineScroller';
import { navigateToUrl } from './navigationUtils';

/**
 * Notification type enum
 */
export type NotificationType = 'new_post' | 'reply' | 'like' | 'retweet' | 'mention' | 'follow' | 'unknown';

/**
 * Reply notification data structure
 */
export interface ReplyNotification {
    id: string;              // Unique notification ID
    authorHandle: string;    // Who replied
    authorName: string;      // Display name
    timestamp: string;       // When the notification was received
    previewText: string;     // Preview of the reply content
    element: HTMLElement;    // DOM element for clicking
}

export class NotificationProcessor {
    private processedNotificationIds: Set<string> = new Set();
    private processedReplyNotificationIds: Set<string> = new Set();
    private scroller: TimelineScroller;
    private lastScrollPosition: number = 0;

    constructor(scroller: TimelineScroller) {
        this.scroller = scroller;
    }

    /**
     * Create a gradient border overlay for visual feedback
     */
    private createHighlightOverlay(target: HTMLElement): HTMLElement {
        const rect = target.getBoundingClientRect();
        const overlay = document.createElement('div');

        Object.assign(overlay.style, {
            position: 'absolute',
            top: '0',
            left: '0',
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
            zIndex: '99999',
            borderRadius: 'inherit',
            boxSizing: 'border-box',
            opacity: '0',
            transition: 'opacity 0.6s ease-out',
            border: '4px solid rgba(29, 155, 240, 0.3)',
            boxShadow: 'inset 0 0 15px 2px rgba(29, 155, 240, 0.1)',
            backgroundImage: 'none',
            backgroundOrigin: 'padding-box',
            backgroundClip: 'border-box'
        });

        const computedStyle = window.getComputedStyle(target);
        overlay.style.borderRadius = computedStyle.borderRadius || '0px';

        return overlay;
    }

    /**
     * Identify the type of notification
     */
    private identifyNotificationType(cell: HTMLElement): NotificationType {
        const text = cell.textContent || '';

        // New post notification
        const newPostKeywords = ['New post', '新帖子', 'New tweet', '新推文', 'posted'];
        if (newPostKeywords.some(k => text.includes(k))) return 'new_post';

        // Reply notification
        const replyKeywords = ['replied', '回复了你', 'Replying to you', '回复了', 'replied to your'];
        if (replyKeywords.some(k => text.includes(k))) return 'reply';

        // Like notification
        if (text.includes('liked') || text.includes('喜欢了')) return 'like';

        // Retweet notification
        if (text.includes('reposted') || text.includes('转推')) return 'retweet';

        // Mention notification
        if (text.includes('mentioned') || text.includes('提到了')) return 'mention';

        // Follow notification
        if (text.includes('followed') || text.includes('关注了')) return 'follow';

        return 'unknown';
    }

    /**
     * Check if tweet timestamp is within the specified time range (in minutes)
     */
    isTweetWithinTimeRange(timestamp: string, maxMinutes: number): boolean {
        try {
            const tweetDate = new Date(timestamp);
            const now = new Date();
            const diffMs = now.getTime() - tweetDate.getTime();
            const diffMinutes = diffMs / (1000 * 60);
            return diffMinutes <= maxMinutes;
        } catch {
            console.warn('[NotificationProcessor] Failed to parse timestamp:', timestamp);
            return false;
        }
    }

    /**
     * Check if notification is from today
     */
    isToday(timestamp: string): boolean {
        try {
            const date = new Date(timestamp);
            const today = new Date();
            return date.toDateString() === today.toDateString();
        } catch {
            return false;
        }
    }

    /**
     * Navigate to notifications page
     */
    async navigateToNotifications(): Promise<void> {
        if (window.location.pathname.includes('/notifications')) {
            console.log('[NotificationProcessor] Already on notifications page');
            return;
        }

        console.log('[NotificationProcessor] Navigating to notifications page...');

        // Method 1: Click the sidebar notifications link (most natural SPA nav)
        const navLink = document.querySelector('a[data-testid="AppTabBar_Notifications_Link"]') as HTMLElement;
        if (navLink) {
            console.log('[NotificationProcessor] Clicking sidebar notifications link');
            navLink.click();
        } else {
            // Method 2: Create temp link inside React root (SPA-friendly)
            console.log('[NotificationProcessor] Sidebar link not found, using temp link');
            const tempLink = document.createElement('a');
            tempLink.href = '/notifications';
            tempLink.style.display = 'none';
            const reactRoot = document.getElementById('react-root') || document.body;
            reactRoot.appendChild(tempLink);
            tempLink.click();
            reactRoot.removeChild(tempLink);
        }

        await this.waitForPageLoad();
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Verify navigation succeeded
        if (!window.location.pathname.includes('/notifications')) {
            console.warn('[NotificationProcessor] Navigation may have failed, current path:', window.location.pathname);
        }
    }

    /**
     * Scan notifications and fetch tweets from the next unprocessed "New Post" notification
     */
    async fetchTweetsFromNextNotification(limit: number = 3): Promise<ScrapedTweet[]> {
        // 1. Ensure we are on the notifications page
        if (!window.location.pathname.includes('/notifications')) {
            await this.navigateToNotifications();
        }

        let targetNotification: HTMLElement | null = null;
        let notificationId: string | null = null;

        // 2. Look for "New post" notifications with scroll-to-find
        const keywords = ['New post notification', '新帖子通知', 'New tweet', '的新帖子通知', '新推文通知'];
        const maxScrollAttempts = 10;
        let scrollAttempts = 0;

        while (scrollAttempts <= maxScrollAttempts) {
            const cells = Array.from(document.querySelectorAll('div[data-testid="cellInnerDiv"]'));
            console.log(`[NotificationProcessor] Scroll ${scrollAttempts}/${maxScrollAttempts}: Found ${cells.length} cells`);

            for (const cell of cells) {
                const text = cell.textContent || '';
                const isNewPost = keywords.some(k => text.includes(k));

                if (isNewPost) {
                    const article = cell.querySelector('article[data-testid="notification"]');

                    // Unique ID generation
                    const link = cell.querySelector('a[href*="/status/"]');
                    const userLink = cell.querySelector('a[role="link"]');
                    const href = link ? link.getAttribute('href') : (userLink ? userLink.getAttribute('href') : '');

                    const id = `notif-${href}-${text.substring(0, 30)}`;

                    if (!this.processedNotificationIds.has(id)) {
                        targetNotification = (article || cell) as HTMLElement;
                        notificationId = id;
                        break;
                    }
                }
            }

            // Found one, stop scrolling
            if (targetNotification) break;

            // Scroll down to load more notifications
            scrollAttempts++;
            if (scrollAttempts <= maxScrollAttempts) {
                window.scrollBy({ top: 600, behavior: 'smooth' });
                await new Promise(resolve => setTimeout(resolve, 1200));
            }
        }

        if (!targetNotification || !notificationId) {
            console.log('[NotificationProcessor] No new unprocessed "New Post" notifications found after scrolling.');
            return [];
        }

        console.log('[NotificationProcessor] Found target notification:', notificationId);

        // 4. Visual feedback and click
        const originalTransition = targetNotification.style.transition;
        const originalBoxShadow = targetNotification.style.boxShadow;
        const originalZIndex = targetNotification.style.zIndex;
        const originalPosition = targetNotification.style.position || 'relative';

        targetNotification.style.transition = 'all 0.2s ease-in-out';
        targetNotification.style.zIndex = '99999';
        targetNotification.style.position = 'relative';

        const overlay = this.createHighlightOverlay(targetNotification);
        targetNotification.appendChild(overlay);

        requestAnimationFrame(() => {
            overlay.style.opacity = '1';
        });

        targetNotification.scrollIntoView({ behavior: 'auto', block: 'center' });
        window.scrollBy(0, -50);

        console.log('[NotificationProcessor] Highlighting notification before click...');
        await new Promise(resolve => setTimeout(resolve, 1500));

        // Cleanup
        overlay.remove();
        targetNotification.style.boxShadow = originalBoxShadow;
        targetNotification.style.transform = '';
        targetNotification.style.zIndex = originalZIndex;
        targetNotification.style.position = originalPosition;

        (targetNotification as HTMLElement).click();

        // 5. Wait for timeline to load
        console.log('[NotificationProcessor] Clicked notification, waiting for timeline...');
        await new Promise(resolve => setTimeout(resolve, 4000));

        // 6. Scrape tweets from this new view
        console.log('[NotificationProcessor] Scraping top tweets from notification timeline...');
        const tweets = await this.scroller.scanTweetsInCurrentView();

        const uniqueTweets = tweets.slice(0, limit);
        uniqueTweets.forEach(t => t.source = 'notification');

        console.log(`[NotificationProcessor] Scraped ${uniqueTweets.length} tweets.`);

        // 7. Mark notification as processed
        this.processedNotificationIds.add(notificationId);

        return uniqueTweets;
    }

    /**
     * Fetch the next unprocessed reply notification
     */
    async fetchNextReplyNotification(): Promise<ReplyNotification | null> {
        // Ensure we're on notifications page
        if (!window.location.pathname.includes('/notifications')) {
            await this.navigateToNotifications();
        }

        // Scroll to find reply notifications
        const maxScrollAttempts = 10;
        let scrollAttempts = 0;

        while (scrollAttempts < maxScrollAttempts) {
            const cells = Array.from(document.querySelectorAll('div[data-testid="cellInnerDiv"]'));

            for (const cell of cells) {
                const notificationType = this.identifyNotificationType(cell as HTMLElement);

                if (notificationType === 'reply') {
                    // Extract notification data
                    const text = cell.textContent || '';

                    // Get author handle
                    const userLink = cell.querySelector('a[role="link"][href^="/"]');
                    const authorHandle = userLink?.getAttribute('href')?.substring(1) || '';

                    // Get author name
                    const nameSpan = cell.querySelector('span');
                    const authorName = nameSpan?.textContent?.trim() || '';

                    // Get timestamp
                    const timeEl = cell.querySelector('time');
                    const timestamp = timeEl?.getAttribute('datetime') || new Date().toISOString();

                    // Generate unique ID
                    const id = `reply-${authorHandle}-${timestamp}`;

                    // Skip if already processed in this session
                    if (this.processedReplyNotificationIds.has(id)) {
                        continue;
                    }

                    // Mark as processed for this session
                    this.processedReplyNotificationIds.add(id);

                    console.log('[NotificationProcessor] Found reply notification:', id);

                    return {
                        id,
                        authorHandle,
                        authorName,
                        timestamp,
                        previewText: text.substring(0, 100),
                        element: cell as HTMLElement
                    };
                }
            }

            // Scroll down to find more
            window.scrollBy({ top: 500, behavior: 'smooth' });
            await new Promise(resolve => setTimeout(resolve, 1000));
            scrollAttempts++;
        }

        console.log('[NotificationProcessor] No more reply notifications found');
        return null;
    }

    /**
     * Click a notification element to enter it
     */
    async clickNotification(notification: ReplyNotification): Promise<void> {
        console.log('[NotificationProcessor] Clicking notification:', notification.id);

        // Save scroll position
        this.lastScrollPosition = window.scrollY;

        // Visual feedback
        notification.element.style.transition = 'all 0.2s ease-in-out';
        notification.element.style.position = 'relative';

        const overlay = this.createHighlightOverlay(notification.element);
        notification.element.appendChild(overlay);

        requestAnimationFrame(() => {
            overlay.style.opacity = '1';
        });

        notification.element.scrollIntoView({ behavior: 'auto', block: 'center' });

        await new Promise(resolve => setTimeout(resolve, 1000));

        overlay.remove();
        notification.element.click();

        await new Promise(resolve => setTimeout(resolve, 3000));
    }

    /**
     * Scrape the current tweet on the page
     */
    async scrapCurrentTweet(): Promise<ScrapedTweet | null> {
        const tweets = await this.scroller.scanTweetsInCurrentView();

        if (tweets.length > 0) {
            // The first tweet should be the main one we're looking at
            tweets[0].source = 'notification';
            return tweets[0];
        }

        return null;
    }

    /**
     * Like the current tweet
     */
    async likeTweet(): Promise<boolean> {
        try {
            // Find the like button (not already liked)
            const likeButton = document.querySelector('button[data-testid="like"]') as HTMLElement;

            if (!likeButton) {
                console.log('[NotificationProcessor] Like button not found');
                return false;
            }

            // Check if already liked (button would have data-testid="unlike")
            const isAlreadyLiked = document.querySelector('button[data-testid="unlike"]');
            if (isAlreadyLiked) {
                console.log('[NotificationProcessor] Tweet already liked');
                return false;
            }

            // Click the like button
            likeButton.click();
            await new Promise(resolve => setTimeout(resolve, 500));

            // Verify it was liked
            const nowLiked = document.querySelector('button[data-testid="unlike"]');
            if (nowLiked) {
                console.log('[NotificationProcessor] Tweet liked successfully');
                return true;
            }

            return false;
        } catch (error) {
            console.error('[NotificationProcessor] Failed to like tweet:', error);
            return false;
        }
    }

    /**
     * Random like with configurable probability
     */
    async randomLike(probability: number = 0.5): Promise<boolean> {
        if (Math.random() < probability) {
            return await this.likeTweet();
        }
        return false;
    }

    /**
     * Wait for page to load
     */
    private async waitForPageLoad(): Promise<void> {
        return new Promise<void>(resolve => {
            if (document.readyState === 'complete') return resolve();
            window.addEventListener('load', () => resolve(), { once: true });
            setTimeout(resolve, 5000);
        });
    }

    /**
     * Clear processed notification IDs (for testing or new session)
     */
    clearProcessedNotifications(): void {
        this.processedNotificationIds.clear();
        this.processedReplyNotificationIds.clear();
        console.log('[NotificationProcessor] Cleared processed notifications');
    }

    /**
     * Get count of processed notifications
     */
    getProcessedCount(): { newPost: number; reply: number } {
        return {
            newPost: this.processedNotificationIds.size,
            reply: this.processedReplyNotificationIds.size
        };
    }
}
