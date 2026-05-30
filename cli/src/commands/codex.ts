import { execFileSync, spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import WebSocket, { type RawData } from 'ws';

const DEFAULT_CODEX_PORT = 9238;
const CODEX_PROCESS_NAME = 'Codex';
const CODEX_DISPLAY_NAME = 'Codex';
const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
const DEFAULT_CDP_TIMEOUT_MS = 30_000;
const DEFAULT_POLL_MS = 2_000;
const ARTIFACT_LIMIT = 10;
const MAX_ARTIFACT_BYTES = 8 * 1024 * 1024;
const CODEX_UI_LOCK_PATH = join(tmpdir(), 'bnbot-codex-ui.lock');
const CODEX_UI_LOCK_STALE_MS = 120_000;

interface CodexConnectionOptions {
  port?: string;
  endpoint?: string;
  launch?: boolean;
  restart?: boolean;
}

interface CodexReadOptions extends CodexConnectionOptions {
  limit?: string;
  artifacts?: boolean;
  artifactDir?: string;
  inlineArtifacts?: boolean;
}

interface CodexAskOptions extends CodexReadOptions {
  timeout?: string;
}

interface CodexImageGenerateOptions extends CodexConnectionOptions {
  size?: string;
  quality?: string;
  timeout?: string;
  responseFormat?: string;
  artifactDir?: string;
  inlineArtifacts?: boolean;
  new?: boolean;
  image?: string[];
}

interface CodexHistoryOptions extends CodexConnectionOptions {
  limit?: string;
  project?: string;
}

interface CodexModelOptions extends CodexConnectionOptions {}

interface CodexArtifactOptions extends CodexConnectionOptions {
  artifactDir?: string;
  inlineArtifacts?: boolean;
}

interface CDPTarget {
  id?: string;
  type?: string;
  url?: string;
  title?: string;
  webSocketDebuggerUrl?: string;
}

interface RuntimeEvaluateResult<T> {
  result?: {
    value?: T;
  };
  exceptionDetails?: {
    text?: string;
    exception?: {
      description?: string;
      value?: string;
    };
  };
}

interface ConnectResult {
  client: CDPClient;
  endpoint: string;
  target: CDPTarget;
  launched: boolean;
}

interface TurnSnapshot {
  count: number;
  text: string;
  turns: Array<{
    index: number;
    role?: string;
    text: string;
  }>;
  busy: boolean;
  title: string;
  url: string;
}

interface CodexThreadInfo {
  threadId: string;
  title: string;
  busy: boolean;
}

interface ImageArtifact {
  index: number;
  type: 'image' | 'canvas' | 'file';
  source: string;
  mime: string;
  width?: number;
  height?: number;
  alt?: string;
  bytes?: number;
  base64?: string;
  error?: string;
  path?: string;
}

class CDPClient {
  private ws: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  async connect(wsUrl: string, timeoutMs = DEFAULT_CONNECT_TIMEOUT_MS): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error(`Timed out connecting to Codex CDP after ${timeoutMs / 1000}s`));
      }, timeoutMs);

      ws.on('open', () => {
        clearTimeout(timer);
        this.ws = ws;
        resolve();
      });

      ws.on('message', (raw: RawData) => this.handleMessage(raw));
      ws.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      ws.on('close', () => {
        this.rejectPending(new Error('Codex CDP connection closed'));
        this.ws = null;
      });
    });

    await this.send('Runtime.enable').catch(() => undefined);
    await this.send('Page.enable').catch(() => undefined);
  }

  close(): void {
    this.ws?.close();
    this.ws = null;
    this.rejectPending(new Error('Codex CDP connection closed'));
  }

  async send<T = unknown>(
    method: string,
    params: Record<string, unknown> = {},
    timeoutMs = DEFAULT_CDP_TIMEOUT_MS,
  ): Promise<T> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Codex CDP connection is not open');
    }

    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP command ${method} timed out after ${timeoutMs / 1000}s`));
      }, timeoutMs);

      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });
      this.ws!.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate<T>(expression: string, timeoutMs = DEFAULT_CDP_TIMEOUT_MS): Promise<T> {
    const result = await this.send<RuntimeEvaluateResult<T>>(
      'Runtime.evaluate',
      {
        expression,
        returnByValue: true,
        awaitPromise: true,
      },
      timeoutMs,
    );

    if (result.exceptionDetails) {
      const detail =
        result.exceptionDetails.exception?.description ||
        result.exceptionDetails.exception?.value ||
        result.exceptionDetails.text ||
        'Unknown Runtime.evaluate error';
      throw new Error(detail);
    }

    return result.result?.value as T;
  }

  async pressEnter(): Promise<void> {
    await this.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Enter',
      code: 'Enter',
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
    });
    await this.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Enter',
      code: 'Enter',
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
    });
  }

  async pressNewConversationShortcut(): Promise<void> {
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    const modifiers = process.platform === 'darwin' ? 4 : 2;
    await this.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: modifier,
      code: modifier === 'Meta' ? 'MetaLeft' : 'ControlLeft',
      windowsVirtualKeyCode: modifier === 'Meta' ? 91 : 17,
      nativeVirtualKeyCode: modifier === 'Meta' ? 91 : 17,
      modifiers,
    });
    await this.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'n',
      code: 'KeyN',
      windowsVirtualKeyCode: 78,
      nativeVirtualKeyCode: 78,
      modifiers,
    });
    await this.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'n',
      code: 'KeyN',
      windowsVirtualKeyCode: 78,
      nativeVirtualKeyCode: 78,
      modifiers,
    });
    await this.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: modifier,
      code: modifier === 'Meta' ? 'MetaLeft' : 'ControlLeft',
      windowsVirtualKeyCode: modifier === 'Meta' ? 91 : 17,
      nativeVirtualKeyCode: modifier === 'Meta' ? 91 : 17,
    });
  }

  async pressPasteShortcut(): Promise<void> {
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    const modifiers = process.platform === 'darwin' ? 4 : 2;
    await this.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: modifier,
      code: modifier === 'Meta' ? 'MetaLeft' : 'ControlLeft',
      windowsVirtualKeyCode: modifier === 'Meta' ? 91 : 17,
      nativeVirtualKeyCode: modifier === 'Meta' ? 91 : 17,
      modifiers,
    });
    await this.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'v',
      code: 'KeyV',
      windowsVirtualKeyCode: 86,
      nativeVirtualKeyCode: 86,
      modifiers,
    });
    await this.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'v',
      code: 'KeyV',
      windowsVirtualKeyCode: 86,
      nativeVirtualKeyCode: 86,
      modifiers,
    });
    await this.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: modifier,
      code: modifier === 'Meta' ? 'MetaLeft' : 'ControlLeft',
      windowsVirtualKeyCode: modifier === 'Meta' ? 91 : 17,
      nativeVirtualKeyCode: modifier === 'Meta' ? 91 : 17,
    });
  }

  async setFileInputFiles(files: string[], selector = 'input[type="file"]'): Promise<void> {
    await this.send('DOM.enable').catch(() => undefined);
    const doc = await this.send<{ root?: { nodeId?: number } }>('DOM.getDocument', {
      depth: -1,
      pierce: true,
    });
    const rootNodeId = doc.root?.nodeId;
    if (!rootNodeId) throw new Error('Could not read DOM root for file upload');

    const queried = await this.send<{ nodeId?: number }>('DOM.querySelector', {
      nodeId: rootNodeId,
      selector,
    });
    if (!queried.nodeId) {
      throw new Error(`Could not find file input matching ${selector}`);
    }

    await this.send('DOM.setFileInputFiles', {
      nodeId: queried.nodeId,
      files,
    }, 60_000);
  }

  private handleMessage(raw: RawData): void {
    let msg: { id?: number; result?: unknown; error?: { message?: string } };
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (!msg.id || !this.pending.has(msg.id)) return;
    const pending = this.pending.get(msg.id)!;
    clearTimeout(pending.timer);
    this.pending.delete(msg.id);

    if (msg.error) {
      pending.reject(new Error(msg.error.message || 'CDP command failed'));
      return;
    }

    pending.resolve(msg.result);
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

export async function codexStatusCommand(options: CodexConnectionOptions): Promise<void> {
  const port = parsePort(options.port);
  const endpoint = normalizeEndpoint(options.endpoint) || readEndpointOverride();
  const processRunning = isProcessRunning(CODEX_PROCESS_NAME);

  if (endpoint) {
    const reachable = await probeEndpoint(endpoint, port);
    printJson({
      success: reachable,
      app: CODEX_DISPLAY_NAME,
      connected: reachable,
      endpoint,
      processRunning,
      message: reachable ? 'Codex CDP endpoint is reachable.' : 'Codex CDP endpoint is not reachable.',
    });
    return;
  }

  const cdpReachable = await probePort(port);
  if (!cdpReachable && !options.launch) {
    printJson({
      success: false,
      app: CODEX_DISPLAY_NAME,
      connected: false,
      port,
      processRunning,
      message: processRunning
        ? `Codex is running, but CDP is not listening on port ${port}. Quit Codex and rerun a bnbot codex command, or launch it with --remote-debugging-port=${port}.`
        : `Codex is not listening on port ${port}.`,
    });
    return;
  }

  let connected: ConnectResult | null = null;
  try {
    connected = await connectCodex({ ...options, launch: options.launch === true });
    const page = await readPageIdentity(connected.client);
    printJson({
      success: true,
      app: CODEX_DISPLAY_NAME,
      connected: true,
      launched: connected.launched,
      endpoint: connected.endpoint,
      target: summarizeTarget(connected.target),
      page,
    });
  } catch (error) {
    printJson({
      success: false,
      app: CODEX_DISPLAY_NAME,
      connected: false,
      port,
      processRunning,
      error: getErrorMessage(error),
    });
  } finally {
    connected?.client.close();
  }
}

export async function codexSendCommand(textArg: string, options: CodexConnectionOptions): Promise<void> {
  const text = await readTextArgument(textArg);
  const connected = await connectCodex(options);

  try {
    const injected = await injectComposerText(connected.client, text);
    if (!injected.ok) throw new Error(injected.error || 'Could not find Codex composer input');
    await sleep(350);
    const submit = await submitComposer(connected.client);
    printJson({
      success: true,
      action: 'send',
      injectedChars: text.length,
      composer: injected,
      submit,
      target: summarizeTarget(connected.target),
    });
  } finally {
    connected.client.close();
  }
}

export async function codexReadCommand(options: CodexReadOptions): Promise<void> {
  const connected = await connectCodex(options);

  try {
    const snapshot = await readConversation(connected.client, parseLimit(options.limit, 20));
    const artifacts = options.artifacts
      ? renumberArtifacts([
        ...collectLocalImageArtifacts(snapshot.text, options.inlineArtifacts === true),
        ...persistArtifacts(
          await extractArtifacts(connected.client),
          options.artifactDir,
          options.inlineArtifacts === true,
        ),
      ])
      : [];

    printJson({
      success: true,
      action: 'read',
      target: summarizeTarget(connected.target),
      ...snapshot,
      artifacts,
    });
  } finally {
    connected.client.close();
  }
}

export async function codexAskCommand(textArg: string, options: CodexAskOptions): Promise<void> {
  const text = await readTextArgument(textArg);
  const timeoutMs = parseTimeoutMs(options.timeout, 90_000);
  const connected = await connectCodex(options);

  try {
    const before = await readConversation(connected.client, 1);
    const beforeArtifactSources = options.artifacts
      ? new Set((await extractArtifacts(connected.client)).map((artifact) => artifact.source))
      : new Set<string>();
    const injected = await injectComposerText(connected.client, text);
    if (!injected.ok) throw new Error(injected.error || 'Could not find Codex composer input');
    await sleep(350);
    const submit = await submitComposer(connected.client);

    const baselineIndex = before.turns[before.turns.length - 1]?.index ?? before.count;
    const response = await waitForResponse(
      connected.client,
      baselineIndex,
      timeoutMs,
      options.artifacts
        ? async () => (await extractArtifacts(connected.client)).some((artifact) => !beforeArtifactSources.has(artifact.source))
        : undefined,
    );
    const domArtifacts = options.artifacts
      ? filterNewArtifacts(await extractArtifacts(connected.client), beforeArtifactSources)
      : [];
    const artifacts = options.artifacts
      ? renumberArtifacts([
        ...collectLocalImageArtifacts(response.text, options.inlineArtifacts === true),
        ...persistArtifacts(
          domArtifacts,
          options.artifactDir,
          options.inlineArtifacts === true,
        ),
      ])
      : [];

    printJson({
      success: response.status === 'complete' || artifacts.length > 0,
      action: 'ask',
      status: response.status === 'timeout' && artifacts.length > 0 ? 'complete' : response.status,
      prompt: text,
      response: response.text,
      submit,
      timedOut: response.status === 'timeout' && artifacts.length === 0,
      target: summarizeTarget(connected.target),
      artifacts,
    });
  } finally {
    connected.client.close();
  }
}

export async function codexImageGenerateCommand(
  promptArg: string,
  options: CodexImageGenerateOptions,
): Promise<void> {
  const prompt = await readTextArgument(promptArg);
  const timeoutMs = parseTimeoutMs(options.timeout, 300_000);
  const responseFormat = options.responseFormat || 'path';
  if (responseFormat !== 'path' && responseFormat !== 'b64_json') {
    throw new Error('--response-format must be one of: path, b64_json');
  }
  const inlineArtifacts = options.inlineArtifacts === true || responseFormat === 'b64_json';
  const connected = await connectCodex(options);

  try {
    const referenceImages = await resolveImageInputs(options.image ?? [], options.artifactDir);
    const prepared = await withCodexUiLock(async () => {
      const previousThread = await getActiveCodexThread(connected.client);
      if (options.new) {
        await startNewCodexConversation(connected.client);
      }
      await waitForCodexComposer(connected.client);

      const before = await readConversation(connected.client, 1);
      const activeBeforeSubmit = await getActiveCodexThread(connected.client);
      const beforeArtifactSources = new Set([
        ...(await extractArtifacts(connected.client)).map((artifact) => artifact.source),
        ...collectGeneratedImageArtifacts(activeBeforeSubmit.threadId, inlineArtifacts).map((artifact) => artifact.source),
      ]);
      const attachments = await attachComposerFiles(connected.client, referenceImages);
      if (!attachments.ok) throw new Error(attachments.error || 'Failed to attach reference image(s)');
      const text = buildImageGeneratePrompt(prompt, options.size, options.quality, referenceImages.length);
      const injected = await injectComposerText(connected.client, text);
      if (!injected.ok) throw new Error(injected.error || 'Could not find Codex composer input');
      await sleep(350);
      const submit = await submitComposer(connected.client);
      const thread = options.new
        ? await waitForCodexThreadAfterSubmit(connected.client, previousThread.threadId)
        : await getActiveCodexThread(connected.client);
      return {
        before,
        beforeArtifactSources,
        attachments,
        injected,
        submit,
        thread,
      };
    }, Math.min(90_000, Math.max(30_000, timeoutMs)));

    const baselineIndex = prepared.before.turns[prepared.before.turns.length - 1]?.index ?? prepared.before.count;
    const response = await waitForCodexThreadResponse(
      connected.client,
      prepared.thread.threadId,
      baselineIndex,
      timeoutMs,
      prepared.beforeArtifactSources,
      inlineArtifacts,
    );
    const artifacts = renumberArtifacts(dedupeArtifacts([
      ...collectLocalImageArtifacts(response.text, inlineArtifacts),
      ...persistArtifacts(filterNewArtifacts(response.artifacts, prepared.beforeArtifactSources), options.artifactDir, inlineArtifacts),
    ]));
    const images = artifacts
      .filter((artifact) => isRasterImageMime(artifact.mime))
      .map((artifact) => imageArtifactToApiImage(artifact, responseFormat));

    printJson({
      success: images.length > 0,
      action: 'image-generate',
      status: images.length > 0 ? 'complete' : response.status,
      prompt,
      size: options.size || null,
      quality: options.quality || null,
      reference_images: referenceImages.length,
      response_format: responseFormat,
      response: response.text,
      submit: prepared.submit,
      attachments: prepared.attachments,
      composer: prepared.injected,
      thread: response.thread || prepared.thread,
      images,
      artifacts,
      error: images.length > 0 ? undefined : 'No raster image artifact was produced by Codex Desktop.',
      target: summarizeTarget(connected.target),
    });
  } finally {
    connected.client.close();
  }
}

export async function codexNewCommand(options: CodexConnectionOptions): Promise<void> {
  const connected = await connectCodex(options);

  try {
    const result = await withCodexUiLock(async () => {
      const before = await getActiveCodexThread(connected.client);
      const created = await startNewCodexConversation(connected.client);
      await waitForCodexComposer(connected.client);
      const after = await getActiveCodexThread(connected.client);
      return { before, after, created };
    });
    printJson({
      success: true,
      action: 'new',
      ...result,
      target: summarizeTarget(connected.target),
    });
  } finally {
    connected.client.close();
  }
}

export async function codexHistoryCommand(options: CodexHistoryOptions): Promise<void> {
  const connected = await connectCodex(options);

  try {
    const projects = await connected.client.evaluate<unknown[]>(historyScript());
    const rows = flattenHistory(projects, options);
    printJson({
      success: true,
      action: 'history',
      target: summarizeTarget(connected.target),
      rows,
    });
  } finally {
    connected.client.close();
  }
}

export async function codexModelCommand(modelName: string | undefined, options: CodexModelOptions): Promise<void> {
  const connected = await connectCodex(options);

  try {
    const result = await connected.client.evaluate<{ current: string; status: string }>(
      modelScript(modelName),
    );
    printJson({
      success: true,
      action: 'model',
      requested: modelName || null,
      ...result,
      target: summarizeTarget(connected.target),
    });
  } finally {
    connected.client.close();
  }
}

export async function codexArtifactsCommand(options: CodexArtifactOptions): Promise<void> {
  const connected = await connectCodex(options);

  try {
    const artifacts = persistArtifacts(
      await extractArtifacts(connected.client),
      options.artifactDir,
      options.inlineArtifacts === true,
    );
    printJson({
      success: true,
      action: 'artifacts',
      target: summarizeTarget(connected.target),
      artifacts,
    });
  } finally {
    connected.client.close();
  }
}

async function connectCodex(options: CodexConnectionOptions): Promise<ConnectResult> {
  const { endpoint, port, launched } = await resolveEndpoint(options);
  const target = endpoint.startsWith('ws://') || endpoint.startsWith('wss://')
    ? { webSocketDebuggerUrl: endpoint, title: CODEX_DISPLAY_NAME, type: 'page', url: '' }
    : await selectTargetFromEndpoint(endpoint);

  if (!target.webSocketDebuggerUrl) {
    throw new Error(`No inspectable Codex target found at ${endpoint}/json`);
  }

  const client = new CDPClient();
  await client.connect(target.webSocketDebuggerUrl);
  return { client, endpoint, target, launched };
}

async function resolveEndpoint(options: CodexConnectionOptions): Promise<{ endpoint: string; port: number; launched: boolean }> {
  const port = parsePort(options.port);
  const override = normalizeEndpoint(options.endpoint) || readEndpointOverride();

  if (override) {
    if (!await probeEndpoint(override, port)) {
      throw new Error(`Codex CDP endpoint is not reachable: ${override}`);
    }
    return { endpoint: override, port, launched: false };
  }

  const endpoint = `http://127.0.0.1:${port}`;
  if (await probePort(port)) {
    return { endpoint, port, launched: false };
  }

  if (options.launch === false) {
    throw new Error(`Codex CDP is not listening on ${endpoint}`);
  }

  const running = isProcessRunning(CODEX_PROCESS_NAME);
  if (running && !options.restart) {
    throw new Error(
      `Codex is running without CDP on port ${port}. Quit Codex and rerun, or pass --restart to terminate and relaunch it with --remote-debugging-port=${port}.`,
    );
  }

  if (running && options.restart) {
    killProcess(CODEX_PROCESS_NAME);
    await waitForProcessExit(CODEX_PROCESS_NAME, 5_000);
  }

  await launchCodex(port);
  await waitForPort(port, 20_000);
  return { endpoint, port, launched: true };
}

