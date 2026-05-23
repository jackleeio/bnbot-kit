/**
 * Reddit scrapers.
 *
 * Reddit exposes clean public JSON endpoints, so this file keeps the
 * browser-extension execution path while calling same-origin `*.json`
 * URLs from reddit.com. That preserves the SpareAPI provider model and
 * reuses the user's Reddit cookies where they matter.
 */

import { getTab, checkLoginRedirect, executeInPage } from '../../scraperService';

export interface RedditResult {
  rank: number;
  title: string;
  subreddit: string;
  author: string;
  score: number;
  comments: number;
  url: string;
}

export interface RedditHotResult {
  rank: number;
  title: string;
  subreddit: string;
  author: string;
  score: number;
  comments: number;
  url: string;
}

export interface RedditPost {
  rank: number;
  id: string;
  name: string;
  title: string;
  subreddit: string;
  subreddit_name_prefixed: string;
  author: string;
  score: number;
  ups: number;
  upvote_ratio: number | null;
  num_comments: number;
  url: string;
  permalink: string;
  domain: string;
  created_utc: number | null;
  is_self: boolean;
  selftext: string;
  over_18: boolean;
  spoiler: boolean;
  locked: boolean;
  stickied: boolean;
  thumbnail: string;
  num_crossposts: number;
}

export interface RedditComment {
  rank: number;
  id: string;
  name: string;
  parent_id: string;
  link_id: string;
  subreddit: string;
  subreddit_name_prefixed: string;
  author: string;
  body: string;
  score: number;
  ups: number;
  created_utc: number | null;
  permalink: string;
  depth: number;
}

export interface RedditSubreddit {
  rank: number;
  display_name: string;
  display_name_prefixed: string;
  title: string;
  public_description: string;
  subscribers: number;
  active_user_count: number | null;
  url: string;
  over_18: boolean;
  created_utc: number | null;
  icon_img: string;
  banner_img: string;
}

export interface RedditUser {
  username: string;
  name: string;
  id: string;
  post_karma: number;
  comment_karma: number;
  total_karma: number;
  awarder_karma: number;
  awardee_karma: number;
  created_utc: number | null;
  created: string;
  is_gold: boolean;
  is_mod: boolean;
  verified: boolean;
  has_verified_email: boolean;
  icon_img: string;
}

export interface RedditListingResult<T> {
  items: T[];
  count: number;
  after: string | null;
  before: string | null;
  source_url: string;
}

export interface RedditPostThread {
  post: RedditPost | null;
  comments: RedditComment[];
  count: number;
  source_url: string;
}

type QueryValue = string | number | boolean | null | undefined;

function cleanSubreddit(subreddit: string): string {
  return subreddit.replace(/^\/?r\//i, '').trim();
}

function cleanUsername(username: string): string {
  return username.replace(/^\/?u\//i, '').trim();
}

function cleanSort(sort: string | undefined, fallback: string): string {
  const s = (sort || fallback).toLowerCase();
  const allowed = new Set(['hot', 'new', 'top', 'rising', 'controversial', 'best']);
  return allowed.has(s) ? s : fallback;
}

function cleanTime(time: string | undefined, fallback = 'all'): string {
  const t = (time || fallback).toLowerCase();
  const allowed = new Set(['hour', 'day', 'week', 'month', 'year', 'all']);
  return allowed.has(t) ? t : fallback;
}

function cleanLimit(limit: number | undefined, fallback = 25): number {
  const n = Number.isFinite(limit) ? Math.trunc(limit as number) : fallback;
  return Math.max(1, Math.min(100, n));
}

function withParams(path: string, params: Record<string, QueryValue> = {}): string {
  const q = new URLSearchParams();
  q.set('raw_json', '1');
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === '') continue;
    q.set(key, String(value));
  }
  return `${path}?${q.toString()}`;
}

function listingPath(basePath: string, limit: number, params: Record<string, QueryValue> = {}): string {
  return withParams(basePath, { limit, ...params });
}

function postIdFrom(input: string): string {
  const value = decodeURIComponent(input);
  const match = value.match(/comments\/([a-z0-9]+)/i);
  if (match?.[1]) return match[1];
  return value.replace(/^t3_/, '').trim();
}

