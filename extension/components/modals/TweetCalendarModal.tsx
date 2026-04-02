import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom';
import { ChevronLeft, ChevronRight, X, Check, Calendar } from 'lucide-react';
import { draftService, TweetDraft } from '../../services/draftService';
import { useLanguage } from '../LanguageContext';
import { xUserStore, XUserInfo } from '../../stores/xUserStore';

interface ScheduledTweet {
    id: string;
    date: Date;
    text: string;
    time?: string;
}

interface TweetCalendarModalProps {
    onClose: () => void;
    onDateSelect?: (date: Date) => void;
    onScheduleDraft?: (draftId: string, date: Date) => void;
    onUnscheduleDraft?: (draftId: string) => void;
    scheduledTweets?: ScheduledTweet[];
    drafts?: TweetDraft[];  // 从父组件传入的草稿数据
    currentUser?: {
        name: string;
        handle: string;
        avatar: string;
        verified?: boolean;
    } | null;
}

// Draft Selection Modal
const DraftSelectionModal: React.FC<{
    selectedDate: Date;
    onClose: () => void;
    onSelectDraft: (draft: TweetDraft, time: string) => void;
    drafts: TweetDraft[];
    currentUser?: {
        name: string;
        handle: string;
        avatar: string;
    } | null;
}> = ({ selectedDate, onClose, onSelectDraft, drafts, currentUser: propUser }) => {
    const { t, language } = useLanguage();

    // Subscribe to xUserStore for user info
    const [currentUser, setCurrentUser] = useState<{
        name: string;
        handle: string;
        avatar: string;
        verified: boolean;
    } | null>(propUser ? { ...propUser, verified: false } : null);

    useEffect(() => {
        const unsubscribe = xUserStore.subscribe((userInfo: XUserInfo) => {
            if (userInfo.username) {
                setCurrentUser({
                    avatar: userInfo.avatarUrl || '',
                    name: userInfo.displayName || userInfo.username || 'You',
                    handle: `@${userInfo.username}`,
                    verified: userInfo.isBlueVerified,
                });
            }
        });

        return () => {
            unsubscribe();
        };
    }, []);

    // Step state: 'select-draft' or 'select-time'
    const [step, setStep] = useState<'select-draft' | 'select-time'>('select-draft');
    const [selectedDraft, setSelectedDraft] = useState<TweetDraft | null>(null);
    const [selectedHour, setSelectedHour] = useState('09');
    const [selectedMinute, setSelectedMinute] = useState('00');
    const [showPreview, setShowPreview] = useState(false);

    // Search and filter state
    const [searchQuery, setSearchQuery] = useState('');
    const [filterType, setFilterType] = useState<'all' | 'tweet' | 'thread'>('all');

    // Helper to get preview text from draft - use function declaration for hoisting
    function getPreviewText(draft: TweetDraft): string {
        const content = draft.content;
        if (content.type === 'tweet_draft' && content.data?.drafts?.[0]?.content) {
            return content.data.drafts[0].content;
        }
        if (content.type === 'tweet_timeline' && content.data?.timeline?.[0]?.text) {
            return content.data.timeline[0].text;
        }
        if (content.text) return content.text;
        if (content.content && typeof content.content === 'string') return content.content;
        return '';
    }

    // Filter only unscheduled tweet/thread drafts (no articles)
    const availableDrafts = drafts.filter(d => {
        // Base filter: must be draft and tweet/thread type
        if (d.publish_status !== 'draft') return false;
        if (d.draft_type !== 'tweet' && d.draft_type !== 'thread') return false;

        // Filter by type
        if (filterType !== 'all' && d.draft_type !== filterType) return false;

        // Filter by search query
        if (searchQuery.trim()) {
            const previewText = getPreviewText(d).toLowerCase();
            if (!previewText.includes(searchQuery.toLowerCase())) return false;
        }

        return true;
    });

    // Helper to get all timeline items from draft
    const getTimelineItems = (draft: TweetDraft): string[] => {
        const content = draft.content;
        if (content.type === 'tweet_timeline' && content.data?.timeline) {
            return content.data.timeline.map((item: any) => item.text || '');
        }
        if (content.type === 'tweet_draft' && content.data?.drafts?.[0]?.content) {
            return [content.data.drafts[0].content];
        }
        if (content.text) return [content.text];
        return [''];
    };

    const formatDate = (date: Date) => {
        if (language === 'en') {
            const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            return `${months[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
        }
        return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
    };

    // Render text with hashtags in Twitter blue
    const renderTextWithHashtags = (text: string) => {
        const parts = text.split(/(#\w+)/g);
        return parts.map((part, index) => {
            if (part.startsWith('#')) {
                return <span key={index} style={{ color: 'rgb(29, 155, 240)' }}>{part}</span>;
            }
            return part;
        });
    };

    const handleDraftClick = (draft: TweetDraft) => {
        setSelectedDraft(draft);
        setStep('select-time');
    };

    const handleConfirmTime = () => {
        if (selectedDraft) {
            onSelectDraft(selectedDraft, `${selectedHour}:${selectedMinute}`);
        }
    };

    const hours = Array.from({ length: 24 }, (_, i) => i.toString().padStart(2, '0'));
    const minutes = Array.from({ length: 12 }, (_, i) => (i * 5).toString().padStart(2, '0'));

    return (
        <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 2147483648,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
        }}>
            {/* Background - hide when preview is shown to avoid double overlay */}
            {!showPreview && (
                <div
                    style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        backgroundColor: 'rgba(0, 0, 0, 0.4)'
                    }}
                    onClick={onClose}
                />
            )}

            {/* Modal - hide when preview is shown */}
            <div style={{
                position: 'relative',
                width: '100%',
                maxWidth: '600px',
                maxHeight: '80vh',
                backgroundColor: '#fff',
                borderRadius: '16px',
                overflow: 'hidden',
                boxShadow: 'rgba(101, 119, 134, 0.2) 0px 0px 15px, rgba(101, 119, 134, 0.15) 0px 0px 3px 1px',
                display: showPreview ? 'none' : 'flex',
                flexDirection: 'column'
            }}>
                {/* Header */}
                <div style={{
                    padding: '16px',
                    borderBottom: '1px solid rgb(239, 243, 244)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px'
                }}>
                    {/* Title Row */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            {step === 'select-time' && (
                                <button
                                    onClick={() => setStep('select-draft')}
                                    style={{
                                        backgroundColor: 'transparent',
                                        border: 'none',
                                        padding: '6px',
                                        marginLeft: '-6px',
                                        cursor: 'pointer',
                                        borderRadius: '50%',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center'
                                    }}
                                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(15, 20, 25, 0.1)'}
                                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                                >
                                    <ChevronLeft size={20} color="rgb(15, 20, 25)" />
                                </button>
                            )}
                            <span style={{ fontSize: '17px', fontWeight: 700, color: 'rgb(15, 20, 25)' }}>
                                {step === 'select-draft'
                                    ? (language === 'en' ? 'Select Tweet' : '选择推文')
                                    : (language === 'en' ? 'Select Time' : '选择时间')
                                }
                            </span>
                            {step === 'select-draft' && (
                                <span style={{ fontSize: '13px', color: 'rgb(83, 100, 113)' }}>
                                    · {language === 'en' ? 'Schedule for' : '安排到'} {formatDate(selectedDate)}
                                </span>
                            )}
                        </div>
                        {/* Time Picker in Header - only show in select-time step */}
                        {step === 'select-time' && (
                            <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px',
                                padding: '6px 12px',
                                backgroundColor: '#fff',
                                borderRadius: '9999px',
                                border: '1px solid rgb(207, 217, 222)'
                            }}>
                                <select
                                    value={selectedHour}
                                    onChange={(e) => setSelectedHour(e.target.value)}
                                    style={{
                                        fontSize: '14px',
                                        fontWeight: 600,
                                        border: 'none',
                                        backgroundColor: 'transparent',
                                        color: 'rgb(15, 20, 25)',
                                        cursor: 'pointer',
                                        outline: 'none',
                                        appearance: 'none',
                                        WebkitAppearance: 'none',
                                        width: '26px',
                                        textAlign: 'center'
                                    }}
                                >
                                    {hours.map(h => (
                                        <option key={h} value={h}>{h}</option>
                                    ))}
                                </select>
                                <span style={{ fontSize: '14px', fontWeight: 600, color: 'rgb(15, 20, 25)' }}>:</span>
                                <select
                                    value={selectedMinute}
                                    onChange={(e) => setSelectedMinute(e.target.value)}
                                    style={{
                                        fontSize: '14px',
                                        fontWeight: 600,
                                        border: 'none',
                                        backgroundColor: 'transparent',
                                        color: 'rgb(15, 20, 25)',
                                        cursor: 'pointer',
                                        outline: 'none',
                                        appearance: 'none',
                                        WebkitAppearance: 'none',
                                        width: '26px',
                                        textAlign: 'center'
                                    }}
                                >
                                    {minutes.map(m => (
                                        <option key={m} value={m}>{m}</option>
                                    ))}
                                </select>
                            </div>
                        )}
                    </div>

                    {/* Search and Filter Row - only show in select-draft step */}
                    {step === 'select-draft' && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            {/* Search Input */}
                            <div style={{
                                flex: 1,
                                display: 'flex',
                                alignItems: 'center',
                                backgroundColor: 'rgb(239, 243, 244)',
                                borderRadius: '9999px',
                                padding: '8px 12px',
                                gap: '8px'
                            }}>
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgb(83, 100, 113)" strokeWidth="2">
                                    <circle cx="11" cy="11" r="8" />
                                    <path d="m21 21-4.35-4.35" />
                                </svg>
                                <input
                                    type="text"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    placeholder={language === 'en' ? 'Search drafts...' : '搜索草稿...'}
                                    style={{
                                        flex: 1,
                                        border: 'none',
                                        backgroundColor: 'transparent',
                                        outline: 'none',
                                        fontSize: '14px',
                                        color: 'rgb(15, 20, 25)'
                                    }}
                                />
                                {searchQuery && (
                                    <button
                                        onClick={() => setSearchQuery('')}
                                        style={{
                                            backgroundColor: 'rgb(15, 20, 25)',
                                            border: 'none',
                                            borderRadius: '50%',
                                            width: '18px',
                                            height: '18px',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            cursor: 'pointer',
                                            padding: 0
                                        }}
                                    >
                                        <X size={12} color="white" />
                                    </button>
                                )}
                            </div>

                            {/* Filter Buttons */}
                            <div style={{ display: 'flex', gap: '4px' }}>
                                {(['all', 'tweet', 'thread'] as const).map((type) => (
                                    <button
                                        key={type}
                                        onClick={() => setFilterType(type)}
                                        style={{
                                            padding: '6px 12px',
                                            fontSize: '13px',
                                            fontWeight: 500,
                                            border: 'none',
                                            borderRadius: '9999px',
                                            cursor: 'pointer',
                                            backgroundColor: filterType === type ? 'rgb(15, 20, 25)' : 'rgb(239, 243, 244)',
                                            color: filterType === type ? '#fff' : 'rgb(15, 20, 25)',
                                            transition: 'all 0.15s ease'
                                        }}
                                    >
                                        {type === 'all'
                                            ? (language === 'en' ? 'All' : '全部')
                                            : type === 'tweet'
                                                ? (language === 'en' ? 'Tweet' : '推文')
                                                : (language === 'en' ? 'Thread' : '推文串')
                                        }
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                {/* Content */}
                <div style={{ height: step === 'select-draft' ? '550px' : '320px', overflow: 'auto' }}>
                    {step === 'select-draft' ? (
                        /* Draft List */
                        availableDrafts.length === 0 ? (
                            <div style={{ padding: '24px', textAlign: 'center', color: 'rgb(83, 100, 113)' }}>
                                {language === 'en' ? 'No drafts available' : '没有可用的草稿'}
                            </div>
                        ) : (
                            availableDrafts.map((draft) => {
                                const previewText = getPreviewText(draft);
                                const truncatedText = previewText.length > 100
                                    ? previewText.substring(0, 100) + '...'
                                    : previewText;

                                return (
                                    <div
                                        key={draft.id}
                                        onClick={() => handleDraftClick(draft)}
                                        style={{
                                            padding: '12px 16px',
                                            borderBottom: '1px solid rgb(239, 243, 244)',
                                            cursor: 'pointer',
                                            transition: 'background-color 0.15s ease'
                                        }}
                                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(0, 0, 0, 0.03)'}
                                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                                    >
                                        <div style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '12px'
                                        }}>
                                            {/* Preview Text - 2 lines max with hashtags */}
                                            <div style={{
                                                flex: 1,
                                                fontSize: '15px',
                                                color: 'rgb(15, 20, 25)',
                                                lineHeight: 1.5,
                                                minHeight: '45px',
                                                display: '-webkit-box',
                                                WebkitLineClamp: 2,
                                                WebkitBoxOrient: 'vertical',
                                                overflow: 'hidden'
                                            }}>
                                                {renderTextWithHashtags(previewText)}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })
                        )
                    ) : (
                        /* Time Picker - Twitter Style */
                        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                            {/* Tweet Preview - Full Twitter Style */}
                            <div style={{ flex: 1, overflow: 'auto', padding: '16px 0' }}>
                                {selectedDraft && (() => {
                                    const items = getTimelineItems(selectedDraft);

                                    // For threads with more than 2 items, only show first and last
                                    const displayItems = items.length > 2
                                        ? [
                                            { text: items[0], isFirst: true, isLast: false, showEllipsis: false },
                                            { text: '', isFirst: false, isLast: false, showEllipsis: true, hiddenCount: items.length - 2 },
                                            { text: items[items.length - 1], isFirst: false, isLast: true, showEllipsis: false }
                                          ]
                                        : items.map((text, index) => ({
                                            text,
                                            isFirst: index === 0,
                                            isLast: index === items.length - 1,
                                            showEllipsis: false
                                          }));

                                    return (
                                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                                            {displayItems.map((item, index) => {
                                                if (item.showEllipsis) {
                                                    // Show vertical dots row
                                                    return (
                                                        <div
                                                            key={index}
                                                            style={{
                                                                display: 'flex',
                                                                gap: '12px',
                                                                padding: '4px 20px'
                                                            }}
                                                        >
                                                            {/* Avatar column with vertical dots */}
                                                            <div style={{
                                                                display: 'flex',
                                                                flexDirection: 'column',
                                                                alignItems: 'center',
                                                                flexShrink: 0,
                                                                width: '48px',
                                                                gap: '4px',
                                                                padding: '6px 0'
                                                            }}>
                                                                <div style={{ width: '2px', height: '2px', borderRadius: '50%', backgroundColor: 'rgb(207, 217, 222)' }} />
                                                                <div style={{ width: '2px', height: '2px', borderRadius: '50%', backgroundColor: 'rgb(207, 217, 222)' }} />
                                                                <div style={{ width: '2px', height: '2px', borderRadius: '50%', backgroundColor: 'rgb(207, 217, 222)' }} />
                                                            </div>
                                                            {/* Hidden count text */}
                                                            <div style={{
                                                                flex: 1,
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                color: 'rgb(83, 100, 113)',
                                                                fontSize: '13px'
                                                            }}>
                                                                {language === 'en'
                                                                    ? `${item.hiddenCount} more`
                                                                    : `还有 ${item.hiddenCount} 条`
                                                                }
                                                            </div>
                                                        </div>
                                                    );
                                                }

                                                const isLast = item.isLast;

                                                return (
                                                    <div
                                                        key={index}
                                                        style={{
                                                            display: 'flex',
                                                            gap: '12px',
                                                            padding: '12px 20px'
                                                        }}
                                                    >
                                                        {/* Avatar with connecting line */}
                                                        <div style={{
                                                            display: 'flex',
                                                            flexDirection: 'column',
                                                            alignItems: 'center',
                                                            flexShrink: 0,
                                                            width: '48px'
                                                        }}>
                                                            <img
                                                                src={currentUser?.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=user`}
                                                                alt="avatar"
                                                                style={{
                                                                    width: '48px',
                                                                    height: '48px',
                                                                    borderRadius: '50%',
                                                                    backgroundColor: 'rgb(207, 217, 222)',
                                                                    objectFit: 'cover'
                                                                }}
                                                            />
                                                            {/* Connecting line for threads */}
                                                            {!isLast && displayItems.length > 1 && (
                                                                <div style={{
                                                                    width: '2px',
                                                                    flex: 1,
                                                                    minHeight: '12px',
                                                                    backgroundColor: 'rgb(207, 217, 222)',
                                                                    marginTop: '4px'
                                                                }} />
                                                            )}
                                                        </div>

                                                        {/* Content */}
                                                        <div style={{ flex: 1, minWidth: 0 }}>
                                                            {/* Header Row */}
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '4px' }}>
                                                                <span style={{ fontWeight: 700, fontSize: '15px', color: 'rgb(15, 20, 25)' }}>
                                                                    {currentUser?.name || 'You'}
                                                                </span>
                                                                {/* Verified Badge */}
                                                                {currentUser?.verified && (
                                                                    <svg viewBox="0 0 22 22" aria-label="Verified account" role="img" style={{ width: '18px', height: '18px', fill: 'rgb(29, 155, 240)' }}>
                                                                        <g>
                                                                            <path d="M20.396 11c-.018-.646-.215-1.275-.57-1.816-.354-.54-.852-.972-1.438-1.246.223-.607.27-1.264.14-1.897-.131-.634-.437-1.218-.882-1.687-.47-.445-1.053-.75-1.687-.882-.633-.13-1.29-.083-1.897.14-.273-.587-.704-1.086-1.245-1.44S11.647 1.62 11 1.604c-.646.017-1.273.213-1.813.568s-.969.97-1.245 1.44c-.606-.223-1.264-.27-1.897-.14-.634.13-1.218.437-1.687.882-.445.469-.751 1.053-.882 1.687-.13.633-.083 1.29.14 1.897-.586.274-1.084.705-1.439 1.246-.354.54-.55 1.17-.569 1.816.017.647.215 1.276.569 1.817.355.54.853.971 1.439 1.245-.223.606-.27 1.263-.14 1.897.131.634.437 1.218.882 1.687.47.445 1.053.75 1.687.882.633.13 1.29.083 1.897-.14.276.587.705 1.086 1.245 1.44.54.354 1.167.55 1.813.568.647-.018 1.275-.214 1.816-.569.54-.354.972-.853 1.245-1.44.606.223 1.264.27 1.897.14.634-.13 1.218-.437 1.687-.882.445-.469.75-1.053.882-1.687.13-.633.083-1.29-.14-1.897.587-.274 1.087-.705 1.438-1.245.355-.54.552-1.17.57-1.817zM9.662 14.85l-3.429-3.428 1.293-1.302 2.072 2.072 4.4-4.794 1.347 1.246z"></path>
                                                                        </g>
                                                                    </svg>
                                                                )}
                                                                <span style={{ fontSize: '15px', color: 'rgb(83, 100, 113)' }}>
                                                                    {currentUser?.handle || '@you'}
                                                                </span>
                                                            </div>

                                                            {/* Tweet Text */}
                                                            <div style={{
                                                                fontSize: '15px',
                                                                color: 'rgb(15, 20, 25)',
                                                                lineHeight: 1.5,
                                                                whiteSpace: 'pre-wrap',
                                                                wordBreak: 'break-word'
                                                            }}>
                                                                {item.text}
                                                            </div>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    );
                                })()}
                            </div>

                            {/* Bottom Bar - Buttons Only */}
                            <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                padding: '16px 20px',
                                borderTop: '1px solid rgb(239, 243, 244)',
                                backgroundColor: '#fff',
                                flexShrink: 0
                            }}>
                                {/* Preview Button - Left */}
                                <button
                                    onClick={() => setShowPreview(true)}
                                    style={{
                                        padding: '6px 16px',
                                        fontSize: '13px',
                                        fontWeight: 700,
                                        color: 'rgb(15, 20, 25)',
                                        backgroundColor: 'transparent',
                                        border: '1px solid rgb(207, 217, 222)',
                                        borderRadius: '9999px',
                                        cursor: 'pointer',
                                        transition: 'background-color 0.15s ease'
                                    }}
                                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(15, 20, 25, 0.1)'}
                                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                                >
                                    {language === 'en' ? 'Preview' : '预览'}
                                </button>

                                {/* Confirm Button - Right */}
                                <button
                                    onClick={handleConfirmTime}
                                    style={{
                                        padding: '6px 16px',
                                        fontSize: '13px',
                                        fontWeight: 700,
                                        color: '#fff',
                                        backgroundColor: 'rgb(15, 20, 25)',
                                        border: 'none',
                                        borderRadius: '9999px',
                                        cursor: 'pointer',
                                        transition: 'background-color 0.15s ease'
                                        }}
                                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgb(39, 44, 48)'}
                                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'rgb(15, 20, 25)'}
                                    >
                                        {language === 'en' ? 'Confirm' : '确认'}
                                    </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Full Preview Modal */}
            {showPreview && selectedDraft && (
                <div style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    zIndex: 2147483649,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                }}>
                    {/* Background */}
                    <div
                        style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            right: 0,
                            bottom: 0,
                            backgroundColor: 'rgba(0, 0, 0, 0.4)'
                        }}
                        onClick={() => setShowPreview(false)}
                    />

                    {/* Preview Modal Container */}
                    <div style={{
                        position: 'relative',
                        maxWidth: '600px',
                        width: '100%',
                    }}>
                        {/* Back Button - Left side of modal */}
                        <button
                            onClick={() => setShowPreview(false)}
                            style={{
                                position: 'absolute',
                                left: '-52px',
                                top: '4px',
                                backgroundColor: 'rgba(255, 255, 255, 0.9)',
                                border: 'none',
                                padding: '8px',
                                cursor: 'pointer',
                                borderRadius: '50%',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                boxShadow: '0 2px 8px rgba(0, 0, 0, 0.15)'
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 1)'}
                            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.9)'}
                        >
                            <ChevronLeft size={18} color="rgb(15, 20, 25)" />
                        </button>

                        {/* Preview Modal */}
                        <div style={{
                            width: '100%',
                            minHeight: '300px',
                            maxHeight: '80vh',
                            backgroundColor: '#fff',
                            borderRadius: '16px',
                            overflow: 'hidden',
                            boxShadow: 'rgba(101, 119, 134, 0.2) 0px 0px 15px, rgba(101, 119, 134, 0.15) 0px 0px 3px 1px',
                            display: 'flex',
                            flexDirection: 'column'
                        }}>

                        {/* Full Thread Preview */}
                        <div style={{ flex: 1, overflow: 'auto', padding: '16px 0' }}>
                            {(() => {
                                const items = getTimelineItems(selectedDraft);
                                return (
                                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                                        {items.map((text, index) => {
                                            const isLast = index === items.length - 1;
                                            return (
                                                <div
                                                    key={index}
                                                    style={{
                                                        display: 'flex',
                                                        gap: '12px',
                                                        padding: '12px 20px'
                                                    }}
                                                >
                                                    {/* Avatar with connecting line */}
                                                    <div style={{
                                                        display: 'flex',
                                                        flexDirection: 'column',
                                                        alignItems: 'center',
                                                        flexShrink: 0,
                                                        width: '40px',
                                                        position: 'relative'
                                                    }}>
                                                        {/* The connecting line - absolute positioned */}
                                                        {!isLast && items.length > 1 && (
                                                            <div style={{
                                                                position: 'absolute',
                                                                top: '48px',
                                                                bottom: '-8px',
                                                                left: '50%',
                                                                transform: 'translateX(-50%)',
                                                                width: '2px',
                                                                backgroundColor: 'rgb(207, 217, 222)'
                                                            }} />
                                                        )}
                                                        <img
                                                            src={currentUser?.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=user`}
                                                            alt="avatar"
                                                            style={{
                                                                width: '40px',
                                                                height: '40px',
                                                                borderRadius: '50%',
                                                                backgroundColor: 'rgb(207, 217, 222)',
                                                                objectFit: 'cover',
                                                                position: 'relative',
                                                                zIndex: 1
                                                            }}
                                                        />
                                                    </div>

                                                    {/* Content */}
                                                    <div style={{ flex: 1, minWidth: 0 }}>
                                                        {/* Header Row */}
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '4px' }}>
                                                            <span style={{ fontWeight: 700, fontSize: '15px', color: 'rgb(15, 20, 25)' }}>
                                                                {currentUser?.name || 'You'}
                                                            </span>
                                                            {currentUser?.verified && (
                                                                <svg viewBox="0 0 22 22" aria-label="Verified account" role="img" style={{ width: '18px', height: '18px', fill: 'rgb(29, 155, 240)' }}>
                                                                    <g>
                                                                        <path d="M20.396 11c-.018-.646-.215-1.275-.57-1.816-.354-.54-.852-.972-1.438-1.246.223-.607.27-1.264.14-1.897-.131-.634-.437-1.218-.882-1.687-.47-.445-1.053-.75-1.687-.882-.633-.13-1.29-.083-1.897.14-.273-.587-.704-1.086-1.245-1.44S11.647 1.62 11 1.604c-.646.017-1.273.213-1.813.568s-.969.97-1.245 1.44c-.606-.223-1.264-.27-1.897-.14-.634.13-1.218.437-1.687.882-.445.469-.751 1.053-.882 1.687-.13.633-.083 1.29.14 1.897-.586.274-1.084.705-1.439 1.246-.354.54-.55 1.17-.569 1.816.017.647.215 1.276.569 1.817.355.54.853.971 1.439 1.245-.223.606-.27 1.263-.14 1.897.131.634.437 1.218.882 1.687.47.445 1.053.75 1.687.882.633.13 1.29.083 1.897-.14.276.587.705 1.086 1.245 1.44.54.354 1.167.55 1.813.568.647-.018 1.275-.214 1.816-.569.54-.354.972-.853 1.245-1.44.606.223 1.264.27 1.897.14.634-.13 1.218-.437 1.687-.882.445-.469.75-1.053.882-1.687.13-.633.083-1.29-.14-1.897.587-.274 1.087-.705 1.438-1.245.355-.54.552-1.17.57-1.817zM9.662 14.85l-3.429-3.428 1.293-1.302 2.072 2.072 4.4-4.794 1.347 1.246z"></path>
                                                                    </g>
                                                                </svg>
                                                            )}
                                                            <span style={{ fontSize: '15px', color: 'rgb(83, 100, 113)' }}>
                                                                {currentUser?.handle || '@you'}
                                                            </span>
                                                        </div>

                                                        {/* Tweet Text */}
                                                        <div style={{
                                                            fontSize: '15px',
                                                            color: 'rgb(15, 20, 25)',
                                                            lineHeight: 1.5,
                                                            whiteSpace: 'pre-wrap',
                                                            wordBreak: 'break-word'
                                                        }}>
                                                            {renderTextWithHashtags(text)}
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                );
                            })()}
                        </div>
                    </div>
                </div>
            </div>
            )}
        </div>
    );
};

export function TweetCalendarModal({ onClose, onDateSelect, onScheduleDraft, onUnscheduleDraft, scheduledTweets = [], drafts = [], currentUser }: TweetCalendarModalProps) {
    const [mounted, setMounted] = useState(false);
    const [currentDate, setCurrentDate] = useState(new Date());
    const [selectedDateForDraft, setSelectedDateForDraft] = useState<Date | null>(null);
    const [selectedScheduledTweet, setSelectedScheduledTweet] = useState<{ id: string; text: string; time: string; date: Date } | null>(null);
    const [showScheduledPreview, setShowScheduledPreview] = useState(false);
    const { t, language } = useLanguage();

    useEffect(() => {
        setMounted(true);
        const handleEsc = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleEsc);

        // Prevent background scrolling when modal is open
        const originalOverflow = document.body.style.overflow;
        const originalPaddingRight = document.body.style.paddingRight;
        const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;

        document.body.style.overflow = 'hidden';
        document.body.style.paddingRight = `${scrollbarWidth}px`;

        // Block wheel events on document to prevent any background scrolling
        const blockWheel = (e: WheelEvent) => {
            // Only block if the target is outside the modal
            const modal = document.querySelector('[data-modal="tweet-calendar"]');
            if (modal && !modal.contains(e.target as Node)) {
                e.preventDefault();
                e.stopPropagation();
            }
        };
        document.addEventListener('wheel', blockWheel, { passive: false });

        return () => {
            window.removeEventListener('keydown', handleEsc);
            document.removeEventListener('wheel', blockWheel);
            document.body.style.overflow = originalOverflow;
            document.body.style.paddingRight = originalPaddingRight;
        };
    }, [onClose]);

    if (!mounted) return null;

    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();

    // Get first day of month and total days
    const firstDayOfMonth = new Date(year, month, 1);
    const lastDayOfMonth = new Date(year, month + 1, 0);
    const daysInMonth = lastDayOfMonth.getDate();
    const startingDayOfWeek = firstDayOfMonth.getDay(); // 0 = Sunday

    // Calculate how many rows we need (5 or 6)
    const totalCells = startingDayOfWeek + daysInMonth;
    const rowsNeeded = Math.ceil(totalCells / 7);

    // Generate calendar days - only as many as needed
    const calendarDays: (number | null)[] = [];

    // Add empty slots for days before the first day of month
    for (let i = 0; i < startingDayOfWeek; i++) {
        calendarDays.push(null);
    }

    // Add days of the month
    for (let day = 1; day <= daysInMonth; day++) {
        calendarDays.push(day);
    }

    // Fill remaining slots to complete the last row
    while (calendarDays.length % 7 !== 0) {
        calendarDays.push(null);
    }

    const weekDays = language === 'en'
        ? ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
        : ['日', '一', '二', '三', '四', '五', '六'];
    const monthNames = language === 'en'
        ? ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
        : ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];

    const goToPreviousMonth = () => {
        setCurrentDate(new Date(year, month - 1, 1));
    };

    const goToNextMonth = () => {
        setCurrentDate(new Date(year, month + 1, 1));
    };

    const isToday = (day: number) => {
        const today = new Date();
        return day === today.getDate() && month === today.getMonth() && year === today.getFullYear();
    };

    const handleDateClick = (day: number) => {
        const selectedDate = new Date(year, month, day);
        setSelectedDateForDraft(selectedDate);
        onDateSelect?.(selectedDate);
    };

    const handleSelectDraft = async (draft: TweetDraft, time: string) => {
        if (selectedDateForDraft) {
            // Combine date with selected time
            const [hours, minutes] = time.split(':').map(Number);
            const scheduledDate = new Date(selectedDateForDraft);
            scheduledDate.setHours(hours, minutes, 0, 0);

            // Wait for scheduling to complete before closing
            await onScheduleDraft?.(draft.id, scheduledDate);
            console.log('[TweetCalendarModal] Scheduling draft:', draft.id, 'to', scheduledDate);
        }
        setSelectedDateForDraft(null);
    };

    // Get scheduled tweets for a specific day - from both scheduledTweets prop and drafts with scheduled_at
    const getTweetsForDay = (day: number): ScheduledTweet[] => {
        const result: ScheduledTweet[] = [];

        // Add from scheduledTweets prop
        scheduledTweets.forEach(tweet => {
            const tweetDate = new Date(tweet.date);
            if (tweetDate.getDate() === day &&
                tweetDate.getMonth() === month &&
                tweetDate.getFullYear() === year) {
                result.push(tweet);
            }
        });

        // Add from drafts that have scheduled_at (exclude published)
        drafts.forEach(draft => {
            if (draft.scheduled_at && draft.publish_status !== 'published') {
                const scheduledDate = new Date(draft.scheduled_at);
                if (scheduledDate.getDate() === day &&
                    scheduledDate.getMonth() === month &&
                    scheduledDate.getFullYear() === year) {
                    // Get preview text
                    let text = '';
                    const content = draft.content;
                    if (content.type === 'tweet_draft' && content.data?.drafts?.[0]?.content) {
                        text = content.data.drafts[0].content;
                    } else if (content.type === 'tweet_timeline' && content.data?.timeline?.[0]?.text) {
                        text = content.data.timeline[0].text;
                    } else if (content.text) {
                        text = content.text;
                    }

                    // Format time
                    const hours = scheduledDate.getHours().toString().padStart(2, '0');
                    const minutes = scheduledDate.getMinutes().toString().padStart(2, '0');

                    result.push({
                        id: draft.id,
                        date: scheduledDate,
                        text: text.substring(0, 15),
                        time: `${hours}:${minutes}`
                    });
                }
            }
        });

        // Sort by time
        result.sort((a, b) => {
            if (a.time && b.time) {
                return a.time.localeCompare(b.time);
            }
            return 0;
        });

        return result;
    };

    return ReactDOM.createPortal(
        <div
            data-modal="tweet-calendar"
            style={{
            zIndex: 2147483647,
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            pointerEvents: 'auto'
        }}>
            {/* Background Mask */}
            <div
                style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    backgroundColor: 'rgba(0, 0, 0, 0.4)',
                    zIndex: 0
                }}
                onClick={onClose}
            />

            {/* Modal Container */}
            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    height: '100vh',
                    width: '100vw',
                    position: 'relative',
                    zIndex: 1
                }}
                onClick={onClose}
            >
                <div
                    style={{
                        width: '100%',
                        maxWidth: '1100px',
                        maxHeight: '90vh',
                        backgroundColor: '#fff',
                        borderRadius: '16px',
                        overflow: 'hidden',
                        boxShadow: 'rgba(101, 119, 134, 0.2) 0px 0px 15px, rgba(101, 119, 134, 0.15) 0px 0px 3px 1px',
                        display: 'flex',
                        flexDirection: 'column'
                    }}
                    onClick={(e) => e.stopPropagation()}
                >
                    {/* Header */}
                    <div style={{
                        height: '53px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '0 16px',
                        borderBottom: '1px solid rgb(239, 243, 244)',
                        flexShrink: 0
                    }}>
                        <span style={{
                            fontSize: '20px',
                            fontWeight: 700,
                            color: 'rgb(15, 20, 25)'
                        }}>
                            {t.calendar?.title || 'Tweet Calendar'}
                        </span>

                        {/* Right side: Month Navigation + Close Button */}
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '16px'
                        }}>
                            {/* Month Navigation */}
                            <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px'
                            }}>
                                <button
                                    onClick={goToPreviousMonth}
                                    style={{
                                        backgroundColor: 'transparent',
                                        border: 'none',
                                        padding: '8px',
                                        cursor: 'pointer',
                                        borderRadius: '50%',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center'
                                    }}
                                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(15, 20, 25, 0.1)'}
                                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                                >
                                    <ChevronLeft size={20} color="rgb(15, 20, 25)" />
                                </button>
                                <span style={{
                                    fontSize: '15px',
                                    fontWeight: 600,
                                    color: 'rgb(15, 20, 25)',
                                    minWidth: '100px',
                                    textAlign: 'center'
                                }}>
                                    {language === 'en' ? `${monthNames[month]} ${year}` : `${year}年 ${monthNames[month]}`}
                                </span>
                                <button
                                    onClick={goToNextMonth}
                                    style={{
                                        backgroundColor: 'transparent',
                                        border: 'none',
                                        padding: '8px',
                                        cursor: 'pointer',
                                        borderRadius: '50%',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center'
                                    }}
                                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(15, 20, 25, 0.1)'}
                                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                                >
                                    <ChevronRight size={20} color="rgb(15, 20, 25)" />
                                </button>
                            </div>

                            <button
                                onClick={onClose}
                                style={{
                                    backgroundColor: 'transparent',
                                    border: 'none',
                                    padding: '8px',
                                    cursor: 'pointer',
                                    borderRadius: '50%',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center'
                                }}
                                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(15, 20, 25, 0.1)'}
                                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                            >
                                <X size={20} color="rgb(15, 20, 25)" />
                            </button>
                        </div>
                    </div>

                    {/* Calendar Content */}
                    <div style={{ padding: '16px 24px 24px', flex: 1, overflow: 'auto' }}>

                        {/* Week Days Header */}
                        <div style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(7, 1fr)',
                            gap: '1px',
                            marginBottom: '1px',
                            backgroundColor: 'rgb(239, 243, 244)'
                        }}>
                            {weekDays.map((day, index) => (
                                <div
                                    key={day}
                                    style={{
                                        textAlign: 'center',
                                        fontSize: '12px',
                                        fontWeight: 500,
                                        color: 'rgb(83, 100, 113)',
                                        padding: '6px 0',
                                        backgroundColor: '#fff'
                                    }}
                                >
                                    {day}
                                </div>
                            ))}
                        </div>

                        {/* Calendar Grid */}
                        <div style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
                            gap: '1px',
                            backgroundColor: 'rgb(239, 243, 244)',
                            border: '1px solid rgb(239, 243, 244)'
                        }}>
                            {calendarDays.map((day, index) => {
                                const dayTweets = day ? getTweetsForDay(day) : [];
                                const dayOfWeek = index % 7;
                                const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

                                return (
                                    <div
                                        key={index}
                                        onClick={() => day && handleDateClick(day)}
                                        style={{
                                            minHeight: '120px',
                                            padding: '8px',
                                            backgroundColor: day ? (isToday(day) ? 'rgba(29, 155, 240, 0.05)' : '#fff') : 'rgb(252, 252, 253)',
                                            cursor: day ? 'pointer' : 'default',
                                            transition: 'background-color 0.15s ease',
                                            display: 'flex',
                                            flexDirection: 'column'
                                        }}
                                        onMouseEnter={(e) => {
                                            if (day && !isToday(day)) {
                                                e.currentTarget.style.backgroundColor = 'rgba(29, 155, 240, 0.05)';
                                            }
                                        }}
                                        onMouseLeave={(e) => {
                                            if (day && !isToday(day)) {
                                                e.currentTarget.style.backgroundColor = '#fff';
                                            }
                                        }}
                                    >
                                        {day && (
                                            <>
                                                {/* Date Number */}
                                                <div style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    width: '28px',
                                                    height: '28px',
                                                    borderRadius: '50%',
                                                    fontSize: '14px',
                                                    fontWeight: isToday(day) ? 700 : 400,
                                                    color: isToday(day) ? '#fff' : 'rgb(15, 20, 25)',
                                                    backgroundColor: isToday(day) ? 'rgb(15, 20, 25)' : 'transparent',
                                                    marginBottom: '4px'
                                                }}>
                                                    {day}
                                                </div>

                                                {/* Scheduled Tweets */}
                                                <div style={{ flex: 1, overflow: 'hidden', width: '100%' }}>
                                                    {dayTweets.slice(0, 2).map((tweet, tweetIndex) => (
                                                        <div
                                                            key={tweet.id}
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                // Find full draft data for this tweet
                                                                const draft = drafts.find(d => d.id === tweet.id);
                                                                if (draft) {
                                                                    setSelectedScheduledTweet({
                                                                        id: tweet.id,
                                                                        text: tweet.text,
                                                                        time: tweet.time || '',
                                                                        date: tweet.date
                                                                    });
                                                                }
                                                            }}
                                                            style={{
                                                                backgroundColor: 'rgba(15, 20, 25, 0.08)',
                                                                borderLeft: '3px solid rgb(15, 20, 25)',
                                                                borderRadius: '4px',
                                                                padding: '3px 6px',
                                                                marginBottom: '4px',
                                                                fontSize: '11px',
                                                                color: 'rgb(15, 20, 25)',
                                                                overflow: 'hidden',
                                                                textOverflow: 'ellipsis',
                                                                whiteSpace: 'nowrap',
                                                                maxWidth: '100%',
                                                                cursor: 'pointer'
                                                            }}
                                                            title={tweet.text}
                                                        >
                                                            {tweet.time && (
                                                                <span style={{ color: 'rgb(83, 100, 113)', marginRight: '4px', fontSize: '10px' }}>
                                                                    {tweet.time}
                                                                </span>
                                                            )}
                                                            {tweet.text}
                                                        </div>
                                                    ))}
                                                    {dayTweets.length > 2 && (
                                                        <div style={{
                                                            fontSize: '11px',
                                                            color: 'rgb(15, 20, 25)',
                                                            fontWeight: 500
                                                        }}>
                                                            +{dayTweets.length - 2} {language === 'en' ? 'more' : '更多'}
                                                        </div>
                                                    )}
                                                </div>
                                            </>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            </div>

            {/* Draft Selection Modal */}
            {selectedDateForDraft && (
                <DraftSelectionModal
                    selectedDate={selectedDateForDraft}
                    onClose={() => setSelectedDateForDraft(null)}
                    onSelectDraft={handleSelectDraft}
                    drafts={drafts}
                    currentUser={currentUser}
                />
            )}

            {/* Scheduled Tweet Detail Modal */}
            {selectedScheduledTweet && (() => {
                const draft = drafts.find(d => d.id === selectedScheduledTweet.id);
                if (!draft) return null;

                // Get full text from draft
                let fullText = '';
                const content = draft.content;
                if (content.type === 'tweet_draft' && content.data?.drafts?.[0]?.content) {
                    fullText = content.data.drafts[0].content;
                } else if (content.type === 'tweet_timeline' && content.data?.timeline?.[0]?.text) {
                    fullText = content.data.timeline[0].text;
                } else if (content.text) {
                    fullText = content.text;
                }

                return (
                    <div style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        zIndex: 2147483648,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                    }}>
                        {/* Background */}
                        <div
                            style={{
                                position: 'absolute',
                                top: 0,
                                left: 0,
                                right: 0,
                                bottom: 0,
                                backgroundColor: 'rgba(0, 0, 0, 0.4)'
                            }}
                            onClick={() => setSelectedScheduledTweet(null)}
                        />

                        {/* Modal */}
                        <div style={{
                            position: 'relative',
                            width: '100%',
                            maxWidth: '400px',
                            backgroundColor: '#fff',
                            borderRadius: '16px',
                            overflow: 'hidden',
                            boxShadow: 'rgba(101, 119, 134, 0.2) 0px 0px 15px, rgba(101, 119, 134, 0.15) 0px 0px 3px 1px'
                        }}>
                            {/* Header */}
                            <div style={{
                                padding: '16px',
                                borderBottom: '1px solid rgb(239, 243, 244)',
                                display: 'flex',
                                alignItems: 'flex-start',
                                justifyContent: 'space-between'
                            }}>
                                <div>
                                    <div style={{ fontSize: '17px', fontWeight: 700, color: 'rgb(15, 20, 25)', marginBottom: '4px' }}>
                                        {language === 'en' ? 'Scheduled Tweet' : '计划推文'}
                                    </div>
                                    <div style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '6px',
                                        color: 'rgb(83, 100, 113)',
                                        fontSize: '13px'
                                    }}>
                                        <Calendar size={14} />
                                        <span>
                                            {selectedScheduledTweet.date.toLocaleDateString(language === 'en' ? 'en-US' : 'zh-CN', {
                                                year: 'numeric',
                                                month: 'long',
                                                day: 'numeric'
                                            })}
                                            {' '}
                                            {selectedScheduledTweet.time}
                                        </span>
                                    </div>
                                </div>
                                <button
                                    onClick={() => setSelectedScheduledTweet(null)}
                                    style={{
                                        backgroundColor: 'transparent',
                                        border: 'none',
                                        padding: '8px',
                                        cursor: 'pointer',
                                        borderRadius: '50%',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center'
                                    }}
                                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(15, 20, 25, 0.1)'}
                                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                                >
                                    <X size={20} color="rgb(15, 20, 25)" />
                                </button>
                            </div>

                            {/* Content */}
                            <div style={{ padding: '16px' }}>
                                {/* Tweet Preview */}
                                <div style={{
                                    display: 'flex',
                                    gap: '12px',
                                    padding: '12px',
                                    backgroundColor: 'rgb(247, 249, 249)',
                                    borderRadius: '12px'
                                }}>
                                    <img
                                        src={currentUser?.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=user`}
                                        alt="avatar"
                                        style={{
                                            width: '40px',
                                            height: '40px',
                                            borderRadius: '50%',
                                            backgroundColor: 'rgb(207, 217, 222)',
                                            objectFit: 'cover',
                                            flexShrink: 0
                                        }}
                                    />
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '4px' }}>
                                            <span style={{ fontWeight: 700, fontSize: '15px', color: 'rgb(15, 20, 25)' }}>
                                                {currentUser?.name || 'You'}
                                            </span>
                                            {currentUser?.verified && (
                                                <svg viewBox="0 0 22 22" style={{ width: '18px', height: '18px', fill: 'rgb(29, 155, 240)' }}>
                                                    <path d="M20.396 11c-.018-.646-.215-1.275-.57-1.816-.354-.54-.852-.972-1.438-1.246.223-.607.27-1.264.14-1.897-.131-.634-.437-1.218-.882-1.687-.47-.445-1.053-.75-1.687-.882-.633-.13-1.29-.083-1.897.14-.273-.587-.704-1.086-1.245-1.44S11.647 1.62 11 1.604c-.646.017-1.273.213-1.813.568s-.969.97-1.245 1.44c-.606-.223-1.264-.27-1.897-.14-.634.13-1.218.437-1.687.882-.445.469-.751 1.053-.882 1.687-.13.633-.083 1.29.14 1.897-.586.274-1.084.705-1.439 1.246-.354.54-.55 1.17-.569 1.816.017.647.215 1.276.569 1.817.355.54.853.971 1.439 1.245-.223.606-.27 1.263-.14 1.897.131.634.437 1.218.882 1.687.47.445 1.053.75 1.687.882.633.13 1.29.083 1.897-.14.276.587.705 1.086 1.245 1.44.54.354 1.167.55 1.813.568.647-.018 1.275-.214 1.816-.569.54-.354.972-.853 1.245-1.44.606.223 1.264.27 1.897.14.634-.13 1.218-.437 1.687-.882.445-.469.75-1.053.882-1.687.13-.633.083-1.29-.14-1.897.587-.274 1.087-.705 1.438-1.245.355-.54.552-1.17.57-1.817zM9.662 14.85l-3.429-3.428 1.293-1.302 2.072 2.072 4.4-4.794 1.347 1.246z"></path>
                                                </svg>
                                            )}
                                            <span style={{ fontSize: '15px', color: 'rgb(83, 100, 113)' }}>
                                                {currentUser?.handle || '@you'}
                                            </span>
                                        </div>
                                        <div style={{
                                            fontSize: '15px',
                                            color: 'rgb(15, 20, 25)',
                                            lineHeight: 1.5,
                                            whiteSpace: 'pre-wrap',
                                            wordBreak: 'break-word'
                                        }}>
                                            {fullText}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Footer Buttons */}
                            <div style={{
                                padding: '16px',
                                borderTop: '1px solid rgb(239, 243, 244)',
                                display: 'flex',
                                justifyContent: 'space-between',
                                gap: '12px'
                            }}>
                                {/* Preview Button - Left */}
                                <button
                                    onClick={() => setShowScheduledPreview(true)}
                                    style={{
                                        padding: '6px 16px',
                                        fontSize: '13px',
                                        fontWeight: 700,
                                        color: 'rgb(15, 20, 25)',
                                        backgroundColor: 'transparent',
                                        border: '1px solid rgb(207, 217, 222)',
                                        borderRadius: '9999px',
                                        cursor: 'pointer',
                                        transition: 'background-color 0.15s ease'
                                    }}
                                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(15, 20, 25, 0.1)'}
                                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                                >
                                    {language === 'en' ? 'Preview' : '预览'}
                                </button>

                                {/* Remove Button - Right */}
                                <button
                                    onClick={() => {
                                        if (onUnscheduleDraft) {
                                            onUnscheduleDraft(selectedScheduledTweet.id);
                                        }
                                        setSelectedScheduledTweet(null);
                                    }}
                                    style={{
                                        padding: '6px 16px',
                                        fontSize: '13px',
                                        fontWeight: 700,
                                        border: '1px solid rgb(253, 201, 206)',
                                        borderRadius: '9999px',
                                        backgroundColor: 'transparent',
                                        color: 'rgb(244, 33, 46)',
                                        cursor: 'pointer',
                                        transition: 'background-color 0.15s ease'
                                    }}
                                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(244, 33, 46, 0.1)'}
                                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                                >
                                    {language === 'en' ? 'Remove' : '移除'}
                                </button>
                            </div>
                        </div>
                    </div>
                );
            })()}

            {/* Scheduled Tweet Full Preview Modal */}
            {showScheduledPreview && selectedScheduledTweet && (() => {
                const draft = drafts.find(d => d.id === selectedScheduledTweet.id);
                if (!draft) return null;

                // Get all timeline items from draft
                const getTimelineItems = (d: TweetDraft): string[] => {
                    const content = d.content;
                    if (content.type === 'tweet_timeline' && content.data?.timeline) {
                        return content.data.timeline.map((item: any) => item.text || '');
                    }
                    if (content.type === 'tweet_draft' && content.data?.drafts?.[0]?.content) {
                        return [content.data.drafts[0].content];
                    }
                    if (content.text) return [content.text];
                    return [''];
                };

                const items = getTimelineItems(draft);

                // Render text with hashtags in Twitter blue
                const renderTextWithHashtags = (text: string) => {
                    const parts = text.split(/(#\w+)/g);
                    return parts.map((part, index) => {
                        if (part.startsWith('#')) {
                            return <span key={index} style={{ color: 'rgb(29, 155, 240)' }}>{part}</span>;
                        }
                        return part;
                    });
                };

                return (
                    <div style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        zIndex: 2147483649,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                    }}>
                        {/* Background */}
                        <div
                            style={{
                                position: 'absolute',
                                top: 0,
                                left: 0,
                                right: 0,
                                bottom: 0,
                                backgroundColor: 'rgba(0, 0, 0, 0.4)'
                            }}
                            onClick={() => setShowScheduledPreview(false)}
                        />

                        {/* Preview Modal Container */}
                        <div style={{
                            position: 'relative',
                            maxWidth: '600px',
                            width: '100%',
                        }}>
                            {/* Back Button - Left side of modal */}
                            <button
                                onClick={() => setShowScheduledPreview(false)}
                                style={{
                                    position: 'absolute',
                                    left: '-52px',
                                    top: '4px',
                                    backgroundColor: 'rgba(255, 255, 255, 0.9)',
                                    border: 'none',
                                    padding: '8px',
                                    cursor: 'pointer',
                                    borderRadius: '50%',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.15)'
                                }}
                                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 1)'}
                                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.9)'}
                            >
                                <ChevronLeft size={18} color="rgb(15, 20, 25)" />
                            </button>

                            {/* Preview Modal */}
                            <div style={{
                                width: '100%',
                                minHeight: '300px',
                                maxHeight: '80vh',
                                backgroundColor: '#fff',
                                borderRadius: '16px',
                                overflow: 'hidden',
                                boxShadow: 'rgba(101, 119, 134, 0.2) 0px 0px 15px, rgba(101, 119, 134, 0.15) 0px 0px 3px 1px',
                                display: 'flex',
                                flexDirection: 'column'
                            }}>
                                {/* Full Thread Preview */}
                                <div style={{ flex: 1, overflow: 'auto', padding: '16px 0' }}>
                                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                                        {items.map((text, index) => {
                                            const isLast = index === items.length - 1;
                                            return (
                                                <div
                                                    key={index}
                                                    style={{
                                                        display: 'flex',
                                                        gap: '12px',
                                                        padding: '12px 20px'
                                                    }}
                                                >
                                                    {/* Avatar with connecting line */}
                                                    <div style={{
                                                        display: 'flex',
                                                        flexDirection: 'column',
                                                        alignItems: 'center',
                                                        flexShrink: 0,
                                                        width: '40px',
                                                        position: 'relative'
                                                    }}>
                                                        {/* The connecting line - absolute positioned */}
                                                        {!isLast && items.length > 1 && (
                                                            <div style={{
                                                                position: 'absolute',
                                                                top: '48px',
                                                                bottom: '-8px',
                                                                left: '50%',
                                                                transform: 'translateX(-50%)',
                                                                width: '2px',
                                                                backgroundColor: 'rgb(207, 217, 222)'
                                                            }} />
                                                        )}
                                                        <img
                                                            src={currentUser?.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=user`}
                                                            alt="avatar"
                                                            style={{
                                                                width: '40px',
                                                                height: '40px',
                                                                borderRadius: '50%',
                                                                backgroundColor: 'rgb(207, 217, 222)',
                                                                objectFit: 'cover',
                                                                position: 'relative',
                                                                zIndex: 1
                                                            }}
                                                        />
                                                    </div>

                                                    {/* Content */}
                                                    <div style={{ flex: 1, minWidth: 0 }}>
                                                        {/* Header Row */}
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '4px' }}>
                                                            <span style={{ fontWeight: 700, fontSize: '15px', color: 'rgb(15, 20, 25)' }}>
                                                                {currentUser?.name || 'You'}
                                                            </span>
                                                            {currentUser?.verified && (
                                                                <svg viewBox="0 0 22 22" aria-label="Verified account" role="img" style={{ width: '18px', height: '18px', fill: 'rgb(29, 155, 240)' }}>
                                                                    <g>
                                                                        <path d="M20.396 11c-.018-.646-.215-1.275-.57-1.816-.354-.54-.852-.972-1.438-1.246.223-.607.27-1.264.14-1.897-.131-.634-.437-1.218-.882-1.687-.47-.445-1.053-.75-1.687-.882-.633-.13-1.29-.083-1.897.14-.273-.587-.704-1.086-1.245-1.44S11.647 1.62 11 1.604c-.646.017-1.273.213-1.813.568s-.969.97-1.245 1.44c-.606-.223-1.264-.27-1.897-.14-.634.13-1.218.437-1.687.882-.445.469-.751 1.053-.882 1.687-.13.633-.083 1.29.14 1.897-.586.274-1.084.705-1.439 1.246-.354.54-.55 1.17-.569 1.816.017.647.215 1.276.569 1.817.355.54.853.971 1.439 1.245-.223.606-.27 1.263-.14 1.897.131.634.437 1.218.882 1.687.47.445 1.053.75 1.687.882.633.13 1.29.083 1.897-.14.276.587.705 1.086 1.245 1.44.54.354 1.167.55 1.813.568.647-.018 1.275-.214 1.816-.569.54-.354.972-.853 1.245-1.44.606.223 1.264.27 1.897.14.634-.13 1.218-.437 1.687-.882.445-.469.75-1.053.882-1.687.13-.633.083-1.29-.14-1.897.587-.274 1.087-.705 1.438-1.245.355-.54.552-1.17.57-1.817zM9.662 14.85l-3.429-3.428 1.293-1.302 2.072 2.072 4.4-4.794 1.347 1.246z"></path>
                                                                    </g>
                                                                </svg>
                                                            )}
                                                            <span style={{ fontSize: '15px', color: 'rgb(83, 100, 113)' }}>
                                                                {currentUser?.handle || '@you'}
                                                            </span>
                                                        </div>

                                                        {/* Tweet Text */}
                                                        <div style={{
                                                            fontSize: '15px',
                                                            color: 'rgb(15, 20, 25)',
                                                            lineHeight: 1.5,
                                                            whiteSpace: 'pre-wrap',
                                                            wordBreak: 'break-word'
                                                        }}>
                                                            {renderTextWithHashtags(text)}
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                );
            })()}
        </div>,
        document.body
    );
}
