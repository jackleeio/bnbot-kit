import React, { useRef, useEffect, useState } from 'react';
import { X, Clock, ChevronDown, Trash2 } from 'lucide-react';
import { ActivityLogEntry } from '../../types/autoReply';
import { useLanguage } from '../LanguageContext';

interface LogsModalProps {
  isOpen: boolean;
  onClose: () => void;
  logs: ActivityLogEntry[];
  onClearLogs?: () => void;
}

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

export const LogsModal: React.FC<LogsModalProps> = ({
  isOpen,
  onClose,
  logs,
  onClearLogs
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

  // Auto-scroll to bottom when logs update
  useEffect(() => {
    if (logContainerRef.current && autoScroll) {
      logContainerRef.current.scrollTo({
        top: logContainerRef.current.scrollHeight,
        behavior: 'smooth'
      });
    }
  }, [logs, autoScroll]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg h-[70vh] bg-[var(--bg-primary)] rounded-2xl shadow-xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-color)]">
          <div className="flex items-center gap-2">
            <Clock size={16} className="text-[var(--text-secondary)]" />
            <h3 className="text-base font-semibold text-[var(--text-primary)]">
              {lang === 'en' ? 'Activity Logs' : '活动日志'}
            </h3>
            <span className="text-xs text-[var(--text-tertiary)] px-2 py-0.5 rounded-full bg-[var(--bg-secondary)]">
              {logs.length}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {onClearLogs && logs.length > 0 && (
              <button
                onClick={onClearLogs}
                className="p-1.5 rounded-full hover:bg-[var(--hover-bg)] text-[var(--text-tertiary)] hover:text-red-500 transition-colors"
                title={lang === 'en' ? 'Clear logs' : '清空日志'}
              >
                <Trash2 size={16} />
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1.5 rounded-full hover:bg-[var(--hover-bg)] text-[var(--text-secondary)] transition-colors"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Logs Content */}
        <div
          ref={logContainerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto p-3 font-mono text-[11px] space-y-0.5 leading-tight"
        >
          {logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-[var(--text-tertiary)] opacity-50">
              <Clock size={32} className="mb-3" />
              <span className="text-sm">
                {lang === 'en' ? 'No activity recorded' : '暂无活动记录'}
              </span>
            </div>
          ) : (
            logs.map((log) => (
              <AnimatedSection key={log.id} slideFrom="bottom" className="">
                <div className="group flex items-baseline gap-3 px-2 py-1 hover:bg-[var(--bg-secondary)] rounded transition-colors font-mono tracking-tight">
                  <span className="text-[var(--text-tertiary)] shrink-0 select-none opacity-60">
                    {new Date(log.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className={`break-words leading-tight ${['error', 'reply_failed'].includes(log.type) ? 'text-red-500' :
                      ['reply_posted', 'reply_confirmed'].includes(log.type) ? 'text-green-500' :
                        ['api_request'].includes(log.type) ? 'text-blue-500' :
                          ['api_response'].includes(log.type) ? 'text-cyan-500' :
                            ['debug'].includes(log.type) ? 'text-gray-400 dark:text-gray-500' :
                              ['tweet_skipped'].includes(log.type) ? 'text-yellow-600 dark:text-yellow-500' :
                                'text-[var(--text-secondary)]'
                      }`}>
                      {log.message}
                    </div>
                    {log.details && (
                      <div className="mt-1">
                        <details className="group/details">
                          <summary className="cursor-pointer text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] select-none flex items-center gap-1 transition-colors">
                            <ChevronDown size={10} className="group-open/details:rotate-180 transition-transform" />
                            <span className="text-[10px]">Details</span>
                          </summary>
                          <pre className="mt-1 text-[10px] text-[var(--text-secondary)] bg-[var(--bg-secondary)] p-2 rounded border border-[var(--border-color)] overflow-x-auto">
                            {typeof log.details === 'string' ? log.details : JSON.stringify(log.details, null, 2)}
                          </pre>
                        </details>
                      </div>
                    )}
                  </div>
                </div>
              </AnimatedSection>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-[var(--border-color)] bg-[var(--bg-secondary)]/50">
          <div className="flex items-center justify-between text-xs text-[var(--text-tertiary)]">
            <span>
              {autoScroll
                ? (lang === 'en' ? 'Auto-scrolling enabled' : '自动滚动已启用')
                : (lang === 'en' ? 'Scroll to bottom to resume auto-scroll' : '滚动到底部以恢复自动滚动')}
            </span>
            {!autoScroll && (
              <button
                onClick={() => {
                  if (logContainerRef.current) {
                    logContainerRef.current.scrollTo({
                      top: logContainerRef.current.scrollHeight,
                      behavior: 'smooth'
                    });
                  }
                }}
                className="text-blue-500 hover:underline"
              >
                {lang === 'en' ? 'Jump to latest' : '跳到最新'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
