import { execFile, execFileSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { promisify } from 'node:util';
import { ensureServer } from '../cli';
import { stripImageWatermarks } from '../tools/watermark';
import { sendAction } from './debug';

const execFileAsync = promisify(execFile);

const DEFAULT_PORT = 18900;
const DEFAULT_GEMINI_IMAGES_URL = 'https://gemini.google.com/images';
const DEFAULT_GEMINI_APP_URL = 'https://gemini.google.com/app';
const DEFAULT_TIMEOUT_MS = 300_000;
const DEFAULT_VIDEO_TIMEOUT_MS = 900_000;
const DEFAULT_POLL_MS = 2_000;
const DEFAULT_VIDEO_POLL_MS = 4_000;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_VIDEO_INLINE_BYTES = 16 * 1024 * 1024;
const MAX_GEMINI_WORKERS = 3;
const DEFAULT_GEMINI_WORKERS = 3;
const WORKER_LEASE_GRACE_MS = 120_000;
const WORKER_LOCK_STALE_MS = 30_000;
const GEMINI_WORKER_STATE_PATH = join(tmpdir(), 'bnbot-gemini-web-workers.json');
const GEMINI_WORKER_LOCK_PATH = `${GEMINI_WORKER_STATE_PATH}.lock`;
const GEMINI_PASTE_LOCK_PATH = join(tmpdir(), 'bnbot-gemini-web-paste.lock');
const GEMINI_PASTE_LOCK_STALE_MS = 45_000;

interface GeminiWebImageGenerateOptions {
  image?: string[];
  size?: string;
  quality?: string;
  timeout?: string;
  responseFormat?: string;
  artifactDir?: string;
  inlineArtifacts?: boolean;
  tabId?: string;
  host?: string;
  url?: string;
  keepChat?: boolean;
  freshTab?: boolean;
  maxWorkers?: string;
}

interface ActionResult {
  tabId?: number;
  url?: string;
  result?: unknown;
  exception?: string;
}

interface GeminiImageSource {
  source: string;
}

interface ImageArtifact {
  index: number;
  type: 'image';
  source: string;
  mime: string;
  width?: number;
  height?: number;
  bytes?: number;
  base64?: string;
  path?: string;
  error?: string;
  watermark_removed?: boolean;
  watermark_removal_error?: string;
  watermark_method?: string;
  watermark_metadata_stripped?: boolean;
}

interface GeminiWorker {
  tabId: number;
  url?: string;
  title?: string;
  windowId?: number;
  createdAt: number;
  lastUsedAt: number;
  leaseId?: string;
  leaseUntil?: number;
}

interface GeminiWorkerState {
  workers: GeminiWorker[];
}

interface GeminiWorkerLease {
  target: ActionResult;
  leaseId?: string;
  reused: boolean;
  workerPool: boolean;
  maxWorkers: number;
  release: () => Promise<void>;
}

export async function geminiWebImageGenerateCommand(
  promptArg: string,
  options: GeminiWebImageGenerateOptions,
): Promise<void> {
  const prompt = await readTextArgument(promptArg);
  const timeoutMs = parseTimeoutMs(options.timeout, DEFAULT_TIMEOUT_MS);
  const responseFormat = options.responseFormat || 'path';
  if (responseFormat !== 'path' && responseFormat !== 'b64_json') {
    throw new Error('--response-format must be one of: path, b64_json');
  }

  const inlineArtifacts = options.inlineArtifacts === true || responseFormat === 'b64_json';
  const startedAt = Date.now();
  const hasReferenceImages = (options.image?.length ?? 0) > 0;
  const requestedUrl = options.url || DEFAULT_GEMINI_IMAGES_URL;
  const imageUrl = hasReferenceImages && requestedUrl === DEFAULT_GEMINI_IMAGES_URL
    ? DEFAULT_GEMINI_APP_URL
    : requestedUrl;

  await ensureServer(DEFAULT_PORT);
  const worker = await openGeminiTarget({ ...options, url: imageUrl }, timeoutMs);
  try {
  const target = worker.target;
  const conversationReset = options.keepChat
    ? { skipped: true, reason: 'keep_chat' }
    : await prepareFreshGeminiConversation(target, imageUrl);
  const basePayload = targetPayload(target);
  await waitForComposer(basePayload, Math.min(timeoutMs, 60_000));

  const beforeSources = new Set((await listGeneratedImageSources(basePayload)).map((item) => item.source));
  const referenceImages = await resolveImageInputs(options.image ?? [], options.artifactDir);
  const attachments = await attachFiles(basePayload, referenceImages);
  const imageMode = referenceImages.length > 0 || imageUrl.includes('/app')
    ? await enableImageMode(basePayload)
    : { ok: true, alreadyOn: true, skipped: true };
  const text = buildImageGeneratePrompt(prompt, options.size, options.quality, referenceImages.length);
  const injected = await injectComposerText(basePayload, text);
  if (!injected.ok) throw new Error(injected.error || 'Could not find Gemini composer input');

  await sleep(300);
  const submit = await clickSend(basePayload);
  const wait = await waitForNewGeneratedImage(basePayload, beforeSources, timeoutMs);
  const rawArtifacts = await extractGeneratedImages(basePayload, beforeSources);
  const persisted = renumberArtifacts(persistArtifacts(rawArtifacts, options.artifactDir, inlineArtifacts));
  const artifacts = await stripWatermarksFromArtifacts(persisted, inlineArtifacts);
  const images = artifacts.map((artifact) => imageArtifactToApiImage(artifact, responseFormat));

  printJson({
    success: images.length > 0,
    action: 'image-generate',
    provider: 'gemini-web',
    app: 'Google Gemini',
    url: wait.url || target.url || null,
    prompt,
    size: options.size || null,
    quality: options.quality || null,
    reference_images: referenceImages.length,
    response_format: responseFormat,
    duration_ms: Date.now() - startedAt,
    worker: {
      tab_id: target.tabId || null,
      reused: worker.reused,
      pool: worker.workerPool,
      max_workers: worker.maxWorkers,
    },
    conversation_reset: conversationReset,
    image_mode: imageMode,
    submit,
    attachments,
    wait,
    watermark_removal: watermarkRemovalSummary(artifacts),
    images,
    artifacts,
    error: images.length > 0 ? undefined : 'No raster image artifact was produced by Gemini Web.',
  });
  } finally {
    await worker.release();
  }
}

function watermarkRemovalSummary(artifacts: ImageArtifact[]): Record<string, unknown> {
  const removed = artifacts.filter((a) => a.watermark_removed).length;
  const metadataStripped = artifacts.filter((a) => a.watermark_metadata_stripped).length;
  const failed = artifacts
    .filter((a) => a.watermark_removal_error)
    .map((a) => ({ index: a.index, error: a.watermark_removal_error }));
  return {
    method: 'alpha-blending',
    removed,
    metadata_stripped: metadataStripped,
    total: artifacts.length,
    failed: failed.length > 0 ? failed : undefined,
  };
}

async function stripWatermarksFromArtifacts(
  artifacts: ImageArtifact[],
  inlineArtifacts: boolean,
): Promise<ImageArtifact[]> {
  const out: ImageArtifact[] = [];
  for (const artifact of artifacts) {
    if (!artifact.path || artifact.error) {
      out.push(artifact);
      continue;
    }
    const result = await stripImageWatermarks(artifact.path);
    const cleaned = readFileSync(artifact.path);
    const next: ImageArtifact = {
      ...artifact,
      bytes: cleaned.length,
      watermark_removed: result.removed,
      watermark_method: result.method,
      watermark_metadata_stripped: result.metadata_stripped,
    };
    if (result.error) next.watermark_removal_error = result.error;
    if (inlineArtifacts && cleaned.length <= MAX_IMAGE_BYTES) {
      next.base64 = cleaned.toString('base64');
    } else if (artifact.base64) {
      next.base64 = cleaned.toString('base64');
    }
    out.push(next);
  }
  return out;
}

function computeWatermarkRect(width: number, height: number): { x: number; y: number; w: number; h: number } {
  // Gemini's sparkle watermark hugs the bottom-right corner. On a 1024x1024
  // render the visible glyph centres roughly at (970, 960) with ~40px radius.
  // We clear a square ~9% of the shorter side, padded a touch from the edges
  // so ffmpeg's delogo filter has surrounding pixels to interpolate from.
  const shortSide = Math.min(width, height);
  const boxSize = clamp(Math.round(shortSide * 0.095), 48, Math.floor(shortSide * 0.25));
  const cornerPad = clamp(Math.round(shortSide * 0.013), 4, 24);
  const x = clamp(width - cornerPad - boxSize, 1, Math.max(1, width - boxSize - 2));
  const y = clamp(height - cornerPad - boxSize, 1, Math.max(1, height - boxSize - 2));
  const w = clamp(boxSize, 16, width - x - 2);
  const h = clamp(boxSize, 16, height - y - 2);
  return { x, y, w, h };
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

let cachedFfmpeg: string | null | undefined;
async function resolveFfmpeg(): Promise<string | null> {
  if (cachedFfmpeg !== undefined) return cachedFfmpeg;
  const candidates = [
    process.env.FFMPEG_BIN,
    'ffmpeg',
    '/opt/homebrew/bin/ffmpeg',
    '/usr/local/bin/ffmpeg',
    '/usr/bin/ffmpeg',
  ].filter((value): value is string => typeof value === 'string' && value.length > 0);
  for (const candidate of candidates) {
    try {
      await execFileAsync(candidate, ['-version'], { maxBuffer: 1024 * 1024 });
      cachedFfmpeg = candidate;
      return candidate;
    } catch {
      /* try next */
    }
  }
  cachedFfmpeg = null;
  return null;
}

async function openGeminiTarget(
  options: GeminiWebImageGenerateOptions,
  timeoutMs: number,
): Promise<GeminiWorkerLease> {
  if (options.tabId) {
    return {
      target: {
        tabId: Number.parseInt(options.tabId, 10),
        url: options.url || DEFAULT_GEMINI_IMAGES_URL,
      },
      reused: true,
      workerPool: false,
      maxWorkers: getGeminiWorkerMax(options),
      release: async () => undefined,
    };
  }
  if (options.keepChat && options.host) {
    return {
      target: {
        url: options.url || DEFAULT_GEMINI_IMAGES_URL,
      },
      reused: true,
      workerPool: false,
      maxWorkers: getGeminiWorkerMax(options),
      release: async () => undefined,
    };
  }
  if (options.freshTab) {
    return {
      target: await send('navigate_to_url', { url: options.url || DEFAULT_GEMINI_IMAGES_URL, spawn: true }),
      reused: false,
      workerPool: false,
      maxWorkers: getGeminiWorkerMax(options),
      release: async () => undefined,
    };
  }
  return acquireGeminiWorker(options, timeoutMs);
}

async function acquireGeminiWorker(
  options: GeminiWebImageGenerateOptions,
  timeoutMs: number,
): Promise<GeminiWorkerLease> {
  const maxWorkers = getGeminiWorkerMax(options);
  const url = options.url || DEFAULT_GEMINI_IMAGES_URL;
  const deadline = Date.now() + Math.max(timeoutMs, 60_000);
  let lastReason = 'all workers are busy';

  while (Date.now() < deadline) {
    const lease = await withGeminiWorkerLock(async () => {
      const state = readGeminiWorkerState();
      await seedGeminiWorkersFromTabs(state, maxWorkers);
      const now = Date.now();
      let changed = pruneInvalidGeminiWorkers(state);
      changed = pruneGeminiWorkersToMax(state, maxWorkers, now) || changed;

      const freeWorkers = [...state.workers]
        .filter((worker) => !worker.leaseUntil || worker.leaseUntil <= now)
        .sort((a, b) => a.lastUsedAt - b.lastUsedAt);

      for (const worker of freeWorkers) {
        const status = await getGeminiTabStatus(worker.tabId).catch(() => null);
        if (!status?.ok) {
          state.workers = state.workers.filter((item) => item.tabId !== worker.tabId);
          changed = true;
          continue;
        }
        worker.url = status.url;
        worker.title = status.title;
        if (status.busy) {
          lastReason = `worker tab ${worker.tabId} is still generating`;
          state.workers = state.workers.filter((item) => item.tabId !== worker.tabId);
          changed = true;
          continue;
        }
        const leaseId = makeLeaseId();
        worker.leaseId = leaseId;
        worker.leaseUntil = Date.now() + timeoutMs + WORKER_LEASE_GRACE_MS;
        worker.lastUsedAt = Date.now();
        writeGeminiWorkerState(state);
        return makeGeminiWorkerLease(worker.tabId, worker.url || url, leaseId, true, maxWorkers);
      }

      if (state.workers.length < maxWorkers) {
        const spawned = await send('navigate_to_url', { url, spawn: true });
        if (typeof spawned.tabId !== 'number' || !Number.isFinite(spawned.tabId)) {
          throw new Error('Gemini Web worker spawn did not return a tabId');
        }
        const leaseId = makeLeaseId();
        state.workers.push({
          tabId: spawned.tabId,
          url: spawned.url || url,
          createdAt: Date.now(),
          lastUsedAt: Date.now(),
          leaseId,
          leaseUntil: Date.now() + timeoutMs + WORKER_LEASE_GRACE_MS,
        });
        writeGeminiWorkerState(state);
        return makeGeminiWorkerLease(spawned.tabId, spawned.url || url, leaseId, false, maxWorkers);
      }

      if (changed) writeGeminiWorkerState(state);
      return null;
    });

    if (lease) return lease;
    await sleep(1_000);
  }

  throw new Error(`Timed out waiting for a free Gemini Web worker tab (${lastReason}; max ${maxWorkers})`);
}

function makeGeminiWorkerLease(
  tabId: number,
  url: string,
  leaseId: string,
  reused: boolean,
  maxWorkers: number,
): GeminiWorkerLease {
  return {
    target: { tabId, url },
    leaseId,
    reused,
    workerPool: true,
    maxWorkers,
    release: () => releaseGeminiWorker(tabId, leaseId),
  };
}

async function releaseGeminiWorker(tabId: number, leaseId: string): Promise<void> {
  await withGeminiWorkerLock(async () => {
    const state = readGeminiWorkerState();
    const worker = state.workers.find((item) => item.tabId === tabId);
    if (!worker || worker.leaseId !== leaseId) return;
    const status = await getGeminiTabStatus(tabId).catch(() => null);
    if (status?.ok) {
      worker.url = status.url;
      worker.title = status.title;
      worker.lastUsedAt = Date.now();
      delete worker.leaseId;
      delete worker.leaseUntil;
    } else {
      state.workers = state.workers.filter((item) => item.tabId !== tabId);
    }
    writeGeminiWorkerState(state);
  });
}

async function prepareFreshGeminiConversation(target: ActionResult, url: string): Promise<Record<string, unknown>> {
  if (typeof target.tabId !== 'number' || !Number.isFinite(target.tabId)) {
    return { skipped: true, reason: 'no_tab_id' };
  }
  const nav = await send('navigate_to_url', { tabId: target.tabId, url }).catch(() => null);
  if (nav?.url) target.url = nav.url;
  const payload = targetPayload(target);
  await waitForComposer(payload, 60_000);
  const click: { clicked: boolean; method?: string; error?: string; url?: string } = await clickGeminiNewChatIfAvailable(payload).catch((error) => ({
    clicked: false,
    error: getErrorMessage(error),
  }));
  await waitForComposer(payload, 60_000);
  const after = await evalJson<{ url: string; title: string }>(payload, `
    (() => JSON.stringify({ url: location.href, title: document.title || '' }))()
  `).catch(() => ({ url: target.url || url, title: '' }));
  target.url = after.url;
  return {
    navigated_url: nav?.url || null,
    clicked_new_chat: !!click.clicked,
    method: click.method || null,
    error: click.error || null,
    final_url: after.url,
    final_title: after.title,
  };
}

async function clickGeminiNewChatIfAvailable(
  payload: Record<string, unknown>,
): Promise<{ clicked: boolean; method?: string; error?: string; url?: string }> {
  const marked = await evalJson<{ ok: boolean; selector?: string; label?: string; error?: string }>(payload, `
    (() => {
      const visible = (el) => {
        const rect = el.getBoundingClientRect?.();
        return !!rect && rect.width > 0 && rect.height > 0;
      };
      const score = (el) => {
        const label = [
          el.getAttribute('aria-label') || '',
          el.getAttribute('title') || '',
          el.textContent || '',
          el.innerText || '',
        ].join(' ');
        if (/^new chat$|new chat|new conversation|新聊天|新对话/i.test(label)) return 0;
        if ((el.getAttribute('href') || '') === '/app') return 1;
        return 9;
      };
      const candidates = Array.from(document.querySelectorAll('a, button, [role="button"]'))
        .filter(visible)
        .filter((el) => {
          const label = [
            el.getAttribute('aria-label') || '',
            el.getAttribute('title') || '',
            el.textContent || '',
            el.innerText || '',
          ].join(' ');
          const href = el.getAttribute('href') || '';
          return /new chat|new conversation|新聊天|新对话/i.test(label) || href === '/app';
        })
        .sort((a, b) => score(a) - score(b));
      const target = candidates[0];
      if (!target) return JSON.stringify({ ok: false, error: 'new_chat_button_not_found' });
      target.setAttribute('data-bnbot-gemini-new-chat-target', 'true');
      target.scrollIntoView({ block: 'center', inline: 'center' });
      const label = [
        target.getAttribute('aria-label') || '',
        target.getAttribute('title') || '',
        target.textContent || '',
        target.innerText || '',
      ].join(' ').trim();
      return JSON.stringify({ ok: true, selector: '[data-bnbot-gemini-new-chat-target="true"]', label });
    })()
  `);
  if (!marked.ok || !marked.selector) {
    return { clicked: false, error: marked.error || 'new_chat_button_not_found' };
  }
  try {
    await send('debug_click', { ...payload, selector: marked.selector });
    await sleep(900);
    const state = await evalJson<{ url: string }>(payload, `(() => JSON.stringify({ url: location.href }))()`)
      .catch(() => ({ url: undefined as unknown as string }));
    return { clicked: true, method: 'debug_click', url: state.url };
  } catch (error) {
    const fallback: { clicked: boolean; url?: string } = await evalJson<{ clicked: boolean; url?: string }>(payload, `
      (async () => {
        const target = document.querySelector('[data-bnbot-gemini-new-chat-target="true"]');
        if (!target) return JSON.stringify({ clicked: false, url: location.href });
        target.click();
        await new Promise((resolve) => setTimeout(resolve, 900));
        return JSON.stringify({ clicked: true, url: location.href });
      })()
    `).catch(() => ({ clicked: false, url: undefined }));
    return {
      clicked: !!fallback.clicked,
      method: fallback.clicked ? 'dom-click' : undefined,
      error: fallback.clicked ? getErrorMessage(error) : `debug_click failed: ${getErrorMessage(error)}`,
      url: fallback.url,
    };
  } finally {
    await evalJson(payload, `
      (() => {
        document.querySelector('[data-bnbot-gemini-new-chat-target="true"]')?.removeAttribute('data-bnbot-gemini-new-chat-target');
        return JSON.stringify({ ok: true });
      })()
    `).catch(() => undefined);
  }
}

async function getGeminiTabStatus(tabId: number): Promise<{
  ok: boolean;
  url: string;
  title: string;
  busy: boolean;
  hasComposer: boolean;
}> {
  return evalJson({ tabId }, `
    (() => {
      const hostOk = location.hostname === 'gemini.google.com' || location.hostname.endsWith('.gemini.google.com');
      const visible = (el) => {
        const rect = el.getBoundingClientRect?.();
        return !!rect && rect.width > 0 && rect.height > 0;
      };
      const hasComposer = Array.from(document.querySelectorAll('[aria-label="Enter a prompt for Gemini"], [contenteditable="true"], textarea'))
        .some(visible);
      return JSON.stringify({
        ok: hostOk,
        url: location.href,
        title: document.title || '',
        busy: !!document.querySelector('[aria-label*="Stop" i], [aria-label*="停止"], mat-spinner, progress'),
        hasComposer,
      });
    })()
  `);
}

async function seedGeminiWorkersFromTabs(state: GeminiWorkerState, maxWorkers: number): Promise<void> {
  if (state.workers.length >= maxWorkers) return;
  const listed = await listReusableGeminiTabs();
  if (!listed.length) return;
  const known = new Set(state.workers.map((worker) => worker.tabId));
  for (const tab of listed) {
    if (state.workers.length >= maxWorkers) break;
    if (typeof tab.tabId !== 'number' || known.has(tab.tabId)) continue;
    state.workers.push({
      tabId: tab.tabId,
      url: tab.url,
      title: tab.title,
      windowId: tab.windowId,
      createdAt: Date.now(),
      lastUsedAt: 0,
    });
    known.add(tab.tabId);
  }
}

async function listReusableGeminiTabs(): Promise<Array<{
  tabId?: number;
  url?: string;
  title?: string;
  windowId?: number;
  active?: boolean;
  windowFocused?: boolean;
}>> {
  const scraperTabs = await send('debug_list_tabs', { host: 'gemini.google.com', scraperOnly: true }).catch(() => null) as
    | { tabs?: Array<{ tabId?: number; url?: string; title?: string; windowId?: number; active?: boolean; windowFocused?: boolean }> }
    | null;
  if (scraperTabs?.tabs?.length) return filterGeminiWorkerTabs(scraperTabs.tabs);

  const allTabs = await send('debug_list_tabs', { host: 'gemini.google.com', scraperOnly: false }).catch(() => null) as
    | { tabs?: Array<{ tabId?: number; url?: string; title?: string; windowId?: number; active?: boolean; windowFocused?: boolean }> }
    | null;
  return filterGeminiWorkerTabs(allTabs?.tabs || [])
    .filter((tab) => tab.windowFocused === false)
    .sort((a, b) => geminiWorkerTabScore(a) - geminiWorkerTabScore(b));
}

function filterGeminiWorkerTabs<T extends { url?: string }>(tabs: T[]): T[] {
  return tabs.filter((tab) => {
    if (!tab.url) return false;
    try {
      const url = new URL(tab.url);
      return url.hostname === 'gemini.google.com' || url.hostname.endsWith('.gemini.google.com');
    } catch {
      return false;
    }
  });
}

function geminiWorkerTabScore(tab: { title?: string; url?: string }): number {
  try {
    const url = new URL(tab.url || '');
    if (url.pathname.startsWith('/app/')) return 0;
    if (url.pathname === '/app' || url.pathname === '/images') return 1;
  } catch {
    return 9;
  }
  const title = String(tab.title || '');
  return /gemini/i.test(title) ? 2 : 9;
}

function pruneInvalidGeminiWorkers(state: GeminiWorkerState): boolean {
  const before = state.workers.length;
  state.workers = state.workers.filter((worker) => Number.isFinite(worker.tabId));
  return state.workers.length !== before;
}

function pruneGeminiWorkersToMax(state: GeminiWorkerState, maxWorkers: number, now = Date.now()): boolean {
  if (state.workers.length <= maxWorkers) return false;
  const before = state.workers.length;
  state.workers = [...state.workers]
    .sort((a, b) => {
      const aLeased = a.leaseUntil && a.leaseUntil > now ? 1 : 0;
      const bLeased = b.leaseUntil && b.leaseUntil > now ? 1 : 0;
      if (aLeased !== bLeased) return bLeased - aLeased;
      return (b.lastUsedAt || 0) - (a.lastUsedAt || 0);
    })
    .slice(0, maxWorkers);
  return state.workers.length !== before;
}

async function withGeminiWorkerLock<T>(fn: () => Promise<T>): Promise<T> {
  const fd = await acquireGeminiWorkerLock();
  try {
    return await fn();
  } finally {
    closeSync(fd);
    try {
      unlinkSync(GEMINI_WORKER_LOCK_PATH);
    } catch {
      // Already cleaned up by a stale-lock recovery path.
    }
  }
}

async function acquireGeminiWorkerLock(): Promise<number> {
  while (true) {
    try {
      const fd = openSync(GEMINI_WORKER_LOCK_PATH, 'wx');
      writeFileSync(fd, JSON.stringify({ pid: process.pid, createdAt: Date.now() }));
      return fd;
    } catch (error) {
      if (!isFileExistsError(error)) throw error;
      if (isGeminiWorkerLockStale()) {
        try {
          unlinkSync(GEMINI_WORKER_LOCK_PATH);
        } catch {
          // Another process may have won the stale-lock cleanup race.
        }
      }
      await sleep(100);
    }
  }
}

function isGeminiWorkerLockStale(): boolean {
  try {
    return Date.now() - statSync(GEMINI_WORKER_LOCK_PATH).mtimeMs > WORKER_LOCK_STALE_MS;
  } catch {
    return true;
  }
}

function isFileExistsError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === 'EEXIST';
}

function readGeminiWorkerState(): GeminiWorkerState {
  try {
    const parsed = JSON.parse(readFileSync(GEMINI_WORKER_STATE_PATH, 'utf8')) as GeminiWorkerState;
    return { workers: Array.isArray(parsed.workers) ? parsed.workers : [] };
  } catch {
    return { workers: [] };
  }
}

function writeGeminiWorkerState(state: GeminiWorkerState): void {
  writeFileSync(GEMINI_WORKER_STATE_PATH, JSON.stringify(state, null, 2));
}

async function withGeminiPasteLock<T>(fn: () => Promise<T>): Promise<T> {
  const fd = await acquireGeminiPasteLock();
  try {
    return await fn();
  } finally {
    closeSync(fd);
    try {
      unlinkSync(GEMINI_PASTE_LOCK_PATH);
    } catch {
      // Another process may have already cleared a stale paste lock.
    }
  }
}

async function acquireGeminiPasteLock(): Promise<number> {
  while (true) {
    try {
      const fd = openSync(GEMINI_PASTE_LOCK_PATH, 'wx');
      writeFileSync(fd, JSON.stringify({ pid: process.pid, createdAt: Date.now() }));
      return fd;
    } catch (error) {
      if (!isFileExistsError(error)) throw error;
      if (isGeminiPasteLockStale()) {
        try {
          unlinkSync(GEMINI_PASTE_LOCK_PATH);
        } catch {
          // Another process may have won the cleanup race.
        }
      }
      await sleep(100);
    }
  }
}

function isGeminiPasteLockStale(): boolean {
  try {
    return Date.now() - statSync(GEMINI_PASTE_LOCK_PATH).mtimeMs > GEMINI_PASTE_LOCK_STALE_MS;
  } catch {
    return true;
  }
}

function makeLeaseId(): string {
  return `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getGeminiWorkerMax(options: GeminiWebImageGenerateOptions): number {
  const raw = Number.parseInt(options.maxWorkers || process.env.BNBOT_GEMINI_WEB_WORKERS || '', 10);
  if (!Number.isFinite(raw) || raw < 1) return DEFAULT_GEMINI_WORKERS;
  return Math.min(raw, MAX_GEMINI_WORKERS);
}

function targetPayload(target: ActionResult): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (typeof target.tabId === 'number' && Number.isFinite(target.tabId)) payload.tabId = target.tabId;
  if (!payload.tabId) payload.targetHost = 'gemini.google.com';
  return payload;
}

async function attachFiles(
  payload: Record<string, unknown>,
  files: string[],
): Promise<{ ok: boolean; attached: number; files: string[]; method: string; error?: string }> {
  if (!files.length) return { ok: true, attached: 0, files: [], method: 'none' };

  const errors: string[] = [];
  if (process.platform === 'darwin') {
    try {
      const pasted = await withGeminiPasteLock(() => attachFilesViaPasteboard(payload, files));
      return {
        ok: pasted.attached >= files.length,
        attached: pasted.attached,
        files,
        method: 'pasteboard',
        error: pasted.attached >= files.length ? undefined : `Only ${pasted.attached}/${files.length} reference image(s) appeared in the composer`,
      };
    } catch (error) {
      errors.push(`pasteboard: ${getErrorMessage(error)}`);
    }
  } else {
    errors.push('pasteboard: file paste fallback currently requires macOS');
  }

  try {
    const pasted = await attachFilesViaDomPaste(payload, files);
    return {
      ok: pasted.attached >= files.length,
      attached: pasted.attached,
      files,
      method: 'ClipboardEvent(paste)',
      error: pasted.attached >= files.length ? undefined : `Only ${pasted.attached}/${files.length} reference image(s) appeared in the composer`,
    };
  } catch (pasteError) {
    errors.push(`ClipboardEvent(paste): ${getErrorMessage(pasteError)}`);
    return {
      ok: false,
      attached: 0,
      files,
      method: 'pasteboard, ClipboardEvent(paste)',
      error: errors.join('; '),
    };
  }
}

async function attachFilesViaPasteboard(
  payload: Record<string, unknown>,
  files: string[],
): Promise<{ attached: number }> {
  await focusGeminiComposerForPaste(payload);
  const initialCount = await countGeminiAttachments(payload);
  let currentCount = initialCount;
  for (let index = 0; index < files.length; index += 1) {
    setClipboardImage(files[index]);
    await focusGeminiComposerForPaste(payload);
    execFileSync('osascript', ['-e', 'tell application "System Events" to keystroke "v" using command down'], {
      stdio: 'ignore',
      timeout: 10_000,
    });
    const ready = await waitForAttachmentCount(payload, currentCount + 1, 20_000);
    currentCount = ready.count;
    await sleep(350);
  }
  return { attached: Math.max(files.length, currentCount - initialCount) };
}

async function focusGeminiComposerForPaste(payload: Record<string, unknown>): Promise<void> {
  await send('debug_show_window', payload).catch(() => undefined);
  const marked = await evalJson<{ ok: boolean; selector?: string; error?: string }>(payload, `
    (() => {
      const visible = (el) => {
        const rect = el.getBoundingClientRect?.();
        return !rect || (rect.width > 0 && rect.height > 0);
      };
      document.querySelector('[data-bnbot-gemini-paste-composer="true"]')
        ?.removeAttribute('data-bnbot-gemini-paste-composer');
      const composer = Array.from(document.querySelectorAll('[aria-label="Enter a prompt for Gemini"], [contenteditable="true"], textarea'))
        .filter(visible)
        .pop();
      if (!composer) return JSON.stringify({ ok: false, error: 'composer_not_found' });
      composer.setAttribute('data-bnbot-gemini-paste-composer', 'true');
      composer.scrollIntoView({ block: 'center', inline: 'center' });
      return JSON.stringify({ ok: true, selector: '[data-bnbot-gemini-paste-composer="true"]' });
    })()
  `);
  if (!marked.ok || !marked.selector) throw new Error(marked.error || 'composer_not_found');
  await send('debug_click', { ...payload, selector: marked.selector });
  await sleep(300);
}

async function attachFilesViaDomPaste(
  payload: Record<string, unknown>,
  files: string[],
): Promise<{ attached: number }> {
  const filePayload = files.map((file) => ({
    name: basename(file),
    mime: mimeFromPath(file),
    base64: readFileSync(file).toString('base64'),
  }));

  const result = await evalJson<{ ok: boolean; attached: number; error?: string }>(payload, `
    (async () => {
      const files = ${JSON.stringify(filePayload)};
      const visible = (el) => {
        const rect = el.getBoundingClientRect?.();
        return !rect || (rect.width > 0 && rect.height > 0);
      };
      const composers = Array.from(document.querySelectorAll('[aria-label="Enter a prompt for Gemini"], [contenteditable="true"], textarea'))
        .filter(visible);
      const composer = composers.pop();
      if (!composer) return JSON.stringify({ ok: false, attached: 0, error: 'composer_not_found' });

      const countAttachments = () => {
        const composerRect = composer.getBoundingClientRect?.();
        return Array.from(document.images)
          .filter((img) => {
            const alt = img.getAttribute('alt') || '';
            if (/attachment|uploaded image preview/i.test(alt)) return true;
            const rect = img.getBoundingClientRect?.();
            if (!rect || rect.width < 40 || rect.height < 40) return false;
            if (!composerRect) return false;
            return rect.bottom >= composerRect.top - 360 && rect.top <= composerRect.bottom + 180;
          })
          .length;
      };

      const before = countAttachments();
      const dataTransfer = new DataTransfer();
      for (const item of files) {
        const binary = atob(item.base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
        dataTransfer.items.add(new File([bytes], item.name, { type: item.mime }));
      }

      composer.focus();
      const event = new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: dataTransfer,
      });
      composer.dispatchEvent(event);

      const startedAt = Date.now();
      let attached = 0;
      while (Date.now() - startedAt < 15_000) {
        attached = Math.max(0, countAttachments() - before);
        if (attached >= files.length) break;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      return JSON.stringify({ ok: attached >= files.length, attached, error: attached >= files.length ? undefined : 'attachment_preview_timeout' });
    })()
  `);

  if (!result.ok) throw new Error(result.error || `only saw ${result.attached} attached image(s)`);
  return { attached: result.attached };
}

async function waitForAttachments(
  payload: Record<string, unknown>,
  expectedCount: number,
  timeoutMs: number,
): Promise<{ count: number }> {
  return waitForAttachmentCount(payload, expectedCount, timeoutMs);
}

async function waitForAttachmentCount(
  payload: Record<string, unknown>,
  expectedCount: number,
  timeoutMs: number,
): Promise<{ count: number }> {
  const startedAt = Date.now();
  let count = 0;
  while (Date.now() - startedAt < timeoutMs) {
    count = await countGeminiAttachments(payload);
    if (count >= expectedCount) return { count };
    await sleep(1_000);
  }
  throw new Error(`Timed out waiting for ${expectedCount} Gemini attachment preview(s); saw ${count}`);
}

async function countGeminiAttachments(payload: Record<string, unknown>): Promise<number> {
  const state = await evalJson<{ count: number }>(payload, `
    (() => {
      const count = Array.from(document.images)
        .filter((img) => /attachment|uploaded image preview/i.test(img.alt || ''))
        .length;
      return JSON.stringify({ count });
    })()
  `).catch(() => ({ count: 0 }));
  return state.count;
}

async function waitForComposer(payload: Record<string, unknown>, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const state = await evalJson<{ ok: boolean; url?: string }>(payload, `
      (() => {
        const visible = (el) => {
          const rect = el.getBoundingClientRect?.();
          return !rect || (rect.width > 0 && rect.height > 0);
        };
        const composer =
          Array.from(document.querySelectorAll('[aria-label="Enter a prompt for Gemini"]')).filter(visible).pop() ||
          Array.from(document.querySelectorAll('[contenteditable="true"], textarea')).filter(visible).pop();
        return JSON.stringify({ ok: !!composer, url: location.href });
      })()
    `).catch(() => ({ ok: false }));
    if (state.ok) return;
    await sleep(1_000);
  }
  throw new Error('Gemini composer did not become ready before timeout');
}

async function injectComposerText(
  payload: Record<string, unknown>,
  text: string,
): Promise<{ ok: boolean; tag?: string; text?: string; error?: string }> {
  return evalJson<{ ok: boolean; tag?: string; text?: string; error?: string }>(payload, `
    (() => {
      const text = ${JSON.stringify(text)};
      const visible = (el) => {
        const rect = el.getBoundingClientRect?.();
        return !rect || (rect.width > 0 && rect.height > 0);
      };
      const composer =
        Array.from(document.querySelectorAll('[aria-label="Enter a prompt for Gemini"]')).filter(visible).pop() ||
        Array.from(document.querySelectorAll('[contenteditable="true"], textarea')).filter(visible).pop();
      if (!composer) return JSON.stringify({ ok: false, error: 'composer_not_found' });
      composer.focus();
      document.execCommand('selectAll', false, null);
      const ok = document.execCommand('insertText', false, text);
      composer.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
      return JSON.stringify({ ok, tag: composer.tagName.toLowerCase(), text: composer.innerText || composer.value || '' });
    })()
  `);
}

async function clickSend(
  payload: Record<string, unknown>,
): Promise<{ ok: boolean; method: string; attempts: number; error?: string }> {
  let lastError: string | undefined;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await send('debug_show_window', payload).catch(() => undefined);
      await send('debug_click', { ...payload, selector: "[aria-label='Send message']" });
    } catch (error) {
      lastError = getErrorMessage(error);
    }
    await sleep(1_500);
    const state = await submitState(payload);
    if (state.busy || state.composerEmpty) {
      return { ok: true, method: 'debug_click', attempts: attempt, error: lastError };
    }
    await sleep(1_500);
  }

  try {
    const fallback = await evalJson<{ ok: boolean; error?: string }>(payload, `
      (() => {
        const visible = (el) => {
          const rect = el.getBoundingClientRect?.();
          return !!rect && rect.width > 0 && rect.height > 0;
        };
        const buttons = Array.from(document.querySelectorAll('button'))
          .filter((el) => visible(el) && !el.disabled);
        const button = buttons.find((el) => /send/i.test(el.getAttribute('aria-label') || el.innerText || ''));
        if (!button) return JSON.stringify({ ok: false, error: 'send_button_not_found' });
        button.click();
        return JSON.stringify({ ok: true });
      })()
    `);
    if (!fallback.ok) {
      return { ok: false, method: 'dom-click', attempts: 4, error: fallback.error || lastError };
    }
    await sleep(1_500);
    const state = await submitState(payload);
    return {
      ok: state.busy || state.composerEmpty,
      method: 'dom-click',
      attempts: 4,
      error: lastError,
    };
  } catch (error) {
    return { ok: false, method: 'dom-click', attempts: 4, error: getErrorMessage(error) };
  }
}

async function submitState(
  payload: Record<string, unknown>,
): Promise<{ busy: boolean; composerEmpty: boolean; url?: string }> {
  return evalJson<{ busy: boolean; composerEmpty: boolean; url?: string }>(payload, `
    (() => {
      const visible = (el) => {
        const rect = el.getBoundingClientRect?.();
        return !rect || (rect.width > 0 && rect.height > 0);
      };
      const composer =
        Array.from(document.querySelectorAll('[aria-label="Enter a prompt for Gemini"]')).filter(visible).pop() ||
        Array.from(document.querySelectorAll('[contenteditable="true"], textarea')).filter(visible).pop();
      const text = composer ? String(composer.innerText || composer.value || '').trim() : '';
      return JSON.stringify({
        busy: !!document.querySelector('[aria-label*="Stop" i]'),
        composerEmpty: text.length === 0,
        url: location.href,
      });
    })()
  `).catch(() => ({ busy: false, composerEmpty: false }));
}

async function enableImageMode(payload: Record<string, unknown>): Promise<{ ok: boolean; alreadyOn?: boolean; attempts?: number; skipped?: boolean; error?: string }> {
  let lastError: string | undefined;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const visibleState = await readImageModeMenuItem(payload);
    if (!visibleState.visible) {
      try {
        await send('debug_click', { ...payload, selector: "button[aria-label='Upload & tools']" });
      } catch (error) {
        lastError = `open_menu_failed: ${getErrorMessage(error)}`;
        await sleep(400);
        continue;
      }
      await sleep(400);
    }

    const state = await evalJson<{ ok: boolean; toggled: boolean; checked: string | null; error?: string }>(payload, `
      (() => {
        const visible = (el) => {
          const rect = el.getBoundingClientRect?.();
          return !!rect && rect.width > 0 && rect.height > 0;
        };
        const item = Array.from(document.querySelectorAll('[role=menuitemcheckbox]'))
          .filter(visible)
          .find((el) => /Create image/i.test(el.innerText || ''));
        if (!item) return JSON.stringify({ ok: false, toggled: false, checked: null, error: 'create_image_menuitem_not_found' });
        const before = item.getAttribute('aria-checked');
        let toggled = false;
        if (before !== 'true') {
          item.click();
          toggled = true;
        }
        return JSON.stringify({ ok: true, toggled, checked: item.getAttribute('aria-checked') });
      })()
    `).catch((error) => ({ ok: false, toggled: false, checked: null, error: getErrorMessage(error) }));

    await sleep(300);
    await dispatchEscape(payload).catch(() => undefined);
    if (state.ok && (state.checked === 'true' || state.toggled)) {
      return { ok: true, alreadyOn: !state.toggled, attempts: attempt };
    }
    lastError = state.error || `checked=${state.checked}`;
    await sleep(400);
  }
  return { ok: false, attempts: 3, error: lastError || 'unknown_failure' };
}

async function readImageModeMenuItem(payload: Record<string, unknown>): Promise<{ visible: boolean; checked?: string | null }> {
  return evalJson<{ visible: boolean; checked?: string | null }>(payload, `
    (() => {
      const visible = (el) => {
        const rect = el.getBoundingClientRect?.();
        return !!rect && rect.width > 0 && rect.height > 0;
      };
      const item = Array.from(document.querySelectorAll('[role=menuitemcheckbox]'))
        .filter(visible)
        .find((el) => /Create image/i.test(el.innerText || ''));
      return JSON.stringify({ visible: !!item, checked: item?.getAttribute('aria-checked') || null });
    })()
  `).catch(() => ({ visible: false, checked: null }));
}

async function waitForNewGeneratedImage(
  payload: Record<string, unknown>,
  beforeSources: Set<string>,
  timeoutMs: number,
): Promise<{ status: string; elapsed_ms: number; url?: string; image_count: number; timed_out: boolean }> {
  const startedAt = Date.now();
  let imageCount = 0;
  let lastUrl: string | undefined;
  while (Date.now() - startedAt < timeoutMs) {
    await sleep(DEFAULT_POLL_MS);
    const images = await listGeneratedImageSources(payload);
    imageCount = images.length;
    const fresh = images.some((item) => !beforeSources.has(item.source));
    const state = await evalJson<{ busy: boolean; url: string }>(payload, `
      (() => JSON.stringify({
        busy: !!document.querySelector('[aria-label*="Stop" i]'),
        url: location.href
      }))()
    `).catch(() => ({ busy: false, url: undefined as unknown as string }));
    lastUrl = state.url;
    if (fresh) {
      return {
        status: 'complete',
        elapsed_ms: Date.now() - startedAt,
        url: lastUrl,
        image_count: imageCount,
        timed_out: false,
      };
    }
    if (!state.busy && Date.now() - startedAt > 6_000) {
      await sleep(1_000);
    }
  }
  return {
    status: 'timeout',
    elapsed_ms: Date.now() - startedAt,
    url: lastUrl,
    image_count: imageCount,
    timed_out: true,
  };
}

async function listGeneratedImageSources(payload: Record<string, unknown>): Promise<GeminiImageSource[]> {
  return evalJson(payload, `
    (() => JSON.stringify(
      Array.from(document.images)
        .filter((img) => isGeneratedImageCandidate(img))
        .map((img) => ({ source: img.currentSrc || img.src || '' }))
        .filter((item) => item.source)
    ))()

    function isGeneratedImageCandidate(img) {
      if (!img || img.naturalWidth < 256 || img.naturalHeight < 256) return false;
      const src = img.currentSrc || img.src || '';
      const alt = img.alt || '';
      if (/profile|avatar|logo/i.test(alt)) return false;
      if (/AI generated|Generated image/i.test(alt)) return true;
      const rect = img.getBoundingClientRect?.();
      if (rect && (rect.width < 180 || rect.height < 180)) return false;
      return /blob:|googleusercontent|generativelanguage|usercontent|gemini/i.test(src) || (img.naturalWidth >= 512 && img.naturalHeight >= 512);
    }
  `);
}

async function extractGeneratedImages(
  payload: Record<string, unknown>,
  beforeSources: Set<string>,
): Promise<ImageArtifact[]> {
  const before = JSON.stringify(Array.from(beforeSources));
  return evalJson(payload, `
    (async () => {
      const before = new Set(${before});
      const images = Array.from(document.images)
        .filter((img) => isGeneratedImageCandidate(img))
        .filter((img) => !before.has(img.currentSrc || img.src || ''));
      function isGeneratedImageCandidate(img) {
        if (!img || img.naturalWidth < 256 || img.naturalHeight < 256) return false;
        const src = img.currentSrc || img.src || '';
        const alt = img.alt || '';
        if (/profile|avatar|logo/i.test(alt)) return false;
        if (/AI generated|Generated image/i.test(alt)) return true;
        const rect = img.getBoundingClientRect?.();
        if (rect && (rect.width < 180 || rect.height < 180)) return false;
        return /blob:|googleusercontent|generativelanguage|usercontent|gemini/i.test(src) || (img.naturalWidth >= 512 && img.naturalHeight >= 512);
      }
      const blobToBase64 = (blob) => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error || new Error('FileReader failed'));
        reader.onload = () => {
          const result = String(reader.result || '');
          const comma = result.indexOf(',');
          resolve(comma >= 0 ? result.slice(comma + 1) : result);
        };
        reader.readAsDataURL(blob);
      });
      const tryFetch = async (url) => {
        const resp = await fetch(url, { credentials: 'include', mode: 'cors' });
        if (!resp.ok) throw new Error('fetch_status_' + resp.status);
        const blob = await resp.blob();
        const mime = (blob.type && blob.type.startsWith('image/')) ? blob.type : 'image/png';
        return { base64: await blobToBase64(blob), mime, bytes: blob.size };
      };
      const tryCanvas = (img) => {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        canvas.getContext('2d').drawImage(img, 0, 0);
        const dataUrl = canvas.toDataURL('image/png');
        return { base64: dataUrl.split(',')[1] || '', mime: 'image/png' };
      };
      const artifacts = [];
      for (const img of images) {
        const source = img.currentSrc || img.src || 'canvas';
        try {
          let payload;
          try {
            payload = await tryFetch(source);
          } catch (fetchErr) {
            payload = tryCanvas(img);
          }
          artifacts.push({
            index: artifacts.length + 1,
            type: 'image',
            source,
            mime: payload.mime || 'image/png',
            width: img.naturalWidth,
            height: img.naturalHeight,
            base64: payload.base64,
          });
        } catch (error) {
          artifacts.push({
            index: artifacts.length + 1,
            type: 'image',
            source,
            mime: 'image/png',
            width: img.naturalWidth,
            height: img.naturalHeight,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      return JSON.stringify(artifacts);
    })()
  `);
}

export async function evalJson<T>(payload: Record<string, unknown>, expression: string): Promise<T> {
  const result = await send('debug_eval', { ...payload, expression, awaitPromise: true });
  if (result.exception) throw new Error(result.exception);
  if (typeof result.result !== 'string') return result.result as T;
  return JSON.parse(result.result) as T;
}

export async function send(actionType: string, payload: Record<string, unknown>): Promise<ActionResult> {
  return sendAction(actionType, payload) as Promise<ActionResult>;
}

export type { ActionResult, VideoArtifact };

function buildImageGeneratePrompt(
  prompt: string,
  size?: string,
  quality?: string,
  referenceCount = 0,
): string {
  return [
    'Generate one real raster image file (PNG/JPG/WebP), not SVG, HTML, canvas code, Python drawing, or a placeholder.',
    size ? `Target size/aspect: ${size}.` : '',
    quality ? `Rendering quality target: ${quality}.` : '',
    referenceCount > 0 ? `Use the ${referenceCount} attached reference image(s) as visual references where relevant.` : '',
    'Do not add captions, logos, or watermarks unless the user explicitly asked for them.',
    'After the image is generated, do not do extra reasoning; just leave the generated image visible in the chat.',
    '',
    `Prompt: ${prompt}`,
  ].filter(Boolean).join('\n');
}

export async function resolveImageInputs(values: string[], artifactDir?: string): Promise<string[]> {
  const out: string[] = [];
  const dir = artifactDir || join(tmpdir(), 'bnbot-gemini-web-artifacts');
  for (const value of values) {
    const trimmed = String(value || '').trim();
    if (!trimmed) continue;
    out.push(await resolveImageInput(trimmed, dir));
  }
  return out;
}

async function resolveImageInput(value: string, dir: string): Promise<string> {
  if (value.startsWith('data:image/')) return writeDataUrlImage(value, dir);
  if (/^https?:\/\//i.test(value)) return downloadImage(value, dir);
  const path = value.replace(/^~/, homedir());
  if (!existsSync(path)) throw new Error(`reference image not found: ${value}`);
  return path;
}

function writeDataUrlImage(value: string, dir: string): string {
  const match = value.match(/^data:(image\/[^;]+);base64,(.+)$/);
  if (!match) throw new Error('invalid data URL reference image');
  mkdirSync(dir, { recursive: true });
  const ext = mimeToExt(match[1]);
  const path = join(dir, `gemini-web-reference-${Date.now()}-${Math.random().toString(16).slice(2)}.${ext}`);
  writeFileSync(path, Buffer.from(match[2], 'base64'));
  return path;
}

async function downloadImage(url: string, dir: string): Promise<string> {
  mkdirSync(dir, { recursive: true });
  const response = await fetch(url);
  if (!response.ok) throw new Error(`failed to download reference image ${url}: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const mime = response.headers.get('content-type') || 'image/png';
  if (!/^image\//i.test(mime)) throw new Error(`reference URL is not an image: ${url}`);
  const ext = mimeToExt(mime);
  const path = join(dir, `gemini-web-reference-${Date.now()}-${Math.random().toString(16).slice(2)}.${ext}`);
  writeFileSync(path, bytes);
  return path;
}

function persistArtifacts(
  artifacts: ImageArtifact[],
  artifactDir?: string,
  inlineArtifacts = false,
): ImageArtifact[] {
  if (!artifacts.length) return artifacts;
  const dir = artifactDir || join(tmpdir(), 'bnbot-gemini-web-artifacts');
  mkdirSync(dir, { recursive: true });

  return artifacts.map((artifact, index) => {
    if (!artifact.base64 || artifact.error) return artifact;
    const bytes = Buffer.from(artifact.base64, 'base64');
    const ext = mimeToExt(artifact.mime);
    const path = join(dir, `gemini-web-artifact-${Date.now()}-${index + 1}.${ext}`);
    writeFileSync(path, bytes);
    const persisted: ImageArtifact = {
      ...artifact,
      path,
      bytes: bytes.length,
    };
    if (!inlineArtifacts || bytes.length > MAX_IMAGE_BYTES) delete persisted.base64;
    return persisted;
  });
}

function imageArtifactToApiImage(
  artifact: ImageArtifact,
  responseFormat: string,
): Record<string, unknown> {
  const image: Record<string, unknown> = {
    mime: artifact.mime,
    width: artifact.width,
    height: artifact.height,
    bytes: artifact.bytes,
  };
  if (artifact.path) image.path = artifact.path;
  if (responseFormat === 'b64_json' && artifact.base64) image.b64_json = artifact.base64;
  return image;
}

function renumberArtifacts(artifacts: ImageArtifact[]): ImageArtifact[] {
  return artifacts.map((artifact, index) => ({ ...artifact, index: index + 1 }));
}

export async function readTextArgument(value: string): Promise<string> {
  if (value !== '-') return value;
  return await new Promise<string>((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data.trim()));
    process.stdin.on('error', reject);
  });
}

export function parseTimeoutMs(value: string | undefined, fallbackMs: number): number {
  if (!value) return fallbackMs;
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallbackMs;
  return Math.round(parsed * 1000);
}

function mimeFromPath(file: string): string {
  const ext = extname(file).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  return 'image/png';
}

function setClipboardImage(file: string): void {
  if (process.platform !== 'darwin') {
    throw new Error('image paste fallback requires macOS');
  }
  const clipboardPath = ensureClipboardPng(file);
  execFileSync('osascript', ['-e', `set the clipboard to (read (POSIX file ${JSON.stringify(clipboardPath)}) as «class PNGf»)`], {
    stdio: 'ignore',
    timeout: 10_000,
  });
}

function ensureClipboardPng(file: string): string {
  if (extname(file).toLowerCase() === '.png') return file;
  const out = join(tmpdir(), `bnbot-gemini-clipboard-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.png`);
  execFileSync('sips', ['-s', 'format', 'png', file, '--out', out], {
    stdio: 'ignore',
    timeout: 30_000,
  });
  return out;
}

function mimeToExt(mime: string): string {
  if (/jpe?g/i.test(mime)) return 'jpg';
  if (/webp/i.test(mime)) return 'webp';
  if (/gif/i.test(mime)) return 'gif';
  if (/png/i.test(mime)) return 'png';
  return extname(mime).replace('.', '') || 'png';
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

// ── video-generate ───────────────────────────────────────────────────────────

interface GeminiWebVideoGenerateOptions {
  image?: string[];
  aspect?: string;
  timeout?: string;
  responseFormat?: string;
  artifactDir?: string;
  inlineArtifacts?: boolean;
  tabId?: string;
  url?: string;
}

interface VideoArtifact {
  index: number;
  type: 'video';
  source: string;
  mime: string;
  bytes?: number;
  base64?: string;
  path?: string;
  duration_s?: number;
  width?: number;
  height?: number;
  error?: string;
  watermark_removed?: boolean;
  watermark_removal_error?: string;
}

export async function geminiWebVideoGenerateCommand(
  promptArg: string,
  options: GeminiWebVideoGenerateOptions,
): Promise<void> {
  const prompt = await readTextArgument(promptArg);
  const timeoutMs = parseTimeoutMs(options.timeout, DEFAULT_VIDEO_TIMEOUT_MS);
  const responseFormat = options.responseFormat || 'path';
  if (responseFormat !== 'path' && responseFormat !== 'b64_json') {
    throw new Error('--response-format must be one of: path, b64_json');
  }
  const inlineArtifacts = options.inlineArtifacts === true || responseFormat === 'b64_json';
  const startedAt = Date.now();

  await ensureServer(DEFAULT_PORT);
  const target = await openGeminiVideoTarget(options);
  const basePayload = targetPayload(target);
  await waitForComposer(basePayload, Math.min(timeoutMs, 60_000));

  const beforeSources = new Set((await listGeneratedVideoSources(basePayload)).map((item) => item.source));
  const videoMode = await enableVideoMode(basePayload);
  const referenceImages = await resolveImageInputs(options.image ?? [], options.artifactDir);
  const attachments = await attachFiles(basePayload, referenceImages);
  const text = buildVideoGeneratePrompt(prompt, options.aspect, referenceImages.length);
  const injected = await injectComposerText(basePayload, text);
  if (!injected.ok) throw new Error(injected.error || 'Could not find Gemini composer input');

  const aspectLabel = normalizeAspectLabel(options.aspect);
  const aspectResult = aspectLabel ? await selectAspect(basePayload, aspectLabel) : { ok: true, skipped: true };

  await sleep(400);
  const submit = await clickSend(basePayload);
  const wait = await waitForNewGeneratedVideo(basePayload, beforeSources, timeoutMs);
  const rawArtifacts = await extractGeneratedVideos(basePayload, beforeSources);
  const persistedVideos = renumberVideoArtifacts(persistVideoArtifacts(rawArtifacts, options.artifactDir, inlineArtifacts));
  const artifacts = await stripVideoWatermarks(persistedVideos, inlineArtifacts);
  const videos = artifacts.map((artifact) => videoArtifactToApi(artifact, responseFormat));

  printJson({
    success: videos.length > 0,
    action: 'video-generate',
    provider: 'gemini-web',
    app: 'Google Gemini',
    url: wait.url || target.url || null,
    prompt,
    aspect: aspectLabel || options.aspect || null,
    reference_images: referenceImages.length,
    response_format: responseFormat,
    duration_ms: Date.now() - startedAt,
    video_mode: videoMode,
    aspect_select: aspectResult,
    submit,
    attachments,
    wait,
    watermark_removal: videoWatermarkRemovalSummary(artifacts),
    videos,
    artifacts,
    error: videos.length > 0 ? undefined : 'No video artifact was produced by Gemini Web.',
  });
}

function normalizeAspectLabel(input?: string): string | null {
  if (!input) return null;
  const s = input.toLowerCase().trim();
  if (/^landscape \(16:9\)$/i.test(input)) return 'Landscape (16:9)';
  if (/^portrait \(9:16\)$/i.test(input)) return 'Portrait (9:16)';
  if (/16:9|landscape|horizontal|wide/.test(s)) return 'Landscape (16:9)';
  if (/9:16|portrait|vertical|tall/.test(s)) return 'Portrait (9:16)';
  return null;
}

async function selectAspect(payload: Record<string, unknown>, label: string): Promise<{ ok: boolean; current?: string; error?: string }> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const open = await evalJson<{ ok: boolean; current?: string }>(payload, `
      (() => {
        const visible = (el) => { const r = el.getBoundingClientRect && el.getBoundingClientRect(); return !!r && r.width > 0 && r.height > 0; };
        const btn = Array.from(document.querySelectorAll('button, [role=button]')).filter(visible)
          .find(el => /^(Landscape \\(16:9\\)|Portrait \\(9:16\\))/.test((el.innerText || '').trim()));
        if (!btn) return JSON.stringify({ ok: false });
        const current = (btn.innerText || '').trim();
        btn.click();
        return JSON.stringify({ ok: true, current });
      })()
    `).catch(() => ({ ok: false, current: undefined as string | undefined }));
    if (!open.ok) {
      await sleep(400);
      continue;
    }
    if (open.current === label) {
      // Already on desired aspect — close the dropdown and return.
      await dispatchEscape(payload).catch(() => undefined);
      return { ok: true, current: label };
    }
    await sleep(400);
    const pick = await evalJson<{ ok: boolean; error?: string }>(payload, `
      (() => {
        const item = Array.from(document.querySelectorAll('[role=menuitemradio]'))
          .find(el => el.getAttribute('aria-label') === ${JSON.stringify(label)});
        if (!item) return JSON.stringify({ ok: false, error: 'option_not_found' });
        item.click();
        return JSON.stringify({ ok: true });
      })()
    `).catch((error) => ({ ok: false, error: getErrorMessage(error) }));
    await dispatchEscape(payload).catch(() => undefined);
    if (pick.ok) return { ok: true, current: label };
    await sleep(400);
  }
  return { ok: false, error: 'failed_to_select_aspect' };
}

