// Background Service Worker (Chrome/Edge) / Event Page (Firefox)
// Handles Google OAuth via popup window, API proxy, and WebSocket

import { isFirefox, isChrome } from './utils/browserCompat';
import { WebSocketManager } from './utils/websocketManager';
import { localRelayManager, LocalActionRequest } from './utils/localRelayManager';
// taskAlarmScheduler + draftService removed — scheduling moved to the
// bnbot main repo's auto-publish loop (see bnbot/src/services/autoPublish/),
// and the server-side draft product line was retired.
import { searchTikTok, searchYouTube, fetchTikTokExplore, startAllIdleTimers, IDLE_BONUS_EXPLORE, likeYoutubeVideo, unlikeYoutubeVideo, subscribeYoutubeChannel, unsubscribeYoutubeChannel, getYoutubeFeed, getYoutubeHistory, getYoutubeWatchLater, getYoutubeSubscriptions, getTikTokProfile, likeTikTok, ensureDebuggerAttached, debuggerSend, getPoolTabs, openTabInScraperWindow, getTab } from './services/scraperService';
import { debuggerWriteHandlers } from './services/debugger';

/**
 * Capture a PNG screenshot of an arbitrary Chrome tab via CDP.
 *
 * Selection order (first non-null wins):
 *   - explicit `tabId`
 *   - tab matching the given URL (prefix match)
 *   - the currently focused tab in the last-focused window
 *
 * `fullPage=true` emits `captureBeyondViewport` so tall pages aren't
 * cropped to the viewport.
 *
 * Returns the tab's actual URL alongside the base64 PNG so the caller
 * can verify WHICH tab got captured (useful for CLI debugging).
 */
function waitForTabComplete(tabId: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (): void => {
      if (settled) return;
      settled = true;
      chrome.tabs.onUpdated.removeListener(onUpdated);
      clearTimeout(timer);
      resolve();
    };
    const onUpdated = (id: number, info: chrome.tabs.TabChangeInfo): void => {
      if (id === tabId && info.status === 'complete') done();
    };
    const timer = setTimeout(done, timeoutMs);
    chrome.tabs.onUpdated.addListener(onUpdated);
    // Tab may already be complete — check once up front.
    chrome.tabs.get(tabId).then((t) => {
      if (t.status === 'complete') done();
    }).catch(() => done());
  });
}

async function captureTabScreenshot(args: {
  url?: string;
  tabId?: number;
  fullPage?: boolean;
  focused?: boolean;
}): Promise<{ base64: string; tabId: number; url: string; title: string }> {
  let tabId = args.tabId;

  // Default selection order (unless --focused forces user's focused tab):
  //   1. explicit --tab-id
  //   2. explicit --url match
  //   3. bnbot's automation pool (the tab CDP is actually driving)
  //   4. focused tab, with chrome://* fallback
  if (!tabId && !args.url && !args.focused) {
    // Prefer whatever tab bnbot is currently automating — that's what
    // the user almost always wants when they say "screenshot right now".
    // Ranking: busy > x.com > anything else. X is the primary platform;
    // third-party-project tabs (spareapi.ai, tiktok.com, etc.) sit in
    // the pool too but rarely what the user wants by default.
    const pool = getPoolTabs();
    if (pool.length > 0) {
      const primaryHosts = ['x.com', 'twitter.com'];
      const score = (p: { host: string; busy: boolean }): number =>
        (p.busy ? 10 : 0) + (primaryHosts.includes(p.host) ? 5 : 0);
      pool.sort((a, b) => score(b) - score(a));
      tabId = pool[0].tabId;
    }
  }

  if (!tabId && args.url) {
    // Only match a tab that already sits on the exact URL (or a close
    // prefix) AND lives in a scraper window — never reuse a tab in the
    // user's main browser window (that would hijack their view).
    const scraperWindowIds = new Set(getPoolTabs().map((p) => p.windowId));
    const allTabs = await chrome.tabs.query({});
    const match = allTabs.find(
      (t) =>
        t.id != null &&
        t.url?.startsWith(args.url!) &&
        scraperWindowIds.has(t.windowId),
    );
    if (match?.id != null) {
      tabId = match.id;
    } else {
      // Create a fresh tab inside the scraper window (or spin up a
      // scraper window if none exists). User's main window stays
      // untouched.
      tabId = await openTabInScraperWindow(args.url);
      await waitForTabComplete(tabId, 15_000);
      // SPA sites (x.com) stream content after status=complete; give the
      // view some time to actually paint before we snap the picture.
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  } else if (!tabId) {
    // Focused tab preferred. But chrome.debugger can't attach to
    // chrome://* or devtools:// pages — if the focused tab is one of
    // those (e.g. user just hit Cmd-R on chrome://extensions to
    // reload us), fall back to the most-recently-accessed normal tab.
    const canAttach = (t: chrome.tabs.Tab): boolean =>
      !!t.url && !t.url.startsWith('chrome://') && !t.url.startsWith('chrome-extension://') && !t.url.startsWith('devtools://') && !t.url.startsWith('edge://');

    const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (activeTab?.id != null && canAttach(activeTab)) {
      tabId = activeTab.id;
    } else {
      const allTabs = await chrome.tabs.query({});
      const candidates = allTabs.filter((t) => t.id != null && canAttach(t));
      if (candidates.length === 0) {
        throw new Error('No capturable tab found (focused tab is chrome://* and no other normal tabs open). Pass --url or --tab-id.');
      }
      // Prefer the most recently accessed one. `lastAccessed` is a
      // Chrome 121+ property; on older versions fall back to the
      // first match (tabs.query returns in tab-index order).
      candidates.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
      tabId = candidates[0].id!;
    }
  }

  const targetId = await ensureDebuggerAttached(tabId, ['Page']);
  const params: Record<string, unknown> = { format: 'png' };
  if (args.fullPage) params.captureBeyondViewport = true;

  const { data } = await debuggerSend<{ data: string }>(targetId, 'Page.captureScreenshot', params);
  const tab = await chrome.tabs.get(tabId);
  return { base64: data, tabId, url: tab.url || '', title: tab.title || '' };
}

/**
 * Navigate a scraper tab to a URL via CDP (Page.navigate).
 *
 * Why CDP instead of content-script pushState:
 *   - pushState runs in whatever X tab the action system routes to — could
 *     easily be the user's main-browser X tab, hijacking their view.
 *   - CDP lets us pick an explicit tab (pool x.com tab by default) and
 *     navigate it deterministically. Works for cross-origin URLs too.
 *
 * Selection order:
 *   1. explicit tabId
 *   2. any scraper-pool tab on the same host → reuse
 *   3. no match → open a new tab in the scraper window
 */
async function navigateTabViaCdp(args: {
  url: string;
  tabId?: number;
}): Promise<{ tabId: number; url: string; title: string }> {
  if (!args.url) throw new Error('navigate_to_url: missing url');
  const fullUrl = args.url.startsWith('http') ? args.url : `https://x.com${args.url.startsWith('/') ? '' : '/'}${args.url}`;

  // Default to the pool's tab for this host (creates+minimizes one if
  // missing, reuses+refreshes it if it's already open). This way multiple
  // navigate calls in a row land on the same tab instead of piling up.
  const tabId = args.tabId ?? await getTab(fullUrl);

  const currentTab = await chrome.tabs.get(tabId);
  if (currentTab.url === fullUrl) {
    return { tabId, url: currentTab.url || fullUrl, title: currentTab.title || '' };
  }

  const targetId = await ensureDebuggerAttached(tabId, ['Page']);
  await debuggerSend(targetId, 'Page.navigate', { url: fullUrl });
  await waitForTabComplete(tabId, 15_000);
  // SPA render delay — status=complete fires before X's React tree
  // actually paints the new route.
  await new Promise((resolve) => setTimeout(resolve, 800));
  const tab = await chrome.tabs.get(tabId);
  return { tabId, url: tab.url || fullUrl, title: tab.title || '' };
}

/**
 * Inject local file(s) into a file input on a scraper-pool tab via CDP
 * DOM.setFileInputFiles. Dev/debug helper — the real XHS / other write
 * paths will call this same primitive from their respective action
 * modules, but for probing a new platform's form state we want it
 * exposed at CLI level.
 */
async function debugSetFileInputFiles(args: {
  selector: string;
  files: string[];
  tabId?: number;
  targetHost?: string;
}): Promise<{ tabId: number; url: string; nodeId: number; files: string[] }> {
  if (!args.selector) throw new Error('debug_set_files: missing selector');
  if (!args.files || args.files.length === 0) throw new Error('debug_set_files: missing files');

  let tabId = args.tabId;
  if (!tabId) {
    const pool = getPoolTabs();
    if (pool.length === 0) throw new Error('debug_set_files: no pool tabs');
    const hostMatch = args.targetHost ? pool.find((p) => p.host === args.targetHost) : null;
    tabId = (hostMatch ?? pool[0]).tabId;
  }

  const targetId = await ensureDebuggerAttached(tabId, ['Page', 'DOM']);

  const doc = await debuggerSend<{ root: { nodeId: number } }>(
    targetId,
    'DOM.getDocument',
    { depth: -1, pierce: true },
  );
  const q = await debuggerSend<{ nodeId: number }>(
    targetId,
    'DOM.querySelector',
    { nodeId: doc.root.nodeId, selector: args.selector },
  );
  if (!q?.nodeId) throw new Error(`file input not found: ${args.selector}`);

  await debuggerSend(targetId, 'DOM.setFileInputFiles', {
    nodeId: q.nodeId,
    files: args.files,
  });

  const tab = await chrome.tabs.get(tabId);
  return { tabId, url: tab.url || '', nodeId: q.nodeId, files: args.files };
}

/**
 * Drag an element onto another via CDP `Input.dispatchMouseEvent`
 * (trusted mousePressed + interpolated mouseMoved + mouseReleased).
 * Needed for sortable-style drag reorder (XHS image strip, etc.) that
 * reject synthetic pointer events.
 */
async function debugDrag(args: {
  fromSelector: string;
  toSelector: string;
  steps?: number;
  tabId?: number;
  targetHost?: string;
}): Promise<{ tabId: number; url: string; from: {x:number,y:number}; to: {x:number,y:number} }> {
  if (!args.fromSelector) throw new Error('debug_drag: missing fromSelector');
  if (!args.toSelector) throw new Error('debug_drag: missing toSelector');

  let tabId = args.tabId;
  if (!tabId) {
    const pool = getPoolTabs();
    if (pool.length === 0) throw new Error('debug_drag: no pool tabs');
    const hostMatch = args.targetHost ? pool.find((p) => p.host === args.targetHost) : null;
    tabId = (hostMatch ?? pool[0]).tabId;
  }

  const targetId = await ensureDebuggerAttached(tabId, ['Runtime', 'Input']);

  const coords = await debuggerSend<{ result: { value: { sx:number, sy:number, dx:number, dy:number } | null } }>(
    targetId,
    'Runtime.evaluate',
    {
      expression: `(function(){
        const s = document.querySelector(${JSON.stringify(args.fromSelector)});
        const d = document.querySelector(${JSON.stringify(args.toSelector)});
        if (!s || !d) return null;
        s.scrollIntoView({block:'center'});
        const rs = s.getBoundingClientRect();
        const rd = d.getBoundingClientRect();
        return {sx: rs.x+rs.width/2, sy: rs.y+rs.height/2, dx: rd.x+rd.width/2, dy: rd.y+rd.height/2};
      })()`,
      returnByValue: true,
    },
  );
  if (!coords?.result?.value) throw new Error(`debug_drag: element(s) not found (${args.fromSelector} → ${args.toSelector})`);
  const { sx, sy, dx, dy } = coords.result.value;
  const steps = Math.max(5, args.steps ?? 20);

  await debuggerSend(targetId, 'Input.dispatchMouseEvent', {
    type: 'mousePressed', x: sx, y: sy, button: 'left', clickCount: 1,
  });
  for (let i = 1; i <= steps; i++) {
    const x = sx + (dx - sx) * (i / steps);
    const y = sy + (dy - sy) * (i / steps);
    await debuggerSend(targetId, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved', x, y, button: 'left',
    });
    await new Promise((r) => setTimeout(r, 20));
  }
  await debuggerSend(targetId, 'Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: dx, y: dy, button: 'left', clickCount: 1,
  });

  const tab = await chrome.tabs.get(tabId);
  return { tabId, url: tab.url || '', from: {x:sx, y:sy}, to: {x:dx, y:dy} };
}

