/**
 * Calendar-based scheduling — single launchd tick reads per-day JSON
 * files in ~/.bnbot/calendar/ and fires pending entries whose local
 * time has arrived. Replaces the "one plist per scheduled post" pattern
 * for recurring content-calendar use cases.
 *
 * Ad-hoc one-shot scheduling (e.g. "post in 5 min") still goes through
 * the original `/schedule` flow that writes a single plist — because
 * that path is fire-and-forget and self-cleans, whereas the calendar
 * is for persistent, user-inspectable queues.
 */

import { promises as fs } from 'node:fs';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const CAL_DIR = join(homedir(), '.bnbot', 'calendar');
const BIN_DIR = join(homedir(), '.bnbot', 'bin');
const LOG_DIR = join(homedir(), '.bnbot', 'logs');
const TICK_LABEL = 'com.bnbot.calendar-tick';

export type EntryKind = 'post' | 'thread' | 'reply' | 'quote' | 'like' | 'retweet' | 'command';
export type EntryStatus = 'pending' | 'running' | 'done' | 'failed' | 'cancelled';

export interface CalendarEntry {
  id: string;
  time: string;           // "HH:MM" local
  kind: EntryKind;
  action: string;         // shell command to exec at fire time
  status: EntryStatus;
  createdAt: string;
  firedAt?: string;
  attempts: number;
  lastError?: string;
  lastResult?: string;
  note?: string;
}

// ── Paths & IO helpers ────────────────────────────────────────────

function fileForDate(date: string): string {
  return join(CAL_DIR, `${date}.json`);
}

function todayLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function ensureDirs(): Promise<void> {
  await fs.mkdir(CAL_DIR, { recursive: true });
  await fs.mkdir(BIN_DIR, { recursive: true });
  await fs.mkdir(LOG_DIR, { recursive: true });
}

async function loadDay(date: string): Promise<CalendarEntry[]> {
  const path = fileForDate(date);
  if (!existsSync(path)) return [];
  try {
    const raw = await fs.readFile(path, 'utf8');
    return JSON.parse(raw) as CalendarEntry[];
  } catch {
    return [];
  }
}

async function saveDay(date: string, entries: CalendarEntry[]): Promise<void> {
  await ensureDirs();
  // Atomic write to avoid partial state if a tick reads mid-write.
  const path = fileForDate(date);
  const tmp = `${path}.tmp-${process.pid}`;
  await fs.writeFile(tmp, JSON.stringify(entries, null, 2));
  await fs.rename(tmp, path);
}

// ── Commander handlers ────────────────────────────────────────────

export async function calendarAddCommand(
  action: string,
  options: { at?: string; date?: string; kind?: string; note?: string },
): Promise<void> {
  const time = options.at || '09:00';
  if (!/^\d{1,2}:\d{2}$/.test(time)) {
    console.error(`Invalid --at time: ${time}. Expected HH:MM.`);
    process.exit(1);
  }
  const date = options.date || todayLocal();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error(`Invalid --date: ${date}. Expected YYYY-MM-DD.`);
    process.exit(1);
  }
  const kind = (options.kind || inferKind(action)) as EntryKind;
  const entries = await loadDay(date);
  const entry: CalendarEntry = {
    id: randomUUID().slice(0, 8),
    time,
    kind,
    action,
    status: 'pending',
    createdAt: new Date().toISOString(),
    attempts: 0,
    note: options.note,
  };
  entries.push(entry);
  // Keep entries sorted by time for human readability.
  entries.sort((a, b) => a.time.localeCompare(b.time));
  await saveDay(date, entries);
  console.log(JSON.stringify({ added: entry, date, totalEntriesForDay: entries.length }, null, 2));
}

export async function calendarListCommand(options: { date?: string; all?: boolean }): Promise<void> {
  await ensureDirs();
  if (options.all) {
    const files = (await fs.readdir(CAL_DIR)).filter(f => f.endsWith('.json')).sort();
    const summary: Record<string, unknown>[] = [];
    for (const f of files) {
      const date = f.replace('.json', '');
      const entries = await loadDay(date);
      summary.push({
        date,
        count: entries.length,
        pending: entries.filter(e => e.status === 'pending').length,
        done: entries.filter(e => e.status === 'done').length,
        failed: entries.filter(e => e.status === 'failed').length,
      });
    }
    console.log(JSON.stringify(summary, null, 2));
    return;
  }
  const date = options.date || todayLocal();
  const entries = await loadDay(date);
  console.log(JSON.stringify({ date, entries }, null, 2));
}

export async function calendarRemoveCommand(id: string, options: { date?: string }): Promise<void> {
  // If no date given, scan all files for the id.
  await ensureDirs();
  const files = options.date
    ? [`${options.date}.json`]
    : (await fs.readdir(CAL_DIR)).filter(f => f.endsWith('.json'));
  for (const f of files) {
    const date = f.replace('.json', '');
    const entries = await loadDay(date);
    const idx = entries.findIndex(e => e.id === id);
    if (idx >= 0) {
      entries.splice(idx, 1);
      await saveDay(date, entries);
      console.log(JSON.stringify({ removed: id, from: date }, null, 2));
      return;
    }
  }
  console.error(`Entry ${id} not found.`);
  process.exit(1);
}

