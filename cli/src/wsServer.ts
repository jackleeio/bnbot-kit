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
import { randomUUID } from 'crypto';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { ActionRequest, ActionResult, IncomingMessage } from './types.js';

const DEFAULT_PORT = 18900;
const DEFAULT_TIMEOUT = 60000; // 60s default
const BUSY_RETRY_DELAY = 3000;
const MAX_BUSY_RETRIES = 10;

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
  private client: WebSocket | null = null;
  private pendingRequests: Map<string, PendingRequest> = new Map();
  /** CLI client requests: maps internal requestId -> CLI client info */
  private cliPending: Map<string, CliPending> = new Map();
  private extensionVersion: string | null = null;
  private port: number;
  private autoLoginDone: boolean = false;

  constructor(port?: number) {
    this.port = port || DEFAULT_PORT;
  }

  /**
   * Start the WebSocket server
   */
  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.wss = new WebSocketServer({ port: this.port, host: '127.0.0.1' });

      this.wss.on('listening', () => {
        console.error(`[BNBOT] WebSocket server listening on ws://localhost:${this.port}`);
        resolve();
      });

      this.wss.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'EADDRINUSE') {
          console.error(`[BNBOT] Port ${this.port} is already in use. Continuing without WebSocket server (public API tools still work).`);
          this.wss = null;
          resolve(); // non-fatal: tools that don't need extension still work
        } else {
          reject(error);
        }
      });

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
              this.handleExtensionConnect(ws);
            }

            this.handleMessage(message as IncomingMessage);
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
            this.autoLoginDone = false;
            // Reject all pending requests
            for (const [id, pending] of this.pendingRequests) {
              clearTimeout(pending.timer);
              pending.reject(new Error('Extension disconnected'));
              this.pendingRequests.delete(id);
            }
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
  private handleExtensionConnect(ws: WebSocket): void {
    console.error('[BNBOT] Extension connected');

    // Only allow one extension at a time
    if (this.client && this.client.readyState === WebSocket.OPEN) {
      console.error('[BNBOT] Replacing existing extension connection');
      this.client.close(1000, 'Replaced by new connection');
    }

    this.client = ws;

    // Auto-login: if clawmoney API key exists, inject auth tokens
    this.tryAutoLogin();
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

    // Set up timeout
    const timer = setTimeout(() => {
      this.pendingRequests.delete(internalId);
      this.cliPending.delete(internalId);
      if (cliWs.readyState === WebSocket.OPEN) {
        cliWs.send(JSON.stringify({
          type: 'action_result',
          requestId: originalRequestId,
          success: false,
          error: `Action '${message.actionType}' timed out after ${DEFAULT_TIMEOUT / 1000}s`,
        }));
      }
    }, DEFAULT_TIMEOUT);

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
      },
      timer,
    });

    // Forward to extension
    try {
      this.client.send(JSON.stringify(request));
    } catch (err) {
      clearTimeout(timer);
      this.pendingRequests.delete(internalId);
      this.cliPending.delete(internalId);
      if (cliWs.readyState === WebSocket.OPEN) {
        cliWs.send(JSON.stringify({
          type: 'action_result',
          requestId: originalRequestId,
          success: false,
          error: err instanceof Error ? err.message : 'Failed to send to extension',
        }));
      }
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
  }

  /**
   * Handle incoming message from the extension
   */
  private handleMessage(message: IncomingMessage): void {
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
        console.error(`[BNBOT] Extension version: ${message.version}`);
        break;

      case 'heartbeat':
        // Just acknowledge
        break;
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
}
