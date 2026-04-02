import {
  ChatBubbleOvalLeftIcon,
  ArrowPathRoundedSquareIcon,
  HeartIcon,
  EyeIcon,
  LanguageIcon,
} from '@heroicons/react/24/outline';
import { PlayIcon } from '@heroicons/react/24/solid';
import { useRouter } from 'next/navigation';
import { useModal } from '@/components/ui/animated-modal';
import { useState, useEffect, useRef, useMemo } from 'react';
import type React from 'react';
import Link from 'next/link';
import ImagePreviewModal from '@/components/ui/image-preview-modal';
import ImageWithLoad from '@/components/ui/image-with-load';
import bnbotAI from '@/assets/images/logo/bnbot-ai.jpg';
import { useLocale } from 'next-intl';
import { unescape } from 'lodash';

const FALLBACK_AVATAR =
  typeof bnbotAI === 'string' ? bnbotAI : (bnbotAI as { src: string }).src;

const getSafeAvatar = (src?: string | null) =>
  src && src.trim().length > 0 ? src : FALLBACK_AVATAR;

const MAX_TRANSLATION_LENGTH = 1000;
const MAIN_TEXT_MAX_LINES = 4;
const QUOTED_TWEET_MAX_LINES = 2;

const stripUrlsAndHandles = (text: string) =>
  text
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[@#][\w\u4e00-\u9fa5]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const isLikelyEnglish = (text: string) => {
  if (!text) return false;
  const cleaned = stripUrlsAndHandles(text);
  if (cleaned.length < 8) return false;

  const asciiMatches = cleaned.match(/[\u0000-\u007F]/g) ?? [];
  const nonAsciiMatches = cleaned.match(/[^\u0000-\u007F]/g) ?? [];
  if (asciiMatches.length === 0) return false;

  const ratio = asciiMatches.length / (asciiMatches.length + nonAsciiMatches.length);
  return ratio >= 0.85;
};

const truncateText = (text: string) =>
  text.length > MAX_TRANSLATION_LENGTH ? text.slice(0, MAX_TRANSLATION_LENGTH) : text;

interface Tweet {
  id_str: string;
  created_at: string;
  text: string;
  reply_count: number;
  retweet_count: number;
  like_count: number;
  quote_count: number;
  view_count: string;
  is_retweet: boolean;
  retweeted_status_id: string | null;
  is_quote: boolean;
  quoted_status_id: string | null;
  user: {
    username: string;
    twitter_id: string;
    name: string;
    avatar: string;
    description: string;
    is_blue_verified?: boolean;
  };
  media:
    | {
        type: string;
        url: string;
        thumbnail?: string;
      }[]
    | null;
  quoted_tweet?: {
    id_str: string;
    text: string;
    created_at: string;
    user: {
      name: string;
      username: string;
      avatar: string;
      is_blue_verified?: boolean;
    };
  } | null;
  retweeted_tweet?: {
    text: string;
    username: string;
  } | null;
}

interface TweetCardProps {
  tweet: Tweet;
  username?: string;
  avatar?: string;
  name?: string;
  isMobile?: boolean;
  onTweetClick?: (tweet: Tweet) => void;
  disableTruncation?: boolean;
  initialExpanded?: boolean;
  onExpandChange?: (expanded: boolean) => void;
}

function formatNumber(num: number | string): string {
  const numValue = typeof num === 'string' ? parseInt(num) : num;
  if (numValue >= 1000000) {
    return `${(numValue / 1000000).toFixed(1)}M`;
  }
  if (numValue >= 1000) {
    return `${(numValue / 1000).toFixed(1)}K`;
  }
  return numValue.toString();
}

function formatDateTime(dateString: string): string {
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return dateString;

  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = `${date.getHours()}`.padStart(2, '0');
  const minutes = `${date.getMinutes()}`.padStart(2, '0');

  return `${month}/${day} ${hours}:${minutes}`;
}

