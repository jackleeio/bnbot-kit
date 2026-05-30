import { closeSync, existsSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { ensureServer } from '../cli';
import { stripImageWatermarks } from '../tools/watermark';
import { sendAction } from './debug';

const DEFAULT_PORT = 18900;
const DEFAULT_CHATGPT_URL = 'https://chatgpt.com/';
const DEFAULT_TIMEOUT_MS = 300_000;
const DEFAULT_POLL_MS = 2_000;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_CHATGPT_WORKERS = 3;
const DEFAULT_CHATGPT_WORKERS = 3;
const WORKER_LEASE_GRACE_MS = 120_000;
const WORKER_LOCK_STALE_MS = 30_000;
const WORKER_STATE_PATH = join(tmpdir(), 'bnbot-chatgpt-web-workers.json');
const WORKER_LOCK_PATH = `${WORKER_STATE_PATH}.lock`;

interface ChatGPTWebImageGenerateOptions {
  image?: string[];
  n?: string;
  size?: string;
  quality?: string;
  timeout?: string;
  responseFormat?: string;
  artifactDir?: string;
  inlineArtifacts?: boolean;
  tabId?: string;
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

interface WebImageSource {
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
  watermark_metadata_stripped?: boolean;
  watermark_metadata_error?: string;
}

interface ChatGPTWorker {
  tabId: number;
  url?: string;
  title?: string;
  windowId?: number;
  createdAt: number;
  lastUsedAt: number;
  leaseId?: string;
  leaseUntil?: number;
}

interface ChatGPTWorkerState {
  workers: ChatGPTWorker[];
}

interface ChatGPTWorkerLease {
  target: ActionResult;
  leaseId?: string;
  reused: boolean;
  workerPool: boolean;
  maxWorkers: number;
  release: () => Promise<void>;
}

export async function chatgptWebImageGenerateCommand(
  promptArg: string,
  options: ChatGPTWebImageGenerateOptions,
): Promise<void> {
  const prompt = await readTextArgument(promptArg);
  const timeoutMs = parseTimeoutMs(options.timeout, DEFAULT_TIMEOUT_MS);
  const responseFormat = options.responseFormat || 'path';
  if (responseFormat !== 'path' && responseFormat !== 'b64_json') {
    throw new Error('--response-format must be one of: path, b64_json');
  }
  const n = parsePositiveInt(options.n, 1);

  const inlineArtifacts = options.inlineArtifacts === true || responseFormat === 'b64_json';
  const startedAt = Date.now();

  await ensureServer(DEFAULT_PORT);
  const worker = await openChatGPTTarget(options, timeoutMs);
  try {
    const target = worker.target;
    const conversationReset = options.keepChat
      ? { skipped: true, reason: 'keep_chat' }
      : await prepareFreshChatGPTConversation(target, options.url || DEFAULT_CHATGPT_URL);
    const basePayload = targetPayload(target);
    await waitForComposer(basePayload, Math.min(timeoutMs, 60_000));

    const referenceImages = await resolveImageInputs(options.image ?? [], options.artifactDir);
    const attachments = await attachFiles(basePayload, referenceImages);
    await sleep(500);
    const beforeSources = new Set((await listGeneratedImageSources(basePayload)).map((item) => item.source));
    const text = buildImageGeneratePrompt(prompt, options.size, options.quality, referenceImages.length, n);
    const injected = await injectComposerText(basePayload, text);
    if (!injected.ok) throw new Error(injected.error || 'Could not find ChatGPT web composer input');

    await sleep(500);
    const submit = await clickSend(basePayload);
    const wait = await waitForNewGeneratedImage(basePayload, beforeSources, timeoutMs, n);
    const rawArtifacts = await extractGeneratedImages(basePayload, beforeSources);
    const persisted = renumberArtifacts(persistArtifacts(rawArtifacts, options.artifactDir, inlineArtifacts));
    const artifacts = await stripArtifactMetadata(persisted, inlineArtifacts);
    const images = artifacts.map((artifact) => imageArtifactToApiImage(artifact, responseFormat));

    printJson({
      success: images.length > 0,
      action: 'image-generate',
      provider: 'chatgpt-web',
      app: 'ChatGPT Web',
      url: wait.url || target.url || null,
      prompt,
      n,
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
      submit,
      attachments,
      wait,
      watermark_removal: metadataSummary(artifacts),
      images,
      artifacts,
      error: images.length > 0 ? undefined : 'No raster image artifact was produced by ChatGPT Web.',
    });
  } finally {
    await worker.release();
  }
}

function metadataSummary(artifacts: ImageArtifact[]): Record<string, unknown> {
  const stripped = artifacts.filter((a) => a.watermark_metadata_stripped).length;
  const failed = artifacts
    .filter((a) => a.watermark_metadata_error)
    .map((a) => ({ index: a.index, error: a.watermark_metadata_error }));
  return {
    method: 'metadata-strip',
    metadata_stripped: stripped,
    total: artifacts.length,
    failed: failed.length > 0 ? failed : undefined,
  };
}

async function stripArtifactMetadata(
  artifacts: ImageArtifact[],
  inlineArtifacts: boolean,
): Promise<ImageArtifact[]> {
  const out: ImageArtifact[] = [];
  for (const artifact of artifacts) {
    if (!artifact.path || artifact.error) {
      out.push(artifact);
      continue;
    }
    const result = await stripImageWatermarks(artifact.path, { removeVisibleWatermark: false });
    const cleaned = readFileSync(artifact.path);
    const next: ImageArtifact = {
      ...artifact,
      bytes: cleaned.length,
      watermark_metadata_stripped: result.metadata_stripped,
    };
    if (result.error) next.watermark_metadata_error = result.error;
    if (inlineArtifacts && cleaned.length <= MAX_IMAGE_BYTES) {
      next.base64 = cleaned.toString('base64');
    } else if (artifact.base64) {
      next.base64 = cleaned.toString('base64');
    }
    out.push(next);
  }
  return out;
}

async function openChatGPTTarget(
  options: ChatGPTWebImageGenerateOptions,
  timeoutMs: number,
): Promise<ChatGPTWorkerLease> {
  if (options.tabId) {
    return {
      target: {
        tabId: Number.parseInt(options.tabId, 10),
        url: options.url || DEFAULT_CHATGPT_URL,
      },
      reused: true,
      workerPool: false,
      maxWorkers: getChatGPTWorkerMax(options),
      release: async () => undefined,
    };
  }
  if (options.keepChat) {
    return {
      target: {
        url: options.url || DEFAULT_CHATGPT_URL,
      },
      reused: true,
      workerPool: false,
      maxWorkers: getChatGPTWorkerMax(options),
      release: async () => undefined,
    };
  }
  if (options.freshTab) {
    return {
      target: await send('navigate_to_url', { url: options.url || DEFAULT_CHATGPT_URL, spawn: true }),
      reused: false,
      workerPool: false,
      maxWorkers: getChatGPTWorkerMax(options),
      release: async () => undefined,
    };
  }
  return acquireChatGPTWorker(options, timeoutMs);
}

async function acquireChatGPTWorker(
  options: ChatGPTWebImageGenerateOptions,
  timeoutMs: number,
): Promise<ChatGPTWorkerLease> {
  const maxWorkers = getChatGPTWorkerMax(options);
  const url = options.url || DEFAULT_CHATGPT_URL;
  const deadline = Date.now() + Math.max(timeoutMs, 60_000);
  let lastReason = 'all workers are busy';

  while (Date.now() < deadline) {
    const lease = await withWorkerLock(async () => {
      const state = readWorkerState();
      await seedChatGPTWorkersFromTabs(state, maxWorkers);
      const now = Date.now();
      let changed = pruneInvalidWorkers(state);
      changed = pruneWorkersToMax(state, maxWorkers, now) || changed;

      const freeWorkers = [...state.workers]
        .filter((worker) => !worker.leaseUntil || worker.leaseUntil <= now)
        .sort((a, b) => a.lastUsedAt - b.lastUsedAt);

      for (const worker of freeWorkers) {
        const status = await getChatGPTTabStatus(worker.tabId).catch(() => null);
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
        writeWorkerState(state);
        return makeWorkerLease(worker.tabId, worker.url || url, leaseId, true, maxWorkers);
      }

      if (state.workers.length < maxWorkers) {
        const spawned = await send('navigate_to_url', { url, spawn: true });
        if (typeof spawned.tabId !== 'number' || !Number.isFinite(spawned.tabId)) {
          throw new Error('ChatGPT Web worker spawn did not return a tabId');
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
        writeWorkerState(state);
        return makeWorkerLease(spawned.tabId, spawned.url || url, leaseId, false, maxWorkers);
      }

      if (changed) writeWorkerState(state);
      return null;
    });

    if (lease) return lease;
    await sleep(1_000);
  }

  throw new Error(`Timed out waiting for a free ChatGPT Web worker tab (${lastReason}; max ${maxWorkers})`);
}

function makeWorkerLease(
  tabId: number,
  url: string,
  leaseId: string,
  reused: boolean,
  maxWorkers: number,
): ChatGPTWorkerLease {
  return {
    target: { tabId, url },
    leaseId,
    reused,
    workerPool: true,
    maxWorkers,
    release: () => releaseChatGPTWorker(tabId, leaseId),
  };
}

async function releaseChatGPTWorker(tabId: number, leaseId: string): Promise<void> {
  await withWorkerLock(async () => {
    const state = readWorkerState();
    const worker = state.workers.find((item) => item.tabId === tabId);
    if (!worker || worker.leaseId !== leaseId) return;
    const status = await getChatGPTTabStatus(tabId).catch(() => null);
    if (status?.ok) {
      worker.url = status.url;
      worker.title = status.title;
      worker.lastUsedAt = Date.now();
      delete worker.leaseId;
      delete worker.leaseUntil;
    } else {
      state.workers = state.workers.filter((item) => item.tabId !== tabId);
    }
    writeWorkerState(state);
  });
}

async function prepareFreshChatGPTConversation(target: ActionResult, url: string): Promise<Record<string, unknown>> {
  if (typeof target.tabId !== 'number' || !Number.isFinite(target.tabId)) {
    return { skipped: true, reason: 'no_tab_id' };
  }
  const nav = await send('navigate_to_url', { tabId: target.tabId, url }).catch(() => null);
  if (nav?.url) target.url = nav.url;
  const payload = targetPayload(target);
  await waitForComposer(payload, 60_000);
  const click: { clicked: boolean; method?: string; error?: string; url?: string } = await clickNewChatIfAvailable(payload).catch((error) => ({
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

async function clickNewChatIfAvailable(
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
        if (/new chat|new conversation|新聊天|新对话/i.test(label)) return 0;
        if ((el.getAttribute('href') || '') === '/') return 1;
        if (/create/i.test(el.getAttribute('data-testid') || '') && /chat/i.test(label)) return 2;
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
          const dataTestId = el.getAttribute('data-testid') || '';
          return (
            /new chat|new conversation|新聊天|新对话/i.test(label) ||
            href === '/' ||
            (/create/i.test(dataTestId) && /chat/i.test(label))
          );
        })
        .sort((a, b) => score(a) - score(b));
      const target = candidates[0];
      if (!target) return JSON.stringify({ ok: false, error: 'new_chat_button_not_found' });
      target.setAttribute('data-bnbot-new-chat-target', 'true');
      target.scrollIntoView({ block: 'center', inline: 'center' });
      const label = [
        target.getAttribute('aria-label') || '',
        target.getAttribute('title') || '',
        target.textContent || '',
        target.innerText || '',
      ].join(' ').trim();
      return JSON.stringify({ ok: true, selector: '[data-bnbot-new-chat-target="true"]', label });
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
        const target = document.querySelector('[data-bnbot-new-chat-target="true"]');
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
        document.querySelector('[data-bnbot-new-chat-target="true"]')?.removeAttribute('data-bnbot-new-chat-target');
        return JSON.stringify({ ok: true });
      })()
    `).catch(() => undefined);
  }
}

async function getChatGPTTabStatus(tabId: number): Promise<{
  ok: boolean;
  url: string;
  title: string;
  busy: boolean;
  hasComposer: boolean;
}> {
  return evalJson({ tabId }, `
    (() => {
      const hostOk = location.hostname === 'chatgpt.com' || location.hostname.endsWith('.chatgpt.com');
      const visible = (el) => {
        const rect = el.getBoundingClientRect?.();
        return !!rect && rect.width > 0 && rect.height > 0;
      };
      const hasComposer = Array.from(document.querySelectorAll('#prompt-textarea, [role="textbox"], [contenteditable="true"], textarea'))
        .some(visible);
      return JSON.stringify({
        ok: hostOk,
        url: location.href,
        title: document.title || '',
        busy: !!document.querySelector('[data-testid="stop-button"], [aria-label*="Stop" i], [aria-label*="停止"], [aria-label*="中止"]'),
        hasComposer,
      });
    })()
  `);
}

async function seedChatGPTWorkersFromTabs(state: ChatGPTWorkerState, maxWorkers: number): Promise<void> {
  if (state.workers.length >= maxWorkers) return;
  const listed = await listReusableChatGPTTabs();
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

async function listReusableChatGPTTabs(): Promise<Array<{
  tabId?: number;
  url?: string;
  title?: string;
  windowId?: number;
  active?: boolean;
  windowFocused?: boolean;
}>> {
  const scraperTabs = await send('debug_list_tabs', { host: 'chatgpt.com', scraperOnly: true }).catch(() => null) as
    | { tabs?: Array<{ tabId?: number; url?: string; title?: string; windowId?: number; active?: boolean; windowFocused?: boolean }> }
    | null;
  if (scraperTabs?.tabs?.length) return filterChatGPTWorkerTabs(scraperTabs.tabs);

  const allTabs = await send('debug_list_tabs', { host: 'chatgpt.com', scraperOnly: false }).catch(() => null) as
    | { tabs?: Array<{ tabId?: number; url?: string; title?: string; windowId?: number; active?: boolean; windowFocused?: boolean }> }
    | null;
  return filterChatGPTWorkerTabs(allTabs?.tabs || [])
    .filter((tab) => tab.windowFocused === false)
    .filter(isLikelyChatGPTWorkerTab)
    .sort((a, b) => chatGPTWorkerTabScore(a) - chatGPTWorkerTabScore(b));
}

function filterChatGPTWorkerTabs<T extends { url?: string }>(tabs: T[]): T[] {
  return tabs.filter((tab) => {
    if (!tab.url) return false;
    try {
      const url = new URL(tab.url);
      if (url.hostname !== 'chatgpt.com' && !url.hostname.endsWith('.chatgpt.com')) return false;
      if (url.pathname.startsWith('/codex/')) return false;
      return true;
    } catch {
      return false;
    }
  });
}

function isLikelyChatGPTWorkerTab(tab: { title?: string; url?: string }): boolean {
  const title = String(tab.title || '');
  if (/^image generation request$/i.test(title)) return true;
  if (/^image generation$/i.test(title)) return true;
  // Fresh worker tabs often still sit at the empty composer before their
  // first order. Avoid arbitrary user conversations unless we created
  // them through the scraper-window path.
  try {
    const url = new URL(tab.url || '');
    return url.pathname === '/' && /chatgpt/i.test(title);
  } catch {
    return false;
  }
}

function chatGPTWorkerTabScore(tab: { title?: string; url?: string }): number {
  const title = String(tab.title || '');
  if (/^image generation request$/i.test(title)) return 0;
  if (/^image generation$/i.test(title)) return 1;
  try {
    const url = new URL(tab.url || '');
    if (url.pathname === '/') return 2;
  } catch {
    return 9;
  }
  return 9;
}

function pruneInvalidWorkers(state: ChatGPTWorkerState): boolean {
  const before = state.workers.length;
  state.workers = state.workers.filter((worker) => Number.isFinite(worker.tabId));
  return state.workers.length !== before;
}

function pruneWorkersToMax(state: ChatGPTWorkerState, maxWorkers: number, now = Date.now()): boolean {
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

async function withWorkerLock<T>(fn: () => Promise<T>): Promise<T> {
  mkdirSync(tmpdir(), { recursive: true });
  const fd = await acquireWorkerLock();
  try {
    return await fn();
  } finally {
    closeSync(fd);
    try {
      unlinkSync(WORKER_LOCK_PATH);
    } catch {
      // Already cleaned up by a stale-lock recovery path.
    }
  }
}

async function acquireWorkerLock(): Promise<number> {
  while (true) {
    try {
      const fd = openSync(WORKER_LOCK_PATH, 'wx');
      writeFileSync(fd, JSON.stringify({ pid: process.pid, createdAt: Date.now() }));
      return fd;
    } catch (error) {
      if (!isFileExistsError(error)) throw error;
      if (isWorkerLockStale()) {
        try {
          unlinkSync(WORKER_LOCK_PATH);
        } catch {
          // Another process may have won the stale-lock cleanup race.
        }
      }
      await sleep(100);
    }
  }
}

function isWorkerLockStale(): boolean {
  try {
    return Date.now() - statSync(WORKER_LOCK_PATH).mtimeMs > WORKER_LOCK_STALE_MS;
  } catch {
    return true;
  }
}

function isFileExistsError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === 'EEXIST';
}

function readWorkerState(): ChatGPTWorkerState {
  try {
    const parsed = JSON.parse(readFileSync(WORKER_STATE_PATH, 'utf8')) as ChatGPTWorkerState;
    return { workers: Array.isArray(parsed.workers) ? parsed.workers : [] };
  } catch {
    return { workers: [] };
  }
}

function writeWorkerState(state: ChatGPTWorkerState): void {
  writeFileSync(WORKER_STATE_PATH, JSON.stringify(state, null, 2));
}

function makeLeaseId(): string {
  return `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getChatGPTWorkerMax(options: ChatGPTWebImageGenerateOptions): number {
  const raw = Number.parseInt(options.maxWorkers || process.env.BNBOT_CHATGPT_WEB_WORKERS || '', 10);
  if (!Number.isFinite(raw) || raw < 1) return DEFAULT_CHATGPT_WORKERS;
  return Math.min(raw, MAX_CHATGPT_WORKERS);
}

function targetPayload(target: ActionResult): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (typeof target.tabId === 'number' && Number.isFinite(target.tabId)) payload.tabId = target.tabId;
  if (!payload.tabId) payload.targetHost = 'chatgpt.com';
  return payload;
}

async function attachFiles(
  payload: Record<string, unknown>,
  files: string[],
): Promise<{ ok: boolean; attached: number; files: string[]; method: string; error?: string }> {
  if (!files.length) return { ok: true, attached: 0, files: [], method: 'none' };

  try {
    await send('debug_set_files', { ...payload, selector: "input[type='file']", files });
    const ready = await waitForAttachments(payload, files.length, 30_000);
    return { ok: true, attached: ready.count, files, method: 'DOM.setFileInputFiles' };
  } catch (error) {
    const setFilesError = getErrorMessage(error);
    try {
      const pasted = await attachFilesViaDomPaste(payload, files);
      return {
        ok: pasted.attached >= files.length,
        attached: pasted.attached,
        files,
        method: 'ClipboardEvent(paste)',
        error: pasted.attached >= files.length ? undefined : setFilesError,
      };
    } catch (pasteError) {
      return {
        ok: false,
        attached: 0,
        files,
        method: 'DOM.setFileInputFiles, ClipboardEvent(paste)',
        error: `${setFilesError}; ${getErrorMessage(pasteError)}`,
      };
    }
  }
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
      const composers = Array.from(document.querySelectorAll('[role="textbox"], [contenteditable="true"], textarea'))
        .filter(visible);
      const composer = composers.pop();
      if (!composer) return JSON.stringify({ ok: false, attached: 0, error: 'composer_not_found' });
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
      while (Date.now() - startedAt < 10_000) {
        attached = countComposerAttachments();
        if (attached >= files.length) break;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      return JSON.stringify({ ok: attached >= files.length, attached });

      function countComposerAttachments() {
        const composerRect = composer.getBoundingClientRect?.();
        return Array.from(document.images)
          .filter((img) => {
            const rect = img.getBoundingClientRect?.();
            if (!rect || rect.width <= 16 || rect.height <= 16) return false;
            if (!composerRect) return true;
            return rect.bottom >= composerRect.top - 260 && rect.top <= composerRect.bottom + 120;
          })
          .length;
      }
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
  const startedAt = Date.now();
  let count = 0;
  while (Date.now() - startedAt < timeoutMs) {
    const state = await evalJson<{ count: number }>(payload, `
      (() => {
        const visible = (el) => {
          const rect = el.getBoundingClientRect?.();
          return !!rect && rect.width > 0 && rect.height > 0;
        };
        const composer = Array.from(document.querySelectorAll('[role="textbox"], [contenteditable="true"], textarea'))
          .filter(visible)
          .pop();
        const composerRect = composer?.getBoundingClientRect?.();
        const count = Array.from(document.images)
          .filter((img) => {
            const rect = img.getBoundingClientRect?.();
            if (!rect || rect.width <= 16 || rect.height <= 16) return false;
            if (!composerRect) return false;
            return rect.bottom >= composerRect.top - 260 && rect.top <= composerRect.bottom + 140;
          })
          .length;
        return JSON.stringify({ count });
      })()
    `).catch(() => ({ count: 0 }));
    count = state.count;
    if (count >= expectedCount) return { count };
    await sleep(1_000);
  }
  throw new Error(`Timed out waiting for ${expectedCount} ChatGPT web attachment preview(s); saw ${count}`);
}

async function waitForComposer(payload: Record<string, unknown>, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const state = await evalJson<{ ok: boolean; url?: string }>(payload, `
      (() => {
        const composer = findComposer();
        return JSON.stringify({ ok: !!composer, url: location.href });

        function findComposer() {
          const visible = (el) => {
            const rect = el.getBoundingClientRect?.();
            return !!rect && rect.width > 0 && rect.height > 0;
          };
          return Array.from(document.querySelectorAll('#prompt-textarea, [role="textbox"], [contenteditable="true"], textarea'))
            .filter(visible)
            .pop();
        }
      })()
    `).catch(() => ({ ok: false }));
    if (state.ok) return;
    await sleep(1_000);
  }
  throw new Error('ChatGPT web composer did not become ready before timeout');
}

async function injectComposerText(
  payload: Record<string, unknown>,
  text: string,
): Promise<{ ok: boolean; tag?: string; text?: string; error?: string }> {
  return evalJson<{ ok: boolean; tag?: string; text?: string; error?: string }>(payload, `
    (() => {
      const text = ${JSON.stringify(text)};
      const composer = findComposer();
      if (!composer) return JSON.stringify({ ok: false, error: 'composer_not_found' });
      composer.focus();
      document.execCommand('selectAll', false, null);
      const ok = document.execCommand('insertText', false, text);
      if ('value' in composer) composer.value = text;
      composer.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
      return JSON.stringify({ ok: ok || getComposerText(composer).includes(text.slice(0, 30)), tag: composer.tagName.toLowerCase(), text: getComposerText(composer) });

      function findComposer() {
        const visible = (el) => {
          const rect = el.getBoundingClientRect?.();
          return !!rect && rect.width > 0 && rect.height > 0;
        };
        return Array.from(document.querySelectorAll('#prompt-textarea, [role="textbox"], [contenteditable="true"], textarea'))
          .filter(visible)
          .pop();
      }
      function getComposerText(el) {
        return String(el.innerText || el.textContent || el.value || '');
      }
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
      await send('debug_click', { ...payload, selector: '[data-testid="send-button"]' });
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
        const button =
          document.querySelector('[data-testid="send-button"]') ||
          buttons.find((el) => /send|发送|提交|submit/i.test(el.getAttribute('aria-label') || el.innerText || ''));
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
      const composer = findComposer();
      const text = composer ? String(composer.innerText || composer.textContent || composer.value || '').trim() : '';
      return JSON.stringify({
        busy: !!document.querySelector('[data-testid="stop-button"], [aria-label*="Stop" i], [aria-label*="停止"], [aria-label*="中止"]'),
        composerEmpty: text.length === 0,
        url: location.href,
      });

      function findComposer() {
        const visible = (el) => {
          const rect = el.getBoundingClientRect?.();
          return !!rect && rect.width > 0 && rect.height > 0;
        };
        return Array.from(document.querySelectorAll('#prompt-textarea, [role="textbox"], [contenteditable="true"], textarea'))
          .filter(visible)
          .pop();
      }
    })()
  `).catch(() => ({ busy: false, composerEmpty: false }));
}

async function waitForNewGeneratedImage(
  payload: Record<string, unknown>,
  beforeSources: Set<string>,
  timeoutMs: number,
  expectedCount = 1,
): Promise<{ status: string; elapsed_ms: number; url?: string; image_count: number; fresh_image_count: number; timed_out: boolean }> {
  const startedAt = Date.now();
  let imageCount = 0;
  let freshCount = 0;
  let lastUrl: string | undefined;
  let lastFreshCount = 0;
  let stableFreshTicks = 0;
  while (Date.now() - startedAt < timeoutMs) {
    await sleep(DEFAULT_POLL_MS);
    const images = await listGeneratedImageSources(payload);
    imageCount = images.length;
    freshCount = images.filter((item) => !beforeSources.has(item.source)).length;
    const state = await evalJson<{ busy: boolean; url: string }>(payload, `
      (() => JSON.stringify({
        busy: !!document.querySelector('[data-testid="stop-button"], [aria-label*="Stop" i], [aria-label*="停止"], [aria-label*="中止"]'),
        url: location.href
      }))()
    `).catch(() => ({ busy: false, url: undefined as unknown as string }));
    lastUrl = state.url;
    if (freshCount >= expectedCount) {
      return {
        status: 'complete',
        elapsed_ms: Date.now() - startedAt,
        url: lastUrl,
        image_count: imageCount,
        fresh_image_count: freshCount,
        timed_out: false,
      };
    }
    if (freshCount > 0 && !state.busy) {
      stableFreshTicks = freshCount === lastFreshCount ? stableFreshTicks + 1 : 0;
      if (stableFreshTicks >= 3 && Date.now() - startedAt > 10_000) {
        return {
          status: freshCount >= expectedCount ? 'complete' : 'partial',
          elapsed_ms: Date.now() - startedAt,
          url: lastUrl,
          image_count: imageCount,
          fresh_image_count: freshCount,
          timed_out: false,
        };
      }
    } else {
      stableFreshTicks = 0;
    }
    lastFreshCount = freshCount;
  }
  return {
    status: 'timeout',
    elapsed_ms: Date.now() - startedAt,
    url: lastUrl,
    image_count: imageCount,
    fresh_image_count: freshCount,
    timed_out: true,
  };
}

async function listGeneratedImageSources(payload: Record<string, unknown>): Promise<WebImageSource[]> {
  return evalJson(payload, `
    (() => {
      const seen = new Set();
      const out = [];
      for (const img of Array.from(document.images)) {
        if (!isGeneratedImage(img)) continue;
        const source = img.currentSrc || img.src || '';
        if (seen.has(source)) continue;
        seen.add(source);
        out.push({ source });
      }
      return JSON.stringify(out);

      function isGeneratedImage(img) {
        const src = img.currentSrc || img.src || '';
        const rect = img.getBoundingClientRect?.();
        const alt = img.alt || '';
        const imagegenNode = img.closest('[class*="imagegen-image"], [class*="imagegen"]');
        const generatedAlt = /generated image|ai generated|已生成图片|生成的图片/i.test(alt);
        const userAttachment = img.closest('[class*="group/message-image"], [class*="user-chat-width"]');
        if (!src || src.startsWith('data:image/')) return false;
        if (/avatar|profile|logo/i.test(alt)) return false;
        if (!rect || rect.width < 180 || rect.height < 180) return false;
        if (userAttachment && !imagegenNode && !generatedAlt) return false;
        if (!imagegenNode && !generatedAlt) return false;
        if (!imagegenNode && !generatedAlt && (img.naturalWidth < 256 || img.naturalHeight < 256)) return false;
        return true;
      }
    })()
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
      const artifacts = [];
      const seen = new Set();
      const images = Array.from(document.images)
        .filter((img) => {
          const src = img.currentSrc || img.src || '';
          if (!isGeneratedImage(img) || before.has(src) || seen.has(src)) return false;
          seen.add(src);
          return true;
        });
      for (const img of images) {
        const source = img.currentSrc || img.src || '';
        try {
          const fetched = await fetchImage(source);
          artifacts.push({
            index: artifacts.length + 1,
            type: 'image',
            source,
            mime: fetched.mime,
            width: img.naturalWidth,
            height: img.naturalHeight,
            base64: fetched.base64,
          });
          continue;
        } catch (_) {
          // Fall through to canvas extraction.
        }
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          canvas.getContext('2d').drawImage(img, 0, 0);
          const dataUrl = canvas.toDataURL('image/png');
          artifacts.push({
            index: artifacts.length + 1,
            type: 'image',
            source,
            mime: 'image/png',
            width: img.naturalWidth,
            height: img.naturalHeight,
            base64: dataUrl.split(',')[1] || '',
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

      function isGeneratedImage(img) {
        const src = img.currentSrc || img.src || '';
        const rect = img.getBoundingClientRect?.();
        const alt = img.alt || '';
        const imagegenNode = img.closest('[class*="imagegen-image"], [class*="imagegen"]');
        const generatedAlt = /generated image|ai generated|已生成图片|生成的图片/i.test(alt);
        const userAttachment = img.closest('[class*="group/message-image"], [class*="user-chat-width"]');
        if (!src || src.startsWith('data:image/')) return false;
        if (/avatar|profile|logo/i.test(alt)) return false;
        if (!rect || rect.width < 180 || rect.height < 180) return false;
        if (userAttachment && !imagegenNode && !generatedAlt) return false;
        if (!imagegenNode && !generatedAlt) return false;
        if (!imagegenNode && !generatedAlt && (img.naturalWidth < 256 || img.naturalHeight < 256)) return false;
        return true;
      }

      async function fetchImage(source) {
        const response = await fetch(source, { credentials: 'include' });
        if (!response.ok) throw new Error('fetch_image_failed_' + response.status);
        const blob = await response.blob();
        if (!/^image\\//i.test(blob.type || '')) throw new Error('not_image_blob');
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ''));
          reader.onerror = () => reject(reader.error || new Error('file_reader_failed'));
          reader.readAsDataURL(blob);
        });
        return {
          mime: blob.type || 'image/png',
          base64: String(dataUrl).split(',')[1] || '',
        };
      }
    })()
  `);
}

async function evalJson<T>(payload: Record<string, unknown>, expression: string): Promise<T> {
  const result = await send('debug_eval', { ...payload, expression, awaitPromise: true });
  if (result.exception) throw new Error(result.exception);
  if (typeof result.result !== 'string') return result.result as T;
  return JSON.parse(result.result) as T;
}

async function send(actionType: string, payload: Record<string, unknown>): Promise<ActionResult> {
  return sendAction(actionType, payload) as Promise<ActionResult>;
}

function buildImageGeneratePrompt(
  prompt: string,
  size?: string,
  quality?: string,
  referenceCount = 0,
  count = 1,
): string {
  return [
    count > 1
      ? `Generate exactly ${count} distinct real raster image files (PNG/JPG/WebP), not SVG, HTML, canvas code, Python drawings, or placeholders.`
      : 'Generate one real raster image file (PNG/JPG/WebP), not SVG, HTML, canvas code, Python drawing, or a placeholder.',
    size ? `Target size/aspect: ${size}.` : '',
    quality ? `Rendering quality target: ${quality}.` : '',
    referenceCount > 0 ? `Use the ${referenceCount} attached reference image(s) as visual references where relevant.` : '',
    'Do not add captions, logos, or watermarks unless the user explicitly asked for them.',
    count > 1
      ? `After the ${count} images are generated, do not do extra reasoning; just leave all generated images visible in the chat.`
      : 'After the image is generated, do not do extra reasoning; just leave the generated image visible in the chat.',
    '',
    `Prompt: ${prompt}`,
  ].filter(Boolean).join('\n');
}

async function resolveImageInputs(values: string[], artifactDir?: string): Promise<string[]> {
  const out: string[] = [];
  const dir = artifactDir || join(tmpdir(), 'bnbot-chatgpt-web-artifacts');
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
  const path = join(dir, `chatgpt-web-reference-${Date.now()}-${Math.random().toString(16).slice(2)}.${ext}`);
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
  const path = join(dir, `chatgpt-web-reference-${Date.now()}-${Math.random().toString(16).slice(2)}.${ext}`);
  writeFileSync(path, bytes);
  return path;
}

function persistArtifacts(
  artifacts: ImageArtifact[],
  artifactDir?: string,
  inlineArtifacts = false,
): ImageArtifact[] {
  if (!artifacts.length) return artifacts;
  const dir = artifactDir || join(tmpdir(), 'bnbot-chatgpt-web-artifacts');
  mkdirSync(dir, { recursive: true });

  return artifacts.map((artifact, index) => {
    if (!artifact.base64 || artifact.error) return artifact;
    const bytes = Buffer.from(artifact.base64, 'base64');
    const ext = mimeToExt(artifact.mime);
    const path = join(dir, `chatgpt-web-artifact-${Date.now()}-${index + 1}.${ext}`);
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

async function readTextArgument(value: string): Promise<string> {
  if (value !== '-') return value;
  return await new Promise<string>((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data.trim()));
    process.stdin.on('error', reject);
  });
}

function parseTimeoutMs(value: string | undefined, fallbackMs: number): number {
  if (!value) return fallbackMs;
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallbackMs;
  return Math.round(parsed * 1000);
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, 10);
}

function mimeFromPath(file: string): string {
  const ext = extname(file).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  return 'image/png';
}

function mimeToExt(mime: string): string {
  if (/jpe?g/i.test(mime)) return 'jpg';
  if (/webp/i.test(mime)) return 'webp';
  if (/gif/i.test(mime)) return 'gif';
  if (/png/i.test(mime)) return 'png';
  return extname(mime).replace('.', '') || 'png';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}
