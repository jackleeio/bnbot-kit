
import React, { useState, useEffect } from 'react';
import { RotateCw, Copy, Check, Crown } from 'lucide-react';
import { useLanguage } from '../LanguageContext';
import { authService, SubscriptionResponse, SubscriptionTier } from '../../services/authService';

interface CreditsPanelProps {
    userEmail?: string;
    userName?: string;
    userCredits?: number;
    subscriptionTier?: SubscriptionTier;
    onCreditsUpdated?: (credits: number, subscriptionTier: SubscriptionTier) => void;
}

export const CreditsPanel: React.FC<CreditsPanelProps> = ({ userEmail, userName, userCredits = 0, subscriptionTier = 'free', onCreditsUpdated }) => {
    const { t } = useLanguage();
    const inviteCode = "https://bnbot.ai/register?code=UK67KSD3";
    const [copied, setCopied] = useState(false);
    const [credits, setCredits] = useState<number | null>(userCredits ?? null);
    const [isLoading, setIsLoading] = useState(false);
    const [subscription, setSubscription] = useState<SubscriptionResponse | null>(null);
    const [isLoadingSubscription, setIsLoadingSubscription] = useState(false);

    const handleRefresh = async () => {
        setIsLoading(true);
        setIsLoadingSubscription(true);
        try {
            const [newCredits, subscriptionData] = await Promise.all([
                authService.fetchCredits(),
                authService.fetchSubscription()
            ]);
            setCredits(newCredits);
            setSubscription(subscriptionData);
            // Notify parent component about credits update
            const tierToUse = subscriptionData.has_subscription && subscriptionData.subscription
                ? subscriptionData.subscription.plan_name
                : subscriptionTier;
            onCreditsUpdated?.(newCredits, tierToUse);
        } catch (error) {
            console.error('Error refreshing credits/subscription:', error);
        } finally {
            setIsLoading(false);
            setIsLoadingSubscription(false);
        }
    };

    const fetchSubscription = async () => {
        setIsLoadingSubscription(true);
        try {
            const data = await authService.fetchSubscription();
            setSubscription(data);
            // Notify parent component about subscription update
            const tierToUse = data.has_subscription && data.subscription
                ? data.subscription.plan_name
                : subscriptionTier;
            onCreditsUpdated?.(credits ?? userCredits ?? 0, tierToUse);
        } catch (error) {
            console.error('Error fetching subscription:', error);
        } finally {
            setIsLoadingSubscription(false);
        }
    };

    useEffect(() => {
        // Sync credits from parent prop whenever it changes
        setCredits(userCredits);
    }, [userCredits]);

    useEffect(() => {
        // Auto-fetch data on component mount
        handleRefresh();
    }, []);

    const getTierColor = (tier: SubscriptionTier) => {
        switch (tier) {
            case 'pro': return { text: '#f59e0b', bg: '#fef3c7' };
            case 'basic': return { text: '#8b5cf6', bg: '#ede9fe' };
            case 'starter': return { text: '#3b82f6', bg: '#dbeafe' };
            default: return { text: 'var(--text-secondary)', bg: 'var(--bg-secondary)' };
        }
    };

    const formatDate = (dateStr: string) => {
        return new Date(dateStr).toLocaleDateString();
    };

    const handleCopy = () => {
        navigator.clipboard.writeText(inviteCode);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="flex flex-col h-full bg-transparent overflow-y-auto" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
            <div className="px-4 pt-4 pb-20 space-y-4">

                {/* Header */}
                <div>
                    <h1 className="text-3xl font-black text-[var(--text-primary)] tracking-tight">{t.credits.title}</h1>
                    {t.credits.description && (
                        <p className="text-[var(--text-secondary)] text-sm leading-relaxed mt-2">
                            {t.credits.description}
                        </p>
                    )}
                </div>

                {/* User Info Card */}
                {(userName || userEmail) && (
                    <div className="bg-[var(--bg-primary)] rounded-[1.5rem] border border-[var(--border-color)] px-4 py-3 shadow-sm">
                        <div>
                            {userName && (
                                <p className="text-sm font-semibold text-[var(--text-primary)]">
                                    {userName}
                                </p>
                            )}
                            {userEmail && (
                                <p className="text-sm text-[var(--text-secondary)] mt-1">
                                    {userEmail}
                                </p>
                            )}
                        </div>
                    </div>
                )}

                {/* Balance Card */}
                <div className="bg-[var(--bg-primary)] rounded-[1.5rem] border border-[var(--border-color)] px-4 py-3 shadow-sm">
                    <div className="flex justify-between items-start mb-1">
                        <span className="text-[var(--text-secondary)] font-medium text-sm">{t.credits.currentBalance}</span>
                        <button
                            onClick={handleRefresh}
                            disabled={isLoading || isLoadingSubscription}
                            className="p-1.5 rounded-lg hover:bg-[var(--hover-bg)] transition-colors disabled:opacity-50"
                            title={t.credits.refresh}
                        >
                            <RotateCw size={16} className={`text-[var(--text-secondary)] ${isLoading ? 'animate-spin' : ''}`} />
                        </button>
                    </div>

                    <div className="mb-4">
                        <div className="flex items-baseline gap-2">
                            <span
                                className={`text-4xl font-black tracking-tighter px-2.5 rounded-xl text-[var(--text-primary)] relative`}
                                style={{ fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', fontVariantNumeric: 'tabular-nums' }}
                            >
                                {isLoading ? (
                                    <span className="inline-block w-40 h-10 bg-[var(--hover-bg)] rounded-xl animate-pulse align-middle"></span>
                                ) : (
                                    Math.floor(credits ?? 0).toLocaleString()
                                )}
                            </span>
                            <span className="text-[var(--text-secondary)] font-medium">credits</span>
                        </div>
                    </div>

                </div>

                {/* Subscription Card */}
                <div className="bg-[var(--bg-primary)] rounded-[1.5rem] border border-[var(--border-color)] px-4 py-3 shadow-sm">
                    <div className="flex justify-between items-center mb-3">
                        <span className="text-[var(--text-secondary)] font-medium text-sm">{t.credits.subscription}</span>
                        {subscription?.has_subscription && subscription.subscription && (
                            <button
                                onClick={() => authService.openWebsiteWithAuth('/pricing')}
                                className="px-3 py-1.5 rounded-full text-xs font-bold bg-[var(--text-primary)] text-[var(--bg-primary)] hover:opacity-80 transition-opacity"
                            >
                                {t.credits.upgradePlan}
                            </button>
                        )}
                    </div>

                    {isLoadingSubscription ? (
                        <div className="space-y-4">
                            {/* Plan Header Skeleton */}
                            <div className="flex items-center gap-2">
                                <div className="w-5 h-5 bg-[var(--hover-bg)] rounded-full animate-pulse"></div>
                                <div className="h-7 bg-[var(--hover-bg)] rounded-md animate-pulse w-24"></div>
                                <div className="h-5 bg-[var(--hover-bg)] rounded-full animate-pulse w-12"></div>
                            </div>

                            {/* Details Skeleton */}
                            <div className="space-y-2 pl-7">
                                <div className="flex justify-between">
                                    <div className="h-4 bg-[var(--hover-bg)] rounded animate-pulse w-16"></div>
                                    <div className="h-4 bg-[var(--hover-bg)] rounded animate-pulse w-12"></div>
                                </div>
                                <div className="flex justify-between">
                                    <div className="h-4 bg-[var(--hover-bg)] rounded animate-pulse w-16"></div>
                                    <div className="h-4 bg-[var(--hover-bg)] rounded animate-pulse w-20"></div>
                                </div>
                            </div>
                        </div>
                    ) : subscription?.has_subscription && subscription.subscription ? (
                        <div className="space-y-2">
                            <div className="flex items-center gap-2">
                                <Crown
                                    size={20}
                                    style={{ color: getTierColor(subscription.subscription.plan_name).text }}
                                />
                                <span
                                    className="text-xl font-bold capitalize text-[var(--text-primary)]"
                                >
                                    {subscription.subscription.plan_name}
                                </span>
                            </div>

                            <div className="text-sm text-[var(--text-secondary)] space-y-1 pl-7">
                                <div className="flex justify-between">
                                    <span>{t.credits.billingCycle}</span>
                                    <span className="font-medium text-[var(--text-primary)]">
                                        {subscription.subscription.billing_interval === 'month' ? t.credits.monthly : t.credits.yearly}
                                    </span>
                                </div>

                                <div className="flex justify-between">
                                    <span>{t.credits.nextRenewal}</span>
                                    <span className="font-medium text-[var(--text-primary)]">
                                        {formatDate(subscription.subscription.current_period_end)}
                                    </span>
                                </div>
                            </div>

                            {subscription.subscription.cancel_at_period_end && (
                                <p className="text-xs text-amber-600 pl-7 mt-2">
                                    {t.credits.cancelAtPeriodEnd}
                                </p>
                            )}
                        </div>
                    ) : (
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <Crown size={20} className="text-[var(--text-secondary)]" />
                                <div>
                                    <p className="text-[var(--text-primary)] font-medium">{t.common.subscriptionTiers.free}</p>
                                    <p className="text-xs text-[var(--text-secondary)]">{t.credits.noSubscription}</p>
                                </div>
                            </div>
                            <button
                                onClick={() => authService.openWebsiteWithAuth('/pricing')}
                                className="px-4 py-2 rounded-full font-bold text-sm flex items-center gap-1.5 transition-all bg-gradient-to-r from-amber-500 to-orange-500 text-white hover:opacity-90"
                            >
                                <Crown size={14} />
                                {t.credits.upgradePlan}
                            </button>
                        </div>
                    )}
                </div>

                {/* Invite Section */}
                <div className="bg-[var(--accent-bg-light)] rounded-[2rem] border border-[var(--accent-color)] p-5 pb-8">
                    <h2 className="text-xl font-bold text-[var(--text-primary)] mb-1">{t.credits.inviteAndEarn}</h2>
                    <p className="text-[var(--text-secondary)] text-sm mb-4">
                        {t.credits.shareInviteLink}
                    </p>
                    {/* Stats */}
                    <div className="space-y-2 mb-4 pl-6">
                        <div className="flex justify-between text-sm">
                            <span className="text-[var(--text-secondary)]">{t.credits.friendsInvited}</span>
                            {isLoading ? (
                                <span className="w-8 h-5 bg-[var(--hover-bg)] rounded-md animate-pulse"></span>
                            ) : (
                                <span className="font-bold text-[var(--text-primary)]">0</span>
                            )}
                        </div>
                        <div className="flex justify-between text-sm">
                            <span className="text-[var(--text-secondary)]">{t.credits.creditsFromInvites}</span>
                            {isLoading ? (
                                <span className="w-12 h-5 bg-[var(--hover-bg)] rounded-md animate-pulse"></span>
                            ) : (
                                <span className="font-bold text-[var(--text-primary)]">0</span>
                            )}
                        </div>
                    </div>

                    {/* Link Input */}
                    <div className="space-y-2">
                        <label className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider block">{t.credits.inviteLink}</label>
                        <div className="bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-xl p-3 flex items-center justify-between gap-2">
                            <span className="text-xs text-[var(--text-primary)] truncate font-mono">
                                {inviteCode}
                            </span>
                            <button
                                onClick={handleCopy}
                                className="flex-shrink-0 p-1.5 rounded-lg hover:bg-[var(--hover-bg)] transition-colors"
                                title={t.credits.copyLink}
                            >
                                {copied ? <Check size={18} className="text-green-500" /> : <Copy size={18} className="text-[var(--text-secondary)]" />}
                            </button>
                        </div>
                    </div>
                </div>

            </div>
        </div>
    );
};
