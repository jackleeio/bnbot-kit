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

// Idle window lifetime — each completed action adds `IDLE_BONUS_*` to the
// tab's remaining budget (not a hard reset). Unused budget from recent
// activity carries forward, so active bursts build headroom while long
// pauses let the tab close naturally.
//
//   first op:   closeAt = now + bonus
//   next op at t<closeAt:  closeAt = closeAt + bonus      (stacks)
//   next op at t>closeAt:  closeAt = now + bonus          (floor)
//
// Exploration / probing workflows (`bnbot debug eval`, `navigate_to_url`)
// get a larger bonus so occasional multi-minute think gaps don't evict.
const IDLE_BONUS_DEFAULT = 120_000; // 2 min bonus per read/write op
export const IDLE_BONUS_EXPLORE = 300_000; // 5 min bonus per debug op
interface PoolEntry {
  tabId: number;
  windowId: number;
  timer: ReturnType<typeof setTimeout> | null;
  closeAt: number; // epoch ms when idle timer should fire
  userOwned?: boolean; // if true, don't close on idle (it's the user's own tab)
}
const tabPool = new Map<string, PoolEntry>();

// Windows we've created for scraping purposes. Tracked independently of
// `tabPool` because pool entries get evicted on idle but the WINDOW may
// still be alive (e.g. another helper tab is in it). Reusing these
// windows prevents "open multiple x.com windows after each test run"
// symptoms. We prune dead window IDs lazily on access.
const scraperWindowIds = new Set<number>();

/** Remove closed windows from the tracking set. Call before decisions that
 *  depend on whether a scraper window is available. */
async function pruneDeadScraperWindows(): Promise<void> {
  for (const winId of Array.from(scraperWindowIds)) {
    try {
      await chrome.windows.get(winId);
    } catch {
      scraperWindowIds.delete(winId);
    }
  }
}

chrome.windows.onRemoved.addListener((windowId) => {
  scraperWindowIds.delete(windowId);
});

// Track which tabs have the debugger attached (maps tabId -> the CDP targetId we attached to).
// We attach by targetId, not tabId, because chrome.debugger.attach({tabId}) rejects
// the whole tab if ANY frame/target belongs to another extension (e.g. password managers,
// Grammarly, Honey injecting chrome-extension:// iframes into arbitrary sites).
const attachedTabs = new Map<number, string>();

/** List all currently pooled scraper tabs (one per hostname).
 *  Used by `bnbot screenshot` so ad-hoc captures default to the tab
 *  bnbot is actually automating — not whatever window the user is
 *  clicking around in. */
export function getPoolTabs(): Array<{ host: string; tabId: number; windowId: number; busy: boolean }> {
  return Array.from(tabPool.entries()).map(([host, e]) => ({
    host,
    tabId: e.tabId,
    windowId: e.windowId,
    // A null idle timer means the tab is actively being used (not
    // waiting to be closed), so prefer it when multiple pools exist.
    busy: e.timer === null,
  }));
}

/**
 * Open a new tab inside a bnbot-owned scraper window (NOT the user's
 * main window). If a scraper window already exists (any pool entry's
 * windowId), reuse it — just add a tab there. Only when no scraper
 * window exists do we create a fresh unfocused one.
 *
 * Used by `bnbot screenshot --url` and `bnbot x navigate url` so
 * ad-hoc page opens don't pollute the user's foreground browsing.
 *
 * Note: the new tab is NOT added to the scraper pool (tabPool), because
 * the pool is keyed by hostname and reserved for the primary
 * automation tab per platform. These are ephemeral helper tabs.
 */
export async function openTabInScraperWindow(url: string): Promise<number> {
  await pruneDeadScraperWindows();
  if (scraperWindowIds.size > 0) {
    const winId = scraperWindowIds.values().next().value!;
    const created = await chrome.tabs.create({ windowId: winId, url, active: false });
    if (created.id == null) throw new Error('Failed to create tab in scraper window');
    return created.id;
  }
  // No scraper window yet — spin one up unfocused. Matches the flow
  // used elsewhere in this file (openScraperWindow) so we don't
  // flash in the user's face.
  const win = await chrome.windows.create({ url, type: 'normal', focused: false });
  const tabId = win.tabs?.[0]?.id;
  if (tabId == null || win.id == null) throw new Error('Failed to create scraper window');
  scraperWindowIds.add(win.id);
  return tabId;
}

