// Endpoint: POST /api/v1/ai/agent-v2

import { authService } from './authService';

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:8000';


export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string | Array<
    | { type: 'text'; text: string }
    | { type: 'image_url'; image_url: { url: string } }
    | { type: 'file'; data: string; mime_type: string; filename?: string }
  >;
}

export interface ChatRequest {
  messages: ChatMessage[];
  model?: string;
}

export interface StreamEvent {
  type: 'session_start' | 'node_start' | 'model_start' | 'reasoning' | 'content' | 'tool_call' | 'tool_start' | 'tool_result' | 'tool_end' | 'node_end' | 'complete' | 'error' | 'interrupt';
  content?: string;
  name?: string;
  step?: number;
  output?: any;
  usage?: {
    total_tokens: number;
    input_tokens: number;
    output_tokens: number;
  };
  tool_calls?: any[];
  // For tool calls
  tool_name?: string;
  tool_args?: Record<string, any>;
  tool_result?: string;
  artifact?: any;
  // For tool_start (x_action_ prefix tools)
  input?: Record<string, any>;
  id?: string;
  // For session_start and interrupt events
  thread_id?: string;
  action_type?: string;
  action_input?: Record<string, any>;
}

export interface ChatStreamCallback {
  onSessionStart?: (threadId: string) => void;
  onModelStart?: (name: string) => void;
  onReasoning: (chunk: string) => void;
  onContent: (chunk: string) => void;
  onToolCall: (name: string, args?: Record<string, any>) => void;
  onToolResult: (name: string, result: string) => void;
  onToolEnd?: (name: string, artifact: any) => void;
  /** Called when backend triggers a frontend Action via x_action_ prefixed tool */
  onActionCall?: (actionId: string, args: Record<string, any>, callId: string) => void;
  /** Called when backend sends an interrupt event for data collection actions */
  onInterrupt?: (actionType: string, actionInput: Record<string, any>, threadId: string) => void;
  onComplete: () => void;
  onError: (error: Error) => void;
}

class ChatService {
  private conversationHistory: ChatMessage[] = [];
  private sessionContexts: Map<string, ChatMessage[]> = new Map();
  private currentSessionId: string | null = null;
  private currentThreadId: string | null = null;

  /**
   * Set the current session context
   * When switching between different chat panels (e.g., different tweets),
   * each should have its own isolated conversation history
   */
  setSessionContext(sessionId: string): void {
    this.currentSessionId = sessionId;

    // Initialize session if it doesn't exist
    if (!this.sessionContexts.has(sessionId)) {
      this.sessionContexts.set(sessionId, []);
    }

    // Load the session's history into the active conversationHistory
    const sessionHistory = this.sessionContexts.get(sessionId) || [];
    this.conversationHistory = [...sessionHistory];
  }

  /**
   * Get current session ID
   */
  getCurrentSessionId(): string | null {
    return this.currentSessionId;
  }

  /**
   * Get current thread ID (used for interrupt/resume flow)
   */
  getCurrentThreadId(): string | null {
    return this.currentThreadId;
  }

  /**
   * Set current thread ID (called when interrupt event is received)
   */
  setCurrentThreadId(threadId: string): void {
    this.currentThreadId = threadId;
  }

  /**
   * Clear thread ID (called when conversation completes or errors)
   */
  clearThreadId(): void {
    this.currentThreadId = null;
  }

  /**
   * Persist current history to the session context
   */
  private persistSessionHistory(): void {
    if (this.currentSessionId) {
      this.sessionContexts.set(this.currentSessionId, [...this.conversationHistory]);
    }
  }

  /**
   * Clear a specific session
   */
  clearSession(sessionId?: string): void {
    const idToClear = sessionId || this.currentSessionId;
    if (idToClear) {
      this.sessionContexts.delete(idToClear);
      // If clearing current session, also clear the active history
      if (idToClear === this.currentSessionId) {
        this.conversationHistory = [];
      }
    }
  }

  /**
   * Clear all sessions and conversation history
   * Used when user logs out or logs in
   */
  clearAllSessions(): void {
    console.log('[ChatService] Clearing all sessions and history');
    this.sessionContexts.clear();
    this.conversationHistory = [];
    this.currentSessionId = null;
  }

