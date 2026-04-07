/**
 * Medium browser scraper — DOM-based extraction from search results.
 *
 * Reference: opencli medium/search.ts + medium/utils.ts
 * Navigates to medium.com/search and scrapes rendered `article` elements.
 */

import { getTab, checkLoginRedirect, executeInPage } from '../../scraperService';

export interface MediumSearchResult {
  rank: number;
  title: string;
  author: string;
  date: string;
  readTime: string;
  claps: string;
  description: string;
  url: string;
}

export async function searchMedium(query: string, limit = 20): Promise<MediumSearchResult[]> {
  const safeLimit = Math.max(1, Math.min(limit, 50));
  const url = `https://medium.com/search?q=${encodeURIComponent(query)}`;
  const tabId = await getTab(url);
  await new Promise(r => setTimeout(r, 4000));
  await checkLoginRedirect(tabId, 'Medium');

  const data = await executeInPage(tabId, async (lim: number) => {
      try {
        // Extra wait for article elements to render
        await new Promise(r => setTimeout(r, 3000));

        const normalize = (value: string) => (value || '').replace(/\s+/g, ' ').trim();
        const posts: any[] = [];
        const seen = new Set<string>();

        for (const article of Array.from(document.querySelectorAll('article'))) {
          try {
            const titleEl = article.querySelector('h2, h3, h1');
            const title = normalize(titleEl?.textContent || '');
            if (!title) continue;

            const linkEl = titleEl?.closest('a') || article.querySelector('a[href*="/@"], a[href*="/p/"]');
            let url = linkEl?.getAttribute('href') || '';
            if (!url) continue;
            if (!url.startsWith('http')) url = 'https://medium.com' + url;
            if (seen.has(url)) continue;

            const author = normalize(
              Array.from(article.querySelectorAll('a[href^="/@"]'))
                .map(node => normalize(node.textContent || ''))
                .find(text => text && text !== title) || '',
            );

            const allText = normalize(article.textContent || '');
            const dateEl = article.querySelector('time');
            const date = normalize(dateEl?.textContent || '') ||
              dateEl?.getAttribute('datetime') ||
              (allText.match(/\b(?:[A-Z][a-z]{2}\s+\d{1,2}|\d+[dhmw]\s+ago)\b/) || [''])[0];

            const readTime = (allText.match(/(\d+)\s*min\s*read/i) || [''])[0];
            const claps = (allText.match(/\b(\d+(?:\.\d+)?[KkMm]?)\s*claps?\b/i) || ['', ''])[1];

            const description = normalize(
              Array.from(article.querySelectorAll('h3, p'))
                .map(node => normalize(node.textContent || ''))
                .find(text => text && text !== title && text !== author && !/member-only story|response icon/i.test(text)) || '',
            );

            seen.add(url);
            posts.push({
              title,
              author,
              date,
              readTime,
              claps,
              description: description ? description.slice(0, 150) : '',
              url,
            });

            if (posts.length >= lim) break;
          } catch { /* skip malformed articles */ }
        }

        if (posts.length === 0) {
          const url = window.location.href;
          if (url.includes('/login') || url.includes('/signin') || url.includes('passport.') || document.title.includes('登录') || document.title.includes('Sign in') || document.title.includes('Log in')) {
            return { error: 'Please sign in to Medium first' };
          }
        }

        return posts;
      } catch (e: any) {
        return { error: e.message || 'Medium scraper failed — please sign in to Medium first' };
      }
    }, [safeLimit]);

  if (data && typeof data === 'object' && 'error' in data) throw new Error((data as any).error);
  const raw: any[] = data || [];
  return raw.map((item, i) => ({
    rank: i + 1,
    ...item,
  }));
}
