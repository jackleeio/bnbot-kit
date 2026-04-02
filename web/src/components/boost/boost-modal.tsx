'use client';

import React, { useState, useEffect } from 'react';
import { ModalBody, ModalContent } from '@/components/ui/animated-modal';
import {
  ChatBubbleOvalLeftIcon,
  ArrowPathRoundedSquareIcon,
  HeartIcon,
  EyeIcon,
  XMarkIcon,
  UserGroupIcon,
} from '@heroicons/react/24/outline';
import { XIcon } from '@/components/icons/x-icon';
import {
  fetchTweetInfo,
  type BoostPublic,
  type TweetInfo,
} from '@/lib/boost-api';
import { formatUnits } from 'viem';
import defaultAssetImage from '@/assets/images/xid-logo-black.jpeg';

interface BoostModalProps {
  boost: BoostPublic | null;
}

function formatNumber(num: number | undefined | null): string {
  if (num === undefined || num === null) return '0';
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toString();
}

function formatBudget(
  amount: string,
  tokenType: 'NATIVE' | 'ERC20',
  symbol: string,
): string {
  try {
    const decimals = tokenType === 'NATIVE' ? 18 : 6;
    const value = formatUnits(BigInt(amount), decimals);
    const num = parseFloat(value);
    return `${num.toLocaleString()} ${symbol}`;
  } catch {
    return `${amount} ${symbol}`;
  }
}

