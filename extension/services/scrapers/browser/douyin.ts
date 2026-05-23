/**
 * Douyin (抖音) data scrapers — TikTok's Chinese sibling on
 * douyin.com / ByteDance's mainland-China product. Same parent
 * company, same internal /aweme/v1/web/* API surface as TikTok's
 * /api/* but with mainland-China specific signatures.
 *
 *   1. getTab('https://www.douyin.com/') to materialise an
 *      authenticated Douyin tab in the scraper window.
 *   2. checkLoginRedirect(tabId, 'Douyin').
 *   3. executeInPage(tabId, async (...) => { fetch(URL, { credentials:'include' }) ... })
 *      — page-context fetch carries the user's Douyin session cookies.
 *   4. Map response to a clean snake_case envelope mirroring the TikTok
 *      shapes where possible.
 *
 * Key wrinkle vs. TikTok: most `/aweme/v1/web/*` endpoints REQUIRE an
 * `X-Bogus` (legacy) or `a-bogus` (current) signature header. The
 * signature is computed client-side by an obfuscated webmssdk.js
 * bundle that runs in the SPA — we don't reproduce it. Strategy:
 *
 *   1. First try a plain page-context fetch with `credentials:'include'`.
 *      For some read endpoints the logged-in session + same-origin
 *      page context is enough; Douyin's SPA serves these requests
 *      itself and the signature middleware sometimes lets unsigned
 *      reads through when the cookies look fresh.
 *   2. Fallback: if the response is HTTP 200 with an empty body OR
 *      `{"status_code": <non-zero>}`, return a structured error
 *      `{ error: 'douyin-signature-required: ...' }` so the caller
 *      knows to switch to a signed/RPC fallback (e.g. yt-dlp).
 *
 * Common Douyin web params (added to every URL):
 *   - device_platform=webapp
 *   - aid=6383
 *   - channel=channel_pc_web
 *
 * The "no auth" / not-logged-in status codes from Douyin's gateway
 * include 8 ("please log in"), 2154 ("login required"), and a few
 * region-blocked codes — we surface those as
 * `douyin-not-logged-in` for the caller's UI to handle.
 */

import {
  getTab,
  checkLoginRedirect,
  executeInPage,
} from '../../scraperService';

/**
 * Temporarily un-minimize the scraper window for the duration of a
 * call. Douyin's search endpoints return empty `items: []` when the
 * scraper tab is `document.visibilityState === 'hidden'`. Bringing
 * the window to `state: 'normal'` makes the tab visible enough to
 * pass that check. Returns a cleanup function that restores the
 * previous window state (idempotent — safe to call even if no
 * restore was needed).
 */
async function withVisibleScraperWindow(tabId: number): Promise<() => Promise<void>> {
  let scraperWindowId: number | undefined;
  let prev: chrome.windows.windowStateEnum | undefined;
  try {
    const tab = await chrome.tabs.get(tabId);
    scraperWindowId = tab.windowId;
    if (scraperWindowId != null) {
      const win = await chrome.windows.get(scraperWindowId);
      prev = win.state;
      if (win.state === 'minimized') {
        await chrome.windows.update(scraperWindowId, { state: 'normal' });
        await new Promise((r) => setTimeout(r, 800));
      }
    }
  } catch { /* tolerate */ }
  return async () => {
    if (scraperWindowId != null && prev === 'minimized') {
      try { await chrome.windows.update(scraperWindowId, { state: 'minimized' }); } catch { /* ignore */ }
    }
  };
}

// ─── Shared types ──────────────────────────────────────────────────

export interface DouyinVideo {
  id: string;            // aweme_id (numeric string)
  url: string;           // https://www.douyin.com/video/<id>
  desc: string;          // caption, max 200 chars
  author: string;        // sec_uid (Douyin doesn't expose a stable handle on listing endpoints)
  authorName: string;    // nickname
  createTime: number;    // unix seconds
  duration: number;      // seconds
  cover: string;         // cover image url
  hashtags: string[];    // extracted from desc / text_extra
  music: string;         // music.title - music.author
  // engagement
  plays: number;
  likes: number;         // digg_count
  comments: number;
  shares: number;
  collects: number;      // collect_count
}

export interface DouyinUser {
  username: string;       // short_id / unique_id (may be empty for newer accounts)
  name: string;           // nickname
  bio: string;            // signature, max 120 chars
  followers: number;
  following: number;
  likes: number;          // total_favorited
  videos: number;         // aweme_count
  verified: boolean;
  avatar: string;
  region: string;         // country / region code (often 'CN')
}

export interface DouyinUserSummary {
  username: string;       // short_id or sec_uid
  name: string;
  avatar: string;
  verified: boolean;
  followers: number;
  bio: string;
}

export interface DouyinComment {
  id: string;
  text: string;           // max 500 chars
  author: string;
  author_avatar: string;
  likes: number;
  reply_count: number;
  created_at: number;
  is_author_reply: boolean;
}

export interface DouyinListResult<T> {
  items: T[];
  cursor: string;
  has_more: boolean;
}

export interface DouyinVideoListResult {
  items: DouyinVideo[];
  cursor: string;
  has_more: boolean;
}

export interface DouyinUserListResult {
  items: DouyinUserSummary[];
  cursor: string;
  has_more: boolean;
}

export interface DouyinCommentListResult {
  items: DouyinComment[];
  cursor: string;
  has_more: boolean;
}

export interface DouyinLiveStream {
  roomId: string;
  title: string;
  viewerCount: number;
  host: {
    username: string;
    nickname: string;
    avatar: string;
  };
}

export interface DouyinLiveListResult {
  items: DouyinLiveStream[];
  cursor: string;
  has_more: boolean;
}

export interface DouyinGeneralSearchResult {
  items: DouyinVideo[];
  cursor: string;
  has_more: boolean;
}

// ─── 1. getDouyinUserInfo ──────────────────────────────────────────

