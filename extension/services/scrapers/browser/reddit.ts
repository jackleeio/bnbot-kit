/**
 * Reddit search scraper — uses Reddit's JSON API with browser cookies.
 *
 * API: /search.json?q=...&sort=...&t=...&limit=...
 * Supports subreddit-scoped search and sort/time filters.
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

export async function fetchRedditHot(
  limit = 20,
  options: { subreddit?: string } = {},
): Promise<RedditHotResult[]> {
  const tabId = await getTab('https://www.reddit.com');
  await checkLoginRedirect(tabId, 'Reddit');

  const data = await executeInPage(tabId, async (lim: number, subreddit: string) => {
      try {
        const path = subreddit ? '/r/' + subreddit + '/hot.json' : '/hot.json';
        const res = await fetch(path + '?limit=' + lim + '&raw_json=1', {
          credentials: 'include'
        });
        if (!res.ok) return { error: 'Reddit hot failed: HTTP ' + res.status + ' — please sign in to Reddit first' };
        const d = await res.json();
        const children = d?.data?.children || [];
        if (children.length === 0) {
          const url = window.location.href;
          if (url.includes('/login') || url.includes('/signin') || url.includes('passport.') || document.title.includes('登录') || document.title.includes('Sign in') || document.title.includes('Log in')) {
            return { error: 'Please sign in to Reddit first' };
          }
        }
        return children.slice(0, lim).map((c: any, idx: number) => ({
          rank: idx + 1,
          title: c.data.title,
          subreddit: c.data.subreddit_name_prefixed,
          author: c.data.author,
          score: c.data.score,
          comments: c.data.num_comments,
          url: 'https://www.reddit.com' + c.data.permalink,
        }));
      } catch (e: any) {
        return { error: e.message || 'Reddit hot scraper failed' };
      }
    }, [limit, options.subreddit || '']);

  if (data && typeof data === 'object' && 'error' in data) throw new Error((data as any).error);
  return data || [];
}

export async function searchReddit(
  query: string,
  limit = 15,
  options: { subreddit?: string; sort?: string; time?: string } = {},
): Promise<RedditResult[]> {
  const tabId = await getTab('https://www.reddit.com');
  await checkLoginRedirect(tabId, 'Reddit');

  const data = await executeInPage(tabId, async (q: string, lim: number, subreddit: string, sort: string, time: string) => {
      try {
        const basePath = subreddit ? `/r/${subreddit}/search.json` : '/search.json';
        const params =
          'q=' + encodeURIComponent(q) +
          '&sort=' + sort +
          '&t=' + time +
          '&limit=' + lim +
          '&restrict_sr=' + (subreddit ? 'on' : 'off') +
          '&raw_json=1';
        const res = await fetch(basePath + '?' + params, { credentials: 'include' });
        if (!res.ok) return { error: 'Reddit search failed: HTTP ' + res.status + ' — please sign in to Reddit first' };
        const d = await res.json();
        const children = d?.data?.children || [];
        if (children.length === 0) {
          const url = window.location.href;
          if (url.includes('/login') || url.includes('/signin') || url.includes('passport.') || document.title.includes('登录') || document.title.includes('Sign in') || document.title.includes('Log in')) {
            return { error: 'Please sign in to Reddit first' };
          }
        }
        return children.map((c: any, idx: number) => ({
          rank: idx + 1,
          title: c.data.title,
          subreddit: c.data.subreddit_name_prefixed,
          author: c.data.author,
          score: c.data.score,
          comments: c.data.num_comments,
          url: 'https://www.reddit.com' + c.data.permalink,
        }));
      } catch (e: any) {
        return { error: e.message || 'Reddit scraper failed' };
      }
    }, [query, limit, options.subreddit || '', options.sort || 'relevance', options.time || 'all']);

  if (data && typeof data === 'object' && 'error' in data) throw new Error((data as any).error);
  return data || [];
}
