import React, { useState, useEffect, useRef } from 'react';
import {
  Play,
  Pause,
  Square,
  Settings,
  ChevronDown,
  ChevronUp,
  Check,
  X,
  Edit3,
  SkipForward,
  AlertCircle,
  RefreshCw,
  ArrowLeft,
  FileText
} from 'lucide-react';
import { SteeringWheel } from '../icons/SteeringWheel';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useTheme } from '../ThemeContext';
import { useLanguage } from '../LanguageContext';
import { autoReplyService } from '../../services/autoReplyService';
import { commandService } from '../../services/commandService';
import {
  AutoReplySession,
  AutoReplySettings,
  AutoReplyEvent,
  ActivityLogEntry,
  DEFAULT_AUTO_REPLY_SETTINGS
} from '../../types/autoReply';
import { TaskList } from '../autopilot/TaskList';
import { TaskDetailView } from '../autopilot/TaskDetailView';
import { ScheduledTask, TaskExecution, TaskType } from '../../services/scheduledTaskService';
import { localTaskService } from '../../services/localTaskService';
import { notificationTaskExecutor } from '../../utils/NotificationTaskExecutor';

interface AutoPilotPanelProps {
  isLoggedIn?: boolean;
  onLoginClick?: () => void;
}

type ViewMode = 'tasks' | 'session';

// 任务执行状态提示
interface ExecuteNotification {
  type: 'success' | 'error';
  message: string;
}

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

const ReasoningDisplay: React.FC<{
  reasoning: string;
  onClose: () => void;
  isStreaming?: boolean;
  status?: string;
  session?: AutoReplySession;
}> = ({ reasoning, onClose, isStreaming, status, session }) => {
  const contentRef = useRef<HTMLDivElement>(null);
  const { t } = useLanguage();
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
                  ? (t.autoPilot.statusMap as any)[status] || status
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

const formatMetric = (num: number): string => {
  if (num === 0) return '';
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + 'M';
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'K';
  }
  return num.toString();
};

