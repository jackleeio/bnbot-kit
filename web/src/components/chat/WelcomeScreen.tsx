'use client';

import React, { useRef, useEffect, useState, useCallback } from 'react';
import Image from 'next/image';
import { ArrowUpIcon, StopIcon } from '@heroicons/react/24/solid';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslations, useLocale } from 'next-intl';
import { SelectedAgent } from '@/types/chat';
import bnbotAI from '@/assets/images/logo/bnbot-ai.jpg';
import TypewriterText from './TypewriterText';

interface WelcomeScreenProps {
  input: string;
  setInput: (value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onInterrupt: () => void;
  isLoading: boolean;
  selectedAgent: SelectedAgent | null;
  onClearAgent: () => void;
  showInlineInput?: boolean;
  onQuickPrompt?: (prompt: string) => void;
  showDisclaimer?: boolean;
  serverPrompts?: string[];
}

const PROMPT_BATCH_SIZE = 4;
const PROMPT_REFRESH_INTERVAL = 8000;
const promptTextVariants = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
};

const WelcomeScreen: React.FC<WelcomeScreenProps> = ({
  input,
  setInput,
  onSubmit,
  onKeyDown,
  onInterrupt,
  isLoading,
  selectedAgent,
  onClearAgent,
  showInlineInput = true,
  onQuickPrompt,
  showDisclaimer = true,
  serverPrompts = [],
}) => {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const promptsRef = useRef<string[]>([]);
  const [visiblePrompts, setVisiblePrompts] = useState<string[]>([]);
  const [batchIndex, setBatchIndex] = useState(0);
  const [typewriterStep, setTypewriterStep] = useState(0);
  const t = useTranslations('chatWelcome');
  const locale = useLocale();

  // Use server prompts directly (already includes translated prompts)
  const allPrompts = serverPrompts;
  promptsRef.current = allPrompts;

  // Get prompts for a specific batch index (sequential groups of 4)
  const getPromptBatch = useCallback((prompts: string[], index: number) => {
    if (prompts.length === 0) {
      return [];
    }
    if (prompts.length <= PROMPT_BATCH_SIZE) {
      return prompts.slice(0, PROMPT_BATCH_SIZE);
    }

    const totalBatches = Math.ceil(prompts.length / PROMPT_BATCH_SIZE);
    const normalizedIndex = index % totalBatches;
    const startIdx = normalizedIndex * PROMPT_BATCH_SIZE;
    const batch = prompts.slice(startIdx, startIdx + PROMPT_BATCH_SIZE);

    // If last batch is incomplete, fill with prompts from the beginning
    if (batch.length < PROMPT_BATCH_SIZE) {
      const remaining = PROMPT_BATCH_SIZE - batch.length;
      batch.push(...prompts.slice(0, remaining));
    }

    return batch;
  }, []);

  // Set textarea height
  const setTextareaHeight = (textarea: HTMLTextAreaElement) => {
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
  };

  // Initialize textarea height
  useEffect(() => {
    if (inputRef.current) {
      setTextareaHeight(inputRef.current);
    }
  }, []);

  // Update height when input changes
  useEffect(() => {
    if (inputRef.current) {
      setTextareaHeight(inputRef.current);
    }
  }, [input]);

  useEffect(() => {
    if (allPrompts.length === 0) {
      return;
    }

    // Reset batch index when prompts change
    setBatchIndex(0);
    const initialPrompts = getPromptBatch(allPrompts, 0);
    setVisiblePrompts(initialPrompts);

    const intervalId = window.setInterval(() => {
      setBatchIndex((prevIndex) => {
        const nextIndex = prevIndex + 1;
        // Use ref to get latest prompts in interval callback
        setVisiblePrompts(getPromptBatch(promptsRef.current, nextIndex));
        return nextIndex;
      });
    }, PROMPT_REFRESH_INTERVAL);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [serverPrompts, getPromptBatch]);

  const handleQuickPrompt = (prompt: string) => {
    setInput(prompt);
    if (onQuickPrompt) {
      onQuickPrompt(prompt);
      return;
    }

    if (showInlineInput) {
      setTimeout(() => {
        inputRef.current?.form?.requestSubmit();
      }, 100);
    }
  };

  return (
    <div className="relative flex h-full flex-col" data-chat-welcome="true">
      <div className="mb-3 flex flex-1 flex-col items-center justify-center space-y-4 text-gray-500">
        <div className="mb-1 w-full max-w-xl px-4">
          {selectedAgent ? (
            <>
              <p className="text-left text-xl font-bold md:text-2xl">
                {t('chatWith')}{' '}
                <span className="text-[#f0b90b]">{selectedAgent.name}</span>
              </p>
              <p className="text-left text-sm md:text-base">
                {t('agentReady')}
              </p>
              <button
                onClick={onClearAgent}
                className="mt-2 text-xs text-gray-400 underline hover:text-gray-600"
              >
                {t('switchToBnbot')}
              </button>
            </>
          ) : (
            <>
              <p className="text-left text-xl font-bold md:text-2xl min-h-[2rem] md:min-h-[2.5rem]">
                <TypewriterText
                  text={t('greeting')}
                  speed={30}
                  className="text-gray-800"
                  onComplete={() => setTypewriterStep(1)}
                />
                {typewriterStep >= 1 && (
                  <>
                    <span className="mx-1">👋</span>
                    <TypewriterText
                      text={locale === 'zh' ? '我是 ' : "I'm "}
                      speed={30}
                      className="text-gray-800"
                      onComplete={() => setTypewriterStep(2)}
                    />
                  </>
                )}
                {typewriterStep >= 2 && (
                  <span className="bg-gradient-to-r from-[#f7cd46] to-[#f0b90b] bg-clip-text text-transparent">
                    <TypewriterText
                      text="BNBot"
                      speed={30}
                      onComplete={() => setTypewriterStep(3)}
                    />
                  </span>
                )}
              </p>
              <p className="text-left text-sm md:text-base min-h-[1.25rem] md:min-h-[1.5rem]">
                {typewriterStep >= 3 ? (
                  <>
                    <TypewriterText
                      text={t('aiAgentPrefix')}
                      speed={30}
                      className="text-gray-800"
                      onComplete={() => setTypewriterStep(4)}
                    />
                    {typewriterStep >= 4 && (
                      <span className="bg-gradient-to-r from-[#f7cd46] to-[#f0b90b] bg-clip-text text-transparent">
                        <TypewriterText
                          text={t('aiAgentChain')}
                          speed={30}
                          onComplete={() => setTypewriterStep(5)}
                        />
                      </span>
                    )}
                    {typewriterStep >= 5 && t('aiAgentSuffix') && (
                      <TypewriterText
                        text={t('aiAgentSuffix')}
                        speed={30}
                        className="text-gray-800"
                      />
                    )}
                  </>
                ) : (
                  <span className="invisible">placeholder</span>
                )}
              </p>
            </>
          )}
        </div>

        {/* Input section */}
        {showInlineInput && (
          <div className="w-full px-4">
            <form onSubmit={onSubmit} className="w-full">
              <div className="relative flex items-end">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder={
                    selectedAgent
                      ? t('placeholderAgent', { agentName: selectedAgent.name })
                      : t('placeholder')
                  }
                  rows={1}
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
                  type={isLoading ? 'button' : 'submit'}
                  onClick={isLoading ? onInterrupt : undefined}
                  disabled={!isLoading && !input.trim()}
                  className={`absolute bottom-2 right-2 rounded-full p-1.5 font-bold transition-colors duration-200 ${
                    isLoading
                      ? 'bg-red-500 text-white hover:bg-red-600'
                      : 'bg-black text-[#f0b90b] hover:bg-gray-800 disabled:bg-gray-300 disabled:text-white disabled:hover:bg-gray-300'
                  }`}
                  title={isLoading ? t('stopGeneration') : t('sendMessage')}
                >
                  {isLoading ? (
                    <StopIcon className="h-5 w-5" />
                  ) : (
                    <ArrowUpIcon className="h-5 w-5" />
                  )}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Quick prompts */}
        <div className="flex w-full max-w-xl justify-center px-4">
          <div className="w-full">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-gray-400">
                {t('tryAsking')}
              </span>
            </div>
            <div className="flex w-full flex-col items-start gap-2 min-h-[296px]">
              {visiblePrompts.length > 0
                ? visiblePrompts.map((prompt, index) => (
                    <button
                      key={index}
                      type="button"
                      onClick={() => handleQuickPrompt(prompt)}
                      className="inline-flex w-auto min-h-[56px] items-center rounded-xl border border-gray-100 bg-white pl-4 pr-6 py-3 text-left transition-all duration-200 hover:bg-gray-50 hover:shadow-sm"
                      aria-label={`Ask: ${prompt}`}
                    >
                      <AnimatePresence mode="wait" initial={false}>
                        <motion.span
                          key={prompt}
                          className="text-sm font-normal text-gray-700"
                          variants={promptTextVariants}
                          initial="initial"
                          animate="animate"
                          exit="exit"
                          transition={{ duration: 0.25, ease: 'easeOut' }}
                        >
                          {prompt}
                        </motion.span>
                      </AnimatePresence>
                    </button>
                  ))
                : Array.from({ length: 4 }).map((_, index) => (
                    <div
                      key={index}
                      className="inline-flex w-fit h-[56px] items-center rounded-xl border border-gray-100 bg-white px-4 py-3"
                    >
                      <div className="h-4 w-48 animate-pulse rounded bg-gray-100" />
                    </div>
                  ))}
            </div>
          </div>
        </div>
      </div>

      {/* Disclaimer - optional */}
      {showDisclaimer && (
        <div className="absolute bottom-1 left-0 right-0 px-4 text-center">
          <p className="text-xs text-gray-400">
            {t('disclaimer')}
          </p>
        </div>
      )}
    </div>
  );
};

export default WelcomeScreen;