export function videoWatermarkRemovalSummary(artifacts: VideoArtifact[]): Record<string, unknown> {
  const removed = artifacts.filter((a) => a.watermark_removed).length;
  const failed = artifacts
    .filter((a) => a.watermark_removal_error)
    .map((a) => ({ index: a.index, error: a.watermark_removal_error }));
  return {
    method: 'ffmpeg-delogo',
    removed,
    total: artifacts.length,
    failed: failed.length > 0 ? failed : undefined,
  };
}

export async function stripVideoWatermarks(
  artifacts: VideoArtifact[],
  inlineArtifacts: boolean,
): Promise<VideoArtifact[]> {
  const ffmpeg = await resolveFfmpeg();
  if (!ffmpeg) {
    return artifacts.map((a) =>
      a.path ? { ...a, watermark_removed: false, watermark_removal_error: 'ffmpeg not found on PATH' } : a,
    );
  }
  const out: VideoArtifact[] = [];
  for (const artifact of artifacts) {
    if (!artifact.path || artifact.error) {
      out.push(artifact);
      continue;
    }
    try {
      const updated = await stripVideoWatermarkInPlace(ffmpeg, artifact, inlineArtifacts);
      out.push(updated);
    } catch (error) {
      out.push({ ...artifact, watermark_removed: false, watermark_removal_error: getErrorMessage(error) });
    }
  }
  return out;
}

