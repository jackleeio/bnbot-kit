/**
 * High-level write actions driven by chrome.debugger (CDP). Shares the
 * scraperService window pool → one long-lived minimized x.com window
 * that both reads and writes run in. First call opens the window,
 * subsequent calls navigate within it and inherit the already-warm
 * attach + enabled CDP domains.
 *
 * Anti-detection: CDP `Input.insertText` + `DOM.setFileInputFiles` +
 * `element.click()` mirror real user event dispatch at the kernel
 * level. No synthetic React event fakery, no GraphQL POST fingerprint.
 */

import {
  type AttachedTarget,
  bringTabToFront,
  clickSelector,
  evalExpr,
  focusAndType,
  jitter,
  prepareTab,
  registerEventListener,
  setFileInputFiles,
  sleep,
  trustedClickSelector,
  waitForAnySelector,
  waitForJsonResponse,
  waitForSelector,
} from './debuggerOps'
import { debuggerSend } from '../scraperService'

// Selectors — keep in sync with X's data-testid markup.
const SEL = {
  replyTextarea: '[data-testid="tweetTextarea_0"]',
  submitInline: '[data-testid="tweetButtonInline"]',
  submitModal: '[data-testid="tweetButton"]',
  fileInput: 'input[data-testid="fileInput"]',
  attachmentsReady: '[data-testid="attachments"]',
  likeBtn: '[data-testid="like"]',
  likeActive: '[data-testid="unlike"]',
  retweetBtn: '[data-testid="retweet"]',
  retweetActive: '[data-testid="unretweet"]',
  retweetConfirm: '[data-testid="retweetConfirm"]',
  unretweetConfirm: '[data-testid="unretweetConfirm"]',
  // Quote menu — after clicking retweet, the dropdown offers "Repost"
  // and "Quote". The Quote option is rendered as an anchor pointing to
  // /compose/post inside a role=menu container.
  quoteMenuOption: '[role="menu"] a[href="/compose/post"]',
  // Delete: main tweet's three-dot menu, then the confirmation modal.
  caretMain: 'article[data-testid="tweet"] [data-testid="caret"]',
  menu: '[role="menu"]',
  confirmDelete: '[data-testid="confirmationSheetConfirm"]',
  // Thread: "+" button inside the composer toolbar. Scoped to the
  // modal dialog — /compose/post on a background tab renders the
  // composer as a dialog overlay with a stale duplicate of
  // tweetTextarea_0RichTextInputContainer also present in the DOM
  // behind it, so unscoped selectors can hit the wrong instance.
  addButton: '[role="dialog"] [data-testid="toolBar"] [data-testid="addButton"]',
} as const

export interface WriteResult {
  success: boolean
  tweetId?: string
  error?: string
  durationMs: number
}

/** Poll until submit is both aria-enabled AND no progress circle is
 *  still animating on the attachments. X briefly un-disables the submit
 *  button during video upload's intermediate state (upload done, transcode
 *  pending) — clicking then makes /CreateTweet a no-op. Requiring BOTH
 *  signals avoids the flicker. Logs a progress snapshot when it changes. */
async function waitUntilClickableWithProgress(
  targetId: string,
  selector: string,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let lastSnapshot = ''
  let stableReadings = 0
  while (Date.now() < deadline) {
    const state = await evalExpr<{
      clickable: boolean
      hasProgress: boolean
      progressLabel: string | null
      attachments: number
    }>(
      targetId,
      `(function(){
        const btn = document.querySelector(${JSON.stringify(selector)});
        const clickable = !!btn && btn.getAttribute('aria-disabled') !== 'true' && !btn.hasAttribute('disabled');
        // Media-specific progress only. The footer's char-counter is also
        // role=progressbar but always present — we must NOT match it.
        const circles = document.querySelectorAll('[data-testid="attachments"] [data-testid="dual-phase-countdown-circle"]');
        let progressLabel = null;
        for (const c of circles) {
          const a = c.getAttribute('aria-valuenow') || c.getAttribute('aria-label');
          if (a) { progressLabel = a; break; }
          const t = (c.textContent || '').trim();
          if (t) { progressLabel = t; break; }
        }
        const attachments = document.querySelectorAll('[data-testid="attachments"] img, [data-testid="attachments"] video').length;
        return { clickable, hasProgress: circles.length > 0, progressLabel, attachments };
      })()`,
    )
    const ready = state.clickable && !state.hasProgress
    if (ready) {
      stableReadings += 1
      // Require 2 consecutive ready readings (~1s) to filter out flicker.
      if (stableReadings >= 2) {
        console.log(`[debugger] submit stable (attachments=${state.attachments})`)
        return
      }
    } else {
      stableReadings = 0
    }
    const snap = `attachments=${state.attachments} clickable=${state.clickable} hasProgress=${state.hasProgress} progress=${state.progressLabel ?? 'n/a'}`
    if (snap !== lastSnapshot) {
      console.log(`[debugger] ${snap}`)
      lastSnapshot = snap
    }
    await sleep(500)
  }
  throw new Error(`timed out waiting for stable clickable state on ${selector}`)
}

