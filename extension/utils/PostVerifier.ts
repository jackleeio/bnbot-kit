/**
 * Post Verifier
 * Multi-layer verification for tweet posting results
 * Priority: API Interception > Dialog Close > Toast Detection > Timeout
 */

export interface PostVerifyResult {
  success: boolean;
  tweetId?: string;
  error?: string;
  verifiedBy: 'api' | 'dialog' | 'toast' | 'timeout';
}

export class PostVerifier {
  private static readonly TIMEOUT_MS = 15000;
  private static readonly DIALOG_CHECK_INTERVAL_MS = 300;

  /**
   * Verify post result using multiple detection methods
   * Returns as soon as any method confirms the result
   */
  static async verify(): Promise<PostVerifyResult> {
    return new Promise((resolve) => {
      let resolved = false;

      // ========== Method 1: API Response Interception (Most Reliable) ==========
      const apiHandler = (event: MessageEvent) => {
        if (resolved) return;
        if (event.data?.type === 'BNBOT_TWEET_CREATED') {
          resolved = true;
          cleanup();
          resolve({
            success: event.data.success,
            tweetId: event.data.tweetId,
            error: event.data.error,
            verifiedBy: 'api'
          });
        }
      };
      window.addEventListener('message', apiHandler);

      // ========== Method 2: Dialog Close Detection ==========
      const initialDialogExists = !!document.querySelector('[role="dialog"]');
      const dialogCheckInterval = setInterval(() => {
        if (resolved) return;

        const dialog = document.querySelector('[role="dialog"]');
        const isComposeUrl = window.location.href.includes('compose/post');

        // Dialog was open initially, now it's gone = success
        if (initialDialogExists && !dialog && !isComposeUrl) {
          resolved = true;
          cleanup();
          resolve({
            success: true,
            verifiedBy: 'dialog'
          });
        }
      }, this.DIALOG_CHECK_INTERVAL_MS);

      // ========== Method 3: Toast Detection ==========
      const toastObserver = new MutationObserver(() => {
        if (resolved) return;

        // Twitter Toast selectors
        const toasts = document.querySelectorAll('[data-testid="toast"], [role="alert"]');
        toasts.forEach(toast => {
          const text = (toast.textContent || '').toLowerCase();

          // Success keywords
          const successKeywords = ['sent', 'posted', '已发送', '发布成功', 'your post', 'your reply'];
          if (successKeywords.some(k => text.includes(k))) {
            resolved = true;
            cleanup();
            resolve({ success: true, verifiedBy: 'toast' });
          }

          // Failure keywords
          const failKeywords = ['error', 'failed', 'limit', '失败', '错误', '限制', 'try again', 'something went wrong'];
          if (failKeywords.some(k => text.includes(k))) {
            resolved = true;
            cleanup();
            resolve({ success: false, error: toast.textContent || 'Unknown error', verifiedBy: 'toast' });
          }
        });
      });
      toastObserver.observe(document.body, { childList: true, subtree: true });

      // ========== Timeout Fallback ==========
      const timeout = setTimeout(() => {
        if (resolved) return;
        resolved = true;
        cleanup();

        // Check dialog state as final judgment
        const dialogStillExists = !!document.querySelector('[role="dialog"]');
        const isComposeUrl = window.location.href.includes('compose/post');

        if (!dialogStillExists && !isComposeUrl) {
          // Dialog gone, likely success
          resolve({ success: true, verifiedBy: 'timeout' });
        } else {
          // Dialog still exists, likely failed or pending
          resolve({ success: false, error: '发布超时，请检查是否成功', verifiedBy: 'timeout' });
        }
      }, this.TIMEOUT_MS);

      // Cleanup function
      function cleanup() {
        window.removeEventListener('message', apiHandler);
        clearInterval(dialogCheckInterval);
        toastObserver.disconnect();
        clearTimeout(timeout);
      }
    });
  }
}
