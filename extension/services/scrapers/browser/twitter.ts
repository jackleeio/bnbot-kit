/**
 * Twitter/X read scrapers — GraphQL API approach (no content script needed).
 *
 * Opens an x.com tab, reads ct0 cookie for CSRF auth, calls Twitter's internal
 * GraphQL APIs directly. Same pattern as Bilibili/TikTok background scrapers.
 * Write operations (post, reply, like, etc.) stay in the content script.
 */

import { getTab, checkLoginRedirect, executeInPage } from '../../scraperService';

const BEARER = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';

// Fallback queryIds — resolved dynamically at runtime from GitHub or Twitter bundles
const QID = {
  HomeTimeline: 'c-CzHF1LboFilMpsx4ZCrQ',
  HomeLatestTimeline: 'BKB7oi212Fi7kQtCBGE4zA',
  SearchTimeline: 'MJpjKqXlT-Kf2m3AepDxMg',
  UserByScreenName: 'qRednkZG-rn1P6b48NINmQ',
  UserTweets: 'q6xj5bs0hapm9309hexA_g',
  TweetDetail: 'xd_EMdYvB9hfZsZ6Idri0w',
  Bookmarks: 'Fy0QMy4q_aZCpkO0PnyLYw',
};

export async function getTwitterTimeline(type: 'for-you' | 'following' = 'for-you', limit = 20): Promise<any[]> {
  const tabId = await getTab('https://x.com/home');
  await new Promise(r => setTimeout(r, 3000));
  await checkLoginRedirect(tabId, 'Twitter');

  const data = await executeInPage(tabId, async (bearer: string, fallbackQid: string, fallbackQidLatest: string, timelineType: string, lim: number) => {
    try {
      const ct0 = document.cookie.split(';').map((c: string) => c.trim()).find((c: string) => c.startsWith('ct0='))?.split('=')[1];
      if (!ct0) return { error: 'Not logged into x.com (no ct0 cookie)' };

      async function resolveQueryId(operationName: string, fallback: string): Promise<string> {
        try {
          const res = await fetch('https://raw.githubusercontent.com/fa0311/twitter-openapi/refs/heads/main/src/config/placeholder.json');
          if (res.ok) {
            const d = await res.json();
            const qid = d?.[operationName]?.queryId;
            if (qid && /^[A-Za-z0-9_-]+$/.test(qid)) return qid;
          }
        } catch {}
        return fallback;
      }

      const isFollowing = timelineType === 'following';
      const operationName = isFollowing ? 'HomeLatestTimeline' : 'HomeTimeline';
      const method = isFollowing ? 'POST' : 'GET';
      const queryId = await resolveQueryId(operationName, isFollowing ? fallbackQidLatest : fallbackQid);

      const headers: Record<string, string> = {
        'Authorization': 'Bearer ' + decodeURIComponent(bearer),
        'X-Csrf-Token': ct0,
        'X-Twitter-Auth-Type': 'OAuth2Session',
        'X-Twitter-Active-User': 'yes',
      };

      const FEATURES = { rweb_video_screen_enabled: false, profile_label_improvements_pcf_label_in_post_enabled: true, rweb_tipjar_consumption_enabled: true, verified_phone_label_enabled: false, creator_subscriptions_tweet_preview_api_enabled: true, responsive_web_graphql_timeline_navigation_enabled: true, responsive_web_graphql_skip_user_profile_image_extensions_enabled: false, premium_content_api_read_enabled: false, communities_web_enable_tweet_community_results_fetch: true, c9s_tweet_anatomy_moderator_badge_enabled: true, responsive_web_grok_analyze_button_fetch_trends_enabled: false, responsive_web_grok_analyze_post_followups_enabled: true, responsive_web_grok_share_attachment_enabled: true, articles_preview_enabled: true, responsive_web_edit_tweet_api_enabled: true, graphql_is_translatable_rweb_tweet_is_translatable_enabled: true, view_counts_everywhere_api_enabled: true, longform_notetweets_consumption_enabled: true, responsive_web_twitter_article_tweet_consumption_enabled: true, tweet_awards_web_tipping_enabled: false, freedom_of_speech_not_reach_fetch_enabled: true, standardized_nudges_misinfo: true, tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true, longform_notetweets_rich_text_read_enabled: true, longform_notetweets_inline_media_enabled: true, responsive_web_enhance_cards_enabled: false };

      function extractMedia(l: any) {
        const mediaList = l?.extended_entities?.media || l?.entities?.media || [];
        return mediaList.map((m: any) => ({
          type: m.type,
          url: m.media_url_https,
          ...(m.video_info ? { variants: m.video_info.variants.filter((v: any) => v.content_type === 'video/mp4').sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0)).map((v: any) => v.url) } : {}),
        }));
      }

      function extractTweet(result: any, seen: Set<string>) {
        const tw = result?.tweet || result;
        const l = tw?.legacy || {};
        if (!tw?.rest_id || seen.has(tw.rest_id)) return null;
        seen.add(tw.rest_id);
        const u = tw.core?.user_results?.result;
        const ul = u?.legacy || {};
        const author = ul.screen_name || u?.core?.screen_name || 'unknown';
        const noteText = tw.note_tweet?.note_tweet_results?.result?.text;
        const media = extractMedia(l);
        return {
          id: tw.rest_id, author, text: noteText || l.full_text || '',
          likes: l.favorite_count || 0, retweets: l.retweet_count || 0,
          replies: l.reply_count || 0, views: tw.views?.count ? parseInt(tw.views.count) : 0,
          url: `https://x.com/${author}/status/${tw.rest_id}`,
          // Extra fields for exposure-prediction scoring (used by /auto-reply
          // agent to decide which tweets are worth engaging with).
          createdAt: l.created_at || null,
          authorFollowers: ul.followers_count || 0,
          authorCreatedAt: ul.created_at || null,
          isBlue: !!(u?.is_blue_verified || u?.legacy?.verified),
          ...(media.length ? { media } : {}),
        };
      }

      const tweets: any[] = [];
      const seen = new Set<string>();
      let cursor: string | null = null;

      for (let page = 0; page < 5 && tweets.length < lim; page++) {
        const vars: Record<string, any> = { count: Math.min(40, lim - tweets.length + 5), includePromotedContent: false, latestControlAvailable: true, requestContext: 'launch' };
        if (isFollowing) vars.seenTweetIds = [];
        if (cursor) vars.cursor = cursor;
        const endpoint = `/i/api/graphql/${queryId}/${operationName}?variables=${encodeURIComponent(JSON.stringify(vars))}&features=${encodeURIComponent(JSON.stringify(FEATURES))}`;
        const res = await fetch(endpoint, { method, headers, credentials: 'include' });
        if (!res.ok) return { error: 'Twitter timeline HTTP ' + res.status + ' — queryId may have expired' };
        const d = await res.json();
        const instructions = d?.data?.home?.home_timeline_urt?.instructions || [];
        let nextCursor: string | null = null;
        for (const inst of instructions) {
          for (const entry of inst.entries || []) {
            const c = entry.content;
            if (c?.cursorType === 'Bottom') { nextCursor = c.value; continue; }
            if (entry.entryId?.startsWith('cursor-bottom-')) { nextCursor = c?.value; continue; }
            const tr = c?.itemContent?.tweet_results?.result;
            if (tr && !c?.itemContent?.promotedMetadata) { const tw = extractTweet(tr, seen); if (tw) tweets.push(tw); }
            for (const item of c?.items || []) {
              const nr = item.item?.itemContent?.tweet_results?.result;
              if (nr && !item.item?.itemContent?.promotedMetadata) { const tw = extractTweet(nr, seen); if (tw) tweets.push(tw); }
            }
          }
        }
        if (!nextCursor || nextCursor === cursor) break;
        cursor = nextCursor;
      }
      return tweets.slice(0, lim);
    } catch (e: any) { return { error: e.message || 'Twitter timeline scraper failed' }; }
  }, [BEARER, QID.HomeTimeline, QID.HomeLatestTimeline, type, limit]);

  if (data && typeof data === 'object' && 'error' in data) throw new Error((data as any).error);
  return (data as any[]) || [];
}

