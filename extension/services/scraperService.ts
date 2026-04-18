/**
 * Scraper Service — fetch data from external sites using chrome.debugger (CDP).
 *
 * Uses chrome.debugger + Runtime.evaluate to execute JS in the page's main world.
 * This only requires the "debugger" permission + "<all_urls>" host_permissions,
 * avoiding the need for "scripting" permission with many host_permissions entries.
 *
 * Session-based pool: each target host gets a dedicated minimized popup window
 * (chrome.windows.create with type: 'popup'), reused across commands and auto-closed
 * after an idle timeout. We use a popup window instead of chrome.tabs.create to
 * bypass new-tab-override / tab-hijacking extensions that hook chrome.tabs.onCreated.
 */

// ─── Tab pool with idle cleanup ────────────────────────────────────

const IDLE_TIMEOUT = 5000; // 5s idle → close window
interface PoolEntry {
  tabId: number;
  windowId: number;
  timer: ReturnType<typeof setTimeout> | null;
  userOwned?: boolean; // if true, don't close on idle (it's the user's own tab)
}
const tabPool = new Map<string, PoolEntry>();

// Track which tabs have the debugger attached (maps tabId -> the CDP targetId we attached to).
// We attach by targetId, not tabId, because chrome.debugger.attach({tabId}) rejects
// the whole tab if ANY frame/target belongs to another extension (e.g. password managers,
// Grammarly, Honey injecting chrome-extension:// iframes into arbitrary sites).
const attachedTabs = new Map<number, string>();

/** Open a fresh scraper window for the given URL.
 *  Uses offscreen positioning instead of state:'minimized' because Chrome aggressively
 *  throttles minimized windows — TikTok and other heavy-JS pages may never reach
 *  status:'complete', causing debugger.attach to fail on a half-loaded page.
 *  An offscreen window avoids throttling while staying invisible to the user.
 */
async function openScraperWindow(url: string): Promise<{ tabId: number; windowId: number }> {
  // Create unfocused (NOT minimized) so Chrome doesn't throttle the page load.
  // Minimized tabs get aggressively throttled — heavy pages like TikTok may never
  // reach status:'complete', causing debugger.attach to fail on a half-loaded page.
  const win = await chrome.windows.create({
    url,
    type: 'normal',
    focused: false,
  });
  const tabId = win.tabs?.[0]?.id;
  const windowId = win.id;
  if (tabId == null || windowId == null) {
    throw new Error('Failed to create scraper window');
  }
  return { tabId, windowId };
}

/** Read the current hostname of a tab, or empty string on failure. */
async function getTabHost(tabId: number): Promise<string> {
  try {
    const tab = await chrome.tabs.get(tabId);
    return new URL(tab.url || '').hostname;
  } catch {
    return '';
  }
}

/** Get or create a minimized popup window for a given domain, reusing existing ones. */
export async function getTab(url: string): Promise<number> {
  const expectedHost = new URL(url).hostname;
  const existing = tabPool.get(expectedHost);

  if (existing) {
    // Pause idle timer while scraper is working
    if (existing.timer) clearTimeout(existing.timer);
    existing.timer = null;
    try {
      const tab = await chrome.tabs.get(existing.tabId);
      const curHost = (() => { try { return new URL(tab.url || '').hostname; } catch { return ''; } })();
      if (curHost === expectedHost && tab.url?.startsWith('https://')) {
        return existing.tabId;
      }
      // URL drifted (tab hijacked or closed) — discard and rebuild from scratch
      console.warn(`[Scraper] Pool entry for ${expectedHost} drifted to ${tab.url || 'unknown'}, rebuilding`);
      await closePooledWindow(existing);
    } catch {
      // Tab is gone
    }
    tabPool.delete(expectedHost);
  }

  // Always create a fresh dedicated scraper window. We intentionally do NOT reuse
  // user-owned tabs because they may carry stale chrome-extension:// iframes from
  // other extensions (password managers, translators, etc.) that cause
  // chrome.debugger.attach to refuse with "Cannot access a chrome-extension:// URL
  // of different extension" — a minimized popup loaded fresh by us is clean.
  for (let attempt = 0; attempt < 2; attempt++) {
    const entry = await openScraperWindow(url);
    await waitForLoad(entry.tabId, expectedHost);
    const finalHost = await getTabHost(entry.tabId);
    if (finalHost === expectedHost) {
      // Minimize the window now that page is loaded — keeps it out of the user's way
      chrome.windows.update(entry.windowId, { state: 'minimized' }).catch(() => {});
      tabPool.set(expectedHost, { ...entry, timer: null });
      return entry.tabId;
    }
    // Hijacked — close and retry (or fail on second attempt)
    const finalTab = await chrome.tabs.get(entry.tabId).catch(() => null);
    console.warn(`[Scraper] Window for ${expectedHost} ended up on ${finalTab?.url || 'unknown'} (attempt ${attempt + 1}/2)`);
    await chrome.windows.remove(entry.windowId).catch(() => {});
    if (attempt === 1) {
      throw new Error(
        `Failed to open ${expectedHost} — another extension appears to be hijacking new windows ` +
        `(got: ${finalTab?.url || 'unknown'}). Check chrome://extensions for new-tab-override or ` +
        `session-manager extensions.`
      );
    }
  }
  throw new Error(`Failed to open ${expectedHost}`); // unreachable
}