async function fetchRedditJson<T = any>(path: string, pageUrl = 'https://www.reddit.com'): Promise<T> {
  const tabId = await getTab(pageUrl);
  await checkLoginRedirect(tabId, 'Reddit');

  const result = await executeInPage<{ data?: T; error?: string }>(tabId, async (requestPath: string) => {
    try {
      const res = await fetch(requestPath, {
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) {
        return { error: 'Reddit request failed: HTTP ' + res.status + ' for ' + requestPath };
      }
      return { data: await res.json() };
    } catch (e: any) {
      return { error: e?.message || 'Reddit request failed' };
    }
  }, [path]);

  if (result?.error) throw new Error(result.error);
  return result?.data as T;
}

function absolutePermalink(permalink: string | undefined): string {
  if (!permalink) return '';
  return permalink.startsWith('http') ? permalink : `https://www.reddit.com${permalink}`;
}

function mapPostChild(child: any, idx: number): RedditPost {
  const d = child?.data || child || {};
  return {
    rank: idx + 1,
    id: d.id || '',
    name: d.name || (d.id ? `t3_${d.id}` : ''),
    title: d.title || '',
    subreddit: d.subreddit || '',
    subreddit_name_prefixed: d.subreddit_name_prefixed || (d.subreddit ? `r/${d.subreddit}` : ''),
    author: d.author || '[deleted]',
    score: d.score || 0,
    ups: d.ups || d.score || 0,
    upvote_ratio: typeof d.upvote_ratio === 'number' ? d.upvote_ratio : null,
    num_comments: d.num_comments || 0,
    url: d.url || absolutePermalink(d.permalink),
    permalink: absolutePermalink(d.permalink),
    domain: d.domain || '',
    created_utc: typeof d.created_utc === 'number' ? d.created_utc : null,
    is_self: !!d.is_self,
    selftext: d.selftext || '',
    over_18: !!d.over_18,
    spoiler: !!d.spoiler,
    locked: !!d.locked,
    stickied: !!d.stickied,
    thumbnail: d.thumbnail || '',
    num_crossposts: d.num_crossposts || 0,
  };
}

function mapCommentChild(child: any, idx: number, depth = 0): RedditComment {
  const d = child?.data || child || {};
  return {
    rank: idx + 1,
    id: d.id || '',
    name: d.name || (d.id ? `t1_${d.id}` : ''),
    parent_id: d.parent_id || '',
    link_id: d.link_id || '',
    subreddit: d.subreddit || '',
    subreddit_name_prefixed: d.subreddit_name_prefixed || (d.subreddit ? `r/${d.subreddit}` : ''),
    author: d.author || '[deleted]',
    body: d.body || '',
    score: d.score || 0,
    ups: d.ups || d.score || 0,
    created_utc: typeof d.created_utc === 'number' ? d.created_utc : null,
    permalink: absolutePermalink(d.permalink),
    depth,
  };
}

function mapSubredditChild(child: any, idx: number): RedditSubreddit {
  const d = child?.data || child || {};
  const display = d.display_name || '';
  return {
    rank: idx + 1,
    display_name: display,
    display_name_prefixed: d.display_name_prefixed || (display ? `r/${display}` : ''),
    title: d.title || '',
    public_description: d.public_description || '',
    subscribers: d.subscribers || 0,
    active_user_count: typeof d.active_user_count === 'number' ? d.active_user_count : null,
    url: absolutePermalink(d.url || (display ? `/r/${display}/` : '')),
    over_18: !!d.over18 || !!d.over_18,
    created_utc: typeof d.created_utc === 'number' ? d.created_utc : null,
    icon_img: d.icon_img || d.community_icon || '',
    banner_img: d.banner_img || d.banner_background_image || '',
  };
}

function mapUserData(raw: any, fallback: string): RedditUser {
  const d = raw?.data || raw || {};
  const createdUtc = typeof d.created_utc === 'number' ? d.created_utc : null;
  return {
    username: d.name || fallback,
    name: d.name || fallback,
    id: d.id || '',
    post_karma: d.link_karma || 0,
    comment_karma: d.comment_karma || 0,
    total_karma: d.total_karma || ((d.link_karma || 0) + (d.comment_karma || 0)),
    awarder_karma: d.awarder_karma || 0,
    awardee_karma: d.awardee_karma || 0,
    created_utc: createdUtc,
    created: createdUtc ? new Date(createdUtc * 1000).toISOString().split('T')[0] : '-',
    is_gold: !!d.is_gold,
    is_mod: !!d.is_mod,
    verified: !!d.verified,
    has_verified_email: !!d.has_verified_email,
    icon_img: d.icon_img || '',
  };
}

function postListing(raw: any, limit: number, sourceUrl: string): RedditListingResult<RedditPost> {
  const children = raw?.data?.children || [];
  const items = children.slice(0, limit).map((child: any, idx: number) => mapPostChild(child, idx));
  return {
    items,
    count: items.length,
    after: raw?.data?.after || null,
    before: raw?.data?.before || null,
    source_url: sourceUrl,
  };
}

function commentListing(raw: any, limit: number, sourceUrl: string): RedditListingResult<RedditComment> {
  const children = raw?.data?.children || [];
  const items = children
    .filter((child: any) => child?.kind === 't1' || child?.data?.body)
    .slice(0, limit)
    .map((child: any, idx: number) => mapCommentChild(child, idx));
  return {
    items,
    count: items.length,
    after: raw?.data?.after || null,
    before: raw?.data?.before || null,
    source_url: sourceUrl,
  };
}

function subredditListing(raw: any, limit: number, sourceUrl: string): RedditListingResult<RedditSubreddit> {
  const children = raw?.data?.children || [];
  const items = children.slice(0, limit).map((child: any, idx: number) => mapSubredditChild(child, idx));
  return {
    items,
    count: items.length,
    after: raw?.data?.after || null,
    before: raw?.data?.before || null,
    source_url: sourceUrl,
  };
}

function flattenComments(children: any[], out: RedditComment[], limit: number, depth = 0): void {
  for (const child of children) {
    if (out.length >= limit) return;
    if (child?.kind !== 't1') continue;
    out.push(mapCommentChild(child, out.length, depth));
    const replies = child?.data?.replies?.data?.children;
    if (Array.isArray(replies)) flattenComments(replies, out, limit, depth + 1);
  }
}

async function fetchPostListing(path: string, limit: number): Promise<RedditListingResult<RedditPost>> {
  const raw = await fetchRedditJson(path);
  return postListing(raw, limit, path);
}

async function fetchCommentListing(path: string, limit: number): Promise<RedditListingResult<RedditComment>> {
  const raw = await fetchRedditJson(path);
  return commentListing(raw, limit, path);
}

async function fetchSubredditListing(path: string, limit: number): Promise<RedditListingResult<RedditSubreddit>> {
  const raw = await fetchRedditJson(path);
  return subredditListing(raw, limit, path);
}

// ── Reddit34-compatible public read endpoints ─────────────────────

export async function getRedditPopularPosts(
  options: { sort?: string; limit?: number } = {},
): Promise<RedditListingResult<RedditPost>> {
  const limit = cleanLimit(options.limit);
  const sort = cleanSort(options.sort, 'hot');
  const path = listingPath(`/${sort}.json`, limit);
  return fetchPostListing(path, limit);
}

export async function getRedditTopPopularPosts(
  options: { time?: string; limit?: number } = {},
): Promise<RedditListingResult<RedditPost>> {
  const limit = cleanLimit(options.limit);
  const path = listingPath('/top.json', limit, { t: cleanTime(options.time, 'day') });
  return fetchPostListing(path, limit);
}

export async function getRedditRisingPopularPosts(
  options: { limit?: number } = {},
): Promise<RedditListingResult<RedditPost>> {
  const limit = cleanLimit(options.limit);
  const path = listingPath('/rising.json', limit);
  return fetchPostListing(path, limit);
}

export async function getRedditBestPopularPosts(
  options: { limit?: number } = {},
): Promise<RedditListingResult<RedditPost>> {
  const limit = cleanLimit(options.limit);
  const path = listingPath('/best.json', limit);
  return fetchPostListing(path, limit);
}

export async function getRedditPopularPostsByCountry(
  options: { country?: string; sort?: string; time?: string; limit?: number } = {},
): Promise<RedditListingResult<RedditPost>> {
  const limit = cleanLimit(options.limit);
  const sort = cleanSort(options.sort, 'hot');
  const params: Record<string, QueryValue> = { geo_filter: options.country || 'US' };
  if (sort === 'top' || sort === 'controversial') params.t = cleanTime(options.time, 'day');
  const path = listingPath(`/r/popular/${sort}.json`, limit, params);
  return fetchPostListing(path, limit);
}

export async function getRedditPostsBySubreddit(
  subreddit: string,
  options: { sort?: string; time?: string; limit?: number } = {},
): Promise<RedditListingResult<RedditPost>> {
  const limit = cleanLimit(options.limit);
  const sort = cleanSort(options.sort, 'hot');
  const sub = cleanSubreddit(subreddit);
  const params: Record<string, QueryValue> = {};
  if (sort === 'top' || sort === 'controversial') params.t = cleanTime(options.time, 'day');
  const path = listingPath(`/r/${sub}/${sort}.json`, limit, params);
  return fetchPostListing(path, limit);
}

export async function getRedditTopPostsBySubreddit(
  subreddit: string,
  options: { time?: string; limit?: number } = {},
): Promise<RedditListingResult<RedditPost>> {
  return getRedditPostsBySubreddit(subreddit, { sort: 'top', time: options.time, limit: options.limit });
}

export async function getRedditControversialPostsBySubreddit(
  subreddit: string,
  options: { time?: string; limit?: number } = {},
): Promise<RedditListingResult<RedditPost>> {
  return getRedditPostsBySubreddit(subreddit, { sort: 'controversial', time: options.time, limit: options.limit });
}

export async function getRedditCommentsBySubreddit(
  subreddit: string,
  options: { limit?: number } = {},
): Promise<RedditListingResult<RedditComment>> {
  const limit = cleanLimit(options.limit);
  const sub = cleanSubreddit(subreddit);
  const path = listingPath(`/r/${sub}/comments.json`, limit);
  return fetchCommentListing(path, limit);
}

export async function getRedditSubredditInfo(subreddit: string): Promise<RedditSubreddit> {
  const sub = cleanSubreddit(subreddit);
  const raw = await fetchRedditJson(`/r/${sub}/about.json?raw_json=1`);
  return mapSubredditChild(raw, 0);
}

export async function getRedditSubredditRules(subreddit: string): Promise<unknown> {
  const sub = cleanSubreddit(subreddit);
  const raw = await fetchRedditJson(`/r/${sub}/about/rules.json?raw_json=1`);
  const rules = raw?.rules || [];
  return {
    subreddit: sub,
    rules: rules.map((rule: any, idx: number) => ({
      rank: idx + 1,
      short_name: rule.short_name || '',
      description: rule.description || '',
      violation_reason: rule.violation_reason || '',
      kind: rule.kind || '',
    })),
    site_rules: raw?.site_rules || [],
    count: rules.length,
  };
}

export async function getRedditSimilarSubreddits(
  subreddit: string,
  options: { limit?: number } = {},
): Promise<RedditListingResult<RedditSubreddit>> {
  return searchRedditSubreddits(cleanSubreddit(subreddit), options);
}

export async function getRedditNewSubreddits(
  options: { limit?: number } = {},
): Promise<RedditListingResult<RedditSubreddit>> {
  const limit = cleanLimit(options.limit);
  const path = listingPath('/subreddits/new.json', limit);
  return fetchSubredditListing(path, limit);
}

export async function getRedditPopularSubreddits(
  options: { limit?: number } = {},
): Promise<RedditListingResult<RedditSubreddit>> {
  const limit = cleanLimit(options.limit);
  const path = listingPath('/subreddits/popular.json', limit);
  return fetchSubredditListing(path, limit);
}

export async function getRedditPostsByUsername(
  username: string,
  options: { sort?: string; time?: string; limit?: number } = {},
): Promise<RedditListingResult<RedditPost>> {
  const limit = cleanLimit(options.limit);
  const user = cleanUsername(username);
  const sort = cleanSort(options.sort, 'new');
  const path = listingPath(`/user/${user}/submitted.json`, limit, { sort, t: cleanTime(options.time, 'all') });
  return fetchPostListing(path, limit);
}

export async function getRedditTopPostsByUsername(
  username: string,
  options: { time?: string; limit?: number } = {},
): Promise<RedditListingResult<RedditPost>> {
  return getRedditPostsByUsername(username, { sort: 'top', time: options.time, limit: options.limit });
}

export async function getRedditCommentsByUsername(
  username: string,
  options: { sort?: string; time?: string; limit?: number } = {},
): Promise<RedditListingResult<RedditComment>> {
  const limit = cleanLimit(options.limit);
  const user = cleanUsername(username);
  const sort = cleanSort(options.sort, 'new');
  const path = listingPath(`/user/${user}/comments.json`, limit, { sort, t: cleanTime(options.time, 'all') });
  return fetchCommentListing(path, limit);
}

export async function getRedditTopCommentsByUsername(
  username: string,
  options: { time?: string; limit?: number } = {},
): Promise<RedditListingResult<RedditComment>> {
  return getRedditCommentsByUsername(username, { sort: 'top', time: options.time, limit: options.limit });
}

export async function getRedditUserOverview(
  username: string,
  options: { sort?: string; time?: string; limit?: number } = {},
): Promise<RedditListingResult<RedditPost | RedditComment>> {
  const limit = cleanLimit(options.limit);
  const user = cleanUsername(username);
  const sort = cleanSort(options.sort, 'new');
  const path = listingPath(`/user/${user}/overview.json`, limit, { sort, t: cleanTime(options.time, 'all') });
  const raw = await fetchRedditJson(path);
  const children = raw?.data?.children || [];
  const items = children.slice(0, limit).map((child: any, idx: number) => (
    child?.kind === 't1' ? mapCommentChild(child, idx) : mapPostChild(child, idx)
  ));
  return {
    items,
    count: items.length,
    after: raw?.data?.after || null,
    before: raw?.data?.before || null,
    source_url: path,
  };
}

export async function getRedditUserPostRankInSubreddit(
  username: string,
  subreddit: string,
  options: { sort?: string; limit?: number } = {},
): Promise<unknown> {
  const listing = await getRedditPostsByUsername(username, {
    sort: options.sort || 'new',
    limit: cleanLimit(options.limit, 100),
  });
  const sub = cleanSubreddit(subreddit).toLowerCase();
  const posts = listing.items
    .filter((post) => post.subreddit.toLowerCase() === sub)
    .map((post, idx) => ({ ...post, subreddit_rank: idx + 1 }));
  return {
    username: cleanUsername(username),
    subreddit: `r/${cleanSubreddit(subreddit)}`,
    sort: options.sort || 'new',
    posts,
    count: posts.length,
    scanned: listing.count,
  };
}

export async function getRedditProfile(username: string): Promise<RedditUser> {
  const user = cleanUsername(username);
  const raw = await fetchRedditJson(`/user/${user}/about.json?raw_json=1`);
  return mapUserData(raw, user);
}

export async function getRedditUserStats(username: string): Promise<unknown> {
  const profile = await getRedditProfile(username);
  return {
    username: profile.username,
    post_karma: profile.post_karma,
    comment_karma: profile.comment_karma,
    total_karma: profile.total_karma,
    awarder_karma: profile.awarder_karma,
    awardee_karma: profile.awardee_karma,
    created_utc: profile.created_utc,
    created: profile.created,
    is_gold: profile.is_gold,
    is_mod: profile.is_mod,
    verified: profile.verified,
  };
}

export async function searchRedditUsers(
  query: string,
  options: { limit?: number } = {},
): Promise<RedditListingResult<RedditUser>> {
  const limit = cleanLimit(options.limit);
  const path = listingPath('/users/search.json', limit, { q: query });
  const raw = await fetchRedditJson(path);
  const children = raw?.data?.children || [];
  const items = children.slice(0, limit).map((child: any) => mapUserData(child, query));
  return {
    items,
    count: items.length,
    after: raw?.data?.after || null,
    before: raw?.data?.before || null,
    source_url: path,
  };
}

export async function searchRedditPosts(
  query: string,
  options: { subreddit?: string; sort?: string; time?: string; limit?: number } = {},
): Promise<RedditListingResult<RedditPost>> {
  const limit = cleanLimit(options.limit);
  const sub = options.subreddit ? cleanSubreddit(options.subreddit) : '';
  const path = listingPath(sub ? `/r/${sub}/search.json` : '/search.json', limit, {
    q: query,
    sort: options.sort || 'relevance',
    t: cleanTime(options.time, 'all'),
    restrict_sr: sub ? 'on' : 'off',
  });
  return fetchPostListing(path, limit);
}

export async function searchRedditSubreddits(
  query: string,
  options: { limit?: number } = {},
): Promise<RedditListingResult<RedditSubreddit>> {
  const limit = cleanLimit(options.limit);
  const path = listingPath('/subreddits/search.json', limit, { q: query });
  return fetchSubredditListing(path, limit);
}

export async function getRedditPostDetails(postUrl: string): Promise<RedditPostThread> {
  return getRedditPostCommentsWithSort(postUrl, { sort: 'best', limit: 1 });
}

export async function getRedditPostComments(
  postUrl: string,
  options: { limit?: number } = {},
): Promise<RedditPostThread> {
  return getRedditPostCommentsWithSort(postUrl, { sort: 'best', limit: options.limit });
}

export async function getRedditPostCommentsWithSort(
  postUrl: string,
  options: { sort?: string; limit?: number } = {},
): Promise<RedditPostThread> {
  const limit = cleanLimit(options.limit, 50);
  const id = postIdFrom(postUrl);
  const sort = cleanSort(options.sort, 'best');
  const path = listingPath(`/comments/${id}.json`, limit, { sort, depth: 5 });
  const raw = await fetchRedditJson(path);
  if (!Array.isArray(raw)) throw new Error('Unexpected Reddit comments response');
  const post = raw[0]?.data?.children?.[0] ? mapPostChild(raw[0].data.children[0], 0) : null;
  const comments: RedditComment[] = [];
  flattenComments(raw[1]?.data?.children || [], comments, limit);
  return {
    post,
    comments,
    count: comments.length,
    source_url: path,
  };
}

export async function getRedditPostDuplicates(
  postUrl: string,
  options: { limit?: number } = {},
): Promise<unknown> {
  const limit = cleanLimit(options.limit);
  const id = postIdFrom(postUrl);
  const path = listingPath(`/duplicates/${id}.json`, limit);
  const raw = await fetchRedditJson(path);
  if (!Array.isArray(raw)) throw new Error('Unexpected Reddit duplicates response');
  const post = raw[0]?.data?.children?.[0] ? mapPostChild(raw[0].data.children[0], 0) : null;
  const duplicates = postListing(raw[1], limit, path);
  return {
    post,
    duplicates: duplicates.items,
    count: duplicates.count,
    after: duplicates.after,
    before: duplicates.before,
    source_url: path,
  };
}

// ── Legacy BNBot commands kept for back-compat ─────────────────────

export async function fetchRedditHot(
  limit = 20,
  options: { subreddit?: string } = {},
): Promise<RedditHotResult[]> {
  const data = options.subreddit
    ? await getRedditPostsBySubreddit(options.subreddit, { sort: 'hot', limit })
    : await getRedditPopularPosts({ sort: 'hot', limit });
  return data.items.map((post) => ({
    rank: post.rank,
    title: post.title,
    subreddit: post.subreddit_name_prefixed,
    author: post.author,
    score: post.score,
    comments: post.num_comments,
    url: post.permalink,
  }));
}

export async function searchReddit(
  query: string,
  limit = 15,
  options: { subreddit?: string; sort?: string; time?: string } = {},
): Promise<RedditResult[]> {
  const data = await searchRedditPosts(query, { ...options, limit });
  return data.items.map((post) => ({
    rank: post.rank,
    title: post.title,
    subreddit: post.subreddit_name_prefixed,
    author: post.author,
    score: post.score,
    comments: post.num_comments,
    url: post.permalink,
  }));
}

export async function redditUpvote(postId: string, direction: 'up' | 'down' | 'none' = 'up'): Promise<{ status: string; message: string }> {
  const tabId = await getTab('https://www.reddit.com');
  await checkLoginRedirect(tabId, 'Reddit');
  const data = await executeInPage(tabId, async (pid: string, dir: string) => {
    try {
      let id = pid;
      const urlMatch = id.match(/comments\/([a-z0-9]+)/);
      if (urlMatch) id = urlMatch[1];
      const fullname = id.startsWith('t3_') || id.startsWith('t1_') ? id : 't3_' + id;
      const voteDir = dir === 'down' ? -1 : dir === 'none' ? 0 : 1;
      const meRes = await fetch('/api/me.json', { credentials: 'include' });
      const me = await meRes.json();
      const modhash = me?.data?.modhash || '';
      const res = await fetch('/api/vote', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'id=' + encodeURIComponent(fullname) + '&dir=' + voteDir + (modhash ? '&uh=' + encodeURIComponent(modhash) : ''),
      });
      if (!res.ok) return { error: 'Reddit vote failed: HTTP ' + res.status };
      const labels: Record<string, string> = { '1': 'Upvoted', '-1': 'Downvoted', '0': 'Vote removed' };
      return { status: 'success', message: (labels[String(voteDir)] || 'Voted') + ' ' + fullname };
    } catch (e: any) { return { error: e.message || 'Reddit upvote failed' }; }
  }, [postId, direction]);
  if (data && typeof data === 'object' && 'error' in data) throw new Error((data as any).error);
  return data as any;
}

