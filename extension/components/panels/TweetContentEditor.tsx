import React, { useState, useEffect, useRef } from 'react';
import { AutoResizeTextarea } from '../AutoResizeTextarea';

interface TweetContentEditorProps {
    value: string;
    onChange: (value: string) => void;
    className?: string;
    placeholder?: string;
}

export const TweetContentEditor: React.FC<TweetContentEditorProps> = ({
    value,
    onChange,
    className = "",
    placeholder
}) => {
    const [isEditing, setIsEditing] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    // Format text to highlight URLs
    const renderFormattedText = (text: string) => {
        if (!text) return <span className="text-gray-400">{placeholder || "What is happening?"}</span>;

        // Simple URL regex
        const urlRegex = /(https?:\/\/[^\s]+)/g;
        const parts = text.split(urlRegex);

        return parts.map((part, index) => {
            if (part.match(urlRegex)) {
                return (
                    <a
                        key={index}
                        href={part}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[#1d9bf0] hover:underline cursor-pointer"
                        onClick={(e) => e.stopPropagation()} // Prevent triggering edit mode when clicking link
                    >
                        {part}
                    </a>
                );
            }
            return <span key={index}>{part}</span>;
        });
    };

    const [initialHeight, setInitialHeight] = useState<number | undefined>(undefined);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    const handleStartEditing = () => {
        if (containerRef.current) {
            setInitialHeight(containerRef.current.clientHeight);
        }
        setIsEditing(true);
    };

    // Manual autofocus with preventScroll
    useEffect(() => {
        if (isEditing && textareaRef.current) {
            textareaRef.current.focus({ preventScroll: true });

            // Move cursor to end
            const length = textareaRef.current.value.length;
            textareaRef.current.setSelectionRange(length, length);
        }
    }, [isEditing]);

    if (isEditing) {
        return (
            <AutoResizeTextarea
                ref={textareaRef}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                onBlur={() => setIsEditing(false)}
                className={`${className} min-h-[20px] outline-none`}
                placeholder={placeholder}
                style={initialHeight ? { height: `${initialHeight}px` } : undefined}
            />
        );
    }

    return (
        <div
            ref={containerRef}
            className={`${className} min-h-[20px] cursor-text whitespace-pre-wrap outline-none`}
            onClick={handleStartEditing}
        >
            {renderFormattedText(value)}
        </div>
    );
};