async function selectTargetFromEndpoint(endpoint: string): Promise<CDPTarget> {
  const deadline = Date.now() + 15_000;
  let lastCount = 0;

  while (Date.now() < deadline) {
    const targets = await fetchJson<CDPTarget[]>(`${endpoint.replace(/\/$/, '')}/json`);
    lastCount = targets.length;
    const inspectable = targets.filter((target) => target.webSocketDebuggerUrl && target.type !== 'browser');
    const preferred =
      inspectable.find((target) => /codex/i.test(`${target.title || ''} ${target.url || ''}`)) ||
      inspectable.find((target) => target.type === 'page') ||
      inspectable[0];

    if (preferred) return preferred;
    await sleep(500);
  }

  throw new Error(`No inspectable targets returned by ${endpoint}/json after 15s (last target count: ${lastCount})`);
}

async function probeEndpoint(endpoint: string, fallbackPort: number): Promise<boolean> {
  if (endpoint.startsWith('ws://') || endpoint.startsWith('wss://')) {
    return true;
  }

  try {
    const url = new URL(endpoint);
    const port = Number.parseInt(url.port, 10) || fallbackPort;
    return probePort(port);
  } catch {
    return false;
  }
}

async function probePort(port: number): Promise<boolean> {
  try {
    await fetchJson<unknown[]>(`http://127.0.0.1:${port}/json`, 2_000);
    return true;
  } catch {
    return false;
  }
}

