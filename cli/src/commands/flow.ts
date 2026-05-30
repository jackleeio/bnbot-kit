import { closeSync, openSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureServer } from '../cli';
import {
  evalJson,
  send,
  readTextArgument,
  parseTimeoutMs,
  sleep,
  getErrorMessage,
  printJson,
  resolveImageInputs,
  stripVideoWatermarks,
  persistVideoArtifacts,
  renumberVideoArtifacts,
  videoArtifactToApi,
  videoWatermarkRemovalSummary,
  type ActionResult,
  type VideoArtifact,
} from './gemini-web';

const DEFAULT_PORT = 18900;
const DEFAULT_FLOW_URL = 'https://labs.google/fx/tools/flow';
const DEFAULT_TIMEOUT_MS = 900_000;
const POLL_MS = 4_000;
const MAX_FLOW_WORKERS = 3;
const DEFAULT_FLOW_WORKERS = 3;
const WORKER_LEASE_GRACE_MS = 120_000;
const WORKER_LOCK_STALE_MS = 30_000;
const FLOW_WORKER_STATE_PATH = join(tmpdir(), 'bnbot-flow-workers.json');
const FLOW_WORKER_LOCK_PATH = `${FLOW_WORKER_STATE_PATH}.lock`;
const FLOW_SUBMIT_LOCK_PATH = `${FLOW_WORKER_STATE_PATH}.submit.lock`;

interface FlowGenerateOptions {
  image?: string[];
  aspect?: string;
  duration?: string;
  count?: string;
  model?: string;
  timeout?: string;
  responseFormat?: string;
  artifactDir?: string;
  inlineArtifacts?: boolean;
  tabId?: string;
  url?: string;
  project?: string;
  freshTab?: boolean;
  maxWorkers?: string;
}

type FlowVideoGenerateOptions = FlowGenerateOptions;
type FlowImageGenerateOptions = Omit<FlowGenerateOptions, 'duration'>;

interface FlowWorker {
  tabId: number;
  url?: string;
  title?: string;
  windowId?: number;
  createdAt: number;
  lastUsedAt: number;
  leases?: Array<{ leaseId: string; leaseUntil: number }>;
  leaseId?: string;
  leaseUntil?: number;
}

interface FlowWorkerState {
  workers: FlowWorker[];
}

interface FlowWorkerLease {
  target: ActionResult;
  leaseId?: string;
  reused: boolean;
  workerPool: boolean;
  maxWorkers: number;
  release: () => Promise<void>;
}

export async function flowVideoGenerateCommand(
  promptArg: string,
  options: FlowVideoGenerateOptions,
): Promise<void> {
  return flowGenerateImpl(promptArg, options, 'video');
}

export async function flowImageGenerateCommand(
  promptArg: string,
  options: FlowImageGenerateOptions,
): Promise<void> {
  return flowGenerateImpl(promptArg, options as FlowGenerateOptions, 'image');
}

async function flowGenerateImpl(
  promptArg: string,
  options: FlowGenerateOptions,
  outputType: 'image' | 'video',
): Promise<void> {
  const prompt = await readTextArgument(promptArg);
  const timeoutMs = parseTimeoutMs(options.timeout, DEFAULT_TIMEOUT_MS);
  const responseFormat = options.responseFormat || 'path';
  if (responseFormat !== 'path' && responseFormat !== 'b64_json') {
    throw new Error('--response-format must be one of: path, b64_json');
  }
  const inlineArtifacts = options.inlineArtifacts === true || responseFormat === 'b64_json';
  const aspectLabel = normalizeAspect(options.aspect);
  if (options.aspect && !aspectLabel) {
    throw new Error(`--aspect must be one of: 16:9, 9:16 (got ${options.aspect})`);
  }
  const duration = outputType === 'video' ? normalizeDuration(options.duration) : undefined;
  const count = normalizeCount(options.count);
  const modelLabel = normalizeModel(options.model);
  if (options.model && !modelLabel) {
    throw new Error(`--model must be one of: omni-flash, veo-3.1-lite, veo-3.1-fast, veo-3.1-quality (got ${options.model})`);
  }

  const startedAt = Date.now();
  const flowJobId = makeFlowJobId();
  await ensureServer(DEFAULT_PORT);

  const worker = await openFlowTarget(options, timeoutMs);
  try {
    const target = worker.target;
    const basePayload = targetPayload(target);
    const referenceImages = await resolveImageInputs(options.image ?? [], options.artifactDir);
    const useIngredients = referenceImages.length > 0;
    const submission = await withFlowSubmitLock(async () => {
      const projectReset = { skipped: true, reason: options.project ? 'project_explicit' : worker.reused ? 'shared_project_reuse' : 'fresh_worker' };
      const projectInfo = await ensureProject(basePayload, options.project);
      // Wait for Slate composer + panel trigger to fully mount before poking the DOM.
      await waitForFlowProjectReady(basePayload, 20_000);

      await waitForExistingFlowMediaSettled(basePayload, outputType, 8_000);
      const beforeSources = new Set(
        outputType === 'video'
          ? (await listFlowVideoSources(basePayload)).map((it) => it.source)
          : (await listFlowImageSources(basePayload)).map((it) => it.source),
      );

      const panel = await configurePanel(basePayload, {
        outputType,
        ingredients: useIngredients,
        aspect: aspectLabel ?? undefined,
        duration,
        count,
        model: modelLabel ?? undefined,
      });

      const attachments = await attachIngredients(basePayload, referenceImages);

      const injected = await injectSlatePrompt(basePayload, prompt);
      if (!injected.ok) throw new Error(injected.error || 'Could not write prompt into Slate composer');

      await sleep(500);
      const submit = await clickFlowCreate(basePayload, prompt);
      const promptSources = outputType === 'image'
        ? await captureFlowPromptImageSources(basePayload, prompt, flowJobId, count || 1, beforeSources, 15_000)
        : [];
      return { projectReset, projectInfo, beforeSources, panel, attachments, submit, promptSources };
    });
    const { projectReset, projectInfo, beforeSources, panel, attachments, submit, promptSources } = submission;

  if (outputType === 'video') {
    const wait = await waitForFlowVideo(basePayload, beforeSources, timeoutMs);
    const rawArtifacts = await extractFlowVideos(basePayload, beforeSources);
    const persisted = renumberVideoArtifacts(persistVideoArtifacts(rawArtifacts, options.artifactDir, inlineArtifacts));
    const artifacts = await stripVideoWatermarks(persisted, inlineArtifacts);
    const videos = artifacts.map((a) => videoArtifactToApi(a, responseFormat));
    printJson({
      success: videos.length > 0,
      action: 'video-generate',
      provider: 'flow',
      app: 'Google Labs Flow',
      project: projectInfo,
      url: wait.url || target.url || null,
      prompt,
      output: 'video',
      ingredients: useIngredients,
      aspect: aspectLabel || null,
      duration_s: duration,
      count,
      model: modelLabel || null,
      reference_images: referenceImages.length,
      response_format: responseFormat,
      duration_ms: Date.now() - startedAt,
      worker: {
        tab_id: target.tabId || null,
        reused: worker.reused,
        pool: worker.workerPool,
        max_workers: worker.maxWorkers,
      },
      project_reset: projectReset,
      panel,
      attachments,
      submit,
      wait,
      watermark_removal: videoWatermarkRemovalSummary(artifacts),
      videos,
      artifacts,
      error: videos.length > 0 ? undefined : wait.error || 'No video artifact was produced by Flow.',
    });
  } else {
    const expectedImages = count || 1;
    const wait = await waitForFlowImage(basePayload, beforeSources, timeoutMs, prompt, expectedImages, promptSources, flowJobId);
    const rawArtifacts = await extractFlowImages(basePayload, beforeSources, prompt, expectedImages, promptSources, flowJobId);
    const persisted = renumberFlowImageArtifacts(persistFlowImageArtifacts(rawArtifacts, options.artifactDir, inlineArtifacts));
    const usableArtifacts = persisted.filter((a) => !a.error && (a.path || a.base64 || a.bytes));
    const images = usableArtifacts.map((a) => flowImageArtifactToApi(a, responseFormat));
    printJson({
      success: images.length > 0,
      action: 'image-generate',
      provider: 'flow',
      app: 'Google Labs Flow',
      project: projectInfo,
      url: wait.url || target.url || null,
      prompt,
      output: 'image',
      ingredients: useIngredients,
      aspect: aspectLabel || null,
      count,
      model: modelLabel || null,
      reference_images: referenceImages.length,
      response_format: responseFormat,
      duration_ms: Date.now() - startedAt,
      worker: {
        tab_id: target.tabId || null,
        reused: worker.reused,
        pool: worker.workerPool,
        max_workers: worker.maxWorkers,
      },
      project_reset: projectReset,
      panel,
      attachments,
      submit,
      flow_job_id: flowJobId,
      prompt_sources: promptSources,
      wait,
      images,
      artifacts: persisted,
      error: images.length > 0 ? undefined : wait.error || 'No downloadable image artifact was produced by Flow.',
    });
  }
  } finally {
    await worker.release();
  }
}

