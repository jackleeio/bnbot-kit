
/**
 * Twitter Internal API Client
 * Used to fetch Tweet Details when DOM scraping is insufficient (e.g., hidden Quote IDs)
 */

interface TweetDetailResponse {
    data: {
        threaded_conversation_with_injections_v2: {
            instructions: Array<{
                type: string;
                entries?: Array<{
                    entryId: string;
                    content: {
                        itemContent?: {
                            tweet_results?: {
                                result?: {
                                    legacy?: {
                                        quoted_status_id_str?: string;
                                    };
                                    quoted_status_result?: {
                                        result?: {
                                            rest_id?: string;
                                        };
                                    };
                                };
                            };
                        };
                    };
                }>;
            }>;
        };
    };
}

export interface TweetContent {
    id: string;
    text: string;
    created_at: string;
    like_count: number;
    retweet_count: number;
    reply_count: number;
    quote_count: number;
    view_count: string;
    is_retweet: boolean;
    is_quote: boolean;
    media: Array<{ type: string; url: string }>;
    user: { username: string; name: string; avatar: string };
}

export interface UserTweetsResult {
    tweetIds: string[];           // All tweet IDs
    tweets: TweetContent[];       // Tweet content (text, metrics, etc.)
    quoteIds: string[];           // Quoted tweet IDs (from quote tweets)
    retweetOriginalIds: string[]; // Original tweet IDs (from retweets)
    quoteMap: Record<string, string>; // Main tweet ID -> Quoted tweet ID mapping
    nextCursor: string | null;    // Cursor for next page
}

// 书签结果接口
export interface BookmarksResult {
    tweets: Array<{
        id: string;
        text: string;
        author: {
            id: string;
            username: string;
            display_name: string;
            avatar: string;
            verified: boolean;
        };
        created_at: string;
        stats: {
            likes: number;
            retweets: number;
            replies: number;
            quotes: number;
            views: number;
            bookmarks: number;
        };
        media: Array<{
            type: 'image' | 'video' | 'gif';
            url: string;
            thumbnail?: string;
        }>;
        url: string;
    }>;
    nextCursor: string | null;
}

export class TwitterClient {
    // Constants - Default Fallbacks (will be dynamically updated)
    private static TWEET_DETAIL_QUERY_ID = 'nK2WM0mHJKd2-jb6qhmfWA';
    private static USER_BY_SCREEN_NAME_QUERY_ID = 'xmU6X_CKVnQ5lSrCbXFJNw';
    private static USER_TWEETS_QUERY_ID = 'E3opETHurmVJflFsUBVuUQ';
    private static BOOKMARKS_QUERY_ID = 'LtSMSPJIfqy-J9J4NedTCQ';
    private static ACCOUNT_OVERVIEW_QUERY_ID = 'LwtiA7urqM6eDeBheAFi5w';
    private static CONTENT_POST_LIST_QUERY_ID = '8GMAigEhA0xy4rCM1_p7Fw';
    private static BEARER_TOKEN = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';

    private static initPromise: Promise<void> | null = null;

    /**
     * Dynamically fetch QueryID and Bearer Token from page scripts
     */
    public static async extractConfigs(): Promise<void> {
        console.log(`[TwitterClient] Attempting to extract dynamic configs (QueryID, Bearer)...`);
        try {
            // Scan all scripts that look like they belong to the Twitter app
            // Usually hosted on abs.twimg.com or relative paths
            const scripts = Array.from(document.querySelectorAll('script[src]'));

            // Prioritize searching 'main' files first as they are most likely to contain it
            scripts.sort((a, b) => {
                const srcA = (a as HTMLScriptElement).src;
                const srcB = (b as HTMLScriptElement).src;
                const isMainA = srcA.includes('main');
                const isMainB = srcB.includes('main');
                if (isMainA && !isMainB) return -1;
                if (!isMainA && isMainB) return 1;
                return 0;
            });

            let foundTweetDetail = false;
            let foundUserByScreenName = false;
            let foundUserTweets = false;
            let foundBookmarks = false;
            let foundContentPostList = false;
            let foundBearer = false;
            let foundFollowers = false;
            let foundFollowing = false;
            let foundBlueVerifiedFollowers = false;

            for (const script of scripts) {
                const src = (script as HTMLScriptElement).src;

                // Only check relevant scripts (Twitter's CDN or local)
                // Filter out obviously unrelated scripts
                if (!src.includes('abs.twimg.com') && !src.includes('x.com') && !src.includes('twitter.com') && !src.startsWith('/')) {
                    continue;
                }

                // Skip if not a JS file
                if (!src.endsWith('.js')) continue;

                try {
                    const response = await fetch(src);
                    const code = await response.text();

                    // 1. Extract TweetDetail QueryID
                    if (!foundTweetDetail) {
                        const matchTweetDetail = code.match(/queryId:"([^"]+)",operationName:"TweetDetail"/);
                        if (matchTweetDetail && matchTweetDetail[1]) {
                            console.log(`[TwitterClient] FOUND TweetDetail QueryID:`, matchTweetDetail[1]);
                            this.TWEET_DETAIL_QUERY_ID = matchTweetDetail[1];
                            foundTweetDetail = true;
                        }
                    }

                    // 2. Extract UserByScreenName QueryID
                    if (!foundUserByScreenName) {
                        const matchUserByScreenName = code.match(/queryId:"([^"]+)",operationName:"UserByScreenName"/);
                        if (matchUserByScreenName && matchUserByScreenName[1]) {
                            console.log(`[TwitterClient] FOUND UserByScreenName QueryID:`, matchUserByScreenName[1]);
                            this.USER_BY_SCREEN_NAME_QUERY_ID = matchUserByScreenName[1];
                            foundUserByScreenName = true;
                        }
                    }

                    // 3. Extract UserTweets QueryID
                    if (!foundUserTweets) {
                        const matchUserTweets = code.match(/queryId:"([^"]+)",operationName:"UserTweets"/);
                        if (matchUserTweets && matchUserTweets[1]) {
                            console.log(`[TwitterClient] FOUND UserTweets QueryID:`, matchUserTweets[1]);
                            this.USER_TWEETS_QUERY_ID = matchUserTweets[1];
                            foundUserTweets = true;
                        }
                    }

                    // 4. Extract Bookmarks QueryID
                    if (!foundBookmarks) {
                        const matchBookmarks = code.match(/queryId:"([^"]+)",operationName:"Bookmarks"/);
                        if (matchBookmarks && matchBookmarks[1]) {
                            console.log(`[TwitterClient] FOUND Bookmarks QueryID:`, matchBookmarks[1]);
                            this.BOOKMARKS_QUERY_ID = matchBookmarks[1];
                            foundBookmarks = true;
                        }
                    }

