// 'use client';

// import CryptocurrencySinglePrice from '@/components/cryptocurrency-pricing-table/cryptocurrency-single-price';
// import React, { useState, useEffect } from 'react';
// import CoinInfo from '@/components/cryptocurrency-pricing-table/coin-info';
// import { CoinConverter } from '@/components/ui/transact-coin';
// import CoinTabs from '@/components/cryptocurrency-pricing-table/coin-tabs';
// import TopCoin from '@/components/cryptocurrency-pricing-table/top-coin';
// import { useLayout } from '@/lib/hooks/use-layout';
// import { LAYOUT_OPTIONS } from '@/lib/constants';
// import { InformationCircleIcon } from '@heroicons/react/24/outline';
// import Swap from '@/components/xAsset/swap';
// import TweetCard from '@/components/xAsset/tweet-card';
// import type { TweetInfo } from '@/types';

// interface MediaEntity {
//   type: string;
//   media_url_https: string;
//   sizes: {
//     small: { w: number; h: number; resize: string };
//     large: { w: number; h: number; resize: string };
//     medium: { w: number; h: number; resize: string };
//     thumb: { w: number; h: number; resize: string };
//   };
//   video_info?: {
//     aspect_ratio: [number, number];
//     duration_millis: number;
//     variants: {
//       content_type: string;
//       bitrate?: number;
//       url: string;
//     }[];
//   };
// }

// interface TweetInfoResponse {
//   code: number;
//   data: {
//     data: {
//       tweetResult: {
//         result: {
//           core: {
//             user_results: {
//               result: {
//                 profile_image_shape: string;
//                 legacy: {
//                   profile_image_url_https: string;
//                   screen_name: string;
//                   name: string;
//                   followers_count: number;
//                 };
//                 is_blue_verified: boolean;
//                 rest_id: string;
//               };
//             };
//           };
//           legacy: {
//             extended_entities?: {
//               media: MediaEntity[];
//             };
//             id_str: string;
//             full_text: string;
//             created_at: string;
//             favorite_count: number;
//             retweet_count: number;
//             quote_count: number;
//             reply_count: number;
//             bookmark_count: number;
//             lang: string;
//           };
//           views: {
//             count: string;
//             state: string;
//           };
//         };
//       };
//     };
//   };
//   msg: string;
// }

// function CoinSinglePrice() {
//   const [isOpen, setIsOpen] = useState(false);
//   const { layout } = useLayout();
//   const [tweetInfo, setTweetInfo] = useState<TweetInfo | null>(null);
//   const [isLoading, setIsLoading] = useState(false);

//   const fetchTweetInfo = async (tweetId: string): Promise<void> => {
//     if (!tweetId || isLoading) return;

//     setIsLoading(true);
//     setTweetInfo(null);

//     try {
//       const response = await fetch(
//         `${process.env.NEXT_PUBLIC_REST_API_ENDPOINT}/api/v1/x/tweet-info?tweet_id=${tweetId}`,
//         {
//           headers: {
//             'x-api-key': process.env.NEXT_PUBLIC_X_API_KEY || '',
//           },
//         },
//       );

//       if (!response.ok) {
//         throw new Error('Network response was not ok');
//       }

//       const data: TweetInfoResponse = await response.json();

//       if (data.code === 1 && data.data?.data?.tweetResult?.result) {
//         const tweetResult = data.data.data.tweetResult.result;
//         const legacy = tweetResult.legacy;
//         const user = tweetResult.core.user_results.result;

//         const tweetInfo: TweetInfo = {
//           id: legacy.id_str,
//           text: legacy.full_text,
//           created_at: legacy.created_at,
//           likes: legacy.favorite_count,
//           retweets: legacy.retweet_count,
//           quotes: legacy.quote_count,
//           replies: legacy.reply_count,
//           views_count: parseInt(tweetResult.views.count, 10),
//           bookmarks: legacy.bookmark_count,
//           lang: legacy.lang,
//           author: {
//             rest_id: user.rest_id,
//             name: user.legacy.name,
//             screen_name: user.legacy.screen_name,
//             image: user.legacy.profile_image_url_https,
//             followers_count: user.legacy.followers_count,
//             blue_verified: user.is_blue_verified,
//           },
//           media: legacy.extended_entities?.media
//             ? {
//                 images: legacy.extended_entities.media
//                   .filter((m: MediaEntity) => m.type === 'photo')
//                   .map((img: MediaEntity) => ({
//                     media_url_https: img.media_url_https,
//                     irys_url: img.media_url_https,
//                   })),
//                 videos: legacy.extended_entities.media
//                   .filter((m: MediaEntity) => m.type === 'video')
//                   .map((video: MediaEntity) => {
//                     if (!video.video_info) return null;

//                     const variants = video.video_info.variants
//                       .filter((v) => v.content_type === 'video/mp4')
//                       .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

//                     return {
//                       media_url_https: video.media_url_https,
//                       thumb_url: variants[variants.length - 2]?.url || '',
//                       large_url: variants[0]?.url || '',
//                       aspect_ratio: video.video_info.aspect_ratio,
//                       duration_millis: video.video_info.duration_millis,
//                     };
//                   })
//                   .filter((v): v is NonNullable<typeof v> => v !== null),
//               }
//             : {
//                 images: [],
//                 videos: [],
//               },
//         };

//         setTweetInfo(tweetInfo);
//       }
//     } catch (error) {
//       console.error('Error fetching tweet info:', error);
//     } finally {
//       setIsLoading(false);
//     }
//   };

//   useEffect(() => {
//     const tweetId = '1771520797590327743'; // 替换为实际的 tweet ID
//     fetchTweetInfo(tweetId);
//   }, []);

//   return (
//     <>
//       <div className="mb-8 flex flex-wrap gap-6 sm:px-6 lg:flex-nowrap lg:px-8 3xl:px-10">
//         <div className={`w-full lg:w-2/3 2xl:w-full`}>
//           <CryptocurrencySinglePrice isOpen={isOpen} setIsOpen={setIsOpen} />
//         </div>

//         <div className="flex flex-col gap-3 w-full rounded-lg bg-white dark:bg-light-dark xl:max-w-[358px]">
//           <div className="w-full">
//             <Swap />
//           </div>

//           {isLoading ? (
//             <div className="flex items-center justify-center">
//               <span className="loading loading-spinner loading-xs mr-2"></span>
//               <span>Loading Tweet...</span>
//             </div>
//           ) : tweetInfo ? (
//             <div className="w-full">
//               <TweetCard tweet={tweetInfo} inAssetDetails={true} />
//             </div>
//           ) : null}
//         </div>
//       </div>
//     </>
//   );
// }

// export default CoinSinglePrice;