/**
 * Un-minimize a pool tab's window so the user can see what the scraper
 * is doing. Pool windows are created minimized by design (don't clutter
 * the user's real work), but during probing / debugging we want a
 * visible surface.
 */
async function debugShowPoolWindow(args: {
  tabId?: number;
  targetHost?: string;
}): Promise<{ tabId: number; windowId: number; url: string }> {
  let tabId = args.tabId;
  if (!tabId) {
    const pool = getPoolTabs();
    if (pool.length === 0) throw new Error('debug_show_window: no pool tabs');
    const hostMatch = args.targetHost ? pool.find((p) => p.host === args.targetHost) : null;
    tabId = (hostMatch ?? pool[0]).tabId;
  }
  const tab = await chrome.tabs.get(tabId);
  if (tab.windowId != null) {
    // `debug show` is the explicit "raise to front" command. Un-minimize
    // + move to a visible position. focused:true here — this IS the
    // command where the user wants to look at it.
    await chrome.windows.update(tab.windowId, {
      state: 'normal',
      focused: true,
      left: 80,
      top: 80,
      width: 1280,
      height: 800,
    });
    // Also make the target tab active within its window. Without this,
    // `debug show --host x.com` un-minimizes the window but whichever
    // tab was previously selected stays visible, forcing the user to
    // click the tab manually.
    await chrome.tabs.update(tabId, { active: true }).catch(() => {});
  }
  return { tabId, windowId: tab.windowId ?? -1, url: tab.url || '' };
}

/**
 * Install a persistent fetch/XHR interceptor in a pool tab via CDP
 * `Page.addScriptToEvaluateOnNewDocument`. Survives reloads and
 * subsequent navigations — everything the page calls to /api/ or
 * graphql lands in `window.__bnbotCap` as {url,status,method,body}.
 * Pair with `debugRecordDump` to read and with `debugRecordStop` to
 * remove. Used by `bnbot debug record <url>` to mirror third-party
 * Next.js / SPA backends.
 */
let recordingScriptIds = new Map<string, string>();

async function debugRecordStart(args: {
  tabId?: number;
  targetHost?: string;
  filterPattern?: string;
}): Promise<{ tabId: number; scriptId: string }> {
  let tabId = args.tabId;
  if (!tabId) {
    const pool = getPoolTabs();
    if (pool.length === 0) throw new Error('debug_record_start: no pool tabs');
    const hostMatch = args.targetHost ? pool.find((p) => p.host === args.targetHost) : null;
    tabId = (hostMatch ?? pool[0]).tabId;
  }
  const targetId = await ensureDebuggerAttached(tabId, ['Page', 'Runtime']);
  const filter = args.filterPattern || '/api/|graphql';
  const source = `
    (function () {
      if (window.__bnbotHooked) { window.__bnbotCap = []; return; }
      window.__bnbotHooked = true;
      window.__bnbotCap = [];
      const re = new RegExp(${JSON.stringify(filter)}, 'i');
      const push = (method, url, status, body, reqBody) => {
        try {
          window.__bnbotCap.push({
            method: String(method || 'GET'),
            url: String(url),
            status: Number(status || 0),
            body: String(body || '').slice(0, 100000),
            reqBody: String(reqBody || '').slice(0, 20000),
            ts: Date.now(),
          });
        } catch {}
      };
      const origFetch = window.fetch;
      window.fetch = async function (input, init) {
        const url = typeof input === 'string' ? input : (input && input.url) || '';
        const method = (init && init.method) || (input && input.method) || 'GET';
        let reqBody = '';
        try { reqBody = typeof init?.body === 'string' ? init.body : ''; } catch {}
        const resp = await origFetch.apply(this, arguments);
        try {
          if (re.test(url)) {
            const text = await resp.clone().text();
            push(method, url, resp.status, text, reqBody);
          }
        } catch {}
        return resp;
      };
      const OO = XMLHttpRequest.prototype.open;
      const OS = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.open = function (method, url) {
        this.__bnbotUrl = url;
        this.__bnbotMethod = method;
        return OO.apply(this, arguments);
      };
      XMLHttpRequest.prototype.send = function (body) {
        try { this.__bnbotReqBody = typeof body === 'string' ? body : ''; } catch {}
        this.addEventListener('load', () => {
          try {
            if (re.test(this.__bnbotUrl || '')) {
              push(this.__bnbotMethod, this.__bnbotUrl, this.status, this.responseText, this.__bnbotReqBody);
            }
          } catch {}
        });
        return OS.apply(this, arguments);
      };
    })();
  `;
  // Remove any previous script so re-starting doesn't stack wrappers.
  const existing = recordingScriptIds.get(targetId);
  if (existing) {
    await debuggerSend(targetId, 'Page.removeScriptToEvaluateOnNewDocument', { identifier: existing }).catch(() => {});
  }
  const { identifier } = await debuggerSend<{ identifier: string }>(
    targetId,
    'Page.addScriptToEvaluateOnNewDocument',
    { source },
  );
  recordingScriptIds.set(targetId, identifier);
  // Prime the live document too (so current page, pre-reload, also records).
  await debuggerSend(targetId, 'Runtime.evaluate', { expression: source });
  return { tabId, scriptId: identifier };
}

