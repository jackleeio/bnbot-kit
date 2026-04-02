import React, { useState, useEffect } from 'react';
import {
  ChatBubbleOvalLeftIcon,
  ArrowPathRoundedSquareIcon,
  HeartIcon,
  PencilSquareIcon,
  EyeIcon,
  ShareIcon,
  ArrowTopRightOnSquareIcon,
} from '@heroicons/react/24/outline';
import { XIcon } from '@/components/icons/x-icon';
interface TweetProps {
  tweet: {
    id: string;
    text: string;
    created_at: string;
    likes: number;
    retweets: number;
    quotes: number;
    replies: number;
    views_count: number;
    bookmarks: number;
    lang: string;
    author: {
      rest_id: string;
      name: string;
      screen_name: string;
      image: string;
      blue_verified: boolean;
    };
    media?: {
      images?: Array<{
        media_url_https: string;
      }>;
    };
  };
  inAssetDetails?: boolean;
}
function TweetCard({ tweet, inAssetDetails = false }: TweetProps) {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkIfMobile = () => {
      setIsMobile(window.innerWidth <= 768);
    };

    checkIfMobile();
    window.addEventListener('resize', checkIfMobile);

    return () => window.removeEventListener('resize', checkIfMobile);
  }, []);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    return `${year}/${month}/${day}`;
  };

  const formatNumber = (num: number) => {
    if (isMobile || inAssetDetails) {
      if (num >= 1000000) {
        return inAssetDetails
          ? `${Math.floor(num / 1000000)}M`
          : `${(num / 1000000).toFixed(1)}M`;
      }
      return num >= 1000
        ? inAssetDetails
          ? `${Math.floor(num / 1000)}K`
          : `${(num / 1000).toFixed(1)}K`
        : num.toString();
    }
    return num.toLocaleString();
  };

  const formatText = (text: string) => {
    const maxLength = 280; // Twitter 的最大字符限制
    const truncatedText =
      text.length > maxLength ? text.slice(0, maxLength) + '...' : text;

    return truncatedText.split(/(\s+)/).map((part, index) => {
      if (part.startsWith('http')) {
        return null; // 移除链接
      }
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
    });
  };

  return (
    <div className="mb-4 w-full rounded-2xl bg-white p-3 shadow-card md:p-4">
      <div className="mb-2 flex items-start justify-between">
        <div className="flex items-start">
          <img
            className="mr-4 h-12 w-12 rounded-full"
            src={tweet.author.image}
            alt={tweet.author.name}
          />
          <div>
            <div className="flex items-center">
              <p className="text-xs font-semibold text-gray-900 md:text-sm">
                {tweet.author.name}
              </p>
              {tweet.author.blue_verified && (
                <svg
                  className="ml-1 h-4 w-4 text-blue-500"
                  fill="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path d="M20.396 11c-.018-.646-.215-1.275-.57-1.816-.354-.54-.852-.972-1.438-1.246.223-.607.27-1.264.14-1.897-.131-.634-.437-1.218-.882-1.687-.47-.445-1.053-.75-1.687-.882-.633-.13-1.29-.083-1.897.14-.273-.587-.704-1.086-1.245-1.44S11.647 1.62 11 1.604c-.646.017-1.273.213-1.813.568s-.969.854-1.24 1.44c-.608-.223-1.267-.272-1.902-.14-.635.13-1.22.436-1.69.882-.445.47-.749 1.055-.878 1.688-.13.633-.08 1.29.144 1.896-.587.274-1.087.705-1.443 1.245-.356.54-.555 1.17-.574 1.817.02.647.218 1.276.574 1.817.356.54.856.972 1.443 1.245-.224.606-.274 1.263-.144 1.896.13.634.433 1.218.877 1.688.47.443 1.054.747 1.687.878.633.132 1.29.084 1.897-.136.274.586.705 1.084 1.246 1.439.54.354 1.17.551 1.816.569.647-.016 1.276-.213 1.817-.567s.972-.854 1.245-1.44c.604.239 1.266.296 1.903.164.636-.132 1.22-.447 1.68-.907.46-.46.776-1.044.908-1.681s.075-1.299-.165-1.903c.586-.274 1.084-.705 1.439-1.246.354-.54.551-1.17.569-1.816zM9.662 14.85l-3.429-3.428 1.293-1.302 2.072 2.072 4.4-4.794 1.347 1.246z"></path>
                </svg>
              )}
            </div>
            <div className="text-xs text-gray-500 md:text-sm">
              <a
                href={`https://twitter.com/${tweet.author.screen_name}`}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:underline"
              >
                @{tweet.author.screen_name}
              </a>
              <span className="mx-1">·</span>
              <span className="text-xs text-gray-500 md:text-sm">
                {formatDate(tweet.created_at)}
              </span>
            </div>
          </div>
        </div>

        {inAssetDetails ? (
          <div className="flex gap-2">
            <button className="rounded-full bg-gray-100/80 p-1 hover:bg-gray-100">
              <span className="flex h-4 w-4 items-center justify-center rounded-full">
                𝕏
              </span>
            </button>
            <button className="rounded-full bg-gray-100/80 p-1 hover:bg-gray-100">
              <ArrowTopRightOnSquareIcon className="h-4 w-4 text-gray-600" />
            </button>
          </div>
        ) : (
          <div className="flex gap-2">
            <button className="rounded-full bg-gray-100/80 p-1 hover:bg-gray-100">
              <span className="flex h-4 w-4 items-center justify-center rounded-full">
                𝕏
              </span>
            </button>
          </div>
        )}
      </div>
      <p className="mb-2 line-clamp-4 text-xs text-gray-800 md:text-sm">
        {formatText(tweet.text)}
      </p>

      {/* Display images if available */}
      {tweet.media?.images && tweet.media.images.length > 0 && (
        <div
          className={`mb-4 grid h-48 w-48 gap-2 ${
            tweet.media.images.length === 1
              ? 'grid-cols-1'
              : tweet.media.images.length === 2
                ? 'grid-cols-2'
                : tweet.media.images.length === 3
                  ? 'grid-cols-2'
                  : 'grid-cols-2'
          }`}
        >
          {tweet.media.images.map((image, index) => (
            <div
              key={index}
              className={`relative overflow-hidden rounded-2xl border-[1px] border-solid border-gray-100 ${
                tweet.media?.images!.length === 3 && index === 0
                  ? 'col-span-2'
                  : ''
              }`}
            >
              <img
                src={image.media_url_https}
                alt={`Media ${index + 1}`}
                className="h-full w-full object-cover"
              />
            </div>
          ))}
        </div>
      )}

      <div className="flex justify-between text-xs text-gray-500 md:text-sm">
        <div className="flex items-center">
          <ChatBubbleOvalLeftIcon className="mr-1 h-4 w-4 md:h-5 md:w-5" />
          {formatNumber(tweet.replies)}
        </div>
        <div className="flex items-center">
          <ArrowPathRoundedSquareIcon className="mr-1 h-4 w-4 md:h-5 md:w-5" />
          {formatNumber(tweet.retweets)}
        </div>
        <div className="flex items-center">
          <HeartIcon className="mr-1 h-4 w-4 md:h-5 md:w-5" />
          {formatNumber(tweet.likes)}
        </div>
        <div className="flex items-center">
          <EyeIcon className="mr-1 h-4 w-4 md:h-5 md:w-5" />
          {formatNumber(tweet.views_count)}
        </div>
      </div>
    </div>
  );
}

export default TweetCard;
