
import React, { useState, useRef, useEffect } from 'react';
import { ChevronLeft, Users, Eye, Search, Sparkles, Clock, Trophy, Check, Loader2, AlertCircle, Zap, ExternalLink, BadgeCheck, Layers, ChevronDown, ChevronUp, Filter, RefreshCw, X, Wallet } from 'lucide-react';
import { boostService, Boost, weiToToken, formatRemainingTime, BoostSearchParams } from '../../services/boostService';
import { useLanguage } from '../LanguageContext';
import { navigateToUrl } from '../../utils/navigationUtils';
import { useXUser } from '../../hooks/useXUsername';

// Module-level cache: persists across component mounts/unmounts and shared between all BoostPanel instances
const taskStatusCache: Record<string, { liked: boolean; retweeted: boolean; replied: boolean; followed: boolean }> = {};

function getCachedStatus(tweetId: string) {
    if (!taskStatusCache[tweetId]) {
        taskStatusCache[tweetId] = { liked: false, retweeted: false, replied: false, followed: false };
    }
    return taskStatusCache[tweetId];
}

function mergeCachedStatus(tweetId: string, detected: { liked: boolean; retweeted: boolean; replied: boolean; followed: boolean }) {
    const cached = getCachedStatus(tweetId);
    // DOM-detectable states: use real-time DOM value (allow reverting)
    cached.liked = detected.liked;
    cached.retweeted = detected.retweeted;
    cached.followed = detected.followed;
    // Reply: only detectable via API interception, so only increase (never revert)
    cached.replied = cached.replied || detected.replied;
    return { ...cached };
}

interface BoostPanelProps {
    initialTweetId?: string;
    isContextMode?: boolean;
    onGenerate?: (taskText: string) => void;
    onLogin?: () => void;
    onSwitchToContext?: (options: { mode: 'boost' | 'agent', tweetId?: string }) => void;
    onOpenWallet?: () => void;
}

