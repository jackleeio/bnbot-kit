/**
 * `bnbot screenshot` — capture a PNG of any Chrome tab via CDP.
 *
 * Selection order (first non-null wins):
 *   - `--tab-id <n>` — explicit chrome tab id
 *   - `--url <url>` — find existing tab by URL prefix, or open one
 *   - (none)        — capture the currently focused tab
 *
 * Default output path is `/tmp/bnbot-screenshot-<ts>.png`. Pass
 * `--output -` to emit the base64 PNG to stdout instead of a file
 * (useful for piping into `base64 -d > ...` or embedding elsewhere).
 *
 * This command implements its own WS call instead of going through
 * `runCliAction` because the latter console.logs the full response —
 * and a base64 PNG in stdout is basically unusable for humans.
 */
import { writeFileSync } from 'fs';
import { randomUUID } from 'crypto';
import WebSocket from 'ws';
import { ensureServer } from '../cli';

const DEFAULT_PORT = 18900;
const getPort = (): number => DEFAULT_PORT;

interface ScreenshotArgs {
  url?: string;
  tabId?: string;
  output?: string;
  fullPage?: boolean;
}

interface ScreenshotResponse {
  base64: string;
  tabId: number;
  url: string;
  title: string;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export async function screenshotCommand(opts: ScreenshotArgs): Promise<void> {
  const payload: Record<string, unknown> = {};
  if (opts.url) payload.url = opts.url;
  if (opts.tabId) payload.tabId = Number.parseInt(opts.tabId, 10);
  if (opts.fullPage) payload.fullPage = true;

  const port = getPort();
  await ensureServer(port);

  const result = await sendScreenshotRequest(payload, port);

  const outPath = opts.output || `/tmp/bnbot-screenshot-${Date.now()}.png`;

  if (outPath === '-') {
    process.stdout.write(result.base64);
    process.stdout.write('\n');
    return;
  }

  const buf = Buffer.from(result.base64, 'base64');
  writeFileSync(outPath, buf);
  console.log(
    JSON.stringify(
      {
        success: true,
        path: outPath,
        bytes: buf.length,
        tabId: result.tabId,
        url: result.url,
        title: result.title,
      },
      null,
      2,
    ),
  );
}

function sendScreenshotRequest(
  payload: Record<string, unknown>,
  port: number,
): Promise<ScreenshotResponse> {
  return new Promise<ScreenshotResponse>((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const requestId = randomUUID();
    let resolved = false;

    const timeout = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      ws.close();
      reject(new Error(`screenshot timed out after ${DEFAULT_TIMEOUT_MS / 1000}s`));
    }, DEFAULT_TIMEOUT_MS);

    ws.on('open', () => {
      ws.send(
        JSON.stringify({
          type: 'cli_action',
          requestId,
          actionType: 'screenshot',
          actionPayload: payload,
        }),
      );
    });

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.requestId !== requestId || msg.type !== 'action_result') return;
        clearTimeout(timeout);
        resolved = true;
        ws.close();
        if (!msg.success) {
          reject(new Error(msg.error || 'screenshot failed'));
          return;
        }
        const data = msg.data as ScreenshotResponse | undefined;
        if (!data?.base64) {
          reject(new Error('screenshot returned no base64 data'));
          return;
        }
        resolve(data);
      } catch (err) {
        if (resolved) return;
        resolved = true;
        clearTimeout(timeout);
        ws.close();
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });

    ws.on('error', (err) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      reject(err);
    });

    ws.on('close', () => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      reject(new Error('WS closed before screenshot result received'));
    });
  });
}