function targetPayload(target: ActionResult): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (typeof target.tabId === 'number' && Number.isFinite(target.tabId)) payload.tabId = target.tabId;
  if (!payload.tabId) payload.targetHost = 'labs.google';
  return payload;
}

async function openFlowTarget(
  options: FlowGenerateOptions,
  timeoutMs: number,
): Promise<FlowWorkerLease> {
  if (options.tabId) {
    return {
      target: { tabId: Number.parseInt(options.tabId, 10), url: options.url || DEFAULT_FLOW_URL },
      reused: true,
      workerPool: false,
      maxWorkers: getFlowWorkerMax(options),
      release: async () => undefined,
    };
  }
  if (options.freshTab) {
    return {
      target: await send('navigate_to_url', { url: options.url || DEFAULT_FLOW_URL, spawn: true }),
      reused: false,
      workerPool: false,
      maxWorkers: getFlowWorkerMax(options),
      release: async () => undefined,
    };
  }
  return acquireFlowWorker(options, timeoutMs);
}

async function acquireFlowWorker(
  options: FlowGenerateOptions,
  timeoutMs: number,
): Promise<FlowWorkerLease> {
  const maxWorkers = getFlowWorkerMax(options);
  const url = options.url || DEFAULT_FLOW_URL;
  const deadline = Date.now() + Math.max(timeoutMs, 60_000);
  let lastReason = 'all workers are busy';

  while (Date.now() < deadline) {
    const lease = await withFlowWorkerLock(async () => {
      const state = readFlowWorkerState();
      await seedFlowWorkersFromTabs(state, 1);
      const now = Date.now();
      let changed = pruneInvalidFlowWorkers(state);
      changed = pruneFlowWorkersToMax(state, 1, now) || changed;
      const freeWorkers = [...state.workers].sort((a, b) => a.lastUsedAt - b.lastUsedAt);

      for (const worker of freeWorkers) {
        const activeLeases = getActiveFlowWorkerLeases(worker, now);
        if (activeLeases.length !== (worker.leases || []).length || worker.leaseId || worker.leaseUntil) changed = true;
        worker.leases = activeLeases;
        delete worker.leaseId;
        delete worker.leaseUntil;
        if (activeLeases.length >= maxWorkers) {
          lastReason = `flow project tab ${worker.tabId} already has ${activeLeases.length} in-flight jobs`;
          changed = true;
          continue;
        }
        const status = await getFlowTabStatus(worker.tabId).catch(() => null);
        if (!status?.ok) {
          state.workers = state.workers.filter((item) => item.tabId !== worker.tabId);
          changed = true;
          continue;
        }
        worker.url = status.url;
        worker.title = status.title;
        const leaseId = makeLeaseId();
        worker.leases.push({
          leaseId,
          leaseUntil: Date.now() + timeoutMs + WORKER_LEASE_GRACE_MS,
        });
        worker.lastUsedAt = Date.now();
        writeFlowWorkerState(state);
        return makeFlowWorkerLease(worker.tabId, worker.url || url, leaseId, true, maxWorkers);
      }

      if (state.workers.length < 1) {
        const spawned = await send('navigate_to_url', { url, spawn: true });
        if (typeof spawned.tabId !== 'number' || !Number.isFinite(spawned.tabId)) {
          throw new Error('Flow worker spawn did not return a tabId');
        }
        const leaseId = makeLeaseId();
        state.workers.push({
          tabId: spawned.tabId,
          url: spawned.url || url,
          createdAt: Date.now(),
          lastUsedAt: Date.now(),
          leases: [{
            leaseId,
            leaseUntil: Date.now() + timeoutMs + WORKER_LEASE_GRACE_MS,
          }],
        });
        writeFlowWorkerState(state);
        return makeFlowWorkerLease(spawned.tabId, spawned.url || url, leaseId, false, maxWorkers);
      }

      if (changed) writeFlowWorkerState(state);
      return null;
    });

    if (lease) return lease;
    await sleep(1_000);
  }
  throw new Error(`Timed out waiting for a free Flow worker tab (${lastReason}; max ${maxWorkers})`);
}

function makeFlowWorkerLease(
  tabId: number,
  url: string,
  leaseId: string,
  reused: boolean,
  maxWorkers: number,
): FlowWorkerLease {
  return {
    target: { tabId, url },
    leaseId,
    reused,
    workerPool: true,
    maxWorkers,
    release: () => releaseFlowWorker(tabId, leaseId),
  };
}

async function releaseFlowWorker(tabId: number, leaseId: string): Promise<void> {
  await withFlowWorkerLock(async () => {
    const state = readFlowWorkerState();
    const worker = state.workers.find((item) => item.tabId === tabId);
    if (!worker) return;
    const before = worker.leases?.length || (worker.leaseId ? 1 : 0);
    worker.leases = getActiveFlowWorkerLeases(worker).filter((lease) => lease.leaseId !== leaseId);
    delete worker.leaseId;
    delete worker.leaseUntil;
    if (before === worker.leases.length) return;
    const status = await getFlowTabStatus(tabId).catch(() => null);
    if (status?.ok) {
      worker.url = status.url;
      worker.title = status.title;
      worker.lastUsedAt = Date.now();
    } else {
      state.workers = state.workers.filter((item) => item.tabId !== tabId);
    }
    writeFlowWorkerState(state);
  });
}

async function resetFlowWorkerToLanding(target: ActionResult, url: string): Promise<Record<string, unknown>> {
  if (typeof target.tabId !== 'number' || !Number.isFinite(target.tabId)) {
    return { skipped: true, reason: 'no_tab_id' };
  }
  const nav = await send('navigate_to_url', { tabId: target.tabId, url }).catch((error) => ({
    error: getErrorMessage(error),
  }));
  if ('url' in nav && nav.url) target.url = nav.url;
  return {
    navigated_url: 'url' in nav ? nav.url || null : null,
    error: 'error' in nav ? nav.error : null,
  };
}

async function getFlowTabStatus(tabId: number): Promise<{
  ok: boolean;
  url: string;
  title: string;
  busy: boolean;
}> {
  return evalJson({ tabId }, `
    (() => {
      const hostOk = location.hostname === 'labs.google' || location.hostname.endsWith('.labs.google');
      return JSON.stringify({
        ok: hostOk && location.pathname.includes('/fx/tools/flow'),
        url: location.href,
        title: document.title || '',
        busy: /generating|queued|creating/i.test(document.body?.innerText || ''),
      });
    })()
  `);
}

