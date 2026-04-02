'use client';

import React, { useState, useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';
import { motion } from 'framer-motion';
import XAgentWelcome from './x-agent-welcome';
import XAgentMessage from './x-agent-message';
import ChatInput from '@/components/chat/ChatInput';
import ReasoningSection from '@/components/chat/ReasoningSection';
import MessageContent from '@/components/chat/MessageContent';
import ToolCallBadges from '@/components/chat/ToolCallBadges';
import InterleavedMessageContent from '@/components/chat/InterleavedMessageContent';
import { XAgentMessage as XAgentMessageType, TweetDraft, ToolCallInfo } from '@/types/x-agent';

type TweetDraftsPayload = {
  type: 'tweet_drafts';
  data: {
    drafts: TweetDraft[];
  };
};

const repairJsonStringLiterals = (input: string): string => {
  let result = '';
  let inString = false;
  let escapeNext = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];

    if (escapeNext) {
      result += char;
      escapeNext = false;
      continue;
    }

    if (char === '\\') {
      if (inString) {
        escapeNext = true;
      }
      result += char;
      continue;
    }

    if (char === '"') {
      if (!inString) {
        inString = true;
        result += char;
        continue;
      }

      const nextChar = input[i + 1];
      if (!nextChar || /[\s,:}\]]/.test(nextChar)) {
        inString = false;
        result += char;
      } else {
        result += '\\"';
      }
      continue;
    }

    if (inString) {
      if (char === '\n') {
        result += '\\n';
        continue;
      }
      if (char === '\r') {
        result += '\\r';
        continue;
      }
      if (char === '\t') {
        result += '\\t';
        continue;
      }
    }

    result += char;
  }

  return result;
};

const tryParseTweetDraftsPayload = (raw: string | null | undefined): TweetDraftsPayload | null => {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const attemptParse = (text: string) => {
    try {
      const parsed = JSON.parse(text);
      if (parsed?.type === 'tweet_drafts' && parsed.data?.drafts) {
        return parsed as TweetDraftsPayload;
      }
    } catch (error) {
      // Ignore parse errors and try sanitizing
    }
    return null;
  };

  return attemptParse(trimmed) ?? attemptParse(repairJsonStringLiterals(trimmed));
};

