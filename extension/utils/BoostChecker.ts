import { boostService, CheckTweetsResponse } from '../services/boostService';
import { TwitterClient, UserTweetsResult } from './TwitterClient';

export class BoostChecker {
    private username: string;
    private pendingTweetIds: Set<string> = new Set();
    private checkedTweetIds: Set<string> = new Set();
    private resolvingTweetIds: Set<string> = new Set();
    private debounceTimer: number | null = null;
    private observer: IntersectionObserver;

    // Cache for Quote IDs (Main ID -> Quoted ID)
    private quoteCache: Map<string, string> = new Map();
    // Cache for tweets known to have Active Boosts (from pre-checking)
    private activeBoostCache: Set<string> = new Set();

    // Proactive API state
    private userId: string | null = null;
    private isLoadingPage: boolean = false;
    private lastSeenCursor: string | null = null;

    // Performance observer for network monitoring
    private performanceObserver: PerformanceObserver | null = null;

    constructor(username: string) {
        this.username = username;
        this.observer = this.createObserver();

        // Initialize TwitterClient to fetch dynamic QueryID (logs to console)
        TwitterClient.init().catch(err => console.error('[BoostChecker] Failed to init TwitterClient:', err));

        console.log(`[BoostChecker] Initialized for user: ${username}`);
    }

    // Immediately check a batch of IDs (Pre-fetching)
    private async checkBatchImmediately(ids: string[]): Promise<void> {
        console.log(`[BoostChecker] checkBatchImmediately called with ${ids.length} IDs:`, ids);

        // Filter out already checked/pending
        const uniqueIds = ids.filter(id => !this.checkedTweetIds.has(id));
        if (uniqueIds.length === 0) {
            console.log(`[BoostChecker] All IDs already checked, skipping`);
            return;
        }

        console.log(`[BoostChecker] Sending ${uniqueIds.length} unique IDs to check-tweets API`);

        // Mark as checked so we don't check via scroll again
        uniqueIds.forEach(id => this.checkedTweetIds.add(id));

        try {
            const result = await boostService.checkTweets(uniqueIds, this.username, true);
            console.log(`[BoostChecker] check-tweets API response:`, result);

            // Add active IDs to cache
            if (result.active_tweet_ids && result.active_tweet_ids.length > 0) {
                console.log(`[BoostChecker] Pre-check found ${result.active_tweet_ids.length} active boosts!`);
                result.active_tweet_ids.forEach(id => {
                    this.activeBoostCache.add(id);
                });

                // Try to inject immediately if DOM exists
                this.renderBadges(uniqueIds, result);
            }
        } catch (error) {
            console.error('[BoostChecker] Pre-check failed:', error);
            // Allow retry via scroll if pre-check failed
            uniqueIds.forEach(id => this.checkedTweetIds.delete(id));
        }
    }

