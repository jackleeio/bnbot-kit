/**
 * Account verify + switch driven by chrome.debugger (CDP). The pool
 * window shares Chrome's default profile cookies, so the "active" X
 * account is whatever the user last logged in / switched to there.
 * We never log in fresh — we only switch among accounts already present
 * in X's built-in account picker (SideNav_AccountSwitcher → UserCell).
 *
 * Why this exists alongside the DOM-engine `switch_account` handler
 * in actions/navigationActions.ts: that handler runs as a content
 * script inside the user's active x.com tab. The debugger engine
 * writes go through the isolated pool window, which is a different
 * X session view — content scripts there are not the right venue.
 * This file is the CDP twin.
 */

import {
  bringTabToFront,
  clickSelector,
  evalExpr,
  prepareTab,
  registerEventListener,
  sleep,
  waitForSelector,
} from './debuggerOps'
import { debuggerSend } from '../scraperService'

/** Page-side reader. Stringified into the pool window via evalExpr,
 *  so it must be self-contained (no external refs, no TS types in body). */
function getCurrentUsernameInPage(): string | null {
  // 1. AppTabBar profile link — present on most pages.
  const profileLink = document.querySelector('a[href^="/"][data-testid="AppTabBar_Profile_Link"]')
  if (profileLink) {
    const href = profileLink.getAttribute('href') || ''
    const slug = href.replace(/^\//, '')
    if (slug) return slug
  }
  // 2. Account switcher button at the bottom of the side nav — shows @handle.
  const switcher = document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]')
  if (switcher) {
    const spans = switcher.querySelectorAll('span')
    for (const s of spans) {
      const t = (s.textContent || '').trim()
      if (t.startsWith('@')) return t.slice(1)
    }
  }
  // 3. Fallback to URL pathname when on a profile page.
  const m = window.location.pathname.match(/^\/([a-zA-Z0-9_]+)(?:\/|$)/)
  if (m) {
    const SYSTEM = new Set([
      'home', 'explore', 'search', 'notifications', 'messages', 'i',
      'settings', 'compose', 'jobs', 'lists', 'bookmarks',
    ])
    if (!SYSTEM.has(m[1])) return m[1]
  }
  return null
}

/** Page-side matcher: find the UserCell in the open account-switcher
 *  menu whose username equals `want` (case-insensitive) and click it.
 *  Returns whether a cell was matched. Must be self-contained. */
function matchAndClickUserCell(want: string): boolean {
  const cells = document.querySelectorAll('[data-testid="UserCell"]') as NodeListOf<HTMLElement>
  for (const cell of cells) {
    // 1. aria-label like "Switch to @ClawMoneyAI" / "切换到 @ClawMoneyAI"
    const label = (cell.getAttribute('aria-label') || '').toLowerCase()
    if (label.includes('@' + want) || label.endsWith(' ' + want) || label.endsWith(want)) {
      cell.click()
      return true
    }
    // 2. UserAvatar-Container-<handle> nested testid (case-insensitive)
    const avatars = cell.querySelectorAll('[data-testid]')
    for (const a of avatars) {
      const t = (a.getAttribute('data-testid') || '').toLowerCase()
      if (t === 'useravatar-container-' + want) {
        cell.click()
        return true
      }
    }
    // 3. Inner @username span fallback
    const spans = cell.querySelectorAll('span')
    for (const s of spans) {
      const txt = (s.textContent || '').trim().toLowerCase()
      if (txt === '@' + want) {
        cell.click()
        return true
      }
    }
  }
  return false
}

export interface CurrentUsernameResult {
  username: string | null
}

/** Read the active X handle inside the pool window. Lands on /home
 *  (cheap, doesn't reload if already there) and runs the three-way
 *  fallback above. */
export async function getCurrentUsernameViaDebugger(): Promise<CurrentUsernameResult> {
  const target = await prepareTab('https://x.com/home')
  // Wait until at least one of the three fallback anchors is in the DOM.
  // SPA route can be /home but React hasn't hydrated the side nav yet —
  // returning null prematurely would force a false "switch needed".
  const started = Date.now()
  while (Date.now() - started < 8_000) {
    const ready = await evalExpr<boolean>(
      target.targetId,
      `!!document.querySelector('[data-testid="AppTabBar_Profile_Link"]') || !!document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]')`,
    )
    if (ready) break
    await sleep(250)
  }
  const username = await evalExpr<string | null>(
    target.targetId,
    `(${getCurrentUsernameInPage.toString()})()`,
  )
  return { username }
}

