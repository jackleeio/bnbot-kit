/**
 * Inbox tick — runs every 5 min via launchd. Scrape X notifications,
 * dedupe against seen-state, and if there are fresh actionable items
 * (mention / reply / quote / new_post), spawn a headless bnbot session
 * to evaluate + act via the /inbox-triage skill in --auto mode.
 *
 * Cheap path (the common case): no fresh actionable items → exit
 * immediately. Don't burn a Claude session on every tick.
 *
 * Hot path: fresh items present → spawn `bnbot -p "/inbox-triage --auto"`
 * which loads the skill, applies EV + persona-fit gates, posts via CDP,
 * and writes audit logs.
 */

import { spawn, spawnSync } from 'node:child_process';
import { promises as fs, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';

const STATE_DIR = join(homedir(), '.bnbot', 'state');
const LOG_DIR = join(homedir(), '.bnbot', 'logs');
const SEEN_PATH = join(STATE_DIR, 'inbox-seen.json');
const LAST_RUN_PATH = join(STATE_DIR, 'inbox-lastrun.json');
const TICK_LOG = join(LOG_DIR, 'inbox-tick.log');
const TICK_LABEL = 'com.bnbot.inbox-tick';
const ACTIONABLE_TYPES = new Set(['mention', 'reply', 'quote', 'new_post']);
const DEFAULT_PORT = 18900;

interface NotifItem {
  id: string;
  type: string;
  fromUsers?: string[];
  targetTweet?: { id: string; text: string; url: string } | null;
  text?: string;
  ts?: number | null;
}

async function ensureDirs(): Promise<void> {
  await fs.mkdir(STATE_DIR, { recursive: true });
  await fs.mkdir(LOG_DIR, { recursive: true });
}

async function loadSeen(): Promise<Record<string, { ts: string; type: string; action: string }>> {
  if (!existsSync(SEEN_PATH)) return {};
  try {
    return JSON.parse(await fs.readFile(SEEN_PATH, 'utf8'));
  } catch {
    return {};
  }
}

async function saveSeen(seen: Record<string, unknown>): Promise<void> {
  await fs.writeFile(SEEN_PATH, JSON.stringify(seen, null, 2));
}

/** Call the bnbot WS daemon directly to avoid spawning a CLI subprocess
 *  for every scrape. Returns the parsed action_result.data. */
function scrapeNotifications(limit: number, port = DEFAULT_PORT): Promise<NotifItem[]> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const requestId = randomUUID();
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error('scrape timeout (60s)'));
    }, 60_000);
    ws.on('open', () => {
      ws.send(JSON.stringify({
        type: 'cli_action',
        requestId,
        actionType: 'scrape_notifications',
        actionPayload: { limit },
      }));
    });
    ws.on('message', data => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.requestId !== requestId || msg.type !== 'action_result') return;
        clearTimeout(timer);
        ws.close();
        if (msg.success) resolve((msg.data as NotifItem[]) || []);
        else reject(new Error(msg.error || 'scrape failed'));
      } catch (err) {
        clearTimeout(timer);
        ws.close();
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
    ws.on('error', err => {
      clearTimeout(timer);
      reject(err);
    });
    ws.on('close', () => clearTimeout(timer));
  });
}

/** Where does the bnbot REPL live? Detect at install time and bake the
 *  absolute path into the launchd plist so the agent never relies on
 *  PATH lookup at fire time. */
function detectBnbotPath(): { kind: 'binary' | 'src'; path: string } | null {
  // Prefer `which bnbot-agent` if user has installed the desktop fork
  // as a binary on PATH (future). Fallback: source path.
  const which = spawnSync('which', ['bnbot-agent']);
  if (which.status === 0) {
    return { kind: 'binary', path: which.stdout.toString().trim() };
  }
  const srcPath = '/Users/jacklee/Projects/bnbot/src/entrypoints/cli.tsx';
  if (existsSync(srcPath)) return { kind: 'src', path: srcPath };
  return null;
}

function logLine(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  // Best-effort sync write — don't await so the function stays sync.
  try {
    require('node:fs').appendFileSync(TICK_LOG, line);
  } catch {}
  process.stderr.write(line);
}

// ── Commander handlers ────────────────────────────────────────────