async function seedFlowWorkersFromTabs(state: FlowWorkerState, maxWorkers: number): Promise<void> {
  if (state.workers.length >= maxWorkers) return;
  const listed = await listReusableFlowTabs();
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

async function listReusableFlowTabs(): Promise<Array<{
  tabId?: number;
  url?: string;
  title?: string;
  windowId?: number;
  windowFocused?: boolean;
}>> {
  const scraperTabs = await send('debug_list_tabs', { host: 'labs.google', scraperOnly: true }).catch(() => null) as
    | { tabs?: Array<{ tabId?: number; url?: string; title?: string; windowId?: number; windowFocused?: boolean }> }
    | null;
  if (scraperTabs?.tabs?.length) return filterFlowWorkerTabs(scraperTabs.tabs);

  const allTabs = await send('debug_list_tabs', { host: 'labs.google', scraperOnly: false }).catch(() => null) as
    | { tabs?: Array<{ tabId?: number; url?: string; title?: string; windowId?: number; windowFocused?: boolean }> }
    | null;
  return filterFlowWorkerTabs(allTabs?.tabs || []).filter((tab) => tab.windowFocused === false);
}

function filterFlowWorkerTabs<T extends { url?: string }>(tabs: T[]): T[] {
  return tabs.filter((tab) => {
    if (!tab.url) return false;
    try {
      const url = new URL(tab.url);
      return (url.hostname === 'labs.google' || url.hostname.endsWith('.labs.google')) && url.pathname.includes('/fx/tools/flow');
    } catch {
      return false;
    }
  });
}

function pruneInvalidFlowWorkers(state: FlowWorkerState): boolean {
  const before = state.workers.length;
  state.workers = state.workers.filter((worker) => Number.isFinite(worker.tabId));
  return state.workers.length !== before;
}

function pruneFlowWorkersToMax(state: FlowWorkerState, maxWorkers: number, now = Date.now()): boolean {
  if (state.workers.length <= maxWorkers) return false;
  const before = state.workers.length;
  state.workers = [...state.workers]
    .sort((a, b) => {
      const aLeased = getActiveFlowWorkerLeases(a, now).length;
      const bLeased = getActiveFlowWorkerLeases(b, now).length;
      if (aLeased !== bLeased) return bLeased - aLeased;
      return (b.lastUsedAt || 0) - (a.lastUsedAt || 0);
    })
    .slice(0, maxWorkers);
  return state.workers.length !== before;
}

function getActiveFlowWorkerLeases(worker: FlowWorker, now = Date.now()): Array<{ leaseId: string; leaseUntil: number }> {
  const leases = Array.isArray(worker.leases) ? [...worker.leases] : [];
  if (worker.leaseId && worker.leaseUntil) leases.push({ leaseId: worker.leaseId, leaseUntil: worker.leaseUntil });
  const seen = new Set<string>();
  return leases.filter((lease) => {
    if (!lease.leaseId || !lease.leaseUntil || lease.leaseUntil <= now || seen.has(lease.leaseId)) return false;
    seen.add(lease.leaseId);
    return true;
  });
}

async function withFlowWorkerLock<T>(fn: () => Promise<T>): Promise<T> {
  const fd = await acquireFlowWorkerLock();
  try {
    return await fn();
  } finally {
    closeSync(fd);
    try {
      unlinkSync(FLOW_WORKER_LOCK_PATH);
    } catch {
      // Already cleaned up by a stale-lock recovery path.
    }
  }
}

async function withFlowSubmitLock<T>(fn: () => Promise<T>): Promise<T> {
  const fd = await acquireFlowLockFile(FLOW_SUBMIT_LOCK_PATH);
  try {
    return await fn();
  } finally {
    closeSync(fd);
    try {
      unlinkSync(FLOW_SUBMIT_LOCK_PATH);
    } catch {
      // Already cleaned up by a stale-lock recovery path.
    }
  }
}

async function acquireFlowWorkerLock(): Promise<number> {
  return acquireFlowLockFile(FLOW_WORKER_LOCK_PATH);
}

async function acquireFlowLockFile(path: string): Promise<number> {
  while (true) {
    try {
      const fd = openSync(path, 'wx');
      writeFileSync(fd, JSON.stringify({ pid: process.pid, createdAt: Date.now() }));
      return fd;
    } catch (error) {
      if (!isFileExistsError(error)) throw error;
      if (isFlowLockStale(path)) {
        try {
          unlinkSync(path);
        } catch {
          // Another process may have won the stale-lock cleanup race.
        }
      }
      await sleep(100);
    }
  }
}

function isFlowLockStale(path: string): boolean {
  try {
    return Date.now() - statSync(path).mtimeMs > WORKER_LOCK_STALE_MS;
  } catch {
    return true;
  }
}

function isFileExistsError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === 'EEXIST';
}

function readFlowWorkerState(): FlowWorkerState {
  try {
    const parsed = JSON.parse(readFileSync(FLOW_WORKER_STATE_PATH, 'utf8')) as FlowWorkerState;
    return { workers: Array.isArray(parsed.workers) ? parsed.workers : [] };
  } catch {
    return { workers: [] };
  }
}

function writeFlowWorkerState(state: FlowWorkerState): void {
  writeFileSync(FLOW_WORKER_STATE_PATH, JSON.stringify(state, null, 2));
}

function makeLeaseId(): string {
  return `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function makeFlowJobId(): string {
  return `flow-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getFlowWorkerMax(options: FlowGenerateOptions): number {
  const raw = Number.parseInt(options.maxWorkers || process.env.BNBOT_FLOW_WORKERS || '', 10);
  if (!Number.isFinite(raw) || raw < 1) return DEFAULT_FLOW_WORKERS;
  return Math.min(raw, MAX_FLOW_WORKERS);
}

async function waitForFlowProjectReady(payload: Record<string, unknown>, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const state = await evalJson<{ ok: boolean }>(payload, `
      (() => {
        const composer = document.querySelector('[contenteditable=true][data-slate-editor=true]');
        const trigger = Array.from(document.querySelectorAll('button[aria-haspopup="menu"]'))
          .find(el => /(Nano Banana|Omni|Veo|Video|Image)/i.test(el.innerText || '') && /(crop_|x[1-4]|\\d+s)/.test(el.innerText || ''));
        return JSON.stringify({ ok: !!composer && !!trigger });
      })()
    `).catch(() => ({ ok: false }));
    if (state.ok) return;
    await sleep(500);
  }
  throw new Error('Flow project did not finish mounting (Slate composer + settings panel trigger) before timeout');
}

async function waitForExistingFlowMediaSettled(
  payload: Record<string, unknown>,
  outputType: 'image' | 'video',
  timeoutMs: number,
): Promise<void> {
  const startedAt = Date.now();
  let lastKey = '';
  let stableSince = 0;
  while (Date.now() - startedAt < timeoutMs) {
    const sources = outputType === 'video'
      ? await listFlowVideoSources(payload).catch(() => [] as { source: string }[])
      : await listFlowImageSources(payload).catch(() => [] as { source: string }[]);
    const key = sources.map((item) => item.source).sort().join('\n');
    if (key === lastKey) {
      if (Date.now() - stableSince >= 1_500) return;
    } else {
      lastKey = key;
      stableSince = Date.now();
    }
    await sleep(500);
  }
}

