/**
 * `bnbot wxmp post` — one-shot WeChat MP (公众号) compose, save draft,
 * and optionally preview. Validated 2026-04-28 against
 * mp.weixin.qq.com/cgi-bin/appmsg editor.
 *
 * 🚫 INTENTIONALLY NO --publish FLAG. The 发表 button must always be
 * clicked manually in the WeChat MP backend by the user. We only
 * automate everything up to (and including) "保存为草稿" + "预览".
 *
 * Plan JSON shape:
 *   {
 *     "title":     "...",
 *     "author":    "...",
 *     "digest":    "...",                // 摘要 (optional)
 *
 *     // ── BODY: pick ONE of two paths ──
 *     // Path A — direct innerHTML write (legacy; loses formatting):
 *     "bodyHtml":  "<p>...</p>",
 *
 *     // Path B — paste-mode (recommended; preserves 标题/列表/引用/颜色):
 *     "pasteHtml":   "<h1>标题</h1><p>带 <strong>排版</strong></p>...",
 *     "pasteImages": ["/abs/img1.png", "https://example.com/img2.jpg"],
 *     // → text/html via ClipboardEvent (microWeChat ProseMirror schema preserves
 *     //   h1/h2/h3, strong, em, ul/ol, blockquote, code, inline color styles).
 *     // → Each image is binary-paste'd as File so WeChat auto-uploads to
 *     //   mmbiz.qpic.cn CDN (mirrors "from-公众号文章 Cmd+V" behavior).
 *     //   Local paths are read; remote URLs are fetched first.
 *     //   Images append in order at end-of-document. For positional control,
 *     //   put placeholder <p data-bnbot-img-slot="N"></p> in pasteHtml — they
 *     //   will be replaced in-place.
 *
 *     "insertBodyImage":  true,            // (legacy path) 图片库 → 选第一张 → 确定
 *     "coverFromBody":    true,            // 用正文已插图作封面
 *     "original":          true,           // 开原创声明（文字原创）
 *     "saveDraft":         true,           // 保存为草稿
 *     "preview":           true            // 进预览（不发表）
 *   }
 *
 * Internal mechanics: orchestrates `debug_eval` + `debug_click` actions
 * via the existing extension WS bridge — no new extension handlers
 * needed. Everything runs against the pool tab for host
 * `mp.weixin.qq.com`.
 */
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import WebSocket from 'ws'
import { ensureServer } from '../cli'

const DEFAULT_PORT = 18900
const ACTION_TIMEOUT_MS = 60_000
const HOST = 'mp.weixin.qq.com'

export interface WxmpPostPlan {
  title?: string
  author?: string
  /** 摘要 — shown on the share card and 公众号 home page. Defaults to first
   *  ~54 chars of body if not set (微信 auto-fills). */
  digest?: string
  /** Direct innerHTML write — fast but strips structure on save. */
  bodyHtml?: string
  /** Paste-mode HTML — preserves h1/h2/h3, strong, em, lists, blockquote,
   *  code, inline color/style. Use this for rich text from Notion / MD /
   *  another 公众号 article. */
  pasteHtml?: string
  /** Local paths or remote URLs. Each is binary-paste'd into the editor
   *  so WeChat auto-uploads to mmbiz CDN. By default appended at end; use
   *  `<p data-bnbot-img-slot="N"></p>` markers in pasteHtml for in-place. */
  pasteImages?: string[]
  /** Cover image (本地路径 / 远程 URL). Pasted FIRST so it ends up as the
   *  first image in body, then `coverFromBody` is auto-triggered to set
   *  it as the article cover (#js_cover_area). Convenience for callers
   *  who want explicit cover separation rather than relying on
   *  pasteImages[0] convention. */
  cover?: string
  insertBodyImage?: boolean
  /** Pick first body image as cover. Auto-set to true when `cover` is
   *  provided. */
  coverFromBody?: boolean
  /** Open 原创声明 dialog (文字原创 + 默认快捷转载). */
  original?: boolean
  saveDraft?: boolean
  /** Open the preview dialog after save. Useful for visual debug; for
   *  programmatic preview-link extraction use `previewLink` instead. */
  preview?: boolean
  /** [LIMITED] After save, attempt to capture a preview share URL.
   *
   *  ⚠️ 微信公众号 does NOT expose a public-shareable preview URL for
   *  drafts (verified via network capture 2026-04-28). The 预览 button
   *  only opens the side-panel article card preview + history version
   *  list. Phone preview goes through "群发预览 → 推送给指定微信号",
   *  which doesn't return a URL we can capture.
   *
   *  This flag opens the preview side-panel and tries best-effort
   *  scraping for any URL field (currently always returns null on
   *  mp.weixin.qq.com). Kept in the schema so callers don't break, but
   *  for actually previewing on phone the user must:
   *    1. Open the draft in 草稿箱 manually
   *    2. Click 预览 → 扫码 to send to their own WeChat
   *  Or: have the CLI run a 群发预览 push to a known WeChat ID
   *  (separate flow, not implemented yet). */
  previewLink?: boolean
  /** Optional override editor URL (e.g. when resuming an existing draft).
   *  Default: open a fresh editor via &isNew=1. */
  editorUrl?: string
}

