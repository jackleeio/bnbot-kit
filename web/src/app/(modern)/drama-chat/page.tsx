'use client';

import { useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import { ArrowUpIcon } from '@heroicons/react/24/solid';
import { 
  DocumentDuplicateIcon, 
  ArrowPathIcon, 
  CheckIcon 
} from '@heroicons/react/24/outline';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
}

const WEBHOOK_URL = 'https://n8n.bnbot.ai/webhook/f46cd321-7b9f-4a51-a2c1-9ae1d8bb9db0/chat';

export default function DramaChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string>('');
  const [isChatOpen, setIsChatOpen] = useState(true);
  const [userHasScrolled, setUserHasScrolled] = useState(false);
  const [streamingMessageIndex, setStreamingMessageIndex] = useState<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [hasMounted, setHasMounted] = useState(false);

  // 初始化会话ID和移动端设置
  useEffect(() => {
    const storedSessionId = localStorage.getItem('drama-chat-session-id');
    if (storedSessionId) {
      setSessionId(storedSessionId);
    } else {
      const newSessionId = `drama_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      setSessionId(newSessionId);
      localStorage.setItem('drama-chat-session-id', newSessionId);
    }

    setIsMobile(window.innerWidth < 768);
    setHasMounted(true);

    // Fix body overflow to prevent page scrolling
    document.body.style.overflow = 'hidden';
    document.body.style.height = '100vh';

    const checkIfMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };

    window.addEventListener('resize', checkIfMobile);
    return () => {
      // Restore body overflow when leaving chat page
      document.body.style.overflow = '';
      document.body.style.height = '';
      window.removeEventListener('resize', checkIfMobile);
    };
  }, []);

  // 获取当前活动的输入框
  const getCurrentInputRef = () => {
    return messages.length === 0 ? inputRef : chatInputRef;
  };

  // 统一的高度设置函数
  const setTextareaHeight = (textarea: HTMLTextAreaElement) => {
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
  };

  // 确保输入框在首次渲染时有正确的高度
  useEffect(() => {
    const initializeTextareaHeight = () => {
      if (messages.length === 0 && inputRef.current) {
        setTextareaHeight(inputRef.current);
      } else if (messages.length > 0 && chatInputRef.current) {
        setTextareaHeight(chatInputRef.current);
      }
    };

    // 延迟执行确保DOM已经渲染
    const timer = setTimeout(initializeTextareaHeight, 0);
    return () => clearTimeout(timer);
  }, [messages.length]);

  // 当input内容变化时，确保当前活动的输入框高度正确
  useEffect(() => {
    const currentInput = getCurrentInputRef();
    if (currentInput.current) {
      setTextareaHeight(currentInput.current);
    }
  }, [input, messages.length]);

  const scrollToBottom = () => {
    if (!userHasScrolled && messagesEndRef.current && chatContainerRef.current) {
      const container = chatContainerRef.current;
      container.scrollTop = container.scrollHeight;
    }
  };

  const handleChatScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.target as HTMLDivElement;
    const isScrolledToBottom =
      Math.abs(target.scrollHeight - target.scrollTop - target.clientHeight) <
      10;

    if (!isScrolledToBottom) {
      setUserHasScrolled(true);
    } else {
      setUserHasScrolled(false);
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) {
      return;
    }

    if (e.key === 'Enter') {
      if (e.shiftKey) {
        e.preventDefault();
        const cursorPosition = e.currentTarget.selectionStart;
        const newValue = 
          input.slice(0, cursorPosition) + '\n' + input.slice(cursorPosition);
        setInput(newValue);

        setTimeout(() => {
          const currentInput = getCurrentInputRef();
          if (currentInput.current) {
            currentInput.current.selectionStart = cursorPosition + 1;
            currentInput.current.selectionEnd = cursorPosition + 1;
            
            setTextareaHeight(currentInput.current);

            const event = new Event('input', { bubbles: true });
            currentInput.current.dispatchEvent(event);
          }
        }, 0);
      } else {
        e.preventDefault();
        handleSubmit(e);
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage = input.trim();
    setInput('');

    // Only focus the input on desktop, not on mobile
    if (!isMobile) {
      setTimeout(() => {
        getCurrentInputRef().current?.focus();
      }, 0);
    }

    // Update local messages state
    const updatedMessages: Message[] = [
      ...messages,
      { role: 'user', content: userMessage, timestamp: new Date() },
    ];
    setMessages(updatedMessages);
    setIsLoading(true);

    try {
      // Send message to webhook with streaming
      const response = await fetch(WEBHOOK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chatInput: userMessage,
          sessionId: sessionId
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      // Check if response is streaming (JSONL format)
      const contentType = response.headers.get('content-type');
      const isStreaming = contentType?.includes('application/json') || 
                         contentType?.includes('text/plain') || 
                         contentType?.includes('text/event-stream');
      
      if (response.body) {
        // Handle streaming response (JSONL format)
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        
        // Don't create initial message, create it when first content arrives
        let messageIndex = -1;
        let accumulatedContent = '';
        let buffer = '';
        let hasCreatedMessage = false;
        
        try {
          while (true) {
            const { done, value } = await reader.read();
            
            if (done) {
              // Mark streaming as complete (only if message was created)
              if (hasCreatedMessage && messageIndex >= 0) {
                setMessages(prev => 
                  prev.map((msg, idx) => 
                    idx === messageIndex
                      ? { ...msg, isStreaming: false }
                      : msg
                  )
                );
              }
              setStreamingMessageIndex(null);
              break;
            }
            
            const chunk = decoder.decode(value, { stream: true });
            buffer += chunk;
            
            // Process complete lines (JSONL format)
            const lines = buffer.split('\n');
            buffer = lines.pop() || ''; // Keep incomplete line in buffer
            
            for (const line of lines) {
              if (line.trim()) {
                try {
                  const data = JSON.parse(line.trim());
                  console.log('Parsed data:', data);
                  
                  // Handle different event types
                  if (data.type === 'item' && data.content) {
                    accumulatedContent += data.content;
                    console.log('Content chunk:', data.content);
                    console.log('Total accumulated:', accumulatedContent);
                    
                    // Create message only when first content arrives
                    if (!hasCreatedMessage) {
                      const initialAssistantMessage: Message = {
                        role: 'assistant',
                        content: accumulatedContent,
                        timestamp: new Date(),
                        isStreaming: true
                      };
                      
                      setMessages(prev => {
                        const newMessages = [...prev, initialAssistantMessage];
                        messageIndex = newMessages.length - 1;
                        setStreamingMessageIndex(messageIndex);
                        console.log('Created new message at index:', messageIndex);
                        return newMessages;
                      });
                      hasCreatedMessage = true;
                    } else {
                      // Update existing streaming message
                      console.log('Updating message at index:', messageIndex);
                      setMessages(prev => {
                        console.log('Previous messages:', prev.length);
                        return prev.map((msg, idx) => 
                          idx === messageIndex
                            ? { ...msg, content: accumulatedContent }
                            : msg
                        );
                      });
                    }
                  }
                  // Handle begin and end events if needed
                  else if (data.type === 'begin') {
                    console.log('Stream started:', data.metadata);
                  }
                  else if (data.type === 'end') {
                    console.log('Stream ended:', data.metadata);
                  }
                } catch (parseError) {
                  console.error('Error parsing JSON line:', line, parseError);
                }
              }
            }
          }
        } catch (streamError) {
          console.error('Streaming error:', streamError);
          // Update message with error (only if message was created)
          if (hasCreatedMessage && messageIndex >= 0) {
            setMessages(prev => 
              prev.map((msg, idx) => 
                idx === messageIndex
                  ? { 
                      ...msg, 
                      content: accumulatedContent || 'Stream was interrupted. Please try again.',
                      isStreaming: false 
                    }
                    : msg
              )
            );
          } else {
            // If no content was received, create an error message
            const errorMessage: Message = {
              role: 'assistant',
              content: 'Stream was interrupted. Please try again.',
              timestamp: new Date()
            };
            setMessages(prev => [...prev, errorMessage]);
          }
          setStreamingMessageIndex(null);
        }
      } else {
        // Fallback: if no response body, try to parse as regular JSON
        try {
          const responseData = await response.json();
          const assistantContent = responseData.output || responseData.reply || responseData.response || responseData.message || '消息已成功发送到Drama Agent！';
          
          const assistantMessage: Message = {
            role: 'assistant',
            content: assistantContent,
            timestamp: new Date()
          };
          
          setMessages(prev => [...prev, assistantMessage]);
        } catch (parseError) {
          console.error('JSON parse error:', parseError);
          const errorMessage: Message = {
            role: 'assistant',
            content: 'Invalid response format. Please try again.',
            timestamp: new Date()
          };
          setMessages(prev => [...prev, errorMessage]);
        }
      }

    } catch (error) {
      console.error('Error sending message:', error);
      
      const errorMessage: Message = {
        role: 'assistant',
        content: `网络错误: ${error instanceof Error ? error.message : '连接失败'}。请检查网络连接或稍后再试。`,
        timestamp: new Date()
      };

      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
      
      // Only focus the input on desktop after the response is complete
      if (!isMobile) {
        setTimeout(() => {
          getCurrentInputRef().current?.focus();
        }, 0);
      }
    }
  };

  const handleCopyMessage = (content: string, messageId: string) => {
    navigator.clipboard.writeText(content);
    setCopiedMessageId(messageId);

    setTimeout(() => {
      setCopiedMessageId(null);
    }, 3000);
  };

  // Prevent rendering until after client-side hydration
  if (!hasMounted) {
    return (
      <div className="relative flex h-screen overflow-hidden">
        <div className="w-full"></div>
      </div>
    );
  }

  return (
    <div className="relative flex h-screen overflow-hidden bg-body">
      {/* 移动端切换按钮 */}
      {isMobile && (
        <div className="absolute left-0 top-5 z-20 flex w-[30px] items-center justify-between rounded-r-xl bg-gray-100/80 text-gray-500 shadow-sm">
          <button
            className="rounded-lg px-1.5 py-1.5"
            onClick={() => setIsChatOpen(!isChatOpen)}
          >
            {isChatOpen ? (
              <ChevronLeftIcon className="h-5 w-5" />
            ) : (
              <ChevronRightIcon className="h-5 w-5" />
            )}
          </button>
        </div>
      )}

      {/* 左侧聊天框 - 1:1 layout (50%) */}
      <div
        className={`transition-all duration-300 ease-in-out ${
          isChatOpen 
            ? isMobile 
              ? 'w-full' 
              : 'w-1/2'
            : 'w-0 overflow-hidden'
        }`}
        style={{
          zIndex: isMobile && isChatOpen ? 10 : 'auto',
        }}
      >
        <div className={`${isMobile ? 'h-screen px-0 py-0' : 'h-screen p-2 pb-6'}`}>
          <div
            className={`flex h-full flex-col ${isMobile ? 'bg-white' : 'rounded-lg bg-white shadow-card'} ${
              isMobile && isChatOpen ? '' : ''
            }`}
          >
            {/* 提示文字 */}
            {messages.length === 0 ? (
              <div className="flex h-full flex-col">
                <div className="flex flex-1 flex-col items-center justify-center space-y-4 text-gray-500">
                  <div className="mb-1">
                    <p className="text-center text-lg font-bold md:text-xl">
                      Welcome to{' '}
                      <span className="text-[#f0b90b]">Drama Chat</span>
                    </p>
                    <p className="text-center text-xs md:text-md">
                      AI-powered drama agent for interactive storytelling
                    </p>
                  </div>

                  {/* 输入框部分 */}
                  <div className="w-full px-4">
                    <form onSubmit={handleSubmit} className="w-full">
                      <div className="relative flex items-end">
                        <textarea
                          ref={inputRef}
                          value={input}
                          onChange={(e) => setInput(e.target.value)}
                          onKeyDown={handleKeyDown}
                          placeholder="Start your story with Drama Agent..."
                          rows={3}
                          className="scrollbar-none max-h-[200px] min-h-[44px] w-full resize-none rounded-2xl border border-gray-100 bg-white py-3 pl-4 pr-12 text-black focus:border-gray-300 focus:outline-none focus:ring-0"
                          style={{
                            lineHeight: '1.5',
                            height: 'auto',
                          }}
                          onInput={(e) => {
                            const target = e.target as HTMLTextAreaElement;
                            setTextareaHeight(target);
                          }}
                        />
                        <button
                          type="submit"
                          disabled={isLoading || !input.trim()}
                          className="absolute bottom-2 right-2 rounded-full bg-[#f0b90b] p-1 p-1.5 font-bold text-white hover:bg-[#f0b90b]/80 disabled:bg-gray-300 disabled:text-white disabled:hover:bg-gray-300"
                        >
                          <ArrowUpIcon className="h-5 w-5" />
                        </button>
                      </div>
                    </form>
                  </div>
                  <div className="flex w-full max-w-md flex-wrap justify-center gap-2 px-4">
                    <button 
                      onClick={() => setInput('Create a romantic drama story')}
                      className="rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-center text-xs hover:bg-gray-50"
                    >
                      Romance Drama
                    </button>
                    <button 
                      onClick={() => setInput('Create a thriller drama plot')}
                      className="rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-center text-xs hover:bg-gray-50"
                    >
                      Thriller Drama
                    </button>
                    <button 
                      onClick={() => setInput('Help me develop characters')}
                      className="rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-center text-xs hover:bg-gray-50"
                    >
                      Character Dev
                    </button>
                  </div>
                </div>

                {/* Disclaimer - 固定在底部 */}
                <div className={`mt-auto bg-white border-t border-gray-100 px-4 py-3 text-center ${!isMobile ? 'rounded-b-lg' : ''}`}>
                  <p className="text-[12px] text-gray-400 md:text-xs">
                    Drama Agent may make mistakes. Use creatively.
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex h-full flex-col">
                <div
                  ref={chatContainerRef}
                  onScroll={handleChatScroll}
                  className="scrollbar-none flex-1 overflow-y-auto p-4"
                >
                  {messages.map((message, index) => (
                    <motion.div
                      key={index}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.5 }}
                      className="mb-6 w-full"
                    >
                      <div
                        className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                      >
                        <div
                          className={`${message.role === 'user' ? 'max-w-[80%]' : 'max-w-[100%]'}`}
                        >
                          <div
                            className={`rounded-3xl ${
                              message.role === 'user'
                                ? 'rounded-br-lg bg-gray-100 px-6 py-3 text-black'
                                : 'bg-transparent text-black'
                            }`}
                          >
                            <div className="whitespace-pre-wrap break-words">
                              {message.content}
                              {message.isStreaming && (
                                <span className="ml-1 inline-block h-4 w-0.5 bg-gray-400 animate-pulse"></span>
                              )}
                            </div>
                          </div>

                          {message.role === 'assistant' && !isLoading && !message.isStreaming && (
                            <div className="mt-1 flex space-x-2">
                              <button
                                onClick={() =>
                                  handleCopyMessage(
                                    message.content,
                                    `msg-${index}`,
                                  )
                                }
                                className="text-gray-500 transition-colors hover:text-gray-700"
                                title={
                                  copiedMessageId === `msg-${index}`
                                    ? 'Copied!'
                                    : 'Copy message'
                                }
                              >
                                {copiedMessageId === `msg-${index}` ? (
                                  <CheckIcon className="h-4 w-4 text-green-500" />
                                ) : (
                                  <DocumentDuplicateIcon className="h-4 w-4" />
                                )}
                              </button>
                              <button
                                onClick={() => {
                                  const userMessages = messages.filter(
                                    (msg) => msg.role === 'user',
                                  );
                                  if (userMessages.length > 0) {
                                    const lastUserMessage =
                                      userMessages[userMessages.length - 1];
                                    setInput(lastUserMessage.content);
                                  }
                                }}
                                className="text-gray-500 transition-colors hover:text-gray-700"
                                title="Regenerate response"
                              >
                                <ArrowPathIcon className="h-4 w-4" />
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  ))}

                  {isLoading && streamingMessageIndex === null && (
                    <div className="flex justify-start pl-0">
                      <div className="max-w-[85%] rounded-lg bg-transparent px-2 py-2">
                        <div className="flex items-center space-x-5">
                          <span className="loading loading-dots loading-xs bg-[#f0b90b]"></span>
                        </div>
                      </div>
                    </div>
                  )}

                  <div ref={messagesEndRef} />
                </div>

                {/* 输入框部分 - 底部固定 */}
                <div className={`mt-auto bg-white border-t border-gray-100 px-4 py-4 ${!isMobile ? 'rounded-b-lg' : ''}`}>
                  <form onSubmit={handleSubmit}>
                    <div className="relative flex items-end">
                      <textarea
                        ref={chatInputRef}
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="Message Drama Agent..."
                        rows={3}
                        className="scrollbar-none max-h-[200px] min-h-[44px] w-full resize-none rounded-2xl border border-gray-100 bg-white py-3 pl-4 pr-12 text-black focus:border-gray-300 focus:outline-none focus:ring-0"
                        style={{
                          lineHeight: '1.5',
                          height: 'auto',
                        }}
                        onInput={(e) => {
                          const target = e.target as HTMLTextAreaElement;
                          setTextareaHeight(target);
                        }}
                      />
                      <button
                        type="submit"
                        disabled={isLoading || !input.trim()}
                        className="absolute bottom-2 right-2 rounded-full bg-[#f0b90b] p-1 p-1.5 font-bold text-white hover:bg-[#f0b90b]/80 disabled:bg-gray-300 disabled:text-white disabled:hover:bg-gray-300"
                      >
                        <ArrowUpIcon className="h-5 w-5" />
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 右侧面板 - 1:1 layout (50%) */}
      <div
        className={`transition-all duration-300 ease-in-out ${
          isChatOpen
            ? isMobile
              ? 'w-0 opacity-0 overflow-hidden' // On mobile when chat is open, hide completely
              : 'w-1/2' // On desktop when chat is open
            : 'w-full' // When chat is closed (both mobile and desktop)
        }`}
        style={{
          pointerEvents: isMobile && isChatOpen ? 'none' : 'auto',
        }}
      >
        <div className={`${isMobile ? 'h-screen px-0 py-0' : 'h-screen p-2 pb-6'}`}>
          <div className={`h-full ${isMobile ? 'bg-white' : 'rounded-lg bg-white shadow-card'}`}>
            {/* Drama Agent信息区域 */}
            <div className="flex h-full flex-col">
              <div className="flex-1 overflow-y-auto p-6 pb-0">
              {/* Agent头像和基本信息 */}
              <div className="mb-6 text-center">
                <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-purple-100 to-indigo-100">
                  <svg className="h-10 w-10 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 4V2a1 1 0 011-1h8a1 1 0 011 1v2m0 0V3a1 1 0 011 1v1M7 4V3a1 1 0 011-1v0M7 4H6a2 2 0 00-2 2v12a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1m-6 0V3" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold text-gray-900">Drama Agent</h3>
                <p className="text-sm text-gray-500">Creative AI for interactive storytelling and drama development</p>
                <div className="mt-2 inline-flex items-center gap-1 rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-700">
                  <div className="h-2 w-2 rounded-full bg-green-500"></div>
                  Active
                </div>
              </div>

              {/* Agent能力介绍 */}
              <div className="mb-6">
                <h4 className="mb-3 text-sm font-semibold text-gray-900">Core Capabilities</h4>
                <div className="space-y-3">
                  <div className="flex items-start gap-3 rounded-lg bg-blue-50 p-3">
                    <div className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-blue-500 text-white">
                      <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-blue-900">Story Creation</p>
                      <p className="text-xs text-blue-700">Generate engaging plots and narratives</p>
                    </div>
                  </div>
                  
                  <div className="flex items-start gap-3 rounded-lg bg-green-50 p-3">
                    <div className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-green-500 text-white">
                      <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-green-900">Character Development</p>
                      <p className="text-xs text-green-700">Build complex, relatable characters</p>
                    </div>
                  </div>
                  
                  <div className="flex items-start gap-3 rounded-lg bg-purple-50 p-3">
                    <div className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-purple-500 text-white">
                      <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-purple-900">Script Writing</p>
                      <p className="text-xs text-purple-700">Help with dialogue and scene development</p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3 rounded-lg bg-orange-50 p-3">
                    <div className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-orange-500 text-white">
                      <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-orange-900">Creative Feedback</p>
                      <p className="text-xs text-orange-700">Analyze and improve your dramatic works</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* 创作技巧 */}
              <div className="mb-6">
                <h4 className="mb-3 text-sm font-semibold text-gray-900">Drama Writing Tips</h4>
                <div className="space-y-2 text-sm text-gray-600">
                  <div className="flex items-start gap-2">
                    <span className="text-[#f0b90b]">•</span>
                    <span>Start with compelling characters and their motivations</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="text-[#f0b90b]">•</span>
                    <span>Create conflict that drives the narrative forward</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="text-[#f0b90b]">•</span>
                    <span>Use dialogue to reveal character and advance plot</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="text-[#f0b90b]">•</span>
                    <span>Build tension through pacing and structure</span>
                  </div>
                </div>
              </div>

              {/* 最近活动 */}
              <div>
                <h4 className="mb-3 text-sm font-semibold text-gray-900">Recent Activity</h4>
                <div className="space-y-3">
                  <div className="flex items-center gap-3 text-sm">
                    <div className="h-2 w-2 rounded-full bg-blue-400"></div>
                    <span className="text-gray-600">Created 3 character profiles</span>
                    <span className="text-xs text-gray-400">5 min ago</span>
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    <div className="h-2 w-2 rounded-full bg-green-400"></div>
                    <span className="text-gray-600">Generated plot outline</span>
                    <span className="text-xs text-gray-400">12 min ago</span>
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    <div className="h-2 w-2 rounded-full bg-purple-400"></div>
                    <span className="text-gray-600">Reviewed dialogue samples</span>
                    <span className="text-xs text-gray-400">25 min ago</span>
                  </div>
                </div>
              </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}