async function ensureProject(payload: Record<string, unknown>, projectId?: string): Promise<{ url: string; created: boolean }> {
  if (projectId) {
    const targetUrl = `https://labs.google/fx/tools/flow/project/${projectId}`;
    await evalJson(payload, `
      (() => {
        location.href = ${JSON.stringify(targetUrl)};
        return JSON.stringify({ ok: true });
      })()
    `).catch(() => undefined);
    const startedAt = Date.now();
    while (Date.now() - startedAt < 30_000) {
      await sleep(750);
      const probe = await evalJson<{ url: string }>(payload, `(() => JSON.stringify({ url: location.href }))()`).catch(() => ({ url: '' }));
      if (probe.url.includes(`/flow/project/${projectId}`)) return { url: probe.url, created: false };
    }
    return { url: targetUrl, created: false };
  }
  // Already inside a /project/... page? then re-use it.
  const here = await evalJson<{ url: string }>(payload, `(() => JSON.stringify({ url: location.href }))()`).catch(() => ({ url: '' }));
  if (/\/flow\/project\//.test(here.url)) {
    return { url: here.url, created: false };
  }
  // Otherwise click "New project" on the Flow landing page. Spawned
  // tabs in a minimized scraper window can take 5-10s for React to
  // mount the landing chrome — poll until the button appears.
  const buttonAppearedAt = Date.now();
  let clicked: { ok: boolean } = { ok: false };
  while (Date.now() - buttonAppearedAt < 20_000) {
    clicked = await evalJson<{ ok: boolean }>(payload, `
      (() => {
        const visible = (el) => { const r = el.getBoundingClientRect && el.getBoundingClientRect(); return !!r && r.width > 0 && r.height > 0; };
        const btn = Array.from(document.querySelectorAll('button, [role=button], a')).filter(visible).find(el => /new project/i.test(el.innerText || ''));
        if (!btn) return JSON.stringify({ ok: false });
        btn.click();
        return JSON.stringify({ ok: true });
      })()
    `).catch(() => ({ ok: false }));
    if (clicked.ok) break;
    await sleep(750);
  }
  if (!clicked.ok) throw new Error('Could not find Flow "New project" button after 20s — landing chrome may not have mounted; pass --project <id> to reuse an existing project.');
  // Wait until URL contains /project/
  const startedAt = Date.now();
  while (Date.now() - startedAt < 15_000) {
    await sleep(750);
    const probe = await evalJson<{ url: string }>(payload, `(() => JSON.stringify({ url: location.href }))()`).catch(() => ({ url: '' }));
    if (/\/flow\/project\//.test(probe.url)) return { url: probe.url, created: true };
  }
  throw new Error('Timed out waiting for Flow project page to load.');
}

interface PanelConfig {
  outputType: 'image' | 'video';
  ingredients: boolean;
  aspect?: string;
  duration?: number;
  count?: number;
  model?: string;
}

async function configurePanel(payload: Record<string, unknown>, opts: PanelConfig): Promise<{ ok: boolean; error?: string }> {
  const aspectRegex = opts.aspect ? `/^crop_(9_16|16_9)\\s*${escapeForRegex(opts.aspect)}$/i` : 'null';
  const durationRegex = opts.duration ? `/^${opts.duration}s$/i` : 'null';
  const countRegex = opts.count ? (opts.count === 1 ? '/^1x$/' : `/^x${opts.count}$/`) : 'null';
  return evalJson<{ ok: boolean; error?: string }>(payload, `
    (async () => {
      const visible = (el) => { const r = el.getBoundingClientRect && el.getBoundingClientRect(); return !!r && r.width > 0 && r.height > 0; };
      const fire = (el) => {
        const r = el.getBoundingClientRect();
        const o = { bubbles: true, cancelable: true, clientX: r.x+r.width/2, clientY: r.y+r.height/2, pointerType: 'mouse' };
        el.dispatchEvent(new PointerEvent('pointerdown', o));
        el.dispatchEvent(new MouseEvent('mousedown', o));
        el.dispatchEvent(new PointerEvent('pointerup', o));
        el.dispatchEvent(new MouseEvent('mouseup', o));
        el.dispatchEvent(new MouseEvent('click', o));
      };
      const wait = (ms) => new Promise(r => setTimeout(r, ms));

      // Find/open the settings panel trigger (button with aria-haspopup="menu" near composer).
      const panelTrigger = Array.from(document.querySelectorAll('button[aria-haspopup="menu"]')).filter(visible)
        .find(el => /(Nano Banana|Omni|Veo|Video|Image)/i.test(el.innerText || '') && /(crop_|x[1-4]|\\d+s)/.test(el.innerText || ''));
      if (!panelTrigger) return JSON.stringify({ ok: false, error: 'panel_trigger_not_found' });
      if (panelTrigger.getAttribute('aria-expanded') !== 'true') {
        fire(panelTrigger);
        await wait(800);
      }
      // The chip trigger button itself has [data-state=open], so we need the
      // role=menu container — it's a DIV that contains the actual mode/aspect buttons.
      const panel = Array.from(document.querySelectorAll('[data-state=open][role=menu]'))
        .find(el => /Image|Video|crop_/i.test(el.innerText || ''));
      if (!panel) return JSON.stringify({ ok: false, error: 'panel_did_not_open' });

      const findButton = (regex) => Array.from(panel.querySelectorAll('button, [role=button]'))
        .filter(visible).find(el => regex.test((el.innerText || '').trim()));

      const isOn = (el) => {
        if (!el) return false;
        // Flow toggles use class .ldb… 'selected' style; check several signals.
        const cs = window.getComputedStyle(el);
        if (el.getAttribute('aria-pressed') === 'true') return true;
        if (el.getAttribute('data-state') === 'on') return true;
        // Selected buttons have a brighter background — heuristic via class containing 'famhRe'/'iIhbxv' is fragile;
        // fall back to visually inspecting backgroundColor lightness.
        const bg = cs.backgroundColor || '';
        const m = /rgba?\\(([^)]+)\\)/.exec(bg);
        if (m) {
          const parts = m[1].split(',').map(s => parseFloat(s.trim()));
          if (parts.length >= 3) {
            const lum = (parts[0]*0.299 + parts[1]*0.587 + parts[2]*0.114);
            if (lum > 200) return true; // bright = selected (Image/Video selected chip is near-white)
          }
        }
        return false;
      };

      // 1) Set main output (Image | Video)
      const outputRegex = ${JSON.stringify(opts.outputType)} === 'video' ? /^play_circle\\s*Video$/i : /^image\\s*Image$/i;
      const outputBtn = findButton(outputRegex);
      if (outputBtn && !isOn(outputBtn)) { fire(outputBtn); await wait(400); }

      // 2) Toggle Ingredients on/off as needed
      const ingBtn = findButton(/^chrome_extension\\s*Ingredients$/i);
      if (ingBtn) {
        const currentlyOn = isOn(ingBtn);
        const want = ${opts.ingredients ? 'true' : 'false'};
        if (currentlyOn !== want) { fire(ingBtn); await wait(300); }
      }

      // 3) Aspect
      const aspectRe = ${aspectRegex};
      if (aspectRe) {
        const b = findButton(aspectRe);
        if (b && !isOn(b)) { fire(b); await wait(300); }
      }

      // 4) Duration (Video only)
      const durRe = ${durationRegex};
      if (durRe) {
        const b = findButton(durRe);
        if (b && !isOn(b)) { fire(b); await wait(300); }
      }

      // 5) Count
      const countRe = ${countRegex};
      if (countRe) {
        const b = findButton(countRe);
        if (b && !isOn(b)) { fire(b); await wait(300); }
      }

      // 6) Model — open the inner dropdown ("Omni Flash" / "Veo 3.1 - …") and pick.
      const modelLabel = ${JSON.stringify(opts.model || '')};
      if (modelLabel) {
        const modelTrigger = Array.from(panel.querySelectorAll('button[aria-haspopup="menu"]')).filter(visible)[0]
          || Array.from(panel.querySelectorAll('button')).filter(visible).find(el => /arrow_drop_down/.test(el.innerText || ''));
        if (modelTrigger) {
          fire(modelTrigger);
          await wait(500);
          const modelItem = Array.from(document.querySelectorAll('[data-state=open][role=menu] [role=menuitem], [role=menuitemradio]'))
            .filter(visible)
            .find(el => (el.innerText || '').trim() === modelLabel || (el.getAttribute('aria-label') || '') === modelLabel);
          if (modelItem) { fire(modelItem); await wait(300); }
        }
      }

      // Close panel
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
      await wait(300);
      return JSON.stringify({ ok: true });
    })()
  `).catch((error) => ({ ok: false, error: getErrorMessage(error) }));
}

async function attachIngredients(
  payload: Record<string, unknown>,
  files: string[],
): Promise<{ ok: boolean; attached: number; files: string[]; method?: string; error?: string; direct?: unknown; chooser?: unknown }> {
  if (!files.length) return { ok: true, attached: 0, files: [] };
  // Flow exposes a hidden <input type=file multiple accept="image/*"> globally.
  // CDP DOM.setFileInputFiles writes paths into that input which triggers Flow's
  // upload pipeline — uploaded media lands in the project Library and is auto-
  // referenced as an Ingredient when in Ingredients mode.
  let direct: unknown = null;
  try {
    direct = await send('debug_set_files', { ...payload, selector: 'input[type=file]', files });
  } catch (error) {
    direct = { error: getErrorMessage(error) };
  }
  let count = await waitForFlowIngredientUploads(payload, files.length, 15_000);
  if (count >= files.length) return { ok: true, attached: count, files, method: 'DOM.setFileInputFiles', direct };

  const marked = await prepareFlowUploadMediaTrigger(payload);
  if (!marked.ok) {
    return {
      ok: false,
      attached: count,
      files,
      method: 'DOM.setFileInputFiles',
      direct,
      error: marked.error || 'flow_upload_media_trigger_not_found',
    };
  }

  let chooser: unknown = null;
  try {
    chooser = await send('debug_set_files_via_chooser', {
      ...payload,
      selector: '[data-bnbot-flow-upload-media="1"]',
      files,
      timeoutMs: 15_000,
    });
  } catch (error) {
    return {
      ok: false,
      attached: count,
      files,
      method: 'chooser',
      direct,
      chooser: { error: getErrorMessage(error) },
      error: getErrorMessage(error),
    };
  }

  count = await waitForFlowIngredientUploads(payload, files.length, 30_000);
  const chooserCount =
    typeof chooser === 'object' && chooser !== null && 'postSetFilesCount' in chooser
      ? Number((chooser as { postSetFilesCount?: unknown }).postSetFilesCount)
      : 0;
  const attached = Math.max(count, Number.isFinite(chooserCount) ? chooserCount : 0);
  return {
    ok: attached >= files.length,
    attached,
    files,
    method: 'chooser',
    direct,
    chooser,
    error: attached >= files.length ? undefined : 'flow_ingredient_upload_not_detected',
  };
}

async function waitForFlowIngredientUploads(
  payload: Record<string, unknown>,
  expected: number,
  timeoutMs: number,
): Promise<number> {
  const startedAt = Date.now();
  let count = 0;
  while (Date.now() - startedAt < timeoutMs) {
    await sleep(1000);
    const tiles = await evalJson<{ count: number }>(payload, `
      (() => {
        const visible = (el) => {
          const r = el.getBoundingClientRect && el.getBoundingClientRect();
          return !!r && r.width > 0 && r.height > 0;
        };
        const images = Array.from(document.querySelectorAll('img')).filter(visible);
        const uploadLike = images.filter((img) => {
          const alt = String(img.getAttribute('alt') || '').toLowerCase();
          const src = String(img.currentSrc || img.src || '');
          if (/profile|generated/.test(alt)) return false;
          return /uploaded|upload|ingredient|reference/.test(alt) || /storage\\.googleapis\\.com/.test(src);
        }).length;
        const fileInputs = Array.from(document.querySelectorAll('input[type=file]'))
          .map((input) => input.files ? input.files.length : 0);
        const inputFiles = Math.max(0, ...fileInputs);
        return JSON.stringify({
          count: Math.max(uploadLike, inputFiles),
          inputFiles,
        });
      })()
    `).catch(() => ({ count: 0 }));
    count = tiles.count;
    if (count >= expected) break;
  }
  return count;
}

async function prepareFlowUploadMediaTrigger(payload: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
  const openedPanel = await openFlowUploadsPanel(payload);
  if (!openedPanel.ok) return openedPanel;

  const addMedia = await markFlowAddMediaTrigger(payload);
  if (!addMedia.ok) return addMedia;

  await send('debug_click', { ...payload, selector: '[data-bnbot-flow-add-media="1"]' }).catch(() => undefined);
  await sleep(500);
  return markFlowUploadMediaTrigger(payload);
}

async function openFlowUploadsPanel(payload: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
  return evalJson<{ ok: boolean; error?: string }>(payload, `
    (() => {
      const visible = (el) => {
        const r = el.getBoundingClientRect && el.getBoundingClientRect();
        return !!r && r.width > 0 && r.height > 0;
      };
      const button = Array.from(document.querySelectorAll('button, [role=button]')).filter(visible)
        .find((el) => /drive_folder_upload\\s*View uploaded media/i.test(el.innerText || el.getAttribute('aria-label') || ''));
      if (!button) return JSON.stringify({ ok: false, error: 'uploads_panel_button_not_found' });
      button.click();
      return JSON.stringify({ ok: true });
    })()
  `).catch((error) => ({ ok: false, error: getErrorMessage(error) }));
}

async function markFlowAddMediaTrigger(payload: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
  return evalJson<{ ok: boolean; error?: string }>(payload, `
    (() => {
      const visible = (el) => {
        const r = el.getBoundingClientRect && el.getBoundingClientRect();
        return !!r && r.width > 0 && r.height > 0;
      };
      const buttons = Array.from(document.querySelectorAll('button, [role=button]')).filter(visible);
      const button = buttons.find((el) => /(^|\\n|\\s)add\\s*media(\\s|$)/i.test(el.innerText || el.getAttribute('aria-label') || ''));
      if (!button) return JSON.stringify({ ok: false, error: 'add_media_button_not_found' });
      button.setAttribute('data-bnbot-flow-add-media', '1');
      return JSON.stringify({ ok: true });
    })()
  `).catch((error) => ({ ok: false, error: getErrorMessage(error) }));
}

async function markFlowUploadMediaTrigger(payload: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
  return evalJson<{ ok: boolean; error?: string }>(payload, `
    (() => {
      const visible = (el) => {
        const r = el.getBoundingClientRect && el.getBoundingClientRect();
        return !!r && r.width > 0 && r.height > 0;
      };
      const button = Array.from(document.querySelectorAll('button, [role=button], [role=menuitem]')).filter(visible)
        .find((el) => /^upload\\s*Upload media$/i.test(String(el.innerText || el.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').trim()));
      if (!button) return JSON.stringify({ ok: false, error: 'upload_media_menuitem_not_found' });
      button.setAttribute('data-bnbot-flow-upload-media', '1');
      return JSON.stringify({ ok: true });
    })()
  `).catch((error) => ({ ok: false, error: getErrorMessage(error) }));
}

async function injectSlatePrompt(payload: Record<string, unknown>, text: string): Promise<{ ok: boolean; attempts: number; error?: string }> {
  let lastInsertErr: unknown = null;
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    // First, select all existing content via a focus + selectAll inside the page,
    // so the trusted Input.insertText call overwrites instead of appending.
    await evalJson(payload, `
      (() => {
        const composer = document.querySelector('[contenteditable=true][data-slate-editor=true]') ||
                         document.querySelector('[contenteditable=true]');
        if (composer) {
          composer.focus();
          document.execCommand('selectAll', false, null);
        }
        return JSON.stringify({ ok: true });
      })()
    `).catch(() => undefined);

    // Use the extension's trusted CDP Input.insertText so Slate's internal state actually updates.
    try {
      await send('debug_insert_text', {
        ...payload,
        selector: '[contenteditable=true][data-slate-editor=true]',
        text,
      });
    } catch (error) {
      lastInsertErr = error;
      await sleep(600);
      continue;
    }

    await sleep(400);
    const probe = await evalJson<{ createEnabled: boolean; placeholderGone: boolean }>(payload, `
      (() => {
        const composer = document.querySelector('[contenteditable=true][data-slate-editor=true]');
        const placeholderGone = composer ? !composer.querySelector('[data-slate-placeholder="true"]') : false;
        const createBtn = Array.from(document.querySelectorAll('button')).find(el => /arrow_forward\\s*Create/.test((el.innerText||'').trim()));
        const createEnabled = createBtn ? createBtn.getAttribute('aria-disabled') !== 'true' : false;
        return JSON.stringify({ createEnabled, placeholderGone });
      })()
    `).catch(() => ({ createEnabled: false, placeholderGone: false }));
    if (probe.createEnabled && probe.placeholderGone) return { ok: true, attempts: attempt };
    await sleep(700);
  }
  const tail = lastInsertErr ? ` — last debug_insert_text error: ${getErrorMessage(lastInsertErr)}` : '';
  return { ok: false, attempts: 6, error: `slate_composer_did_not_accept_text${tail}` };
}

