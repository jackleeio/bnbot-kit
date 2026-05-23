/**
 * Xiaohongshu XAPI app_v2 compatibility helpers.
 *
 * The stable Web surface we can use today is rendered page data. XHS's
 * edith APIs are signed with x-s/x-t; endpoints without a verified Web
 * mapping return a structured limitation instead of pretending success.
 */

import { getTab, checkLoginRedirect, executeInPage } from '../../scraperService';
import { searchXiaohongshu, XiaohongshuSearchResult } from './xiaohongshu-search';

export interface XiaohongshuEnvelope<T = unknown> {
  endpoint: string;
  data?: T;
  items?: T[];
  count?: number;
  note?: string;
  input?: Record<string, unknown>;
}

export interface XiaohongshuNoteDetail {
  note_id: string;
  url: string;
  title: string;
  desc: string;
  author: string;
  likes: string;
  images: string[];
  comments: XiaohongshuComment[];
}

export interface XiaohongshuComment {
  rank: number;
  text: string;
  author: string;
  likes: string;
}

function unsupported(endpoint: string, input: Record<string, unknown>, reason: string): XiaohongshuEnvelope {
  return {
    endpoint,
    note: 'xiaohongshu-web-endpoint-not-yet-mapped',
    input,
    data: { reason },
  };
}

function notPursued(endpoint: string, input: Record<string, unknown>, reason: string): XiaohongshuEnvelope {
  return {
    endpoint,
    note: 'xiaohongshu-web-endpoint-not-pursued-account-risk',
    input,
    data: { reason },
  };
}

function decodeMaybe(value = ''): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function extractNoteId(value = ''): string {
  const decoded = decodeMaybe(value);
  const match = decoded.match(/(?:explore|search_result|discovery\/item)\/([0-9a-f]{24})/i);
  if (match?.[1]) return match[1];
  if (/^[0-9a-f]{24}$/i.test(decoded)) return decoded;
  return '';
}

function detailUrl(noteId?: string, shareText?: string): string {
  const decoded = decodeMaybe(shareText || '');
  const urlMatch = decoded.match(/https?:\/\/[^\s"'<>]+xiaohongshu\.com\/[^\s"'<>]+/i);
  if (urlMatch?.[0]) return urlMatch[0];
  const id = noteId || extractNoteId(decoded);
  if (!id) throw new Error("missing 'note_id' or share_text URL");
  return `https://www.xiaohongshu.com/explore/${id}`;
}

function wrapSearch(endpoint: string, items: XiaohongshuSearchResult[], input: Record<string, unknown>): XiaohongshuEnvelope<XiaohongshuSearchResult> {
  return {
    endpoint,
    items,
    count: items.length,
    input,
  };
}

function searchUrl(keyword: string): string {
  return `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(keyword)}&source=web_search_result_notes`;
}

function goodsUrl(skuId: string): string {
  return `https://www.xiaohongshu.com/goods-detail/${encodeURIComponent(skuId)}`;
}

function creatorHomeUrl(): string {
  return 'https://creator.xiaohongshu.com/new/home';
}

function assertId(value: string | undefined, label: string): string {
  const v = (value || '').trim();
  if (!v) throw new Error(`${label} required`);
  if (v === 'sample-id' || v === 'string') {
    throw new Error(`${label} must be a real Xiaohongshu id, not sample placeholder "${v}"`);
  }
  return v;
}

function dataEnvelope<T>(endpoint: string, data: T, input: Record<string, unknown>): XiaohongshuEnvelope<T> {
  return {
    endpoint,
    data,
    count: Array.isArray(data) ? data.length : undefined,
    input,
  };
}

function compactText(value: unknown, max = 300): string {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function pickImage(value: any): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const img = pickImage(item);
      if (img) return img;
    }
    return '';
  }
  if (typeof value === 'object') {
    return value.url
      || value.image_url
      || value.imageUrl
      || value.url_default
      || value.defaultUrl
      || value.thumbnail
      || value.cover
      || pickImage(value.image)
      || pickImage(value.images)
      || '';
  }
  return '';
}