interface WxmpPostArgs {
  inline?: string
  plan?: string
}

export async function wxmpPostCommand(opts: WxmpPostArgs): Promise<void> {
  const raw = opts.inline ?? readPlanFromArgOrStdin(opts.plan)
  let plan: WxmpPostPlan
  try {
    plan = JSON.parse(raw)
  } catch (err) {
    console.error(`[bnbot wxmp post] plan is not valid JSON: ${(err as Error).message}`)
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

async function runPost(plan: WxmpPostPlan): Promise<Record<string, unknown>> {
  const summary: Record<string, unknown> = { steps: [] as string[] }
  const log = (s: string) => (summary.steps as string[]).push(s)

  // 0. Normalize plan — sugar fields (`cover`) get expanded into the
  //    canonical fields (pasteImages prepend) so the rest of the
  //    pipeline doesn't need to know about them. Note that for type=10
  //    图文文章 editor we DO NOT auto-trigger coverFromBody because the
  //    editor automatically uses the first body image as cover ("默认首图
  //    为封面"). coverFromBody is only meaningful for type=77 商品消息
  //    where the cover dialog walks through .appmsg_content_img_item.
  if (plan.cover) {
    plan.pasteImages = [plan.cover, ...(plan.pasteImages ?? [])]
  }

  // 1. Make sure we're on an editor page. If not, open a fresh one.
  await ensureEditor(plan.editorUrl)
  log('editor:ready')

  // 2. Meta fields
  if (plan.title || plan.author || plan.digest) {
    await setMeta(plan)
    log('meta:set')
  }

  // 3. Body HTML (ProseMirror — NOT UEditor)
  if (plan.bodyHtml) {
    await setBody(plan.bodyHtml)
    log('body:set')
  }

  // 4a. Paste-mode: rich HTML + binary images (mirrors browser Cmd+C/V).
  if (plan.pasteHtml || plan.pasteImages?.length) {
    const uploaded = await pasteRichContent(plan.pasteHtml ?? '', plan.pasteImages ?? [])
    log(`paste:html+${uploaded}-images`)
  }

  // 4b. Legacy: insert image via 图片库 dialog.
  if (plan.insertBodyImage) {
    await insertBodyImageFromLibrary()
    log('body:image-inserted')
  }

  // 5. Cover — pick first image already in the body
  if (plan.coverFromBody) {
    await setCoverFromBody()
    log('cover:set')
  }

  // 6. Original declaration (文字原创 + 默认快捷转载)
  if (plan.original) {
    await openOriginalDialogAndConfirm()
    log('original:enabled')
  }

  // 7. Save draft. After several iterations the working recipe is:
  //     - Don't fiddle with PM dirty flags before clicking — that broke
  //       commit in v0.3.28 / v0.3.29.
  //     - Click 保存为草稿, give the server ~5s to ack, then verify by
  //       fetching the 草稿箱 list endpoint and looking for our title.
  //       If found we know server-side persistence happened (the URL
  //       doesn't always navigate on save, can't trust that signal).
  //     - If body is still racey (server got placeholder before image
  //       upload), the title check still confirms the commit and the
  //       user can re-fire from list page.
  if (plan.saveDraft) {
    await saveDraftAndVerify()
    const committed = plan.title
      ? await verifyDraftInList(plan.title, 8_000)
      : true
    summary.draftCommitted = committed
    log(committed ? 'draft:saved' : 'draft:save-uncertain')
  }

  // 8a. Preview link — programmatic extraction. Opens 预览 dialog,
  //     scrapes the share URL or QR-code link, then reports back.
  if (plan.previewLink) {
    const url = await fetchPreviewLink()
    if (url) {
      summary.previewUrl = url
      log('preview:link-captured')
    } else {
      log('preview:link-unavailable')
    }
  }

  // 8b. Preview UI — visible 预览容器, useful when the user wants to
  //     manually inspect on phone via QR code rather than capture URL.
  if (plan.preview && !plan.previewLink) {
    await openPreview()
    log('preview:opened')
  }

  // Final state snapshot — evalJs auto-parses JSON-stringified return
  // values, so we don't double-parse here. Note: TS template literal needs
  // 2 backslashes so the runtime regex literal has \d (not \\d which is
  // literal backslash + d).
  summary.finalState = await evalJs(`JSON.stringify({
    appmsgid: location.href.match(/appmsgid=(\\d+)/)?.[1] ?? null,
    title:    document.querySelector('#title')?.value ?? null,
    author:   document.querySelector('#author')?.value ?? null,
    digest:   document.querySelector('#js_description')?.value ?? null,
    bodyChars: document.querySelector('.ProseMirror')?.innerText?.length ?? 0,
    bodyImgs:  document.querySelectorAll('.ProseMirror img:not(.ProseMirror-separator)').length,
    coverSet:  !!document.querySelector('.js_cover_preview_new'),
    persistedImgsAreMmbiz: [...document.querySelectorAll('.ProseMirror img:not(.ProseMirror-separator)')].every(i => i.src.includes('mmbiz'))
  })`)
  return summary
}

// ── Atomic primitives ───────────────────────────────────────────

async function ensureEditor(editorUrl?: string): Promise<void> {
  // If we're already on an editor page, leave it alone (preserves
  // appmsgid for resume scenarios).
  const current = await evalJs('location.href')
  const url = String(current)
  if (url.includes('appmsg_edit')) return

  // Naming notes — appmsg type & createType for 公众号 editor entries:
  //   - type=10 (no createType param) = 普通图文文章 (article). Page has
  //     #js_cover_area, #js_submit, #js_preview (jQuery-bound), 原创声明
  //     setting, no startup dialog. THIS is what we want.
  //   - type=10 + createType=100 = same article schema BUT the editor
  //     pops a "选择已有内容" gate dialog on load that intercepts paste
  //     and breaks automation. Avoid.
  //   - type=77 createType=0 = 商品消息 (product message). Different
  //     schema (cover / digest fields render under "商品消息" breadcrumb;
  //     no #js_submit, no 原创 entry, weui-desktop-only buttons).
  //   - type=11 / type=12 — video / audio variants, separate flows.
  // We pick type=10 (no createType) for the normal article path.
  const target =
    editorUrl ??
    `https://${HOST}/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&isNew=1&type=10&lang=zh_CN`
  await sendAction('navigate_to_url', { url: target })
  // Wait for editor to mount.
  await waitFor(`!!document.querySelector('#title') && !!document.querySelector('.ProseMirror')`, 30_000)
}

async function setMeta(plan: WxmpPostPlan): Promise<void> {
  const fields: Array<[string, string | undefined]> = [
    ['#title', plan.title],
    ['#author', plan.author],
    ['#js_description', plan.digest],
  ]
  for (const [sel, val] of fields) {
    if (val === undefined) continue
    await evalJs(`(() => {
      const el = document.querySelector(${JSON.stringify(sel)});
      if (!el) return false;
      const proto = Object.getPrototypeOf(el);
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      setter ? setter.call(el, ${JSON.stringify(val)}) : (el.value = ${JSON.stringify(val)});
      el.dispatchEvent(new Event('input',  { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`)
  }
}

async function setBody(html: string): Promise<void> {
  await evalJs(`(() => {
    const pm = document.querySelector('.ProseMirror');
    if (!pm) return false;
    pm.innerHTML = ${JSON.stringify(html)};
    pm.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`)
}

/**
 * Paste rich HTML + binary images, mirroring browser Cmd+C/V from a webpage.
 *
 * Why two phases instead of one paste with html+files together:
 *   When dataTransfer carries BOTH text/html and items.files, Chromium's
 *   PM paste handler is unpredictable — different ProseMirror plugins
 *   pick different branches. Splitting the paste guarantees:
 *     phase 1: text/html → ProseMirror inserts paragraphs/h1/h2/.../slots
 *     phase 2: per-image binary paste → each File triggers WeChat's
 *              auto-upload to mmbiz.qpic.cn, returns mmbiz URL +
 *              data-imgfileid (server校验通过, 草稿持久化)
 *
 * Image src can be:
 *   - Local absolute path (read via Node fs)
 *   - Remote URL (fetched via undici with proxy)
 *
 * Returns the count of images successfully uploaded.
 */
async function pasteRichContent(html: string, imagePaths: string[]): Promise<number> {
  // Phase 0: Build base64 blobs for each image.
  const blobs: Array<{ b64: string; mime: string; name: string }> = []
  for (let i = 0; i < imagePaths.length; i++) {
    const src = imagePaths[i]
    const { b64, mime } = await loadImageAsBase64(src)
    const ext = mime.split('/')[1] || 'png'
    blobs.push({ b64, mime, name: `wxmp-paste-${i + 1}.${ext}` })
  }

  // Phase 1: paste text/html (no image binaries — server would strip them
  // anyway, and PM's HTML paste branch is cleaner without files attached).
  if (html) {
    await evalJs(`(() => {
      const pm = document.querySelector('.ProseMirror');
      pm.focus();
      const sel = window.getSelection();
      sel.selectAllChildren(pm);
      sel.collapseToEnd();
      const dt = new DataTransfer();
      dt.setData('text/html', ${JSON.stringify(html)});
      dt.setData('text/plain', '');
      const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
      pm.dispatchEvent(ev);
      return true;
    })()`)
  }

  // Phase 2: per-image binary paste at end-of-doc. Each paste triggers
  // WeChat's auto-upload, which is async — wait for the new img to land
  // with a mmbiz src before doing the next one (otherwise rapid pastes
  // race and some uploads get dropped).
  let uploaded = 0
  for (const blob of blobs) {
    const beforeCount = (await evalJs(
      `document.querySelectorAll('.ProseMirror img:not(.ProseMirror-separator)').length`,
    )) as number

    await evalJs(`(() => {
      const b64 = ${JSON.stringify(blob.b64)};
      const bin = atob(b64);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const file = new File([arr], ${JSON.stringify(blob.name)}, { type: ${JSON.stringify(blob.mime)} });
      const pm = document.querySelector('.ProseMirror');
      pm.focus();
      const sel = window.getSelection();
      sel.selectAllChildren(pm);
      sel.collapseToEnd();
      const dt = new DataTransfer();
      dt.items.add(file);
      const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
      pm.dispatchEvent(ev);
      return true;
    })()`)

    // Wait up to 15s for img count to grow + new img to have mmbiz src.
    const ok = await waitForCondition(
      `(() => {
        const imgs = [...document.querySelectorAll('.ProseMirror img:not(.ProseMirror-separator)')];
        return imgs.length > ${beforeCount} && imgs[imgs.length - 1].src.includes('mmbiz');
      })()`,
      15_000,
    )
    if (ok) uploaded++
    // ⚠️ Do NOT add a settle sleep here — extra idle time after the
    // paste lets PM's dirty flag get reconciled away, and then the
    // subsequent saveDraft click becomes a no-op (server gets nothing).
    // The race in the other direction (server reads stale doc) is
    // handled by waiting on each image's mmbiz src appearing above.
  }

  return uploaded
}

/** Read a local file or fetch a remote URL, return base64-encoded body
 *  + mime type. Remote fetch goes through undici ProxyAgent so the user's
 *  https_proxy / http_proxy / all_proxy env vars apply (needed for blogs
 *  / CDNs blocked from China without VPN). */
async function loadImageAsBase64(src: string): Promise<{ b64: string; mime: string }> {
  if (/^https?:\/\//.test(src)) {
    const { fetch, ProxyAgent } = await import('undici')
    const proxyUrl =
      process.env.https_proxy ||
      process.env.http_proxy ||
      process.env.all_proxy ||
      process.env.HTTPS_PROXY ||
      process.env.HTTP_PROXY
    const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl.replace(/^socks5:\/\//, 'http://')) : undefined
    const res = await fetch(src, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      ...(dispatcher ? ({ dispatcher } as any) : {}),
    })
    if (!res.ok) throw new Error(`fetch ${src} failed: ${res.status}`)
    const buf = Buffer.from(await res.arrayBuffer())
    const mime = res.headers.get('content-type') || guessMimeFromUrl(src)
    return { b64: buf.toString('base64'), mime }
  }
  // Local path
  const fs = await import('node:fs')
  const buf = fs.readFileSync(src)
  return { b64: buf.toString('base64'), mime: guessMimeFromUrl(src) }
}

function guessMimeFromUrl(url: string): string {
  const ext = url.split('?')[0].split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'png': return 'image/png'
    case 'jpg':
    case 'jpeg': return 'image/jpeg'
    case 'gif': return 'image/gif'
    case 'webp': return 'image/webp'
    case 'svg': return 'image/svg+xml'
    default: return 'image/png'
  }
}

/** Like waitFor but returns boolean instead of throwing. */
async function waitForCondition(boolExpr: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const r = await evalJs(`!!(${boolExpr})`)
    if (r === true) return true
    await sleep(300)
  }
  return false
}