/** Open a fresh scraper window for the given URL.
 *  Uses offscreen positioning instead of state:'minimized' because Chrome aggressively
 *  throttles minimized windows — TikTok and other heavy-JS pages may never reach
 *  status:'complete', causing debugger.attach to fail on a half-loaded page.
 *  An offscreen window avoids throttling while staying invisible to the user.
 */
async function openScraperWindow(url: string): Promise<{ tabId: number; windowId: number }> {
  // Reuse an existing scraper window if we have one alive — adds a new
  // tab there instead of piling up windows. The pool still keys by host
  // (so one tab per platform), but all tabs can share one window.
  await pruneDeadScraperWindows();
  if (scraperWindowIds.size > 0) {
    const windowId = scraperWindowIds.values().next().value!;
    // `active: true` — when the user eventually un-minimizes this
    // window (via Dock click or `debug show`), they see the latest
    // navigate target instead of whatever tab was previously active.
    // The window itself stays minimized either way, so this doesn't
    // steal focus.
    const created = await chrome.tabs.create({ windowId, url, active: true });
    if (created.id == null) throw new Error('Failed to create tab in scraper window');
    return { tabId: created.id, windowId };
  }

  // Create a normal-type window but START IT MINIMIZED — the window
  // materializes directly into the Dock without ever being drawn on
  // the desktop, so the user never sees a flash. When the user wants
  // to watch (via `debug show` or prepareXhsTab), we un-minimize.
  //
  // We use `type: 'normal'` (not `popup`) so the window, when shown,
  // has the full Chrome UI (tab bar + address bar) instead of the
  // bare popup chrome.
  //
  // NOTE: Chrome throttles JS in minimized windows. This was fine for
  // simple scrapers in the past, but heavy SPAs like XHS's compose
  // page need to be un-minimized before Page.navigate to hydrate.
  // `prepareXhsTab` handles that.
  // Do NOT pass `left`/`top` — that triggers macOS-level app activation
  // (Chrome gets raised to the frontmost app to render the new window
  // at the requested coords). Omit position entirely and Chrome uses
  // its default offset-from-existing-window strategy, which matches
  // opencli's behavior — the window appears in the background without
  // interrupting the user's current app. `focused:false` keeps the
  // window itself unfocused. getTab minimizes it once load completes.
  const win = await chrome.windows.create({
    url,
    type: 'normal',
    focused: false,
    width: 1280,
    height: 800,
  });
  const tabId = win.tabs?.[0]?.id;
  const windowId = win.id;
  if (tabId == null || windowId == null) {
    throw new Error('Failed to create scraper window');
  }
  scraperWindowIds.add(windowId);
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

  // Pool miss — before spinning up a new window, try to adopt an
  // existing tab on this host. When the extension reloads, our in-memory
  // tabPool is wiped but the Chrome-side windows stay alive. Without
  // adoption, every reload stacks a new compose window on top of the
  // previous ones (user visibly sees 3+ XHS windows pile up).
  //
  // Heuristic for "ours vs user-owned": a bot-opened scraper window has
  // exactly one tab. The user's main browsing window always has more.
  try {
    const candidates = await chrome.tabs.query({ url: `*://${expectedHost}/*` });
    for (const t of candidates) {
      if (t.id == null || t.windowId == null) continue;
      if (!t.url?.startsWith('https://')) continue;
      const winTabs = await chrome.tabs.query({ windowId: t.windowId });
      if (winTabs.length !== 1) continue;
      tabPool.set(expectedHost, {
        tabId: t.id,
        windowId: t.windowId,
        timer: null,
        closeAt: 0,
      });
      scraperWindowIds.add(t.windowId);
      console.log(`[Scraper] Adopted orphaned ${expectedHost} tab ${t.id} (window ${t.windowId})`);
      return t.id;
    }
  } catch (err) {
    console.warn(`[Scraper] Adoption query failed for ${expectedHost}:`, err);
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
      tabPool.set(expectedHost, { ...entry, timer: null, closeAt: 0 });
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

/**
 * Bump every pooled tab's idle deadline by `bonusMs`, anchored to the
 * later of its current deadline or now. Active sessions carry forward
 * unused budget; gaps longer than a previous bonus restart from now.
 */
export function startAllIdleTimers(bonusMs: number = IDLE_BONUS_DEFAULT): void {
  const now = Date.now();
  for (const [domain, entry] of tabPool.entries()) {
    if (entry.timer) clearTimeout(entry.timer);
    const base = Math.max(entry.closeAt, now);
    entry.closeAt = base + bonusMs;
    entry.timer = setTimeout(() => closePooledDomain(domain), entry.closeAt - now);
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

/**
 * Ensure the debugger is attached to this tab (by page targetId) and
 * return that targetId + the Page.enable/Network.enable etc. domains we
 * need for write-flow orchestration. Public for `services/debugger/*`
 * so write actions can reuse the scraper window pool and driver.
 *
 * Idempotent: safe to call multiple times; already-attached tabs return
 * the cached targetId unchanged.
 */
export async function ensureDebuggerAttached(
  tabId: number,
  domains: string[] = ['Page', 'Runtime', 'DOM', 'Network'],
): Promise<string> {
  let targetId = attachedTabs.get(tabId);
  if (!targetId) {
    const allTargets = await chrome.debugger.getTargets();
    const pageTarget = allTargets.find((t: any) => t.tabId === tabId && t.type === 'page');
    if (!pageTarget) throw new Error(`No page target for tab ${tabId}`);
    targetId = pageTarget.id;
    try {
      await chrome.debugger.attach({ targetId }, '1.3');
    } catch (e: any) {
      if (!e.message?.includes('already attached')) throw e;
    }
    attachedTabs.set(tabId, targetId);
  }
  for (const d of domains) {
    try {
      await chrome.debugger.sendCommand({ targetId }, `${d}.enable`, {});
    } catch {
      // Some domains return a benign "already enabled" error — ignore.
    }
  }
  return targetId;
}

/** Thin wrapper for `chrome.debugger.sendCommand` that throws on
 *  `lastError`. Targets the page by `targetId` (same semantics as
 *  `executeInPage`). */
export async function debuggerSend<T = unknown>(
  targetId: string,
  method: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  const result = await chrome.debugger.sendCommand(
    { targetId },
    method,
    params as { [key: string]: unknown },
  );
  return result as T;
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

// Rich explore result — mirrors the actual TikTok API shape we get back
// from `/api/recommend/item_list/`. Earlier this only carried 4 fields
// (rank/author/views/url), which left downstream LLMs blind to the
// video's actual content — they'd see a bare URL and hallucinate a topic
// when writing companion posts. Now we surface caption, hashtags, cover,
// duration, and engagement so the agent can decide trend relevance and
// vision-describe the cover when caption is empty.
export interface TikTokExploreResult {
  rank: number;
  author: string;
  authorName: string;
  url: string;
  views: string;
  // Content
  desc: string;
  hashtags: string[];
  cover: string;
  duration: number;
  // Engagement
  likes: number;
  comments: number;
  shares: number;
  collects: number;
  // Meta
  music: string;
  createTime: number;
  language: string;
  isAd: boolean;
  // Author signal — small-account-going-viral is the realest trend signal.
  followers: number;
  // Video aspect — TikTok-native is portrait; landscape ≈ reposted YouTube.
  ratio: string;
  width: number;
  height: number;
}

export async function fetchTikTokExplore(limit = 20): Promise<TikTokExploreResult[]> {
  const tabId = await getTab('https://www.tiktok.com/explore');
  await new Promise(r => setTimeout(r, 5000));
  await checkLoginRedirect(tabId, 'TikTok');

  const data = await executeInPage(tabId, async (lim: number) => {
      try {
        // Try multiple API endpoints for trending/explore content. As of
        // 2026-04 the `/api/explore/item_list/` endpoint returns 10201
        // "missing required fields" without extra signing params, while
        // `/api/recommend/item_list/` works anonymously with just count+aid.
        const apis = [
          '/api/recommend/item_list/?count=' + lim + '&aid=1988',
          '/api/explore/item_list/?count=' + lim + '&aid=1988',
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
                const vid = v.video || {};
                const mus = v.music || {};
                // Hashtags can come from textExtra (typed entries) or be
                // inferred from the desc as a fallback. We prefer textExtra
                // since it's already structured and stable.
                const tags: string[] = Array.isArray(v.textExtra)
                  ? v.textExtra
                      .map((t: any) => (typeof t?.hashtagName === 'string' ? t.hashtagName : ''))
                      .filter((s: string) => s.length > 0)
                  : [];
                const aStats = v.authorStats || {};
                return {
                  rank: idx + 1,
                  author: a.uniqueId || '',
                  authorName: a.nickname || '',
                  url: (a.uniqueId && v.id)
                    ? 'https://www.tiktok.com/@' + a.uniqueId + '/video/' + v.id
                    : '',
                  views: s.playCount ? String(s.playCount) : '-',
                  desc: typeof v.desc === 'string'
                    ? v.desc.replace(/\s+/g, ' ').trim().slice(0, 300)
                    : '',
                  hashtags: tags,
                  cover: vid.cover || vid.dynamicCover || vid.originCover || '',
                  duration: typeof vid.duration === 'number' ? vid.duration : 0,
                  likes: typeof s.diggCount === 'number' ? s.diggCount : 0,
                  comments: typeof s.commentCount === 'number' ? s.commentCount : 0,
                  shares: typeof s.shareCount === 'number' ? s.shareCount : 0,
                  collects: typeof s.collectCount === 'number' ? s.collectCount : 0,
                  music: typeof mus.title === 'string' ? mus.title : '',
                  createTime: typeof v.createTime === 'number' ? v.createTime : 0,
                  language: typeof v.textLanguage === 'string' ? v.textLanguage : '',
                  isAd: Boolean(v.isAd),
                  followers: typeof aStats.followerCount === 'number' ? aStats.followerCount : 0,
                  ratio: typeof vid.ratio === 'string' ? vid.ratio : '',
                  width: typeof vid.width === 'number' ? vid.width : 0,
                  height: typeof vid.height === 'number' ? vid.height : 0,
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

// ─── YouTube Write & Read Operations ───────────────────────────────

export async function likeYoutubeVideo(videoId: string): Promise<{ success: boolean; message: string }> {
  const tabId = await getTab('https://www.youtube.com');
  await new Promise(r => setTimeout(r, 2000));
  const result = await executeInPage(tabId, async (vid: string) => {
    async function getSapisidHash(origin: string) {
      const cookies = document.cookie.split('; ');
      let sapisid = '';
      for (const c of cookies) {
        const eq = c.indexOf('=');
        if (eq === -1) continue;
        const name = c.slice(0, eq);
        const val = c.slice(eq + 1);
        if (name === '__Secure-3PAPISID' || name === 'SAPISID') {
          sapisid = val;
          if (name === '__Secure-3PAPISID') break;
        }
      }
      if (!sapisid) return null;
      const time = Math.floor(Date.now() / 1000);
      const msgBuffer = new TextEncoder().encode(time + ' ' + sapisid + ' ' + origin);
      const hashBuffer = await crypto.subtle.digest('SHA-1', msgBuffer);
      const hashHex = Array.from(new Uint8Array(hashBuffer)).map((b: number) => b.toString(16).padStart(2, '0')).join('');
      return 'SAPISIDHASH ' + time + '_' + hashHex;
    }
    const cfg = (window as any).ytcfg?.data_ || {};
    const apiKey = cfg.INNERTUBE_API_KEY;
    const context = cfg.INNERTUBE_CONTEXT;
    if (!apiKey || !context) return { error: 'YouTube config not found — please visit youtube.com first' };
    const authHash = await getSapisidHash('https://www.youtube.com');
    if (!authHash) return { error: 'Not logged in to YouTube (SAPISID missing)' };
    const resp = await fetch('/youtubei/v1/like/like?key=' + apiKey + '&prettyPrint=false', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'Authorization': authHash, 'X-Origin': 'https://www.youtube.com' },
      body: JSON.stringify({ context, target: { videoId: vid } }),
    });
    if (!resp.ok) {
      const body = await resp.json().catch(() => ({}));
      const errStatus = (body as any)?.error?.status || '';
      if (errStatus === 'UNAUTHENTICATED' || resp.status === 401 || resp.status === 403) return { error: 'Not logged in to YouTube' };
      return { error: 'HTTP ' + resp.status + (errStatus ? ' ' + errStatus : '') };
    }
    return { ok: true };
  }, [videoId]);
  if ((result as any)?.error) throw new Error((result as any).error);
  return { success: true, message: 'Liked: ' + videoId };
}

export async function unlikeYoutubeVideo(videoId: string): Promise<{ success: boolean; message: string }> {
  const tabId = await getTab('https://www.youtube.com');
  await new Promise(r => setTimeout(r, 2000));
  const result = await executeInPage(tabId, async (vid: string) => {
    async function getSapisidHash(origin: string) {
      const cookies = document.cookie.split('; ');
      let sapisid = '';
      for (const c of cookies) {
        const eq = c.indexOf('=');
        if (eq === -1) continue;
        const name = c.slice(0, eq);
        const val = c.slice(eq + 1);
        if (name === '__Secure-3PAPISID' || name === 'SAPISID') {
          sapisid = val;
          if (name === '__Secure-3PAPISID') break;
        }
      }
      if (!sapisid) return null;
      const time = Math.floor(Date.now() / 1000);
      const msgBuffer = new TextEncoder().encode(time + ' ' + sapisid + ' ' + origin);
      const hashBuffer = await crypto.subtle.digest('SHA-1', msgBuffer);
      const hashHex = Array.from(new Uint8Array(hashBuffer)).map((b: number) => b.toString(16).padStart(2, '0')).join('');
      return 'SAPISIDHASH ' + time + '_' + hashHex;
    }
    const cfg = (window as any).ytcfg?.data_ || {};
    const apiKey = cfg.INNERTUBE_API_KEY;
    const context = cfg.INNERTUBE_CONTEXT;
    if (!apiKey || !context) return { error: 'YouTube config not found' };
    const authHash = await getSapisidHash('https://www.youtube.com');
    if (!authHash) return { error: 'Not logged in to YouTube' };
    const resp = await fetch('/youtubei/v1/like/removelike?key=' + apiKey + '&prettyPrint=false', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'Authorization': authHash, 'X-Origin': 'https://www.youtube.com' },
      body: JSON.stringify({ context, target: { videoId: vid } }),
    });
    if (!resp.ok) return { error: 'HTTP ' + resp.status };
    return { ok: true };
  }, [videoId]);
  if ((result as any)?.error) throw new Error((result as any).error);
  return { success: true, message: 'Unliked: ' + videoId };
}

export async function subscribeYoutubeChannel(channelId: string): Promise<{ success: boolean; message: string }> {
  const tabId = await getTab('https://www.youtube.com');
  await new Promise(r => setTimeout(r, 2000));
  const result = await executeInPage(tabId, async (chId: string) => {
    async function getSapisidHash(origin: string) {
      const cookies = document.cookie.split('; ');
      let sapisid = '';
      for (const c of cookies) {
        const eq = c.indexOf('=');
        if (eq === -1) continue;
        const name = c.slice(0, eq);
        const val = c.slice(eq + 1);
        if (name === '__Secure-3PAPISID' || name === 'SAPISID') {
          sapisid = val;
          if (name === '__Secure-3PAPISID') break;
        }
      }
      if (!sapisid) return null;
      const time = Math.floor(Date.now() / 1000);
      const msgBuffer = new TextEncoder().encode(time + ' ' + sapisid + ' ' + origin);
      const hashBuffer = await crypto.subtle.digest('SHA-1', msgBuffer);
      const hashHex = Array.from(new Uint8Array(hashBuffer)).map((b: number) => b.toString(16).padStart(2, '0')).join('');
      return 'SAPISIDHASH ' + time + '_' + hashHex;
    }
    const cfg = (window as any).ytcfg?.data_ || {};
    const apiKey = cfg.INNERTUBE_API_KEY;
    const context = cfg.INNERTUBE_CONTEXT;
    if (!apiKey || !context) return { error: 'YouTube config not found' };
    const authHash = await getSapisidHash('https://www.youtube.com');
    if (!authHash) return { error: 'Not logged in to YouTube' };
    let channelIdResolved = chId;
    if (chId.startsWith('@')) {
      const resolveResp = await fetch('/youtubei/v1/navigation/resolve_url?key=' + apiKey + '&prettyPrint=false', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context, url: 'https://www.youtube.com/' + chId }),
      });
      if (resolveResp.ok) {
        const resolveData = await resolveResp.json().catch(() => ({}));
        channelIdResolved = (resolveData as any).endpoint?.browseEndpoint?.browseId || chId;
      }
    }
    const resp = await fetch('/youtubei/v1/subscription/subscribe?key=' + apiKey + '&prettyPrint=false', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'Authorization': authHash, 'X-Origin': 'https://www.youtube.com' },
      body: JSON.stringify({ context, channelIds: [channelIdResolved] }),
    });
    if (!resp.ok) {
      const body = await resp.json().catch(() => ({}));
      const errStatus = (body as any)?.error?.status || '';
      if (errStatus === 'UNAUTHENTICATED' || resp.status === 401 || resp.status === 403) return { error: 'Not logged in to YouTube' };
      return { error: 'HTTP ' + resp.status };
    }
    return { ok: true, channelId: channelIdResolved };
  }, [channelId]);
  if ((result as any)?.error) throw new Error((result as any).error);
  return { success: true, message: 'Subscribed to: ' + ((result as any).channelId || channelId) };
}

export async function unsubscribeYoutubeChannel(channelId: string): Promise<{ success: boolean; message: string }> {
  const tabId = await getTab('https://www.youtube.com');
  await new Promise(r => setTimeout(r, 2000));
  const result = await executeInPage(tabId, async (chId: string) => {
    async function getSapisidHash(origin: string) {
      const cookies = document.cookie.split('; ');
      let sapisid = '';
      for (const c of cookies) {
        const eq = c.indexOf('=');
        if (eq === -1) continue;
        const name = c.slice(0, eq);
        const val = c.slice(eq + 1);
        if (name === '__Secure-3PAPISID' || name === 'SAPISID') {
          sapisid = val;
          if (name === '__Secure-3PAPISID') break;
        }
      }
      if (!sapisid) return null;
      const time = Math.floor(Date.now() / 1000);
      const msgBuffer = new TextEncoder().encode(time + ' ' + sapisid + ' ' + origin);
      const hashBuffer = await crypto.subtle.digest('SHA-1', msgBuffer);
      const hashHex = Array.from(new Uint8Array(hashBuffer)).map((b: number) => b.toString(16).padStart(2, '0')).join('');
      return 'SAPISIDHASH ' + time + '_' + hashHex;
    }
    const cfg = (window as any).ytcfg?.data_ || {};
    const apiKey = cfg.INNERTUBE_API_KEY;
    const context = cfg.INNERTUBE_CONTEXT;
    if (!apiKey || !context) return { error: 'YouTube config not found' };
    const authHash = await getSapisidHash('https://www.youtube.com');
    if (!authHash) return { error: 'Not logged in to YouTube' };
    const resp = await fetch('/youtubei/v1/subscription/unsubscribe?key=' + apiKey + '&prettyPrint=false', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'Authorization': authHash, 'X-Origin': 'https://www.youtube.com' },
      body: JSON.stringify({ context, channelIds: [chId] }),
    });
    if (!resp.ok) return { error: 'HTTP ' + resp.status };
    return { ok: true };
  }, [channelId]);
  if ((result as any)?.error) throw new Error((result as any).error);
  return { success: true, message: 'Unsubscribed from: ' + channelId };
}

