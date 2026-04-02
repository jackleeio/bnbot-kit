'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import { FamilyButton } from './family-button';
import { resolveServiceURL } from '@/core/api/resolve-service-url';
import { SendHorizonal, Sparkles, MessageSquareQuote, FileText } from 'lucide-react';
import Image from 'next/image';
import bnbotAI from '@/assets/images/logo/bnbot-ai.jpg';
import LoginModal from '@/components/login/login-modal';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  status?: 'sending' | 'error' | 'login_required';
}

interface PostCommentButtonProps {
  className?: string;
  onLaunch?: () => void;
  tweetContent?: string;
  tweetId?: string;
}

const getSiteURL = () => {
  if (typeof window === 'undefined') {
    return process.env.NEXT_PUBLIC_SITE_URL || '';
  }
  return process.env.NEXT_PUBLIC_SITE_URL || window.location.origin;
};

export default function PostCommentButton({
  className,
  tweetContent,
  tweetId,
}: PostCommentButtonProps) {
  return (
    <div className={className}>
      <FamilyButton>
        {(onClose) => (
          <TweetAssistantChat
            tweetContent={tweetContent}
            tweetId={tweetId}
            onClose={onClose}
          />
        )}
      </FamilyButton>
    </div>
  );
}

interface TweetAssistantChatProps {
  tweetContent?: string;
  tweetId?: string;
  onClose: () => void;
}

