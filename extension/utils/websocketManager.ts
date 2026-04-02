/**
 * WebSocket Manager - Shared WebSocket connection/heartbeat/reconnect logic
 *
 * Used by:
 * - Chrome: offscreen.ts (runs in offscreen document, survives SW termination)
 * - Firefox: background.ts (runs directly in background event page)
 */

export interface WSManagerCallbacks {
  /** Notify the host environment about WS events */
  notifyHost: (data: object) => void;
  /** Request a fresh access token for reconnection */
  requestFreshToken: () => Promise<string | null>;
}

export class WebSocketManager {
  private ws: WebSocket | null = null;
  private userId: string | null = null;
  private accessToken: string | null = null;
  private reconnectAttempts = 0;
  private readonly baseReconnectDelay = 3000;
  private readonly maxReconnectDelay = 30000;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private healthCheckInterval: ReturnType<typeof setInterval> | null = null;
  private shouldReconnect = true;
  private lastHeartbeatAck = Date.now();
  private missedHeartbeats = 0;
  private readonly MAX_MISSED_HEARTBEATS = 3;
  private readonly wsBaseUrl: string;
  private callbacks: WSManagerCallbacks;

  constructor(apiBaseUrl: string, callbacks: WSManagerCallbacks, wsBaseUrl?: string) {
    if (wsBaseUrl) {
      this.wsBaseUrl = wsBaseUrl;
    } else {
      this.wsBaseUrl = apiBaseUrl.includes('localhost')
        ? 'ws://localhost:8001'
        : apiBaseUrl.replace('http://', 'ws://').replace('https://', 'wss://');
    }
    this.callbacks = callbacks;
  }

  async connect(uid: string, token: string): Promise<{ success: boolean; error?: string }> {
    // If already connected with same user, return success
    if (this.ws?.readyState === WebSocket.OPEN && this.userId === uid) {
      console.log('[WSManager] Already connected');
      return { success: true };
    }

    // Disconnect existing connection if different user
    if (this.userId && this.userId !== uid) {
      this.disconnect();
    }

    this.userId = uid;
    this.accessToken = token;
    this.shouldReconnect = true;
    this.lastHeartbeatAck = Date.now();
    this.missedHeartbeats = 0;

    const wsUrl = `${this.wsBaseUrl}/ws/${uid}?token=${token}`;
    console.log('[WSManager] Connecting to:', this.wsBaseUrl);

    return new Promise((resolve) => {
      try {
        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
          console.log('[WSManager] Connected');
          this.reconnectAttempts = 0;
          this.lastHeartbeatAck = Date.now();
          this.missedHeartbeats = 0;
          this.startHeartbeat();
          this.startHealthCheck();
          this.callbacks.notifyHost({ type: 'WS_CONNECTED', wsUrl: this.wsBaseUrl });
          resolve({ success: true });
        };

        this.ws.onclose = (event) => {
          console.log('[WSManager] Disconnected:', event.code, event.reason);
          this.stopHeartbeat();
          this.callbacks.notifyHost({ type: 'WS_DISCONNECTED', code: event.code, reason: event.reason });

          if (this.shouldReconnect && event.code !== 4001) {
            this.scheduleReconnect();
          }
          resolve({ success: false, error: `Closed: ${event.code} ${event.reason}` });
        };

        this.ws.onerror = (error) => {
          console.error('[WSManager] Error:', error);
        };

        this.ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);

            // Track heartbeat ack
            if (message.type === 'heartbeat_ack') {
              this.lastHeartbeatAck = Date.now();
              this.missedHeartbeats = 0;
              return;
            }

            // Forward other messages to host
            this.callbacks.notifyHost({ type: 'WS_MESSAGE', message });
          } catch (err) {
            console.error('[WSManager] Parse error:', err);
          }
        };
      } catch (err) {
        console.error('[WSManager] Connection error:', err);
        resolve({ success: false, error: err instanceof Error ? err.message : 'Unknown error' });
      }
    });
  }

  disconnect(): void {
    this.shouldReconnect = false;
    this.stopHeartbeat();
    this.stopHealthCheck();

    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }

    this.userId = null;
    this.accessToken = null;
    console.log('[WSManager] Disconnected');
  }

  send(message: object): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      console.warn('[WSManager] Not connected');
      return false;
    }

    try {
      this.ws.send(JSON.stringify(message));
      return true;
    } catch (err) {
      console.error('[WSManager] Send error:', err);
      return false;
    }
  }

  getStatus(): { connected: boolean; userId: string | null } {
    return {
      connected: this.ws?.readyState === WebSocket.OPEN,
      userId: this.userId,
    };
  }

  updateToken(token: string): void {
    this.accessToken = token;
    console.log('[WSManager] Token updated');
  }

  private getReconnectDelay(): number {
    return Math.min(this.baseReconnectDelay * Math.pow(2, this.reconnectAttempts), this.maxReconnectDelay);
  }

  private scheduleReconnect(): void {
    if (!this.userId || !this.accessToken) return;

    this.reconnectAttempts++;
    const delay = this.getReconnectDelay();

    console.log(`[WSManager] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    setTimeout(() => {
      if (this.shouldReconnect && this.userId && this.accessToken) {
        // Request fresh token before reconnecting
        this.callbacks.requestFreshToken().then((newToken) => {
          if (newToken && this.userId) {
            this.accessToken = newToken;
            this.connect(this.userId, newToken);
          } else if (this.userId && this.accessToken) {
            this.connect(this.userId, this.accessToken);
          }
        });
      }
    }, delay);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        // Check if server responded to last heartbeat
        const timeSinceLastAck = Date.now() - this.lastHeartbeatAck;
        if (timeSinceLastAck > 90000) { // 90 seconds without ack
          this.missedHeartbeats++;
          console.warn(`[WSManager] Missed heartbeat ack (${this.missedHeartbeats}/${this.MAX_MISSED_HEARTBEATS})`);

          if (this.missedHeartbeats >= this.MAX_MISSED_HEARTBEATS) {
            console.error('[WSManager] Too many missed heartbeats, reconnecting...');
            this.ws?.close(4000, 'Heartbeat timeout');
            return;
          }
        }

        this.send({ type: 'heartbeat' });
      }
    }, 30000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  private startHealthCheck(): void {
    this.stopHealthCheck();
    this.healthCheckInterval = setInterval(() => {
      if (this.shouldReconnect && this.ws?.readyState !== WebSocket.OPEN && this.userId && this.accessToken) {
        console.log('[WSManager] Health check: reconnecting');
        this.connect(this.userId, this.accessToken);
      }
    }, 60000);
  }

  private stopHealthCheck(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }
}
