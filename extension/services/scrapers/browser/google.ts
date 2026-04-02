/**
 * Google browser scraper — DOM-based extraction from search results.
 *
 * Reference: opencli google/search.ts
 * Navigates to google.com/search and scrapes the `#rso` container.
 * Extracts featured snippets, standard results, and People Also Ask.
 */

import { getTab, checkLoginRedirect, waitForLoad } from '../../scraperService';

export interface GoogleSearchResult {
  type: 'snippet' | 'result' | 'paa';
  title: string;
  url: string;
  snippet: string;
}

export interface GoogleNewsResult {
  rank: number;
  title: string;
  source: string;
  date: string;
  url: string;
}

export async function searchGoogleNews(
  query?: string,
  limit = 10,
  options: { lang?: string; region?: string } = {},
): Promise<GoogleNewsResult[]> {
  const { lang = 'en', region = 'US' } = options;
  const safeLimit = Math.max(1, Math.min(limit, 100));
  const ceid = `${region}:${lang}`;

  // Google News RSS is a public API — fetch from news.google.com tab to avoid CORS issues
  const rssUrl = query
    ? `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=${lang}&gl=${region}&ceid=${ceid}`
    : `https://news.google.com/rss?hl=${lang}&gl=${region}&ceid=${ceid}`;

  const tabId = await getTab('https://news.google.com');
  await new Promise(r => setTimeout(r, 2000));

  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: async (url: string, lim: number) => {
      try {
        const resp = await fetch(url);
        if (!resp.ok) return { error: 'Google News fetch failed: HTTP ' + resp.status };
        const xml = await resp.text();

        const items: any[] = [];
        const itemRegex = /<item>([\s\S]*?)<\/item>/g;
        let match;
        while ((match = itemRegex.exec(xml)) && items.length < lim) {
          const block = match[1];
          let title = block.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.trim() ?? '';
          const linkMatch = block.match(/<link\/?>\s*([\s\S]*?)(?=<)/);
          const url = linkMatch ? linkMatch[1].trim() : (block.match(/<link>([\s\S]*?)<\/link>/)?.[1]?.trim() ?? '');
          const pubDate = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1]?.trim() ?? '';
          // <source> element or parse from title
          const sourceMatch = block.match(/<source[^>]*>([\s\S]*?)<\/source>/);
          let source = sourceMatch ? sourceMatch[1].trim() : '';
          if (!source) {
            const idx = title.lastIndexOf(' - ');
            if (idx !== -1) {
              source = title.slice(idx + 3);
              title = title.slice(0, idx);
            }
          }
          if (title) {
            items.push({
              rank: items.length + 1,
              title,
              source,
              date: pubDate,
              url,
            });
          }
        }
        return items;
      } catch (e: any) {
        return { error: e.message || 'Google News scraper failed' };
      }
    },
    args: [rssUrl, safeLimit],
  });

  const data = results[0]?.result;
  if (data && typeof data === 'object' && 'error' in data) throw new Error((data as any).error);
  return data || [];
}