export async function getYoutubeFeed(limit = 20): Promise<any[]> {
  const tabId = await getTab('https://www.youtube.com');
  await new Promise(r => setTimeout(r, 3000));
  await checkLoginRedirect(tabId, 'YouTube');
  const data = await executeInPage(tabId, (lim: number) => {
    try {
      const d = (window as any).ytInitialData;
      if (!d) return { error: 'YouTube data not found — are you logged in?' };
      const tabs = d.contents?.twoColumnBrowseResultsRenderer?.tabs || [];
      const richContents = tabs[0]?.tabRenderer?.content?.richGridRenderer?.contents || [];
      function extractFromItem(item: any) {
        const lvm = item.richItemRenderer?.content?.lockupViewModel;
        if (lvm && lvm.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO') {
          const meta = lvm.metadata?.lockupMetadataViewModel;
          const rows = meta?.metadata?.contentMetadataViewModel?.metadataRows || [];
          const parts = rows.flatMap((r: any) => (r.metadataParts || []).map((p: any) => p.text?.content || '').filter(Boolean));
          return { title: meta?.title?.content || '', channel: parts[0] || '', views: parts[1] || '', published: parts[2] || '', videoId: lvm.contentId };
        }
        const v = item.richItemRenderer?.content?.videoRenderer || item.videoRenderer;
        if (v?.videoId) {
          return {
            title: v.title?.runs?.[0]?.text || '',
            channel: v.ownerText?.runs?.[0]?.text || v.shortBylineText?.runs?.[0]?.text || '',
            views: v.viewCountText?.simpleText || v.shortViewCountText?.simpleText || '',
            duration: v.lengthText?.simpleText || '',
            published: v.publishedTimeText?.simpleText || '',
            videoId: v.videoId,
          };
        }
        return null;
      }
      const videos: any[] = [];
      for (const item of richContents) {
        if (videos.length >= lim) break;
        const v = extractFromItem(item);
        if (v?.videoId) videos.push({ rank: videos.length + 1, ...v, url: 'https://www.youtube.com/watch?v=' + v.videoId });
      }
      return videos;
    } catch (e: any) {
      return { error: e.message || 'YouTube feed scraper failed' };
    }
  }, [Math.min(limit, 100)]);
  if (data && typeof data === 'object' && 'error' in data) throw new Error((data as any).error);
  return (data as any[]) || [];
}

