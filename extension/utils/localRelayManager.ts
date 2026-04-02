/**
 * LocalRelayManager
 * WebSocket client that connects to a local MCP relay server (ws://localhost:PORT)
 * for OpenClaw integration. Runs in the background service worker.
 *
 * Unlike the remote WebSocket (which goes through the backend for Telegram control),
 * this is a purely local connection for AI assistants like OpenClaw to control the extension.
 */

const DEFAULT_LOCAL_WS_PORT = 18900;
const HEARTBEAT_INTERVAL = 30000; // 30s
const MIN_RECONNECT_DELAY = 3000; // 3s
const MAX_RECONNECT_DELAY = 30000; // 30s

export interface LocalRelayCallbacks {
  /** Forward action message to content script for execution */
  onAction: (message: LocalActionRequest) => void;
  /** Connection state changed */
  onConnectionChange?: (connected: boolean) => void;
}

export interface LocalActionRequest {
  type: 'action';
  requestId: string;
  actionType: string;
  actionPayload: Record<string, unknown>;
}

export interface LocalActionResult {
  type: 'action_result';
  requestId: string;
  success: boolean;
  data?: unknown;
  error?: string;
  retryAfter?: number;
}

interface LocalHeartbeat {
  type: 'heartbeat';
  timestamp: number;
}

interface LocalStatusResponse {
  type: 'status';
  extensionConnected: true;
  version: string;
}

type LocalOutgoingMessage = LocalActionResult | LocalHeartbeat | LocalStatusResponse;

class LocalRelayManager {
  private ws: WebSocket | null = null;
  private callbacks: LocalRelayCallbacks | null = null;
  private port: number = DEFAULT_LOCAL_WS_PORT;
  private enabled: boolean = false;
  private connected: boolean = false;

  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectAttempts: number = 0;

  /**
   * Initialize the local relay manager with callbacks
   */
  init(callbacks: LocalRelayCallbacks): void {
    this.callbacks = callbacks;
    console.log('[LocalRelay] Initialized');
  }

  /**
   * Enable/disable the local relay connection.
   * When enabled, attempts to connect to ws://localhost:PORT.
   * When disabled, disconnects and stops reconnecting.
   */
  setEnabled(enabled: boolean, port?: number): void {
    if (port !== undefined) {
      this.port = port;
    }

    if (enabled === this.enabled) return;

    this.enabled = enabled;
    console.log(`[LocalRelay] ${enabled ? 'Enabled' : 'Disabled'}, port: ${this.port}`);

    if (enabled) {
      this.connect();
    } else {
      this.disconnect();
    }
  }

  /**
   * Connect to the local WebSocket server
   */
  private async connect(): Promise<void> {
    if (!this.enabled) return;
    if (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)) {
      return;
    }

    const url = `ws://localhost:${this.port}`;
    console.log(`[LocalRelay] Connecting to ${url}...`);

    try {
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        console.log('[LocalRelay] Connected');
        this.connected = true;
        this.reconnectAttempts = 0;
        this.callbacks?.onConnectionChange?.(true);
        this.startHeartbeat();

        // Send initial status
        this.send({
          type: 'status',
          extensionConnected: true,
          version: chrome.runtime.getManifest().version,
        });
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.handleMessage(data);
        } catch (err) {
          console.error('[LocalRelay] Failed to parse message:', err);
        }
      };

      this.ws.onclose = (event) => {
        console.log(`[LocalRelay] Disconnected (code: ${event.code}, reason: ${event.reason})`);
        this.connected = false;
        this.callbacks?.onConnectionChange?.(false);
        this.stopHeartbeat();
        this.ws = null;
        this.scheduleReconnect();
      };

      this.ws.onerror = (event) => {
        // Don't log full error to avoid noise when server isn't running
        console.log('[LocalRelay] Connection error (server may not be running)');
      };
    } catch (err) {
      console.error('[LocalRelay] Failed to create WebSocket:', err);
      this.scheduleReconnect();
    }
  }

  /**
   * Disconnect and stop reconnecting
   */
  disconnect(): void {
    this.clearReconnectTimer();
    this.stopHeartbeat();
    this.reconnectAttempts = 0;

    if (this.ws) {
      this.ws.onclose = null; // Prevent reconnect on intentional close
      this.ws.close(1000, 'Extension disabled local relay');
      this.ws = null;
    }

    if (this.connected) {
      this.connected = false;
      this.callbacks?.onConnectionChange?.(false);
    }

    console.log('[LocalRelay] Disconnected');
  }

  /**
   * Handle incoming message from the MCP relay server
   */
  private handleMessage(data: any): void {
    switch (data.type) {
      case 'action':
        if (data.requestId && data.actionType) {
          console.log(`[LocalRelay] Received action: ${data.actionType} (${data.requestId})`);
          this.callbacks?.onAction(data as LocalActionRequest);
        } else {
          console.warn('[LocalRelay] Invalid action message:', data);
        }
        break;

      case 'heartbeat':
        // Respond to heartbeat
        this.send({ type: 'heartbeat', timestamp: Date.now() });
        break;

      case 'ping':
        // Simple ping/pong
        this.send({ type: 'heartbeat', timestamp: Date.now() });
        break;

      case 'status_request':
        this.send({
          type: 'status',
          extensionConnected: true,
          version: chrome.runtime.getManifest().version,
        });
        break;

      default:
        console.log('[LocalRelay] Unknown message type:', data.type);
    }
  }

  /**
   * Send action result back to the MCP relay server
   */
  sendActionResult(result: LocalActionResult): boolean {
    return this.send(result);
  }

  /**
   * Send a message to the local WS server
   */
  private send(message: LocalOutgoingMessage | { type: string; [key: string]: any }): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return false;
    }

    try {
      this.ws.send(JSON.stringify(message));
      return true;
    } catch (err) {
      console.error('[LocalRelay] Send failed:', err);
      return false;
    }
  }

  /**
   * Schedule reconnection with exponential backoff
   */
  private scheduleReconnect(): void {
    if (!this.enabled) return;

    this.clearReconnectTimer();

    const delay = Math.min(
      MIN_RECONNECT_DELAY * Math.pow(2, this.reconnectAttempts),
      MAX_RECONNECT_DELAY
    );
    this.reconnectAttempts++;

    // Only log every few attempts to reduce noise
    if (this.reconnectAttempts <= 3 || this.reconnectAttempts % 5 === 0) {
      console.log(`[LocalRelay] Reconnecting in ${delay / 1000}s (attempt ${this.reconnectAttempts})`);
    }

    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.send({ type: 'heartbeat', timestamp: Date.now() });
    }, HEARTBEAT_INTERVAL);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * Force reconnect — disconnect existing connection and reconnect immediately
   */
  reconnect(): void {
    if (!this.enabled) {
      this.enabled = true;
    }
    this.clearReconnectTimer();
    this.stopHeartbeat();
    this.reconnectAttempts = 0;

    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close(1000, 'Manual reconnect');
      this.ws = null;
    }

    this.connected = false;
    this.callbacks?.onConnectionChange?.(false);
    console.log('[LocalRelay] Manual reconnect triggered');
    this.connect();
  }

  /**
   * Get current connection status
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Get current configuration
   */
  getConfig(): { enabled: boolean; port: number; connected: boolean } {
    return {
      enabled: this.enabled,
      port: this.port,
      connected: this.connected,
    };
  }
}

export const localRelayManager = new LocalRelayManager();
