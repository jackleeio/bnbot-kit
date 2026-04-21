/**
 * Mid-level CDP primitives for write actions. Stacks on top of
 * `scraperService.ts`'s window pool + debugger attach machinery —
 * same offscreen/minimized window that read scrapers use (ensures a
 * clean chrome-extension-iframe-free tab + pooled idle-timeout reuse).
 *
 * High-level action handlers (reply/post/like/retweet) compose these
 * without worrying about pool lifecycle — just call `prepareTab(url)`
 * → run ops → return. The window persists across invocations and auto-
 * closes on idle via the shared `startAllIdleTimers()`.
 *
 * ❗ Single-domain concurrency: scraperService pools one tab per
 * hostname. Two writes to x.com at the same time will serialise; that's
 * actually the desired behavior for rate-limit / anti-spam (humans
 * don't multi-post either).
 */

import {
  ensureDebuggerAttached,
  executeInPage,
  debuggerSend,
  getTab,
} from '../scraperService'

export type DebuggerEventListener = (method: string, params: unknown) => void

const eventListeners = new Map<string, Set<DebuggerEventListener>>()
let globalEventHandlerInstalled = false

/** Register a listener for all CDP events on a given target. Callers
 *  are responsible for filtering by event method. Returns a cleanup
 *  function; safe to call multiple times. */
export function registerEventListener(
  targetId: string,
  listener: DebuggerEventListener,
): () => void {
  ensureGlobalEventHandler()
  if (!eventListeners.has(targetId)) eventListeners.set(targetId, new Set())
  eventListeners.get(targetId)!.add(listener)
  let unregistered = false
  return () => {
    if (unregistered) return
    unregistered = true
    eventListeners.get(targetId)?.delete(listener)
  }
}

/** Install a single global CDP-event handler that multiplexes by
 *  targetId into our `eventListeners` map. We only install it once to
 *  avoid leaking listeners across many write actions. */
function ensureGlobalEventHandler(): void {
  if (globalEventHandlerInstalled) return
  globalEventHandlerInstalled = true
  chrome.debugger.onEvent.addListener((source, method, params) => {
    const key = source.targetId ?? `tab:${source.tabId}`
    const set = eventListeners.get(key)
    if (!set) return
    for (const listener of set) {
      try {
        listener(method, params)
      } catch {
        // Swallow — don't let one bad listener nuke the rest.
      }
    }
  })
}

export interface AttachedTarget {
  tabId: number
  targetId: string
}

/** Get (or create) a pooled scraper window for the given URL, attach
 *  debugger, enable the domains write actions need. Returns the tab +
 *  target ids. Safe to call back-to-back in one action — cheap idempotent
 *  resolver. */
const viewportApplied = new Set<string>()

export async function prepareTab(url: string): Promise<AttachedTarget> {
  const tabId = await getTab(url)
  // If the pooled tab already exists on a different URL, navigate it.
  const current = await chrome.tabs.get(tabId).catch(() => null)
  const needsNav = !current?.url || !current.url.startsWith(url)
  const targetId = await ensureDebuggerAttached(tabId, [
    'Page',
    'Runtime',
    'DOM',
    'Network',
    'Emulation',
  ])
  ensureGlobalEventHandler()
  // Force a desktop viewport regardless of the OS-level window size.
  // X's composer serves its mobile layout (no addButton, different
  // testids) at narrow widths — pool windows can be small, so we pin
  // the device metrics via CDP. React on X only reads width at mount,
  // so on first attach we must re-render by navigating or reloading.
  const firstApply = !viewportApplied.has(targetId)
  await debuggerSend(targetId, 'Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  }).catch(() => {})
  viewportApplied.add(targetId)
  if (needsNav) {
    await chrome.tabs.update(tabId, { url })
    await waitForStatusComplete(tabId, 15_000)
  } else if (firstApply) {
    // URL already right but we just applied viewport override — React
    // has cached mobile layout, force a reload so it re-mounts at 1280.
    await debuggerSend(targetId, 'Page.reload', { ignoreCache: false }).catch(() => {})
    await waitForStatusComplete(tabId, 15_000)
  }
  return { tabId, targetId }
}

/** Temporarily un-minimize + focus the automation window so Chrome
 *  doesn't throttle `Input.insertText` / aria-state updates during
 *  composer flows. Used by post / reply / quote (text input paths).
 *  Returns a restore function the caller should await before returning. */
export async function bringTabToFront(tabId: number): Promise<() => Promise<void>> {
  const tab = await chrome.tabs.get(tabId).catch(() => null)
  const windowId = tab?.windowId
  if (!windowId) return async () => {}
  const win = await chrome.windows.get(windowId).catch(() => null)
  const priorState = win?.state
  try {
    // Un-minimize without focusing — focused:true on macOS can pull
    // offscreen windows back into view. 'normal' state alone removes
    // Chrome's input-event throttling.
    await chrome.windows.update(windowId, {
      state: 'normal',
      focused: false,
    })
  } catch {
    // Best-effort.
  }
  return async () => {
    try {
      if (priorState === 'minimized') {
        await chrome.windows.update(windowId, { state: 'minimized' })
      }
    } catch {
      // ignore
    }
  }
}

/** Chrome-internal `tab.status === 'complete'` wait; different from
 *  CDP's `Page.loadEventFired` which only fires for pushState nav in
 *  SPAs inconsistently. `chrome.tabs.onUpdated` is the source of truth
 *  we already rely on in scraperService. */
function waitForStatusComplete(tabId: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const start = Date.now()
    const tick = async () => {
      try {
        const tab = await chrome.tabs.get(tabId)
        if (tab.status === 'complete') return resolve()
      } catch {
        return resolve()
      }
      if (Date.now() - start >= timeoutMs) return resolve()
      setTimeout(tick, 250)
    }
    tick()
  })
}

