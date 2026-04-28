import React, { useState, useEffect, useRef } from 'react';
import { RotateCw, Coins, Wallet, Info, CalendarCheck, ArrowLeft } from 'lucide-react';
import { useLanguage } from '../LanguageContext';
import { useVaultBalance, TokenInfo } from '../../hooks/useVaultBalance';
import { useXUser } from '../../hooks/useXUsername';
import { navigateToUrl } from '../../utils/navigationUtils';

interface XBalancePanelProps {
    onBack?: () => void;
}

export const XBalancePanel: React.FC<XBalancePanelProps> = ({ onBack }) => {
    const { t, language } = useLanguage();
    const [showWithdrawPrompt, setShowWithdrawPrompt] = useState(false);
    const [avatarLoaded, setAvatarLoaded] = useState(false);
    const promptRef = useRef<HTMLDivElement>(null);

    // 从全局 store 获取 X 用户信息
    const { username: xUsername, displayName: xDisplayName, avatarUrl: xAvatarUrl, isBlueVerified } = useXUser();

    // 使用 Vault 余额 Hook
    const { tokens, isLoading: isLoadingVault, refetch: refetchVault } = useVaultBalance(xUsername);

    // 头像 URL 变化时重置加载状态
    useEffect(() => {
        setAvatarLoaded(false);
    }, [xAvatarUrl]);

    // 点击外部关闭 prompt
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (promptRef.current && !promptRef.current.contains(event.target as Node)) {
                setShowWithdrawPrompt(false);
            }
        };

        if (showWithdrawPrompt) {
            document.addEventListener('mousedown', handleClickOutside);
            // 5秒后自动隐藏
            const timer = setTimeout(() => {
                setShowWithdrawPrompt(false);
            }, 5000);
            return () => {
                document.removeEventListener('mousedown', handleClickOutside);
                clearTimeout(timer);
            };
        }
    }, [showWithdrawPrompt]);

    return (
        <div className="flex flex-col h-full bg-transparent overflow-y-auto relative" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
            <div className="px-4 pt-4 pb-20 space-y-4">

                {/* Header */}
                <div className="flex items-center gap-3">
                    {onBack && (
                        <button
                            onClick={onBack}
                            className="w-8 h-8 -ml-1 flex items-center justify-center rounded-lg text-[var(--text-secondary)] hover:bg-[var(--hover-bg)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
                            title="Back to Boost"
                        >
                            <ArrowLeft size={18} />
                        </button>
                    )}
                    <h1 className="text-2xl font-black text-[var(--text-primary)] tracking-tight">{t.common.xBalance}</h1>
                    <div className="flex items-center gap-2 ml-auto">
                        {/* Activities Button */}
                        <button
                            onClick={() => {
                                if (xUsername) {
                                    navigateToUrl(`https://x.com/${xUsername}`);
                                }
                            }}
                            className="px-3 py-1 bg-[var(--bg-secondary)] text-[var(--text-primary)] text-xs font-semibold rounded-full border border-[var(--border-color)] hover:bg-[var(--hover-bg)] transition-colors flex items-center gap-1.5"
                        >
                            <CalendarCheck size={12} />
                            {language === 'zh' ? "活动" : "Activities"}
                        </button>
                        {/* Withdraw Button */}
                        <button
                            onClick={() => {
                                const url = xUsername
                                    ? `https://xid.so/activate?username=${xUsername}`
                                    : 'https://xid.so/activate';
                                window.open(url, '_blank');
                            }}
                            className="px-3 py-1 bg-[var(--text-primary)] text-[var(--bg-primary)] text-xs font-semibold rounded-full hover:opacity-90 transition-opacity"
                        >
                            {language === 'zh' ? "提现" : "Withdraw"}
                        </button>
                    </div>
                </div>

                {/* User Info Card */}
                <div className="bg-[var(--bg-primary)] rounded-[1.5rem] border border-[var(--border-color)] pl-3 pr-4 py-3 shadow-sm">
                    <div className="flex items-center gap-3">
                        {/* Avatar */}
                        <div className="relative w-12 h-12 flex-shrink-0">
                            {/* 骨架屏 - 头像未加载时显示 */}
                            {(!xAvatarUrl || !avatarLoaded) && (
                                <div className="absolute inset-0 rounded-full bg-[var(--hover-bg)] animate-pulse" />
                            )}
                            {/* 头像图片 */}
                            {xAvatarUrl && (
                                <img
                                    src={xAvatarUrl}
                                    alt="Avatar"
                                    className={`absolute inset-0 w-12 h-12 rounded-full object-cover transition-opacity duration-200 ${avatarLoaded ? 'opacity-100' : 'opacity-0'}`}
                                    onLoad={() => setAvatarLoaded(true)}
                                />
                            )}
                        </div>
                        <div className="flex-1 min-w-0">
                            {/* X Display Name */}
                            {xUsername ? (
                                <>
                                    <div className="flex items-center gap-1.5">
                                        <p className="text-base font-semibold text-[var(--text-primary)] truncate">
                                            {xDisplayName || xUsername}
                                        </p>
                                        {isBlueVerified && (
                                            <svg viewBox="0 0 22 22" aria-label="Verified account" role="img" className="w-[18px] h-[18px] flex-shrink-0" fill="#1d9bf0">
                                                <g><path d="M20.396 11c-.018-.646-.215-1.275-.57-1.816-.354-.54-.852-.972-1.438-1.246.223-.607.27-1.264.14-1.897-.131-.634-.437-1.218-.882-1.687-.47-.445-1.053-.75-1.687-.882-.633-.13-1.29-.083-1.897.14-.273-.587-.704-1.086-1.245-1.44S11.647 1.62 11 1.604c-.646.017-1.273.213-1.813.568s-.969.854-1.24 1.44c-.608-.223-1.267-.272-1.902-.14-.635.13-1.22.436-1.69.882-.445.47-.749 1.055-.878 1.688-.13.633-.08 1.29.144 1.896-.587.274-1.087.705-1.443 1.245-.356.54-.555 1.17-.574 1.817.02.647.218 1.276.574 1.817.356.54.856.972 1.443 1.245-.224.606-.274 1.263-.144 1.896.13.634.433 1.218.877 1.688.47.443 1.054.747 1.687.878.633.132 1.29.084 1.897-.136.274.586.705 1.084 1.246 1.439.54.354 1.17.551 1.816.569.647-.016 1.276-.213 1.817-.567s.972-.854 1.245-1.44c.604.239 1.266.296 1.903.164.636-.132 1.22-.447 1.68-.907.46-.46.776-1.044.908-1.681s.075-1.299-.165-1.903c.586-.274 1.084-.705 1.439-1.246.354-.54.551-1.17.569-1.816zM9.662 14.85l-3.429-3.428 1.293-1.302 2.072 2.072 4.4-4.794 1.347 1.246z"></path></g>
                                            </svg>
                                        )}
                                    </div>
                                    <p className="text-sm text-[var(--text-secondary)]">
                                        @{xUsername}
                                    </p>
                                </>
                            ) : (
                                <>
                                    <div className="h-4 w-24 bg-[var(--hover-bg)] rounded animate-pulse mb-1" />
                                    <div className="h-3 w-20 bg-[var(--hover-bg)] rounded animate-pulse" />
                                </>
                            )}
                        </div>
                    </div>
                </div>

                {/* On-Chain Balance Section */}
                <div className="flex justify-between items-center pl-4 pr-2">
                    <span className="text-[var(--text-secondary)] font-medium text-sm">
                        {language === 'zh' ? "Vault 余额" : "Vault Balance"}
                    </span>
                    <button
                        onClick={refetchVault}
                        disabled={isLoadingVault}
                        className="p-1.5 rounded-lg hover:bg-[var(--hover-bg)] transition-colors disabled:opacity-50"
                        title={t.credits.refresh}
                    >
                        <RotateCw size={16} className={`text-[var(--text-secondary)] ${isLoadingVault ? 'animate-spin' : ''}`} />
                    </button>
                </div>

                {(isLoadingVault || !xUsername) ? (
                    <div className="space-y-2">
                        {[1, 2, 3].map((i) => (
                            <div key={i} className="bg-[var(--bg-primary)] rounded-[1.5rem] border border-[var(--border-color)] px-4 py-2 shadow-sm">
                                <div className="flex justify-between items-center">
                                    <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 rounded-full bg-[var(--hover-bg)] animate-pulse" />
                                        <div className="space-y-1">
                                            <div className="h-3 w-16 bg-[var(--hover-bg)] rounded animate-pulse" />
                                            <div className="h-2 w-10 bg-[var(--hover-bg)] rounded animate-pulse" />
                                        </div>
                                    </div>
                                    <div className="h-5 w-20 bg-[var(--hover-bg)] rounded animate-pulse" />
                                </div>
                            </div>
                        ))}
                    </div>
                ) : tokens.length > 0 ? (
                    <div className="space-y-3">
                        {tokens.map((token: TokenInfo) => (
                            <div
                                key={token.address}
                                className="bg-[var(--bg-primary)] rounded-[1.5rem] border border-[var(--border-color)] px-4 py-3 shadow-sm"
                            >
                                <div className="flex justify-between items-center">
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 rounded-full bg-[var(--hover-bg)] flex items-center justify-center">
                                            <Coins size={20} className="text-[var(--text-secondary)]" />
                                        </div>
                                        <div>
                                            <p className="text-sm font-semibold text-[var(--text-primary)]">
                                                {token.symbol}
                                            </p>
                                            <p className="text-xs text-[var(--text-secondary)]">
                                                {token.name}
                                            </p>
                                        </div>
                                    </div>
                                    <span
                                        className="text-base font-bold text-[var(--text-primary)]"
                                        style={{ fontVariantNumeric: 'tabular-nums' }}
                                    >
                                        {parseFloat(token.balance).toLocaleString(undefined, {
                                            minimumFractionDigits: 2,
                                            maximumFractionDigits: 6
                                        })}
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="bg-[var(--bg-primary)] rounded-[1.5rem] border border-[var(--border-color)] px-6 py-8 shadow text-center flex flex-col items-center justify-center gap-2 mx-2">
                        <Wallet className="text-[var(--text-secondary)] opacity-50" size={32} />
                        <p className="text-sm text-[var(--text-secondary)] font-medium">
                            {language === 'zh' ? "暂无余额" : "No Balance"}
                        </p>
                    </div>
                )}

                {/* Footer text removed */}

            </div>
        </div>
    );
};
