/**
 * TikTok data scrapers — extends the four legacy TikTok functions that live
 * in scraperService.ts (searchTikTok / fetchTikTokExplore / getTikTokProfile /
 * likeTikTok). Same pattern:
 *
 *   1. getTab('https://www.tiktok.com/explore') to materialise an
 *      authenticated TikTok tab in the scraper window.
 *   2. executeInPage(tabId, async (...) => { const r = await fetch(URL,
 *      { credentials: 'include' }); ... }) — page-context fetch carries
 *      the user's TikTok session cookies, sidestepping the
 *      msToken / X-Bogus / X-Argus signing dance that direct background
 *      fetches would have to forge.
 *   3. Read response JSON, map to a clean snake_case envelope.
 *
 * Notes worth keeping handy:
 *
 *   - TikTok's www.tiktok.com/api/* endpoints REQUIRE aid=1988 (web-app
 *     vertical) — otherwise they 10000-bail. Other params (X-Bogus,
 *     msToken) come from the page-side runtime when the fetch runs in
 *     the SPA's own origin, so we don't synthesise them ourselves.
 *   - Followers / followings lists are subject to the account's own
 *     "private list" toggle. A 200 OK with userList:[] and total:0 is
 *     not an error — surface it as a note instead.
 *   - The profile HTML's __UNIVERSAL_DATA_FOR_REHYDRATION__ <script>
 *     payload remains the only reliable secUid source; the
 *     /api/user/detail/ endpoint started 401-ing without an msToken in
 *     mid-2025.
 */

import {
  getTab,
  checkLoginRedirect,
  executeInPage,
} from '../../scraperService';

// ─── Shared types ──────────────────────────────────────────────────

export interface TikTokVideo {
  id: string;            // video id (numeric string)
  url: string;           // https://www.tiktok.com/@username/video/<id>
  desc: string;          // caption, max 200 chars
  author: string;        // uniqueId
  authorName: string;    // nickname
  createTime: number;    // unix seconds
  duration: number;      // seconds
  cover: string;         // cover image url
  hashtags: string[];    // extracted from desc (#tag) deduped
  music: string;         // music.title - music.authorName
  // engagement
  plays: number;
  likes: number;
  comments: number;
  shares: number;
  collects: number;
}

export interface TikTokUserPostsResult {
  videos: TikTokVideo[];
  cursor: string;        // next cursor (empty if done)
  has_more: boolean;
}

export interface TikTokUserSummary {
  username: string;      // uniqueId
  name: string;          // nickname
  avatar: string;
  verified: boolean;
  followers: number;
  bio: string;           // signature, max 120 chars
}

export interface TikTokUserListResult {
  users: TikTokUserSummary[];
  cursor: string;
  has_more: boolean;
  note?: string;
}

export interface TikTokPostDetail extends TikTokVideo {
  isAd: boolean;
  width: number;
  height: number;
  ratio: string;         // 'portrait' | 'landscape' | 'square'
  language: string;      // detected lang code
  music_id: string;
  music_url: string;      // mp3 play url (may expire)
  video_url: string;      // raw mp4 from playAddr (may be watermarked)
}

export interface TikTokComment {
  id: string;
  text: string;           // max 500 chars, newlines stripped
  author: string;
  author_avatar: string;
  likes: number;
  reply_count: number;
  created_at: number;     // unix seconds
  is_author_reply: boolean;
}

export interface TikTokCommentsResult {
  comments: TikTokComment[];
  cursor: string;
  has_more: boolean;
}

export interface TikTokAccountSearchResult {
  users: TikTokUserSummary[];
}

// ─── Utilities ─────────────────────────────────────────────────────

/**
 * Accepts:
 *   - bare numeric id: `7234567890123456789`
 *   - full URL: `https://www.tiktok.com/@user/video/7234...`
 *   - shortlink: `https://vm.tiktok.com/...` or `https://vt.tiktok.com/...`
 *
 * Shortlinks are resolved by GET-ing them (page context) and reading the
 * Location/finalized URL. Throws on malformed input.
 */
