import React, { useRef, useLayoutEffect, useEffect } from 'react';

interface AutoResizeTextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
    value: string;
}

export const AutoResizeTextarea = React.forwardRef<HTMLTextAreaElement, AutoResizeTextareaProps>(({ value, style, className, ...props }, ref) => {
    const internalRef = useRef<HTMLTextAreaElement>(null);

    // Combine refs
    const setRefs = (element: HTMLTextAreaElement | null) => {
        internalRef.current = element;
        if (typeof ref === 'function') {
            ref(element);
        } else if (ref) {
            (ref as React.MutableRefObject<HTMLTextAreaElement | null>).current = element;
        }
    };

    const adjustHeight = () => {
        if (internalRef.current) {
            internalRef.current.style.height = 'auto'; // Reset to auto to shrink if needed
            internalRef.current.style.height = `${internalRef.current.scrollHeight}px`;
        }
    };

    useLayoutEffect(() => {
        adjustHeight();
    }, [value]);

    // Handle window resize to adjust height if width changes
    useEffect(() => {
        window.addEventListener('resize', adjustHeight);
        return () => window.removeEventListener('resize', adjustHeight);
    }, []);

    return (
        <textarea
            ref={setRefs}
            value={value}
            className={className}
            style={{ ...style, overflow: 'hidden', resize: 'none' }}
            rows={1}
            {...props}
            onInput={(e) => {
                adjustHeight();
                props.onInput?.(e);
            }}
        />
    );
});
AutoResizeTextarea.displayName = 'AutoResizeTextarea';
