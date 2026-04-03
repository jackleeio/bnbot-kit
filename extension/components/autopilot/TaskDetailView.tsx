import React, { useState, useEffect, useRef } from 'react';
import { X, Play, Pause, Trash2, RotateCw, Clock, Calendar, Bell, AlertCircle, ChevronDown, ChevronUp, StopCircle, FileText, Settings, Zap, Square, Check, Edit3, SkipForward } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  ScheduledTask,
  TaskExecution,
  TaskStatus,
  TaskType,
  TaskFrequency,
  ExecutionStatus,
  NotificationType,
  scheduledTaskService,
  TASK_TYPE_LABELS,
  FREQUENCY_LABELS,
  DAY_OF_WEEK_LABELS
} from '../../services/scheduledTaskService';
import { useLanguage } from '../LanguageContext';
import { useTheme } from '../ThemeContext';
import { autoReplyService } from '../../services/autoReplyService';
import { AutoReplySession, AutoReplyEvent, ActivityLogEntry, AutoReplySettings, DEFAULT_AUTO_REPLY_SETTINGS, ScrapedTweet, TweetEvaluation } from '../../types/autoReply';
import { NotificationTaskSettings, DEFAULT_NOTIFICATION_TASK_SETTINGS, notificationTaskExecutor, NotificationTaskEvent } from '../../utils/NotificationTaskExecutor';
import { FollowDigestSettings, DEFAULT_FOLLOW_DIGEST_SETTINGS } from '../../utils/FollowDigestExecutor';
import { ActivityLogsPanel } from './ActivityLogsPanel';
import { SessionControlBar } from './SessionControlBar';
import { SessionStatsCard } from './SessionStatsCard';
import { TweetCard } from './TweetCard';
import { DryRunBadge } from './DryRunBadge';

// Format metric helper
const formatMetric = (num: number): string => {
  if (num === 0) return '';
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + 'M';
  } else if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'K';
  }
  return num.toString();
};