export async function getDouyinUserInfo(secUid: string): Promise<DouyinUser> {
  if (!secUid || !secUid.trim()) throw new Error('sec_user_id required');
  const sid = secUid.trim();

  const tabId = await getTab('https://www.douyin.com/');
  await checkLoginRedirect(tabId, 'Douyin');

  const result = await executeInPage(tabId, async (sec: string) => {
    try {
      const apiUrl =
        '/aweme/v1/web/user/profile/other/' +
        '?device_platform=webapp&aid=6383&channel=channel_pc_web' +
        '&sec_user_id=' + encodeURIComponent(sec);
      const res = await fetch(apiUrl, { credentials: 'include' });
      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        return { error: 'douyin user-info failed: HTTP ' + res.status + ' — ' + errBody.slice(0, 200) };
      }
      const body = await res.text();
      if (!body) {
        return { error: 'douyin-signature-required: a-bogus token missing — endpoint /aweme/v1/web/user/profile/other/ requires signed request' };
      }
      let data: any;
      try { data = JSON.parse(body); } catch {
        return { error: 'douyin user-info returned non-JSON body — likely anti-bot stub' };
      }
      const sc = typeof data.status_code === 'number' ? data.status_code : 0;
      if (sc !== 0) {
        if (sc === 8 || sc === 2154) {
          return { error: 'douyin-not-logged-in: please sign in to www.douyin.com first' };
        }
        return { error: 'douyin-signature-required: status_code=' + sc + ' — endpoint /aweme/v1/web/user/profile/other/ requires signed request' };
      }
      const u = data.user || {};
      if (!u.sec_uid && !u.uid) {
        return { error: 'douyin-user-not-found: ' + sec };
      }
      const num = (x: any): number => (typeof x === 'number' ? x : (typeof x === 'string' ? (parseInt(x, 10) || 0) : 0));
      const avatar = u.avatar_larger?.url_list?.[0]
        || u.avatar_medium?.url_list?.[0]
        || u.avatar_thumb?.url_list?.[0]
        || '';
      return {
        username: u.unique_id || u.short_id || '',
        name: u.nickname || '',
        bio: typeof u.signature === 'string' ? u.signature.replace(/\n/g, ' ').trim().slice(0, 120) : '',
        followers: num(u.follower_count ?? u.mplatform_followers_count),
        following: num(u.following_count),
        likes: num(u.total_favorited),
        videos: num(u.aweme_count),
        verified: Boolean(u.custom_verify || u.enterprise_verify_reason || u.verify_info),
        avatar,
        region: u.country || u.region || u.ip_location || '',
      };
    } catch (e: any) {
      return { error: e?.message || 'douyin user-info scraper failed' };
    }
  }, [sid]) as DouyinUser | { error: string };

  if (result && typeof result === 'object' && 'error' in result) {
    throw new Error((result as any).error);
  }
  return result as DouyinUser;
}

// ─── Shared video mapper (inlined per-callback for CDP boundary) ───

// NB: The body of this mapper is duplicated inside every
// `executeInPage` callback below because the callback function is
// serialised across the chrome.debugger boundary — we can't pass a
// JS function ref. Kept here as a reference for diffability.
//
//   const HASHTAG_RE = /#([\w一-龥぀-ヿ㐀-䶿]+)/g;
//   const num = (x: any): number => (typeof x === 'number' ? x : (typeof x === 'string' ? (parseInt(x, 10) || 0) : 0));
//   videos = items.map(v => ({ ...DouyinVideo mapping... }))

// ─── 2. getDouyinUserPosts ─────────────────────────────────────────

export async function getDouyinUserPosts(
  secUid: string,
  options: { cursor?: string; limit?: number } = {},
): Promise<DouyinVideoListResult> {
  if (!secUid || !secUid.trim()) throw new Error('sec_user_id required');
  const sid = secUid.trim();
  const cursor = options.cursor || '0';
  const limit = Math.min(Math.max(options.limit || 20, 1), 50);

  const tabId = await getTab('https://www.douyin.com/');
  await checkLoginRedirect(tabId, 'Douyin');

  const result = await executeInPage(tabId, async (sec: string, cur: string, lim: number) => {
    try {
      const apiUrl =
        '/aweme/v1/web/aweme/post/' +
        '?device_platform=webapp&aid=6383&channel=channel_pc_web' +
        '&sec_user_id=' + encodeURIComponent(sec) +
        '&max_cursor=' + encodeURIComponent(cur) +
        '&count=' + lim;
      const res = await fetch(apiUrl, { credentials: 'include' });
      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        return { error: 'douyin user-posts failed: HTTP ' + res.status + ' — ' + errBody.slice(0, 200) };
      }
      const body = await res.text();
      if (!body) {
        return { error: 'douyin-signature-required: a-bogus token missing — endpoint /aweme/v1/web/aweme/post/ requires signed request' };
      }
      let data: any;
      try { data = JSON.parse(body); } catch {
        return { error: 'douyin user-posts returned non-JSON body — likely anti-bot stub' };
      }
      const sc = typeof data.status_code === 'number' ? data.status_code : 0;
      if (sc !== 0) {
        if (sc === 8 || sc === 2154) return { error: 'douyin-not-logged-in: please sign in to www.douyin.com first' };
        return { error: 'douyin-signature-required: status_code=' + sc + ' — endpoint /aweme/v1/web/aweme/post/ requires signed request' };
      }
      const items: any[] = Array.isArray(data.aweme_list) ? data.aweme_list : [];

      const HASHTAG_RE = /#([\w一-龥぀-ヿ㐀-䶿]+)/g;
      const num = (x: any): number => (typeof x === 'number' ? x : (typeof x === 'string' ? (parseInt(x, 10) || 0) : 0));

      const videos = items.map((v: any) => {
        const a = v.author || {};
        const s = v.statistics || {};
        const vid = v.video || {};
        const mus = v.music || {};
        let tags: string[] = [];
        if (Array.isArray(v.text_extra)) {
          tags = v.text_extra
            .map((t: any) => (typeof t?.hashtag_name === 'string' ? t.hashtag_name : ''))
            .filter((s: string) => s.length > 0);
        }
        if (!tags.length && typeof v.desc === 'string') {
          const seen = new Set<string>();
          v.desc.replace(HASHTAG_RE, (_m: string, t: string) => {
            const low = t.toLowerCase();
            if (!seen.has(low)) { seen.add(low); tags.push(t); }
            return _m;
          });
        }
        const dedup: string[] = [];
        const seen2 = new Set<string>();
        for (const t of tags) {
          const k = t.toLowerCase();
          if (!seen2.has(k)) { seen2.add(k); dedup.push(t); }
        }
        const musicLabel = [
          typeof mus.title === 'string' ? mus.title : '',
          typeof mus.author === 'string' ? mus.author : '',
        ].filter(Boolean).join(' - ');
        const cover = vid.cover?.url_list?.[0]
          || vid.dynamic_cover?.url_list?.[0]
          || vid.origin_cover?.url_list?.[0]
          || '';
        return {
          id: v.aweme_id || '',
          url: v.aweme_id ? 'https://www.douyin.com/video/' + v.aweme_id : '',
          desc: typeof v.desc === 'string' ? v.desc.replace(/\s+/g, ' ').trim().slice(0, 200) : '',
          author: a.sec_uid || '',
          authorName: a.nickname || '',
          createTime: num(v.create_time),
          duration: num(vid.duration ? Math.round(vid.duration / 1000) : 0),
          cover,
          hashtags: dedup,
          music: musicLabel,
          plays: num(s.play_count),
          likes: num(s.digg_count),
          comments: num(s.comment_count),
          shares: num(s.share_count),
          collects: num(s.collect_count),
        };
      });

      return {
        items: videos,
        cursor: data.max_cursor != null ? String(data.max_cursor) : '',
        has_more: Boolean(data.has_more),
      };
    } catch (e: any) {
      return { error: e?.message || 'douyin user-posts scraper failed' };
    }
  }, [sid, cursor, limit]) as DouyinVideoListResult | { error: string };

  if (result && typeof result === 'object' && 'error' in result) {
    throw new Error((result as any).error);
  }
  return result as DouyinVideoListResult;
}

// ─── 3. getDouyinUserLikedPosts ────────────────────────────────────

