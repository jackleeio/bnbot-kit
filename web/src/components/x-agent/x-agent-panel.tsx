'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  PencilIcon,
  XMarkIcon,
  ChevronLeftIcon,
  RocketLaunchIcon,
  Cog6ToothIcon,
  MagnifyingGlassIcon,
  CalendarIcon,
  SparklesIcon,
  ChevronRightIcon,
} from '@heroicons/react/24/outline';
import Image from 'next/image';
import bnbotAI from '@/assets/images/logo/bnbot-ai.jpg';

import { TweetDraft, SearchedTweet, TwitterUserInfo } from '@/types/x-agent';
import TweetCardModal from './tweet-card-modal';

type PanelView = 'viral-tweet' | 'advanced-search' | 'task';

type TaskFrequency = 'once' | 'daily' | 'weekly' | 'monthly' | 'yearly';
type NotificationType = 'email-app' | 'email' | 'app' | 'off';
type DayOfWeek = 'sunday' | 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday';

interface ScheduledTask {
  id: string;
  name: string;
  frequency: TaskFrequency;
  time: string;
  day: DayOfWeek;
  instructions: string;
  notifications: NotificationType;
  lastRun?: string;
  lastResult?: string;
  createdAt: string;
}

interface TaskTemplate {
  id: string;
  name: string;
  schedule: string;
  description: string;
}

// Search related types
type SearchStatus = 'idle' | 'searching' | 'completed' | 'error';

interface SearchProgressLog {
  id: string;
  timestamp: string;
  message: string;
  status: 'pending' | 'completed' | 'error';
}



interface SearchResults {
  user: TwitterUserInfo;
  tweets: SearchedTweet[];
  totalTweets: number;
  avgImpressions: number;
  totalImpressions: number;
  avgEngagementRate: number;
  avgEngagements: number;
  queryDuration: number;
}

interface XAgentPanelProps {
  tweetText: string | null;
  selectedDraft?: TweetDraft | null;
  onEdit?: (newText: string) => void;
  onSave?: (text: string) => void;
  onPublish?: (text: string) => void;
  onClose?: () => void;
  isMobile?: boolean;
  // Agent settings props
  agentEnabled?: boolean;
  agentLanguage?: 'en' | 'zh';
  telegramConnected?: boolean;
  isTelegramLoading?: boolean;
  isFetchingSettings?: boolean;
  onToggleAgent?: (enabled: boolean) => void;
  onLanguageChange?: (lang: 'en' | 'zh') => void;
  onTelegramConnect?: () => void;
  isLoggedIn?: boolean;
  onLogin?: () => void;
  // Image generation props
  onGenerateImage?: (prompt: string, tweetContent?: string) => void;
  isGeneratingImage?: boolean;
  generatedImageUrl?: string | null;
  // View state props (lifted from parent to preserve across mobile/desktop switch)
  currentView?: PanelView;
  onViewChange?: (view: PanelView) => void;
  // New chat callback
  onNewChat?: () => void;
  hasMessages?: boolean;
}

const dedupeHashtags = (
  hashtags: (string | undefined | null)[] = [],
): string[] => {
  return Array.from(
    new Set(
      hashtags.filter((tag): tag is string => Boolean(tag && tag.trim())),
    ),
  ).map((tag) => tag.trim());
};

const composeTweetWithHashtags = (text: string, hashtags: string[]): string => {
  const base = text.trim();
  const activeTags = hashtags.filter(Boolean);
  if (activeTags.length === 0) {
    return base;
  }
  const hashtagsLine = activeTags.join(' ');
  return `${base}${base ? '\n\n' : ''}${hashtagsLine}`.trim();
};

