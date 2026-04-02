/**
 * CommandService
 * WebSocket client for receiving commands from backend (Telegram, scheduled tasks, etc.)
 * Uses Offscreen Document for single WebSocket connection across all tabs.
 */

import { chatService } from './chatService';
import { authService } from './authService';

export interface CommandMessage {
  type: 'chat' | 'command' | 'action' | 'heartbeat_ack' | 'scheduled_trigger';
  requestId?: string;
  content?: string;
  action?: string;
  payload?: any;
  from?: string;
  actionType?: string;
  actionPayload?: any;
  threadId?: string;
  telegramChatId?: string;
  telegramMsgId?: number;
  // Scheduled trigger fields
  trigger_id?: string;
  task_id?: string;
  execution_id?: string;
  task_name?: string;
  prompt?: string;
}

export interface CommandServiceOptions {
  onConnected?: () => void;
  onDisconnected?: () => void;
  onError?: (error: Error) => void;
  onMessage?: (message: CommandMessage) => void;
}

class CommandService {
  private options: CommandServiceOptions = {};
  private messageListenerAdded = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private baseReconnectDelay = 3000; // 3 seconds
  private shouldReconnect = false;
  private lastUserId: string | null = null;
  private lastAccessToken: string | null = null;

  // Task execution queue — ensures only one task/draft runs at a time
  private executionQueue: Array<() => Promise<void>> = [];
  private isExecuting = false;

  /**
   * Initialize the command service
   */
  init(options: CommandServiceOptions = {}): void {
    this.options = options;
    this.setupMessageListener();
    console.log('[CommandService] Initialized (using Offscreen WebSocket)');
  }

  /**
   * Setup listener for messages from background/offscreen
   */
  private setupMessageListener(): void {
    if (this.messageListenerAdded) return;

    chrome.runtime.onMessage.addListener((message, _sender, _sendResponse) => {
      if (message.type === 'WS_CONNECTED') {
        console.log('[CommandService] WebSocket connected to:', message.wsUrl || 'unknown');
        this.options.onConnected?.();
      } else if (message.type === 'WS_DISCONNECTED') {
        console.log('[CommandService] WebSocket disconnected');
        this.options.onDisconnected?.();
      } else if (message.type === 'WS_MESSAGE') {
        this.handleMessage(message.message);
      } else if (message.type === 'LOCAL_ACTION') {
        // Handle action from local relay (OpenClaw MCP)
        this.handleLocalActionFromBackground(message);
      } else if (message.type === 'EXECUTE_SCHEDULED_TASK') {
        // Handle alarm-triggered task execution (queued)
        this.enqueueExecution(() => this.handleAlarmTriggeredTask(message));
      } else if (message.type === 'PUBLISH_SCHEDULED_DRAFT') {
        // Handle alarm-triggered draft publish (queued)
        this.enqueueExecution(() => this.handleScheduledDraftPublish(message));
      }
    });

    this.messageListenerAdded = true;
  }

  /**
   * Enqueue a task/draft execution. Ensures only one runs at a time
   * to prevent DOM manipulation conflicts.
   */
  private enqueueExecution(fn: () => Promise<void>): void {
    this.executionQueue.push(fn);
    console.log(`[CommandService] Execution enqueued, queue size: ${this.executionQueue.length}`);
    this.processQueue();
  }

  private async processQueue(): Promise<void> {
    if (this.isExecuting || this.executionQueue.length === 0) return;

    this.isExecuting = true;
    const fn = this.executionQueue.shift()!;
    try {
      await fn();
    } catch (err) {
      console.error('[CommandService] Queued execution error:', err);
    } finally {
      this.isExecuting = false;
      // Process next item
      this.processQueue();
    }
  }