export async function getDouyinUserLikedPosts(
  secUid: string,
  options: { cursor?: string; limit?: number } = {},
): Promise<DouyinVideoListResult> {
  if (!secUid || !secUid.trim()) throw new Error('sec_user_id required');
  const sid = secUid.trim();
  const cursor = options.cursor || '0';
  const limit = Math.min(Math.max(options.limit || 20, 1), 50);

  const tabId = await getTab('https://www.douyin.com/');
  await checkLoginRedirect(tabId, 'Douyin');

  const result = await executeInPage(tabId, async (sec: string, cur: string, lim: number) => {
    try {
      const apiUrl =
        '/aweme/v1/web/aweme/favorite/' +
        '?device_platform=webapp&aid=6383&channel=channel_pc_web' +
        '&sec_user_id=' + encodeURIComponent(sec) +
        '&max_cursor=' + encodeURIComponent(cur) +
        '&count=' + lim;
      const res = await fetch(apiUrl, { credentials: 'include' });
      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        return { error: 'douyin user-liked failed: HTTP ' + res.status + ' — ' + errBody.slice(0, 200) };
      }
      const body = await res.text();
      if (!body) {
        return { error: 'douyin-signature-required: a-bogus token missing — endpoint /aweme/v1/web/aweme/favorite/ requires signed request' };
      }
      let data: any;
      try { data = JSON.parse(body); } catch {
        return { error: 'douyin user-liked returned non-JSON body — likely anti-bot stub' };
      }
      const sc = typeof data.status_code === 'number' ? data.status_code : 0;
      if (sc !== 0) {
        if (sc === 8 || sc === 2154) return { error: 'douyin-not-logged-in: please sign in to www.douyin.com first' };
        // Liked list may be private — surface as note, not error.
        if (sc === 2098 || sc === 2151) {
          return { items: [], cursor: '', has_more: false };
        }
        return { error: 'douyin-signature-required: status_code=' + sc + ' — endpoint /aweme/v1/web/aweme/favorite/ requires signed request' };
      }
      const items: any[] = Array.isArray(data.aweme_list) ? data.aweme_list : [];

      const HASHTAG_RE = /#([\w一-龥぀-ヿ㐀-䶿]+)/g;
      const num = (x: any): number => (typeof x === 'number' ? x : (typeof x === 'string' ? (parseInt(x, 10) || 0) : 0));

      const videos = items.map((v: any) => {
        const a = v.author || {};
        const s = v.statistics || {};
        const vid = v.video || {};
        const mus = v.music || {};
        let tags: string[] = [];
        if (Array.isArray(v.text_extra)) {
          tags = v.text_extra
            .map((t: any) => (typeof t?.hashtag_name === 'string' ? t.hashtag_name : ''))
            .filter((s: string) => s.length > 0);
        }
        if (!tags.length && typeof v.desc === 'string') {
          const seen = new Set<string>();
          v.desc.replace(HASHTAG_RE, (_m: string, t: string) => {
            const low = t.toLowerCase();
            if (!seen.has(low)) { seen.add(low); tags.push(t); }
            return _m;
          });
        }
        const dedup: string[] = [];
        const seen2 = new Set<string>();
        for (const t of tags) {
          const k = t.toLowerCase();
          if (!seen2.has(k)) { seen2.add(k); dedup.push(t); }
        }
        const musicLabel = [
          typeof mus.title === 'string' ? mus.title : '',
          typeof mus.author === 'string' ? mus.author : '',
        ].filter(Boolean).join(' - ');
        const cover = vid.cover?.url_list?.[0]
          || vid.dynamic_cover?.url_list?.[0]
          || vid.origin_cover?.url_list?.[0]
          || '';
        return {
          id: v.aweme_id || '',
          url: v.aweme_id ? 'https://www.douyin.com/video/' + v.aweme_id : '',
          desc: typeof v.desc === 'string' ? v.desc.replace(/\s+/g, ' ').trim().slice(0, 200) : '',
          author: a.sec_uid || '',
          authorName: a.nickname || '',
          createTime: num(v.create_time),
          duration: num(vid.duration ? Math.round(vid.duration / 1000) : 0),
          cover,
          hashtags: dedup,
          music: musicLabel,
          plays: num(s.play_count),
          likes: num(s.digg_count),
          comments: num(s.comment_count),
          shares: num(s.share_count),
          collects: num(s.collect_count),
        };
      });

      return {
        items: videos,
        cursor: data.max_cursor != null ? String(data.max_cursor) : '',
        has_more: Boolean(data.has_more),
      };
    } catch (e: any) {
      return { error: e?.message || 'douyin user-liked scraper failed' };
    }
  }, [sid, cursor, limit]) as DouyinVideoListResult | { error: string };

  if (result && typeof result === 'object' && 'error' in result) {
    throw new Error((result as any).error);
  }
  return result as DouyinVideoListResult;
}

// ─── 4. getDouyinUserFollowers ─────────────────────────────────────

export async function getDouyinUserFollowers(
  secUid: string,
  options: { max_time?: string; limit?: number } = {},
): Promise<DouyinUserListResult> {
  if (!secUid || !secUid.trim()) throw new Error('sec_user_id required');
  const sid = secUid.trim();
  const maxTime = options.max_time || '0';
  const limit = Math.min(Math.max(options.limit || 20, 1), 50);

  const tabId = await getTab('https://www.douyin.com/');
  await checkLoginRedirect(tabId, 'Douyin');

  const result = await executeInPage(tabId, async (sec: string, mt: string, lim: number) => {
    try {
      const apiUrl =
        '/aweme/v1/web/user/follower/list/' +
        '?device_platform=webapp&aid=6383&channel=channel_pc_web' +
        '&sec_user_id=' + encodeURIComponent(sec) +
        '&count=' + lim +
        '&max_time=' + encodeURIComponent(mt);
      const res = await fetch(apiUrl, { credentials: 'include' });
      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        return { error: 'douyin followers failed: HTTP ' + res.status + ' — ' + errBody.slice(0, 200) };
      }
      const body = await res.text();
      if (!body) {
        return { error: 'douyin-signature-required: a-bogus token missing — endpoint /aweme/v1/web/user/follower/list/ requires signed request' };
      }
      let data: any;
      try { data = JSON.parse(body); } catch {
        return { error: 'douyin followers returned non-JSON body — likely anti-bot stub' };
      }
      const sc = typeof data.status_code === 'number' ? data.status_code : 0;
      if (sc !== 0) {
        if (sc === 8 || sc === 2154) return { error: 'douyin-not-logged-in: please sign in to www.douyin.com first' };
        return { error: 'douyin-signature-required: status_code=' + sc + ' — endpoint /aweme/v1/web/user/follower/list/ requires signed request' };
      }
      const list: any[] = Array.isArray(data.followers) ? data.followers
        : Array.isArray(data.user_list) ? data.user_list
        : [];

      const num = (x: any): number => (typeof x === 'number' ? x : (typeof x === 'string' ? (parseInt(x, 10) || 0) : 0));

      const items = list.map((u: any) => {
        const avatar = u.avatar_larger?.url_list?.[0]
          || u.avatar_medium?.url_list?.[0]
          || u.avatar_thumb?.url_list?.[0]
          || '';
        return {
          username: u.unique_id || u.short_id || u.sec_uid || '',
          name: u.nickname || '',
          avatar,
          verified: Boolean(u.custom_verify || u.enterprise_verify_reason),
          followers: num(u.follower_count),
          bio: typeof u.signature === 'string'
            ? u.signature.replace(/\n/g, ' ').trim().slice(0, 120)
            : '',
        };
      });

      return {
        items,
        cursor: data.min_time != null ? String(data.min_time) : '',
        has_more: Boolean(data.has_more),
      };
    } catch (e: any) {
      return { error: e?.message || 'douyin followers scraper failed' };
    }
  }, [sid, maxTime, limit]) as DouyinUserListResult | { error: string };

  if (result && typeof result === 'object' && 'error' in result) {
    throw new Error((result as any).error);
  }
  return result as DouyinUserListResult;
}