                    // 5. Extract ContentPostListQuery QueryID
                    if (!foundContentPostList) {
                        const matchContentPostList = code.match(/queryId:"([^"]+)",operationName:"ContentPostListQuery"/);
                        if (matchContentPostList && matchContentPostList[1]) {
                            console.log(`[TwitterClient] FOUND ContentPostListQuery QueryID:`, matchContentPostList[1]);
                            this.CONTENT_POST_LIST_QUERY_ID = matchContentPostList[1];
                            foundContentPostList = true;
                        }
                    }

                    // 6. Extract Followers QueryID
                    if (!foundFollowers) {
                        const matchFollowers = code.match(/queryId:"([^"]+)",operationName:"Followers"/);
                        if (matchFollowers && matchFollowers[1]) {
                            console.log(`[TwitterClient] FOUND Followers QueryID:`, matchFollowers[1]);
                            this.FOLLOWERS_QUERY_ID = matchFollowers[1];
                            foundFollowers = true;
                        }
                    }

                    // 7. Extract Following QueryID
                    if (!foundFollowing) {
                        const matchFollowing = code.match(/queryId:"([^"]+)",operationName:"Following"/);
                        if (matchFollowing && matchFollowing[1]) {
                            console.log(`[TwitterClient] FOUND Following QueryID:`, matchFollowing[1]);
                            this.FOLLOWING_QUERY_ID = matchFollowing[1];
                            foundFollowing = true;
                        }
                    }

                    // 8. Extract BlueVerifiedFollowers QueryID
                    if (!foundBlueVerifiedFollowers) {
                        const matchBVF = code.match(/queryId:"([^"]+)",operationName:"BlueVerifiedFollowers"/);
                        if (matchBVF && matchBVF[1]) {
                            console.log(`[TwitterClient] FOUND BlueVerifiedFollowers QueryID:`, matchBVF[1]);
                            this.BLUE_VERIFIED_FOLLOWERS_QUERY_ID = matchBVF[1];
                            foundBlueVerifiedFollowers = true;
                        }
                    }

                    // 9. Extract Bearer Token
                    if (!foundBearer) {
                        const matchBearer = code.match(/"Bearer (AAAAAAAA[^"]+)"/);
                        if (matchBearer && matchBearer[1]) {
                            console.log(`[TwitterClient] FOUND Dynamic Bearer Token`);
                            this.BEARER_TOKEN = matchBearer[1];
                            foundBearer = true;
                        }
                    }

                    // Stop if we found all configs
                    if (foundTweetDetail && foundUserByScreenName && foundUserTweets && foundBookmarks && foundContentPostList && foundBearer && foundFollowers && foundFollowing && foundBlueVerifiedFollowers) {
                        console.log(`[TwitterClient] All configs extracted successfully`);
                        break;
                    }
                } catch (e) {
                    // Ignore fetch errors for individual scripts (CORS etc)
                }
            }
        } catch (error) {
            console.error('[TwitterClient] Failed to extract dynamic configs:', error);
        }
    }

    /**
     * Initialize the client (lazy loaded, ensures configs are ready)
     */
    public static async init(): Promise<void> {
        if (this.initPromise) return this.initPromise;

        this.initPromise = this.extractConfigs();
        return this.initPromise;
    }

    // We need standard web-client headers
    // We need standard web-client headers
    private static getHeaders(): HeadersInit {
        const headers: HeadersInit = {
            'authorization': `Bearer ${this.BEARER_TOKEN}`,
            'x-twitter-active-user': 'yes',
            'x-twitter-auth-type': 'OAuth2Session',
            'x-twitter-client-language': 'en',
            'content-type': 'application/json',
        };

        // Attempt to get CSRF token from cookies
        const csrfToken = document.cookie
            .split('; ')
            .find(row => row.startsWith('ct0='))
            ?.split('=')[1];

        if (csrfToken) {
            headers['x-csrf-token'] = csrfToken;
        }

        return headers;
    }

    /**
     * Make a fetch request via page context (through timeline-interceptor)
     * This ensures Twitter's request interceptors add x-client-transaction-id
     */
    private static fetchViaPageContext(url: string): Promise<any> {
        return new Promise((resolve, reject) => {
            const requestId = `bnbot_fetch_${Date.now()}_${Math.random().toString(36).slice(2)}`;

            const handler = (event: MessageEvent) => {
                if (event.source !== window) return;
                const msg = event.data;
                if (msg?.type === 'BNBOT_FETCH_RESPONSE' && msg.requestId === requestId) {
                    window.removeEventListener('message', handler);
                    if (msg.error) {
                        reject(new Error(msg.error));
                    } else {
                        resolve(msg.data);
                    }
                }
            };
            window.addEventListener('message', handler);

            // Ask timeline-interceptor (page context) to make the fetch
            window.postMessage({
                type: 'BNBOT_FETCH_REQUEST',
                requestId,
                url,
            }, '*');

            setTimeout(() => {
                window.removeEventListener('message', handler);
                reject(new Error('Page context fetch timeout'));
            }, 15000);
        });
    }

    /**
     * Fetch the Quoted Tweet ID for a given Tweet ID
     */
    public static async getQuotedTweetId(tweetId: string): Promise<string | null> {
        await this.init(); // Ensure configs are ready

        const variables = {
            focalTweetId: tweetId,
            referrer: "me",
            with_rux_injections: false,
            includePromotedContent: true,
            withCommunity: true,
            withQuickPromoteEligibilityTweetFields: true,
            withBirdwatchNotes: true,
            withVoice: true,
            withV2Timeline: true
        };

        const features = {
            rweb_video_screen_enabled: false,
            profile_label_improvements_pcf_label_in_post_enabled: true,
            responsive_web_profile_redirect_enabled: false,
            rweb_tipjar_consumption_enabled: true,
            verified_phone_label_enabled: false,
            creator_subscriptions_tweet_preview_api_enabled: true,
            responsive_web_graphql_timeline_navigation_enabled: true,
            responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
            premium_content_api_read_enabled: false,
            communities_web_enable_tweet_community_results_fetch: true,
            c9s_tweet_anatomy_moderator_badge_enabled: true,
            responsive_web_grok_analyze_button_fetch_trends_enabled: false,
            responsive_web_grok_analyze_post_followups_enabled: true,
            responsive_web_jetfuel_frame: true,
            responsive_web_grok_share_attachment_enabled: true,
            responsive_web_grok_annotations_enabled: false,
            articles_preview_enabled: true,
            responsive_web_edit_tweet_api_enabled: true,
            graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
            view_counts_everywhere_api_enabled: true,
            longform_notetweets_consumption_enabled: true,
            responsive_web_twitter_article_tweet_consumption_enabled: true,
            tweet_awards_web_tipping_enabled: false,
            responsive_web_grok_show_grok_translated_post: false,
            responsive_web_grok_analysis_button_from_backend: true,
            post_ctas_fetch_enabled: false,
            creator_subscriptions_quote_tweet_preview_enabled: false,
            freedom_of_speech_not_reach_fetch_enabled: true,
            standardized_nudges_misinfo: true,
            tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
            longform_notetweets_rich_text_read_enabled: true,
            longform_notetweets_inline_media_enabled: true,
            responsive_web_grok_image_annotation_enabled: true,
            responsive_web_grok_imagine_annotation_enabled: true,
            responsive_web_grok_community_note_auto_translation_is_enabled: false,
            responsive_web_enhance_cards_enabled: false
        };

        const url = `https://x.com/i/api/graphql/${this.TWEET_DETAIL_QUERY_ID}/TweetDetail?variables=${encodeURIComponent(JSON.stringify(variables))}&features=${encodeURIComponent(JSON.stringify(features))}`;

        try {
            const response = await fetch(url, {
                method: 'GET',
                headers: this.getHeaders()
            });

            if (!response.ok) {
                console.error('[TwitterClient] Failed to fetch tweet detail', response.status);
                return null;
            }

            const data: TweetDetailResponse = await response.json();

            // Traverse the response to find the requested tweet
            const entries = data.data.threaded_conversation_with_injections_v2.instructions
                .find(i => i.type === 'TimelineAddEntries')?.entries;

            const tweetEntry = entries?.find(e => e.entryId === `tweet-${tweetId}`);
            const result = tweetEntry?.content.itemContent?.tweet_results?.result;

            if (result) {
                // Try to get quoted status result first
                const quotedId = result.quoted_status_result?.result?.rest_id;
                if (quotedId) return quotedId;

                // Fallback to legacy field
                const legacyQuotedId = result.legacy?.quoted_status_id_str;
                if (legacyQuotedId) return legacyQuotedId;
            }

            return null;

        } catch (e) {
            console.error('[TwitterClient] Error fetching tweet details:', e);
            return null;
        }
    }

    /**
     * Fetch full TweetDetail data including thread content.
     * Returns { mainTweet, threadTweets } with text, author, media info.
     */
    public static async fetchTweetDetailFull(tweetId: string): Promise<{
        mainTweet: { author: string; handle: string; text: string; media?: string[] };
        threadTweets: Array<{ author: string; handle: string; text: string; media?: string[] }>;
    } | null> {
        await this.init();

        const variables = {
            focalTweetId: tweetId,
            referrer: "tweet",
            with_rux_injections: false,
            includePromotedContent: false,
            withCommunity: true,
            withQuickPromoteEligibilityTweetFields: true,
            withBirdwatchNotes: true,
            withVoice: true,
        };

        const features = {
            rweb_video_screen_enabled: false,
            profile_label_improvements_pcf_label_in_post_enabled: true,
            responsive_web_profile_redirect_enabled: false,
            rweb_tipjar_consumption_enabled: false,
            verified_phone_label_enabled: false,
            creator_subscriptions_tweet_preview_api_enabled: true,
            responsive_web_graphql_timeline_navigation_enabled: true,
            responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
            premium_content_api_read_enabled: false,
            communities_web_enable_tweet_community_results_fetch: true,
            c9s_tweet_anatomy_moderator_badge_enabled: true,
            responsive_web_grok_analyze_button_fetch_trends_enabled: false,
            responsive_web_grok_analyze_post_followups_enabled: true,
            responsive_web_jetfuel_frame: true,
            responsive_web_grok_share_attachment_enabled: true,
            responsive_web_grok_annotations_enabled: true,
            articles_preview_enabled: true,
            responsive_web_edit_tweet_api_enabled: true,
            graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
            view_counts_everywhere_api_enabled: true,
            longform_notetweets_consumption_enabled: true,
            responsive_web_twitter_article_tweet_consumption_enabled: true,
            content_disclosure_indicator_enabled: true,
            content_disclosure_ai_generated_indicator_enabled: true,
            responsive_web_grok_show_grok_translated_post: false,
            responsive_web_grok_analysis_button_from_backend: true,
            post_ctas_fetch_enabled: false,
            freedom_of_speech_not_reach_fetch_enabled: true,
            standardized_nudges_misinfo: true,
            tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
            longform_notetweets_rich_text_read_enabled: true,
            longform_notetweets_inline_media_enabled: false,
            responsive_web_grok_image_annotation_enabled: true,
            responsive_web_grok_imagine_annotation_enabled: true,
            responsive_web_grok_community_note_auto_translation_is_enabled: false,
            responsive_web_enhance_cards_enabled: false,
        };

        const url = `https://x.com/i/api/graphql/${this.TWEET_DETAIL_QUERY_ID}/TweetDetail?variables=${encodeURIComponent(JSON.stringify(variables))}&features=${encodeURIComponent(JSON.stringify(features))}`;

        try {
            const response = await fetch(url, {
                method: 'GET',
                headers: this.getHeaders(),
                credentials: 'include',
            });

            if (!response.ok) {
                console.error('[TwitterClient] fetchTweetDetailFull failed:', response.status);
                return null;
            }

            const data = await response.json();
            const entries = data.data?.threaded_conversation_with_injections_v2?.instructions
                ?.find((i: any) => i.type === 'TimelineAddEntries')?.entries || [];

            const parseTweet = (result: any) => {
                if (!result) return null;
                const tweet = result.tweet || result;
                const legacy = tweet.legacy;
                if (!legacy) return null;
                const userResult = tweet.core?.user_results?.result;
                const name = userResult?.core?.name || userResult?.legacy?.name || '';
                const screenName = userResult?.core?.screen_name || userResult?.legacy?.screen_name || '';
                const text = legacy.full_text || '';
                const media: string[] = [];
                const extMedia = legacy.extended_entities?.media || [];
                for (const m of extMedia) {
                    if (m.type === 'video' || m.type === 'animated_gif') {
                        const variants = m.video_info?.variants || [];
                        const best = variants.filter((v: any) => v.content_type === 'video/mp4')
                            .sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0))[0];
                        if (best) media.push(best.url);
                    } else if (m.type === 'photo') {
                        media.push(m.media_url_https);
                    }
                }
                return { author: name, handle: `@${screenName}`, text, media: media.length > 0 ? media : undefined };
            };

            let mainTweet: any = null;
            const threadTweets: any[] = [];

            for (const entry of entries) {
                // Main focal tweet
                if (entry.entryId === `tweet-${tweetId}`) {
                    const result = entry.content?.itemContent?.tweet_results?.result;
                    mainTweet = parseTweet(result);
                }
                // Thread continuation (same author replies in conversation)
                if (entry.content?.__typename === 'TimelineTimelineModule' && entry.content?.displayType === 'VerticalConversation') {
                    const items = entry.content?.items || [];
                    for (const item of items) {
                        const result = item.item?.itemContent?.tweet_results?.result;
                        const parsed = parseTweet(result);
                        if (parsed) threadTweets.push(parsed);
                    }
                }
            }

            if (!mainTweet) return null;
            return { mainTweet, threadTweets };

        } catch (e) {
            console.error('[TwitterClient] fetchTweetDetailFull error:', e);
            return null;
        }
    }

    /**
     * Get User ID by screen name (username)
     */
    public static async getUserIdByScreenName(screenName: string): Promise<string | null> {
        await this.init();

        const variables = {
            screen_name: screenName,
            withSafetyModeUserFields: true
        };

        const features = {
            hidden_profile_subscriptions_enabled: true,
            rweb_tipjar_consumption_enabled: true,
            responsive_web_graphql_exclude_directive_enabled: true,
            verified_phone_label_enabled: false,
            subscriptions_verification_info_is_identity_verified_enabled: true,
            subscriptions_verification_info_verified_since_enabled: true,
            highlights_tweets_tab_ui_enabled: true,
            responsive_web_twitter_article_notes_tab_enabled: true,
            subscriptions_feature_can_gift_premium: true,
            creator_subscriptions_tweet_preview_api_enabled: true,
            responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
            responsive_web_graphql_timeline_navigation_enabled: true
        };

        const fieldToggles = {
            withAuxiliaryUserLabels: false
        };

        const url = `https://x.com/i/api/graphql/${this.USER_BY_SCREEN_NAME_QUERY_ID}/UserByScreenName?variables=${encodeURIComponent(JSON.stringify(variables))}&features=${encodeURIComponent(JSON.stringify(features))}&fieldToggles=${encodeURIComponent(JSON.stringify(fieldToggles))}`;

        try {
            const response = await fetch(url, {
                method: 'GET',
                headers: this.getHeaders(),
                credentials: 'include'
            });

            if (!response.ok) {
                console.error('[TwitterClient] Failed to fetch user by screen name', response.status);
                return null;
            }

            const data = await response.json();
            const userId = data.data?.user?.result?.rest_id;

            if (userId) {
                console.log(`[TwitterClient] Resolved userId for @${screenName}: ${userId}`);
                return userId;
            }

            return null;
        } catch (e) {
            console.error('[TwitterClient] Error fetching user by screen name:', e);
            return null;
        }
    }

    /**
     * Get User Tweets with pagination support
     */
    public static async getUserTweets(userId: string, count: number = 20, cursor?: string): Promise<UserTweetsResult> {
        await this.init();

        const variables: Record<string, unknown> = {
            userId,
            count,
            includePromotedContent: true,
            withQuickPromoteEligibilityTweetFields: true,
            withVoice: true,
            withV2Timeline: true
        };

        if (cursor) {
            variables.cursor = cursor;
        }

        // Use the same features as TweetDetail (which works)
        const features = {
            rweb_video_screen_enabled: false,
            profile_label_improvements_pcf_label_in_post_enabled: true,
            responsive_web_graphql_exclude_directive_enabled: true,
            verified_phone_label_enabled: false,
            creator_subscriptions_tweet_preview_api_enabled: true,
            responsive_web_graphql_timeline_navigation_enabled: true,
            responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
            premium_content_api_read_enabled: false,
            communities_web_enable_tweet_community_results_fetch: true,
            c9s_tweet_anatomy_moderator_badge_enabled: true,
            responsive_web_grok_analyze_button_fetch_trends_enabled: false,
            responsive_web_grok_analyze_post_followups_enabled: true,
            responsive_web_jetfuel_frame: true,
            responsive_web_grok_share_attachment_enabled: true,
            responsive_web_grok_annotations_enabled: false,
            articles_preview_enabled: true,
            responsive_web_edit_tweet_api_enabled: true,
            graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
            view_counts_everywhere_api_enabled: true,
            longform_notetweets_consumption_enabled: true,
            responsive_web_twitter_article_tweet_consumption_enabled: true,
            tweet_awards_web_tipping_enabled: false,
            responsive_web_grok_show_grok_translated_post: false,
            responsive_web_grok_analysis_button_from_backend: true,
            creator_subscriptions_quote_tweet_preview_enabled: false,
            freedom_of_speech_not_reach_fetch_enabled: true,
            standardized_nudges_misinfo: true,
            tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
            longform_notetweets_rich_text_read_enabled: true,
            longform_notetweets_inline_media_enabled: true,
            responsive_web_grok_image_annotation_enabled: true,
            responsive_web_grok_imagine_annotation_enabled: true,
            responsive_web_enhance_cards_enabled: false,
            // Additional required features
            responsive_web_grok_community_note_auto_translation_is_enabled: false,
            responsive_web_profile_redirect_enabled: false,
            rweb_tipjar_consumption_enabled: true,
            post_ctas_fetch_enabled: false
        };

        const fieldToggles = {
            withArticlePlainText: false
        };

        const url = `https://x.com/i/api/graphql/${this.USER_TWEETS_QUERY_ID}/UserTweets?variables=${encodeURIComponent(JSON.stringify(variables))}&features=${encodeURIComponent(JSON.stringify(features))}&fieldToggles=${encodeURIComponent(JSON.stringify(fieldToggles))}`;

        const result: UserTweetsResult = {
            tweetIds: [],
            tweets: [],
            quoteIds: [],
            retweetOriginalIds: [],
            quoteMap: {},
            nextCursor: null
        };

        try {
            console.log(`[TwitterClient] Fetching UserTweets for userId: ${userId}, cursor: ${cursor || 'initial'}`);

            const response = await fetch(url, {
                method: 'GET',
                headers: this.getHeaders()
            });

            if (!response.ok) {
                console.error('[TwitterClient] Failed to fetch user tweets', response.status);
                return result;
            }

            const data = await response.json();
            console.log(`[TwitterClient] UserTweets raw response received`);

            // Navigate to entries - try both possible paths
            // Some responses use timeline_v2, others use timeline
            let instructions = data.data?.user?.result?.timeline_v2?.timeline?.instructions;
            if (!instructions || !Array.isArray(instructions)) {
                // Fallback to alternative path
                instructions = data.data?.user?.result?.timeline?.timeline?.instructions;
            }

            if (!instructions || !Array.isArray(instructions)) {
                console.log(`[TwitterClient] No instructions found in response`);
                return result;
            }

            // Find TimelineAddEntries instruction
            const addEntriesInstruction = instructions.find(
                (i: { type: string }) => i.type === 'TimelineAddEntries'
            );

            if (!addEntriesInstruction?.entries) {
                console.log(`[TwitterClient] No entries found in TimelineAddEntries`);
                return result;
            }

            console.log(`[TwitterClient] Found ${addEntriesInstruction.entries.length} entries to parse`);

            const entries = addEntriesInstruction.entries as Array<{
                entryId: string;
                content: {
                    entryType?: string;
                    value?: string;
                    itemContent?: {
                        tweet_results?: {
                            result?: {
                                rest_id?: string;
                                legacy?: {
                                    retweeted_status_result?: {
                                        result?: {
                                            rest_id?: string;
                                            quoted_status_result?: {
                                                result?: {
                                                    rest_id?: string;
                                                };
                                            };
                                        };
                                    };
                                };
                                quoted_status_result?: {
                                    result?: {
                                        rest_id?: string;
                                    };
                                };
                            };
                        };
                    };
                };
            }>;

            for (const entry of entries) {
                const entryId = entry.entryId;

                // Extract next cursor
                if (entryId.startsWith('cursor-bottom-')) {
                    result.nextCursor = entry.content?.value || null;
                    continue;
                }

                // Skip non-tweet entries
                if (!entryId.startsWith('tweet-')) {
                    continue;
                }

                const tweetResult = entry.content?.itemContent?.tweet_results?.result;
                if (!tweetResult) continue;

                const mainTweetId = tweetResult.rest_id;

                // Get the main tweet ID and content
                if (mainTweetId) {
                    result.tweetIds.push(mainTweetId);

                    // Extract tweet content
                    const legacy = tweetResult.legacy || {} as any;
                    const userLegacy = tweetResult.core?.user_results?.result?.legacy || {} as any;
                    result.tweets.push({
                        id: mainTweetId,
                        text: legacy.full_text || '',
                        created_at: legacy.created_at || '',
                        like_count: legacy.favorite_count || 0,
                        retweet_count: legacy.retweet_count || 0,
                        reply_count: legacy.reply_count || 0,
                        quote_count: legacy.quote_count || 0,
                        view_count: (tweetResult as any).views?.count || '0',
                        is_retweet: !!legacy.retweeted_status_result,
                        is_quote: !!legacy.is_quote_status,
                        media: (legacy.entities?.media || []).map((m: any) => ({
                            type: m.type,
                            url: m.media_url_https || m.url,
                        })),
                        user: {
                            username: userLegacy.screen_name || '',
                            name: userLegacy.name || '',
                            avatar: userLegacy.profile_image_url_https || '',
                        },
                    });
                }

                // Check for Quote Tweet
                if (tweetResult.quoted_status_result?.result?.rest_id) {
                    const quotedId = tweetResult.quoted_status_result.result.rest_id;
                    result.quoteIds.push(quotedId);
                    // Build the mapping: main tweet ID -> quoted tweet ID
                    if (mainTweetId) {
                        result.quoteMap[mainTweetId] = quotedId;
                    }
                }

                // Check for Retweet
                if (tweetResult.legacy?.retweeted_status_result?.result) {
                    const retweetedResult = tweetResult.legacy.retweeted_status_result.result;

                    // Original tweet ID from retweet
                    if (retweetedResult.rest_id) {
                        result.retweetOriginalIds.push(retweetedResult.rest_id);
                    }

                    // Quote inside retweet
                    if (retweetedResult.quoted_status_result?.result?.rest_id) {
                        result.quoteIds.push(retweetedResult.quoted_status_result.result.rest_id);
                    }
                }
            }

            console.log(`[TwitterClient] UserTweets result: ${result.tweetIds.length} tweets, ${result.quoteIds.length} quotes, ${result.retweetOriginalIds.length} retweets, nextCursor: ${result.nextCursor ? 'yes' : 'no'}`);

            return result;
        } catch (e) {
            console.error('[TwitterClient] Error fetching user tweets:', e);
            return result;
        }
    }

    /**
     * Get Bookmarks with pagination support
     * 获取用户书签，支持分页
     */
    public static async getBookmarks(count: number = 20, cursor?: string): Promise<BookmarksResult> {
        await this.init();

        const variables: Record<string, unknown> = {
            count,
            includePromotedContent: true
        };

        if (cursor) {
            variables.cursor = cursor;
        }

        const features = {
            rweb_video_screen_enabled: false,
            profile_label_improvements_pcf_label_in_post_enabled: true,
            responsive_web_profile_redirect_enabled: false,
            rweb_tipjar_consumption_enabled: false,
            verified_phone_label_enabled: false,
            creator_subscriptions_tweet_preview_api_enabled: true,
            responsive_web_graphql_timeline_navigation_enabled: true,
            responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
            premium_content_api_read_enabled: false,
            communities_web_enable_tweet_community_results_fetch: true,
            c9s_tweet_anatomy_moderator_badge_enabled: true,
            responsive_web_grok_analyze_button_fetch_trends_enabled: false,
            responsive_web_grok_analyze_post_followups_enabled: true,
            responsive_web_jetfuel_frame: true,
            responsive_web_grok_share_attachment_enabled: true,
            responsive_web_grok_annotations_enabled: false,
            articles_preview_enabled: true,
            responsive_web_edit_tweet_api_enabled: true,
            graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
            view_counts_everywhere_api_enabled: true,
            longform_notetweets_consumption_enabled: true,
            responsive_web_twitter_article_tweet_consumption_enabled: true,
            tweet_awards_web_tipping_enabled: false,
            responsive_web_grok_show_grok_translated_post: false,
            responsive_web_grok_analysis_button_from_backend: true,
            post_ctas_fetch_enabled: false,
            creator_subscriptions_quote_tweet_preview_enabled: false,
            freedom_of_speech_not_reach_fetch_enabled: true,
            standardized_nudges_misinfo: true,
            tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
            longform_notetweets_rich_text_read_enabled: true,
            longform_notetweets_inline_media_enabled: true,
            responsive_web_grok_image_annotation_enabled: true,
            responsive_web_grok_imagine_annotation_enabled: true,
            responsive_web_grok_community_note_auto_translation_is_enabled: false,
            responsive_web_enhance_cards_enabled: false
        };

        const url = `https://x.com/i/api/graphql/${this.BOOKMARKS_QUERY_ID}/Bookmarks?variables=${encodeURIComponent(JSON.stringify(variables))}&features=${encodeURIComponent(JSON.stringify(features))}`;

        const result: BookmarksResult = {
            tweets: [],
            nextCursor: null
        };

        try {
            console.log(`[TwitterClient] Fetching Bookmarks, count: ${count}, cursor: ${cursor || 'initial'}`);

            const response = await fetch(url, {
                method: 'GET',
                headers: this.getHeaders(),
                credentials: 'include'
            });

            if (!response.ok) {
                console.error('[TwitterClient] Failed to fetch bookmarks', response.status);
                return result;
            }

            const data = await response.json();
            console.log(`[TwitterClient] Bookmarks raw response received`);

            // Navigate to entries
            const instructions = data.data?.bookmark_timeline_v2?.timeline?.instructions;
            if (!instructions || !Array.isArray(instructions)) {
                console.log(`[TwitterClient] No instructions found in bookmarks response`);
                return result;
            }

            // Find TimelineAddEntries instruction
            const addEntriesInstruction = instructions.find(
                (i: { type: string }) => i.type === 'TimelineAddEntries'
            );

            if (!addEntriesInstruction?.entries) {
                console.log(`[TwitterClient] No entries found in TimelineAddEntries`);
                return result;
            }

            console.log(`[TwitterClient] Found ${addEntriesInstruction.entries.length} bookmark entries to parse`);

            for (const entry of addEntriesInstruction.entries) {
                const entryId = entry.entryId as string;

                // Extract cursor for pagination
                if (entryId.startsWith('cursor-bottom-')) {
                    result.nextCursor = entry.content?.value || null;
                    continue;
                }

                // Skip non-tweet entries
                if (!entryId.startsWith('tweet-')) {
                    continue;
                }

                const tweetResult = entry.content?.itemContent?.tweet_results?.result;
                if (!tweetResult) continue;

                // Parse tweet data
                const tweet = this.parseTweetResult(tweetResult);
                if (tweet) {
                    result.tweets.push(tweet);
                }
            }

            console.log(`[TwitterClient] Bookmarks result: ${result.tweets.length} tweets, nextCursor: ${result.nextCursor ? 'yes' : 'no'}`);

            return result;
        } catch (e) {
            console.error('[TwitterClient] Error fetching bookmarks:', e);
            return result;
        }
    }

    /**
     * Get all bookmarks up to a limit (handles pagination automatically)
     * 获取所有书签（自动处理分页）
     */
    public static async getAllBookmarks(
        limit: number = 20,
        onProgress?: (fetched: number, total: number) => void
    ): Promise<BookmarksResult['tweets']> {
        const allTweets: BookmarksResult['tweets'] = [];
        let cursor: string | undefined = undefined;
        let pageCount = 0;
        const maxPages = Math.ceil(limit / 20) + 1; // Safety limit

        while (allTweets.length < limit && pageCount < maxPages) {
            // Rate limiting: wait between requests (except first request)
            if (pageCount > 0) {
                await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 500));
            }

            const pageSize = Math.min(20, limit - allTweets.length);
            const result = await this.getBookmarks(pageSize, cursor);

            if (result.tweets.length === 0) {
                console.log(`[TwitterClient] No more bookmarks to fetch`);
                break;
            }

            allTweets.push(...result.tweets);
            onProgress?.(allTweets.length, limit);

            if (!result.nextCursor) {
                console.log(`[TwitterClient] No next cursor, reached end of bookmarks`);
                break;
            }

            cursor = result.nextCursor;
            pageCount++;
        }

        // Trim to exact limit
        return allTweets.slice(0, limit);
    }

    /**
     * Get Account Analytics
     * 获取账户分析数据
     */
    public static async getAccountAnalytics(options: {
        fromTime: string;
        toTime: string;
        granularity?: 'Daily' | 'Weekly' | 'Monthly';
        metrics?: string[];
    }): Promise<any> {
        await this.init();

        const variables = {
            requested_metrics: options.metrics || [
                "Engagements", "Impressions", "ProfileVisits", "Follows",
                "Replies", "Likes", "Retweets", "Bookmark", "Share",
                "UrlClicks", "CreateTweet", "CreateQuote", "Unfollows", "CreateReply"
            ],
            from_time: options.fromTime,
            to_time: options.toTime,
            granularity: options.granularity || 'Daily',
            show_verified_followers: true
        };

        const url = `https://x.com/i/api/graphql/${this.ACCOUNT_OVERVIEW_QUERY_ID}/AccountOverviewQuery?variables=${encodeURIComponent(JSON.stringify(variables))}`;

        const response = await fetch(url, {
            method: 'GET',
            headers: this.getHeaders()
        });

        if (!response.ok) {
            throw new Error(`AccountAnalytics API error: ${response.status}`);
        }

        return await response.json();
    }

    /**
     * Get Post Impressions (Content Post List for main posts, excluding replies)
     * 获取主推文的曝光数据（排除回复）
     */
    public static async getPostImpressions(options: {
        from: Date;
        to: Date;
    }): Promise<{
        posts: Array<{
            id: string;
            text: string;
            createdAt: string;
            impressions: number;
            engagements: number;
            likes: number;
            replies: number;
            retweets: number;
            profileVisits: number;
            detailExpands: number;
            bookmarks: number;
        }>;
        totalImpressions: number;
        totalEngagements: number;
    }> {
        await this.init();

        const variables = {
            from_time: options.from.toISOString(),
            to_time: options.to.toISOString(),
            max_results: 1000,
            query_page_size: 100,
            requested_metrics: [
                "Impressions", "Likes", "Engagements", "Bookmark", "Share",
                "Follows", "Replies", "Retweets", "ProfileVisits", "DetailExpands",
                "UrlClicks", "HashtagClicks", "PermalinkClicks"
            ]
        };

        const url = `https://x.com/i/api/graphql/${this.CONTENT_POST_LIST_QUERY_ID}/ContentPostListQuery?variables=${encodeURIComponent(JSON.stringify(variables))}`;

        const result: {
            posts: Array<{
                id: string;
                text: string;
                createdAt: string;
                impressions: number;
                engagements: number;
                likes: number;
                replies: number;
                retweets: number;
                profileVisits: number;
                detailExpands: number;
                bookmarks: number;
            }>;
            totalImpressions: number;
            totalEngagements: number;
        } = {
            posts: [],
            totalImpressions: 0,
            totalEngagements: 0
        };

        try {
            console.log(`[TwitterClient] Fetching Post Impressions from ${options.from.toISOString()} to ${options.to.toISOString()}`);

            const response = await fetch(url, {
                method: 'GET',
                headers: this.getHeaders(),
                credentials: 'include'
            });

            if (!response.ok) {
                console.error('[TwitterClient] Failed to fetch post impressions', response.status);
                return result;
            }

            const data = await response.json();
            const tweetsResults = data?.data?.viewer_v2?.user_results?.result?.tweets_results || [];

            for (const tweetData of tweetsResults) {
                const tweet = tweetData?.result;
                if (!tweet || tweet.__typename !== 'Tweet') continue;

                // Skip replies (tweets that have reply_to_results)
                if (tweet.reply_to_results?.rest_id) continue;

                const legacy = tweet.legacy || {};
                const metrics = tweet.organic_metrics_total || [];

                const getMetricValue = (type: string): number => {
                    const metric = metrics.find((m: any) => m.metric_type === type);
                    return metric?.metric_value || 0;
                };

                const impressions = getMetricValue('Impressions');
                const engagements = getMetricValue('Engagements');

                result.posts.push({
                    id: tweet.rest_id,
                    text: legacy.full_text || '',
                    createdAt: legacy.created_at || '',
                    impressions,
                    engagements,
                    likes: getMetricValue('Likes'),
                    replies: getMetricValue('Replies'),
                    retweets: getMetricValue('Retweets'),
                    profileVisits: getMetricValue('ProfileVisits'),
                    detailExpands: getMetricValue('DetailExpands'),
                    bookmarks: getMetricValue('Bookmark')
                });

                result.totalImpressions += impressions;
                result.totalEngagements += engagements;
            }

            console.log(`[TwitterClient] Post Impressions result: ${result.posts.length} posts, ${result.totalImpressions} total impressions`);

            return result;
        } catch (e) {
            console.error('[TwitterClient] Error fetching post impressions:', e);
            return result;
        }
    }

    /**
     * Get Reply Impressions (Content Post List for replies)
     * 获取回复推文的曝光数据
     * @param options - { from: Date, to: Date } or { days: number }
     */
    public static async getReplyImpressions(options: { from: Date; to: Date } | { days: 7 | 14 | 28 | 90 | 365 } = { days: 90 }): Promise<{
        replies: Array<{
            id: string;
            text: string;
            createdAt: string;
            impressions: number;
            engagements: number;
            likes: number;
            replies: number;
            retweets: number;
            profileVisits: number;
            detailExpands: number;
            bookmarks: number;
            replyToId: string;
        }>;
        totalImpressions: number;
        totalEngagements: number;
    }> {
        await this.init();

        let from: Date;
        let to: Date;

        if ('from' in options && 'to' in options) {
            from = options.from;
            to = options.to;
        } else {
            to = new Date();
            to.setHours(23, 59, 59, 999);

            from = new Date();
            from.setHours(0, 0, 0, 0);
            from.setDate(from.getDate() - options.days);
        }

        const variables = {
            from_time: from.toISOString(),
            to_time: to.toISOString(),
            max_results: 1000,
            query_page_size: 100,
            requested_metrics: [
                "Impressions", "Likes", "Engagements", "Bookmark", "Share",
                "Follows", "Replies", "Retweets", "ProfileVisits", "DetailExpands",
                "UrlClicks", "HashtagClicks", "PermalinkClicks"
            ]
        };

        const url = `https://x.com/i/api/graphql/${this.CONTENT_POST_LIST_QUERY_ID}/ContentPostListQuery?variables=${encodeURIComponent(JSON.stringify(variables))}`;

        const result: {
            replies: Array<{
                id: string;
                text: string;
                createdAt: string;
                impressions: number;
                engagements: number;
                likes: number;
                replies: number;
                retweets: number;
                profileVisits: number;
                detailExpands: number;
                bookmarks: number;
                replyToId: string;
            }>;
            totalImpressions: number;
            totalEngagements: number;
        } = {
            replies: [],
            totalImpressions: 0,
            totalEngagements: 0
        };

        try {
            console.log(`[TwitterClient] Fetching Reply Impressions from ${from.toISOString()} to ${to.toISOString()}`);

            const response = await fetch(url, {
                method: 'GET',
                headers: this.getHeaders(),
                credentials: 'include'
            });

            if (!response.ok) {
                console.error('[TwitterClient] Failed to fetch reply impressions', response.status);
                return result;
            }

            const data = await response.json();
            const tweetsResults = data?.data?.viewer_v2?.user_results?.result?.tweets_results || [];

            for (const tweetData of tweetsResults) {
                const tweet = tweetData?.result;
                if (!tweet || tweet.__typename !== 'Tweet') continue;

                // Only include replies (tweets that have reply_to_results)
                if (!tweet.reply_to_results?.rest_id) continue;

                const legacy = tweet.legacy || {};
                const metrics = tweet.organic_metrics_total || [];

                const getMetricValue = (type: string): number => {
                    const metric = metrics.find((m: any) => m.metric_type === type);
                    return metric?.metric_value || 0;
                };

                const impressions = getMetricValue('Impressions');
                const engagements = getMetricValue('Engagements');

                result.replies.push({
                    id: tweet.rest_id,
                    text: legacy.full_text || '',
                    createdAt: legacy.created_at || '',
                    impressions,
                    engagements,
                    likes: getMetricValue('Likes'),
                    replies: getMetricValue('Replies'),
                    retweets: getMetricValue('Retweets'),
                    profileVisits: getMetricValue('ProfileVisits'),
                    detailExpands: getMetricValue('DetailExpands'),
                    bookmarks: getMetricValue('Bookmark'),
                    replyToId: tweet.reply_to_results.rest_id
                });

                result.totalImpressions += impressions;
                result.totalEngagements += engagements;
            }

            console.log(`[TwitterClient] Reply Impressions result: ${result.replies.length} replies, ${result.totalImpressions} total impressions`);

            return result;
        } catch (e) {
            console.error('[TwitterClient] Error fetching reply impressions:', e);
            return result;
        }
    }

    /**
     * Parse tweet result from GraphQL response
     * 解析 GraphQL 响应中的推文数据
     */
    // GraphQL Query IDs for user lists
    private static FOLLOWERS_QUERY_ID = 'xBB-_3k-LNxWg8TFpuQiWQ';
    private static FOLLOWING_QUERY_ID = 'OEx3R66nP411LbwQ0xgAIg';
    private static BLUE_VERIFIED_FOLLOWERS_QUERY_ID = 'lsph9HGDm9-osG2BJO8RFg';
    private static FOLLOWERS_YOU_KNOW_QUERY_ID = 'k6H59p1RdI1qtYfd3SAtDA';

    private static USER_LIST_FEATURES = {
        rweb_video_screen_enabled: false,
        profile_label_improvements_pcf_label_in_post_enabled: true,
        responsive_web_profile_redirect_enabled: false,
        rweb_tipjar_consumption_enabled: false,
        verified_phone_label_enabled: false,
        creator_subscriptions_tweet_preview_api_enabled: true,
        responsive_web_graphql_timeline_navigation_enabled: true,
        responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
        premium_content_api_read_enabled: false,
        communities_web_enable_tweet_community_results_fetch: true,
        c9s_tweet_anatomy_moderator_badge_enabled: true,
        responsive_web_grok_analyze_button_fetch_trends_enabled: false,
        responsive_web_grok_analyze_post_followups_enabled: true,
        responsive_web_jetfuel_frame: true,
        responsive_web_grok_share_attachment_enabled: true,
        responsive_web_grok_annotations_enabled: true,
        articles_preview_enabled: true,
        responsive_web_edit_tweet_api_enabled: true,
        graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
        view_counts_everywhere_api_enabled: true,
        longform_notetweets_consumption_enabled: true,
        responsive_web_twitter_article_tweet_consumption_enabled: true,
        tweet_awards_web_tipping_enabled: false,
        content_disclosure_indicator_enabled: true,
        content_disclosure_ai_generated_indicator_enabled: true,
        responsive_web_grok_show_grok_translated_post: true,
        responsive_web_grok_analysis_button_from_backend: true,
        post_ctas_fetch_enabled: true,
        freedom_of_speech_not_reach_fetch_enabled: true,
        standardized_nudges_misinfo: true,
        tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
        longform_notetweets_rich_text_read_enabled: true,
        longform_notetweets_inline_media_enabled: false,
        responsive_web_grok_image_annotation_enabled: true,
        responsive_web_grok_imagine_annotation_enabled: true,
        responsive_web_grok_community_note_auto_translation_is_enabled: false,
        responsive_web_enhance_cards_enabled: false,
    };

    /**
     * Parse user result from GraphQL timeline response
     */
    private static parseUserResult(userResult: any): Record<string, any> | null {
        try {
            const result = userResult?.user_results?.result;
            if (!result) return null;

            const legacy = result.legacy || {};
            const core = result.core || {};

            return {
                id: result.rest_id || '',
                username: core.screen_name || legacy.screen_name || '',
                displayName: core.name || legacy.name || '',
                bio: result.profile_bio?.description || legacy.description || '',
                avatar: (result.avatar?.image_url || legacy.profile_image_url_https || '').replace('_normal', '_400x400'),
                verified: result.is_blue_verified || false,
                followersCount: legacy.followers_count || 0,
                followingCount: legacy.friends_count || 0,
                tweetCount: legacy.statuses_count || 0,
                location: result.location?.location || legacy.location || '',
                website: legacy.entities?.url?.urls?.[0]?.expanded_url || '',
                joinDate: core.created_at || legacy.created_at || '',
            };
        } catch (e) {
            return null;
        }
    }

    /**
     * Get followers or following list via GraphQL API
     */
    public static async getUserList(
        userId: string,
        type: 'followers' | 'following' | 'blue_verified' | 'you_know',
        count: number = 20,
        cursor?: string
    ): Promise<{ users: Array<Record<string, any>>; nextCursor: string | null }> {
        await this.init();

        const queryIdMap: Record<string, string> = {
            followers: this.FOLLOWERS_QUERY_ID,
            following: this.FOLLOWING_QUERY_ID,
            blue_verified: this.BLUE_VERIFIED_FOLLOWERS_QUERY_ID,
            you_know: this.FOLLOWERS_YOU_KNOW_QUERY_ID,
        };
        const nameMap: Record<string, string> = {
            followers: 'Followers',
            following: 'Following',
            blue_verified: 'BlueVerifiedFollowers',
            you_know: 'FollowersYouKnow',
        };

        const queryId = queryIdMap[type];
        const queryName = nameMap[type];

        const variables: Record<string, unknown> = {
            userId,
            count,
            includePromotedContent: false,
            withGrokTranslatedBio: false,
        };
        if (cursor) {
            variables.cursor = cursor;
        }

        // Exact features from browser's actual Followers request
        const features = {
            rweb_video_screen_enabled: false,
            profile_label_improvements_pcf_label_in_post_enabled: true,
            responsive_web_profile_redirect_enabled: false,
            rweb_tipjar_consumption_enabled: false,
            verified_phone_label_enabled: false,
            creator_subscriptions_tweet_preview_api_enabled: true,
            responsive_web_graphql_timeline_navigation_enabled: true,
            responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
            premium_content_api_read_enabled: false,
            communities_web_enable_tweet_community_results_fetch: true,
            c9s_tweet_anatomy_moderator_badge_enabled: true,
            responsive_web_grok_analyze_button_fetch_trends_enabled: false,
            responsive_web_grok_analyze_post_followups_enabled: true,
            responsive_web_jetfuel_frame: true,
            responsive_web_grok_share_attachment_enabled: true,
            responsive_web_grok_annotations_enabled: true,
            articles_preview_enabled: true,
            responsive_web_edit_tweet_api_enabled: true,
            graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
            view_counts_everywhere_api_enabled: true,
            longform_notetweets_consumption_enabled: true,
            responsive_web_twitter_article_tweet_consumption_enabled: true,
            tweet_awards_web_tipping_enabled: false,
            content_disclosure_indicator_enabled: true,
            content_disclosure_ai_generated_indicator_enabled: true,
            responsive_web_grok_show_grok_translated_post: true,
            responsive_web_grok_analysis_button_from_backend: true,
            post_ctas_fetch_enabled: true,
            freedom_of_speech_not_reach_fetch_enabled: true,
            standardized_nudges_misinfo: true,
            tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
            longform_notetweets_rich_text_read_enabled: true,
            longform_notetweets_inline_media_enabled: false,
            responsive_web_grok_image_annotation_enabled: true,
            responsive_web_grok_imagine_annotation_enabled: true,
            responsive_web_grok_community_note_auto_translation_is_enabled: false,
            responsive_web_enhance_cards_enabled: false,
        };
        const url = `https://x.com/i/api/graphql/${queryId}/${queryName}?variables=${encodeURIComponent(JSON.stringify(variables))}&features=${encodeURIComponent(JSON.stringify(features))}`;

        try {
            // Use page context fetch (via timeline-interceptor) to include x-client-transaction-id
            const data = await this.fetchViaPageContext(url);
            const instructions = data?.data?.user?.result?.timeline?.timeline?.instructions || [];
            const users: Array<Record<string, any>> = [];
            let nextCursor: string | null = null;

            for (const instruction of instructions) {
                const entries = instruction.entries || [];
                for (const entry of entries) {
                    // User entries
                    if (entry.content?.itemContent?.user_results) {
                        const user = this.parseUserResult(entry.content.itemContent);
                        if (user) users.push(user);
                    }
                    // Cursor
                    if (entry.content?.cursorType === 'Bottom' || entry.entryId?.startsWith('cursor-bottom')) {
                        nextCursor = entry.content?.value || null;
                    }
                }
            }

            return { users, nextCursor };
        } catch (e) {
            console.error(`[TwitterClient] Error fetching ${queryName}:`, e);
            return { users: [], nextCursor: null };
        }
    }

    /**
     * Get all followers/following with pagination
     */
    public static async getAllUserList(
        userId: string,
        type: 'followers' | 'following' | 'blue_verified' | 'you_know',
        limit: number = 20,
        onProgress?: (fetched: number) => void
    ): Promise<Array<Record<string, any>>> {
        const allUsers: Array<Record<string, any>> = [];
        let cursor: string | undefined;

        while (allUsers.length < limit) {
            const batchSize = Math.min(20, limit - allUsers.length);
            const result = await this.getUserList(userId, type, batchSize, cursor);

            if (result.users.length === 0) break;

            allUsers.push(...result.users);
            onProgress?.(allUsers.length);

            if (!result.nextCursor || allUsers.length >= limit) break;
            cursor = result.nextCursor;
        }

        return allUsers.slice(0, limit);
    }

    /**
     * Get user profile info via GraphQL API
     */
    public static async getUserProfile(screenName: string): Promise<Record<string, any> | null> {
        await this.init();

        const variables = {
            screen_name: screenName,
            withSafetyModeUserFields: true,
        };
        const features = {
            hidden_profile_subscriptions_enabled: true,
            rweb_tipjar_consumption_enabled: true,
            responsive_web_graphql_exclude_directive_enabled: true,
            verified_phone_label_enabled: false,
            subscriptions_verification_info_is_identity_verified_enabled: true,
            subscriptions_verification_info_verified_since_enabled: true,
            highlights_tweets_tab_ui_enabled: true,
            responsive_web_twitter_article_notes_tab_enabled: true,
            subscriptions_feature_can_gift_premium: true,
            creator_subscriptions_tweet_preview_api_enabled: true,
            responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
            responsive_web_graphql_timeline_navigation_enabled: true,
        };
        const fieldToggles = { withAuxiliaryUserLabels: false };

        const url = `https://x.com/i/api/graphql/${this.USER_BY_SCREEN_NAME_QUERY_ID}/UserByScreenName?variables=${encodeURIComponent(JSON.stringify(variables))}&features=${encodeURIComponent(JSON.stringify(features))}&fieldToggles=${encodeURIComponent(JSON.stringify(fieldToggles))}`;

        try {
            const response = await fetch(url, {
                method: 'GET',
                headers: this.getHeaders(),
                credentials: 'include',
            });

            if (!response.ok) return null;

            const data = await response.json();
            const result = data.data?.user?.result;
            if (!result) return null;

            const legacy = result.legacy || {};
            const core = result.core || {};
            return {
                id: result.rest_id || '',
                username: core.screen_name || legacy.screen_name || '',
                displayName: core.name || legacy.name || '',
                bio: result.profile_bio?.description || legacy.description || '',
                avatar: (result.avatar?.image_url || legacy.profile_image_url_https || '').replace('_normal', '_400x400'),
                banner: legacy.profile_banner_url || '',
                verified: result.is_blue_verified || false,
                followersCount: legacy.followers_count || 0,
                followingCount: legacy.friends_count || 0,
                tweetCount: legacy.statuses_count || 0,
                likeCount: legacy.favourites_count || 0,
                location: result.location?.location || legacy.location || '',
                website: legacy.entities?.url?.urls?.[0]?.expanded_url || '',
                joinDate: core.created_at || legacy.created_at || '',
                pinnedTweetId: legacy.pinned_tweet_ids_str?.[0] || null,
            };
        } catch (e) {
            console.error('[TwitterClient] Error fetching user profile:', e);
            return null;
        }
    }

    private static parseTweetResult(tweetResult: any): BookmarksResult['tweets'][0] | null {
        try {
            const restId = tweetResult.rest_id;
            const legacy = tweetResult.legacy;
            const core = tweetResult.core;
            const views = tweetResult.views;

            if (!restId || !legacy || !core) {
                return null;
            }

            const userResult = core.user_results?.result;
            if (!userResult) {
                return null;
            }

            // Parse author info
            const author = {
                id: userResult.rest_id || '',
                username: userResult.core?.screen_name || userResult.legacy?.screen_name || '',
                display_name: userResult.core?.name || userResult.legacy?.name || '',
                avatar: userResult.avatar?.image_url || userResult.legacy?.profile_image_url_https || '',
                verified: userResult.is_blue_verified || userResult.verification?.verified || false
            };

            // Parse stats
            const stats = {
                likes: legacy.favorite_count || 0,
                retweets: legacy.retweet_count || 0,
                replies: legacy.reply_count || 0,
                quotes: legacy.quote_count || 0,
                views: parseInt(views?.count || '0', 10),
                bookmarks: legacy.bookmark_count || 0
            };

            // Parse media
            const media: BookmarksResult['tweets'][0]['media'] = [];
            const extendedMedia = legacy.extended_entities?.media || legacy.entities?.media || [];

            for (const m of extendedMedia) {
                if (m.type === 'photo') {
                    media.push({
                        type: 'image',
                        url: m.media_url_https || ''
                    });
                } else if (m.type === 'video' || m.type === 'animated_gif') {
                    // Get highest quality video URL
                    const variants = m.video_info?.variants || [];
                    const mp4Variants = variants.filter((v: any) => v.content_type === 'video/mp4');
                    const bestVariant = mp4Variants.sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0))[0];

                    media.push({
                        type: m.type === 'animated_gif' ? 'gif' : 'video',
                        url: bestVariant?.url || m.media_url_https || '',
                        thumbnail: m.media_url_https
                    });
                }
            }

            return {
                id: restId,
                text: legacy.full_text || '',
                author,
                created_at: legacy.created_at || '',
                stats,
                media,
                url: `https://x.com/${author.username}/status/${restId}`
            };
        } catch (e) {
            console.error('[TwitterClient] Error parsing tweet result:', e);
            return null;
        }
    }
}