// ============ Runtime.evaluate helpers ============

interface RuntimeRemoteObject {
  type: string
  value?: unknown
}

interface RuntimeEvalResult {
  result: RuntimeRemoteObject
  exceptionDetails?: { text: string; exception?: { description?: string } }
}

export async function evalExpr<T = unknown>(
  targetId: string,
  expression: string,
): Promise<T> {
  const res = await debuggerSend<RuntimeEvalResult>(targetId, 'Runtime.evaluate', {
    expression,
    awaitPromise: false,
    returnByValue: true,
  })
  if (res?.exceptionDetails) {
    const msg = res.exceptionDetails.exception?.description
      || res.exceptionDetails.text
      || 'page threw'
    throw new Error(msg)
  }
  return res?.result?.value as T
}

/** Poll the page for a selector until it appears or the deadline hits. */
export async function waitForSelector(
  targetId: string,
  selector: string,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const hit = await evalExpr<boolean>(
      targetId,
      `!!document.querySelector(${JSON.stringify(selector)})`,
    )
    if (hit) return
    await sleep(200)
  }
  throw new Error(`timed out waiting for selector ${selector}`)
}

/** Poll the page until a button-like selector is no longer
 *  aria-disabled. Useful after attaching video: X keeps submit disabled
 *  while the upload/transcode is processing, even though the visible
 *  `[data-testid="attachments"]` node already appeared. */
export async function waitUntilClickable(
  targetId: string,
  selector: string,
  timeoutMs = 60_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const ready = await evalExpr<boolean>(
      targetId,
      `(function(){const el=document.querySelector(${JSON.stringify(selector)});return !!el && el.getAttribute('aria-disabled') !== 'true' && !el.hasAttribute('disabled');})()`,
    )
    if (ready) return
    await sleep(300)
  }
  throw new Error(`timed out waiting for clickable ${selector}`)
}

/** Wait for ANY one of the selectors, return which matched. */
export async function waitForAnySelector(
  targetId: string,
  selectors: string[],
  timeoutMs = 10_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs
  const listExpr = JSON.stringify(selectors)
  while (Date.now() < deadline) {
    const hit = await evalExpr<string | null>(
      targetId,
      `(function(){const sels=${listExpr};for(const s of sels){if(document.querySelector(s))return s;}return null;})()`,
    )
    if (hit) return hit
    await sleep(200)
  }
  throw new Error(`timed out waiting for any of: ${selectors.join(', ')}`)
}

// ============ Click / focus ============

export async function clickSelector(targetId: string, selector: string): Promise<void> {
  const script = `(function(){const el=document.querySelector(${JSON.stringify(selector)});if(!el)throw new Error('not found: '+${JSON.stringify(selector)});el.scrollIntoView({block:'center'});el.click();return true;})()`
  await evalExpr<boolean>(targetId, script)
}

/** Dispatch a REAL (trusted) mouse click via CDP at the element's
 *  center. Necessary for buttons whose React handlers only fire on
 *  trusted pointer events (element.click() is synthesized and skipped). */
export async function trustedClickSelector(
  targetId: string,
  selector: string,
): Promise<void> {
  const rect = await evalExpr<{ x: number; y: number } | null>(
    targetId,
    `(function(){const el=document.querySelector(${JSON.stringify(selector)});if(!el)return null;el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`,
  )
  if (!rect) throw new Error(`trustedClick: not found ${selector}`)
  // Dispatch a full mouse press+release at the element's center.
  await debuggerSend(targetId, 'Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: rect.x,
    y: rect.y,
    button: 'left',
    clickCount: 1,
  })
  await debuggerSend(targetId, 'Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: rect.x,
    y: rect.y,
    button: 'left',
    clickCount: 1,
  })
}

