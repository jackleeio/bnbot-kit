'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ChatBubbleOvalLeftIcon,
  ArrowPathRoundedSquareIcon,
  HeartIcon,
  EyeIcon,
} from '@heroicons/react/24/outline';
import ImagePreviewModal from '@/components/ui/image-preview-modal';
import { TrendTweet } from './tweetDetail';
import { useLocale } from 'next-intl';
import { unescape } from 'lodash';

interface MobileTweetDetailProps {
  tweet: TrendTweet;
}

function formatNumber(num: number | string): string {
  const numValue = typeof num === 'string' ? parseInt(num, 10) : num;
  if (numValue >= 1_000_000) {
    return `${(numValue / 1_000_000).toFixed(1)}M`;
  }
  if (numValue >= 1_000) {
    return `${(numValue / 1_000).toFixed(1)}K`;
  }
  return numValue.toString();
}

function formatDetailedTimestamp(dateString: string): string {
  const date = new Date(dateString);
  const timeStr = date.toLocaleTimeString('zh-CN', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: false,
  });
  const month = date.getMonth() + 1;
  const day = date.getDate();
  return `${timeStr} · ${month}/${day}`;
}

export default function MobileTweetDetail({ tweet }: MobileTweetDetailProps) {
  const [isImagePreviewOpen, setIsImagePreviewOpen] = useState(false);
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const [canOpenPreview, setCanOpenPreview] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);
  const [translation, setTranslation] = useState<string | null>(null);
  const [showTranslation, setShowTranslation] = useState(false);
  const [translationError, setTranslationError] = useState<string | null>(null);
  const router = useRouter();
  const locale = useLocale();

  const [showOriginal, setShowOriginal] = useState(false);
  const isUsingPreTranslation = 
    (locale === 'zh' && !!tweet?.text_zh && tweet.text_zh !== tweet.text) || 
    (locale === 'en' && !!tweet?.text_en && tweet.text_en !== tweet.text);

  const imageUrls = useMemo(() => {
    if (!tweet?.media) return [];
    return tweet.media
      .filter((item) => item.type !== 'video')
      .map((item) => item.url);
  }, [tweet?.media]);

  useEffect(() => {
    setCanOpenPreview(false);
    const timer = setTimeout(() => setCanOpenPreview(true), 800);
    return () => clearTimeout(timer);
  }, [tweet?.id_str]);

  // Determine display text based on locale and available translations
  const getDisplayText = () => {
    let text = '';
    
    // If it's a retweet, we prioritize the retweeted content
    const targetTweet = tweet?.retweeted_tweet || tweet;
    
    // Type assertion needed because TrendTweet interface doesn't have text_zh/text_en yet
    // but the data might have it.
    const tweetAny = targetTweet as any;

    if (showOriginal) {
      text = targetTweet?.text ?? '';
    } else if (locale === 'zh' && tweetAny?.text_zh) {
      text = tweetAny.text_zh.replace(/\\n/g, '\n');
    } else if (locale === 'en' && tweetAny?.text_en) {
      text = tweetAny.text_en.replace(/\\n/g, '\n');
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
  
  const shouldOfferTranslation = useMemo(() => {
    if (!isUsingPreTranslation && !translationSource) return false;
    if (isUsingPreTranslation) return false;

    const cleaned = translationSource
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/[@#]\w+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (cleaned.length < 8) return false;

    const asciiMatches = cleaned.match(/[\u0000-\u007F]/g) ?? [];
    const nonAsciiMatches = cleaned.match(/[^\u0000-\u007F]/g) ?? [];
    if (asciiMatches.length === 0) return false;

    const ratio = asciiMatches.length / (asciiMatches.length + nonAsciiMatches.length);
    return ratio >= 0.85;
  }, [translationSource, isUsingPreTranslation]);

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
        body: JSON.stringify({ text: translationSource }),
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

  const formatTextWithLinks = (
    text: string,
    options?: {
      paragraphClassName?: string;
      textClassName?: string;
      linkClassName?: string;
    },
  ) => {
    const paragraphClassName =
      options?.paragraphClassName ??
      'font-twitter-chirp font-normal mt-1 whitespace-pre-line text-[15px] leading-relaxed tracking-tight text-gray-800 antialiased';
    const textClassName = options?.textClassName ?? 'font-twitter-chirp font-normal text-[15px] text-gray-800 leading-relaxed tracking-tight antialiased';
    const linkClassName =
      options?.linkClassName ?? 'font-twitter-chirp text-blue-500 hover:underline';

    const parts = unescape(text).split(/((?:https?:\/\/[^\s\u4e00-\u9fa5]+)|(?:@[\w\u4e00-\u9fa5]+)|(?:#[\w\u4e00-\u9fa5]+)|(?:\$[\w\u4e00-\u9fa5]+)(?![\w\u4e00-\u9fa5]))/);


    return (
      <p className={paragraphClassName}>
        {parts.map((part: string, index: number) => {
          if (!part) return null;

          if (part.match(/^https?:\/\//)) {
            return (
              <a
                key={index}
                href={part}
                className={linkClassName}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
              >
                {part}
              </a>
            );
          }

          if (part.match(/^[@#$]\w+/)) {
            if (part.startsWith('@')) {
              return (
                <a
                  key={index}
                  href={`https://x.com/${part.slice(1)}`}
                  className={linkClassName}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                >
                  {part}
                </a>
              );
            }
            return (
              <span key={index} className={linkClassName}>
                {part}
              </span>
            );
          }

          return (
            <span key={index} className={textClassName}>
              {part}
            </span>
          );
        })}
      </p>
    );
  };

  const renderTranslation = () => {
    // Translation controls moved to footer
    // Only show inline translation result if available
    if (!shouldOfferTranslation || !showTranslation || !translation) return null;

    return (
      <div className="font-twitter-chirp mt-2">
        {translationError && (
          <p className="text-xs text-red-500">{translationError}</p>
        )}
        <p className="font-twitter-chirp font-normal whitespace-pre-line text-[15px] leading-relaxed tracking-tight text-gray-800 antialiased">
          {translation}
        </p>
      </div>
    );
  };

  const renderMedia = (media: TrendTweet['media']) => {
    if (!media || media.length === 0) return null;

    const imageIndexMap = new Map<number, number>();
    let imageIndex = 0;
    media.forEach((item, mediaIndex) => {
      if (item.type !== 'video') {
        imageIndexMap.set(mediaIndex, imageIndex++);
      }
    });

    const handleImageClick = (e: React.MouseEvent, index: number) => {
      e.stopPropagation();
      if (!canOpenPreview) return;
      setSelectedImageIndex(index);
      setIsImagePreviewOpen(true);
    };

    return (
      <div className="mt-1.5 overflow-hidden rounded-2xl">
        {media.length === 1 && (
          <div className="relative h-[220px] w-full">
            {media[0].type === 'video' ? (
              <video
                src={media[0].url}
                poster={media[0].thumbnail}
                controls
                className="h-full w-full rounded-2xl border border-gray-100 object-cover"
              />
            ) : (
              <img
                src={media[0].url}
                alt="Tweet media"
                className="h-full w-full cursor-pointer rounded-2xl border border-gray-200 object-cover transition-opacity hover:opacity-90"
                onClick={(e) => handleImageClick(e, imageIndexMap.get(0) || 0)}
                loading="lazy"
                crossOrigin="anonymous"
              />
            )}
          </div>
        )}

        {media.length === 2 && (
          <div className="grid grid-cols-2 gap-1">
            {media.map((item, index) => (
              <div key={index} className="aspect-square">
                <img
                  src={item.url}
                  alt="Tweet media"
                  className={`h-full w-full cursor-pointer border border-gray-200 object-cover transition-opacity hover:opacity-90 ${
                    index === 0
                      ? 'rounded-bl-2xl rounded-tl-2xl'
                      : 'rounded-br-2xl rounded-tr-2xl'
                  }`}
                  onClick={(e) =>
                    handleImageClick(e, imageIndexMap.get(index) || 0)
                  }
                />
              </div>
            ))}
          </div>
        )}

        {media.length === 3 && (
          <div className="grid grid-cols-2 gap-1">
            <div className="aspect-square">
              <img
                src={media[0].url}
                alt="Tweet media"
                className="h-full w-full cursor-pointer rounded-bl-2xl rounded-tl-2xl border border-gray-200 object-cover transition-opacity hover:opacity-90"
                onClick={(e) =>
                  handleImageClick(e, imageIndexMap.get(0) || 0)
                }
              />
            </div>
            <div className="grid grid-rows-2 gap-1">
              {media.slice(1, 3).map((item, index) => (
                <div key={index} className="aspect-[2/1]">
                  <img
                    src={item.url}
                    alt="Tweet media"
                    className={`h-full w-full cursor-pointer border border-gray-200 object-cover transition-opacity hover:opacity-90 ${
                      index === 0 ? 'rounded-tr-2xl' : 'rounded-br-2xl'
                    }`}
                    onClick={(e) =>
                      handleImageClick(
                        e,
                        imageIndexMap.get(index + 1) || 0,
                      )
                    }
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {media.length >= 4 && (
          <div className="grid grid-cols-2 gap-1">
            <div className="grid grid-rows-2 gap-1">
              <div className="aspect-[2/1]">
                <img
                  src={media[0].url}
                  alt="Tweet media"
                  className="h-full w-full cursor-pointer rounded-tl-2xl border border-gray-200 object-cover transition-opacity hover:opacity-90"
                  onClick={(e) =>
                    handleImageClick(e, imageIndexMap.get(0) || 0)
                  }
                />
              </div>
              <div className="aspect-[2/1]">
                <img
                  src={media[1].url}
                  alt="Tweet media"
                  className="h-full w-full cursor-pointer rounded-bl-2xl border border-gray-200 object-cover transition-opacity hover:opacity-90"
                  onClick={(e) =>
                    handleImageClick(e, imageIndexMap.get(1) || 0)
                  }
                />
              </div>
            </div>
            <div className="grid grid-rows-2 gap-1">
              <div className="aspect-[2/1]">
                <img
                  src={media[2].url}
                  alt="Tweet media"
                  className="h-full w-full cursor-pointer rounded-tr-2xl border border-gray-200 object-cover transition-opacity hover:opacity-90"
                  onClick={(e) =>
                    handleImageClick(e, imageIndexMap.get(2) || 0)
                  }
                />
              </div>
              <div className="aspect-[2/1]">
                <img
                  src={media[3].url}
                  alt="Tweet media"
                  className="h-full w-full cursor-pointer rounded-br-2xl border border-gray-200 object-cover transition-opacity hover:opacity-90"
                  onClick={(e) =>
                    handleImageClick(e, imageIndexMap.get(3) || 0)
                  }
                />
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderQuotedTweet = (quotedTweet: TrendTweet['quoted_tweet']) => {
    if (!quotedTweet) return null;

    const handleNavigateToQuotedTweet = () => {
      if (!quotedTweet.id_str) return;
      router.push(`/tweet/${quotedTweet.id_str}`);
    };

    return (
      <div
        className="group mt-3 cursor-pointer rounded-2xl border border-gray-200 bg-white p-3 transition-colors hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#f0b90b]"
        onClick={(event) => {
          event.stopPropagation();
          handleNavigateToQuotedTweet();
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            event.stopPropagation();
            handleNavigateToQuotedTweet();
          }
        }}
      >
        <div className="flex items-center gap-2">
          <a
            href={`https://x.com/${quotedTweet.user.username}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <img
              src={quotedTweet.user.avatar}
              alt={`${quotedTweet.user.username}'s avatar`}
              className="h-6 w-6 rounded-full"
            />
          </a>
          <div className="flex items-center gap-1">
            <a
              href={`https://x.com/${quotedTweet.user.username}`}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:underline"
            >
              <span className="font-twitter-chirp truncate text-sm font-medium text-gray-900 max-w-[120px]">
                {quotedTweet.user.name}
              </span>
            </a>
            {quotedTweet.user.is_blue_verified && (
              <svg
                viewBox="0 0 22 22"
                aria-label="认证账号"
                role="img"
                className="h-[12px] w-[12px]"
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
          <a
            href={`https://x.com/${quotedTweet.user.username}`}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:underline"
          >
            <span className="font-twitter-chirp truncate text-xs text-gray-500 max-w-[150px]">
              @{quotedTweet.user.username}
            </span>
          </a>
        </div>

        {formatTextWithLinks(getQuotedDisplayText(quotedTweet), {
          paragraphClassName:
            'font-twitter-chirp font-normal mt-2 whitespace-pre-line text-sm leading-relaxed tracking-tight text-gray-800 antialiased',
          textClassName: 'font-twitter-chirp font-normal text-sm text-gray-800 leading-relaxed tracking-tight antialiased',
          linkClassName:
            'font-twitter-chirp text-sm text-blue-500 hover:underline',
        })}
      </div>
    );
  };

  return (
    <>
      <ImagePreviewModal
        isOpen={isImagePreviewOpen}
        imageUrl={imageUrls[selectedImageIndex] || ''}
        onClose={() => setIsImagePreviewOpen(false)}
        images={imageUrls}
        currentIndex={selectedImageIndex}
      />
      <div className="w-full bg-white">
        <article className="flex flex-col gap-1 px-4 pb-0 pt-3">
          <header className="flex items-start">
            <div className="flex w-full items-start gap-3">
              <a
                href={`https://x.com/${tweet.author.username}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <img
                  src={tweet.author.avatar}
                  alt={tweet.author.name}
                  className="h-11 w-11 rounded-full"
                />
              </a>
              <div className="flex flex-col flex-1">
                <div className="flex items-center gap-1">
                  <a
                    href={`https://x.com/${tweet.author.username}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-twitter-chirp text-base font-medium text-gray-900 hover:underline"
                  >
                    {tweet.author.name}
                  </a>
                  {tweet.author.is_blue_verified && (
                    <svg
                      viewBox="0 0 22 22"
                      aria-label="认证账号"
                      role="img"
                      className="h-[16px] w-[16px]"
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
                <div className="font-twitter-chirp flex items-center gap-2 text-xs">
                  <a
                    href={`https://x.com/${tweet.author.username}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-gray-500 hover:underline"
                  >
                    @{tweet.author.username}
                  </a>
                  {tweet.retweeted_tweet && (
                    <span className="ml-auto text-[11px] text-gray-500">
                      RT: @{tweet.retweeted_tweet.username}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </header>

          <section className="font-twitter-chirp font-normal text-[15px] leading-relaxed tracking-tight text-gray-800 antialiased">
            {formatTextWithLinks(displayText)}
            {renderTranslation()}
          </section>

          {renderMedia(tweet.media)}
          {renderQuotedTweet(tweet.quoted_tweet)}

          <div className="font-twitter-chirp mt-1.5 mb-1 flex items-center justify-between px-3 text-xs text-gray-500">
            <span>{formatDetailedTimestamp(tweet.created_at)}</span>
          </div>

          <footer className="font-twitter-chirp flex items-center justify-between border-y border-gray-100 py-3 text-xs text-gray-600">
            {/* Left: Show Original / Translate button */}
            <div className="flex items-center">
              {isUsingPreTranslation ? (
                <button
                  type="button"
                  className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-[11px] font-medium text-gray-600 transition hover:bg-gray-100"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowOriginal(!showOriginal);
                  }}
                >
                  {showOriginal
                    ? (locale === 'zh' ? '显示翻译' : 'Show Translation')
                    : (locale === 'zh' ? '显示原文' : 'Show Original')}
                </button>
              ) : shouldOfferTranslation ? (
                <button
                  type="button"
                  className="flex items-center gap-1.5 text-[12px] text-gray-500 transition hover:text-gray-700 disabled:opacity-50"
                  onClick={handleTranslate}
                  disabled={isTranslating}
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 21l5.25-11.25L21 21m-9-3h7.5M3 5.621a48.474 48.474 0 016-.371m0 0c1.12 0 2.233.038 3.334.114M9 5.25V3m3.334 2.364C11.176 10.658 7.69 15.08 3 17.502m9.334-12.138c.896.061 1.785.147 2.666.257m-4.589 8.495a18.023 18.023 0 01-3.827-5.802" />
                  </svg>
                  <span>{isTranslating ? 'Translating...' : showTranslation ? 'Hide' : 'Translate'}</span>
                </button>
              ) : null}
            </div>
            {/* Right: Stats */}
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1">
                <ChatBubbleOvalLeftIcon className="h-4 w-4" />
                <span className='text-xs'>{formatNumber(tweet.reply_count)}</span>
              </div>
              <div className="flex items-center gap-1">
                <ArrowPathRoundedSquareIcon className="h-4 w-4" />
                <span className='text-xs'>{formatNumber(tweet.retweet_count)}</span>
              </div>
              <div className="flex items-center gap-1">
                <HeartIcon className="h-4 w-4" />
                <span className='text-xs'>{formatNumber(tweet.like_count)}</span>
              </div>
              <div className="flex items-center gap-1">
                <EyeIcon className="h-4 w-4" />
                <span className='text-xs'>{formatNumber(tweet.view_count)}</span>
              </div>
            </div>
          </footer>
        </article>
      </div>
    </>
  );
}