export async function getYoutubeHistory(limit = 30): Promise<any[]> {
  const tabId = await getTab('https://www.youtube.com/feed/history');
  await new Promise(r => setTimeout(r, 3000));
  await checkLoginRedirect(tabId, 'YouTube');
  const data = await executeInPage(tabId, (lim: number) => {
    try {
      const videos: any[] = [];
      const seen = new Set<string>();
      const root = document.querySelector('ytd-two-column-browse-results-renderer #primary ytd-section-list-renderer');
      if (!root) return { error: 'YouTube history list not found — are you logged in?' };
      function getText(el: Element | null) { return (el?.textContent || '').replace(/\s+/g, ' ').trim(); }
      for (const section of root.querySelectorAll('ytd-item-section-renderer')) {
        if (videos.length >= lim) break;
        for (const renderer of section.querySelectorAll('yt-lockup-view-model, ytd-video-renderer, ytd-rich-item-renderer, ytd-compact-video-renderer')) {
          if (videos.length >= lim) break;
          const link = renderer.querySelector('a[href^="/watch?v="]') as HTMLAnchorElement | null;
          const href = link?.getAttribute('href') || '';
          if (!href || seen.has(href)) continue;
          seen.add(href);
          const title = link?.getAttribute('title') || getText(renderer.querySelector('#video-title')) || getText(renderer.querySelector('h3 a')) || '';
          const channel = getText(renderer.querySelector('#channel-name a')) || getText(renderer.querySelector('ytd-channel-name')) || '';
          const duration = getText(renderer.querySelector('ytd-thumbnail-overlay-time-status-renderer')) || getText(renderer.querySelector('yt-thumbnail-badge-view-model')) || '';
          videos.push({ rank: videos.length + 1, title, channel, duration, url: 'https://www.youtube.com' + href });
        }
      }
      return videos;
    } catch (e: any) {
      return { error: e.message || 'YouTube history scraper failed' };
    }
  }, [Math.min(limit, 200)]);
  if (data && typeof data === 'object' && 'error' in data) throw new Error((data as any).error);
  return (data as any[]) || [];
}