async function clickFlowCreate(payload: Record<string, unknown>, prompt: string): Promise<{ ok: boolean; method: string; attempts: number; error?: string }> {
  // Wait until the Create button leaves aria-disabled=true (Slate state populated),
  // tag it with a data attribute so we can target it precisely, then send a TRUSTED
  // click via CDP through the extension's debug_click action — React/Radix don't
  // reliably fire onClick for synthetic dispatchEvent sequences.
  const startedAt = Date.now();
  let lastDisabled = 'true';
  let lastState = 'unknown';
  let lastError = '';
  let attempts = 0;
  const promptNeedle = prompt.replace(/\s+/g, ' ').trim().slice(0, 80);
  while (Date.now() - startedAt < 30_000) {
    attempts += 1;
    const ready = await evalJson<{ disabled: string | null; tagged: boolean }>(payload, `
      (() => {
        const visible = (el) => { const r = el.getBoundingClientRect && el.getBoundingClientRect(); return !!r && r.width > 0 && r.height > 0; };
        const btn = Array.from(document.querySelectorAll('button')).filter(visible)
          .find(el => /^arrow_forward\\s*Create$/i.test((el.innerText || '').trim()));
        if (!btn) return JSON.stringify({ disabled: 'missing', tagged: false });
        const disabled = btn.getAttribute('aria-disabled');
        if (disabled === 'true') return JSON.stringify({ disabled, tagged: false });
        btn.setAttribute('data-bnbot-flow-create', '1');
        return JSON.stringify({ disabled, tagged: true });
      })()
    `).catch(() => ({ disabled: null, tagged: false }));
    lastDisabled = ready.disabled || 'unknown';
    if (ready.tagged) {
      try {
        await send('debug_show_window', payload).catch(() => undefined);
        await send('debug_click', { ...payload, selector: '[data-bnbot-flow-create="1"]' });
      } catch (error) {
        lastError = getErrorMessage(error);
        await sleep(500);
        continue;
      }

      for (let poll = 0; poll < 8; poll += 1) {
        await sleep(700);
        const state = await evalJson<{
          submitted: boolean;
          composerText: string;
          createDisabled: string | null;
          failed: boolean;
          hasProgressCard: boolean;
          promptOutsideComposer: boolean;
        }>(payload, `
          (() => {
            const normalize = (s) => String(s || '').replace(/\\uFEFF/g, '').replace(/\\s+/g, ' ').trim();
            const composer = document.querySelector('[contenteditable=true][data-slate-editor=true]');
            const composerText = normalize(composer ? composer.innerText : '');
            const visible = (el) => { const r = el.getBoundingClientRect && el.getBoundingClientRect(); return !!r && r.width > 0 && r.height > 0; };
            const createBtn = Array.from(document.querySelectorAll('button')).filter(visible)
              .find(el => /^arrow_forward\\s*Create$/i.test((el.innerText || '').trim()));
            const body = document.body.innerText || '';
            const promptNeedle = ${JSON.stringify(promptNeedle)};
            const promptStillInComposer = !!promptNeedle && composerText.includes(promptNeedle);
            const bodyHasPrompt = !!promptNeedle && normalize(body).includes(promptNeedle);
            const promptOutsideComposer = !!promptNeedle && Array.from(document.querySelectorAll('body *')).some((el) => {
              if (!el || el === composer || (composer && composer.contains(el)) || (composer && el.contains(composer))) return false;
              return normalize(el.innerText).includes(promptNeedle);
            });
            const placeholderOnly = !composerText || /^What do you want to create\\??$/i.test(composerText);
            const hasProgressCard = /\\b(\\d{1,3}%|Reuse Prompt|Generated image|Failed)\\b/i.test(body);
            const failed = /warning\\s*Failed/i.test(body);
            const submitted = promptNeedle
              ? (!promptStillInComposer && promptOutsideComposer)
              : (!promptStillInComposer && placeholderOnly && hasProgressCard);
            return JSON.stringify({
              submitted,
              composerText,
              createDisabled: createBtn ? createBtn.getAttribute('aria-disabled') : 'missing',
              failed,
              hasProgressCard,
              bodyHasPrompt,
              promptOutsideComposer,
            });
          })()
        `).catch((error) => ({
          submitted: false,
          composerText: 'probe_failed',
          createDisabled: null,
          failed: false,
          hasProgressCard: false,
          promptOutsideComposer: false,
          error: getErrorMessage(error),
        } as { submitted: boolean; composerText: string; createDisabled: string | null; failed: boolean; hasProgressCard: boolean; promptOutsideComposer: boolean; error?: string }));
        lastState = `composer=${JSON.stringify(state.composerText).slice(0, 120)} createDisabled=${state.createDisabled} progress=${state.hasProgressCard} outsidePrompt=${state.promptOutsideComposer} failed=${state.failed}`;
        if (state.submitted) {
          return { ok: true, method: 'cdp-trusted', attempts };
        }
      }
    }
    await sleep(500);
  }
  return {
    ok: false,
    method: 'cdp-trusted',
    attempts,
    error: `flow_create_click_not_accepted: aria-disabled=${lastDisabled}; ${lastState}${lastError ? `; last_click_error=${lastError}` : ''}`,
  };
}

