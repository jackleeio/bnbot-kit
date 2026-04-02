/**
 * Scraper Service — fetch data from external sites using chrome.scripting.
 *
 * Instead of CDP (chrome.debugger), this uses chrome.scripting.executeScript()
 * which only needs host_permissions for the target site — no debugger permission.
 *
 * Uses a session-based tab pool: tabs are reused across commands and auto-closed
 * after an idle timeout (similar to opencli's automation window approach).
 */

// ─── Tab pool with idle cleanup ────────────────────────────────────

const IDLE_TIMEOUT = 5000; // 5s idle → close tab
const tabPool = new Map<string, { tabId: number; timer: ReturnType<typeof setTimeout> }>();

/** Get or create a tab for a given domain, reusing existing ones. */
export async function getTab(url: string): Promise<number> {
  const domain = new URL(url).hostname;
  const existing = tabPool.get(domain);

  if (existing) {
    // Pause idle timer while scraper is working
    clearTimeout(existing.timer);
    existing.timer = null as any;
    try {
      const tab = await chrome.tabs.get(existing.tabId);
      if (tab.url && new URL(tab.url).hostname === domain) return existing.tabId;
      await chrome.tabs.update(existing.tabId, { url });
      await waitForLoad(existing.tabId);
      return existing.tabId;
    } catch {
      tabPool.delete(domain);
    }
  }

  // Create new tab — no idle timer yet (starts after scraper completes)
  const tab = await chrome.tabs.create({ url, active: false });
  await waitForLoad(tab.id!);
  tabPool.set(domain, { tabId: tab.id!, timer: null as any });
  return tab.id!;
}

/** Start idle countdown on all tabs that don't have one running. */
export function startAllIdleTimers(): void {
  for (const [domain, entry] of tabPool.entries()) {
    if (!entry.timer) {
      entry.timer = setTimeout(() => closePooledTab(domain), IDLE_TIMEOUT);
    }
  }
}

function closePooledTab(domain: string) {
  const entry = tabPool.get(domain);
  if (!entry) return;
  tabPool.delete(domain);
  chrome.tabs.remove(entry.tabId).catch(() => {});
  console.log(`[Scraper] Tab closed: ${domain}`);
}


export async function waitForLoad(tabId: number): Promise<void> {
  await new Promise<void>((resolve) => {
    const listener = (id: number, info: chrome.tabs.TabChangeInfo) => {
      if (id === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); resolve(); }, 15000);
  });
}

// Clean up if tab is closed externally
chrome.tabs.onRemoved.addListener((tabId) => {
  for (const [domain, entry] of tabPool.entries()) {
    if (entry.tabId === tabId) {
      clearTimeout(entry.timer);
      tabPool.delete(domain);
    }
  }
});

/** Check if tab was redirected to a login page. Call after getTab + wait. */
export async function checkLoginRedirect(tabId: number, platformName: string): Promise<void> {
  const tab = await chrome.tabs.get(tabId);
  if (tab.url && (tab.url.includes('passport.') || tab.url.includes('/login') || tab.url.includes('/signin') || tab.url.includes('/sso/'))) {
    throw new Error(`Please sign in to ${platformName} first`);
  }
}

// ─── TikTok ─────────────────────────────────────────────────────────

export interface TikTokSearchResult {
  rank: number;
  desc: string;
  author: string;
  url: string;
  plays: number;
  likes: number;
  comments: number;
  shares: number;
}

export async function searchTikTok(query: string, limit = 10): Promise<TikTokSearchResult[]> {
  const tabId = await getTab('https://www.tiktok.com/explore');
  await new Promise(r => setTimeout(r, 3000));
  await checkLoginRedirect(tabId, 'TikTok');
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: async (q: string, lim: number) => {
      try {
        const res = await fetch(
          '/api/search/general/full/?keyword=' + encodeURIComponent(q) + '&offset=0&count=' + lim + '&aid=1988',
          { credentials: 'include' }
        );
        if (!res.ok) return { error: 'TikTok search failed: HTTP ' + res.status + ' — please sign in to TikTok first' };
        const data = await res.json();
        const items = (data.data || []).filter((i: any) => i.type === 1 && i.item);
        if (items.length === 0) {
          const url = window.location.href;
          if (url.includes('/login') || url.includes('/signin') || url.includes('passport.') || document.title.includes('登录') || document.title.includes('Sign in') || document.title.includes('Log in')) {
            return { error: 'Please sign in to TikTok first' };
          }
        }
        return items.slice(0, lim).map((i: any, idx: number) => {
          const v = i.item;
          const a = v.author || {};
          const s = v.stats || {};
          return {
            rank: idx + 1,
            desc: (v.desc || '').replace(/\n/g, ' ').substring(0, 100),
            author: a.uniqueId || '',
            url: (a.uniqueId && v.id) ? 'https://www.tiktok.com/@' + a.uniqueId + '/video/' + v.id : '',
            plays: s.playCount || 0,
            likes: s.diggCount || 0,
            comments: s.commentCount || 0,
            shares: s.shareCount || 0,
          };
        });
      } catch (e: any) {
        return { error: e.message || 'TikTok scraper failed' };
      }
    },
    args: [query, limit],
  });
  const data = results[0]?.result;
  if (data && typeof data === 'object' && 'error' in data) throw new Error((data as any).error);
  return data || [];
}

// ─── TikTok Explore ────────────────────────────────────────────────

export interface TikTokExploreResult {
  rank: number;
  author: string;
  views: string;
  url: string;
}

