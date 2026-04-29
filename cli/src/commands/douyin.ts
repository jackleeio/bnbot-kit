/**
 * `bnbot douyin post` — upload a video to 抖音创作者中心 + fill the
 * publish form.
 *
 * 🚫 INTENTIONALLY DOES NOT CLICK "发布" BY DEFAULT. Douyin DOES have
 * a draft mode ("暂存离开" button) which is safer than TikTok/Kuaishou —
 * pass `saveDraft: true` to commit to draft + leave the editor; that's
 * still abortable from the user's drafts list.
 *
 * Plan JSON:
 *   {
 *     "videoPath":  "/abs/path/to/video.mp4",
 *     "caption":    "正文 #话题",
 *     "saveDraft":  false   // default: leave form filled, user clicks
 *                            // 暂存离开 / 发布 manually
 *   }
 *
 * Mechanics: same blob path as Kuaishou — Douyin's hidden file input
 * also ignores plain setFileInputFiles. Reading the file as base64 and
 * reconstructing it in page context via DataTransfer +
 * Object.defineProperty produces a real React onChange + uploads to
 * Douyin's CDN.
 */
import { readFileSync, existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import WebSocket from 'ws'
import { ensureServer } from '../cli'

const DEFAULT_PORT = 18900
const ACTION_TIMEOUT_MS = 180_000
const HOST = 'creator.douyin.com'
const UPLOAD_URL = 'https://creator.douyin.com/creator-micro/content/upload'

export interface DouyinPostPlan {
  videoPath: string
  /** 标题 — input[placeholder="填写作品标题..."]. Hard 30-char limit
   *  enforced server-side (UI shows 0/30 counter). Excess gets truncated. */
  title?: string
  /** 简介 — the contenteditable rich-text area below title. Up to 1000
   *  chars. Hashtags inside this body are clickable on Douyin. */
  description?: string
  /** Hashtags to add via the #添加话题 toolbar (preferred over inlining
   *  in description because the toolbar wires them up to topic search +
   *  trending boost). Each entry is just the topic name without `#`. */
  hashtags?: string[]
  /** 自主声明 — Douyin's mandatory-for-some-categories self-declaration
   *  dropdown. Pass the visible option label, e.g. "无需声明" /
   *  "AI 生成" / "原创" — depends on the user's account category. */
  selfDeclaration?: string
  /** Save as 抖音 draft (clicks 暂存离开 — leaves the editor + the draft
   *  shows up in 内容管理). Safer than letting the user accidentally
   *  click 发布. */
  saveDraft?: boolean
  /** [LEGACY] Old single-text-field input. Maps to `description` for
   *  backward compat. Prefer `title` + `description` explicitly. */
  caption?: string
}

interface DouyinPostArgs {
  inline?: string
  plan?: string
}

export async function douyinPostCommand(opts: DouyinPostArgs): Promise<void> {
  const raw = opts.inline ?? readPlanFromArgOrStdin(opts.plan)
  let plan: DouyinPostPlan
  try {
    plan = JSON.parse(raw)
  } catch (err) {
    console.error(`[bnbot douyin post] plan is not valid JSON: ${(err as Error).message}`)
    process.exit(2)
  }
  if (!plan.videoPath || !existsSync(plan.videoPath)) {
    console.error(`[bnbot douyin post] videoPath required and must exist: ${plan.videoPath}`)
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

async function runPost(plan: DouyinPostPlan): Promise<Record<string, unknown>> {
  const summary: Record<string, unknown> = { steps: [] as string[] }
  const log = (s: string) => (summary.steps as string[]).push(s)

  // 1. Navigate to upload page.
  const tabId = await ensureUploadPage()
  log('upload-page:ready')

  // 2. Read video → base64 → blob inject.
  const path = await import('node:path')
  const fileBuf = readFileSync(plan.videoPath)
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

  // 3. Wait for the page to navigate from /upload → /post/video — that's
  //    Douyin's signal that file processing finished and the publish
  //    form is ready.
  await waitFor(
    tabId,
    `location.href.includes('/content/post/video') && !!document.querySelector('[contenteditable=true]')`,
    120_000,
  )
  log('upload:processed')

  // 4a. Title (作品标题, 30 char input).
  if (plan.title) {
    await setTitle(tabId, plan.title)
    log('title:set')
  }

  // 4b. Description (作品简介, 1000 char rich text). Append hashtags
  //     directly into the body — Douyin auto-parses `#topic ` runs into
  //     clickable hashtag chips on submit. The toolbar's #添加话题 button
  //     interferes with the existing description content, so we just
  //     concatenate. Backward compat: legacy `caption` maps here too.
  const baseDesc = plan.description ?? plan.caption ?? ''
  const tagSuffix = plan.hashtags && plan.hashtags.length > 0
    ? '\n' + plan.hashtags.map((t) => `#${t} `).join('')
    : ''
  const fullDesc = baseDesc + tagSuffix
  if (fullDesc) {
    await setDescription(tabId, fullDesc)
    log(plan.hashtags?.length ? `description+hashtags:set (${plan.hashtags.length})` : 'description:set')
  }

  // 4d. Self-declaration dropdown (自主声明 — required for some content
  //     categories, e.g. AI-generated content disclosure).
  if (plan.selfDeclaration) {
    const ok = await setSelfDeclaration(tabId, plan.selfDeclaration)
    log(ok ? `self-declaration:set (${plan.selfDeclaration})` : 'self-declaration:option-not-found')
  }

  // 5. Optionally click 暂存离开 to commit as draft.
  if (plan.saveDraft) {
    const ok = await clickDraftAndLeave(tabId)
    log(ok ? 'draft:saved+left' : 'draft:save-not-found')
  }

  // 6. Final state.
  summary.finalState = await evalJs(
    tabId,
    `(() => {
      const cap = document.querySelector('[contenteditable=true]');
      const pubBtn = [...document.querySelectorAll('button')].find(b => (b.innerText||'').trim() === '发布' && b.offsetParent !== null);
      const draftBtn = [...document.querySelectorAll('button')].find(b => (b.innerText||'').trim() === '暂存离开' && b.offsetParent !== null);
      return JSON.stringify({
        url: location.href,
        captionPreview: cap?.innerText?.slice(0, 200) ?? null,
        publishBtnEnabled: pubBtn ? !pubBtn.disabled : false,
        draftBtnEnabled: draftBtn ? !draftBtn.disabled : false,
      });
    })()`,
  )

  if (!plan.saveDraft) log('publish:skipped (manual click required)')
  return summary
}

let cachedTabId: number | undefined

async function ensureUploadPage(): Promise<number> {
  // Always navigate fresh to /upload — if we hit /post/video (already
  // in form view) blob inject would target a different DOM. Cache buster
  // in case SPA detects same route.
  const result = (await sendAction('navigate_to_url', {
    url: `${UPLOAD_URL}?reset=${Date.now()}`,
  })) as { tabId?: number }
  if (typeof result?.tabId !== 'number') throw new Error('navigate did not return tabId')
  cachedTabId = result.tabId
  await waitFor(
    cachedTabId,
    `!!document.querySelector('input[type=file]') && document.body.innerText.includes('上传视频')`,
    30_000,
  )
  return cachedTabId
}

async function setTitle(tabId: number, title: string): Promise<void> {
  // Plain text input. React-controlled — must use the native value
  // setter to bypass React's controlled-input filter.
  await evalJs(
    tabId,
    `(() => {
      const inp = [...document.querySelectorAll('input')].find(el => el.placeholder?.includes('作品标题') && el.offsetParent !== null);
      if (!inp) return false;
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(inp), 'value')?.set;
      setter ? setter.call(inp, ${JSON.stringify(title)}) : (inp.value = ${JSON.stringify(title)});
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      inp.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`,
  )
}

async function setDescription(tabId: number, description: string): Promise<void> {
  // 简介 contenteditable. Same paste trick as TikTok / 微信 MP — Douyin's
  // editor is TipTap-based; React state intercept rejects direct
  // textContent assignment but accepts ClipboardEvent('paste') text/plain.
  await evalJs(
    tabId,
    `(() => {
      const eds = [...document.querySelectorAll('[contenteditable=true]')].filter(el => el.offsetParent !== null);
      // Pick the LARGER editor (taller rect → that's the description body,
      // not the inline title on a different page section).
      const ed = eds.sort((a,b) => b.getBoundingClientRect().height - a.getBoundingClientRect().height)[0];
      if (!ed) return false;
      ed.focus();
      const sel = window.getSelection();
      sel.selectAllChildren(ed);
      document.execCommand('delete', false);
      const dt = new DataTransfer();
      dt.setData('text/plain', ${JSON.stringify(description)});
      ed.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      return true;
    })()`,
  )
}

/**
 * Add a hashtag via the #添加话题 toolbar button.
 *
 * Flow:
 *  1. Click the #添加话题 toolbar button (.toolbar-button-spPS4r whose
 *     innerText starts with `#`). That triggers a `#` insertion at the
 *     cursor position + opens a topic-suggestion dropdown.
 *  2. Type the topic name into the description editor (continuation of
 *     the # token).
 *  3. The first dropdown item is the matched/created topic — click it
 *     so it commits as a styled #topic chip rather than raw text.
 *
 * If the dropdown doesn't render (network slow / topic too obscure),
 * the raw `#topic ` text still ends up in the body, which Douyin
 * accepts as a hashtag on submit.
 */
async function addHashtag(tabId: number, topic: string): Promise<boolean> {
  // Click the toolbar # button + then insert the topic name as text.
  await evalJs(
    tabId,
    `(() => {
      const btn = [...document.querySelectorAll('.toolbar-button-spPS4r')].find(el => el.innerText?.trim().startsWith('#'));
      if (!btn) return false;
      ['pointerdown','mousedown','pointerup','mouseup','click'].forEach(t =>
        btn.dispatchEvent(new MouseEvent(t, { bubbles:true, cancelable:true, view:window, button:0, buttons:1, detail:1 }))
      );
      return true;
    })()`,
  )
  await sleep(500)
  // Type the topic name.
  await evalJs(
    tabId,
    `(() => {
      const eds = [...document.querySelectorAll('[contenteditable=true]')].filter(el => el.offsetParent !== null);
      const ed = eds.sort((a,b) => b.getBoundingClientRect().height - a.getBoundingClientRect().height)[0];
      if (!ed) return false;
      ed.focus();
      const dt = new DataTransfer();
      dt.setData('text/plain', ${JSON.stringify(topic + ' ')});
      ed.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      return true;
    })()`,
  )
  await sleep(800)
  // Try to click the first dropdown item to commit as styled chip.
  const committed = (await evalJs(
    tabId,
    `(() => {
      const item = document.querySelector('.semi-dropdown-item, [class*=topicItem], [class*=tag-item]');
      if (!item || !item.offsetParent) return false;
      ['pointerdown','mousedown','pointerup','mouseup','click'].forEach(t =>
        item.dispatchEvent(new MouseEvent(t, { bubbles:true, cancelable:true, view:window, button:0, buttons:1, detail:1 }))
      );
      return true;
    })()`,
  )) as boolean
  return committed || true // raw text fallback is fine
}

/**
 * Pick an option in the 自主声明 modal.
 *
 * Douyin's "自主声明" 看起来像 select 但实际是个 .semi-modal:
 *   click .selectBox-buZRzi
 *   → modal opens with radio list (label.semi-radio per option) +
 *     取消 / 确定 buttons
 *   → click the matching <label> radio
 *   → click 确定 to commit
 *
 * Available option labels (verified 2026-04-28):
 *   内容由AI生成 / 内容为个人观点或见解 / 内容为转载信息 /
 *   内容含营销推广信息 / 虚构演绎，仅供娱乐 / 危险行为，请勿模仿 /
 *   可能引人不适 / 无需添加自主声明
 */
async function setSelfDeclaration(tabId: number, optionLabel: string): Promise<boolean> {
  // 1. Open the modal by clicking .selectBox under 自主声明 section.
  const opened = (await evalJs(
    tabId,
    `(() => {
      const labels = [...document.querySelectorAll('.title-cnbkZe')].filter(el => el.innerText?.trim() === '自主声明');
      const label = labels[0];
      if (!label) return false;
      const wrapper = label.closest('section, .wrapper-MLZdnB') || label.parentElement?.parentElement;
      const selectBox = wrapper?.querySelector('.selectBox-buZRzi');
      if (!selectBox) return false;
      ['pointerdown','mousedown','pointerup','mouseup','click'].forEach(t =>
        selectBox.dispatchEvent(new MouseEvent(t, { bubbles:true, cancelable:true, view:window, button:0, buttons:1, detail:1 }))
      );
      return true;
    })()`,
  )) as boolean
  if (!opened) return false
  // The modal radio list lives inside `.semi-portal` (Semi UI portal-mounts
  // modals at <body> level, detached from the .semi-modal trigger origin).
  // Match against label.semi-radio anywhere on the page that is visible
  // and contains "请选择声明类型" in its modal ancestor.
  await waitForOrFalse(
    tabId,
    `!!document.querySelector('label.semi-radio')`,
    8_000,
  )

  // 2. Pick the matching radio. The label's innerText concatenates a
  //    radio dot + the option name (e.g. "内容由AI生成" only). Match
  //    by trimmed innerText; if there are multiple matches across stale
  //    portals, take the visible one with the largest bounding box.
  const picked = (await evalJs(
    tabId,
    `(() => {
      const labels = [...document.querySelectorAll('label.semi-radio')].filter(el => el.offsetParent !== null);
      const target = labels.find(el => (el.innerText || '').trim() === ${JSON.stringify(optionLabel)});
      if (!target) {
        return JSON.stringify({ ok: false, available: labels.map(l => (l.innerText||'').trim()) });
      }
      ['pointerdown','mousedown','pointerup','mouseup','click'].forEach(t =>
        target.dispatchEvent(new MouseEvent(t, { bubbles:true, cancelable:true, view:window, button:0, buttons:1, detail:1 }))
      );
      return JSON.stringify({ ok: true });
    })()`,
  )) as { ok?: boolean; available?: string[] } | string
  const parsed = typeof picked === 'string' ? JSON.parse(picked) : picked
  if (!parsed?.ok) {
    // Cancel modal so the page is left in a clean state.
    await evalJs(
      tabId,
      `(() => {
        // 取消 lives inside the modal too.
        const buttons = [...document.querySelectorAll('button')].filter(b => b.offsetParent !== null);
        const cancelBtn = buttons.find(b => (b.innerText||'').trim() === '取消');
        cancelBtn?.click();
        return true;
      })()`,
    )
    return false
  }

  // 3. Click 确定 to commit. Same global query (modal portal).
  await sleep(300)
  await evalJs(
    tabId,
    `(() => {
      const buttons = [...document.querySelectorAll('button')].filter(b => b.offsetParent !== null && !b.disabled);
      const okBtn = buttons.find(b => (b.innerText||'').trim() === '确定');
      if (!okBtn) return false;
      ['pointerdown','mousedown','pointerup','mouseup','click'].forEach(t =>
        okBtn.dispatchEvent(new MouseEvent(t, { bubbles:true, cancelable:true, view:window, button:0, buttons:1, detail:1 }))
      );
      return true;
    })()`,
  )
  // Wait for modal close (radio list goes away).
  return await waitForOrFalse(
    tabId,
    `![...document.querySelectorAll('label.semi-radio')].some(el => el.offsetParent !== null)`,
    5_000,
  )
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

async function clickDraftAndLeave(tabId: number): Promise<boolean> {
  // "暂存离开" — clicking this saves the draft and navigates away from
  // the editor. It's Douyin's only explicit-draft action; there's no
  // "save without leaving". Caller wants drafts that can be reviewed
  // later from 内容管理.
  const clicked = (await evalJs(
    tabId,
    `(() => {
      const btn = [...document.querySelectorAll('button')].find(b => (b.innerText||'').trim() === '暂存离开' && b.offsetParent !== null && !b.disabled);
      if (!btn) return false;
      ['pointerdown','mousedown','pointerup','mouseup','click'].forEach(t =>
        btn.dispatchEvent(new MouseEvent(t, { bubbles:true, cancelable:true, view:window, button:0, buttons:1, detail:1 }))
      );
      return true;
    })()`,
  )) as boolean
  if (!clicked) return false
  // Confirm: page navigates away from /post/video.
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const url = (await evalJs(tabId, 'location.href')) as string
    if (typeof url === 'string' && !url.includes('/post/video')) return true
    await sleep(500)
  }
  return false
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
