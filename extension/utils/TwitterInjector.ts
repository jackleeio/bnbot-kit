import { scrapeTweet } from '../services/actions/scrapeActions';

export class TwitterInjector {
    private observer: MutationObserver;
    private injectedTweets = new WeakSet<HTMLElement>();
    private toastContainer: HTMLElement | null = null;

    constructor() {
        this.observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                mutation.addedNodes.forEach((node) => {
                    if (node instanceof HTMLElement) {
                        this.handleNewNode(node);
                    }
                });
            });
        });
    }

    private currentUserHandle: string | null = null;

    public start() {
        console.log('[BNBot] Starting TwitterInjector...');

        // Poll for current user handle if not immediately available
        this.resolveCurrentUser().then(() => {
            this.injectAll();
            this.observer.observe(document.body, {
                childList: true,
                subtree: true,
            });
        });
    }

    private resolveCurrentUser(): Promise<void> {
        return new Promise((resolve) => {
            let attempt = 0;
            const maxAttempts = 60; // 30 seconds max
            const check = () => {
                attempt++;
                const btn = document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]');
                if (btn) {
                    const text = btn.textContent || '';
                    const match = text.match(/@(\w+)/);
                    if (match) {
                        this.currentUserHandle = match[1].toLowerCase();
                        console.log('[BNBot] Resolved Current User:', this.currentUserHandle);
                        resolve();
                        return;
                    }
                }

                if (attempt >= maxAttempts) {
                    console.log('[BNBot] Could not resolve user handle after', maxAttempts, 'attempts, continuing without it');
                    resolve();
                    return;
                }

                // Keep checking - sometimes SideNav takes a moment
                setTimeout(check, 500);
            };
            check();
        });
    }

    private injectAll() {
        const tweets = document.querySelectorAll('article[data-testid="tweet"]');
        tweets.forEach((tweet) => {
            if (tweet instanceof HTMLElement) {
                this.injectButton(tweet);
            }
        });
    }

    private handleNewNode(node: HTMLElement) {
        // Check if the node itself is a tweet
        if (node.matches && node.matches('article[data-testid="tweet"]')) {
            this.injectButton(node);
        }
        // Check for tweets inside the node
        const tweets = node.querySelectorAll('article[data-testid="tweet"]');
        tweets.forEach((tweet) => {
            if (tweet instanceof HTMLElement) {
                this.injectButton(tweet);
            }
        });
    }

    private injectButton(tweet: HTMLElement) {
        if (!this.currentUserHandle) return; // Wait for user resolution
        if (this.injectedTweets.has(tweet)) return;

        // Check Ownership
        const userNameNode = tweet.querySelector('[data-testid="User-Name"]');
        if (!userNameNode) return;

        const isMyTweet = Array.from(userNameNode.querySelectorAll('a')).some(link => {
            const href = link.getAttribute('href');
            if (!href) return false;
            const handleInHref = href.substring(1).toLowerCase(); // remove leading /
            return handleInHref === this.currentUserHandle || handleInHref.startsWith(this.currentUserHandle + '/');
        });

        if (!isMyTweet) {
            // Not my tweet
            this.injectedTweets.add(tweet); // Mark as visited so we don't re-process needlessly? 
            // Actually, better to mark it so we don't keep checking.
            return;
        }

        this.injectedTweets.add(tweet);

        // Check if this is a Retweet (User doesn't want button on Retweets)
        if (tweet.querySelector('[data-testid="socialContext"]')) {
            console.log('[BNBot] Skipping Retweet');
            return;
        }

        // Check for Status Page (Tweet Detail)
        // We only want to inject into the MAIN tweet of the status page, not replies.
        // Even if the reply is mine, I probably don't want to boost it from the thread view.
        if (window.location.pathname.includes('/status/')) {
            const match = window.location.pathname.match(/status\/(\d+)/);
            if (match) {
                const statusId = match[1];
                // Check if this tweet contains a link to the status ID
                // The main tweet usually has links to itself (or we assume if it DOESN'T have a link to itself, it's safe to skip?)
                // Actually, relies check: A reply will have a link to ITS OWN ID, which is != statusId.
                // A main tweet will have a link to statusId.
                const hasStatusLink = tweet.querySelector(`a[href*="${statusId}"]`);
                if (!hasStatusLink) {
                    console.log('[BNBot] Skipping tweet on status page (ID mismatch - likely a reply)');
                    return;
                }
            }
        }



        // Strategy 0: High Priority - Find "Promote" button explicitly
        // This is the most reliable way to satisfy "Left of Promote".
        // It's often an <a> tag with specific href or aria-label.
        const promoteBtn = tweet.querySelector('a[href*="/quick_promote_web/"], [aria-label="推广"], [aria-label="Promote"]');
        if (promoteBtn) {
            // console.log('[BNBot] Found Promote button explicitely, injecting before it.');
            // We need to inject into the parent of the promote button
            // Check if we are already injected
            const container = promoteBtn.parentElement;
            if (container && !container.querySelector('.bnbot-boost-container')) {
                this.injectBefore(promoteBtn as HTMLElement, tweet);
                return;
            }
        }

        // Strategy 0.5: Medium Priority - Find "Grok" button explicitly
        // If Promote is missing (e.g. other's tweets), user wants it left of Grok.
        const grokBtn = tweet.querySelector('[aria-label="Grok"], [href*="/i/grok"]');
        if (grokBtn) {
            console.log('[BNBot] Found Grok button, injecting before it.');
            const container = grokBtn.parentElement;
            if (container && !container.querySelector('.bnbot-boost-container')) {
                this.injectBefore(grokBtn as HTMLElement, tweet);
                return;
            }
        }

        // Strategy: Start at Caret (Grandfather's Father p3), and traverse LEFT siblings.
        // We want to place X Boost before the entire "Right Side Group" (Grok, Promote, Analytics, More).
        // We do NOT want to jump over Like/Reply/Viewer/Bookmark.

        const caret = tweet.querySelector('[data-testid="caret"]');
        if (caret) {
            const p1 = caret.parentElement;
            const p2 = p1?.parentElement;
            const p3 = p2?.parentElement;

            if (p3) {
                let target = p3 as HTMLElement;

                // Check previous siblings to see if they belong to the "Right Group"
                // Right Group items usually: Grok, Promote, Analytics
                // Loop limit 3 just in case
                for (let i = 0; i < 3; i++) {
                    const prev = target.previousElementSibling as HTMLElement;
                    if (!prev) break;

                    // Helper to check if element contains specific buttons
                    const hasRightGroupItem = (el: HTMLElement) => {
                        // Check for aria-labels or hrefs commonly found in right-side items
                        return el.querySelector('[aria-label="Grok"], [href*="/i/grok"]') ||
                            el.querySelector('[aria-label="Promote"], [aria-label="推广"], [href*="/quick_promote_web/"]') ||
                            el.querySelector('[href*="/analytics"], [aria-label="View post analytics"]');
                    };

                    if (hasRightGroupItem(prev)) {
                        // Move target to this sibling (so we inject before IT)
                        target = prev;
                        console.log('[BNBot] Moving insertion target left to:', prev);
                    } else {
                        // Stop if we hit something else (like Bookmark, Share, or Spacer)
                        break;
                    }
                }

                console.log('[BNBot] Final insertion target determined.');
                if (!target.parentElement?.querySelector('.bnbot-boost-container')) {
                    this.injectBefore(target, tweet);
                }
                return;
            }
        }

        console.log('[BNBot] Could not find suitable container via Caret traversal');
    }

    private injectBefore(target: HTMLElement | null, tweet: HTMLElement) {
        if (!target) return;
        const container = target.parentElement;
        if (!container) return;

        // Check if already injected in this container to avoid duplicates
        if (container.querySelector('.bnbot-boost-container')) return;

        const boostBtn = document.createElement('div');
        boostBtn.className = 'bnbot-boost-container';

        // Status page adjustment: User wants button slightly higher and thicker
        const isStatusPage = window.location.pathname.includes('/status/');
        // Timeline: 24px height, Status: 34px height (to match Promote exactly)
        const btnHeight = isStatusPage ? '34px' : '24px';
        const btnPadding = isStatusPage ? '0 16px' : '0 12px';
        const btnFontSize = isStatusPage ? '14px' : '13px';
        const extraStyle = isStatusPage ? 'margin-right: 4px;' : 'margin-right: 0px;';

        // Match Twitter's "Promote" button style (Pill shape with border)
        boostBtn.style.cssText = `
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        ${extraStyle}
        transition: background-color 0.2s;
        height: ${btnHeight};
        border: 1px solid rgb(207, 217, 222); /* Light gray border like Promote */
        border-radius: 9999px;
        padding: ${btnPadding};
        background-color: transparent;
      `;

        // Dark mode check - naive approach or stick to transparent
        // Twitter usually handles colors via classes, but we are injecting raw styles.
        // We'll stick to a safe default that looks good on light/dim.
        // If user is on dark mode, the border might need to be darker?
        // For now, let's use a dynamic approach or just safe RGBA

        boostBtn.innerHTML = `
        <div role="button" tabindex="0" style="
            display: flex; 
            align-items: center; 
            justify-content: center; 
            height: 100%;
            width: 100%;
            color: #000000; /* Pure Black */
            font-weight: bold;
            font-size: ${btnFontSize};
            white-space: nowrap;
        ">
            <span>X Boost</span>
        </div>
      `;

        const inner = boostBtn.firstElementChild as HTMLElement;
        // Hover effect: slight background change like Twitter buttons
        boostBtn.onmouseenter = () => {
            boostBtn.style.backgroundColor = 'rgba(15, 20, 25, 0.1)';
        };
        boostBtn.onmouseleave = () => {
            boostBtn.style.backgroundColor = 'transparent';
        };

        boostBtn.onclick = (e) => {
            e.stopPropagation();
            e.preventDefault();
            const textNode = tweet.querySelector('[data-testid="tweetText"]');
            const tweetText = textNode ? textNode.textContent : '';

            // Extract tweet ID and URL from the tweet's permalink
            let tweetId = '';
            let tweetUrl = '';
            const timeLink = tweet.querySelector('a[href*="/status/"] time')?.parentElement as HTMLAnchorElement | null;
            if (timeLink?.href) {
                tweetUrl = timeLink.href;
                const idMatch = tweetUrl.match(/status\/(\d+)/);
                if (idMatch) tweetId = idMatch[1];
            }
            // Fallback: try from current URL if on status page
            if (!tweetId && window.location.pathname.includes('/status/')) {
                const urlMatch = window.location.pathname.match(/status\/(\d+)/);
                if (urlMatch) {
                    tweetId = urlMatch[1];
                    tweetUrl = window.location.href;
                }
            }

            const event = new CustomEvent('bnbot-open-boost', {
                detail: { tweetText, tweetId, tweetUrl }
            });
            window.dispatchEvent(event);
        };

        try {
            container.insertBefore(boostBtn, target);
            // console.log('[BNBot] Button inserted successfully.');
        } catch (err) {
            console.error('[BNBot] Error inserting button:', err);
        }
    }

    /**
     * Show toast notification
     */
    private showToast(message: string, type: 'success' | 'error' | 'info') {
        // Create toast container if it doesn't exist
        if (!this.toastContainer) {
            this.toastContainer = document.createElement('div');
            this.toastContainer.style.cssText = `
                position: fixed;
                top: 16px;
                right: 16px;
                z-index: 10000;
            `;
            document.body.appendChild(this.toastContainer);
        }

        // Create toast element
        const toast = document.createElement('div');
        const colors = {
            success: '#10b981',
            error: '#ef4444',
            info: '#3b82f6'
        };

        toast.style.cssText = `
            background-color: ${colors[type]};
            color: white;
            padding: 12px 16px;
            border-radius: 8px;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 8px;
            font-size: 14px;
            font-weight: 500;
        `;

        toast.textContent = message;
        this.toastContainer.appendChild(toast);

        // Auto remove after 3 seconds
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transition = 'opacity 0.3s';
            setTimeout(() => {
                toast.remove();
            }, 300);
        }, 3000);
    }
}
