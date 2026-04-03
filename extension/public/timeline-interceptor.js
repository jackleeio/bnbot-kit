/**
 * Timeline API Interceptor
 *
 * This script is injected into the page context to intercept fetch/XHR requests
 * and capture various Twitter API responses. Data is sent back to the content script
 * via postMessage.
 *
 * Monitored endpoints:
 * - HomeTimeline / HomeLatestTimeline (timeline tweets)
 * - Notifications (notification tweets)
 * - TweetDetail (tweet details)
 * - UserTweets (user profile tweets)
 */
(function() {
  'use strict';

  // Avoid double injection
  if (window.__BNBOT_TIMELINE_INTERCEPTOR_INJECTED__) {
    return;
  }
  window.__BNBOT_TIMELINE_INTERCEPTOR_INJECTED__ = true;

  console.log('[BNBot Timeline Interceptor] Initializing...');

  // Monitored API endpoints
  const MONITORED_ENDPOINTS = [
    { pattern: '/HomeTimeline', type: 'timeline' },
    { pattern: '/HomeLatestTimeline', type: 'timeline' },
    { pattern: '/Notifications', type: 'notifications' },
    { pattern: '/TweetDetail', type: 'tweet_detail' },
    { pattern: '/UserTweets', type: 'user_tweets' },
    { pattern: '/ListLatestTweetsTimeline', type: 'list_tweets' },
    { pattern: '/SearchTimeline', type: 'search' },
    { pattern: '/Followers', type: 'followers' },
    { pattern: '/Following', type: 'following' },
    { pattern: '/BlueVerifiedFollowers', type: 'blue_verified_followers' },
    { pattern: '/FollowersYouKnow', type: 'followers_you_know' },
  ];

  // Broader pattern to catch any Twitter GraphQL API response for video extraction
  const GRAPHQL_API_PATTERN = '/i/api/graphql/';

  /**
   * Extract video URLs from Twitter API response data.
   * Finds tweet result objects and checks their legacy.extended_entities for videos.
   * @returns {Object} Map of tweetId -> { url, thumbnail, duration }
   */
  function extractVideoUrls(data) {
    const videos = {};

    function extractFromMedia(restId, legacy) {
      if (!restId || !legacy || !legacy.extended_entities) return;
      var media = legacy.extended_entities.media;
      if (!media) return;
      for (var i = 0; i < media.length; i++) {
        var item = media[i];
        if (item.type !== 'video' && item.type !== 'animated_gif') continue;
        var variants = item.video_info && item.video_info.variants;
        if (!variants || variants.length === 0) continue;
        var best = null;
        for (var j = 0; j < variants.length; j++) {
          if (variants[j].content_type === 'video/mp4') {
            if (!best || (variants[j].bitrate || 0) > (best.bitrate || 0)) {
              best = variants[j];
            }
          }
        }
        if (best) {
          videos[restId] = {
            url: best.url,
            thumbnail: item.media_url_https || '',
            duration: item.video_info.duration_millis ? item.video_info.duration_millis / 1000 : 0
          };
        }
      }
    }

    // Process a single tweet result object (the one with __typename "Tweet")
    // parentId: the outer tweet's rest_id (for retweets, so we can map both IDs)
    function processTweetResult(result, parentId) {
      if (!result) return;
      // Handle TweetWithVisibilityResults wrapper
      var tweet = result.tweet || result;
      if (tweet.rest_id && tweet.legacy) {
        extractFromMedia(tweet.rest_id, tweet.legacy);
        // If this is a retweet's inner tweet, also map the parent (retweeter) ID to the same video
        if (parentId && parentId !== tweet.rest_id && videos[tweet.rest_id]) {
          videos[parentId] = videos[tweet.rest_id];
        }
      }
      // Check retweeted status (retweets)
      if (tweet.legacy && tweet.legacy.retweeted_status_result && tweet.legacy.retweeted_status_result.result) {
        processTweetResult(tweet.legacy.retweeted_status_result.result, tweet.rest_id);
      }
      // Also check quoted tweet
      if (tweet.quoted_status_result && tweet.quoted_status_result.result) {
        processTweetResult(tweet.quoted_status_result.result, tweet.rest_id);
      }
    }

    try {
      // Navigate the known Twitter API structure
      var instructions = data &&
        data.data &&
        data.data.home &&
        data.data.home.home_timeline_urt &&
        data.data.home.home_timeline_urt.instructions;

      console.log('[BNBot Timeline Interceptor] extractVideoUrls: data keys=', data ? Object.keys(data) : 'null',
        'data.data keys=', (data && data.data) ? Object.keys(data.data) : 'null',
        'instructions found (home)=', !!instructions);

      // Also try other API shapes (TweetDetail, UserTweets, etc.)
      if (!instructions) {
        instructions = data &&
          data.data &&
          data.data.threaded_conversation_with_injections_v2 &&
          data.data.threaded_conversation_with_injections_v2.instructions;
      }
      if (!instructions) {
        instructions = data &&
          data.data &&
          data.data.timeline_by_id &&
          data.data.timeline_by_id.timeline &&
          data.data.timeline_by_id.timeline.instructions;
      }
      if (!instructions) {
        instructions = data &&
          data.data &&
          data.data.user &&
          data.data.user.result &&
          data.data.user.result.timeline_v2 &&
          data.data.user.result.timeline_v2.timeline &&
          data.data.user.result.timeline_v2.timeline.instructions;
      }
      if (!instructions) {
        instructions = data &&
          data.data &&
          data.data.tweetResult &&
          [{ type: 'TimelineAddEntries', entries: [{ content: { itemContent: { tweet_results: data.data.tweetResult } } }] }];
      }

      // Fallback: try to find instructions anywhere in data.data
      if (!instructions && data && data.data) {
        // Walk data.data one level to find any object with .instructions
        var dd = data.data;
        var ddKeys = Object.keys(dd);
        for (var k = 0; k < ddKeys.length && !instructions; k++) {
          var v = dd[ddKeys[k]];
          if (v && typeof v === 'object') {
            if (v.instructions) {
              instructions = v.instructions;
            } else if (v.timeline && v.timeline.instructions) {
              instructions = v.timeline.instructions;
            } else if (v.result && v.result.timeline_v2 && v.result.timeline_v2.timeline) {
              instructions = v.result.timeline_v2.timeline.instructions;
            } else {
              // One more level (e.g. data.data.X.Y.instructions)
              var vKeys = Object.keys(v);
              for (var k2 = 0; k2 < vKeys.length && !instructions; k2++) {
                var v2 = v[vKeys[k2]];
                if (v2 && typeof v2 === 'object') {
                  if (v2.instructions) instructions = v2.instructions;
                  else if (v2.timeline && v2.timeline.instructions) instructions = v2.timeline.instructions;
                }
              }
            }
          }
        }
      }

      if (!instructions || !Array.isArray(instructions)) {
        console.log('[BNBot Timeline Interceptor] extractVideoUrls: no instructions found');
        return videos;
      }

      console.log('[BNBot Timeline Interceptor] extractVideoUrls: processing', instructions.length, 'instructions');
      var totalEntries = 0;

      for (var i = 0; i < instructions.length; i++) {
        var instruction = instructions[i];
        var entries = instruction.entries;
        // Also handle moduleItems for conversation threads
        if (instruction.entry) {
          entries = [instruction.entry];
        }
        if (!entries) continue;

        for (var j = 0; j < entries.length; j++) {
          var entry = entries[j];
          // Regular tweet entry
          var itemContent = entry.content && entry.content.itemContent;
          if (itemContent && itemContent.tweet_results && itemContent.tweet_results.result) {
            totalEntries++;
            processTweetResult(itemContent.tweet_results.result);
          }

          // Conversation thread / module entries
          var items = entry.content && entry.content.items;
          if (items && Array.isArray(items)) {
            for (var m = 0; m < items.length; m++) {
              var moduleItem = items[m].item && items[m].item.itemContent;
              if (moduleItem && moduleItem.tweet_results && moduleItem.tweet_results.result) {
                processTweetResult(moduleItem.tweet_results.result);
              }
            }
          }
        }
      }

      // Handle TweetDetail single tweet response
      if (data.data && data.data.tweetResult && data.data.tweetResult.result) {
        processTweetResult(data.data.tweetResult.result);
      }

    } catch (err) {
      console.warn('[BNBot Timeline Interceptor] extractVideoUrls error:', err);
    }

    return videos;
  }

  /**
   * Check if URL matches any monitored endpoint
   * @returns {{ pattern: string, type: string } | null}
   */
  function matchEndpoint(url) {
    for (const endpoint of MONITORED_ENDPOINTS) {
      if (url.includes(endpoint.pattern)) {
        return endpoint;
      }
    }
    return null;
  }

  // Store original fetch
  const originalFetch = window.fetch;

  // Intercept fetch requests
  window.fetch = async function(...args) {
    const response = await originalFetch.apply(this, args);

    try {
      const url = args[0]?.toString() || '';
      const matched = matchEndpoint(url);

      if (matched) {
        // Clone the response to read without consuming the original
        const clone = response.clone();

        clone.json().then(data => {
          console.log(`[BNBot Timeline Interceptor] Captured ${matched.type} API response`);

          // Extract video URLs from the response
          var videos = extractVideoUrls(data);
          if (videos && Object.keys(videos).length > 0) {
            console.log(`[BNBot Timeline Interceptor] Found ${Object.keys(videos).length} videos`);
            window.postMessage({
              type: 'BNBOT_VIDEO_DATA',
              payload: videos
            }, '*');
          }

          // Send data to content script via postMessage
          // For backward compatibility, timeline data uses BNBOT_TIMELINE_DATA
          // All data also sent via BNBOT_API_DATA for unified handling
          if (matched.type === 'timeline') {
            window.postMessage({
              type: 'BNBOT_TIMELINE_DATA',
              payload: data
            }, '*');
          }

          // Unified API data message for all endpoints
          window.postMessage({
            type: 'BNBOT_API_DATA',
            endpoint: matched.type,
            pattern: matched.pattern,
            payload: data
          }, '*');
        }).catch(err => {
          // Silently ignore JSON parse errors (e.g., if response is not JSON)
        });
      }
    } catch (err) {
      // Silently ignore any errors to avoid breaking the page
    }

    return response;
  };

  // Also intercept XMLHttpRequest for completeness
  const originalXHROpen = XMLHttpRequest.prototype.open;
  const originalXHRSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    this._bnbotUrl = url;
    return originalXHROpen.apply(this, [method, url, ...rest]);
  };

  XMLHttpRequest.prototype.send = function(...args) {
    const xhr = this;
    const url = xhr._bnbotUrl || '';
    const matched = matchEndpoint(url);

    if (matched) {
      xhr.addEventListener('load', function() {
        try {
          const data = JSON.parse(xhr.responseText);
          console.log(`[BNBot Timeline Interceptor] Captured ${matched.type} XHR response`);

          // Extract video URLs from XHR response
          var xhrVideos = extractVideoUrls(data);
          if (xhrVideos && Object.keys(xhrVideos).length > 0) {
            console.log(`[BNBot Timeline Interceptor] Found ${Object.keys(xhrVideos).length} videos (XHR)`);
            window.postMessage({
              type: 'BNBOT_VIDEO_DATA',
              payload: xhrVideos
            }, '*');
          }

          // For backward compatibility
          if (matched.type === 'timeline') {
            window.postMessage({
              type: 'BNBOT_TIMELINE_DATA',
              payload: data
            }, '*');
          }

          // Unified API data message
          window.postMessage({
            type: 'BNBOT_API_DATA',
            endpoint: matched.type,
            pattern: matched.pattern,
            payload: data
          }, '*');
        } catch (err) {
          // Silently ignore parse errors
        }
      });
    }

    return originalXHRSend.apply(this, args);
  };

  /**
   * Fetch HomeTimeline data directly
   * This is called when we need to manually refresh the cache
   */
  async function fetchHomeTimeline() {
    console.log('[BNBot Timeline Interceptor] Manually fetching HomeTimeline...');

    try {
      // Get CSRF token from cookie
      const csrfToken = document.cookie
        .split('; ')
        .find(row => row.startsWith('ct0='))
        ?.split('=')[1];

      if (!csrfToken) {
        console.error('[BNBot Timeline Interceptor] CSRF token not found');
        return;
      }

      const variables = {
        count: 20,
        includePromotedContent: true,
        requestContext: 'launch',
        withCommunity: true
      };

      const features = {
        rweb_video_screen_enabled: false,
        profile_label_improvements_pcf_label_in_post_enabled: true,
        responsive_web_profile_redirect_enabled: false,
        rweb_tipjar_consumption_enabled: false,
        verified_phone_label_enabled: false,
        creator_subscriptions_tweet_preview_api_enabled: true,
        responsive_web_graphql_timeline_navigation_enabled: true,
        responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
        premium_content_api_read_enabled: false,
        communities_web_enable_tweet_community_results_fetch: true,
        c9s_tweet_anatomy_moderator_badge_enabled: true,
        responsive_web_grok_analyze_button_fetch_trends_enabled: false,
        responsive_web_grok_analyze_post_followups_enabled: true,
        responsive_web_jetfuel_frame: true,
        responsive_web_grok_share_attachment_enabled: true,
        responsive_web_grok_annotations_enabled: false,
        articles_preview_enabled: true,
        responsive_web_edit_tweet_api_enabled: true,
        graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
        view_counts_everywhere_api_enabled: true,
        longform_notetweets_consumption_enabled: true,
        responsive_web_twitter_article_tweet_consumption_enabled: true,
        tweet_awards_web_tipping_enabled: false,
        responsive_web_grok_show_grok_translated_post: false,
        responsive_web_grok_analysis_button_from_backend: true,
        post_ctas_fetch_enabled: true,
        creator_subscriptions_quote_tweet_preview_enabled: false,
        freedom_of_speech_not_reach_fetch_enabled: true,
        standardized_nudges_misinfo: true,
        tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
        longform_notetweets_rich_text_read_enabled: true,
        longform_notetweets_inline_media_enabled: true,
        responsive_web_grok_image_annotation_enabled: true,
        responsive_web_grok_imagine_annotation_enabled: true,
        responsive_web_grok_community_note_auto_translation_is_enabled: false,
        responsive_web_enhance_cards_enabled: false
      };

      const url = `https://x.com/i/api/graphql/XzjVq_S9RnjdhmUGGPjpuw/HomeTimeline?variables=${encodeURIComponent(JSON.stringify(variables))}&features=${encodeURIComponent(JSON.stringify(features))}`;

      const response = await originalFetch(url, {
        method: 'GET',
        headers: {
          'accept': '*/*',
          'accept-language': 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7',
          'authorization': 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA',
          'content-type': 'application/json',
          'x-csrf-token': csrfToken,
          'x-twitter-active-user': 'yes',
          'x-twitter-auth-type': 'OAuth2Session',
          'x-twitter-client-language': 'en'
        },
        credentials: 'include'
      });

      if (response.ok) {
        const data = await response.json();
        console.log('[BNBot Timeline Interceptor] Manual fetch successful');

        // Send data to content script (both formats for backward compatibility)
        window.postMessage({
          type: 'BNBOT_TIMELINE_DATA',
          payload: data
        }, '*');

        // Also send as BNBOT_API_DATA so ApiDataCache can receive it
        window.postMessage({
          type: 'BNBOT_API_DATA',
          endpoint: 'timeline',
          pattern: '/HomeTimeline',
          payload: data
        }, '*');
      } else {
        console.error('[BNBot Timeline Interceptor] Manual fetch failed:', response.status);
      }
    } catch (err) {
      console.error('[BNBot Timeline Interceptor] Manual fetch error:', err);
    }
  }

  // Listen for requests from content script
  window.addEventListener('message', function(event) {
    if (event.source !== window) return;

    if (event.data?.type === 'BNBOT_REFRESH_TIMELINE') {
      fetchHomeTimeline();
    }

    // Fetch relay: content script asks page context to make a fetch request
    // Runs in page context so Twitter's fetch wrapper adds x-client-transaction-id
    if (event.data?.type === 'BNBOT_FETCH_REQUEST') {
      var requestId = event.data.requestId;
      var url = event.data.url;
      console.log('[BNBot Interceptor] Fetch relay request:', requestId, url.substring(0, 80));

      // Get CSRF token from cookies
      var csrfToken = '';
      try {
        var match = document.cookie.match(/ct0=([^;]+)/);
        if (match) csrfToken = match[1];
      } catch(e) {}

      var headers = {
        'authorization': 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA',
        'content-type': 'application/json',
        'x-twitter-active-user': 'yes',
        'x-twitter-auth-type': 'OAuth2Session',
        'x-twitter-client-language': 'en',
      };
      if (csrfToken) {
        headers['x-csrf-token'] = csrfToken;
      }

      fetch(url, { method: 'GET', headers: headers, credentials: 'include' })
        .then(function(resp) {
          if (!resp.ok) {
            throw new Error('HTTP ' + resp.status);
          }
          return resp.json();
        })
        .then(function(data) {
          window.postMessage({
            type: 'BNBOT_FETCH_RESPONSE',
            requestId: requestId,
            data: data
          }, '*');
        })
        .catch(function(err) {
          window.postMessage({
            type: 'BNBOT_FETCH_RESPONSE',
            requestId: requestId,
            error: err.message
          }, '*');
        });
    }
  });

  console.log('[BNBot Timeline Interceptor] Ready - intercepting fetch and XHR');
})();