async function insertBodyImageFromLibrary(): Promise<void> {
  // toolbar 图片 button + jQuery-delegated.
  await tagAndClick(
    `[...document.querySelectorAll('.tpl_item.jsInsertIcon.img')].find(el => el.offsetParent !== null)`,
    { viaJq: true },
  )
  // dropdown "从图片库选择" — jQuery-delegated.
  await tagAndClick(
    `[...document.querySelectorAll('.js_img_dropdown_menu .js_img_from_local')].find(el => el.offsetParent !== null)`,
    { viaJq: true },
  )
  await waitFor(
    `!![...document.querySelectorAll('.weui-desktop-dialog')].find(d => d.offsetParent !== null && d.querySelector('.weui-desktop-img-picker__item'))`,
    20_000,
  )
  // Image picker thumbnail — React widget, trusted CDP click.
  await tagAndClick(
    `(() => {
      const dlg = [...document.querySelectorAll('.weui-desktop-dialog')].find(d => d.offsetParent !== null && d.querySelector('.weui-desktop-img-picker__item'));
      return dlg?.querySelector('.weui-desktop-img-picker__item') ?? null;
    })()`,
  )
  // Dialog 确定 button — empirically jQuery-bound on MP dialogs.
  await tagAndClick(
    `(() => {
      const dlg = [...document.querySelectorAll('.weui-desktop-dialog')].find(d => d.offsetParent !== null && d.querySelector('.weui-desktop-img-picker__item'));
      return [...(dlg?.querySelectorAll('button') ?? [])].find(b => (b.innerText || '').trim() === '确定' && !b.disabled) ?? null;
    })()`,
    { viaJq: true },
  )
  await waitFor(`!document.querySelector('.weui-desktop-dialog .weui-desktop-img-picker__item')`, 15_000)
}

