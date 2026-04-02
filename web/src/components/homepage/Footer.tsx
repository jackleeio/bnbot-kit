'use client';

import React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useHomeTranslations } from '@/context/locale-context';

const Footer: React.FC = () => {
  const { t } = useHomeTranslations('home.footer');

  return (
    <footer className="relative bg-white overflow-hidden">
      {/* Background decorations */}
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-gold-500/5 rounded-full blur-[120px]"></div>
      <div className="absolute bottom-0 right-1/4 w-64 h-64 bg-gold-500/3 rounded-full blur-[100px]"></div>

      {/* Top border */}
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-slate-200 to-transparent"></div>

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 md:py-16">
        <div className="flex flex-col items-center text-center">
          {/* Logo */}
          <div className="flex items-center justify-center mb-6">
            <Image
              src="/icons/bnbot-logo.png"
              alt="BNBOT"
              width={64}
              height={64}
              className="w-16 h-16"
            />
          </div>

          {/* Tagline */}
          <p className="text-slate-400 text-xs mb-8 whitespace-nowrap">
            {t('tagline')}
          </p>

          {/* Social links */}
          <div className="flex items-center gap-4 mb-8">
            <a
              href="https://x.com/bnbot_ai"
              target="_blank"
              rel="noopener noreferrer"
              className="group"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" className="w-5 h-5 fill-slate-400 group-hover:fill-gold-500 transition-colors">
                <path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z" />
              </svg>
            </a>
          </div>

          {/* Divider */}
          <div className="w-full max-w-xs h-px bg-gradient-to-r from-transparent via-slate-200 to-transparent mb-6"></div>

          {/* Copyright */}
          <p className="text-slate-400 text-xs">
            &copy; {new Date().getFullYear()} {t('copyright')}
          </p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