/** Start idle countdown on all windows that don't have one running. */
export function startAllIdleTimers(): void {
  for (const [domain, entry] of tabPool.entries()) {
    if (!entry.timer) {
      entry.timer = setTimeout(() => closePooledDomain(domain), IDLE_TIMEOUT);
    }
  }
}

async function closePooledWindow(entry: PoolEntry): Promise<void> {
  if (entry.timer) clearTimeout(entry.timer);
  const targetId = attachedTabs.get(entry.tabId);
  if (targetId) {
    chrome.debugger.detach({ targetId }).catch(() => {});
    attachedTabs.delete(entry.tabId);
  }
  // Never close a user-owned tab — just detach the debugger
  if (!entry.userOwned) {
    await chrome.windows.remove(entry.windowId).catch(() => {});
  }
}

function closePooledDomain(domain: string) {
  const entry = tabPool.get(domain);
  if (!entry) return;
  tabPool.delete(domain);
  closePooledWindow(entry).catch(() => {});
  console.log(`[Scraper] Window closed: ${domain}`);
}


/** Wait until the tab is fully loaded AND on the expected host (if provided). */
export async function waitForLoad(tabId: number, expectedHost?: string, maxMs = 15000): Promise<void> {
  const start = Date.now();
  return new Promise<void>((resolve) => {
    const check = async () => {
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab.status === 'complete') {
          if (!expectedHost) return resolve();
          let host = '';
          try { host = new URL(tab.url || '').hostname; } catch {}
          if (host === expectedHost) return resolve();
        }
      } catch {
        // Tab was closed externally
        return resolve();
      }
      if (Date.now() - start >= maxMs) return resolve();
      setTimeout(check, 300);
    };
    check();
  });
}

// Clean up if tab is closed externally
chrome.tabs.onRemoved.addListener((tabId) => {
  for (const [domain, entry] of tabPool.entries()) {
    if (entry.tabId === tabId) {
      if (entry.timer) clearTimeout(entry.timer);
      tabPool.delete(domain);
    }
  }
  // Clean up debugger attachment tracking
  attachedTabs.delete(tabId);
});

// Clean up if the whole scraper window is closed externally
chrome.windows.onRemoved.addListener((windowId) => {
  for (const [domain, entry] of tabPool.entries()) {
    if (entry.windowId === windowId) {
      if (entry.timer) clearTimeout(entry.timer);
      if (attachedTabs.has(entry.tabId)) attachedTabs.delete(entry.tabId);
      tabPool.delete(domain);
    }
  }
});