// ─── 5. getDouyinUserFollowing ─────────────────────────────────────

export async function getDouyinUserFollowing(
  secUid: string,
  options: { max_time?: string; limit?: number } = {},
): Promise<DouyinUserListResult> {
  if (!secUid || !secUid.trim()) throw new Error('sec_user_id required');
  const sid = secUid.trim();
  const maxTime = options.max_time || '0';
  const limit = Math.min(Math.max(options.limit || 20, 1), 50);

  const tabId = await getTab('https://www.douyin.com/');
  await checkLoginRedirect(tabId, 'Douyin');

  const result = await executeInPage(tabId, async (sec: string, mt: string, lim: number) => {
    try {
      const apiUrl =
        '/aweme/v1/web/user/following/list/' +
        '?device_platform=webapp&aid=6383&channel=channel_pc_web' +
        '&sec_user_id=' + encodeURIComponent(sec) +
        '&count=' + lim +
        '&max_time=' + encodeURIComponent(mt);
      const res = await fetch(apiUrl, { credentials: 'include' });
      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        return { error: 'douyin following failed: HTTP ' + res.status + ' — ' + errBody.slice(0, 200) };
      }
      const body = await res.text();
      if (!body) {
        return { error: 'douyin-signature-required: a-bogus token missing — endpoint /aweme/v1/web/user/following/list/ requires signed request' };
      }
      let data: any;
      try { data = JSON.parse(body); } catch {
        return { error: 'douyin following returned non-JSON body — likely anti-bot stub' };
      }
      const sc = typeof data.status_code === 'number' ? data.status_code : 0;
      if (sc !== 0) {
        if (sc === 8 || sc === 2154) return { error: 'douyin-not-logged-in: please sign in to www.douyin.com first' };
        return { error: 'douyin-signature-required: status_code=' + sc + ' — endpoint /aweme/v1/web/user/following/list/ requires signed request' };
      }
      const list: any[] = Array.isArray(data.followings) ? data.followings
        : Array.isArray(data.user_list) ? data.user_list
        : [];

      const num = (x: any): number => (typeof x === 'number' ? x : (typeof x === 'string' ? (parseInt(x, 10) || 0) : 0));

      const items = list.map((u: any) => {
        const avatar = u.avatar_larger?.url_list?.[0]
          || u.avatar_medium?.url_list?.[0]
          || u.avatar_thumb?.url_list?.[0]
          || '';
        return {
          username: u.unique_id || u.short_id || u.sec_uid || '',
          name: u.nickname || '',
          avatar,
          verified: Boolean(u.custom_verify || u.enterprise_verify_reason),
          followers: num(u.follower_count),
          bio: typeof u.signature === 'string'
            ? u.signature.replace(/\n/g, ' ').trim().slice(0, 120)
            : '',
        };
      });

      return {
        items,
        cursor: data.min_time != null ? String(data.min_time) : '',
        has_more: Boolean(data.has_more),
      };
    } catch (e: any) {
      return { error: e?.message || 'douyin following scraper failed' };
    }
  }, [sid, maxTime, limit]) as DouyinUserListResult | { error: string };

  if (result && typeof result === 'object' && 'error' in result) {
    throw new Error((result as any).error);
  }
  return result as DouyinUserListResult;
}

// ─── 6. getDouyinPostComments ──────────────────────────────────────

export async function getDouyinPostComments(
  videoId: string,
  options: { cursor?: string; limit?: number } = {},
): Promise<DouyinCommentListResult> {
  if (!videoId || !videoId.trim()) throw new Error('video id required');
  const vid = videoId.trim();
  const cursor = options.cursor || '0';
  const limit = Math.min(Math.max(options.limit || 20, 1), 50);

  const tabId = await getTab('https://www.douyin.com/');
  await checkLoginRedirect(tabId, 'Douyin');

  const result = await executeInPage(tabId, async (id: string, cur: string, lim: number) => {
    try {
      const apiUrl =
        '/aweme/v1/web/comment/list/' +
        '?device_platform=webapp&aid=6383&channel=channel_pc_web' +
        '&aweme_id=' + encodeURIComponent(id) +
        '&cursor=' + encodeURIComponent(cur) +
        '&count=' + lim;
      const res = await fetch(apiUrl, { credentials: 'include' });
      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        return { error: 'douyin comments failed: HTTP ' + res.status + ' — ' + errBody.slice(0, 200) };
      }
      const body = await res.text();
      if (!body) {
        return { error: 'douyin-signature-required: a-bogus token missing — endpoint /aweme/v1/web/comment/list/ requires signed request' };
      }
      let data: any;
      try { data = JSON.parse(body); } catch {
        return { error: 'douyin comments returned non-JSON body — likely anti-bot stub' };
      }
      const sc = typeof data.status_code === 'number' ? data.status_code : 0;
      if (sc !== 0) {
        if (sc === 8 || sc === 2154) return { error: 'douyin-not-logged-in: please sign in to www.douyin.com first' };
        return { error: 'douyin-signature-required: status_code=' + sc + ' — endpoint /aweme/v1/web/comment/list/ requires signed request' };
      }
      const list: any[] = Array.isArray(data.comments) ? data.comments : [];
      const num = (x: any): number => (typeof x === 'number' ? x : (typeof x === 'string' ? (parseInt(x, 10) || 0) : 0));

      const items = list.map((c: any) => {
        const u = c.user || {};
        const avatar = u.avatar_thumb?.url_list?.[0]
          || u.avatar_medium?.url_list?.[0]
          || u.avatar_larger?.url_list?.[0]
          || '';
        return {
          id: c.cid || c.comment_id || '',
          text: typeof c.text === 'string' ? c.text.replace(/\s+/g, ' ').trim().slice(0, 500) : '',
          author: u.unique_id || u.short_id || u.nickname || '',
          author_avatar: avatar,
          likes: num(c.digg_count),
          reply_count: num(c.reply_comment_total ?? c.reply_count),
          created_at: num(c.create_time),
          is_author_reply: Boolean(c.is_author_digged || c.label_type === 1),
        };
      });

      return {
        items,
        cursor: data.cursor != null ? String(data.cursor) : '',
        has_more: Boolean(data.has_more),
      };
    } catch (e: any) {
      return { error: e?.message || 'douyin comments scraper failed' };
    }
  }, [vid, cursor, limit]) as DouyinCommentListResult | { error: string };

  if (result && typeof result === 'object' && 'error' in result) {
    throw new Error((result as any).error);
  }
  return result as DouyinCommentListResult;
}

