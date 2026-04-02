'use client';

import { Fragment, useEffect, useState } from 'react';
import Logo from '@/components/ui/logo';
import Button from '@/components/ui/button';
import ActiveLink from '@/components/ui/links/active-link';
import { Close } from '@/components/icons/close';
import { useDrawer } from '@/components/drawer-views/context';
import { ChevronDown } from '@/components/icons/chevron-down';
import { MenuItem } from '@/components/ui/collapsible-menu';
import {
  MinimalMenuItems,
  defaultMenuItems,
} from '@/layouts/sidebar/_menu-items';
import { LAYOUT_OPTIONS } from '@/lib/constants';
import { ChevronRight } from '@/components/icons/chevron-right';
import WalletConnect from '@/components/wallet/wallet-connect';
import { XIcon } from '@/components/icons/x-icon';
import { LinkIcon } from '@heroicons/react/24/outline';
import { useRouter } from 'next/navigation';
import { useAccount } from 'wagmi';
import ProfileButton from '@/components/xid/profile-button';
import LoginModal from '@/components/login/login-modal';
import { useLocale } from 'next-intl';
import { Languages } from 'lucide-react';
import cn from '@/utils/cn';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface MenuItemType {
  name: string;
  icon: React.ReactElement;
  href: string;
  dropdownItems?: {
    name: string;
    icon?: React.ReactElement;
    href: string;
    dropdownItems?: {
      name: string;
      icon?: React.ReactElement;
      href: string;
    }[];
  }[];
}

const layoutOption = '';
const minimalMenuItems = MinimalMenuItems.map((item) => ({
  name: item.name,
  icon: item.icon,
  href: item.href === '/' ? '/' : item.href,
  ...((item as any).dropdownItems && {
    dropdownItems: (item as any)?.dropdownItems?.map((dropdownItem: any) => ({
      name: dropdownItem.name,
      ...(dropdownItem?.icon && { icon: dropdownItem.icon }),
      href: dropdownItem.href,
      ...((item as any).dropdownItems && {
        dropdownItems: dropdownItem?.dropdownItems?.map((subItem: any) => ({
          name: subItem.name,
          ...(subItem?.icon && { icon: subItem.icon }),
          href: subItem.href,
        })),
      }),
    })),
  }),
}));

