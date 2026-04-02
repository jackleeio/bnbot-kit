'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { TweetComment, TweetCommentsResponse } from '@/types';

export const useTweetComments = (tweetId: string) => {
  const [comments, setComments] = useState<TweetComment[]>([]);
  const [cursor, setCursor] = useState<string | null>('cursor');
  const [hasMore, setHasMore] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isLoadingRef = useRef(false);
  const currentTweetIdRef = useRef<string>(''); // 跟踪当前的 tweetId

  // Fetch comments from API
  const fetchComments = useCallback(async (newCursor?: string | null) => {
    if (!tweetId) return;

    // 防止重复请求
    if (isLoadingRef.current) {
      console.log('Already loading, skipping request');
      return;
    }

    try {
      isLoadingRef.current = true;
      setIsLoading(true);
      setError(null);

      // Build URL with query parameters
      const params = new URLSearchParams({
        tweet_id: tweetId,
      });

      if (newCursor && newCursor !== 'cursor') {
        params.append('cursor', newCursor);
      }

      const url = `${process.env.NEXT_PUBLIC_REST_API_ENDPOINT}/api/v1/x-public/tweet-comments?${params.toString()}`;
      const apiKey = process.env.NEXT_PUBLIC_X_PUBLIC_API_KEY || '3EgYj96J1IkrU03Azf2MZnE0Jnf7imYabJlS-DRrOL8';

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'x-public-key': apiKey,
        },
      }).catch(err => {
        console.error('Fetch network error:', err);
        throw err;
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Fetch comments error:', response.status, response.statusText, errorText);
        setError(`Failed to fetch comments: ${response.status} ${response.statusText}`);
        return;
      }

      const data: TweetCommentsResponse = await response.json();

      if (data.code === 1) {
        // 如果返回的数据为空，设置 hasMore 为 false
        if (!data.data || data.data.length === 0) {
          setHasMore(false);
          return;
        }

        setComments((prev) => {
          if (newCursor === 'cursor') {
            // 初次加载，直接返回新数据
            return data.data;
          }
          // 加载更多时，去重后追加
          const existingIds = new Set(prev.map(c => c.tweet_id));
          const newComments = data.data.filter(c => !existingIds.has(c.tweet_id));
          return [...prev, ...newComments];
        });

        // 如果没有 cursor 或 cursor 为空字符串，表示没有更多数据
        setCursor(data.cursor);
        setHasMore(!!data.cursor && data.cursor !== '');
      } else {
        // code 不为 1，表示请求失败或没有更多数据
        setHasMore(false);
        if (data.msg) {
          setError(data.msg);
        }
      }
    } catch (error) {
      console.error('Error fetching comments:', error);
      setError('An error occurred while fetching comments');
    } finally {
      setIsLoading(false);
      isLoadingRef.current = false; // 请求完成后重置标记
    }
  }, [tweetId]);

  // Load more comments (pagination)
  const loadMoreComments = useCallback(() => {
    if (hasMore && !isLoading && cursor) {
      fetchComments(cursor);
    }
  }, [cursor, hasMore, isLoading, fetchComments]);

  // Initial fetch
  useEffect(() => {
    // 检查是否是新的 tweetId
    if (tweetId && tweetId !== currentTweetIdRef.current) {
      currentTweetIdRef.current = tweetId;

      // 重置所有状态
      setComments([]);
      setCursor('cursor');
      setHasMore(true);
      setError(null);
      isLoadingRef.current = false;

      // 加载评论
      fetchComments('cursor');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tweetId]);

  return {
    comments,
    hasMore,
    isLoading,
    error,
    loadMoreComments,
  };
};
