'use client';

import React, { useState, useEffect } from 'react';
import { Star, Quote, BadgeCheck } from 'lucide-react';
import Image from 'next/image';
import { useHomeTranslations } from '@/context/locale-context';

interface TestimonialConfig {
  id: number;
  translationKey: string;
  image: string;
}

const testimonialConfigs: TestimonialConfig[] = [
  {
    id: 1,
    translationKey: '0',
    image: 'https://i.pravatar.cc/150?u=a042581f4e29026024d',
  },
  {
    id: 2,
    translationKey: '1',
    image: 'https://i.pravatar.cc/150?u=a042581f4e29026704d',
  },
  {
    id: 3,
    translationKey: '2',
    image: 'https://i.pravatar.cc/150?u=a042581f4e29026704b',
  },
  {
    id: 4,
    translationKey: '3',
    image: 'https://i.pravatar.cc/150?u=a042581f4e29026703d',
  },
  {
    id: 5,
    translationKey: '4',
    image: 'https://i.pravatar.cc/150?u=a042581f4e29026709d',
  },
  {
    id: 6,
    translationKey: '5',
    image: 'https://i.pravatar.cc/150?u=a042581f4e29026705d',
  },
  {
    id: 7,
    translationKey: '6',
    image: 'https://i.pravatar.cc/150?u=a042581f4e29026702d',
  },
  {
    id: 8,
    translationKey: '7',
    image: 'https://i.pravatar.cc/150?u=a042581f4e29026701d',
  },
  {
    id: 9,
    translationKey: '8',
    image: 'https://i.pravatar.cc/150?u=a042581f4e29026706d',
  },
];

interface TestimonialCardProps {
  config: TestimonialConfig;
  isMobile?: boolean;
  t: (key: string) => string;
}

const TestimonialCard: React.FC<TestimonialCardProps> = ({
  config,
  isMobile,
  t,
}) => (
  <div
    className={`group relative cursor-default overflow-hidden rounded-xl border border-slate-100 bg-white shadow-[0_2px_15px_-3px_rgba(0,0,0,0.03)] transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_8px_25px_-5px_rgba(0,0,0,0.08)] md:rounded-2xl select-none ${isMobile ? 'mr-3 w-[260px] flex-shrink-0 p-3' : 'mx-4 mb-8 p-8'}`}
  >
    {/* Decorative Quote Icon */}
    <Quote
      className={`absolute -z-0 text-slate-50 transition-colors duration-300 group-hover:text-slate-100 ${isMobile ? 'right-3 top-3 h-6 w-6' : 'right-6 top-6 h-12 w-12'}`}
    />

    <div className="relative z-10">
      <div className={`flex ${isMobile ? 'mb-2 gap-0.5' : 'mb-5 gap-1'}`}>
        {[...Array(5)].map((_, i) => (
          <Star
            key={i}
            className={`fill-gold-400 text-gold-400 ${isMobile ? 'h-3 w-3' : 'h-4 w-4'}`}
          />
        ))}
      </div>

      <p
        className={`italic leading-relaxed text-slate-700 ${isMobile ? 'mb-3 line-clamp-3 text-[11px]' : 'mb-8 text-[15px]'}`}
      >
        &ldquo;{t(`items.${config.translationKey}.content`)}&rdquo;
      </p>

      <div
        className={`flex items-center border-t border-slate-50 transition-colors group-hover:border-slate-100 ${isMobile ? 'gap-2 pt-2' : 'gap-4 pt-4'}`}
      >
        <div className="relative flex-shrink-0">
          <Image
            src={config.image}
            alt={t(`items.${config.translationKey}.name`)}
            width={48}
            height={48}
            className={`rounded-full object-cover shadow-sm ${isMobile ? 'h-7 w-7 border border-white' : 'h-12 w-12 border-2 border-white'}`}
            unoptimized
          />
          <div
            className={`absolute rounded-full bg-white p-0.5 ${isMobile ? '-bottom-0.5 -right-0.5' : '-bottom-1 -right-1'}`}
          >
            <BadgeCheck
              className={`fill-white text-blue-500 ${isMobile ? 'h-2.5 w-2.5' : 'h-4 w-4'}`}
            />
          </div>
        </div>
        <div className="min-w-0">
          <div
            className={`truncate font-medium text-slate-900 ${isMobile ? 'text-[11px]' : 'text-sm'}`}
          >
            {t(`items.${config.translationKey}.name`)}
          </div>
          <div
            className={`truncate font-medium tracking-wide text-slate-500 ${isMobile ? 'text-[9px]' : 'text-xs'}`}
          >
            {t(`items.${config.translationKey}.role`)}
          </div>
        </div>
      </div>
    </div>
  </div>
);

