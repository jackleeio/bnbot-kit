import React, { useState, useRef, useEffect } from 'react';
import { TweetDraft } from '../services/draftService';
import { useLanguage } from './LanguageContext';
import { navigateToUrl } from '../utils/navigationUtils';
import { AutoResizeTextarea } from './AutoResizeTextarea';
import { ImageWithSkeleton } from './ImageWithSkeleton';
import { Bot, Flame } from 'lucide-react';
import videoCacheService from '../services/videoCacheService';

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

// Video thumbnail component with inline playback
// Handles TikTok videos by using pre-cached blob URLs or downloading through background script
const VideoThumbnail: React.FC<{
    videoUrl: string;
    thumbnailUrl?: string;
    source?: string;
    originalUrl?: string;
    onDelete?: () => void;
}> = ({ videoUrl, thumbnailUrl, source, originalUrl, onDelete }) => {
    const [proxyUrl, setProxyUrl] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(false);
    const [progress, setProgress] = useState(0);
    const { t } = useLanguage();

    // Debug log
    console.log('[VideoThumbnail] Props:', { videoUrl, thumbnailUrl, source, originalUrl });

    // Check if this is a TikTok video that needs proxying
    const isTikTokVideo = source === 'tiktok' ||
        videoUrl?.includes('tiktok') ||
        videoUrl?.includes('tiktokcdn');

    console.log('[VideoThumbnail] isTikTokVideo:', isTikTokVideo);

    useEffect(() => {
        if (!isTikTokVideo || !videoUrl) return;

        // 1. 先检查缓存
        const cached = videoCacheService.get(videoUrl);
        if (cached) {
            console.log('[VideoThumbnail] Using cached video');
            setProxyUrl(cached);
            return;
        }

        // 2. 检查是否正在下载
        if (videoCacheService.isDownloading(videoUrl)) {
            console.log('[VideoThumbnail] Video is being downloaded, subscribing to progress');
            setLoading(true);

            // 订阅进度
            const unsubscribe = videoCacheService.onProgress(videoUrl, (prog) => {
                setProgress(prog.percentage);
            });

            // 等待下载完成
            videoCacheService.preload(videoUrl).then(blobUrl => {
                setProxyUrl(blobUrl);
                setLoading(false);
            }).catch(() => {
                setError(true);
                setLoading(false);
            });

            return () => unsubscribe();
        }

        // 3. 还没开始下载，启动下载
        console.log('[VideoThumbnail] Starting download:', videoUrl.substring(0, 100));
        setLoading(true);
        setError(false);
        setProgress(0);

        const unsubscribe = videoCacheService.onProgress(videoUrl, (prog) => {
            setProgress(prog.percentage);
        });

        videoCacheService.preload(videoUrl).then(blobUrl => {
            setProxyUrl(blobUrl);
            setLoading(false);
        }).catch(() => {
            setError(true);
            setLoading(false);
        });

        return () => unsubscribe();
    }, [videoUrl, isTikTokVideo]);

    // Determine which URL to use
    const effectiveVideoUrl = isTikTokVideo ? proxyUrl : videoUrl;

    // Show loading state with progress
    if (loading) {
        return (
            <div className="relative group w-full h-full flex items-center justify-center bg-black/50" style={{ minHeight: '150px' }}>
                {thumbnailUrl && (
                    <img
                        src={thumbnailUrl}
                        alt="Video thumbnail"
                        className="absolute inset-0 w-full h-full object-cover opacity-50"
                    />
                )}
                <div className="absolute inset-0 flex flex-col items-center justify-center text-white">
                    <div className="animate-spin rounded-full h-8 w-8 border-2 border-white border-t-transparent mb-2"></div>
                    <span className="text-sm">
                        {progress > 0 ? `${t('chat.loadingVideo') || '加载视频中'} ${progress}%` : (t('chat.loadingVideo') || '加载视频中...')}
                    </span>
                </div>
            </div>
        );
    }

    // Show error state with fallback to open in new tab
    if (error || (isTikTokVideo && !effectiveVideoUrl)) {
        return (
            <div
                className="relative group w-full h-full flex items-center justify-center bg-black/80 cursor-pointer"
                style={{ minHeight: '150px' }}
                onClick={() => {
                    const urlToOpen = originalUrl || videoUrl;
                    if (urlToOpen) {
                        window.open(urlToOpen, '_blank');
                    }
                }}
            >
                {thumbnailUrl && (
                    <img
                        src={thumbnailUrl}
                        alt="Video thumbnail"
                        className="absolute inset-0 w-full h-full object-cover opacity-40"
                    />
                )}
                <div className="absolute inset-0 flex flex-col items-center justify-center text-white">
                    <span className="text-sm mb-2">{t('chat.videoPlaybackError') || '视频无法播放'}</span>
                    <button className="px-3 py-1.5 bg-white/20 hover:bg-white/30 rounded-full text-sm transition-colors">
                        {t('chat.openInNewTab') || '在新标签页打开'}
                    </button>
                </div>
            </div>
        );
    }

    // Normal video playback - show placeholder if no video URL yet
    if (!effectiveVideoUrl) {
        return (
            <div className="relative group w-full h-full flex items-center justify-center bg-black/30" style={{ minHeight: '150px' }}>
                {thumbnailUrl ? (
                    <img
                        src={thumbnailUrl}
                        alt="Video thumbnail"
                        className="absolute inset-0 w-full h-full object-cover"
                    />
                ) : (
                    <div className="absolute inset-0 w-full h-full bg-gradient-to-br from-gray-700 to-gray-900 animate-pulse" />
                )}
                <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-12 h-12 rounded-full bg-black/60 flex items-center justify-center">
                        <svg className="w-6 h-6 text-white ml-1" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M8 5v14l11-7z" />
                        </svg>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="relative group w-full h-full" style={{ minHeight: '150px' }}>
            <video
                src={effectiveVideoUrl || ''}
                poster={thumbnailUrl}
                controls
                className="w-full h-full object-cover"
                style={{ maxHeight: '300px' }}
            />
        </div>
    );
};

interface TweetDraftCardProps {
    draft: TweetDraft;
    currentUser?: { name: string; handle: string; avatar: string; verified: boolean; } | null;
    isEditing?: boolean;
    onContentChange?: (content: string) => void;
    onMediaUpdate?: (mediaItems: any[]) => void;
}

export const TweetDraftCard: React.FC<TweetDraftCardProps> = ({
    draft,
    currentUser,
    isEditing = false,
    onContentChange,
    onMediaUpdate
}) => {
    const { t } = useLanguage();

    // Helper to extract content safely
    const getContent = () => {
        if (draft.content.type === 'tweet_draft' && draft.content.data?.drafts?.[0]) {
            return draft.content.data.drafts[0];
        } else if (draft.content.type === 'tweet_timeline' && draft.content.data?.timeline?.[0]) {
            return draft.content.data.timeline[0]; // Just showing first tweet of thread for now in logic
        } else if (draft.content.text) {
            // Legacy
            return { content: draft.content.text, media: draft.content.media, hashtags: [], reference_tweet_ids: [], image_suggestion: { has_suggestion: false } };
        }
        return { content: '', media: [], hashtags: [], reference_tweet_ids: [], image_suggestion: { has_suggestion: false } };
    };

    const draftData = getContent();
    const initialText = draftData.content || (draftData as any).text || ''; // handle 'text' key in timeline

    // User Info Logic
    const avatarUrl = currentUser?.avatar ||
        (draft.content.type === 'tweet_timeline' ? draft.content.data?.user?.avatar : null) ||
        `https://api.dicebear.com/7.x/avataaars/svg?seed=${draft.user_id || 'user'}`;

    const name = currentUser?.name ||
        (draft.content.type === 'tweet_timeline' ? draft.content.data?.user?.display_name : null) ||
        "You";

    const handle = currentUser?.handle ||
        (draft.content.type === 'tweet_timeline' ? draft.content.data?.user?.username : null) ||
        (draft.content.authorHandle ? `@${draft.content.authorHandle}` : "@you");

    const verified = currentUser?.verified || false;

    // Content State
    const [editableContent, setEditableContent] = useState(initialText);
    const [isEditingContent, setIsEditingContent] = useState(false);
    const contentTextareaRef = useRef<HTMLTextAreaElement>(null);

    // Sync external updates to local state
    useEffect(() => {
        const d = getContent();
        const t = d.content || (d as any).text || '';
        setEditableContent(t);
    }, [draft.content]);

    // Handle content changes
    const handleContentChange = (newContent: string) => {
        setEditableContent(newContent);
        onContentChange?.(newContent);
    };

    // Media State
    const mediaItems = draftData.media || [];
    // Hashtags
    const hashtags = draftData.hashtags || [];
    // Ref Tweets
    const referenceTweetIds = draftData.reference_tweet_ids || [];
    // Image Suggestion
    const imageSuggestion = draftData.image_suggestion;


    return (
        <div data-no-selection-menu="true" className="flex flex-col gap-3 p-3 rounded-2xl bg-[var(--bg-primary)] mb-2" style={{ border: '1px solid var(--border-color)' }}>
            {/* Tweet Card Inner */}
            <div className="pt-1" style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: '20px', marginBottom: '4px' }}>
                <div className="flex gap-3">
                    {/* Avatar */}
                    <img
                        src={avatarUrl}
                        alt={name}
                        className="w-10 h-10 rounded-full object-cover shrink-0"
                    />

                    {/* User Info & Content */}
                    <div className="flex-1 min-w-0">
                        {/* Name, Handle */}
                        <div className="flex items-center justify-between mb-1">
                            <div className="flex items-center gap-1.5 min-w-0">
                                <span className="font-bold text-[var(--text-primary)] text-[15px] truncate flex items-center gap-1">
                                    {name}
                                    {verified && (
                                        <svg viewBox="0 0 22 22" aria-label="Verified account" role="img" className="w-[18px] h-[18px] text-[#1d9bf0] fill-current">
                                            <g>
                                                <path d="M20.396 11c-.018-.646-.215-1.275-.57-1.816-.354-.54-.852-.972-1.438-1.246.223-.607.27-1.264.14-1.897-.131-.634-.437-1.218-.882-1.687-.47-.445-1.053-.75-1.687-.882-.633-.13-1.29-.083-1.897.14-.273-.587-.704-1.086-1.245-1.44S11.647 1.62 11 1.604c-.646.017-1.273.213-1.813.568s-.969.97-1.245 1.44c-.606-.223-1.264-.27-1.897-.14-.634.13-1.218.437-1.687.882-.445.469-.751 1.053-.882 1.687-.13.633-.083 1.29.14 1.897-.586.274-1.084.705-1.439 1.246-.354.54-.55 1.17-.569 1.816.017.647.215 1.276.569 1.817.355.54.853.971 1.439 1.245-.223.606-.27 1.263-.14 1.897.131.634.437 1.218.882 1.687.47.445 1.053.75 1.687.882.633.13 1.29.083 1.897-.14.276.587.705 1.086 1.245 1.44.54.354 1.167.55 1.813.568.647-.018 1.275-.214 1.816-.569.54-.354.972-.853 1.245-1.44.606.223 1.264.27 1.897.14.634-.13 1.218-.437 1.687-.882.445-.469.75-1.053.882-1.687.13-.633.083-1.29-.14-1.897.587-.274 1.087-.705 1.438-1.245.355-.54.552-1.17.57-1.817zM9.662 14.85l-3.429-3.428 1.293-1.302 2.072 2.072 4.4-4.794 1.347 1.246z"></path>
                                            </g>
                                        </svg>
                                    )}
                                </span>
                                <span className="text-[var(--text-secondary)] text-[15px] truncate">
                                    {handle.startsWith('@') ? handle : `@${handle}`}
                                </span>
                            </div>
                        </div>

                        {/* Tweet Content - Editable */}
                        {isEditing || isEditingContent ? (
                            <AutoResizeTextarea
                                ref={contentTextareaRef}
                                value={editableContent}
                                onChange={(e) => handleContentChange(e.target.value)}
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
                        {hashtags && hashtags.length > 0 && (
                            <p className="text-[15px] text-[#1d9bf0] mt-1 flex flex-wrap gap-2 leading-tight">
                                {hashtags.map((tag: string, idx: number) => {
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
                            // Debug: log media structure
                            console.log('[TweetDraftCard] mediaItems:', JSON.stringify(mediaItems, null, 2));

                            // Check if any media is a vertical video (TikTok)
                            // TikTok videos use tiktokcdn.com URLs
                            const hasVerticalVideo = mediaItems.some((m: any) => {
                                if (m.type !== 'video') {
                                    console.log('[TweetDraftCard] Not a video, type:', m.type);
                                    return false;
                                }
                                const videoUrl = m.video_url || m.url || '';
                                const isTikTok = m.source === 'tiktok' ||
                                       videoUrl.includes('tiktok') ||
                                       videoUrl.includes('tiktokcdn') ||
                                       m.original_url?.includes('tiktok');
                                console.log('[TweetDraftCard] Video check:', {
                                    source: m.source,
                                    videoUrl: videoUrl.substring(0, 80),
                                    original_url: m.original_url,
                                    isTikTok
                                });
                                return isTikTok;
                            });
                            // Use square aspect ratio for vertical videos, 16/9 for others
                            const aspectRatio = hasVerticalVideo ? '1/1' : '16/9';

                            console.log('[TweetDraftCard] hasVerticalVideo:', hasVerticalVideo, 'aspectRatio:', aspectRatio);

                            return (
                            <div className="mt-2 rounded-2xl overflow-hidden border border-[var(--border-color)]">
                                <div className={`grid gap-0.5 ${mediaItems.length === 1 ? 'grid-cols-1' : 'grid-cols-2'} ${mediaItems.length > 2 ? 'grid-rows-2' : 'grid-rows-1'}`}
                                    style={{ aspectRatio }}
                                >
                                    {mediaItems.map((media: any, idx: number) => (
                                        <div
                                            key={idx}
                                            className={`relative overflow-hidden bg-[var(--bg-secondary)] ${mediaItems.length === 3 && idx === 0 ? 'row-span-2' : ''
                                                }`}
                                        >
                                            {media.type === 'video' ? (
                                                <VideoThumbnail
                                                    videoUrl={media.video_url || media.url || ''}
                                                    thumbnailUrl={media.thumbnail || (media as any).thumbnailUrl}
                                                    source={media.source}
                                                    originalUrl={media.original_url}
                                                />
                                            ) : (
                                                <div className="w-full h-full">
                                                    <ImageWithSkeleton
                                                        src={media.url}
                                                        alt="Tweet media"
                                                        className="w-full h-full object-cover"
                                                    />
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                            );
                        })()}
                    </div>
                </div>
            </div>

            {/* Reference Tweets */}
            {referenceTweetIds && referenceTweetIds.length > 0 && (
                <div className="flex items-center gap-2 text-xs mb-2">
                    <span className="text-[var(--text-secondary)]">{t.chat?.reference || 'Reference'}:</span>
                    <div className="flex flex-wrap gap-1.5">
                        {referenceTweetIds.map((tweetId: string, idx: number) => (
                            <button
                                key={idx}
                                onClick={(e) => {
                                    e.stopPropagation();
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


            {/* Image Suggestion */}
            {(!mediaItems || mediaItems.length === 0) && imageSuggestion?.has_suggestion && (
                <div className="rounded-lg bg-[var(--bg-secondary)] overflow-hidden border border-[var(--border-color)] mb-3">
                    <div className="flex flex-col gap-2 p-3">
                        <div className="flex items-center justify-between min-h-[28px]">
                            <div className="flex items-center gap-2 text-[var(--text-primary)]">
                                <Flame size={16} />
                                <span className="text-xs font-bold text-[var(--text-primary)]">Image Idea</span>
                            </div>
                        </div>
                        <p className="text-xs text-[var(--text-secondary)] leading-relaxed p-1 -m-1 rounded">
                            {imageSuggestion.image_prompt}
                        </p>
                    </div>
                </div>
            )}

            {/* Saved Time / Metadata */}
            <div className="flex justify-between items-center text-xs text-[var(--text-secondary)]">
                <span>Saved: {new Date(draft.created_at).toLocaleString()}</span>
            </div>
        </div>
    );
};
