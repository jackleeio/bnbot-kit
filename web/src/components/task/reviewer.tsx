'use client';

import { useEffect, useState, useRef, useCallback, useMemo } from 'react';

import TweetCard from '@/components/task/tweet-card';

import { WebUploader } from '@irys/web-upload';
import { WebBaseEth, WebEthereum } from '@irys/web-upload-ethereum';
import { EthersV6Adapter } from '@irys/web-upload-ethereum-ethers-v6';
import { ethers } from 'ethers';
import { Eip1193Provider } from 'ethers';
import XTweetIDCreatorABI from '@/contracts/XTweetIDCreator';
import { useNotification } from '@/context/notification-context';
import { ArrowTopRightOnSquareIcon } from '@heroicons/react/24/outline';
import {
  useWriteContract,
  useWaitForTransactionReceipt,
  type BaseError,
} from 'wagmi';
import bnbIcon from '@/assets/images/bnb-icon.svg';
import Image from 'next/image';

interface TweetInfo {
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
    followers_count: number;
    blue_verified: boolean;
  };
  media?: {
    images?: Array<{
      media_url_https: string;
    }>;
    videos?: Array<{
      media_url_https: string;
      thumb_url: string;
      large_url: string;
      aspect_ratio?: [number, number];
      duration_millis?: number;
    }>;
  };
}

function extractIdFromLink(url: string): string | null {
  const regex = /\/status\/(\d+)/;
  const match = url.match(regex);
  return match ? match[1] : null;
}

const getIrysUploader = async () => {
  try {
    const provider = new ethers.BrowserProvider(
      window.ethereum as unknown as Eip1193Provider,
    );
    const irysUploader = await WebUploader(WebBaseEth).withAdapter(
      EthersV6Adapter(provider),
    );
    return irysUploader;
  } catch (error) {
    console.error('Error connecting to Irys:', error);
    throw error;
  }
};

const downloadImage = async (url: string): Promise<Buffer> => {
  const response = await fetch(url);
  if (!response.ok) throw new Error('Failed to download image');
  const blob = await response.blob();
  const arrayBuffer = await blob.arrayBuffer();
  return Buffer.from(arrayBuffer);
};

interface CreateAssetSignature {
  username: string;
  tweet_id: string;
  // name: string;
  // symbol: string;
  // irys_tx_id: string;
  expire_at: number;
  chain_id: number;
  signature: string;
}

// 添加视频相关的类型定义
interface VideoVariant {
  content_type: string;
  bitrate?: number;
  url: string;
}

interface VideoInfo {
  aspect_ratio: [number, number];
  duration_millis: number;
  variants: VideoVariant[];
}

interface MediaEntity {
  type: string;
  media_url_https: string;
  sizes: {
    small: { w: number; h: number; resize: string };
    large: { w: number; h: number; resize: string };
    medium: { w: number; h: number; resize: string };
    thumb: { w: number; h: number; resize: string };
  };
  video_info?: VideoInfo; // 添加可选的 video_info 字段
}

