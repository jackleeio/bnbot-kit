
import React, { useState, useRef, useEffect } from 'react';
import { BadgeCheck, BarChart2, MessageCircle, Repeat, Heart, Share, Bot, X, FileText, Sparkles, MessageSquareQuote, Send, Bitcoin, Cpu, ChevronUp, Newspaper } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { geminiService } from '../../services/geminiService';
import { chatService } from '../../services/chatService';
import { analysisService, ApiTweet } from '../../services/analysisService';
import { ChatMessage } from '../../types';
import { navigateToUrl } from '../../utils/navigationUtils';
import { useLanguage } from '../LanguageContext';

// --- Mock Tweet Data ---
interface Tweet {
  id: string;
  avatar: string;
  name: string;
  handle: string;
  time: string;
  content: React.ReactNode;
  fullContent: React.ReactNode;
  rawContent: string;
  isTruncated: boolean;
  stats: {
    replies: string;
    reposts: string;
    likes: string;
    views: string;
  };
  verified?: boolean;
  media?: { url: string; type: 'photo' | 'video' | 'animated_gif'; thumbnail?: string }[];
  quotedTweet?: Tweet | null;
  isRetweet?: boolean;
  retweetedUsername?: string;
  originalRawContent?: string;
  hasTranslation?: boolean;
}

// Helper to format numbers
const formatNumber = (num?: number) => {
  if (!num) return '0';
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'k';
  return num.toString();
};

// Helper to format time
const formatTime = (dateStr: string) => {
  const date = new Date(dateStr);
  const now = new Date();
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (diffInSeconds < 60) return `${diffInSeconds}s`;
  if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m`;
  if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h`;
  return `${Math.floor(diffInSeconds / 86400)}d`;
};

// Image with skeleton loading
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

// Skeleton Component - uses CSS variables to follow app theme, not system theme
const TweetSkeleton = () => (
  <div className="border-b border-[var(--border-color)] py-4 -mx-4 px-4">
    <div className="flex gap-3">
      {/* Avatar Skeleton */}
      <div className="w-10 h-10 rounded-full bg-[var(--hover-bg)] animate-pulse" />

      <div className="flex-1 min-w-0 space-y-3">
        {/* Header Skeleton */}
        <div className="flex items-center gap-2">
          <div className="h-4 w-24 bg-[var(--hover-bg)] rounded animate-pulse" />
          <div className="h-4 w-16 bg-[var(--hover-bg)] rounded animate-pulse" />
          <div className="h-4 w-12 bg-[var(--hover-bg)] rounded animate-pulse" />
        </div>

        {/* Content Skeleton */}
        <div className="space-y-2">
          <div className="h-4 w-full bg-[var(--hover-bg)] rounded animate-pulse" />
          <div className="h-4 w-[90%] bg-[var(--hover-bg)] rounded animate-pulse" />
          <div className="h-4 w-[60%] bg-[var(--hover-bg)] rounded animate-pulse" />
        </div>

        {/* Action Bar Skeleton */}
        <div className="flex justify-between pr-12 pt-1">
          <div className="h-4 w-8 bg-[var(--hover-bg)] rounded animate-pulse" />
          <div className="h-4 w-8 bg-[var(--hover-bg)] rounded animate-pulse" />
          <div className="h-4 w-8 bg-[var(--hover-bg)] rounded animate-pulse" />
          <div className="h-4 w-8 bg-[var(--hover-bg)] rounded animate-pulse" />
        </div>
      </div>
    </div>
  </div>
);

interface AnalysisPanelProps {
  onStayOnPageChange?: (stay: boolean) => void;
}

const STAY_ON_PAGE_KEY = 'bnbot_analysis_stay_on_page';

