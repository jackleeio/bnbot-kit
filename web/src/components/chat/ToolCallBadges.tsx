import React from 'react';
import { formatToolName } from '@/utils/chatFormatters';
import { ToolCallInfo, ToolStatus } from '@/types/x-agent';

interface ToolCallBadgesProps {
  toolCalls?: string[];
  toolCallsInfo?: ToolCallInfo[];
  isStreaming?: boolean;
}

const ToolCallBadges: React.FC<ToolCallBadgesProps> = ({
  toolCalls,
  toolCallsInfo,
  isStreaming = false,
}) => {
  // Use toolCallsInfo if available, otherwise fall back to legacy toolCalls
  const hasTools = (toolCallsInfo && toolCallsInfo.length > 0) || (toolCalls && toolCalls.length > 0);

  if (!hasTools) return null;

  const renderToolIcon = (status?: ToolStatus) => {
    if (status === 'success') {
      // Green checkmark for success
      return (
        <div className="mr-0.5 flex h-2 w-2 items-center justify-center rounded-full bg-green-500/20">
          <svg
            className="h-1.5 w-1.5 text-green-600"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={3}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M5 13l4 4L19 7"
            />
          </svg>
        </div>
      );
    } else if (status === 'error') {
      // Red X for error
      return (
        <div className="mr-0.5 flex h-2 w-2 items-center justify-center rounded-full bg-red-500/20">
          <svg
            className="h-1.5 w-1.5 text-red-600"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={3}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </div>
      );
    } else {
      // Spinning icon for pending
      return (
        <div className="mr-0.5 flex h-2 w-2 items-center justify-center rounded-full bg-[#f0b90b]/20">
          <svg
            className="h-1 w-1 text-[#f0b90b] animate-spin"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fillRule="evenodd"
              d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z"
              clipRule="evenodd"
            />
          </svg>
        </div>
      );
    }
  };

  const getToolColor = (status?: ToolStatus) => {
    if (status === 'success') return 'border-green-500/20 bg-gradient-to-r from-green-500/15 to-green-100/20';
    if (status === 'error') return 'border-red-500/20 bg-gradient-to-r from-red-500/15 to-red-100/20';
    return 'border-[#f0b90b]/20 bg-gradient-to-r from-[#f0b90b]/15 to-orange-100/20';
  };

  const getTextColor = (status?: ToolStatus) => {
    if (status === 'success') return 'text-green-600';
    if (status === 'error') return 'text-red-600';
    return 'text-[#f0b90b]';
  };

  const getToolLabel = (toolInfo: ToolCallInfo) => {
    const summary =
      typeof toolInfo.inputSummary === 'string' ? toolInfo.inputSummary.trim() : '';
    if (summary) {
      return `${formatToolName(toolInfo.name)}(${summary})`;
    }
    return formatToolName(toolInfo.name);
  };

  return (
    <div className="mb-2 flex flex-wrap gap-1">
      {toolCallsInfo ? (
        // Render with status information
        toolCallsInfo.map((toolInfo, toolIndex) => (
          <div
            key={toolIndex}
            className={`inline-flex items-center rounded-full border ${getToolColor(toolInfo.status)} px-1.5 py-px shadow-sm backdrop-blur-sm transition-all duration-300`}
          >
            {renderToolIcon(toolInfo.status)}
            <span className={`font-inter text-[9px] font-medium tracking-[-0.008em] ${getTextColor(toolInfo.status)} antialiased`}>
              {getToolLabel(toolInfo)}
            </span>
          </div>
        ))
      ) : (
        // Legacy rendering without status
        toolCalls?.map((tool, toolIndex) => (
          <div
            key={toolIndex}
            className={`inline-flex items-center rounded-full border border-[#f0b90b]/20 bg-gradient-to-r from-[#f0b90b]/15 to-orange-100/20 px-1.5 py-px shadow-sm backdrop-blur-sm ${
              isStreaming ? 'animate-pulse' : ''
            }`}
          >
            <div className="mr-0.5 flex h-2 w-2 items-center justify-center rounded-full bg-[#f0b90b]/20">
              <svg
                className={`h-1 w-1 text-[#f0b90b] ${isStreaming ? 'animate-spin' : ''}`}
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
            <span className="font-inter text-[9px] font-medium tracking-[-0.008em] text-[#f0b90b] antialiased">
              {formatToolName(tool)}
            </span>
          </div>
        ))
      )}
    </div>
  );
};

export default ToolCallBadges;
