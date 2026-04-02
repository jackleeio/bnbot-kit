'use client';

import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import SectionHeader from './SectionHeader';
import { useHomeTranslations } from '@/context/locale-context';

const Counter: React.FC<{ end: number; suffix: string; decimals?: number }> = ({ end, suffix, decimals = 0 }) => {
  const [count, setCount] = useState(0);
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) setVisible(true); }, { threshold: 0.3 });
    if (ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    let start: number, raf: number;
    const animate = (ts: number) => {
      if (!start) start = ts;
      const p = Math.min((ts - start) / 2000, 1);
      setCount((1 - Math.pow(1 - p, 4)) * end);
      if (p < 1) raf = requestAnimationFrame(animate);
    };
    raf = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(raf);
  }, [visible, end]);

  return (
    <span ref={ref} className="text-3xl font-bold tabular-nums tracking-tight text-coral-500 sm:text-4xl">
      {decimals > 0 ? count.toFixed(decimals) : Math.floor(count)}{suffix}
    </span>
  );
};

const Stats: React.FC = () => {
  const { t } = useHomeTranslations('home.stats');

  return (
    <section className="relative border-y border-white/[0.06] py-16 md:py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6 }}
          className="flex flex-col items-center gap-12 md:flex-row md:justify-between"
        >
          <div className="max-w-xl select-none text-center md:text-left">
            <h2 className="mb-4 text-2xl font-bold text-space-text md:text-4xl">
              {t('title')}{' '}
              <span className="bg-gradient-to-r from-coral-500 to-gold-500 bg-clip-text text-transparent">{t('titleHighlight')}</span>
            </h2>
            <p className="text-base leading-relaxed text-space-muted md:text-lg">{t('description')}</p>
          </div>

          <div className="grid w-auto grid-cols-3 gap-6 text-center sm:gap-12 select-none">
            <div className="flex flex-col items-center">
              <Counter end={100} suffix="m+" />
              <span className="mt-1 text-xs font-medium text-space-dim sm:text-sm">{t('exposure')}</span>
            </div>
            <div className="flex flex-col items-center">
              <Counter end={3600} suffix="+" />
              <span className="mt-1 text-xs font-medium text-space-dim sm:text-sm">{t('superIndividuals')}</span>
            </div>
            <div className="flex flex-col items-center">
              <Counter end={3.5} suffix="x" decimals={1} />
              <span className="mt-1 text-xs font-medium text-space-dim sm:text-sm">{t('engagementBoost')}</span>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
};

export default Stats;
