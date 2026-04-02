'use client';

import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
  useLayoutEffect,
} from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowRightCircleIcon } from '@heroicons/react/24/outline';
import { CheckBadgeIcon } from '@heroicons/react/24/solid';
import MemeTokenCard from './MemeTokenCard';
import ChatTable from './ChatTable';
import { formatChatContent, formatToolName, parseMarkdownTable } from '@/utils/chatFormatters';
import 'katex/dist/katex.min.css';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneLight } from 'react-syntax-highlighter/dist/cjs/styles/prism';
import type { ToolCallInfo, ToolStatus } from '@/types/chat';
import type { TrendTweet } from './tweetDetail';
import type { TweetInfoResponse } from '@/types';
import bnbotAI from '@/assets/images/logo/bnbot-ai.jpg';
import { parseInlineToolCallSegments, ParsedInlineToolCall } from '@/utils/inlineToolCalls';

const FALLBACK_AVATAR =
  typeof bnbotAI === 'string' ? bnbotAI : (bnbotAI as { src: string }).src;

const extractMediaFromLegacy = (legacyMedia: any[]): TrendTweet['media'] => {
  if (!Array.isArray(legacyMedia) || legacyMedia.length === 0) {
    return null;
  }

  return legacyMedia.map((item) => {
    if (item.type === 'video') {
      const variants = Array.isArray(item.video_info?.variants)
        ? item.video_info.variants.filter((variant: any) => variant.content_type === 'video/mp4')
        : [];
      const sorted = variants.sort(
        (a: any, b: any) => (b.bitrate ?? 0) - (a.bitrate ?? 0),
      );
      const bestVariant = sorted[0];

      return {
        type: 'video' as const,
        url: (bestVariant?.url || item.media_url_https || item.url || '') as string,
        thumbnail: (item.media_url_https || '') as string,
      };
    }

    return {
      type: (item.type || 'photo') as 'photo' | 'video',
      url: (item.media_url_https || item.url || '') as string,
      thumbnail: (item.media_url_https || item.url || '') as string,
    };
  });
};

const extractQuotedTweet = (legacy: any): TrendTweet['quoted_tweet'] => {
  const quotedResult = legacy?.quoted_status_result?.result;
  if (!quotedResult) return null;

  const quotedLegacy = quotedResult.legacy;
  const quotedUser = quotedResult.core?.user_results?.result?.legacy;

  if (!quotedLegacy) return null;

  return {
    id_str: quotedLegacy.id_str ?? '',
    text: quotedLegacy.full_text ?? quotedLegacy.text ?? '',
    created_at: quotedLegacy.created_at ?? '',
    user: {
      name: quotedUser?.name ?? '',
      username: quotedUser?.screen_name ?? '',
      avatar: quotedUser?.profile_image_url_https ?? FALLBACK_AVATAR,
      description: (quotedUser as { description?: string })?.description ?? '',
    },
  };
};

const extractRetweetedTweet = (legacy: any): TrendTweet['retweeted_tweet'] => {
  const retweetedResult = legacy?.retweeted_status_result?.result;
  if (!retweetedResult) return null;
  const retweetedLegacy = retweetedResult.legacy;
  const retweetedUser = retweetedResult.core?.user_results?.result?.legacy;
  if (!retweetedLegacy) return null;

  return {
    text: retweetedLegacy.full_text ?? retweetedLegacy.text ?? '',
    username: retweetedUser?.screen_name ?? '',
  };
};

const convertPublicTweetDataToTrendTweet = (tweetData: any): TrendTweet | null => {
  if (!tweetData || typeof tweetData !== 'object') return null;

  const id =
    tweetData.id_str ??
    tweetData.tweet_id ??
    tweetData.id ??
    tweetData.rest_id ??
    '';
  if (!id) return null;

  const text = tweetData.full_text ?? tweetData.text ?? '';
  const author = tweetData.author ?? tweetData.user ?? {};

  const authorAvatar =
    author.avatar ??
    author.avatar_url ??
    author.profile_image_url ??
    author.profile_image_url_https ??
    FALLBACK_AVATAR;

  const mediaSource =
    tweetData.media ??
    tweetData.extended_entities?.media ??
    tweetData.legacy?.extended_entities?.media;

  const media = Array.isArray(mediaSource)
    ? mediaSource
        .map((item: any) => {
          if (!item) return null;
          if (item.type === 'video') {
            const variants = Array.isArray(item.variants)
              ? item.variants
              : Array.isArray(item.video_info?.variants)
                ? item.video_info.variants
                : [];
            const playable = variants.filter(
              (variant: any) => variant?.content_type === 'video/mp4',
            );
            const best = playable.sort(
              (a: any, b: any) => (b?.bitrate ?? 0) - (a?.bitrate ?? 0),
            )[0];

            return {
              type: 'video' as const,
              url:
                best?.url ??
                item.url ??
                item.media_url ??
                item.media_url_https ??
                '',
              thumbnail:
                item.thumbnail ??
                item.preview_image_url ??
                item.media_url ??
                item.media_url_https,
            };
          }

          const imageUrl =
            item.url ?? item.media_url ?? item.media_url_https ?? '';
          if (!imageUrl) return null;
          return {
            type: (item.type || 'photo') as 'photo' | 'video',
            url: imageUrl,
            thumbnail:
              item.thumbnail ??
              item.media_url ??
              item.media_url_https ??
              imageUrl,
          };
        })
        .filter(Boolean) as TrendTweet['media']
    : null;

  const quoted =
    tweetData.quoted_tweet ??
    tweetData.quoted_status ??
    tweetData.quoted_status_result;

  const quotedLegacy =
    quoted?.legacy ??
    quoted?.result?.legacy ??
    (typeof quoted === 'object' ? quoted : null);

  const quotedUserLegacy =
    quoted?.core?.user_results?.result?.legacy ??
    quoted?.user ??
    quoted?.author ??
    quoted?.user_results?.result?.legacy;

  const quotedProfile =
    quotedUserLegacy ??
    quotedLegacy?.user ??
    quotedLegacy?.author ??
    (quotedLegacy && typeof quotedLegacy === 'object' ? quotedLegacy : null);

  const retweeted =
    tweetData.retweeted_tweet ??
    tweetData.retweeted_status ??
    tweetData.retweeted_status_result?.result;

  const quotedName =
    quotedProfile?.name ?? quotedLegacy?.name ?? quotedLegacy?.user?.name ?? '';
  const quotedUsername =
    quotedProfile?.screen_name ??
    quotedProfile?.username ??
    quotedLegacy?.username ??
    quotedLegacy?.user?.username ??
    quotedLegacy?.author?.username ??
    '';
  const quotedAvatar =
    quotedProfile?.profile_image_url_https ??
    quotedProfile?.profile_image_url ??
    quotedProfile?.avatar ??
    quotedProfile?.avatar_url ??
    quotedLegacy?.profile_image_url ??
    quotedLegacy?.profile_image_url_https ??
    quotedLegacy?.user?.avatar ??
    quotedLegacy?.user?.avatar_url ??
    FALLBACK_AVATAR;
  const quotedVerified = Boolean(
    quotedProfile?.is_blue_verified ??
      quotedProfile?.verified ??
      quotedLegacy?.is_blue_verified ??
      quotedLegacy?.verified ??
      quotedLegacy?.user?.is_blue_verified,
  );

  return {
    id_str: id.toString(),
    created_at: tweetData.created_at ?? '',
    text,
    reply_count: tweetData.reply_count ?? tweetData.metrics?.reply_count ?? 0,
    retweet_count:
      tweetData.retweet_count ?? tweetData.metrics?.retweet_count ?? 0,
    like_count: tweetData.like_count ?? tweetData.metrics?.like_count ?? 0,
    quote_count: tweetData.quote_count ?? tweetData.metrics?.quote_count ?? 0,
    view_count: String(
      tweetData.view_count ??
        tweetData.metrics?.view_count ??
        tweetData.views_count ??
        tweetData.views?.count ??
        0,
    ),
    is_retweet: Boolean(
      tweetData.is_retweet ??
        tweetData.retweeted ??
        tweetData.retweeted_status_id ??
        tweetData.retweeted_status_id_str,
    ),
    retweeted_status_id:
      tweetData.retweeted_status_id_str ??
      tweetData.retweeted_status_id ??
      tweetData.retweeted_status?.id_str ??
      tweetData.retweeted_status?.id ??
      null,
    is_quote: Boolean(
      tweetData.is_quote ??
        tweetData.is_quote_status ??
        tweetData.quoted_status_id ??
        tweetData.quoted_status_id_str ??
        quoted,
    ),
    quoted_status_id:
      tweetData.quoted_status_id_str ??
      tweetData.quoted_status_id ??
      quotedLegacy?.id_str ??
      quotedLegacy?.id ??
      null,
    author: {
      username:
        author.username ??
        author.screen_name ??
        author.twitter_id ??
        author.handle ??
        '',
      twitter_id:
        author.twitter_id ??
        author.id_str ??
        author.id ??
        author.rest_id ??
        '',
      name: author.name ?? '',
      avatar: authorAvatar,
      description: author.description ?? '',
    },
    media: media && media.length > 0 ? media : null,
    quoted_tweet: quotedLegacy
      ? {
          id_str: quotedLegacy.id_str ?? quotedLegacy.id ?? '',
          text: quotedLegacy.full_text ?? quotedLegacy.text ?? '',
          created_at: quotedLegacy.created_at ?? '',
          user: {
            name: quotedName,
            username: quotedUsername,
            avatar: quotedAvatar,
            is_blue_verified: quotedVerified,
            description: quotedProfile?.description ?? quotedLegacy?.description ?? '',
          },
        }
      : null,
    retweeted_tweet: retweeted
      ? {
          text:
            retweeted.full_text ??
            retweeted.text ??
            retweeted.legacy?.full_text ??
            retweeted.legacy?.text ??
            '',
          username:
            retweeted.core?.user_results?.result?.legacy?.screen_name ??
            retweeted.user?.username ??
            '',
        }
      : null,
  };
};

