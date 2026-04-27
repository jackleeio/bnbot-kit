import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Send, Bot, MessageSquarePlus, Flame, Star, PieChart, MessageCircle, Search, ChevronDown, ChevronRight, Copy, RefreshCw, ArrowUp, ExternalLink, X, ArrowLeft, BadgeCheck, BarChart2, Repeat, Heart, Users, Layers, ShieldCheck, Sparkles, RotateCcw, Pen, Square, SquarePen, LayoutGrid, Image, PenTool, Check, Paperclip, Trash2, Undo, Edit3, Twitter, Bookmark, FileText, Zap, Calendar } from 'lucide-react';
import { AutoResizeTextarea } from '../AutoResizeTextarea';
import { NotificationToast } from '../NotificationToast';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import rehypeRaw from 'rehype-raw';
import { chatService } from '../../services/chatService';
import { authService } from '../../services/authService';

import { ChatMessage } from '../../types';
import { useLanguage } from '../LanguageContext';
import { useTheme } from '../ThemeContext';
import { ComposeIcon, ReplyIcon, XIcon, WeChatIcon, TikTokIcon, BitcoinIcon, GeminiIcon, BananaIcon, XiaohongshuIcon } from '../icons';
import { navigateToUrl } from '../../utils/navigationUtils';
import { TextSelectionPopover } from './TextSelectionPopover';
import { RewrittenTimeline, RewrittenTimelineData } from './RewrittenTimeline';
import { ArticleCard, ArticleData } from '../ArticleCard';
import { EditableImage } from '../EditableImage';
import { PromptPickerModal } from './PromptPickerModal';
import { handleImageDragStart } from '../../utils/mediaUtils';
import { initializeActionSystem, executeAction } from '../../services/actionIntegration';
import { actionExecutor } from '../../services/actionExecutor';
import { INTERRUPT_ACTIONS } from '../../types/action';
import { xUserStore } from '../../stores/xUserStore';
import { apiDataCache } from '../../utils/ApiDataCache';
import type { TimelineTweetData } from '../../utils/ApiDataCache';

declare const chrome: any;

// Helper to filter out internal JSON objects that shouldn't be displayed to users
const filterInternalJson = (text: string): string => {
  if (!text) return text;

  let result = text;

  // Helper to extract and remove a complete JSON object starting from a pattern
  const removeJsonObject = (str: string, pattern: RegExp): string => {
    let match;
    while ((match = pattern.exec(str)) !== null) {
      const startIndex = match.index;
      let braceCount = 1;
      let inString = false;
      let escapeNext = false;
      let i = startIndex + match[0].length;

      while (i < str.length && braceCount > 0) {
        const char = str[i];
        if (escapeNext) {
          escapeNext = false;
          i++;
          continue;
        }
        if (char === '\\' && inString) {
          escapeNext = true;
          i++;
          continue;
        }
        if (char === '"') {
          inString = !inString;
        } else if (!inString) {
          if (char === '{') braceCount++;
          else if (char === '}') braceCount--;
        }
        i++;
      }

      if (braceCount === 0) {
        const jsonToRemove = str.substring(startIndex, i);
        str = str.replace(jsonToRemove, '');
        // Reset pattern to search from beginning after modification
        pattern.lastIndex = 0;
      }
    }
    return str;
  };

  // Remove {"type": "needs_composer", ...} JSON objects
  result = removeJsonObject(result, /\{\s*"type"\s*:\s*"needs_composer"/g);

  // Also remove {"type": "needs_image", ...} JSON objects (another internal type)
  result = removeJsonObject(result, /\{\s*"type"\s*:\s*"needs_image"/g);

  return result.trim();
};

// Helper to render text with clickable links, @mentions, and #hashtags
const renderTextWithLinks = (
  text: string,
  options: {
    openInNewTab?: boolean; // for external links
    onNavigate?: (url: string) => void; // for internal Twitter navigation
  } = {}
): React.ReactNode => {
  const { openInNewTab = true, onNavigate } = options;
  const linkColor = '#1d9bf0'; // Twitter blue

  // Combined regex for URLs, @mentions, and #hashtags
  const pattern = /(https?:\/\/[^\s]+)|(@\w+)|(#\w+)/g;

  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    // Add text before the match
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    const [fullMatch] = match;
    const matchStart = match.index;

    if (fullMatch.startsWith('http')) {
      // URL - open in new tab
      parts.push(
        <a
          key={matchStart}
          href={fullMatch}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: linkColor }}
          className="hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          {fullMatch}
        </a>
      );
    } else if (fullMatch.startsWith('@')) {
      // @mention - navigate to user profile
      const username = fullMatch.slice(1);
      parts.push(
        <span
          key={matchStart}
          style={{ color: linkColor, cursor: 'pointer' }}
          className="hover:underline"
          onClick={(e) => {
            e.stopPropagation();
            const url = `https://x.com/${username}`;
            if (onNavigate) {
              onNavigate(url);
            } else if (openInNewTab) {
              window.open(url, '_blank');
            }
          }}
        >
          {fullMatch}
        </span>
      );
    } else if (fullMatch.startsWith('#')) {
      // #hashtag - navigate to hashtag search
      const hashtag = fullMatch.slice(1);
      parts.push(
        <span
          key={matchStart}
          style={{ color: linkColor, cursor: 'pointer' }}
          className="hover:underline"
          onClick={(e) => {
            e.stopPropagation();
            const url = `https://x.com/hashtag/${hashtag}`;
            if (onNavigate) {
              onNavigate(url);
            } else if (openInNewTab) {
              window.open(url, '_blank');
            }
          }}
        >
          {fullMatch}
        </span>
      );
    }

    lastIndex = match.index + fullMatch.length;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length > 0 ? parts : text;
};

// --- Interfaces & Helpers ---
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
}

interface OriginalMedia {
  type: "photo" | "video";
  media_url: string;
  video_url?: string; // For videos, the actual playable video URL
  thumbnail?: string; // For videos, the thumbnail/poster image URL (legacy format)
  thumbnail_url?: string; // For videos, the thumbnail/poster image URL (new format)
}

interface TweetDraft {
  action: 'post' | 'reply' | 'quote';
  content: string;
  reasoning: string;
  reference_tweet_ids: string[];
  image_suggestion: {
    has_suggestion: boolean;
    type: "chart" | "photo" | "meme" | "infographic" | "none";
    image_prompt: string;
    description: string;
  };
  hashtags: string[];
  original_media: OriginalMedia[];
  // Media object from backend (for videos like YouTube)
  media?: {
    type: 'video' | 'photo';
    url: string;
    thumbnail?: string;
    youtube_url?: string;
    // Split streams for YouTube
    audio_url?: string;
    video_url?: string; // Raw video stream if different from main url
    video_quality?: string;
    audio_quality?: string;
    title?: string;
  };
}

interface TweetDraftResponse {
  type: "tweet";
  data: {
    action: 'post' | 'reply' | 'quote';
    content: string;
    reasoning: string;
    reference_tweet_ids?: string[];
    image_suggestion?: {
      has_suggestion: boolean;
      type: 'chart' | 'photo' | 'meme' | 'infographic' | 'none';
      image_prompt: string;
      description: string;
    };
    hashtags?: string[];
    original_media?: Array<{
      type: 'photo' | 'video';
      media_url: string;
    }>;
    media?: {
      type: 'video' | 'photo' | null;
      video_url?: string;
      audio_url?: string;
      thumbnail?: string;
      youtube_url?: string;
    } | null;
  };
}

// Legacy format support (for backward compatibility)
interface TweetDraftResponseLegacy {
  type: "tweet";
  data: {
    drafts: TweetDraft[];
  };
}

interface RewrittenTimelineResponse {
  type: "rewritten_timeline";
  data: RewrittenTimelineData;
}

// Transform original_media from API format (Twitter-like or simple URL array) to component format
const transformOriginalMedia = (apiMedia: any[]): Array<{
  type: 'photo' | 'video';
  media_url: string;
  video_url?: string;
  thumbnail_url?: string;
}> => {
  if (!apiMedia || !Array.isArray(apiMedia)) return [];

  return apiMedia.map((media) => {
    // Handle simple string URL format (from AI-generated responses)
    if (typeof media === 'string') {
      const url = media;
      // Detect if it's a video by extension
      const isVideo = /\.(mp4|m3u8|webm|mov)(\?|$)/i.test(url);

      if (isVideo) {
        return {
          type: 'video' as const,
          media_url: '', // No thumbnail for raw video URL
          video_url: url,
        };
      } else {
        return {
          type: 'photo' as const,
          media_url: url,
        };
      }
    }

    // Handle object format (Twitter API format)
    const mediaType = media.type === 'video' ? 'video' : 'photo';

    if (mediaType === 'video') {
      // For videos, extract the best MP4 URL from video_info.variants
      let videoUrl = '';
      if (media.video_info?.variants) {
        // Find the highest bitrate MP4 variant
        const mp4Variants = media.video_info.variants
          .filter((v: any) => v.content_type === 'video/mp4')
          .sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0));

        if (mp4Variants.length > 0) {
          videoUrl = mp4Variants[0].url;
        }
      }

      // Fallback to video_url if provided directly
      if (!videoUrl && media.video_url) {
        videoUrl = media.video_url;
      }

      return {
        type: 'video' as const,
        media_url: videoUrl, // For videos, media_url should be the playable video URL
        video_url: videoUrl,
        thumbnail_url: media.media_url_https || media.media_url || media.thumbnail_url || media.thumbnail,
      };
    } else {
      // For photos, use media_url_https or media_url directly
      return {
        type: 'photo' as const,
        media_url: media.media_url_https || media.media_url || '',
      };
    }
  });
};

const formatNumber = (num?: number) => {
  if (!num) return '0';
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'k';
  return num.toString();
};

const formatTime = (dateStr: string) => {
  const date = new Date(dateStr);
  const now = new Date();
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (diffInSeconds < 60) return `${diffInSeconds} s`;
  if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)} m`;
  if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)} h`;
  return `${Math.floor(diffInSeconds / 86400)} d`;
};

export const ImageWithSkeleton = ({ src, alt, className, fallbackSrc }: { src: string, alt: string, className?: string, fallbackSrc?: string }) => {
  const [isLoaded, setIsLoaded] = useState(false);
  const [imgSrc, setImgSrc] = useState(src);
  const [triedProxy, setTriedProxy] = useState(false);

  useEffect(() => {
    setImgSrc(src);
    setTriedProxy(false);
  }, [src]);

  return (
    <div className={`relative ${className?.includes('w-') ? '' : 'w-full'} ${className?.includes('h-') ? '' : 'h-full'}`}>
      {!isLoaded && (
        <div className={`absolute inset-0 bg-[var(--hover-bg)] animate-pulse ${className?.includes('rounded') ? className.match(/rounded-[^\s]+/)?.[0] : ''}`} />
      )}
      <img
        src={imgSrc}
        alt={alt}
        className={`${className} ${isLoaded ? 'opacity-100' : 'opacity-0'} transition-opacity duration-300`}
        onLoad={() => setIsLoaded(true)}
        onError={(e) => {
          if (fallbackSrc && imgSrc !== fallbackSrc) {
            setImgSrc(fallbackSrc);
          } else if (!triedProxy && chrome?.runtime?.sendMessage) {
            // Try loading via background proxy to bypass CORS/mixed-content issues
            setTriedProxy(true);
            chrome.runtime.sendMessage({ type: 'FETCH_BLOB', url: src }, (response: any) => {
              if (response?.success && response?.data) {
                setImgSrc(response.data);
              } else {
                setIsLoaded(true); // Stop skeleton
              }
            });
          } else {
            setIsLoaded(true); // Stop skeleton if proxy also failed
          }
        }}
      />
    </div>
  );
};

const getSuggestions = (t: ReturnType<typeof import('../LanguageContext').useLanguage>['t']) => [
  { title: t.chat.suggestions.cryptoTrends, subtitle: t.chat.suggestions.cryptoTrendsSub, icon: BitcoinIcon, color: "#F7931A", query: t.chat.suggestions.cryptoTrendsQuery },
  { title: t.chat.suggestions.aiTrend, subtitle: t.chat.suggestions.aiTrendSub, icon: GeminiIcon, color: "#4285F4", query: t.chat.suggestions.aiTrendQuery },
  { title: t.chat.suggestions.createTweet, subtitle: t.chat.suggestions.createTweetSub, icon: ComposeIcon, color: "#1d9bf0", query: t.chat.suggestions.createTweetQuery },
  { title: t.chat.suggestions.imageGen, subtitle: t.chat.suggestions.imageGenSub, icon: BananaIcon, color: "#FEDA00", query: t.chat.suggestions.imageGenQuery },
  { title: t.chat.suggestions.search, subtitle: t.chat.suggestions.searchSub, icon: Search, color: "#4f46e5", query: t.chat.suggestions.searchQuery },
  { title: t.chat.suggestions.bookmarkSummary, subtitle: t.chat.suggestions.bookmarkSummarySub, icon: Bookmark, color: "#f59e0b", query: t.chat.suggestions.bookmarkSummaryQuery },
  { title: t.chat.suggestions.tiktokRepost, subtitle: t.chat.suggestions.tiktokRepostSub, icon: TikTokIcon, color: "#000000", query: t.chat.suggestions.tiktokRepostQuery },
  { title: t.chat.suggestions.wechatRepost, subtitle: t.chat.suggestions.wechatRepostSub, icon: WeChatIcon, color: "#07C160", query: t.chat.suggestions.wechatRepostQuery },
  { title: t.chat.suggestions.xiaohongshuRepost, subtitle: t.chat.suggestions.xiaohongshuRepostSub, icon: XiaohongshuIcon, color: "#FF2442", query: t.chat.suggestions.xiaohongshuRepostQuery },
  { title: t.chat.suggestions.xBoost, subtitle: t.chat.suggestions.xBoostSub, icon: Zap, color: "#f0b90b", query: t.chat.suggestions.xBoostQuery },
  { title: t.chat.suggestions.autoReply, subtitle: t.chat.suggestions.autoReplySub, icon: ReplyIcon, color: "#536471", query: t.chat.suggestions.autoReplyQuery },
];

// Add custom style for faster loading ball and shimmer effect
// Add custom style for faster loading ball
const loadingStyle = `
  .loading-ball > span,
  .loading-ball::after,
  .loading-ball::before {
    animation-duration: 0.5s !important;
  }

  @keyframes shimmer {
    0% {
      background-position: 200% 0;
    }
    100% {
      background-position: -200% 0;
    }
  }

  .text-shimmer {
    background: linear-gradient(
      90deg,
      var(--text-secondary) 0%,
      var(--text-secondary) 40%,
      #f0b90b 50%,
      var(--text-secondary) 60%,
      var(--text-secondary) 100%
    );
    background-size: 200% auto;
    color: transparent;
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
    animation: shimmer 3s linear infinite;
    white-space: nowrap;
  }
`;

// Component for displaying the thinking/reasoning section
const ThinkingSection: React.FC<{
  reasoning: string;
  isExpanded: boolean;
  onToggle: () => void;
  isStreaming?: boolean;
  thoughtProcessLabel?: string;
}> = ({ reasoning, isExpanded, onToggle, isStreaming, thoughtProcessLabel = 'Thought Process' }) => {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const scrollRef = useRef<HTMLDivElement>(null);
  const wasStreamingRef = useRef(isStreaming);

  // Auto-scroll to bottom when streaming and content changes
  useEffect(() => {
    if (isStreaming && isExpanded && scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: 'smooth'
      });
    }
  }, [reasoning, isStreaming, isExpanded]);

  // Auto-collapse when streaming ends
  useEffect(() => {
    // If was streaming and now stopped, and is currently expanded, collapse it
    if (wasStreamingRef.current && !isStreaming && isExpanded) {
      onToggle();
    }
    wasStreamingRef.current = isStreaming;
  }, [isStreaming, isExpanded, onToggle]);

  if (!reasoning && !isStreaming) return null;

  // Parse reasoning to extract sections (bold headers)
  // Parse reasoning to extract sections (bold headers)
  const parseReasoning = (text: string) => {
    const sections: { title: string; content: string }[] = [];
    // Strict header regex: Must be at start of line/string, no newlines in title, and followed by a newline
    const headerRegex = /(?:^|\n)\*\*([^\n*]+)\*\*(?:\s*\n)/g;

    let match;
    let lastIndex = 0;
    let currentTitle = '';

    while ((match = headerRegex.exec(text)) !== null) {
      // Content for the previous section (or preamble)
      const content = text.slice(lastIndex, match.index).trim();

      if (currentTitle || content) {
        sections.push({
          title: currentTitle,
          content
        });
      }

      currentTitle = match[1].trim();
      lastIndex = match.index + match[0].length;
    }

    // Add final section
    const finalContent = text.slice(lastIndex).trim();
    if (currentTitle || finalContent) {
      sections.push({
        title: currentTitle,
        content: finalContent
      });
    }

    return sections.length > 0 ? sections : [{ title: '', content: text }];
  };

  const sections = parseReasoning(reasoning);

  // Get the last section title for collapsed state
  const lastTitle = sections.length > 0 ? sections[sections.length - 1].title : '';

  const contentGradient = isDark
    ? '#0a0a0a'
    : 'linear-gradient(to bottom right, rgb(255, 255, 255), rgba(240, 185, 11, 0.05))';

  const borderColor = isDark
    ? 'rgba(240, 185, 11, 0.25)'
    : 'rgba(240, 185, 11, 0.2)';

  // Check if there's actual reasoning content (not empty or just whitespace)
  const hasContent = reasoning && reasoning.trim().length > 0;

  return (
    <div className="flex flex-col justify-center">
      <button
        onClick={hasContent ? onToggle : undefined}
        className={`relative inline-flex items-center rounded-lg text-xs text-[var(--text-secondary)] transition-all duration-300 py-0 ${hasContent ? 'cursor-pointer' : 'cursor-default'}`}
      >
        <style>{loadingStyle}</style>

        {/* Loading icon - always render for consistent height, width 0 when not streaming */}
        <span
          className={`loading loading-ball loading-sm text-[#f0b90b] transition-all duration-300 ${isStreaming ? 'w-5 opacity-100 -ml-2' : 'w-0 mr-0 opacity-0'}`}
          style={{ animationDuration: '0.6s' }}
        ></span>

        <span className={`text-xs flex items-center transition-all duration-300 ${isStreaming ? 'text-shimmer ml-0.5' : 'text-[var(--text-secondary)]'}`}>
          {isStreaming ? (lastTitle ? `${lastTitle}...` : 'BNBot is thinking...') : thoughtProcessLabel}
        </span>

        {/* Arrow always takes space, but invisible when streaming with no content */}
        <span className={`transition-opacity ${isStreaming && !lastTitle ? 'opacity-0' : 'opacity-100'}`}>
          {isExpanded ? <ChevronDown size={14} strokeWidth={1.5} className="text-[var(--text-secondary)]" /> : <ChevronRight size={14} strokeWidth={1.5} className="text-[var(--text-secondary)]" />}
        </span>
      </button>

      {/* Content box - only show when has actual content */}
      {hasContent && (
        <div
          className={`grid transition-all duration-300 ease-in-out ${isExpanded ? 'grid-rows-[1fr] opacity-100 mb-1' : 'grid-rows-[0fr] opacity-0 mb-0'}`}
        >
          <div className="overflow-hidden min-h-0">
            <div
              className="rounded-xl pt-2 pb-1.5 px-3 shadow-sm mt-0.5"
              style={{
                background: contentGradient,
                border: `1px solid ${borderColor}`
              }}
            >
              <div ref={scrollRef} className="overflow-y-auto text-xs leading-tight scroll-smooth" style={{ maxHeight: '130px' }}>
                {sections.map((section, idx) => (
                  <div key={idx} className={idx > 0 ? 'mt-3' : ''}>
                    {section.title && (
                      <div className="font-semibold text-[var(--text-primary)] mb-1 text-xs">{section.title}</div>
                    )}
                    <div className="text-[var(--text-secondary)] leading-[1.5] chat-markdown-content">
                      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} rehypePlugins={[rehypeRaw]}>
                        {section.content}
                      </ReactMarkdown>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div >
  );
};

// Message actions (copy, regenerate)
const MessageActions: React.FC<{
  text: string;
  onRegenerate?: () => void;
  disableRegenerate?: boolean;
}> = ({ text, onRegenerate, disableRegenerate }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex items-center gap-0.5 mt-0.5">
      <button
        onClick={handleCopy}
        className="p-1 rounded-lg hover:bg-[var(--hover-bg)] transition-all duration-200 text-[var(--text-secondary)] hover:text-[var(--text-primary)] active:scale-95 cursor-pointer"
        title={copied ? "Copied!" : "Copy"}
      >
        {copied ? (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
        ) : (
          <Copy size={12} />
        )}
      </button>
      {onRegenerate && (
        <button
          onClick={onRegenerate}
          disabled={disableRegenerate}
          className={`p-1 rounded-lg transition-all duration-200 ${disableRegenerate ? 'text-[var(--text-secondary)] opacity-40 cursor-not-allowed' : 'hover:bg-[var(--hover-bg)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] active:scale-95 cursor-pointer'}`}
          title="Regenerate"
        >
          <RefreshCw size={12} />
        </button>
      )}
    </div>
  );
};

// Scraped Tweet Interface
interface ScrapedTweet {
  name: string;
  handle: string;
  avatar: string;
  time: string;
  content: string;
  image?: string;
  verified: boolean;
}

// Helper to fetch media as Blob, with base64 support and canvas fallback
const fetchMediaBlob = async (url: string): Promise<Blob> => {
  // 1. Handle base64
  if (url.startsWith('data:')) {
    const parts = url.split(',');
    if (parts.length !== 2) throw new Error('Invalid data URL');
    const mimeMatch = parts[0].match(/data:([^;]+)/);
    const mime = mimeMatch ? mimeMatch[1] : 'image/png';
    const byteString = atob(parts[1]);
    const ab = new ArrayBuffer(byteString.length);
    const ia = new Uint8Array(ab);
    for (let i = 0; i < byteString.length; i++) {
      ia[i] = byteString.charCodeAt(i);
    }
    return new Blob([ab], { type: mime });
  }

  // 2. Handle blob URLs (already local)
  if (url.startsWith('blob:')) {
    const response = await fetch(url);
    return await response.blob();
  }

  // 3. TikTok videos - use port-based download (CORS bypass)
  if (url.includes('tiktok') || url.includes('tiktokcdn')) {
    console.log('[fetchMediaBlob] Fetching TikTok video via background port:', url.substring(0, 80) + '...');
    return new Promise((resolve, reject) => {
      const port = chrome.runtime.connect({ name: 'DOWNLOAD_PORT' });
      const chunks: Uint8Array[] = [];

      port.onMessage.addListener((msg: any) => {
        switch (msg.type) {
          case 'DOWNLOAD_START':
            console.log('[fetchMediaBlob] TikTok download started, size:', msg.total);
            break;
          case 'DOWNLOAD_CHUNK':
            chunks.push(new Uint8Array(msg.chunk));
            break;
          case 'DOWNLOAD_END':
            console.log('[fetchMediaBlob] TikTok download complete');
            const blob = new Blob(chunks, { type: 'video/mp4' });
            port.disconnect();
            resolve(blob);
            break;
          case 'DOWNLOAD_ERROR':
            console.error('[fetchMediaBlob] TikTok download error:', msg.error);
            port.disconnect();
            reject(new Error(msg.error));
            break;
        }
      });

      port.onDisconnect.addListener(() => {
        if (chunks.length === 0) {
          reject(new Error('Port disconnected without data'));
        }
      });

      port.postMessage({ type: 'START_DOWNLOAD', url });
    });
  }

  // 3.5. Xiaohongshu media - use port-based download (CORS bypass, HTTP blocked on HTTPS)
  if (url.includes('xhscdn') || url.includes('xiaohongshu')) {
    console.log('[fetchMediaBlob] Fetching Xiaohongshu media via background port:', url.substring(0, 80) + '...');
    const rawBlob = await new Promise<Blob>((resolve, reject) => {
      const port = chrome.runtime.connect({ name: 'DOWNLOAD_PORT' });
      const chunks: Uint8Array[] = [];
      let contentType = '';

      port.onMessage.addListener((msg: any) => {
        switch (msg.type) {
          case 'DOWNLOAD_START':
            console.log('[fetchMediaBlob] Xiaohongshu download started, size:', msg.total);
            contentType = msg.contentType || '';
            break;
          case 'DOWNLOAD_CHUNK':
            chunks.push(new Uint8Array(msg.chunk));
            break;
          case 'DOWNLOAD_END':
            console.log('[fetchMediaBlob] Xiaohongshu download complete');
            // Detect MIME type from content-type header, URL, or default
            let mime = contentType || 'application/octet-stream';
            if (url.includes('_webp') || mime.includes('webp')) {
              mime = 'image/webp';
            } else if (url.endsWith('.jpg') || url.endsWith('.jpeg') || mime.includes('jpeg')) {
              mime = 'image/jpeg';
            } else if (url.endsWith('.png') || mime.includes('png')) {
              mime = 'image/png';
            } else if (url.includes('/video/') || url.endsWith('.mp4') || mime.includes('video')) {
              mime = 'video/mp4';
            } else if (!mime.startsWith('image/') && !mime.startsWith('video/')) {
              // Default to image/jpeg for xhscdn if no clear type
              mime = 'image/jpeg';
            }
            const blob = new Blob(chunks, { type: mime });
            port.disconnect();
            resolve(blob);
            break;
          case 'DOWNLOAD_ERROR':
            console.error('[fetchMediaBlob] Xiaohongshu download error:', msg.error);
            port.disconnect();
            reject(new Error(msg.error));
            break;
        }
      });

      port.onDisconnect.addListener(() => {
        if (chunks.length === 0) {
          reject(new Error('Port disconnected without data'));
        }
      });

      port.postMessage({ type: 'START_DOWNLOAD', url });
    });

    // Convert webp to PNG since Twitter doesn't support webp uploads
    if (rawBlob.type === 'image/webp') {
      console.log('[fetchMediaBlob] Converting webp to PNG for Twitter compatibility');
      try {
        const bitmap = await createImageBitmap(rawBlob);
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(bitmap, 0, 0);
        const pngBlob = await canvas.convertToBlob({ type: 'image/png' });
        bitmap.close();
        return pngBlob;
      } catch (convertErr) {
        console.warn('[fetchMediaBlob] Webp conversion failed, using original:', convertErr);
      }
    }

    return rawBlob;
  }

  // 4. Check if URL needs proxy (external video URLs like googlevideo)
  const needsProxy = url.includes('googlevideo.com') || url.includes('videoplayback');

  if (needsProxy) {
    console.log('Fetching video via background proxy:', url.substring(0, 80) + '...');
    const response = await new Promise<{ blobUrl?: string; error?: string }>((resolve) => {
      chrome.runtime.sendMessage({ type: 'FETCH_VIDEO', url }, resolve);
    });

    if (response.error || !response.blobUrl) {
      throw new Error(response.error || 'Video proxy failed');
    }

    // Convert data URL back to Blob
    const parts = response.blobUrl.split(',');
    if (parts.length !== 2) throw new Error('Invalid data URL from proxy');
    const mimeMatch = parts[0].match(/data:([^;]+)/);
    const mime = mimeMatch ? mimeMatch[1] : 'video/mp4';
    const byteString = atob(parts[1]);
    const ab = new ArrayBuffer(byteString.length);
    const ia = new Uint8Array(ab);
    for (let i = 0; i < byteString.length; i++) {
      ia[i] = byteString.charCodeAt(i);
    }
    return new Blob([ab], { type: mime });
  }

  // 3. Try Direct Fetch
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);
    return await response.blob();
  } catch (fetchErr) {
    console.warn('Direct fetch failed, trying canvas fallback for:', url);

    // 4. Canvas Fallback (Only works for images)
    if (url.endsWith('.mp4') || url.includes('video')) {
      throw fetchErr;
    }

    return new Promise((resolve, reject) => {
      const img = new window.Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('Canvas context failed'));
        ctx.drawImage(img, 0, 0);
        canvas.toBlob((blob) => {
          if (blob) resolve(blob);
          else reject(new Error('Canvas toBlob failed'));
        }, 'image/png');
      };
      img.onerror = () => reject(new Error('Image canvas load failed'));
      img.src = url;
    });
  }
};