async function fetchJson<T>(url: string, timeoutMs = 5_000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }
    return await response.json() as T;
  } finally {
    clearTimeout(timer);
  }
}

function isProcessRunning(processName: string): boolean {
  if (process.platform === 'win32') return false;
  try {
    execFileSync('pgrep', ['-x', processName], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function killProcess(processName: string): void {
  if (process.platform === 'win32') {
    throw new Error('--restart is not supported on Windows yet.');
  }
  try {
    execFileSync('pkill', ['-x', processName], { stdio: 'ignore' });
  } catch {
    // Already stopped.
  }
}

async function waitForProcessExit(processName: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessRunning(processName)) return;
    await sleep(250);
  }
  throw new Error(`${processName} did not exit within ${timeoutMs / 1000}s`);
}

async function launchCodex(port: number): Promise<void> {
  if (process.platform !== 'darwin') {
    throw new Error(`Auto-launch is only implemented on macOS. Start Codex with --remote-debugging-port=${port}.`);
  }

  const appPath = discoverCodexAppPath();
  if (!appPath) {
    throw new Error('Could not find Codex.app on this machine.');
  }

  const candidates = [
    join(appPath, 'Contents', 'MacOS', CODEX_PROCESS_NAME),
    join(appPath, 'Contents', 'MacOS', 'Electron'),
  ];
  const executable = candidates.find((candidate) => existsSync(candidate));
  if (!executable) {
    throw new Error(`Could not find Codex executable under ${appPath}/Contents/MacOS`);
  }

  const child = spawn(
    executable,
    [`--remote-debugging-port=${port}`, '--remote-allow-origins=*'],
    {
      detached: true,
      stdio: 'ignore',
    },
  );
  child.unref();
}

function discoverCodexAppPath(): string | null {
  try {
    const result = execFileSync(
      'osascript',
      ['-e', `POSIX path of (path to application "${CODEX_DISPLAY_NAME}")`],
      { encoding: 'utf8', timeout: 5_000, stdio: 'pipe' },
    ).trim();
    if (result) return result.replace(/\/$/, '');
  } catch {
    // Fall through to common paths.
  }

  const candidates = [
    '/Applications/Codex.app',
    join(homedir(), 'Applications', 'Codex.app'),
  ];
  return candidates.find((candidate) => existsSync(candidate)) || null;
}

async function waitForPort(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probePort(port)) return;
    await sleep(500);
  }
  throw new Error(`Codex launched, but CDP did not become available on port ${port}.`);
}

