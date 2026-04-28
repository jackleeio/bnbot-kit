/**
 * `bnbot tiktok post` — upload a video to TikTok Studio and fill in
 * caption / privacy / schedule fields.
 *
 * 🚫 INTENTIONALLY DOES NOT CLICK "发布" BY DEFAULT. TikTok has no
 * native draft mode — once 发布 is clicked the video is live. The CLI
 * stops at the filled-form state and tells the user to review +
 * manually click 发布 in the browser. Opt-in `publish: true` requires
 * a `scheduleAt` ISO date so even authorized publish goes through
 * 预约发布 (allows abort within the window).
 *
 * Plan JSON shape:
 *   {
 *     "videoPath":  "/abs/path/to/video.mp4",   // required
 *     "caption":    "正文 with #hashtag emoji etc",
 *     "privacy":    "public" | "friends" | "private",  // default: leave current
 *     "publish":    false,           // default false
 *     "scheduleAt": "2026-05-30T10:00"  // ISO local; required if publish=true
 *   }
 */
import { readFileSync, existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import WebSocket from 'ws'
import { ensureServer } from '../cli'

const DEFAULT_PORT = 18900
const ACTION_TIMEOUT_MS = 120_000
const HOST = 'tiktok.com'
const UPLOAD_URL = 'https://www.tiktok.com/tiktokstudio/upload'

export interface TiktokPostPlan {
  videoPath: string
  caption?: string
  /** Search keyword for adding background music. CLI types this into
   *  the music panel's search box, presses Enter, then clicks the +
   *  button on the first result. The music gets layered onto the
   *  uploaded video; the original sound stays as primary unless the
   *  user mutes it manually. Pass empty string to skip music step. */
  music?: string
  privacy?: 'public' | 'friends' | 'private'
  publish?: boolean
  scheduleAt?: string
}

interface TiktokPostArgs {
  inline?: string
  plan?: string
}

export async function tiktokPostCommand(opts: TiktokPostArgs): Promise<void> {
  const raw = opts.inline ?? readPlanFromArgOrStdin(opts.plan)
  let plan: TiktokPostPlan
  try {
    plan = JSON.parse(raw)
  } catch (err) {
    console.error(`[bnbot tiktok post] plan is not valid JSON: ${(err as Error).message}`)
    process.exit(2)
  }

  if (!plan.videoPath || !existsSync(plan.videoPath)) {
    console.error(`[bnbot tiktok post] videoPath required and must exist: ${plan.videoPath}`)
    process.exit(2)
  }
  if (plan.publish && !plan.scheduleAt) {
    console.error(`[bnbot tiktok post] publish:true requires scheduleAt (ISO date) — TikTok has no draft, force-publish blocked for safety`)
    process.exit(2)
  }

  await ensureServer(DEFAULT_PORT)
  const start = Date.now()
  const result = await runPost(plan)
  const elapsed = ((Date.now() - start) / 1000).toFixed(2)
  console.log(JSON.stringify(result, null, 2))
  console.log(`⏱  ${elapsed}s`)
}

function readPlanFromArgOrStdin(planArg?: string): string {
  const src = planArg || '-'
  return src === '-' ? readFileSync(0, 'utf8') : readFileSync(src, 'utf8')
}

async function runPost(plan: TiktokPostPlan): Promise<Record<string, unknown>> {
  const summary: Record<string, unknown> = { steps: [] as string[] }
  const log = (s: string) => (summary.steps as string[]).push(s)

  // 1. Make sure we're on the upload page.
  const tabId = await ensureUploadPage()
  log('upload-page:ready')

  // 2. Inject the video file into the page <input type=file>.
  await uploadVideo(tabId, plan.videoPath)
  log('video:uploaded')

  // 3. Wait for the upload-success state — UI swaps to the form view
  //    showing 视频描述 / 封面 / 设置 sections.
  await waitFor(tabId, `document.body.innerText.includes('已上传') && document.querySelector('[role=combobox][contenteditable=true]')`, 60_000)
  log('upload:processed')

  // 4. Fill caption (overrides the file-stem default).
  if (plan.caption !== undefined) {
    await setCaption(tabId, plan.caption)
    log('caption:set')
  }

  // 4.5. Add background music if requested.
  if (plan.music && plan.music.trim()) {
    const ok = await addMusic(tabId, plan.music.trim())
    log(ok ? `music:added (${plan.music})` : 'music:not-found')
  }

  // (TODO) privacy / scheduleAt — wired but not yet implemented because
  // those toggles need separate exploration of TikTok's combobox API.
  // The `publish:false` default means we never need them yet.

  // 5. Final state snapshot. Critical: we DO NOT click 发布.
  summary.finalState = await evalJs(
    tabId,
    `(() => {
      const counts = document.body.innerText.match(/(\\d+)\\/4000/);
      const pubBtn = [...document.querySelectorAll('button')].find(b => (b.innerText||'').trim() === '发布' && b.offsetParent !== null);
      return JSON.stringify({
        url: location.href,
        pageReady: document.body.innerText.includes('已上传'),
        captionCharCount: counts ? counts[0] : null,
        publishBtnEnabled: pubBtn ? !pubBtn.disabled : false
      });
    })()`,
  )

  if (plan.publish && plan.scheduleAt) {
    summary.scheduleNotImplemented = true
    log('publish:scheduleAt-not-yet-implemented')
  } else {
    log('publish:skipped (manual click required)')
  }

  return summary
}

// ── Atomic primitives ───────────────────────────────────────────

let cachedTabId: number | undefined

async function ensureUploadPage(): Promise<number> {
  // ALWAYS navigate fresh — TikTok stays on the post-upload form when
  // we re-enter, and the file input only shows on the pristine upload
  // page. Cache buster forces a clean nav even if the SPA detects same
  // route.
  const target = `${UPLOAD_URL}?reset=${Date.now()}`
  const result = (await sendAction('navigate_to_url', { url: target })) as { tabId?: number }
  if (typeof result?.tabId !== 'number') throw new Error('navigate did not return tabId')
  cachedTabId = result.tabId

  // First-load dialog handling. Two distinct dialogs may appear:
  //   - "过往编辑的视频未保存。继续编辑？" (carry over a previous draft)
  //     → click 放弃 to start fresh
  //   - "放弃此次发布？" (NEVER click 放弃 here; user warned us)
  //     → click 暂时不要 to keep current
  // Identify by looking at the dialog's question text rather than just
  // hitting the first button labelled 放弃.
  await sleep(2000)
  await evalJs(cachedTabId, `(() => {
    const txt = document.body.innerText || '';
    if (txt.includes('放弃此次发布')) {
      // Don't trash the in-progress upload — keep it.
      const keep = [...document.querySelectorAll('button, div[role=button]')].find(b => (b.innerText||'').trim() === '暂时不要' && b.offsetParent !== null);
      keep?.click();
    } else if (txt.includes('过往编辑的视频未保存') || txt.includes('继续编辑')) {
      // Discard the carry-over so the upload page renders fresh.
      const discard = [...document.querySelectorAll('button, div[role=button]')].find(b => (b.innerText||'').trim() === '放弃' && b.offsetParent !== null);
      discard?.click();
    }
    return true;
  })()`)
  // Wait for upload page DOM (file input).
  await waitFor(cachedTabId, `!!document.querySelector('input[type=file][accept^="video"]')`, 30_000)
  return cachedTabId
}

async function uploadVideo(tabId: number, videoPath: string): Promise<void> {
  await sendAction('debug_set_files', {
    selector: 'input[type=file][accept^="video"]',
    files: [videoPath],
    tabId,
  })
}

/**
 * Add a background music track to the uploaded video.
 *
 * Flow (validated 2026-04-28):
 *  1. Click the 音乐 card (button[data-button-name="sounds"]) — opens
 *     the music side-panel with a search box and a Recommended list.
 *  2. Type the search keyword into input[placeholder="搜索音乐"], dispatch
 *     input + Enter to trigger the actual search (without Enter only
 *     suggestions appear, not real song results).
 *  3. Click the "+" button on the first .MusicPanelMusicItem__wrap row.
 *     This routes through React's onClick — needs the full
 *     pointer/mouse event chain, like other weui-desktop-style buttons.
 *
 * Success signal: the right-side audio panel renders the song title
 * + a "音量 / 淡入和淡出" sub-panel, and the page no longer says only
 * "原声 - <user>".
 *
 * Returns false when no song row appears within the timeout — caller
 * can decide to bail or just log.
 */
async function addMusic(tabId: number, query: string): Promise<boolean> {
  // 1. Open music panel.
  const opened = (await evalJs(
    tabId,
    `(() => {
      const btn = document.querySelector('button[data-button-name="sounds"]');
      if (!btn) return false;
      ['pointerdown','mousedown','pointerup','mouseup','click'].forEach(t =>
        btn.dispatchEvent(new MouseEvent(t, { bubbles:true, cancelable:true, view:window, button:0, buttons:1, detail:1 }))
      );
      return true;
    })()`,
  )) as boolean
  if (!opened) return false

  // Wait for the search box to mount.
  await waitFor(
    tabId,
    `!![...document.querySelectorAll('input')].find(el => el.placeholder === '搜索音乐' && el.offsetParent !== null)`,
    10_000,
  )

  // 2. Type query + press Enter.
  await evalJs(
    tabId,
    `(() => {
      const inp = [...document.querySelectorAll('input')].find(el => el.placeholder === '搜索音乐' && el.offsetParent !== null);
      if (!inp) return false;
      inp.focus();
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(inp), 'value')?.set;
      setter ? setter.call(inp, ${JSON.stringify(query)}) : (inp.value = ${JSON.stringify(query)});
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
      inp.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
      return true;
    })()`,
  )

  // 3. Wait for search results, then click + on the first row.
  const hasResult = await waitForOrFalse(
    tabId,
    `!!document.querySelector('.MusicPanelMusicItem__wrap .MusicPanelMusicItem__operation button')`,
    15_000,
  )
  if (!hasResult) return false

  await evalJs(
    tabId,
    `(() => {
      const btn = document.querySelector('.MusicPanelMusicItem__wrap .MusicPanelMusicItem__operation button');
      if (!btn) return false;
      ['pointerdown','mousedown','pointerup','mouseup','click'].forEach(t =>
        btn.dispatchEvent(new MouseEvent(t, { bubbles:true, cancelable:true, view:window, button:0, buttons:1, detail:1 }))
      );
      return true;
    })()`,
  )

  // 4. Confirm: the audio editor panel ("音量 / 淡入和淡出") shows up.
  const added = await waitForOrFalse(
    tabId,
    `document.body.innerText.includes('音量') && document.body.innerText.includes('淡入')`,
    8_000,
  )
  if (!added) return false

  // 5. CRITICAL: the music is only previewed until 保存 is clicked. The
  //    button is in the top-right of the editing chrome (button text
  //    just "保存"). Without this step the music silently reverts when
  //    we leave the music panel — a bug for any caller expecting the
  //    final video to actually have the new track.
  await evalJs(
    tabId,
    `(() => {
      const btn = [...document.querySelectorAll('button')].find(b => (b.innerText||'').trim() === '保存' && b.offsetParent !== null);
      if (!btn) return false;
      ['pointerdown','mousedown','pointerup','mouseup','click'].forEach(t =>
        btn.dispatchEvent(new MouseEvent(t, { bubbles:true, cancelable:true, view:window, button:0, buttons:1, detail:1 }))
      );
      return true;
    })()`,
  )
  // After 保存, the music side-panel closes and the main form view
  // returns. Wait for that transition so the caller's next step (e.g.
  // setCaption follow-ups, finalState query) sees a stable DOM.
  await waitForOrFalse(
    tabId,
    `!document.querySelector('input[placeholder="搜索音乐"]')`,
    10_000,
  )
  return true
}

async function waitForOrFalse(tabId: number, boolExpr: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const r = await evalJs(tabId, `!!(${boolExpr})`)
    if (r === true) return true
    await sleep(300)
  }
  return false
}