/** Wait until N unique media_ids reach the "ready" state via the
 *  `/media/upload.json` chunked protocol:
 *    - image: single upload call, response has media_id_string, no
 *      processing_info → ready immediately
 *    - video: INIT → APPEND(s) → FINALIZE (processing_info.state=
 *      'pending'|'in_progress') → STATUS polls until 'succeeded'
 *  We listen to every response and track unique media_ids that reach
 *  ready state. Dumps progress_percent to console for visibility.
 *  This is strictly better than DOM polling — it's X's authoritative
 *  server-side signal, not a UI flicker proxy. */
function waitForMediaReady(
  target: AttachedTarget,
  expectedCount: number,
  timeoutMs: number,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const ready = new Set<string>()
    const lastProgress = new Map<string, number>()
    let settled = false
    const cleanup = registerEventListener(target.targetId, async (method, raw) => {
      if (settled || method !== 'Network.responseReceived') return
      const p = raw as { requestId: string; response: { url: string; status: number } }
      const url = p?.response?.url || ''
      if (!url.includes('/media/upload')) return
      try {
        const body = await debuggerSend<{ body: string; base64Encoded: boolean }>(
          target.targetId,
          'Network.getResponseBody',
          { requestId: p.requestId },
        )
        const text = body.base64Encoded ? atob(body.body) : body.body
        if (!text) return
        let json: Record<string, unknown>
        try {
          json = JSON.parse(text)
        } catch {
          return
        }
        const idRaw = (json.media_id_string ?? json.media_id) as string | number | undefined
        if (idRaw === undefined) return
        const mediaId = String(idRaw)
        const info = json.processing_info as
          | { state?: string; progress_percent?: number; error?: { message?: string } }
          | undefined
        if (!info) {
          ready.add(mediaId)
          console.log(`[debugger][upload] ${mediaId} ready (image path)`)
        } else if (info.state === 'succeeded') {
          ready.add(mediaId)
          console.log(`[debugger][upload] ${mediaId} succeeded`)
        } else if (info.state === 'failed') {
          settled = true
          cleanup()
          reject(
            new Error(
              `media ${mediaId} failed: ${info.error?.message || JSON.stringify(info)}`,
            ),
          )
          return
        } else {
          const pct = info.progress_percent ?? 0
          if (lastProgress.get(mediaId) !== pct) {
            lastProgress.set(mediaId, pct)
            console.log(`[debugger][upload] ${mediaId} ${info.state} ${pct}%`)
          }
        }
        if (ready.size >= expectedCount) {
          settled = true
          cleanup()
          resolve()
        }
      } catch {
        // Swallow — body may be unreachable for some requests.
      }
    })
    setTimeout(() => {
      if (settled) return
      settled = true
      cleanup()
      reject(
        new Error(
          `timed out waiting for media ready (${ready.size}/${expectedCount} succeeded)`,
        ),
      )
    }, timeoutMs)
  })
}

function extractTweetId(input: string): string | null {
  const trimmed = input.trim()
  if (/^\d+$/.test(trimmed)) return trimmed
  const match = /\/status\/(\d+)/.exec(trimmed)
  return match ? match[1] : null
}

interface CreateTweetResponse {
  data?: {
    create_tweet?: {
      tweet_results?: {
        result?: { rest_id?: string }
      }
    }
  }
}

// ============ Reply ============

export interface ReplyArgs {
  tweetUrl: string
  text: string
  mediaPaths?: string[]
  /** Kept for CLI signature compatibility — pool visibility is managed
   *  by scraperService (minimized window) regardless. */
  visible?: boolean
}

