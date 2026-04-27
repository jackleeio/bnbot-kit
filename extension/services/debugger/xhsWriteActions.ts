/**
 * XHS (creator.xiaohongshu.com) compose + publish — one-shot action.
 *
 * The CLI previously had to make 10+ WS round-trips (nav, upload,
 * each emoji click, each tag click, etc). This action does the entire
 * compose inside a single background-side call by batching DOM
 * operations into a small number of CDP evals, so the CLI fires once
 * and gets back a composed / published state.
 *
 * DOM selectors and behavior map (verified via `bnbot debug` probes):
 *   - Publish URL:  /publish/publish?source=official&from=menu&target=image
 *                   (requires from=menu&target=image query params)
 *   - Upload input:  input.upload-input  (multiple=true, jpg/png/webp)
 *   - Status indicator: .status → "N/18"
 *   - Title input:  input.d-text with placeholder "填写标题会有更多赞哦"
 *   - Body editor:  div.tiptap.ProseMirror
 *   - Image thumbs:  .flex-list > .pr   (1st pr = cover)
 *   - Emoji button (needs trusted event): button.contentBtn.emoticons
 *   - Emoji grid item: .emoticons-item (165 items; order stable)
 *   - Tag pills:  .tag-group > span.tag (synthetic click OK)
 *   - Publish button: button.custom-button.bg-red (text = 发布)
 */
import {
  debuggerSend,
  getTab,
  ensureDebuggerAttached,
} from '../scraperService'
import { evalExpr, setFileInputFiles } from './debuggerOps'

const PUBLISH_URL =
  'https://creator.xiaohongshu.com/publish/publish?source=official&from=menu&target=image'

export interface XhsEmojiSlot {
  /** 0-based paragraph index */
  paraIndex: number
  /** slug from skill/data/platforms/xhs/emoji.json (e.g. "henaicha") */
  slug: string
}

export interface XhsPostPayload {
  /** absolute paths to local image files (1-18 images, jpg/png/webp) */
  images: string[]
  /** 0-based index of the image that should be cover; 0 = first uploaded */
  coverIndex?: number
  title: string
  /** body paragraphs joined by \n */
  body: string
  /** emoji slots, positioned at the end of the given paragraph */
  emojis?: XhsEmojiSlot[]
  /** chinese topic names (without #) — matched fuzzily against
   *  recommended pills (see step 6 in postXhsNote). */
  tags?: string[]
  /** fill with recommended pills if user tags don't match enough.
   *  Default true. Set false to only click exact/fuzzy user tag matches. */
  autoFillTags?: boolean
  /** target total tag count (user + auto-fill). Default 3. */
  minTags?: number
  /** true = click 发布 to really publish; false = stop composed */
  publish?: boolean
}

export interface XhsPostResult {
  tabId: number
  composed: boolean
  published: boolean
  paragraphs: string[]
  title: string
  imageCount: number
  topics: string[]
  emojis: string[]
  /** Per-emoji insertion trace: "{paraIndex}:{slug}:{ok|no-para|panel-not-open|no-emoji|...}" */
  emojiResults: string[]
  /** Tag pill click trace: ["exact:#X","fuzzy:foo:#Bar","auto:#Baz","miss:qux"] */
  tagResults: string[]
  /** 24-char hex note id, only set when `publish: true` and the
   *  interceptor caught it. null if publish skipped or API didn't
   *  expose it before the page navigated. */
  noteId: string | null
  /** Public URL (https://www.xiaohongshu.com/explore/{noteId}). null
   *  when noteId is null. May be under audit — still returns the URL
   *  since XHS assigns it immediately. */
  noteUrl: string | null
  /** Raw captured responses whose URL contained note/publish/post —
   *  handy for debugging when noteId extraction fails. bodyPreview
   *  truncated to 500 chars. */
  publishResponses: Array<{ url: string; status: number; bodyPreview: string }>
}

const HOME_URL = 'https://creator.xiaohongshu.com/new/home?source=official'

/**
 * Open a fresh "upload 图文" note by emulating the actual user path:
 * land on /new/home, hover the 发布笔记 button, click 上传图文 in the
 * dropdown. Two reasons this beats a direct Page.navigate to the
 * publish URL:
 *   1. Matches what a real user does, so XHS's internal state (draft
 *      detection, referrer tracking) stays consistent.
 *   2. Each call starts from a known-clean /new/home → fresh editor,
 *      no leaked content from a previous composed run.
 */
