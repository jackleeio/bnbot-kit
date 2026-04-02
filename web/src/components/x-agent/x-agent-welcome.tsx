'use client';

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { ArrowUpIcon, StopIcon } from '@heroicons/react/24/solid';
import { ChatBubbleOvalLeftIcon } from '@heroicons/react/24/outline';
import { AnimatePresence, motion } from 'framer-motion';

interface XAgentWelcomeProps {
  input: string;
  setInput: (value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onInterrupt: () => void;
  isLoading: boolean;
  hasMessages?: boolean;
  onNewChat?: () => void;
}

interface Topic {
  chinese: string;
  english: string;
}

type KolType = 'crypto' | 'ai';

const PROMPT_BATCH_SIZE = 4;
const PROMPT_REFRESH_INTERVAL = 5000;

const promptTextVariants = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
};

const XAgentWelcome: React.FC<XAgentWelcomeProps> = ({
  input,
  setInput,
  onSubmit,
  onKeyDown,
  onInterrupt,
  isLoading,
  hasMessages = false,
  onNewChat,
}) => {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const topicsRef = useRef<Topic[]>([]);
  const [isMultiline, setIsMultiline] = useState(false);
  const [kolType, setKolType] = useState<KolType>('crypto');
  const [topics, setTopics] = useState<Topic[]>([]);
  const [visibleTopics, setVisibleTopics] = useState<Topic[]>([]);
  const [batchIndex, setBatchIndex] = useState(0);
  const [isLoadingTopics, setIsLoadingTopics] = useState(false);
  const t = useTranslations('chatWelcome');
  const locale = useLocale();

  // Fetch topics from API
  const fetchTopics = useCallback(async (type: KolType) => {
    setIsLoadingTopics(true);
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_REST_API_ENDPOINT}/api/v1/ai/compose-topics?kol_type=${type}&topic_count=15`
      );
      const data = await response.json();
      if (data.success && data.topics) {
        setTopics(data.topics);
      }
    } catch (error) {
      console.error('Failed to fetch topics:', error);
    } finally {
      setIsLoadingTopics(false);
    }
  }, []);

  // Get topics for a specific batch index (sequential groups of 4)
  const getTopicBatch = useCallback((allTopics: Topic[], index: number) => {
    if (allTopics.length === 0) {
      return [];
    }
    if (allTopics.length <= PROMPT_BATCH_SIZE) {
      return allTopics.slice(0, PROMPT_BATCH_SIZE);
    }

    const totalBatches = Math.ceil(allTopics.length / PROMPT_BATCH_SIZE);
    const normalizedIndex = index % totalBatches;
    const startIdx = normalizedIndex * PROMPT_BATCH_SIZE;
    const batch = allTopics.slice(startIdx, startIdx + PROMPT_BATCH_SIZE);

    // If last batch is incomplete, fill with topics from the beginning
    if (batch.length < PROMPT_BATCH_SIZE) {
      const remaining = PROMPT_BATCH_SIZE - batch.length;
      batch.push(...allTopics.slice(0, remaining));
    }

    return batch;
  }, []);

  // Fetch topics on mount and when kolType changes
  useEffect(() => {
    fetchTopics(kolType);
  }, [kolType, fetchTopics]);

  // Update topicsRef and set initial visible topics when topics change
  useEffect(() => {
    topicsRef.current = topics;
    if (topics.length > 0) {
      setBatchIndex(0);
      setVisibleTopics(getTopicBatch(topics, 0));
    }
  }, [topics, getTopicBatch]);

  // Set up rotation interval
  useEffect(() => {
    if (topics.length <= PROMPT_BATCH_SIZE) {
      return;
    }

    const intervalId = window.setInterval(() => {
      setBatchIndex((prevIndex) => {
        const nextIndex = prevIndex + 1;
        setVisibleTopics(getTopicBatch(topicsRef.current, nextIndex));
        return nextIndex;
      });
    }, PROMPT_REFRESH_INTERVAL);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [topics.length, getTopicBatch]);

  const handleToggleKolType = () => {
    setKolType((prev) => (prev === 'crypto' ? 'ai' : 'crypto'));
  };

  // Set textarea height
  const SINGLE_LINE_HEIGHT = 45;
  const setTextareaHeight = (textarea: HTMLTextAreaElement) => {
    textarea.style.height = 'auto';
    const newHeight = Math.min(textarea.scrollHeight, 200);
    textarea.style.height = `${newHeight}px`;
    setIsMultiline(newHeight > SINGLE_LINE_HEIGHT);
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

  // Glitch effect state
  const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$%&*';
  const WORDS = ['X Agent', 'Your X Copilot'];
  const getRandomChar = () => CHARS[Math.floor(Math.random() * CHARS.length)];

  const [displayText, setDisplayText] = useState(WORDS[0]);
  const wordIndexRef = useRef(0);
  const activeIntervalsRef = useRef<NodeJS.Timeout[]>([]);

  useEffect(() => {
    // Clear all active intervals before starting new ones
    const clearActiveIntervals = () => {
      activeIntervalsRef.current.forEach(id => clearInterval(id));
      activeIntervalsRef.current = [];
    };

    const runTransition = () => {
      // Clear any existing intervals before starting new transition
      clearActiveIntervals();

      const currentIndex = wordIndexRef.current;
      const nextIndex = (currentIndex + 1) % WORDS.length;
      const currentWord = WORDS[currentIndex];
      const nextWord = WORDS[nextIndex];

      // Phase 1: Scramble current word (from center outward)
      let phase1Iteration = 0;
      const centerIndex = Math.floor(currentWord.length / 2);
      const phase1Max = Math.ceil(currentWord.length / 2) + 1;

      const phase1Interval = setInterval(() => {
        setDisplayText(
          currentWord
            .split('')
            .map((char, index) => {
              if (char === ' ') return ' ';
              const distanceFromCenter = Math.abs(index - centerIndex);
              if (distanceFromCenter >= phase1Iteration) return char;
              return getRandomChar();
            })
            .join('')
        );

        phase1Iteration++;

        if (phase1Iteration > phase1Max) {
          clearInterval(phase1Interval);
          activeIntervalsRef.current = activeIntervalsRef.current.filter(id => id !== phase1Interval);

          // Phase 2: Pure scramble with length transition
          let phase2Iteration = 0;
          const phase2Max = 25;

          const phase2Interval = setInterval(() => {
            const targetLen = Math.round(
              currentWord.length + (nextWord.length - currentWord.length) * (phase2Iteration / phase2Max)
            );

            setDisplayText(
              Array.from({ length: targetLen }, (_, i) =>
                nextWord[i] === ' ' ? ' ' : getRandomChar()
              ).join('')
            );

            phase2Iteration++;

            if (phase2Iteration > phase2Max) {
              clearInterval(phase2Interval);
              activeIntervalsRef.current = activeIntervalsRef.current.filter(id => id !== phase2Interval);

              // Phase 3: Reveal next word (from center outward)
              let phase3Iteration = 0;
              const nextCenterIndex = Math.floor(nextWord.length / 2);
              const phase3Max = Math.ceil(nextWord.length / 2) + 1;

              const phase3Interval = setInterval(() => {
                setDisplayText(
                  nextWord
                    .split('')
                    .map((char, index) => {
                      if (char === ' ') return ' ';
                      const distanceFromCenter = Math.abs(index - nextCenterIndex);
                      if (distanceFromCenter < phase3Iteration) return char;
                      return getRandomChar();
                    })
                    .join('')
                );

                phase3Iteration++;

                if (phase3Iteration > phase3Max) {
                  clearInterval(phase3Interval);
                  activeIntervalsRef.current = activeIntervalsRef.current.filter(id => id !== phase3Interval);
                  setDisplayText(nextWord);
                  wordIndexRef.current = nextIndex;
                }
              }, 35);
              activeIntervalsRef.current.push(phase3Interval);
            }
          }, 30);
          activeIntervalsRef.current.push(phase2Interval);
        }
      }, 35);
      activeIntervalsRef.current.push(phase1Interval);
    };

    const initialTimer = setTimeout(runTransition, 2000);
    const cycleTimer = setInterval(runTransition, 4000);

    return () => {
      clearTimeout(initialTimer);
      clearInterval(cycleTimer);
      clearActiveIntervals();
    };
  }, []);

  const handleQuickPrompt = (prompt: string) => {
    setInput(prompt);
    setTimeout(() => {
      inputRef.current?.form?.requestSubmit();
    }, 100);
  };

  return (
    <div className="relative flex h-full flex-col">
      {/* Centered Content: Logo, Title, Suggestions */}
      <div className="flex flex-1 flex-col items-center justify-center space-y-8 overflow-y-auto pb-32">
        {/* Header */}
        <div className="flex flex-col items-center">
          <div className="text-center">
            <h1 className="text-2xl font-bold md:text-3xl min-h-[40px] flex items-center justify-center">
              <span className="text-black whitespace-pre">
                {displayText}
              </span>
            </h1>
            <p className="mt-2 text-sm text-gray-500 px-4">
              Create better content and summarize your X feed
            </p>
          </div>
        </div>

        {/* Suggestions Grid */}
        <div className="w-full max-w-2xl px-4">
          <div className="mb-2 flex items-center justify-between px-1">
            <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">
              {t('tryCreating')}
            </span>
            {/* AI/Crypto Toggle */}
            <div className="flex items-center gap-1.5">
              <span className={`text-[11px] font-medium transition-colors ${kolType === 'crypto' ? 'text-black' : 'text-gray-400'}`}>
                Crypto
              </span>
              <button
                onClick={handleToggleKolType}
                disabled={isLoadingTopics}
                className={`relative h-4 w-8 rounded-full transition-colors ${kolType === 'ai' ? 'bg-black' : 'bg-gray-300'
                  } ${isLoadingTopics ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 h-3 w-3 rounded-full bg-white shadow-sm transition-all duration-200 ${kolType === 'ai' ? 'translate-x-4' : 'translate-x-0'
                    }`}
                />
              </button>
              <span className={`text-[11px] font-medium transition-colors ${kolType === 'ai' ? 'text-black' : 'text-gray-400'}`}>
                AI
              </span>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {isLoadingTopics ? (
              // Loading skeleton
              Array.from({ length: 4 }).map((_, index) => (
                <div
                  key={index}
                  className="skeleton h-[80px] w-full rounded-xl"
                />
              ))
            ) : visibleTopics.length > 0 ? (
              visibleTopics.map((topic, index) => {
                const topicText = locale === 'zh' ? topic.chinese : topic.english;
                return (
                  <button
                    key={index}
                    type="button"
                    onClick={() => handleQuickPrompt(topicText)}
                    className="group flex h-auto min-h-[80px] w-full items-center rounded-xl border border-gray-200/80 bg-white p-4 text-left transition-all hover:border-gray-300 hover:bg-gray-50 hover:shadow-sm"
                  >
                    <AnimatePresence mode="wait" initial={false}>
                      <motion.span
                        key={topicText}
                        className="text-sm text-gray-700 line-clamp-2 group-hover:text-gray-900"
                        variants={promptTextVariants}
                        initial="initial"
                        animate="animate"
                        exit="exit"
                        transition={{ duration: 0.25, ease: 'easeOut' }}
                      >
                        {topicText}
                      </motion.span>
                    </AnimatePresence>
                  </button>
                );
              })
            ) : (
              // Empty state - show skeleton
              Array.from({ length: 4 }).map((_, index) => (
                <div
                  key={index}
                  className="skeleton h-[80px] w-full rounded-xl"
                />
              ))
            )}
          </div>
        </div>
      </div>

      {/* Bottom Section: Input and Disclaimer */}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-white via-white to-transparent pt-20 pb-2">
        <div className="mx-auto w-full max-w-3xl px-3">
          {/* Input Form */}
          <form
            onSubmit={onSubmit}
            className="relative flex min-h-[45px] w-full items-center rounded-[28px] border border-gray-200/90 bg-white shadow-sm transition-shadow hover:border-gray-300"
          >
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="What would you like to tweet about?"
              rows={1}
              className={`scrollbar-none max-h-[150px] min-h-[45px] w-full resize-none rounded-[28px] border-0 bg-transparent py-3 px-5 text-base leading-[1.5] text-gray-900 placeholder-gray-500 focus:ring-0 ${hasMessages ? 'pr-24' : 'pr-14'
                }`}
              onInput={(e) => {
                const target = e.target as HTMLTextAreaElement;
                setTextareaHeight(target);
              }}
            />
            {/* Buttons container */}
            <div className="absolute right-2 bottom-1 flex flex-col items-center gap-2">
              {/* New Chat Button */}
              {hasMessages && onNewChat && (
                <button
                  type="button"
                  onClick={onNewChat}
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-900"
                  title="Start new chat"
                >
                  <ChatBubbleOvalLeftIcon className="h-5 w-5" />
                </button>
              )}
              <button
                type={isLoading ? 'button' : 'submit'}
                onClick={isLoading ? onInterrupt : undefined}
                disabled={!isLoading && !input.trim()}
                className={`flex h-9 w-9 items-center justify-center rounded-full transition-all duration-200 ${isLoading
                  ? 'bg-red-50 text-red-500 hover:bg-red-100'
                  : input.trim()
                    ? 'bg-black text-[#f0b90b] hover:bg-gray-800 shadow-sm'
                    : 'bg-gray-100 text-gray-400'
                  }`}
                title={isLoading ? 'Stop generation' : 'Send message'}
              >
                {isLoading ? (
                  <StopIcon className="h-4 w-4" />
                ) : (
                  <ArrowUpIcon className="h-5 w-5" />
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default XAgentWelcome;
