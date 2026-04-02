/**
 * Weibo browser scraper — DOM-based extraction from search results.
 *
 * Reference: opencli weibo/search.ts
 * Navigates to s.weibo.com and scrapes rendered `.card-wrap` elements.
 */

import { getTab, checkLoginRedirect } from '../../scraperService';

export interface WeiboSearchResult {
  rank: number;
  title: string;
  author: string;
  time: string;
  url: string;
}

export interface WeiboHotResult {
  rank: number;
  word: string;
  hotValue: number;
  category: string;
  label: string;
  url: string;
}

export async function fetchWeiboHot(limit = 30): Promise<WeiboHotResult[]> {
  const count = Math.min(limit, 50);
  const tabId = await getTab('https://weibo.com');
  await new Promise(r => setTimeout(r, 3000));
  await checkLoginRedirect(tabId, 'Weibo');

  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: async (lim: number) => {
      try {
        const resp = await fetch('/ajax/statuses/hot_band', { credentials: 'include' });
        if (!resp.ok) return { error: 'Weibo hot failed: HTTP ' + resp.status + ' — please sign in to Weibo first' };
        const data = await resp.json();
        if (!data.ok) return { error: 'Weibo hot API error' };
        const bandList = data.data?.band_list || [];
        if (bandList.length === 0) {
          const url = window.location.href;
          if (url.includes('/login') || url.includes('/signin') || url.includes('passport.') || document.title.includes('登录') || document.title.includes('Sign in') || document.title.includes('Log in')) {
            return { error: 'Please sign in to Weibo first' };
          }
        }
        return bandList.slice(0, lim).map((item: any, i: number) => ({
          rank: item.realpos || (i + 1),
          word: item.word || '',
          hotValue: item.num || 0,
          category: item.category || '',
          label: item.label_name || '',
          url: 'https://s.weibo.com/weibo?q=' + encodeURIComponent('#' + item.word + '#'),
        }));
      } catch (e: any) {
        return { error: e.message || 'Weibo hot scraper failed' };
      }
    },
    args: [count],
  });

  const data = results[0]?.result;
  if (data && typeof data === 'object' && 'error' in data) throw new Error((data as any).error);
  return data || [];
}

export async function searchWeibo(query: string, limit = 10): Promise<WeiboSearchResult[]> {
  const safeLimit = Math.max(1, Math.min(limit, 50));
  const url = `https://s.weibo.com/weibo?q=${encodeURIComponent(query)}`;
  const tabId = await getTab(url);
  await new Promise(r => setTimeout(r, 3000));

  await checkLoginRedirect(tabId, 'Weibo');

  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: (lim: number) => {
      try {
        const clean = (value: string) => (value || '').replace(/\s+/g, ' ').trim();
        const absoluteUrl = (href: string) => {
          if (!href) return '';
          if (href.startsWith('http://') || href.startsWith('https://')) return href;
          if (href.startsWith('//')) return window.location.protocol + href;
          if (href.startsWith('/')) return window.location.origin + href;
          return href;
        };

        const cards = Array.from(document.querySelectorAll('.card-wrap'));
        const rows: any[] = [];

        for (const card of cards) {
          const contentEl =
            card.querySelector('[node-type="feed_list_content_full"]') ||
            card.querySelector('[node-type="feed_list_content"]') ||
            card.querySelector('.txt');
          const authorEl =
            card.querySelector('.info .name') ||
            card.querySelector('.name');
          const timeEl = card.querySelector('.from a');
          const urlEl =
            card.querySelector('.from a[href*="/detail/"]') ||
            card.querySelector('.from a[href*="/status/"]') ||
            timeEl;

          const title = clean(contentEl?.textContent || '');
          if (!title) continue;

          rows.push({
            title,
            author: clean(authorEl?.textContent || ''),
            time: clean(timeEl?.textContent || ''),
            url: absoluteUrl(urlEl?.getAttribute('href') || ''),
          });

          if (rows.length >= lim) break;
        }

        if (rows.length === 0) {
          const loginWall = document.querySelector('.login-wrap, .LoginCard, [node-type="loginAction"]');
          if (loginWall || document.title.includes('登录')) {
            return { error: 'Please sign in to Weibo first: s.weibo.com' };
          }
        }

        return rows;
      } catch (e: any) {
        return { error: e.message || 'Weibo scraper failed — please sign in to Weibo first' };
      }
    },
    args: [safeLimit],
  });

  const data = results[0]?.result;
  if (data && typeof data === 'object' && 'error' in data) throw new Error((data as any).error);
  const raw: any[] = data || [];
  return raw.map((item, i) => ({
    rank: i + 1,
    ...item,
  }));
}