export async function getYoutubeWatchLater(limit = 50): Promise<any[]> {
  const tabId = await getTab('https://www.youtube.com/playlist?list=WL');
  await new Promise(r => setTimeout(r, 3000));
  await checkLoginRedirect(tabId, 'YouTube');
  const data = await executeInPage(tabId, (lim: number) => {
    try {
      const d = (window as any).ytInitialData;
      if (!d) return { error: 'YouTube data not found — are you logged in?' };
      const tabs = d.contents?.twoColumnBrowseResultsRenderer?.tabs || [];
      const listContents = tabs[0]?.tabRenderer?.content?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents?.[0]?.playlistVideoListRenderer?.contents || [];
      function extractVideos(items: any[]) {
        return items.filter((i: any) => i.playlistVideoRenderer).map((i: any) => {
          const v = i.playlistVideoRenderer;
          const infoRuns = v.videoInfo?.runs || [];
          return {
            rank: parseInt(v.index?.simpleText || '0', 10),
            title: v.title?.runs?.[0]?.text || '',
            channel: v.shortBylineText?.runs?.[0]?.text || '',
            duration: v.lengthText?.simpleText || '',
            views: infoRuns[0]?.text || '',
            published: infoRuns[2]?.text || '',
            url: 'https://www.youtube.com/watch?v=' + v.videoId,
          };
        });
      }
      return extractVideos(listContents).slice(0, lim);
    } catch (e: any) {
      return { error: e.message || 'YouTube watch-later scraper failed' };
    }
  }, [Math.min(limit, 200)]);
  if (data && typeof data === 'object' && 'error' in data) throw new Error((data as any).error);
  return (data as any[]) || [];
}

