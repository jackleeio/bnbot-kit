interface TweetObserverOptions {
  onTweetVisible?: (tweetId: string) => void;
}

export class TweetObserver {
  private observer: IntersectionObserver;
  private mutationObserver: MutationObserver;
  private reportedTweets = new Set<string>();
  private highlightedArticles = new Set<HTMLElement>();

  // Check if current page is a user profile page (e.g., x.com/jackleeio)
  private isProfilePage(): boolean {
    const path = window.location.pathname;
    // Profile page: /username (no /status/, /home, /explore, etc.)
    // Skip if path contains known non-profile routes
    if (path === '/' || path === '/home' || path === '/explore' ||
        path === '/notifications' || path === '/messages' ||
        path.includes('/status/') || path.includes('/search') ||
        path.includes('/settings') || path.includes('/i/')) {
      return false;
    }
    // Check if it's a simple /username pattern
    const match = path.match(/^\/([^\/]+)\/?$/);
    return !!match;
  }

  constructor(options: TweetObserverOptions = {}) {
    this.observer = new IntersectionObserver((entries) => {
      // Skip if on tweet detail page
      if (window.location.pathname.includes('/status/')) {
        return;
      }

      // On profile pages, don't add black border to all tweets
      // BoostChecker will handle gold border for boosted tweets
      const onProfilePage = this.isProfilePage();

      entries.forEach(entry => {
        const article = entry.target as HTMLElement;

        if (entry.isIntersecting) {
          this.highlightedArticles.add(article);

          const link = article.querySelector('a[href*="/status/"]');
          if (link) {
            const href = link.getAttribute('href');
            const match = href?.match(/\/status\/(\d+)/);
            if (match && match[1]) {
              const tweetId = match[1];
              if (!this.reportedTweets.has(tweetId)) {
                console.log('[TweetObserver] Found new Tweet ID:', tweetId);
                this.reportedTweets.add(tweetId);
                options.onTweetVisible?.(tweetId);
              }
            }
          }
        } else {
          this.highlightedArticles.delete(article);
        }
      });
    }, {
      threshold: 1 // Trigger when tweet is fully visible
    });

    this.mutationObserver = new MutationObserver((mutations) => {
      // Skip if on tweet detail page
      if (window.location.pathname.includes('/status/')) {
        return;
      }

      mutations.forEach(mutation => {
        mutation.addedNodes.forEach(node => {
          if (node instanceof HTMLElement) {
            const articles = node.querySelectorAll('article[role="article"][data-testid="tweet"]');
            articles.forEach(article => {
              this.observer.observe(article);
            });
          }
        });
      });
    });
  }

  public start(): void {
    console.log('[TweetObserver] Starting...');
    const path = window.location.pathname;

    // Only run on home/timeline pages, not on individual tweet pages
    if (path.includes('/status/')) {
      console.log('[TweetObserver] On tweet detail page, not starting');
      return;
    }

    this.reportedTweets.clear();
    this.highlightedArticles.clear();

    const initializeObserver = () => {
      const articles = document.querySelectorAll('article[role="article"][data-testid="tweet"]');
      console.log('[TweetObserver] Found existing articles:', articles.length);

      if (articles.length === 0) {
        // Retry after 1 second if no articles found
        setTimeout(initializeObserver, 1000);
        return;
      }

      articles.forEach(article => this.observer.observe(article));
    };

    initializeObserver();

    // 确保 document.body 存在后再观察
    if (document.body) {
      this.mutationObserver.observe(document.body, {
        childList: true,
        subtree: true
      });
    } else {
      // 等待 body 加载完成
      const waitForBody = setInterval(() => {
        if (document.body) {
          clearInterval(waitForBody);
          this.mutationObserver.observe(document.body, {
            childList: true,
            subtree: true
          });
        }
      }, 100);
    }
  }

  public stop(): void {
    console.log('[TweetObserver] Stopping...');

    this.observer.disconnect();
    this.mutationObserver.disconnect();
    this.reportedTweets.clear();
    this.highlightedArticles.clear();
  }
}
