'use client';

import { use, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeftIcon } from '@heroicons/react/24/outline';
import { XIcon } from '@/components/icons/x-icon';
import MobileTweetDetail from '@/components/chat/MobileTweetDetail';
import { TrendTweet } from '@/components/chat/tweetDetail';
import { convertTweetInfoResponseToTrendTweet } from '@/components/chat/MessageContent';
import PostCommentButton from '@/components/ui/post-comment-button';
import TweetCommentItem from '@/components/chat/TweetCommentItem';
import { useTweetComments } from '@/hooks/useTweetComments';
import type { TweetInfoResponse } from '@/types';

declare global {
  interface Window {
    __bnbotTweetCache?: Record<string, TrendTweet>;
  }
}

interface TweetDetailPageProps {
  params: Promise<{
    id: string;
  }>;
}

export default function TweetDetailPage({ params }: TweetDetailPageProps) {
  const { id } = use(params);
  const router = useRouter();
  const [tweet, setTweet] = useState<TrendTweet | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [headerTransform, setHeaderTransform] = useState(0);
  const [shouldAnimate, setShouldAnimate] = useState(false);
  const lastScrollTopRef = useRef(0);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const loadMoreTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const HEADER_HEIGHT = 44;

  // Fetch comments using the custom hook
  const {
    comments,
    hasMore,
    isLoading: isLoadingComments,
    loadMoreComments,
  } = useTweetComments(id);

  useEffect(() => {
    let isActive = true;

    const loadTweet = async () => {
      if (!id) return;

      setIsLoading(true);

      try {
        let resolvedTweet: TrendTweet | null = null;

        if (typeof window !== 'undefined') {
          try {
            const cachedTweet = sessionStorage.getItem('bnbot:selectedTweet');
            if (cachedTweet) {
              const parsedTweet = JSON.parse(cachedTweet) as TrendTweet;
              if (parsedTweet?.id_str === id) {
                resolvedTweet = parsedTweet;
              }
            }
          } catch (error) {
            console.error('Failed to restore selected tweet from cache:', error);
          }

          if (!resolvedTweet) {
            const cachedFromWindow =
              window.__bnbotTweetCache?.[id];
            if (cachedFromWindow) {
              resolvedTweet = cachedFromWindow;
              try {
                sessionStorage.setItem(
                  'bnbot:selectedTweet',
                  JSON.stringify(cachedFromWindow),
                );
              } catch (storageError) {
                console.warn('Failed to cache tweet for detail view:', storageError);
              }
            }
          }
        }

        if (!resolvedTweet) {
          const baseUrl = process.env.NEXT_PUBLIC_REST_API_ENDPOINT;
          if (!baseUrl) {
            console.warn('NEXT_PUBLIC_REST_API_ENDPOINT is not configured.');
          } else {
            const headers: Record<string, string> = {
              'Content-Type': 'application/json',
              'x-public-key': process.env.NEXT_PUBLIC_X_PUBLIC_API_KEY || '',
            };

            if (typeof window !== 'undefined') {
              const token = localStorage.getItem('accessToken.bnbot');
              if (token) {
                headers['Authorization'] = `Bearer ${token}`;
              }
            }

            const response = await fetch(
              `${baseUrl}/api/v1/x-public/tweet-info?tweet_id=${id}`,
              {
                method: 'GET',
                headers,
              },
            );

            if (response.ok) {
              const data: TweetInfoResponse = await response.json();
              const converted = convertTweetInfoResponseToTrendTweet(data);
              if (converted) {
                resolvedTweet = converted;

                if (typeof window !== 'undefined') {
                  try {
                    sessionStorage.setItem(
                      'bnbot:selectedTweet',
                      JSON.stringify(converted),
                    );
                  } catch (storageError) {
                    console.warn('Failed to cache tweet for detail view:', storageError);
                  }

                  window.__bnbotTweetCache = {
                    ...(window.__bnbotTweetCache || {}),
                    [converted.id_str]: converted,
                  };
                }
              }
            } else {
              console.error(
                'Failed to fetch tweet detail',
                response.status,
                response.statusText,
              );
            }
          }
        }

        if (isActive) {
          setTweet(resolvedTweet);
        }
      } catch (error) {
        console.error('Error loading tweet detail:', error);
        if (isActive) {
          setTweet(null);
        }
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    };

    void loadTweet();

    return () => {
      isActive = false;
    };
  }, [id]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (loadMoreTimeoutRef.current) {
        clearTimeout(loadMoreTimeoutRef.current);
      }
    };
  }, []);

  const handleBack = () => {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back();
    } else {
      router.replace('/chat');
    }
  };

  const handleDetailScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    const currentScrollTop = target.scrollTop;
    const lastScrollTop = lastScrollTopRef.current;

    if (currentScrollTop <= HEADER_HEIGHT) {
      // 0-44px：顶部栏被内容"推"上去，跟随滚动距离移动（无动画）
      setShouldAnimate(false);
      setHeaderTransform(currentScrollTop);
    } else if (currentScrollTop > lastScrollTop) {
      // 向下滚动且超过44px，完全隐藏（有动画）
      setShouldAnimate(true);
      setHeaderTransform(HEADER_HEIGHT);
    } else {
      // 向上滚动，完全显示（有动画）
      setShouldAnimate(true);
      setHeaderTransform(0);
    }

    lastScrollTopRef.current = currentScrollTop;

    // 清除之前的定时器
    if (loadMoreTimeoutRef.current) {
      clearTimeout(loadMoreTimeoutRef.current);
    }

    // 使用防抖来检查是否需要加载更多
    loadMoreTimeoutRef.current = setTimeout(() => {
      const scrollHeight = target.scrollHeight;
      const clientHeight = target.clientHeight;
      const scrollBottom = scrollHeight - currentScrollTop - clientHeight;

      // 距离底部 200px 时开始加载
      if (scrollBottom < 200 && hasMore && !isLoadingComments) {
        loadMoreComments();
      }
    }, 150); // 150ms 防抖
  };

  const handleOpenAssistant = () => {
    router.push('/chat');
  };

  return (
    <div className="flex h-full flex-col bg-white">
      {/* 固定顶部栏 - 被内容"推"上去 */}
      <header
        className="fixed inset-x-0 top-0 z-30 flex items-center justify-between gap-2 px-3 py-1.5 backdrop-blur-xl bg-white/75"
        style={{
          transform: `translateY(-${headerTransform}px)`,
          transition: shouldAnimate ? 'transform 0.3s ease-out' : 'none',
        }}
      >
        <div className="flex items-center gap-2">
          <button
            onClick={handleBack}
            className="flex items-center justify-center rounded-full p-1.5 py-2 text-black transition hover:bg-gray-100"
            aria-label="返回"
          >
            <ArrowLeftIcon className="h-4 w-4" />
          </button>
          <h1 className="font-twitter-chirp text-sm font-semibold text-gray-900">Post</h1>
        </div>
        {tweet && (
          <a
            href={`https://x.com/${tweet.author.username}/status/${tweet.id_str}`}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-full p-2 text-black transition hover:bg-gray-100"
          >
            <XIcon className="h-5 w-5" />
          </a>
        )}
      </header>

      <main
        ref={scrollContainerRef}
        className="hide-scrollbar flex-1 overflow-y-auto bg-white pb-6"
        style={{ paddingTop: `${HEADER_HEIGHT}px` }}
        onScroll={handleDetailScroll}
      >
        {isLoading ? (
          <div className="flex h-full items-center justify-center">
            <div className="flex flex-col items-center gap-2">
              <span className="loading loading-spinner loading-md text-blue-500"></span>
            </div>
          </div>
        ) : tweet ? (
          <div className="relative">
            <MobileTweetDetail tweet={tweet} />

            {/* Comments Section */}
            <div>
              {/* Comments List */}
              {comments.length > 0 ? (
                <div>
                  {comments.map((comment) => (
                    <TweetCommentItem
                      key={comment.tweet_id}
                      comment={comment}
                      originalTweetAuthor={tweet.author.username}
                      tweetText={tweet.retweeted_tweet?.text || tweet.text}
                    />
                  ))}

                  {/* Loading indicator at bottom */}
                  {isLoadingComments && (
                    <div className="flex items-center justify-center py-8">
                      <span className="loading loading-spinner loading-sm text-blue-500"></span>
                    </div>
                  )}

                  {/* End indicator when no more comments */}
                  {!hasMore && !isLoadingComments && (
                    <div className="flex items-center justify-center py-12">
                      <div className="h-1 w-1 rounded-full bg-gray-400"></div>
                    </div>
                  )}
                </div>
              ) : isLoadingComments ? (
                <div className="flex items-center justify-center py-12">
                  <span className="loading loading-spinner loading-md text-blue-500"></span>
                </div>
              ) : null}
            </div>

            <PostCommentButton
              className="fixed bottom-16 right-6 z-40"
              onLaunch={handleOpenAssistant}
              tweetContent={tweet.retweeted_tweet?.text || tweet.text}
              tweetId={tweet.id_str}
            />
          </div>
        ) : (
          <div className="font-twitter-chirp flex h-full flex-col items-center justify-center px-6 text-center text-sm text-gray-500">
            <p>未找到这条推文，可能已过期或缓存已被清除。</p>
            <button
              onClick={handleBack}
              className="mt-4 rounded-full bg-[#f0b90b] px-6 py-2 text-sm font-medium text-white shadow hover:bg-[#e6a800]"
            >
              返回聊天
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