export async function getYoutubeSubscriptions(limit = 50): Promise<any[]> {
  const tabId = await getTab('https://www.youtube.com/feed/channels');
  await new Promise(r => setTimeout(r, 3000));
  await checkLoginRedirect(tabId, 'YouTube');
  const data = await executeInPage(tabId, (lim: number) => {
    try {
      const d = (window as any).ytInitialData;
      if (!d) return { error: 'YouTube data not found — are you logged in?' };
      function readText(value: any): string {
        if (!value) return '';
        if (typeof value.simpleText === 'string') return value.simpleText.trim();
        if (Array.isArray(value.runs)) return value.runs.map((r: any) => r?.text || '').join('').trim();
        return '';
      }
      const tabs = d.contents?.twoColumnBrowseResultsRenderer?.tabs || [];
      const shelfContents = tabs[0]?.tabRenderer?.content?.sectionListRenderer?.contents || [];
      const channels: any[] = [];
      for (const shelf of shelfContents) {
        if (channels.length >= lim) break;
        const items = shelf.itemSectionRenderer?.contents?.[0]?.shelfRenderer?.content?.expandedShelfContentsRenderer?.items || [];
        for (const item of items) {
          if (channels.length >= lim) break;
          const ch = item.channelRenderer;
          if (!ch) continue;
          const name = readText(ch.title);
          const baseUrl = ch.navigationEndpoint?.browseEndpoint?.canonicalBaseUrl || '';
          const handle = ch.channelHandleText ? readText(ch.channelHandleText) : (baseUrl.startsWith('/@') ? baseUrl.slice(1) : '');
          const subscribers = readText(ch.subscriberCountText);
          const url = baseUrl ? 'https://www.youtube.com' + baseUrl : '';
          channels.push({ rank: channels.length + 1, name, handle, subscribers, url });
        }
      }
      return channels;
    } catch (e: any) {
      return { error: e.message || 'YouTube subscriptions scraper failed' };
    }
  }, [Math.min(limit, 200)]);
  if (data && typeof data === 'object' && 'error' in data) throw new Error((data as any).error);
  return (data as any[]) || [];
}