async function debugRecordDump(args: {
  tabId?: number;
  targetHost?: string;
  clear?: boolean;
}): Promise<Array<{ method: string; url: string; status: number; body: string; ts: number }>> {
  let tabId = args.tabId;
  if (!tabId) {
    const pool = getPoolTabs();
    if (pool.length === 0) throw new Error('debug_record_dump: no pool tabs');
    const hostMatch = args.targetHost ? pool.find((p) => p.host === args.targetHost) : null;
    tabId = (hostMatch ?? pool[0]).tabId;
  }
  const targetId = await ensureDebuggerAttached(tabId, ['Page', 'Runtime']);
  const result = await debuggerSend<{ result: { value?: unknown } }>(
    targetId,
    'Runtime.evaluate',
    {
      expression: `(()=>{ const c = window.__bnbotCap || []; ${args.clear ? 'window.__bnbotCap = [];' : ''} return c; })()`,
      returnByValue: true,
    },
  );
  return (result.result?.value as Array<{ method: string; url: string; status: number; body: string; ts: number }>) || [];
}

async function debugRecordStop(args: {
  tabId?: number;
  targetHost?: string;
}): Promise<{ tabId: number; removed: boolean }> {
  let tabId = args.tabId;
  if (!tabId) {
    const pool = getPoolTabs();
    if (pool.length === 0) throw new Error('debug_record_stop: no pool tabs');
    const hostMatch = args.targetHost ? pool.find((p) => p.host === args.targetHost) : null;
    tabId = (hostMatch ?? pool[0]).tabId;
  }
  const targetId = await ensureDebuggerAttached(tabId, ['Page', 'Runtime']);
  const id = recordingScriptIds.get(targetId);
  if (!id) return { tabId, removed: false };
  await debuggerSend(targetId, 'Page.removeScriptToEvaluateOnNewDocument', { identifier: id }).catch(() => {});
  recordingScriptIds.delete(targetId);
  return { tabId, removed: true };
}

/**
 * Dispatch a REAL (trusted) mouse click at the element's center via CDP
 * `Input.dispatchMouseEvent`. Needed for buttons whose framework code
 * checks `event.isTrusted` (e.g. XHS emoji / share buttons) — synthetic
 * JS events skip the handler there.
 */
async function debugTrustedClick(args: {
  selector: string;
  tabId?: number;
  targetHost?: string;
}): Promise<{ tabId: number; url: string; x: number; y: number }> {
  if (!args.selector) throw new Error('debug_click: missing selector');

  let tabId = args.tabId;
  if (!tabId) {
    const pool = getPoolTabs();
    if (pool.length === 0) throw new Error('debug_click: no pool tabs');
    const hostMatch = args.targetHost ? pool.find((p) => p.host === args.targetHost) : null;
    tabId = (hostMatch ?? pool[0]).tabId;
  }

  const targetId = await ensureDebuggerAttached(tabId, ['Runtime', 'Input']);

  const rect = await debuggerSend<{ result: { value: { x: number; y: number } | null } }>(
    targetId,
    'Runtime.evaluate',
    {
      expression: `(function(){const el=document.querySelector(${JSON.stringify(args.selector)});if(!el)return null;el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`,
      returnByValue: true,
    },
  );
  if (!rect?.result?.value) throw new Error(`debug_click: element not found ${args.selector}`);
  const { x, y } = rect.result.value;

  await debuggerSend(targetId, 'Input.dispatchMouseEvent', {
    type: 'mousePressed', x, y, button: 'left', clickCount: 1,
  });
  await debuggerSend(targetId, 'Input.dispatchMouseEvent', {
    type: 'mouseReleased', x, y, button: 'left', clickCount: 1,
  });

  const tab = await chrome.tabs.get(tabId);
  return { tabId, url: tab.url || '', x, y };
}

/**
 * Run arbitrary JS inside a scraper-pool tab via CDP Runtime.evaluate.
 * Dev/debug helper — lets us probe DOM selectors, check page state, etc.
 * without adding per-case handlers. Safety: only targets tabs the
 * extension already has CDP access to.
 *
 * Selection order:
 *   - explicit tabId
 *   - a pool tab whose host matches targetHost (if given)
 *   - first pool tab
 *
 * Returns whatever the expression evaluates to (must be JSON-serializable).
 */
async function debugEvalInTab(args: {
  expression: string;
  tabId?: number;
  targetHost?: string;
  awaitPromise?: boolean;
}): Promise<{ tabId: number; url: string; result: unknown; exception?: string }> {
  if (!args.expression) throw new Error('debug_eval: missing expression');

  let tabId = args.tabId;
  if (!tabId) {
    const pool = getPoolTabs();
    if (pool.length === 0) throw new Error('debug_eval: no pool tabs — navigate somewhere first');
    const hostMatch = args.targetHost ? pool.find((p) => p.host === args.targetHost) : null;
    tabId = (hostMatch ?? pool[0]).tabId;
  }

  const targetId = await ensureDebuggerAttached(tabId, ['Page']);
  const res = await debuggerSend<{
    result: { type: string; value?: unknown };
    exceptionDetails?: { exception?: { description?: string }; text?: string };
  }>(targetId, 'Runtime.evaluate', {
    expression: args.expression,
    awaitPromise: !!args.awaitPromise,
    returnByValue: true,
  });

  const tab = await chrome.tabs.get(tabId);
  if (res?.exceptionDetails) {
    const msg = res.exceptionDetails.exception?.description
      || res.exceptionDetails.text
      || 'page threw';
    return { tabId, url: tab.url || '', result: null, exception: msg };
  }
  return { tabId, url: tab.url || '', result: res?.result?.value ?? null };
}
import { searchReddit, fetchRedditHot, redditUpvote, redditSave, getRedditFrontpage, getRedditPost, getRedditUser, redditSubscribe, searchBilibili, fetchBilibiliHot, fetchBilibiliRanking, getBilibiliDynamic, getBilibiliHistory, getBilibiliFollowing, getBilibiliUserVideos, getBilibiliComments, searchZhihu, fetchZhihuHot, likeZhihu, getZhihuQuestion, searchXueqiu, fetchXueqiuHot, searchInstagram, fetchInstagramExplore, searchLinuxDo, searchJike, searchXiaohongshu, searchWeibo, fetchWeiboHot, searchDouban, fetchDoubanMovieHot, fetchDoubanBookHot, fetchDoubanTop250, searchMedium, searchGoogle, searchGoogleNews, searchFacebook, searchLinkedInJobs, search36Kr, fetch36KrHot, fetch36KrNews, fetchProductHuntHot, fetchWeixinArticle, fetchYahooFinanceQuote, getTwitterTimeline, searchTwitter, getTwitterTrending, getTwitterProfile, getTwitterBookmarks, getTwitterUserTweets, getTwitterThread, getTwitterNotifications } from './services/scrapers/browser';

// GOOGLE_CLIENT_ID / OAUTH_REDIRECT_URI removed — see handleGoogleLogin
// removal note. chrome.identity.getRedirectURL() also no longer needed.
const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:8000';
const WS_BASE_URL = process.env.WS_BASE_URL || '';

// Track if remote control is enabled (WebSocket connected)
let remoteControlEnabled = false;

// Firefox: WebSocket runs directly in background (no offscreen document)
let firefoxWsManager: WebSocketManager | null = null;
if (isFirefox) {
  firefoxWsManager = new WebSocketManager(API_BASE_URL, {
    notifyHost(data: any) {
      // In Firefox, the background IS the host — forward WS events to content scripts
      if (data.type === 'WS_CONNECTED') {
        remoteControlEnabled = true;
        setXTabsKeepAlive(true);
        sendToOneXTab(data);
      } else if (data.type === 'WS_DISCONNECTED') {
        remoteControlEnabled = false;
        setXTabsKeepAlive(false);
        chrome.tabs.query({ url: ['*://twitter.com/*', '*://x.com/*'] }, (tabs) => {
          for (const tab of tabs) {
            if (tab.id) {
              chrome.tabs.sendMessage(tab.id, data).catch(() => {});
            }
          }
        });
      } else if (data.type === 'WS_MESSAGE') {
        // task_sync messages dropped — scheduling now lives in bnbot CLI calendar.
        sendToOneXTab(data);
      }
    },
    async requestFreshToken() {
      return handleFreshTokenRequest();
    },
  }, WS_BASE_URL || undefined);
}