export async function searchTwitter(query: string, filter: 'Top' | 'Latest' | 'People' | 'Media' = 'Top', limit = 20): Promise<any[]> {
  const tabId = await getTab('https://x.com/search');
  await new Promise(r => setTimeout(r, 2000));
  await checkLoginRedirect(tabId, 'Twitter');

  const data = await executeInPage(tabId, async (bearer: string, fallbackQid: string, q: string, f: string, lim: number) => {
    try {
      const ct0 = document.cookie.split(';').map((c: string) => c.trim()).find((c: string) => c.startsWith('ct0='))?.split('=')[1];
      if (!ct0) return { error: 'Not logged into x.com (no ct0 cookie)' };

      async function resolveQueryId(operationName: string, fallback: string): Promise<string> {
        try {
          const res = await fetch('https://raw.githubusercontent.com/fa0311/twitter-openapi/refs/heads/main/src/config/placeholder.json');
          if (res.ok) { const d = await res.json(); const qid = d?.[operationName]?.queryId; if (qid && /^[A-Za-z0-9_-]+$/.test(qid)) return qid; }
        } catch {}
        return fallback;
      }

      const queryId = await resolveQueryId('SearchTimeline', fallbackQid);
      const headers: Record<string, string> = {
        'Authorization': 'Bearer ' + decodeURIComponent(bearer),
        'X-Csrf-Token': ct0, 'X-Twitter-Auth-Type': 'OAuth2Session', 'X-Twitter-Active-User': 'yes',
      };
      const FEATURES = { rweb_video_screen_enabled: false, profile_label_improvements_pcf_label_in_post_enabled: true, rweb_tipjar_consumption_enabled: true, verified_phone_label_enabled: false, creator_subscriptions_tweet_preview_api_enabled: true, responsive_web_graphql_timeline_navigation_enabled: true, responsive_web_graphql_skip_user_profile_image_extensions_enabled: false, premium_content_api_read_enabled: false, communities_web_enable_tweet_community_results_fetch: true, c9s_tweet_anatomy_moderator_badge_enabled: true, responsive_web_grok_share_attachment_enabled: true, articles_preview_enabled: true, responsive_web_edit_tweet_api_enabled: true, graphql_is_translatable_rweb_tweet_is_translatable_enabled: true, view_counts_everywhere_api_enabled: true, longform_notetweets_consumption_enabled: true, responsive_web_twitter_article_tweet_consumption_enabled: true, tweet_awards_web_tipping_enabled: false, freedom_of_speech_not_reach_fetch_enabled: true, standardized_nudges_misinfo: true, tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true, longform_notetweets_rich_text_read_enabled: true, longform_notetweets_inline_media_enabled: true, responsive_web_enhance_cards_enabled: false };

      function extractMedia(l: any) {
        const mediaList = l?.extended_entities?.media || l?.entities?.media || [];
        return mediaList.map((m: any) => ({
          type: m.type,
          url: m.media_url_https,
          ...(m.video_info ? { variants: m.video_info.variants.filter((v: any) => v.content_type === 'video/mp4').sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0)).map((v: any) => v.url) } : {}),
        }));
      }

      function extractTweet(result: any, seen: Set<string>) {
        const tw = result?.tweet || result;
        const l = tw?.legacy || {};
        if (!tw?.rest_id || seen.has(tw.rest_id)) return null;
        seen.add(tw.rest_id);
        const u = tw.core?.user_results?.result;
        const ul = u?.legacy || {};
        const author = ul.screen_name || u?.core?.screen_name || 'unknown';
        const media = extractMedia(l);
        return {
          id: tw.rest_id, author, text: l.full_text || '',
          likes: l.favorite_count || 0, retweets: l.retweet_count || 0,
          replies: l.reply_count || 0,
          views: tw.views?.count ? parseInt(tw.views.count) : 0,
          url: `https://x.com/${author}/status/${tw.rest_id}`,
          createdAt: l.created_at || null,
          authorFollowers: ul.followers_count || 0,
          authorCreatedAt: ul.created_at || null,
          isBlue: !!(u?.is_blue_verified || ul.verified),
          ...(media.length ? { media } : {}),
        };
      }

      const tweets: any[] = [];
      const seen = new Set<string>();
      const vars: Record<string, any> = { rawQuery: q, count: lim, querySource: 'typed_query', product: f };
      const url = `/i/api/graphql/${queryId}/SearchTimeline?variables=${encodeURIComponent(JSON.stringify(vars))}&features=${encodeURIComponent(JSON.stringify(FEATURES))}`;
      const res = await fetch(url, { headers, credentials: 'include' });
      if (!res.ok) return { error: 'Twitter search HTTP ' + res.status };
      const d = await res.json();
      const instructions = d?.data?.search_by_raw_query?.search_timeline?.timeline?.instructions || [];
      for (const inst of instructions) {
        for (const entry of inst.entries || []) {
          const tr = entry.content?.itemContent?.tweet_results?.result;
          if (tr) { const tw = extractTweet(tr, seen); if (tw) tweets.push(tw); }
          for (const item of entry.content?.items || []) {
            const nr = item.item?.itemContent?.tweet_results?.result;
            if (nr) { const tw = extractTweet(nr, seen); if (tw) tweets.push(tw); }
          }
        }
      }
      return tweets.slice(0, lim);
    } catch (e: any) { return { error: e.message || 'Twitter search scraper failed' }; }
  }, [BEARER, QID.SearchTimeline, query, filter, limit]);

  if (data && typeof data === 'object' && 'error' in data) throw new Error((data as any).error);
  return (data as any[]) || [];
}