const handleCopyImage = async (src: string) => {
  if (!src) return false;
  try {
    let blob: Blob | null = null;
    try {
      blob = await fetchMediaBlob(src);
    } catch (e) {
      console.warn('Direct media fetch failed, trying proxy...', e);
    }

    // If direct fetch failed, try fetching via background script (proxy)
    if (!blob) {
      try {
        console.log('Fetching image via background proxy:', src);
        const response = await new Promise<{ blobUrl?: string; error?: string }>((resolve) => {
          chrome.runtime.sendMessage({ type: 'FETCH_VIDEO', url: src }, resolve);
        });

        if (response.error || !response.blobUrl) {
          throw new Error(response.error || 'Image proxy failed');
        }

        // Convert data URL back to Blob
        const parts = response.blobUrl.split(',');
        if (parts.length === 2) {
          const mimeMatch = parts[0].match(/data:([^;]+)/);
          const mime = mimeMatch ? mimeMatch[1] : 'image/png';
          const byteString = atob(parts[1]);
          const ab = new ArrayBuffer(byteString.length);
          const ia = new Uint8Array(ab);
          for (let i = 0; i < byteString.length; i++) {
            ia[i] = byteString.charCodeAt(i);
          }
          blob = new Blob([ab], { type: mime });
        }
      } catch (proxyErr) {
        console.error('Proxy fetch failed:', proxyErr);
      }
    }

    if (!blob) {
      console.error('Failed to create blob from image source');
      return false;
    }

    // Clipboard API restricts image types to image/png. Convert if necessary.
    if (blob.type !== 'image/png') {
      console.log(`Converting ${blob.type} to image/png for clipboard...`);
      const imageBitmap = await createImageBitmap(blob);
      const canvas = document.createElement('canvas');
      canvas.width = imageBitmap.width;
      canvas.height = imageBitmap.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas context failed');
      ctx.drawImage(imageBitmap, 0, 0);

      const pngBlob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
      if (!pngBlob) throw new Error('PNG conversion failed');
      blob = pngBlob;
    }

    const item = new ClipboardItem({ [blob.type]: blob });
    await navigator.clipboard.write([item]);
    return true;
  } catch (error) {
    console.error('Failed to copy image:', error);
    return false;
  }
};

const CopyButtonOverlay: React.FC<{ src: string }> = ({ src }) => {
  const [copied, setCopied] = useState(false);

  const onCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault(); // Prevent default behavior
    const success = await handleCopyImage(src);
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <button
      onClick={onCopy}
      className={`absolute top-2 right-2 px-2 py-1.5 rounded-full bg-black/60 hover:bg-black/80 text-white transition-all cursor-pointer z-[100] flex items-center justify-center border border-white/10 gap-1.5 ${copied ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
        }`}
      title="Copy image"
    >
      {copied ? (
        <>
          <Check size={14} className="text-green-500" />
          <span className="text-xs font-medium text-green-500">Copied</span>
        </>
      ) : (
        <Copy size={14} />
      )}
    </button>
  );
};

// Video thumbnail component with inline playback
const VideoThumbnail: React.FC<{
  videoUrl: string;
  thumbnailUrl?: string;
  source?: string;
  originalUrl?: string;
  onDelete?: () => void;
  isVertical?: boolean; // For 9:16 videos, display as square
}> = ({ videoUrl, thumbnailUrl, source, originalUrl, onDelete, isVertical }) => {
  const [isLoading, setIsLoading] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [proxiedUrl, setProxiedUrl] = useState<string | null>(null);
  const [proxiedThumbnail, setProxiedThumbnail] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Check if URL needs proxying (external URLs like googlevideo, TikTok, or Xiaohongshu)
  const isTikTokVideo = source === 'tiktok' ||
    videoUrl?.includes('tiktok') ||
    videoUrl?.includes('tiktokcdn');
  const isXiaohongshuVideo = source === 'xiaohongshu' ||
    videoUrl?.includes('xhscdn') ||
    videoUrl?.includes('xiaohongshu');
  const needsProxy = videoUrl?.includes('googlevideo.com') ||
    videoUrl?.includes('videoplayback') ||
    isTikTokVideo ||
    isXiaohongshuVideo;

  // Check if thumbnail needs proxying (xiaohongshu images have CORS issues)
  const thumbnailNeedsProxy = thumbnailUrl && (
    thumbnailUrl.includes('xhscdn') ||
    thumbnailUrl.includes('xiaohongshu')
  );

  // Proxy thumbnail for xiaohongshu
  useEffect(() => {
    if (!thumbnailNeedsProxy || !thumbnailUrl || proxiedThumbnail) return;

    console.log('[VideoThumbnail] Proxying thumbnail:', thumbnailUrl.substring(0, 60));
    chrome.runtime.sendMessage({ type: 'FETCH_BLOB', url: thumbnailUrl }, (response: any) => {
      if (response?.success && response?.data) {
        setProxiedThumbnail(response.data);
        console.log('[VideoThumbnail] Thumbnail proxied successfully');
      } else {
        console.error('[VideoThumbnail] Failed to proxy thumbnail:', response?.error);
      }
    });
  }, [thumbnailUrl, thumbnailNeedsProxy]);

  // Use proxied thumbnail or original
  const effectiveThumbnail = proxiedThumbnail || (thumbnailNeedsProxy ? '' : thumbnailUrl) || '';

  // Auto-download TikTok videos on mount
  useEffect(() => {
    if (!needsProxy || !videoUrl || proxiedUrl || isLoading) return;

    setIsLoading(true);
    setDownloadProgress(0);

    if (isTikTokVideo || isXiaohongshuVideo) {
      console.log('[VideoThumbnail] Auto-starting video download:', videoUrl?.substring(0, 80));
      const port = chrome.runtime.connect({ name: 'DOWNLOAD_PORT' });
      const chunks: Uint8Array[] = [];
      let totalSize = 0;
      let loadedSize = 0;

      port.onMessage.addListener((msg: any) => {
        switch (msg.type) {
          case 'DOWNLOAD_START':
            totalSize = msg.total || 0;
            console.log('[VideoThumbnail] Download started, size:', totalSize);
            break;
          case 'DOWNLOAD_CHUNK':
            const chunk = new Uint8Array(msg.chunk);
            chunks.push(chunk);
            loadedSize += chunk.length;
            if (totalSize > 0) {
              setDownloadProgress(Math.round((loadedSize / totalSize) * 100));
            }
            break;
          case 'DOWNLOAD_END':
            console.log('[VideoThumbnail] Download complete, creating blob');
            try {
              const blob = new Blob(chunks, { type: 'video/mp4' });
              const blobUrl = URL.createObjectURL(blob);
              setProxiedUrl(blobUrl);
              setIsLoading(false);
            } catch (e) {
              console.error('Failed to create blob:', e);
              setHasError(true);
              setIsLoading(false);
            }
            port.disconnect();
            break;
          case 'DOWNLOAD_ERROR':
            console.error('Download error:', msg.error);
            setHasError(true);
            setIsLoading(false);
            port.disconnect();
            break;
        }
      });

      port.onDisconnect.addListener(() => {
        if (chunks.length === 0 && !proxiedUrl) {
          console.error('[VideoThumbnail] Port disconnected without data');
          setHasError(true);
          setIsLoading(false);
        }
      });

      port.postMessage({ type: 'START_DOWNLOAD', url: videoUrl });
    } else {
      // Use simple fetch for other videos (googlevideo etc)
      chrome.runtime.sendMessage({ type: 'FETCH_VIDEO', url: videoUrl }, (response: any) => {
        if (response?.error || !response?.blobUrl) {
          console.error('Video proxy failed:', response?.error);
          setHasError(true);
          setIsLoading(false);
          return;
        }
        setProxiedUrl(response.blobUrl);
        setIsLoading(false);
      });
    }

    // Cleanup
    return () => {
      if (proxiedUrl && proxiedUrl.startsWith('blob:')) {
        URL.revokeObjectURL(proxiedUrl);
      }
    };
  }, [videoUrl, needsProxy, isTikTokVideo]);

  const handleVideoError = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    console.error('Video load error:', e);
    setHasError(true);
  };

  // Determine which URL to use for video playback
  const playbackUrl = proxiedUrl || (needsProxy ? '' : videoUrl);

  // Square container style for vertical videos (9:16)
  const containerStyle: React.CSSProperties = isVertical
    ? { width: '280px', height: '280px', margin: '0 auto' }  // Square for vertical videos, centered
    : { width: '100%', maxHeight: '300px' };

  return (
    <div className="relative group bg-black rounded-xl overflow-hidden" style={containerStyle}>
      {isLoading ? (
        // Loading state while fetching video
        <div className="relative w-full h-full">
          <img
            src={effectiveThumbnail}
            alt="Video"
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/40">
            <div className="w-12 h-12 rounded-full border-3 border-white/30 border-t-white animate-spin mb-2"></div>
            {downloadProgress > 0 && (
              <span className="text-white text-sm">{downloadProgress}%</span>
            )}
          </div>
        </div>
      ) : hasError ? (
        // Error state - show thumbnail with error message
        <div className="relative w-full h-full">
          <img
            src={effectiveThumbnail}
            alt="Video"
            className="w-full h-full object-cover opacity-50"
          />
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/40">
            <p className="text-white text-sm mb-2">视频无法播放</p>
            <button
              onClick={(e) => {
                e.stopPropagation();
                window.open(originalUrl || videoUrl, '_blank');
              }}
              className="px-3 py-1.5 bg-white/90 text-black text-xs rounded-full hover:bg-white transition-colors cursor-pointer"
            >
              在新标签页打开
            </button>
          </div>
        </div>
      ) : playbackUrl ? (
        // Video ready - show thumbnail with play button, click to play
        isPlaying ? (
          <video
            ref={videoRef}
            src={playbackUrl}
            poster={effectiveThumbnail}
            controls
            autoPlay
            className="w-full h-full object-contain bg-black"
            onError={handleVideoError}
            onEnded={() => setIsPlaying(false)}
          />
        ) : (
          <div
            className="relative w-full h-full cursor-pointer"
            onClick={() => setIsPlaying(true)}
          >
            {effectiveThumbnail ? (
              <>
                <img
                  src={effectiveThumbnail}
                  alt="Video"
                  className="w-full h-full object-cover"
                />
                {/* Play button overlay */}
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-16 h-16 rounded-full bg-black/60 flex items-center justify-center hover:bg-black/80 transition-colors">
                    <svg viewBox="0 0 24 24" className="w-8 h-8 text-white ml-1" fill="currentColor">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  </div>
                </div>
              </>
            ) : (
              <video
                src={playbackUrl}
                controls
                className="w-full h-full object-contain bg-black"
                onError={handleVideoError}
              />
            )}
          </div>
        )
      ) : (
        // Thumbnail while waiting
        <div className="relative w-full h-full">
          <img
            src={effectiveThumbnail}
            alt="Video"
            className="w-full h-full object-cover"
          />
        </div>
      )}
      {/* Delete button - only show when video is playing */}
      {onDelete && isPlaying && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="absolute top-2 right-2 p-1.5 rounded-full backdrop-blur-md shadow-sm transition-all bg-black/60 text-white hover:bg-black/80 opacity-0 group-hover:opacity-100 cursor-pointer z-10"
          title="Remove video"
        >
          <Trash2 size={14} strokeWidth={2.5} />
        </button>
      )}
    </div>
  );
};

// Helper function to parse tweet content and highlight $TOKEN, #hashtag, @mention
const parseTweetContent = (text: string): React.ReactNode[] => {
  const result: React.ReactNode[] = [];
  // Pattern to match $TOKEN, #hashtag, @mention
  const pattern = /(\$[A-Za-z][A-Za-z0-9]*|#[A-Za-z0-9_]+|@[A-Za-z0-9_]+)/g;

  let lastIndex = 0;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    // Add text before the match
    if (match.index > lastIndex) {
      result.push(text.slice(lastIndex, match.index));
    }

    // Add the highlighted match
    result.push(
      <span key={match.index} style={{ color: 'rgb(29, 155, 240)' }}>
        {match[0]}
      </span>
    );

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    result.push(text.slice(lastIndex));
  }

  return result;
};

// Helper function to get current user info from xUserStore
const getCurrentUserInfo = (): { name: string; handle: string; avatar: string; verified: boolean } | null => {
  try {
    const userInfo = xUserStore.getUserInfo();
    if (!userInfo.username) return null;

    return {
      name: userInfo.displayName || userInfo.username || 'User',
      handle: `@${userInfo.username}`,
      avatar: userInfo.avatarUrl || '',
      verified: userInfo.isBlueVerified || false
    };
  } catch (e) {
    console.error('Failed to get user info from xUserStore', e);
    return null;
  }
};