export async function inboxTickCommand(): Promise<void> {
  await ensureDirs();

  let items: NotifItem[];
  try {
    items = await scrapeNotifications(50);
  } catch (err) {
    logLine(`scrape failed: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  const seen = await loadSeen();
  const fresh = items.filter(it => it.id && !seen[it.id]);
  const actionable = fresh.filter(it => ACTIONABLE_TYPES.has(it.type));

  // Mark non-actionable fresh items as seen immediately. They never
  // need a Claude pass and shouldn't keep showing up next tick.
  const now = new Date().toISOString();
  for (const it of fresh) {
    if (!ACTIONABLE_TYPES.has(it.type)) {
      seen[it.id] = { ts: now, type: it.type, action: 'skip' };
    }
  }
  await saveSeen(seen);

  await fs.writeFile(LAST_RUN_PATH, JSON.stringify({
    lastRun: now,
    scraped: items.length,
    fresh: fresh.length,
    actionable: actionable.length,
  }, null, 2));

  if (actionable.length === 0) {
    logLine(`tick: ${items.length} scraped, ${fresh.length} fresh, 0 actionable — done`);
    return;
  }

  // Hot path: spawn headless bnbot session to evaluate via /inbox-triage --auto.
  const bn = detectBnbotPath();
  if (!bn) {
    logLine(`tick: ${actionable.length} actionable but bnbot agent not found — install bnbot-agent or set BNBOT_REPL_PATH`);
    return;
  }
  logLine(`tick: ${actionable.length} actionable items — spawning bnbot agent (${bn.kind})`);

  // Build the agent command. -p = print/headless, --model=sonnet =
  // balanced cost/quality for the loop. The /inbox-triage skill
  // is auto-loaded by name.
  const cmd = bn.kind === 'binary'
    ? `${bn.path} -p '/inbox-triage --auto' --model=sonnet`
    : `cd ${JSON.stringify(require('node:path').dirname(require('node:path').dirname(bn.path)))} && bun run ${JSON.stringify(bn.path)} -p '/inbox-triage --auto' --model=sonnet`;
  // Detached so the tick exits even if the agent runs long.
  const child = spawn('/bin/bash', ['-lc', cmd], {
    detached: true,
    stdio: ['ignore', 'inherit', 'inherit'],
    env: process.env,
  });
  child.unref();
  logLine(`tick: spawned bnbot pid=${child.pid}`);
}

export async function inboxInstallCommand(): Promise<void> {
  await ensureDirs();
  const bnbotBin = process.execPath;
  const cliEntry = process.argv[1] || '';
  const shellCmd = `command -v bnbot > /dev/null && bnbot inbox tick || ${bnbotBin} ${cliEntry} inbox tick`;
  const plistPath = join(homedir(), 'Library', 'LaunchAgents', `${TICK_LABEL}.plist`);
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${TICK_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>-lc</string>
    <string>${shellCmd}</string>
  </array>
  <key>StartInterval</key><integer>300</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>${TICK_LOG}</string>
  <key>StandardErrorPath</key><string>${TICK_LOG}</string>
</dict>
</plist>
`;
  await fs.writeFile(plistPath, plist);
  spawnSync('/bin/bash', ['-lc', `launchctl bootout gui/$UID ${JSON.stringify(plistPath)} 2>/dev/null; launchctl bootstrap gui/$UID ${JSON.stringify(plistPath)}`]);
  console.log(JSON.stringify({
    installed: true,
    plist: plistPath,
    label: TICK_LABEL,
    intervalSec: 300,
    logPath: TICK_LOG,
  }, null, 2));
}

export async function inboxUninstallCommand(): Promise<void> {
  const plistPath = join(homedir(), 'Library', 'LaunchAgents', `${TICK_LABEL}.plist`);
  spawnSync('/bin/bash', ['-lc', `launchctl bootout gui/$UID ${JSON.stringify(plistPath)} 2>/dev/null; rm -f ${JSON.stringify(plistPath)}`]);
  console.log(JSON.stringify({ uninstalled: true, plist: plistPath }, null, 2));
}

export async function inboxStatusCommand(): Promise<void> {
  const lastRun = existsSync(LAST_RUN_PATH)
    ? JSON.parse(await fs.readFile(LAST_RUN_PATH, 'utf8'))
    : null;
  const seenCount = existsSync(SEEN_PATH)
    ? Object.keys(JSON.parse(await fs.readFile(SEEN_PATH, 'utf8'))).length
    : 0;
  const tickInstalled = existsSync(join(homedir(), 'Library', 'LaunchAgents', `${TICK_LABEL}.plist`));
  console.log(JSON.stringify({
    tickInstalled,
    seenItems: seenCount,
    lastRun,
    logPath: TICK_LOG,
  }, null, 2));
}
