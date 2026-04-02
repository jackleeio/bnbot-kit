'use client';

import React, { useState, useRef, useEffect, useCallback, useLayoutEffect } from 'react';
import Image from 'next/image';
import dynamic from 'next/dynamic';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeftIcon, ChevronDownIcon, PlusIcon } from '@heroicons/react/24/outline';
import { useDrawer } from '@/components/drawer-views/context';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations, useLocale } from 'next-intl';
import LoginModal from '@/components/login/login-modal';
import { apiClient } from '@/lib/api-client';
import bnbotAI from '@/assets/images/logo/bnbot-ai.jpg';

// Import types
import { SelectedAgent, ViewMode, GeneratedTopic } from '@/types/chat';
import type { TweetInfoResponse } from '@/types';
import type { TrendTweet } from '@/components/chat/tweetDetail';
import type { Tweet } from '@/types/chat';

// Import components
import WelcomeScreen from '@/components/chat/WelcomeScreen';
import ChatMessage from '@/components/chat/ChatMessage';
import ChatInput from '@/components/chat/ChatInput';
import ReasoningSection from '@/components/chat/ReasoningSection';
import ToolCallBadges from '@/components/chat/ToolCallBadges';
import MessageContent, { convertTweetInfoResponseToTrendTweet } from '@/components/chat/MessageContent';
import TweetPreviewSidebar from '@/components/chat/tweet-preview-sidebar';

// Dynamic import TweetFeed to avoid SSR issues with ResizeObserver
const TweetFeed = dynamic(() => import('@/components/chat/TweetFeed'), {
  ssr: false,
  loading: () => <TweetFeedSkeleton />,
});

// Get initial viewMode synchronously - used by both skeleton and main component
const getViewModeFromStorage = (): 'default' | 'equal' => {
  if (typeof window === 'undefined') return 'default';
  const saved = localStorage.getItem('chatViewMode');
  return saved === 'equal' ? 'equal' : 'default';
};

