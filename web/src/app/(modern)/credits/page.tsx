'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { getPlanDisplayName } from '@/data/utils/stripe';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  ArrowPathIcon,
  ClipboardDocumentCheckIcon,
  ClipboardIcon,
  ArrowLeftIcon,
} from '@heroicons/react/24/outline';
import { useSubscription } from '@/hooks/useSubscription';
import { useAuth } from '@/lib/hooks/useAuth';
import { apiClient } from '@/lib/api-client';
import Skeleton from '@/components/ui/skeleton/skeleton';

const CREDITS_PER_INVITE = 100;

type CopyStatus = 'idle' | 'copied' | 'error';

// Skeleton component for loading state
function CreditsSkeleton() {
  return (
    <div className="relative min-h-screen overflow-hidden">
      {/* Background decorations */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-10 -left-10 w-48 h-48 bg-gold-200/20 rounded-full mix-blend-multiply filter blur-[60px]" />
        <div className="absolute bottom-0 right-0 w-[500px] h-[500px] bg-gold-200/20 rounded-full mix-blend-multiply filter blur-[120px] translate-x-1/4 translate-y-1/4" />
        <div className="absolute bottom-32 right-10 w-72 h-72 bg-yellow-100/20 rounded-full mix-blend-multiply filter blur-[80px]" />
      </div>

      <div className="relative z-10 mx-auto flex max-w-5xl flex-col gap-8 px-2 py-6 sm:px-4 lg:px-6">
        {/* Header skeleton */}
        <header className="space-y-2">
          <div className="h-9 w-32 animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700" />
          <div className="h-5 w-80 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
        </header>

        {/* Main content skeleton */}
        <section className="grid gap-6 md:grid-cols-2">
          {/* Balance card skeleton */}
          <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-gray-100 dark:bg-gray-900/60 dark:ring-gray-800/80">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="h-5 w-28 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
                <div className="mt-3 h-10 w-40 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
              </div>
              <div className="h-9 w-9 animate-pulse rounded-full bg-gray-200 dark:bg-gray-700" />
            </div>
            {/* Subscription skeleton */}
            <div className="mt-6 pt-6 border-t border-gray-100 dark:border-gray-800">
              <div className="flex justify-between items-center">
                <div>
                  <div className="h-5 w-24 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
                  <div className="mt-1 h-6 w-28 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
                </div>
                <div className="h-5 w-16 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
              </div>
            </div>
          </div>

          {/* Invite card skeleton */}
          <div className="flex flex-col gap-4 rounded-3xl bg-white p-6 shadow-sm ring-1 ring-gray-100 dark:bg-gray-900/60 dark:ring-gray-800/80">
            {/* Header */}
            <div>
              <div className="h-6 w-28 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
              <div className="mt-1 h-5 w-64 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
            </div>
            {/* Info box with stats */}
            <div className="rounded-2xl bg-gray-50 px-4 py-3 dark:bg-gray-800 space-y-2">
              <div className="flex justify-between">
                <div className="h-5 w-20 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
                <div className="h-5 w-6 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
              </div>
              <div className="flex justify-between">
                <div className="h-5 w-28 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
                <div className="h-5 w-6 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
              </div>
            </div>
            {/* Invite link section */}
            <div className="flex flex-col gap-2">
              <div className="h-4 w-20 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
              <div className="h-11 w-full animate-pulse rounded-2xl bg-gray-100 dark:bg-gray-800" />
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

export default function CreditsPage() {
  const [balance, setBalance] = useState(0);
  const [inviteCount, setInviteCount] = useState(0);
  const [inviteLink, setInviteLink] = useState('');
  const [copyStatus, setCopyStatus] = useState<CopyStatus>('idle');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const router = useRouter();
  const t = useTranslations('credits');
  const { isLoggedIn, isLoading } = useAuth();

  // Subscription status
  const {
    subscriptionTier,
    hasSubscription,
    isLoading: isLoadingSubscription,
  } = useSubscription();

  // 初始化：从 localStorage 恢复之前保存的数据
  useEffect(() => {
    try {
      const stored = localStorage.getItem('userData.bnbot');
      if (stored) {
        const parsed = JSON.parse(stored);
        console.log('📦 Loaded user data from localStorage:', parsed);

        if (typeof parsed.credits === 'number') {
          setBalance(parsed.credits);
        }
        if (typeof parsed.inviteCount === 'number') {
          setInviteCount(parsed.inviteCount);
        }

        // 恢复邀请链接
        const storedLink = localStorage.getItem('inviteLink.bnbot');
        if (storedLink) {
          console.log('📦 Loaded invite link from localStorage:', storedLink);
          setInviteLink(storedLink);
        }
      }
    } catch (error) {
      console.error('Failed to load from localStorage:', error);
    }
  }, []);

  const handleManageSubscription = () => {
    router.push('/pricing');
  };

  // 检查登录状态，未登录则跳转到主页
  useEffect(() => {
    if (!isLoggedIn && !isLoading) {
      router.replace('/agent');
    }
  }, [isLoggedIn, isLoading, router]);

  const fetchCredits = useCallback(async () => {
    try {
      setIsRefreshing(true);

      const data = await apiClient.get<{
        credits: number;
        inviteCount?: number;
        invitation_code?: string;
        invite_link?: string;
        [key: string]: any;
      }>('/api/v1/payments/credits');

      console.log('📊 Credits API response:', data);

      if (typeof data.credits === 'number') {
        setBalance(data.credits);
      }
      if (typeof data.inviteCount === 'number') {
        setInviteCount(data.inviteCount);
      }

      // 关键：优先使用 invitation_code，其次使用 invite_link
      let generatedLink = '';

      if (data.invitation_code) {
        generatedLink = `https://bnbot.ai/register?code=${data.invitation_code}`;
        console.log('✅ Generated invite link from invitation_code:', generatedLink);
        setInviteLink(generatedLink);
      } else if (typeof data.invite_link === 'string' && data.invite_link.length > 0) {
        generatedLink = data.invite_link.replace('http://localhost:3000', 'https://bnbot.ai').replace('invite_code=', 'code=');
        console.log('✅ Generated invite link from invite_link:', generatedLink);
        setInviteLink(generatedLink);
      } else {
        // 后端没有返回邀请码，尝试从 localStorage 恢复
        const stored = localStorage.getItem('inviteLink.bnbot');
        if (stored) {
          console.log('📦 Restored invite link from localStorage:', stored);
          setInviteLink(stored);
          generatedLink = stored;
        } else {
          // 如果后端还没实现邀请码生成，可以临时用 user_id 生成
          const tempCode = data.user_id ? data.user_id.substring(0, 12) : 'temp-' + Date.now();
          generatedLink = `https://bnbot.ai/register?code=${tempCode}`;
          console.warn('⚠️ No invitation_code from API, using generated code:', generatedLink);
          setInviteLink(generatedLink);
        }
      }

      // 保存用户数据到 localStorage（不包含 token）
      try {
        const userDataToStore = {
          // credits: data.credits, // Removed to avoid duplicate key
          inviteCount: data.inviteCount,
          invitation_code: data.invitation_code,
          invite_link: data.invite_link,
          user_id: data.user_id,
          email: data.email,
          // 保存其他字段
          ...data,
        };
        localStorage.setItem('userData.bnbot', JSON.stringify(userDataToStore));
        if (data.invitation_code) {
          localStorage.setItem('inviteLink.bnbot', `https://bnbot.ai/register?code=${data.invitation_code}`);
        }
        console.log('💾 Saved user data to localStorage');
      } catch (storageError) {
        console.error('⚠️ Failed to save to localStorage:', storageError);
      }
    } catch (error) {
      console.error('❌ Unable to refresh credits:', error);
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  // 初始化：当已登录时自动获取积分信息
  useEffect(() => {
    if (isLoggedIn && !isLoading) {
      fetchCredits();
    }
  }, [isLoggedIn, isLoading, fetchCredits]);

  const handleCopyInviteLink = async () => {
    if (!inviteLink) {
      return;
    }

    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(inviteLink);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = inviteLink;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setCopyStatus('copied');
      setTimeout(() => setCopyStatus('idle'), 2000);
    } catch (error) {
      console.error('Failed to copy invite link:', error);
      setCopyStatus('error');
      setTimeout(() => setCopyStatus('idle'), 2000);
    }
  };

  const earnedCredits = inviteCount * CREDITS_PER_INVITE;
  const pendingCredits = Math.max(earnedCredits - balance, 0);
  const formattedBalance = useMemo(() => {
    if (!Number.isFinite(balance)) {
      return '0';
    }
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(Math.floor(balance));
  }, [balance]);

  const formattedCreditsPerInvite = CREDITS_PER_INVITE.toLocaleString();
  const copyLabel =
    copyStatus === 'copied' ? t('copied') : copyStatus === 'error' ? t('retry') : t('copyLink');

  // Show skeleton while page is loading
  if (isLoading) {
    return <CreditsSkeleton />;
  }

  return (
    <div className="relative min-h-screen overflow-hidden">
      {/* Background decorations */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-10 -left-10 w-48 h-48 bg-gold-200/20 rounded-full mix-blend-multiply filter blur-[60px]" />
        <div className="absolute bottom-0 right-0 w-[500px] h-[500px] bg-gold-200/20 rounded-full mix-blend-multiply filter blur-[120px] translate-x-1/4 translate-y-1/4" />
        <div className="absolute bottom-32 right-10 w-72 h-72 bg-yellow-100/20 rounded-full mix-blend-multiply filter blur-[80px]" />
      </div>

      <div className="relative z-10 mx-auto flex max-w-5xl flex-col gap-8 px-2 py-6 sm:px-4 lg:px-6">
        <div>
          <button
            onClick={() => router.push('/')}
            className="group mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/80 shadow-sm backdrop-blur-sm transition-all hover:bg-white hover:shadow-md dark:bg-gray-800/80 dark:hover:bg-gray-700"
            aria-label="Back to Home"
          >
            <ArrowLeftIcon className="h-5 w-5 text-gray-600 transition-transform group-hover:-translate-x-0.5 dark:text-gray-300" />
          </button>
        </div>
        <header className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-white sm:text-4xl">
            {t('title')}
          </h1>
          <p className="text-sm text-gray-600 dark:text-gray-300 sm:text-base">
            {t('subtitle', { credits: formattedCreditsPerInvite })}
          </p>
        </header>

        <section className="grid gap-6 md:grid-cols-2">
          <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-gray-100 dark:bg-gray-900/60 dark:ring-gray-800/80">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400">{t('currentBalance')}</h2>
                <div className="mt-3 text-4xl font-semibold tracking-tight text-gray-900 dark:text-white">
                  {isRefreshing ? (
                    <Skeleton className="h-10 w-40" animation />
                  ) : (
                    <>
                      {formattedBalance}
                      <span className="ml-2 text-base font-medium text-gray-500 dark:text-gray-400">{t('credits')}</span>
                    </>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={fetchCredits}
                className="p-2 rounded-full text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition disabled:opacity-50 dark:text-gray-400 dark:hover:text-gray-200 dark:hover:bg-gray-800"
                disabled={isRefreshing}
                aria-label="Refresh"
              >
                <ArrowPathIcon className={`h-5 w-5 ${isRefreshing ? 'animate-spin' : ''}`} />
              </button>
            </div>

            {/* Subscription Status */}
            <div className="mt-6 pt-6 border-t border-gray-100 dark:border-gray-800">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">Subscription</h3>
                  {isLoadingSubscription ? (
                    <div className="mt-1">
                      <Skeleton className="h-6 w-32" animation />
                    </div>
                  ) : hasSubscription && subscriptionTier ? (
                    <div className="mt-1 flex items-center gap-2">
                      <span className="text-base font-semibold text-gray-900 dark:text-white">
                        {getPlanDisplayName(subscriptionTier)} Plan
                      </span>
                      <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
                        Active
                      </span>
                    </div>
                  ) : (
                    <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                      No active plan
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={handleManageSubscription}
                  className="text-sm font-medium text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white transition"
                >
                  {hasSubscription ? 'Manage' : 'Upgrade'}
                </button>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-4 rounded-3xl bg-white p-6 shadow-sm ring-1 ring-gray-100 dark:bg-gray-900/60 dark:ring-gray-800/80">
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{t('inviteAndEarn')}</h2>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                {t('inviteDescription')}
              </p>
            </div>

            <div className="rounded-2xl bg-gray-50 px-4 py-3 text-sm dark:bg-gray-800">
              <dl className="space-y-2">
                <div className="flex items-center justify-between">
                  <dt className="text-gray-500 dark:text-gray-400">{t('invitesConfirmed')}</dt>
                  <dd className="font-medium text-gray-700 dark:text-gray-100">
                    {isRefreshing ? <Skeleton className="h-5 w-10" animation /> : inviteCount}
                  </dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-gray-500 dark:text-gray-400">{t('creditsEarnedFromInvites')}</dt>
                  <dd className="font-medium text-gray-700 dark:text-gray-100">
                    {isRefreshing ? (
                      <Skeleton className="h-5 w-20" animation />
                    ) : (
                      earnedCredits.toLocaleString()
                    )}
                  </dd>
                </div>
              </dl>
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                {t('inviteLink')}
              </span>
              <div
                onClick={handleCopyInviteLink}
                className="flex items-center justify-between gap-2 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 cursor-pointer hover:bg-gray-100 transition dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-gray-700"
              >
                {isRefreshing || !inviteLink ? (
                  <Skeleton className="h-4 w-full" animation />
                ) : (
                  <span className="text-xs text-gray-600 dark:text-gray-300 truncate">
                    {inviteLink || t('inviteLinkPreparing')}
                  </span>
                )}
                {copyStatus === 'copied' ? (
                  <ClipboardDocumentCheckIcon className="h-4 w-4 flex-shrink-0 text-green-500" />
                ) : (
                  <ClipboardIcon className="h-4 w-4 flex-shrink-0 text-gray-400 dark:text-gray-500" />
                )}
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
