import React from 'react';
import { Moon, Sun } from 'lucide-react';
import TextSwitch from './TextSwitch';
import { useLanguage } from './LanguageContext';
import { useTheme } from './ThemeContext';

interface ThemeToggleProps {
  displayMode?: 'icon' | 'list';
}

export function ThemeToggle({ displayMode = 'icon' }: ThemeToggleProps) {
  const { theme, toggleTheme } = useTheme();
  const { t, language } = useLanguage();

  if (displayMode === 'list') {
    return (
      <div className="flex items-center justify-between p-2 rounded-lg hover:bg-[var(--hover-bg)] transition-colors w-full cursor-pointer group" onClick={toggleTheme}>
        <span className="text-[var(--text-primary)] text-[13px] font-medium pl-1">
          {language === 'zh' ? '深色模式' : 'Dark Theme'}
        </span>

        {/* Standard Switch UI */}
        <div className={`w-9 h-5 rounded-full relative transition-colors duration-200 ease-in-out ${theme === 'dark' ? 'bg-green-500' : 'bg-gray-200 dark:bg-gray-700'}`}>
          <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform duration-200 ease-in-out shadow-sm ${theme === 'dark' ? 'translate-x-4' : 'translate-x-0'}`} />
        </div>
      </div>
    );
  }

  return (
    <button
      onClick={toggleTheme}
      className="group w-9 h-9 flex items-center justify-center rounded-xl hover:bg-[var(--hover-bg)] transition-colors text-[var(--text-secondary)] cursor-pointer relative"
    >
      <span
        className="absolute right-full mr-2 px-3 py-1.5 bg-white text-gray-900 text-xs font-medium rounded-lg border border-gray-200 opacity-0 group-hover:opacity-100 transition-all duration-150 whitespace-nowrap pointer-events-none z-50 group-hover:translate-x-0 translate-x-1"
        style={{ boxShadow: '0 4px 12px rgba(0, 0, 0, 0.05), 0 2px 4px rgba(0, 0, 0, 0.03)' }}
      >
        {`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
      </span>
      {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
    </button>
  );
}