export async function getTwitterTrending(limit = 20): Promise<any[]> {
  const tabId = await getTab('https://x.com/explore/tabs/trending');
  await new Promise(r => setTimeout(r, 4000));
  await checkLoginRedirect(tabId, 'Twitter');

  const data = await executeInPage(tabId, (lim: number) => {
    try {
      const ct0 = document.cookie.split(';').map((c: string) => c.trim()).find((c: string) => c.startsWith('ct0='))?.split('=')[1];
      if (!ct0) return { error: 'Not logged into x.com (no ct0 cookie)' };
      const items: any[] = [];
      const cells = document.querySelectorAll('[data-testid="trend"]');
      cells.forEach((cell: Element) => {
        const text = cell.textContent || '';
        if (text.includes('Promoted')) return;
        const container = cell.querySelector(':scope > div');
        if (!container) return;
        const divs = Array.from(container.children);
        if (divs.length < 2) return;
        const topic = divs[1].textContent?.trim() || '';
        if (!topic) return;
        const catText = divs[0].textContent?.trim() || '';
        const category = catText.replace(/^\d+\s*/, '').replace(/^·\s*/, '').trim();
        let tweets = 'N/A';
        for (let j = 2; j < divs.length; j++) {
          if ((divs[j] as Element).matches('[data-testid="caret"]') || divs[j].querySelector('[data-testid="caret"]')) continue;
          const t = divs[j].textContent?.trim() || '';
          if (t && /\d/.test(t)) { tweets = t; break; }
        }
        items.push({ rank: items.length + 1, topic, tweets, category });
      });
      if (items.length === 0) return { error: 'No trends found — page may still be loading or structure changed' };
      return items.slice(0, lim);
    } catch (e: any) { return { error: e.message || 'Twitter trending scraper failed' }; }
  }, [limit]);

  if (data && typeof data === 'object' && 'error' in data) throw new Error((data as any).error);
  return (data as any[]) || [];
}