export const AutoPilotPanel: React.FC<AutoPilotPanelProps> = ({
  isLoggedIn = false,
  onLoginClick
}) => {
  const { t } = useLanguage();
  const { theme } = useTheme();
  const { language } = useLanguage();
  const lang = language === 'zh' ? 'zh' : 'en';

  // View mode: tasks list or active session
  const [viewMode, setViewMode] = useState<ViewMode>('tasks');
  const [selectedTask, setSelectedTask] = useState<ScheduledTask | null>(null);

  // Task cache
  const [cachedTasks, setCachedTasks] = useState<ScheduledTask[] | null>(null);
  const [cachedQuota, setCachedQuota] = useState<any>(null);
  // Execution history cache per task
  const executionsCacheRef = useRef<Record<string, TaskExecution[]>>({});

  // Session state
  const [session, setSession] = useState<AutoReplySession | null>(null);
  const [settings, setSettings] = useState<AutoReplySettings>(DEFAULT_AUTO_REPLY_SETTINGS);
  const [activityLog, setActivityLog] = useState<ActivityLogEntry[]>([]);
  const [editingReply, setEditingReply] = useState(false);
  const [editedReplyContent, setEditedReplyContent] = useState('');
  const [isStarting, setIsStarting] = useState(false);
  const [showReasoningModal, setShowReasoningModal] = useState(true);
  const [wsConnected, setWsConnected] = useState(false);

  // Modal states
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [deleteConfirmTaskId, setDeleteConfirmTaskId] = useState<string | null>(null);

  // 任务执行通知
  const [executeNotification, setExecuteNotification] = useState<ExecuteNotification | null>(null);

  // Lower sidebar z-index when delete modal is open so modal covers it
  useEffect(() => {
    if (deleteConfirmTaskId) {
      const style = document.createElement('style');
      style.id = 'delete-modal-sidebar-fix';
      style.textContent = `
        [data-testid="bnbot-sidebar"] {
          z-index: 0 !important;
        }
        [data-testid="bnbot-sidebar"] * {
          z-index: 0 !important;
        }
      `;
      const shadowContainer = document.getElementById('x-sidekick-container');
      const target = shadowContainer?.shadowRoot || document.head;
      target.appendChild(style);

      return () => {
        const existingStyle = (shadowContainer?.shadowRoot || document).getElementById('delete-modal-sidebar-fix');
        existingStyle?.remove();
      };
    }
  }, [deleteConfirmTaskId]);

  // Connect WebSocket
  useEffect(() => {
    const checkConnection = async () => {
      const status = await commandService.getStatus();
      setWsConnected(status.connected);
    };

    commandService.init({
      onConnected: () => {
        console.log('[AutoPilotPanel] WebSocket connected');
        setWsConnected(true);
      },
      onDisconnected: () => {
        console.log('[AutoPilotPanel] WebSocket disconnected');
        setWsConnected(false);
      },
      onError: (err) => console.error('[AutoPilotPanel] WebSocket error:', err)
    });
    commandService.connect();

    checkConnection();
    const interval = setInterval(checkConnection, 2000);
    return () => clearInterval(interval);
  }, []);

  // Event listener for auto-reply session
  useEffect(() => {
    const handleEvent = (event: AutoReplyEvent) => {
      setSession(autoReplyService.getSession());
      setActivityLog(autoReplyService.getActivityLog());

      if (['tweet_evaluating', 'reply_generating'].includes(event.type)) {
        setShowReasoningModal(true);
      }
    };

    autoReplyService.addEventListener(handleEvent);

    setSettings(autoReplyService.getSettings());
    setSession(autoReplyService.getSession());
    setActivityLog(autoReplyService.getActivityLog());

    return () => {
      autoReplyService.removeEventListener(handleEvent);
    };
  }, []);

  // Handlers
  const handleStart = async () => {
    try {
      console.log('[AutoPilotPanel] START button clicked');
      setIsStarting(true);

      const isNotificationOnly = settings.onlyProcessNotifications;

      if (!isNotificationOnly && window.location.pathname !== '/home') {
        console.log('[AutoPilotPanel] Not on home page, attempting navigation...');
        const homeLink = document.querySelector('[data-testid="AppTabBar_Home_Link"]') as HTMLElement;

        if (homeLink) {
          console.log('[AutoPilotPanel] Clicking home link...');
          homeLink.click();
          await new Promise(resolve => setTimeout(resolve, 1500));
        } else {
          // SPA-friendly navigation via temp link inside React root
          const tempLink = document.createElement('a');
          tempLink.href = '/home';
          tempLink.style.display = 'none';
          const reactRoot = document.getElementById('react-root') || document.body;
          reactRoot.appendChild(tempLink);
          tempLink.click();
          reactRoot.removeChild(tempLink);
          setIsStarting(false);
          return;
        }
      }

      autoReplyService.start(settings);
      setViewMode('session');
      setTimeout(() => setIsStarting(false), 1000);
    } catch (error) {
      console.error('[AutoPilotPanel] Error in handleStart:', error);
      alert(`启动失败: ${error instanceof Error ? error.message : String(error)}`);
      setIsStarting(false);
    }
  };

  const handlePause = () => {
    autoReplyService.pause();
  };

  const handleResume = () => {
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
  };

  const handleTaskClick = (task: any) => {
    setSelectedTask(task);
    setViewMode('session');
  };

  const handleTaskPause = async (taskId: string) => {
    try {
      await localTaskService.pause(taskId);
    } catch (err) {
      console.error('[AutoPilotPanel] Failed to pause task:', err);
    }
  };

  const handleTaskResume = async (taskId: string) => {
    try {
      await localTaskService.resume(taskId);
    } catch (err) {
      console.error('[AutoPilotPanel] Failed to resume task:', err);
    }
  };

  const handleTaskExecute = async (taskId: string) => {
    const task = await localTaskService.getTask(taskId);
    if (!task) return;

    setExecuteNotification({ type: 'success', message: lang === 'en' ? 'Task started...' : '任务已启动...' });
    setTimeout(() => setExecuteNotification(null), 3000);

    const exec = await localTaskService.startExecution(taskId);

    try {
      if (task.task_type === 'auto_reply') {
        await autoReplyService.start();
      } else {
        const execResult = await notificationTaskExecutor.execute();
        console.log('[AutoPilotPanel] Notification result:', execResult);
      }

      await localTaskService.completeExecution(exec.id, taskId, 'completed');
      setExecuteNotification({ type: 'success', message: lang === 'en' ? 'Task completed' : '任务完成' });
      setTimeout(() => setExecuteNotification(null), 3000);
    } catch (err: any) {
      console.error('[AutoPilotPanel] Task execution error:', err);
      await localTaskService.completeExecution(exec.id, taskId, 'failed', err.message);
      setExecuteNotification({ type: 'error', message: err.message || (lang === 'en' ? 'Failed' : '执行失败') });
      setTimeout(() => setExecuteNotification(null), 5000);
    }
  };

  const handleTaskUpdated = async () => {};

  const handleBackToTasks = () => {
    setViewMode('tasks');
  };

  const handleClearLogs = () => {
    autoReplyService.clearActivityLog();
    setActivityLog([]);
  };

  // Status helpers
  const getStatusText = (status: string | undefined) => {
    const statusMap: Record<string, string> = {
      idle: t.autoPilot.statusMap.idle,
      scrolling: t.autoPilot.statusMap.scrolling,
      evaluating: t.autoPilot.statusMap.evaluating,
      generating: t.autoPilot.statusMap.generating,
      generating_image: '🎨 正在生成图片...',
      confirming: t.autoPilot.statusMap.confirming,
      posting: t.autoPilot.statusMap.posting,
      waiting: t.autoPilot.statusMap.waiting,
      paused: t.autoPilot.statusMap.paused,
      stopped: t.autoPilot.statusMap.stopped
    };
    return statusMap[status || 'idle'] || status;
  };

  const isRunning = session && !['idle', 'stopped', 'paused'].includes(session.status);
  const isPaused = session?.status === 'paused';
  const isConfirming = session?.status === 'confirming';
  const estimatedCredits = session ? (session.tokensUsed / 125).toFixed(1) : '0';

  return (
    <div className="flex flex-col h-full overflow-hidden relative">
      {/* 执行通知 Toast */}
      {executeNotification && (
        <div className={`absolute top-2 left-2 right-2 z-50 p-3 rounded-lg shadow-lg animate-in slide-in-from-top-2 duration-200 ${
          executeNotification.type === 'success'
            ? 'bg-green-500 text-white'
            : 'bg-red-500 text-white'
        }`}>
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">{executeNotification.message}</span>
            <button
              onClick={() => setExecuteNotification(null)}
              className="p-0.5 hover:bg-white/20 rounded transition-colors"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-[var(--border-color)]">
        <div className="flex items-center gap-2">
          <SteeringWheel size={20} className="text-[var(--text-primary)]" />
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">{t.sidebar.autoReply}</h2>
          <div
            className={`w-2 h-2 rounded-full ${wsConnected ? 'bg-green-500' : 'bg-red-500'}`}
            title={wsConnected ? 'Remote control connected' : 'Remote control disconnected'}
          />
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 relative overflow-hidden flex flex-col">
        {viewMode === 'tasks' && (
          /* Task List View */
          <div className="flex-1 overflow-y-auto p-4">
            <TaskList
              onSettings={handleTaskClick}
              onPause={handleTaskPause}
              onResume={handleTaskResume}
              onExecute={handleTaskExecute}
            />
          </div>
        )}

        {viewMode === 'session' && selectedTask && (
          /* Task Detail View */
          <TaskDetailView
            task={selectedTask}
            onBack={handleBackToTasks}
            onPause={handleTaskPause}
            onResume={handleTaskResume}
            onDelete={() => {}}
            onRequestDelete={() => {}}
            onExecute={handleTaskExecute}
            onTaskUpdated={handleTaskUpdated}
            cachedExecutions={executionsCacheRef.current[selectedTask.id]}
            onExecutionsUpdate={(taskId, execs) => { executionsCacheRef.current[taskId] = execs; }}
          />
        )}
      </div>

    </div>
  );
};