async function prepareXhsTab(): Promise<{ tabId: number; targetId: string }> {
  const tabId = await getTab(HOME_URL)
  // Un-minimize + snap to a visible position. Scraper windows are
  // created offscreen (20000, 20000) so creation doesn't flash; when
  // we restore from minimized, Chrome puts it back at the last
  // position — which is still offscreen — so we explicitly move it
  // somewhere visible. `focused: false` keeps it behind the user's
  // current app.
  const tab = await chrome.tabs.get(tabId).catch(() => null)
  if (tab?.windowId != null) {
    await chrome.windows
      .update(tab.windowId, {
        state: 'normal',
        focused: false,
        left: 80,
        top: 80,
        width: 1280,
        height: 800,
      })
      .catch(() => {})
  }
  const targetId = await ensureDebuggerAttached(tabId, ['Page', 'Runtime', 'DOM', 'Input'])
  // SPA-aware: if the creator shell is already mounted (发布笔记 button
  // visible in the header) AND we're NOT already on /publish/publish,
  // skip the Page.navigate — dropdown click is a pure SPA route change
  // and saves the ~5s skeleton reload.
  //
  // On /publish/publish the "上传图文" dropdown routes to the same URL →
  // SPA treats it as a noop, the editor never resets, input.upload-input
  // never reappears. Must do a full nav to HOME_URL first.
  const pageState = await evalExpr<{ onXhs: boolean; hasBtn: boolean; onPublish: boolean }>(
    targetId,
    `(()=>({onXhs: location.hostname.endsWith('xiaohongshu.com'), hasBtn: [...document.querySelectorAll('span.btn-text')].some(s => s.textContent?.trim() === '发布笔记'), onPublish: location.pathname.startsWith('/publish/publish')}))()`,
  ).catch(() => ({ onXhs: false, hasBtn: false, onPublish: false }))
  const canSkipNavigate = pageState.onXhs && pageState.hasBtn && !pageState.onPublish
  if (!canSkipNavigate) {
    await debuggerSend(targetId, 'Page.navigate', { url: HOME_URL })
    await pollEval(
      targetId,
      `[...document.querySelectorAll('span.btn-text')].some(s => s.textContent?.trim() === '发布笔记')`,
      10_000,
    )
  }
  // Hover 发布笔记 + click 上传图文. Dropdown is mouseenter-driven —
  // synthetic events are enough to open it; .container needs a
  // PointerEvent+MouseEvent chain since .click() doesn't route through
  // the Vue handler.
  await debuggerSend(targetId, 'Runtime.evaluate', {
    awaitPromise: true,
    returnByValue: true,
    expression: `(async () => {
      const span = [...document.querySelectorAll('span.btn-text')].find(s => s.textContent?.trim() === '发布笔记');
      if (!span) throw new Error('发布笔记 button not found');
      const btn = span.closest('.btn-inner');
      const wrapper = btn?.closest('.btn-wrapper');
      // Full hover event chain — XHS dropdown opens on Vue mouseenter
      // handler. Synthetic enter/over on both wrapper and btn covers
      // whichever element the handler is bound to.
      wrapper?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      btn?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      btn?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      // Wait for popover to mount (animation + Vue render ~500ms).
      let target = null;
      for (let i = 0; i < 10; i++) {
        await new Promise(r => setTimeout(r, 100));
        target = [...document.querySelectorAll('.publish-video-popover .container')]
          .find(c => c.querySelector('span')?.textContent?.trim() === '上传图文');
        if (target) break;
      }
      if (!target) throw new Error('上传图文 option not in dropdown');
      const r = target.getBoundingClientRect();
      const opts = { bubbles: true, cancelable: true, view: window, clientX: r.x+r.width/2, clientY: r.y+r.height/2, button: 0, pointerType: 'mouse' };
      target.dispatchEvent(new PointerEvent('pointerdown', opts));
      target.dispatchEvent(new MouseEvent('mousedown', opts));
      target.dispatchEvent(new PointerEvent('pointerup', opts));
      target.dispatchEvent(new MouseEvent('mouseup', opts));
      target.dispatchEvent(new MouseEvent('click', opts));
      // Fire mouseleave on the trigger so Vue closes the dropdown —
      // otherwise the hover state persists and the menu stays open on
      // top of the compose editor.
      btn?.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false }));
      btn?.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
      wrapper?.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false }));
    })()`,
  })
  // Wait for editor to mount.
  await pollEval(
    targetId,
    `location.pathname.startsWith('/publish/publish') && !!document.querySelector('input.upload-input')`,
    15_000,
  )
  return { tabId, targetId }
}

/** Poll an expression until it returns truthy (or timeout). Cheaper than
 *  fixed sleeps — for ready-signals we just check every 250ms. */
async function pollEval(
  targetId: string,
  expression: string,
  timeoutMs: number,
): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const ok = await evalExpr<boolean>(targetId, expression).catch(() => false)
    if (ok) return
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(`pollEval timed out: ${expression}`)
}

/**
 * Wait until the XHS composer has actually finished uploading every
 * image, not just registered the file selection.
 *
 * The earlier ".status === N/18" check (step 2 in postXhsNote) only
 * proves that XHS accepted the file selection — the bytes may still be
 * uploading to xhscdn. Clicking 发布 during that window triggers the
 * toast "图片正在上传，请稍后再发布" and the publish never fires;
 * caller is left stuck on /publish/publish.
 *
 * We poll several "actually-done" signals together, since XHS doesn't
 * expose a single canonical one:
 *   1. Every image card mounted (>= expectedCount)
 *   2. No upload-progress overlay on any card (selectors collected from
 *      observed DOM + a defensive `[class*="loading"]` net)
 *   3. The 发布 button is not in a disabled / loading state
 *   4. No "上传中 / 正在上传" toast hanging around
 *
 * Generous 90s timeout — large image batches + slow uplinks really do
 * take that long sometimes; aborting earlier just papers over the bug.
 */
