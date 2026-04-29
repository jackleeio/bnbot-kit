/**
 * `bnbot wxchannels post` — upload a video to 微信视频号 (channels.weixin.qq.com)
 * + fill the publish form.
 *
 * 🚫 INTENTIONALLY DOES NOT CLICK "发表" BY DEFAULT. Use `saveDraft: true`
 * to commit to draft (草稿箱),or just leave the form filled for the
 * user to review and click 发表 manually.
 *
 * Plan JSON:
 *   {
 *     "videoPath":     "/abs/path/to/video.mp4",
 *     "description":   "正文 #话题 @朋友",       // 视频描述, 1000 char
 *     "shortTitle":    "短标题(6-16 字)",         // 短标题 input
 *     "original":      true,                       // 声明原创 toggle
 *     "saveDraft":     false                       // 不点 发表/保存草稿,
 *                                                  // 留 form 给 user
 *   }
 *
 * Mechanics that are unique to 视频号 (different from抖音/快手/TikTok):
 *  - The whole publish form lives in a same-origin <iframe> (the outer
 *    page is just nav chrome). All selectors must be queried against
 *    iframe.contentDocument. We use the extension's blob action with
 *    `iframe ::: <selector>` syntax.
 *  - The description editor is `<div contenteditable="" class="input-editor">`
 *    — note the empty contenteditable attr (not "true"), so the usual
 *    [contenteditable=true] selector misses it.
 *  - 视频号 has a real "保存草稿" button that stays on the editor (unlike
 *    抖音's 暂存离开 which navigates away). Cleaner draft path.
 */