  /**
   * Parse SSE data line
   */
  private parseSSELine(line: string): StreamEvent | null {
    if (!line.trim().startsWith('data:')) {
      return null;
    }

    // Remove 'data:' prefix and whitespace
    const jsonStr = line.replace(/^data:\s*/, '');
    if (!jsonStr.trim()) {
      return null;
    }

    try {
      return JSON.parse(jsonStr) as StreamEvent;
    } catch (e) {
      console.error('Failed to parse SSE data:', jsonStr, e);
      return null;
    }
  }

  /**
   * Send a message and receive streaming response
   */
  async sendMessageStream(
    userMessage: string,
    callbacks: ChatStreamCallback,
    signal?: AbortSignal,
    images?: string[],
    files?: { data: string; mime_type: string; filename: string }[]
  ): Promise<void> {
    // Add user message to history
    // Check if we have images or files to attach
    if ((images && images.length > 0) || (files && files.length > 0)) {
      const content: any[] = [{ type: 'text', text: userMessage }];

      // Add images
      if (images) {
        images.forEach(img => {
          content.push({ type: 'image_url', image_url: { url: img } });
        });
      }

      // Add files
      if (files) {
        files.forEach(file => {
          content.push({
            type: 'file',
            data: file.data,
            mime_type: file.mime_type,
            filename: file.filename
          });
        });
      }

      this.conversationHistory.push({
        role: 'user',
        content: content
      });
    } else {
      this.conversationHistory.push({
        role: 'user',
        content: userMessage,
      });
    }

    const requestBody: ChatRequest = {
      messages: this.conversationHistory,
    };

    try {
      // Debug: Check if we have a token before making request
      const token = await authService.getAccessToken();
      console.log('[ChatService] Making agent-v2 request, has token:', !!token, token ? `(${token.substring(0, 20)}...)` : '');

      // Use fetchStreamWithAuth to get a real Response object with a readable body stream
      const response = await authService.fetchStreamWithAuth(`${API_BASE_URL}/api/v1/ai/agent-v2`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal,
      });

      if (!response.ok) {
        // Try to parse error response body
        let errorMessage = `HTTP error! status: ${response.status}`;
        try {
          const errorBody = await response.json();
          if (errorBody.detail) {
            errorMessage = errorBody.detail;
          } else if (errorBody.message) {
            errorMessage = errorBody.message;
          }
        } catch {
          // Ignore JSON parse errors
        }

        const error = new Error(errorMessage);
        (error as any).status = response.status;
        throw error;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('Response body is not readable');
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let assistantMessage = '';

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          // Process any remaining data in buffer
          if (buffer.trim()) {
            const lines = buffer.split('\n');
            for (const line of lines) {
              if (line.trim()) {
                const event = this.parseSSELine(line);
                if (event) {
                  this.handleEvent(event, callbacks);
                  if (event.type === 'content' && event.content) {
                    assistantMessage += event.content;
                  }
                }
              }
            }
          }

          // Add assistant response to history
          if (assistantMessage) {
            this.conversationHistory.push({
              role: 'assistant',
              content: assistantMessage,
            });
          }
          // Persist the updated history to session context
          this.persistSessionHistory();
          callbacks.onComplete();
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        // Process complete lines
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          if (line.trim()) {
            const event = this.parseSSELine(line);
            if (event) {
              this.handleEvent(event, callbacks);
              if (event.type === 'content' && event.content) {
                assistantMessage += event.content;
              }
            }
          }
        }
      }
    } catch (error) {
      // Remove the failed user message from history
      this.conversationHistory.pop();
      callbacks.onError(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Send a one-shot message without affecting conversation history.
   * Used for AutoReply evaluations and generations where we don't want
   * to pollute the user's chat sessions.
   */
  async sendStatelessMessageStream(
    userMessage: string,
    callbacks: ChatStreamCallback,
    signal?: AbortSignal
  ): Promise<void> {
    const requestBody: ChatRequest = {
      messages: [{ role: 'user', content: userMessage }],
    };

    try {
      const token = await authService.getAccessToken();
      console.log('[ChatService] Making stateless agent-v2 request, has token:', !!token);

      const response = await authService.fetchStreamWithAuth(`${API_BASE_URL}/api/v1/ai/agent-v2`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal,
      });

      if (!response.ok) {
        let errorMessage = `HTTP error! status: ${response.status}`;
        try {
          const errorBody = await response.json();
          if (errorBody.detail) {
            errorMessage = errorBody.detail;
          } else if (errorBody.message) {
            errorMessage = errorBody.message;
          }
        } catch {
          // Ignore JSON parse errors
        }

        const error = new Error(errorMessage);
        (error as any).status = response.status;
        throw error;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('Response body is not readable');
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          // Process any remaining data in buffer
          if (buffer.trim()) {
            const lines = buffer.split('\n');
            for (const line of lines) {
              if (line.trim()) {
                const event = this.parseSSELine(line);
                if (event) {
                  this.handleEvent(event, callbacks);
                }
              }
            }
          }
          // No history management - just complete
          callbacks.onComplete();
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        // Process complete lines
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.trim()) {
            const event = this.parseSSELine(line);
            if (event) {
              this.handleEvent(event, callbacks);
            }
          }
        }
      }
    } catch (error) {
      callbacks.onError(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Handle individual stream events
   */
  private handleEvent(event: StreamEvent, callbacks: ChatStreamCallback): void {
    switch (event.type) {
      case 'session_start':
        if (event.thread_id && callbacks.onSessionStart) {
          callbacks.onSessionStart(event.thread_id);
        }
        break;
      case 'model_start':
        console.log('[ChatService] Model start event:', event);
        if (callbacks.onModelStart) {
          callbacks.onModelStart(event.name || 'unknown');
        }
        break;
      case 'reasoning':
        if (event.content) {
          callbacks.onReasoning(event.content);
        }
        break;
      case 'content':
        if (event.content) {
          // Filter out internal JSON that shouldn't be displayed
          // Check if content contains {"type": "needs_composer", ...} anywhere
          const needsComposerPattern = /\{\s*"type"\s*:\s*"needs_composer"/;
          if (needsComposerPattern.test(event.content)) {
            console.log('[ChatService] Filtering out needs_composer content:', event.content.substring(0, 100));
            break;
          }
          callbacks.onContent(event.content);
        }
        break;
      case 'tool_call':
      case 'tool_start':
        // Support both tool_name and name fields for compatibility
        const toolName = event.tool_name || event.name;
        console.log('[ChatService] Tool start/call event:', event.type, 'name:', toolName, 'raw event:', JSON.stringify(event));

        // Check if this is a frontend Action (x_action_ prefix)
        if (toolName && toolName.startsWith('x_action_')) {
          const actionId = toolName.replace('x_action_', '');
          const actionArgs = event.input || event.tool_args || {};
          const callId = event.id || '';
          console.log('[ChatService] X-Action detected:', actionId, 'args:', actionArgs, 'callId:', callId);
          if (callbacks.onActionCall) {
            callbacks.onActionCall(actionId, actionArgs, callId);
          }
        } else if (toolName) {
          callbacks.onToolCall(toolName, event.tool_args);
        }
        break;
      case 'tool_result':
        const toolResultName = event.tool_name || event.name;
        if (toolResultName && event.tool_result) {
          callbacks.onToolResult(toolResultName, event.tool_result);
        }
        break;
      case 'tool_end':
        // Support both artifact and output fields for the result data
        const toolEndName = event.tool_name || event.name;
        const artifact = event.artifact || event.output;
        console.log('[ChatService] Tool end event:', 'name:', toolEndName, 'has artifact:', !!artifact, 'raw event:', JSON.stringify(event));
        if (toolEndName && callbacks.onToolEnd) {
          // Always call onToolEnd even if artifact is null/undefined to handle error cases
          callbacks.onToolEnd(toolEndName, artifact);
        }
        break;
      case 'error':
        callbacks.onError(new Error(event.content || 'Unknown error'));
        break;
      case 'interrupt':
        // Handle interrupt event for data collection actions
        // The SSE stream will close after this event, and frontend should call resumeGraph() with results
        console.log('[ChatService] Interrupt event received:', event.action_type, 'thread_id:', event.thread_id);
        if (event.action_type && event.thread_id && callbacks.onInterrupt) {
          this.setCurrentThreadId(event.thread_id);
          callbacks.onInterrupt(event.action_type, event.action_input || {}, event.thread_id);
        }
        break;
    }
  }

  /**
   * Start a new chat session (clears current session history)
   */
  startNewChat(): void {
    this.conversationHistory = [];
    this.clearThreadId();
    this.persistSessionHistory();
  }

  /**
   * Remove the last exchange (user + assistant) from history
   */
  removeLastExchange(): void {
    // Remove last assistant message if exists
    if (this.conversationHistory.length > 0 &&
      this.conversationHistory[this.conversationHistory.length - 1].role === 'assistant') {
      this.conversationHistory.pop();
    }
    // Remove last user message if exists
    if (this.conversationHistory.length > 0 &&
      this.conversationHistory[this.conversationHistory.length - 1].role === 'user') {
      this.conversationHistory.pop();
    }
  }

  /**
   * Get current conversation history
   */
  getHistory(): ChatMessage[] {
    return [...this.conversationHistory];
  }

  /**
   * Interrupt an active thread
   */
  async interruptThread(threadId: string): Promise<void> {
    try {
      const response = await authService.fetchWithAuth(`${API_BASE_URL}/api/v1/ai/interrupt-thread`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ thread_id: threadId }),
      });

      if (!response.ok) {
        console.error('[ChatService] Failed to interrupt thread:', response.status);
      } else {
        const result = await response.json();
        console.log('[ChatService] Thread interrupted:', result);
      }
    } catch (error) {
      console.error('[ChatService] Error interrupting thread:', error);
    }
  }

  /**
   * Send action result back to backend and continue the conversation.
   * This is called after a frontend Action (x_action_*) completes.
   */
  async sendActionResult(
    actionId: string,
    success: boolean,
    data: any,
    callbacks: ChatStreamCallback,
    signal?: AbortSignal
  ): Promise<void> {
    // Create action_result message content
    const actionResultContent = {
      type: 'action_result',
      action_id: actionId,
      success: success,
      data: data
    };

    // Add the action_result as a user message
    this.conversationHistory.push({
      role: 'user',
      content: [actionResultContent] as any
    });

    const requestBody: ChatRequest = {
      messages: this.conversationHistory,
    };

    try {
      const token = await authService.getAccessToken();
      console.log('[ChatService] Sending action result for:', actionId, 'success:', success);

      const response = await authService.fetchStreamWithAuth(`${API_BASE_URL}/api/v1/ai/agent-v2`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal,
      });

      if (!response.ok) {
        let errorMessage = `HTTP error! status: ${response.status}`;
        try {
          const errorBody = await response.json();
          if (errorBody.detail) {
            errorMessage = errorBody.detail;
          } else if (errorBody.message) {
            errorMessage = errorBody.message;
          }
        } catch {
          // Ignore JSON parse errors
        }

        const error = new Error(errorMessage);
        (error as any).status = response.status;
        throw error;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('Response body is not readable');
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let assistantMessage = '';

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          // Process any remaining data in buffer
          if (buffer.trim()) {
            const lines = buffer.split('\n');
            for (const line of lines) {
              if (line.trim()) {
                const event = this.parseSSELine(line);
                if (event) {
                  this.handleEvent(event, callbacks);
                  if (event.type === 'content' && event.content) {
                    assistantMessage += event.content;
                  }
                }
              }
            }
          }

          // Add assistant response to history
          if (assistantMessage) {
            this.conversationHistory.push({
              role: 'assistant',
              content: assistantMessage,
            });
          }
          // Persist the updated history to session context
          this.persistSessionHistory();
          callbacks.onComplete();
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        // Process complete lines
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.trim()) {
            const event = this.parseSSELine(line);
            if (event) {
              this.handleEvent(event, callbacks);
              if (event.type === 'content' && event.content) {
                assistantMessage += event.content;
              }
            }
          }
        }
      }
    } catch (error) {
      // Remove the failed action result message from history
      this.conversationHistory.pop();
      callbacks.onError(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Resume the graph after an interrupt event.
   * Called after frontend completes a DOM operation triggered by an interrupt.
   * POST /api/v1/ai/resume
   */
  async resumeGraph(
    threadId: string,
    success: boolean,
    data: any,
    error: string | null,
    callbacks: ChatStreamCallback,
    signal?: AbortSignal
  ): Promise<void> {
    const requestBody = {
      thread_id: threadId,
      success,
      data,
      error,
    };

    try {
      const token = await authService.getAccessToken();
      console.log('[ChatService] Resuming graph, thread_id:', threadId, 'success:', success);

      const response = await authService.fetchStreamWithAuth(`${API_BASE_URL}/api/v1/ai/resume`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal,
      });

      if (!response.ok) {
        let errorMessage = `HTTP error! status: ${response.status}`;
        try {
          const errorBody = await response.json();
          if (errorBody.detail) {
            errorMessage = errorBody.detail;
          } else if (errorBody.message) {
            errorMessage = errorBody.message;
          }
        } catch {
          // Ignore JSON parse errors
        }

        const err = new Error(errorMessage);
        (err as any).status = response.status;
        throw err;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('Response body is not readable');
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let assistantMessage = '';

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          // Process any remaining data in buffer
          if (buffer.trim()) {
            const lines = buffer.split('\n');
            for (const line of lines) {
              if (line.trim()) {
                const event = this.parseSSELine(line);
                if (event) {
                  this.handleEvent(event, callbacks);
                  if (event.type === 'content' && event.content) {
                    assistantMessage += event.content;
                  }
                }
              }
            }
          }

          // Add assistant response to history if any
          if (assistantMessage) {
            this.conversationHistory.push({
              role: 'assistant',
              content: assistantMessage,
            });
          }
          // Persist the updated history to session context
          this.persistSessionHistory();
          // Clear thread ID on complete
          this.clearThreadId();
          callbacks.onComplete();
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        // Process complete lines
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.trim()) {
            const event = this.parseSSELine(line);
            if (event) {
              this.handleEvent(event, callbacks);
              if (event.type === 'content' && event.content) {
                assistantMessage += event.content;
              }
            }
          }
        }
      }
    } catch (err) {
      // Clear thread ID on error
      this.clearThreadId();
      callbacks.onError(err instanceof Error ? err : new Error(String(err)));
    }
  }

  /**
   * Send a one-shot message using Gemini direct chat (chat-v2) for AI analysis.
   * Streams the response and calls onChunk for each content chunk.
   * POST /api/v1/ai/chat-v2
   */
  async sendChatV2Stream(
    prompt: string,
    onChunk: (chunk: string) => void,
    model: string = 'gemini-2.5-flash',
    signal?: AbortSignal
  ): Promise<void> {
    const requestBody = {
      messages: [{ role: 'user', content: prompt }],
      model
    };

    try {
      const token = await authService.getAccessToken();
      console.log('[ChatService] Making chat-v2 request, has token:', !!token, 'model:', model);

      const response = await authService.fetchStreamWithAuth(`${API_BASE_URL}/api/v1/ai/chat-v2`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal,
      });

      if (!response.ok) {
        let errorMessage = `HTTP error! status: ${response.status}`;
        try {
          const errorBody = await response.json();
          if (errorBody.detail) {
            errorMessage = errorBody.detail;
          } else if (errorBody.message) {
            errorMessage = errorBody.message;
          }
        } catch {
          // Ignore JSON parse errors
        }
        throw new Error(errorMessage);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('Response body is not readable');
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          // Process any remaining data in buffer
          if (buffer.trim()) {
            const lines = buffer.split('\n');
            for (const line of lines) {
              if (line.trim()) {
                const event = this.parseSSELine(line);
                if (event && event.type === 'content' && event.content) {
                  onChunk(event.content);
                }
              }
            }
          }
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        // Process complete lines
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.trim()) {
            const event = this.parseSSELine(line);
            if (event && event.type === 'content' && event.content) {
              onChunk(event.content);
            }
          }
        }
      }
    } catch (error) {
      console.error('[ChatService] chat-v2 error:', error);
      throw error;
    }
  }

  /**
   * Quick content evaluation using lightweight AI model
   * POST /api/v1/ai/quick-eval
   *
   * Used for fast content matching before generating full replies.
   * Much faster and cheaper than full AI evaluation.
   */
  async quickEval(params: {
    tweetContent: string;
    authorHandle?: string;
    authorBio?: string;
    targetTypes?: string;
    customInstructions?: string;
  }): Promise<{
    shouldReply: boolean;
    reason: string;
    confidence: number;
    matchedTypes: string[];
  }> {
    try {
      console.log('[ChatService] Quick eval request:', params);

      const response = await authService.fetchWithAuth(`${API_BASE_URL}/api/v1/ai/quick-eval`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tweet_content: params.tweetContent,
          author_handle: params.authorHandle || '',
          author_bio: params.authorBio || '',
          target_types: params.targetTypes || '',
          custom_instructions: params.customInstructions || '',
        }),
      });

      if (!response.ok) {
        console.error('[ChatService] Quick eval failed:', response.status);
        // On error, default to allowing reply
        return {
          shouldReply: true,
          reason: `API error: ${response.status}`,
          confidence: 0,
          matchedTypes: [],
        };
      }

      const data = await response.json();
      console.log('[ChatService] Quick eval response:', data);

      return {
        shouldReply: data.should_reply ?? true,
        reason: data.reason || '',
        confidence: data.confidence ?? 0.5,
        matchedTypes: data.matched_types || [],
      };
    } catch (error) {
      console.error('[ChatService] Quick eval error:', error);
      // On error, default to allowing reply
      return {
        shouldReply: true,
        reason: `Error: ${error instanceof Error ? error.message : 'Unknown'}`,
        confidence: 0,
        matchedTypes: [],
      };
    }
  }

  /**
   * Get cached tweet info from public API
   * GET /api/v1/x-public/cached-tweet-info
   */
  async getCachedTweetInfo(tweetIds: string[]): Promise<any> {
    try {
      const idsParam = tweetIds.join(',');
      const response = await authService.fetchWithAuth(`${API_BASE_URL}/api/v1/x-public/cached-tweet-info?tweet_ids=${idsParam}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'x-public-key': process.env.X_PUBLIC_API_KEY || '',
        },
      });

      if (!response.ok) {
        console.error('[ChatService] Failed to get cached tweet info:', response.status);
        return null;
      }

      return await response.json();
    } catch (error) {
      console.error('[AIChatService] Error getting cached tweet info:', error);
      return null;
    }
  }

  /**
   * Start a triggered scheduled task via SSE
   * Called when receiving a scheduled_trigger message from WebSocket
   * POST /api/v1/scheduled-tasks/triggers/{trigger_id}/start
   */
  async startTriggeredTask(
    triggerId: string,
    callbacks: {
      onInterrupt: (actionType: string, actionInput: unknown, threadId: string) => Promise<void>;
      onComplete: () => void;
      onError: (error: Error) => void;
    }
  ): Promise<void> {
    try {
      console.log('[ChatService] Starting triggered task:', triggerId);

      const response = await authService.fetchStreamWithAuth(
        `${API_BASE_URL}/api/v1/scheduled-tasks/triggers/${triggerId}/start`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        let errorMessage = `HTTP error! status: ${response.status}`;
        try {
          const errorBody = await response.json();
          if (errorBody.detail) {
            errorMessage = errorBody.detail;
          }
        } catch {
          // Ignore JSON parse errors
        }
        throw new Error(errorMessage);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('Response body is not readable');
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          // Process any remaining data in buffer
          if (buffer.trim()) {
            const lines = buffer.split('\n');
            for (const line of lines) {
              if (line.trim()) {
                const event = this.parseSSELine(line);
                if (event) {
                  await this.handleTriggeredTaskEvent(event, callbacks);
                }
              }
            }
          }
          callbacks.onComplete();
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        // Process complete lines
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.trim()) {
            const event = this.parseSSELine(line);
            if (event) {
              await this.handleTriggeredTaskEvent(event, callbacks);
            }
          }
        }
      }
    } catch (error) {
      console.error('[ChatService] startTriggeredTask error:', error);
      callbacks.onError(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Handle events from triggered task SSE stream
   */
  private async handleTriggeredTaskEvent(
    event: StreamEvent,
    callbacks: {
      onInterrupt: (actionType: string, actionInput: unknown, threadId: string) => Promise<void>;
      onComplete: () => void;
      onError: (error: Error) => void;
    }
  ): Promise<void> {
    switch (event.type) {
      case 'interrupt':
        if (event.action_type && event.thread_id) {
          console.log('[ChatService] Triggered task interrupt:', event.action_type);
          await callbacks.onInterrupt(event.action_type, event.action_input || {}, event.thread_id);
        }
        break;
      case 'error':
        callbacks.onError(new Error(event.content || 'Unknown error'));
        break;
      case 'complete':
        // Complete is handled by the done check in the reader loop
        break;
      default:
        // Log other events for debugging
        console.log('[ChatService] Triggered task event:', event.type);
        break;
    }
  }

  /**
   * Resume a triggered task after frontend action completes
   * POST /api/v1/ai/resume
   */
  async resumeTriggeredTask(
    threadId: string,
    success: boolean,
    data: unknown,
    error?: string
  ): Promise<void> {
    try {
      console.log('[ChatService] Resuming triggered task:', threadId, 'success:', success);

      const response = await authService.fetchWithAuth(`${API_BASE_URL}/api/v1/ai/resume`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          thread_id: threadId,
          success,
          data,
          error,
        }),
      });

      if (!response.ok) {
        console.error('[ChatService] Failed to resume triggered task:', response.status);
      } else {
        console.log('[ChatService] Triggered task resumed successfully');
      }
    } catch (err) {
      console.error('[ChatService] Error resuming triggered task:', err);
    }
  }
}

export const chatService = new ChatService();
