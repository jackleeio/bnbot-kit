'use client';

import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowRightCircleIcon } from '@heroicons/react/24/outline';

interface ReasoningSectionProps {
  reasoning: string;
  isStreaming?: boolean;
  messageId?: string;
  expanded?: boolean;
  onToggle?: (messageId: string) => void;
  onTweetReferenceSelect?: (tweetIds: string[]) => void;
  isTweetReferenceLoading?: (idsKey: string) => boolean;
}

const ReasoningSection: React.FC<ReasoningSectionProps> = ({
  reasoning,
  isStreaming = false,
  messageId = '',
  expanded,
  onToggle,
  onTweetReferenceSelect,
  isTweetReferenceLoading,
}) => {
  const [internalExpanded, setInternalExpanded] = useState(false);
  const reasoningRef = useRef<HTMLDivElement>(null);

  const isExpanded =
    typeof expanded === 'boolean' ? expanded : internalExpanded;

  const handleToggle = () => {
    if (onToggle) {
      onToggle(messageId);
      return;
    }
    setInternalExpanded((prev) => !prev);
  };

  // Auto-scroll reasoning content when streaming
  useEffect(() => {
    if (isStreaming && reasoning && reasoningRef.current) {
      const reasoningElement = reasoningRef.current;
      // Smooth scroll to bottom of reasoning content
      reasoningElement.scrollTo({
        top: reasoningElement.scrollHeight,
        behavior: 'smooth',
      });
    }
  }, [reasoning, isStreaming]);

  const formatReasoningContent = (content: string) => {
    if (!content) return null;

    // Handle multiple markdown patterns: **bold**, *italic*, `code`, and [tweet_id: ...]
    // We split by newlines first to handle paragraph structure better if needed, 
    // but here we stick to the existing logic and extend it.
    // The regex needs to capture all tokens we want to process.
    // Replace literal \n with actual newlines to ensure proper rendering
    const normalizedContent = content.replace(/\\n/g, '\n');
    const parts = normalizedContent.trimEnd().split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[\s*(?:tweet_id\s*[:：]\s*)?[\d,\s，]+\])/g);

    return parts.map((part, index) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return (
          <strong key={index} className="font-bold text-gray-800">
            {part.slice(2, -2)}
          </strong>
        );
      } else if (
        part.startsWith('*') &&
        part.endsWith('*') &&
        !part.startsWith('**')
      ) {
        return (
          <em key={index} className="font-medium italic text-gray-600">
            {part.slice(1, -1)}
          </em>
        );
      } else if (part.startsWith('`') && part.endsWith('`')) {
        const codeContent = part.slice(1, -1);
        // Allow colons in tool names (e.g. default_api:get)
        const isToolName =
          codeContent.includes('_') && /^[a-z_:]+$/.test(codeContent);

        if (isToolName) {
          // Strip default_api: prefix if present
          const nameToFormat = codeContent.replace(/^default_api:/, '');
          const formattedName = nameToFormat
            .split('_')
            .map((word) => {
              if (word.toLowerCase() === 'kol') return 'KOL';
              return word.charAt(0).toUpperCase() + word.slice(1);
            })
            .join(' ');

          return (
            <span
              key={index}
              className="inline-block rounded-md bg-[#f0b90b]/10 px-1.5 py-0.5 text-xs text-[#b48b08]"
            >
              {formattedName}
            </span>
          );
        } else {
          return (
            <code
              key={index}
              className="rounded-md bg-[#f0b90b]/10 px-2 py-0.5 font-mono text-xs text-[#b48b08]"
            >
              {codeContent}
            </code>
          );
        }
      } else if (/^\[\s*(?:tweet_id\s*[:：]\s*)?[\d,\s，]+\]$/.test(part)) {
        // Handle tweet reference
        let parsedIds: string[] = [];
        try {
          const normalized = part
            .replace(/tweet_id\s*[:：]/gi, '')
            .replace(/'/g, '"');
          // Try parsing as JSON array if it looks like one, otherwise regex
          if (normalized.startsWith('[') && normalized.endsWith(']')) {
            // It's already wrapped in brackets, but might not be valid JSON if it's just numbers
            // Let's just extract digits
            const matches = normalized.match(/\d+/g);
            if (matches) parsedIds = matches;
          }
        } catch {
          // ignore
        }

        if (parsedIds.length === 0) {
          const matches = part.match(/\d+/g);
          if (matches) parsedIds = matches;
        }

        if (parsedIds.length > 0) {
          const groupKey = parsedIds.join(',');
          const referenceLoading =
            typeof isTweetReferenceLoading === 'function'
              ? isTweetReferenceLoading(groupKey)
              : false;

          return (
            <span key={index} className="inline-flex items-center gap-1 align-middle">
              <span className="text-gray-500">{part}</span>
              {onTweetReferenceSelect && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onTweetReferenceSelect(parsedIds);
                  }}
                  disabled={referenceLoading}
                  className={`inline-flex h-4 w-4 items-center justify-center rounded-full border border-transparent bg-gray-200/60 text-gray-600 transition ${referenceLoading
                    ? 'cursor-not-allowed opacity-60'
                    : 'hover:bg-gray-300'
                    }`}
                  title="View Tweet"
                >
                  {referenceLoading ? (
                    <span className="h-2.5 w-2.5 animate-spin rounded-full border-2 border-gray-500 border-t-transparent" />
                  ) : (
                    <ArrowRightCircleIcon className="h-3 w-3" />
                  )}
                </button>
              )}
            </span>
          );
        }
        return <span key={index}>{part}</span>;
      } else {
        return part.split('\n').map((line, lineIndex) => (
          <span key={`${index}-${lineIndex}`}>
            {line}
            {lineIndex < part.split('\n').length - 1 && <br />}
          </span>
        ));
      }
    });
  };

  if (!reasoning) return null;

  const extractCurrentStep = (content: string) => {
    if (!content) return null;
    // Match bold text (**text**) or markdown headers (### text)
    const matches = Array.from(content.matchAll(/(?:\*\*([^*]+)\*\*|^#{1,6}\s+(.+)$)/gm));
    if (matches.length > 0) {
      const lastMatch = matches[matches.length - 1];
      // group 1 is bold, group 2 is header
      return lastMatch[1] || lastMatch[2];
    }
    return null;
  };

  const currentStep = extractCurrentStep(reasoning);

  const showStep = isStreaming && currentStep;

  return (
    <div className="mb-3">
      <button
        onClick={handleToggle}
        className="mb-2 flex w-fit items-center justify-between space-x-1.5 rounded-md bg-gradient-to-r from-[#f0b90b]/10 to-orange-50 px-2 py-1 text-[11px] font-medium text-gray-700 transition-all duration-300 hover:from-[#f0b90b]/20 hover:to-orange-100"
      >
        <div className="flex items-center overflow-hidden">
          {isStreaming ? (
            <>
              <span className="loading loading-dots loading-xs mr-2 text-[#f0b90b]"></span>
              {currentStep ? (
                <div className="flex items-center overflow-hidden">
                  <span className="truncate font-medium text-gray-700">
                    {currentStep}...
                  </span>
                </div>
              ) : (
                <span className="flex-shrink-0 font-medium text-gray-700">BNBOT is thinking...</span>
              )}
            </>
          ) : (
            <span className="flex-shrink-0 font-medium text-gray-700">Thought Process</span>
          )}
        </div>
        <div className="flex flex-shrink-0 items-center ml-1">
          <svg
            className={`h-2.5 w-2.5 text-gray-500 transition-transform duration-300 ${isExpanded ? 'rotate-90' : ''
              }`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </div>
      </button>
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{
              opacity: 1,
              height: 'auto',
            }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="rounded-xl border border-[#f0b90b]/20 bg-gradient-to-br from-white to-[#f0b90b]/5 p-4 shadow-sm">
              <div
                ref={reasoningRef}
                className="custom-scrollbar max-h-64 overflow-y-auto text-xs leading-relaxed text-gray-700"
              >
                {formatReasoningContent(reasoning)}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default ReasoningSection;
