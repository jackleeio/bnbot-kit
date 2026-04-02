/**
 * 36kr article search — DOM extraction strategy.
 *
 * Reference: opencli 36kr/search.ts (INTERCEPT strategy, simplified to DOM scraping).
 * Navigates to the 36kr search results page and extracts article cards from DOM.
 */

import { getTab, checkLoginRedirect } from '../../scraperService';

export interface Kr36Result {
  rank: number;
  title: string;
  date: string;
  url: string;
}

export interface Kr36HotResult {
  rank: number;
  title: string;
  url: string;
}

export async function fetch36KrHot(
  limit = 20,
  options: { type?: 'renqi' | 'zonghe' | 'shoucang' | 'catalog' } = {},
): Promise<Kr36HotResult[]> {
  const count = Math.min(limit, 50);
  const listType = options.type || 'catalog';

  // Build URL based on list type
  let hotUrl: string;
  if (listType === 'catalog') {
    hotUrl = 'https://www.36kr.com/hot-list/catalog';
  } else {
    // Shanghai date (UTC+8)
    const now = new Date();
    const shanghaiDate = new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
    hotUrl = `https://www.36kr.com/hot-list/${listType}/${shanghaiDate}/1`;
  }

  const tabId = await getTab(hotUrl);
  await new Promise(r => setTimeout(r, 4000));
  await checkLoginRedirect(tabId, '36Kr');

  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: (lim: number) => {
      try {
        const seen = new Set<string>();
        const items: any[] = [];
        const links = document.querySelectorAll('a[href*="/p/"]');
        for (const el of links) {
          const href = el.getAttribute('href') || '';
          const title = (el.textContent || '').trim();
          if (!title || title.length < 5 || seen.has(href) || seen.has(title)) continue;
          seen.add(href);
          seen.add(title);
          items.push({
            rank: items.length + 1,
            title,
            url: href.startsWith('http') ? href : 'https://36kr.com' + href,
          });
          if (items.length >= lim) break;
        }
        if (items.length === 0) {
          const url = window.location.href;
          if (url.includes('/login') || url.includes('/signin') || url.includes('passport.') || document.title.includes('登录') || document.title.includes('Sign in') || document.title.includes('Log in')) {
            return { error: 'Please sign in to 36Kr first' };
          }
        }
        return items;
      } catch (e: any) {
        return { error: e.message || '36kr hot scraper failed' };
      }
    },
    args: [count],
  });

  const data = results[0]?.result;
  if (data && typeof data === 'object' && 'error' in data) throw new Error((data as any).error);
  return data || [];
}

export interface Kr36NewsResult {
  rank: number;
  title: string;
  summary: string;
  date: string;
  url: string;
}

export async function fetch36KrNews(limit = 20): Promise<Kr36NewsResult[]> {
  const count = Math.min(limit, 50);
  // 36kr has a public RSS feed — fetch it via a tab on 36kr.com
  const tabId = await getTab('https://www.36kr.com');
  await checkLoginRedirect(tabId, '36Kr');

  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: async (lim: number) => {
      try {
        const resp = await fetch('https://www.36kr.com/feed');
        if (!resp.ok) return { error: '36kr news feed failed: HTTP ' + resp.status };
        const xml = await resp.text();

        const items: any[] = [];
        const itemRegex = /<item>([\s\S]*?)<\/item>/g;
        let match;
        while ((match = itemRegex.exec(xml)) && items.length < lim) {
          const block = match[1];
          const title = block.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.trim() ?? '';
          const url =
            block.match(/<link><!\[CDATA\[(.*?)\]\]>/)?.[1] ??
            block.match(/<link>(.*?)<\/link>/)?.[1] ??
            '';
          const pubDate = block.match(/<pubDate>(.*?)<\/pubDate>/)?.[1]?.trim() ?? '';
          const date = pubDate.slice(0, 10);
          const rawDesc = block.match(/<description><!\[CDATA\[([\s\S]*?)\]\]>/)?.[1] ?? '';
          const summary = rawDesc
            .replace(/<[^>]+>/g, ' ')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 120);

          if (title) {
            items.push({ rank: items.length + 1, title, summary, date, url: url.trim() });
          }
        }
        return items;
      } catch (e: any) {
        return { error: e.message || '36kr news scraper failed' };
      }
    },
    args: [count],
  });

  const data = results[0]?.result;
  if (data && typeof data === 'object' && 'error' in data) throw new Error((data as any).error);
  return data || [];
}

export async function search36Kr(query: string, limit = 20): Promise<Kr36Result[]> {
  const count = Math.min(limit, 50);
  const tabId = await getTab(`https://www.36kr.com/search/articles/${encodeURIComponent(query)}`);
  await new Promise(r => setTimeout(r, 4000));
  await checkLoginRedirect(tabId, '36Kr');

  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: (lim: number) => {
      try {
        const seen = new Set<string>();
        const items: any[] = [];

        // Primary: article-item-title links pointing to /p/ articles
        const titleEls = document.querySelectorAll('.article-item-title a[href*="/p/"], .article-item-title[href*="/p/"]');
        for (const el of titleEls) {
          if (items.length >= lim) break;
          const href = el.getAttribute('href') || '';
          const title = el.textContent?.trim() || '';
          if (!title || seen.has(href)) continue;
          seen.add(href);
          const item = el.closest('[class*="article-item"]') || el.parentElement;
          const dateEl = item?.querySelector('[class*="time"], [class*="date"], time');
          items.push({
            rank: items.length + 1,
            title,
            date: dateEl?.textContent?.trim() || '',
            url: href.startsWith('http') ? href : 'https://36kr.com' + href,
          });
        }

        // Fallback: generic /p/ links with meaningful text
        if (items.length === 0) {
          const links = document.querySelectorAll('a[href*="/p/"]');
          for (const el of links) {
            if (items.length >= lim) break;
            const href = el.getAttribute('href') || '';
            const title = el.textContent?.trim() || '';
            if (!title || title.length < 8 || seen.has(href) || seen.has(title)) continue;
            seen.add(href);
            seen.add(title);
            items.push({
              rank: items.length + 1,
              title,
              date: '',
              url: href.startsWith('http') ? href : 'https://36kr.com' + href,
            });
          }
        }

        if (items.length === 0) {
          const url = window.location.href;
          if (url.includes('/login') || url.includes('/signin') || url.includes('passport.') || document.title.includes('登录') || document.title.includes('Sign in') || document.title.includes('Log in')) {
            return { error: 'Please sign in to 36Kr first' };
          }
        }

        return items;
      } catch (e: any) {
        return { error: e.message || '36kr scraper failed' };
      }
    },
    args: [count],
  });

  const data = results[0]?.result;
  if (data && typeof data === 'object' && 'error' in data) throw new Error((data as any).error);
  return data || [];
}