async function setCaption(tabId: number, caption: string): Promise<void> {
  // Caption editor is a ProseMirror-like contenteditable div with
  // role=combobox. execCommand('insertText') and direct innerText
  // assignment both no-op because React filters them. The trick that
  // works (verified empirically) is the same one we use on 微信 MP:
  // ClipboardEvent('paste') with a DataTransfer carrying text/plain.
  // PM's paste handler accepts that as legit user input and updates
  // both DOM and React state.
  await evalJs(tabId, `(() => {
    const ed = document.querySelector('[role=combobox][contenteditable=true]');
    if (!ed) return false;
    ed.focus();
    // Clear existing content first.
    const sel = window.getSelection();
    sel.selectAllChildren(ed);
    document.execCommand('delete', false);
    // Now paste the new caption.
    const dt = new DataTransfer();
    dt.setData('text/plain', ${JSON.stringify(caption)});
    const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
    ed.dispatchEvent(ev);
    return true;
  })()`)
}

// ── Low-level helpers ───────────────────────────────────────────

async function evalJs(tabId: number, expr: string): Promise<unknown> {
  const result = (await sendAction('debug_eval', { expression: expr, tabId })) as {
    result?: unknown
  }
  const raw = result?.result
  if (typeof raw !== 'string') return raw
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

async function waitFor(tabId: number, boolExpr: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const r = await evalJs(tabId, `!!(${boolExpr})`)
    if (r === true) return
    await sleep(300)
  }
  throw new Error(`waitFor timeout after ${timeoutMs}ms: ${boolExpr.slice(0, 120)}`)
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms))
}

function sendAction(actionType: string, payload: Record<string, unknown>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${DEFAULT_PORT}`)
    const requestId = randomUUID()
    let done = false
    const timer = setTimeout(() => {
      if (done) return
      done = true
      ws.close()
      reject(new Error(`${actionType} timed out after ${ACTION_TIMEOUT_MS / 1000}s`))
    }, ACTION_TIMEOUT_MS)
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'cli_action', requestId, actionType, actionPayload: payload }))
    })
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString())
        if (msg.requestId !== requestId || msg.type !== 'action_result') return
        clearTimeout(timer)
        done = true
        ws.close()
        if (!msg.success) {
          reject(new Error(msg.error || `${actionType} failed`))
          return
        }
        resolve(msg.data)
      } catch (err) {
        if (done) return
        done = true
        clearTimeout(timer)
        ws.close()
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    })
    ws.on('error', (err) => {
      if (done) return
      done = true
      clearTimeout(timer)
      reject(err)
    })
    ws.on('close', () => {
      if (done) return
      done = true
      clearTimeout(timer)
      reject(new Error(`WS closed before ${actionType} result`))
    })
  })
}
