import React, { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useLanguage } from '../LanguageContext';

interface TextSelectionPopoverProps {
    onExplain: (text: string) => void;
    onDeepDive: (text: string) => void;
    onQuote: (text: string) => void;
    containerRef?: React.RefObject<HTMLElement>; // Optional container to scope selection listening
}

// Simple button component with hover state managed via JS (for Shadow DOM compatibility)
const PopoverButton: React.FC<{
    label: string;
    onClick: () => void;
}> = ({ label, onClick }) => {
    const [isHovered, setIsHovered] = useState(false);

    return (
        <button
            type="button"
            onMouseEnter={() => {
                console.log('[TextSelectionPopover] Button mouseenter:', label);
                setIsHovered(true);
            }}
            onMouseLeave={() => {
                console.log('[TextSelectionPopover] Button mouseleave:', label);
                setIsHovered(false);
            }}
            onMouseDown={(e) => {
                console.log('[TextSelectionPopover] Button mousedown:', label);
                e.stopPropagation();
                e.nativeEvent.stopImmediatePropagation();
            }}
            onClick={(e) => {
                console.log('[TextSelectionPopover] Button clicked:', label);
                e.preventDefault();
                e.stopPropagation();
                e.nativeEvent.stopImmediatePropagation();
                onClick();
            }}
            style={{
                padding: '6px 12px',
                fontSize: '13px',
                fontWeight: 500,
                color: isHovered ? '#000000' : '#333333',
                backgroundColor: isHovered ? 'rgba(0, 0, 0, 0.06)' : 'transparent',
                borderRadius: '0',
                transition: 'all 0.15s ease',
                whiteSpace: 'nowrap',
                cursor: 'pointer',
                border: 'none',
                outline: 'none',
                pointerEvents: 'auto',
            }}
        >
            {label}
        </button>
    );
};

