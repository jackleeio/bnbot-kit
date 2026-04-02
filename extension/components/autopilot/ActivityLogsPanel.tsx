import React, { useRef, useEffect, useState } from 'react';
import { FileText } from 'lucide-react';
import { ActivityLogEntry } from '../../types/autoReply';
import { useLanguage } from '../LanguageContext';

interface ActivityLogsPanelProps {
  logs: ActivityLogEntry[];
  onClearLogs?: () => void;
  maxHeight?: string;
}

export const ActivityLogsPanel: React.FC<ActivityLogsPanelProps> = ({
  logs,
  onClearLogs,
  maxHeight = '200px'
}) => {
  const { language } = useLanguage();
  const lang = language === 'zh' ? 'zh' : 'en';
  const logContainerRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  // Handle manual scroll detection
  const handleScroll = () => {
    if (!logContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = logContainerRef.current;
    const isNearBottom = scrollHeight - scrollTop - clientHeight < 50;
    setAutoScroll(isNearBottom);
  };

  // Auto-scroll to bottom when logs update (within container only)
  useEffect(() => {
    if (logContainerRef.current && autoScroll) {
      logContainerRef.current.scrollTo({
        top: logContainerRef.current.scrollHeight,
        behavior: 'smooth'
      });
    }
  }, [logs, autoScroll]);

  return (
    <div className="rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-color)] overflow-hidden flex flex-col" style={{ maxHeight }}>
      <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--border-color)] shrink-0">
        <h3 className="text-sm font-medium text-[var(--text-primary)]">
          {lang === 'en' ? 'Activity Logs' : '活动日志'}
        </h3>
        {onClearLogs && logs.length > 0 && (
          <button
            onClick={onClearLogs}
            className="text-xs text-red-500 hover:underline cursor-pointer"
          >
            {lang === 'en' ? 'Clear' : '清空'}
          </button>
        )}
      </div>
      <div
        ref={logContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-2 font-mono text-[11px] space-y-0.5 leading-tight"
      >
        {logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-6 text-[var(--text-tertiary)] opacity-50">
            <FileText size={24} className="mb-2" />
            <span className="text-xs">
              {lang === 'en' ? 'No activity recorded' : '暂无活动记录'}
            </span>
          </div>
        ) : (
          logs.map((log) => (
            <div key={log.id} className="flex items-baseline gap-3 px-2 py-1 hover:bg-[var(--hover-bg)] rounded transition-colors">
              <span className="text-[var(--text-tertiary)] shrink-0 select-none opacity-60">
                {new Date(log.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
              <div className={`flex-1 min-w-0 break-words leading-tight ${
                ['error', 'reply_failed'].includes(log.type) ? 'text-red-500' :
                ['reply_posted', 'reply_confirmed'].includes(log.type) ? 'text-green-500' :
                ['api_request'].includes(log.type) ? 'text-blue-500' :
                ['api_response'].includes(log.type) ? 'text-cyan-500' :
                ['debug'].includes(log.type) ? 'text-gray-400 dark:text-gray-500' :
                ['tweet_skipped'].includes(log.type) ? 'text-yellow-600 dark:text-yellow-500' :
                'text-[var(--text-secondary)]'
              }`}>
                {log.message}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