export async function replyViaDebugger(args: ReplyArgs): Promise<WriteResult> {
  const started = Date.now()
  const tweetId = extractTweetId(args.tweetUrl)
  if (!tweetId) {
    return {
      success: false,
      error: `cannot parse tweet id from ${args.tweetUrl}`,
      durationMs: 0,
    }
  }
  let restore: (() => Promise<void>) | null = null
  try {
    const target = await prepareTab(`https://x.com/i/status/${tweetId}`)
    // Unminimize + focus the automation window — Chrome throttles input
    // event dispatch for hidden/minimized windows, which breaks React's
    // aria-disabled state update on the submit button after we type.
    restore = await bringTabToFront(target.tabId)
    await waitForSelector(target.targetId, SEL.replyTextarea, 15_000)
    await jitter(400, 900)

    await focusAndType(target.targetId, SEL.replyTextarea, args.text)
    await jitter(250, 500)

    if (args.mediaPaths && args.mediaPaths.length > 0) {
      const readyPromise = waitForMediaReady(target, args.mediaPaths.length, 180_000)
      await setFileInputFiles(target.targetId, SEL.fileInput, args.mediaPaths)
      await readyPromise
      await waitForSelector(target.targetId, SEL.attachmentsReady, 10_000)
      await jitter(400, 800)
    }

    // Arm response listener before clicking submit.
    const responsePromise = waitForJsonResponse<CreateTweetResponse>(
      target,
      '/CreateTweet',
      25_000,
    )
    const submitSel = await waitForAnySelector(
      target.targetId,
      [SEL.submitInline, SEL.submitModal],
      5_000,
    )
    await waitUntilClickableWithProgress(target.targetId, submitSel, 120_000)
    await clickSelector(target.targetId, submitSel)

    const body = await responsePromise
    const createdId = body?.data?.create_tweet?.tweet_results?.result?.rest_id
    return { success: true, tweetId: createdId, durationMs: Date.now() - started }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - started,
    }
  } finally {
    if (restore) await restore().catch(() => {})
  }
}

// ============ Post ============

export interface PostArgs {
  text: string
  mediaPaths?: string[]
  visible?: boolean
}

export async function postViaDebugger(args: PostArgs): Promise<WriteResult> {
  const started = Date.now()
  let restore: (() => Promise<void>) | null = null
  try {
    const target = await prepareTab('https://x.com/compose/post')
    // Unminimize + focus — Chrome throttles input dispatch on hidden
    // windows, which leaves the submit button aria-disabled after typing.
    restore = await bringTabToFront(target.tabId)
    await waitForSelector(target.targetId, SEL.replyTextarea, 15_000)
    await jitter(400, 900)

    await focusAndType(target.targetId, SEL.replyTextarea, args.text)
    await jitter(250, 500)

    if (args.mediaPaths && args.mediaPaths.length > 0) {
      const readyPromise = waitForMediaReady(target, args.mediaPaths.length, 180_000)
      await setFileInputFiles(target.targetId, SEL.fileInput, args.mediaPaths)
      await readyPromise
      await waitForSelector(target.targetId, SEL.attachmentsReady, 10_000)
      await jitter(400, 800)
    }

    const responsePromise = waitForJsonResponse<CreateTweetResponse>(
      target,
      '/CreateTweet',
      25_000,
    )
    const submitSel = await waitForAnySelector(
      target.targetId,
      [SEL.submitModal, SEL.submitInline],
      5_000,
    )
    // For video, X keeps submit disabled until transcode completes.
    // Poll + log progress.
    await waitUntilClickableWithProgress(target.targetId, submitSel, 120_000)
    await clickSelector(target.targetId, submitSel)

    const body = await responsePromise
    const createdId = body?.data?.create_tweet?.tweet_results?.result?.rest_id
    return { success: true, tweetId: createdId, durationMs: Date.now() - started }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - started,
    }
  } finally {
    if (restore) await restore().catch(() => {})
  }
}

// ============ Like / Unlike ============

/** `mode`:
 *   - `like`    — ensure tweet is liked; no-op if already liked.
 *   - `unlike`  — ensure tweet is NOT liked; no-op if already unliked.
 *   - `toggle`  — flip whichever state it's in. */
export type LikeMode = 'like' | 'unlike' | 'toggle'

