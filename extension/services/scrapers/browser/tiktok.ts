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

// ─── Wave 2 types ──────────────────────────────────────────────────

export interface TikTokChallengeInfo {
  id: string;
  title: string;             // challengeName
  desc: string;              // description, max 200 chars
  cover: string;
  view_count: number;        // statsV2.videoCount as proxy when available
  video_count: number;
  is_commerce: boolean;
}

export interface TikTokChallengePostsResult {
  videos: TikTokVideo[];
  cursor: string;
  has_more: boolean;
}

export interface TikTokMusicInfo {
  id: string;
  title: string;
  author: string;            // music authorName
  cover: string;             // cover thumb url
  play_url: string;          // mp3 stream (may expire)
  duration: number;          // seconds
  video_count: number;
  is_original: boolean;
}

export interface TikTokMusicPostsResult {
  videos: TikTokVideo[];
  cursor: string;
  has_more: boolean;
}

export interface TikTokUnlimitedSoundsResult {
  sounds: TikTokMusicInfo[];
  page: number;
  has_more: boolean;
}

// ─── Wave 3 types ──────────────────────────────────────────────────

export interface TikTokUserInfo {
  username: string;
  name: string;
  bio: string;
  followers: number;
  following: number;
  likes: number;
  videos: number;
  verified: string;          // 'Yes' | 'No' — matches getTikTokProfile shape
}

export interface TikTokUserInfoWithRegion extends TikTokUserInfo {
  region: string;
}

export interface TikTokPlaylist {
  mixId: string;
  mixName: string;
  videoCount: number;
  coverUrl: string;
}

export interface TikTokUserPlaylistResult {
  playlists: TikTokPlaylist[];
  cursor: string;
  has_more: boolean;
}

export interface TikTokRepostResult {
  videos: TikTokVideo[];
  cursor: string;
  has_more: boolean;
}

export interface TikTokStory {
  id: string;
  cover: string;
  video_url: string;
  duration: number;
  created_at: number;
  expires_at: number;
}

export interface TikTokStoryResult {
  stories: TikTokStory[];
  cursor: string;
  has_more: boolean;
}

// ─── Wave 4 types ──────────────────────────────────────────────────

export interface TikTokHashtagSummary {
  id: string;
  name: string;
  video_count: number;
}

export interface TikTokMusicSummary {
  id: string;
  title: string;
  author: string;
  cover: string;
}

export interface TikTokGeneralSearchResult {
  videos: TikTokVideo[];
  accounts: TikTokUserSummary[];
  hashtags: TikTokHashtagSummary[];
  music: TikTokMusicSummary[];
  cursor: string;
  has_more: boolean;
}

export interface TikTokLiveStream {
  roomId: string;
  title: string;
  viewerCount: number;
  host: {
    uniqueId: string;
    nickname: string;
    avatar: string;
  };
}

export interface TikTokLiveSearchResult {
  lives: TikTokLiveStream[];
  cursor: string;
  has_more: boolean;
}

export interface TikTokSuggestionsResult {
  suggestions: string[];
}

export interface TikTokPostRelatedResult {
  videos: TikTokVideo[];
  cursor: string;
  has_more: boolean;
}

export interface TikTokPostExploreResult {
  videos: TikTokVideo[];
  cursor: string;
  has_more: boolean;
}

export interface TikTokPostDiscoverResult {
  videos: TikTokVideo[];
  page: number;
  has_more: boolean;
}

// ─── Internal: TikTokVideo mapper (shared by every video endpoint) ─

/**
 * Source-of-truth for the v1/v2 itemList -> TikTokVideo shape. Inlined
 * inside `executeInPage` callbacks below (it can't be passed across CDP
 * boundary as a function ref), but kept here as a comment-anchored copy
 * for diffability.
 *
 *   See getTikTokUserPosts's inline mapper (Wave 1) for the canonical body.
 */

// ─── 6. getTikTokChallengeInfo ─────────────────────────────────────

