import { useState, useEffect } from 'react';
import { type BoostPublic } from '@/lib/boost-api';
import defaultAssetImage from '@/assets/images/xid-logo-black.jpeg';
import { useRouter } from 'next/navigation';
import { useModal } from '@/components/ui/animated-modal';
import { formatUnits } from 'viem';

interface AssetCardProps {
  boost: BoostPublic;
}

function formatNumber(num: number): string {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toString();
}

function formatBudget(
  budget: string,
  tokenType: 'NATIVE' | 'ERC20',
  tokenSymbol: string,
): string {
  try {
    const decimals = tokenType === 'NATIVE' ? 18 : 6;
    const value = formatUnits(BigInt(budget), decimals);
    const num = parseFloat(value);
    return `${num.toLocaleString()} $${tokenSymbol}`;
  } catch {
    return `${budget} $${tokenSymbol}`;
  }
}

function getTimeRemaining(endTime: string | null): string {
  if (!endTime) return '';
  const diff = new Date(endTime).getTime() - Date.now();
  if (diff <= 0) return 'Ended';
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor(
    (diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60),
  );
  if (days > 0) return `${days}d ${hours}h`;
  return `${hours}h`;
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

export default function AssetCard({ boost }: AssetCardProps) {
  const router = useRouter();
  const { showBoostModal } = useModal();
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const updateIsMobile = () => setIsMobile(window.innerWidth <= 768);
    updateIsMobile();
    window.addEventListener('resize', updateIsMobile);
    return () => window.removeEventListener('resize', updateIsMobile);
  }, []);

  // Extract tweet data from snapshot
  const snapshot = boost.tweet_snapshot as Record<string, unknown> | null;
  const authorName =
    (snapshot?.author as Record<string, unknown>)?.name || boost.tweet_author;
  const authorImage =
    ((snapshot?.author as Record<string, unknown>)?.image as string) || '';
  const tweetText = boost.tweet_content || (snapshot?.text as string) || '';
  const media = snapshot?.media as
    | {
        images?: { media_url_https: string }[];
        videos?: { media_url_https: string; thumb_url: string }[];
      }
    | undefined;

  const participantCount =
    boost.quoter_paid_usernames.length + boost.retweeter_paid_usernames.length;
  const timeLeft = getTimeRemaining(boost.end_time);

  const handleCardClick = () => {
    if (isMobile) {
      router.push(`/boost/${boost.id}`);
    } else {
      showBoostModal(boost);
    }
  };

  const getMediaContent = () => {
    if (!media) {
      return (
        <figure className="flex h-36 w-36 items-center justify-center bg-gray-100">
          <img
            src={defaultAssetImage.src}
            alt="Default media"
            className="h-36 w-36 object-cover"
          />
        </figure>
      );
    }

    if (media.videos?.length) {
      const video = media.videos[0];
      return (
        <div className="relative h-48 w-full">
          <video
            className="h-48 w-full max-w-full object-cover"
            muted
            loop
            playsInline
            poster={video.media_url_https}
            preload="metadata"
          >
            <source src={video.thumb_url} type="video/mp4" />
          </video>
        </div>
      );
    }

    if (media.images?.length) {
      return (
        <figure className="flex h-36 w-36 items-start justify-start bg-gray-100">
          <img
            src={media.images[0].media_url_https}
            alt="Tweet media"
            className="h-36 w-36 object-cover"
            draggable={false}
            onError={(e) => {
              e.currentTarget.src = defaultAssetImage.src;
            }}
          />
        </figure>
      );
    }

    return (
      <figure className="flex h-36 w-36 items-center justify-center bg-gray-100">
        <img
          src={defaultAssetImage.src}
          alt="Default media"
          className="h-36 w-36 object-cover"
          draggable={false}
        />
      </figure>
    );
  };

  return (
    <div
      className="card-compact flex h-full flex-col overflow-hidden rounded-2xl border-[1px] border-t border-gray-100"
      onClick={handleCardClick}
    >
      <div className="card-body flex-grow !p-3 !pb-2 !pt-2.5 sm:!p-3 sm:!pb-2">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 overflow-hidden rounded-full">
            <img
              src={authorImage || defaultAssetImage.src}
              alt="Author profile"
              className="h-full w-full object-cover"
              onError={(e) => {
                e.currentTarget.src = defaultAssetImage.src;
              }}
            />
          </div>
          <div className="flex-grow">
            <div className="flex items-start justify-between">
              <div className="flex flex-col">
                <span className="text-[13px] font-medium text-black">
                  {authorName as string}
                </span>
                <span className="-mt-1 text-[12px] text-gray-500">
                  @{boost.tweet_author}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                {boost.status !== 'completed' && timeLeft && (
                  <span className="font-mono text-[13px] tabular-nums text-gray-500">
                    {timeLeft}
                  </span>
                )}
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${getStatusColor(boost.status)}`}
                >
                  {boost.status}
                </span>
              </div>
            </div>
          </div>
        </div>

        <p className="line-clamp-3 break-words text-xs leading-5">
          {tweetText.replace(/\s*https:\/\/t\.co\/\w+$/g, '')}
        </p>
        <div className="flex h-36 w-36 items-start justify-start overflow-hidden rounded-2xl border border-gray-200 bg-gray-100">
          {getMediaContent()}
        </div>
      </div>
      <div className="mb-2 flex justify-between px-3 text-xs text-gray-500">
        <div className="flex items-center">
          {formatNumber(participantCount)} Participants
        </div>
        <div className="flex items-center">
          {formatBudget(boost.total_budget, boost.token_type, boost.token_symbol)}
        </div>
      </div>
    </div>
  );
}
