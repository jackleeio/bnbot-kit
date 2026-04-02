'use client';

import { useRef, useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { motion } from 'framer-motion';
import { useLocale, useTranslations } from 'next-intl';
import cn from '@/utils/cn';

import Logo from '@/components/ui/logo';
import LogoIcon from '@/components/ui/logo-icon';
import { MenuItem } from '@/components/ui/collapsible-menu';
// import Scrollbar from '@/components/ui/scrollbar';
import Button from '@/components/ui/button';
import { useDrawer } from '@/components/drawer-views/context';
import { useLayout } from '@/lib/hooks/use-layout';
import { Close } from '@/components/icons/close';
import { ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import { User, Languages, Globe, Menu as MenuIcon } from 'lucide-react';

import { useClickAway } from '@/lib/hooks/use-click-away';
import { defaultMenuItems } from '@/layouts/sidebar/_menu-items';
import routes from '@/config/routes';
import ProfileButton from '@/components/xid/profile-button';
import LoginModal from '@/components/login/login-modal';

import { LAYOUT_OPTIONS } from '@/lib/constants';

const layoutOption = '';
const sideBarMenuItems = defaultMenuItems.map((item) => ({
  name: item.name,
  icon: item.icon,
  href: item.href === '/' ? '/' : item.href,
  ...((item as any).dropdownItems && {
    dropdownItems: (item as any)?.dropdownItems?.map((dropdownItem: any) => ({
      name: dropdownItem.name,
      ...(dropdownItem?.icon && { icon: dropdownItem.icon }),
      href:
        item.name === 'Authentication'
          ? dropdownItem.href
          : dropdownItem.href,
    })),
  }),
}));

export default function Sidebar({
  className,
  userData,
  isLoading,
  onSignOut
}: {
  className?: string;
  userData?: any;
  isLoading?: boolean;
  onSignOut?: () => void;
}) {
  const router = useRouter();
  const { layout } = useLayout();
  const pathname = usePathname();
  const { closeDrawer } = useDrawer();
  const [open, setOpen] = useState(false);
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const [showLoginModalAfterSignout, setShowLoginModalAfterSignout] = useState(false);

  const locale = useLocale();
  const lang = locale as 'en' | 'zh';
  const t = useTranslations('sidebar');

  const handleLanguageChange = () => {
    const newLocale = lang === 'en' ? 'zh' : 'en';
    document.cookie = `NEXT_LOCALE=${newLocale}; path=/; max-age=31536000; SameSite=lax`;
    router.refresh(); // 软刷新，重新获取多语言文案但不做整页重载
  };

  const ref = useRef<HTMLElement>(null);
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // 桌面端hover自动展开
  const handleMouseEnter = () => {
    // 清除可能存在的关闭定时器
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    setOpen(true);
  };

  const handleMouseLeave = () => {
    // 立即关闭，不需要延迟
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    setOpen(false);
  };

  // 清理定时器
  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
      }
    };
  }, []);

  useClickAway(ref, () => {
    if (open) {
      setOpen(false);
    }
  });

  // 键盘快捷键支持
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && open) {
        setOpen(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  function isSubMenuActive(
    submenu: Array<{ name: string; icon?: JSX.Element; href: string }>,
  ) {
    return submenu?.map((item) => item.href).includes(pathname);
  }

  return (
    <>
      <aside
        ref={ref}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        style={{ willChange: 'width, box-shadow' }}
        className={cn(
          open
            ? 'border-0 shadow-lg xs:w-56 xl:w-62 2xl:w-70'
            : 'w-12 border-solid border-gray-200 ltr:border-r-[0.5px] rtl:border-l-[0.5px] 2xl:w-14',
          'top-0 z-[60] h-full max-w-full bg-body ltr:left-0 rtl:right-0 dark:border-gray-700 dark:bg-dark xl:fixed',
          'transition-[width,box-shadow] duration-150 ease-out',
          className,
        )}
      >
      <div
        className={cn(
          'relative flex h-16 items-center overflow-hidden px-2 py-3 2xl:px-3',
          !open && 'justify-center'
        )}
      >
        {/* 切换按钮和Logo */}
        <div className="flex items-center">
          <button
            onClick={() => setOpen(!open)}
            className={cn(
              "group relative flex h-7 w-7 items-center justify-center rounded-md hover:bg-gray-100/80 transition-all duration-200",
              open ? "mr-3" : ""
            )}
          >
            {open ? (
              <ChevronLeftIcon className="h-3.5 w-3.5 text-gray-500 transition-all duration-200 group-hover:text-gray-700" />
            ) : (
              <>
                <MenuIcon className="h-3.5 w-3.5 text-gray-500 transition-all duration-200 group-hover:opacity-0 group-hover:scale-90" />
                <ChevronRightIcon className="absolute h-3.5 w-3.5 text-gray-700 transition-all duration-200 opacity-0 scale-90 group-hover:opacity-100 group-hover:scale-100" />
              </>
            )}
          </button>
          
          {/* Logo只在展开时显示 */}
          {open && <Logo />}
        </div>

        <div className="md:hidden">
          <Button
            title={t('close')}
            color="white"
            shape="circle"
            variant="transparent"
            size="small"
            onClick={closeDrawer}
          >
            <Close className="h-auto w-2.5" />
          </Button>
        </div>
      </div>

      <div
        className={cn(
          'custom-scrollbar overflow-hidden overflow-y-auto',
          open ? 'h-[calc(100%-140px)]' : 'h-[calc(100%-120px)]',
        )}
      >
        <div className="px-2 pb-5 2xl:px-3">
          {!open ? (
            <div className="mt-4 2xl:mt-6">
              {sideBarMenuItems.map((item, index) => (
                <MenuItem
                  isActive={
                    item.href === pathname ||
                    isSubMenuActive(item.dropdownItems!)
                  }
                  key={'drawer' + item.name + index}
                  href={item.href}
                  icon={item.icon}
                  isCollapsed={true}
                />
              ))}
            </div>
          ) : (
            <div className="mt-4 2xl:mt-6">
              {sideBarMenuItems.map((item, index) => (
                <MenuItem
                  key={'drawer-full' + item.name + index}
                  name={item.name}
                  href={item.href}
                  icon={item.icon}
                  dropdownItems={item.dropdownItems}
                />
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="sticky bottom-3 mt-2 2xl:mt-6">
        <div className="px-2 pb-2 2xl:px-3">
            <div
              onClick={handleLanguageChange}
              className={cn(
                'font-bolder relative flex h-8 cursor-pointer items-center whitespace-nowrap rounded-3xl rounded-none px-1.5 text-xs text-gray-500 transition-all hover:text-gray-700 mb-2',
              )}
            >
              <div className="absolute left-2 top-[47%] z-[2] flex items-center justify-center -translate-y-1/2 w-4 h-4">
                {/* Custom Icon: A on top, 文 on bottom */}
                <Languages 
                  size={16} 
                  className={cn("transition-transform duration-300", lang === 'zh' && "-scale-x-100")} 
                />
              </div>
              {open && (
                <div className="relative z-[1] pl-8 flex items-center">
                  <div className="flex items-center bg-gray-100 rounded-full p-0.5">
                    <span 
                      className={cn(
                        "px-2 py-0.5 rounded-full text-[10px] transition-all duration-200", 
                        lang === 'en' ? "bg-white shadow-sm text-gray-900 font-medium" : "text-gray-400"
                      )}
                    >
                      EN
                    </span>
                    <span 
                      className={cn(
                        "px-2 py-0.5 rounded-full text-[10px] transition-all duration-200", 
                        lang === 'zh' ? "bg-white shadow-sm text-gray-900 font-medium" : "text-gray-400"
                      )}
                    >
                      CN
                    </span>
                  </div>
                </div>
              )}
            </div>
        </div>

        {/* 固定高度容器，防止登录按钮显示/隐藏或尺寸变化导致上方元素跳动 */}
        <div className="h-10 px-3 flex items-center">
          {isLoading ? (
            // 加载状态：显示骨架屏
            <div className="w-full h-8 rounded-full bg-gray-200 dark:bg-gray-700 flex-shrink-0 animate-pulse" />
          ) : userData ? (
            <ProfileButton
              userData={userData}
              onSignOut={() => {
                if (onSignOut) {
                  onSignOut();
                }
                // 登出后显示登录modal
                setShowLoginModalAfterSignout(true);
              }}
              showUserInfo={open}
              size="small"
              menuDirection="top"
            />
          ) : (
            <Button
              onClick={() => setIsLoginModalOpen(true)}
              className={`bg-[#f0b90b] text-white font-medium rounded-full duration-300 ease-in-out border border-[#f0b90b] flex flex-row flex-nowrap items-center justify-center relative transition-all ${
                open
                  ? 'w-full !h-9 px-3 text-sm'
                  : 'w-8 !h-8 p-0 flex-shrink-0'
              }`}
              size="small"
              title={!open ? t('signIn') : undefined}
            >
              {open ? (
                <span className="whitespace-nowrap">
                  {t('signIn')}
                </span>
              ) : (
                <User size={16} />
              )}
            </Button>
          )}
        </div>
      </div>

      </aside>
      
      {/* 登录模态框 - 使用 Portal 渲染在 body 外层 */}
      <LoginModal
        isOpen={isLoginModalOpen || showLoginModalAfterSignout}
        onClose={() => {
          setIsLoginModalOpen(false);
          setShowLoginModalAfterSignout(false);
        }}
      />
    </>
  );
}