function compactSeller(value: any): any {
  if (!value || typeof value !== 'object') return null;
  return {
    seller_id: value.seller_id || value.sellerId || value.id || '',
    name: value.name || value.seller_name || value.nickname || value.shop_name || '',
    avatar: pickImage(value.avatar || value.logo || value.image),
    sales: value.salesVolume || value.sale_quantity || value.sales || '',
  };
}

function compactProduct(item: any, rank?: number): any {
  const sku = item?.sku_id || item?.skuId || item?.item_id || item?.itemId || item?.goods_id || item?.id || '';
  const seller = compactSeller(item?.seller || item?.seller_info || item?.sellerInfo || item);
  return {
    rank,
    sku_id: sku,
    title: compactText(item?.title || item?.name || item?.goods_name || item?.product_name || item?.desc),
    desc: compactText(item?.desc || item?.description || item?.sub_title || item?.subtitle),
    price: item?.price || item?.price_text || item?.display_price || item?.highlight_price || item?.highlightPrice || '',
    sold: item?.sale_quantity || item?.saleQuantity || item?.sales || item?.sold || '',
    image: pickImage(item?.image || item?.image_info || item?.imageInfo || item?.cover || item?.images || item?.goods_images),
    seller_id: seller?.seller_id || item?.seller_id || item?.sellerId || '',
    seller_name: seller?.name || item?.seller_name || item?.shop_name || '',
    url: sku ? goodsUrl(String(sku)) : '',
  };
}

async function scrapeSearchState(keyword: string, channel?: 'user'): Promise<any> {
  const tabId = await getTab(searchUrl(keyword));
  await new Promise(r => setTimeout(r, 3000));
  await checkLoginRedirect(tabId, 'Xiaohongshu');

  const state = await executeInPage(tabId, async (targetChannel?: 'user') => {
    const plain = (value: any) => {
      try { return JSON.parse(JSON.stringify(value)); } catch { return value; }
    };
    const unwrap = (value: any) => value && typeof value === 'object' && '_value' in value ? value._value : value;
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    if (targetChannel) {
      const channelEl = Array.from(document.querySelectorAll('.channel'))
        .find((el: Element) => {
          const e = el as HTMLElement;
          const r = e.getBoundingClientRect();
          return e.id === targetChannel
            && e.getAttribute('aria-hidden') !== 'true'
            && r.width > 1
            && r.height > 1;
        }) as HTMLElement | undefined;
      if (channelEl) {
        const r = channelEl.getBoundingClientRect();
        for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
          channelEl.dispatchEvent(new MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX: r.left + Math.min(10, r.width / 2),
            clientY: r.top + Math.min(10, r.height / 2),
          }));
        }
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline) {
          const current = unwrap((window as any).__INITIAL_STATE__?.search?.currentSearchType);
          const users = unwrap((window as any).__INITIAL_STATE__?.search?.userLists) || [];
          if (current === targetChannel || users.length > 0) break;
          await sleep(250);
        }
      }
    }

    const search = (window as any).__INITIAL_STATE__?.search || {};
    const chips = Array.from(document.querySelectorAll('.tab'))
      .map((el) => (el.textContent || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    const bodyText = document.body.innerText || '';
    return plain({
      currentSearchType: unwrap(search.currentSearchType),
      feeds: unwrap(search.feeds) || [],
      userLists: unwrap(search.userLists) || [],
      suggestions: unwrap(search.suggestions) || [],
      tagSearch: unwrap(search.tagSearch) || [],
      queryTrendingInfo: unwrap(search.queryTrendingInfo) || {},
      oneboxInfo: unwrap(search.oneboxInfo) || {},
      searchContext: search.searchContext || {},
      chips,
      href: location.href,
      loginRequired: bodyText.includes('登录后查看搜索结果')
        || bodyText.includes('登录后探索更多内容')
        || bodyText.includes('请先登录')
        || location.href.includes('/login'),
    });
  }, [channel]) as any;

  const hasData = state.feeds?.length
    || state.userLists?.length
    || state.suggestions?.length
    || state.tagSearch?.length
    || state.chips?.length;
  if (state.loginRequired && !hasData) {
    throw new Error('Please sign in to Xiaohongshu first: search results require login in the BNBot scraper browser');
  }
  return state;
}