async function listFlowVideoSources(payload: Record<string, unknown>): Promise<{ source: string }[]> {
  return evalJson(payload, `
    (() => JSON.stringify(
      Array.from(document.querySelectorAll('video'))
        .map(v => ({ source: v.currentSrc || v.src || '' }))
        .filter(it => it.source)
    ))()
  `);
}

async function waitForFlowVideo(
  payload: Record<string, unknown>,
  beforeSources: Set<string>,
  timeoutMs: number,
): Promise<{ status: string; elapsed_ms: number; url?: string; video_count: number; timed_out: boolean; error?: string }> {
  const startedAt = Date.now();
  let videoCount = 0;
  let lastUrl: string | undefined;
  while (Date.now() - startedAt < timeoutMs) {
    await sleep(POLL_MS);
    const videos = await listFlowVideoSources(payload).catch(() => [] as { source: string }[]);
    videoCount = videos.length;
    const fresh = videos.some((v) => v.source && !beforeSources.has(v.source));
    const state = await evalJson<{ url: string; failed: boolean; progressing: boolean }>(payload, `
      (() => JSON.stringify({
        url: location.href,
        failed: /warning\\s*Failed/i.test(document.body.innerText || ''),
        progressing: /(^|\\D)\\d{1,3}%($|\\D)/.test(document.body.innerText || '')
      }))()
    `).catch(() => ({ url: undefined as unknown as string, failed: false, progressing: false }));
    lastUrl = state.url;
    if (fresh) {
      return { status: 'complete', elapsed_ms: Date.now() - startedAt, url: lastUrl, video_count: videoCount, timed_out: false };
    }
    if (state.failed && !state.progressing) {
      return { status: 'failed', elapsed_ms: Date.now() - startedAt, url: lastUrl, video_count: videoCount, timed_out: false, error: 'Flow reported the generation as Failed' };
    }
  }
  return { status: 'timeout', elapsed_ms: Date.now() - startedAt, url: lastUrl, video_count: videoCount, timed_out: true };
}

