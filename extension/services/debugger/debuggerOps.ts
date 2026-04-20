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

type DebuggerEventListener = (method: string, params: unknown) => void

const eventListeners = new Map<string, Set<DebuggerEventListener>>()
let globalEventHandlerInstalled = false

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
export async function prepareTab(url: string): Promise<AttachedTarget> {
  const tabId = await getTab(url)
  // If the pooled tab already exists on a different URL, navigate it.
  const current = await chrome.tabs.get(tabId).catch(() => null)
  if (current?.url && !current.url.startsWith(url)) {
    // `getTab` already guarantees hostname match — we just need to
    // push the path/query to the right tweet/compose URL.
    await chrome.tabs.update(tabId, { url })
    await waitForStatusComplete(tabId, 15_000)
  }
  const targetId = await ensureDebuggerAttached(tabId, [
    'Page',
    'Runtime',
    'DOM',
    'Network',
  ])
  ensureGlobalEventHandler()
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
  const priorFocused = win?.focused ?? false
  try {
    await chrome.windows.update(windowId, {
      focused: true,
      state: 'normal',
    })
  } catch {
    // Best-effort — if focus/state change fails, continue anyway.
  }
  return async () => {
    // Restore: only re-minimize if it was minimized before. Don't force
    // re-minimize if the user manually brought it up during the action.
    try {
      if (priorState === 'minimized') {
        await chrome.windows.update(windowId, { state: 'minimized' })
      } else if (!priorFocused) {
        // Nothing to do — un-focusing isn't really supported. The
        // minimized state was our disguise; without it we just leave
        // the window where it is.
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

export async function waitForJsonResponse<T = unknown>(
  target: AttachedTarget,
  urlPattern: string,
  timeoutMs = 15_000,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false
    const key = target.targetId
    if (!eventListeners.has(key)) eventListeners.set(key, new Set())
    const listener: DebuggerEventListener = async (method, raw) => {
      if (method !== 'Network.responseReceived' || settled) return
      const params = raw as NetworkResponseEvent
      if (!params?.response?.url?.includes(urlPattern)) return
      try {
        const body = await debuggerSend<{ body: string; base64Encoded: boolean }>(
          target.targetId,
          'Network.getResponseBody',
          { requestId: params.requestId },
        )
        const text = body.base64Encoded ? atob(body.body) : body.body
        const parsed = JSON.parse(text) as T
        if (settled) return
        settled = true
        eventListeners.get(key)?.delete(listener)
        resolve(parsed)
      } catch (err) {
        if (settled) return
        settled = true
        eventListeners.get(key)?.delete(listener)
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    }
    eventListeners.get(key)!.add(listener)
    setTimeout(() => {
      if (settled) return
      settled = true
      eventListeners.get(key)?.delete(listener)
      reject(new Error(`timed out waiting for response matching ${urlPattern}`))
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
