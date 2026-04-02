'use client';

import React from 'react';
import Image from 'next/image';
import { useHomeTranslations } from '@/context/locale-context';

const Footer: React.FC = () => {
  const { t } = useHomeTranslations('home.footer');

  return (
    <footer className="border-t border-white/[0.06]">
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="flex flex-col items-center text-center">
          <div className="mb-6 flex flex-wrap items-center justify-center gap-1">
            <a href="https://x.com/bnbot_ai" target="_blank" rel="noopener noreferrer" className="text-sm text-coral-500 hover:text-coral-400 transition-colors">X</a>
            <span className="mx-2 text-space-dim">&middot;</span>
            <a href="https://chromewebstore.google.com/detail/bnbot/haammgigdkckogcgnbkigfleejpaiiln" target="_blank" rel="noopener noreferrer" className="text-sm text-coral-500 hover:text-coral-400 transition-colors">Extension</a>
            <span className="mx-2 text-space-dim">&middot;</span>
            <a href="/docs" className="text-sm text-coral-500 hover:text-coral-400 transition-colors">Docs</a>
          </div>
          <div className="mb-4 flex items-center justify-center">
            <Image src="/icons/bnbot-new-logo-sm.png" alt="BNBot" width={32} height={32} className="h-8 w-8" />
          </div>
          <p className="text-xs text-space-dim/60">&copy; {new Date().getFullYear()} {t('copyright')}</p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
