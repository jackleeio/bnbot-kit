'use client';

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  useMasonry,
  usePositioner,
  useResizeObserver,
  useInfiniteLoader,
  type RenderComponentProps,
} from 'masonic';
import { useTranslations } from 'next-intl';
import TweetCard from './tweetCard';
import TweetSkeleton from './TweetSkeleton';
import FeedToolbar from './FeedToolbar';
import TweetPreviewSidebar from './tweet-preview-sidebar';
import { Tweet, ViewMode } from '@/types/chat';
import type { TrendTweet } from './tweetDetail';

interface TweetFeedProps {
  tweets: Tweet[];
  hasMore: boolean;
  isChatOpen: boolean;
  onToggleChat: () => void;
  onRefresh: () => void;
  onLoadMore: () => void;
  isLoadingMore: boolean;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  isToolbarVisible: boolean;
  onSetToolbarVisible?: (visible: boolean) => void;
  onScroll: (e: React.UIEvent<HTMLDivElement>) => void;
  isMobile: boolean;
  scrollContainerRef?: React.Ref<HTMLDivElement>;
  selectedTweet?: TrendTweet | null;
  selectedTweetLoading?: boolean;
  selectedTweetError?: string | null;
  onClearSelectedTweet?: () => void;
  onTweetClick?: (tweet: Tweet) => void;
  feedType?: 'crypto' | 'ai';
  onFeedTypeChange?: (type: 'crypto' | 'ai') => void;
  onNewChat?: () => void;
}

