'use client';

import cn from '@/utils/cn';
import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import LoginModal from '@/components/login/login-modal';
import Link from 'next/link';
import ProfileButton from '@/components/xid/profile-button';

export default function ClassicLayout({
  children,
  contentClassName,
  hideTopNav = false,
}: React.PropsWithChildren<{ contentClassName?: string; hideTopNav?: boolean }>) {
  const { user, logout, isLoading } = useAuth();
  const pathname = usePathname();
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);

  // 只对chat、deep-research页面应用固定高度
  const isChatPage = pathname === '/chat';
  const isTweetDetailPage = pathname.startsWith('/tweet');
  const isDeepResearch = pathname.startsWith('/deep-research');
  const isFullScreenPage = isChatPage || isDeepResearch;
  const isHomePage = pathname === '/';

  // 管理 body 滚动，只对 chat 和 deep-research 页面禁用
  useEffect(() => {
    if (isFullScreenPage) {
      document.body.style.overflow = 'hidden';
      document.body.style.height = '100vh';
    } else {
      document.body.style.overflow = '';
      document.body.style.height = '';
    }

    return () => {
      document.body.style.overflow = '';
      document.body.style.height = '';
    };
  }, [isFullScreenPage]);

  const handleSignOut = async () => {
    await logout();
  };

  return (
    <div className={cn(
      isFullScreenPage ? 'h-screen overflow-hidden' : 'min-h-screen'
    )}>
      {/* Top Navigation Bar - 首页不显示，使用首页自己的导航栏 */}
      {!hideTopNav && !isHomePage && pathname !== '/credits' && (
        <nav className="sticky top-0 left-0 w-full bg-white/95 backdrop-blur-sm border-b border-gray-100 py-3 z-50">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center justify-between">
              {/* Logo */}
              <Link
                href="/"
                className="flex items-center gap-2 group cursor-pointer"
              >
                <span className="text-2xl font-bold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-gold-600 via-gold-500 to-yellow-400">
                  BNBot
                </span>
              </Link>

              {/* Right side - Login/User */}
              <div className="flex items-center gap-4">
                {isLoading ? (
                  <div className="h-9 w-20 bg-gray-100 rounded-full animate-pulse" />
                ) : user ? (
                  <ProfileButton
                    userData={user}
                    onSignOut={handleSignOut}
                    showUserInfo={false}
                    size="small"
                    menuDirection="bottom"
                  />
                ) : (
                  <button
                    onClick={() => setIsLoginModalOpen(true)}
                    className="px-5 py-2 bg-black text-white text-sm font-medium rounded-full hover:bg-gray-800 transition-colors"
                  >
                    Sign in
                  </button>
                )}
              </div>
            </div>
          </div>
        </nav>
      )}

      <main
        className={cn(
          isHomePage
            ? '' // 首页不需要特殊的高度计算
            : isChatPage || isDeepResearch
              ? 'h-[calc(100vh-57px)] overflow-hidden'
              : isTweetDetailPage
                ? 'h-[calc(100vh-57px)] overflow-hidden bg-white'
                : 'px-2 pb-4 pt-4 sm:px-4 sm:pb-6 lg:px-4 xl:pb-8 3xl:px-6',
          !isHomePage && (isFullScreenPage || isTweetDetailPage) ? '' : !isHomePage ? 'min-h-[calc(100vh-57px)]' : '',
          contentClassName,
        )}
      >
        {children}
      </main>

      {/* Login Modal */}
      <LoginModal
        isOpen={isLoginModalOpen}
        onClose={() => setIsLoginModalOpen(false)}
      />
    </div>
  );
}