export default function Reviewer() {
  const [tweetLink, setTweetLink] = useState<string>('');

  // Add debounce timer ref
  const debounceTimer = useRef<NodeJS.Timeout>();

  const [tweetInfo, setTweetInfo] = useState<TweetInfo | null>(null);

  const [isLoading, setIsLoading] = useState<boolean>(false);

  const [currentStep, setCurrentStep] = useState<number>(0);

  const [tokenAddress, setTokenAddress] = useState<string | null>(null);

  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [rewardAmount, setRewardAmount] = useState<string>('');

  interface TweetInfoResponse {
    code: number;
    data: {
      data: {
        tweetResult: {
          result: {
            core: {
              user_results: {
                result: {
                  profile_image_shape: string;
                  legacy: {
                    profile_image_url_https: string;
                    screen_name: string;
                    name: string;
                    followers_count: number;
                    // ... other legacy fields
                  };
                  is_blue_verified: boolean;
                  rest_id: string;
                };
              };
            };
            legacy: {
              extended_entities?: {
                media: Array<{
                  type: string;
                  media_url_https: string;
                  sizes: {
                    small: { w: number; h: number; resize: string };
                    large: { w: number; h: number; resize: string };
                    medium: { w: number; h: number; resize: string };
                    thumb: { w: number; h: number; resize: string };
                  };
                  // other media fields
                }>;
              };
              id_str: string;
              full_text: string;
              created_at: string;
              favorite_count: number;
              retweet_count: number;
              quote_count: number;
              reply_count: number;
              bookmark_count: number;
              lang: string;
            };
            views: {
              count: string;
              state: string;
            };
          };
        };
      };
    };
    msg: string;
  }

  const { showNotification } = useNotification();

  const uploadTweetAsset = async (tweetInfo: TweetInfo) => {
    try {
      const irys = await getIrysUploader();
      const provider = new ethers.BrowserProvider(
        window.ethereum as unknown as Eip1193Provider,
      );

      console.log('Irys address:', irys.address);

      // Prepare upload data - keep original media URLs without uploading to Irys
      const uploadData = { ...tweetInfo };

      // Convert final data to Buffer
      const dataToUpload = Buffer.from(JSON.stringify(uploadData));

      // Calculate total upload cost
      const price = await irys.getPrice(new Blob([dataToUpload]).size);
      console.log(`Upload will cost ${irys.utils.fromAtomic(price)} ETH`);

      // Check balance and fund if needed
      const balance = await irys.getBalance();
      console.log(`Current balance is ${irys.utils.fromAtomic(balance)} ETH`);

      if (balance.lt(price)) {
        console.log('Need funding! Initiating fund transaction...');
        try {
          const feeData = await provider.getFeeData();
          const gasPrice = Number(feeData.gasPrice);
          const fundTx = await irys.fund(price, gasPrice);
          console.log(`Funding success! TX ID: ${fundTx.id}`);
        } catch (fundError) {
          console.error('Funding error:', fundError);
          throw fundError;
        }
      }

      // Upload complete data
      console.log('Uploading data to Irys...');
      const receipt = await irys.upload(dataToUpload, {
        tags: [
          { name: 'Content-Type', value: 'application/json' },
          { name: 'Application', value: 'X-Asset' },
          { name: 'Type', value: 'tweet' },
          { name: 'Tweet-ID', value: tweetInfo.id },
          { name: 'Created-At', value: tweetInfo.created_at },
          { name: 'Version', value: '1.0.0' },
        ],
      });

      console.log('Upload successful!');
      console.log('Transaction ID:', receipt.id);
      console.log('View content at:', `https://gateway.irys.xyz/${receipt.id}`);

      showNotification({
        msg: `Successfully stored tweet content.`,
        type: 'success',
        title: 'Upload Successful',
      });

      return {
        txId: receipt.id,
        url: `https://gateway.irys.xyz/${receipt.id}`,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error occurred';
      showNotification({
        msg: errorMessage,
        type: 'error',
        title: 'Upload Failed',
      });
      console.error('Error uploading to Irys:', error);
      throw error;
    }
  };

  // Modify fetchTweetInfo to include validation
  const fetchTweetInfo = useCallback(async (): Promise<void> => {
    const tweetId = extractIdFromLink(tweetLink);
    // Only proceed if we have a valid tweet ID and not already loading
    if (!tweetId || isLoading || tweetId === tweetInfo?.id) return;

    setIsLoading(true);
    setTweetInfo(null);

    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_REST_API_ENDPOINT}/api/v1/x/tweet-info?tweet_id=${tweetId}`,
        {
          headers: {
            'x-api-key': process.env.NEXT_PUBLIC_X_API_KEY || '',
          },
        },
      );
      if (!response.ok) {
        throw new Error('Network response was not ok');
      }
      const data: TweetInfoResponse = await response.json();
      console.log('Tweet Info:', data);

      if (data.code === 1 && data.data?.data?.tweetResult?.result) {
        const tweetResult = data.data.data.tweetResult.result;
        const legacy = tweetResult.legacy;
        const user = tweetResult.core.user_results.result;

        const tweetInfo: TweetInfo = {
          id: legacy.id_str,
          text: legacy.full_text,
          created_at: legacy.created_at,
          likes: legacy.favorite_count,
          retweets: legacy.retweet_count,
          quotes: legacy.quote_count,
          replies: legacy.reply_count,
          views_count: parseInt(tweetResult.views.count, 10),
          bookmarks: legacy.bookmark_count,
          lang: legacy.lang,
          author: {
            rest_id: user.rest_id,
            name: user.legacy.name,
            screen_name: user.legacy.screen_name,
            image: user.legacy.profile_image_url_https,
            followers_count: user.legacy.followers_count,
            blue_verified: user.is_blue_verified,
          },
          media: legacy.extended_entities?.media
            ? {
                images: legacy.extended_entities.media
                  .filter((m: MediaEntity) => m.type === 'photo')
                  .map((img: MediaEntity) => ({
                    media_url_https: img.media_url_https,
                  })),
                videos: legacy.extended_entities.media
                  .filter((m: MediaEntity) => m.type === 'video')
                  .map((video: MediaEntity) => {
                    if (!video.video_info) return null;

                    const variants = video.video_info.variants
                      .filter((v) => v.content_type === 'video/mp4')
                      .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

                    return {
                      media_url_https: video.media_url_https,
                      thumb_url: variants[variants.length - 2]?.url || '',
                      large_url: variants[0]?.url || '',
                      aspect_ratio: video.video_info.aspect_ratio,
                      duration_millis: video.video_info.duration_millis,
                    };
                  })
                  .filter((v): v is NonNullable<typeof v> => v !== null),
              }
            : undefined,
        };

        setTweetInfo(tweetInfo);
      } else {
        throw new Error('Unexpected data structure');
      }
    } catch (error) {
      console.error('Error fetching tweet info:', error);
    } finally {
      setIsLoading(false);
    }
  }, [tweetLink, isLoading, tweetInfo?.id]);

  // Modify the useEffect to include better validation
  useEffect(() => {
    // Clear any existing timer
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }

    // Only set timer if the link appears to be a valid tweet URL
    if (
      (tweetLink && tweetLink.includes('twitter.com')) ||
      tweetLink.includes('x.com')
    ) {
      debounceTimer.current = setTimeout(() => {
        const tweetId = extractIdFromLink(tweetLink);
        // Only fetch if we have a valid tweet ID and it's different from current
        if (tweetId && tweetId !== tweetInfo?.id) {
          fetchTweetInfo();
        }
      }, 500);
    }

    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
    };
  }, [tweetLink, fetchTweetInfo, tweetInfo?.id]);

  const {
    data: hash,
    isPending,
    writeContract,
    error: txError,
    status: txStatus,
  } = useWriteContract();

  const {
    isLoading: isConfirming,
    isSuccess: isConfirmed,
    data: receipt,
  } = useWaitForTransactionReceipt({
    hash: hash,
  });

  useEffect(() => {
    if (txStatus === 'error') {
      const fullErrorMessage =
        (txError as BaseError)?.shortMessage ?? 'Error in transaction';
      const reasonMatch = fullErrorMessage.match(
        /with the following reason:\s*(.*)/,
      );
      const extractedReason = reasonMatch ? reasonMatch[1] : fullErrorMessage;

      showNotification({
        msg: extractedReason,
        type: 'error',
        title: 'Create Asset Failed',
      });
    }

    if (isConfirmed && receipt) {
      // wagmi 已经帮我们处理好了事件解析
      const event = receipt.logs[0]; // AssetCreated 事件
      if ('args' in event && Array.isArray(event.args)) {
        const tokenAddress = event.args[2]; // token address 是第三个参数

        setTokenAddress(tokenAddress);

        showNotification({
          msg: `Asset created successfully. Token address: ${tokenAddress}`,
          type: 'success',
          title: 'Asset Created',
        });
      }
    }
  }, [txStatus, txError, isConfirmed, receipt, showNotification]);

  const handleImageSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      // Validate file type
      if (!file.type.match('image.*')) {
        showNotification({
          msg: 'Please select an image file',
          type: 'error',
          title: 'Invalid File Type',
        });
        return;
      }

      // Validate file size (5MB)
      if (file.size > 5 * 1024 * 1024) {
        showNotification({
          msg: 'Image size should be less than 5MB',
          type: 'error',
          title: 'File Too Large',
        });
        return;
      }

      const reader = new FileReader();
      reader.onload = (e) => {
        setSelectedImage(e.target?.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  useEffect(() => {
    if (tweetInfo) {
      window.scrollTo({
        top: window.scrollY + 70, // 当前滚动位置向下滑动 50px
        behavior: 'smooth', // 平滑滑动
      });
    }
  }, [tweetInfo]);

  return (
    <>
      <div className="m-auto w-full text-center">
        {/* Only show steps when tweet is loaded */}
        {tweetInfo && (
          <div className="fixed left-8 top-[180px] z-10 hidden -translate-y-1/2 md:block">
            {tokenAddress && (
              <div className="mt-4 text-left">
                <a
                  href={`${process.env.NEXT_PUBLIC_BLOCK_EXPLORER_URL}/token/${tokenAddress}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-sm text-yellow-600 hover:text-yellow-800 hover:underline"
                >
                  <span>
                    Token Address:{' '}
                    {`${tokenAddress.slice(0, 6)}...${tokenAddress.slice(-4)}`}
                  </span>
                  <ArrowTopRightOnSquareIcon className="h-4 w-4" />
                </a>
              </div>
            )}
          </div>
        )}

        <div className="flex w-full flex-col">
          <div className="mx-auto w-full max-w-[880px] pb-28">
            <div className="mt-3 flex items-center">
              <div className="relative mx-auto w-full max-w-[820px] flex-1 rounded-3xl">
                <input
                  type="url"
                  name="tweetLink"
                  id="tweetLink"
                  className="mx-auto block w-full rounded-3xl border-0 py-3 text-center text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 transition-transform duration-200 placeholder:text-gray-400 hover:scale-[1.02] focus:scale-[1.02] focus:ring-2 focus:ring-inset focus:ring-[#f0b90b] active:scale-[0.98] sm:text-sm sm:leading-6"
                  placeholder="Tweet Link"
                  onChange={(e) => setTweetLink(e.target.value)}
                  value={tweetLink}
                />
              </div>
            </div>

            {isLoading && (
              <p className="mt-4 flex items-center justify-center text-center text-sm text-black">
                <span className="loading loading-spinner loading-xs mr-2 text-[#f0b90b]"></span>
                <span>Loading tweet...</span>
              </p>
            )}

            {tweetInfo && (
              <>
                <div className="mx-auto mt-6 max-w-[780px]">
                  <TweetCard tweet={tweetInfo} />
                </div>

                <div>
                  {/* Add amount input field */}
                  <div className="mt-4 w-full">
                    <div className="relative mx-auto w-full max-w-[540px]">
                      <div className="flex items-center rounded-3xl border-2 border-[#f0b90b] shadow-sm transition-transform duration-200 focus-within:scale-[1.02] hover:scale-[1.02] active:scale-[0.98]">
                        <Image
                          src={bnbIcon}
                          alt="BNB"
                          width={20}
                          height={20}
                          className="absolute left-4"
                        />
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="Reward Amount"
                          className="w-full rounded-3xl border-0 py-2 pl-8 pr-4 text-center text-base text-black placeholder:text-gray-400 focus:ring-0"
                          value={rewardAmount}
                          onChange={(e) => setRewardAmount(e.target.value)}
                        />
                        <span className="absolute right-10 font-medium text-[#f0b90b]">
                          BNB
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 在帮我加一个textare 输入描述 主题要一致 */}
                <div className="mt-4 w-full">
                  <div className="relative mx-auto w-full max-w-[540px]">
                    <textarea
                      placeholder="Please enter task description..."
                      className="w-full rounded-3xl border-2 border-[#f0b90b] py-3 px-4 text-base text-black placeholder:text-gray-400 shadow-sm transition-transform duration-200 focus:scale-[1.02] focus:ring-2 focus:ring-[#f0b90b] hover:scale-[1.02] active:scale-[0.98] min-h-[120px] resize-none focus:outline-none"
                      style={{ borderColor: '#f0b90b', outlineColor: '#f0b90b' }}
                    />
                  </div>
                </div>

                <div className="mx-auto mt-8 w-full max-w-[780px]">
                  <button className="w-full rounded-full bg-[#f0b90b] px-3 py-3 text-md font-medium text-white transition-all duration-200 hover:scale-[1.02] hover:bg-[#e6af0a] hover:shadow-lg active:scale-[0.98]">
                    Create AI Task
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
