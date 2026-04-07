/**
 * Linux.do (Discourse) search scraper — uses Discourse JSON search API with browser cookies.
 *
 * API: /search.json?q=...
 * Returns topic results with title, views, likes, replies.
 */

import { getTab, checkLoginRedirect, executeInPage } from '../../scraperService';

export interface LinuxDoResult {
  rank: number;
  title: string;
  views: number;
  likes: number;
  replies: number;
  url: string;
}

export async function searchLinuxDo(query: string, limit = 20): Promise<LinuxDoResult[]> {
  const tabId = await getTab('https://linux.do');
  await checkLoginRedirect(tabId, 'Linux.do');

  const data = await executeInPage(tabId, async (q: string, lim: number) => {
      try {
        const res = await fetch('/search.json?q=' + encodeURIComponent(q), { credentials: 'include' });
        if (!res.ok) return { error: 'Linux.do search failed: HTTP ' + res.status + ' — please sign in to Linux.do first' };
        let data: any;
        try {
          data = await res.json();
        } catch {
          return { error: 'Response is not valid JSON — please sign in to Linux.do first' };
        }
        const topics = data?.topics || [];
        if (topics.length === 0) {
          const url = window.location.href;
          if (url.includes('/login') || url.includes('/signin') || url.includes('passport.') || document.title.includes('登录') || document.title.includes('Sign in') || document.title.includes('Log in')) {
            return { error: 'Please sign in to Linux.do first' };
          }
        }
        return topics.slice(0, lim).map((t: any, idx: number) => ({
          rank: idx + 1,
          title: t.title,
          views: t.views || 0,
          likes: t.like_count || 0,
          replies: (t.posts_count || 1) - 1,
          url: 'https://linux.do/t/topic/' + t.id,
        }));
      } catch (e: any) {
        return { error: e.message || 'Linux.do scraper failed' };
      }
    }, [query, limit]);

  if (data && typeof data === 'object' && 'error' in data) throw new Error((data as any).error);
  return data || [];
}
