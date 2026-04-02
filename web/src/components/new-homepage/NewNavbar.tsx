'use client';

import React, { useState, useEffect } from 'react';
import Image from 'next/image';
import { useHomeTranslations } from '@/context/locale-context';
import { useAuth } from '@/lib/hooks/useAuth';
import LoginModal from '@/components/login/login-modal';
import ProfileButton from '@/components/xid/profile-button';

const NewNavbar: React.FC = () => {
  const { t } = useHomeTranslations('home.navbar');
  const { user, logout, isLoading } = useAuth();
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setIsScrolled(window.scrollY > 20);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const scrollTo = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      const top = el.getBoundingClientRect().top + window.scrollY - 80;
      window.scrollTo({ top, behavior: 'smooth' });
    }
  };

  return (
    <>
      <nav
        className={`fixed top-0 left-0 z-50 w-full transition-all duration-300 ${
          isScrolled
            ? 'bg-transparent'
            : 'bg-transparent'
        }`}
      >
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <a
            href="/"
            className="flex cursor-pointer items-center gap-2"
          >
            <Image src="/icons/bnbot-new-logo-sm.png" alt="BNBot" width={32} height={32} className="h-8 w-8" />
          </a>

          <div className="flex items-center gap-8">
            <a href="/docs" className="hidden text-sm text-space-muted transition-colors hover:text-space-text sm:block">Docs</a>
            <div className="flex items-center">
              {isLoading ? (
                <div className="h-9 w-20 animate-pulse rounded-full bg-white/10" />
              ) : user ? (
                <ProfileButton userData={user} onSignOut={() => logout()} showUserInfo={false} size="small" menuDirection="bottom" forceDark />
              ) : null}
            </div>
          </div>
        </div>
      </nav>

      <LoginModal isOpen={isLoginModalOpen} onClose={() => setIsLoginModalOpen(false)} onLoginSuccess={() => setIsLoginModalOpen(false)} />
    </>
  );
};

export default NewNavbar;
