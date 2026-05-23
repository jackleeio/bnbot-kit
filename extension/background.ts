// Background Service Worker (Chrome/Edge) / Event Page (Firefox)
// Handles Google OAuth via popup window, API proxy, and WebSocket

import { isFirefox, isChrome } from './utils/browserCompat';
// WebSocketManager import removed — the wss://api.bnbot.ai push channel
// (and its Firefox direct-background variant) was retired in v0.12.6.
import { localRelayManager, LocalActionRequest } from './utils/localRelayManager';
// taskAlarmScheduler + draftService removed — scheduling moved to the
// bnbot main repo's auto-publish loop (see bnbot/src/services/autoPublish/),
// and the server-side draft product line was retired.
import { searchTikTok, searchYouTube, fetchTikTokExplore, startAllIdleTimers, IDLE_BONUS_EXPLORE, likeYoutubeVideo, unlikeYoutubeVideo, subscribeYoutubeChannel, unsubscribeYoutubeChannel, getYoutubeFeed, getYoutubeHistory, getYoutubeWatchLater, getYoutubeSubscriptions, getTikTokProfile, likeTikTok, ensureDebuggerAttached, debuggerSend, getPoolTabs, openTabInScraperWindow, getTab } from './services/scraperService';
import { debuggerWriteHandlers } from './services/debugger';
import { setFileInputFilesViaChooser, setFilesViaBlob, registerEventListener } from './services/debugger/debuggerOps';

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
  // Auto-accept any beforeunload "Leave site?" Chrome dialog the page
  // might pop. Without this, navigate_to_url hangs for 60s and times
  // out whenever the source page has unsaved-changes guards (Douyin's
  // editor, microWeChat's article composer, etc.). One-shot listener
  // — dispose right after to keep the dialog interception scoped.
  const dialogUnregister = registerEventListener(targetId, (method, params) => {
    if (method !== 'Page.javaScriptDialogOpening') return;
    const p = params as { type?: string };
    debuggerSend(targetId, 'Page.handleJavaScriptDialog', {
      accept: p.type === 'beforeunload' ? true : true,
    }).catch(() => null);
  });
  setTimeout(() => dialogUnregister(), 5_000);
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
 * Attach files via the OS file-chooser dialog interception path.
 *
 * Use this when `debug_set_files` doesn't trigger the page's upload
 * flow — e.g. Kuaishou / Douyin / 微信视频号 wrap the <input type=file>
 * behind a wrapper button and only react to fresh File objects from the
 * native dialog event, not direct mutations of `input.files`.
 *
 * Mechanics: enable Page.setInterceptFileChooserDialog, click the
 * trigger button (a wrapper, not the hidden input), capture the
 * Page.fileChooserOpened event, and feed it the file paths via
 * setFileInputFiles({backendNodeId}).
 *
 * `selector` here is the WRAPPER element the user would click (e.g.
 * `.upload-btn`), NOT the hidden input.
 */
async function debugSetFileInputFilesViaChooser(args: {
  selector: string;
  files: string[];
  tabId?: number;
  targetHost?: string;
  timeoutMs?: number;
}): Promise<{ tabId: number; url: string; via: 'chooser'; files: string[] }> {
  if (!args.selector) throw new Error('debug_set_files_via_chooser: missing selector');
  if (!args.files || args.files.length === 0) throw new Error('debug_set_files_via_chooser: missing files');

  let tabId = args.tabId;
  if (!tabId) {
    const pool = getPoolTabs();
    if (pool.length === 0) throw new Error('debug_set_files_via_chooser: no pool tabs');
    const hostMatch = args.targetHost ? pool.find((p) => p.host === args.targetHost) : null;
    tabId = (hostMatch ?? pool[0]).tabId;
  }

  const targetId = await ensureDebuggerAttached(tabId, ['Page', 'DOM', 'Input']);
  const debug = await setFileInputFilesViaChooser(targetId, args.selector, args.files, args.timeoutMs ?? 10_000);

  const tab = await chrome.tabs.get(tabId);
  return { tabId, url: tab.url || '', via: 'chooser', files: args.files, ...debug };
}

/** Inject a file via base64 → page-side File reconstruction. See
 *  setFilesViaBlob in debuggerOps for rationale.
 *
 *  args:
 *    selector — the file input element CSS selector (NOT the wrapper button).
 *    fileName — display name for the File.
 *    mimeType — mime; e.g. 'video/mp4'.
 *    base64   — base64-encoded file body (CLI reads the file and encodes).
 */
