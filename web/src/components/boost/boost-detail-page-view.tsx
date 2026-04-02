'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  EyeIcon,
  ArrowLeftIcon,
  UserGroupIcon,
} from '@heroicons/react/24/outline';
import { XIcon } from '@/components/icons/x-icon';
import BoostEngagementButton from '@/components/boost/boost-engagement-button';
import { formatUnits } from 'viem';
import {
  fetchTweetInfo,
  type BoostPublic,
  type TweetInfo,
} from '@/lib/boost-api';
import defaultAssetImage from '@/assets/images/xid-logo-black.jpeg';

interface BoostDetailPageViewProps {
  boost: BoostPublic;
  paymentStatus?: string | null;
  onBack?: () => void;
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
    return <span className="font-mono text-xs tabular-nums">--:--:--</span>;

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
    <span className="font-mono text-xs tabular-nums">
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

const formatBoostText = (text: string) =>
  text.replace(
    /(#|@|\$)([A-Za-z0-9_]+)/g,
    '<span class="text-[#F0B90B] font-medium">$1$2</span>',
  );

export default function BoostDetailPageView({
  boost,
  paymentStatus,
  onBack,
}: BoostDetailPageViewProps) {
  const [liveTweet, setLiveTweet] = useState<TweetInfo | null>(null);
  const lastScrollTopRef = useRef(0);
  const [headerTransform, setHeaderTransform] = useState(0);
  const [shouldAnimate, setShouldAnimate] = useState(false);
  const [rewardDisplay, setRewardDisplay] = useState<'total' | 'remaining'>(
    'total',
  );
  const HEADER_HEIGHT = 44;

  // Extract tweet data from snapshot
  const snapshot = boost.tweet_snapshot as Record<string, unknown> | null;
  const snapshotAuthor = snapshot?.author as Record<string, unknown> | undefined;
  const authorName = (snapshotAuthor?.name as string) || boost.tweet_author;
  const authorImage = (snapshotAuthor?.image as string) || '';
  const authorScreenName =
    (snapshotAuthor?.screen_name as string) || boost.tweet_author;
  const tweetText = boost.tweet_content || (snapshot?.text as string) || '';
  const tweetCreatedAt = (snapshot?.created_at as string) || boost.created_at;
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

  // Use live tweet data for engagement counts if available
  const viewsCount =
    liveTweet?.views_count ?? (snapshot?.views_count as number) ?? 0;
  const participantCount =
    boost.quoter_paid_usernames.length + boost.retweeter_paid_usernames.length;

  const totalBudgetDisplay = formatBudget(
    boost.total_budget,
    boost.token_type,
    boost.token_symbol,
  );
  const remainingBudget = (() => {
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

  // Toggle total/remaining display
  useEffect(() => {
    const interval = setInterval(() => {
      setRewardDisplay((prev) => (prev === 'total' ? 'remaining' : 'total'));
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  // Fetch live tweet engagement data
  useEffect(() => {
    const fetchLiveData = async () => {
      try {
        const info = await fetchTweetInfo(boost.tweet_id);
        setLiveTweet(info);
      } catch (err) {
        console.error('Error fetching live tweet info:', err);
      }
    };
    fetchLiveData();
  }, [boost.tweet_id]);

  const handleDetailScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    const currentScrollTop = target.scrollTop;
    const lastScrollTop = lastScrollTopRef.current;
    if (currentScrollTop <= HEADER_HEIGHT) {
      setShouldAnimate(false);
      setHeaderTransform(currentScrollTop);
    } else if (currentScrollTop > lastScrollTop) {
      setShouldAnimate(true);
      setHeaderTransform(HEADER_HEIGHT);
    } else {
      setShouldAnimate(true);
      setHeaderTransform(0);
    }
    lastScrollTopRef.current = currentScrollTop;
  };

  const renderTweetText = (text: string) => {
    const parts = text.split(
      /((?:https?:\/\/[^\s]+)|(?:@\w+)|(?:#\w+)|(?:\$\w+)(?!\w))/,
    );
    return (
      <p className="mt-2 whitespace-pre-line text-sm leading-snug text-gray-900">
        {parts.map((part, index) => {
          if (!part) return null;
          if (part.match(/^https?:\/\//)) {
            return (
              <a
                key={index}
                href={part}
                className="text-blue-500 hover:underline"
                target="_blank"
                rel="noopener noreferrer"
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
                  className="text-blue-500 hover:underline"
                  target="_blank"
                  rel="noopener noreferrer"
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
          return (
            <span key={index} className="text-sm text-gray-900">
              {part}
            </span>
          );
        })}
      </p>
    );
  };

  const quoteIntentUrl = `https://twitter.com/intent/tweet?text=Say%20something...%0A%23BNBOT%20%40BNBOT_AI%0A%0A&url=https://x.com/${authorScreenName}/status/${boost.tweet_id}`;
  const replyIntentUrl = `https://twitter.com/intent/tweet?text=%23BNBOT%20%40BNBOT_AI&in_reply_to=${boost.tweet_id}`;

  return (
    <div className="flex h-full min-h-screen flex-col bg-white">
      <header
        className="fixed inset-x-0 top-0 z-30 flex items-center justify-between bg-white/75 px-3 py-2 backdrop-blur-xl"
        style={{
          transform: `translateY(-${headerTransform}px)`,
          transition: shouldAnimate ? 'transform 0.3s ease-out' : 'none',
        }}
      >
        <div className="flex items-center gap-2">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="flex items-center justify-center rounded-full p-1.5 text-black transition hover:bg-gray-100"
              aria-label="返回"
            >
              <ArrowLeftIcon className="h-5 w-5" />
            </button>
          )}
          <h1 className="text-sm font-semibold text-gray-900">Boost Info</h1>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${getStatusColor(boost.status)}`}
          >
            {boost.status}
          </span>
          <div className="flex items-center gap-2 rounded-full border border-gray-200 px-3 py-1">
            <span className="relative flex h-3 w-3 flex-shrink-0 items-center justify-center">
              <span className="absolute h-3 w-3 rounded-full bg-[#f0b90b]/20" />
              <span className="blink relative block h-1.5 w-1.5 rounded-full bg-[#f0b90b]" />
            </span>
            <span className="text-xs text-gray-600">AI Monitoring</span>
          </div>
        </div>
      </header>

      <main
        className="hide-scrollbar flex-1 overflow-y-auto bg-white pb-12"
        style={{ paddingTop: `${HEADER_HEIGHT - 4}px` }}
        onScroll={handleDetailScroll}
      >
        <div className="mx-auto w-full max-w-xl px-3 pb-14 pt-2">
          {/* Payment status banner */}
          {paymentStatus === 'success' && (
            <div className="mb-3 rounded-xl border border-green-200 bg-green-50 p-3 text-center text-sm text-green-700">
              Payment successful! Your boost will be activated shortly.
            </div>
          )}
          {paymentStatus === 'cancel' && (
            <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-center text-sm text-amber-700">
              Payment was cancelled. You can try again.
            </div>
          )}

          <section>
            <div className="flex items-start gap-3">
              <img
                src={authorImage || defaultAssetImage.src}
                alt={authorName}
                className="h-11 w-11 rounded-full"
                onError={(e) => {
                  e.currentTarget.src = defaultAssetImage.src;
                }}
              />
              <div className="flex flex-1 items-start justify-between">
                <div>
                  <div className="flex items-center gap-1">
                    <h4 className="text-sm font-semibold text-gray-900">
                      {authorName}
                    </h4>
                    <span className="text-xs text-gray-500">
                      ·{' '}
                      {new Date(tweetCreatedAt).toLocaleDateString('zh-CN', {
                        month: 'short',
                        day: 'numeric',
                      })}
                    </span>
                  </div>
                  <div className="mt-0.5 text-xs text-gray-500">
                    @{authorScreenName}
                  </div>
                </div>
                <a
                  href={`https://x.com/${authorScreenName}/status/${boost.tweet_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-gray-500 transition hover:text-gray-700"
                >
                  <XIcon className="h-5 w-5" />
                </a>
              </div>
            </div>

            {renderTweetText(tweetText)}

            {media && (
              <div className="mt-3 overflow-hidden rounded-2xl border border-gray-200">
                {media.videos && media.videos.length > 0 ? (
                  <video
                    controls
                    playsInline
                    disablePictureInPicture
                    controlsList="nodownload noplaybackrate"
                    poster={media.videos[0].media_url_https}
                    className="max-h-[220px] w-full bg-black object-cover sm:max-h-[320px]"
                  >
                    <source
                      src={media.videos[0].large_url}
                      type="video/mp4"
                    />
                  </video>
                ) : media.images && media.images.length > 0 ? (
                  <img
                    src={media.images[0].media_url_https}
                    alt="Tweet media"
                    className="max-h-[240px] w-full bg-black object-cover sm:max-h-[360px]"
                    onError={(e) => {
                      e.currentTarget.src = defaultAssetImage.src;
                    }}
                  />
                ) : (
                  <img
                    src={defaultAssetImage.src}
                    alt="Default media"
                    className="max-h-[240px] w-full bg-black object-cover sm:max-h-[360px]"
                  />
                )}
              </div>
            )}

            <div className="mt-3 flex items-center border-y border-gray-100 py-2 text-xs text-gray-500">
              <div className="flex items-center gap-6">
                <span className="flex items-center gap-1">
                  <EyeIcon className="h-4 w-4" />
                  {formatNumber(viewsCount)}
                </span>
              </div>
              <div className="ml-auto flex items-center gap-1.5 text-gray-500">
                <UserGroupIcon className="h-4 w-4" />
                <span className="text-xs text-gray-500">Participants</span>
                <span>{formatNumber(participantCount)}</span>
              </div>
            </div>
          </section>

          <section className="mt-2 space-y-4 border-gray-100 pt-3">
            <div className="flex items-center justify-between">
              <div className="text-xs text-gray-500">
                Time
                <div className="-mt-0.5 text-sm font-medium text-gray-900">
                  <CountdownTimer endTime={boost.end_time} />
                </div>
              </div>
              <div className="rounded-full border border-gray-200 px-4 py-1.5 text-xs font-medium text-gray-700">
                <div className="relative h-6 w-full overflow-hidden">
                  <div
                    className="flex flex-col transition-transform duration-500 ease-in-out will-change-transform"
                    style={{
                      transform:
                        rewardDisplay === 'total'
                          ? 'translateY(0%)'
                          : 'translateY(-50%)',
                    }}
                  >
                    <div className="flex h-6 items-center justify-center gap-2 whitespace-nowrap">
                      <span>Total Rewards</span>
                      <span className="text-[#f0b90b]">
                        {totalBudgetDisplay}
                      </span>
                    </div>
                    <div className="flex h-6 items-center justify-center gap-2 whitespace-nowrap">
                      <span>Remaining</span>
                      <span className="text-[#f0b90b]">
                        {remainingBudget}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Pool distribution info */}
            <div className="rounded-xl bg-gray-50 p-3 text-xs text-gray-600">
              <div className="flex justify-between">
                <span>
                  Quoter Pool:{' '}
                  <strong className="text-[#f0b90b]">
                    {boost.quoter_pool_percentage * 100}%
                  </strong>
                </span>
                <span>
                  Retweeter Pool:{' '}
                  <strong className="text-[#f0b90b]">
                    {boost.retweeter_pool_percentage * 100}%
                  </strong>
                </span>
              </div>
            </div>

            <div
              className="mt-3 min-h-[4rem] whitespace-pre-line rounded-xl bg-gray-100/50 p-3 text-xs leading-relaxed text-gray-700 md:text-sm"
              dangerouslySetInnerHTML={{
                __html: formatBoostText(
                  `Quote or Retweet to earn ${totalBudgetDisplay}!\nQuoters: ${boost.quoter_pool_percentage * 100}% | Retweeters: ${boost.retweeter_pool_percentage * 100}%`,
                ),
              }}
            />

            <div className="mt-4 flex items-center justify-between text-sm text-gray-600">
              <span className="font-medium text-gray-700">
                Engagement Actions
              </span>
              <div className="flex items-center gap-3">
                <a
                  href={quoteIntentUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <button className="w-20 rounded-full bg-[#f0b90b] px-4 py-2 text-white transition hover:scale-105 hover:bg-[#f0b90b] hover:text-black">
                    Quote
                  </button>
                </a>
                <a
                  href={replyIntentUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <button className="w-20 rounded-full bg-[#f0b90b] px-4 py-2 text-white transition hover:scale-105 hover:bg-[#f0b90b] hover:text-black">
                    Reply
                  </button>
                </a>
              </div>
            </div>
          </section>
        </div>
      </main>
      <BoostEngagementButton
        className="fixed bottom-24 right-6 z-40"
        quoteUrl={quoteIntentUrl}
        replyUrl={replyIntentUrl}
      />
    </div>
  );
}