async function readPageIdentity(client: CDPClient): Promise<{ title: string; url: string }> {
  return client.evaluate<{ title: string; url: string }>(`
    (() => ({
      title: document.title || '',
      url: window.location.href || ''
    }))()
  `);
}

async function injectComposerText(client: CDPClient, text: string): Promise<{ ok: boolean; tag?: string; error?: string }> {
  return client.evaluate<{ ok: boolean; tag?: string; error?: string }>(`
    ((text) => {
      const visible = (el) => {
        const rect = el.getBoundingClientRect?.();
        return !rect || (rect.width > 0 && rect.height > 0);
      };
      const editables = Array.from(document.querySelectorAll('[contenteditable="true"]')).filter(visible);
      const textarea = Array.from(document.querySelectorAll('textarea')).filter(visible).pop();
      const composer = editables.length ? editables[editables.length - 1] : textarea;
      if (!composer) return { ok: false, error: 'composer_not_found' };

      composer.focus();
      if (composer.tagName === 'TEXTAREA' || composer.tagName === 'INPUT') {
        const input = composer;
        const start = input.selectionStart ?? input.value.length;
        const end = input.selectionEnd ?? input.value.length;
        input.value = input.value.slice(0, start) + text + input.value.slice(end);
        input.selectionStart = input.selectionEnd = start + text.length;
        input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
      } else {
        document.execCommand('insertText', false, text);
        composer.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
      }

      return { ok: true, tag: composer.tagName.toLowerCase() };
    })(${JSON.stringify(text)})
  `);
}

async function submitComposer(client: CDPClient): Promise<{ ok: boolean; method: string; error?: string }> {
  const clicked = await client.evaluate<{ ok: boolean; method: string; error?: string }>(`
    (() => {
      const clean = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
      const visible = (el) => {
        const rect = el.getBoundingClientRect?.();
        return !!rect && rect.width > 0 && rect.height > 0;
      };
      const composer = Array.from(document.querySelectorAll('[contenteditable="true"], textarea')).filter(visible).pop();
      if (!composer) return { ok: false, method: 'dom-click', error: 'composer_not_found' };

      let root = composer;
      for (let i = 0; i < 8 && root?.parentElement; i += 1) {
        root = root.parentElement;
        const buttons = Array.from(root.querySelectorAll('button')).filter((button) => visible(button) && !button.disabled);
        if (buttons.length >= 3) break;
      }

      const buttons = Array.from((root || document).querySelectorAll('button')).filter((button) => visible(button) && !button.disabled);
      const labeled = buttons.find((button) => /send|submit|发送|提交/i.test(clean(button.innerText || button.textContent || button.getAttribute('aria-label') || button.getAttribute('title') || '')));
      const iconOnly = [...buttons].reverse().find((button) => {
        const label = clean(button.innerText || button.textContent || button.getAttribute('aria-label') || button.getAttribute('title') || '');
        return !label;
      });
      const button = labeled || iconOnly;
      if (!button) return { ok: false, method: 'dom-click', error: 'submit_button_not_found' };

      button.click();
      return { ok: true, method: 'dom-click' };
    })()
  `);

  if (clicked.ok) return clicked;

  await client.pressEnter();
  return { ok: true, method: 'enter-fallback', error: clicked.error };
}

async function readConversation(client: CDPClient, limit: number): Promise<TurnSnapshot> {
  return client.evaluate<TurnSnapshot>(conversationScript(limit));
}

async function withCodexUiLock<T>(fn: () => Promise<T>, timeoutMs = 90_000): Promise<T> {
  const fd = await acquireCodexUiLock(timeoutMs);
  try {
    return await fn();
  } finally {
    closeSync(fd);
    try {
      unlinkSync(CODEX_UI_LOCK_PATH);
    } catch {
      // Another process may have already removed a stale lock.
    }
  }
}

async function acquireCodexUiLock(timeoutMs: number): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const fd = openSync(CODEX_UI_LOCK_PATH, 'wx');
      writeFileSync(fd, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
      return fd;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (isCodexUiLockStale()) {
        try { unlinkSync(CODEX_UI_LOCK_PATH); } catch { /* ignore */ }
        continue;
      }
      await sleep(250);
    }
  }
  throw new Error(`Timed out waiting for Codex UI lock after ${timeoutMs / 1000}s`);
}

function isCodexUiLockStale(): boolean {
  try {
    return Date.now() - statSync(CODEX_UI_LOCK_PATH).mtimeMs > CODEX_UI_LOCK_STALE_MS;
  } catch {
    return true;
  }
}

async function getActiveCodexThread(client: CDPClient): Promise<CodexThreadInfo> {
  return client.evaluate<CodexThreadInfo>(`
    (() => {
      const clean = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
      const active = document.querySelector('[data-app-action-sidebar-thread-active="true"]');
      const buttons = Array.from(document.querySelectorAll('button'));
      const busy = buttons.some((button) => {
        const label = clean(button.innerText || button.textContent || button.getAttribute('aria-label') || '');
        return /stop|cancel|停止|中止/i.test(label);
      });
      return {
        threadId: active?.getAttribute('data-app-action-sidebar-thread-id') || '',
        title: clean(active?.innerText || active?.textContent || ''),
        busy
      };
    })()
  `);
}