export interface LikeArgs {
  tweetUrl: string
  mode?: LikeMode
  /** Legacy — `toggle: true` kept equivalent to `mode: 'toggle'`. */
  toggle?: boolean
  visible?: boolean
}

export async function likeViaDebugger(args: LikeArgs): Promise<WriteResult> {
  const started = Date.now()
  const mode: LikeMode = args.mode ?? (args.toggle ? 'toggle' : 'like')
  const tweetId = extractTweetId(args.tweetUrl)
  if (!tweetId) {
    return {
      success: false,
      error: `cannot parse tweet id from ${args.tweetUrl}`,
      durationMs: 0,
    }
  }
  try {
    const target = await prepareTab(`https://x.com/i/status/${tweetId}`)
    const hit = await waitForAnySelector(
      target.targetId,
      [SEL.likeBtn, SEL.likeActive],
      10_000,
    )
    const currentlyLiked = hit === SEL.likeActive
    const wantsLiked =
      mode === 'like' ? true : mode === 'unlike' ? false : !currentlyLiked
    if (currentlyLiked === wantsLiked) {
      return { success: true, tweetId, durationMs: Date.now() - started }
    }
    const responsePromise = waitForJsonResponse<unknown>(
      target,
      currentlyLiked ? '/UnfavoriteTweet' : '/FavoriteTweet',
      15_000,
    )
    await jitter(200, 500)
    await clickSelector(target.targetId, hit)
    await responsePromise
    return { success: true, tweetId, durationMs: Date.now() - started }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - started,
    }
  }
}

// ============ Retweet / Unretweet ============

export type RetweetMode = 'retweet' | 'unretweet' | 'toggle'

export interface RetweetArgs {
  tweetUrl: string
  mode?: RetweetMode
  toggle?: boolean
  visible?: boolean
}

export async function retweetViaDebugger(args: RetweetArgs): Promise<WriteResult> {
  const started = Date.now()
  const mode: RetweetMode =
    args.mode ?? (args.toggle ? 'toggle' : 'retweet')
  const tweetId = extractTweetId(args.tweetUrl)
  if (!tweetId) {
    return {
      success: false,
      error: `cannot parse tweet id from ${args.tweetUrl}`,
      durationMs: 0,
    }
  }
  try {
    const target = await prepareTab(`https://x.com/i/status/${tweetId}`)
    const hit = await waitForAnySelector(
      target.targetId,
      [SEL.retweetBtn, SEL.retweetActive],
      10_000,
    )
    const currentlyRetweeted = hit === SEL.retweetActive
    const wantsRetweeted =
      mode === 'retweet'
        ? true
        : mode === 'unretweet'
          ? false
          : !currentlyRetweeted
    if (currentlyRetweeted === wantsRetweeted) {
      return { success: true, tweetId, durationMs: Date.now() - started }
    }
    const responsePromise = waitForJsonResponse<unknown>(
      target,
      currentlyRetweeted ? '/DeleteRetweet' : '/CreateRetweet',
      15_000,
    )
    await jitter(200, 500)
    await clickSelector(target.targetId, hit)
    // After clicking, X shows a menu. For retweet we confirm on
    // `retweetConfirm`; for unretweet we confirm on `unretweetConfirm`.
    const confirmSelector = currentlyRetweeted
      ? SEL.unretweetConfirm
      : SEL.retweetConfirm
    await waitForSelector(target.targetId, confirmSelector, 5_000)
    await jitter(150, 350)
    await clickSelector(target.targetId, confirmSelector)
    await responsePromise
    return { success: true, tweetId, durationMs: Date.now() - started }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - started,
    }
  }
}

// ============ Quote Tweet ============

export interface QuoteArgs {
  tweetUrl: string
  text: string
  mediaPaths?: string[]
  visible?: boolean
}

/** Quote tweet flow:
 *    1. Navigate to the tweet
 *    2. Click the retweet button → dropdown menu appears
 *    3. Click the "Quote" option (<a href="/compose/post">)
 *       → X redirects to the full composer with the original tweet embedded
 *    4. Type the user's text via Input.insertText
 *    5. Optionally attach media
 *    6. Submit & wait for the CreateTweet GraphQL response
 */