// Animated Title component
const AnimatedTitle: React.FC<{ text: string; className?: string }> = ({ text, className }) => {
  const [displayedText, setDisplayedText] = useState(text);
  const [animationKey, setAnimationKey] = useState(0);
  const prevTextRef = useRef(text);

  useEffect(() => {
    if (text !== prevTextRef.current) {
      prevTextRef.current = text;
      setAnimationKey(k => k + 1);
      const timer = setTimeout(() => {
        setDisplayedText(text);
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [text]);

  return (
    <span className={`relative inline-flex overflow-hidden h-5 ${className}`}>
      <span
        key={animationKey}
        className="inline-block animate-slide-up"
        style={{
          animation: 'slideUp 350ms ease-out forwards'
        }}
      >
        {displayedText}
      </span>
      <style>{`
        @keyframes slideUp {
          0% {
            opacity: 0;
            transform: translateY(100%);
          }
          100% {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </span>
  );
};

// Animated Section component
const AnimatedSection: React.FC<{ children: React.ReactNode; className?: string; slideFrom?: 'top' | 'bottom' }> = ({
  children,
  className,
  slideFrom = 'bottom'
}) => {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setIsVisible(true);
      });
    });
  }, []);

  const initialTransform = slideFrom === 'bottom' ? 'translate-y-4' : '-translate-y-4';

  return (
    <div
      className={`transition-all duration-[400ms] ease-[cubic-bezier(0.4,0,0.2,1)] transform ${isVisible ? 'opacity-100 translate-y-0' : `opacity-0 ${initialTransform}`
        } ${className}`}
    >
      {children}
    </div>
  );
};

// Countdown Display component
const CountdownDisplay: React.FC<{ endTime: number }> = ({ endTime }) => {
  const [timeLeft, setTimeLeft] = useState(0);

  useEffect(() => {
    const update = () => {
      const now = Date.now();
      const diff = Math.max(0, endTime - now);
      setTimeLeft(diff);
    };

    update();
    const interval = setInterval(update, 100);
    return () => clearInterval(interval);
  }, [endTime]);

  const seconds = (timeLeft / 1000).toFixed(1);

  if (timeLeft <= 0) return null;

  return (
    <span className="ml-2 px-1.5 py-0.5 rounded bg-yellow-100 dark:bg-yellow-900/30 text-xs font-mono font-bold text-yellow-700 dark:text-yellow-400 border border-yellow-200 dark:border-yellow-800/50">
      {seconds}s
    </span>
  );
};

// Reasoning Display component
const ReasoningDisplay: React.FC<{
  reasoning: string;
  onClose: () => void;
  isStreaming?: boolean;
  status?: string;
  session?: AutoReplySession;
}> = ({ reasoning, onClose, isStreaming, status, session }) => {
  const contentRef = useRef<HTMLDivElement>(null);
  const { language } = useLanguage();
  const lang = language === 'zh' ? 'zh' : 'en';
  const [autoScroll, setAutoScroll] = useState(true);

  const handleScroll = () => {
    if (!contentRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = contentRef.current;
    const isNearBottom = scrollHeight - scrollTop - clientHeight < 50;
    setAutoScroll(isNearBottom);
  };

  useEffect(() => {
    if (contentRef.current && autoScroll) {
      contentRef.current.scrollTo({
        top: contentRef.current.scrollHeight,
        behavior: 'smooth'
      });
    }
  }, [reasoning, autoScroll]);

  const parseReasoning = (text: string) => {
    const sections: { id: string; title: string; content: string }[] = [];
    const regex = /\*\*([^*]+)\*\*\s*([\s\S]*?)(?=\*\*|$)/g;
    let match;
    let idx = 0;

    while ((match = regex.exec(text)) !== null) {
      const title = match[1].replace(/\s*\(\d{1,2}:\d{2}:\d{2}\s*[AP]M\)/g, '').trim();
      sections.push({
        id: `section-${idx}-${title.slice(0, 20)}`,
        title,
        content: match[2].trim()
      });
      idx++;
    }

    return sections.length > 0 ? sections : [{ id: 'default', title: '', content: text }];
  };

  const sections = parseReasoning(reasoning);
  const lastTitle = sections.length > 0 ? sections[sections.length - 1].title : '';

  const [isExpanded, setIsExpanded] = useState(true);

  const statusMap: Record<string, string> = {
    idle: lang === 'en' ? 'Idle' : '空闲',
    scrolling: lang === 'en' ? 'Scrolling...' : '滚动中...',
    evaluating: lang === 'en' ? 'Evaluating...' : '评估中...',
    generating: lang === 'en' ? 'Generating...' : '生成中...',
    generating_image: lang === 'en' ? '🎨 Generating image...' : '🎨 生成图片中...',
    confirming: lang === 'en' ? 'Confirming...' : '确认中...',
    posting: lang === 'en' ? 'Posting...' : '发布中...',
    waiting: lang === 'en' ? 'Waiting...' : '等待中...',
    paused: lang === 'en' ? 'Paused' : '已暂停',
    stopped: lang === 'en' ? 'Stopped' : '已停止'
  };

  return (
    <div className={`rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-color)] overflow-hidden flex flex-col my-2 transition-all duration-300 ${isExpanded ? 'h-64' : 'h-auto'}`}>
      <div
        className="flex items-center justify-between px-4 py-2 border-b border-[var(--border-color)] bg-[var(--bg-secondary)] cursor-pointer transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full transition-all duration-500 ${(!['idle', 'stopped', 'paused'].includes(status || 'idle'))
            ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]'
            : 'bg-gray-300 dark:bg-gray-600'
            }`} />
          <h3 className="text-sm font-medium text-[var(--text-primary)] min-w-[120px]">
            <AnimatedTitle
              text={isStreaming
                ? (lastTitle ? `${lastTitle}...` : 'Reasoning...')
                : (status && ['waiting', 'posting', 'generating_image'].includes(status)
                  ? statusMap[status] || status
                  : 'Thought Process')}
            />
            {status === 'waiting' && session?.waitEndTime && (
              <CountdownDisplay endTime={session.waitEndTime} />
            )}
          </h3>
        </div>
        <button className="p-1 rounded-full hover:bg-[var(--hover-bg)] transition-colors">
          {isExpanded ? (
            <ChevronUp size={14} className="text-[var(--text-secondary)]" />
          ) : (
            <ChevronDown size={14} className="text-[var(--text-secondary)]" />
          )}
        </button>
      </div>

      {isExpanded && (
        <div
          ref={contentRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto p-4 custom-scrollbar text-xs"
        >
          {sections.map((section, idx) => (
            <AnimatedSection key={section.id} slideFrom="bottom" className={idx > 0 ? 'mt-4' : ''}>
              {section.title && (
                <div className="font-medium text-[var(--text-primary)] mb-1 text-yellow-600 dark:text-yellow-500">
                  {section.title}
                </div>
              )}
              <div className="text-[var(--text-secondary)] leading-relaxed whitespace-pre-wrap [&_hr]:hidden">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {section.content}
                </ReactMarkdown>
              </div>
            </AnimatedSection>
          ))}
          {isStreaming && (
            <div className="flex items-center gap-2 mt-2 text-xs text-[var(--text-tertiary)] animate-pulse">
              <span className="loading loading-dots loading-xs"></span>
              <span>Thinking...</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

interface TaskDetailViewProps {
  task: ScheduledTask;
  onBack: () => void;
  onPause: (taskId: string) => void;
  onResume: (taskId: string) => void;
  onDelete: (taskId: string) => void;
  onRequestDelete: (taskId: string) => void;
  onExecute: (taskId: string) => void;
  onTaskUpdated: () => void;
  onStopExecution?: (taskId: string) => void;
  cachedExecutions?: TaskExecution[];
  onExecutionsUpdate?: (taskId: string, executions: TaskExecution[]) => void;
}

// Format execution result for HANDLE_NOTIFICATION task
const formatNotificationResult = (result: Record<string, any> | null, lang: 'en' | 'zh'): React.ReactNode => {
  if (!result) return null;

  const phase1 = {
    processed: result.phase1_processed ?? 0,
    replied: result.phase1_replied ?? 0,
    liked: result.phase1_liked ?? 0,
    skipped: result.phase1_skipped ?? 0,
  };

  const phase2 = {
    processed: result.phase2_processed ?? 0,
    replied: result.phase2_replied ?? 0,
    liked: result.phase2_liked ?? 0,
    skipped: result.phase2_skipped ?? 0,
  };

  const durationSec = result.duration_ms ? Math.round(result.duration_ms / 1000) : 0;

  return (
    <div className="space-y-2 text-xs">
      <div className="flex items-center gap-2">
        <span className="text-[var(--text-tertiary)]">
          {lang === 'en' ? 'Phase 1 (New Posts):' : '阶段1 (新帖子):'}
        </span>
        <span className="text-[var(--text-secondary)]">
          {lang === 'en'
            ? `${phase1.processed} processed, ${phase1.replied} replied, ${phase1.liked} liked`
            : `处理 ${phase1.processed} 条，回复 ${phase1.replied} 条，点赞 ${phase1.liked} 条`
          }
        </span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[var(--text-tertiary)]">
          {lang === 'en' ? 'Phase 2 (Replies):' : '阶段2 (回复通知):'}
        </span>
        <span className="text-[var(--text-secondary)]">
          {lang === 'en'
            ? `${phase2.processed} processed, ${phase2.replied} replied, ${phase2.liked} liked`
            : `处理 ${phase2.processed} 条，回复 ${phase2.replied} 条，点赞 ${phase2.liked} 条`
          }
        </span>
      </div>
      {durationSec > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-[var(--text-tertiary)]">
            {lang === 'en' ? 'Duration:' : '耗时:'}
          </span>
          <span className="text-[var(--text-secondary)]">
            {durationSec}s
          </span>
        </div>
      )}
    </div>
  );
};

// Format execution result for AUTO_REPLY task
const formatAutoReplyResult = (result: Record<string, any> | null, lang: 'en' | 'zh'): React.ReactNode => {
  if (!result) return null;

  const tweetsScanned = result.tweets_scanned ?? 0;
  const tweetsEvaluated = result.tweets_evaluated ?? 0;
  const repliesPosted = result.replies_posted ?? 0;
  const repliesSkipped = result.replies_skipped ?? 0;
  const liked = result.liked ?? 0;
  const durationSec = result.duration_ms ? Math.round(result.duration_ms / 1000) : 0;

  return (
    <div className="space-y-2 text-xs">
      <div className="flex items-center gap-2">
        <span className="text-[var(--text-tertiary)]">
          {lang === 'en' ? 'Tweets Scanned:' : '扫描推文:'}
        </span>
        <span className="text-[var(--text-secondary)]">{tweetsScanned}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[var(--text-tertiary)]">
          {lang === 'en' ? 'Tweets Evaluated:' : '评估推文:'}
        </span>
        <span className="text-[var(--text-secondary)]">{tweetsEvaluated}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[var(--text-tertiary)]">
          {lang === 'en' ? 'Replies Posted:' : '发布回复:'}
        </span>
        <span className="text-green-500 font-medium">{repliesPosted}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[var(--text-tertiary)]">
          {lang === 'en' ? 'Skipped:' : '跳过:'}
        </span>
        <span className="text-[var(--text-secondary)]">{repliesSkipped}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[var(--text-tertiary)]">
          {lang === 'en' ? 'Liked:' : '点赞:'}
        </span>
        <span className="text-[var(--text-secondary)]">{liked}</span>
      </div>
      {durationSec > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-[var(--text-tertiary)]">
            {lang === 'en' ? 'Duration:' : '耗时:'}
          </span>
          <span className="text-[var(--text-secondary)]">{durationSec}s</span>
        </div>
      )}
    </div>
  );
};

// Format generic execution result
const formatGenericResult = (result: Record<string, any> | null, lang: 'en' | 'zh'): React.ReactNode => {
  if (!result) return null;

  return (
    <div className="text-xs text-[var(--text-secondary)] whitespace-pre-wrap">
      {JSON.stringify(result, null, 2)}
    </div>
  );
};

const formatDateTime = (dateStr: string | null, lang: 'en' | 'zh'): string => {
  if (!dateStr) return lang === 'en' ? 'Never' : '从未';
  const date = new Date(dateStr);
  return date.toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
};

const getExecutionStatusColor = (status: ExecutionStatus): string => {
  switch (status) {
    case ExecutionStatus.SUCCESS:
      return 'text-green-500';
    case ExecutionStatus.FAILED:
      return 'text-red-500';
    case ExecutionStatus.RUNNING:
      return 'text-blue-500';
    case ExecutionStatus.PENDING:
      return 'text-yellow-500';
    default:
      return 'text-gray-500';
  }
};

export const TaskDetailView: React.FC<TaskDetailViewProps> = ({
  task,
  onBack,
  onPause,
  onResume,
  onDelete,
  onRequestDelete,
  onExecute,
  onTaskUpdated,
  onStopExecution,
  cachedExecutions,
  onExecutionsUpdate,
}) => {
  const { language } = useLanguage();
  const { theme } = useTheme();
  const lang = language === 'zh' ? 'zh' : 'en';

  const [executions, setExecutions] = useState<TaskExecution[]>(cachedExecutions || []);
  const [isLoadingExecutions, setIsLoadingExecutions] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [expandedExecutionId, setExpandedExecutionId] = useState<string | null>(null);
  const [showLogsPanel, setShowLogsPanel] = useState(false);
  const [showSettingsPanel, setShowSettingsPanel] = useState(false);
  const [isSavingSchedule, setIsSavingSchedule] = useState(false);
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);
  // Schedule editing state
  const [schedFrequency, setSchedFrequency] = useState<TaskFrequency>(task.frequency as TaskFrequency);
  const [schedTime, setSchedTime] = useState(task.execution_time || '09:00');
  const [schedIntervalHours, setSchedIntervalHours] = useState(task.interval_hours || 2);
  const [schedDayOfWeek, setSchedDayOfWeek] = useState(task.day_of_week ?? 0);
  const [activityLog, setActivityLog] = useState<ActivityLogEntry[]>([]);
  const [session, setSession] = useState<AutoReplySession | null>(null);
  const [settings, setSettings] = useState<AutoReplySettings>(DEFAULT_AUTO_REPLY_SETTINGS);
  const [showReasoningModal, setShowReasoningModal] = useState(true);
  const [isStarting, setIsStarting] = useState(false);
  const [editingReply, setEditingReply] = useState(false);
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  // Handle log scroll to detect if user scrolled up
  const handleLogScroll = () => {
    if (!logContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = logContainerRef.current;
    const isNearBottom = scrollHeight - scrollTop - clientHeight < 50;
    setAutoScrollEnabled(isNearBottom);
  };
  const [editedReplyContent, setEditedReplyContent] = useState('');
  const logsEndRef = useRef<HTMLDivElement>(null);

  // Settings state for AUTO_REPLY task
  const [dryRunMode, setDryRunMode] = useState(false);
  const [generateImages, setGenerateImages] = useState(false);

  // Current state for HANDLE_NOTIFICATION task UI (tweet card + reasoning)
  const [notifCurrentTweet, setNotifCurrentTweet] = useState<ScrapedTweet | null>(null);
  const [notifCurrentEvaluation, setNotifCurrentEvaluation] = useState<TweetEvaluation | null>(null);
  const [notifCurrentReasoning, setNotifCurrentReasoning] = useState<string>('');
  const [notifIsStreaming, setNotifIsStreaming] = useState(false);

  // Settings state for HANDLE_NOTIFICATION task
  const [notifSettings, setNotifSettings] = useState<NotificationTaskSettings>(DEFAULT_NOTIFICATION_TASK_SETTINGS);
  const [digestSettings, setDigestSettings] = useState<FollowDigestSettings>(DEFAULT_FOLLOW_DIGEST_SETTINGS);
  const [telegramEnabled, setTelegramEnabled] = useState(task.notification_type === NotificationType.TELEGRAM_ONLY || task.notification_type === NotificationType.BOTH);

  // Sync settings state when panel opens or component mounts
  useEffect(() => {
    const loadSettings = async () => {
      // Wait a tick for autoReplyService to load from storage
      await new Promise(resolve => setTimeout(resolve, 50));
      const loadedSettings = autoReplyService.getSettings();
      setSettings(loadedSettings);
      setDryRunMode(loadedSettings.dryRunMode);
      setGenerateImages(loadedSettings.generateImages || false);
    };
    loadSettings();
  }, [showSettingsPanel]);

  // Load HANDLE_NOTIFICATION settings from storage
  useEffect(() => {
    if (task.task_type === TaskType.HANDLE_NOTIFICATION) {
      chrome.storage.local.get('notificationTaskSettings', (res) => {
        if (res.notificationTaskSettings) {
          setNotifSettings({ ...DEFAULT_NOTIFICATION_TASK_SETTINGS, ...res.notificationTaskSettings });
        }
      });
    }
  }, [task.task_type, showSettingsPanel]);

  // Sync telegramEnabled when task prop updates (e.g. after save)
  useEffect(() => {
    setTelegramEnabled(task.notification_type === NotificationType.TELEGRAM_ONLY || task.notification_type === NotificationType.BOTH);
  }, [task.notification_type]);

  // Load FOLLOW_DIGEST settings from storage
  useEffect(() => {
    if (task.task_type === TaskType.FOLLOW_DIGEST) {
      chrome.storage.local.get('followDigestSettings', (res) => {
        if (res.followDigestSettings) {
          setDigestSettings({ ...DEFAULT_FOLLOW_DIGEST_SETTINGS, ...res.followDigestSettings });
        }
      });
    }
  }, [task.task_type, showSettingsPanel]);

  // Auto-scroll logs to bottom when new entries are added (within container only)
  useEffect(() => {
    if (logContainerRef.current && showLogsPanel && autoScrollEnabled) {
      logContainerRef.current.scrollTo({
        top: logContainerRef.current.scrollHeight,
        behavior: 'smooth'
      });
    }
  }, [activityLog, showLogsPanel, autoScrollEnabled]);

  const typeLabel = TASK_TYPE_LABELS[task.task_type]?.[lang] || task.task_type;
  const frequencyLabel = FREQUENCY_LABELS[task.frequency]?.[lang] || task.frequency;

  // Build schedule text
  let scheduleText = `${frequencyLabel} ${task.execution_time}`;
  if (task.frequency === 'hourly') {
    const hours = task.interval_hours || 1;
    scheduleText = lang === 'en'
      ? `Every ${hours} hour${hours > 1 ? 's' : ''}`
      : `每 ${hours} 小时`;
  } else if (task.frequency === 'weekly' && task.day_of_week !== null) {
    scheduleText = `${DAY_OF_WEEK_LABELS[lang][task.day_of_week]} ${task.execution_time}`;
  } else if (task.frequency === 'monthly' && task.day_of_month !== null) {
    scheduleText = lang === 'en'
      ? `Day ${task.day_of_month} ${task.execution_time}`
      : `每月${task.day_of_month}日 ${task.execution_time}`;
  }

  useEffect(() => {
    loadExecutions();

    // Auto-refresh execution data when page becomes visible again
    // (e.g., user returns to sidebar after scheduled execution navigated away)
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        loadExecutions();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [task.id]);

  // Initialize activity log on mount
  useEffect(() => {
    if (task.task_type === TaskType.AUTO_REPLY) {
      setActivityLog(autoReplyService.getActivityLog());
    } else if (task.task_type === TaskType.HANDLE_NOTIFICATION) {
      setActivityLog(notificationTaskExecutor.getActivityLog());
    }
  }, [task.id, task.task_type]);

  // Listen for auto reply events when showing logs for AUTO_REPLY task
  useEffect(() => {
    if (task.task_type !== TaskType.AUTO_REPLY) return;

    const handleEvent = (event: AutoReplyEvent) => {
      console.log('[TaskDetailView] Received event:', event.type);
      setSession(autoReplyService.getSession());
      setActivityLog(autoReplyService.getActivityLog());

      if (['tweet_evaluating', 'reply_generating'].includes(event.type)) {
        setShowReasoningModal(true);
      }

      // Refresh execution history when session ends
      if (event.type === 'session_end') {
        loadExecutions();
      }
    };

    autoReplyService.addEventListener(handleEvent);

    // Immediately fetch current state
    setSession(autoReplyService.getSession());
    setActivityLog(autoReplyService.getActivityLog());
    setSettings(autoReplyService.getSettings());
    console.log('[TaskDetailView] Initial logs:', autoReplyService.getActivityLog().length);

    return () => {
      autoReplyService.removeEventListener(handleEvent);
    };
  }, [task.task_type, showLogsPanel]);

  // Listen for notification task events for HANDLE_NOTIFICATION task
  useEffect(() => {
    if (task.task_type !== TaskType.HANDLE_NOTIFICATION) return;

    const handleEvent = (event: NotificationTaskEvent) => {
      console.log('[TaskDetailView] Notification event:', event.type);
      setActivityLog(notificationTaskExecutor.getActivityLog());

      // Update current tweet/evaluation/reasoning state for UI
      if (event.type === 'tweet_evaluating' || event.type === 'tweet_found') {
        setNotifCurrentTweet(notificationTaskExecutor.getCurrentTweet());
        setNotifCurrentEvaluation(null);
        setNotifCurrentReasoning('');
        setNotifIsStreaming(true);
      } else if (event.type === 'tweet_evaluated') {
        setNotifCurrentEvaluation(notificationTaskExecutor.getCurrentEvaluation());
        setNotifIsStreaming(false);
      } else if (event.type === 'reply_generating') {
        setNotifIsStreaming(true);
      } else if (event.type === 'reply_generated') {
        setNotifIsStreaming(false);
      } else if (event.type === 'stats_update') {
        setNotifCurrentReasoning(notificationTaskExecutor.getCurrentReasoning());
      } else if (event.type === 'session_end') {
        setNotifCurrentTweet(null);
        setNotifCurrentEvaluation(null);
        setNotifCurrentReasoning('');
        setNotifIsStreaming(false);
        loadExecutions();
      } else if (event.type === 'session_start') {
        setNotifCurrentTweet(null);
        setNotifCurrentEvaluation(null);
        setNotifCurrentReasoning('');
        setNotifIsStreaming(false);
      }
    };

    notificationTaskExecutor.addEventListener(handleEvent);

    // Immediately fetch current state
    setActivityLog(notificationTaskExecutor.getActivityLog());
    setNotifCurrentTweet(notificationTaskExecutor.getCurrentTweet());
    setNotifCurrentEvaluation(notificationTaskExecutor.getCurrentEvaluation());
    setNotifCurrentReasoning(notificationTaskExecutor.getCurrentReasoning());

    return () => {
      notificationTaskExecutor.removeEventListener(handleEvent);
    };
  }, [task.task_type, showLogsPanel]);

  const handleClearLogs = () => {
    if (task.task_type === TaskType.HANDLE_NOTIFICATION) {
      notificationTaskExecutor.clearActivityLog();
    } else {
      autoReplyService.clearActivityLog();
    }
    setActivityLog([]);
  };

  // Session control handlers
  const handleStart = async () => {
    try {
      setIsStarting(true);
      await autoReplyService.start(settings);
      setTimeout(() => setIsStarting(false), 1000);
    } catch (error) {
      console.error('[TaskDetailView] Error in handleStart:', error);
      setIsStarting(false);
    }
  };

  const handleSessionPause = () => {
    autoReplyService.pause();
  };

  const handleSessionResume = () => {
    autoReplyService.resume();
  };

  const handleStop = () => {
    autoReplyService.stop();
  };

  const handleConfirm = () => {
    if (editingReply && editedReplyContent) {
      autoReplyService.editAndConfirmReply(editedReplyContent);
    } else {
      autoReplyService.confirmReply(true);
    }
    setEditingReply(false);
    setEditedReplyContent('');
  };

  const handleSkip = () => {
    autoReplyService.confirmReply(false);
    setEditingReply(false);
    setEditedReplyContent('');
  };

  const handleEditReply = () => {
    if (session?.currentReply) {
      setEditedReplyContent(session.currentReply.content);
      setEditingReply(true);
    }
  };

  const handleSettingChange = (key: keyof AutoReplySettings, value: any) => {
    const newSettings = { ...settings, [key]: value };
    setSettings(newSettings);
    autoReplyService.updateSettings({ [key]: value });
    if (key === 'dryRunMode') setDryRunMode(value);
    if (key === 'generateImages') setGenerateImages(value);
  };

  // Status helpers
  const getStatusText = (status: string | undefined) => {
    const statusMap: Record<string, string> = {
      idle: lang === 'en' ? 'Idle' : '空闲',
      scrolling: lang === 'en' ? 'Scrolling...' : '滚动中...',
      evaluating: lang === 'en' ? 'Evaluating...' : '评估中...',
      generating: lang === 'en' ? 'Generating...' : '生成中...',
      generating_image: lang === 'en' ? '🎨 Generating image...' : '🎨 生成图片中...',
      confirming: lang === 'en' ? 'Confirming...' : '确认中...',
      posting: lang === 'en' ? 'Posting...' : '发布中...',
      waiting: lang === 'en' ? 'Waiting...' : '等待中...',
      paused: lang === 'en' ? 'Paused' : '已暂停',
      stopped: lang === 'en' ? 'Stopped' : '已停止'
    };
    return statusMap[status || 'idle'] || status;
  };

  const isRunning = session && !['idle', 'stopped', 'paused'].includes(session.status);
  const isPaused = session?.status === 'paused';
  const isConfirming = session?.status === 'confirming';

  const loadExecutions = async () => {
    // Local-only tasks don't have backend execution records
    if (task.task_type === TaskType.AUTO_REPLY || task.task_type === TaskType.HANDLE_NOTIFICATION) {
      setIsLoadingExecutions(false);
      return;
    }
    try {
      // Only show loading spinner if no cached data
      if (executions.length === 0) setIsLoadingExecutions(true);
      const res = await scheduledTaskService.getExecutions(task.id, { limit: 10 });

      // Mark stale RUNNING executions as FAILED locally (older than 5 minutes)
      const STALE_MS = 5 * 60 * 1000;
      const now = Date.now();
      for (const exec of res.data) {
        if (
          exec.status === ExecutionStatus.RUNNING &&
          exec.started_at &&
          now - new Date(exec.started_at).getTime() > STALE_MS
        ) {
          exec.status = ExecutionStatus.FAILED;
          exec.error_message = 'Timed out';
        }
      }

      setExecutions(res.data);
      onExecutionsUpdate?.(task.id, res.data);
    } catch (err) {
      console.error('[TaskDetailView] Failed to load executions:', err);
    } finally {
      setIsLoadingExecutions(false);
    }
  };

  const handleAction = async (action: () => Promise<void>) => {
    try {
      setActionLoading(true);
      await action();
      onTaskUpdated();
    } catch (err) {
      console.error('[TaskDetailView] Action failed:', err);
    } finally {
      setActionLoading(false);
    }
  };

  const handleDelete = () => {
    onRequestDelete(task.id);
  };

  // Run Now - 直接执行任务，不等待后端触发
  const handleRunNow = async () => {
    if (task.task_type === TaskType.AUTO_REPLY) {
      // AUTO_REPLY: 直接启动 autoReplyService，并切换到 logs 面板
      setShowLogsPanel(true);
      setShowSettingsPanel(false);
      await handleStart();
    } else if (task.task_type === TaskType.HANDLE_NOTIFICATION) {
      // HANDLE_NOTIFICATION: 直接调用 executor with settings
      await handleAction(async () => {
        const { notificationTaskExecutor } = await import('../../utils/NotificationTaskExecutor');
        notificationTaskExecutor.updateSettings(notifSettings);
        const result = await notificationTaskExecutor.execute();
        console.log('[TaskDetailView] Notification task result:', result);
        loadExecutions();
      });
    } else if (task.task_type === TaskType.FOLLOW_DIGEST) {
      // FOLLOW_DIGEST: 调用 FollowDigestExecutor with saved settings
      await handleAction(async () => {
        const { followDigestExecutor } = await import('../../utils/FollowDigestExecutor');
        const stored = await chrome.storage.local.get('followDigestSettings');
        const s = stored.followDigestSettings || {};
        const result = await followDigestExecutor.execute({
          maxTweets: s.maxTweets || 100,
          customPrompt: s.customPrompt || '',
          interests: s.interests ? s.interests.split(',').map((i: string) => i.trim()).filter(Boolean) : [],
          keywords: s.keywords ? s.keywords.split(',').map((k: string) => k.trim()).filter(Boolean) : [],
          notificationType: task.notification_type || 'telegram_only',
        });
        console.log('[TaskDetailView] Follow digest result:', result);
        loadExecutions();
      });
    } else {
      // CUSTOM_TASK 和其他任务走后端触发 → SSE 流程
      // SSE 完成后自动发送 Telegram 通知
      onExecute(task.id);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--border-color)]">
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-semibold text-[var(--text-primary)] truncate leading-tight flex items-center gap-2">
            {typeLabel}
            {isSavingSchedule && (
              <svg className="animate-spin h-3.5 w-3.5 text-[var(--text-tertiary)] shrink-0" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            )}
          </h3>
        </div>

        <div className={`flex items-center gap-1.5 text-xs font-medium shrink-0 ${
          task.status === TaskStatus.ACTIVE ? 'text-green-500' :
          task.status === TaskStatus.PAUSED ? 'text-gray-400' :
          task.status === TaskStatus.FAILED ? 'text-red-500' : 'text-gray-500'
        }`}>
          <span className={`w-2 h-2 rounded-full ${
            task.status === TaskStatus.ACTIVE ? 'bg-green-500' :
            task.status === TaskStatus.PAUSED ? 'bg-gray-400' :
            task.status === TaskStatus.FAILED ? 'bg-red-500' : 'bg-gray-500'
          }`} />
          <span>{task.status.toUpperCase()}</span>
        </div>

        <button
          onClick={onBack}
          className="p-1.5 rounded-full hover:bg-[var(--hover-bg)] text-[var(--text-secondary)] transition-colors cursor-pointer shrink-0"
          title={lang === 'en' ? 'Close' : '关闭'}
        >
          <X size={18} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Schedule Info */}
        <div className="p-4 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-color)]">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium text-[var(--text-primary)]">
              {lang === 'en' ? 'Schedule' : '执行计划'}
            </h4>
            <span className="flex items-center gap-1.5 text-sm text-[var(--text-secondary)]">
              <Clock size={14} />
              {scheduleText}
            </span>
          </div>
        </div>

        {/* Prompt - Hide for singleton task types */}
        {task.task_type !== TaskType.AUTO_REPLY && task.task_type !== TaskType.HANDLE_NOTIFICATION && task.task_type !== TaskType.FOLLOW_DIGEST && (
          <div className="p-4 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-color)]">
            <h4 className="text-sm font-medium text-[var(--text-primary)] mb-2">
              {lang === 'en' ? 'Prompt' : '提示词'}
            </h4>
            <p className="text-sm text-[var(--text-secondary)] whitespace-pre-wrap">
              {task.prompt}
            </p>
          </div>
        )}

        {/* Execution History */}
        <div className="p-4 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-color)]">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-medium text-[var(--text-primary)]">
              {lang === 'en' ? 'Execution History' : '执行历史'}
            </h4>
            <span className="text-xs text-[var(--text-tertiary)]">
              {task.execution_count} {lang === 'en' ? 'runs' : '次执行'}
            </span>
          </div>
          <div className="max-h-[200px] overflow-y-auto">
            {isLoadingExecutions ? (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-10 bg-[var(--hover-bg)] rounded animate-pulse" />
                ))}
              </div>
            ) : executions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-6 text-[var(--text-tertiary)]">
                <AlertCircle size={24} className="mb-2 opacity-50" />
                <span className="text-xs">
                  {lang === 'en' ? 'No executions yet' : '暂无执行记录'}
              </span>
            </div>
          ) : (
            <div className="space-y-2">
              {executions.map((exec) => {
                const isExpanded = expandedExecutionId === exec.id;
                const isRunning = exec.status === ExecutionStatus.RUNNING;
                const isNotificationTask = task.task_type === TaskType.HANDLE_NOTIFICATION;

                return (
                  <div
                    key={exec.id}
                    className="rounded-lg bg-[var(--bg-primary)] border border-[var(--border-color)] overflow-hidden"
                  >
                    {/* Execution Header - Clickable */}
                    <div
                      className="flex items-center justify-between p-2 cursor-pointer hover:bg-[var(--hover-bg)] transition-colors"
                      onClick={() => setExpandedExecutionId(isExpanded ? null : exec.id)}
                    >
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${
                          exec.status === ExecutionStatus.SUCCESS ? 'bg-green-500' :
                          exec.status === ExecutionStatus.FAILED ? 'bg-red-500' :
                          exec.status === ExecutionStatus.RUNNING ? 'bg-blue-500 animate-pulse' : 'bg-yellow-500'
                        }`} />
                        <span className="text-xs text-[var(--text-secondary)]">
                          {formatDateTime(exec.started_at || exec.created_at, lang)}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        {/* Stop button for running executions */}
                        {isRunning && onStopExecution && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onStopExecution(task.id);
                            }}
                            className="flex items-center gap-1 px-2 py-1 rounded text-xs text-red-500 hover:bg-red-100 dark:hover:bg-red-900/20 transition-colors"
                            title={lang === 'en' ? 'Stop Execution' : '停止执行'}
                          >
                            <StopCircle size={12} />
                            <span>{lang === 'en' ? 'Stop' : '停止'}</span>
                          </button>
                        )}
                        {exec.credits_used > 0 && (
                          <span className="text-xs text-[var(--text-tertiary)]">
                            {exec.credits_used.toFixed(1)} credits
                          </span>
                        )}
                        <span className={`text-xs font-medium ${getExecutionStatusColor(exec.status)}`}>
                          {exec.status.toUpperCase()}
                        </span>
                        {(exec.result || exec.error_message) && (
                          isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />
                        )}
                      </div>
                    </div>

                    {/* Expanded Details */}
                    {isExpanded && (exec.result || exec.error_message) && (
                      <div className="px-3 pb-3 pt-1 border-t border-[var(--border-color)]">
                        {exec.error_message && (
                          <div className="text-xs text-red-500 mb-2">
                            {lang === 'en' ? 'Error: ' : '错误: '}{exec.error_message}
                          </div>
                        )}
                        {exec.result && (
                          isNotificationTask
                            ? formatNotificationResult(exec.result, lang)
                            : task.task_type === TaskType.AUTO_REPLY
                              ? formatAutoReplyResult(exec.result, lang)
                              : formatGenericResult(exec.result, lang)
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          </div>
        </div>
      </div>

      {/* Actions Footer */}
      <div className="flex items-center gap-2 p-4 border-t border-[var(--border-color)]">
        <button
          onClick={handleRunNow}
          disabled={actionLoading}
          className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs bg-black text-white hover:bg-gray-800 transition-colors cursor-pointer disabled:opacity-50"
        >
          <Zap size={12} />
          <span>{lang === 'en' ? 'Run Now' : '立即执行'}</span>
        </button>

        {/* Logs Button (not for FOLLOW_DIGEST) */}
        {task.task_type !== TaskType.FOLLOW_DIGEST && (
          <button
            onClick={() => {
              setShowLogsPanel(!showLogsPanel);
              if (!showLogsPanel) setShowSettingsPanel(false);
            }}
            className={`p-2 rounded-full transition-colors cursor-pointer relative ${
              showLogsPanel
                ? 'bg-[var(--bg-secondary)] text-[var(--text-primary)]'
                : 'hover:bg-[var(--hover-bg)] text-[var(--text-secondary)]'
            }`}
            title={lang === 'en' ? 'View Logs' : '查看日志'}
          >
            <FileText size={18} />
            {activityLog.length > 0 && (
              <span className="absolute top-0 right-0 w-2 h-2 bg-blue-500 rounded-full" />
            )}
          </button>
        )}

        {/* Settings Button */}
        <button
          onClick={() => {
            setShowSettingsPanel(!showSettingsPanel);
            if (!showSettingsPanel) setShowLogsPanel(false);
          }}
          className={`p-2 rounded-lg transition-colors cursor-pointer ${
            showSettingsPanel
              ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
              : 'text-[var(--text-secondary)] hover:bg-[var(--hover-bg)]'
          }`}
          title={lang === 'en' ? 'Settings' : '设置'}
        >
          <Settings size={16} />
        </button>

        {/* Dry Run Badge */}
        {dryRunMode && (
          <DryRunBadge
            onDisable={() => {
              setDryRunMode(false);
              autoReplyService.updateSettings({ dryRunMode: false });
            }}
          />
        )}

        <div className="flex-1" />

        {/* Pause/Resume */}
        {task.status === TaskStatus.ACTIVE ? (
          <button
            onClick={() => handleAction(() => Promise.resolve(onPause(task.id)))}
            disabled={actionLoading}
            className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs bg-red-500 text-white hover:bg-red-600 transition-colors cursor-pointer disabled:opacity-50"
            title={lang === 'en' ? 'Pause scheduled task' : '暂停定时任务'}
          >
            <Pause size={12} fill="currentColor" />
            <span>{lang === 'en' ? 'Pause' : '暂停'}</span>
          </button>
        ) : task.status === TaskStatus.PAUSED ? (
          <button
            onClick={() => handleAction(() => Promise.resolve(onResume(task.id)))}
            disabled={actionLoading}
            className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs bg-green-500 text-white hover:bg-green-600 transition-colors cursor-pointer disabled:opacity-50"
            title={lang === 'en' ? 'Resume scheduled task' : '恢复定时任务'}
          >
            <Play size={12} />
            <span>{lang === 'en' ? 'Resume' : '恢复'}</span>
          </button>
        ) : null}

{/* Delete button removed — default tasks cannot be deleted */}
      </div>

      {/* Logs Panel Overlay */}
      {showLogsPanel && (
        <div className="absolute inset-0 z-30 bg-[var(--bg-primary)] animate-in slide-in-from-bottom-2 duration-200 flex flex-col">
          <div className="px-4 pt-2 pb-4 border-b border-[var(--border-color)]">
            <span className="text-xs text-[var(--text-tertiary)] block mb-1">
              {lang === 'en' ? 'Execution Logs' : '执行日志'}
            </span>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-[var(--text-primary)] truncate">
                {task.name}
              </span>
              <div className="flex items-center gap-2 shrink-0 ml-2">
                <button
                  onClick={() => setShowLogsPanel(false)}
                  className="p-1.5 rounded-full hover:bg-[var(--hover-bg)] text-[var(--text-secondary)] transition-colors cursor-pointer"
                >
                  <X size={16} />
                </button>
              </div>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {/* Task-specific logs based on type */}
            {task.task_type === TaskType.AUTO_REPLY && (() => {
              const isActive = session && session.status !== 'idle' && session.status !== 'stopped';
              const isScheduled = session?.id?.startsWith('sched_');
              return (
                <div className="space-y-4">
                  {/* Control Buttons - only show for manual (Run Now) sessions */}
                  {isActive && !isScheduled && (
                    <SessionControlBar
                      status={session!.status}
                      onStart={() => autoReplyService.start()}
                      onPause={() => autoReplyService.pause()}
                      onResume={() => autoReplyService.resume()}
                      onStop={() => autoReplyService.stop()}
                      getStatusText={getStatusText}
                      dryRunMode={dryRunMode}
                      onDisableDryRun={() => {
                        setDryRunMode(false);
                        autoReplyService.updateSettings({ dryRunMode: false });
                      }}
                    />
                  )}

                  {/* Scheduled execution indicator */}
                  {isActive && isScheduled && (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 text-xs">
                      <RotateCw size={14} className="animate-spin" />
                      <span>{lang === 'en' ? 'Scheduled execution in progress...' : '定时任务执行中...'}</span>
                    </div>
                  )}

                  {/* Stats Card */}
                  {isActive && session && (
                    <SessionStatsCard
                      tweetsScanned={session.tweetsScanned}
                      repliesPosted={session.repliesPosted}
                      repliesSkipped={session.repliesSkipped}
                    />
                  )}

                  {/* Reasoning Display */}
                  {isActive && session?.currentReasoning && (
                    <ReasoningDisplay
                      reasoning={session.currentReasoning}
                      onClose={() => {}}
                      isStreaming={['evaluating', 'generating'].includes(session.status)}
                      status={session.status}
                      session={session}
                    />
                  )}

                  {/* Current Tweet Preview */}
                  {isActive && session?.currentTweet && (
                    <TweetCard
                      tweet={session.currentTweet}
                      evaluation={session.currentEvaluation}
                    />
                  )}

                  {/* Activity Logs */}
                  <ActivityLogsPanel
                    logs={activityLog}
                    onClearLogs={handleClearLogs}
                    maxHeight={isActive ? '250px' : 'none'}
                  />
                </div>
              );
            })()}
            {task.task_type === TaskType.HANDLE_NOTIFICATION && (() => {
              const isActive = notificationTaskExecutor.isTaskRunning();
              const isPaused = notificationTaskExecutor.isTaskPaused();
              return (
                <div className="space-y-4">
                  {/* Running indicator with pause/stop controls */}
                  {isActive && (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-50 dark:bg-blue-900/20 text-xs">
                      {isPaused ? (
                        <Pause size={14} className="text-yellow-500" />
                      ) : (
                        <RotateCw size={14} className="animate-spin text-blue-600 dark:text-blue-400" />
                      )}
                      <span className={isPaused ? 'text-yellow-600 dark:text-yellow-400' : 'text-blue-600 dark:text-blue-400'}>
                        {isPaused
                          ? (lang === 'en' ? 'Task paused' : '任务已暂停')
                          : (lang === 'en' ? 'Notification task executing...' : '通知任务执行中...')}
                      </span>
                      <div className="flex-1" />
                      {/* Pause / Resume button */}
                      <button
                        onClick={() => {
                          if (isPaused) {
                            notificationTaskExecutor.resume();
                          } else {
                            notificationTaskExecutor.pause();
                          }
                          // Force re-render
                          setActivityLog([...notificationTaskExecutor.getActivityLog()]);
                        }}
                        className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors cursor-pointer ${
                          isPaused
                            ? 'text-green-600 hover:bg-green-100 dark:hover:bg-green-900/20'
                            : 'text-yellow-600 hover:bg-yellow-100 dark:hover:bg-yellow-900/20'
                        }`}
                        title={isPaused ? (lang === 'en' ? 'Resume' : '继续') : (lang === 'en' ? 'Pause' : '暂停')}
                      >
                        {isPaused ? <Play size={12} /> : <Pause size={12} />}
                        <span>{isPaused ? (lang === 'en' ? 'Resume' : '继续') : (lang === 'en' ? 'Pause' : '暂停')}</span>
                      </button>
                      {/* Stop button */}
                      <button
                        onClick={() => {
                          notificationTaskExecutor.stop();
                          setActivityLog([...notificationTaskExecutor.getActivityLog()]);
                        }}
                        className="flex items-center gap-1 px-2 py-1 rounded text-xs text-red-500 hover:bg-red-100 dark:hover:bg-red-900/20 transition-colors cursor-pointer"
                        title={lang === 'en' ? 'Stop' : '停止'}
                      >
                        <Square size={12} fill="currentColor" />
                        <span>{lang === 'en' ? 'Stop' : '停止'}</span>
                      </button>
                    </div>
                  )}

                  {/* Reasoning Display */}
                  {isActive && notifCurrentReasoning && (
                    <ReasoningDisplay
                      reasoning={notifCurrentReasoning}
                      onClose={() => {}}
                      isStreaming={notifIsStreaming}
                      status={notifIsStreaming ? 'evaluating' : 'idle'}
                    />
                  )}

                  {/* Current Tweet Preview */}
                  {isActive && notifCurrentTweet && (
                    <TweetCard
                      tweet={notifCurrentTweet}
                      evaluation={notifCurrentEvaluation || undefined}
                    />
                  )}

                  {/* Activity Logs */}
                  <ActivityLogsPanel
                    logs={activityLog}
                    onClearLogs={handleClearLogs}
                    maxHeight={isActive ? '250px' : 'none'}
                  />
                </div>
              );
            })()}
            {task.task_type !== TaskType.AUTO_REPLY && task.task_type !== TaskType.HANDLE_NOTIFICATION && (
              <div className="text-xs text-[var(--text-tertiary)]">
                {lang === 'en' ? 'Logs will appear here during task execution.' : '任务执行时日志将显示在这里。'}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Settings Panel Overlay */}
      {showSettingsPanel && (
        <div className="absolute inset-0 z-30 bg-[var(--bg-primary)] animate-in slide-in-from-bottom-2 duration-200 flex flex-col">
          <div className="px-4 pt-2 pb-4 border-b border-[var(--border-color)]">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-[var(--text-primary)]">
                {lang === 'en' ? 'Task Settings' : '任务设置'}
              </span>
              <div className="flex items-center gap-2 shrink-0 ml-2">
                <button
                  onClick={() => {
                    // Save local settings immediately
                    if (task.task_type === TaskType.HANDLE_NOTIFICATION) {
                      chrome.storage.local.set({ notificationTaskSettings: notifSettings });
                    } else if (task.task_type === TaskType.FOLLOW_DIGEST) {
                      chrome.storage.local.set({ followDigestSettings: digestSettings });
                    } else if (task.task_type === TaskType.AUTO_REPLY) {
                      autoReplyService.updateSettings(settings);
                    }
                    // Close panel immediately, save schedule in background
                    setShowSettingsPanel(false);
                    if (task.task_type === TaskType.AUTO_REPLY || task.task_type === TaskType.HANDLE_NOTIFICATION || task.task_type === TaskType.FOLLOW_DIGEST) {
                      const schedUpdate: any = {
                        frequency: schedFrequency,
                        execution_time: schedTime,
                      };
                      if (schedFrequency === TaskFrequency.HOURLY) {
                        schedUpdate.interval_hours = schedIntervalHours;
                      } else if (schedFrequency === TaskFrequency.WEEKLY) {
                        schedUpdate.day_of_week = schedDayOfWeek;
                      }
                      if (task.task_type === TaskType.FOLLOW_DIGEST) {
                        schedUpdate.notification_type = telegramEnabled ? NotificationType.TELEGRAM_ONLY : NotificationType.NONE;
                      }
                      setIsSavingSchedule(true);
                      scheduledTaskService.updateTask(task.id, schedUpdate)
                        .then(() => scheduledTaskService.notifyAlarmSync(task.id))
                        .catch(err => console.error('[TaskDetailView] Failed to update schedule:', err))
                        .finally(() => { if (isMountedRef.current) setIsSavingSchedule(false); });
                    }
                  }}
                  className="px-3 py-1.5 bg-black text-white rounded-lg text-xs hover:bg-gray-800 transition-colors cursor-pointer"
                >
                  {lang === 'en' ? 'Save' : '保存'}
                </button>
                <button
                  onClick={() => setShowSettingsPanel(false)}
                  className="p-1.5 rounded-full hover:bg-[var(--hover-bg)] text-[var(--text-secondary)] transition-colors cursor-pointer"
                >
                  <X size={16} />
                </button>
              </div>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {/* Schedule Settings */}
            {(task.task_type === TaskType.AUTO_REPLY || task.task_type === TaskType.HANDLE_NOTIFICATION || task.task_type === TaskType.FOLLOW_DIGEST) && (
              <div className="space-y-3 mb-4 pb-4 border-b border-[var(--border-color)]">
                <h4 className="text-xs font-medium text-[var(--text-primary)]">
                  {lang === 'en' ? 'Schedule' : '调度频率'}
                </h4>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs text-[var(--text-secondary)] block mb-1">
                      {lang === 'en' ? 'Frequency' : '频率'}
                    </label>
                    <select
                      value={schedFrequency}
                      onChange={(e) => setSchedFrequency(e.target.value as TaskFrequency)}
                      className="w-full p-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] text-[var(--text-primary)] text-sm cursor-pointer"
                    >
                      <option value={TaskFrequency.HOURLY}>{FREQUENCY_LABELS[TaskFrequency.HOURLY][lang]}</option>
                      <option value={TaskFrequency.DAILY}>{FREQUENCY_LABELS[TaskFrequency.DAILY][lang]}</option>
                      {task.task_type === TaskType.GENERATE_TWEET && (
                        <option value={TaskFrequency.WEEKLY}>{FREQUENCY_LABELS[TaskFrequency.WEEKLY][lang]}</option>
                      )}
                    </select>
                  </div>
                  {schedFrequency === TaskFrequency.HOURLY ? (
                    <div>
                      <label className="text-xs text-[var(--text-secondary)] block mb-1">
                        {lang === 'en' ? 'Every' : '间隔'}
                      </label>
                      <select
                        value={schedIntervalHours}
                        onChange={(e) => setSchedIntervalHours(parseInt(e.target.value))}
                        className="w-full p-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] text-[var(--text-primary)] text-sm cursor-pointer"
                      >
                        {[1, 2, 3, 4, 6, 8, 12].map(h => (
                          <option key={h} value={h}>{h}h</option>
                        ))}
                      </select>
                    </div>
                  ) : schedFrequency === TaskFrequency.WEEKLY ? (
                    <div>
                      <label className="text-xs text-[var(--text-secondary)] block mb-1">
                        {lang === 'en' ? 'Day' : '星期'}
                      </label>
                      <select
                        value={schedDayOfWeek}
                        onChange={(e) => setSchedDayOfWeek(parseInt(e.target.value))}
                        className="w-full p-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] text-[var(--text-primary)] text-sm cursor-pointer"
                      >
                        {DAY_OF_WEEK_LABELS[lang].map((day, idx) => (
                          <option key={idx} value={idx}>{day}</option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <div>
                      <label className="text-xs text-[var(--text-secondary)] block mb-1">
                        {lang === 'en' ? 'Time' : '时间'}
                      </label>
                      <div className="flex gap-1">
                        <select
                          value={schedTime.split(':')[0]}
                          onChange={(e) => setSchedTime(`${e.target.value}:${schedTime.split(':')[1] || '00'}`)}
                          className="w-1/2 p-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] text-[var(--text-primary)] text-sm cursor-pointer"
                        >
                          {Array.from({ length: 24 }, (_, i) => i.toString().padStart(2, '0')).map((h) => (
                            <option key={h} value={h}>{h}</option>
                          ))}
                        </select>
                        <select
                          value={schedTime.split(':')[1] || '00'}
                          onChange={(e) => setSchedTime(`${schedTime.split(':')[0]}:${e.target.value}`)}
                          className="w-1/2 p-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] text-[var(--text-primary)] text-sm cursor-pointer"
                        >
                          {Array.from({ length: 60 }, (_, i) => i.toString().padStart(2, '0')).map((m) => (
                            <option key={m} value={m}>{m}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Task-specific settings based on type */}
            {task.task_type === TaskType.AUTO_REPLY && (
              <div className="space-y-4">
                <h4 className="text-xs font-medium text-[var(--text-primary)]">
                  {lang === 'en' ? 'Reply Settings' : '回复参数'}
                </h4>
                {/* Replies / Interval / Tone - one row */}
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="text-xs text-[var(--text-secondary)] block mb-1">
                      {lang === 'en' ? 'Replies' : '回复数'}
                    </label>
                    <input
                      type="number"
                      value={settings.sessionLimit}
                      onChange={(e) => setSettings({ ...settings, sessionLimit: parseInt(e.target.value) || 1 })}
                      className="w-full p-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] text-[var(--text-primary)] text-sm"
                      min={1}
                      max={100}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-[var(--text-secondary)] block mb-1">
                      {lang === 'en' ? 'Interval (s)' : '间隔（秒）'}
                    </label>
                    <input
                      type="number"
                      value={settings.maxIntervalSeconds}
                      onChange={(e) => {
                        const val = parseInt(e.target.value) || 1;
                        setSettings({ ...settings, maxIntervalSeconds: val, minIntervalSeconds: 0 });
                      }}
                      className="w-full p-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] text-[var(--text-primary)] text-sm"
                      min={1}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-[var(--text-secondary)] block mb-1">
                      {lang === 'en' ? 'Tone' : '语气'}
                    </label>
                    <select
                      value={settings.replyTone}
                      onChange={(e) => setSettings({ ...settings, replyTone: e.target.value as any })}
                      className="w-full p-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] text-[var(--text-primary)] text-sm"
                    >
                      <option value="casual">{lang === 'en' ? 'Casual' : '随意'}</option>
                      <option value="professional">{lang === 'en' ? 'Professional' : '专业'}</option>
                      <option value="humorous">{lang === 'en' ? 'Humorous' : '幽默'}</option>
                      <option value="match_author">{lang === 'en' ? 'Match Author' : '匹配作者'}</option>
                    </select>
                  </div>
                </div>

                {/* Target Tweet Types */}
                <div>
                  <label className="text-xs text-[var(--text-secondary)] block mb-1">
                    {lang === 'en' ? 'Target Tweet Types' : '目标推文类型'}
                  </label>
                  <textarea
                    value={settings.targetTweetTypes || ''}
                    onChange={(e) => setSettings({ ...settings, targetTweetTypes: e.target.value })}
                    placeholder={lang === 'en' ? 'e.g. Airdrop announcements, crypto, AI, web3...' : '例如：空投公告、加密货币、AI、web3...'}
                    className="w-full p-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] text-[var(--text-primary)] text-sm resize-none h-16"
                  />
                </div>

                {/* Custom Instructions */}
                <div>
                  <label className="text-xs text-[var(--text-secondary)] block mb-1">
                    {lang === 'en' ? 'Custom Instructions' : '自定义指令'}
                  </label>
                  <textarea
                    value={settings.customInstructions || ''}
                    onChange={(e) => setSettings({ ...settings, customInstructions: e.target.value })}
                    placeholder={lang === 'en' ? 'e.g. Focus on crypto topics, be friendly...' : '例如：专注加密话题，友好回复...'}
                    className="w-full p-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] text-[var(--text-primary)] text-sm resize-none h-16"
                  />
                </div>

                {/* Advanced Settings - Collapsible */}
                <div className="pt-3 border-t border-[var(--border-color)]">
                  <button
                    onClick={() => setShowAdvancedSettings(!showAdvancedSettings)}
                    className="flex items-center justify-between w-full text-xs font-medium text-[var(--text-primary)] cursor-pointer"
                  >
                    <span>{lang === 'en' ? 'Advanced Settings' : '高级设置'}</span>
                    {showAdvancedSettings ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </button>

                  {showAdvancedSettings && (
                    <div className="mt-3 space-y-3">
                      {/* Exclude Handles */}
                      <div>
                        <label className="text-xs text-[var(--text-secondary)] block mb-1">
                          {lang === 'en' ? 'Exclude Handles (comma separated)' : '排除账号（逗号分隔）'}
                        </label>
                        <input
                          type="text"
                          value={(settings.excludeHandles || []).join(', ')}
                          onChange={(e) => setSettings({ ...settings, excludeHandles: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                          placeholder={lang === 'en' ? 'e.g. elonmusk, vitalik' : '例如：elonmusk, vitalik'}
                          className="w-full p-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] text-[var(--text-primary)] text-sm"
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-xs text-[var(--text-secondary)] block mb-1">
                            {lang === 'en' ? 'Min Likes' : '最小点赞数'}
                          </label>
                          <input
                            type="number"
                            value={settings.minLikeCount}
                            onChange={(e) => setSettings({ ...settings, minLikeCount: parseInt(e.target.value) || 0 })}
                            className="w-full p-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] text-[var(--text-primary)] text-sm"
                            min={0}
                          />
                        </div>
                        <div>
                          <label className="text-xs text-[var(--text-secondary)] block mb-1">
                            {lang === 'en' ? 'Min Views' : '最小浏览数'}
                          </label>
                          <input
                            type="number"
                            value={settings.minTweetViews}
                            onChange={(e) => setSettings({ ...settings, minTweetViews: parseInt(e.target.value) || 0 })}
                            className="w-full p-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] text-[var(--text-primary)] text-sm"
                            min={0}
                            step={100}
                          />
                        </div>
                        <div>
                          <label className="text-xs text-[var(--text-secondary)] block mb-1">
                            {lang === 'en' ? 'Min Followers' : '最小粉丝数'}
                          </label>
                          <input
                            type="number"
                            value={settings.minFollowerCount}
                            onChange={(e) => setSettings({ ...settings, minFollowerCount: parseInt(e.target.value) || 0 })}
                            className="w-full p-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] text-[var(--text-primary)] text-sm"
                            min={0}
                            step={100}
                          />
                        </div>
                        <div>
                          <label className="text-xs text-[var(--text-secondary)] block mb-1">
                            {lang === 'en' ? 'Max Tweet Age (Hours)' : '推文最大年龄（小时）'}
                          </label>
                          <input
                            type="number"
                            value={settings.maxTweetAgeHours}
                            onChange={(e) => setSettings({ ...settings, maxTweetAgeHours: parseInt(e.target.value) || 1 })}
                            className="w-full p-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] text-[var(--text-primary)] text-sm"
                            min={1}
                            max={72}
                          />
                        </div>
                      </div>

                      {/* Min Expected Exposure */}
                      <div>
                        <label className="text-xs text-[var(--text-secondary)] block mb-1">
                          {lang === 'en' ? 'Min Expected Exposure' : '最小预期曝光'}
                        </label>
                        <input
                          type="number"
                          value={settings.minExpectedExposure}
                          onChange={(e) => setSettings({ ...settings, minExpectedExposure: parseInt(e.target.value) || 0 })}
                          className="w-full p-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] text-[var(--text-primary)] text-sm"
                          min={0}
                          step={100}
                        />
                        <p className="text-xs text-[var(--text-tertiary)] mt-1">
                          {lang === 'en' ? '0 = no filtering. Uses local prediction algorithm.' : '0 = 不过滤。使用本地预测算法。'}
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                {/* Toggles */}
                <div className="space-y-3 pt-3 border-t border-[var(--border-color)]">
                  <h5 className="text-xs font-medium text-[var(--text-primary)] mb-2">
                    {lang === 'en' ? 'Mode Settings' : '模式设置'}
                  </h5>
                  <label className="flex items-center justify-between cursor-pointer">
                    <span className="text-sm text-[var(--text-primary)]">
                      {lang === 'en' ? 'Dry Run Mode (No posting)' : '测试模式（不发布）'}
                    </span>
                    <div className="relative">
                      <input
                        type="checkbox"
                        checked={settings.dryRunMode}
                        onChange={(e) => {
                          setSettings({ ...settings, dryRunMode: e.target.checked });
                          setDryRunMode(e.target.checked);
                        }}
                        className="sr-only peer"
                      />
                      <div className="w-8 h-4 bg-gray-300 rounded-full peer peer-checked:bg-green-500 transition-colors"></div>
                      <div className="absolute left-0.5 top-0.5 w-3 h-3 bg-white rounded-full shadow-sm transition-transform peer-checked:translate-x-4"></div>
                    </div>
                  </label>
                  <label className="flex items-center justify-between cursor-pointer">
                    <span className="text-sm text-[var(--text-primary)]">
                      {lang === 'en' ? 'Generate Reply Images' : '生成回复图片'}
                    </span>
                    <div className="relative">
                      <input
                        type="checkbox"
                        checked={settings.enableImageGeneration}
                        onChange={(e) => {
                          setSettings({ ...settings, enableImageGeneration: e.target.checked });
                          setGenerateImages(e.target.checked);
                        }}
                        className="sr-only peer"
                      />
                      <div className="w-8 h-4 bg-gray-300 rounded-full peer peer-checked:bg-green-500 transition-colors"></div>
                      <div className="absolute left-0.5 top-0.5 w-3 h-3 bg-white rounded-full shadow-sm transition-transform peer-checked:translate-x-4"></div>
                    </div>
                  </label>
                </div>
              </div>
            )}
            {task.task_type === TaskType.HANDLE_NOTIFICATION && (
              <div className="space-y-4">
                <h4 className="text-xs font-medium text-[var(--text-primary)]">
                  {lang === 'en' ? 'Notification Settings' : '通知参数'}
                </h4>

                {/* Settings */}
                <div className="space-y-3">
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="text-xs text-[var(--text-secondary)] block mb-1">
                        {lang === 'en' ? 'Max Notifs' : '最大通知数'}
                      </label>
                      <input
                        type="number"
                        value={notifSettings.phase2MaxCount}
                        onChange={(e) => {
                          const val = parseInt(e.target.value) || 1;
                          setNotifSettings({ ...notifSettings, phase2MaxCount: val, phase1MaxCount: val });
                        }}
                        className="w-full p-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] text-[var(--text-primary)] text-sm"
                        min={1}
                        max={100}
                      />
                    </div>
                    <div>
                      <label className="text-xs text-[var(--text-secondary)] block mb-1">
                        {lang === 'en' ? 'Interval (s)' : '间隔(秒)'}
                      </label>
                      <input
                        type="number"
                        value={notifSettings.maxWaitSeconds}
                        onChange={(e) => {
                          const val = parseInt(e.target.value) || 1;
                          setNotifSettings({ ...notifSettings, maxWaitSeconds: val, minWaitSeconds: 0 });
                        }}
                        className="w-full p-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] text-[var(--text-primary)] text-sm"
                        min={1}
                        max={60}
                      />
                    </div>
                    <div>
                      <label className="text-xs text-[var(--text-secondary)] block mb-1">
                        {lang === 'en' ? 'Max Age (m)' : '时效(分)'}
                      </label>
                      <input
                        type="number"
                        value={notifSettings.phase1MaxTweetAge}
                        onChange={(e) => setNotifSettings({ ...notifSettings, phase1MaxTweetAge: parseInt(e.target.value) || 5 })}
                        className="w-full p-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] text-[var(--text-primary)] text-sm"
                        min={5}
                        max={120}
                      />
                    </div>
                  </div>

                  {/* Custom Instructions */}
                  <div>
                    <label className="text-xs text-[var(--text-secondary)] block mb-1">
                      {lang === 'en' ? 'Custom Instructions' : '自定义指令'}
                    </label>
                    <textarea
                      value={notifSettings.customInstructions}
                      onChange={(e) => setNotifSettings({ ...notifSettings, customInstructions: e.target.value })}
                      placeholder={lang === 'en' ? 'e.g. Reply in casual tone, focus on crypto topics...' : '例如：用轻松语气回复，专注加密话题...'}
                      className="w-full p-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] text-[var(--text-primary)] text-sm resize-none h-16"
                    />
                  </div>

                  {/* Exclude Handles */}
                  <div>
                    <label className="text-xs text-[var(--text-secondary)] block mb-1">
                      {lang === 'en' ? 'Exclude Handles (comma separated)' : '排除账号（逗号分隔）'}
                    </label>
                    <input
                      type="text"
                      value={(notifSettings.excludeHandles || []).join(', ')}
                      onChange={(e) => setNotifSettings({ ...notifSettings, excludeHandles: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                      placeholder={lang === 'en' ? 'e.g. elonmusk, vitalik' : '例如：elonmusk, vitalik'}
                      className="w-full p-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] text-[var(--text-primary)] text-sm"
                    />
                  </div>
                </div>
              </div>
            )}
            {task.task_type === TaskType.FOLLOW_DIGEST && (
              <div className="space-y-4">
                <h4 className="text-xs font-medium text-[var(--text-primary)]">
                  {lang === 'en' ? 'Digest Settings' : '摘要参数'}
                </h4>

                {/* Custom Prompt */}
                <div>
                  <label className="text-xs text-[var(--text-secondary)] block mb-1">
                    {lang === 'en' ? 'Custom Prompt' : '自定义提示词'}
                  </label>
                  <textarea
                    value={digestSettings.customPrompt}
                    onChange={(e) => setDigestSettings({ ...digestSettings, customPrompt: e.target.value })}
                    placeholder={lang === 'en'
                      ? 'e.g. Focus on AI and crypto topics, summarize in bullet points...'
                      : '例如：重点关注 AI 和加密货币话题，用要点形式总结...'}
                    className="w-full p-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] text-[var(--text-primary)] text-sm resize-none h-24"
                  />
                  <p className="text-xs text-[var(--text-tertiary)] mt-1">
                    {lang === 'en' ? 'Guide the AI on how to generate your digest.' : '指导 AI 如何为你生成摘要。'}
                  </p>
                </div>

                {/* Max Tweets */}
                <div>
                  <label className="text-xs text-[var(--text-secondary)] block mb-1">
                    {lang === 'en' ? 'Max Tweets' : '最大推文数'}
                  </label>
                  <input
                    type="number"
                    value={digestSettings.maxTweets}
                    onChange={(e) => setDigestSettings({ ...digestSettings, maxTweets: parseInt(e.target.value) || 100 })}
                    className="w-full p-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] text-[var(--text-primary)] text-sm"
                    min={10}
                    max={500}
                  />
                  <p className="text-xs text-[var(--text-tertiary)] mt-1">
                    {lang === 'en' ? 'Number of tweets to collect for digest generation.' : '用于生成摘要的推文收集数量。'}
                  </p>
                </div>

                {/* Interests */}
                <div>
                  <label className="text-xs text-[var(--text-secondary)] block mb-1">
                    {lang === 'en' ? 'Interests (comma separated)' : '兴趣标签（逗号分隔）'}
                  </label>
                  <input
                    type="text"
                    value={digestSettings.interests}
                    onChange={(e) => setDigestSettings({ ...digestSettings, interests: e.target.value })}
                    placeholder={lang === 'en' ? 'e.g. AI, crypto, web3, DeFi' : '例如：AI, 加密货币, web3, DeFi'}
                    className="w-full p-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] text-[var(--text-primary)] text-sm"
                  />
                </div>

                {/* Keywords */}
                <div>
                  <label className="text-xs text-[var(--text-secondary)] block mb-1">
                    {lang === 'en' ? 'Keywords (comma separated)' : '关键词（逗号分隔）'}
                  </label>
                  <input
                    type="text"
                    value={digestSettings.keywords}
                    onChange={(e) => setDigestSettings({ ...digestSettings, keywords: e.target.value })}
                    placeholder={lang === 'en' ? 'e.g. airdrop, token launch, funding' : '例如：空投, 代币发行, 融资'}
                    className="w-full p-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] text-[var(--text-primary)] text-sm"
                  />
                </div>

                {/* Telegram Notification Toggle */}
                <div className="pt-3 border-t border-[var(--border-color)]">
                  <label className="flex items-center justify-between cursor-pointer">
                    <span className="text-sm text-[var(--text-primary)]">
                      {lang === 'en' ? 'Telegram Notification' : 'Telegram 通知'}
                    </span>
                    <div className="relative">
                      <input
                        type="checkbox"
                        checked={telegramEnabled}
                        onChange={(e) => setTelegramEnabled(e.target.checked)}
                        className="sr-only peer"
                      />
                      <div className="w-8 h-4 bg-gray-300 rounded-full peer peer-checked:bg-green-500 transition-colors"></div>
                      <div className="absolute left-0.5 top-0.5 w-3 h-3 bg-white rounded-full shadow-sm transition-transform peer-checked:translate-x-4"></div>
                    </div>
                  </label>
                  <p className="text-xs text-[var(--text-tertiary)] mt-1">
                    {lang === 'en' ? 'Send digest results to Telegram.' : '将摘要结果发送到 Telegram。'}
                  </p>
                </div>
              </div>
            )}
            {task.task_type !== TaskType.AUTO_REPLY && task.task_type !== TaskType.HANDLE_NOTIFICATION && task.task_type !== TaskType.FOLLOW_DIGEST && (
              <div className="text-xs text-[var(--text-tertiary)]">
                {lang === 'en' ? 'No specific settings available for this task type.' : '此任务类型暂无特定设置。'}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