function normalizeSearchUsers(raw: any[]): any[] {
  return (raw || []).map((u, idx) => ({
    rank: idx + 1,
    user_id: u.id || u.userId || '',
    red_id: u.redId || '',
    name: u.name || u.nickname || '',
    avatar: u.image || u.avatar || '',
    fans: u.fans || '',
    note_count: typeof u.noteCount === 'number' ? u.noteCount : undefined,
    update_time: u.updateTime || '',
    followed: !!u.followed,
    verified: !!u.redOfficialVerified,
    xsec_token: u.xsecToken || '',
    url: u.id
      ? `https://www.xiaohongshu.com/user/profile/${u.id}${u.xsecToken ? `?xsec_token=${encodeURIComponent(u.xsecToken)}` : ''}`
      : '',
  })).filter((u) => u.user_id || u.name);
}

function normalizeSearchGroups(state: any): any[] {
  const items: any[] = [];
  const seen = new Set<string>();
  const push = (name: string, type: string, extra: Record<string, unknown> = {}) => {
    const text = (name || '').trim();
    if (!text || seen.has(`${type}:${text}`)) return;
    seen.add(`${type}:${text}`);
    items.push({ rank: items.length + 1, type, name: text, ...extra });
  };
  for (const chip of state.chips || []) push(chip, 'tab');
  for (const sug of state.suggestions || []) push(sug.text || sug.word || sug.keyword || '', sug.type || 'suggestion', {
    search_type: sug.search_type || sug.searchType || '',
  });
  for (const tag of state.tagSearch || []) push(tag.name || tag.text || tag.keyword || '', 'tag', tag);
  const trending = state.queryTrendingInfo?.queries || state.queryTrendingInfo?.items || state.queryTrendingInfo?.list || [];
  for (const item of trending) push(item.word || item.query || item.text || item.name || '', 'trending', item);
  return items;
}