async function debugSetFilesViaBlob(args: {
  selector: string;
  fileName: string;
  mimeType: string;
  base64: string;
  tabId?: number;
  targetHost?: string;
}): Promise<{ tabId: number; url: string; via: 'blob'; filesAfter: number }> {
  if (!args.selector) throw new Error('debug_set_files_via_blob: missing selector');
  if (!args.base64) throw new Error('debug_set_files_via_blob: missing base64');
  if (!args.fileName) throw new Error('debug_set_files_via_blob: missing fileName');

  let tabId = args.tabId;
  if (!tabId) {
    const pool = getPoolTabs();
    if (pool.length === 0) throw new Error('debug_set_files_via_blob: no pool tabs');
    const hostMatch = args.targetHost ? pool.find((p) => p.host === args.targetHost) : null;
    tabId = (hostMatch ?? pool[0]).tabId;
  }
  const targetId = await ensureDebuggerAttached(tabId, ['Page', 'DOM']);
  const result = await setFilesViaBlob(
    targetId,
    args.selector,
    args.fileName,
    args.mimeType || 'application/octet-stream',
    args.base64,
  );
  const tab = await chrome.tabs.get(tabId);
  return { tabId, url: tab.url || '', via: 'blob', filesAfter: result.filesAfter };
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
import { searchReddit, fetchRedditHot, redditUpvote, redditSave, getRedditFrontpage, getRedditPost, getRedditUser, redditSubscribe, getRedditPopularPosts, getRedditTopPopularPosts, getRedditRisingPopularPosts, getRedditBestPopularPosts, getRedditPopularPostsByCountry, getRedditPostsBySubreddit, getRedditTopPostsBySubreddit, getRedditControversialPostsBySubreddit, getRedditCommentsBySubreddit, getRedditSubredditInfo, getRedditSubredditRules, getRedditSimilarSubreddits, getRedditNewSubreddits, getRedditPopularSubreddits, getRedditPostsByUsername, getRedditTopPostsByUsername, getRedditCommentsByUsername, getRedditTopCommentsByUsername, getRedditUserOverview, getRedditUserPostRankInSubreddit, getRedditProfile, getRedditUserStats, searchRedditUsers, searchRedditPosts, searchRedditSubreddits, getRedditPostDetails, getRedditPostComments, getRedditPostCommentsWithSort, getRedditPostDuplicates, searchBilibili, fetchBilibiliHot, fetchBilibiliRanking, getBilibiliDynamic, getBilibiliHistory, getBilibiliFollowing, getBilibiliUserVideos, getBilibiliComments, searchZhihu, fetchZhihuHot, likeZhihu, getZhihuQuestion, searchXueqiu, fetchXueqiuHot, searchInstagram, fetchInstagramExplore, searchLinuxDo, searchJike, searchXiaohongshu, xhsGetCreatorHotInspirationFeed, xhsGetProductRecommendations, xhsGetTopicInfo, xhsGetNoteComments, xhsSearchGroups, xhsGetProductReviews, xhsGetTopicFeed, xhsGetMixedNoteDetail, xhsSearchNotes, xhsGetProductDetail, xhsGetProductReviewOverview, xhsGetCreatorInspirationFeed, xhsGetImageNoteDetail, xhsSearchUsers, xhsSearchImages, xhsSearchProducts, xhsGetUserFavedNotes, searchWeibo, fetchWeiboHot, searchDouban, fetchDoubanMovieHot, fetchDoubanBookHot, fetchDoubanTop250, searchMedium, searchGoogle, searchGoogleNews, searchFacebook, searchLinkedInJobs, search36Kr, fetch36KrHot, fetch36KrNews, fetchProductHuntHot, fetchWeixinArticle, fetchYahooFinanceQuote, getTwitterTimeline, searchTwitter, getTwitterTrending, getTwitterProfile, getTwitterBookmarks, getTwitterUserTweets, getTwitterThread, getTwitterNotifications, getYouTubeVideoDetails, getYouTubeChannelDetails, getYouTubeChannelVideos, getYouTubeTrending, searchYouTubeChannel, getYouTubeStreamingData, getYouTubeRelatedVideos, getYouTubeComments, getYouTubeTranscript, getTikTokUserPosts, getTikTokUserFollowers, getTikTokPostDetail, getTikTokPostComments, searchTikTokAccount, getTikTokChallengeInfo, getTikTokChallengePosts, getTikTokMusicInfo, getTikTokMusicPosts, getTikTokMusicUnlimitedSounds, getTikTokUserInfoWithRegion, getTikTokUserInfoById, getTikTokUserFollowings, getTikTokUserLikedPosts, getTikTokUserPlaylist, getTikTokUserRepost, getTikTokUserStory, searchTikTokGeneral, searchTikTokLive, getTikTokOthersSearchedFor, getTikTokPostRelated, getTikTokPostExplore, getTikTokPostDiscover, getTikTokAdsDetail, getTikTokAdsTop, getTikTokTrendingCreator, getTikTokTrendingVideo, getTikTokTrendingHashtag, getTikTokTrendingSong, getTikTokTrendingKeyword, getTikTokTrendingKeywordPosts, getTikTokTrendingKeywordSentence, getTikTokCommercialMusicLibrary, getTikTokCommercialMusicPlaylists, getTikTokCommercialMusicPlaylistDetail, getTikTokTopProducts, getTikTokTopProductDetail, getTikTokTopProductMetrics, getTikTokPlaceInfo, getTikTokPlacePosts, getTikTokEffectInfo, getTikTokEffectPosts, getTikTokCollectionInfo, getTikTokCollectionPosts, getTikTokPostCommentReplies, getDouyinUserInfo, getDouyinUserPosts, getDouyinUserLikedPosts, getDouyinUserFollowers, getDouyinUserFollowing, getDouyinPostComments, searchDouyinGeneral, searchDouyinVideo, searchDouyinAccount, searchDouyinLive, getDouyinChallengePosts, getDouyinMusicPosts } from './services/scrapers/browser';

// GOOGLE_CLIENT_ID / OAUTH_REDIRECT_URI removed — see handleGoogleLogin
// removal note. chrome.identity.getRedirectURL() also no longer needed.
const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:8000';
const WS_BASE_URL = process.env.WS_BASE_URL || '';

// Legacy wss://api.bnbot.ai push channel removed. The extension used to
// hold a WebSocket to the backend to receive Telegram-driven action /
// chat / scheduled_trigger pushes. That entire upstream input (Telegram
// integration, ChatPanel, AnalysisPanel, scheduled task push) was
// retired in v0.12.0, and the desktop BNBot agent communicates with the
// extension over the local CLI bridge (ws://127.0.0.1:18900) instead.
// firefoxWsManager / offscreen WS manager / OFFSCREEN_WS_* messages all
// dropped along with the offscreen permission.

// ============ Local Relay (bnbot bridge — ws://localhost:18900) ============

// Initialize local relay manager for the bnbot daemon (`bnbot serve`).
localRelayManager.init({
  onAction: async (message: LocalActionRequest) => {
    console.log(`[Background] Local relay action: ${message.actionType} (${message.requestId}) payload:`, JSON.stringify(message.actionPayload));

    // Auth is no longer owned by the extension. Keep this action as a
    // backwards-compatible no-op so older CLI clients do not fail if they
    // still send it, but never persist API tokens in chrome.storage.
    if (message.actionType === 'inject_auth_tokens') {
      try {
        await clearExtensionAuthStorage();
        console.log('[Background] Ignored inject_auth_tokens; extension is auth-free');
        localRelayManager.sendActionResult({
          type: 'action_result',
          requestId: message.requestId,
          success: true,
          data: { message: 'Extension auth is disabled; token payload ignored' },
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
      const EXPLORE_ACTIONS = new Set(['debug_eval', 'debug_set_files', 'debug_set_files_via_chooser', 'debug_set_files_via_blob', 'debug_click', 'debug_show_window', 'debug_drag', 'debug_record_start', 'debug_record_dump', 'debug_record_stop', 'navigate_to_url', 'screenshot']);
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
    } else {
      setXTabsKeepAlive(false);
    }
  },
});

async function clearExtensionAuthStorage(): Promise<void> {
  await chrome.storage.local.remove([
    'accessToken.bnbot',
    'refreshToken.bnbot',
    'userData.bnbot',
    'bnbot_user',
  ]);
}

// Clean up tokens left by older releases. This is intentionally repeated on
// startup so upgrading users do not keep stale auth material in extension
// storage.
clearExtensionAuthStorage().catch((error) => {
  console.warn('[Background] Failed to clear legacy auth storage:', error);
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

  if (message.type === 'BNBOT_SOURCE_CAPTURE') {
    void (async () => {
      try {
        // The X share menu now injects two items (AI Quote / AI Remix);
        // the injector tags `intent` on the payload so we can forward it
        // as a top-level field. BNBot desktop branches on this to pick
        // /quote vs /x-tweet-remix. Default 'remix' keeps legacy callers
        // (e.g. an older injector still saying 发送到BNBot) working.
        const rawPayload = (message.payload || {}) as Record<string, unknown> & { intent?: string };
        const { intent: rawIntent, ...source } = rawPayload;
        const intent = rawIntent === 'quote' ? 'quote' : 'remix';
        const response = await fetch('http://127.0.0.1:27421/api/remix-jobs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source, intent }),
        });
        if (!response.ok) {
          const text = await response.text().catch(() => '');
          throw new Error(`BNBot desktop returned ${response.status}${text ? `: ${text.slice(0, 160)}` : ''}`);
        }
        sendResponse({ ok: true });
      } catch (error) {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : 'BNBot desktop is not connected',
        });
      }
    })();
    return true;
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
    if (localRelayManager.isConnected() && changeInfo.status === 'complete' && tab.url) {
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
    if (localRelayManager.isConnected() && isChrome) {
      chrome.tabs.update(newTab.id, { autoDiscardable: false }).catch(() => {});
    }

    return sent;
  } catch (err) {
    console.error('[Background] Failed to open X tab:', err);
    return false;
  }
}

// Offscreen document management + WS_CONNECT/DISCONNECT/SEND/STATUS +
// REQUEST_FRESH_TOKEN handlers removed. The whole block existed to
// host a wss://api.bnbot.ai push connection (so the backend could
// dispatch Telegram-driven actions, ChatPanel chats, scheduled
// triggers, etc. to the extension in real time). Those upstream
// inputs were retired in v0.12.0 and the desktop BNBot agent now
// drives the extension through the local CLI bridge
// (ws://127.0.0.1:18900) instead — removing the entire offscreen
// push channel + its `offscreen` permission from the manifest.

// Listen for messages from content script
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  // GOOGLE_LOGIN handler removed — the extension is auth-free.

  if (request.type === 'LOGOUT') {
    // (Offscreen WS disconnect dropped — no offscreen channel remains.)
    // (chrome.alarms.clearAll removed alongside the alarms permission —
    // v0.12.0 killed every alarm-driver, so there are no alarms to clear.)
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

  // Twitter 视频下载
  // DOWNLOAD_VIDEO handler removed — VideoDownloadManager (the tweet-
  // video share-menu injection that called this) was deleted in
  // v0.12.0 alongside the abandoned republish flow. The handler had
  // no remaining caller and chrome.downloads.download required a
  // permission that was never declared, so any invocation would have
  // thrown anyway.

  // TIKTOK_FETCH / TIKTOK_FETCH_V2 / XIAOHONGSHU_SCRAPE handlers removed —
  // abandoned republish flow.
  //
  // FETCH_BLOB / FETCH_VIDEO / FETCH_IMAGE handlers also removed: those
  // were the CORS-bypass proxies feeding the DOM-write path
  // (tweetPoster fallbacks). All writes now go through the CDP debugger
  // engine, which uses DOM.setFileInputFiles on local file paths
  // resolved CLI-side, so the extension never fetches third-party CDNs
  // any more. Removing these proxies + their host_permissions narrows
  // the User Data Privacy review surface.
});

// handleGoogleLogin removed — the extension is auth-free. `inject_auth_tokens`
// remains only as a backwards-compatible no-op for older local CLI clients.

async function handleLogout() {
  await clearExtensionAuthStorage();
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

// DOWNLOAD_PORT (chunked media download with progress) removed alongside
// FETCH_BLOB / FETCH_VIDEO / FETCH_IMAGE — the DOM-write path that drove
// these (commandService → tweetPoster fallback chain) is dead now that
// every desktop-app and CLI write goes through the CDP debugger engine,
// which sets media via DOM.setFileInputFiles on local file paths.

console.log('BNBot background service worker loaded');

// ============ Scraper Service (browser-based only, PUBLIC APIs go through CLI/backend) ============
const scraperHandlers: Record<string, (msg: any) => Promise<any>> = {
  SCRAPER_SEARCH_TIKTOK: (m) => searchTikTok(m.query, m.limit),
  SCRAPER_SEARCH_YOUTUBE: (m) => searchYouTube(m.query, { limit: m.limit, type: m.type, upload: m.upload, sort: m.sort }),
  SCRAPER_FETCH_YOUTUBE_VIDEO: (m) => getYouTubeVideoDetails(m.url || m.video || m.videoId),
  SCRAPER_FETCH_YOUTUBE_CHANNEL_DETAILS: (m) => getYouTubeChannelDetails(m.channel || m.channelId || m.handle),
  SCRAPER_FETCH_YOUTUBE_CHANNEL_VIDEOS: (m) => getYouTubeChannelVideos(m.channel || m.channelId || m.handle, { filter: m.filter, limit: m.limit }),
  SCRAPER_FETCH_YOUTUBE_TRENDING: (m) => getYouTubeTrending(m.limit),
  SCRAPER_SEARCH_YOUTUBE_CHANNEL: (m) => searchYouTubeChannel(m.channel || m.channelId || m.handle, m.query, m.limit),
  SCRAPER_FETCH_YOUTUBE_STREAMING_DATA: (m) => getYouTubeStreamingData(m.url || m.video || m.videoId),
  SCRAPER_FETCH_YOUTUBE_RELATED: (m) => getYouTubeRelatedVideos(m.url || m.video || m.videoId, m.limit),
  SCRAPER_FETCH_YOUTUBE_COMMENTS: (m) => getYouTubeComments(m.url || m.video || m.videoId, m.limit),
  SCRAPER_FETCH_YOUTUBE_TRANSCRIPT: (m) => getYouTubeTranscript(m.url || m.video || m.videoId, { lang: m.lang }),
  SCRAPER_SEARCH_REDDIT: (m) => searchReddit(m.query, m.limit),
  SCRAPER_SEARCH_BILIBILI: (m) => searchBilibili(m.query, m.limit),
  SCRAPER_SEARCH_ZHIHU: (m) => searchZhihu(m.query, m.limit),
  SCRAPER_SEARCH_XUEQIU: (m) => searchXueqiu(m.query, m.limit),
  SCRAPER_SEARCH_INSTAGRAM: (m) => searchInstagram(m.query, m.limit),
  SCRAPER_SEARCH_LINUX_DO: (m) => searchLinuxDo(m.query, m.limit),
  SCRAPER_SEARCH_JIKE: (m) => searchJike(m.query, m.limit),
  SCRAPER_SEARCH_XIAOHONGSHU: (m) => searchXiaohongshu(m.query, m.limit),
  SCRAPER_FETCH_XHS_CREATOR_HOT_INSPIRATION_FEED: () => xhsGetCreatorHotInspirationFeed(),
  SCRAPER_FETCH_XHS_PRODUCT_RECOMMENDATIONS: (m) => xhsGetProductRecommendations({ region: m.region, sku_id: m.sku_id || m.skuId }),
  SCRAPER_FETCH_XHS_TOPIC_INFO: (m) => xhsGetTopicInfo({ source: m.source, page_id: m.page_id || m.pageId }),
  SCRAPER_FETCH_XHS_NOTE_COMMENTS: (m) => xhsGetNoteComments({ index: m.index, cursor: m.cursor, note_id: m.note_id || m.noteId, share_text: m.share_text || m.shareText, sort_strategy: m.sort_strategy || m.sortStrategy, limit: m.limit }),
  SCRAPER_SEARCH_XHS_GROUPS: (m) => xhsSearchGroups({ source: m.source, keyword: m.keyword || m.query, search_id: m.search_id || m.searchId }),
  SCRAPER_FETCH_XHS_PRODUCT_REVIEWS: (m) => xhsGetProductReviews({ sku_id: m.sku_id || m.skuId, from_page: m.from_page || m.fromPage }),
  SCRAPER_FETCH_XHS_TOPIC_FEED: (m) => xhsGetTopicFeed({ sort: m.sort, source: m.source, page_id: m.page_id || m.pageId }),
  SCRAPER_FETCH_XHS_MIXED_NOTE_DETAIL: (m) => xhsGetMixedNoteDetail({ note_id: m.note_id || m.noteId, share_text: m.share_text || m.shareText }),
  SCRAPER_SEARCH_XHS_NOTES: (m) => xhsSearchNotes({ page: m.page, source: m.source, keyword: m.keyword || m.query, note_type: m.note_type || m.noteType, sort_type: m.sort_type || m.sortType, time_filter: m.time_filter || m.timeFilter, limit: m.limit }),
  SCRAPER_FETCH_XHS_PRODUCT_DETAIL: (m) => xhsGetProductDetail({ sku_id: m.sku_id || m.skuId, source: m.source, pre_page: m.pre_page || m.prePage }),
  SCRAPER_FETCH_XHS_PRODUCT_REVIEW_OVERVIEW: (m) => xhsGetProductReviewOverview({ tab: m.tab, sku_id: m.sku_id || m.skuId }),
  SCRAPER_FETCH_XHS_CREATOR_INSPIRATION_FEED: (m) => xhsGetCreatorInspirationFeed({ source: m.source }),
  SCRAPER_FETCH_XHS_IMAGE_NOTE_DETAIL: (m) => xhsGetImageNoteDetail({ note_id: m.note_id || m.noteId, share_text: m.share_text || m.shareText }),
  SCRAPER_SEARCH_XHS_USERS: (m) => xhsSearchUsers({ page: m.page, source: m.source, keyword: m.keyword || m.query }),
  SCRAPER_SEARCH_XHS_IMAGES: (m) => xhsSearchImages({ page: m.page, source: m.source, keyword: m.keyword || m.query, limit: m.limit }),
  SCRAPER_SEARCH_XHS_PRODUCTS: (m) => xhsSearchProducts({ page: m.page, source: m.source, keyword: m.keyword || m.query }),
  SCRAPER_FETCH_XHS_USER_FAVED_NOTES: () => xhsGetUserFavedNotes(),
  SCRAPER_SEARCH_WEIBO: (m) => searchWeibo(m.query, m.limit),
  SCRAPER_SEARCH_DOUBAN: (m) => searchDouban(m.query, m.limit),
  SCRAPER_SEARCH_MEDIUM: (m) => searchMedium(m.query, m.limit),
  SCRAPER_SEARCH_GOOGLE: (m) => searchGoogle(m.query, { limit: m.limit, lang: m.lang }),
  SCRAPER_SEARCH_FACEBOOK: (m) => searchFacebook(m.query, m.limit),
  SCRAPER_SEARCH_LINKEDIN: (m) => searchLinkedInJobs(m.query, m),
  SCRAPER_SEARCH_36KR: (m) => search36Kr(m.query, m.limit),
  SCRAPER_FETCH_PRODUCTHUNT: (m) => fetchProductHuntHot(m.limit),
  SCRAPER_FETCH_WEIXIN: (m) => fetchWeixinArticle(m.url),
  fetch_wechat_article: (m) => fetchWeixinArticle(m.url),
  SCRAPER_FETCH_YAHOO_FINANCE: (m) => fetchYahooFinanceQuote(m.symbol),
  SCRAPER_FETCH_REDDIT_HOT: (m) => fetchRedditHot(m.limit),
  // Reddit34-compatible GET surface.
  SCRAPER_FETCH_RD_POPULAR_POSTS: (m) => getRedditPopularPosts({ sort: m.sort, limit: m.limit }),
  SCRAPER_FETCH_RD_TOP_POPULAR_POSTS: (m) => getRedditTopPopularPosts({ time: m.time, limit: m.limit }),
  SCRAPER_FETCH_RD_RISING_POPULAR_POSTS: (m) => getRedditRisingPopularPosts({ limit: m.limit }),
  SCRAPER_FETCH_RD_BEST_POPULAR_POSTS: (m) => getRedditBestPopularPosts({ limit: m.limit }),
  SCRAPER_FETCH_RD_POPULAR_POSTS_BY_COUNTRY: (m) => getRedditPopularPostsByCountry({ country: m.country, sort: m.sort, time: m.time, limit: m.limit }),
  SCRAPER_FETCH_RD_POSTS_BY_SUBREDDIT: (m) => getRedditPostsBySubreddit(m.subreddit || m.sub, { sort: m.sort, time: m.time, limit: m.limit }),
  SCRAPER_FETCH_RD_TOP_POSTS_BY_SUBREDDIT: (m) => getRedditTopPostsBySubreddit(m.subreddit || m.sub, { time: m.time, limit: m.limit }),
  SCRAPER_FETCH_RD_CONTROVERSIAL_POSTS_BY_SUBREDDIT: (m) => getRedditControversialPostsBySubreddit(m.subreddit || m.sub, { time: m.time, limit: m.limit }),
  SCRAPER_FETCH_RD_COMMENTS_BY_SUBREDDIT: (m) => getRedditCommentsBySubreddit(m.subreddit || m.sub, { limit: m.limit }),
  SCRAPER_FETCH_RD_SUBREDDIT_INFO: (m) => getRedditSubredditInfo(m.subreddit || m.sub),
  SCRAPER_FETCH_RD_SUBREDDIT_RULES: (m) => getRedditSubredditRules(m.subreddit || m.sub),
  SCRAPER_FETCH_RD_SIMILAR_SUBREDDITS: (m) => getRedditSimilarSubreddits(m.subreddit || m.sub, { limit: m.limit }),
  SCRAPER_FETCH_RD_NEW_SUBREDDITS: (m) => getRedditNewSubreddits({ limit: m.limit }),
  SCRAPER_FETCH_RD_POPULAR_SUBREDDITS: (m) => getRedditPopularSubreddits({ limit: m.limit }),
  SCRAPER_FETCH_RD_POSTS_BY_USERNAME: (m) => getRedditPostsByUsername(m.username || m.user, { sort: m.sort, time: m.time, limit: m.limit }),
  SCRAPER_FETCH_RD_TOP_POSTS_BY_USERNAME: (m) => getRedditTopPostsByUsername(m.username || m.user, { time: m.time, limit: m.limit }),
  SCRAPER_FETCH_RD_COMMENTS_BY_USERNAME: (m) => getRedditCommentsByUsername(m.username || m.user, { sort: m.sort, time: m.time, limit: m.limit }),
  SCRAPER_FETCH_RD_TOP_COMMENTS_BY_USERNAME: (m) => getRedditTopCommentsByUsername(m.username || m.user, { time: m.time, limit: m.limit }),
  SCRAPER_FETCH_RD_USER_OVERVIEW: (m) => getRedditUserOverview(m.username || m.user, { sort: m.sort, time: m.time, limit: m.limit }),
  SCRAPER_FETCH_RD_USER_POST_RANK_IN_SUBREDDIT: (m) => getRedditUserPostRankInSubreddit(m.username || m.user, m.subreddit || m.sub, { sort: m.sort, limit: m.limit }),
  SCRAPER_FETCH_RD_PROFILE: (m) => getRedditProfile(m.username || m.user),
  SCRAPER_FETCH_RD_USER_STATS: (m) => getRedditUserStats(m.username || m.user),
  SCRAPER_SEARCH_RD_USERS: (m) => searchRedditUsers(m.query || m.username, { limit: m.limit }),
  SCRAPER_SEARCH_RD_POSTS: (m) => searchRedditPosts(m.query || m.keyword, { subreddit: m.subreddit || m.sub, sort: m.sort, time: m.time, limit: m.limit }),
  SCRAPER_SEARCH_RD_SUBREDDITS: (m) => searchRedditSubreddits(m.query || m.subreddit, { limit: m.limit }),
  SCRAPER_FETCH_RD_POST_DETAILS: (m) => getRedditPostDetails(m.post_url || m.postUrl || m.url || m.postId || m.id),
  SCRAPER_FETCH_RD_POST_COMMENTS: (m) => getRedditPostComments(m.post_url || m.postUrl || m.url || m.postId || m.id, { limit: m.limit }),
  SCRAPER_FETCH_RD_POST_COMMENTS_WITH_SORT: (m) => getRedditPostCommentsWithSort(m.post_url || m.postUrl || m.url || m.postId || m.id, { sort: m.sort, limit: m.limit }),
  SCRAPER_FETCH_RD_POST_DUPLICATES: (m) => getRedditPostDuplicates(m.post_url || m.postUrl || m.url || m.postId || m.id, { limit: m.limit }),
  SCRAPER_FETCH_BILIBILI_HOT: (m) => fetchBilibiliHot(m.limit),
  SCRAPER_FETCH_BILIBILI_RANKING: (m) => fetchBilibiliRanking(m.limit),
  SCRAPER_FETCH_TIKTOK_EXPLORE: (m) => fetchTikTokExplore(m.limit),
  SCRAPER_FETCH_TIKTOK_USER_POSTS: (m) => getTikTokUserPosts(m.username || m.secUid || m.user, { cursor: m.cursor, limit: m.limit }),
  SCRAPER_FETCH_TIKTOK_USER_FOLLOWERS: (m) => getTikTokUserFollowers(m.username || m.secUid || m.user, { cursor: m.cursor, limit: m.limit }),
  SCRAPER_FETCH_TIKTOK_POST_DETAIL: (m) => getTikTokPostDetail(m.url || m.video || m.videoId || m.id),
  SCRAPER_FETCH_TIKTOK_POST_COMMENTS: (m) => getTikTokPostComments(m.url || m.video || m.videoId || m.id, { cursor: m.cursor, limit: m.limit }),
  SCRAPER_SEARCH_TIKTOK_ACCOUNT: (m) => searchTikTokAccount(m.query, m.limit),
  // TikTok Wave 2/3/4
  SCRAPER_FETCH_TIKTOK_CHALLENGE_INFO: (m) => getTikTokChallengeInfo(m.challengeName || m.name),
  SCRAPER_FETCH_TIKTOK_CHALLENGE_POSTS: (m) => getTikTokChallengePosts(m.challengeId || m.id, { cursor: m.cursor, limit: m.limit }),
  SCRAPER_FETCH_TIKTOK_MUSIC_INFO: (m) => getTikTokMusicInfo(m.musicId || m.id),
  SCRAPER_FETCH_TIKTOK_MUSIC_POSTS: (m) => getTikTokMusicPosts(m.musicId || m.id, { cursor: m.cursor, limit: m.limit }),
  SCRAPER_FETCH_TIKTOK_MUSIC_UNLIMITED: (m) => getTikTokMusicUnlimitedSounds({ page: m.page, pageSize: m.pageSize, orderBy: m.orderBy }),
  SCRAPER_FETCH_TIKTOK_USER_INFO_REGION: (m) => getTikTokUserInfoWithRegion(m.uniqueId || m.username || m.handle),
  SCRAPER_FETCH_TIKTOK_USER_INFO_BY_ID: (m) => getTikTokUserInfoById(m.userId || m.id),
  SCRAPER_FETCH_TIKTOK_USER_FOLLOWINGS: (m) => getTikTokUserFollowings(m.user || m.secUid || m.uniqueId, { max_time: m.max_time, limit: m.limit }),
  SCRAPER_FETCH_TIKTOK_USER_LIKED_POSTS: (m) => getTikTokUserLikedPosts(m.user || m.secUid || m.uniqueId, { cursor: m.cursor, limit: m.limit }),
  SCRAPER_FETCH_TIKTOK_USER_PLAYLIST: (m) => getTikTokUserPlaylist(m.user || m.secUid || m.uniqueId, { cursor: m.cursor, limit: m.limit }),
  SCRAPER_FETCH_TIKTOK_USER_REPOST: (m) => getTikTokUserRepost(m.user || m.secUid || m.uniqueId, { cursor: m.cursor, limit: m.limit }),
  SCRAPER_FETCH_TIKTOK_USER_STORY: (m) => getTikTokUserStory(m.userId || m.id, { maxCursor: m.maxCursor }),
  SCRAPER_SEARCH_TIKTOK_GENERAL: (m) => searchTikTokGeneral(m.query || m.keyword, { cursor: m.cursor, limit: m.limit }),
  SCRAPER_SEARCH_TIKTOK_LIVE: (m) => searchTikTokLive(m.query || m.keyword, { cursor: m.cursor, limit: m.limit }),
  SCRAPER_FETCH_TIKTOK_SEARCH_SUGGESTIONS: (m) => getTikTokOthersSearchedFor(m.keyword || m.query),
  SCRAPER_FETCH_TIKTOK_POST_RELATED: (m) => getTikTokPostRelated(m.video || m.videoId || m.url || m.id, { cursor: m.cursor, limit: m.limit }),
  SCRAPER_FETCH_TIKTOK_POST_EXPLORE: (m) => getTikTokPostExplore({ categoryType: m.categoryType, limit: m.limit }),
  SCRAPER_FETCH_TIKTOK_POST_DISCOVER: (m) => getTikTokPostDiscover(m.keyword || m.query, { page: m.page }),
  // TikTok Wave 5 — Creative Center (ads.tiktok.com); array-shaped opts
  // (placements/themes/genres/moods) come through as repeated query
  // string keys to mirror what tiktok-api23 emits.
  SCRAPER_FETCH_TT_ADS_DETAIL: (m) => getTikTokAdsDetail(m.ads_id || m.adsId || m.id),
  SCRAPER_FETCH_TT_ADS_TOP: (m) => getTikTokAdsTop({ page: m.page, period: m.period, limit: m.limit, country: m.country, order_by: m.order_by }),
  SCRAPER_FETCH_TT_TRENDING_CREATOR: (m) => getTikTokTrendingCreator({ page: m.page, limit: m.limit, sort_by: m.sort_by, country: m.country }),
  SCRAPER_FETCH_TT_TRENDING_VIDEO: (m) => getTikTokTrendingVideo({ page: m.page, limit: m.limit, period: m.period, order_by: m.order_by, country: m.country }),
  SCRAPER_FETCH_TT_TRENDING_HASHTAG: (m) => getTikTokTrendingHashtag({ page: m.page, limit: m.limit, period: m.period, country: m.country, sort_by: m.sort_by }),
  SCRAPER_FETCH_TT_TRENDING_SONG: (m) => getTikTokTrendingSong({ page: m.page, limit: m.limit, period: m.period, rank_type: m.rank_type, country: m.country }),
  SCRAPER_FETCH_TT_TRENDING_KEYWORD: (m) => getTikTokTrendingKeyword({ page: m.page, limit: m.limit, period: m.period, country: m.country }),
  SCRAPER_FETCH_TT_TRENDING_KEYWORD_POSTS: (m) => getTikTokTrendingKeywordPosts(m.keyword, { country: m.country, limit: m.limit, period: m.period }),
  SCRAPER_FETCH_TT_TRENDING_KEYWORD_SENTENCE: (m) => getTikTokTrendingKeywordSentence(m.keyword, { page: m.page, limit: m.limit, period: m.period, country: m.country, order_type: m.order_type }),
  SCRAPER_FETCH_TT_COMMERCIAL_MUSIC: (m) => getTikTokCommercialMusicLibrary({ page: m.page, limit: m.limit, region: m.region, scenarios: m.scenarios, duration: m.duration, placements: m.placements, themes: m.themes, genres: m.genres, moods: m.moods }),
  SCRAPER_FETCH_TT_COMMERCIAL_PLAYLISTS: (m) => getTikTokCommercialMusicPlaylists({ limit: m.limit, region: m.region }),
  SCRAPER_FETCH_TT_COMMERCIAL_PLAYLIST_DETAIL: (m) => getTikTokCommercialMusicPlaylistDetail(m.playlist_id || m.playlistId, { page: m.page, limit: m.limit, region: m.region }),
  SCRAPER_FETCH_TT_TOP_PRODUCTS: (m) => getTikTokTopProducts({ page: m.page, last: m.last, order_by: m.order_by, order_type: m.order_type }),
  SCRAPER_FETCH_TT_TOP_PRODUCT_DETAIL: (m) => getTikTokTopProductDetail(m.product_id || m.productId),
  SCRAPER_FETCH_TT_TOP_PRODUCT_METRICS: (m) => getTikTokTopProductMetrics(m.product_id || m.productId),
  // TikTok Wave 6 (long-tail) — place / effect / collection /
  // post-comment-replies. All on regular www.tiktok.com (same auth as
  // Wave 1-4). Place + Effect info hit landing-page rehydration scripts
  // whose webapp.place-detail / webapp.effect-detail namespace is a
  // best-guess; on miss, scraper returns a structured "endpoint unknown"
  // error envelope flagging it for follow-up reverse-engineering.
  SCRAPER_FETCH_TT_PLACE_INFO: (m) => getTikTokPlaceInfo(m.placeId || m.id),
  SCRAPER_FETCH_TT_PLACE_POSTS: (m) => getTikTokPlacePosts(m.placeId || m.id, { cursor: m.cursor, limit: m.limit }),
  SCRAPER_FETCH_TT_EFFECT_INFO: (m) => getTikTokEffectInfo(m.effectId || m.id),
  SCRAPER_FETCH_TT_EFFECT_POSTS: (m) => getTikTokEffectPosts(m.effectId || m.id, { cursor: m.cursor, limit: m.limit }),
  SCRAPER_FETCH_TT_COLLECTION_INFO: (m) => getTikTokCollectionInfo(m.collectionId || m.id),
  SCRAPER_FETCH_TT_COLLECTION_POSTS: (m) => getTikTokCollectionPosts(m.collectionId || m.id, { limit: m.limit }),
  SCRAPER_FETCH_TT_POST_COMMENT_REPLIES: (m) => getTikTokPostCommentReplies(m.video || m.videoId || m.id || m.url, m.comment_id || m.commentId, { cursor: m.cursor, limit: m.limit }),
  // Douyin (抖音) — TikTok's Chinese sibling on douyin.com. All endpoints
  // take a sec_user_id (Douyin's canonical user id); the a-bogus/X-Bogus
  // signature requirement on /aweme/v1/web/* is bypassed by the
  // logged-in same-origin page-context fetch for read endpoints.
  SCRAPER_FETCH_DY_USER_INFO: (m) => getDouyinUserInfo(m.secUid || m.sec_user_id || m.user),
  SCRAPER_FETCH_DY_USER_POSTS: (m) => getDouyinUserPosts(m.secUid || m.sec_user_id || m.user, { cursor: m.cursor, limit: m.limit }),
  SCRAPER_FETCH_DY_USER_LIKED: (m) => getDouyinUserLikedPosts(m.secUid || m.sec_user_id || m.user, { cursor: m.cursor, limit: m.limit }),
  SCRAPER_FETCH_DY_USER_FOLLOWERS: (m) => getDouyinUserFollowers(m.secUid || m.sec_user_id || m.user, { max_time: m.max_time, limit: m.limit }),
  SCRAPER_FETCH_DY_USER_FOLLOWING: (m) => getDouyinUserFollowing(m.secUid || m.sec_user_id || m.user, { max_time: m.max_time, limit: m.limit }),
  SCRAPER_FETCH_DY_POST_COMMENTS: (m) => getDouyinPostComments(m.video || m.videoId || m.video_id || m.aweme_id || m.id, { cursor: m.cursor, limit: m.limit }),
  SCRAPER_SEARCH_DY_GENERAL: (m) => searchDouyinGeneral(m.keyword || m.query, { offset: m.offset || m.cursor, limit: m.limit }),
  SCRAPER_SEARCH_DY_VIDEO: (m) => searchDouyinVideo(m.keyword || m.query, { offset: m.offset || m.cursor, limit: m.limit }),
  SCRAPER_SEARCH_DY_ACCOUNT: (m) => searchDouyinAccount(m.keyword || m.query, { cursor: m.cursor, limit: m.limit }),
  SCRAPER_SEARCH_DY_LIVE: (m) => searchDouyinLive(m.keyword || m.query, { offset: m.offset || m.cursor, limit: m.limit }),
  SCRAPER_FETCH_DY_CHALLENGE_POSTS: (m) => getDouyinChallengePosts(m.hashtag || m.ch_id || m.id, { offset: m.offset || m.cursor, limit: m.limit }),
  SCRAPER_FETCH_DY_MUSIC_POSTS: (m) => getDouyinMusicPosts(m.musicId || m.music_id || m.id, { cursor: m.cursor, limit: m.limit }),
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
  TWITTER_TIMELINE: (m) => getTwitterTimeline(m.type, m.limit, m.queryIds),
  TWITTER_SEARCH: (m) => searchTwitter(m.query, m.filter, m.limit, m.queryIds),
  TWITTER_TRENDING: (m) => getTwitterTrending(m.limit),
  TWITTER_PROFILE: (m) => getTwitterProfile(m.username, m.queryIds),
  TWITTER_BOOKMARKS: (m) => getTwitterBookmarks(m.limit, m.queryIds),
  TWITTER_USER_TWEETS: (m) => getTwitterUserTweets(m.username, m.limit, m.queryIds),
  TWITTER_THREAD: (m) => getTwitterThread(m.tweetId, m.limit, m.queryIds),
  // CLI compat aliases — old scrape_* actions now routed to background GraphQL scrapers.
  // queryIds passed in WS payload from `@bnbot/cli` (cli/src/xQueryIds.ts) — extension
  // tries fa0311 upstream first, falls back to caller-provided ids.
  scrape_timeline: (m) => getTwitterTimeline(m.type || 'for-you', m.limit, m.queryIds),
  scrape_bookmarks: (m) => getTwitterBookmarks(m.limit, m.queryIds),
  scrape_search_results: (m) => searchTwitter(m.query, m.filter, m.limit, m.queryIds),
  scrape_user_tweets: (m) => getTwitterUserTweets(m.username, m.limit, m.queryIds),
  scrape_user_profile: (m) => getTwitterProfile(m.username, m.queryIds),
  scrape_thread: (m) => getTwitterThread(m.tweetUrl || m.tweetId, m.limit, m.queryIds),
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
  debug_set_files_via_chooser: (m) => debugSetFileInputFilesViaChooser({
    selector: m.selector,
    files: m.files,
    tabId: m.tabId,
    targetHost: m.targetHost,
    timeoutMs: m.timeoutMs,
  }),
  debug_set_files_via_blob: (m) => debugSetFilesViaBlob({
    selector: m.selector,
    fileName: m.fileName,
    mimeType: m.mimeType,
    base64: m.base64,
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
  getRedditPopularPosts, getRedditTopPopularPosts, getRedditRisingPopularPosts,
  getRedditBestPopularPosts, getRedditPopularPostsByCountry,
  getRedditPostsBySubreddit, getRedditTopPostsBySubreddit,
  getRedditControversialPostsBySubreddit, getRedditCommentsBySubreddit,
  getRedditSubredditInfo, getRedditSubredditRules,
  getRedditSimilarSubreddits, getRedditNewSubreddits, getRedditPopularSubreddits,
  getRedditPostsByUsername, getRedditTopPostsByUsername,
  getRedditCommentsByUsername, getRedditTopCommentsByUsername,
  getRedditUserOverview, getRedditUserPostRankInSubreddit,
  getRedditProfile, getRedditUserStats, searchRedditUsers, searchRedditPosts,
  searchRedditSubreddits, getRedditPostDetails, getRedditPostComments,
  getRedditPostCommentsWithSort, getRedditPostDuplicates,
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
  getYouTubeVideoDetails, getYouTubeChannelDetails, getYouTubeChannelVideos,
  getYouTubeTrending, searchYouTubeChannel, getYouTubeStreamingData,
  getYouTubeRelatedVideos, getYouTubeComments, getYouTubeTranscript,
  getTikTokUserPosts, getTikTokUserFollowers, getTikTokPostDetail,
  getTikTokPostComments, searchTikTokAccount,
  getTikTokChallengeInfo, getTikTokChallengePosts,
  getTikTokMusicInfo, getTikTokMusicPosts, getTikTokMusicUnlimitedSounds,
  getTikTokUserInfoWithRegion, getTikTokUserInfoById,
  getTikTokUserFollowings, getTikTokUserLikedPosts,
  getTikTokUserPlaylist, getTikTokUserRepost, getTikTokUserStory,
  searchTikTokGeneral, searchTikTokLive, getTikTokOthersSearchedFor,
  getTikTokPostRelated, getTikTokPostExplore, getTikTokPostDiscover,
  // Wave 5 — Creative Center (ads.tiktok.com)
  getTikTokAdsDetail, getTikTokAdsTop,
  getTikTokTrendingCreator, getTikTokTrendingVideo, getTikTokTrendingHashtag,
  getTikTokTrendingSong, getTikTokTrendingKeyword,
  getTikTokTrendingKeywordPosts, getTikTokTrendingKeywordSentence,
  getTikTokCommercialMusicLibrary, getTikTokCommercialMusicPlaylists,
  getTikTokCommercialMusicPlaylistDetail,
  getTikTokTopProducts, getTikTokTopProductDetail, getTikTokTopProductMetrics,
  // Wave 6 — place / effect / collection / post-comment-replies (www.tiktok.com)
  getTikTokPlaceInfo, getTikTokPlacePosts,
  getTikTokEffectInfo, getTikTokEffectPosts,
  getTikTokCollectionInfo, getTikTokCollectionPosts,
  getTikTokPostCommentReplies,
  // Douyin (抖音) — TikTok's Chinese sibling on douyin.com
  getDouyinUserInfo, getDouyinUserPosts, getDouyinUserLikedPosts,
  getDouyinUserFollowers, getDouyinUserFollowing,
  getDouyinPostComments,
  searchDouyinGeneral, searchDouyinVideo, searchDouyinAccount, searchDouyinLive,
  getDouyinChallengePosts, getDouyinMusicPosts,
});

// fetchVideoAsDataUrl / fetchImageAsBase64 / fetchBlobAsDataUrl removed —
// the FETCH_VIDEO / FETCH_IMAGE / FETCH_BLOB message handlers that drove
// them were the CORS-bypass proxies for the legacy DOM-write path.
// Every write goes through the CDP debugger engine now, so no extension
// code fetches xhscdn / mmbiz.qpic.cn / qpic.cn any more — and those
// host_permissions came off the manifest in the same change.
