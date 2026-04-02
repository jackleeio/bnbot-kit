/**
 * Commander action handlers for draft management commands.
 *
 * bnbot draft add <text>           — Create a tweet draft
 * bnbot draft list                 — List all drafts
 * bnbot draft schedule <id> <time> — Schedule a draft
 * bnbot draft unschedule <id>      — Cancel schedule
 * bnbot draft delete <id>          — Delete a draft
 * bnbot draft share                — Get calendar share link
 * bnbot draft slots                — Show time slots
 * bnbot draft slots set <slots>    — Set time slots
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import {
  createDraft,
  listDrafts,
  scheduleDraft,
  unscheduleDraft,
  deleteDraft,
  shareSchedule,
  uploadMedia,
  getOrCreateDeviceKey,
  type Draft,
} from '../api.js';
import { runCliAction } from '../cli.js';

const DEFAULT_PORT = 18900;

/** Sync device_key to extension (one-time, non-fatal). */
async function syncDeviceKeyToExtension(): Promise<void> {
  try {
    const deviceKey = getOrCreateDeviceKey();
    await runCliAction('sync_device_key', { deviceKey }, DEFAULT_PORT);
  } catch {
    // Non-fatal: extension may not be connected
  }
}
const CONFIG_DIR = join(homedir(), '.bnbot');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

// ── Config (time slots) ─────────────────────────────────────

interface BnbotConfig {
  slots: string[];
  timezone: string;
}

const DEFAULT_CONFIG: BnbotConfig = {
  slots: ['09:00', '12:00', '18:00', '21:00'],
  timezone: 'Asia/Shanghai',
};