const extractTweetDraftsFromContent = (
  content: string,
): { tweetDrafts: TweetDraftsPayload | null; cleanedContent: string } => {
  let tweetDrafts: TweetDraftsPayload | null = null;
  let cleanedContent = content;

  const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)\s*```/gi;
  let match: RegExpExecArray | null;

  while (!tweetDrafts && (match = codeBlockRegex.exec(content)) !== null) {
    const parsed = tryParseTweetDraftsPayload(match[1]);
    if (parsed) {
      tweetDrafts = parsed;
      cleanedContent = (cleanedContent.slice(0, match.index) + cleanedContent.slice(match.index + match[0].length)).trim();
    }
  }

  if (!tweetDrafts) {
    const jsonObjects: { start: number; end: number; text: string }[] = [];
    let depth = 0;
    let startIndex = -1;
    let inString = false;
    let escapeNext = false;

    for (let i = 0; i < content.length; i += 1) {
      const char = content[i];

      if (escapeNext) {
        escapeNext = false;
        continue;
      }

      if (char === '\\') {
        escapeNext = inString;
        continue;
      }

      if (char === '"') {
        inString = !inString;
        continue;
      }

      if (inString) continue;

      if (char === '{') {
        if (depth === 0) startIndex = i;
        depth += 1;
      } else if (char === '}' && depth > 0) {
        depth -= 1;
        if (depth === 0 && startIndex !== -1) {
          jsonObjects.push({
            start: startIndex,
            end: i + 1,
            text: content.slice(startIndex, i + 1),
          });
          startIndex = -1;
        }
      }
    }

    for (const obj of jsonObjects) {
      if (!obj.text.includes('"tweet_drafts"')) continue;
      const parsed = tryParseTweetDraftsPayload(obj.text);
      if (parsed) {
        tweetDrafts = parsed;
        cleanedContent = (cleanedContent.slice(0, obj.start) + cleanedContent.slice(obj.end)).trim();
        break;
      }
    }
  }

  return { tweetDrafts, cleanedContent: cleanedContent.trim() };
};

const formatTweetFromDraft = (draft: TweetDraft): string => {
  const baseContent = (draft.content || '').trim();
  const hashtags = Array.isArray(draft.hashtags) ? draft.hashtags.filter(Boolean) : [];
  if (!baseContent && hashtags.length === 0) {
    return '';
  }

  const hashtagsLine = hashtags.length ? `${baseContent ? '\n\n' : ''}${hashtags.join(' ')}` : '';
  return `${baseContent}${hashtagsLine}`.trim();
};

interface XAgentChatPanelProps {
  onTweetGenerated?: (tweetText: string) => void;
  onDraftPreview?: (draft: TweetDraft) => void;
  onImageGenerated?: (imageUrl: string) => void;
  agentName?: string;
  agentAvatar?: string;
  isMobile?: boolean;
  onShowLogin?: () => void;
  onMessagesChange?: (hasMessages: boolean) => void;
}

export interface XAgentChatPanelRef {
  hasMessages: boolean;
  handleNewChat: () => void;
  sendMessage: (content: string) => Promise<void>;
}

const XAgentChatPanel = forwardRef<XAgentChatPanelRef, XAgentChatPanelProps>(({
  onTweetGenerated,
  onDraftPreview,
  onImageGenerated,
  agentName,
  agentAvatar,
  isMobile = false,
  onShowLogin = () => { },
  onMessagesChange,
}, ref) => {
  // State
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<XAgentMessageType[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [currentAssistantMessage, setCurrentAssistantMessage] = useState('');
  const [currentReasoningContent, setCurrentReasoningContent] = useState('');
  const [currentToolCalls, setCurrentToolCalls] = useState<string[]>([]);
  const [currentToolCallsInfo, setCurrentToolCallsInfo] = useState<ToolCallInfo[]>([]);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [showReasoning, setShowReasoning] = useState<{ [key: string]: boolean }>({});
  const [inputHeight, setInputHeight] = useState(0);

  // Refs
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const lastStreamedMessageIdRef = useRef<string | null>(null);

  // Auto-scroll to bottom
  const scrollToBottom = useCallback(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, currentAssistantMessage, scrollToBottom]);

  // Notify parent when messages change
  useEffect(() => {
    onMessagesChange?.(messages.length > 0);
  }, [messages.length, onMessagesChange]);

  // Send compose request to API
  const sendComposeRequest = async (allMessages: XAgentMessageType[]) => {
    if (allMessages.length === 0) return;

    const controller = new AbortController();
    abortControllerRef.current = controller;

    setIsLoading(true);
    setCurrentAssistantMessage('');
    setCurrentReasoningContent('');
    setCurrentToolCalls([]);
    setCurrentToolCallsInfo([]);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-api-key': process.env.NEXT_PUBLIC_X_API_KEY || '',
    };

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || (typeof window !== 'undefined' ? window.location.origin : '');
    if (siteUrl) {
      headers['x-site-url'] = siteUrl;
    }

    const payloadMessages = allMessages.map((msg) => {
      // If assistant message has tweet drafts but empty content, include the draft content
      if (msg.role === 'assistant' && !msg.content && msg.tweetDrafts?.data?.drafts?.length) {
        const draft = msg.tweetDrafts.data.drafts[0];
        const draftContent = draft?.content || '';
        const hashtags = draft?.hashtags?.join(' ') || '';
        const fullContent = `${draftContent}${hashtags ? '\n\n' + hashtags : ''}`;
        return {
          role: msg.role,
          content: fullContent || '[Generated tweet draft]',
        };
      }
      return {
        role: msg.role,
        content: msg.content,
      };
    });

    const baseUrl = process.env.NEXT_PUBLIC_REST_API_ENDPOINT || 'http://localhost:8000';
    const apiUrl = `${baseUrl}/api/v1/ai/agent-v2?web_search=false`;

    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({ messages: payloadMessages }),
        credentials: 'include',
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const isAuthLimitExceeded = response.status === 429;
        const isUnauthenticated = response.status === 401;

        if (isAuthLimitExceeded || isUnauthenticated) {
          const loginMessage =
            (typeof errorData?.detail === 'string' && errorData.detail) ||
            (isAuthLimitExceeded
              ? 'You have reached the maximum number of compose requests for unauthenticated users. Please login to continue.'
              : 'Authentication required. Please sign in to continue.');

          const authPrompt: XAgentMessageType = {
            id: `auth-${Date.now()}`,
            role: 'assistant',
            content: loginMessage,
            status: 'login_required',
            timestamp: Date.now(),
          };

          setMessages((prev) => [...prev, authPrompt]);
          setCurrentAssistantMessage('');
          setCurrentReasoningContent('');
          setCurrentToolCalls([]);
          setCurrentToolCallsInfo([]);
          setIsLoading(false);
          abortControllerRef.current = null;
          return;
        }
      }

      const contentType = response.headers.get('content-type') || '';
      let fullMessage = '';
      let reasoningContent = '';
      let toolCallsList: string[] = [];
      let toolCallsInfoList: ToolCallInfo[] = [];

      let tweetDraftsData: any = null;
      let generatedImageUrl: string | null = null;

      const handleEvent = (payload: string) => {
        if (!payload || payload === '[DONE]') return;

        try {
          const data = JSON.parse(payload);
          if (data.type === 'thinking' || data.type === 'reasoning') {
            reasoningContent += data.content ?? '';
            setCurrentReasoningContent(reasoningContent);
          } else if (data.type === 'content') {
            fullMessage += data.content ?? '';
            setCurrentAssistantMessage(fullMessage);
            // Don't try to extract JSON during streaming, wait until complete
          } else if (data.type === 'tool_call' && data.tool_name) {
            // Legacy tool_call format - DO NOT add to message content
            toolCallsList.push(data.tool_name);
            setCurrentToolCalls([...toolCallsList]);
            // Add to info list with pending status - badges will be shown via toolCallsInfo
            if (!toolCallsInfoList.find(t => t.name === data.tool_name)) {
              toolCallsInfoList.push({
                name: data.tool_name,
                status: 'pending',
                args: data.args ?? data.input,
                index: fullMessage.length
              });
              setCurrentToolCallsInfo([...toolCallsInfoList]);
            }
            // Note: We don't add anything to fullMessage - badges shown via toolCallsInfo
          } else if (data.type === 'tool_start') {
            // New tool_start event format - DO NOT add to message content
            if (data.name) {
              if (!toolCallsList.includes(data.name)) {
                toolCallsList.push(data.name);
                setCurrentToolCalls([...toolCallsList]);
              }

              // Try to find existing tool info by ID first, then by name
              const existingIndex = toolCallsInfoList.findIndex(t =>
                (data.id && t.id === data.id) || t.name === data.name
              );

              if (existingIndex !== -1) {
                // Update existing
                toolCallsInfoList[existingIndex] = {
                  ...toolCallsInfoList[existingIndex],
                  id: data.id || toolCallsInfoList[existingIndex].id,
                  args: data.args ?? data.input ?? toolCallsInfoList[existingIndex].args,
                  // Keep index if it exists
                };
                setCurrentToolCallsInfo([...toolCallsInfoList]);
              } else {
                // Add new
                toolCallsInfoList.push({
                  name: data.name,
                  status: 'pending',
                  args: data.args ?? data.input,
                  id: data.id,
                  index: fullMessage.length
                });
                setCurrentToolCallsInfo([...toolCallsInfoList]);
              }
              // Note: We don't add anything to fullMessage - badges shown via toolCallsInfo
            }
          } else if (data.type === 'tool_end') {
            // Tool end event - update the status
            if (data.name) {
              // Prefer finding by ID if available
              const toolInfo = toolCallsInfoList.find(t =>
                (data.id && t.id === data.id) || t.name === data.name
              );

              if (toolInfo) {
                toolInfo.status = data.status === 'success' ? 'success' : 'error';
                toolInfo.output = data.output;
                setCurrentToolCallsInfo([...toolCallsInfoList]);

                // Handle generate_image tool completion
                if (data.name === 'generate_image' && data.output && onImageGenerated) {
                  try {
                    const outputData = typeof data.output === 'string' ? JSON.parse(data.output) : data.output;
                    const finalData = typeof outputData === 'string' ? JSON.parse(outputData) : outputData;
                    const images = finalData?.data || [];
                    if (Array.isArray(images) && images.length > 0 && images[0]?.b64_json) {
                      const imageUrl = `data:image/png;base64,${images[0].b64_json}`;
                      generatedImageUrl = imageUrl;
                      onImageGenerated(imageUrl);
                    }
                  } catch (e) {
                    console.error('Error parsing generate_image output:', e);
                  }
                }
              }
            }
          } else if (data.type === 'tweet_drafts') {
            // Store tweet_drafts data
            tweetDraftsData = data;
          } else if (data.type === 'image' || data.type === 'image_generated') {
            // Handle image generation event
            const imageUrl = data.url || data.image_url || data.content;
            if (imageUrl) {
              generatedImageUrl = imageUrl;
              if (onImageGenerated) {
                onImageGenerated(imageUrl);
              }
            }
          } else if (data.type === 'error') {
            throw new Error(data.content || 'Compose failed.');
          }
        } catch (error) {
          console.warn('Stream parse error:', error);
        }
      };

      if (contentType.includes('text/event-stream')) {
        const reader = response.body?.getReader();
        if (!reader) throw new Error('No reader available');

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

            if (payload) handleEvent(payload);
          }

          if (done) {
            const remainingPayload = buffer
              .split('\n')
              .filter((line) => line.startsWith('data:'))
              .map((line) => line.replace(/^data:\s?/, ''))
              .join('\n')
              .trim();

            if (remainingPayload) handleEvent(remainingPayload);
            break;
          }
        }
      } else if (contentType.includes('application/json')) {
        const data = await response.json();
        fullMessage = typeof data === 'string' ? data : data.content || JSON.stringify(data);
      } else {
        fullMessage = await response.text();
      }

      if (!response.ok) {
        throw new Error(fullMessage.trim() || 'Request failed');
      }

      // Final check for tweet_drafts in the complete message
      if (!tweetDraftsData && fullMessage) {
        const { tweetDrafts, cleanedContent } = extractTweetDraftsFromContent(fullMessage);
        if (tweetDrafts) {
          tweetDraftsData = tweetDrafts;
          fullMessage = cleanedContent;
        }
      }

      // Extract image from generate_image tool if not already captured
      if (!generatedImageUrl && toolCallsInfoList.length > 0 && onImageGenerated) {
        const imageToolInfo = toolCallsInfoList.find(t => t.name === 'generate_image' && t.output);
        if (imageToolInfo?.output) {
          try {
            const outputData = typeof imageToolInfo.output === 'string' ? JSON.parse(imageToolInfo.output) : imageToolInfo.output;
            const finalData = typeof outputData === 'string' ? JSON.parse(outputData) : outputData;
            const images = finalData?.data || [];
            if (Array.isArray(images) && images.length > 0 && images[0]?.b64_json) {
              generatedImageUrl = `data:image/png;base64,${images[0].b64_json}`;
              onImageGenerated(generatedImageUrl);
            }
          } catch (e) {
            console.error('Error extracting image from toolCallsInfo:', e);
          }
        }
      }

      // Extract image URLs from markdown content if not already captured
      if (!generatedImageUrl && fullMessage) {
        // Match markdown image syntax: ![alt](url) or just URLs ending with image extensions
        const markdownImageMatch = fullMessage.match(/!\[.*?\]\((https?:\/\/[^\s)]+)\)/);
        const urlImageMatch = fullMessage.match(/(https?:\/\/[^\s]+\.(?:png|jpg|jpeg|gif|webp))/i);
        const extractedImageUrl = markdownImageMatch?.[1] || urlImageMatch?.[1];
        if (extractedImageUrl && onImageGenerated) {
          generatedImageUrl = extractedImageUrl;
          onImageGenerated(extractedImageUrl);
        }
      }

      // Finalize assistant message
      // If we have tweet drafts and no other content, don't show "No response generated."
      const finalContent = fullMessage.trim() || (tweetDraftsData ? '' : 'No response generated.');

      const messageId = `assistant-${Date.now()}`;
      const assistantMessage: XAgentMessageType = {
        id: messageId,
        role: 'assistant',
        content: finalContent,
        reasoning: reasoningContent || undefined,
        toolCalls: toolCallsList.length > 0 ? toolCallsList : undefined,
        toolCallsInfo: toolCallsInfoList.length > 0 ? toolCallsInfoList : undefined,
        tweetDrafts: tweetDraftsData || undefined,
        timestamp: Date.now(),
      };

      // Mark this message to skip entry animation since it was just streamed
      lastStreamedMessageIdRef.current = messageId;
      setMessages((prev) => [...prev, assistantMessage]);
      setCurrentAssistantMessage('');
      setCurrentReasoningContent('');
      setCurrentToolCalls([]);
      setCurrentToolCallsInfo([]);

      // If we received tweet drafts, surface them through the preview
      const firstDraft =
        tweetDraftsData?.data?.drafts?.find(
          (draft: TweetDraft | undefined) => draft?.content?.trim(),
        ) || null;

      if (firstDraft) {
        if (onTweetGenerated) {
          const tweetText = formatTweetFromDraft(firstDraft);
          if (tweetText) {
            onTweetGenerated(tweetText);
          }
        }

        if (onDraftPreview) {
          onDraftPreview(firstDraft);
        }
      }
    } catch (error) {
      if (controller.signal.aborted) return;

      const errorMessage = error instanceof Error ? error.message : 'Request failed.';
      const errorMsgId = `assistant-${Date.now()}`;
      const errorMsg: XAgentMessageType = {
        id: errorMsgId,
        role: 'assistant',
        content: errorMessage,
        timestamp: Date.now(),
      };

      // Mark to skip animation if we had streaming content before error
      if (currentAssistantMessage || currentReasoningContent) {
        lastStreamedMessageIdRef.current = errorMsgId;
      }
      setMessages((prev) => [...prev, errorMsg]);
      setCurrentAssistantMessage('');
      setCurrentReasoningContent('');
      setCurrentToolCalls([]);
      setCurrentToolCallsInfo([]);
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
    }
  };

  // Handle submit
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!input.trim() || isLoading) return;

    const userMessage: XAgentMessageType = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: input.trim(),
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');

    await sendComposeRequest([...messages, userMessage]);
  };

  // Handle interrupt
  const interruptChat = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setIsLoading(false);
    setCurrentAssistantMessage('');
    setCurrentReasoningContent('');
    setCurrentToolCalls([]);
    setCurrentToolCallsInfo([]);
  };

  // Handle key down
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) {
      return;
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  // Handle copy message
  const copyMessage = (content: string, messageId: string) => {
    navigator.clipboard.writeText(content);
    setCopiedMessageId(messageId);
    setTimeout(() => setCopiedMessageId(null), 2000);
  };

  // Handle regenerate
  const regenerateMessage = async (index: number) => {
    if (isLoading) return;

    const target = messages[index];
    if (!target || target.role !== 'assistant') return;

    // Get all messages up to this point
    const newHistory = messages.slice(0, index);
    setMessages(newHistory);

    // Resend the request
    await sendComposeRequest(newHistory);
  };

  // Handle toggle reasoning
  const handleToggleReasoning = (messageId: string) => {
    setShowReasoning((prev) => ({
      ...prev,
      [messageId]: !prev[messageId],
    }));
  };

  // Handle new chat
  const handleNewChat = useCallback(() => {
    setMessages([]);
    setInput('');
    setCurrentAssistantMessage('');
    setCurrentReasoningContent('');
    setCurrentToolCalls([]);
    setCurrentToolCallsInfo([]);
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setIsLoading(false);
  }, []);

  // Send message programmatically (for image generation, etc.)
  const sendMessage = useCallback(async (content: string) => {
    if (!content.trim() || isLoading) return;

    const userMessage: XAgentMessageType = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: content.trim(),
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMessage]);
    await sendComposeRequest([...messages, userMessage]);
  }, [isLoading, messages]);

  // Expose methods to parent via ref
  useImperativeHandle(ref, () => ({
    hasMessages: messages.length > 0,
    handleNewChat,
    sendMessage,
  }), [messages.length, handleNewChat, sendMessage]);

  const shouldShowThinkingIndicator = isLoading && !currentAssistantMessage && !currentReasoningContent;

  // Handle draft preview - pass to parent component
  const handleDraftPreview = (draft: TweetDraft) => {
    if (onDraftPreview) {
      onDraftPreview(draft);
    }
  };

  return (
    <div className="flex h-full flex-col rounded-lg bg-white border border-gray-100 shadow-card">
      {messages.length === 0 ? (
        <XAgentWelcome
          input={input}
          setInput={setInput}
          onSubmit={handleSubmit}
          onKeyDown={handleKeyDown}
          onInterrupt={interruptChat}
          isLoading={isLoading}
          hasMessages={messages.length > 0}
          onNewChat={handleNewChat}
        />
      ) : (
        <div className="flex h-full flex-col relative">
          {/* Messages container */}
          <div
            ref={chatContainerRef}
            className="scrollbar-none flex-1 overflow-y-auto p-4"
            style={{
              paddingBottom: isMobile && inputHeight > 0 ? `${inputHeight + 100}px` : '200px',
            }}
          >
            {/* Render messages */}
            {messages.map((message, index) => (
              <XAgentMessage
                key={message.id || index}
                message={message}
                index={index}
                onCopyMessage={copyMessage}
                onRegenerateMessage={regenerateMessage}
                copiedMessageId={copiedMessageId}
                isLoading={isLoading}
                showReasoning={showReasoning}
                onToggleReasoning={handleToggleReasoning}
                onDraftPreview={handleDraftPreview}
                onShowLogin={onShowLogin}
                skipEntryAnimation={message.id === lastStreamedMessageIdRef.current}
              />
            ))}

            {/* Streaming message */}
            {(currentAssistantMessage || currentReasoningContent || currentToolCalls.length > 0) && (
              <div className="mb-6 w-full">
                <div className="flex justify-start">
                  <div className="flex flex-col w-full max-w-[100%] items-start">
                    <div className="transition-all duration-200 bg-transparent px-0 py-1 font-inter text-sm font-normal leading-relaxed tracking-tight text-gray-900 antialiased">
                      {/* Streaming reasoning */}
                      {currentReasoningContent && (
                        <ReasoningSection
                          reasoning={currentReasoningContent}
                          isStreaming={isLoading && !currentAssistantMessage}
                        />
                      )}

                      {/* Interleaved Streaming Content & Tools */}
                      {(currentAssistantMessage || currentToolCalls.length > 0 || currentToolCallsInfo.length > 0) && (
                        <InterleavedMessageContent
                          content={currentAssistantMessage}
                          toolCalls={currentToolCalls}
                          toolCallsInfo={currentToolCallsInfo}
                          isStreaming={isLoading}
                          showToolBadges={false}
                        />
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Loading indicator */}
            {shouldShowThinkingIndicator && (
              <div className="flex justify-start pl-0">
                <div className="bg-transparent px-0 py-2">
                  <span className="loading loading-dots loading-sm text-[#f0b90b]"></span>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Chat input */}
          <ChatInput
            input={input}
            setInput={setInput}
            onSubmit={handleSubmit}
            onKeyDown={handleKeyDown}
            onInterrupt={interruptChat}
            isLoading={isLoading}
            isMobile={isMobile}
            selectedAgent={null}
            hydrated={true}
            placeholder="Generate a Web3 or AI tweet..."
          />
        </div>
      )}
    </div>
  );
});

XAgentChatPanel.displayName = 'XAgentChatPanel';

export default XAgentChatPanel;