  /**
   * Connect to WebSocket via Offscreen Document with auto-reconnect
   */
  async connect(): Promise<boolean> {
    this.shouldReconnect = true;
    this.clearReconnectTimer();

    try {
      const user = await authService.getUser();
      if (!user?.id) {
        console.warn('[CommandService] No user session');
        return false;
      }

      // Validate token
      const response = await authService.fetchWithAuth(
        'https://api.bnbot.ai/api/v1/payments/credits',
        { method: 'GET' }
      );
      if (!response.ok) {
        console.warn('[CommandService] Token validation failed, status:', response.status);
        return false;
      }

      const accessToken = await authService.getAccessToken();
      if (!accessToken) {
        console.warn('[CommandService] No access token');
        return false;
      }

      // Save for reconnection
      this.lastUserId = user.id;
      this.lastAccessToken = accessToken;

      // Connect via background -> offscreen
      console.log('[CommandService] Connecting WebSocket...');
      return new Promise((resolve) => {
        chrome.runtime.sendMessage(
          { type: 'WS_CONNECT', userId: user.id, accessToken },
          (response) => {
            if (chrome.runtime.lastError) {
              console.error('[CommandService] Connection error:', chrome.runtime.lastError);
              this.scheduleReconnect();
              resolve(false);
              return;
            }
            if (response?.success) {
              console.log('[CommandService] WebSocket connected');
              this.reconnectAttempts = 0;
              this.options.onConnected?.();
              resolve(true);
            } else {
              console.warn('[CommandService] Connection failed:', response?.error);
              this.scheduleReconnect();
              resolve(false);
            }
          }
        );
      });
    } catch (error) {
      console.error('[CommandService] Connection error:', error);
      this.scheduleReconnect();
      return false;
    }
  }

  /**
   * Schedule a reconnection attempt
   */
  private scheduleReconnect(): void {
    if (!this.shouldReconnect) return;
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.warn('[CommandService] Max reconnect attempts reached');
      return;
    }

    this.clearReconnectTimer();

    const delay = Math.min(
      this.baseReconnectDelay * Math.pow(2, this.reconnectAttempts),
      30000 // Max 30 seconds
    );
    this.reconnectAttempts++;