const parseTweetText = (
  text?: string | null,
): { baseText: string; hashtags: string[] } => {
  if (!text) return { baseText: '', hashtags: [] };
  const trimmed = text.trimEnd();
  const hashtagBlockRegex = /(\n\s*)+((?:#[^\s#]+(?:\s+|$))+)$/.exec(trimmed);
  if (!hashtagBlockRegex) {
    return { baseText: trimmed, hashtags: [] };
  }
  const block = hashtagBlockRegex[2] || '';
  const hashtags = dedupeHashtags(
    block.split(/\s+/).filter((token) => token.startsWith('#')),
  );
  const baseText = trimmed.slice(0, hashtagBlockRegex.index).trimEnd();
  return { baseText, hashtags };
};

const formatTweetContent = (text: string): React.ReactNode => {
  if (!text) return ' ';
  const parts = text.split(/(#[^\s#]+)/g);
  return parts.map((part, index) =>
    part.startsWith('#') ? (
      <span key={`tweet-hashtag-${index}`} className="text-[#1d9bf0]">
        {part}
      </span>
    ) : (
      part
    ),
  );
};

// Custom DatePicker Component
interface DatePickerProps {
  value: string;
  onChange: (date: string) => void;
  placeholder?: string;
  align?: 'left' | 'right';
  onOpenChange?: (isOpen: boolean) => void;
}

const DatePicker: React.FC<DatePickerProps> = ({ value, onChange, placeholder = 'Select date', align = 'left', onOpenChange }) => {
  const [isOpen, setIsOpen] = useState(false);

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
    onOpenChange?.(open);
  };
  const [currentMonth, setCurrentMonth] = useState(() => {
    if (value) {
      const [year, month] = value.split('-').map(Number);
      return new Date(year, month - 1, 1);
    }
    return new Date();
  });
  const containerRef = useRef<HTMLDivElement>(null);

  const daysInMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0).getDate();
  const firstDayOfMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1).getDay();

  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dayNames = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        handleOpenChange(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handlePrevMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1));
  };

  const handleNextMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1));
  };

  const handleDateSelect = (day: number) => {
    const year = currentMonth.getFullYear();
    const month = String(currentMonth.getMonth() + 1).padStart(2, '0');
    const dayStr = String(day).padStart(2, '0');
    onChange(`${year}-${month}-${dayStr}`);
    handleOpenChange(false);
  };

  const formatDisplayDate = (dateStr: string) => {
    if (!dateStr) return '';
    const [year, month, day] = dateStr.split('-');
    return `${year}/${month}/${day}`;
  };

  const isSelectedDate = (day: number) => {
    if (!value) return false;
    const [year, month, dayStr] = value.split('-').map(Number);
    return year === currentMonth.getFullYear() && month === currentMonth.getMonth() + 1 && dayStr === day;
  };

  const isToday = (day: number) => {
    const today = new Date();
    return today.getFullYear() === currentMonth.getFullYear() &&
      today.getMonth() === currentMonth.getMonth() &&
      today.getDate() === day;
  };

  // Generate calendar days
  const calendarDays = [];
  // Empty cells for days before first day of month
  for (let i = 0; i < firstDayOfMonth; i++) {
    calendarDays.push(<div key={`empty-${i}`} className="h-8 w-8" />);
  }
  // Days of the month
  for (let day = 1; day <= daysInMonth; day++) {
    const selected = isSelectedDate(day);
    const today = isToday(day);
    calendarDays.push(
      <button
        key={day}
        onClick={() => handleDateSelect(day)}
        className={`h-8 w-8 rounded-full text-sm font-medium transition-all ${selected
          ? 'bg-gray-900 text-white'
          : today
            ? 'bg-gray-100 text-gray-900 hover:bg-gray-200'
            : 'text-gray-700 hover:bg-gray-100'
          }`}
      >
        {day}
      </button>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <div
        onClick={() => handleOpenChange(!isOpen)}
        className="flex w-full cursor-pointer items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm transition-colors hover:border-gray-300"
      >
        <CalendarIcon className="h-4 w-4 text-gray-400" />
        <span className={value ? 'text-gray-900' : 'text-gray-400'}>
          {value ? formatDisplayDate(value) : placeholder}
        </span>
      </div>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.15 }}
            className={`absolute top-full z-50 mt-2 w-72 rounded-2xl border border-gray-200 bg-white p-4 shadow-xl ${align === 'right' ? 'right-0' : 'left-0'}`}
          >
            {/* Header */}
            <div className="mb-4 flex items-center justify-between">
              <button
                onClick={handlePrevMonth}
                className="rounded-full p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
              >
                <ChevronLeftIcon className="h-4 w-4" />
              </button>
              <span className="text-sm font-semibold text-gray-900">
                {monthNames[currentMonth.getMonth()]} {currentMonth.getFullYear()}
              </span>
              <button
                onClick={handleNextMonth}
                className="rounded-full p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
              >
                <ChevronRightIcon className="h-4 w-4" />
              </button>
            </div>

            {/* Day names */}
            <div className="mb-2 grid grid-cols-7 gap-1">
              {dayNames.map((day) => (
                <div key={day} className="flex h-8 w-8 items-center justify-center text-xs font-medium text-gray-400">
                  {day}
                </div>
              ))}
            </div>

            {/* Calendar grid */}
            <div className="grid grid-cols-7 gap-1">
              {calendarDays}
            </div>

            {/* Footer */}
            <div className="mt-4 flex items-center justify-between border-t border-gray-100 pt-3">
              <button
                onClick={() => {
                  onChange('');
                  handleOpenChange(false);
                }}
                className="text-xs font-medium text-gray-500 transition-colors hover:text-gray-700"
              >
                Clear
              </button>
              <button
                onClick={() => {
                  const today = new Date();
                  const year = today.getFullYear();
                  const month = String(today.getMonth() + 1).padStart(2, '0');
                  const day = String(today.getDate()).padStart(2, '0');
                  onChange(`${year}-${month}-${day}`);
                  handleOpenChange(false);
                }}
                className="text-xs font-medium text-gray-900 transition-colors hover:text-gray-700"
              >
                Today
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const XAgentPanel: React.FC<XAgentPanelProps> = ({
  tweetText,
  selectedDraft,
  onEdit,
  onSave,
  onPublish,
  onClose,
  isMobile = false,
  agentEnabled = true,
  agentLanguage = 'en',
  telegramConnected = false,
  isTelegramLoading = false,
  isFetchingSettings = false,
  onToggleAgent,
  onLanguageChange,
  onTelegramConnect,
  isLoggedIn = true,
  onLogin,
  onGenerateImage,
  isGeneratingImage = false,
  generatedImageUrl,
  currentView: controlledView,
  onViewChange,
  onNewChat,
  hasMessages = false,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editedText, setEditedText] = useState('');
  const [availableHashtags, setAvailableHashtags] = useState<string[]>([]);
  const [selectedHashtags, setSelectedHashtags] = useState<string[]>([]);
  const [charCount, setCharCount] = useState(0);
  const composedTweet = composeTweetWithHashtags(editedText, selectedHashtags);
  const isTweetTooLong = charCount > 280;
  const canPublish = composedTweet.trim().length > 0 && !isTweetTooLong;
  const editorRef = useRef<HTMLDivElement>(null);
  const skipBlurSaveRef = useRef(false);
  const shouldSyncEditorRef = useRef(false);

  const deriveInitialState = useCallback(() => {
    const parsedTweet = parseTweetText(tweetText);
    const draftContent = (selectedDraft?.content || '').trim();
    const draftHashtags = dedupeHashtags(selectedDraft?.hashtags || []);
    const baseText = tweetText ? parsedTweet.baseText : draftContent;
    const combinedHashtags = dedupeHashtags([
      ...(parsedTweet.hashtags || []),
      ...draftHashtags,
    ]);
    const initialSelected = tweetText ? parsedTweet.hashtags : draftHashtags;
    return {
      text: baseText,
      availableHashtags: combinedHashtags,
      selectedHashtags: initialSelected,
    };
  }, [selectedDraft, tweetText]);

  useEffect(() => {
    if (isEditing) {
      return;
    }
    const initial = deriveInitialState();
    setEditedText(initial.text);
    setAvailableHashtags(initial.availableHashtags);
    setSelectedHashtags(initial.selectedHashtags);
    setCharCount(
      composeTweetWithHashtags(initial.text, initial.selectedHashtags).length,
    );
    shouldSyncEditorRef.current = true;
  }, [deriveInitialState, isEditing]);

  useEffect(() => {
    if (!isEditing || !editorRef.current) return;
    if (!shouldSyncEditorRef.current) return;
    shouldSyncEditorRef.current = false;
    const element = editorRef.current;
    element.innerText =
      composeTweetWithHashtags(editedText, selectedHashtags) || '';
    requestAnimationFrame(() => {
      element.focus();
      if (typeof window === 'undefined') return;
      const selection = window.getSelection();
      if (!selection) return;
      const range = document.createRange();
      range.selectNodeContents(element);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    });
  }, [isEditing, editedText, selectedHashtags]);

  const handleTextChange = useCallback(
    (value: string) => {
      shouldSyncEditorRef.current = false;
      const sanitized = value.replace(/\s+$/, '');
      const parsed = parseTweetText(sanitized);
      setEditedText(parsed.baseText);
      setSelectedHashtags(parsed.hashtags);
      setAvailableHashtags((prev) =>
        dedupeHashtags([...prev, ...parsed.hashtags]),
      );
      const combined = composeTweetWithHashtags(
        parsed.baseText,
        parsed.hashtags,
      );
      setCharCount(combined.length);
      if (onEdit) {
        onEdit(combined);
      }
    },
    [onEdit],
  );

  const handleContentEditableInput = () => {
    const element = editorRef.current;
    if (!element) return;
    handleTextChange(element.innerText || '');
  };

  const toggleHashtag = (tag: string) => {
    shouldSyncEditorRef.current = true;
    setSelectedHashtags((prev) => {
      const exists = prev.includes(tag);
      const next = exists
        ? prev.filter((item) => item !== tag)
        : [...prev, tag];
      const orderForTag = (value: string) => {
        const index = availableHashtags.indexOf(value);
        return index === -1 ? Number.MAX_SAFE_INTEGER : index;
      };
      const orderedNext = next.sort((a, b) => orderForTag(a) - orderForTag(b));
      const combined = composeTweetWithHashtags(editedText, orderedNext);
      setCharCount(combined.length);
      if (onEdit) {
        onEdit(combined);
      }
      if (onSave) {
        onSave(combined);
      }
      return orderedNext;
    });
  };

  const handleSave = useCallback(() => {
    const composed = composeTweetWithHashtags(editedText, selectedHashtags);
    const length = composed.length;
    setCharCount(length);
    if (length > 280) {
      if (editorRef.current) {
        editorRef.current.focus();
      }
      return;
    }
    setIsEditing(false);
    if (onSave) {
      onSave(composed);
    }
  }, [editedText, onSave, selectedHashtags]);

  const handleCancel = useCallback(() => {
    skipBlurSaveRef.current = true;
    const initial = deriveInitialState();
    setEditedText(initial.text);
    setAvailableHashtags(initial.availableHashtags);
    setSelectedHashtags(initial.selectedHashtags);
    const composed = composeTweetWithHashtags(
      initial.text,
      initial.selectedHashtags,
    );
    setCharCount(composed.length);
    setIsEditing(false);
    requestAnimationFrame(() => {
      skipBlurSaveRef.current = false;
    });
  }, [deriveInitialState]);

  const handleEditorBlur = (e: React.FocusEvent<HTMLDivElement>) => {
    if (!isEditing) return;
    if (skipBlurSaveRef.current) {
      return;
    }

    const related = e.relatedTarget as Node | null;
    const container = editorRef.current?.closest(
      '[data-tweet-preview-container="true"]',
    );
    if (related && container && container.contains(related)) {
      return;
    }

    handleSave();
  };

  const handleHeaderButtonClick = () => {
    if (isEditing) {
      handleCancel();
    } else {
      shouldSyncEditorRef.current = true;
      setIsEditing(true);
      requestAnimationFrame(() => {
        editorRef.current?.focus();
      });
    }
  };

  const handlePublish = () => {
    const composed = composeTweetWithHashtags(editedText, selectedHashtags);
    if (!composed.trim()) {
      return;
    }
    const length = composed.length;
    setCharCount(length);
    if (length > 280) {
      if (editorRef.current) {
        editorRef.current.focus();
      }
      return;
    }
    if (onPublish) {
      onPublish(composed);
    }
    if (typeof window !== 'undefined') {
      const intentUrl = new URL('https://x.com/intent/tweet');
      intentUrl.searchParams.set('text', composed);
      window.open(intentUrl.toString(), '_blank', 'noopener,noreferrer');
    }
  };

  // State for panel navigation (supports controlled/uncontrolled mode)
  const [internalView, setInternalView] = useState<PanelView>('viral-tweet');
  const currentView = controlledView ?? internalView;
  const setCurrentView = (view: PanelView) => {
    if (onViewChange) {
      onViewChange(view);
    } else {
      setInternalView(view);
    }
  };
  const [showSettingsDropdown, setShowSettingsDropdown] = useState(false);
  const settingsDropdownRef = useRef<HTMLDivElement>(null);
  const [searchUsername, setSearchUsername] = useState('');
  const [searchFromDate, setSearchFromDate] = useState('');
  const [searchToDate, setSearchToDate] = useState('');
  const [activeDatePicker, setActiveDatePicker] = useState<'from' | 'to' | null>(null);

  // Search functionality state
  const [searchStatus, setSearchStatus] = useState<SearchStatus>('idle');
  const [searchProgressLogs, setSearchProgressLogs] = useState<SearchProgressLog[]>([]);
  const [searchResults, setSearchResults] = useState<SearchResults | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [showSearchToast, setShowSearchToast] = useState(false);
  const [searchToastMessage, setSearchToastMessage] = useState('');
  const [currentFetchingPage, setCurrentFetchingPage] = useState(0);
  const [searchContentFilter, setSearchContentFilter] = useState('');
  const [searchSortField, setSearchSortField] = useState<'postedAt' | 'replies' | 'retweets' | 'likes' | 'impressions'>('postedAt');
  const [searchSortOrder, setSearchSortOrder] = useState<'asc' | 'desc'>('desc');
  const [searchCursor, setSearchCursor] = useState<string | null>(null);
  const [hasMoreResults, setHasMoreResults] = useState(false);

  // Refs for tracking search state during recursive calls
  const searchCursorRef = useRef<string | null>(null);
  const searchResultsRef = useRef<SearchResults | null>(null);
  const currentFetchingPageRef = useRef(0);

  // Sync refs with state
  useEffect(() => {
    searchCursorRef.current = searchCursor;
  }, [searchCursor]);

  useEffect(() => {
    searchResultsRef.current = searchResults;
  }, [searchResults]);

  useEffect(() => {
    currentFetchingPageRef.current = currentFetchingPage;
  }, [currentFetchingPage]);

  const [selectedViralTweetId, setSelectedViralTweetId] = useState<number | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showDraftsPanel, setShowDraftsPanel] = useState(false);
  const [draftsTab, setDraftsTab] = useState<'drafts' | 'schedule' | 'posted'>('drafts');

  // Modal state
  const [selectedTweetForModal, setSelectedTweetForModal] = useState<SearchedTweet | null>(null);
  const [showTweetModal, setShowTweetModal] = useState(false);

  // Task management state
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [taskForm, setTaskForm] = useState({
    name: '',
    frequency: 'daily' as TaskFrequency,
    time: '04:50',
    day: 'saturday' as DayOfWeek,
    instructions: '',
    notifications: 'email-app' as NotificationType,
  });
  const [showNotificationDropdown, setShowNotificationDropdown] = useState(false);
  const [showDayDropdown, setShowDayDropdown] = useState(false);
  const [clockMode, setClockMode] = useState<'hour' | 'minute'>('minute'); // Which dial to show

  // Task templates
  const taskTemplates: TaskTemplate[] = [
    {
      id: 'newsletter',
      name: 'Create a Custom Newsletter',
      schedule: 'Saturdays at 7:30am',
      description: 'Provide a concise summary of the top news stories from the past 24 hours, focusing on {{politics, technology,...',
    },
    {
      id: 'stock-tracker',
      name: 'Create a Daily Stock Tracker',
      schedule: 'Daily at 2:10pm',
      description: 'Give me the latest updates on {{$TSLA, $BTC, $NVDA, $PLTR, $ETH}}, including current price, recent changes...',
    },
  ];

  // Mock drafts data
  const mockDrafts = [
    { id: 1, content: 'The future of DeFi is looking bright...', status: 'draft' },
    { id: 2, content: 'AI is rapidly evolving, transforming industries and...', status: 'draft' },
    { id: 3, content: 'Hey, this is a sample draft - try editing it!', status: 'draft' },
    { id: 4, content: 'Market analysis thread coming soon 🧵', status: 'draft' },
  ];

  // Mock viral tweets data - 爆款推文
  const allViralTweets = [
    {
      id: 1,
      author: 'CZ',
      handle: '@caborin',
      content: 'The future of finance is decentralized. We\'re just getting started. 🚀',
      likes: '12.5K',
      retweets: '3.2K',
      views: '1.2M',
    },
    {
      id: 2,
      author: 'Vitalik',
      handle: '@VitalikButerin',
      content: 'Layer 2 solutions are the key to mass adoption. The technology is finally ready.',
      likes: '8.9K',
      retweets: '2.1K',
      views: '890K',
    },
    {
      id: 3,
      author: 'SBF',
      handle: '@SBF_FTX',
      content: 'AI + Crypto = The next trillion dollar opportunity. Here\'s why...',
      likes: '15.2K',
      retweets: '4.5K',
      views: '2.1M',
    },
    {
      id: 4,
      author: 'Elon',
      handle: '@elonmusk',
      content: 'Memes are the DNA of the soul. Also, $DOGE to the moon 🐕',
      likes: '245K',
      retweets: '42K',
      views: '15M',
    },
    {
      id: 5,
      author: 'Cobie',
      handle: '@coaborin',
      content: 'Stop chasing pumps. Start building conviction. The real gains come from patience.',
      likes: '6.8K',
      retweets: '1.8K',
      views: '520K',
    },
    {
      id: 6,
      author: 'Arthur',
      handle: '@CryptoHayes',
      content: 'Central banks will print. Bitcoin will pump. It\'s that simple.',
      likes: '9.3K',
      retweets: '2.7K',
      views: '780K',
    },
    {
      id: 7,
      author: 'Punk6529',
      handle: '@punk6529',
      content: 'NFTs are not about JPEGs. They\'re about digital property rights.',
      likes: '11.2K',
      retweets: '3.5K',
      views: '950K',
    },
    {
      id: 8,
      author: 'Ansem',
      handle: '@blknoiz06',
      content: 'Solana ecosystem is cooking. The speed advantage is undeniable.',
      likes: '7.4K',
      retweets: '2.3K',
      views: '620K',
    },
    {
      id: 9,
      author: 'Hsaka',
      handle: '@HsakaTrades',
      content: 'Chart patterns don\'t lie. The setup is forming. Are you ready?',
      likes: '5.6K',
      retweets: '1.4K',
      views: '380K',
    },
  ];

  const [viralTweets, setViralTweets] = useState(allViralTweets.slice(0, 6));

  // Helper function to add progress log
  const addProgressLog = (message: string, status: 'pending' | 'completed' | 'error' = 'completed') => {
    const now = new Date();
    const timestamp = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
    const log: SearchProgressLog = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp,
      message,
      status,
    };
    setSearchProgressLogs(prev => [...prev, log]);
    return log.id;
  };

  // Helper function to update progress log status
  const updateProgressLog = (logId: string, status: 'pending' | 'completed' | 'error') => {
    setSearchProgressLogs(prev => prev.map(log =>
      log.id === logId ? { ...log, status } : log
    ));
  };

  // Helper function to show toast
  const showToast = (message: string, duration: number = 3000) => {
    setSearchToastMessage(message);
    setShowSearchToast(true);
    setTimeout(() => setShowSearchToast(false), duration);
  };

  // Helper function to reset search state
  const resetSearch = () => {
    setSearchStatus('idle');
    setSearchProgressLogs([]);
    setSearchResults(null);
    setSearchError(null);
    setCurrentFetchingPage(0);
    setSearchCursor(null);
    setHasMoreResults(false);
  };

  // Extract username from input (supports x.com/username format)
  const extractUsername = (input: string): string => {
    const trimmed = input.trim();
    // Handle x.com/username or twitter.com/username format
    const urlMatch = trimmed.match(/(?:x\.com|twitter\.com)\/(@?[\w]+)/i);
    if (urlMatch) {
      return urlMatch[1].replace('@', '');
    }
    // Handle @username or plain username
    return trimmed.replace('@', '');
  };

  const handleSearch = async (loadMore = false) => {
    const username = extractUsername(searchUsername);

    if (!username) {
      showToast('Please enter a username', 3000);
      return;
    }

    // Validate date range - minimum 14 days
    if (!loadMore && searchFromDate && searchToDate) {
      const fromDate = new Date(searchFromDate);
      const toDate = new Date(searchToDate);
      const diffTime = toDate.getTime() - fromDate.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      if (diffDays < 14) {
        showToast('Date range must be at least 14 days', 3000);
        return;
      }
    }

    // Reset previous search state if not loading more
    // Reset previous search state if not loading more
    if (!loadMore) {
      resetSearch();
      // Also reset refs for new search
      searchCursorRef.current = null;
      searchResultsRef.current = null;
      currentFetchingPageRef.current = 0;
    }
    setSearchStatus('searching');

    const startTime = Date.now();

    try {
      // Get access token for authentication
      const headers: HeadersInit = {
        'Content-Type': 'application/json',
        'x-public-key': process.env.NEXT_PUBLIC_X_PUBLIC_API_KEY || '',
      };

      // Step 1: Fetch user info first (only on initial search, not load more)
      let userInfo: TwitterUserInfo | null = null;
      if (!loadMore) {
        addProgressLog('Starting tweet search...');
        const userInfoLogId = addProgressLog('Fetching user information...', 'pending');

        try {
          const userInfoResponse = await fetch(
            `${process.env.NEXT_PUBLIC_REST_API_ENDPOINT}/api/v1/x-public/user-info?username=${username}`,
            { headers, credentials: 'include' }
          );

          if (userInfoResponse.ok) {
            const userInfoData = await userInfoResponse.json();
            console.log('User info response:', userInfoData);
            if (userInfoData.code === 1 && userInfoData.data) {
              const userData = userInfoData.data;
              userInfo = {
                id: userData.rest_id || userData.id || '',
                name: userData.name || username,
                username: userData.username || username,
                profileImageUrl: userData.avatar || userData.profile_image_url || '',
                description: userData.description || '',
                followersCount: userData.followers_count || 0,
                followingCount: userData.following_count || 0,
                tweetCount: userData.tweet_count || 0,
                verified: userData.is_verified ?? userData.verified ?? false,
              };
              console.log('User verified status:', userData.is_verified, userData.verified, userInfo.verified);
              updateProgressLog(userInfoLogId, 'completed');
              addProgressLog(`User info fetched: @${username}`);
            } else {
              updateProgressLog(userInfoLogId, 'error');
            }
          } else {
            updateProgressLog(userInfoLogId, 'error');
          }
        } catch (userInfoError) {
          console.error('Failed to fetch user info:', userInfoError);
          updateProgressLog(userInfoLogId, 'error');
        }
      }

      // Step 2: Fetch tweets
      // Build search query with Twitter search syntax
      // Format: from:username since:YYYY-MM-DD until:YYYY-MM-DD min_faves:1000 -filter:retweets
      let searchQuery = `from:${username}`;
      if (searchFromDate) {
        // Ensure date is in YYYY-MM-DD format
        const formattedFrom = searchFromDate.replace(/\//g, '-');
        searchQuery += ` since:${formattedFrom}`;
      }
      if (searchToDate) {
        // Ensure date is in YYYY-MM-DD format
        const formattedTo = searchToDate.replace(/\//g, '-');
        searchQuery += ` until:${formattedTo}`;
      }
      searchQuery += ' min_faves:1000 -filter:retweets';

      console.log('Executing search with query:', searchQuery);

      // Build query params for /api/v1/x-public/search
      const params = new URLSearchParams({
        q: searchQuery,
        type: 'Top', // Get top tweets
      });

      // Add cursor for pagination if loading more
      if (loadMore && searchCursorRef.current) {
        params.append('cursor', searchCursorRef.current);
      }

      // Add fetching page log with pending status
      const pageNum = loadMore ? currentFetchingPageRef.current + 1 : 1;
      const fetchingLogId = addProgressLog(`Fetching page ${pageNum}...`, 'pending');
      setCurrentFetchingPage(pageNum);
      currentFetchingPageRef.current = pageNum;

      // Make API call to x-public search endpoint
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_REST_API_ENDPOINT}/api/v1/x-public/search?${params.toString()}`,
        { headers, credentials: 'include' }
      );

      if (!response.ok) {
        const errorText = await response.text().catch(() => response.statusText);
        console.error('Search API failed:', response.status, errorText);

        if (response.status === 401) {
          throw new Error('Please login to search tweets');
        }
        if (response.status === 404) {
          throw new Error('Not Found');
        }
        throw new Error(`Search failed: ${response.status} ${errorText.substring(0, 100)}`);
      }

      const data = await response.json();

      // Update fetching log to completed
      updateProgressLog(fetchingLogId, 'completed');

      if (data.code !== 1) {
        console.error('API returned non-success code:', data);
        throw new Error(data.msg || 'Search failed');
      }

      const queryDuration = (Date.now() - startTime) / 1000;

      // Transform API response to our format
      // Response format: { code: 1, data: [...tweets], cursors: { top, bottom }, msg: "SUCCESS" }
      const tweetsData = data.data || [];
      console.log('Raw tweets data sample (media check):', tweetsData.length > 0 ? {
        id: tweetsData[0].id_str,
        text: tweetsData[0].text,
        media: tweetsData[0].media
      } : 'No tweets found');

      const tweets: SearchedTweet[] = tweetsData.map((tweet: {
        id_str?: string;
        text?: string;
        created_at?: string;
        reply_count?: number;
        retweet_count?: number;
        like_count?: number;
        quote_count?: number;
        view_count?: string | number;
        media?: Array<{ url: string; type: string; thumbnail?: string }>;
        user?: {
          rest_id?: string;
          name?: string;
          username?: string;
          avatar?: string;
          description?: string;
          followers_count?: number;
          following_count?: number;
          tweet_count?: number;
          is_verified?: boolean;
          created_at?: string;
        };
      }) => ({
        id: tweet.id_str || String(Math.random()),
        content: tweet.text || '',
        postedAt: tweet.created_at || '',
        media: tweet.media && tweet.media.length > 0 ? tweet.media[0].type : null,
        mediaDetails: tweet.media?.map(m => ({
          type: m.type,
          url: m.url,
          thumbnail: m.thumbnail,
        })),
        replies: tweet.reply_count || 0,
        retweets: tweet.retweet_count || 0,
        likes: tweet.like_count || 0,
        impressions: typeof tweet.view_count === 'string' ? parseInt(tweet.view_count, 10) || 0 : tweet.view_count || 0,
        url: `https://x.com/${username}/status/${tweet.id_str}`,
      }));

      console.log('Mapped tweets first item:', tweets.length > 0 ? {
        id: tweets[0].id,
        media: tweets[0].media,
        mediaDetails: tweets[0].mediaDetails,
        hasMediaDetails: !!tweets[0].mediaDetails
      } : 'No mapped tweets');

      // Use user info from API call, or fall back to first tweet user, or create default
      // For load more, use existing searchResults user info
      let user: TwitterUserInfo;
      if (loadMore && searchResultsRef.current) {
        user = searchResultsRef.current.user;
      } else if (userInfo) {
        user = userInfo;
      } else {
        // Fall back to first tweet user data or default
        const firstTweetUser = tweetsData[0]?.user;
        user = firstTweetUser ? {
          id: firstTweetUser.rest_id || '',
          name: firstTweetUser.name || username,
          username: firstTweetUser.username || username,
          profileImageUrl: firstTweetUser.avatar || '',
          description: firstTweetUser.description || '',
          followersCount: firstTweetUser.followers_count || 0,
          followingCount: firstTweetUser.following_count || 0,
          tweetCount: firstTweetUser.tweet_count || 0,
          verified: firstTweetUser.is_verified || false,
        } : {
          id: '',
          name: username,
          username: username,
          profileImageUrl: '',
          description: '',
          followersCount: 0,
          followingCount: 0,
          tweetCount: 0,
          verified: false,
        };
      }

      // Handle cursor for pagination
      const cursors = data.cursors;
      const nextCursor = cursors?.bottom || null;
      const hasMore = !!nextCursor;

      // Merge tweets if loading more
      const currentResults = searchResultsRef.current;
      const allTweets = loadMore && currentResults ? [...currentResults.tweets, ...tweets] : tweets;

      // Calculate stats
      const totalImpressions = allTweets.reduce((sum: number, t: SearchedTweet) => sum + t.impressions, 0);
      const totalEngagements = allTweets.reduce((sum: number, t: SearchedTweet) => sum + t.replies + t.retweets + t.likes, 0);
      const avgImpressions = allTweets.length > 0 ? Math.round(totalImpressions / allTweets.length) : 0;
      const avgEngagements = allTweets.length > 0 ? Math.round(totalEngagements / allTweets.length) : 0;
      const avgEngagementRate = totalImpressions > 0 ? (totalEngagements / totalImpressions) * 100 : 0;

      const results: SearchResults = {
        user,
        tweets: allTweets,
        totalTweets: allTweets.length,
        avgImpressions,
        totalImpressions,
        avgEngagementRate,
        avgEngagements,
        queryDuration,
      };

      setSearchResults(results);
      searchResultsRef.current = results; // Update ref immediately for next iteration

      // Auto-load more if we haven't reached 100 tweets and there are more results
      const TARGET_TWEETS = 100;
      if (allTweets.length < TARGET_TWEETS && hasMore && nextCursor) {
        setSearchCursor(nextCursor);
        searchCursorRef.current = nextCursor; // Update ref immediately
        setHasMoreResults(true);
        // Continue fetching automatically
        setTimeout(() => {
          handleSearch(true);
        }, 500); // Small delay to avoid rate limiting
      } else {
        // Done fetching - either reached 100 or no more results
        setSearchCursor(null);
        searchCursorRef.current = null;
        setHasMoreResults(false);
        setSearchStatus('completed');
        if (!loadMore) {
          addProgressLog(`User info fetched: @${username}`);
        }
        addProgressLog(`Fetching complete: ${allTweets.length} tweets loaded`);
        showToast(`Search completed! Found ${allTweets.length} tweets`, 4000);
      }

    } catch (error) {
      console.error('Search error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Search failed';
      addProgressLog(errorMessage, 'error');
      setSearchError(errorMessage);
      setSearchStatus('error');
      showToast(`Error: ${errorMessage}`, 5000);
    }
  };

  const handleRefreshViralTweets = () => {
    setIsRefreshing(true);
    setSelectedViralTweetId(null);
    // Simulate refresh with random shuffle
    setTimeout(() => {
      const shuffled = [...allViralTweets].sort(() => Math.random() - 0.5);
      setViralTweets(shuffled.slice(0, 6));
      setIsRefreshing(false);
    }, 500);
  };

  const handleRandomPick = () => {
    const randomIndex = Math.floor(Math.random() * viralTweets.length);
    setSelectedViralTweetId(viralTweets[randomIndex].id);
  };

  // Task handlers
  const handleCreateTask = () => {
    if (!taskForm.name.trim()) return;

    const newTask: ScheduledTask = {
      id: Date.now().toString(),
      name: taskForm.name,
      frequency: taskForm.frequency,
      time: taskForm.time,
      day: taskForm.day,
      instructions: taskForm.instructions,
      notifications: taskForm.notifications,
      createdAt: new Date().toISOString(),
    };

    setTasks([...tasks, newTask]);
    setShowTaskModal(false);
    setTaskForm({
      name: '',
      frequency: 'daily',
      time: '04:50',
      day: 'saturday',
      instructions: '',
      notifications: 'email-app',
    });
  };

  const handleTaskClick = (taskId: string) => {
    setSelectedTaskId(taskId);
  };

  const handleCloseTaskDetail = () => {
    setSelectedTaskId(null);
  };

  const handleDeleteTask = (taskId: string) => {
    setTasks(tasks.filter(t => t.id !== taskId));
    if (selectedTaskId === taskId) {
      setSelectedTaskId(null);
    }
  };

  const getFrequencyLabel = (freq: TaskFrequency) => {
    const labels: Record<TaskFrequency, string> = {
      once: 'Once',
      daily: 'Daily',
      weekly: 'Weekly',
      monthly: 'Monthly',
      yearly: 'Yearly',
    };
    return labels[freq];
  };

  const getNotificationLabel = (notif: NotificationType) => {
    const labels: Record<NotificationType, string> = {
      'email-app': 'Email + App',
      'email': 'Email Only',
      'app': 'App Only',
      'off': 'Off',
    };
    return labels[notif];
  };

  const formatTaskSchedule = (task: ScheduledTask) => {
    const freq = getFrequencyLabel(task.frequency);
    const [hour, minute] = task.time.split(':');
    const hourNum = parseInt(hour);
    const ampm = hourNum >= 12 ? 'pm' : 'am';
    const hour12 = hourNum % 12 || 12;
    return `${freq} at ${hour12}:${minute}${ampm}`;
  };

  // Render navigation header for empty state
  const renderNavigationHeader = () => (
    <div className="relative">
      <div className="flex items-center justify-end md:justify-between border-b border-gray-100/60 bg-white px-4 py-3">
        <div className="hidden md:flex items-center gap-1">
          <button
            onClick={onNewChat}
            disabled={!hasMessages}
            className={`rounded-full p-1.5 transition-colors ${hasMessages ? 'hover:bg-gray-100 cursor-pointer' : 'cursor-default'}`}
            title="New Chat"
          >
            <svg viewBox="0 0 24 24" className={`h-5 w-5 ${hasMessages ? 'text-gray-700' : 'text-gray-300'}`} fill="none" stroke="currentColor" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 20.25c4.97 0 9-3.694 9-8.25s-4.03-8.25-9-8.25S3 7.444 3 12c0 2.104.859 4.023 2.273 5.48.432.447.74 1.04.586 1.641a4.483 4.483 0 01-.923 1.785A5.969 5.969 0 006 21c1.282 0 2.47-.402 3.445-1.087.81.22 1.668.337 2.555.337z" />
            </svg>
          </button>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setCurrentView('viral-tweet')}
            className={`text-sm font-medium transition-colors ${currentView === 'viral-tweet'
              ? 'text-gray-900'
              : 'text-gray-400 hover:text-gray-600'
              }`}
          >
            Viral Tweet
          </button>
          <button
            onClick={() => setCurrentView('advanced-search')}
            className={`text-sm font-medium transition-colors ${currentView === 'advanced-search'
              ? 'text-gray-900'
              : 'text-gray-400 hover:text-gray-600'
              }`}
          >
            Advanced Search
          </button>
          <button
            onClick={() => setCurrentView('task')}
            className={`text-sm font-medium transition-colors ${currentView === 'task'
              ? 'text-gray-900'
              : 'text-gray-400 hover:text-gray-600'
              }`}
          >
            Task
          </button>
          <button
            onClick={() => setShowSettingsDropdown(!showSettingsDropdown)}
            className={`rounded-full p-1.5 transition-colors hover:bg-gray-100 ${showSettingsDropdown ? 'bg-gray-100 text-gray-900' : 'text-gray-400 hover:text-gray-600'
              }`}
            title="Settings"
          >
            <Cog6ToothIcon className="h-5 w-5" />
          </button>
        </div>
      </div>
      {/* Settings Dropdown Panel */}
      <AnimatePresence>
        {showSettingsDropdown && (
          <motion.div
            ref={settingsDropdownRef}
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-full z-50 w-80 rounded-b-2xl border border-t-0 border-gray-200 bg-white p-4 shadow-lg"
          >
            {renderSettingsContent()}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );

  // Render Drafts Panel
  const renderDraftsPanel = () => (
    <div className={`flex h-full flex-col border-l border-gray-100 bg-white ${isMobile ? 'w-full' : 'w-64'}`}>
      {/* Header with close button on mobile */}
      {isMobile && (
        <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
          <span className="text-sm font-medium text-gray-900">Drafts</span>
          <button
            onClick={() => setShowDraftsPanel(false)}
            className="rounded-full p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>
      )}
      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-gray-100 px-3 py-2">
        {(['drafts', 'schedule', 'posted'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setDraftsTab(tab)}
            className={`rounded-full px-3 py-1.5 text-xs font-medium capitalize transition-colors ${draftsTab === tab
              ? 'bg-gray-100 text-gray-900'
              : 'text-gray-400 hover:text-gray-600'
              }`}
          >
            {tab === 'drafts' ? 'Drafts' : tab === 'schedule' ? 'Schedule' : 'Posted'}
          </button>
        ))}
      </div>

      {/* New Draft Button */}
      <div className="border-b border-gray-100 px-3 py-2">
        <button className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          New draft
        </button>
      </div>

      {/* Drafts List */}
      <div className="flex-1 overflow-y-auto">
        {mockDrafts.map((draft, index) => (
          <div
            key={draft.id}
            className={`cursor-pointer border-l-2 px-3 py-3 transition-colors hover:bg-gray-50 ${index === 0 ? 'border-l-orange-400 bg-gray-50' : 'border-l-transparent'
              }`}
          >
            <p className="line-clamp-2 text-sm text-gray-700">{draft.content}</p>
            {index === 1 && (
              <div className="mt-2">
                <svg viewBox="0 0 24 24" className="h-4 w-4 text-gray-400" fill="currentColor">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </svg>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );

  // Render Viral Tweet view
  const renderViralTweetView = () => (
    <div className="flex-1 overflow-y-auto px-4 py-5">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Viral Tweets</h2>
          <p className="text-sm text-gray-500">Discover trending content ideas</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleRandomPick}
            className="flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 12c0-1.232-.046-2.453-.138-3.662a4.006 4.006 0 00-3.7-3.7 48.678 48.678 0 00-7.324 0 4.006 4.006 0 00-3.7 3.7c-.017.22-.032.441-.046.662M19.5 12l3-3m-3 3l-3-3m-12 3c0 1.232.046 2.453.138 3.662a4.006 4.006 0 003.7 3.7 48.656 48.656 0 007.324 0 4.006 4.006 0 003.7-3.7c.017-.22.032-.441.046-.662M4.5 12l3 3m-3-3l-3 3" />
            </svg>
            Random
          </button>
          <button
            onClick={handleRefreshViralTweets}
            disabled={isRefreshing}
            className={`flex items-center gap-1.5 rounded-full bg-gray-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-800 ${isRefreshing ? 'cursor-not-allowed opacity-70' : ''}`}
          >
            <svg className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
            </svg>
            {isRefreshing ? 'Refreshing...' : 'Refresh'}
          </button>
          <button
            onClick={() => setShowDraftsPanel(!showDraftsPanel)}
            className={`rounded-full p-2 transition-colors hover:bg-gray-100 ${showDraftsPanel ? 'text-gray-900' : 'text-gray-400 hover:text-gray-600'}`}
            title="Drafts"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25H12" />
            </svg>
          </button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
        {viralTweets.map((tweet) => {
          const isSelected = selectedViralTweetId === tweet.id;
          return (
            <div
              key={tweet.id}
              onClick={() => setSelectedViralTweetId(isSelected ? null : tweet.id)}
              className={`cursor-pointer overflow-hidden rounded-xl border bg-white p-2 transition-all hover:shadow-md ${isSelected
                ? 'border-[#f0b90b] ring-2 ring-[#f0b90b]/20 shadow-lg'
                : 'border-gray-200 hover:border-gray-300'
                }`}
            >
              {/* Selection indicator */}
              {isSelected && (
                <div className="mb-2 flex justify-end">
                  <div className="flex h-5 w-5 items-center justify-center rounded-full bg-[#f0b90b]">
                    <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                </div>
              )}
              {/* Tweet Content */}
              <p className="mb-2 line-clamp-3 text-sm leading-snug text-gray-700">
                {tweet.content}
              </p>
              {/* Views */}
              <div className="flex items-center gap-1 text-xs text-gray-500">
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                {tweet.views}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  // Format number with K/M suffix
  const formatNumber = (num: number): string => {
    if (num >= 1000000) {
      return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
    }
    if (num >= 1000) {
      return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
    }
    return num.toLocaleString();
  };

  // Format date for display
  const formatTweetDate = (dateStr: string): string => {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    return `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
  };

  // Get filtered and sorted tweets
  const getFilteredTweets = (): SearchedTweet[] => {
    if (!searchResults) return [];
    let filtered = [...searchResults.tweets];

    // Apply content filter
    if (searchContentFilter.trim()) {
      const filterLower = searchContentFilter.toLowerCase();
      filtered = filtered.filter(tweet =>
        tweet.content.toLowerCase().includes(filterLower)
      );
    }

    // Apply sorting
    filtered.sort((a, b) => {
      const aVal = a[searchSortField];
      const bVal = b[searchSortField];
      if (searchSortField === 'postedAt') {
        const aDate = new Date(aVal as string).getTime() || 0;
        const bDate = new Date(bVal as string).getTime() || 0;
        return searchSortOrder === 'desc' ? bDate - aDate : aDate - bDate;
      }
      return searchSortOrder === 'desc'
        ? (bVal as number) - (aVal as number)
        : (aVal as number) - (bVal as number);
    });

    return filtered;
  };

  // Handle sort toggle
  const handleSortToggle = (field: typeof searchSortField) => {
    if (searchSortField === field) {
      setSearchSortOrder(prev => prev === 'desc' ? 'asc' : 'desc');
    } else {
      setSearchSortField(field);
      setSearchSortOrder('desc');
    }
  };

  // Render search form
  const renderSearchForm = () => (
    <div className="w-full rounded-2xl border border-gray-200 bg-white p-4 shadow-sm md:p-6">
      <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <h3 className="text-base font-semibold text-gray-900">Search Tweets</h3>
          <p className="text-sm text-gray-500">Fetch and analyze tweets from any public Twitter account</p>
        </div>
        <span className="flex items-center gap-1 text-sm font-medium text-emerald-500">
          <SparklesIcon className="h-4 w-4" />
          10 Free Searches
        </span>
      </div>
      <div className="space-y-3 md:space-y-0 md:flex md:items-start md:gap-3">
        {/* Username field */}
        <div className="w-full md:flex-1">
          <label className="mb-1.5 block text-xs font-medium text-gray-700">Username</label>
          <div className="relative">
            <MagnifyingGlassIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={searchUsername}
              onChange={(e) => setSearchUsername(e.target.value)}
              placeholder="e.g. elonmusk"
              disabled={searchStatus === 'searching'}
              className="w-full rounded-xl border border-gray-200 bg-white py-2.5 pl-10 pr-4 text-sm text-gray-900 placeholder-gray-400 outline-none transition-colors focus:border-gray-300 focus:ring-1 focus:ring-gray-200 disabled:bg-gray-50 disabled:cursor-not-allowed"
            />
          </div>
          <p className="mt-1 text-xs text-gray-400">Also supports x.com/username</p>
        </div>
        {/* Date fields row */}
        <div className="flex gap-3 md:flex-1">
          <div className="flex-1">
            <label className="mb-1.5 block text-xs font-medium text-gray-700">From</label>
            <DatePicker
              value={searchFromDate}
              onChange={setSearchFromDate}
              placeholder="YYYY/MM/DD"
              onOpenChange={(isOpen) => {
                if (isOpen) setActiveDatePicker('from');
                else if (activeDatePicker === 'from') setActiveDatePicker(null);
              }}
              key={activeDatePicker === 'to' ? 'from-closed' : 'from-open'}
            />
          </div>
          <div className="flex-1">
            <label className="mb-1.5 block text-xs font-medium text-gray-700">To</label>
            <DatePicker
              value={searchToDate}
              onChange={setSearchToDate}
              placeholder="YYYY/MM/DD"
              align="right"
              onOpenChange={(isOpen) => {
                if (isOpen) setActiveDatePicker('to');
                else if (activeDatePicker === 'to') setActiveDatePicker(null);
              }}
              key={activeDatePicker === 'from' ? 'to-closed' : 'to-open'}
            />
          </div>
        </div>
        {/* Search button */}
        <div className="md:pt-[22px]">
          <button
            onClick={() => handleSearch()}
            disabled={searchStatus === 'searching'}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-gray-900 px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-gray-800 disabled:bg-gray-400 disabled:cursor-not-allowed md:w-auto"
          >
            {searchStatus === 'searching' ? (
              <>
                <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Searching...
              </>
            ) : (
              <>
                <MagnifyingGlassIcon className="h-4 w-4" />
                Search
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );

  // Render progress view
  const renderProgressView = () => (
    <div className="mt-4 w-full rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="mb-4">
        <h3 className="text-base font-semibold text-gray-900">Fetching Progress</h3>
        <p className="text-sm text-gray-500">
          {currentFetchingPage > 0 ? `Fetching page ${currentFetchingPage}...` : 'Initializing...'}
        </p>
      </div>
      <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
        <div className="space-y-2">
          {searchProgressLogs.map((log) => (
            <div key={log.id} className="flex items-start gap-3">
              <div className="flex-shrink-0 mt-0.5">
                {log.status === 'completed' ? (
                  <svg className="h-4 w-4 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                ) : log.status === 'error' ? (
                  <svg className="h-4 w-4 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                ) : (
                  <svg className="h-4 w-4 text-blue-500 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="text-xs text-gray-400">{log.timestamp}</span>
                  <span className={`text-sm ${log.status === 'error' ? 'text-red-600' : 'text-gray-700'}`}>
                    {log.message}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  // Render results view
  const renderResultsView = () => {
    if (!searchResults) return null;
    const filteredTweets = getFilteredTweets();

    return (
      <div className="mt-4 space-y-4">
        {/* Stats Cards */}
        <div className="grid grid-cols-4 gap-4">
          <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-gray-500">Total Tweets</span>
              <svg className="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <div className="text-2xl font-bold text-gray-900">{searchResults.totalTweets}</div>
            <div className="text-xs text-gray-400">Found {searchResults.totalTweets} tweets</div>
          </div>
          <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-gray-500">Avg Impressions</span>
              <svg className="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <div className="text-2xl font-bold text-gray-900">{formatNumber(searchResults.avgImpressions)}</div>
            <div className="text-xs text-gray-400">Total {formatNumber(searchResults.totalImpressions)} impressions</div>
          </div>
          <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-gray-500">Avg Engagement Rate</span>
              <svg className="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 01-1.043 3.296 3.745 3.745 0 01-3.296 1.043A3.745 3.745 0 0112 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 01-3.296-1.043 3.745 3.745 0 01-1.043-3.296A3.745 3.745 0 013 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 011.043-3.296 3.746 3.746 0 013.296-1.043A3.746 3.746 0 0112 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 013.296 1.043 3.746 3.746 0 011.043 3.296A3.745 3.745 0 0121 12z" />
              </svg>
            </div>
            <div className="text-2xl font-bold text-gray-900">{searchResults.avgEngagementRate.toFixed(2)}%</div>
            <div className="text-xs text-gray-400">Avg {formatNumber(searchResults.avgEngagements)} engagements</div>
          </div>
          <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-gray-500">Duration</span>
              <svg className="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div className="text-2xl font-bold text-gray-900">{searchResults.queryDuration.toFixed(1)}sec</div>
            <div className="text-xs text-gray-400">Query time</div>
          </div>
        </div>

        {/* User Profile Card */}
        <div className="rounded-xl border border-gray-100 bg-gray-50 p-6">
          <div className="flex items-center gap-4">
            <div className="flex-shrink-0">
              {searchResults.user.profileImageUrl ? (
                <img
                  src={searchResults.user.profileImageUrl}
                  alt={searchResults.user.name}
                  width={64}
                  height={64}
                  className="rounded-full object-cover"
                />
              ) : (
                <div className="h-16 w-16 rounded-full bg-gray-200 flex items-center justify-center">
                  <span className="text-xl font-bold text-gray-400">
                    {searchResults.user.name.charAt(0).toUpperCase()}
                  </span>
                </div>
              )}
              {searchResults.user.description && (
                <p className="mt-2 text-xs text-gray-500 max-w-[200px] line-clamp-2">{searchResults.user.description}</p>
              )}
            </div>
            <div className="flex-1 text-center">
              <div className="flex items-center justify-center gap-2">
                <span className="text-lg font-bold text-gray-900">{searchResults.user.name}</span>
                {searchResults.user.verified && (
                  <svg className="h-5 w-5 text-[#1d9bf0]" viewBox="0 0 22 22" fill="currentColor">
                    <path d="M20.396 11c-.018-.646-.215-1.275-.57-1.816-.354-.54-.852-.972-1.438-1.246.223-.607.27-1.264.14-1.897-.131-.634-.437-1.218-.882-1.687-.47-.445-1.053-.75-1.687-.882-.633-.13-1.29-.083-1.897.14-.273-.587-.704-1.086-1.245-1.44S11.647 1.62 11 1.604c-.646.017-1.273.213-1.813.568s-.969.854-1.24 1.44c-.608-.223-1.267-.272-1.902-.14-.635.13-1.22.436-1.69.882-.445.47-.749 1.055-.878 1.688-.13.633-.08 1.29.144 1.896-.587.274-1.087.705-1.443 1.245-.356.54-.555 1.17-.574 1.817.02.647.218 1.276.574 1.817.356.54.856.972 1.443 1.245-.224.606-.274 1.263-.144 1.896.13.634.433 1.218.877 1.688.47.443 1.054.747 1.687.878.633.132 1.29.084 1.897-.136.274.586.705 1.084 1.246 1.439.54.354 1.17.551 1.816.569.647-.016 1.276-.213 1.817-.567s.972-.854 1.245-1.44c.604.239 1.266.296 1.903.164.636-.132 1.22-.447 1.68-.907.46-.46.776-1.044.908-1.681s.075-1.299-.165-1.903c.586-.274 1.084-.705 1.439-1.246.354-.54.551-1.17.569-1.816zM9.662 14.85l-3.429-3.428 1.293-1.302 2.072 2.072 4.4-4.794 1.347 1.246z" />
                  </svg>
                )}
                <span className="text-sm text-gray-500">@{searchResults.user.username}</span>
              </div>
              <div className="mt-3 flex items-center justify-center gap-6">
                <div>
                  <span className="font-bold text-gray-900">{formatNumber(searchResults.user.followersCount)}</span>
                  <span className="ml-1 text-sm text-gray-500">Followers</span>
                </div>
                <div>
                  <span className="font-bold text-gray-900">{formatNumber(searchResults.user.followingCount)}</span>
                  <span className="ml-1 text-sm text-gray-500">Following</span>
                </div>
                <div>
                  <span className="font-bold text-gray-900">{formatNumber(searchResults.user.tweetCount)}</span>
                  <span className="ml-1 text-sm text-gray-500">Tweets</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Search Results Table */}
        <div className="rounded-xl border border-gray-100 bg-white">
          <div className="flex items-center justify-between border-b border-gray-100 p-4">
            <div>
              <h3 className="font-semibold text-gray-900">Search Results</h3>
              <p className="text-sm text-gray-500">{filteredTweets.length} tweets found for @{searchResults.user.username}</p>
            </div>
            <div className="flex items-center gap-3">
              <div className="relative">
                <MagnifyingGlassIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={searchContentFilter}
                  onChange={(e) => setSearchContentFilter(e.target.value)}
                  placeholder="Search tweet content..."
                  className="w-48 rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm text-gray-900 placeholder-gray-400 outline-none transition-colors focus:border-gray-300"
                />
              </div>
              <button
                onClick={resetSearch}
                className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
              >
                <XMarkIcon className="h-4 w-4" />
                Clear
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Tweet Content</th>
                  <th
                    className="cursor-pointer px-4 py-3 text-left text-xs font-medium text-gray-500 hover:text-gray-700"
                    onClick={() => handleSortToggle('postedAt')}
                  >
                    <span className="flex items-center gap-1">
                      Posted At
                      {searchSortField === 'postedAt' && (
                        <svg className={`h-3 w-3 ${searchSortOrder === 'desc' ? '' : 'rotate-180'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      )}
                    </span>
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Media</th>
                  <th
                    className="cursor-pointer px-4 py-3 text-center text-xs font-medium text-gray-500 hover:text-gray-700"
                    onClick={() => handleSortToggle('replies')}
                  >
                    <span className="flex items-center justify-center gap-1">
                      Replies
                      {searchSortField === 'replies' && (
                        <svg className={`h-3 w-3 ${searchSortOrder === 'desc' ? '' : 'rotate-180'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      )}
                    </span>
                  </th>
                  <th
                    className="cursor-pointer px-4 py-3 text-center text-xs font-medium text-gray-500 hover:text-gray-700"
                    onClick={() => handleSortToggle('retweets')}
                  >
                    <span className="flex items-center justify-center gap-1">
                      Retweets
                      {searchSortField === 'retweets' && (
                        <svg className={`h-3 w-3 ${searchSortOrder === 'desc' ? '' : 'rotate-180'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      )}
                    </span>
                  </th>
                  <th
                    className="cursor-pointer px-4 py-3 text-center text-xs font-medium text-gray-500 hover:text-gray-700"
                    onClick={() => handleSortToggle('likes')}
                  >
                    <span className="flex items-center justify-center gap-1">
                      Likes
                      {searchSortField === 'likes' && (
                        <svg className={`h-3 w-3 ${searchSortOrder === 'desc' ? '' : 'rotate-180'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      )}
                    </span>
                  </th>
                  <th
                    className="cursor-pointer px-4 py-3 text-center text-xs font-medium text-gray-500 hover:text-gray-700"
                    onClick={() => handleSortToggle('impressions')}
                  >
                    <span className="flex items-center justify-center gap-1">
                      Impressions
                      {searchSortField === 'impressions' && (
                        <svg className={`h-3 w-3 ${searchSortOrder === 'desc' ? '' : 'rotate-180'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      )}
                    </span>
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredTweets.map((tweet) => (
                  <tr
                    key={tweet.id}
                    className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer transition-colors"
                    onClick={() => {
                      setSelectedTweetForModal(tweet);
                      setShowTweetModal(true);
                    }}
                  >
                    <td className="px-4 py-3">
                      <p className="max-w-xs text-sm text-gray-700 line-clamp-2">{tweet.content}</p>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">
                      {formatTweetDate(tweet.postedAt)}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500">
                      {tweet.media || '-'}
                    </td>
                    <td className="px-4 py-3 text-center text-sm text-gray-700">
                      {formatNumber(tweet.replies)}
                    </td>
                    <td className="px-4 py-3 text-center text-sm text-gray-700">
                      {formatNumber(tweet.retweets)}
                    </td>
                    <td className="px-4 py-3 text-center text-sm text-gray-700">
                      {formatNumber(tweet.likes)}
                    </td>
                    <td className="px-4 py-3 text-center text-sm text-gray-700">
                      {formatNumber(tweet.impressions)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-2">
                        <a
                          href={tweet.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="rounded p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
                          title="View on X"
                        >
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                          </svg>
                        </a>
                        <button
                          className="rounded p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
                          title="Use as reference"
                        >
                          <SparklesIcon className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filteredTweets.length === 0 && (
              <div className="py-12 text-center">
                <p className="text-sm text-gray-500">No tweets found matching your filter.</p>
              </div>
            )}
          </div>



          <TweetCardModal
            isOpen={showTweetModal}
            onClose={() => setShowTweetModal(false)}
            tweet={selectedTweetForModal}
            user={searchResults.user}
          />
        </div>
      </div>
    );
  };

  // Render Advanced Search view
  const renderAdvancedSearchView = () => (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Toast notification */}
      <AnimatePresence>
        {showSearchToast && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="fixed left-1/2 top-4 z-50 -translate-x-1/2"
          >
            <div className="flex items-center gap-2 rounded-xl bg-white px-4 py-3 shadow-lg border border-gray-100">
              <svg className="h-5 w-5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="text-sm font-medium text-emerald-600">{searchToastMessage}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex-1 overflow-y-auto p-6 pb-4 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
        {/* Search Form */}
        {renderSearchForm()}

        {/* Progress View - shown while searching */}
        {searchStatus === 'searching' && renderProgressView()}

        {/* Results View - shown after search completes */}
        {searchStatus === 'completed' && searchResults && renderResultsView()}

        {/* Error View */}
        {searchStatus === 'error' && (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4">
            <div className="flex items-center gap-2">
              <svg className="h-5 w-5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <span className="text-sm font-medium text-red-700">{searchError}</span>
            </div>
            <button
              onClick={resetSearch}
              className="mt-3 text-sm font-medium text-red-600 hover:text-red-700"
            >
              Try again
            </button>
          </div>
        )}
      </div>
    </div>
  );

  // Format time for display (12-hour format)
  const formatTimeDisplay = (time: string) => {
    const [hour, minute] = time.split(':').map(Number);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const hour12 = hour % 12 || 12;
    return `${hour12}:${minute.toString().padStart(2, '0')} ${ampm}`;
  };

  // State for time picker
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [isDraggingClock, setIsDraggingClock] = useState(false);
  const timePickerRef = useRef<HTMLDivElement>(null);
  const clockRef = useRef<HTMLDivElement>(null);
  const notificationDropdownRef = useRef<HTMLDivElement>(null);
  const dayDropdownRef = useRef<HTMLDivElement>(null);
  const taskNameInputRef = useRef<HTMLInputElement>(null);

  // Handle clock drag for precise minute selection
  const handleClockDrag = useCallback((e: MouseEvent | React.MouseEvent) => {
    if (!clockRef.current) return;

    const rect = clockRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    const x = e.clientX - centerX;
    const y = e.clientY - centerY;

    // Calculate angle in degrees (0 at top, clockwise)
    let angle = Math.atan2(x, -y) * (180 / Math.PI);
    if (angle < 0) angle += 360;

    if (clockMode === 'minute') {
      // Convert angle to minutes (0-59)
      const minute = Math.round(angle / 6) % 60;
      setTaskForm(prev => ({ ...prev, time: `${prev.time.split(':')[0]}:${minute.toString().padStart(2, '0')}` }));
    } else {
      // Convert angle to hours (1-12)
      let hour = Math.round(angle / 30) % 12;
      if (hour === 0) hour = 12;
      const currentHour = parseInt(taskForm.time.split(':')[0]);
      const isPM = currentHour >= 12;
      let newHour = hour;
      if (isPM && hour !== 12) newHour += 12;
      if (!isPM && hour === 12) newHour = 0;
      setTaskForm(prev => ({ ...prev, time: `${newHour.toString().padStart(2, '0')}:${prev.time.split(':')[1]}` }));
    }
  }, [clockMode, taskForm.time]);

  // Mouse event handlers for clock dragging
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDraggingClock) {
        handleClockDrag(e);
      }
    };

    const handleMouseUp = () => {
      setIsDraggingClock(false);
    };

    if (isDraggingClock) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDraggingClock, handleClockDrag]);

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (timePickerRef.current && !timePickerRef.current.contains(event.target as Node)) {
        setShowTimePicker(false);
      }
      if (notificationDropdownRef.current && !notificationDropdownRef.current.contains(event.target as Node)) {
        setShowNotificationDropdown(false);
      }
      if (dayDropdownRef.current && !dayDropdownRef.current.contains(event.target as Node)) {
        setShowDayDropdown(false);
      }
      if (settingsDropdownRef.current && !settingsDropdownRef.current.contains(event.target as Node)) {
        setShowSettingsDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Day labels
  const dayLabels: Record<DayOfWeek, string> = {
    sunday: 'Sunday',
    monday: 'Monday',
    tuesday: 'Tuesday',
    wednesday: 'Wednesday',
    thursday: 'Thursday',
    friday: 'Friday',
    saturday: 'Saturday',
  };

  // Auto-focus task name input when modal opens
  useEffect(() => {
    if (showTaskModal && taskNameInputRef.current) {
      setTimeout(() => {
        taskNameInputRef.current?.focus();
      }, 100);
    }
  }, [showTaskModal]);

  // Render Task Modal
  const renderTaskModal = () => (
    <AnimatePresence>
      {showTaskModal && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-gray-500/20 p-4"
          onClick={() => setShowTaskModal(false)}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ duration: 0.2 }}
            className="w-full max-w-xl rounded-3xl bg-white px-4 pb-5 pt-4 shadow-2xl sm:px-6 sm:pb-6 sm:pt-5"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header - Task Name */}
            <div className="mb-6 flex items-start justify-between gap-3">
              <div className="flex-1">
                <input
                  ref={taskNameInputRef}
                  type="text"
                  value={taskForm.name}
                  onChange={(e) => setTaskForm({ ...taskForm, name: e.target.value })}
                  placeholder="Name of task"
                  className="w-full border-none bg-transparent pb-2 text-xl font-normal text-gray-900 outline-none placeholder:text-gray-400 focus:ring-0"
                />
              </div>
              <button
                onClick={() => setShowTaskModal(false)}
                className="rounded-full p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            {/* Frequency */}
            <div className="mb-5 flex flex-col gap-2 sm:mb-6 sm:flex-row sm:items-center">
              <span className="w-24 shrink-0 text-sm text-gray-500 sm:w-28">Frequency</span>
              <div className="flex flex-wrap items-center gap-1 rounded-full border border-gray-200 p-1 sm:flex-nowrap">
                {(['once', 'daily', 'weekly', 'monthly', 'yearly'] as TaskFrequency[]).map((freq) => (
                  <button
                    key={freq}
                    onClick={() => setTaskForm({ ...taskForm, frequency: freq })}
                    className={`rounded-full px-3 py-1 text-xs font-medium transition-colors sm:px-4 sm:py-1.5 sm:text-sm ${taskForm.frequency === freq
                      ? 'bg-gray-900 text-white'
                      : 'text-gray-500 hover:text-gray-700'
                      }`}
                  >
                    {getFrequencyLabel(freq)}
                  </button>
                ))}
              </div>
            </div>

            {/* Time and Day */}
            <div className="mb-5 flex flex-col gap-2 sm:mb-6 sm:flex-row sm:items-start">
              <span className="w-24 shrink-0 text-sm text-gray-500 sm:w-28 sm:pt-3">On</span>
              <div className="flex flex-1 gap-2 sm:gap-3">
                {/* Time Picker */}
                <div className="relative flex-1" ref={timePickerRef}>
                  <button
                    onClick={() => setShowTimePicker(!showTimePicker)}
                    className="flex w-full items-center justify-between rounded-xl border border-gray-200 px-4 py-3 transition-colors hover:border-gray-300"
                  >
                    <span className="text-sm text-gray-500">Time</span>
                    <span className="text-sm font-medium text-gray-900">{formatTimeDisplay(taskForm.time)}</span>
                  </button>
                  <AnimatePresence>
                    {showTimePicker && (
                      <motion.div
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        className="absolute left-0 right-0 top-full z-20 mt-2 rounded-2xl border border-gray-200 bg-white shadow-xl"
                      >
                        {/* Time Display Header */}
                        <div className="flex items-center justify-center border-b border-gray-100 py-3">
                          <div className="flex items-center">
                            <button
                              onClick={() => setClockMode('hour')}
                              className={`text-2xl font-light transition-colors ${clockMode === 'hour' ? 'text-gray-900' : 'text-gray-400'}`}
                            >
                              {(parseInt(taskForm.time.split(':')[0]) % 12 || 12).toString().padStart(2, '0')}
                            </button>
                            <span className="mx-0.5 text-2xl font-light text-gray-900">:</span>
                            <button
                              onClick={() => setClockMode('minute')}
                              className={`text-2xl font-light transition-colors ${clockMode === 'minute' ? 'text-gray-900 underline underline-offset-4' : 'text-gray-400'}`}
                            >
                              {taskForm.time.split(':')[1]}
                            </button>
                          </div>
                          <div className="ml-2 flex flex-col">
                            {['AM', 'PM'].map((period) => {
                              const currentHour = parseInt(taskForm.time.split(':')[0]);
                              const isSelected = (period === 'PM' && currentHour >= 12) || (period === 'AM' && currentHour < 12);
                              return (
                                <button
                                  key={period}
                                  onClick={() => {
                                    let hour = currentHour;
                                    const isPM = period === 'PM';
                                    if (isPM && hour < 12) hour += 12;
                                    if (!isPM && hour >= 12) hour -= 12;
                                    setTaskForm({ ...taskForm, time: `${hour.toString().padStart(2, '0')}:${taskForm.time.split(':')[1]}` });
                                  }}
                                  className={`rounded px-1.5 py-0.5 text-[10px] font-semibold transition-colors ${isSelected ? 'bg-teal-600 text-white' : 'text-gray-400 hover:text-gray-600'
                                    }`}
                                >
                                  {period}
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        {/* Analog Clock */}
                        <div className="flex items-center justify-center py-2">
                          <div
                            ref={clockRef}
                            className={`relative aspect-square w-full max-w-[200px] ${isDraggingClock ? 'cursor-grabbing' : 'cursor-grab'}`}
                            onMouseDown={(e) => {
                              setIsDraggingClock(true);
                              handleClockDrag(e);
                            }}
                          >
                            {/* Clock face */}
                            <svg viewBox="0 0 200 200" className="h-full w-full select-none">
                              {/* Outer circle */}
                              <circle cx="100" cy="100" r="95" fill="none" stroke="#e5e7eb" strokeWidth="1" />

                              {/* Minute dots */}
                              {Array.from({ length: 60 }, (_, i) => {
                                const angle = (i * 6 - 90) * (Math.PI / 180);
                                const x = 100 + 85 * Math.cos(angle);
                                const y = 100 + 85 * Math.sin(angle);
                                return (
                                  <circle
                                    key={i}
                                    cx={x}
                                    cy={y}
                                    r={i % 5 === 0 ? 2 : 1.5}
                                    fill="#d1d5db"
                                  />
                                );
                              })}

                              {/* Numbers */}
                              {clockMode === 'minute' ? (
                                // Minute numbers (0, 5, 10, ... 55)
                                [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map((num) => {
                                  const angle = (num * 6 - 90) * (Math.PI / 180);
                                  const x = 100 + 68 * Math.cos(angle);
                                  const y = 100 + 68 * Math.sin(angle);
                                  return (
                                    <text
                                      key={num}
                                      x={x}
                                      y={y}
                                      textAnchor="middle"
                                      dominantBaseline="middle"
                                      className="fill-gray-500 text-sm font-medium"
                                      style={{ fontSize: '14px' }}
                                    >
                                      {num}
                                    </text>
                                  );
                                })
                              ) : (
                                // Hour numbers (1-12)
                                [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((num, idx) => {
                                  const angle = (idx * 30 - 90) * (Math.PI / 180);
                                  const x = 100 + 68 * Math.cos(angle);
                                  const y = 100 + 68 * Math.sin(angle);
                                  return (
                                    <text
                                      key={num}
                                      x={x}
                                      y={y}
                                      textAnchor="middle"
                                      dominantBaseline="middle"
                                      className="fill-gray-500 text-sm font-medium"
                                      style={{ fontSize: '14px' }}
                                    >
                                      {num}
                                    </text>
                                  );
                                })
                              )}

                              {/* Clock hand */}
                              {(() => {
                                const value = clockMode === 'minute'
                                  ? parseInt(taskForm.time.split(':')[1])
                                  : parseInt(taskForm.time.split(':')[0]) % 12;
                                const angle = clockMode === 'minute'
                                  ? (value * 6 - 90) * (Math.PI / 180)
                                  : (value * 30 - 90) * (Math.PI / 180);
                                const handLength = 60;
                                const x2 = 100 + handLength * Math.cos(angle);
                                const y2 = 100 + handLength * Math.sin(angle);
                                return (
                                  <>
                                    <line
                                      x1="100"
                                      y1="100"
                                      x2={x2}
                                      y2={y2}
                                      stroke="#1f2937"
                                      strokeWidth="2"
                                      strokeLinecap="round"
                                    />
                                    <circle cx="100" cy="100" r="5" fill="#1f2937" />
                                  </>
                                );
                              })()}
                            </svg>

                          </div>
                        </div>

                        {/* Footer Buttons */}
                        <div className="flex items-center justify-between border-t border-gray-100 px-4 py-3">
                          <button
                            onClick={() => {
                              const currentHour = parseInt(taskForm.time.split(':')[0]);
                              const isPM = currentHour >= 12;
                              setTaskForm({ ...taskForm, time: isPM ? '12:00' : '00:00' });
                            }}
                            className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-200"
                          >
                            Reset
                          </button>
                          <button
                            onClick={() => setShowTimePicker(false)}
                            className="rounded-lg bg-gray-900 px-6 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-800"
                          >
                            OK
                          </button>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Day Selector */}
                <div className="relative w-28 shrink-0 sm:w-32" ref={dayDropdownRef}>
                  <button
                    onClick={() => setShowDayDropdown(!showDayDropdown)}
                    className="flex w-full items-center justify-center rounded-xl border border-gray-200 px-2 py-3 text-xs font-medium text-gray-900 transition-colors hover:border-gray-300 sm:px-4 sm:text-sm"
                  >
                    {dayLabels[taskForm.day]}
                  </button>
                  <AnimatePresence>
                    {showDayDropdown && (
                      <motion.div
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        className="absolute right-0 top-full z-20 mt-1 w-40 rounded-xl border border-gray-200 bg-white py-1 shadow-lg"
                      >
                        {(['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as DayOfWeek[]).map((day) => (
                          <button
                            key={day}
                            onClick={() => {
                              setTaskForm({ ...taskForm, day });
                              setShowDayDropdown(false);
                            }}
                            className={`w-full px-4 py-2.5 text-left text-sm transition-colors hover:bg-gray-50 ${taskForm.day === day ? 'font-medium text-gray-900' : 'text-gray-700'
                              }`}
                          >
                            {dayLabels[day]}
                          </button>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </div>

            {/* Instructions */}
            <div className="mb-5 flex flex-col gap-2 sm:mb-6 sm:flex-row">
              <span className="w-24 shrink-0 text-sm text-gray-500 sm:w-28 sm:pt-3">Instructions</span>
              <div className="relative flex-1">
                <textarea
                  value={taskForm.instructions}
                  onChange={(e) => setTaskForm({ ...taskForm, instructions: e.target.value })}
                  placeholder="Enter prompt here."
                  className="h-36 w-full resize-none rounded-xl border border-gray-200 p-3 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:border-gray-300 sm:h-44 sm:p-4"
                />
                <button className="absolute bottom-3 right-3 flex items-center gap-1 rounded-full border border-gray-200 bg-white px-2 py-1 text-xs text-gray-600 transition-colors hover:bg-gray-50 sm:bottom-4 sm:right-4 sm:gap-1.5 sm:px-3 sm:py-1.5 sm:text-sm">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.383a14.406 14.406 0 01-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 10-7.517 0c.85.493 1.509 1.333 1.509 2.316V18" />
                  </svg>
                  Expert
                </button>
              </div>
            </div>

            {/* Notifications */}
            <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
              <span className="w-24 shrink-0 text-sm text-gray-500 sm:w-28">Notifications</span>
              <div className="relative flex-1" ref={notificationDropdownRef}>
                <button
                  onClick={() => setShowNotificationDropdown(!showNotificationDropdown)}
                  className="flex w-full items-center justify-between rounded-xl border border-gray-200 px-3 py-2.5 text-sm transition-colors hover:border-gray-300 sm:px-4 sm:py-3"
                >
                  <div className="flex items-center gap-2">
                    <svg className="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
                    </svg>
                    <span className="text-gray-900">{getNotificationLabel(taskForm.notifications)}</span>
                  </div>
                  <svg className={`h-4 w-4 text-gray-400 transition-transform ${showNotificationDropdown ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                  </svg>
                </button>
                <AnimatePresence>
                  {showNotificationDropdown && (
                    <motion.div
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      className="absolute left-0 right-0 top-full z-10 mt-1 rounded-xl border border-gray-200 bg-white py-1 shadow-lg"
                    >
                      {(['email-app', 'email', 'app', 'off'] as NotificationType[]).map((notif) => (
                        <button
                          key={notif}
                          onClick={() => {
                            setTaskForm({ ...taskForm, notifications: notif });
                            setShowNotificationDropdown(false);
                          }}
                          className="w-full px-4 py-2.5 text-left text-sm text-gray-700 transition-colors hover:bg-gray-50"
                        >
                          {getNotificationLabel(notif)}
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>

            {/* Add notification filter */}
            <div className="mb-6 flex items-center sm:mb-8">
              <span className="hidden w-28 shrink-0 sm:block" />
              <button className="flex items-center gap-1.5 text-sm text-gray-500 transition-colors hover:text-gray-700">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                Add notification filter
              </button>
            </div>

            {/* Footer */}
            <div className="flex flex-col gap-3 rounded-2xl bg-gray-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5 sm:py-4">
              <div className="flex items-center gap-3">
                <div className="hidden h-10 w-10 items-center justify-center rounded-full border-2 border-gray-200 sm:flex">
                  <div className="h-6 w-6 rounded-full border-2 border-gray-200" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-900">2 daily tasks remaining</p>
                  <p className="text-xs text-gray-500">Current: {tasks.length}/2 daily tasks active</p>
                </div>
              </div>
              <button
                onClick={handleCreateTask}
                disabled={!taskForm.name.trim()}
                className={`rounded-full px-5 py-2 text-sm font-medium text-white transition-colors sm:px-6 sm:py-2.5 ${taskForm.name.trim()
                  ? 'bg-gray-900 hover:bg-gray-800'
                  : 'cursor-not-allowed bg-gray-300'
                  }`}
              >
                Create Task
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  // Render Task Detail Panel
  const renderTaskDetail = () => {
    const selectedTask = tasks.find(t => t.id === selectedTaskId);
    if (!selectedTask) return null;

    return (
      <motion.div
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 20 }}
        className="flex h-full flex-col border-l border-gray-100 bg-white"
      >
        {/* Header */}
        <div className="border-b border-gray-100 p-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-lg font-semibold text-gray-900">{selectedTask.name}</h3>
            <div className="flex items-center gap-1">
              <button
                onClick={() => handleDeleteTask(selectedTask.id)}
                className="rounded-full p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                </svg>
              </button>
              <button
                onClick={handleCloseTaskDetail}
                className="rounded-full p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
              >
                <XMarkIcon className="h-4 w-4" />
              </button>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 text-sm text-gray-500">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 12c0-1.232-.046-2.453-.138-3.662a4.006 4.006 0 00-3.7-3.7 48.678 48.678 0 00-7.324 0 4.006 4.006 0 00-3.7 3.7c-.017.22-.032.441-.046.662M19.5 12l3-3m-3 3l-3-3m-12 3c0 1.232.046 2.453.138 3.662a4.006 4.006 0 003.7 3.7 48.656 48.656 0 007.324 0 4.006 4.006 0 003.7-3.7c.017-.22.032-.441.046-.662M4.5 12l3 3m-3-3l-3 3" />
              </svg>
              {formatTaskSchedule(selectedTask)}
            </div>
            <button className="rounded-full p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600">
              <PencilIcon className="h-3.5 w-3.5" />
            </button>
            <button className="rounded-full p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600">
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25v13.5m-7.5-13.5v13.5" />
              </svg>
            </button>
            <button className="flex items-center gap-1 rounded-full border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50">
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z" />
              </svg>
              Test
            </button>
          </div>
        </div>

        {/* Instructions */}
        <div className="border-b border-gray-100 p-4">
          <p className="text-sm text-gray-700">{selectedTask.instructions || 'No instructions'}</p>
        </div>

        {/* Task Result */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="rounded-xl border border-gray-200 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100">
                  <svg className="h-4 w-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-900">Task result</p>
                  <p className="text-xs text-gray-500">
                    {new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })} · Task running...
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button className="rounded-full border border-gray-200 p-1.5 text-gray-400 transition-colors hover:bg-gray-50">
                  <ChevronLeftIcon className="h-3.5 w-3.5" />
                </button>
                <button className="rounded-full border border-gray-200 p-1.5 text-gray-400 transition-colors hover:bg-gray-50">
                  <ChevronRightIcon className="h-3.5 w-3.5" />
                </button>
                <button className="rounded-full border border-gray-200 px-3 py-1 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50">
                  Latest
                </button>
                <button className="flex items-center gap-1 rounded-full border border-gray-200 px-3 py-1 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50">
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 20.25c4.97 0 9-3.694 9-8.25s-4.03-8.25-9-8.25S3 7.444 3 12c0 2.104.859 4.023 2.273 5.48.432.447.74 1.04.586 1.641a4.483 4.483 0 01-.923 1.785A5.969 5.969 0 006 21c1.282 0 2.47-.402 3.445-1.087.81.22 1.668.337 2.555.337z" />
                  </svg>
                  Chat
                </button>
              </div>
            </div>
          </div>
        </div>
      </motion.div>
    );
  };

  // Render Task view
  const renderTaskView = () => (
    <div className="flex h-full">
      {/* Task List */}
      <div className={`flex flex-1 flex-col overflow-hidden ${selectedTaskId ? 'w-1/2' : 'w-full'}`}>
        <div className="flex-1 overflow-y-auto bg-white px-6 py-6">
          {/* Header */}
          <div className="mb-6 flex items-center justify-between">
            <h2 className="text-2xl font-bold text-gray-900">Tasks</h2>
            <button
              onClick={() => setShowTaskModal(true)}
              className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              Create task
            </button>
          </div>

          {/* Empty State or Task List */}
          {tasks.length === 0 ? (
            <div className="mb-6 rounded-2xl border border-gray-100 bg-gray-50 px-12 py-16 text-center">
              <div className="mx-auto mb-6 flex h-12 w-12 items-center justify-center">
                <svg className="h-10 w-10 text-gray-400" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M12 7V12L15 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <h3 className="mb-3 text-lg font-semibold text-gray-900">Get started by adding a task</h3>
              <p className="mb-8 text-sm text-gray-500">
                Schedule a task to automate actions and get reminders<br />when they complete.
              </p>
              <button
                onClick={() => setShowTaskModal(true)}
                className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-5 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                New task
              </button>
            </div>
          ) : (
            <div className="mb-6 space-y-3">
              {tasks.map((task) => (
                <div
                  key={task.id}
                  onClick={() => handleTaskClick(task.id)}
                  className={`cursor-pointer rounded-2xl border bg-white p-4 transition-all hover:shadow-md ${selectedTaskId === task.id
                    ? 'border-gray-300 shadow-md'
                    : 'border-gray-200'
                    }`}
                >
                  <div className="flex items-center justify-between">
                    <h4 className="font-semibold text-gray-900">{task.name}</h4>
                    <div className="flex items-center gap-1 text-sm text-gray-500">
                      {formatTaskSchedule(task)}
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 12c0-1.232-.046-2.453-.138-3.662a4.006 4.006 0 00-3.7-3.7 48.678 48.678 0 00-7.324 0 4.006 4.006 0 00-3.7 3.7c-.017.22-.032.441-.046.662M19.5 12l3-3m-3 3l-3-3m-12 3c0 1.232.046 2.453.138 3.662a4.006 4.006 0 003.7 3.7 48.656 48.656 0 007.324 0 4.006 4.006 0 003.7-3.7c.017-.22.032-.441.046-.662M4.5 12l3 3m-3-3l-3 3" />
                      </svg>
                    </div>
                  </div>
                  {task.lastResult && (
                    <div className="mt-2 flex items-center justify-between border-t border-gray-100 pt-2">
                      <div className="flex items-center gap-2 text-sm text-gray-500">
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 20.25c4.97 0 9-3.694 9-8.25s-4.03-8.25-9-8.25S3 7.444 3 12c0 2.104.859 4.023 2.273 5.48.432.447.74 1.04.586 1.641a4.483 4.483 0 01-.923 1.785A5.969 5.969 0 006 21c1.282 0 2.47-.402 3.445-1.087.81.22 1.668.337 2.555.337z" />
                        </svg>
                        {task.lastResult}
                      </div>
                      <span className="text-sm text-gray-400">{task.lastRun || 'Never run'}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Task Templates */}
          <div className="grid grid-cols-2 gap-4">
            {taskTemplates.map((template) => (
              <div
                key={template.id}
                onClick={() => {
                  setTaskForm({
                    ...taskForm,
                    name: template.name,
                    instructions: template.description,
                  });
                  setShowTaskModal(true);
                }}
                className="cursor-pointer rounded-2xl border border-gray-200 bg-white p-4 transition-all hover:border-gray-300 hover:shadow-md"
              >
                <div className="mb-1 flex items-center gap-2">
                  <svg className="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <h4 className="font-semibold text-gray-900">{template.name}</h4>
                </div>
                <p className="mb-2 text-sm text-gray-500">{template.schedule}</p>
                <p className="line-clamp-2 text-sm text-gray-400">{template.description}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Task Detail Panel */}
      <AnimatePresence>
        {selectedTaskId && (
          <div className="w-1/2">
            {renderTaskDetail()}
          </div>
        )}
      </AnimatePresence>

      {/* Task Modal */}
      {renderTaskModal()}
    </div>
  );

  // Render Settings content for dropdown
  const renderSettingsContent = () => (
    <div className="space-y-3">
      {/* Telegram Connection */}
      <div className="flex items-center justify-between rounded-xl bg-gray-50 p-3">
        <div>
          <h4 className="text-xs font-semibold text-gray-900">Connect Telegram</h4>
          <p className="text-[10px] text-gray-500">Daily trend summaries</p>
        </div>
        {isFetchingSettings ? (
          <div className="skeleton h-6 w-16 rounded-lg" />
        ) : telegramConnected ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-600">
            ✓ Connected
          </span>
        ) : (
          <button
            onClick={onTelegramConnect}
            disabled={isTelegramLoading}
            className={`inline-flex items-center gap-1.5 rounded-lg bg-[#229ED9] px-2.5 py-1 text-[10px] text-white transition-colors hover:bg-[#1a8cbf] ${isTelegramLoading ? 'cursor-not-allowed opacity-75' : ''}`}
          >
            {isTelegramLoading ? (
              <>
                <svg className="h-3 w-3 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                <span>...</span>
              </>
            ) : (
              <>
                <svg viewBox="0 0 24 24" className="h-3 w-3" fill="currentColor">
                  <path d="M20.665 3.717l-17.73 6.837c-1.21.486-1.203 1.161-.222 1.462l4.552 1.42 10.532-6.645c.498-.303.953-.14.579.192l-8.533 7.701h-.002l.002.001-.314 4.692c.46 0 .663-.211.921-.46l2.211-2.15 4.599 3.397c.848.467 1.457.227 1.668-.785l3.019-14.228c.309-1.239-.473-1.8-1.282-1.434z" />
                </svg>
                <span>Connect</span>
              </>
            )}
          </button>
        )}
      </div>

      {/* Enable X Agent Toggle */}
      <div className="flex items-center justify-between rounded-xl bg-gray-50 p-3">
        <div>
          <h4 className="text-xs font-semibold text-gray-900">Enable X Agent</h4>
          <p className="text-[10px] text-gray-500">Auto monitoring & drafting</p>
        </div>
        {isFetchingSettings ? (
          <div className="skeleton h-5 w-9 rounded-full" />
        ) : (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (onToggleAgent) {
                onToggleAgent(!agentEnabled);
              }
            }}
            className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer items-center rounded-full transition-colors ${agentEnabled ? 'bg-black' : 'bg-gray-300'}`}
          >
            <span
              className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-sm transition-transform ${agentEnabled ? 'translate-x-5' : 'translate-x-0.5'}`}
            />
          </button>
        )}
      </div>

      {/* Language Setting */}
      <div className="flex items-center justify-between rounded-xl bg-gray-50 p-3">
        <h4 className="text-xs font-semibold text-gray-900">Language</h4>
        {isFetchingSettings ? (
          <div className="skeleton h-6 w-20 rounded-full" />
        ) : (
          <div className="inline-flex items-center rounded-full border border-gray-200 bg-white p-0.5 text-[10px]">
            {(['en', 'zh'] as const).map((lang) => {
              const isSelected = agentLanguage === lang;
              return (
                <button
                  key={lang}
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (onLanguageChange) {
                      onLanguageChange(lang);
                    }
                  }}
                  className={`min-w-[2.5rem] cursor-pointer rounded-full px-2 py-1 text-[10px] font-medium transition-all ${isSelected
                    ? 'bg-gray-900 text-white'
                    : 'text-gray-500 hover:text-gray-900'
                    }`}
                >
                  {lang === 'en' ? 'En' : '中文'}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );

  // Render Settings view
  const renderSettingsView = () => (
    <div className="flex-1 overflow-y-auto">
      <div className="space-y-4 p-4">
        {/* Agent Profile Card with Telegram */}
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-[#000000]">
          <div className="relative h-36 w-full overflow-hidden bg-[#000000]">
            {/* Radial gradient overlay */}
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,#1a1a1a_0%,#000000_70%)]" />
            {/* X Logo in center */}
            <div className="absolute inset-0 flex items-center justify-center">
              <svg viewBox="0 0 24 24" className="h-16 w-16 text-white/10" fill="currentColor">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
            </div>
            <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white backdrop-blur-sm">
              Live
            </span>
          </div>
          <div className="relative z-10 -mt-10 space-y-3 px-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="relative h-16 w-16 shrink-0">
                <div className="relative h-full w-full overflow-hidden rounded-full border-[3px] border-white bg-white dark:border-[#10171e]">
                  <Image
                    src={bnbotAI}
                    alt="X Agent"
                    fill
                    sizes="64px"
                    className="rounded-full object-cover"
                    unoptimized
                  />
                </div>
              </div>
              <div>
                <p className="text-lg font-semibold text-white">
                  X Agent
                </p>
              </div>
            </div>
            <p className="text-xs leading-5 text-gray-600 dark:text-gray-300">
              Social intelligence co-pilot for crypto teams
            </p>
          </div>

          {/* Telegram Connection */}
          <div className="border-t border-gray-100 px-4 py-4 dark:border-gray-800">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
                  Connect Telegram
                </h3>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Receive daily trend summaries
                </p>
              </div>
              {isFetchingSettings ? (
                <div className="skeleton h-7 w-20 rounded-lg" />
              ) : telegramConnected ? (
                <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-600 ring-1 ring-inset ring-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-400 dark:ring-emerald-800">
                  ✓ Connected
                </span>
              ) : (
                <button
                  onClick={onTelegramConnect}
                  disabled={isTelegramLoading}
                  className={`inline-flex items-center gap-2 rounded-lg bg-[#229ED9] px-3 py-1.5 text-xs text-white transition-colors hover:bg-[#1a8cbf] ${isTelegramLoading ? 'cursor-not-allowed opacity-75' : ''}`}
                >
                  {isTelegramLoading ? (
                    <>
                      <svg
                        className="h-4 w-4 animate-spin"
                        fill="none"
                        viewBox="0 0 24 24"
                      >
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="3"
                        />
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        />
                      </svg>
                      <span>Connecting...</span>
                    </>
                  ) : (
                    <>
                      <svg
                        viewBox="0 0 24 24"
                        className="h-4 w-4"
                        fill="currentColor"
                      >
                        <path d="M20.665 3.717l-17.73 6.837c-1.21.486-1.203 1.161-.222 1.462l4.552 1.42 10.532-6.645c.498-.303.953-.14.579.192l-8.533 7.701h-.002l.002.001-.314 4.692c.46 0 .663-.211.921-.46l2.211-2.15 4.599 3.397c.848.467 1.457.227 1.668-.785l3.019-14.228c.309-1.239-.473-1.8-1.282-1.434z" />
                      </svg>
                      <span>Connect</span>
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* X Agent Settings */}
        <div className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-[#000000]">
          <div>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
              X Agent Settings
            </h3>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Control automation behavior and preferences
            </p>
          </div>

          {/* Enable X Agent Toggle */}
          <div className="rounded-2xl bg-gray-50 p-4 dark:bg-gray-800">
            <div className="flex items-center justify-between gap-3">
              <div className="flex-1">
                <span className="block text-xs font-medium uppercase tracking-wider text-gray-900 dark:text-white">
                  Enable X Agent
                </span>
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  Automated monitoring and drafting
                </span>
              </div>
              {isFetchingSettings ? (
                <div className="skeleton h-6 w-11 rounded-full" />
              ) : (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (onToggleAgent) {
                      onToggleAgent(!agentEnabled);
                    }
                  }}
                  className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer items-center rounded-full transition-colors ${agentEnabled ? 'bg-black' : 'bg-gray-300 dark:bg-gray-600'}`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${agentEnabled ? 'translate-x-6' : 'translate-x-1'}`}
                  />
                </button>
              )}
            </div>
          </div>

          {/* Language Setting */}
          <div className="rounded-2xl bg-gray-50 p-4 dark:bg-gray-800">
            <div className="flex items-center justify-between gap-3">
              <span className="block text-xs font-medium uppercase tracking-wider text-gray-900 dark:text-white">
                Language
              </span>
              {isFetchingSettings ? (
                <div className="skeleton h-7 w-24 rounded-full" />
              ) : (
                <div className="inline-flex items-center rounded-full border border-gray-200 bg-gray-100 p-1 text-xs dark:border-gray-700 dark:bg-[#050505]">
                  {(['en', 'zh'] as const).map((lang) => {
                    const isSelected = agentLanguage === lang;
                    return (
                      <button
                        key={lang}
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          if (onLanguageChange) {
                            onLanguageChange(lang);
                          }
                        }}
                        className={`min-w-[3.5rem] cursor-pointer rounded-full px-3 py-1 text-xs font-medium transition-all ${isSelected
                          ? 'bg-white text-gray-900 dark:bg-white dark:text-black'
                          : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'
                          }`}
                        style={{
                          fontWeight: isSelected ? '600' : '400',
                        }}
                      >
                        {lang === 'en' ? 'En' : '中文'}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  // Render not logged in promo
  const renderPromoView = () => (
    <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
      <div className="mb-6 rounded-full bg-[#f0b90b]/10 p-5">
        <RocketLaunchIcon className="h-12 w-12 text-[#f0b90b]" />
      </div>

      <h2 className="mb-2 text-xl font-bold text-gray-900 dark:text-white">
        Unlock Full Potential
      </h2>
      <p className="mb-8 text-sm text-gray-500 dark:text-gray-400">
        Log in to access advanced X Agent features
      </p>

      <div className="mb-8 w-full space-y-4 text-left">
        <div className="flex items-start gap-3 rounded-xl border border-gray-100 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-900/50">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-white">Become a better KOL</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">AI-powered content suggestions and drafting assistance.</p>
          </div>
        </div>

        <div className="flex items-start gap-3 rounded-xl border border-gray-100 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-900/50">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#229ED9]/10 text-[#229ED9]">
            <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
            </svg>
          </div>
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-white">Daily Trend Summaries</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">Get AI & Crypto trend updates sent directly to your Telegram.</p>
          </div>
        </div>
      </div>

      <button
        onClick={onLogin}
        className="w-full rounded-xl bg-[#f0b90b] py-3 text-sm font-bold text-black shadow-lg shadow-[#f0b90b]/20 transition-all hover:bg-[#d9a307] hover:shadow-[#f0b90b]/30 active:scale-[0.98]"
      >
        Login to Unlock
      </button>
    </div>
  );

  // Empty state - show tabbed interface when no tweet or draft is selected
  if (!tweetText && !selectedDraft) {
    return (
      <div className="relative flex h-full overflow-hidden rounded-lg border border-gray-100 bg-white shadow-card">
        {/* Main Content */}
        <div className="flex flex-1 flex-col">
          {renderNavigationHeader()}
          <AnimatePresence mode="wait">
            <motion.div
              key={currentView}
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              transition={{ duration: 0.15 }}
              className="flex flex-1 flex-col overflow-hidden"
            >
              {currentView === 'viral-tweet' && renderViralTweetView()}
              {currentView === 'advanced-search' && renderAdvancedSearchView()}
              {currentView === 'task' && renderTaskView()}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Drafts Panel */}
        <AnimatePresence>
          {showDraftsPanel && (
            <motion.div
              initial={isMobile ? { x: '100%', opacity: 1 } : { width: 0, opacity: 0 }}
              animate={isMobile ? { x: 0, opacity: 1 } : { width: 256, opacity: 1 }}
              exit={isMobile ? { x: '100%', opacity: 1 } : { width: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: 'easeInOut' }}
              className={isMobile ? 'absolute right-0 top-[56px] bottom-0 z-20 w-[75%] bg-white shadow-lg border-t border-gray-100/60' : 'overflow-hidden'}
            >
              {renderDraftsPanel()}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  return (
    <div
      className="flex h-full flex-col rounded-lg border border-gray-100 bg-white shadow-card"
      data-tweet-preview-container="true"
    >
      {/* Status Bar */}
      <div className="flex items-center justify-between border-b border-gray-100/60 bg-gray-50 px-2 py-2">
        <div className="flex items-center gap-1">
          {onClose && (
            <button
              onClick={onClose}
              className="rounded-full p-1 text-gray-500 transition-colors hover:bg-gray-200 hover:text-gray-700"
              title="Close preview"
            >
              <ChevronLeftIcon className="h-4 w-4" />
            </button>
          )}
          <span className="text-xs font-normal text-gray-600">
            Tweet Preview
          </span>
        </div>

        <button
          onClick={handleHeaderButtonClick}
          className="rounded-full p-1.5 text-gray-500 transition-colors hover:bg-white hover:text-gray-700"
          title={isEditing ? 'Cancel editing' : 'Edit tweet'}
          data-role="tweet-edit-toggle"
        >
          {isEditing ? (
            <XMarkIcon className="h-4 w-4" />
          ) : (
            <PencilIcon className="h-4 w-4" />
          )}
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <motion.div
          key="preview"
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 20 }}
          transition={{ duration: 0.2 }}
        >
          {/* Preview Content */}
          <div className="flex justify-start p-6">
            <div className="space-y-4" style={{ width: '80%' }}>
              <div className="relative rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                {onPublish && (
                  <button
                    type="button"
                    onClick={handlePublish}
                    disabled={!canPublish}
                    className={`absolute right-4 top-4 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-all ${canPublish
                      ? 'bg-black text-white shadow-[0_4px_14px_rgba(0,0,0,0.25)] hover:bg-gray-800'
                      : 'cursor-not-allowed bg-gray-100 text-gray-400'
                      }`}
                    aria-label={agentLanguage === 'zh' ? '发布推文' : 'Post tweet'}
                  >
                    <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                    </svg>
                    <span>{agentLanguage === 'zh' ? '发推' : 'Post'}</span>
                  </button>
                )}
                <div className="flex gap-3">
                  {/* Avatar */}
                  <div className="flex-shrink-0">
                    <Image
                      src={bnbotAI}
                      alt="Profile"
                      className="h-10 w-10 rounded-full"
                      width={40}
                      height={40}
                    />
                  </div>
                  {/* Content */}
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-center gap-1">
                      <span className="font-semibold text-gray-900">BNBOT</span>
                      <span className="text-gray-500">@BNBOT_AI</span>
                      {selectedDraft && (
                        <span className="ml-2 rounded-full bg-gradient-to-r from-[#f0b90b]/10 to-[#f0b90b]/5 px-2.5 py-0.5 text-xs font-medium text-[#f0b90b]">
                          {selectedDraft.style}
                        </span>
                      )}
                    </div>
                    <div className="mb-2 text-xs text-gray-500">Just now</div>

                    <div
                      ref={editorRef}
                      contentEditable={isEditing}
                      suppressContentEditableWarning
                      onInput={handleContentEditableInput}
                      onBlur={handleEditorBlur}
                      key={isEditing ? 'tweet-editor' : 'tweet-preview'}
                      className={`${isEditing
                        ? '-m-3 rounded-xl p-3 outline-none ring-1 ring-[#f0b90b]/30'
                        : ''
                        } mb-3 min-h-[60px] whitespace-pre-wrap text-sm text-gray-900`}
                      tabIndex={isEditing ? 0 : -1}
                      role={isEditing ? 'textbox' : undefined}
                      aria-label="Tweet text"
                    >
                      {!isEditing && formatTweetContent(composedTweet)}
                    </div>

                    {/* Generated Image */}
                    {generatedImageUrl && (
                      <div className="mb-3 overflow-hidden rounded-xl">
                        <img
                          src={generatedImageUrl}
                          alt={agentLanguage === 'zh' ? '生成的图片' : 'Generated image'}
                          className="h-auto w-full object-cover"
                          style={{ maxHeight: '300px' }}
                        />
                      </div>
                    )}

                    {availableHashtags.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {availableHashtags.map((tag) => {
                          const isSelected = selectedHashtags.includes(tag);
                          return (
                            <button
                              key={tag}
                              type="button"
                              onClick={() => toggleHashtag(tag)}
                              className={`rounded-full px-4 py-1.5 text-xs font-medium transition-all ${isSelected
                                ? 'bg-[#fff7e1] text-[#cf8c00] shadow-[0_4px_12px_rgba(240,185,11,0.15)]'
                                : 'bg-gray-50 text-gray-500 hover:bg-gray-100'
                                }`}
                            >
                              {tag}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {selectedDraft && (
                <div className="mt-4 space-y-3">
                  <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                    <p className="text-[11px] uppercase tracking-[0.2em] text-gray-500">
                      Strategy
                    </p>
                    {/* <h4 className="text-sm font-semibold text-gray-900">Content Rationale</h4> */}
                    <p className="mt-3 whitespace-pre-wrap text-xs leading-relaxed text-gray-700">
                      {selectedDraft.reasoning}
                    </p>
                  </div>

                  {selectedDraft.image_suggestion?.has_suggestion && (
                    <div className="rounded-2xl border border-dashed p-4 shadow-sm">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-[11px] uppercase tracking-[0.2em] text-gray-500">
                            Image Inspiration
                          </p>
                        </div>
                        {onGenerateImage && selectedDraft.image_suggestion.description && (
                          <button
                            type="button"
                            onClick={() => onGenerateImage(selectedDraft.image_suggestion?.description || '', composedTweet)}
                            disabled={isGeneratingImage}
                            className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition ${isGeneratingImage
                              ? 'cursor-not-allowed bg-gray-100 text-gray-400'
                              : 'bg-black text-white hover:bg-gray-800'
                              }`}
                          >
                            {isGeneratingImage ? (
                              <>
                                <svg
                                  className="h-3.5 w-3.5 animate-spin"
                                  fill="none"
                                  viewBox="0 0 24 24"
                                >
                                  <circle
                                    className="opacity-25"
                                    cx="12"
                                    cy="12"
                                    r="10"
                                    stroke="currentColor"
                                    strokeWidth="3"
                                  />
                                  <path
                                    className="opacity-75"
                                    fill="currentColor"
                                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                                  />
                                </svg>
                                <span>{agentLanguage === 'zh' ? '生成中...' : 'Generating...'}</span>
                              </>
                            ) : (
                              <>
                                <svg
                                  className="h-3.5 w-3.5"
                                  fill="none"
                                  viewBox="0 0 24 24"
                                  stroke="currentColor"
                                  strokeWidth={2}
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                                  />
                                </svg>
                                <span>{agentLanguage === 'zh' ? '生成' : 'Generate'}</span>
                              </>
                            )}
                          </button>
                        )}
                      </div>
                      {selectedDraft.image_suggestion.description && (
                        <p className="mt-3 text-xs leading-relaxed text-gray-700">
                          {selectedDraft.image_suggestion.description}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
};

export default XAgentPanel;