async function setCoverFromBody(): Promise<void> {
  // 1. Open cover popover. #js_cover_area is jQuery-delegated.
  await tagAndClick(`document.querySelector('#js_cover_area')`, { viaJq: true })
  await waitFor(`!![...document.querySelectorAll('.pop-opr__list')].find(l => l.offsetParent !== null)`, 5_000)

  // 2. Click "从正文选择" — this opens a dialog containing the body's
  //    inserted images (.appmsg_content_img_item). Selector differs by
  //    appmsg type:
  //      type=10 (图文文章): .js_selectCoverFromContent → "从正文选择"
  //      type=77 (商品消息): .js_imagedialog also lands here (商品消息
  //                          "图片库" is just the body images)
  //    We prefer js_selectCoverFromContent and fall back to js_imagedialog
  //    so both types work. Both selectors are jQuery-delegated <a> tags.
  await tagAndClick(
    `(() => {
      const cands = [...document.querySelectorAll('.js_selectCoverFromContent, .js_imagedialog')];
      // Prefer 从正文选择 first.
      const fromContent = cands.find(el => el.classList.contains('js_selectCoverFromContent') && el.offsetParent !== null && el.getBoundingClientRect().width > 0);
      if (fromContent) return fromContent;
      return cands.find(el => el.offsetParent !== null && el.getBoundingClientRect().width > 0);
    })()`,
    { viaJq: true },
  )
  await waitFor(
    `!![...document.querySelectorAll('.weui-desktop-dialog')].find(d => d.offsetParent !== null && d.querySelector('.weui-desktop-dialog__title')?.innerText?.includes('选择图片'))`,
    15_000,
  )
  // Wait for body images to render in the picker.
  await waitFor(
    `(() => {
      const dlg = [...document.querySelectorAll('.weui-desktop-dialog')].find(d => d.offsetParent !== null && d.querySelector('.weui-desktop-dialog__title')?.innerText?.includes('选择图片'));
      return !!dlg?.querySelector('.appmsg_content_img_item');
    })()`,
    20_000,
  )

  // 3. Click first body image — React widget, trusted CDP click.
  await tagAndClick(
    `(() => {
      const dlg = [...document.querySelectorAll('.weui-desktop-dialog')].find(d => d.offsetParent !== null && d.querySelector('.weui-desktop-dialog__title')?.innerText?.includes('选择图片'));
      return dlg?.querySelector('.appmsg_content_img_item') ?? null;
    })()`,
  )

  // 4. Click 下一步 — dialog button, jQuery-bound.
  await tagAndClick(
    `(() => {
      const dlg = [...document.querySelectorAll('.weui-desktop-dialog')].find(d => d.offsetParent !== null && d.querySelector('.weui-desktop-dialog__title')?.innerText?.includes('选择图片'));
      return [...(dlg?.querySelectorAll('button') ?? [])].find(b => (b.innerText || '').trim() === '下一步' && !b.disabled) ?? null;
    })()`,
    { viaJq: true },
  )

  // 5. Wait for 编辑封面 step, then click 确认 — also jQuery-bound.
  await waitFor(
    `!![...document.querySelectorAll('.weui-desktop-dialog')].find(d => d.offsetParent !== null && d.querySelector('.weui-desktop-dialog__title')?.innerText?.includes('编辑封面'))`,
    15_000,
  )
  await tagAndClick(
    `(() => {
      const dlg = [...document.querySelectorAll('.weui-desktop-dialog')].find(d => d.offsetParent !== null && d.querySelector('.weui-desktop-dialog__title')?.innerText?.includes('编辑封面'));
      return [...(dlg?.querySelectorAll('button') ?? [])].find(b => (b.innerText || '').trim() === '确认' && !b.disabled) ?? null;
    })()`,
    { viaJq: true },
  )
  // Cover renders as background-image — wait for it.
  await waitFor(`!!document.querySelector('.js_cover_preview_new')`, 10_000)
}

