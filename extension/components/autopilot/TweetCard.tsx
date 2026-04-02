import React from 'react';
import { useLanguage } from '../LanguageContext';
import { ScrapedTweet, TweetEvaluation } from '../../types/autoReply';

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

interface TweetCardProps {
  tweet: ScrapedTweet;
  evaluation?: TweetEvaluation;
}

export const TweetCard: React.FC<TweetCardProps> = ({ tweet, evaluation }) => {
  const { language } = useLanguage();
  const lang = language === 'zh' ? 'zh' : 'en';

  return (
    <div className="p-4 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-color)]">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-[var(--text-primary)]">
            {lang === 'en' ? 'Current Tweet' : '当前推文'}
          </span>
        </div>
        {tweet.expectedExposure && tweet.expectedExposure > 0 && (
          <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400">
            {lang === 'en' ? 'Exposure' : '曝光'}: {formatMetric(tweet.expectedExposure)}
          </span>
        )}
      </div>

      <div className="flex gap-3">
        <div className="flex-shrink-0">
          {tweet.authorAvatar ? (
            <img
              src={tweet.authorAvatar}
              alt={tweet.authorName}
              className="w-10 h-10 rounded-full border border-[var(--border-color)] object-cover"
            />
          ) : (
            <div className="w-10 h-10 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center">
              <span className="text-xs text-gray-500">?</span>
            </div>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between min-w-0 mb-0.5">
            <div className="flex items-center gap-1 min-w-0 leading-5">
              <span className="font-bold text-[var(--text-primary)] text-sm truncate">
                {tweet.authorName}
              </span>
              {tweet.isVerified && (
                <svg viewBox="0 0 24 24" aria-label="Verified account" className="w-4 h-4 text-blue-500 fill-current flex-shrink-0">
                  <g><path d="M22.25 12c0-1.43-.88-2.67-2.19-3.34.46-1.39.2-2.9-.81-3.91s-2.52-1.27-3.91-.81c-.66-1.31-1.91-2.19-3.34-2.19s-2.67.88-3.34 2.19c-1.39-.46-2.9-.2-3.91.81s-1.27 2.52-.81 3.91C2.63 9.33 1.75 10.57 1.75 12s.88 2.67 2.19 3.34c-.46 1.39-.2 2.9.81 3.91s2.52 1.27 3.91.81c.66 1.31 1.91 2.19 3.34 2.19s2.67-.88 3.34-2.19c1.39.46 2.9.2 3.91-.81s1.27-2.52.81-3.91c1.31-.67 2.19-1.91 2.19-3.34zm-11.71 4.2L6.8 12.46l1.41-1.42 2.26 2.26 4.8-5.23 1.47 1.36-6.2 6.77z"></path></g>
                </svg>
              )}
              <span className="text-[var(--text-secondary)] text-sm truncate">
                @{tweet.authorHandle}
              </span>
            </div>
          </div>

          <div className="text-[var(--text-primary)] text-sm leading-relaxed whitespace-pre-wrap mt-0.5">
            {tweet.content.length > 200
              ? tweet.content.substring(0, 200) + '...'
              : tweet.content}
          </div>

          {/* Tweet Metrics - Twitter style icons */}
          <div className="flex items-center justify-between mt-3 px-1 text-xs text-[var(--text-tertiary)] select-none">
            <div className="flex items-center gap-1.5" title="Replies">
              <svg viewBox="0 0 24 24" aria-hidden="true" className="w-4 h-4 fill-current">
                <g><path d="M1.751 10c0-4.42 3.584-8 8.005-8h4.366c4.49 0 8.129 3.64 8.129 8.13 0 2.96-1.607 5.68-4.196 7.11l-8.054 4.46v-3.69h-.067c-4.49.1-8.183-3.51-8.183-8.01zm8.005-6c-3.317 0-6.005 2.69-6.005 6 0 3.37 2.77 6.08 6.138 6.01l.351-.01h1.761v2.3l5.087-2.81c1.951-1.08 3.163-3.13 3.163-5.36 0-3.39-2.744-6.13-6.129-6.13H9.756z"></path></g>
              </svg>
              <span>{formatMetric(tweet.metrics.replies)}</span>
            </div>
            <div className="flex items-center gap-1.5" title="Retweets">
              <svg viewBox="0 0 24 24" aria-hidden="true" className="w-4 h-4 fill-current">
                <g><path d="M4.5 3.88l4.432 4.14-1.364 1.46L5.5 7.55V16c0 1.1.896 2 2 2H13v2H7.5c-2.209 0-4-1.79-4-4V7.55L1.432 9.48.068 8.02 4.5 3.88zM16.5 6H11V4h5.5c2.209 0 4 1.79 4 4v8.45l2.068-1.93 1.364 1.46-4.432 4.14-4.432-4.14 1.364-1.46 2.068 1.93V8c0-1.1-.896-2-2-2z"></path></g>
              </svg>
              <span>{formatMetric(tweet.metrics.retweets)}</span>
            </div>
            <div className="flex items-center gap-1.5" title="Likes">
              <svg viewBox="0 0 24 24" aria-hidden="true" className="w-4 h-4 fill-current">
                <g><path d="M16.697 5.5c-1.222-.06-2.679.51-3.89 2.16l-.805 1.09-.806-1.09C9.984 6.01 8.526 5.44 7.304 5.5c-1.243.07-2.349.78-2.91 1.91-.552 1.12-.633 2.78.479 4.82 1.074 1.97 3.257 4.27 7.129 6.61 3.87-2.34 6.052-4.64 7.126-6.61 1.111-2.04 1.03-3.7.477-4.82-.561-1.13-1.666-1.84-2.908-1.91zm4.187 7.69c-1.351 2.48-4.001 5.12-8.379 7.67l-.503.3-.504-.3c-4.379-2.55-7.029-5.19-8.382-7.67-1.36-2.5-1.41-4.86-.514-6.67.887-1.79 2.647-2.91 4.601-3.01 1.651-.09 3.368.56 4.798 2.01 1.429-1.45 3.146-2.1 4.796-2.01 1.954.1 3.714 1.22 4.601 3.01.896 1.81.846 4.17-.514 6.67z"></path></g>
              </svg>
              <span>{formatMetric(tweet.metrics.likes)}</span>
            </div>
            <div className="flex items-center gap-1.5" title="Views">
              <svg viewBox="0 0 24 24" aria-hidden="true" className="w-4 h-4 fill-current">
                <g><path d="M8.75 21V3h2v18h-2zM18 21V8.5h2V21h-2zM4 21l.004-10h2L6 21H4zm9.248 0v-7h2v7h-2z"></path></g>
              </svg>
              <span>{formatMetric(tweet.metrics.views)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
