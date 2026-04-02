import { authService } from './authService';

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:8000';

export interface KolDataParams {
    kol_type?: string;
    cursor?: string;
    page_size?: number;
}

export interface ApiUser {
    username: string;
    name: string;
    avatar: string;
    is_blue_verified: boolean;
    description?: string;
    twitter_id?: string;
}

export interface ApiTweet {
    id_str: string;
    text: string;
    text_en?: string;
    text_zh?: string;
    created_at: string;
    reply_count: number;
    retweet_count: number;
    like_count: number;
    view_count: string;
    user: ApiUser;
    is_retweet: boolean;
    is_quote: boolean;
    media?: ApiMedia[];
    quoted_tweet?: ApiTweet | null;
    retweeted_tweet?: {
        text: string;
        text_en?: string;
        text_zh?: string;
        username: string;
    } | null;
}

export interface ApiMedia {
    url: string;
    type: 'photo' | 'video' | 'animated_gif';
    thumbnail?: string;
}

export interface KolDataResponse {
    data: ApiTweet[];
    cursor?: number;
    total_tweets?: number;
}

export const analysisService = {
    async getKolRecentData(params: KolDataParams = {}): Promise<KolDataResponse> {
        const searchParams = new URLSearchParams();
        // Default values as per user request/screenshot
        searchParams.append('kol_type', params.kol_type || 'crypto');
        searchParams.append('cursor', params.cursor || '1');
        searchParams.append('page_size', (params.page_size || 100).toString());

        const response = await authService.fetchWithAuth(`${API_BASE_URL}/api/v1/ai/kol-recent-data?${searchParams.toString()}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        return await response.json();
    }
};