export async function getTikTokProfile(username: string): Promise<any> {
  const tabId = await getTab('https://www.tiktok.com/explore');
  await checkLoginRedirect(tabId, 'TikTok');
  const data = await executeInPage(tabId, async (user: string) => {
    try {
      const uname = user.startsWith('@') ? user.slice(1) : user;
      const res = await fetch('https://www.tiktok.com/@' + encodeURIComponent(uname), { credentials: 'include' });
      if (!res.ok) return { error: 'User not found: ' + uname };
      const html = await res.text();
      const idx = html.indexOf('__UNIVERSAL_DATA_FOR_REHYDRATION__');
      if (idx === -1) return { error: 'Could not parse TikTok profile data' };
      const start = html.indexOf('>', idx) + 1;
      const end = html.indexOf('</script>', start);
      const json = JSON.parse(html.substring(start, end));
      const ud = json['__DEFAULT_SCOPE__']?.['webapp.user-detail'];
      const u = ud?.userInfo?.user;
      const s = ud?.userInfo?.stats;
      if (!u) return { error: 'User not found: ' + uname };
      return {
        username: u.uniqueId || uname, name: u.nickname || '',
        bio: (u.signature || '').replace(/\n/g, ' ').substring(0, 120),
        followers: s?.followerCount || 0, following: s?.followingCount || 0,
        likes: s?.heartCount || 0, videos: s?.videoCount || 0,
        verified: u.verified ? 'Yes' : 'No',
      };
    } catch (e: any) { return { error: e.message || 'TikTok profile scraper failed' }; }
  }, [username]);
  if (data && typeof data === 'object' && 'error' in data) throw new Error((data as any).error);
  return data;
}

