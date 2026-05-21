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

import { getTab, checkLoginRedirect, executeInPage } from '../../scraperService';

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
      const tabs = d.contents?.twoColumnBrowseResultsRenderer?.tabs || [];
      const sectionContents = tabs[0]?.tabRenderer?.content?.sectionListRenderer?.contents || [];
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

      for (const section of sectionContents) {
        if (out.length >= lim) break;
        const items = section.itemSectionRenderer?.contents || [];
        for (const it of items) {
          if (out.length >= lim) break;
          // shelfRenderer holds the actual list
          const shelf = it.shelfRenderer;
          const expandedItems =
            shelf?.content?.expandedShelfContentsRenderer?.items
            || shelf?.content?.horizontalListRenderer?.items
            || [it]; // sometimes videoRenderer is the direct child
          for (const ex of expandedItems) {
            if (out.length >= lim) break;
            const v = ex.videoRenderer;
            if (!v?.videoId) continue;
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
              description: (v.descriptionSnippet?.runs || []).map((r: any) => r.text || '').join('') || '',
              duration: dur,
              duration_seconds: parseDuration(dur),
              view_count_text: viewText,
              view_count: parseHumanCount(viewText),
              published: v.publishedTimeText?.simpleText || '',
              thumbnail: thumbs.length ? thumbs[thumbs.length - 1].url : '',
            });
          }
        }
      }
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
  const tabId = await getTab(`https://www.youtube.com/watch?v=${id}`);
  await new Promise((r) => setTimeout(r, 3000));
  await checkLoginRedirect(tabId, 'YouTube');

  const data = await executeInPage(tabId, () => {
    try {
      const pr = (window as any).ytInitialPlayerResponse;
      if (!pr) return { error: 'ytInitialPlayerResponse missing' };
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
      return { error: e?.message || 'YouTube streaming-data scraper failed' };
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
      const results =
        d.contents?.twoColumnWatchNextResults?.secondaryResults?.secondaryResults?.results || [];

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
      for (const r of results) {
        if (out.length >= lim) break;

        // Classic layout
        const c = r.compactVideoRenderer;
        if (c?.videoId) {
          const thumbs = c.thumbnail?.thumbnails || [];
          const viewText = c.viewCountText?.simpleText || c.shortViewCountText?.simpleText || '';
          const dur = c.lengthText?.simpleText || '';
          out.push({
            rank: out.length + 1,
            id: c.videoId,
            title: c.title?.simpleText || c.title?.runs?.[0]?.text || '',
            url: 'https://www.youtube.com/watch?v=' + c.videoId,
            channel_id: c.shortBylineText?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId || '',
            channel_title: c.shortBylineText?.runs?.[0]?.text || c.longBylineText?.runs?.[0]?.text || '',
            duration: dur,
            duration_seconds: parseDuration(dur),
            view_count_text: viewText,
            view_count: parseHumanCount(viewText),
            published: c.publishedTimeText?.simpleText || '',
            thumbnail: thumbs.length ? thumbs[thumbs.length - 1].url : '',
          });
          continue;
        }

        // Newer lockupViewModel layout
        const lvm = r.lockupViewModel;
        if (lvm && lvm.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO') {
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
          out.push({
            rank: out.length + 1,
            id: lvm.contentId,
            title: meta?.title?.content || '',
            url: 'https://www.youtube.com/watch?v=' + lvm.contentId,
            channel_id: '',
            channel_title: parts[0] || '',
            duration: dur,
            duration_seconds: parseDuration(dur),
            view_count_text: parts[1] || '',
            view_count: parseHumanCount(parts[1] || ''),
            published: parts[2] || '',
            thumbnail: thumbs.length ? thumbs[thumbs.length - 1].url : '',
          });
        }
      }
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
  const tabId = await getTab(`https://www.youtube.com/watch?v=${id}`);
  await new Promise((r) => setTimeout(r, 3000));
  await checkLoginRedirect(tabId, 'YouTube');

  // Scroll until comments hydrate. Comments live below the player and are
  // lazy-loaded — without a scroll the comments tree never renders.
  await executeInPage(tabId, async (target: number) => {
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    let lastCount = 0;
    let stable = 0;
    for (let i = 0; i < 12; i++) {
      // Comments live in #comments — once present, scroll it into view.
      const root = document.querySelector('#comments');
      if (root) (root as HTMLElement).scrollIntoView({ block: 'start' });
      window.scrollBy(0, 1200);
      await sleep(700);
      const threads = document.querySelectorAll('ytd-comment-thread-renderer').length;
      if (threads >= target) break;
      if (threads === lastCount) {
        stable += 1;
        if (stable >= 3) break;
      } else {
        stable = 0;
        lastCount = threads;
      }
    }
    return true;
  }, [limit]);

  const data = await executeInPage(tabId, (lim: number) => {
    try {
      const threads = document.querySelectorAll('ytd-comment-thread-renderer');
      if (!threads.length) {
        const root = document.querySelector('#comments');
        if (!root) return { error: 'Comments container not found — video may have comments disabled' };
        return [];
      }

      const parseHumanCount = (s: string): number => {
        if (!s) return 0;
        const m = /([\d.,]+)\s*([KMB]?)/i.exec(s);
        if (!m) return 0;
        const n = parseFloat(m[1].replace(/,/g, '')) || 0;
        const u = (m[2] || '').toUpperCase();
        return Math.round(n * (u === 'K' ? 1e3 : u === 'M' ? 1e6 : u === 'B' ? 1e9 : 1));
      };
      const getText = (el: Element | null) => (el?.textContent || '').replace(/\s+/g, ' ').trim();

      const out: any[] = [];
      for (let i = 0; i < threads.length && out.length < lim; i++) {
        const t = threads[i] as any;
        // ytd-comment-view-model is the new comment node; ytd-comment-renderer is the old one
        const view =
          t.querySelector('ytd-comment-view-model') ||
          t.querySelector('ytd-comment-renderer') ||
          t;
        const data = view.__data?.data || view.data || {};

        const id = data.commentId || view.getAttribute?.('id') || '';
        const text = data.contentText?.simpleText
          || (data.contentText?.runs || []).map((r: any) => r.text || '').join('')
          || getText(view.querySelector('#content-text')) || '';
        const author = data.authorText?.simpleText
          || getText(view.querySelector('#author-text')) || '';
        const authorChannelId = data.authorEndpoint?.browseEndpoint?.browseId
          || (view.querySelector('#author-text') as HTMLAnchorElement | null)?.href?.match(/channel\/([^/?#]+)/)?.[1]
          || '';
        const thumbs = data.authorThumbnail?.thumbnails || [];
        const authorThumb = thumbs.length ? thumbs[thumbs.length - 1].url : '';
        const publishedTime = data.publishedTimeText?.runs?.[0]?.text
          || getText(view.querySelector('.published-time-text')) || '';
        const likeText = data.voteCount?.simpleText || data.voteCount?.accessibility?.accessibilityData?.label || '';
        const likeCount = parseHumanCount(String(likeText));
        const replyText = getText(view.querySelector('#replies #more-text'))
          || (data.replyCount ? String(data.replyCount) : '');
        const replyCount = parseHumanCount(replyText);
        const isPinned = Boolean(data.pinnedCommentBadge) || Boolean(view.querySelector('#pinned-comment-badge'));
        const isHearted = Boolean(data.actionButtons?.commentActionButtonsRenderer?.creatorHeart)
          || Boolean(view.querySelector('#creator-heart'));

        if (!text && !author) continue;
        out.push({
          id,
          text,
          author,
          author_channel_id: authorChannelId,
          author_thumbnail: authorThumb,
          published_time: publishedTime,
          like_count: likeCount,
          reply_count: replyCount,
          is_pinned: isPinned,
          is_hearted: isHearted,
        });
      }
      return out;
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
  const tabId = await getTab(`https://www.youtube.com/watch?v=${id}`);
  await new Promise((r) => setTimeout(r, 3000));
  await checkLoginRedirect(tabId, 'YouTube');

  const data = await executeInPage(tabId, async (preferLang: string) => {
    try {
      const pr = (window as any).ytInitialPlayerResponse;
      if (!pr) return { error: 'ytInitialPlayerResponse missing' };
      const tracks = pr.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
      if (!tracks.length) return { error: 'no captions available' };

      // Prefer requested lang; otherwise English; otherwise the first track.
      let track = null as any;
      if (preferLang) {
        track = tracks.find((t: any) => (t.languageCode || '').toLowerCase().startsWith(preferLang.toLowerCase()));
      }
      if (!track) track = tracks.find((t: any) => (t.languageCode || '').toLowerCase().startsWith('en'));
      if (!track) track = tracks[0];
      if (!track?.baseUrl) return { error: 'no caption baseUrl' };

      const res = await fetch(track.baseUrl, { credentials: 'include' });
      if (!res.ok) return { error: 'Caption fetch failed: HTTP ' + res.status };
      const xml = await res.text();

      // Parse XML <text start="..." dur="...">…</text> entries.
      const lines: any[] = [];
      const re = /<text\s+([^>]*)>([\s\S]*?)<\/text>/g;
      let m: RegExpExecArray | null;
      const decodeEntities = (s: string) =>
        s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#(\d+);/g, (_: string, n: string) => String.fromCharCode(parseInt(n, 10)));
      while ((m = re.exec(xml)) !== null) {
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

  if (data && typeof data === 'object' && 'error' in data) throw new Error((data as any).error);
  return data as YouTubeTranscript;
}