export async function quoteViaDebugger(args: QuoteArgs): Promise<WriteResult> {
  const started = Date.now()
  const tweetId = extractTweetId(args.tweetUrl)
  if (!tweetId) {
    return {
      success: false,
      error: `cannot parse tweet id from ${args.tweetUrl}`,
      durationMs: 0,
    }
  }
  let restore: (() => Promise<void>) | null = null
  try {
    const target = await prepareTab(`https://x.com/i/status/${tweetId}`)
    // Unminimize + focus — input dispatch on hidden windows is throttled,
    // breaking React's submit-button state after typing.
    restore = await bringTabToFront(target.tabId)

    // 1. Find retweet / unretweet button (either works for opening menu).
    const rtBtn = await waitForAnySelector(
      target.targetId,
      [SEL.retweetBtn, SEL.retweetActive],
      10_000,
    )
    await jitter(200, 500)
    await clickSelector(target.targetId, rtBtn)

    // 2. Click "Quote" option in dropdown → composer opens.
    await waitForSelector(target.targetId, SEL.quoteMenuOption, 5_000)
    await jitter(150, 350)
    await clickSelector(target.targetId, SEL.quoteMenuOption)

    // 3. Composer is ready — textarea mounted with the quoted tweet
    //    embedded as a "card" below the input.
    await waitForSelector(target.targetId, SEL.replyTextarea, 15_000)
    await jitter(400, 900)
    await focusAndType(target.targetId, SEL.replyTextarea, args.text)
    await jitter(250, 500)

    if (args.mediaPaths && args.mediaPaths.length > 0) {
      const readyPromise = waitForMediaReady(target, args.mediaPaths.length, 180_000)
      await setFileInputFiles(target.targetId, SEL.fileInput, args.mediaPaths)
      await readyPromise
      await waitForSelector(target.targetId, SEL.attachmentsReady, 10_000)
      await jitter(400, 800)
    }

    const responsePromise = waitForJsonResponse<CreateTweetResponse>(
      target,
      '/CreateTweet',
      25_000,
    )
    const submitSel = await waitForAnySelector(
      target.targetId,
      [SEL.submitModal, SEL.submitInline],
      5_000,
    )
    await waitUntilClickableWithProgress(target.targetId, submitSel, 120_000)
    await clickSelector(target.targetId, submitSel)

    const body = await responsePromise
    const createdId = body?.data?.create_tweet?.tweet_results?.result?.rest_id
    return { success: true, tweetId: createdId, durationMs: Date.now() - started }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - started,
    }
  } finally {
    if (restore) await restore().catch(() => {})
  }
}

// ============ Thread ============

export interface ThreadTweet {
  text: string
  mediaPaths?: string[]
}

export interface ThreadArgs {
  tweets: ThreadTweet[]
  visible?: boolean
}

export interface ThreadResult extends WriteResult {
  /** rest_id of the ROOT tweet (the first one). Subsequent replies'
   *  ids are not returned — X batches them on submit and we only wait
   *  for the first response to avoid coupling to N outbound requests. */
  rootId?: string
  count?: number
}

/** Thread flow:
 *    1. Open compose/post
 *    2. For each tweet:
 *       - focus tweetTextarea_i and type its text
 *       - if media, setFileInputFiles + wait attachments ready
 *       - if not last, click addButton inside dialog toolbar, then
 *         wait for tweetTextarea_{i+1} to mount
 *    3. Click submit (the modal button sends the whole chain)
 *    4. Wait for the first /CreateTweet response — that's the root id. */
