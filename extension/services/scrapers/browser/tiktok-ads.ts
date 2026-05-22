/**
 * TikTok Creative Center scrapers (Wave 5).
 *
 * Source: ads.tiktok.com/business/creativecenter/ — a SEPARATE host from
 * regular tiktok.com with its OWN identity provider, cookies, and
 * internal API endpoints under
 *   https://ads.tiktok.com/creative_radar_api/v1/...
 *
 * IMPORTANT — login requirement:
 *
 *   Creative Center pages 302-redirect to an `ads.tiktok.com/business/login`
 *   landing if the user is not signed in to a TikTok For Business account.
 *   We can't authenticate this from the extension — the user must sign in
 *   first in the same Chrome profile that hosts the scraper-pool window.
 *
 *   Every scraper here lands on a Creative Center page first (via getTab),
 *   runs `checkLoginRedirect(tabId, 'TikTok Ads')` to bail with a clean
 *   error if we got bounced, then page-context fetches the
 *   /creative_radar_api/v1/* endpoint with credentials:'include'.
 *
 * IMPORTANT — endpoint guesses:
 *
 *   The Creative Center internal API is undocumented. The endpoint paths
 *   in each function below are educated guesses derived from the public
 *   page URLs (e.g. /inspiration/popular/hashtag → hashtag/list) and the
 *   tiktok-api23 schema. None have been verified end-to-end yet (the
 *   author didn't have a TikTok Business account at write time). On
 *   HTTP 401/403 we surface a `tiktok-ads-login-required` note; on 404
 *   we surface a `tiktok-ads-endpoint-unknown` note pointing to which
 *   endpoint URL we guessed so the user can DevTools-inspect the real
 *   one and patch this file in one place.
 *
 *   Common Creative Center query params (best-effort):
 *     - period: 7 | 30 | 120 (days)
 *     - country_code / region: 'US' (ISO 3166-1 alpha-2)
 *     - page / limit: 1-based int / 1-100
 *     - order_by / sort_by: endpoint-specific (ctr, popular, vv, etc.)
 */

import {
  getTab,
  checkLoginRedirect,
  executeInPage,
} from '../../scraperService';

// Reusable landing URL — any logged-in Creative Center page works as a
// home base, the radar API host is the same regardless.
const CC_LANDING =
  'https://ads.tiktok.com/business/creativecenter/inspiration/popular/hashtag/pc/en';

/** Shape of every Wave 5 envelope: either the parsed body or an error. */
interface WaveResult {
  [k: string]: unknown;
  error?: string;
}

/** Run a page-context GET against the radar API. Returns parsed JSON on
 *  success; { error } on any failure (auth, network, parse). */