async function startNewCodexConversation(client: CDPClient): Promise<{ ok: boolean; method: string; label?: string; error?: string }> {
  const clicked = await client.evaluate<{ ok: boolean; method: string; label?: string; error?: string }>(`
    (() => {
      const visible = (el) => {
        const rect = el.getBoundingClientRect?.();
        return !!rect && rect.width > 0 && rect.height > 0;
      };
      const activeThread = document.querySelector('[data-app-action-sidebar-thread-active="true"]');
      const projectContainer =
        activeThread?.closest('[role="listitem"][aria-label]') ||
        activeThread?.parentElement?.closest('[role="listitem"][aria-label]');
      const projectButton = projectContainer
        ? Array.from(projectContainer.querySelectorAll('button')).find((button) => (
            visible(button) && /^Start new chat in /i.test(button.getAttribute('aria-label') || '')
          ))
        : null;
      const fallback = Array.from(document.querySelectorAll('button')).find((button) => (
        visible(button) && /^Start new chat in /i.test(button.getAttribute('aria-label') || '')
      )) || Array.from(document.querySelectorAll('button')).find((button) => (
        visible(button) && /^(New chat|新聊天)/i.test(String(button.innerText || button.textContent || button.getAttribute('aria-label') || '').trim())
      ));
      const button = projectButton || fallback;
      if (!button) return { ok: false, method: 'dom-click', error: 'new_chat_button_not_found' };
      const label = button.getAttribute('aria-label') || button.innerText || button.textContent || '';
      button.click();
      return { ok: true, method: projectButton ? 'project-new-chat' : 'new-chat', label };
    })()
  `);
  if (clicked.ok) return clicked;

  await client.pressNewConversationShortcut();
  return { ok: true, method: 'shortcut', error: clicked.error };
}

async function waitForCodexComposer(client: CDPClient, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ready = await client.evaluate<{ ok: boolean }>(`
      (() => {
        const visible = (el) => {
          const rect = el.getBoundingClientRect?.();
          return !!rect && rect.width > 0 && rect.height > 0;
        };
        return {
          ok: Array.from(document.querySelectorAll('[contenteditable="true"], textarea')).some(visible)
        };
      })()
    `).catch(() => ({ ok: false }));
    if (ready.ok) return;
    await sleep(300);
  }
  throw new Error('Codex composer did not become ready before timeout');
}

async function waitForCodexThreadAfterSubmit(
  client: CDPClient,
  previousThreadId: string,
  timeoutMs = 15_000,
): Promise<CodexThreadInfo> {
  const deadline = Date.now() + timeoutMs;
  let last = await getActiveCodexThread(client);
  while (Date.now() < deadline) {
    last = await getActiveCodexThread(client);
    if (last.threadId && last.threadId !== previousThreadId) return last;
    await sleep(300);
  }
  if (last.threadId) return last;
  throw new Error('Codex did not expose a thread id after submit');
}

async function activateCodexThread(client: CDPClient, threadId: string): Promise<CodexThreadInfo> {
  const current = await getActiveCodexThread(client);
  if (!threadId || current.threadId === threadId) return current;

  const clicked = await client.evaluate<{ ok: boolean; error?: string }>(`
    ((threadId) => {
      const selector = '[data-app-action-sidebar-thread-id="' + CSS.escape(threadId) + '"]';
      const row = document.querySelector(selector);
      if (!row) return { ok: false, error: 'thread_not_found' };
      row.click();
      return { ok: true };
    })(${JSON.stringify(threadId)})
  `);
  if (!clicked.ok) throw new Error(clicked.error || `Could not activate Codex thread ${threadId}`);

  const deadline = Date.now() + 10_000;
  let active = await getActiveCodexThread(client);
  while (Date.now() < deadline) {
    active = await getActiveCodexThread(client);
    if (active.threadId === threadId) return active;
    await sleep(250);
  }
  return active;
}

async function waitForCodexThreadResponse(
  client: CDPClient,
  threadId: string,
  previousTurnIndex: number,
  timeoutMs: number,
  beforeArtifactSources: Set<string>,
  inlineArtifacts: boolean,
): Promise<{ status: 'complete' | 'timeout'; text: string; artifacts: ImageArtifact[]; thread?: CodexThreadInfo }> {
  const deadline = Date.now() + timeoutMs;
  let lastText = '';
  let stableSince = 0;
  let lastArtifacts: ImageArtifact[] = [];
  let lastThread: CodexThreadInfo | undefined;

  while (Date.now() < deadline) {
    await sleep(DEFAULT_POLL_MS);
    const poll = await withCodexUiLock(async () => {
      const active = await activateCodexThread(client, threadId);
      const snapshot = await readConversation(client, 10);
      const responseTurn = [...snapshot.turns]
        .reverse()
        .find((turn) => turn.index > previousTurnIndex && turn.role === 'assistant');
      const text = responseTurn?.text || '';
      const localArtifacts = filterNewArtifacts(
        collectGeneratedImageArtifacts(threadId, inlineArtifacts),
        beforeArtifactSources,
      );
      const domArtifacts = filterNewArtifacts(await extractArtifacts(client), beforeArtifactSources);
      return {
        busy: snapshot.busy,
        thread: { ...active, busy: snapshot.busy },
        text,
        artifacts: [...localArtifacts, ...domArtifacts],
      };
    }, 30_000);
    lastArtifacts = poll.artifacts;
    lastThread = poll.thread;

    if (poll.text === lastText) {
      stableSince += DEFAULT_POLL_MS;
    } else {
      lastText = poll.text;
      stableSince = 0;
    }

    if (!poll.busy && poll.artifacts.length > 0) {
      return { status: 'complete', text: poll.text, artifacts: poll.artifacts, thread: poll.thread };
    }
    if (poll.text && !poll.busy && stableSince >= DEFAULT_POLL_MS) {
      return { status: 'complete', text: poll.text, artifacts: poll.artifacts, thread: poll.thread };
    }
  }

  return { status: 'timeout', text: lastText, artifacts: lastArtifacts, thread: lastThread };
}

function conversationScript(limit: number): string {
  return `
    (() => {
      const clean = (value) => String(value || '').replace(/[\\t ]+\\n/g, '\\n').replace(/\\n{3,}/g, '\\n\\n').trim();
      const cleanMessage = (value) => clean(value).replace(/\\d{1,2}:\\d{2}\\s?(?:AM|PM)?$/i, '').trim();
      const unitNodes = Array.from(document.querySelectorAll('[data-content-search-unit-key]'));
      const turnNodes = unitNodes.length
        ? unitNodes
        : Array.from(document.querySelectorAll('[data-content-search-turn-key], [data-turn-key]'));

      let turns = turnNodes.map((node, index) => {
        const key = node.getAttribute('data-content-search-unit-key') || node.getAttribute('data-turn-key') || '';
        const role = key.includes(':assistant') ? 'assistant' : key.includes(':user') ? 'user' : '';
        return {
          index: index + 1,
          role,
          text: cleanMessage(node.innerText || node.textContent || '')
        };
      }).filter((turn) => turn.text);

      if (!turns.length) {
        const container = document.querySelector('[role="log"], [data-testid="conversation"], main') || document.body;
        const text = clean(container?.innerText || container?.textContent || '');
        turns = text ? [{ index: 1, text }] : [];
      }

      const buttons = Array.from(document.querySelectorAll('button'));
      const busy = buttons.some((button) => {
        const label = clean(button.innerText || button.textContent || button.getAttribute('aria-label') || '');
        return /stop|cancel|停止|中止/i.test(label);
      });

      const selected = turns.slice(Math.max(0, turns.length - ${limit}));
      return {
        count: turns.length,
        text: selected.map((turn) => turn.text).join('\\n\\n---\\n\\n'),
        turns: selected,
        busy,
        title: document.title || '',
        url: window.location.href || ''
      };
    })()
  `;
}

