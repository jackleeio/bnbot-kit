/**
 * YouTube data scrapers — youtube138-compatible read endpoints.
 *
 * Pattern (mirrors searchYouTube in scraperService.ts):
 *   1. open the matching YouTube SPA URL via getTab()
 *   2. wait ~3s for ytInitialData / ytInitialPlayerResponse to hydrate
 *   3. extract fields inside executeInPage() — no DOM-side closures
 *   4. return a clean snake_case JSON object
 *
 * Companion `spareai-hub` will translate this into youtube138's nested
 * shape; the goal here is accuracy + consistency, not 1:1 layout match.
 */

import {
  getTab,
  checkLoginRedirect,
  executeInPage,
  ensureDebuggerAttached,
  debuggerSend,
  waitForLoad,
} from '../../scraperService';

// ─── INTERCEPT helper ───────────────────────────────────────────────
//
// YouTube ships the SPA's per-request data (player streamingData URLs,
// transcript cues, comment threads) inside /youtubei/v1/{player,
// get_transcript, next} POST responses fired by the page itself.
//
// We can't read those if we only attach a page-level `window.fetch`
// override AFTER navigation — the first round-trip has already happened
// by then. The fix is CDP's `Page.addScriptToEvaluateOnNewDocument`,
// which registers the override against the debugger session so every
// future Document executes it before any of YouTube's own scripts.
// Then we force a fresh navigation (about:blank → watchUrl) so the
// override is live when the SPA bootstraps.
async function interceptYoutubeApi(
  tabId: number,
  watchUrl: string,
  spec: { pattern: string; globalName: string },
  options: { settleMs?: number } = {},
): Promise<void> {
  const targetId = await ensureDebuggerAttached(tabId, ['Page', 'Runtime', 'Network']);
  // YouTube's Service Worker returns a ~300-byte stub for /youtubei/v1/*
  // requests that fire from a hooked page (it appears to detect either the
  // chrome.debugger attachment or the fetch override and treats us as a
  // bot). Bypassing the SW makes the request hit YouTube's origin server
  // directly, which returns the real player/transcript/next response.
  try { await debuggerSend(targetId, 'Network.setBypassServiceWorker', { bypass: true }); } catch { /* not fatal */ }
  // Force a normal desktop UA. When chrome.debugger is attached YouTube
  // sometimes downgrades to SSR-only minimal HTML (watch7-content / no
  // ytd-watch-flexy) — supplying a clean Chrome UA short-circuits the
  // headless-fingerprint codepath that triggers the downgrade.
  try {
    await debuggerSend(targetId, 'Network.setUserAgentOverride', {
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
      acceptLanguage: 'en-US,en;q=0.9',
      platform: 'MacIntel',
    });
  } catch { /* not fatal */ }
  const pat = spec.pattern.replace(/[\\'"`]/g, '');
  const gname = spec.globalName.replace(/[^A-Za-z0-9_$]/g, '');
  // The hook is self-guarding (`if (window.${gname}) return`) so duplicate
  // installations across calls are a no-op. We do reset the capture
  // array on every call so different videoIds don't bleed into each other.
  const source = `
    (function(){
      try {
        var w = window;
        // Visibility shim: scraper tabs run inside a background window,
        // so document.visibilityState is 'hidden' and YouTube skips a
        // ton of DOM work — comments lazy-load never fires, "Show
        // transcript" never mounts, etc. We patch the page-visibility
        // API to say 'visible' BEFORE any of YouTube's scripts read it.
        if (!w.__bnbotVisShimInstalled) {
          w.__bnbotVisShimInstalled = true;
          try {
            Object.defineProperty(document, 'visibilityState', { configurable: true, get: function(){ return 'visible'; } });
            Object.defineProperty(document, 'hidden', { configurable: true, get: function(){ return false; } });
            Object.defineProperty(document, 'webkitVisibilityState', { configurable: true, get: function(){ return 'visible'; } });
            Object.defineProperty(document, 'webkitHidden', { configurable: true, get: function(){ return false; } });
            // Re-fire visibilitychange after DOMContentLoaded so any
            // listener that wired up early picks up the new value.
            document.addEventListener('DOMContentLoaded', function(){
              try { document.dispatchEvent(new Event('visibilitychange')); } catch(_) {}
            });
          } catch(_) {}
        }
        w.${gname} = [];
        w.${gname}_raw = [];
        if (w.${gname}__installed) return;
        w.${gname}__installed = true;
        var o = w.fetch.bind(w);
        w.fetch = async function(){
          var args = arguments;
          var r = await o.apply(this, args);
          try {
            var u = '';
            if (typeof args[0] === 'string') u = args[0];
            else if (args[0] instanceof Request) u = args[0].url;
            else if (args[0] && args[0].url) u = args[0].url;
            if (u.indexOf(${JSON.stringify(pat)}) !== -1) {
              r.clone().text().then(function(t){
                w.${gname}_raw.push(t);
                try { w.${gname}.push(JSON.parse(t)); } catch(_) {}
              }).catch(function(){});
            }
          } catch(_) {}
          return r;
        };
      } catch(_) {}
    })();
  `;
  await debuggerSend(targetId, 'Page.addScriptToEvaluateOnNewDocument', { source });
  // Force a fresh document load. about:blank is the cleanest reset —
  // YouTube's SPA does NOT serve a new HTML document on /watch?v=A → /watch?v=B
  // (it's an internal hash-style transition), so we have to leave the
  // origin first and come back.
  await debuggerSend(targetId, 'Page.navigate', { url: 'about:blank' });
  await new Promise((r) => setTimeout(r, 400));
  await debuggerSend(targetId, 'Page.navigate', { url: watchUrl });
  // Wait for the watch page to actually settle. `waitForLoad` checks
  // chrome.tabs status which is more reliable than a blind sleep.
  try { await waitForLoad(tabId, 'www.youtube.com'); } catch { /* tolerate */ }
  await new Promise((r) => setTimeout(r, options.settleMs ?? 2500));
}

// Resets the capture array for the given global on the active page. Used
// when a scraper needs to discard any frames that fired before its own
// trigger (e.g. transcript click) so it can wait specifically for ITS
// response.
async function resetCaptureArray(tabId: number, globalName: string): Promise<void> {
  const gname = globalName.replace(/[^A-Za-z0-9_$]/g, '');
  await executeInPage(tabId, (g: string) => {
    try { (window as any)[g] = []; } catch { /* ignore */ }
    return true;
  }, [gname]);
}

async function waitForCapture(
  tabId: number,
  globalName: string,
  predicateSrc: string,  // function source: "(arr) => boolean" — passed as string for IIFE
  timeoutMs: number,
): Promise<boolean> {
  return await executeInPage(tabId, async (g: string, predSrc: string, t: number) => {
    const w = window as any;
    // eslint-disable-next-line no-new-func
    const pred = new Function('arr', 'return (' + predSrc + ')(arr);');
    const start = Date.now();
    while (Date.now() - start < t) {
      const arr = w[g] || [];
      try { if (pred(arr)) return true; } catch { /* ignore */ }
      await new Promise((r) => setTimeout(r, 300));
    }
    return false;
  }, [globalName, predicateSrc, timeoutMs]) as boolean;
}

// ─── Utilities ─────────────────────────────────────────────────────

/**
 * Accept any of: bare 11-char id, full watch URL, youtu.be short URL,
 * shorts URL, embed URL. Returns the bare id. Throws on malformed input.
 */
export function parseYouTubeVideoId(input: string): string {
  if (!input) throw new Error('Video id or URL required');
  const trimmed = input.trim();
  // Bare id — 11 chars, [A-Za-z0-9_-]
  if (/^[A-Za-z0-9_-]{11}$/.test(trimmed)) return trimmed;
  try {
    const u = new URL(trimmed);
    if (u.hostname.endsWith('youtu.be')) {
      return u.pathname.replace(/^\//, '').slice(0, 11);
    }
    const v = u.searchParams.get('v');
    if (v) return v.slice(0, 11);
    const parts = u.pathname.split('/').filter(Boolean);
    // /shorts/<id>, /embed/<id>, /live/<id>
    const idx = parts.findIndex((p) => ['shorts', 'embed', 'live', 'v'].includes(p));
    if (idx !== -1 && parts[idx + 1]) return parts[idx + 1].slice(0, 11);
  } catch {
    // not a URL — fall through
  }
  // Last-ditch: assume caller passed something close to an id
  if (trimmed.length >= 11) return trimmed.slice(0, 11);
  throw new Error('Could not parse YouTube video id from: ' + input);
}

// ─── 1. /video/details ─────────────────────────────────────────────

export interface YouTubeVideoDetails {
  id: string;
  title: string;
  description: string;
  channel_id: string;
  channel_title: string;
  channel_handle: string;
  publish_date: string;
  upload_date: string;
  duration: number;
  view_count: number;
  like_count: number;
  comment_count: number;
  thumbnails: Array<{ url: string; width: number; height: number }>;
  tags: string[];
  category: string;
  is_live: boolean;
  is_live_content: boolean;
  is_family_safe: boolean;
  keywords: string[];
}

export async function getYouTubeVideoDetails(videoIdOrUrl: string): Promise<YouTubeVideoDetails> {
  const id = parseYouTubeVideoId(videoIdOrUrl);
  const tabId = await getTab(`https://www.youtube.com/watch?v=${id}`);
  await new Promise((r) => setTimeout(r, 3000));
  await checkLoginRedirect(tabId, 'YouTube');

  const data = await executeInPage(tabId, () => {
    try {
      const pr = (window as any).ytInitialPlayerResponse;
      const id = (window as any).ytInitialData;
      if (!pr) return { error: 'ytInitialPlayerResponse missing on watch page' };
      const vd = pr.videoDetails || {};
      const mf = pr.microformat?.playerMicroformatRenderer || {};

      // Walk twoColumnWatchNextResults for view/like counts that aren't in videoDetails.
      let likeCount = 0;
      let commentCount = 0;
      let channelHandle = '';
      try {
        const results =
          id?.contents?.twoColumnWatchNextResults?.results?.results?.contents || [];
        for (const c of results) {
          // Like count — newer layout uses segmentedLikeDislikeButtonViewModel
          const vp = c.videoPrimaryInfoRenderer;
          if (vp) {
            const buttons =
              vp.videoActions?.menuRenderer?.topLevelButtons || [];
            for (const b of buttons) {
              const seg = b.segmentedLikeDislikeButtonViewModel || b.segmentedLikeDislikeButtonRenderer;
              const like = seg?.likeButtonViewModel?.likeButtonViewModel?.toggleButtonViewModel?.toggleButtonViewModel
                ?.defaultButtonViewModel?.buttonViewModel?.accessibilityText
                || seg?.likeButton?.toggleButtonRenderer?.defaultText?.accessibility?.accessibilityData?.label
                || b.toggleButtonRenderer?.defaultText?.accessibility?.accessibilityData?.label;
              if (like) {
                const m = /[\d,. \s]+/.exec(like);
                if (m) likeCount = parseInt(m[0].replace(/[^\d]/g, ''), 10) || 0;
                if (likeCount) break;
              }
            }
          }
          // Channel handle on videoSecondaryInfoRenderer.owner
          const vs = c.videoSecondaryInfoRenderer;
          if (vs?.owner?.videoOwnerRenderer) {
            const owner = vs.owner.videoOwnerRenderer;
            const navUrl = owner.navigationEndpoint?.browseEndpoint?.canonicalBaseUrl || '';
            if (navUrl.startsWith('/@')) channelHandle = navUrl.slice(1);
          }
          // Comment count
          const itemSection = c.itemSectionRenderer?.contents || [];
          for (const it of itemSection) {
            const cc = it.commentsEntryPointHeaderRenderer?.commentCount;
            if (cc?.simpleText) {
              commentCount = parseInt(String(cc.simpleText).replace(/[^\d]/g, ''), 10) || 0;
            }
          }
        }
      } catch {
        // Best-effort — like/comment counts aren't critical.
      }

      const thumbs = (vd.thumbnail?.thumbnails || []).map((t: any) => ({
        url: t.url || '',
        width: t.width || 0,
        height: t.height || 0,
      }));

      const publishDate = mf.publishDate || '';
      const uploadDate = mf.uploadDate || '';

      return {
        id: vd.videoId || '',
        title: vd.title || mf.title?.simpleText || '',
        description: vd.shortDescription || mf.description?.simpleText || '',
        channel_id: vd.channelId || mf.externalChannelId || '',
        channel_title: vd.author || mf.ownerChannelName || '',
        channel_handle: channelHandle,
        publish_date: publishDate,
        upload_date: uploadDate,
        duration: parseInt(vd.lengthSeconds || mf.lengthSeconds || '0', 10),
        view_count: parseInt(vd.viewCount || mf.viewCount || '0', 10),
        like_count: likeCount,
        comment_count: commentCount,
        thumbnails: thumbs,
        tags: vd.keywords || [],
        category: mf.category || '',
        is_live: Boolean(vd.isLive),
        is_live_content: Boolean(vd.isLiveContent),
        is_family_safe: Boolean(mf.isFamilySafe),
        keywords: vd.keywords || [],
      };
    } catch (e: any) {
      return { error: e?.message || 'YouTube video-details scraper failed' };
    }
  });

  if (data && typeof data === 'object' && 'error' in data) throw new Error((data as any).error);
  return data as YouTubeVideoDetails;
}

// ─── 2. /channel/details ───────────────────────────────────────────

export interface YouTubeChannelDetails {
  id: string;
  title: string;
  handle: string;
  description: string;
  subscriber_count: number;
  subscriber_count_text: string;
  video_count: number;
  view_count: number;
  is_verified: boolean;
  is_family_safe: boolean;
  keywords: string[];
  joined_date: string;
  country: string;
  avatar: { url: string; width: number; height: number } | null;
  banner: { url: string; width: number; height: number } | null;
  external_links: Array<{ title: string; url: string }>;
}

export async function getYouTubeChannelDetails(channelIdOrHandle: string): Promise<YouTubeChannelDetails> {
  const arg = channelIdOrHandle.trim();
  let url: string;
  if (arg.startsWith('@')) url = `https://www.youtube.com/${encodeURIComponent(arg)}`;
  else if (arg.startsWith('UC') && arg.length >= 20) url = `https://www.youtube.com/channel/${encodeURIComponent(arg)}`;
  else if (arg.startsWith('http')) url = arg;
  else url = `https://www.youtube.com/channel/${encodeURIComponent(arg)}`;

  const tabId = await getTab(url);
  await new Promise((r) => setTimeout(r, 3000));
  await checkLoginRedirect(tabId, 'YouTube');

  const data = await executeInPage(tabId, () => {
    try {
      const d = (window as any).ytInitialData;
      if (!d) return { error: 'ytInitialData missing on channel page' };
      const meta = d.metadata?.channelMetadataRenderer || {};
      const header = d.header?.c4TabbedHeaderRenderer
        || d.header?.pageHeaderRenderer
        || {};
      // Newer pageHeaderRenderer layout
      const ph = d.header?.pageHeaderRenderer?.content?.pageHeaderViewModel || null;

      // Subscriber count (string + numeric)
      let subText = '';
      let subCount = 0;
      const subSrc = header.subscriberCountText?.simpleText
        || header.subscriberCountText?.runs?.[0]?.text
        || ph?.metadata?.contentMetadataViewModel?.metadataRows?.[0]?.metadataParts?.find((p: any) =>
          /subscriber/i.test(p.text?.content || ''),
        )?.text?.content
        || '';
      if (subSrc) {
        subText = String(subSrc);
        // "1.2M subscribers" → 1200000 (rough)
        const m = /([\d.,]+)\s*([KMB]?)/i.exec(subText);
        if (m) {
          const n = parseFloat(m[1].replace(/,/g, '')) || 0;
          const unit = (m[2] || '').toUpperCase();
          subCount = Math.round(n * (unit === 'K' ? 1e3 : unit === 'M' ? 1e6 : unit === 'B' ? 1e9 : 1));
        }
      }

      // Video count — scan all aboutChannelRenderer / channelAboutFullMetadataRenderer
      let videoCount = 0;
      let viewCount = 0;
      let joinedDate = '';
      let country = '';
      const externalLinks: Array<{ title: string; url: string }> = [];

      const walk = (node: any): void => {
        if (!node || typeof node !== 'object') return;
        if (node.aboutChannelRenderer?.metadata?.aboutChannelViewModel) {
          const av = node.aboutChannelRenderer.metadata.aboutChannelViewModel;
          videoCount = parseInt(String(av.videoCountText || '').replace(/[^\d]/g, ''), 10) || videoCount;
          viewCount = parseInt(String(av.viewCountText || '').replace(/[^\d]/g, ''), 10) || viewCount;
          joinedDate = av.joinedDateText?.content || joinedDate;
          country = av.country || country;
          for (const l of av.links || []) {
            const cv = l.channelExternalLinkViewModel;
            if (cv) externalLinks.push({
              title: cv.title?.content || '',
              url: cv.link?.content || '',
            });
          }
          return;
        }
        if (node.channelAboutFullMetadataRenderer) {
          const a = node.channelAboutFullMetadataRenderer;
          videoCount = parseInt(String(a.videoCountText?.runs?.[0]?.text || '').replace(/[^\d]/g, ''), 10) || videoCount;
          viewCount = parseInt(String(a.viewCountText?.simpleText || '').replace(/[^\d]/g, ''), 10) || viewCount;
          joinedDate = a.joinedDateText?.runs?.[1]?.text || joinedDate;
          country = a.country?.simpleText || country;
          return;
        }
        for (const k of Object.keys(node)) walk(node[k]);
      };
      walk(d);

      const avatarThumbs = header.avatar?.thumbnails || ph?.image?.decoratedAvatarViewModel?.avatar?.avatarViewModel?.image?.sources || meta.avatar?.thumbnails || [];
      const avatar = avatarThumbs.length ? avatarThumbs[avatarThumbs.length - 1] : null;
      const bannerThumbs = header.banner?.thumbnails || ph?.banner?.imageBannerViewModel?.image?.sources || [];
      const banner = bannerThumbs.length ? bannerThumbs[bannerThumbs.length - 1] : null;

      // is_verified — header has badges array on c4TabbedHeaderRenderer
      let isVerified = false;
      for (const b of header.badges || []) {
        const style = b.metadataBadgeRenderer?.style || '';
        if (/VERIFIED/i.test(style)) isVerified = true;
      }

      const handleFromUrl = (() => {
        const u = meta.vanityChannelUrl || '';
        const m = /youtube\.com\/(@[^/?#]+)/.exec(u);
        return m ? m[1] : '';
      })();

      return {
        id: meta.externalId || header.channelId || '',
        title: meta.title || header.title || '',
        handle: handleFromUrl,
        description: meta.description || '',
        subscriber_count: subCount,
        subscriber_count_text: subText,
        video_count: videoCount,
        view_count: viewCount,
        is_verified: isVerified,
        is_family_safe: Boolean(meta.isFamilySafe),
        keywords: meta.keywords ? String(meta.keywords).split(' ').filter(Boolean) : [],
        joined_date: joinedDate,
        country: country,
        avatar: avatar ? { url: avatar.url || '', width: avatar.width || 0, height: avatar.height || 0 } : null,
        banner: banner ? { url: banner.url || '', width: banner.width || 0, height: banner.height || 0 } : null,
        external_links: externalLinks,
      };
    } catch (e: any) {
      return { error: e?.message || 'YouTube channel-details scraper failed' };
    }
  });

  if (data && typeof data === 'object' && 'error' in data) throw new Error((data as any).error);
  return data as YouTubeChannelDetails;
}

// ─── 3. /channel/videos ────────────────────────────────────────────

export interface YouTubeChannelVideo {
  id: string;
  title: string;
  url: string;
  duration: string;
  duration_seconds: number;
  view_count: number;
  view_count_text: string;
  published: string;
  thumbnail: string;
}

export type YouTubeChannelVideosFilter = 'latest' | 'popular' | 'oldest';

export async function getYouTubeChannelVideos(
  channelIdOrHandle: string,
  options: { filter?: YouTubeChannelVideosFilter; limit?: number } = {},
): Promise<YouTubeChannelVideo[]> {
  const filter = options.filter || 'latest';
  const limit = Math.min(options.limit || 30, 100);
  const arg = channelIdOrHandle.trim();
  // Base URL
  let base: string;
  if (arg.startsWith('@')) base = `https://www.youtube.com/${encodeURIComponent(arg)}`;
  else if (arg.startsWith('UC') && arg.length >= 20) base = `https://www.youtube.com/channel/${encodeURIComponent(arg)}`;
  else if (arg.startsWith('http')) base = arg.replace(/\/+$/, '');
  else base = `https://www.youtube.com/channel/${encodeURIComponent(arg)}`;

  let url = `${base}/videos`;
  // YouTube's /videos tab supports a "sort" via &flow=grid&view=0&pbj=1 only via
  // signed continuation tokens. The simplest hack that works on the SPA: pass
  // ?sort= for popular (popular endpoint) — but stable URL = ?view=0&sort=p.
  // Both popular & oldest land on the same /videos route via initial data;
  // we re-sort client-side when needed.
  if (filter === 'popular') url = `${base}/videos?view=0&sort=p&flow=grid`;

  const tabId = await getTab(url);
  await new Promise((r) => setTimeout(r, 3000));
  await checkLoginRedirect(tabId, 'YouTube');

  const data = await executeInPage(tabId, (lim: number, sortMode: string) => {
    try {
      const d = (window as any).ytInitialData;
      if (!d) return { error: 'ytInitialData missing on channel /videos page' };

      const tabs = d.contents?.twoColumnBrowseResultsRenderer?.tabs || [];
      // Find the Videos tab (title === 'Videos' or selected:true on /videos URL)
      let videosTab: any = null;
      for (const t of tabs) {
        const tr = t.tabRenderer;
        if (!tr) continue;
        const title = (tr.title || '').toLowerCase();
        if (title === 'videos' || title === '视频' || tr.selected) {
          videosTab = tr;
          if (title === 'videos' || title === '视频') break;
        }
      }
      if (!videosTab) return { error: 'Channel videos tab not found' };

      const rich = videosTab.content?.richGridRenderer?.contents || [];
      const out: any[] = [];

      const parseHumanCount = (s: string): number => {
        if (!s) return 0;
        const m = /([\d.,]+)\s*([KMB]?)/i.exec(s);
        if (!m) return 0;
        const n = parseFloat(m[1].replace(/,/g, '')) || 0;
        const u = (m[2] || '').toUpperCase();
        return Math.round(n * (u === 'K' ? 1e3 : u === 'M' ? 1e6 : u === 'B' ? 1e9 : 1));
      };
      const parseDuration = (s: string): number => {
        if (!s) return 0;
        const parts = s.split(':').map((p) => parseInt(p, 10) || 0);
        if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
        if (parts.length === 2) return parts[0] * 60 + parts[1];
        return parts[0] || 0;
      };

      for (const item of rich) {
        if (out.length >= lim) break;
        // Newer lockupViewModel layout
        const lvm = item.richItemRenderer?.content?.lockupViewModel;
        if (lvm && lvm.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO') {
          const vid = lvm.contentId;
          const meta = lvm.metadata?.lockupMetadataViewModel;
          const rows = meta?.metadata?.contentMetadataViewModel?.metadataRows || [];
          const parts = rows.flatMap((r: any) =>
            (r.metadataParts || []).map((p: any) => p.text?.content || '').filter(Boolean),
          );
          const thumbs = lvm.contentImage?.thumbnailViewModel?.image?.sources || [];
          const overlays = lvm.contentImage?.thumbnailViewModel?.overlays || [];
          let dur = '';
          for (const o of overlays) {
            const t = o.thumbnailOverlayBadgeViewModel?.thumbnailBadges?.[0]?.thumbnailBadgeViewModel?.text;
            if (t) { dur = t; break; }
          }
          out.push({
            id: vid,
            title: meta?.title?.content || '',
            url: 'https://www.youtube.com/watch?v=' + vid,
            duration: dur,
            duration_seconds: parseDuration(dur),
            view_count_text: parts[0] || '',
            view_count: parseHumanCount(parts[0] || ''),
            published: parts[1] || '',
            thumbnail: thumbs.length ? thumbs[thumbs.length - 1].url : '',
          });
          continue;
        }
        // Older videoRenderer layout
        const v = item.richItemRenderer?.content?.videoRenderer;
        if (v?.videoId) {
          const thumbs = v.thumbnail?.thumbnails || [];
          const viewText = v.viewCountText?.simpleText || v.shortViewCountText?.simpleText || '';
          const dur = v.lengthText?.simpleText || '';
          out.push({
            id: v.videoId,
            title: v.title?.runs?.[0]?.text || '',
            url: 'https://www.youtube.com/watch?v=' + v.videoId,
            duration: dur,
            duration_seconds: parseDuration(dur),
            view_count_text: viewText,
            view_count: parseHumanCount(viewText),
            published: v.publishedTimeText?.simpleText || '',
            thumbnail: thumbs.length ? thumbs[thumbs.length - 1].url : '',
          });
        }
      }

      // Client-side sort for oldest (popular handled via URL above; latest = default)
      if (sortMode === 'oldest') out.reverse();
      return out.slice(0, lim);
    } catch (e: any) {
      return { error: e?.message || 'YouTube channel-videos scraper failed' };
    }
  }, [limit, filter]);

  if (data && typeof data === 'object' && 'error' in data && !Array.isArray(data)) {
    throw new Error((data as any).error);
  }
  return (data as YouTubeChannelVideo[]) || [];
}

// ─── 4. /v2/trending ────────────────────────────────────────────────

export interface YouTubeTrendingVideo {
  rank: number;
  id: string;
  title: string;
  url: string;
  channel_id: string;
  channel_title: string;
  description: string;
  duration: string;
  duration_seconds: number;
  view_count: number;
  view_count_text: string;
  published: string;
  thumbnail: string;
}

export async function getYouTubeTrending(limit = 30): Promise<YouTubeTrendingVideo[]> {
  const tabId = await getTab('https://www.youtube.com/feed/trending');
  await new Promise((r) => setTimeout(r, 3000));
  await checkLoginRedirect(tabId, 'YouTube');

  const data = await executeInPage(tabId, (lim: number) => {
    try {
      const d = (window as any).ytInitialData;
      if (!d) return { error: 'ytInitialData missing on trending feed' };

      const parseHumanCount = (s: string): number => {
        if (!s) return 0;
        const m = /([\d.,]+)\s*([KMB]?)/i.exec(s);
        if (!m) return 0;
        const n = parseFloat(m[1].replace(/,/g, '')) || 0;
        const u = (m[2] || '').toUpperCase();
        return Math.round(n * (u === 'K' ? 1e3 : u === 'M' ? 1e6 : u === 'B' ? 1e9 : 1));
      };
      const parseDuration = (s: string): number => {
        if (!s) return 0;
        const parts = s.split(':').map((p) => parseInt(p, 10) || 0);
        if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
        if (parts.length === 2) return parts[0] * 60 + parts[1];
        return parts[0] || 0;
      };

      // Trending now uses richGridRenderer with richItemRenderer / richSectionRenderer.
      // Older shape (shelfRenderer → expandedShelfContentsRenderer → videoRenderer) still
      // appears regionally. Walk both shapes and dedupe by videoId.
      const out: any[] = [];
      const seen = new Set<string>();

      const pushVideoRenderer = (v: any) => {
        if (!v?.videoId || seen.has(v.videoId)) return;
        const thumbs = v.thumbnail?.thumbnails || [];
        const viewText = v.viewCountText?.simpleText || v.shortViewCountText?.simpleText || '';
        const dur = v.lengthText?.simpleText || '';
        seen.add(v.videoId);
        out.push({
          rank: out.length + 1,
          id: v.videoId,
          title: v.title?.runs?.[0]?.text || v.title?.simpleText || '',
          url: 'https://www.youtube.com/watch?v=' + v.videoId,
          channel_id: v.ownerText?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId
            || v.longBylineText?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId
            || v.shortBylineText?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId
            || '',
          channel_title: v.ownerText?.runs?.[0]?.text
            || v.longBylineText?.runs?.[0]?.text
            || v.shortBylineText?.runs?.[0]?.text
            || '',
          description: (v.descriptionSnippet?.runs || []).map((r: any) => r.text || '').join('')
            || (v.detailedMetadataSnippets?.[0]?.snippetText?.runs || []).map((r: any) => r.text || '').join('')
            || '',
          duration: dur,
          duration_seconds: parseDuration(dur),
          view_count_text: viewText,
          view_count: parseHumanCount(viewText),
          published: v.publishedTimeText?.simpleText || '',
          thumbnail: thumbs.length ? thumbs[thumbs.length - 1].url : '',
        });
      };

      const pushLockup = (lvm: any) => {
        if (!lvm || lvm.contentType !== 'LOCKUP_CONTENT_TYPE_VIDEO') return;
        const vid = lvm.contentId;
        if (!vid || seen.has(vid)) return;
        const meta = lvm.metadata?.lockupMetadataViewModel;
        const rows = meta?.metadata?.contentMetadataViewModel?.metadataRows || [];
        const parts = rows.flatMap((row: any) =>
          (row.metadataParts || []).map((p: any) => p.text?.content || '').filter(Boolean),
        );
        const thumbs = lvm.contentImage?.thumbnailViewModel?.image?.sources || [];
        const overlays = lvm.contentImage?.thumbnailViewModel?.overlays || [];
        let dur = '';
        for (const o of overlays) {
          const t = o.thumbnailOverlayBadgeViewModel?.thumbnailBadges?.[0]?.thumbnailBadgeViewModel?.text;
          if (t) { dur = t; break; }
        }
        seen.add(vid);
        out.push({
          rank: out.length + 1,
          id: vid,
          title: meta?.title?.content || '',
          url: 'https://www.youtube.com/watch?v=' + vid,
          channel_id: '',
          channel_title: parts[0] || '',
          description: '',
          duration: dur,
          duration_seconds: parseDuration(dur),
          view_count_text: parts[1] || '',
          view_count: parseHumanCount(parts[1] || ''),
          published: parts[2] || '',
          thumbnail: thumbs.length ? thumbs[thumbs.length - 1].url : '',
        });
      };

      const walk = (node: any): void => {
        if (!node || typeof node !== 'object' || out.length >= lim) return;
        if (Array.isArray(node)) {
          for (const item of node) {
            if (out.length >= lim) return;
            walk(item);
          }
          return;
        }
        if (node.videoRenderer?.videoId) {
          pushVideoRenderer(node.videoRenderer);
        }
        if (node.gridVideoRenderer?.videoId) {
          pushVideoRenderer(node.gridVideoRenderer);
        }
        if (node.lockupViewModel) {
          pushLockup(node.lockupViewModel);
        }
        for (const k of Object.keys(node)) {
          if (out.length >= lim) return;
          walk(node[k]);
        }
      };
      walk(d.contents);
      return out.slice(0, lim);
    } catch (e: any) {
      return { error: e?.message || 'YouTube trending scraper failed' };
    }
  }, [Math.min(limit, 100)]);

  if (data && typeof data === 'object' && !Array.isArray(data) && 'error' in data) {
    throw new Error((data as any).error);
  }
  return (data as YouTubeTrendingVideo[]) || [];
}

// ─── 5. /channel/search ────────────────────────────────────────────

export interface YouTubeChannelSearchResult {
  rank: number;
  id: string;
  title: string;
  url: string;
  channel_id: string;
  channel_title: string;
  duration: string;
  duration_seconds: number;
  view_count: number;
  view_count_text: string;
  published: string;
  thumbnail: string;
  description: string;
}

export async function searchYouTubeChannel(
  channelIdOrHandle: string,
  query: string,
  limit = 20,
): Promise<YouTubeChannelSearchResult[]> {
  const arg = channelIdOrHandle.trim();
  let base: string;
  if (arg.startsWith('@')) base = `https://www.youtube.com/${encodeURIComponent(arg)}`;
  else if (arg.startsWith('UC') && arg.length >= 20) base = `https://www.youtube.com/channel/${encodeURIComponent(arg)}`;
  else base = `https://www.youtube.com/channel/${encodeURIComponent(arg)}`;

  const url = `${base}/search?query=${encodeURIComponent(query)}`;
  const tabId = await getTab(url);
  await new Promise((r) => setTimeout(r, 3000));
  await checkLoginRedirect(tabId, 'YouTube');

  const data = await executeInPage(tabId, (lim: number) => {
    try {
      const d = (window as any).ytInitialData;
      if (!d) return { error: 'ytInitialData missing on channel /search page' };
      const tabs = d.contents?.twoColumnBrowseResultsRenderer?.tabs || [];

      const parseHumanCount = (s: string): number => {
        if (!s) return 0;
        const m = /([\d.,]+)\s*([KMB]?)/i.exec(s);
        if (!m) return 0;
        const n = parseFloat(m[1].replace(/,/g, '')) || 0;
        const u = (m[2] || '').toUpperCase();
        return Math.round(n * (u === 'K' ? 1e3 : u === 'M' ? 1e6 : u === 'B' ? 1e9 : 1));
      };
      const parseDuration = (s: string): number => {
        if (!s) return 0;
        const parts = s.split(':').map((p) => parseInt(p, 10) || 0);
        if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
        if (parts.length === 2) return parts[0] * 60 + parts[1];
        return parts[0] || 0;
      };

      // The search tab is usually the one with expandableTabRenderer or
      // selected:true. Walk all tabs and look for itemSectionRenderer →
      // videoRenderer items.
      const out: any[] = [];
      const walk = (node: any): void => {
        if (!node || typeof node !== 'object' || out.length >= lim) return;
        if (node.videoRenderer?.videoId) {
          const v = node.videoRenderer;
          const thumbs = v.thumbnail?.thumbnails || [];
          const viewText = v.viewCountText?.simpleText || v.shortViewCountText?.simpleText || '';
          const dur = v.lengthText?.simpleText || '';
          out.push({
            rank: out.length + 1,
            id: v.videoId,
            title: v.title?.runs?.[0]?.text || '',
            url: 'https://www.youtube.com/watch?v=' + v.videoId,
            channel_id: v.ownerText?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId || '',
            channel_title: v.ownerText?.runs?.[0]?.text || '',
            duration: dur,
            duration_seconds: parseDuration(dur),
            view_count_text: viewText,
            view_count: parseHumanCount(viewText),
            published: v.publishedTimeText?.simpleText || '',
            thumbnail: thumbs.length ? thumbs[thumbs.length - 1].url : '',
            description: (v.descriptionSnippet?.runs || []).map((r: any) => r.text || '').join('') || '',
          });
          return;
        }
        for (const k of Object.keys(node)) walk(node[k]);
      };
      walk(tabs);
      return out.slice(0, lim);
    } catch (e: any) {
      return { error: e?.message || 'YouTube channel-search scraper failed' };
    }
  }, [Math.min(limit, 50)]);

  if (data && typeof data === 'object' && !Array.isArray(data) && 'error' in data) {
    throw new Error((data as any).error);
  }
  return (data as YouTubeChannelSearchResult[]) || [];
}

// ─── 6. /video/streaming-data ──────────────────────────────────────

export interface YouTubeStreamingFormat {
  itag: number;
  url: string;
  mime_type: string;
  bitrate: number;
  width: number;
  height: number;
  fps: number;
  quality: string;
  quality_label: string;
  audio_quality: string;
  audio_sample_rate: string;
  audio_channels: number;
  approx_duration_ms: string;
  content_length: string;
  signature_cipher: string;
  has_audio: boolean;
  has_video: boolean;
}

export interface YouTubeStreamingData {
  id: string;
  expires_in_seconds: string;
  formats: YouTubeStreamingFormat[];
  adaptive_formats: YouTubeStreamingFormat[];
  hls_manifest_url: string;
  dash_manifest_url: string;
}

export async function getYouTubeStreamingData(videoIdOrUrl: string): Promise<YouTubeStreamingData> {
  const id = parseYouTubeVideoId(videoIdOrUrl);
  const watchUrl = `https://www.youtube.com/watch?v=${id}`;
  const tabId = await getTab(watchUrl);
  await checkLoginRedirect(tabId, 'YouTube');

  // INTERCEPT mode: YouTube strips streaming URLs (.url / signatureCipher /
  // hlsManifestUrl / dashManifestUrl) from the page-load
  // ytInitialPlayerResponse. The real URLs come back inside the
  // POST /youtubei/v1/player response the SPA fires on bootstrap. We inject
  // a fetch override via CDP `Page.addScriptToEvaluateOnNewDocument`
  // (interceptYoutubeApi) so the override is live BEFORE the request fires,
  // then force a fresh navigation so it actually runs against the watch page.
  await interceptYoutubeApi(
    tabId,
    watchUrl,
    { pattern: '/youtubei/v1/player', globalName: '__bnbotYTPlayerFrames' },
    { settleMs: 2500 },
  );

  // Wait for a /player response that carries a real mime ("video/..." or
  // "audio/..."). The earliest responses are stubs (~300 bytes with 2-char
  // placeholder values) that ship before the SPA's player bootstraps;
  // skipping them avoids returning garbage data.
  await waitForCapture(
    tabId,
    '__bnbotYTPlayerFrames',
    `(arr) => arr && arr.some(p => { const m = p && p.streamingData && p.streamingData.adaptiveFormats && p.streamingData.adaptiveFormats[0] && p.streamingData.adaptiveFormats[0].mimeType; return typeof m === 'string' && m.indexOf('/') !== -1; })`,
    18000,
  );

  const data = await executeInPage(tabId, (targetId: string) => {
    try {
      const w = window as any;
      const frames: any[] = w.__bnbotYTPlayerFrames || [];

      // Frame selection: YouTube fires the /player endpoint multiple times
      // during page load — some responses are tiny stubs (~300 bytes with
      // 2-char placeholder strings) that ship before the SPA boots; the
      // real one is large (>40KB) and has a recognizable mime like
      // "video/webm; codecs=...". Pick a frame whose adaptiveFormats[0]
      // .mimeType contains a '/'.
      //
      // Some frames also wrap the real payload inside `playerResponse`
      // (`{ playerResponse: { streamingData, videoDetails, ... } }`), so
      // we normalize via `unwrap` before inspecting.
      const unwrap = (p: any) => (p?.playerResponse?.streamingData ? p.playerResponse : p);
      const hasRealMime = (p: any) => {
        const fmt = unwrap(p)?.streamingData?.adaptiveFormats?.[0];
        return typeof fmt?.mimeType === 'string' && fmt.mimeType.indexOf('/') !== -1;
      };
      const realFrames = frames.filter(hasRealMime).map(unwrap);
      let match =
        realFrames.find((p: any) => p?.videoDetails?.videoId === targetId) ||
        realFrames[0] ||
        frames.map(unwrap).find((p: any) => p?.videoDetails?.videoId === targetId && p?.streamingData) ||
        frames.map(unwrap).find((p: any) => p?.streamingData);

      const mapFormat = (f: any) => ({
        itag: f.itag || 0,
        url: f.url || '',
        mime_type: f.mimeType || '',
        bitrate: f.bitrate || 0,
        width: f.width || 0,
        height: f.height || 0,
        fps: f.fps || 0,
        quality: f.quality || '',
        quality_label: f.qualityLabel || '',
        audio_quality: f.audioQuality || '',
        audio_sample_rate: f.audioSampleRate || '',
        audio_channels: f.audioChannels || 0,
        approx_duration_ms: f.approxDurationMs || '',
        content_length: f.contentLength || '',
        // Some videos return cipher instead of plain url; the buyer can decrypt.
        signature_cipher: f.signatureCipher || f.cipher || '',
        has_audio: Boolean(f.audioQuality || f.audioSampleRate),
        has_video: Boolean(f.width && f.height),
      });

      // Path A: intercepted player response (preferred)
      if (match?.streamingData) {
        const sd = match.streamingData;
        return {
          source: 'intercept',
          id: match.videoDetails?.videoId || targetId || '',
          expires_in_seconds: sd.expiresInSeconds || '',
          formats: (sd.formats || []).map(mapFormat),
          adaptive_formats: (sd.adaptiveFormats || []).map(mapFormat),
          hls_manifest_url: sd.hlsManifestUrl || '',
          dash_manifest_url: sd.dashManifestUrl || '',
        };
      }

      // Path B: fall back to the page-load ytInitialPlayerResponse. Will most
      // likely have empty .url fields (that's why we tried intercept first)
      // but at least gives the buyer the format list.
      const pr = w.ytInitialPlayerResponse;
      if (!pr) return { error: 'ytInitialPlayerResponse missing and /youtubei/v1/player not captured' };
      const sd = pr.streamingData;
      if (!sd) return { error: 'streamingData missing — video may be restricted, private, or DRM-protected' };

      return {
        source: 'fallback',
        id: pr.videoDetails?.videoId || '',
        expires_in_seconds: sd.expiresInSeconds || '',
        formats: (sd.formats || []).map(mapFormat),
        adaptive_formats: (sd.adaptiveFormats || []).map(mapFormat),
        hls_manifest_url: sd.hlsManifestUrl || '',
        dash_manifest_url: sd.dashManifestUrl || '',
      };
    } catch (e: any) {
      return { error: e?.message || 'YouTube streaming-data scraper failed' };
    }
  }, [id]);

  if (data && typeof data === 'object' && 'error' in data) throw new Error((data as any).error);
  // Strip internal 'source' field before returning
  if (data && typeof data === 'object') {
    delete (data as any).source;
  }
  return data as YouTubeStreamingData;
}

// ─── 7. /video/related-contents ────────────────────────────────────

export interface YouTubeRelatedVideo {
  rank: number;
  id: string;
  title: string;
  url: string;
  channel_id: string;
  channel_title: string;
  duration: string;
  duration_seconds: number;
  view_count: number;
  view_count_text: string;
  published: string;
  thumbnail: string;
}

export async function getYouTubeRelatedVideos(videoIdOrUrl: string, limit = 20): Promise<YouTubeRelatedVideo[]> {
  const id = parseYouTubeVideoId(videoIdOrUrl);
  const tabId = await getTab(`https://www.youtube.com/watch?v=${id}`);
  await new Promise((r) => setTimeout(r, 3000));
  await checkLoginRedirect(tabId, 'YouTube');

  const data = await executeInPage(tabId, (lim: number) => {
    try {
      const d = (window as any).ytInitialData;
      if (!d) return { error: 'ytInitialData missing on watch page' };

      // Path drifts: results may live at
      //   secondaryResults.secondaryResults.results[]
      //   secondaryResults.secondaryResults.results[].itemSectionRenderer.contents[]
      //   secondaryResults.results[] (mobile / experiments)
      // Inside, items use compactVideoRenderer (classic) OR lockupViewModel
      // (LOCKUP_CONTENT_TYPE_VIDEO). Walk all shapes and dedupe.
      const secondary =
        d.contents?.twoColumnWatchNextResults?.secondaryResults
        || d.contents?.singleColumnWatchNextResults?.secondaryResults
        || {};

      const parseHumanCount = (s: string): number => {
        if (!s) return 0;
        const m = /([\d.,]+)\s*([KMB]?)/i.exec(s);
        if (!m) return 0;
        const n = parseFloat(m[1].replace(/,/g, '')) || 0;
        const u = (m[2] || '').toUpperCase();
        return Math.round(n * (u === 'K' ? 1e3 : u === 'M' ? 1e6 : u === 'B' ? 1e9 : 1));
      };
      const parseDuration = (s: string): number => {
        if (!s) return 0;
        const parts = s.split(':').map((p) => parseInt(p, 10) || 0);
        if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
        if (parts.length === 2) return parts[0] * 60 + parts[1];
        return parts[0] || 0;
      };

      const out: any[] = [];
      const seen = new Set<string>();

      const pushCompact = (c: any) => {
        if (!c?.videoId || seen.has(c.videoId)) return;
        const thumbs = c.thumbnail?.thumbnails || [];
        const viewText = c.viewCountText?.simpleText || c.shortViewCountText?.simpleText || '';
        const dur = c.lengthText?.simpleText || '';
        seen.add(c.videoId);
        out.push({
          rank: out.length + 1,
          id: c.videoId,
          title: c.title?.simpleText || c.title?.runs?.[0]?.text || '',
          url: 'https://www.youtube.com/watch?v=' + c.videoId,
          channel_id: c.shortBylineText?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId
            || c.longBylineText?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId
            || '',
          channel_title: c.shortBylineText?.runs?.[0]?.text
            || c.longBylineText?.runs?.[0]?.text
            || '',
          duration: dur,
          duration_seconds: parseDuration(dur),
          view_count_text: viewText,
          view_count: parseHumanCount(viewText),
          published: c.publishedTimeText?.simpleText || '',
          thumbnail: thumbs.length ? thumbs[thumbs.length - 1].url : '',
        });
      };

      const pushLockup = (lvm: any) => {
        if (!lvm || lvm.contentType !== 'LOCKUP_CONTENT_TYPE_VIDEO') return;
        const vid = lvm.contentId;
        if (!vid || seen.has(vid)) return;
        const meta = lvm.metadata?.lockupMetadataViewModel;
        const rows = meta?.metadata?.contentMetadataViewModel?.metadataRows || [];
        const parts = rows.flatMap((row: any) =>
          (row.metadataParts || []).map((p: any) => p.text?.content || '').filter(Boolean),
        );
        const thumbs = lvm.contentImage?.thumbnailViewModel?.image?.sources || [];
        const overlays = lvm.contentImage?.thumbnailViewModel?.overlays || [];
        let dur = '';
        for (const o of overlays) {
          const t = o.thumbnailOverlayBadgeViewModel?.thumbnailBadges?.[0]?.thumbnailBadgeViewModel?.text;
          if (t) { dur = t; break; }
        }
        seen.add(vid);
        out.push({
          rank: out.length + 1,
          id: vid,
          title: meta?.title?.content || '',
          url: 'https://www.youtube.com/watch?v=' + vid,
          channel_id: '',
          channel_title: parts[0] || '',
          duration: dur,
          duration_seconds: parseDuration(dur),
          view_count_text: parts[1] || '',
          view_count: parseHumanCount(parts[1] || ''),
          published: parts[2] || '',
          thumbnail: thumbs.length ? thumbs[thumbs.length - 1].url : '',
        });
      };

      const walk = (node: any): void => {
        if (!node || typeof node !== 'object' || out.length >= lim) return;
        if (Array.isArray(node)) {
          for (const item of node) {
            if (out.length >= lim) return;
            walk(item);
          }
          return;
        }
        if (node.compactVideoRenderer) pushCompact(node.compactVideoRenderer);
        if (node.lockupViewModel) pushLockup(node.lockupViewModel);
        for (const k of Object.keys(node)) {
          if (out.length >= lim) return;
          walk(node[k]);
        }
      };
      walk(secondary);
      return out.slice(0, lim);
    } catch (e: any) {
      return { error: e?.message || 'YouTube related-contents scraper failed' };
    }
  }, [Math.min(limit, 50)]);

  if (data && typeof data === 'object' && !Array.isArray(data) && 'error' in data) {
    throw new Error((data as any).error);
  }
  return (data as YouTubeRelatedVideo[]) || [];
}

// ─── 8. /video/comments ────────────────────────────────────────────

export interface YouTubeComment {
  id: string;
  text: string;
  author: string;
  author_channel_id: string;
  author_thumbnail: string;
  published_time: string;
  like_count: number;
  reply_count: number;
  is_pinned: boolean;
  is_hearted: boolean;
}

export async function getYouTubeComments(videoIdOrUrl: string, limit = 50): Promise<YouTubeComment[]> {
  const id = parseYouTubeVideoId(videoIdOrUrl);
  const watchUrl = `https://www.youtube.com/watch?v=${id}`;
  const tabId = await getTab(watchUrl);
  await checkLoginRedirect(tabId, 'YouTube');

  // Comments are NOT in the page-load ytInitialData. The SPA lazy-loads them
  // via POST /youtubei/v1/next when the comments section nears the viewport.
  // We install the fetch override BEFORE navigation so the SPA's bootstrap
  // /next (which also carries related-video data) is captured; the post-load
  // scroll then triggers the comments-specific /next continuation.
  await interceptYoutubeApi(
    tabId,
    watchUrl,
    { pattern: '/youtubei/v1/next', globalName: '__bnbotYTCommentFrames' },
    { settleMs: 3000 },
  );

  // STEP 2: Aggressive scroll to trigger comments lazy-load. Comments are
  // below the player + description, so we need to scroll multiple screens.
  //
  // Important: YouTube uses IntersectionObserver to decide WHEN to fire the
  // /youtubei/v1/next lazy-load. A minimized scraper window has no
  // viewport, so observer callbacks never fire and our scrolls become
  // no-ops. We temporarily restore the window for the duration of the
  // scrape, then minimize it again on the way out.
  let prevWindowState: chrome.windows.windowStateEnum | undefined;
  let scraperWindowId: number | undefined;
  try {
    const tab = await chrome.tabs.get(tabId);
    scraperWindowId = tab.windowId;
    if (scraperWindowId != null) {
      const win = await chrome.windows.get(scraperWindowId);
      prevWindowState = win.state;
      if (win.state === 'minimized') {
        await chrome.windows.update(scraperWindowId, { state: 'normal' });
        await new Promise((r) => setTimeout(r, 800));
      }
    }
  } catch { /* tolerate */ }

  await executeInPage(tabId, async (target: number) => {
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const w = window as any;

    const countCaptured = () => {
      let captured = 0;
      const frames = w.__bnbotYTCommentFrames || [];
      const stack: any[] = [...frames];
      while (stack.length) {
        const n = stack.pop();
        if (!n || typeof n !== 'object') continue;
        if (Array.isArray(n)) { for (const x of n) stack.push(x); continue; }
        if (n.commentEntityPayload) captured += 1;
        if (n.commentThreadRenderer) captured += 1;
        for (const k of Object.keys(n)) stack.push(n[k]);
      }
      return captured;
    };

    // First — slam-scroll to bottom several times to force YouTube to
    // initiate the comments lazy-load even if the player is still buffering.
    for (let i = 0; i < 6; i++) {
      window.scrollTo(0, document.body.scrollHeight);
      await sleep(800);
    }

    // Try to scroll the #comments header into view explicitly — some
    // viewports park us past it.
    const commentsHeader = document.querySelector('#comments #title h2, #comments #count, #comments');
    if (commentsHeader) {
      (commentsHeader as HTMLElement).scrollIntoView({ block: 'start' });
      await sleep(1500);
    }

    // Now scroll progressively to hydrate more comments + replies.
    let lastCount = 0;
    let stable = 0;
    for (let i = 0; i < 20; i++) {
      const root = document.querySelector('#comments');
      if (root) (root as HTMLElement).scrollIntoView({ block: 'start' });
      window.scrollBy(0, 1500);
      await sleep(700);

      const captured = countCaptured();
      const threadsDom = document.querySelectorAll('ytd-comment-thread-renderer').length;
      const tally = Math.max(captured, threadsDom);

      if (tally >= target) break;
      if (tally === lastCount) {
        stable += 1;
        if (stable >= 4) break;
      } else {
        stable = 0;
        lastCount = tally;
      }
    }
    return true;
  }, [limit]);

  // Restore the scraper window's previous minimized state — we only
  // unminimized it to let IntersectionObserver tick.
  if (scraperWindowId != null && prevWindowState === 'minimized') {
    try { await chrome.windows.update(scraperWindowId, { state: 'minimized' }); } catch { /* ignore */ }
  }

  // STEP 3: Extract from captured frames first (cleaner data), fall back to DOM.
  const data = await executeInPage(tabId, (lim: number) => {
    try {
      const w = window as any;

      const parseHumanCount = (s: string): number => {
        if (!s) return 0;
        const m = /([\d.,]+)\s*([KMB]?)/i.exec(s);
        if (!m) return 0;
        const n = parseFloat(m[1].replace(/,/g, '')) || 0;
        const u = (m[2] || '').toUpperCase();
        return Math.round(n * (u === 'K' ? 1e3 : u === 'M' ? 1e6 : u === 'B' ? 1e9 : 1));
      };

      const runsText = (node: any): string => {
        if (!node) return '';
        if (node.simpleText) return String(node.simpleText);
        if (Array.isArray(node.runs)) return node.runs.map((r: any) => r.text || '').join('');
        if (typeof node === 'string') return node;
        if (node.content) return String(node.content);
        return '';
      };

      // Collect commentRenderer + commentEntityPayload (new layout) from captured frames.
      const out: any[] = [];
      const seen = new Set<string>();
      const frames: any[] = w.__bnbotYTCommentFrames || [];

      // The new YouTubei layout stores comment data in two parallel records:
      //   frameworkUpdates.entityBatchUpdate.mutations[].payload.commentEntityPayload
      //   frameworkUpdates.entityBatchUpdate.mutations[].payload.engagementToolbarStateEntityPayload
      // commentThreadRenderer references them by entityKey. We index payloads by key
      // and then iterate threads in document order.
      const entityById: Record<string, any> = {};
      const toolbarById: Record<string, any> = {};
      const threadsList: any[] = [];

      const collectEntities = (node: any) => {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) { for (const x of node) collectEntities(x); return; }
        if (node.commentEntityPayload && node.commentEntityPayload.key) {
          entityById[node.commentEntityPayload.key] = node.commentEntityPayload;
        }
        if (node.engagementToolbarStateEntityPayload && node.engagementToolbarStateEntityPayload.key) {
          toolbarById[node.engagementToolbarStateEntityPayload.key] = node.engagementToolbarStateEntityPayload;
        }
        if (node.commentThreadRenderer) threadsList.push(node.commentThreadRenderer);
        for (const k of Object.keys(node)) collectEntities(node[k]);
      };
      for (const f of frames) collectEntities(f);

      // --- A. Process commentThreadRenderer items via entityPayload (new layout) ---
      for (const t of threadsList) {
        if (out.length >= lim) break;
        const cvm = t.commentViewModel?.commentViewModel;
        const ctr = t.comment?.commentRenderer;

        if (cvm) {
          const key = cvm.commentKey || cvm.commentId;
          const payload = entityById[key] || {};
          const cid = payload.commentId || cvm.commentId || key || '';
          if (cid && seen.has(cid)) continue;
          const text = runsText(payload.properties?.content);
          const author = payload.author?.displayName || '';
          const authorChannelId = payload.author?.channelId || '';
          const thumbs = payload.author?.avatarThumbnailUrl
            ? [{ url: payload.author.avatarThumbnailUrl }]
            : (payload.author?.avatar?.image?.sources || []);
          const authorThumb = thumbs.length ? (thumbs[thumbs.length - 1].url || '') : '';
          const publishedTime = payload.properties?.publishedTime || '';
          const likeText = payload.toolbar?.likeCountNotliked
            || payload.toolbar?.likeCountLiked
            || payload.toolbar?.likeCountA11y
            || '';
          const replyText = payload.toolbar?.replyCount || '';
          const isHearted = !!toolbarById[cvm.toolbarStateKey]?.heartState
            && toolbarById[cvm.toolbarStateKey].heartState !== 'TOOLBAR_HEART_STATE_UNHEARTED';
          const isPinned = !!cvm.pinnedText;
          if (!text && !author) continue;
          seen.add(cid);
          out.push({
            id: cid,
            text,
            author,
            author_channel_id: authorChannelId,
            author_thumbnail: authorThumb,
            published_time: publishedTime,
            like_count: parseHumanCount(String(likeText)),
            reply_count: parseHumanCount(String(replyText)),
            is_pinned: isPinned,
            is_hearted: isHearted,
          });
          continue;
        }

        if (ctr) {
          const cid = ctr.commentId || '';
          if (cid && seen.has(cid)) continue;
          const text = runsText(ctr.contentText);
          const author = runsText(ctr.authorText);
          const authorChannelId = ctr.authorEndpoint?.browseEndpoint?.browseId || '';
          const thumbs = ctr.authorThumbnail?.thumbnails || [];
          const authorThumb = thumbs.length ? thumbs[thumbs.length - 1].url : '';
          const publishedTime = runsText(ctr.publishedTimeText);
          const likeText = ctr.voteCount?.simpleText
            || ctr.voteCount?.accessibility?.accessibilityData?.label
            || '';
          const replyCount = ctr.replyCount || 0;
          const isPinned = !!ctr.pinnedCommentBadge;
          const isHearted = !!ctr.actionButtons?.commentActionButtonsRenderer?.creatorHeart;
          if (!text && !author) continue;
          if (cid) seen.add(cid);
          out.push({
            id: cid,
            text,
            author,
            author_channel_id: authorChannelId,
            author_thumbnail: authorThumb,
            published_time: publishedTime,
            like_count: parseHumanCount(String(likeText)),
            reply_count: Number(replyCount) || 0,
            is_pinned: isPinned,
            is_hearted: isHearted,
          });
        }
      }

      // --- B. DOM fallback: pick up anything the interceptor missed ---
      if (out.length < lim) {
        const getText = (el: Element | null) => (el?.textContent || '').replace(/\s+/g, ' ').trim();
        const threads = document.querySelectorAll('ytd-comment-thread-renderer');
        for (let i = 0; i < threads.length && out.length < lim; i++) {
          const tEl = threads[i] as any;
          const view =
            tEl.querySelector('ytd-comment-view-model') ||
            tEl.querySelector('ytd-comment-renderer') ||
            tEl;
          const d = view.__data?.data || view.data || {};

          const cid = d.commentId || view.getAttribute?.('id') || '';
          if (cid && seen.has(cid)) continue;
          const text = d.contentText?.simpleText
            || (d.contentText?.runs || []).map((r: any) => r.text || '').join('')
            || getText(view.querySelector('#content-text')) || '';
          const author = d.authorText?.simpleText
            || getText(view.querySelector('#author-text')) || '';
          if (!text && !author) continue;
          const authorChannelId = d.authorEndpoint?.browseEndpoint?.browseId
            || (view.querySelector('#author-text') as HTMLAnchorElement | null)?.href?.match(/channel\/([^/?#]+)/)?.[1]
            || '';
          const dthumbs = d.authorThumbnail?.thumbnails || [];
          const authorThumb = dthumbs.length
            ? dthumbs[dthumbs.length - 1].url
            : (view.querySelector('#author-thumbnail img') as HTMLImageElement | null)?.src || '';
          const publishedTime = d.publishedTimeText?.runs?.[0]?.text
            || getText(view.querySelector('.published-time-text')) || '';
          const likeText = d.voteCount?.simpleText
            || d.voteCount?.accessibility?.accessibilityData?.label
            || getText(view.querySelector('#vote-count-middle')) || '';
          const replyText = getText(view.querySelector('#replies #more-text'))
            || (d.replyCount ? String(d.replyCount) : '');
          const isPinned = Boolean(d.pinnedCommentBadge) || Boolean(view.querySelector('#pinned-comment-badge'));
          const isHearted = Boolean(d.actionButtons?.commentActionButtonsRenderer?.creatorHeart)
            || Boolean(view.querySelector('#creator-heart'));
          if (cid) seen.add(cid);
          out.push({
            id: cid,
            text,
            author,
            author_channel_id: authorChannelId,
            author_thumbnail: authorThumb,
            published_time: publishedTime,
            like_count: parseHumanCount(String(likeText)),
            reply_count: parseHumanCount(replyText),
            is_pinned: isPinned,
            is_hearted: isHearted,
          });
        }
      }

      if (!out.length) {
        const root = document.querySelector('#comments');
        const framesCount = (w.__bnbotYTCommentFrames || []).length;
        if (!root) {
          return { error: 'comments_unavailable: comments container not found — video may have comments disabled' };
        }
        if (framesCount === 0) {
          return { error: 'comments_unavailable: /youtubei/v1/next never fired — page may be unreachable or YT pushed a new API path' };
        }
        return { error: 'comments_unavailable: ' + framesCount + ' frames captured but no commentEntityPayload — comments may be disabled or YT changed the schema' };
      }
      return out.slice(0, lim);
    } catch (e: any) {
      return { error: e?.message || 'YouTube comments scraper failed' };
    }
  }, [Math.min(limit, 100)]);

  if (data && typeof data === 'object' && !Array.isArray(data) && 'error' in data) {
    throw new Error((data as any).error);
  }
  return (data as YouTubeComment[]) || [];
}

// ─── 9. /video/transcript ──────────────────────────────────────────

export interface YouTubeTranscriptLine {
  start: number;
  duration: number;
  text: string;
}

export interface YouTubeTranscript {
  id: string;
  language: string;
  language_code: string;
  is_translatable: boolean;
  lines: YouTubeTranscriptLine[];
}

export async function getYouTubeTranscript(
  videoIdOrUrl: string,
  options: { lang?: string } = {},
): Promise<YouTubeTranscript> {
  const id = parseYouTubeVideoId(videoIdOrUrl);
  const watchUrl = `https://www.youtube.com/watch?v=${id}`;
  const tabId = await getTab(watchUrl);
  await checkLoginRedirect(tabId, 'YouTube');

  // INTERCEPT mode: the legacy /api/timedtext URL embedded in
  // ytInitialPlayerResponse now requires a `pot` proof-of-token signature
  // tied to the player session, so cross-context fetches come back empty.
  // The modern alternative is POST /youtubei/v1/get_transcript, fired by
  // the SPA when the "Show transcript" button is clicked. We register the
  // fetch override on the debugger session (so it survives navigation),
  // then drive the click after the page loads. Falls back to /timedtext
  // if no transcript button is exposed.
  await interceptYoutubeApi(
    tabId,
    watchUrl,
    { pattern: '/youtubei/v1/get_transcript', globalName: '__bnbotYTTranscriptFrames' },
    { settleMs: 3000 },
  );
  // Drop any frames that may have somehow leaked across a tab reuse — we
  // want only the response that comes back from OUR click.
  await resetCaptureArray(tabId, '__bnbotYTTranscriptFrames');

  // Restore the window so YouTube actually mounts the description /
  // metadata UI (it skips heavy DOM work on minimized tabs). We'll
  // re-minimize at the end.
  let prevWindowState: chrome.windows.windowStateEnum | undefined;
  let scraperWindowId: number | undefined;
  try {
    const tab = await chrome.tabs.get(tabId);
    scraperWindowId = tab.windowId;
    if (scraperWindowId != null) {
      const win = await chrome.windows.get(scraperWindowId);
      prevWindowState = win.state;
      if (win.state === 'minimized') {
        await chrome.windows.update(scraperWindowId, { state: 'normal' });
        await new Promise((r) => setTimeout(r, 800));
      }
    }
  } catch { /* tolerate */ }

  // STEP 2: trigger /youtubei/v1/get_transcript by clicking the
  // "Show transcript" button. Modern YouTube hides this button behind
  // the description-expander, so we expand description first, then
  // search the entire DOM (button, ytd-button-renderer, link, span) for
  // any element whose text or aria-label includes "transcript". As a
  // last resort we open the "..." menu under the title.
  await executeInPage(tabId, async () => {
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    const isVisible = (el: Element) => {
      const r = (el as HTMLElement).getBoundingClientRect?.();
      return !!r && r.width > 0 && r.height > 0;
    };

    // Scroll description area into view so its DOM mounts.
    const meta = document.querySelector('ytd-watch-metadata, #above-the-fold');
    if (meta) (meta as HTMLElement).scrollIntoView({ block: 'start' });
    await sleep(400);

    // Expand description so the "Show transcript" pill renders (it lives
    // inside the expanded description for most layouts in 2026).
    const expandSelectors = [
      'tp-yt-paper-button#expand',
      'ytd-text-inline-expander #expand',
      'ytd-watch-metadata #description-inner #expand',
      'ytd-watch-metadata tp-yt-paper-button#expand',
      '#expand[role="button"]',
    ];
    for (const sel of expandSelectors) {
      const el = document.querySelector(sel) as HTMLElement | null;
      if (el && isVisible(el)) { el.click(); break; }
    }
    await sleep(700);

    // Approach 1: any element whose text / aria-label looks like a
    // transcript trigger. We accept buttons, anchor tags, and yt's
    // custom <ytd-button-renderer> wrappers. Walk the description region
    // first (most specific), then fall back to a global scan.
    const transcriptRe = /show\s*transcript|transcript|显示文字|字幕|文字记录/i;
    const candidateRoots = [
      document.querySelector('ytd-video-description-transcript-section-renderer'),
      document.querySelector('ytd-watch-metadata'),
      document.body,
    ].filter(Boolean) as Element[];

    for (const root of candidateRoots) {
      const candidates = Array.from(root.querySelectorAll(
        'button, ytd-button-renderer, yt-button-shape, a[role="button"], yt-formatted-string, span',
      )) as HTMLElement[];
      for (const c of candidates) {
        const txt = (c.textContent || '').trim();
        const aria = c.getAttribute('aria-label') || '';
        if (!transcriptRe.test(txt) && !transcriptRe.test(aria)) continue;
        if (!isVisible(c)) continue;
        // Walk up to the nearest clickable ancestor (button) for reliable click.
        let clickTarget: HTMLElement = c;
        const clickable = c.closest('button, [role="button"], ytd-button-renderer, a') as HTMLElement | null;
        if (clickable) clickTarget = clickable;
        clickTarget.click();
        await sleep(1200);
        return true;
      }
    }

    // Approach 2: open the "..." menu and look for a transcript item.
    const moreSelectors = [
      'ytd-watch-metadata #button-shape button',
      'ytd-menu-renderer.ytd-watch-metadata yt-icon-button button',
      'button[aria-label="More actions"]',
      'button[aria-label*="More actions" i]',
    ];
    let moreBtn: HTMLElement | null = null;
    for (const sel of moreSelectors) {
      const el = document.querySelector(sel) as HTMLElement | null;
      if (el && isVisible(el)) { moreBtn = el; break; }
    }
    if (moreBtn) {
      moreBtn.click();
      await sleep(600);
      const menuItems = Array.from(document.querySelectorAll(
        'ytd-menu-service-item-renderer, tp-yt-paper-item, yt-dropdown-menu tp-yt-paper-item, [role="menuitem"]',
      )) as HTMLElement[];
      const item = menuItems.find((el) => transcriptRe.test(el.textContent || ''));
      if (item) {
        item.click();
        await sleep(1200);
        return true;
      }
      // Dismiss menu if no match.
      document.body.click();
    }
    return false;
  });

  // STEP 3: wait for capture
  await executeInPage(tabId, async () => {
    const w = window as any;
    const start = Date.now();
    while (Date.now() - start < 10000) {
      if ((w.__bnbotYTTranscriptFrames || []).length > 0) return true;
      await new Promise((r) => setTimeout(r, 300));
    }
    return false;
  });

  const data = await executeInPage(tabId, async (preferLang: string) => {
    try {
      const w = window as any;
      const pr = w.ytInitialPlayerResponse;
      const frames: any[] = w.__bnbotYTTranscriptFrames || [];

      // PATH A: parse intercepted get_transcript response
      if (frames.length > 0) {
        // Walk the response and collect transcriptSegmentRenderer / cueGroups.
        // YouTube has shipped both shapes in different rollouts:
        //   actions[].updateEngagementPanelAction.content.transcriptRenderer
        //     .content.transcriptSearchPanelRenderer.body.transcriptSegmentListRenderer
        //     .initialSegments[].transcriptSegmentRenderer
        //       { startMs, endMs, startTimeText, snippet: { runs } }
        //   actions[].updateEngagementPanelAction.content.transcriptRenderer.body
        //     .transcriptBodyRenderer.cueGroups[].transcriptCueGroupRenderer
        //     .cues[0].transcriptCueRenderer { startOffsetMs, durationMs, cue: { simpleText } }
        const lines: any[] = [];
        const runsText = (n: any): string => {
          if (!n) return '';
          if (n.simpleText) return String(n.simpleText);
          if (Array.isArray(n.runs)) return n.runs.map((r: any) => r.text || '').join('');
          return '';
        };

        const walk = (node: any): void => {
          if (!node || typeof node !== 'object') return;
          if (Array.isArray(node)) { for (const x of node) walk(x); return; }
          if (node.transcriptSegmentRenderer) {
            const seg = node.transcriptSegmentRenderer;
            const start = parseFloat(seg.startMs || '0') / 1000;
            const end = parseFloat(seg.endMs || '0') / 1000;
            const text = runsText(seg.snippet).replace(/\s+/g, ' ').trim();
            if (text) lines.push({ start, duration: Math.max(0, end - start), text });
            return;
          }
          if (node.transcriptCueRenderer) {
            const cue = node.transcriptCueRenderer;
            const start = parseFloat(cue.startOffsetMs || '0') / 1000;
            const duration = parseFloat(cue.durationMs || '0') / 1000;
            const text = runsText(cue.cue).replace(/\s+/g, ' ').trim();
            if (text) lines.push({ start, duration, text });
            return;
          }
          for (const k of Object.keys(node)) walk(node[k]);
        };
        for (const f of frames) walk(f);

        if (lines.length) {
          // Dig out language metadata if available. The footer often has it.
          let language = '';
          let languageCode = preferLang || '';
          const findLangMenu = (node: any): void => {
            if (!node || typeof node !== 'object' || language) return;
            if (Array.isArray(node)) { for (const x of node) findLangMenu(x); return; }
            if (node.languageMenu?.sortFilterSubMenuRenderer) {
              const sel = (node.languageMenu.sortFilterSubMenuRenderer.subMenuItems || [])
                .find((it: any) => it.selected);
              if (sel) {
                language = sel.title || language;
              }
            }
            for (const k of Object.keys(node)) findLangMenu(node[k]);
          };
          for (const f of frames) findLangMenu(f);

          // Best-effort language code from playerCaptionsTracklistRenderer
          if (pr && !languageCode) {
            const tracks = pr.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
            const en = tracks.find((t: any) => (t.languageCode || '').startsWith('en')) || tracks[0];
            languageCode = en?.languageCode || '';
            if (!language) language = en?.name?.simpleText || en?.name?.runs?.[0]?.text || '';
          }

          return {
            id: pr?.videoDetails?.videoId || '',
            language,
            language_code: languageCode,
            is_translatable: false,
            lines,
          };
        }
      }

      // PATH B: legacy timedtext fallback (kept as Plan B)
      if (!pr) return { error: 'ytInitialPlayerResponse missing and get_transcript not captured' };
      const tracks = pr.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
      if (!tracks.length) return { error: 'no captions available — video may not have a transcript' };

      let track = null as any;
      if (preferLang) {
        track = tracks.find((t: any) => (t.languageCode || '').toLowerCase().startsWith(preferLang.toLowerCase()));
      }
      if (!track) track = tracks.find((t: any) => (t.languageCode || '').toLowerCase().startsWith('en'));
      if (!track) track = tracks[0];
      if (!track?.baseUrl) return { error: 'no caption baseUrl' };

      const lines: any[] = [];
      const decodeEntities = (s: string) =>
        s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
          .replace(/&#(\d+);/g, (_: string, n: string) => String.fromCharCode(parseInt(n, 10)));

      const ensureFmt = (u: string, fmt: string): string => {
        try {
          const url = new URL(u, location.origin);
          url.searchParams.set('fmt', fmt);
          return url.toString();
        } catch {
          return u + (u.includes('?') ? '&' : '?') + 'fmt=' + fmt;
        }
      };

      const jsonUrl = ensureFmt(track.baseUrl, 'json3');
      let usedJson = false;
      try {
        const res = await fetch(jsonUrl, { credentials: 'include' });
        if (res.ok) {
          const body = await res.json();
          const events = body?.events || [];
          for (const ev of events) {
            if (!ev || !Array.isArray(ev.segs)) continue;
            const text = ev.segs.map((s: any) => s.utf8 || '').join('').replace(/\s+/g, ' ').trim();
            if (!text) continue;
            const start = (ev.tStartMs || 0) / 1000;
            const duration = (ev.dDurationMs || 0) / 1000;
            lines.push({ start, duration, text });
          }
          usedJson = lines.length > 0;
        }
      } catch { /* fall through to XML */ }

      if (!usedJson) {
        const xmlRes = await fetch(track.baseUrl, { credentials: 'include' });
        if (!xmlRes.ok) return { error: 'Caption fetch failed: HTTP ' + xmlRes.status };
        const xml = await xmlRes.text();

        const reText = /<text\s+([^>]*)>([\s\S]*?)<\/text>/g;
        let m: RegExpExecArray | null;
        while ((m = reText.exec(xml)) !== null) {
          const attrs = m[1];
          const inner = m[2];
          const startMatch = /start="([^"]+)"/.exec(attrs);
          const durMatch = /dur="([^"]+)"/.exec(attrs);
          const start = startMatch ? parseFloat(startMatch[1]) : 0;
          const duration = durMatch ? parseFloat(durMatch[1]) : 0;
          const text = decodeEntities(inner.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
          if (!text) continue;
          lines.push({ start, duration, text });
        }

        if (!lines.length) {
          const reP = /<p\s+([^>]*)>([\s\S]*?)<\/p>/g;
          while ((m = reP.exec(xml)) !== null) {
            const attrs = m[1];
            const inner = m[2];
            const tMatch = /\bt="([^"]+)"/.exec(attrs);
            const dMatch = /\bd="([^"]+)"/.exec(attrs);
            const start = tMatch ? parseFloat(tMatch[1]) / 1000 : 0;
            const duration = dMatch ? parseFloat(dMatch[1]) / 1000 : 0;
            const text = decodeEntities(inner.replace(/<[^>]+>/g, ' '))
              .replace(/\s+/g, ' ').trim();
            if (!text) continue;
            lines.push({ start, duration, text });
          }
        }
      }

      return {
        id: pr.videoDetails?.videoId || '',
        language: track.name?.simpleText || track.name?.runs?.[0]?.text || '',
        language_code: track.languageCode || '',
        is_translatable: Boolean(track.isTranslatable),
        lines,
      };
    } catch (e: any) {
      return { error: e?.message || 'YouTube transcript scraper failed' };
    }
  }, [options.lang || '']);

  // Restore minimized state.
  if (scraperWindowId != null && prevWindowState === 'minimized') {
    try { await chrome.windows.update(scraperWindowId, { state: 'minimized' }); } catch { /* ignore */ }
  }

  if (data && typeof data === 'object' && 'error' in data) throw new Error((data as any).error);
  return data as YouTubeTranscript;
}
