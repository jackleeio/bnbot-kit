// Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
// SPDX-License-Identifier: MIT

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useStickToBottom } from "use-stick-to-bottom";

import { ScrollArea } from "~/components/deep-research/ui/scroll-area";
import { cn } from "~/lib/utils";

export interface ScrollContainerProps {
  className?: string;
  children?: ReactNode;
  scrollShadow?: boolean;
  scrollShadowColor?: string;
  autoScrollToBottom?: boolean;
}

export interface ScrollContainerRef {
  scrollToBottom(): void;
}

export const ScrollContainer = forwardRef<ScrollContainerRef, ScrollContainerProps>(
  (
    {
      className,
      children,
      scrollShadow = true,
      scrollShadowColor = "var(--background)",
      autoScrollToBottom = false,
    },
    forwardedRef,
  ) => {
  const { scrollRef, contentRef, scrollToBottom, isAtBottom } =
    useStickToBottom({ initial: "instant" });
  const [scrollElement, setScrollElement] = useState<HTMLElement | null>(null);
  const [showTopShadow, setShowTopShadow] = useState(false);
  const [showBottomShadow, setShowBottomShadow] = useState(false);
  const handleScrollRef = useCallback(
    (node: HTMLElement | null) => {
      scrollRef.current = node;
      setScrollElement(node);
    },
    [scrollRef],
  );
  useImperativeHandle(
    forwardedRef,
    () => ({
      scrollToBottom() {
        if (isAtBottom) {
          scrollToBottom();
        }
      },
    }),
    [isAtBottom, scrollToBottom],
  );

  const tempScrollRef = useRef<HTMLElement>(null);
  const tempContentRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!autoScrollToBottom) {
      tempScrollRef.current = scrollRef.current;
      tempContentRef.current = contentRef.current;
      scrollRef.current = null;
      contentRef.current = null;
    } else if (tempScrollRef.current && tempContentRef.current) {
      scrollRef.current = tempScrollRef.current;
      contentRef.current = tempContentRef.current;
    }
  }, [autoScrollToBottom, contentRef, scrollRef]);

  const updateScrollShadows = useCallback(() => {
    if (!scrollShadow || !scrollElement) {
      setShowTopShadow(false);
      setShowBottomShadow(false);
      return;
    }
    const { scrollTop, scrollHeight, clientHeight } = scrollElement;
    setShowTopShadow(scrollTop > 2);
    setShowBottomShadow(scrollTop + clientHeight < scrollHeight - 2);
  }, [scrollElement, scrollShadow]);

  useEffect(() => {
    if (!scrollShadow || !scrollElement) {
      return;
    }
    updateScrollShadows();
    const handleScroll = () => {
      updateScrollShadows();
    };
    scrollElement.addEventListener("scroll", handleScroll);
    return () => {
      scrollElement.removeEventListener("scroll", handleScroll);
    };
  }, [scrollElement, scrollShadow, updateScrollShadows]);

  useEffect(() => {
    updateScrollShadows();
  }, [children, autoScrollToBottom, updateScrollShadows]);

  return (
    <div className={cn("relative", className)}>
      {scrollShadow && showTopShadow && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 z-10 h-10"
          style={{
            backgroundImage: `linear-gradient(to bottom, ${scrollShadowColor}, transparent)`,
          }}
        ></div>
      )}
      {scrollShadow && showBottomShadow && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-10"
          style={{
            backgroundImage: `linear-gradient(to top, ${scrollShadowColor}, transparent)`,
          }}
        ></div>
      )}
      <ScrollArea ref={handleScrollRef} className="h-full w-full">
        <div className="h-fit w-full" ref={contentRef}>
          {children}
        </div>
      </ScrollArea>
    </div>
  );
  },
);

ScrollContainer.displayName = "ScrollContainer";
