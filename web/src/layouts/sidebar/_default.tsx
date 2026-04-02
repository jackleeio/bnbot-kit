'use client';

import cn from '@/utils/cn';
import { useTranslations } from 'next-intl';

import Logo from '@/components/ui/logo';
import { MenuItem } from '@/components/ui/collapsible-menu';
// import Scrollbar from '@/components/ui/scrollbar';
import Button from '@/components/ui/button';
import { useDrawer } from '@/components/drawer-views/context';
import { Close } from '@/components/icons/close';
import { defaultMenuItems } from '@/layouts/sidebar/_menu-items';
import { LAYOUT_OPTIONS } from '@/lib/constants';
import ProfileButton from '@/components/xid/profile-button';
import LoginModal from '@/components/login/login-modal';

import React, { useState } from 'react';

interface SidebarProps {
  className?: string;
  layoutOption?: string;
  menuItems?: any[];
  userData?: any;
  onSignOut?: () => void;
}

export default function Sidebar({
  className,
  layoutOption = '',
  menuItems = defaultMenuItems,
  userData,
  onSignOut,
}: SidebarProps) {
  const { closeDrawer } = useDrawer();
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const [showLoginModalAfterSignout, setShowLoginModalAfterSignout] = useState(false);
  const t = useTranslations('sidebar');
  const sideBarMenus = menuItems?.map((item) => ({
    name: item.name,
    icon: item.icon,
    href: item.href,
    ...(item.dropdownItems && {
      dropdownItems: item?.dropdownItems?.map((dropdownItem: any) => ({
        name: dropdownItem.name,
        ...(dropdownItem?.icon && { icon: dropdownItem.icon }),
        href: dropdownItem.href,
      })),
    }),
  }));

  return (
    <>
      <aside
        className={cn(
          'top-0 z-[60] h-full w-full max-w-full border-dashed border-gray-200 bg-body ltr:left-0 ltr:border-r rtl:right-0 rtl:border-l dark:border-gray-700 dark:bg-dark xs:w-[21.5rem] xl:fixed  xl:w-[22.5rem] 2xl:w-[23.5rem]',
          className,
        )}
      >
      <div className="relative flex h-24 items-center justify-between overflow-hidden px-6 py-4 2xl:px-8" suppressHydrationWarning>
        <Logo />
        <div className="md:hidden" suppressHydrationWarning>
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

      <div className="custom-scrollbar h-[calc(100%-140px)] overflow-hidden overflow-y-auto">
        <div className="px-6 pb-5 2xl:px-8">
          <div className="mt-12">
            {sideBarMenus?.map((item, index) => (
              <MenuItem
                key={'default' + item.name + index}
                name={item.name}
                href={item.href}
                icon={item.icon}
                dropdownItems={item.dropdownItems}
              />
            ))}
          </div>
        </div>
      </div>

      {/* 将头像/登录按钮移到底部固定位置，与 _expandable.tsx 保持一致 */}
      <div className="sticky bottom-3 mt-2 2xl:mt-6">
        {userData && (
          <div className="pb-2 px-6 2xl:px-8 flex items-center">
            <ProfileButton 
              userData={userData} 
              onSignOut={() => {
                if (onSignOut) {
                  onSignOut();
                }
                // 登出后显示登录modal
                setShowLoginModalAfterSignout(true);
              }}
              showUserInfo={true}
              size="small"
              menuDirection="top"
            />
          </div>
        )}
        
        {/* 登录按钮 - 仅在未登录时显示 */}
        {!userData && (
          <div className="pb-2 px-6 2xl:px-8 flex">
            <Button
              onClick={() => setIsLoginModalOpen(true)}
              className="w-full !h-8 bg-[#f0b90b] text-white font-medium px-3 rounded-full transition-colors duration-200 border border-[#f0b90b] flex items-center justify-center gap-2 text-sm"
              size="small"
            >
              <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
              <span suppressHydrationWarning>{t('signIn')}</span>
            </Button>
          </div>
        )}
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
