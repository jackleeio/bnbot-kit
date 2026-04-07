/**
 * Facebook browser scraper — DOM-based extraction from search results.
 *
 * Reference: opencli facebook/search.yaml
 * Navigates to facebook.com/search and scrapes `[role="article"]` or
 * `[role="listitem"]` elements.
 */

import { getTab, checkLoginRedirect, executeInPage } from '../../scraperService';

export interface FacebookSearchResult {
  rank: number;
  title: string;
  text: string;
  url: string;
}

export async function searchFacebook(query: string, limit = 10): Promise<FacebookSearchResult[]> {
  const safeLimit = Math.max(1, Math.min(limit, 50));
  // First ensure we have a tab on facebook.com (for cookies), then navigate to search
  const tabId = await getTab('https://www.facebook.com/search/posts/?q=' + encodeURIComponent(query));
  await new Promise(r => setTimeout(r, 4000));
  await checkLoginRedirect(tabId, 'Facebook');

  const data = await executeInPage(tabId, (lim: number) => {
      try {
        // Search results are in role="article" or role="listitem"
        let items = document.querySelectorAll('[role="article"]');
        if (items.length === 0) {
          items = document.querySelectorAll('[role="listitem"]');
        }

        const filtered = Array.from(items).filter(el => (el.textContent || '').trim().length > 20);
        if (filtered.length === 0) {
          const bodyText = document.body?.innerText?.slice(0, 200) || '';
          if (bodyText.includes('Not Found') || bodyText.includes('Log in') || bodyText.includes('Sign Up') || document.title.includes('Log in') || document.title.includes('Facebook') && bodyText.length < 100) {
            return { error: 'Please sign in to Facebook first: facebook.com' };
          }
        }

        return filtered
          .slice(0, lim)
          .map((el, i) => {
            const link = el.querySelector('a[href*="facebook.com/"]') as HTMLAnchorElement | null;
            const heading = el.querySelector('h2, h3, h4, strong');
            return {
              rank: i + 1,
              title: heading ? (heading.textContent || '').trim().substring(0, 80) : '',
              text: (el.textContent || '').trim().replace(/\s+/g, ' ').substring(0, 150),
              url: link ? link.href.split('?')[0] : '',
            };
          });
      } catch (e: any) {
        return { error: e.message || 'Facebook scraper failed — please sign in to Facebook first' };
      }
    }, [safeLimit]);

  if (data && typeof data === 'object' && 'error' in data) throw new Error((data as any).error);
  return data || [];
}