const TweetFeed: React.FC<TweetFeedProps> = ({
  tweets,
  hasMore,
  isChatOpen,
  onToggleChat,
  onRefresh,
  onLoadMore,
  isLoadingMore,
  viewMode,
  onViewModeChange,
  isToolbarVisible,
  onSetToolbarVisible,
  onScroll,
  isMobile,
  scrollContainerRef,
  selectedTweet,
  selectedTweetLoading = false,
  selectedTweetError,
  onClearSelectedTweet,
  feedType = 'crypto',
  onFeedTypeChange,
  onNewChat,
}) => {
  const t = useTranslations('feedToolbar');

  const REFRESH_THRESHOLD = 70;
  const MAX_PULL_DISTANCE = 120;
  const REFRESH_INDICATOR_DISTANCE = 56;
  const SNAP_BACK_DURATION = 220;
  const PULL_ACTIVATION_THRESHOLD = 26; // require a bit more drag to enter pull-to-refresh
  const INDICATOR_SHOW_THRESHOLD = 42; // don't show helper text until user drags a noticeable distance
  const SWIPE_TO_OPEN_THRESHOLD = 40;
  const EDGE_IGNORE_THRESHOLD = 30; // 忽略屏幕左边缘30px内的滑动，避免触发浏览器返回

  const [pullDistance, setPullDistance] = useState(0);
  const [isPullRefreshing, setIsPullRefreshing] = useState(false);
  const [isUserPulling, setIsUserPulling] = useState(false);
  const internalScrollRef = useRef<HTMLDivElement | null>(null);
  const pullStartYRef = useRef<number | null>(null);
  const isPullingRef = useRef(false);
  const isUserPullingRef = useRef(false);
  const pullDistanceRef = useRef(0);
  const animationFrameRef = useRef<number | null>(null);
  const [masonrySize, setMasonrySize] = useState({ width: 0, height: 0 });
  const [masonryScroll, setMasonryScroll] = useState({ scrollTop: 0, isScrolling: false });
  const scrollIdleTimeoutRef = useRef<number | null>(null);
  const columnGutter = 16;

  // Scroll restoration refs
  const savedScrollPosition = useRef(0);
  const isRestoring = useRef(false);
  const prevShowTweetPreview = useRef(false);
  const prevTweetsRef = useRef<Tweet[]>([]);

  // Track expanded tweet IDs to preserve state during virtualization
  const [expandedTweetIds, setExpandedTweetIds] = useState<Set<string>>(new Set());

  const handleTweetExpand = useCallback((tweetId: string, isExpanded: boolean) => {
    setExpandedTweetIds(prev => {
      const next = new Set(prev);
      if (isExpanded) {
        next.add(tweetId);
      } else {
        next.delete(tweetId);
      }
      return next;
    });
  }, []);

  // Keep the last non-empty tweets to avoid showing empty state when switching views
  // Update the ref when we have tweets
  if (tweets.length > 0) {
    prevTweetsRef.current = tweets;
  }

  // Use current tweets if available, otherwise fall back to cached tweets
  const displayTweets = tweets.length > 0 ? tweets : prevTweetsRef.current;

  const showTweetPreview =
    Boolean(selectedTweet) || selectedTweetLoading || Boolean(selectedTweetError);


  // Synchronously detect transition to feed mode to block immediate scroll events
  if (prevShowTweetPreview.current !== showTweetPreview) {
    if (!showTweetPreview) {
      isRestoring.current = true;
    }
    prevShowTweetPreview.current = showTweetPreview;
  }

  // Preview swipe to close
  const previewScrollRef = useRef<HTMLDivElement>(null);
  const previewSwipeStartYRef = useRef<number | null>(null);
  const [previewSwipeDistance, setPreviewSwipeDistance] = useState(0);
  const [mounted, setMounted] = useState(false);
  const swipeStartXRef = useRef<number | null>(null);
  const swipeStartYRef = useRef<number | null>(null);
  const swipeHandledRef = useRef(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Initialize toolbar visibility on mount for mobile
  useEffect(() => {
    if (!isMobile || !onSetToolbarVisible) return;

    // Check if there's a saved scroll position from session storage (returning from tweet detail)
    const savedScroll = sessionStorage.getItem('bnbot:tweetFeedScrollTop');
    if (savedScroll && parseFloat(savedScroll) > 50) {
      // Returning from detail page with scroll position - hide toolbar
      onSetToolbarVisible(false);
    } else {
      // Fresh page load or at top - show toolbar
      onSetToolbarVisible(true);
    }
  }, [isMobile, onSetToolbarVisible]);

  useLayoutEffect(() => {
    const node = internalScrollRef.current;
    if (!node) return;

    const updateSize = () => {
      setMasonrySize({
        width: node.clientWidth,
        height: node.clientHeight,
      });
      setMasonryScroll((prev) => ({
        ...prev,
        scrollTop: node.scrollTop,
      }));
    };

    updateSize();
    const resizeObserver = new ResizeObserver(updateSize);
    resizeObserver.observe(node);

    return () => {
      resizeObserver.disconnect();
      if (scrollIdleTimeoutRef.current) {
        window.clearTimeout(scrollIdleTimeoutRef.current);
        scrollIdleTimeoutRef.current = null;
      }
    };
  }, [isChatOpen, isMobile, isToolbarVisible, viewMode, showTweetPreview]);

  // Save scroll position when entering preview mode
  useEffect(() => {
    if (showTweetPreview && internalScrollRef.current) {
      savedScrollPosition.current = internalScrollRef.current.scrollTop;
    }
  }, [showTweetPreview]);

  // Restore scroll position when exiting preview mode
  useLayoutEffect(() => {
    if (!showTweetPreview && savedScrollPosition.current > 0) {
      // Returning from preview with saved scroll position - hide toolbar
      if (isMobile && onSetToolbarVisible) {
        onSetToolbarVisible(false);
      }

      // Attempt to restore immediately if ref is available
      if (internalScrollRef.current) {
        internalScrollRef.current.scrollTop = savedScrollPosition.current;
        setMasonryScroll((prev) => ({
          ...prev,
          scrollTop: internalScrollRef.current ? internalScrollRef.current.scrollTop : prev.scrollTop,
        }));
      }

      // Also try in next frame to handle cases where layout isn't ready
      requestAnimationFrame(() => {
        if (internalScrollRef.current) {
          internalScrollRef.current.scrollTop = savedScrollPosition.current;
          setMasonryScroll((prev) => ({
            ...prev,
            scrollTop: internalScrollRef.current ? internalScrollRef.current.scrollTop : prev.scrollTop,
          }));
        }
        // Reset flag after a short delay to ensure we skip the initial scroll events
        setTimeout(() => {
          isRestoring.current = false;
        }, 100);
      });
    } else if (!showTweetPreview) {
      // If no saved position (at top), show toolbar on mobile
      if (isMobile && onSetToolbarVisible) {
        onSetToolbarVisible(true);
      }
      // Reset flag
      isRestoring.current = false;
    }
  }, [showTweetPreview, isMobile, onSetToolbarVisible]);

  const handleScrollWrapper = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      if (isRestoring.current) {
        return;
      }

      const target = e.currentTarget;
      setMasonryScroll((prev) => ({
        scrollTop: target.scrollTop,
        isScrolling: true,
      }));
      if (scrollIdleTimeoutRef.current) {
        window.clearTimeout(scrollIdleTimeoutRef.current);
      }
      scrollIdleTimeoutRef.current = window.setTimeout(() => {
        setMasonryScroll((prev) => ({
          ...prev,
          isScrolling: false,
        }));
      }, 120);

      onScroll(e);
    },
    [onScroll],
  );

  const handlePreviewTouchStart = (e: React.TouchEvent) => {
    if (previewScrollRef.current?.scrollTop === 0) {
      previewSwipeStartYRef.current = e.touches[0].clientY;
    }
  };

  const handlePreviewTouchMove = (e: React.TouchEvent) => {
    if (previewSwipeStartYRef.current !== null) {
      const deltaY = e.touches[0].clientY - previewSwipeStartYRef.current;
      if (deltaY > 0) {
        setPreviewSwipeDistance(deltaY);
      }
    }
  };

  const handlePreviewTouchEnd = () => {
    if (previewSwipeDistance > 100) {
      onClearSelectedTweet?.();
    }
    setPreviewSwipeDistance(0);
    previewSwipeStartYRef.current = null;
  };

  const assignScrollRef = useCallback(
    (node: HTMLDivElement | null) => {
      internalScrollRef.current = node;

      // Force update masonrySize when feed div mounts
      if (node) {
        setMasonrySize({
          width: node.clientWidth,
          height: node.clientHeight,
        });
      }

      if (!scrollContainerRef) return;
      if (typeof scrollContainerRef === 'function') {
        scrollContainerRef(node);
      } else if ('current' in scrollContainerRef) {
        (scrollContainerRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
      }
    },
    [scrollContainerRef],
  );

  useEffect(() => {
    pullDistanceRef.current = pullDistance;
  }, [pullDistance]);

  useEffect(() => {
    if (!showTweetPreview) {
      return;
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && onClearSelectedTweet) {
        onClearSelectedTweet();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    internalScrollRef.current = null;
    if (!scrollContainerRef) {
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
    if (typeof scrollContainerRef === 'function') {
      scrollContainerRef(null);
    } else if ('current' in scrollContainerRef) {
      (scrollContainerRef as React.MutableRefObject<HTMLDivElement | null>).current = null;
    }

    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showTweetPreview, scrollContainerRef, onClearSelectedTweet]);

  const cancelPullAnimation = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
  }, []);

  const animatePullTo = useCallback(
    (target: number, duration = SNAP_BACK_DURATION) => {
      if (Math.abs(pullDistanceRef.current - target) < 0.5) {
        cancelPullAnimation();
        setPullDistance(target);
        return;
      }
      cancelPullAnimation();
      const start = performance.now();
      const initial = pullDistanceRef.current;

      const tick = (now: number) => {
        const elapsed = now - start;
        const progress = Math.min(1, elapsed / duration);
        const eased = 1 - Math.pow(1 - progress, 3); // easeOutCubic
        const next = initial + (target - initial) * eased;
        pullDistanceRef.current = next;
        setPullDistance(next);

        if (progress < 1) {
          animationFrameRef.current = requestAnimationFrame(tick);
        } else {
          setPullDistance(target);
          pullDistanceRef.current = target;
          animationFrameRef.current = null;
        }
      };

      animationFrameRef.current = requestAnimationFrame(tick);
    },
    [cancelPullAnimation],
  );

  useEffect(() => {
    if (!isMobile && pullDistance !== 0) {
      animatePullTo(0);
      isPullingRef.current = false;
      pullStartYRef.current = null;
    }
  }, [animatePullTo, isMobile, pullDistance]);

  useEffect(() => {
    if (!isLoadingMore && isPullRefreshing) {
      const timeout = setTimeout(() => {
        setIsPullRefreshing(false);
        animatePullTo(0, 260);
      }, 120);

      return () => clearTimeout(timeout);
    }
  }, [animatePullTo, isLoadingMore, isPullRefreshing]);

  useEffect(() => {
    return () => {
      cancelPullAnimation();
    };
  }, [cancelPullAnimation]);

  const handleTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    if (!isMobile || isLoadingMore || isPullRefreshing) return;
    cancelPullAnimation();
    pullStartYRef.current = event.touches[0]?.clientY ?? null;
    swipeStartXRef.current = event.touches[0]?.clientX ?? null;
    swipeStartYRef.current = event.touches[0]?.clientY ?? null;
    swipeHandledRef.current = false;
    const container = internalScrollRef.current;
    const canPull = !!container && container.scrollTop <= 0;
    isPullingRef.current = canPull;
    if (!canPull) {
      isUserPullingRef.current = false;
      setIsUserPulling(false);
    }
  };

  const handleTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    if (!isMobile || isLoadingMore || isPullRefreshing) return;
    const startY = pullStartYRef.current;
    const container = internalScrollRef.current;
    if (!container || startY === null) return;

    const currentX = event.touches[0]?.clientX ?? 0;
    const currentY = event.touches[0]?.clientY ?? startY;
    const startX = swipeStartXRef.current ?? currentX;
    const dx = currentX - startX;
    const dy = currentY - (swipeStartYRef.current ?? currentY);

    // Detect horizontal swipe to open chat when chat is closed on mobile
    // 忽略从屏幕左边缘开始的滑动，避免与浏览器返回手势冲突
    if (
      !swipeHandledRef.current &&
      isMobile &&
      !isChatOpen &&
      startX > EDGE_IGNORE_THRESHOLD &&
      dx > SWIPE_TO_OPEN_THRESHOLD &&
      Math.abs(dx) > Math.abs(dy) + 8
    ) {
      swipeHandledRef.current = true;
      onToggleChat();
      return;
    }

    if (swipeHandledRef.current) {
      return;
    }

    const delta = currentY - startY;

    if (!isPullingRef.current) {
      if (container.scrollTop <= 0 && delta > PULL_ACTIVATION_THRESHOLD) {
        isPullingRef.current = true;
      } else {
        return;
      }
    }

    // Subtract activation threshold to make the motion feel directly controlled by the finger
    const effectiveDelta = Math.max(0, delta - PULL_ACTIVATION_THRESHOLD);
    const damped =
      MAX_PULL_DISTANCE *
      (1 - Math.exp(-effectiveDelta / 90));
    const nextDistance = Math.min(damped, MAX_PULL_DISTANCE);
    pullDistanceRef.current = nextDistance;
    setPullDistance(nextDistance);
    if (!isUserPullingRef.current) {
      isUserPullingRef.current = true;
      setIsUserPulling(true);
    }
  };

  const finishPull = () => {
    if (isPullRefreshing) return;
    pullStartYRef.current = null;
    isPullingRef.current = false;
    if (isUserPullingRef.current) {
      isUserPullingRef.current = false;
      setIsUserPulling(false);
    }
    pullDistanceRef.current = 0;
    setPullDistance(0);
  };

  const handleTouchEnd = () => {
    if (!isMobile) return;
    swipeStartXRef.current = null;
    swipeStartYRef.current = null;
    swipeHandledRef.current = false;
    if (isPullingRef.current && pullDistance >= REFRESH_THRESHOLD && !isLoadingMore && !isPullRefreshing) {
      setIsPullRefreshing(true);
      // Reset pulling state, keep current distance to avoid upward push
      pullStartYRef.current = null;
      isPullingRef.current = false;
      if (isUserPullingRef.current) {
        isUserPullingRef.current = false;
        setIsUserPulling(false);
      }
      pullDistanceRef.current = Math.max(pullDistance, REFRESH_INDICATOR_DISTANCE);
      setPullDistance(pullDistanceRef.current);
      onRefresh();
    } else {
      finishPull();
    }
  };

  const targetColumnCount = useMemo(() => {
    const width = masonrySize.width;
    if (width === 0) return 1;

    // Chat收起时（全宽），允许更多列
    if (!isChatOpen) {
      if (width >= 1400) return 4;
      if (width >= 1100) return 3;
      if (width >= 900) return 3;
      if (width >= 640) return 2;
      return 1;
    }

    // 1:1 视图，用较少列以保证密度
    if (viewMode === 'equal') {
      if (width >= 640) return 2;
      return 1;
    }

    // 默认 1:2 视图，目标 3 列（宽屏），中屏 2 列，小屏 1 列
    if (width >= 1100) return 3;
    if (width >= 900) return 3;
    if (width >= 640) return 2;
    return 1;
  }, [isChatOpen, masonrySize.width, viewMode]);

  const estimatedColumnWidth = useMemo(() => {
    const cols = Math.max(1, targetColumnCount);
    const width = masonrySize.width;
    if (width === 0) return 320;
    const totalGutter = columnGutter * (cols - 1);
    return Math.max(240, Math.floor((width - totalGutter) / cols));
  }, [columnGutter, masonrySize.width, targetColumnCount]);

  // Create a stable key that changes when tweets array shrinks or completely changes
  const tweetsKey = useMemo(() => {
    if (displayTweets.length === 0) return 'empty';
    return `${displayTweets.length}-${displayTweets[0]?.id_str || 'unknown'}`;
  }, [displayTweets]);

  const positioner = usePositioner(
    {
      width: Math.max(1, masonrySize.width),
      columnWidth: estimatedColumnWidth,
      columnGutter,
      rowGutter: columnGutter,
      maxColumnCount: targetColumnCount,
    },
    [columnGutter, estimatedColumnWidth, masonrySize.width, targetColumnCount, tweetsKey],
  );

  const resizeObserver = useResizeObserver(positioner);

  const itemKey = useCallback(
    (tweet: Tweet, index: number) => {
      if (!tweet) return `empty-${index}`;
      return tweet.id_str || `${tweet.user?.username ?? 'tweet'}-${tweet.created_at ?? index}`;
    },
    [],
  );

  const renderTweetCard = useCallback(
    ({ data }: RenderComponentProps<Tweet>) => {
      const tweet = data;
      const isExpanded = expandedTweetIds.has(tweet.id_str);
      return (
        <div id={`tweet-${tweet.id_str}`} className="tweet-container">
          <TweetCard
            tweet={tweet}
            isMobile={isMobile}
            username={tweet.user.username}
            avatar={tweet.user.avatar}
            name={tweet.user.name}
            initialExpanded={isExpanded}
            onExpandChange={(expanded) => handleTweetExpand(tweet.id_str, expanded)}
          />
        </div>
      );
    },
    [isMobile, expandedTweetIds, handleTweetExpand],
  );

  const maybeLoadMore = useInfiniteLoader(
    async () => {
      if (!hasMore || isLoadingMore) return;
      onLoadMore();
    },
    {
      isItemLoaded: (index, items) => index < items.length - 1,
      totalItems: hasMore ? displayTweets.length + 1 : displayTweets.length,
      threshold: 6,
    },
  );

  const masonryGrid = useMasonry<Tweet>({
    positioner,
    resizeObserver,
    items: displayTweets,
    itemKey,
    height: Math.max(1, masonrySize.height),
    scrollTop: masonryScroll.scrollTop,
    isScrolling: masonryScroll.isScrolling,
    overscanBy: isMobile ? 4 : 3,
    itemHeightEstimate: isMobile ? 520 : 460,
    render: renderTweetCard,
    onRender: maybeLoadMore,
  });

  return (
    <div
      className={`chat-right-panel transition-all duration-200 ease-in-out ${
        isChatOpen && isMobile
          ? 'ml-0 w-full opacity-0 pointer-events-none'
          : isChatOpen
          ? `ml-0 w-full opacity-100 pointer-events-auto ${
              viewMode === 'equal'
                ? 'md:ml-[50%] md:w-1/2' // 1:1 split on desktop
                : 'md:ml-[33.333333%] md:w-2/3' // Default 1:2 split on desktop
            }`
          : 'ml-0 w-full opacity-100 pointer-events-auto'
      }`}
      style={{
        // Keep this for extra safety if needed, or remove if classes cover it
        // pointerEvents: isMobile && isChatOpen ? 'none' : 'auto',
      }}
    >
      <div className="h-screen px-0 pb-0 pt-0 md:pb-2 md:pl-2 md:pr-2 md:pt-1.5">
        <div className="relative h-full rounded-lg border border-gray-100 bg-white p-2 py-0 shadow-card md:py-2">
          {/* Floating toolbar */}
          <FeedToolbar
            isChatOpen={isChatOpen}
            onToggleChat={onToggleChat}
            onRefresh={onRefresh}
            isLoading={isLoadingMore}
            viewMode={viewMode}
            onViewModeChange={onViewModeChange}
            isVisible={isToolbarVisible}
            isMobile={isMobile}
            isPreviewMode={showTweetPreview}
            onExitPreview={showTweetPreview ? onClearSelectedTweet : undefined}
            feedType={feedType}
            onFeedTypeChange={onFeedTypeChange}
            onNewChat={onNewChat}
          />

          <AnimatePresence mode="wait" initial={false}>
            {showTweetPreview ? (
              <motion.div
                key="preview"
                initial={{ opacity: 1 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 1 }}
                style={{ y: previewSwipeDistance }}
                transition={{ duration: 0 }}
                className="scrollbar-none h-full overflow-y-auto pb-4 pt-12"
                ref={previewScrollRef}
                onTouchStart={handlePreviewTouchStart}
                onTouchMove={handlePreviewTouchMove}
                onTouchEnd={handlePreviewTouchEnd}
              >
                <div className="flex h-full flex-col">
                  {selectedTweetLoading ? (
                    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-sm text-gray-500">
                      <div className="loading loading-spinner loading-lg text-[#f0b90b]" />
                      <span>{t('loadingTweet')}</span>
                    </div>
                  ) : selectedTweetError ? (
                    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-sm text-gray-500">
                      <span>{selectedTweetError}</span>
                    </div>
                  ) : selectedTweet ? (
                    <TweetPreviewSidebar
                      tweet={selectedTweet}
                      onClose={onClearSelectedTweet ?? (() => {})}
                      isMobile={isMobile}
                      className="h-full"
                    />
                  ) : null}
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="feed"
                initial={{ opacity: 1 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 1 }}
                transition={{ duration: 0 }}
                className="scrollbar-none h-full overflow-y-auto pb-4 pt-12 relative"
                onScroll={handleScrollWrapper}
                ref={assignScrollRef}
                data-tweet-feed-scroll="true"
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                onTouchCancel={handleTouchEnd}
                style={{
                  overscrollBehavior: isMobile ? 'contain' : undefined,
                  WebkitOverflowScrolling: 'touch',
                }}
              >
                {isMobile && (isPullRefreshing || (isUserPulling && pullDistance >= INDICATOR_SHOW_THRESHOLD)) && (
                  <div
                    className="pointer-events-none absolute left-0 right-0 top-0 z-10 flex h-12 items-center justify-center text-xs font-medium text-gray-500"
                    style={{ transform: `translateY(${pullDistance}px)` }}
                  >
                    {isPullRefreshing ? (
                      <span className="flex items-center gap-2">
                        <span className="loading loading-spinner loading-xs text-[#f0b90b]" />
                        {t('refreshing')}
                      </span>
                    ) : pullDistance >= REFRESH_THRESHOLD ? (
                      t('releaseToRefresh')
                    ) : (
                      t('pullDown')
                    )}
                  </div>
                )}

                <div
                  style={{
                    transform: `translateY(${pullDistance}px)`,
                    transition: 'none',
                  }}
                >
                  {displayTweets.length === 0 ? (
                    <div className={`chat-skeleton-grid grid grid-cols-1 gap-4 px-0 pt-2 md:px-0 md:pt-0 ${viewMode === 'equal' ? 'md:grid-cols-2' : 'md:grid-cols-2 xl:grid-cols-3'}`}>
                      {Array.from({ length: viewMode === 'equal' ? 6 : 9 }).map((_, index) => (
                        <TweetSkeleton key={index} isMobile={isMobile} />
                      ))}
                    </div>
                  ) : (
                    masonryGrid
                  )}

                  {/* Loading indicator */}
                  {isLoadingMore && displayTweets.length > 0 && (
                    <div className="flex justify-center py-8">
                      <div className="loading loading-spinner loading-md text-[#f0b90b]"></div>
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
};

export default TweetFeed;
