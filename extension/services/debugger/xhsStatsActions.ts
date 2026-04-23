/**
 * XHS (creator.xiaohongshu.com) statistics scrapers.
 *
 * Two reads:
 *   - `getXhsNoteStats(noteId)` — /statistics/note-detail?noteId=<id>
 *     Scrapes `.block-container` cards: 曝光数/观看数/封面点击率/平均观看时长/
 *     涨粉数 (核心数据) + 点赞/评论/收藏/分享 (互动数据).
 *   - `getXhsAccountStats()` — /statistics/account/v2
 *     Scrapes `.datas > .creator-block` cards for the currently selected
 *     tab (default 观看数据 / 近7日). Returns one object per tab if we
 *     iterate.
 *
 * Both use the same pool / debugger infrastructure as postXhsNote.
 */
import { debuggerSend, ensureDebuggerAttached, getTab } from '../scraperService'
import { evalExpr } from './debuggerOps'

export interface XhsMetric {
  label: string
  /** Raw textual value as rendered (e.g. "576", "20.7%", "13秒", "-"). */
  value: string
  /** Change-vs-previous-period text ("+372%", "-10%", "-"). null if absent. */
  delta: string | null
}

export interface XhsNoteStatsResult {
  noteId: string
  url: string
  title: string
  tags: string[]
  publishedAt: string
  coreMetrics: XhsMetric[]
  interactionMetrics: XhsMetric[]
}

export interface XhsAccountStatsResult {
  url: string
  tab: string
  /** Current date-range label visible in the UI (e.g. "近7日"). */
  range: string
  metrics: XhsMetric[]
}

/** Wait for a DOM predicate to become true. Used between SPA nav + hydrate
 *  since creator.xiaohongshu.com lazy-renders the stats widgets. */
async function pollEval(targetId: string, expr: string, timeoutMs: number): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const ok = await evalExpr<boolean>(targetId, expr).catch(() => false)
    if (ok) return
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`pollEval timed out: ${expr}`)
}

async function prepareStatsTab(url: string): Promise<{ tabId: number; targetId: string }> {
  const tabId = await getTab(url)
  // Un-minimize the pool window — Chrome throttles JS in minimized
  // windows and Vue never hydrates, leaving stats DOM empty.
  const tab = await chrome.tabs.get(tabId).catch(() => null)
  if (tab?.windowId != null) {
    await chrome.windows.update(tab.windowId, { state: 'normal', focused: false }).catch(() => {})
  }
  const targetId = await ensureDebuggerAttached(tabId, ['Page', 'Runtime', 'DOM'])
  await debuggerSend(targetId, 'Page.navigate', { url })
  return { tabId, targetId }
}

export async function getXhsNoteStats(noteId: string): Promise<XhsNoteStatsResult> {
  if (!/^[a-f0-9]{24}$/i.test(noteId)) throw new Error(`getXhsNoteStats: bad noteId ${noteId}`)
  const url = `https://creator.xiaohongshu.com/statistics/note-detail?noteId=${noteId}`
  const { targetId } = await prepareStatsTab(url)
  // Wait for at least one .block-container to render.
  await pollEval(targetId, `document.querySelectorAll('.block-container').length > 0`, 15_000)
  // Give lazy-load a moment to finish filling values (hydrate on load then
  // another render after numbers arrive from backend).
  await new Promise((r) => setTimeout(r, 500))
  const state = await evalExpr<XhsNoteStatsResult>(
    targetId,
    `(()=>{
      const bodyText = document.body.innerText || '';
      // .note-title holds just the note title (not the "笔记数据详情"
      // page heading or any sidebar labels).
      const title = (document.querySelector('.note-title')?.textContent || '').trim();
      // Tag nodes inside the note-info-container show the topics that
      // were attached at publish time. Each is prefixed with #.
      const tags = [...document.querySelectorAll('.note-info-container [class*=tag],.note-info-container a,.note-info-container span')]
        .map(e => (e.textContent || '').trim())
        .filter(t => t.startsWith('#') && !t.includes(' ') && t.length < 40)
        .filter((t, i, a) => a.indexOf(t) === i);
      const dateMatch = bodyText.match(/\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}/);
      const publishedAt = dateMatch ? dateMatch[0] : '';
      function readBlock(b) {
        // Label is in .des (e.g. "曝光数"). The element also contains a
        // tooltip icon/span — strip nested text to just the first text node.
        const desEl = b.querySelector('.des');
        let label = '';
        if (desEl) {
          // Prefer the direct text content (before the tooltip icon).
          const firstText = [...desEl.childNodes].find(n => n.nodeType === 3);
          label = (firstText ? firstText.textContent : desEl.textContent || '').trim();
        }
        const valueEl = b.querySelector('.content');
        const value = valueEl ? (valueEl.textContent || '').trim() : '-';
        const deltaEl = b.querySelector('.text-with-fans');
        const delta = deltaEl ? (deltaEl.textContent || '').trim() : null;
        return { label, value, delta };
      }
      const allBlocks = [...document.querySelectorAll('.block-container')].map(readBlock);
      // XHS separates core (曝光/观看/点击率/时长/涨粉) from interaction
      // (点赞/评论/收藏/分享). Labels give us the split.
      const coreLabels = new Set(['曝光数','观看数','封面点击率','平均观看时长','观看总时长','涨粉数','视频完播率']);
      const interactLabels = new Set(['点赞数','评论数','收藏数','分享数','互动数']);
      return {
        noteId: ${JSON.stringify(noteId)},
        url: location.href,
        title,
        tags,
        publishedAt,
        coreMetrics: allBlocks.filter(m => coreLabels.has(m.label)),
        interactionMetrics: allBlocks.filter(m => interactLabels.has(m.label)),
      };
    })()`,
  )
  return state
}

