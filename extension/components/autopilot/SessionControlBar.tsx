import React from 'react';
import { Play, Pause, Square } from 'lucide-react';
import { useLanguage } from '../LanguageContext';
import { SessionStatus } from '../../types/autoReply';
import { DryRunBadge } from './DryRunBadge';

interface SessionControlBarProps {
  status: SessionStatus;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  getStatusText: (status: SessionStatus) => string;
  isStarting?: boolean;
  dryRunMode?: boolean;
  onDisableDryRun?: () => void;
}

export const SessionControlBar: React.FC<SessionControlBarProps> = ({
  status,
  onStart,
  onPause,
  onResume,
  onStop,
  getStatusText,
  isStarting = false,
  dryRunMode = false,
  onDisableDryRun
}) => {
  const { language } = useLanguage();
  const lang = language === 'zh' ? 'zh' : 'en';

  const isActive = status !== 'stopped' && status !== 'idle';
  const isPaused = status === 'paused';

  return (
    <div className="flex items-center gap-2 p-3 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-color)]">
      <div className="flex items-center gap-1 flex-1">
        {!isActive ? (
          <button
            onClick={onStart}
            disabled={isStarting}
            className={`flex items-center gap-1 px-3 py-1.5 rounded text-xs font-medium bg-black text-white hover:bg-gray-800 transition-colors cursor-pointer ${isStarting ? 'opacity-70 cursor-wait' : ''}`}
          >
            {isStarting ? (
              <>
                <span className="loading loading-spinner loading-xs"></span>
                {lang === 'en' ? 'Starting...' : '启动中...'}
              </>
            ) : (
              <>
                <Play size={12} fill="currentColor" />
                {lang === 'en' ? 'Run Now' : '立即执行'}
              </>
            )}
          </button>
        ) : isPaused ? (
          <button
            onClick={onResume}
            className="flex items-center gap-1 px-3 py-1.5 rounded text-xs font-medium bg-black text-white hover:bg-gray-800 transition-colors cursor-pointer"
          >
            <Play size={12} fill="currentColor" />
            {lang === 'en' ? 'Resume' : '恢复'}
          </button>
        ) : (
          <button
            onClick={onPause}
            className="flex items-center gap-1 px-3 py-1.5 rounded text-xs font-medium bg-black text-white hover:bg-gray-800 transition-colors cursor-pointer"
          >
            <Pause size={12} fill="currentColor" />
            {lang === 'en' ? 'Pause' : '暂停'}
          </button>
        )}

        {isActive && (
          <button
            onClick={onStop}
            className="p-1.5 rounded hover:bg-[var(--hover-bg)] text-red-500 transition-colors cursor-pointer"
            title={lang === 'en' ? 'Stop' : '停止'}
          >
            <Square size={14} fill="currentColor" />
          </button>
        )}
      </div>

      {/* Dry Run Badge or Status on the right */}
      {dryRunMode && onDisableDryRun ? (
        <DryRunBadge onDisable={onDisableDryRun} />
      ) : (
        <div className="text-xs text-[var(--text-secondary)]">
          {getStatusText(status)}
        </div>
      )}
    </div>
  );
};