import { readFileSync, existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import WebSocket from 'ws'
import { ensureServer } from '../cli'

const DEFAULT_PORT = 18900
const ACTION_TIMEOUT_MS = 180_000
const HOST = 'channels.weixin.qq.com'
const UPLOAD_URL = 'https://channels.weixin.qq.com/platform/post/create'
const IFRAME_SEL = 'iframe'

export interface WxChannelsPostPlan {
  videoPath: string
  /** 视频描述 — `.input-editor` contenteditable. Up to 1000 chars; can
   *  embed `#topic` and `@friend` runs which Channels parses on submit. */
  description?: string
  /** 短标题 — `input[placeholder^="概括视频"]`. Limit 6-16 chars per the
   *  on-screen hint, but server enforces a separate cap. */
  shortTitle?: string
  /** 声明原创 toggle. Sets the originality declaration so the post earns
   *  the 原创 badge + ad revenue eligibility. */
  original?: boolean
  /** Click 保存草稿 to commit as a real draft (stays on editor). */
  saveDraft?: boolean
}

interface WxChannelsPostArgs {
  inline?: string
  plan?: string
}

export async function wxchannelsPostCommand(opts: WxChannelsPostArgs): Promise<void> {
  const raw = opts.inline ?? readPlanFromArgOrStdin(opts.plan)
  let plan: WxChannelsPostPlan
  try {
    plan = JSON.parse(raw)
  } catch (err) {
    console.error(`[bnbot wxchannels post] plan is not valid JSON: ${(err as Error).message}`)
    process.exit(2)
  }
  if (!plan.videoPath || !existsSync(plan.videoPath)) {
    console.error(`[bnbot wxchannels post] videoPath required and must exist: ${plan.videoPath}`)
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

async function runPost(plan: WxChannelsPostPlan): Promise<Record<string, unknown>> {
  const summary: Record<string, unknown> = { steps: [] as string[] }
  const log = (s: string) => (summary.steps as string[]).push(s)

  // 1. Open the upload page. The outer page mounts nav chrome instantly
  //    but the iframe (which carries the form) takes a tick — wait
  //    until we can read the file input from iframe.contentDocument.
  const tabId = await ensureUploadPage()
  log('upload-page:ready')

  // 2. Inject video via the blob path with iframe-aware selector.
  const path = await import('node:path')
  const fileBuf = readFileSync(plan.videoPath)
  const base64 = fileBuf.toString('base64')
  const fileName = path.basename(plan.videoPath)
  const mimeType = guessMimeFromExt(fileName)
  const blobResult = (await sendAction('debug_set_files_via_blob', {
    selector: `${IFRAME_SEL} ::: input[type=file]`,
    fileName,
    mimeType,
    base64,
    tabId,
  })) as { filesAfter?: number }
  log(`video:uploaded (filesAfter=${blobResult.filesAfter})`)

  // 3. Wait for upload to finish (取消上传 button disappears + form
  //    fields render). Channels reuploads the bytes to its CDN — can be
  //    slow on bigger files.
  await waitFor(
    tabId,
    `(() => {
      const f = document.querySelector(${JSON.stringify(IFRAME_SEL)});
      if (!f?.contentDocument) return false;
      const txt = f.contentDocument.body?.innerText || '';
      return !txt.includes('取消上传') && !!f.contentDocument.querySelector('.input-editor');
    })()`,
    180_000,
  )
  log('upload:processed')

  // 4. 视频描述
  if (plan.description) {
    await setDescription(tabId, plan.description)
    log('description:set')
  }

  // 5. 短标题
  if (plan.shortTitle) {
    await setShortTitle(tabId, plan.shortTitle)
    log('short-title:set')
  }

  // 6. 声明原创 toggle
  if (plan.original) {
    const ok = await toggleOriginal(tabId)
    log(ok ? 'original:enabled' : 'original:toggle-not-found')
  }

  // 7. Optional: 保存草稿
  if (plan.saveDraft) {
    const ok = await clickSaveDraft(tabId)
    log(ok ? 'draft:saved' : 'draft:button-not-found')
  }

  // 8. Final state.
  summary.finalState = await evalJs(
    tabId,
    `(() => {
      const f = document.querySelector(${JSON.stringify(IFRAME_SEL)});
      if (!f?.contentDocument) return JSON.stringify({err: 'no iframe'});
      const fdoc = f.contentDocument;
      const ed = fdoc.querySelector('.input-editor');
      const titleInp = fdoc.querySelector('input[placeholder^="概括视频"]');
      const pubBtn = [...fdoc.querySelectorAll('button')].find(b => (b.innerText||'').trim() === '发表' && b.offsetParent !== null);
      const draftBtn = [...fdoc.querySelectorAll('button')].find(b => (b.innerText||'').trim() === '保存草稿' && b.offsetParent !== null);
      return JSON.stringify({
        url: location.href,
        descriptionPreview: ed?.innerText?.slice(0, 200) ?? null,
        shortTitle: titleInp?.value?.slice(0, 30) ?? null,
        publishBtnEnabled: pubBtn ? !pubBtn.classList.contains('weui-desktop-btn_disabled') : false,
        draftBtnEnabled: draftBtn ? !draftBtn.classList.contains('weui-desktop-btn_disabled') : false,
      });
    })()`,
  )

  if (!plan.saveDraft) log('publish:skipped (manual click required)')
  return summary
}

let cachedTabId: number | undefined

async function ensureUploadPage(): Promise<number> {
  const result = (await sendAction('navigate_to_url', {
    url: `${UPLOAD_URL}?reset=${Date.now()}`,
  })) as { tabId?: number }
  if (typeof result?.tabId !== 'number') throw new Error('navigate did not return tabId')
  cachedTabId = result.tabId
  // Wait for the iframe to mount + have a file input inside it.
  await waitFor(
    cachedTabId,
    `(() => {
      const f = document.querySelector(${JSON.stringify(IFRAME_SEL)});
      return !!f?.contentDocument?.querySelector('input[type=file]');
    })()`,
    30_000,
  )
  // Channels' SPA may show a "发表视频" gate button instead of the form
  // directly. If we're not on the create form yet, click the gate.
  await evalJs(
    cachedTabId,
    `(() => {
      const f = document.querySelector(${JSON.stringify(IFRAME_SEL)});
      const fdoc = f?.contentDocument;
      if (!fdoc) return false;
      const gate = [...fdoc.querySelectorAll('button')].find(b => (b.innerText||'').trim() === '发表视频' && b.offsetParent !== null);
      gate?.click();
      return true;
    })()`,
  )
  return cachedTabId
}

async function setDescription(tabId: number, description: string): Promise<void> {
  await evalJs(
    tabId,
    `(() => {
      const f = document.querySelector(${JSON.stringify(IFRAME_SEL)});
      const fdoc = f?.contentDocument;
      const ed = fdoc?.querySelector('.input-editor');
      if (!ed) return false;
      ed.focus();
      const sel = f.contentWindow.getSelection();
      sel.selectAllChildren(ed);
      fdoc.execCommand('delete', false);
      const dt = new DataTransfer();
      dt.setData('text/plain', ${JSON.stringify(description)});
      ed.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      return true;
    })()`,
  )
}

async function setShortTitle(tabId: number, shortTitle: string): Promise<void> {
  await evalJs(
    tabId,
    `(() => {
      const f = document.querySelector(${JSON.stringify(IFRAME_SEL)});
      const fdoc = f?.contentDocument;
      const inp = fdoc?.querySelector('input[placeholder^="概括视频"]');
      if (!inp) return false;
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(inp), 'value')?.set;
      setter ? setter.call(inp, ${JSON.stringify(shortTitle)}) : (inp.value = ${JSON.stringify(shortTitle)});
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      inp.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`,
  )
}

/**
 * Toggle 声明原创. The widget is a checkbox-shaped switch under the
 * "声明原创" label. Click anywhere on the labelled row.
 */
async function toggleOriginal(tabId: number): Promise<boolean> {
  return (await evalJs(
    tabId,
    `(() => {
      const f = document.querySelector(${JSON.stringify(IFRAME_SEL)});
      const fdoc = f?.contentDocument;
      if (!fdoc) return false;
      const lbl = [...fdoc.querySelectorAll('*')].find(el => el.children.length < 4 && (el.innerText||'').trim() === '声明原创' && el.offsetParent !== null);
      if (!lbl) return false;
      // The row container has the click handler. Walk up until a clickable.
      let target = lbl;
      for (let i = 0; i < 4 && target.parentElement; i++) {
        const cls = target.parentElement.className?.toString() || '';
        if (/declare|original|switch|checkbox|toggle/i.test(cls)) {
          target = target.parentElement;
          break;
        }
        target = target.parentElement;
      }
      ['pointerdown','mousedown','pointerup','mouseup','click'].forEach(t =>
        target.dispatchEvent(new MouseEvent(t, { bubbles:true, cancelable:true, view:f.contentWindow, button:0, buttons:1, detail:1 }))
      );
      return true;
    })()`,
  )) as boolean
}

async function clickSaveDraft(tabId: number): Promise<boolean> {
  const clicked = (await evalJs(
    tabId,
    `(() => {
      const f = document.querySelector(${JSON.stringify(IFRAME_SEL)});
      const fdoc = f?.contentDocument;
      if (!fdoc) return false;
      const btn = [...fdoc.querySelectorAll('button')].find(b => (b.innerText||'').trim() === '保存草稿' && b.offsetParent !== null && !b.classList.contains('weui-desktop-btn_disabled'));
      if (!btn) return false;
      ['pointerdown','mousedown','pointerup','mouseup','click'].forEach(t =>
        btn.dispatchEvent(new MouseEvent(t, { bubbles:true, cancelable:true, view:f.contentWindow, button:0, buttons:1, detail:1 }))
      );
      return true;
    })()`,
  )) as boolean
  if (!clicked) return false
  // Server commit is async; brief wait for any toast / state change.
  await sleep(2000)
  return true
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
    default:
      return 'video/mp4'
  }
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
