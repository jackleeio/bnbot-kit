'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { ModalBody, ModalContent } from '@/components/ui/animated-modal';
import {
  ChatBubbleOvalLeftIcon,
  ArrowPathRoundedSquareIcon,
  HeartIcon,
  EyeIcon,
  LanguageIcon,
} from '@heroicons/react/24/outline';
import { XIcon } from '@/components/icons/x-icon';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { useLocale } from 'next-intl';
import { useModal } from '@/components/ui/animated-modal';
import { unescape } from 'lodash';
import ImagePreviewModal from '@/components/ui/image-preview-modal';
import { useTweetComments } from '@/hooks/useTweetComments';
import TweetCommentItem from '@/components/chat/TweetCommentItem';

const MAX_TRANSLATION_LENGTH = 1000;

const stripUrlsAndHandles = (text: string) =>
  text
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[@#]\w+/g, ' ')
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

export interface TrendTweet {
  id_str: string;
  created_at: string;
  text: string;
  text_zh?: string;
  text_en?: string;
  reply_count: number;
  retweet_count: number;
  like_count: number;
  quote_count: number;
  view_count: string;
  is_retweet: boolean;
  retweeted_status_id: string | null;
  is_quote: boolean;
  quoted_status_id: string | null;
  author: {
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
    text_zh?: string;
    text_en?: string;
    created_at: string;
    user: {
      name: string;
      username: string;
      avatar: string;
      is_blue_verified?: boolean;
      description?: string;
    };
  } | null;
  retweeted_tweet?: {
    text: string;
    text_zh?: string;
    text_en?: string;
    username: string;
  } | null;
  groupTweets?: TrendTweet[];
}

interface TweetDetailProps {
  tweet: TrendTweet | null;
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

export default function TweetDetail({ tweet: initialTweet }: TweetDetailProps) {
  const { setOpen } = useModal();
  const locale = useLocale();
  const [isImagePreviewOpen, setIsImagePreviewOpen] = useState(false);
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const [canOpenPreview, setCanOpenPreview] = useState(false);
  const [activeTweetIndex, setActiveTweetIndex] = useState(0);
  const [isTranslating, setIsTranslating] = useState(false);
  const [translation, setTranslation] = useState<string | null>(null);
  const [showTranslation, setShowTranslation] = useState(false);
  const [translationError, setTranslationError] = useState<string | null>(null);

  const router = useRouter();

  const {
    comments,
    isLoading: isCommentsLoading,
    hasMore: hasMoreComments,
    loadMoreComments
  } = useTweetComments(initialTweet?.id_str || '');

  const groupTweets = useMemo(() => {
    if (
      !initialTweet?.groupTweets ||
      !Array.isArray(initialTweet.groupTweets) ||
      initialTweet.groupTweets.length === 0
    ) {
      return undefined;
    }
    return initialTweet.groupTweets;
  }, [initialTweet]);

  const tweetCollection = groupTweets ?? (initialTweet ? [initialTweet] : []);

  useEffect(() => {
    setActiveTweetIndex(0);
  }, [initialTweet]);

  const tweet =
    tweetCollection[activeTweetIndex] ?? initialTweet ?? null;

  const [showOriginal, setShowOriginal] = useState(false);
  const isUsingPreTranslation =
    (locale === 'zh' && !!(tweet as any)?.text_zh && (tweet as any).text_zh !== tweet.text) ||
    (locale === 'en' && !!(tweet as any)?.text_en && (tweet as any).text_en !== tweet.text);

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

  const shouldOfferTranslation = useMemo(
    () => !isUsingPreTranslation && isLikelyEnglish(translationSource),
    [translationSource, isUsingPreTranslation],
  );

  // Extract all image URLs from media for the preview modal
  const imageUrls = useMemo(() => {
    if (!tweet?.media) return [];
    return tweet.media
      .filter(item => item.type !== 'video')
      .map(item => item.url);
  }, [tweet?.media]);

  useEffect(() => {
    setCanOpenPreview(false);
    const timer = setTimeout(() => {
      setCanOpenPreview(true);
    }, 800);
    return () => clearTimeout(timer);
  }, [tweet?.id_str]);

  useEffect(() => {
    setShowOriginal(false);
  }, [tweet?.id_str]);

  useEffect(() => {
    setIsTranslating(false);
    setShowTranslation(false);
    setTranslation(null);
    setTranslationError(null);
  }, [tweet?.id_str, translationSource]);

  useEffect(() => {
    const handleEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isImagePreviewOpen) {
        setOpen(false);
      }
    };

    if (!isImagePreviewOpen) {
      window.addEventListener('keydown', handleEsc, { capture: true });
      return () => {
        window.removeEventListener('keydown', handleEsc, { capture: true });
      };
    }
  }, [isImagePreviewOpen, setOpen]);

  if (!tweet) return null;

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
      'font-twitter-chirp font-[450] mt-1 whitespace-pre-line text-[15px] leading-relaxed tracking-tight text-gray-800 antialiased md:text-base';
    const textClassName =
      options?.textClassName ?? 'font-twitter-chirp font-normal text-sm leading-relaxed tracking-tight text-gray-800 antialiased md:text-base';
    const linkClassName =
      options?.linkClassName ?? 'font-twitter-chirp text-blue-500 hover:underline';

    const parts = unescape(text).split(/((?:https?:\/\/[^\s\u4e00-\u9fa5]+)|(?:@[\w\u4e00-\u9fa5]+)|(?:#[\w\u4e00-\u9fa5]+)|(?:\$[\w\u4e00-\u9fa5]+)(?![\w\u4e00-\u9fa5]))/);

    return (
      <p className={paragraphClassName}>
        {parts.map((part: string, index: number) => {
          if (!part) return null;

          // 处理链接
          if (part.match(/^https?:\/\//)) {
            return (
              <a
                key={index}
                href={part}
                className={linkClassName}
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
          // 处理 @用户名、#话题标签、$符号
          else if (part.match(/^[@#$]\w+/)) {
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
          // 普通文本
          return (
            <span key={index} className={textClassName}>
              {part}
            </span>
          );
        })}
      </p>
    );
  };

  const renderMedia = (media: TrendTweet['media']) => {
    if (!media || media.length === 0) return null;

    const handleImageClick = (e: React.MouseEvent, index: number) => {
      e.stopPropagation();
      if (canOpenPreview) {
        setSelectedImageIndex(index);
        setIsImagePreviewOpen(true);
      }
    };

    // Map media items to get the correct index for non-video items
    const imageIndexMap = new Map<number, number>();
    let imageIndex = 0;
    media.forEach((item, mediaIndex) => {
      if (item.type !== 'video') {
        imageIndexMap.set(mediaIndex, imageIndex++);
      }
    });

    return (
      <div className="mt-1.5 overflow-hidden">
        {media.length === 1 && (
          <div className="relative h-[200px] w-full max-w-[450px]">
            {media[0].type === 'video' ? (
              <video
                src={media[0].url}
                poster={media[0].thumbnail}
                controls
                className="h-full w-full rounded-2xl border border-gray-100 object-cover"
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <img
                src={media[0].url}
                alt="Tweet media"
                className="h-full w-full cursor-pointer rounded-2xl border border-gray-300 object-cover transition-opacity hover:opacity-90"
                onClick={(e) => handleImageClick(e, imageIndexMap.get(0) || 0)}
                loading="lazy"
                crossOrigin="anonymous"
              />
            )}
          </div>
        )}

        {media.length === 2 && (
          <div className="grid grid-cols-2 gap-2">
            {media.map((item, index) => (
              <div key={index} className="h-[300px] overflow-hidden rounded-xl border border-gray-200">
                <img
                  src={item.url}
                  alt="Tweet media"
                  className="h-full w-full cursor-pointer object-cover transition-opacity hover:opacity-90"
                  onClick={(e) => handleImageClick(e, imageIndexMap.get(index) || 0)}
                />
              </div>
            ))}
          </div>
        )}

        {media.length === 3 && (
          <div className="grid grid-cols-2 gap-0.5">
            <div className="aspect-square">
              <img
                src={media[0].url}
                alt="Tweet media"
                className="h-full w-full cursor-pointer rounded-bl-2xl rounded-tl-2xl border border-gray-100 object-cover transition-opacity hover:opacity-90"
                onClick={(e) => handleImageClick(e, imageIndexMap.get(0) || 0)}
              />
            </div>
            <div className="grid grid-rows-2 gap-0.5">
              {media.slice(1, 3).map((item, index) => (
                <div key={index} className="aspect-[2/1]">
                  <img
                    src={item.url}
                    alt="Tweet media"
                    className={`h-full w-full cursor-pointer border border-gray-100 object-cover transition-opacity hover:opacity-90 ${index === 0 ? 'rounded-tr-2xl' : 'rounded-br-2xl'
                      }`}
                    onClick={(e) => handleImageClick(e, imageIndexMap.get(index + 1) || 0)}
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {media.length >= 4 && (
          <div className="grid grid-cols-2 gap-0.5">
            <div className="grid grid-rows-2 gap-0.5">
              <div className="aspect-[2/1]">
                <img
                  src={media[0].url}
                  alt="Tweet media"
                  className="h-full w-full cursor-pointer rounded-tl-2xl border border-gray-100 object-cover transition-opacity hover:opacity-90"
                  onClick={(e) => handleImageClick(e, imageIndexMap.get(0) || 0)}
                />
              </div>
              <div className="aspect-[2/1]">
                <img
                  src={media[1].url}
                  alt="Tweet media"
                  className="h-full w-full cursor-pointer rounded-bl-2xl border border-gray-100 object-cover transition-opacity hover:opacity-90"
                  onClick={(e) => handleImageClick(e, imageIndexMap.get(1) || 0)}
                />
              </div>
            </div>
            <div className="grid grid-rows-2 gap-0.5">
              <div className="aspect-[2/1]">
                <img
                  src={media[2].url}
                  alt="Tweet media"
                  className="h-full w-full cursor-pointer rounded-tr-2xl border border-gray-100 object-cover transition-opacity hover:opacity-90"
                  onClick={(e) => handleImageClick(e, imageIndexMap.get(2) || 0)}
                />
              </div>
              <div className="aspect-[2/1]">
                <img
                  src={media[3].url}
                  alt="Tweet media"
                  className="h-full w-full cursor-pointer rounded-br-2xl border border-gray-100 object-cover transition-opacity hover:opacity-90"
                  onClick={(e) => handleImageClick(e, imageIndexMap.get(3) || 0)}
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
        className="group mt-3 cursor-pointer rounded-2xl border border-gray-200 bg-white p-4 transition-colors hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#f0b90b]"
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
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={quotedTweet.user.avatar}
              alt={`${quotedTweet.user.username}'s avatar`}
              className="h-6 w-6 rounded-full"
            />
          </a>
          <a
            href={`https://x.com/${quotedTweet.user.username}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="hover:underline"
          >
            <span className="font-twitter-chirp truncate text-xs font-medium text-gray-900 md:text-sm max-w-[200px]">
              {quotedTweet.user.name}
            </span>
          </a>
          <a
            href={`https://x.com/${quotedTweet.user.username}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="hover:underline"
          >
            <span className="font-twitter-chirp truncate text-xs text-gray-500 md:text-sm max-w-[200px]">
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
      <ModalBody className="h-full w-full rounded-none bg-white shadow-xl sm:m-0 md:rounded-2xl">
        <div className="flex h-full flex-col md:flex-row">
          {/* Left Column: Tweet Content */}
          <div className="flex flex-1 flex-col border-r border-gray-100 p-0 md:w-[55%]">
            <div className="flex-1 overflow-y-auto">
              <ModalContent className="min-h-full p-3 md:p-0">
                <div className="flex flex-1 flex-col space-y-2 p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex items-start space-x-3">
                      <a
                        href={`https://x.com/${tweet.author.username}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <img
                          src={tweet.author.avatar}
                          alt={tweet.author.name}
                          className="h-10 w-10 rounded-full shadow-xl md:h-11 md:w-11"
                        />
                      </a>
                      <div className="flex flex-1 items-start justify-between leading-3">
                        <div className="flex flex-col flex-1">
                          <div className="flex items-center gap-1">
                            <a
                              href={`https://x.com/${tweet.author.username}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="hover:underline"
                            >
                              <h4 className="font-twitter-chirp truncate text-sm font-medium md:text-base max-w-[240px]">
                                {tweet.author.name}
                              </h4>
                            </a>
                            <p className="font-twitter-chirp text-xs text-gray-500 md:text-sm">
                              · {formatDateTime(tweet.created_at)}
                            </p>
                          </div>
                          <div className="mt-0.5 flex items-center gap-2 text-gray-500">
                            <a
                              href={`https://x.com/${tweet.author.username}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="font-twitter-chirp text-xs text-gray-500 md:text-sm"
                            >
                              <span className="truncate max-w-[260px]">@{tweet.author.username}</span>
                            </a>
                            {tweet.retweeted_tweet && (
                              <span className="font-twitter-chirp ml-auto text-xs text-gray-500 md:text-sm">
                                RT: @{tweet.retweeted_tweet.username}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <a
                        href={`https://x.com/${tweet.author.username}/status/${tweet.id_str}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="-mr-1 -mt-1 rounded-full p-2 transition-colors hover:bg-gray-100"
                      >
                        <XIcon className="h-5 w-5 p-0.5" />
                      </a>
                    </div>
                  </div>

                  {tweetCollection.length > 1 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {tweetCollection.map((item, index) => (
                        <button
                          key={item.id_str || index}
                          onClick={(event) => {
                            event.stopPropagation();
                            setActiveTweetIndex(index);
                          }}
                          className={`font-twitter-chirp rounded-full border px-3 py-1 text-xs font-medium transition ${index === activeTweetIndex
                              ? 'border-[#f0b90b] bg-[#fff6db] text-gray-900'
                              : 'border-gray-200 text-gray-500 hover:border-gray-300'
                            }`}
                        >
                          推文 {index + 1}
                        </button>
                      ))}
                    </div>
                  )}

                  {formatTextWithLinks(displayText)}
                  {shouldOfferTranslation && (showTranslation || translationError) && (
                    <div className="font-twitter-chirp mt-1 text-xs">
                      {translationError && (
                        <p className="mt-1 text-xs text-red-500">{translationError}</p>
                      )}
                      {showTranslation && translation && (
                        <p className="font-twitter-chirp font-normal mt-1 whitespace-pre-line text-sm leading-relaxed tracking-tight text-gray-800 antialiased md:text-base">
                          {translation}
                        </p>
                      )}
                    </div>
                  )}
                  {renderMedia(tweet.media)}
                  {renderQuotedTweet(tweet.quoted_tweet)}
                </div>
              </ModalContent>
            </div>

            {/* Fixed Stats Footer */}
            <div className="border-t border-gray-100 bg-white py-2 px-4">
              <div className="font-twitter-chirp mt-1.5 mb-1 flex items-center justify-between px-3 text-xs text-gray-500 md:text-sm">
                <div className="flex items-center">
                  {isUsingPreTranslation ? (
                    <button
                      type="button"
                      className="group flex items-center gap-1.5 rounded-full px-2 py-1 text-[12px] font-normal text-gray-500 transition-all hover:bg-gray-100 hover:text-gray-900 active:scale-95 disabled:opacity-50"
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowOriginal(!showOriginal);
                      }}
                    >
                      <LanguageIcon className="h-4 w-4 transition-transform group-hover:scale-110" />
                      <span>
                        {showOriginal
                          ? (locale === 'zh' ? '显示翻译' : 'Show Translation')
                          : (locale === 'zh' ? '显示原文' : 'Show Original')}
                      </span>
                    </button>
                  ) : shouldOfferTranslation && (
                    <button
                      type="button"
                      className="group flex items-center gap-1.5 rounded-full px-2 py-1 text-[12px] font-normal text-gray-500 transition-all hover:bg-gray-100 hover:text-gray-900 active:scale-95 disabled:opacity-50"
                      onClick={handleTranslate}
                      disabled={isTranslating}
                    >
                      <LanguageIcon className="h-4 w-4 transition-transform group-hover:scale-110" />
                      <span>
                        {isTranslating ? '翻译中...' : showTranslation ? '收起翻译' : '翻译'}
                      </span>
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-6">
                  <div className="flex items-center text-xs">
                    <ChatBubbleOvalLeftIcon className="mr-1 h-4 w-4 md:h-5 md:w-5" />
                    <span className="mt-0.5 text-gray-500">
                      {formatNumber(tweet.reply_count)}
                    </span>
                  </div>
                  <div className="flex items-center text-xs">
                    <ArrowPathRoundedSquareIcon className="mr-1 h-4 w-4 md:h-5 md:w-5" />
                    <span className="mt-0.5 text-gray-500">
                      {formatNumber(tweet.retweet_count)}
                    </span>
                  </div>
                  <div className="flex items-center text-xs">
                    <HeartIcon className="mr-1 h-4 w-4 md:h-5 md:w-5" />
                    <span className="mt-0.5 text-gray-500">
                      {formatNumber(tweet.like_count)}
                    </span>
                  </div>
                  <div className="flex items-center text-xs">
                    <EyeIcon className="mr-1 h-4 w-4 md:h-5 md:w-5" />
                    <span className="mt-0.5 text-gray-500">
                      {formatNumber(tweet.view_count)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Comments */}
          <div className="hidden h-full flex-col overflow-hidden bg-white md:flex md:w-[45%]">
            <div className="border-b border-gray-200 bg-white px-4 py-3">
              <h3 className="font-twitter-chirp text-lg font-bold text-gray-900">
                {locale === 'zh' ? '评论' : 'Comments'}
              </h3>
            </div>
            <div className="flex-1 overflow-y-auto">
              {isCommentsLoading && comments.length === 0 ? (
                <div className="flex h-40 items-center justify-center">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-200 border-t-blue-500"></div>
                </div>
              ) : comments.length > 0 ? (
                <div className="divide-y divide-gray-100 bg-white">
                  {comments.map((comment) => (
                    <TweetCommentItem
                      key={comment.tweet_id}
                      comment={comment}
                      originalTweetAuthor={tweet.author.username}
                      tweetText={tweet.text}
                    />
                  ))}
                  {hasMoreComments && (
                    <div className="p-4 text-center">
                      <button
                        onClick={loadMoreComments}
                        disabled={isCommentsLoading}
                        className="mx-auto flex items-center justify-center rounded-full border border-gray-100 bg-white px-5 py-1.5 text-xs font-medium text-gray-600 shadow-sm transition-all hover:bg-gray-50 hover:text-gray-900 active:scale-95 disabled:opacity-50"
                      >
                        {isCommentsLoading
                          ? (locale === 'zh' ? '加载中...' : 'Loading...')
                          : (locale === 'zh' ? '加载更多评论' : 'Load more comments')}
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex h-40 flex-col items-center justify-center text-gray-500">
                  <ChatBubbleOvalLeftIcon className="mb-2 h-8 w-8 text-gray-300" />
                  <p className="text-sm">
                    {locale === 'zh' ? '暂无评论' : 'No comments'}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </ModalBody>
    </>
  );
}