const convertCachedTweetDataToTrendTweet = (data: any): TrendTweet | null => {
  if (!data || !data.id_str) {
    return null;
  }

  const normalizeUser = (user: any = {}) => ({
    username: user.username || user.screen_name || '',
    twitter_id: user.twitter_id || user.id_str || '',
    name: user.name || user.username || '',
    avatar:
      user.avatar ||
      user.profile_image ||
      user.profile_image_url ||
      user.profile_image_url_https ||
      FALLBACK_AVATAR,
    description: user.description || '',
  });

  const normalizeMedia = (mediaItem: any) => ({
    type: (mediaItem?.type || mediaItem?.media_type || 'photo') as 'photo' | 'video',
    url:
      mediaItem?.url ||
      mediaItem?.media_url ||
      mediaItem?.media_url_https ||
      '',
    thumbnail:
      mediaItem?.thumbnail ||
      mediaItem?.media_url ||
      mediaItem?.media_url_https ||
      undefined,
  });

  const quoted =
    data.quoted_tweet && data.quoted_tweet.id_str
      ? {
          id_str: data.quoted_tweet.id_str,
          text: data.quoted_tweet.text || '',
          created_at: data.quoted_tweet.created_at || '',
          user: normalizeUser(data.quoted_tweet.user),
        }
      : null;

  return {
    id_str: data.id_str,
    created_at: data.created_at || '',
    text: data.text || '',
    reply_count: Number(data.reply_count ?? 0),
    retweet_count: Number(data.retweet_count ?? 0),
    like_count: Number(data.like_count ?? 0),
    quote_count: Number(data.quote_count ?? 0),
    view_count: String(data.view_count ?? data.favorite_count ?? 0),
    is_retweet: Boolean(data.is_retweet),
    retweeted_status_id: data.retweeted_tweet?.id_str || null,
    is_quote: Boolean(data.is_quote),
    quoted_status_id: data.quoted_tweet?.id_str || null,
    author: normalizeUser(data.user || data.author),
    media: Array.isArray(data.media) ? data.media.map(normalizeMedia) : null,
    quoted_tweet: quoted,
    retweeted_tweet: data.retweeted_tweet
      ? {
          text: data.retweeted_tweet.text || '',
          username:
            data.retweeted_tweet.username ||
            data.retweeted_tweet.user?.username ||
            data.retweeted_tweet.user?.screen_name ||
            '',
        }
      : null,
  };
};

