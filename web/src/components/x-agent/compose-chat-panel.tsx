'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import ChatMessage from '@/components/chat/ChatMessage';
import ChatInput from '@/components/chat/ChatInput';
import ReasoningSection from '@/components/chat/ReasoningSection';
import ToolCallBadges from '@/components/chat/ToolCallBadges';
import MessageContent from '@/components/chat/MessageContent';
import { Message } from '@/types/chat';
import { resolveServiceURL } from '@/core/api/resolve-service-url';
import cn from '@/utils/cn';

interface ComposeChatPanelProps {
  className?: string;
}

const getSiteURL = () => {
  if (typeof window === 'undefined') {
    return process.env.NEXT_PUBLIC_SITE_URL || '';
  }
  return process.env.NEXT_PUBLIC_SITE_URL || window.location.origin;
};

const extractAssistantText = (payload: unknown): string => {
  if (typeof payload === 'string') {
    return payload;
  }

  if (Array.isArray(payload)) {
    return payload
      .map((entry) => extractAssistantText(entry))
      .filter(Boolean)
      .join('\n');
  }

  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    const directKeys = ['content', 'message', 'result', 'data', 'response'];
    for (const key of directKeys) {
      const value = record[key];
      if (typeof value === 'string' && value.trim().length > 0) {
        return value;
      }
    }

    if (typeof record.text === 'string') {
      return record.text;
    }

    if (Array.isArray(record.choices)) {
      const combined = record.choices
        .map((choice) => extractAssistantText(choice))
        .filter(Boolean)
        .join('\n');
      if (combined.trim().length > 0) {
        return combined;
      }
    }

    if (typeof record.delta === 'string') {
      return record.delta;
    }

    return JSON.stringify(record);
  }

  return '';
};