// ============ Local Relay (bnbot bridge — ws://localhost:18900) ============

// Initialize local relay manager for the bnbot daemon (`bnbot serve`).
localRelayManager.init({
  onAction: async (message: LocalActionRequest) => {
    console.log(`[Background] Local relay action: ${message.actionType} (${message.requestId}) payload:`, JSON.stringify(message.actionPayload));

    // Handle inject_auth_tokens directly in background (no content script needed)
    if (message.actionType === 'inject_auth_tokens') {
      try {
        const { access_token, refresh_token, user } = message.actionPayload as {
          access_token?: string;
          refresh_token?: string;
          user?: Record<string, unknown>;
        };

        if (!access_token || !refresh_token) {
          localRelayManager.sendActionResult({
            type: 'action_result',
            requestId: message.requestId,
            success: false,
            error: 'Missing access_token or refresh_token in payload',
          });
          return;
        }

        // Write tokens directly to chrome.storage.local
        const storageData: Record<string, unknown> = {
          'accessToken.bnbot': access_token,
          'refreshToken.bnbot': refresh_token,
        };
        if (user) {
          storageData['userData.bnbot'] = user;
        }
        await chrome.storage.local.set(storageData);
        console.log('[Background] Auth tokens injected via local relay');

        // Notify all X tabs to refresh auth state
        chrome.tabs.query({ url: ['*://twitter.com/*', '*://x.com/*'] }, (tabs) => {
          for (const tab of tabs ?? []) {
            if (tab.id) {
              chrome.tabs.sendMessage(tab.id, { type: 'AUTH_INJECTED' }).catch(() => {});
            }
          }
        });

        localRelayManager.sendActionResult({
          type: 'action_result',
          requestId: message.requestId,
          success: true,
          data: { message: 'Auth tokens injected successfully' },
        });
      } catch (error) {
        console.error('[Background] inject_auth_tokens error:', error);
        localRelayManager.sendActionResult({
          type: 'action_result',
          requestId: message.requestId,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
      return;
    }

    // Handle device_key sync from CLI
    if (message.actionType === 'sync_device_key') {
      const { deviceKey } = message.actionPayload as { deviceKey: string };
      await chrome.storage.local.set({ cliDeviceKey: deviceKey });
      localRelayManager.sendActionResult({
        type: 'action_result',
        requestId: message.requestId,
        success: true,
        data: { message: 'Device key synced' },
      });
      return;
    }

    // draft_alarm_sync / draft_alarm_remove handlers removed — the
    // server-side draft product line was retired in favour of the bnbot
    // main repo's local-markdown auto-publish loop.

    // Handle debugger-based write actions directly in background.
    // These open a background X tab, attach chrome.debugger, drive the
    // page via CDP (Input.insertText / DOM.setFileInputFiles / clicks),
    // then detach + close. Text-only for now; media paths work when
    // Chrome can read the file.
    const debuggerKey = Object.keys(debuggerWriteHandlers).find(k =>
      message.actionType === k
    );
    if (debuggerKey) {
      try {
        const data = await debuggerWriteHandlers[debuggerKey](
          (message.actionPayload ?? {}) as Record<string, unknown>,
        );
        startAllIdleTimers();
        localRelayManager.sendActionResult({
          type: 'action_result',
          requestId: message.requestId,
          success: true,
          data,
        });
      } catch (error) {
        startAllIdleTimers();
        localRelayManager.sendActionResult({
          type: 'action_result',
          requestId: message.requestId,
          success: false,
          error: error instanceof Error ? error.message : 'Debugger write failed',
        });
      }
      return;
    }

    // Handle scraper actions directly in background (no content script needed)
    const scraperKey = Object.keys(scraperHandlers).find(k =>
      message.actionType === k || message.actionType === k.toLowerCase().replace(/_/g, '-')
    );
    if (scraperKey) {
      // Exploration-style actions (human probing a new platform's DOM) need
      // a bigger idle bonus than the default — think time between eval
      // calls routinely exceeds a couple minutes.
      const EXPLORE_ACTIONS = new Set(['debug_eval', 'debug_set_files', 'debug_click', 'debug_show_window', 'debug_drag', 'debug_record_start', 'debug_record_dump', 'debug_record_stop', 'navigate_to_url', 'screenshot']);
      const bonusMs = EXPLORE_ACTIONS.has(scraperKey) ? IDLE_BONUS_EXPLORE : undefined;
      try {
        const data = await scraperHandlers[scraperKey](message.actionPayload as any);
        startAllIdleTimers(bonusMs);
        localRelayManager.sendActionResult({
          type: 'action_result',
          requestId: message.requestId,
          success: true,
          data,
        });
      } catch (error) {
        startAllIdleTimers(bonusMs);
        localRelayManager.sendActionResult({
          type: 'action_result',
          requestId: message.requestId,
          success: false,
          error: error instanceof Error ? error.message : 'Scraper error',
        });
      }
      return;
    }

    // Forward action to the content script for execution
    const sent = await sendToOneXTab({
      type: 'LOCAL_ACTION',
      requestId: message.requestId,
      actionType: message.actionType,
      actionPayload: message.actionPayload,
    });

    // If message could not be delivered, return error immediately
    if (!sent) {
      console.error(`[Background] Failed to deliver action ${message.actionType} to content script`);
      localRelayManager.sendActionResult({
        type: 'action_result',
        requestId: message.requestId,
        success: false,
        error: 'No Twitter/X tab with content script available. Please open x.com and refresh the page.',
      });
    }
  },
  onConnectionChange: (connected: boolean) => {
    console.log(`[Background] Local relay ${connected ? 'connected' : 'disconnected'}`);
    // Keep at least one X tab alive when local relay is connected
    if (connected) {
      setXTabsKeepAlive(true);
    } else if (!remoteControlEnabled) {
      setXTabsKeepAlive(false);
    }
  },
});

// Load local relay settings from storage on startup
// Default to enabled so users can connect immediately after installing
chrome.storage.local.get(['bnbotBridgeEnabled', 'bnbotBridgePort'], (result) => {
  const enabled = result.bnbotBridgeEnabled !== false;
  const port = result.bnbotBridgePort || 18900;
  if (enabled) {
    console.log('[Background] bnbot bridge enabled on startup, port:', port);
    localRelayManager.setEnabled(true, port);
  }
});

// Auto-check for updates on startup (only for Web Store installs)
if (chrome.runtime.getManifest().update_url) {
  chrome.runtime.requestUpdateCheck().then(([status]) => {
    if (status === 'update_available') {
      console.log('[Background] Update available, will apply on next Chrome restart');
    }
  }).catch(() => {});
}

// Listen for local action results from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'LOCAL_ACTION_RESULT') {
    const { requestId, success, data, error } = message;
    console.log(`[Background] Local action result: ${requestId}, success: ${success}`);
    localRelayManager.sendActionResult({
      type: 'action_result',
      requestId,
      success,
      data,
      error,
      retryAfter: error === 'extension_busy' ? 3000 : undefined,
    });
    sendResponse({ ok: true });
    return false;
  }

  // bnbot bridge control messages
  if (message.type === 'BNBOT_BRIDGE_SET_ENABLED') {
    const { enabled, port } = message;
    console.log(`[Background] bnbot bridge ${enabled ? 'enabling' : 'disabling'}, port: ${port}`);
    localRelayManager.setEnabled(enabled, port);
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === 'BNBOT_BRIDGE_RECONNECT') {
    console.log('[Background] bnbot bridge manual reconnect');
    localRelayManager.reconnect();
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === 'BNBOT_BRIDGE_GET_STATUS') {
    sendResponse(localRelayManager.getConfig());
    return false;
  }
});

// ============ Tab Keep-Alive (Prevent Chrome from discarding X tabs) ============

/**
 * Prevent Chrome from discarding/freezing one X tab when remote control is
 * enabled. We only need one tab alive for scheduled tasks + bnbot bridge
 * action dispatch to keep working when the user isn't actively viewing X.
 */
async function setXTabsKeepAlive(enabled: boolean): Promise<void> {
  // Firefox event page doesn't support autoDiscardable
  if (isFirefox) return;

  const tabs = await chrome.tabs.query({ url: ['*://twitter.com/*', '*://x.com/*'] });

  if (enabled && tabs.length > 0) {
    // Only keep the first X tab alive
    const tab = tabs[0];
    if (tab.id) {
      try {
        await chrome.tabs.update(tab.id, { autoDiscardable: false });
        console.log(`[Background] Tab ${tab.id} set to keep-alive`);
      } catch (err) {
        // Tab might have been closed
      }
    }
  } else if (!enabled) {
    // When disabling, restore all tabs to default behavior
    for (const tab of tabs) {
      if (tab.id) {
        try {
          await chrome.tabs.update(tab.id, { autoDiscardable: true });
        } catch (err) {
          // Tab might have been closed
        }
      }
    }
    console.log(`[Background] Restored ${tabs.length} X tabs to default`);
  }
}

