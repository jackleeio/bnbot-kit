'use client';

import React, { useRef, useEffect } from 'react';
import { ArrowUpIcon, StopIcon, ArrowPathIcon } from '@heroicons/react/24/solid';
import { useTranslations } from 'next-intl';
import { SelectedAgent } from '@/types/chat';

interface ChatInputProps {
  input: string;
  setInput: (value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onInterrupt: () => void;
  isLoading: boolean;
  isMobile: boolean;
  selectedAgent: SelectedAgent | null;
  placeholder?: string;
  textareaRef?: React.RefObject<HTMLTextAreaElement>;
  topNotice?: React.ReactNode;
  quotedText?: string | null;
  onClearQuote?: () => void;
  hydrated?: boolean;
  onNewChat?: () => void;
}

const ChatInput: React.FC<ChatInputProps> = ({
  input,
  setInput,
  onSubmit,
  onKeyDown,
  onInterrupt,
  isLoading,
  isMobile,
  selectedAgent,
  placeholder,
  textareaRef,
  topNotice,
  quotedText,
  onClearQuote,
  hydrated = true,
  onNewChat,
}) => {
  const t = useTranslations('chatWelcome');
  const fallbackRef = useRef<HTMLTextAreaElement>(null);
  const inputRef = textareaRef ?? fallbackRef;

  // Set textarea height
  const setTextareaHeight = (textarea: HTMLTextAreaElement) => {
    const base = 45;
    const max = 150;
    textarea.style.height = 'auto';
    const next = Math.max(base, Math.min(textarea.scrollHeight, max));
    textarea.style.height = `${next}px`;
  };

  // Update height when input changes
  useEffect(() => {
    if (inputRef.current) {
      setTextareaHeight(inputRef.current);
    }
  }, [input]);

  const QuoteBox = () => {
    if (!quotedText) return null;
    return (
      <div className="mb-1 flex items-center rounded-xl bg-gray-50/80 px-3 py-2 mx-2 mt-2">
        <div className="mr-2 flex-shrink-0 text-gray-400">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M3.5 5.5V8.5C3.5 9.60457 4.39543 10.5 5.5 10.5H12.5M12.5 10.5L9.5 7.5M12.5 10.5L9.5 13.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
        <div className="flex-1 overflow-hidden">
          <p className="truncate text-sm text-gray-500">"{quotedText}"</p>
        </div>
        <button
          type="button"
          onClick={onClearQuote}
          className="ml-2 flex-shrink-0 text-gray-400 hover:text-gray-600"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
            <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
          </svg>
        </button>
      </div>
    );
  };

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-[9999] px-2 pb-1 pt-2 md:absolute md:bottom-0 md:left-0 md:right-0 md:z-auto md:px-3 md:pb-2 md:pt-3"
      data-chat-input-container="true"
      data-is-mobile={isMobile && hydrated ? 'true' : 'false'}
      style={{
        paddingBottom: isMobile && hydrated ? 'max(4px, env(safe-area-inset-bottom))' : undefined,
        background: 'transparent',
      }}
    >
      <form onSubmit={onSubmit}>
        {topNotice && (
          <div className="mb-2 px-3 text-center text-xs text-gray-400">
            {topNotice}
          </div>
        )}

        <div className="relative flex flex-col overflow-hidden rounded-[28px] border border-gray-200/90 bg-white shadow-sm transition-shadow duration-150 focus-within:border-gray-300">
          <QuoteBox />
          <div className="relative flex items-end">
            <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder={
                  placeholder
                    ? placeholder
                    : selectedAgent
                      ? t('placeholderAgent', { agentName: selectedAgent.name })
                      : t('placeholder')
                }
              rows={1}
              className={`scrollbar-none max-h-[150px] min-h-[45px] w-full resize-none bg-transparent py-3 pl-[20px] font-sans text-base font-normal leading-[1.5] tracking-tight text-gray-900 placeholder:text-gray-500 transition-none antialiased focus:outline-none focus:ring-0 border-none shadow-none rounded-[28px] ${
                onNewChat ? 'pr-24' : 'pr-14'
              }`}
              style={{
                lineHeight: '1.5',
                height: 'auto',
                fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
              }}
              onInput={(e) => {
                const target = e.target as HTMLTextAreaElement;
                setTextareaHeight(target);
              }}
            />
            {/* Buttons container */}
            <div className="absolute bottom-[6px] right-2 flex items-center gap-1">
              <button
                type={isLoading ? 'button' : 'submit'}
                onClick={isLoading ? onInterrupt : undefined}
                disabled={!isLoading && !input.trim()}
                className={`rounded-full p-2 font-bold transition-colors duration-200 ${
                  isLoading
                    ? 'bg-red-500 text-white hover:bg-red-600'
                    : 'bg-[#f0b90b] text-white hover:bg-gray-800 disabled:bg-[#f0b90b]/50 disabled:hover:bg-gray-300'
                }`}
                title={isLoading ? t('stopGeneration') : t('sendMessage')}
              >
                {isLoading ? (
                  <StopIcon className="h-5 w-5" />
                ) : (
                  <ArrowUpIcon className="h-5 w-5" />
                )}
              </button>
              {/* New Chat Button */}
              {onNewChat && (
                <button
                  type="button"
                  onClick={onNewChat}
                  className="rounded-full p-2 bg-gray-100 text-gray-500 transition-colors duration-200 hover:bg-gray-200 hover:text-gray-700"
                  title="Start new chat"
                >
                  <ArrowPathIcon className="h-5 w-5" />
                </button>
              )}
            </div>
          </div>
        </div>
      </form>
    </div>
  );
};

export default ChatInput;
