import React from 'react';
import { AlertCircle, X } from 'lucide-react';
import { useLanguage } from '../LanguageContext';

interface DryRunBadgeProps {
  onDisable: () => void;
  tooltip?: string;
}

export const DryRunBadge: React.FC<DryRunBadgeProps> = ({ onDisable, tooltip }) => {
  const { language } = useLanguage();
  const lang = language === 'zh' ? 'zh' : 'en';

  const defaultTooltip = lang === 'en'
    ? 'Dry Run mode is enabled. Replies will be generated but not posted.'
    : '测试模式已开启。将生成回复但不会发布。';

  return (
    <div className="flex items-center gap-2 pl-3 pr-2 py-1 bg-amber-500/10 text-amber-600 dark:text-amber-500 rounded-full text-xs font-medium border border-amber-500/20">
      <div
        className="tooltip tooltip-top flex items-center gap-1.5 cursor-help"
        data-tip={tooltip || defaultTooltip}
      >
        <AlertCircle size={13} strokeWidth={2.5} />
        <span>Dry Run</span>
      </div>
      <button
        onClick={onDisable}
        className="p-0.5 hover:bg-amber-500/20 rounded-full transition-colors opacity-70 hover:opacity-100 cursor-pointer"
        title={lang === 'en' ? 'Disable Dry Run' : '关闭测试模式'}
      >
        <X size={13} strokeWidth={2.5} />
      </button>
    </div>
  );
};
