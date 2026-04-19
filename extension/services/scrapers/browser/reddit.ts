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
  const tabId = await getTab('https://www.reddit.com');
  await checkLoginRedirect(tabId, 'Reddit');
  const data = await executeInPage(tabId, async (lim: number) => {
    try {
      const res = await fetch('/r/all.json?limit=' + lim + '&raw_json=1', { credentials: 'include' });
      if (!res.ok) return { error: 'Reddit frontpage failed: HTTP ' + res.status };
      const d = await res.json();
      return (d?.data?.children || []).slice(0, lim).map((c: any, idx: number) => ({
        rank: idx + 1, title: c.data.title, subreddit: c.data.subreddit_name_prefixed,
        author: c.data.author, score: c.data.score, comments: c.data.num_comments,
        url: 'https://www.reddit.com' + c.data.permalink,
      }));
    } catch (e: any) { return { error: e.message || 'Reddit frontpage failed' }; }
  }, [limit]);
  if (data && typeof data === 'object' && 'error' in data) throw new Error((data as any).error);
  return data || [];
}

export async function getRedditPost(postId: string, limit = 25, sort = 'best'): Promise<any[]> {
  const tabId = await getTab('https://www.reddit.com');
  await checkLoginRedirect(tabId, 'Reddit');
  const data = await executeInPage(tabId, async (pid: string, lim: number, sortBy: string) => {
    try {
      let id = pid;
      const urlMatch = id.match(/comments\/([a-z0-9]+)/);
      if (urlMatch) id = urlMatch[1];
      const res = await fetch('/comments/' + id + '.json?sort=' + sortBy + '&limit=' + lim + '&depth=3&raw_json=1', { credentials: 'include' });
      if (!res.ok) return { error: 'Reddit read failed: HTTP ' + res.status };
      const resp = await res.json();
      if (!Array.isArray(resp) || resp.length < 2) return { error: 'Unexpected response format' };
      const results: any[] = [];
      const post = resp[0]?.data?.children?.[0]?.data;
      if (post) {
        const body = (post.selftext || '').substring(0, 2000);
        results.push({ type: 'POST', author: post.author || '[deleted]', score: post.score || 0, text: post.title + (body ? '\n\n' + body : '') });
      }
      function walkComment(node: any, depth: number) {
        if (!node || node.kind !== 't1') return;
        const d = node.data;
        results.push({ type: 'L' + depth, author: d.author || '[deleted]', score: d.score || 0, text: (d.body || '').substring(0, 500) });
        if (depth < 2 && d.replies?.data?.children) {
          const children = d.replies.data.children.filter((c: any) => c.kind === 't1').slice(0, 5);
          children.forEach((c: any) => walkComment(c, depth + 1));
        }
      }
      const topLevel = (resp[1]?.data?.children || []).filter((c: any) => c.kind === 't1').slice(0, lim);
      topLevel.forEach((c: any) => walkComment(c, 0));
      return results;
    } catch (e: any) { return { error: e.message || 'Reddit post read failed' }; }
  }, [postId, limit, sort]);
  if (data && typeof data === 'object' && 'error' in data) throw new Error((data as any).error);
  return data || [];
}

export async function getRedditUser(username: string): Promise<any> {
  const tabId = await getTab('https://www.reddit.com');
  await checkLoginRedirect(tabId, 'Reddit');
  const data = await executeInPage(tabId, async (name: string) => {
    try {
      const uname = name.startsWith('u/') ? name.slice(2) : name;
      const res = await fetch('/user/' + uname + '/about.json?raw_json=1', { credentials: 'include' });
      if (!res.ok) return { error: 'Reddit user failed: HTTP ' + res.status };
      const d = await res.json();
      const u = d?.data || d || {};
      const created = u.created_utc ? new Date(u.created_utc * 1000).toISOString().split('T')[0] : '-';
      return {
        username: 'u/' + (u.name || uname), postKarma: u.link_karma || 0,
        commentKarma: u.comment_karma || 0,
        totalKarma: u.total_karma || ((u.link_karma || 0) + (u.comment_karma || 0)),
        created, gold: u.is_gold ? true : false, verified: u.verified ? true : false,
      };
    } catch (e: any) { return { error: e.message || 'Reddit user lookup failed' }; }
  }, [username]);
  if (data && typeof data === 'object' && 'error' in data) throw new Error((data as any).error);
  return data;
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