// ─── Internal mapper for Douyin "general search" result cards ──────
//
// Inlined inside each search callback below; kept here as a comment
// for diffability. Douyin's general search response groups
// heterogenous result cards under `data` keyed by `type`. Card 1 is
// a video aweme; card 4 is a user; card 12 is a hashtag; card 23 is
// a music_card. We treat video-cards as the canonical extraction
// target — other types are dropped to keep the response shape stable
// with the spec's `items: DouyinVideo[]` envelope.

// ─── 8. searchDouyinGeneral ────────────────────────────────────────

export async function searchDouyinGeneral(
  keyword: string,
  options: { offset?: string; limit?: number } = {},
): Promise<DouyinGeneralSearchResult> {
  if (!keyword || !keyword.trim()) throw new Error('keyword required');
  const kw = keyword.trim();
  const offset = options.offset || '0';
  const limit = Math.min(Math.max(options.limit || 20, 1), 50);

  // Douyin's `window.fetch` is wrapped with the a-bogus signer ONLY on
  // search-context pages (search-page bundle ships the signer JS). The
  // homepage's fetch returns 200-empty / `status_code=5` because the
  // signing wrapper isn't installed. Navigate to /search/<kw> first so
  // the bundle hydrates the wrapper, then call the API.
  const tabId = await getTab('https://www.douyin.com/search/' + encodeURIComponent(kw));
  await checkLoginRedirect(tabId, 'Douyin');
  const restore = await withVisibleScraperWindow(tabId);
  await new Promise((r) => setTimeout(r, 2000));

  const result = await executeInPage(tabId, async (q: string, off: string, lim: number) => {
    try {
      const apiUrl =
        '/aweme/v1/web/general/search/single/' +
        '?device_platform=webapp&aid=6383&channel=channel_pc_web' +
        '&keyword=' + encodeURIComponent(q) +
        '&offset=' + encodeURIComponent(off) +
        '&count=' + lim +
        '&search_channel=aweme_general';
      const res = await fetch(apiUrl, { credentials: 'include' });
      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        return { error: 'douyin general-search failed: HTTP ' + res.status + ' — ' + errBody.slice(0, 200) };
      }
      const body = await res.text();
      if (!body) {
        return { error: 'douyin-signature-required: a-bogus token missing — endpoint /aweme/v1/web/general/search/single/ requires signed request' };
      }
      let data: any;
      try { data = JSON.parse(body); } catch {
        return { error: 'douyin general-search returned non-JSON body — likely anti-bot stub' };
      }
      const sc = typeof data.status_code === 'number' ? data.status_code : 0;
      if (sc !== 0) {
        if (sc === 8 || sc === 2154) return { error: 'douyin-not-logged-in: please sign in to www.douyin.com first' };
        return { error: 'douyin-signature-required: status_code=' + sc + ' — endpoint /aweme/v1/web/general/search/single/ requires signed request' };
      }
      const cards: any[] = Array.isArray(data.data) ? data.data : [];

      const HASHTAG_RE = /#([\w一-龥぀-ヿ㐀-䶿]+)/g;
      const num = (x: any): number => (typeof x === 'number' ? x : (typeof x === 'string' ? (parseInt(x, 10) || 0) : 0));

      const videos: any[] = [];
      for (const card of cards) {
        const v = card.aweme_info || card.aweme || (card.type === 1 ? card.item : null);
        if (!v || typeof v !== 'object' || !v.aweme_id) continue;
        const a = v.author || {};
        const s = v.statistics || {};
        const vidObj = v.video || {};
        const mus = v.music || {};
        let tags: string[] = [];
        if (Array.isArray(v.text_extra)) {
          tags = v.text_extra
            .map((t: any) => (typeof t?.hashtag_name === 'string' ? t.hashtag_name : ''))
            .filter((s: string) => s.length > 0);
        }
        if (!tags.length && typeof v.desc === 'string') {
          const seen = new Set<string>();
          v.desc.replace(HASHTAG_RE, (_m: string, t: string) => {
            const low = t.toLowerCase();
            if (!seen.has(low)) { seen.add(low); tags.push(t); }
            return _m;
          });
        }
        const dedup: string[] = [];
        const seen2 = new Set<string>();
        for (const t of tags) {
          const k = t.toLowerCase();
          if (!seen2.has(k)) { seen2.add(k); dedup.push(t); }
        }
        const musicLabel = [
          typeof mus.title === 'string' ? mus.title : '',
          typeof mus.author === 'string' ? mus.author : '',
        ].filter(Boolean).join(' - ');
        const cover = vidObj.cover?.url_list?.[0]
          || vidObj.dynamic_cover?.url_list?.[0]
          || vidObj.origin_cover?.url_list?.[0]
          || '';
        videos.push({
          id: v.aweme_id,
          url: 'https://www.douyin.com/video/' + v.aweme_id,
          desc: typeof v.desc === 'string' ? v.desc.replace(/\s+/g, ' ').trim().slice(0, 200) : '',
          author: a.sec_uid || '',
          authorName: a.nickname || '',
          createTime: num(v.create_time),
          duration: num(vidObj.duration ? Math.round(vidObj.duration / 1000) : 0),
          cover,
          hashtags: dedup,
          music: musicLabel,
          plays: num(s.play_count),
          likes: num(s.digg_count),
          comments: num(s.comment_count),
          shares: num(s.share_count),
          collects: num(s.collect_count),
        });
      }

      return {
        items: videos,
        cursor: data.cursor != null ? String(data.cursor) : (data.offset != null ? String(data.offset) : ''),
        has_more: Boolean(data.has_more),
      };
    } catch (e: any) {
      return { error: e?.message || 'douyin general-search scraper failed' };
    }
  }, [kw, offset, limit]) as DouyinGeneralSearchResult | { error: string };

  await restore();
  if (result && typeof result === 'object' && 'error' in result) {
    throw new Error((result as any).error);
  }
  return result as DouyinGeneralSearchResult;
}

// ─── 9. searchDouyinVideo ──────────────────────────────────────────

