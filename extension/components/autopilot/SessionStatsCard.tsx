import React from 'react';
import { useLanguage } from '../LanguageContext';

interface SessionStatsCardProps {
  tweetsScanned: number;
  repliesPosted: number;
  repliesSkipped: number;
}

export const SessionStatsCard: React.FC<SessionStatsCardProps> = ({
  tweetsScanned,
  repliesPosted,
  repliesSkipped
}) => {
  const { language } = useLanguage();
  const lang = language === 'zh' ? 'zh' : 'en';

  return (
    <div className="rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-color)] overflow-hidden">
      <div className="grid grid-cols-3 divide-x divide-[var(--border-color)]">
        <div className="p-3 text-center">
          <div className="text-lg font-semibold text-[var(--text-primary)]">
            {tweetsScanned}
          </div>
          <div className="text-xs text-[var(--text-secondary)]">
            {lang === 'en' ? 'Scanned' : '已扫描'}
          </div>
        </div>
        <div className="p-3 text-center">
          <div className="text-lg font-semibold text-green-500">
            {repliesPosted}
          </div>
          <div className="text-xs text-[var(--text-secondary)]">
            {lang === 'en' ? 'Replied' : '已回复'}
          </div>
        </div>
        <div className="p-3 text-center">
          <div className="text-lg font-semibold text-gray-500">
            {repliesSkipped}
          </div>
          <div className="text-xs text-[var(--text-secondary)]">
            {lang === 'en' ? 'Skipped' : '已跳过'}
          </div>
        </div>
      </div>
    </div>
  );
};
