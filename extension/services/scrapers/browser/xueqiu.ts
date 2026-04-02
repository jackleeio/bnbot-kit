/**
 * Xueqiu (snowball) stock search scraper — uses Xueqiu's search API with browser cookies.
 *
 * API: /stock/search.json?code=...&size=...
 * Returns stock matches with symbol, name, exchange, price, and change percentage.
 */

import { getTab, checkLoginRedirect } from '../../scraperService';

export interface XueqiuResult {
  rank: number;
  symbol: string;
  name: string;
  exchange: string;
  price: number | null;
  changePercent: string | null;
  url: string;
}

export interface XueqiuHotResult {
  rank: number;
  text: string;
  author: string;
  likes: number;
  retweets: number;
  replies: number;
  url: string;
}

export async function fetchXueqiuHot(limit = 20): Promise<XueqiuHotResult[]> {
  const tabId = await getTab('https://xueqiu.com');
  await checkLoginRedirect(tabId, 'Xueqiu');

  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: async (lim: number) => {
      try {
        const resp = await fetch('https://xueqiu.com/statuses/hot/listV3.json?source=hot&page=1', {
          credentials: 'include',
        });
        if (!resp.ok) return { error: 'Xueqiu hot failed: HTTP ' + resp.status + ' — please sign in to Xueqiu first' };
        const d = await resp.json();
        const list = d.list || [];
        if (list.length === 0) {
          const url = window.location.href;
          if (url.includes('/login') || url.includes('/signin') || url.includes('passport.') || document.title.includes('登录') || document.title.includes('Sign in') || document.title.includes('Log in')) {
            return { error: 'Please sign in to Xueqiu first' };
          }
        }
        const strip = (html: string) => (html || '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
        return list.slice(0, lim).map((item: any, i: number) => {
          const user = item.user || {};
          return {
            rank: i + 1,
            text: strip(item.description).substring(0, 200),
            author: user.screen_name || '',
            likes: item.fav_count || 0,
            retweets: item.retweet_count || 0,
            replies: item.reply_count || 0,
            url: 'https://xueqiu.com/' + user.id + '/' + item.id,
          };
        });
      } catch (e: any) {
        return { error: e.message || 'Xueqiu hot scraper failed' };
      }
    },
    args: [limit],
  });

  const data = results[0]?.result;
  if (data && typeof data === 'object' && 'error' in data) throw new Error((data as any).error);
  return data || [];
}

export async function searchXueqiu(query: string, limit = 10): Promise<XueqiuResult[]> {
  const tabId = await getTab('https://xueqiu.com');
  await checkLoginRedirect(tabId, 'Xueqiu');

  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: async (q: string, lim: number) => {
      try {
        const resp = await fetch(
          'https://xueqiu.com/stock/search.json?code=' + encodeURIComponent(q) + '&size=' + lim,
          { credentials: 'include' },
        );
        if (!resp.ok) return { error: 'Xueqiu search failed: HTTP ' + resp.status + ' — please sign in to Xueqiu first' };
        const d = await resp.json();

        const stocks = d.stocks || [];
        if (stocks.length === 0) {
          const url = window.location.href;
          if (url.includes('/login') || url.includes('/signin') || url.includes('passport.') || document.title.includes('登录') || document.title.includes('Sign in') || document.title.includes('Log in')) {
            return { error: 'Please sign in to Xueqiu first' };
          }
        }
        return stocks.slice(0, lim).map((s: any, idx: number) => {
          let symbol = '';
          if (s.exchange === 'SH' || s.exchange === 'SZ' || s.exchange === 'BJ') {
            symbol = s.code.startsWith(s.exchange) ? s.code : s.exchange + s.code;
          } else {
            symbol = s.code;
          }
          return {
            rank: idx + 1,
            symbol,
            name: s.name,
            exchange: s.exchange,
            price: s.current ?? null,
            changePercent: s.percentage != null ? s.percentage.toFixed(2) + '%' : null,
            url: 'https://xueqiu.com/S/' + symbol,
          };
        });
      } catch (e: any) {
        return { error: e.message || 'Xueqiu scraper failed' };
      }
    },
    args: [query, limit],
  });

  const data = results[0]?.result;
  if (data && typeof data === 'object' && 'error' in data) throw new Error((data as any).error);
  return data || [];
}