async function stripVideoWatermarkInPlace(
  ffmpeg: string,
  artifact: VideoArtifact,
  inlineArtifacts: boolean,
): Promise<VideoArtifact> {
  const sourcePath = artifact.path as string;
  const dims = await probeVideoDimensions(ffmpeg, sourcePath);
  const width = artifact.width || dims.width;
  const height = artifact.height || dims.height;
  if (!width || !height) {
    throw new Error('could not determine video dimensions');
  }
  const rect = computeWatermarkRect(width, height);
  const tmpPath = `${sourcePath}.delogo.tmp.mp4`;
  const filter = `delogo=x=${rect.x}:y=${rect.y}:w=${rect.w}:h=${rect.h}:show=0`;
  await execFileAsync(
    ffmpeg,
    ['-y', '-loglevel', 'error', '-i', sourcePath, '-vf', filter, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart', tmpPath],
    { maxBuffer: 32 * 1024 * 1024 },
  );
  const cleaned = readFileSync(tmpPath);
  writeFileSync(sourcePath, cleaned);
  try { unlinkSync(tmpPath); } catch { /* ignore */ }
  const next: VideoArtifact = {
    ...artifact,
    bytes: cleaned.length,
    width,
    height,
    watermark_removed: true,
  };
  if (inlineArtifacts && cleaned.length <= MAX_VIDEO_INLINE_BYTES) {
    next.base64 = cleaned.toString('base64');
  } else if (artifact.base64) {
    delete next.base64;
  }
  return next;
}

async function probeVideoDimensions(ffmpeg: string, path: string): Promise<{ width?: number; height?: number }> {
  // ffmpeg prints stream info to stderr. Read it and parse "WxH".
  try {
    const { stderr } = await execFileAsync(ffmpeg, ['-i', path, '-hide_banner'], { maxBuffer: 4 * 1024 * 1024 }).catch((err) => {
      const e = err as { stderr?: string; stdout?: string };
      return { stderr: e.stderr || '', stdout: e.stdout || '' } as { stderr: string; stdout: string };
    });
    const match = /(\d{2,5})x(\d{2,5})/.exec(stderr);
    if (match) return { width: Number(match[1]), height: Number(match[2]) };
    return {};
  } catch {
    return {};
  }
}

async function openGeminiVideoTarget(options: GeminiWebVideoGenerateOptions): Promise<ActionResult> {
  if (options.tabId) {
    return {
      tabId: Number.parseInt(options.tabId, 10),
      url: options.url || DEFAULT_GEMINI_APP_URL,
    };
  }
  // Spawn a dedicated tab so parallel video-generate runs don't share
  // the same Create-video toggle + Slate composer.
  return send('navigate_to_url', { url: options.url || DEFAULT_GEMINI_APP_URL, spawn: true });
}

async function enableVideoMode(payload: Record<string, unknown>): Promise<{ ok: boolean; alreadyOn?: boolean; attempts?: number; error?: string }> {
  // Open the "Upload & tools" menu, wait for the "Create video" menuitemcheckbox
  // to render, toggle it if not already on, then close the menu.
  let lastError: string | undefined;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await send('debug_click', { ...payload, selector: "button[aria-label='Upload & tools']" });
    } catch (error) {
      lastError = `open_menu_failed: ${getErrorMessage(error)}`;
      await sleep(500);
      continue;
    }
    const found = await waitForVideoMenuItem(payload, 5_000);
    if (!found.ok) {
      lastError = found.error || 'menuitem_not_found';
      // Close any partial menu before retrying
      await dispatchEscape(payload).catch(() => undefined);
      await sleep(400);
      continue;
    }
    const state = await evalJson<{ toggled: boolean; checked: string | null; error?: string }>(payload, `
      (() => {
        const item = Array.from(document.querySelectorAll('[role=menuitemcheckbox]'))
          .find(el => /Create video/i.test(el.innerText || ''));
        if (!item) return JSON.stringify({ toggled: false, checked: null, error: 'menuitem_disappeared' });
        const before = item.getAttribute('aria-checked');
        let toggled = false;
        if (before !== 'true') { item.click(); toggled = true; }
        return JSON.stringify({ toggled, checked: item.getAttribute('aria-checked') });
      })()
    `).catch((error) => ({ toggled: false, checked: null, error: getErrorMessage(error) }));
    await sleep(300);
    await dispatchEscape(payload).catch(() => undefined);
    if (state.checked === 'true') {
      return { ok: true, alreadyOn: !state.toggled, attempts: attempt };
    }
    lastError = state.error || `checked=${state.checked}`;
    await sleep(400);
  }
  return { ok: false, attempts: 3, error: lastError || 'unknown_failure' };
}

