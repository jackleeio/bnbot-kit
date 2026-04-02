'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { DRAWER_VIEW, useDrawer } from '@/components/drawer-views/context';
import { LAYOUT_OPTIONS } from '@/lib/constants';
import { defaultMenuItems } from '@/layouts/sidebar/_menu-items';
import Sidebar from '@/layouts/sidebar/_default';
import DrawerMenu from '@/layouts/sidebar/_layout-menu';

function renderDrawerContent(view: DRAWER_VIEW | string, userData: any, onSignOut: () => void) {
  switch (view) {
    case 'DEFAULT_SIDEBAR':
      return <Sidebar userData={userData} onSignOut={onSignOut} />;
    case 'RETRO_SIDEBAR':
      return (
        <Sidebar
          layoutOption={`/${LAYOUT_OPTIONS.RETRO}`}
          menuItems={defaultMenuItems}
          userData={userData}
          onSignOut={onSignOut}
        />
      );
    case 'CLASSIC_SIDEBAR':
      return (
        <DrawerMenu
          layoutOption={`/${LAYOUT_OPTIONS.CLASSIC}`}
          menuItems={defaultMenuItems}
          userData={userData}
          onSignOut={onSignOut}
        />
      );
    // case 'DRAWER_SEARCH':
    //   return <DrawerFilters />;
    // case 'DRAWER_PREVIEW_NFT':
    //   return <PreviewContent />;
    default:
      return null;
  }
}

export default function DrawersContainer() {
  const { view, isOpen, closeDrawer } = useDrawer();
  const [userData, setUserData] = useState<any>(null);
  const router = useRouter();

  // Swipe gesture state
  const swipeStartXRef = useRef<number | null>(null);
  const swipeStartYRef = useRef<number | null>(null);

  useEffect(() => {
    // get user data from localStorage
    const storedUserData = localStorage.getItem('userData.bnbot');
    if (storedUserData) {
      setUserData(JSON.parse(storedUserData));
    }
  }, []);

  const handleSignOut = () => {
    localStorage.removeItem('userData.bnbot');
    setUserData(null);
    // 不再跳转到登录页面，让ProfileButton组件处理登录modal的显示
    closeDrawer();
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    swipeStartXRef.current = e.touches[0].clientX;
    swipeStartYRef.current = e.touches[0].clientY;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (swipeStartXRef.current === null || swipeStartYRef.current === null) return;

    const currentX = e.touches[0].clientX;
    const currentY = e.touches[0].clientY;
    const deltaX = currentX - swipeStartXRef.current;
    const deltaY = currentY - swipeStartYRef.current;

    // 检测左滑手势：水平移动大于垂直移动，且向左滑动超过30px
    if (Math.abs(deltaX) > Math.abs(deltaY) && deltaX < -30) {
      closeDrawer();
      swipeStartXRef.current = null;
      swipeStartYRef.current = null;
    }
  };

  const handleTouchEnd = () => {
    swipeStartXRef.current = null;
    swipeStartYRef.current = null;
  };

  return (
    <div
      className={`fixed inset-0 z-[999999] isolate overflow-hidden transition-opacity duration-300 ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
    >
      {/* 背景遮罩 - 透明，用于点击关闭 */}
      <div
        suppressHydrationWarning={true}
        className="fixed inset-0"
        onClick={closeDrawer}
      />

      {/* 侧边栏内容 */}
      <div
        className={`fixed top-0 bottom-0 left-0 z-[999999] flex w-3/4 max-w-80 transform bg-white transition-transform duration-200 ease-out shadow-2xl ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}
        style={{
          paddingTop: 'max(env(safe-area-inset-top), 0px)',
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
      >
        {view && renderDrawerContent(view, userData, handleSignOut)}
      </div>
    </div>
  );
}