export async function getTwitterProfile(username: string): Promise<any> {
  const uname = username.replace(/^@/, '');
  const tabId = await getTab(`https://x.com/${uname}`);
  await new Promise(r => setTimeout(r, 3000));
  await checkLoginRedirect(tabId, 'Twitter');

  const data = await executeInPage(tabId, async (bearer: string, fallbackQid: string, screenName: string) => {
    try {
      const ct0 = document.cookie.split(';').map((c: string) => c.trim()).find((c: string) => c.startsWith('ct0='))?.split('=')[1];
      if (!ct0) return { error: 'Not logged into x.com (no ct0 cookie)' };

      async function resolveQueryId(operationName: string, fallback: string): Promise<string> {
        try {
          const res = await fetch('https://raw.githubusercontent.com/fa0311/twitter-openapi/refs/heads/main/src/config/placeholder.json');
          if (res.ok) { const d = await res.json(); const qid = d?.[operationName]?.queryId; if (qid && /^[A-Za-z0-9_-]+$/.test(qid)) return qid; }
        } catch {}
        return fallback;
      }

      const queryId = await resolveQueryId('UserByScreenName', fallbackQid);
      const headers: Record<string, string> = {
        'Authorization': 'Bearer ' + decodeURIComponent(bearer),
        'X-Csrf-Token': ct0, 'X-Twitter-Auth-Type': 'OAuth2Session', 'X-Twitter-Active-User': 'yes',
      };
      const variables = JSON.stringify({ screen_name: screenName, withSafetyModeUserFields: true });
      const features = JSON.stringify({ hidden_profile_subscriptions_enabled: true, rweb_tipjar_consumption_enabled: true, responsive_web_graphql_exclude_directive_enabled: true, verified_phone_label_enabled: false, subscriptions_verification_info_is_identity_verified_enabled: true, subscriptions_verification_info_verified_since_enabled: true, highlights_tweets_tab_ui_enabled: true, responsive_web_twitter_article_notes_tab_enabled: true, subscriptions_feature_can_gift_premium: true, creator_subscriptions_tweet_preview_api_enabled: true, responsive_web_graphql_skip_user_profile_image_extensions_enabled: false, responsive_web_graphql_timeline_navigation_enabled: true });
      const url = `/i/api/graphql/${queryId}/UserByScreenName?variables=${encodeURIComponent(variables)}&features=${encodeURIComponent(features)}`;
      const res = await fetch(url, { headers, credentials: 'include' });
      if (!res.ok) return { error: 'Twitter profile HTTP ' + res.status };
      const d = await res.json();
      const result = d.data?.user?.result;
      if (!result) return { error: 'User @' + screenName + ' not found' };
      const l = result.legacy || {};
      return {
        screen_name: l.screen_name || screenName, name: l.name || '',
        bio: l.description || '', location: l.location || '',
        followers: l.followers_count || 0, following: l.friends_count || 0,
        tweets: l.statuses_count || 0, likes: l.favourites_count || 0,
        verified: result.is_blue_verified || l.verified || false,
        created_at: l.created_at || '',
        url: 'https://x.com/' + (l.screen_name || screenName),
      };
    } catch (e: any) { return { error: e.message || 'Twitter profile scraper failed' }; }
  }, [BEARER, QID.UserByScreenName, uname]);

  if (data && typeof data === 'object' && 'error' in data) throw new Error((data as any).error);
  return data;
}

export async function getTwitterBookmarks(limit = 20): Promise<any[]> {
  const tabId = await getTab('https://x.com/i/bookmarks');
  await new Promise(r => setTimeout(r, 3000));
  await checkLoginRedirect(tabId, 'Twitter');

  const data = await executeInPage(tabId, async (bearer: string, fallbackQid: string, lim: number) => {
    try {
      const ct0 = document.cookie.split(';').map((c: string) => c.trim()).find((c: string) => c.startsWith('ct0='))?.split('=')[1];
      if (!ct0) return { error: 'Not logged into x.com (no ct0 cookie)' };

      const FEATURES = { rweb_video_screen_enabled: false, profile_label_improvements_pcf_label_in_post_enabled: true, responsive_web_profile_redirect_enabled: false, rweb_tipjar_consumption_enabled: false, verified_phone_label_enabled: false, creator_subscriptions_tweet_preview_api_enabled: true, responsive_web_graphql_timeline_navigation_enabled: true, responsive_web_graphql_skip_user_profile_image_extensions_enabled: false, premium_content_api_read_enabled: false, communities_web_enable_tweet_community_results_fetch: true, c9s_tweet_anatomy_moderator_badge_enabled: true, articles_preview_enabled: true, responsive_web_edit_tweet_api_enabled: true, graphql_is_translatable_rweb_tweet_is_translatable_enabled: true, view_counts_everywhere_api_enabled: true, longform_notetweets_consumption_enabled: true, responsive_web_twitter_article_tweet_consumption_enabled: true, tweet_awards_web_tipping_enabled: false, freedom_of_speech_not_reach_fetch_enabled: true, standardized_nudges_misinfo: true, tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true, longform_notetweets_rich_text_read_enabled: true, longform_notetweets_inline_media_enabled: false, responsive_web_enhance_cards_enabled: false };

      function extractMedia(l: any) {
        const mediaList = l?.extended_entities?.media || l?.entities?.media || [];
        return mediaList.map((m: any) => ({
          type: m.type, url: m.media_url_https,
          ...(m.video_info ? { variants: m.video_info.variants.filter((v: any) => v.content_type === 'video/mp4').sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0)).map((v: any) => v.url) } : {}),
        }));
      }

      function extractTweet(result: any, seen: Set<string>) {
        const tw = result?.tweet || result;
        const l = tw?.legacy || {};
        if (!tw?.rest_id || seen.has(tw.rest_id)) return null;
        seen.add(tw.rest_id);
        const u = tw.core?.user_results?.result;
        const ul = u?.legacy || {};
        const author = ul.screen_name || 'unknown';
        const media = extractMedia(l);
        return {
          id: tw.rest_id, author, text: l.full_text || '',
          likes: l.favorite_count || 0, retweets: l.retweet_count || 0,
          replies: l.reply_count || 0,
          views: tw.views?.count ? parseInt(tw.views.count) : 0,
          createdAt: l.created_at || null,
          authorFollowers: ul.followers_count || 0,
          authorCreatedAt: ul.created_at || null,
          isBlue: !!(u?.is_blue_verified || ul.verified),
          url: `https://x.com/${author}/status/${tw.rest_id}`,
          ...(media.length ? { media } : {}),
        };
      }

      const tweets: any[] = [];
      const seen = new Set<string>();
      let cursor: string | null = null;
      for (let page = 0; page < 5 && tweets.length < lim; page++) {
        const vars: Record<string, any> = { count: Math.min(40, lim), includePromotedContent: false };
        if (cursor) vars.cursor = cursor;
        const url = `/i/api/graphql/${fallbackQid}/Bookmarks?variables=${encodeURIComponent(JSON.stringify(vars))}&features=${encodeURIComponent(JSON.stringify(FEATURES))}`;
        const res = await fetch(url, { credentials: 'include', headers: { 'Authorization': 'Bearer ' + decodeURIComponent(bearer), 'X-Csrf-Token': ct0, 'X-Twitter-Auth-Type': 'OAuth2Session', 'X-Twitter-Active-User': 'yes' } });
        if (!res.ok) return { error: 'Twitter bookmarks HTTP ' + res.status };
        const d = await res.json();
        const instructions = d?.data?.bookmark_timeline_v2?.timeline?.instructions || [];
        let nextCursor: string | null = null;
        for (const inst of instructions) {
          for (const entry of inst.entries || []) {
            const c = entry.content;
            if (c?.cursorType === 'Bottom') { nextCursor = c.value; continue; }
            const tr = c?.itemContent?.tweet_results?.result;
            if (tr) { const tw = extractTweet(tr, seen); if (tw) tweets.push(tw); }
          }
        }
        if (!nextCursor || nextCursor === cursor) break;
        cursor = nextCursor;
      }
      return tweets.slice(0, lim);
    } catch (e: any) { return { error: e.message || 'Twitter bookmarks scraper failed' }; }
  }, [BEARER, QID.Bookmarks, limit]);

  if (data && typeof data === 'object' && 'error' in data) throw new Error((data as any).error);
  return (data as any[]) || [];
}