export const convertTweetInfoResponseToTrendTweet = (
  response: TweetInfoResponse | Record<string, any>,
): TrendTweet | null => {
  const safeResponse = response as any;
  const tweetResult =
    safeResponse?.data?.data?.tweetResult?.result ??
    safeResponse?.data?.tweetResult?.result ??
    safeResponse?.tweetResult?.result;
  if (tweetResult) {
    const legacy = tweetResult.legacy;
    const userLegacy = tweetResult.core?.user_results?.result?.legacy;
    const userRestId = tweetResult.core?.user_results?.result?.rest_id;

    if (!legacy || !userLegacy) return null;

    const mediaEntities = legacy.extended_entities?.media;

    const safeLegacy = legacy ?? {};
    const safeUserLegacy = userLegacy ?? {};
    const viewsCount =
      tweetResult.views?.count ?? (safeLegacy as any)?.views?.count ?? 0;
    const retweetedStatusId =
      safeLegacy.retweeted_status_id_str ??
      safeLegacy.retweeted_status_result?.result?.legacy?.id_str ??
      null;
    const quotedStatusId =
      safeLegacy.quoted_status_id_str ??
      safeLegacy.quoted_status_result?.result?.legacy?.id_str ??
      null;

    return {
      id_str: safeLegacy.id_str ?? '',
      created_at: safeLegacy.created_at ?? '',
      text: safeLegacy.full_text ?? safeLegacy.text ?? '',
      reply_count: safeLegacy.reply_count ?? 0,
      retweet_count: safeLegacy.retweet_count ?? 0,
      like_count: safeLegacy.favorite_count ?? 0,
      quote_count: safeLegacy.quote_count ?? 0,
      view_count: `${viewsCount ?? 0}`,
      is_retweet: safeLegacy.retweeted ?? false,
      retweeted_status_id: retweetedStatusId,
      is_quote: safeLegacy.is_quote_status ?? false,
      quoted_status_id: quotedStatusId,
      author: {
        username: safeUserLegacy.screen_name ?? '',
        twitter_id: userRestId ?? safeUserLegacy.screen_name ?? '',
        name: safeUserLegacy.name ?? '',
        avatar: safeUserLegacy.profile_image_url_https ?? FALLBACK_AVATAR,
        description:
          (safeUserLegacy as { description?: string })?.description ?? '',
      },
      media: Array.isArray(mediaEntities)
        ? extractMediaFromLegacy(mediaEntities)
        : null,
      quoted_tweet: extractQuotedTweet(safeLegacy),
      retweeted_tweet: extractRetweetedTweet(safeLegacy),
    };
  }

  const publicDataCandidate =
    safeResponse?.data?.data ??
    safeResponse?.data ??
    safeResponse?.tweet ??
    (safeResponse?.id_str ? safeResponse : null);

  if (
    publicDataCandidate &&
    typeof publicDataCandidate === 'object' &&
    !Array.isArray(publicDataCandidate)
  ) {
    const directData =
      'tweet_id' in publicDataCandidate ||
      'id_str' in publicDataCandidate ||
      'id' in publicDataCandidate
        ? publicDataCandidate
        : publicDataCandidate.tweet ??
          publicDataCandidate.tweetInfo ??
          null;

    if (directData) {
      return convertPublicTweetDataToTrendTweet(directData);
    }
  }

  return null;
};

interface MessageContentProps {
  content: string;
  isStreaming?: boolean;
  onTweetReferenceSelect?: (tweetIds: string[]) => void | Promise<void>;
  isTweetReferenceLoading?: (idsKey: string) => boolean;
  toolCallsInfo?: ToolCallInfo[];
}

interface KolProfile {
  username?: string;
  twitter_id?: string;
  name?: string;
  avatar?: string;
  banner?: string;
  is_verified?: boolean;
  followers_count?: number;
  following_count?: number;
  description?: string;
  is_monitoring?: boolean;
}

