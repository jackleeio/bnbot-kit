'use client';

import React from 'react';
import Image from 'next/image';
import { motion } from 'framer-motion';
import bnbotAI from '@/assets/images/logo/bnbot-ai.jpg';
import { TweetDraft } from '@/types/x-agent';

interface TweetDraftCardProps {
  draft: TweetDraft;
  index: number;
  onPreview: (draft: TweetDraft) => void;
}

const TweetDraftCard: React.FC<TweetDraftCardProps> = ({
  draft,
  index,
  onPreview,
}) => {
  const hashtags = (draft.hashtags || []).filter(Boolean);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.1 }}
      onClick={() => onPreview(draft)}
      className="group relative w-full max-w-[460px] cursor-pointer rounded-2xl border border-gray-200/80 bg-white/95 px-6 py-5 shadow-sm transition-all hover:border-[#f0b90b]/50 hover:shadow-md md:max-w-[420px]"
    >
      <div className="absolute right-4 top-4 pl-4 rounded-full bg-[#fff7e6] px-3 py-1 text-[11px] font-medium tracking-wide text-[#f0b90b] flex items-center gap-1">
        <span>Preview</span>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-3 w-3"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <line x1="5" y1="12" x2="19" y2="12" />
          <polyline points="12 5 19 12 12 19" />
        </svg>
      </div>

      <div className="flex items-start gap-3">
        <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-full border border-gray-200 bg-gray-50">
          <Image
            src={bnbotAI}
            alt="BNBot avatar"
            fill
            sizes="44px"
            className="object-cover"
            priority={false}
          />
        </div>
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-semibold text-gray-900">BNBOT</span>
            <span className="text-gray-500">@BNBOT_AI</span>
          </div>

          <div className="mt-3">
            <p className="whitespace-pre-wrap text-[15px] leading-[1.6] text-[#0f1419]">
              {draft.content}
            </p>
          </div>

          {hashtags.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {hashtags.slice(0, 4).map((tag, idx) => (
                <span
                  key={`${tag}-${idx}`}
                  className="text-sm font-normal text-[#1d9bf0]"
                >
                  {tag}
                </span>
              ))}
              {hashtags.length > 4 && (
                <span className="text-sm text-gray-500">
                  +{hashtags.length - 4}
                </span>
              )}
            </div>
          )}

        </div>
      </div>
    </motion.div>
  );
};

export default TweetDraftCard;
