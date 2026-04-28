/**
 * `bnbot kuaishou post` — upload a video to Kuaishou Creator + fill
 * caption.
 *
 * 🚫 INTENTIONALLY DOES NOT CLICK "发布" BY DEFAULT. Same posture as
 * `bnbot tiktok post` — user must review and click 发布 manually.
 *
 * Plan JSON:
 *   {
 *     "videoPath":  "/abs/path/to/video.mp4",
 *     "caption":    "正文 with #话题"
 *   }
 *
 * Mechanics differ from TikTok in one critical way: Kuaishou's hidden
 * <input type=file> doesn't react to direct setFileInputFiles — its
 * React onChange listener is keyed to OS file-dialog events, not to
 * mutations on input.files. So we use the chooser-intercept path
 * (`debug_set_files_via_chooser`): tell Chrome to swallow the OS dialog,
 * click the visible 上传视频 wrapper button, capture the
 * Page.fileChooserOpened event, then attach files via the captured
 * backendNodeId. That's the same trick Puppeteer's setInputFiles uses.
 */
import { readFileSync, existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import WebSocket from 'ws'
import { ensureServer } from '../cli'

const DEFAULT_PORT = 18900
const ACTION_TIMEOUT_MS = 120_000
const HOST = 'cp.kuaishou.com'
const UPLOAD_URL = 'https://cp.kuaishou.com/article/publish/video'

export interface KuaishouPostPlan {
  videoPath: string
  caption?: string
}

interface KuaishouPostArgs {
  inline?: string
  plan?: string
}

export async function kuaishouPostCommand(opts: KuaishouPostArgs): Promise<void> {
  const raw = opts.inline ?? readPlanFromArgOrStdin(opts.plan)
  let plan: KuaishouPostPlan
  try {
    plan = JSON.parse(raw)
  } catch (err) {
    console.error(`[bnbot kuaishou post] plan is not valid JSON: ${(err as Error).message}`)
    process.exit(2)
  }
  if (!plan.videoPath || !existsSync(plan.videoPath)) {
    console.error(`[bnbot kuaishou post] videoPath required and must exist: ${plan.videoPath}`)
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

async function runPost(plan: KuaishouPostPlan): Promise<Record<string, unknown>> {
  const summary: Record<string, unknown> = { steps: [] as string[] }
  const log = (s: string) => (summary.steps as string[]).push(s)

  // 1. Navigate to upload page (always fresh — Kuaishou doesn't reset).
  const tabId = await ensureUploadPage()
  log('upload-page:ready')

  // 2. Read video file → base64, then inject via blob path.
  //    Kuaishou's React file input ignores both `setFileInputFiles` and
  //    chooser-intercept (input.files stays 0 immediately after the CDP
  //    call). The blob path reconstructs the File in page context and
  //    forces it onto the input via Object.defineProperty +
  //    DataTransfer, which React picks up via the synthetic change event.
  const fs = await import('node:fs')
  const path = await import('node:path')
  const fileBuf = fs.readFileSync(plan.videoPath)
  const base64 = fileBuf.toString('base64')
  const fileName = path.basename(plan.videoPath)
  const mimeType = guessMimeFromExt(fileName)
  const blobResult = (await sendAction('debug_set_files_via_blob', {
    selector: 'input[type=file]',
    fileName,
    mimeType,
    base64,
    tabId,
  })) as { filesAfter?: number }
  log(`video:uploaded (filesAfter=${blobResult.filesAfter})`)

  // 3. Wait for upload to settle. Kuaishou shows "上传中" then "上传完成"
  //    in the DOM — wait for either the form fields or a clear marker.
  await waitFor(
    tabId,
    `(() => {
      const t = document.body.innerText;
      return t.includes('上传完成') || t.includes('视频简介') || !!document.querySelector('[contenteditable=true], textarea[placeholder*=简介]');
    })()`,
    120_000,
  )
  log('upload:processed')

  // 4. Fill caption if provided. Selector exploration TBD — try the
  //    common patterns; if neither works, the user just fills it in
  //    the browser.
  if (plan.caption) {
    const ok = (await evalJs(
      tabId,
      `(() => {
        const ed = document.querySelector('[contenteditable=true], textarea[placeholder*=简介], textarea[placeholder*=描述]');
        if (!ed) return false;
        ed.focus();
        if (ed.tagName === 'TEXTAREA') {
          const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(ed), 'value')?.set;
          setter ? setter.call(ed, ${JSON.stringify(plan.caption)}) : (ed.value = ${JSON.stringify(plan.caption)});
          ed.dispatchEvent(new Event('input', { bubbles: true }));
          ed.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
          const sel = window.getSelection();
          sel.selectAllChildren(ed);
          document.execCommand('delete', false);
          const dt = new DataTransfer();
          dt.setData('text/plain', ${JSON.stringify(plan.caption)});
          ed.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
        }
        return true;
      })()`,
    )) as boolean
    log(ok ? 'caption:set' : 'caption:editor-not-found')
  }

  // 5. Final state — never click 发布.
  summary.finalState = await evalJs(
    tabId,
    `(() => ({
      url: location.href,
      bodyTextSlice: document.body.innerText.slice(0, 400),
      hasPublishBtn: !![...document.querySelectorAll('button')].find(b => (b.innerText||'').trim() === '发布' && b.offsetParent !== null),
    }))()`,
  )
  log('publish:skipped (manual click required)')

  return summary
}

function guessMimeFromExt(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'mp4':
    case 'm4v':
      return 'video/mp4'
    case 'mov':
      return 'video/quicktime'
    case 'webm':
      return 'video/webm'
    case 'avi':
      return 'video/x-msvideo'
    case 'mkv':
      return 'video/x-matroska'
    default:
      return 'video/mp4'
  }
}

let cachedTabId: number | undefined

async function ensureUploadPage(): Promise<number> {
  const result = (await sendAction('navigate_to_url', { url: UPLOAD_URL })) as { tabId?: number }
  if (typeof result?.tabId !== 'number') throw new Error('navigate did not return tabId')
  cachedTabId = result.tabId
  await waitFor(
    cachedTabId,
    `!!document.querySelector('input[type=file]') && !!document.querySelector('[class*=_upload-btn_]')`,
    30_000,
  )
  return cachedTabId
}

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
    await sleep(500)
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