export async function parseTikTokVideoId(input: string): Promise<string> {
  if (!input) throw new Error('Video id or URL required');
  const trimmed = input.trim();
  // Bare numeric id
  if (/^\d{6,25}$/.test(trimmed)) return trimmed;
  // Direct URL with /video/<id>
  const direct = /tiktok\.com\/@[^/]+\/video\/(\d+)/.exec(trimmed);
  if (direct) return direct[1];
  // Photo carousel (still has a numeric id)
  const photo = /tiktok\.com\/@[^/]+\/photo\/(\d+)/.exec(trimmed);
  if (photo) return photo[1];
  // Shortlink — resolve via page-context fetch
  if (/^https?:\/\/(vm|vt)\.tiktok\.com\//.test(trimmed)) {
    const tabId = await getTab('https://www.tiktok.com/explore');
    const resolved = await executeInPage(tabId, async (link: string) => {
      try {
        const r = await fetch(link, { credentials: 'include', redirect: 'follow' });
        return { url: r.url || '' };
      } catch (e: any) {
        return { error: e?.message || 'shortlink resolve failed' };
      }
    }, [trimmed]) as { url?: string; error?: string };
    if (resolved?.error) throw new Error('Failed to resolve TikTok shortlink: ' + resolved.error);
    const finalUrl = resolved?.url || '';
    const m = /tiktok\.com\/@[^/]+\/(?:video|photo)\/(\d+)/.exec(finalUrl);
    if (m) return m[1];
    throw new Error('Could not parse TikTok video id from shortlink: ' + trimmed);
  }
  throw new Error('Could not parse TikTok video id from: ' + input);
}

/**
 * Detect whether the caller supplied a secUid (canonical id used by most
 * /api/* endpoints) or a uniqueId/handle. secUids are URL-safe base64 blobs
 * issued by TikTok's identity service and consistently start with `MS4wL`.
 */
function looksLikeSecUid(s: string): boolean {
  return /^MS4wL[A-Za-z0-9_-]+$/.test(s);
}

/**
 * Resolve a caller-provided identifier (handle OR secUid) into both forms.
 *
 * - If `input` looks like a secUid: returns it as-is, uniqueId stays empty
 *   (we don't pay the profile-page round-trip — callers that need both can
 *   pass the handle instead).
 * - Otherwise: treats input as a uniqueId, fetches the profile HTML, parses
 *   __UNIVERSAL_DATA_FOR_REHYDRATION__, and returns the structured user.
 *
 * Runs in the page context so the profile fetch carries the user's TikTok
 * session cookies (required after the unauth profile lockout in late 2025).
 */
async function resolveSecUid(input: string): Promise<{ secUid: string; uniqueId: string }> {
  const raw = (input || '').trim().replace(/^@/, '');
  if (!raw) throw new Error('Username or secUid required');
  if (looksLikeSecUid(raw)) {
    return { secUid: raw, uniqueId: '' };
  }
  const tabId = await getTab('https://www.tiktok.com/explore');
  await checkLoginRedirect(tabId, 'TikTok');
  const res = await executeInPage(tabId, async (uname: string) => {
    try {
      const r = await fetch('https://www.tiktok.com/@' + encodeURIComponent(uname), {
        credentials: 'include',
      });
      if (!r.ok) return { error: 'TikTok profile fetch failed: HTTP ' + r.status };
      const html = await r.text();
      const tag = '__UNIVERSAL_DATA_FOR_REHYDRATION__';
      const idx = html.indexOf(tag);
      if (idx === -1) return { error: 'Could not parse TikTok profile data — login may be required' };
      const start = html.indexOf('>', idx) + 1;
      const end = html.indexOf('</script>', start);
      let scope: any;
      try {
        const json = JSON.parse(html.substring(start, end));
        scope = json['__DEFAULT_SCOPE__'] || {};
      } catch {
        return { error: 'Could not JSON-parse profile rehydration data' };
      }
      const user = scope['webapp.user-detail']?.userInfo?.user;
      if (!user) return { error: 'User not found: ' + uname };
      const secUid = user.secUid || '';
      if (!secUid) return { error: 'Could not extract secUid for ' + uname };
      return { secUid, uniqueId: user.uniqueId || uname };
    } catch (e: any) {
      return { error: e?.message || 'TikTok secUid resolver failed' };
    }
  }, [raw]) as { secUid: string; uniqueId: string } | { error: string };

  if (res && typeof res === 'object' && 'error' in res) {
    throw new Error((res as any).error);
  }
  return res as { secUid: string; uniqueId: string };
}

// ─── 1. getTikTokUserPosts ─────────────────────────────────────────

