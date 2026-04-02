'use client';

import React from 'react';
import { Star } from 'lucide-react';
import Image from 'next/image';
import { motion } from 'framer-motion';
import SectionHeader from './SectionHeader';
import { useHomeTranslations } from '@/context/locale-context';

const configs = [
  { id: 1, key: '0', img: 'https://i.pravatar.cc/150?u=a042581f4e29026024d' },
  { id: 2, key: '1', img: 'https://i.pravatar.cc/150?u=a042581f4e29026704d' },
  { id: 3, key: '2', img: 'https://i.pravatar.cc/150?u=a042581f4e29026704b' },
  { id: 4, key: '3', img: 'https://i.pravatar.cc/150?u=a042581f4e29026703d' },
  { id: 5, key: '4', img: 'https://i.pravatar.cc/150?u=a042581f4e29026709d' },
  { id: 6, key: '5', img: 'https://i.pravatar.cc/150?u=a042581f4e29026705d' },
  { id: 7, key: '6', img: 'https://i.pravatar.cc/150?u=a042581f4e29026702d' },
  { id: 8, key: '7', img: 'https://i.pravatar.cc/150?u=a042581f4e29026701d' },
  { id: 9, key: '8', img: 'https://i.pravatar.cc/150?u=a042581f4e29026706d' },
];

const row1 = configs.slice(0, 5);
const row2 = configs.slice(4, 9);

const Card: React.FC<{ c: typeof configs[0]; t: (k: string) => string }> = ({ c, t }) => (
  <div className="mx-2 w-[300px] flex-shrink-0 select-none rounded-xl border border-white/[0.08] bg-[rgba(10,15,26,0.65)] p-5 md:w-[360px]">
    <div className="mb-3 flex gap-0.5">
      {[...Array(5)].map((_, i) => <Star key={i} className="h-3.5 w-3.5 fill-coral-400 text-coral-400" />)}
    </div>
    <p className="mb-4 text-sm italic leading-relaxed text-space-muted">&ldquo;{t(`items.${c.key}.content`)}&rdquo;</p>
    <div className="flex items-center gap-3 border-t border-white/[0.06] pt-3">
      <Image src={c.img} alt="" width={32} height={32} className="h-8 w-8 rounded-full object-cover" unoptimized />
      <div>
        <div className="text-xs font-medium text-space-text">{t(`items.${c.key}.name`)}</div>
        <div className="text-[10px] text-coral-500">{t(`items.${c.key}.role`)}</div>
      </div>
    </div>
  </div>
);

const Testimonials: React.FC = () => {
  const { t } = useHomeTranslations('home.testimonials');

  return (
    <section className="relative py-20 md:py-32">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6 }}>
          <SectionHeader title={`${t('titlePrefix')}${t('rotatingWords.0')}${t('titleSuffix')}`} />
        </motion.div>

        <div className="space-y-4 [--marquee-speed:4s] md:[--marquee-speed:8s]">
          <div className="relative overflow-hidden">
            <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-16 bg-gradient-to-r from-space-black to-transparent" />
            <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-16 bg-gradient-to-l from-space-black to-transparent" />
            <div className="flex animate-marquee-left-slow" style={{ animationDuration: 'var(--marquee-speed, 8s)' }}>
              {[...row1, ...row1, ...row1, ...row1].map((c, i) => <Card key={`a-${c.id}-${i}`} c={c} t={t} />)}
            </div>
          </div>
          <div className="relative overflow-hidden">
            <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-16 bg-gradient-to-r from-space-black to-transparent" />
            <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-16 bg-gradient-to-l from-space-black to-transparent" />
            <div className="flex animate-marquee-right-slow" style={{ animationDelay: '-30s', animationDuration: 'var(--marquee-speed, 8s)' }}>
              {[...row2, ...row2, ...row2, ...row2].map((c, i) => <Card key={`b-${c.id}-${i}`} c={c} t={t} />)}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default Testimonials;
