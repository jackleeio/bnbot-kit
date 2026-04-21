import React, { useState, useEffect } from 'react';
import { Zap, Bot, Pencil, ChevronLeft } from 'lucide-react';
import { ChatPanel } from './ChatPanel';
import { BoostPanel } from './BoostPanel';
import { boostService } from '../../services/boostService';
import { useLanguage } from '../LanguageContext';

type Mode = 'boost' | 'agent';

interface TweetContextPanelProps {
    tweetId: string;
    onBack: () => void;
    isLoggedIn?: boolean;
    onLogin?: () => void;
    onCreditsClick?: () => void;
    initialMode?: Mode;
    pendingAction?: string | null;
    onPendingActionConsumed?: () => void;
    onStayOnPage?: () => void;
}

export const TweetContextPanel: React.FC<TweetContextPanelProps> = ({ tweetId, onBack, isLoggedIn, onLogin, onCreditsClick, initialMode = 'agent', pendingAction, onPendingActionConsumed, onStayOnPage }) => {
    const { t } = useLanguage();
    const [activeMode, setActiveMode] = useState<Mode>(initialMode);
    const [pendingMessage, setPendingMessage] = useState<string | null>(null);

    const [resetTrigger, setResetTrigger] = useState(0);
    const [hasMessages, setHasMessages] = useState(false);
    const [hasBoost, setHasBoost] = useState(false);

    // Check if tweet has boost activity
    useEffect(() => {
        if (!tweetId) return;
        boostService.getBoostsByTweet(tweetId).then(boosts => {
            const found = boosts.length > 0;
            setHasBoost(found);
            // If initialMode is boost but no boost exists, switch to agent
            if (!found && activeMode === 'boost') {
                setActiveMode('agent');
            }
        }).catch(() => setHasBoost(false));
    }, [tweetId]);

    // Update activeMode when initialMode prop changes
    useEffect(() => {
        if (initialMode === 'boost' && !hasBoost) return; // Don't switch to boost if none exists
        setActiveMode(initialMode);
    }, [initialMode, hasBoost]);

    // Auto-trigger action when requested from injected button
    useEffect(() => {
        if (pendingAction) {
            if (!isLoggedIn && onLogin) {
                onLogin();
            } else {
                setActiveMode('agent');
                const xAgent = (t.chat as any)?.xAgent;
                let query: string;
                if (pendingAction === 'reply') {
                    query = xAgent?.replyQuery || 'Generate a witty and engaging reply to this tweet.';
                } else if (pendingAction === 'imageReply') {
                    query = xAgent?.imageReplyQuery || 'Generate an image replying to this tweet';
                } else if (pendingAction === 'quote') {
                    query = xAgent?.quoteQuery || 'Draft a quote tweet that adds value to this conversation.';
                } else if (pendingAction === 'summary') {
                    query = xAgent?.summaryQuery || 'Merge all tweets from this thread into one';
                } else {
                    query = xAgent?.analyzeQuery || "Analyze this tweet's sentiment and impact.";
                }
                setPendingMessage(query);
            }
            onPendingActionConsumed?.();
        }
    }, [pendingAction]);
    const [isHeaderVisible, setIsHeaderVisible] = useState(true);

    const handleGenerate = (taskText: string) => {
        if (!isLoggedIn && onLogin) {
            onLogin();
        } else {
            const prompt = `Please help me write a tweet about: ${taskText}. Use English.`;

            // Ensure proper state update order:
            // 1. Reset trigger to clear ChatPanel state and TrendService history
            // 2. Set pending message to be sent after reset completes
            // 3. Switch to agent mode

            // All state updates are batched by React, so they happen in one render cycle
            // But the effects will run in their dependency order
            setResetTrigger(prev => prev + 1);  // Triggers ChatPanel reset
            setHasMessages(false);
            setIsHeaderVisible(true);

            // Set pending message after a brief delay to ensure ChatPanel's resetTrigger
            // effect has time to execute and clear the service layer before we send the message
            setTimeout(() => {
                setPendingMessage(prompt);  // Will be sent with fresh history
            }, 100);  // Small delay to ensure reset happens first

            setActiveMode('agent');
        }
    };

    const handleReset = () => {
        setResetTrigger(prev => prev + 1);
        setHasMessages(false);
        setIsHeaderVisible(true); // Reset visibility
    };

    return (
        <div className="flex flex-col h-full bg-[var(--bg-primary)] relative overflow-hidden">
            {/* Header / Status Bar - Overlay */}
            <div
                className={`absolute top-0 left-0 right-0 flex items-center justify-between px-4 h-[57px] border-b border-[var(--border-color)] bg-[var(--bg-primary)] z-30 transition-transform duration-300 ease-in-out ${isHeaderVisible ? 'translate-y-0' : '-translate-y-full'
                    }`}
            >
                {/* Left Side: New Chat Button (Agent Mode Only + Has Messages) or Title (Boost Mode) */}
                <div className="flex items-center justify-start min-w-[32px]">
                    {activeMode === 'agent' && hasMessages && (
                        <button
                            onClick={handleReset}
                            className="p-1.5 hover:bg-[var(--hover-bg)] rounded-full transition-colors text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                            title="Start New Chat"
                        >
                            <Pencil size={18} strokeWidth={2} />
                        </button>
                    )}
                    {activeMode === 'boost' && (
                        <div className="flex items-center gap-1">
                            <button
                                onClick={onBack}
                                className="p-1 -ml-2 hover:bg-[var(--hover-bg)] rounded-full transition-colors text-black cursor-pointer"
                            >
                                <ChevronLeft size={20} />
                            </button>
                            <h2 className="text-lg font-bold text-[var(--text-primary)] whitespace-nowrap">Boost Info</h2>
                        </div>
                    )}
                </div>

                {/* Toggle Switch - only show when tweet has boost */}
                {hasBoost ? (
                <div className="flex p-1 bg-[var(--bg-secondary)] rounded-full border border-[var(--border-color)] relative">
                    {/* Sliding Background */}
                    <div
                        className="absolute top-1 bottom-1 w-[calc(50%-4px)] bg-[var(--bg-primary)] rounded-full shadow-sm transition-all duration-300 ease-in-out border border-[var(--border-color)]"
                        style={{
                            left: activeMode === 'boost' ? '4px' : 'calc(50%)'
                        }}
                    />

                    <button
                        onClick={() => setActiveMode('boost')}
                        className={`relative z-10 flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-bold transition-all duration-300 ${activeMode === 'boost'
                            ? 'text-[var(--text-primary)]'
                            : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                            }`}
                    >
                        <Zap size={14} className={activeMode === 'boost' ? 'text-[var(--accent-color)] fill-[var(--accent-color)]' : ''} />
                        Boost
                    </button>
                    <button
                        onClick={() => setActiveMode('agent')}
                        className={`relative z-10 flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-bold transition-all duration-300 ${activeMode === 'agent'
                            ? 'text-[var(--text-primary)]'
                            : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                            }`}
                    >
                        <Bot size={14} className={activeMode === 'agent' ? 'text-[var(--accent-color)]' : ''} />
                        X Agent
                    </button>
                </div>
                ) : null}
            </div>

            {/* Content Area - Persist both views */}
            <div className="flex-1 overflow-hidden relative">
                {hasBoost && (
                <div
                    className="absolute inset-0 w-full h-full pt-[57px]"
                    style={{ visibility: activeMode === 'boost' ? 'visible' : 'hidden', zIndex: activeMode === 'boost' ? 10 : 0 }}
                >
                    <BoostPanel initialTweetId={tweetId} isContextMode={true} onGenerate={handleGenerate} onLogin={onLogin} />
                </div>
                )}

                <div
                    className="absolute inset-0 w-full h-full"
                    style={{ visibility: activeMode === 'agent' ? 'visible' : 'hidden', zIndex: activeMode === 'agent' ? 10 : 0 }}
                >
                    <ChatPanel
                        key={`${tweetId}-${resetTrigger}`}
                        contextTweetId={tweetId}
                        onLoginClick={isLoggedIn ? undefined : onLogin}
                        onCreditsClick={onCreditsClick}
                        initialMessage={pendingMessage}
                        onMessageSent={() => setPendingMessage(null)}
                        resetTrigger={resetTrigger}
                        onMessagesChange={(count) => setHasMessages(count > 0)}
                        onScrollDirectionChange={(isScrollingDown) => setIsHeaderVisible(!isScrollingDown)}
                        onStayOnPage={onStayOnPage}
                    />
                </div>
            </div>
        </div>
    );
};