export async function searchDouyinVideo(
  keyword: string,
  options: { offset?: string; limit?: number } = {},
): Promise<DouyinVideoListResult> {
  if (!keyword || !keyword.trim()) throw new Error('keyword required');
  const kw = keyword.trim();
  const offset = options.offset || '0';
  const limit = Math.min(Math.max(options.limit || 20, 1), 50);

  // See searchDouyinGeneral comment: Douyin only loads its signing
  // wrapper on the /search/* page. Navigate there first.
  const tabId = await getTab('https://www.douyin.com/search/' + encodeURIComponent(kw) + '?type=video');
  await checkLoginRedirect(tabId, 'Douyin');
  const restore = await withVisibleScraperWindow(tabId);
  await new Promise((r) => setTimeout(r, 2000));

  const result = await executeInPage(tabId, async (q: string, off: string, lim: number) => {
    try {
      const apiUrl =
        '/aweme/v1/web/search/item/' +
        '?device_platform=webapp&aid=6383&channel=channel_pc_web' +
        '&keyword=' + encodeURIComponent(q) +
        '&offset=' + encodeURIComponent(off) +
        '&count=' + lim;
      const res = await fetch(apiUrl, { credentials: 'include' });
      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        return { error: 'douyin video-search failed: HTTP ' + res.status + ' — ' + errBody.slice(0, 200) };
      }
      const body = await res.text();
      if (!body) {
        return { error: 'douyin-signature-required: a-bogus token missing — endpoint /aweme/v1/web/search/item/ requires signed request' };
      }
      let data: any;
      try { data = JSON.parse(body); } catch {
        return { error: 'douyin video-search returned non-JSON body — likely anti-bot stub' };
      }
      const sc = typeof data.status_code === 'number' ? data.status_code : 0;
      if (sc !== 0) {
        if (sc === 8 || sc === 2154) return { error: 'douyin-not-logged-in: please sign in to www.douyin.com first' };
        return { error: 'douyin-signature-required: status_code=' + sc + ' — endpoint /aweme/v1/web/search/item/ requires signed request' };
      }
      const cards: any[] = Array.isArray(data.data) ? data.data
        : Array.isArray(data.aweme_list) ? data.aweme_list
        : [];

      const HASHTAG_RE = /#([\w一-龥぀-ヿ㐀-䶿]+)/g;
      const num = (x: any): number => (typeof x === 'number' ? x : (typeof x === 'string' ? (parseInt(x, 10) || 0) : 0));

      const videos: any[] = [];
      for (const card of cards) {
        const v = card.aweme_info || card.aweme || card;
        if (!v || typeof v !== 'object' || !v.aweme_id) continue;
        const a = v.author || {};
        const s = v.statistics || {};
        const vidObj = v.video || {};
        const mus = v.music || {};
        let tags: string[] = [];
        if (Array.isArray(v.text_extra)) {
          tags = v.text_extra
            .map((t: any) => (typeof t?.hashtag_name === 'string' ? t.hashtag_name : ''))
            .filter((s: string) => s.length > 0);
        }
        if (!tags.length && typeof v.desc === 'string') {
          const seen = new Set<string>();
          v.desc.replace(HASHTAG_RE, (_m: string, t: string) => {
            const low = t.toLowerCase();
            if (!seen.has(low)) { seen.add(low); tags.push(t); }
            return _m;
          });
        }
        const dedup: string[] = [];
        const seen2 = new Set<string>();
        for (const t of tags) {
          const k = t.toLowerCase();
          if (!seen2.has(k)) { seen2.add(k); dedup.push(t); }
        }
        const musicLabel = [
          typeof mus.title === 'string' ? mus.title : '',
          typeof mus.author === 'string' ? mus.author : '',
        ].filter(Boolean).join(' - ');
        const cover = vidObj.cover?.url_list?.[0]
          || vidObj.dynamic_cover?.url_list?.[0]
          || vidObj.origin_cover?.url_list?.[0]
          || '';
        videos.push({
          id: v.aweme_id,
          url: 'https://www.douyin.com/video/' + v.aweme_id,
          desc: typeof v.desc === 'string' ? v.desc.replace(/\s+/g, ' ').trim().slice(0, 200) : '',
          author: a.sec_uid || '',
          authorName: a.nickname || '',
          createTime: num(v.create_time),
          duration: num(vidObj.duration ? Math.round(vidObj.duration / 1000) : 0),
          cover,
          hashtags: dedup,
          music: musicLabel,
          plays: num(s.play_count),
          likes: num(s.digg_count),
          comments: num(s.comment_count),
          shares: num(s.share_count),
          collects: num(s.collect_count),
        });
      }

      return {
        items: videos,
        cursor: data.cursor != null ? String(data.cursor) : (data.offset != null ? String(data.offset) : ''),
        has_more: Boolean(data.has_more),
      };
    } catch (e: any) {
      return { error: e?.message || 'douyin video-search scraper failed' };
    }
  }, [kw, offset, limit]) as DouyinVideoListResult | { error: string };

  await restore();
  if (result && typeof result === 'object' && 'error' in result) {
    throw new Error((result as any).error);
  }
  return result as DouyinVideoListResult;
}

// ─── 10. searchDouyinAccount ───────────────────────────────────────

export async function searchDouyinAccount(
  keyword: string,
  options: { cursor?: string; limit?: number } = {},
): Promise<DouyinUserListResult> {
  if (!keyword || !keyword.trim()) throw new Error('keyword required');
  const kw = keyword.trim();
  const cursor = options.cursor || '0';
  const limit = Math.min(Math.max(options.limit || 20, 1), 50);

  // Search page = signed-fetch wrapper context (see searchDouyinGeneral).
  const tabId = await getTab('https://www.douyin.com/search/' + encodeURIComponent(kw) + '?type=user');
  await checkLoginRedirect(tabId, 'Douyin');
  const restore = await withVisibleScraperWindow(tabId);
  await new Promise((r) => setTimeout(r, 2000));

  const result = await executeInPage(tabId, async (q: string, cur: string, lim: number) => {
    try {
      const apiUrl =
        '/aweme/v1/web/discover/search/' +
        '?device_platform=webapp&aid=6383&channel=channel_pc_web' +
        '&keyword=' + encodeURIComponent(q) +
        '&cursor=' + encodeURIComponent(cur) +
        '&count=' + lim +
        '&search_channel=aweme_user_web';
      const res = await fetch(apiUrl, { credentials: 'include' });
      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        return { error: 'douyin account-search failed: HTTP ' + res.status + ' — ' + errBody.slice(0, 200) };
      }
      const body = await res.text();
      if (!body) {
        return { error: 'douyin-signature-required: a-bogus token missing — endpoint /aweme/v1/web/discover/search/ requires signed request' };
      }
      let data: any;
      try { data = JSON.parse(body); } catch {
        return { error: 'douyin account-search returned non-JSON body — likely anti-bot stub' };
      }
      const sc = typeof data.status_code === 'number' ? data.status_code : 0;
      if (sc !== 0) {
        if (sc === 8 || sc === 2154) return { error: 'douyin-not-logged-in: please sign in to www.douyin.com first' };
        return { error: 'douyin-signature-required: status_code=' + sc + ' — endpoint /aweme/v1/web/discover/search/ requires signed request' };
      }
      const list: any[] = Array.isArray(data.user_list) ? data.user_list
        : Array.isArray(data.data) ? data.data
        : [];

      const num = (x: any): number => (typeof x === 'number' ? x : (typeof x === 'string' ? (parseInt(x, 10) || 0) : 0));

      const items = list.map((entry: any) => {
        const u = entry.user_info || entry.user || entry || {};
        const avatar = u.avatar_larger?.url_list?.[0]
          || u.avatar_medium?.url_list?.[0]
          || u.avatar_thumb?.url_list?.[0]
          || '';
        return {
          username: u.unique_id || u.short_id || u.sec_uid || '',
          name: u.nickname || '',
          avatar,
          verified: Boolean(u.custom_verify || u.enterprise_verify_reason),
          followers: num(u.follower_count ?? u.mplatform_followers_count),
          bio: typeof u.signature === 'string'
            ? u.signature.replace(/\n/g, ' ').trim().slice(0, 120)
            : '',
        };
      }).filter((u: any) => u.username || u.name);

      return {
        items,
        cursor: data.cursor != null ? String(data.cursor) : '',
        has_more: Boolean(data.has_more),
      };
    } catch (e: any) {
      return { error: e?.message || 'douyin account-search scraper failed' };
    }
  }, [kw, cursor, limit]) as DouyinUserListResult | { error: string };

  await restore();
  if (result && typeof result === 'object' && 'error' in result) {
    throw new Error((result as any).error);
  }
  return result as DouyinUserListResult;
}