// When new X tab is opened, set autoDiscardable based on remote control status
// (Chrome/Edge only — Firefox doesn't support autoDiscardable)
// Track tabs already set to keep-alive to avoid spamming logs and redundant API calls
const keepAliveTabs = new Set<number>();
if (isChrome) {
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (remoteControlEnabled && changeInfo.status === 'complete' && tab.url) {
      if ((tab.url.includes('twitter.com') || tab.url.includes('x.com')) && !keepAliveTabs.has(tabId)) {
        chrome.tabs.update(tabId, { autoDiscardable: false }).catch(() => {});
        keepAliveTabs.add(tabId);
        console.log(`[Background] New X tab ${tabId} set to keep-alive`);
      }
    }
  });
  chrome.tabs.onRemoved.addListener((tabId) => {
    keepAliveTabs.delete(tabId);
  });
}

/**
 * Send message to one X tab only (avoid duplicate execution)
 * Priority: active X tab > first X tab > auto-open new tab
 * Returns true if message was successfully delivered, false otherwise.
 */
async function sendToOneXTab(message: object): Promise<boolean> {
  // Helper: send message and verify content script received it
  async function trySend(tabId: number): Promise<boolean> {
    try {
      await chrome.tabs.sendMessage(tabId, message);
      return true;
    } catch {
      console.warn(`[Background] Content script not responding on tab ${tabId}`);
      return false;
    }
  }

  // First try to find active X tab in current window
  const activeTabs = await chrome.tabs.query({
    url: ['*://twitter.com/*', '*://x.com/*'],
    active: true,
    currentWindow: true
  });

  if (activeTabs.length > 0 && activeTabs[0].id) {
    const sent = await trySend(activeTabs[0].id);
    if (sent) {
      console.log(`[Background] Sent to active X tab ${activeTabs[0].id}`);
      return true;
    }
  }

  // Fallback: any X tab
  const allXTabs = await chrome.tabs.query({
    url: ['*://twitter.com/*', '*://x.com/*']
  });

  for (const tab of allXTabs) {
    if (tab.id) {
      const sent = await trySend(tab.id);
      if (sent) {
        console.log(`[Background] Sent to X tab ${tab.id}`);
        return true;
      }
    }
  }

  // No X tab found - auto-open one in background
  console.log('[Background] No X tab found, opening one automatically...');

  try {
    const newTab = await chrome.tabs.create({
      url: 'https://x.com/home',
      active: false  // Open in background, don't disturb user
    });

    if (!newTab.id) {
      console.error('[Background] Failed to create new X tab');
      return false;
    }

    // Wait for content script to load (listen for tab complete + small delay)
    await new Promise<void>((resolve) => {
      const onUpdated = (tabId: number, changeInfo: { status?: string }) => {
        if (tabId === newTab.id && changeInfo.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(onUpdated);
          // Give content script time to initialize
          setTimeout(resolve, 1500);
        }
      };
      chrome.tabs.onUpdated.addListener(onUpdated);

      // Timeout fallback (15 seconds)
      setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(onUpdated);
        resolve();
      }, 15000);
    });

    // Now send the message
    const sent = await trySend(newTab.id);
    if (sent) {
      console.log(`[Background] Sent to newly opened X tab ${newTab.id}`);
    }

    // Set keep-alive if remote control is enabled (Chrome/Edge only)
    if (remoteControlEnabled && isChrome) {
      chrome.tabs.update(newTab.id, { autoDiscardable: false }).catch(() => {});
    }

    return sent;
  } catch (err) {
    console.error('[Background] Failed to open X tab:', err);
    return false;
  }
}

// ============ Offscreen Document Management (Chrome/Edge only) ============

let creatingOffscreen: Promise<void> | null = null;

async function ensureOffscreenDocument(): Promise<void> {
  // Firefox doesn't support offscreen documents
  if (isFirefox) return;

  const offscreenUrl = chrome.runtime.getURL('offscreen.html');

  // Check if offscreen document already exists
  if (chrome.runtime.getContexts) {
    const existingContexts = await chrome.runtime.getContexts({
      contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
      documentUrls: [offscreenUrl]
    });

    if (existingContexts.length > 0) {
      return; // Already exists
    }
  }

  // Create offscreen document (prevent multiple simultaneous creations)
  if (creatingOffscreen) {
    await creatingOffscreen;
    return;
  }

  creatingOffscreen = chrome.offscreen.createDocument({
    url: offscreenUrl,
    reasons: [chrome.offscreen.Reason.WEB_RTC], // WEB_RTC allows persistent connections
    justification: 'Maintain WebSocket connection for remote control + bnbot bridge'
  });

  await creatingOffscreen;
  creatingOffscreen = null;
  console.log('[Background] Offscreen document created');
}

// Forward WebSocket messages from offscreen to content scripts (Chrome only)
// On Firefox, WS events are forwarded by firefoxWsManager.notifyHost directly
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Messages from offscreen document to broadcast to tabs (Chrome only path)
  if (isChrome && message.type === 'WS_CONNECTED') {
    remoteControlEnabled = true;
    setXTabsKeepAlive(true);

    // Send to active X tab first, otherwise first X tab
    sendToOneXTab(message);
    return false;
  }

  if (isChrome && message.type === 'WS_DISCONNECTED') {
    remoteControlEnabled = false;
    setXTabsKeepAlive(false);

    // Broadcast disconnect to all tabs
    chrome.tabs.query({ url: ['*://twitter.com/*', '*://x.com/*'] }, (tabs) => {
      for (const tab of tabs) {
        if (tab.id) {
          chrome.tabs.sendMessage(tab.id, message).catch(() => {});
        }
      }
    });
    return false;
  }

  if (isChrome && message.type === 'WS_MESSAGE') {
    // Send to active X tab first, otherwise first X tab.
    // task_sync handling dropped — scheduling lives in bnbot CLI calendar.
    sendToOneXTab(message);
    return false;
  }

  // Handle WS commands from content scripts
  if (message.type === 'WS_CONNECT') {
    const { userId, accessToken } = message;

    if (isFirefox && firefoxWsManager) {
      // Firefox: connect directly in background
      console.log('[Background] WS_CONNECT received (Firefox direct mode)');
      firefoxWsManager.connect(userId, accessToken)
        .then((result) => sendResponse(result))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;
    }

    // Chrome: use offscreen document
    console.log('[Background] WS_CONNECT received, ensuring offscreen document...');

    const tryConnect = async (attempt: number): Promise<any> => {
      try {
        await ensureOffscreenDocument();
        console.log('[Background] Offscreen document ready, attempt:', attempt);
        // 显示连接的 WebSocket 地址
        const _apiBase = process.env.API_BASE_URL || 'http://localhost:8000';
        const _wsBase = process.env.WS_BASE_URL || '';
        const WS_URL = _wsBase || (_apiBase.includes('localhost')
          ? 'ws://localhost:8001'
          : _apiBase.replace('http://', 'ws://').replace('https://', 'wss://'));
        console.log('[Background] WebSocket connecting to:', WS_URL);
        // Wait for offscreen document to initialize its message listener
        await new Promise(resolve => setTimeout(resolve, 1000 + attempt * 500));
        console.log('[Background] Sending OFFSCREEN_WS_CONNECT...');
        return await chrome.runtime.sendMessage({
          type: 'OFFSCREEN_WS_CONNECT',
          userId,
          accessToken
        });
      } catch (err: any) {
        if (attempt < 3 && err?.message?.includes('Receiving end does not exist')) {
          console.log('[Background] Retrying connection, attempt:', attempt + 1);
          return tryConnect(attempt + 1);
        }
        throw err;
      }
    };

    tryConnect(1)
      .then((result) => {
        console.log('[Background] OFFSCREEN_WS_CONNECT result:', result);
        sendResponse(result);
      })
      .catch((err) => {
        console.error('[Background] OFFSCREEN_WS_CONNECT error:', err);
        sendResponse({ success: false, error: err.message });
      });
    return true;
  }

  if (message.type === 'WS_DISCONNECT') {
    if (isFirefox && firefoxWsManager) {
      firefoxWsManager.disconnect();
      sendResponse({ success: true });
      return true;
    }
    chrome.runtime.sendMessage({ type: 'OFFSCREEN_WS_DISCONNECT' })
      .then(() => sendResponse({ success: true }))
      .catch(() => sendResponse({ success: true }));
    return true;
  }

  if (message.type === 'WS_SEND') {
    if (isFirefox && firefoxWsManager) {
      const success = firefoxWsManager.send(message.message);
      sendResponse({ success });
      return true;
    }
    chrome.runtime.sendMessage({ type: 'OFFSCREEN_WS_SEND', message: message.message })
      .then((result) => sendResponse(result))
      .catch(() => sendResponse({ success: false }));
    return true;
  }

  if (message.type === 'WS_STATUS') {
    if (isFirefox && firefoxWsManager) {
      sendResponse(firefoxWsManager.getStatus());
      return true;
    }
    chrome.runtime.sendMessage({ type: 'OFFSCREEN_WS_STATUS' })
      .then((result) => sendResponse(result))
      .catch(() => sendResponse({ connected: false, userId: null }));
    return true;
  }

  // Handle fresh token request from offscreen (for reconnection)
  if (message.type === 'REQUEST_FRESH_TOKEN') {
    handleFreshTokenRequest()
      .then((accessToken) => sendResponse({ accessToken }))
      .catch(() => sendResponse({ accessToken: null }));
    return true;
  }
});

