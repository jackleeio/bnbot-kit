import {
  ChatBubbleOvalLeftIcon,
  ArrowPathRoundedSquareIcon,
  HeartIcon,
  EyeIcon,
  PlayIcon,
} from '@heroicons/react/24/outline';
import { XIcon } from '@/components/icons/x-icon';
import { useState, useEffect, useRef, useMemo } from 'react';
import type React from 'react';
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

interface MobileTweetDetailCardProps {
  tweet: Tweet;
  username?: string;
  avatar?: string;
  name?: string;
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

export default function MobileTweetDetailCard({
  tweet,
  username,
  avatar,
  name,
}: MobileTweetDetailCardProps) {
  const [isVideoPlaying, setIsVideoPlaying] = useState(false);
  const [isImagePreviewOpen, setIsImagePreviewOpen] = useState(false);
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
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
          if (videoRef.current && !isVideoPlaying) {
            videoRef.current.play();
            setIsVideoPlaying(true);
          }
        } else {
          if (videoRef.current) {
            videoRef.current.pause();
            setIsVideoPlaying(false);
          }
        }
      },
      { threshold: 0.1 },
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
  }, [tweet?.id_str]);

  const stopMediaEvent = (event: React.SyntheticEvent) => {
    event.stopPropagation();
    if (
      'stopImmediatePropagation' in event.nativeEvent &&
      typeof event.nativeEvent.stopImmediatePropagation === 'function'
    ) {
      event.nativeEvent.stopImmediatePropagation();
    }
  };

  const preventNavigationForMedia = (event: React.SyntheticEvent) => {
    stopMediaEvent(event);
    event.preventDefault();
  };

  const handleOpenImagePreview = (event: React.MouseEvent, imageIndex: number) => {
    if (imageUrls.length === 0) return;
    if (imageIndex < 0 || imageIndex >= imageUrls.length) return;
    preventNavigationForMedia(event);
    setSelectedImageIndex(imageIndex);
    setIsImagePreviewOpen(true);
  };

  const formatTextWithLinks = (
    text: string,
    retweetedTweet?: Tweet['retweeted_tweet'],
  ) => {
    const displayText = retweetedTweet ? `${retweetedTweet.text}` : text;
    
    // Split by links, mentions, hashtags
    const parts = unescape(displayText).split(/((?:https?:\/\/[^\s]+)|(?:@[\w\u4e00-\u9fa5]+)|(?:#[\w\u4e00-\u9fa5]+)|(?:\$[\w\u4e00-\u9fa5]+)(?![\w\u4e00-\u9fa5]))/);

    return (
      <div className="mt-0.5">
        <p className="whitespace-pre-line break-all text-xs leading-5 text-gray-800">
          {parts.map((part: string, index: number) => {
            if (!part) return null;

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
            else if (part.match(/^[@#$][\w\u4e00-\u9fa5]+/)) {
              return (
                <span key={index} className="text-blue-500">
                  {part}
                </span>
              );
            }
            return <span key={index}>{part}</span>;
          })}
        </p>
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
                <ImageWithLoad
                  src={item.url}
                  alt="Tweet media"
                  className={`h-full w-full border border-gray-100 ${
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
            {media.map((item, index) => {
                if (index >= 4) return null; // Limit to 4 images max for grid
                return (
                  <div key={index} className="aspect-square">
                    <ImageWithLoad
                      src={item.url}
                      alt="Tweet media"
                      className="h-full w-full border border-gray-100"
                      onClick={(e) => handleOpenImagePreview(e, imageIndexMap.get(index) ?? 0)}
                    />
                  </div>
                );
            })}
          </div>
        )}
      </div>
    );
  };

  const renderQuotedTweet = (quotedTweet: Tweet['quoted_tweet']) => {
    if (!quotedTweet) return null;

    const formatQuotedText = (text: string) => {
      const parts = unescape(text).split(/((?:https?:\/\/[^\s\u4e00-\u9fa5]+)|(?:@[\w\u4e00-\u9fa5]+)|(?:#[\w\u4e00-\u9fa5]+)|(?:\$[\w\u4e00-\u9fa5]+)(?![\w\u4e00-\u9fa5]))/);

      return (
        <div className="mt-1">
          <p className="whitespace-pre-line break-all text-[12px] leading-[18px] text-gray-800">
            {parts.map((part: string, index: number) => {
              if (!part) return null;

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
              else if (part.match(/^[@#$][\w\u4e00-\u9fa5]+/)) {
                return (
                  <span key={index} className="text-blue-500">
                    {part}
                  </span>
                );
              }
              return <span key={index}>{part}</span>;
            })}
          </p>
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
            onClick={(e) => e.stopPropagation()}
          >
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
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="hover:underline"
        >
          <span className="truncate text-[12px] font-medium max-w-[60px]">
            {quotedTweet.user.name}
          </span>
        </a>
        <a
          href={`https://x.com/${quotedTweet.user.username}`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
        >
          <span className="truncate text-[12px] text-gray-500 max-w-[100px]">
            @{quotedTweet.user.username}
          </span>
        </a>
        </div>
        <div className="mt-1">{formatQuotedText(quotedTweet.text)}</div>
      </div>
    );
  };

  const cardBaseClasses =
    'tweet-card card-compact flex h-auto cursor-pointer flex-col overflow-hidden rounded-2xl border-[1px] border-gray-100 bg-white';

  return (
    <>
      <div
        ref={cardRef}
        className={`${cardBaseClasses}`}
      >
        <TweetCardContent
          tweet={tweet}
          username={resolvedUsername}
          avatar={safeAvatar}
          name={resolvedName}
          isVideoPlaying={isVideoPlaying}
          setIsVideoPlaying={setIsVideoPlaying}
          videoRef={videoRef}
          formatTextWithLinks={formatTextWithLinks}
          renderMedia={renderMedia}
          renderQuotedTweet={renderQuotedTweet}
          formatDateTime={formatDateTime}
          formatNumber={formatNumber}
        />
      </div>

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

function TweetCardContent({
  tweet,
  username,
  avatar,
  name,
  isVideoPlaying,
  setIsVideoPlaying,
  videoRef,
  formatTextWithLinks,
  renderMedia,
  renderQuotedTweet,
  formatDateTime,
  formatNumber,
}: {
  tweet: any;
  username: string;
  avatar?: string;
  name?: string;
  isVideoPlaying: boolean;
  setIsVideoPlaying: (playing: boolean) => void;
  videoRef: React.RefObject<HTMLVideoElement>;
  formatTextWithLinks: (
    text: string,
    retweetedTweet?: any,
  ) => React.ReactNode;
  renderMedia: (media: any) => React.ReactNode;
  renderQuotedTweet: (
    quotedTweet: any,
  ) => React.ReactNode;
  formatDateTime: (dateString: string) => string;
  formatNumber: (num: number | string) => string;
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

  return (
    <>
      <div className="card-body flex-grow !p-3 !pb-1">
        <div className="flex items-start gap-2">
          <div className="h-8 w-8 flex-shrink-0">
            <ImageWithLoad
              src={primaryAvatar}
              alt={`${username}'s avatar`}
              className="h-full w-full rounded-full"
              onError={(e) => {
                e.currentTarget.onerror = null;
                e.currentTarget.src = FALLBACK_AVATAR;
              }}
            />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between">
              <div className="flex min-w-0 flex-col flex-1">
                <div className="flex items-center gap-1 min-w-0">
                  <span className="truncate text-[12px] font-medium text-black max-w-[100px]">
                    {name || username}
                  </span>
                  {tweet.user?.is_blue_verified && (
                    <svg
                      viewBox="0 0 22 22"
                      aria-label="认证账号"
                      role="img"
                      className="h-[12px] w-[12px] flex-shrink-0"
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
                  <span className="text-[12px] text-gray-500 flex-shrink-0">
                    · {formatDateTime(tweet.created_at)}
                  </span>
                </div>
                <div className="flex items-center gap-0.5 min-w-0 text-[12px] text-gray-500">
                  <span className="truncate flex-shrink min-w-0">
                    @{username}
                  </span>
                  {tweet.retweeted_tweet && (
                    <span className="truncate flex-shrink-0">
                      · RT: @{tweet.retweeted_tweet.username}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-1">
          {formatTextWithLinks(displayText, undefined)}
          {isUsingPreTranslation ? (
            <div className="mt-1 text-[12px]">
              <button
                type="button"
                className="text-blue-500 hover:underline text-[11px] font-normal"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowOriginal(!showOriginal);
                }}
              >
                {showOriginal
                  ? (locale === 'zh' ? '显示翻译' : 'Show Translation')
                  : (locale === 'zh' ? '显示原文' : 'Show Original')}
              </button>
            </div>
          ) : shouldOfferTranslation && (
            <div className="mt-1 text-[12px]">
              <button
                type="button"
                className="text-blue-500 hover:underline text-[12px]"
                onClick={handleTranslate}
                disabled={isTranslating}
              >
                {isTranslating
                  ? '翻译中...'
                  : showTranslation
                    ? '收起翻译'
                    : '翻译'}
              </button>
              {translationError && (
                <p className="mt-1 text-[11px] text-red-500">{translationError}</p>
              )}
              {showTranslation && translation && (
                <p className="mt-1 whitespace-pre-line break-words text-xs leading-5 text-gray-700">
                  {translation}
                </p>
              )}
            </div>
          )}
          {renderMedia(tweet.media)}
          {renderQuotedTweet(tweet.quoted_tweet)}
        </div>
      </div>

      <div className="font-twitter-chirp mt-1.5 mb-1 flex items-center justify-between px-3 text-xs text-gray-500">
        <div className="flex items-center">
          <ChatBubbleOvalLeftIcon className="mr-1 h-4 w-4" />
          <span className="mt-0.5 text-[12px]">
            {formatNumber(tweet.reply_count)}
          </span>
        </div>
        <div className="flex items-center">
          <ArrowPathRoundedSquareIcon className="mr-1 h-4 w-4" />
          <span className="mt-0.5 text-[12px]">
            {formatNumber(tweet.retweet_count)}
          </span>
        </div>
        <div className="flex items-center">
          <HeartIcon className="mr-1 h-4 w-4" />
          <span className="mt-0.5 text-[12px]">
            {formatNumber(tweet.like_count)}
          </span>
        </div>
        <div className="flex items-center">
          <EyeIcon className="mr-1 h-4 w-4" />
          <span className="mt-0.5 text-[12px]">
            {formatNumber(tweet.view_count)}
          </span>
        </div>
      </div>
    </>
  );
}