function TweetAssistantChat({ tweetContent, tweetId }: TweetAssistantChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [currentStreamContent, setCurrentStreamContent] = useState('');
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, currentStreamContent, scrollToBottom]);

  const sendMessage = useCallback(
    async (content: string) => {
      if (!content.trim() || isLoading) return;

      const userMessage: Message = {
        id: `user-${Date.now()}`,
        role: 'user',
        content: content.trim(),
      };

      setMessages((prev) => [...prev, userMessage]);
      setInput('');
      setIsLoading(true);
      setCurrentStreamContent('');

      // Abort any previous request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
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

        // Build message history for API
        const allMessages = [...messages, userMessage];
        const payloadMessages = allMessages.map((msg) => ({
          role: msg.role,
          content: msg.content,
        }));

        const response = await fetch(resolveServiceURL('api/v1/ai/trend-v2?web_search=false'), {
          method: 'POST',
          headers,
          body: JSON.stringify({ messages: payloadMessages }),
          signal: controller.signal,
        });

        if (!response.ok) {
          if (response.status === 429 || response.status === 401) {
             const data = await response.json();
             const errorMessage = data.detail || 'Please login to continue.';
             
             const loginMessage: Message = {
               id: `assistant-${Date.now()}`,
               role: 'assistant',
               content: errorMessage,
               status: 'login_required',
             };
             setMessages((prev) => [...prev, loginMessage]);
             return;
          }
          throw new Error('Request failed');
        }

        const contentType = response.headers.get('content-type') || '';
        let fullContent = '';

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

              if (payload && payload !== '[DONE]') {
                try {
                  const data = JSON.parse(payload);
                  if (data.type === 'content' && data.content) {
                    fullContent += data.content;
                    setCurrentStreamContent(fullContent);
                  }
                } catch {
                  // ignore parse errors
                }
              }
            }

            if (done) break;
          }
        } else {
          const data = await response.json();
          fullContent = data.content || data.message || JSON.stringify(data);
        }

        // Add assistant message
        const assistantMessage: Message = {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: fullContent || 'No response generated.',
        };
        setMessages((prev) => [...prev, assistantMessage]);
        setCurrentStreamContent('');
      } catch (error) {
        if (controller.signal.aborted) return;

        const errorMessage: Message = {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: 'Sorry, something went wrong. Please try again.',
          status: 'error',
        };
        setMessages((prev) => [...prev, errorMessage]);
      } finally {
        setIsLoading(false);
        abortControllerRef.current = null;
      }
    },
    [isLoading, messages]
  );

  const handleQuickAction = (action: 'summarize' | 'reply' | 'quote') => {
    if (!tweetContent) return;

    let prompt = '';
    switch (action) {
      case 'summarize':
        prompt = `Please summarize this tweet:\n\n"${tweetContent}"`;
        break;
      case 'reply':
        prompt = `Please generate a thoughtful reply to this tweet:\n\n"${tweetContent}"`;
        break;
      case 'quote':
        prompt = `Please generate a quote tweet with commentary for this tweet:\n\n"${tweetContent}"`;
        break;
    }
    sendMessage(prompt);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  // Click on reply card to open Twitter
  const handleReplyClick = (replyContent: string) => {
    if (!tweetId) return;
    const replyText = encodeURIComponent(replyContent);
    const twitterUrl = `https://x.com/intent/post?text=${replyText}&in_reply_to=${tweetId}`;
    window.open(twitterUrl, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-3 dark:border-gray-800">
        <Image
          src={bnbotAI}
          alt="BNBOT AI"
          width={28}
          height={28}
          className="rounded-full"
        />
        <span className="text-sm font-semibold text-gray-900 dark:text-white">
          BNBOT
        </span>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-4 py-3 overscroll-contain touch-pan-y">
        {messages.length === 0 && !currentStreamContent ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Ask me anything about this tweet
            </p>
            <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
              Use the quick actions below or type your question
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div className="flex flex-col items-start gap-1 max-w-[85%]">
                  <div
                    className={`rounded-2xl px-3 py-2 text-sm ${
                      msg.role === 'user'
                        ? 'bg-[#f0b90b] text-white'
                        : 'cursor-pointer bg-gray-100 text-gray-800 transition hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700'
                    }`}
                    onClick={() => {
                      if (msg.role === 'assistant' && msg.status !== 'login_required') {
                        handleReplyClick(msg.content);
                      }
                    }}
                  >
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                  </div>
                  
                  {msg.status === 'login_required' && (
                    <button
                      type="button"
                      onClick={() => setIsLoginModalOpen(true)}
                      className="rounded-full bg-[#f0b90b] px-3 py-1 text-xs font-medium text-white transition-colors duration-200 hover:bg-[#e6a800]"
                    >
                      Login to continue
                    </button>
                  )}
                  
                  {msg.status === 'error' && (
                     <span className="text-xs text-red-500">发送失败</span>
                  )}
                </div>
              </div>
            ))}

            {/* Streaming content */}
            {currentStreamContent && (
              <div className="flex justify-start">
                <div className="max-w-[85%] rounded-2xl bg-gray-100 px-3 py-2 text-sm text-gray-800 dark:bg-gray-800 dark:text-gray-200">
                  <p className="whitespace-pre-wrap">{currentStreamContent}</p>
                </div>
              </div>
            )}

            {/* Loading indicator */}
            {isLoading && !currentStreamContent && (
              <div className="flex justify-start">
                <div className="flex items-center gap-2 rounded-2xl bg-gray-100 px-3 py-2 dark:bg-gray-800">
                  <span className="loading loading-dots loading-xs text-[#f0b90b]"></span>
                  <span className="text-xs text-gray-500">Thinking...</span>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Quick action buttons */}
      <div className="flex gap-2 border-t border-gray-100 px-4 py-2 dark:border-gray-800">
        <button
          onClick={() => handleQuickAction('summarize')}
          disabled={isLoading || !tweetContent}
          className="flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
        >
          <FileText className="h-3.5 w-3.5" />
          Summary
        </button>
        <button
          onClick={() => handleQuickAction('reply')}
          disabled={isLoading || !tweetContent}
          className="flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
        >
          <Sparkles className="h-3.5 w-3.5" />
          AI Reply
        </button>
        <button
          onClick={() => handleQuickAction('quote')}
          disabled={isLoading || !tweetContent}
          className="flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
        >
          <MessageSquareQuote className="h-3.5 w-3.5" />
          AI Quote
        </button>
      </div>

      {/* Input area */}
      <form onSubmit={handleSubmit} className="border-t border-gray-100 p-3 dark:border-gray-800">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
            rows={1}
            className="flex-1 resize-none rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 placeholder-gray-500 focus:border-[#f0b90b] focus:outline-none focus:ring-1 focus:ring-[#f0b90b] dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:placeholder-gray-400"
            style={{ maxHeight: '120px' }}
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-[#f0b90b] text-white transition hover:bg-[#e6af0a] disabled:opacity-50"
          >
            <SendHorizonal className="h-4 w-4" />
          </button>
        </div>
      </form>
      
      <LoginModal isOpen={isLoginModalOpen} onClose={() => setIsLoginModalOpen(false)} />
    </div>
  );
}