export const BoostPanel: React.FC<BoostPanelProps> = ({ initialTweetId, isContextMode = false, onGenerate, onLogin, onSwitchToContext, onOpenWallet }) => {
    const { t } = useLanguage();
    const { username: currentUsername } = useXUser();

    // Data state
    const [boosts, setBoosts] = useState<Boost[]>([]);
    const [totalCount, setTotalCount] = useState(0);
    const [currentBoostIndex, setCurrentBoostIndex] = useState(0);
    const [selectedBoost, setSelectedBoost] = useState<Boost | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isSearching, setIsSearching] = useState(false); // For search-specific loading (keeps header visible)
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

    // Search and filter state
    const [searchQuery, setSearchQuery] = useState('');
    const [showFilterDropdown, setShowFilterDropdown] = useState(false);
    const [searchParams, setSearchParams] = useState<BoostSearchParams>({
        sort_by: 'created_at',
        sort_order: 'desc',
        limit: 20,
    });
    const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const filterDropdownRef = useRef<HTMLDivElement>(null);
    const retweetMenuRef = useRef<HTMLDivElement>(null);

    // Scroll state for header auto-hide
    const [showHeader, setShowHeader] = useState(true);
    const lastScrollY = useRef(0);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const savedScrollTop = useRef(0);
    const savedBoostList = useRef<Boost[]>([]); // preserve full list when entering detail

    const handleScroll = () => {
        if (!scrollContainerRef.current) return;
        const el = scrollContainerRef.current;
        const currentScrollY = el.scrollTop;

        // Hide on scroll down (if moved more than 10px to avoid jitter), show on scroll up
        if (currentScrollY > lastScrollY.current && currentScrollY > 20) {
            setShowHeader(false);
        } else {
            setShowHeader(true);
        }
        lastScrollY.current = currentScrollY;

        // Infinite scroll: load more when near bottom
        if (el.scrollHeight - el.scrollTop - el.clientHeight < 200) {
            loadMore();
        }
    };

    const loadMore = async () => {
        if (isLoadingMore || isLoading || initialTweetId || isContextMode) return;
        if (boosts.length >= totalCount) return; // No more data

        setIsLoadingMore(true);
        try {
            const nextParams = { ...searchParams, skip: boosts.length };
            const result = await boostService.searchBoosts(nextParams);
            setBoosts(prev => [...prev, ...result.data]);
            setTotalCount(result.count);
        } catch (err) {
            console.error('[BoostPanel] Error loading more:', err);
        } finally {
            setIsLoadingMore(false);
        }
    };

    const toggleGroup = (tweetId: string) => {
        setExpandedGroups(prev => {
            const next = new Set(prev);
            if (next.has(tweetId)) {
                next.delete(tweetId);
            } else {
                next.add(tweetId);
            }
            return next;
        });
    };



    // Task status for context mode
    const [taskStatus, setTaskStatus] = useState({ liked: false, retweeted: false, replied: false, followed: false });
    const [showRetweetMenu, setShowRetweetMenu] = useState(false);

    // Close filter dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (filterDropdownRef.current && !filterDropdownRef.current.contains(event.target as Node)) {
                setShowFilterDropdown(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Close retweet menu when clicking outside
    useEffect(() => {
        if (!showRetweetMenu) return;
        const handleClickOutside = (event: MouseEvent) => {
            if (retweetMenuRef.current && !retweetMenuRef.current.contains(event.target as Node)) {
                setShowRetweetMenu(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [showRetweetMenu]);

    // Search with debounce
    const handleSearchChange = (value: string) => {
        setSearchQuery(value);
        if (searchTimeoutRef.current) {
            clearTimeout(searchTimeoutRef.current);
        }
        searchTimeoutRef.current = setTimeout(() => {
            // Use unified search parameter 'q' - searches name, username, content, tweet_id (OR logic)
            performSearch({ ...searchParams, q: value || undefined });
        }, 300);
    };

    // Perform search with current params
    const performSearch = async (params: BoostSearchParams) => {
        if (initialTweetId || isContextMode) return; // Don't search in context mode

        setIsSearching(true);
        setError(null);
        try {
            const result = await boostService.searchBoosts(params);
            setBoosts(result.data);
            setTotalCount(result.count);
            setSelectedBoost(null);
        } catch (err: any) {
            console.error('[BoostPanel] Error searching boosts:', err);
            setError(t.boost.errorLoading || 'Failed to load boosts');
        } finally {
            setIsSearching(false);
        }
    };

    // Update filter and trigger search
    const updateFilter = (updates: Partial<BoostSearchParams>) => {
        const newParams = { ...searchParams, ...updates, skip: 0 };
        setSearchParams(newParams);
        performSearch(newParams);
    };

    // Fetch boosts on mount or when initialTweetId changes
    useEffect(() => {
        const fetchBoosts = async () => {
            setIsLoading(true);
            setError(null);

            try {
                if (initialTweetId) {
                    // Fetch boosts for specific tweet
                    const tweetBoosts = await boostService.getBoostsByTweet(initialTweetId);
                    if (tweetBoosts.length > 0) {
                        setBoosts(tweetBoosts);
                        setSelectedBoost(tweetBoosts[0]);
                        setCurrentBoostIndex(0);
                    } else {
                        setBoosts([]);
                        setSelectedBoost(null);
                    }
                } else {
                    // No tweet ID - use search API with default params
                    const result = await boostService.searchBoosts(searchParams);
                    setBoosts(result.data);
                    setTotalCount(result.count);
                    setSelectedBoost(null);
                }
            } catch (err: any) {
                console.error('[BoostPanel] Error fetching boosts:', err);
                // Check for 401 Unauthorized - don't auto-show login modal on initial load
                if (err.message && err.message.includes('401')) {
                    // Only log the error, login modal will be triggered when user actively interacts
                    console.warn('[BoostPanel] Unauthorized - user needs to login');
                }
                setError(t.boost.errorLoading || 'Failed to load boosts');
            } finally {
                setIsLoading(false);
            }
        };

        fetchBoosts();
    }, [initialTweetId, isContextMode]);



    // Listen for TweetDetail API responses to verify reply status
    useEffect(() => {
        if (!isContextMode && !selectedBoost) return;
        if (!currentUsername) return;

        const targetTweetId = selectedBoost?.tweet_id || initialTweetId;
        if (!targetTweetId) return;

        const handleApiData = (event: MessageEvent) => {
            if (event.source !== window) return;
            const msg = event.data;
            if (msg?.type !== 'BNBOT_API_DATA' || msg?.endpoint !== 'tweet_detail') return;

            try {
                const data = msg.payload;
                const instructions = data?.data?.threaded_conversation_with_injections_v2?.instructions;
                if (!instructions || !Array.isArray(instructions)) return;

                for (const instruction of instructions) {
                    const entries = instruction.entries;
                    if (!entries) continue;

                    for (const entry of entries) {
                        // Skip the focal tweet entry itself
                        if (entry.entryId?.startsWith('tweet-')) continue;

                        // Process conversation thread modules
                        const items = entry.content?.items;
                        if (items && Array.isArray(items)) {
                            for (const item of items) {
                                const result = item.item?.itemContent?.tweet_results?.result;
                                const tweet = result?.tweet || result;
                                if (!tweet?.core?.user_results?.result) continue;

                                const screenName = tweet.core.user_results.result.core?.screen_name
                                    || tweet.core.user_results.result.legacy?.screen_name;
                                const conversationId = tweet.legacy?.conversation_id_str;

                                if (screenName?.toLowerCase() === currentUsername.toLowerCase()
                                    && conversationId === targetTweetId) {
                                    console.log('[BoostPanel] Reply verified via TweetDetail API:', tweet.rest_id);
                                    const merged = mergeCachedStatus(targetTweetId, { liked: false, retweeted: false, replied: true, followed: false });
                                    setTaskStatus(prev => prev.replied ? prev : merged);
                                    return;
                                }
                            }
                        }

                        // Also handle single item entries (non-module)
                        const singleResult = entry.content?.itemContent?.tweet_results?.result;
                        const singleTweet = singleResult?.tweet || singleResult;
                        if (singleTweet?.core?.user_results?.result) {
                            const screenName = singleTweet.core.user_results.result.core?.screen_name
                                || singleTweet.core.user_results.result.legacy?.screen_name;
                            const conversationId = singleTweet.legacy?.conversation_id_str;

                            if (screenName?.toLowerCase() === currentUsername.toLowerCase()
                                && conversationId === targetTweetId) {
                                console.log('[BoostPanel] Reply verified via TweetDetail API (single):', singleTweet.rest_id);
                                const merged = mergeCachedStatus(targetTweetId, { liked: false, retweeted: false, replied: true, followed: false });
                                setTaskStatus(prev => prev.replied ? prev : merged);
                                return;
                            }
                        }
                    }
                }
            } catch (err) {
                console.warn('[BoostPanel] Error parsing TweetDetail for reply check:', err);
            }
        };

        window.addEventListener('message', handleApiData);

        return () => {
            window.removeEventListener('message', handleApiData);
        };
    }, [isContextMode, selectedBoost, currentUsername, initialTweetId]);

    // Task status verification via DOM polling (Context Mode or Selected Boost)
    useEffect(() => {
        if (!isContextMode && !selectedBoost) return;

        const targetTweetId = selectedBoost?.tweet_id || initialTweetId;

        // Immediately restore cached status on mount / boost switch
        if (targetTweetId) {
            const cached = getCachedStatus(targetTweetId);
            setTaskStatus({ ...cached });
        }

        const checkStatus = () => {
            // On tweet detail page, the focal tweet's action buttons use specific testids.
            // We check globally but carefully: "unlike" means liked, "unretweet" means retweeted.
            // If neither "like" nor "unlike" exists, buttons haven't rendered yet — skip update.
            const hasLikeBtn = !!document.querySelector('[data-testid="like"]');
            const hasUnlikeBtn = !!document.querySelector('[data-testid="unlike"]');
            const hasRetweetBtn = !!document.querySelector('[data-testid="retweet"]');
            const hasUnretweetBtn = !!document.querySelector('[data-testid="unretweet"]');

            // Only update if the relevant buttons are present on the page
            const likeButtonsExist = hasLikeBtn || hasUnlikeBtn;
            const retweetButtonsExist = hasRetweetBtn || hasUnretweetBtn;

            // If buttons exist, use their state; otherwise keep current state
            const hasUnlike = likeButtonsExist ? hasUnlikeBtn : taskStatus.liked;
            const hasUnretweet = retweetButtonsExist ? hasUnretweetBtn : taskStatus.retweeted;
            const hasUnfollow = !!document.querySelector('[data-testid$="-unfollow"]') || !!document.querySelector('[data-testid*="-unfollow"]');

            const domDetected = { liked: hasUnlike, retweeted: hasUnretweet, replied: false, followed: hasUnfollow };

            // Merge with cache: DOM-detectable states use real-time values
            const merged = targetTweetId
                ? mergeCachedStatus(targetTweetId, domDetected)
                : { liked: hasUnlike, retweeted: hasUnretweet, replied: false, followed: hasUnfollow };

            setTaskStatus(prev => {
                if (prev.liked === merged.liked && prev.retweeted === merged.retweeted && prev.replied === merged.replied && prev.followed === merged.followed) return prev;
                return merged;
            });
        };

        const interval = setInterval(checkStatus, 1000);
        checkStatus();

        return () => clearInterval(interval);
    }, [isContextMode, selectedBoost, initialTweetId]);

    const handleNextBoost = () => {
        if (boosts.length <= 1) return;
        const nextIndex = (currentBoostIndex + 1) % boosts.length;
        setCurrentBoostIndex(nextIndex);
        setSelectedBoost(boosts[nextIndex]);
    };

    const handlePrevBoost = () => {
        if (boosts.length <= 1) return;
        const prevIndex = (currentBoostIndex - 1 + boosts.length) % boosts.length;
        setCurrentBoostIndex(prevIndex);
        setSelectedBoost(boosts[prevIndex]);
    };

    // Handle clicking a boost card from list view
    const handleBoostCardClick = async (boost: Boost, tweetUrl?: string) => {
        // Save scroll position and full list before entering detail view
        if (scrollContainerRef.current) {
            savedScrollTop.current = scrollContainerRef.current.scrollTop;
        }
        savedBoostList.current = [...boosts];

        // Immediately show detail with current boost (no waiting)
        setCurrentBoostIndex(0);
        setSelectedBoost(boost);

        // Navigate to the tweet URL so user can interact
        if (tweetUrl) {
            navigateToUrl(tweetUrl);
        }

        // Fetch all boosts for this tweet in background, update if more found
        boostService.getBoostsByTweet(boost.tweet_id).then(tweetBoosts => {
            if (tweetBoosts.length > 1) {
                const clickedIndex = tweetBoosts.findIndex(b => b.id === boost.id);
                setCurrentBoostIndex(clickedIndex >= 0 ? clickedIndex : 0);
                setSelectedBoost(tweetBoosts[clickedIndex >= 0 ? clickedIndex : 0]);
            }
        }).catch(() => { /* keep current boost on error */ });
    };



    // Helper to extract username from tweet URL or current page URL
    const extractUsernameFromUrl = (url?: string | null): string | null => {
        const targetUrl = url || window.location.href;
        const match = targetUrl.match(/(?:x\.com|twitter\.com)\/([^/]+)\/status\//);
        return match ? match[1] : null;
    };

    // --- Task Action Handlers ---
    const handleLikeClick = () => {
        const likeButton = document.querySelector('[data-testid="like"]') as HTMLElement;
        if (likeButton) likeButton.click();
    };

    const handleRetweetClick = () => {
        const retweetButton = document.querySelector('[data-testid="retweet"]') as HTMLElement;
        if (retweetButton) retweetButton.click();
        // Twitter will show its own repost/quote menu
    };

    const handleRepostOnly = () => {
        setShowRetweetMenu(false);
        const retweetButton = document.querySelector('[data-testid="retweet"]') as HTMLElement;
        if (!retweetButton) return;
        retweetButton.click();
        // Wait for Twitter's menu to appear, then click "Repost"
        setTimeout(() => {
            const menuItem = document.querySelector('[data-testid="retweetConfirm"]') as HTMLElement;
            if (menuItem) menuItem.click();
        }, 500);
    };

    const handleQuoteOnly = () => {
        setShowRetweetMenu(false);
        const retweetButton = document.querySelector('[data-testid="retweet"]') as HTMLElement;
        if (!retweetButton) return;
        retweetButton.click();
        // Wait for Twitter's menu to appear, then click "Quote"
        setTimeout(() => {
            const quoteItem = document.querySelector('[data-testid="Dropdown"] [role="menuitem"]:last-child, a[href*="/compose/post"]') as HTMLElement;
            // Try multiple selectors for the quote option
            const allItems = document.querySelectorAll('[role="menuitem"]');
            for (const item of allItems) {
                const text = item.textContent?.toLowerCase() || '';
                if (text.includes('quote') || text.includes('引用')) {
                    (item as HTMLElement).click();
                    return;
                }
            }
            // Fallback: click the second menu item
            if (allItems.length >= 2) {
                (allItems[1] as HTMLElement).click();
            }
        }, 500);
    };

    const handleReplyClick = () => {
        // On tweet detail page, focus the inline reply textarea
        const textarea = document.querySelector('[data-testid="tweetTextarea_0"]') as HTMLElement;
        if (textarea) {
            textarea.scrollIntoView({ behavior: 'smooth', block: 'center' });
            setTimeout(() => textarea.click(), 300);
            return;
        }
        // Fallback: click the reply button
        const replyButton = document.querySelector('[data-testid="reply"]') as HTMLElement;
        if (replyButton) replyButton.click();
    };

    const handleFollowClick = () => {
        const followButtons = document.querySelectorAll('[data-testid$="-follow"]');
        for (const btn of followButtons) {
            const testId = btn.getAttribute('data-testid');
            if (testId && testId.match(/^\d+-follow$/)) {
                (btn as HTMLElement).click();
                return;
            }
        }
    };

    const handleOneClickComplete = async () => {
        // Like
        if (!taskStatus.liked) handleLikeClick();
        await new Promise(r => setTimeout(r, 500));
        // Retweet
        if (!taskStatus.retweeted) handleRetweetClick();
        await new Promise(r => setTimeout(r, 500));
        // Reply - focus textarea
        if (!taskStatus.replied) handleReplyClick();
        await new Promise(r => setTimeout(r, 500));
        // Follow
        if (!taskStatus.followed) handleFollowClick();
    };

    // Helper to get display values from boost
    const getBoostDisplayData = (boost: Boost) => {
        const snapshot = boost.tweet_snapshot;
        const decimals = boost.token_type === 'ERC20' ? 6 : 18;
        const budgetDisplay = weiToToken(boost.total_budget, decimals);
        const distributedDisplay = weiToToken(boost.total_distributed, decimals);
        const remainingBudget = BigInt(boost.total_budget) - BigInt(boost.total_distributed);
        const remainingDisplay = weiToToken(remainingBudget.toString(), decimals);

        // Calculate hours remaining
        let hoursRemaining: number | null = null;
        if (boost.end_time) {
            const endTime = new Date(boost.end_time).getTime();
            const now = Date.now();
            hoursRemaining = Math.max(0, (endTime - now) / (1000 * 60 * 60));
        }

        // Extract username: snapshot > tweet_url > current page URL
        const fallbackUsername = snapshot?.author?.username
            || extractUsernameFromUrl(boost.tweet_url)
            || extractUsernameFromUrl();

        return {
            avatar: snapshot?.author?.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${boost.tweet_id}`,
            name: snapshot?.author?.name || fallbackUsername || 'Unknown',
            handle: fallbackUsername ? `@${fallbackUsername}` : '@unknown',
            verified: snapshot?.author?.verified || false,
            content: snapshot?.content || '',
            media: snapshot?.media || [],
            budget: budgetDisplay,
            distributed: distributedDisplay,
            remaining: remainingDisplay,
            currency: boost.token_symbol,
            quoterCount: boost.quoter_paid_usernames.length,
            retweeterCount: boost.retweeter_paid_usernames.length,
            hoursRemaining,
            timeDisplay: formatRemainingTime(hoursRemaining),
            status: boost.status,
            tweetUrl: boost.tweet_url,
        };
    };

    // Image with skeleton loading (Inlined from AnalysisPanel for consistency)
    const ImageWithSkeleton: React.FC<{
        src: string;
        alt: string;
        className?: string;
    }> = ({ src, alt, className }) => {
        const [isLoaded, setIsLoaded] = useState(false);

        return (
            <div className="relative w-full h-full">
                {!isLoaded && (
                    <div className="absolute inset-0 bg-[var(--hover-bg)] animate-pulse" />
                )}
                <img
                    src={src}
                    alt={alt}
                    className={className}
                    style={{ opacity: isLoaded ? 1 : 0, transition: 'opacity 0.3s ease' }}
                    onLoad={() => setIsLoaded(true)}
                />
            </div>
        );
    };

    // Media grid component (Updated to match AnalysisPanel style)
    const MediaGrid: React.FC<{ media: Array<{ type: string; url: string; thumbnail?: string }> }> = ({ media }) => {
        if (!media || media.length === 0) return null;

        return (
            <div className={`grid gap-0.5 mb-3 rounded-xl overflow-hidden border-[1px] border-solid border-[var(--border-color)] ${media.length === 1 ? 'grid-cols-1' :
                media.length === 2 ? 'grid-cols-2 aspect-video' :
                    media.length >= 3 ? 'grid-cols-2 grid-rows-2 aspect-video' : 'grid-cols-2 aspect-video'
                }`}>
                {media.map((item, index) => (
                    <div key={index} className={`relative ${media.length === 3 && index === 0 ? 'row-span-2' : ''
                        } ${item.type === 'video' || item.type === 'animated_gif' ? 'col-span-full' : ''}`}>
                        {item.type === 'video' ? (
                            <div
                                className={`w-full bg-black flex items-center justify-center ${media.length === 1 ? '' : 'h-full'
                                    }`}
                                onClick={(e) => e.stopPropagation()}
                            >
                                <video
                                    src={item.url}
                                    poster={item.thumbnail} // boost service might need to provide this, or it might be missing
                                    controls
                                    className={`object-contain ${media.length === 1 ? 'w-full h-auto max-h-[350px]' : 'w-full h-full'
                                        }`}
                                />
                            </div>
                        ) : (
                            <ImageWithSkeleton
                                src={item.url}
                                alt="Tweet media"
                                className={`w-full object-cover object-top bg-[var(--bg-secondary)] ${media.length === 1 ? 'max-h-[350px] h-auto' : 'h-full'
                                    }`}
                            />
                        )}
                        {/* Overflow count for > 4 images - AnalysisPanel doesn't seem to have specific >4 logic in the snippet provided, but BoostPanel did. 
                            However, AnalysisPanel limits to showing 4. The current logic handles 1, 2, 3, 4 via grid layout. 
                            If > 4, AnalysisPanel snippet didn't explicitly show a "+X" overlay in the map. 
                            I'll stick to AnalysisPanel's exact structure for now to match style. 
                        */}
                    </div>
                ))}
            </div>
        );
    };

    // --- Skeleton Components ---
    const Skeleton: React.FC<{ className?: string }> = ({ className }) => (
        <div className={`bg-[var(--skeleton-color)] animate-pulse rounded ${className}`} />
    );

    const BoostCardSkeleton = () => (
        <div className="p-4 bg-[var(--bg-primary)] rounded-2xl border border-[var(--border-color)]">
            <div className="flex gap-3">
                <Skeleton className="w-10 h-10 rounded-full shrink-0" />
                <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-2">
                        <Skeleton className="h-4 w-32" />
                    </div>
                    <div className="space-y-2 mb-3">
                        <Skeleton className="h-4 w-full" />
                        <Skeleton className="h-4 w-3/4" />
                        <Skeleton className="h-4 w-5/6" />
                    </div>
                    <Skeleton className="h-32 w-full rounded-xl mb-3" />
                    <div className="flex justify-between mt-2">
                        <Skeleton className="h-4 w-24" />
                        <Skeleton className="h-4 w-16" />
                    </div>
                </div>
            </div>
        </div>
    );

    const BoostDetailSkeleton = () => (
        <div className="flex flex-col h-full bg-transparent relative">
            <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
                {/* Reward Hero Skeleton */}
                <div className="flex flex-col items-center justify-center py-6 mb-6">
                    <Skeleton className="w-24 h-6 rounded-full mb-3" />
                    <Skeleton className="w-48 h-12 mb-3" />
                    <Skeleton className="w-32 h-4" />
                </div>

                {/* Task Checklist Skeleton */}
                <div className="mb-6">
                    <div className="flex justify-between mb-3 px-1">
                        <Skeleton className="w-24 h-5" />
                        <Skeleton className="w-16 h-4" />
                    </div>
                    <div className="flex flex-col gap-2">
                        {[1, 2, 3].map(i => (
                            <div key={i} className="flex items-center justify-between p-3 rounded-xl border border-[var(--border-color)]">
                                <div className="flex items-center gap-3 w-full">
                                    <Skeleton className="w-8 h-8 rounded-full shrink-0" />
                                    <div className="flex flex-col gap-1 w-full">
                                        <Skeleton className="h-4 w-32" />
                                        <Skeleton className="h-3 w-48" />
                                    </div>
                                </div>
                                <Skeleton className="w-4 h-4 rounded-full ml-2 shrink-0" />
                            </div>
                        ))}
                    </div>
                </div>

                {/* Tweet Preview Skeleton */}
                <div className="mb-6">
                    <div className="p-4 bg-[var(--bg-secondary)] rounded-2xl border border-[var(--border-color)]">
                        <div className="space-y-2 mb-3">
                            <Skeleton className="h-4 w-full bg-[var(--bg-primary)]" />
                            <Skeleton className="h-4 w-5/6 bg-[var(--bg-primary)]" />
                            <Skeleton className="h-4 w-4/6 bg-[var(--bg-primary)]" />
                        </div>
                        <Skeleton className="h-40 w-full rounded-xl bg-[var(--bg-primary)]" />
                    </div>
                </div>

                <Skeleton className="w-full h-12 rounded-full" />
            </div>
        </div>
    );

    // --- Loading State ---
    if (isLoading) {
        if (isContextMode || initialTweetId) {
            return <BoostDetailSkeleton />;
        }

        return (
            <div className="flex flex-col h-full bg-[var(--bg-primary)] overflow-y-auto [&::-webkit-scrollbar]:hidden">
                {/* Header Skeleton */}
                <div className="sticky top-0 bg-[var(--bg-primary)] z-10 p-3 flex justify-end items-center">
                    <Skeleton className="w-8 h-8 rounded-full" />
                </div>

                {/* List Skeleton */}
                <div className="p-4 flex flex-col gap-4 pb-20">
                    {[1, 2, 3, 4].map((i) => (
                        <BoostCardSkeleton key={i} />
                    ))}
                </div>
            </div>
        );
    }

    // --- Error State ---
    if (error) {
        return (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-[var(--text-secondary)] p-6">
                <AlertCircle className="w-10 h-10 text-red-500" />
                <span className="text-sm text-center">{error}</span>
                <button
                    onClick={() => window.location.reload()}
                    className="px-4 py-2 bg-[var(--accent-color)] text-black rounded-full text-sm font-medium"
                >
                    {t.boost.retry || 'Retry'}
                </button>
            </div>
        );
    }

    // --- Empty State (only for initial load, not for search results) ---
    // We'll handle search empty state inside List View to keep the header visible
    if (!isLoading && boosts.length === 0 && !selectedBoost && !searchQuery && !initialTweetId && !isContextMode) {
        return (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-[var(--text-secondary)] p-6">
                <Zap className="w-12 h-12 text-[var(--accent-color)] opacity-50" />
                <div className="text-center">
                    <h3 className="text-lg font-bold text-[var(--text-primary)] mb-2">{t.boost.noBoosts || 'No Active Boosts'}</h3>
                    <p className="text-sm">{t.boost.noBoostsDesc || 'There are no active boost campaigns right now.'}</p>
                </div>
            </div>
        );
    }

    // --- Context Mode (Tweet Detail Page) ---
    if (isContextMode && selectedBoost) {
        const display = getBoostDisplayData(selectedBoost);
        const tweetAuthor = display.handle.replace('@', '');
        const isOwnTweet = currentUsername && tweetAuthor.toLowerCase() === currentUsername.toLowerCase();
        const isEnded = display.timeDisplay === 'Ended' || display.status === 'completed' || (display.hoursRemaining !== null && display.hoursRemaining <= 0);
        const totalTasks = isOwnTweet ? 3 : 4;
        const completedCount = (taskStatus.liked ? 1 : 0) + (taskStatus.retweeted ? 1 : 0) + (taskStatus.replied ? 1 : 0) + (!isOwnTweet && taskStatus.followed ? 1 : 0);

        return (
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: 'transparent', position: 'relative' }}>
                <div style={{ flex: 1, overflowY: 'auto', padding: '20px', scrollbarWidth: 'none', msOverflowStyle: 'none' }} className="[&::-webkit-scrollbar]:hidden">

                    {/* Reward Hero */}
                    <div className="flex flex-col items-center justify-center py-6 mb-6 relative select-none">
                        <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-32 h-32 opacity-20 blur-[40px] rounded-full ${isEnded ? 'bg-gray-400' : 'bg-[var(--accent-color)]'}`} />

                        <div className="relative z-10 flex flex-col items-center">
                            <div className="flex items-center gap-2 mb-2 px-3 py-1 rounded-full bg-[var(--bg-secondary)] border border-[var(--border-color)]">
                                <Trophy size={14} className={isEnded ? 'text-[var(--text-secondary)]' : 'text-[var(--accent-color)]'} />
                                <span className={`text-xs font-bold ${isEnded ? 'text-[var(--text-secondary)]' : 'text-[var(--accent-text)]'}`}>{t.boost.rewardPool}</span>
                            </div>
                            <h1 className="text-4xl font-black text-[var(--text-primary)] tracking-tight mb-1">
                                {display.budget}
                                <span className="text-xl ml-1.5 font-bold text-[var(--text-secondary)]">{display.currency}</span>
                            </h1>
                            {display.timeDisplay === 'Ended' || display.status === 'completed' || (display.hoursRemaining !== null && display.hoursRemaining <= 0) ? (
                                <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--text-secondary)] mt-2 px-2.5 py-0.5 rounded-full bg-[var(--bg-secondary)]">
                                    <Clock size={12} />
                                    <span>{t.boost.ended}</span>
                                </div>
                            ) : (
                                <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--text-secondary)] mt-2">
                                    <Clock size={12} />
                                    <span>{t.boost.endsIn} {display.timeDisplay}</span>
                                </div>
                            )}

                            {/* Pagination Dots */}
                            {boosts.length > 1 && (
                                <div className="flex items-center gap-1.5 mt-4">
                                    {boosts.map((_, idx) => (
                                        <div
                                            key={idx}
                                            className={`w-1.5 h-1.5 rounded-full transition-colors ${idx === currentBoostIndex ? (isEnded ? 'bg-[var(--text-primary)]' : 'bg-[var(--accent-color)]') : 'bg-[var(--border-color)]'}`}
                                        />
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Navigation Arrows */}
                        {boosts.length > 1 && (
                            <>
                                {currentBoostIndex > 0 && (
                                    <button
                                        onClick={(e) => { e.stopPropagation(); handlePrevBoost(); }}
                                        className="absolute left-0 top-1/2 -translate-y-1/2 p-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] rounded-full transition-all z-20 cursor-pointer"
                                    >
                                        <ChevronLeft size={24} />
                                    </button>
                                )}
                                {currentBoostIndex < boosts.length - 1 && (
                                    <button
                                        onClick={(e) => { e.stopPropagation(); handleNextBoost(); }}
                                        className="absolute right-0 top-1/2 -translate-y-1/2 p-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] rounded-full transition-all z-20 cursor-pointer"
                                    >
                                        <ChevronLeft size={24} className="rotate-180" />
                                    </button>
                                )}
                            </>
                        )}
                    </div>

                    {/* Task Checklist */}
                    <div className="mb-6">
                        <div className="flex items-center justify-between mb-3 px-1">
                            <h3 className="text-sm font-bold text-[var(--text-primary)]">{t.boost.mission}</h3>
                            <span className="text-xs text-[var(--text-secondary)]">{completedCount}/{totalTasks} {t.boost.completed}</span>
                        </div>

                        <div className="flex flex-col gap-2">
                            {/* Task 1: Like */}
                            <div className={`flex items-center justify-between p-3 rounded-xl border transition-colors bg-[var(--bg-secondary)] border-[var(--border-color)]`}>
                                <div className="flex items-center gap-3">
                                    <div className={`p-2 rounded-full bg-[var(--bg-primary)] ${taskStatus.liked ? 'text-pink-500' : 'text-[var(--text-secondary)]'}`}>
                                        <svg viewBox="0 0 24 24" aria-hidden="true" className="w-4 h-4" fill={taskStatus.liked ? "currentColor" : "none"} stroke="currentColor" strokeWidth={taskStatus.liked ? 0 : 2}>
                                            <g><path d="M20.884 13.19c-1.351 2.48-4.001 5.12-8.379 7.67l-.503.3-.504-.3c-4.379-2.55-7.029-5.19-8.382-7.67-1.36-2.5-1.41-4.86-.514-6.67.887-1.79 2.647-2.91 4.601-3.01 1.651-.09 3.368.56 4.798 2.01 1.429-1.45 3.146-2.1 4.796-2.01 1.954.1 3.714 1.22 4.601 3.01.896 1.81.846 4.17-.514 6.67z"></path></g>
                                        </svg>
                                    </div>
                                    <div className="flex flex-col">
                                        <span className="text-sm font-bold text-[var(--text-primary)]">{t.boost.likeTweet}</span>
                                        <span className="text-xs text-[var(--text-secondary)]">{t.boost.tapHeart}</span>
                                    </div>
                                </div>
                                {taskStatus.liked ? (
                                    <div className="w-5 h-5 mr-1 rounded-full bg-green-500 flex items-center justify-center">
                                        <Check size={12} className="text-white" strokeWidth={3} />
                                    </div>
                                ) : (
                                    <div className="w-5 h-5 mr-1 rounded-full border-2 border-[var(--border-color)]" />
                                )}
                            </div>

                            {/* Task 2: Quote / Repost (merged) */}
                            <div ref={retweetMenuRef} className={`relative flex items-center justify-between p-3 rounded-xl border transition-colors bg-[var(--bg-secondary)] border-[var(--border-color)]`}>
                                <div className="flex items-center gap-3">
                                    <div className={`p-2 rounded-full bg-[var(--bg-primary)] ${taskStatus.retweeted ? 'text-green-500' : 'text-[var(--text-secondary)]'}`}>
                                        <svg viewBox="0 0 24 24" aria-hidden="true" className="w-4 h-4" fill="currentColor">
                                            <g><path d="M4.5 3.88l4.432 4.14-1.364 1.46L5.5 7.55V16c0 1.1.896 2 2 2H13v2H7.5c-2.209 0-4-1.79-4-4V7.55L1.432 9.48.068 8.02 4.5 3.88zM16.5 6H11V4h5.5c2.209 0 4 1.79 4 4v8.45l2.068-1.93 1.364 1.46-4.432 4.14-4.432-4.14 1.364-1.46 2.068 1.93V8c0-1.1-.896-2-2-2z"></path></g>
                                        </svg>
                                    </div>
                                    <div className="flex flex-col">
                                        <span className="text-sm font-bold text-[var(--text-primary)]">{t.boost.quoteRepost}</span>
                                        <span className="text-xs text-[var(--text-secondary)]">{t.boost.quoteDesc}</span>
                                    </div>
                                </div>
                                {taskStatus.retweeted ? (
                                    <div className="w-5 h-5 mr-1 rounded-full bg-green-500 flex items-center justify-center">
                                        <Check size={12} className="text-white" strokeWidth={3} />
                                    </div>
                                ) : !isEnded ? (
                                    <button
                                        onClick={(e) => { e.stopPropagation(); setShowRetweetMenu(!showRetweetMenu); }}
                                        className="px-3 py-1 text-xs font-medium rounded-full bg-black text-white hover:bg-gray-800 transition-colors cursor-pointer shrink-0"
                                    >
                                        {t.boost.go}
                                    </button>
                                ) : (
                                    <div className="w-5 h-5 mr-1 rounded-full border-2 border-[var(--border-color)]" />
                                )}
                                {showRetweetMenu && !taskStatus.retweeted && !isEnded && (
                                    <div className="absolute right-0 top-full mt-1 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-xl z-50 overflow-hidden whitespace-nowrap" style={{ boxShadow: '0 4px 16px rgba(0,0,0,0.15)' }}>
                                        <button
                                            onClick={(e) => { e.stopPropagation(); handleRepostOnly(); }}
                                            className="w-full px-3 py-2.5 text-left text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--hover-bg)] transition-colors cursor-pointer flex items-center gap-2"
                                        >
                                            <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current shrink-0"><g><path d="M4.5 3.88l4.432 4.14-1.364 1.46L5.5 7.55V16c0 1.1.896 2 2 2H13v2H7.5c-2.209 0-4-1.79-4-4V7.55L1.432 9.48.068 8.02 4.5 3.88zM16.5 6H11V4h5.5c2.209 0 4 1.79 4 4v8.45l2.068-1.93 1.364 1.46-4.432 4.14-4.432-4.14 1.364-1.46 2.068 1.93V8c0-1.1-.896-2-2-2z"></path></g></svg>
                                            {t.boost.repostTweet}
                                        </button>
                                        <button
                                            onClick={(e) => { e.stopPropagation(); handleQuoteOnly(); }}
                                            className="w-full px-3 py-2.5 text-left text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--hover-bg)] transition-colors cursor-pointer flex items-center gap-2 border-t border-[var(--border-color)]"
                                        >
                                            <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current shrink-0"><g><path d="M14.23 2.854c.98-.977 2.56-.977 3.54 0l3.38 3.378c.97.977.97 2.559 0 3.536L9.91 21H3v-6.914L14.23 2.854zm2.12 1.414c-.19-.195-.51-.195-.7 0L4.5 15.418V19h3.58L19.23 7.854 15.85 4.476l.5-.208z"></path></g></svg>
                                            {t.boost.quoteTweet}
                                        </button>
                                    </div>
                                )}
                            </div>

                            {/* Task 3: Reply */}
                            <div className={`flex items-center justify-between p-3 rounded-xl border transition-colors bg-[var(--bg-secondary)] border-[var(--border-color)]`}>
                                <div className="flex items-center gap-3">
                                    <div className={`p-2 rounded-full bg-[var(--bg-primary)] ${taskStatus.replied ? 'text-blue-500' : 'text-[var(--text-secondary)]'}`}>
                                        <svg viewBox="0 0 24 24" aria-hidden="true" className="w-4 h-4" fill="currentColor">
                                            <g><path d="M1.751 10c0-4.42 3.584-8 8.005-8h4.366c4.49 0 8.129 3.64 8.129 8.13 0 2.96-1.607 5.68-4.196 7.11l-8.054 4.46v-3.69h-.067c-4.49.1-8.183-3.51-8.183-8.01zm8.005-6c-3.317 0-6.005 2.69-6.005 6 0 3.37 2.77 6.08 6.138 6.01l.351-.01h1.761v2.3l5.087-2.81c1.951-1.08 3.163-3.13 3.163-5.36 0-3.39-2.744-6.13-6.129-6.13H9.756z"></path></g>
                                        </svg>
                                    </div>
                                    <div className="flex flex-col">
                                        <span className="text-sm font-bold text-[var(--text-primary)]">{t.boost.replyTweet}</span>
                                        <span className="text-xs text-[var(--text-secondary)]">{t.boost.replyDesc}</span>
                                    </div>
                                </div>
                                {taskStatus.replied ? (
                                    <div className="w-5 h-5 mr-1 rounded-full bg-green-500 flex items-center justify-center">
                                        <Check size={12} className="text-white" strokeWidth={3} />
                                    </div>
                                ) : !isEnded ? (
                                    <button
                                        onClick={(e) => { e.stopPropagation(); handleReplyClick(); }}
                                        className="px-3 py-1 text-xs font-medium rounded-full bg-black text-white hover:bg-gray-800 transition-colors cursor-pointer shrink-0"
                                    >
                                        {t.boost.go}
                                    </button>
                                ) : (
                                    <div className="w-5 h-5 mr-1 rounded-full border-2 border-[var(--border-color)]" />
                                )}
                            </div>

                            {/* Task 4: Follow - hidden if own tweet */}
                            {!isOwnTweet && (
                            <div className={`flex items-center justify-between p-3 rounded-xl border transition-colors bg-[var(--bg-secondary)] border-[var(--border-color)]`}>
                                <div className="flex items-center gap-3">
                                    <div className={`p-2 rounded-full bg-[var(--bg-primary)] ${taskStatus.followed ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>
                                        <svg viewBox="0 0 24 24" aria-hidden="true" className="w-4 h-4" fill="currentColor">
                                            <g><path d="M10 4c-1.105 0-2 .9-2 2s.895 2 2 2 2-.9 2-2-.895-2-2-2zM6 6c0-2.21 1.791-4 4-4s4 1.79 4 4-1.791 4-4 4-4-1.79-4-4zm13 4v3h2v-3h3V8h-3V5h-2v3h-3v2h3zM3.651 19h12.698c-.337-1.8-1.023-3.21-1.945-4.19C13.318 13.65 11.838 13 10 13s-3.317.65-4.404 1.81c-.922.98-1.608 2.39-1.945 4.19zm.486-5.56C5.627 11.85 7.648 11 10 11s4.373.85 5.863 2.44c1.477 1.58 2.366 3.8 2.632 6.46l.11 1.1H1.395l.11-1.1c.266-2.66 1.155-4.88 2.632-6.46z"></path></g>
                                        </svg>
                                    </div>
                                    <div className="flex flex-col">
                                        <span className="text-sm font-bold text-[var(--text-primary)]">{t.boost.follow} {display.handle}</span>
                                    </div>
                                </div>
                                {taskStatus.followed ? (
                                    <div className="w-5 h-5 mr-1 rounded-full bg-green-500 flex items-center justify-center">
                                        <Check size={12} className="text-white" strokeWidth={3} />
                                    </div>
                                ) : !isEnded ? (
                                    <button
                                        onClick={(e) => { e.stopPropagation(); handleFollowClick(); }}
                                        className="px-3 py-1 text-xs font-medium rounded-full bg-black text-white hover:bg-gray-800 transition-colors cursor-pointer shrink-0"
                                    >
                                        {t.boost.go}
                                    </button>
                                ) : (
                                    <div className="w-5 h-5 mr-1 rounded-full border-2 border-[var(--border-color)]" />
                                )}
                            </div>
                            )}
                        </div>
                    </div>

                    {/* One-Click Complete Button */}
                    {completedCount < totalTasks && !isEnded && (
                        <button
                            onClick={handleOneClickComplete}
                            className="w-full py-3 rounded-full bg-[var(--accent-color)] hover:bg-[var(--accent-color)]/90 text-black font-bold text-sm active:scale-[0.98] transition-all flex items-center justify-center gap-2 mb-2"
                        >
                            <Zap size={16} strokeWidth={2.5} />
                            {t.boost.oneClickComplete}
                        </button>
                    )}

                    {isEnded && (taskStatus.replied || taskStatus.quoted) && (
                        <p className="text-center text-xs text-green-600 mt-3 mb-1 font-medium">
                            ✅ {t.boost.rewardDistributed}
                        </p>
                    )}

                    {!isEnded && (
                    <p className="text-center text-xs text-[var(--text-secondary)] mt-2">
                        {display.quoterCount + display.retweeterCount} {t.boost.participants} · {display.remaining} {display.currency} {t.boost.remaining}
                    </p>
                    )}

                </div>
            </div>
        );
    }

    // --- Detail View ---
    if (selectedBoost) {
        const display = getBoostDisplayData(selectedBoost);
        const tweetAuthor = display.handle.replace('@', '');
        const isOwnTweet = currentUsername && tweetAuthor.toLowerCase() === currentUsername.toLowerCase();
        const isEnded = display.timeDisplay === 'Ended' || display.status === 'completed' || (display.hoursRemaining !== null && display.hoursRemaining <= 0);
        const totalTasks = isOwnTweet ? 2 : 3;
        const showPagination = boosts.length > 1;

        return (
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: 'transparent', position: 'relative' }}>
                {/* Header */}
                {!isContextMode && (
                    <div style={{ padding: '12px 4px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, backgroundColor: 'var(--bg-primary)', zIndex: 10 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <button
                                onClick={() => {
                                    // Restore full list and scroll position
                                    if (savedBoostList.current.length > 0) {
                                        setBoosts(savedBoostList.current);
                                        savedBoostList.current = [];
                                    }
                                    setSelectedBoost(null);
                                    setTimeout(() => {
                                        requestAnimationFrame(() => {
                                            if (scrollContainerRef.current) {
                                                scrollContainerRef.current.scrollTop = savedScrollTop.current;
                                            }
                                        });
                                    }, 50);
                                }}
                                className="p-1.5 hover:bg-[var(--hover-bg)] rounded-full transition-colors text-[var(--text-secondary)] cursor-pointer"
                            >
                                <ChevronLeft size={20} />
                            </button>
                            <h2 className="text-lg font-bold text-[var(--text-primary)]">{t.boost.boostInfo}</h2>
                        </div>
                    </div>
                )}

                {/* Scrollable Content */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '16px', paddingBottom: '96px', scrollbarWidth: 'none', msOverflowStyle: 'none' }} className="[&::-webkit-scrollbar]:hidden">
                    {/* Reward Hero */}
                    <div className="flex flex-col items-center justify-center py-6 mb-6 relative select-none">
                        <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-32 h-32 opacity-20 blur-[40px] rounded-full ${isEnded ? 'bg-gray-400' : 'bg-[var(--accent-color)]'}`} />

                        <div className="relative z-10 flex flex-col items-center">
                            <div className="flex items-center gap-2 mb-2 px-3 py-1 rounded-full bg-[var(--bg-secondary)] border border-[var(--border-color)]">
                                <Trophy size={14} className={isEnded ? 'text-[var(--text-secondary)]' : 'text-[var(--accent-color)]'} />
                                <span className={`text-xs font-bold ${isEnded ? 'text-[var(--text-secondary)]' : 'text-[var(--accent-text)]'}`}>{t.boost.rewardPool}</span>
                            </div>
                            <h1 className="text-4xl font-black text-[var(--text-primary)] tracking-tight mb-1">
                                {display.budget}
                                <span className="text-xl ml-1.5 font-bold text-[var(--text-secondary)]">{display.currency}</span>
                            </h1>
                            {display.timeDisplay === 'Ended' || display.status === 'completed' || (display.hoursRemaining !== null && display.hoursRemaining <= 0) ? (
                                <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--text-secondary)] mt-2 px-2.5 py-0.5 rounded-full bg-[var(--bg-secondary)]">
                                    <Clock size={12} />
                                    <span>{t.boost.ended}</span>
                                </div>
                            ) : (
                                <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--text-secondary)] mt-2">
                                    <Clock size={12} />
                                    <span>{t.boost.endsIn} {display.timeDisplay}</span>
                                </div>
                            )}

                            {/* Pagination Dots */}
                            {showPagination && (
                                <div className="flex items-center gap-1.5 mt-4">
                                    {boosts.map((_, idx) => (
                                        <div
                                            key={idx}
                                            className={`w-1.5 h-1.5 rounded-full transition-colors ${idx === currentBoostIndex ? (isEnded ? 'bg-[var(--text-primary)]' : 'bg-[var(--accent-color)]') : 'bg-[var(--border-color)]'}`}
                                        />
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Navigation Arrows */}
                        {showPagination && (
                            <>
                                {currentBoostIndex > 0 && (
                                    <button
                                        onClick={(e) => { e.stopPropagation(); handlePrevBoost(); }}
                                        className="absolute left-0 top-1/2 -translate-y-1/2 p-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] rounded-full transition-all z-20 cursor-pointer"
                                    >
                                        <ChevronLeft size={24} />
                                    </button>
                                )}
                                {currentBoostIndex < boosts.length - 1 && (
                                    <button
                                        onClick={(e) => { e.stopPropagation(); handleNextBoost(); }}
                                        className="absolute right-0 top-1/2 -translate-y-1/2 p-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] rounded-full transition-all z-20 cursor-pointer"
                                    >
                                        <ChevronLeft size={24} className="rotate-180" />
                                    </button>
                                )}
                            </>
                        )}
                    </div>

                    {/* Task Checklist */}
                    <div className="mb-6">
                        <div className="flex items-center justify-between mb-3 px-1">
                            <h3 className="text-sm font-bold text-[var(--text-primary)]">{t.boost.mission}</h3>
                            <span className="text-xs text-[var(--text-secondary)]">{(taskStatus.liked ? 1 : 0) + (taskStatus.retweeted ? 1 : 0) + (taskStatus.replied ? 1 : 0) + (!isOwnTweet && taskStatus.followed ? 1 : 0)}/{totalTasks} {t.boost.completed}</span>
                        </div>

                        <div className="flex flex-col gap-2">
                            {/* Task 1: Like */}
                            <div className={`flex items-center justify-between p-3 rounded-xl border transition-colors bg-[var(--bg-secondary)] border-[var(--border-color)]`}>
                                <div className="flex items-center gap-3">
                                    <div className={`p-2 rounded-full bg-[var(--bg-primary)] ${taskStatus.liked ? 'text-pink-500' : 'text-[var(--text-secondary)]'}`}>
                                        <svg viewBox="0 0 24 24" aria-hidden="true" className="w-4 h-4" fill={taskStatus.liked ? "currentColor" : "none"} stroke="currentColor" strokeWidth={taskStatus.liked ? 0 : 2}>
                                            <g><path d="M20.884 13.19c-1.351 2.48-4.001 5.12-8.379 7.67l-.503.3-.504-.3c-4.379-2.55-7.029-5.19-8.382-7.67-1.36-2.5-1.41-4.86-.514-6.67.887-1.79 2.647-2.91 4.601-3.01 1.651-.09 3.368.56 4.798 2.01 1.429-1.45 3.146-2.1 4.796-2.01 1.954.1 3.714 1.22 4.601 3.01.896 1.81.846 4.17-.514 6.67z"></path></g>
                                        </svg>
                                    </div>
                                    <div className="flex flex-col">
                                        <span className="text-sm font-bold text-[var(--text-primary)]">{t.boost.likeTweet}</span>
                                        <span className="text-xs text-[var(--text-secondary)]">{t.boost.tapHeart}</span>
                                    </div>
                                </div>
                                {taskStatus.liked ? (
                                    <div className="w-5 h-5 mr-1 rounded-full bg-green-500 flex items-center justify-center">
                                        <Check size={12} className="text-white" strokeWidth={3} />
                                    </div>
                                ) : (
                                    <div className="w-5 h-5 mr-1 rounded-full border-2 border-[var(--border-color)]" />
                                )}
                            </div>

                            {/* Task 2: Quote / Repost (merged) */}
                            <div ref={retweetMenuRef} className={`relative flex items-center justify-between p-3 rounded-xl border transition-colors bg-[var(--bg-secondary)] border-[var(--border-color)]`}>
                                <div className="flex items-center gap-3">
                                    <div className={`p-2 rounded-full bg-[var(--bg-primary)] ${taskStatus.retweeted ? 'text-green-500' : 'text-[var(--text-secondary)]'}`}>
                                        <svg viewBox="0 0 24 24" aria-hidden="true" className="w-4 h-4" fill="currentColor">
                                            <g><path d="M4.5 3.88l4.432 4.14-1.364 1.46L5.5 7.55V16c0 1.1.896 2 2 2H13v2H7.5c-2.209 0-4-1.79-4-4V7.55L1.432 9.48.068 8.02 4.5 3.88zM16.5 6H11V4h5.5c2.209 0 4 1.79 4 4v8.45l2.068-1.93 1.364 1.46-4.432 4.14-4.432-4.14 1.364-1.46 2.068 1.93V8c0-1.1-.896-2-2-2z"></path></g>
                                        </svg>
                                    </div>
                                    <div className="flex flex-col">
                                        <span className="text-sm font-bold text-[var(--text-primary)]">{t.boost.quoteRepost}</span>
                                        <span className="text-xs text-[var(--text-secondary)]">{t.boost.quoteDesc}</span>
                                    </div>
                                </div>
                                {taskStatus.retweeted ? (
                                    <div className="w-5 h-5 mr-1 rounded-full bg-green-500 flex items-center justify-center">
                                        <Check size={12} className="text-white" strokeWidth={3} />
                                    </div>
                                ) : !isEnded ? (
                                    <button
                                        onClick={(e) => { e.stopPropagation(); setShowRetweetMenu(!showRetweetMenu); }}
                                        className="px-3 py-1 text-xs font-medium rounded-full bg-black text-white hover:bg-gray-800 transition-colors cursor-pointer shrink-0"
                                    >
                                        {t.boost.go}
                                    </button>
                                ) : (
                                    <div className="w-5 h-5 mr-1 rounded-full border-2 border-[var(--border-color)]" />
                                )}
                                {showRetweetMenu && !taskStatus.retweeted && !isEnded && (
                                    <div className="absolute right-0 top-full mt-1 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-xl z-50 overflow-hidden whitespace-nowrap" style={{ boxShadow: '0 4px 16px rgba(0,0,0,0.15)' }}>
                                        <button
                                            onClick={(e) => { e.stopPropagation(); handleRepostOnly(); }}
                                            className="w-full px-3 py-2.5 text-left text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--hover-bg)] transition-colors cursor-pointer flex items-center gap-2"
                                        >
                                            <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current"><g><path d="M4.5 3.88l4.432 4.14-1.364 1.46L5.5 7.55V16c0 1.1.896 2 2 2H13v2H7.5c-2.209 0-4-1.79-4-4V7.55L1.432 9.48.068 8.02 4.5 3.88zM16.5 6H11V4h5.5c2.209 0 4 1.79 4 4v8.45l2.068-1.93 1.364 1.46-4.432 4.14-4.432-4.14 1.364-1.46 2.068 1.93V8c0-1.1-.896-2-2-2z"></path></g></svg>
                                            {t.boost.repostTweet}
                                        </button>
                                        <button
                                            onClick={(e) => { e.stopPropagation(); handleQuoteOnly(); }}
                                            className="w-full px-3 py-2.5 text-left text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--hover-bg)] transition-colors cursor-pointer flex items-center gap-2 border-t border-[var(--border-color)]"
                                        >
                                            <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current"><g><path d="M14.23 2.854c.98-.977 2.56-.977 3.54 0l3.38 3.378c.97.977.97 2.559 0 3.536L9.91 21H3v-6.914L14.23 2.854zm2.12 1.414c-.19-.195-.51-.195-.7 0L4.5 15.418V19h3.58L19.23 7.854 15.85 4.476l.5-.208z"></path></g></svg>
                                            {t.boost.quoteTweet}
                                        </button>
                                    </div>
                                )}
                            </div>

                            {/* Task 3: Reply */}
                            <div className={`flex items-center justify-between p-3 rounded-xl border transition-colors bg-[var(--bg-secondary)] border-[var(--border-color)]`}>
                                <div className="flex items-center gap-3">
                                    <div className={`p-2 rounded-full bg-[var(--bg-primary)] ${taskStatus.replied ? 'text-blue-500' : 'text-[var(--text-secondary)]'}`}>
                                        <svg viewBox="0 0 24 24" aria-hidden="true" className="w-4 h-4" fill="currentColor">
                                            <g><path d="M1.751 10c0-4.42 3.584-8 8.005-8h4.366c4.49 0 8.129 3.64 8.129 8.13 0 2.96-1.607 5.68-4.196 7.11l-8.054 4.46v-3.69h-.067c-4.49.1-8.183-3.51-8.183-8.01zm8.005-6c-3.317 0-6.005 2.69-6.005 6 0 3.37 2.77 6.08 6.138 6.01l.351-.01h1.761v2.3l5.087-2.81c1.951-1.08 3.163-3.13 3.163-5.36 0-3.39-2.744-6.13-6.129-6.13H9.756z"></path></g>
                                        </svg>
                                    </div>
                                    <div className="flex flex-col">
                                        <span className="text-sm font-bold text-[var(--text-primary)]">{t.boost.replyTweet}</span>
                                        <span className="text-xs text-[var(--text-secondary)]">{t.boost.replyDesc}</span>
                                    </div>
                                </div>
                                {taskStatus.replied ? (
                                    <div className="w-5 h-5 mr-1 rounded-full bg-green-500 flex items-center justify-center">
                                        <Check size={12} className="text-white" strokeWidth={3} />
                                    </div>
                                ) : !isEnded ? (
                                    <button
                                        onClick={(e) => { e.stopPropagation(); handleReplyClick(); }}
                                        className="px-3 py-1 text-xs font-medium rounded-full bg-black text-white hover:bg-gray-800 transition-colors cursor-pointer shrink-0"
                                    >
                                        {t.boost.go}
                                    </button>
                                ) : (
                                    <div className="w-5 h-5 mr-1 rounded-full border-2 border-[var(--border-color)]" />
                                )}
                            </div>

                            {/* Task 4: Follow - hidden if own tweet */}
                            {!isOwnTweet && (
                            <div className={`flex items-center justify-between p-3 rounded-xl border transition-colors bg-[var(--bg-secondary)] border-[var(--border-color)]`}>
                                <div className="flex items-center gap-3">
                                    <div className={`p-2 rounded-full bg-[var(--bg-primary)] ${taskStatus.followed ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>
                                        <svg viewBox="0 0 24 24" aria-hidden="true" className="w-4 h-4" fill="currentColor">
                                            <g><path d="M10 4c-1.105 0-2 .9-2 2s.895 2 2 2 2-.9 2-2-.895-2-2-2zM6 6c0-2.21 1.791-4 4-4s4 1.79 4 4-1.791 4-4 4-4-1.79-4-4zm13 4v3h2v-3h3V8h-3V5h-2v3h-3v2h3zM3.651 19h12.698c-.337-1.8-1.023-3.21-1.945-4.19C13.318 13.65 11.838 13 10 13s-3.317.65-4.404 1.81c-.922.98-1.608 2.39-1.945 4.19zm.486-5.56C5.627 11.85 7.648 11 10 11s4.373.85 5.863 2.44c1.477 1.58 2.366 3.8 2.632 6.46l.11 1.1H1.395l.11-1.1c.266-2.66 1.155-4.88 2.632-6.46z"></path></g>
                                        </svg>
                                    </div>
                                    <div className="flex flex-col">
                                        <span className="text-sm font-bold text-[var(--text-primary)]">{t.boost.follow} {display.handle}</span>
                                    </div>
                                </div>
                                {taskStatus.followed ? (
                                    <div className="w-5 h-5 mr-1 rounded-full bg-green-500 flex items-center justify-center">
                                        <Check size={12} className="text-white" strokeWidth={3} />
                                    </div>
                                ) : !isEnded ? (
                                    <button
                                        onClick={(e) => { e.stopPropagation(); handleFollowClick(); }}
                                        className="px-3 py-1 text-xs font-medium rounded-full bg-black text-white hover:bg-gray-800 transition-colors cursor-pointer shrink-0"
                                    >
                                        {t.boost.go}
                                    </button>
                                ) : (
                                    <div className="w-5 h-5 mr-1 rounded-full border-2 border-[var(--border-color)]" />
                                )}
                            </div>
                            )}
                        </div>
                    </div>

                    {/* One-Click Complete Button */}
                    {(taskStatus.liked ? 1 : 0) + (taskStatus.retweeted ? 1 : 0) + (taskStatus.replied ? 1 : 0) + (!isOwnTweet && taskStatus.followed ? 1 : 0) < totalTasks && !isEnded && (
                        <button
                            onClick={handleOneClickComplete}
                            className="w-full py-3 rounded-full bg-[var(--accent-color)] hover:bg-[var(--accent-color)]/90 text-black font-bold text-sm active:scale-[0.98] transition-all flex items-center justify-center gap-2 mb-2"
                        >
                            <Zap size={16} strokeWidth={2.5} />
                            {t.boost.oneClickComplete}
                        </button>
                    )}

                    {isEnded && (taskStatus.replied || taskStatus.quoted) && (
                        <p className="text-center text-xs text-green-600 mt-3 mb-1 font-medium">
                            ✅ {t.boost.rewardDistributed}
                        </p>
                    )}

                    {!isEnded && (
                    <p className="text-center text-xs text-[var(--text-secondary)] mt-2">
                        {display.quoterCount + display.retweeterCount} {t.boost.participants} · {display.remaining} {display.currency} {t.boost.remaining}
                    </p>
                    )}
                </div>

            </div>
        );
    }

    // --- List View ---
    return (
        <div
            ref={scrollContainerRef}
            onScroll={handleScroll}
            style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: 'var(--bg-primary)', overflowY: 'auto', scrollbarWidth: 'none', msOverflowStyle: 'none' }}
            className="[&::-webkit-scrollbar]:hidden"
        >
            {/* Header */}
            <div style={{
                padding: '10px 16px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                position: 'sticky',
                top: 0,
                backgroundColor: 'var(--bg-primary)',
                zIndex: 50,
                borderBottom: '1px solid var(--border-color)',
                transform: showHeader ? 'translateY(0)' : 'translateY(-100%)',
                transition: 'transform 0.3s ease-in-out'
            }}>
                <div className="flex items-center gap-2 shrink-0">
                    {onOpenWallet && (
                        <button
                            onClick={onOpenWallet}
                            className="w-8 h-8 flex items-center justify-center rounded-lg text-[var(--text-secondary)] hover:bg-[var(--hover-bg)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
                            title="Wallet"
                        >
                            <Wallet size={16} />
                        </button>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    {/* Search Bar - compact by default, expands on click */}
                    <div className="relative group">
                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-secondary)] group-focus-within:text-[var(--accent-color)] transition-colors" />
                        <input
                            type="text"
                            placeholder="Search"
                            value={searchQuery}
                            onChange={(e) => handleSearchChange(e.target.value)}
                            onFocus={() => setShowFilterDropdown(true)}
                            onBlur={() => { if (!searchQuery) setShowFilterDropdown(false); }}
                            className={`pl-9 pr-3 py-1.5 bg-transparent rounded-full text-sm text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:outline-none border border-[var(--border-color)] focus:border-[var(--accent-color)] transition-all font-medium ${showFilterDropdown ? 'w-48' : 'w-24'}`}
                        />
                        {searchQuery && (
                            <button
                                onMouseDown={(e) => { e.preventDefault(); setSearchQuery(''); handleSearchChange(''); }}
                                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
                            >
                                <X size={14} />
                            </button>
                        )}
                    </div>
                    {/* Status Filter Dropdown */}
                    <div className="relative" ref={filterDropdownRef}>
                        <select
                            value={searchParams.status || ''}
                            onChange={(e) => updateFilter({ status: e.target.value || undefined })}
                            className="appearance-none text-xs font-medium px-2.5 py-1.5 pr-6 rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] text-[var(--text-primary)] cursor-pointer focus:outline-none focus:border-[var(--accent-color)]"
                            style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23536471' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 6px center' }}
                        >
                            <option value="">All Status</option>
                            <option value="active">Active</option>
                            <option value="pending">Pending</option>
                            <option value="distributing">Distributing</option>
                            <option value="completed">Completed</option>
                        </select>
                    </div>
                    {/* Refresh Button */}
                    <button
                        onClick={() => performSearch(searchParams)}
                        className="p-1.5 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] rounded-lg transition-colors cursor-pointer"
                        title="Refresh"
                    >
                        <RefreshCw size={16} />
                    </button>
                </div>
            </div>

            {/* Card List */}
            <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px', paddingBottom: '80px', flex: 1, minHeight: 0 }}>
                {/* Show skeleton when searching */}
                {isSearching ? (
                    [1, 2, 3, 4].map((i) => (
                        <BoostCardSkeleton key={i} />
                    ))
                ) : boosts.length === 0 ? (
                    /* Empty state for search results - keeps header visible */
                    <div className="flex flex-col items-center justify-center flex-1 h-full gap-4 text-[var(--text-secondary)]" style={{ minHeight: 'calc(100vh - 200px)' }}>
                        <Zap className="w-12 h-12 text-[var(--accent-color)] opacity-50" />
                        <div className="text-center">
                            <h3 className="text-lg font-bold text-[var(--text-primary)] mb-2">
                                {searchQuery ? 'No Results Found' : (t.boost.noBoosts || 'No Active Boosts')}
                            </h3>
                            <p className="text-sm">
                                {searchQuery
                                    ? `No boosts found for "${searchQuery}". Try different keywords.`
                                    : (t.boost.noBoostsDesc || 'There are no active boost campaigns right now.')
                                }
                            </p>
                        </div>
                    </div>
                ) : (
                Object.values(boosts.reduce((acc, boost) => {
                    if (!acc[boost.tweet_id]) {
                        acc[boost.tweet_id] = [];
                    }
                    acc[boost.tweet_id].push(boost);
                    return acc;
                }, {} as Record<string, Boost[]>)).map((group) => {
                    const boost = group[0];
                    const display = getBoostDisplayData(boost);
                    const isGrouped = group.length > 1;

                    // Calculate total budget for grouped items
                    const totalBudgetNum = isGrouped
                        ? group.reduce((sum, b) => {
                            const decimals = b.token_type === 'ERC20' ? 6 : 18;
                            return sum + parseFloat(weiToToken(b.total_budget, decimals));
                          }, 0)
                        : parseFloat(display.budget);
                    const totalBudget = totalBudgetNum % 1 === 0 ? totalBudgetNum.toString() : totalBudgetNum.toFixed(2);

                    return (
                        <div
                            key={boost.tweet_id}
                            className="relative"
                            style={{
                                marginBottom: isGrouped ? '14px' : '0'
                            }}
                        >
                            {/* Stack Effect Background Cards (only when grouped) */}
                            {isGrouped && (
                                <>
                                    <div
                                        className="absolute h-full bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-2xl shadow-sm"
                                        style={{
                                            top: '5px',
                                            left: '8px',
                                            width: 'calc(100% - 16px)',
                                            zIndex: 5
                                        }}
                                    />
                                    <div
                                        className="absolute h-full bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-2xl shadow-sm opacity-60"
                                        style={{
                                            top: '10px',
                                            left: '16px',
                                            width: 'calc(100% - 32px)',
                                            zIndex: 0
                                        }}
                                    />
                                </>
                            )}

                            {/* Main Card */}
                            <div
                                onClick={(e) => {
                                    e.stopPropagation();
                                    handleBoostCardClick(boost, display.tweetUrl);
                                }}
                                style={{
                                    backgroundColor: 'var(--bg-primary)',
                                    borderRadius: '16px',
                                    padding: '16px',
                                    cursor: 'pointer',
                                    border: '1px solid var(--border-color)',
                                    position: 'relative',
                                    zIndex: 10,
                                }}
                                className="shadow-md"
                            >
                                <div className="flex gap-3">
                                    {/* Avatar */}
                                    <img
                                        src={display.avatar}
                                        alt={display.handle}
                                        className="w-10 h-10 rounded-full bg-[var(--bg-secondary)] object-cover shrink-0"
                                    />

                                    <div className="flex-1 min-w-0">
                                        {/* Header */}
                                        <div className="flex items-start justify-between mb-1">
                                            <div>
                                                <div className="flex items-center gap-1 min-w-0">
                                                    <span className="font-bold text-[var(--text-primary)] text-sm truncate">{display.name}</span>
                                                    {display.verified && <BadgeCheck size={14} className="text-white fill-[#1d9bf0] shrink-0" />}
                                                </div>
                                                <div className="text-[var(--text-secondary)] text-sm truncate">{display.handle}</div>
                                            </div>
                                            {isGrouped && (
                                                <span className="shrink-0 px-2 py-0.5 rounded-full bg-[var(--bg-secondary)] border border-[var(--border-color)] text-[10px] font-medium text-[var(--text-secondary)]">
                                                    {group.length} Activities
                                                </span>
                                            )}
                                        </div>

                                        {/* Content */}
                                        <p className="text-[var(--text-primary)] text-sm leading-relaxed whitespace-pre-wrap mb-3 line-clamp-3">
                                            {display.content || <span className="text-[var(--text-secondary)] italic">{t.boost.noContentPreview}</span>}
                                        </p>

                                        {/* Footer Info */}
                                        <div className="flex items-center justify-between text-xs text-[var(--text-secondary)] mt-2">
                                            <div className="flex items-center gap-4">
                                                <span className="flex items-center gap-1.5">
                                                    <Users size={14} className="text-[var(--text-secondary)]" />
                                                    {display.quoterCount + display.retweeterCount}
                                                </span>
                                                <span className="flex items-center gap-1.5">
                                                    <Clock size={14} className="text-[var(--text-secondary)]" />
                                                    {display.timeDisplay}
                                                </span>
                                            </div>

                                            <div className="font-bold text-[#F0B90B] text-sm">
                                                {totalBudget} USD
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                        </div>
                    );
                }))}

                {/* Loading more indicator */}
                {isLoadingMore && (
                    <div className="flex justify-center py-4">
                        <div className="w-5 h-5 border-2 border-[var(--border-color)] border-t-[var(--text-primary)] rounded-full animate-spin" />
                    </div>
                )}
            </div>
        </div >
    );
};