export async function getTwitterUserTweets(username: string, limit = 20): Promise<any[]> {
  const uname = username.replace(/^@/, '');
  const tabId = await getTab(`https://x.com/${uname}`);
  await new Promise(r => setTimeout(r, 3000));
  await checkLoginRedirect(tabId, 'Twitter');

  const data = await executeInPage(tabId, async (bearer: string, qidUser: string, qidTweets: string, screenName: string, lim: number) => {
    try {
      const ct0 = document.cookie.split(';').map((c: string) => c.trim()).find((c: string) => c.startsWith('ct0='))?.split('=')[1];
      if (!ct0) return { error: 'Not logged into x.com (no ct0 cookie)' };

      async function resolveQueryId(operationName: string, fallback: string): Promise<string> {
        try {
          const res = await fetch('https://raw.githubusercontent.com/fa0311/twitter-openapi/refs/heads/main/src/config/placeholder.json');
          if (res.ok) { const d = await res.json(); const qid = d?.[operationName]?.queryId; if (qid && /^[A-Za-z0-9_-]+$/.test(qid)) return qid; }
        } catch {}
        return fallback;
      }

      const headers: Record<string, string> = {
        'Authorization': 'Bearer ' + decodeURIComponent(bearer),
        'X-Csrf-Token': ct0, 'X-Twitter-Auth-Type': 'OAuth2Session', 'X-Twitter-Active-User': 'yes',
      };

      // Step 1: get userId via UserByScreenName
      const userQid = await resolveQueryId('UserByScreenName', qidUser);
      const userVars = JSON.stringify({ screen_name: screenName, withSafetyModeUserFields: true });
      const userFeatures = JSON.stringify({ hidden_profile_subscriptions_enabled: true, rweb_tipjar_consumption_enabled: true, responsive_web_graphql_exclude_directive_enabled: true, verified_phone_label_enabled: false, creator_subscriptions_tweet_preview_api_enabled: true, responsive_web_graphql_skip_user_profile_image_extensions_enabled: false, responsive_web_graphql_timeline_navigation_enabled: true });
      const userRes = await fetch(`/i/api/graphql/${userQid}/UserByScreenName?variables=${encodeURIComponent(userVars)}&features=${encodeURIComponent(userFeatures)}`, { headers, credentials: 'include' });
      if (!userRes.ok) return { error: 'Failed to get userId: HTTP ' + userRes.status };
      const userD = await userRes.json();
      const userId = userD?.data?.user?.result?.rest_id;
      if (!userId) return { error: 'User @' + screenName + ' not found' };

      // Step 2: get user tweets via UserTweets
      const tweetsQid = await resolveQueryId('UserTweets', qidTweets);
      const FEATURES = { rweb_video_screen_enabled: false, profile_label_improvements_pcf_label_in_post_enabled: true, rweb_tipjar_consumption_enabled: true, verified_phone_label_enabled: false, creator_subscriptions_tweet_preview_api_enabled: true, responsive_web_graphql_timeline_navigation_enabled: true, responsive_web_graphql_skip_user_profile_image_extensions_enabled: false, premium_content_api_read_enabled: false, communities_web_enable_tweet_community_results_fetch: true, c9s_tweet_anatomy_moderator_badge_enabled: true, articles_preview_enabled: true, responsive_web_edit_tweet_api_enabled: true, graphql_is_translatable_rweb_tweet_is_translatable_enabled: true, view_counts_everywhere_api_enabled: true, longform_notetweets_consumption_enabled: true, responsive_web_twitter_article_tweet_consumption_enabled: true, tweet_awards_web_tipping_enabled: false, freedom_of_speech_not_reach_fetch_enabled: true, standardized_nudges_misinfo: true, tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true, longform_notetweets_rich_text_read_enabled: true, longform_notetweets_inline_media_enabled: true, responsive_web_enhance_cards_enabled: false };
      const tweetsVars = JSON.stringify({ userId, count: lim, includePromotedContent: false, withQuickPromoteEligibilityTweetFields: true, withVoice: true });
      const tweetsRes = await fetch(`/i/api/graphql/${tweetsQid}/UserTweets?variables=${encodeURIComponent(tweetsVars)}&features=${encodeURIComponent(JSON.stringify(FEATURES))}`, { headers, credentials: 'include' });
      if (!tweetsRes.ok) return { error: 'UserTweets HTTP ' + tweetsRes.status };
      const tweetsD = await tweetsRes.json();

      function extractMedia(l: any) {
        const mediaList = l?.extended_entities?.media || l?.entities?.media || [];
        return mediaList.map((m: any) => ({
          type: m.type, url: m.media_url_https,
          ...(m.video_info ? { variants: m.video_info.variants.filter((v: any) => v.content_type === 'video/mp4').sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0)).map((v: any) => v.url) } : {}),
        }));
      }

      const tweets: any[] = [];
      const seen = new Set<string>();
      const userResult = tweetsD?.data?.user?.result;
      const timeline = userResult?.timeline_v2?.timeline || userResult?.timeline?.timeline;
      if (!timeline) return { error: 'UserTweets: unexpected response structure for @' + screenName };
      const instructions = timeline.instructions || [];
      for (const inst of instructions) {
        const entries = inst.entries || (inst.entry ? [inst.entry] : []);
        for (const entry of entries) {
          const c = entry?.content;
          const tr = c?.itemContent?.tweet_results?.result;
          if (tr) {
            const tw = tr.tweet || tr;
            const l = tw?.legacy || {};
            if (!tw?.rest_id || seen.has(tw.rest_id)) continue;
            seen.add(tw.rest_id);
            const noteText = tw.note_tweet?.note_tweet_results?.result?.text;
            const media = extractMedia(l);
            tweets.push({
              id: tw.rest_id, author: screenName, text: noteText || l.full_text || '',
              likes: l.favorite_count || 0, retweets: l.retweet_count || 0,
              replies: l.reply_count || 0, views: tw.views?.count ? parseInt(tw.views.count) : 0,
              created_at: l.created_at || '', url: `https://x.com/${screenName}/status/${tw.rest_id}`,
              ...(media.length ? { media } : {}),
            });
          }
          for (const item of c?.items || []) {
            const nr = item.item?.itemContent?.tweet_results?.result;
            if (!nr) continue;
            const tw = nr.tweet || nr;
            const l = tw?.legacy || {};
            if (!tw?.rest_id || seen.has(tw.rest_id)) continue;
            seen.add(tw.rest_id);
            const noteText = tw.note_tweet?.note_tweet_results?.result?.text;
            const media = extractMedia(l);
            tweets.push({
              id: tw.rest_id, author: screenName, text: noteText || l.full_text || '',
              likes: l.favorite_count || 0, retweets: l.retweet_count || 0,
              replies: l.reply_count || 0, views: tw.views?.count ? parseInt(tw.views.count) : 0,
              created_at: l.created_at || '', url: `https://x.com/${screenName}/status/${tw.rest_id}`,
              ...(media.length ? { media } : {}),
            });
          }
        }
      }
      return tweets.slice(0, lim);
    } catch (e: any) { return { error: e.message || 'Twitter user-tweets scraper failed' }; }
  }, [BEARER, QID.UserByScreenName, QID.UserTweets, uname, limit]);

  if (data && typeof data === 'object' && 'error' in data) throw new Error((data as any).error);
  return (data as any[]) || [];
}

