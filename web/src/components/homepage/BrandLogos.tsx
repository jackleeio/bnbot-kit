'use client';

import React from 'react';
import { SiYoutube, SiTelegram, SiTiktok } from 'react-icons/si';
import { RiTwitterXFill } from 'react-icons/ri';

const BrandLogos = () => {
  const platforms = [
    { name: 'X', icon: RiTwitterXFill, color: 'group-hover:text-black' },
    { name: 'YouTube', icon: SiYoutube, color: 'group-hover:text-red-500' },
    { name: 'Telegram', icon: SiTelegram, color: 'group-hover:text-blue-500' },
    { name: 'TikTok', icon: SiTiktok, color: 'group-hover:text-black' },
  ];

  const aiModels = [
    {
      name: 'Gemini',
      icon: () => (
        <svg viewBox="0 0 24 24" className="h-6 w-6 md:h-7 md:w-7" fill="none">
          <path
            d="M12 24C12 24 12 12 24 12C12 12 12 0 12 0C12 0 12 12 0 12C12 12 12 24 12 24Z"
            fill="currentColor"
          />
        </svg>
      ),
      color: 'group-hover:text-blue-500',
    },
    {
      name: 'Grok',
      icon: () => (
        <svg
          viewBox="0 0 33 33"
          className="h-6 w-6 md:h-7 md:w-7"
          fill="currentColor"
        >
          <path d="M13.2371 21.0407L24.3186 12.8506C24.8619 12.4491 25.6384 12.6057 25.8973 13.2294C27.2597 16.5185 26.651 20.4712 23.9403 23.1851C21.2297 25.8989 17.4581 26.4941 14.0108 25.1386L10.2449 26.8843C15.6463 30.5806 22.2053 29.6665 26.304 25.5601C29.5551 22.3051 30.562 17.8683 29.6205 13.8673L29.629 13.8758C28.2637 7.99809 29.9647 5.64871 33.449 0.844576C33.5314 0.730667 33.6139 0.616757 33.6964 0.5L29.1113 5.09055V5.07631L13.2343 21.0436" />
          <path d="M10.9503 23.0313C7.07343 19.3235 7.74185 13.5853 11.0498 10.2763C13.4959 7.82722 17.5036 6.82767 21.0021 8.2971L24.7595 6.55998C24.0826 6.07017 23.215 5.54334 22.2195 5.17313C17.7198 3.31926 12.3326 4.24192 8.67479 7.90126C5.15635 11.4239 4.0499 16.8403 5.94992 21.4622C7.36924 24.9165 5.04257 27.3598 2.69884 29.826C1.86829 30.7002 1.0349 31.5745 0.36364 32.5L10.9474 23.0341" />
        </svg>
      ),
      color: 'group-hover:text-black',
    },
    {
      name: 'BNB Chain',
      icon: () => (
        <svg
          viewBox="0 0 126.61 126.61"
          className="h-6 w-6 md:h-7 md:w-7"
          fill="currentColor"
        >
          <path d="M38.73 53.2l24.59-24.58 24.6 24.6 14.3-14.31L63.32 0l-38.9 38.9zM0 63.31l14.3-14.31 14.31 14.31-14.31 14.3zM38.73 73.41l24.59 24.59 24.6-24.6 14.31 14.29-38.9 38.91-38.91-38.88zM97.99 63.31l14.3-14.31 14.32 14.31-14.31 14.3zM77.83 63.3L63.32 48.78 52.59 59.51l-1.24 1.23-2.54 2.54 14.51 14.5 14.51-14.47z" />
        </svg>
      ),
      color: 'group-hover:text-yellow-500',
    },
    {
      name: 'Base',
      icon: () => (
        <svg viewBox="0 0 111 111" className="h-6 w-6 md:h-7 md:w-7" fill="currentColor">
          <path d="M54.921 110.034C85.359 110.034 110.034 85.402 110.034 55.017C110.034 24.6319 85.359 0 54.921 0C26.0432 0 2.35281 22.1714 0 50.3923H72.8467V59.6416H0C2.35281 87.8625 26.0432 110.034 54.921 110.034Z" />
        </svg>
      ),
      color: 'group-hover:text-blue-600',
    },
  ];

  return (
    <div className="w-full py-12">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <h3 className="mb-8 select-none text-center text-sm font-medium text-slate-500 md:text-base">
          Built with the best
        </h3>

        <div className="flex flex-wrap items-center justify-center gap-8 md:gap-12 lg:gap-16">
          {platforms.map((platform, index) => (
            <div
              key={index}
              className="group flex items-center gap-2 transition-all duration-300 hover:scale-110"
            >
              <platform.icon
                className={`h-6 w-6 text-slate-400 transition-colors md:h-7 md:w-7 ${platform.color}`}
              />
              <span
                className={`select-none text-sm font-medium text-slate-400 transition-colors group-hover:text-slate-700`}
              >
                {platform.name}
              </span>
            </div>
          ))}

          {aiModels.map((model, index) => (
            <div
              key={index}
              className="group flex items-center gap-2 transition-all duration-300 hover:scale-110"
            >
              <div
                className={`text-slate-400 transition-colors ${model.color}`}
              >
                <model.icon />
              </div>
              <span
                className={`select-none text-sm font-medium text-slate-400 transition-colors group-hover:text-slate-700`}
              >
                {model.name}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default BrandLogos;
