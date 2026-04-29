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
  /** Hashtags appended into 视频描述 as `#tag` runs. Channels parses them
   *  into clickable topic chips on submit. */
  hashtags?: string[]
  /** 短标题 — `input[placeholder^="概括视频"]`. Limit 6-16 chars per the
   *  on-screen hint, but server enforces a separate cap. */
  shortTitle?: string
  /** 声明原创 — toggles the original-content declaration. Channels gates
   *  this behind a "原创权益" dialog: tick the agreement checkbox + click
   *  the "声明原创" primary button. */
  original?: boolean
  /** Add to a 合集 (Channels playlist). String = collection name; if no
   *  matching collection exists the CLI clicks "创建新合集" and creates
   *  one with that name. Up to 10 chars per the on-screen counter. */
  collection?: string
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

  // 4b. Hashtags — added as real chips via the 话题 button so Channels
  //     parses them as topic links (not raw `#text`).
  if (plan.hashtags?.length) {
    for (const tag of plan.hashtags) {
      const cleaned = tag.replace(/^#/, '').trim()
      if (!cleaned) continue
      const ok = await addHashtag(tabId, cleaned)
      log(ok ? `hashtag:${cleaned}:added` : `hashtag:${cleaned}:fallback-text`)
    }
  }

  // 5. 短标题
  if (plan.shortTitle) {
    await setShortTitle(tabId, plan.shortTitle)
    log('short-title:set')
  }

  // 5b. 合集 — pick existing or create new with this name.
  if (plan.collection) {
    const r = await setCollection(tabId, plan.collection)
    log(`collection:${r}`)
  }

  // 6. 声明原创 — opens "原创权益" dialog, must tick agreement + click 声明原创.
  if (plan.original) {
    const r = await declareOriginal(tabId)
    log(`original:${r}`)
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
 * Add a hashtag chip via the 话题 button. Channels has a real autocomplete
 * dropdown; selecting the first item turns the term into a clickable
 * topic chip embedded in the description editor.
 */
async function addHashtag(tabId: number, tag: string): Promise<boolean> {
  // 1. Click the 话题 button to open the autocomplete inside the editor.
  const opened = (await evalJs(
    tabId,
    `(() => {
      const f = document.querySelector(${JSON.stringify(IFRAME_SEL)});
      const fdoc = f?.contentDocument;
      if (!fdoc) return false;
      const ed = fdoc.querySelector('.input-editor');
      if (!ed) return false;
      ed.focus();
      // Place caret at end so the # marker appends after current text.
      const sel = f.contentWindow.getSelection();
      const range = fdoc.createRange();
      range.selectNodeContents(ed);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
      const btn = fdoc.querySelector('.finder-tag-wrap.btn') ||
                  [...fdoc.querySelectorAll('.btn,div')].find(b => (b.innerText||'').trim() === '#话题' && b.offsetParent !== null);
      if (!btn) return false;
      ['pointerdown','mousedown','pointerup','mouseup','click'].forEach(t =>
        btn.dispatchEvent(new MouseEvent(t, { bubbles:true, cancelable:true, view:f.contentWindow, button:0, buttons:1, detail:1 }))
      );
      return true;
    })()`,
  )) as boolean
  if (!opened) return false

  // 2. Type the tag text into the editor — the # marker just got inserted
  //    by the button, our text appends after it and triggers autocomplete.
  await sleep(300)
  await evalJs(
    tabId,
    `(() => {
      const f = document.querySelector(${JSON.stringify(IFRAME_SEL)});
      const fdoc = f?.contentDocument;
      const ed = fdoc?.querySelector('.input-editor');
      if (!ed) return false;
      ed.focus();
      const dt = new DataTransfer();
      dt.setData('text/plain', ${JSON.stringify(tag)});
      ed.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      return true;
    })()`,
  )

  // 3. Wait for autocomplete dropdown, then click first item. If it doesn't
  //    appear within ~3s assume the tag is brand-new and create-on-the-fly
  //    by pressing Enter.
  const picked = await (async () => {
    const deadline = Date.now() + 3000
    while (Date.now() < deadline) {
      const r = (await evalJs(
        tabId,
        `(() => {
          const f = document.querySelector(${JSON.stringify(IFRAME_SEL)});
          const fdoc = f?.contentDocument;
          if (!fdoc) return false;
          const item = fdoc.querySelector('.tag-list .tag-item, .topic-list .topic-item, .finder-tag-list .item, .common-popover-list .item');
          if (!item || item.offsetParent === null) return false;
          ['pointerdown','mousedown','pointerup','mouseup','click'].forEach(t =>
            item.dispatchEvent(new MouseEvent(t, { bubbles:true, cancelable:true, view:f.contentWindow, button:0, buttons:1, detail:1 }))
          );
          return true;
        })()`,
      )) as boolean
      if (r) return true
      await sleep(200)
    }
    return false
  })()

  if (!picked) {
    // Fall back: press Enter to commit as a brand-new tag chip.
    await evalJs(
      tabId,
      `(() => {
        const f = document.querySelector(${JSON.stringify(IFRAME_SEL)});
        const fdoc = f?.contentDocument;
        const ed = fdoc?.querySelector('.input-editor');
        if (!ed) return false;
        const evInit = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
        ed.dispatchEvent(new KeyboardEvent('keydown', evInit));
        ed.dispatchEvent(new KeyboardEvent('keypress', evInit));
        ed.dispatchEvent(new KeyboardEvent('keyup', evInit));
        return true;
      })()`,
    )
  }
  await sleep(200)
  return true
}

/**
 * Pick a 合集 by name. If no existing collection matches, click 创建新合集
 * and create one with that name.
 *
 * Flow:
 *  - Click `.post-album-display` to open the dropdown.
 *  - Look for an existing list item whose text === name; click it.
 *  - Else click `.filter-wrap .create a` (创建新合集), fill the dialog
 *    input, click 创建.
 */
async function setCollection(tabId: number, name: string): Promise<string> {
  // 1. Open dropdown.
  const opened = (await evalJs(
    tabId,
    `(() => {
      const f = document.querySelector(${JSON.stringify(IFRAME_SEL)});
      const fdoc = f?.contentDocument;
      if (!fdoc) return false;
      const trig = fdoc.querySelector('.post-album-display, .album-display, .album-select');
      if (!trig) return false;
      ['pointerdown','mousedown','pointerup','mouseup','click'].forEach(t =>
        trig.dispatchEvent(new MouseEvent(t, { bubbles:true, cancelable:true, view:f.contentWindow, button:0, buttons:1, detail:1 }))
      );
      return true;
    })()`,
  )) as boolean
  if (!opened) return 'trigger-not-found'

  await sleep(500)

  // 2. Try to match an existing item by name.
  const matched = (await evalJs(
    tabId,
    `(() => {
      const f = document.querySelector(${JSON.stringify(IFRAME_SEL)});
      const fdoc = f?.contentDocument;
      if (!fdoc) return false;
      const target = ${JSON.stringify(name.trim())};
      const items = [...fdoc.querySelectorAll('.album-list-wrap .item, .album-list .item, .common-option-list .option, .post-album-popup .item')];
      const hit = items.find(el => (el.innerText||'').trim() === target && el.offsetParent !== null);
      if (!hit) return false;
      ['pointerdown','mousedown','pointerup','mouseup','click'].forEach(t =>
        hit.dispatchEvent(new MouseEvent(t, { bubbles:true, cancelable:true, view:f.contentWindow, button:0, buttons:1, detail:1 }))
      );
      return true;
    })()`,
  )) as boolean
  if (matched) return `picked-existing:${name}`

  // 3. Click 创建新合集 link.
  const createOpened = (await evalJs(
    tabId,
    `(() => {
      const f = document.querySelector(${JSON.stringify(IFRAME_SEL)});
      const fdoc = f?.contentDocument;
      if (!fdoc) return false;
      const link = fdoc.querySelector('.filter-wrap .create a, .filter-wrap .create, .album-create');
      const candidate = link || [...fdoc.querySelectorAll('a,div,span,button')].find(el => /创建.*合集|新建合集/.test((el.innerText||'').trim()) && el.offsetParent !== null);
      if (!candidate) return false;
      ['pointerdown','mousedown','pointerup','mouseup','click'].forEach(t =>
        candidate.dispatchEvent(new MouseEvent(t, { bubbles:true, cancelable:true, view:f.contentWindow, button:0, buttons:1, detail:1 }))
      );
      return true;
    })()`,
  )) as boolean
  if (!createOpened) return 'create-link-not-found'

  // 4. Fill the dialog input.
  await waitFor(
    tabId,
    `(() => {
      const f = document.querySelector(${JSON.stringify(IFRAME_SEL)});
      const fdoc = f?.contentDocument;
      return !!fdoc?.querySelector('input[placeholder*="合集"], .weui-desktop-dialog input[type=text]');
    })()`,
    5000,
  )

  const filled = (await evalJs(
    tabId,
    `(() => {
      const f = document.querySelector(${JSON.stringify(IFRAME_SEL)});
      const fdoc = f?.contentDocument;
      if (!fdoc) return false;
      const inp = fdoc.querySelector('input[placeholder*="合集"]') ||
                  fdoc.querySelector('.weui-desktop-dialog input[type=text]');
      if (!inp) return false;
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(inp), 'value')?.set;
      setter ? setter.call(inp, ${JSON.stringify(name)}) : (inp.value = ${JSON.stringify(name)});
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      inp.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`,
  )) as boolean
  if (!filled) return 'dialog-input-not-found'

  // 5. Click 创建 primary button.
  await sleep(300)
  const created = (await evalJs(
    tabId,
    `(() => {
      const f = document.querySelector(${JSON.stringify(IFRAME_SEL)});
      const fdoc = f?.contentDocument;
      if (!fdoc) return false;
      const dlg = fdoc.querySelector('.weui-desktop-dialog');
      const scope = dlg || fdoc;
      const btns = [...scope.querySelectorAll('button')].filter(b => b.offsetParent !== null);
      const btn = btns.find(b => (b.innerText||'').trim() === '创建' && !b.classList.contains('weui-desktop-btn_disabled'));
      if (!btn) return false;
      ['pointerdown','mousedown','pointerup','mouseup','click'].forEach(t =>
        btn.dispatchEvent(new MouseEvent(t, { bubbles:true, cancelable:true, view:f.contentWindow, button:0, buttons:1, detail:1 }))
      );
      return true;
    })()`,
  )) as boolean
  if (!created) return 'create-btn-not-found'

  await sleep(1500)
  return `created-new:${name}`
}

/**
 * Click 声明原创 checkbox -> wait for "原创权益" dialog -> tick the
 * agreement checkbox inside dialog -> click 声明原创 primary button
 * (which is disabled until the agreement is ticked).
 */
async function declareOriginal(tabId: number): Promise<string> {
  // 1. Click the outer 声明原创 checkbox to open the dialog.
  const opened = (await evalJs(
    tabId,
    `(() => {
      const f = document.querySelector(${JSON.stringify(IFRAME_SEL)});
      const fdoc = f?.contentDocument;
      if (!fdoc) return false;
      const inp = fdoc.querySelector('.declare-original-checkbox input.ant-checkbox-input, .declare-original-checkbox input[type=checkbox]');
      const target = inp ? inp.closest('label') || inp.parentElement || inp : null;
      if (!target) {
        // Fallback: walk up from the "声明原创" label.
        const lbl = [...fdoc.querySelectorAll('*')].find(el => el.children.length < 4 && (el.innerText||'').trim() === '声明原创' && el.offsetParent !== null);
        if (!lbl) return false;
        let t = lbl.parentElement;
        for (let i = 0; i < 4 && t; i++) {
          const cls = t.className?.toString() || '';
          if (/declare|original|checkbox/i.test(cls)) break;
          t = t.parentElement;
        }
        const node = t || lbl;
        ['pointerdown','mousedown','pointerup','mouseup','click'].forEach(tt =>
          node.dispatchEvent(new MouseEvent(tt, { bubbles:true, cancelable:true, view:f.contentWindow, button:0, buttons:1, detail:1 }))
        );
        return true;
      }
      ['pointerdown','mousedown','pointerup','mouseup','click'].forEach(t =>
        target.dispatchEvent(new MouseEvent(t, { bubbles:true, cancelable:true, view:f.contentWindow, button:0, buttons:1, detail:1 }))
      );
      return true;
    })()`,
  )) as boolean
  if (!opened) return 'checkbox-not-found'

  // 2. Wait for the 原创权益 dialog.
  try {
    await waitFor(
      tabId,
      `(() => {
        const f = document.querySelector(${JSON.stringify(IFRAME_SEL)});
        const fdoc = f?.contentDocument;
        if (!fdoc) return false;
        return [...fdoc.querySelectorAll('.weui-desktop-dialog__title, .weui-desktop-dialog .title, .ant-modal-title')].some(el => (el.innerText||'').includes('原创权益'));
      })()`,
      5000,
    )
  } catch {
    // Some accounts skip the dialog (already declared once); checkbox alone
    // is enough — treat as success.
    return 'no-dialog-toggled'
  }

  // 3. Tick the agreement checkbox inside the dialog.
  const ticked = (await evalJs(
    tabId,
    `(() => {
      const f = document.querySelector(${JSON.stringify(IFRAME_SEL)});
      const fdoc = f?.contentDocument;
      if (!fdoc) return false;
      const dlg = [...fdoc.querySelectorAll('.weui-desktop-dialog, .ant-modal')].find(d => (d.innerText||'').includes('原创权益') && d.offsetParent !== null);
      if (!dlg) return false;
      const cb = dlg.querySelector('input[type=checkbox]');
      const target = cb ? (cb.closest('label') || cb.parentElement || cb) : null;
      if (!target) return false;
      // Skip if already checked (some flows persist the agreement).
      if (cb && cb.checked) return true;
      ['pointerdown','mousedown','pointerup','mouseup','click'].forEach(t =>
        target.dispatchEvent(new MouseEvent(t, { bubbles:true, cancelable:true, view:f.contentWindow, button:0, buttons:1, detail:1 }))
      );
      return true;
    })()`,
  )) as boolean
  if (!ticked) return 'agreement-not-found'

  // 4. Wait for primary button to be enabled and click it.
  await sleep(300)
  try {
    await waitFor(
      tabId,
      `(() => {
        const f = document.querySelector(${JSON.stringify(IFRAME_SEL)});
        const fdoc = f?.contentDocument;
        if (!fdoc) return false;
        const dlg = [...fdoc.querySelectorAll('.weui-desktop-dialog, .ant-modal')].find(d => (d.innerText||'').includes('原创权益') && d.offsetParent !== null);
        if (!dlg) return false;
        const btn = [...dlg.querySelectorAll('button')].find(b => (b.innerText||'').trim() === '声明原创' && b.offsetParent !== null);
        return btn && !btn.classList.contains('weui-desktop-btn_disabled') && !btn.disabled;
      })()`,
      5000,
    )
  } catch {
    return 'primary-btn-stays-disabled'
  }

  const confirmed = (await evalJs(
    tabId,
    `(() => {
      const f = document.querySelector(${JSON.stringify(IFRAME_SEL)});
      const fdoc = f?.contentDocument;
      if (!fdoc) return false;
      const dlg = [...fdoc.querySelectorAll('.weui-desktop-dialog, .ant-modal')].find(d => (d.innerText||'').includes('原创权益') && d.offsetParent !== null);
      if (!dlg) return false;
      const btn = [...dlg.querySelectorAll('button')].find(b => (b.innerText||'').trim() === '声明原创' && b.offsetParent !== null && !b.classList.contains('weui-desktop-btn_disabled'));
      if (!btn) return false;
      ['pointerdown','mousedown','pointerup','mouseup','click'].forEach(t =>
        btn.dispatchEvent(new MouseEvent(t, { bubbles:true, cancelable:true, view:f.contentWindow, button:0, buttons:1, detail:1 }))
      );
      return true;
    })()`,
  )) as boolean
  if (!confirmed) return 'primary-btn-not-found'

  await sleep(1000)
  return 'declared'
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