export async function getXhsAccountStats(): Promise<XhsAccountStatsResult[]> {
  const url = 'https://creator.xiaohongshu.com/statistics/account/v2'
  const { targetId } = await prepareStatsTab(url)
  // Wait for the tab nav + at least one data card.
  await pollEval(
    targetId,
    `document.querySelectorAll('.d-tabs-header').length > 0 && document.querySelectorAll('.datas .creator-block').length > 0`,
    15_000,
  )
  await new Promise((r) => setTimeout(r, 400))
  // Iterate through the four top-level tabs (观看/互动/涨粉/发布), click
  // each, wait for .creator-block to re-render, scrape.
  const results: XhsAccountStatsResult[] = []
  const tabs = await evalExpr<string[]>(
    targetId,
    `[...document.querySelectorAll('.d-tabs-header')].map(h => (h.textContent||'').trim()).filter(t => t)`,
  )
  for (let i = 0; i < tabs.length; i++) {
    const tabName = tabs[i]
    // Click tab header i. Synthetic click works for these headers.
    await evalExpr(
      targetId,
      `(()=>{
        const headers = [...document.querySelectorAll('.d-tabs-header')];
        const h = headers[${i}];
        if (!h) return;
        const r = h.getBoundingClientRect();
        const opts = {bubbles:true,cancelable:true,view:window,clientX:r.x+r.width/2,clientY:r.y+r.height/2,button:0,pointerType:'mouse'};
        h.dispatchEvent(new PointerEvent('pointerdown',opts));
        h.dispatchEvent(new MouseEvent('mousedown',opts));
        h.dispatchEvent(new PointerEvent('pointerup',opts));
        h.dispatchEvent(new MouseEvent('mouseup',opts));
        h.dispatchEvent(new MouseEvent('click',opts));
      })()`,
    )
    // Wait for cards to reflect the new tab. Simple sleep — the tab
    // swap is instant for the cards even when chart redraws asynchronously.
    await new Promise((r) => setTimeout(r, 600))
    const snapshot = await evalExpr<XhsAccountStatsResult>(
      targetId,
      `(()=>{
        const activeHeader = document.querySelector('.d-tabs-header.d-tabs-header-active') ||
                             document.querySelector('.d-tabs-header[class*=active]');
        const tab = activeHeader ? (activeHeader.textContent || '').trim() : ${JSON.stringify(tabName)};
        const rangeEl = [...document.querySelectorAll('*')].find(e => {
          const t = (e.textContent || '').trim();
          return (t === '近7日' || t === '近30日') && e.children.length === 0 && e.offsetParent !== null;
        });
        const range = rangeEl ? (rangeEl.textContent || '').trim() : '';
        const metrics = [...document.querySelectorAll('.datas .creator-block')].map(b => {
          const label = (b.querySelector('.title')?.textContent || '').trim();
          const value = (b.querySelector('.number-container')?.textContent || '-').trim();
          const upDown = b.querySelector('.tendency-number.up,.tendency-number.down');
          const delta = upDown ? (upDown.textContent || '').trim() : null;
          return { label, value, delta };
        });
        return { url: location.href, tab, range, metrics };
      })()`,
    )
    results.push(snapshot)
  }
  return results
}