async function openOriginalDialogAndConfirm(): Promise<void> {
  // 1. Click the 原创 cell — opens the "原创" dialog. The cell is
  //    jQuery-delegated; trusted CDP click silently no-ops.
  await tagAndClick(
    `(() => {
      const el = document.querySelector('.setting-group__switch.js_original_apply.js_edit_ori');
      el?.scrollIntoView({ block: 'center' });
      return el;
    })()`,
    { viaJq: true },
  )
  await waitFor(
    `!![...document.querySelectorAll('.weui-desktop-dialog')].find(d => d.offsetParent !== null && d.querySelector('.weui-desktop-dialog__title')?.innerText?.trim() === '原创')`,
    10_000,
  )

  // 2. Tick the 协议 checkbox via its visible icon (the input is off-screen).
  await tagAndClick(
    `(() => {
      const dlg = [...document.querySelectorAll('.weui-desktop-dialog')].find(d => d.offsetParent !== null && d.querySelector('.weui-desktop-dialog__title')?.innerText?.trim() === '原创');
      const lbl = [...(dlg?.querySelectorAll('label') ?? [])].find(l => (l.innerText || '').includes('我已阅读'));
      return lbl?.querySelector('.weui-desktop-icon-checkbox') ?? null;
    })()`,
  )

  // 3. Click 确定. ⚠️ scope to the 原创 dialog so we don't hit the
  //    page-level 发表确认 dialog by accident. Dialog button is
  //    jQuery-bound.
  await tagAndClick(
    `(() => {
      const dlg = [...document.querySelectorAll('.weui-desktop-dialog')].find(d => d.offsetParent !== null && d.querySelector('.weui-desktop-dialog__title')?.innerText?.trim() === '原创');
      return [...(dlg?.querySelectorAll('button') ?? [])].find(b => (b.innerText || '').trim() === '确定' && !b.disabled) ?? null;
    })()`,
    { viaJq: true },
  )
  // Wait for 原创 dialog to close.
  await waitFor(
    `![...document.querySelectorAll('.weui-desktop-dialog')].find(d => d.offsetParent !== null && d.querySelector('.weui-desktop-dialog__title')?.innerText?.trim() === '原创')`,
    10_000,
  )
}

