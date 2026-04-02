import type { NextPage } from 'next';
import type { ReactElement, ReactNode } from 'react';

export type NextPageWithLayout<P = {}> = NextPage<P> & {
  authorization?: boolean;
  getLayout?: (page: ReactElement) => ReactNode;
};

export type CoinTypes = {
  icon: JSX.Element;
  code: string;
  name: string;
  price: number;
};

export interface Attachment {
  id: string;
  original: string;
  thumbnail: string;
}

export interface QueryOptions {
  page?: number;
  limit?: number;
  language?: string;
}

export interface GetParams {
  id: string;
  language?: string;
}

export interface SearchParamOptions {
  rating: string;
  question: string;

  [key: string]: unknown;
}

export interface CryptoQueryOptions extends QueryOptions {
  id: string;
  name: string;
  symbol: string;
}

export interface SettingsQueryOptions extends QueryOptions {
  language?: string;
}

export interface Prices {
  name: number;
  value: number;
}

export interface CoinPrice {
  id: string;
  name: string;
  symbol: string;
  image: string;
  current_price: number;
  market_cap: string;
  market_cap_rank: string;
  fully_diluted_valuation: string;
  total_volume: string;
  high_24h: number;
  low_24h: number;
  price_change_24h: number;
  price_change_percentage_24h: number;
  market_cap_change_24h: number;
  market_cap_change_percentage_24h: number;
  circulating_supply: number;
  total_supply: string;
  max_supply: string;
  prices?: Prices[];
}

export interface PaginatorInfo<T> {
  current_page: number;
  data: T[];
  // map: any;
  first_page_url: string;
  from: number;
  last_page: number;
  last_page_url: string;
  links: any[];
  next_page_url: string | null;
  path: string;
  per_page: number;
  prev_page_url: string | null;
  to: number;
  total: number;
}

export interface CoinPaginator extends PaginatorInfo<CoinPrice> { }

export interface SEO {
  metaTitle: string;
  metaDescription: string;
  ogTitle: string;
  ogDescription: string;
  ogImage: Attachment;
  twitterHandle: string;
  twitterCardType: string;
  metaTags: string;
  canonicalUrl: string;
}

export interface Settings {
  id: string;
  options: {
    siteTitle: string;
    siteSubtitle: string;
    currency: string;
    logo: Attachment;
    seo: SEO;
    contactDetails: ContactDetails;
    useOtp: Boolean;
    [key: string]: string | any;
  };
}

export interface ContactDetails {
  contact: string;
  location: Location;
  website: string;
}


export interface Tweet {
  id: string;
  text: string;
  created_at: string;
  likes: number;
  retweets: number;
  quotes: number;
  replies: number;
  views_count: number | null;
  bookmarks?: number;
  lang?: string;
  author: {
    rest_id?: string;
    name: string;
    screen_name: string;
    image: string;
    blue_verified: boolean;
    followers_count: number;
  };
  media?: {
    images?: {
      media_url_https: string;
      irys_url: string;
    }[];
    videos?: {
      media_url_https: string;
      thumb_url: string;
      large_url: string;
      aspect_ratio: [number, number];
      duration_millis: number;
    }[];
  };
}

export interface TweetInfo {
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


export interface TweetInfoResponse {
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
            is_quote_status?: boolean;
            quoted_status_id_str?: string | null;
            retweeted_status_id_str?: string | null;
            retweeted?: boolean;
            retweeted_status_result?: {
              result?: {
                legacy?: {
                  id_str?: string;
                  full_text?: string;
                  text?: string;
                };
                core?: {
                  user_results?: {
                    result?: {
                      legacy?: {
                        screen_name?: string;
                        description?: string;
                      };
                    };
                  };
                };
              };
            };
            quoted_status_result?: {
              result?: {
                legacy?: {
                  id_str?: string;
                  full_text?: string;
                  text?: string;
                  created_at?: string;
                };
                core?: {
                  user_results?: {
                    result?: {
                      legacy?: {
                        name?: string;
                        screen_name?: string;
                        profile_image_url_https?: string;
                        description?: string;
                      };
                    };
                  };
                };
              };
            };
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


export interface XAsset {
  id: string;
  tweetId: string;
  irysTxId: string;
  name: string;
  symbol: string;
  author: string;
  tokenAddress: string;
  maxSupply: string;
  totalSupply: string;
  owner: string;
  createdAt: string;
  lastTradedAt: string | null;
  lastTradedPrice: string | null;
  uri: string;
  deployer: string;
  deployedAt: string;
  holderCount: string;
}

export interface TweetComment {
  tweet_id: string;
  created_at: string;
  lang: string;
  full_text: string;
  text: string;
  reply_count: number;
  retweet_count: number;
  like_count: number;
  quote_count: number;
  view_count: number;
  user: {
    id: string;
    name: string;
    username: string;
    avatar_url: string;
    profile_image_url: string;
    profile_banner_url?: string;
    description: string;
    created_at: string;
    followers_count: number;
    following_count: number;
    is_verified: boolean;
    is_blue_verified: boolean;
  };
}

export interface TweetCommentsResponse {
  code: number;
  data: TweetComment[];
  cursor: string | null;
  msg: string;
}
