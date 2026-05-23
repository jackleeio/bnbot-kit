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
  const limit = args.limit || 20;
  const items = await searchXiaohongshu(args.keyword, limit);
  return wrapSearch('search_images', items.filter((item) => !!item.cover), args);
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
  return unsupported('search_users', args, 'Xiaohongshu Web user search requires a signed API mapping; only note search is verified.');
}

export async function xhsSearchProducts(args: { keyword: string; page?: number; source?: string }): Promise<XiaohongshuEnvelope> {
  return unsupported('search_products', args, 'Xiaohongshu Web product search requires mall API signing and has not been mapped yet.');
}

export async function xhsSearchGroups(args: { keyword: string; source?: string; search_id?: string }): Promise<XiaohongshuEnvelope> {
  return unsupported('search_groups', args, 'Xiaohongshu group search is app-specific; no stable Web endpoint mapped yet.');
}

export async function xhsGetCreatorHotInspirationFeed(): Promise<XiaohongshuEnvelope> {
  return unsupported('get_creator_hot_inspiration_feed', {}, 'Creator inspiration feed lives in creator/app APIs; Web mapping not verified.');
}

export async function xhsGetCreatorInspirationFeed(args: { source?: string }): Promise<XiaohongshuEnvelope> {
  return unsupported('get_creator_inspiration_feed', args, 'Creator inspiration feed lives in creator/app APIs; Web mapping not verified.');
}

export async function xhsGetProductRecommendations(args: { region?: string; sku_id?: string }): Promise<XiaohongshuEnvelope> {
  return unsupported('get_product_recommendations', args, 'Product recommendation endpoint needs signed mall API mapping.');
}

export async function xhsGetProductReviews(args: { sku_id?: string; from_page?: string }): Promise<XiaohongshuEnvelope> {
  return unsupported('get_product_reviews', args, 'Product reviews endpoint needs signed mall API mapping.');
}

export async function xhsGetProductDetail(args: { sku_id?: string; source?: string; pre_page?: string }): Promise<XiaohongshuEnvelope> {
  return unsupported('get_product_detail', args, 'Product detail endpoint needs signed mall API mapping.');
}

export async function xhsGetProductReviewOverview(args: { sku_id?: string; tab?: string }): Promise<XiaohongshuEnvelope> {
  return unsupported('get_product_review_overview', args, 'Product review overview endpoint needs signed mall API mapping.');
}

export async function xhsGetTopicInfo(args: { source?: string; page_id?: string }): Promise<XiaohongshuEnvelope> {
  return unsupported('get_topic_info', args, 'Topic info endpoint needs signed topic API mapping.');
}

export async function xhsGetTopicFeed(args: { sort?: string; source?: string; page_id?: string }): Promise<XiaohongshuEnvelope> {
  return unsupported('get_topic_feed', args, 'Topic feed endpoint needs signed topic API mapping.');
}

export async function xhsGetUserFavedNotes(): Promise<XiaohongshuEnvelope> {
  return unsupported('get_user_faved_notes', {}, 'User faved notes require account-specific signed API mapping.');
}