export async function getTikTokUserPosts(
  usernameOrSecUid: string,
  options: { cursor?: string; limit?: number } = {},
): Promise<TikTokUserPostsResult> {
  const { secUid } = await resolveSecUid(usernameOrSecUid);
  const cursor = options.cursor || '0';
  const limit = Math.min(Math.max(options.limit || 30, 1), 50);

  const tabId = await getTab('https://www.tiktok.com/explore');
  await checkLoginRedirect(tabId, 'TikTok');

  const result = await executeInPage(tabId, async (secUid: string, cur: string, lim: number) => {
    try {
      const apiUrl =
        '/api/post/item_list/?aid=1988&secUid=' +
        encodeURIComponent(secUid) +
        '&count=' + lim +
        '&cursor=' + encodeURIComponent(cur);
      const res = await fetch(apiUrl, { credentials: 'include' });
      if (!res.ok) {
        return { error: 'TikTok user posts fetch failed: HTTP ' + res.status };
      }
      const data = await res.json();
      const items: any[] = Array.isArray(data.itemList) ? data.itemList : [];
      const nextCursor = data.cursor != null ? String(data.cursor) : '';
      const hasMore = Boolean(data.hasMore);

      const HASHTAG_RE = /#([\w一-龥぀-ヿ㐀-䶿]+)/g;
      const videos = items.map((v: any) => {
        const a = v.author || {};
        const s = v.stats || v.statsV2 || {};
        const vid = v.video || {};
        const mus = v.music || {};
        // Hashtags: prefer textExtra; fall back to regex over desc.
        let tags: string[] = [];
        if (Array.isArray(v.textExtra)) {
          tags = v.textExtra
            .map((t: any) => (typeof t?.hashtagName === 'string' ? t.hashtagName : ''))
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
        // Dedupe (case-insensitive)
        const dedup: string[] = [];
        const seen2 = new Set<string>();
        for (const t of tags) {
          const k = t.toLowerCase();
          if (!seen2.has(k)) { seen2.add(k); dedup.push(t); }
        }

        const musicLabel = [
          typeof mus.title === 'string' ? mus.title : '',
          typeof mus.authorName === 'string' ? mus.authorName : '',
        ].filter(Boolean).join(' - ');

        // statsV2 returns string counts; statsV1 returns numbers.
        const num = (x: any): number => {
          if (typeof x === 'number') return x;
          if (typeof x === 'string' && x) { const n = parseInt(x, 10); return Number.isFinite(n) ? n : 0; }
          return 0;
        };

        return {
          id: v.id || '',
          url: (a.uniqueId && v.id) ? 'https://www.tiktok.com/@' + a.uniqueId + '/video/' + v.id : '',
          desc: typeof v.desc === 'string' ? v.desc.replace(/\s+/g, ' ').trim().slice(0, 200) : '',
          author: a.uniqueId || '',
          authorName: a.nickname || '',
          createTime: typeof v.createTime === 'number' ? v.createTime : num(v.createTime),
          duration: typeof vid.duration === 'number' ? vid.duration : 0,
          cover: vid.cover || vid.dynamicCover || vid.originCover || '',
          hashtags: dedup,
          music: musicLabel,
          plays: num(s.playCount),
          likes: num(s.diggCount),
          comments: num(s.commentCount),
          shares: num(s.shareCount),
          collects: num(s.collectCount),
        };
      });

      return {
        videos,
        cursor: nextCursor,
        has_more: hasMore,
      };
    } catch (e: any) {
      return { error: e?.message || 'TikTok user-posts scraper failed' };
    }
  }, [secUid, cursor, limit]) as TikTokUserPostsResult | { error: string };

  if (result && typeof result === 'object' && 'error' in result) {
    throw new Error((result as any).error);
  }
  return result as TikTokUserPostsResult;
}

// ─── 2. getTikTokUserFollowers ─────────────────────────────────────

export async function getTikTokUserFollowers(
  usernameOrSecUid: string,
  options: { cursor?: string; limit?: number } = {},
): Promise<TikTokUserListResult> {
  const { secUid } = await resolveSecUid(usernameOrSecUid);
  // Followers endpoint paginates on `max_time` (unix seconds) — callers
  // pass the cursor value returned from the previous page; '0' starts fresh.
  const cursor = options.cursor || '0';
  const limit = Math.min(Math.max(options.limit || 30, 1), 50);

  const tabId = await getTab('https://www.tiktok.com/explore');
  await checkLoginRedirect(tabId, 'TikTok');

  const result = await executeInPage(tabId, async (secUid: string, cur: string, lim: number) => {
    try {
      // scene=21 = followers; minCursor required by TikTok even when starting fresh.
      const apiUrl =
        '/api/user/list/?aid=1988&scene=21' +
        '&count=' + lim +
        '&maxCursor=' + encodeURIComponent(cur) +
        '&minCursor=0' +
        '&secUid=' + encodeURIComponent(secUid);
      const res = await fetch(apiUrl, { credentials: 'include' });
      if (!res.ok) return { error: 'TikTok user-followers fetch failed: HTTP ' + res.status };
      const data = await res.json();
      const userList: any[] = Array.isArray(data.userList) ? data.userList : [];

      const num = (x: any): number => (typeof x === 'number' ? x : (typeof x === 'string' ? (parseInt(x, 10) || 0) : 0));

      const users = userList.map((entry: any) => {
        const u = entry?.user || {};
        const s = entry?.stats || {};
        return {
          username: u.uniqueId || '',
          name: u.nickname || '',
          avatar: u.avatarMedium || u.avatarThumb || u.avatarLarger || '',
          verified: Boolean(u.verified),
          followers: num(s.followerCount),
          bio: typeof u.signature === 'string'
            ? u.signature.replace(/\n/g, ' ').trim().slice(0, 120)
            : '',
        };
      });

      const nextCursor = data.maxCursor != null
        ? String(data.maxCursor)
        : (data.cursor != null ? String(data.cursor) : '');
      const hasMore = Boolean(data.hasMore);
      const total = typeof data.total === 'number' ? data.total : null;

      const out: any = {
        users,
        cursor: nextCursor,
        has_more: hasMore,
      };
      if (users.length === 0 && (total === 0 || total == null)) {
        out.note = 'followers list hidden by account privacy';
      }
      return out;
    } catch (e: any) {
      return { error: e?.message || 'TikTok user-followers scraper failed' };
    }
  }, [secUid, cursor, limit]) as TikTokUserListResult | { error: string };

  if (result && typeof result === 'object' && 'error' in result) {
    throw new Error((result as any).error);
  }
  return result as TikTokUserListResult;
}

// ─── 3. getTikTokPostDetail ────────────────────────────────────────

export async function getTikTokPostDetail(videoIdOrUrl: string): Promise<TikTokPostDetail> {
  const videoId = await parseTikTokVideoId(videoIdOrUrl);
  const tabId = await getTab('https://www.tiktok.com/explore');
  await checkLoginRedirect(tabId, 'TikTok');

  const result = await executeInPage(tabId, async (vid: string) => {
    try {
      // We don't know the canonical @username yet — fetch the
      // /video/<id> permalink which TikTok 302-redirects to the
      // canonical URL. The HTML carries the full item struct in the
      // rehydration script.
      const probeUrl = 'https://www.tiktok.com/embed/v2/' + encodeURIComponent(vid);
      // Embed pages don't carry the full item; use the canonical
      // /@*/video/<id> page instead. Since we don't know the user, we
      // can hit the bare /video/<id> redirect handler.
      let res = await fetch('https://www.tiktok.com/video/' + encodeURIComponent(vid), {
        credentials: 'include',
        redirect: 'follow',
      });
      if (!res.ok) {
        // Some regions return 404 on the bare /video/ alias — fall back
        // to the embed page which exposes a leaner item struct.
        res = await fetch(probeUrl, { credentials: 'include', redirect: 'follow' });
      }
      if (!res.ok) return { error: 'TikTok post fetch failed: HTTP ' + res.status };
      const html = await res.text();
      const tag = '__UNIVERSAL_DATA_FOR_REHYDRATION__';
      const idx = html.indexOf(tag);
      if (idx === -1) return { error: 'Could not parse TikTok post data' };
      const start = html.indexOf('>', idx) + 1;
      const end = html.indexOf('</script>', start);
      let scope: any;
      try {
        const json = JSON.parse(html.substring(start, end));
        scope = json['__DEFAULT_SCOPE__'] || {};
      } catch {
        return { error: 'Could not JSON-parse post rehydration data' };
      }
      const v = scope['webapp.video-detail']?.itemInfo?.itemStruct;
      if (!v) return { error: 'Video not found or removed: ' + vid };

      const a = v.author || {};
      const s = v.stats || v.statsV2 || {};
      const vid_ = v.video || {};
      const mus = v.music || {};

      const HASHTAG_RE = /#([\w一-龥぀-ヿ㐀-䶿]+)/g;
      let tags: string[] = [];
      if (Array.isArray(v.textExtra)) {
        tags = v.textExtra
          .map((t: any) => (typeof t?.hashtagName === 'string' ? t.hashtagName : ''))
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
        typeof mus.authorName === 'string' ? mus.authorName : '',
      ].filter(Boolean).join(' - ');

      const num = (x: any): number => (typeof x === 'number' ? x : (typeof x === 'string' ? (parseInt(x, 10) || 0) : 0));

      // ratio: prefer explicit field; otherwise derive from width/height.
      const w = typeof vid_.width === 'number' ? vid_.width : 0;
      const h = typeof vid_.height === 'number' ? vid_.height : 0;
      let ratio = typeof vid_.ratio === 'string' ? vid_.ratio : '';
      if (!ratio && w && h) {
        if (h > w) ratio = 'portrait';
        else if (w > h) ratio = 'landscape';
        else ratio = 'square';
      }

      return {
        id: v.id || vid,
        url: (a.uniqueId && v.id) ? 'https://www.tiktok.com/@' + a.uniqueId + '/video/' + v.id : '',
        desc: typeof v.desc === 'string' ? v.desc.replace(/\s+/g, ' ').trim().slice(0, 200) : '',
        author: a.uniqueId || '',
        authorName: a.nickname || '',
        createTime: typeof v.createTime === 'number' ? v.createTime : num(v.createTime),
        duration: typeof vid_.duration === 'number' ? vid_.duration : 0,
        cover: vid_.cover || vid_.dynamicCover || vid_.originCover || '',
        hashtags: dedup,
        music: musicLabel,
        plays: num(s.playCount),
        likes: num(s.diggCount),
        comments: num(s.commentCount),
        shares: num(s.shareCount),
        collects: num(s.collectCount),
        // Extended
        isAd: Boolean(v.isAd),
        width: w,
        height: h,
        ratio,
        language: typeof v.textLanguage === 'string' ? v.textLanguage : (v.originalLanguageInfo?.lang || ''),
        music_id: mus.id || '',
        music_url: mus.playUrl || '',
        video_url: vid_.playAddr || vid_.downloadAddr || '',
      };
    } catch (e: any) {
      return { error: e?.message || 'TikTok post-detail scraper failed' };
    }
  }, [videoId]) as TikTokPostDetail | { error: string };

  if (result && typeof result === 'object' && 'error' in result) {
    throw new Error((result as any).error);
  }
  return result as TikTokPostDetail;
}

// ─── 4. getTikTokPostComments ──────────────────────────────────────

export async function getTikTokPostComments(
  videoIdOrUrl: string,
  options: { cursor?: string; limit?: number } = {},
): Promise<TikTokCommentsResult> {
  const videoId = await parseTikTokVideoId(videoIdOrUrl);
  const cursor = options.cursor || '0';
  const limit = Math.min(Math.max(options.limit || 30, 1), 50);

  const tabId = await getTab('https://www.tiktok.com/explore');
  await checkLoginRedirect(tabId, 'TikTok');

  const result = await executeInPage(tabId, async (vid: string, cur: string, lim: number) => {
    try {
      // Pull the post first so we can mark `is_author_reply` accurately.
      let authorUid = '';
      try {
        const postRes = await fetch('https://www.tiktok.com/video/' + encodeURIComponent(vid), {
          credentials: 'include', redirect: 'follow',
        });
        if (postRes.ok) {
          const html = await postRes.text();
          const tagIdx = html.indexOf('__UNIVERSAL_DATA_FOR_REHYDRATION__');
          if (tagIdx !== -1) {
            const s2 = html.indexOf('>', tagIdx) + 1;
            const e2 = html.indexOf('</script>', s2);
            try {
              const j = JSON.parse(html.substring(s2, e2));
              authorUid = j['__DEFAULT_SCOPE__']?.['webapp.video-detail']?.itemInfo?.itemStruct?.author?.uid || '';
            } catch { /* ignore */ }
          }
        }
      } catch { /* ignore — is_author_reply just stays false */ }

      const apiUrl =
        '/api/comment/list/?aid=1988' +
        '&aweme_id=' + encodeURIComponent(vid) +
        '&count=' + lim +
        '&cursor=' + encodeURIComponent(cur);
      const res = await fetch(apiUrl, { credentials: 'include' });
      if (!res.ok) return { error: 'TikTok comments fetch failed: HTTP ' + res.status };
      const data = await res.json();
      const comments: any[] = Array.isArray(data.comments) ? data.comments : [];
      const nextCursor = data.cursor != null ? String(data.cursor) : '';
      const hasMore = Boolean(data.has_more);

      const num = (x: any): number => (typeof x === 'number' ? x : (typeof x === 'string' ? (parseInt(x, 10) || 0) : 0));

      const out = comments.map((c: any) => {
        const u = c.user || {};
        const avatar = u.avatar_thumb?.url_list?.[0]
          || u.avatar_medium?.url_list?.[0]
          || u.avatar_larger?.url_list?.[0]
          || '';
        return {
          id: c.cid || '',
          text: typeof c.text === 'string' ? c.text.replace(/\s+/g, ' ').trim().slice(0, 500) : '',
          author: u.unique_id || u.nickname || '',
          author_avatar: avatar,
          likes: num(c.digg_count),
          reply_count: num(c.reply_comment_total ?? c.reply_count),
          created_at: num(c.create_time),
          is_author_reply: Boolean(authorUid && u.uid && String(u.uid) === String(authorUid)),
        };
      });

      return {
        comments: out,
        cursor: nextCursor,
        has_more: hasMore,
      };
    } catch (e: any) {
      return { error: e?.message || 'TikTok post-comments scraper failed' };
    }
  }, [videoId, cursor, limit]) as TikTokCommentsResult | { error: string };

  if (result && typeof result === 'object' && 'error' in result) {
    throw new Error((result as any).error);
  }
  return result as TikTokCommentsResult;
}

// ─── 5. searchTikTokAccount ────────────────────────────────────────

export async function searchTikTokAccount(query: string, limit = 20): Promise<TikTokAccountSearchResult> {
  if (!query || !query.trim()) throw new Error('Query required');
  const lim = Math.min(Math.max(limit, 1), 50);

  const tabId = await getTab('https://www.tiktok.com/explore');
  await checkLoginRedirect(tabId, 'TikTok');

  const result = await executeInPage(tabId, async (q: string, lim: number) => {
    try {
      const apiUrl =
        '/api/search/user/full/?aid=1988' +
        '&keyword=' + encodeURIComponent(q) +
        '&count=' + lim;
      const res = await fetch(apiUrl, { credentials: 'include' });
      if (!res.ok) return { error: 'TikTok account search failed: HTTP ' + res.status };
      const data = await res.json();
      const list: any[] = Array.isArray(data.user_list) ? data.user_list : (Array.isArray(data.userList) ? data.userList : []);

      const num = (x: any): number => (typeof x === 'number' ? x : (typeof x === 'string' ? (parseInt(x, 10) || 0) : 0));

      // The /api/search/user/full/ response wraps each entry as
      // { user_info: {...}, custom_verify, ... }. Some accounts come
      // back under the newer { user: {...}, stats: {...} } shape — handle both.
      const users = list.slice(0, lim).map((entry: any) => {
        const u = entry?.user_info || entry?.user || entry || {};
        const followers = num(entry?.stats?.followerCount ?? u.follower_count ?? u.followerCount);
        const verified = Boolean(u.verified || u.custom_verify || entry?.custom_verify);
        const sig = typeof u.signature === 'string'
          ? u.signature
          : (typeof u.bio === 'string' ? u.bio : '');
        return {
          username: u.unique_id || u.uniqueId || '',
          name: u.nickname || '',
          avatar: u.avatar_thumb?.url_list?.[0]
            || u.avatarThumb
            || u.avatarMedium
            || '',
          verified,
          followers,
          bio: sig.replace(/\n/g, ' ').trim().slice(0, 120),
        };
      }).filter((u: any) => u.username);

      return { users };
    } catch (e: any) {
      return { error: e?.message || 'TikTok account-search scraper failed' };
    }
  }, [query, lim]) as TikTokAccountSearchResult | { error: string };

  if (result && typeof result === 'object' && 'error' in result) {
    throw new Error((result as any).error);
  }
  return result as TikTokAccountSearchResult;
}