export async function postThreadViaDebugger(args: ThreadArgs): Promise<ThreadResult> {
  const started = Date.now()
  const tweets = args.tweets
  if (!Array.isArray(tweets) || tweets.length === 0) {
    return { success: false, error: 'tweets array is empty', durationMs: 0 }
  }
  let restore: (() => Promise<void>) | null = null
  try {
    const target = await prepareTab('https://x.com/compose/post')
    restore = await bringTabToFront(target.tabId)
    await waitForSelector(target.targetId, SEL.replyTextarea, 15_000)
    await jitter(400, 900)

    for (let i = 0; i < tweets.length; i++) {
      const t = tweets[i]
      const containerSel = `[role="dialog"] [data-testid="tweetTextarea_${i}RichTextInputContainer"]`
      const textareaSel = `[role="dialog"] [data-testid="tweetTextarea_${i}"]`
      await waitForSelector(target.targetId, containerSel, 10_000)
      // Click the container first — X lazy-mounts the inner contenteditable
      // on interaction for slots i>0. Clicking the container triggers it.
      if (i > 0) {
        await clickSelector(target.targetId, containerSel)
        await sleep(150)
      }
      await waitForSelector(target.targetId, textareaSel, 5_000)
      await focusAndType(target.targetId, textareaSel, t.text)
      await jitter(200, 400)

      if (t.mediaPaths && t.mediaPaths.length > 0) {
        // Multiple textareas can coexist in the dialog, so we scope the
        // file input to the current slot. X renders one fileInput per
        // active tweet slot — the last one matches the current index.
        const readyPromise = waitForMediaReady(target, t.mediaPaths.length, 180_000)
        await setFileInputFiles(target.targetId, SEL.fileInput, t.mediaPaths)
        await readyPromise
        await waitForSelector(target.targetId, SEL.attachmentsReady, 10_000)
        await jitter(400, 800)
      }

      if (i < tweets.length - 1) {
        await waitForSelector(target.targetId, SEL.addButton, 5_000)
        // Use trusted mouse events — X's addButton only responds to
        // real user clicks, not synthesized .click().
        await trustedClickSelector(target.targetId, SEL.addButton)
        await waitForSelector(
          target.targetId,
          `[role="dialog"] [data-testid="tweetTextarea_${i + 1}RichTextInputContainer"]`,
          10_000,
        )
        await jitter(300, 600)
      }
    }

    const responsePromise = waitForJsonResponse<CreateTweetResponse>(
      target,
      '/CreateTweet',
      25_000,
    )
    const submitSel = await waitForAnySelector(
      target.targetId,
      [SEL.submitModal, SEL.submitInline],
      5_000,
    )
    await waitUntilClickableWithProgress(target.targetId, submitSel, 120_000)
    await clickSelector(target.targetId, submitSel)
    const body = await responsePromise
    const rootId = body?.data?.create_tweet?.tweet_results?.result?.rest_id
    return {
      success: true,
      rootId,
      tweetId: rootId,
      count: tweets.length,
      durationMs: Date.now() - started,
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - started,
    }
  } finally {
    if (restore) await restore().catch(() => {})
  }
}

// ============ Delete ============

export interface DeleteArgs {
  tweetUrl: string
  visible?: boolean
}

/** Delete flow:
 *    1. Navigate to the tweet detail page
 *    2. Click the three-dot menu on the main tweet (article caret)
 *    3. Find the "Delete/删除" menu item by text content and click it
 *    4. Confirm via confirmationSheetConfirm
 *    5. Wait for /DeleteTweet GraphQL response
 */
export async function deleteViaDebugger(args: DeleteArgs): Promise<WriteResult> {
  const started = Date.now()
  const tweetId = extractTweetId(args.tweetUrl)
  if (!tweetId) {
    return {
      success: false,
      error: `cannot parse tweet id from ${args.tweetUrl}`,
      durationMs: 0,
    }
  }
  try {
    const target = await prepareTab(`https://x.com/i/status/${tweetId}`)
    await waitForSelector(target.targetId, SEL.caretMain, 10_000)
    await jitter(200, 500)
    await clickSelector(target.targetId, SEL.caretMain)

    await waitForSelector(target.targetId, SEL.menu, 5_000)
    // Find the menu item containing "delete" or "删除" and click it by
    // dispatching el.click() — we can't rely on a stable data-testid for
    // this entry (X rotates them).
    const clicked = await evalExpr<boolean>(
      target.targetId,
      `(function(){const items=document.querySelectorAll('[role="menuitem"]');for(const el of items){const t=(el.textContent||'').toLowerCase();if(t.includes('delete')||t.includes('删除')){el.click();return true;}}return false;})()`,
    )
    if (!clicked) {
      throw new Error('delete menu item not found — not your tweet?')
    }

    const responsePromise = waitForJsonResponse<unknown>(
      target,
      '/DeleteTweet',
      15_000,
    )
    await waitForSelector(target.targetId, SEL.confirmDelete, 5_000)
    await jitter(200, 400)
    await clickSelector(target.targetId, SEL.confirmDelete)
    await responsePromise
    return { success: true, tweetId, durationMs: Date.now() - started }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - started,
    }
  }
}

export { sleep }