/**
 * Trigger 保存为草稿. The hard-won fact:
 *
 *   微信公众号 编辑器 still uses jQuery 1.9.1 for its action buttons.
 *   The click handler is bound via `$('#js_submit').on('click', …)` —
 *   delegated through jQuery's special event system, NOT through native
 *   addEventListener. Trusted CDP MouseEvents pass through the DOM but
 *   jQuery's delegate filter ignores them, so saveDraft via CDP click
 *   silently no-ops.
 *
 *   The fix is to call `$('#js_submit').trigger('click')` directly —
 *   that synthesizes a jQuery event object the delegate IS listening for.
 *
 * This is also why we MUST match by structure (#js_submit) rather than
 * by button.innerText: the click handler is on the wrapper span, not the
 * inner <button>. The wrapper id is `js_submit` for 保存为草稿 and
 * `js_send` for 发表 — we hard-code js_submit and verify innerText
 * still says 保存为草稿 (defense-in-depth against MP UI churn).
 */
async function saveDraftAndVerify(): Promise<void> {
  const result = (await evalJs(`(() => {
    const sp = document.querySelector('#js_submit');
    if (!sp) return 'no-submit-span';
    const txt = (sp.innerText || '').trim();
    if (txt !== '保存为草稿') {
      // Bail loud if the wrapper is mislabeled — could be 发表 in
      // some odd UI state. We never want to fire that.
      return 'submit-wrong-text:' + txt.slice(0, 30);
    }
    const jq = window.$ || window.jQuery;
    if (!jq) return 'no-jquery';
    jq(sp).trigger('click');
    return 'triggered';
  })()`)) as string
  if (result !== 'triggered') {
    throw new Error(`saveDraft: ${result}`)
  }
  // Server commit + URL navigation. 5s is enough on broadband; verify
  // step retries up to 8s after this so total budget is ~13s.
  await sleep(5000)
}

/**
 * Verify the draft made it server-side by fetching the 草稿箱 list page
 * and looking for our title. This is the only reliable signal — URL
 * doesn't always navigate, and toast/tip elements vary across MP UI
 * versions.
 *
 * Polls every 1.5s up to `timeoutMs`.
 */