const formatCompactNumber = (value?: number) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '--';
  }

  try {
    return new Intl.NumberFormat('en-US', {
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(value);
  } catch (_error) {
    return value.toLocaleString();
  }
};

const escapeCssAttrValue = (value: string) => {
  if (
    typeof window !== 'undefined' &&
    typeof window.CSS !== 'undefined' &&
    typeof window.CSS.escape === 'function'
  ) {
    return window.CSS.escape(value);
  }

  return value.replace(/["\\\]\[]/g, '\\$&');
};

type HoverPlacement = 'top' | 'bottom' | 'left' | 'right';

const MessageContent: React.FC<MessageContentProps> = ({
  content,
  isStreaming = false,
  onTweetReferenceSelect,
  isTweetReferenceLoading,
  toolCallsInfo,
}) => {
  // Typewriter effect for streaming - optimized for smooth display
  const [displayedContent, setDisplayedContent] = useState(content);
  const [currentIndex, setCurrentIndex] = useState(content.length);
  const previousContentRef = useRef(content);
  const targetContentRef = useRef(content);
  const isAnimatingRef = useRef(false);
  const wasStreamingRef = useRef(isStreaming);

  // Track target content separately so animation continues even after streaming stops
  useEffect(() => {
    targetContentRef.current = content;
  }, [content]);

  useEffect(() => {
    // When streaming ends, immediately sync content without animation to prevent flicker
    if (wasStreamingRef.current && !isStreaming) {
      setDisplayedContent(content);
      setCurrentIndex(content.length);
      isAnimatingRef.current = false;
      wasStreamingRef.current = false;
      previousContentRef.current = content;
      return;
    }
    wasStreamingRef.current = isStreaming;

    // If not streaming, always show full content immediately
    if (!isStreaming) {
      if (displayedContent !== content) {
        setDisplayedContent(content);
        setCurrentIndex(content.length);
      }
      return;
    }

    // If content got shorter (replaced/reset), reset immediately
    if (content.length < previousContentRef.current.length) {
      setDisplayedContent('');
      setCurrentIndex(0);
      isAnimatingRef.current = true;
    }
    previousContentRef.current = content;

    // If we're already caught up, no animation needed
    if (currentIndex >= content.length) {
      isAnimatingRef.current = false;
      return;
    }

    // Start or continue animation
    isAnimatingRef.current = true;

    const timer = setTimeout(() => {
      const targetContent = targetContentRef.current;
      // Add 8-12 characters at a time for smooth, natural flow
      const charsToAdd = Math.random() < 0.3 ? 12 : 8;
      const nextIndex = Math.min(currentIndex + charsToAdd, targetContent.length);
      setDisplayedContent(targetContent.slice(0, nextIndex));
      setCurrentIndex(nextIndex);
    }, 30); // 30ms delay for better smoothness

    return () => clearTimeout(timer);
  }, [content, currentIndex, displayedContent, isStreaming]);

  const [hiddenTools, setHiddenTools] = useState<Set<string>>(new Set());
  const processedToolsRef = useRef<Set<string>>(new Set());
  const [hoveredUser, setHoveredUser] = useState<string | null>(null);
  const [kolProfile, setKolProfile] = useState<KolProfile | null>(null);
  const [kolLoading, setKolLoading] = useState(false);
  const [kolError, setKolError] = useState<string | null>(null);
  const kolCacheRef = useRef<Record<string, KolProfile>>({});
  const kolAbortControllerRef = useRef<AbortController | null>(null);
  const kolFetchTimeoutRef = useRef<number | null>(null);
  const [mousePosition, setMousePosition] = useState({ x: -9999, y: -9999 });
  const [hoverCardPlacement, setHoverCardPlacement] = useState<HoverPlacement>('top');
  const [arrowOffset, setArrowOffset] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const hoverCardRef = useRef<HTMLDivElement | null>(null);
  const hoveredElementRef = useRef<HTMLElement | null>(null);
  const pointerPositionRef = useRef({ x: -1, y: -1 });
  const cardDimensionsRef = useRef({ width: 292, height: 192 });
  const [isMounted, setIsMounted] = useState(false);
  const hoveredUsernameRef = useRef<string | null>(null);

  const resolveMentionElement = useCallback(
    (element?: HTMLElement | null) => {
      if (typeof document === 'undefined') {
        return null;
      }

      const activeElement = element ?? hoveredElementRef.current;
      if (activeElement && activeElement.isConnected) {
        return activeElement;
      }

      const { x, y } = pointerPositionRef.current;
      if (x >= 0 && y >= 0) {
        const elementAtPoint = document
          .elementFromPoint(x, y)
          ?.closest('.mention-user') as HTMLElement | null;

        if (elementAtPoint && elementAtPoint.isConnected) {
          hoveredElementRef.current = elementAtPoint;
          return elementAtPoint;
        }
      }

      const username = hoveredUsernameRef.current;
      if (!username) {
        return null;
      }

      const selector = `.mention-user[data-username="${escapeCssAttrValue(username)}"]`;
      const scope = containerRef.current ?? document;
      const candidates = Array.from(
        scope.querySelectorAll<HTMLElement>(selector),
      );

      if (candidates.length === 1) {
        hoveredElementRef.current = candidates[0];
        return candidates[0];
      }

      if (candidates.length > 1 && x >= 0 && y >= 0) {
        const matched = candidates.find((node) => {
          const rect = node.getBoundingClientRect();
          return (
            x >= rect.left &&
            x <= rect.right &&
            y >= rect.top &&
            y <= rect.bottom
          );
        });

        if (matched) {
          hoveredElementRef.current = matched;
          return matched;
        }
      }

      if (candidates.length > 0) {
        hoveredElementRef.current = candidates[0];
        return candidates[0];
      }

      return null;
    },
    [],
  );

  const updateCardPosition = useCallback(
    (element?: HTMLElement | null) => {
      if (typeof window === 'undefined') return;
      const targetElement = resolveMentionElement(element ?? null);
      if (!targetElement) {
        return;
      }

      const rect = targetElement.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const padding = 24;
      const gap = 12;
      const dims = cardDimensionsRef.current;
      const width = dims.width || 292;
      const height = dims.height || 192;
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;

      const spaceTop = rect.top - padding;
      const spaceBottom = viewportHeight - rect.bottom - padding;
      const spaceLeft = rect.left - padding;
      const spaceRight = viewportWidth - rect.right - padding;

      const fitsTop = spaceTop >= height + gap;
      const fitsBottom = spaceBottom >= height + gap;
      const fitsLeft = spaceLeft >= width + gap;
      const fitsRight = spaceRight >= width + gap;

      let placement: HoverPlacement;

      if (fitsTop) {
        placement = 'top';
      } else if (fitsBottom) {
        placement = 'bottom';
      } else if (fitsRight) {
        placement = 'right';
      } else if (fitsLeft) {
        placement = 'left';
      } else {
        const spaces = [
          { type: 'top' as HoverPlacement, value: spaceTop },
          { type: 'bottom' as HoverPlacement, value: spaceBottom },
          { type: 'left' as HoverPlacement, value: spaceLeft },
          { type: 'right' as HoverPlacement, value: spaceRight },
        ];
        placement = spaces.reduce((acc, cur) => (cur.value > acc.value ? cur : acc)).type;
      }

      let left = rect.left;
      let top = rect.top;
      let arrow = 0;

      const clampRange = (value: number, min: number, max: number) => {
        if (max <= min) {
          return (min + max) / 2;
        }
        return Math.min(Math.max(value, min), max);
      };

      const clampHorizontal = (value: number) => {
        const min = padding;
        const max = viewportWidth - width - padding;
        if (max <= min) {
          return Math.max((viewportWidth - width) / 2, padding / 2);
        }
        return clampRange(value, min, max);
      };

      const clampVertical = (value: number) => {
        const min = padding;
        const max = viewportHeight - height - padding;
        if (max <= min) {
          return Math.max((viewportHeight - height) / 2, padding / 2);
        }
        return clampRange(value, min, max);
      };

      switch (placement) {
        case 'top': {
          top = rect.top - height - gap;
          left = centerX - width / 2;
          left = clampHorizontal(left);
          top = clampVertical(top);
          arrow = clampRange(centerX - left, 12, width - 12);
          break;
        }
      case 'bottom': {
        top = rect.bottom + gap;
        left = centerX - width / 2;
        left = clampHorizontal(left);
        top = clampVertical(top);
        arrow = clampRange(centerX - left, 12, width - 12);
        break;
      }
      case 'right': {
        left = rect.right + gap;
        left = clampHorizontal(left);
        top = centerY - height / 2;
        top = clampVertical(top);
        arrow = clampRange(centerY - top, 12, height - 12);
        break;
      }
      case 'left': {
        left = rect.left - width - gap;
        left = clampHorizontal(left);
        top = centerY - height / 2;
        top = clampVertical(top);
        arrow = clampRange(centerY - top, 12, height - 12);
        break;
      }
      default:
        break;
    }

      hoveredElementRef.current = targetElement;

      setMousePosition({ x: Math.round(left), y: Math.round(top) });
      setHoverCardPlacement(placement);
      setArrowOffset(arrow);
    },
    [resolveMentionElement],
  );

  // Handle tool result processing
  const handleToolResult = useCallback((toolName: string) => {
    if (!processedToolsRef.current.has(toolName)) {
      processedToolsRef.current.add(toolName);
      setHiddenTools((prev) => new Set(Array.from(prev).concat([toolName])));
    }
  }, []);

  // Handle @username hover events
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      // Hover card disabled - no need to track mouse position
    };

    const handleScroll = () => {
      // Hover card disabled
    };

    const handleResize = () => {
      // Hover card disabled
    };

    const handleMentionClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const mentionElement = target?.closest('.mention-user') as HTMLElement | null;

      if (mentionElement) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        const username = mentionElement.getAttribute('data-username');
        if (username) {
          window.open(`https://x.com/${username}`, '_blank', 'noopener,noreferrer');
        }
      }
    };

    const container = containerRef.current;
    if (!container) {
      return undefined;
    }

    container.addEventListener('click', handleMentionClick);

    return () => {
      container.removeEventListener('click', handleMentionClick);
    };
  }, []);

  useEffect(() => {
    setIsMounted(true);
    return () => {
      setIsMounted(false);
    };
  }, []);

  useEffect(() => {
    if (hoveredUser) {
      hoveredUsernameRef.current = hoveredUser;
    }

    if (!hoveredUser) {
      hoveredUsernameRef.current = null;
      hoveredElementRef.current = null;
      pointerPositionRef.current = { x: -1, y: -1 };
      setKolProfile(null);
      setKolLoading(false);
      setKolError(null);
      setHoverCardPlacement('top');
      setArrowOffset(0);
      setMousePosition({ x: -9999, y: -9999 });
      if (kolFetchTimeoutRef.current) {
        window.clearTimeout(kolFetchTimeoutRef.current);
        kolFetchTimeoutRef.current = null;
      }
      if (kolAbortControllerRef.current) {
        kolAbortControllerRef.current.abort();
        kolAbortControllerRef.current = null;
      }
      return;
    }

    const cacheKey = hoveredUser.toLowerCase();
    const cachedProfile = kolCacheRef.current[cacheKey];

    if (cachedProfile) {
      setKolProfile(cachedProfile);
      setKolLoading(false);
      setKolError(null);
      return;
    }

    const baseUrl = process.env.NEXT_PUBLIC_REST_API_ENDPOINT;
    const apiKey = process.env.NEXT_PUBLIC_X_PUBLIC_API_KEY;

    if (!baseUrl || !apiKey) {
      setKolProfile(null);
      setKolLoading(false);
      setKolError('未配置资料服务');
      return;
    }

    const controller = new AbortController();
    kolAbortControllerRef.current?.abort();
    kolAbortControllerRef.current = controller;

    setKolLoading(true);
    setKolError(null);
    setKolProfile(null);

    if (kolFetchTimeoutRef.current) {
      window.clearTimeout(kolFetchTimeoutRef.current);
    }

    const fetchKolProfile = async () => {
      try {
        const response = await fetch(
          `${baseUrl}/api/v1/x-public/kol-info/${encodeURIComponent(hoveredUser)}`,
          {
            headers: {
              'Content-Type': 'application/json',
              'x-public-key': apiKey,
            },
            signal: controller.signal,
          },
        );

        if (!response.ok) {
          throw new Error(`Failed with status ${response.status}`);
        }

        const json = await response.json();
        const profile: KolProfile | null = json?.data ?? null;

        if (controller.signal.aborted) {
          return;
        }

        if (profile) {
          const sanitizedDescription =
            typeof profile.description === 'string'
              ? profile.description
                  .replace(/https?:\/\/\S+/g, '')
                  .replace(/\s+/g, ' ')
                  .trim()
              : undefined;

          const sanitizedProfile: KolProfile = {
            ...profile,
            username: profile.username ?? hoveredUser,
            description: sanitizedDescription || undefined,
          };
          kolCacheRef.current[cacheKey] = sanitizedProfile;
          setKolProfile(sanitizedProfile);
          setKolError(null);
        } else {
          setKolProfile(null);
          setKolError('未找到资料');
        }
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }
        console.error('Error fetching Kol profile:', error);
        setKolProfile(null);
        setKolError('加载资料失败');
      } finally {
        if (kolAbortControllerRef.current === controller) {
          kolAbortControllerRef.current = null;
        }
        if (!controller.signal.aborted) {
          setKolLoading(false);
        }
      }
    };

    kolFetchTimeoutRef.current = window.setTimeout(() => {
      fetchKolProfile().finally(() => {
        if (kolFetchTimeoutRef.current) {
          window.clearTimeout(kolFetchTimeoutRef.current);
          kolFetchTimeoutRef.current = null;
        }
      });
    }, 120);

    return () => {
      if (kolFetchTimeoutRef.current) {
        window.clearTimeout(kolFetchTimeoutRef.current);
        kolFetchTimeoutRef.current = null;
      }
      controller.abort();
      if (kolAbortControllerRef.current === controller) {
        kolAbortControllerRef.current = null;
      }
    };
  }, [hoveredUser]);

  useLayoutEffect(() => {
    if (!hoveredUser) return;
    const cardElement = hoverCardRef.current;
    if (!cardElement) return;

    const rect = cardElement.getBoundingClientRect();
    cardDimensionsRef.current = {
      width: rect.width,
      height: rect.height,
    };

    const mentionElement = resolveMentionElement();
    if (mentionElement) {
      updateCardPosition(mentionElement);
    }
  }, [hoveredUser, kolProfile, kolLoading, kolError, resolveMentionElement, updateCardPosition]);

  useEffect(() => {
    if (!hoverCardRef.current || typeof ResizeObserver === 'undefined') {
      return undefined;
    }

    const observer = new ResizeObserver(() => {
      const cardElement = hoverCardRef.current;
      if (!cardElement) {
        return;
      }

      const rect = cardElement.getBoundingClientRect();
      cardDimensionsRef.current = {
        width: rect.width,
        height: rect.height,
      };

      const mentionElement = resolveMentionElement();
      if (mentionElement) {
        updateCardPosition(mentionElement);
      }
    });

    observer.observe(hoverCardRef.current);

    return () => {
      observer.disconnect();
    };
  }, [resolveMentionElement, updateCardPosition]);

  // Process special messages (interrupt, cancel, error)
  const processSpecialMessages = (content: string) => {
    content = content.replace(
      /<div class="interrupt-message">[^<]*<\/div>/g,
      `<div class="flex items-center my-4">
        <div class="px-3 py-2 bg-gray-100 text-gray-600 rounded-md text-sm">
          生成已中断
        </div>
      </div>`,
    );

    content = content.replace(
      /<div class="cancel-message">[^<]*<\/div>/g,
      `<div class="flex items-center my-4">
        <div class="px-3 py-2 bg-gray-100 text-gray-600 rounded-md text-sm">
          请求已取消
        </div>
      </div>`,
    );

    content = content.replace(
      /<div class="error-message">[^<]*<\/div>/g,
      `<div class="flex items-center justify-center my-4">
        <div class="px-3 py-2 bg-red-100 text-red-600 rounded-md text-sm">
          出现错误
        </div>
      </div>`,
    );

    return content;
  };

  const renderToolResult = useCallback(
    (resultData: string) => {
      try {
        console.log('Parsing tool result:', resultData);
        const data = JSON.parse(resultData);
        if (data.tool_name === 'get_meme_data' && data.result?.[0]?.text) {
          console.log('Rendering MemeTokenCard with data:', data);
          if (!processedToolsRef.current.has(data.tool_name)) {
            handleToolResult(data.tool_name);
          }
          return (
            <div className="w-[300px] max-w-[380px]">
              <MemeTokenCard toolResult={data} />
            </div>
          );
        }
        return null;
      } catch (error) {
        console.error('Error parsing tool result:', error);
        return null;
      }
    },
    [handleToolResult],
  );

  // Clean content (use displayedContent for typewriter effect when streaming)
  let cleanContent = displayedContent
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16)),
    )
    .replace(/(?:\\)+_/g, '_');

  // Remove tool JSON from content immediately - both complete and incomplete
  // Tool calls are shown in reasoning section, not in message content
  const toolCallSegmentsInClean = parseInlineToolCallSegments(cleanContent);
  if (toolCallSegmentsInClean.some(seg => seg.type === 'tool_call')) {
    cleanContent = toolCallSegmentsInClean
      .filter(seg => seg.type === 'text')
      .map(seg => seg.value)
      .join('')
      .trim();
  }

  // When streaming, hide incomplete patterns to prevent flickering
  if (isStreaming) {
    // Remove incomplete tool-related JSON patterns
    // Pattern 1: {"type": "tool_call"/"tool_start", ...} format (incomplete at end)
    const incompleteToolCallPattern1 = /\{[^}]*['"]?type['"]?\s*:\s*['"]?tool_(?:call|start)[^}]*$/;
    cleanContent = cleanContent.replace(incompleteToolCallPattern1, '');

    // Pattern 2: {'name': 'tool_name', 'args'/'input': {...}} format (incomplete at end)
    const incompleteToolCallPattern2 = /\{[^}]*['"]?name['"]?\s*:\s*['"]?[^'"]+['"]?\s*,\s*['"]?(?:args|input)['"]?\s*:\s*\{[^}]*$/;
    cleanContent = cleanContent.replace(incompleteToolCallPattern2, '');

    // Pattern 3: Any incomplete JSON starting with { and containing 'tool_' keywords
    const incompleteToolCallPattern3 = /\{[^}]*['"]?tool_[a-z_]+['"]?[^}]*$/;
    cleanContent = cleanContent.replace(incompleteToolCallPattern3, '');

    // Remove incomplete tweet ID references (e.g., "[tweet_id: 12" or "[123, 4")
    // Only complete references like [tweet_id: 123] or [123, 456] will be shown
    const incompleteTweetIdPattern = /\[\s*(?:tweet_id\s*[:：]\s*)?[\d,\s，]*$/;
    cleanContent = cleanContent.replace(incompleteTweetIdPattern, '');
  }

  // Parse tool call tags and results
  const parts = cleanContent.split(
    /(<tool-call>.*?<\/tool-call>|<tool-result>.*?<\/tool-result>)/g,
  );

  // Format line with tweet links
  const handleTweetReferenceClick = useCallback(
    (tweetIds: string[]) => {
      if (typeof onTweetReferenceSelect !== 'function') {
        return;
      }
      onTweetReferenceSelect(tweetIds);
    },
    [onTweetReferenceSelect],
  );

  const formatLine = (line: string) => {
    const tweetIdPattern = /\[\s*(?:tweet_id\s*[:：]\s*)?[\d,\s，]+\]/gi;
    
    interface TextNode {
      id: string;
      content: string;
    }
    
    const textNodes: TextNode[] = [];
    const aggregatedIds = new Set<string>();
    let lastIndex = 0;
    let match;

    while ((match = tweetIdPattern.exec(line)) !== null) {
      // Add text before the ID
      const textBeforeMatch = line.slice(lastIndex, match.index);
      if (textBeforeMatch && !/^[,\s，]+$/.test(textBeforeMatch)) {
        const processedText = formatChatContent(textBeforeMatch);
        textNodes.push({
          id: `text-${match.index}`,
          content: processedText,
        });
      }

      // Handle multiple IDs separated by commas or JSON array format
      const rawMatch = match[0];
      let parsedIds: string[] = [];

      try {
        const normalized = rawMatch
          .replace(/tweet_id\s*[:：]/gi, '')
          .replace(/'/g, '"');
        const jsonValue = JSON.parse(normalized);
        if (Array.isArray(jsonValue)) {
          parsedIds = jsonValue
            .map((value) => {
              if (typeof value === 'string') {
                return value.trim();
              }
              if (typeof value === 'number') {
                return Number.isSafeInteger(value) ? String(value) : '';
              }
              if (typeof value === 'bigint') {
                return value.toString();
              }
              return '';
            })
            .filter(Boolean);
        }
      } catch {
        // Ignore JSON parse errors, fall back to regex
      }

      const fallbackIds = rawMatch.match(/\d+/g) || [];
      parsedIds = parsedIds.concat(fallbackIds).map((id) => id.trim()).filter(Boolean);

      if (parsedIds.length === 0) {
        const processedMatch = formatChatContent(rawMatch);
        textNodes.push({
          id: `raw-${match.index}`,
          content: processedMatch,
        });
      } else {
        parsedIds.forEach((id) => aggregatedIds.add(id));
      }

      lastIndex = match.index + rawMatch.length;
    }

    // Add remaining text after the last ID
    const remainingText = line.slice(lastIndex);
    if (remainingText && !/^[,\s，]+$/.test(remainingText)) {
      const processedText = formatChatContent(remainingText);
      textNodes.push({
        id: 'remaining-text',
        content: processedText,
      });
    }

    if (textNodes.length === 0) {
      textNodes.push({
        id: 'fallback-text',
        content: formatChatContent(line),
      });
    }

    if (aggregatedIds.size === 0) {
      return textNodes.map((node) => (
        <span
          key={node.id}
          dangerouslySetInnerHTML={{ __html: node.content }}
        />
      ));
    }

    const lastNode = textNodes[textNodes.length - 1];
    textNodes[textNodes.length - 1] = {
      ...lastNode,
      content: `${lastNode.content} `,
    };

    const flattenedNodes = textNodes.map((node) => (
      <span key={node.id} dangerouslySetInnerHTML={{ __html: node.content }} />
    ));

    const idsArray = Array.from(aggregatedIds);
    const groupKey = idsArray.join(',');
    const referenceLoading =
      typeof isTweetReferenceLoading === 'function'
        ? isTweetReferenceLoading(groupKey)
        : false;
    const icon = (
      <button
        key={`tweet-group-${groupKey}`}
        type="button"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          handleTweetReferenceClick(idsArray);
        }}
        disabled={referenceLoading}
        className={`relative inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border border-transparent bg-gray-200/60 text-gray-600 transition-colors ${
          referenceLoading
            ? 'cursor-not-allowed'
            : 'hover:bg-gray-300'
        }`}
        aria-label="Tweet reference"
        title="Tweet reference"
      >
        <ArrowRightCircleIcon className={`h-3 w-3 transition-opacity ${referenceLoading ? 'opacity-0' : 'opacity-100'}`} />
        {referenceLoading && (
          <span className="absolute inset-0 flex items-center justify-center">
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-gray-500 border-t-transparent" />
          </span>
        )}
      </button>
    );

    return flattenedNodes.concat(icon);
  };

  const hasTweetReference = (value: string) =>
    /\[\s*(?:tweet_id\s*[:：]\s*)?[\d,\s，]+\]/i.test(value);

  const resolveToolInfo = (call: ParsedInlineToolCall): { status?: ToolStatus; inputSummary?: string } => {
    if (!toolCallsInfo || toolCallsInfo.length === 0) {
      return {};
    }

    const matchedInfo = toolCallsInfo.find((info) => {
      if (call.id && info.id) {
        return info.id === call.id;
      }
      return info.name === call.name;
    });

    if (!matchedInfo) {
      return {};
    }

    return {
      status: matchedInfo.status,
      inputSummary: matchedInfo.inputSummary,
    };
  };

  const getInlineBadgeClasses = (status?: ToolStatus) => {
    if (status === 'success') {
      return {
        container: 'border-green-500/25 from-green-500/10 to-green-100/20',
        text: 'text-green-700',
      };
    }
    if (status === 'error') {
      return {
        container: 'border-red-500/25 from-red-500/10 to-red-100/20',
        text: 'text-red-700',
      };
    }
    return {
      container: 'border-[#f0b90b]/25 from-[#f0b90b]/15 to-orange-100/20',
      text: 'text-[#9b5d00]',
    };
  };

  const renderInlineToolCallBadge = (
    call: ParsedInlineToolCall,
    key: string,
    options?: { addLineBreak?: boolean },
  ) => {
    // Get correct info from toolCallsInfo (from SSE events), prioritize over inline JSON
    const toolInfo = resolveToolInfo(call);
    const summary = toolInfo.inputSummary || call.inputSummary?.trim();
    const displayName = call.name === 'search_on_x' ? 'Search' : formatToolName(call.name);
    const label = summary ? `${displayName}(${summary})` : displayName;
    const status = toolInfo.status;
    const badgeClasses = getInlineBadgeClasses(status);

    const renderStatusIcon = () => {
      if (status === 'success') {
      return (
        <div className="mr-1 flex h-2.5 w-2.5 items-center justify-center rounded-full bg-green-500/20">
          <svg
            className="h-1.5 w-1.5 text-green-600"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
              strokeWidth={3}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
        );
      }

      if (status === 'error') {
        return (
          <div className="mr-1 flex h-2.5 w-2.5 items-center justify-center rounded-full bg-red-500/20">
            <svg
              className="h-1.5 w-1.5 text-red-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={3}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
        );
      }

      return (
        <div className="mr-1 flex h-2.5 w-2.5 items-center justify-center rounded-full bg-[#f0b90b]/20">
          <svg
            className="h-1.5 w-1.5 text-[#f0b90b] animate-spin"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fillRule="evenodd"
              d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z"
              clipRule="evenodd"
            />
          </svg>
        </div>
      );
    };

    return (
      <React.Fragment key={key}>
        <span
          className={`inline-flex items-center rounded-full border bg-gradient-to-r px-1.5 py-0.5 mb-0.5 shadow-sm align-middle mr-1 ${badgeClasses.container}`}
        >
          {renderStatusIcon()}
          <span className={`font-inter text-[10px] font-medium tracking-[-0.008em] ${badgeClasses.text}`}>
            {label}
          </span>
        </span>
        {options?.addLineBreak ? (
          <span className="block h-2 w-full" aria-hidden="true" />
        ) : null}
      </React.Fragment>
    );
  };

  // Process content (use displayedContent for typewriter effect when streaming)
  let processedContent = displayedContent
    .replace(/<tool-call>.*?<\/tool-call>/g, '') // Remove tool call tags
    .replace(/<tool-result>.*?<\/tool-result>/g, '') // Remove tool result tags
    .replace(/\\#/g, '#') // Unescape hashes from model output like "\#150"
    .replace(/\\([*+\-])/g, '$1') // Unescape common list markers
    .trim();

  // Remove tool JSON from content - tool calls are already shown in reasoning section
  // Users don't need to see badges in message content, it's redundant
  const toolCallSegments = parseInlineToolCallSegments(processedContent);
  if (toolCallSegments.some(seg => seg.type === 'tool_call')) {
    // Reconstruct content without tool_call segments
    processedContent = toolCallSegments
      .filter(seg => seg.type === 'text')
      .map(seg => seg.value)
      .join('')
      .trim();
  }

  // When streaming, hide incomplete special blocks to avoid showing raw syntax
  if (isStreaming) {
    // Hide incomplete tool-related JSON to prevent flickering
    // Pattern 1: {"type": "tool_call"/"tool_start", ...} format
    const incompleteToolCallPattern1 = /\{[^}]*['"]?type['"]?\s*:\s*['"]?tool_(?:call|start)[^}]*$/;
    processedContent = processedContent.replace(incompleteToolCallPattern1, '');

    // Pattern 2: {'name': 'tool_name', 'args'/'input': {...}} format
    const incompleteToolCallPattern2 = /\{[^}]*['"]?name['"]?\s*:\s*['"]?[^'"]+['"]?\s*,\s*['"]?(?:args|input)['"]?\s*:\s*\{[^}]*$/;
    processedContent = processedContent.replace(incompleteToolCallPattern2, '');

    // Pattern 3: Any incomplete JSON with 'tool_' keywords
    const incompleteToolCallPattern3 = /\{[^}]*['"]?tool_[a-z_]+['"]?[^}]*$/;
    processedContent = processedContent.replace(incompleteToolCallPattern3, '');

    // Remove incomplete tweet ID references
    const incompleteTweetIdPattern = /\[\s*(?:tweet_id\s*[:：]\s*)?[\d,\s，]*$/;
    processedContent = processedContent.replace(incompleteTweetIdPattern, '');

    // Hide incomplete code blocks (``` without closing ```)
    const codeBlockCount = (processedContent.match(/```/g) || []).length;
    if (codeBlockCount % 2 !== 0) {
      // Find the last unclosed ``` and hide everything after it
      const lastOpenIndex = processedContent.lastIndexOf('```');
      processedContent = processedContent.substring(0, lastOpenIndex);
    }

    // Hide incomplete math blocks ($$ without closing $$)
    const mathBlockCount = (processedContent.match(/\$\$/g) || []).length;
    if (mathBlockCount % 2 !== 0) {
      const lastOpenIndex = processedContent.lastIndexOf('$$');
      processedContent = processedContent.substring(0, lastOpenIndex);
    }

    // Hide incomplete inline math ($ without closing $) - but be careful with token symbols
    // Only hide if it looks like a formula start (has backslash or operators after $)
    const incompleteInlineMath = processedContent.match(/\$(?=[\\a-z])[^$\n]*$/i);
    if (incompleteInlineMath) {
      processedContent = processedContent.substring(0, processedContent.length - incompleteInlineMath[0].length);
    }
  }

  // Protect block-level content before splitting into paragraphs
  // Replace $$...$$ blocks and ```...``` code blocks with placeholders
  const mathBlocks: string[] = [];
  const codeBlocks: { language: string; code: string }[] = [];

  // Protect code blocks first (```...```)
  processedContent = processedContent.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, language, code) => {
    const index = codeBlocks.length;
    codeBlocks.push({ language: language || '', code: code.trimEnd() });
    return `__CODE_BLOCK_${index}__`;
  });

  // Protect math blocks ($$...$$)
  processedContent = processedContent.replace(/\$\$\s*([\s\S]*?)\s*\$\$/g, (_match, formula) => {
    const index = mathBlocks.length;
    mathBlocks.push(formula.trim());
    return `__MATH_BLOCK_${index}__`;
  });

  // Split into paragraphs
  const paragraphs = processedContent.split('\n\n').filter((p) => p.trim());

  // Helper to restore protected blocks
  const restoreBlocks = (text: string): string => {
    let result = text;
    // Restore math blocks
    result = result.replace(/__MATH_BLOCK_(\d+)__/g, (_match, idx) => {
      const formula = mathBlocks[parseInt(idx, 10)];
      if (formula) {
        return `$$${formula}$$`;
      }
      return _match;
    });
    // Restore code blocks
    result = result.replace(/__CODE_BLOCK_(\d+)__/g, (_match, idx) => {
      const block = codeBlocks[parseInt(idx, 10)];
      if (block) {
        return `\`\`\`${block.language}\n${block.code}\`\`\``;
      }
      return _match;
    });
    return result;
  };

  const positionReady = mousePosition.x > -1000 && mousePosition.y > -1000;

  // Disable hover card completely - users should click to open Twitter profile
  const hoverCard = null;

  return (
    <>
      {isMounted ? createPortal(hoverCard, document.body) : null}

      {/* Main content */}
      <div className="space-y-4 w-full min-w-0 overflow-x-hidden" ref={containerRef}>
        {paragraphs.map((paragraph, index) => {
          // Parse table if not streaming
          const { tableData, remainingContent } = isStreaming
            ? { tableData: null, remainingContent: paragraph }
            : parseMarkdownTable(paragraph);

          if (tableData) {
            return (
              <div key={`content-${index}`} className="space-y-3">
                <ChatTable tableData={tableData} />
                {remainingContent.trim() && (
                  <div
                    dangerouslySetInnerHTML={{
                      __html: processSpecialMessages(
                        formatChatContent(remainingContent),
                      ),
                    }}
                  />
                )}
              </div>
            );
          }

          // Process regular paragraph - restore protected blocks first
          const restoredParagraph = restoreBlocks(paragraph);

          // Check if the entire paragraph is a code block
          const codeBlockMatch = restoredParagraph.match(/^```(\w*)\n([\s\S]*?)```$/);
          if (codeBlockMatch) {
            const language = codeBlockMatch[1] || 'text';
            const code = codeBlockMatch[2].trimEnd();
            return (
              <div key={`content-${index}`} className="my-3 w-full min-w-0 overflow-hidden rounded-lg border border-gray-200 shadow-sm">
                {language && language !== 'text' && (
                  <div className="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-4 py-2">
                    <span className="text-xs font-medium text-gray-500">{language}</span>
                  </div>
                )}
                <div className="overflow-x-auto code-block-light">
                  <SyntaxHighlighter
                    language={language}
                    style={oneLight}
                    customStyle={{
                      margin: 0,
                      padding: '1rem',
                      fontSize: '13px',
                      lineHeight: '1.6',
                      borderRadius: language && language !== 'text' ? '0 0 0.5rem 0.5rem' : '0.5rem',
                      background: '#fafafa',
                    }}
                    showLineNumbers={false}
                    wrapLongLines={false}
                  >
                    {code}
                  </SyntaxHighlighter>
                </div>
              </div>
            );
          }

          const lines = restoredParagraph.split('\n').filter((line) => line.trim());

          return (
            <div key={`content-${index}`} className="space-y-2.5">
              {lines.map((line, lineIndex) => {
                // Check if it's a list item
                const trimmedLine = line.trim();

                // Check if this line is a math block placeholder that was restored
                const mathBlockMatch = trimmedLine.match(/^\$\$([\s\S]*?)\$\$$/);
                if (mathBlockMatch) {
                  return (
                    <div
                      key={`line-${lineIndex}`}
                      className="-my-0.5 overflow-x-auto"
                      dangerouslySetInnerHTML={{
                        __html: formatChatContent(trimmedLine),
                      }}
                    />
                  );
                }

                const isBulletItem = 
                  /^•\s*/.test(trimmedLine) ||
                  /^\*\s+/.test(trimmedLine) ||
                  /^[-+]\s+/.test(trimmedLine);
                  
                const isNumberedItem = /^\d+\.\s+/.test(trimmedLine);
                
                const isBlockquote = /^>\s*/.test(trimmedLine);
                const isHorizontalRule = /^(---|\*\*\*|___)\s*$/.test(trimmedLine);

                if (isHorizontalRule) {
                  return <hr key={`line-${lineIndex}`} className="my-4 border-t border-gray-200" />;
                }

                const contentWithoutBlockquote = isBlockquote
                  ? trimmedLine.replace(/^>\s*/, '')
                  : trimmedLine;

                const inlineSegments = parseInlineToolCallSegments(contentWithoutBlockquote);
                const containsInlineToolCall = inlineSegments.some(
                  (segment) => segment.type === 'tool_call',
                );

                // Check for tweet IDs when there are no inline tool calls
                const hasTweetIds =
                  !containsInlineToolCall &&
                  hasTweetReference(contentWithoutBlockquote);

                return (
                  <div
                    key={`line-${lineIndex}`}
                    className={`break-words leading-relaxed ${
                      isBlockquote
                        ? 'border-l-2 border-gray-200 pl-4 text-gray-700'
                        : isBulletItem
                          ? 'pl-4'
                        : ''
                    }`}
                  >
                    {containsInlineToolCall ? (
                      inlineSegments.map((segment, segmentIndex) => {
                        if (segment.type === 'tool_call') {
                          const subsequentSegments = inlineSegments.slice(segmentIndex + 1);
                          const nextTextSegment = subsequentSegments.find(
                            (seg) => seg.type === 'text' && seg.value.trim().length > 0,
                          );
                          const hasIntermediateToolCall = subsequentSegments.some(
                            (seg) => seg.type === 'tool_call',
                          );
                          const shouldAddBreak = Boolean(
                            nextTextSegment && !hasIntermediateToolCall,
                          );

                          return renderInlineToolCallBadge(
                            segment.call,
                            `inline-tool-${lineIndex}-${segmentIndex}`,
                            { addLineBreak: shouldAddBreak },
                          );
                        }

                        const textValue = segment.value || '';
                        if (!textValue.trim()) {
                          return null;
                        }

                        const segmentHasTweetIds = hasTweetReference(textValue);

                        if (segmentHasTweetIds) {
                          return (
                            <React.Fragment key={`inline-text-${lineIndex}-${segmentIndex}`}>
                              {formatLine(textValue)}
                            </React.Fragment>
                          );
                        }

                        return (
                          <span
                            key={`inline-text-${lineIndex}-${segmentIndex}`}
                            dangerouslySetInnerHTML={{
                              __html: processSpecialMessages(
                                formatChatContent(textValue),
                              ),
                            }}
                          />
                        );
                      })
                    ) : hasTweetIds ? (
                      formatLine(contentWithoutBlockquote)
                    ) : (
                      <span
                        dangerouslySetInnerHTML={{
                          __html: processSpecialMessages(
                            formatChatContent(contentWithoutBlockquote),
                          ),
                        }}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}

        {/* Process tool results */}
        {parts.map((part, index) => {
          if (part && part.startsWith('<tool-result>')) {
            const resultData = part.replace(/<\/?tool-result>/g, '');
            return (
              <div key={`tool-result-${index}`}>{renderToolResult(resultData)}</div>
            );
          }
          return null;
        })}
      </div>
    </>
  );
};

export default React.memo(MessageContent);