export async function focusSelector(targetId: string, selector: string): Promise<void> {
  const script = `(function(){const el=document.querySelector(${JSON.stringify(selector)});if(!el)throw new Error('not found: '+${JSON.stringify(selector)});el.scrollIntoView({block:'center'});el.focus();return true;})()`
  await evalExpr<boolean>(targetId, script)
}

// ============ Input — kernel-level keystrokes ============

export async function insertText(targetId: string, text: string): Promise<void> {
  await debuggerSend(targetId, 'Input.insertText', { text })
}

export async function focusAndType(
  targetId: string,
  selector: string,
  text: string,
): Promise<void> {
  await focusSelector(targetId, selector)
  await sleep(80)
  await insertText(targetId, text)
}

// ============ File upload ============

export async function setFileInputFiles(
  targetId: string,
  selector: string,
  filePaths: string[],
): Promise<void> {
  const doc = await debuggerSend<{ root: { nodeId: number } }>(
    targetId,
    'DOM.getDocument',
    { depth: -1, pierce: true },
  )
  const query = await debuggerSend<{ nodeId: number }>(
    targetId,
    'DOM.querySelector',
    { nodeId: doc.root.nodeId, selector },
  )
  if (!query?.nodeId) throw new Error(`file input not found: ${selector}`)
  await debuggerSend(targetId, 'DOM.setFileInputFiles', {
    nodeId: query.nodeId,
    files: filePaths,
  })
}

// ============ Network sniffing ============

interface NetworkResponseEvent {
  requestId: string
  response: { url: string; status: number }
}

interface NetworkLoadingFinishedEvent {
  requestId: string
}

/**
 * Wait for a JSON response whose URL contains `urlPattern`.
 *
 * Uses a two-phase listener:
 *   1. `Network.responseReceived` — when headers arrive. Record the
 *      requestId → url pair if the URL matches our pattern. We DO NOT
 *      try to read the body here: headers-arrived does NOT mean the
 *      body has been streamed, and `getResponseBody` would reject with
 *      "No resource with given identifier found" / "Response body not
 *      yet available", killing the whole promise.
 *   2. `Network.loadingFinished` — body is fully streamed. Look up the
 *      requestId, fetch the body, parse, resolve.
 *
 * If `getResponseBody` still fails (e.g. the tab closed mid-request),
 * we retry a couple times before giving up and letting the next
 * matching request (if any) be the one that resolves.
 */
export async function waitForJsonResponse<T = unknown>(
  target: AttachedTarget,
  urlPattern: string | string[],
  timeoutMs = 15_000,
): Promise<T> {
  const patterns = Array.isArray(urlPattern) ? urlPattern : [urlPattern]
  return new Promise<T>((resolve, reject) => {
    let settled = false
    const key = target.targetId
    // requestId → url for requests whose URL we care about.
    const pending = new Map<string, string>()
    if (!eventListeners.has(key)) eventListeners.set(key, new Set())

    const finish = (err: Error | null, value?: T) => {
      if (settled) return
      settled = true
      eventListeners.get(key)?.delete(listener)
      if (err) reject(err)
      else resolve(value as T)
    }

    const tryReadBody = async (requestId: string): Promise<T | null> => {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const body = await debuggerSend<{ body: string; base64Encoded: boolean }>(
            target.targetId,
            'Network.getResponseBody',
            { requestId },
          )
          const text = body.base64Encoded ? atob(body.body) : body.body
          return JSON.parse(text) as T
        } catch {
          // Body buffer may not be ready immediately even on
          // loadingFinished (rare, but observed). Back off briefly.
          await sleep(150)
        }
      }
      return null
    }

    const matches = (url: string): boolean => patterns.some((p) => url.includes(p))

    const listener: DebuggerEventListener = async (method, raw) => {
      if (settled) return
      if (method === 'Network.responseReceived') {
        const params = raw as NetworkResponseEvent
        const url = params?.response?.url
        if (url && matches(url)) {
          pending.set(params.requestId, url)
        }
        return
      }
      if (method === 'Network.loadingFinished') {
        const params = raw as NetworkLoadingFinishedEvent
        if (!pending.has(params.requestId)) return
        pending.delete(params.requestId)
        const parsed = await tryReadBody(params.requestId)
        if (parsed !== null) finish(null, parsed)
        // If null (all retries failed), keep listening — another
        // matching request may arrive before the timeout.
      }
    }

    eventListeners.get(key)!.add(listener)
    setTimeout(() => {
      finish(new Error(`timed out waiting for response matching ${patterns.join(' | ')}`))
    }, timeoutMs)
  })
}

// ============ Timing helpers ============

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function jitter(minMs: number, maxMs: number): Promise<void> {
  const range = maxMs - minMs
  const u1 = Math.random() || 1e-9
  const u2 = Math.random()
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
  const norm = Math.max(0, Math.min(1, 0.5 + z / 6))
  return sleep(Math.floor(minMs + norm * range))
}

// Re-export the helper so higher-level scripts still work.
export { executeInPage }