async function extractFlowVideos(payload: Record<string, unknown>, beforeSources: Set<string>): Promise<VideoArtifact[]> {
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
          const r = String(reader.result || '');
          const comma = r.indexOf(',');
          resolve(comma >= 0 ? r.slice(comma + 1) : r);
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

function normalizeAspect(input?: string): string | null {
  if (!input) return null;
  const s = input.toLowerCase().trim();
  if (/16:9|landscape|horizontal|wide/.test(s)) return '16:9';
  if (/9:16|portrait|vertical|tall/.test(s)) return '9:16';
  return null;
}

function normalizeDuration(input?: string): number | undefined {
  if (!input) return undefined;
  const num = Number.parseInt(String(input).replace(/s$/, ''), 10);
  if (![4, 6, 8, 10].includes(num)) {
    throw new Error('--duration must be one of: 4, 6, 8, 10 (seconds)');
  }
  return num;
}

function normalizeCount(input?: string): number | undefined {
  if (!input) return undefined;
  const num = Number.parseInt(String(input).replace(/^x/i, ''), 10);
  if (![1, 2, 3, 4].includes(num)) {
    throw new Error('--count must be one of: 1, 2, 3, 4');
  }
  return num;
}

function normalizeModel(input?: string): string | null {
  if (!input) return null;
  const s = input.toLowerCase().trim();
  if (/omni[-_\s]?flash|^omni$|^flash$/.test(s)) return 'Omni Flash';
  if (/veo.*lite/.test(s)) return 'Veo 3.1 - Lite';
  if (/veo.*fast/.test(s)) return 'Veo 3.1 - Fast';
  if (/veo.*quality/.test(s) || /veo.*hd/.test(s) || /veo.*pro/.test(s)) return 'Veo 3.1 - Quality';
  // Pass through exact UI labels
  if (/^Omni Flash$/.test(input) || /^Veo 3\.1 - (Lite|Fast|Quality)$/.test(input)) return input;
  return null;
}

function escapeForRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── Flow image-generate helpers ─────────────────────────────────────────────

interface FlowImageArtifact {
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
}

function flowPromptNeedle(prompt?: string): string {
  return String(prompt || '').replace(/\s+/g, ' ').trim().slice(0, 160);
}

async function listFlowImageSources(
  payload: Record<string, unknown>,
  prompt?: string,
  sourceAllowlist: string[] = [],
  jobId = '',
): Promise<{ source: string }[]> {
  const needle = flowPromptNeedle(prompt);
  const allowlist = Array.from(new Set(sourceAllowlist.filter(Boolean)));
  return evalJson(payload, `
    (() => {
      const needle = ${JSON.stringify(needle)};
      const allowed = new Set(${JSON.stringify(allowlist)});
      const jobId = ${JSON.stringify(jobId)};
      const normalize = (s) => String(s || '').replace(/\\s+/g, ' ').trim();
      const belongsToPrompt = (img) => {
        const source = img.currentSrc || img.src || '';
        if (jobId && img.closest('[data-bnbot-flow-job="' + jobId + '"]')) return true;
        if (allowed.size) return allowed.has(source);
        if (!needle) return true;
        let el = img;
        for (let i = 0; el && i < 10; i += 1, el = el.parentElement) {
          if (normalize(el.innerText).includes(needle)) return true;
        }
        return false;
      };
      return JSON.stringify(
        Array.from(document.querySelectorAll('img'))
          .filter(img => /storage\\.googleapis\\.com|contribution\\.usercontent|lh3\\.googleusercontent|media\\.getMediaUrlRedirect/.test(img.currentSrc || img.src || ''))
          .filter(img => img.naturalWidth >= 256)
          .filter(belongsToPrompt)
          .map(img => ({ source: img.currentSrc || img.src || '' }))
          .filter(it => it.source)
      );
    })()
  `);
}

async function captureFlowPromptImageSources(
  payload: Record<string, unknown>,
  prompt: string,
  jobId: string,
  expectedImages: number,
  beforeSources: Set<string>,
  timeoutMs: number,
): Promise<string[]> {
  const startedAt = Date.now();
  let best: string[] = [];
  while (Date.now() - startedAt < timeoutMs) {
    await markFlowPromptCards(payload, prompt, jobId).catch(() => ({ marked: 0, sources: [] as string[] }));
    const sources = await listFlowImageSources(payload, prompt, [], jobId).catch(() => [] as { source: string }[]);
    const fresh = Array.from(new Set(sources.map((item) => item.source).filter((source) => source && !beforeSources.has(source))));
    if (fresh.length > best.length) best = fresh;
    if (fresh.length >= expectedImages) return fresh.slice(0, expectedImages);
    await sleep(500);
  }
  return best.slice(0, expectedImages);
}

async function markFlowPromptCards(
  payload: Record<string, unknown>,
  prompt: string,
  jobId: string,
): Promise<{ marked: number; sources: string[] }> {
  const needle = flowPromptNeedle(prompt);
  if (!needle || !jobId) return { marked: 0, sources: [] };
  return evalJson(payload, `
    (() => {
      const needle = ${JSON.stringify(needle)};
      const jobId = ${JSON.stringify(jobId)};
      const normalize = (s) => String(s || '').replace(/\\uFEFF/g, '').replace(/\\s+/g, ' ').trim();
      const composer = document.querySelector('[contenteditable=true][data-slate-editor=true]');
      const viewportArea = Math.max(1, window.innerWidth * window.innerHeight);
      const isComposerRelated = (el) => composer && (el === composer || composer.contains(el) || el.contains(composer));
      const looksLikeCard = (el) => {
        const text = normalize(el.innerText);
        if (!text.includes(needle)) return false;
        if (isComposerRelated(el)) return false;
        const rect = el.getBoundingClientRect && el.getBoundingClientRect();
        if (!rect || rect.width < 32 || rect.height < 32) return false;
        if ((rect.width * rect.height) > viewportArea * 0.72) return false;
        return !!el.querySelector('img, video') || /\\b\\d{1,3}%\\b|Reuse prompt|Failed|redo/i.test(text);
      };
      const marked = new Set();
      for (const el of Array.from(document.querySelectorAll('body *'))) {
        if (!looksLikeCard(el)) continue;
        el.setAttribute('data-bnbot-flow-job', jobId);
        marked.add(el);
      }
      const selector = '[data-bnbot-flow-job="' + jobId + '"] img';
      const sources = Array.from(document.querySelectorAll(selector))
        .map((img) => img.currentSrc || img.src || '')
        .filter(Boolean);
      return JSON.stringify({ marked: marked.size, sources });
    })()
  `);
}

async function waitForFlowImage(
  payload: Record<string, unknown>,
  beforeSources: Set<string>,
  timeoutMs: number,
  prompt?: string,
  expectedImages = 1,
  sourceAllowlist: string[] = [],
  jobId = '',
): Promise<{ status: string; elapsed_ms: number; url?: string; image_count: number; timed_out: boolean; error?: string }> {
  const startedAt = Date.now();
  let imageCount = 0;
  let lastUrl: string | undefined;
  let failedPolls = 0;
  while (Date.now() - startedAt < timeoutMs) {
    await sleep(POLL_MS);
    await markFlowPromptCards(payload, prompt || '', jobId).catch(() => ({ marked: 0, sources: [] as string[] }));
    const images = await listFlowImageSources(payload, prompt, sourceAllowlist, jobId).catch(() => [] as { source: string }[]);
    imageCount = images.length;
    const fresh = images.filter((it) => it.source && (sourceAllowlist.length ? sourceAllowlist.includes(it.source) : !beforeSources.has(it.source)));
    const state = await evalJson<{ url: string; failed: boolean; progressing: boolean }>(payload, `
      (() => JSON.stringify({
        url: location.href,
        failed: /warning\\s*Failed/i.test(document.body.innerText || ''),
        progressing: /(^|\\D)\\d{1,3}%($|\\D)/.test(document.body.innerText || '')
      }))()
    `).catch(() => ({ url: undefined as unknown as string, failed: false, progressing: false }));
    lastUrl = state.url;
    if (fresh.length >= expectedImages) return { status: 'complete', elapsed_ms: Date.now() - startedAt, url: lastUrl, image_count: imageCount, timed_out: false };
    // Flow can briefly render a Failed/30% placeholder while the media URL
    // is still being resolved. Treat failure as real only after it is stable.
    failedPolls = state.failed && !state.progressing ? failedPolls + 1 : 0;
    if (failedPolls >= 5) {
      return { status: 'failed', elapsed_ms: Date.now() - startedAt, url: lastUrl, image_count: imageCount, timed_out: false, error: 'Flow reported the generation as Failed' };
    }
  }
  return { status: 'timeout', elapsed_ms: Date.now() - startedAt, url: lastUrl, image_count: imageCount, timed_out: true };
}

async function extractFlowImages(
  payload: Record<string, unknown>,
  beforeSources: Set<string>,
  prompt?: string,
  limit?: number,
  sourceAllowlist: string[] = [],
  jobId = '',
): Promise<FlowImageArtifact[]> {
  const before = JSON.stringify(Array.from(beforeSources));
  const needle = flowPromptNeedle(prompt);
  const maxItems = Number.isFinite(limit) && limit && limit > 0 ? limit : 0;
  const allowlist = Array.from(new Set(sourceAllowlist.filter(Boolean)));
  await markFlowPromptCards(payload, prompt || '', jobId).catch(() => ({ marked: 0, sources: [] as string[] }));
  return evalJson(payload, `
    (async () => {
      const before = new Set(${before});
      const needle = ${JSON.stringify(needle)};
      const maxItems = ${JSON.stringify(maxItems)};
      const allowed = new Set(${JSON.stringify(allowlist)});
      const jobId = ${JSON.stringify(jobId)};
      const normalize = (s) => String(s || '').replace(/\\s+/g, ' ').trim();
      const belongsToPrompt = (img) => {
        const source = img.currentSrc || img.src || '';
        if (jobId && img.closest('[data-bnbot-flow-job="' + jobId + '"]')) return true;
        if (allowed.size) return allowed.has(source);
        if (!needle) return true;
        let el = img;
        for (let i = 0; el && i < 10; i += 1, el = el.parentElement) {
          if (normalize(el.innerText).includes(needle)) return true;
        }
        return false;
      };
      const imgs = Array.from(document.querySelectorAll('img'))
        .filter(img => /storage\\.googleapis\\.com|contribution\\.usercontent|lh3\\.googleusercontent|media\\.getMediaUrlRedirect/.test(img.currentSrc || img.src || ''))
        .filter(img => img.naturalWidth >= 256)
        .filter(belongsToPrompt)
        .filter(img => allowed.size ? allowed.has(img.currentSrc || img.src || '') : !before.has(img.currentSrc || img.src || ''));
      const selected = maxItems > 0 ? imgs.slice(0, maxItems) : imgs;
      const blobToBase64 = (blob) => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error || new Error('FileReader failed'));
        reader.onload = () => {
          const r = String(reader.result || '');
          const comma = r.indexOf(',');
          resolve(comma >= 0 ? r.slice(comma + 1) : r);
        };
        reader.readAsDataURL(blob);
      });
      const imageToBase64 = (img) => {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('canvas_context_unavailable');
        ctx.drawImage(img, 0, 0);
        const dataUrl = canvas.toDataURL('image/png');
        const comma = dataUrl.indexOf(',');
        return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
      };
      const out = [];
      for (const img of selected) {
        const source = img.currentSrc || img.src;
        try {
          const resp = await fetch(source, { credentials: 'include' });
          if (!resp.ok) throw new Error('fetch_status_' + resp.status);
          const blob = await resp.blob();
          const mime = blob.type && blob.type.startsWith('image/') ? blob.type : 'image/png';
          out.push({
            index: out.length + 1,
            type: 'image',
            source,
            mime,
            width: img.naturalWidth || undefined,
            height: img.naturalHeight || undefined,
            bytes: blob.size,
            base64: await blobToBase64(blob),
          });
        } catch (error) {
          try {
            out.push({
              index: out.length + 1,
              type: 'image',
              source,
              mime: 'image/png',
              width: img.naturalWidth || undefined,
              height: img.naturalHeight || undefined,
              base64: imageToBase64(img),
            });
          } catch (canvasError) {
            const fetchError = error instanceof Error ? error.message : String(error);
            const fallbackError = canvasError instanceof Error ? canvasError.message : String(canvasError);
            out.push({
              index: out.length + 1,
              type: 'image',
              source,
              mime: 'image/png',
              width: img.naturalWidth || undefined,
              height: img.naturalHeight || undefined,
              error: fetchError + '; canvas_fallback_failed: ' + fallbackError,
            });
          }
        }
      }
      return JSON.stringify(out);
    })()
  `);
}

function persistFlowImageArtifacts(artifacts: FlowImageArtifact[], artifactDir?: string, inlineArtifacts = false): FlowImageArtifact[] {
  if (!artifacts.length) return artifacts;
  // Use Node fs writeFileSync from the gemini-web module's imports; here we delegate to dynamic require.
  const path = require('node:path');
  const fs = require('node:fs');
  const os = require('node:os');
  const dir = artifactDir || path.join(os.tmpdir(), 'bnbot-flow-artifacts');
  fs.mkdirSync(dir, { recursive: true });
  return artifacts.map((artifact, index) => {
    if (!artifact.base64 || artifact.error) return artifact;
    const bytes = Buffer.from(artifact.base64, 'base64');
    const ext = /jpe?g/.test(artifact.mime) ? 'jpg' : /webp/.test(artifact.mime) ? 'webp' : 'png';
    const filePath = path.join(dir, `flow-image-${Date.now()}-${index + 1}.${ext}`);
    fs.writeFileSync(filePath, bytes);
    const persisted: FlowImageArtifact = { ...artifact, path: filePath, bytes: bytes.length };
    if (!inlineArtifacts || bytes.length > 8 * 1024 * 1024) delete persisted.base64;
    return persisted;
  });
}

function renumberFlowImageArtifacts(artifacts: FlowImageArtifact[]): FlowImageArtifact[] {
  return artifacts.map((a, i) => ({ ...a, index: i + 1 }));
}

function flowImageArtifactToApi(artifact: FlowImageArtifact, responseFormat: string): Record<string, unknown> {
  const out: Record<string, unknown> = { mime: artifact.mime, bytes: artifact.bytes };
  if (artifact.width) out.width = artifact.width;
  if (artifact.height) out.height = artifact.height;
  if (artifact.path) out.path = artifact.path;
  if (responseFormat === 'b64_json' && artifact.base64) out.b64_json = artifact.base64;
  return out;
}