async function waitForXhsUploadsComplete(
  targetId: string,
  expectedCount: number,
  timeoutMs = 90_000,
): Promise<void> {
  const expression = `(()=>{
    try {
      const cards = [...document.querySelectorAll('.flex-list > .pr')];
      if (cards.length < ${expectedCount}) return {ok:false, reason:'cards-missing:'+cards.length};
      for (const c of cards) {
        if (c.querySelector('.upload-progress, .progress, .loading-mask, .uploading, .pr-loading, [class*="loading"], [class*="Loading"]')) {
          return {ok:false, reason:'card-uploading'};
        }
        const cls = (c.className||'')+'';
        if (/uploading|loading/i.test(cls)) return {ok:false, reason:'card-class-pending'};
      }
      const btn = document.querySelector('button.custom-button.bg-red');
      if (!btn) return {ok:false, reason:'no-btn'};
      if (btn.disabled || /disabled|loading/i.test(btn.className||'')) return {ok:false, reason:'btn-disabled'};
      const toastEls = document.querySelectorAll('.d-toast, .d-message, [class*="toast"], [class*="Toast"]');
      for (const t of toastEls) {
        const txt = ((t.textContent||'')+'').trim();
        if (/上传中|正在上传/.test(txt)) return {ok:false, reason:'uploading-toast'};
      }
      return {ok:true};
    } catch (err) {
      return {ok:false, reason:'err:'+(err&&err.message?err.message:'unknown')};
    }
  })()`
  const start = Date.now()
  let lastReason = 'unknown'
  while (Date.now() - start < timeoutMs) {
    const res = await evalExpr<{ ok: boolean; reason?: string }>(targetId, expression).catch(
      () => ({ ok: false as const, reason: 'eval-err' }),
    )
    if (res.ok) return
    lastReason = res.reason ?? 'unknown'
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`xhs upload wait timed out (${Math.round(timeoutMs / 1000)}s): ${lastReason}`)
}

/**
 * Briefly poll for an "uploads still in progress" toast that XHS shows
 * when 发布 is clicked while xhscdn hasn't finished receiving every
 * file. Returns the toast text if seen, null otherwise (= publish went
 * through). Bounded so a missing toast doesn't block forever.
 */
async function detectXhsPublishBlockedToast(
  targetId: string,
  windowMs = 2_000,
): Promise<string | null> {
  const deadline = Date.now() + windowMs
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 100))
    const url = await evalExpr<string>(targetId, `location.href`).catch(() => '')
    if (url.includes('/publish/success')) return null
    const toast = await evalExpr<string | null>(
      targetId,
      `(()=>{const els=document.querySelectorAll('.d-toast, .d-message, [class*="toast"], [class*="Toast"], [class*="message"]');for(const e of els){const t=((e.textContent||'')+'').trim();if(/图片正在上传|请稍后|上传中/.test(t))return t;}return null;})()`,
    ).catch(() => null)
    if (toast) return toast
  }
  return null
}

async function trustedDrag(
  targetId: string,
  fromSelector: string,
  toSelector: string,
  steps = 20,
): Promise<void> {
  const coords = await evalExpr<{ sx: number; sy: number; dx: number; dy: number } | null>(
    targetId,
    `(()=>{
      const s = document.querySelector(${JSON.stringify(fromSelector)});
      const d = document.querySelector(${JSON.stringify(toSelector)});
      if (!s || !d) return null;
      s.scrollIntoView({block:'center'});
      const rs = s.getBoundingClientRect();
      const rd = d.getBoundingClientRect();
      return {sx: rs.x+rs.width/2, sy: rs.y+rs.height/2, dx: rd.x+rd.width/2, dy: rd.y+rd.height/2};
    })()`,
  )
  if (!coords) throw new Error(`drag: element(s) not found (${fromSelector} → ${toSelector})`)
  const { sx, sy, dx, dy } = coords
  await debuggerSend(targetId, 'Input.dispatchMouseEvent', {
    type: 'mousePressed', x: sx, y: sy, button: 'left', clickCount: 1,
  })
  for (let i = 1; i <= steps; i++) {
    const x = sx + (dx - sx) * (i / steps)
    const y = sy + (dy - sy) * (i / steps)
    await debuggerSend(targetId, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved', x, y, button: 'left',
    })
    await new Promise((r) => setTimeout(r, 15))
  }
  await debuggerSend(targetId, 'Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: dx, y: dy, button: 'left', clickCount: 1,
  })
}