export const TextSelectionPopover: React.FC<TextSelectionPopoverProps> = ({
    onExplain,
    onDeepDive,
    onQuote,
    containerRef
}) => {
    const { t } = useLanguage();
    const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
    const [selectedText, setSelectedText] = useState('');
    const [isVisible, setIsVisible] = useState(false);
    const popoverRef = useRef<HTMLDivElement>(null);
    const [mountNode, setMountNode] = useState<Element | HTMLElement | null>(null);
    const isMouseDown = useRef(false);
    const isInteractingRef = useRef(false);

    useEffect(() => {
        // Determine mount node (Handle Shadow DOM)
        if (containerRef?.current) {
            const root = containerRef.current.getRootNode();
            if (root instanceof ShadowRoot) {
                // Try to find the app root inside shadow DOM to mount into
                const appRoot = root.querySelector('#x-sidekick-root');
                if (appRoot) {
                    setMountNode(appRoot);
                } else {
                    // Fallback to the shadow root's host or first child
                    setMountNode(root.host || document.body);
                }
            } else {
                setMountNode(document.body);
            }
        } else {
            setMountNode(document.body);
        }
    }, [containerRef]);

    useEffect(() => {
        const updateMenuState = () => {
            let selection: Selection | null = null;

            // check for shadow root selection
            if (containerRef?.current) {
                const root = containerRef.current.getRootNode();
                // @ts-ignore - getSelection exists on ShadowRoot in modern browsers
                if (root instanceof ShadowRoot && root.getSelection) {
                    // @ts-ignore
                    selection = root.getSelection();
                }
            }

            if (!selection) {
                selection = window.getSelection();
            }

            if (!selection || selection.isCollapsed || !selection.toString().trim()) {
                setIsVisible(false);
                return;
            }

            // Check containment
            if (containerRef?.current && !containerRef.current.contains(selection.anchorNode)) {
                setIsVisible(false);
                return;
            }

            // Don't show menu for user messages or welcome page or elements explicitly opting out
            const anchorElement = selection.anchorNode?.parentElement;
            if (anchorElement?.closest('[data-user-message="true"]') ||
                anchorElement?.closest('[data-welcome-page="true"]') ||
                anchorElement?.closest('[data-no-selection-menu="true"]')) {
                setIsVisible(false);
                return;
            }

            const text = selection.toString().trim();
            const range = selection.getRangeAt(0);
            const rect = range.getBoundingClientRect();

            setSelectedText(text);
            setPosition({
                top: rect.bottom + 10,
                left: rect.left + (rect.width / 2)
            });
            setIsVisible(true);
        };

        const handleSelectionChange = () => {
            // Guard: If interacting with the popover, do not hide
            if (isInteractingRef.current) return;

            let selection: Selection | null = null;
            if (containerRef?.current) {
                const root = containerRef.current.getRootNode();
                // @ts-ignore
                if (root instanceof ShadowRoot && root.getSelection) {
                    // @ts-ignore
                    selection = root.getSelection();
                }
            }
            if (!selection) selection = window.getSelection();

            if (!selection || selection.isCollapsed || !selection.toString().trim()) {
                setIsVisible(false);
                return;
            }

            if (!isMouseDown.current && selection && !selection.isCollapsed) {
                updateMenuState();
            }
        };

        const handleMouseDown = (e: Event) => {
            isMouseDown.current = true;

            // Allow interaction if interacting with popover
            if (isInteractingRef.current) return;

            // Check if click is inside popover
            const path = e.composedPath();
            if (popoverRef.current && path.includes(popoverRef.current)) {
                return;
            }

            setIsVisible(false);
        };

        const handleMouseUp = () => {
            isMouseDown.current = false;
            // Wait a tick for selection to settle
            setTimeout(updateMenuState, 10);
        };

        const handleScroll = () => {
            // Hide popover on scroll
            if (isVisible) {
                setIsVisible(false);
            }
        };

        // Add listeners
        document.addEventListener('mouseup', handleMouseUp);
        document.addEventListener('mousedown', handleMouseDown);
        document.addEventListener('selectionchange', handleSelectionChange);

        // Add scroll listener to container
        if (containerRef?.current) {
            containerRef.current.addEventListener('scroll', handleScroll);
        }

        let shadowRoot: ShadowRoot | null = null;
        if (containerRef?.current) {
            const root = containerRef.current.getRootNode();
            if (root instanceof ShadowRoot) {
                shadowRoot = root;
                shadowRoot.addEventListener('mouseup', handleMouseUp);
                shadowRoot.addEventListener('mousedown', handleMouseDown);
            }
        }

        return () => {
            document.removeEventListener('mouseup', handleMouseUp);
            document.removeEventListener('mousedown', handleMouseDown);
            document.removeEventListener('selectionchange', handleSelectionChange);
            if (containerRef?.current) {
                containerRef.current.removeEventListener('scroll', handleScroll);
            }
            if (shadowRoot) {
                shadowRoot.removeEventListener('mouseup', handleMouseUp);
                shadowRoot.removeEventListener('mousedown', handleMouseDown);
            }
        };
    }, [containerRef, isVisible]);

    const handleButtonClick = (callback: (text: string) => void) => {
        const text = selectedText;
        setIsVisible(false);
        window.getSelection()?.removeAllRanges();
        callback(text);
    };

    if (!isVisible || !position || !mountNode) return null;

    console.log('[TextSelectionPopover] Rendering popover, mountNode:', mountNode);

    return createPortal(
        <div
            ref={popoverRef}
            onMouseEnter={() => {
                console.log('[TextSelectionPopover] Container mouseenter');
                isInteractingRef.current = true;
            }}
            onMouseLeave={() => {
                console.log('[TextSelectionPopover] Container mouseleave');
                isInteractingRef.current = false;
            }}
            onMouseDown={(e) => {
                console.log('[TextSelectionPopover] Container mousedown');
                // Mark as interacting to prevent hide
                isInteractingRef.current = true;
                e.stopPropagation();
                e.nativeEvent.stopImmediatePropagation();
            }}
            onClick={(e) => {
                console.log('[TextSelectionPopover] Container click');
                e.stopPropagation();
                e.nativeEvent.stopImmediatePropagation();
            }}
            style={{
                position: 'fixed',
                top: `${Math.max(10, position.top)}px`,
                left: `${position.left}px`,
                transform: 'translateX(-50%)',
                zIndex: 2147483647, // Max z-index
                display: 'flex',
                alignItems: 'center',
                backgroundColor: '#ffffff',
                boxShadow: '0 4px 20px rgba(0, 0, 0, 0.15)',
                borderRadius: '9999px',
                border: '1px solid rgba(0, 0, 0, 0.08)',
                padding: '0',
                overflow: 'hidden',
                fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                color: '#1a1a1a',
                pointerEvents: 'auto',
            }}
        >
            <PopoverButton
                label={t.textSelection.explain}
                onClick={() => handleButtonClick(onExplain)}
            />
            <div style={{ width: '1px', backgroundColor: 'rgba(0, 0, 0, 0.15)', alignSelf: 'stretch', margin: '8px 0' }} />
            <PopoverButton
                label={t.textSelection.deepDive}
                onClick={() => handleButtonClick(onDeepDive)}
            />
            <div style={{ width: '1px', backgroundColor: 'rgba(0, 0, 0, 0.15)', alignSelf: 'stretch', margin: '8px 0' }} />
            <PopoverButton
                label={t.textSelection.quote}
                onClick={() => handleButtonClick(onQuote)}
            />
        </div>,
        mountNode
    );
};