export async function getTikTokChallengeInfo(challengeName: string): Promise<TikTokChallengeInfo> {
  if (!challengeName || !challengeName.trim()) throw new Error('Challenge name required');
  const name = challengeName.trim().replace(/^#/, '');

  const tabId = await getTab('https://www.tiktok.com/explore');
  await checkLoginRedirect(tabId, 'TikTok');

  const result = await executeInPage(tabId, async (cName: string) => {
    try {
      const apiUrl = '/api/challenge/detail/?aid=1988&challengeName=' + encodeURIComponent(cName);
      const res = await fetch(apiUrl, { credentials: 'include' });
      if (!res.ok) return { error: 'TikTok challenge-info fetch failed: HTTP ' + res.status };
      const body = await res.text();
      if (!body) return { error: '/api/challenge/detail/ returned empty body — likely anti-bot stub, install yt-dlp on host for fallback' };
      let data: any;
      try { data = JSON.parse(body); } catch { return { error: '/api/challenge/detail/ returned non-JSON body — likely anti-bot stub, install yt-dlp on host for fallback' }; }
      const ch = data.challengeInfo?.challenge || data.challenge || {};
      const stats = data.challengeInfo?.stats || data.statsV2 || data.stats || {};
      if (!ch.id && !ch.title) {
        return { error: 'Challenge not found: ' + cName };
      }
      const num = (x: any): number => (typeof x === 'number' ? x : (typeof x === 'string' ? (parseInt(x, 10) || 0) : 0));
      return {
        id: ch.id || '',
        title: ch.title || cName,
        desc: typeof ch.desc === 'string' ? ch.desc.replace(/\s+/g, ' ').trim().slice(0, 200) : '',
        cover: ch.coverLarger || ch.coverMedium || ch.coverThumb || '',
        view_count: num(stats.viewCount),
        video_count: num(stats.videoCount),
        is_commerce: Boolean(ch.isCommerce),
      };
    } catch (e: any) {
      return { error: e?.message || 'TikTok challenge-info scraper failed' };
    }
  }, [name]) as TikTokChallengeInfo | { error: string };

  if (result && typeof result === 'object' && 'error' in result) {
    throw new Error((result as any).error);
  }
  return result as TikTokChallengeInfo;
}

// ─── 7. getTikTokChallengePosts ────────────────────────────────────

export async function getTikTokChallengePosts(
  challengeId: string,
  options: { cursor?: string; limit?: number } = {},
): Promise<TikTokChallengePostsResult> {
  if (!challengeId || !challengeId.trim()) throw new Error('Challenge id required');
  const cursor = options.cursor || '0';
  const limit = Math.min(Math.max(options.limit || 30, 1), 50);

  const tabId = await getTab('https://www.tiktok.com/explore');
  await checkLoginRedirect(tabId, 'TikTok');

  const result = await executeInPage(tabId, async (cid: string, cur: string, lim: number) => {
    try {
      const apiUrl =
        '/api/challenge/item_list/?aid=1988&challengeID=' + encodeURIComponent(cid) +
        '&count=' + lim +
        '&cursor=' + encodeURIComponent(cur);
      const res = await fetch(apiUrl, { credentials: 'include' });
      if (!res.ok) return { error: 'TikTok challenge-posts fetch failed: HTTP ' + res.status };
      const body = await res.text();
      if (!body) return { error: '/api/challenge/item_list/ returned empty body — likely anti-bot stub, install yt-dlp on host for fallback' };
      let data: any;
      try { data = JSON.parse(body); } catch { return { error: '/api/challenge/item_list/ returned non-JSON body — likely anti-bot stub, install yt-dlp on host for fallback' }; }
      const items: any[] = Array.isArray(data.itemList) ? data.itemList : [];
      const nextCursor = data.cursor != null ? String(data.cursor) : '';
      const hasMore = Boolean(data.hasMore);

      const HASHTAG_RE = /#([\w一-龥぀-ヿ㐀-䶿]+)/g;
      const num = (x: any): number => (typeof x === 'number' ? x : (typeof x === 'string' ? (parseInt(x, 10) || 0) : 0));

      const videos = items.map((v: any) => {
        const a = v.author || {};
        const s = v.stats || v.statsV2 || {};
        const vid = v.video || {};
        const mus = v.music || {};
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

      return { videos, cursor: nextCursor, has_more: hasMore };
    } catch (e: any) {
      return { error: e?.message || 'TikTok challenge-posts scraper failed' };
    }
  }, [challengeId.trim(), cursor, limit]) as TikTokChallengePostsResult | { error: string };

  if (result && typeof result === 'object' && 'error' in result) {
    throw new Error((result as any).error);
  }
  return result as TikTokChallengePostsResult;
}

// ─── 8. getTikTokMusicInfo ─────────────────────────────────────────

export async function getTikTokMusicInfo(musicId: string): Promise<TikTokMusicInfo> {
  if (!musicId || !musicId.trim()) throw new Error('Music id required');
  const mid = musicId.trim();

  const tabId = await getTab('https://www.tiktok.com/explore');
  await checkLoginRedirect(tabId, 'TikTok');

  const result = await executeInPage(tabId, async (id: string) => {
    try {
      // Use the JSON API directly — the rehydration script on the
      // /music/<id> HTML page no longer carries a `webapp.music-detail`
      // scope (TikTok stopped pre-rendering it; the SPA fetches it
      // lazily). The lazy-loaded endpoint REQUIRES `language=en` —
      // without it the server returns 400 "no Language given".
      const url = '/api/music/detail/?aid=1988&musicId=' + encodeURIComponent(id) + '&language=en';
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) return { error: 'TikTok music detail fetch failed: HTTP ' + res.status };
      const j: any = await res.json();
      const md = j.musicInfo;
      if (!md) return { error: 'Music not found: ' + id };
      const m = md.music || {};
      const stats = md.stats || {};
      const num = (x: any): number => (typeof x === 'number' ? x : (typeof x === 'string' ? (parseInt(x, 10) || 0) : 0));
      return {
        id: m.id || id,
        title: m.title || '',
        author: m.authorName || '',
        cover: m.coverLarge || m.coverMedium || m.coverThumb || '',
        play_url: m.playUrl || '',
        duration: typeof m.duration === 'number' ? m.duration : num(m.duration),
        video_count: num(stats.videoCount),
        is_original: Boolean(m.original),
      };
    } catch (e: any) {
      return { error: e?.message || 'TikTok music-info scraper failed' };
    }
  }, [mid]) as TikTokMusicInfo | { error: string };

  if (result && typeof result === 'object' && 'error' in result) {
    throw new Error((result as any).error);
  }
  return result as TikTokMusicInfo;
}

// ─── 9. getTikTokMusicPosts ────────────────────────────────────────

export async function getTikTokMusicPosts(
  musicId: string,
  options: { cursor?: string; limit?: number } = {},
): Promise<TikTokMusicPostsResult> {
  if (!musicId || !musicId.trim()) throw new Error('Music id required');
  const cursor = options.cursor || '0';
  const limit = Math.min(Math.max(options.limit || 30, 1), 50);

  const tabId = await getTab('https://www.tiktok.com/explore');
  await checkLoginRedirect(tabId, 'TikTok');

  const result = await executeInPage(tabId, async (mid: string, cur: string, lim: number) => {
    try {
      const apiUrl =
        '/api/music/item_list/?aid=1988&musicID=' + encodeURIComponent(mid) +
        '&count=' + lim +
        '&cursor=' + encodeURIComponent(cur);
      const res = await fetch(apiUrl, { credentials: 'include' });
      if (!res.ok) return { error: 'TikTok music-posts fetch failed: HTTP ' + res.status };
      const body = await res.text();
      if (!body) return { error: '/api/music/item_list/ returned empty body — likely anti-bot stub, install yt-dlp on host for fallback' };
      let data: any;
      try { data = JSON.parse(body); } catch { return { error: '/api/music/item_list/ returned non-JSON body — likely anti-bot stub, install yt-dlp on host for fallback' }; }
      const items: any[] = Array.isArray(data.itemList) ? data.itemList : [];
      const nextCursor = data.cursor != null ? String(data.cursor) : '';
      const hasMore = Boolean(data.hasMore);

      const HASHTAG_RE = /#([\w一-龥぀-ヿ㐀-䶿]+)/g;
      const num = (x: any): number => (typeof x === 'number' ? x : (typeof x === 'string' ? (parseInt(x, 10) || 0) : 0));

      const videos = items.map((v: any) => {
        const a = v.author || {};
        const s = v.stats || v.statsV2 || {};
        const vid = v.video || {};
        const mus = v.music || {};
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

      return { videos, cursor: nextCursor, has_more: hasMore };
    } catch (e: any) {
      return { error: e?.message || 'TikTok music-posts scraper failed' };
    }
  }, [musicId.trim(), cursor, limit]) as TikTokMusicPostsResult | { error: string };

  if (result && typeof result === 'object' && 'error' in result) {
    throw new Error((result as any).error);
  }
  return result as TikTokMusicPostsResult;
}

// ─── 10. getTikTokMusicUnlimitedSounds ─────────────────────────────

export async function getTikTokMusicUnlimitedSounds(
  options: { page?: number; pageSize?: number; orderBy?: number } = {},
): Promise<TikTokUnlimitedSoundsResult> {
  const page = Math.max(options.page || 1, 1);
  const pageSize = Math.min(Math.max(options.pageSize || 30, 1), 50);
  const orderBy = typeof options.orderBy === 'number' ? options.orderBy : 1;

  const tabId = await getTab('https://www.tiktok.com/explore');
  await checkLoginRedirect(tabId, 'TikTok');

  const result = await executeInPage(tabId, async (p: number, ps: number, ob: number) => {
    try {
      const apiUrl =
        '/api/music/unlimited-sounds/?aid=1988' +
        '&page=' + p +
        '&pageSize=' + ps +
        '&orderBy=' + ob;
      const res = await fetch(apiUrl, { credentials: 'include' });
      if (!res.ok) return { error: 'TikTok unlimited-sounds fetch failed: HTTP ' + res.status };
      const body = await res.text();
      if (!body) return { error: '/api/music/unlimited-sounds/ returned empty body — likely anti-bot stub, install yt-dlp on host for fallback' };
      let data: any;
      try { data = JSON.parse(body); } catch { return { error: '/api/music/unlimited-sounds/ returned non-JSON body — likely anti-bot stub, install yt-dlp on host for fallback' }; }
      const list: any[] = Array.isArray(data.soundList) ? data.soundList
        : Array.isArray(data.musicList) ? data.musicList
        : Array.isArray(data.items) ? data.items
        : [];
      const num = (x: any): number => (typeof x === 'number' ? x : (typeof x === 'string' ? (parseInt(x, 10) || 0) : 0));

      const sounds = list.map((entry: any) => {
        const m = entry?.music || entry || {};
        const stats = entry?.stats || {};
        return {
          id: m.id || '',
          title: m.title || '',
          author: m.authorName || '',
          cover: m.coverLarge || m.coverMedium || m.coverThumb || '',
          play_url: m.playUrl || '',
          duration: typeof m.duration === 'number' ? m.duration : num(m.duration),
          video_count: num(stats.videoCount ?? m.userCount),
          is_original: Boolean(m.original),
        };
      });

      return {
        sounds,
        page: p,
        has_more: Boolean(data.hasMore || data.has_more || sounds.length >= ps),
      };
    } catch (e: any) {
      return { error: e?.message || 'TikTok unlimited-sounds scraper failed' };
    }
  }, [page, pageSize, orderBy]) as TikTokUnlimitedSoundsResult | { error: string };

  if (result && typeof result === 'object' && 'error' in result) {
    throw new Error((result as any).error);
  }
  return result as TikTokUnlimitedSoundsResult;
}

// ─── 11. getTikTokUserInfoWithRegion ───────────────────────────────

export async function getTikTokUserInfoWithRegion(uniqueId: string): Promise<TikTokUserInfoWithRegion> {
  if (!uniqueId || !uniqueId.trim()) throw new Error('Username required');
  const uname = uniqueId.trim().replace(/^@/, '');

  const tabId = await getTab('https://www.tiktok.com/explore');
  await checkLoginRedirect(tabId, 'TikTok');

  const data = await executeInPage(tabId, async (user: string) => {
    try {
      const res = await fetch('https://www.tiktok.com/@' + encodeURIComponent(user), {
        credentials: 'include',
      });
      if (!res.ok) return { error: 'User not found: ' + user };
      const html = await res.text();
      const idx = html.indexOf('__UNIVERSAL_DATA_FOR_REHYDRATION__');
      if (idx === -1) return { error: 'Could not parse TikTok profile data' };
      const start = html.indexOf('>', idx) + 1;
      const end = html.indexOf('</script>', start);
      let json: any;
      try { json = JSON.parse(html.substring(start, end)); }
      catch { return { error: 'Could not JSON-parse profile rehydration data' }; }
      const ud = json['__DEFAULT_SCOPE__']?.['webapp.user-detail'];
      const u = ud?.userInfo?.user;
      const s = ud?.userInfo?.stats;
      if (!u) return { error: 'User not found: ' + user };
      return {
        username: u.uniqueId || user,
        name: u.nickname || '',
        bio: (u.signature || '').replace(/\n/g, ' ').substring(0, 120),
        followers: s?.followerCount || 0,
        following: s?.followingCount || 0,
        likes: s?.heartCount || 0,
        videos: s?.videoCount || 0,
        verified: u.verified ? 'Yes' : 'No',
        region: u.region || '',
      };
    } catch (e: any) {
      return { error: e?.message || 'TikTok user-info-with-region scraper failed' };
    }
  }, [uname]) as TikTokUserInfoWithRegion | { error: string };

  if (data && typeof data === 'object' && 'error' in data) {
    throw new Error((data as any).error);
  }
  return data as TikTokUserInfoWithRegion;
}

// ─── 12. getTikTokUserInfoById ─────────────────────────────────────

export async function getTikTokUserInfoById(userId: string): Promise<TikTokUserInfo> {
  if (!userId || !userId.trim()) throw new Error('User id required');
  const uid = userId.trim();

  const tabId = await getTab('https://www.tiktok.com/explore');
  await checkLoginRedirect(tabId, 'TikTok');

  const data = await executeInPage(tabId, async (id: string) => {
    try {
      const apiUrl = '/api/user/detail/?aid=1988&user_id=' + encodeURIComponent(id);
      const res = await fetch(apiUrl, { credentials: 'include' });
      if (!res.ok) return { error: 'TikTok user-by-id fetch failed: HTTP ' + res.status };
      const body = await res.text();
      if (!body) return { error: '/api/user/detail/ returned empty body — likely anti-bot stub, install yt-dlp on host for fallback' };
      let json: any;
      try { json = JSON.parse(body); } catch { return { error: '/api/user/detail/ returned non-JSON body — likely anti-bot stub, install yt-dlp on host for fallback' }; }
      const u = json.userInfo?.user || json.user || {};
      const s = json.userInfo?.stats || json.stats || {};
      if (!u.uniqueId && !u.uid) return { error: 'User not found: ' + id };
      return {
        username: u.uniqueId || '',
        name: u.nickname || '',
        bio: (u.signature || '').replace(/\n/g, ' ').substring(0, 120),
        followers: s.followerCount || 0,
        following: s.followingCount || 0,
        likes: s.heartCount || 0,
        videos: s.videoCount || 0,
        verified: u.verified ? 'Yes' : 'No',
      };
    } catch (e: any) {
      return { error: e?.message || 'TikTok user-by-id scraper failed' };
    }
  }, [uid]) as TikTokUserInfo | { error: string };

  if (data && typeof data === 'object' && 'error' in data) {
    throw new Error((data as any).error);
  }
  return data as TikTokUserInfo;
}

// ─── 13. getTikTokUserFollowings ───────────────────────────────────

export async function getTikTokUserFollowings(
  usernameOrSecUid: string,
  options: { cursor?: string; limit?: number } = {},
): Promise<TikTokUserListResult> {
  const { secUid } = await resolveSecUid(usernameOrSecUid);
  const cursor = options.cursor || '0';
  const limit = Math.min(Math.max(options.limit || 30, 1), 50);

  const tabId = await getTab('https://www.tiktok.com/explore');
  await checkLoginRedirect(tabId, 'TikTok');

  const result = await executeInPage(tabId, async (secUid: string, cur: string, lim: number) => {
    try {
      // TikTok no longer exposes the followings list publicly via
      // /api/user/list/ (only scene=21 / followers works for arbitrary
      // accounts; scenes 1-11 all 400 with "err input"). The web UI
      // gets followings via the user's own profile page state — not
      // reachable without owning the account. Return a structured
      // error so the buyer knows to install yt-dlp / use a different
      // path; don't pretend the list is empty.
      const apiUrl =
        '/api/user/list/?aid=1988&scene=11' +
        '&count=' + lim +
        '&maxCursor=' + encodeURIComponent(cur) +
        '&minCursor=0' +
        '&secUid=' + encodeURIComponent(secUid) +
        '&language=en';
      const res = await fetch(apiUrl, { credentials: 'include' });
      if (res.status === 400) {
        return {
          users: [],
          cursor: '',
          has_more: false,
          note: 'tiktok-followings-not-public: TikTok no longer exposes other users\' following list via web API. Only your own followings are visible from the logged-in profile.',
        };
      }
      if (!res.ok) return { error: 'TikTok user-followings fetch failed: HTTP ' + res.status };
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

      const out: any = { users, cursor: nextCursor, has_more: hasMore };
      if (users.length === 0 && (total === 0 || total == null)) {
        out.note = 'followings list hidden by account privacy';
      }
      return out;
    } catch (e: any) {
      return { error: e?.message || 'TikTok user-followings scraper failed' };
    }
  }, [secUid, cursor, limit]) as TikTokUserListResult | { error: string };

  if (result && typeof result === 'object' && 'error' in result) {
    throw new Error((result as any).error);
  }
  return result as TikTokUserListResult;
}

// ─── 14. getTikTokUserLikedPosts ───────────────────────────────────

export async function getTikTokUserLikedPosts(
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
        '/api/user/like/item_list/?aid=1988&secUid=' + encodeURIComponent(secUid) +
        '&count=' + lim +
        '&cursor=' + encodeURIComponent(cur);
      const res = await fetch(apiUrl, { credentials: 'include' });
      if (!res.ok) return { error: 'TikTok user-liked-posts fetch failed: HTTP ' + res.status };
      const body = await res.text();
      if (!body) {
        // 200 with empty body is the privacy stub.
        return { videos: [], cursor: '', has_more: false, note: 'liked posts hidden by account privacy' };
      }
      let data: any;
      try { data = JSON.parse(body); } catch {
        return { error: '/api/user/like/item_list/ returned non-JSON body — likely anti-bot stub, install yt-dlp on host for fallback' };
      }
      const items: any[] = Array.isArray(data.itemList) ? data.itemList : [];
      const total = typeof data.total === 'number' ? data.total : null;

      if (items.length === 0 && (total === 0 || total == null)) {
        return { videos: [], cursor: '', has_more: false, note: 'liked posts hidden by account privacy' };
      }

      const HASHTAG_RE = /#([\w一-龥぀-ヿ㐀-䶿]+)/g;
      const num = (x: any): number => (typeof x === 'number' ? x : (typeof x === 'string' ? (parseInt(x, 10) || 0) : 0));

      const videos = items.map((v: any) => {
        const a = v.author || {};
        const s = v.stats || v.statsV2 || {};
        const vid = v.video || {};
        const mus = v.music || {};
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
        cursor: data.cursor != null ? String(data.cursor) : '',
        has_more: Boolean(data.hasMore),
      };
    } catch (e: any) {
      return { error: e?.message || 'TikTok user-liked-posts scraper failed' };
    }
  }, [secUid, cursor, limit]) as (TikTokUserPostsResult & { note?: string }) | { error: string };

  if (result && typeof result === 'object' && 'error' in result) {
    throw new Error((result as any).error);
  }
  return result as TikTokUserPostsResult;
}

// ─── 15. getTikTokUserPlaylist ─────────────────────────────────────

export async function getTikTokUserPlaylist(
  usernameOrSecUid: string,
  options: { cursor?: string; limit?: number } = {},
): Promise<TikTokUserPlaylistResult> {
  const { secUid } = await resolveSecUid(usernameOrSecUid);
  const cursor = options.cursor || '0';
  const limit = Math.min(Math.max(options.limit || 30, 1), 50);

  const tabId = await getTab('https://www.tiktok.com/explore');
  await checkLoginRedirect(tabId, 'TikTok');

  const result = await executeInPage(tabId, async (secUid: string, cur: string, lim: number) => {
    try {
      const apiUrl =
        '/api/user/playlist/?aid=1988&secUid=' + encodeURIComponent(secUid) +
        '&count=' + lim +
        '&cursor=' + encodeURIComponent(cur);
      const res = await fetch(apiUrl, { credentials: 'include' });
      if (!res.ok) return { error: 'TikTok user-playlist fetch failed: HTTP ' + res.status };
      const body = await res.text();
      if (!body) return { error: '/api/user/playlist/ returned empty body — likely anti-bot stub, install yt-dlp on host for fallback' };
      let data: any;
      try { data = JSON.parse(body); } catch { return { error: '/api/user/playlist/ returned non-JSON body — likely anti-bot stub, install yt-dlp on host for fallback' }; }
      const list: any[] = Array.isArray(data.playList) ? data.playList
        : Array.isArray(data.mixList) ? data.mixList
        : Array.isArray(data.itemList) ? data.itemList
        : [];

      const num = (x: any): number => (typeof x === 'number' ? x : (typeof x === 'string' ? (parseInt(x, 10) || 0) : 0));

      const playlists = list.map((p: any) => ({
        mixId: p.mixId || p.id || '',
        mixName: p.mixName || p.name || '',
        videoCount: num(p.videoCount ?? p.itemTotal ?? p.total),
        coverUrl: p.cover || p.coverUrl || p.coverMedium || p.coverLarger || '',
      }));

      return {
        playlists,
        cursor: data.cursor != null ? String(data.cursor) : '',
        has_more: Boolean(data.hasMore),
      };
    } catch (e: any) {
      return { error: e?.message || 'TikTok user-playlist scraper failed' };
    }
  }, [secUid, cursor, limit]) as TikTokUserPlaylistResult | { error: string };

  if (result && typeof result === 'object' && 'error' in result) {
    throw new Error((result as any).error);
  }
  return result as TikTokUserPlaylistResult;
}

// ─── 16. getTikTokUserRepost ───────────────────────────────────────

/**
 * Resolve a caller-supplied identifier into the numeric TikTok userId
 * (`user.id` from the profile rehydration script). Used by endpoints
 * that don't accept secUid (notably /api/repost/item_list/, story).
 */
async function resolveNumericUserId(input: string): Promise<string> {
  const raw = (input || '').trim().replace(/^@/, '');
  if (!raw) throw new Error('Username or userId required');
  // Bare numeric id (TikTok user ids are 19-digit longs)
  if (/^\d{6,25}$/.test(raw)) return raw;

  const tabId = await getTab('https://www.tiktok.com/explore');
  await checkLoginRedirect(tabId, 'TikTok');

  // If caller passed a secUid we still need to land on /@<uniqueId> to read
  // the numeric `user.id`. Try the secUid path first via /api/user/detail/.
  if (/^MS4wL[A-Za-z0-9_-]+$/.test(raw)) {
    const got = await executeInPage(tabId, async (sec: string) => {
      try {
        const r = await fetch('/api/user/detail/?aid=1988&secUid=' + encodeURIComponent(sec), {
          credentials: 'include',
        });
        if (!r.ok) return { error: 'HTTP ' + r.status };
        const j = await r.json();
        const u = j?.userInfo?.user || j?.user || {};
        return { id: u.id || u.uid || '' };
      } catch (e: any) {
        return { error: e?.message || 'numeric-uid resolve failed' };
      }
    }, [raw]) as { id?: string; error?: string };
    if (got?.id) return got.id;
    // Fall through — caller might have given us a uniqueId-shaped string
    // that just happens to look like a secUid (very rare).
  }

  // Treat as uniqueId and read user.id from the rehydration script.
  const got = await executeInPage(tabId, async (uname: string) => {
    try {
      const r = await fetch('https://www.tiktok.com/@' + encodeURIComponent(uname), { credentials: 'include' });
      if (!r.ok) return { error: 'HTTP ' + r.status };
      const html = await r.text();
      const idx = html.indexOf('__UNIVERSAL_DATA_FOR_REHYDRATION__');
      if (idx === -1) return { error: 'no rehydration tag' };
      const start = html.indexOf('>', idx) + 1;
      const end = html.indexOf('</script>', start);
      try {
        const j = JSON.parse(html.substring(start, end));
        const u = j['__DEFAULT_SCOPE__']?.['webapp.user-detail']?.userInfo?.user;
        return { id: u?.id || '' };
      } catch {
        return { error: 'rehydration parse failed' };
      }
    } catch (e: any) {
      return { error: e?.message || 'profile fetch failed' };
    }
  }, [raw]) as { id?: string; error?: string };

  if (!got?.id) throw new Error('Could not resolve numeric userId for: ' + raw);
  return got.id;
}

export async function getTikTokUserRepost(
  handleOrSecUid: string,
  options: { cursor?: string; limit?: number } = {},
): Promise<TikTokRepostResult> {
  const userId = await resolveNumericUserId(handleOrSecUid);
  const cursor = options.cursor || '0';
  const limit = Math.min(Math.max(options.limit || 30, 1), 50);

  const tabId = await getTab('https://www.tiktok.com/explore');
  await checkLoginRedirect(tabId, 'TikTok');

  const result = await executeInPage(tabId, async (uid: string, cur: string, lim: number) => {
    try {
      const apiUrl =
        '/api/repost/item_list/?aid=1988&user_id=' + encodeURIComponent(uid) +
        '&count=' + lim +
        '&cursor=' + encodeURIComponent(cur);
      const res = await fetch(apiUrl, { credentials: 'include' });
      if (!res.ok) return { error: 'TikTok user-repost fetch failed: HTTP ' + res.status };
      const body = await res.text();
      if (!body) return { error: '/api/repost/item_list/ returned empty body — likely anti-bot stub, install yt-dlp on host for fallback' };
      let data: any;
      try { data = JSON.parse(body); } catch { return { error: '/api/repost/item_list/ returned non-JSON body — likely anti-bot stub, install yt-dlp on host for fallback' }; }
      const items: any[] = Array.isArray(data.itemList) ? data.itemList : [];

      const HASHTAG_RE = /#([\w一-龥぀-ヿ㐀-䶿]+)/g;
      const num = (x: any): number => (typeof x === 'number' ? x : (typeof x === 'string' ? (parseInt(x, 10) || 0) : 0));

      const videos = items.map((v: any) => {
        const a = v.author || {};
        const s = v.stats || v.statsV2 || {};
        const vid = v.video || {};
        const mus = v.music || {};
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
        cursor: data.cursor != null ? String(data.cursor) : '',
        has_more: Boolean(data.hasMore),
      };
    } catch (e: any) {
      return { error: e?.message || 'TikTok user-repost scraper failed' };
    }
  }, [userId, cursor, limit]) as TikTokRepostResult | { error: string };

  if (result && typeof result === 'object' && 'error' in result) {
    throw new Error((result as any).error);
  }
  return result as TikTokRepostResult;
}

// ─── 17. getTikTokUserStory ────────────────────────────────────────

export async function getTikTokUserStory(
  userId: string,
  options: { maxCursor?: string } = {},
): Promise<TikTokStoryResult> {
  const uid = await resolveNumericUserId(userId);
  const maxCursor = options.maxCursor || '0';

  const tabId = await getTab('https://www.tiktok.com/explore');
  await checkLoginRedirect(tabId, 'TikTok');

  const result = await executeInPage(tabId, async (id: string, cur: string) => {
    try {
      const apiUrl =
        '/api/story/user_story/?aid=1988&user_id=' + encodeURIComponent(id) +
        '&max_cursor=' + encodeURIComponent(cur);
      const res = await fetch(apiUrl, { credentials: 'include' });
      if (!res.ok) return { error: 'TikTok user-story fetch failed: HTTP ' + res.status };
      const body = await res.text();
      if (!body) return { stories: [], cursor: '', has_more: false };
      let data: any;
      try { data = JSON.parse(body); } catch { return { error: '/api/story/user_story/ returned non-JSON body — likely anti-bot stub, install yt-dlp on host for fallback' }; }

      // status_code === 0 with empty list = no story
      const statusCode = typeof data.status_code === 'number' ? data.status_code : (typeof data.statusCode === 'number' ? data.statusCode : null);
      const list: any[] = Array.isArray(data.stories) ? data.stories
        : Array.isArray(data.story_list) ? data.story_list
        : Array.isArray(data.items) ? data.items
        : [];

      if (statusCode === 0 && list.length === 0) {
        return { stories: [], cursor: '', has_more: false };
      }

      const num = (x: any): number => (typeof x === 'number' ? x : (typeof x === 'string' ? (parseInt(x, 10) || 0) : 0));

      const stories = list.map((st: any) => {
        const v = st.video || st.video_info || {};
        const create = num(st.create_time ?? st.createTime);
        const expire = num(st.expired_at ?? (create ? create + 86400 : 0));
        return {
          id: st.aweme_id || st.id || st.story_id || '',
          cover: v.cover || v.origin_cover?.url_list?.[0] || v.dynamic_cover?.url_list?.[0] || '',
          video_url: v.play_addr?.url_list?.[0] || v.download_addr?.url_list?.[0] || v.playAddr || '',
          duration: num(v.duration),
          created_at: create,
          expires_at: expire,
        };
      });

      return {
        stories,
        cursor: data.max_cursor != null ? String(data.max_cursor) : (data.cursor != null ? String(data.cursor) : ''),
        has_more: Boolean(data.has_more || data.hasMore),
      };
    } catch (e: any) {
      return { error: e?.message || 'TikTok user-story scraper failed' };
    }
  }, [uid, maxCursor]) as TikTokStoryResult | { error: string };

  if (result && typeof result === 'object' && 'error' in result) {
    throw new Error((result as any).error);
  }
  return result as TikTokStoryResult;
}

// ─── 18. searchTikTokGeneral ───────────────────────────────────────

export async function searchTikTokGeneral(
  query: string,
  options: { cursor?: string; limit?: number } = {},
): Promise<TikTokGeneralSearchResult> {
  if (!query || !query.trim()) throw new Error('Query required');
  const cursor = options.cursor || '0';
  const limit = Math.min(Math.max(options.limit || 20, 1), 50);

  const tabId = await getTab('https://www.tiktok.com/explore');
  await checkLoginRedirect(tabId, 'TikTok');

  const result = await executeInPage(tabId, async (q: string, cur: string, lim: number) => {
    try {
      const apiUrl =
        '/api/search/general/full/?aid=1988' +
        '&keyword=' + encodeURIComponent(q) +
        '&offset=' + encodeURIComponent(cur) +
        '&count=' + lim;
      const res = await fetch(apiUrl, { credentials: 'include' });
      if (!res.ok) return { error: 'TikTok general-search failed: HTTP ' + res.status };
      const body = await res.text();
      if (!body) return { error: '/api/search/general/full/ returned empty body — likely anti-bot stub, install yt-dlp on host for fallback' };
      let data: any;
      try { data = JSON.parse(body); } catch { return { error: '/api/search/general/full/ returned non-JSON body — likely anti-bot stub, install yt-dlp on host for fallback' }; }

      // The general endpoint groups results under `data` as an array of
      // typed cards (type: 1=video, 4=user, hashtag, music_card).
      const cards: any[] = Array.isArray(data.data) ? data.data
        : Array.isArray(data.results) ? data.results
        : [];

      const HASHTAG_RE = /#([\w一-龥぀-ヿ㐀-䶿]+)/g;
      const num = (x: any): number => (typeof x === 'number' ? x : (typeof x === 'string' ? (parseInt(x, 10) || 0) : 0));

      const videos: any[] = [];
      const accounts: any[] = [];
      const hashtags: any[] = [];
      const music: any[] = [];

      for (const card of cards) {
        const type = card?.type;
        // Video card
        if (type === 1 || card?.item) {
          const v = card.item || card.aweme_info || card;
          if (!v || typeof v !== 'object') continue;
          const a = v.author || {};
          const s = v.stats || v.statsV2 || {};
          const vid = v.video || {};
          const mus = v.music || {};
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
          videos.push({
            id: v.id || v.aweme_id || '',
            url: (a.uniqueId && (v.id || v.aweme_id)) ? 'https://www.tiktok.com/@' + a.uniqueId + '/video/' + (v.id || v.aweme_id) : '',
            desc: typeof v.desc === 'string' ? v.desc.replace(/\s+/g, ' ').trim().slice(0, 200) : '',
            author: a.uniqueId || '',
            authorName: a.nickname || '',
            createTime: typeof v.createTime === 'number' ? v.createTime : num(v.createTime || v.create_time),
            duration: typeof vid.duration === 'number' ? vid.duration : 0,
            cover: vid.cover || vid.dynamicCover || vid.originCover || '',
            hashtags: dedup,
            music: [mus.title, mus.authorName].filter(Boolean).join(' - '),
            plays: num(s.playCount ?? s.play_count),
            likes: num(s.diggCount ?? s.digg_count),
            comments: num(s.commentCount ?? s.comment_count),
            shares: num(s.shareCount ?? s.share_count),
            collects: num(s.collectCount ?? s.collect_count),
          });
        } else if (type === 4 || card?.user_list || card?.userList) {
          // User cluster card — may carry multiple users
          const list = card.user_list || card.userList || [card];
          for (const u of list) {
            const ui = u?.user_info || u?.user || u || {};
            if (!ui.unique_id && !ui.uniqueId) continue;
            accounts.push({
              username: ui.unique_id || ui.uniqueId || '',
              name: ui.nickname || '',
              avatar: ui.avatar_thumb?.url_list?.[0] || ui.avatarThumb || ui.avatarMedium || '',
              verified: Boolean(ui.verified || ui.custom_verify),
              followers: num(u?.stats?.followerCount ?? ui.follower_count ?? ui.followerCount),
              bio: typeof ui.signature === 'string' ? ui.signature.replace(/\n/g, ' ').trim().slice(0, 120) : '',
            });
          }
        } else if (card?.challenge || card?.hashtag) {
          const ch = card.challenge || card.hashtag || {};
          hashtags.push({
            id: ch.id || '',
            name: ch.title || ch.name || '',
            video_count: num(ch.statsV2?.videoCount ?? ch.stats?.videoCount ?? ch.videoCount),
          });
        } else if (card?.music_info || card?.music) {
          const m = card.music_info || card.music || {};
          music.push({
            id: m.id || '',
            title: m.title || '',
            author: m.authorName || m.author || '',
            cover: m.coverLarge || m.coverMedium || m.coverThumb || '',
          });
        }
      }

      return {
        videos,
        accounts,
        hashtags,
        music,
        cursor: data.cursor != null ? String(data.cursor) : (data.offset != null ? String(data.offset) : ''),
        has_more: Boolean(data.has_more || data.hasMore),
      };
    } catch (e: any) {
      return { error: e?.message || 'TikTok general-search scraper failed' };
    }
  }, [query.trim(), cursor, limit]) as TikTokGeneralSearchResult | { error: string };

  if (result && typeof result === 'object' && 'error' in result) {
    throw new Error((result as any).error);
  }
  return result as TikTokGeneralSearchResult;
}

// ─── 19. searchTikTokLive ──────────────────────────────────────────

export async function searchTikTokLive(
  query: string,
  options: { cursor?: string; limit?: number } = {},
): Promise<TikTokLiveSearchResult> {
  if (!query || !query.trim()) throw new Error('Query required');
  const cursor = options.cursor || '0';
  const limit = Math.min(Math.max(options.limit || 20, 1), 50);

  const tabId = await getTab('https://www.tiktok.com/explore');
  await checkLoginRedirect(tabId, 'TikTok');

  const result = await executeInPage(tabId, async (q: string, cur: string, lim: number) => {
    try {
      const apiUrl =
        '/api/search/live/full/?aid=1988' +
        '&keyword=' + encodeURIComponent(q) +
        '&cursor=' + encodeURIComponent(cur) +
        '&count=' + lim;
      const res = await fetch(apiUrl, { credentials: 'include' });
      if (!res.ok) return { error: 'TikTok live-search failed: HTTP ' + res.status };
      const body = await res.text();
      if (!body) return { error: '/api/search/live/full/ returned empty body — likely anti-bot stub, install yt-dlp on host for fallback' };
      let data: any;
      try { data = JSON.parse(body); } catch { return { error: '/api/search/live/full/ returned non-JSON body — likely anti-bot stub, install yt-dlp on host for fallback' }; }

      const list: any[] = Array.isArray(data.data) ? data.data
        : Array.isArray(data.results) ? data.results
        : Array.isArray(data.live_list) ? data.live_list
        : [];

      const num = (x: any): number => (typeof x === 'number' ? x : (typeof x === 'string' ? (parseInt(x, 10) || 0) : 0));

      const lives = list.map((entry: any) => {
        const room = entry.room || entry.live_room || entry.liveRoom || entry;
        const owner = room?.owner || room?.host || entry?.user || {};
        return {
          roomId: String(room?.room_id || room?.roomId || room?.id || ''),
          title: room?.title || room?.room_title || '',
          viewerCount: num(room?.user_count ?? room?.viewerCount ?? room?.total_user),
          host: {
            uniqueId: owner.unique_id || owner.uniqueId || '',
            nickname: owner.nickname || '',
            avatar: owner.avatar_thumb?.url_list?.[0] || owner.avatarThumb || owner.avatarMedium || '',
          },
        };
      }).filter((l: any) => l.roomId);

      return {
        lives,
        cursor: data.cursor != null ? String(data.cursor) : '',
        has_more: Boolean(data.has_more || data.hasMore),
      };
    } catch (e: any) {
      return { error: e?.message || 'TikTok live-search scraper failed' };
    }
  }, [query.trim(), cursor, limit]) as TikTokLiveSearchResult | { error: string };

  if (result && typeof result === 'object' && 'error' in result) {
    throw new Error((result as any).error);
  }
  return result as TikTokLiveSearchResult;
}

// ─── 20. getTikTokOthersSearchedFor ────────────────────────────────

export async function getTikTokOthersSearchedFor(keyword: string): Promise<TikTokSuggestionsResult> {
  if (!keyword || !keyword.trim()) throw new Error('Keyword required');

  const tabId = await getTab('https://www.tiktok.com/explore');
  await checkLoginRedirect(tabId, 'TikTok');

  const result = await executeInPage(tabId, async (q: string) => {
    try {
      // Scrape the SERP's "Others searched for" pill row from the
      // search results page. Public /api/search/* paths return "url
      // doesn't match" for typeahead suggestions in 2026 — TikTok's
      // SERP page-context is the only public surface that exposes
      // related queries.
      const searchUrl = '/search?q=' + encodeURIComponent(q);
      const res = await fetch(searchUrl, { credentials: 'include' });
      if (!res.ok) return { error: 'TikTok SERP fetch failed: HTTP ' + res.status };
      const html = await res.text();
      const tag = '__UNIVERSAL_DATA_FOR_REHYDRATION__';
      const idx = html.indexOf(tag);
      if (idx === -1) return { suggestions: [] };
      const start = html.indexOf('>', idx) + 1;
      const end = html.indexOf('</script>', start);
      let scope: any;
      try {
        const json = JSON.parse(html.substring(start, end));
        scope = json['__DEFAULT_SCOPE__'] || {};
      } catch { return { suggestions: [] }; }

      // Walk the SERP scope (`webapp.search-detail` or similar) for any
      // node carrying related-search content. Shape varies — handle
      // multiple known fields.
      const out: string[] = [];
      const seen = new Set<string>();
      const push = (v: any) => {
        const s = typeof v === 'string' ? v : (v?.keyword || v?.text || v?.content || '');
        if (s && !seen.has(s)) { seen.add(s); out.push(s); }
      };
      const walk = (n: any): void => {
        if (!n || typeof n !== 'object' || out.length > 30) return;
        if (Array.isArray(n)) { for (const x of n) walk(x); return; }
        if (Array.isArray(n.guessSearch)) n.guessSearch.forEach(push);
        if (Array.isArray(n.relatedSearch)) n.relatedSearch.forEach(push);
        if (Array.isArray(n.qaList)) n.qaList.forEach(push);
        for (const k of Object.keys(n)) walk(n[k]);
      };
      walk(scope);
      if (!out.length) {
        return {
          suggestions: [],
          note: 'tiktok-suggestions-spa-only: TikTok loads search suggestions lazily via SPA XHR after page render; no SSR rehydration field carries them. Requires SPA-state interception (future Wave).',
        };
      }
      return { suggestions: out };
    } catch (e: any) {
      return { error: e?.message || 'TikTok suggestions scraper failed' };
    }
  }, [keyword.trim()]) as TikTokSuggestionsResult | { error: string };

  if (result && typeof result === 'object' && 'error' in result) {
    throw new Error((result as any).error);
  }
  return result as TikTokSuggestionsResult;
}

// ─── 21. getTikTokPostRelated ──────────────────────────────────────

export async function getTikTokPostRelated(
  videoId: string,
  options: { cursor?: string; limit?: number } = {},
): Promise<TikTokPostRelatedResult> {
  const vid = await parseTikTokVideoId(videoId);
  const cursor = options.cursor || '0';
  const limit = Math.min(Math.max(options.limit || 16, 1), 50);

  const tabId = await getTab('https://www.tiktok.com/explore');
  await checkLoginRedirect(tabId, 'TikTok');

  const result = await executeInPage(tabId, async (id: string, cur: string, lim: number) => {
    try {
      const apiUrl =
        '/api/related/item_list/?aid=1988&itemID=' + encodeURIComponent(id) +
        '&count=' + lim +
        '&cursor=' + encodeURIComponent(cur);
      const res = await fetch(apiUrl, { credentials: 'include' });
      if (!res.ok) return { error: 'TikTok post-related fetch failed: HTTP ' + res.status };
      const body = await res.text();
      if (!body) return { error: '/api/related/item_list/ returned empty body — likely anti-bot stub, install yt-dlp on host for fallback' };
      let data: any;
      try { data = JSON.parse(body); } catch { return { error: '/api/related/item_list/ returned non-JSON body — likely anti-bot stub, install yt-dlp on host for fallback' }; }
      const items: any[] = Array.isArray(data.itemList) ? data.itemList : [];

      const HASHTAG_RE = /#([\w一-龥぀-ヿ㐀-䶿]+)/g;
      const num = (x: any): number => (typeof x === 'number' ? x : (typeof x === 'string' ? (parseInt(x, 10) || 0) : 0));

      const videos = items.map((v: any) => {
        const a = v.author || {};
        const s = v.stats || v.statsV2 || {};
        const vid_ = v.video || {};
        const mus = v.music || {};
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
        return {
          id: v.id || '',
          url: (a.uniqueId && v.id) ? 'https://www.tiktok.com/@' + a.uniqueId + '/video/' + v.id : '',
          desc: typeof v.desc === 'string' ? v.desc.replace(/\s+/g, ' ').trim().slice(0, 200) : '',
          author: a.uniqueId || '',
          authorName: a.nickname || '',
          createTime: typeof v.createTime === 'number' ? v.createTime : num(v.createTime),
          duration: typeof vid_.duration === 'number' ? vid_.duration : 0,
          cover: vid_.cover || vid_.dynamicCover || vid_.originCover || '',
          hashtags: dedup,
          music: [mus.title, mus.authorName].filter(Boolean).join(' - '),
          plays: num(s.playCount),
          likes: num(s.diggCount),
          comments: num(s.commentCount),
          shares: num(s.shareCount),
          collects: num(s.collectCount),
        };
      });

      return {
        videos,
        cursor: data.cursor != null ? String(data.cursor) : '',
        has_more: Boolean(data.hasMore),
      };
    } catch (e: any) {
      return { error: e?.message || 'TikTok post-related scraper failed' };
    }
  }, [vid, cursor, limit]) as TikTokPostRelatedResult | { error: string };

  if (result && typeof result === 'object' && 'error' in result) {
    throw new Error((result as any).error);
  }
  return result as TikTokPostRelatedResult;
}

// ─── 22. getTikTokPostExplore ──────────────────────────────────────

export async function getTikTokPostExplore(
  categoryType: number | string,
  options: { limit?: number } = {},
): Promise<TikTokPostExploreResult> {
  const cat = String(categoryType ?? '');
  if (!cat) throw new Error('categoryType required');
  const limit = Math.min(Math.max(options.limit || 16, 1), 50);

  const tabId = await getTab('https://www.tiktok.com/explore');
  await checkLoginRedirect(tabId, 'TikTok');

  const result = await executeInPage(tabId, async (catType: string, lim: number) => {
    try {
      const apiUrl =
        '/api/recommend/item_list/?aid=1988' +
        '&categoryType=' + encodeURIComponent(catType) +
        '&count=' + lim;
      const res = await fetch(apiUrl, { credentials: 'include' });
      if (!res.ok) return { error: 'TikTok post-explore fetch failed: HTTP ' + res.status };
      const body = await res.text();
      if (!body) return { error: '/api/recommend/item_list/ returned empty body — likely anti-bot stub, install yt-dlp on host for fallback' };
      let data: any;
      try { data = JSON.parse(body); } catch { return { error: '/api/recommend/item_list/ returned non-JSON body — likely anti-bot stub, install yt-dlp on host for fallback' }; }
      const items: any[] = Array.isArray(data.itemList) ? data.itemList : [];

      const HASHTAG_RE = /#([\w一-龥぀-ヿ㐀-䶿]+)/g;
      const num = (x: any): number => (typeof x === 'number' ? x : (typeof x === 'string' ? (parseInt(x, 10) || 0) : 0));

      const videos = items.map((v: any) => {
        const a = v.author || {};
        const s = v.stats || v.statsV2 || {};
        const vid_ = v.video || {};
        const mus = v.music || {};
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
        return {
          id: v.id || '',
          url: (a.uniqueId && v.id) ? 'https://www.tiktok.com/@' + a.uniqueId + '/video/' + v.id : '',
          desc: typeof v.desc === 'string' ? v.desc.replace(/\s+/g, ' ').trim().slice(0, 200) : '',
          author: a.uniqueId || '',
          authorName: a.nickname || '',
          createTime: typeof v.createTime === 'number' ? v.createTime : num(v.createTime),
          duration: typeof vid_.duration === 'number' ? vid_.duration : 0,
          cover: vid_.cover || vid_.dynamicCover || vid_.originCover || '',
          hashtags: dedup,
          music: [mus.title, mus.authorName].filter(Boolean).join(' - '),
          plays: num(s.playCount),
          likes: num(s.diggCount),
          comments: num(s.commentCount),
          shares: num(s.shareCount),
          collects: num(s.collectCount),
        };
      });

      return {
        videos,
        cursor: data.cursor != null ? String(data.cursor) : '',
        has_more: Boolean(data.hasMore),
      };
    } catch (e: any) {
      return { error: e?.message || 'TikTok post-explore scraper failed' };
    }
  }, [cat, limit]) as TikTokPostExploreResult | { error: string };

  if (result && typeof result === 'object' && 'error' in result) {
    throw new Error((result as any).error);
  }
  return result as TikTokPostExploreResult;
}

// ─── 23. getTikTokPostDiscover ─────────────────────────────────────

export async function getTikTokPostDiscover(
  keyword: string,
  options: { page?: number } = {},
): Promise<TikTokPostDiscoverResult> {
  if (!keyword || !keyword.trim()) throw new Error('Keyword required');
  const page = Math.max(options.page || 1, 1);

  const tabId = await getTab('https://www.tiktok.com/explore');
  await checkLoginRedirect(tabId, 'TikTok');

  const result = await executeInPage(tabId, async (q: string, p: number) => {
    try {
      const apiUrl =
        '/api/discover/item_list/?aid=1988' +
        '&keyword=' + encodeURIComponent(q) +
        '&page=' + p;
      const res = await fetch(apiUrl, { credentials: 'include' });
      if (!res.ok) return { error: 'TikTok post-discover fetch failed: HTTP ' + res.status };
      const body = await res.text();
      if (!body) return { error: '/api/discover/item_list/ returned empty body — likely anti-bot stub, install yt-dlp on host for fallback' };
      let data: any;
      try { data = JSON.parse(body); } catch { return { error: '/api/discover/item_list/ returned non-JSON body — likely anti-bot stub, install yt-dlp on host for fallback' }; }
      const items: any[] = Array.isArray(data.itemList) ? data.itemList
        : Array.isArray(data.body) ? data.body
        : [];

      const HASHTAG_RE = /#([\w一-龥぀-ヿ㐀-䶿]+)/g;
      const num = (x: any): number => (typeof x === 'number' ? x : (typeof x === 'string' ? (parseInt(x, 10) || 0) : 0));

      const videos = items.map((v: any) => {
        const a = v.author || {};
        const s = v.stats || v.statsV2 || {};
        const vid_ = v.video || {};
        const mus = v.music || {};
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
        return {
          id: v.id || '',
          url: (a.uniqueId && v.id) ? 'https://www.tiktok.com/@' + a.uniqueId + '/video/' + v.id : '',
          desc: typeof v.desc === 'string' ? v.desc.replace(/\s+/g, ' ').trim().slice(0, 200) : '',
          author: a.uniqueId || '',
          authorName: a.nickname || '',
          createTime: typeof v.createTime === 'number' ? v.createTime : num(v.createTime),
          duration: typeof vid_.duration === 'number' ? vid_.duration : 0,
          cover: vid_.cover || vid_.dynamicCover || vid_.originCover || '',
          hashtags: dedup,
          music: [mus.title, mus.authorName].filter(Boolean).join(' - '),
          plays: num(s.playCount),
          likes: num(s.diggCount),
          comments: num(s.commentCount),
          shares: num(s.shareCount),
          collects: num(s.collectCount),
        };
      });

      return {
        videos,
        page: p,
        has_more: Boolean(data.hasMore || data.has_more || videos.length > 0),
      };
    } catch (e: any) {
      return { error: e?.message || 'TikTok post-discover scraper failed' };
    }
  }, [keyword.trim(), page]) as TikTokPostDiscoverResult | { error: string };

  if (result && typeof result === 'object' && 'error' in result) {
    throw new Error((result as any).error);
  }
  return result as TikTokPostDiscoverResult;
}

// ─── Wave 6 types — Place / Effect / Collection / Comment-replies ────

export interface TikTokPlaceInfo {
  id: string;
  title: string;
  desc: string;             // localized address line; '' when not present
  video_count: number;
  cover: string;
}

export interface TikTokPlacePostsResult {
  videos: TikTokVideo[];
  cursor: string;
  has_more: boolean;
}

export interface TikTokEffectInfo {
  id: string;
  name: string;
  desc: string;
  designer: string;         // creator's uniqueId / nickname
  icon: string;             // sticker preview thumb
  video_count: number;
}

export interface TikTokEffectPostsResult {
  videos: TikTokVideo[];
  cursor: string;
  has_more: boolean;
}

export interface TikTokCollectionInfo {
  id: string;
  title: string;
  desc: string;
  cover: string;
  video_count: number;
  user_count: number;
}

export interface TikTokCollectionPostsResult {
  videos: TikTokVideo[];
  has_more: boolean;
}

export interface TikTokPostCommentRepliesResult {
  comments: TikTokComment[];
  cursor: string;
  has_more: boolean;
}

// Shared place/effect rehydration-script extractor. tiktok.com renders a
// `<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__">` blob on landing
// pages that exposes a `__DEFAULT_SCOPE__` map keyed by feature
// namespaces (webapp.video-detail, webapp.user-detail, etc.). Place /
// effect landing-page namespaces are NOT publicly documented — the
// shape is best-guess. If the script is missing or the namespace key
// doesn't exist, the helper returns a structured `{ error: ... }`
// envelope flagging the unknown shape for follow-up reverse-engineering.

// ─── 24. getTikTokPlaceInfo ────────────────────────────────────────

export async function getTikTokPlaceInfo(placeId: string): Promise<TikTokPlaceInfo> {
  if (!placeId || !placeId.trim()) throw new Error('Place id required');
  const pid = placeId.trim();

  const tabId = await getTab('https://www.tiktok.com/explore');
  await checkLoginRedirect(tabId, 'TikTok');

  const result = await executeInPage(tabId, async (id: string) => {
    try {
      const res = await fetch('https://www.tiktok.com/place/' + encodeURIComponent(id), {
        credentials: 'include',
        redirect: 'follow',
      });
      if (!res.ok) return { error: 'TikTok place/' + id + ' fetch failed: HTTP ' + res.status + ' — endpoint unknown, please flag for follow-up reverse-engineering' };
      const html = await res.text();
      const tag = '__UNIVERSAL_DATA_FOR_REHYDRATION__';
      const idx = html.indexOf(tag);
      if (idx === -1) return { error: 'TikTok place/effect detail endpoint unknown — please flag for follow-up reverse-engineering' };
      const start = html.indexOf('>', idx) + 1;
      const end = html.indexOf('</script>', start);
      let scope: any;
      try {
        const json = JSON.parse(html.substring(start, end));
        scope = json['__DEFAULT_SCOPE__'] || {};
      } catch {
        return { error: 'Could not JSON-parse place rehydration data' };
      }
      // Best-guess namespace path — try a few that TikTok has used for
      // similar feature pages.
      const pd = scope['webapp.place-detail']?.placeInfo
        || scope['webapp.place-detail']?.place
        || scope['webapp.place-detail']
        || null;
      if (!pd) return { error: 'TikTok place/effect detail endpoint unknown — please flag for follow-up reverse-engineering' };

      const place = pd.place || pd.poi || pd;
      const stats = pd.stats || pd.statsV2 || {};
      const num = (x: any): number => (typeof x === 'number' ? x : (typeof x === 'string' ? (parseInt(x, 10) || 0) : 0));
      return {
        id: String(place.id || place.poi_id || id),
        title: place.title || place.name || place.poi_name || '',
        desc: typeof place.address === 'string' ? place.address.replace(/\s+/g, ' ').trim().slice(0, 200)
            : typeof place.desc === 'string' ? place.desc.replace(/\s+/g, ' ').trim().slice(0, 200) : '',
        video_count: num(stats.videoCount ?? stats.video_count ?? place.videoCount),
        cover: place.cover || place.coverLarger || place.coverMedium || '',
      };
    } catch (e: any) {
      return { error: e?.message || 'TikTok place-info scraper failed' };
    }
  }, [pid]) as TikTokPlaceInfo | { error: string };

  if (result && typeof result === 'object' && 'error' in result) {
    throw new Error((result as any).error);
  }
  return result as TikTokPlaceInfo;
}

// ─── 25. getTikTokPlacePosts ───────────────────────────────────────

export async function getTikTokPlacePosts(
  placeId: string,
  options: { cursor?: string; limit?: number } = {},
): Promise<TikTokPlacePostsResult> {
  if (!placeId || !placeId.trim()) throw new Error('Place id required');
  const cursor = options.cursor || '0';
  const limit = Math.min(Math.max(options.limit || 30, 1), 50);

  const tabId = await getTab('https://www.tiktok.com/explore');
  await checkLoginRedirect(tabId, 'TikTok');

  const result = await executeInPage(tabId, async (pid: string, cur: string, lim: number) => {
    try {
      const apiUrl =
        '/api/place/item_list/?aid=1988&placeID=' + encodeURIComponent(pid) +
        '&count=' + lim +
        '&cursor=' + encodeURIComponent(cur);
      const res = await fetch(apiUrl, { credentials: 'include' });
      if (!res.ok) return { error: 'TikTok place-posts fetch failed: HTTP ' + res.status };
      const body = await res.text();
      if (!body) return { error: '/api/place/item_list/ returned empty body — likely anti-bot stub, install yt-dlp on host for fallback' };
      let data: any;
      try { data = JSON.parse(body); } catch { return { error: '/api/place/item_list/ returned non-JSON body — likely anti-bot stub, install yt-dlp on host for fallback' }; }
      const items: any[] = Array.isArray(data.itemList) ? data.itemList : [];

      const HASHTAG_RE = /#([\w一-龥぀-ヿ㐀-䶿]+)/g;
      const num = (x: any): number => (typeof x === 'number' ? x : (typeof x === 'string' ? (parseInt(x, 10) || 0) : 0));

      const videos = items.map((v: any) => {
        const a = v.author || {};
        const s = v.stats || v.statsV2 || {};
        const vid_ = v.video || {};
        const mus = v.music || {};
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
        return {
          id: v.id || '',
          url: (a.uniqueId && v.id) ? 'https://www.tiktok.com/@' + a.uniqueId + '/video/' + v.id : '',
          desc: typeof v.desc === 'string' ? v.desc.replace(/\s+/g, ' ').trim().slice(0, 200) : '',
          author: a.uniqueId || '',
          authorName: a.nickname || '',
          createTime: typeof v.createTime === 'number' ? v.createTime : num(v.createTime),
          duration: typeof vid_.duration === 'number' ? vid_.duration : 0,
          cover: vid_.cover || vid_.dynamicCover || vid_.originCover || '',
          hashtags: dedup,
          music: [mus.title, mus.authorName].filter(Boolean).join(' - '),
          plays: num(s.playCount),
          likes: num(s.diggCount),
          comments: num(s.commentCount),
          shares: num(s.shareCount),
          collects: num(s.collectCount),
        };
      });

      return {
        videos,
        cursor: data.cursor != null ? String(data.cursor) : '',
        has_more: Boolean(data.hasMore),
      };
    } catch (e: any) {
      return { error: e?.message || 'TikTok place-posts scraper failed' };
    }
  }, [placeId.trim(), cursor, limit]) as TikTokPlacePostsResult | { error: string };

  if (result && typeof result === 'object' && 'error' in result) {
    throw new Error((result as any).error);
  }
  return result as TikTokPlacePostsResult;
}

// ─── 26. getTikTokEffectInfo ───────────────────────────────────────

export async function getTikTokEffectInfo(effectId: string): Promise<TikTokEffectInfo> {
  if (!effectId || !effectId.trim()) throw new Error('Effect id required');
  const eid = effectId.trim();

  const tabId = await getTab('https://www.tiktok.com/explore');
  await checkLoginRedirect(tabId, 'TikTok');

  const result = await executeInPage(tabId, async (id: string) => {
    try {
      const res = await fetch('https://www.tiktok.com/effect/' + encodeURIComponent(id), {
        credentials: 'include',
        redirect: 'follow',
      });
      if (!res.ok) return { error: 'TikTok effect/' + id + ' fetch failed: HTTP ' + res.status + ' — endpoint unknown, please flag for follow-up reverse-engineering' };
      const html = await res.text();
      const tag = '__UNIVERSAL_DATA_FOR_REHYDRATION__';
      const idx = html.indexOf(tag);
      if (idx === -1) return { error: 'TikTok place/effect detail endpoint unknown — please flag for follow-up reverse-engineering' };
      const start = html.indexOf('>', idx) + 1;
      const end = html.indexOf('</script>', start);
      let scope: any;
      try {
        const json = JSON.parse(html.substring(start, end));
        scope = json['__DEFAULT_SCOPE__'] || {};
      } catch {
        return { error: 'Could not JSON-parse effect rehydration data' };
      }
      const ed = scope['webapp.effect-detail']?.effectInfo
        || scope['webapp.effect-detail']?.effect
        || scope['webapp.effect-detail']
        || null;
      if (!ed) return { error: 'TikTok place/effect detail endpoint unknown — please flag for follow-up reverse-engineering' };

      const effect = ed.effect || ed.sticker || ed;
      const stats = ed.stats || ed.statsV2 || {};
      const num = (x: any): number => (typeof x === 'number' ? x : (typeof x === 'string' ? (parseInt(x, 10) || 0) : 0));
      return {
        id: String(effect.id || effect.effect_id || id),
        name: effect.name || effect.title || effect.sticker_name || '',
        desc: typeof effect.desc === 'string' ? effect.desc.replace(/\s+/g, ' ').trim().slice(0, 200) : '',
        designer: effect.owner_name || effect.designer_name || effect.designer || effect.authorName || '',
        icon: effect.icon || effect.iconUrl || effect.cover || effect.coverLarger || '',
        video_count: num(stats.videoCount ?? stats.video_count ?? effect.user_count),
      };
    } catch (e: any) {
      return { error: e?.message || 'TikTok effect-info scraper failed' };
    }
  }, [eid]) as TikTokEffectInfo | { error: string };

  if (result && typeof result === 'object' && 'error' in result) {
    throw new Error((result as any).error);
  }
  return result as TikTokEffectInfo;
}

// ─── 27. getTikTokEffectPosts ──────────────────────────────────────

export async function getTikTokEffectPosts(
  effectId: string,
  options: { cursor?: string; limit?: number } = {},
): Promise<TikTokEffectPostsResult> {
  if (!effectId || !effectId.trim()) throw new Error('Effect id required');
  const cursor = options.cursor || '0';
  const limit = Math.min(Math.max(options.limit || 30, 1), 50);

  const tabId = await getTab('https://www.tiktok.com/explore');
  await checkLoginRedirect(tabId, 'TikTok');

  const result = await executeInPage(tabId, async (eid: string, cur: string, lim: number) => {
    try {
      const apiUrl =
        '/api/effect/item_list/?aid=1988&effectID=' + encodeURIComponent(eid) +
        '&count=' + lim +
        '&cursor=' + encodeURIComponent(cur);
      const res = await fetch(apiUrl, { credentials: 'include' });
      if (!res.ok) return { error: 'TikTok effect-posts fetch failed: HTTP ' + res.status };
      const body = await res.text();
      if (!body) return { error: '/api/effect/item_list/ returned empty body — likely anti-bot stub, install yt-dlp on host for fallback' };
      let data: any;
      try { data = JSON.parse(body); } catch { return { error: '/api/effect/item_list/ returned non-JSON body — likely anti-bot stub, install yt-dlp on host for fallback' }; }
      const items: any[] = Array.isArray(data.itemList) ? data.itemList : [];

      const HASHTAG_RE = /#([\w一-龥぀-ヿ㐀-䶿]+)/g;
      const num = (x: any): number => (typeof x === 'number' ? x : (typeof x === 'string' ? (parseInt(x, 10) || 0) : 0));

      const videos = items.map((v: any) => {
        const a = v.author || {};
        const s = v.stats || v.statsV2 || {};
        const vid_ = v.video || {};
        const mus = v.music || {};
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
        return {
          id: v.id || '',
          url: (a.uniqueId && v.id) ? 'https://www.tiktok.com/@' + a.uniqueId + '/video/' + v.id : '',
          desc: typeof v.desc === 'string' ? v.desc.replace(/\s+/g, ' ').trim().slice(0, 200) : '',
          author: a.uniqueId || '',
          authorName: a.nickname || '',
          createTime: typeof v.createTime === 'number' ? v.createTime : num(v.createTime),
          duration: typeof vid_.duration === 'number' ? vid_.duration : 0,
          cover: vid_.cover || vid_.dynamicCover || vid_.originCover || '',
          hashtags: dedup,
          music: [mus.title, mus.authorName].filter(Boolean).join(' - '),
          plays: num(s.playCount),
          likes: num(s.diggCount),
          comments: num(s.commentCount),
          shares: num(s.shareCount),
          collects: num(s.collectCount),
        };
      });

      return {
        videos,
        cursor: data.cursor != null ? String(data.cursor) : '',
        has_more: Boolean(data.hasMore),
      };
    } catch (e: any) {
      return { error: e?.message || 'TikTok effect-posts scraper failed' };
    }
  }, [effectId.trim(), cursor, limit]) as TikTokEffectPostsResult | { error: string };

  if (result && typeof result === 'object' && 'error' in result) {
    throw new Error((result as any).error);
  }
  return result as TikTokEffectPostsResult;
}

// ─── 28. getTikTokCollectionInfo ───────────────────────────────────

export async function getTikTokCollectionInfo(collectionId: string): Promise<TikTokCollectionInfo> {
  if (!collectionId || !collectionId.trim()) throw new Error('Collection id required');
  const cid = collectionId.trim();

  const tabId = await getTab('https://www.tiktok.com/explore');
  await checkLoginRedirect(tabId, 'TikTok');

  const result = await executeInPage(tabId, async (id: string) => {
    try {
      // TikTok internally names this "mix" — RapidAPI exposes it as
      // "collection" but the on-the-wire endpoint is /api/mix/detail/.
      // Requires language=en or the server returns 400 "no Language".
      const apiUrl = '/api/mix/detail/?aid=1988&mixId=' + encodeURIComponent(id) + '&language=en';
      const res = await fetch(apiUrl, { credentials: 'include' });
      if (!res.ok) return { error: 'TikTok collection-info fetch failed: HTTP ' + res.status };
      const body = await res.text();
      if (!body) return { error: '/api/collection/info/ returned empty body — likely anti-bot stub, install yt-dlp on host for fallback' };
      let data: any;
      try { data = JSON.parse(body); } catch { return { error: '/api/collection/info/ returned non-JSON body — likely anti-bot stub, install yt-dlp on host for fallback' }; }

      const info = data.collectionInfo || data.collection || data;
      const stats = data.stats || data.statsV2 || info?.stats || {};
      if (!info || (!info.collectionId && !info.id && !info.title && !info.name)) {
        return { error: 'Collection not found: ' + id };
      }
      const num = (x: any): number => (typeof x === 'number' ? x : (typeof x === 'string' ? (parseInt(x, 10) || 0) : 0));
      return {
        id: String(info.collectionId || info.id || id),
        title: info.title || info.name || '',
        desc: typeof info.desc === 'string' ? info.desc.replace(/\s+/g, ' ').trim().slice(0, 200)
            : typeof info.description === 'string' ? info.description.replace(/\s+/g, ' ').trim().slice(0, 200) : '',
        cover: info.cover || info.coverLarger || info.coverMedium || '',
        video_count: num(stats.videoCount ?? info.video_count ?? info.videoCount),
        user_count: num(stats.userCount ?? info.user_count ?? info.userCount),
      };
    } catch (e: any) {
      return { error: e?.message || 'TikTok collection-info scraper failed' };
    }
  }, [cid]) as TikTokCollectionInfo | { error: string };

  if (result && typeof result === 'object' && 'error' in result) {
    throw new Error((result as any).error);
  }
  return result as TikTokCollectionInfo;
}

// ─── 29. getTikTokCollectionPosts ──────────────────────────────────

export async function getTikTokCollectionPosts(
  collectionId: string,
  options: { limit?: number } = {},
): Promise<TikTokCollectionPostsResult> {
  if (!collectionId || !collectionId.trim()) throw new Error('Collection id required');
  const limit = Math.min(Math.max(options.limit || 30, 1), 50);

  const tabId = await getTab('https://www.tiktok.com/explore');
  await checkLoginRedirect(tabId, 'TikTok');

  const result = await executeInPage(tabId, async (cid: string, lim: number) => {
    try {
      // tiktok-api23 sample shows NO cursor param — endpoint returns the
      // full collection up to `count`. Pagination model isn't publicly
      // documented; we surface has_more from the response and treat
      // missing values as "we got everything we asked for".
      const apiUrl =
        '/api/mix/item_list/?aid=1988&mixId=' + encodeURIComponent(cid) +
        '&count=' + lim + '&cursor=0&language=en';
      const res = await fetch(apiUrl, { credentials: 'include' });
      if (!res.ok) return { error: 'TikTok collection-posts fetch failed: HTTP ' + res.status };
      const body = await res.text();
      if (!body) return { error: '/api/collection/item_list/ returned empty body — likely anti-bot stub, install yt-dlp on host for fallback' };
      let data: any;
      try { data = JSON.parse(body); } catch { return { error: '/api/collection/item_list/ returned non-JSON body — likely anti-bot stub, install yt-dlp on host for fallback' }; }
      const items: any[] = Array.isArray(data.itemList) ? data.itemList : [];

      const HASHTAG_RE = /#([\w一-龥぀-ヿ㐀-䶿]+)/g;
      const num = (x: any): number => (typeof x === 'number' ? x : (typeof x === 'string' ? (parseInt(x, 10) || 0) : 0));

      const videos = items.map((v: any) => {
        const a = v.author || {};
        const s = v.stats || v.statsV2 || {};
        const vid_ = v.video || {};
        const mus = v.music || {};
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
        return {
          id: v.id || '',
          url: (a.uniqueId && v.id) ? 'https://www.tiktok.com/@' + a.uniqueId + '/video/' + v.id : '',
          desc: typeof v.desc === 'string' ? v.desc.replace(/\s+/g, ' ').trim().slice(0, 200) : '',
          author: a.uniqueId || '',
          authorName: a.nickname || '',
          createTime: typeof v.createTime === 'number' ? v.createTime : num(v.createTime),
          duration: typeof vid_.duration === 'number' ? vid_.duration : 0,
          cover: vid_.cover || vid_.dynamicCover || vid_.originCover || '',
          hashtags: dedup,
          music: [mus.title, mus.authorName].filter(Boolean).join(' - '),
          plays: num(s.playCount),
          likes: num(s.diggCount),
          comments: num(s.commentCount),
          shares: num(s.shareCount),
          collects: num(s.collectCount),
        };
      });

      return {
        videos,
        has_more: Boolean(data.hasMore),
      };
    } catch (e: any) {
      return { error: e?.message || 'TikTok collection-posts scraper failed' };
    }
  }, [collectionId.trim(), limit]) as TikTokCollectionPostsResult | { error: string };

  if (result && typeof result === 'object' && 'error' in result) {
    throw new Error((result as any).error);
  }
  return result as TikTokCollectionPostsResult;
}

// ─── 30. getTikTokPostCommentReplies ───────────────────────────────

export async function getTikTokPostCommentReplies(
  videoIdOrUrl: string,
  commentId: string,
  options: { cursor?: string; limit?: number } = {},
): Promise<TikTokPostCommentRepliesResult> {
  const videoId = await parseTikTokVideoId(videoIdOrUrl);
  if (!commentId || !commentId.trim()) throw new Error('Comment id required');
  const cur = options.cursor || '0';
  const lim = Math.min(Math.max(options.limit || 6, 1), 50);

  const tabId = await getTab('https://www.tiktok.com/explore');
  await checkLoginRedirect(tabId, 'TikTok');

  const result = await executeInPage(tabId, async (vid: string, cid: string, c: string, l: number) => {
    try {
      const apiUrl =
        '/api/comment/list/reply/?aid=1988' +
        '&item_id=' + encodeURIComponent(vid) +
        '&comment_id=' + encodeURIComponent(cid) +
        '&count=' + l +
        '&cursor=' + encodeURIComponent(c);
      const res = await fetch(apiUrl, { credentials: 'include' });
      if (!res.ok) return { error: 'TikTok comment-replies fetch failed: HTTP ' + res.status };
      const body = await res.text();
      if (!body) return { error: '/api/comment/list/reply/ returned empty body — likely anti-bot stub, install yt-dlp on host for fallback' };
      let data: any;
      try { data = JSON.parse(body); } catch { return { error: '/api/comment/list/reply/ returned non-JSON body — likely anti-bot stub, install yt-dlp on host for fallback' }; }
      const comments: any[] = Array.isArray(data.comments) ? data.comments : [];
      const nextCursor = data.cursor != null ? String(data.cursor) : '';
      const hasMore = Boolean(data.has_more);

      const num = (x: any): number => (typeof x === 'number' ? x : (typeof x === 'string' ? (parseInt(x, 10) || 0) : 0));

      const out = comments.map((c2: any) => {
        const u = c2.user || {};
        const avatar = u.avatar_thumb?.url_list?.[0]
          || u.avatar_medium?.url_list?.[0]
          || u.avatar_larger?.url_list?.[0]
          || '';
        return {
          id: c2.cid || '',
          text: typeof c2.text === 'string' ? c2.text.replace(/\s+/g, ' ').trim().slice(0, 500) : '',
          author: u.unique_id || u.nickname || '',
          author_avatar: avatar,
          likes: num(c2.digg_count),
          reply_count: num(c2.reply_comment_total ?? c2.reply_count),
          created_at: num(c2.create_time),
          // We don't pull the post-author uid here (would need a separate
          // round trip); replies are rarely author replies so default false.
          is_author_reply: false,
        };
      });

      return {
        comments: out,
        cursor: nextCursor,
        has_more: hasMore,
      };
    } catch (e: any) {
      return { error: e?.message || 'TikTok post-comment-replies scraper failed' };
    }
  }, [videoId, commentId.trim(), cur, lim]) as TikTokPostCommentRepliesResult | { error: string };

  if (result && typeof result === 'object' && 'error' in result) {
    throw new Error((result as any).error);
  }
  return result as TikTokPostCommentRepliesResult;
}
