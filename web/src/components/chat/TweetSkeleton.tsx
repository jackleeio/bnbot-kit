import React from 'react';

interface TweetSkeletonProps {
  isMobile?: boolean;
}

export default function TweetSkeleton({ isMobile = false }: TweetSkeletonProps) {
  return (
    <div
      suppressHydrationWarning
      className={`flex flex-col overflow-hidden rounded-2xl border border-gray-100 bg-white p-4 ${
        isMobile ? '' : 'hover:bg-gray-50'
      }`}
    >
      {/* Header: Avatar and Name */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          {/* Avatar Skeleton */}
          <div className="h-9 w-9 animate-pulse rounded-full bg-gray-200" />
          
          <div className="flex flex-col gap-1">
            {/* Name Skeleton */}
            <div className="h-4 w-24 animate-pulse rounded bg-gray-200" />
            {/* Handle Skeleton */}
            <div className="h-3 w-16 animate-pulse rounded bg-gray-200" />
          </div>
        </div>
        
        {/* Time Skeleton */}
        <div className="h-3 w-12 animate-pulse rounded bg-gray-200" />
      </div>

      {/* Content Skeleton */}
      <div className="mt-3 space-y-2">
        <div className="h-4 w-full animate-pulse rounded bg-gray-200" />
        <div className="h-4 w-5/6 animate-pulse rounded bg-gray-200" />
        <div className="h-4 w-4/6 animate-pulse rounded bg-gray-200" />
      </div>

      {/* Footer: Action Icons Skeleton */}
      <div className="mt-4 flex items-center justify-between px-2">
        <div className="h-4 w-8 animate-pulse rounded bg-gray-200" />
        <div className="h-4 w-8 animate-pulse rounded bg-gray-200" />
        <div className="h-4 w-8 animate-pulse rounded bg-gray-200" />
        <div className="h-4 w-8 animate-pulse rounded bg-gray-200" />
      </div>
    </div>
  );
}
