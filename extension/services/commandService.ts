/**
 * CommandService
 * Local-only command bridge for actions forwarded from the background
 * service worker. The old remote/offscreen WebSocket command channel was
 * retired; this file intentionally does not import auth or chat services.
 */

interface LocalActionMessage {
  requestId: string;
  actionType: string;
  actionPayload: Record<string, unknown>;
}

class CommandService {
  private messageListenerAdded = false;

  init(): void {
    this.setupMessageListener();
    console.log('[CommandService] Initialized (local bridge only)');
  }

  private setupMessageListener(): void {
    if (this.messageListenerAdded) return;

    chrome.runtime.onMessage.addListener((message, _sender, _sendResponse) => {
      if (message.type === 'LOCAL_ACTION') {
        // Handle action from the bnbot bridge (ws://localhost:18900).
        this.handleLocalActionFromBackground(message);
      }
    });

    this.messageListenerAdded = true;
  }

  disconnect(): void {
    // No remote/offscreen WebSocket remains; local relay is owned by background.
  }

  /**
   * Handle action from the bnbot bridge. Results are returned via callback
   * instead of being sent to the remote API.
   */
  async handleLocalAction(
    actionType: string,
    actionPayload: Record<string, unknown>,
    source: string = 'local'
  ): Promise<{ success: boolean; data?: unknown; error?: string }> {
    console.log('[CommandService] handleLocalAction:', actionType, 'source:', source);

    try {
      const { executeAction } = await import('./actionIntegration');

      const result = await executeAction(`action_${actionType}`, actionPayload || {}, {
        onComplete: (data: unknown) => {
          console.log('[CommandService] Local action onComplete, data type:', typeof data);
        },
        onError: (msg: string) => {
          console.error('[CommandService] Local action onError:', msg);
        },
        onProgress: (msg: string) => {
          console.log('[CommandService] Local action progress:', msg);
        }
      });

      console.log('[CommandService] Local action result:', result.success, 'hasData:', !!result.data);
      return result;
    } catch (error) {
      console.error('[CommandService] handleLocalAction error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Execute the action and send the result back to background for forwarding
   * to the local relay.
   */
  private async handleLocalActionFromBackground(message: LocalActionMessage): Promise<void> {
    const { requestId, actionType, actionPayload } = message;
    console.log('[CommandService] handleLocalAction:', actionType, 'requestId:', requestId, 'payload:', JSON.stringify(actionPayload));

    const result = await this.handleLocalAction(actionType, actionPayload || {}, 'local');

    chrome.runtime.sendMessage({
      type: 'LOCAL_ACTION_RESULT',
      requestId,
      success: result.success,
      data: result.data,
      error: result.error,
    }, () => {
      if (chrome.runtime.lastError) {
        console.error('[CommandService] Failed to send local action result:', chrome.runtime.lastError);
      }
    });
  }
}

export const commandService = new CommandService();
