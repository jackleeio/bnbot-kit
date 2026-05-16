/**
 * Multi-account guard for X writes (and any other action where posting
 * on the wrong account is a bug).
 *
 * Design:
 *   - Settings file (`~/.bnbot/settings.json`) carries an opt-in
 *     `multiAccount: true|false` flag. Default off — the kit was
 *     single-account from day one; turning the guard on must be
 *     explicit so we don't change behavior for existing users.
 *   - Every write command (`bnbot x post|reply|quote|like|retweet|...`)
 *     accepts a fresh `--as <handle>` flag. The flag is the **expected
 *     active X account** at the moment the action runs. The CLI invokes
 *     `ensureAccount` before the action; if the pool window's active
 *     handle differs, we open the account switcher and click the
 *     matching UserCell, then verify the switch took. On any failure
 *     we exit 1 — better to refuse than to post on the wrong brand.
 *   - When `multiAccount` is off OR `--as` is missing, ensureAccount
 *     is a no-op (with a one-line stderr hint so the caller knows the
 *     guard was bypassed). This keeps the single-account fast path
 *     unchanged.
 *
 * The DOM (`engine=dom`) and debugger (`engine=debugger`) paths use
 * different action names — `switch_account` vs `switch_account_debugger`
 * — because the DOM path acts on the user's active x.com tab while
 * the debugger path acts on the isolated pool window. Both handlers
 * already short-circuit when current === target, so we send ONE
 * round-trip per ensureAccount call.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

import { sendAction } from './cli.js';

export type WriteEngine = 'dom' | 'debugger';

/** Read `multiAccount` flag from `~/.bnbot/settings.json`. Missing file,
 *  unreadable JSON, or missing key all resolve to `false` — the safe
 *  default. */
export function readMultiAccount(): boolean {
  const f = join(homedir(), '.bnbot', 'settings.json');
  if (!existsSync(f)) return false;
  try {
    const j = JSON.parse(readFileSync(f, 'utf-8')) as Record<string, unknown>;
    return j?.multiAccount === true;
  } catch {
    return false;
  }
}

export interface EnsureAccountOpts {
  /** Expected X handle (without leading @). Empty / undefined → no-op. */
  expected?: string;
  /** Same engine the upcoming write will use — picks DOM vs CDP path. */
  engine: WriteEngine;
  /** WS port (default 18900). */
  port: number;
}

/**
 * Verify (and switch if necessary) that the X session about to be
 * written to is on the expected handle. See module header for the full
 * decision matrix.
 *
 * Exits the process with code 1 on any unrecoverable mismatch — callers
 * never see a thrown error and don't need to wrap.
 */
export async function ensureAccount(opts: EnsureAccountOpts): Promise<void> {
  const multi = readMultiAccount();
  const expected = opts.expected?.replace(/^@/, '').trim().toLowerCase();

  if (!multi) {
    if (expected) {
      // Loud-but-non-fatal: passing --as while multiAccount is off
      // is almost always a misconfiguration (user thinks they enabled
      // the mode but didn't). Don't fail — preserve the legacy fast
      // path — but make the bypass visible.
      console.error(
        `[BNBOT] multiAccount=off in ~/.bnbot/settings.json — ignoring --as @${expected}`,
      );
    }
    return;
  }

  if (!expected) {
    // multiAccount=true but no --as: agent / caller forgot to pin the
    // brand. Warn loudly so the agent can self-correct on the next
    // turn, but don't refuse — there are legitimate cases (manual
    // one-off CLI use during setup) where this is fine.
    console.error(
      '[BNBOT] multiAccount=on but --as <handle> missing — skipping account verify',
    );
    return;
  }

  const suffix = opts.engine === 'debugger' ? '_debugger' : '';
  // Both engines' `switch_account` handlers short-circuit when the
  // pool / active tab is already on the target handle, so one call
  // covers verify + switch + alreadyActive cases.
  const r = await sendAction<{ switchedTo?: string; alreadyActive?: boolean }>(
    `switch_account${suffix}`,
    { username: expected },
    opts.port,
  );

  if (!r.success) {
    console.error(`[BNBOT] ❌ 切换到 @${expected} 失败：${r.error ?? '未知错误'}`);
    console.error('[BNBOT] 请确认浏览器已登录该账号，或暂时关闭 multiAccount 模式');
    process.exit(1);
  }

  if (r.data?.alreadyActive) {
    // Quiet — already on target, nothing to log. Most common path
    // under steady-state single-brand operation.
    return;
  }
  console.error(`[BNBOT] ✓ 已切换到 @${r.data?.switchedTo ?? expected}`);
}