async function waitForResponse(
  client: CDPClient,
  previousTurnIndex: number,
  timeoutMs: number,
  hasNewArtifact?: () => Promise<boolean>,
): Promise<{ status: 'complete' | 'timeout'; text: string }> {
  const deadline = Date.now() + timeoutMs;
  let lastText = '';
  let stableSince = 0;

  while (Date.now() < deadline) {
    await sleep(DEFAULT_POLL_MS);
    const snapshot = await readConversation(client, 10);
    const responseTurn = [...snapshot.turns]
      .reverse()
      .find((turn) => turn.index > previousTurnIndex && turn.role === 'assistant');
    const text = responseTurn?.text || '';

    if (!text) {
      if (!snapshot.busy && hasNewArtifact && await hasNewArtifact()) {
        return { status: 'complete', text: '' };
      }
      continue;
    }

    if (text === lastText) {
      stableSince += DEFAULT_POLL_MS;
    } else {
      lastText = text;
      stableSince = 0;
    }

    if (!snapshot.busy && stableSince >= DEFAULT_POLL_MS) {
      return { status: 'complete', text };
    }
  }

  return { status: 'timeout', text: lastText };
}

async function extractArtifacts(client: CDPClient): Promise<ImageArtifact[]> {
  return client.evaluate<ImageArtifact[]>(artifactScript(), 60_000);
}

function artifactScript(): string {
  return `
    (async () => {
      const limit = ${ARTIFACT_LIMIT};
      const maxBytes = ${MAX_ARTIFACT_BYTES};
      const artifacts = [];
      const seen = new Set();

      const toBase64 = (blob) => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const value = String(reader.result || '');
          resolve(value.includes(',') ? value.split(',')[1] : value);
        };
        reader.onerror = () => reject(new Error('FileReader failed'));
        reader.readAsDataURL(blob);
      });

      const add = async (item) => {
        if (artifacts.length >= limit) return;
        if (item.source && seen.has(item.source)) return;
        if (item.source) seen.add(item.source);
        artifacts.push(item);
      };

      const assistantUnits = Array.from(document.querySelectorAll('[data-content-search-unit-key*=":assistant"]'));
      const root = assistantUnits[assistantUnits.length - 1] || document;

      const imgNodes = Array.from(root.querySelectorAll('img')).filter((img) => {
        const rect = img.getBoundingClientRect?.();
        const width = img.naturalWidth || rect?.width || 0;
        const height = img.naturalHeight || rect?.height || 0;
        return width >= 48 && height >= 48 && img.src;
      });

      for (const [idx, img] of imgNodes.entries()) {
        if (artifacts.length >= limit) break;
        const source = img.currentSrc || img.src;
        const base = {
          index: artifacts.length + 1,
          type: 'image',
          source,
          width: img.naturalWidth || undefined,
          height: img.naturalHeight || undefined,
          alt: img.alt || undefined,
          mime: 'application/octet-stream'
        };

        try {
          if (source.startsWith('data:image/')) {
            const match = source.match(/^data:([^;]+);base64,(.*)$/);
            await add({
              ...base,
              mime: match?.[1] || 'image/png',
              base64: match?.[2] || '',
              bytes: match?.[2] ? Math.floor(match[2].length * 0.75) : undefined
            });
            continue;
          }

          const response = await fetch(source, { credentials: 'include' });
          const blob = await response.blob();
          if (blob.size > maxBytes) {
            await add({ ...base, mime: blob.type || base.mime, bytes: blob.size, error: 'artifact_too_large' });
            continue;
          }
          await add({
            ...base,
            mime: blob.type || response.headers.get('content-type') || base.mime,
            bytes: blob.size,
            base64: await toBase64(blob)
          });
        } catch (error) {
          await add({ ...base, error: error instanceof Error ? error.message : String(error) });
        }
      }

      const canvases = Array.from(root.querySelectorAll('canvas')).filter((canvas) => {
        const rect = canvas.getBoundingClientRect?.();
        return (canvas.width || rect?.width || 0) >= 48 && (canvas.height || rect?.height || 0) >= 48;
      });

      for (const canvas of canvases) {
        if (artifacts.length >= limit) break;
        try {
          const dataUrl = canvas.toDataURL('image/png');
          const base64 = dataUrl.split(',')[1] || '';
          await add({
            index: artifacts.length + 1,
            type: 'canvas',
            source: 'canvas',
            mime: 'image/png',
            width: canvas.width,
            height: canvas.height,
            bytes: Math.floor(base64.length * 0.75),
            base64
          });
        } catch (error) {
          await add({
            index: artifacts.length + 1,
            type: 'canvas',
            source: 'canvas',
            mime: 'image/png',
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }

      return artifacts;
    })()
  `;
}

function collectLocalImageArtifacts(text: string, inlineArtifacts = false): ImageArtifact[] {
  const paths = new Set<string>();
  const pathRegex = /(?:^|["'\s])((?:~|\/)[^"'\s]+?\.(?:png|jpe?g|webp|gif|svg))(?:$|["'\s,}])/gi;
  let match: RegExpExecArray | null;

  while ((match = pathRegex.exec(text)) !== null) {
    paths.add(match[1].replace(/^~/, homedir()));
  }

  const artifacts: ImageArtifact[] = [];
  for (const path of paths) {
    if (!existsSync(path)) continue;
    let stat;
    try {
      stat = statSync(path);
    } catch {
      continue;
    }
    if (!stat.isFile() || stat.size > MAX_ARTIFACT_BYTES) continue;

    const artifact: ImageArtifact = {
      index: artifacts.length + 1,
      type: 'file',
      source: path,
      path,
      mime: mimeFromPath(path),
      bytes: stat.size,
    };

    if (inlineArtifacts) {
      artifact.base64 = readFileSync(path).toString('base64');
    }

    artifacts.push(artifact);
  }

  return artifacts;
}