export async function calendarTickCommand(): Promise<void> {
  // Called by launchd every 5 min. Check today + yesterday (for midnight
  // crossings) for pending entries whose firing time is within the
  // catch-up window (now-1h to now).
  await ensureDirs();
  const now = Date.now();
  const WINDOW_MS = 60 * 60 * 1000;         // 1h catch-up
  const MAX_ATTEMPTS = 3;

  const dates = [todayLocal(), yesterdayLocal()];
  for (const date of dates) {
    const entries = await loadDay(date);
    let dirty = false;
    for (const entry of entries) {
      if (entry.status !== 'pending') continue;
      const fireEpoch = entryFireEpoch(date, entry.time);
      // Only fire if scheduled time has passed but within catch-up window.
      if (now < fireEpoch) continue;          // future — wait
      if (now - fireEpoch > WINDOW_MS) {
        // Missed past the window — mark as failed with note.
        entry.status = 'failed';
        entry.lastError = `missed firing window (scheduled ${date} ${entry.time})`;
        dirty = true;
        continue;
      }

      entry.status = 'running';
      entry.attempts += 1;
      entry.firedAt = new Date().toISOString();
      await saveDay(date, entries);          // flush before fork

      try {
        const result = await runShell(entry.action);
        // Heuristic success: exit 0 AND (no JSON output OR success:true).
        entry.status = 'done';
        entry.lastResult = result.slice(0, 2000);
        entry.lastError = undefined;
        console.error(`[calendar] ${entry.id} done at ${date} ${entry.time}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (entry.attempts < MAX_ATTEMPTS) {
          entry.status = 'pending';            // retry next tick
          entry.lastError = msg.slice(0, 500);
          console.error(`[calendar] ${entry.id} retry ${entry.attempts}/${MAX_ATTEMPTS}: ${msg}`);
        } else {
          entry.status = 'failed';
          entry.lastError = msg.slice(0, 2000);
          console.error(`[calendar] ${entry.id} FAILED after ${entry.attempts} attempts`);
        }
      }
      dirty = true;
      await saveDay(date, entries);
    }
    if (!dirty) continue;
  }
}

export async function calendarInstallCommand(): Promise<void> {
  // Install the tick launchd agent that calls `bnbot calendar tick`
  // every 5 minutes. The agent's PATH is pinned to include homebrew +
  // the resolved bnbot bin path so the job works on any machine.
  await ensureDirs();
  const bnbotBin = process.execPath;                 // node that's running this
  const cliEntry = process.argv[1] || '';             // .../dist/index.js
  // Prefer invoking via `bnbot` if it's resolvable — cleaner on user's disk.
  const shellCmd = `command -v bnbot > /dev/null && bnbot calendar tick || ${bnbotBin} ${cliEntry} calendar tick`;
  const plistPath = join(homedir(), 'Library', 'LaunchAgents', `${TICK_LABEL}.plist`);
  const logPath = join(LOG_DIR, 'calendar-tick.log');

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
  <key>StandardOutPath</key><string>${logPath}</string>
  <key>StandardErrorPath</key><string>${logPath}</string>
</dict>
</plist>
`;
  await fs.writeFile(plistPath, plist);
  // Reload: bootout if already loaded, then bootstrap.
  await runShellCaptureAll(`launchctl bootout gui/$UID ${JSON.stringify(plistPath)} 2>/dev/null; launchctl bootstrap gui/$UID ${JSON.stringify(plistPath)}`);
  console.log(JSON.stringify({
    installed: true,
    plist: plistPath,
    label: TICK_LABEL,
    intervalSec: 300,
    logPath,
  }, null, 2));
}

export async function calendarUninstallCommand(): Promise<void> {
  const plistPath = join(homedir(), 'Library', 'LaunchAgents', `${TICK_LABEL}.plist`);
  await runShellCaptureAll(`launchctl bootout gui/$UID ${JSON.stringify(plistPath)} 2>/dev/null; rm -f ${JSON.stringify(plistPath)}`);
  console.log(JSON.stringify({ uninstalled: true, plist: plistPath }, null, 2));
}

// ── Helpers ───────────────────────────────────────────────────────

function yesterdayLocal(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function entryFireEpoch(date: string, hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  const [yy, mo, dd] = date.split('-').map(Number);
  // Local time epoch
  return new Date(yy, mo - 1, dd, h, m, 0, 0).getTime();
}

function inferKind(action: string): EntryKind {
  if (/\bx post\b/.test(action)) return 'post';
  if (/\bx thread\b/.test(action)) return 'thread';
  if (/\bx reply\b/.test(action)) return 'reply';
  if (/\bx quote\b/.test(action)) return 'quote';
  if (/\bx like\b/.test(action)) return 'like';
  if (/\bx retweet\b/.test(action)) return 'retweet';
  return 'command';
}

function runShell(cmd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, { shell: true, env: process.env });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', c => { stdout += c.toString(); });
    child.stderr?.on('data', c => { stderr += c.toString(); });
    child.on('exit', code => {
      if (code === 0) resolve(stdout || stderr);
      else reject(new Error(`exit ${code}: ${(stderr || stdout).slice(0, 500)}`));
    });
    child.on('error', reject);
  });
}

function runShellCaptureAll(cmd: string): Promise<void> {
  return new Promise(resolve => {
    const child = spawn(cmd, { shell: true, env: process.env });
    child.on('exit', () => resolve());
    child.on('error', () => resolve());
  });
}
