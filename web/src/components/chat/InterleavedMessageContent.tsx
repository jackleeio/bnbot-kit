
import React from 'react';
import MessageContent from './MessageContent';
import ToolCallBadges from './ToolCallBadges';
import { ToolCallInfo, ToolStatus } from '@/types/x-agent';
import ImagePreviewModal from '@/components/ui/image-preview-modal';

interface InterleavedMessageContentProps {
    content: string;
    toolCalls?: string[]; // Legacy
    toolCallsInfo?: ToolCallInfo[];
    isStreaming?: boolean;
    showToolBadges?: boolean;
}

const InterleavedMessageContent: React.FC<InterleavedMessageContentProps> = ({
    content,
    toolCalls,
    toolCallsInfo,
    isStreaming = false,
    showToolBadges = true,
}) => {
    const [previewImage, setPreviewImage] = React.useState<string | null>(null);

    // If no new toolCallsInfo structure, fallback to legacy
    if (!toolCallsInfo || toolCallsInfo.length === 0) {
        return (
            <>
                {content && <MessageContent content={content} isStreaming={isStreaming && !toolCalls} />}
                {showToolBadges && toolCalls && toolCalls.length > 0 && (
                    <div className="mt-2">
                        <ToolCallBadges toolCalls={toolCalls} isStreaming={isStreaming} />
                    </div>
                )}
            </>
        );
    }

    // Sort tools by index
    const sortedTools = [...toolCallsInfo].sort((a, b) => {
        // If index is undefined, treat as very large (end of message)
        const idxA = a.index ?? Number.MAX_SAFE_INTEGER;
        const idxB = b.index ?? Number.MAX_SAFE_INTEGER;
        return idxA - idxB;
    });

    const chunks: React.ReactNode[] = [];
    let lastIndex = 0;

    sortedTools.forEach((tool, i) => {
        const toolIndex = tool.index ?? content.length;

        // Safety check: index cannot be smaller than lastIndex
        const safeToolIndex = Math.max(lastIndex, Math.min(toolIndex, content.length));

        // Text chunk before tool
        if (safeToolIndex > lastIndex) {
            const textChunk = content.slice(lastIndex, safeToolIndex);
            if (textChunk) {
                chunks.push(
                    <div key={`text-${lastIndex}`} className="">
                        <MessageContent content={textChunk} />
                    </div>
                );
            }
        }

        // Tool rendering logic (Badges + Images)
        chunks.push(
            <div key={`tool-${i}`} className="my-3">
                {/* Tool Badge */}
                {showToolBadges && (
                    <div className="mb-2">
                        <ToolCallBadges toolCallsInfo={[tool]} isStreaming={isStreaming && tool.status === 'pending'} />
                    </div>
                )}

                {/* Generate Image Handling */}
                {tool.name === 'generate_image' && (
                    <>
                        {(!tool.output || tool.status === 'pending') && (
                            <div key={`generated-image-skeleton-${i}`} className="flex flex-wrap gap-2">
                                <div className="skeleton h-[300px] w-[300px] rounded-xl"></div>
                            </div>
                        )}

                        {tool.output && (
                            (function () {
                                try {
                                    const outputData = typeof tool.output === 'string' ? JSON.parse(tool.output) : tool.output;
                                    const finalData = typeof outputData === 'string' ? JSON.parse(outputData) : outputData;
                                    const images = finalData?.data || [];

                                    if (Array.isArray(images) && images.length > 0) {
                                        return (
                                            <div key={`generated-images-${i}`} className="flex flex-wrap gap-2">
                                                {images.map((img: any, imgIdx: number) => (
                                                    img.b64_json ? (
                                                        <div key={imgIdx} className="group relative overflow-hidden rounded-xl border border-gray-200 bg-gray-50 shadow-sm cursor-pointer" onClick={() => setPreviewImage(`data:image/png;base64,${img.b64_json}`)}>
                                                            <img
                                                                src={`data:image/png;base64,${img.b64_json}`}
                                                                alt={`Generated image ${imgIdx + 1}`}
                                                                className="h-auto max-h-[300px] w-auto max-w-full object-contain transition-transform duration-300 group-hover:scale-[1.02]"
                                                            />
                                                            {/* Overlay Button */}
                                                            <div className="absolute top-2 right-2 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                                                                <button
                                                                    className="flex h-8 w-8 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-sm transition-colors hover:bg-black/70"
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        // Future action: Regenerate or save
                                                                    }}
                                                                >
                                                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                                                                        <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z" />
                                                                    </svg>
                                                                </button>
                                                            </div>
                                                        </div>
                                                    ) : null
                                                ))}
                                            </div>
                                        );
                                    }
                                } catch (e) {
                                    console.error('Error parsing image:', e);
                                    return null;
                                }
                            })()
                        )}
                    </>
                )}
            </div>
        );

        lastIndex = safeToolIndex;
    });

    // Remaining content after last tool
    if (lastIndex < content.length) {
        chunks.push(
            <div key={`text-final`} className="">
                <MessageContent content={content.slice(lastIndex)} isStreaming={isStreaming} />
            </div>
        );
    }

    return (
        <>
            {chunks}
            {previewImage && (
                <ImagePreviewModal
                    isOpen={!!previewImage}
                    imageUrl={previewImage}
                    onClose={() => setPreviewImage(null)}
                />
            )}
        </>
    );
};

export default InterleavedMessageContent;
