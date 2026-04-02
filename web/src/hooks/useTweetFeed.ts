'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Tweet } from '@/types/chat';
import type { TrendTweet } from '@/components/chat/tweetDetail';
import { getAccessToken } from '@/lib/cookie-utils';

declare global {
  interface Window {
    __bnbotTweetCache?: Record<string, TrendTweet>;
  }
}

const convertTweetToTrendTweet = (tweet: Tweet): TrendTweet => {
  return {
    id_str: tweet.id_str,
    created_at: tweet.created_at,
    text: tweet.text,
    reply_count: tweet.reply_count,
    retweet_count: tweet.retweet_count,
    like_count: tweet.like_count,
    quote_count: tweet.quote_count,
    view_count: `${tweet.view_count ?? ''}`,
    is_retweet: tweet.is_retweet,
    retweeted_status_id: tweet.retweeted_status_id,
    is_quote: tweet.is_quote,
    quoted_status_id: tweet.quoted_status_id,
    author: {
      username: tweet.user.username,
      twitter_id: tweet.user.twitter_id,
      name: tweet.user.name,
      avatar: tweet.user.avatar,
      description: tweet.user.description,
    },
    media: tweet.media
      ? tweet.media.map((item) => ({
        type: item.type,
        url: item.url,
        thumbnail: item.thumbnail,
      }))
      : null,
    quoted_tweet: tweet.quoted_tweet
      ? {
        id_str: tweet.quoted_tweet.id_str,
        text: tweet.quoted_tweet.text,
        created_at: tweet.quoted_tweet.created_at,
        user: {
          name: tweet.quoted_tweet.user.name,
          username: tweet.quoted_tweet.user.username,
          avatar: tweet.quoted_tweet.user.avatar,
        },
      }
      : null,
    retweeted_tweet: tweet.retweeted_tweet
      ? {
        text: tweet.retweeted_tweet.text,
        username: tweet.retweeted_tweet.username,
      }
      : null,
  };
};

const syncTweetCache = (tweetList: Tweet[]) => {
  if (typeof window === 'undefined') return;
  const cache: Record<string, TrendTweet> = {};
  tweetList.forEach((tweet) => {
    if (!tweet?.id_str) return;
    cache[tweet.id_str] = convertTweetToTrendTweet(tweet);
  });
  window.__bnbotTweetCache = cache;
};