export async function fetchTikTokExplore(limit = 20): Promise<TikTokExploreResult[]> {
  const tabId = await getTab('https://www.tiktok.com/explore');
  await new Promise(r => setTimeout(r, 5000));
  await checkLoginRedirect(tabId, 'TikTok');

  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: async (lim: number) => {
      try {
        // Try multiple API endpoints for trending/explore content
        const apis = [
          '/api/explore/item_list/?count=' + lim + '&aid=1988',
          '/api/recommend/item_list/?count=' + lim + '&aid=1988',
          '/api/search/general/full/?keyword=&offset=0&count=' + lim + '&aid=1988',
        ];
        for (const apiUrl of apis) {
          try {
            const res = await fetch(apiUrl, { credentials: 'include' });
            if (!res.ok) continue;
            const data = await res.json();
            const items = (data.itemList || data.item_list || data.data || [])
              .filter((i: any) => i.type === undefined || i.type === 1)
              .map((i: any) => i.item || i)
              .slice(0, lim);
            if (items.length > 0) {
              return items.map((v: any, idx: number) => {
                const a = v.author || {};
                const s = v.stats || {};
                return {
                  rank: idx + 1,
                  author: a.uniqueId || '',
                  views: s.playCount ? String(s.playCount) : '-',
                  url: (a.uniqueId && v.id)
                    ? 'https://www.tiktok.com/@' + a.uniqueId + '/video/' + v.id
                    : '',
                };
              });
            }
          } catch { continue; }
        }
        return [];
      } catch (e: any) {
        return { error: e.message || 'TikTok explore scraper failed' };
      }
    },
    args: [limit],
  });

  const data = results[0]?.result;
  if (data && typeof data === 'object' && 'error' in data) throw new Error((data as any).error);
  return data || [];
}

// ─── YouTube ────────────────────────────────────────────────────────

export interface YouTubeSearchResult {
  rank: number;
  title: string;
  channel: string;
  views: string;
  duration: string;
  published: string;
  url: string;
}

export interface YouTubeSearchOptions {
  limit?: number;
  type?: 'shorts' | 'video' | 'channel' | 'playlist';
  upload?: 'hour' | 'today' | 'week' | 'month' | 'year';
  sort?: 'relevance' | 'date' | 'views' | 'rating';
}

export async function searchYouTube(query: string, options: YouTubeSearchOptions = {}): Promise<YouTubeSearchResult[]> {
  const safeLimit = Math.min(options.limit || 20, 50);

  // Build sp= protobuf filter parameter
  const spMap: Record<string, string> = {
    shorts: 'EgIQCQ%3D%3D', video: 'EgIQAQ%3D%3D', channel: 'EgIQAg%3D%3D', playlist: 'EgIQAw%3D%3D',
    hour: 'EgIIAQ%3D%3D', today: 'EgIIAg%3D%3D', week: 'EgIIAw%3D%3D', month: 'EgIIBA%3D%3D', year: 'EgIIBQ%3D%3D',
  };
  const sortMap: Record<string, string> = { date: 'CAI%3D', views: 'CAM%3D', rating: 'CAE%3D' };

  // YouTube only supports one sp= param. Priority: type > upload > sort
  let sp = '';
  if (options.type && spMap[options.type]) sp = spMap[options.type];
  else if (options.upload && spMap[options.upload]) sp = spMap[options.upload];
  else if (options.sort && sortMap[options.sort]) sp = sortMap[options.sort];

  let searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
  if (sp) searchUrl += `&sp=${sp}`;

  const tabId = await getTab(searchUrl);
  await new Promise(r => setTimeout(r, 3000));
  await checkLoginRedirect(tabId, 'YouTube');

  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: (lim: number) => {
      try {
        const data = (window as any).ytInitialData;
        if (!data) return { error: 'YouTube data not found' };

        const contents = data.contents?.twoColumnSearchResultsRenderer
          ?.primaryContents?.sectionListRenderer?.contents || [];
        const videos: any[] = [];
        for (const section of contents) {
          const items = section.itemSectionRenderer?.contents || section.reelShelfRenderer?.items || [];
          for (const item of items) {
            if (videos.length >= lim) break;
            if (item.videoRenderer) {
              const v = item.videoRenderer;
              videos.push({
                rank: videos.length + 1,
                title: v.title?.runs?.[0]?.text || '',
                channel: v.ownerText?.runs?.[0]?.text || '',
                views: v.viewCountText?.simpleText || v.shortViewCountText?.simpleText || '',
                duration: v.lengthText?.simpleText || 'LIVE',
                published: v.publishedTimeText?.simpleText || '',
                url: 'https://www.youtube.com/watch?v=' + v.videoId,
              });
            } else if (item.reelItemRenderer) {
              const r = item.reelItemRenderer;
              videos.push({
                rank: videos.length + 1,
                title: r.headline?.simpleText || '',
                channel: r.navigationEndpoint?.reelWatchEndpoint?.overlay?.reelPlayerOverlayRenderer?.reelPlayerHeaderSupportedRenderers?.reelPlayerHeaderRenderer?.channelTitleText?.runs?.[0]?.text || '',
                views: r.viewCountText?.simpleText || '',
                duration: 'SHORT',
                published: '',
                url: 'https://www.youtube.com/shorts/' + r.videoId,
              });
            }
          }
        }
        if (videos.length === 0) {
          const url = window.location.href;
          if (url.includes('/login') || url.includes('/signin') || document.title.includes('Sign in')) {
            return { error: 'Please sign in to YouTube first' };
          }
        }
        return videos;
      } catch (e: any) {
        return { error: e.message || 'YouTube scraper failed' };
      }
    },
    args: [safeLimit],
  });
  const data = results[0]?.result;
  if (data && typeof data === 'object' && 'error' in data) throw new Error((data as any).error);
  return data || [];
}