// Skeleton component for TweetFeed loading state
function TweetFeedSkeleton() {
  return (
    <div className="chat-right-panel ml-0 w-full md:ml-[33.333333%] md:w-2/3">
      <div className="h-screen px-0 pb-0 pt-0 md:pb-2 md:pl-2 md:pr-2 md:pt-1.5">
        <div className="relative h-full rounded-lg border-0 md:border border-gray-100 bg-white p-0 md:p-2 md:py-2 shadow-none md:shadow-card">
          {/* Toolbar Skeleton */}
          <div className="absolute left-0 right-0 top-0 z-10 flex items-center justify-end md:justify-between rounded-b-xl rounded-t-lg border-l border-r border-t border-white/20 bg-white/40 px-3 py-2 backdrop-blur-xl">
            {/* Left side - desktop only */}
            <div className="hidden md:block">
              <div className="h-5 w-5 animate-pulse rounded bg-gray-200" />
            </div>
            {/* Right side */}
            <div className="flex items-center gap-2">
              {/* Refresh button skeleton - desktop only */}
              <div className="hidden md:block h-7 w-16 animate-pulse rounded-full bg-gray-100" />
              {/* View mode toggle skeleton - desktop only */}
              <div className="hidden md:block h-7 w-24 animate-pulse rounded-full bg-gray-100" />
              {/* AI Monitoring skeleton */}
              <div className="flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1.5">
                <span className="relative flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center">
                  <span className="absolute h-3.5 w-3.5 rounded-full bg-[#f0b90b]/20" />
                  <span className="relative block h-1.5 w-1.5 rounded-full bg-[#f0b90b] animate-pulse" />
                </span>
                <span className="h-3 w-16 animate-pulse rounded bg-gray-100" />
              </div>
            </div>
          </div>
          <div className="h-full overflow-hidden pt-12">
            <div className="chat-skeleton-grid grid grid-cols-1 gap-3 px-2 pt-2 md:gap-4 md:px-0 md:pt-0 md:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 9 }).map((_, index) => (
                <div
                  key={index}
                  className="flex flex-col overflow-hidden rounded-2xl border border-gray-100 bg-white p-4"
                >
                  {/* Header: Avatar and Name */}
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      <div className="h-9 w-9 animate-pulse rounded-full bg-gray-200" />
                      <div className="flex flex-col gap-1">
                        <div className="h-4 w-24 animate-pulse rounded bg-gray-200" />
                        <div className="h-3 w-16 animate-pulse rounded bg-gray-200" />
                      </div>
                    </div>
                    <div className="h-3 w-12 animate-pulse rounded bg-gray-200" />
                  </div>
                  {/* Content */}
                  <div className="mt-3 space-y-2">
                    <div className="h-4 w-full animate-pulse rounded bg-gray-200" />
                    <div className="h-4 w-5/6 animate-pulse rounded bg-gray-200" />
                    <div className="h-4 w-4/6 animate-pulse rounded bg-gray-200" />
                  </div>
                  {/* Footer */}
                  <div className="mt-4 flex items-center justify-between px-2">
                    <div className="h-4 w-8 animate-pulse rounded bg-gray-200" />
                    <div className="h-4 w-8 animate-pulse rounded bg-gray-200" />
                    <div className="h-4 w-8 animate-pulse rounded bg-gray-200" />
                    <div className="h-4 w-8 animate-pulse rounded bg-gray-200" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Import hooks
import { useChat } from '@/hooks/useChat';
import { useTweetFeed } from '@/hooks/useTweetFeed';
import { useScrollBehavior } from '@/hooks/useScrollBehavior';

// Custom scrollbar styles
const customScrollbarStyles = `
  .custom-scrollbar {
    scrollbar-width: thin;
    scrollbar-color: #f0b90b #f3f4f6;
  }
  
  .custom-scrollbar::-webkit-scrollbar {
    width: 6px;
  }
  
  .custom-scrollbar::-webkit-scrollbar-track {
    background: #f3f4f6;
    border-radius: 3px;
  }
  
  .custom-scrollbar::-webkit-scrollbar-thumb {
    background: linear-gradient(to bottom, #f0b90b, #e6a800);
    border-radius: 3px;
  }
  
  .custom-scrollbar::-webkit-scrollbar-thumb:hover {
    background: linear-gradient(to bottom, #e6a800, #cc9600);
  }

  .highlight-tweet {
    animation: highlight 2s ease-in-out;
  }

  @keyframes highlight {
    0%, 100% {
      background-color: transparent;
    }
    50% {
      background-color: rgba(59, 130, 246, 0.1);
    }
  }

  .blink {
    animation: blink-animation 1s steps(5, start) infinite;
  }

  @keyframes blink-animation {
    to {
      visibility: hidden;
    }
  }
`;

interface SelectionMenuState {
  text: string;
  position: {
    top: number;
    left: number;
  };
  renderAbove: boolean;
}

const SERVER_PROMPTS = [
  'What narratives are driving crypto markets right now?',
  'Which new tokens launched on BNB Chain this week?',
  'Give me a quick analysis of today’s top gaining tokens.',
  'What is the current sentiment across major crypto communities?',
  'Show the most active DeFi protocols and their TVL changes.',
  'Which tokens have unusual on-chain activity today?',
  'What are the key catalysts for BTC and ETH over the next few days?',
  'Summarize the hottest airdrop opportunities for this week.',
];

const DEFAULT_INPUT_HEIGHT = 120;

const getInitialChatOpen = () => {
  if (typeof window === 'undefined') return true;
  const savedChatOpen = sessionStorage.getItem('bnbot:isChatOpen');
  if (savedChatOpen !== null) {
    return savedChatOpen === 'true';
  }
  const isMobileViewport = window.innerWidth < 768;
  // 默认移动端收起，桌面端展开
  return !isMobileViewport;
};


export default function ChatPage() {
  // Custom scrollbar styles injection
  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = customScrollbarStyles;
    document.head.appendChild(style);

    return () => {
      document.head.removeChild(style);
    };
  }, []);

  // State management - use consistent initial values for SSR/CSR to avoid hydration mismatch
  const [input, setInput] = useState('');
  const [isChatOpen, setIsChatOpen] = useState<boolean>(getInitialChatOpen);
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<SelectedAgent | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>(getViewModeFromStorage);
  const [showReasoning, setShowReasoning] = useState<{ [key: string]: boolean }>({});
  const [isMobile, setIsMobile] = useState(false);
  const [inputHeight, setInputHeight] = useState(DEFAULT_INPUT_HEIGHT);
  const [selectionMenu, setSelectionMenu] = useState<SelectionMenuState | null>(null);
  const [selectedTweetPreview, setSelectedTweetPreview] = useState<TrendTweet | null>(null);
  const [tweetPreviewLoadingKey, setTweetPreviewLoadingKey] = useState<string | null>(null);
  const [tweetPreviewError, setTweetPreviewError] = useState<string | null>(null);
  const tweetPreviewRequestRef = useRef<string | null>(null);
  const [quotedText, setQuotedText] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const chatSwipeStartXRef = useRef<number | null>(null);
  const chatSwipeStartYRef = useRef<number | null>(null);
  const chatSwipeHandledRef = useRef(false);

  // Input refs
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const tweetFeedScrollRef = useRef<HTMLDivElement>(null);
  const isRestoringTweetScroll = useRef(false);
  const pendingLoadMoreRef = useRef(false);
  const selectionMenuRef = useRef<HTMLDivElement>(null);
  const isSelectingRef = useRef(false);
  const lastSelectionTextRef = useRef<string>('');

  // Router and search params
  const router = useRouter();
  const { openDrawer } = useDrawer();
  const searchParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;

  // Translations
  const t = useTranslations();
  const locale = useLocale();
  const staticChatPrompts = t.raw('chatPrompts') as string[];
  const [dynamicPrompts, setDynamicPrompts] = useState<string[]>([]);

  const { tweets, hasMore, isLoadingMore, refreshTweets, loadMoreTweets, feedType, setFeedType } = useTweetFeed();

  // Fetch dynamic trend topics from API
  useEffect(() => {
    setDynamicPrompts([]);
    const fetchTrendTopics = async () => {
      try {
        const endpoint = process.env.NEXT_PUBLIC_REST_API_ENDPOINT;
        if (!endpoint) return;

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'x-api-key': process.env.NEXT_PUBLIC_X_API_KEY || '',
        };

        const response = await fetch(`${endpoint}/api/v1/ai/trend-topics?kol_type=${feedType}`, {
          method: 'GET',
          headers,
          credentials: 'include',
        });

        if (response.ok) {
          const data = await response.json();
          if (data?.success && Array.isArray(data?.topics)) {
            // Extract topic strings based on locale
            const isZh = locale === 'zh';
            const topicStrings = data.topics
              .map((item: { chinese?: string; english?: string }) => {
                return isZh ? item?.chinese : item?.english;
              })
              .filter((s: string | undefined): s is string => Boolean(s?.trim()));

            if (topicStrings.length > 0) {
              setDynamicPrompts(topicStrings);
            }
          }
        }
      } catch (error) {
        console.error('Failed to fetch trend topics:', error);
      }
    };

    fetchTrendTopics();
  }, [locale, feedType]);

  // Combine dynamic prompts (prioritized) with static prompts
  // Dynamic prompts come first so they are shown more frequently in rotation
  const chatPrompts = React.useMemo(() => {
    if (dynamicPrompts.length === 0) {
      return staticChatPrompts;
    }
    // Dynamic prompts first, then static prompts (remove duplicates)
    return [...dynamicPrompts, ...staticChatPrompts.filter(p => !dynamicPrompts.includes(p))];
  }, [dynamicPrompts, staticChatPrompts]);

  // Custom hooks
  const {
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
  } = useChat({
    webSearchEnabled,
    // Keep control with the user: show inline login-required message and let them click to open the modal.
    onShowLoginPrompt: () => {},


  });

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      refreshTweets();
    }, 30 * 60 * 1000);

    return () => window.clearInterval(intervalId);
  }, [refreshTweets]);

  const {
    userHasScrolled,
    isToolbarVisible,
    setIsToolbarVisible,
    isMobileChatHeaderVisible,
    messagesEndRef,
    reasoningRef,
    scrollToBottom,
    handleChatScroll,
    handleRightPanelScroll,
    setUserHasScrolled,
  } = useScrollBehavior({
    messages,
    currentAssistantMessage,
    currentReasoningContent,
  });

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

  const handleTopicSelect = useCallback(
    (messageId: string | undefined, topic: GeneratedTopic) => {
      if (!topic) return;

      const prompt =
        topic.question?.trim() ||
        topic.title?.trim() ||
        topic.hook?.trim() ||
        topic.angle?.trim();

      if (prompt) {
        if (messageId) {
          dismissTopicsForMessage(messageId);
        }
        void sendMessage(prompt);
      }
    },
    [dismissTopicsForMessage, sendMessage],
  );

  const fetchTweetsByIds = useCallback(
    async (tweetIds: string[]): Promise<TrendTweet[]> => {
      const uniqueIds = Array.from(
        new Set(
          tweetIds
            .map((id) =>
              typeof id === 'string' || typeof id === 'number' ? String(id).trim() : '',
            )
            .filter(Boolean),
        ),
      );

      if (uniqueIds.length === 0) {
        return [];
      }

      const baseUrl = process.env.NEXT_PUBLIC_REST_API_ENDPOINT;
      if (!baseUrl) {
        console.warn('NEXT_PUBLIC_REST_API_ENDPOINT is not configured');
        return [];
      }

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'x-public-key': process.env.NEXT_PUBLIC_X_PUBLIC_API_KEY || '',
      };

      try {
        const response = await fetch(
          `${baseUrl}/api/v1/x-public/cached-tweet-info?tweet_ids=${encodeURIComponent(uniqueIds.join(','))}`,
          {
            method: 'GET',
            headers,
            credentials: 'include',
          },
        );

        if (!response.ok) {
          console.error(
            'Failed to fetch tweet info',
            response.status,
            response.statusText,
          );
          return [];
        }

        const result = await response.json();
        const dataArray: TweetInfoResponse[] = Array.isArray(result?.data)
          ? result.data
          : result?.data
            ? [result.data]
            : [];

        return dataArray
          .map((item) => convertTweetInfoResponseToTrendTweet(item))
          .filter((item): item is TrendTweet => Boolean(item));
      } catch (error) {
        console.error('Error fetching tweets', error);
        return [];
      }
    },
    [],
  );

  // Helper function to extract tweets from tool output cache
  const getTweetsFromToolOutput = useCallback((tweetIds: string[]): Tweet[] | null => {
    // Search through all messages for tool outputs containing tweet data
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i];
      if (!message.toolCallsInfo || message.toolCallsInfo.length === 0) continue;

      for (const toolInfo of message.toolCallsInfo) {
        // Only look at successful search_on_x tool calls with output
        if (toolInfo.name !== 'search_on_x' || toolInfo.status !== 'success' || !toolInfo.output) {
          continue;
        }

        try {
          const parsed = JSON.parse(toolInfo.output);
          if (parsed.code === 1 && Array.isArray(parsed.data)) {
            // Check if this output contains the tweets we're looking for
            const matchedTweets: Tweet[] = [];
            for (const tweetId of tweetIds) {
              const tweet = parsed.data.find((t: any) => t.id_str === tweetId);
              if (tweet) {
                // Convert to Tweet format if needed
                const formattedTweet: Tweet = {
                  id_str: tweet.id_str,
                  created_at: tweet.created_at,
                  text: tweet.text,
                  reply_count: tweet.reply_count || 0,
                  retweet_count: tweet.retweet_count || 0,
                  like_count: tweet.like_count || 0,
                  quote_count: tweet.quote_count || 0,
                  view_count: String(tweet.view_count || 0),
                  is_retweet: tweet.is_retweet || false,
                  retweeted_status_id: tweet.retweeted_status_id || null,
                  is_quote: tweet.is_quote || false,
                  quoted_status_id: tweet.quoted_status_id || null,
                  user: tweet.user || {
                    username: tweet.user?.username || '',
                    twitter_id: tweet.user?.rest_id || tweet.user?.twitter_id || '',
                    name: tweet.user?.name || '',
                    avatar: tweet.user?.avatar || '',
                    description: tweet.user?.description || '',
                  },
                  media: tweet.media || null,
                  quoted_tweet: tweet.quoted_tweet || null,
                  retweeted_tweet: tweet.retweeted_tweet || null,
                };
                matchedTweets.push(formattedTweet);
              }
            }
            // If we found all requested tweets, return them
            if (matchedTweets.length === tweetIds.length) {
              return matchedTweets;
            }
          }
        } catch (error) {
          console.warn('Failed to parse tool output:', error);
        }
      }
    }
    return null;
  }, [messages]);

  const handleTweetReferenceSelect = useCallback(
    async (tweetIds: string[]) => {
      const uniqueIds = Array.from(
        new Set(
          tweetIds
            .map((id) => (typeof id === 'string' ? id.trim() : ''))
            .filter(Boolean),
        ),
      );

      if (uniqueIds.length === 0) {
        return;
      }

      const requestKey = uniqueIds.join(',');
      tweetPreviewRequestRef.current = requestKey;
      setTweetPreviewLoadingKey(requestKey);
      setTweetPreviewError(null);
      setSelectedTweetPreview(null);

      try {
        // First, try to get tweets from tool output cache
        const cachedTweets = getTweetsFromToolOutput(uniqueIds);

        let tweets: TrendTweet[];
        if (cachedTweets && cachedTweets.length > 0) {
          // Use cached data - convert Tweet to TrendTweet format
          tweets = cachedTweets.map(tweet => ({
            ...tweet,
            author: {
              username: tweet.user.username,
              twitter_id: tweet.user.twitter_id,
              name: tweet.user.name,
              avatar: tweet.user.avatar,
              description: tweet.user.description,
            },
          }));
        } else {
          // Fallback to API request
          tweets = await fetchTweetsByIds(uniqueIds);
        }

        if (tweetPreviewRequestRef.current !== requestKey) {
          return;
        }
        if (tweets.length === 0) {
          setTweetPreviewError('未找到推文');
          return;
        }

        const payload: TrendTweet =
          tweets.length === 1
            ? tweets[0]
            : {
                ...tweets[0],
                groupTweets: tweets,
              };
        setSelectedTweetPreview(payload);
      } catch (error) {
        if (tweetPreviewRequestRef.current === requestKey) {
          console.error('Failed to load tweet references', error);
          setTweetPreviewError('加载推文失败');
        }
      } finally {
        if (tweetPreviewRequestRef.current === requestKey) {
          tweetPreviewRequestRef.current = null;
          setTweetPreviewLoadingKey(null);
        }
      }
    },
    [fetchTweetsByIds, getTweetsFromToolOutput],
  );

  const isTweetReferenceLoading = useCallback(
    (idsKey: string) => {
      if (!idsKey) return false;
      return tweetPreviewLoadingKey === idsKey;
    },
    [tweetPreviewLoadingKey],
  );

  const handleClearSelectedTweet = useCallback(() => {
    tweetPreviewRequestRef.current = null;
    setSelectedTweetPreview(null);
    setTweetPreviewError(null);
    setTweetPreviewLoadingKey(null);
  }, []);

  const handleTweetClick = useCallback((tweet: Tweet) => {
    // Convert Tweet to TrendTweet structure if needed
    // TweetCard passes an object that already has author if we look at its implementation,
    // but strictly speaking Tweet type has user. We ensure author exists.
    const trendTweet: TrendTweet = {
      ...tweet,
      author: (tweet as any).author || {
        username: tweet.user.username,
        twitter_id: tweet.user.twitter_id,
        name: tweet.user.name,
        avatar: tweet.user.avatar,
        description: tweet.user.description,
      },
    };
    setSelectedTweetPreview(trendTweet);
  }, []);

  const handleChatToggle = useCallback(() => {
    setIsChatOpen((prev) => {
      const next = !prev;
      if (typeof window !== 'undefined') {
        sessionStorage.setItem('bnbot:isChatOpen', String(next));
      }
      return next;
    });
    if (
      selectedTweetPreview ||
      tweetPreviewLoadingKey ||
      tweetPreviewError
    ) {
      handleClearSelectedTweet();
    }
  }, [
    handleClearSelectedTweet,
    selectedTweetPreview,
    tweetPreviewLoadingKey,
    tweetPreviewError,
  ]);

  // Get current input ref
  const getCurrentInputRef = () => {
    return chatInputRef;
  };

  // Set textarea height
  const setTextareaHeight = (textarea: HTMLTextAreaElement) => {
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
  };

  const hideSelectionMenu = useCallback(
    (options?: { force?: boolean }) => {
      setSelectionMenu((previous) => {
        if (!options?.force && isSelectingRef.current) {
          return previous;
        }
        if (previous === null) {
          return previous;
        }
        return null;
      });
    },
    [],
  );

  const updateSelectionMenu = useCallback(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) {
      hideSelectionMenu();
      return;
    }

    const selectedText = selection.toString().trim();
    if (!selectedText) {
      hideSelectionMenu();
      return;
    }

    if (!chatContainerRef.current) {
      hideSelectionMenu();
      return;
    }

    const range = selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
    if (!range) {
      hideSelectionMenu();
      return;
    }

    const container = chatContainerRef.current;
    const commonAncestor = range.commonAncestorContainer;
    const ancestorElement =
      commonAncestor instanceof Element
        ? commonAncestor
        : commonAncestor?.parentElement;

    if (!ancestorElement || !container.contains(ancestorElement)) {
      hideSelectionMenu();
      return;
    }

    // 不在欢迎屏幕或用户消息时才展示菜单，避免初始提示/用户消息被选中触发
    if (
      ancestorElement.closest('[data-chat-welcome="true"]') ||
      ancestorElement.closest('[data-user-message="true"]')
    ) {
      hideSelectionMenu();
      return;
    }

    const rawRect = range.getBoundingClientRect();
    const clientRects =
      typeof range.getClientRects === 'function'
        ? Array.from(range.getClientRects()).filter(
            (rect) => rect.width > 0 || rect.height > 0,
          )
        : [];
    const primaryRect =
      rawRect && (rawRect.width > 0 || rawRect.height > 0)
        ? rawRect
        : clientRects.length > 0
          ? clientRects[0]
          : null;

    if (!primaryRect) {
      hideSelectionMenu();
      return;
    }

    const offset = 12;
    // Default to rendering below the text for mobile friendliness
    let renderAbove = false;
    let top = primaryRect.bottom + offset;

    // If it goes off the bottom of the screen, try above
    if (top > window.innerHeight - 60) {
      top = primaryRect.top - offset;
      renderAbove = true;
    }

    const left = Math.min(
      window.innerWidth - 16,
      Math.max(16, primaryRect.left + primaryRect.width / 2),
    );

    lastSelectionTextRef.current = selectedText;

    setSelectionMenu({
      text: selectedText,
      position: {
        top,
        left,
      },
      renderAbove,
    });
  }, [chatContainerRef, hideSelectionMenu]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const handleDocumentMouseDown = (event: MouseEvent) => {
      const target = event.target as Node;
      const menuElement = selectionMenuRef.current;
      if (menuElement && menuElement.contains(target)) {
        return;
      }

      const chatElement = chatContainerRef.current;
      const isInsideChat = chatElement ? chatElement.contains(target) : false;

      if (isInsideChat) {
        isSelectingRef.current = true;
        hideSelectionMenu({ force: true });
      } else {
        isSelectingRef.current = false;
        hideSelectionMenu({ force: true });
      }
    };

    const handleDocumentMouseUp = (event: MouseEvent) => {
      const target = event.target as Node;
      const menuElement = selectionMenuRef.current;
      if (menuElement && menuElement.contains(target)) {
        isSelectingRef.current = false;
        return;
      }

      const wasSelecting = isSelectingRef.current;
      isSelectingRef.current = false;
      if (wasSelecting) {
        requestAnimationFrame(() => {
          updateSelectionMenu();
        });
      } else {
        updateSelectionMenu();
      }
    };

    const handleGlobalScroll = () => {
      hideSelectionMenu();
    };

    const handleSelectionChange = () => {
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') {
        return;
      }
      // Debounce slightly to avoid flickering during selection drag
      if (isSelectingRef.current) return;
      
      // On mobile, we want immediate feedback, but we also need to let the selection settle
      // requestAnimationFrame helps with this
      requestAnimationFrame(() => {
         updateSelectionMenu();
      });
    };

    document.addEventListener('mouseup', handleDocumentMouseUp);
    document.addEventListener('keyup', updateSelectionMenu);
    document.addEventListener('mousedown', handleDocumentMouseDown);
    document.addEventListener('selectionchange', handleSelectionChange);
    window.addEventListener('scroll', handleGlobalScroll, true);

    return () => {
      document.removeEventListener('mouseup', handleDocumentMouseUp);
      document.removeEventListener('keyup', updateSelectionMenu);
      document.removeEventListener('mousedown', handleDocumentMouseDown);
      document.removeEventListener('selectionchange', handleSelectionChange);
      window.removeEventListener('scroll', handleGlobalScroll, true);
    };
  }, [updateSelectionMenu, hideSelectionMenu]);

  // Initialize component
  useLayoutEffect(() => {
    // Sync viewMode from localStorage immediately to prevent layout flash
    const savedViewMode = localStorage.getItem('chatViewMode');
    if (savedViewMode === 'equal' || savedViewMode === 'default') {
      setViewMode(savedViewMode);
    }

    // Initialize isMobile based on window width
    setIsMobile(window.innerWidth < 768);

    // 优先使用上次状态；若无记录则默认开启
    const savedChatOpen = sessionStorage.getItem('bnbot:isChatOpen');
    if (savedChatOpen !== null) {
      setIsChatOpen(savedChatOpen === 'true');
    } else if (window.innerWidth < 768) {
      setIsChatOpen(false);
    } else {
      setIsChatOpen(true);
    }
    setHydrated(true);

    // Handle agent parameter from URL
    if (searchParams) {
      const agentId = searchParams.get('agent');
      const agentName = searchParams.get('name');
      if (agentId && agentName) {
        setSelectedAgent({ id: agentId, name: decodeURIComponent(agentName) });
        window.history.replaceState({}, '', window.location.pathname);
      }
    }

    // Setup viewport height for mobile
    const setVH = () => {
      const vh = window.innerHeight * 0.01;
      document.documentElement.style.setProperty('--vh', `${vh}px`);
    };

    const checkIfMobile = () => {
      const newIsMobile = window.innerWidth < 768;
      setIsMobile(newIsMobile);
      setVH();
      if (!newIsMobile) {
        setIsChatOpen(true);
      }
    };

    setVH();
    window.addEventListener('resize', checkIfMobile);
    window.addEventListener('orientationchange', setVH);

    return () => {
      window.removeEventListener('resize', checkIfMobile);
      window.removeEventListener('orientationchange', setVH);
    };
  }, []);

  // Sync data attributes with React state to keep CSS rules in sync
  useLayoutEffect(() => {
    if (typeof window === 'undefined') return;

    // Sync viewMode
    if (viewMode === 'equal') {
      document.documentElement.setAttribute('data-chat-view-mode', 'equal');
    } else {
      document.documentElement.removeAttribute('data-chat-view-mode');
    }

    // Sync chat open state (for both mobile and desktop)
    if (!isChatOpen) {
      document.documentElement.setAttribute('data-chat-closed', 'true');
    } else {
      document.documentElement.removeAttribute('data-chat-closed');
    }
  }, [viewMode, isChatOpen]);

  // Persist chat panel open/close state to keep view consistent when returning
  useEffect(() => {
    if (typeof window === 'undefined') return;
    sessionStorage.setItem('bnbot:isChatOpen', String(isChatOpen));
  }, [isChatOpen]);

  // Handle mobile input height tracking
  useEffect(() => {
    const updateInputHeight = () => {
      const currentInput = getCurrentInputRef().current;
      if (currentInput) {
        const inputContainer = currentInput.closest('[data-chat-input-container="true"]') as HTMLElement;
        if (inputContainer) {
          const containerRect = inputContainer.getBoundingClientRect();
          setInputHeight(Math.max(containerRect.height + 20, DEFAULT_INPUT_HEIGHT));
        } else {
          const inputRect = currentInput.getBoundingClientRect();
          if (inputRect.height > 0) {
            setInputHeight(Math.max(inputRect.height + 60, DEFAULT_INPUT_HEIGHT));
          }
        }
      }
    };

    const currentInput = getCurrentInputRef().current;
    if (currentInput) {
      updateInputHeight();
      currentInput.addEventListener('input', updateInputHeight);
      const resizeObserver = new ResizeObserver(updateInputHeight);
      resizeObserver.observe(currentInput);

      return () => {
        currentInput.removeEventListener('input', updateInputHeight);
        resizeObserver.disconnect();
      };
    }

    return undefined;
  }, [input, messages.length]);

  // Ensure new assistant messages start collapsed when generation finishes
  useEffect(() => {
    if (!isLoading && messages.length > 0) {
      const lastMsgIndex = messages.length - 1;
      const lastMsg = messages[lastMsgIndex];
      if (lastMsg.role === 'assistant') {
        const msgId = lastMsg.id ?? `msg-${lastMsgIndex}`;
        setShowReasoning((prev) => {
          if (prev[msgId]) {
            // If it's somehow true, set it to false
            return {
              ...prev,
              [msgId]: false,
            };
          }
          return prev;
        });
      }
    }
  }, [isLoading, messages]);

  const sendUserMessage = async (
    message: string,
    { clearInput = true, force = false }: { clearInput?: boolean; force?: boolean } = {},
  ) => {
    const trimmedMessage = message.trim();
    if (!trimmedMessage) {
      console.warn('[Chat] Ignoring empty user message');
      return;
    }

    if (isLoading && !force) {
      console.warn('[Chat] sendUserMessage blocked because chat is loading');
      return;
    }

    console.log('[Chat] sendUserMessage ->', { trimmedMessage, force, isLoading });

    if (clearInput) {
      setInput('');
    }

    setTimeout(() => {
      scrollToBottom(true);
    }, 100);
    setUserHasScrolled(false);

    if (!isMobile) {
      setTimeout(() => {
        getCurrentInputRef().current?.focus();
      }, 0);
    }

    const finalMessage = quotedText 
      ? `> ${quotedText}\n\n${trimmedMessage}`
      : trimmedMessage;

    if (quotedText) {
      setQuotedText(null);
    }

    await sendMessage(finalMessage);

    if (!isMobile) {
      setTimeout(() => {
        getCurrentInputRef().current?.focus();
      }, 0);
    }
  };

  // Handle form submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;
    await sendUserMessage(input, { clearInput: true });
  };

  const handleExplainSelection = async () => {
    let selectionSource =
      selectionMenu?.text || lastSelectionTextRef.current || '';

    if (!selectionSource.trim() && typeof window !== 'undefined') {
      selectionSource = window.getSelection()?.toString() || '';
      console.log('[Chat] Fallback selection captured ->', selectionSource);
    }
    if (!selectionSource.trim()) {
      console.warn('[Chat] Explain aborted: no selection text available');
      return;
    }

    const selected = selectionSource.trim();
    if (!selected) {
      hideSelectionMenu({ force: true });
      return;
    }

    hideSelectionMenu({ force: true });

    if (typeof window !== 'undefined') {
      requestAnimationFrame(() => {
        window.getSelection()?.removeAllRanges();
      });
    }

    const normalized = selected.replace(/\s+/g, ' ');
    const sanitizedText = normalized.replace(/"/g, '\\"');
    lastSelectionTextRef.current = '';
    console.log('[Chat] Explain selection ->', { selected, normalized, sanitizedText });

    const previousInput = input;
    await sendUserMessage(`Explain "${sanitizedText}"`, { clearInput: true, force: true });
    if (previousInput) {
      setInput(previousInput);
    }
  };

  const handleDeepDiveSelection = async () => {
    let selectionSource =
      selectionMenu?.text || lastSelectionTextRef.current || '';

    if (!selectionSource.trim() && typeof window !== 'undefined') {
      selectionSource = window.getSelection()?.toString() || '';
    }
    if (!selectionSource.trim()) return;

    const selected = selectionSource.trim();
    hideSelectionMenu({ force: true });

    if (typeof window !== 'undefined') {
      requestAnimationFrame(() => {
        window.getSelection()?.removeAllRanges();
      });
    }

    const normalized = selected.replace(/\s+/g, ' ');
    const sanitizedText = normalized.replace(/"/g, '\\"');
    lastSelectionTextRef.current = '';

    const previousInput = input;
    await sendUserMessage(`Please provide a deep dive and comprehensive analysis of: "${sanitizedText}"`, { clearInput: true, force: true });
    if (previousInput) {
      setInput(previousInput);
    }
  };

  const handleQuoteSelection = () => {
    let selectionSource =
      selectionMenu?.text || lastSelectionTextRef.current || '';

    if (!selectionSource.trim() && typeof window !== 'undefined') {
      selectionSource = window.getSelection()?.toString() || '';
    }
    if (!selectionSource.trim()) return;

    const selected = selectionSource.trim();
    hideSelectionMenu({ force: true });

    if (typeof window !== 'undefined') {
      requestAnimationFrame(() => {
        window.getSelection()?.removeAllRanges();
      });
    }
    
    setQuotedText(selected);
    
    // Focus input
    if (!isMobile) {
      setTimeout(() => {
        getCurrentInputRef().current?.focus();
      }, 100);
    }
  };

  const handleChatScrollWithSelection = useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      hideSelectionMenu();
      handleChatScroll(event, messages.length > 0);
    },
    [handleChatScroll, hideSelectionMenu, messages.length],
  );

  // Handle key down
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) {
      return;
    }

    if (e.key === 'Enter') {
      if (e.shiftKey) {
        e.preventDefault();
        const cursorPosition = e.currentTarget.selectionStart;
        const newValue = input.slice(0, cursorPosition) + '\n' + input.slice(cursorPosition);
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

  // Handle view mode change
  const handleViewModeChange = (mode: ViewMode) => {
    setViewMode(mode);
    localStorage.setItem('chatViewMode', mode);
  };

  // Handle reasoning toggle
  const handleToggleReasoning = (messageId: string) => {
    setShowReasoning((prev) => ({
      ...prev,
      [messageId]: !prev[messageId],
    }));
  };

  // Handle right panel scroll with load more
  const handleTweetFeedScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (isRestoringTweetScroll.current) {
      return;
    }

    const target = e.currentTarget;
    const distanceToBottom = target.scrollHeight - target.scrollTop - target.clientHeight;
    const isNearBottom = distanceToBottom < target.clientHeight * 2;

    if (isNearBottom && hasMore) {
      if (isLoadingMore) {
        pendingLoadMoreRef.current = true;
      } else {
        pendingLoadMoreRef.current = false;
        loadMoreTweets();
      }
    }

    // Still delegate toolbar show/hide logic, but prevent double triggering loadMore
    handleRightPanelScroll(e, hasMore, isLoadingMore, () => {});
  };

  // Restore tweet feed scroll position after returning from tweet detail
  useEffect(() => {
    if (!tweetFeedScrollRef.current) return;
    if (!isMobile) return;

    const savedScroll = sessionStorage.getItem('bnbot:tweetFeedScrollTop');
    if (!savedScroll) return;

    if (tweets.length === 0) {
      return;
    }

    const targetScrollTop = parseFloat(savedScroll);
    if (Number.isNaN(targetScrollTop)) {
      sessionStorage.removeItem('bnbot:tweetFeedScrollTop');
      return;
    }

    let attempts = 0;
    const maxAttempts = 12;
    isRestoringTweetScroll.current = true;

    const attemptScroll = () => {
      const container = tweetFeedScrollRef.current;
      if (!container) {
        attempts = maxAttempts;
        isRestoringTweetScroll.current = false;
        sessionStorage.removeItem('bnbot:tweetFeedScrollTop');
        return false;
      }
      container.scrollTo({
        top: targetScrollTop,
        behavior: 'auto',
      });
      attempts += 1;
      if (
        Math.abs(container.scrollTop - targetScrollTop) < 2 ||
        attempts >= maxAttempts
      ) {
        sessionStorage.removeItem('bnbot:tweetFeedScrollTop');
        isRestoringTweetScroll.current = false;
        return false;
      }
      return true;
    };

    if (!attemptScroll()) {
      return;
    }

    const timer = window.setInterval(() => {
      if (!attemptScroll()) {
        window.clearInterval(timer);
      }
    }, 100);

    return () => {
      window.clearInterval(timer);
      isRestoringTweetScroll.current = false;
    };
  }, [isMobile, tweets.length]);

  // 如果加载过程中用户已经在底部，加载完成后自动触发下一页请求
  useEffect(() => {
    if (isLoadingMore || !hasMore) return;
    if (selectedTweetPreview || tweetPreviewLoadingKey || tweetPreviewError) return;
    if (isRestoringTweetScroll.current) return;

    const container = tweetFeedScrollRef.current;
    if (!container) return;

    const distanceToBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    const isNearBottom = distanceToBottom < container.clientHeight * 2;

    if (pendingLoadMoreRef.current || isNearBottom) {
      pendingLoadMoreRef.current = false;
      loadMoreTweets();
    }
  }, [
    hasMore,
    isLoadingMore,
    loadMoreTweets,
    selectedTweetPreview,
    tweetPreviewLoadingKey,
    tweetPreviewError,
    tweets.length,
  ]);

  const chatPanelTransitionClass = hydrated
    ? 'transition-transform duration-200 ease-in-out'
    : 'transition-none';

  const chatPaddingBottom = Math.max(inputHeight + 80, 200);
  const scrollButtonOffset = Math.max(chatPaddingBottom - 110, 90);
  const effectiveIsMobile = hydrated ? isMobile : false;

  const handleChatTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    if (!isMobile || !isChatOpen) return;
    chatSwipeStartXRef.current = event.touches[0]?.clientX ?? null;
    chatSwipeStartYRef.current = event.touches[0]?.clientY ?? null;
    chatSwipeHandledRef.current = false;
  };

  const handleChatTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    if (!isMobile || !isChatOpen) return;
    if (chatSwipeHandledRef.current) return;
    const startX = chatSwipeStartXRef.current;
    const startY = chatSwipeStartYRef.current;
    if (startX === null || startY === null) return;
    const currentX = event.touches[0]?.clientX ?? startX;
    const currentY = event.touches[0]?.clientY ?? startY;
    const dx = currentX - startX;
    const dy = currentY - startY;

    const SWIPE_TO_CLOSE_THRESHOLD = 40;
    const EDGE_IGNORE_THRESHOLD = 30; // 忽略屏幕左边缘30px内的滑动
    // 只有当起始位置不在左边缘时才处理左滑关闭
    if (startX > EDGE_IGNORE_THRESHOLD && dx < -SWIPE_TO_CLOSE_THRESHOLD && Math.abs(dx) > Math.abs(dy) + 8) {
      chatSwipeHandledRef.current = true;
      setIsChatOpen(false);
      sessionStorage.setItem('bnbot:isChatOpen', 'false');
    }
  };

  const handleChatTouchEnd = () => {
    chatSwipeStartXRef.current = null;
    chatSwipeStartYRef.current = null;
    chatSwipeHandledRef.current = false;
  };

  // Compute viewMode class for initial render
  const leftPanelWidthClass = viewMode === 'equal' ? 'md:w-1/2' : 'md:w-[33.333333%]';
  const rightPanelPositionClass = viewMode === 'equal' ? 'md:ml-[50%] md:w-1/2' : 'md:ml-[33.333333%] md:w-2/3';

  return (
    <>
      {/* Inline script to set viewMode and chat state before React hydration */}
      <script
        dangerouslySetInnerHTML={{
          __html: `
            (function() {
              try {
                var saved = localStorage.getItem('chatViewMode');
                if (saved === 'equal') {
                  document.documentElement.setAttribute('data-chat-view-mode', 'equal');
                }
                // Handle chat panel visibility (mobile and desktop)
                var isMobile = window.innerWidth < 768;
                var savedChatOpen = sessionStorage.getItem('bnbot:isChatOpen');
                var chatOpen = savedChatOpen !== null ? savedChatOpen === 'true' : !isMobile;
                if (!chatOpen) {
                  document.documentElement.setAttribute('data-chat-closed', 'true');
                }
              } catch(e) {}
            })();
          `,
        }}
      />
      <style
        dangerouslySetInnerHTML={{
          __html: `
            @media (min-width: 768px) {
              [data-chat-view-mode="equal"]:not([data-chat-closed="true"]) .chat-left-panel { width: 50% !important; }
              [data-chat-view-mode="equal"]:not([data-chat-closed="true"]) .chat-right-panel { margin-left: 50% !important; width: 50% !important; }
              [data-chat-view-mode="equal"] .chat-skeleton-grid { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
              [data-chat-closed="true"] .chat-right-panel { margin-left: 0 !important; width: 100% !important; }
            }
            @media (max-width: 767px) {
              [data-chat-closed="true"] .chat-left-panel { transform: translateX(-100%) !important; }
              [data-chat-closed="true"] .chat-right-panel { margin-left: 0 !important; width: 100% !important; opacity: 1 !important; pointer-events: auto !important; }
            }
          `,
        }}
      />
      <div className="relative flex overflow-hidden mobile-full-height md:h-screen">
        {/* Mobile toggle button */}
      {hydrated && isMobile && (
        <motion.button
          className="fixed bottom-40 left-0 z-20 w-[36px] rounded-r-xl bg-gray-100/80 py-1.5 pl-1 pr-1 text-gray-500 shadow-sm transition-all duration-200 hover:bg-gray-200/60"
          onClick={handleChatToggle}
          aria-label={isChatOpen ? 'Close tweet feed' : 'Open tweet feed'}
          whileTap={{ scale: 0.95 }}
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={isChatOpen ? 'arrow' : 'avatar'}
              initial={{ opacity: 0, scale: 0.85, rotate: isChatOpen ? -90 : 90 }}
              animate={{ opacity: 1, scale: 1, rotate: 0 }}
              exit={{ opacity: 0, scale: 0.85, rotate: isChatOpen ? 90 : -90 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="flex h-6 w-6 items-center justify-center"
            >
              {isChatOpen ? (
                <ChevronLeftIcon className="h-4 w-4 text-gray-600" />
              ) : (
                <span className="flex h-6 w-6 ml-[1px] items-center justify-center overflow-hidden rounded-full">
                  <Image
                    src={bnbotAI}
                    alt="BNBOT icon"
                    width={24}
                    height={24}
                    className="h-full w-full rounded-full object-cover"
                  />
                </span>
              )}
            </motion.span>
          </AnimatePresence>
        </motion.button>
      )}

      {/* Left chat panel */}
      <div
        suppressHydrationWarning
        className={`chat-left-panel fixed bottom-0 left-0 top-0 h-full ${chatPanelTransitionClass} md:absolute md:h-screen ${
          isChatOpen ? 'translate-x-0' : '-translate-x-full'
        } ${
          viewMode === 'equal' ? 'md:w-1/2' : 'md:w-[33.333333%]'
        } w-full ${isChatOpen ? 'z-10 md:z-auto' : ''}`}
        onTouchStart={handleChatTouchStart}
        onTouchMove={handleChatTouchMove}
        onTouchEnd={handleChatTouchEnd}
        onTouchCancel={handleChatTouchEnd}
      >
        <div className="h-full px-0 pb-0 pt-0 md:pb-2 md:pl-2 md:pr-1 md:pt-1.5">
          <div className="flex h-full flex-col rounded-lg bg-white md:border md:border-gray-100 md:shadow-card">
            <div className="relative flex h-full flex-col">
              {/* Mobile menu button - shows on welcome screen */}
              {hydrated && isMobile && messages.length === 0 && (
                <div className="absolute left-0 top-0 z-20 px-3 py-2">
                  <button
                    onClick={() => openDrawer('CLASSIC_SIDEBAR')}
                    className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/95 backdrop-blur-sm border border-gray-100 shadow-sm transition-all duration-200 hover:shadow-md hover:border-[#f0b90b]/30 active:scale-95"
                    title="打开菜单"
                    aria-label="打开侧边栏菜单"
                  >
                    <svg className="h-4 w-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25h16.5" />
                    </svg>
                  </button>
                </div>
              )}

              {/* Mobile chat header - only shows when scrolling up with messages */}
              {hydrated && isMobile && messages.length > 0 && (
                <div
                  className={`absolute left-0 right-0 top-0 z-20 flex items-center justify-between px-3 py-2 rounded-b-2xl backdrop-blur-sm transition-all duration-300 ease-in-out ${
                    isMobileChatHeaderVisible
                      ? 'translate-y-0 opacity-100'
                      : '-translate-y-full opacity-0 pointer-events-none'
                  }`}
                >
                  {/* Left: Menu button - same style as agent page */}
                  <button
                    onClick={() => openDrawer('CLASSIC_SIDEBAR')}
                    className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/95 backdrop-blur-sm border border-gray-100 shadow-sm transition-all duration-200 hover:shadow-md hover:border-[#f0b90b]/30 active:scale-95"
                    title="打开菜单"
                    aria-label="打开侧边栏菜单"
                  >
                    <svg className="h-4 w-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25h16.5" />
                    </svg>
                  </button>

                  {/* Right: New chat button */}
                  <button
                    onClick={startNewChat}
                    className="flex h-9 w-9 items-center justify-center rounded-full bg-white/95 backdrop-blur-sm border border-gray-100 shadow-sm transition-all duration-200 hover:shadow-md hover:border-[#f0b90b]/30 active:scale-95"
                    title={t('feedToolbar.newChat')}
                    aria-label={t('feedToolbar.newChat')}
                  >
                    <PlusIcon className="h-4 w-4 text-gray-600" />
                  </button>
                </div>
              )}

              {/* Messages / welcome container */}
              <div
                ref={chatContainerRef}
                onScroll={handleChatScrollWithSelection}
                className="scrollbar-none flex-1 overflow-y-auto p-4"
                style={{
                  paddingBottom: `${chatPaddingBottom}px`,
                }}
              >
                {messages.length === 0 ? (
                  <WelcomeScreen
                    key={locale}
                    input={input}
                    setInput={setInput}
                    onSubmit={handleSubmit}
                    onKeyDown={handleKeyDown}
                    onInterrupt={interruptChat}
                    isLoading={isLoading}
                    selectedAgent={selectedAgent}
                    onClearAgent={() => setSelectedAgent(null)}
                    showInlineInput={false}
                    showDisclaimer={false}
                    onQuickPrompt={(prompt) => {
                      if (isLoading) return;
                      setInput(prompt);
                      void sendUserMessage(prompt, { clearInput: true });
                    }}
                    serverPrompts={chatPrompts}
                  />
                ) : (
                  messages.map((message, index) => (
                    <ChatMessage
                      key={index}
                      message={message}
                      index={index}
                      onCopyMessage={copyMessage}
                      onRegenerateMessage={regenerateMessage}
                      copiedMessageId={copiedMessageId}
                      isLoading={isLoading}
                      showReasoning={showReasoning}
                      onToggleReasoning={handleToggleReasoning}
                      onTopicSelect={handleTopicSelect}
                      onTweetReferenceSelect={handleTweetReferenceSelect}
                      isTweetReferenceLoading={isTweetReferenceLoading}
                      onShowLogin={() => setShowLoginModal(true)}
                      shouldAnimate={message.role === 'user' || index !== messages.length - 1}
                    />
                  ))
                )}

                {/* Streaming message */}
                {(currentAssistantMessage || currentReasoningContent || currentToolCallsInfo.length > 0) && (
                  <div className="mb-6 w-full">
                    <div className="flex justify-start">
                      <div className="flex flex-col min-w-0 w-full max-w-[100%] items-start">
                        <div className="bg-transparent px-0 py-1 min-w-0 w-full">
                          {/* Streaming reasoning */}
                          {currentReasoningContent && (
                            <ReasoningSection
                              reasoning={currentReasoningContent}
                              isStreaming={true}
                              onTweetReferenceSelect={handleTweetReferenceSelect}
                              isTweetReferenceLoading={isTweetReferenceLoading}
                            />
                          )}

                          {/* Streaming message content */}
                          {currentAssistantMessage && (
                            <div className="w-full min-w-0 overflow-hidden font-inter text-sm font-normal leading-relaxed tracking-tight text-gray-900 antialiased">
                              <MessageContent
                                content={currentAssistantMessage}
                                isStreaming={isLoading}
                                onTweetReferenceSelect={handleTweetReferenceSelect}
                                isTweetReferenceLoading={isTweetReferenceLoading}
                                toolCallsInfo={currentToolCallsInfo}
                              />
                            </div>
                          )}
                        </div>
                        {/* Placeholder for action buttons - matches ChatMessage height */}
                        <div className="mt-0.5 flex items-center gap-1 opacity-0 pointer-events-none" aria-hidden="true">
                          <span className="p-1"><span className="h-4 w-4 block" /></span>
                          <span className="p-1"><span className="h-4 w-4 block" /></span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Loading indicator */}
                {shouldShowThinkingIndicator && (
                  <div className="flex justify-start pl-0">
                    <div className="max-w-[85%] bg-transparent px-0 py-2">
                      <div className="flex items-center space-x-2">
                        <span className="loading loading-dots loading-sm text-[#f0b90b]"></span>
                        {/* <span className="font-inter text-[14px] md:text-[13px] font-medium tracking-[-0.008em] text-gray-600 antialiased subpixel-antialiased">
                          BNBOT is thinking...
                        </span> */}
                      </div>
                      {currentToolCallsInfo.length > 0 && (
                        <div className="mt-3">
                          <ToolCallBadges
                            toolCallsInfo={currentToolCallsInfo}
                            isStreaming={true}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>

              {/* Scroll to bottom button */}
              <AnimatePresence>
                {userHasScrolled && messages.length > 0 && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    transition={{ duration: 0.15 }}
                    className="pointer-events-none absolute inset-x-0 z-10 flex justify-center"
                    style={{ bottom: scrollButtonOffset }}
                  >
                    <button
                      onClick={() => {
                        scrollToBottom(true);
                        setUserHasScrolled(false);
                      }}
                      className="pointer-events-auto flex h-8 w-8 items-center justify-center rounded-full border border-gray-100/60 bg-white/70 shadow-sm backdrop-blur-sm transition-all hover:bg-white/90 active:scale-95"
                      aria-label="Scroll to bottom"
                    >
                      <ChevronDownIcon className="h-5 w-5 text-gray-500" strokeWidth={1.5} />
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Chat input */}
              <ChatInput
                input={input}
                setInput={setInput}
                onSubmit={handleSubmit}
                onKeyDown={handleKeyDown}
                onInterrupt={interruptChat}
                isLoading={isLoading}
                isMobile={effectiveIsMobile}
                selectedAgent={selectedAgent}
                hydrated={hydrated}
                textareaRef={chatInputRef}
                topNotice={
                  messages.length === 0
                    ? t('chatWelcome.disclaimer')
                    : undefined
                }
                quotedText={quotedText}
                onClearQuote={() => setQuotedText(null)}
              />
            </div>
          </div>
        </div>
      </div>

      {selectionMenu && (
        <div
          ref={selectionMenuRef}
          className="pointer-events-auto fixed z-50 flex items-center overflow-hidden rounded-full border border-gray-100 bg-white shadow-xl ring-1 ring-black/5"
          style={{
            top: selectionMenu.position.top,
            left: selectionMenu.position.left,
            transform: selectionMenu.renderAbove
              ? 'translate(-50%, -100%)'
              : 'translate(-50%, 0)',
          }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <div className="flex items-center divide-x divide-gray-100">
            <button
              type="button"
              onClick={handleExplainSelection}
              className="px-4 py-2.5 text-[13px] font-medium text-gray-700 transition-colors hover:bg-gray-50 active:bg-gray-100"
            >
              {t('selectionMenu.explain')}
            </button>
            <button
              type="button"
              onClick={handleDeepDiveSelection}
              className="px-4 py-2.5 text-[13px] font-medium text-gray-700 transition-colors hover:bg-gray-50 active:bg-gray-100 whitespace-nowrap"
            >
              {t('selectionMenu.deepDive')}
            </button>
            <button
              type="button"
              onClick={handleQuoteSelection}
              className="px-4 py-2.5 text-[13px] font-medium text-gray-700 transition-colors hover:bg-gray-50 active:bg-gray-100"
            >
              {t('selectionMenu.quote')}
            </button>
          </div>
        </div>
      )}

      {/* Right tweet feed panel */}
      <TweetFeed
        tweets={tweets}
        hasMore={hasMore}
        isChatOpen={isChatOpen}
        onToggleChat={handleChatToggle}
        onRefresh={refreshTweets}
        onLoadMore={loadMoreTweets}
        isLoadingMore={isLoadingMore}
        viewMode={viewMode}
        onViewModeChange={handleViewModeChange}
        isToolbarVisible={isToolbarVisible}
        onSetToolbarVisible={setIsToolbarVisible}
        onScroll={handleTweetFeedScroll}
        isMobile={effectiveIsMobile}
        scrollContainerRef={tweetFeedScrollRef}
        selectedTweet={selectedTweetPreview}
        selectedTweetLoading={Boolean(tweetPreviewLoadingKey)}
        selectedTweetError={tweetPreviewError}
        onClearSelectedTweet={handleClearSelectedTweet}
        onTweetClick={handleTweetClick}
        feedType={feedType}
        onFeedTypeChange={setFeedType}
        onNewChat={startNewChat}
      />

      {/* Login modal */}
      <LoginModal isOpen={showLoginModal} onClose={() => setShowLoginModal(false)} />

      {/* Mobile Tweet Preview Modal */}
      {isMobile && (
        <AnimatePresence>
          {(selectedTweetPreview || tweetPreviewLoadingKey || tweetPreviewError) && (
            <div className="fixed inset-0 z-[60] pointer-events-none">
              {/* We use a container with pointer-events-none to avoid blocking clicks when empty, 
                  but the sidebar itself will have pointer-events-auto */}
              {tweetPreviewLoadingKey ? (
                <div className="fixed bottom-0 left-0 right-0 z-50 flex h-[50vh] w-full flex-col items-center justify-center rounded-t-2xl bg-white shadow-2xl transition-transform duration-300 pointer-events-auto">
                   <div className="loading loading-spinner loading-lg text-[#f0b90b]" />
                   <span className="mt-4 text-sm text-gray-500">{t('feedToolbar.loadingTweet')}</span>
                </div>
              ) : tweetPreviewError ? (
                 <div className="fixed bottom-0 left-0 right-0 z-50 flex h-[50vh] w-full flex-col items-center justify-center rounded-t-2xl bg-white shadow-2xl transition-transform duration-300 pointer-events-auto">
                   <span className="text-sm text-gray-500">{tweetPreviewError}</span>
                   <button 
                     className="mt-4 rounded-full bg-gray-100 px-4 py-2 text-sm font-medium text-gray-600"
                     onClick={handleClearSelectedTweet}
                   >
                     {t('feedToolbar.close')}
                   </button>
                </div>
              ) : selectedTweetPreview ? (
                <div className="pointer-events-auto h-full w-full">
                  <TweetPreviewSidebar
                    tweet={selectedTweetPreview}
                    onClose={handleClearSelectedTweet}
                    isMobile={true}
                  />
                </div>
              ) : null}
            </div>
          )}
        </AnimatePresence>
      )}
    </div>
    </>
  );
}