async function waitForVideoMenuItem(payload: Record<string, unknown>, timeoutMs: number): Promise<{ ok: boolean; error?: string }> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const state = await evalJson<{ ok: boolean }>(payload, `
      (() => JSON.stringify({
        ok: !!Array.from(document.querySelectorAll('[role=menuitemcheckbox]'))
          .find(el => /Create video/i.test(el.innerText || ''))
      }))()
    `).catch(() => ({ ok: false }));
    if (state.ok) return { ok: true };
    await sleep(250);
  }
  return { ok: false, error: 'menuitem_not_found' };
}

async function dispatchEscape(payload: Record<string, unknown>): Promise<void> {
  await evalJson(payload, `
    (() => {
      document.activeElement && document.activeElement.blur && document.activeElement.blur();
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true }));
      document.body.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true }));
      return JSON.stringify({ ok: true });
    })()
  `);
}

function buildVideoGeneratePrompt(prompt: string, aspect?: string, referenceCount = 0): string {
  return [
    aspect ? `Aspect ratio: ${aspect}.` : '',
    referenceCount > 0 ? `Use the ${referenceCount} attached reference image(s) as visual references.` : '',
    'Do not add captions, watermarks, or text overlays unless the user explicitly asked for them.',
    `Prompt: ${prompt}`,
  ].filter(Boolean).join('\n');
}