async function radarFetch(
  tabId: number,
  apiPath: string,
  query: Record<string, string | number | string[] | undefined>,
): Promise<WaveResult> {
  return (await executeInPage(
    tabId,
    async (path: string, q: Record<string, string | number | string[] | undefined>) => {
      try {
        const qs: string[] = [];
        for (const [k, v] of Object.entries(q)) {
          if (v == null) continue;
          if (Array.isArray(v)) {
            for (const item of v) {
              qs.push(encodeURIComponent(k) + '=' + encodeURIComponent(String(item)));
            }
          } else {
            qs.push(encodeURIComponent(k) + '=' + encodeURIComponent(String(v)));
          }
        }
        const url =
          'https://ads.tiktok.com' + path +
          (qs.length ? ('?' + qs.join('&')) : '');
        const r = await fetch(url, {
          credentials: 'include',
          headers: { 'Accept': 'application/json,text/plain,*/*' },
        });
        if (r.status === 401 || r.status === 403) {
          return {
            error: 'tiktok-ads-login-required: please sign in to ads.tiktok.com first',
            status: r.status,
            tried: url,
          };
        }
        if (r.status === 404) {
          return {
            error: 'tiktok-ads-endpoint-unknown: ' + path +
              ' returned 404 — Creative Center internal API may have moved; inspect Network in DevTools while on creativecenter to find the new path',
            status: 404,
            tried: url,
          };
        }
        if (!r.ok) {
          return { error: 'tiktok-ads fetch failed: HTTP ' + r.status, status: r.status, tried: url };
        }
        const body = await r.text();
        if (!body) return { error: 'tiktok-ads returned empty body', tried: url };
        try {
          return JSON.parse(body) as Record<string, unknown>;
        } catch {
          return {
            error: 'tiktok-ads returned non-JSON body (likely login wall)',
            tried: url,
            head: body.slice(0, 200),
          };
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return { error: 'tiktok-ads radarFetch threw: ' + msg };
      }
    },
    [apiPath, query],
  )) as WaveResult;
}

// ─── 1. getTikTokAdsDetail ──────────────────────────────────────────

export async function getTikTokAdsDetail(adsId: string): Promise<WaveResult> {
  if (!adsId || !String(adsId).trim()) throw new Error('ads_id required');
  const tabId = await getTab(CC_LANDING);
  await checkLoginRedirect(tabId, 'TikTok Ads');
  return radarFetch(tabId, '/creative_radar_api/v1/top_ads/detail', {
    material_id: String(adsId).trim(),
  });
}

// ─── 2. getTikTokAdsTop ────────────────────────────────────────────

export interface AdsTopOptions {
  page?: number;
  period?: number;        // 7 | 30 | 120
  limit?: number;
  country?: string;       // ISO country code, e.g. 'US'
  order_by?: string;      // ctr | cvr | impression
}

export async function getTikTokAdsTop(opts: AdsTopOptions = {}): Promise<WaveResult> {
  const tabId = await getTab(
    'https://ads.tiktok.com/business/creativecenter/inspiration/topads/pc/en',
  );
  await checkLoginRedirect(tabId, 'TikTok Ads');
  return radarFetch(tabId, '/creative_radar_api/v1/top_ads/list', {
    page: opts.page ?? 1,
    period: opts.period ?? 7,
    limit: opts.limit ?? 20,
    country_code: opts.country ?? 'US',
    order_by: opts.order_by ?? 'ctr',
  });
}

// ─── 3. getTikTokTrendingCreator ───────────────────────────────────

export interface TrendingCreatorOptions {
  page?: number;
  limit?: number;
  sort_by?: string;       // follower | follower_growth | engagement
  country?: string;
}

export async function getTikTokTrendingCreator(
  opts: TrendingCreatorOptions = {},
): Promise<WaveResult> {
  const tabId = await getTab(
    'https://ads.tiktok.com/business/creativecenter/inspiration/popular/creator/pc/en',
  );
  await checkLoginRedirect(tabId, 'TikTok Ads');
  return radarFetch(tabId, '/creative_radar_api/v1/popular_trend/creator/list', {
    page: opts.page ?? 1,
    limit: opts.limit ?? 20,
    sort_by: opts.sort_by ?? 'follower',
    country_code: opts.country ?? 'US',
  });
}

// ─── 4. getTikTokTrendingVideo ─────────────────────────────────────

export interface TrendingVideoOptions {
  page?: number;
  limit?: number;
  period?: number;        // 7 | 30 | 120
  order_by?: string;      // vv | like | comment | share
  country?: string;
}

export async function getTikTokTrendingVideo(
  opts: TrendingVideoOptions = {},
): Promise<WaveResult> {
  const tabId = await getTab(
    'https://ads.tiktok.com/business/creativecenter/inspiration/popular/pc/en',
  );
  await checkLoginRedirect(tabId, 'TikTok Ads');
  return radarFetch(tabId, '/creative_radar_api/v1/popular_trend/video/list', {
    page: opts.page ?? 1,
    limit: opts.limit ?? 20,
    period: opts.period ?? 30,
    order_by: opts.order_by ?? 'vv',
    country_code: opts.country ?? 'US',
  });
}

// ─── 5. getTikTokTrendingHashtag ───────────────────────────────────

export interface TrendingHashtagOptions {
  page?: number;
  limit?: number;
  period?: number;        // 7 | 30 | 120
  country?: string;
  sort_by?: string;       // popular | new
}

export async function getTikTokTrendingHashtag(
  opts: TrendingHashtagOptions = {},
): Promise<WaveResult> {
  const tabId = await getTab(CC_LANDING);
  await checkLoginRedirect(tabId, 'TikTok Ads');
  return radarFetch(tabId, '/creative_radar_api/v1/popular_trend/hashtag/list', {
    page: opts.page ?? 1,
    limit: opts.limit ?? 20,
    period: opts.period ?? 120,
    country_code: opts.country ?? 'US',
    sort_by: opts.sort_by ?? 'popular',
  });
}

// ─── 6. getTikTokTrendingSong ──────────────────────────────────────

export interface TrendingSongOptions {
  page?: number;
  limit?: number;
  period?: number;        // 7 | 30 | 120
  rank_type?: string;     // popular | breakout
  country?: string;
}

export async function getTikTokTrendingSong(
  opts: TrendingSongOptions = {},
): Promise<WaveResult> {
  const tabId = await getTab(
    'https://ads.tiktok.com/business/creativecenter/inspiration/popular/music/pc/en',
  );
  await checkLoginRedirect(tabId, 'TikTok Ads');
  return radarFetch(tabId, '/creative_radar_api/v1/popular_trend/song/list', {
    page: opts.page ?? 1,
    limit: opts.limit ?? 20,
    period: opts.period ?? 7,
    rank_type: opts.rank_type ?? 'popular',
    country_code: opts.country ?? 'US',
  });
}

// ─── 7. getTikTokTrendingKeyword ───────────────────────────────────

export interface TrendingKeywordOptions {
  page?: number;
  limit?: number;
  period?: number;        // 7 | 30 | 120
  country?: string;
}

export async function getTikTokTrendingKeyword(
  opts: TrendingKeywordOptions = {},
): Promise<WaveResult> {
  const tabId = await getTab(
    'https://ads.tiktok.com/business/creativecenter/keyword-insights/pc/en',
  );
  await checkLoginRedirect(tabId, 'TikTok Ads');
  return radarFetch(tabId, '/creative_radar_api/v1/popular_trend/keyword/list', {
    page: opts.page ?? 1,
    limit: opts.limit ?? 20,
    period: opts.period ?? 7,
    country_code: opts.country ?? 'US',
  });
}

// ─── 8. getTikTokTrendingKeywordPosts ──────────────────────────────

export interface TrendingKeywordPostsOptions {
  country?: string;
  limit?: number;
  period?: number;
}

export async function getTikTokTrendingKeywordPosts(
  keyword: string,
  opts: TrendingKeywordPostsOptions = {},
): Promise<WaveResult> {
  if (!keyword || !keyword.trim()) throw new Error('keyword required');
  const tabId = await getTab(
    'https://ads.tiktok.com/business/creativecenter/keyword-insights/pc/en',
  );
  await checkLoginRedirect(tabId, 'TikTok Ads');
  return radarFetch(tabId, '/creative_radar_api/v1/keyword/recommend_keyword_to_posts', {
    keyword: keyword.trim(),
    country_code: opts.country ?? 'US',
    limit: opts.limit ?? 10,
    period: opts.period ?? 7,
  });
}

// ─── 9. getTikTokTrendingKeywordSentence ───────────────────────────

export interface TrendingKeywordSentenceOptions {
  page?: number;
  limit?: number;
  period?: number;
  country?: string;
  order_type?: string;    // asc | desc
}

export async function getTikTokTrendingKeywordSentence(
  keyword: string,
  opts: TrendingKeywordSentenceOptions = {},
): Promise<WaveResult> {
  if (!keyword || !keyword.trim()) throw new Error('keyword required');
  const tabId = await getTab(
    'https://ads.tiktok.com/business/creativecenter/keyword-insights/pc/en',
  );
  await checkLoginRedirect(tabId, 'TikTok Ads');
  return radarFetch(tabId, '/creative_radar_api/v1/keyword/topic', {
    keyword: keyword.trim(),
    page: opts.page ?? 1,
    limit: opts.limit ?? 50,
    period: opts.period ?? 30,
    country_code: opts.country ?? 'US',
    order_type: opts.order_type ?? 'desc',
  });
}

// ─── 10. getTikTokCommercialMusicLibrary ───────────────────────────

export interface CommercialMusicOptions {
  page?: number;
  limit?: number;
  region?: string;
  scenarios?: number;     // 0 = all
  duration?: number;      // 0 = all
  placements?: string[];  // array, passed through as repeated query keys
  themes?: string[];
  genres?: string[];
  moods?: string[];
}

export async function getTikTokCommercialMusicLibrary(
  opts: CommercialMusicOptions = {},
): Promise<WaveResult> {
  const tabId = await getTab(
    'https://ads.tiktok.com/business/creativecenter/music/pc/en',
  );
  await checkLoginRedirect(tabId, 'TikTok Ads');
  return radarFetch(tabId, '/creative_radar_api/v1/music_library/songs', {
    page: opts.page ?? 1,
    limit: opts.limit ?? 20,
    region: opts.region ?? 'US',
    scenarios: opts.scenarios ?? 0,
    duration: opts.duration ?? 0,
    placements: opts.placements,
    themes: opts.themes,
    genres: opts.genres,
    moods: opts.moods,
  });
}

// ─── 11. getTikTokCommercialMusicPlaylists ─────────────────────────

export interface CommercialPlaylistsOptions {
  limit?: number;
  region?: string;
}

export async function getTikTokCommercialMusicPlaylists(
  opts: CommercialPlaylistsOptions = {},
): Promise<WaveResult> {
  const tabId = await getTab(
    'https://ads.tiktok.com/business/creativecenter/music/pc/en',
  );
  await checkLoginRedirect(tabId, 'TikTok Ads');
  return radarFetch(tabId, '/creative_radar_api/v1/music_library/playlist', {
    limit: opts.limit ?? 20,
    region: opts.region ?? 'US',
  });
}

// ─── 12. getTikTokCommercialMusicPlaylistDetail ────────────────────

export interface CommercialPlaylistDetailOptions {
  page?: number;
  limit?: number;
  region?: string;
}

export async function getTikTokCommercialMusicPlaylistDetail(
  playlistId: string,
  opts: CommercialPlaylistDetailOptions = {},
): Promise<WaveResult> {
  if (!playlistId || !String(playlistId).trim())
    throw new Error('playlist_id required');
  const tabId = await getTab(
    'https://ads.tiktok.com/business/creativecenter/music/pc/en',
  );
  await checkLoginRedirect(tabId, 'TikTok Ads');
  return radarFetch(tabId, '/creative_radar_api/v1/music_library/playlist/detail', {
    playlist_id: String(playlistId).trim(),
    page: opts.page ?? 1,
    limit: opts.limit ?? 20,
    region: opts.region ?? 'US',
  });
}

// ─── 13. getTikTokTopProducts ──────────────────────────────────────
//
// Creative Center's /creative_radar_api/v1/top_products/* family
// returned 404 in 2026 — that path was retired. The buyer-facing
// concept ("what's selling on TikTok") now lives on TikTok Shop at
// shop.tiktok.com/us. We DOM-scrape the Flash Sales page (which is
// the closest analog to "trending products") rather than hit a
// JSON API, because TikTok Shop loads product cards via XHR with
// signed tokens we can't easily reproduce.

export interface TopProductsOptions {
  page?: number;
  last?: number;          // legacy — not used (Flash Sales is a single rolling list)
  order_by?: string;      // legacy
  order_type?: string;    // legacy
  region?: string;        // 'us' (default). Other regions: 'uk', 'sg', 'th', 'vn', 'my', 'ph', 'id'
}

export interface TikTokShopProduct {
  product_id: string;
  product_url: string;
  title: string;
  image: string;
  current_price: string;
  original_price: string;
  discount_pct: string;
  // Free-text engagement snippet captured from the card; sales/rating
  // are inconsistent in the SERP markup so we don't parse them out
  // here — buyers can call product_detail for richer data.
  badge: string;
}

export async function getTikTokTopProducts(
  opts: TopProductsOptions = {},
): Promise<WaveResult> {
  const region = (opts.region || 'us').toLowerCase();
  const tabId = await getTab(
    `https://shop.tiktok.com/${region}/deals/flash-sales`,
  );
  await checkLoginRedirect(tabId, 'TikTok Shop');
  // Give SPA a moment to hydrate the product cards.
  await new Promise(r => setTimeout(r, 2500));

  const data = await executeInPage(tabId, () => {
    try {
      const cards = Array.from(document.querySelectorAll('a[href*="/pdp/"]'));
      if (!cards.length) {
        return { error: 'TikTok Shop product cards not found — page may have failed to hydrate', products: [] };
      }
      const products: TikTokShopProduct[] = [];
      const seen = new Set<string>();
      for (const a of cards) {
        const href = a.getAttribute('href') || '';
        // /us/pdp/<slug>/<productId> — productId is 15-25 digits.
        const m = href.match(/\/pdp\/[^/]+\/(\d{15,})/);
        if (!m) continue;
        const productId = m[1];
        if (seen.has(productId)) continue;
        seen.add(productId);

        // Walk up to the visible card root (max 4 levels).
        let card: Element = a;
        for (let i = 0; i < 4; i++) {
          if (!card.parentElement) break;
          card = card.parentElement;
          if ((card as HTMLElement).className?.toString().includes('cursor-pointer')) break;
        }
        const txt = (card.textContent || '').replace(/\s+/g, ' ').trim();
        const priceMatch = txt.match(/\$([\d,]+\.\d{2})(?:\s*\$([\d,]+\.\d{2}))?/);
        const discountMatch = txt.match(/-(\d+)%/);

        // Title sits between the "Free shipping" prefix (when present) and the
        // discount/price string.
        let title = txt
          .replace(/^Free shipping\s*/i, '')
          .replace(/-\d+%.*$/, '')
          .replace(/#\w+/g, '')
          .trim();
        if (title.length > 150) title = title.slice(0, 150);

        products.push({
          product_id: productId,
          product_url: href.startsWith('http') ? href : `https://shop.tiktok.com${href}`,
          title,
          image: (card.querySelector('img') as HTMLImageElement | null)?.src || '',
          current_price: priceMatch?.[1] || '',
          original_price: priceMatch?.[2] || '',
          discount_pct: discountMatch?.[1] ? `-${discountMatch[1]}%` : '',
          badge: txt.includes('Free shipping') ? 'free_shipping' : '',
        });
      }
      return { products };
    } catch (e: any) {
      return { error: e?.message || 'TikTok Shop top-products scraper failed' };
    }
  });

  return data as WaveResult;
}

// ─── 14. getTikTokTopProductDetail ─────────────────────────────────

export async function getTikTokTopProductDetail(productId: string): Promise<WaveResult> {
  if (!productId || !String(productId).trim())
    throw new Error('product_id required');
  const pid = String(productId).trim();
  // TikTok Shop accepts any slug in the URL — only the trailing
  // productId is matched. Use 'x' as placeholder.
  const tabId = await getTab(`https://shop.tiktok.com/us/pdp/x/${pid}`);
  await checkLoginRedirect(tabId, 'TikTok Shop');
  await new Promise(r => setTimeout(r, 2500));

  const data = await executeInPage(tabId, (id: string) => {
    try {
      const t = (s: Element | null) => (s?.textContent || '').replace(/\s+/g, ' ').trim();
      const title = document.title.replace(/\s*\|\s*TikTok Shop\s*$/i, '').trim();
      const allText = (document.body.textContent || '').replace(/\s+/g, ' ');
      const priceMatch = allText.match(/\$([\d,]+\.\d{2})(?:\s*\$([\d,]+\.\d{2}))?/);
      const ratingMatch = allText.match(/([\d.]+)\s*\(?([\d.]+[KM]?)\s*ratings?\)?/i);
      const soldMatch = allText.match(/([\d.,]+\s*[KMB]?)\s*(?:sold|已售出|orders?)/i);

      // Pull a few high-signal images (excluding category sprites).
      const imgs = Array.from(document.querySelectorAll('img'))
        .map(i => (i as HTMLImageElement).src)
        .filter(s => s.includes('ttcdn-us.com') || s.includes('tiktokcdn'))
        .slice(0, 5);

      const desc = t(document.querySelector('[data-e2e*="description" i], [class*="description"]'));

      return {
        product_id: id,
        product_url: location.href,
        title,
        description: desc || '',
        current_price: priceMatch?.[1] || '',
        original_price: priceMatch?.[2] || '',
        rating: ratingMatch?.[1] || '',
        rating_count: ratingMatch?.[2] || '',
        sold: soldMatch?.[1]?.trim() || '',
        images: imgs,
      };
    } catch (e: any) {
      return { error: e?.message || 'TikTok Shop product-detail scraper failed' };
    }
  }, [pid]);

  return data as WaveResult;
}

// ─── 15. getTikTokTopProductMetrics ────────────────────────────────

export async function getTikTokTopProductMetrics(productId: string): Promise<WaveResult> {
  if (!productId || !String(productId).trim())
    throw new Error('product_id required');
  const pid = String(productId).trim();
  const tabId = await getTab(`https://shop.tiktok.com/us/pdp/x/${pid}`);
  await checkLoginRedirect(tabId, 'TikTok Shop');
  await new Promise(r => setTimeout(r, 2500));

  const data = await executeInPage(tabId, (id: string) => {
    try {
      const allText = (document.body.textContent || '').replace(/\s+/g, ' ');
      const ratingMatch = allText.match(/([\d.]+)\s*\(?([\d.]+[KM]?)\s*ratings?\)?/i);
      const soldMatch = allText.match(/([\d.,]+\s*[KMB]?)\s*(?:sold|已售出|orders?)/i);
      const wishlistMatch = allText.match(/([\d.,]+\s*[KMB]?)\s*(?:wishlist|saves?|likes?)/i);
      const reviewMatch = allText.match(/([\d.,]+)\s*reviews?/i);
      return {
        product_id: id,
        rating: ratingMatch?.[1] || '',
        rating_count: ratingMatch?.[2] || '',
        sold: soldMatch?.[1]?.trim() || '',
        wishlist: wishlistMatch?.[1]?.trim() || '',
        review_count: reviewMatch?.[1] || '',
      };
    } catch (e: any) {
      return { error: e?.message || 'TikTok Shop product-metrics scraper failed' };
    }
  }, [pid]);

  return data as WaveResult;
}