    console.log(`[CommandService] Reconnecting in ${delay / 1000}s (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);

    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }

  /**
   * Clear reconnection timer
   */
  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  disconnect(): void {
    this.shouldReconnect = false;
    this.clearReconnectTimer();
    this.reconnectAttempts = 0;
    chrome.runtime.sendMessage({ type: 'WS_DISCONNECT' }, () => {});
    console.log('[CommandService] Disconnected');
  }

  send(message: object): boolean {
    chrome.runtime.sendMessage({ type: 'WS_SEND', message }, () => {});
    return true;
  }

  sendChatResponse(requestId: string, content: string, success: boolean = true): void {
    this.send({ type: 'chat_response', requestId, content, success });
  }

  sendCommandResult(requestId: string, action: string, success: boolean, result?: string, error?: string): void {
    this.send({ type: 'command_result', requestId, action, success, result, error });
  }

  sendReport(report: object): void {
    this.send({ type: 'report', report });
  }

  isConnected(): boolean {
    return true; // Optimistic, use getStatus() for accurate check
  }

  async getStatus(): Promise<{ connected: boolean; userId: string | null }> {
    // Check if extension context is still valid
    try {
      if (!chrome?.runtime?.id) {
        return { connected: false, userId: null };
      }
    } catch {
      return { connected: false, userId: null };
    }

    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'WS_STATUS' }, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ connected: false, userId: null });
          return;
        }
        resolve(response || { connected: false, userId: null });
      });
    });
  }

  sendActionResult(
    requestId: string, threadId: string, actionType: string, success: boolean,
    result?: unknown, error?: string, telegramChatId?: string, telegramMsgId?: number
  ): void {
    // Use API instead of WebSocket for reliability
    this.sendActionResultViaAPI(threadId, actionType, success, result, error, telegramChatId, telegramMsgId);
  }

  private async sendActionResultViaAPI(
    threadId: string, actionType: string, success: boolean,
    result?: unknown, error?: string, telegramChatId?: string, telegramMsgId?: number
  ): Promise<void> {
    try {
      console.log('[CommandService] Sending action result via API:', actionType, 'success:', success);

      const response = await authService.fetchWithAuth(
        'https://api.bnbot.ai/api/v1/ai/resume',
        {
          method: 'POST',
          body: JSON.stringify({
            thread_id: threadId,
            success,
            data: result,
            error,
            telegram_chat_id: telegramChatId,
            telegram_msg_id: telegramMsgId
          })
        }
      );

      if (response.ok) {
        console.log('[CommandService] Action result sent successfully');
      } else {
        console.error('[CommandService] Failed to send action result:', response.status);
      }
    } catch (err) {
      console.error('[CommandService] Error sending action result:', err);
    }
  }

  private handleMessage(message: CommandMessage): void {
    console.log('[CommandService] Received:', message.type);
    this.options.onMessage?.(message);

    switch (message.type) {
      case 'chat':
        this.handleChatMessage(message);
        break;
      case 'command':
        this.handleCommand(message);
        break;
      case 'action':
        this.handleAction(message);
        break;
      case 'scheduled_trigger':
        this.handleScheduledTrigger(message);
        break;
    }
  }

  private async handleChatMessage(message: CommandMessage): Promise<void> {
    const { requestId, content } = message;
    if (!requestId || !content) return;

    try {
      const { executeAction } = await import('./actionIntegration');
      let responseContent = '';

      await new Promise<void>((resolve, reject) => {
        chatService.sendStatelessMessageStream(content, {
          onReasoning: () => {},
          onContent: (chunk: string) => { responseContent += chunk; },
          onToolCall: () => {},
          onToolResult: () => {},
          onComplete: () => resolve(),
          onError: (error: Error) => reject(error),
          onInterrupt: async (actionType: string, actionInput: unknown, threadId: string) => {
            try {
              const actionResult = await new Promise<unknown>((res, rej) => {
                executeAction(`action_${actionType}`, actionInput as Record<string, unknown>, {
                  onComplete: (result: unknown) => res(result),
                  onError: (msg: string) => rej(new Error(msg)),
                  onProgress: () => {}
                });
              });
              chatService.resumeGraph(threadId, actionResult, {
                onReasoning: () => {},
                onContent: (chunk: string) => { responseContent += chunk; },
                onToolCall: () => {},
                onToolResult: () => {},
                onComplete: () => resolve(),
                onError: (error: Error) => reject(error),
                onInterrupt: () => {}
              });
            } catch (err) {
              reject(err);
            }
          }
        });
      });

      this.sendChatResponse(requestId, responseContent, true);
    } catch (error) {
      this.sendChatResponse(requestId, `Error: ${error instanceof Error ? error.message : 'Unknown'}`, false);
    }
  }

  private async handleCommand(message: CommandMessage): Promise<void> {
    const { requestId, action, payload } = message;
    if (!requestId || !action) return;

    try {
      let result = '';
      switch (action) {
        case 'post_tweet': {
          const { tweetPoster } = await import('../utils/tweetPoster');
          const draftId = payload?.draftId;

          // Use verified post method
          const postResult = await tweetPoster.postTweetWithVerify(
            payload?.content || '',
            payload?.images
          );

          // Callback to backend to update draft status
          if (draftId) {
            await this.updateDraftStatus(draftId, postResult.success, postResult.error);
          }

          if (postResult.success) {
            result = `✅ Tweet posted (verified by ${postResult.verifiedBy})`;
            if (postResult.tweetId) {
              result += `, ID: ${postResult.tweetId}`;
            }
          } else {
            throw new Error(postResult.error || 'Post failed');
          }
          break;
        }
        case 'post_thread': {
          const { tweetPoster } = await import('../utils/tweetPoster');
          const draftId = payload?.draftId;
          const tweets = payload?.tweets || [];

          // Use verified thread post method
          const postResult = await tweetPoster.postThreadWithVerify(tweets);

          // Callback to backend to update draft status
          if (draftId) {
            await this.updateDraftStatus(draftId, postResult.success, postResult.error);
          }

          if (postResult.success) {
            result = `✅ Thread posted (${tweets.length} tweets, verified by ${postResult.verifiedBy})`;
            if (postResult.tweetId) {
              result += `, ID: ${postResult.tweetId}`;
            }
          } else {
            throw new Error(postResult.error || 'Thread post failed');
          }
          break;
        }
        case 'start_autopilot':
          const { autoReplyService: ars } = await import('./autoReplyService');
          await ars.start(payload);
          result = '✅ Autopilot started';
          break;
        case 'stop_autopilot':
          const { autoReplyService: ars2 } = await import('./autoReplyService');
          ars2.stop();
          result = '✅ Autopilot stopped';
          break;
        case 'get_status':
          const { autoReplyService: ars3 } = await import('./autoReplyService');
          const session = ars3.getSession();
          result = `📊 Status: ${session?.status || 'idle'}`;
          break;
        default:
          throw new Error(`Unknown: ${action}`);
      }
      this.sendCommandResult(requestId, action, true, result);
    } catch (error) {
      // If post failed with draftId, the status update was already done
      this.sendCommandResult(requestId, action, false, undefined, error instanceof Error ? error.message : 'Error');
    }
  }

  /**
   * Update draft publish status on backend
   */
  private async updateDraftStatus(draftId: string, success: boolean, error?: string): Promise<void> {
    try {
      const endpoint = success ? 'publish' : 'fail';
      const url = `https://api.bnbot.ai/api/v1/drafts/${draftId}/${endpoint}`;

      const options: RequestInit = { method: 'PUT' };
      if (!success && error) {
        options.headers = { 'Content-Type': 'application/json' };
        options.body = JSON.stringify({ error_message: error });
      }

      const response = await authService.fetchWithAuth(url, options);

      if (response.ok) {
        console.log(`[CommandService] Draft ${draftId} marked as ${success ? 'published' : 'failed'}`);
      } else {
        console.error(`[CommandService] Failed to update draft status: ${response.status}`);
      }
    } catch (err) {
      console.error('[CommandService] Error updating draft status:', err);
    }
  }

  private async handleAction(message: CommandMessage): Promise<void> {
    const { requestId, actionType, actionPayload, threadId, telegramChatId, telegramMsgId } = message;
    if (!actionType || !threadId) {
      console.warn('[CommandService] handleAction: missing actionType or threadId');
      return;
    }

    console.log('[CommandService] handleAction:', actionType, 'threadId:', threadId);

    try {
      const { executeAction } = await import('./actionIntegration');

      // Execute action and get result directly (executeAction returns a Promise)
      const result = await executeAction(`action_${actionType}`, actionPayload || {}, {
        onComplete: (data: unknown) => {
          console.log('[CommandService] Action onComplete callback, data type:', typeof data);
        },
        onError: (msg: string) => {
          console.error('[CommandService] Action onError callback:', msg);
        },
        onProgress: (msg: string) => {
          console.log('[CommandService] Action progress:', msg);
        }
      });

      console.log('[CommandService] Action result:', result.success, 'hasData:', !!result.data);

      // Send result back to backend
      this.sendActionResult(
        requestId || '',
        threadId,
        actionType,
        result.success,
        result.data,
        result.error,
        telegramChatId,
        telegramMsgId
      );

      console.log('[CommandService] Action result sent to backend');
    } catch (error) {
      console.error('[CommandService] handleAction error:', error);
      this.sendActionResult(requestId || '', threadId, actionType, false, undefined, error instanceof Error ? error.message : 'Error', telegramChatId, telegramMsgId);
    }
  }

  /**
   * Handle action from local relay (OpenClaw MCP).
   * Results are returned via callback instead of being sent to the remote API.
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
   * Handle action message forwarded from background's local relay.
   * Executes the action and sends the result back to background via chrome.runtime.sendMessage.
   */
  private async handleLocalActionFromBackground(message: {
    requestId: string;
    actionType: string;
    actionPayload: Record<string, unknown>;
  }): Promise<void> {
    const { requestId, actionType, actionPayload } = message;
    console.log('[CommandService] handleLocalAction:', actionType, 'requestId:', requestId, 'payload:', JSON.stringify(actionPayload));

    const result = await this.handleLocalAction(actionType, actionPayload || {}, 'local');

    // Send result back to background for forwarding to local relay
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

  /**
   * Handle alarm-triggered task execution (from chrome.alarms via background.ts).
   * Routes to the appropriate executor based on task type.
   */
  private async handleAlarmTriggeredTask(message: {
    taskId: string; executionId: string; taskType: string; taskName: string; notificationType?: string;
  }): Promise<void> {
    const { taskId, executionId, taskType, taskName, notificationType } = message;
    const taskTypeLower = (taskType || '').toLowerCase();

    console.log(`[CommandService] handleAlarmTriggeredTask: ${taskName} (${taskTypeLower}), exec=${executionId}`);

    try {
      let resultData: any;

      if (taskTypeLower === 'auto_reply') {
        const { autoReplyTaskExecutor } = await import('../utils/AutoReplyTaskExecutor');
        // Load user settings so evaluator/generator use correct config
        const { autoReplyService } = await import('./autoReplyService');
        await new Promise(resolve => setTimeout(resolve, 50)); // wait for storage load
        const userSettings = autoReplyService.getSettings();
        autoReplyTaskExecutor.syncAutoReplySettings(userSettings);
        resultData = await autoReplyTaskExecutor.execute();

      } else if (taskTypeLower === 'handle_notification') {
        const { notificationTaskExecutor } = await import('../utils/NotificationTaskExecutor');
        // Load saved settings from storage
        const stored = await chrome.storage.local.get('notificationTaskSettings');
        if (stored.notificationTaskSettings) {
          notificationTaskExecutor.updateSettings(stored.notificationTaskSettings);
        }
        resultData = await notificationTaskExecutor.execute();

      } else if (taskTypeLower === 'feed_report' || taskTypeLower === 'follow_digest') {
        const { followDigestExecutor } = await import('../utils/FollowDigestExecutor');
        // Load saved settings from storage
        const stored = await chrome.storage.local.get('followDigestSettings');
        const s = stored.followDigestSettings || {};
        resultData = await followDigestExecutor.execute({
          maxTweets: s.maxTweets || 100,
          customPrompt: s.customPrompt || '',
          interests: s.interests ? s.interests.split(',').map((i: string) => i.trim()).filter(Boolean) : [],
          keywords: s.keywords ? s.keywords.split(',').map((k: string) => k.trim()).filter(Boolean) : [],
          notificationType: notificationType || 'telegram_only',
        });

      } else if (taskTypeLower === 'generate_tweet') {
        resultData = await this.executeGenerateTweetTask(taskId);

      } else {
        // CUSTOM_TASK etc: use SSE/LangGraph flow initiated from browser
        resultData = await this.executeSSETaskLocal(taskId, executionId);
      }

      chrome.runtime.sendMessage({
        type: 'SCHEDULED_TASK_RESULT',
        taskId,
        executionId,
        success: true,
        data: resultData,
      });
    } catch (error) {
      console.error(`[CommandService] handleAlarmTriggeredTask error:`, error);
      chrome.runtime.sendMessage({
        type: 'SCHEDULED_TASK_RESULT',
        taskId,
        executionId,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Handle alarm-triggered scheduled draft publish.
   * Routes to tweetPoster based on draft type, reports result back to background.
   */
  private async handleScheduledDraftPublish(message: {
    draftId: string; draftType: string; content: any;
  }): Promise<void> {
    const { draftId, draftType, content } = message;
    console.log(`[CommandService] handleScheduledDraftPublish: ${draftId} (${draftType})`);

    try {
      const { tweetPoster } = await import('../utils/tweetPoster');
      let postResult: { success: boolean; error?: string; tweetId?: string; verifiedBy?: string };

      if (draftType === 'tweet') {
        const draft = content?.data?.drafts?.[0];
        if (!draft) throw new Error('No draft content found');
        postResult = await tweetPoster.postTweetWithVerify(
          draft.content,
          draft.media ? [draft.media] : undefined
        );
      } else if (draftType === 'thread') {
        const tweets = content?.data?.timeline?.map((t: any) => ({
          text: t.text,
          media: t.media,
        })) || [];
        if (tweets.length === 0) throw new Error('No thread content found');
        postResult = await tweetPoster.postThreadWithVerify(tweets);
      } else {
        throw new Error(`Unsupported draft type: ${draftType}`);
      }

      chrome.runtime.sendMessage({
        type: 'DRAFT_PUBLISH_RESULT',
        draftId,
        success: postResult.success,
        error: postResult.success ? undefined : postResult.error,
      });
    } catch (error) {
      chrome.runtime.sendMessage({
        type: 'DRAFT_PUBLISH_RESULT',
        draftId,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Execute GENERATE_TWEET task:
   * 1. Call backend API to generate tweet content
   * 2. Post the tweet via browser DOM
   */
  private async executeGenerateTweetTask(taskId: string): Promise<any> {
    console.log(`[CommandService] executeGenerateTweetTask: ${taskId}`);

    // Get task details for the prompt
    const taskResponse = await authService.fetchWithAuth(
      `https://api.bnbot.ai/api/v1/scheduled-tasks/${taskId}`,
      { method: 'GET' }
    );
    if (!taskResponse.ok) {
      throw new Error(`Failed to fetch task details: ${taskResponse.status}`);
    }
    const task = await taskResponse.json();

    // Generate tweet content via stateless chat
    let generatedContent = '';
    await new Promise<void>((resolve, reject) => {
      chatService.sendStatelessMessageStream(
        task.prompt || 'Generate a tweet',
        {
          onReasoning: () => {},
          onContent: (chunk: string) => { generatedContent += chunk; },
          onToolCall: () => {},
          onToolResult: () => {},
          onComplete: () => resolve(),
          onError: (error: Error) => reject(error),
          onInterrupt: () => resolve(),
        }
      );
    });

    if (!generatedContent.trim()) {
      throw new Error('Generated tweet content is empty');
    }

    // Post the tweet
    const { tweetPoster } = await import('../utils/tweetPoster');
    const postResult = await tweetPoster.postTweetWithVerify(generatedContent.trim());

    if (!postResult.success) {
      throw new Error(postResult.error || 'Failed to post tweet');
    }

    return {
      content: generatedContent.trim(),
      tweet_id: postResult.tweetId,
      verified_by: postResult.verifiedBy,
    };
  }

  /**
   * Execute SSE/LangGraph task initiated from browser (for CUSTOM_TASK etc).
   * Similar to executeSSETask but triggered by alarm instead of WebSocket.
   */
  private async executeSSETaskLocal(taskId: string, executionId: string): Promise<any> {
    console.log(`[CommandService] executeSSETaskLocal: ${taskId}`);

    // Use the task's trigger endpoint to start the SSE flow
    return new Promise<any>(async (resolve, reject) => {
      try {
        // Get task details for trigger_id (use taskId as trigger context)
        const taskResponse = await authService.fetchWithAuth(
          `https://api.bnbot.ai/api/v1/scheduled-tasks/${taskId}`,
          { method: 'GET' }
        );
        if (!taskResponse.ok) {
          throw new Error(`Failed to fetch task: ${taskResponse.status}`);
        }

        // Start triggered task via SSE (reuse existing chatService method)
        await chatService.startTriggeredTask(taskId, {
          onInterrupt: async (actionType: string, actionInput: unknown, threadId: string) => {
            console.log('[CommandService] SSE task interrupt:', actionType);
            const { executeAction } = await import('./actionIntegration');

            const result = await executeAction(`action_${actionType}`, actionInput as Record<string, unknown>, {
              onComplete: () => {},
              onError: () => {},
              onProgress: () => {},
            });

            await chatService.resumeTriggeredTask(threadId, result.success, result.data, result.error);
          },
          onComplete: () => {
            console.log('[CommandService] SSE task completed');
            resolve({ completed: true });
          },
          onError: (error: Error) => {
            console.error('[CommandService] SSE task error:', error.message);
            reject(error);
          },
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Handle scheduled task trigger from backend
   *
   * 根据任务类型决定执行方式：
   * - HANDLE_NOTIFICATION: 调用 NotificationTaskExecutor（两阶段处理）
   * - AUTO_REPLY: 调用 autoReplyService
   * - 其他任务: 走 SSE/LangGraph 流程
   */
  private async handleScheduledTrigger(message: CommandMessage): Promise<void> {
    console.log('[CommandService] handleScheduledTrigger raw message:', JSON.stringify(message));
    const { trigger_id, task_name, execution_id, task_type, prompt } = message as any;
    if (!trigger_id) {
      console.warn('[CommandService] handleScheduledTrigger: missing trigger_id');
      return;
    }

    console.log('[CommandService] Scheduled trigger received:', task_name, 'type:', task_type, 'trigger_id:', trigger_id);

    try {
      // 根据任务类型决定执行方式（大小写不敏感）
      const taskTypeLower = (task_type || '').toLowerCase();
      console.log('[CommandService] taskTypeLower:', JSON.stringify(taskTypeLower), 'equals auto_reply:', taskTypeLower === 'auto_reply');

      if (taskTypeLower === 'handle_notification') {
        // HANDLE_NOTIFICATION: 使用 NotificationTaskExecutor（两阶段处理）
        await this.executeNotificationTask(trigger_id, execution_id, task_name);
      } else if (taskTypeLower === 'auto_reply') {
        // AUTO_REPLY: 使用 AutoReplyTaskExecutor
        await this.executeAutoReplyTaskV2(trigger_id, execution_id, task_name);
      } else if (taskTypeLower === 'feed_report' || taskTypeLower === 'follow_digest') {
        // FOLLOW_DIGEST: 使用 FollowDigestExecutor 刷推生成报告
        await this.executeFollowDigestTask(trigger_id, execution_id, task_name);
      } else {
        // 其他任务走 SSE/LangGraph 流程
        await this.executeSSETask(trigger_id, execution_id);
      }
    } catch (error) {
      console.error('[CommandService] handleScheduledTrigger error:', error);
      // 通知后端任务失败
      await this.reportTaskResult(trigger_id, execution_id, false, undefined, error instanceof Error ? error.message : 'Unknown error');
    }
  }

  /**
   * 直接执行自动回复任务（不走 SSE）
   *
   * 调用 autoReplyService 执行自动回复
   * - onlyProcessNotifications=true: 导航到通知 → 点击进入时间线 → 评估推文 → 生成回复 → 发布回复
   * - onlyProcessNotifications=false: 滚动时间线 → 评估推文 → 生成回复 → 发布回复
   */
  private async executeAutoReplyTask(triggerId: string, executionId: string, taskName: string, onlyProcessNotifications: boolean): Promise<void> {
    console.log('[CommandService] Executing auto-reply task with autoReplyService, onlyProcessNotifications:', onlyProcessNotifications);

    try {
      const { autoReplyService } = await import('./autoReplyService');
      const { DEFAULT_AUTO_REPLY_SETTINGS } = await import('../types/autoReply');

      // 根据任务类型设置 onlyProcessNotifications 模式
      const settings = {
        ...DEFAULT_AUTO_REPLY_SETTINGS,
        onlyProcessNotifications,         // HANDLE_NOTIFICATION=true, AUTO_REPLY=false
        requireConfirmation: false,       // 不需要确认，自动执行
        dryRunMode: false,                // 实际发布
      };

      // 监听完成事件
      let completed = false;
      let error: string | undefined;
      let repliesPosted = 0;

      const handleEvent = (event: any) => {
        console.log('[CommandService] AutoReply event:', event.type);

        if (event.type === 'reply_posted') {
          repliesPosted++;
        }

        if (event.type === 'stopped' || event.type === 'error') {
          completed = true;
          if (event.type === 'error') {
            error = event.message || 'Unknown error';
          }
          autoReplyService.removeEventListener(handleEvent);
        }
      };

      autoReplyService.addEventListener(handleEvent);

      // 启动自动回复（只处理通知模式）
      autoReplyService.start(settings);

      // 等待一轮处理完成（最多处理3条通知后自动停止）
      // 设置超时，避免无限等待
      const timeout = 5 * 60 * 1000; // 5分钟超时
      const startTime = Date.now();

      while (!completed && (Date.now() - startTime) < timeout) {
        await new Promise(resolve => setTimeout(resolve, 1000));

        // 检查是否已处理足够的通知（或没有更多通知）
        const session = autoReplyService.getSession();
        if (session && session.repliesPosted >= 3) {
          // 已发布3条回复，停止
          autoReplyService.stop();
          break;
        }
      }

      // 确保停止
      if (!completed) {
        autoReplyService.stop();
      }

      autoReplyService.removeEventListener(handleEvent);

      console.log('[CommandService] Notification task completed, replies posted:', repliesPosted);

      // 向后端报告结果
      await this.reportTaskResult(triggerId, executionId, !error, {
        replies_posted: repliesPosted,
      }, error);

    } catch (err) {
      console.error('[CommandService] Notification task failed:', err);
      await this.reportTaskResult(triggerId, executionId, false, undefined, err instanceof Error ? err.message : 'Unknown error');
    }
  }

  /**
   * 执行 AUTO_REPLY 任务（滚动时间线自动回复）
   *
   * 滚动时间线，评估推文，生成回复，发布回复
   */
  private async executeAutoReplyTaskV2(triggerId: string, executionId: string, taskName: string): Promise<void> {
    console.log('[CommandService] Executing auto-reply task with AutoReplyTaskExecutor...');

    try {
      const { autoReplyTaskExecutor } = await import('../utils/AutoReplyTaskExecutor');
      // Sync user settings so evaluator/generator use correct config
      const { autoReplyService } = await import('./autoReplyService');
      const userSettings = autoReplyService.getSettings();
      autoReplyTaskExecutor.syncAutoReplySettings(userSettings);

      const result = await autoReplyTaskExecutor.execute();

      console.log('[CommandService] Auto-reply task completed:', result);

      // 向后端报告结果
      await this.reportTaskResult(triggerId, executionId, result.errors.length === 0, {
        tweets_scanned: result.tweetsScanned,
        tweets_evaluated: result.tweetsEvaluated,
        replies_posted: result.repliesPosted,
        replies_skipped: result.repliesSkipped,
        liked: result.liked,
        duration_ms: result.duration,
      }, result.errors.length > 0 ? result.errors.join('; ') : undefined);

    } catch (err) {
      console.error('[CommandService] Auto-reply task failed:', err);
      await this.reportTaskResult(triggerId, executionId, false, undefined, err instanceof Error ? err.message : 'Unknown error');
    }
  }

  /**
   * 执行 HANDLE_NOTIFICATION 任务（两阶段处理）
   *
   * Phase 1: 处理新帖子通知 (最多20条，30分钟内)
   * Phase 2: 处理回复通知 (最多50条，当天的)
   */
  private async executeNotificationTask(triggerId: string, executionId: string, taskName: string): Promise<void> {
    console.log('[CommandService] Executing notification task with NotificationTaskExecutor...');

    try {
      const { notificationTaskExecutor } = await import('../utils/NotificationTaskExecutor');

      // Load saved settings from storage (same as alarm path)
      const stored = await chrome.storage.local.get('notificationTaskSettings');
      if (stored.notificationTaskSettings) {
        notificationTaskExecutor.updateSettings(stored.notificationTaskSettings);
      }

      const result = await notificationTaskExecutor.execute();

      console.log('[CommandService] Notification task completed:', result);

      // 向后端报告结果
      await this.reportTaskResult(triggerId, executionId, result.errors.length === 0, {
        phase1_processed: result.phase1.processed,
        phase1_replied: result.phase1.replied,
        phase1_liked: result.phase1.liked,
        phase1_skipped: result.phase1.skipped,
        phase2_processed: result.phase2.processed,
        phase2_replied: result.phase2.replied,
        phase2_liked: result.phase2.liked,
        phase2_skipped: result.phase2.skipped,
        duration_ms: result.duration,
      }, result.errors.length > 0 ? result.errors.join('; ') : undefined);

    } catch (err) {
      console.error('[CommandService] Notification task failed:', err);
      await this.reportTaskResult(triggerId, executionId, false, undefined, err instanceof Error ? err.message : 'Unknown error');
    }
  }

  /**
   * 执行 FOLLOW_DIGEST 任务（刷推生成报告）
   *
   * 流程：
   * 1. 导航到 Following tab
   * 2. 滚动收集推文（通过拦截 API）
   * 3. 发送给后端生成报告
   * 4. 后端 AI 生成报告并推送到 Telegram
   */
  private async executeFollowDigestTask(triggerId: string, executionId: string, taskName: string): Promise<void> {
    console.log('[CommandService] Executing follow digest task with FollowDigestExecutor...');

    try {
      const { followDigestExecutor } = await import('../utils/FollowDigestExecutor');

      const result = await followDigestExecutor.execute({
        maxTweets: 100,
      });

      console.log('[CommandService] Follow digest task completed:', result);

      // 向后端报告结果
      await this.reportTaskResult(triggerId, executionId, result.success, {
        tweets_collected: result.tweetsCollected,
        duration_ms: result.duration,
      }, result.error);

    } catch (err) {
      console.error('[CommandService] Follow digest task failed:', err);
      await this.reportTaskResult(triggerId, executionId, false, undefined, err instanceof Error ? err.message : 'Unknown error');
    }
  }

  /**
   * 通过 SSE 执行任务（LangGraph 流程）
   */
  private async executeSSETask(triggerId: string, executionId: string): Promise<void> {
    await chatService.startTriggeredTask(triggerId, {
      onInterrupt: async (actionType: string, actionInput: unknown, threadId: string) => {
        console.log('[CommandService] Triggered task interrupt:', actionType);
        const { executeAction } = await import('./actionIntegration');

        const result = await executeAction(`action_${actionType}`, actionInput as Record<string, unknown>, {
          onComplete: () => {},
          onError: () => {},
          onProgress: () => {}
        });

        // Resume the graph with action result
        await chatService.resumeTriggeredTask(threadId, result.success, result.data, result.error);
      },
      onComplete: () => {
        console.log('[CommandService] Triggered task completed:', executionId);
      },
      onError: (error: Error) => {
        console.error('[CommandService] Triggered task error:', error.message);
      }
    });
  }

  /**
   * 向后端报告任务执行结果
   */
  private async reportTaskResult(
    triggerId: string,
    executionId: string,
    success: boolean,
    data?: unknown,
    error?: string
  ): Promise<void> {
    console.log('[CommandService] reportTaskResult called:', { triggerId, executionId, success, data, error });
    try {
      const API_BASE_URL = (await import('./chatService')).API_BASE_URL;
      const url = `${API_BASE_URL}/api/v1/scheduled-tasks/triggers/${triggerId}/complete`;
      console.log('[CommandService] Calling API:', url);

      const response = await authService.fetchWithAuth(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          execution_id: executionId,
          success,
          data,
          error,
        }),
      });

      console.log('[CommandService] Task result API response:', response.status, response.ok);
      if (!response.ok) {
        const text = await response.text();
        console.error('[CommandService] Task result API error:', text);
      } else {
        console.log('[CommandService] Task result reported:', success ? 'success' : 'failed');
      }
    } catch (err) {
      console.error('[CommandService] Failed to report task result:', err);
    }
  }
}

export const commandService = new CommandService();
