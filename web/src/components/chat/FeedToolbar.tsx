'use client';

import React from 'react';
import { ArrowPathIcon } from '@heroicons/react/24/outline';
import { useTranslations } from 'next-intl';
import { ViewMode } from '@/types/chat';

interface FeedToolbarProps {
  isChatOpen: boolean;
  onToggleChat: () => void;
  onRefresh: () => void;
  isLoading: boolean;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  isVisible: boolean;
  isMobile: boolean;
  isPreviewMode?: boolean;
  onExitPreview?: () => void;
  feedType?: 'crypto' | 'ai';
  onFeedTypeChange?: (type: 'crypto' | 'ai') => void;
  onNewChat?: () => void;
}

const FeedToolbar: React.FC<FeedToolbarProps> = ({
  isChatOpen,
  onToggleChat,
  onRefresh,
  isLoading,
  viewMode,
  onViewModeChange,
  isVisible,
  isMobile,
  isPreviewMode = false,
  onExitPreview,
  feedType = 'crypto',
  onFeedTypeChange,
  onNewChat,
}) => {
  const t = useTranslations('feedToolbar');

  // Force toolbar to be visible in preview mode
  const shouldShow = isPreviewMode || isVisible;

  return (
    <div
      className={`absolute left-0 right-0 z-10 flex items-center ${
        isMobile ? 'justify-end' : 'justify-between'
      } rounded-b-2xl rounded-t-lg px-3 py-2 backdrop-blur-sm transition-transform duration-300 ease-in-out ${
        shouldShow ? 'top-0 translate-y-0' : '-top-16 -translate-y-full'
      }`}
    >
      {/* Chat toggle button - only on desktop */}
      {/* Left controls (desktop only) */}
      {!isMobile && (
        <div className="flex items-center gap-2">
          {/* New Chat button - desktop only */}
          {!isPreviewMode && onNewChat && (
            <button
              onClick={onNewChat}
              className="flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition-colors"
              title={t('newChat')}
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 20.25c4.97 0 9-3.694 9-8.25s-4.03-8.25-9-8.25S3 7.444 3 12c0 2.104.859 4.023 2.273 5.48.432.447.74 1.04.586 1.641a4.483 4.483 0 01-.923 1.785A5.969 5.969 0 006 21c1.282 0 2.47-.402 3.445-1.087.81.22 1.668.337 2.555.337z" />
              </svg>
            </button>
          )}

          {/* View Mode Toggle - desktop only, on left side */}
          {!isPreviewMode && (
            <div className="flex h-8 items-center rounded-full border border-gray-200 bg-white p-1">
              <button
                onClick={() => onViewModeChange('default')}
                className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-normal transition-all duration-200 ${
                  viewMode === 'default'
                    ? 'bg-[#f0b90b] text-white shadow-sm'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                }`}
                title={t('defaultView')}
              >
                {/* 1:2 layout icon - narrow left, wide right */}
                <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <rect x="1" y="2" width="4" height="12" rx="1" />
                  <rect x="6.5" y="2" width="8.5" height="12" rx="1" />
                </svg>
                <span>1:2</span>
              </button>
              <button
                onClick={() => onViewModeChange('equal')}
                className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-normal transition-all duration-200 ${
                  viewMode === 'equal'
                    ? 'bg-[#f0b90b] text-white shadow-sm'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                }`}
                title={t('equalView')}
              >
                {/* 1:1 layout icon - equal columns */}
                <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <rect x="1" y="2" width="6" height="12" rx="1" />
                  <rect x="9" y="2" width="6" height="12" rx="1" />
                </svg>
                <span>1:1</span>
              </button>
            </div>
          )}

          {isPreviewMode && (
            <div
              className="flex items-center mt-[2px] justify-center rounded-lg p-0.5 transition-transform duration-200 gap-2"
            >
              <span className="text-xs font-normal tracking-widest">
                {t('preview')}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Right side controls */}
      <div className="flex items-center gap-2">
        {isPreviewMode ? (
          <button
            className="ml-auto rounded-full p-1 text-gray-600 transition hover:bg-gray-100 hover:text-gray-900"
            onClick={onExitPreview}
            aria-label="Close Preview"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18 6L6 18" />
              <path d="M6 6l12 12" />
            </svg>
          </button>
        ) : (
          <>
            {/* Refresh button */}
            {!isMobile && (
              <button
                onClick={onRefresh}
                className="flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={isLoading}
                title={t('refresh')}
              >
                <ArrowPathIcon
                  className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`}
                />
              </button>
            )}

            {/* Feed Type Toggle - desktop, on right side */}
            {!isMobile && onFeedTypeChange && (
              <div className="flex h-8 items-center rounded-full border border-gray-200 bg-white p-1">
                <button
                  onClick={() => onFeedTypeChange('crypto')}
                  className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-normal transition-all duration-200 ${
                    feedType === 'crypto'
                      ? 'bg-[#f0b90b] text-white shadow-sm'
                      : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900'
                  }`}
                >
                  Crypto
                </button>
                <button
                  onClick={() => onFeedTypeChange('ai')}
                  className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-normal transition-all duration-200 ${
                    feedType === 'ai'
                      ? 'bg-[#f0b90b] text-white shadow-sm'
                      : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900'
                  }`}
                >
                  AI
                </button>
              </div>
            )}

            {/* Feed Type Toggle - Mobile only */}
            {isMobile && onFeedTypeChange && (
              <div className="flex h-8 items-center rounded-full border border-gray-200 bg-white p-1">
                <button
                  onClick={() => onFeedTypeChange('crypto')}
                  className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-normal transition-all duration-200 ${
                    feedType === 'crypto'
                      ? 'bg-[#f0b90b] text-white shadow-sm'
                      : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900'
                  }`}
                >
                  Crypto
                </button>
                <button
                  onClick={() => onFeedTypeChange('ai')}
                  className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-normal transition-all duration-200 ${
                    feedType === 'ai'
                      ? 'bg-[#f0b90b] text-white shadow-sm'
                      : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900'
                  }`}
                >
                  AI
                </button>
              </div>
            )}

          </>
        )}
      </div>
    </div>
  );
};

export default FeedToolbar;