export async function getTwitterThread(tweetId: string, limit = 50): Promise<any[]> {
  const id = tweetId.match(/\/status\/(\d+)/)?.[1] || tweetId;
  const tabId = await getTab('https://x.com');
  await new Promise(r => setTimeout(r, 2000));
  await checkLoginRedirect(tabId, 'Twitter');

  const data = await executeInPage(tabId, async (bearer: string, fallbackQid: string, tid: string, lim: number) => {
    try {
      const ct0 = document.cookie.split(';').map((c: string) => c.trim()).find((c: string) => c.startsWith('ct0='))?.split('=')[1];
      if (!ct0) return { error: 'Not logged into x.com (no ct0 cookie)' };

      async function resolveQueryId(operationName: string, fallback: string): Promise<string> {
        try {
          const res = await fetch('https://raw.githubusercontent.com/fa0311/twitter-openapi/refs/heads/main/src/config/placeholder.json');
          if (res.ok) { const d = await res.json(); const qid = d?.[operationName]?.queryId; if (qid && /^[A-Za-z0-9_-]+$/.test(qid)) return qid; }
        } catch {}
        return fallback;
      }

      const queryId = await resolveQueryId('TweetDetail', fallbackQid);
      const headers: Record<string, string> = {
        'Authorization': 'Bearer ' + decodeURIComponent(bearer),
        'X-Csrf-Token': ct0, 'X-Twitter-Auth-Type': 'OAuth2Session', 'X-Twitter-Active-User': 'yes',
      };
      const FEATURES = { responsive_web_graphql_exclude_directive_enabled: true, verified_phone_label_enabled: false, creator_subscriptions_tweet_preview_api_enabled: true, responsive_web_graphql_timeline_navigation_enabled: true, responsive_web_graphql_skip_user_profile_image_extensions_enabled: false, longform_notetweets_consumption_enabled: true, longform_notetweets_rich_text_read_enabled: true, longform_notetweets_inline_media_enabled: true, freedom_of_speech_not_reach_fetch_enabled: true };
      const FIELD_TOGGLES = { withArticleRichContentState: true, withArticlePlainText: false };

      function extractMedia(l: any) {
        const mediaList = l?.extended_entities?.media || l?.entities?.media || [];
        return mediaList.map((m: any) => ({
          type: m.type, url: m.media_url_https,
          ...(m.video_info ? { variants: m.video_info.variants.filter((v: any) => v.content_type === 'video/mp4').sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0)).map((v: any) => v.url) } : {}),
        }));
      }

      const tweets: any[] = [];
      const seen = new Set<string>();
      let cursor: string | null = null;

      for (let page = 0; page < 5 && tweets.length < lim; page++) {
        const vars: Record<string, any> = { focalTweetId: tid, referrer: 'tweet', with_rux_injections: false, includePromotedContent: false, rankingMode: 'Recency', withCommunity: true, withQuickPromoteEligibilityTweetFields: true, withBirdwatchNotes: true, withVoice: true };
        if (cursor) vars.cursor = cursor;
        const url = `/i/api/graphql/${queryId}/TweetDetail?variables=${encodeURIComponent(JSON.stringify(vars))}&features=${encodeURIComponent(JSON.stringify(FEATURES))}&fieldToggles=${encodeURIComponent(JSON.stringify(FIELD_TOGGLES))}`;
        const res = await fetch(url, { headers, credentials: 'include' });
        if (!res.ok) return { error: 'TweetDetail HTTP ' + res.status };
        const d = await res.json();
        const instructions = d?.data?.threaded_conversation_with_injections_v2?.instructions || [];
        let nextCursor: string | null = null;
        for (const inst of instructions) {
          for (const entry of inst.entries || []) {
            const c = entry.content;
            if (c?.cursorType === 'Bottom' || c?.cursorType === 'ShowMore') { nextCursor = c.value; continue; }
            if (entry.entryId?.startsWith('cursor-bottom-')) { nextCursor = c?.itemContent?.value || c?.value; continue; }
            const tr = c?.itemContent?.tweet_results?.result;
            if (tr) {
              const tw = tr.tweet || tr;
              const l = tw?.legacy || {};
              if (!tw?.rest_id || seen.has(tw.rest_id)) continue;
              seen.add(tw.rest_id);
              const u = tw.core?.user_results?.result;
              const ul = u?.legacy || {};
              const author = ul.screen_name || 'unknown';
              const media = extractMedia(l);
              tweets.push({ id: tw.rest_id, author, text: tw.note_tweet?.note_tweet_results?.result?.text || l.full_text || '', likes: l.favorite_count || 0, retweets: l.retweet_count || 0, replies: l.reply_count || 0, views: tw.views?.count ? parseInt(tw.views.count) : 0, createdAt: l.created_at || null, authorFollowers: ul.followers_count || 0, authorCreatedAt: ul.created_at || null, isBlue: !!(u?.is_blue_verified || ul.verified), in_reply_to: l.in_reply_to_status_id_str || null, url: `https://x.com/${author}/status/${tw.rest_id}`, ...(media.length ? { media } : {}) });
            }
            for (const item of c?.items || []) {
              const nr = item.item?.itemContent?.tweet_results?.result;
              if (nr) {
                const tw = nr.tweet || nr; const l = tw?.legacy || {};
                if (!tw?.rest_id || seen.has(tw.rest_id)) continue;
                seen.add(tw.rest_id);
                const u = tw.core?.user_results?.result;
                const ul = u?.legacy || {};
                const author = ul.screen_name || 'unknown';
                const media = extractMedia(l);
                tweets.push({ id: tw.rest_id, author, text: tw.note_tweet?.note_tweet_results?.result?.text || l.full_text || '', likes: l.favorite_count || 0, retweets: l.retweet_count || 0, replies: l.reply_count || 0, views: tw.views?.count ? parseInt(tw.views.count) : 0, createdAt: l.created_at || null, authorFollowers: ul.followers_count || 0, authorCreatedAt: ul.created_at || null, isBlue: !!(u?.is_blue_verified || ul.verified), in_reply_to: l.in_reply_to_status_id_str || null, url: `https://x.com/${author}/status/${tw.rest_id}`, ...(media.length ? { media } : {}) });
              }
            }
          }
        }
        if (!nextCursor || nextCursor === cursor) break;
        cursor = nextCursor;
      }
      return tweets.slice(0, lim);
    } catch (e: any) { return { error: e.message || 'Twitter thread scraper failed' }; }
  }, [BEARER, QID.TweetDetail, id, limit]);

  if (data && typeof data === 'object' && 'error' in data) throw new Error((data as any).error);
  return (data as any[]) || [];
}

