'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useHomeTranslations } from '@/context/locale-context';

interface CounterProps {
  end: number;
  suffix: string;
  duration?: number;
  decimals?: number;
}

const Counter: React.FC<CounterProps> = ({
  end,
  suffix,
  duration = 2000,
  decimals = 0,
}) => {
  const [count, setCount] = useState(0);
  const [isVisible, setIsVisible] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !isVisible) {
          setIsVisible(true);
        }
      },
      { threshold: 0.3 },
    );

    if (ref.current) {
      observer.observe(ref.current);
    }

    return () => observer.disconnect();
  }, [isVisible]);

  useEffect(() => {
    if (!isVisible) return;

    let startTime: number;
    let animationFrame: number;

    const animate = (timestamp: number) => {
      if (!startTime) startTime = timestamp;
      const progress = Math.min((timestamp - startTime) / duration, 1);

      // Easing function for smooth animation
      const easeOutQuart = 1 - Math.pow(1 - progress, 4);
      const currentCount = easeOutQuart * end;

      setCount(currentCount);

      if (progress < 1) {
        animationFrame = requestAnimationFrame(animate);
      }
    };

    animationFrame = requestAnimationFrame(animate);

    return () => cancelAnimationFrame(animationFrame);
  }, [isVisible, end, duration]);

  const displayValue =
    decimals > 0 ? count.toFixed(decimals) : Math.floor(count);

  return (
    <span
      ref={ref}
      className="mb-1 text-2xl font-semibold tabular-nums tracking-tighter text-slate-900 sm:mb-2 sm:text-4xl"
    >
      {displayValue}
      {suffix}
    </span>
  );
};

const Stats: React.FC = () => {
  const { t } = useHomeTranslations('home.stats');

  return (
    <section className="border-b border-slate-100 bg-white py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex justify-center">
          <div className="w-full px-4 md:pl-8 md:pr-0" style={{ maxWidth: 'calc(360px + 900px + 80px)' }}>
            <div className="flex flex-col items-center gap-12 md:flex-row md:items-center md:gap-24">
              {/* Text Side */}
              <div className="max-w-xl select-none text-center md:text-left">
                <h2 className="mb-6 text-2xl font-bold leading-tight tracking-wide text-slate-900 md:text-4xl">
                  {t('title')}{' '}
                  <span className="text-slate-900">{t('titleHighlight')}</span>
                </h2>
                <p
                  className="text-base font-normal leading-relaxed text-slate-600 md:text-lg"
                  style={{ fontFamily: '"Exo 2", sans-serif' }}
                >
                  {t('description')}
                </p>
              </div>

              {/* Numbers Side */}
              <div className="grid w-auto grid-cols-3 gap-4 text-center sm:gap-10 sm:text-right select-none">
                <div className="flex flex-col items-center sm:items-end">
                  <Counter end={100} suffix="m+" />
                  <span
                    className="text-xs font-semibold tracking-wide text-neutral-500 sm:text-sm"
                    style={{ fontFamily: '"Exo 2", sans-serif' }}
                  >
                    {t('exposure')}
                  </span>
                </div>
                <div className="flex flex-col items-center sm:items-end">
                  <Counter end={3600} suffix="+" />
                  <span
                    className="text-xs font-semibold tracking-wide text-neutral-500 sm:text-sm"
                    style={{ fontFamily: '"Exo 2", sans-serif' }}
                  >
                    {t('superIndividuals')}
                  </span>
                </div>
                <div className="flex flex-col items-center sm:items-end">
                  <Counter end={3.5} suffix="x" decimals={1} />
                  <span
                    className="text-xs font-semibold tracking-wide text-neutral-500 sm:text-sm"
                    style={{ fontFamily: '"Exo 2", sans-serif' }}
                  >
                    <span className="sm:hidden">Engagement</span>
                    <span className="hidden sm:inline">{t('engagementBoost')}</span>
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default Stats;
