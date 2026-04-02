/**
 * Ad Blocker Utility for Twitter/X
 * Detects and removes promoted tweets based on heuristics.
 */

const AD_TEXTS = new Set([
    'Ad', 'Promoted', '广告', 'プロモーション',
    'Gesponsert', 'Sponsorisé', 'Sponsorizzato', 'Promocionado',
    'Promovido', '프로모션', 'Reklam', 'Реклама',
]);

/**
 * Checks if a tweet element is a promoted tweet (ad).
 * Uses textContent instead of innerText for reliability during DOM mutations.
 */
function isPromotedTweet(tweetNode: HTMLElement): boolean {
    if (!tweetNode || tweetNode.hasAttribute('data-bnbot-ad-hidden')) return false;

    // 1. Check for tracking link parameters (highest confidence)
    if (tweetNode.querySelector('a[href*="utm_medium=cpc"], a[href*="twclid="], a[href*="utm_source=twx"]')) {
        return true;
    }

    // 2. Structural check: ad label near the caret (three-dot menu) button
    // In ad tweets, the "Ad"/"广告" label sits next to the caret button in the header.
    // This is the most reliable structural signal for timeline ads.
    const caretBtn = tweetNode.querySelector('[data-testid="caret"]');
    if (caretBtn) {
        const headerContainer = caretBtn.closest('[class*="r-18u37iz"]');
        if (headerContainer) {
            const spans = headerContainer.querySelectorAll('span');
            for (const span of spans) {
                const text = (span.textContent || '').trim();
                if (AD_TEXTS.has(text)) {
                    return true;
                }
            }
        }
    }

    // 3. Check all spans for ad text labels (fallback)
    // Use textContent which works even before layout is computed
    const spans = tweetNode.querySelectorAll('span');
    for (const span of spans) {
        const text = (span.textContent || '').trim();
        if (AD_TEXTS.has(text)) {
            // Avoid false positives: ensure this span is in the tweet header area,
            // not in the tweet body text. Check that it's NOT inside tweetText.
            const tweetText = span.closest('[data-testid="tweetText"]');
            if (!tweetText) {
                return true;
            }
        }
    }

    return false;
}

/**
 * Scans tweet nodes and hides any detected ads.
 * Includes a delayed re-check to catch ads whose DOM hasn't fully rendered yet.
 */
function checkAndHideTweets(tweets: HTMLElement[]) {
    for (const tweet of tweets) {
        if (isPromotedTweet(tweet)) {
            hideAd(tweet);
        }
    }

    // Delayed re-check: DOM content may not be fully rendered during MutationObserver callback
    setTimeout(() => {
        for (const tweet of tweets) {
            if (isPromotedTweet(tweet)) {
                hideAd(tweet);
            }
        }
    }, 200);
}

function processAddedNodes(nodes: NodeList) {
    const tweets: HTMLElement[] = [];
    nodes.forEach(node => {
        if (node instanceof HTMLElement) {
            if (node.getAttribute('data-testid') === 'tweet' || node.getAttribute('role') === 'article') {
                tweets.push(node);
            } else {
                node.querySelectorAll<HTMLElement>('[data-testid="tweet"], [role="article"]').forEach(t => {
                    tweets.push(t);
                });
            }
        }
    });
    if (tweets.length > 0) {
        checkAndHideTweets(tweets);
    }
}

function hideAd(node: HTMLElement) {
    if (node.hasAttribute('data-bnbot-ad-hidden')) return;
    node.setAttribute('data-bnbot-ad-hidden', 'true');

    // Hide the tweet article
    node.style.display = 'none';

    // Also hide the parent cell container to eliminate empty space in the timeline.
    // Twitter wraps each tweet in a cellInnerDiv container.
    const cellInner = node.closest('[data-testid="cellInnerDiv"]');
    if (cellInner instanceof HTMLElement) {
        cellInner.style.display = 'none';
    }

    console.debug('[BNBot] Ad removed');
}

/**
 * Initializes the Ad Blocker.
 * Sets up a MutationObserver to watch for new tweets.
 */
export function initAdBlocker() {
    console.log('[BNBot] Ad Blocker initialized');

    // Initial check of existing timeline
    const existingTweets = document.querySelectorAll('[data-testid="tweet"], [role="article"]');
    existingTweets.forEach(tweet => {
        if (tweet instanceof HTMLElement && isPromotedTweet(tweet)) {
            hideAd(tweet);
        }
    });

    // Observer for new tweets
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.addedNodes.length > 0) {
                processAddedNodes(mutation.addedNodes);
            }
        });
    });

    // Start observing the body or specific timeline container if possible
    // Body is easiest to catch everything (modals, timeline, sidebars)
    if (document.body) {
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    } else {
        // Wait for body to exist
        const waitForBody = setInterval(() => {
            if (document.body) {
                clearInterval(waitForBody);
                observer.observe(document.body, {
                    childList: true,
                    subtree: true
                });
            }
        }, 50);
    }
}
