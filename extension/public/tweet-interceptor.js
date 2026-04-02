(function() {
  if (window.__BNBOT_TWEET_INTERCEPTOR_INJECTED__) return;
  window.__BNBOT_TWEET_INTERCEPTOR_INJECTED__ = true;

  function shouldCapture() {
    return document.documentElement.getAttribute('data-bnbot-capture') === 'true';
  }

  function handleCreateTweetResponse(data) {
    try {
      const result = data?.data?.create_tweet?.tweet_results?.result;
      if (result) {
        const msg = {
          type: 'BNBOT_TWEET_CREATED',
          success: true,
          tweetId: result.rest_id,
          screenName: result.core?.user_results?.result?.core?.screen_name || result.core?.user_results?.result?.legacy?.screen_name || '',
          text: result.legacy?.full_text
        };
        document.documentElement.removeAttribute('data-bnbot-capture');
        window.postMessage(msg, '*');
        document.dispatchEvent(new CustomEvent('bnbot-tweet-created', { detail: msg }));
        console.log('[BNBOT] Tweet created:', msg.tweetId);
      } else if (data?.errors?.length > 0) {
        const msg = {
          type: 'BNBOT_TWEET_CREATED',
          success: false,
          error: data.errors[0]?.message || 'Unknown API error'
        };
        document.documentElement.removeAttribute('data-bnbot-capture');
        window.postMessage(msg, '*');
        document.dispatchEvent(new CustomEvent('bnbot-tweet-created', { detail: msg }));
      }
    } catch (e) {
      console.warn('[BNBOT Interceptor] Parse error:', e);
    }
  }

  function isCreateTweetUrl(url) {
    return url && (url.includes('CreateTweet') || url.includes('CreateNoteTweet'));
  }

  // === Intercept fetch ===
  const originalFetch = window.fetch;
  window.fetch = async function(...args) {
    const response = await originalFetch.apply(this, args);
    const url = (args[0]?.url || args[0] || '').toString();

    if (isCreateTweetUrl(url) && shouldCapture()) {
      try {
        const clone = response.clone();
        const data = await clone.json();
        handleCreateTweetResponse(data);
      } catch (e) {
        console.warn('[BNBOT Interceptor] Fetch parse error:', e);
      }
    }

    return response;
  };

  // === Intercept XMLHttpRequest ===
  const originalXHROpen = XMLHttpRequest.prototype.open;
  const originalXHRSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    this.__bnbot_url = url;
    return originalXHROpen.apply(this, [method, url, ...rest]);
  };

  XMLHttpRequest.prototype.send = function(...args) {
    this.addEventListener('load', function() {
      if (isCreateTweetUrl(this.__bnbot_url) && shouldCapture()) {
        try {
          const data = JSON.parse(this.responseText);
          handleCreateTweetResponse(data);
        } catch (e) {
          console.warn('[BNBOT Interceptor] XHR parse error:', e);
        }
      }
    });
    return originalXHRSend.apply(this, args);
  };

  console.log('[BNBOT] Tweet API interceptor installed (fetch + XHR)');
})();
