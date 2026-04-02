interface TweetCardProps {
    tweet: {
      id: string;
      text: string;
      created_at: string;
      media: {
        type: string;
        media_url_https: string;
        video_info?: {
          variants: {
            url: string;
            content_type: string;
            bitrate?: number;
          }[];
        };
      }[];
      author: {
        name: string;
        screen_name: string;
        profile_image: string;
      };
      stats: {
        retweets: number;
        likes: number;
        replies: number;
        views_count?: number;
        quote_count?: number;
        holders_count?: number;
      };
      price?: {
        amount: number;
        currency: string;
        market_cap?: number;
      };
    };
  }
  
  import {
    ChatBubbleOvalLeftIcon,
    ArrowPathRoundedSquareIcon,
    HeartIcon,
    EyeIcon,
    ChatBubbleLeftRightIcon,
  } from '@heroicons/react/24/outline';
  
  function formatNumber(num: number): string {
    if (num >= 1000000) {
      return `${(num / 1000000).toFixed(1)}M`;
    }
    if (num >= 1000) {
      return `${(num / 1000).toFixed(1)}K`;
    }
    return num.toString();
  }
  
  export default function TweetCard({ tweet }: TweetCardProps) {
    const getMediaContent = () => {
      if (!tweet.media?.length) return null;
  
      const media = tweet.media[0];
      if (media.type === 'video') {
        const videoUrl = media.video_info?.variants
          .filter(v => v.content_type === 'video/mp4')
          .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0]?.url;
  
        return videoUrl ? (
          <video 
            className="w-full h-48 object-cover" 
            autoPlay 
            muted 
            loop 
            playsInline
          >
            <source src={videoUrl} type="video/mp4" />
          </video>
        ) : null;
      }
  
      return (
        <figure>
          <img 
            src={media.media_url_https} 
            alt="Tweet media" 
            className="w-full h-48 object-cover"
          />
        </figure>
      );
    };
  
    return (
      <div className="card-compact rounded-xl overflow-hidden flex flex-col h-full">
        {getMediaContent()}
        <div className="card-body flex-grow">
          <div className="flex items-center gap-2 mb-2">
            <div className="avatar">
              <div className="w-8 rounded-full">
                <img src={tweet.author.profile_image} alt={tweet.author.name} />
              </div>
            </div>
            <div>
              <h3 className="font-bold text-sm">{tweet.author.name}</h3>
              <p className="text-xs text-gray-500">@{tweet.author.screen_name}</p>
            </div>
          </div>
          
          <p className="text-sm line-clamp-2">{tweet.text}</p>
        </div>
        <div className="grid grid-cols-5 gap-2 text-xs text-gray-500 mb-3 px-4">
          <div className="flex items-center hover:text-blue-500 transition-colors cursor-pointer">
            <ChatBubbleOvalLeftIcon className="mr-1 h-4 w-4" />
            {formatNumber(tweet.stats.replies)}
          </div>
          <div className="flex items-center hover:text-green-500 transition-colors cursor-pointer">
            <ArrowPathRoundedSquareIcon className="mr-1 h-4 w-4" />
            {formatNumber(tweet.stats.retweets)}
          </div>
    
          <div className="flex items-center hover:text-pink-500 transition-colors cursor-pointer">
            <HeartIcon className="mr-1 h-4 w-4" />
            {formatNumber(tweet.stats.likes)}
          </div>
          {tweet.stats.views_count !== undefined && (
            <div className="flex items-center">
              <EyeIcon className="mr-1 h-4 w-4" />
              {formatNumber(tweet.stats.views_count)}
            </div>
          )}
          {tweet.stats.holders_count !== undefined && (
            <div className="flex items-center hover:text-purple-500 transition-colors cursor-pointer">
              <ChatBubbleLeftRightIcon className="mr-1 h-4 w-4" />
              {formatNumber(tweet.stats.holders_count)}
            </div>
          )}
        </div>
        
        <div className="px-4 py-3 border-t border-gray-100 dark:border-gray-700">
          <div className="flex flex-col gap-0">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-500">Price</span>
              <span className="text-base font-semibold">
                {tweet.price ? (
                  `${tweet.price.amount} ${tweet.price.currency}`
                ) : (
                  'Not for sale'
                )}
              </span>
            </div>
            {tweet.price?.market_cap && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">Market Cap</span>
                <span className="text-base font-semibold">
                  {`${formatNumber(tweet.price.market_cap)} ${tweet.price.currency}`}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
  );
}
