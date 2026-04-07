/**
 * Zhihu search scraper — uses Zhihu's v4 search API with browser cookies.
 *
 * API: /api/v4/search_v3?q=...&t=general&offset=0&limit=...
 * Filters results to type === 'search_result' and constructs URLs based on object type.
 */

import { getTab, checkLoginRedirect, executeInPage } from '../../scraperService';

export interface ZhihuResult {
  rank: number;
  title: string;
  type: string;
  excerpt: string;
  author: string;
  votes: number;
  url: string;
}

export interface ZhihuHotResult {
  rank: number;
  title: string;
  heat: string;
  answerCount: number;
  followerCount: number;
  url: string;
}

export async function fetchZhihuHot(limit = 20): Promise<ZhihuHotResult[]> {
  const tabId = await getTab('https://www.zhihu.com');
  await checkLoginRedirect(tabId, 'Zhihu');

  const data = await executeInPage(tabId, async (lim: number) => {
      try {
        const res = await fetch('https://www.zhihu.com/api/v3/feed/topstory/hot-lists/total?limit=50', {
          credentials: 'include',
        });
        if (!res.ok) return { error: 'Zhihu hot failed: HTTP ' + res.status + ' — please sign in to Zhihu first' };
        const text = await res.text();
        // Big integer IDs can overflow JSON.parse, wrap them in quotes
        const d = JSON.parse(
          text.replace(/("id"\s*:\s*)(\d{16,})/g, '$1"$2"')
        );
        const items = d?.data || [];
        if (items.length === 0) {
          const url = window.location.href;
          if (url.includes('/login') || url.includes('/signin') || url.includes('passport.') || document.title.includes('登录') || document.title.includes('Sign in') || document.title.includes('Log in')) {
            return { error: 'Please sign in to Zhihu first' };
          }
        }
        return items.slice(0, lim).map((item: any, idx: number) => {
          const t = item.target || {};
          const questionId = t.id == null ? '' : String(t.id);
          return {
            rank: idx + 1,
            title: t.title || '',
            heat: item.detail_text || '',
            answerCount: t.answer_count || 0,
            followerCount: t.follower_count || 0,
            url: 'https://www.zhihu.com/question/' + questionId,
          };
        });
      } catch (e: any) {
        return { error: e.message || 'Zhihu hot scraper failed' };
      }
    }, [limit]);

  if (data && typeof data === 'object' && 'error' in data) throw new Error((data as any).error);
  return data || [];
}

export async function searchZhihu(query: string, limit = 10): Promise<ZhihuResult[]> {
  const tabId = await getTab('https://www.zhihu.com');
  await checkLoginRedirect(tabId, 'Zhihu');

  const data = await executeInPage(tabId, async (q: string, lim: number) => {
      try {
        const strip = (html: string) =>
          (html || '')
            .replace(/<[^>]+>/g, '')
            .replace(/&nbsp;/g, ' ')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&amp;/g, '&')
            .replace(/<em>/g, '')
            .replace(/<\/em>/g, '')
            .trim();

        // Request more than needed since many items are ads/non-search_result type
        const fetchLimit = Math.max(lim * 3, 20);
        const allFiltered: any[] = [];
        let offset = 0;

        // Paginate until we have enough results or run out
        for (let page = 0; page < 3 && allFiltered.length < lim; page++) {
          const res = await fetch(
            'https://www.zhihu.com/api/v4/search_v3?q=' +
              encodeURIComponent(q) +
              '&t=general&offset=' + offset + '&limit=' + fetchLimit,
            { credentials: 'include' },
          );
          if (!res.ok) return { error: 'Zhihu search failed: HTTP ' + res.status + ' — please sign in to Zhihu first' };
          const d = await res.json();

          const items = (d?.data || [])
            .filter((item: any) => item.type === 'search_result');
          allFiltered.push(...items);

          // Check if there are more pages
          if (!d?.paging?.is_end === false || (d?.data || []).length === 0) break;
          offset += fetchLimit;
        }

        const finalItems = allFiltered.slice(0, lim);

        if (finalItems.length === 0) {
          const url = window.location.href;
          if (url.includes('/login') || url.includes('/signin') || url.includes('passport.') || document.title.includes('登录') || document.title.includes('Sign in') || document.title.includes('Log in')) {
            return { error: 'Please sign in to Zhihu first' };
          }
        }

        return finalItems.map((item: any, idx: number) => {
            const obj = item.object || {};
            const q = obj.question || {};
            let url: string;
            if (obj.type === 'answer') {
              url = 'https://www.zhihu.com/question/' + q.id + '/answer/' + obj.id;
            } else if (obj.type === 'article') {
              url = 'https://zhuanlan.zhihu.com/p/' + obj.id;
            } else {
              url = 'https://www.zhihu.com/question/' + obj.id;
            }
            return {
              rank: idx + 1,
              title: strip(obj.title || q.name || ''),
              type: obj.type || '',
              excerpt: strip(obj.excerpt || '').substring(0, 100),
              author: obj.author?.name || '',
              votes: obj.voteup_count || 0,
              url,
            };
          });
      } catch (e: any) {
        return { error: e.message || 'Zhihu scraper failed' };
      }
    }, [query, limit]);

  if (data && typeof data === 'object' && 'error' in data) throw new Error((data as any).error);
  return data || [];
}
