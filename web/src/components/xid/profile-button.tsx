'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { getPlanDisplayName } from '@/data/utils/stripe';
import { useRouter } from 'next/navigation';
import { useDrawer } from '@/components/drawer-views/context';
import { useTranslations } from 'next-intl';
import { Transition } from '@/components/ui/transition';
import { PowerIcon } from '@/components/icons/power';
import { SparklesIcon, CreditCardIcon } from '@heroicons/react/24/outline';
import Image from 'next/image';
import bnbotAILogo from '@/assets/images/logo/bnbot-ai.jpg';
import { useSubscription } from '@/hooks/useSubscription';
import { apiClient } from '@/lib/api-client';


interface ProfileButtonProps {
  userData: any;
  onSignOut?: () => void;
  showUserInfo?: boolean;
  size?: 'small' | 'medium' | 'large';
  menuDirection?: 'top' | 'bottom' | 'right' | 'auto';
  compact?: boolean; // 是否为紧凑模式（如侧边栏收起状态）
  forceDark?: boolean; // 强制深色主题（用于深色背景页面如首页）
}

export default function ProfileButton({ userData, onSignOut, showUserInfo = false, size = 'medium', menuDirection = 'auto', compact = false, forceDark = false }: ProfileButtonProps) {
  const [mounted, setMounted] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const router = useRouter();
  const { closeDrawer } = useDrawer();
  const t = useTranslations('profile');
  const [creditsBalance, setCreditsBalance] = useState<number | null>(
    typeof userData?.credits === 'number' ? userData.credits : null,
  );
  const [isFetchingCredits, setIsFetchingCredits] = useState(false);
  const { subscriptionTier, hasSubscription, isLoading: isLoadingSubscription } = useSubscription();
  const isMountedRef = useRef(true);
  const formattedCredits = useMemo(() => {
    if (typeof creditsBalance !== 'number' || Number.isNaN(creditsBalance)) {
      return null;
    }
    return Math.round(creditsBalance).toLocaleString();
  }, [creditsBalance]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 640);
    };

    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    if (typeof userData?.credits === 'number') {
      setCreditsBalance(userData.credits);
    }
  }, [userData]);

  const fetchLatestCredits = useCallback(async () => {
    try {
      setIsFetchingCredits(true);

      const data = await apiClient.get<{
        credits: number;
        inviteCount?: number;
        invite_link?: string;
      }>('/api/v1/payments/credits');

      if (!isMountedRef.current) {
        return;
      }

      if (typeof data.credits === 'number') {
        setCreditsBalance(data.credits);

        try {
          const stored = localStorage.getItem('userData.bnbot');
          if (stored) {
            const parsed = JSON.parse(stored);
            parsed.credits = data.credits;
            if (typeof data.inviteCount === 'number') {
              parsed.inviteCount = data.inviteCount;
            }
            if (typeof data.invite_link === 'string' && data.invite_link.length > 0) {
              parsed.invite_link = data.invite_link;
            }
            localStorage.setItem('userData.bnbot', JSON.stringify(parsed));
          }
        } catch (error) {
          console.error('Failed to update cached user data with credits:', error);
        }
      }
    } catch (error) {
      // 静默处理错误，不影响用户体验
      console.error('Unable to refresh credits balance:', error);
    } finally {
      if (isMountedRef.current) {
        setIsFetchingCredits(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!mounted) return;
    fetchLatestCredits();
  }, [mounted, fetchLatestCredits]);

  const navigateTo = (path: string) => {
    router.push(path);
    closeDrawer();
  };

  const handleSignOut = () => {
    console.log('ProfileButton handleSignOut called');
    if (onSignOut) {
      console.log('Calling parent onSignOut');
      onSignOut();
    }
    // 默认登出行为
    localStorage.removeItem('userData.bnbot');
    closeDrawer();
    setIsHovered(false);
  };

  const handleMouseEnter = () => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }
    setIsHovered(true);
    fetchLatestCredits();
  };

  const handleMouseLeave = () => {
    hoverTimeoutRef.current = setTimeout(() => {
      setIsHovered(false);
    }, 150);
  };

  // 尺寸映射
  const sizeClasses = {
    small: 'h-8 w-8',
    medium: 'h-11 w-11',
    large: 'h-14 w-14'
  };

  if (!mounted) {
    // 显示骨架屏占位符，确保高度一致
    return (
      <div className="flex items-start gap-3">
        <div className={`${sizeClasses[size]} rounded-full bg-gray-200 dark:bg-gray-700 flex-shrink-0 animate-pulse`} />
      </div>
    );
  }

  // 确定菜单弹出方向
  const getMenuPosition = () => {
    if (isMobile) {
      // 移动端侧边栏底部，菜单从左下角向上弹出
      return 'left-0 bottom-full mb-2 w-[220px] shadow-large origin-bottom-left';
    }

    // 如果指定向下弹出（用于 header）
    if (menuDirection === 'bottom') {
      return 'right-0 top-full mt-2 w-48 shadow-large origin-top-right';
    }

    // 统一菜单位置 - 始终从头像左侧向上弹出
    return 'left-0 bottom-full mb-2 w-48 shadow-large origin-bottom-left';
  };

  return (
    <div className="relative">
      <div
        className={`flex items-start gap-3 ${showUserInfo ? (isMobile ? 'cursor-pointer' : 'cursor-pointer hover:bg-gray-50/50 dark:hover:bg-gray-800/50 rounded-lg p-1 -m-1') : ''}`}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <div className="relative mt-1">
          {/* Avatar */}
          <div
            className={`relative ${sizeClasses[size]} flex-shrink-0 cursor-pointer overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`https://api.dicebear.com/7.x/thumbs/png?seed=${userData?.email || 'user'}&size=64`}
              alt="avatar"
              className="h-full w-full object-cover rounded-full"
              draggable={false}
            />
          </div>

          {/* Hover Menu */}
          <Transition
            show={isHovered}
            enter="ease-out duration-200"
            enterFrom={menuDirection === 'bottom' ? 'opacity-0 -translate-y-2' : 'opacity-0 translate-y-4'}
            enterTo="opacity-100 translate-y-0"
            leave="ease-in duration-100"
            leaveFrom="opacity-100 translate-y-0"
            leaveTo={menuDirection === 'bottom' ? 'opacity-0 -translate-y-2' : 'opacity-0 translate-y-4'}
          >
            <div
              className={`absolute rounded-3xl z-50 ${forceDark ? 'bg-[#111827] border border-white/10' : 'bg-white dark:bg-gray-900'} ${getMenuPosition()}`}
            >
              <div className="p-2">
                <div
                  className={`flex cursor-pointer items-center rounded-3xl px-3 py-2 text-sm font-medium transition ${forceDark ? 'text-white hover:bg-white/10' : 'text-gray-900 hover:bg-gray-50 dark:text-white dark:hover:bg-gray-800'}`}
                  onClick={() => navigateTo('/credits')}
                >
                  <div className="flex items-center gap-3">
                    <SparklesIcon className="h-4 w-4" />
                    <span className="flex items-center gap-2">
                      <span className="whitespace-nowrap">{t('credits')}</span>
                      {isFetchingCredits ? (
                        <span className="skeleton h-5 w-14 rounded-full" />
                      ) : (
                        <span className={`inline-flex min-w-[60px] items-center justify-center rounded-full px-2 py-0.5 text-xs font-semibold transition-opacity ${forceDark ? 'bg-white/10 text-gray-200' : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-200'} ${isFetchingCredits ? 'opacity-60' : ''}`}>
                          {formattedCredits ?? '--'}
                        </span>
                      )}
                    </span>
                  </div>
                </div>
                <div
                  className={`flex cursor-pointer items-center rounded-3xl px-3 py-2 text-sm font-medium transition ${forceDark ? 'text-white hover:bg-white/10' : 'text-gray-900 hover:bg-gray-50 dark:text-white dark:hover:bg-gray-800'}`}
                  onClick={() => navigateTo('/pricing')}
                >
                  <div className="flex items-center gap-3">
                    <CreditCardIcon className="h-4 w-4" />
                    <span className="flex items-center gap-2">
                      <span className="whitespace-nowrap">Plan</span>
                      {isLoadingSubscription ? (
                        <span className="skeleton h-5 w-14 rounded-full" />
                      ) : hasSubscription && subscriptionTier ? (
                        <span className={`inline-flex items-center justify-center rounded-full px-2 py-0.5 text-xs font-semibold ${forceDark ? 'bg-green-900/30 text-green-400' : 'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400'}`}>
                          {getPlanDisplayName(subscriptionTier)}
                        </span>
                      ) : (
                        <span className={`inline-flex items-center justify-center rounded-full px-2 py-0.5 text-xs font-semibold ${forceDark ? 'bg-white/10 text-gray-400' : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'}`}>
                          Free
                        </span>
                      )}
                    </span>
                  </div>
                </div>
                <div
                  className={`flex cursor-pointer items-center rounded-3xl px-3 py-2 text-sm font-medium transition ${forceDark ? 'text-white hover:bg-white/10' : 'text-gray-900 hover:bg-gray-50 dark:text-white dark:hover:bg-gray-800'}`}
                  onClick={handleSignOut}
                >
                  <div className="flex items-center gap-3">
                    <PowerIcon className="h-4 w-4" />
                    <span>{t('signOut')}</span>
                  </div>
                </div>
              </div>
            </div>
          </Transition>
        </div>

        {/* 显示用户信息 */}
        {showUserInfo && userData && (
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-gray-900 dark:text-white truncate opacity-0 animate-fade-in" style={{
              animation: 'fadeIn 0.3s ease-in-out 0.1s forwards'
            }}>
              {userData.full_name || userData.name || '用户'}
            </div>
            <div className="text-[11px] text-gray-500 dark:text-gray-400 truncate opacity-0 animate-fade-in" style={{
              animation: 'fadeIn 0.3s ease-in-out 0.2s forwards'
            }}>
              {userData.email || 'user@example.com'}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