/**
 * Read the user's notifications inbox (mentions, replies, likes, RTs,
 * follows, quotes). Uses the REST /notifications/all.json endpoint
 * — the response has a `globalObjects` map that joins notifications
 * to tweets/users in one shot, much simpler than GraphQL
 * NotificationsTimeline for this use case.
 *
 * Returns a flat, normalized list ordered newest-first. Consumer
 * (agent skill) decides what to do per item.
 */
export async function getTwitterNotifications(limit = 40): Promise<any[]> {
  const tabId = await getTab('https://x.com/notifications');
  await new Promise(r => setTimeout(r, 2500));
  await checkLoginRedirect(tabId, 'Twitter');

  const data = await executeInPage(tabId, async (bearer: string, lim: number) => {
    try {
      const ct0 = document.cookie.split(';').map((c: string) => c.trim()).find((c: string) => c.startsWith('ct0='))?.split('=')[1];
      if (!ct0) return { error: 'Not logged into x.com (no ct0 cookie)' };

      const params = new URLSearchParams({
        include_profile_interstitial_type: '1',
        include_blocking: '1',
        include_blocked_by: '1',
        include_followed_by: '1',
        include_want_retweets: '1',
        include_mute_edge: '1',
        include_can_dm: '1',
        include_can_media_tag: '1',
        include_ext_is_blue_verified: '1',
        skip_status: '1',
        cards_platform: 'Web-12',
        include_cards: '1',
        include_ext_alt_text: 'true',
        include_ext_limited_action_results: 'true',
        include_quote_count: 'true',
        include_reply_count: '1',
        tweet_mode: 'extended',
        include_ext_views: 'true',
        include_entities: 'true',
        include_user_entities: 'true',
        include_ext_media_color: 'true',
        include_ext_media_availability: 'true',
        include_ext_sensitive_media_warning: 'true',
        include_ext_trusted_friends_metadata: 'true',
        send_error_codes: 'true',
        simple_quoted_tweet: 'true',
        count: String(Math.min(200, lim)),
        requestContext: 'launch',
        ext: 'mediaStats,highlightedLabel,hasNftAvatar,voiceInfo,birdwatchPivot,superFollowMetadata,unmentionInfo,editControl,article',
      });

      const res = await fetch(`/i/api/2/notifications/all.json?${params.toString()}`, {
        credentials: 'include',
        headers: {
          'Authorization': 'Bearer ' + decodeURIComponent(bearer),
          'X-Csrf-Token': ct0,
          'X-Twitter-Auth-Type': 'OAuth2Session',
          'X-Twitter-Active-User': 'yes',
        },
      });
      if (!res.ok) return { error: `Twitter notifications HTTP ${res.status}` };
      const d: any = await res.json();

      const go = d?.globalObjects || {};
      const tweets = go.tweets || {};
      const users = go.users || {};
      const notifMap = go.notifications || {};
      const instructions = d?.timeline?.instructions || [];

      const out: any[] = [];
      for (const inst of instructions) {
        const entries = (inst.addEntries?.entries) || (inst.entries) || [];
        for (const entry of entries) {
          const id: string = entry.entryId || '';
          if (id.startsWith('cursor-')) continue;
          const content: any = entry.content || {};

          // Notification entry: like / retweet / follow aggregated actions.
          if (id.startsWith('notification-')) {
            const notifId = id.replace('notification-', '');
            const n = notifMap[notifId] || {};
            const msg = n.message?.text || '';
            const iconId: string = n.icon?.id || '';
            const sig = iconId + ' ' + msg;
            let type: string = 'other';
            // English signals from icon ids + zh message phrasings.
            if (/heart|liked|点赞了/i.test(sig)) type = 'like';
            else if (/retweet|reposted|repost|转推了|转发了/i.test(sig)) type = 'retweet';
            else if (/person|follow|关注了你/i.test(sig)) type = 'follow';
            else if (/reply|replied|回复了/i.test(sig)) type = 'reply';
            // X also sends "new post from accounts you follow" notifications:
            // - bell_solid icon + "新帖子通知" / "最新帖子" / "新推文" (zh)
            // - "new post" / "Posted" (en)
            else if (/bell|new.?post|posted|新帖子|最新帖子|新推文|发布了/i.test(sig)) type = 'new_post';
            const fromUsers: string[] = (n.template?.aggregateUserActionsV1?.fromUsers || [])
              .map((u: any) => u.user?.id || u.id).filter(Boolean)
              .map((uid: string) => users[uid]?.screen_name).filter(Boolean);
            const targetTweetIds: string[] = (n.template?.aggregateUserActionsV1?.targetObjects || [])
              .map((t: any) => t.tweet?.id).filter(Boolean);
            const tw = targetTweetIds[0] ? tweets[targetTweetIds[0]] : null;
            // Single-author new-post notifications: X just shows the
            // author's display name as the message text — no verb. If we
            // didn't classify it above and there's a targetTweet, it's a
            // new-post notification from someone the user follows.
            if (type === 'other' && tw) type = 'new_post';
            out.push({
              type, id: notifId,
              text: msg,
              fromUsers,
              targetTweet: tw ? {
                id: String(tw.id_str || tw.id),
                text: tw.full_text || tw.text || '',
                url: fromUsers[0]
                  ? `https://x.com/${fromUsers[0]}/status/${tw.id_str || tw.id}`
                  : `https://x.com/i/status/${tw.id_str || tw.id}`,
              } : null,
              ts: n.timestampMs ? Number(n.timestampMs) : null,
            });
            continue;
          }

          // Tweet entry: mention / reply to user / quote of user.
          if (id.startsWith('tweet-')) {
            const tweetId = id.replace('tweet-', '');
            const tw = tweets[tweetId];
            if (!tw) continue;
            const u = users[tw.user_id_str] || {};
            const author = u.screen_name || 'unknown';
            const text = tw.full_text || tw.text || '';
            let type: string = 'mention';
            if (tw.in_reply_to_status_id_str) type = 'reply';
            else if (tw.is_quote_status) type = 'quote';
            out.push({
              type, id: tweetId,
              text,
              fromUsers: [author],
              targetTweet: {
                id: tweetId,
                text,
                url: `https://x.com/${author}/status/${tweetId}`,
              },
              inReplyTo: tw.in_reply_to_status_id_str || null,
              likes: tw.favorite_count || 0,
              retweets: tw.retweet_count || 0,
              ts: tw.created_at ? new Date(tw.created_at).getTime() : null,
            });
          }
        }
      }
      return out.slice(0, lim);
    } catch (e: any) { return { error: e.message || 'Twitter notifications scraper failed' }; }
  }, [BEARER, limit]);

  if (data && typeof data === 'object' && 'error' in data) throw new Error((data as any).error);
  return (data as any[]) || [];
}
