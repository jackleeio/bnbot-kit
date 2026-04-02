'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { XMarkIcon, ClipboardDocumentIcon, CheckIcon, PhotoIcon } from '@heroicons/react/24/outline';
import { TweetDraft } from '@/types/x-agent';
import Image from 'next/image';
import bnbotAI from '@/assets/images/logo/bnbot-ai.jpg';

interface TweetDraftPreviewProps {
  draft: TweetDraft | null;
  onClose: () => void;
}

const TweetDraftPreview: React.FC<TweetDraftPreviewProps> = ({ draft, onClose }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (!draft) return;

    const textToCopy = `${draft.content}\n\n${draft.hashtags.join(' ')}`;
    navigator.clipboard.writeText(textToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!draft) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 20 }}
        transition={{ duration: 0.3 }}
        className="flex h-full flex-col border-l border-gray-200 bg-white"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <h3 className="text-sm font-semibold text-gray-900">推文预览</h3>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
            aria-label="关闭预览"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {/* Mock Tweet Card */}
          <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
            <div className="p-4">
              {/* User info */}
              <div className="mb-3 flex items-start gap-3">
                <Image
                  src={bnbotAI}
                  alt="BNBOT avatar"
                  width={40}
                  height={40}
                  className="rounded-full"
                />
                <div className="flex-1">
                  <div className="flex items-center gap-1">
                    <span className="font-semibold text-gray-900">BNBOT</span>
                    <span className="text-gray-500">@bnbot_ai</span>
                  </div>
                  <p className="text-sm text-gray-500">刚刚</p>
                </div>
              </div>

              {/* Tweet content */}
              <div className="mb-3">
                <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-gray-900">
                  {draft.content}
                </p>
              </div>

              {/* Hashtags */}
              {draft.hashtags && draft.hashtags.length > 0 && (
                <div className="mb-3 flex flex-wrap gap-1.5">
                  {draft.hashtags.map((tag, idx) => (
                    <span key={idx} className="text-[15px] text-blue-500">
                      {tag}
                    </span>
                  ))}
                </div>
              )}

              {/* Image suggestion placeholder */}
              {draft.image_suggestion?.has_suggestion && (
                <div className="mb-3 flex items-center justify-center rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 py-8">
                  <div className="text-center">
                    <PhotoIcon className="mx-auto h-10 w-10 text-gray-400" />
                    <p className="mt-2 text-xs text-gray-500">
                      {draft.image_suggestion.description || '建议添加图片'}
                    </p>
                    {draft.image_suggestion.type && (
                      <p className="mt-1 text-xs font-medium text-gray-600">
                        类型：{draft.image_suggestion.type}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Mock engagement stats */}
              <div className="flex items-center gap-6 border-t border-gray-100 pt-3 text-sm text-gray-500">
                <div className="flex items-center gap-1">
                  <span>💬</span>
                  <span>0</span>
                </div>
                <div className="flex items-center gap-1">
                  <span>🔄</span>
                  <span>0</span>
                </div>
                <div className="flex items-center gap-1">
                  <span>❤️</span>
                  <span>0</span>
                </div>
                <div className="flex items-center gap-1">
                  <span>👁️</span>
                  <span>0</span>
                </div>
              </div>
            </div>
          </div>

          {/* Style info */}
          <div className="mt-4 rounded-lg border border-gray-200 bg-gradient-to-br from-gray-50 to-white p-3">
            <div className="mb-2 flex items-center gap-2">
              <span className="text-xs font-medium text-gray-700">风格</span>
              <span className="rounded-full bg-gradient-to-r from-[#f0b90b]/10 to-[#f0b90b]/5 px-2.5 py-0.5 text-xs font-medium text-[#f0b90b]">
                {draft.style}
              </span>
            </div>
          </div>

          {/* Reasoning */}
          <div className="mt-4 rounded-lg border border-gray-200 bg-gradient-to-br from-blue-50/50 to-white p-3">
            <h4 className="mb-2 text-xs font-semibold text-gray-700">策略说明</h4>
            <p className="whitespace-pre-wrap text-xs leading-relaxed text-gray-600">
              {draft.reasoning}
            </p>
          </div>
        </div>

        {/* Footer actions */}
        <div className="border-t border-gray-200 p-4">
          <button
            onClick={handleCopy}
            className={`flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 font-medium transition-all ${
              copied
                ? 'bg-green-50 text-green-600'
                : 'bg-gradient-to-r from-[#f0b90b] to-[#e6a800] text-white hover:shadow-md'
            }`}
          >
            {copied ? (
              <>
                <CheckIcon className="h-5 w-5" />
                <span>已复制</span>
              </>
            ) : (
              <>
                <ClipboardDocumentIcon className="h-5 w-5" />
                <span>复制推文</span>
              </>
            )}
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};

export default TweetDraftPreview;
