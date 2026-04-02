import React, { useEffect, useLayoutEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';

interface NotificationToastProps {
    message: string;
    isVisible: boolean;
    onModalClose?: () => void;
}

export const NotificationToast: React.FC<NotificationToastProps> = ({ message, isVisible, onModalClose }) => {
    const [style, setStyle] = useState<{ top: string; left?: string; right?: string; borderRadius: string }>({
        top: '80px',
        right: '24px',
        borderRadius: '9999px'
    });
    const isDark = document.documentElement.classList.contains('dark');
    const wasModalPresent = useRef(false);

    useLayoutEffect(() => {
        if (isVisible) {
            const updatePosition = () => {
                // Try multiple selectors to find the main compose modal
                // Prioritize the one with aria-modal="true" which usually indicates the active one
                const modal = document.querySelector('[role="dialog"][aria-modal="true"]') ||
                    document.querySelector('[role="dialog"]');

                if (modal) {
                    wasModalPresent.current = true;
                    const rect = modal.getBoundingClientRect();
                    const computedStyle = window.getComputedStyle(modal);
                    const borderRadius = computedStyle.borderRadius || '16px';

                    // Position to the right of the modal, aligned with its top
                    setStyle({
                        top: `${rect.top}px`,
                        left: `${rect.right + 12}px`, // 12px gap
                        borderRadius: borderRadius
                    });
                } else {
                    // Detect if modal just closed
                    if (wasModalPresent.current) {
                        wasModalPresent.current = false;
                        if (onModalClose) onModalClose();
                    }

                    // Fallback for inline or no-modal: Fixed top right
                    setStyle({
                        top: '80px',
                        right: '24px',
                        borderRadius: '9999px'
                    });
                }
            };

            // Initial check
            updatePosition();

            // Poll for modal presence (it might animate in)
            const intervalId = setInterval(updatePosition, 100);

            // Listen for resize
            window.addEventListener('resize', updatePosition);

            return () => {
                clearInterval(intervalId);
                window.removeEventListener('resize', updatePosition);
            };
        } else {
            wasModalPresent.current = false;
        }
    }, [isVisible, onModalClose]);

    if (!isVisible) return null;

    return createPortal(
        <div
            style={{
                position: 'fixed',
                zIndex: 2147483647,
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '10px 16px',
                backgroundColor: isDark ? 'rgba(21, 32, 43, 0.95)' : 'rgba(255, 255, 255, 0.95)',
                border: isDark ? '1px solid rgba(56, 68, 77, 0.5)' : '1px solid rgba(239, 243, 244, 0.5)',
                borderRadius: '9999px',
                boxShadow: '0 8px 32px rgba(0, 0, 0, 0.12)',
                backdropFilter: 'blur(8px)',
                animation: 'fadeIn 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
                ...style
            }}
        >
            <div className="loading loading-spinner loading-sm text-[#1d9bf0]"></div>
            <span style={{
                fontWeight: '600',
                fontSize: '14px',
                color: isDark ? '#ffffff' : '#0f1419',
                whiteSpace: 'nowrap'
            }}>
                {message}
            </span>
        </div>,
        document.body
    );
};