export default function TweetCard({
  tweet,
  username,
  avatar,
  name,
  isMobile = false,
  disableTruncation = false,
  initialExpanded = false,
  onExpandChange,
}: TweetCardProps) {
  const router = useRouter();
  const { showModal } = useModal();
  const [isVideoPlaying, setIsVideoPlaying] = useState(false);
  const [isImagePreviewOpen, setIsImagePreviewOpen] = useState(false);
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const [isTextExpanded, setIsTextExpanded] = useState(disableTruncation || initialExpanded);
  const [isQuotedExpanded, setIsQuotedExpanded] = useState(disableTruncation || initialExpanded);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const resolvedUsername = username || tweet?.user?.username || tweet?.user?.twitter_id || '';
  const resolvedName = name || tweet?.user?.name || resolvedUsername;
  const safeAvatar = getSafeAvatar(avatar ?? tweet?.user?.avatar);
  const imageUrls = useMemo(
    () =>
      (tweet.media ?? [])
        .filter((item) => item.type !== 'video' && item.url)
        .map((item) => item.url),
    [tweet.media],
  );

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          // 组件在视口内，继续播放视频
          if (videoRef.current && !isVideoPlaying) {
            videoRef.current.play();
            setIsVideoPlaying(true);
          }
        } else {
          // 组件移出视口，暂停视频
          if (videoRef.current) {
            videoRef.current.pause();
            setIsVideoPlaying(false);
          }
        }
      },
      { threshold: 0.1 }, // 触发阈值
    );

    if (cardRef.current) {
      observer.observe(cardRef.current);
    }

    return () => {
      if (cardRef.current) {
        observer.unobserve(cardRef.current);
      }
    };
  }, [videoRef, isVideoPlaying]);

  useEffect(() => {
    setIsImagePreviewOpen(false);
    setSelectedImageIndex(0);
    setIsTextExpanded(disableTruncation || initialExpanded);
    setIsQuotedExpanded(disableTruncation || initialExpanded);
  }, [tweet?.id_str, disableTruncation, initialExpanded]);

  const stopMediaEvent = (event: React.SyntheticEvent) => {
    event.stopPropagation();
    // Some native listeners (e.g. Link) still react without immediate stop
    if (
      'stopImmediatePropagation' in event.nativeEvent &&
      typeof event.nativeEvent.stopImmediatePropagation === 'function'
    ) {
      event.nativeEvent.stopImmediatePropagation();
    }
  };

  const preventNavigationForMedia = (event: React.SyntheticEvent) => {
    stopMediaEvent(event);
    if (isMobile) {
      event.preventDefault();
    }
  };

  const handleOpenImagePreview = (event: React.MouseEvent, imageIndex: number) => {
    if (imageUrls.length === 0) return;
    if (imageIndex < 0 || imageIndex >= imageUrls.length) return;
    preventNavigationForMedia(event);
    setSelectedImageIndex(imageIndex);
    setIsImagePreviewOpen(true);
  };

  // Check if main text is truncated
  const isMainTextTruncated = useMemo(() => {
    const text = tweet?.retweeted_tweet?.text || tweet?.text || '';
    const lines = text.split('\n');
    return lines.length > MAIN_TEXT_MAX_LINES;
  }, [tweet?.text, tweet?.retweeted_tweet?.text]);

  // Check if quoted text is truncated
  const isQuotedTextTruncated = useMemo(() => {
    if (!tweet?.quoted_tweet?.text) return false;
    const lines = tweet.quoted_tweet.text.split('\n');
    return lines.length > QUOTED_TWEET_MAX_LINES;
  }, [tweet?.quoted_tweet?.text]);

  // Track if we just expanded to prevent immediate re-trigger
  const justExpandedRef = useRef(false);

  const handleTweetClick = (e: React.MouseEvent) => {
    // Prevent double-click issues
    if (justExpandedRef.current) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    // If text is truncated and not expanded, expand it first instead of navigating
    if (isMainTextTruncated && !isTextExpanded) {
      e.preventDefault();
      e.stopPropagation();
      setIsTextExpanded(true);
      onExpandChange?.(true);
      justExpandedRef.current = true;
      setTimeout(() => {
        justExpandedRef.current = false;
      }, 300);
      return;
    }

    // If quoted text is truncated and not expanded, expand it first
    if (isQuotedTextTruncated && !isQuotedExpanded) {
      e.preventDefault();
      e.stopPropagation();
      setIsQuotedExpanded(true);
      onExpandChange?.(true);
      justExpandedRef.current = true;
      setTimeout(() => {
        justExpandedRef.current = false;
      }, 300);
      return;
    }

    const tweetWithAuthor = {
      ...tweet,
      author: {
        username: resolvedUsername,
        twitter_id: resolvedUsername,
        name: resolvedName,
        avatar: safeAvatar,
        description: '',
      },
    };

    if (isMobile) {
      // 移动端：异步保存到 sessionStorage，不阻塞 Link 导航
      // 使用 setTimeout 确保导航优先执行
      setTimeout(() => {
        if (typeof window !== 'undefined') {
          try {
            const feedContainer = document.querySelector(
              '[data-tweet-feed-scroll="true"]',
            ) as HTMLDivElement | null;
            if (feedContainer) {
              sessionStorage.setItem(
                'bnbot:tweetFeedScrollTop',
                feedContainer.scrollTop.toString(),
              );
            }
            // 返回时默认收起聊天面板
            sessionStorage.setItem('bnbot:isChatOpen', 'false');
            sessionStorage.setItem(
              'bnbot:selectedTweet',
              JSON.stringify(tweetWithAuthor),
            );
          } catch (error) {
            console.error('Failed to cache selected tweet:', error);
          }
        }
      }, 0);

      router.push(`/tweet/${tweet.id_str}`);
      return;
    }

    // 桌面端：阻止 Link 默认行为，使用 Modal
    e.preventDefault();
    showModal(null, tweetWithAuthor, 'tweet');
  };

  const formatTextWithLinks = (
    text: string,
    retweetedTweet?: Tweet['retweeted_tweet'],
    options?: {
      maxLines?: number;
      isExpanded?: boolean;
      onExpand?: (event: React.MouseEvent) => void;
    },
  ) => {
    // 如果存在转推推文，则使用转推的文本
    const displayText = retweetedTweet ? `${retweetedTweet.text}` : text;

    const lines = displayText.split('\n');
    const maxLines = options?.maxLines ?? MAIN_TEXT_MAX_LINES;
    const isTruncated = lines.length > maxLines;
    const displayedLines =
      isTruncated && !options?.isExpanded ? lines.slice(0, maxLines) : lines;
    const shouldShowExpandButton =
      isTruncated && !options?.isExpanded && Boolean(options?.onExpand);

    const parts = unescape(displayedLines.join('\n'))
      .split(/((?:https?:\/\/[^\s\u4e00-\u9fa5]+)|(?:@[\w\u4e00-\u9fa5]+)|(?:#[\w\u4e00-\u9fa5]+)|(?:\$[a-zA-Z\u4e00-\u9fa5][\w\u4e00-\u9fa5]*))/);

    return (
      <div className="mt-0">
        <p
          className={`font-twitter-chirp font-normal whitespace-pre-line break-words leading-normal tracking-tight text-black ${
            isMobile ? 'text-base' : 'text-sm'
          }`}
        >
          {parts.map((part: string, index: number) => {
            if (!part) return null;

            // 处理链接
            if (part.match(/^https?:\/\//)) {
              return (
                <a
                  key={index}
                  href={part}
                  className="text-blue-500 hover:underline"
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => {
                    e.stopPropagation();
                  }}
                >
                  {part}
                </a>
              );
            }
            // 处理 @用户名、#话题标签、$cashtag (不匹配美元金额如 $1,600)
            else if (part.match(/^[@#][\w\u4e00-\u9fa5]+/) || part.match(/^\$[a-zA-Z\u4e00-\u9fa5]/)) {
              return (
                <span key={index} className="text-blue-500">
                  {part}
                </span>
              );
            }
            // 普通文本
            return <span key={index}>{part}</span>;
          })}
          {isTruncated && !options?.isExpanded && !isMobile && (
            <span className="text-gray-500"> ...</span>
          )}
        </p>
        {shouldShowExpandButton && (
          <button
            type="button"
            className={`font-twitter-chirp mt-1 text-blue-500 hover:underline ${isMobile ? 'text-sm' : 'text-xs'}`}
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              options?.onExpand?.(e);
            }}
          >
            显示更多
          </button>
        )}
      </div>
    );
  };

  const renderMedia = (media: Tweet['media']) => {
    if (!media || media.length === 0) return null;

    const imageIndexMap = new Map<number, number>();
    let imageCounter = 0;
    media.forEach((item, index) => {
      if (item.type !== 'video') {
        imageIndexMap.set(index, imageCounter);
        imageCounter += 1;
      }
    });

    return (
      <div className="mt-1.5 overflow-hidden">
        {media.length === 1 && (
          <div className="relative h-[180px]">
            {media[0].type === 'video' ? (
              <>
                {!isVideoPlaying ? (
                  <>
                    <ImageWithLoad
                      src={media[0].thumbnail}
                      alt="Tweet media thumbnail"
                      className="h-full w-full rounded-2xl border border-gray-100"
                      onClick={(e) => preventNavigationForMedia(e)}
                      onMouseDown={(e) => stopMediaEvent(e)}
                      onTouchStart={(e) => stopMediaEvent(e)}
                      loading="lazy"
                      crossOrigin="anonymous"
                    />
                    <div
                      className="absolute inset-0 flex items-center justify-center rounded-2xl bg-black bg-opacity-20 hover:bg-opacity-30"
                      onClick={(e) => {
                        preventNavigationForMedia(e);
                        setIsVideoPlaying(true);
                      }}
                      onMouseDown={(e) => stopMediaEvent(e)}
                      onTouchStart={(e) => stopMediaEvent(e)}
                    >
                      <button
                        className="rounded-full bg-gray-300 bg-opacity-30 p-2 shadow-sm"
                        onClick={(e) => {
                          preventNavigationForMedia(e);
                          setIsVideoPlaying(true);
                        }}
                        onMouseDown={(e) => stopMediaEvent(e)}
                        onTouchStart={(e) => stopMediaEvent(e)}
                      >
                        <PlayIcon className="h-8 w-8 text-gray-200" />
                      </button>
                    </div>
                  </>
                ) : (
                  <video
                    ref={videoRef}
                    controls
                    autoPlay
                    className="h-full w-full rounded-2xl border border-gray-100 object-cover"
                    onClick={(e) => preventNavigationForMedia(e)}
                    onMouseDown={(e) => stopMediaEvent(e)}
                    onTouchStart={(e) => stopMediaEvent(e)}
                    onEnded={() => setIsVideoPlaying(false)}
                  >
                    <source src={media[0].url} type="video/mp4" />
                    Your browser does not support the video tag.
                  </video>
                )}
              </>
            ) : (
              <ImageWithLoad
                src={media[0].url}
                alt="Tweet media"
                className="h-full w-full rounded-2xl border border-gray-100"
                onClick={(e) => handleOpenImagePreview(e, imageIndexMap.get(0) ?? 0)}
                loading="lazy"
                crossOrigin="anonymous"
              />
            )}
          </div>
        )}

        {media.length === 2 && (
          <div className="grid grid-cols-2 gap-0.5">
            {media.map((item, index) => (
              <div key={index} className="aspect-square">
                <img
                  src={item.url}
                  alt="Tweet media"
                  className={`h-full w-full border border-gray-100 object-cover ${
                    index === 0
                      ? 'rounded-bl-2xl rounded-tl-2xl'
                      : 'rounded-br-2xl rounded-tr-2xl'
                  }`}
                  onClick={(e) =>
                    handleOpenImagePreview(e, imageIndexMap.get(index) ?? 0)
                  }
                />
              </div>
            ))}
          </div>
        )}

        {media.length >= 3 && (
          <div className="grid grid-cols-2 gap-0.5">
            <div className="aspect-square">
              <img
                src={media[0].url}
                alt="Tweet media"
                className="h-full w-full rounded-bl-2xl rounded-tl-2xl border border-gray-100 object-cover"
                onClick={(e) => handleOpenImagePreview(e, imageIndexMap.get(0) ?? 0)}
              />
            </div>
            <div className="grid grid-rows-2 gap-0.5">
              {media.slice(1, 3).map((item, index) => (
                <div key={index} className="aspect-[2/1]">
                  <img
                    src={item.url}
                    alt="Tweet media"
                    className={`h-full w-full border border-gray-100 object-cover ${
                      index === 0 ? 'rounded-tr-2xl' : 'rounded-br-2xl'
                    }`}
                    onClick={(e) =>
                      handleOpenImagePreview(e, imageIndexMap.get(index + 1) ?? 0)
                    }
                  />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderQuotedTweet = (
    quotedTweet: Tweet['quoted_tweet'],
    options?: {
      isExpanded?: boolean;
      onExpand?: (event: React.MouseEvent) => void;
      maxLines?: number;
      overrideText?: string;
    },
  ) => {
    if (!quotedTweet) return null;

    const formatQuotedText = (text: string) => {
      const lines = text.split('\n');
      const maxLines = options?.maxLines ?? QUOTED_TWEET_MAX_LINES;
      const isTruncated = lines.length > maxLines;
      const displayedLines =
        isTruncated && !options?.isExpanded ? lines.slice(0, maxLines) : lines;
      const shouldShowExpandButton =
        isTruncated && !options?.isExpanded && Boolean(options?.onExpand);
      const parts = unescape(displayedLines.join('\n'))
        .split(/((?:https?:\/\/[^\s\u4e00-\u9fa5]+)|(?:@[\w\u4e00-\u9fa5]+)|(?:#[\w\u4e00-\u9fa5]+)|(?:\$[a-zA-Z\u4e00-\u9fa5][\w\u4e00-\u9fa5]*))/);

      return (
        <div className="mt-1">
          <p
          className={`font-twitter-chirp font-sm whitespace-pre-line break-words leading-relaxed tracking-tight text-gray-800 antialiased ${
              isMobile ? 'text-base' : 'text-sm'
            }`}
          >
            {parts.map((part: string, index: number) => {
              if (!part) return null;

              // Handle links
              if (part.match(/^https?:\/\//)) {
                return (
                  <a
                    key={index}
                    href={part}
                    className="text-blue-500 hover:underline"
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => {
                      e.stopPropagation();
                    }}
                  >
                    {part}
                  </a>
                );
              }
              // Handle @mentions, #hashtags, and $cashtags (not dollar amounts like $1,600)
              else if (part.match(/^[@#][\w\u4e00-\u9fa5]+/) || part.match(/^\$[a-zA-Z\u4e00-\u9fa5]/)) {
                if (part.startsWith('@')) {
                  return (
                    <a
                      key={index}
                      href={`https://x.com/${part.slice(1)}`}
                      className="text-blue-500 hover:underline"
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {part}
                    </a>
                  );
                }
                return (
                  <span key={index} className="text-blue-500">
                    {part}
                  </span>
                );
              }
              // Regular text
              return <span key={index}>{part}</span>;
            })}
            {isTruncated && !options?.isExpanded && !isMobile && (
              <span className="text-gray-500"> ...</span>
            )}
          </p>
          {shouldShowExpandButton && (
            <button
              type="button"
              className={`font-twitter-chirp mt-1 text-blue-500 hover:underline ${isMobile ? 'text-sm' : 'text-xs'}`}
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                options?.onExpand?.(e);
              }}
            >
              显示更多
            </button>
          )}
        </div>
      );
    };

    return (
      <div className="mt-2 rounded-xl border border-gray-200/50 p-3">
        <div className="flex items-center gap-2">
          <a
            href={`https://x.com/${quotedTweet.user.username}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}          >
            <ImageWithLoad
              src={getSafeAvatar(quotedTweet.user.avatar)}
              alt={`${quotedTweet.user.username}'s avatar`}
              className="h-5 w-5 rounded-full"
              onError={(e) => {
                e.currentTarget.onerror = null;
                e.currentTarget.src = FALLBACK_AVATAR;
              }}
            />
          </a>
          <a
            href={`https://x.com/${quotedTweet.user.username}`}
            target="_blank"
        >
          <span className="font-twitter-chirp truncate text-sm font-medium max-w-[60px]">
            {quotedTweet.user.name}
          </span>
        </a>
        <a
          href={`https://x.com/${quotedTweet.user.username}`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
        >
          <span className="font-twitter-chirp truncate text-xs text-gray-500 max-w-[100px]">
            @{quotedTweet.user.username}
          </span>
        </a>
        </div>
        <div className="mt-1">{formatQuotedText(options?.overrideText || quotedTweet.text)}</div>
      </div>
    );
  };

  const cardBaseClasses =
    'tweet-card card-compact flex h-full cursor-pointer flex-col overflow-hidden rounded-2xl border-[1px] border-gray-100 bg-white';
  const desktopHoverClass = 'hover:bg-gray-50';

  return (
    <>
      {isMobile ? (
        <div
          onClick={handleTweetClick}
          className={`${cardBaseClasses}`}
          ref={cardRef as any}
          style={{ WebkitTapHighlightColor: 'transparent' }}
        >
          <TweetCardContent
            tweet={tweet}
            username={resolvedUsername}
            avatar={safeAvatar}
            name={resolvedName}
            isMobile={isMobile}
            isVideoPlaying={isVideoPlaying}
            setIsVideoPlaying={setIsVideoPlaying}
            videoRef={videoRef}
            formatTextWithLinks={formatTextWithLinks}
            renderMedia={renderMedia}
            renderQuotedTweet={renderQuotedTweet}
            formatDateTime={formatDateTime}
            formatNumber={formatNumber}
            isTextExpanded={isTextExpanded}
            setIsTextExpanded={setIsTextExpanded}
            isQuotedExpanded={isQuotedExpanded}
            setIsQuotedExpanded={setIsQuotedExpanded}
          />
        </div>
      ) : (
        <div
          ref={cardRef}
          className={`${cardBaseClasses} ${desktopHoverClass}`}
          onClick={handleTweetClick}
        >
          <TweetCardContent
            tweet={tweet}
            username={resolvedUsername}
            avatar={safeAvatar}
            name={resolvedName}
            isMobile={isMobile}
            isVideoPlaying={isVideoPlaying}
            setIsVideoPlaying={setIsVideoPlaying}
            videoRef={videoRef}
            formatTextWithLinks={formatTextWithLinks}
            renderMedia={renderMedia}
            renderQuotedTweet={renderQuotedTweet}
            formatDateTime={formatDateTime}
            formatNumber={formatNumber}
            isTextExpanded={isTextExpanded}
            setIsTextExpanded={setIsTextExpanded}
            isQuotedExpanded={isQuotedExpanded}
            setIsQuotedExpanded={setIsQuotedExpanded}
          />
        </div>
      )}

      {imageUrls.length > 0 && (
        <ImagePreviewModal
          isOpen={isImagePreviewOpen}
          imageUrl={imageUrls[selectedImageIndex] ?? ''}
          images={imageUrls}
          currentIndex={selectedImageIndex}
          onClose={() => setIsImagePreviewOpen(false)}
        />
      )}
    </>
  );
}

// 抽取卡片内容为独立组件，避免重复代码
function TweetCardContent({
  tweet,
  username,
  avatar,
  name,
  isMobile,
  isVideoPlaying,
  setIsVideoPlaying,
  videoRef,
  formatTextWithLinks,
  renderMedia,
  renderQuotedTweet,
  formatDateTime,
  formatNumber,
  isTextExpanded,
  setIsTextExpanded,
  isQuotedExpanded,
  setIsQuotedExpanded,
}: {
  tweet: any;
  username: string;
  avatar?: string;
  name?: string;
  isMobile: boolean;
  isVideoPlaying: boolean;
  setIsVideoPlaying: (playing: boolean) => void;
  videoRef: React.RefObject<HTMLVideoElement>;
  formatTextWithLinks: (
    text: string,
    retweetedTweet?: any,
    options?: {
      maxLines?: number;
      isExpanded?: boolean;
      onExpand?: (event: React.MouseEvent) => void;
    },
  ) => React.ReactNode;
  renderMedia: (media: any) => React.ReactNode;
  renderQuotedTweet: (
    quotedTweet: any,
    options?: {
      isExpanded?: boolean;
      onExpand?: (event: React.MouseEvent) => void;
      maxLines?: number;
      overrideText?: string;
    },
  ) => React.ReactNode;
  formatDateTime: (dateString: string) => string;
  formatNumber: (num: number | string) => string;
  isTextExpanded: boolean;
  setIsTextExpanded: (expanded: boolean) => void;
  isQuotedExpanded: boolean;
  setIsQuotedExpanded: (expanded: boolean) => void;
}) {
  const primaryAvatar = getSafeAvatar(avatar ?? tweet?.user?.avatar);
  const locale = useLocale();

  const [showOriginal, setShowOriginal] = useState(false);
  const isUsingPreTranslation = 
    (locale === 'zh' && !!tweet?.text_zh && tweet.text_zh !== tweet.text) || 
    (locale === 'en' && !!tweet?.text_en && tweet.text_en !== tweet.text);

  // Determine display text based on locale and available translations
  const getDisplayText = () => {
    let text = '';
    
    // If it's a retweet, we prioritize the retweeted content
    const targetTweet = tweet?.retweeted_tweet || tweet;
    
    if (showOriginal) {
      text = targetTweet?.text ?? '';
    } else if (locale === 'zh' && (targetTweet as any)?.text_zh) {
      text = (targetTweet as any).text_zh.replace(/\\n/g, '\n');
    } else if (locale === 'en' && (targetTweet as any)?.text_en) {
      text = (targetTweet as any).text_en.replace(/\\n/g, '\n');
    } else {
      text = targetTweet?.text ?? '';
    }

    // Filter out "RT @username:" prefix
    return text.replace(/^RT\s+@\w+:?\s*/i, '');
  };

  const getQuotedDisplayText = (quoted: any) => {
    if (!quoted) return '';
    if (showOriginal) return quoted.text;
    if (locale === 'zh' && quoted.text_zh) return quoted.text_zh.replace(/\\n/g, '\n');
    if (locale === 'en' && quoted.text_en) return quoted.text_en.replace(/\\n/g, '\n');
    return quoted.text;
  };

  const displayText = getDisplayText();
  const translationSource = showOriginal ? displayText : (tweet?.retweeted_tweet?.text ?? tweet?.text ?? '');
  
  const [isTranslating, setIsTranslating] = useState(false);
  const [translation, setTranslation] = useState<string | null>(null);
  const [showTranslation, setShowTranslation] = useState(false);
  const [translationError, setTranslationError] = useState<string | null>(null);

  const shouldOfferTranslation = useMemo(
    () => !isUsingPreTranslation && isLikelyEnglish(translationSource),
    [translationSource, isUsingPreTranslation],
  );

  useEffect(() => {
    setShowOriginal(false);
  }, [tweet?.id_str]);

  useEffect(() => {
    setIsTranslating(false);
    setShowTranslation(false);
    setTranslation(null);
    setTranslationError(null);
  }, [tweet?.id_str, translationSource]);

  const handleTranslate = async (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (
      'stopImmediatePropagation' in event.nativeEvent &&
      typeof event.nativeEvent.stopImmediatePropagation === 'function'
    ) {
      event.nativeEvent.stopImmediatePropagation();
    }
    if (!shouldOfferTranslation || !translationSource || isTranslating) return;

    if (translation) {
      setShowTranslation((prev) => !prev);
      return;
    }

    setIsTranslating(true);
    setTranslationError(null);
    try {
      const baseUrl = process.env.NEXT_PUBLIC_REST_API_ENDPOINT || '';
      const response = await fetch(`${baseUrl}/api/v1/utils/translate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: truncateText(translationSource) }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok || !data?.translated_text) {
        throw new Error(data?.detail || 'Translation failed');
      }

      setTranslation(data.translated_text);
      setShowTranslation(true);
    } catch (error) {
      console.error('Failed to translate tweet', error);
      setTranslationError('翻译失败，请稍后重试');
    } finally {
      setIsTranslating(false);
    }
  };

  const handleExpandMainText = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setIsTextExpanded(true);
  };

  const handleExpandQuotedText = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setIsQuotedExpanded(true);
  };

  return (
    <>
      <div className="card-body flex-grow !p-3 !pb-1">
        <div className="flex items-start gap-2">
          <div className={`${isMobile ? 'h-9 w-9' : 'h-8 w-8'} flex-shrink-0`}>
            <img
              src={primaryAvatar}
              alt={`${username}'s avatar`}
              className="h-full w-full rounded-full object-cover"
              onError={(e) => {
                e.currentTarget.onerror = null;
                e.currentTarget.src = FALLBACK_AVATAR;
              }}
            />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between">
              <div className="flex min-w-0 flex-col">
                <div className="flex items-center gap-1 min-w-0">
                  <span
                    className={`font-twitter-chirp truncate font-medium text-black ${
                      isMobile
                        ? 'max-w-[240px] text-base'
                        : 'max-w-[160px] text-sm'
                    }`}
                  >
                    {name || username}
                  </span>
                  {tweet.user?.is_blue_verified && (
                    <svg
                      viewBox="0 0 22 22"
                      aria-label="认证账号"
                      role="img"
                      className={`${
                        isMobile ? 'h-[14px] w-[14px]' : 'h-[12px] w-[12px]'
                      } flex-shrink-0`}
                    >
                      <g>
                        <path
                          d="M20.396 11c-.018-.646-.215-1.275-.57-1.816-.354-.54-.852-.972-1.438-1.246.223-.607.27-1.264.14-1.897-.131-.634-.437-1.218-.882-1.687-.47-.445-1.053-.75-1.687-.882-.633-.13-1.29-.083-1.897.14-.273-.587-.704-1.086-1.245-1.44S11.647 1.62 11 1.604c-.646.017-1.273.213-1.813.568s-.969.854-1.24 1.44c-.608-.223-1.267-.272-1.902-.14-.635.13-1.22.436-1.69.882-.445.47-.749 1.055-.878 1.688-.13.633-.08 1.29.144 1.896-.587.274-1.087.705-1.443 1.245-.356.54-.555 1.17-.574 1.817.02.647.218 1.276.574 1.817.356.54.856.972 1.443 1.245-.224.606-.274 1.263-.144 1.896.13.634.433 1.218.877 1.688.47.443 1.054.747 1.687.878.633.132 1.29.084 1.897-.136.274.586.705 1.084 1.246 1.439.54.354 1.17.551 1.816.569.647-.016 1.276-.213 1.817-.567s.972-.854 1.245-1.44c.604.239 1.266.296 1.903.164.636-.132 1.22-.447 1.68-.907.46-.46.776-1.044.908-1.681s.075-1.299-.165-1.903c.586-.274 1.084-.705 1.439-1.246.354-.54.551-1.17.569-1.816zM9.662 14.85l-3.429-3.428 1.293-1.302 2.072 2.072 4.4-4.794 1.347 1.246z"
                          fill="currentColor"
                          className="text-blue-500"
                        />
                      </g>
                    </svg>
                  )}
                </div>
                <p
                  className={`font-twitter-chirp truncate text-gray-500 -mt-0.5 ${
                    isMobile ? 'max-w-[120px] text-xs' : 'max-w-[120px] text-xs'
                  }`}
                >
                  @{username}
                </p>
              </div>
              <div
                className={`font-twitter-chirp mt-0.5 flex-shrink-0 text-right text-gray-500 ${
                  isMobile ? 'text-xs' : 'text-xs'
                }`}
              >
                <div
                  className={`font-twitter-chirp text-gray-500 ${
                    isMobile ? 'text-xs' : 'text-xs'
                  }`}
                >
                  {formatDateTime(tweet.created_at)}
                </div>
                <div
                  className={`font-twitter-chirp truncate text-gray-500 -mt-0.5 ${
                    isMobile ? 'text-xs' : 'text-xs'
                  }`}
                >
                  {tweet.retweeted_tweet && (
                    <span>RT: @{tweet.retweeted_tweet.username}</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
        {/* Tweet Text */}
        {formatTextWithLinks(displayText, undefined, {
          maxLines: MAIN_TEXT_MAX_LINES,
          isExpanded: isTextExpanded,
          onExpand: handleExpandMainText,
        })}
          {/* 翻译内容显示在推文正文下方 */}
          {showTranslation && translation && (
            <p className={`font-twitter-chirp font-normal mt-1 whitespace-pre-line break-words leading-relaxed tracking-tight text-black ${isMobile ? 'text-base' : 'text-sm'}`}>
              {translation.split(/([@#$][\w\u4e00-\u9fa5]+)/).map((part, index) => {
                if (part.match(/^[@#$][\w\u4e00-\u9fa5]+/)) {
                  return <span key={index} className="text-blue-500">{part}</span>;
                }
                return <span key={index}>{part}</span>;
              })}
            </p>
          )}
          {translationError && (
            <p className="mt-2 text-xs text-red-500">{translationError}</p>
          )}
          {renderMedia(tweet.media)}
          {renderQuotedTweet(tweet.quoted_tweet, {
            isExpanded: isMobile ? isQuotedExpanded : false,
            onExpand: isMobile ? handleExpandQuotedText : undefined,
            maxLines: QUOTED_TWEET_MAX_LINES,
            overrideText: getQuotedDisplayText(tweet.quoted_tweet),
          })}
        </div>


      <div className="font-twitter-chirp mt-1 mb-1 flex items-center justify-between px-3 text-xs text-gray-500">
        <div>
          {isUsingPreTranslation ? (
            <button
              type="button"
              className="group flex items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-normal text-gray-500 transition-all hover:bg-gray-100 hover:text-gray-900 active:scale-95"
              onClick={(e) => {
                e.stopPropagation();
                setShowOriginal(!showOriginal);
              }}
            >
              <LanguageIcon className="h-3 w-3" />
              <span>
                {showOriginal
                  ? (locale === 'zh' ? '显示翻译' : 'Show Translation')
                  : (locale === 'zh' ? '显示原文' : 'Show Original')}
              </span>
            </button>
          ) : shouldOfferTranslation ? (
            <button
              type="button"
              className="group flex items-center gap-1.5 rounded-full px-2 py-1 text-[12px] font-normal text-gray-500 transition-all hover:bg-gray-100 hover:text-gray-900 active:scale-95"
              onClick={handleTranslate}
              disabled={isTranslating}
            >
              <LanguageIcon className="h-3 w-3" />
              <span>
                {isTranslating
                  ? (locale === 'zh' ? '翻译中...' : 'Translating...')
                  : showTranslation
                    ? (locale === 'zh' ? '收起翻译' : 'Hide')
                    : (locale === 'zh' ? '翻译' : 'Translate')}
              </span>
            </button>
          ) : null}
        </div>
        <div className="flex items-center gap-2 text-gray-500">
          <div className="flex items-center">
            <ChatBubbleOvalLeftIcon className="mr-0.5 h-3 w-3" />
            <span className="text-[10px]">
              {formatNumber(tweet.reply_count)}
            </span>
          </div>
          <div className="flex items-center">
            <ArrowPathRoundedSquareIcon className="mr-0.5 h-3 w-3" />
            <span className="text-[10px]">
              {formatNumber(tweet.retweet_count)}
            </span>
          </div>
          <div className="flex items-center">
            <HeartIcon className="mr-0.5 h-3 w-3" />
            <span className="text-[10px]">
              {formatNumber(tweet.like_count)}
            </span>
          </div>
          <div className="flex items-center">
            <EyeIcon className="mr-0.5 h-3 w-3" />
            <span className="text-[10px]">
              {formatNumber(tweet.view_count)}
            </span>
          </div>
        </div>
      </div>
    </>
  );
}