async function verifyDraftInList(title: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const found = await evalJs(`(async () => {
      const token = location.href.match(/token=(\\d+)/)?.[1];
      if (!token) return false;
      // Check both article (type=10) and the legacy commerce list (type=77),
      // since older drafts may still live there.
      const urls = [
        '/cgi-bin/appmsg?begin=0&count=10&type=10&action=list_card&token=' + token + '&lang=zh_CN&_t=' + Date.now(),
        '/cgi-bin/appmsg?begin=0&count=10&type=77&action=list_card&token=' + token + '&lang=zh_CN&_t=' + Date.now(),
      ];
      try {
        const results = await Promise.all(urls.map(u => fetch(u, { credentials: 'same-origin' }).then(r => r.text())));
        return results.some(html => html.includes(${JSON.stringify(title)}));
      } catch { return false; }
    })()`, true)
    if (found === true) return true
    await sleep(1500)
  }
  return false
}

async function openPreview(): Promise<void> {
  // The 预览 wrapper span (id=js_preview) also uses jQuery delegation,
  // same caveat as 保存为草稿 — go via $.trigger('click').
  await evalJs(`(() => {
    const sp = document.querySelector('#js_preview') ||
      [...document.querySelectorAll('span,button,a')].find(el => (el.innerText||'').trim() === '预览' && el.offsetParent !== null);
    if (!sp) return false;
    const jq = window.$ || window.jQuery;
    if (jq) jq(sp).trigger('click');
    else sp.click();
    return true;
  })()`)
  await waitFor(`!!document.querySelector('.appmsg_preview_container, .preview-mod, [class*=preview-share]')`, 15_000)
}

/**
 * Programmatically extract a preview link for the draft.
 *
 * 微信 MP "预览" actually has multiple surfaces:
 *   - "扫码预览" — shows a QR code that wraps a one-time
 *     `https://mp.weixin.qq.com/s/PREVIEW_KEY` URL valid ~30 days
 *   - "群发预览" / "发送预览" — push to a 微信 username; no URL returned
 *
 * We want the first kind. The expected DOM (subject to MP UI churn,
 * verified empirically per release):
 *   - `.preview_share input[value^="https://mp.weixin"]` — direct URL field
 *   - `.qrcode_canvas` data-url attr — fallback
 *   - Network: a POST to /cgi-bin/operate_appmsg?sub=preview returns
 *     `{ preview_url: "..." }` — most robust, doesn't depend on DOM
 *
 * This function tries (3) first via fetch hook + click, falls back to
 * (1) DOM scrape. Returns null if neither yields a URL within timeout.
 */
async function fetchPreviewLink(): Promise<string | null> {
  // Set up fetch + XHR hook to capture preview API response.
  await evalJs(`(() => {
    window.__wxmpPreviewUrl = null;
    if (window.__wxmpPreviewHooked) return 'already-hooked';
    window.__wxmpPreviewHooked = true;
    const captureUrl = (text) => {
      try {
        const j = JSON.parse(text);
        const candidates = [j.preview_url, j.previewUrl, j.url, j.data?.preview_url];
        for (const c of candidates) {
          if (typeof c === 'string' && c.includes('mp.weixin.qq.com')) {
            window.__wxmpPreviewUrl = c;
            return;
          }
        }
        // Some MP responses embed URL in HTML strings — last resort regex.
        const m = text.match(/https:\\/\\/mp\\.weixin\\.qq\\.com\\/s[\\/?][^"\\s]+/);
        if (m) window.__wxmpPreviewUrl = m[0];
      } catch {}
    };
    // Hook fetch
    const origFetch = window.fetch;
    window.fetch = async function(...args) {
      const url = args[0]?.toString() || '';
      const r = await origFetch.apply(this, args);
      if (url.includes('preview') || url.includes('operate_appmsg')) {
        try {
          const clone = r.clone();
          const text = await clone.text();
          captureUrl(text);
        } catch {}
      }
      return r;
    };
    // Hook XHR
    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function(method, url, ...rest) {
      this.__wxmpPreviewWatched = url && url.toString().match(/preview|operate_appmsg/);
      return origOpen.call(this, method, url, ...rest);
    };
    XMLHttpRequest.prototype.send = function(...args) {
      if (this.__wxmpPreviewWatched) {
        this.addEventListener('load', () => captureUrl(this.responseText));
      }
      return origSend.apply(this, args);
    };
    return 'hooked';
  })()`)

  // Click preview button (jQuery delegated).
  const opened = (await evalJs(`(() => {
    const sp = document.querySelector('#js_preview') ||
      [...document.querySelectorAll('span,button,a')].find(el => (el.innerText||'').trim() === '预览' && el.offsetParent !== null);
    if (!sp) return false;
    const jq = window.$ || window.jQuery;
    if (jq) jq(sp).trigger('click');
    else sp.click();
    return true;
  })()`)) as boolean
  if (!opened) return null

  // Poll for either captured URL (network path) or DOM-scraped URL.
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    const url = await evalJs(`(() => {
      // 1. Captured from network response
      if (window.__wxmpPreviewUrl) return window.__wxmpPreviewUrl;
      // 2. DOM scrape — share input
      const inp = document.querySelector('.preview_share input, [class*=preview-share] input, input[value^="https://mp.weixin.qq.com/s"]');
      if (inp && inp.value) return inp.value;
      // 3. QR code data-url (some MP versions)
      const qr = document.querySelector('.qrcode_canvas[data-url], .preview-qrcode[data-url], [class*=qrcode][data-url]');
      if (qr) return qr.getAttribute('data-url');
      return null;
    })()`)
    if (typeof url === 'string' && url.startsWith('http')) return url
    await sleep(500)
  }
  return null
}

