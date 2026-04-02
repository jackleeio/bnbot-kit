'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { Message, SessionStatus, GeneratedTopic, ToolCallInfo, ToolStatus } from '@/types/chat';
import { buildToolInputSummary } from '@/utils/inlineToolCalls';

const findToolInfoByIdOrName = (
  list: ToolCallInfo[],
  id?: string,
  name?: string,
) =>
  list.find(
    (tool) =>
      (id && tool.id === id) || (!id && name && tool.name === name),
  );

const upsertToolInfo = (
  list: ToolCallInfo[],
  params: {
    id?: string;
    name?: string;
    status?: ToolStatus;
    args?: Record<string, unknown>;
    output?: string;
  },
) => {
  const target = findToolInfoByIdOrName(list, params.id, params.name);

  if (target) {
    if (params.status) {
      target.status = params.status;
    }
    if (params.output !== undefined) {
      target.output = params.output;
    }
    if (params.args) {
      target.args = params.args;
      target.inputSummary = buildToolInputSummary(
        target.name,
        params.args,
      );
    }
    return target;
  }

  if (!params.name) {
    return null;
  }

  const newTool: ToolCallInfo = {
    id: params.id,
    name: params.name,
    status: params.status ?? 'pending',
    args: params.args,
    output: params.output,
  };

  if (params.args) {
    newTool.inputSummary = buildToolInputSummary(params.name, params.args);
  }

  list.push(newTool);
  return newTool;
};

const parseSsePayload = (payload: string) => {
  try {
    return JSON.parse(payload);
  } catch {
    // Attempt to normalize single-quoted or Python-style objects
    const normalized = payload
      // Convert single-quoted keys to double-quoted keys
      .replace(/([{,]\s*)'([^'\\]+)'(\s*:)/g, '$1"$2"$3')
      // Convert single-quoted string values (that don't contain single quotes) to double-quoted
      .replace(/:\s*'([^'\\]*)'(\s*[},])/g, (_match, value, tail) => {
        const escaped = value.replace(/"/g, '\\"');
        return `:"${escaped}"${tail}`;
      })
      // Normalize Python-style booleans/null
      .replace(/\bNone\b/g, 'null')
      .replace(/\bTrue\b/g, 'true')
      .replace(/\bFalse\b/g, 'false');

    try {
      return JSON.parse(normalized);
    } catch (error) {
      console.warn('Skipping unparsable SSE payload:', payload, error);
      return null;
    }
  }
};

interface UseChatProps {
  webSearchEnabled: boolean;
  onShowLoginPrompt: () => void;
}

