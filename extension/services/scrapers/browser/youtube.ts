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
  const targetId = await ensureDebuggerAttached(tabId, ['Page', 'Runtime']);
  // NOTE: do NOT touch Network.setBypassServiceWorker or
  // Network.setUserAgentOverride. Both look harmless but in practice
  // push YouTube onto its "SSR-only lightweight HTML" codepath where
  // the SPA never hydrates and never fires /youtubei/v1/*, leaving our
  // capture array empty. The page-level visibility shim + the hook
  // injected via Page.addScriptToEvaluateOnNewDocument is enough.
  const pat = spec.pattern.replace(/[\\'"`]/g, '');
  const gname = spec.globalName.replace(/[^A-Za-z0-9_$]/g, '');
  // The hook is self-guarding (`if (window.${gname}) return`) so duplicate
  // installations across calls are a no-op. We do reset the capture
  // array on every call so different videoIds don't bleed into each other.
  const source = `
    (function(){
      try {
        var w = window;
        w.${gname} = [];
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
              r.clone().json().then(function(b){ w.${gname}.push(b); }).catch(function(){});
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

/**
 * Stub fallback for video streaming-data.
 *
 * The primary implementation lives in clawmoney-cli's youtube skill
 * (`video-streaming.ts`), which shells out to yt-dlp. yt-dlp carries
 * the YouTube JS-challenge solver and PO-token machinery that the
 * extension can't reproduce; YouTube reliably returns *stub* responses
 * to /youtubei/v1/player when chrome.debugger is attached, so any
 * INTERCEPT effort here returns garbage data anyway.
 *
 * This stub is only reached when clawmoney-cli detects yt-dlp is
 * missing on the host. It returns format *metadata* harvested from
 * the inline ytInitialPlayerResponse — itag / mime / dimensions are
 * accurate, but `url` will be empty (YouTube strips it). That's
 * enough for callers who just want format inventory; for actual
 * download URLs the host needs to install yt-dlp.
 */
export async function getYouTubeStreamingData(videoIdOrUrl: string): Promise<YouTubeStreamingData> {
  const id = parseYouTubeVideoId(videoIdOrUrl);
  const tabId = await getTab(`https://www.youtube.com/watch?v=${id}`);
  await new Promise((r) => setTimeout(r, 1500));
  await checkLoginRedirect(tabId, 'YouTube');

  const data = await executeInPage(tabId, () => {
    try {
      const pr = (window as any).ytInitialPlayerResponse;
      if (!pr) return { error: 'ytInitialPlayerResponse missing — page failed to load' };
      const sd = pr.streamingData;
      if (!sd) return { error: 'streamingData missing — video may be restricted, private, or DRM-protected' };

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
        signature_cipher: f.signatureCipher || f.cipher || '',
        has_audio: Boolean(f.audioQuality || f.audioSampleRate),
        has_video: Boolean(f.width && f.height),
      });

      return {
        id: pr.videoDetails?.videoId || '',
        expires_in_seconds: sd.expiresInSeconds || '',
        formats: (sd.formats || []).map(mapFormat),
        adaptive_formats: (sd.adaptiveFormats || []).map(mapFormat),
        hls_manifest_url: sd.hlsManifestUrl || '',
        dash_manifest_url: sd.dashManifestUrl || '',
      };
    } catch (e: any) {
      return { error: e?.message || 'YouTube streaming-data fallback failed' };
    }
  });

  if (data && typeof data === 'object' && 'error' in data) throw new Error((data as any).error);
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

/**
 * Stub fallback for video transcript.
 *
 * Primary implementation is yt-dlp in clawmoney-cli — see
 * `video-transcript.ts`. YouTube's transcript endpoints (both
 * /youtubei/v1/get_transcript and the legacy /api/timedtext baseUrl)
 * now refuse to return data to anything without a valid pot/PO token,
 * which we can't generate inside the page. yt-dlp ships the JS
 * challenge solver and PO token machinery.
 *
 * This stub is only reached when clawmoney-cli detects yt-dlp is
 * missing on the host. It just returns the caption-track inventory
 * from ytInitialPlayerResponse so the buyer at least knows which
 * languages exist (`lines` will be empty until yt-dlp is installed).
 */
export async function getYouTubeTranscript(
  videoIdOrUrl: string,
  options: { lang?: string } = {},
): Promise<YouTubeTranscript> {
  const id = parseYouTubeVideoId(videoIdOrUrl);
  const tabId = await getTab(`https://www.youtube.com/watch?v=${id}`);
  await new Promise((r) => setTimeout(r, 1500));
  await checkLoginRedirect(tabId, 'YouTube');

  const data = await executeInPage(tabId, (preferLang: string) => {
    try {
      const pr = (window as any).ytInitialPlayerResponse;
      if (!pr) return { error: 'ytInitialPlayerResponse missing — page failed to load' };
      const tracks = pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
      if (!tracks.length) {
        return { error: 'no transcript available — video has no captions (install yt-dlp on this host for richer fallback)' };
      }
      let track = null as any;
      if (preferLang) track = tracks.find((t: any) => (t.languageCode || '').toLowerCase().startsWith(preferLang.toLowerCase()));
      if (!track) track = tracks.find((t: any) => (t.languageCode || '').toLowerCase().startsWith('en'));
      if (!track) track = tracks[0];
      return {
        id: pr.videoDetails?.videoId || '',
        language: track?.name?.simpleText || track?.name?.runs?.[0]?.text || '',
        language_code: track?.languageCode || (preferLang || ''),
        is_translatable: Boolean(track?.isTranslatable),
        // No `lines` — see function docstring. Install yt-dlp.
        lines: [],
      };
    } catch (e: any) {
      return { error: e?.message || 'YouTube transcript fallback failed' };
    }
  }, [options.lang || '']);

  if (data && typeof data === 'object' && 'error' in data) throw new Error((data as any).error);
  return data as YouTubeTranscript;
}