// ── Low-level helpers ───────────────────────────────────────────

async function evalJs(expr: string, awaitPromise = false): Promise<unknown> {
  const payload: Record<string, unknown> = {
    expression: expr,
    targetHost: HOST,
  }
  if (awaitPromise) payload.awaitPromise = true
  const result = (await sendAction('debug_eval', payload)) as { result?: unknown }
  // debug_eval returns the JSON-stringified value in `result`.
  const raw = result?.result
  if (typeof raw !== 'string') return raw
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

/** Find the element returned by `findExpr`, then click it the way 公众号 MP
 *  expects.
 *
 *  IMPORTANT: 微信 MP editor binds nearly every action button + popover
 *  item via jQuery 1.9.1's delegate event system. Trusted CDP MouseEvents
 *  pass through the DOM but jQuery's delegate filter ignores them, so a
 *  CDP click silently no-ops. Solution: run jQuery `.trigger('click')`
 *  inside the page first; only fall back to trusted CDP click if jQuery
 *  isn't available (defensive).
 *
 *  ProseMirror-internal targets (e.g. embedded image elements) use React
 *  / native handlers, not jQuery — for those callers should dispatch a
 *  ClipboardEvent or other native event directly, not go through here.
 */
/**
 * Tag the element returned by `findExpr` with data-bnbot-target='1' and
 * fire a click. The trick is picking the right click path:
 *
 *   - jQuery delegate-bound elements (#js_submit, #js_preview,
 *     #js_cover_area, .js_imagedialog, .js_selectCoverFromContent,
 *     .setting-group__switch.js_edit_ori, popover items): jQuery's
 *     delegate filter discards trusted CDP clicks, so CDP no-ops.
 *     MUST go via $.trigger('click').
 *
 *   - React-bound weui-desktop widgets (.weui-desktop-icon-checkbox,
 *     dialog buttons): jQuery's .trigger() also calls element.click()
 *     which fires a native click — but for some widgets calling click
 *     twice (jQuery synthesized + element.click chain) toggles state
 *     back. Use trusted CDP click only.
 *
 * Caller passes `viaJq: true` for known-jQuery elements. Default false
 * (trusted CDP click) covers React widgets safely.
 */
async function tagAndClick(findExpr: string, opts: { viaJq?: boolean } = {}): Promise<void> {
  const result = (await evalJs(`(() => {
    document.querySelectorAll('[data-bnbot-target]').forEach(el => el.removeAttribute('data-bnbot-target'));
    const el = ${findExpr};
    if (!el || !(el instanceof Element)) return JSON.stringify({ ok: false, reason: 'not-found' });
    el.setAttribute('data-bnbot-target', '1');
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) {
      el.scrollIntoView({ block: 'center' });
    }
    if (${JSON.stringify(opts.viaJq === true)}) {
      const jq = window.$ || window.jQuery;
      if (jq) {
        jq(el).trigger('click');
        return JSON.stringify({ ok: true, fired: 'jq' });
      }
    }
    return JSON.stringify({ ok: true, fired: 'pending-cdp' });
  })()`)) as { ok?: boolean; reason?: string; fired?: string } | string
  const parsed = typeof result === 'string' ? JSON.parse(result) : result
  if (!parsed?.ok) throw new Error(`tagAndClick: target not found (${parsed?.reason})`)

  if (parsed.fired !== 'jq') {
    await sendAction('debug_click', {
      selector: '[data-bnbot-target="1"]',
      targetHost: HOST,
    })
  }
}

/** Fire jQuery `.trigger('click')` on the given selector inside the page.
 *  Use this only for elements whose click handler explicitly requires a
 *  jQuery-synthesized event (#js_submit, #js_preview). For everything else
 *  prefer tagAndClick. */
async function jqTriggerClick(selector: string): Promise<boolean> {
  const result = (await evalJs(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    const jq = window.$ || window.jQuery;
    if (!jq) return false;
    jq(el).trigger('click');
    return true;
  })()`)) as boolean
  return result === true
}

async function waitFor(boolExpr: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const r = await evalJs(`!!(${boolExpr})`)
    if (r === true) return
    await sleep(250)
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