export async function searchGoogle(
  query: string,
  options: { limit?: number; lang?: string } = {},
): Promise<GoogleSearchResult[]> {
  const { limit = 10, lang = 'en' } = options;
  const safeLimit = Math.max(1, Math.min(limit, 100));
  const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=${encodeURIComponent(lang)}&num=${safeLimit}`;
  const tabId = await getTab(url);
  await new Promise(r => setTimeout(r, 3000));

  // Handle Google consent page — click "Accept all" / "I agree" if present
  await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: () => {
      // Google consent form buttons
      const consentBtn = document.querySelector('button#L2AGLb')           // "Accept all" (EU)
        || document.querySelector('form[action*="consent"] button')        // Generic consent form
        || document.querySelector('button[jsname="higCR"]');               // "I agree" variant
      if (consentBtn) (consentBtn as HTMLElement).click();
    },
    args: [],
  });

  // Wait for potential redirect after consent
  await new Promise(r => setTimeout(r, 2000));

  // Re-navigate to the search URL in case consent redirected us
  const tab = await chrome.tabs.get(tabId);
  if (tab.url && !tab.url.includes('/search?')) {
    await chrome.tabs.update(tabId, { url });
    await waitForLoad(tabId);
    await new Promise(r => setTimeout(r, 2000));
  }

  await checkLoginRedirect(tabId, 'Google');

  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: () => {
      try {
      const results: any[] = [];
      const seenUrls: Record<string, boolean> = {};

      // Check for CAPTCHA / unusual traffic page
      if (document.querySelector('#captcha-form') || document.querySelector('form[action*="CaptchaRedirect"]')
        || document.body?.textContent?.includes('unusual traffic from your computer')) {
        return { error: 'Google is showing a CAPTCHA — please solve it manually in the browser tab, then retry' };
      }

      const rso = document.querySelector('#rso');
      // Fallback: try #search if #rso is not found
      const searchContainer = rso || document.querySelector('#search');
      if (!searchContainer) return results;

      // -- Featured snippet --
      const featuredEl = searchContainer.querySelector('.xpdopen .hgKElc') || searchContainer.querySelector('.IZ6rdc');
      if (featuredEl) {
        const parentBlock = featuredEl.closest('[data-hveid]') || featuredEl.parentElement;
        const fLink = parentBlock ? parentBlock.querySelector('a[href]') : null;
        const fUrl = (fLink as HTMLAnchorElement)?.href || '';
        if (fUrl) seenUrls[fUrl] = true;
        results.push({
          type: 'snippet',
          title: (featuredEl.textContent || '').trim().slice(0, 200),
          url: fUrl,
          snippet: '',
        });
      }

      // -- Standard search results: find all links containing h3 --
      const allLinks = searchContainer.querySelectorAll('a');
      for (let i = 0; i < allLinks.length; i++) {
        const link = allLinks[i] as HTMLAnchorElement;
        const h3 = link.querySelector('h3');
        if (!h3) continue;

        const href = link.href || '';
        if (!/^https?:\/\//.test(href)) continue;
        if (href.indexOf('google.com/search') !== -1) continue;
        if (seenUrls[href]) continue;
        seenUrls[href] = true;

        // Walk up to find result container for snippet extraction
        let container: HTMLElement = link;
        for (let j = 0; j < 6; j++) {
          if (container.parentElement && container.parentElement !== searchContainer) {
            container = container.parentElement;
          }
          if (container.getAttribute && container.getAttribute('data-hveid')) break;
        }

        // Find snippet text
        let snippetText = '';
        const titleText = (h3.textContent || '').trim();
        const candidates = container.querySelectorAll('span, div');
        for (let k = 0; k < candidates.length; k++) {
          const el = candidates[k];
          if (el.querySelector('h3') || el.querySelector('a[href]')) continue;
          const text = (el.textContent || '').trim();
          if (text.length < 40 || text.length > 500) continue;
          if (text === titleText) continue;
          if (text.indexOf('\u203A') !== -1) continue;
          if (/https?:\/\//.test(text.slice(0, 60))) continue;
          snippetText = text;
          break;
        }

        results.push({
          type: 'result',
          title: titleText,
          url: href,
          snippet: snippetText.slice(0, 300),
        });
      }

      // -- People Also Ask --
      const paaContainers = document.querySelectorAll('[data-sgrd="true"]');
      for (let i = 0; i < paaContainers.length; i++) {
        const questionEl = paaContainers[i].querySelector('span.CSkcDe');
        if (questionEl) {
          results.push({
            type: 'paa',
            title: (questionEl.textContent || '').trim(),
            url: '',
            snippet: '',
          });
        }
      }

      if (results.length === 0) {
        const url = window.location.href;
        if (url.includes('/login') || url.includes('/signin') || url.includes('passport.') || document.title.includes('登录') || document.title.includes('Sign in') || document.title.includes('Log in')) {
          return { error: 'Please sign in to Google first' };
        }
        if (url.includes('consent.google') || url.includes('/sorry/')) {
          return { error: 'Google is showing a consent/block page — please resolve it in the browser tab, then retry' };
        }
      }

      return results;
      } catch (e: any) {
        return { error: e.message || 'Google scraper failed' };
      }
    },
    args: [],
  });

  const data = results[0]?.result;
  if (data && typeof data === 'object' && 'error' in data) throw new Error((data as any).error);
  return data || [];
}
