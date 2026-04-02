'use client';

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckIcon } from '@heroicons/react/24/outline';
import { GeneratedTopic, Message } from '@/types/chat';
import MessageContent from './MessageContent';
import ReasoningSection from './ReasoningSection';

interface ChatMessageProps {
  message: Message;
  index: number;
  onCopyMessage: (content: string, messageId: string) => void;
  onRegenerateMessage: (index: number) => void;
  copiedMessageId: string | null;
  isLoading: boolean;
  showReasoning: { [key: string]: boolean };
  onToggleReasoning: (messageId: string) => void;
  onTopicSelect: (messageId: string | undefined, topic: GeneratedTopic) => void;
  onTweetReferenceSelect?: (tweetIds: string[]) => void;
  isTweetReferenceLoading?: (idsKey: string) => boolean;
  onShowLogin?: () => void;
  shouldAnimate?: boolean;
}

const ChatMessage: React.FC<ChatMessageProps> = ({
  message,
  index,
  onCopyMessage,
  onRegenerateMessage,
  copiedMessageId,
  isLoading,
  showReasoning,
  onToggleReasoning,
  onTopicSelect,
  onTweetReferenceSelect,
  isTweetReferenceLoading,
  onShowLogin = () => undefined,
  shouldAnimate = true,
}) => {
  const messageId = `msg-${index}`;
  const resolvedMessageId = message.id ?? messageId;

  const isUserMessage = message.role === 'user';

  return (
    <motion.div
      initial={shouldAnimate ? { opacity: 0, y: isUserMessage ? 20 : 8 } : { opacity: 1, y: 0 }}
      animate={{ opacity: 1, y: 0 }}
      transition={
        isUserMessage
          ? { duration: 0.25, ease: [0.25, 0.1, 0.25, 1] }
          : { duration: 0.25, ease: [0.16, 1, 0.3, 1] }
      }
      className="mb-6 w-full"
    >
      <div
        className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
      >
        <div
          className={`flex flex-col min-w-0 ${
            message.role === 'user'
              ? 'max-w-[80%] items-end'
              : 'w-full max-w-[100%] items-start'
          }`}
        >
          <div
            className={`transition-all duration-200 min-w-0 w-full ${
              message.role === 'user'
              ? 'flex items-center justify-center rounded-[20px] rounded-br-[8px] bg-gray-100/80 px-4 py-2 font-inter text-base md:text-sm font-normal leading-relaxed tracking-tight text-gray-900 antialiased shadow-sm overflow-hidden'
                : 'bg-transparent px-0 py-1'
            }`}
            data-user-message={message.role === 'user' ? 'true' : undefined}
          >
            {message.role === 'assistant' ? (
              <>
                {/* Reasoning section */}
                {message.reasoning && (
                  <ReasoningSection
                    reasoning={message.reasoning}
                    messageId={messageId}
                    expanded={Boolean(showReasoning[messageId])}
                    onToggle={onToggleReasoning}
                    onTweetReferenceSelect={onTweetReferenceSelect}
                    isTweetReferenceLoading={isTweetReferenceLoading}
                  />
                )}

                {/* Message content */}
                <div className="w-full min-w-0 overflow-hidden font-inter text-base md:text-sm font-normal leading-relaxed tracking-tight text-gray-900 antialiased">
                  <MessageContent
                    content={message.content}
                    onTweetReferenceSelect={onTweetReferenceSelect}
                    isTweetReferenceLoading={isTweetReferenceLoading}
                    toolCallsInfo={message.toolCallsInfo}
                  />
                </div>
              </>
            ) : (
              <div className="whitespace-pre-wrap break-all overflow-hidden">
                {(() => {
                  // Check for quote format: > quoted text\n\nmessage
                  // Using [\s\S] instead of . with s flag for better compatibility
                  const quoteMatch = message.content.match(/^> ([\s\S]*?)\n\n([\s\S]*)/);
                  if (quoteMatch) {
                    const [, quotedText, userText] = quoteMatch;
                    return (
                      <>
                        <div className="mb-2 flex items-center rounded-xl bg-white/60 px-3 py-2">
                          <div className="mr-2 flex-shrink-0 text-gray-400">
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                              <path d="M3.5 5.5V8.5C3.5 9.60457 4.39543 10.5 5.5 10.5H12.5M12.5 10.5L9.5 7.5M12.5 10.5L9.5 13.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                          </div>
                          <div className="flex-1 overflow-hidden">
                            <p className="truncate text-[13px] text-gray-500">“{quotedText}”</p>
                          </div>
                        </div>
                        {userText}
                      </>
                    );
                  }
                  return message.content;
                })()}
              </div>
            )}

            {/* Message status indicator */}
            {message.status && (
              <div className="mt-1 flex items-center gap-1">
                {message.status === 'sending' && (
                  <>
                    <div className="h-2 w-2 animate-pulse rounded-full bg-yellow-400"></div>
                    <span className="text-xs text-gray-500">发送中...</span>
                  </>
                )}
                {message.status === 'login_required' && message.role === 'assistant' && (
                  <button
                    type="button"
                    onClick={onShowLogin}
                    className="rounded-full bg-[#f0b90b] px-3 py-1 text-xs font-medium text-white transition-colors duration-200 hover:bg-[#e6a800]"
                  >
                    Login to continue
                  </button>
                )}
                {message.status === 'error' && message.role === 'assistant' && (
                  <>
                    <div className="h-2 w-2 rounded-full bg-red-400"></div>
                    <span className="text-xs text-red-500">发送失败</span>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Action buttons for assistant messages */}
          {message.role === 'assistant' && message.status !== 'login_required' && (
            <div className="mt-0.5 flex items-center gap-1">
              {/* Copy button */}
              <button
                onClick={() => onCopyMessage(message.content, messageId)}
                className={`group relative flex items-center justify-center p-1 transition-all duration-200 ${
                  copiedMessageId === messageId
                    ? 'text-green-600'
                    : 'text-gray-400 hover:text-gray-600'
                }`}
                title={copiedMessageId === messageId ? '已复制' : '复制'}
              >
                {copiedMessageId === messageId ? (
                  <CheckIcon className="h-4 w-4" />
                ) : (
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                    />
                  </svg>
                )}
              </button>

              {/* Regenerate button */}
              <button
                onClick={() => onRegenerateMessage(index)}
                className={`group relative flex items-center justify-center p-1 transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-50 ${
                  message.status === 'error'
                    ? 'text-red-500 hover:text-red-600'
                    : 'text-gray-400 hover:text-gray-600'
                }`}
                title={message.status === 'error' ? '重试发送' : '重新生成'}
                disabled={isLoading}
              >
                <svg
                  className="h-4 w-4 transition-transform duration-500 group-hover:rotate-180"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
              </button>
            </div>
          )}

          <AnimatePresence mode="popLayout">
            {message.role === 'assistant' &&
            !message.topicsDismissed &&
            !message.topicsLoading &&
            message.topics &&
            message.topics.length > 0 ? (
              <motion.div
                key={`${resolvedMessageId}-topics`}
                initial={{ opacity: 0 }}
                animate={{
                  opacity: 1,
                  transition: { duration: 0.15 }
                }}
                exit={{
                  opacity: 0,
                  transition: { duration: 0.1 }
                }}
                className="mt-3 flex w-full justify-end"
              >
                <div className="flex max-w-[80%] flex-col items-end gap-2">
                  {message.topics.map((topic, idx) => {
                    const displayQuestion =
                      topic.question?.trim() ||
                      topic.title?.trim() ||
                      topic.hook?.trim() ||
                      topic.angle?.trim() ||
                      'Explore this topic';

                    return (
                      <motion.button
                        key={`${resolvedMessageId}-topic-${idx}`}
                        type="button"
                        onClick={() => onTopicSelect(resolvedMessageId, topic)}
                        className="rounded-2xl border border-gray-100 bg-white px-4 py-2 text-left text-gray-800 shadow-sm transition hover:border-gray-200 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#f0b90b]"
                        initial={{ opacity: 0 }}
                        animate={{
                          opacity: 1,
                          transition: {
                            duration: 0.2,
                            delay: idx * 0.05
                          }
                        }}
                        exit={{
                          opacity: 0,
                          transition: { duration: 0.08 }
                        }}
                      >
                        <span className="text-xs text-gray-800 whitespace-pre-wrap break-words">
                          {displayQuestion}
                        </span>
                      </motion.button>
                    );
                  })}
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
};

export default React.memo(ChatMessage);
