'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Message } from '@/types/chat';

interface UseScrollBehaviorProps {
  messages: Message[];
  currentAssistantMessage: string;
  currentReasoningContent: string;
}

export const useScrollBehavior = ({
  messages,
  currentAssistantMessage,
  currentReasoningContent,
}: UseScrollBehaviorProps) => {
  const [userHasScrolled, setUserHasScrolledState] = useState(false);
  const userHasScrolledRef = useRef(false);

  const [isToolbarVisible, setIsToolbarVisible] = useState(false);
  const [isMobileChatHeaderVisible, setIsMobileChatHeaderVisible] = useState(false);
  const [lastScrollY, setLastScrollY] = useState(0);
  const lastChatScrollTopRef = useRef(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const reasoningRef = useRef<HTMLDivElement>(null);

  // Helper to update both ref and state
  const setUserHasScrolled = useCallback((value: boolean) => {
    userHasScrolledRef.current = value;
    setUserHasScrolledState(value);
  }, []);

  // Scroll to bottom
  const scrollToBottom = useCallback((force = false) => {
    if (messagesEndRef.current) {
      // If forcing, just scroll
      if (force) {
        messagesEndRef.current.scrollIntoView({
          behavior: 'smooth',
        });
        return;
      }

      // If not forcing, check if we should scroll based on current position
      // We check the parent element's scroll position
      const container = messagesEndRef.current.parentElement;
      if (container) {
        const { scrollTop, scrollHeight, clientHeight } = container;
        const isNearBottom = scrollHeight - scrollTop - clientHeight < 50; // 50px threshold

        // Only scroll if user hasn't manually scrolled up AND is currently near bottom
        if (!userHasScrolledRef.current && isNearBottom) {
          messagesEndRef.current.scrollIntoView({
            behavior: 'smooth',
          });
        }
      }
    }
  }, []);

  const lastScrollTopRef = useRef(0);

  // Handle chat scroll
  const handleChatScroll = useCallback((e: React.UIEvent<HTMLDivElement>, hasMessages = false) => {
    const target = e.target as HTMLDivElement;
    const { scrollTop, scrollHeight, clientHeight } = target;

    const isScrolledToBottom =
      Math.abs(scrollHeight - scrollTop - clientHeight) < 20; // Tighten threshold to 20px

    // Check if user is scrolling up
    const isScrollingUp = scrollTop < lastScrollTopRef.current;
    const scrollDifference = Math.abs(scrollTop - lastChatScrollTopRef.current);

    // Mobile chat header visibility logic
    if (hasMessages && scrollDifference > 10) {
      if (isScrollingUp && scrollTop > 50) {
        // Scrolling up and has scrolled down enough, show header
        setIsMobileChatHeaderVisible(true);
      } else if (!isScrollingUp && scrollTop > 50) {
        // Scrolling down, hide header
        setIsMobileChatHeaderVisible(false);
      } else if (scrollTop <= 50) {
        // Near top, hide header
        setIsMobileChatHeaderVisible(false);
      }
      lastChatScrollTopRef.current = scrollTop;
    }

    lastScrollTopRef.current = scrollTop;

    // If user scrolls up OR is not at bottom, mark as scrolled
    if (isScrollingUp || !isScrolledToBottom) {
      // If scrolling up, ALWAYS mark as scrolled immediately
      if (isScrollingUp) {
        userHasScrolledRef.current = true;
        setUserHasScrolledState(true);
      } else if (!isScrolledToBottom) {
        // If just not at bottom (but maybe stationary or scrolling down slowly), also mark
        userHasScrolledRef.current = true;
        setUserHasScrolledState(true);
      }
    } else {
      // Only reset if we are truly at the bottom
      userHasScrolledRef.current = false;
      setUserHasScrolledState(false);
    }
  }, []);

  // Handle right panel scroll (for toolbar visibility and load more)
  const handleRightPanelScroll = useCallback((
    e: React.UIEvent<HTMLDivElement>,
    hasMore: boolean,
    isLoadingMore: boolean,
    onLoadMore: () => void,
  ) => {
    const target = e.target as HTMLDivElement;
    const { scrollTop, scrollHeight, clientHeight } = target;

    // Toolbar show/hide logic
    const currentScrollY = scrollTop;
    const scrollDifference = Math.abs(currentScrollY - lastScrollY);

    // Only trigger change when scroll distance exceeds 10px to avoid frequent switching
    if (scrollDifference > 10) {
      if (currentScrollY > lastScrollY && currentScrollY > 50) {
        // Scrolling down and scroll distance exceeds 50px, hide toolbar
        setIsToolbarVisible(false);
      } else if (currentScrollY < lastScrollY) {
        // Scrolling up, show toolbar
        setIsToolbarVisible(true);
      }
      setLastScrollY(currentScrollY);
    }

    // Check if near bottom (one screen height away)
    const isNearBottom = scrollHeight - scrollTop - clientHeight < clientHeight;

    // If near bottom and has more data and not loading, load more
    if (isNearBottom && hasMore && !isLoadingMore) {
      onLoadMore();
    }
  }, [lastScrollY]);

  // Auto-scroll when new messages arrive
  useEffect(() => {
    if (messages.length > 0 || currentAssistantMessage || currentReasoningContent) {
      setTimeout(() => {
        scrollToBottom();
      }, 100);
    }
  }, [messages, currentAssistantMessage, currentReasoningContent, scrollToBottom]);

  // Auto-scroll reasoning content to bottom when it updates
  useEffect(() => {
    if (currentReasoningContent && reasoningRef.current) {
      const reasoningElement = reasoningRef.current;
      // Smooth scroll to bottom of reasoning content
      reasoningElement.scrollTo({
        top: reasoningElement.scrollHeight,
        behavior: 'smooth',
      });

      // Also ensure main chat container scrolls to latest message
      // But respect user scroll state (don't force it)
      setTimeout(() => {
        scrollToBottom();
      }, 150);
    }
  }, [currentReasoningContent, scrollToBottom]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const handleViewportChange = () => {
      if (window.innerWidth >= 768) {
        setIsToolbarVisible(true);
      }
    };

    // Initial check
    handleViewportChange();

    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('orientationchange', handleViewportChange);

    return () => {
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('orientationchange', handleViewportChange);
    };
  }, []);

  return {
    userHasScrolled,
    isToolbarVisible,
    setIsToolbarVisible,
    isMobileChatHeaderVisible,
    setIsMobileChatHeaderVisible,
    messagesEndRef,
    reasoningRef,
    scrollToBottom,
    handleChatScroll,
    handleRightPanelScroll,
    setUserHasScrolled,
  };
};
