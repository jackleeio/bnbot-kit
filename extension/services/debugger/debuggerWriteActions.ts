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
  bringTabToFront,
  clickSelector,
  evalExpr,
  focusAndType,
  jitter,
  prepareTab,
  setFileInputFiles,
  sleep,
  waitForAnySelector,
  waitForJsonResponse,
  waitForSelector,
} from './debuggerOps'

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
} as const

export interface WriteResult {
  success: boolean
  tweetId?: string
  error?: string
  durationMs: number
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
      await setFileInputFiles(target.targetId, SEL.fileInput, args.mediaPaths)
      await waitForSelector(target.targetId, SEL.attachmentsReady, 30_000)
      await jitter(600, 1200)
    }

    // Arm response listener before clicking submit.
    const responsePromise = waitForJsonResponse<CreateTweetResponse>(
      target,
      '/CreateTweet',
      20_000,
    )
    const submitSel = await waitForAnySelector(
      target.targetId,
      [SEL.submitInline, SEL.submitModal],
      5_000,
    )
    const clickable = await evalExpr<boolean>(
      target.targetId,
      `(function(){const el=document.querySelector(${JSON.stringify(submitSel)});return !!el && el.getAttribute('aria-disabled') !== 'true';})()`,
    )
    if (!clickable) throw new Error('submit button not clickable')
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
      await setFileInputFiles(target.targetId, SEL.fileInput, args.mediaPaths)
      await waitForSelector(target.targetId, SEL.attachmentsReady, 30_000)
      await jitter(800, 1500)
    }

    const responsePromise = waitForJsonResponse<CreateTweetResponse>(
      target,
      '/CreateTweet',
      20_000,
    )
    const submitSel = await waitForAnySelector(
      target.targetId,
      [SEL.submitModal, SEL.submitInline],
      5_000,
    )
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
      await setFileInputFiles(target.targetId, SEL.fileInput, args.mediaPaths)
      await waitForSelector(target.targetId, SEL.attachmentsReady, 30_000)
      await jitter(600, 1200)
    }

    const responsePromise = waitForJsonResponse<CreateTweetResponse>(
      target,
      '/CreateTweet',
      20_000,
    )
    const submitSel = await waitForAnySelector(
      target.targetId,
      [SEL.submitModal, SEL.submitInline],
      5_000,
    )
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