async function listGeneratedVideoSources(payload: Record<string, unknown>): Promise<{ source: string }[]> {
  return evalJson(payload, `
    (() => JSON.stringify(
      Array.from(document.querySelectorAll('video'))
        .map(v => ({ source: v.currentSrc || v.src || '' }))
        .filter(it => it.source)
    ))()
  `);
}

async function waitForNewGeneratedVideo(
  payload: Record<string, unknown>,
  beforeSources: Set<string>,
  timeoutMs: number,
): Promise<{ status: string; elapsed_ms: number; url?: string; video_count: number; timed_out: boolean }> {
  const startedAt = Date.now();
  let videoCount = 0;
  let lastUrl: string | undefined;
  while (Date.now() - startedAt < timeoutMs) {
    await sleep(DEFAULT_VIDEO_POLL_MS);
    const videos = await listGeneratedVideoSources(payload).catch(() => [] as { source: string }[]);
    videoCount = videos.length;
    const fresh = videos.some((item) => item.source && !beforeSources.has(item.source));
    const state = await evalJson<{ busy: boolean; url: string }>(payload, `
      (() => JSON.stringify({
        busy: !!document.querySelector('[aria-label*="Stop" i]'),
        url: location.href
      }))()
    `).catch(() => ({ busy: false, url: undefined as unknown as string }));
    lastUrl = state.url;
    if (fresh) {
      return {
        status: 'complete',
        elapsed_ms: Date.now() - startedAt,
        url: lastUrl,
        video_count: videoCount,
        timed_out: false,
      };
    }
  }
  return {
    status: 'timeout',
    elapsed_ms: Date.now() - startedAt,
    url: lastUrl,
    video_count: videoCount,
    timed_out: true,
  };
}

