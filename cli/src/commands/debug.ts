/**
 * `bnbot x debug eval` — run JS in a scraper pool tab via extension CDP.
 *
 * Dev helper. Useful for probing DOM selectors on new platforms
 * (XHS publish, Bilibili creator, etc.) without writing one-off
 * action handlers. The expression runs via `Runtime.evaluate` so it
 * must return a JSON-serializable value.
 *
 * Examples:
 *   bnbot x debug eval 'document.title'
 *   bnbot x debug eval 'document.querySelector(".publish-btn")?.textContent'
 *   bnbot x debug eval --host creator.xiaohongshu.com \
 *     '[...document.querySelectorAll("[class*=publish]")].map(e => e.className)'
 */
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { ensureServer } from '../cli';

const DEFAULT_PORT = 18900;
const TIMEOUT_MS = 60_000;

interface EvalArgs {
  tabId?: string;
  host?: string;
  awaitPromise?: boolean;
}

export async function debugEvalCommand(expression: string, opts: EvalArgs): Promise<void> {
  const payload: Record<string, unknown> = { expression };
  if (opts.tabId) payload.tabId = Number.parseInt(opts.tabId, 10);
  if (opts.host) payload.targetHost = opts.host;
  if (opts.awaitPromise) payload.awaitPromise = true;

  await ensureServer(DEFAULT_PORT);
  const result = await sendAction('debug_eval', payload);
  console.log(JSON.stringify(result, null, 2));
}

interface UploadArgs {
  tabId?: string;
  host?: string;
}

export async function debugUploadCommand(
  selector: string,
  files: string[],
  opts: UploadArgs,
): Promise<void> {
  if (!files || files.length === 0) {
    console.error('Usage: bnbot debug upload <selector> <file> [file2 ...]');
    process.exit(2);
  }
  const payload: Record<string, unknown> = { selector, files };
  if (opts.tabId) payload.tabId = Number.parseInt(opts.tabId, 10);
  if (opts.host) payload.targetHost = opts.host;

  await ensureServer(DEFAULT_PORT);
  const result = await sendAction('debug_set_files', payload);
  console.log(JSON.stringify(result, null, 2));
}

interface ClickArgs {
  tabId?: string;
  host?: string;
}

export async function debugClickCommand(selector: string, opts: ClickArgs): Promise<void> {
  const payload: Record<string, unknown> = { selector };
  if (opts.tabId) payload.tabId = Number.parseInt(opts.tabId, 10);
  if (opts.host) payload.targetHost = opts.host;

  await ensureServer(DEFAULT_PORT);
  const result = await sendAction('debug_click', payload);
  console.log(JSON.stringify(result, null, 2));
}

interface ShowArgs {
  tabId?: string;
  host?: string;
}

export async function debugShowCommand(opts: ShowArgs): Promise<void> {
  const payload: Record<string, unknown> = {};
  if (opts.tabId) payload.tabId = Number.parseInt(opts.tabId, 10);
  if (opts.host) payload.targetHost = opts.host;

  await ensureServer(DEFAULT_PORT);
  const result = await sendAction('debug_show_window', payload);
  console.log(JSON.stringify(result, null, 2));
}

interface DragArgs {
  tabId?: string;
  host?: string;
  steps?: string;
}

export async function debugDragCommand(
  fromSelector: string,
  toSelector: string,
  opts: DragArgs,
): Promise<void> {
  const payload: Record<string, unknown> = { fromSelector, toSelector };
  if (opts.tabId) payload.tabId = Number.parseInt(opts.tabId, 10);
  if (opts.host) payload.targetHost = opts.host;
  if (opts.steps) payload.steps = Number.parseInt(opts.steps, 10);

  await ensureServer(DEFAULT_PORT);
  const result = await sendAction('debug_drag', payload);
  console.log(JSON.stringify(result, null, 2));
}

interface RecordArgs {
  duration?: string;
  out?: string;
  host?: string;
  tabId?: string;
  filter?: string;
  scroll?: boolean;
}

/**
 * `bnbot debug record <url>` — mirror a third-party site's API calls.
 *
 * Injects a persistent fetch/XHR interceptor via CDP
 * `Page.addScriptToEvaluateOnNewDocument`, navigates, waits, optionally
 * auto-scrolls to trigger lazy-load, then dumps everything to JSON.
 *
 * Typical use: research other creator-tool SaaS by mirroring their
 * internal API shape.
 */
export async function debugRecordCommand(url: string, opts: RecordArgs): Promise<void> {
  const { writeFileSync } = await import('node:fs');
  const duration = Number.parseFloat(opts.duration || '20') * 1000;
  await ensureServer(DEFAULT_PORT);

  // 1. First navigate to target so we have a pool tab on the right host.
  //    addScriptToEvaluateOnNewDocument fires for SUBSEQUENT navigations,
  //    not the one in flight, so we need two nav steps: nav → hook → nav.
  await sendAction('navigate_to_url', { url });

  // 2. Start recording (injects interceptor as Page.addScript... for the
  //    next document load).
  const startPayload: Record<string, unknown> = { filterPattern: opts.filter };
  if (opts.tabId) startPayload.tabId = Number.parseInt(opts.tabId, 10);
  if (opts.host) startPayload.targetHost = opts.host;
  await sendAction('debug_record_start', startPayload);

  // 3. Reload so interceptor catches the first-screen API calls too.
  await sendAction('debug_eval', { expression: 'location.reload(); "reloading"' });

  const deadline = Date.now() + duration;
  const tick = 1500;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, tick));
    if (opts.scroll) {
      // Gentle scroll to trigger lazy-load feeds. Ignore errors —
      // some pages scroll a nested container not window.
      await sendAction('debug_eval', {
        expression: `window.scrollBy({top: window.innerHeight * 0.8, behavior: 'instant'})`,
      }).catch(() => null);
    }
  }

  // 3. Dump buffer.
  const dumpPayload: Record<string, unknown> = { clear: true };
  if (opts.tabId) dumpPayload.tabId = Number.parseInt(opts.tabId, 10);
  if (opts.host) dumpPayload.targetHost = opts.host;
  const result = await sendAction('debug_record_dump', dumpPayload);

  // 4. Write to file or stdout.
  const json = JSON.stringify(result, null, 2);
  if (opts.out) {
    writeFileSync(opts.out, json);
    const count = Array.isArray(result) ? result.length : 0;
    console.log(`wrote ${count} captures to ${opts.out}`);
  } else {
    console.log(json);
  }
}

function sendAction(actionType: string, payload: Record<string, unknown>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${DEFAULT_PORT}`);
    const requestId = randomUUID();
    let done = false;

    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      ws.close();
      reject(new Error(`${actionType} timed out after ${TIMEOUT_MS / 1000}s`));
    }, TIMEOUT_MS);

    ws.on('open', () => {
      ws.send(
        JSON.stringify({
          type: 'cli_action',
          requestId,
          actionType,
          actionPayload: payload,
        }),
      );
    });

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.requestId !== requestId || msg.type !== 'action_result') return;
        clearTimeout(timer);
        done = true;
        ws.close();
        if (!msg.success) {
          reject(new Error(msg.error || `${actionType} failed`));
          return;
        }
        resolve(msg.data);
      } catch (err) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        ws.close();
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });

    ws.on('error', (err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      reject(err);
    });

    ws.on('close', () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      reject(new Error(`WS closed before ${actionType} result`));
    });
  });
}
