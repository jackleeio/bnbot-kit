/**
 * Tweet Post Interceptor
 * Intercepts CreateTweet/CreateNoteTweet API responses to get reliable post results
 */

export class TweetPostInterceptor {
  private static injected = false;

  /**
   * Inject interceptor script into the page
   */
  static inject(): void {
    if (this.injected) return;
    if (typeof window === 'undefined') return;
    if ((window as any).__BNBOT_TWEET_INTERCEPTOR_INJECTED__) return;

    try {
      const script = document.createElement('script');
      script.src = chrome.runtime.getURL('tweet-interceptor.js');
      document.documentElement.appendChild(script);
      script.onload = () => script.remove();
      this.injected = true;
      console.log('[TweetPostInterceptor] Injected');
    } catch {
      // Extension context invalidated (extension reloaded) — skip silently
    }
  }

  /**
   * Reset injection state (for testing or page reload)
   */
  static reset(): void {
    this.injected = false;
  }
}

// Declare global type
declare global {
  interface Window {
    __BNBOT_TWEET_INTERCEPTOR_INJECTED__?: boolean;
  }
}