export const useChat = ({ webSearchEnabled, onShowLoginPrompt }: UseChatProps) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [currentAssistantMessage, setCurrentAssistantMessage] = useState('');
  const [currentReasoningContent, setCurrentReasoningContent] = useState('');
  const [currentToolCalls, setCurrentToolCalls] = useState<string[]>([]);
  const [currentToolCallsInfo, setCurrentToolCallsInfo] = useState<ToolCallInfo[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [sessionStatus, setSessionStatus] = useState<SessionStatus>('idle');
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const messagesRef = useRef<Message[]>([]);
  const topicRequestControllersRef = useRef<Map<string, AbortController>>(new Map());

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const clearActiveTopics = useCallback((history: Message[]) => {
    let changed = false;

    const result = history.map((msg) => {
      if (
        msg.role === 'assistant' &&
        !msg.topicsDismissed &&
        ((msg.topics?.length ?? 0) > 0 || msg.topicsLoading)
      ) {
        changed = true;
        return {
          ...msg,
          topics: [],
          topicsDismissed: true,
          topicsLoading: false,
        };
      }
      return msg;
    });

    return changed ? result : history;
  }, []);

  const sanitizeTopicContext = useCallback((context: string) => {
    let result = context
      .replace(/<tool-call>[\s\S]*?<\/tool-call>/g, '')
      .replace(/<tool-result>[\s\S]*?<\/tool-result>/g, '')
      .replace(/<\/?[^>]+(>|$)/g, '');

    // Remove tool call JSON objects and their fragments
    // Pattern 1: Complete objects like {'name': '...', 'args': {...}, 'id': '...', 'type': 'tool_call'}
    // Pattern 2: Fragments like , 'id': '...', 'type': 'tool_call'}
    let previousResult = '';
    while (previousResult !== result) {
      previousResult = result;
      // Remove complete tool call objects
      result = result.replace(/\{['"]name['"]\s*:\s*['"][^'"]*['"][^}]*\}/g, '');
      // Remove leftover fragments starting with comma
      result = result.replace(/,\s*['"]id['"]\s*:\s*['"][^'"]*['"][^}]*\}/g, '');
      result = result.replace(/,\s*['"]type['"]\s*:\s*['"]tool_call['"][^}]*\}/g, '');
      // Remove any standalone } that might be left
      result = result.replace(/^\s*\}\s*$/gm, '');
    }

    return result
      .replace(/🛠️\s*使用工具:.*$/gm, '')
      .replace(/\s+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }, []);

  const setMessagesWithRef = useCallback(
    (updater: Message[] | ((prev: Message[]) => Message[])) => {
      if (typeof updater === 'function') {
        setMessages((prev) => {
          const next = (updater as (previous: Message[]) => Message[])(prev);
          messagesRef.current = next;
          return next;
        });
      } else {
        messagesRef.current = updater;
        setMessages(updater);
      }
    },
    [],
  );

  const cancelPendingTopicRequests = useCallback(() => {
    const controllers = topicRequestControllersRef.current;
    if (controllers.size === 0) {
      return;
    }

    controllers.forEach((controller) => controller.abort());
    controllers.clear();
  }, []);

  useEffect(() => {
    return () => {
      cancelPendingTopicRequests();
    };
  }, [cancelPendingTopicRequests]);

  const updateMessageById = useCallback((messageId: string, updater: (message: Message) => Message) => {
    if (!messageId) return;
    setMessagesWithRef((prev) =>
      prev.map((msg) => (msg.id === messageId ? updater(msg) : msg)),
    );
  }, [setMessagesWithRef]);

  const generateTopicsForMessage = useCallback(
    async (assistantResponse: string, messageId: string) => {
      // Build context from recent conversation history (last 2 messages: user + assistant)
      const recentMessages = messagesRef.current.slice(-2);
      const conversationContext = recentMessages
        .map((msg) => {
          const role = msg.role === 'user' ? 'User' : 'Assistant';
          const content = sanitizeTopicContext(msg.content);
          return `${role}: ${content}`;
        })
        .join('\n');

      // Add current assistant response
      const cleanedResponse = sanitizeTopicContext(assistantResponse);
      const fullContext = conversationContext
        ? `${conversationContext}\nAssistant: ${cleanedResponse}`
        : `Assistant: ${cleanedResponse}`;

      if (!fullContext.trim()) {
        updateMessageById(messageId, (msg) => ({
          ...msg,
          topics: [],
          topicsLoading: false,
          topicsDismissed: true,
        }));
        return;
      }

      const controller = new AbortController();
      const existingController = topicRequestControllersRef.current.get(messageId);
      if (existingController) {
        existingController.abort();
      }
      topicRequestControllersRef.current.set(messageId, controller);

      try {
        const endpoint = process.env.NEXT_PUBLIC_REST_API_ENDPOINT;
        if (!endpoint) {
          throw new Error('REST API endpoint is not configured');
        }

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'x-api-key': process.env.NEXT_PUBLIC_X_API_KEY || '',
        };

        const response = await fetch(`${endpoint}/api/v1/ai/generate-questions`, {
          method: 'POST',
          headers,
          credentials: 'include', // 自动发送 httpOnly Cookie
          signal: controller.signal,
          body: JSON.stringify({
            context: fullContext,
            topic_count: 3,
          }),
        });

        if (!response.ok) {
          throw new Error(`Failed to generate questions: ${response.status}`);
        }

        const data = await response.json();
        const topics: GeneratedTopic[] = Array.isArray(data?.questions)
          ? data.questions.map((q: string) => ({ question: q }))
          : [];

        updateMessageById(messageId, (msg) => {
          if (msg.topicsDismissed) {
            return {
              ...msg,
              topics: [],
              topicsLoading: false,
            };
          }

          return {
            ...msg,
            topics,
            topicsLoading: false,
            topicsDismissed: topics.length === 0 ? true : msg.topicsDismissed,
          };
        });
      } catch (error) {
        const isAbortError = error instanceof DOMException && error.name === 'AbortError';
        if (!isAbortError) {
          console.error('Failed to generate questions:', error);
        }
        updateMessageById(messageId, (msg) => ({
          ...msg,
          topics: [],
          topicsLoading: false,
          topicsDismissed: true,
        }));
      } finally {
        topicRequestControllersRef.current.delete(messageId);
      }
    },
    [sanitizeTopicContext, updateMessageById],
  );

  const dismissTopicsForMessage = useCallback((messageId: string) => {
    updateMessageById(messageId, (msg) => ({
      ...msg,
      topics: [],
      topicsDismissed: true,
    }));
  }, [updateMessageById]);

  // Interrupt current chat session
  const interruptChat = useCallback(async () => {
    if (!currentSessionId || sessionStatus !== 'active') {
      console.warn('No active session to interrupt');
      return;
    }

    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_REST_API_ENDPOINT}/api/v1/ai/interrupt-thread`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': process.env.NEXT_PUBLIC_X_API_KEY || '',
          },
          body: JSON.stringify({
            thread_id: currentSessionId,
          }),
        },
      );

      const result = await response.json();

      if (result.status === 'success') {
        console.log('Session interrupted successfully');
        setSessionStatus('interrupted');
      } else {
        console.warn('Interrupt warning:', result.message);
      }
    } catch (error) {
      console.error('Failed to interrupt session:', error);
    }
  }, [currentSessionId, sessionStatus]);

  // Send a new message
  const sendMessage = useCallback(async (userMessage: string) => {
    const newUserMessage: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: userMessage,
      timestamp: new Date(),
      status: 'success',
    };

    cancelPendingTopicRequests();

    const clearedHistory = clearActiveTopics(messagesRef.current);
    if (clearedHistory !== messagesRef.current) {
      setMessagesWithRef(clearedHistory);
    }

    const updatedMessages = [...clearedHistory, newUserMessage];

    setMessagesWithRef(updatedMessages);
    setIsLoading(true);
    setCurrentAssistantMessage('');
    setCurrentReasoningContent('');
    setCurrentToolCalls([]);
    setCurrentToolCallsInfo([]);
    setSessionStatus('active');
    setCurrentSessionId(null); // Will be set when session_start is received

    try {
      // httpOnly Cookie 由浏览器自动发送，无需手动处理 token

      const requestBody = {
        messages: updatedMessages.map((msg) => ({
          role: msg.role as 'user' | 'assistant',
          content: msg.content,
        })),
      };

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'x-api-key': process.env.NEXT_PUBLIC_X_API_KEY || '',
      };

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_REST_API_ENDPOINT}/api/v1/ai/trend-v2?web_search=${webSearchEnabled}`,
        {
          method: 'POST',
          headers,
          credentials: 'include', // 自动发送 httpOnly Cookie
          body: JSON.stringify(requestBody),
        },
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const isAuthLimitExceeded = response.status === 429;
        const isUnauthenticated = response.status === 401;

        if (isAuthLimitExceeded || isUnauthenticated) {
          onShowLoginPrompt();
          const loginMessage =
            (typeof errorData?.detail === 'string' && errorData.detail) ||
            (isAuthLimitExceeded
              ? 'You have reached the maximum number of trend analysis requests for unauthenticated users. Please login to continue.'
              : 'Your session has expired. Please sign in again to continue.');

          setMessagesWithRef((prev) => [
            ...prev,
            {
              id: `auth-${Date.now()}`,
              role: 'assistant',
              content: loginMessage,
              timestamp: new Date(),
              status: 'login_required',
            },
          ]);
          return;
        }

        throw new Error(errorData.detail || 'Network response was not ok');
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No reader available');

      let fullMessage = '';
      let reasoningContent = '';
      let toolCalls: string[] = [];
      let toolCallsInfoList: ToolCallInfo[] = [];

      const decoder = new TextDecoder();
      let buffer = '';
      let streamCompleted = false;


      const handleEvent = (payload: string) => {
        if (!payload) {
          return;
        }

        if (payload === '[DONE]') {
          streamCompleted = true;
          return;
        }

        const data = parseSsePayload(payload);
        if (!data) {
          return;
        }

        if (data.type === 'session_start') {
          setCurrentSessionId(data.thread_id);
          setSessionStatus('active');
          console.log('Chat session started:', data.thread_id);
        } else if (data.type === 'interrupted') {
          setSessionStatus('interrupted');
          console.log('Session interrupted:', data.content);
          const interruptMessage = `\n\n<div class="interrupt-message">生成已中断</div>\n\n`;
          fullMessage += interruptMessage;
          setCurrentAssistantMessage(fullMessage);
        } else if (data.type === 'cancelled') {
          setSessionStatus('cancelled');
          console.log('Request cancelled:', data.content);
          const cancelMessage = `\n\n<div class="cancel-message">请求已取消</div>\n\n`;
          fullMessage += cancelMessage;
          setCurrentAssistantMessage(fullMessage);
        } else if (data.type === 'done') {
          setCurrentSessionId(null);
          setSessionStatus('idle');
          console.log('Chat completed');
        } else if (data.type === 'thinking' || data.type === 'reasoning') {
          reasoningContent += data.content;
          setCurrentReasoningContent(reasoningContent);
        } else if (data.type === 'content') {
          fullMessage += data.content;
          setCurrentAssistantMessage(fullMessage);
        } else if (data.type === 'tool_start') {
          // New tool_start event format
          if (data.name) {
            if (!toolCalls.includes(data.name)) {
              toolCalls.push(data.name);
              setCurrentToolCalls([...toolCalls]);
            }
            upsertToolInfo(toolCallsInfoList, {
              id: data.id,
              name: data.name,
              status: 'pending',
              args: data.args ?? data.input,
            });
            setCurrentToolCallsInfo([...toolCallsInfoList]);
          }
        } else if (data.type === 'tool_end') {
          // Tool end event - update the status
          const toolStatus = data.status === 'success' ? 'success' : 'error';
          upsertToolInfo(toolCallsInfoList, {
            id: data.id,
            name: data.name,
            status: toolStatus,
            output: data.output,
          });
          setCurrentToolCallsInfo([...toolCallsInfoList]);
        } else if (data.type === 'tool_call') {
          // Legacy tool_call format - maintain backward compatibility
          const toolName = data.tool_name || data.name;
          const toolId = data.id;
          if (toolName) {
            toolCalls.push(toolName);
          }
          setCurrentToolCalls([...toolCalls]);
          // Add to info list with pending status - DO NOT add raw tool call to message
          upsertToolInfo(toolCallsInfoList, {
            id: toolId,
            name: toolName,
            status: 'pending',
            args: data.args ?? data.input,
          });
          setCurrentToolCallsInfo([...toolCallsInfoList]);
          // Note: We don't add anything to fullMessage here - badges will be shown via toolCallsInfo
        } else if (data.type === 'tool_result') {
          if (data.tool_name === 'get_meme_data') {
            const toolResultStr = JSON.stringify(data);
            fullMessage += `\n\n<tool-result>${toolResultStr}</tool-result>\n\n`;
            setCurrentAssistantMessage(fullMessage);
          }
        } else if (data.type === 'error') {
          let errorMessage = data.content || '发生了未知错误';
          if (errorMessage.includes('utf-8') || errorMessage.includes('decode')) {
            errorMessage = '响应包含无法处理的字符，请尝试重新描述您的问题。';
          }
          const errorInfo = `\n\n<div class="error-message">出现错误</div>\n\n`;
          fullMessage += errorInfo;
          setCurrentAssistantMessage(fullMessage);
        } else if (data.content) {
          // Skip tool-related events - they should not be displayed in message content
          const eventType = data.type || '';
          if (eventType.startsWith('tool_')) {
            // tool_call, tool_start, tool_end, tool_result etc. - don't display
            return;
          }
          fullMessage += data.content;
          setCurrentAssistantMessage(fullMessage);
        }

        if (data.error) {
          throw new Error(data.error);
        }
      };

      while (!streamCompleted) {
        const { done, value } = await reader.read();
        const chunk = value ? decoder.decode(value, { stream: !done }) : '';
        buffer += chunk.replace(/\r/g, '');

        const events = buffer.split('\n\n');
        buffer = events.pop() ?? '';

        for (const rawEvent of events) {
          const payload = rawEvent
            .split('\n')
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.replace(/^data:\s?/, ''))
            .join('\n')
            .trim();

          if (payload) {
            handleEvent(payload);
          }

          if (streamCompleted) {
            break;
          }
        }

        if (done) {
          const remainingPayload = buffer
            .split('\n')
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.replace(/^data:\s?/, ''))
            .join('\n')
            .trim();

          if (remainingPayload) {
            handleEvent(remainingPayload);
          }
          break;
        }
      }

      // Add completed message
      const assistantMessageId = `assistant-${Date.now()}`;
      setMessagesWithRef((prev) => [
        ...prev,
        {
          id: assistantMessageId,
          role: 'assistant',
          content: fullMessage,
          reasoning: reasoningContent,
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
          toolCallsInfo: toolCallsInfoList.length > 0 ? toolCallsInfoList : undefined,
          timestamp: new Date(),
          status: 'success',
          topicsLoading: true,
          topicsDismissed: false,
        },
      ]);
      setCurrentAssistantMessage('');
      setCurrentReasoningContent('');
      setCurrentToolCalls([]);
      setCurrentToolCallsInfo([]);
      setCurrentSessionId(null);
      setSessionStatus('idle');

      void generateTopicsForMessage(fullMessage, assistantMessageId);
    } catch (error) {
      console.error('Error:', error);
      const errorMessage =
        error instanceof Error ? error.message : 'Sorry, there was an error processing your request.';
      setMessagesWithRef((prev) => [
        ...prev,
        {
          id: `error-${Date.now()}`,
          role: 'assistant',
          content: errorMessage,
          timestamp: new Date(),
          status: 'error',
        },
      ]);
    } finally {
      setIsLoading(false);
      setCurrentSessionId(null);
      setSessionStatus('idle');
    }
  }, [webSearchEnabled, onShowLoginPrompt]);

  // Regenerate a message
  const regenerateMessage = useCallback(async (messageIndex: number) => {
    if (isLoading) return;

    cancelPendingTopicRequests();

    const targetMessage = messages[messageIndex];
    if (targetMessage.role !== 'assistant') return;

    try {
      // Remove the assistant message and all messages after it
      const newMessages = messages.slice(0, messageIndex);
      setMessagesWithRef(newMessages);

      // Get conversation history
      const conversationHistory = newMessages.map((msg) => ({
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      }));

      setIsLoading(true);
      setCurrentAssistantMessage('');
      setCurrentReasoningContent('');
      setCurrentToolCalls([]);
      setCurrentToolCallsInfo([]);
      setSessionStatus('active');
      setCurrentSessionId(null);

      // httpOnly Cookie 由浏览器自动发送

      const requestBody = {
        messages: conversationHistory,
      };

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'x-api-key': process.env.NEXT_PUBLIC_X_API_KEY || '',
      };

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_REST_API_ENDPOINT}/api/v1/ai/trend-v2?web_search=${webSearchEnabled}`,
        {
          method: 'POST',
          headers,
          credentials: 'include', // 自动发送 httpOnly Cookie
          body: JSON.stringify(requestBody),
        },
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const isAuthLimitExceeded = response.status === 429;
        const isUnauthenticated = response.status === 401;

        if (isAuthLimitExceeded || isUnauthenticated) {
          onShowLoginPrompt();
          const loginMessage =
            (typeof errorData?.detail === 'string' && errorData.detail) ||
            (isAuthLimitExceeded
              ? 'You have reached the maximum number of trend analysis requests for unauthenticated users. Please login to continue.'
              : 'Your session has expired. Please sign in again to continue.');

          setMessagesWithRef((prev) => [
            ...prev,
            {
              id: `auth-${Date.now()}`,
              role: 'assistant',
              content: loginMessage,
              timestamp: new Date(),
              status: 'login_required',
            },
          ]);
          return;
        }

        throw new Error(errorData.detail || 'Network response was not ok');
      }

      // Process streaming response (same as sendMessage)
      const reader = response.body?.getReader();
      if (!reader) throw new Error('No reader available');

      let fullMessage = '';
      let reasoningContent = '';
      let toolCalls: string[] = [];
      let toolCallsInfoList: ToolCallInfo[] = [];

      const decoder = new TextDecoder();
      let buffer = '';
      let streamCompleted = false;

      const handleEvent = (payload: string) => {
        if (!payload) {
          return;
        }
        if (payload === '[DONE]') {
          streamCompleted = true;
          return;
        }

        const parsed = parseSsePayload(payload);
        if (!parsed) {
          return;
        }

        if (parsed.type === 'session_start') {
          setCurrentSessionId(parsed.thread_id);
        } else if (parsed.type === 'content') {
          fullMessage += parsed.content;
          setCurrentAssistantMessage(fullMessage);
        } else if (parsed.type === 'reasoning' || parsed.type === 'thinking') {
          reasoningContent += parsed.content;
          setCurrentReasoningContent(reasoningContent);
        } else if (parsed.type === 'tool_start') {
          // New tool_start event format
          if (parsed.name) {
            if (!toolCalls.includes(parsed.name)) {
              toolCalls.push(parsed.name);
              setCurrentToolCalls([...toolCalls]);
            }
            upsertToolInfo(toolCallsInfoList, {
              id: parsed.id,
              name: parsed.name,
              status: 'pending',
              args: parsed.args ?? parsed.input,
            });
            setCurrentToolCallsInfo([...toolCallsInfoList]);
          }
        } else if (parsed.type === 'tool_end') {
          // Tool end event - update the status
          const toolStatus = parsed.status === 'success' ? 'success' : 'error';
          upsertToolInfo(toolCallsInfoList, {
            id: parsed.id,
            name: parsed.name,
            status: toolStatus,
            output: parsed.output,
          });
          setCurrentToolCallsInfo([...toolCallsInfoList]);
        } else if (parsed.type === 'tool_call') {
          // Legacy tool_call format - maintain backward compatibility
          const toolName = parsed.tool_name || parsed.name;
          if (toolName) {
            const toolCallMessage = `🛠️ 使用工具: ${toolName}`;
            toolCalls.push(toolCallMessage);
            setCurrentToolCalls([...toolCalls]);
            // Add to info list with pending status - DO NOT add raw tool call to message
            upsertToolInfo(toolCallsInfoList, {
              id: parsed.id,
              name: toolName,
              status: 'pending',
              args: parsed.args ?? parsed.input,
            });
            setCurrentToolCallsInfo([...toolCallsInfoList]);
          }
        } else if (parsed.type === 'tool_result') {
          // Tool result processing
        } else if (parsed.type === 'error') {
          console.error('Stream error:', parsed);
          let errorMessage = parsed.content || '抱歉，处理您的请求时出现了错误。';
          if (errorMessage.includes('utf-8') || errorMessage.includes('decode')) {
            errorMessage = '响应包含无法处理的字符，请尝试重新描述您的问题。';
          }
          fullMessage += `\n\n<div class="error-message">出现错误</div>\n\n`;
          setCurrentAssistantMessage(fullMessage);
        } else if (parsed.type === 'interrupted') {
          setSessionStatus('interrupted');
          fullMessage += `\n\n<div class="interrupt-message">生成已中断</div>\n\n`;
          setCurrentAssistantMessage(fullMessage);
        } else if (parsed.type === 'cancelled') {
          setSessionStatus('cancelled');
          fullMessage += `\n\n<div class="cancel-message">请求已取消</div>\n\n`;
          setCurrentAssistantMessage(fullMessage);
        } else if (parsed.type === 'done') {
          setCurrentSessionId(null);
          setSessionStatus('idle');
        } else if (parsed.content) {
          // Skip tool-related events - they should not be displayed in message content
          const eventType = parsed.type || '';
          if (eventType.startsWith('tool_')) {
            // tool_call, tool_start, tool_end, tool_result etc. - don't display
            return;
          }
          fullMessage += parsed.content;
          setCurrentAssistantMessage(fullMessage);
        }
      };

      while (!streamCompleted) {
        const { done, value } = await reader.read();
        const chunk = value ? decoder.decode(value, { stream: !done }) : '';
        buffer += chunk.replace(/\r/g, '');

        const events = buffer.split('\n\n');
        buffer = events.pop() ?? '';

        for (const rawEvent of events) {
          const payload = rawEvent
            .split('\n')
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.replace(/^data:\s?/, ''))
            .join('\n')
            .trim();

          if (payload) {
            handleEvent(payload);
          }

          if (streamCompleted) {
            break;
          }
        }

        if (done) {
          const remainingPayload = buffer
            .split('\n')
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.replace(/^data:\s?/, ''))
            .join('\n')
            .trim();

          if (remainingPayload) {
            handleEvent(remainingPayload);
          }
          break;
        }
      }

      // Add regenerated message
      const assistantMessageId = `assistant-${Date.now()}`;
      setMessagesWithRef((prev) => [
        ...prev,
        {
          id: assistantMessageId,
          role: 'assistant',
          content: fullMessage,
          reasoning: reasoningContent || undefined,
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
          toolCallsInfo: toolCallsInfoList.length > 0 ? toolCallsInfoList : undefined,
          timestamp: new Date(),
          status: 'success',
          topicsLoading: true,
          topicsDismissed: false,
        },
      ]);
      setCurrentAssistantMessage('');
      setCurrentReasoningContent('');
      setCurrentToolCalls([]);
      setCurrentToolCallsInfo([]);
      setCurrentSessionId(null);
      setSessionStatus('idle');

      void generateTopicsForMessage(fullMessage, assistantMessageId);
    } catch (error) {
      console.error('Regenerate failed:', error);
      const errorMessage =
        error instanceof Error ? error.message : 'Sorry, there was an error processing your request.';
      setMessagesWithRef((prev) => [
        ...prev,
        {
          id: `error-${Date.now()}`,
          role: 'assistant',
          content: errorMessage,
          timestamp: new Date(),
          status: 'error',
        },
      ]);
    } finally {
      setIsLoading(false);
      setCurrentSessionId(null);
      setSessionStatus('idle');
    }
  }, [messages, isLoading, webSearchEnabled, onShowLoginPrompt]);

  // Copy message to clipboard
  const copyMessage = useCallback((content: string, messageId: string) => {
    navigator.clipboard.writeText(content);
    setCopiedMessageId(messageId);

    setTimeout(() => {
      setCopiedMessageId(null);
    }, 3000);
  }, []);

  // Start a new chat by clearing all messages and state
  const startNewChat = useCallback(() => {
    cancelPendingTopicRequests();
    setMessagesWithRef([]);
    setIsLoading(false);
    setCurrentAssistantMessage('');
    setCurrentReasoningContent('');
    setCurrentToolCalls([]);
    setCurrentToolCallsInfo([]);
    setCurrentSessionId(null);
    setSessionStatus('idle');
    setCopiedMessageId(null);
  }, [cancelPendingTopicRequests, setMessagesWithRef]);

  return {
    messages,
    isLoading,
    currentAssistantMessage,
    currentReasoningContent,
    currentToolCalls,
    currentToolCallsInfo,
    sessionStatus,
    copiedMessageId,
    sendMessage,
    regenerateMessage,
    interruptChat,
    copyMessage,
    dismissTopicsForMessage,
    startNewChat,
  };
};
