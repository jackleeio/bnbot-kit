/**
 * Douban browser scraper — DOM-based extraction from search results.
 *
 * Reference: opencli douban/search.ts + douban/utils.ts
 * Navigates to search.douban.com and scrapes rendered `.item-root` elements.
 */

import { getTab, checkLoginRedirect } from '../../scraperService';

export interface DoubanSearchResult {
  rank: number;
  id: string;
  type: string;
  title: string;
  rating: number;
  abstract: string;
  url: string;
  cover: string;
}

export interface DoubanMovieHotResult {
  rank: number;
  title: string;
  rating: number;
  quote: string;
  director: string;
  year: string;
  region: string;
  url: string;
}

export async function fetchDoubanMovieHot(limit = 20): Promise<DoubanMovieHotResult[]> {
  const safeLimit = Math.max(1, Math.min(limit, 50));
  const tabId = await getTab('https://movie.douban.com/chart');
  await new Promise(r => setTimeout(r, 4000));
  await checkLoginRedirect(tabId, 'Douban');

  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: (lim: number) => {
      try {
        const normalize = (value: string) => (value || '').replace(/\s+/g, ' ').trim();
        const items: any[] = [];
        for (const el of Array.from(document.querySelectorAll('.item'))) {
          const titleEl = el.querySelector('.pl2 a');
          const title = normalize(titleEl?.textContent || '');
          let url = titleEl?.getAttribute('href') || '';
          if (!title || !url) continue;
          if (!url.startsWith('http')) url = 'https://movie.douban.com' + url;

          const info = normalize(el.querySelector('.pl2 p')?.textContent || '');
          const infoParts = info.split('/').map((p: string) => p.trim()).filter(Boolean);
          const releaseIndex = (() => {
            for (let i = infoParts.length - 1; i >= 0; i--) {
              if (/\d{4}-\d{2}-\d{2}|\d{4}\/\d{2}\/\d{2}/.test(infoParts[i])) return i;
            }
            return -1;
          })();
          const directorPart = releaseIndex >= 1 ? infoParts[releaseIndex - 1] : '';
          const regionPart = releaseIndex >= 2 ? infoParts[releaseIndex - 2] : '';
          const yearMatch = info.match(/\b(19|20)\d{2}\b/);
          items.push({
            rank: items.length + 1,
            title,
            rating: parseFloat(normalize(el.querySelector('.rating_nums')?.textContent || '')) || 0,
            quote: normalize(el.querySelector('.inq')?.textContent || ''),
            director: directorPart.replace(/^导演:\s*/, ''),
            year: yearMatch?.[0] || '',
            region: regionPart,
            url,
          });
          if (items.length >= lim) break;
        }
        if (items.length === 0) {
          const url = window.location.href;
          if (url.includes('/login') || url.includes('/signin') || url.includes('passport.') || url.includes('sec.douban.com') || document.title.includes('登录') || document.title.includes('Sign in') || document.title.includes('Log in')) {
            return { error: 'Please sign in to Douban first' };
          }
        }
        return items;
      } catch (e: any) {
        return { error: e.message || 'Douban movie hot scraper failed' };
      }
    },
    args: [safeLimit],
  });

  const data = results[0]?.result;
  if (data && typeof data === 'object' && 'error' in data) throw new Error((data as any).error);
  return data || [];
}

export interface DoubanBookHotResult {
  rank: number;
  title: string;
  rating: number;
  quote: string;
  author: string;
  publisher: string;
  year: string;
  url: string;
}

export async function fetchDoubanBookHot(limit = 20): Promise<DoubanBookHotResult[]> {
  const safeLimit = Math.max(1, Math.min(limit, 50));
  const tabId = await getTab('https://book.douban.com/chart');
  await new Promise(r => setTimeout(r, 4000));
  await checkLoginRedirect(tabId, 'Douban');

  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: (lim: number) => {
      try {
        const normalize = (value: string) => (value || '').replace(/\s+/g, ' ').trim();
        const books: any[] = [];
        for (const el of Array.from(document.querySelectorAll('.media.clearfix'))) {
          const titleEl = el.querySelector('h2 a[href*="/subject/"]');
          const title = normalize(titleEl?.textContent || '');
          let url = titleEl?.getAttribute('href') || '';
          if (!title || !url) continue;
          if (!url.startsWith('http')) url = 'https://book.douban.com' + url;

          const info = normalize(el.querySelector('.subject-abstract, .pl, .pub')?.textContent || '');
          const infoParts = info.split('/').map((p: string) => p.trim()).filter(Boolean);
          const ratingText = normalize(el.querySelector('.subject-rating .font-small, .rating_nums, .rating')?.textContent || '');
          const quote = Array.from(el.querySelectorAll('.subject-tags .tag'))
            .map((node: Element) => normalize(node.textContent || ''))
            .filter(Boolean)
            .join(' / ');

          books.push({
            rank: parseInt(normalize(el.querySelector('.green-num-box')?.textContent || ''), 10) || books.length + 1,
            title,
            rating: parseFloat(ratingText) || 0,
            quote,
            author: infoParts[0] || '',
            publisher: infoParts.find((part: string) => /出版社|出版公司|Press/i.test(part)) || infoParts[2] || '',
            year: infoParts.find((part: string) => /\d{4}(?:-\d{1,2})?/.test(part))?.match(/\d{4}/)?.[0] || '',
            url,
          });
          if (books.length >= lim) break;
        }
        if (books.length === 0) {
          const url = window.location.href;
          if (url.includes('/login') || url.includes('/signin') || url.includes('passport.') || url.includes('sec.douban.com') || document.title.includes('登录') || document.title.includes('Sign in') || document.title.includes('Log in')) {
            return { error: 'Please sign in to Douban first' };
          }
        }
        return books;
      } catch (e: any) {
        return { error: e.message || 'Douban book hot scraper failed' };
      }
    },
    args: [safeLimit],
  });

  const data = results[0]?.result;
  if (data && typeof data === 'object' && 'error' in data) throw new Error((data as any).error);
  return data || [];
}

