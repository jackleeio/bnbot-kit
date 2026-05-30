/**
 * Local WebSocket Server
 * Listens on localhost for BNBOT Chrome Extension connections and CLI client connections.
 * Provides request-response matching for action execution.
 *
 * Connection types:
 * - Extension: sends status/heartbeat messages, receives action requests
 * - CLI client: sends cli_action messages, receives action_result relayed from extension
 */

import { WebSocketServer, WebSocket } from 'ws';
import { createServer, type Server as HttpServer } from 'http';
import { randomUUID } from 'crypto';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { ActionRequest, ActionResult, IncomingMessage } from './types.js';

const DEFAULT_PORT = 18900;
const DEFAULT_TIMEOUT = 60000; // 60s default
const BUSY_RETRY_DELAY = 3000;
const MAX_BUSY_RETRIES = 10;
const BACKGROUND_LOCAL_ACTIONS_FEATURE = 'background_local_actions';

function compareVersions(a: string | null | undefined, b: string | null | undefined): number {
  const parse = (value: string | null | undefined): number[] =>
    String(value || '')
      .split('.')
      .map((part) => Number.parseInt(part, 10))
      .map((part) => (Number.isFinite(part) ? part : 0));
  const aa = parse(a);
  const bb = parse(b);
  const len = Math.max(aa.length, bb.length);
  for (let i = 0; i < len; i += 1) {
    const delta = (aa[i] || 0) - (bb[i] || 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

function hasFeature(features: readonly string[] | null | undefined, feature: string): boolean {
  return Array.isArray(features) && features.includes(feature);
}

/**
 * Maximum number of actions in flight to the extension at any one moment.
 * Set via `BNBOT_MAX_CONCURRENT` env var; default 3.
 *
 * Why a cap: each in-flight action attaches a CDP debugger session and
 * may hold an entire browser tab busy. With unlimited concurrency a
 * runaway client could spawn 50 image-generation tabs and OOM Chrome.
 * 3 is the default ceiling we use for ClawMoney image-generation orders:
 * it leaves Chrome/CDP stable while still allowing real parallel work.
 */
const MAX_CONCURRENT_ACTIONS = (() => {
  const raw = Number.parseInt(process.env.BNBOT_MAX_CONCURRENT || '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 3;
})();

/**
 * Best-effort extraction of the "routing key" we use to serialize
 * conflicting actions. Tabs are the real resource (one Slate composer,
 * one CDP debugger attach point), so a tabId — if the caller knows
 * it — is strictly more precise than a host. Fallback chain:
 *
 *   1. explicit `tabId` (most precise — same tab → same queue)
 *   2. explicit `targetHost` (legacy callers + commands that don't
 *      manage their own tab; protects against same-host action
 *      cross-talk on the shared pool tab)
 *   3. `url` field (navigate_to_url, openUrl-shaped payloads)
 *   4. null — uncoordinated; bypass serialization (e.g. screenshot of
 *      whatever tab is focused, status pings, …).
 *
 * Commands that want true cross-task parallelism for the same site
 * (multiple flow video-generates etc.) should spawn their own tab,
 * pin to its tabId, and pass that tabId on every subsequent action.
 */
function inferRoutingKey(payload: Record<string, unknown> | undefined): string | null {
  if (!payload) return null;
  const tabId = payload.tabId;
  if (typeof tabId === 'number' && Number.isFinite(tabId)) return `tab:${tabId}`;
  if (typeof tabId === 'string' && tabId.trim()) return `tab:${tabId.trim()}`;
  const explicit = payload.targetHost;
  if (typeof explicit === 'string' && explicit.trim()) return `host:${explicit.trim().toLowerCase()}`;
  const url = payload.url;
  if (typeof url === 'string' && url.trim()) {
    try {
      return `host:${new URL(url).hostname.toLowerCase()}`;
    } catch {
      /* not a parseable URL */
    }
  }
  return null;
}

interface PendingRequest {
  resolve: (result: ActionResult) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

/** Tracks a CLI client waiting for a response */
interface CliPending {
  ws: WebSocket;
  originalRequestId: string;
  timer: NodeJS.Timeout;
}

export class BnbotWsServer {
  private wss: WebSocketServer | null = null;
  private httpServer: HttpServer | null = null;
  private client: WebSocket | null = null;
  private pendingRequests: Map<string, PendingRequest> = new Map();
  /** CLI client requests: maps internal requestId -> CLI client info */
  private cliPending: Map<string, CliPending> = new Map();
  /**
   * Per-routing-key serialization. Two actions targeting the same tab
   * (or, when no tabId is known, the same host) cannot safely run
   * concurrently — they share a Slate composer, a CDP debugger
   * session, a "submit" button. We queue per routing key so different
   * keys run in parallel while same-key tasks line up.
   *
   * Routing key format: "tab:<id>" or "host:<hostname>" (see
   * inferRoutingKey).
   */
  private routeQueues: Map<string, Array<() => void>> = new Map();
  private routeRunning: Set<string> = new Set();
  /** internalId -> routing key, so resolve/reject/timeout can advance the right queue */
  private routeByInternalId: Map<string, string> = new Map();
  /** Global in-flight counter (across all routes). Capped at MAX_CONCURRENT_ACTIONS. */
  private globalInFlight = 0;
  /** Actions waiting for a global slot — already acquired their route slot. */
  private globalWaitQueue: Array<() => void> = [];
  /**
   * Wall-clock of the last time we replaced an OPEN extension connection.
   * Used to detect & reject Chrome service-worker reconnect storms where
   * two live SW instances duel over the same ws slot.
   */
  private lastReplacementAt = 0;
  private extensionVersion: string | null = null;
  private extensionFeatures: string[] = [];
  private port: number;
  private autoLoginDone: boolean = false;

  constructor(port?: number) {
    this.port = port || DEFAULT_PORT;
  }

  /**
   * Start the WebSocket + HTTP server.
   *
   * Both protocols share a single http.Server on the same port: WS
   * handles `Upgrade` requests (existing extension + CLI clients), HTTP
   * answers `GET /health` for liveness probes (`curl http://...:18900/health`).
   *
   * Why share the port: external tools (web.tsx auto-spawn, the agent's
   * `curl /health` probe in the system prompt) need a way to ask "is
   * the daemon up *and* is the extension connected?" without speaking
   * WS handshake. Adding a sibling HTTP listener avoids the previous
   * bug where probes timed out against a WS-only port and concluded
   * the daemon was offline even when it was running fine.
   */
  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.httpServer = createServer((req, res) => {
        if (req.method === 'GET' && (req.url === '/health' || req.url === '/healthz')) {
          const info = this.getExtensionInfo();
          const authStatus = this.getAuthStatus();
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Cache-Control', 'no-store');
          res.end(
            JSON.stringify({
              ok: info.connected && authStatus.valid,
              port: this.port,
              extensionConnected: info.connected,
              extensionVersion: info.version,
              authValid: authStatus.valid,
              authExpiry: authStatus.expiry,
              authEmail: authStatus.email,
            }),
          );
          return;
        }

        if (req.method === 'GET' && req.url === '/auth/status') {
          const authStatus = this.getAuthStatus();
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Cache-Control', 'no-store');
          res.end(JSON.stringify(authStatus));
          return;
        }
        res.statusCode = 404;
        res.setHeader('Content-Type', 'text/plain');
        res.end('Not Found. WS clients should use ws://; probes use GET /health.');
      });

      this.wss = new WebSocketServer({ server: this.httpServer });

      this.httpServer.on('listening', () => {
        console.error(`[BNBOT] WS + HTTP server listening on http://127.0.0.1:${this.port} (ws + GET /health)`);
        resolve();
      });

      this.httpServer.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'EADDRINUSE') {
          console.error(`[BNBOT] Port ${this.port} is already in use. Continuing without WebSocket server (public API tools still work).`);
          this.wss = null;
          this.httpServer = null;
          resolve(); // non-fatal: tools that don't need extension still work
        } else {
          reject(error);
        }
      });

      this.httpServer.listen(this.port, '127.0.0.1');

      this.wss.on('connection', (ws) => {
        // We don't know yet if this is an extension or a CLI client.
        // We'll determine based on the first message received.
        let identified = false;

        ws.on('message', (data) => {
          try {
            const message = JSON.parse(data.toString());

            // CLI client sends cli_action messages
            if (message.type === 'cli_action') {
              identified = true;
              this.handleCliAction(ws, message);
              return;
            }

            // If not yet identified as CLI client, this must be the extension
            if (!identified) {
              identified = true;
              const accepted = this.handleExtensionConnect(
                ws,
                message.type === 'status' ? message.version : null,
                message.type === 'status' ? message.features : undefined,
              );
              if (!accepted) return;
            }

            this.handleMessage(message as IncomingMessage, ws);
          } catch (err) {
            console.error('[BNBOT] Failed to parse message:', err);
          }
        });

        ws.on('close', () => {
          // If this was the extension, clean up
          if (this.client === ws) {
            console.error('[BNBOT] Extension disconnected');
            this.client = null;
            this.extensionVersion = null;
            this.extensionFeatures = [];
            this.autoLoginDone = false;
            // Reject all pending requests
            for (const [id, pending] of this.pendingRequests) {
              clearTimeout(pending.timer);
              pending.reject(new Error('Extension disconnected'));
              this.pendingRequests.delete(id);
            }
            // Drop all queued actions — they would never get a chance to run
            // since their route slot is held by a dead request. Best to fail
            // them fast so callers see the disconnect immediately.
            for (const q of this.routeQueues.values()) {
              for (const run of q) {
                try { run(); } catch { /* doForward will surface the disconnect error to the CLI */ }
              }
            }
            for (const run of this.globalWaitQueue) {
              try { run(); } catch { /* same */ }
            }
            this.routeQueues.clear();
            this.routeRunning.clear();
            this.routeByInternalId.clear();
            this.globalWaitQueue = [];
            this.globalInFlight = 0;
            // Send error to all pending CLI requests
            for (const [id, cliReq] of this.cliPending) {
              clearTimeout(cliReq.timer);
              if (cliReq.ws.readyState === WebSocket.OPEN) {
                cliReq.ws.send(JSON.stringify({
                  type: 'action_result',
                  requestId: cliReq.originalRequestId,
                  success: false,
                  error: 'Extension disconnected',
                }));
              }
              this.cliPending.delete(id);
            }
          }
          // If it was a CLI client, clean up any pending requests from it
          for (const [id, cliReq] of this.cliPending) {
            if (cliReq.ws === ws) {
              clearTimeout(cliReq.timer);
              this.pendingRequests.delete(id);
              this.cliPending.delete(id);
            }
          }
        });

        ws.on('error', (err) => {
          console.error('[BNBOT] WebSocket error:', err.message);
        });

        // If the first message is a status/heartbeat (extension), we need to identify
        // proactively. Give a short grace period, then assume extension if still unidentified.
        // Actually, extension connections typically send status immediately.
        // CLI clients send cli_action immediately.
        // So the message-based identification above should work fine.
      });
    });
  }

  /**
   * Handle when a WebSocket is identified as the extension
   */
  private handleExtensionConnect(
    ws: WebSocket,
    reportedVersion?: string | null,
    reportedFeatures?: string[],
  ): boolean {
    const featureText = reportedFeatures?.length ? ` features=${reportedFeatures.join(',')}` : '';
    console.error(`[BNBOT] Extension connected${reportedVersion ? ` v${reportedVersion}` : ''}${featureText}`);

    // Defense against a Chrome service-worker / extension reload race that
    // can leave two live SW instances connecting to us simultaneously:
    // server replaces → old SW reconnects → server replaces again → loop.
    // If we already have an OPEN client AND we replaced it very recently,
    // the new connection is almost certainly the losing SW in that race —
    // reject it so it backs off instead of stomping on the good session.
    const wasReplacement = this.client && this.client.readyState === WebSocket.OPEN;
    if (wasReplacement) {
      const now = Date.now();
      const sinceLast = now - this.lastReplacementAt;
      const currentHasBackgroundLocal = hasFeature(this.extensionFeatures, BACKGROUND_LOCAL_ACTIONS_FEATURE);
      const nextHasBackgroundLocal = hasFeature(reportedFeatures, BACKGROUND_LOCAL_ACTIONS_FEATURE);
      const versionCmp = compareVersions(reportedVersion, this.extensionVersion);
      if (currentHasBackgroundLocal && !nextHasBackgroundLocal) {
        console.error(`[BNBOT] Rejecting stale extension connection v${reportedVersion || 'unknown'} (active connection has ${BACKGROUND_LOCAL_ACTIONS_FEATURE})`);
        try { ws.close(4028, 'Stale extension connection; newer feature-capable connection is active'); } catch { /* ignore */ }
        return false;
      }
      if (this.extensionVersion && reportedVersion && versionCmp < 0) {
        console.error(`[BNBOT] Rejecting older extension connection v${reportedVersion}; active is v${this.extensionVersion}`);
        try { ws.close(4028, 'Older extension connection rejected'); } catch { /* ignore */ }
        return false;
      }
      const shouldPreferNew =
        (!currentHasBackgroundLocal && nextHasBackgroundLocal)
        || (!!this.extensionVersion && !!reportedVersion && versionCmp > 0);
      if (!shouldPreferNew && sinceLast < 10_000) {
        console.error(`[BNBOT] Rejecting duplicate extension connection (last replacement only ${sinceLast}ms ago — looks like a reconnect race)`);
        try { ws.close(4029, 'Active extension connection already exists; back off'); } catch { /* ignore */ }
        return false;
      }
      console.error(shouldPreferNew
        ? '[BNBOT] Replacing existing extension connection with newer/capable connection'
        : '[BNBOT] Replacing existing extension connection');
      this.lastReplacementAt = now;
      this.client!.close(1000, 'Replaced by new connection');
    } else {
      this.lastReplacementAt = Date.now();
    }

    // Fail any in-flight requests dispatched to the OLD extension — they
    // will never be answered now. Without this, CLI clients waiting on
    // them see silent WS closes (no error message) and exit 0 with no
    // output ("silent-close bug"), causing scheduled wrappers to think
    // the action succeeded when it did not.
    if (this.pendingRequests.size > 0) {
      console.error(`[BNBOT] Failing ${this.pendingRequests.size} stale pending request(s) from previous extension session`);
      for (const [id, pending] of this.pendingRequests) {
        clearTimeout(pending.timer);
        const cliReq = this.cliPending.get(id);
        if (cliReq) {
          clearTimeout(cliReq.timer);
          this.cliPending.delete(id);
          if (cliReq.ws.readyState === WebSocket.OPEN) {
            cliReq.ws.send(JSON.stringify({
              type: 'action_result',
              requestId: cliReq.originalRequestId,
              success: false,
              error: 'Extension reconnected mid-request; please retry',
            }));
          }
        }
        pending.reject(new Error('Extension reconnected'));
      }
      this.pendingRequests.clear();
    }

    this.client = ws;
    this.extensionVersion = reportedVersion ?? this.extensionVersion;
    this.extensionFeatures = reportedFeatures ?? [];

    // Auto-login: if clawmoney API key exists, inject auth tokens
    this.tryAutoLogin();
    return true;
  }

  /**
   * Try to auto-login the extension using clawmoney API key.
   * Reads ~/.clawmoney/config.yaml, calls backend to get user tokens,
   * and sends inject_auth_tokens to the extension.
   */
  private async tryAutoLogin(): Promise<void> {
    const configPath = join(homedir(), '.clawmoney', 'config.yaml');
    if (!existsSync(configPath)) return;

    try {
      const content = readFileSync(configPath, 'utf-8');
      const match = content.match(/^api_key:\s*(.+)$/m);
      const apiKey = match?.[1]?.trim().replace(/^['"]|['"]$/g, '');
      if (!apiKey) return;

      console.error('[BNBOT] Found clawmoney API key, auto-logging in...');

      const API_BASE = 'https://api.bnbot.ai';
      const res = await fetch(`${API_BASE}/api/v1/claw-agents/auth/login-extension`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
      });

      if (!res.ok) {
        console.error(`[BNBOT] Auto-login failed: HTTP ${res.status}`);
        return;
      }

      const data = await res.json() as {
        access_token: string;
        refresh_token: string;
        user: { email: string };
      };

      // Send tokens to extension
      const requestId = randomUUID();
      const request: ActionRequest = {
        type: 'action',
        requestId,
        actionType: 'inject_auth_tokens',
        actionPayload: {
          access_token: data.access_token,
          refresh_token: data.refresh_token,
          user: data.user,
        },
      };

      if (this.client && this.client.readyState === WebSocket.OPEN) {
        this.client.send(JSON.stringify(request));
        this.autoLoginDone = true;
        console.error(`[BNBOT] Auto-login: tokens sent to extension (${data.user.email})`);
      }
    } catch (err) {
      console.error('[BNBOT] Auto-login error:', (err as Error).message);
    }
  }

  /**
   * Handle a cli_action message from a CLI client.
   * Forward it to the extension and relay the result back.
   */
  private async handleCliAction(
    cliWs: WebSocket,
    message: { type: string; requestId: string; actionType: string; actionPayload: Record<string, unknown> }
  ): Promise<void> {
    const originalRequestId = message.requestId;

    // Special case: get_extension_status doesn't need the extension
    if (message.actionType === 'get_extension_status') {
      const info = this.getExtensionInfo();
      cliWs.send(JSON.stringify({
        type: 'action_result',
        requestId: originalRequestId,
        success: true,
        data: {
          connected: info.connected,
          extensionVersion: info.version,
          wsPort: this.port,
        },
      }));
      return;
    }

    if (!this.client || this.client.readyState !== WebSocket.OPEN) {
      cliWs.send(JSON.stringify({
        type: 'action_result',
        requestId: originalRequestId,
        success: false,
        error: 'Extension not connected. Make sure BNBOT extension is running and OpenClaw integration is enabled in settings.',
      }));
      return;
    }

    // Ensure extension is logged in before executing actions
    if (!this.autoLoginDone && message.actionType !== 'inject_auth_tokens') {
      await this.tryAutoLogin();
    }

    // Generate a new internal requestId to track this through the extension
    const internalId = randomUUID();
    const request: ActionRequest = {
      type: 'action',
      requestId: internalId,
      actionType: message.actionType,
      actionPayload: message.actionPayload,
    };

    const routeKey = inferRoutingKey(message.actionPayload);

    // Set up timeout — CDP write actions with potential media (video
    // transcode can take >60s) get a longer budget than the default.
    const isDebuggerWrite = message.actionType.endsWith('_debugger');
    const isLongRunning = isDebuggerWrite || message.actionType === 'xhs_post';
    const effectiveTimeout = isLongRunning ? 240_000 : DEFAULT_TIMEOUT;
    const timer = setTimeout(() => {
      this.pendingRequests.delete(internalId);
      this.cliPending.delete(internalId);
      this.advanceRouteQueue(internalId);
      if (cliWs.readyState === WebSocket.OPEN) {
        cliWs.send(JSON.stringify({
          type: 'action_result',
          requestId: originalRequestId,
          success: false,
          error: `Action '${message.actionType}' timed out after ${effectiveTimeout / 1000}s`,
        }));
      }
    }, effectiveTimeout);

    // Track the CLI request
    this.cliPending.set(internalId, { ws: cliWs, originalRequestId, timer });

    // Set up pending request handler that relays to CLI client
    this.pendingRequests.set(internalId, {
      resolve: (result: ActionResult) => {
        const cliReq = this.cliPending.get(internalId);
        if (cliReq) {
          clearTimeout(cliReq.timer);
          this.cliPending.delete(internalId);
          if (cliReq.ws.readyState === WebSocket.OPEN) {
            cliReq.ws.send(JSON.stringify({
              type: 'action_result',
              requestId: cliReq.originalRequestId,
              success: result.success,
              data: result.data,
              error: result.error,
            }));
          }
        }
        this.advanceRouteQueue(internalId);
      },
      reject: (error: Error) => {
        const cliReq = this.cliPending.get(internalId);
        if (cliReq) {
          clearTimeout(cliReq.timer);
          this.cliPending.delete(internalId);
          if (cliReq.ws.readyState === WebSocket.OPEN) {
            cliReq.ws.send(JSON.stringify({
              type: 'action_result',
              requestId: cliReq.originalRequestId,
              success: false,
              error: error.message,
            }));
          }
        }
        this.advanceRouteQueue(internalId);
      },
      timer,
    });

    // Actual forward — runs immediately if its host is idle, or when
    // the queue head advances to it.
    const doForward = () => {
      if (!this.client || this.client.readyState !== WebSocket.OPEN) {
        clearTimeout(timer);
        this.pendingRequests.delete(internalId);
        this.cliPending.delete(internalId);
        this.advanceRouteQueue(internalId);
        if (cliWs.readyState === WebSocket.OPEN) {
          cliWs.send(JSON.stringify({
            type: 'action_result',
            requestId: originalRequestId,
            success: false,
            error: 'Extension disconnected before forward',
          }));
        }
        return;
      }
      try {
        console.log(`[BNBOT] Forward to extension: ${message.actionType} id=${internalId.slice(0, 8)}${routeKey ? ` route=${routeKey}` : ''}`);
        this.client.send(JSON.stringify(request));
      } catch (err) {
        clearTimeout(timer);
        this.pendingRequests.delete(internalId);
        this.cliPending.delete(internalId);
        this.advanceRouteQueue(internalId);
        if (cliWs.readyState === WebSocket.OPEN) {
          cliWs.send(JSON.stringify({
            type: 'action_result',
            requestId: originalRequestId,
            success: false,
            error: err instanceof Error ? err.message : 'Failed to send to extension',
          }));
        }
      }
    };

    if (!routeKey) {
      // No identifiable routing key (e.g. status pings, screenshot of
      // focused tab) — still go through the global concurrency gate so
      // a flood can't crowd out legitimate routed actions, but skip the
      // per-route lock entirely.
      this.acquireGlobalSlot(doForward);
      return;
    }
    this.routeByInternalId.set(internalId, routeKey);
    if (this.routeRunning.has(routeKey)) {
      const q = this.routeQueues.get(routeKey) ?? [];
      q.push(doForward);
      this.routeQueues.set(routeKey, q);
      console.log(`[BNBOT] Queued ${message.actionType} on ${routeKey} (queue depth=${q.length})`);
    } else {
      this.routeRunning.add(routeKey);
      this.acquireGlobalSlot(doForward);
    }
  }

  /**
   * Acquire one of MAX_CONCURRENT_ACTIONS global slots. Runs immediately
   * if a slot is free, otherwise parks the runner until releaseGlobalSlot
   * wakes it.
   */
  private acquireGlobalSlot(run: () => void): void {
    if (this.globalInFlight < MAX_CONCURRENT_ACTIONS) {
      this.globalInFlight++;
      run();
    } else {
      this.globalWaitQueue.push(run);
      console.log(`[BNBOT] At max concurrency ${MAX_CONCURRENT_ACTIONS} — parked (global wait depth=${this.globalWaitQueue.length})`);
    }
  }

  private releaseGlobalSlot(): void {
    this.globalInFlight--;
    if (this.globalInFlight < 0) this.globalInFlight = 0; // defensive
    const next = this.globalWaitQueue.shift();
    if (next) {
      this.globalInFlight++;
      next();
    }
  }

  /**
   * Mark a routing key's current action as finished:
   *   - release the global slot it held
   *   - if more actions are queued on this route, acquire a fresh
   *     global slot and dispatch the next one (route stays "running")
   *   - otherwise free the route lock
   *
   * Safe to call multiple times for the same internalId — only the
   * first call advances.
   */
  private advanceRouteQueue(internalId: string): void {
    // Release the global slot regardless of whether this action had a
    // route key (routed and unrouted actions both consume one slot).
    this.releaseGlobalSlot();
    const routeKey = this.routeByInternalId.get(internalId);
    if (!routeKey) return;
    this.routeByInternalId.delete(internalId);
    const q = this.routeQueues.get(routeKey);
    if (q && q.length > 0) {
      const next = q.shift()!;
      // routeRunning stays true — we just swap which action holds it,
      // but it must reacquire a global slot.
      this.acquireGlobalSlot(next);
    } else {
      this.routeRunning.delete(routeKey);
    }
  }

  /**
   * Stop the WebSocket server
   */
  stop(): void {
    if (this.client) {
      this.client.close(1000, 'Server shutting down');
      this.client = null;
    }
    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }
    if (this.httpServer) {
      this.httpServer.close();
      this.httpServer = null;
    }
    // Reject all pending
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Server shutting down'));
    }
    this.pendingRequests.clear();
    for (const [, cliReq] of this.cliPending) {
      clearTimeout(cliReq.timer);
    }
    this.cliPending.clear();
    this.routeQueues.clear();
    this.routeRunning.clear();
    this.routeByInternalId.clear();
    this.globalWaitQueue = [];
    this.globalInFlight = 0;
  }

  /**
   * Handle incoming message from the extension
   */
  private handleMessage(message: IncomingMessage, ws?: WebSocket): void {
    if (ws && this.client && ws !== this.client) {
      console.error(`[BNBOT] Ignoring ${message.type} from non-active extension connection`);
      return;
    }
    switch (message.type) {
      case 'action_result': {
        const pending = this.pendingRequests.get(message.requestId);
        if (pending) {
          clearTimeout(pending.timer);
          this.pendingRequests.delete(message.requestId);
          pending.resolve(message);
        } else {
          console.error('[BNBOT] Received result for unknown request:', message.requestId);
        }
        break;
      }

      case 'status':
        this.extensionVersion = message.version;
        this.extensionFeatures = message.features ?? [];
        console.error(`[BNBOT] Extension version: ${message.version}${this.extensionFeatures.length ? ` features=${this.extensionFeatures.join(',')}` : ''}`);
        break;

      case 'heartbeat':
        // Just acknowledge
        break;

      case 'source_capture':
        void this.forwardSourceCaptureToDesktop(message.payload).catch((err) => {
          console.error('[BNBOT] Failed to forward source capture:', err instanceof Error ? err.message : String(err));
        });
        break;
    }
  }

  private async forwardSourceCaptureToDesktop(payload: Record<string, unknown>): Promise<void> {
    const response = await fetch('http://127.0.0.1:27421/api/remix-jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: payload }),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`desktop remix endpoint returned ${response.status}${text ? `: ${text.slice(0, 200)}` : ''}`);
    }
  }

  /**
   * Send an action to the extension and wait for the result.
   * Automatically retries on busy responses.
   */
  async sendAction(
    actionType: string,
    params: Record<string, unknown>,
    timeout?: number
  ): Promise<{ success: boolean; data?: unknown; error?: string }> {
    if (!this.client || this.client.readyState !== WebSocket.OPEN) {
      return {
        success: false,
        error: 'Extension not connected. Make sure BNBOT extension is running and OpenClaw integration is enabled in settings.',
      };
    }

    // Ensure extension is logged in before executing actions
    if (!this.autoLoginDone && actionType !== 'inject_auth_tokens') {
      await this.tryAutoLogin();
    }

    const effectiveTimeout = timeout || DEFAULT_TIMEOUT;
    let retries = 0;

    while (retries <= MAX_BUSY_RETRIES) {
      const requestId = randomUUID();
      const request: ActionRequest = {
        type: 'action',
        requestId,
        actionType,
        actionPayload: params,
      };

      try {
        const result = await this.sendAndWait(request, effectiveTimeout);

        if (!result.success && result.error === 'extension_busy') {
          retries++;
          const retryAfter = result.retryAfter || BUSY_RETRY_DELAY;
          console.error(`[BNBOT] Extension busy, retrying in ${retryAfter}ms (${retries}/${MAX_BUSY_RETRIES})`);
          await new Promise((r) => setTimeout(r, retryAfter));
          continue;
        }

        return {
          success: result.success,
          data: result.data,
          error: result.error,
        };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : 'Unknown error',
        };
      }
    }

    return {
      success: false,
      error: 'Extension busy after maximum retries',
    };
  }

  /**
   * Send a request and wait for the matching response
   */
  private sendAndWait(request: ActionRequest, timeout: number): Promise<ActionResult> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(request.requestId);
        reject(new Error(`Action '${request.actionType}' timed out after ${timeout / 1000}s`));
      }, timeout);

      this.pendingRequests.set(request.requestId, { resolve, reject, timer });

      try {
        this.client!.send(JSON.stringify(request));
      } catch (err) {
        clearTimeout(timer);
        this.pendingRequests.delete(request.requestId);
        reject(err);
      }
    });
  }

  /**
   * Check if the extension is connected
   */
  isExtensionConnected(): boolean {
    return this.client !== null && this.client.readyState === WebSocket.OPEN;
  }

  /**
   * Get extension info
   */
  getExtensionInfo(): { connected: boolean; version: string | null } {
    return {
      connected: this.isExtensionConnected(),
      version: this.extensionVersion,
    };
  }

  /**
   * Get auth status from extension
   */
  getAuthStatus(): { valid: boolean; expiry: string | null; email: string | null } {
    // Auth is managed by the extension. We check if the extension
    // has reported auth status via the auto-login flow.
    // For now, we consider auth valid if the extension is connected
    // (the extension handles token validation internally).
    if (!this.isExtensionConnected()) {
      return { valid: false, expiry: null, email: null };
    }

    // The extension is connected. Auth status is managed by the extension.
    // We return valid=true as the extension handles token refresh internally.
    // The actual token validation happens in the extension's auth module.
    return {
      valid: true,
      expiry: null, // Extension manages token lifecycle
      email: null, // Extension doesn't report email back
    };
  }
}