export async function redditSave(postId: string, undo = false): Promise<{ status: string; message: string }> {
  const tabId = await getTab('https://www.reddit.com');
  await checkLoginRedirect(tabId, 'Reddit');
  const data = await executeInPage(tabId, async (pid: string, unsave: boolean) => {
    try {
      let id = pid;
      const urlMatch = id.match(/comments\/([a-z0-9]+)/);
      if (urlMatch) id = urlMatch[1];
      const fullname = id.startsWith('t3_') || id.startsWith('t1_') ? id : 't3_' + id;
      const meRes = await fetch('/api/me.json', { credentials: 'include' });
      const me = await meRes.json();
      const modhash = me?.data?.modhash || '';
      const endpoint = unsave ? '/api/unsave' : '/api/save';
      const res = await fetch(endpoint, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'id=' + encodeURIComponent(fullname) + (modhash ? '&uh=' + encodeURIComponent(modhash) : ''),
      });
      if (!res.ok) return { error: 'Reddit save failed: HTTP ' + res.status };
      return { status: 'success', message: (unsave ? 'Unsaved' : 'Saved') + ' ' + fullname };
    } catch (e: any) { return { error: e.message || 'Reddit save failed' }; }
  }, [postId, undo]);
  if (data && typeof data === 'object' && 'error' in data) throw new Error((data as any).error);
  return data as any;
}