export interface DoubanTop250Result {
  rank: number;
  id: string;
  title: string;
  rating: number;
  url: string;
}

export async function fetchDoubanTop250(limit = 250): Promise<DoubanTop250Result[]> {
  const safeLimit = Math.max(1, Math.min(limit, 250));
  const tabId = await getTab('https://movie.douban.com/top250');
  await new Promise(r => setTimeout(r, 4000));
  await checkLoginRedirect(tabId, 'Douban');

  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: async (lim: number) => {
      try {
        const allResults: any[] = [];

        const parsePage = (doc: Document) => {
          const items = doc.querySelectorAll('.item');
          for (const item of items) {
            if (allResults.length >= lim) break;
            const rankEl = item.querySelector('.pic em');
            const linkEl = item.querySelector('a');
            const titleEl = item.querySelector('.title');
            const ratingEl = item.querySelector('.rating_num');

            const href = (linkEl as HTMLAnchorElement)?.href || '';
            const matchResult = href.match(/subject\/(\d+)/);
            const id = matchResult ? matchResult[1] : '';
            const title = (titleEl?.textContent || '').trim();
            const rank = parseInt(rankEl?.textContent || '0', 10);
            const rating = (ratingEl?.textContent || '').trim();

            if (id && title) {
              allResults.push({
                rank: rank || allResults.length + 1,
                id,
                title,
                rating: rating ? parseFloat(rating) : 0,
                url: href,
              });
            }
          }
        };

        parsePage(document);

        for (let start = 25; start < 250 && allResults.length < lim; start += 25) {
          const resp = await fetch('https://movie.douban.com/top250?start=' + start, {
            credentials: 'include',
          });
          if (!resp.ok) break;
          const html = await resp.text();
          if (!html) break;
          const doc = new DOMParser().parseFromString(html, 'text/html');
          parsePage(doc);
          await new Promise(r => setTimeout(r, 150));
        }

        if (allResults.length === 0) {
          const url = window.location.href;
          if (url.includes('/login') || url.includes('/signin') || url.includes('passport.') || url.includes('sec.douban.com') || document.title.includes('登录') || document.title.includes('Sign in') || document.title.includes('Log in')) {
            return { error: 'Please sign in to Douban first' };
          }
        }
        return allResults;
      } catch (e: any) {
        return { error: e.message || 'Douban top250 scraper failed' };
      }
    },
    args: [safeLimit],
  });

  const data = results[0]?.result;
  if (data && typeof data === 'object' && 'error' in data) throw new Error((data as any).error);
  return data || [];
}

export async function searchDouban(
  query: string,
  options: { type?: 'movie' | 'book' | 'music'; limit?: number } = {},
): Promise<DoubanSearchResult[]> {
  const { type = 'movie', limit = 20 } = options;
  const safeLimit = Math.max(1, Math.min(limit, 50));
  const url = `https://search.douban.com/${encodeURIComponent(type)}/subject_search?search_text=${encodeURIComponent(query)}`;
  const tabId = await getTab(url);
  await new Promise(r => setTimeout(r, 3000));
  await checkLoginRedirect(tabId, 'Douban');

  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: async (searchType: string, lim: number) => {
      try {
        const normalize = (value: string) => (value || '').replace(/\s+/g, ' ').trim();

        // Wait for items to render (Douban sometimes loads slowly)
        for (let i = 0; i < 20; i++) {
          if (document.querySelector('.item-root .title-text, .item-root .title a')) break;
          await new Promise(r => setTimeout(r, 300));
        }

        const items = Array.from(document.querySelectorAll('.item-root'));
        const seen = new Set<string>();
        const results: any[] = [];

        for (const el of items) {
          const titleEl = el.querySelector('.title-text, .title a, a[title]');
          const title = normalize(titleEl?.textContent || '') || normalize(titleEl?.getAttribute('title') || '');
          let url = titleEl?.getAttribute('href') || '';
          if (!title || !url) continue;
          if (!url.startsWith('http')) url = 'https://search.douban.com' + url;
          if (!url.includes('/subject/') || seen.has(url)) continue;
          seen.add(url);

          const ratingText = normalize(el.querySelector('.rating_nums')?.textContent || '');
          const abstract = normalize(
            el.querySelector('.meta.abstract, .meta, .abstract, p')?.textContent || '',
          );

          results.push({
            id: url.match(/subject\/(\d+)/)?.[1] || '',
            type: searchType,
            title,
            rating: ratingText.includes('.') ? parseFloat(ratingText) : 0,
            abstract: abstract.slice(0, 100) + (abstract.length > 100 ? '...' : ''),
            url,
            cover: el.querySelector('img')?.getAttribute('src') || '',
          });

          if (results.length >= lim) break;
        }

        if (results.length === 0) {
          const url = window.location.href;
          if (url.includes('/login') || url.includes('/signin') || url.includes('passport.') || document.title.includes('登录') || document.title.includes('Sign in') || document.title.includes('Log in')) {
            return { error: 'Please sign in to Douban first' };
          }
        }

        return results;
      } catch (e: any) {
        return { error: e.message || 'Douban scraper failed' };
      }
    },
    args: [type, safeLimit],
  });

  const data = results[0]?.result;
  if (data && typeof data === 'object' && 'error' in data) throw new Error((data as any).error);
  const raw: any[] = data || [];
  return raw.map((item, i) => ({
    rank: i + 1,
    ...item,
  }));
}
