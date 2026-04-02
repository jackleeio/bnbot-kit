/**
 * Shared types for BNBOT WebSocket Server
 */

/** Message from Server → Extension */
export interface ActionRequest {
  type: 'action';
  requestId: string;
  actionType: string;
  actionPayload: Record<string, unknown>;
}

/** Message from Extension → Server */
export interface ActionResult {
  type: 'action_result';
  requestId: string;
  success: boolean;
  data?: unknown;
  error?: string;
  retryAfter?: number;
}

/** Extension status message */
export interface ExtensionStatus {
  type: 'status';
  extensionConnected: boolean;
  version: string;
}

/** Heartbeat message */
export interface HeartbeatMessage {
  type: 'heartbeat';
  timestamp: number;
}

export type IncomingMessage = ActionResult | ExtensionStatus | HeartbeatMessage;