// Also clean up if debugger is detached externally (e.g. user closes DevTools)
chrome.debugger.onDetach.addListener((source) => {
  if (source.tabId != null) {
    attachedTabs.delete(source.tabId);
  } else if (source.targetId != null) {
    // Detached by targetId — find and remove the matching entry
    for (const [tabId, targetId] of attachedTabs.entries()) {
      if (targetId === source.targetId) {
        attachedTabs.delete(tabId);
        break;
      }
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

// ─── CDP executeInPage helper ─────────────────────────────────────

/**
 * Execute a function in the page's main world via chrome.debugger (CDP Runtime.evaluate).
 *
 * Replaces chrome.scripting.executeScript({ world: 'MAIN' }) to avoid needing
 * the "scripting" permission. Only requires "debugger" + "<all_urls>".
 *
 * @param tabId - The tab to execute in
 * @param func - A self-contained function (no closures) to execute in the page
 * @param args - Arguments to pass to the function
 * @returns The return value of the function
 */
export async function executeInPage<T = any>(
  tabId: number,
  func: (...args: any[]) => T,
  args: any[] = [],
): Promise<T> {
  // Preflight: refuse to attach to a tab that drifted to an extension/chrome page.
  // chrome.debugger.attach rejects chrome-extension:// URLs from other extensions
  // with "Cannot access a chrome-extension:// URL of different extension".
  let preAttachUrl = '';
  try {
    const tab = await chrome.tabs.get(tabId);
    preAttachUrl = tab.url || '';
    if (preAttachUrl.startsWith('chrome-extension://') || preAttachUrl.startsWith('chrome://') || preAttachUrl.startsWith('devtools://')) {
      throw new Error(
        `Scraper tab drifted to ${preAttachUrl} — another extension is likely hijacking new windows. ` +
        `Check chrome://extensions for new-tab-override or session-manager extensions.`
      );
    }
  } catch (e: any) {
    if (e.message?.includes('drifted to') || e.message?.includes('hijacking')) throw e;
    throw new Error(`Scraper tab ${tabId} not accessible: ${e.message || 'unknown error'}`);
  }

  // Resolve to the CDP page target for this tab. We use {targetId} instead of {tabId}
  // because chrome.debugger.attach({tabId}) fails if ANY frame in the tab belongs to
  // another extension. {targetId} attaches only to the main page target.
  let targetId = attachedTabs.get(tabId);
  if (!targetId) {
    const allTargets = await chrome.debugger.getTargets();
    const tabTargets = allTargets.filter((t: any) => t.tabId === tabId);
    const pageTarget = tabTargets.find((t: any) => t.type === 'page');
    if (!pageTarget) {
      throw new Error(
        `No page target found for tab ${tabId} (url=${preAttachUrl}). ` +
        `Found targets: [${tabTargets.map((t: any) => t.type).join(', ') || 'none'}]`
      );
    }
    targetId = pageTarget.id;

    try {
      await chrome.debugger.attach({ targetId }, '1.3');
      attachedTabs.set(tabId, targetId);
    } catch (e: any) {
      if (e.message?.includes('Another debugger is already attached') ||
          e.message?.includes('already attached')) {
        attachedTabs.set(tabId, targetId);
      } else {
        throw new Error(
          `chrome.debugger.attach failed: ${e.message}. ` +
          `Another extension may be injecting into this page — try disabling extensions like Relingo, ` +
          `or restrict their site access at chrome://extensions.`
        );
      }
    }
  }

  // Build IIFE expression: (async function(...) { ... })(...args)
  const argsJson = args.map(a => JSON.stringify(a)).join(', ');
  const expression = `(${func.toString()})(${argsJson})`;

  const result = await chrome.debugger.sendCommand(
    { targetId },
    'Runtime.evaluate',
    {
      expression,
      awaitPromise: true,
      returnByValue: true,
    },
  ) as any;

  if (result?.exceptionDetails) {
    const errMsg = result.exceptionDetails.exception?.description
      || result.exceptionDetails.text
      || 'executeInPage failed';
    throw new Error(errMsg);
  }

  return result?.result?.value as T;
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
  const data = await executeInPage(tabId, async (q: string, lim: number) => {
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
    }, [query, limit]);
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

  const data = await executeInPage(tabId, async (lim: number) => {
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
    }, [limit]);

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

  const data = await executeInPage(tabId, (lim: number) => {
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
    }, [safeLimit]);
  if (data && typeof data === 'object' && 'error' in data) throw new Error((data as any).error);
  return data || [];
}