export const useTweetFeed = () => {
  const [tweets, setTweets] = useState<Tweet[]>([]);
  const [cursor, setCursor] = useState('1'); // last requested cursor
  const [nextCursor, setNextCursor] = useState<string | null>('1'); // server-provided next cursor
  const [hasMore, setHasMore] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(true);
  const [feedType, setFeedType] = useState<'crypto' | 'ai'>('crypto');
  const initializedRef = useRef(false);

  // Fetch tweets from API
  const fetchTweets = useCallback(
    async (newCursor?: string, minLoadingTime = 0, options?: { preserveExisting?: boolean; type?: 'crypto' | 'ai' }) => {
      try {
        setIsLoadingMore(true);
        const startTime = Date.now();
        const targetCursor = newCursor ?? nextCursor ?? '1';
        const preserveExisting = options?.preserveExisting ?? false;
        const currentFeedType = options?.type ?? feedType;

        // Get access token from cookies
        const accessToken = getAccessToken();

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'x-api-key': process.env.NEXT_PUBLIC_X_API_KEY || '',
        };

        // Add Authorization header
        if (accessToken) {
          headers['Authorization'] = `Bearer ${accessToken}`;
        } else {
          headers['Authorization'] = `Bearer `;
        }

        const pageSize = process.env.NEXT_PUBLIC_KOL_PAGE_SIZE || '100';
        const params = new URLSearchParams({
          cursor: targetCursor,
          kol_type: currentFeedType,
          page_size: pageSize,
        });

        const response = await fetch(
          `${process.env.NEXT_PUBLIC_REST_API_ENDPOINT}/api/v1/ai/kol-recent-data?${params.toString()}`,
          {
            headers,
          },
        );

        if (!response.ok) {
          console.error('Fetch tweets error:', response.status, response.statusText);
          return;
        }

        const data = await response.json();

        // Ensure minimum loading time for better UX
        const elapsedTime = Date.now() - startTime;
        const remainingTime = Math.max(0, minLoadingTime - elapsedTime);

        if (remainingTime > 0) {
          await new Promise((resolve) => setTimeout(resolve, remainingTime));
        }

        if (data.status === 'success') {
          setCursor(targetCursor);
          setNextCursor(data.cursor || null);
          setTweets((prev) => {
            const getTweetKey = (tweet: Tweet) =>
              tweet?.id_str || `${tweet?.user?.username ?? 'tweet'}-${tweet?.created_at ?? ''}`;

            const uniqueTweets = (existing: Tweet[], incoming: Tweet[], prependIncoming = false) => {
              const seen = new Set<string>();
              const result: Tweet[] = [];

              const addTweets = (list: Tweet[]) => {
                for (const tweet of list) {
                  if (!tweet) continue;
                  const key = getTweetKey(tweet);
                  if (seen.has(key)) continue;
                  seen.add(key);
                  result.push(tweet);
                }
              };

              if (prependIncoming) {
                addTweets(incoming);
                addTweets(existing);
              } else {
                addTweets(existing);
                addTweets(incoming);
              }

              return result;
            };

            const shouldPrepend = targetCursor === '1';
            const baseTweets = shouldPrepend && preserveExisting ? prev : shouldPrepend ? [] : prev;

            const updatedTweets = uniqueTweets(baseTweets, data.data, shouldPrepend);

            syncTweetCache(updatedTweets);
            // Cache the full aggregated list so mobile back navigation can restore scroll position
            try {
              sessionStorage.setItem(
                'bnbot:tweetFeedCache',
                JSON.stringify({ status: 'success', data: updatedTweets, cursor: data.cursor, type: currentFeedType }),
              );
              sessionStorage.setItem('bnbot:tweetFeedCursor', data.cursor || '');
              sessionStorage.setItem('bnbot:tweetFeedType', currentFeedType);
            } catch (storageError) {
              console.warn('Failed to cache tweet feed:', storageError);
            }
            return updatedTweets;
          });
          // Prefer server-provided cursor; fall back to length > 0
          setHasMore(Boolean(data.cursor) || (Array.isArray(data.data) && data.data.length > 0));
        }
      } catch (error) {
        console.error('Error fetching tweets:', error);
      } finally {
        setIsLoadingMore(false);
      }
    },
    [nextCursor, feedType],
  );

  // Refresh tweets (load from beginning)
  const refreshTweets = useCallback(() => {
    setCursor('1');
    setNextCursor('1');
    setHasMore(true);
    fetchTweets('1', 800); // 800ms minimum loading time for refresh
  }, [fetchTweets]);

  // Load more tweets (pagination)
  const loadMoreTweets = useCallback(() => {
    if (hasMore && !isLoadingMore && nextCursor) {
      setCursor(nextCursor);
      fetchTweets(nextCursor, 300); // 300ms minimum for pagination
    }
  }, [fetchTweets, hasMore, isLoadingMore, nextCursor]);

  const handleSetFeedType = useCallback((type: 'crypto' | 'ai') => {
    if (type === feedType) return;
    setFeedType(type);
    setTweets([]);
    setCursor('1');
    setNextCursor('1');
    setHasMore(true);
    // Trigger fetch immediately with new type
    fetchTweets('1', 0, { type });
  }, [feedType, fetchTweets]);

  const restoreFromCache = useCallback((): { cursor: string | null; type: 'crypto' | 'ai' | null } => {
    try {
      const cachedData = sessionStorage.getItem('bnbot:tweetFeedCache');
      const cachedCursor = sessionStorage.getItem('bnbot:tweetFeedCursor');
      const cachedType = sessionStorage.getItem('bnbot:tweetFeedType') as 'crypto' | 'ai' | null;

      if (cachedData) {
        const parsed = JSON.parse(cachedData);
        if (parsed?.status === 'success' && Array.isArray(parsed.data)) {
          const nextFromCache = parsed.cursor || cachedCursor || '1';
          const typeFromCache = parsed.type || cachedType || 'crypto';

          setTweets(parsed.data);
          syncTweetCache(parsed.data);
          setHasMore(Boolean(parsed.cursor) || parsed.data.length > 0);
          setCursor(nextFromCache);
          setNextCursor(nextFromCache);
          setFeedType(typeFromCache);
          setIsLoadingMore(false);
          return { cursor: nextFromCache, type: typeFromCache };
        }
      }
    } catch (error) {
      console.error('Failed to restore tweet feed cache:', error);
    }
    return { cursor: null, type: null };
  }, []);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    const { cursor: cursorFromCache, type: typeFromCache } = restoreFromCache();
    // Always revalidate from the network so the Network panel shows the request and data stays fresh,
    // but keep cached items to avoid dropping previously loaded pages.
    fetchTweets(cursorFromCache || '1', 0, {
      preserveExisting: !!cursorFromCache,
      type: typeFromCache || 'crypto'
    });
  }, [fetchTweets, restoreFromCache]);

  useEffect(() => {
    syncTweetCache(tweets);
  }, [tweets]);

  return {
    tweets,
    hasMore,
    isLoadingMore,
    refreshTweets,
    loadMoreTweets,
    feedType,
    setFeedType: handleSetFeedType,
  };
};