function CountdownTimer({ endTime }: { endTime: string | null }) {
  const [timeLeft, setTimeLeft] = useState(0);

  useEffect(() => {
    if (!endTime) return;
    const calcTimeLeft = () => {
      const diff = new Date(endTime).getTime() - Date.now();
      return Math.max(0, diff);
    };
    setTimeLeft(calcTimeLeft());
    const timer = setInterval(() => setTimeLeft(calcTimeLeft()), 1000);
    return () => clearInterval(timer);
  }, [endTime]);

  if (!endTime)
    return <span className="font-mono text-sm tabular-nums">--:--:--</span>;

  const formatTime = (ms: number) => {
    if (ms <= 0) return '00:00:00';
    const days = Math.floor(ms / (24 * 60 * 60 * 1000));
    const hours = Math.floor(
      (ms % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000),
    );
    const minutes = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));
    const seconds = Math.floor((ms % (60 * 1000)) / 1000);
    if (days > 0)
      return `${days}d ${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  return (
    <span className="font-mono text-sm tabular-nums">
      {formatTime(timeLeft)}
    </span>
  );
}

function getStatusColor(status: string): string {
  switch (status) {
    case 'active':
      return 'bg-green-100 text-green-700';
    case 'pending':
      return 'bg-yellow-100 text-yellow-700';
    case 'completed':
      return 'bg-gray-100 text-gray-600';
    case 'distributing':
      return 'bg-blue-100 text-blue-700';
    case 'cancelled':
      return 'bg-red-100 text-red-600';
    default:
      return 'bg-gray-100 text-gray-600';
  }
}

const formatBoostText = (text: string) => {
  const formattedText = text.replace(
    /(#|@|\$)([A-Za-z0-9_]+)/g,
    '<span class="text-[#F0B90B] font-medium">$1$2</span>',
  );
  return <div dangerouslySetInnerHTML={{ __html: formattedText }} />;
};

export default function BoostModal({ boost }: BoostModalProps) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [liveTweet, setLiveTweet] = useState<TweetInfo | null>(null);
  const [canSetFullscreen, setCanSetFullscreen] = useState(false);

  // Extract tweet data from snapshot
  const snapshot = boost?.tweet_snapshot as Record<string, unknown> | null;
  const snapshotAuthor = snapshot?.author as
    | Record<string, unknown>
    | undefined;
  const authorName =
    (snapshotAuthor?.name as string) || boost?.tweet_author || '';
  const authorImage = (snapshotAuthor?.image as string) || '';
  const authorScreenName =
    (snapshotAuthor?.screen_name as string) || boost?.tweet_author || '';
  const tweetText =
    boost?.tweet_content || (snapshot?.text as string) || '';
  const tweetCreatedAt =
    (snapshot?.created_at as string) || boost?.created_at || '';
  const media = snapshot?.media as
    | {
        images?: { media_url_https: string }[];
        videos?: {
          media_url_https: string;
          thumb_url: string;
          large_url: string;
        }[];
      }
    | undefined;

  const viewsCount =
    liveTweet?.views_count ?? (snapshot?.views_count as number) ?? 0;
  const repliesCount = liveTweet?.replies ?? 0;
  const retweetsCount = liveTweet?.retweets ?? 0;
  const likesCount = liveTweet?.likes ?? 0;

  const participantCount = boost
    ? boost.quoter_paid_usernames.length +
      boost.retweeter_paid_usernames.length
    : 0;

  const totalBudgetDisplay = boost
    ? formatBudget(boost.total_budget, boost.token_type, boost.token_symbol)
    : '0';

  const remainingBudget = (() => {
    if (!boost) return '0';
    try {
      const remaining =
        BigInt(boost.total_budget) - BigInt(boost.total_distributed);
      return formatBudget(
        remaining.toString(),
        boost.token_type,
        boost.token_symbol,
      );
    } catch {
      return totalBudgetDisplay;
    }
  })();

  useEffect(() => {
    setCanSetFullscreen(false);
    const timer = setTimeout(() => setCanSetFullscreen(true), 800);
    return () => clearTimeout(timer);
  }, [boost?.id]);

  // Fetch live tweet engagement data
  useEffect(() => {
    if (!boost?.tweet_id) return;
    const fetchLiveData = async () => {
      try {
        const info = await fetchTweetInfo(boost.tweet_id);
        setLiveTweet(info);
      } catch (err) {
        console.error('Error fetching live tweet info:', err);
      }
    };
    fetchLiveData();
  }, [boost?.tweet_id]);

  if (!boost) return null;

  const quoteIntentUrl = `https://twitter.com/intent/tweet?text=Say%20something...%0A%23BNBOT%20%40BNBOT_AI%0A%0A&url=https://x.com/${authorScreenName}/status/${boost.tweet_id}`;
  const replyIntentUrl = `https://twitter.com/intent/tweet?text=%23BNBOT%20%40BNBOT_AI&in_reply_to=${boost.tweet_id}`;

  return (
    <div className="mx-auto w-full max-w-7xl sm:px-4">
      <ModalBody className="rounded-lg bg-white shadow-xl sm:m-4">
        <ModalContent>
          <div className="flex flex-col space-y-4 md:flex-row md:space-x-4 md:space-y-0">
            {/* Left: Tweet Content */}
            <div className="flex w-full flex-col justify-between space-y-4 rounded-xl border border-gray-100 p-3 pb-2 md:w-1/2">
              <div className="overflow-y-auto md:h-[400px]">
                <div className="flex h-full flex-col">
                  <div className="space-y-4">
                    <div className="flex items-start space-x-3">
                      <img
                        src={authorImage || defaultAssetImage.src}
                        alt={authorName}
                        className="h-10 w-10 rounded-full shadow-xl md:h-11 md:w-11"
                        onError={(e) => {
                          e.currentTarget.src = defaultAssetImage.src;
                        }}
                      />
                      <div className="flex flex-1 items-start justify-between leading-3">
                        <div>
                          <div className="flex items-center gap-1">
                            <h4 className="text-xs font-bold md:text-sm">
                              {authorName}
                            </h4>
                            <p className="text-xs text-gray-500 md:text-sm">
                              ·{' '}
                              {new Date(tweetCreatedAt).toLocaleDateString(
                                'en-US',
                                {
                                  month: 'short',
                                  day: 'numeric',
                                },
                              )}
                            </p>
                          </div>
                          <div className="flex items-center gap-1 text-gray-500">
                            <p className="text-xs md:text-sm">
                              @{authorScreenName}
                            </p>
                          </div>
                        </div>
                        <a
                          href={`https://x.com/${authorScreenName}/status/${boost.tweet_id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="ml-2 text-gray-500 hover:text-gray-700"
                        >
                          <XIcon className="h-5 w-5" />
                        </a>
                      </div>
                    </div>

                    <p className="!mt-1.5 line-clamp-4 text-sm !leading-[1.5] md:text-md">
                      {tweetText.split(/(\s+)/).map((part, index) => {
                        if (part.startsWith('http')) return null;
                        if (part.startsWith('@')) {
                          const username = part.substring(1);
                          return (
                            <a
                              key={index}
                              href={`https://x.com/${username}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[#1DA1F2] hover:underline"
                            >
                              {part}
                            </a>
                          );
                        }
                        return part;
                      })}
                    </p>

                    {media && (
                      <div className="!mt-1.5 h-fit w-fit overflow-hidden rounded-xl border border-[1px] border-gray-200">
                        {media.videos && media.videos.length > 0 ? (
                          <video
                            controls
                            autoPlay
                            playsInline
                            disablePictureInPicture
                            controlsList="nodownload noplaybackrate"
                            poster={media.videos[0].media_url_https}
                            className="h-[200px] w-[320px] bg-black object-cover [&::-webkit-media-controls-mute-button]:hidden [&::-webkit-media-controls-volume-slider]:hidden"
                          >
                            <source
                              src={media.videos[0].large_url}
                              type="video/mp4"
                            />
                          </video>
                        ) : media.images && media.images.length > 0 ? (
                          <>
                            {isFullscreen && (
                              <div
                                className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-90"
                                onClick={() => setIsFullscreen(false)}
                              >
                                <button
                                  className="absolute right-4 top-4 rounded-full p-2 text-white transition-colors hover:bg-white/10"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setIsFullscreen(false);
                                  }}
                                >
                                  <XMarkIcon className="h-6 w-6" />
                                </button>
                                <img
                                  src={media.images[0].media_url_https}
                                  alt="Tweet media"
                                  className="max-w-screen max-h-screen object-contain"
                                  onClick={(e) => e.stopPropagation()}
                                  onError={(e) => {
                                    e.currentTarget.src =
                                      defaultAssetImage.src;
                                  }}
                                />
                              </div>
                            )}
                            <div className="h-[220px] w-[220px] bg-black">
                              <img
                                src={media.images[0].media_url_https}
                                alt="Tweet media"
                                className="h-[220px] w-[220px] cursor-pointer bg-black object-cover"
                                onClick={() => {
                                  if (canSetFullscreen) setIsFullscreen(true);
                                }}
                                onError={(e) => {
                                  e.currentTarget.src = defaultAssetImage.src;
                                }}
                              />
                            </div>
                          </>
                        ) : (
                          <div className="h-[220px] w-[220px] bg-black">
                            <img
                              src={defaultAssetImage.src}
                              alt="Default media"
                              className="h-[220px] w-[220px] cursor-pointer bg-black object-cover"
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="mt-auto border-t border-gray-100 pt-2">
                <div className="flex w-full justify-between text-xs text-gray-500 md:text-sm">
                  <div className="flex items-center text-xs">
                    <ChatBubbleOvalLeftIcon className="mr-1 h-4 w-4 md:h-5 md:w-5" />
                    <span className="mt-0.5">
                      {formatNumber(repliesCount)}
                    </span>
                  </div>
                  <div className="flex items-center text-xs">
                    <ArrowPathRoundedSquareIcon className="mr-1 h-4 w-4 md:h-5 md:w-5" />
                    <span className="mt-0.5">
                      {formatNumber(retweetsCount)}
                    </span>
                  </div>
                  <div className="flex items-center text-xs">
                    <HeartIcon className="mr-1 h-4 w-4 md:h-5 md:w-5" />
                    <span className="mt-0.5">
                      {formatNumber(likesCount)}
                    </span>
                  </div>
                  <div className="flex items-center text-xs">
                    <EyeIcon className="mr-1 h-4 w-4 md:h-5 md:w-5" />
                    <span className="mt-0.5">
                      {formatNumber(viewsCount)}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Right: Boost Info */}
            <div className="flex w-full flex-col space-y-2 rounded-xl px-2 md:w-1/2">
              <div className="mb-6">
                <div className="mb-2 mt-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <p className="text-md font-medium">Boost Info</p>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${getStatusColor(boost.status)}`}
                    >
                      {boost.status}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 rounded-full border border-gray-200 px-3 py-1">
                    <span className="relative flex h-3 w-3 flex-shrink-0 items-center justify-center">
                      <span className="absolute h-3 w-3 rounded-full bg-[#f0b90b]/20" />
                      <span className="blink relative block h-1.5 w-1.5 rounded-full bg-[#f0b90b]" />
                    </span>
                    <span className="text-xs text-gray-600">
                      AI Monitoring
                    </span>
                  </div>
                </div>
                <div className="mt-3 flex min-h-[8rem] items-start rounded-xl bg-gray-100/50 p-3 text-sm text-gray-600">
                  {formatBoostText(
                    `Quote or Retweet to earn ${totalBudgetDisplay}!\nQuoters: ${boost.quoter_pool_percentage * 100}% | Retweeters: ${boost.retweeter_pool_percentage * 100}%`,
                  )}
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between text-sm text-gray-600">
                  <div>Remaining Time</div>
                  <div>
                    <CountdownTimer endTime={boost.end_time} />
                  </div>
                </div>
                <div className="flex justify-between">
                  <p className="text-sm text-gray-600">Remaining Rewards</p>
                  <p className="text-sm font-medium">{remainingBudget}</p>
                </div>
                <div className="flex justify-between">
                  <p className="text-sm text-gray-600">Total Reward</p>
                  <p className="text-sm font-medium">{totalBudgetDisplay}</p>
                </div>
                <div className="flex items-center justify-between text-sm text-gray-600">
                  <div className="flex items-center gap-1">
                    <UserGroupIcon className="h-4 w-4" />
                    <span>Participants</span>
                  </div>
                  <div>{formatNumber(participantCount)}</div>
                </div>
                <div className="flex justify-between text-sm text-gray-600">
                  <span>Pool Split</span>
                  <span>
                    Quoters {boost.quoter_pool_percentage * 100}% / Retweeters{' '}
                    {boost.retweeter_pool_percentage * 100}%
                  </span>
                </div>

                <div className="flex items-center justify-between text-sm text-gray-600">
                  <div>Quote Tweet</div>
                  <div>
                    <a
                      href={quoteIntentUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <button className="w-20 rounded-full bg-[#f0b90b] px-3 py-1.5 text-white transition-all duration-300 hover:scale-110 hover:bg-[#f0b90b] hover:text-black">
                        Quote
                      </button>
                    </a>
                  </div>
                </div>

                <div className="flex items-center justify-between text-sm text-gray-600">
                  <div>Leave Comments</div>
                  <div>
                    <a
                      href={replyIntentUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <button className="w-20 rounded-full bg-[#f0b90b] px-3 py-1.5 text-white transition-all duration-300 hover:scale-110 hover:bg-[#f0b90b] hover:text-black">
                        Reply
                      </button>
                    </a>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </ModalContent>
      </ModalBody>
    </div>
  );
}