    // Create IntersectionObserver to detect tweets entering the viewport
    private createObserver(): IntersectionObserver {
        return new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    if (entry.isIntersecting) {
                        const { mainId, quotedId, isRetweet } = this.extractTweetIds(entry.target as HTMLElement);

                        // 1. Handle Main Tweet
                        // STRICT FILTER: Only check Main ID if it is a Retweet
                        if (mainId && isRetweet) {
                            if (this.activeBoostCache.has(mainId)) {
                                this.injectBadge(mainId);
                                this.checkedTweetIds.add(mainId);
                            } else if (!this.checkedTweetIds.has(mainId)) {
                                this.pendingTweetIds.add(mainId);
                            }
                        }

                        // 2. Handle Quoted Tweet
                        // Always check Quoted ID
                        if (quotedId) {
                            if (this.activeBoostCache.has(quotedId)) {
                                this.injectBadge(quotedId);
                                this.checkedTweetIds.add(quotedId);
                            } else if (!this.checkedTweetIds.has(quotedId)) {
                                this.pendingTweetIds.add(quotedId);
                            }
                        }

                        if (this.pendingTweetIds.size > 0) {
                            this.scheduleCheck();
                        }
                    }
                });
            },
            {
                root: null,           // viewport
                rootMargin: '2000px', // aggressive pre-loading
                threshold: 0.1,       // 10% visibility triggers
            }
        );
    }

    // Extract Tweet IDs (Main and Quoted) from DOM element
    // Returns object with mainId, quotedId, and flags
    private extractTweetIds(element: HTMLElement): { mainId: string | null, quotedId: string | null, isRetweet: boolean } {
        // Find all status links to extract IDs
        const links = Array.from(element.querySelectorAll('a[href*="/status/"]'));
        const ids = new Set<string>();

        links.forEach(link => {
            const href = link.getAttribute('href');
            const match = href?.match(/\/status\/(\d+)/);
            if (match) ids.add(match[1]);
        });

        const uniqueIds = Array.from(ids);
        if (uniqueIds.length === 0) return { mainId: null, quotedId: null, isRetweet: false };

        let mainId: string | null = null;
        let quotedId: string | null = null;

        // 1. Identify Main ID
        // Usually the first unique ID found, or derived from context
        const socialContext = element.querySelector('[data-testid="socialContext"]');
        const isRetweet = !!(socialContext &&
            !socialContext.textContent?.includes('Pinned') &&
            !socialContext.textContent?.includes('置顶'));

        if (isRetweet) {
            // For Retweets, the visible Tweet is the original one
            mainId = uniqueIds[0];
        } else {
            // For regular tweets, try to find the "Main" Link (timestamp link)
            const timeElements = element.querySelectorAll('time');
            if (timeElements.length > 0) {
                const mainTime = timeElements[0];
                const mainLink = links.find(l => l.contains(mainTime) || l === mainTime.closest('a'));
                if (mainLink) {
                    const match = mainLink.getAttribute('href')?.match(/\/status\/(\d+)/);
                    if (match) mainId = match[1];
                }
            }
            // Fallback if no time element found (unlikely)
            if (!mainId && uniqueIds.length > 0) mainId = uniqueIds[0];
        }

        // 2. Identify Quoted ID
        // Check for Quote Tweet structure (multiple times or quote link)
        const timeElements = element.querySelectorAll('time');
        const isQuote = timeElements.length > 1;

        if (isQuote && mainId) {
            // Strategy A: Find ID that is not Main ID
            if (uniqueIds.length > 1) {
                quotedId = uniqueIds.find(id => id !== mainId) || null;
            }

            // Strategy B: Check Cache (High Priority)
            if (!quotedId && this.quoteCache.has(mainId)) {
                quotedId = this.quoteCache.get(mainId) || null;
            }

            // Strategy C: Fetch if missing
            if (!quotedId) {
                this.resolveHiddenQuoteId(mainId);
            }
        } else if (mainId && this.quoteCache.has(mainId)) {
            // Even if DOM doesn't scream "Quote", the cache might know better
            quotedId = this.quoteCache.get(mainId) || null;
        }

        return { mainId, quotedId, isRetweet };
    }

    // Helper to fetch hidden quote IDs
    private async resolveHiddenQuoteId(mainId: string): Promise<void> {
        // Avoid re-fetching if already resolving or already checked
        if (this.resolvingTweetIds.has(mainId) || this.checkedTweetIds.has(mainId)) {
            return;
        }

        // Double check cache (maybe it arrived just now)
        if (this.quoteCache.has(mainId)) {
            const quotedId = this.quoteCache.get(mainId);
            if (quotedId && !this.checkedTweetIds.has(quotedId)) {
                this.pendingTweetIds.add(quotedId);
                this.scheduleCheck();
            }
            return;
        }

        this.resolvingTweetIds.add(mainId);
        console.log(`[BoostChecker] Cache MISS. Fetching API for main tweet: ${mainId}`);

        try {
            const quotedId = await TwitterClient.getQuotedTweetId(mainId);
            if (quotedId) {
                // Store in cache for future too
                this.quoteCache.set(mainId, quotedId);

                if (!this.checkedTweetIds.has(quotedId)) {
                    console.log(`[BoostChecker] Resolved quoted ID ${quotedId} for main tweet ${mainId}`);
                    this.pendingTweetIds.add(quotedId);
                    this.scheduleCheck();
                }
            } else {
                console.log(`[BoostChecker] No quoted ID found for main tweet ${mainId}`);
            }
        } catch (error) {
            console.error(`[BoostChecker] Failed to resolve hidden quoted ID for ${mainId}:`, error);
        } finally {
            this.resolvingTweetIds.delete(mainId);
        }
    }

    // Debounce scheduling: collect IDs and request in batch
    private scheduleCheck(): void {
        if (this.debounceTimer) {
            window.clearTimeout(this.debounceTimer);
        }

        this.debounceTimer = window.setTimeout(() => {
            this.flushPendingTweets();
        }, 1000);  // 1s debounce to allow batching
    }

    // Flush pending tweets and send API request
    private async flushPendingTweets(): Promise<void> {
        if (this.pendingTweetIds.size === 0) return;

        const tweetIds = Array.from(this.pendingTweetIds);
        this.pendingTweetIds.clear();

        // Mark as checked to detect duplicates
        tweetIds.forEach((id) => this.checkedTweetIds.add(id));

        console.log(`[BoostChecker] Checking tweets: ${tweetIds.length}`, tweetIds);

        try {
            const result = await boostService.checkTweets(tweetIds, this.username, true);
            console.log('[BoostChecker] API Response:', result);
            this.renderBadges(tweetIds, result);
        } catch (error) {
            console.error('[BoostChecker] Boost check failed:', error);
            // Remove from checked so we can retry later if they appear again (or if logic permits)
            tweetIds.forEach((id) => this.checkedTweetIds.delete(id));
        }
    }

    // Render "X Boost" badges on active tweets
    private renderBadges(requestedIds: string[], response: CheckTweetsResponse): void {
        const activeSet = new Set(response.active_tweet_ids);

        requestedIds.forEach(id => {
            if (activeSet.has(id)) {
                this.injectBadge(id);
            }
        });
    }

    private injectBadge(tweetId: string): void {
        console.log(`[BoostChecker] 🚀 READY TO INJECT BADGE for Tweet ID: ${tweetId}`);

        // Try to find the tweet element via direct link (Standard Case)
        let selector = `a[href*="/status/${tweetId}"]`;
        let links = document.querySelectorAll(selector);

        // FALLBACK: If direct link is missing, it might be a Quote Tweet without an explicit anchor.
        // We use the quoteCache to find the "Main Tweet" that contains this quote.
        if (links.length === 0) {
            // Reverse lookup: Find Main ID where value == tweetId
            for (const [mainId, quotedId] of this.quoteCache.entries()) {
                if (quotedId === tweetId) {
                    console.log(`[BoostChecker] Reverse lookup found Main ID ${mainId} for Quoted ID ${tweetId}`);
                    // Find the MAIN tweet
                    const mainSelector = `a[href*="/status/${mainId}"]`;
                    const mainLinks = document.querySelectorAll(mainSelector);

                    mainLinks.forEach(mainLink => {
                        const article = mainLink.closest('article[data-testid="tweet"]');
                        if (article) {
                            // Find the Quote Card inside this Main Tweet
                            // Quote Card is typically a div with role="link" and tabindex="0", nested inside.
                            // But NOT the main article itself.
                            const quoteCard = article.querySelector('div[role="link"][tabindex="0"]');
                            if (quoteCard) {
                                this.injectQuoteBadge(quoteCard as HTMLElement, tweetId);
                            }
                        }
                    });
                    // We can return here as we handled the specific hidden quote case
                    return;
                }
            }
        }

        links.forEach(link => {
            const article = link.closest('article[data-testid="tweet"]');
            if (!article) return;

            // Check if badge already exists
            if (article.querySelector('.bnbot-boost-badge')) return;

            // Check if this is a Quote Tweet Card (Internal "Quote" container)
            // Look for the container that WRAPS the quoted content.
            // HTML hint: <div tabindex="0" ... role="link"> contains the quoted tweet info.
            const quoteCard = link.closest('div[role="link"][tabindex="0"]');

            if (quoteCard && quoteCard !== article) {
                // This is a Quoted Tweet Card!
                this.injectQuoteBadge(quoteCard as HTMLElement, tweetId);
            } else {
                // Default: Regular/Retweet (Main Header)
                this.injectHeaderBadge(article as HTMLElement, tweetId);
            }
        });
    }

    // Inject small icon into Quote Card Top-Right Corner
    private injectQuoteBadge(card: HTMLElement, tweetId: string): void {
        console.log(`[BoostChecker] Injecting badge into Quote Card Top-Right:`, card);

        // Find the parent article and add gold border to it
        const article = card.closest('article[data-testid="tweet"]') as HTMLElement;
        if (article) {
            article.style.boxShadow = 'inset 0 0 0 1px #F0B90B';
            article.style.borderRadius = '16px';
        }

        // Ensure relative positioning for absolute child
        const computedStyle = window.getComputedStyle(card);
        if (computedStyle.position === 'static') {
            card.style.position = 'relative';
        }

        // Check for existing badge in the card
        if (card.querySelector('.bnbot-boost-badge')) return;

        const badge = document.createElement('div');
        badge.className = 'bnbot-boost-badge';
        Object.assign(badge.style, {
            position: 'absolute',
            top: '8px',
            right: '8px',
            width: '34.75px',
            height: '34.75px',
            borderRadius: '50%',
            backgroundColor: 'rgba(245, 158, 11, 0.1)', // Match header badge
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            zIndex: '10',
            transition: 'transform 0.2s, background-color 0.2s',
        });

        // Lightning Bolt Icon SVG (Amber) - same size as header badge
        badge.innerHTML = `
            <svg viewBox="0 0 24 24" aria-hidden="true" style="fill: #F59E0B; width: 18px; height: 18px;">
                <g><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"></path></g>
            </svg>
        `;

        badge.title = 'Active Boost Campaign';

        badge.onmouseenter = () => { badge.style.transform = 'scale(1.05)'; badge.style.backgroundColor = 'rgba(245, 158, 11, 0.2)'; };
        badge.onmouseleave = () => { badge.style.transform = 'scale(1)'; badge.style.backgroundColor = 'rgba(245, 158, 11, 0.1)'; };

        badge.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            window.dispatchEvent(new CustomEvent('bnbot-open-boost-tab', { detail: { tweetId } }));
        };

        card.appendChild(badge);
    }

    // Inject icon badge in the top-right corner (left of Grok button)
    private injectHeaderBadge(article: HTMLElement, tweetId: string): void {
        // Check if badge already exists
        if (article.querySelector('.bnbot-boost-badge')) return;

        // Add gold border to the article (Binance gold color)
        article.style.boxShadow = 'inset 0 0 0 1px #F0B90B';
        article.style.borderRadius = '16px';

        // Find the "more" button (caret) by data-testid="caret"
        const caretButton = article.querySelector('button[data-testid="caret"]');
        if (!caretButton) return;

        // Navigate up to find the container: div.r-1awozwy.r-6koalj.r-18u37iz
        // Structure from screenshot:
        // div.r-1awozwy.r-6koalj.r-18u37iz (caret container)
        //   └── div
        //         └── div.r-18u37iz.r-1h0z5md
        //               └── button[data-testid="caret"]
        //
        // The Grok button is the previous sibling of this container
        const caretContainer = caretButton.parentElement?.parentElement?.parentElement;
        if (!caretContainer || !caretContainer.parentElement) return;

        // The previous sibling of caretContainer is the Grok button area
        const grokArea = caretContainer.previousElementSibling;
        if (!grokArea) return;

        // Create the badge container (matching Twitter's button structure)
        const badgeContainer = document.createElement('div');
        badgeContainer.className = 'bnbot-boost-badge css-175oi2r r-18u37iz r-1h0z5md';

        // Create the button
        const badge = document.createElement('button');
        badge.setAttribute('role', 'button');
        badge.setAttribute('type', 'button');
        badge.className = 'css-175oi2r r-1777fci r-bt1l66 r-bztko3 r-lrvibr r-1loqt21 r-1ny4l3l';
        badge.title = 'Active Boost Campaign';
        badge.style.cssText = 'border-radius: 9999px; transition: background-color 0.2s; width: 34.75px; height: 34.75px; display: flex; align-items: center; justify-content: center; background-color: rgba(245, 158, 11, 0.1);';

        badge.onmouseenter = () => {
            badge.style.backgroundColor = 'rgba(245, 158, 11, 0.2)'; // Darker on hover
        };
        badge.onmouseleave = () => {
            badge.style.backgroundColor = 'rgba(245, 158, 11, 0.1)'; // Back to default
        };

        // Create the inner div structure (matching Twitter's icon button)
        const innerDiv = document.createElement('div');
        innerDiv.setAttribute('dir', 'ltr');
        innerDiv.className = 'css-146c3p1 r-bcqeeo r-1ttztb7 r-qvutc0 r-37j5jr r-a023e6 r-rjixqe r-16dba41 r-1awozwy r-6koalj r-1h0z5md r-o7ynqc r-clp7b1 r-3s2u2q';
        innerDiv.style.color = '#F59E0B'; // Amber color for the lightning bolt

        // Create the icon wrapper
        const iconWrapper = document.createElement('div');
        iconWrapper.className = 'css-175oi2r r-xoduu5';

        // Add hover background div
        const hoverBg = document.createElement('div');
        hoverBg.className = 'css-175oi2r r-xoduu5 r-1p0dtai r-1d2f490 r-u8s1d r-zchlnj r-ipm5af r-1niwhzg r-sdzlij r-xf4iuw r-o7ynqc r-6416eg r-1ny4l3l';
        iconWrapper.appendChild(hoverBg);

        // Lightning bolt SVG (same as quote card badge)
        iconWrapper.innerHTML += `
            <svg viewBox="0 0 24 24" aria-hidden="true" class="r-4qtqp9 r-yyyyoo r-dnmrzs r-bnwqim r-lrvibr r-m6rgpd r-1xvli5t r-1hdv0qi" style="fill: currentColor;">
                <g><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"></path></g>
            </svg>
        `;

        innerDiv.appendChild(iconWrapper);
        badge.appendChild(innerDiv);

        badge.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            window.dispatchEvent(new CustomEvent('bnbot-open-boost-tab', { detail: { tweetId } }));
        };

        badgeContainer.appendChild(badge);

        // Insert before the Grok button area
        caretContainer.parentElement.insertBefore(badgeContainer, grokArea);
    }

    // Start observing
    public async start(): Promise<void> {
        // 1. Get userId from DOM (Twitter profile pages contain userId in various elements)
        console.log(`[BoostChecker] Starting for @${this.username}, extracting userId from DOM...`);
        this.userId = this.extractUserIdFromDOM();

        if (!this.userId) {
            console.warn(`[BoostChecker] Could not extract userId from DOM for @${this.username}, falling back to DOM observation only`);
            // Fall back to DOM observation only
            this.observeExistingTweets();
            this.observeDOMChanges();
            return;
        }

        console.log(`[BoostChecker] Got userId: ${this.userId}`);

        // 2. Setup PerformanceObserver to monitor Twitter's network requests
        this.setupPerformanceObserver();

        // 3. Load initial page of tweets
        await this.loadTweets();

        // 4. Also observe DOM for viewport-based checking
        this.observeExistingTweets();
        this.observeDOMChanges();
    }

    // Setup PerformanceObserver to detect when Twitter loads more tweets
    private setupPerformanceObserver(): void {
        try {
            this.performanceObserver = new PerformanceObserver((list) => {
                for (const entry of list.getEntries()) {
                    const url = (entry as PerformanceResourceTiming).name;

                    // Check if this is a UserTweets request for our target user
                    if (url.includes('UserTweets') && url.includes(this.userId!)) {
                        // Extract cursor from URL to avoid duplicate requests
                        // Try multiple patterns for cursor extraction
                        let cursor: string | null = null;

                        // Pattern 1: cursor%22%3A%22xxx (URL encoded "cursor":"xxx")
                        const match1 = url.match(/cursor%22%3A%22([^%"&]+)/);
                        if (match1) cursor = match1[1];

                        // Pattern 2: "cursor":"xxx" (not encoded)
                        if (!cursor) {
                            const match2 = url.match(/"cursor":"([^"]+)"/);
                            if (match2) cursor = match2[1];
                        }

                        // Only process if this is a new cursor (pagination)
                        if (cursor && cursor !== this.lastSeenCursor) {
                            this.lastSeenCursor = cursor;
                            console.log(`[BoostChecker] Detected Twitter UserTweets request with new cursor: ${cursor.substring(0, 20)}...`);

                            // Fetch our own data with the same cursor (with delay to let Twitter's request complete first)
                            setTimeout(() => {
                                this.loadTweetsWithCursor(decodeURIComponent(cursor!));
                            }, 300);
                        }
                    }
                }
            });

            this.performanceObserver.observe({ entryTypes: ['resource'] });
            console.log(`[BoostChecker] PerformanceObserver setup complete`);
        } catch (e) {
            console.error('[BoostChecker] Failed to setup PerformanceObserver:', e);
        }
    }

    // Load tweets with a specific cursor
    private async loadTweetsWithCursor(cursor: string): Promise<void> {
        if (!this.userId) return;
        // Remove isLoadingPage check to allow parallel requests

        console.log(`[BoostChecker] Loading tweets with cursor: ${cursor.substring(0, 30)}...`);

        try {
            const result = await TwitterClient.getUserTweets(this.userId, 20, cursor);

            // Fill quoteCache with the mapping (for badge injection)
            for (const [mainId, quotedId] of Object.entries(result.quoteMap)) {
                this.quoteCache.set(mainId, quotedId);
            }

            // Collect IDs to check: quotes and retweet originals
            const idsToCheck = [...result.quoteIds, ...result.retweetOriginalIds];

            if (idsToCheck.length > 0) {
                console.log(`[BoostChecker] Found ${idsToCheck.length} quote/retweet IDs to check`);
                this.checkBatchImmediately(idsToCheck);
            }
        } catch (error) {
            console.error('[BoostChecker] Failed to load tweets:', error);
        }
    }

    // Load initial tweets (only called once at start)
    private async loadTweets(): Promise<void> {
        if (!this.userId || this.isLoadingPage) return;

        this.isLoadingPage = true;
        try {
            const result = await TwitterClient.getUserTweets(this.userId, 20);

            // Fill quoteCache with the mapping (for badge injection)
            for (const [mainId, quotedId] of Object.entries(result.quoteMap)) {
                this.quoteCache.set(mainId, quotedId);
            }
            console.log(`[BoostChecker] Populated quoteCache with ${Object.keys(result.quoteMap).length} mappings`);

            // Collect IDs to check: quotes and retweet originals
            const idsToCheck = [...result.quoteIds, ...result.retweetOriginalIds];

            if (idsToCheck.length > 0) {
                console.log(`[BoostChecker] Found ${idsToCheck.length} quote/retweet IDs to check`);
                this.checkBatchImmediately(idsToCheck);
            }
        } catch (error) {
            console.error('[BoostChecker] Failed to load tweets:', error);
        } finally {
            this.isLoadingPage = false;
        }
    }

    // Extract userId from Twitter profile page DOM
    private extractUserIdFromDOM(): string | null {
        // Method 1: Extract from profile banner image URL
        // URL format: https://pbs.twimg.com/profile_banners/{userId}/xxx/xxx
        const bannerImg = document.querySelector('img[src*="profile_banners"]') as HTMLImageElement;
        if (bannerImg?.src) {
            const match = bannerImg.src.match(/profile_banners\/(\d+)\//);
            if (match && match[1]) {
                console.log(`[BoostChecker] Found userId from profile banner: ${match[1]}`);
                return match[1];
            }
        }

        // Method 2: Extract from profile banner background-image style
        const bannerDiv = document.querySelector('div[style*="profile_banners"]') as HTMLElement;
        if (bannerDiv?.style.backgroundImage) {
            const match = bannerDiv.style.backgroundImage.match(/profile_banners\/(\d+)\//);
            if (match && match[1]) {
                console.log(`[BoostChecker] Found userId from profile banner div: ${match[1]}`);
                return match[1];
            }
        }

        // Method 3: Extract from profile image URL (fallback)
        // URL format: https://pbs.twimg.com/profile_images/{userId}/xxx
        const profileImg = document.querySelector('img[src*="profile_images"]') as HTMLImageElement;
        if (profileImg?.src) {
            const match = profileImg.src.match(/profile_images\/(\d+)\//);
            if (match && match[1]) {
                console.log(`[BoostChecker] Found userId from profile image: ${match[1]}`);
                return match[1];
            }
        }

        // Method 4: Look for follow/unfollow button with userId in data-testid
        const followButtons = document.querySelectorAll('[data-testid$="-follow"], [data-testid$="-unfollow"]');
        for (const btn of followButtons) {
            const testId = btn.getAttribute('data-testid');
            if (testId) {
                const match = testId.match(/^(\d+)-(?:follow|unfollow)$/);
                if (match && match[1]) {
                    console.log(`[BoostChecker] Found userId from follow button: ${match[1]}`);
                    return match[1];
                }
            }
        }

        return null;
    }

    // Observe existing tweets on the page
    private observeExistingTweets(): void {
        const articles = document.querySelectorAll('article[data-testid="tweet"]');
        articles.forEach((article) => this.observer.observe(article));
    }

    // Observe for new tweets (infinite scroll)
    private observeDOMChanges(): void {
        const mutationObserver = new MutationObserver((mutations) => {
            let shouldScan = false;
            mutations.forEach((mutation) => {
                if (mutation.addedNodes.length > 0) {
                    shouldScan = true;
                }
            });

            if (shouldScan) {
                // We can optimize this by only looking at added nodes, but querying all articles is safer for now
                // to ensure we don't miss any that were re-rendered
                const articles = document.querySelectorAll('article[data-testid="tweet"]');
                articles.forEach((article) => this.observer.observe(article));
            }
        });

        // Observe the main timeline container or body (with null check)
        const timeline = document.querySelector('main') || document.body;
        if (timeline) {
            mutationObserver.observe(timeline, {
                childList: true,
                subtree: true,
            });
        } else {
            // Retry when DOM is ready
            document.addEventListener('DOMContentLoaded', () => {
                const target = document.querySelector('main') || document.body;
                if (target) {
                    mutationObserver.observe(target, {
                        childList: true,
                        subtree: true,
                    });
                }
            });
        }
    }

    // Cleanup
    public destroy(): void {
        this.observer.disconnect();
        if (this.debounceTimer) {
            window.clearTimeout(this.debounceTimer);
        }
        // Stop PerformanceObserver
        if (this.performanceObserver) {
            this.performanceObserver.disconnect();
            this.performanceObserver = null;
        }

        // Remove all injected badges and gold borders
        document.querySelectorAll('.bnbot-boost-badge').forEach(el => el.remove());
        document.querySelectorAll('article[data-testid="tweet"]').forEach(article => {
            const el = article as HTMLElement;
            if (el.style.boxShadow?.includes('#F0B90B')) {
                el.style.boxShadow = '';
                el.style.borderRadius = '';
            }
        });

        this.userId = null;
        this.lastSeenCursor = null;
        console.log('[BoostChecker] Destroyed and cleaned up DOM');
    }
}