export const AnalysisPanel: React.FC<AnalysisPanelProps> = ({ onStayOnPageChange }) => {
  const { language, t } = useLanguage();
  const [activeSubTab, setActiveSubTab] = useState<'market' | 'ai'>('market');
  const [selectedTweet, setSelectedTweet] = useState<Tweet | null>(null);
  const [expandedTweets, setExpandedTweets] = useState<Set<string>>(new Set());
  const [stayOnPage, setStayOnPage] = useState(() => {
    // Initialize from localStorage
    try {
      return localStorage.getItem(STAY_ON_PAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });

  // Sync stayOnPage to parent and storage on mount
  useEffect(() => {
    onStayOnPageChange?.(stayOnPage);
  }, []);

  // Save stayOnPage to storage whenever it changes
  const handleStayOnPageChange = (value: boolean) => {
    setStayOnPage(value);
    onStayOnPageChange?.(value);
    try {
      localStorage.setItem(STAY_ON_PAGE_KEY, String(value));
    } catch (e) {
      console.error('Failed to save stayOnPage setting:', e);
    }
  };

  // Chat State for the Modal
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const [tweets, setTweets] = useState<Tweet[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [showOriginalIds, setShowOriginalIds] = useState<Set<string>>(new Set());
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // AI Summary state
  const [showSummaryPanel, setShowSummaryPanel] = useState(false);
  const [summaryContent, setSummaryContent] = useState('');
  const [isSummarizing, setIsSummarizing] = useState(false);

  const isZh = language === 'zh';

  const handleAISummary = async () => {
    if (isSummarizing) return;

    setShowSummaryPanel(true);
    setIsSummarizing(true);
    setSummaryContent('');

    try {
      // Use already loaded tweets, or fetch if empty
      let postsForSummary = tweets;
      if (postsForSummary.length === 0) {
        const kolType = activeSubTab === 'market' ? 'crypto' : 'ai';
        const response = await analysisService.getKolRecentData({ kol_type: kolType, page_size: 20 });
        if (response.data) {
          postsForSummary = mapApiTweets(response.data);
        }
      }

      if (postsForSummary.length === 0) {
        setSummaryContent(isZh ? '暂无推文数据，请稍后再试。' : 'No tweet data available. Please try again later.');
        setIsSummarizing(false);
        return;
      }

      const topicLabel = activeSubTab === 'market' ? 'Crypto / Web3' : 'AI / Tech';
      const tweetsText = postsForSummary.slice(0, 20).map((t, i) =>
        `${i + 1}. @${t.handle}: "${t.rawContent.slice(0, 300)}"`
      ).join('\n');

      const prompt = `You are a news briefing editor. Based on the following ${topicLabel} tweets from top KOLs, generate a concise daily briefing summary.

**Tweets:**
${tweetsText}

Please generate a briefing in this format:

## Headlines
3-5 most important topics/events mentioned across these tweets, each as a one-line bullet.

## Key Developments
For each major topic, provide 2-3 sentences of context synthesized from multiple tweets. Group related tweets together.

## Market Sentiment
One short paragraph on the overall sentiment and mood from these KOLs.

## Worth Watching
2-3 emerging trends or topics that are starting to gain attention.

Keep it concise, informative, and easy to scan. Write like a professional news briefing.

IMPORTANT: You MUST respond entirely in ${isZh ? 'Chinese (简体中文)' : 'English'}.`;

      await chatService.sendChatV2Stream(
        prompt,
        (chunk) => {
          setSummaryContent(prev => prev + chunk);
        }
      );
    } catch (error) {
      console.error('[AnalysisPanel] AI Summary error:', error);
      setSummaryContent(isZh ? '生成摘要失败，请重试。' : 'Failed to generate summary. Please try again.');
    } finally {
      setIsSummarizing(false);
    }
  };

  const formatTweetContent = (text: string) => {
    // Match @mentions and URLs (with or without https://)
    const pattern = /(@[\w_]+)|(https?:\/\/[^\s]+)|((x\.com|twitter\.com)\/[^\s]+)/g;
    const parts: (string | { type: 'mention' | 'url'; value: string })[] = [];
    let lastIndex = 0;
    let match;

    while ((match = pattern.exec(text)) !== null) {
      if (match.index > lastIndex) {
        parts.push(text.slice(lastIndex, match.index));
      }
      if (match[1]) {
        parts.push({ type: 'mention', value: match[1] });
      } else if (match[2]) {
        parts.push({ type: 'url', value: match[2] });
      } else if (match[3]) {
        parts.push({ type: 'url', value: match[3] });
      }
      lastIndex = pattern.lastIndex;
    }
    if (lastIndex < text.length) {
      parts.push(text.slice(lastIndex));
    }

    return (
      <>
        {parts.map((part, index) => {
          if (typeof part === 'string') {
            return part;
          }
          if (part.type === 'mention') {
            return (
              <span
                key={index}
                className="text-[#1d9bf0] hover:underline cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  navigateToUrl(`https://x.com/${part.value.slice(1)}`);
                }}
              >
                {part.value}
              </span>
            );
          }
          if (part.type === 'url') {
            const url = part.value.startsWith('http') ? part.value : `https://${part.value}`;
            const displayUrl = part.value.replace(/^https?:\/\//, '').slice(0, 30) + (part.value.length > 40 ? '...' : '');
            return (
              <span
                key={index}
                className="text-[#1d9bf0] hover:underline cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  navigateToUrl(url);
                }}
              >
                {displayUrl}
              </span>
            );
          }
          return null;
        })}
      </>
    );
  };

  const getLocalizedText = (text: string, textEn?: string, textZh?: string) => {
    if (language === 'zh') {
      // If original is Chinese (text == textZh), use text. Otherwise use textZh if available.
      return (text === textZh) ? text : (textZh || text);
    }
    if (language === 'en') {
      // If original is English (text == textEn), use text. Otherwise use textEn if available.
      return (text === textEn) ? text : (textEn || text);
    }
    return text;
  };

  const mapApiTweets = (data: ApiTweet[]): Tweet[] => {
    return data.map((apiTweet: ApiTweet) => {
      // For retweets, use retweeted_tweet content if available
      let tweetText = getLocalizedText(apiTweet.text, apiTweet.text_en, apiTweet.text_zh);
      const isRetweet = apiTweet.is_retweet && !!apiTweet.retweeted_tweet;
      const retweetedUsername = isRetweet ? apiTweet.retweeted_tweet!.username : undefined;

      const hasTranslation = language === 'zh'
        ? !!apiTweet.text_zh && apiTweet.text_zh !== apiTweet.text
        : !!apiTweet.text_en && apiTweet.text_en !== apiTweet.text;

      if (isRetweet) {
        tweetText = getLocalizedText(
          apiTweet.retweeted_tweet!.text,
          apiTweet.retweeted_tweet!.text_en,
          apiTweet.retweeted_tweet!.text_zh
        );
      }

      const quotedText = apiTweet.quoted_tweet
        ? getLocalizedText(apiTweet.quoted_tweet.text, apiTweet.quoted_tweet.text_en, apiTweet.quoted_tweet.text_zh)
        : '';

      const quotedHasTranslation = apiTweet.quoted_tweet
        ? (language === 'zh'
          ? !!apiTweet.quoted_tweet.text_zh && apiTweet.quoted_tweet.text_zh !== apiTweet.quoted_tweet.text
          : !!apiTweet.quoted_tweet.text_en && apiTweet.quoted_tweet.text_en !== apiTweet.quoted_tweet.text)
        : false;

      const isTruncated = tweetText.length > 150 || tweetText.endsWith('...') || tweetText.endsWith('…');
      const isQuotedTruncated = quotedText.length > 150 || quotedText.endsWith('...') || quotedText.endsWith('…');

      return {
        id: apiTweet.id_str,
        avatar: apiTweet.user.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${apiTweet.user.username}`,
        name: apiTweet.user.name,
        handle: `@${apiTweet.user.username}`,
        time: formatTime(apiTweet.created_at),
        verified: apiTweet.user.is_blue_verified,
        rawContent: tweetText,
        originalRawContent: isRetweet && apiTweet.retweeted_tweet ? apiTweet.retweeted_tweet.text : apiTweet.text,
        hasTranslation: isRetweet && apiTweet.retweeted_tweet
          ? (language === 'zh'
            ? !!apiTweet.retweeted_tweet.text_zh && apiTweet.retweeted_tweet.text_zh !== apiTweet.retweeted_tweet.text
            : !!apiTweet.retweeted_tweet.text_en && apiTweet.retweeted_tweet.text_en !== apiTweet.retweeted_tweet.text)
          : hasTranslation,
        isTruncated,
        media: apiTweet.media,
        quotedTweet: apiTweet.quoted_tweet ? {
          id: apiTweet.quoted_tweet.id_str,
          avatar: apiTweet.quoted_tweet.user.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${apiTweet.quoted_tweet.user.username}`,
          name: apiTweet.quoted_tweet.user.name,
          handle: `@${apiTweet.quoted_tweet.user.username}`,
          time: formatTime(apiTweet.quoted_tweet.created_at),
          verified: apiTweet.quoted_tweet.user.is_blue_verified,
          content: formatTweetContent(
            isQuotedTruncated ? quotedText.slice(0, 150) : quotedText
          ),
          fullContent: formatTweetContent(quotedText),
          rawContent: quotedText,
          originalRawContent: apiTweet.quoted_tweet.text,
          hasTranslation: quotedHasTranslation,
          isTruncated: isQuotedTruncated,
          stats: {
            replies: formatNumber(apiTweet.quoted_tweet.reply_count),
            reposts: formatNumber(apiTweet.quoted_tweet.retweet_count),
            likes: formatNumber(apiTweet.quoted_tweet.like_count),
            views: formatNumber(parseInt(apiTweet.quoted_tweet.view_count || '0'))
          },
          media: apiTweet.quoted_tweet.media
        } : null,
        content: formatTweetContent(
          isTruncated ? tweetText.slice(0, 150) : tweetText
        ),
        fullContent: formatTweetContent(tweetText),
        stats: {
          replies: formatNumber(apiTweet.reply_count),
          reposts: formatNumber(apiTweet.retweet_count),
          likes: formatNumber(apiTweet.like_count),
          views: formatNumber(parseInt(apiTweet.view_count || '0'))
        },
        isRetweet,
        retweetedUsername
      };
    });
  };

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      setTweets([]);
      setNextCursor(null);
      setHasMore(true);
      try {
        const kolType = activeSubTab === 'market' ? 'crypto' : 'ai';
        const response = await analysisService.getKolRecentData({ kol_type: kolType, page_size: 20 });

        if (response.data) {
          setTweets(mapApiTweets(response.data));
          setNextCursor(response.cursor || null);
          setHasMore(!!response.cursor);
        }
      } catch (error) {
        console.error('Failed to fetch tweets:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [activeSubTab, language]);

  // Load more tweets when scrolling to bottom
  const loadMore = async () => {
    if (isLoadingMore || !hasMore || !nextCursor) return;

    setIsLoadingMore(true);
    try {
      const kolType = activeSubTab === 'market' ? 'crypto' : 'ai';
      const response = await analysisService.getKolRecentData({
        kol_type: kolType,
        cursor: String(nextCursor),
        page_size: 20
      });

      if (response.data && response.data.length > 0) {
        const newTweets = mapApiTweets(response.data);

        setTweets(prev => [...prev, ...newTweets]);
        setNextCursor(response.cursor || null);
        setHasMore(!!response.cursor);
      } else {
        setHasMore(false);
      }
    } catch (error) {
      console.error('Failed to load more tweets:', error);
    } finally {
      setIsLoadingMore(false);
    }
  };

  // Use refs to avoid stale closures in scroll handler
  const loadMoreRef = useRef(loadMore);
  loadMoreRef.current = loadMore;

  // Scroll event handler
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      // Load more when remaining content is less than 1.5x viewport height
      // This triggers loading much earlier for smoother infinite scroll
      if (scrollHeight - scrollTop - clientHeight < clientHeight * 1.5) {
        loadMoreRef.current();
      }
    };

    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatMessages]);

  const handleSendMessage = async (text: string) => {
    if (!text.trim() || !selectedTweet) return;

    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      text: text,
      timestamp: new Date()
    };

    setChatMessages(prev => [...prev, userMsg]);
    setChatInput('');
    setIsChatLoading(true);

    try {
      // Contextual prompt
      const contextPrompt = `Context: User is asking about this tweet: "${selectedTweet.rawContent}". 
      User Question: ${text}`;

      const stream = await geminiService.sendMessageStream(contextPrompt);

      const botMsgId = (Date.now() + 1).toString();
      setChatMessages(prev => [...prev, {
        id: botMsgId,
        role: 'model',
        text: '',
        timestamp: new Date()
      }]);

      let fullText = '';
      for await (const chunk of stream) {
        fullText += chunk;
        setChatMessages(prev => prev.map(msg =>
          msg.id === botMsgId ? { ...msg, text: fullText } : msg
        ));
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsChatLoading(false);
    }
  };

  const closeChat = () => {
    setSelectedTweet(null);
    setChatMessages([]);
    setChatInput('');
  };

  return (
    <div className="flex flex-col h-full bg-transparent relative">

      {/* Top Pill Navigation */}
      <div className="px-4 py-3 flex justify-between items-center">
        <div />
        <div className="flex items-center gap-2">
          {/* AI Summary Button */}
          <button
            onClick={handleAISummary}
            disabled={isSummarizing || isLoading}
            className="p-1.5 rounded-lg bg-black text-white hover:opacity-90 transition-opacity disabled:opacity-50 cursor-pointer"
            title={isZh ? '今日摘要' : 'Daily Briefing'}
          >
            <Newspaper size={14} />
          </button>

          <div className="flex p-1 bg-[var(--bg-secondary)] rounded-full border border-[var(--border-color)]">
          <button
            onClick={() => setActiveSubTab('market')}
            className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all duration-300 cursor-pointer ${activeSubTab === 'market'
              ? 'bg-[var(--bg-primary)] text-[var(--text-primary)] shadow-sm border border-[var(--border-color)]'
              : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
          >
            Crypto
          </button>
          <button
            onClick={() => setActiveSubTab('ai')}
            className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all duration-300 cursor-pointer ${activeSubTab === 'ai'
              ? 'bg-[var(--bg-primary)] text-[var(--text-primary)] shadow-sm border border-[var(--border-color)]'
              : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
          >
            AI
          </button>
          </div>
        </div>
      </div>

      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto p-4 pt-2 pb-20">
        {isLoading ? (
          <div className="space-y-0">
            {[...Array(5)].map((_, i) => (
              <TweetSkeleton key={i} />
            ))}
          </div>
        ) : (
          <div className="space-y-0 animate-in fade-in slide-in-from-bottom-2 duration-300 h-full">
            {tweets.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <div className="bg-[var(--bg-secondary)] p-4 rounded-full mb-3">
                  <FileText size={24} className="text-[var(--text-secondary)]" />
                </div>
                <p className="text-[var(--text-primary)] font-medium">No tweets found</p>
                <p className="text-[var(--text-secondary)] text-sm mt-1">Try checking back later</p>
              </div>
            ) : (
              tweets.map((tweet, index) => {
                const isExpanded = expandedTweets.has(tweet.id);
                const showExpandButton = tweet.isTruncated && !isExpanded;
                const isShowingOriginal = showOriginalIds.has(tweet.id);

                let contentToDisplay = isExpanded ? tweet.fullContent : tweet.content;
                const showMoreOriginal = isShowingOriginal && tweet.originalRawContent && tweet.originalRawContent.length > 150 && !isExpanded;

                if (isShowingOriginal && tweet.originalRawContent) {
                  const raw = tweet.originalRawContent;
                  const isOriginalTruncated = raw.length > 150;
                  const textToShow = (!isExpanded && isOriginalTruncated) ? raw.slice(0, 150) + '...' : raw;
                  contentToDisplay = formatTweetContent(textToShow);
                }

                return (
                  <div
                    key={tweet.id}
                    onClick={() => {
                      console.log('[AnalysisPanel] Click tweet, isTruncated:', tweet.isTruncated, 'isExpanded:', isExpanded);
                      // If truncated and not expanded, expand first
                      if ((tweet.isTruncated || showMoreOriginal) && !isExpanded) {
                        setExpandedTweets(prev => new Set(prev).add(tweet.id));
                      } else {
                        // Always navigate to tweet URL (browser will navigate)
                        // App.tsx will check stayOnPage to decide if panel should switch
                        const tweetUrl = `https://x.com/${tweet.handle.replace('@', '')}/status/${tweet.id}`;
                        console.log('[AnalysisPanel] Navigating to:', tweetUrl);
                        navigateToUrl(tweetUrl);
                      }
                    }}
                    className={`py-4 hover:bg-[var(--card-hover-bg)] -mx-4 px-4 cursor-pointer group ${index < tweets.length - 1 ? 'tweet-divider' : ''}`}
                    style={{ transition: 'background-color 0.15s ease' }}
                  >
                    <div className="flex gap-3">
                      {/* Avatar */}
                      <img src={tweet.avatar} alt={tweet.handle} className="w-10 h-10 rounded-full bg-[var(--bg-secondary)] group-hover:opacity-80 transition-opacity" />

                      <div className="flex-1 min-w-0">
                        {/* Header */}
                        <div className="flex items-center gap-1 min-w-0 mb-1">
                          <span className="font-bold text-[var(--text-primary)] text-sm truncate">{tweet.name}</span>
                          {tweet.verified && <BadgeCheck size={14} className="text-white fill-[#1d9bf0]" />}
                          <span className="text-[var(--text-secondary)] text-sm truncate ml-0.5">{tweet.handle}</span>
                          <span className="text-[var(--text-secondary)] text-sm">·</span>
                          <span className="text-[var(--text-secondary)] text-sm">{tweet.time}</span>
                        </div>

                        {/* RT badge for retweets */}
                        {tweet.isRetweet && tweet.retweetedUsername && (
                          <div className="text-[var(--text-secondary)] text-xs mb-1">
                            RT @{tweet.retweetedUsername}
                          </div>
                        )}

                        {/* Content */}
                        <p className="text-[var(--text-primary)] text-sm leading-relaxed whitespace-pre-wrap mb-1">
                          {contentToDisplay}
                        </p>
                        {(showExpandButton || showMoreOriginal) && (
                          <button
                            className="text-[#1d9bf0] text-sm hover:underline mb-2"
                            onClick={(e) => {
                              e.stopPropagation();
                              setExpandedTweets(prev => new Set(prev).add(tweet.id));
                            }}
                          >
                            {t.common.showMore}
                          </button>
                        )}
                        {!(showExpandButton || showMoreOriginal) && <div className="mb-2" />}

                        {/* Media Grid */}
                        {tweet.media && tweet.media.length > 0 && (
                          <div className={`grid gap-0.5 mb-3 rounded-xl overflow-hidden border-[1px] border-solid border-[var(--border-color)] ${tweet.media.length === 1 ? 'grid-cols-1' :
                            tweet.media.length === 2 ? 'grid-cols-2 aspect-video' :
                              tweet.media.length >= 3 ? 'grid-cols-2 grid-rows-2 aspect-video' : 'grid-cols-2 aspect-video'
                            }`}>
                            {tweet.media.map((media, index) => (
                              <div key={index} className={`relative ${tweet.media!.length === 3 && index === 0 ? 'row-span-2' : ''
                                } ${media.type === 'video' || media.type === 'animated_gif' ? 'col-span-full' : ''}`}>
                                {media.type === 'photo' ? (
                                  <ImageWithSkeleton
                                    src={media.url}
                                    alt="Tweet media"
                                    className={`w-full object-cover object-top bg-[var(--bg-secondary)] ${tweet.media!.length === 1 ? 'max-h-[350px] h-auto' : 'h-full'
                                      }`}
                                  />
                                ) : (
                                  <div
                                    className={`w-full rounded-xl overflow-hidden bg-black flex items-center justify-center ${tweet.media!.length === 1 ? '' : 'h-full'
                                      }`}
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <video
                                      src={media.url}
                                      poster={media.thumbnail}
                                      controls
                                      className={`object-contain ${tweet.media!.length === 1 ? 'w-full h-auto max-h-[350px]' : 'w-full h-full'
                                        }`}
                                    />
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Quoted Tweet */}
                        {tweet.quotedTweet && (
                          <div
                            className="quoted-tweet rounded-2xl mb-3 cursor-pointer mt-2 overflow-hidden"
                            style={{ border: '1px solid' }}
                            onClick={(e) => {
                              e.stopPropagation();
                              const quotedUrl = `https://x.com/${tweet.quotedTweet!.handle.replace('@', '')}/status/${tweet.quotedTweet!.id}`;
                              navigateToUrl(quotedUrl);
                            }}
                          >
                            <div className="p-3 pb-2">
                              <div className="flex items-center gap-1 mb-1.5 min-w-0">
                                <img src={tweet.quotedTweet.avatar} alt="" className="w-5 h-5 rounded-full" />
                                <div className="flex items-center gap-1 min-w-0 flex-1">
                                  <span className="quoted-tweet-text font-bold text-sm truncate text-[var(--text-primary)]">{tweet.quotedTweet.name}</span>
                                  {tweet.quotedTweet.verified && <BadgeCheck size={14} className="text-white fill-[#1d9bf0] shrink-0" />}
                                  <span className="quoted-tweet-text text-sm truncate text-[var(--text-secondary)]">{tweet.quotedTweet.handle}</span>
                                  <span className="quoted-tweet-text text-sm shrink-0 text-[var(--text-secondary)]">·</span>
                                  <span className="quoted-tweet-text text-sm shrink-0 text-[var(--text-secondary)]">{tweet.quotedTweet.time}</span>
                                </div>
                              </div>
                              <p className="quoted-tweet-text text-sm leading-relaxed whitespace-pre-wrap text-[var(--text-primary)]">
                                {tweet.quotedTweet.content}
                              </p>
                            </div>
                            {tweet.quotedTweet.media && tweet.quotedTweet.media.length > 0 && (
                              <div
                                className={`grid gap-0.5 overflow-hidden ${tweet.quotedTweet.media.length === 1 ? 'grid-cols-1' :
                                  tweet.quotedTweet.media.length === 2 ? 'grid-cols-2 aspect-video' :
                                    tweet.quotedTweet.media.length >= 3 ? 'grid-cols-2 grid-rows-2 aspect-video' : 'grid-cols-2 aspect-video'
                                  }`}
                              >
                                {tweet.quotedTweet.media.map((media, index) => (
                                  <div key={index} className={`relative ${tweet.quotedTweet!.media!.length === 3 && index === 0 ? 'row-span-2' : ''
                                    } ${media.type === 'video' || media.type === 'animated_gif' ? 'col-span-full' : ''}`}>
                                    {media.type === 'photo' ? (
                                      <ImageWithSkeleton
                                        src={media.url}
                                        alt="Quoted media"
                                        className={`w-full object-cover object-top bg-[var(--bg-secondary)] ${tweet.quotedTweet!.media!.length === 1 ? 'max-h-[250px] h-auto' : 'h-full'
                                          }`}
                                      />
                                    ) : (
                                      <div
                                        className={`w-full bg-black flex items-center justify-center ${tweet.quotedTweet!.media!.length === 1 ? '' : 'h-full'
                                          }`}
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        <video
                                          src={media.url}
                                          poster={media.thumbnail}
                                          controls
                                          className={`object-contain ${tweet.quotedTweet!.media!.length === 1 ? 'w-full h-auto max-h-[300px]' : 'w-full h-full'
                                            }`}
                                        />
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}

                        {/* Action Bar */}
                        <div className="flex items-center justify-between text-[var(--text-secondary)] pr-4">
                          {/* Left side actions */}
                          <div className="flex items-center gap-4">
                            {isExpanded && (
                              <button
                                className="p-1 hover:bg-[var(--hover-bg)] rounded-full transition-colors text-[#1d9bf0]"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setExpandedTweets(prev => {
                                    const newSet = new Set(prev);
                                    newSet.delete(tweet.id);
                                    return newSet;
                                  });
                                }}
                              >
                                <ChevronUp size={16} />
                              </button>
                            )}

                            {/* Show Original/Translation Button */}
                            {tweet.hasTranslation && (
                              <button
                                className="opacity-0 group-hover:opacity-100 transition-opacity text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:underline"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setShowOriginalIds(prev => {
                                    const newSet = new Set(prev);
                                    if (newSet.has(tweet.id)) {
                                      newSet.delete(tweet.id);
                                    } else {
                                      newSet.add(tweet.id);
                                    }
                                    return newSet;
                                  });
                                }}
                              >
                                {isShowingOriginal ? (language === 'zh' ? '显示翻译' : 'Show Translation') : (language === 'zh' ? '显示原文' : 'Show Original')}
                              </button>
                            )}
                          </div>

                          <div className="flex items-center gap-2">
                            <button className="flex items-center group/btn transition-colors cursor-default">
                              <div className="p-1.5 rounded-full transition-colors">
                                <MessageCircle size={13} />
                              </div>
                              <span className="text-xs">{tweet.stats.replies}</span>
                            </button>
                            <button className="flex items-center group/btn transition-colors cursor-default">
                              <div className="p-1.5 rounded-full transition-colors">
                                <Repeat size={13} />
                              </div>
                              <span className="text-xs">{tweet.stats.reposts}</span>
                            </button>
                            <button className="flex items-center group/btn transition-colors cursor-default">
                              <div className="p-1.5 rounded-full transition-colors">
                                <Heart size={13} />
                              </div>
                              <span className="text-xs">{tweet.stats.likes}</span>
                            </button>
                            <button className="flex items-center group/btn transition-colors cursor-default">
                              <div className="p-1.5 rounded-full transition-colors">
                                <BarChart2 size={13} />
                              </div>
                              <span className="text-xs">{tweet.stats.views}</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
            {/* Loading more indicator */}
            {isLoadingMore && (
              <div className="py-4 flex justify-center">
                <div className="flex gap-0.5">
                  <div className="w-1 h-1 bg-[var(--text-secondary)] rounded-full animate-bounce" />
                  <div className="w-1 h-1 bg-[var(--text-secondary)] rounded-full animate-bounce" style={{ animationDelay: '0.1s' }} />
                  <div className="w-1 h-1 bg-[var(--text-secondary)] rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* AI Summary Panel - Bottom slide-in */}
      {showSummaryPanel && (
        <div
          className="absolute bottom-0 left-0 right-0 bg-[var(--bg-primary)] rounded-t-2xl border-t border-[var(--border-color)] z-50"
          style={{
            height: '93%',
            animation: 'summarySlideUp 0.3s ease-out',
            boxShadow: '0 -8px 30px rgba(0, 0, 0, 0.15)'
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3.5">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center">
                <Newspaper size={14} className="text-white" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-[var(--text-primary)] leading-tight">
                  {activeSubTab === 'market'
                    ? (isZh ? 'Crypto 今日速览' : 'Crypto Daily Briefing')
                    : (isZh ? 'AI 今日速览' : 'AI Daily Briefing')}
                </h3>
                {isSummarizing && (
                  <p className="text-[10px] text-[var(--text-tertiary)] mt-0.5">{isZh ? '正在生成...' : 'Generating...'}</p>
                )}
              </div>
            </div>
            <button
              onClick={() => setShowSummaryPanel(false)}
              className="p-1.5 rounded-lg hover:bg-[var(--hover-bg)] transition-colors"
            >
              <X size={16} className="text-[var(--text-secondary)]" />
            </button>
          </div>

          <div className="mx-5 border-b border-[var(--border-color)]" />

          {/* Content */}
          <div className="px-5 py-4 overflow-y-auto" style={{ height: 'calc(100% - 60px)', scrollbarWidth: 'none' }}>
            {isSummarizing && !summaryContent ? (
              <div className="space-y-6 animate-pulse">
                <div className="rounded-xl bg-[var(--hover-bg)]/50 p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 bg-[var(--hover-bg)] rounded" />
                    <div className="h-4 bg-[var(--hover-bg)] rounded-md w-1/3" />
                  </div>
                  <div className="space-y-2 pl-1">
                    <div className="h-3 bg-[var(--hover-bg)] rounded w-full" />
                    <div className="h-3 bg-[var(--hover-bg)] rounded w-11/12" />
                    <div className="h-3 bg-[var(--hover-bg)] rounded w-4/5" />
                  </div>
                </div>
                <div className="rounded-xl bg-[var(--hover-bg)]/50 p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 bg-[var(--hover-bg)] rounded" />
                    <div className="h-4 bg-[var(--hover-bg)] rounded-md w-2/5" />
                  </div>
                  <div className="space-y-2 pl-1">
                    <div className="h-3 bg-[var(--hover-bg)] rounded w-10/12" />
                    <div className="h-3 bg-[var(--hover-bg)] rounded w-9/12" />
                    <div className="h-3 bg-[var(--hover-bg)] rounded w-full" />
                  </div>
                </div>
                <div className="rounded-xl bg-[var(--hover-bg)]/50 p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 bg-[var(--hover-bg)] rounded" />
                    <div className="h-4 bg-[var(--hover-bg)] rounded-md w-1/4" />
                  </div>
                  <div className="space-y-2 pl-1">
                    <div className="h-3 bg-[var(--hover-bg)] rounded w-full" />
                    <div className="h-3 bg-[var(--hover-bg)] rounded w-3/4" />
                  </div>
                </div>
              </div>
            ) : (
              <div className="prose prose-sm max-w-none
                prose-headings:text-[var(--text-primary)] prose-headings:font-semibold prose-headings:tracking-tight
                prose-h2:text-[13px] prose-h2:mt-5 prose-h2:mb-2 prose-h2:pb-1.5 prose-h2:border-b prose-h2:border-[var(--border-color)] first:prose-h2:mt-0
                prose-p:text-[var(--text-secondary)] prose-p:text-[13px] prose-p:leading-[1.7] prose-p:my-1.5
                prose-li:text-[var(--text-secondary)] prose-li:text-[13px] prose-li:leading-[1.7] prose-li:my-0.5 prose-li:pl-0
                prose-strong:text-[var(--text-primary)] prose-strong:font-semibold
                prose-ul:my-1.5 prose-ul:pl-1 prose-ul:list-disc
                prose-ol:my-1.5 prose-ol:pl-1">
                <ReactMarkdown>{summaryContent}</ReactMarkdown>
              </div>
            )}
          </div>
        </div>
      )}

      <style>{`
        @keyframes summarySlideUp {
          from { transform: translateY(100%); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
      `}</style>

      {/* Tweet Chat Modal Overlay */}
      {selectedTweet && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-[var(--bg-primary)] w-full h-full rounded-[2rem] shadow-2xl flex flex-col overflow-hidden relative border border-[var(--border-color)]">

            {/* Header */}
            <div className="px-5 py-4 border-b border-[var(--border-color)] flex items-center justify-between bg-[var(--bg-primary)] z-10">
              <div className="flex items-center gap-3">
                <div className="bg-[var(--text-primary)] p-1.5 rounded-lg text-[var(--bg-primary)]">
                  <Bot size={18} />
                </div>
                <h3 className="font-bold text-[var(--text-primary)]">BNBOT Assistant</h3>
              </div>
              <button
                onClick={closeChat}
                className="p-1.5 hover:bg-[var(--hover-bg)] rounded-full transition-colors text-[var(--text-secondary)]"
              >
                <X size={20} />
              </button>
            </div>

            {/* Chat Area */}
            <div className="flex-1 overflow-y-auto p-4 flex flex-col">
              {chatMessages.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center space-y-6">
                  <div className="space-y-2">
                    <h4 className="text-lg font-medium text-[var(--text-primary)]">Ask me anything about this tweet</h4>
                    <p className="text-sm text-[var(--text-secondary)] max-w-[240px] mx-auto">
                      Use the quick actions below or type your question
                    </p>
                  </div>

                  {/* Quick Actions */}
                  <div className="flex gap-2 flex-wrap justify-center">
                    <button
                      onClick={() => handleSendMessage("Summarize this tweet")}
                      className="flex items-center gap-2 px-4 py-2 rounded-full bg-[var(--bg-primary)] border border-[var(--border-color)] hover:border-[var(--accent-color)] hover:text-[var(--accent-text)] transition-all text-xs font-bold text-[var(--text-secondary)] shadow-sm"
                    >
                      <FileText size={14} /> Summary
                    </button>
                    <button
                      onClick={() => handleSendMessage("Draft a witty reply")}
                      className="flex items-center gap-2 px-4 py-2 rounded-full bg-[var(--bg-primary)] border border-[var(--border-color)] hover:border-[var(--accent-color)] hover:text-[var(--accent-text)] transition-all text-xs font-bold text-[var(--text-secondary)] shadow-sm"
                    >
                      <Sparkles size={14} /> AI Reply
                    </button>
                    <button
                      onClick={() => handleSendMessage("Quote this tweet with an insight")}
                      className="flex items-center gap-2 px-4 py-2 rounded-full bg-[var(--bg-primary)] border border-[var(--border-color)] hover:border-[var(--accent-color)] hover:text-[var(--accent-text)] transition-all text-xs font-bold text-[var(--text-secondary)] shadow-sm"
                    >
                      <MessageSquareQuote size={14} /> AI Quote
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  {chatMessages.map((msg) => (
                    <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div
                        className={`max-w-[85%] px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${msg.role === 'user'
                          ? 'bg-[var(--bg-secondary)] text-[var(--text-primary)] rounded-[20px] rounded-tr-sm'
                          : 'text-[var(--text-primary)]'
                          }`}
                      >
                        {msg.text}
                      </div>
                    </div>
                  ))}
                  {isChatLoading && (
                    <div className="flex justify-start">
                      <div className="flex gap-1 px-1">
                        <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" />
                        <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce delay-75" />
                        <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce delay-150" />
                      </div>
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                </div>
              )}
            </div>

            {/* Footer Input */}
            <div className="p-4 bg-[var(--bg-primary)] border-t border-[var(--border-color)]">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSendMessage(chatInput);
                }}
                className="relative"
              >
                <input
                  type="text"
                  placeholder="Type a message..."
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  className="w-full bg-[var(--bg-secondary)] text-[var(--text-primary)] placeholder-[var(--text-secondary)] text-sm rounded-full py-3 pl-4 pr-12 focus:outline-none focus:ring-1 focus:ring-[var(--accent-color)] border border-[var(--border-color)]"
                />
                <button
                  type="submit"
                  disabled={!chatInput.trim() || isChatLoading}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 p-2 bg-[var(--accent-color)] text-black rounded-full hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <Send size={14} strokeWidth={2.5} />
                </button>
              </form>
            </div>

          </div>
        </div>
      )}

    </div>
  );
};