async function extractGeneratedVideos(
  payload: Record<string, unknown>,
  beforeSources: Set<string>,
): Promise<VideoArtifact[]> {
  const before = JSON.stringify(Array.from(beforeSources));
  return evalJson(payload, `
    (async () => {
      const before = new Set(${before});
      const videos = Array.from(document.querySelectorAll('video'))
        .filter(v => (v.currentSrc || v.src) && !before.has(v.currentSrc || v.src));
      const blobToBase64 = (blob) => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error || new Error('FileReader failed'));
        reader.onload = () => {
          const result = String(reader.result || '');
          const comma = result.indexOf(',');
          resolve(comma >= 0 ? result.slice(comma + 1) : result);
        };
        reader.readAsDataURL(blob);
      });
      const out = [];
      for (const v of videos) {
        const source = v.currentSrc || v.src;
        try {
          const resp = await fetch(source, { credentials: 'include' });
          if (!resp.ok) throw new Error('fetch_status_' + resp.status);
          const blob = await resp.blob();
          const mime = (blob.type && blob.type.startsWith('video/')) ? blob.type : 'video/mp4';
          out.push({
            index: out.length + 1,
            type: 'video',
            source,
            mime,
            duration_s: Number.isFinite(v.duration) ? v.duration : undefined,
            width: v.videoWidth || undefined,
            height: v.videoHeight || undefined,
            bytes: blob.size,
            base64: await blobToBase64(blob),
          });
        } catch (error) {
          out.push({
            index: out.length + 1,
            type: 'video',
            source,
            mime: 'video/mp4',
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      return JSON.stringify(out);
    })()
  `);
}