export async function likeTikTok(videoUrl: string): Promise<{ status: string; likes: string; url: string }> {
  const tabId = await getTab(videoUrl);
  await new Promise(r => setTimeout(r, 6000));
  await checkLoginRedirect(tabId, 'TikTok');
  const data = await executeInPage(tabId, async (url: string) => {
    try {
      const btn = document.querySelector('[data-e2e="like-icon"]');
      if (!btn) return { error: 'Like button not found — make sure you are logged in to TikTok' };
      const container = btn.closest('button') || btn.closest('[role="button"]') || btn;
      const aria = ((container as Element).getAttribute('aria-label') || '').toLowerCase();
      const color = window.getComputedStyle(btn as Element).color;
      const isLiked = aria.includes('unlike') || aria.includes('取消点赞') ||
        (color && (color.includes('255, 65') || color.includes('fe2c55')));
      if (isLiked) {
        const countEl = document.querySelector('[data-e2e="like-count"]');
        return { status: 'Already liked', likes: countEl ? (countEl as HTMLElement).textContent?.trim() || '-' : '-', url };
      }
      (container as HTMLElement).click();
      await new Promise(r => setTimeout(r, 2000));
      const countEl = document.querySelector('[data-e2e="like-count"]');
      return { status: 'Liked', likes: countEl ? (countEl as HTMLElement).textContent?.trim() || '-' : '-', url };
    } catch (e: any) { return { error: e.message || 'TikTok like failed' }; }
  }, [videoUrl]);
  if (data && typeof data === 'object' && 'error' in data) throw new Error((data as any).error);
  return data as any;
}