function collectGeneratedImageArtifacts(threadId: string, inlineArtifacts = false): ImageArtifact[] {
  const id = normalizeCodexThreadId(threadId);
  if (!id) return [];

  const dir = join(homedir(), '.codex', 'generated_images', id);
  if (!existsSync(dir)) return [];

  const artifacts: ImageArtifact[] = [];
  for (const file of readdirSync(dir).sort()) {
    if (!/\.(?:png|jpe?g|webp|gif)$/i.test(file)) continue;
    const path = join(dir, file);
    let stat;
    try {
      stat = statSync(path);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;

    const artifact: ImageArtifact = {
      index: artifacts.length + 1,
      type: 'file',
      source: path,
      path,
      mime: mimeFromPath(path),
      bytes: stat.size,
    };
    if (inlineArtifacts && stat.size <= MAX_ARTIFACT_BYTES) {
      artifact.base64 = readFileSync(path).toString('base64');
    }
    artifacts.push(artifact);
  }
  return artifacts;
}

function normalizeCodexThreadId(threadId: string): string {
  return String(threadId || '').replace(/^local:/, '').trim();
}

function buildImageGeneratePrompt(
  prompt: string,
  size?: string,
  quality?: string,
  referenceCount = 0,
): string {
  return [
    '$imagegen',
    'Generate one real raster image file (PNG/JPG/WebP), not SVG, HTML, canvas code, Python drawing, or a placeholder.',
    size ? `Target size/aspect: ${size}.` : '',
    quality ? `Rendering quality target: ${quality}.` : '',
    referenceCount > 0 ? `Use the ${referenceCount} attached reference image(s) as visual references where relevant.` : '',
    'Do not add text, captions, logos, or watermarks unless the user explicitly asked for them.',
    'After the image is generated, do not do extra reasoning; just leave the generated image visible in the chat.',
    '',
    `Prompt: ${prompt}`,
  ].filter(Boolean).join('\n');
}

async function attachComposerFiles(
  client: CDPClient,
  files: string[],
): Promise<{ ok: boolean; attached: number; files: string[]; method: string; error?: string }> {
  if (!files.length) {
    return { ok: true, attached: 0, files: [], method: 'none' };
  }

  try {
    const attached = await attachFilesViaDomPaste(client, files);
    if (attached >= files.length) {
      return { ok: true, attached, files, method: 'dom-paste' };
    }
    return {
      ok: false,
      attached,
      files,
      method: 'dom-paste',
      error: `Only ${attached}/${files.length} reference image(s) appeared in the composer`,
    };
  } catch (domPasteError) {
    const pasteError = getErrorMessage(domPasteError);
    try {
      await revealFileInput(client).catch(() => undefined);
      await sleep(500);
      await client.setFileInputFiles(files);
      await sleep(1_500);
      return { ok: true, attached: files.length, files, method: 'DOM.setFileInputFiles', error: pasteError };
    } catch (error) {
      const domError = getErrorMessage(error);
      try {
        setClipboardFiles(files);
        await focusComposer(client);
        await client.pressPasteShortcut();
        await sleep(2_500);
        return { ok: true, attached: files.length, files, method: 'pasteboard', error: `${pasteError}; ${domError}` };
      } catch (fallbackError) {
        return {
          ok: false,
          attached: 0,
          files,
          method: 'pasteboard',
          error: `${pasteError}; ${domError}; paste fallback failed: ${getErrorMessage(fallbackError)}`,
        };
      }
    }
  }
}

async function attachFilesViaDomPaste(client: CDPClient, files: string[]): Promise<number> {
  const payload = files.map((file) => ({
    name: basename(file),
    mime: mimeFromPath(file),
    base64: readFileSync(file).toString('base64'),
  }));

  const result = await client.evaluate<{ ok: boolean; attached: number; error?: string }>(`
    (async (payload) => {
      const visible = (el) => {
        const rect = el.getBoundingClientRect?.();
        return !rect || (rect.width > 0 && rect.height > 0);
      };
      const editables = Array.from(document.querySelectorAll('[contenteditable="true"], .ProseMirror, textarea')).filter(visible);
      const target = editables.length ? editables[editables.length - 1] : document.body;
      if (!target) return { ok: false, attached: 0, error: 'composer_not_found' };

      const countAttached = () => {
        const removeLabels = Array.from(document.querySelectorAll('button[aria-label]'))
          .map((el) => el.getAttribute('aria-label') || '');
        return payload.reduce((count, item) => (
          count + removeLabels.filter((label) => label === 'Remove ' + item.name).length
        ), 0);
      };

      const before = countAttached();
      const dataTransfer = new DataTransfer();
      for (const item of payload) {
        const binary = atob(item.base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
        dataTransfer.items.add(new File([bytes], item.name, { type: item.mime }));
      }

      target.focus?.();
      const event = new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: dataTransfer,
      });
      target.dispatchEvent(event);

      const deadline = Date.now() + 8_000;
      while (Date.now() < deadline) {
        const attached = countAttached() - before;
        if (attached >= payload.length) return { ok: true, attached };
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      return { ok: false, attached: Math.max(0, countAttached() - before), error: 'attachment_preview_timeout' };
    })(${JSON.stringify(payload)})
  `, 15_000);

  if (!result.ok) throw new Error(result.error || 'DOM paste attachment failed');
  return result.attached;
}

async function revealFileInput(client: CDPClient): Promise<void> {
  await client.evaluate<void>(`
    (() => {
      const clean = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
      const visible = (el) => {
        const rect = el.getBoundingClientRect?.();
        return !!rect && rect.width > 0 && rect.height > 0;
      };
      if (document.querySelector('input[type="file"]')) return;
      const buttons = Array.from(document.querySelectorAll('button, [role="button"]')).filter(visible);
      const button = buttons.find((btn) => {
        const label = clean(btn.innerText || btn.textContent || btn.getAttribute('aria-label') || btn.getAttribute('title') || '');
        return /attach|upload|file|image|photo|添加|附件|上传|圖片|图片/i.test(label);
      });
      button?.click();
    })()
  `);
}

async function focusComposer(client: CDPClient): Promise<void> {
  const focused = await client.evaluate<{ ok: boolean; error?: string }>(`
    (() => {
      const visible = (el) => {
        const rect = el.getBoundingClientRect?.();
        return !rect || (rect.width > 0 && rect.height > 0);
      };
      const editables = Array.from(document.querySelectorAll('[contenteditable="true"]')).filter(visible);
      const textarea = Array.from(document.querySelectorAll('textarea')).filter(visible).pop();
      const composer = editables.length ? editables[editables.length - 1] : textarea;
      if (!composer) return { ok: false, error: 'composer_not_found' };
      composer.focus();
      return { ok: true };
    })()
  `);
  if (!focused.ok) throw new Error(focused.error || 'Could not focus composer');
}

function setClipboardFiles(files: string[]): void {
  if (process.platform !== 'darwin') {
    throw new Error('file paste fallback requires macOS');
  }
  const fileList = files
    .map((file) => `POSIX file ${JSON.stringify(file)}`)
    .join(', ');
  execFileSync('osascript', ['-e', `set the clipboard to {${fileList}}`], {
    stdio: 'ignore',
    timeout: 10_000,
  });
}

async function resolveImageInputs(values: string[], artifactDir?: string): Promise<string[]> {
  const out: string[] = [];
  const dir = artifactDir || join(tmpdir(), 'bnbot-codex-artifacts');
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
  if (!existsSync(path)) {
    throw new Error(`reference image not found: ${value}`);
  }
  return path;
}

function writeDataUrlImage(value: string, dir: string): string {
  const match = value.match(/^data:(image\/[^;]+);base64,(.+)$/);
  if (!match) throw new Error('invalid data URL reference image');
  mkdirSync(dir, { recursive: true });
  const ext = mimeToExt(match[1]);
  const path = join(dir, `codex-reference-${Date.now()}-${Math.random().toString(16).slice(2)}.${ext}`);
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
  const path = join(dir, `codex-reference-${Date.now()}-${Math.random().toString(16).slice(2)}.${ext}`);
  writeFileSync(path, bytes);
  return path;
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
  if (responseFormat === 'b64_json' && artifact.base64) {
    image.b64_json = artifact.base64;
  }
  return image;
}

function isRasterImageMime(mime: string): boolean {
  return /^image\/(?:png|jpe?g|webp|gif)$/i.test(mime);
}

function persistArtifacts(
  artifacts: ImageArtifact[],
  artifactDir?: string,
  inlineArtifacts = false,
): ImageArtifact[] {
  if (!artifacts.length) return artifacts;

  const dir = artifactDir || join(tmpdir(), 'bnbot-codex-artifacts');
  mkdirSync(dir, { recursive: true });

  return artifacts.map((artifact, index) => {
    const localPath = localPathFromArtifactSource(artifact.source);
    if (!artifact.base64 && localPath && existsSync(localPath)) {
      const stat = statSync(localPath);
      const fileArtifact: ImageArtifact = {
        index: artifact.index,
        type: 'file',
        source: artifact.source,
        path: localPath,
        mime: mimeFromPath(localPath),
        width: artifact.width,
        height: artifact.height,
        alt: artifact.alt,
        bytes: stat.size,
      };
      if (inlineArtifacts && stat.size <= MAX_ARTIFACT_BYTES) {
        fileArtifact.base64 = readFileSync(localPath).toString('base64');
      }
      return fileArtifact;
    }

    if (!artifact.base64) return artifact;

    const ext = mimeToExt(artifact.mime);
    const path = join(dir, `codex-artifact-${Date.now()}-${index + 1}.${ext}`);
    writeFileSync(path, Buffer.from(artifact.base64, 'base64'));

    if (inlineArtifacts) {
      return { ...artifact, path };
    }

    const { base64: _base64, ...withoutBase64 } = artifact;
    return { ...withoutBase64, path };
  });
}

function filterNewArtifacts(artifacts: ImageArtifact[], beforeSources: Set<string>): ImageArtifact[] {
  return artifacts.filter((artifact) => !beforeSources.has(artifact.source));
}

function renumberArtifacts(artifacts: ImageArtifact[]): ImageArtifact[] {
  return artifacts.map((artifact, index) => ({ ...artifact, index: index + 1 }));
}

function dedupeArtifacts(artifacts: ImageArtifact[]): ImageArtifact[] {
  const seen = new Set<string>();
  const indexByKey = new Map<string, number>();
  const out: ImageArtifact[] = [];
  for (const artifact of artifacts) {
    const key = artifact.path || localPathFromArtifactSource(artifact.source) || artifact.source;
    if (key && seen.has(key)) {
      const index = indexByKey.get(key);
      if (index !== undefined) {
        const existing = out[index];
        out[index] = {
          ...existing,
          width: existing.width ?? artifact.width,
          height: existing.height ?? artifact.height,
          alt: existing.alt ?? artifact.alt,
          bytes: existing.bytes ?? artifact.bytes,
          base64: existing.base64 ?? artifact.base64,
          path: existing.path ?? artifact.path,
        };
      }
      continue;
    }
    if (key) {
      seen.add(key);
      indexByKey.set(key, out.length);
    }
    out.push(artifact);
  }
  return out;
}

function historyScript(): string {
  return `
    (() => {
      const clean = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
      const projectRows = Array.from(document.querySelectorAll('[data-app-action-sidebar-project-row]'));
      return projectRows.map((projectRow, projectIndex) => {
        const project = projectRow.getAttribute('data-app-action-sidebar-project-label') ||
          projectRow.getAttribute('aria-label') ||
          clean(projectRow.innerText || projectRow.textContent || '');
        const projectPath = projectRow.getAttribute('data-app-action-sidebar-project-id') || '';
        const item = projectRow.closest('[role="listitem"][aria-label]') || projectRow.parentElement || document;
        const threadRows = Array.from(item.querySelectorAll('[data-app-action-sidebar-thread-row]'));
        return {
          index: projectIndex + 1,
          project,
          projectPath,
          collapsed: projectRow.getAttribute('data-app-action-sidebar-project-collapsed') === 'true' ||
            projectRow.getAttribute('aria-expanded') === 'false',
          conversations: threadRows.map((row, index) => ({
            index: index + 1,
            title: row.getAttribute('data-app-action-sidebar-thread-title') ||
              clean(row.innerText || row.textContent || ''),
            active: row.getAttribute('data-app-action-sidebar-thread-active') === 'true',
            pinned: row.getAttribute('data-app-action-sidebar-thread-pinned') === 'true',
            threadId: row.getAttribute('data-app-action-sidebar-thread-id') || '',
            kind: row.getAttribute('data-app-action-sidebar-thread-kind') || ''
          }))
        };
      });
    })()
  `;
}

function flattenHistory(projects: unknown[], options: CodexHistoryOptions): unknown[] {
  const limit = parseLimit(options.limit, 10);
  const projectFilter = normalizeText(options.project);

  return projects.flatMap((rawProject) => {
    const project = rawProject as {
      project?: string;
      projectPath?: string;
      collapsed?: boolean;
      conversations?: Array<{
        index: number;
        title: string;
        active?: boolean;
        pinned?: boolean;
        threadId?: string;
        kind?: string;
      }>;
    };
    const label = project.project || '';
    const path = project.projectPath || '';
    if (projectFilter && !normalizeText(`${label} ${path}`).includes(projectFilter)) {
      return [];
    }

    const conversations = (project.conversations || []).slice(0, limit);
    if (!conversations.length) {
      return [{
        project: label,
        projectPath: path,
        index: 0,
        title: project.collapsed ? '(collapsed)' : '(no visible conversations)',
        active: false,
        pinned: false,
        threadId: '',
        kind: '',
      }];
    }

    return conversations.map((conversation) => ({
      project: label,
      projectPath: path,
      index: conversation.index,
      title: conversation.title,
      active: conversation.active === true,
      pinned: conversation.pinned === true,
      threadId: conversation.threadId || '',
      kind: conversation.kind || '',
    }));
  });
}

function modelScript(modelName: string | undefined): string {
  return `
    (() => {
      const clean = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
      const candidates = Array.from(document.querySelectorAll('button, [role="button"], [title], [aria-label]'));
      const modelNode = candidates.find((node) => {
        const text = clean(node.innerText || node.textContent || node.getAttribute('title') || node.getAttribute('aria-label') || '');
        return /model|gpt|o[0-9]|claude|extra\\s+high|\\b\\d+(?:\\.\\d+)?\\b.*\\b(?:low|medium|high)\\b/i.test(text);
      });

      const current = modelNode
        ? clean(modelNode.innerText || modelNode.textContent || modelNode.getAttribute('title') || modelNode.getAttribute('aria-label') || '')
        : 'Unknown';

      const desired = ${JSON.stringify(modelName || '')};
      if (!desired) {
        return { status: modelNode ? 'read' : 'not_found', current };
      }

      if (!modelNode) {
        return { status: 'model_picker_not_found', current };
      }

      modelNode.click();
      return { status: 'opened_picker_generic', current };
    })()
  `;
}

function readEndpointOverride(): string | null {
  return normalizeEndpoint(
    process.env.BNBOT_CODEX_CDP_ENDPOINT ||
    process.env.CODEX_CDP_ENDPOINT ||
    process.env.OPENCLI_CDP_ENDPOINT,
  );
}

function normalizeEndpoint(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed || null;
}

function summarizeTarget(target: CDPTarget): Record<string, unknown> {
  return {
    id: target.id || null,
    type: target.type || null,
    title: target.title || '',
    url: target.url || '',
  };
}

async function readTextArgument(textArg: string): Promise<string> {
  if (textArg !== '-') return textArg;

  return new Promise<string>((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

function parsePort(value: string | undefined): number {
  const port = Number.parseInt(value || String(DEFAULT_CODEX_PORT), 10);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid Codex CDP port: ${value}`);
  }
  return port;
}

function parseLimit(value: string | undefined, fallback: number): number {
  const limit = Number.parseInt(value || String(fallback), 10);
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error(`Invalid limit: ${value}`);
  }
  return limit;
}

function parseTimeoutMs(value: string | undefined, fallbackMs: number): number {
  const seconds = Number.parseInt(value || String(Math.ceil(fallbackMs / 1000)), 10);
  if (!Number.isInteger(seconds) || seconds < 1) {
    throw new Error(`Invalid timeout seconds: ${value}`);
  }
  return seconds * 1000;
}

function normalizeText(value: string | undefined): string {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function mimeToExt(mime: string): string {
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('gif')) return 'gif';
  if (mime.includes('svg')) return 'svg';
  return 'png';
}

function mimeFromPath(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  return 'image/png';
}

function localPathFromArtifactSource(source: string): string | null {
  if (source.startsWith('app://fs/@fs/')) {
    return `/${decodeURIComponent(source.slice('app://fs/@fs/'.length))}`;
  }
  if (source.startsWith('file://')) {
    try {
      return decodeURIComponent(new URL(source).pathname);
    } catch {
      return null;
    }
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