// ─── 11. searchDouyinLive ──────────────────────────────────────────

export async function searchDouyinLive(
  keyword: string,
  options: { offset?: string; limit?: number } = {},
): Promise<DouyinLiveListResult> {
  if (!keyword || !keyword.trim()) throw new Error('keyword required');
  const kw = keyword.trim();
  const offset = options.offset || '0';
  const limit = Math.min(Math.max(options.limit || 20, 1), 50);

  // Search page context for signed fetch (see searchDouyinGeneral).
  const tabId = await getTab('https://www.douyin.com/search/' + encodeURIComponent(kw) + '?type=live');
  await checkLoginRedirect(tabId, 'Douyin');
  const restore = await withVisibleScraperWindow(tabId);
  await new Promise((r) => setTimeout(r, 2000));

  const result = await executeInPage(tabId, async (q: string, off: string, lim: number) => {
    try {
      const apiUrl =
        '/aweme/v1/web/live/search/' +
        '?device_platform=webapp&aid=6383&channel=channel_pc_web' +
        '&keyword=' + encodeURIComponent(q) +
        '&offset=' + encodeURIComponent(off) +
        '&count=' + lim;
      const res = await fetch(apiUrl, { credentials: 'include' });
      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        return { error: 'douyin live-search failed: HTTP ' + res.status + ' — ' + errBody.slice(0, 200) };
      }
      const body = await res.text();
      if (!body) {
        return { error: 'douyin-signature-required: a-bogus token missing — endpoint /aweme/v1/web/live/search/ requires signed request' };
      }
      let data: any;
      try { data = JSON.parse(body); } catch {
        return { error: 'douyin live-search returned non-JSON body — likely anti-bot stub' };
      }
      const sc = typeof data.status_code === 'number' ? data.status_code : 0;
      if (sc !== 0) {
        if (sc === 8 || sc === 2154) return { error: 'douyin-not-logged-in: please sign in to www.douyin.com first' };
        return { error: 'douyin-signature-required: status_code=' + sc + ' — endpoint /aweme/v1/web/live/search/ requires signed request' };
      }
      const list: any[] = Array.isArray(data.data) ? data.data
        : Array.isArray(data.live_list) ? data.live_list
        : [];

      const num = (x: any): number => (typeof x === 'number' ? x : (typeof x === 'string' ? (parseInt(x, 10) || 0) : 0));

      const items = list.map((entry: any) => {
        const room = entry.room_info || entry.room || entry.live_room || entry;
        const owner = room?.owner || room?.host || entry?.user || {};
        const avatar = owner.avatar_thumb?.url_list?.[0]
          || owner.avatar_medium?.url_list?.[0]
          || '';
        return {
          roomId: String(room?.room_id || room?.id || ''),
          title: room?.title || room?.room_title || '',
          viewerCount: num(room?.user_count ?? room?.total_user ?? room?.viewer_count),
          host: {
            username: owner.unique_id || owner.short_id || '',
            nickname: owner.nickname || '',
            avatar,
          },
        };
      }).filter((l: any) => l.roomId);

      return {
        items,
        cursor: data.cursor != null ? String(data.cursor) : (data.offset != null ? String(data.offset) : ''),
        has_more: Boolean(data.has_more),
      };
    } catch (e: any) {
      return { error: e?.message || 'douyin live-search scraper failed' };
    }
  }, [kw, offset, limit]) as DouyinLiveListResult | { error: string };

  await restore();
  if (result && typeof result === 'object' && 'error' in result) {
    throw new Error((result as any).error);
  }
  return result as DouyinLiveListResult;
}

// ─── 12. getDouyinChallengePosts ───────────────────────────────────

export async function getDouyinChallengePosts(
  hashtag: string,
  options: { offset?: string; limit?: number } = {},
): Promise<DouyinVideoListResult> {
  if (!hashtag || !hashtag.trim()) throw new Error('hashtag required');
  const ch = hashtag.trim().replace(/^#/, '');
  const offset = options.offset || '0';
  const limit = Math.min(Math.max(options.limit || 20, 1), 50);

  // Use homepage context for the challenge endpoints — both
  // /challenge/search and /challenge/aweme work from /jingxuan.
  const tabId = await getTab('https://www.douyin.com/');
  await checkLoginRedirect(tabId, 'Douyin');
  await new Promise((r) => setTimeout(r, 1500));

  const result = await executeInPage(tabId, async (chOrId: string, off: string, lim: number) => {
    try {
      // Step 1: resolve cid. If input is a 15-19 digit numeric string,
      // treat as ch_id directly. Otherwise call /challenge/search to
      // map text → cid.
      let cid = chOrId;
      if (!/^\d{15,19}$/.test(chOrId)) {
        const searchUrl =
          '/aweme/v1/web/challenge/search/' +
          '?device_platform=webapp&aid=6383&channel=channel_pc_web' +
          '&keyword=' + encodeURIComponent(chOrId) +
          '&cursor=0&count=3';
        const sres = await fetch(searchUrl, { credentials: 'include' });
        if (!sres.ok) return { error: 'douyin challenge-search failed: HTTP ' + sres.status };
        const sj: any = await sres.json().catch(() => null);
        const first = sj?.challenge_list?.[0];
        cid = first?.cid || first?.challenge_info?.cid || '';
        if (!cid) return { error: 'douyin-challenge-not-found: no challenge matched "' + chOrId + '"' };
      }

      const apiUrl =
        '/aweme/v1/web/challenge/aweme/' +
        '?device_platform=webapp&aid=6383&channel=channel_pc_web' +
        '&ch_id=' + encodeURIComponent(cid) +
        '&offset=' + encodeURIComponent(off) +
        '&count=' + lim +
        '&type=5';
      const res = await fetch(apiUrl, { credentials: 'include' });
      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        return { error: 'douyin challenge-posts failed: HTTP ' + res.status + ' — ' + errBody.slice(0, 200) };
      }
      const body = await res.text();
      if (!body) {
        return { error: 'douyin-signature-required: a-bogus token missing — endpoint /aweme/v1/web/challenge/aweme/ requires signed request' };
      }
      let data: any;
      try { data = JSON.parse(body); } catch {
        return { error: 'douyin challenge-posts returned non-JSON body — likely anti-bot stub' };
      }
      const sc = typeof data.status_code === 'number' ? data.status_code : 0;
      if (sc !== 0) {
        if (sc === 8 || sc === 2154) return { error: 'douyin-not-logged-in: please sign in to www.douyin.com first' };
        return { error: 'douyin-signature-required: status_code=' + sc + ' — endpoint /aweme/v1/web/challenge/aweme/ requires signed request' };
      }
      const items: any[] = Array.isArray(data.aweme_list) ? data.aweme_list : [];

      const HASHTAG_RE = /#([\w一-龥぀-ヿ㐀-䶿]+)/g;
      const num = (x: any): number => (typeof x === 'number' ? x : (typeof x === 'string' ? (parseInt(x, 10) || 0) : 0));

      const videos = items.map((v: any) => {
        const a = v.author || {};
        const s = v.statistics || {};
        const vid = v.video || {};
        const mus = v.music || {};
        let tags: string[] = [];
        if (Array.isArray(v.text_extra)) {
          tags = v.text_extra
            .map((t: any) => (typeof t?.hashtag_name === 'string' ? t.hashtag_name : ''))
            .filter((s: string) => s.length > 0);
        }
        if (!tags.length && typeof v.desc === 'string') {
          const seen = new Set<string>();
          v.desc.replace(HASHTAG_RE, (_m: string, t: string) => {
            const low = t.toLowerCase();
            if (!seen.has(low)) { seen.add(low); tags.push(t); }
            return _m;
          });
        }
        const dedup: string[] = [];
        const seen2 = new Set<string>();
        for (const t of tags) {
          const k = t.toLowerCase();
          if (!seen2.has(k)) { seen2.add(k); dedup.push(t); }
        }
        const musicLabel = [
          typeof mus.title === 'string' ? mus.title : '',
          typeof mus.author === 'string' ? mus.author : '',
        ].filter(Boolean).join(' - ');
        const cover = vid.cover?.url_list?.[0]
          || vid.dynamic_cover?.url_list?.[0]
          || vid.origin_cover?.url_list?.[0]
          || '';
        return {
          id: v.aweme_id || '',
          url: v.aweme_id ? 'https://www.douyin.com/video/' + v.aweme_id : '',
          desc: typeof v.desc === 'string' ? v.desc.replace(/\s+/g, ' ').trim().slice(0, 200) : '',
          author: a.sec_uid || '',
          authorName: a.nickname || '',
          createTime: num(v.create_time),
          duration: num(vid.duration ? Math.round(vid.duration / 1000) : 0),
          cover,
          hashtags: dedup,
          music: musicLabel,
          plays: num(s.play_count),
          likes: num(s.digg_count),
          comments: num(s.comment_count),
          shares: num(s.share_count),
          collects: num(s.collect_count),
        };
      });

      return {
        items: videos,
        cursor: data.cursor != null ? String(data.cursor) : (data.offset != null ? String(data.offset) : ''),
        has_more: Boolean(data.has_more),
      };
    } catch (e: any) {
      return { error: e?.message || 'douyin challenge-posts scraper failed' };
    }
  }, [ch, offset, limit]) as DouyinVideoListResult | { error: string };

  if (result && typeof result === 'object' && 'error' in result) {
    throw new Error((result as any).error);
  }
  return result as DouyinVideoListResult;
}