export async function getRedditFrontpage(limit = 15): Promise<RedditHotResult[]> {
  const data = await fetchPostListing(listingPath('/r/all.json', cleanLimit(limit)), cleanLimit(limit));
  return data.items.map((post) => ({
    rank: post.rank,
    title: post.title,
    subreddit: post.subreddit_name_prefixed,
    author: post.author,
    score: post.score,
    comments: post.num_comments,
    url: post.permalink,
  }));
}

export async function getRedditPost(postId: string, limit = 25, sort = 'best'): Promise<any[]> {
  const thread = await getRedditPostCommentsWithSort(postId, { limit, sort });
  const results: any[] = [];
  if (thread.post) {
    const body = thread.post.selftext.substring(0, 2000);
    results.push({
      type: 'POST',
      author: thread.post.author || '[deleted]',
      score: thread.post.score || 0,
      text: thread.post.title + (body ? '\n\n' + body : ''),
    });
  }
  for (const comment of thread.comments) {
    results.push({
      type: `L${comment.depth}`,
      author: comment.author || '[deleted]',
      score: comment.score || 0,
      text: comment.body.substring(0, 500),
    });
  }
  return results;
}

export async function getRedditUser(username: string): Promise<any> {
  const u = await getRedditProfile(username);
  return {
    username: `u/${u.username}`,
    postKarma: u.post_karma,
    commentKarma: u.comment_karma,
    totalKarma: u.total_karma,
    created: u.created,
    gold: u.is_gold,
    verified: u.verified,
  };
}

export async function redditSubscribe(subreddit: string, undo = false): Promise<{ status: string; message: string }> {
  const tabId = await getTab('https://www.reddit.com');
  await checkLoginRedirect(tabId, 'Reddit');
  const data = await executeInPage(tabId, async (sub: string, unsub: boolean) => {
    try {
      const name = sub.startsWith('r/') ? sub.slice(2) : sub;
      const action = unsub ? 'unsub' : 'sub';
      const meRes = await fetch('/api/me.json', { credentials: 'include' });
      const me = await meRes.json();
      const modhash = me?.data?.modhash || '';
      const res = await fetch('/api/subscribe', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'sr_name=' + encodeURIComponent(name) + '&action=' + action + (modhash ? '&uh=' + encodeURIComponent(modhash) : ''),
      });
      if (!res.ok) return { error: 'Reddit subscribe failed: HTTP ' + res.status };
      const label = unsub ? 'Unsubscribed from' : 'Subscribed to';
      return { status: 'success', message: label + ' r/' + name };
    } catch (e: any) { return { error: e.message || 'Reddit subscribe failed' }; }
  }, [subreddit, undo]);
  if (data && typeof data === 'object' && 'error' in data) throw new Error((data as any).error);
  return data as any;
}