function loadConfig(): BnbotConfig {
  if (!existsSync(CONFIG_FILE)) return { ...DEFAULT_CONFIG };
  try {
    const raw = JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));
    return {
      slots: raw.slots || DEFAULT_CONFIG.slots,
      timezone: raw.timezone || DEFAULT_CONFIG.timezone,
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function saveConfig(config: BnbotConfig): void {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n');
}

// ── Helpers ─────────────────────────────────────────────────

function isTTY(): boolean {
  return process.stdout.isTTY === true;
}

function truncate(s: string, len: number): string {
  if (s.length <= len) return s;
  return s.slice(0, len - 3) + '...';
}

/** Extract a text preview from draft content object. */
function contentPreview(content: unknown): string {
  if (!content || typeof content !== 'object') return String(content || '');
  const c = content as Record<string, unknown>;

  // tweet_draft format
  if (c.data && typeof c.data === 'object') {
    const data = c.data as Record<string, unknown>;
    if (Array.isArray(data.drafts) && data.drafts.length > 0) {
      return String((data.drafts[0] as Record<string, unknown>).content || '');
    }
    // tweet_timeline format
    if (Array.isArray(data.timeline) && data.timeline.length > 0) {
      const first = (data.timeline[0] as Record<string, unknown>).text || '';
      return `[thread ${data.timeline.length}] ${first}`;
    }
  }

  return JSON.stringify(content).slice(0, 60);
}

/** Build tweet_draft content format expected by the extension. */
function buildTweetDraftContent(text: string, mediaUrls?: { url: string; type: string }[]) {
  return {
    type: 'tweet_draft',
    data: {
      drafts: [{
        action: 'post',
        content: text,
        media: mediaUrls && mediaUrls.length > 0 ? mediaUrls : null,
        hashtags: [],
        image_suggestion: { type: 'none', has_suggestion: false },
        reference_tweet_ids: [],
      }],
    },
  };
}

/** Build tweet_timeline content format for threads. */
function buildThreadContent(tweets: string[]) {
  return {
    type: 'tweet_timeline',
    data: {
      timeline: tweets.map((text) => ({ text, media: [] })),
      total_tweets: tweets.length,
      source_type: 'cli',
      target_style: 'casual',
      target_language: 'en',
      user: { avatar: null, username: null, display_name: null },
    },
  };
}

/** Notify the extension to sync alarms for a draft. Also syncs device_key. */
async function notifyExtensionSync(draftId: string): Promise<void> {
  try {
    await syncDeviceKeyToExtension();
    await runCliAction('draft_alarm_sync', { draftId }, DEFAULT_PORT);
  } catch {
    // Non-fatal: extension may not be connected
    console.error('[BNBOT] Note: could not sync alarm to extension (extension may not be connected)');
  }
}

/** Find next available time slot based on existing scheduled drafts. */
async function findNextSlot(): Promise<string> {
  const config = loadConfig();
  const { slots, timezone } = config;

  if (slots.length === 0) {
    console.error('No time slots configured. Run "bnbot draft slots set" first.');
    process.exit(1);
  }

  // Get all scheduled drafts
  const { drafts } = await listDrafts({ scheduled: true, limit: 100 });
  const scheduledTimes = new Set(
    drafts
      .filter((d) => d.scheduled_at)
      .map((d) => d.scheduled_at!)
  );

  // Find next empty slot starting from now
  const now = new Date();
  // Try slots for the next 30 days
  for (let dayOffset = 0; dayOffset < 30; dayOffset++) {
    for (const slot of slots) {
      const [hours, minutes] = slot.split(':').map(Number);
      const candidate = new Date(now);
      candidate.setDate(candidate.getDate() + dayOffset);
      candidate.setHours(hours, minutes, 0, 0);

      // Skip past times
      if (candidate <= now) continue;

      // Format as ISO string for comparison
      const iso = candidate.toISOString();

      // Check if this slot is already taken (compare date+time portion)
      const candidateDay = iso.slice(0, 10);
      const candidateTime = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
      const taken = drafts.some((d) => {
        if (!d.scheduled_at) return false;
        const dDay = d.scheduled_at.slice(0, 10);
        const dTime = d.scheduled_at.slice(11, 16);
        return dDay === candidateDay && dTime === candidateTime;
      });

      if (!taken) {
        return iso;
      }
    }
  }

  console.error('No available time slots in the next 30 days.');
  process.exit(1);
}

// ── Command handlers ────────────────────────────────────────

export async function draftAddCommand(
  text: string,
  options: { time?: string; auto?: boolean; thread?: boolean; media?: string | string[] }
): Promise<void> {
  let draftType: string;
  let content: unknown;
  let title: string | undefined;

  // Upload media files if provided
  let mediaUrls: { url: string; type: string }[] | undefined;
  if (options.media) {
    const files = Array.isArray(options.media) ? options.media : [options.media];
    mediaUrls = [];
    for (const file of files) {
      const name = file.replace(/^.*[\\/]/, '');
      process.stderr.write(`Uploading ${name}... `);
      const result = await uploadMedia(file);
      console.error(`done (${result.url})`);
      mediaUrls.push({ url: result.url, type: result.type });
    }
  }

  if (options.thread) {
    // Text should be a JSON array of tweet texts
    let tweets: string[];
    try {
      tweets = JSON.parse(text);
      if (!Array.isArray(tweets)) throw new Error('not an array');
    } catch {
      console.error('--thread expects a JSON array: \'["tweet 1","tweet 2"]\'');
      process.exit(1);
    }
    draftType = 'tweet_timeline';
    content = buildThreadContent(tweets);
    title = truncate(tweets[0], 50);
  } else {
    draftType = 'tweet_draft';
    content = buildTweetDraftContent(text, mediaUrls);
    title = truncate(text, 50);
  }

  console.error(`Creating draft: "${truncate(text, 60)}"`);

  const draft = await createDraft(draftType, content, title);
  console.error(`Draft created: ${draft.id.slice(0, 8)}`);

  // Schedule if requested
  let scheduledAt: string | undefined;
  if (options.auto) {
    scheduledAt = await findNextSlot();
  } else if (options.time) {
    // Parse time: accept ISO string or relative time
    const parsed = new Date(options.time);
    if (isNaN(parsed.getTime())) {
      console.error(`Invalid time: ${options.time}`);
      process.exit(1);
    }
    scheduledAt = parsed.toISOString();
  }

  if (scheduledAt) {
    const scheduled = await scheduleDraft(draft.id, scheduledAt);
    console.error(`Scheduled for: ${scheduledAt}`);
    await notifyExtensionSync(draft.id);
    console.log(JSON.stringify({
      id: scheduled.id,
      status: 'scheduled',
      scheduled_at: scheduledAt,
    }, null, 2));
  } else {
    console.log(JSON.stringify({
      id: draft.id,
      status: 'draft',
    }, null, 2));
  }
}

export async function draftListCommand(
  options: { scheduled?: boolean; limit?: string }
): Promise<void> {
  const limit = parseInt(options.limit || '20', 10);
  console.error('Fetching drafts...');

  const { drafts, total } = await listDrafts({
    scheduled: options.scheduled,
    limit,
  });

  if (drafts.length === 0) {
    console.error('No drafts found.');
    console.log(JSON.stringify([], null, 2));
    return;
  }

  // Print a readable table to stderr, JSON to stdout
  console.error('');
  console.error(`  ${'ID'.padEnd(10)} ${'Status'.padEnd(12)} ${'Scheduled'.padEnd(22)} Content`);
  console.error(`  ${'─'.repeat(10)} ${'─'.repeat(12)} ${'─'.repeat(22)} ${'─'.repeat(40)}`);

  for (const d of drafts) {
    const id = d.id.slice(0, 8);
    const status = d.publish_status || 'draft';
    const scheduled = d.scheduled_at
      ? new Date(d.scheduled_at).toLocaleString()
      : '—';
    const preview = truncate(contentPreview(d.content), 50);
    console.error(`  ${id.padEnd(10)} ${status.padEnd(12)} ${scheduled.padEnd(22)} ${preview}`);
  }
  console.error(`\n  Total: ${total}`);
  console.error('');

  // JSON output to stdout
  console.log(JSON.stringify(drafts.map((d) => ({
    id: d.id,
    status: d.publish_status || 'draft',
    scheduled_at: d.scheduled_at || null,
    content_preview: truncate(contentPreview(d.content), 100),
    created_at: d.created_at,
  })), null, 2));
}

export async function draftScheduleCommand(
  id: string,
  time: string
): Promise<void> {
  const parsed = new Date(time);
  if (isNaN(parsed.getTime())) {
    console.error(`Invalid time: ${time}`);
    process.exit(1);
  }

  const scheduledAt = parsed.toISOString();
  console.error(`Scheduling ${id.slice(0, 8)} for ${scheduledAt}...`);

  const draft = await scheduleDraft(id, scheduledAt);
  await notifyExtensionSync(id);

  console.log(JSON.stringify({
    id: draft.id,
    status: 'scheduled',
    scheduled_at: scheduledAt,
  }, null, 2));
}

export async function draftUnscheduleCommand(id: string): Promise<void> {
  console.error(`Unscheduling ${id.slice(0, 8)}...`);

  const draft = await unscheduleDraft(id);

  console.log(JSON.stringify({
    id: draft.id,
    status: 'unscheduled',
  }, null, 2));
}

export async function draftDeleteCommand(id: string): Promise<void> {
  console.error(`Deleting ${id.slice(0, 8)}...`);

  await deleteDraft(id);

  console.log(JSON.stringify({ id, deleted: true }, null, 2));
}

export async function draftShareCommand(): Promise<void> {
  console.error('Getting share link...');

  const result = await shareSchedule();

  console.log(JSON.stringify({
    share_url: result.share_url,
    share_key: result.share_key,
  }, null, 2));
}

export async function draftSlotsCommand(): Promise<void> {
  const config = loadConfig();
  console.error('');
  console.error(`  Time slots: ${config.slots.join(', ')}`);
  console.error(`  Timezone:   ${config.timezone}`);
  console.error('');
  console.log(JSON.stringify(config, null, 2));
}

export async function draftSlotsSetCommand(slots: string): Promise<void> {
  const config = loadConfig();

  // Parse comma-separated slots
  const parsed = slots
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^\d{1,2}:\d{2}$/.test(s))
    .map((s) => {
      const [h, m] = s.split(':');
      return `${h.padStart(2, '0')}:${m}`;
    })
    .sort();

  if (parsed.length === 0) {
    console.error('Invalid slot format. Use: "9:00,12:00,18:00,21:00"');
    process.exit(1);
  }

  config.slots = parsed;
  saveConfig(config);

  console.error(`Time slots updated: ${parsed.join(', ')}`);
  console.log(JSON.stringify(config, null, 2));
}