// ─── 13. getDouyinMusicPosts ───────────────────────────────────────

export async function getDouyinMusicPosts(
  musicId: string,
  options: { cursor?: string; limit?: number } = {},
): Promise<DouyinVideoListResult> {
  if (!musicId || !musicId.trim()) throw new Error('music id required');
  const mid = musicId.trim();
  const cursor = options.cursor || '0';
  const limit = Math.min(Math.max(options.limit || 20, 1), 50);

  const tabId = await getTab('https://www.douyin.com/');
  await checkLoginRedirect(tabId, 'Douyin');

  const result = await executeInPage(tabId, async (id: string, cur: string, lim: number) => {
    try {
      const apiUrl =
        '/aweme/v1/web/music/aweme/' +
        '?device_platform=webapp&aid=6383&channel=channel_pc_web' +
        '&music_id=' + encodeURIComponent(id) +
        '&cursor=' + encodeURIComponent(cur) +
        '&count=' + lim;
      const res = await fetch(apiUrl, { credentials: 'include' });
      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        return { error: 'douyin music-posts failed: HTTP ' + res.status + ' — ' + errBody.slice(0, 200) };
      }
      const body = await res.text();
      if (!body) {
        return { error: 'douyin-signature-required: a-bogus token missing — endpoint /aweme/v1/web/music/aweme/ requires signed request' };
      }
      let data: any;
      try { data = JSON.parse(body); } catch {
        return { error: 'douyin music-posts returned non-JSON body — likely anti-bot stub' };
      }
      const sc = typeof data.status_code === 'number' ? data.status_code : 0;
      if (sc !== 0) {
        if (sc === 8 || sc === 2154) return { error: 'douyin-not-logged-in: please sign in to www.douyin.com first' };
        return { error: 'douyin-signature-required: status_code=' + sc + ' — endpoint /aweme/v1/web/music/aweme/ requires signed request' };
      }
      const items: any[] = Array.isArray(data.aweme_list) ? data.aweme_list : [];

      const HASHTAG_RE = /#([\w一-龥぀-ヿ㐀-䶿]+)/g;
      const num = (x: any): number => (typeof x === 'number' ? x : (typeof x === 'string' ? (parseInt(x, 10) || 0) : 0));

      const videos = items.map((v: any) => {
        const a = v.author || {};
        const s = v.statistics || {};
        const vid = v.video || {};
        const mus = v.music || {};
        let tags: string[] = [];
        if (Array.isArray(v.text_extra)) {
          tags = v.text_extra
            .map((t: any) => (typeof t?.hashtag_name === 'string' ? t.hashtag_name : ''))
            .filter((s: string) => s.length > 0);
        }
        if (!tags.length && typeof v.desc === 'string') {
          const seen = new Set<string>();
          v.desc.replace(HASHTAG_RE, (_m: string, t: string) => {
            const low = t.toLowerCase();
            if (!seen.has(low)) { seen.add(low); tags.push(t); }
            return _m;
          });
        }
        const dedup: string[] = [];
        const seen2 = new Set<string>();
        for (const t of tags) {
          const k = t.toLowerCase();
          if (!seen2.has(k)) { seen2.add(k); dedup.push(t); }
        }
        const musicLabel = [
          typeof mus.title === 'string' ? mus.title : '',
          typeof mus.author === 'string' ? mus.author : '',
        ].filter(Boolean).join(' - ');
        const cover = vid.cover?.url_list?.[0]
          || vid.dynamic_cover?.url_list?.[0]
          || vid.origin_cover?.url_list?.[0]
          || '';
        return {
          id: v.aweme_id || '',
          url: v.aweme_id ? 'https://www.douyin.com/video/' + v.aweme_id : '',
          desc: typeof v.desc === 'string' ? v.desc.replace(/\s+/g, ' ').trim().slice(0, 200) : '',
          author: a.sec_uid || '',
          authorName: a.nickname || '',
          createTime: num(v.create_time),
          duration: num(vid.duration ? Math.round(vid.duration / 1000) : 0),
          cover,
          hashtags: dedup,
          music: musicLabel,
          plays: num(s.play_count),
          likes: num(s.digg_count),
          comments: num(s.comment_count),
          shares: num(s.share_count),
          collects: num(s.collect_count),
        };
      });

      return {
        items: videos,
        cursor: data.cursor != null ? String(data.cursor) : '',
        has_more: Boolean(data.has_more),
      };
    } catch (e: any) {
      return { error: e?.message || 'douyin music-posts scraper failed' };
    }
  }, [mid, cursor, limit]) as DouyinVideoListResult | { error: string };

  if (result && typeof result === 'object' && 'error' in result) {
    throw new Error((result as any).error);
  }
  return result as DouyinVideoListResult;
}
