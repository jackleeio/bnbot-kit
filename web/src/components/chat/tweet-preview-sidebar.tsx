'use client';

import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  XMarkIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from '@heroicons/react/24/outline';
import type { TrendTweet } from './tweetDetail';
import TweetCard from './tweetCard';
import MobileTweetDetailCard from './MobileTweetDetailCard';
import { cn } from '@/lib/utils';

interface TweetPreviewSidebarProps {
  tweet: TrendTweet | null;
  onClose: () => void;
  isMobile: boolean;
  className?: string;
}

const TweetPreviewSidebar: React.FC<TweetPreviewSidebarProps> = ({
  tweet,
  onClose,
  isMobile,
  className,
}) => {
  const tweetCollection = useMemo(() => {
    if (!tweet) return [];
    if (tweet.groupTweets && tweet.groupTweets.length > 0) {
      return tweet.groupTweets;
    }
    return [tweet];
  }, [tweet]);

  const [activeIndex, setActiveIndex] = useState(0);
  const [modalHeight, setModalHeight] = useState(55); // Initial height in vh
  const startYRef = React.useRef<number | null>(null);
  const startHeightRef = React.useRef<number>(55);
  const swipeStartXRef = React.useRef<number | null>(null);
  const swipeStartYRef = React.useRef<number | null>(null);

  useEffect(() => {
    setActiveIndex(0);
    setModalHeight(55); // Reset height when tweet changes
  }, [tweet?.id_str, tweet?.groupTweets?.length]);

  const activeTweet = tweetCollection[activeIndex] ?? null;

  const goNext = useCallback(() => {
    setActiveIndex((current) => {
      if (tweetCollection.length === 0) return current;
      return (current + 1) % tweetCollection.length;
    });
  }, [tweetCollection.length]);

  const goPrev = useCallback(() => {
    setActiveIndex((current) => {
      if (tweetCollection.length === 0) return current;
      return (current - 1 + tweetCollection.length) % tweetCollection.length;
    });
  }, [tweetCollection.length]);

  if (!tweet || !activeTweet) {
    return null;
  }

  // Map TrendTweet to Tweet type expected by TweetCard
  const mappedTweet = useMemo(() => {
    if (!activeTweet) return null;
    
    return {
      id_str: activeTweet.id_str,
      created_at: activeTweet.created_at,
      text: activeTweet.text,
      reply_count: activeTweet.reply_count,
      retweet_count: activeTweet.retweet_count,
      like_count: activeTweet.like_count,
      quote_count: activeTweet.quote_count,
      view_count: activeTweet.view_count,
      is_retweet: activeTweet.is_retweet,
      retweeted_status_id: null, // Not present in TrendTweet, assuming null or handle if needed
      is_quote: activeTweet.is_quote,
      quoted_status_id: null, // Not present in TrendTweet
      user: {
        username: activeTweet.author?.username || '',
        twitter_id: activeTweet.author?.twitter_id || '',
        name: activeTweet.author?.name || '',
        avatar: activeTweet.author?.avatar || '',
        description: activeTweet.author?.description || '',
      },
      media: activeTweet.media,
      quoted_tweet: activeTweet.quoted_tweet,
      retweeted_tweet: activeTweet.retweeted_tweet,
    };
  }, [activeTweet]);

  const panel = (
    <div
      className={cn(
        'flex h-full w-full flex-col',
        className,
      )}
    >
      <div className="flex-1 overflow-y-auto px-0 pb-6 pt-0">
        {mappedTweet && (
          <div className={isMobile ? 'w-full' : 'w-3/4'}>
            <TweetCard
              tweet={mappedTweet}
              isMobile={isMobile}
              username={mappedTweet.user.username}
              avatar={mappedTweet.user.avatar}
              name={mappedTweet.user.name}
              disableTruncation
            />
          </div>
        )}
      </div>
    </div>
  );

  // Vertical Drag Logic (Handle)
  const handleHandleTouchStart = (e: React.TouchEvent) => {
    startYRef.current = e.touches[0].clientY;
    startHeightRef.current = modalHeight;
  };

  const handleHandleTouchMove = (e: React.TouchEvent) => {
    if (startYRef.current === null) return;
    const currentY = e.touches[0].clientY;
    const deltaY = startYRef.current - currentY;
    const windowHeight = window.innerHeight;
    const deltaVh = (deltaY / windowHeight) * 100;
    const newHeight = Math.min(Math.max(startHeightRef.current + deltaVh, 40), 95);
    setModalHeight(newHeight);
  };

  const handleHandleTouchEnd = () => {
    startYRef.current = null;
    if (modalHeight > 80) {
      setModalHeight(95);
    } else if (modalHeight < 50) {
      onClose();
    } else {
      setModalHeight(55);
    }
  };

  // Horizontal Swipe Logic (Content)
  const handleContentTouchStart = (e: React.TouchEvent) => {
    swipeStartXRef.current = e.touches[0].clientX;
    swipeStartYRef.current = e.touches[0].clientY;
  };

  const handleContentTouchEnd = (e: React.TouchEvent) => {
    if (swipeStartXRef.current === null || swipeStartYRef.current === null) return;
    
    const endX = e.changedTouches[0].clientX;
    const endY = e.changedTouches[0].clientY;
    const deltaX = endX - swipeStartXRef.current;
    const deltaY = endY - swipeStartYRef.current;

    // Check if horizontal swipe is dominant and long enough
    if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 50) {
      if (deltaX > 0) {
        goPrev();
      } else {
        goNext();
      }
    }

    swipeStartXRef.current = null;
    swipeStartYRef.current = null;
  };

  if (isMobile) {

    return (
      <AnimatePresence>
        <motion.div
          key="tweet-preview-overlay"
          className="fixed inset-0 z-30 bg-black/40"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        />
        <motion.div
          key={activeTweet.id_str}
          initial={{ opacity: 0, y: '100%' }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: '100%' }}
          transition={{ duration: 0.3, ease: [0.32, 0.72, 0, 1] }}
          className="fixed bottom-0 left-0 right-0 z-40 flex w-full flex-col rounded-t-2xl bg-white shadow-2xl"
          style={{ height: `${modalHeight}vh` }}
        >
          {/* Mobile handle bar */}
          <div 
            className="flex w-full flex-col items-center justify-center pt-3 pb-1 touch-none" 
            onTouchStart={handleHandleTouchStart}
            onTouchMove={handleHandleTouchMove}
            onTouchEnd={handleHandleTouchEnd}
          >
             <div className="h-1.5 w-12 rounded-full bg-gray-300/50" />
          </div>

          {/* Header Actions */}
          <div className="flex items-center justify-between px-4 pb-2">
             <div className="w-8" /> {/* Spacer for balance */}
             
             {/* Tweet Count */}
             {tweetCollection.length > 1 && (
               <div className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600">
                 {activeIndex + 1} / {tweetCollection.length}
               </div>
             )}
          </div>

          {/* Content Area with Swipe */}
          <div 
            className="flex-1 overflow-y-auto"
            onTouchStart={handleContentTouchStart}
            onTouchEnd={handleContentTouchEnd}
          >
            <MobileTweetDetailCard
              tweet={mappedTweet!}
              username={activeTweet.author.username}
              name={activeTweet.author.name}
              avatar={activeTweet.author.avatar}
            />
          </div>
        </motion.div>
      </AnimatePresence>
    );
  }

  return panel;
};

export default TweetPreviewSidebar;