export function MenuItems() {
  return (
    <div className="flex items-center xl:px-4 2xl:px-6 3xl:px-8">
      <ul className="relative flex items-center gap-4 2xl:gap-6">
        {minimalMenuItems.map((item, index) => (
          <Fragment key={'layout' + item.name + index}>
            {item.dropdownItems && item.dropdownItems.length > 0 ? (
              <>
                <li className="group/parent relative">
                  <a
                    href="#"
                    className="flex items-center text-sm font-medium uppercase text-gray-600 transition hover:text-gray-900 dark:text-gray-300 dark:hover:text-white"
                  >
                    {item.name}
                    <span className="z-[1] transition-transform duration-200 ltr:ml-3 rtl:mr-3">
                      <ChevronDown />
                    </span>
                  </a>
                  <ul className="invisible absolute right-0 top-[130%] mt-2 w-64 rounded-lg bg-white p-3 opacity-0 shadow-large transition-all group-hover/parent:visible group-hover/parent:top-full group-hover/parent:opacity-100 dark:bg-gray-800 ltr:right-0 rtl:left-0">
                    {item.dropdownItems.map((dropDownItem: any, index: number) => (
                      <li
                        className="group relative"
                        key={dropDownItem.name + index}
                      >
                        {dropDownItem.dropdownItems ? (
                          <>
                            <a
                              href="#"
                              className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm font-medium uppercase text-gray-600 transition hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-700/50 dark:hover:text-white"
                            >
                              {dropDownItem.name}
                              <span className="z-[1] -mt-1 transition-transform duration-200 ltr:ml-3 rtl:mr-3">
                                <ChevronRight className="h-3.5 w-3.5" />
                              </span>
                            </a>
                            <ul className="invisible absolute left-[107%] right-0 top-[130%] w-64 rounded-lg bg-white p-3 opacity-0 shadow-large transition-all group-hover:visible group-hover/parent:top-0 group-hover:opacity-100 dark:bg-gray-800 ltr:right-0 rtl:left-0">
                              {dropDownItem.dropdownItems.map(
                                (subMenu: any, index: number) => (
                                  <li key={subMenu.name + index}>
                                    <ActiveLink
                                      href={subMenu.href}
                                      className="block rounded-lg px-3 py-2 text-sm font-medium uppercase !text-gray-600 transition hover:bg-gray-50 hover:text-gray-900 dark:!text-white dark:hover:bg-gray-700/50"
                                      activeClassName="!bg-gray-100 dark:!bg-gray-700 my-1 last:mb-0 first:mt-0 !text-gray-900 dark:!text-white"
                                    >
                                      {subMenu.name}
                                    </ActiveLink>
                                  </li>
                                ),
                              )}
                            </ul>
                          </>
                        ) : (
                          <ActiveLink
                            href={dropDownItem.href}
                            className="block rounded-lg px-3 py-2 text-sm font-medium uppercase !text-gray-600 transition hover:bg-gray-50 hover:text-gray-900 dark:!text-white dark:hover:bg-gray-700/50"
                            activeClassName="!bg-gray-100 dark:!bg-gray-700 my-1 last:mb-0 first:mt-0 !text-gray-900 dark:!text-white"
                          >
                            {dropDownItem.name}
                          </ActiveLink>
                        )}
                      </li>
                    ))}
                  </ul>
                </li>
              </>
            ) : (
              <li className="relative group">
                {['X Money', 'X ID'].includes(item.name) ? (
                  <a
                    href={item.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mx-21 px-0.5 text-[13px] font-medium text-gray-500 transition first:ml-0 last:mr-0 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white 2xl:mx-3 2xl:text-sm 3xl:mx-4"
                  >
                    {item.name}
                  </a>
                ) : item.name === 'Agent' ? (
                  <ActiveLink
                    href={item.href}
                    className="mx-21 px-0.5 text-[13px] font-medium text-gray-500 transition first:ml-0 last:mr-0 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white 2xl:mx-3 2xl:text-sm 3xl:mx-4"
                    activeClassName="!text-black dark:!text-white"
                  >
                    {item.name}
                  </ActiveLink>
                ) : item.name === 'Boost' ? (
                  <TooltipProvider>
                    <Tooltip delayDuration={0}>
                      <TooltipTrigger asChild>
                        <span
                          className="mx-21 px-0.5 text-[13px] font-medium text-gray-500 transition first:ml-0 last:mr-0 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white 2xl:mx-3 2xl:text-sm 3xl:mx-4 cursor-not-allowed relative"
                          onClick={(e) => e.preventDefault()}
                        >
                          {item.name}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="right" className="z-[9999]">
                        <p>Coming Soon</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                ) : (
                  <TooltipProvider>
                    <Tooltip delayDuration={0}>
                      <TooltipTrigger asChild>
                        <span className="mx-21 px-0.5 text-[13px] font-medium text-gray-500 transition first:ml-0 last:mr-0 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white 2xl:mx-3 2xl:text-sm 3xl:mx-4 cursor-pointer">
                          {item.name}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="right" className="z-[9999]">
                        <p>Coming Soon</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
              </li>
            )}
          </Fragment>
        ))}
      </ul>
    </div>
  );
}

interface DrawerMenuProps {
  layoutOption?: string;
  menuItems?: any[];
  userData?: any;
  onSignOut?: () => void;
}

export default function DrawerMenu({
  layoutOption = `/${LAYOUT_OPTIONS.MINIMAL}`,
  menuItems = defaultMenuItems,
  userData: propUserData,
  onSignOut: propOnSignOut,
}: DrawerMenuProps) {
  const { closeDrawer } = useDrawer();
  const [mounted, setMounted] = useState(false);
  const [userData, setUserData] = useState<any>(propUserData || null);
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const router = useRouter();
  const { address } = useAccount();

  const locale = useLocale();
  const lang = locale as 'en' | 'zh';

  const handleLanguageChange = () => {
    const newLocale = lang === 'en' ? 'zh' : 'en';
    document.cookie = `NEXT_LOCALE=${newLocale}; path=/; max-age=31536000; SameSite=lax`;
    router.refresh();
  };

  useEffect(() => {
    setMounted(true);
    if (propUserData) {
      setUserData(propUserData);
    } else {
      const storedUserData = localStorage.getItem('userData.bnbot');
      if (storedUserData) {
        setUserData(JSON.parse(storedUserData));
      }
    }
  }, [propUserData]);

  const handleXIDClick = () => {
    router.push('/create');
    closeDrawer();
  };

  const handleSignOut = () => {
    if (propOnSignOut) {
      propOnSignOut();
    } else {
      localStorage.removeItem('userData.bnbot');
      localStorage.removeItem('accessToken.bnbot');
      localStorage.removeItem('refreshToken.bnbot');
      setUserData(null);
    }
    // 不再跳转到登录页面，让ProfileButton组件处理登录modal的显示
  };

  const drawerMenuItems = menuItems.map((item) => ({
    name: item.name,
    icon: item.icon,
    href: item.href === '/' ? '/' : item.href,
    ...(item.dropdownItems && {
      dropdownItems: item?.dropdownItems?.map((dropdownItem: any) => ({
        name: dropdownItem.name,
        ...(dropdownItem?.icon && { icon: dropdownItem.icon }),
        href: dropdownItem.href,
      })),
    }),
  }));

  return (
    <div className="relative w-full max-w-full bg-white dark:bg-dark xs:w-80">
      <div className="flex h-16 items-center overflow-hidden px-4 py-4">
        <Logo />
      </div>

      <div className="custom-scrollbar h-[calc(100%-190px)] overflow-hidden overflow-y-auto">
        <div className="px-4 pb-14 2xl:px-8">
          <div className="mt-4 sm:mt-4">
            {drawerMenuItems?.map((item, index) => (
              <MenuItem
                key={'drawer' + item.name + index}
                name={item.name}
                href={item.href}
                icon={item.icon}
                dropdownItems={item.dropdownItems}
              />
            ))}
          </div>
        </div>
      </div>

      {/* 底部区域 */}
      <div className="absolute bottom-0 left-0 right-0 bg-white dark:bg-dark p-4">
        {/* 语言切换按钮 */}
        <div
          onClick={handleLanguageChange}
          className="flex cursor-pointer items-center justify-between rounded-lg px-2 py-2 mb-3 hover:bg-gray-50 transition-colors"
        >
          <div className="flex items-center gap-2 text-gray-600">
            <Languages
              size={18}
              className={cn("transition-transform duration-300", lang === 'zh' && "-scale-x-100")}
            />
            <span className="text-sm">Language</span>
          </div>
          <div className="flex items-center bg-gray-100 rounded-full p-0.5">
            <span
              className={cn(
                "px-2.5 py-1 rounded-full text-xs transition-all duration-200",
                lang === 'en' ? "bg-white shadow-sm text-gray-900 font-medium" : "text-gray-400"
              )}
            >
              EN
            </span>
            <span
              className={cn(
                "px-2.5 py-1 rounded-full text-xs transition-all duration-200",
                lang === 'zh' ? "bg-white shadow-sm text-gray-900 font-medium" : "text-gray-400"
              )}
            >
              CN
            </span>
          </div>
        </div>

        {/* 登录状态区域 */}
        {userData ? (
          <ProfileButton
            userData={userData}
            onSignOut={handleSignOut}
            showUserInfo={true}
            size="small"
            menuDirection="top"
          />
        ) : (
          <div className="flex items-center justify-between gap-3">
            <Button
              onClick={() => setIsLoginModalOpen(true)}
              className="bg-[#f0b90b] text-white font-medium rounded-full duration-200 ease-in-out border border-[#f0b90b] w-full h-11 px-4 text-sm transition-colors hover:bg-[#d9a309]"
              size="medium"
            >
              <div className="flex items-center justify-center">
                <svg className="w-4 h-4 mr-2 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
                <span>Sign in</span>
              </div>
            </Button>
          </div>
        )}
      </div>

      {/* 登录模态框 */}
      <LoginModal
        isOpen={isLoginModalOpen}
        onClose={() => setIsLoginModalOpen(false)}
      />
    </div>
  );
}