// Listen for messages from content script
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  // GOOGLE_LOGIN handler removed — login flow lives in CLI (`bnbot login`),
  // tokens arrive via the `inject_auth_tokens` WS action.

  if (request.type === 'LOGOUT') {
    // Disconnect WebSocket on logout
    if (isFirefox && firefoxWsManager) {
      firefoxWsManager.disconnect();
    } else {
      chrome.runtime.sendMessage({ type: 'OFFSCREEN_WS_DISCONNECT' }).catch(() => {});
    }
    // Clear all task alarms on logout
    chrome.alarms.clearAll();
    handleLogout()
      .then(() => sendResponse({ success: true }))
      .catch((error) => sendResponse({ error: error.message }));
    return true;
  }

  // SCHEDULED_TASK_RESULT / TASK_ALARM_SYNC / TASK_ALARM_REMOVE / DRAFT_PUBLISH_RESULT
  // handlers removed — bnbot CLI calendar owns scheduling now.

  // DRAFT_ALARM_SYNC / DRAFT_ALARM_REMOVE removed — draft scheduling moves
  // out next; calendar lives in bnbot CLI now.

  // Check for extension updates
  if (request.type === 'CHECK_FOR_UPDATES') {
    chrome.runtime.requestUpdateCheck().then(([status, details]: [string, any]) => {
      if (status === 'update_available') {
        sendResponse({ updateAvailable: true, version: details?.version || 'new' });
      } else {
        sendResponse({ updateAvailable: false });
      }
    }).catch(() => {
      sendResponse({ updateAvailable: false });
    });
    return true;
  }

  // API proxy - forward requests from content script to API with cookies
  if (request.type === 'API_REQUEST') {
    handleApiRequest(request.url, request.options)
      .then(sendResponse)
      .catch((error) => sendResponse({ error: error.message }));
    return true;
  }

  // 微信公众号文章抓取
  if (request.type === 'WECHAT_SCRAPE') {
    scrapeWechatUrl(request.url)
      .then(sendResponse)
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  // Twitter 视频下载
  if (request.type === 'DOWNLOAD_VIDEO') {
    const filename = request.filename || 'twitter-video.mp4';
    chrome.downloads.download({
      url: request.url,
      filename,
    }, (downloadId: number) => {
      if (chrome.runtime.lastError) {
        console.error('[BNBot Background] Download failed:', chrome.runtime.lastError.message);
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
      } else {
        console.log('[BNBot Background] Download started, id:', downloadId);
        sendResponse({ success: true, downloadId });
      }
    });
    return true;
  }

  // TIKTOK_FETCH / TIKTOK_FETCH_V2 handlers removed — abandoned republish
  // flow. CLI's `bnbot tiktok search` uses the read-only scraper pool.

  // XIAOHONGSHU_SCRAPE removed — same orphan path as TikTok above.

  // Fetch blob from URL and return as base64 data URL (to bypass CORS)
  if (request.type === 'FETCH_BLOB') {
    fetchBlobAsDataUrl(request.url)
      .then(sendResponse)
      .catch((error) => sendResponse({ error: error.message }));
    return true;
  }

  // Video proxy - fetch video and return as base64 data URL
  if (request.type === 'FETCH_VIDEO') {
    fetchVideoAsDataUrl(request.url)
      .then(sendResponse)
      .catch((error) => sendResponse({ error: error.message }));
    return true;
  }

  // Fetch image from URL and return as base64 (for article image uploads)
  if (request.type === 'FETCH_IMAGE') {
    fetchImageAsBase64(request.url)
      .then(sendResponse)
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }
});

// handleGoogleLogin removed — login flow lives in CLI (`bnbot login`).
// CLI authenticates against bnbot.ai (clawmoney key or email OTP) and
// pushes resulting tokens via inject_auth_tokens action.

async function handleLogout() {
  await chrome.storage.local.remove(['bnbot_user']);
  // chrome.identity.clearAllCachedAuthTokens removed — extension no longer
  // touches Google identity (CLI owns login). `identity` permission can be
  // dropped from manifest now.
}

// Handle API requests from content script
// Background script can make cross-origin requests with cookies
async function handleApiRequest(
  url: string,
  options: { method?: string; headers?: Record<string, string>; body?: string; formData?: Array<{ key: string; value: string; filename?: string; type?: string; base64?: string }> }
): Promise<{ status: number; data: unknown; error?: string }> {
  try {
    console.log('[BNBot Background] API request:', options.method || 'GET', url);

    let requestBody: BodyInit | undefined = options.body;
    let requestHeaders: Record<string, string> = { ...options.headers };

    // Check if this is a FormData request
    if (options.formData && Array.isArray(options.formData)) {
      const formData = new FormData();
      for (const entry of options.formData) {
        if (entry.base64 && entry.type) {
          // Convert base64 back to Blob for file entries
          const byteString = atob(entry.base64);
          const ab = new ArrayBuffer(byteString.length);
          const ia = new Uint8Array(ab);
          for (let i = 0; i < byteString.length; i++) {
            ia[i] = byteString.charCodeAt(i);
          }
          const blob = new Blob([ab], { type: entry.type });
          formData.append(entry.key, blob, entry.filename || 'file');
        } else {
          formData.append(entry.key, entry.value);
        }
      }
      requestBody = formData;
      // Don't set Content-Type for FormData - browser will set it with boundary
    } else if (requestBody) {
      // Only set Content-Type for non-FormData requests
      requestHeaders['Content-Type'] = 'application/json';
    }

    const response = await fetch(url, {
      method: options.method || 'GET',
      headers: requestHeaders,
      body: requestBody,
    });

    console.log('[BNBot Background] API response status:', response.status);

    // Parse response based on content type
    let data: unknown = null;
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      try {
        data = await response.json();
      } catch {
        data = null;
      }
    } else {
      // Return text for HTML and other text-based responses
      try {
        data = await response.text();
      } catch {
        data = null;
      }
    }

    return {
      status: response.status,
      data,
    };
  } catch (error) {
    console.error('[BNBot Background] API request error:', error);
    return {
      status: 0,
      data: null,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// Handle port-based streaming connections for SSE
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'STREAM_API') return;

  console.log('[BNBot Background] Stream connection opened');

  let aborted = false;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

  port.onDisconnect.addListener(() => {
    console.log('[BNBot Background] Stream connection closed');
    aborted = true;
    if (reader) {
      reader.cancel().catch(() => { });
    }
  });

  port.onMessage.addListener(async (msg) => {
    if (msg.type !== 'START_STREAM') return;

    const { url, options } = msg;
    console.log('[BNBot Background] Starting stream:', options?.method || 'POST', url);

    try {
      const response = await fetch(url, {
        method: options?.method || 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...options?.headers,
        },
        body: options?.body,
      });

      console.log('[BNBot Background] Stream response status:', response.status);

      // Send initial status
      port.postMessage({
        type: 'STREAM_STATUS',
        status: response.status,
        ok: response.ok,
      });

      if (!response.ok || !response.body) {
        // Try to get error body
        let errorData = null;
        try {
          errorData = await response.json();
        } catch { }
        port.postMessage({
          type: 'STREAM_ERROR',
          status: response.status,
          error: errorData?.detail || errorData?.message || `HTTP ${response.status}`,
        });
        return;
      }

      // Stream the response
      reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (!aborted) {
        const { done, value } = await reader.read();

        if (done) {
          port.postMessage({ type: 'STREAM_END' });
          break;
        }

        const chunk = decoder.decode(value, { stream: true });
        port.postMessage({ type: 'STREAM_CHUNK', chunk });
      }
    } catch (error) {
      console.error('[BNBot Background] Stream error:', error);
      if (!aborted) {
        port.postMessage({
          type: 'STREAM_ERROR',
          status: 0,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  });
});

// Handle port-based download with progress
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'DOWNLOAD_PORT') return;

  console.log('[BNBot Background] Download port opened');

  port.onDisconnect.addListener(() => {
    console.log('[BNBot Background] Download port closed');
  });

  port.onMessage.addListener(async (msg) => {
    if (msg.type === 'PING') return; // Keep-alive
    if (msg.type !== 'START_DOWNLOAD') return;

    const { url } = msg;
    console.log('[BNBot Background] Starting download:', url);

    try {
      const fetchHeaders: Record<string, string> = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      };
      // Add Referer for Xiaohongshu CDN
      if (url.includes('xhscdn') || url.includes('xiaohongshu')) {
        fetchHeaders['Referer'] = 'https://www.xiaohongshu.com/';
      }

      const response = await fetch(url, {
        referrerPolicy: 'no-referrer',
        headers: fetchHeaders,
      });

      if (!response.ok) {
        port.postMessage({ type: 'DOWNLOAD_ERROR', error: `HTTP ${response.status}` });
        return;
      }

      const contentLength = response.headers.get('content-length');
      const total = contentLength ? parseInt(contentLength, 10) : 0;
      const contentType = response.headers.get('content-type') || '';

      port.postMessage({
        type: 'DOWNLOAD_START',
        total,
        contentType,
      });

      if (!response.body) {
        port.postMessage({ type: 'DOWNLOAD_ERROR', error: 'No response body' });
        return;
      }

      const reader = response.body.getReader();

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        // Send chunk as array (ports handle structured clone)
        // Convert Uint8Array to regular array to avoid serialization issues effectively? 
        // Chrome ports verify efficiency with AraryBuffers. Value is Uint8Array.
        // We can send it directly.
        port.postMessage({ type: 'DOWNLOAD_CHUNK', chunk: Array.from(value) });
      }

      port.postMessage({ type: 'DOWNLOAD_END' });

    } catch (error) {
      console.error('[BNBot Background] Download error:', error);
      port.postMessage({
        type: 'DOWNLOAD_ERROR',
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });
});