// Tweet Draft Card Component
const TweetDraftCard: React.FC<{
  draft: TweetDraft;
  contextTweetId?: string;
  quotedTweet?: ScrapedTweet | null;
  onStayOnPage?: () => void;
  srtContent?: string;
}> = ({ draft, contextTweetId, quotedTweet, onStayOnPage, srtContent }) => {
  const { t } = useLanguage();

  // Debug: log draft to check if media field is present
  // Debug logging disabled to reduce console noise
  // console.log('[TweetDraftCard] draft:', draft);
  // console.log('[TweetDraftCard] draft.media:', draft.media);
  // console.log('[TweetDraftCard] draft.original_media:', draft.original_media);
  // console.log('[TweetDraftCard] srtContent available:', !!srtContent, srtContent?.length);
  // if (srtContent) console.log('[TweetDraftCard] srtContent data:', srtContent);

  // State for auto-post toggle, default false
  const [autoPost, setAutoPost] = useState(false);
  const [copied, setCopied] = useState(false);
  const [userInfo, setUserInfo] = useState<{ name: string; handle: string; avatar: string; verified: boolean } | null>(null);
  const [generatingImage, setGeneratingImage] = useState(false);
  const [generatedImageUrl, setGeneratedImageUrl] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const isDark = document.documentElement.classList.contains('dark');
  // Manual trigger for image generation UI
  const [showImageGenerator, setShowImageGenerator] = useState(false);
  const [isUploadingMedia, setIsUploadingMedia] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [isUploadingSubtitles, setIsUploadingSubtitles] = useState(false);
  const [isVideoUpload, setIsVideoUpload] = useState(false); // Track if uploading video (show progress) vs image (no progress)

  // Editable tweet content
  const [editableContent, setEditableContent] = useState(draft.content);
  const [isEditingContent, setIsEditingContent] = useState(false);
  const contentTextareaRef = useRef<HTMLTextAreaElement>(null);

  // Local state for media, allowing edits
  const [mediaItems, setMediaItems] = useState<Array<{ type: 'photo' | 'video'; media_url: string; video_url?: string; audio_url?: string; thumbnail?: string; thumbnail_url?: string; youtube_url?: string; isMerged?: boolean; isVertical?: boolean; source?: string }>>(() => {
    // Transform original_media from API format to component format
    const items: any[] = [...transformOriginalMedia(draft.original_media || [])];
    // Handle new media object format from backend
    if (draft.media) {
      // Detect vertical video: use width/height if available, or default to true for xiaohongshu (typically 9:16)
      const isVertical = (draft.media.width && draft.media.height && draft.media.height > draft.media.width)
        || (draft.media.source === 'xiaohongshu'); // Xiaohongshu videos are typically vertical
      items.push({
        type: draft.media.type === 'video' ? 'video' : 'photo',
        media_url: draft.media.url || '',
        video_url: draft.media.video_url || (draft.media.type === 'video' ? draft.media.url : undefined),
        audio_url: draft.media.audio_url,
        thumbnail: draft.media.thumbnail,
        thumbnail_url: draft.media.thumbnail,
        youtube_url: draft.media.youtube_url,
        isMerged: !!draft.media.url && !draft.media.audio_url, // If we have url but no split audio, it's already "merged" or simple video
        source: draft.media.source,
        isVertical: isVertical
      });
    }
    return items;
  });

  useEffect(() => {
    // Sync media items if draft changes (e.g. initial load)
    // Debug logging disabled to reduce console noise
    // console.log('[TweetDraftCard] Syncing media. Draft:', draft);
    // console.log('[TweetDraftCard] Media:', draft.media);

    // Transform original_media from API format to component format
    const expectedItems: any[] = [...transformOriginalMedia(draft.original_media || [])];
    // Handle new media object format from backend
    if (draft.media) {
      // Detect vertical video: use width/height if available, or default to true for xiaohongshu (typically 9:16)
      const isVertical = (draft.media.width && draft.media.height && draft.media.height > draft.media.width)
        || (draft.media.source === 'xiaohongshu'); // Xiaohongshu videos are typically vertical
      expectedItems.push({
        type: draft.media.type === 'video' ? 'video' : 'photo',
        media_url: draft.media.url || '',
        video_url: draft.media.video_url || (draft.media.type === 'video' ? draft.media.url : undefined),
        audio_url: draft.media.audio_url,
        thumbnail: draft.media.thumbnail,
        thumbnail_url: draft.media.thumbnail,
        youtube_url: draft.media.youtube_url,
        isMerged: !!draft.media.url && !draft.media.audio_url,
        source: draft.media.source,
        isVertical: isVertical
      });
    }

    if (expectedItems.length > 0) {
      if (mediaItems.length === 0) {
        setMediaItems(expectedItems);
        console.log('[TweetDraftCard] Initialized mediaItems:', expectedItems);
      } else {
        // Smart sync: check if we need to update, but preserve "merged" state if underlying source hasn't changed
        const shouldUpdate = expectedItems.length !== mediaItems.length || expectedItems.some((expected, i) => {
          const current = mediaItems[i];
          if (!current) return true;

          // If currently merged, only update if the SOURCE urls changed
          if (current.isMerged) {
            const sourceChanged = expected.video_url !== current.video_url || expected.audio_url !== current.audio_url;
            if (!sourceChanged) return false; // Keep current (merged)
          }

          // Otherwise standard check
          return expected.media_url !== current.media_url || expected.audio_url !== current.audio_url;
        });

        if (shouldUpdate) {
          // When updating, try to preserve merged items if they match
          const newItems = expectedItems.map((expected, i) => {
            const current = mediaItems[i];
            if (current && current.isMerged && current.video_url === expected.video_url && current.audio_url === expected.audio_url) {
              return current; // Preserve local merged state
            }
            return expected;
          });

          // Double check if we actually need to set state (deep compare simplified)
          const actuallyChanged = newItems.some((n, i) => {
            const c = mediaItems[i];
            return !c || n.media_url !== c.media_url || n.isMerged !== c.isMerged;
          });

          if (actuallyChanged) {
            console.log('[TweetDraftCard] Updating mediaItems (smart sync):', newItems);
            setMediaItems(newItems);
          }
        }
      }
    }
  }, [draft.original_media, draft.media]);



  const handleMediaUpdate = (index: number, newSrc: string) => {
    const newItems = [...mediaItems];
    newItems[index] = { ...newItems[index], media_url: newSrc };
    setMediaItems(newItems);
  };

  const handleMediaDelete = (index: number) => {
    const newItems = [...mediaItems];
    newItems.splice(index, 1);
    setMediaItems(newItems);
    // If all original media is gone, force update generatedImageUrl if potentially needed logic here
  };

  // Editable Prompt State
  const [editablePrompt, setEditablePrompt] = useState(draft.image_suggestion?.image_prompt || draft.image_suggestion?.description || '');
  const [isEditingPrompt, setIsEditingPrompt] = useState(false);
  const [useProModel, setUseProModel] = useState(false);
  const [isOptimizingPrompt, setIsOptimizingPrompt] = useState(false);

  // Get current user info on mount
  useEffect(() => {
    const info = getCurrentUserInfo();
    setUserInfo(info);
  }, []);

  // Optimize prompt using backend API
  const handleOptimizePrompt = async () => {
    if (!editablePrompt || isOptimizingPrompt) return;

    setIsOptimizingPrompt(true);
    try {
      const response = await authService.fetchWithAuth('http://localhost:8000/api/v1/ai/optimize-prompt', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt: editablePrompt,
          context: editableContent,
          language: 'en', // Image prompts should be in English
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || 'Failed to optimize prompt');
      }

      const data = await response.json();
      if (data.optimized_prompt) {
        setEditablePrompt(data.optimized_prompt);
      }
    } catch (error) {
      console.error('Failed to optimize prompt:', error);
    } finally {
      setIsOptimizingPrompt(false);
    }
  };

  // Generate image from prompt
  const handleGenerateImage = async () => {
    if (!editablePrompt) return;

    setGeneratingImage(true);
    setImageError(null);

    try {
      const formData = new FormData();
      formData.append('prompt', editablePrompt);
      formData.append('model', useProModel ? 'nano-banana-pro' : 'nano-banana');

      if (generatedImageUrl) {
        try {
          const blob = await fetchMediaBlob(generatedImageUrl);
          formData.append('image', blob, 'init_image.png');
        } catch (e) {
          console.error('Failed to attach init image', e);
        }
      }

      const response = await authService.fetchWithAuth('http://localhost:8000/api/v1/ai/generate-image', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        // Try to get detailed error message
        let errorMsg = 'Failed to generate image';
        try {
          const errorBody = await response.json();
          if (typeof errorBody.detail === 'string') {
            errorMsg = errorBody.detail;
          } else if (Array.isArray(errorBody.detail) && errorBody.detail.length > 0) {
            // Handle array of errors (e.g. from Pydantic)
            const firstError = errorBody.detail[0];
            errorMsg = typeof firstError === 'string' ? firstError : (firstError.msg || JSON.stringify(firstError));
          } else if (typeof errorBody.detail === 'object') {
            errorMsg = JSON.stringify(errorBody.detail);
          } else if (errorBody.message) {
            errorMsg = errorBody.message;
          }
        } catch {
          // Use status-based messages
          if (response.status === 402) {
            errorMsg = 'Insufficient credits';
          } else if (response.status === 401) {
            errorMsg = 'Please login to generate images';
          }
        }
        setImageError(errorMsg);
        return;
      }

      const result = await response.json();
      if (result.data && result.data[0]) {
        const src = `data:${result.data[0].mime_type};base64,${result.data[0].b64_json}`;
        setGeneratedImageUrl(src);
      } else {
        setImageError('No image data received');
      }
    } catch (error) {
      console.error('Image generation error:', error);
      setImageError('Network error, please try again');
    } finally {
      setGeneratingImage(false);
    }
  };

  const handlePost = () => {
    // Combine content with hashtags for posting
    const contentWithHashtags = draft.hashtags && draft.hashtags.length > 0
      ? `${editableContent}\n\n${draft.hashtags.map(tag => tag.startsWith('#') ? tag : `#${tag}`).join(' ')}`
      : editableContent;

    // Helper function to paste media into composer via file input
    const uploadMediaToComposer = async () => {
      // Determine what to upload
      const mediaItemsToUpload = [];
      if (mediaItems && mediaItems.length > 0) {
        mediaItemsToUpload.push(...mediaItems);
      } else if (generatedImageUrl) {
        mediaItemsToUpload.push({ type: 'photo', media_url: generatedImageUrl });
      }

      if (mediaItemsToUpload.length === 0) return;

      const files: File[] = [];
      for (const item of mediaItemsToUpload) {
        try {
          // For videos, use video_url; for images, use media_url
          const urlToFetch = item.type === 'video'
            ? (item.video_url || item.media_url)
            : item.media_url;

          if (!urlToFetch) {
            console.error('[uploadMediaToComposer] No URL to fetch for item:', item);
            continue;
          }

          console.log('[uploadMediaToComposer] Fetching media:', item.type, urlToFetch.substring(0, 80));
          const blob = await fetchMediaBlob(urlToFetch);
          let type = blob.type;
          // Detect extension
          let ext = 'jpg';
          if (type === 'image/png') ext = 'png';
          else if (type === 'image/webp') ext = 'webp';
          else if (type === 'image/gif') ext = 'gif';
          else if (type === 'video/mp4') ext = 'mp4';
          else if (item.type === 'video') { ext = 'mp4'; type = 'video/mp4'; } // Fallback

          const filename = `media_${Date.now()}_${Math.random().toString(36).substring(7)}.${ext}`;
          files.push(new File([blob], filename, { type }));
        } catch (e) {
          console.error("Failed to load media", item, e);
        }
      }

      if (files.length === 0) return;

      // Find input - check various places
      // 1. Tweet Modal 
      // 2. Inline Reply
      // Try to find the visible one or the one in the active modal
      let fileInput: HTMLInputElement | null = null;
      const modal = document.querySelector('[role="dialog"]');
      if (modal) {
        fileInput = modal.querySelector('input[data-testid="fileInput"]') as HTMLInputElement;
      }

      if (!fileInput) {
        // Fallback to searching all inputs for the one that seems active or just the visible one
        const fileInputs = document.querySelectorAll('input[type="file"]');
        // Heuristic: finding the one that is likely part of the active composer
        // For inline reply, it's usually in the main flow
        fileInput = document.querySelector('input[data-testid="fileInput"]') as HTMLInputElement;
      }

      if (fileInput) {
        const dt = new DataTransfer();
        files.forEach(f => dt.items.add(f));
        fileInput.files = dt.files;
        fileInput.dispatchEvent(new Event('change', { bubbles: true }));
        console.log('Media uploaded via file input', files.length);
      } else {
        console.error('File input not found for media upload');
      }
    };

    // Helper function to upload SRT subtitles after video upload
    const uploadSubtitles = async (srt: string, retryCount = 0): Promise<boolean> => {
      const MAX_RETRIES = 3;

      // Set uploading subtitles state (only on first attempt, not retries)
      if (retryCount === 0) {
        setIsUploadingSubtitles(true);
      }

      console.log(`[TweetDraftCard] ========== SUBTITLE UPLOAD START ==========`);
      console.log(`[TweetDraftCard] Attempt ${retryCount + 1}/${MAX_RETRIES + 1}`);
      console.log(`[TweetDraftCard] SRT Content length: ${srt?.length || 0}`);
      console.log(`[TweetDraftCard] SRT Content preview:\n${srt ? srt.slice(0, 300) : 'None'}`);

      // Debug: List all data-testid elements on the page
      const allTestIds = document.querySelectorAll('[data-testid]');
      const testIdList = Array.from(allTestIds).map(el => el.getAttribute('data-testid')).filter(Boolean);
      console.log(`[TweetDraftCard] All data-testid on page (${testIdList.length}):`, testIdList);

      // Debug: Find elements containing subtitle-related text
      const allElements = document.querySelectorAll('*');
      const subtitleRelatedElements: string[] = [];
      allElements.forEach(el => {
        const text = el.textContent?.toLowerCase() || '';
        if ((text.includes('字幕') || text.includes('subtitle') || text.includes('caption') || text.includes('.srt')) && text.length < 100) {
          subtitleRelatedElements.push(`${el.tagName}: "${el.textContent?.trim().slice(0, 50)}"`);
        }
      });
      console.log(`[TweetDraftCard] Elements with subtitle-related text:`, subtitleRelatedElements.slice(0, 20));

      // Debug: List all file inputs
      const allFileInputs = document.querySelectorAll('input[type="file"]');
      console.log(`[TweetDraftCard] All file inputs (${allFileInputs.length}):`,
        Array.from(allFileInputs).map(inp => ({ accept: (inp as HTMLInputElement).accept, id: inp.id, className: inp.className }))
      );

      // Step 1: Find and click the subtitle upload button
      // Try multiple selectors as Twitter may use different testids
      const subtitleButtonSelectors = [
        '[data-testid="addSubtitlesLabel"]',
        '[data-testid="addCaptionsLabel"]',
        '[data-testid="subtitlesLabel"]',
        '[data-testid="captionsLabel"]',
        '[data-testid="editSubtitles"]',
        '[data-testid="subtitles"]',
        // Fallback: look for button/label containing subtitle-related text
      ];

      let addSubtitlesBtn: HTMLElement | null = null;
      for (const selector of subtitleButtonSelectors) {
        addSubtitlesBtn = document.querySelector(selector) as HTMLElement;
        if (addSubtitlesBtn) {
          console.log(`[TweetDraftCard] Found subtitle button with selector: ${selector}`);
          break;
        }
      }

      // If no button found by testid, try finding by text content
      if (!addSubtitlesBtn) {
        const allLabels = document.querySelectorAll('span, div, label');
        for (const label of allLabels) {
          const text = label.textContent?.toLowerCase() || '';
          if (text.includes('字幕') || text.includes('subtitle') || text.includes('caption') || text.includes('.srt')) {
            // Find clickable parent
            const clickable = label.closest('button, [role="button"], label, div[tabindex]') as HTMLElement;
            if (clickable) {
              addSubtitlesBtn = clickable;
              console.log(`[TweetDraftCard] Found subtitle button by text content: "${label.textContent}"`);
              break;
            }
          }
        }
      }

      if (!addSubtitlesBtn) {
        console.warn('[TweetDraftCard] Subtitle button not found, will retry...');
        if (retryCount < MAX_RETRIES) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          return uploadSubtitles(srt, retryCount + 1);
        }
        // Reset state before returning false
        setIsUploadingSubtitles(false);
        return false;
      }

      addSubtitlesBtn.click();
      console.log('[TweetDraftCard] Clicked subtitle button');

      // Step 2: Wait for subtitle upload modal/panel to appear
      await new Promise(resolve => setTimeout(resolve, 800));

      // Step 3: Find file input in the subtitle modal and upload SRT
      // Try multiple selectors for the file input
      const fileInputSelectors = [
        'input[type="file"][accept*=".srt"]',
        'input[type="file"][accept*="srt"]',
        'input[type="file"][accept*=".vtt"]',
        'input[type="file"][accept*="subtitle"]',
        'input[type="file"][accept*="caption"]',
        // Generic file input that might be for subtitles
        'input[type="file"]',
      ];

      let subtitleFileInput: HTMLInputElement | null = null;
      let attempts = 0;

      while (!subtitleFileInput && attempts < 50) {
        for (const selector of fileInputSelectors) {
          const inputs = document.querySelectorAll(selector);
          // Find the most recently added file input (likely the subtitle one)
          if (inputs.length > 0) {
            // Prefer inputs that specifically accept .srt
            for (const input of inputs) {
              const accept = (input as HTMLInputElement).accept || '';
              if (accept.includes('srt') || accept.includes('vtt') || accept.includes('subtitle')) {
                subtitleFileInput = input as HTMLInputElement;
                console.log(`[TweetDraftCard] Found subtitle file input with accept: ${accept}`);
                break;
              }
            }
            // If no specific subtitle input found, use the last one (most recently added)
            if (!subtitleFileInput && selector === 'input[type="file"]') {
              subtitleFileInput = inputs[inputs.length - 1] as HTMLInputElement;
              console.log(`[TweetDraftCard] Using generic file input as fallback`);
            }
          }
          if (subtitleFileInput) break;
        }
        if (!subtitleFileInput) {
          await new Promise(resolve => setTimeout(resolve, 100));
          attempts++;
        }
      }

      if (!subtitleFileInput) {
        console.warn('[TweetDraftCard] Subtitle file input not found after waiting');
        // Click back to return
        const backBtn = document.querySelector('[data-testid="app-bar-back"]') as HTMLElement;
        if (backBtn) backBtn.click();

        // Retry the whole process
        if (retryCount < MAX_RETRIES) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          return uploadSubtitles(srt, retryCount + 1);
        }
        return false;
      }

      // Normalize line breaks to Unix-style (\n) for consistent SRT format
      const normalizedSrt = srt.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

      // Create SRT file - use simple text/plain type (same as manual upload)
      const srtBlob = new Blob([normalizedSrt], { type: 'text/plain' });
      const srtFile = new File([srtBlob], `subtitles_${Date.now()}.srt`, { type: 'text/plain' });

      const dt = new DataTransfer();
      dt.items.add(srtFile);
      subtitleFileInput.files = dt.files;

      // Dispatch change event (same as manual file selection)
      subtitleFileInput.dispatchEvent(new Event('change', { bubbles: true }));
      console.log('[TweetDraftCard] SRT file uploaded to input');

      // Step 4: Wait for Twitter to process the file
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Debug: List all buttons and clickable elements after file upload
      const allButtons = document.querySelectorAll('button, [role="button"]');
      console.log('[TweetDraftCard] All buttons after file upload:',
        Array.from(allButtons).map(btn => ({
          testId: btn.getAttribute('data-testid'),
          ariaLabel: btn.getAttribute('aria-label'),
          text: btn.textContent?.trim().slice(0, 30)
        })).filter(b => b.testId || b.ariaLabel || b.text)
      );

      // Step 5: Click "Done" button INSIDE the subtitle modal to complete subtitle upload
      // IMPORTANT: Click the "完成" (Done) button, not the back button
      const modal = document.querySelector('[role="dialog"]');
      if (modal) {
        // Find the "Done" button by text content
        const allButtons = modal.querySelectorAll('button[role="button"]');
        let clickedDone = false;

        for (const btn of allButtons) {
          const text = btn.textContent?.trim() || '';
          // Match "完成" (Chinese) or "Done" (English)
          if (text === '完成' || text === 'Done') {
            (btn as HTMLElement).click();
            console.log(`[TweetDraftCard] Clicked Done button in subtitle modal: "${text}"`);
            clickedDone = true;
            break;
          }
        }

        if (!clickedDone) {
          console.log('[TweetDraftCard] No Done button found in modal, subtitle modal may auto-close');
        }
      } else {
        console.log('[TweetDraftCard] No modal found, subtitle upload may have auto-closed');
      }

      console.log('[TweetDraftCard] Subtitle upload completed successfully');

      // Reset uploading subtitles state
      setIsUploadingSubtitles(false);

      return true;
    };

    // Helper function to fill text into composer and optionally auto-post
    const fillComposerText = (textareaSelector: string = '[data-testid="tweetTextarea_0"]', submitButtonSelector: string = '[data-testid="tweetButton"]', shouldUploadMedia: boolean = false) => {
      let attempts = 0;
      const fillText = setInterval(() => {
        attempts++;
        const textarea = document.querySelector(textareaSelector) as HTMLElement;
        if (textarea) {
          clearInterval(fillText);

          setTimeout(async () => {
            textarea.click();
            textarea.focus();

            // Use simulated Paste event to populate DraftJS editor
            try {
              const dataTransfer = new DataTransfer();
              dataTransfer.setData('text/plain', contentWithHashtags);

              const pasteEvent = new ClipboardEvent('paste', {
                bubbles: true,
                cancelable: true,
                clipboardData: dataTransfer
              });

              textarea.dispatchEvent(pasteEvent);
              textarea.dispatchEvent(new Event('input', { bubbles: true }));

              // Scroll the textarea into view if not visible
              textarea.scrollIntoView({ behavior: 'smooth', block: 'center' });

            } catch (err) {
              // Fallback: Safe execCommand if the event generation fails
              document.execCommand('insertText', false, contentWithHashtags);
            }

            // Backup: Copy to clipboard so user can manually paste if automation fails
            navigator.clipboard.writeText(contentWithHashtags).catch(() => { });

            // Upload media if requested and there's actually media to upload
            const hasMediaToUpload = (mediaItems && mediaItems.length > 0) || generatedImageUrl;
            if (shouldUploadMedia && hasMediaToUpload) {
              // Check if we're uploading a video (to show progress) or image (no progress)
              const hasVideoMedia = mediaItems?.some(item => item.type === 'video') || false;
              setIsVideoUpload(hasVideoMedia);
              setIsUploadingMedia(true);
              setUploadProgress(null); // Reset progress
              await new Promise(resolve => setTimeout(resolve, 500));
              await uploadMediaToComposer();

              // Upload subtitles immediately after video is added (don't wait for upload progress)
              if (srtContent && srtContent.trim()) {
                console.log('[TweetDraftCard] Video added, uploading subtitles immediately...');
                // Wait a bit for video upload UI to initialize
                await new Promise(resolve => setTimeout(resolve, 1000));
                uploadSubtitles(srtContent).catch(err => {
                  console.error('[TweetDraftCard] Failed to upload subtitles immediately:', err);
                });
              }

              // Don't hide notification yet - keep visible during video upload phase
              // setIsUploadingMedia(false) will be called when upload is complete
            }

            // Monitor upload progress and auto-post if enabled
            // Always start monitoring loop for progress display
            setTimeout(() => {
              let attempts = 0;
              const maxAttempts = 600; // 60 seconds max wait for video uploads
              let lastProgressTime = Date.now();
              let subtitlesUploaded = false; // Track if subtitles have been uploaded

              const checkInterval = setInterval(async () => {
                const tweetButton = document.querySelector(submitButtonSelector) as HTMLElement;

                // Check if media is still uploading by looking at attachments area
                const attachmentsArea = document.querySelector('[data-testid="attachments"]');
                console.log('[TweetDraftCard] Checking upload progress...', {
                  hasAttachmentsArea: !!attachmentsArea,
                  uploadProgress,
                  subtitlesUploaded
                });
                let isUploading = false;
                let currentPercent: number | null = null;

                if (attachmentsArea) {
                  // Look for upload progress text (e.g., "正在上传 (50%)" or "已上传 (100%)")
                  // Make parens optional and robust to spaces
                  const textContent = attachmentsArea.textContent || '';
                  const percentMatch = textContent.match(/(?:\(|（)?(\d+)%(?:\)|）)?/);

                  if (percentMatch) {
                    currentPercent = parseInt(percentMatch[1], 10);
                    setUploadProgress(currentPercent);
                    lastProgressTime = Date.now();
                    // Still uploading if less than 100%
                    isUploading = currentPercent < 100;
                  }
                }

                // Only proceed if we've confirmed upload is truly complete
                const uploadComplete = currentPercent === 100 ||
                  (currentPercent === null && !isUploading && Date.now() - lastProgressTime > 2000);

                // Ensure subtitles are uploaded if we missed the window or it was too fast
                // Check if we have SRT content, haven't uploaded yet, and upload is effectively done
                if (uploadComplete && srtContent && srtContent.trim() && !subtitlesUploaded) {
                  console.log('[TweetDraftCard] Upload complete but subtitles not yet uploaded. Attempting now...');
                  subtitlesUploaded = true;
                  // We must await this one before clicking tweet
                  await uploadSubtitles(srtContent).catch(err => {
                    console.error('[TweetDraftCard] Failed to upload subtitles (completion check):', err);
                  });
                }

                if (tweetButton && uploadComplete) {
                  const isDisabled = (tweetButton as HTMLButtonElement).disabled || tweetButton.getAttribute('aria-disabled') === 'true';

                  // If button is enabled and upload is complete
                  if (!isDisabled) {
                    clearInterval(checkInterval);
                    setUploadProgress(null);
                    setIsUploadingMedia(false);

                    // Only click if auto-post is enabled
                    if (autoPost) {
                      tweetButton.click();
                    }
                    return;
                  }
                }

                attempts++;
                if (attempts > maxAttempts) {
                  clearInterval(checkInterval);
                  setUploadProgress(null);
                  setIsUploadingMedia(false);
                  console.warn("Timed out waiting for upload to complete");
                  // Try one last click anyway if button exists and autoPost is on
                  if (autoPost && tweetButton) tweetButton.click();
                }
              }, 100); // Check every 100ms
            }, 500); // Initial 500ms wait to ensure upload started
          }, 500);
        } else if (attempts > 50) {
          clearInterval(fillText);
        }
      }, 100);
    };

    // Get the reference tweet ID (first one if available)
    const referenceTweetId = draft.reference_tweet_ids?.[0] || contextTweetId;

    const simulateInteraction = async () => {
      try {
        const action = draft.action || 'post';

        if (action === 'post') {
          // New post: Click the "New Tweet" button in sidebar
          const newTweetButton = document.querySelector('[data-testid="SideNav_NewTweet_Button"]') as HTMLElement;
          if (!newTweetButton) {
            console.error("SideNav_NewTweet_Button not found");
            navigator.clipboard.writeText(contentWithHashtags).catch(() => { });
            return;
          }
          newTweetButton.click();

          await new Promise(resolve => setTimeout(resolve, 500));
          fillComposerText('[data-testid="tweetTextarea_0"]', '[data-testid="tweetButton"]', true);

        } else if (action === 'reply') {
          // Reply: Find the reply box on current page and fill content
          const inlineButtonSelector = '[data-testid="tweetButtonInline"]';

          if (referenceTweetId) {
            // Check if we're already on the tweet page
            const currentUrl = window.location.href;
            const isOnTweetPage = currentUrl.includes(`/status/${referenceTweetId}`) || currentUrl.includes('/status/');

            if (!isOnTweetPage) {
              // Navigate to the tweet first (SPA navigation, no page reload)
              const tweetUrl = `/i/status/${referenceTweetId}`;
              navigateToUrl(tweetUrl);
              return; // User will need to click again after navigation
            }

            // On tweet page: Click the reply label to activate the input
            const replyLabel = document.querySelector('[data-testid="tweetTextarea_0_label"]') as HTMLElement;
            if (replyLabel) {
              replyLabel.click();
              await new Promise(resolve => setTimeout(resolve, 300));
              fillComposerText('[data-testid="tweetTextarea_0"]', inlineButtonSelector, true);
            } else {
              // Fallback: Click the reply button on the main tweet
              const articles = document.querySelectorAll('article[data-testid="tweet"]');
              const mainArticle = articles[0];
              if (mainArticle) {
                const replyButton = mainArticle.querySelector('[data-testid="reply"]') as HTMLElement;
                if (replyButton) {
                  replyButton.click();
                  await new Promise(resolve => setTimeout(resolve, 500));
                  fillComposerText('[data-testid="tweetTextarea_0"]', inlineButtonSelector, true);
                }
              }
            }
          } else {
            // No reference tweet, check if we're on a tweet page anyway
            const replyLabel = document.querySelector('[data-testid="tweetTextarea_0_label"]') as HTMLElement;
            if (replyLabel) {
              replyLabel.click();
              await new Promise(resolve => setTimeout(resolve, 300));
              fillComposerText('[data-testid="tweetTextarea_0"]', inlineButtonSelector, true);
            } else {
              // Fallback to regular post
              const newTweetButton = document.querySelector('[data-testid="SideNav_NewTweet_Button"]') as HTMLElement;
              if (newTweetButton) {
                newTweetButton.click();
                await new Promise(resolve => setTimeout(resolve, 500));
                fillComposerText('[data-testid="tweetTextarea_0"]', '[data-testid="tweetButton"]', true);
              }
            }
          }

        } else if (action === 'quote') {
          // Quote tweet flow
          if (referenceTweetId) {
            // Check if we're on the tweet page
            const currentUrl = window.location.href;
            const isOnTweetPage = currentUrl.includes(`/status/`);

            if (isOnTweetPage) {
              // On tweet detail page: Use Quote Tweet flow
              const articles = document.querySelectorAll('article[data-testid="tweet"]');
              const mainArticle = articles[0];

              if (!mainArticle) {
                console.error("Main tweet article not found");
                return;
              }

              const retweetButton = mainArticle.querySelector('[data-testid="retweet"]') as HTMLElement;
              if (!retweetButton) {
                console.error("Retweet button not found");
                return;
              }
              retweetButton.click();

              await new Promise(resolve => setTimeout(resolve, 500));

              const dropdown = document.querySelector('[data-testid="Dropdown"]');
              if (!dropdown) {
                console.error("Dropdown menu not found");
                return;
              }

              const quoteButton = dropdown.querySelector('a[href*="/compose/post"]') as HTMLElement;
              if (!quoteButton) {
                console.error("Quote button not found in dropdown");
                return;
              }
              quoteButton.click();

              await new Promise(resolve => setTimeout(resolve, 500));
              // Pass true to upload media if available
              fillComposerText('[data-testid="tweetTextarea_0"]', '[data-testid="tweetButton"]', true);
            } else {
              // Navigate to tweet page first (SPA navigation, no page reload)
              const tweetUrl = `/i/status/${referenceTweetId}`;
              navigateToUrl(tweetUrl);
            }
          } else {
            // No reference tweet, fallback to regular post with image
            const newTweetButton = document.querySelector('[data-testid="SideNav_NewTweet_Button"]') as HTMLElement;
            if (newTweetButton) {
              newTweetButton.click();
              await new Promise(resolve => setTimeout(resolve, 500));
              fillComposerText('[data-testid="tweetTextarea_0"]', '[data-testid="tweetButton"]', true);
            }
          }
        }

      } catch (e) {
        console.error("Simulation failed", e);
      }
    };

    simulateInteraction();
  };

  const handleCopy = async () => {
    const contentWithHashtags = draft.hashtags && draft.hashtags.length > 0
      ? `${editableContent}\n\n${draft.hashtags.map(tag => tag.startsWith('#') ? tag : `#${tag}`).join(' ')}`
      : editableContent;
    await navigator.clipboard.writeText(contentWithHashtags);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div data-no-selection-menu="true" className="flex flex-col gap-3 p-3 rounded-2xl bg-[var(--bg-primary)] mb-2" style={{ border: '1px solid var(--border-color)' }}>
      {/* Tweet Card Inner */}
      <div className="pt-1" style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: '20px', marginBottom: '4px' }}>
        <div className="flex gap-3">
          {/* Avatar */}
          {userInfo?.avatar ? (
            <img
              src={userInfo.avatar}
              alt={userInfo.name}
              className="w-10 h-10 rounded-full object-cover shrink-0"
            />
          ) : (
            <div className="w-10 h-10 rounded-full bg-[var(--bg-secondary)] shrink-0" />
          )}

          {/* User Info & Content */}
          <div className="flex-1 min-w-0">
            {/* Name, Handle, Draft Badge */}
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="font-bold text-[var(--text-primary)] text-[15px] truncate flex items-center gap-1">
                  {userInfo?.name || 'User'}
                  {userInfo?.verified && (
                    <svg viewBox="0 0 22 22" aria-label="Verified account" role="img" className="w-[18px] h-[18px] text-[#1d9bf0] fill-current">
                      <g>
                        <path d="M20.396 11c-.018-.646-.215-1.275-.57-1.816-.354-.54-.852-.972-1.438-1.246.223-.607.27-1.264.14-1.897-.131-.634-.437-1.218-.882-1.687-.47-.445-1.053-.75-1.687-.882-.633-.13-1.29-.083-1.897.14-.273-.587-.704-1.086-1.245-1.44S11.647 1.62 11 1.604c-.646.017-1.273.213-1.813.568s-.969.97-1.245 1.44c-.606-.223-1.264-.27-1.897-.14-.634.13-1.218.437-1.687.882-.445.469-.751 1.053-.882 1.687-.13.633-.083 1.29.14 1.897-.586.274-1.084.705-1.439 1.246-.354.54-.55 1.17-.569 1.816.017.647.215 1.276.569 1.817.355.54.853.971 1.439 1.245-.223.606-.27 1.263-.14 1.897.131.634.437 1.218.882 1.687.47.445 1.053.75 1.687.882.633.13 1.29.083 1.897-.14.276.587.705 1.086 1.245 1.44.54.354 1.167.55 1.813.568.647-.018 1.275-.214 1.816-.569.54-.354.972-.853 1.245-1.44.606.223 1.264.27 1.897.14.634-.13 1.218-.437 1.687-.882.445-.469.75-1.053.882-1.687.13-.633.083-1.29-.14-1.897.587-.274 1.087-.705 1.438-1.245.355-.54.552-1.17.57-1.817zM9.662 14.85l-3.429-3.428 1.293-1.302 2.072 2.072 4.4-4.794 1.347 1.246z"></path>
                      </g>
                    </svg>
                  )}
                </span>
                <span className="text-[var(--text-secondary)] text-[15px] truncate">
                  {userInfo?.handle || '@user'}
                </span>
              </div>
            </div>

            {/* Tweet Content - Editable */}
            {isEditingContent ? (
              <AutoResizeTextarea
                ref={contentTextareaRef}
                value={editableContent}
                onChange={(e) => setEditableContent(e.target.value)}
                onBlur={() => setIsEditingContent(false)}
                className="text-[15px] text-[var(--text-primary)] leading-[20px] whitespace-pre-wrap w-full bg-transparent border-none outline-none resize-none overflow-hidden min-h-[20px] p-0 m-0 block"
                style={{ minHeight: '20px', fontFamily: 'inherit', fontWeight: 'inherit', lineHeight: '20px', verticalAlign: 'top' }}
                placeholder="Edit your tweet..."
              />
            ) : (
              <div
                className="text-[15px] text-[var(--text-primary)] leading-[20px] whitespace-pre-wrap w-full min-h-[20px] cursor-text"
                style={{ lineHeight: '20px' }}
                onClick={(e) => {
                  // Don't enter edit mode if clicking on a link
                  const target = e.target as HTMLElement;
                  if (target.tagName === 'A' || target.style.cursor === 'pointer') {
                    return;
                  }

                  setIsEditingContent(true);
                  setTimeout(() => {
                    const textarea = contentTextareaRef.current;
                    if (textarea) {
                      textarea.focus();
                      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
                    }
                  }, 0);
                }}
              >
                {renderTextWithLinks(editableContent, {
                  openInNewTab: false,
                  onNavigate: navigateToUrl
                })}
              </div>
            )}

            {/* Hashtags */}
            {draft.hashtags && draft.hashtags.length > 0 && (
              <p className="text-[15px] text-[#1d9bf0] mt-1 flex flex-wrap gap-2 leading-tight">
                {draft.hashtags.map((tag, idx) => {
                  const cleanTag = tag.startsWith('#') ? tag.slice(1) : tag;
                  return (
                    <span
                      key={idx}
                      className="hover:underline cursor-pointer"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigateToUrl(`https://x.com/hashtag/${cleanTag}`);
                      }}
                    >
                      #{cleanTag}
                    </span>
                  );
                })}
              </p>
            )}

            {/* Media Items (Original or Edited) - Twitter-style 2x2 grid */}
            {mediaItems && mediaItems.length > 0 && (() => {
              // Check if any media is vertical (detected from video dimensions, YouTube Shorts URL, or TikTok)
              const hasVerticalVideo = mediaItems.some(m => {
                // YouTube Shorts or explicit vertical flag
                if (m.isVertical || m.youtube_url?.includes('/shorts/')) return true;
                // TikTok and Xiaohongshu videos are typically vertical
                const videoUrl = m.video_url || m.url || '';
                if (m.source === 'tiktok' ||
                    m.source === 'xiaohongshu' ||
                    videoUrl.includes('tiktok') ||
                    videoUrl.includes('tiktokcdn') ||
                    videoUrl.includes('xhscdn') ||
                    videoUrl.includes('xiaohongshu') ||
                    m.original_url?.includes('tiktok') ||
                    m.original_url?.includes('xiaohongshu')) {
                  return true;
                }
                return false;
              });
              // For vertical videos, don't force aspect ratio - let content determine size
              // For horizontal videos, use 16/9
              const aspectRatio = hasVerticalVideo ? undefined : '16/9';

              return (
                <div className="mt-2 rounded-2xl overflow-hidden border border-[var(--border-color)]">
                  <div className={`${hasVerticalVideo ? 'flex justify-center' : 'grid gap-0.5'} ${!hasVerticalVideo && mediaItems.length === 1 ? 'grid-cols-1' : ''} ${!hasVerticalVideo && mediaItems.length > 1 ? 'grid-cols-2' : ''} ${!hasVerticalVideo && mediaItems.length > 2 ? 'grid-rows-2' : ''}`}
                    style={{ aspectRatio, backgroundColor: 'black' }}
                  >
                    {mediaItems.map((media, idx) => (
                      <div
                        key={idx}
                        className={`relative overflow-hidden bg-black ${mediaItems.length === 3 && idx === 0 ? 'row-span-2' : ''}`}
                        style={{ minHeight: 0 }}
                      >
                        {media.type === 'video' ? (
                          <VideoThumbnail
                            videoUrl={media.media_url || media.video_url || ''}
                            thumbnailUrl={media.thumbnail_url || media.thumbnail}
                            source={media.source}
                            isVertical={media.isVertical}
                            onDelete={() => handleMediaDelete(idx)}
                          />
                        ) : (
                          <div className="w-full h-full">
                            <EditableImage
                              src={media.media_url}
                              prompt={editableContent}
                              onImageUpdate={(newSrc) => handleMediaUpdate(idx, newSrc)}
                              onDelete={() => handleMediaDelete(idx)}
                              onPreview={(proxiedSrc) => setPreviewImageUrl(proxiedSrc)}
                              className="w-full h-full object-cover"
                              isAIGenerated={false}
                              hasOriginal={true}
                            />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* Generated Image in Tweet - skeleton */}
            {(!mediaItems || mediaItems.length === 0) && generatingImage && (
              <div className="mt-2 w-full aspect-square max-h-[300px] rounded-xl overflow-hidden border border-[var(--border-color)]">
                <div className="skeleton-shimmer w-full h-full"></div>
              </div>
            )}
            {(!mediaItems || mediaItems.length === 0) && generatedImageUrl && !generatingImage && (
              <div className="mt-2 relative group">
                <CopyButtonOverlay src={generatedImageUrl} />
                <img
                  src={generatedImageUrl}
                  alt="Generated"
                  draggable={true}
                  onDragStart={(e) => handleImageDragStart(e, generatedImageUrl)}
                  className="w-full object-cover rounded-xl cursor-zoom-in hover:opacity-95 transition-opacity border border-[var(--border-color)]"
                  style={{ maxHeight: '300px' }}
                  onClick={() => setPreviewImageUrl(generatedImageUrl)}
                />
                <button
                  onClick={() => setGeneratedImageUrl(null)}
                  className="absolute top-2 right-9 p-1.5 rounded-full bg-black/60 hover:bg-black/80 text-white opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                  title="Remove image"
                >
                  <X size={14} />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Reference Tweets */}
      {draft.reference_tweet_ids && draft.reference_tweet_ids.length > 0 && (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-[var(--text-secondary)]">{t.chat.reference}:</span>
          <div className="flex flex-wrap gap-1.5">
            {draft.reference_tweet_ids.map((tweetId, idx) => (
              <button
                key={idx}
                onClick={() => {
                  // Keep chat panel visible when navigating to reference tweet
                  onStayOnPage?.();
                  const tweetUrl = `https://x.com/i/status/${tweetId}`;
                  navigateToUrl(tweetUrl);
                }}
                className="px-2 py-0.5 rounded-full bg-[var(--bg-secondary)] border border-[var(--border-color)] text-[var(--text-primary)] hover:bg-black hover:text-white transition-colors cursor-pointer text-[11px] font-medium"
              >
                #{idx + 1}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Reasoning */}
      {draft.reasoning && (
        <div className="flex gap-2 text-xs text-[var(--text-secondary)]">
          <div className="mt-0.5 shrink-0">
            <Bot size={12} />
          </div>
          <p className="italic leading-relaxed opacity-80">{draft.reasoning}</p>
        </div>
      )}

      {/* Image Suggestion - Only show if no original media */}
      {(!mediaItems || mediaItems.length === 0) && (draft.image_suggestion?.has_suggestion || showImageGenerator) && (
        <div className="rounded-lg bg-[var(--bg-secondary)] overflow-hidden" style={{ border: '1px solid var(--border-color)' }}>
          <div className="flex flex-col gap-2 p-3">
            <div className="flex items-center justify-between min-h-[28px]">
              <div className="flex items-center gap-2 text-[var(--text-primary)]">
                <Flame size={16} />
                <span className="text-xs font-bold text-[var(--text-primary)]">Image Idea</span>
              </div>
              <button
                onClick={handleGenerateImage}
                disabled={generatingImage}
                className="shrink-0 px-3 py-1 rounded-full bg-black hover:bg-gray-800 shadow-sm disabled:opacity-70 disabled:cursor-not-allowed transition-all duration-200 flex items-center justify-center gap-1.5 cursor-pointer"
              >
                {generatingImage ? (
                  <>
                    <span className="loading loading-spinner loading-xs text-white"></span>
                    <span className="text-xs font-semibold text-white whitespace-nowrap">Generating</span>
                  </>
                ) : (
                  <>
                    {generatedImageUrl && <RefreshCw size={12} className="text-white" />}
                    <span className="text-xs font-semibold text-white whitespace-nowrap">
                      {generatedImageUrl ? 'Regenerate' : 'Generate'}
                    </span>
                  </>
                )}
              </button>
            </div>
            {isEditingPrompt ? (
              <textarea
                autoFocus
                value={editablePrompt}
                onChange={(e) => setEditablePrompt(e.target.value)}
                onBlur={() => setIsEditingPrompt(false)}
                className="w-full text-xs text-[var(--text-secondary)] bg-[var(--bg-primary)] p-2 rounded border border-[var(--accent-color)] outline-none resize-none min-h-[100px]"
              />
            ) : isOptimizingPrompt ? (
              <div className="h-12 w-full rounded-lg overflow-hidden border border-[var(--border-color)]">
                <div className="skeleton-shimmer w-full h-full"></div>
              </div>
            ) : (
              <p
                onClick={() => !generatingImage && setIsEditingPrompt(true)}
                className="text-xs text-[var(--text-secondary)] leading-relaxed cursor-pointer hover:text-[var(--text-primary)] transition-colors p-1 -m-1 rounded hover:bg-[var(--bg-primary)]"
                title="Click to edit prompt"
              >
                {editablePrompt}
              </p>
            )}

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <button
                  onClick={handleOptimizePrompt}
                  disabled={generatingImage || isOptimizingPrompt}
                  className="text-xs text-[var(--text-primary)] hover:text-[var(--text-secondary)] disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1 transition-colors cursor-pointer"
                  title="Optimize prompt with AI"
                >
                  {isOptimizingPrompt ? (
                    <span className="loading loading-spinner loading-xs"></span>
                  ) : (
                    <Sparkles size={12} />
                  )}
                  <span>{isOptimizingPrompt ? 'Optimizing' : 'Optimize'}</span>
                </button>

                <div className="w-px h-3 bg-[var(--border-color)]"></div>

                <button
                  onClick={() => setIsPickerOpen(true)}
                  disabled={generatingImage}
                  className="text-xs text-[var(--text-primary)] hover:text-[var(--text-secondary)] disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1 transition-colors cursor-pointer"
                  title="Choose from templates"
                >
                  <LayoutGrid size={12} />
                  <span>Templates</span>
                </button>
              </div>

              <label className="flex items-center gap-1.5 cursor-pointer select-none group">
                <span className={`text-xs font-medium transition-colors ${useProModel ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)] group-hover:text-[var(--text-primary)]'}`}>Pro</span>
                <div className="relative">
                  <input
                    type="checkbox"
                    checked={useProModel}
                    onChange={(e) => setUseProModel(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-8 h-4 bg-gray-300 dark:bg-gray-600 border border-transparent rounded-full peer peer-checked:bg-black peer-checked:border-black transition-all duration-200"></div>
                  <div className="absolute left-0.5 top-0.5 w-3 h-3 bg-white rounded-full shadow-sm transition-transform duration-200 peer-checked:translate-x-4"></div>
                </div>
              </label>
            </div>

            <PromptPickerModal
              isOpen={isPickerOpen}
              onClose={() => setIsPickerOpen(false)}
              onSelect={(prompt) => {
                setEditablePrompt(prompt);
                setIsEditingPrompt(true); // Switch to edit mode so user sees the change
              }}
            />


            {/* Error Message */}
            {imageError && (
              <p className="text-xs text-red-500 mt-2">{imageError}</p>
            )}
          </div>
        </div>
      )}

      {/* Media Uploading Notification */}
      <NotificationToast
        message={
          isUploadingSubtitles
            ? (t.chat.addingSubtitles || '添加字幕...')
            : (isVideoUpload && uploadProgress !== null
              ? `${t.chat.uploading || 'Uploading'} (${uploadProgress}%)`
              : t.chat.addingMedia)
        }
        isVisible={isUploadingMedia}
        onModalClose={() => setIsUploadingMedia(false)}
      />

      {/* Image Preview Modal */}
      {previewImageUrl && createPortal(
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            backgroundColor: 'rgba(0, 0, 0, 0.9)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 2147483647, // Max z-index
            backdropFilter: 'blur(5px)',
            opacity: 1,
            transition: 'opacity 0.2s ease-in-out'
          }}
          onClick={() => setPreviewImageUrl(null)}
        >
          <button
            onClick={() => setPreviewImageUrl(null)}
            style={{
              position: 'absolute',
              top: '20px',
              right: '20px',
              padding: '10px',
              borderRadius: '9999px',
              backgroundColor: 'rgba(255, 255, 255, 0.1)',
              color: 'white',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'background-color 0.2s'
            }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.2)')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.1)')}
          >
            <X size={24} />
          </button>
          <img
            src={previewImageUrl}
            alt="Preview"
            style={{
              maxWidth: '90vw',
              maxHeight: '90vh',
              objectFit: 'contain',
              borderRadius: '12px',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
              transform: 'scale(1)',
              transition: 'transform 0.2s'
            }}
            onClick={(e) => e.stopPropagation()}
          />
        </div>,
        document.body
      )}

      {/* Actions Row - Auto-post on left, Post button on right */}
      <div className="flex items-center justify-between px-1">
        {/* Auto-post Toggle Switch - Left aligned */}
        <div
          className="flex items-center gap-2 cursor-pointer group"
          onClick={(e) => {
            e.stopPropagation();
            setAutoPost(!autoPost);
          }}
          title={autoPost ? "Auto-post enabled" : "Auto-post disabled"}
        >
          <span className="text-[11px] text-[var(--text-secondary)] font-medium group-hover:text-[var(--text-primary)] transition-colors">
            {t.chat.autoPost}
          </span>
          <div
            className={`w-9 h-5 rounded-full transition-colors flex items-center shadow-sm ${autoPost ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'}`}
          >
            <div
              className="w-4 h-4 bg-white rounded-full shadow-sm transition-transform duration-200"
              style={{ transform: autoPost ? 'translateX(17px)' : 'translateX(2px)' }}
            />
          </div>
        </div>

        {/* Post Button - Right aligned */}
        <button
          onClick={handlePost}
          className="px-5 h-8 rounded-full bg-[var(--text-primary)] text-[var(--bg-primary)] font-bold text-sm hover:opacity-90 active:scale-[0.98] transition-all flex items-center justify-center gap-2 shadow-sm cursor-pointer"
        >
          {draft.action === 'reply' ? t.chat.reply : draft.action === 'quote' ? t.chat.quote : t.chat.post}
        </button>
      </div>
    </div>
  );
};

// Component to format text with special patterns:
// 1. Tweet ID arrays [id1, id2, id3] -> displays with a single icon that opens modal
// 2. $TOKEN patterns -> displays in amber color
const FormattedText: React.FC<{ children: React.ReactNode; onTweetIdsClick?: (ids: string[]) => void }> = ({ children, onTweetIdsClick }) => {
  if (typeof children !== 'string') {
    return <>{children}</>;
  }

  const text = children;
  const result: React.ReactNode[] = [];
  let lastIndex = 0;

  // Combined regex for tweet ID arrays, $TOKEN patterns, and @mentions
  // Pattern 1: [number, number, ...] - tweet ID arrays
  // Pattern 2: $WORD - token symbols
  // Pattern 3: @USERNAME - user mentions
  const combinedPattern = /(\[\s*\d{15,}\s*(?:,\s*\d{15,}\s*)*\])|(\$[A-Za-z][A-Za-z0-9]*)|(@[a-zA-Z0-9_]+)/g;

  let match;
  while ((match = combinedPattern.exec(text)) !== null) {
    // Add text before the match
    if (match.index > lastIndex) {
      result.push(text.slice(lastIndex, match.index));
    }

    if (match[1]) {
      // Tweet ID array pattern - show single clickable icon
      const idsString = match[1];
      const ids = idsString.match(/\d{15,}/g) || [];

      result.push(
        <span
          key={match.index}
          onClick={(e) => {
            e.stopPropagation();
            if (onTweetIdsClick) {
              onTweetIdsClick(ids);
            }
          }}
          className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-[var(--bg-secondary)] border border-[var(--border-color)] hover:bg-[var(--hover-bg)] cursor-pointer transition-colors"
          title={`View ${ids.length} tweet${ids.length > 1 ? 's' : ''} `}
        >
          <ExternalLink size={10} className="text-[var(--text-secondary)]" />
        </span>
      );
    } else if (match[2]) {
      // $TOKEN pattern
      result.push(
        <span
          key={match.index}
          className="text-amber-500 font-semibold"
        >
          {match[2]}
        </span>
      );
    } else if (match[3]) {
      // @USERNAME pattern
      const mention = match[3];
      result.push(
        <span
          key={match.index}
          style={{ color: 'rgb(29, 155, 240)', fontWeight: 400 }}
          className="cursor-pointer hover:underline"
          onClick={(e) => {
            e.stopPropagation();
            navigateToUrl(`https://x.com/${mention.slice(1)}`);
          }}
        >
          {mention}
        </span>
      );
    }

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    result.push(text.slice(lastIndex));
  }

  return <>{result}</>;
};

// Custom components for ReactMarkdown to use FormattedText
const createMarkdownComponents = (onTweetIdsClick?: (ids: string[]) => void, onImageClick?: (src: string) => void) => ({
  p: ({ children, ...props }: any) => (
    <p {...props}>
      {React.Children.map(children, (child) =>
        typeof child === 'string' ? <FormattedText onTweetIdsClick={onTweetIdsClick}>{child}</FormattedText> : child
      )}
    </p>
  ),
  li: ({ children, ...props }: any) => (
    <li {...props}>
      {React.Children.map(children, (child) =>
        typeof child === 'string' ? <FormattedText onTweetIdsClick={onTweetIdsClick}>{child}</FormattedText> : child
      )}
    </li>
  ),
  strong: ({ children, ...props }: any) => (
    <strong {...props}>
      {React.Children.map(children, (child) =>
        typeof child === 'string' ? <FormattedText onTweetIdsClick={onTweetIdsClick}>{child}</FormattedText> : child
      )}
    </strong>
  ),
  img: ({ src, alt, ...props }: any) => {
    if (!src) return null;
    return (
      <div className="my-2 w-[280px] rounded-xl overflow-hidden border border-[var(--border-color)] relative group">
        <CopyButtonOverlay src={src} />
        <img
          src={src}
          alt={alt || "Generated Image"}
          draggable={true}
          onDragStart={(e) => handleImageDragStart(e, src)}
          className="w-full h-auto object-cover max-h-[280px] cursor-pointer hover:opacity-95 transition-opacity rounded-xl"
          loading="lazy"
          {...props}
          onClick={() => onImageClick?.(src)}
          onError={(e) => {
            console.error("Image load error:", src?.substring(0, 50) + "...");
            e.currentTarget.style.display = 'none';
            e.currentTarget.parentElement?.classList.add('bg-red-50', 'p-4');
            const errorText = document.createElement('div');
            errorText.textContent = 'Failed to load image';
            errorText.className = 'text-red-500 text-xs';
            e.currentTarget.parentElement?.appendChild(errorText);
          }}
        />
      </div>
    );
  }
});

interface ChatPanelProps {
  onLoginClick?: () => void;
  onCreditsClick?: () => void;
  onTabChange?: (tab: string) => void;
  contextTweetId?: string;
  initialMessage?: string | null;
  onMessageSent?: () => void;
  resetTrigger?: number;
  onMessagesChange?: (count: number) => void;
  onScrollDirectionChange?: (isScrollingDown: boolean) => void;
  onStayOnPage?: () => void;
  hideHeaderSpacer?: boolean;
}

export const ChatPanel: React.FC<ChatPanelProps> = ({ onLoginClick, onCreditsClick, onTabChange, contextTweetId, initialMessage, onMessageSent, resetTrigger, onMessagesChange, onScrollDirectionChange, onStayOnPage, hideHeaderSpacer = false }) => {
  const { t, language } = useLanguage();
  const { theme } = useTheme();

  // State
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [quotedText, setQuotedText] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [showNewChatBtn, setShowNewChatBtn] = useState(false);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [inputError, setInputError] = useState<string | null>(null);

  // Pending message for retry after login
  const pendingMessageRef = useRef<{ text: string; images?: string[]; files?: any[] } | null>(null);

  // Track if context has been sent (to avoid repeating context in follow-up messages)
  const contextSentRef = useRef(false);
  // Track processed pre-fetches to prevent duplicates
  const processedPrefetches = useRef<Set<string>>(new Set());

  // Initialize Action System on mount
  useEffect(() => {
    initializeActionSystem();
  }, []);

  // Retry pending message after login success
  useEffect(() => {
    const checkAndRetry = async () => {
      if (pendingMessageRef.current) {
        const user = await authService.getUser();
        if (user) {
          // User logged in, retry the pending message
          const pending = pendingMessageRef.current;
          pendingMessageRef.current = null;

          // Remove the error message and retry
          setMessages(prev => {
            // Remove last bot message (the error)
            const lastBotIndex = prev.map(m => m.role).lastIndexOf('bot');
            if (lastBotIndex >= 0 && prev[lastBotIndex].errorStatus) {
              return prev.slice(0, lastBotIndex);
            }
            return prev;
          });

          // Retry with saved content
          setTimeout(() => {
            handleSubmit(undefined, pending.text);
          }, 100);
        }
      }
    };

    // Listen for storage changes (login state)
    const handleStorageChange = () => {
      checkAndRetry();
    };

    // Check periodically for login state change (backup for storage events)
    const intervalId = setInterval(checkAndRetry, 1000);

    // Also listen to chrome storage changes
    if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
      chrome.storage.onChanged.addListener(handleStorageChange);
    }

    return () => {
      clearInterval(intervalId);
      if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
        chrome.storage.onChanged.removeListener(handleStorageChange);
      }
    };
  }, []);

  // Image Upload State
  const [selectedImages, setSelectedImages] = useState<string[]>([]);
  // File Upload State (for PDF, etc.)
  const [selectedFiles, setSelectedFiles] = useState<{ name: string; type: string; size: number; data: string }[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isInternalDragRef = useRef(false); // Track if drag started from within the page

  // Supported file types for upload
  const SUPPORTED_FILE_TYPES = {
    image: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
    document: ['application/pdf', 'text/plain', 'text/csv', 'application/json']
  };
  const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB for images
  const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB for documents

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      Array.from(files).forEach(file => {
        const isImage = SUPPORTED_FILE_TYPES.image.includes(file.type);
        const isDocument = SUPPORTED_FILE_TYPES.document.includes(file.type);

        if (!isImage && !isDocument) {
          console.error(`Unsupported file type: ${file.type}`);
          return;
        }

        const maxSize = isImage ? MAX_IMAGE_SIZE : MAX_FILE_SIZE;
        if (file.size > maxSize) {
          console.error(`File too large (max ${maxSize / 1024 / 1024}MB): ${file.name}`);
          return;
        }

        const reader = new FileReader();
        reader.onloadend = () => {
          if (typeof reader.result === 'string') {
            const result = reader.result as string;

            if (isImage) {
              setSelectedImages(prev => {
                if (prev.includes(result)) return prev;
                return [...prev, result];
              });
            } else {
              // Extract pure base64 from data URL
              const base64Data = result.split(',')[1];
              setSelectedFiles(prev => {
                // Check for duplicates by name
                if (prev.some(f => f.name === file.name)) return prev;
                return [...prev, {
                  name: file.name,
                  type: file.type,
                  size: file.size,
                  data: base64Data
                }];
              });
            }
          }
        };
        reader.readAsDataURL(file);
      });
    }
    // Reset input so same file can be selected again if needed
    e.target.value = '';
  };

  // Keep handleImageSelect as alias for compatibility
  const handleImageSelect = handleFileSelect;

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        e.preventDefault();
        const file = items[i].getAsFile();
        if (file) {
          if (file.size > 5 * 1024 * 1024) {
            console.error("Image too large (max 5MB)");
            continue; // Skip this one but try others if any
          }
          const reader = new FileReader();
          reader.onloadend = () => {
            if (typeof reader.result === 'string') {
              const result = reader.result as string;
              setSelectedImages(prev => {
                if (prev.includes(result)) return prev;
                return [...prev, result];
              });
            }
          };
          reader.readAsDataURL(file);
        }
        // Don't break, allow multiple pasted images if the browser supports it
      }
    }
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Ignore internal drags (from images within the page)
    if (isInternalDragRef.current) return;
    // Check for files - this is the most reliable indicator of external drag
    const hasFiles = e.dataTransfer.types.includes('Files');
    const hasUri = e.dataTransfer.types.includes('text/uri-list');
    const hasHtml = e.dataTransfer.types.includes('text/html');
    if (hasFiles || hasUri || hasHtml) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Only set to false if we are actually leaving the drop zone (relatedTarget is null or outside)
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDragging(false);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Ignore internal drags
    if (isInternalDragRef.current) return;
    // Always update isDragging on dragOver to ensure the overlay stays visible
    const hasFiles = e.dataTransfer.types.includes('Files');
    const hasUri = e.dataTransfer.types.includes('text/uri-list');
    const hasHtml = e.dataTransfer.types.includes('text/html');
    if (hasFiles || hasUri || hasHtml) {
      if (!isDragging) {
        setIsDragging(true);
      }
    }
  };

  // Global dragstart listener to detect internal drags
  useEffect(() => {
    const handleGlobalDragStart = (e: DragEvent) => {
      // If drag starts from an element within our app, mark it as internal
      const target = e.target as HTMLElement;
      // Check if the target is within our shadow root or is an IMG
      if (target && (target.tagName === 'IMG' || target.closest('img'))) {
        isInternalDragRef.current = true;
      }
    };

    const handleGlobalDragEnd = () => {
      // Reset state after any drag ends
      setTimeout(() => {
        setIsDragging(false);
        isInternalDragRef.current = false;
      }, 100);
    };

    // Also listen for drop anywhere to reset state
    const handleGlobalDrop = () => {
      setTimeout(() => {
        setIsDragging(false);
        isInternalDragRef.current = false;
      }, 100);
    };

    document.addEventListener('dragstart', handleGlobalDragStart);
    document.addEventListener('dragend', handleGlobalDragEnd);
    document.addEventListener('drop', handleGlobalDrop);

    return () => {
      document.removeEventListener('dragstart', handleGlobalDragStart);
      document.removeEventListener('dragend', handleGlobalDragEnd);
      document.removeEventListener('drop', handleGlobalDrop);
    };
  }, []);

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    // 1. Handle Files
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      Array.from(e.dataTransfer.files).forEach(file => {
        if (file.type.startsWith('image/')) {
          if (file.size > 5 * 1024 * 1024) {
            console.error("Image too large (max 5MB)");
            return;
          }
          const reader = new FileReader();
          reader.onloadend = () => {
            if (typeof reader.result === 'string') {
              setSelectedImages(prev => [...prev, reader.result as string]);
            }
          };
          reader.readAsDataURL(file);
        }
      });
      return;
    }

    // 2. Handle HTML/URL drops (e.g. from tweets)
    const html = e.dataTransfer.getData('text/html');
    const uri = e.dataTransfer.getData('text/uri-list');

    let imageUrl: string | null = null;

    if (html) {
      // Try to find img src in the HTML
      const parser = new (window as any).DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      const img = doc.querySelector('img');
      if (img && img.src) {
        imageUrl = img.src;
      }
    }

    // Fallback to URI if no image in HTML or no HTML
    if (!imageUrl && uri) {
      // Filter out non-image URIs if possible, or just try it
      if (uri.match(/\.(jpeg|jpg|gif|png|webp)$/i) || uri.includes('pbs.twimg.com')) {
        imageUrl = uri;
      }
    }

    if (imageUrl) {
      try {
        // Try to fetch and convert to blob/base64 to avoid CORS issues later if possible
        const response = await fetch(imageUrl);
        const blob = await response.blob();
        if (blob.type.startsWith('image/')) {
          if (blob.size > 5 * 1024 * 1024) {
            console.error("Image too large (max 5MB)");
            return;
          }
          const reader = new FileReader();
          reader.onloadend = () => {
            if (typeof reader.result === 'string') {
              const result = reader.result as string;
              setSelectedImages(prev => {
                if (prev.includes(result)) return prev;
                return [...prev, result];
              });
            }
          };
          reader.readAsDataURL(blob);
        }
      } catch (err) {
        console.error("Failed to fetch dropped image URL, using URL directly:", err);
        // Fallback: use URL directly if fetch fails (might fail due to CORS)
        setSelectedImages(prev => {
          if (prev.includes(imageUrl!)) return prev;
          return [...prev, imageUrl!];
        });
      }
    }
  };

  // Notify parent of message count changes
  useEffect(() => {
    if (onMessagesChange) {
      onMessagesChange(messages.length);
    }
  }, [messages.length, onMessagesChange]);

  // Set up session context when component mounts or contextTweetId changes
  useEffect(() => {
    // Use a stable session ID based on the context tweet
    // This ensures each tweet context has its own conversation history
    const sessionId = contextTweetId || 'default-chat';
    chatService.setSessionContext(sessionId);
    console.log('[ChatPanel] Session context set:', sessionId);

    // For global chat mode (no contextTweetId), clear history on mount/tab change
    // This prevents old messages from appearing when switching between tabs
    if (!contextTweetId) {
      console.log('[ChatPanel] Global mode detected, clearing history on mount');
      chatService.startNewChat();
    }

    return () => {
      // When component unmounts or context changes, persist the current history
      // but don't clear it - it should be preserved for later retrieval
      console.log('[ChatPanel] Session context cleanup:', sessionId);
    };
  }, [contextTweetId]);

  // Handle Reset Trigger
  // This effect runs whenever resetTrigger changes, allowing proper cleanup
  // even when resetTrigger is 0 (component remount)
  useEffect(() => {
    if (resetTrigger !== undefined && resetTrigger !== null) {
      setMessages([]);
      setInput('');
      setIsLoading(false);
      contextSentRef.current = false; // Reset context sent flag
      chatService.startNewChat(); // Clear conversation history
      console.log('[ChatPanel] Reset triggered:', resetTrigger);
    }
  }, [resetTrigger]);

  // Tweet data from API interception (for context prompt) and UI display
  const [quotedTweetData, setQuotedTweetData] = useState<ScrapedTweet | null>(null);
  const [apiTweetData, setApiTweetData] = useState<TimelineTweetData | null>(null);

  useEffect(() => {
    if (!contextTweetId) {
      setQuotedTweetData(null);
      setApiTweetData(null);
      return;
    }

    let cancelled = false;

    // Recursively search raw API response for a tweet object with matching rest_id
    const findTweetInPayload = (obj: any, targetId: string, depth = 0): any => {
      if (!obj || typeof obj !== 'object' || depth > 15) return null;
      // Check if this is a tweet object
      const tweet = obj.tweet || obj;
      if (tweet.rest_id === targetId && tweet.legacy) return tweet;
      // Recurse into object properties
      for (const key of Object.keys(obj)) {
        const found = findTweetInPayload(obj[key], targetId, depth + 1);
        if (found) return found;
      }
      return null;
    };

    // Extract media URLs from tweet legacy.extended_entities
    const extractMedia = (legacy: any): TimelineTweetData['mediaUrls'] => {
      const mediaList = legacy?.extended_entities?.media || legacy?.entities?.media || [];
      const results: NonNullable<TimelineTweetData['mediaUrls']> = [];
      for (const item of mediaList) {
        if (item.type === 'video' || item.type === 'animated_gif') {
          const variants = item.video_info?.variants || [];
          let bestUrl = '';
          let bestBitrate = -1;
          for (const v of variants) {
            if (v.content_type === 'video/mp4' && (v.bitrate || 0) > bestBitrate) {
              bestBitrate = v.bitrate || 0;
              bestUrl = v.url;
            }
          }
          if (bestUrl) results.push({ type: item.type, url: bestUrl, thumbnail: item.media_url_https });
        } else if (item.type === 'photo') {
          results.push({ type: 'photo', url: item.media_url_https });
        }
      }
      return results.length > 0 ? results : undefined;
    };

    // Parse raw tweet object into TimelineTweetData
    const parseTweetObj = (tweetObj: any): TimelineTweetData | null => {
      const tweet = tweetObj.tweet || tweetObj;
      const legacy = tweet.legacy;
      if (!legacy) return null;
      const userResult = tweet.core?.user_results?.result;
      const userCore = userResult?.core;
      const userLegacy = userResult?.legacy;
      const profileImageUrl = userResult?.avatar?.image_url
        || userLegacy?.profile_image_url_https
        || userCore?.profile_image_url_https || '';
      const extMedia = legacy.extended_entities?.media || [];
      let mediaType: 'video' | 'image' | 'none' = 'none';
      for (const m of extMedia) {
        if (m.type === 'video' || m.type === 'animated_gif') { mediaType = 'video'; break; }
        if (m.type === 'photo') mediaType = 'image';
      }
      return {
        tweetId: tweet.rest_id,
        username: userCore?.screen_name || userLegacy?.screen_name || '',
        displayName: userCore?.name || userLegacy?.name || '',
        profileImageUrl: profileImageUrl.replace('_normal.', '_bigger.'),
        followers: userLegacy?.followers_count || 0,
        following: userLegacy?.friends_count || 0,
        bio: userLegacy?.description || userResult?.profile_bio?.description || '',
        tweetText: legacy.full_text || '',
        replyCount: legacy.reply_count || 0,
        retweetCount: legacy.retweet_count || 0,
        likeCount: legacy.favorite_count || 0,
        viewCount: parseInt(tweet.views?.count || '0', 10),
        createdAt: legacy.created_at || '',
        mediaType,
        mediaUrls: extractMedia(legacy),
      };
    };

    const applyApiData = (data: TimelineTweetData) => {
      if (cancelled) return;
      setApiTweetData(data);
      console.log('[ChatPanel] API data applied for tweet:', contextTweetId);

      // Also populate quotedTweetData for UI display
      const createdAt = data.createdAt;
      let displayTime = '';
      if (createdAt) {
        try { displayTime = new Date(createdAt).toLocaleDateString(); }
        catch { displayTime = createdAt; }
      }
      setQuotedTweetData({
        name: data.displayName,
        handle: `@${data.username}`,
        avatar: data.profileImageUrl,
        time: displayTime,
        content: data.tweetText,
        image: data.mediaUrls?.find(m => m.type === 'photo')?.url
          || data.mediaUrls?.find(m => m.thumbnail)?.thumbnail
          || undefined,
        verified: false,
      });
    };

    // Phase 1: Check ApiDataCache immediately
    const cached = apiDataCache.getTweet(contextTweetId);
    if (cached) {
      applyApiData(cached);
      return;
    }

    // Phase 2: Listen for BNBOT_API_DATA messages and parse raw payload directly
    const handleMessage = (event: MessageEvent) => {
      if (event.source !== window || cancelled) return;
      if (event.data?.type !== 'BNBOT_API_DATA' || event.data?.endpoint !== 'tweet_detail') return;

      const rawTweet = findTweetInPayload(event.data.payload, contextTweetId);
      if (rawTweet) {
        const parsed = parseTweetObj(rawTweet);
        if (parsed) {
          applyApiData(parsed);
          cleanup();
        }
      }
    };

    window.addEventListener('message', handleMessage);

    // Timeout after 10s
    const timeout = setTimeout(() => {
      if (cancelled) return;
      console.log('[ChatPanel] API data timeout for tweet:', contextTweetId);
      cleanup();
    }, 10000);

    const cleanup = () => {
      window.removeEventListener('message', handleMessage);
      clearTimeout(timeout);
    };

    return () => {
      cancelled = true;
      cleanup();
    };
  }, [contextTweetId]);

  // Tweet Modal State
  const [tweetModalOpen, setTweetModalOpen] = useState(false);
  const [tweetIds, setTweetIds] = useState<string[]>([]);
  const [tweetDataCache, setTweetDataCache] = useState<Map<string, Tweet>>(new Map());
  const [loadingTweets, setLoadingTweets] = useState(false);
  const [expandedTweets, setExpandedTweets] = useState<Set<string>>(new Set());

  // Close tweet modal on ESC key
  useEffect(() => {
    if (!tweetModalOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setTweetModalOpen(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [tweetModalOpen]);

  // Fetch tweet details when modal opens (for tweets missing stats/time)
  useEffect(() => {
    if (!tweetModalOpen || tweetIds.length === 0) return;

    const fetchMissingTweetDetails = async () => {
      // Find tweets that need fetching (not in cache or missing stats/time)
      const tweetsNeedingFetch = tweetIds.filter(id => {
        const tweet = tweetDataCache.get(id);
        if (!tweet) {
          console.log('[ChatPanel] Tweet not in cache:', id);
          return true; // Not in cache at all
        }
        // Check if stats are all zeros and time is empty (likely incomplete data from KOL tweets)
        const hasNoStats = tweet.stats.replies === '0' && tweet.stats.reposts === '0' &&
          tweet.stats.likes === '0' && tweet.stats.views === '0';
        const hasNoTime = !tweet.time;
        if (hasNoStats && hasNoTime) {
          console.log('[ChatPanel] Tweet missing stats/time:', id);
          return true;
        }
        return false;
      });

      console.log('[ChatPanel] Tweets needing fetch:', tweetsNeedingFetch.length, 'of', tweetIds.length);
      if (tweetsNeedingFetch.length === 0) return;

      setLoadingTweets(true);
      try {
        const result = await chatService.getCachedTweetInfo(tweetsNeedingFetch);
        console.log('[ChatPanel] API result:', result);

        // Handle different response formats
        let tweetsData: any[] = [];
        if (result && Array.isArray(result.data)) {
          tweetsData = result.data;
        } else if (result && result.data && typeof result.data === 'object' && result.data.id_str) {
          // Single tweet object returned
          tweetsData = [result.data];
        } else if (result && Array.isArray(result)) {
          tweetsData = result;
        } else if (result && result.tweets && Array.isArray(result.tweets)) {
          tweetsData = result.tweets;
        }

        if (tweetsData.length > 0) {
          console.log('[ChatPanel] Processing', tweetsData.length, 'tweets from API');
          setTweetDataCache(prev => {
            const newCache = new Map(prev);
            tweetsData.forEach((tweet: any) => {
              // Handle both string and number IDs
              const tweetId = String(tweet.id_str || tweet.id);
              if (tweetId) {
                const existingTweet = newCache.get(tweetId);
                const tweetContent = tweet.text || tweet.full_text || existingTweet?.rawContent || '';
                const isTruncated = tweetContent.length > 150;

                newCache.set(tweetId, {
                  id: tweetId,
                  avatar: tweet.user?.avatar || tweet.user?.profile_image_url_https || tweet.author?.profile_image_url || existingTweet?.avatar || 'https://abs.twimg.com/sticky/default_profile_images/default_profile_400x400.png',
                  name: tweet.user?.name || tweet.author?.name || existingTweet?.name || 'Unknown',
                  handle: tweet.user?.username ? `@${tweet.user.username}` : (tweet.user?.screen_name ? `@${tweet.user.screen_name}` : (existingTweet?.handle || '@unknown')),
                  time: tweet.created_at ? formatTime(tweet.created_at) : (existingTweet?.time || ''),
                  content: isTruncated ? tweetContent.slice(0, 150) + '...' : tweetContent,
                  fullContent: tweetContent,
                  rawContent: tweetContent,
                  isTruncated,
                  verified: tweet.user?.verified || tweet.user?.is_blue_verified || tweet.user?.is_verified || existingTweet?.verified || false,
                  stats: {
                    replies: String(tweet.reply_count ?? tweet.public_metrics?.reply_count ?? existingTweet?.stats.replies ?? 0),
                    reposts: String(tweet.retweet_count ?? tweet.public_metrics?.retweet_count ?? existingTweet?.stats.reposts ?? 0),
                    likes: String(tweet.like_count ?? tweet.favorite_count ?? tweet.public_metrics?.like_count ?? existingTweet?.stats.likes ?? 0),
                    views: String(tweet.view_count ?? tweet.views?.count ?? tweet.public_metrics?.impression_count ?? existingTweet?.stats.views ?? 0),
                  },
                  media: tweet.media?.map((m: any) => ({
                    url: m.media_url_https || m.url,
                    type: m.type || 'photo',
                    thumbnail: m.preview_image_url || m.thumbnail
                  })) || existingTweet?.media || []
                });
                console.log('[ChatPanel] Cached tweet:', tweetId);
              }
            });
            return newCache;
          });
        } else {
          console.log('[ChatPanel] No tweet data in API response');
        }
      } catch (error) {
        console.error('[ChatPanel] Failed to fetch tweet details:', error);
      } finally {
        setLoadingTweets(false);
      }
    };

    fetchMissingTweetDetails();
  }, [tweetModalOpen, tweetIds]);

  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [lastScrollY, setLastScrollY] = useState(0);
  const shouldAutoScrollRef = useRef(true);
  const lastScrollTopRef = useRef(0);
  const isAutoScrollingRef = useRef(false);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      // Reset height to auto to correctly calculate scrollHeight for shrinking
      textareaRef.current.style.height = 'auto';
      const newHeight = Math.min(textareaRef.current.scrollHeight, 120);
      textareaRef.current.style.height = `${Math.max(42, newHeight)}px`;
    }
  }, [input]);

  const [showActions, setShowActions] = useState(true);
  const [isSearchMode, setIsSearchMode] = useState(false);
  const [isComposeMode, setIsComposeMode] = useState(false);
  const [isThreadMode, setIsThreadMode] = useState(false);
  const [isWechatMode, setIsWechatMode] = useState(false);
  const [isTiktokMode, setIsTiktokMode] = useState(false);
  const [isXiaohongshuMode, setIsXiaohongshuMode] = useState(false);
  const [wechatRecreate, setWechatRecreate] = useState(false); // false = 搬运原文, true = 二次创作
  const [xiaohongshuRecreate, setXiaohongshuRecreate] = useState(false); // false = 搬运原文, true = 二次创作
  const [composeType, setComposeType] = useState<'tweet' | 'thread' | 'article'>('tweet');
  const [showComposeDropdown, setShowComposeDropdown] = useState(false);
  const composeDropdownRef = useRef<HTMLDivElement>(null);
  const [useAdvancedSearch, setUseAdvancedSearch] = useState(false);  // 默认关闭，使用浏览器搜索
  const [showComingSoon, setShowComingSoon] = useState(false);

  // AbortController for cancelling pending requests
  const abortControllerRef = useRef<AbortController | null>(null);
  // Current session ID for interruption
  const sessionIdRef = useRef<string | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  // Close compose dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (showComposeDropdown && composeDropdownRef.current) {
        // Use composedPath() for Shadow DOM compatibility
        const path = event.composedPath();
        if (!path.includes(composeDropdownRef.current)) {
          setShowComposeDropdown(false);
        }
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showComposeDropdown]);


  // Scroll logic
  // Handle Esc key to close preview
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && previewImageUrl) {
        setPreviewImageUrl(null);
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [previewImageUrl]);

  const scrollToBottom = () => {
    isAutoScrollingRef.current = true;
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    // Reset the flag after the scroll animation roughly completes
    setTimeout(() => {
      isAutoScrollingRef.current = false;
    }, 500);
  };

  useEffect(() => {
    if (shouldAutoScrollRef.current) {
      scrollToBottom();
    }
  }, [messages.length]);

  // Handle initial message (e.g. from Boost Panel)
  // Wait a bit longer to ensure resetTrigger effect has completed
  useEffect(() => {
    if (initialMessage) {
      // Ensure we wait long enough for any reset operations to complete
      // before attempting to send the initial message
      const timer = setTimeout(() => {
        console.log('[ChatPanel] Sending initial message:', initialMessage.substring(0, 50));
        shouldAutoScrollRef.current = true; // Force scroll for initial message
        // If in context mode, wrap with tweet data so AI has full context
        // Use async version which fetches from Twitter API if interceptor data not available
        if (contextTweetId) {
          buildContextPromptAsync(contextTweetId, apiTweetData, initialMessage).then(hiddenPrompt => {
            handleSubmit(undefined, hiddenPrompt, initialMessage);
            if (onMessageSent) onMessageSent();
          });
          return; // onMessageSent called inside .then()
        } else {
          handleSubmit(undefined, initialMessage);
        }
        if (onMessageSent) {
          onMessageSent();
        }
      }, 300); // Increased from 500 to ensure reset completes first, but reduced to 300 for better UX
      return () => clearTimeout(timer);
    }
  }, [initialMessage]);

  const handleScroll = () => {
    if (scrollContainerRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;

      // Direction detection
      if (onScrollDirectionChange || setShowActions) {
        // If we are auto-scrolling, ignore this scroll event for direction purposes
        if (!isAutoScrollingRef.current) {
          const diff = scrollTop - lastScrollTopRef.current;
          // Ignore small movements or bounces
          if (Math.abs(diff) > 5) {
            const isScrollingDown = diff > 0;
            // Only notify if we are not at the very top (to avoid bouncing)
            if (scrollTop > 0) {
              onScrollDirectionChange && onScrollDirectionChange(isScrollingDown);
              setShowActions(!isScrollingDown);
            } else {
              onScrollDirectionChange && onScrollDirectionChange(false); // Always show header at top
              setShowActions(true);
            }
          }
        }
      }
      lastScrollTopRef.current = scrollTop;

      const isAtBottom = scrollHeight - scrollTop - clientHeight < 100; // Increased threshold for better UX
      shouldAutoScrollRef.current = isAtBottom;

      setShowNewChatBtn(!isAtBottom && messages.length > 0);
      setLastScrollY(scrollTop);
    }
  };

  const handleTweetIdsClick = (ids: string[]) => {
    setTweetIds(ids);
    setTweetModalOpen(true);
  };

  const handleNewChat = () => {
    // Abort any pending request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    // Interrupt backend session if exists
    if (sessionIdRef.current) {
      chatService.interruptThread(sessionIdRef.current);
      sessionIdRef.current = null;
    }

    setMessages([]);
    setInput('');
    setIsLoading(false);
    shouldAutoScrollRef.current = true; // Reset scroll
    contextSentRef.current = false; // Reset context sent flag
    chatService.startNewChat();
  };

  const toggleThinking = (messageId: string) => {
    setMessages(prev => prev.map(msg =>
      msg.id === messageId
        ? { ...msg, isThinkingExpanded: !msg.isThinkingExpanded }
        : msg
    ));
  };


  const getTweetContent = (tweetId: string) => {
    const cached = tweetDataCache.get(tweetId);
    if (cached) return cached.rawContent || '';
    try {
      return (document.querySelector('[data-testid="tweetText"]') as HTMLElement)?.innerText || '';
    } catch (e) {
      return '';
    }
  };

  // Async version: fetch tweet detail from Twitter API if needed
  const buildContextPromptAsync = async (tweetId: string, tweetData: TimelineTweetData | null, query: string): Promise<string> => {
    // Fetch from API if no data, or data exists but missing media/text
    const needsFetch = !tweetData || (!tweetData.tweetText && !tweetData.mediaUrls?.length);
    if (needsFetch) {
      // Try fetching from Twitter GraphQL API
      try {
        const { TwitterClient } = await import('../../utils/TwitterClient');
        const detail = await TwitterClient.fetchTweetDetailFull(tweetId);
        if (detail) {
          const parts = [`[Tweet ID: ${tweetId}]`, `[Tweet Content]`];
          parts.push(`Author: ${detail.mainTweet.author} (${detail.mainTweet.handle})`);

          // Check if it's a thread (same author replies)
          const mainHandle = detail.mainTweet.handle;
          const sameAuthorReplies = detail.threadTweets.filter(t => t.handle === mainHandle);
          const allThreadTweets = [detail.mainTweet, ...sameAuthorReplies];

          if (allThreadTweets.length > 1) {
            parts.push(`Thread (${allThreadTweets.length} tweets):`);
            allThreadTweets.forEach((t, i) => {
              parts.push(`[${i + 1}/${allThreadTweets.length}] ${t.text}`);
              if (t.media?.length) parts.push(`  Media: ${t.media.join(', ')}`);
            });
          } else {
            parts.push(`Content: ${detail.mainTweet.text}`);
            if (detail.mainTweet.media?.length) parts.push(`Media: ${detail.mainTweet.media.join(', ')}`);
          }

          parts.push(`[/Tweet Content]`, '', query);
          return parts.join('\n');
        }
      } catch (err) {
        console.warn('[ChatPanel] TwitterClient fetch failed, falling back to DOM:', err);
      }
    }
    return buildContextPrompt(tweetId, tweetData, query);
  };

  const buildContextPrompt = (tweetId: string, tweetData: TimelineTweetData | null, query: string): string => {
    if (!tweetData) {
      // Fallback: scrape from DOM when API data not available
      // Collect all tweets from the thread (same author's consecutive tweets)
      const articles = document.querySelectorAll('article[data-testid="tweet"]');
      const parts: string[] = [`[Tweet ID: ${tweetId}]`];

      if (articles.length > 0) {
        const mainAuthor = articles[0]?.querySelector('[data-testid="User-Name"] a')?.getAttribute('href')?.replace('/', '') || '';
        const mainUserName = articles[0]?.querySelector('[data-testid="User-Name"]')?.textContent || '';

        // Collect thread tweets (same author as main tweet) + media
        const threadTexts: string[] = [];
        const mediaUrls: string[] = [];
        for (const article of articles) {
          const author = article.querySelector('[data-testid="User-Name"] a')?.getAttribute('href')?.replace('/', '') || '';
          const text = article.querySelector('[data-testid="tweetText"]')?.textContent || '';
          if (text && (author === mainAuthor || threadTexts.length === 0)) {
            threadTexts.push(text);
          }
          // Extract media from DOM (video src, img src)
          if (author === mainAuthor || mediaUrls.length === 0) {
            article.querySelectorAll('video source, video[src]').forEach(v => {
              const src = (v as HTMLElement).getAttribute('src');
              if (src && !src.startsWith('blob:')) mediaUrls.push(`video: ${src}`);
            });
            article.querySelectorAll('[data-testid="tweetPhoto"] img').forEach(img => {
              const src = (img as HTMLImageElement).src;
              if (src && !src.includes('emoji') && !src.includes('profile')) mediaUrls.push(`photo: ${src}`);
            });
          }
        }

        if (threadTexts.length > 0) {
          parts.push(`[Tweet Content]`);
          parts.push(`Author: ${mainUserName}`);
          if (threadTexts.length === 1) {
            parts.push(`Content: ${threadTexts[0]}`);
          } else {
            parts.push(`Thread (${threadTexts.length} tweets):`);
            threadTexts.forEach((t, i) => parts.push(`[${i + 1}/${threadTexts.length}] ${t}`));
          }
          if (mediaUrls.length > 0) {
            parts.push(`Media: ${mediaUrls.join(', ')}`);
          }
          parts.push(`[/Tweet Content]`);
        }
      }

      parts.push('');
      parts.push(query);
      return parts.join('\n');
    }
    const parts = [
      `[Tweet ID: ${tweetId}]`,
      `[Tweet Content]`,
      `Author: ${tweetData.displayName} (@${tweetData.username})`,
      `Content: ${tweetData.tweetText}`,
    ];
    if (tweetData.mediaUrls?.length) {
      parts.push(`Media: ${tweetData.mediaUrls.map(m => `${m.type}: ${m.url}`).join(', ')}`);
    }
    parts.push(`Metrics: ${tweetData.likeCount} likes, ${tweetData.retweetCount} retweets, ${tweetData.replyCount} replies, ${tweetData.viewCount} views`);
    parts.push(`Timestamp: ${tweetData.createdAt}`);
    parts.push(`[/Tweet Content]`);
    parts.push('');
    parts.push(query);
    return parts.join('\n');
  };

  const handleSubmit = async (e?: React.FormEvent, overrideInput?: string, displayText?: string) => {
    if (e) e.preventDefault();
    setInputError(null);

    let textToSend = overrideInput || input;
    let displayContent = displayText || textToSend;

    // Link validation for input modes (only for manual input, not overrideInput)
    if (!overrideInput && input.trim()) {
      const trimmed = input.trim();
      const hasUrl = /https?:\/\//.test(trimmed);

      if (isTiktokMode && !hasUrl && !trimmed.includes('tiktok.com')) {
        setInputError(t.chat.suggestions.invalidTiktokLink);
        setTimeout(() => setInputError(null), 6000);
        return;
      }
      if (isXiaohongshuMode && !trimmed.includes('xiaohongshu.com') && !trimmed.includes('xhslink.com')) {
        setInputError(t.chat.suggestions.invalidXiaohongshuLink);
        setTimeout(() => setInputError(null), 6000);
        return;
      }
      if (isWechatMode && !trimmed.includes('mp.weixin.qq.com')) {
        setInputError(t.chat.suggestions.invalidWechatLink);
        setTimeout(() => setInputError(null), 6000);
        return;
      }
      if (isThreadMode && !trimmed.includes('x.com') && !trimmed.includes('twitter.com')) {
        setInputError(t.chat.suggestions.invalidTweetLink);
        setTimeout(() => setInputError(null), 6000);
        return;
      }
    }

    // Inject Context for Manual Input (only for the FIRST message in context mode)
    // Skip context injection if context has already been sent
    if (contextTweetId && !overrideInput && input.trim() && !contextSentRef.current) {
      textToSend = buildContextPrompt(contextTweetId, apiTweetData, input);
      displayContent = input; // Show what user typed
      contextSentRef.current = true; // Mark context as sent
    }

    if (isSearchMode && !overrideInput) {
      // Append search suffix: use browser (default) or backend API
      const searchSuffix = useAdvancedSearch ? '（用后端 API 搜索）' : ' (use browser)';
      textToSend = t.chat.suggestions.searchQuery + input + searchSuffix;
      displayContent = t.chat.suggestions.searchQuery + input;  // 显示时不带后缀
    }

    if (isComposeMode && !overrideInput) {
      // Add compose type suffix in parentheses
      const composeSuffix = composeType === 'tweet'
        ? ' (tweet)'
        : composeType === 'thread'
          ? ' (thread, 3-5 tweets)'
          : ' (long-form article)';
      textToSend = input + composeSuffix;
      displayContent = textToSend;
    }

    if (isThreadMode && !overrideInput) {
      textToSend = t.chat.suggestions.threadSummaryQuery + ' ' + input;
      displayContent = textToSend;
    }

    if (isWechatMode && !overrideInput) {
      const wechatQuery = wechatRecreate
        ? t.chat.suggestions.wechatRecreateQuery
        : t.chat.suggestions.wechatOriginalQuery;
      textToSend = wechatQuery + ' ' + input;
      displayContent = textToSend;
    }

    if (isTiktokMode && !overrideInput) {
      textToSend = t.chat.suggestions.tiktokRepostQuery + ' ' + input;
      displayContent = textToSend;
    }

    if (isXiaohongshuMode && !overrideInput) {
      // 跟微信/TikTok 一样，只发链接给后端，由 orchestrator 通过 x_action 抓取
      textToSend = t.chat.suggestions.xiaohongshuRepostQuery + ' ' + input;
      displayContent = textToSend;
    }

    if (quotedText && !overrideInput) {
      // If we have quoted text, prepend/append it or format it
      // Based on user request "Draft a quote tweet for..." replacement
      textToSend = `Draft a quote tweet for: "${quotedText}"\n\nContext/User Input: ${input}`;
      displayContent = textToSend; // Using textToSend as display for quoted text logic for now, or keep as is.
      // Actually existing logic used textToSend for everything. 
      // If we are injecting context, we want displayContent to be clean.
      setQuotedText(null); // Clear after sending
    }

    if (!textToSend.trim() || isLoading) return;

    // Mark context as sent if overrideInput contains Tweet ID (from action buttons)
    if (overrideInput && overrideInput.includes('[Tweet ID:') && contextTweetId) {
      contextSentRef.current = true;
    }

    const imagesToSend = !overrideInput ? selectedImages : undefined;
    const filesToSend = !overrideInput ? selectedFiles.map(f => ({
      data: f.data,
      mime_type: f.type,
      filename: f.name
    })) : undefined;

    if (!overrideInput) {
      setInput('');
      setSelectedImages([]);
      setSelectedFiles([]);
      if (isSearchMode) {
        setIsSearchMode(false);
      }
      if (isComposeMode) {
        setIsComposeMode(false);
        setShowComposeDropdown(false);
      }
      if (isThreadMode) {
        setIsThreadMode(false);
      }
      if (isWechatMode) {
        setIsWechatMode(false);
      }
      if (isTiktokMode) {
        setIsTiktokMode(false);
      }
      if (isXiaohongshuMode) {
        setIsXiaohongshuMode(false);
      }
    }

    shouldAutoScrollRef.current = true; // Force scroll tracking on new message

    // Use displayText if provided, otherwise use textToSend
    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      text: displayContent,
      role: 'user',
      attachedImages: imagesToSend,
      attachedFiles: filesToSend && filesToSend.length > 0 ? selectedFiles : undefined,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMsg]);
    setIsLoading(true);

    // Placeholder for new bot message
    const botMsgId = (Date.now() + 1).toString();
    const botMsg: ChatMessage = {
      id: botMsgId,
      text: '',
      role: 'model',
      timestamp: new Date(),
      reasoning: '',
      isThinkingExpanded: true
    };

    setMessages(prev => [...prev, botMsg]);

    // Abort previous request if any
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    // Interrupt backend session if exists
    if (sessionIdRef.current) {
      chatService.interruptThread(sessionIdRef.current);
    }
    // Create new controller for this request
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      const user = await authService.getUser();

      let currentText = '';
      let currentReasoning = '';

      // Reset session ID
      sessionIdRef.current = null;

      await chatService.sendMessageStream(textToSend, {
        onSessionStart: (sessionId) => {
          sessionIdRef.current = sessionId;
          console.log("[ChatPanel] Session started:", sessionId);
        },
        onModelStart: (name) => {
          console.log("[ChatPanel] Model start:", name, "botMsgId:", botMsgId);
          // Show thinking indicator when model starts processing
          setMessages(prev => {
            console.log("[ChatPanel] Setting reasoning for model start, messages count:", prev?.length);
            return (prev || []).map(msg =>
              msg.id === botMsgId ? { ...msg, reasoning: msg.reasoning || ' ' } : msg
            );
          });
        },
        onContent: (chunk) => {
          currentText += chunk;
          setMessages(prev => (prev || []).map(msg =>
            msg.id === botMsgId ? { ...msg, text: currentText } : msg
          ));
        },
        onReasoning: (chunk) => {
          currentReasoning += chunk;
          setMessages(prev => (prev || []).map(msg =>
            msg.id === botMsgId ? { ...msg, reasoning: currentReasoning } : msg
          ));
        },
        onToolCall: (name, args) => {
          console.log("[ChatPanel] Tool call/start received:", name, args);
          if (name === 'generate_image') {
            console.log("[ChatPanel] Setting isGeneratingImage to true");
            setMessages(prev => (prev || []).map(msg =>
              msg.id === botMsgId ? { ...msg, isGeneratingImage: true } : msg
            ));
          }
          // Handle classify_intent node start to show thinking indicator immediately
          if (name === 'classify_intent') {
            setMessages(prev => (prev || []).map(msg =>
              msg.id === botMsgId ? { ...msg, reasoning: ' ' } : msg
            ));
          }
        },
        onActionCall: (actionId, args, callId) => {
          // Handle x_action_ tool call from backend AI
          console.log("[ChatPanel] x_action_ tool call received:", actionId, args, "callId:", callId);

          // Skip interrupt actions - they will be handled by onInterrupt via /resume
          if (INTERRUPT_ACTIONS.includes(actionId as any)) {
            console.log("[ChatPanel] Skipping interrupt action in onActionCall, will be handled by onInterrupt:", actionId);
            return;
          }

          setMessages(prev => (prev || []).map(msg =>
            msg.id === botMsgId ? { ...msg, actionInProgress: actionId, actionStatus: '正在执行...' } : msg
          ));

          // Execute the action asynchronously (for non-interrupt actions like navigate_to_*, fill_reply_text, etc.)
          executeAction(`action_${actionId}`, args as Record<string, unknown>, {
            onProgress: (message) => {
              setMessages(prev => (prev || []).map(msg =>
                msg.id === botMsgId ? { ...msg, actionStatus: message } : msg
              ));
            },
            onComplete: async (result) => {
              console.log("[ChatPanel] Action complete:", actionId, result);
              setMessages(prev => (prev || []).map(msg =>
                msg.id === botMsgId ? { ...msg, actionInProgress: undefined, actionStatus: undefined, actionResult: result } : msg
              ));
              // Non-interrupt actions don't need to send results back
            },
            onError: async (error) => {
              console.error("[ChatPanel] Action error:", actionId, error);
              setMessages(prev => (prev || []).map(msg =>
                msg.id === botMsgId ? { ...msg, actionInProgress: undefined, actionStatus: undefined, actionError: error } : msg
              ));
            },
          });
        },
        onInterrupt: (actionType, actionInput, threadId) => {
          // Handle interrupt event for data collection actions (new flow)
          // SSE stream has closed, we execute the action and then call resumeGraph()
          console.log("[ChatPanel] Interrupt received:", actionType, "threadId:", threadId, "input:", actionInput);
          setMessages(prev => (prev || []).map(msg =>
            msg.id === botMsgId ? { ...msg, actionInProgress: actionType, actionStatus: '正在执行...' } : msg
          ));

          // Execute the action asynchronously
          executeAction(`action_${actionType}`, actionInput as Record<string, unknown>, {
            onProgress: (message) => {
              setMessages(prev => (prev || []).map(msg =>
                msg.id === botMsgId ? { ...msg, actionStatus: message } : msg
              ));
            },
            onComplete: async (result) => {
              console.log("[ChatPanel] Interrupt action complete:", actionType, "result:", result);
              setMessages(prev => (prev || []).map(msg =>
                msg.id === botMsgId ? { ...msg, actionInProgress: undefined, actionStatus: undefined, actionResult: result } : msg
              ));

              // Continue updating the same bot message instead of creating a new one
              let continuedText = currentText;
              let continuedReasoning = currentReasoning;

              try {
                // Resume the graph with the action result
                await chatService.resumeGraph(
                  threadId,
                  true,
                  result,
                  null,
                  {
                    onContent: (chunk) => {
                      continuedText += chunk;
                      setMessages(prev => (prev || []).map(msg =>
                        msg.id === botMsgId ? { ...msg, text: continuedText } : msg
                      ));
                    },
                    onReasoning: (chunk) => {
                      continuedReasoning += chunk;
                      setMessages(prev => (prev || []).map(msg =>
                        msg.id === botMsgId ? { ...msg, reasoning: continuedReasoning } : msg
                      ));
                    },
                    onToolCall: () => { },
                    onToolResult: () => { },
                    onInterrupt: (_nestedActionType, _nestedActionInput, _nestedThreadId) => {
                      // Handle nested interrupt recursively
                      console.log("[ChatPanel] Nested interrupt received:", _nestedActionType);
                      // The onInterrupt handler will be called again by handleEvent
                    },
                    onComplete: () => {
                      console.log("[ChatPanel] Resume response complete");
                      setIsLoading(false);
                    },
                    onError: (error) => {
                      console.error("[ChatPanel] Resume response error:", error);
                      setMessages(prev => (prev || []).map(msg =>
                        msg.id === botMsgId ? { ...msg, text: continuedText + `\n\nError: ${error.message}` } : msg
                      ));
                      setIsLoading(false);
                    }
                  },
                  abortControllerRef.current?.signal
                );
              } catch (err) {
                console.error("[ChatPanel] Failed to resume graph:", err);
                setMessages(prev => (prev || []).map(msg =>
                  msg.id === botMsgId ? { ...msg, text: currentText + `\n\nError resuming: ${err}` } : msg
                ));
                setIsLoading(false);
              }
            },
            onError: async (error) => {
              console.error("[ChatPanel] Interrupt action error:", actionType, error);
              setMessages(prev => (prev || []).map(msg =>
                msg.id === botMsgId ? { ...msg, actionInProgress: undefined, actionStatus: undefined, actionError: error } : msg
              ));

              // Resume with error - continue updating the same message
              let continuedText = currentText;

              try {
                await chatService.resumeGraph(
                  threadId,
                  false,
                  null,
                  String(error),
                  {
                    onContent: (chunk) => {
                      continuedText += chunk;
                      setMessages(prev => (prev || []).map(msg =>
                        msg.id === botMsgId ? { ...msg, text: continuedText } : msg
                      ));
                    },
                    onReasoning: () => { },
                    onToolCall: () => { },
                    onToolResult: () => { },
                    onComplete: () => setIsLoading(false),
                    onError: () => setIsLoading(false)
                  },
                  abortControllerRef.current?.signal
                );
              } catch (err) {
                console.error("[ChatPanel] Failed to resume graph with error:", err);
                setIsLoading(false);
              }
            },
          });
        },
        onToolResult: (name, result) => {
          console.log("[ChatPanel] Tool result:", name, result);
        },
        onToolEnd: (name, artifact) => {
          console.log("[ChatPanel] Tool end received:", name, "artifact length:", typeof artifact === 'string' ? artifact.length : JSON.stringify(artifact).length);
          if (name === 'generate_image') {
            // Handle the image generation result
            if (artifact && artifact.success && artifact.data && Array.isArray(artifact.data) && artifact.data.length > 0) {
              const imageData = artifact.data[0];
              const b64Json = imageData.b64_json;
              // Use mime_type from response if available, default to image/png
              const mimeType = imageData.mime_type || 'image/png';

              if (b64Json) {
                console.log("[ChatPanel] Valid image data received, mime_type:", mimeType, "b64 length:", b64Json.length);
                // Store the generated image as a data URL directly in the message
                const imageUrl = `data:${mimeType};base64,${b64Json}`;
                setMessages(prev => (prev || []).map(msg =>
                  msg.id === botMsgId ? {
                    ...msg,
                    generatedImage: imageUrl,
                    isGeneratingImage: false
                  } : msg
                ));
              } else {
                console.warn("[ChatPanel] b64_json missing in artifact.data[0]:", imageData);
                setMessages(prev => (prev || []).map(msg =>
                  msg.id === botMsgId ? { ...msg, isGeneratingImage: false } : msg
                ));
              }
            } else {
              console.warn("[ChatPanel] Invalid artifact structure for generate_image:", artifact);
              // Handle case where filtering failed or no data
              setMessages(prev => (prev || []).map(msg =>
                msg.id === botMsgId ? { ...msg, isGeneratingImage: false } : msg
              ));
            }
          } else if (name === 'search_tweets' || name === 'get_tweet' || name === 'get_tweets') {
            // Handle standard tweet search results - cache the tweet data
            if (artifact && artifact.success && artifact.data && Array.isArray(artifact.data)) {
              console.log("[ChatPanel] Caching tweet data (standard):", artifact.data.length, "tweets");
              setTweetDataCache(prev => {
                const newCache = new Map(prev);
                artifact.data.forEach((tweet: any) => {
                  if (tweet.id) {
                    const tweetContent = tweet.text || tweet.content || '';
                    const isTruncated = tweetContent.length > 150;
                    newCache.set(tweet.id, {
                      id: tweet.id,
                      avatar: tweet.author?.profile_image_url || tweet.avatar || 'https://abs.twimg.com/sticky/default_profile_images/default_profile_400x400.png',
                      name: tweet.author?.name || tweet.name || 'Unknown',
                      handle: tweet.author?.username ? `@${tweet.author.username}` : (tweet.handle || '@unknown'),
                      time: tweet.created_at ? new Date(tweet.created_at).toLocaleDateString() : (tweet.time || ''),
                      content: isTruncated ? tweetContent.slice(0, 150) + '...' : tweetContent,
                      fullContent: tweetContent,
                      rawContent: tweetContent,
                      isTruncated,
                      verified: tweet.author?.verified || tweet.verified || false,
                      stats: {
                        replies: String(tweet.public_metrics?.reply_count || tweet.stats?.replies || 0),
                        reposts: String(tweet.public_metrics?.retweet_count || tweet.stats?.reposts || 0),
                        likes: String(tweet.public_metrics?.like_count || tweet.stats?.likes || 0),
                        views: String(tweet.public_metrics?.impression_count || tweet.stats?.views || 0),
                      },
                      media: tweet.media?.map((m: any) => ({
                        url: m.url || m.preview_image_url,
                        type: m.type || 'photo',
                        thumbnail: m.preview_image_url
                      })) || []
                    });
                  }
                });
                return newCache;
              });
            }
          } else if (name === 'search_on_x') {
            // Handle search_on_x results
            // Output format: { code: 1, data: [ ...tweets ] }
            let data = artifact.data;
            if (!data && artifact.output) {
              try {
                const parsed = JSON.parse(artifact.output);
                if (parsed.code === 1) data = parsed.data;
              } catch (e) { console.error("Failed to parse search_on_x output", e); }
            }

            // If artifact itself mimics the structure (agentService usually parses JSON)
            if (!data && artifact.code === 1 && Array.isArray(artifact.data)) {
              data = artifact.data;
            }

            if (Array.isArray(data)) {
              // Filter out invalid tweets (null id_str)
              const validTweets = data.filter((tweet: any) => tweet.id_str || tweet.id);
              console.log("[ChatPanel] Caching tweet data (search_on_x):", validTweets.length, "valid tweets of", data.length);
              setTweetDataCache(prev => {
                const newCache = new Map(prev);
                validTweets.forEach((tweet: any) => {
                  const tweetId = String(tweet.id_str || tweet.id);
                  const tweetContent = tweet.text || '';
                  const isTruncated = tweetContent.length > 150;
                  newCache.set(tweetId, {
                    id: tweetId,
                    avatar: tweet.user?.avatar || tweet.user?.profile_image_url_https || 'https://abs.twimg.com/sticky/default_profile_images/default_profile_400x400.png',
                    name: tweet.user?.name || 'Unknown',
                    handle: tweet.user?.username ? `@${tweet.user.username}` : (tweet.user?.screen_name ? `@${tweet.user.screen_name}` : '@unknown'),
                    time: (tweet.created_at || tweet.date) ? formatTime(tweet.created_at || tweet.date) : '',
                    content: isTruncated ? tweetContent.slice(0, 150) + '...' : tweetContent,
                    fullContent: tweetContent,
                    rawContent: tweetContent,
                    isTruncated,
                    verified: tweet.user?.is_verified || tweet.user?.verified || false,
                    stats: {
                      replies: String(tweet.reply_count ?? tweet.public_metrics?.reply_count ?? 0),
                      reposts: String(tweet.retweet_count ?? tweet.public_metrics?.retweet_count ?? 0),
                      likes: String(tweet.like_count ?? tweet.favorite_count ?? tweet.public_metrics?.like_count ?? 0),
                      views: String(tweet.view_count ?? tweet.public_metrics?.impression_count ?? 0),
                    },
                    media: tweet.media?.map((m: any) => ({
                      url: m.url,
                      type: m.type || 'photo',
                      thumbnail: m.thumbnail
                    })) || []
                  });
                  console.log("[ChatPanel] Cached search_on_x tweet:", tweetId, tweet.user?.name);
                });
                return newCache;
              });
            }
          } else if (name === 'get_crypto_kol_tweets') {
            // Handle get_crypto_kol_tweets results
            // Format: @Handle(Name):ID|Content;...
            const outputString = typeof artifact === 'string' ? artifact : artifact?.output || '';
            console.log("[ChatPanel] Processing KOL tweets...", outputString.length);

            if (outputString && typeof outputString === 'string') {
              // 1. Extract IDs first to fetch full data
              const tweetIds: string[] = [];
              const segments = outputString.split(';');

              segments.forEach(segment => {
                if (!segment.trim()) return;
                const match = segment.match(/:(\d+)\|/) || segment.match(/^(\d+)\|/);
                if (match && match[1]) {
                  tweetIds.push(match[1]);
                }
              });

              if (tweetIds.length > 0) {
                // Removed aggressive fetching. Rely on basic parsing for initial display.
                // Full data will be fetched when modal is opened (lazy loading).
                console.log("[ChatPanel] Basic parsing for KOL tweets (lazy load details later)");

                const parsedTweets: Tweet[] = [];
                let lastHandle = '@unknown';
                let lastName = 'Unknown';

                segments.forEach(segment => {
                  if (!segment.trim()) return;
                  const complexMatch = segment.match(/@([^\(]+)\(([^)]+)\):(\d+)\|(.+)/);
                  const simpleMatch = segment.match(/(\d+)\|(.+)/);

                  let id = '';
                  let content = '';
                  let handle = '@unknown';
                  let name = 'Unknown';

                  if (complexMatch) {
                    handle = '@' + complexMatch[1];
                    name = complexMatch[2];
                    id = complexMatch[3];
                    content = complexMatch[4];
                    lastHandle = handle;
                    lastName = name;
                  } else if (simpleMatch) {
                    id = simpleMatch[1];
                    content = simpleMatch[2];
                    handle = lastHandle;
                    name = lastName;
                  }

                  if (id) {
                    const isTruncated = content.length > 150;
                    const avatarUrl = handle !== '@unknown'
                      ? `https://unavatar.io/twitter/${handle.replace('@', '')}`
                      : 'https://abs.twimg.com/sticky/default_profile_images/default_profile_400x400.png';

                    parsedTweets.push({
                      id,
                      avatar: avatarUrl,
                      name,
                      handle,
                      time: '',
                      content: isTruncated ? content.slice(0, 150) + '...' : content,
                      fullContent: content,
                      rawContent: content,
                      isTruncated,
                      verified: false,
                      stats: { replies: '0', reposts: '0', likes: '0', views: '0' },
                      media: []
                    });
                  }
                });

                setTweetDataCache(prev => {
                  const newCache = new Map(prev);
                  parsedTweets.forEach(t => newCache.set(t.id, t));
                  return newCache;
                });
              }
            }
          }
        },
        onComplete: () => {
          // Don't close loading if there's an action in progress
          // The action callback will handle loading state
          setMessages(prev => {
            const currentBotMsg = prev.find(msg => msg.id === botMsgId);
            if ((currentBotMsg as any)?.actionInProgress) {
              // Action is in progress, keep loading state
              console.log("[ChatPanel] onComplete: action in progress, keeping loading state");
              return prev;
            }

            // Check for Xiaohongshu media data and attach to message
            const xhsMedia = (window as any).__bnbotXiaohongshuMedia;
            if (xhsMedia && (xhsMedia.images?.length > 0 || xhsMedia.video)) {
              console.log("[ChatPanel] Attaching Xiaohongshu media to message:", xhsMedia);
              // Clear the global data after use
              delete (window as any).__bnbotXiaohongshuMedia;

              // Also close loading
              setIsLoading(false);
              abortControllerRef.current = null;

              return prev.map(msg => {
                if (msg.id === botMsgId) {
                  return {
                    ...msg,
                    xiaohongshuData: xhsMedia
                  } as any;
                }
                return msg;
              });
            }

            // No action in progress, safe to close loading
            setIsLoading(false);
            abortControllerRef.current = null;
            return prev;
          });
        },
        onError: (error) => {
          // Ignore abort errors
          if (error.name === 'AbortError') {
            console.log('Request aborted');
            return;
          }

          console.error("Stream error:", error);
          setIsLoading(false);
          abortControllerRef.current = null;

          // Update the existing bot message based on error type
          const errorStatus = (error as any)?.status;
          const errorMessage = error?.message || '';
          let errorText = "Sorry, I encountered an error.";
          let shouldShowLogin = false;

          if (errorStatus === 429) {
            errorText = t.chat.loginToContinue || "Please login to continue.";
            shouldShowLogin = true;
          } else if (errorStatus === 402) {
            errorText = t.chat.insufficientCredits || "Insufficient credits. Please recharge your account.";
          } else if (errorStatus === 401 || errorMessage.includes('Could not validate credentials')) {
            // Session expired or invalid credentials - save message and prompt login
            errorText = t.chat.sessionExpired || "Session expired. Please login again.";
            shouldShowLogin = true;
          }

          // Save pending message for retry after login
          if (shouldShowLogin) {
            pendingMessageRef.current = {
              text: textToSend,
              images: imagesToSend || undefined,
              files: filesToSend || undefined
            };
            // Trigger login modal
            if (onLoginClick) {
              onLoginClick();
            }
          }

          setMessages(prev => (prev || []).map(msg =>
            msg.id === botMsgId
              ? { ...msg, text: errorText, errorStatus: errorStatus || (errorMessage.includes('credentials') ? 401 : undefined), isGeneratingImage: false }
              : msg
          ));
        }
      }, abortController.signal, imagesToSend || undefined, filesToSend && filesToSend.length > 0 ? filesToSend : undefined);

    } catch (e: any) {
      if (e.name === 'AbortError') return;

      console.error("Submit error:", e);
      setIsLoading(false);
      abortControllerRef.current = null;
      setMessages(prev => (prev || []).map(msg =>
        msg.id === botMsgId ? { ...msg, text: "[Error: Failed to send message]" } : msg
      ));
    }
  };

  const handleRegenerate = async (messageId: string) => {
    // Simplified regenerate: just take the message before this one (user's) and resubmit
    const msgIndex = messages.findIndex(m => m.id === messageId);
    if (msgIndex <= 0) return;

    const previousMsg = messages[msgIndex - 1];
    if (previousMsg.role === 'user') {
      // Remove both the user message and the bot message
      // handleSubmit will re-add the user message
      setMessages(prev => (prev || []).slice(0, msgIndex - 1));
      // Resubmit
      handleSubmit(undefined, previousMsg.text);
    }
  };

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: 'var(--bg-primary)', position: 'relative' }}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >

      {/* Floating New Chat Button */}
      {messages.length > 0 && (
        <div
          className={`absolute top-1 left-2 z-20 transition-all duration-300 transform ${showActions ? 'translate-y-0 opacity-100' : '-translate-y-10 opacity-0 pointer-events-none'
            }`}
        >
          <button
            onClick={handleNewChat}
            className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] p-2 rounded-full cursor-pointer transition-all active:scale-95 group flex items-center justify-center shadow-none hover:shadow-none"
            title={t.chat.newChat}
          >
            <Pen size={18} className="transition-colors" />
          </button>
        </div>
      )}

      {/* Main Chat Area Wrapper */}
      <div style={{ flex: 1, position: 'relative', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {/* Drag Overlay */}
        {isDragging && (
          <div className="absolute inset-x-0 bottom-0 h-[30vh] z-50 flex items-center justify-center bg-[var(--bg-primary)]/95 border border-dashed border-[var(--accent-color)] rounded-t-3xl animate-in slide-in-from-bottom duration-200 shadow-[0_-8px_30px_rgba(0,0,0,0.12)]">
            <div className="flex flex-col items-center justify-center gap-3 animate-in zoom-in-95 duration-200">
              <div className="p-3 rounded-full bg-[var(--accent-color)]/10 animate-bounce">
                <Image size={32} className="text-[var(--accent-color)]" strokeWidth={1.5} />
              </div>
              <div className="text-center">
                <h3 className="text-lg font-bold text-[var(--text-primary)]">Drop to Upload</h3>
                <p className="text-sm text-[var(--text-secondary)]">Release your image here</p>
              </div>
            </div>
          </div>
        )}

        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}
        >
          <TextSelectionPopover
            containerRef={scrollContainerRef}
            onExplain={(text) => handleSubmit(undefined, `Explain: "${text}"`)}
            onDeepDive={(text) => handleSubmit(undefined, `Deep dive into: "${text}"`)}
            onQuote={(text) => {
              setQuotedText(text);
              // Focus input?
              const inputEl = document.querySelector('input[type="text"]') as HTMLInputElement;
              if (inputEl) inputEl.focus();
            }}
          />

          {/* Spacer for Overlay Header - Only needed in Tweet Context Mode with overlay header */}
          {contextTweetId && !hideHeaderSpacer && <div className="h-[57px] w-full shrink-0" />}

          {messages.length === 0 ? (
            <div data-welcome-page="true" style={{ flex: 1, display: 'flex', flexDirection: 'column', paddingLeft: '16px', paddingRight: '16px', paddingBottom: 0, userSelect: 'none' }}>
              {!contextTweetId && ( /* Welcome Hero - Hide if in context mode */
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '16px', marginTop: '-40px' }}>
                  <div className="space-y-1 text-center">
                    <h2 className="text-2xl font-black text-[var(--text-primary)] tracking-tight">
                      {t.chat.greeting} <img src={chrome.runtime?.getURL?.('assets/images/bnbot-rounded-logo-5.png') || ''} style={{ width: 28, height: 28, display: 'inline-block', verticalAlign: 'middle' }} alt="BNBot" /> {t.chat.imBNBot} <span className="text-[var(--accent-color)]">{t.chat.bnbotName}</span>
                    </h2>
                    <p className="text-sm text-[var(--text-secondary)] font-medium">
                      {t.chat.tagline}
                    </p>
                  </div>

                  {/* Quick Start */}
                  <div style={{ width: '100%', paddingBottom: '8px' }}>
                    {/* Terminal card - theme aware */}
                    <div style={{
                      backgroundColor: 'var(--bg-secondary)',
                      borderRadius: '12px',
                      overflow: 'hidden',
                      border: '1px solid var(--border-color)',
                    }}>
                      {/* Terminal header */}
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '10px 14px',
                        borderBottom: '1px solid var(--border-color)',
                      }}>
                        <div style={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: '#FF5F56' }} />
                        <div style={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: '#FFBD2E' }} />
                        <div style={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: '#27C93F' }} />
                        <span style={{ marginLeft: 'auto', fontSize: '10px', color: 'var(--text-secondary)', fontFamily: 'monospace' }}>Quick Start</span>
                      </div>
                      {/* Terminal body */}
                      <div style={{ padding: '14px' }}>
                        <p style={{ fontSize: '10px', color: 'var(--text-secondary)', fontFamily: 'monospace', marginBottom: '10px' }}>
                          # Works with Claude Code, Codex, Gemini CLI...
                        </p>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                          <code style={{ fontSize: '13px', fontFamily: 'monospace', color: 'var(--text-primary)' }}>
                            <span style={{ color: 'var(--accent-color)' }}>$ </span>npx @bnbot/cli setup
                          </code>
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText('npx @bnbot/cli setup');
                              const btn = document.getElementById('bnbot-copy-btn');
                              if (btn) { btn.textContent = '✓'; setTimeout(() => { btn.textContent = 'Copy'; }, 1500); }
                            }}
                            id="bnbot-copy-btn"
                            style={{
                              fontSize: '10px',
                              fontFamily: 'monospace',
                              color: 'var(--text-secondary)',
                              backgroundColor: 'var(--bg-primary)',
                              border: '1px solid var(--border-color)',
                              borderRadius: '6px',
                              padding: '3px 10px',
                              cursor: 'pointer',
                              flexShrink: 0,
                            }}
                          >Copy</button>
                        </div>
                      </div>
                    </div>

                    {/* Feature highlights */}
                    <div style={{ marginTop: '12px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                      {[
                        { icon: '🔍', text: '30+ Platform Trends' },
                        { icon: '✍️', text: 'AI Tweet Creation' },
                        { icon: '🔄', text: 'Cross-platform Repost' },
                        { icon: '🤖', text: 'Auto Reply & Engage' },
                        { icon: '📊', text: 'X Analytics' },
                        { icon: '📅', text: 'Schedule & Publish' },
                      ].map((f, i) => (
                        <div key={i} style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          padding: '8px 10px',
                          backgroundColor: 'var(--bg-secondary)',
                          border: '1px solid var(--border-color)',
                          borderRadius: '10px',
                          fontSize: '10px',
                          color: 'var(--text-secondary)',
                        }}>
                          <span style={{ fontSize: '12px' }}>{f.icon}</span>
                          <span style={{ fontWeight: 500 }}>{f.text}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Context hero / action grid removed — reply / image-reply / quote / analyze / summary
                  等 AI 写+读入口全部迁移到桌面 agent (/reply /quote /remix skill)。 */}

              {/* Standard Suggestions - Hide if in context mode */}
            </div>
          ) : (
            <div className="flex flex-col bg-transparent relative px-4 py-2 gap-2">
              <PromptPickerModal
                isOpen={isPickerOpen}
                onClose={() => setIsPickerOpen(false)}
                onSelect={(prompt) => {
                  setInput(prompt);
                  // Optionally focus textarea
                  setTimeout(() => {
                    const textarea = document.querySelector('textarea');
                    if (textarea) textarea.focus();
                  }, 100);
                }}
              />
              {messages.map((msg, index) => (
                <div
                  key={msg.id}
                  className={`flex w-full ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  {msg.role === 'user' ? (
                    <div data-user-message="true" className="max-w-[85%] rounded-[20px] px-4 py-2 bg-[var(--bg-secondary)] text-[var(--text-primary)] text-sm leading-relaxed whitespace-pre-wrap break-all">
                      {(msg.attachedImages && msg.attachedImages.length > 0) || msg.attachedImage ? (
                        <div className={`mb-2 grid gap-1.5 w-full ${(msg.attachedImages?.length === 2) ? 'grid-cols-2 aspect-[2/1]' :
                          (msg.attachedImages?.length === 3) ? 'grid-cols-2 aspect-square' :
                            (msg.attachedImages?.length && msg.attachedImages.length >= 4) ? 'grid-cols-2 aspect-square' :
                              'grid-cols-1'
                          }`}>
                          {msg.attachedImages && msg.attachedImages.length > 0 ? (
                            msg.attachedImages.map((img, idx) => (
                              <div
                                key={idx}
                                className={`relative overflow-hidden rounded-lg bg-black/5 ${msg.attachedImages!.length === 3 && idx === 0 ? 'row-span-2 h-full' : ''
                                  } ${msg.attachedImages!.length === 1 ? 'max-h-60 w-auto inline-block' : 'h-full w-full'
                                  }`}
                              >
                                <img
                                  src={img}
                                  className={`cursor-pointer hover:opacity-95 transition-opacity ${msg.attachedImages!.length === 1
                                    ? 'max-h-60 w-auto max-w-full object-contain'
                                    : 'absolute inset-0 h-full w-full object-cover'
                                    }`}
                                  onClick={() => setPreviewImageUrl(img)}
                                  alt={`Attachment ${idx + 1}`}
                                />
                              </div>
                            ))
                          ) : (
                            msg.attachedImage && (
                              <div className="rounded-lg overflow-hidden max-h-60 w-auto inline-block">
                                <img
                                  src={msg.attachedImage}
                                  className="max-h-60 w-auto object-contain cursor-pointer hover:opacity-95 transition-opacity"
                                  onClick={() => setPreviewImageUrl(msg.attachedImage || null)}
                                  alt="Attachment"
                                />
                              </div>
                            )
                          )}
                        </div>
                      ) : null}
                      {msg.attachedFiles && msg.attachedFiles.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mb-2">
                          {msg.attachedFiles.map((file, idx) => (
                            <div key={idx} className="inline-flex items-center gap-1.5 px-2 py-1 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg">
                              <FileText size={14} className="text-[var(--accent-color)] flex-shrink-0" />
                              <span className="text-xs text-[var(--text-primary)] max-w-[100px] truncate" title={file.name}>
                                {file.name}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                      {filterInternalJson(msg.text) && renderTextWithLinks(filterInternalJson(msg.text), { openInNewTab: true })}
                    </div>
                  ) : (

                    <div className="max-w-[96%] w-full pl-1">
                      {/* Thinking/Reasoning Section */}
                      {/* Show title/loading when streaming, show content box only when has content */}
                      {(msg.reasoning?.trim() || (isLoading && index === messages.length - 1)) && (
                        <ThinkingSection
                          reasoning={msg.reasoning}
                          isExpanded={msg.isThinkingExpanded || false}
                          onToggle={() => toggleThinking(msg.id)}
                          isStreaming={isLoading && index === messages.length - 1}
                          thoughtProcessLabel={t.chat.thoughtProcess}
                        />
                      )}

                      {/* Main Content or Draft Card */}
                      {(() => {


                        const repairJsonString = (str: string): string => {
                          // Fix unescaped quotes in ANY string field
                          // Generic: "key": "value..." -> looks for "string": "string" structure
                          // We use a lookahead to ensure we DO NOT Consume the next key or end of object
                          return str.replace(
                            /("[^"]+"\s*:\s*")([\s\S]*?)(")(?=\s*(?:,\s*"[^"]+"|\s*}))/g,
                            (_match, prefix, content, quote) => {
                              // Check for trailing odd backslashes which would escape the closing quote
                              let backslashCount = 0;
                              for (let i = content.length - 1; i >= 0; i--) {
                                if (content[i] === '\\') backslashCount++;
                                else break;
                              }

                              // If odd backslashes at the end, the last one is escaping the quote. 
                              // We should remove it to fix the JSON structure.
                              if (backslashCount % 2 === 1) {
                                content = content.slice(0, -1);
                              }

                              // Temporarily hide escaped quotes
                              const placeholder = '___ESCAPED_QUOTE___';
                              const masked = content.split('\\"').join(placeholder);
                              // Escape remaining unescaped quotes
                              const escaped = masked.split('"').join('\\"');
                              // Restore escaped quotes
                              return prefix + escaped.split(placeholder).join('\\"') + quote;
                            }
                          );
                        };

                        // Helper to sanitize JSON string - escape unescaped newlines/tabs in string values
                        const sanitizeJsonString = (jsonStr: string): string => {
                          // First apply specific structural repairs
                          const repaired = repairJsonString(jsonStr);

                          let result = '';
                          let inString = false;
                          let backslashCount = 0;

                          for (let i = 0; i < repaired.length; i++) {
                            const char = repaired[i];

                            if (char === '\\') {
                              backslashCount++;
                              result += char;
                              continue;
                            }

                            // If we are seeing a non-backslash char, check if it's a quote
                            if (char === '"') {
                              // A quote is escaped if preceded by an odd number of backslashes
                              const isEscaped = backslashCount % 2 === 1;

                              if (!isEscaped) {
                                inString = !inString;
                              }
                              // Reset backslash count after processing the char following them
                              backslashCount = 0;
                              result += char;
                              continue;
                            }

                            // For any other character, reset backslash count
                            backslashCount = 0;

                            if (inString) {
                              // Escape control characters inside strings
                              if (char === '\n') {
                                result += '\\n';
                              } else if (char === '\r') {
                                result += '\\r';
                              } else if (char === '\t') {
                                result += '\\t';
                              } else {
                                result += char;
                              }
                            } else {
                              result += char;
                            }
                          }
                          return result;
                        };

                        const extractDrafts = (text: string) => {
                          // 1. Try code blocks
                          const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)\s*```/g;
                          let match;
                          while ((match = codeBlockRegex.exec(text)) !== null) {
                            const raw = match[1];
                            // Try direct parse first
                            try {
                              const parsed = JSON.parse(raw);
                              if (parsed.type === 'tweet') return { json: parsed, fullMatch: match[0] };
                            } catch {
                              // Recover with sanitization
                              try {
                                const sanitized = sanitizeJsonString(raw);
                                const parsed = JSON.parse(sanitized);
                                if (parsed.type === 'tweet') return { json: parsed, fullMatch: match[0] };
                              } catch { }
                            }
                          }

                          // 2. Try raw JSON structure
                          const startPattern = /\{\s*"type"\s*:\s*"tweet"/;
                          const startMatch = text.match(startPattern);
                          if (startMatch && startMatch.index !== undefined) {
                            const startIndex = startMatch.index;

                            // Strategy A: Strict Parsing (Fast, assumes valid JSON)
                            let braceCount = 0;
                            let endIndex = -1;
                            let inString = false;
                            let escapeNext = false;

                            for (let i = startIndex; i < text.length; i++) {
                              const char = text[i];
                              if (escapeNext) { escapeNext = false; continue; }
                              if (char === '\\' && inString) { escapeNext = true; continue; }
                              if (char === '"') { inString = !inString; continue; }
                              if (!inString) {
                                if (char === '{') braceCount++;
                                else if (char === '}') braceCount--;
                                if (braceCount === 0) { endIndex = i + 1; break; }
                              }
                            }

                            if (endIndex !== -1) {
                              const jsonStr = text.substring(startIndex, endIndex);
                              try {
                                const parsed = JSON.parse(jsonStr);
                                if (parsed.type === 'tweet') return { json: parsed, fullMatch: jsonStr };
                              } catch {
                                // Try sanitizing the strictly extracted chunk
                                try {
                                  const sanitized = sanitizeJsonString(jsonStr);
                                  const parsed = JSON.parse(sanitized);
                                  if (parsed.type === 'tweet') return { json: parsed, fullMatch: jsonStr };
                                } catch { }
                              }
                            }

                            // Strategy B: Fallback - Sanitize First (Handles unescaped quotes causing bad boundary detection)
                            // We take the substring from start to end of text, sanitize it, then find boundaries
                            try {
                              const remainder = text.substring(startIndex);
                              const sanitizedRemainder = sanitizeJsonString(remainder);

                              // Now find the boundary in the sanitized string
                              braceCount = 0;
                              let sanitizedEndIndex = -1;
                              inString = false;
                              escapeNext = false;

                              for (let i = 0; i < sanitizedRemainder.length; i++) {
                                const char = sanitizedRemainder[i];
                                if (escapeNext) { escapeNext = false; continue; }
                                if (char === '\\' && inString) { escapeNext = true; continue; }
                                if (char === '"') { inString = !inString; continue; }
                                if (!inString) {
                                  if (char === '{') braceCount++;
                                  else if (char === '}') braceCount--;
                                  if (braceCount === 0) { sanitizedEndIndex = i + 1; break; }
                                }
                              }

                              if (sanitizedEndIndex !== -1) {
                                const jsonStr = sanitizedRemainder.substring(0, sanitizedEndIndex);
                                const parsed = JSON.parse(jsonStr);
                                if (parsed.type === 'tweet') {
                                  // Note: We can't easily map back to valid fullMatch in original text due to length changes 
                                  // Note: We can't easily map back to valid fullMatch in original text due to length changes
                                  // from sanitization (escaping quotes).
                                  // We assume the JSON consumes the rest of the relevant block or we use the remainder as the match to hide it using exact string.
                                  // Using 'remainder' as fullMatch ensures we hide the messy JSON part from the UI.
                                  return { json: parsed, fullMatch: remainder };
                                }
                              }
                            } catch (e) {
                              console.warn("Fallback extraction failed", e);

                              // Strategy C: Absolute Fallback - Manual Regex Extraction
                              // If JSON parsing fails completely, likely due to unescaped chars in long content,
                              // we manually extract the fields we care about.
                              try {
                                const drafts = [];
                                // Find all draft objects - approximate by looking for action/content pairs
                                // This is a robust heuristic that survives broken JSON structure
                                const remainingText = text.substring(startIndex);

                                // Regex to find "content": "..." (handling escaped quotes and importantly, UNESCAPED quotes using lookahead for next key)
                                // We look for the closing quote that is followed by a comma and a known key, or end of object/array
                                // This allows internal unescaped quotes to be captured as part of the content.
                                const contentRegex = /"content"\s*:\s*("[\s\S]*?")\s*(?=\s*,\s*"(?:action|reasoning|reference_tweet_ids|image_suggestion|hashtags|original_media|media)"|\s*\}|\s*\])/g;
                                const actionRegex = /"action"\s*:\s*"([^"]+)"/g;
                                // Regex to extract media object
                                const mediaRegex = /"media"\s*:\s*\{([^}]*)\}/g;

                                let contentMatch;
                                while ((contentMatch = contentRegex.exec(remainingText)) !== null) {
                                  try {
                                    let contentVal;
                                    const rawJsonString = contentMatch[1];

                                    try {
                                      // Try standard parse first
                                      contentVal = JSON.parse(rawJsonString);
                                    } catch {
                                      // Fallback: Manual unescape if parse fails (e.g. unescaped quotes)
                                      // We simply strip outer quotes and unescape standard chars.
                                      // We leave unescaped internal quotes as is, assuming they are part of text.
                                      contentVal = rawJsonString.slice(1, -1)
                                        .replace(/\\"/g, '"')
                                        .replace(/\\n/g, '\n')
                                        .replace(/\\r/g, '\r')
                                        .replace(/\\t/g, '\t')
                                        .replace(/\\\\/g, '\\');
                                    }

                                    // Find the closest action before this content
                                    // Reset action regex
                                    actionRegex.lastIndex = 0;
                                    let bestAction = 'post';
                                    let actMatch;
                                    // Find all actions before this content's index
                                    while ((actMatch = actionRegex.exec(remainingText)) !== null) {
                                      if (actMatch.index < contentMatch.index) {
                                        bestAction = actMatch[1];
                                      } else {
                                        break;
                                      }
                                    }

                                    // Try to extract media object near this content
                                    let mediaObj: TweetDraft['media'] = undefined;
                                    mediaRegex.lastIndex = 0;
                                    let mediaMatch;
                                    while ((mediaMatch = mediaRegex.exec(remainingText)) !== null) {
                                      // Find media object that appears after this content but before next content
                                      if (mediaMatch.index > contentMatch.index) {
                                        try {
                                          const mediaStr = '{' + mediaMatch[1] + '}';
                                          mediaObj = JSON.parse(mediaStr);
                                        } catch {
                                          // Try to extract individual fields
                                          const typeMatch = /"type"\s*:\s*"([^"]+)"/.exec(mediaMatch[1]);
                                          const urlMatch = /"url"\s*:\s*"([^"]+)"/.exec(mediaMatch[1]);
                                          const thumbnailMatch = /"thumbnail"\s*:\s*"([^"]+)"/.exec(mediaMatch[1]);
                                          if (typeMatch && urlMatch) {
                                            mediaObj = {
                                              type: typeMatch[1] as 'video' | 'photo',
                                              url: urlMatch[1],
                                              thumbnail: thumbnailMatch?.[1]
                                            };
                                          }
                                        }
                                        break;
                                      }
                                    }

                                    drafts.push({
                                      action: bestAction,
                                      content: contentVal,
                                      reasoning: "", // details likely lost in broken JSON, acceptable fallback
                                      reference_tweet_ids: [],
                                      image_suggestion: { has_suggestion: false, type: "none", image_prompt: "", description: "" },
                                      hashtags: [],
                                      original_media: [],
                                      media: mediaObj
                                    } as TweetDraft);
                                  } catch (e) {
                                    console.warn("Error parsing specific draft in fallback", e);
                                  }
                                }


                                if (drafts.length > 0) {
                                  return {
                                    json: {
                                      type: "tweet",
                                      data: { drafts }
                                    },
                                    fullMatch: remainingText // Consume the rest
                                  };
                                }
                              } catch (fallbackE) {
                                console.error("Regex fallback failed", fallbackE);
                              }
                            }
                          }
                          return null;
                        };

                        // Convert thread format to rewritten_timeline format
                        const convertThreadToTimeline = (threadData: any): any => {
                          if (!threadData?.data?.timeline) return threadData;
                          return {
                            type: 'rewritten_timeline',
                            data: {
                              ...threadData.data,
                              timeline: threadData.data.timeline.map((item: any) => ({
                                text: item.text,
                                media: (item.original_media || []).map((url: string) => {
                                  const isVideo = /\.mp4|\/vid\/|amplify_video/i.test(url);
                                  return {
                                    type: isVideo ? 'video' as const : 'photo' as const,
                                    media_url: isVideo ? '' : url,
                                    url: url,
                                    video_url: isVideo ? url : undefined,
                                  };
                                }),
                              })),
                            },
                          };
                        };

                        const isTimelineType = (type: string) => type === 'rewritten_timeline' || type === 'thread';

                        const extractRewrittenTimeline = (text: string) => {
                          // 1. Try code blocks (iterate through all matches)
                          const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)\s*```/g;
                          let match;

                          while ((match = codeBlockRegex.exec(text)) !== null) {
                            try {
                              const sanitized = sanitizeJsonString(match[1]);
                              const parsed = JSON.parse(sanitized);
                              if (isTimelineType(parsed.type)) {
                                const converted = parsed.type === 'thread' ? convertThreadToTimeline(parsed) : parsed;
                                return { json: converted, fullMatch: match[0] };
                              }
                            } catch {
                              // Parsing failed, try next match
                            }
                          }

                          // 2. Try raw JSON structure with proper string handling
                          const startPattern = /\{\s*"type"\s*:\s*"(?:rewritten_timeline|thread)"/;
                          const startMatch = text.match(startPattern);
                          if (startMatch && startMatch.index !== undefined) {
                            const startIndex = startMatch.index;

                            // Strategy A: Strict Parsing
                            let braceCount = 0;
                            let endIndex = -1;
                            let inString = false;
                            let escapeNext = false;

                            for (let i = startIndex; i < text.length; i++) {
                              const char = text[i];
                              if (escapeNext) { escapeNext = false; continue; }
                              if (char === '\\' && inString) { escapeNext = true; continue; }
                              if (char === '"') { inString = !inString; continue; }
                              if (!inString) {
                                if (char === '{') braceCount++;
                                else if (char === '}') braceCount--;
                                if (braceCount === 0) { endIndex = i + 1; break; }
                              }
                            }

                            if (endIndex !== -1) {
                              try {
                                const jsonStr = text.substring(startIndex, endIndex);
                                const sanitized = sanitizeJsonString(jsonStr);
                                const parsed = JSON.parse(sanitized);
                                if (isTimelineType(parsed.type)) {
                                  const converted = parsed.type === 'thread' ? convertThreadToTimeline(parsed) : parsed;
                                  return { json: converted, fullMatch: jsonStr };
                                }
                              } catch { }
                            }

                            // Strategy B: Fallback - Sanitize First
                            try {
                              const remainder = text.substring(startIndex);
                              const sanitizedRemainder = sanitizeJsonString(remainder);

                              braceCount = 0;
                              let sanitizedEndIndex = -1;
                              inString = false;
                              escapeNext = false;

                              for (let i = 0; i < sanitizedRemainder.length; i++) {
                                const char = sanitizedRemainder[i];
                                if (escapeNext) { escapeNext = false; continue; }
                                if (char === '\\' && inString) { escapeNext = true; continue; }
                                if (char === '"') { inString = !inString; continue; }
                                if (!inString) {
                                  if (char === '{') braceCount++;
                                  else if (char === '}') braceCount--;
                                  if (braceCount === 0) { sanitizedEndIndex = i + 1; break; }
                                }
                              }

                              if (sanitizedEndIndex !== -1) {
                                const jsonStr = sanitizedRemainder.substring(0, sanitizedEndIndex);
                                const parsed = JSON.parse(jsonStr);
                                if (isTimelineType(parsed.type)) {
                                  const converted = parsed.type === 'thread' ? convertThreadToTimeline(parsed) : parsed;
                                  return { json: converted, fullMatch: remainder };
                                }
                              }
                            } catch (e) {
                              console.warn("Fallback extraction failed", e);
                            }
                          }
                          return null;
                        };

                        // Extract article JSON from message text
                        const extractArticleJson = (text: string): { json: { type: 'article'; data: ArticleData }; fullMatch: string } | null => {
                          // 1. Try code blocks first
                          const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)\s*```/g;
                          let match;

                          while ((match = codeBlockRegex.exec(text)) !== null) {
                            try {
                              const sanitized = sanitizeJsonString(match[1]);
                              const parsed = JSON.parse(sanitized);
                              if (parsed.type === 'article' && parsed.data && parsed.data.content && parsed.data.content.trim().length > 50) {
                                return { json: parsed, fullMatch: match[0] };
                              }
                            } catch {
                              // Parsing failed, try next match
                            }
                          }

                          // 2. Try raw JSON structure
                          const startPattern = /\{\s*"type"\s*:\s*"article"/;
                          const startMatch = text.match(startPattern);

                          if (startMatch && startMatch.index !== undefined) {
                            const startIndex = startMatch.index;

                            // Find matching closing brace
                            let braceCount = 1;
                            let inString = false;
                            let i = startIndex + startMatch[0].length;

                            while (i < text.length && braceCount > 0) {
                              const char = text[i];

                              if (char === '"' && text[i - 1] !== '\\') {
                                inString = !inString;
                              } else if (!inString) {
                                if (char === '{') braceCount++;
                                else if (char === '}') braceCount--;
                              }
                              i++;
                            }

                            // Only parse if JSON is complete (braceCount === 0)
                            if (braceCount === 0) {
                              try {
                                const jsonStr = text.substring(startIndex, i);
                                const sanitized = sanitizeJsonString(jsonStr);
                                const parsed = JSON.parse(sanitized);
                                // Must have content with reasonable length
                                if (parsed.type === 'article' && parsed.data && parsed.data.content && parsed.data.content.trim().length > 50) {
                                  return { json: parsed, fullMatch: jsonStr };
                                }
                              } catch {
                                // Parse failed
                              }
                            }
                          }

                          return null;
                        };

                        const extracted = extractDrafts(msg.text);
                        const extractedTimeline = extractRewrittenTimeline(msg.text);
                        const extractedArticle = extractArticleJson(msg.text);

                        // Render Article Card if article JSON is found
                        if (extractedArticle) {
                          const { json, fullMatch } = extractedArticle;
                          const parts = msg.text.split(fullMatch);
                          const preamble = parts[0] ? filterInternalJson(parts[0])?.trim() : '';
                          const postamble = parts[1] ? filterInternalJson(parts[1])?.trim() : '';

                          return (
                            <div className={`chat-markdown-content text-sm leading-[1.8] text-[var(--text-primary)] ${msg.reasoning && msg.reasoning.trim() ? 'mt-1' : ''}`}>
                              {/* Preamble - only render if has actual content */}
                              {preamble && <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={createMarkdownComponents(handleTweetIdsClick, setPreviewImageUrl)}>{preamble}</ReactMarkdown>}

                              {/* Article Card */}
                              <div className={preamble ? 'mt-3' : ''}>
                                <ArticleCard
                                  data={json.data}
                                  currentUser={getCurrentUserInfo()}
                                  onGenerateHeaderImage={() => {
                                    // 调用生成图片
                                    if (json.data.header_image?.prompt) {
                                      handleGenerateImage(json.data.header_image.prompt);
                                    }
                                  }}
                                  onSaveDraft={async (_editedData: ArticleData) => {
                                    // draftService removed — server-side
                                    // article draft API is being retired in
                                    // favour of the bnbot agent's local
                                    // markdown workflow. Caller still gets a
                                    // toast so the UI doesn't appear hung.
                                    setToast({
                                      message:
                                        '草稿存储已下线，请用桌面 App 在本地编辑。',
                                      type: 'success',
                                    });
                                  }}
                                />
                              </div>

                              {/* Postamble - only render if has actual content */}
                              {postamble && <div className="mt-3"><ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={createMarkdownComponents(handleTweetIdsClick, setPreviewImageUrl)}>{postamble}</ReactMarkdown></div>}
                            </div>
                          );
                        }

                        if (extractedTimeline) {
                          const { json, fullMatch } = extractedTimeline;
                          const parts = msg.text.split(fullMatch);
                          // Clean preamble/postamble: filter out JSON artifacts like stray braces
                          const cleanJsonArtifacts = (s: string | undefined) => {
                            if (!s) return '';
                            const cleaned = filterInternalJson(s)?.trim() || '';
                            // Remove if only whitespace, braces, or brackets remain
                            return /^[\s{}\[\]]*$/.test(cleaned) ? '' : cleaned;
                          };
                          const timelinePreamble = cleanJsonArtifacts(parts[0]);
                          const timelinePostamble = cleanJsonArtifacts(parts[1]);

                          return (
                            <div className={`chat-markdown-content text-sm leading-[1.8] text-[var(--text-primary)] ${msg.reasoning && msg.reasoning.trim() ? 'mt-1' : ''}`}>
                              {/* Preamble */}
                              {timelinePreamble && <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={createMarkdownComponents(handleTweetIdsClick, setPreviewImageUrl)}>{timelinePreamble}</ReactMarkdown>}

                              {/* Timeline */}
                              <div className="mt-1 mb-4 rounded-2xl overflow-hidden py-3" style={{ border: '1px solid var(--border-color)' }}>
                                <RewrittenTimeline
                                  data={json.data}
                                  userInfo={getCurrentUserInfo()}
                                />
                              </div>

                              {/* Postamble */}
                              {timelinePostamble && <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={createMarkdownComponents(handleTweetIdsClick, setPreviewImageUrl)}>{timelinePostamble}</ReactMarkdown>}
                            </div>
                          )
                        }

                        // Helper to safely parse JSON with potential unescaped control characters
                        const safeJsonParse = (jsonString: string): any => {
                          if (!jsonString) return null;
                          try {
                            return JSON.parse(jsonString);
                          } catch (e) {
                            // Robust sanitation matching state-machine logic
                            try {
                              let result = '';
                              let inString = false;
                              let i = 0;

                              while (i < jsonString.length) {
                                const char = jsonString[i];

                                // Toggle inString state
                                if (char === '"') {
                                  // Check if escaped
                                  let backslashCount = 0;
                                  let j = i - 1;
                                  while (j >= 0 && jsonString[j] === '\\') {
                                    backslashCount++;
                                    j--;
                                  }
                                  // Even count means not escaped
                                  if (backslashCount % 2 === 0) {
                                    inString = !inString;
                                  }
                                }

                                if (inString) {
                                  if (char === '\n') result += '\\n';
                                  else if (char === '\r') result += '\\r';
                                  else if (char === '\t') result += '\\t';
                                  else result += char;
                                } else {
                                  result += char;
                                }
                                i++;
                              }

                              return JSON.parse(result);
                            } catch (e2) {
                              // console.debug("Robust cleanup failed for JSON", e2);
                              return null;
                            }
                          }
                        };

                        if (extracted) {
                          try {
                            // Extra safety try-catch around the parsing and rendering logic
                            try {
                              // Extracted.json is now the parsed object
                              const parsed = extracted.json as TweetDraftResponse | TweetDraftResponseLegacy;

                              if (parsed && parsed.type === 'tweet') {
                                // Detect format and normalize to array
                                let drafts: any[];

                                // Check if it's legacy format (has drafts array)
                                if ('drafts' in parsed.data && Array.isArray(parsed.data.drafts)) {
                                  // Legacy format
                                  drafts = parsed.data.drafts;
                                } else {
                                  // New format - convert single tweet to array
                                  const newFormatData = parsed.data as TweetDraftResponse['data'];
                                  drafts = [{
                                    action: newFormatData.action,
                                    content: newFormatData.content,
                                    reasoning: newFormatData.reasoning,
                                    reference_tweet_ids: newFormatData.reference_tweet_ids || [],
                                    image_suggestion: newFormatData.image_suggestion,
                                    hashtags: newFormatData.hashtags || [],
                                    original_media: newFormatData.original_media || [],
                                    media: newFormatData.media
                                  }];
                                }

                                // Split text to show preamble if any
                                const parts = msg.text.split(extracted.fullMatch);

                                return (
                                  <div className={`text-sm leading-[1.8] text-[var(--text-primary)] ${msg.reasoning && msg.reasoning.trim() ? 'mt-1' : ''}`}>
                                    {/* Preamble */}
                                    {parts[0] && filterInternalJson(parts[0]) && <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={createMarkdownComponents(handleTweetIdsClick, setPreviewImageUrl)}>{filterInternalJson(parts[0])}</ReactMarkdown>}

                                    {/* Draft Cards */}
                                    <div className="mt-2">
                                      {drafts.map((draft, i) => {
                                        let finalDraft = { ...draft };

                                        return (
                                          <TweetDraftCard
                                            key={i}
                                            draft={finalDraft}
                                            contextTweetId={contextTweetId}
                                            quotedTweet={quotedTweetData}
                                            onStayOnPage={onStayOnPage}
                                            srtContent={ytData?.bilingual_srt}
                                          />
                                        );
                                      })}
                                    </div>

                                    {/* Postamble */}
                                    {parts[1] && filterInternalJson(parts[1]) && <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={createMarkdownComponents(handleTweetIdsClick, setPreviewImageUrl)}>{filterInternalJson(parts[1])}</ReactMarkdown>}
                                  </div>
                                );
                              }
                            } catch (innerError) {
                              console.error('Error processing extracted draft JSON:', innerError);
                              // Fallback to normal render will happen below if we return null here
                            }
                          } catch (e) {
                            // Fallback to normal render if parse fails
                            console.error('Failed to parse draft JSON', e);
                          }
                        }

                        // Check for partial/loading JSON states
                        const checkPartialJson = (text: string, type: 'tweet' | 'rewritten_timeline' | 'article') => {
                          const startPattern = new RegExp(`\\{\\s*"type"\\s*:\\s*"${type}"`);
                          const match = text.match(startPattern);
                          if (match && match.index !== undefined) {
                            return {
                              startIndex: match.index,
                              preamble: text.substring(0, match.index)
                            };
                          }
                          return null;
                        };

                        const partialDrafts = checkPartialJson(msg.text, 'tweet');
                        const partialTimeline = checkPartialJson(msg.text, 'rewritten_timeline') || checkPartialJson(msg.text, 'thread' as any);
                        const partialArticle = checkPartialJson(msg.text, 'article');

                        // Article Loading Skeleton
                        if (partialArticle && isLoading && index === messages.length - 1) {
                          const articlePreamble = partialArticle.preamble ? filterInternalJson(partialArticle.preamble)?.trim() : '';
                          return (
                            <div className={`chat-markdown-content text-sm leading-[1.8] text-[var(--text-primary)] ${msg.reasoning && msg.reasoning.trim() ? 'mt-1' : ''}`}>
                              {/* Preamble - only render if has actual content */}
                              {articlePreamble && <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={createMarkdownComponents(handleTweetIdsClick, setPreviewImageUrl)}>{articlePreamble}</ReactMarkdown>}

                              {/* Article Loading Skeleton */}
                              <div className="my-4 rounded-2xl bg-[var(--bg-primary)] overflow-hidden animate-pulse" style={{ border: '1px solid var(--border-color)' }}>
                                {/* Header Image Skeleton */}
                                <div className="w-full aspect-video bg-[var(--hover-bg)]"></div>

                                <div className="p-4 space-y-4">
                                  {/* Title Skeleton */}
                                  <div className="space-y-2">
                                    <div className="h-6 bg-[var(--hover-bg)] rounded w-3/4"></div>
                                    <div className="h-4 bg-[var(--hover-bg)] rounded w-1/2"></div>
                                  </div>

                                  {/* Meta Info Skeleton */}
                                  <div className="flex items-center gap-4">
                                    <div className="h-3 bg-[var(--hover-bg)] rounded w-16"></div>
                                    <div className="h-3 bg-[var(--hover-bg)] rounded w-20"></div>
                                  </div>

                                  {/* Summary Box Skeleton */}
                                  <div className="p-3 rounded-xl bg-[var(--bg-secondary)] space-y-2">
                                    <div className="h-3 bg-[var(--hover-bg)] rounded w-20"></div>
                                    <div className="h-4 bg-[var(--hover-bg)] rounded w-full"></div>
                                    <div className="h-4 bg-[var(--hover-bg)] rounded w-5/6"></div>
                                  </div>

                                  {/* Content Skeleton */}
                                  <div className="space-y-2">
                                    <div className="h-4 bg-[var(--hover-bg)] rounded w-full"></div>
                                    <div className="h-4 bg-[var(--hover-bg)] rounded w-full"></div>
                                    <div className="h-4 bg-[var(--hover-bg)] rounded w-4/5"></div>
                                    <div className="h-4 bg-[var(--hover-bg)] rounded w-full"></div>
                                    <div className="h-4 bg-[var(--hover-bg)] rounded w-3/4"></div>
                                  </div>

                                  {/* Tags Skeleton */}
                                  <div className="flex gap-2 pt-2">
                                    <div className="h-6 bg-[var(--hover-bg)] rounded-full w-16"></div>
                                    <div className="h-6 bg-[var(--hover-bg)] rounded-full w-20"></div>
                                    <div className="h-6 bg-[var(--hover-bg)] rounded-full w-14"></div>
                                  </div>
                                </div>

                                <div className="px-4 pb-4 flex items-center justify-center text-xs text-[var(--text-secondary)]">
                                  <span className="loading loading-spinner loading-xs mr-2"></span>
                                  Generating article...
                                </div>
                              </div>
                            </div>
                          );
                        }

                        if ((partialDrafts || partialTimeline) && isLoading && index === messages.length - 1) {
                          const preamble = partialDrafts ? partialDrafts.preamble : partialTimeline!.preamble;
                          const filteredPreamble = preamble ? filterInternalJson(preamble)?.trim() : '';
                          return (
                            <div className={`chat-markdown-content text-sm leading-[1.8] text-[var(--text-primary)] ${msg.reasoning && msg.reasoning.trim() ? 'mt-1' : ''}`}>
                              {/* Preamble - only render if has actual content */}
                              {filteredPreamble && <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={createMarkdownComponents(handleTweetIdsClick, setPreviewImageUrl)}>{filteredPreamble}</ReactMarkdown>}

                              {/* Loading Skeleton */}
                              <div className="my-4 p-4 rounded-2xl bg-[var(--bg-secondary)] border border-[var(--border-color)] animate-pulse">
                                <div className="flex items-center gap-3 mb-4">
                                  <div className="w-10 h-10 rounded-full bg-[var(--skeleton-color)]"></div>
                                  <div className="flex-1 space-y-2">
                                    <div className="h-4 bg-[var(--skeleton-color)] rounded w-1/4"></div>
                                    <div className="h-3 bg-[var(--skeleton-color)] rounded w-1/3"></div>
                                  </div>
                                </div>
                                <div className="space-y-2">
                                  <div className="h-4 bg-[var(--skeleton-color)] rounded w-full"></div>
                                  <div className="h-4 bg-[var(--skeleton-color)] rounded w-full"></div>
                                  <div className="h-4 bg-[var(--skeleton-color)] rounded w-3/4"></div>
                                </div>
                                <div className="mt-4 flex items-center justify-center text-xs text-[var(--text-secondary)]">
                                  <span className="loading loading-spinner loading-xs mr-2"></span>
                                  Generating content...
                                </div>
                              </div>
                            </div>
                          );
                        }

                        // Normal Markdown Render
                        // Don't return null if we have generated image or are generating one
                        if (!msg.text && !msg.generatedImage && !msg.isGeneratingImage && !(isLoading && (!msg.reasoning || !msg.reasoning.trim()))) return null;

                        return (
                          <div className={`chat-markdown-content text-sm leading-[1.8] text-[var(--text-primary)] ${msg.reasoning && msg.reasoning.trim() ? 'mt-1' : ''}`}>
                            {/* Streaming Indicator - only show when ThinkingSection is NOT visible */}
                            {/* ThinkingSection is visible when: msg.reasoning?.trim() || (isLoading && index === messages.length - 1) */}
                            {/* So we only show this when ThinkingSection is NOT visible */}
                            {isLoading && index === messages.length - 1 && !msg.text && !msg.generatedImage && !msg.isGeneratingImage && false ? (
                              <span className="loading loading-ball -ml-2 loading-sm text-[#f0b90b] inline-flex items-center" style={{ animationDuration: '0.6s' }}></span>
                            ) : (
                              <div style={{ display: 'flex', flexDirection: 'column' }}>
                                {/* Image generation placeholder */}
                                {msg.isGeneratingImage && (
                                  <div className="mb-3 w-[280px] aspect-square rounded-xl overflow-hidden border border-[var(--border-color)] relative bg-[var(--bg-secondary)]">
                                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent animate-shimmer" style={{ transform: 'skewX(-20deg) translateX(-150%)' }}></div>
                                    <div className="absolute inset-0 flex items-center justify-center text-sm font-medium text-[var(--text-secondary)] flex-col gap-2">
                                      <span className="loading loading-spinner loading-md text-[var(--accent-color)]"></span>
                                      <span>Generating Image...</span>
                                    </div>
                                  </div>
                                )}
                                {/* Display generated image */}
                                {msg.generatedImage && !msg.isGeneratingImage && (
                                  <div className="mb-3 w-[280px] rounded-xl overflow-hidden border border-[var(--border-color)] relative group">
                                    <img
                                      src={msg.generatedImage}
                                      alt="Generated Image"
                                      className="w-full h-auto object-contain cursor-pointer hover:opacity-95 transition-opacity rounded-xl"
                                      style={{ maxHeight: '280px' }}
                                      onClick={() => setPreviewImageUrl(msg.generatedImage)}
                                      onError={(e) => {
                                        console.error('[ChatPanel] Failed to load generated image');
                                        (e.target as HTMLImageElement).style.display = 'none';
                                      }}
                                    />
                                    <CopyButtonOverlay src={msg.generatedImage} />
                                  </div>
                                )}

                                {/* Display Xiaohongshu media */}
                                {(msg as any).xiaohongshuData && (
                                  <div className="mb-3">
                                    {/* Video */}
                                    {(msg as any).xiaohongshuData.video && (
                                      <div className="mb-2 w-[280px] rounded-xl overflow-hidden border border-[var(--border-color)] relative group">
                                        <video
                                          src={(msg as any).xiaohongshuData.video.url}
                                          controls
                                          className="w-full h-auto object-contain rounded-xl"
                                          style={{ maxHeight: '400px' }}
                                          poster={(msg as any).xiaohongshuData.images?.[0]}
                                        />
                                        <div className="absolute top-2 left-2 px-2 py-1 rounded-full bg-black/60 text-white text-xs">
                                          📕 小红书视频
                                        </div>
                                      </div>
                                    )}
                                    {/* Images */}
                                    {(msg as any).xiaohongshuData.images && (msg as any).xiaohongshuData.images.length > 0 && !(msg as any).xiaohongshuData.video && (
                                      <div className="flex flex-wrap gap-2">
                                        {(msg as any).xiaohongshuData.images.slice(0, 4).map((imgUrl: string, imgIndex: number) => (
                                          <div key={imgIndex} className="w-[135px] rounded-xl overflow-hidden border border-[var(--border-color)] relative group">
                                            <img
                                              src={imgUrl}
                                              alt={`小红书图片 ${imgIndex + 1}`}
                                              className="w-full h-auto object-cover cursor-pointer hover:opacity-95 transition-opacity"
                                              style={{ maxHeight: '135px' }}
                                              onClick={() => setPreviewImageUrl(imgUrl)}
                                              onError={(e) => {
                                                const img = e.target as HTMLImageElement;
                                                // Already tried proxy, hide it
                                                if (img.dataset.proxied) {
                                                  img.style.display = 'none';
                                                  return;
                                                }
                                                // Try loading via background proxy (bypass CORS)
                                                img.dataset.proxied = '1';
                                                chrome.runtime.sendMessage({ type: 'FETCH_BLOB', url: imgUrl }, (response: any) => {
                                                  if (response?.success && response?.data) {
                                                    img.src = response.data;
                                                  } else {
                                                    img.style.display = 'none';
                                                  }
                                                });
                                              }}
                                            />
                                            {imgIndex === 0 && (
                                              <div className="absolute top-1 left-1 px-1.5 py-0.5 rounded-full bg-black/60 text-white text-[10px]">
                                                📕 小红书
                                              </div>
                                            )}
                                            {imgIndex === 3 && (msg as any).xiaohongshuData.images.length > 4 && (
                                              <div className="absolute inset-0 bg-black/50 flex items-center justify-center text-white text-lg font-medium">
                                                +{(msg as any).xiaohongshuData.images.length - 4}
                                              </div>
                                            )}
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                )}

                                {/* Text content */}
                                {msg.text && filterInternalJson(msg.text) && (
                                  <div>
                                    <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={createMarkdownComponents(handleTweetIdsClick, setPreviewImageUrl)}>{filterInternalJson(msg.text)}</ReactMarkdown>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })()}

                      {/* Login Button for 429 or 401 errors */}
                      {(msg.errorStatus === 429 || msg.errorStatus === 401) && onLoginClick && (
                        <button
                          onClick={onLoginClick}
                          className="mt-0.5 px-3 py-1 rounded-full bg-[var(--accent-color)] text-black text-[11px] font-medium hover:opacity-90 transition-opacity cursor-pointer"
                        >
                          {t.chat.loginToContinue}
                        </button>
                      )}

                      {/* Recharge Button for 402 errors */}
                      {msg.errorStatus === 402 && onCreditsClick && (
                        <button
                          onClick={onCreditsClick}
                          className="mt-0.5 px-3 py-1 rounded-full bg-[var(--accent-color)] text-black text-[11px] font-medium hover:opacity-90 transition-opacity cursor-pointer"
                        >
                          {t.chat.rechargeCredits}
                        </button>
                      )}

                      {/* Message Actions - only hide for the last message when loading */}
                      {msg.text && !(isLoading && index === messages.length - 1) && !msg.errorStatus && (
                        <MessageActions
                          text={msg.text}
                          onRegenerate={() => handleRegenerate(msg.id)}
                          disableRegenerate={isLoading}
                        />
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          {/* Bottom spacer - only show when has messages */}
          {messages.length > 0 && <div className="flex-shrink-0" style={{ height: '60vh' }} />}
          <div ref={messagesEndRef} />
        </div>
      </div>

      <form
        onSubmit={handleSubmit}
        style={{
          padding: '12px 8px',
          backgroundColor: 'var(--bg-primary)',
          position: 'relative',
          zIndex: 30,
          flexShrink: 0
        }}
      >
        <PromptPickerModal
          isOpen={isPickerOpen}
          onClose={() => setIsPickerOpen(false)}
          onSelect={(prompt) => {
            setInput(`生成图片：${prompt}`);
            setTimeout(() => {
              const textarea = document.querySelector('textarea');
              if (textarea) textarea.focus();
            }, 100);
          }}
        />
        {/* Floating banners - absolutely positioned to prevent layout shift */}
        {(quotedText || isSearchMode || isComposeMode || isThreadMode || isWechatMode || isXiaohongshuMode || isTiktokMode) && (
          <div style={{ position: 'absolute', bottom: '100%', left: 8, right: 8, marginBottom: -6 }}>
            {quotedText && (
              <div className="flex items-center gap-2 p-2 bg-[var(--bg-secondary)] border-l-2 border-[var(--accent-color)] rounded-r-lg text-xs text-[var(--text-secondary)] animate-in slide-in-from-bottom-2 fade-in duration-200 shadow-sm">
                <div className="line-clamp-1 italic flex-1">"{quotedText}"</div>
                <button
                  type="button"
                  onClick={() => setQuotedText(null)}
                  className="p-1 hover:bg-[var(--hover-bg)] rounded-full text-[var(--text-secondary)]"
                >
                  <X size={12} />
                </button>
              </div>
            )}
            {isComposeMode && (
              <div className="flex items-center gap-2 p-2 px-3 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-xl text-xs text-[var(--text-secondary)] animate-in slide-in-from-bottom-2 fade-in duration-200 shadow-sm">
                <ComposeIcon size={18} style={{ color: '#1d9bf0', flexShrink: 0 }} />
                <div className="flex-1 font-medium text-[var(--text-primary)]">
                  {t.chat.suggestions.composeInputInstruction}
                </div>
                <div className="relative" ref={composeDropdownRef}>
                  <button
                    type="button"
                    onClick={() => setShowComposeDropdown(!showComposeDropdown)}
                    className="flex items-center gap-1 px-2 py-1 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-color)] hover:border-[var(--accent-color)] text-[var(--text-primary)] font-medium transition-colors cursor-pointer"
                  >
                    <span>{composeType === 'tweet' ? t.chat.suggestions.composeTweet : composeType === 'thread' ? t.chat.suggestions.composeThread : t.chat.suggestions.composeArticle}</span>
                    <ChevronDown size={14} className={`transition-transform ${showComposeDropdown ? 'rotate-180' : ''}`} />
                  </button>
                  {showComposeDropdown && (
                    <div className="absolute bottom-full right-0 mb-1 w-32 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg overflow-hidden z-50" style={{ boxShadow: '0 4px 16px rgba(0,0,0,0.08)' }}>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setComposeType('tweet'); setShowComposeDropdown(false); }}
                        className={`w-full px-3 py-2 text-left text-xs hover:bg-[var(--hover-bg)] flex items-center gap-2 cursor-pointer ${composeType === 'tweet' ? 'text-[var(--text-primary)] font-bold bg-[var(--hover-bg)]' : 'text-[var(--text-primary)]'}`}
                      >
                        <SquarePen size={14} />
                        {t.chat.suggestions.composeTweet}
                      </button>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setComposeType('thread'); setShowComposeDropdown(false); }}
                        className={`w-full px-3 py-2 text-left text-xs hover:bg-[var(--hover-bg)] flex items-center gap-2 cursor-pointer ${composeType === 'thread' ? 'text-[var(--text-primary)] font-bold bg-[var(--hover-bg)]' : 'text-[var(--text-primary)]'}`}
                      >
                        <Layers size={14} />
                        {t.chat.suggestions.composeThread}
                      </button>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setComposeType('article'); setShowComposeDropdown(false); }}
                        className={`w-full px-3 py-2 text-left text-xs hover:bg-[var(--hover-bg)] flex items-center gap-2 cursor-pointer ${composeType === 'article' ? 'text-[var(--text-primary)] font-bold bg-[var(--hover-bg)]' : 'text-[var(--text-primary)]'}`}
                      >
                        <ComposeIcon size={14} />
                        {t.chat.suggestions.composeArticle}
                      </button>
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => { setIsComposeMode(false); setShowComposeDropdown(false); }}
                  className="p-1 rounded-full hover:bg-[var(--hover-bg)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
                  title="Close"
                >
                  <X size={14} />
                </button>
              </div>
            )}
            {isSearchMode && (
              <div className="flex items-center gap-2 p-2 px-3 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-xl text-xs text-[var(--text-secondary)] animate-in slide-in-from-bottom-2 fade-in duration-200 shadow-sm">
                <Search size={16} className="text-[var(--text-primary)] flex-shrink-0" />
                <div className="flex-1 font-medium text-[var(--text-primary)]">
                  {t.chat.suggestions.searchInputInstruction}
                </div>
                <label className="flex items-center gap-1.5 cursor-pointer select-none">
                  <span className="text-[10px] text-[var(--text-secondary)]">{t.chat.suggestions.searchAdvancedToggle}</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={useAdvancedSearch}
                    onClick={() => setUseAdvancedSearch(!useAdvancedSearch)}
                    className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${useAdvancedSearch ? 'bg-[var(--accent-color)]' : 'bg-gray-300'}`}
                  >
                    <span
                      className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${useAdvancedSearch ? 'translate-x-3.5' : 'translate-x-0.5'}`}
                    />
                  </button>
                </label>
                <button
                  type="button"
                  onClick={() => setIsSearchMode(false)}
                  className="p-1 rounded-full hover:bg-[var(--hover-bg)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                  title="Close"
                >
                  <X size={14} />
                </button>
              </div>
            )}
            {isThreadMode && (
              <div className="flex items-center gap-2 p-2 px-3 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-xl text-xs text-[var(--text-secondary)] animate-in slide-in-from-bottom-2 fade-in duration-200 shadow-sm">
                <Layers size={18} className="text-[#8b5cf6] flex-shrink-0" strokeWidth={1.5} />
                <div className="flex-1 font-medium text-[var(--text-primary)]">
                  {t.chat.suggestions.threadInputInstruction}
                </div>
                <button
                  type="button"
                  onClick={() => setIsThreadMode(false)}
                  className="p-1 rounded-full hover:bg-[var(--hover-bg)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
                  title="Close"
                >
                  <X size={14} />
                </button>
              </div>
            )}
            {isWechatMode && (
              <div className="flex items-center gap-2 p-2 px-3 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-xl text-xs text-[var(--text-secondary)] animate-in slide-in-from-bottom-2 fade-in duration-200 shadow-sm">
                <WeChatIcon size={18} style={{ flexShrink: 0 }} />
                <div className="flex-1 font-medium text-[var(--text-primary)]">
                  {t.chat.suggestions.wechatInputInstruction}
                </div>
                <label className="flex items-center gap-1.5 cursor-pointer select-none">
                  <span className={`text-[10px] ${!wechatRecreate ? 'text-[var(--text-primary)] font-medium' : 'text-[var(--text-secondary)]'}`}>{t.chat.suggestions.wechatOriginal}</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={wechatRecreate}
                    onClick={() => setWechatRecreate(!wechatRecreate)}
                    className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${wechatRecreate ? 'bg-[#07C160]' : 'bg-gray-300'}`}
                  >
                    <span
                      className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${wechatRecreate ? 'translate-x-3.5' : 'translate-x-0.5'}`}
                    />
                  </button>
                  <span className={`text-[10px] ${wechatRecreate ? 'text-[var(--text-primary)] font-medium' : 'text-[var(--text-secondary)]'}`}>{t.chat.suggestions.wechatRecreate}</span>
                </label>
                <button
                  type="button"
                  onClick={() => setIsWechatMode(false)}
                  className="p-1 rounded-full hover:bg-[var(--hover-bg)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
                  title="Close"
                >
                  <X size={14} />
                </button>
              </div>
            )}
            {isXiaohongshuMode && (
              <div className="flex items-center gap-2 p-2 px-3 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-xl text-xs text-[var(--text-secondary)] animate-in slide-in-from-bottom-2 fade-in duration-200 shadow-sm">
                <XiaohongshuIcon size={18} style={{ flexShrink: 0 }} />
                <div className="flex-1 font-medium text-[var(--text-primary)]">
                  {t.chat.suggestions.xiaohongshuInputInstruction}
                </div>
                <button
                  type="button"
                  onClick={() => setIsXiaohongshuMode(false)}
                  className="p-1 rounded-full hover:bg-[var(--hover-bg)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
                  title="Close"
                >
                  <X size={14} />
                </button>
              </div>
            )}
            {isTiktokMode && (
              <div className="flex items-center gap-2 p-2 px-3 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-xl text-xs text-[var(--text-secondary)] animate-in slide-in-from-bottom-2 fade-in duration-200 shadow-sm">
                <TikTokIcon size={18} style={{ flexShrink: 0 }} />
                <div className="flex-1 font-medium text-[var(--text-primary)]">
                  {t.chat.suggestions.tiktokInputInstruction}
                </div>
                <button
                  type="button"
                  onClick={() => setIsTiktokMode(false)}
                  className="p-1 rounded-full hover:bg-[var(--hover-bg)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
                  title="Close"
                >
                  <X size={14} />
                </button>
              </div>
            )}
          </div>
        )}
        {selectedImages.length > 0 && (
          <div className="flex gap-2 mx-2 mb-1 overflow-x-auto pb-1">
            {selectedImages.map((img, idx) => (
              <div key={idx} className="relative inline-block animate-in fade-in zoom-in duration-200 group flex-shrink-0">
                <img
                  src={img}
                  className="h-12 w-12 rounded-xl object-cover shadow-sm cursor-pointer hover:opacity-90 transition-opacity"
                  style={{ border: '1px solid #f3f4f6' }}
                  alt={`Preview ${idx}`}
                  onClick={() => setPreviewImageUrl(img)}
                />
                <button
                  type="button"
                  onClick={() => setSelectedImages(prev => prev.filter((_, i) => i !== idx))}
                  className="absolute -top-2 -right-2 bg-[var(--bg-primary)] text-[var(--text-primary)] border border-[var(--border-color)] rounded-full p-1 opacity-0 group-hover:opacity-100 hover:bg-[var(--hover-bg)] transition-all cursor-pointer shadow-sm z-10"
                  title="Remove image"
                >
                  <X size={12} strokeWidth={2.5} />
                </button>
              </div>
            ))}
          </div>
        )}
        {selectedFiles.length > 0 && (
          <div className="flex gap-2 mx-2 mb-1 overflow-x-auto pb-1">
            {selectedFiles.map((file, idx) => (
              <div key={idx} className="relative inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg animate-in fade-in zoom-in duration-200 group flex-shrink-0">
                <FileText size={16} className="text-[var(--accent-color)] flex-shrink-0" />
                <span className="text-xs text-[var(--text-primary)] max-w-[120px] truncate" title={file.name}>
                  {file.name}
                </span>
                <span className="text-[10px] text-[var(--text-secondary)]">
                  {file.size < 1024 ? `${file.size}B` : file.size < 1024 * 1024 ? `${(file.size / 1024).toFixed(1)}KB` : `${(file.size / 1024 / 1024).toFixed(1)}MB`}
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedFiles(prev => prev.filter((_, i) => i !== idx))}
                  className="ml-0.5 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--hover-bg)] rounded-full p-0.5 transition-colors cursor-pointer"
                  title="Remove file"
                >
                  <X size={12} strokeWidth={2.5} />
                </button>
              </div>
            ))}
          </div>
        )}
        <div style={{ position: 'relative', display: 'flex', alignItems: 'flex-end' }}>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileSelect}
            accept="image/*,.pdf,.txt,.csv,.json,application/pdf,text/plain,text/csv,application/json"
            multiple
            className="hidden"
            style={{ display: 'none' }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="absolute left-2 bottom-[5px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--hover-bg)] p-1.5 rounded-full transition-colors cursor-pointer z-10 flex items-center justify-center"
            title="Attach file (images, PDF, etc.)"
          >
            <Paperclip size={18} strokeWidth={2} />
          </button>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => { setInput(e.target.value); if (inputError) setInputError(null); }}
            onKeyDown={(e) => {
              // 检查是否正在使用 IME 输入法组合文字（如拼音选字）
              if (e.nativeEvent.isComposing || e.keyCode === 229) {
                return; // IME 组合中，不处理回车
              }
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (input.trim() && !isLoading) {
                  handleSubmit();
                }
              }
            }}
            onPaste={handlePaste}
            placeholder={isSearchMode ? t.chat.suggestions.searchPlaceholder : isComposeMode ? t.chat.suggestions.composePlaceholder : isThreadMode ? t.chat.suggestions.threadPlaceholder : isWechatMode ? t.chat.suggestions.wechatPlaceholder : isXiaohongshuMode ? t.chat.suggestions.xiaohongshuPlaceholder : isTiktokMode ? t.chat.suggestions.tiktokPlaceholder : t.chat.askAnything}
            rows={1}
            disabled={isLoading}
            style={{
              width: '100%',
              backgroundColor: 'var(--bg-secondary)',
              color: 'var(--text-primary)',
              borderRadius: '26px',
              padding: '12px 12px 36px 16px',
              border: '1px solid var(--border-color)',
              fontSize: '14px',
              outline: 'none',
              resize: 'none',
              minHeight: '68px',
              maxHeight: '120px',
              overflowY: 'auto',
              lineHeight: '1.4',
              height: 'auto',
              display: 'block',
              margin: 0,
              boxSizing: 'border-box',
              opacity: isLoading ? 0.7 : 1,
              cursor: isLoading ? 'not-allowed' : 'text',
            }}
          />
          {isLoading ? (
            <button
              type="button"
              onClick={async () => {
                // Cancel all running actions (this also hides the AI indicator)
                actionExecutor.cancelAll();
                // Call interrupt API if we have a session ID
                if (sessionIdRef.current) {
                  await chatService.interruptThread(sessionIdRef.current);
                  sessionIdRef.current = null;
                }
                // Also abort the fetch request
                if (abortControllerRef.current) {
                  abortControllerRef.current.abort();
                  abortControllerRef.current = null;
                }
                // Remove any empty bot messages (interrupted)
                setMessages(prev => prev.filter(msg =>
                  !(msg.role === 'model' && !msg.text)
                ));
                setIsLoading(false);
              }}
              style={{
                position: 'absolute',
                right: '6px',
                bottom: '8px',
                height: '26px',
                padding: '6px',
                backgroundColor: '#ef4444',
                color: 'white',
                borderRadius: '9999px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              title={t.chat.stopGenerating || 'Stop'}
            >
              <Square size={14} fill="white" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim()}
              style={{
                position: 'absolute',
                right: '6px',
                bottom: '8px',
                height: '26px',
                padding: '6px',
                backgroundColor: '#000000',
                color: 'white',
                borderRadius: '9999px',
                opacity: !input.trim() ? 0.5 : 1,
                cursor: !input.trim() ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <ArrowUp size={14} strokeWidth={2.5} />
            </button>
          )}
        </div>
      </form>

      {/* Tweet Details Bottom Sheet */}
      {
        tweetModalOpen && (
          <div
            className="absolute inset-0 z-50 flex items-end justify-center bg-black/5 backdrop-blur-[2px] animate-in fade-in duration-300"
            onClick={() => setTweetModalOpen(false)}
          >
            <div
              className="w-full bg-[var(--bg-primary)] shadow-[0_-8px_30px_rgba(0,0,0,0.12)] border-t border-[var(--border-color)] flex flex-col overflow-hidden max-h-[85%] animate-in slide-in-from-bottom-[100%] duration-500 ease-in-out"
              onClick={(e) => e.stopPropagation()}
              style={{ willChange: 'transform' }}
            >
              {/* Header */}
              <div className="flex items-center px-4 py-3 border-b border-[var(--border-color)]">
                <button
                  onClick={() => setTweetModalOpen(false)}
                  className="p-1 -ml-1 mr-2 hover:bg-[var(--hover-bg)] rounded-full transition-colors"
                >
                  <X size={20} className="text-[var(--text-primary)]" />
                </button>
                <h3 className="text-lg font-bold text-[var(--text-primary)]">
                  {t.chat.tweetDetails || 'Related Tweets'}
                </h3>
                {loadingTweets && (
                  <span className="ml-2 loading loading-spinner loading-sm text-[var(--text-secondary)]"></span>
                )}
              </div>

              <div className="flex-1 overflow-y-auto min-h-0">
                {tweetIds.map((tweetId, index) => {
                  const tweet = tweetDataCache.get(tweetId);
                  const isExpanded = expandedTweets.has(tweetId);

                  if (!tweet) {
                    // Show loading skeleton when fetching, otherwise show link
                    if (loadingTweets) {
                      return (
                        <div
                          key={tweetId}
                          className={`py-3 px-4 ${index !== tweetIds.length - 1 ? 'border-b border-[var(--border-color)]' : ''}`}
                        >
                          <div className="flex gap-3 animate-pulse">
                            <div className="w-10 h-10 rounded-full bg-[var(--bg-secondary)]"></div>
                            <div className="flex-1 space-y-2">
                              <div className="h-4 bg-[var(--bg-secondary)] rounded w-1/3"></div>
                              <div className="h-4 bg-[var(--bg-secondary)] rounded w-full"></div>
                              <div className="h-4 bg-[var(--bg-secondary)] rounded w-2/3"></div>
                            </div>
                          </div>
                        </div>
                      );
                    }
                    // Fallback: show card-style link to tweet if not in cache
                    return (
                      <div
                        key={tweetId}
                        className={`py-3 px-4 hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors cursor-pointer ${index !== tweetIds.length - 1 ? 'border-b border-[var(--border-color)]' : ''}`}
                        onClick={() => {
                          onStayOnPage?.();
                          setTweetModalOpen(false);
                          navigateToUrl(`https://x.com/i/status/${tweetId}`);
                        }}
                      >
                        <div className="flex gap-3">
                          <div className="w-10 h-10 rounded-full bg-[var(--bg-secondary)] flex items-center justify-center flex-shrink-0">

                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1 mb-1">
                              <span className="text-[var(--text-secondary)] text-sm">Tweet</span>
                            </div>
                            <div className="text-[var(--text-secondary)] text-sm">
                              {t.chat.clickToView || 'Click to view on X'}
                            </div>
                            <div className="text-[var(--text-secondary)] text-xs mt-1 opacity-60 truncate">
                              ID: {tweetId}
                            </div>
                          </div>
                          <ExternalLink size={16} className="text-[var(--text-secondary)] flex-shrink-0 mt-1" />
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div
                      key={tweetId}
                      className={`py-3 px-4 hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors cursor-pointer ${index !== tweetIds.length - 1 ? 'border-b border-[var(--border-color)]' : ''}`}
                      onClick={() => {
                        if (tweet.isTruncated && !isExpanded) {
                          setExpandedTweets(prev => new Set(prev).add(tweetId));
                        } else {
                          // Keep chat panel open and navigate to tweet
                          onStayOnPage?.();
                          setTweetModalOpen(false);
                          navigateToUrl(`https://x.com/${tweet.handle.replace('@', '')}/status/${tweetId}`);
                        }
                      }}
                    >
                      <div className="flex gap-3">
                        {/* Avatar */}
                        <div className="w-10 h-10 flex-shrink-0">
                          <ImageWithSkeleton
                            src={tweet.avatar}
                            alt={tweet.name}
                            className="w-10 h-10 rounded-full bg-[var(--bg-secondary)] object-cover"
                            fallbackSrc="https://abs.twimg.com/sticky/default_profile_images/default_profile_400x400.png"
                          />
                        </div>

                        <div className="flex-1 min-w-0">
                          {/* Header */}
                          <div className="flex items-center gap-1 min-w-0 mb-1">
                            <span className="font-bold text-[var(--text-primary)] text-sm truncate">{tweet.name}</span>
                            {tweet.verified && <BadgeCheck size={14} className="text-white fill-[#1d9bf0] flex-shrink-0" />}
                            <span className="text-[var(--text-secondary)] text-sm truncate">{tweet.handle}</span>
                            {tweet.time && (
                              <>
                                <span className="text-[var(--text-secondary)] text-sm">·</span>
                                <span className="text-[var(--text-secondary)] text-sm flex-shrink-0">{tweet.time}</span>
                              </>
                            )}
                          </div>

                          {/* Content */}
                          <div className="text-[var(--text-primary)] text-sm leading-relaxed whitespace-pre-wrap mb-2">
                            {isExpanded ? tweet.fullContent : tweet.content}
                          </div>
                          {tweet.isTruncated && !isExpanded && (
                            <button
                              className="text-[#1d9bf0] text-sm hover:underline mb-2"
                              onClick={(e) => {
                                e.stopPropagation();
                                setExpandedTweets(prev => new Set(prev).add(tweetId));
                              }}
                            >
                              {t.common.showMore || 'Show more'}
                            </button>
                          )}

                          {/* Media - Twitter-style grid layout */}
                          {tweet.media && tweet.media.length > 0 && (
                            <div className={`grid gap-0.5 mb-2 rounded-xl overflow-hidden ${tweet.media.length === 1 ? 'grid-cols-1' :
                              tweet.media.length === 2 ? 'grid-cols-2' :
                                tweet.media.length === 3 ? 'grid-cols-2' :
                                  'grid-cols-2'
                              }`}>
                              {tweet.media.slice(0, 4).map((media, idx) => (
                                <div
                                  key={idx}
                                  className={`relative overflow-hidden ${tweet.media!.length === 1 ? 'h-[200px]' :
                                    tweet.media!.length === 2 ? 'h-[150px]' :
                                      tweet.media!.length === 3 && idx === 0 ? 'h-[200px] row-span-2' :
                                        tweet.media!.length === 3 ? 'h-[100px]' :
                                          'h-[100px]'
                                    }`}
                                >
                                  <ImageWithSkeleton
                                    src={media.url}
                                    alt=""
                                    className="w-full h-full object-cover"
                                  />
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Stats */}
                          <div className="flex items-center justify-end gap-4 text-[var(--text-secondary)] text-xs mt-2">
                            <span className="flex items-center gap-1">
                              <MessageCircle size={14} />
                              {formatNumber(parseInt(tweet.stats.replies))}
                            </span>
                            <span className="flex items-center gap-1">
                              <Repeat size={14} />
                              {formatNumber(parseInt(tweet.stats.reposts))}
                            </span>
                            <span className="flex items-center gap-1">
                              <Heart size={14} />
                              {formatNumber(parseInt(tweet.stats.likes))}
                            </span>
                            <span className="flex items-center gap-1">
                              <BarChart2 size={14} />
                              {formatNumber(parseInt(tweet.stats.views))}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )
      }

      {/* Image Preview Modal for ChatPanel */}
      {
        previewImageUrl && createPortal(
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              width: '100vw',
              height: '100vh',
              backgroundColor: 'rgba(0, 0, 0, 0.9)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 2147483647,
              backdropFilter: 'blur(5px)',
              opacity: 1,
              transition: 'opacity 0.2s ease-in-out'
            }}
            onClick={() => setPreviewImageUrl(null)}
          >
            <button
              onClick={() => setPreviewImageUrl(null)}
              style={{
                position: 'absolute',
                top: '20px',
                right: '20px',
                padding: '10px',
                borderRadius: '9999px',
                backgroundColor: 'rgba(255, 255, 255, 0.1)',
                color: 'white',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'background-color 0.2s'
              }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.2)')}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.1)')}
            >
              <X size={24} />
            </button>
            <img
              src={previewImageUrl}
              alt="Preview"
              style={{
                maxWidth: '90vw',
                maxHeight: '90vh',
                objectFit: 'contain',
                borderRadius: '12px',
                boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
                transform: 'scale(1)',
                transition: 'transform 0.2s'
              }}
              onClick={(e) => e.stopPropagation()}
            />
          </div>,
          document.body
        )
      }

      {/* Coming Soon Notification - positioned at top-right of panel */}
      {showComingSoon && (
        <div
          style={{
            position: 'absolute',
            top: '16px',
            right: '16px',
            zIndex: 100,
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '10px 20px',
            backgroundColor: 'var(--bg-primary)',
            border: '1px solid var(--border-color)',
            borderRadius: '9999px',
            boxShadow: '0 4px 16px rgba(0, 0, 0, 0.1)',
            animation: 'fadeIn 0.2s ease-out',
          }}
        >
          <span style={{
            fontWeight: 600,
            fontSize: '14px',
            color: 'var(--text-primary)',
            whiteSpace: 'nowrap'
          }}>
            Coming Soon
          </span>
        </div>
      )}

      {/* Link validation error - positioned at top-right of panel */}
      {inputError && (
        <div
          style={{
            position: 'absolute',
            top: '16px',
            right: '16px',
            zIndex: 100,
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '10px 20px',
            backgroundColor: 'var(--bg-primary)',
            border: 'none',
            borderRadius: '9999px',
            boxShadow: '0 4px 16px rgba(239, 68, 68, 0.2)',
            animation: 'fadeIn 0.2s ease-out',
          }}
        >
          <span style={{
            fontWeight: 600,
            fontSize: '14px',
            color: '#ef4444',
            whiteSpace: 'nowrap'
          }}>
            {inputError}
          </span>
        </div>
      )}

    </div >
  );
};