export interface SwitchAccountArgs {
  username: string
}

export interface SwitchAccountResult {
  switchedTo: string
  alreadyActive?: boolean
  durationMs: number
}

/** Ensure the pool window's active X session is `args.username`. Cheap
 *  no-op when already on it; otherwise opens the account switcher and
 *  clicks the matching UserCell. X triggers a full reload on switch,
 *  so we wait for the side nav to re-hydrate, then verify the new
 *  active handle matches.
 *
 *  Throws on any unrecoverable failure (target not in switcher, verify
 *  timeout, etc). The background WS bridge wraps thrown errors into
 *  `action_result { success: false }` at the envelope level, which is
 *  what CLI consumers (`ensureAccount`, `runCliAction`) actually look
 *  at. Returning `{ success: false }` here used to silently let the
 *  caller-side outer-envelope-success check pass, masking switch
 *  failures — don't reintroduce that.
 */
export async function switchAccountViaDebugger(args: SwitchAccountArgs): Promise<SwitchAccountResult> {
  const started = Date.now()
  const want = args.username.replace(/^@/, '').toLowerCase()
  if (!want) {
    throw new Error('username is empty')
  }

  const target = await prepareTab('https://x.com/home')
  const fastBefore = await evalExpr<string | null>(
    target.targetId,
    `(${getCurrentUsernameInPage.toString()})()`,
  ).catch(() => null)
  if (fastBefore && fastBefore.toLowerCase() === want) {
    return { switchedTo: fastBefore, alreadyActive: true, durationMs: Date.now() - started }
  }

  // X throttles input events on minimized windows — clicking the
  // account switcher won't open the dropdown when the window is
  // hidden. Un-minimize for the duration, restore prior state in
  // `finally`. Pattern stolen from postViaDebugger.
  const restore = await bringTabToFront(target.tabId)

  // Auto-accept any JavaScript dialog the page throws during the
  // switch. The common case is the beforeunload "Leave site?
  // Changes you made may not be saved." prompt that fires when a
  // composer with unsaved content is open and we navigate away via
  // the account switcher. That prompt is a Chrome-native dialog
  // (not page DOM), so Escape / clickSelector can't dismiss it —
  // CDP's Page.handleJavaScriptDialog is the only correct API.
  // We always accept (== click Leave) because the user explicitly
  // asked for a switch; preserving the half-typed draft on the
  // wrong account would be more confusing than losing it.
  await debuggerSend(target.targetId, 'Page.enable', {}).catch(() => {})
  const dialogCleanup = registerEventListener(target.targetId, (method, _params) => {
    if (method !== 'Page.javascriptDialogOpening') return
    debuggerSend(target.targetId, 'Page.handleJavaScriptDialog', {
      accept: true,
    }).catch(() => {})
  }, target.tabId)

  try {
    // 0a. Hard guard: ensure no composer modal is open before we
    //     click the account switcher. Two reasons this matters:
    //
    //     (1) Clicking SideNav_AccountSwitcher_Button while a
    //         composer is up does nothing (the modal traps focus).
    //     (2) Once we click a UserCell to switch, X reloads the
    //         page, which re-fires the beforeunload prompt against
    //         any composer with unsaved content. The prepareTab
    //         auto-accept handles the first one (during initial
    //         /home nav); this second prompt during the switch
    //         reload would happen too — but we sidestep it
    //         entirely by closing the composer first.
    //
    //     X's confirmation sheet has localized labels, so prefer
    //     a visible "Discard"/"放弃"/"丢弃" button and fall back to
    //     confirmationSheetCancel. We loop because closing the modal
    //     + dismissing the confirmation is a two-click flow that
    //     can need retries on slow renders. 4 iterations × ~400ms
    //     == ~1.6s max overhead in the worst case; the common
    //     case (no composer open) exits on first iteration.
    for (let i = 0; i < 4; i++) {
      const hasComposer = await evalExpr<boolean>(
        target.targetId,
        `!!document.querySelector('[data-testid="tweetTextarea_0"]')`,
      ).catch(() => false)
      if (!hasComposer) break
      await evalExpr(target.targetId, `(function(){
        const btn = document.querySelector('[data-testid="app-bar-close"]')
                 || document.querySelector('[role="dialog"] [aria-label="Close"]')
                 || document.querySelector('[role="dialog"] [aria-label="关闭"]');
        if (btn) (btn).click();
      })()`).catch(() => {})
      await sleep(300)
      await evalExpr(target.targetId, `(function(){
        const sheet = document.querySelector('[data-testid="confirmationSheetDialog"]')
          || Array.from(document.querySelectorAll('[role="dialog"]')).find((el) =>
            /draft|草稿|save|保存|discard|放弃|丢弃|舍弃/i.test(String(el.innerText || el.textContent || ''))
          );
        if (!sheet) return;
        const textOf = (el) => String(el?.innerText || el?.textContent || '').trim();
        const buttons = Array.from(sheet.querySelectorAll('[role="button"], button'));
        const discard = buttons.find((el) => /discard|放弃|丢弃|舍弃|删除/i.test(textOf(el)))
          || sheet.querySelector('[data-testid="confirmationSheetCancel"]');
        if (discard) discard.click();
      })()`).catch(() => {})
      await sleep(300)
    }

    // 0. Wait for side nav to be present, then read current handle.
    await waitForSelector(
      target.targetId,
      '[data-testid="SideNav_AccountSwitcher_Button"]',
      10_000,
    )
    const before = await evalExpr<string | null>(
      target.targetId,
      `(${getCurrentUsernameInPage.toString()})()`,
    )
    if (before && before.toLowerCase() === want) {
      return { switchedTo: before, alreadyActive: true, durationMs: Date.now() - started }
    }

    // 1. Open the account switcher menu.
    await clickSelector(target.targetId, '[data-testid="SideNav_AccountSwitcher_Button"]')
    // 2. Wait for at least one UserCell to render in the popover.
    await waitForSelector(target.targetId, '[role="menu"] [data-testid="UserCell"], [data-testid="UserCell"]', 5_000)

    // 3. Poll-match-and-click until the TARGET cell appears (X
    //    renders the menu items incrementally — current account
    //    lands first, others can lag a beat or two behind). Without
    //    this poll the matcher races the DOM and we falsely return
    //    "not in switcher" for accounts that genuinely are logged
    //    in. 5s is generous; in practice it matches in <500ms.
    const matchDeadline = Date.now() + 5_000
    let matched = false
    while (Date.now() < matchDeadline) {
      matched = await evalExpr<boolean>(
        target.targetId,
        `(${matchAndClickUserCell.toString()})(${JSON.stringify(want)})`,
      )
      if (matched) break
      await sleep(250)
    }
    if (!matched) {
      // Close the menu so the next action starts from a clean DOM.
      await evalExpr(
        target.targetId,
        `document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))`,
      ).catch(() => {})
      throw new Error(
        `account @${want} not in switcher — not logged in on this Chrome profile?`,
      )
    }

    // 4. X performs a hard reload on switch. The CDP target survives
    //    (same tab), but the side nav unmounts + remounts. Wait for
    //    the new handle to read back as `want`. Poll up to 15s — slow
    //    networks on a fresh /home land plus React hydration can take
    //    several seconds.
    const deadline = Date.now() + 15_000
    let last: string | null = null
    while (Date.now() < deadline) {
      await sleep(500)
      try {
        last = await evalExpr<string | null>(
          target.targetId,
          `(${getCurrentUsernameInPage.toString()})()`,
        )
      } catch {
        // Page mid-reload — evalExpr will throw "Execution context destroyed".
        // Just retry until the new doc settles.
        last = null
      }
      if (last && last.toLowerCase() === want) {
        return { switchedTo: last, durationMs: Date.now() - started }
      }
    }
    throw new Error(`switch verify failed: current=@${last ?? '?'} expected=@${want}`)
  } finally {
    dialogCleanup()
    await restore().catch(() => {})
  }
}