console.log('BNBot background service worker loaded');

// ============ Scraper Service (browser-based only, PUBLIC APIs go through CLI/backend) ============
const scraperHandlers: Record<string, (msg: any) => Promise<any>> = {
  SCRAPER_SEARCH_TIKTOK: (m) => searchTikTok(m.query, m.limit),
  SCRAPER_SEARCH_YOUTUBE: (m) => searchYouTube(m.query, { limit: m.limit, type: m.type, upload: m.upload, sort: m.sort }),
  SCRAPER_SEARCH_REDDIT: (m) => searchReddit(m.query, m.limit),
  SCRAPER_SEARCH_BILIBILI: (m) => searchBilibili(m.query, m.limit),
  SCRAPER_SEARCH_ZHIHU: (m) => searchZhihu(m.query, m.limit),
  SCRAPER_SEARCH_XUEQIU: (m) => searchXueqiu(m.query, m.limit),
  SCRAPER_SEARCH_INSTAGRAM: (m) => searchInstagram(m.query, m.limit),
  SCRAPER_SEARCH_LINUX_DO: (m) => searchLinuxDo(m.query, m.limit),
  SCRAPER_SEARCH_JIKE: (m) => searchJike(m.query, m.limit),
  SCRAPER_SEARCH_XIAOHONGSHU: (m) => searchXiaohongshu(m.query, m.limit),
  SCRAPER_SEARCH_WEIBO: (m) => searchWeibo(m.query, m.limit),
  SCRAPER_SEARCH_DOUBAN: (m) => searchDouban(m.query, m.limit),
  SCRAPER_SEARCH_MEDIUM: (m) => searchMedium(m.query, m.limit),
  SCRAPER_SEARCH_GOOGLE: (m) => searchGoogle(m.query, { limit: m.limit, lang: m.lang }),
  SCRAPER_SEARCH_FACEBOOK: (m) => searchFacebook(m.query, m.limit),
  SCRAPER_SEARCH_LINKEDIN: (m) => searchLinkedInJobs(m.query, m),
  SCRAPER_SEARCH_36KR: (m) => search36Kr(m.query, m.limit),
  SCRAPER_FETCH_PRODUCTHUNT: (m) => fetchProductHuntHot(m.limit),
  SCRAPER_FETCH_WEIXIN: (m) => fetchWeixinArticle(m.url),
  SCRAPER_FETCH_YAHOO_FINANCE: (m) => fetchYahooFinanceQuote(m.symbol),
  SCRAPER_FETCH_REDDIT_HOT: (m) => fetchRedditHot(m.limit),
  SCRAPER_FETCH_BILIBILI_HOT: (m) => fetchBilibiliHot(m.limit),
  SCRAPER_FETCH_BILIBILI_RANKING: (m) => fetchBilibiliRanking(m.limit),
  SCRAPER_FETCH_TIKTOK_EXPLORE: (m) => fetchTikTokExplore(m.limit),
  SCRAPER_FETCH_ZHIHU_HOT: (m) => fetchZhihuHot(m.limit),
  SCRAPER_FETCH_XUEQIU_HOT: (m) => fetchXueqiuHot(m.limit),
  SCRAPER_FETCH_WEIBO_HOT: (m) => fetchWeiboHot(m.limit),
  SCRAPER_FETCH_DOUBAN_MOVIE_HOT: (m) => fetchDoubanMovieHot(m.limit),
  SCRAPER_FETCH_DOUBAN_BOOK_HOT: (m) => fetchDoubanBookHot(m.limit),
  SCRAPER_FETCH_DOUBAN_TOP250: (m) => fetchDoubanTop250(m.limit),
  SCRAPER_FETCH_36KR_HOT: (m) => fetch36KrHot(m.limit, m),
  SCRAPER_FETCH_36KR_NEWS: (m) => fetch36KrNews(m.limit),
  SCRAPER_SEARCH_GOOGLE_NEWS: (m) => searchGoogleNews(m.query, m.limit),
  SCRAPER_FETCH_INSTAGRAM_EXPLORE: (m) => fetchInstagramExplore(m.limit),
  YOUTUBE_LIKE: (m) => likeYoutubeVideo(m.videoId),
  YOUTUBE_UNLIKE: (m) => unlikeYoutubeVideo(m.videoId),
  YOUTUBE_SUBSCRIBE: (m) => subscribeYoutubeChannel(m.channelId),
  YOUTUBE_UNSUBSCRIBE: (m) => unsubscribeYoutubeChannel(m.channelId),
  YOUTUBE_FEED: (m) => getYoutubeFeed(m.limit),
  YOUTUBE_HISTORY: (m) => getYoutubeHistory(m.limit),
  YOUTUBE_WATCH_LATER: (m) => getYoutubeWatchLater(m.limit),
  YOUTUBE_SUBSCRIPTIONS: (m) => getYoutubeSubscriptions(m.limit),
  TIKTOK_PROFILE: (m) => getTikTokProfile(m.username),
  TIKTOK_LIKE: (m) => likeTikTok(m.url),
  REDDIT_UPVOTE: (m) => redditUpvote(m.postId, m.direction),
  REDDIT_SAVE: (m) => redditSave(m.postId, m.undo),
  REDDIT_FRONTPAGE: (m) => getRedditFrontpage(m.limit),
  REDDIT_POST: (m) => getRedditPost(m.postId, m.limit, m.sort),
  REDDIT_USER: (m) => getRedditUser(m.username),
  REDDIT_SUBSCRIBE: (m) => redditSubscribe(m.subreddit, m.undo),
  BILIBILI_DYNAMIC: (m) => getBilibiliDynamic(m.limit),
  BILIBILI_HISTORY: (m) => getBilibiliHistory(m.limit),
  BILIBILI_FOLLOWING: (m) => getBilibiliFollowing(m.limit),
  BILIBILI_USER_VIDEOS: (m) => getBilibiliUserVideos(m.mid, m.limit),
  BILIBILI_COMMENTS: (m) => getBilibiliComments(m.bvid, m.limit),
  ZHIHU_LIKE: (m) => likeZhihu(m.url),
  ZHIHU_QUESTION: (m) => getZhihuQuestion(m.questionId, m.limit),
  TWITTER_TIMELINE: (m) => getTwitterTimeline(m.type, m.limit),
  TWITTER_SEARCH: (m) => searchTwitter(m.query, m.filter, m.limit),
  TWITTER_TRENDING: (m) => getTwitterTrending(m.limit),
  TWITTER_PROFILE: (m) => getTwitterProfile(m.username),
  TWITTER_BOOKMARKS: (m) => getTwitterBookmarks(m.limit),
  TWITTER_USER_TWEETS: (m) => getTwitterUserTweets(m.username, m.limit),
  TWITTER_THREAD: (m) => getTwitterThread(m.tweetId, m.limit),
  // CLI compat aliases — old scrape_* actions now routed to background GraphQL scrapers
  scrape_timeline: (m) => getTwitterTimeline(m.type || 'for-you', m.limit),
  scrape_bookmarks: (m) => getTwitterBookmarks(m.limit),
  scrape_search_results: (m) => searchTwitter(m.query, m.filter, m.limit),
  scrape_user_tweets: (m) => getTwitterUserTweets(m.username, m.limit),
  scrape_user_profile: (m) => getTwitterProfile(m.username),
  scrape_thread: (m) => getTwitterThread(m.tweetUrl || m.tweetId, m.limit),
  scrape_notifications: (m) => getTwitterNotifications(m.limit || 40),
  screenshot: (m) => captureTabScreenshot({ url: m.url, tabId: m.tabId, fullPage: m.fullPage }),
  navigate_to_url: (m) => navigateTabViaCdp({ url: m.url, tabId: m.tabId }),
  debug_eval: (m) => debugEvalInTab({
    expression: m.expression,
    tabId: m.tabId,
    targetHost: m.targetHost,
    awaitPromise: m.awaitPromise,
  }),
  debug_set_files: (m) => debugSetFileInputFiles({
    selector: m.selector,
    files: m.files,
    tabId: m.tabId,
    targetHost: m.targetHost,
  }),
  debug_click: (m) => debugTrustedClick({
    selector: m.selector,
    tabId: m.tabId,
    targetHost: m.targetHost,
  }),
  debug_show_window: (m) => debugShowPoolWindow({
    tabId: m.tabId,
    targetHost: m.targetHost,
  }),
  debug_record_start: (m) => debugRecordStart({
    tabId: m.tabId,
    targetHost: m.targetHost,
    filterPattern: m.filterPattern,
  }),
  debug_record_dump: (m) => debugRecordDump({
    tabId: m.tabId,
    targetHost: m.targetHost,
    clear: m.clear,
  }),
  debug_record_stop: (m) => debugRecordStop({
    tabId: m.tabId,
    targetHost: m.targetHost,
  }),
  debug_drag: (m) => debugDrag({
    fromSelector: m.fromSelector,
    toSelector: m.toSelector,
    steps: m.steps,
    tabId: m.tabId,
    targetHost: m.targetHost,
  }),
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const handler = scraperHandlers[message.type];
  if (handler) {
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Scraper timed out after 30s')), 30000));
    Promise.race([handler(message), timeout])
      .then((data) => { startAllIdleTimers(); sendResponse(data); })
      .catch((err) => { startAllIdleTimers(); sendResponse({ error: err.message }); });
    return true;
  }
});

