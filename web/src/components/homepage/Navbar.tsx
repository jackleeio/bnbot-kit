'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import Shuffle from '@/components/ui/Shuffle';
import LocaleSwitcher from './LocaleSwitcher';
import { useHomeTranslations } from '@/context/locale-context';
import { useAuth } from '@/lib/hooks/useAuth';
import LoginModal from '@/components/login/login-modal';
import ProfileButton from '@/components/xid/profile-button';

const Navbar: React.FC = () => {
  const { t } = useHomeTranslations('home.navbar');
  const { user, logout, isLoading } = useAuth();
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);

  const scrollToSection = (id: string) => {
    const element = document.getElementById(id);
    if (element) {
      const offset = 20;
      const bodyRect = document.body.getBoundingClientRect().top;
      const elementRect = element.getBoundingClientRect().top;
      const elementPosition = elementRect - bodyRect;
      const offsetPosition = elementPosition - offset;

      window.scrollTo({
        top: offsetPosition,
        behavior: 'smooth'
      });
    }
  };

  const handleSignOut = async () => {
    await logout();
  };

  return (
    <>
      <nav className="absolute top-0 left-0 w-full bg-transparent py-4 z-10">
        <div className="max-w-7xl mx-auto pl-4 md:pl-14 pr-6 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            {/* Logo */}
            <div
              className="flex items-center gap-2 group cursor-pointer"
              onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
            >
              <Image
                src="/icons/bnbot-logo.png"
                alt="BNBOT"
                width={36}
                height={36}
                className="w-9 h-9"
              />
              <Shuffle
                text="BNBot"
                tag="span"
                className="text-2xl font-bold tracking-tight text-gold-500"
                shuffleDirection="right"
                duration={0.35}
                animationMode="sliding"
                shuffleTimes={1}
                ease="power3.out"
                stagger={0.03}
                triggerOnce={false}
                triggerOnHover={true}
                loop={true}
                loopDelay={3}
              />
            </div>

            <div className="flex items-center gap-8">
              {/* Menu - hidden on mobile */}
              <div className="hidden md:flex items-center space-x-8">
                <button
                  onClick={() => scrollToSection('features')}
                  className="text-slate-600 hover:text-gold-600 transition-colors text-sm font-medium"
                >
                  {t('features')}
                </button>
                <button
                  onClick={() => scrollToSection('pricing')}
                  className="text-slate-600 hover:text-gold-600 transition-colors text-sm font-medium"
                >
                  {t('pricing')}
                </button>
                {/* TODO: Temporarily hidden - uncomment when ready to show tools dropdown */}
                {/* <div className="flex items-center">
                  <ToolsDropdown onLogin={() => setIsLoginModalOpen(true)} />
                </div> */}
              </div>

              {/* Locale Switcher & Login */}
              <div className="flex items-center gap-6">
                <LocaleSwitcher />

                {/* Login Button / User Info */}
                <div className="flex items-center">
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
                      className="px-5 py-2 bg-gradient-to-r from-gold-500 to-yellow-400 text-black text-sm font-semibold rounded-full"
                    >
                      {t('signIn')}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </nav>

      {/* Login Modal */}
      <LoginModal
        isOpen={isLoginModalOpen}
        onClose={() => setIsLoginModalOpen(false)}
        onLoginSuccess={() => setIsLoginModalOpen(false)}
      />
    </>
  );
};

export default Navbar;