const Testimonials: React.FC = () => {
  const { t } = useHomeTranslations('home.testimonials');
  const [currentIndex, setCurrentIndex] = useState(0);

  // Get rotating words from translations
  const rotatingWords = [
    t('rotatingWords.0'),
    t('rotatingWords.1'),
    t('rotatingWords.2'),
    t('rotatingWords.3'),
  ];

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % rotatingWords.length);
    }, 2500);

    return () => clearInterval(interval);
  }, [rotatingWords.length]);

  // Split data into 3 chunks
  const chunk1 = testimonialConfigs.slice(0, 3);
  const chunk2 = testimonialConfigs.slice(3, 6);
  const chunk3 = testimonialConfigs.slice(6, 9);

  return (
    <section className="relative overflow-hidden bg-slate-50 py-16 md:py-32">
      {/* Background Pattern */}
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,#80808008_1px,transparent_1px),linear-gradient(to_bottom,#80808008_1px,transparent_1px)] bg-[size:32px_32px]"></div>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_20%,#f8fafc_100%)]"></div>

      <div className="relative z-10 mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mx-auto mb-10 max-w-3xl select-none text-center md:mb-16">
          <h2 className="mb-4 text-3xl font-bold leading-tight tracking-wide text-slate-900 md:mb-5 md:text-5xl">
            {t('titlePrefix')}
            <span className="relative inline-block h-[1.275em] overflow-hidden align-top -mb-2">
              <span
                key={currentIndex}
                className="inline-block animate-[slideUpIn_0.5s_ease-out] bg-gradient-to-r from-gold-600 to-yellow-500 bg-clip-text text-transparent"
              >
                {rotatingWords[currentIndex]}
              </span>
            </span>
            {t('titleSuffix')}
          </h2>
          <p
            className="mx-auto max-w-2xl text-sm font-light text-slate-500 md:text-base"
            style={{ fontFamily: '"Exo 2", sans-serif' }}
          >
            {t('description')}
          </p>
        </div>

        {/* Mobile: 3 rows horizontal scroll */}
        <div className="-mx-4 space-y-3 overflow-hidden md:hidden">
          {/* Row 1 - scroll left */}
          <div className="relative">
            <div className="pointer-events-none absolute bottom-0 left-0 top-0 z-10 w-8 bg-gradient-to-r from-slate-50 to-transparent"></div>
            <div className="pointer-events-none absolute bottom-0 right-0 top-0 z-10 w-8 bg-gradient-to-l from-slate-50 to-transparent"></div>
            <div className="flex animate-marquee-left">
              {[...chunk1, ...chunk1, ...chunk1, ...chunk1].map((c, i) => (
                <TestimonialCard
                  key={`m1-${c.id}-${i}`}
                  config={c}
                  isMobile
                  t={t}
                />
              ))}
            </div>
          </div>

          {/* Row 2 - scroll right */}
          <div className="relative">
            <div className="pointer-events-none absolute bottom-0 left-0 top-0 z-10 w-8 bg-gradient-to-r from-slate-50 to-transparent"></div>
            <div className="pointer-events-none absolute bottom-0 right-0 top-0 z-10 w-8 bg-gradient-to-l from-slate-50 to-transparent"></div>
            <div className="flex animate-marquee-right">
              {[...chunk2, ...chunk2, ...chunk2, ...chunk2].map((c, i) => (
                <TestimonialCard
                  key={`m2-${c.id}-${i}`}
                  config={c}
                  isMobile
                  t={t}
                />
              ))}
            </div>
          </div>

          {/* Row 3 - scroll left */}
          <div className="relative">
            <div className="pointer-events-none absolute bottom-0 left-0 top-0 z-10 w-8 bg-gradient-to-r from-slate-50 to-transparent"></div>
            <div className="pointer-events-none absolute bottom-0 right-0 top-0 z-10 w-8 bg-gradient-to-l from-slate-50 to-transparent"></div>
            <div
              className="flex animate-marquee-left"
              style={{ animationDelay: '-10s' }}
            >
              {[...chunk3, ...chunk3, ...chunk3, ...chunk3].map((c, i) => (
                <TestimonialCard
                  key={`m3-${c.id}-${i}`}
                  config={c}
                  isMobile
                  t={t}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Desktop: 3 columns vertical scroll */}
        <div className="relative hidden h-[700px] overflow-hidden md:block">
          {/* Fade overlay top/bottom */}
          <div className="pointer-events-none absolute inset-x-0 top-0 z-20 h-32 bg-gradient-to-b from-slate-50 via-slate-50/80 to-transparent"></div>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-32 bg-gradient-to-t from-slate-50 via-slate-50/80 to-transparent"></div>

          <div className="grid grid-cols-3 gap-8">
            {/* Column 1 - Up */}
            <div className="relative -top-20 h-[800px]">
              <div className="animate-marquee-up pb-10">
                {[...chunk1, ...chunk1, ...chunk1, ...chunk1].map((c, i) => (
                  <TestimonialCard key={`c1-${c.id}-${i}`} config={c} t={t} />
                ))}
              </div>
            </div>

            {/* Column 2 - Down */}
            <div className="relative -top-20 h-[800px]">
              <div className="animate-marquee-down pb-10">
                {[...chunk2, ...chunk2, ...chunk2, ...chunk2].map((c, i) => (
                  <TestimonialCard key={`c2-${c.id}-${i}`} config={c} t={t} />
                ))}
              </div>
            </div>

            {/* Column 3 - Up */}
            <div className="relative -top-20 h-[800px]">
              <div
                className="animate-marquee-up pb-10"
                style={{ animationDelay: '-15s' }}
              >
                {[...chunk3, ...chunk3, ...chunk3, ...chunk3].map((c, i) => (
                  <TestimonialCard key={`c3-${c.id}-${i}`} config={c} t={t} />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default Testimonials;
