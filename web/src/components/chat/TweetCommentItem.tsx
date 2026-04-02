'use client';

import React from 'react';
import { TweetComment } from '@/types';
import {
  ChatBubbleOvalLeftIcon,
  HeartIcon,
  EyeIcon,
} from '@heroicons/react/24/outline';

interface TweetCommentItemProps {
  comment: TweetComment;
  originalTweetAuthor?: string;
  tweetText?: string;
}

function formatNumber(num: number): string {
  if (num >= 1000000) {
    return `${(num / 1000000).toFixed(1)}M`;
  }
  if (num >= 1000) {
    return `${(num / 1000).toFixed(1)}K`;
  }
  return num.toString();
}

function formatDateTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 7) return `${diffDays}d`;

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatTextWithLinks(text: string, originalTweetAuthor?: string, tweetText?: string) {
  // 从推文文本中提取所有被 @ 的用户名
  let mentionedUsers = new Set<string>();

  // 添加原推文作者
  if (originalTweetAuthor) {
    mentionedUsers.add(originalTweetAuthor.toLowerCase());
  }

  // 从推文文本中提取所有 @mentions
  if (tweetText) {
    const mentions = tweetText.match(/@(\w+)/g);
    if (mentions) {
      mentions.forEach(mention => {
        // 移除 @ 符号并转换为小写
        const username = mention.slice(1).toLowerCase();
        mentionedUsers.add(username);
      });
    }
  }

  // 从评论文本开头移除所有被提到的用户的 @mentions
  let displayText = text;
  if (mentionedUsers.size > 0) {
    // 构建正则表达式，匹配开头的多个 @mentions
    const mentionPattern = new RegExp(
      `^(\\s*@(${Array.from(mentionedUsers).join('|')})\\s*)+`,
      'i'
    );
    displayText = text.replace(mentionPattern, '').trim();
  }

  const parts = displayText.split(
    /((?:https?:\/\/[^\s]+)|(?:@\w+)|(?:#\w+)|(?:\$\w+)(?!\w))/,
  );

  return (
    <p className="font-twitter-chirp mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-gray-900">
      {parts.map((part, index) => {
        if (!part) return null;

        // Handle links - display as text, not clickable
        if (part.match(/^https?:\/\//)) {
          return (
            <span key={index} className="text-blue-500">
              {part}
            </span>
          );
        }
        // Handle @mentions, #hashtags, $cashtags - display as text, not clickable
        else if (part.match(/^[@#$]\w+/)) {
          return (
            <span key={index} className="text-blue-500">
              {part}
            </span>
          );
        }
        // Normal text
        return <span key={index}>{part}</span>;
      })}
    </p>
  );
}

export default function TweetCommentItem({ comment, originalTweetAuthor, tweetText }: TweetCommentItemProps) {
  return (
    <div
      className="border-b border-gray-200 px-4 py-2 transition-colors"
    >
      <div className="flex gap-3">
        {/* Avatar */}
        <div className="flex-shrink-0">
          <img
            src={comment.user.avatar_url || comment.user.profile_image_url}
            alt={comment.user.name}
            className="h-9 w-9 rounded-full mt-0.5"
            loading="lazy"
          />
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1">
          {/* User name and verified badge */}
          <div className="flex items-center gap-1">
            <span className="font-twitter-chirp font-medium text-[15px] text-gray-900">
              {comment.user.name}
            </span>
            {comment.user.is_blue_verified && (
              <svg
                viewBox="0 0 22 22"
                aria-label="认证账号"
                role="img"
                className="h-[16px] w-[16px]"
              >
                <g>
                  <path
                    d="M20.396 11c-.018-.646-.215-1.275-.57-1.816-.354-.54-.852-.972-1.438-1.246.223-.607.27-1.264.14-1.897-.131-.634-.437-1.218-.882-1.687-.47-.445-1.053-.75-1.687-.882-.633-.13-1.29-.083-1.897.14-.273-.587-.704-1.086-1.245-1.44S11.647 1.62 11 1.604c-.646.017-1.273.213-1.813.568s-.969.854-1.24 1.44c-.608-.223-1.267-.272-1.902-.14-.635.13-1.22.436-1.69.882-.445.47-.749 1.055-.878 1.688-.13.633-.08 1.29.144 1.896-.587.274-1.087.705-1.443 1.245-.356.54-.555 1.17-.574 1.817.02.647.218 1.276.574 1.817.356.54.856.972 1.443 1.245-.224.606-.274 1.263-.144 1.896.13.634.433 1.218.877 1.688.47.443 1.054.747 1.687.878.633.132 1.29.084 1.897-.136.274.586.705 1.084 1.246 1.439.54.354 1.17.551 1.816.569.647-.016 1.276-.213 1.817-.567s.972-.854 1.245-1.44c.604.239 1.266.296 1.903.164.636-.132 1.22-.447 1.68-.907.46-.46.776-1.044.908-1.681s.075-1.299-.165-1.903c.586-.274 1.084-.705 1.439-1.246.354-.54.551-1.17.569-1.816zM9.662 14.85l-3.429-3.428 1.293-1.302 2.072 2.072 4.4-4.794 1.347 1.246z"
                    fill="currentColor"
                    className="text-blue-500"
                  />
                </g>
              </svg>
            )}
          </div>

          {/* Username and time */}
          <div className="font-twitter-chirp flex items-center -mt-1 gap-1 text-[13px] text-gray-500">
            <span>@{comment.user.username}</span>
            <span>·</span>
            <span>{formatDateTime(comment.created_at)}</span>
          </div>

          {/* Comment text */}
          {formatTextWithLinks(comment.text, originalTweetAuthor, tweetText)}

          {/* Action buttons and view count */}
          <div className="mt-1 flex items-center justify-between">
            {/* Left: Action buttons */}
            <div className="flex items-center gap-4 text-gray-500">
              <button className="group flex items-center gap-1 rounded-full p-1 transition-colors hover:bg-blue-50">
                <ChatBubbleOvalLeftIcon className="h-3.5 w-3.5 transition-colors group-hover:text-blue-500" />
                <span className="text-[11px] transition-colors group-hover:text-blue-500">
                  {comment.reply_count > 0 ? formatNumber(comment.reply_count) : ''}
                </span>
              </button>
              <button className="group flex items-center gap-1 rounded-full p-1 transition-colors hover:bg-pink-50">
                <HeartIcon className="h-3.5 w-3.5 transition-colors group-hover:text-pink-500" />
                <span className="text-[11px] transition-colors group-hover:text-pink-500">
                  {comment.like_count > 0 ? formatNumber(comment.like_count) : ''}
                </span>
              </button>
            </div>

            {/* Right: View count */}
            {comment.view_count > 0 && (
              <div className="flex items-center gap-1 text-gray-400">
                <EyeIcon className="h-3.5 w-3.5" />
                <span className="text-[11px]">{formatNumber(comment.view_count)}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
