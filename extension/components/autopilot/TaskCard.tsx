import React, { useState, useEffect } from 'react';
import { Clock, Calendar, Play, Pause, Zap, ChevronDown, ChevronUp, Settings, AlertCircle } from 'lucide-react';
import { localTaskService, LocalTask, LocalExecution } from '../../services/localTaskService';
import { useLanguage } from '../LanguageContext';

interface TaskCardProps {
  task: LocalTask;
  onSettings: (task: LocalTask) => void;
  onPause?: (taskId: string) => void;
  onResume?: (taskId: string) => void;
  onExecute?: (taskId: string) => void;
  isLoading?: boolean;
}

const TASK_LABELS: Record<string, { en: string; zh: string }> = {
  auto_reply: { en: 'Auto Reply', zh: '自动回复' },
  handle_notification: { en: 'Handle Notification', zh: '处理通知' },
};

const FREQ_LABELS: Record<string, { en: string; zh: string }> = {
  hourly: { en: 'Hourly', zh: '每小时' },
  daily: { en: 'Daily', zh: '每天' },
};

const formatRelativeTime = (dateStr: string | null, lang: string): string => {
  if (!dateStr) return lang === 'zh' ? '从未' : 'Never';
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return lang === 'zh' ? '刚刚' : 'Just now';
  if (mins < 60) return lang === 'zh' ? `${mins}分钟前` : `${mins}m ago`;
  const hrs = Math.floor(diffMs / 3600000);
  if (hrs < 24) return lang === 'zh' ? `${hrs}小时前` : `${hrs}h ago`;
  const days = Math.floor(diffMs / 86400000);
  if (days < 7) return lang === 'zh' ? `${days}天前` : `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
};

export const TaskCard: React.FC<TaskCardProps> = ({
  task, onSettings, onPause, onResume, onExecute, isLoading
}) => {
  const { language } = useLanguage();
  const lang = language === 'zh' ? 'zh' : 'en';
  const [expanded, setExpanded] = useState(true);
  const [executions, setExecutions] = useState<LocalExecution[]>([]);
  const [loadingExecs, setLoadingExecs] = useState(false);

  const typeLabel = TASK_LABELS[task.task_type]?.[lang] || task.task_type;
  const freqLabel = FREQ_LABELS[task.frequency]?.[lang] || task.frequency;
  const scheduleText = `${freqLabel} ${task.execution_time}`;

  useEffect(() => {
    if (expanded) {
      setLoadingExecs(true);
      localTaskService.getExecutions(task.id, 5)
        .then(setExecutions)
        .catch(() => {})
        .finally(() => setLoadingExecs(false));
    }
  }, [expanded, task.id, task.execution_count]);

  return (
    <div className={`rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-color)] transition-all ${isLoading ? 'opacity-60 pointer-events-none' : ''}`}>
      {/* Header */}
      <div
        onClick={() => setExpanded(!expanded)}
        className="p-4 cursor-pointer hover:bg-[var(--hover-bg)] rounded-t-xl transition-colors"
      >
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-semibold text-[var(--text-primary)]">{typeLabel}</h4>
            <span className="text-[11px] text-[var(--text-secondary)] flex items-center gap-1"><Clock size={10} />{scheduleText}</span>
            {task.execution_count > 0 && <span className="text-[10px] text-[var(--text-secondary)]">· {task.execution_count}{lang === 'zh' ? '次' : ' runs'}</span>}
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--text-secondary)]">
              <span className={`w-2 h-2 rounded-full ${task.status === 'active' ? 'bg-green-500' : 'bg-gray-400'}`} />
              <span>{task.status.toUpperCase()}</span>
            </div>
            {expanded ? <ChevronUp size={14} className="text-[var(--text-secondary)]" /> : <ChevronDown size={14} className="text-[var(--text-secondary)]" />}
          </div>
        </div>
      </div>

      {/* Expanded */}
      {expanded && (
        <div className="border-t border-[var(--border-color)]">
          {task.last_execution_at && (
            <div className="px-4 py-3 text-xs text-[var(--text-secondary)]">
              <div className="flex items-center gap-1.5">
                <Clock size={12} />
                <span>{lang === 'zh' ? '上次:' : 'Last:'} {formatRelativeTime(task.last_execution_at, lang)}</span>
              </div>
            </div>
          )}

          {/* Execution history */}
          <div className="px-4 py-3 border-t border-[var(--border-color)]">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-[var(--text-primary)]">
                {lang === 'zh' ? '执行历史' : 'Recent Executions'}
              </span>
              <span className="text-[10px] text-[var(--text-secondary)]">
                {task.execution_count} {lang === 'zh' ? '次' : 'total'}
              </span>
            </div>
            {loadingExecs ? (
              <div className="space-y-1.5">
                {[1, 2].map(i => <div key={i} className="h-6 bg-[var(--hover-bg)] rounded animate-pulse" />)}
              </div>
            ) : executions.length === 0 ? (
              <div className="flex items-center justify-center py-10 text-[var(--text-secondary)]">
                <AlertCircle size={14} className="mr-1.5 opacity-50" />
                <span className="text-xs">{lang === 'zh' ? '暂无执行记录' : 'No executions yet'}</span>
              </div>
            ) : (
              <div className="space-y-1.5">
                {executions.map(exec => (
                  <div key={exec.id} className="flex items-center justify-between text-[11px] py-1 px-2 rounded bg-[var(--bg-primary)]">
                    <span className={exec.status === 'completed' ? 'text-green-600' : exec.status === 'failed' ? 'text-red-500' : 'text-[var(--text-secondary)]'}>
                      {exec.status === 'completed' ? '✓' : exec.status === 'failed' ? '✗' : '●'} {exec.status}
                    </span>
                    <span className="text-[var(--text-secondary)]">{formatRelativeTime(exec.started_at, lang)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 px-4 py-2.5 border-t border-[var(--border-color)]">
            <button
              onClick={(e) => { e.stopPropagation(); onExecute?.(task.id); }}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--text-primary)] hover:bg-[var(--hover-bg)] transition-colors cursor-pointer"
            >
              <Zap size={11} />
              {lang === 'zh' ? '立即执行' : 'Run Now'}
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onSettings(task); }}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--text-primary)] hover:bg-[var(--hover-bg)] transition-colors cursor-pointer"
            >
              <Settings size={11} />
              {lang === 'zh' ? '设置' : 'Settings'}
            </button>
            <div className="flex-1" />
            {task.status === 'active' ? (
              <button
                onClick={(e) => { e.stopPropagation(); onPause?.(task.id); }}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium text-red-500 hover:bg-red-50 transition-colors cursor-pointer"
              >
                <Pause size={11} fill="currentColor" />
                {lang === 'zh' ? '暂停' : 'Pause'}
              </button>
            ) : (
              <button
                onClick={(e) => { e.stopPropagation(); onResume?.(task.id); }}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium text-green-600 hover:bg-green-50 transition-colors cursor-pointer"
              >
                <Play size={11} />
                {lang === 'zh' ? '恢复' : 'Resume'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
