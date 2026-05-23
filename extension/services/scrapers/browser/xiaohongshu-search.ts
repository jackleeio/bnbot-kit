/**
 * Xiaohongshu (Little Red Book) browser scraper — DOM-based extraction from search results.
 *
 * Reference: opencli xiaohongshu/search.ts
 * Navigates to XHS search_result page and scrapes rendered `.note-item` elements.
 */

import { getTab, checkLoginRedirect, executeInPage } from '../../scraperService';

export interface XiaohongshuSearchResult {
  rank: number;
  title: string;
  author: string;
  likes: string;
  published_at: string;
  url: string;
  /** Cover image URL on `sns-webpic-qc.xhscdn.com`. Empty string when
   *  the lazy-load placeholder hasn't resolved yet. */
  cover: string;
}

/**
 * Extract approximate publish date from a Xiaohongshu note URL.
 * XHS note IDs follow MongoDB ObjectID format where the first 8 hex
 * characters encode a Unix timestamp.
 */
function noteIdToDate(url: string): string {
  const match = url.match(/\/(?:search_result|explore|note)\/([0-9a-f]{24})(?=[?#/]|$)/i);
  if (!match) return '';
  const hex = match[1].substring(0, 8);
  const ts = parseInt(hex, 16);
  if (!ts || ts < 1_000_000_000 || ts > 4_000_000_000) return '';
  return new Date((ts + 8 * 3600) * 1000).toISOString().slice(0, 10);
}

export async function searchXiaohongshu(query: string, limit = 20): Promise<XiaohongshuSearchResult[]> {
  const url = `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(query)}&source=web_search_result_notes`;
  const tabId = await getTab(url);
  await new Promise(r => setTimeout(r, 3000));
  await checkLoginRedirect(tabId, 'Xiaohongshu');

  // Trigger lazy-load: XHS only resolves cover `<img src>` once the card
  // intersects the viewport. Without this nudge the first ~6 cards have
  // real images and the rest stay on data-src placeholders, leaving most
  // results with empty `cover` fields.
  await executeInPage(tabId, () => {
    return new Promise<void>(resolve => {
      const start = Date.now();
      const stepMs = 300;
      const totalMs = 3500;
      const tick = () => {
        window.scrollBy({ top: window.innerHeight * 0.9, behavior: 'auto' });
        if (Date.now() - start >= totalMs) {
          window.scrollTo({ top: 0, behavior: 'auto' });
          setTimeout(resolve, 250);
          return;
        }
        setTimeout(tick, stepMs);
      };
      tick();
    });
  }, []);

  const data = await executeInPage(tabId, (lim: number) => {
      try {
        const normalizeUrl = (href: string) => {
          if (!href) return '';
          if (href.startsWith('http://') || href.startsWith('https://')) return href;
          if (href.startsWith('/')) return 'https://www.xiaohongshu.com' + href;
          return '';
        };
        const cleanText = (value: string) => (value || '').replace(/\s+/g, ' ').trim();

        const results: any[] = [];
        const seen = new Set<string>();

        // Pull the highest-resolution cover URL we can find on the card.
        // Strategy:
        //   1) Prefer an explicit `src` on the cover-anchor's <img> (set
        //      after lazy-load completes).
        //   2) Fall back to common XHS lazy-load attributes used before
        //      hydration: `data-src`, `data-xhs-cover`, then any
        //      background-image on `.cover` / `.lazy-img`.
        //   3) `srcset` (when present) gives a higher-density variant —
        //      pick the last entry which is typically the largest.
        const extractCover = (el: Element): string => {
          const img = el.querySelector('a.cover img, .cover img, img.cover-image, .note-img img, .lazy-img');
          if (img instanceof HTMLImageElement) {
            const ss = img.getAttribute('srcset') || '';
            if (ss) {
              const last = ss.split(',').map(s => s.trim().split(' ')[0]).filter(Boolean).pop();
              if (last) return normalizeUrl(last);
            }
            if (img.src && !img.src.startsWith('data:')) return normalizeUrl(img.src);
            const ds = img.getAttribute('data-src') || img.getAttribute('data-xhs-cover') || '';
            if (ds) return normalizeUrl(ds);
          }
          const bgEl = el.querySelector('.cover, .lazy-img, .note-cover');
          if (bgEl instanceof HTMLElement) {
            const bg = getComputedStyle(bgEl).backgroundImage || '';
            const m = bg.match(/url\(["']?([^"')]+)["']?\)/);
            if (m && m[1] && !m[1].startsWith('data:')) return normalizeUrl(m[1]);
          }
          return '';
        };

        document.querySelectorAll('section.note-item').forEach(el => {
          if ((el as HTMLElement).classList.contains('query-note-item')) return;

          const titleEl = el.querySelector('.title, .note-title, a.title, .footer .title span');
          const nameEl = el.querySelector('a.author .name, .name, .author-name, .nick-name, a.author');
          const likesEl = el.querySelector('.count, .like-count, .like-wrapper .count');
          const detailLinkEl =
            el.querySelector('a.cover.mask') ||
            el.querySelector('a[href*="/search_result/"]') ||
            el.querySelector('a[href*="/explore/"]') ||
            el.querySelector('a[href*="/note/"]');

          const url = normalizeUrl(detailLinkEl?.getAttribute('href') || '');
          if (!url) return;
          if (seen.has(url)) return;
          seen.add(url);

          results.push({
            title: cleanText(titleEl?.textContent || ''),
            author: cleanText(nameEl?.textContent || ''),
            likes: cleanText(likesEl?.textContent || '0'),
            url,
            cover: extractCover(el),
          });
        });

        const filtered = results.filter(r => r.title).slice(0, lim);

        if (filtered.length === 0) {
          const url = window.location.href;
          const bodyText = document.body.innerText || '';
          if (
            url.includes('/login')
            || url.includes('/signin')
            || url.includes('passport.')
            || document.title.includes('登录')
            || document.title.includes('Sign in')
            || document.title.includes('Log in')
            || bodyText.includes('登录后查看搜索结果')
            || bodyText.includes('登录后探索更多内容')
            || bodyText.includes('请先登录')
          ) {
            return { error: 'Please sign in to Xiaohongshu first' };
          }
        }

        return filtered;
      } catch (e: any) {
        return { error: e.message || 'Xiaohongshu scraper failed — please sign in to Xiaohongshu first' };
      }
    }, [limit]);

  if (data && typeof data === 'object' && 'error' in data) throw new Error((data as any).error);
  const raw: any[] = data || [];
  return raw.map((item, i) => ({
    rank: i + 1,
    title: item.title,
    author: item.author,
    likes: item.likes,
    published_at: noteIdToDate(item.url),
    url: item.url,
    cover: item.cover || '',
  }));
}