export default function ComposeChatPanel({ className }: ComposeChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [currentAssistantMessage, setCurrentAssistantMessage] = useState('');
  const [currentReasoningContent, setCurrentReasoningContent] = useState('');
  const [currentToolCalls, setCurrentToolCalls] = useState<string[]>([]);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [showReasoning, setShowReasoning] = useState<Record<string, boolean>>(
    {},
  );

  const messagesRef = useRef<Message[]>([]);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const composeAbortControllerRef = useRef<AbortController | null>(null);

  const setMessagesWithRef = useCallback(
    (
      updater: Message[] | ((previous: Message[]) => Message[]),
    ) => {
      setMessages((previous) => {
        const next =
          typeof updater === 'function'
            ? (updater as (prev: Message[]) => Message[])(previous)
            : updater;
        messagesRef.current = next;
        return next;
      });
    },
    [],
  );

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior });
    }
  }, []);

  useEffect(() => {
    scrollToBottom(messages.length > 1 ? 'smooth' : 'auto');
  }, [messages, currentAssistantMessage, scrollToBottom]);

  const interruptChat = useCallback(() => {
    if (composeAbortControllerRef.current) {
      composeAbortControllerRef.current.abort();
      composeAbortControllerRef.current = null;
    }
    setIsLoading(false);
    setCurrentAssistantMessage('');
    setCurrentReasoningContent('');
    setCurrentToolCalls([]);
  }, []);

  const copyMessage = useCallback((content: string, messageId: string) => {
    navigator.clipboard.writeText(content);
    setCopiedMessageId(messageId);
    setTimeout(() => setCopiedMessageId(null), 2500);
  }, []);

  const handleToggleReasoning = useCallback((messageId: string) => {
    setShowReasoning((previous) => ({
      ...previous,
      [messageId]: !previous[messageId],
    }));
  }, []);

  const sendComposeRequest = useCallback(
    async (history: Message[]) => {
      if (history.length === 0) {
        return;
      }

      interruptChat();
      const controller = new AbortController();
      composeAbortControllerRef.current = controller;

      setIsLoading(true);
      setCurrentAssistantMessage('');
      setCurrentReasoningContent('');
      setCurrentToolCalls([]);

      const assistantMessageId = `assistant-${Date.now()}`;

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'x-api-key': process.env.NEXT_PUBLIC_X_API_KEY || '',
      };

      const siteUrl = getSiteURL();
      if (siteUrl) {
        headers['x-site-url'] = siteUrl;
      }

      const accessToken =
        typeof window !== 'undefined'
          ? localStorage.getItem('accessToken.bnbot')
          : null;
      if (accessToken) {
        headers.Authorization = `Bearer ${accessToken}`;
      }

      const payloadMessages = history.map((message) => ({
        role: message.role === 'user' ? 'user' : 'assistant',
        content: message.content,
      }));

      const finishAssistantMessage = (
        content: string,
        reasoningText?: string,
        toolCalls?: string[],
        status: Message['status'] = 'success',
      ) => {
        const cleanContent = content.trim().length
          ? content
          : 'No response generated.';

        const finalMessage: Message = {
          id: assistantMessageId,
          role: 'assistant',
          content: cleanContent,
          reasoning: reasoningText || undefined,
          toolCalls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
          timestamp: new Date(),
          status,
        };

        setMessagesWithRef((prev) => [...prev, finalMessage]);
        setCurrentAssistantMessage('');
        setCurrentReasoningContent('');
        setCurrentToolCalls([]);
      };

      try {
        const response = await fetch(resolveServiceURL('api/v1/ai/trend-v2?web_search=false'), {
          method: 'POST',
          headers,
          body: JSON.stringify({ messages: payloadMessages }),
          signal: controller.signal,
        });

        const contentType = response.headers.get('content-type') || '';
        let fullMessage = '';
        let reasoningContent = '';
        let toolCalls: string[] = [];
        let streamCompleted = false;

        const handleEvent = (payload: string) => {
          if (!payload) {
            return;
          }
          if (payload === '[DONE]') {
            streamCompleted = true;
            return;
          }

          try {
            const data = JSON.parse(payload);
            if (data.type === 'thinking' || data.type === 'reasoning') {
              reasoningContent += data.content ?? '';
              setCurrentReasoningContent(reasoningContent);
            } else if (data.type === 'content') {
              fullMessage += data.content ?? '';
              setCurrentAssistantMessage(fullMessage);
            } else if (data.type === 'tool_call') {
              // Legacy tool_call format
              if (data.tool_name) {
                toolCalls.push(data.tool_name);
                setCurrentToolCalls([...toolCalls]);
              }
            } else if (data.type === 'tool_start') {
              // New tool_start event format
              if (data.name && !toolCalls.includes(data.name)) {
                toolCalls.push(data.name);
                setCurrentToolCalls([...toolCalls]);
              }
            } else if (data.type === 'tool_end') {
              // Tool end event - we can optionally handle the output/status here
              console.log(`Tool ${data.name} completed with status: ${data.status}`);
              if (data.output) {
                console.log(`Tool output: ${data.output}`);
              }
            } else if (data.type === 'error') {
              throw new Error(data.content || 'Compose failed.');
            } else if (typeof data.content === 'string') {
              fullMessage += data.content;
              setCurrentAssistantMessage(fullMessage);
            }
          } catch (error) {
            console.warn('Compose stream parse error:', error, payload);
          }
        };

        if (contentType.includes('text/event-stream')) {
          const reader = response.body?.getReader();
          if (!reader) {
            throw new Error('No reader available');
          }
          const decoder = new TextDecoder();
          let buffer = '';

          while (true) {
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
        } else if (contentType.includes('application/json')) {
          const data = await response.json();
          fullMessage = extractAssistantText(data);
        } else {
          fullMessage = await response.text();
        }

        if (!response.ok) {
          const errorMessage =
            fullMessage.trim() ||
            'Compose request failed. Please try again later.';
          throw new Error(errorMessage);
        }

        finishAssistantMessage(fullMessage, reasoningContent, toolCalls);
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }
        const errorMessage =
          error instanceof Error ? error.message : 'Compose request failed.';
        finishAssistantMessage(errorMessage, undefined, undefined, 'error');
      } finally {
        setIsLoading(false);
        composeAbortControllerRef.current = null;
      }
    },
    [interruptChat, setMessagesWithRef],
  );

  const handleSendMessage = useCallback(
    async (value: string) => {
      const trimmed = value.trim();
      if (!trimmed || isLoading) {
        return;
      }

      const userMessage: Message = {
        id: `user-${Date.now()}`,
        role: 'user',
        content: trimmed,
        timestamp: new Date(),
        status: 'success',
      };

      setMessagesWithRef((prev) => [...prev, userMessage]);
      setInput('');
      await sendComposeRequest(messagesRef.current);
    },
    [isLoading, sendComposeRequest, setMessagesWithRef],
  );

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      await handleSendMessage(input);
    },
    [handleSendMessage, input],
  );

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) {
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void handleSendMessage(input);
    }
  };

  const regenerateMessage = useCallback(
    async (messageIndex: number) => {
      if (isLoading) {
        return;
      }
      const target = messagesRef.current[messageIndex];
      if (!target || target.role !== 'assistant') {
        return;
      }
      const newHistory = messagesRef.current.slice(0, messageIndex);
      setMessagesWithRef(newHistory);
      await sendComposeRequest(newHistory);
    },
    [isLoading, sendComposeRequest, setMessagesWithRef],
  );

  const sanitizedAssistantMessage = currentAssistantMessage
    ? currentAssistantMessage
        .replace(/<tool-call>[\s\S]*?<\/tool-call>/g, '')
        .replace(/<tool-result>[\s\S]*?<\/tool-result>/g, '')
        .trim()
    : '';

  const shouldShowThinkingIndicator =
    isLoading &&
    !currentReasoningContent &&
    (!currentAssistantMessage || sanitizedAssistantMessage.length === 0);

  return (
    <div
      className={cn(
        'flex h-full flex-col rounded-3xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-[#050505]',
        className,
      )}
    >
      <div className="flex flex-1 flex-col p-4">
        <div className="relative flex h-full flex-col">
          <div
            className="scrollbar-none flex-1 overflow-y-auto"
            style={{ paddingBottom: '210px' }}
          >
            {messages.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center text-center text-sm text-gray-500 dark:text-gray-400">
                <p>Start a compose chat to craft new tweets with your agent.</p>
                <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                  Share context, iterate, and publish when ready.
                </p>
              </div>
            ) : (
              <>
                {messages.map((message, index) => (
                  <ChatMessage
                    key={message.id}
                    message={message}
                    index={index}
                    onCopyMessage={copyMessage}
                    onRegenerateMessage={regenerateMessage}
                    copiedMessageId={copiedMessageId}
                    isLoading={isLoading}
                    showReasoning={showReasoning}
                    onToggleReasoning={handleToggleReasoning}
                    onTopicSelect={() => undefined}
                  />
                ))}

                {(currentAssistantMessage ||
                  currentReasoningContent ||
                  currentToolCalls.length > 0) && (
                  <div className="mb-6 w-full">
                    <div className="flex justify-start">
                      <div className="max-w-[95%]">
                        <div className="bg-transparent px-0 py-1">
                          {currentReasoningContent && (
                            <ReasoningSection
                              reasoning={currentReasoningContent}
                              isStreaming={true}
                            />
                          )}
                          {currentAssistantMessage && (
                            <div className="font-inter text-[15px] font-normal leading-[1.55] tracking-[-0.015em] text-gray-900 antialiased subpixel-antialiased">
                              <MessageContent
                                content={currentAssistantMessage}
                                isStreaming={isLoading}
                              />
                            </div>
                          )}
                          {currentToolCalls.length > 0 && (
                            <div className="mt-3">
                              <ToolCallBadges
                                toolCalls={currentToolCalls}
                                isStreaming={true}
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {shouldShowThinkingIndicator && (
                  <div className="flex justify-start pl-0">
                    <div className="max-w-[85%] bg-transparent px-0 py-2">
                      <div className="flex items-center space-x-2">
                        <span className="loading loading-dots loading-sm text-[#f0b90b]" />
                        <span className="font-inter text-[13px] font-medium tracking-[-0.008em] text-gray-600 antialiased subpixel-antialiased">
                          Composer is thinking...
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}

            <div ref={messagesEndRef} />
          </div>

          <ChatInput
            input={input}
            setInput={setInput}
            onSubmit={handleSubmit}
            onKeyDown={handleKeyDown}
            onInterrupt={interruptChat}
            isLoading={isLoading}
            isMobile={false}
            selectedAgent={null}
            hydrated={true}
            placeholder="Generate a Web3 or AI tweet..."
          />
        </div>
      </div>
    </div>
  );
}