async function fetchJsonInPage<T = any>(
  tabId: number,
  url: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const result = await executeInPage(tabId, async (u: string, opts: { method?: string; body?: unknown }) => {
    const res = await fetch(u, {
      method: opts.method || 'GET',
      credentials: 'include',
      headers: opts.body ? { 'content-type': 'application/json' } : undefined,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const text = await res.text();
    let body: any;
    try { body = JSON.parse(text); } catch { body = { raw: text }; }
    return { ok: res.ok, status: res.status, body };
  }, [url, options]);

  const r = result as any;
  if (!r.ok) throw new Error(`Xiaohongshu Web fetch failed: HTTP ${r.status}`);
  return r.body as T;
}

async function fetchProductDetail(skuId: string): Promise<any> {
  const sku = assertId(skuId, 'sku_id');
  const tabId = await getTab(goodsUrl(sku));
  await new Promise(r => setTimeout(r, 2500));
  const body: any = await fetchJsonInPage(tabId, `https://mall.xiaohongshu.com/api/store/jpd/edith/detail/h5/toc?version=0.0.5&item_id=${encodeURIComponent(sku)}`);
  if (body?.success === false || (typeof body?.error_code === 'number' && body.error_code !== 0)) {
    throw new Error(`Xiaohongshu product detail failed: ${body?.msg || body?.error_code || 'unknown error'}`);
  }
  const td = body?.data?.template_data?.[0] || {};
  const serviceItems = td.serviceV5?.list || td.servicePopupV2?.list || [];
  const specItems = td.variantsParams?.list || [];
  return {
    sku_id: sku,
    url: goodsUrl(sku),
    title: td.descriptionH5?.name || td.descriptionMain?.name || '',
    price: td.priceH5?.highlightPrice ?? td.bottomBarMainH5?.price ?? null,
    sold: td.priceH5?.itemAnalysisDataText || td.sellerH5?.salesVolume || '',
    seller: compactSeller(td.sellerH5 || td.bottomBarMainH5?.seller),
    images: (td.carouselH5?.images || []).map((img: any) => pickImage(img)).filter(Boolean).slice(0, 12),
    services: serviceItems.map((item: any) => compactText(item.title || item.name || item.text)).filter(Boolean).slice(0, 20),
    shipping: {
      freight: td.goodsDistributeV4?.freightText || td.goodsDistributeV4?.freight || '',
      delivery: td.goodsDistributeV4?.deliveryText || td.goodsDistributeV4?.delivery || '',
    },
    specs: specItems.map((item: any) => ({
      name: item.name || item.title || '',
      values: (item.valueList || item.values || item.list || []).map((v: any) => compactText(v.name || v.value || v.text)).filter(Boolean).slice(0, 20),
    })).filter((item: any) => item.name || item.values.length).slice(0, 10),
    raw_keys: Object.keys(body?.data || {}),
  };
}

function normalizeCreatorGuidance(raw: any[]): any[] {
  return (raw || []).map((item, idx) => ({
    rank: idx + 1,
    note_id: item.note_id || item.noteId || '',
    title: compactText(item.title, 200),
    image: pickImage(item.image || item.cover),
    link: item.link || '',
    url: item.note_id
      ? `https://www.xiaohongshu.com/explore/${item.note_id}${item.xsec_token ? `?xsec_token=${encodeURIComponent(item.xsec_token)}&xsec_source=${encodeURIComponent(item.xsec_source || 'pc_creator')}` : ''}`
      : '',
    user_id: item.user_id || item.userId || '',
    nickname: item.nickname || item.author || '',
    avatar: pickImage(item.avatar),
    view_count: item.view_count ?? null,
    display_count_text: item.display_count_text || '',
    xsec_source: item.xsec_source || '',
    xsec_token: item.xsec_token || '',
  })).filter((item) => item.note_id || item.title);
}

async function fetchCreatorGuidance(args: { endpoint: string; pageSize?: number; hot?: boolean; input?: Record<string, unknown> }): Promise<XiaohongshuEnvelope> {
  const tabId = await getTab(creatorHomeUrl());
  await new Promise(r => setTimeout(r, 2500));
  const tab = await chrome.tabs.get(tabId);
  if (tab.url?.includes('/login')) {
    return unsupported(args.endpoint, args.input || {}, 'creator.xiaohongshu.com returned the login page; sign in to Creator Center before this Web-only endpoint can return inspiration data.');
  }

  const pageSize = args.pageSize || 12;
  const body: any = await fetchJsonInPage(
    tabId,
    `https://creator.xiaohongshu.com/api/galaxy/creator/data/create_guidance?page=1&page_size=${pageSize}&type=1`,
  );
  if (body?.success === false || (typeof body?.code === 'number' && body.code !== 0)) {
    throw new Error(`Xiaohongshu Creator guidance failed: ${body?.msg || body?.code || 'unknown error'}`);
  }

  let items = normalizeCreatorGuidance(body?.data?.create_guidance || []);
  if (args.hot) {
    items = [...items].sort((a, b) => Number(b.view_count || 0) - Number(a.view_count || 0))
      .map((item, idx) => ({ ...item, rank: idx + 1 }));
  }

  return {
    endpoint: args.endpoint,
    items,
    count: items.length,
    data: {
      total: body?.data?.total ?? items.length,
      source_url: creatorHomeUrl(),
      source_api: '/api/galaxy/creator/data/create_guidance',
    },
    input: args.input || {},
  };
}

export async function xhsSearchNotes(args: {
  keyword: string;
  page?: number;
  source?: string;
  note_type?: string;
  sort_type?: string;
  time_filter?: string;
  limit?: number;
}): Promise<XiaohongshuEnvelope<XiaohongshuSearchResult>> {
  const limit = args.limit || 20;
  const items = await searchXiaohongshu(args.keyword, limit);
  return wrapSearch('search_notes', items, args);
}

export async function xhsSearchImages(args: {
  keyword: string;
  page?: number;
  source?: string;
  limit?: number;
}): Promise<XiaohongshuEnvelope<XiaohongshuSearchResult>> {
  return notPursued(
    'search_images',
    args,
    'Not pursued for Xiaohongshu Wave 1: search image channel repeatedly trips login-wall / account-risk flows. Use search_notes for the approved search surface.',
  ) as XiaohongshuEnvelope<XiaohongshuSearchResult>;
}

export async function xhsGetImageNoteDetail(args: {
  note_id?: string;
  share_text?: string;
}): Promise<XiaohongshuEnvelope<XiaohongshuNoteDetail>> {
  return {
    endpoint: 'get_image_note_detail',
    data: await scrapeNoteDetail(args.note_id, args.share_text),
    input: args,
  };
}

export async function xhsGetMixedNoteDetail(args: {
  note_id?: string;
  share_text?: string;
}): Promise<XiaohongshuEnvelope<XiaohongshuNoteDetail>> {
  if (!args.note_id && !args.share_text) {
    return unsupported(
      'get_mixed_note_detail',
      args,
      'Xiaohongshu Web note detail needs note_id or share_text containing a note URL with xsec_token.',
    ) as XiaohongshuEnvelope<XiaohongshuNoteDetail>;
  }
  return {
    endpoint: 'get_mixed_note_detail',
    data: await scrapeNoteDetail(args.note_id, args.share_text),
    input: args,
  };
}

export async function xhsGetNoteComments(args: {
  note_id?: string;
  share_text?: string;
  index?: number;
  cursor?: string;
  sort_strategy?: string;
  limit?: number;
}): Promise<XiaohongshuEnvelope<XiaohongshuComment>> {
  const detail = await scrapeNoteDetail(args.note_id, args.share_text);
  const limit = args.limit || 20;
  const offset = Math.max(0, ((args.index || 1) - 1) * limit);
  const comments = detail.comments.slice(offset, offset + limit);
  return {
    endpoint: 'get_note_comments',
    items: comments,
    count: comments.length,
    input: args,
  };
}

async function scrapeNoteDetail(noteId?: string, shareText?: string): Promise<XiaohongshuNoteDetail> {
  const url = detailUrl(noteId, shareText);
  const tabId = await getTab(url);
  await new Promise((r) => setTimeout(r, 2500));
  await checkLoginRedirect(tabId, 'Xiaohongshu');

  const data = await executeInPage(tabId, () => {
    const text = (selector: string) => document.querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim() || '';
    const normalizeUrl = (value: string) => {
      if (!value || value.startsWith('data:')) return '';
      if (value.startsWith('//')) return `https:${value}`;
      if (value.startsWith('http://') || value.startsWith('https://')) return value;
      return '';
    };
    const images = Array.from(document.querySelectorAll('img'))
      .map((img) => normalizeUrl((img as HTMLImageElement).src || img.getAttribute('data-src') || ''))
      .filter((src) => src.includes('xhscdn.com') || src.includes('xiaohongshu.com'))
      .filter((src, idx, arr) => src && arr.indexOf(src) === idx)
      .slice(0, 20);
    const comments = Array.from(document.querySelectorAll('.comments-el .comment-item, .comment-item'))
      .slice(0, 80)
      .map((el, idx) => ({
        rank: idx + 1,
        text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 1000),
        author: el.querySelector('.author, .name, .username')?.textContent?.replace(/\s+/g, ' ').trim() || '',
        likes: el.querySelector('.like, .count')?.textContent?.replace(/\s+/g, ' ').trim() || '',
      }))
      .filter((comment) => !!comment.text);
    const title = document.title.replace(/\s*-\s*小红书\s*$/, '').trim();
    return {
      url: location.href,
      title,
      desc: text('#detail-desc .note-text') || text('.note-content .desc') || text('.note-text') || text('#detail-desc'),
      author: text('.author .username') || text('.username') || text('.user-name'),
      likes: text('.like-wrapper .count') || text('.engage-bar .count') || text('.like .count'),
      images,
      comments,
    };
  }, []);

  const resolvedId = noteId || extractNoteId((data as any).url) || extractNoteId(shareText || '');
  return {
    note_id: resolvedId,
    url: (data as any).url,
    title: (data as any).title,
    desc: (data as any).desc,
    author: (data as any).author,
    likes: (data as any).likes,
    images: (data as any).images || [],
    comments: (data as any).comments || [],
  };
}

export async function xhsSearchUsers(args: { keyword: string; page?: number; source?: string }): Promise<XiaohongshuEnvelope> {
  return notPursued('search_users', args, 'Not pursued for Xiaohongshu Wave 1: user-search channel repeatedly trips login-wall / account-risk flows.');
}

export async function xhsSearchProducts(args: { keyword: string; page?: number; source?: string }): Promise<XiaohongshuEnvelope> {
  return notPursued('search_products', args, 'Not pursued for Xiaohongshu Wave 1: desktop Web has no stable product-search tab/API; use product_detail/product_recommendations with a real sku_id.');
}

export async function xhsSearchGroups(args: { keyword: string; source?: string; search_id?: string }): Promise<XiaohongshuEnvelope> {
  const state = await scrapeSearchState(args.keyword);
  const items = normalizeSearchGroups(state);
  return {
    endpoint: 'search_groups',
    items,
    count: items.length,
    input: args,
  };
}

export async function xhsGetCreatorHotInspirationFeed(): Promise<XiaohongshuEnvelope> {
  return fetchCreatorGuidance({
    endpoint: 'get_creator_hot_inspiration_feed',
    hot: true,
    pageSize: 12,
  });
}

export async function xhsGetCreatorInspirationFeed(args: { source?: string }): Promise<XiaohongshuEnvelope> {
  return fetchCreatorGuidance({
    endpoint: 'get_creator_inspiration_feed',
    pageSize: 12,
    input: args,
  });
}

export async function xhsGetProductRecommendations(args: { region?: string; sku_id?: string }): Promise<XiaohongshuEnvelope> {
  const sku = assertId(args.sku_id, 'sku_id');
  const tabId = await getTab(goodsUrl(sku));
  await new Promise(r => setTimeout(r, 2000));
  const body: any = await fetchJsonInPage(tabId, `https://www.xiaohongshu.com/api/store/rf/skus/shop_recommend?sku_id=${encodeURIComponent(sku)}`);
  if (body?.success === false || (typeof body?.code === 'number' && body.code !== 0)) {
    throw new Error(`Xiaohongshu product recommendations failed: ${body?.msg || body?.code || 'unknown error'}`);
  }
  const rawItems = Array.isArray(body?.data)
    ? body.data
    : body?.data?.items || body?.data?.list || body?.data?.skus || [];
  const items = rawItems.map((item: any, idx: number) => compactProduct(item, idx + 1));
  return {
    endpoint: 'get_product_recommendations',
    items,
    count: items.length,
    input: args,
  };
}

export async function xhsGetProductReviews(args: { sku_id?: string; from_page?: string }): Promise<XiaohongshuEnvelope> {
  return notPursued('get_product_reviews', args, 'Not pursued for Xiaohongshu Wave 1: mall review API returned login-expired and risks account friction.');
}

export async function xhsGetProductDetail(args: { sku_id?: string; source?: string; pre_page?: string }): Promise<XiaohongshuEnvelope> {
  return dataEnvelope('get_product_detail', await fetchProductDetail(args.sku_id || ''), args);
}

export async function xhsGetProductReviewOverview(args: { sku_id?: string; tab?: string }): Promise<XiaohongshuEnvelope> {
  return notPursued('get_product_review_overview', args, 'Not pursued for Xiaohongshu Wave 1: mall review API returned login-expired and risks account friction.');
}

export async function xhsGetTopicInfo(args: { source?: string; page_id?: string }): Promise<XiaohongshuEnvelope> {
  return notPursued('get_topic_info', args, 'Not pursued for Xiaohongshu Wave 1: topic APIs need signed Web/App mapping and are not worth the account-risk tradeoff.');
}

export async function xhsGetTopicFeed(args: { sort?: string; source?: string; page_id?: string }): Promise<XiaohongshuEnvelope> {
  return notPursued('get_topic_feed', args, 'Not pursued for Xiaohongshu Wave 1: topic APIs need signed Web/App mapping and are not worth the account-risk tradeoff.');
}

export async function xhsGetUserFavedNotes(): Promise<XiaohongshuEnvelope> {
  return notPursued('get_user_faved_notes', {}, 'Not pursued for Xiaohongshu Wave 1: account-private favorites are high-risk and unnecessary for the accepted 9-endpoint surface.');
}