// Expose for service worker console testing
Object.assign(self, {
  searchTikTok, searchYouTube, fetchTikTokExplore,
  searchReddit, fetchRedditHot,
  searchBilibili, fetchBilibiliHot, fetchBilibiliRanking,
  searchZhihu, fetchZhihuHot,
  searchXueqiu, fetchXueqiuHot,
  searchInstagram, fetchInstagramExplore,
  searchLinuxDo, searchJike, searchXiaohongshu,
  searchWeibo, fetchWeiboHot,
  searchDouban, fetchDoubanMovieHot, fetchDoubanBookHot, fetchDoubanTop250,
  searchMedium,
  searchGoogle, searchGoogleNews,
  searchFacebook, searchLinkedInJobs,
  search36Kr, fetch36KrHot, fetch36KrNews,
  fetchProductHuntHot, fetchWeixinArticle, fetchYahooFinanceQuote,
});

// Handle fresh token request for WebSocket reconnection
async function handleFreshTokenRequest(): Promise<string | null> {
  try {
    // Get current access token
    const result = await chrome.storage.local.get(['accessToken.bnbot', 'refreshToken.bnbot']);
    const accessToken = result['accessToken.bnbot'] as string | undefined;
    const refreshToken = result['refreshToken.bnbot'] as string | undefined;

    if (!accessToken) {
      console.log('[Background] No access token available');
      return null;
    }

    // Validate token by making a simple API call
    const validateResponse = await fetch(`${API_BASE_URL}/api/v1/payments/credits`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    if (validateResponse.ok) {
      console.log('[Background] Current access token is valid');
      return accessToken;
    }

    // Token expired, try to refresh
    if (validateResponse.status === 401 && refreshToken) {
      console.log('[Background] Access token expired, refreshing...');

      const refreshResponse = await fetch(`${API_BASE_URL}/api/v1/refresh`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${refreshToken}` }
      });

      if (refreshResponse.ok) {
        const data = await refreshResponse.json();
        if (data.access_token) {
          // Save new tokens
          await chrome.storage.local.set({
            'accessToken.bnbot': data.access_token,
            'refreshToken.bnbot': data.refresh_token || refreshToken
          });
          console.log('[Background] Token refreshed successfully');

          // Also update WS manager with new token
          if (isFirefox && firefoxWsManager) {
            firefoxWsManager.updateToken(data.access_token);
          } else {
            chrome.runtime.sendMessage({
              type: 'OFFSCREEN_WS_UPDATE_TOKEN',
              accessToken: data.access_token
            }).catch(() => {});
          }

          return data.access_token;
        }
      }

      console.log('[Background] Token refresh failed');
    }

    return null;
  } catch (error) {
    console.error('[Background] Error getting fresh token:', error);
    return null;
  }
}

// Fetch video from URL and return as blob URL
async function fetchVideoAsDataUrl(url: string): Promise<{ blobUrl?: string; error?: string }> {
  try {
    console.log('[BNBot Background] Fetching video:', url.substring(0, 100) + '...');

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
    });

    if (!response.ok) {
      return { error: `HTTP ${response.status}` };
    }

    const blob = await response.blob();

    // Convert blob to base64 data URL
    const reader = new FileReader();
    const dataUrl = await new Promise<string>((resolve, reject) => {
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });

    console.log('[BNBot Background] Video fetched, size:', blob.size);
    return { blobUrl: dataUrl };
  } catch (error) {
    console.error('[BNBot Background] Video fetch error:', error);
    return { error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

// Fetch image from URL and return as base64 (for article image uploads)
async function fetchImageAsBase64(url: string): Promise<{ success: boolean; data?: string; mimeType?: string; error?: string }> {
  try {
    console.log('[BNBot Background] Fetching image:', url.substring(0, 100) + '...');

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
        'Referer': 'https://mp.weixin.qq.com/',
      },
    });

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` };
    }

    const blob = await response.blob();
    const mimeType = blob.type || 'image/jpeg';

    // Convert blob to base64 (without data URL prefix)
    const reader = new FileReader();
    const base64 = await new Promise<string>((resolve, reject) => {
      reader.onloadend = () => {
        const dataUrl = reader.result as string;
        // Remove the data URL prefix to get just base64
        const base64Data = dataUrl.split(',')[1];
        resolve(base64Data);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });

    console.log('[BNBot Background] Image fetched, size:', blob.size, 'type:', mimeType);
    return { success: true, data: base64, mimeType };
  } catch (error) {
    console.error('[BNBot Background] Image fetch error:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

// Fetch blob from URL and return as blob URL
async function fetchBlobAsDataUrl(url: string): Promise<{ success: boolean; data?: string; error?: string }> {
  try {
    console.log('[BNBot Background] Fetching blob:', url.substring(0, 100) + '...');

    // Build fetch options with appropriate headers for different CDNs
    const fetchOptions: RequestInit = { method: 'GET' };
    const isXhs = url.includes('xhscdn') || url.includes('xiaohongshu');
    if (isXhs) {
      fetchOptions.headers = {
        'Referer': 'https://www.xiaohongshu.com/',
      };
    }

    const response = await fetch(url, fetchOptions);

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` };
    }

    const blob = await response.blob();

    // Convert blob to base64 data URL
    const reader = new FileReader();
    const dataUrl = await new Promise<string>((resolve, reject) => {
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });

    console.log('[BNBot Background] Blob fetched, size:', blob.size);
    return { success: true, data: dataUrl };
  } catch (error) {
    console.error('[BNBot Background] Blob fetch error:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}


// 抓取微信公众号文章 HTML
async function scrapeWechatUrl(url: string): Promise<{ success: boolean; data?: string; error?: string }> {
  try {
    console.log('[BNBot Background] 抓取微信文章:', url);

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
    });

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` };
    }

    const html = await response.text();
    console.log('[BNBot Background] 微信文章抓取成功, 长度:', html.length);

    return { success: true, data: html };
  } catch (error) {
    console.error('[BNBot Background] 微信文章抓取失败:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}