export function persistVideoArtifacts(
  artifacts: VideoArtifact[],
  artifactDir?: string,
  inlineArtifacts = false,
): VideoArtifact[] {
  if (!artifacts.length) return artifacts;
  const dir = artifactDir || join(tmpdir(), 'bnbot-gemini-web-artifacts');
  mkdirSync(dir, { recursive: true });
  return artifacts.map((artifact, index) => {
    if (!artifact.base64 || artifact.error) return artifact;
    const bytes = Buffer.from(artifact.base64, 'base64');
    const ext = videoMimeToExt(artifact.mime);
    const path = join(dir, `gemini-web-video-${Date.now()}-${index + 1}.${ext}`);
    writeFileSync(path, bytes);
    const persisted: VideoArtifact = {
      ...artifact,
      path,
      bytes: bytes.length,
    };
    if (!inlineArtifacts || bytes.length > MAX_VIDEO_INLINE_BYTES) delete persisted.base64;
    return persisted;
  });
}

export function videoArtifactToApi(artifact: VideoArtifact, responseFormat: string): Record<string, unknown> {
  const out: Record<string, unknown> = {
    mime: artifact.mime,
    bytes: artifact.bytes,
  };
  if (artifact.width) out.width = artifact.width;
  if (artifact.height) out.height = artifact.height;
  if (artifact.duration_s !== undefined) out.duration_s = artifact.duration_s;
  if (artifact.path) out.path = artifact.path;
  if (responseFormat === 'b64_json' && artifact.base64) out.b64_json = artifact.base64;
  return out;
}

export function renumberVideoArtifacts(artifacts: VideoArtifact[]): VideoArtifact[] {
  return artifacts.map((artifact, index) => ({ ...artifact, index: index + 1 }));
}

function videoMimeToExt(mime: string): string {
  if (/mp4/i.test(mime)) return 'mp4';
  if (/webm/i.test(mime)) return 'webm';
  if (/quicktime/i.test(mime)) return 'mov';
  return 'mp4';
}
