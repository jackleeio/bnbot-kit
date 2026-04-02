'use client';

import Logo from '@/components/ui/logo';
import cn from '@/utils/cn';
import { FlashIcon } from '@/components/icons/flash';
// import ActiveLink from '@/components/ui/links/active-link';
import Hamburger from '@/components/ui/hamburger';
import WalletConnect from '@/components/wallet/wallet-connect';
import { useIsMounted } from '@/lib/hooks/use-is-mounted';
import { useBreakpoint } from '@/lib/hooks/use-breakpoint';
import { useDrawer } from '@/components/drawer-views/context';
import { useWindowScroll } from '@/lib/hooks/use-window-scroll';
import { useLayout } from '@/lib/hooks/use-layout';
import routes from '@/config/routes';
import { LAYOUT_OPTIONS } from '@/lib/constants';
import NetworkSelector from '@/components/xid/network-selector';
import { useState, useEffect } from 'react';
import ethLogo from '@/assets/images/logo-eth-color.png';
import { LinkIcon } from '@heroicons/react/24/outline';
import { useRouter, usePathname } from 'next/navigation';
import { useAccount } from 'wagmi';
import { GoogleIcon } from '@/components/icons/google';
import ProfileButton from '@/components/xid/profile-button';
import LoginModal from '@/components/login/login-modal';
import { MenuItems } from '@/layouts/sidebar/_layout-menu';
import { useAuth } from '@/lib/hooks/useAuth';

// function NotificationButton() {
//   const isMounted = useIsMounted();
//   const { layout } = useLayout();
//   return (
//     isMounted && (
//       <ActiveLink
//         href={
//           '/' +
//           (layout === LAYOUT_OPTIONS.MODERN ? '' : layout) +
//           routes.notification
//         }
//       >
//         <div className="relative flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-full border border-gray-100 bg-white text-brand shadow-main transition-all hover:-translate-y-0.5 hover:shadow-large focus:-translate-y-0.5 focus:shadow-large focus:outline-none dark:border-gray-700 dark:bg-light-dark dark:text-white sm:h-12 sm:w-12">
//           <FlashIcon className="h-auto w-3 sm:w-auto" />
//           <span className="absolute right-0 top-0 h-2.5 w-2.5 rounded-full bg-brand shadow-light dark:bg-white sm:h-3 sm:w-3" />
//         </div>
//       </ActiveLink>
//     )
//   );
// }

function HeaderRightArea() {
  const [mounted, setMounted] = useState(false);
  const breakpoint = useBreakpoint();
  const { openDrawer, isOpen } = useDrawer();
  const [showLoginModal, setShowLoginModal] = useState(false);
  const router = useRouter();
  const { address } = useAccount();
  const pathname = usePathname();
  const { user, logout, isLoading } = useAuth();
  const hideMenuButton = pathname?.startsWith('/boost');

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleXIDClick = () => {
    router.push('/create');
  };

  const handleSignOut = async () => {
    // 调用 logout 来清除前端状态和 cookie
    await logout();
  };

  return (
    <div className="order-last flex shrink-0 items-center">
      <div className="flex hidden items-center gap-6 lg:flex 2xl:gap-4">
        {/* <NetworkSelector /> */}
        {/* {mounted && <WalletConnect />} */}

        {mounted && (
          isLoading ? (
            // 加载状态：显示骨架屏
            <div className="flex items-start gap-3">
              <div className="h-11 w-11 rounded-full bg-gray-200 dark:bg-gray-700 flex-shrink-0 animate-pulse" />
            </div>
          ) : user ? (
            <ProfileButton
              userData={user}
              onSignOut={handleSignOut}
            />
          ) : (
            <button
              onClick={() => setShowLoginModal(true)}
              className="relative h-12 w-12 flex-shrink-0 cursor-pointer overflow-hidden rounded-full transition-all hover:-translate-y-0.5"
            >
              <div className="flex h-full w-full items-center justify-center bg-gray-100">
                <GoogleIcon className="relative h-5 w-5 text-gray-500" />
              </div>
            </button>
          )
        )}
      </div>

      {!hideMenuButton && (
        <div className="flex items-center lg:hidden">
          <Hamburger
            isOpen={isOpen}
            onClick={() => openDrawer('DRAWER_MENU')}
            color="white"
            className="shadow-main ltr:ml-3.5 ltr:sm:ml-5 rtl:mr-3.5 rtl:sm:mr-5"
          />
        </div>
      )}
      
      <LoginModal 
        isOpen={showLoginModal}
        onClose={() => setShowLoginModal(false)}
      />
    </div>
  );
}

export function Header() {
  const isMounted = useIsMounted();
  const breakpoint = useBreakpoint();
  const windowScroll = useWindowScroll();
  const { openDrawer, isOpen } = useDrawer();
  const pathname = usePathname();
  const hideMenuButton = pathname?.startsWith('/boost');
  return (
    <nav
      // sticky top-0 z-30
      //         isMounted && windowScroll.y > 17
      // ? 'h-16 sm:h-24'
      // : 'h-16 sm:h-24',
      className={cn(
        'flex h-16 w-full items-center justify-between bg-white px-4 transition-all duration-300 sm:h-20 sm:px-6 lg:px-8 3xl:px-10 ltr:right-0 rtl:left-0',
      )}
    >
      <div className="mx-auto flex w-full max-w-[2160px] items-center justify-between">
        <div className="flex items-center">
          {!hideMenuButton && (
            <div className="hidden lg:mr-6 lg:block xl:hidden">
              <Hamburger
                isOpen={isOpen}
                onClick={() => openDrawer('DRAWER_MENU')}
                color="white"
                className="shadow-main"
              />
            </div>
          )}
          <Logo className="md:ml-5" />
          {/* {isMounted && ['xs', 'sm', 'md', 'lg'].indexOf(breakpoint) == -1 && (
            <MenuItems />
          )} */}
        </div>
      </div>
    </nav>
  );
}

export default function MinimalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkIfMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    
    checkIfMobile();
    window.addEventListener('resize', checkIfMobile);
    
    return () => window.removeEventListener('resize', checkIfMobile);
  }, []);

  // 判断是否显示 Header
  const shouldShowHeader = !(isMobile && pathname === '/xInsight');

  return (
    <>
      {shouldShowHeader && <Header />}
      {/* min-h-screen  */}
      {/* px-4 sm:px-6 lg:px-8 3xl:px-10 */}
      <div className="bg-light-100 flex flex-col gap-6">
        <main className="mx-auto mb-0 flex w-full max-w-[2160px] flex-grow flex-col @container">
          {children}
        </main>
      </div>
    </>
  );
}
