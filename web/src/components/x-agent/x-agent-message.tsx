'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { CheckIcon } from '@heroicons/react/24/outline';
import { XAgentMessage as XAgentMessageType, TweetDraft } from '@/types/x-agent';
import MessageContent from '@/components/chat/MessageContent';
import ReasoningSection from '@/components/chat/ReasoningSection';
import ToolCallBadges from '@/components/chat/ToolCallBadges';
import InterleavedMessageContent from '@/components/chat/InterleavedMessageContent';
import TweetDraftCard from './tweet-draft-card';

interface XAgentMessageProps {
  message: XAgentMessageType;
  index: number;
  onCopyMessage: (content: string, messageId: string) => void;
  onRegenerateMessage: (index: number) => void;
  copiedMessageId: string | null;
  isLoading: boolean;
  showReasoning: { [key: string]: boolean };
  onToggleReasoning: (messageId: string) => void;
  onDraftPreview?: (draft: TweetDraft) => void;
  onShowLogin?: () => void;
  skipEntryAnimation?: boolean;
}

const XAgentMessage: React.FC<XAgentMessageProps> = ({
  message,
  index,
  onCopyMessage,
  onRegenerateMessage,
  copiedMessageId,
  isLoading,
  showReasoning,
  onToggleReasoning,
  onDraftPreview,
  onShowLogin = () => { },
  skipEntryAnimation = false,
}) => {
  const messageId = `msg-${index}`;

  return (
    <motion.div
      initial={skipEntryAnimation ? false : { opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="mb-6 w-full"
    >
      <div
        className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
      >
        <div
          className={`flex flex-col ${message.role === 'user'
            ? 'max-w-[80%] items-end'
            : 'w-full max-w-[100%] items-start'
            }`}
        >
          <div
            className={`transition-all duration-200 ${message.role === 'user'
              ? 'flex items-center rounded-[20px] rounded-br-[8px] bg-gray-100 px-4 py-2 font-inter text-sm font-normal leading-relaxed tracking-tight text-gray-900 antialiased shadow-sm'
              : 'bg-transparent px-0 py-1 font-inter text-sm font-normal leading-relaxed tracking-tight text-gray-900 antialiased'
              }`}
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
                  />
                )}

                {/* Interleaved Content & Tools */}
                <InterleavedMessageContent
                  content={message.content}
                  toolCalls={message.toolCalls}
                  toolCallsInfo={message.toolCallsInfo}
                  isStreaming={message.isStreaming}
                  showToolBadges={false}
                />

                {/* Tweet Drafts */}
                {message.tweetDrafts && message.tweetDrafts.data?.drafts && (
                  <div className={`${message.content ? 'mt-4' : ''} grid gap-3`}>
                    {message.tweetDrafts.data.drafts.map((draft, idx) => (
                      <TweetDraftCard
                        key={idx}
                        draft={draft}
                        index={idx}
                        onPreview={onDraftPreview || (() => { })}
                      />
                    ))}
                  </div>
                )}

                {message.status === 'login_required' && (
                  <div className="mt-4">
                    <button
                      type="button"
                      onClick={onShowLogin}
                      className="rounded-full bg-[#f0b90b] px-4 py-2 text-xs font-medium text-white transition-colors duration-200 hover:bg-[#e6a800]"
                    >
                      Login to continue
                    </button>
                  </div>
                )}
              </>
            ) : (
              <p className="whitespace-pre-wrap break-words">
                {message.content}
              </p>
            )}

            {/* Streaming indicator */}
            {message.isStreaming && message.role === 'assistant' && (
              <span className="ml-1 inline-block h-3 w-1 animate-pulse bg-[#f0b90b]"></span>
            )}
          </div>

          {/* Action buttons for assistant messages */}
          {message.role === 'assistant' && !isLoading && !message.isStreaming && message.status !== 'login_required' && (
            <div className="mt-0.5 flex items-center gap-1">
              {/* Copy button */}
              <button
                onClick={() => {
                  // If message has tweet drafts but empty content, copy the draft content
                  let contentToCopy = message.content;
                  if (!contentToCopy && message.tweetDrafts?.data?.drafts?.length) {
                    const draft = message.tweetDrafts.data.drafts[0];
                    const hashtags = draft?.hashtags?.length ? draft.hashtags.join(' ') : '';
                    contentToCopy = `${draft?.content || ''}${hashtags ? '\n\n' + hashtags : ''}`;
                  }
                  onCopyMessage(contentToCopy, messageId);
                }}
                className={`group relative flex items-center justify-center p-1 transition-all duration-200 ${copiedMessageId === messageId
                  ? 'text-green-600'
                  : 'text-gray-400 hover:text-gray-600'
                  }`}
                title={copiedMessageId === messageId ? 'Copied' : 'Copy'}
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
                className="group relative flex items-center justify-center p-1 text-gray-400 transition-all duration-200 hover:text-gray-600 disabled:cursor-not-allowed disabled:opacity-50"
                title="Regenerate"
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
        </div>
      </div>
    </motion.div>
  );
};

export default React.memo(XAgentMessage);