export async function postXhsNote(payload: XhsPostPayload): Promise<XhsPostResult> {
  if (!payload.images || payload.images.length === 0) {
    throw new Error('postXhsNote: images required')
  }
  if (!payload.title) throw new Error('postXhsNote: title required')
  if (!payload.body) throw new Error('postXhsNote: body required')

  const t0 = Date.now()
  const log = (stage: string) => console.log(`[xhs_post] +${Date.now() - t0}ms ${stage}`)

  log('start')
  const { tabId, targetId } = await prepareXhsTab()
  log('prepared')

  // 1. Upload all images in one CDP call
  await setFileInputFiles(targetId, 'input.upload-input', payload.images)
  log('files set')

  // 2. Wait for all N images to appear (.status shows N/18). Cheap poll.
  await pollEval(
    targetId,
    `(()=>{const s=document.querySelector('.status');return s && s.textContent.trim() === '${payload.images.length}/18';})()`,
    20_000,
  )
  log('images ready')

  // 3. Reorder cover if requested. XHS sortable moves source to target
  //    slot and shifts siblings — coverIndex 3 → pos 1 puts img[3] as cover.
  const coverIndex = payload.coverIndex ?? 0
  if (coverIndex > 0) {
    if (coverIndex >= payload.images.length) {
      throw new Error(`postXhsNote: coverIndex ${coverIndex} out of range`)
    }
    await evalExpr(
      targetId,
      `(()=>{const p=[...document.querySelectorAll('.flex-list > .pr')];p.forEach(e=>e.id='');p[${coverIndex}].id='bnbot-xhs-drag-src';p[0].id='bnbot-xhs-drag-dst';})()`,
    )
    await trustedDrag(targetId, '#bnbot-xhs-drag-src', '#bnbot-xhs-drag-dst', 30)
    await new Promise((r) => setTimeout(r, 300))
    log('cover reordered')
  }

  // 4. Fill title + body (all paragraphs) in ONE eval.
  const paragraphs = payload.body.split('\n').filter((p) => p.length > 0)
  if (paragraphs.length === 0) throw new Error('postXhsNote: body is empty')
  const paragraphsJs = JSON.stringify(paragraphs)
  const titleJs = JSON.stringify(payload.title)
  await evalExpr(
    targetId,
    `(()=>{
      const ti = [...document.querySelectorAll('input.d-text')].find(i => i.placeholder === '填写标题会有更多赞哦');
      if (ti) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(ti, ${titleJs});
        ti.dispatchEvent(new Event('input', {bubbles:true}));
      }
      const tt = document.querySelector('div.tiptap.ProseMirror');
      tt.focus();
      const r0 = document.createRange(); r0.selectNodeContents(tt);
      const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r0);
      document.execCommand('delete', false);
      const paras = ${paragraphsJs};
      paras.forEach((p, i) => {
        if (i > 0) document.execCommand('insertParagraph', false);
        document.execCommand('insertText', false, p);
      });
    })()`,
  )
  log('title+body filled')

  // 5. Insert emojis — must do it PER-EMOJI because:
  //    (a) XHS's emoji popover closes when any click lands outside it
  //        (including the paragraph click we need to move PM's caret), so
  //        keeping the panel open across all 3 emojis isn't possible.
  //    (b) tiptap/ProseMirror keeps its own selection state — setting DOM
  //        selection alone doesn't move PM's caret; we need a real click
  //        on the target paragraph.
  //    Per-emoji flow: click paragraph → open panel → click emoji item.
  const emojiResults: string[] = []
  if (payload.emojis && payload.emojis.length > 0) {
    for (const slot of payload.emojis) {
      const slug = slot.slug
      // Step 0: force-close any lingering emoji popover via CDP Escape
      // key (trusted event that XHS's popover close handler listens to).
      // Without this, the popover from the previous iteration can sit on
      // top of the target paragraph, and the CDP click below lands on a
      // popover emoji instead of the paragraph — inserting the panel's
      // first item (e.g. 汗颜R / 偷笑R) at the old caret position.
      await debuggerSend(targetId, 'Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: 'Escape',
        code: 'Escape',
        windowsVirtualKeyCode: 27,
        nativeVirtualKeyCode: 27,
      })
      await debuggerSend(targetId, 'Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: 'Escape',
        code: 'Escape',
        windowsVirtualKeyCode: 27,
        nativeVirtualKeyCode: 27,
      })
      await new Promise((r) => setTimeout(r, 200))
      // Step 1: get paragraph coords for a CDP trusted click.
      // PM/contenteditable moves the caret only on trusted browser events,
      // not synthetic dispatchEvent — so we use Input.dispatchMouseEvent
      // here even though the emoji button/item accept synthetic chains.
      const coords = await evalExpr<{ x: number; y: number } | null>(
        targetId,
        `(()=>{const tt=document.querySelector('div.tiptap.ProseMirror');const p=tt.querySelectorAll('p')[${slot.paraIndex}];if(!p)return null;const r=p.getBoundingClientRect();return {x:Math.floor(r.right-5),y:Math.floor(r.y+r.height/2)};})()`,
      )
      if (!coords) {
        emojiResults.push(`${slot.paraIndex}:${slug}:no-para`)
        continue
      }
      // CDP trusted click on paragraph → PM moves caret to end of that line.
      await debuggerSend(targetId, 'Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x: coords.x,
        y: coords.y,
        button: 'left',
        clickCount: 1,
      })
      await debuggerSend(targetId, 'Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x: coords.x,
        y: coords.y,
        button: 'left',
        clickCount: 1,
      })
      // Step 2-4: synthetic chain opens panel + clicks target emoji.
      const raw = await debuggerSend(targetId, 'Runtime.evaluate', {
        awaitPromise: true,
        returnByValue: true,
        expression: `(async () => {
          // Ensure caret at end of paragraph in case the CDP click
          // landed slightly inside the last word.
          const tt = document.querySelector('div.tiptap.ProseMirror');
          const p = tt.querySelectorAll('p')[${slot.paraIndex}];
          if (!p) return 'no-para';
          const r = document.createRange(); r.selectNodeContents(p); r.collapse(false);
          const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
          // Open emoji panel.
          const btn = document.getElementById('emoticonsBtn');
          if (!btn) return 'no-btn';
          const br = btn.getBoundingClientRect();
          const bOpts = {bubbles:true,cancelable:true,view:window,clientX:br.x+br.width/2,clientY:br.y+br.height/2,button:0,pointerType:'mouse'};
          btn.dispatchEvent(new PointerEvent('pointerdown',bOpts));
          btn.dispatchEvent(new MouseEvent('mousedown',bOpts));
          btn.dispatchEvent(new PointerEvent('pointerup',bOpts));
          btn.dispatchEvent(new MouseEvent('mouseup',bOpts));
          btn.dispatchEvent(new MouseEvent('click',bOpts));
          let items = null;
          for (let i = 0; i < 30; i++) {
            await new Promise(r => setTimeout(r, 100));
            items = document.querySelectorAll('.emoticons-item');
            if (items.length > 0) break;
          }
          if (!items || items.length === 0) return 'panel-not-open';
          const arr = [...items];
          const idx = arr.findIndex(it => (it.querySelector('img')?.src || '').includes('xy_emotion_redclub_${slug}.'));
          if (idx < 0) return 'no-emoji';
          const e = arr[idx];
          const rect = e.getBoundingClientRect();
          const opts = {bubbles:true,cancelable:true,view:window,clientX:rect.x+rect.width/2,clientY:rect.y+rect.height/2,button:0,pointerType:'mouse'};
          e.dispatchEvent(new PointerEvent('pointerdown',opts));
          e.dispatchEvent(new MouseEvent('mousedown',opts));
          e.dispatchEvent(new PointerEvent('pointerup',opts));
          e.dispatchEvent(new MouseEvent('mouseup',opts));
          e.dispatchEvent(new MouseEvent('click',opts));
          // After insertion, fire a synthetic click on document.body to
          // trigger the popover's click-outside close handler. Escape key
          // isn't wired by XHS; click-outside is. We then poll until
          // .emoticons-item vanishes so the next iteration's CDP click on
          // the target paragraph can't accidentally land on a still-open
          // popover item (that was the source of the extra 偷笑R / 汗颜R).
          await new Promise(r => setTimeout(r, 100));
          const closeOpts = {bubbles:true,cancelable:true,view:window,clientX:1,clientY:1,button:0,pointerType:'mouse'};
          document.body.dispatchEvent(new PointerEvent('pointerdown',closeOpts));
          document.body.dispatchEvent(new MouseEvent('mousedown',closeOpts));
          document.body.dispatchEvent(new PointerEvent('pointerup',closeOpts));
          document.body.dispatchEvent(new MouseEvent('mouseup',closeOpts));
          document.body.dispatchEvent(new MouseEvent('click',closeOpts));
          for (let i = 0; i < 20; i++) {
            await new Promise(r => setTimeout(r, 50));
            if (document.querySelectorAll('.emoticons-item').length === 0) break;
          }
          return 'ok';
        })()`,
      })
      const rawResult = (raw as { result?: { value?: string } })?.result?.value ?? 'unknown'
      emojiResults.push(`${slot.paraIndex}:${slug}:${rawResult}`)
      console.log(`[xhs_post] emoji ${slot.paraIndex}:${slug} → ${rawResult}`)
      await new Promise((r) => setTimeout(r, 150))
    }
    log('emojis inserted')
  }

  // 6. Tags via tiptap's # suggestion dropdown (NOT the recommended pills).
  //    Why: recommended pills are IMAGE-driven (logo-rainbow → rainbow
  //    pills), rarely relevant to the actual body. The in-editor `#`
  //    suggestion is BODY-driven (typing `#API` pulls up `#AI编程
  //    #ChatGPT #API` etc.) — much more on-topic.
  //
  //    Flow per tag:
  //      - execCommand insertText `#` + userTag (or just `#` for auto-fill hot)
  //      - poll `[data-tippy-root] .item` to appear
  //      - click first item whose .name contains userTag (case-insensitive),
  //        else first item
  //      - tiptap replaces the suggestion span with a <a.tiptap-topic> node;
  //        add a space separator for the next tag
  //      - deduplicate so we don't insert the same topic twice
  const userTags = payload.tags ?? []
  const autoFill = payload.autoFillTags !== false
  const minTags = payload.minTags ?? 3
  const tagLog: string[] = []
  if (userTags.length > 0 || autoFill) {
    // Prep: CDP trusted click on last body paragraph + 2×Enter. Puts
    // caret on a new paragraph separated from the body by one blank
    // paragraph (visual "empty line" between body and tag line).
    const endCoords = await evalExpr<{ x: number; y: number } | null>(
      targetId,
      `(()=>{const tt=document.querySelector('div.tiptap.ProseMirror');const ps=tt.querySelectorAll('p');if(ps.length===0)return null;const p=ps[ps.length-1];const r=p.getBoundingClientRect();return {x:Math.floor(r.right-5),y:Math.floor(r.y+r.height/2)};})()`,
    )
    if (endCoords) {
      await debuggerSend(targetId, 'Input.dispatchMouseEvent', {
        type: 'mousePressed', x: endCoords.x, y: endCoords.y, button: 'left', clickCount: 1,
      })
      await debuggerSend(targetId, 'Input.dispatchMouseEvent', {
        type: 'mouseReleased', x: endCoords.x, y: endCoords.y, button: 'left', clickCount: 1,
      })
      for (let i = 0; i < 2; i++) {
        await debuggerSend(targetId, 'Input.dispatchKeyEvent', {
          type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
        })
        await debuggerSend(targetId, 'Input.dispatchKeyEvent', {
          type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
        })
      }
    }
    // Single eval that loops through user tags + auto-fill. Keeping it
    // in-page means consecutive inserts share PM focus and dropdown
    // state, avoiding the caret-reset races we hit earlier with emojis.
    const tagsJs = JSON.stringify(userTags)
    const raw = await debuggerSend(targetId, 'Runtime.evaluate', {
      awaitPromise: true,
      returnByValue: true,
      expression: `(async()=>{
        const userTags = ${tagsJs};
        const minTags = ${minTags};
        const autoFill = ${autoFill};
        const clicked = new Set();
        const logArr = [];
        async function selectTopic(searchTerm, reason) {
          // Type '#' + searchTerm into the editor at current caret.
          document.execCommand('insertText', false, '#');
          if (searchTerm) document.execCommand('insertText', false, searchTerm);
          // Wait for tippy dropdown to mount.
          let items = [];
          for (let i = 0; i < 30; i++) {
            await new Promise(r => setTimeout(r, 100));
            items = [...document.querySelectorAll('[data-tippy-root] .item')];
            if (items.length > 0) break;
          }
          if (items.length === 0) {
            logArr.push('miss:' + (searchTerm || '<auto>') + ':no-dropdown');
            // The dropdown never showed, so the '#' + searchTerm we typed
            // is still sitting in the editor as plain text. We need to
            // (a) press Escape so tiptap closes any half-open suggestion
            // span (otherwise the next '#' gets folded into THIS span and
            // XHS publishes them concatenated as "#OOTD#显瘦穿搭"), and
            // (b) leave a trailing space so the next '#' has a clean
            // separator. Same recovery applies when no item is clickable
            // (all-dup case below).
            const t = document.querySelector('div.tiptap.ProseMirror');
            t.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',keyCode:27,which:27,bubbles:true,cancelable:true}));
            t.dispatchEvent(new KeyboardEvent('keyup',{key:'Escape',keyCode:27,which:27,bubbles:true,cancelable:true}));
            await new Promise(r => setTimeout(r, 50));
            document.execCommand('insertText', false, ' ');
            return false;
          }
          // Pick best match: first item whose .name contains searchTerm
          // (case-insensitive), else first item. Skip already-clicked.
          let target = null;
          const low = (searchTerm || '').toLowerCase();
          for (const it of items) {
            const name = (it.querySelector('.name')?.textContent || '').trim();
            if (clicked.has(name)) continue;
            if (!searchTerm || name.toLowerCase().includes(low)) {
              target = it;
              break;
            }
          }
          if (!target) {
            target = items.find(it => {
              const name = (it.querySelector('.name')?.textContent || '').trim();
              return !clicked.has(name);
            }) || null;
          }
          if (!target) {
            logArr.push('miss:' + (searchTerm || '<auto>') + ':all-dup');
            // Same recovery as the no-dropdown path: close the suggestion
            // span + leave a separator space so the next '#' lands cleanly.
            const t = document.querySelector('div.tiptap.ProseMirror');
            t.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',keyCode:27,which:27,bubbles:true,cancelable:true}));
            t.dispatchEvent(new KeyboardEvent('keyup',{key:'Escape',keyCode:27,which:27,bubbles:true,cancelable:true}));
            await new Promise(r => setTimeout(r, 50));
            document.execCommand('insertText', false, ' ');
            return false;
          }
          const name = (target.querySelector('.name')?.textContent || '').trim();
          const r = target.getBoundingClientRect();
          const opts = {bubbles:true,cancelable:true,view:window,clientX:r.x+r.width/2,clientY:r.y+r.height/2,button:0,pointerType:'mouse'};
          target.dispatchEvent(new PointerEvent('pointerdown',opts));
          target.dispatchEvent(new MouseEvent('mousedown',opts));
          target.dispatchEvent(new PointerEvent('pointerup',opts));
          target.dispatchEvent(new MouseEvent('mouseup',opts));
          target.dispatchEvent(new MouseEvent('click',opts));
          clicked.add(name);
          logArr.push(reason + ':' + name);
          // Wait for tiptap to convert the suggestion span into a topic node.
          await new Promise(r => setTimeout(r, 300));
          // Space separator for the next tag.
          document.execCommand('insertText', false, ' ');
          return true;
        }
        for (const userTag of userTags) {
          await selectTopic(userTag, 'user:' + userTag);
        }
        if (autoFill) {
          while (clicked.size < minTags) {
            const ok = await selectTopic('', 'auto');
            if (!ok) break;
          }
        }
        return logArr;
      })()`,
    })
    const got = ((raw as { result?: { value?: string[] } })?.result?.value ?? []) as string[]
    tagLog.push(...got)
    console.log(`[xhs_post] tags: ${tagLog.join(' / ')}`)
    log('tags selected')
  }

  // 7. Collect final state (for return value)
  const state = await evalExpr<{
    paragraphs: string[]
    title: string
    imageCount: number
    topics: string[]
    emojis: string[]
  }>(
    targetId,
    `(()=>{
      const ti = [...document.querySelectorAll('input.d-text')].find(i => i.placeholder === '填写标题会有更多赞哦');
      const tt = document.querySelector('div.tiptap.ProseMirror');
      const paragraphs = [...tt.querySelectorAll('p')].map(p => {
        const parts = [];
        for (const c of p.childNodes) {
          if (c.nodeType === 3) parts.push(c.textContent);
          else if (c.tagName === 'IMG' && c.dataset.emoji) parts.push('{' + (c.dataset.emoji.match(/\\[([^\\]]+)\\]/)?.[1] || '?') + '}');
          else if (c.tagName === 'A' && c.classList.contains('tiptap-topic')) {
            try { parts.push('#' + JSON.parse(c.getAttribute('data-topic')).name); } catch {}
          }
        }
        return parts.join('');
      });
      return {
        paragraphs,
        title: ti?.value || '',
        imageCount: document.querySelectorAll('.flex-list > .pr').length,
        topics: [...tt.querySelectorAll('a.tiptap-topic')].map(a => {try { return JSON.parse(a.getAttribute('data-topic')).name; } catch { return ''; }}),
        emojis: [...tt.querySelectorAll('img.tiptap-custom-image')].map(i => (i.getAttribute('data-emoji') || '').match(/\\[([^\\]]+)\\]/)?.[1] || '?'),
      };
    })()`,
  )
  log('state collected')

  // 8. Publish if requested. Safety: only trust explicit true.
  // Inject a fetch/XHR interceptor BEFORE clicking publish, so any XHS
  // internal API call from the submit triggers a buffered response we
  // can inspect for the noteId. CDP Network domain is harder here —
  // the tab navigates to /publish/success almost immediately and the
  // CDP buffer gets reset on frame change.
  let published = false
  let noteId: string | null = null
  let noteUrl: string | null = null
  const responseBuffer: Array<{ url: string; status: number; body: string }> = []
  if (payload.publish === true) {
    // Hard prereq: every uploaded image must be in steady state. Without
    // this we'd race xhscdn — XHS shows "图片正在上传，请稍后再发布"
    // and the publish never fires.
    await waitForXhsUploadsComplete(targetId, payload.images.length)
    log('uploads verified complete')

    await evalExpr(
      targetId,
      `(()=>{
        if (window.__bnbotPubHooked) { window.__bnbotPubResps = []; return; }
        window.__bnbotPubHooked = true;
        window.__bnbotPubResps = [];
        const push = (url, status, body) => {
          try { window.__bnbotPubResps.push({url: String(url), status, body: String(body || '').slice(0, 20000)}); } catch {}
        };
        const origFetch = window.fetch;
        window.fetch = async function(input, init) {
          const url = typeof input === 'string' ? input : (input?.url || '');
          const resp = await origFetch.apply(this, arguments);
          try {
            if (/note|publish|post/i.test(url)) {
              const text = await resp.clone().text();
              push(url, resp.status, text);
            }
          } catch {}
          return resp;
        };
        const origOpen = XMLHttpRequest.prototype.open;
        const origSend = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.open = function(method, url) {
          this.__bnbotUrl = url;
          return origOpen.apply(this, arguments);
        };
        XMLHttpRequest.prototype.send = function() {
          this.addEventListener('load', () => {
            try {
              if (/note|publish|post/i.test(this.__bnbotUrl)) {
                push(this.__bnbotUrl, this.status, this.responseText);
              }
            } catch {}
          });
          return origSend.apply(this, arguments);
        };
      })()`,
    )
    // Click publish (same synthetic chain as before). If XHS still rejects
    // with the upload-pending toast (waitForXhsUploadsComplete signals
    // were imperfect / race), back off and retry once after re-checking.
    const clickPublish = `(()=>{const btn=document.querySelector('button.custom-button.bg-red');if(!btn)throw new Error('publish button not found');const r=btn.getBoundingClientRect();const opts={bubbles:true,cancelable:true,view:window,clientX:r.x+r.width/2,clientY:r.y+r.height/2,button:0,pointerType:'mouse'};btn.dispatchEvent(new PointerEvent('pointerdown',opts));btn.dispatchEvent(new MouseEvent('mousedown',opts));btn.dispatchEvent(new PointerEvent('pointerup',opts));btn.dispatchEvent(new MouseEvent('mouseup',opts));btn.dispatchEvent(new MouseEvent('click',opts));})()`
    await evalExpr(targetId, clickPublish)
    let blockedToast = await detectXhsPublishBlockedToast(targetId)
    if (blockedToast) {
      log(`publish blocked: ${blockedToast} — backing off then retrying once`)
      await new Promise((r) => setTimeout(r, 5_000))
      await waitForXhsUploadsComplete(targetId, payload.images.length)
      await evalExpr(targetId, clickPublish)
      blockedToast = await detectXhsPublishBlockedToast(targetId)
      if (blockedToast) {
        throw new Error(`xhs publish blocked after retry: ${blockedToast}`)
      }
      log('publish retry succeeded')
    }
    published = true
    // Poll responses. Stop when: we extract a noteId, OR the window got
    // replaced (navigate to /publish/success), OR we time out.
    const deadline = Date.now() + 12_000
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 150))
      const resps = await evalExpr<Array<{ url: string; status: number; body: string }> | null>(
        targetId,
        `typeof window.__bnbotPubResps !== 'undefined' ? window.__bnbotPubResps : null`,
      ).catch(() => null)
      // Window wiped by navigation — last-read buffer is all we get.
      if (resps === null) break
      for (const r of resps) {
        if (responseBuffer.some((b) => b.url === r.url && b.status === r.status)) continue
        responseBuffer.push(r)
      }
      // Search for noteId in any buffered body.
      for (const r of responseBuffer) {
        const id = extractNoteId(r.body)
        if (id) {
          noteId = id
          noteUrl = `https://www.xiaohongshu.com/explore/${id}`
          break
        }
      }
      if (noteId) break
      // Also stop early if the tab already navigated to success.
      const url = await evalExpr<string>(targetId, `location.href`).catch(() => '')
      if (url && url.includes('/publish/success')) {
        // One more pull of the buffer (may still hold the response).
        const finalResps = await evalExpr<
          Array<{ url: string; status: number; body: string }> | null
        >(targetId, `typeof window.__bnbotPubResps !== 'undefined' ? window.__bnbotPubResps : null`).catch(
          () => null,
        )
        if (finalResps) {
          for (const r of finalResps) {
            if (!responseBuffer.some((b) => b.url === r.url)) responseBuffer.push(r)
            const id = extractNoteId(r.body)
            if (id) {
              noteId = id
              noteUrl = `https://www.xiaohongshu.com/explore/${id}`
              break
            }
          }
        }
        break
      }
    }
    log(`publish done noteId=${noteId ?? 'none'}`)
  }

  log('done')
  return {
    tabId,
    composed: true,
    published,
    noteId,
    noteUrl,
    publishResponses: responseBuffer.map((r) => ({
      url: r.url,
      status: r.status,
      bodyPreview: r.body.slice(0, 500),
    })),
    emojiResults,
    tagResults: tagLog,
    ...state,
  }
}

/** Scan a response body string for an XHS note ID. XHS uses multiple
 *  endpoint shapes — some put the id under `data.id`, some under
 *  `note.id`, some under `noteId`. Try all known fields, then fall back
 *  to regex match of the 24-char hex pattern that follows `note` words. */
function extractNoteId(body: string): string | null {
  if (!body || body.length === 0) return null
  // Direct JSON parse.
  try {
    const j = JSON.parse(body)
    const cand =
      j?.data?.id ||
      j?.data?.note?.id ||
      j?.data?.noteId ||
      j?.data?.note_id ||
      j?.noteId ||
      j?.note_id ||
      j?.id
    if (typeof cand === 'string' && /^[a-f0-9]{24}$/i.test(cand)) return cand
  } catch {
    /* body not JSON */
  }
  // Regex fallback for XHS's 24-hex note ids that appear near "note".
  const m = body.match(/"(?:note_?id|id)"\s*:\s*"([a-f0-9]{24})"/i)
  if (m) return m[1]
  return null
}
